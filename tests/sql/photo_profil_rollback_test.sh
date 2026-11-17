#!/usr/bin/env bash
# Retour arrière de la photo de profil (supabase/rollback/20261116000000_photo_profil_down.sql) : refusé tant qu'il
# reste un fichier dans le compartiment ; ensuite tout ce que la migration a créé disparaît, le reste (photos de
# bilan, signalements, app_config) est gardé ; puis la migration remonte et ses tests repassent.
# Postgres local jetable, rien n'est envoyé au projet Supabase.
# Lancer : bash tests/sql/photo_profil_rollback_test.sh   (Postgres 15+, comme tests/sql/run.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mig="$root/supabase/migrations/20261116000000_photo_profil.sql"
down="$root/supabase/rollback/20261116000000_photo_profil_down.sql"
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

# Un fichier encore là : refusé, rien ne change
psql -c "insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002', '{}')"
if psql -f "$down" >/dev/null 2>&1; then echo "retour arrière passé avec un fichier dans le compartiment"; exit 1; fi
[ "$(psql -At -c "select count(*) from pg_class where relname = 'profile_photos'")" = "1" ] || { echo "refus : la table a disparu"; exit 1; }
psql -c "set storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id = 'profile-photos';"

psql -f "$down"
left=$(psql -At -c "select concat_ws(',',
  (select count(*) from pg_class where relname in ('profile_photos', 'profile_photo_bans', 'profile_photo_trash')),
  (select count(*) from pg_proc where proname like '%profile_photo%' or proname = 'pro_feature'),
  (select count(*) from pg_namespace where nspname = 'profile_photo_rls'),
  (select count(*) from storage.buckets where id = 'profile-photos'),
  (select count(*) from pg_policies where policyname like 'profile_photos_%'),
  (select count(*) from public.app_config where key = 'profile_photos_on'),
  (select count(*) from pg_trigger where tgname = 'reports_profile_photo'),
  (select count(*) from storage.buckets where id = 'coach-photos'),
  (select count(*) from public.app_config where key in ('coach_photos_on', 'paywall_on')));")
[ "$left" = "0,0,0,0,0,0,0,1,2" ] || { echo "retour arrière incomplet ou trop large ($left)"; exit 1; }
echo "OK : retour arrière de la photo de profil (refusé avec un fichier, puis tout retiré, le reste gardé)"

psql -1 -f "$mig"
psql -f "$here/photo_profil_test.sql"
echo "OK : nouvelle montée et tests de la photo de profil"
