-- Retour arrière de supabase/migrations/20261127040000_photos_web_appairage.sql (à lancer à la main, rôle postgres).
-- Efface les appairages en cours et les ordinateurs reliés (leurs enveloppes) : chaque ordinateur perd l'accès aux
-- photos à sa prochaine ouverture (« Cet ordinateur n'est plus relié »). Les photos, les clés des coachs et l'app
-- iPhone ne sont pas touchées. Le site d'avant (sans « Relier cet ordinateur ») d'abord, si possible. Les lignes
-- « coach_photo_pair » et « coach_photo_device » de private.social_rate s'effacent d'elles-mêmes (fenêtre d'une heure).
-- Indépendant des autres retours arrière ; lançable aussi après celui des photos de bilan (déclencheur déjà parti).
drop function if exists public.coach_photo_device_revoke(uuid);
drop function if exists public.coach_photo_device_key(uuid);
drop function if exists public.coach_photo_devices();
drop function if exists public.coach_photo_pair_cancel(uuid);
drop function if exists public.coach_photo_pair_status(uuid);
drop function if exists public.coach_photo_pair_complete(uuid, text, text, text);
drop function if exists public.coach_photo_pair_offer(uuid, text, text);
drop function if exists public.coach_photo_pair_peek(uuid);
drop function if exists public.coach_photo_pair_start(text, text, text);
do $$ begin
  if to_regclass('public.coach_photo_keys') is not null then
    drop trigger if exists coach_photo_devices_key_gone on public.coach_photo_keys;
  end if;
end $$;
drop function if exists private.coach_photo_key_gone();
drop function if exists private.coach_photo_link_purge(uuid);
drop function if exists private.coach_photo_link_me();
drop function if exists private.coach_photo_label(text);
drop table if exists public.coach_photo_devices;
drop table if exists public.coach_photo_pairings;
