-- ═══════════════════════════════════════════════════════════
--  Badge « Carte pro déclarée » des coachs (17/11/2026). Contrat : docs/COACH_V1.md, « Badge carte pro ».
--  ÉCRITE, PAS APPLIQUÉE EN PRODUCTION. Retour arrière : supabase/rollback/20261117090000_badge_carte_pro_down.sql.
--
--  1. Un coach (rôle validé, user_profiles.coach_at) DÉCLARE le numéro de sa carte professionnelle
--     d'éducateur sportif (Réglages › Coach). La déclaration est enregistrée avec sa date. Le badge dit
--     « Carte pro déclarée » : l'app ne dit jamais « vérifiée » ni « certifié ».
--  2. Le numéro n'est lisible que par le coach lui-même (coach_card_state) et par l'administrateur (éditeur
--     SQL, rôle postgres). Personne d'autre : public.coach_cards n'a aucun GRANT client, et la RPC publique
--     coach_card_badge ne renvoie que { shown, declared_at }.
--  3. Format : celui des cartes délivrées par le portail EAPS, 3 caractères du département (075, 02A, 971),
--     2 chiffres de l'année, « ED », puis le numéro d'ordre (ex. 04912ED0123). Espaces, points, tirets et
--     barres ignorés à la saisie, minuscules acceptées.
--  4. Signalement (report_coach_card) : réutilise la file commune public.reports (déclencheur : 10 par 24 h
--     et par compte, pseudo visé, purge à 12 mois) avec target_ref = 'coach_card' ; l'app demande ensuite
--     l'alerte e-mail à la fonction Edge report ({ report_id }), comme report_comment et report_chat.
--     L'alerte part dès le premier signalement, mais le badge n'est suspendu (status 'suspended') qu'à partir
--     de 2 signalements venant de 2 comptes DIFFÉRENTS (décision de Maxence, 17/11), comptés depuis la
--     déclaration ou la dernière revue. Un compte ne signale qu'une fois une même déclaration. Suspendu
--     jusqu'à la revue de l'administrateur : private.coach_card_restore le rend, private.coach_card_remove le
--     retire. La vue de revue donne le lien de la fiche officielle (recherche-educateur.sports.gouv.fr/CartePro/
--     <numéro>) pour comparer sa photo à celle du profil du coach.
--  5. Retrait par l'administrateur (usurpation, carte expirée) : status 'removed', le coach ne peut plus
--     redéclarer tant que l'administrateur n'a pas effacé la ligne. Coach qui perd son rôle : badge masqué
--     (la ligne reste, le rôle rendu le rend).
--  6. Plus tard (pas affiché pour l'instant) : vérification d'identité par FranceConnect. Colonnes
--     verified_at et verify_method ('franceconnect'), état 'verified'. Aucune fonction ne les écrit encore ;
--     l'app traite 'verified' comme 'declared'. Changer de numéro efface la vérification.
--  7. Blocage entre deux comptes : le badge n'est ni montré ni signalable.
--
--  Administration (éditeur SQL) :
--    select * from private.coach_cards_review;                         -- badges signalés, lien de la fiche officielle
--    select private.coach_card_restore('<uuid>', 'carte trouvée sur le site du ministère le 17/11');
--    select private.coach_card_remove('<uuid>', 'Numéro d''une autre personne.');
--    delete from public.coach_cards where user_id = '<uuid>';          -- autoriser une nouvelle déclaration
-- ═══════════════════════════════════════════════════════════

create table public.coach_cards (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  card_number    text not null check (card_number ~ '^[0-9]{2}[0-9AB][0-9]{2}ED[0-9]{4,5}$'),
  status         text not null default 'declared' check (status in ('declared', 'suspended', 'removed', 'verified')),
  declared_at    timestamptz not null default now(),
  suspended_at   timestamptz,
  removed_at     timestamptz,
  removed_reason text check (char_length(removed_reason) <= 500),
  reviewed_at    timestamptz,
  admin_note     text check (char_length(admin_note) <= 500),
  verified_at    timestamptz,
  verify_method  text check (verify_method in ('franceconnect')),
  constraint coach_cards_verified_pair check ((verified_at is null) = (verify_method is null)),
  constraint coach_cards_verified_state check (status <> 'verified' or verified_at is not null),
  constraint coach_cards_suspended_state check (status <> 'suspended' or suspended_at is not null),
  constraint coach_cards_removed_state check (status <> 'removed' or removed_at is not null)
);
create index coach_cards_suspended on public.coach_cards (suspended_at) where status = 'suspended';
alter table public.coach_cards enable row level security;
revoke all on public.coach_cards from public, anon, authenticated, service_role;

-- Ma déclaration (coach seulement) : numéro compris
create function private.coach_card_json(uid uuid) returns jsonb
  language sql stable set search_path = '' as
$$
  select coalesce(
    (select jsonb_build_object('status', c.status, 'card_number', c.card_number, 'declared_at', c.declared_at,
                               'suspended_at', c.suspended_at, 'removed_reason', c.removed_reason)
       from public.coach_cards c where c.user_id = uid),
    jsonb_build_object('status', 'none', 'card_number', null, 'declared_at', null, 'suspended_at', null,
                       'removed_reason', null))
$$;

-- Badge montré : déclaré (ou vérifié), coach encore coach, aucun blocage avec celui qui regarde
create function private.coach_card_shown(viewer uuid, coach uuid) returns boolean
  language sql stable set search_path = '' as
$$
  select viewer is not null and coach is not null
     and exists (select 1 from public.coach_cards c where c.user_id = coach and c.status in ('declared', 'verified'))
     and private.is_coach(coach)
     and (viewer = coach or not private.blocked_between(viewer, coach))
$$;

-- ── Fonctions RPC (authenticated) ────────────────────────

create function public.coach_card_state() returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  return private.coach_card_json(me);
end
$$;

-- Déclarer ou changer de numéro. Même numéro que celui déjà déclaré : rien ne change (ni la date, ni la
-- limite). Suspendu ou retiré : refusé (card_suspended, card_removed), sinon changer de numéro
-- effacerait la suspension. 5 déclarations par 24 h.
create function public.coach_card_declare(card_number text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me  uuid := (select auth.uid());
  num text := upper(regexp_replace(coalesce(coach_card_declare.card_number, ''), '[\s.\-/]', '', 'g'));
  cur public.coach_cards;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if not private.is_coach(me) then raise exception 'not_coach' using errcode = 'P0001'; end if;
  if num !~ '^[0-9]{2}[0-9AB][0-9]{2}ED[0-9]{4,5}$' then raise exception 'invalid_card' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_cards:' || me::text, 0));
  select * into cur from public.coach_cards c where c.user_id = me;
  if cur.status = 'removed' then raise exception 'card_removed' using errcode = 'P0001'; end if;
  if cur.status = 'suspended' then raise exception 'card_suspended' using errcode = 'P0001'; end if;
  if cur.card_number = num then return private.coach_card_json(me); end if;
  perform private.rate_limit_window(me, 'coach_card', 5, interval '24 hours');
  insert into public.coach_cards as c (user_id, card_number) values (me, num)
    on conflict (user_id) do update set card_number = excluded.card_number, status = 'declared',
      declared_at = now(), suspended_at = null, reviewed_at = null, admin_note = null,
      verified_at = null, verify_method = null;
  return private.coach_card_json(me);
end
$$;

-- Retirer sa déclaration (le badge disparaît). Suspendu ou retiré : refusé, la revue reste à faire.
create function public.coach_card_withdraw() returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  st text;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_cards:' || me::text, 0));
  select c.status into st from public.coach_cards c where c.user_id = me;
  if st = 'removed' then raise exception 'card_removed' using errcode = 'P0001'; end if;
  if st = 'suspended' then raise exception 'card_suspended' using errcode = 'P0001'; end if;
  delete from public.coach_cards c where c.user_id = me;
  return private.coach_card_json(me);
end
$$;

-- Badge d'un coach, vu par n'importe quel compte connecté : jamais le numéro
create function public.coach_card_badge(coach uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if not private.coach_card_shown(me, coach_card_badge.coach) then
    return jsonb_build_object('shown', false, 'declared_at', null);
  end if;
  return (select jsonb_build_object('shown', true, 'declared_at', c.declared_at)
            from public.coach_cards c where c.user_id = coach_card_badge.coach);
end
$$;

-- Comptes différents qui ont signalé ce badge depuis la déclaration ou la dernière revue
create function private.coach_card_reporters(uid uuid) returns int
  language sql stable set search_path = '' as
$$
  select count(distinct r.reporter_id)::int from public.coach_cards c join public.reports r
      on r.target_user = c.user_id and r.target_ref = 'coach_card'
     and r.created_at >= greatest(c.declared_at, coalesce(c.reviewed_at, c.declared_at))
   where c.user_id = uid
$$;

-- Signaler le badge d'un coach : ligne dans public.reports (alerte par la fonction Edge report, mode
-- { report_id }, dès le premier). Badge suspendu à partir de 2 comptes différents (seuil compté par
-- coach_card_reporters). Un seul signalement par compte et par déclaration (rejoué : null, rien de plus).
-- Badge déjà suspendu : le signalement est quand même enregistré (preuve en plus).
create function public.report_coach_card(coach uuid, details text default null) returns bigint
  language plpgsql security definer set search_path = '' as
$$
declare
  me  uuid := (select auth.uid());
  c   public.coach_cards;
  txt text := nullif(btrim(regexp_replace(coalesce(report_coach_card.details, ''), '\s+', ' ', 'g')), '');
  rep_id bigint;
begin
  if me is null or report_coach_card.coach is null or report_coach_card.coach = me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into c from public.coach_cards x where x.user_id = report_coach_card.coach for update;
  if c.user_id is null or c.status not in ('declared', 'verified', 'suspended')
     or not private.is_coach(c.user_id) or private.blocked_between(me, c.user_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.reports r where r.reporter_id = me and r.target_user = c.user_id
               and r.target_ref = 'coach_card' and r.created_at >= c.declared_at) then
    return null;
  end if;
  insert into public.reports (reporter_id, target_user, kind, target_ref, reason, details)
    values (me, c.user_id, 'profile', 'coach_card', 'autre',
            left('Badge « Carte pro déclarée » signalé' || coalesce(' : ' || txt, ''), 500))
    returning id into rep_id;
  if c.status <> 'suspended' and private.coach_card_reporters(c.user_id) >= 2 then
    update public.coach_cards x set status = 'suspended', suspended_at = now() where x.user_id = c.user_id;
  end if;
  return rep_id;
end
$$;

-- ── Administration (rôle postgres, éditeur SQL) ──────────

-- Revue faite, badge rendu (vérifié s'il l'était)
create function private.coach_card_restore(uid uuid, note text default null) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
begin
  update public.coach_cards c
     set status = case when c.verified_at is not null then 'verified' else 'declared' end,
         suspended_at = null, reviewed_at = now(), admin_note = left(coach_card_restore.note, 500)
   where c.user_id = uid and c.status = 'suspended';
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  return private.coach_card_json(uid);
end
$$;

-- Badge retiré (usurpation, carte expirée) : plus de nouvelle déclaration sans l'administrateur
create function private.coach_card_remove(uid uuid, reason text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
begin
  update public.coach_cards c
     set status = 'removed', removed_at = now(), removed_reason = left(coach_card_remove.reason, 500),
         reviewed_at = now(), verified_at = null, verify_method = null
   where c.user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  return private.coach_card_json(uid);
end
$$;

-- Badges à revoir : suspendus, ou signalés une fois depuis la déclaration ou la dernière revue. fiche : la
-- page officielle de la carte (photo, nom, diplômes, validité), à comparer à la photo de profil du coach.
create view private.coach_cards_review as
  select c.user_id, p.username, c.card_number, c.status, c.declared_at, c.suspended_at,
         private.coach_card_reporters(c.user_id) as reporters,
         'https://recherche-educateur.sports.gouv.fr/CartePro/' || c.card_number as fiche
    from public.coach_cards c left join public.user_profiles p using (user_id)
   where c.status = 'suspended' or (c.status in ('declared', 'verified') and private.coach_card_reporters(c.user_id) >= 1)
   order by c.status = 'suspended' desc, c.suspended_at, c.declared_at;

-- ── Droits ───────────────────────────────────────────────

revoke all on private.coach_cards_review from public, anon, authenticated, service_role;
revoke all on function private.coach_card_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.coach_card_shown(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.coach_card_reporters(uuid) from public, anon, authenticated, service_role;
revoke all on function private.coach_card_restore(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.coach_card_remove(uuid, text) from public, anon, authenticated, service_role;

revoke all on function public.coach_card_state() from public, anon, authenticated;
revoke all on function public.coach_card_declare(text) from public, anon, authenticated;
revoke all on function public.coach_card_withdraw() from public, anon, authenticated;
revoke all on function public.coach_card_badge(uuid) from public, anon, authenticated;
revoke all on function public.report_coach_card(uuid, text) from public, anon, authenticated;

grant execute on function public.coach_card_state() to authenticated;
grant execute on function public.coach_card_declare(text) to authenticated;
grant execute on function public.coach_card_withdraw() to authenticated;
grant execute on function public.coach_card_badge(uuid) to authenticated;
grant execute on function public.report_coach_card(uuid, text) to authenticated;
