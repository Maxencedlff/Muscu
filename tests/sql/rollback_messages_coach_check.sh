#!/usr/bin/env bash
# Retour arrière du résumé des séances et de coach_push_off
# (supabase/rollback/20261117050000_messages_coach_down.sql), sur un Postgres local jetable comme run.sh :
# toutes les autres migrations et des données (coach, quatre élèves, réglages, notifications en file),
# pg_dump ; puis la migration, trois séances notifiées et un résumé en file, coach_push_off appelée, le
# retour arrière : pg_dump identique (schéma, droits, déclencheurs, fonctions et données ; dates et
# compteurs d'identité masqués).
# Lancer : bash tests/sql/rollback_messages_coach_check.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
M=20261117050000_messages_coach
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
# Sans J'aime (20261117060000), qui reprend son push_claim et se démonte avant
for m in "$root"/supabase/migrations/*.sql; do
  case "$(basename "$m" .sql)" in "$M"|20261117060000_*|20261125010000_*|20261127030000_*) ;; *) psql -f "$m" ;; esac
done
# Avant : K coach, élèves E1 à E4, un appareil (faux jeton), séances des élèves allumées, une notification en file
K=00000000-0000-0000-0000-000000000ae0
E=(00000000-0000-0000-0000-000000000ae1 00000000-0000-0000-0000-000000000ae2 00000000-0000-0000-0000-000000000ae3 00000000-0000-0000-0000-000000000ae4)
psql -c "insert into auth.users (id) values ('$K'), ('${E[0]}'), ('${E[1]}'), ('${E[2]}'), ('${E[3]}');
  insert into public.user_profiles (user_id, username, coach_at) values ('$K', 'rbkev', now()),
    ('${E[0]}', 'rbe1', null), ('${E[1]}', 'rbe2', null), ('${E[2]}', 'rbe3', null), ('${E[3]}', 'rbe4', null);
  insert into public.coach_links (student_id, coach_id, created_at)
    select u, '$K', now() - interval '30 days' from unnest(array['${E[0]}', '${E[1]}', '${E[2]}', '${E[3]}']::uuid[]) u;
  insert into public.push_devices (token, user_id, env) values (repeat('d', 64), '$K', 'production');
  insert into public.push_prefs (user_id, messages, student_sessions) values ('$K', true, true);
  insert into private.push_outbox (recipient, kind, actor, ref) values ('$K', 'chat_message', '${E[0]}', '1');"
dump "$tmp/avant.sql"
psql -f "$root/supabase/migrations/$M.sql"
# Après la migration : quatre séances récentes (trois notifiées, la quatrième dans un résumé), coach_push_off
for i in 0 1 2 3; do
  psql -c "insert into public.sessions (user_id, id, data) values ('${E[$i]}', 'rb$i', jsonb_build_object('date', (extract(epoch from now()) * 1000)::bigint));"
done
[ "$(psql -tAc "select count(*) from private.push_outbox where kind = 'student_digest'")" = 1 ] || { echo "résumé absent avant le retour arrière"; exit 1; }
psql -c "set role authenticated; select set_config('request.jwt.claim.sub', '$K', false); select public.coach_push_off();" >/dev/null
psql -c "delete from public.sessions where id like 'rb%';
  delete from private.push_outbox where kind = 'student_session';
  delete from private.social_rate where action = 'coach_push_off';"
psql -f "$root/supabase/rollback/${M}_down.sql"
dump "$tmp/apres.sql"
diff -q "$tmp/avant.sql" "$tmp/apres.sql" >/dev/null || { diff "$tmp/avant.sql" "$tmp/apres.sql" | head -60; echo "ÉCART après le retour arrière"; exit 1; }
echo "OK : retour arrière du résumé des séances et de coach_push_off, base identique à celle d'avant"
