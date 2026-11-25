#!/usr/bin/env bash
# Retour arrière de la fiche Semaines (supabase/rollback/20261124010000_semaines_coach_down.sql) : après toutes les
# migrations, le retour arrière rend un schéma identique (pg_dump --schema-only) à celui où la migration n'a jamais
# été appliquée, puis la migration repasse. Postgres local jetable, rien n'est envoyé au projet Supabase.
# Lancer : bash tests/sql/semaines_coach_rollback_test.sh   (Postgres 15+, comme tests/sql/run.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mine="$root/supabase/migrations/20261124010000_semaines_coach.sql"
down="$root/supabase/rollback/20261124010000_semaines_coach_down.sql"
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
# Les migrations d'AVANT elle seulement : une plus récente peut réécrire ses fonctions (20261127040000_sante_coach.sql
# reprend coach_student_weeks et les briques des bilans) et se défait avant elle (supabase/rollback/ORDRE.md)
for m in "$root"/supabase/migrations/*.sql; do if [[ "$(basename "$m")" < "$(basename "$mine")" ]]; then psql avant -f "$m"; fi; done
command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres -c "create database apres template avant"
psql apres -f "$mine"
psql apres -f "$down"
diff <(dump avant) <(dump apres) > "$tmp/diff" || { echo "retour arrière : schéma différent"; cat "$tmp/diff"; exit 1; }
psql apres -f "$mine"
psql apres -At -c "select 'public.coach_student_weeks(uuid, integer)'::regprocedure" > /dev/null
echo "OK : retour arrière de la fiche Semaines"
