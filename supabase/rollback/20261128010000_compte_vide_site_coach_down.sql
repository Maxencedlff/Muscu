-- Retour arrière de supabase/migrations/20261128010000_compte_vide_site_coach.sql (à lancer à la main, rôle postgres).
-- Retirer d'abord la fonction serveur coach-web-orphan (supabase functions delete coach-web-orphan), ou la laisser :
-- sans public.coach_web_orphan_claim elle répond { deleted: false } et ne supprime rien ; le site déconnecte alors
-- quand même le compte tout neuf et affiche le message (le compte vide reste, à supprimer à la main comme avant).
-- Le journal (fournisseur et heure des comptes effacés) part avec la table. Aucun compte n'est touché.
drop function if exists public.coach_web_orphan_claim(uuid, uuid);
drop table if exists private.coach_web_orphans;
