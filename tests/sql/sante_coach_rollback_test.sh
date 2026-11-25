#!/usr/bin/env bash
# Retour arrière de la santé partagée avec le coach (supabase/rollback/20261127040000_sante_coach_down.sql) : après
# les migrations d'avant elle, la migration, des jours de santé partagés et un suivi Sommeil en heures, le retour
# arrière est d'abord refusé sans rien changer (modèle de bilan en heures), puis, le modèle repassé en échelle, il
# efface les jours et les consentements « health » (le poids partagé reste) et rend un schéma identique
# (pg_dump --schema-only) à celui où la migration n'a jamais été appliquée ; puis la migration repasse.
# Postgres local jetable, rien n'est envoyé au projet Supabase.
# Lancer : bash tests/sql/sante_coach_rollback_test.sh   (Postgres 15+, comme tests/sql/run.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mine="$root/supabase/migrations/20261127040000_sante_coach.sql"
down="$root/supabase/rollback/20261127040000_sante_coach_down.sql"
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
tmp=$(mktemp -d)
port=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"$bin/initdb" -D "$tmp/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
psql() { db=$1; shift; command psql -X -q -v ON_ERROR_STOP=1 -h "$tmp" -p "$port" -U postgres -d "$db" "$@"; }
dump() { "$bin/pg_dump" -h "$tmp" -p "$port" -U postgres --schema-only --no-owner "$1" | grep -v -e '^--' -e '^$' -e '^\\'; }
command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres -c "create database avant"
psql avant -f "$here/supabase_stub.sql"
# Les migrations d'AVANT elle seulement (une plus récente se défait avant elle, supabase/rollback/ORDRE.md)
for m in "$root"/supabase/migrations/*.sql; do if [[ "$(basename "$m")" < "$(basename "$mine")" ]]; then psql avant -f "$m"; fi; done
command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres -c "create database apres template avant"
psql apres -f "$mine"
# Coach K, élève S (identifiants factices) : poids et santé partagés, un modèle de bilan avec Sommeil en heures
psql apres >/dev/null <<'SQL'
insert into auth.users (id) values ('00000000-0000-0000-0000-0000005a1d01'), ('00000000-0000-0000-0000-0000005a1d02');
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at) values
  ('00000000-0000-0000-0000-0000005a1d01', 'rs.coach', '🦊', now()), ('00000000-0000-0000-0000-0000005a1d02', 'rs.eleve', '🦊', null);
insert into public.coach_links (student_id, coach_id) values ('00000000-0000-0000-0000-0000005a1d02', '00000000-0000-0000-0000-0000005a1d01');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000005a1d02', false);
select public.student_set_share('weight', true);
select public.student_set_share('health', true);
select public.student_share_health_days(jsonb_build_array(jsonb_build_object('day', to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD'), 'steps', 9000, 'sleep', 420)));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000005a1d01', false);
select public.coach_template_save(null, 'Hebdo', '[{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "number", "required": false, "unit": "h"}]');
SQL
# Refusé tant qu'un modèle a un suivi Sommeil en heures, sans rien changer
dump apres > "$tmp/avant_refus"
if psql apres -f "$down" >/dev/null 2>&1; then echo "retour arrière : passé avec un suivi Sommeil en heures"; exit 1; fi
dump apres | diff "$tmp/avant_refus" - > /dev/null || { echo "retour arrière refusé : schéma changé"; exit 1; }
[ "$(psql apres -At -c "select count(*) from public.coach_shared_health_days")" = 1 ] || { echo "retour arrière refusé : jours effacés"; exit 1; }
psql apres >/dev/null <<'SQL'
update public.coach_checkin_templates set items = '[{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}]';
SQL
psql apres -f "$down"
diff <(dump avant) <(dump apres) > "$tmp/diff" || { echo "retour arrière : schéma différent"; cat "$tmp/diff"; exit 1; }
[ "$(psql apres -At -c "select string_agg(kind, ',' order by kind) from public.coach_shares")" = weight ] || { echo "retour arrière : consentements"; exit 1; }
[ "$(psql apres -At -c "select count(*) from private.social_rate where action = 'coach_share_health'")" = 0 ] || { echo "retour arrière : journal des envois"; exit 1; }
psql apres -f "$mine"
psql apres -At -c "select 'public.coach_student_health(uuid)'::regprocedure, 'public.student_share_health_days(jsonb)'::regprocedure" > /dev/null
echo "OK : retour arrière de la santé partagée avec le coach (refus avec un Sommeil en heures, puis schéma d'avant)"
