-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261117090000_badge_carte_pro.sql (à lancer à la main, dans
--  l'éditeur SQL, sur décision de Maxence). Pas dans migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Avant : revenir à une version de l'app sans le badge, ou la garder (une app plus récente sur ce serveur ne
--  montre simplement plus le badge : les RPC coach_card_* répondent PGRST202, l'app cache la section).
--
--  Effet : les déclarations (public.coach_cards : numéros, dates, suspensions, retraits) sont SUPPRIMÉES, avec
--  leurs fonctions et la vue de revue ; les lignes « coach_card » du journal des limites (private.social_rate)
--  aussi. Les signalements déjà faits restent dans public.reports (target_ref = 'coach_card') : ils sont la
--  trace de la modération et suivent la purge commune à 12 mois.
--  Ordre : indépendant (aucune autre migration ne s'appuie sur celle-ci).
-- ═══════════════════════════════════════════════════════════

begin;

drop function public.report_coach_card(uuid, text);
drop function public.coach_card_badge(uuid);
drop function public.coach_card_withdraw();
drop function public.coach_card_declare(text);
drop function public.coach_card_state();
drop view private.coach_cards_review;
drop function private.coach_card_remove(uuid, text);
drop function private.coach_card_restore(uuid, text);
drop function private.coach_card_shown(uuid, uuid);
drop function private.coach_card_reporters(uuid);
drop function private.coach_card_json(uuid);
drop table public.coach_cards;
delete from private.social_rate r where r.action = 'coach_card';

commit;
