#!/usr/bin/env bash
# Montée de version de PRODUCTION : applique les migrations jusqu'à 20261028000000_payant.sql (déjà en
# production), insère des données réalistes (une ligne « trial », un « Accès offert » d'Apple, un élève
# de coach, un abonné, un code cadeau, des séances), applique les migrations suivantes, puis vérifie le
# résultat. Postgres local jetable, rien n'est envoyé au projet Supabase.
# Lancer : bash tests/sql/upgrade_test.sh   (Postgres 15+, comme tests/sql/run.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
prod_last=20261028000000_payant.sql
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
tmp=$(mktemp -d)
port=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"$bin/initdb" -D "$tmp/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
psql() { command psql -X -q -v ON_ERROR_STOP=1 -h "$tmp" -p "$port" -U postgres -d postgres "$@"; }
psql -f "$here/supabase_stub.sql"
after=0
for m in "$root"/supabase/migrations/*.sql; do
  if [ "$after" = 0 ]; then
    psql -f "$m"
    [ "$(basename "$m")" = "$prod_last" ] && { psql -f "$here/upgrade/seed_20261028.sql" >/dev/null; after=1; }
  else
    echo "migration : $(basename "$m")"
    psql -1 -f "$m"
  fi
done
[ "$after" = 1 ] || { echo "migration de production $prod_last introuvable"; exit 1; }
psql -c "create function pg_temp.perr(stmt text) returns text language plpgsql as \$\$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end \$\$;" \
     -f "$here/upgrade/check_modele_b.sql"
echo "OK : montée de version depuis $prod_last"
