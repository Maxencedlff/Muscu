-- ═══════════════════════════════════════════════════════════
--  Plans diète du coach (06/11/2026) : l'élève accepte de recevoir les plans diète de son coach, comme il
--  accepte de partager son poids (20261031300000_partage_coach.sql). Contrat : docs/NUTRITION_V1.md,
--  « Coach : accord de l'élève ».
--
--  Pourquoi : un plan diète (repas, calories, macros) rapproché du poids et de l'entraînement renseigne sur
--  la santé de l'élève (CNIL ; RGPD, article 9 : consentement explicite). Avant cette migration, un coach
--  pouvait écrire un plan dans coach_programmes sans aucun accord de l'élève.
--
--  - Accord : une ligne public.coach_shares (student_id, coach_id, kind = 'diet', granted_at), donnée par
--    student_set_share('diet', true), retirée par student_set_share('diet', false). Même table, mêmes règles :
--    clé étrangère vers le lien coach_links on delete cascade (quitter, être retiré, supprimer un compte la
--    retire), décocher jamais limité, cocher 60 fois par heure au plus.
--  - Envoi : coach_send_programme refuse un identifiant 'diet_…' (plan diète, canal des programmes) sans
--    cet accord : erreur 'diet_not_accepted'. Les programmes d'entraînement ne changent pas.
--  - Retrait : le déclencheur coach_shares_diet_revoked (after delete, kind 'diet') supprime aussitôt tous
--    les plans diète que le serveur gardait pour l'élève (coach_programmes 'diet_…'). Un plan déjà pris par
--    l'élève est sur son iPhone : il y reste.
--  - Rien d'autre ne change : aucune table nouvelle, aucun GRANT nouveau (student_set_share, student_shares
--    et coach_send_programme gardent les leurs) ; private.share_kind_open accepte 'diet' EN PLUS du poids et des
--    mensurations (20261105010000_partage_mensurations.sql, appliquée avant), et student_shares().kinds l'annonce.
--
--  Réversible : supabase/rollback/20261106200000_plans_diete_coach_down.sql (accords 'diet' supprimés,
--  contrainte, share_kind_open, student_shares et coach_send_programme remis à leur texte d'avant).
-- ═══════════════════════════════════════════════════════════

-- Donnée 'diet' acceptée par la table des accords (en plus des mensurations de 20261105010000)
alter table public.coach_shares drop constraint coach_shares_kind_check;
alter table public.coach_shares add constraint coach_shares_kind_check
  check (kind in ('weight', 'sleep', 'steps', 'resting_hr', 'measures', 'diet'));

-- Données que l'élève peut cocher aujourd'hui : le poids, les mensurations et les plans diète
create or replace function private.share_kind_open(kind text) returns boolean
  language sql immutable set search_path = '' as
$$ select kind in ('weight', 'measures', 'diet') $$;

-- student_shares : texte de 20261105010000_partage_mensurations.sql, 'diet' ajouté aux données annoncées (kinds)
create or replace function public.student_shares() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id),
  l as (select cl.student_id, cl.coach_id from me join public.coach_links cl on cl.student_id = me.id)
  select jsonb_build_object(
    'coach', exists (select 1 from l),
    'kinds', (select jsonb_agg(k order by o) from unnest(array['weight', 'sleep', 'steps', 'resting_hr', 'measures', 'diet']) with ordinality as t(k, o)
              where private.share_kind_open(k)),
    'shares', coalesce((
      select jsonb_object_agg(c.kind, jsonb_build_object(
        'granted_at', c.granted_at,
        'n', case c.kind
               when 'weight' then (select count(*)::int from public.coach_shared_weights w where w.student_id = c.student_id)
               when 'measures' then (select count(*)::int from public.coach_shared_measures m where m.student_id = c.student_id)
               else 0 end,
        'last_at', case c.kind
               when 'weight' then (select max(w.at) from public.coach_shared_weights w where w.student_id = c.student_id)
               when 'measures' then (select max(m.at) from public.coach_shared_measures m where m.student_id = c.student_id)
               end))
      from l join public.coach_shares c on c.student_id = l.student_id and c.coach_id = l.coach_id), '{}'::jsonb))
$$;

-- Envoyer (ou mettre à jour) un programme à un de mes élèves ; seen_at remis à null. 30 par 24 h.
-- Plan diète (prog_id 'diet_…') : seulement si l'élève a accepté les plans diète de ce coach.
create or replace function public.coach_send_programme(student uuid, prog_id text, data jsonb) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or not private.is_coach(me) then
    raise exception 'not_coach' using errcode = 'P0001';
  end if;
  perform private.coach_require_student(me, student);
  if prog_id is null or prog_id !~ '^[A-Za-z0-9_-]{1,64}$' or data is null or jsonb_typeof(data) <> 'object' then
    raise exception 'invalid_programme' using errcode = 'P0001';
  end if;
  if octet_length(data::text) > 204800 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;
  -- Imbriqué : l'accord n'est lu que pour un plan diète
  if prog_id like 'diet\_%' then
    if not private.coach_has_share(me, student, 'diet') then
      raise exception 'diet_not_accepted' using errcode = 'P0001';
    end if;
  end if;
  perform private.rate_limit_window(me, 'coach_send', 30, interval '24 hours');
  begin
    insert into public.coach_programmes (student_id, coach_id, id, data, sent_at)
      values (student, me, prog_id, data, clock_timestamp())
      on conflict on constraint coach_programmes_pkey do update
        set data = excluded.data, coach_id = excluded.coach_id, sent_at = excluded.sent_at, seen_at = null;
  exception when foreign_key_violation then
    -- L'élève est parti entre la vérification et l'écriture
    raise exception 'not_found' using errcode = 'P0001';
  end;
end
$$;

-- Accord retiré (décoché, lien rompu, compte supprimé) : les plans diète gardés pour l'élève sont effacés
create function private.coach_shares_diet_revoked() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  delete from public.coach_programmes p where p.student_id = old.student_id and p.id like 'diet\_%';
  return null;
end
$$;
create trigger coach_shares_diet_revoked after delete on public.coach_shares
  for each row when (old.kind = 'diet') execute function private.coach_shares_diet_revoked();

revoke all on function private.coach_shares_diet_revoked() from public, anon, authenticated, service_role;
revoke all on function public.coach_send_programme(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.coach_send_programme(uuid, text, jsonb) to authenticated;
