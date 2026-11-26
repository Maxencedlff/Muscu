-- Retour arrière de 20261129010000_erreurs_prod.sql (remontée des erreurs de l'app, docs/ERREURS_PROD.md).
-- Avant : supprimer la fonction Edge error-report (l'app cesse alors d'envoyer au premier refus, sans rien casser).
-- EFFACE tous les rapports d'erreur reçus (aucune donnée personnelle dedans). Rejouable.
drop trigger if exists error_reports_before_insert on public.error_reports;
drop function if exists private.error_report_before_insert();
drop table if exists public.error_reports;
