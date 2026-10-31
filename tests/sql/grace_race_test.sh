#!/usr/bin/env bash
# Grâce de fin de séance sous CONCURRENCE (relecture du 28/10) : 6 transactions envoient chacune une
# séance de grâce en même temps. Sans verrou consultatif dans private.sessions_paywall, toutes voyaient
# « moins de 2 grâces » et passaient. Il doit en passer exactement 2.
# Postgres local jetable, rien n'est envoyé au projet Supabase. Lancer : bash tests/sql/grace_race_test.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
tmp=$(mktemp -d)
port=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"$bin/initdb" -D "$tmp/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
psql() { command psql -X -q -v ON_ERROR_STOP=1 -h "$tmp" -p "$port" -U postgres -d postgres "$@"; }
psql -f "$here/supabase_stub.sql"
for m in "$root"/supabase/migrations/*.sql; do psql -f "$m" >/dev/null; done
u=00000000-0000-0000-0000-000000000801
# Abonnement fini il y a 1 h, verrou allumé
psql -c "insert into auth.users (id) values ('$u');
         select public.srv_access_purchase('$u', 'com.mdlf.training.pro.monthly', now() + interval '20 days', 'S-801');
         update public.entitlement_claims set expires_at = now() - interval '1 hour' where original_transaction_id = 'S-801';
         select private.access_refresh('$u');
         update public.app_config set value = 'true'::jsonb where key = 'paywall_on';" >/dev/null
# 6 envois simultanés de séances commencées 70 min avant maintenant (donc avant la fin de l'accès)
for i in 1 2 3 4 5 6; do
  command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres >/dev/null 2>"$tmp/race$i.err" <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$u', true);
insert into public.sessions (id, data) values ('R$i', jsonb_build_object('date', (extract(epoch from now() - interval '1 hour 10 minutes') * 1000)::bigint, 'duration', 600000));
select pg_sleep(3);
commit;
SQL
done
wait
n=$(psql -t -A -c "select count(*) from public.sessions where user_id = '$u'")
refused=$(cat "$tmp"/race*.err | grep -c paywall_locked || true)
echo "séances acceptées : $n, refusées : $refused"
[ "$n" = 2 ] && [ "$refused" = 4 ] || { echo "ÉCHEC : il fallait 2 séances acceptées et 4 refusées"; exit 1; }
echo "OK : grâce de fin de séance tenue sous concurrence (séances différentes)"

# 2. La MÊME séance envoyée 4 fois en même temps par upsert (réessais réseau) : une seule grâce
# consommée, la seconde reste disponible pour une vraie autre séance (test d'existence refait sous le
# verrou consultatif)
v=00000000-0000-0000-0000-000000000802
psql -c "insert into auth.users (id) values ('$v');
         select public.srv_access_purchase('$v', 'com.mdlf.training.pro.monthly', now() + interval '20 days', 'S-802');
         update public.entitlement_claims set expires_at = now() - interval '1 hour' where original_transaction_id = 'S-802';
         select private.access_refresh('$v');" >/dev/null
# Même contenu à la milliseconde près, comme un vrai réessai réseau de la même séance
d=$(psql -t -A -c "select (extract(epoch from now() - interval '1 hour 10 minutes') * 1000)::bigint")
for i in 1 2 3 4; do
  command psql -X -q -h "$tmp" -p "$port" -U postgres -d postgres >/dev/null 2>"$tmp/same$i.err" <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$v', true);
insert into public.sessions (id, data) values ('MEME', jsonb_build_object('date', $d, 'duration', 600000))
  on conflict (user_id, id) do update set data = excluded.data;
select pg_sleep(3);
commit;
SQL
done
wait
used=$(psql -t -A -c "select count(*) from private.social_rate where user_id = '$v' and action = 'session_grace'")
other=$(psql -t -A -c "set role authenticated; select set_config('request.jwt.claim.sub', '$v', false);
  insert into public.sessions (id, data) values ('AUTRE', jsonb_build_object('date', (extract(epoch from now() - interval '1 hour 20 minutes') * 1000)::bigint, 'duration', 600000)) returning id;" 2>/dev/null | tail -1 || true)
echo "même séance x4 : grâces consommées $used, autre séance ensuite : ${other:-refusée}"
[ "$used" = 1 ] && [ "$other" = AUTRE ] || { echo "ÉCHEC : une seule grâce pour la même séance, la seconde pour une autre"; exit 1; }
echo "OK : la même séance envoyée en parallèle ne consomme qu'une grâce"
