#!/usr/bin/env bash
# Retour arrière de l'accord daté des bilans et des questions réservées aux 18 ans et plus
# (supabase/rollback/20261127030000_bilans_accord_majeur_down.sql) : sur une base avec des comptes (coach K, élèves S
# et A, A a déclaré ses 18 ans, un bilan envoyé), la migration puis son usage (accord donné, retiré, redonné, réponse
# envoyée, refus sans accord), puis le retour arrière rendent un pg_dump COMPLET (schéma, droits, données) identique
# à la base où la migration n'a jamais été appliquée, réponse envoyée mise à part (elle reste, comme toute réponse) ;
# puis la migration repasse. Postgres local jetable, rien n'est envoyé au projet Supabase.
# Lancer : bash tests/sql/bilans_accord_majeur_rollback_test.sh   (Postgres 15+, comme tests/sql/run.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mine="$root/supabase/migrations/20261127030000_bilans_accord_majeur.sql"
down="$root/supabase/rollback/20261127030000_bilans_accord_majeur_down.sql"
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
tmp=$(mktemp -d)
port=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"$bin/initdb" -D "$tmp/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
psql() { db=$1; shift; command psql -X -q -v ON_ERROR_STOP=1 -h "$tmp" -p "$port" -U postgres -d "$db" "$@"; }
dump() { "$bin/pg_dump" -h "$tmp" -p "$port" -U postgres --no-owner "$1" | grep -v -e '^--' -e '^$' -e '^\\' -e '^SELECT pg_catalog.setval'; }
command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres -c "create database avant"
psql avant -f "$here/supabase_stub.sql"
for m in "$root"/supabase/migrations/*.sql; do [ "$m" = "$mine" ] || psql avant -f "$m"; done
# Comptes factices : K coach de S et A ; A a déclaré ses 18 ans ; un bilan (sommeil, libido) envoyé aux deux
psql avant >/dev/null <<'SQL'
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000ae001'), ('00000000-0000-0000-0000-0000000ae002'), ('00000000-0000-0000-0000-0000000ae003');
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at) values
  ('00000000-0000-0000-0000-0000000ae001', 'ra.coach', '🦊', now()), ('00000000-0000-0000-0000-0000000ae002', 'ra.s', '🦊', null),
  ('00000000-0000-0000-0000-0000000ae003', 'ra.a', '🦊', null);
insert into public.coach_links (student_id, coach_id) values
  ('00000000-0000-0000-0000-0000000ae002', '00000000-0000-0000-0000-0000000ae001'), ('00000000-0000-0000-0000-0000000ae003', '00000000-0000-0000-0000-0000000ae001');
insert into public.coach_photo_adults (user_id) values ('00000000-0000-0000-0000-0000000ae003');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000ae001', false);
select public.coach_template_save(null, 'Hebdo', '[{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}, {"key": "libido", "kind": "libido", "label": "Libido", "type": "scale", "required": false, "scale": 5, "lo": "Très basse", "hi": "Très haute"}]');
select public.coach_checkin_send_now((select id from public.coach_checkin_templates), array['00000000-0000-0000-0000-0000000ae002'::uuid, '00000000-0000-0000-0000-0000000ae003'::uuid]);
SQL
command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres -c "create database apres template avant"
psql apres -f "$mine"
psql apres >/dev/null <<'SQL'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000ae002', false);
do $$ begin
  begin perform public.student_checkin_answer((select id from public.coach_checkin_requests where student_id = '00000000-0000-0000-0000-0000000ae002'), '{"sleep": 3}');
        raise 'envoi sans accord accepté';
  exception when others then if sqlerrm <> 'no_health_consent' then raise; end if; end;
end $$;
select public.student_checkin_consent(true, 1);
select public.student_checkin_consent(false);
select public.student_checkin_consent(true, 1);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000ae003', false);
select public.student_checkin_consent(true, 1);
select public.student_checkin_answer((select id from public.coach_checkin_requests where student_id = '00000000-0000-0000-0000-0000000ae003'), '{"libido": 4}');
do $$ begin
  if (select count(*) from public.checkin_health_consents) <> 2 then raise 'accords absents avant le retour arrière'; end if;
end $$;
SQL
psql apres -f "$down" 2>&1 | { grep -v 'transaction in progress' || true; }
# La réponse envoyée reste (comme toute réponse) : retirée des deux côtés pour comparer le reste
for db in avant apres; do psql $db -c "delete from public.coach_checkin_answers; update public.coach_checkin_requests set answered_at = null"; done
diff <(dump avant) <(dump apres) > "$tmp/diff" || { echo "retour arrière : base différente"; head -60 "$tmp/diff"; exit 1; }
psql apres -f "$mine"
psql apres -At -c "select 'public.student_checkin_consent(boolean,int)'::regprocedure, 'private.checkin_is_adult(uuid)'::regprocedure" > /dev/null
echo "OK : retour arrière de l'accord daté des bilans et des questions réservées aux 18 ans (schéma, droits et données d'avant)"
