#!/usr/bin/env bash
# Retour arrière de la réaction « J'aime » (supabase/rollback/20261117050000_reaction_jaime_down.sql), sur un
# Postgres local jetable comme run.sh : toutes les autres migrations et des réactions (dont un 👏), pg_dump ;
# puis la migration, un ❤️ posé, le retour arrière : le ❤️ est redevenu un 👏 (ligne et date gardées), like est
# refusé, et le pg_dump est identique à celui d'avant une fois ce ❤️ compté comme le 👏 qu'il est devenu.
# Puis les tests des réactions et des notifications d'avant (social_reactions, push*) passent encore.
# Lancer : bash tests/sql/rollback_reaction_jaime_check.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
M=20261117050000_reaction_jaime
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
# Avant : A publie, B a réagi 👏 (la ligne que le ❤️ de C deviendra est posée telle quelle ici, en 👏)
U1=00000000-0000-0000-0000-0000000008e1; U2=00000000-0000-0000-0000-0000000008e2; U3=00000000-0000-0000-0000-0000000008e3
psql -c "insert into auth.users (id) values ('$U1'), ('$U2'), ('$U3');
  insert into public.sessions (user_id, id, data) values ('$U1', 's1', '{\"date\": 1, \"label\": \"Push\"}');
  insert into public.bravos (session_owner, session_id, user_id, kind, created_at, updated_at) values
    ('$U1', 's1', '$U2', 'clap', '2026-11-01 10:00:00+00', '2026-11-01 10:00:00+00'),
    ('$U1', 's1', '$U3', 'clap', '2026-11-02 10:00:00+00', '2026-11-02 10:00:00+00');"
dump "$tmp/avant.sql"
psql -f "$root/supabase/migrations/$M.sql"
psql -c "update public.bravos set kind = 'like' where user_id = '$U3';"
psql -f "$root/supabase/rollback/${M}_down.sql"
psql -c "do \$\$ begin
  if (select kind from public.bravos where user_id = '$U3') is distinct from 'clap' then raise '❤️ pas redevenu 👏'; end if;
  if (select updated_at from public.bravos where user_id = '$U3') <> '2026-11-02 10:00:00+00' then raise 'date du ❤️ changée'; end if;
  begin
    update public.bravos set kind = 'like' where user_id = '$U3';
    raise 'like encore accepté';
  exception when check_violation then null;
  end;
end \$\$;"
dump "$tmp/apres.sql"
diff -q "$tmp/avant.sql" "$tmp/apres.sql" >/dev/null || { diff "$tmp/avant.sql" "$tmp/apres.sql" | head -60; echo "ÉCART après le retour arrière"; exit 1; }
psql -c "delete from auth.users where id in ('$U1', '$U2', '$U3');"
for t in social_reactions_test.sql push_test.sql push_messages_test.sql push_seances_test.sql; do psql -f "$here/$t"; done
echo "OK : retour arrière de la réaction J'aime, ❤️ redevenu 👏, base identique à celle d'avant, tests d'avant verts"
