#!/usr/bin/env bash
# Test de charge côté serveur : Postgres LOCAL jetable (comme tests/sql/run.sh), jamais le projet Supabase.
# Toutes les migrations, le jeu de données de charge (generer.sql : coachs de 50, 150 et 300 élèves, un an
# d'historique, partages, 90 jours de diète), puis les mesures de mesures_serveur.py.
# Lancer : bash tests/charge/serveur.sh [--json sortie.json] [--strict]
#   --strict : échoue si un appel dépasse 200 ms ou si un parcours du coach est bloqué par une limite.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
tmp=$(mktemp -d)
port=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"$bin/initdb" -D "$tmp/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses='' -c shared_buffers=256MB" -l "$tmp/log" -w start >/dev/null
export PGHOST="$tmp" PGPORT="$port" PGDATABASE=postgres
psql() { command psql -X -q -v ON_ERROR_STOP=1 -U postgres "$@"; }
psql -f "$root/tests/sql/supabase_stub.sql" >/dev/null
for m in "$root"/supabase/migrations/*.sql; do psql -f "$m" >/dev/null; done
psql -f "$here/generer.sql"
python3 -I "$here/mesures_serveur.py" "$@"
