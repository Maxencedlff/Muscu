-- Vérifications de 20261117020000_promo_coach.sql (essai coach de 2 mois par offre promotionnelle d'Apple
-- pour qui a déjà eu un essai), lancées par tests/sql/run.sh. Postgres local jetable, rien n'est appliqué en
-- production. Comptes simulés …000000000f00 à …f05 :
--   C  coach validé qui a eu l'essai particulier (le cas visé) ;
--   D  coach validé qui a déjà eu un abonnement coach, puis est redescendu au particulier ;
--   N  compte qui n'est pas coach ;
--   R  coach validé, pour le débit.

create function pg_temp.perr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.pu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-000000000f' || c)::uuid $$;
create function pg_temp.plogin(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, false) $$;
-- Comme la fonction Edge (clé serveur) : réponse jsonb de srv_coach_promo_grant
create function pg_temp.pgrant(u uuid, product text, intro boolean) returns jsonb language plpgsql as
$$
declare r jsonb;
begin
  set local role service_role;
  r := public.srv_coach_promo_grant(u, product, intro);
  set local role authenticated;
  return r;
end
$$;
create function pg_temp.psrv(stmt text) returns text language plpgsql as
$$
declare r text;
begin
  set local role service_role;
  r := pg_temp.perr(stmt);
  set local role authenticated;
  return r;
end
$$;
create function pg_temp.pstate(u uuid) returns jsonb language plpgsql as
$$ begin perform pg_temp.plogin(u); return public.coach_promo_state(); end $$;
grant execute on function pg_temp.perr(text), pg_temp.pu(text), pg_temp.plogin(uuid), pg_temp.pgrant(uuid, text, boolean),
  pg_temp.psrv(text), pg_temp.pstate(uuid) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.pu(c) from unnest(array['00', '01', '02', '03']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.pu('00'), 'cyril.p1', '🦁'), (pg_temp.pu('01'), 'dora.p1', '🦊'), (pg_temp.pu('02'), 'nino.p1', '🐼'),
  (pg_temp.pu('03'), 'remi.p1', '🐺');
insert into public.coach_requests (user_id, card_name, card_number, diploma)
  select pg_temp.pu(c), 'Coach ' || c, 'PPPPPP' || c, 'BPJEPS' from unnest(array['00', '01', '03']) c;
do $$ begin perform private.approve_coach(pg_temp.pu(c), 'carte factice') from unnest(array['00', '01', '03']) c; end $$;

set role authenticated;

-- ── C : essai particulier eu, jamais coach : droit à l'offre ──
do $$
declare r jsonb;
begin
  -- L'essai particulier de 3 mois d'Apple (offre de lancement), en cours
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, now(), true, %L)', pg_temp.pu('00'),
       'com.mdlf.training.pro.monthly', now() + interval '60 days', 'tx-p-cyril', 'Production')) <> 'ok' then raise 'achat particulier'; end if;
  r := pg_temp.pstate(pg_temp.pu('00'));
  if r <> '{"eligible": true, "reason": null}'::jsonb then raise 'C état : %', r; end if;
  -- StoreKit dit qu'il a encore droit à l'offre de lancement : pas de signature (il prend l'essai normal)
  r := pg_temp.pgrant(pg_temp.pu('00'), 'com.mdlf.training.coach10.monthly', true);
  if r <> '{"ok": false, "error": "intro_eligible"}'::jsonb then raise 'C éligible à l''essai de lancement : %', r; end if;
  r := pg_temp.pgrant(pg_temp.pu('00'), 'com.mdlf.training.coach10.monthly', null);
  if r ->> 'error' <> 'intro_eligible' then raise 'C éligibilité inconnue : %', r; end if;
  -- Produit qui n'est pas coach
  r := pg_temp.pgrant(pg_temp.pu('00'), 'com.mdlf.training.pro.yearly', false);
  if r <> '{"ok": false, "error": "unknown_product"}'::jsonb then raise 'C produit particulier : %', r; end if;
  -- Signé : l'identifiant d'offre d'App Store Connect
  r := pg_temp.pgrant(pg_temp.pu('00'), 'com.mdlf.training.coach20.yearly', false);
  if r <> '{"ok": true, "offer_id": "com.mdlf.training.coach20.yearly.essai2mois"}'::jsonb then raise 'C signé : %', r; end if;
  -- Achat raté (feuille fermée) : il peut redemander, un autre palier
  r := pg_temp.pgrant(pg_temp.pu('00'), 'com.mdlf.training.coach10.monthly', false);
  if r ->> 'offer_id' <> 'com.mdlf.training.coach10.monthly.essai2mois' then raise 'C seconde signature : %', r; end if;
  reset role;
  if (select row(product_id, signatures, redeemed_at is null)::text from public.coach_promo_offers where user_id = pg_temp.pu('00'))
     <> '(com.mdlf.training.coach10.monthly,2,t)' then raise 'C trace : %', (select row(o.*) from public.coach_promo_offers o where user_id = pg_temp.pu('00')); end if;
  set role authenticated;
  -- L'achat arrive : montée du particulier au coach, MÊME souscription Apple (original_transaction_id)
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, now() + interval ''1 second'')', 'tx-p-cyril',
       'com.mdlf.training.coach10.monthly', now() + interval '60 days')) <> 'ok' then raise 'montée au coach'; end if;
  reset role;
  if (select redeemed_at is not null and redeemed_product = 'com.mdlf.training.coach10.monthly' from public.coach_promo_offers
       where user_id = pg_temp.pu('00')) is not true then raise 'C offre non notée utilisée'; end if;
  set role authenticated;
  -- Une seule fois par compte : plus jamais, même après une redescente au particulier
  r := pg_temp.pstate(pg_temp.pu('00'));
  if r <> '{"eligible": false, "reason": "had_coach"}'::jsonb then raise 'C après achat : %', r; end if;
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, now() + interval ''2 seconds'')', 'tx-p-cyril',
       'com.mdlf.training.pro.monthly', now() + interval '60 days')) <> 'ok' then raise 'redescente'; end if;
  r := pg_temp.pgrant(pg_temp.pu('00'), 'com.mdlf.training.coach10.monthly', false);
  if r <> '{"ok": false, "error": "had_coach"}'::jsonb then raise 'C redescendu : %', r; end if;
end $$;

-- ── D : abonnement coach eu avant la migration (relu à la montée) ; N : pas coach ──
do $$
declare r jsonb;
begin
  -- D achète coach (le déclencheur le note), puis repasse au particulier
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, now(), false, %L)', pg_temp.pu('01'),
       'com.mdlf.training.coachmax.yearly', now() + interval '300 days', 'tx-p-dora', 'Production')) <> 'ok' then raise 'achat D'; end if;
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, now() + interval ''1 second'')', 'tx-p-dora',
       'com.mdlf.training.pro.yearly', now() + interval '300 days')) <> 'ok' then raise 'redescente D'; end if;
  r := pg_temp.pstate(pg_temp.pu('01'));
  if r <> '{"eligible": false, "reason": "had_coach"}'::jsonb then raise 'D : %', r; end if;
  if pg_temp.pgrant(pg_temp.pu('01'), 'com.mdlf.training.coach10.yearly', false) ->> 'error' <> 'had_coach' then raise 'D signé'; end if;
  -- N : pas de rôle coach (acheter un abonnement coach ne le donne pas)
  r := pg_temp.pstate(pg_temp.pu('02'));
  if r <> '{"eligible": false, "reason": "not_coach"}'::jsonb then raise 'N : %', r; end if;
  if pg_temp.pgrant(pg_temp.pu('02'), 'com.mdlf.training.coach10.monthly', false) ->> 'error' <> 'not_coach' then raise 'N signé'; end if;
  -- Compte inconnu : exception not_found (la fonction Edge n'appelle qu'avec un jeton vérifié)
  if pg_temp.psrv(format('select public.srv_coach_promo_grant(%L, %L, false)', '00000000-0000-0000-0000-00000000ffff',
       'com.mdlf.training.coach10.monthly')) <> 'not_found' then raise 'compte inconnu'; end if;
end $$;

-- ── R : 5 signatures par 24 h, 10 en tout ──
do $$
declare r jsonb;
begin
  for i in 1..5 loop
    if not (pg_temp.pgrant(pg_temp.pu('03'), 'com.mdlf.training.coach30.monthly', false) ->> 'ok')::boolean then raise 'R signature %', i; end if;
  end loop;
  r := pg_temp.pgrant(pg_temp.pu('03'), 'com.mdlf.training.coach30.monthly', false);
  if r <> '{"ok": false, "error": "rate_limited"}'::jsonb then raise 'R 6e en 24 h : %', r; end if;
  -- Le refus n'a rien annulé : le compteur reste à 5
  reset role;
  if (select signatures from public.coach_promo_offers where user_id = pg_temp.pu('03')) <> 5 then raise 'R compteur'; end if;
  -- Un jour plus tard (journal vieilli) : 5 de plus, puis plus jamais
  update private.social_rate set at = at - interval '25 hours' where user_id = pg_temp.pu('03') and action = 'coach_promo';
  set role authenticated;
  for i in 6..10 loop
    if not (pg_temp.pgrant(pg_temp.pu('03'), 'com.mdlf.training.coach30.monthly', false) ->> 'ok')::boolean then raise 'R signature %', i; end if;
  end loop;
  reset role;
  update private.social_rate set at = at - interval '25 hours' where user_id = pg_temp.pu('03') and action = 'coach_promo';
  set role authenticated;
  r := pg_temp.pgrant(pg_temp.pu('03'), 'com.mdlf.training.coach30.monthly', false);
  if r <> '{"ok": false, "error": "too_many"}'::jsonb then raise 'R 11e : %', r; end if;
  if pg_temp.pstate(pg_temp.pu('03')) <> '{"eligible": false, "reason": "too_many"}'::jsonb then raise 'R état'; end if;
end $$;

-- ── Droits : rien de lisible ni d'exécutable par l'API, sauf les deux RPC voulues ──
reset role;
do $$
declare f regprocedure;
begin
  if has_table_privilege('authenticated', 'public.coach_promo_offers', 'select') or has_table_privilege('anon', 'public.coach_promo_offers', 'select')
     or has_table_privilege('service_role', 'public.coach_promo_offers', 'select') or has_table_privilege('service_role', 'public.coach_promo_offers', 'insert')
    then raise 'demandes d''offre lisibles ou écrites par l''API'; end if;
  if has_table_privilege('authenticated', 'private.coach_sub_seen', 'select') or has_table_privilege('service_role', 'private.coach_sub_seen', 'select')
    then raise 'journal coach lisible'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.coach_promo_offers'::regclass) then raise 'RLS ouverte'; end if;
  if has_function_privilege('anon', 'public.coach_promo_state()', 'execute') then raise 'anon lit l''offre'; end if;
  if not has_function_privilege('authenticated', 'public.coach_promo_state()', 'execute') then raise 'app sans état'; end if;
  if has_function_privilege('authenticated', 'public.srv_coach_promo_grant(uuid, text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.srv_coach_promo_grant(uuid, text, boolean)', 'execute') then raise 'signature demandée sans le serveur'; end if;
  if not has_function_privilege('service_role', 'public.srv_coach_promo_grant(uuid, text, boolean)', 'execute') then raise 'serveur sans droit'; end if;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'coach_promo%' loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute') then raise '% : exécutable par l''API', f; end if;
  end loop;
  -- Sans session : refus
  perform set_config('request.jwt.claim.sub', '', false);
  if pg_temp.perr('select public.coach_promo_state()') <> 'not_found' then raise 'sans session'; end if;
  -- La vue d'administration voit les demandes
  if (select count(*) from private.coach_promo_admin where username in ('cyril.p1', 'remi.p1')) <> 2 then raise 'vue d''administration'; end if;
end $$;

-- Comptes du test retirés (les autres lots comptent les coachs et les attributions du parrainage) ; les
-- tables de l'offre partent en cascade
delete from auth.users where id in (select pg_temp.pu(c) from unnest(array['00', '01', '02', '03']) c);
do $$ begin
  if exists (select 1 from public.coach_promo_offers) or exists (select 1 from private.coach_sub_seen) then raise 'cascade'; end if;
end $$;
