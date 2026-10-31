#!/usr/bin/env bash
# Retour arrière de 20261031000000_payant_plus.sql (supabase/rollback/20261031000000_payant_plus_down.sql)
# sur un Postgres local jetable : toutes les migrations, des données du payant plus (un accès à vie
# offert gardé, un autre offert puis retiré, un code désactivé), le retour arrière, puis les vérifications des
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
select private.grant_lifetime('00000000-0000-0000-0000-000000000c01', 'gardé');
select private.grant_lifetime('00000000-0000-0000-0000-000000000c02', 'retiré ensuite');
select private.revoke_lifetime('00000000-0000-0000-0000-000000000c02', 'retiré');
create table public.rb_code as select x as code from private.make_gift_code('lifetime', null, 1, 'désactivé') x;
select private.revoke_gift_code((select code from public.rb_code), 'désactivé');
SQL

# Code à vie à plusieurs utilisations, encore valable : c03 retiré, c01 garde son accès
psql >/dev/null <<'SQL'
create table public.rb_multi as select x as code from private.make_gift_code('lifetime', null, 1, 'multi', null, 5) x;
insert into public.gift_redemptions (code, user_id) select code, u from public.rb_multi,
  unnest(array['00000000-0000-0000-0000-000000000c03', '00000000-0000-0000-0000-000000000c01']::uuid[]) u;
update public.gift_codes set uses = 2 where code = (select code from public.rb_multi);
select private.revoke_lifetime('00000000-0000-0000-0000-000000000c03', 'retiré');
SQL

psql -f "$root/supabase/rollback/20261031000000_payant_plus_down.sql"

psql >/dev/null <<'SQL'
do $$
declare st jsonb;
begin
  -- Un accès à vie offert non retiré reste
  if private.access_json('00000000-0000-0000-0000-000000000c01') ->> 'status' <> 'gift' then raise 'accès offert perdu'; end if;
  st := private.access_json('00000000-0000-0000-0000-000000000c02');
  if st ->> 'status' <> 'none' then raise 'accès retiré revenu : %', st; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(st) k) is distinct from
     array['can_write', 'coach_team', 'days_left', 'gift', 'gift_until', 'intro_offer', 'intro_until', 'paywall_on', 'server_now', 'status', 'until']
     then raise 'clés d''avant : %', st; end if;
  if (select count(*) from private.payant_plus_revoked_redemptions) <> 2 then raise 'retraits non mis de côté'; end if;
  if (select expires_at > now() from public.gift_codes where code = (select code from public.rb_code)) then raise 'code désactivé réutilisable'; end if;
  if exists (select 1 from pg_proc where proname in ('grant_lifetime', 'revoke_lifetime', 'revoke_gift_code')) then raise 'fonctions restées'; end if;
  if to_regclass('private.lifetime_access') is not null then raise 'vue restée'; end if;
  -- Code multi-usage : expiré (c03 ne le ressaisit pas), c01 garde son accès
  if (select expires_at > now() from public.gift_codes where code = (select code from public.rb_multi)) then raise 'code multi-usage encore valable'; end if;
  if private.access_json('00000000-0000-0000-0000-000000000c03') ->> 'status' <> 'none' then raise 'retiré : accès revenu'; end if;
  if private.access_json('00000000-0000-0000-0000-000000000c01') ->> 'status' <> 'gift' then raise 'utilisateur légitime : accès perdu'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000c03';
set role authenticated;
do $$ begin
  if (public.redeem_gift_code((select code from public.rb_multi)) ->> 'ok')::boolean then raise 'retiré : code ressaisi'; end if;
end $$;
reset role;
drop table public.rb_code;
drop table public.rb_multi;
SQL
psql -f "$here/tarifs_test.sql"
echo "OK : retour arrière de 20261031000000_payant_plus.sql"
