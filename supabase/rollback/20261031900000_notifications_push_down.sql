-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031900000_notifications_push.sql (à lancer à la main,
--  dans l'éditeur SQL, seulement si Maxence décide d'annuler les notifications push). Pas dans
--  migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Effet : jetons d'appareils, réglages et file d'envoi supprimés ; les déclencheurs sur bravos, follows,
--  coach_notes et coach_programmes retirés. Les tables du social et du coach ne changent pas : aucune
--  ligne n'y est touchée. Avant : couper la planification de push-send (docs/BUILD.md), sinon elle
--  appellerait des fonctions disparues (sans danger : erreur 404 de la RPC, rien n'est envoyé).
--  Vérifié par tests/sql/rollback_push_check.sh (migrations, retour arrière, puis les tests d'origine).
-- ═══════════════════════════════════════════════════════════

begin;

drop trigger if exists bravos_push on public.bravos;
drop trigger if exists follows_push on public.follows;
drop trigger if exists coach_notes_push on public.coach_notes;
drop trigger if exists coach_programmes_push on public.coach_programmes;

drop function if exists public.push_register(text, text);
drop function if exists public.push_unregister(text);
drop function if exists public.push_set_prefs(boolean, boolean, boolean);
drop function if exists public.push_prefs();
drop function if exists public.push_claim(int);
drop function if exists public.push_done(bigint[], text[]);
drop function if exists private.push_on_bravo();
drop function if exists private.push_on_follow();
drop function if exists private.push_on_coach_note();
drop function if exists private.push_on_coach_programme();
drop function if exists private.push_enqueue(uuid, text, uuid, text);
drop function if exists private.push_wanted(uuid, text);

drop table if exists private.push_outbox;
drop table if exists public.push_prefs;
drop table if exists public.push_devices;

commit;
