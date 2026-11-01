#!/usr/bin/env bash
# Retour arrière des notifications des messages et des commentaires
# (supabase/rollback/20261031910000_notifications_messages_down.sql), sur un Postgres local jetable comme
# run.sh : toutes les migrations d'avant et des données (réglage allumé, notification en file), pg_dump ;
# puis la migration, des notifications et réglages des nouveaux types, le retour arrière : pg_dump
# identique (schéma, droits, déclencheurs, fonctions et données ; dates et compteurs d'identité masqués).
# Lancer : bash tests/sql/rollback_push_messages_check.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
M=20261031910000_notifications_messages
tmp=$(mktemp -d)
port=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"$bin/initdb" -D "$tmp/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
psql() { command psql -X -q -v ON_ERROR_STOP=1 -h "$tmp" -p "$port" -U postgres -d postgres "$@"; }
dump() {
  "$bin/pg_dump" -h "$tmp" -p "$port" -U postgres -d postgres --no-owner \
    | /usr/bin/env grep -v '^\\\(un\)\?restrict' | /usr/bin/env grep -v 'pg_catalog.setval' \
    | sed -E 's/20[0-9]{2}-[0-9]{2}-[0-9]{2} [0-9:.]+\+[0-9]{2}/<date>/g' > "$1"
}
psql -f "$here/supabase_stub.sql"
for m in "$root"/supabase/migrations/*.sql; do
  [ "$(basename "$m" .sql)" = "$M" ] || psql -f "$m"
done
# Avant : un compte avec un appareil (faux jeton), « Bravos » allumé, un bravo en file
U1=00000000-0000-0000-0000-0000000008c1; U2=00000000-0000-0000-0000-0000000008c2
psql -c "insert into auth.users (id) values ('$U1'), ('$U2');
  insert into public.sessions (user_id, id, data) values ('$U1', 's1', '{\"date\": 1}');
  insert into public.push_devices (token, user_id, env) values (repeat('c', 64), '$U1', 'production');
  insert into public.push_prefs (user_id, reactions) values ('$U1', true);
  insert into public.bravos (session_owner, session_id, user_id) values ('$U1', 's1', '$U2');"
dump "$tmp/avant.sql"
psql -f "$root/supabase/migrations/$M.sql"
# Après la migration : les deux nouveaux réglages allumés, une notification de chaque nouveau type en file
psql -c "update public.push_prefs set comments = true, messages = true where user_id = '$U1';
  insert into private.push_outbox (recipient, kind, actor, ref) values ('$U1', 'comment', '$U2', '1'), ('$U1', 'chat_message', '$U2', '2');"
psql -f "$root/supabase/rollback/${M}_down.sql"
dump "$tmp/apres.sql"
diff -q "$tmp/avant.sql" "$tmp/apres.sql" >/dev/null || { diff "$tmp/avant.sql" "$tmp/apres.sql" | head -60; echo "ÉCART après le retour arrière"; exit 1; }
echo "OK : retour arrière des notifications des messages et des commentaires, base identique à celle d'avant"
