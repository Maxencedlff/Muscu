-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031510000_chat_coach.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide d'annuler les messages coach ↔ élève). Pas dans
--  migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Effet : tous les messages supprimés (définitivement), marques de lecture retirées de coach_links ;
--  le reste du coach (liens, programmes, commentaires du coach, partage) n'est pas touché.
--  Vérifié par tests/sql/rollback_social_check.sh.
--  Après le retour arrière, l'app doit revenir à une version qui n'appelle pas chat_threads
--  (une app à jour cache alors la cellule « Messages » : chat_threads absent = pas de messagerie).
-- ═══════════════════════════════════════════════════════════

begin;

drop function public.chat_threads();
drop function public.chat_mark_read(uuid);
drop function public.chat_messages(uuid, bigint, bigint);
drop function public.chat_send(text, uuid);
drop function private.chat_last(uuid, uuid, boolean);
drop function private.chat_unread(uuid, uuid, boolean, bigint);
drop function private.chat_clean(text);
drop function private.chat_lock(uuid);
drop function private.chat_thread(uuid, uuid);

drop table public.coach_messages;
alter table public.coach_links drop column chat_coach_read, drop column chat_student_read;

commit;
