#!/usr/bin/env bash
# Retour arrière des notifications push (supabase/rollback/20261031900000_notifications_push_down.sql), sur un
# Postgres local jetable comme run.sh : toutes les migrations, un appareil et une notification en file, le
# retour arrière, puis les tests du social et du coach (bravos, demandes, commentaires sans déclencheur).
# Lancer : bash tests/sql/rollback_push_check.sh
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
# Un appareil (faux jeton), un réglage allumé et un bravo mis en file avant le retour arrière
psql -c "insert into auth.users (id) values ('00000000-0000-0000-0000-0000000008b1'), ('00000000-0000-0000-0000-0000000008b2');
  insert into public.sessions (user_id, id, data) values ('00000000-0000-0000-0000-0000000008b1', 's1', '{\"date\": 1}');
  insert into public.push_devices (token, user_id, env) values (repeat('c', 64), '00000000-0000-0000-0000-0000000008b1', 'production');
  insert into public.push_prefs (user_id, reactions) values ('00000000-0000-0000-0000-0000000008b1', true);
  insert into public.bravos (session_owner, session_id, user_id) values ('00000000-0000-0000-0000-0000000008b1', 's1', '00000000-0000-0000-0000-0000000008b2');
  do \$\$ begin if (select count(*) from private.push_outbox) <> 1 then raise 'file vide avant le retour arrière'; end if; end \$\$;"
# Du plus récent au plus ancien (supabase/rollback/ORDRE.md) : messages et commentaires d'abord
psql -f "$root/supabase/rollback/20261031910000_notifications_messages_down.sql"
psql -f "$root/supabase/rollback/20261031900000_notifications_push_down.sql"
psql -c "do \$\$ begin
  if to_regclass('public.push_devices') is not null or to_regclass('public.push_prefs') is not null or to_regclass('private.push_outbox') is not null or to_regclass('private.push_apns_auth') is not null then raise 'tables restées'; end if;
  if exists (select 1 from pg_proc where proname like 'push\_%') then raise 'fonctions restées'; end if;
  if exists (select 1 from pg_trigger where tgname like '%\_push') then raise 'déclencheurs restés'; end if;
  if (select count(*) from public.bravos) <> 1 then raise 'bravo perdu'; end if;
  delete from auth.users where id::text like '%8b_';
end \$\$;"
for t in social_test.sql coach_test.sql; do psql -f "$here/$t"; done
echo "OK : retour arrière des notifications push, tests du social et du coach verts"
