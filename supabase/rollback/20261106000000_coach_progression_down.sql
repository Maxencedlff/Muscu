-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261106000000_coach_progression.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide de retirer coach_progress). Pas dans migrations/ :
--  Supabase ne l'applique jamais de lui-même.
--
--  Avant : rien. Une app à jour sur ce serveur lit alors les séances des élèves page par page
--  (js/data/coach-progress.js, PGRST202) ; elle continue de marcher.
--
--  Effet : la fonction disparaît. Aucune donnée n'est effacée (la migration n'en crée aucune).
--
--  Ordre : indépendant des autres migrations (aucune n'appelle cette fonction).
--  Vérifié par tests/sql/rollback_nuit_check.sh (seul sur la pile complète, et dans le démontage).
-- ═══════════════════════════════════════════════════════════

begin;

drop function public.coach_progress();

commit;
