-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261105000000_coach_planning.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide de retirer la planification du coach). Pas dans
--  migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Avant : revenir à une version de l'app qui n'appelle plus coach_plans, student_plan, coach_plan_save
--  ni coach_plan_delete (une app plus récente sur ce serveur cache simplement le planning : PGRST202).
--
--  Effet : le planning de tous les élèves (public.coach_phases) est SUPPRIMÉ ; l'extension btree_gist est
--  retirée si plus rien ne s'en sert. Les lignes « coach_plan »
--  du journal private.social_rate sont retirées.
--
--  Ordre : indépendant des autres migrations (aucune n'appelle ces fonctions ni ne lit cette table).
--  Vérifié par tests/sql/rollback_nuit_check.sh (seul sur la pile complète, et dans le démontage).
-- ═══════════════════════════════════════════════════════════

begin;

drop function public.coach_plans();
drop function public.student_plan();
drop function public.coach_plan_save(uuid, bigint, text, text, date, int, text, text);
drop function public.coach_plan_delete(uuid, bigint);
drop function private.coach_plan_of(uuid, uuid);
drop function private.plan_line(text);
drop function private.plan_note(text);

drop table public.coach_phases;

delete from private.social_rate r where r.action = 'coach_plan';

-- btree_gist : retirée seulement si plus rien ne s'en sert (sinon gardée, sans erreur)
do $$ begin
  drop extension if exists btree_gist;
exception when dependent_objects_still_exist then
  raise notice 'btree_gist gardée : d''autres objets s''en servent';
end $$;

commit;
