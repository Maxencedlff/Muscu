-- Retour arrière de 20261130010000_import_ia.sql (import aidé par l'IA, docs/IMPORT_IA.md).
-- Avant : supprimer la fonction Edge plan-import-ai et le secret ANTHROPIC_API_KEY (l'app garde alors le résultat du
-- moteur gratuit et dit « Aide de l'IA indisponible »). EFFACE le journal des appels (quotas, dépense) et le cache de
-- résultats (aucun texte importé dedans). Rejouable.
drop function if exists public.plan_ai_cache_put(jsonb);
drop function if exists public.plan_ai_cache_get(text[]);
drop function if exists public.plan_ai_settle(bigint, boolean, integer, integer, integer, integer);
drop function if exists public.plan_ai_reserve(uuid, uuid, text, numeric);
drop function if exists private.plan_ai_month_usd();
drop table if exists private.plan_ai_cache;
drop table if exists private.plan_ai_calls;
drop table if exists private.plan_ai_prices;
drop table if exists private.plan_ai_settings;
