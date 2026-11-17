-- Vérifications de 20261117030000_grille_coach.sql (grille coach du 17/11/2026 : 10, 25, 50, 100 élèves),
-- lancées par tests/sql/run.sh. Postgres local jetable. Comptes simulés …000000000f00 à …f6a : C est le
-- coach (rôle validé), S001 à S105 ses élèves dans l'ordre d'arrivée (liens posés directement).

create function pg_temp.ferr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.fu(i int) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-000000000f' || lpad(to_hex(i), 2, '0'))::uuid $$;
create function pg_temp.flogin(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, false) $$;
-- Le coach C (fu(0)) achète la formule p (première souscription Apple), puis en change (même souscription)
create function pg_temp.fbuy(p text) returns text language plpgsql as
$$ declare r text; begin
  set local role service_role;
  r := pg_temp.ferr(format('select public.srv_access_purchase(%L, %L, %L, %L, false, now(), false, %L)', pg_temp.fu(0), p,
         now() + interval '30 days', 'tx-f-coach', 'Production'));
  set local role authenticated;
  return r;
end $$;
create function pg_temp.fchange(p text) returns text language plpgsql as
$$ declare r text; begin
  set local role service_role;
  r := pg_temp.ferr(format('select public.srv_access_event(%L, %L, %L, false, clock_timestamp())', 'tx-f-coach', p, now() + interval '30 days'));
  set local role authenticated;
  return r;
end $$;
create function pg_temp.ftier() returns jsonb language plpgsql as
$$ begin perform pg_temp.flogin(pg_temp.fu(0)); return public.coach_tier_state(); end $$;
grant execute on function pg_temp.ferr(text), pg_temp.fu(int), pg_temp.flogin(uuid), pg_temp.fbuy(text), pg_temp.fchange(text), pg_temp.ftier()
  to authenticated, anon, service_role;

do $$ begin
  if private.coach_product_limit('com.mdlf.training.coach10.monthly') <> 10 or private.coach_product_limit('com.mdlf.training.coach10.yearly') <> 10
     or private.coach_product_limit('com.mdlf.training.coach20.monthly') <> 25 or private.coach_product_limit('com.mdlf.training.coach20.yearly') <> 25
     or private.coach_product_limit('com.mdlf.training.coach30.monthly') <> 50 or private.coach_product_limit('com.mdlf.training.coach30.yearly') <> 50
     or private.coach_product_limit('com.mdlf.training.coachmax.monthly') <> 100 or private.coach_product_limit('com.mdlf.training.coachmax.yearly') <> 100
     or private.coach_product_limit('com.mdlf.training.pro.monthly') is not null then raise 'grille : limites des produits'; end if;
  if has_function_privilege('authenticated', 'private.coach_product_limit(text)', 'execute') then raise 'coach_product_limit ouverte'; end if;
  if not has_function_privilege('authenticated', 'public.coach_tier_state()', 'execute')
     or has_function_privilege('anon', 'public.coach_tier_state()', 'execute') then raise 'droits de coach_tier_state'; end if;
end $$;

insert into auth.users (id) select pg_temp.fu(i) from generate_series(0, 105) i;
insert into public.user_profiles (user_id, username, avatar_emoji) select pg_temp.fu(i), 'grille' || i || '.f1', '🐺' from generate_series(0, 105) i;
insert into public.coach_requests (user_id, card_name, card_number, diploma) values (pg_temp.fu(0), 'Chloé C', 'CCCCCC1', 'BPJEPS');
select private.approve_coach(pg_temp.fu(0), 'carte factice');
create temp table fcode as select code from public.coach_invites where coach_id = pg_temp.fu(0) and permanent;
grant select on fcode to authenticated;
update public.app_config set value = 'true'::jsonb where key = 'paywall_on';

set role authenticated;
do $$
declare st jsonb;
begin
  -- 25 élèves au palier 20 (25 élèves) : tous offerts, palier plein, 50 conseillé
  reset role;
  insert into public.coach_links (student_id, coach_id, created_at)
    select pg_temp.fu(i), pg_temp.fu(0), now() - interval '30 days' + i * interval '1 minute' from generate_series(1, 25) i;
  set role authenticated;
  if pg_temp.fbuy('com.mdlf.training.coach20.yearly') <> 'ok' then raise 'achat coach20'; end if;
  st := pg_temp.ftier();
  if (st ->> 'limit')::int <> 25 or not (st ->> 'full')::boolean or (st ->> 'uncovered')::int <> 0
     or st ->> 'next_product' <> 'com.mdlf.training.coach30.monthly' or (st ->> 'contact')::boolean then raise 'palier 25 : %', st; end if;
  perform pg_temp.flogin(pg_temp.fu(25));
  if public.my_access() ->> 'status' <> 'coach_team' then raise '25e élève pas offert : %', public.my_access(); end if;
  -- Palier 30 (50 élèves) : 50 offerts, le 51e ne l'est pas
  if pg_temp.fchange('com.mdlf.training.coach30.monthly') <> 'ok' then raise 'achat coach30'; end if;
  reset role;
  insert into public.coach_links (student_id, coach_id, created_at)
    select pg_temp.fu(i), pg_temp.fu(0), now() - interval '29 days' + i * interval '1 minute' from generate_series(26, 51) i;
  set role authenticated;
  st := pg_temp.ftier();
  if (st ->> 'limit')::int <> 50 or (st ->> 'uncovered')::int <> 1 or st ->> 'next_product' <> 'com.mdlf.training.coachmax.monthly' then raise 'palier 50 : %', st; end if;
  perform pg_temp.flogin(pg_temp.fu(50));
  if public.my_access() ->> 'status' <> 'coach_team' then raise '50e élève pas offert'; end if;
  perform pg_temp.flogin(pg_temp.fu(51));
  if public.my_access() -> 'coach_cover' ->> 'state' <> 'over_limit' then raise '51e élève : %', public.my_access(); end if;
  -- Palier max (100 élèves, plus d'illimité) : 100 offerts, plus de palier au-dessus, contact proposé ; le 101e refusé
  if pg_temp.fchange('com.mdlf.training.coachmax.yearly') <> 'ok' then raise 'achat coachmax'; end if;
  reset role;
  insert into public.coach_links (student_id, coach_id, created_at)
    select pg_temp.fu(i), pg_temp.fu(0), now() - interval '28 days' + i * interval '1 minute' from generate_series(52, 100) i;
  set role authenticated;
  st := pg_temp.ftier();
  if (st ->> 'limit')::int <> 100 or (st ->> 'students')::int <> 100 or not (st ->> 'full')::boolean or (st ->> 'uncovered')::int <> 0
     or st -> 'next_product' <> 'null'::jsonb or not (st ->> 'contact')::boolean then raise 'palier 100 : %', st; end if;
  perform pg_temp.flogin(pg_temp.fu(100));
  if public.my_access() ->> 'status' <> 'coach_team' then raise '100e élève pas offert'; end if;
  perform pg_temp.flogin(pg_temp.fu(101));
  if pg_temp.ferr(format('select public.coach_join(%L)', (select code from fcode limit 1)))
     is distinct from 'tier_full' then raise '101e élève accepté'; end if;
end $$;
reset role;

-- Verrou éteint : jamais bloqué en dessous de 50 sans abonnement, contact seulement au palier max
do $$
declare st jsonb;
begin
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
  set local role authenticated;
  st := pg_temp.ftier();
  if (st ->> 'limit')::int <> 100 or not (st ->> 'contact')::boolean then raise 'verrou éteint, palier max : %', st; end if;
end $$;
reset role;

-- Ménage (les autres tests partent d'une base sans ces comptes)
delete from public.coach_links where coach_id = pg_temp.fu(0);
delete from auth.users where id in (select pg_temp.fu(i) from generate_series(0, 105) i);
update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
