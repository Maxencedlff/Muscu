#!/usr/bin/env bash
# Retour arrière de « Relier cet ordinateur » (supabase/rollback/20261127010000_photos_web_appairage_down.sql) : après
# toutes les migrations, le retour arrière rend un schéma identique (pg_dump --schema-only) à celui où la migration n'a
# jamais été appliquée, puis la migration repasse ; il passe aussi après le retour arrière des photos de bilan (déclencheur
# déjà parti avec coach_photo_keys). Postgres local jetable, rien n'est envoyé au projet Supabase.
# Lancer : bash tests/sql/photos_web_appairage_rollback_test.sh   (Postgres 15+, comme tests/sql/run.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mine="$root/supabase/migrations/20261127010000_photos_web_appairage.sql"
down="$root/supabase/rollback/20261127010000_photos_web_appairage_down.sql"
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
command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres -c "create database seul template avant"
psql apres -f "$mine"
psql apres -f "$down"
diff <(dump avant) <(dump apres) > "$tmp/diff" || { echo "retour arrière : schéma différent"; cat "$tmp/diff"; exit 1; }
psql apres -f "$mine"
psql apres -At -c "select 'public.coach_photo_device_key(uuid)'::regprocedure, 'public.coach_photo_devices'::regclass" > /dev/null
# Après le retour arrière des photos de bilan, celui-ci passe encore
psql seul -f "$mine"
psql seul -f "$root/supabase/rollback/20261107000000_photos_bilan_down.sql"
psql seul -f "$down"
echo "OK : retour arrière de « Relier cet ordinateur » (appairage, ordinateurs reliés)"
