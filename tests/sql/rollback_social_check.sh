#!/usr/bin/env bash
# Retours arrière des commentaires et du chat coach (supabase/rollback/20261031510000_chat_coach_down.sql
# puis 20261031500000_commentaires_down.sql), sur un Postgres local jetable comme run.sh : toutes les
# migrations, un commentaire, un signalement et un message, les deux retours arrière, puis vérification
# que tout est parti et que les tests d'avant (*_test.sql sauf commentaires, chat et leurs notifications push_messages) passent encore.
# Lancer : bash tests/sql/rollback_social_check.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
tmp=$(mktemp -d)
port=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"$bin/initdb" -D "$tmp/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
psql() { command psql -X -q -v ON_ERROR_STOP=1 -h "$tmp" -p "$port" -U postgres -d postgres "$@"; }
psql -f "$here/supabase_stub.sql"
for m in "$root"/supabase/migrations/*.sql; do psql -f "$m"; done
# Données avant le retour arrière : un commentaire signalé, un lien coach avec un message
psql -c "insert into auth.users (id) values ('00000000-0000-0000-0000-0000000009f1'), ('00000000-0000-0000-0000-0000000009f2');
  insert into public.sessions (user_id, id, data) values ('00000000-0000-0000-0000-0000000009f1', 's1', '{\"date\": 1}');
  insert into public.session_comments (session_owner, session_id, author_id, body) values ('00000000-0000-0000-0000-0000000009f1', 's1', '00000000-0000-0000-0000-0000000009f2', 'Bravo');
  insert into public.comment_reports (comment_id, reporter_id, author_id, session_owner, session_id, body, reason)
    select id, session_owner, author_id, session_owner, session_id, body, 'spam' from public.session_comments;
  insert into public.coach_links (student_id, coach_id) values ('00000000-0000-0000-0000-0000000009f2', '00000000-0000-0000-0000-0000000009f1');
  insert into public.coach_messages (student_id, coach_id, from_coach, body) values ('00000000-0000-0000-0000-0000000009f2', '00000000-0000-0000-0000-0000000009f1', true, 'Salut');
  insert into public.chat_reports (reporter_id, target_user, student_id, coach_id, reason, messages) values ('00000000-0000-0000-0000-0000000009f2', '00000000-0000-0000-0000-0000000009f1', '00000000-0000-0000-0000-0000000009f2', '00000000-0000-0000-0000-0000000009f1', 'spam', '[]');"
psql -f "$root/supabase/rollback/20261031510000_chat_coach_down.sql"
psql -f "$root/supabase/rollback/20261031500000_commentaires_down.sql"
psql -c "do \$\$ begin
  if to_regclass('public.coach_messages') is not null or to_regclass('public.session_comments') is not null
     or to_regclass('public.comment_reports') is not null or to_regclass('private.comment_words') is not null
     or to_regclass('private.comment_allowed') is not null or to_regclass('public.chat_reports') is not null then raise 'tables restées'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'coach_links' and column_name like 'chat_%') then raise 'colonnes restées'; end if;
  if exists (select 1 from pg_proc where proname in ('list_comments', 'add_comment', 'delete_comment', 'report_comment', 'chat_send',
             'chat_messages', 'chat_mark_read', 'chat_threads', 'report_chat') or proname like 'comment\_%' or proname like 'chat\_%') then raise 'fonctions restées'; end if;
  if (select count(*) from public.coach_links where student_id = '00000000-0000-0000-0000-0000000009f2') <> 1 then raise 'lien coach perdu'; end if;
  delete from auth.users where id::text like '%9f_';
end \$\$;"
# my_activity reprend ses colonnes d'origine (10, sans comment_id ni comment_text)
psql -c "do \$\$ begin
  if (select pronargs from pg_proc where proname = 'my_activity') <> 2
     or (select array_length(proallargtypes, 1) from pg_proc where proname = 'my_activity') <> 12 then raise 'my_activity : forme'; end if;
end \$\$;"
for t in "$here"/*_test.sql; do
  case "$(basename "$t")" in commentaires_test.sql|chat_coach_test.sql|push_messages_test.sql) continue ;; esac
  psql -f "$t"
done
echo "OK : retours arrière des commentaires et du chat, tests d'avant verts"
