-- Vérifications de 20261130010000_import_ia.sql (import aidé par l'IA, docs/IMPORT_IA.md), lancées par tests/sql/run.sh.
-- Rien n'est appliqué en production : Postgres local jetable.

create function pg_temp.ierr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.ierr(text) to authenticated, anon, service_role;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'ia1@exemple.invalid'),
  ('a0000000-0000-4000-8000-000000000002', 'ia2@exemple.invalid');

-- ── Droits : ni anon ni un compte connecté n'appellent les fonctions ni ne lisent les tables ──
do $$
declare f text;
begin
  foreach f in array array['public.plan_ai_reserve(uuid,uuid,text,numeric)', 'public.plan_ai_settle(bigint,boolean,integer,integer,integer,integer)',
    'public.plan_ai_cache_get(text[])', 'public.plan_ai_cache_put(jsonb)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise 'fonction appelable par l''API : %', f; end if;
    if not has_function_privilege('service_role', f, 'execute') then raise 'service_role ne peut pas appeler %', f; end if;
  end loop;
  if has_function_privilege('service_role', 'private.plan_ai_month_usd()', 'execute') then raise 'plan_ai_month_usd appelable'; end if;
  foreach f in array array['private.plan_ai_calls', 'private.plan_ai_cache', 'private.plan_ai_settings', 'private.plan_ai_prices'] loop
    if has_table_privilege('service_role', f, 'select') or has_table_privilege('authenticated', f, 'select') or has_table_privilege('anon', f, 'select') then raise 'table lisible : %', f; end if;
  end loop;
end $$;
set role authenticated;
do $$ begin
  if pg_temp.ierr($q$ select public.plan_ai_reserve('a0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'claude-haiku-5-5', 0.01) $q$) not like 'permission denied%' then raise 'un compte réserve'; end if;
  if pg_temp.ierr($q$ select * from public.plan_ai_cache_get(array['x']) $q$) not like 'permission denied%' then raise 'un compte lit le cache'; end if;
end $$;
reset role;

-- ── Réservation puis règlement : coût réel calculé par la base à partir des tokens ──
set role service_role;
do $$
declare id bigint; c numeric; imp uuid := gen_random_uuid();
begin
  id := public.plan_ai_reserve('a0000000-0000-4000-8000-000000000001', imp, 'claude-haiku-5-5', 0.01);
  -- 1 000 000 en entrée à 0,10 $, 10 000 en sortie à 0,50 $, 100 000 écrits à 0,125 $, 1 000 000 lus à 0,01 $
  c := public.plan_ai_settle(id, true, 1000000, 10000, 100000, 1000000);
  if c <> 0.1 + 0.005 + 0.0125 + 0.01 then raise 'coût réel : %', c; end if;
  -- Déjà réglé : un second règlement ne change rien
  if public.plan_ai_settle(id, true, 1, 1, 1, 1) is not null then raise 'second règlement accepté'; end if;
  -- Modèle inconnu ou pire cas absurde : refusé
  if pg_temp.ierr(format($q$ select public.plan_ai_reserve('a0000000-0000-4000-8000-000000000001', %L, 'gpt-4', 0.01) $q$, imp)) <> 'invalid' then raise 'modèle inconnu accepté'; end if;
  if pg_temp.ierr(format($q$ select public.plan_ai_reserve('a0000000-0000-4000-8000-000000000001', %L, 'claude-haiku-5-5', 50) $q$, imp)) <> 'invalid' then raise 'pire cas de 50 $ accepté'; end if;
end $$;
reset role;

-- ── Quota du compte : 20 imports par jour ; la cascade d'un même import ne compte qu'une fois ──
delete from private.plan_ai_calls;
set role service_role;
do $$
declare imp uuid; i int;
begin
  for i in 1..20 loop
    imp := gen_random_uuid();
    perform public.plan_ai_settle(public.plan_ai_reserve('a0000000-0000-4000-8000-000000000001', imp, 'claude-haiku-5-5', 0.001), true, 100, 10, 0, 0);
  end loop;
  -- Second appel du 20e import (montée au modèle supérieur) : accepté
  perform public.plan_ai_reserve('a0000000-0000-4000-8000-000000000001', imp, 'claude-sonnet-5-5', 0.01);
  if pg_temp.ierr($q$ select public.plan_ai_reserve('a0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'claude-haiku-5-5', 0.001) $q$) <> 'quota_user' then raise '21e import accepté'; end if;
  -- Un autre compte n'est pas touché
  perform public.plan_ai_reserve('a0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'claude-haiku-5-5', 0.001);
  -- Un même import ne fait pas plus de 4 appels
  perform public.plan_ai_reserve('a0000000-0000-4000-8000-000000000001', imp, 'claude-sonnet-5-5', 0.01);
  perform public.plan_ai_reserve('a0000000-0000-4000-8000-000000000001', imp, 'claude-sonnet-5-5', 0.01);
  if pg_temp.ierr(format($q$ select public.plan_ai_reserve('a0000000-0000-4000-8000-000000000001', %L, 'claude-sonnet-5-5', 0.01) $q$, imp)) <> 'quota_user' then raise '5e appel d''un import accepté'; end if;
end $$;
reset role;
-- Les imports d'hier ne comptent plus
update private.plan_ai_calls set at = now() - interval '2 days';
set role service_role;
select public.plan_ai_reserve('a0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'claude-haiku-5-5', 0.001);
reset role;

-- ── Plafond du mois : réservé au pire cas, réglé au réel, refusé au-delà de 15 € ; le mois dernier ne compte pas ──
delete from private.plan_ai_calls;
insert into private.plan_ai_calls (user_id, import_id, model, status, reserved_usd, cost_usd, at)
  values (null, gen_random_uuid(), 'claude-sonnet-5-5', 'ok', 5, 14.90, now()),
         (null, gen_random_uuid(), 'claude-sonnet-5-5', 'ok', 5, 100, now() - interval '40 days');
set role service_role;
do $$
declare id bigint;
begin
  if pg_temp.ierr($q$ select public.plan_ai_reserve('a0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'claude-haiku-5-5', 0.2) $q$) <> 'quota_global' then raise 'plafond dépassé par le pire cas'; end if;
  id := public.plan_ai_reserve('a0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'claude-haiku-5-5', 0.05);
  -- Réservation en cours : son pire cas compte déjà (14,95 €)
  if pg_temp.ierr($q$ select public.plan_ai_reserve('a0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'claude-haiku-5-5', 0.06) $q$) <> 'quota_global' then raise 'réservation en cours non comptée'; end if;
  -- Réglée au réel (bien moins) : de la place revient
  perform public.plan_ai_settle(id, true, 1000, 100, 0, 0);
  perform public.plan_ai_reserve('a0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'claude-haiku-5-5', 0.06);
end $$;
reset role;
-- Échec sans tokens (délai dépassé) : reste compté au pire cas
do $$
declare id bigint;
begin
  delete from private.plan_ai_calls;
  set local role service_role;
  id := public.plan_ai_reserve('a0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'claude-haiku-5-5', 0.5);
  if public.plan_ai_settle(id, false, null, null, null, null) is not null then raise 'échec sans tokens : coût inventé'; end if;
  reset role;
  if private.plan_ai_month_usd() <> 0.5 then raise 'échec sans tokens non compté au pire cas : %', private.plan_ai_month_usd(); end if;
end $$;

-- ── Compte effacé : la dépense reste, le lien au compte part ; purge à 70 jours ──
delete from private.plan_ai_calls;
set role service_role;
select public.plan_ai_settle(public.plan_ai_reserve('a0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'claude-haiku-5-5', 0.01), true, 1000, 100, 0, 0);
reset role;
delete from auth.users where id = 'a0000000-0000-4000-8000-000000000002';
do $$ begin
  if (select count(*) from private.plan_ai_calls where user_id is null) <> 1 then raise 'compte effacé : dépense perdue ou lien gardé'; end if;
end $$;
insert into private.plan_ai_calls (user_id, import_id, model, status, reserved_usd, at) values (null, gen_random_uuid(), 'claude-haiku-5-5', 'ok', 0, now() - interval '80 days');
set role service_role;
select public.plan_ai_reserve('a0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'claude-haiku-5-5', 0.001);
reset role;
do $$ begin
  if exists (select 1 from private.plan_ai_calls where at < now() - interval '70 days') then raise 'purge à 70 jours absente'; end if;
end $$;

-- ── Cache de résultats : écrit, relu, clé invalide ou valeur trop grosse refusée, 30 jours ──
set role service_role;
select public.plan_ai_cache_put(jsonb_build_array(jsonb_build_object('key', repeat('a', 64), 'value', '{"plan": {"sessions": []}}'::jsonb)));
do $$ begin
  if (select count(*) from public.plan_ai_cache_get(array[repeat('a', 64), repeat('b', 64)])) <> 1 then raise 'cache non relu'; end if;
  if pg_temp.ierr($q$ select public.plan_ai_cache_put(jsonb_build_array(jsonb_build_object('key', 'pas-une-empreinte', 'value', '{}'::jsonb))) $q$) not like '%check constraint%' then raise 'clé invalide acceptée'; end if;
  if pg_temp.ierr($q$ select public.plan_ai_cache_put(jsonb_build_array(jsonb_build_object('key', repeat('c', 64), 'value', jsonb_build_object('x', repeat('y', 70000))))) $q$) not like '%check constraint%' then raise 'valeur trop grosse acceptée'; end if;
  if pg_temp.ierr($q$ select public.plan_ai_cache_put('{"key": 1}'::jsonb) $q$) <> 'invalid' then raise 'entrée non tableau acceptée'; end if;
end $$;
reset role;
update private.plan_ai_cache set at = now() - interval '31 days';
set role service_role;
do $$ begin
  if (select count(*) from public.plan_ai_cache_get(array[repeat('a', 64)])) <> 0 then raise 'cache de plus de 30 jours servi'; end if;
end $$;
reset role;
delete from private.plan_ai_calls;
delete from private.plan_ai_cache;
