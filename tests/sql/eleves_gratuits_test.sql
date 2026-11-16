-- Vérifications de 20261116030000_eleves_gratuits.sql (élèves offerts par leur coach, décision du
-- 16/11/2026), lancées par tests/sql/run.sh. Rien n'est appliqué en production : Postgres local jetable.
-- Comptes simulés …000000000e00 à …e3f : K est le coach (rôle validé), L un élève qui paie lui-même,
-- Z n'a pas de coach, E01 à E15 sont les élèves de K dans l'ordre d'arrivée.
-- Le temps qui passe est simulé en reculant les dates du serveur (fin d'abonnement, descente de palier,
-- retrait du rôle), jamais en touchant l'horloge.

create function pg_temp.gerr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.gu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-000000000e' || c)::uuid $$;
create function pg_temp.ge(i int) returns uuid language sql immutable as
$$ select pg_temp.gu(lpad(to_hex(i), 2, '0')) $$;
create function pg_temp.glogin(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, false) $$;
create function pg_temp.gsrv(stmt text) returns text language plpgsql as
$$
declare r text;
begin
  set local role service_role;
  r := pg_temp.gerr(stmt);
  set local role authenticated;
  return r;
end
$$;
-- État d'accès vu par l'élève (comme l'app : my_access)
create function pg_temp.gacc(u uuid) returns jsonb language plpgsql as
$$ begin perform pg_temp.glogin(u); return public.my_access(); end $$;
-- Une séance neuve de l'élève : 'ok' ou l'erreur du verrou
create function pg_temp.gsess(u uuid, id text) returns text language plpgsql as
$$ begin perform pg_temp.glogin(u);
   return pg_temp.gerr(format($q$ insert into public.sessions (id, data) values (%L, '{"date": 1780000000000, "exercises": []}') $q$, id)); end $$;
grant execute on function pg_temp.gerr(text), pg_temp.gu(text), pg_temp.ge(int), pg_temp.glogin(uuid), pg_temp.gsrv(text),
  pg_temp.gacc(uuid), pg_temp.gsess(uuid, text) to authenticated, anon, service_role;

insert into auth.users (id) values (pg_temp.gu('a0')), (pg_temp.gu('a1')), (pg_temp.gu('a2'));
insert into auth.users (id) select pg_temp.ge(i) from generate_series(1, 15) i;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.gu('a0'), 'karim.g1', '🦁'), (pg_temp.gu('a1'), 'lina.g1', '🦊'), (pg_temp.gu('a2'), 'zoe.g1', '🐼');
insert into public.user_profiles (user_id, username, avatar_emoji)
  select pg_temp.ge(i), 'eleve' || i || '.g1', '🐺' from generate_series(1, 15) i;
-- K : rôle coach validé par l'administrateur (demande puis validation)
insert into public.coach_requests (user_id, card_name, card_number, diploma) values (pg_temp.gu('a0'), 'Karim K', 'KKKKKK1', 'BPJEPS');
select private.approve_coach(pg_temp.gu('a0'), 'carte factice');
-- E01 à E15 et L chez K, arrivés dans cet ordre (liens posés directement : le palier se teste ailleurs)
insert into public.coach_links (student_id, coach_id, created_at)
  select pg_temp.ge(i), pg_temp.gu('a0'), now() - interval '30 days' + i * interval '1 minute' from generate_series(1, 15) i;
insert into public.coach_links (student_id, coach_id, created_at) values (pg_temp.gu('a1'), pg_temp.gu('a0'), now());
update public.app_config set value = 'true'::jsonb where key = 'paywall_on';

set role authenticated;
-- ── Sans coach : règle normale ; coach sans abonnement coach : rien d'offert ──
do $$
declare st jsonb;
begin
  st := pg_temp.gacc(pg_temp.gu('a2'));
  if st ->> 'status' <> 'none' or (st ->> 'can_write')::boolean or st -> 'coach_cover' <> 'null'::jsonb then raise 'sans coach : %', st; end if;
  st := pg_temp.gacc(pg_temp.ge(1));
  if st ->> 'status' <> 'none' or (st ->> 'can_write')::boolean or (st ->> 'coach_team')::boolean
     or st -> 'coach_cover' ->> 'state' <> 'ended' or st -> 'coach_cover' ->> 'coach' <> 'karim.g1' then raise 'coach sans abonnement : %', st; end if;
  if pg_temp.gsess(pg_temp.ge(1), 'g-1') <> 'paywall_locked' then raise 'séance acceptée, coach sans abonnement'; end if;
  perform pg_temp.glogin(pg_temp.gu('a0'));
  if (public.coach_tier_state() ->> 'uncovered')::int <> 16 then raise 'coach sans abonnement : élèves non couverts %', public.coach_tier_state(); end if;
end $$;

-- ── Coach abonné au palier 20 : ses 16 élèves sont offerts ──
do $$
declare st jsonb;
begin
  if pg_temp.gsrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, now(), false, %L)', pg_temp.gu('a0'),
       'com.mdlf.training.coach20.monthly', now() + interval '30 days', 'tx-g-coach', 'Production')) <> 'ok' then raise 'achat coach'; end if;
  st := pg_temp.gacc(pg_temp.ge(1));
  if st ->> 'status' <> 'coach_team' or not (st ->> 'can_write')::boolean or not (st ->> 'coach_team')::boolean
     or st -> 'until' <> 'null'::jsonb or st -> 'days_left' <> 'null'::jsonb or st -> 'coach_cover' ->> 'state' <> 'active'
     or st -> 'coach_cover' -> 'until' <> 'null'::jsonb then raise 'élève offert : %', st; end if;
  if pg_temp.gsess(pg_temp.ge(1), 'g-2') <> 'ok' then raise 'séance de l''élève offert refusée'; end if;
  if pg_temp.gacc(pg_temp.ge(15)) ->> 'status' <> 'coach_team' then raise '15e élève, palier 20'; end if;
  -- Le coach lui-même : son abonnement coach, inchangé
  st := pg_temp.gacc(pg_temp.gu('a0'));
  if st ->> 'status' <> 'active' or st -> 'coach_cover' <> 'null'::jsonb then raise 'coach : %', st; end if;
  if (public.coach_tier_state() ->> 'uncovered')::int <> 0 then raise 'palier 20 : %', public.coach_tier_state(); end if;
  -- Élève qui paie lui-même : « active », l'offre du coach est dite (il peut résilier)
  if pg_temp.gsrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.gu('a1'),
       'com.mdlf.training.pro.monthly', now() + interval '20 days', 'tx-g-lina')) <> 'ok' then raise 'achat élève'; end if;
  st := pg_temp.gacc(pg_temp.gu('a1'));
  if st ->> 'status' <> 'active' or st -> 'coach_cover' ->> 'state' <> 'active' then raise 'élève abonné : %', st; end if;
  -- Verrou éteint : rien ne change, l'offre reste dite
  reset role;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
  set role authenticated;
  st := pg_temp.gacc(pg_temp.gu('a2'));
  if not (st ->> 'can_write')::boolean then raise 'verrou éteint : %', st; end if;
  if pg_temp.gacc(pg_temp.ge(2)) ->> 'status' <> 'coach_team' then raise 'verrou éteint, élève offert'; end if;
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  -- Instantané (lecture de l'administrateur) mis à jour par my_access
  if (select status from public.entitlements where user_id = pg_temp.ge(1)) <> 'coach_team' then raise 'instantané'; end if;
  set role authenticated;
end $$;

-- ── Descente au palier 10 : les élèves 11 à 16 gardent 7 jours, puis message « au-delà du palier » ──
do $$
declare st jsonb;
begin
  if pg_temp.gsrv(format('select public.srv_access_event(%L, %L, %L, false, now() + interval ''1 second'')', 'tx-g-coach',
       'com.mdlf.training.coach10.monthly', now() + interval '30 days')) <> 'ok' then raise 'descente de palier'; end if;
  reset role;
  if (select count(*) from private.coach_tier_log where coach_id = pg_temp.gu('a0') and old_limit = 20) <> 1 then raise 'descente non notée'; end if;
  set role authenticated;
  if pg_temp.gacc(pg_temp.ge(10)) -> 'coach_cover' ->> 'state' <> 'active' then raise '10e élève, palier 10'; end if;
  st := pg_temp.gacc(pg_temp.ge(11));
  if st ->> 'status' <> 'coach_team' or not (st ->> 'can_write')::boolean or st -> 'coach_cover' ->> 'state' <> 'grace'
     or (st ->> 'until')::timestamptz not between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute'
     or (st ->> 'days_left')::int <> 7 or st -> 'coach_cover' ->> 'until' is distinct from st ->> 'until' then raise '11e élève en grâce : %', st; end if;
  perform pg_temp.glogin(pg_temp.gu('a0'));
  st := public.coach_tier_state();
  if (st ->> 'uncovered')::int <> 6 or (st ->> 'limit')::int <> 10 or st ->> 'next_product' <> 'com.mdlf.training.coach20.monthly'
    then raise 'coach au-delà du palier : %', st; end if;
  -- 8 jours plus tard : plus offert, message clair, jamais facturé (aucun achat n'est fait pour lui)
  reset role;
  update private.coach_tier_log set changed_at = now() - interval '8 days' where coach_id = pg_temp.gu('a0');
  set role authenticated;
  st := pg_temp.gacc(pg_temp.ge(11));
  if st ->> 'status' <> 'none' or (st ->> 'can_write')::boolean or (st ->> 'coach_team')::boolean
     or st -> 'coach_cover' ->> 'state' <> 'over_limit' then raise '11e élève au-delà du palier : %', st; end if;
  if pg_temp.gsess(pg_temp.ge(11), 'g-3') <> 'paywall_locked' then raise 'séance acceptée au-delà du palier'; end if;
  reset role;
  if exists (select 1 from public.entitlement_claims where user_id = pg_temp.ge(11)) then raise 'élève facturé'; end if;
  -- Un élève offert part : le suivant entre dans le palier
  delete from public.coach_links where student_id = pg_temp.ge(3);
  set role authenticated;
  if pg_temp.gacc(pg_temp.ge(11)) -> 'coach_cover' ->> 'state' <> 'active' then raise 'place libérée'; end if;
  if pg_temp.gacc(pg_temp.ge(12)) -> 'coach_cover' ->> 'state' <> 'over_limit' then raise '12e toujours au-delà'; end if;
  -- Remontée au palier 20 : tous offerts tout de suite
  if pg_temp.gsrv(format('select public.srv_access_event(%L, %L, %L, false, now() + interval ''2 seconds'')', 'tx-g-coach',
       'com.mdlf.training.coach20.monthly', now() + interval '30 days')) <> 'ok' then raise 'montée'; end if;
  if pg_temp.gacc(pg_temp.ge(15)) ->> 'status' <> 'coach_team' then raise 'montée : 15e offert'; end if;
  reset role;
  if (select count(*) from private.coach_tier_log where changed_at > now() - interval '1 day') <> 0 then raise 'une montée notée comme descente'; end if;
  set role authenticated;
end $$;

-- ── Fin de l'abonnement coach : 7 jours de grâce, puis l'essai ou l'abonnement normal ──
do $$
declare st jsonb;
begin
  reset role;
  update public.entitlement_claims set expires_at = now() - interval '1 day' where original_transaction_id = 'tx-g-coach';
  perform private.access_refresh(pg_temp.gu('a0'));
  set role authenticated;
  st := pg_temp.gacc(pg_temp.ge(1));
  if st ->> 'status' <> 'coach_team' or st -> 'coach_cover' ->> 'state' <> 'grace'
     or (st ->> 'until')::timestamptz not between now() + interval '5 days 23 hours' and now() + interval '6 days 1 minute'
     then raise 'grâce après la fin : %', st; end if;
  if pg_temp.gsess(pg_temp.ge(1), 'g-4') <> 'ok' then raise 'séance refusée pendant la grâce'; end if;
  perform pg_temp.glogin(pg_temp.gu('a0'));
  if public.my_access() ->> 'status' <> 'expired' or (public.coach_tier_state() ->> 'uncovered')::int <> 15 then raise 'coach résilié : %', public.coach_tier_state(); end if;
  reset role;
  update public.entitlement_claims set expires_at = now() - interval '8 days' where original_transaction_id = 'tx-g-coach';
  set role authenticated;
  st := pg_temp.gacc(pg_temp.ge(1));
  if st ->> 'status' <> 'none' or (st ->> 'can_write')::boolean or st -> 'coach_cover' ->> 'state' <> 'ended' then raise 'après la grâce : %', st; end if;
  if pg_temp.gsess(pg_temp.ge(1), 'g-5') <> 'paywall_locked' then raise 'séance acceptée après la grâce'; end if;
  -- Rien n'est perdu : ses séances sont toujours là, il peut les corriger et elles restent lisibles
  reset role;
  if (select count(*) from public.sessions where user_id = pg_temp.ge(1) and id in ('g-2', 'g-4')) <> 2 then raise 'séances perdues'; end if;
  set role authenticated;
  perform pg_temp.glogin(pg_temp.ge(1));
  if pg_temp.gerr($q$ update public.sessions set data = '{"date": 1780000000000, "notes": "corrigée", "exercises": []}' where id = 'g-2' $q$) <> 'ok' then raise 'correction refusée'; end if;
  -- L'élève s'abonne lui-même (essai d'Apple compris) : règle normale
  if pg_temp.gsrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, now(), true, %L)', pg_temp.ge(1),
       'com.mdlf.training.pro.monthly', now() + interval '90 days', 'tx-g-e1', 'Production')) <> 'ok' then raise 'achat après la grâce'; end if;
  st := pg_temp.gacc(pg_temp.ge(1));
  if st ->> 'status' <> 'active' or not (st ->> 'intro_offer')::boolean then raise 'élève abonné après la grâce : %', st; end if;
end $$;

-- ── Remboursement de l'abonnement coach : même grâce ; rôle retiré : même grâce ──
do $$
declare st jsonb;
begin
  -- Réabonnement du coach (nouvelle souscription), puis remboursement il y a une heure
  if pg_temp.gsrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.gu('a0'),
       'com.mdlf.training.coachmax.monthly', now() + interval '30 days', 'tx-g-coach2')) <> 'ok' then raise 'réabonnement coach'; end if;
  if pg_temp.gacc(pg_temp.ge(2)) -> 'coach_cover' ->> 'state' <> 'active' then raise 'réabonnement : offert'; end if;
  reset role;
  update public.entitlement_claims set revoked_at = now() - interval '1 hour' where original_transaction_id = 'tx-g-coach2';
  perform private.access_refresh(pg_temp.gu('a0'));
  set role authenticated;
  st := pg_temp.gacc(pg_temp.ge(2));
  if st -> 'coach_cover' ->> 'state' <> 'grace' or st ->> 'status' <> 'coach_team' then raise 'remboursement : %', st; end if;
  reset role;
  update public.entitlement_claims set revoked_at = null where original_transaction_id = 'tx-g-coach2';
  -- Rôle retiré (carte expirée) : 7 jours, même avec un abonnement coach en cours
  perform private.revoke_coach(pg_temp.gu('a0'), 'Carte expirée.');
  set role authenticated;
  st := pg_temp.gacc(pg_temp.ge(2));
  if st -> 'coach_cover' ->> 'state' <> 'grace' or (st ->> 'until')::timestamptz > now() + interval '7 days 1 minute' then raise 'rôle retiré : %', st; end if;
  reset role;
  update public.coach_requests set decided_at = now() - interval '8 days' where user_id = pg_temp.gu('a0');
  set role authenticated;
  st := pg_temp.gacc(pg_temp.ge(2));
  if st ->> 'status' <> 'none' or st -> 'coach_cover' ->> 'state' <> 'ended' then raise 'rôle retiré, grâce passée : %', st; end if;
  -- Validé de nouveau : offert de nouveau
  reset role;
  perform private.approve_coach(pg_temp.gu('a0'));
  set role authenticated;
  if pg_temp.gacc(pg_temp.ge(2)) ->> 'status' <> 'coach_team' then raise 'rôle rendu'; end if;
end $$;
reset role;

-- ── Droits : rien de nouveau n'est exécutable ni lisible par l'API ──
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'private'::regnamespace
             and p.proname in ('coach_cover', 'coach_cover_grace', 'coach_tier_log_claim') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute') then raise '% : exécutable par l''API', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'private.coach_tier_log', 'select') or has_table_privilege('service_role', 'private.coach_tier_log', 'select')
    then raise 'journal des paliers lisible'; end if;
  if to_regprocedure('public.student_offer_code(text)') is not null then raise 'offre élève restée'; end if;
  if has_function_privilege('anon', 'public.coach_tier_state()', 'execute') then raise 'anon lit un palier'; end if;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
end $$;

-- Comptes du test retirés (les autres lots comptent les coachs et les attributions du parrainage)
delete from auth.users where id in (select pg_temp.gu(c) from unnest(array['a0', 'a1', 'a2']) c)
                          or id in (select pg_temp.ge(i) from generate_series(1, 15) i);
