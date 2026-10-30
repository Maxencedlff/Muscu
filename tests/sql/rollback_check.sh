#!/usr/bin/env bash
# Retour arrière de la migration des réactions (supabase/rollback/20261031200000_reactions_profil_down.sql),
# sur un Postgres local jetable comme run.sh : toutes les migrations, quelques réactions, le retour
# arrière, puis les tests du social tels qu'ils étaient avant les réactions (git show 15ca0aa).
# Lancer : bash tests/sql/rollback_check.sh
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
# Une réaction 🔥 avant le retour arrière : elle doit rester, redevenue un bravo
psql -c "insert into auth.users (id) values ('00000000-0000-0000-0000-0000000007a1'), ('00000000-0000-0000-0000-0000000007a2');
  insert into public.sessions (user_id, id, data) values ('00000000-0000-0000-0000-0000000007a1', 's1', '{\"date\": 1}');
  insert into public.bravos (session_owner, session_id, user_id, kind) values ('00000000-0000-0000-0000-0000000007a1', 's1', '00000000-0000-0000-0000-0000000007a2', 'fire');"
psql -f "$root/supabase/rollback/20261031200000_reactions_profil_down.sql"
psql -c "do \$\$ begin
  if exists (select 1 from information_schema.columns where table_name = 'bravos' and column_name in ('kind', 'updated_at')) then raise 'colonnes restées'; end if;
  if (select count(*) from public.bravos) <> 1 then raise 'réaction perdue'; end if;
  delete from auth.users where id::text like '%7a_';
  if exists (select 1 from pg_proc where proname in ('set_reaction', 'my_activity', 'session_reactions', 'my_reactions', 'my_shown_sessions', 'mark_activity_seen')) then raise 'fonctions restées'; end if;
end \$\$;"
git -C "$root" show 15ca0aa:tests/sql/social_test.sql > "$tmp/social_test_avant.sql"
psql -f "$tmp/social_test_avant.sql"
echo "OK : retour arrière, tests du social d'avant les réactions verts"
