-- Retour arrière de supabase/migrations/20261124010000_semaines_coach.sql (à lancer à la main, rôle postgres).
-- Ne touche à aucune donnée : la fonction ne fait que lire. L'appli web revient d'elle-même aux lectures une par une.
drop function if exists public.coach_student_weeks(uuid, integer);
