#!/usr/bin/env bash
# Retour arrière de Strava (supabase/rollback/20261031620000_strava_down.sql), sur un Postgres local
# jetable comme run.sh : toutes les migrations, une liaison et un envoi factices, le retour arrière
# (deux fois : il doit pouvoir se relancer), puis tous les autres tests (*_test.sql sauf strava).
# Lancer : bash tests/sql/strava_rollback_check.sh
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
psql -c "insert into auth.users (id) values ('00000000-0000-0000-0000-0000000007c1');
  select public.strava_link_save('00000000-0000-0000-0000-0000000007c1', 1, 'Test', 'activity:write', 'chiffre-factice-xxxxxxxxxxxxxxx', now());
  select public.strava_export_begin('00000000-0000-0000-0000-0000000007c1', 's1');"
psql -f "$root/supabase/rollback/20261031620000_strava_down.sql"
psql -f "$root/supabase/rollback/20261031620000_strava_down.sql"
psql -c "do \$\$ begin
  if exists (select 1 from pg_proc where proname like 'strava\_%') then raise 'fonctions restées'; end if;
  if exists (select 1 from pg_class where relname like 'strava\_%') then raise 'tables restées'; end if;
  if exists (select 1 from private.social_rate where action like 'strava%') then raise 'journal des limites resté'; end if;
  delete from auth.users where id = '00000000-0000-0000-0000-0000000007c1';
end \$\$;"
for t in "$here"/*_test.sql; do
  [ "$(basename "$t")" = strava_test.sql ] && continue
  psql -f "$t"
done
echo "OK : retour arrière de Strava, autres tests verts"
