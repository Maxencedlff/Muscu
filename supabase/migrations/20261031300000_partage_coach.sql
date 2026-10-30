-- ═══════════════════════════════════════════════════════════
--  Partage avec le coach (30/10/2026) : l'élève choisit, donnée par donnée, ce que son coach voit
--  en plus de ses séances. Aujourd'hui : le poids du corps (pesées saisies dans l'app). Prévu dans le
--  modèle, pas encore ouvert : sommeil, pas, fréquence cardiaque au repos (build HealthKit).
--  Contrat : docs/COACH_V1.md, « Partage avec le coach ».
--
--  Sécurité (données de santé et forme, consentement explicite) :
--  - Consentement : public.coach_shares (student_id, coach_id, kind, granted_at), une ligne par élève
--    et par donnée, horodatée, pour le coach ACTUEL : clé étrangère vers le lien coach_links
--    (student_id, coach_id) on delete cascade. Quitter le coach, être retiré, supprimer son compte ou
--    celui du coach supprime le consentement dans la même transaction. Tout est décoché par défaut :
--    sans ligne, rien n'est partagé.
--  - Données : public.coach_shared_weights (student_id, at, kg), SÉPARÉES des séances (jamais dans
--    sessions.data), clé étrangère vers le consentement (student_id, 'weight') on delete cascade :
--    couper la case (ou perdre le lien) efface toutes les pesées envoyées, historique compris. Le coach
--    n'en garde aucune copie côté serveur. Une pesée ne peut exister que sous un consentement actif.
--  - Envoi : student_share_weights refuse (not_shared) sans consentement actif ; il remplace toute la
--    liste (miroir des pesées de l'appareil), 400 pesées au plus, bornées (25 à 300 kg, dates passées).
--  - Lecture : seul le coach consenti, encore coach, lit (coach_student_weights) ; un autre coach, un
--    ami, l'élève lui-même par cette fonction : not_found. Rien pour les amis : private.session_public
--    et le fil ne changent pas.
--  - bodyKg d'une séance vue par le coach : private.coach_session_body vérifie le consentement poids
--    à chaque appel (coach, élève, kind = 'weight') et donne la dernière pesée partagée à la date de la
--    séance (au plus tard done_at). Sans consentement : rien (la séance est celle d'avant).
--  - Aucune lecture ni écriture directe : RLS activée sans politique, aucun GRANT sur les tables ; RPC
--    security definer, search_path vide, utilisateur pris dans auth.uid() ; anon n'exécute rien.
--  - Limites : 60 cochages et 60 envois de pesées par heure (private.social_rate), liste de 64 Ko au
--    plus ; décocher n'est jamais limité (retirer son accord doit rester aussi simple que le donner).
--  - Rôle de coach retiré par l'administrateur : il ne lit plus rien (coach_require_student), mais le
--    consentement et les pesées restent tant que le lien existe ; l'élève peut décocher ou quitter.
--
--  Réversible : drop des 5 fonctions nouvelles et des 2 tables, et coach_student_sessions remise à sa
--  version de 20261027100000_coach.sql (bloc en bas de ce fichier, en commentaire).
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- Consentements : une ligne = « mon coach actuel voit cette donnée », depuis granted_at.
-- kind : 'weight' ouvert ; 'sleep', 'steps', 'resting_hr' prévus (refusés par la RPC tant qu'ils ne sont
-- pas ouverts, voir private.share_kind_open).
create table public.coach_shares (
  student_id uuid not null,
  coach_id   uuid not null,
  kind       text not null check (kind in ('weight', 'sleep', 'steps', 'resting_hr')),
  granted_at timestamptz not null default now(),
  primary key (student_id, kind),
  foreign key (student_id, coach_id) references public.coach_links (student_id, coach_id) on delete cascade
);
create index coach_shares_coach on public.coach_shares (coach_id, student_id);

-- Pesées partagées (date en ms comme sessions.done_at, kg). Une pesée par instant ; jamais sans
-- consentement (clé étrangère vers coach_shares, kind fixé à 'weight').
create table public.coach_shared_weights (
  student_id uuid not null,
  kind       text not null default 'weight' check (kind = 'weight'),
  at         bigint not null check (at > 946684800000),   -- après le 1er janvier 2000
  kg         numeric(5, 2) not null check (kg between 25 and 300),
  primary key (student_id, at),
  foreign key (student_id, kind) references public.coach_shares (student_id, kind) on delete cascade
);

alter table public.coach_shares enable row level security;
alter table public.coach_shared_weights enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.coach_shares, public.coach_shared_weights from public, anon, authenticated, service_role;

-- ── Briques privées ──────────────────────────────────────

-- Données que l'élève peut cocher aujourd'hui (les autres attendent la build HealthKit)
create function private.share_kind_open(kind text) returns boolean
  language sql immutable set search_path = '' as
$$ select kind = 'weight' $$;

-- L'élève a-t-il donné cette donnée à CE coach ?
create function private.coach_has_share(coach uuid, student uuid, kind text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.coach_shares c
                 where c.student_id = student and c.coach_id = coach and c.kind = coach_has_share.kind)
$$;

-- Ajout à la liste blanche d'une séance vue par le coach : { bodyKg } seulement si l'élève partage son
-- poids avec ce coach, = la dernière pesée partagée au plus tard à la date de la séance ; sinon {}
create function private.coach_session_body(coach uuid, student uuid, done_at bigint) returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select coalesce((
    select jsonb_build_object('bodyKg', w.kg)
    from public.coach_shared_weights w
    where private.coach_has_share(coach, student, 'weight')
      and w.student_id = student and w.at <= done_at
    order by w.at desc limit 1), '{}'::jsonb)
$$;

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- Élève : ce que je partage avec mon coach actuel. { coach: bool, shares: { weight: { granted_at, n,
-- last_at } } } ; shares ne contient que les données cochées ; n et last_at : pesées envoyées.
create function public.student_shares() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id),
  l as (select cl.student_id, cl.coach_id from me join public.coach_links cl on cl.student_id = me.id)
  select jsonb_build_object(
    'coach', exists (select 1 from l),
    'shares', coalesce((
      select jsonb_object_agg(c.kind, jsonb_build_object(
        'granted_at', c.granted_at,
        'n',       (select count(*)::int from public.coach_shared_weights w where w.student_id = c.student_id and c.kind = 'weight'),
        'last_at', (select max(w.at) from public.coach_shared_weights w where w.student_id = c.student_id and c.kind = 'weight')))
      from l join public.coach_shares c on c.student_id = l.student_id and c.coach_id = l.coach_id), '{}'::jsonb))
$$;

-- Élève : cocher (enabled = true) ou décocher une donnée pour mon coach actuel. Décocher efface tout ce
-- qui a été envoyé (cascade). Cocher ce qui l'est déjà garde la date d'origine. Renvoie student_shares().
-- Sans coach : not_found ; donnée inconnue ou pas encore ouverte : invalid_kind.
create function public.student_set_share(kind text, enabled boolean) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  coach uuid;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if kind is null or not private.share_kind_open(kind) or enabled is null then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  select l.coach_id into coach from public.coach_links l where l.student_id = me;
  if coach is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  -- Limite sur le cochage seulement : retirer son accord reste toujours possible (RGPD, art. 7.3)
  if enabled then
    perform private.rate_limit_window(me, 'coach_share', 60, interval '1 hour');
    begin
      insert into public.coach_shares (student_id, coach_id, kind) values (me, coach, student_set_share.kind)
        on conflict on constraint coach_shares_pkey do nothing;
    exception when foreign_key_violation then
      raise exception 'not_found' using errcode = 'P0001';   -- lien supprimé entre-temps
    end;
  else
    delete from public.coach_shares c where c.student_id = me and c.kind = student_set_share.kind;
  end if;
  return public.student_shares();
end
$$;

-- Élève : envoyer mes pesées (remplace toute la liste envoyée : miroir de l'appareil). weights =
-- [{ date: ms, kg }], 400 au plus. Renvoie le nombre gardé. Sans consentement poids : not_shared ;
-- liste mal formée : invalid_data ; plus de 400 : too_long. Deux pesées au même instant : la dernière.
create function public.student_share_weights(weights jsonb) returns int
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  n int;
begin
  -- Un envoi à la fois par élève (deux appareils, ou un cochage et une pesée saisie en même temps) :
  -- le second attend que le premier soit validé, puis remplace sa liste (jamais de clé en double, 23505)
  if me is not null then perform pg_advisory_xact_lock(hashtextextended('coach_share_weights:' || me::text, 0)); end if;
  if me is null or not exists (select 1 from public.coach_shares c where c.student_id = me and c.kind = 'weight') then
    raise exception 'not_shared' using errcode = 'P0001';
  end if;
  if weights is null or jsonb_typeof(weights) <> 'array' then
    raise exception 'invalid_data' using errcode = 'P0001';
  end if;
  if jsonb_array_length(weights) > 400 or octet_length(weights::text) > 65536 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;
  -- Chaque élément : objet { date: entier > 2000-01-01 et pas dans le futur (+24 h), kg : 25 à 300 }
  -- (CASE : les conversions ne sont tentées que sur des nombres, l'ordre d'un OR n'étant pas garanti)
  if exists (select 1 from jsonb_array_elements(weights) e
             where case when jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'date') = 'number'
                             and jsonb_typeof(e -> 'kg') = 'number'
                        then (e ->> 'date')::numeric <> trunc((e ->> 'date')::numeric)
                             or (e ->> 'date')::numeric <= 946684800000 or (e ->> 'date')::numeric > private.max_done_at()
                             or (e ->> 'kg')::numeric < 25 or (e ->> 'kg')::numeric > 300
                        else true end) then
    raise exception 'invalid_data' using errcode = 'P0001';
  end if;
  perform private.rate_limit_window(me, 'coach_share_up', 60, interval '1 hour');
  delete from public.coach_shared_weights w where w.student_id = me;
  insert into public.coach_shared_weights (student_id, at, kg)
    select distinct on (x.at) me, x.at, x.kg
    from (select (e ->> 'date')::bigint as at, round((e ->> 'kg')::numeric, 2) as kg, o
          from jsonb_array_elements(weights) with ordinality as t(e, o)) x
    order by x.at, x.o desc;
  get diagnostics n = row_count;
  return n;
end
$$;

-- Coach : pesées partagées par un de mes élèves. { shared: bool, since: granted_at | null, weights:
-- [{ date, kg }] du plus récent au plus ancien }. Pas mon élève, ou plus coach : not_found.
-- Élève qui ne partage pas (ou plus) : shared false, weights vide.
create function public.coach_student_weights(student uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  since timestamptz;
begin
  perform private.coach_require_student(me, student);
  select c.granted_at into since from public.coach_shares c
    where c.student_id = student and c.coach_id = me and c.kind = 'weight';
  if since is null then
    return jsonb_build_object('shared', false, 'since', null, 'weights', '[]'::jsonb);
  end if;
  return jsonb_build_object('shared', true, 'since', since, 'weights', coalesce((
    select jsonb_agg(jsonb_build_object('date', w.at, 'kg', w.kg) order by w.at desc)
    from public.coach_shared_weights w where w.student_id = student), '[]'::jsonb));
end
$$;

-- Séances d'un de mes élèves (même contrat que 20261027100000_coach.sql) ; s gagne bodyKg seulement si
-- l'élève me partage son poids (private.coach_session_body).
create or replace function public.coach_student_sessions(student uuid, before_at bigint default null, before_id text default null)
  returns table (id text, done_at bigint, s jsonb, note text)
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  perform private.coach_require_student(me, student);
  return query
    select x.id, x.done_at, private.session_for_coach(x.id, x.data) || private.coach_session_body(me, student, x.done_at), n.text
    from public.sessions x
    left join public.coach_notes n on n.student_id = x.user_id and n.session_id = x.id and n.coach_id = me
    where x.user_id = student and x.deleted_at is null and x.done_at is not null
      and x.done_at <= private.max_done_at()
      and (before_at is null
           or x.done_at < before_at
           or (before_id is not null and x.done_at = before_at and x.id < before_id))
    order by x.done_at desc, x.id desc
    limit 30;
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.share_kind_open(text) from public, anon, authenticated, service_role;
revoke all on function private.coach_has_share(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.coach_session_body(uuid, uuid, bigint) from public, anon, authenticated, service_role;

revoke all on function public.student_shares() from public, anon, authenticated;
revoke all on function public.student_set_share(text, boolean) from public, anon, authenticated;
revoke all on function public.student_share_weights(jsonb) from public, anon, authenticated;
revoke all on function public.coach_student_weights(uuid) from public, anon, authenticated;
revoke all on function public.coach_student_sessions(uuid, bigint, text) from public, anon, authenticated;

grant execute on function public.student_shares() to authenticated;
grant execute on function public.student_set_share(text, boolean) to authenticated;
grant execute on function public.student_share_weights(jsonb) to authenticated;
grant execute on function public.coach_student_weights(uuid) to authenticated;
grant execute on function public.coach_student_sessions(uuid, bigint, text) to authenticated;

-- ── Retour en arrière (à lancer à la main, rôle postgres) ─
-- 1. Recréer d'abord public.coach_student_sessions telle qu'elle est dans 20261027100000_coach.sql
--    (s = private.session_for_coach(x.id, x.data)), avec ses revoke et grant : la version ci-dessus
--    appelle private.coach_session_body (plpgsql ne suit pas cette dépendance).
-- 2. drop function public.student_shares(), public.student_set_share(text, boolean),
--      public.student_share_weights(jsonb), public.coach_student_weights(uuid),
--      private.coach_session_body(uuid, uuid, bigint), private.coach_has_share(uuid, uuid, text),
--      private.share_kind_open(text);
-- 3. drop table public.coach_shared_weights, public.coach_shares;   (efface les pesées partagées)
