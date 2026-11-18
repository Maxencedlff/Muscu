-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261118010000_suivi_diete_coach.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide de retirer le suivi de la diète par le coach). Pas dans
--  migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Avant : revenir à une version de l'app qui n'appelle plus student_share_diet_days, coach_student_diet ni
--  coach_diet_overview (une app plus récente sur ce serveur cache la case « Suivi de ma diète » : elle n'est
--  plus dans student_shares().kinds, et la carte Diète du coach ne s'affiche pas).
--
--  Effet : les consentements 'diet_log' (public.coach_shares) et tous les jours de diète partagés
--  (public.coach_shared_diet_days) sont SUPPRIMÉS : le coach n'en voit plus aucun, ce qui respecte le retrait
--  du consentement. La purge quotidienne pg_cron est retirée. La contrainte de coach_shares.kind,
--  private.share_kind_open et student_shares reprennent le texte de 20261106200000_plans_diete_coach.sql. Les
--  lignes « coach_share_dup » du journal private.social_rate sont retirées.
--
--  Ordre : à défaire AVANT 20261106200000_plans_diete_coach_down.sql (vérifié par tests/sql/rollback_nuit_check.sh).
-- ═══════════════════════════════════════════════════════════

begin;

drop function public.student_share_diet_days(jsonb);
drop function public.coach_student_diet(uuid);
drop function public.coach_diet_overview();

-- Consentements « diet_log » : supprimés (cascade : jours partagés), puis la table vide
delete from public.coach_shares c where c.kind = 'diet_log';
drop function private.diet_day_json(public.coach_shared_diet_days);
drop table public.coach_shared_diet_days;
drop function private.diet_day_ok(jsonb);
drop function private.diet_int_ok(jsonb, numeric, numeric, boolean);
drop function private.diet_num_ok(jsonb, numeric, numeric, boolean);
drop function private.diet_name_ok(jsonb, boolean);
drop function private.diet_share_first_day();

alter table public.coach_shares drop constraint coach_shares_kind_check;
alter table public.coach_shares add constraint coach_shares_kind_check
  check (kind in ('weight', 'sleep', 'steps', 'resting_hr', 'measures', 'diet'));

-- Textes de 20261106200000_plans_diete_coach.sql
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

revoke all on function private.share_kind_open(text) from public, anon, authenticated, service_role;
revoke all on function public.student_shares() from public, anon, authenticated;
grant execute on function public.student_shares() to authenticated;

delete from private.social_rate r where r.action = 'coach_share_dup';

-- Purge quotidienne (seulement là où pg_cron existe)
do $cron$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-diete-coach-90-jours';
  end if;
end
$cron$;

commit;
