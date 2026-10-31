-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031620000_strava.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide de retirer Strava). Pas dans migrations/ : Supabase ne
--  l'applique jamais de lui-même.
--
--  Avant : couper les fonctions Edge strava-connect, strava-export et strava-disconnect (supabase
--  functions delete …) et revenir à une version de l'app qui n'appelle pas strava_status. Les accès
--  déjà donnés restent valables chez Strava tant qu'ils ne sont pas révoqués : pour les couper tous,
--  lancer strava-disconnect pour chaque compte relié AVANT ce script (ou laisser chaque personne
--  retirer MDLF Training dans strava.com/settings/apps).
--
--  Effet : liaisons, jetons chiffrés, états OAuth et envois notés effacés ; les activités déjà créées
--  restent sur Strava (elles appartiennent à la personne). Les lignes « strava_connect » et
--  « strava_export » du journal private.social_rate sont retirées.
--  Vérifié par tests/sql/strava_rollback_check.sh (migrations, retour arrière, puis tous les tests).
-- ═══════════════════════════════════════════════════════════

begin;

drop function if exists public.strava_status();
drop function if exists public.strava_state_create(uuid, text);
drop function if exists public.strava_state_consume(text);
drop function if exists public.strava_link_save(uuid, bigint, text, text, text, timestamptz);
drop function if exists public.strava_link_get(uuid);
drop function if exists public.strava_link_tokens(uuid, text, timestamptz);
drop function if exists public.strava_link_delete(uuid);
drop function if exists public.strava_link_holder(bigint);
drop function if exists public.strava_link_release(uuid, bigint, text);
drop function if exists public.strava_export_begin(uuid, text);
drop function if exists public.strava_export_finish(uuid, text, bigint);

drop table if exists private.strava_exports;
drop table if exists private.strava_states;
drop table if exists private.strava_links;

delete from private.social_rate r where r.action in ('strava_connect', 'strava_export');

commit;
