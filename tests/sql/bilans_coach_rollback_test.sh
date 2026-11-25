#!/usr/bin/env bash
# Retour arrière des bilans configurables (supabase/rollback/20261125010000_bilans_coach_down.sql) : sur une base
# avec des comptes (coach, élève, appareil, réglages), la migration puis des bilans réels (modèle, groupe, planning,
# demande envoyée et sa notification en file, réponse, retour, accord du cycle, envoi compté dans le journal), puis
# le retour arrière rendent un pg_dump COMPLET (schéma, droits, données) identique à la base où la migration n'a
# jamais été appliquée (compteurs des identités mis à part) ; puis la migration repasse. Postgres local jetable, rien n'est envoyé au projet Supabase.
# Lancer : bash tests/sql/bilans_coach_rollback_test.sh   (Postgres 15+, comme tests/sql/run.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mine="$root/supabase/migrations/20261125010000_bilans_coach.sql"
down="$root/supabase/rollback/20261125010000_bilans_coach_down.sql"
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
tmp=$(mktemp -d)
port=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"$bin/initdb" -D "$tmp/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
psql() { db=$1; shift; command psql -X -q -v ON_ERROR_STOP=1 -h "$tmp" -p "$port" -U postgres -d "$db" "$@"; }
# Compteurs des identités (setval) exclus : une ligne mise en file puis retirée avance le compteur, sans effet
dump() { "$bin/pg_dump" -h "$tmp" -p "$port" -U postgres --no-owner "$1" | grep -v -e '^--' -e '^$' -e '^\\' -e '^SELECT pg_catalog.setval'; }
command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres -c "create database avant"
psql avant -f "$here/supabase_stub.sql"
# Les migrations d'AVANT elle seulement : une plus récente peut réécrire ses fonctions (20261127050000_sante_coach.sql
# reprend coach_student_weeks et les briques des bilans) et se défait avant elle (supabase/rollback/ORDRE.md)
for m in "$root"/supabase/migrations/*.sql; do if [[ "$(basename "$m")" < "$(basename "$mine")" ]]; then psql avant -f "$m"; fi; done
# Comptes de départ (identifiants factices) : coach K, élève S avec un appareil et « Mon coach » allumé
psql avant <<'SQL'
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000bd001'), ('00000000-0000-0000-0000-0000000bd002');
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at) values
  ('00000000-0000-0000-0000-0000000bd001', 'rb.coach', '🦊', now()), ('00000000-0000-0000-0000-0000000bd002', 'rb.eleve', '🦊', null);
insert into public.coach_links (student_id, coach_id) values ('00000000-0000-0000-0000-0000000bd002', '00000000-0000-0000-0000-0000000bd001');
insert into public.push_devices (token, user_id, env) values (repeat('d', 64), '00000000-0000-0000-0000-0000000bd002', 'production');
insert into public.push_prefs (user_id, coach) values ('00000000-0000-0000-0000-0000000bd002', true);
SQL
command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres -c "create database apres template avant"
psql apres -f "$mine"
psql apres >/dev/null <<'SQL'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000bd001', false);
select public.coach_template_save(null, 'Hebdo', '[{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}, {"key": "cycle", "kind": "cycle", "label": "Cycle menstruel", "type": "choice", "required": false}]');
select public.coach_group_save(null, 'Prépa', array['00000000-0000-0000-0000-0000000bd002'::uuid]);
select public.coach_schedule_save((select id from public.coach_checkin_templates), '00000000-0000-0000-0000-0000000bd002');
select public.coach_checkin_send_now((select id from public.coach_checkin_templates), array['00000000-0000-0000-0000-0000000bd002'::uuid]);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000bd002', false);
select public.student_checkin_cycle(true, true);
select public.student_checkin_answer((select id from public.coach_checkin_requests), '{"sleep": 4, "cycle": "luteal"}');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000bd001', false);
select public.coach_checkin_review((select id from public.coach_checkin_requests), 'Bravo', 8, true);
do $$ begin
  if (select count(*) from private.push_outbox where kind = 'checkin') <> 1 then raise 'notification absente avant le retour arrière'; end if;
  if (select count(*) from private.social_rate where action = 'checkin_send') <> 1 then raise 'envoi non compté'; end if;
end $$;
SQL
psql apres -f "$down" 2>&1 | { grep -v 'transaction in progress' || true; }
diff <(dump avant) <(dump apres) > "$tmp/diff" || { echo "retour arrière : base différente"; head -60 "$tmp/diff"; exit 1; }
psql apres -f "$mine"
psql apres -At -c "select 'public.student_checkins()'::regprocedure, 'private.checkin_tick(timestamptz)'::regprocedure" > /dev/null
echo "OK : retour arrière des bilans configurables (schéma, droits et données d'avant)"
