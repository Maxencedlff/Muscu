#!/usr/bin/env bash
# Retour arrière de la notification « séance d'un élève »
# (supabase/rollback/20261116020000_notifications_seances_eleves_down.sql), sur un Postgres local jetable
# comme run.sh : toutes les autres migrations et des données (coach, élève, réglages, notification en
# file), pg_dump ; puis la migration, une séance notifiée et le réglage allumé, le retour arrière : pg_dump
# identique (schéma, droits, déclencheurs, fonctions et données ; dates et compteurs d'identité masqués).
# Lancer : bash tests/sql/rollback_push_seances_check.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
M=20261116020000_notifications_seances_eleves
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
# Sans le résumé des séances (20261117050000) ni J'aime (20261117060000), qui s'appuient sur elle et se démontent avant
for m in "$root"/supabase/migrations/*.sql; do
  case "$(basename "$m" .sql)" in "$M"|20261117050000_*|20261117060000_*) ;; *) psql -f "$m" ;; esac
done
# Avant : K coach, E son élève, un appareil (faux jeton), messages allumés, un message en file
U1=00000000-0000-0000-0000-0000000008d1; U2=00000000-0000-0000-0000-0000000008d2
psql -c "insert into auth.users (id) values ('$U1'), ('$U2');
  insert into public.user_profiles (user_id, username, coach_at) values ('$U1', 'rkev', now()), ('$U2', 'rlea', null);
  insert into public.coach_links (student_id, coach_id, created_at) values ('$U2', '$U1', now() - interval '30 days');
  insert into public.sessions (user_id, id, data) values ('$U2', 's1', '{\"date\": 1}');
  insert into public.push_devices (token, user_id, env) values (repeat('c', 64), '$U1', 'production');
  insert into public.push_prefs (user_id, messages) values ('$U1', true);
  insert into private.push_outbox (recipient, kind, actor, ref) values ('$U1', 'chat_message', '$U2', '1');"
dump "$tmp/avant.sql"
psql -f "$root/supabase/migrations/$M.sql"
# Après la migration : le réglage allumé, une séance récente de l'élève notifiée
psql -c "update public.push_prefs set student_sessions = true where user_id = '$U1';
  insert into public.sessions (user_id, id, data) values ('$U2', 's2', jsonb_build_object('date', (extract(epoch from now()) * 1000)::bigint));"
[ "$(psql -tAc "select count(*) from private.push_outbox where kind = 'student_session'")" = 1 ] || { echo "séance non notifiée avant le retour arrière"; exit 1; }
psql -c "delete from public.sessions where id = 's2';"
psql -f "$root/supabase/rollback/${M}_down.sql"
dump "$tmp/apres.sql"
diff -q "$tmp/avant.sql" "$tmp/apres.sql" >/dev/null || { diff "$tmp/avant.sql" "$tmp/apres.sql" | head -60; echo "ÉCART après le retour arrière"; exit 1; }
echo "OK : retour arrière de la notification des séances des élèves, base identique à celle d'avant"
