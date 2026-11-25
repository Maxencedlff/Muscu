-- Retour arrière de supabase/migrations/20261127010000_blocage_coupe_coach.sql (à lancer à la main, rôle postgres).
-- Retire les deux déclencheurs et leurs fonctions : un blocage ne coupe plus le lien coach, et deux comptes bloqués
-- peuvent de nouveau se relier par un code. Les liens déjà coupés (et tout ce que leur cascade a effacé :
-- programmes, notes, partages, messages, phases, photos, bilans) NE REVIENNENT PAS : l'élève doit rejoindre son
-- coach avec un nouveau code. Rien d'autre n'est touché.
begin;
drop trigger if exists blocks_cut_coach on public.blocks;
drop trigger if exists coach_links_not_blocked on public.coach_links;
drop function if exists private.block_cuts_coach();
drop function if exists private.coach_link_not_blocked();
commit;
