-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261107000000_photos_bilan.sql (à lancer à la main, dans l'éditeur
--  SQL, seulement si Maxence décide de retirer l'envoi des photos de bilan). Pas dans migrations/ : Supabase ne
--  l'applique jamais de lui-même.
--
--  Avant :
--  1. Revenir à une version de l'app qui n'appelle plus ces fonctions (une app plus récente sur ce serveur ne
--     montre simplement plus les photos : PGRST202).
--  2. Vider le compartiment coach-photos par l'API Storage : tableau de bord (Storage › coach-photos › tout
--     sélectionner › Supprimer) ou la fonction coach-photos-purge après avoir effacé les lignes. Le SQL ne sait
--     pas effacer les fichiers eux-mêmes (verrou storage.protect_delete de Supabase, et un fichier dont la ligne
--     disparaît resterait orphelin dans le stockage). Ce fichier refuse de tourner (exception, rien ne change)
--     tant qu'il reste un fichier dans le compartiment.
--
--  La planification de la purge (tâche pg_cron « coach-photos-purge ») et son secret (Vault « photos_purge_secret »)
--  sont retirés ici, s'ils existent. Restent à la main : la fonction serveur (supabase functions delete
--  coach-photos-purge) et son secret d'environnement (supabase secrets unset PHOTOS_PURGE_SECRET).
--
--  Effet : les photos envoyées (public.coach_photos, ce qui sert à les déchiffrer), les clés des coachs
--  (public.coach_photo_keys), les déclarations « 18 ans ou plus » (public.coach_photo_adults) et la file de purge sont SUPPRIMÉES, avec l'interrupteur app_config « coach_photos_on » ; le compartiment vide, ses trois politiques
--  et le schéma coach_photo_rls aussi. Les lignes « coach_photo » et « coach_photo_key » du journal
--  private.social_rate sont retirées. Les secrets des coachs restent dans leur trousseau iCloud (32 octets
--  chacun, inutilisables sans la clé chiffrée, qui est effacée ici).
--
--  Ordre : indépendant des autres retours arrière (aucune autre migration ne s'appuie sur celle-ci) ; à lancer
--  avant ceux du coach (20261027100000) et des liens (coach_links), dont il dépend.
-- ═══════════════════════════════════════════════════════════

begin;

do $$
begin
  if exists (select 1 from storage.objects o where o.bucket_id = 'coach-photos') then
    raise exception 'Il reste des fichiers dans coach-photos : vide-le d''abord par l''API Storage (en-tête de ce fichier)';
  end if;
end
$$;

-- Planification de la purge et son secret (docs/PHOTOS_BILAN.md, « Mise en production ») : sans eux, la tâche
-- appellerait chaque heure une fonction qui n'a plus rien à purger. Absents (Postgres local, planification pas
-- encore posée) : rien. Tests séparés : cron.job et vault.secrets n'existent pas sans leur extension.
do $cron$
begin
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'coach-photos-purge') then
      perform cron.unschedule('coach-photos-purge');
    end if;
  end if;
  if to_regclass('vault.secrets') is not null then
    delete from vault.secrets where name = 'photos_purge_secret';
  end if;
end
$cron$;

drop policy coach_photos_insert on storage.objects;
drop policy coach_photos_select on storage.objects;
drop policy coach_photos_delete on storage.objects;

drop function public.srv_coach_photo_purge_claim(int);
drop function public.srv_coach_photo_purge_done(text[]);
drop function public.coach_student_photos(uuid);
drop function public.coach_photo_hide(uuid);
drop function public.student_photo_adult();
drop function public.student_photo_remove(uuid);
drop function public.student_photo_commit(uuid);
drop function public.student_photo_prepare(uuid, text, date, text, text, text);
drop function public.student_photo_state();
drop function public.coach_photo_key_set(text, text, text, text, boolean);
drop function public.coach_photo_key();

drop function coach_photo_rls.can_upload(text);
drop function coach_photo_rls.can_read(text);
drop schema coach_photo_rls;

drop table public.coach_photos;   -- son déclencheur part avec elle
drop table public.coach_photo_keys;
drop table public.coach_photo_adults;
drop table private.coach_photo_trash;
drop function private.coach_photo_trashed();
drop function private.coach_photo_path(uuid, uuid);
drop function private.b64_bytes(text);
drop function private.coach_photos_on();
delete from public.app_config c where c.key = 'coach_photos_on';

-- Compartiment vide (vérifié plus haut) : rien ne peut rester orphelin, le verrou de Supabase est levé pour
-- cette seule transaction
set local storage.allow_delete_query = 'true';
delete from storage.buckets b where b.id = 'coach-photos';

delete from private.social_rate r where r.action in ('coach_photo', 'coach_photo_key');

commit;
