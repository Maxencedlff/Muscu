-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031510000_chat_coach.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide d'annuler les messages coach ↔ élève). Pas dans
--  migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Effet : tous les messages et leurs signalements supprimés (définitivement : exporter
--  public.chat_reports avant si une enquête est en cours ; les lignes de public.reports qui les citent,
--  target_ref chat_reports:<id>, restent jusqu'à la purge des 12 mois), tâche pg_cron
--  purge-chat-reports-12-mois retirée, marques de lecture retirées de coach_links ;
--  le reste du coach (liens, programmes, commentaires du coach, partage) n'est pas touché.
--  Vérifié par tests/sql/rollback_social_check.sh.
--  Après le retour arrière, l'app doit revenir à une version qui n'appelle pas chat_threads
--  (une app à jour cache alors la cellule « Messages » : chat_threads absent = pas de messagerie).
-- ═══════════════════════════════════════════════════════════

begin;

do $cron$
begin
  -- Deux tests séparés : cron.job n'existe pas sans l'extension (Postgres local des tests)
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-chat-reports-12-mois') then
      perform cron.unschedule('purge-chat-reports-12-mois');
    end if;
  end if;
end
$cron$;

drop function public.chat_threads();
drop function public.report_chat(text, uuid);
drop function public.chat_mark_read(uuid, bigint);
drop function public.chat_messages(uuid, bigint, bigint);
drop function public.chat_send(text, uuid);
drop function private.chat_last(uuid, uuid, boolean);
drop function private.chat_unread(uuid, uuid, boolean, bigint);
drop function private.chat_clean(text);
drop function private.chat_lock(uuid);
drop function private.chat_thread(uuid, uuid);

drop table public.chat_reports;
drop function private.chat_report_before_insert();
drop table public.coach_messages;
alter table public.coach_links drop column chat_coach_read, drop column chat_student_read;

commit;
