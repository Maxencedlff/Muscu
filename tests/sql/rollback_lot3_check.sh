#!/usr/bin/env bash
# Retours arrière du lot 3 (supabase/rollback/2026103*_down.sql), sur un Postgres local jetable comme run.sh.
#  1. démontage complet, du plus récent au plus ancien : pg_dump identique à la base d'avant le lot ;
#  2. chaque marche seule : monter jusqu'à la migration k, la démonter, pg_dump identique à la base
#     montée jusqu'à k-1.
# Les tables private.*_archive_* (données de paiement mises de côté par le parrainage) sont exclues de la
# comparaison : elles restent exprès (supabase/rollback/ORDRE.md). Les dates sont masquées.
# Lancer : bash tests/sql/rollback_lot3_check.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
work=$(mktemp -d)
LOT=(20261031100000_records_series 20261031200000_reactions_profil 20261031300000_partage_coach
     20261031400000_parrainage 20261031500000_commentaires 20261031510000_chat_coach)
tmp=""
start() {
  tmp=$(mktemp -d); port=$(( 20000 + RANDOM % 20000 ))
  "$bin/initdb" -D "$tmp/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
  "$bin/pg_ctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
}
stop() { if [ -n "$tmp" ]; then "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; tmp=""; fi; }
trap 'stop; rm -rf "$work"' EXIT
psql() { command psql -X -q -v ON_ERROR_STOP=1 -h "$tmp" -p "$port" -U postgres -d postgres "$@"; }
dump() {
  "$bin/pg_dump" -h "$tmp" -p "$port" -U postgres -d postgres --no-owner --exclude-table='private.*_archive_*' \
    | /usr/bin/env grep -v '^\\\(un\)\?restrict' \
    | sed -E 's/20[0-9]{2}-[0-9]{2}-[0-9]{2} [0-9:.]+\+[0-9]{2}/<date>/g' > "$1"
}
# Base d'avant le lot : socle Supabase et toutes les migrations antérieures au 31/10
base() {
  psql -f "$here/supabase_stub.sql"
  for m in "$root"/supabase/migrations/*.sql; do
    case "$(basename "$m" .sql)" in 2026103*) ;; *) psql -f "$m" ;; esac
  done
}
up() { psql -f "$root/supabase/migrations/$1.sql"; }
down() { psql -f "$root/supabase/rollback/$1_down.sql"; }
same() { diff -q "$1" "$2" >/dev/null || { diff "$1" "$2" | head -40; echo "ÉCART : $3"; exit 1; }; }

start; base; dump "$work/avant.sql"
for m in "${LOT[@]}"; do up "$m"; done
for ((i=${#LOT[@]}-1; i>=0; i--)); do down "${LOT[$i]}"; done
dump "$work/apres.sql"; stop
same "$work/avant.sql" "$work/apres.sql" "démontage complet"
echo "OK : démontage complet du lot 3, base identique à celle d'avant"

for ((k=0; k<${#LOT[@]}; k++)); do
  start; base
  for ((j=0; j<k; j++)); do up "${LOT[$j]}"; done
  dump "$work/a.sql"; up "${LOT[$k]}"; down "${LOT[$k]}"; dump "$work/b.sql"; stop
  same "$work/a.sql" "$work/b.sql" "${LOT[$k]}"
  echo "OK : ${LOT[$k]} monté puis démonté, base identique"
done
