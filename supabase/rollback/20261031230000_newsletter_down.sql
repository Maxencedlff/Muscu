-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031230000_newsletter.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide de retirer la lettre d'information). Pas dans
--  migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Effet : les inscriptions sont SUPPRIMÉES (personne ne reçoit plus rien, ce qui respecte les
--  consentements) ; les appels de l'app à newsletter_* échouent alors, et l'écran Compte affiche
--  « Lettre d'information indisponible » sans rien bloquer. Revenir ensuite à une version de l'app
--  sans la cellule. Les lignes « newsletter_subscribe » du journal de débit partent aussi.
--  Vérifié par tests/sql/newsletter_rollback_test.sh (migrations, retour arrière, nouvelle montée).
-- ═══════════════════════════════════════════════════════════

begin;

drop function if exists public.newsletter_unsubscribe_token(uuid);
drop function if exists public.newsletter_recipients();
drop function if exists public.newsletter_unsubscribe();
drop function if exists public.newsletter_subscribe(text);
drop function if exists public.newsletter_state();
drop function if exists private.newsletter_json(uuid);
drop table if exists public.newsletter_subscriptions;
delete from private.social_rate r where r.action = 'newsletter_subscribe';

commit;
