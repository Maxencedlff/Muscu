#!/usr/bin/env bash
# Retour arrière du blocage qui coupe le lien coach (supabase/rollback/20261127010000_blocage_coupe_coach_down.sql) :
# 1. sur une base avec des comptes (coach K et son élève S, blocage entre deux autres comptes), la migration, une
#    tentative refusée de relier deux comptes bloqués, puis le retour arrière rendent un pg_dump COMPLET (schéma,
#    droits, données) identique à la base où la migration n'a jamais été appliquée ; puis la migration repasse ;
# 2. nettoyage : un lien déjà bloqué AVANT la migration est supprimé par elle, les autres liens restent.
# Postgres local jetable, rien n'est envoyé au projet Supabase.
# Lancer : bash tests/sql/blocage_coupe_coach_rollback_test.sh   (Postgres 15+, comme tests/sql/run.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mine="$root/supabase/migrations/20261127010000_blocage_coupe_coach.sql"
down="$root/supabase/rollback/20261127010000_blocage_coupe_coach_down.sql"
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
# Comptes factices : K coach de S ; A et B se sont bloqués (sans lien coach) ; C coach de D, D a bloqué C
psql avant <<'SQL'
insert into auth.users (id) select ('00000000-0000-0000-0000-0000000bd1' || c || '0')::uuid from unnest(array['1','2','3','4','5','6']) c;
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at) values
  ('00000000-0000-0000-0000-0000000bd110', 'rb.k', '🦊', now()), ('00000000-0000-0000-0000-0000000bd120', 'rb.s', '🦊', null),
  ('00000000-0000-0000-0000-0000000bd130', 'rb.a', '🦊', null), ('00000000-0000-0000-0000-0000000bd140', 'rb.b', '🦊', null),
  ('00000000-0000-0000-0000-0000000bd150', 'rb.c', '🦊', now()), ('00000000-0000-0000-0000-0000000bd160', 'rb.d', '🦊', null);
insert into public.coach_links (student_id, coach_id) values ('00000000-0000-0000-0000-0000000bd120', '00000000-0000-0000-0000-0000000bd110');
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000bd130', '00000000-0000-0000-0000-0000000bd140');
SQL
command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres -c "create database nettoyage template avant"
command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres -c "create database apres template avant"
psql apres -f "$mine"
psql apres >/dev/null <<'SQL'
do $$ begin
  begin
    insert into public.coach_links (student_id, coach_id) values ('00000000-0000-0000-0000-0000000bd130', '00000000-0000-0000-0000-0000000bd140');
    raise 'lien créé entre deux comptes bloqués';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'invalid_code' then raise; end if;
  end;
  if (select count(*) from public.coach_links where coach_id = '00000000-0000-0000-0000-0000000bd110') <> 1 then raise 'lien non bloqué coupé'; end if;
end $$;
SQL
psql apres -f "$down" 2>&1 | { grep -v 'transaction in progress' || true; }
diff <(dump avant) <(dump apres) > "$tmp/diff" || { echo "retour arrière : base différente"; head -60 "$tmp/diff"; exit 1; }
psql apres -f "$mine"
psql apres -At -c "select 'private.block_cuts_coach()'::regprocedure, 'private.coach_link_not_blocked()'::regprocedure" > /dev/null
# Nettoyage : D a bloqué C (posé avant la migration, sans déclencheur), leur lien disparaît ; celui de S et K reste
psql nettoyage <<'SQL'
insert into public.coach_links (student_id, coach_id) values ('00000000-0000-0000-0000-0000000bd160', '00000000-0000-0000-0000-0000000bd150');
insert into public.coach_messages (student_id, coach_id, from_coach, body) values ('00000000-0000-0000-0000-0000000bd160', '00000000-0000-0000-0000-0000000bd150', true, 'Salut');
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000bd160', '00000000-0000-0000-0000-0000000bd150');
SQL
psql nettoyage -f "$mine"
psql nettoyage >/dev/null <<'SQL'
do $$ begin
  if exists (select 1 from public.coach_links where student_id = '00000000-0000-0000-0000-0000000bd160') then raise 'lien déjà bloqué gardé par la migration'; end if;
  if exists (select 1 from public.coach_messages where student_id = '00000000-0000-0000-0000-0000000bd160') then raise 'conversation du lien bloqué gardée'; end if;
  if not exists (select 1 from public.coach_links where student_id = '00000000-0000-0000-0000-0000000bd120') then raise 'lien non bloqué coupé par le nettoyage'; end if;
end $$;
SQL
echo "OK : retour arrière du blocage qui coupe le lien coach (schéma, droits et données d'avant ; nettoyage des liens déjà bloqués)"
