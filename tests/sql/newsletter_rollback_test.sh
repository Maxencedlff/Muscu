#!/usr/bin/env bash
# Retour arrière de la lettre d'information : applique toutes les migrations, puis
# supabase/rollback/20261031230000_newsletter_down.sql, vérifie qu'il ne reste rien, puis réapplique la
# migration (le retour arrière laisse une base où elle repasse) et relance ses tests.
# Postgres local jetable, rien n'est envoyé au projet Supabase.
# Lancer : bash tests/sql/newsletter_rollback_test.sh   (Postgres 15+, comme tests/sql/run.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mig="$root/supabase/migrations/20261031230000_newsletter.sql"
down="$root/supabase/rollback/20261031230000_newsletter_down.sql"
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
# Une inscription et une ligne de débit, pour voir le retour arrière les retirer
psql -c "insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000b001', 'test@example.test');" \
     -c "insert into public.newsletter_subscriptions (user_id, consent_version) values ('00000000-0000-0000-0000-00000000b001', 'v1');" \
     -c "insert into private.social_rate (user_id, action) values ('00000000-0000-0000-0000-00000000b001', 'newsletter_subscribe');"
psql -f "$down"
left=$(psql -At -c "select (select count(*) from pg_proc where proname like 'newsletter%')
  + (select count(*) from pg_class where relname = 'newsletter_subscriptions')
  + (select count(*) from private.social_rate where action = 'newsletter_subscribe');")
[ "$left" = 0 ] || { echo "retour arrière incomplet : $left objet(s) restant(s)"; exit 1; }
echo "OK : retour arrière de la lettre d'information"
psql -1 -f "$mig"
psql -f "$here/newsletter_test.sql"
echo "OK : nouvelle montée et tests de la lettre d'information"
