#!/usr/bin/env bash
# Tests des migrations Supabase sur un Postgres local jetable : rien n'est envoyé au projet Supabase.
# Crée un cluster temporaire, imite le socle Supabase (supabase_stub.sql), applique toutes les
# migrations dans l'ordre, puis lance les vérifications (*_test.sql : RLS, GRANT, déclencheurs).
# Lancer : bash tests/sql/run.sh   (Postgres 15+ : initdb et postgres dans le PATH ou /usr/lib/postgresql/*/bin)
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
for t in "$here"/*_test.sql; do psql -f "$t"; echo "OK : $(basename "$t")"; done
