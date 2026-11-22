-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261122010000_forme_coach.sql (à lancer à la main, dans l'éditeur SQL,
--  seulement si Maxence décide de l'annuler). Pas dans migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Effet : les formes choisies par les coachs sont effacées. L'app à jour reste utilisable : elle écrit « ton coach »
--  comme avant (coach_form absent : forme inconnue), le choix dans Réglages › Coach reste gardé sur l'appareil du
--  coach sans partir ; push-send revient à « Commentaire du coach » (push_actor_forms absent : ignoré). Ne dépend
--  d'aucune autre migration, aucune n'en dépend.
-- ═══════════════════════════════════════════════════════════

begin;
drop function if exists public.push_actor_forms(bigint[]);
drop function if exists public.coach_form(uuid);
drop function if exists public.coach_set_form(text);
drop table if exists public.coach_forms;
commit;
