-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261105010000_partage_mensurations.sql (à lancer à la main,
--  dans l'éditeur SQL, seulement si Maxence décide de retirer le partage des mensurations). Pas dans
--  migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Avant : revenir à une version de l'app qui n'appelle plus student_share_measures ni
--  coach_student_measures (une app plus récente sur ce serveur cache la case « Mensurations » : elle
--  n'est pas dans student_shares().kinds).
--
--  Effet : les consentements « measures » (public.coach_shares) et toutes les mensurations partagées
--  (public.coach_shared_measures) sont SUPPRIMÉS, historique compris : le coach n'en voit plus aucune,
--  ce qui respecte le retrait du consentement. Le partage du poids reste tel quel : student_shares et
--  private.share_kind_open reprennent leur texte de 20261031300000_partage_coach.sql. Les lignes
--  « coach_share_mup » du journal private.social_rate sont retirées.
--
--  Ordre : à lancer AVANT le retour arrière du partage du poids (20261031300000_partage_coach_down.sql),
--  qui supprime public.coach_shares. Indépendant de la planification.
-- ═══════════════════════════════════════════════════════════

begin;

drop function public.student_share_measures(jsonb);
drop function public.coach_student_measures(uuid);

-- Consentements « measures » : supprimés (cascade : mensurations partagées), puis la table vide
delete from public.coach_shares c where c.kind = 'measures';
drop table public.coach_shared_measures;

alter table public.coach_shares drop constraint coach_shares_kind_check;
alter table public.coach_shares add constraint coach_shares_kind_check
  check (kind in ('weight', 'sleep', 'steps', 'resting_hr'));

-- Textes d'origine (20261031300000_partage_coach.sql)
create or replace function private.share_kind_open(kind text) returns boolean
  language sql immutable set search_path = '' as
$$ select kind = 'weight' $$;

create or replace function public.student_shares() returns jsonb
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
revoke all on function private.share_kind_open(text) from public, anon, authenticated, service_role;
revoke all on function public.student_shares() from public, anon, authenticated;
grant execute on function public.student_shares() to authenticated;

delete from private.social_rate r where r.action = 'coach_share_mup';

commit;
