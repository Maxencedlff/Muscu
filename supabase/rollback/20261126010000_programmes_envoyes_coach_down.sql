-- Retour arrière de supabase/migrations/20261126010000_programmes_envoyes_coach.sql (à lancer à la main, rôle postgres).
-- Ne touche à aucune donnée : la fonction ne fait que lire. L'appli web revient d'elle-même à la version du programme
-- gardée sur le compte du coach. Les lignes « coach_progs_read » de private.social_rate s'effacent d'elles-mêmes (fenêtre d'une heure).
drop function if exists public.coach_student_programmes(uuid);
