-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261117000000_photo_profil.sql (à lancer à la main, dans l'éditeur SQL,
--  seulement si Maxence décide de retirer la photo de profil). Pas dans migrations/ : Supabase ne l'applique jamais
--  de lui-même.
--
--  Avant :
--  1. Une app qui ne trouve plus ces fonctions n'affiche simplement plus de photo (PGRST202 : emoji ou initiale) ;
--     rien à republier d'abord. Pour couper sans rien retirer : interrupteur app_config « profile_photos_on » à false.
--  2. Vider le compartiment profile-photos par l'API Storage : tableau de bord (Storage › profile-photos › tout
--     sélectionner › Supprimer), ou effacer les lignes (delete from public.profile_photos) puis appeler la fonction
--     coach-photos-purge. Le SQL ne sait pas effacer les fichiers eux-mêmes (verrou storage.protect_delete de
--     Supabase). Ce fichier refuse de tourner (exception, rien ne change) tant qu'il reste un fichier.
--  3. La fonction coach-photos-purge déployée avec la photo de profil appelle srv_profile_photo_purge_claim : la
--     redéployer dans sa version d'avant (git show <commit d'avant>:supabase/functions/coach-photos-purge/index.ts),
--     sinon chaque passage horaire signale un échec sur ce deuxième compartiment (les photos de bilan, elles,
--     continuent d'être purgées : les deux compartiments sont traités séparément).
--
--  Effet : les photos (public.profile_photos), les interdictions (private.profile_photo_bans), la file de purge,
--  l'interrupteur, le compartiment vide, ses trois politiques, le schéma profile_photo_rls, le déclencheur sur
--  public.reports et private.pro_feature sont SUPPRIMÉS. Les signalements de photos restent dans public.reports
--  (purgés à 12 mois comme les autres). Les lignes « profile_photo » du journal private.social_rate sont retirées.
-- ═══════════════════════════════════════════════════════════

begin;

do $$
begin
  if exists (select 1 from storage.objects o where o.bucket_id = 'profile-photos') then
    raise exception 'Il reste des fichiers dans profile-photos : vide-le d''abord par l''API Storage (en-tête de ce fichier)';
  end if;
end
$$;

drop policy profile_photos_insert on storage.objects;
drop policy profile_photos_select on storage.objects;
drop policy profile_photos_delete on storage.objects;

drop trigger reports_profile_photo on public.reports;

drop function public.srv_profile_photo_purge_claim(int);
drop function public.srv_profile_photo_purge_done(text[]);
drop function public.profile_photos(uuid[]);
drop function public.profile_photo_remove();
drop function public.profile_photo_commit(uuid);
drop function public.profile_photo_prepare();
drop function public.profile_photo_state();
drop function private.profile_photo_moderate(uuid, text, text);

drop function profile_photo_rls.can_upload(text);
drop function profile_photo_rls.can_read(text);
drop schema profile_photo_rls;

drop table public.profile_photos;   -- son déclencheur part avec elle
drop table private.profile_photo_bans;
drop table private.profile_photo_trash;
drop function private.profile_photo_trashed();
drop function private.profile_photo_reported();
drop function private.profile_photo_visible(uuid, uuid);
drop function private.profile_photo_allowed(uuid);
drop function private.profile_photo_path(uuid, uuid);
drop function private.profile_photos_on();
drop function private.pro_feature(uuid);
delete from public.app_config c where c.key = 'profile_photos_on';

-- Compartiment vide (vérifié plus haut) : le verrou de Supabase est levé pour cette seule transaction
set local storage.allow_delete_query = 'true';
delete from storage.buckets b where b.id = 'profile-photos';

delete from private.social_rate r where r.action = 'profile_photo';

commit;
