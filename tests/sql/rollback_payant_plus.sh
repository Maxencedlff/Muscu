#!/usr/bin/env bash
# Retour arrière de 20261031000000_payant_plus.sql (supabase/rollback/20261031000000_payant_plus_down.sql)
# sur un Postgres local jetable : toutes les migrations, des données du payant plus (un achat à vie, un
# accès à vie offert puis retiré, un code désactivé), le retour arrière, puis les vérifications des
# tarifs (tarifs_test.sql) et de l'état d'après. Rien n'est envoyé au projet Supabase.
# Lancer : bash tests/sql/rollback_payant_plus.sh   (Postgres 15+, comme tests/sql/run.sh)
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
for m in "$root"/supabase/migrations/*.sql; do psql -f "$m"; done

psql >/dev/null <<'SQL'
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000c01'), ('00000000-0000-0000-0000-000000000c02'),
  ('00000000-0000-0000-0000-000000000c03');
select public.srv_access_purchase('00000000-0000-0000-0000-000000000c01', 'com.mdlf.training.lifetime', null, 'life-rb', false, now(), null, 'Production');
select private.grant_lifetime('00000000-0000-0000-0000-000000000c02', 'retiré ensuite');
select private.revoke_lifetime('00000000-0000-0000-0000-000000000c02', 'retiré');
create table public.rb_code as select x as code from private.make_gift_code('lifetime', null, 1, 'désactivé') x;
select private.revoke_gift_code((select code from public.rb_code), 'désactivé');
SQL

psql -f "$root/supabase/rollback/20261031000000_payant_plus_down.sql"

psql >/dev/null <<'SQL'
do $$
declare st jsonb;
begin
  if private.access_product_kind('com.mdlf.training.lifetime') is not null then raise 'produit à vie encore reconnu'; end if;
  if (select count(*) from private.payant_plus_life_claims) <> 1 then raise 'achat à vie non mis de côté'; end if;
  if exists (select 1 from public.entitlement_claims where kind <> 'sub') then raise 'registre'; end if;
  st := private.access_json('00000000-0000-0000-0000-000000000c02');
  if st ->> 'status' <> 'none' then raise 'accès retiré revenu : %', st; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(st) k) is distinct from
     array['can_write', 'coach_team', 'days_left', 'gift', 'gift_until', 'intro_offer', 'intro_until', 'paywall_on', 'server_now', 'status', 'until']
     then raise 'clés d''avant : %', st; end if;
  if (select count(*) from private.payant_plus_revoked_redemptions) <> 1 then raise 'retraits non mis de côté'; end if;
  if (select expires_at > now() from public.gift_codes where code = (select code from public.rb_code)) then raise 'code désactivé réutilisable'; end if;
  if exists (select 1 from pg_proc where proname in ('grant_lifetime', 'revoke_lifetime', 'revoke_gift_code', 'access_life_test_days')) then raise 'fonctions restées'; end if;
  -- srv_access_event et access_claim reprennent leur signature d'avant (sans p_reinstate), toujours fermées au client
  if to_regprocedure('public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text)') is null
     or to_regprocedure('public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text, boolean)') is not null
     or to_regprocedure('private.access_claim(uuid, text, timestamptz, text, boolean, timestamptz, boolean, boolean, text)') is null
     then raise 'signatures d''avant non rendues'; end if;
  if has_function_privilege('authenticated', 'public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text)', 'execute')
     or not has_function_privilege('service_role', 'public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text)', 'execute')
     then raise 'droits de srv_access_event'; end if;
end $$;
drop table public.rb_code;
SQL
psql -f "$here/tarifs_test.sql"
echo "OK : retour arrière de 20261031000000_payant_plus.sql"
