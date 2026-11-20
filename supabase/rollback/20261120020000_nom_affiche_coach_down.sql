-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261120020000_nom_affiche_coach.sql (à lancer à la main, dans l'éditeur
--  SQL, seulement si Maxence décide de l'annuler). Pas dans migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Effet : les noms d'affiche envoyés sont effacés. L'app à jour reste utilisable : Mon coach montre le pseudo seul
--  (coach_poster_name absent : rien n'est montré) et le partage de l'affiche marche (l'envoi du nom échoue sans
--  rien dire). Ne dépend d'aucune autre migration, aucune n'en dépend.
-- ═══════════════════════════════════════════════════════════

begin;
drop function if exists public.coach_poster_name(uuid);
drop function if exists public.coach_set_poster_name(text);
drop table if exists public.coach_poster_names;
commit;
