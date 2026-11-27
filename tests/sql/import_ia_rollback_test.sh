#!/usr/bin/env bash
# Retour arrière de l'import aidé par l'IA (supabase/rollback/20261130010000_import_ia_down.sql) :
# après toutes les migrations, le retour arrière rend un schéma identique (pg_dump --schema-only) à celui où la migration
# n'a jamais été appliquée, puis la migration repasse et ses vérifications aussi. Postgres local jetable, rien n'est envoyé
# au projet Supabase.
# Lancer : bash tests/sql/import_ia_rollback_test.sh   (Postgres 15+, comme tests/sql/run.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mine="$root/supabase/migrations/20261130010000_import_ia.sql"
down="$root/supabase/rollback/20261130010000_import_ia_down.sql"
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
tmp=$(mktemp -d)
port=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"$bin/initdb" -D "$tmp/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
psql() { db=$1; shift; command psql -X -q -v ON_ERROR_STOP=1 -h "$tmp" -p "$port" -U postgres -d "$db" "$@"; }
dump() { "$bin/pg_dump" -h "$tmp" -p "$port" -U postgres --schema-only --no-owner "$1" | grep -v -e '^--' -e '^$' -e '^\\'; }
command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres -c "create database avant"
psql avant -f "$here/supabase_stub.sql"
for m in "$root"/supabase/migrations/*.sql; do [ "$m" = "$mine" ] || psql avant -f "$m"; done
command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres -c "create database apres template avant"
psql apres -f "$mine"
# Des appels et un cache : le retour arrière passe avec des lignes dans les tables
psql apres -c "insert into private.plan_ai_calls (import_id, model, reserved_usd) values (gen_random_uuid(), 'claude-haiku-5-5', 0.01); insert into private.plan_ai_cache (key, value) values (repeat('a', 64), '{}')"
psql apres -f "$down"
diff <(dump avant) <(dump apres) > "$tmp/diff" || { echo "retour arrière : schéma différent"; cat "$tmp/diff"; exit 1; }
# Rejouable : le retour arrière une seconde fois ne casse rien
psql apres -f "$down"
psql apres -f "$mine"
psql apres -f "$here/import_ia_test.sql" >/dev/null
echo "OK : retour arrière de l import aidé par l IA"
