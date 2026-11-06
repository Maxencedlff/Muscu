#!/usr/bin/env bash
# Retour arrière des photos de bilan (supabase/rollback/20261107000000_photos_bilan_down.sql) : il retire aussi la
# planification de la purge (tâche pg_cron « coach-photos-purge ») et son secret (Vault « photos_purge_secret »),
# sans toucher aux autres tâches ni aux autres secrets ; et il passe encore sans pg_cron ni Vault (Postgres local).
# pg_cron et Vault sont imités (cron.job, cron.unschedule, vault.secrets) ; secrets factices. Postgres local
# jetable, rien n'est envoyé au projet Supabase.
# Lancer : bash tests/sql/photos_bilan_rollback_test.sh   (Postgres 15+, comme tests/sql/run.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mig="$root/supabase/migrations/20261107000000_photos_bilan.sql"
down="$root/supabase/rollback/20261107000000_photos_bilan_down.sql"
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

# pg_cron et Vault imités, avec la tâche et le secret de la purge, et une autre tâche et un autre secret qui doivent rester
psql <<'SQL'
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.unschedule(job_name text) returns boolean language sql as
$$ delete from cron.job where jobname = job_name returning true $$;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
insert into cron.job (jobname, schedule, command) values ('coach-photos-purge', '17 * * * *', 'select 1'), ('push-send', '* * * * *', 'select 1');
insert into vault.secrets (name, secret) values ('photos_purge_secret', 'secret-factice-photos'), ('push_cron_secret', 'secret-factice-push');
SQL
psql -f "$down"
left=$(psql -At -c "select concat_ws(',',
  (select string_agg(jobname, '+' order by jobname) from cron.job),
  (select string_agg(name, '+' order by name) from vault.secrets),
  (select count(*) from pg_class where relname in ('coach_photos', 'coach_photo_keys')));")
[ "$left" = "push-send,push_cron_secret,0" ] || { echo "retour arrière : planification ou secret de la purge restés, ou autre chose retiré ($left)"; exit 1; }
echo "OK : retour arrière des photos de bilan (tâche et secret de la purge retirés, le reste gardé)"

# Sans pg_cron ni Vault (comme le Postgres local des autres tests) : il passe encore ; puis la migration remonte
psql -1 -f "$mig"
psql -c "drop schema cron cascade; drop schema vault cascade;"
psql -f "$down"
psql -1 -f "$mig"
psql -f "$here/photos_bilan_test.sql"
echo "OK : retour arrière sans pg_cron ni Vault, nouvelle montée et tests des photos de bilan"
