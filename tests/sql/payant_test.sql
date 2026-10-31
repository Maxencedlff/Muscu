-- Vérifications de Payant V1 après TOUTES les migrations (20261028000000_payant.sql puis
-- 20261029000000_payant_modele_b.sql : essai géré par Apple), lancées par tests/sql/run.sh.
-- Chaque bloc échoue (raise) si la règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.pu('a') → …00000000070a) : A fait le parcours essai → payé → expiré ;
-- B reçoit un « accès offert » d'Apple ; C est coach et D son élève ; E essaie de voler la transaction
-- de A ; F laisse son essai s'éteindre et sert aux limites de débit ; G et H utilisent des codes cadeaux. pg_temp.plogin change d'utilisateur (auth.uid()) sans changer de rôle,
-- comme un autre jeton. Rien n'est appliqué en production : Postgres local jetable (run.sh).

create function pg_temp.perr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.pu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000070' || translate(c, 'abcdefghij', 'abcdef7890'))::uuid $$;
create function pg_temp.plogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.pu(c)::text, false) $$;
-- Un droit d'accès écrit comme le fait une Edge Function (clé serveur), sans quitter le rôle courant
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
grant execute on function pg_temp.perr(text), pg_temp.pu(text), pg_temp.plogin(text), pg_temp.psrv(text)
  to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.pu(c) from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.pu('a'), 'anna.p1', '🦁'), (pg_temp.pu('b'), 'bob.p1', '🦊'), (pg_temp.pu('c'), 'cyril.p1', '🦅'),
  (pg_temp.pu('d'), 'dina.p1', '🐼'), (pg_temp.pu('e'), 'eva.p1', '⭐'), (pg_temp.pu('f'), 'fred.p1', '🦉'),
  (pg_temp.pu('g'), 'gaby.p1', '🐺'), (pg_temp.pu('h'), 'hugo.p1', '🦈'),
  (pg_temp.pu('i'), 'ines.p1', '🐙'), (pg_temp.pu('j'), 'jules.p1', '🏔️');
-- C est coach (rôle donné par l'administrateur) et D est son élève
update public.user_profiles set coach_at = now() where user_id = pg_temp.pu('c');

-- ── Réglages livrés : verrou éteint, plus d'essai maison ──
do $$
begin
  if (select value from public.app_config where key = 'paywall_on') is distinct from 'false'::jsonb then raise 'paywall_on livré allumé'; end if;
  -- Modèle B : l'essai est l'offre de lancement d'Apple, plus aucun réglage d'essai côté serveur
  if (select array_agg(key order by key) from public.app_config) is distinct from array['min_build', 'paywall_on'] then raise 'clés de app_config : %', (select array_agg(key) from public.app_config); end if;
  if (select value from public.app_config where key = 'min_build') is distinct from '0'::jsonb then raise 'min_build livré non nul'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'entitlements' and column_name = 'trial_started_at') then raise 'trial_started_at encore là'; end if;
  if exists (select 1 from pg_proc where proname in ('access_trial_days', 'access_unproven_days')) then raise 'fonction d''essai maison restée'; end if;
  if exists (select 1 from pg_class where relname in ('store_installs', 'store_install_links', 'apple_app_ids', 'apple_app_links')) then raise 'tables du rattachement Apple restées'; end if;
end $$;

set role authenticated;
do $$ begin
  perform pg_temp.plogin('a');
  -- Lisible par un compte connecté
  if (select value from public.app_config where key = 'paywall_on') is distinct from 'false'::jsonb then raise 'app_config illisible'; end if;
  -- Jamais modifiable par le client
  if pg_temp.perr($q$ update public.app_config set value = 'true'::jsonb where key = 'paywall_on' $q$) not like 'permission denied%' then raise 'paywall_on modifiable par le client'; end if;
  if pg_temp.perr($q$ insert into public.app_config (key, value) values ('autre', '1') $q$) not like 'permission denied%' then raise 'app_config : insertion'; end if;
  if pg_temp.perr($q$ delete from public.app_config $q$) not like 'permission denied%' then raise 'app_config : suppression'; end if;
end $$;

-- ── Sans abonnement : aucun droit (verrou allumé), aucun essai maison ──
do $$
declare st jsonb;
begin
  perform pg_temp.plogin('a');
  -- Avant tout appel : access_state ne crée rien
  st := public.access_state();
  if st ->> 'status' is distinct from 'none' or st -> 'until' is distinct from 'null'::jsonb
     or st -> 'days_left' is distinct from 'null'::jsonb or not (st ->> 'can_write')::boolean
     or (st ->> 'paywall_on')::boolean or (st ->> 'gift')::boolean or (st ->> 'coach_team')::boolean
     or (st ->> 'intro_offer')::boolean or st -> 'intro_until' is distinct from 'null'::jsonb then raise 'access_state sans rien : %', st; end if;
  if (st ->> 'server_now')::timestamptz not between now() - interval '1 minute' and now() + interval '1 minute' then raise 'server_now : %', st; end if;
  -- Les clés du contrat (modèle B, plus lifetime, also_sub et life_test_used de 20261031000000_payant_plus.sql), exactement
  if (select array_agg(k order by k) from jsonb_object_keys(st) k) is distinct from
     array['also_sub', 'can_write', 'coach_team', 'days_left', 'gift', 'gift_until', 'intro_offer', 'intro_until', 'life_test_used', 'lifetime', 'paywall_on', 'server_now', 'status', 'until']
     then raise 'clés de access_state : %', st; end if;
  reset role;
  if exists (select 1 from public.entitlements where user_id = pg_temp.pu('a')) then raise 'access_state a créé une ligne'; end if;
  set role authenticated;
  -- my_access crée la ligne, sans rien démarrer
  st := public.my_access();
  if (select array_agg(k order by k) from jsonb_object_keys(st) k) is distinct from
     array['also_sub', 'can_write', 'coach_team', 'days_left', 'gift', 'gift_until', 'intro_offer', 'intro_until', 'life_test_used', 'lifetime', 'paywall_on', 'server_now', 'status', 'until']
     then raise 'clés de my_access : %', st; end if;
  if st ->> 'status' is distinct from 'none' or not (st ->> 'can_write')::boolean then raise 'my_access : %', st; end if;
  reset role;
  if (select status from public.entitlements where user_id = pg_temp.pu('a')) is distinct from 'none' then raise 'instantané du statut'; end if;
  -- Le piège : aucune ligne ne donne d'essai, même vieille ou neuve (pas de 3 mois serveur PUIS 3 mois Apple)
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  set role authenticated;
  st := public.my_access();
  if st ->> 'status' is distinct from 'none' or (st ->> 'can_write')::boolean then raise 'compte neuf, verrou allumé : %', st; end if;
  for i in 1..5 loop perform public.my_access(); perform public.access_state(); end loop;
  if (public.my_access() ->> 'can_write')::boolean then raise 'droit regagné par my_access'; end if;
  reset role;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
  set role authenticated;
  if public.access_state() ->> 'status' is distinct from 'none' then raise 'access_state et my_access divergent'; end if;
end $$;

-- ── Un client ne peut rien écrire lui-même ───────────────
do $$
begin
  perform pg_temp.plogin('a');
  -- Aucune autre RPC du client ne touche aux tables du droit d'accès
  if pg_temp.perr($q$ update public.entitlements set status = 'gift', gift = true $q$) not like 'permission denied%' then raise 'statut modifiable'; end if;
  if pg_temp.perr($q$ update public.entitlements set expires_at = now() + interval '10 years' $q$) not like 'permission denied%' then raise 'expires_at modifiable'; end if;
  if pg_temp.perr($q$ insert into public.entitlements (user_id, status, gift) values (pg_temp.pu('a'), 'gift', true) $q$) not like 'permission denied%' then raise 'entitlements : insertion'; end if;
  if pg_temp.perr($q$ delete from public.entitlements $q$) not like 'permission denied%' then raise 'entitlements : suppression'; end if;
  if pg_temp.perr($q$ insert into public.entitlement_claims (original_transaction_id, user_id, product_id, kind, expires_at) values ('vol-1', pg_temp.pu('a'), 'com.mdlf.training.pro.yearly', 'sub', now() + interval '1 year') $q$) not like 'permission denied%' then raise 'claims : insertion'; end if;
  if pg_temp.perr($q$ update public.entitlement_claims set expires_at = now() + interval '1 year' $q$) not like 'permission denied%' then raise 'claims : modification'; end if;
  -- Codes cadeaux : ni créés, ni lus, ni comptés par le client
  if pg_temp.perr($q$ insert into public.gift_codes (code, kind, days) values ('CADEAUMAISON', 'days', 3650) $q$) not like 'permission denied%' then raise 'gift_codes : insertion'; end if;
  if pg_temp.perr($q$ update public.gift_codes set uses = 0 $q$) not like 'permission denied%' then raise 'gift_codes : compteur'; end if;
  if pg_temp.perr($q$ select * from public.gift_codes $q$) not like 'permission denied%' then raise 'gift_codes : lecture'; end if;
  if pg_temp.perr($q$ delete from public.gift_redemptions $q$) not like 'permission denied%' then raise 'gift_redemptions : suppression'; end if;
  if pg_temp.perr($q$ insert into public.gift_redemptions (code, user_id) values ('CADEAUMAISON', pg_temp.pu('a')) $q$) not like 'permission denied%' then raise 'gift_redemptions : insertion'; end if;
  if pg_temp.perr($q$ select private.make_gift_code('lifetime') $q$) not like 'permission denied%' then raise 'make_gift_code appelable par le client'; end if;
  if pg_temp.perr($q$ select private.gift_new_code() $q$) not like 'permission denied%' then raise 'gift_new_code appelable'; end if;
  if pg_temp.perr($q$ select private.gift_code_norm('abcdefghjklm') $q$) not like 'permission denied%' then raise 'gift_code_norm appelable'; end if;
  if pg_temp.perr($q$ select private.gift_refused(pg_temp.pu('a'), 'invalid_code') $q$) not like 'permission denied%' then raise 'gift_refused appelable'; end if;
end $$;

-- ── Le verrou allumé ferme l'écriture, et seulement elle ──
do $$
declare st jsonb;
begin
  reset role;
  update public.app_config set value = 'true'::jsonb, updated_at = now() where key = 'paywall_on';
  set role authenticated;
  perform pg_temp.plogin('a');
  st := public.my_access();
  if not (st ->> 'paywall_on')::boolean or (st ->> 'can_write')::boolean or st ->> 'status' is distinct from 'none'
     then raise 'verrou allumé : %', st; end if;
  if public.access_state() is distinct from st - 'server_now' || jsonb_build_object('server_now', public.access_state() ->> 'server_now')
     then raise 'access_state avec le verrou allumé'; end if;
  -- L'historique reste lisible et la synchro possible : le verrou est appliqué par l'app (choix 9)
  if not exists (select 1 from pg_policies where tablename = 'sessions') then raise 'RLS de sessions'; end if;
  reset role;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
  set role authenticated;
  if not (public.my_access() ->> 'can_write')::boolean then raise 'verrou éteint'; end if;
end $$;

-- ── Achat payé : écrit par le serveur seulement ──────────
do $$
declare st jsonb;
begin
  perform pg_temp.plogin('a');
  -- Le client ne peut pas appeler les fonctions du serveur
  if pg_temp.perr(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('a'), 'com.mdlf.training.pro.yearly', now() + interval '1 year', 'tx-a1')) not like 'permission denied%' then raise 'srv_access_purchase appelable par le client'; end if;
  if pg_temp.perr(format('select public.srv_access_event(%L, %L, %L, false)', 'tx-a1', 'com.mdlf.training.pro.yearly', now() + interval '1 year')) not like 'permission denied%' then raise 'srv_access_event appelable par le client'; end if;

  -- Le serveur (clé serveur) écrit l'abonnement
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('a'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-a1')) is distinct from 'ok' then raise 'achat refusé'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'active' or (st ->> 'days_left')::int not between 29 and 31
     or not (st ->> 'can_write')::boolean or (st ->> 'gift')::boolean then raise 'abonné : %', st; end if;
  if (st ->> 'until')::timestamptz not between now() + interval '29 days' and now() + interval '31 days' then raise 'until de l''abonnement : %', st; end if;
  reset role;
  if (select product_id from public.entitlements where user_id = pg_temp.pu('a')) is distinct from 'com.mdlf.training.pro.monthly'
     or (select original_transaction_id from public.entitlements where user_id = pg_temp.pu('a')) is distinct from 'tx-a1'
     or (select status from public.entitlements where user_id = pg_temp.pu('a')) is distinct from 'active'
     then raise 'instantané de l''abonnement'; end if;
  -- Pas d'offre de lancement annoncée : intro_offer faux ; environnement inconnu (null) accepté
  if (st ->> 'intro_offer')::boolean or st -> 'intro_until' is distinct from 'null'::jsonb then raise 'intro_offer sans offre : %', st; end if;
  set role authenticated;

  -- Changement de formule (mensuel → annuel), même transaction d'origine
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('a'), 'com.mdlf.training.pro.yearly', now() + interval '365 days', 'tx-a1')) is distinct from 'ok' then raise 'changement de formule'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'active' or (st ->> 'days_left')::int not between 364 and 366 then raise 'formule annuelle : %', st; end if;
  reset role;
  if (select count(*) from public.entitlement_claims where user_id = pg_temp.pu('a')) is distinct from 1 then raise 'transaction dédoublée'; end if;
  set role authenticated;
end $$;

-- ── Une transaction ne sert qu'à un compte ───────────────
do $$
declare st jsonb;
begin
  -- E présente la transaction de A
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('e'), 'com.mdlf.training.pro.yearly', now() + interval '1 year', 'tx-a1')) is distinct from 'transaction_taken' then raise 'transaction partagée'; end if;
  perform pg_temp.plogin('e');
  st := public.my_access();
  if st ->> 'status' is distinct from 'none' or st ->> 'gift' is distinct from 'false' then raise 'E a gagné un accès : %', st; end if;
  reset role;
  if exists (select 1 from public.entitlement_claims where user_id = pg_temp.pu('e')) then raise 'transaction écrite au nom de E'; end if;
  set role authenticated;
  -- Même refusée, rien de A n'a bougé
  perform pg_temp.plogin('a');
  if public.my_access() ->> 'status' is distinct from 'active' then raise 'A touché par la tentative de E'; end if;
  -- A prend une nouvelle transaction : l'ancienne reste à son nom, E ne peut toujours pas la prendre
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('a'), 'com.mdlf.training.pro.yearly', now() + interval '400 days', 'tx-a2')) is distinct from 'ok' then raise 'seconde transaction de A'; end if;
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('e'), 'com.mdlf.training.pro.yearly', now() + interval '1 year', 'tx-a1')) is distinct from 'transaction_taken' then raise 'ancienne transaction libérée'; end if;
  -- A garde la période la plus lointaine
  if (public.my_access() ->> 'until')::timestamptz not between now() + interval '399 days' and now() + interval '401 days' then raise 'période la plus lointaine'; end if;
end $$;

-- ── Refus du serveur ─────────────────────────────────────
do $$ begin
  -- Produit qui n'est pas des nôtres
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('f'), 'com.autre.app.pro', now() + interval '1 year', 'tx-f0')) is distinct from 'unknown_product' then raise 'produit inconnu'; end if;
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, null, %L, %L)', pg_temp.pu('f'), now() + interval '1 year', 'tx-f0')) is distinct from 'unknown_product' then raise 'produit null'; end if;
  -- Transaction mal formée
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('f'), 'com.mdlf.training.pro.yearly', now() + interval '1 year', '')) is distinct from 'invalid_transaction' then raise 'transaction vide'; end if;
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, null)', pg_temp.pu('f'), 'com.mdlf.training.pro.yearly', now() + interval '1 year')) is distinct from 'invalid_transaction' then raise 'transaction null'; end if;
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('f'), 'com.mdlf.training.pro.yearly', now() + interval '1 year', repeat('x', 65))) is distinct from 'invalid_transaction' then raise 'transaction trop longue'; end if;
  -- Compte inconnu
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', gen_random_uuid(), 'com.mdlf.training.pro.yearly', now() + interval '1 year', 'tx-x')) is distinct from 'not_found' then raise 'compte inconnu'; end if;
  if pg_temp.psrv(format('select public.srv_access_purchase(null, %L, %L, %L)', 'com.mdlf.training.pro.yearly', now() + interval '1 year', 'tx-x')) is distinct from 'not_found' then raise 'compte null'; end if;
  reset role;
  if exists (select 1 from public.entitlement_claims where original_transaction_id in ('tx-f0', 'tx-x', '')) then raise 'transaction refusée pourtant écrite'; end if;
  if exists (select 1 from public.entitlements where user_id = pg_temp.pu('f')) then raise 'ligne créée par un refus'; end if;
  set role authenticated;
end $$;

-- ── « Accès offert » d'Apple supprimé ; un remboursé le reste ──
do $$
declare st jsonb;
begin
  -- Le non consommable n'est plus un de nos produits
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, null, %L)', pg_temp.pu('b'), 'com.mdlf.training.access.gift', 'tx-b0')) is distinct from 'unknown_product' then raise 'accès offert d''Apple accepté'; end if;
  reset role;
  if (select private.access_product_kind('com.mdlf.training.access.gift')) is not null then raise 'produit cadeau encore reconnu'; end if;
  set role authenticated;
  -- B s'abonne, puis est remboursé : l'accès tombe et ne revient pas tout seul
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, %L)', pg_temp.pu('b'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-b1', now() - interval '1 hour')) is distinct from 'ok' then raise 'abonnement de B'; end if;
  perform pg_temp.plogin('b');
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, true, %L)', 'tx-b1', 'com.mdlf.training.pro.monthly', now() + interval '30 days', now())) is distinct from 'ok' then raise 'remboursement de B'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'expired' or (st ->> 'gift')::boolean then raise 'remboursé : %', st; end if;
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L)', 'tx-b1', 'com.mdlf.training.pro.monthly', now() + interval '30 days', now() + interval '1 day')) is distinct from 'ok' then raise 'évènement après remboursement'; end if;
  if public.my_access() ->> 'status' is distinct from 'expired' then raise 'un remboursé a été réactivé (même période)'; end if;
  reset role;
  if (select revoked_at from public.entitlement_claims where original_transaction_id = 'tx-b1') is null then raise 'revoked_at effacé'; end if;
  -- L'administrateur peut rouvrir à la main
  update public.entitlement_claims set revoked_at = null, event_at = null where original_transaction_id = 'tx-b1';
  perform private.access_refresh(pg_temp.pu('b'));
  set role authenticated;
  if public.my_access() ->> 'status' is distinct from 'active' then raise 'réouverture par l''administrateur'; end if;
end $$;

-- ── Codes cadeaux maison : création par l'administrateur ──
reset role;
create temp table gifts (who text, code text);
grant all on gifts to authenticated, anon;
insert into gifts select 'vie', private.make_gift_code('lifetime', null, 1, 'essai à vie');
insert into gifts select 'j30', private.make_gift_code('days', 30, 1, '30 jours');
insert into gifts select 'j30b', private.make_gift_code('days', 30, 1, 'cumul');
insert into gifts select 'duo', private.make_gift_code('days', 10, 1, 'un seul usage');
insert into gifts select 'perime', private.make_gift_code('days', 10, 1, 'périmé');
insert into gifts select 'rab', private.make_gift_code('days', 5, 1, 'après la limite');
update public.gift_codes set expires_at = now() - interval '1 second'
  where code = (select code from gifts where who = 'perime');
do $$ begin
  -- 12 caractères de l'alphabet lisible, tous différents : un code ne se devine pas
  if exists (select 1 from gifts where code !~ '^[A-HJ-NP-Z2-9]{12}$') then raise 'format des codes : %', (select code from gifts limit 1); end if;
  if (select count(distinct code) from gifts) is distinct from 6 then raise 'codes identiques'; end if;
  if (select count(distinct c) from private.make_gift_code('days', 7, 100, 'lot') c) is distinct from 100 then raise '100 codes d''un coup'; end if;
  -- La base refuse un code court ou choisi à la main, et un code days sans jours
  if pg_temp.perr($q$ insert into public.gift_codes (code, kind, days) values ('NOEL2026', 'days', 30) $q$) not like '%gift_codes_code_check%' then raise 'code devinable accepté'; end if;
  if pg_temp.perr($q$ insert into public.gift_codes (code, kind) values ('ABCDEFGHJKLM', 'days') $q$) not like '%gift_codes_days%' then raise 'kind days sans jours'; end if;
  if pg_temp.perr($q$ insert into public.gift_codes (code, kind, days) values ('ABCDEFGHJKLM', 'lifetime', 30) $q$) not like '%gift_codes_days%' then raise 'kind lifetime avec des jours'; end if;
  if pg_temp.perr($q$ select private.make_gift_code('autre') $q$) is distinct from 'invalid_kind' then raise 'kind inconnu'; end if;
  if pg_temp.perr($q$ select private.make_gift_code(null) $q$) is distinct from 'invalid_kind' then raise 'kind null'; end if;
end $$;
set role authenticated;

-- ── Codes cadeaux : refus, tous renvoyés et non levés ────
do $$
declare g jsonb;
begin
  perform pg_temp.plogin('g');
  g := public.redeem_gift_code('ABCDEFGHJKLM');
  if (g ->> 'ok')::boolean or g ->> 'error' is distinct from 'invalid_code' then raise 'code inconnu : %', g; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(g) k) is distinct from array['access', 'error', 'kind', 'ok'] then raise 'clés de redeem_gift_code : %', g; end if;
  -- Le refus porte quand même l'état courant, pour que l'app se rafraîchisse
  if g -> 'access' ->> 'status' is distinct from 'none' then raise 'access dans un refus : %', g; end if;
  if g -> 'kind' is distinct from 'null'::jsonb then raise 'kind d''un refus'; end if;
  if public.redeem_gift_code('COURT') ->> 'error' is distinct from 'invalid_code' then raise 'code trop court'; end if;
  if public.redeem_gift_code(null) ->> 'error' is distinct from 'invalid_code' then raise 'code null'; end if;
  if public.redeem_gift_code('') ->> 'error' is distinct from 'invalid_code' then raise 'code vide'; end if;
  if public.redeem_gift_code('OOOOIIII0000') ->> 'error' is distinct from 'invalid_code' then raise 'symboles exclus'; end if;
  if public.redeem_gift_code((select code from gifts where who = 'perime')) ->> 'error' is distinct from 'code_expired' then raise 'code périmé'; end if;
  -- Aucun de ces refus n'a rien écrit
  reset role;
  if exists (select 1 from public.gift_redemptions where user_id = pg_temp.pu('g')) then raise 'refus pourtant enregistré'; end if;
  if exists (select 1 from public.gift_codes where uses > 0) then raise 'compteur touché par un refus'; end if;
  set role authenticated;
end $$;

-- ── Codes cadeaux : parcours, cumul, saisie souple ───────
do $$
declare g jsonb; st jsonb; c text;
begin
  reset role;
  delete from private.social_rate where action = 'gift_code';   -- les refus ci-dessus ont été comptés
  set role authenticated;
  perform pg_temp.plogin('g');
  c := (select code from gifts where who = 'j30');
  -- Saisie souple : minuscules, espaces et tirets ignorés (comme coach_join)
  g := public.redeem_gift_code(' ' || lower(substr(c, 1, 4)) || '-' || lower(substr(c, 5, 4)) || '-' || substr(c, 9) || ' ');
  if not (g ->> 'ok')::boolean or g ->> 'error' is not null or g ->> 'kind' is distinct from 'days' then raise 'code de 30 jours : %', g; end if;
  st := g -> 'access';
  if st ->> 'status' is distinct from 'gift' or not (st ->> 'gift')::boolean or (st ->> 'days_left')::int is distinct from 30
     then raise 'état après 30 jours : %', st; end if;
  if (st ->> 'gift_until')::timestamptz not between now() + interval '29 days' and now() + interval '31 days' then raise 'gift_until : %', st; end if;
  if (st ->> 'until')::timestamptz is distinct from (st ->> 'gift_until')::timestamptz then raise 'until et gift_until'; end if;
  if public.my_access() is distinct from st - 'server_now' || jsonb_build_object('server_now', public.my_access() ->> 'server_now') then raise 'my_access après le code'; end if;
  -- Cumul : un second code de 30 jours donne 60 jours
  g := public.redeem_gift_code((select code from gifts where who = 'j30b'));
  if not (g ->> 'ok')::boolean or (g -> 'access' ->> 'days_left')::int is distinct from 60 then raise 'cumul : %', g; end if;
  if (g -> 'access' ->> 'gift_until')::timestamptz not between now() + interval '59 days' and now() + interval '61 days' then raise 'gift_until cumulé'; end if;
  -- Deux fois le même code par le même compte : refusé, compteur inchangé
  if public.redeem_gift_code((select code from gifts where who = 'j30')) ->> 'error' is distinct from 'already_redeemed' then raise 'code réutilisé'; end if;
  reset role;
  if (select uses from public.gift_codes where code = (select code from gifts where who = 'j30')) is distinct from 1 then raise 'compteur après already_redeemed'; end if;
  if (select count(*) from public.gift_redemptions where user_id = pg_temp.pu('g')) is distinct from 2 then raise 'deux usages enregistrés'; end if;
  set role authenticated;
  -- Le cadeau tient le verrou allumé
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  set role authenticated;
  st := public.my_access();
  if st ->> 'status' is distinct from 'gift' or not (st ->> 'can_write')::boolean then raise 'cadeau avec le verrou : %', st; end if;
  reset role;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
  set role authenticated;
end $$;

-- ── Codes cadeaux : un seul usage pour deux comptes ──────
do $$
declare c text := (select code from gifts where who = 'duo'); st jsonb;
begin
  reset role; delete from private.social_rate where action = 'gift_code'; set role authenticated;
  perform pg_temp.plogin('h');
  if not (public.redeem_gift_code(c) ->> 'ok')::boolean then raise 'premier compte sur le code à usage unique'; end if;
  -- Le second compte arrive trop tard : max_uses atteint
  perform pg_temp.plogin('g');
  if public.redeem_gift_code(c) ->> 'error' is distinct from 'code_used_up' then raise 'second compte sur un code à usage unique'; end if;
  reset role;
  if (select uses from public.gift_codes where code = c) is distinct from 1 then raise 'compteur du code à usage unique'; end if;
  if exists (select 1 from public.gift_redemptions where code = c and user_id = pg_temp.pu('g')) then raise 'usage enregistré malgré le refus'; end if;
  set role authenticated;

  -- Accès à vie : gift_until reste null, aucune date de fin, et il passe avant l'abonnement
  perform pg_temp.plogin('h');
  st := public.redeem_gift_code((select code from gifts where who = 'vie')) -> 'access';
  if st ->> 'status' is distinct from 'gift' or not (st ->> 'gift')::boolean
     or st -> 'until' is distinct from 'null'::jsonb or st -> 'days_left' is distinct from 'null'::jsonb
     or st -> 'gift_until' is distinct from 'null'::jsonb then raise 'accès à vie : %', st; end if;
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('h'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-h1')) is distinct from 'ok' then raise 'abonnement de H'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'gift' or st -> 'until' is distinct from 'null'::jsonb then raise 'le cadeau ne passe pas avant l''abonnement : %', st; end if;
end $$;

-- ── Codes cadeaux : la limite de débit compte les ÉCHECS ──
-- Le point critique : sans cela, on tenterait des codes sans fin. Un refus de code est RENVOYÉ et non
-- levé, justement pour que Postgres n'annule pas le comptage de l'essai.
do $$
declare i int; n int;
begin
  reset role;
  delete from private.social_rate where user_id = pg_temp.pu('f') and action = 'gift_code';
  set role authenticated;
  perform pg_temp.plogin('f');
  for i in 1..10 loop
    if public.redeem_gift_code('ZZZZZZZZZZZZ') ->> 'error' is distinct from 'invalid_code' then raise 'essai % non refusé', i; end if;
  end loop;
  reset role;
  select count(*) into n from private.social_rate where user_id = pg_temp.pu('f') and action = 'gift_code';
  if n is distinct from 10 then raise 'les échecs ne sont pas comptés (% essais au journal) : on pourrait deviner des codes sans fin', n; end if;
  set role authenticated;
  -- Le 11e essai est refusé, même avec un code VALABLE
  if pg_temp.perr(format('select public.redeem_gift_code(%L)', (select code from gifts where who = 'rab'))) is distinct from 'rate_limited' then raise '11e essai'; end if;
  if pg_temp.perr($q$ select public.redeem_gift_code('ZZZZZZZZZZZZ') $q$) is distinct from 'rate_limited' then raise '12e essai'; end if;
  reset role;
  -- Le refus par la limite n'a rien ajouté au journal (il est levé) : la limite tient quand même
  if (select count(*) from private.social_rate where user_id = pg_temp.pu('f') and action = 'gift_code') is distinct from 10 then raise 'journal gonflé par les refus de limite'; end if;
  if (select uses from public.gift_codes where code = (select code from gifts where who = 'rab')) is distinct from 0 then raise 'code utilisé malgré la limite'; end if;
  -- Un autre compte n'est pas touché par la limite de F
  set role authenticated;
  perform pg_temp.plogin('g');
  if public.redeem_gift_code('ZZZZZZZZZZZZ') ->> 'error' is distinct from 'invalid_code' then raise 'limite partagée entre comptes'; end if;
  -- Fenêtre d'une heure passée : F peut de nouveau essayer
  reset role;
  update private.social_rate set at = now() - interval '61 minutes' where user_id = pg_temp.pu('f') and action = 'gift_code';
  set role authenticated;
  perform pg_temp.plogin('f');
  if not (public.redeem_gift_code((select code from gifts where who = 'rab')) ->> 'ok')::boolean then raise 'limite horaire non libérée'; end if;
  if (public.my_access() ->> 'days_left')::int is distinct from 5 then raise '5 jours offerts à F'; end if;
end $$;

-- ── Élève suivi par un coach : plus d'accès gratuit (20261030000000_payant_tarifs.sql) ──
do $$
declare st jsonb;
begin
  perform pg_temp.plogin('d');
  if public.my_access() ->> 'status' is distinct from 'none' then raise 'D avant le coach'; end if;
  reset role;
  insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('d'), pg_temp.pu('c'));
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  set role authenticated;
  st := public.my_access();
  if st ->> 'status' is distinct from 'none' or (st ->> 'coach_team')::boolean or (st ->> 'can_write')::boolean
     then raise 'élève de coach encore gratuit : %', st; end if;
  reset role;
  if (select in_coach_team from public.entitlements where user_id = pg_temp.pu('d')) then raise 'instantané in_coach_team'; end if;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
  set role authenticated;
  -- Un abonné qui est aussi élève est « active », coach_team toujours faux
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('d'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-d1')) is distinct from 'ok' then raise 'abonnement de D'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'active' or (st ->> 'coach_team')::boolean then raise 'abonné et élève : %', st; end if;
  reset role;
  delete from public.coach_links where student_id = pg_temp.pu('d');
  set role authenticated;
end $$;

-- ── Évènements d'Apple (appstore-notify) ─────────────────
do $$
declare r jsonb;
begin
  set local role service_role;
  -- Transaction inconnue, produit qui n'est pas des nôtres, transaction null : accepté sans rien
  -- écrire (Apple ne doit pas réessayer sans fin)
  r := public.srv_access_event('tx-inconnue', 'com.mdlf.training.pro.yearly', now() + interval '1 year', false);
  if r is distinct from '{"matched": false, "duplicate": false}'::jsonb then raise 'transaction inconnue : %', r; end if;
  r := public.srv_access_event('tx-a1', 'com.autre.app', now() + interval '1 year', false);
  if r is distinct from '{"matched": false, "duplicate": false}'::jsonb then raise 'produit inconnu en notification : %', r; end if;
  r := public.srv_access_event(null, 'com.mdlf.training.pro.yearly', null, false);
  if r is distinct from '{"matched": false, "duplicate": false}'::jsonb then raise 'transaction null : %', r; end if;
  -- Renouvellement : la période est repoussée, le compte est retrouvé par sa transaction
  r := public.srv_access_event('tx-a2', 'com.mdlf.training.pro.yearly', now() + interval '800 days', false, now());
  if not (r ->> 'matched')::boolean or (r ->> 'duplicate')::boolean
     or r ->> 'user_id' is distinct from pg_temp.pu('a')::text
     or r -> 'access' ->> 'status' is distinct from 'active' then raise 'renouvellement : %', r; end if;
  set local role authenticated;
  perform pg_temp.plogin('a');
  if (public.my_access() ->> 'until')::timestamptz not between now() + interval '799 days' and now() + interval '801 days' then raise 'période repoussée'; end if;
end $$;

-- ── Un évènement en retard ne fait JAMAIS reculer la date ──
-- Deux cas réels : Transaction.unfinished est parcouru dans un ordre non garanti au lancement de
-- l'app, et Apple ne garantit pas l'ordre des notifications V2 (réessayées jusqu'à 3 jours).
do $$
declare st jsonb;
begin
  perform pg_temp.plogin('a');
  -- (a) la transaction du mois N arrive APRÈS celle du mois N+1
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, %L)', pg_temp.pu('a'),
     'com.mdlf.training.pro.yearly', now() - interval '1 day', 'tx-a2', now() - interval '370 days')) is distinct from 'ok' then raise 'transaction en retard'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'active' then raise 'une transaction en retard a coupé l''abonné : %', st; end if;
  if (st ->> 'until')::timestamptz not between now() + interval '799 days' and now() + interval '801 days' then raise 'date reculée par une transaction en retard : %', st; end if;
  -- (b) notification rejouée avec la période précédente
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L)', 'tx-a2',
     'com.mdlf.training.pro.yearly', now() - interval '1 day', now() - interval '400 days')) is distinct from 'ok' then raise 'notification en retard'; end if;
  if public.my_access() ->> 'status' is distinct from 'active' then raise 'une notification en retard a coupé l''abonné'; end if;
  -- Même sans date d'évènement, la date de fin ne recule pas (greatest)
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false)', 'tx-a2',
     'com.mdlf.training.pro.yearly', now() + interval '10 days')) is distinct from 'ok' then raise 'notification sans date'; end if;
  if (public.my_access() ->> 'until')::timestamptz not between now() + interval '799 days' and now() + interval '801 days' then raise 'date reculée sans date d''évènement'; end if;
  -- Un évènement plus RÉCENT, lui, repousse bien la date
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L)', 'tx-a2',
     'com.mdlf.training.pro.yearly', now() + interval '900 days', now() + interval '1 minute')) is distinct from 'ok' then raise 'vrai renouvellement'; end if;
  if (public.my_access() ->> 'until')::timestamptz not between now() + interval '899 days' and now() + interval '901 days' then raise 'renouvellement non appliqué'; end if;
  -- Apple ferme l'accès lui-même (EXPIRED, GRACE_PERIOD_EXPIRED) : là, la date recule
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L, true)', 'tx-a2',
     'com.mdlf.training.pro.yearly', now() - interval '1 second', now() + interval '2 minutes')) is distinct from 'ok' then raise 'expiration'; end if;
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L, true)', 'tx-a1',
     'com.mdlf.training.pro.yearly', now() - interval '1 day', now() + interval '2 minutes')) is distinct from 'ok' then raise 'expiration tx-a1'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'expired' or st -> 'days_left' is distinct from 'null'::jsonb then raise 'EXPIRED n''a pas fermé l''accès : %', st; end if;
  reset role;
  if (select status from public.entitlements where user_id = pg_temp.pu('a')) is distinct from 'expired' then raise 'instantané après expiration'; end if;
  set role authenticated;
  -- Une expiration EN RETARD, elle, ne ferme rien : A se réabonne, puis l'EXPIRED du mois d'avant arrive
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, %L)', pg_temp.pu('a'),
     'com.mdlf.training.pro.yearly', now() + interval '365 days', 'tx-a2', now() + interval '5 minutes')) is distinct from 'ok' then raise 'réabonnement'; end if;
  if public.my_access() ->> 'status' is distinct from 'active' then raise 'réabonnement non appliqué'; end if;
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L, true)', 'tx-a2',
     'com.mdlf.training.pro.yearly', now() - interval '1 second', now() + interval '3 minutes')) is distinct from 'ok' then raise 'expiration en retard'; end if;
  if public.my_access() ->> 'status' is distinct from 'active' then raise 'une expiration en retard a coupé l''abonné'; end if;
end $$;

-- ── Un remboursé le RESTE, un vrai réabonnement le rouvre ──
do $$
declare st jsonb;
begin
  perform pg_temp.plogin('a');
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, true, %L)', 'tx-a2',
     'com.mdlf.training.pro.yearly', now() + interval '365 days', now() + interval '6 minutes')) is distinct from 'ok' then raise 'remboursement'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'expired' or (st ->> 'can_write')::boolean is not true then raise 'remboursé : %', st; end if;
  reset role;
  if (select revoked_at from public.entitlement_claims where original_transaction_id = 'tx-a2') is null then raise 'revoked_at non posé'; end if;
  set role authenticated;
  -- (1) Un DID_RENEW REJOUÉ (même période, évènement plus récent) ne rouvre rien
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L)', 'tx-a2',
     'com.mdlf.training.pro.yearly', now() + interval '365 days', now() + interval '7 minutes')) is distinct from 'ok' then raise 'notification rejouée'; end if;
  if public.my_access() ->> 'status' is distinct from 'expired' then raise 'un DID_RENEW rejoué a rouvert un remboursé'; end if;
  -- (2) Un évènement EN RETARD, même avec une période plus lointaine, ne rouvre rien
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L)', 'tx-a2',
     'com.mdlf.training.pro.yearly', now() + interval '900 days', now() + interval '4 minutes')) is distinct from 'ok' then raise 'évènement en retard'; end if;
  if public.my_access() ->> 'status' is distinct from 'expired' then raise 'un évènement en retard a rouvert un remboursé'; end if;
  -- (3) Sans date d'évènement, on ne peut pas savoir s'il est en retard : on ne rouvre pas
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false)', 'tx-a2',
     'com.mdlf.training.pro.yearly', now() + interval '900 days')) is distinct from 'ok' then raise 'évènement sans date'; end if;
  if public.my_access() ->> 'status' is distinct from 'expired' then raise 'un évènement sans date a rouvert un remboursé'; end if;
  -- (4) Un verify-purchase qui renvoie la même période ne rouvre rien non plus
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, %L)', pg_temp.pu('a'),
     'com.mdlf.training.pro.yearly', now() + interval '365 days', 'tx-a2', now() + interval '8 minutes')) is distinct from 'ok' then raise 'achat après remboursement'; end if;
  if public.my_access() ->> 'status' is distinct from 'expired' then raise 'un remboursé a été réactivé par verify-purchase'; end if;
  reset role;
  -- Tant qu'elle est révoquée, la période de la transaction ne bouge pas (sinon la barre du
  -- réabonnement monterait toute seule)
  if (select expires_at from public.entitlement_claims where original_transaction_id = 'tx-a2')
     not between now() + interval '364 days' and now() + interval '366 days' then raise 'période d''une transaction révoquée : %', (select expires_at from public.entitlement_claims where original_transaction_id = 'tx-a2'); end if;
  if (select revoked_at from public.entitlement_claims where original_transaction_id = 'tx-a2') is null then raise 'revoked_at effacé'; end if;
  -- L'instantané ne montre plus la transaction révoquée (il retombe sur l'ancienne, échue)
  if (select original_transaction_id from public.entitlements where user_id = pg_temp.pu('a')) is distinct from 'tx-a1'
     or (select expires_at from public.entitlements where user_id = pg_temp.pu('a')) > now()
     then raise 'instantané après remboursement : %', (select row_to_json(t) from public.entitlements t where t.user_id = pg_temp.pu('a')); end if;
  set role authenticated;
  -- (5) Un VRAI réabonnement : évènement plus récent ET période strictement plus lointaine.
  -- Apple garde la même transaction d'origine : sans cette réouverture, le client resterait bloqué.
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, %L)', pg_temp.pu('a'),
     'com.mdlf.training.pro.yearly', now() + interval '400 days', 'tx-a2', now() + interval '9 minutes')) is distinct from 'ok' then raise 'réabonnement'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'active' then raise 'un réabonnement n''a pas rouvert l''accès : %', st; end if;
  if (st ->> 'until')::timestamptz not between now() + interval '399 days' and now() + interval '401 days' then raise 'période du réabonnement : %', st; end if;
  reset role;
  if (select revoked_at from public.entitlement_claims where original_transaction_id = 'tx-a2') is not null then raise 'revoked_at non levé par le réabonnement'; end if;
  set role authenticated;
  -- (6) Après réouverture, un DID_RENEW en retard ne referme rien
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L)', 'tx-a2',
     'com.mdlf.training.pro.yearly', now() + interval '365 days', now() + interval '5 minutes')) is distinct from 'ok' then raise 'évènement en retard après réouverture'; end if;
  if public.my_access() ->> 'status' is distinct from 'active' then raise 'réouverture défaite par un évènement en retard'; end if;
  -- (7) Un remboursement, lui, referme (évènement plus récent)
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, true, %L)', 'tx-a2',
     'com.mdlf.training.pro.yearly', now() + interval '400 days', now() + interval '10 minutes')) is distinct from 'ok' then raise 'second remboursement'; end if;
  if public.my_access() ->> 'status' is distinct from 'expired' then raise 'second remboursement sans effet'; end if;
  -- (8) La commande d'administration reste le secours quand la période d'Apple ne va pas plus loin
  reset role;
  update public.entitlement_claims set revoked_at = null, event_at = null where original_transaction_id = 'tx-a2';
  perform private.access_refresh(pg_temp.pu('a'));
  set role authenticated;
  if public.my_access() ->> 'status' is distinct from 'active' then raise 'réouverture par l''administrateur'; end if;
  -- On repart d'un compte remboursé pour la suite
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, true, %L)', 'tx-a2',
     'com.mdlf.training.pro.yearly', now() + interval '400 days', now() + interval '11 minutes')) is distinct from 'ok' then raise 'remboursement final'; end if;
  if public.my_access() ->> 'status' is distinct from 'expired' then raise 'remboursement final sans effet'; end if;
end $$;

-- ── Débit de verify-purchase ─────────────────────────────
do $$
declare i int;
begin
  reset role;
  delete from private.social_rate where user_id = pg_temp.pu('f') and action = 'access_verify';
  insert into auth.users (id) values (pg_temp.pu('f')) on conflict do nothing;
  set role authenticated;
  for i in 1..120 loop
    if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('f'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-f1')) is distinct from 'ok' then raise 'appel % refusé', i; end if;
  end loop;
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('f'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-f1')) is distinct from 'rate_limited' then raise '121e appel'; end if;
  reset role;
  update private.social_rate set at = now() - interval '25 hours' where user_id = pg_temp.pu('f') and action = 'access_verify';
  set role authenticated;
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('f'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-f1')) is distinct from 'ok' then raise 'limite non libérée'; end if;
end $$;

-- ── Notifications dédoublonnées ──────────────────────────
-- Apple réessaie une notification jusqu'à 3 jours et peut l'envoyer deux fois.
do $$
declare r jsonb;
begin
  set local role service_role;
  r := public.srv_access_event('tx-a1', 'com.mdlf.training.pro.yearly', now() + interval '500 days', false,
                               now() + interval '10 minutes', false, 'uuid-1');
  if not (r ->> 'matched')::boolean or (r ->> 'duplicate')::boolean then raise 'première notification : %', r; end if;
  -- La même, rejouée avec une autre période : ignorée, rien n'est réécrit
  r := public.srv_access_event('tx-a1', 'com.mdlf.training.pro.yearly', now() + interval '900 days', false,
                               now() + interval '11 minutes', false, 'uuid-1');
  if (r ->> 'matched')::boolean or not (r ->> 'duplicate')::boolean then raise 'doublon traité : %', r; end if;
  set local role authenticated;
  perform pg_temp.plogin('a');
  if (public.my_access() ->> 'until')::timestamptz > now() + interval '501 days' then raise 'le doublon a été appliqué'; end if;
  -- Un autre notificationUUID passe
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L, false, %L)', 'tx-a1',
     'com.mdlf.training.pro.yearly', now() + interval '900 days', now() + interval '12 minutes', 'uuid-2')) is distinct from 'ok' then raise 'uuid-2'; end if;
  if (public.my_access() ->> 'until')::timestamptz not between now() + interval '899 days' and now() + interval '901 days' then raise 'uuid-2 non appliqué'; end if;
  -- Notifications de plus de 30 jours purgées, récentes gardées
  reset role;
  update public.appstore_notifications set at = now() - interval '31 days' where notification_uuid = 'uuid-1';
  set role authenticated;
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L, false, %L)', 'tx-a1',
     'com.mdlf.training.pro.yearly', now() + interval '900 days', now() + interval '13 minutes', 'uuid-3')) is distinct from 'ok' then raise 'uuid-3'; end if;
  reset role;
  if exists (select 1 from public.appstore_notifications where notification_uuid = 'uuid-1') then raise 'notification ancienne non purgée'; end if;
  if not exists (select 1 from public.appstore_notifications where notification_uuid = 'uuid-2') then raise 'notification récente purgée'; end if;
  set role authenticated;
end $$;

-- ── Achat orphelin repêché par appAccountToken ───────────
do $$
declare r jsonb;
begin
  set local role service_role;
  -- La transaction n'a jamais été remontée par l'app : sans repêchage, elle serait perdue pour toujours
  r := public.srv_access_event('tx-orphan', 'com.mdlf.training.pro.yearly', now() + interval '1 year', false,
                               now(), false, 'uuid-orphan', pg_temp.pu('e')::text);
  if not (r ->> 'matched')::boolean or r ->> 'user_id' is distinct from pg_temp.pu('e')::text then raise 'repêchage : %', r; end if;
  -- Un jeton qui n'est pas un identifiant, ou d'un compte inconnu : rien
  r := public.srv_access_event('tx-orphan2', 'com.mdlf.training.pro.yearly', now() + interval '1 year', false,
                               now(), false, 'uuid-o2', 'pas-un-uuid');
  if (r ->> 'matched')::boolean then raise 'jeton quelconque accepté : %', r; end if;
  r := public.srv_access_event('tx-orphan3', 'com.mdlf.training.pro.yearly', now() + interval '1 year', false,
                               now(), false, 'uuid-o3', gen_random_uuid()::text);
  if (r ->> 'matched')::boolean then raise 'compte inconnu accepté : %', r; end if;
  -- Le repêchage ne sert JAMAIS à détourner une transaction déjà rattachée
  r := public.srv_access_event('tx-a1', 'com.mdlf.training.pro.yearly', now() + interval '900 days', false,
                               now() + interval '20 minutes', false, 'uuid-o4', pg_temp.pu('g')::text);
  if r ->> 'user_id' is distinct from pg_temp.pu('a')::text then raise 'transaction détournée par appAccountToken : %', r; end if;
  set local role authenticated;
  perform pg_temp.plogin('e');
  if public.my_access() ->> 'status' is distinct from 'active' then raise 'E abonné par repêchage'; end if;
end $$;

-- ── Le verrou est tenu par le SERVEUR, pas par l'app ─────
-- Se déconnecter met can_write à vrai côté app : sans ce déclencheur, il suffirait d'enregistrer ses
-- séances déconnecté puis de se reconnecter pour tout téléverser.
do $$ begin
  perform pg_temp.plogin('i');
  perform public.my_access();
  -- Verrou éteint : l'insertion passe, sans abonnement
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('i-1', '{"date": 1780000000000, "exercises": []}') $q$) is distinct from 'ok' then raise 'insertion refusée verrou éteint'; end if;
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  set role authenticated;
  if (public.my_access() ->> 'can_write')::boolean then raise 'can_write devrait être faux'; end if;
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('i-2', '{"date": 1780000001000, "exercises": []}') $q$) is distinct from 'paywall_locked' then raise 'le serveur accepte une nouvelle séance, verrou allumé'; end if;
  if pg_temp.perr(format($q$ insert into public.sessions (user_id, id, data) values (%L, 'i-3', '{"date": 1, "exercises": []}') $q$, pg_temp.pu('i'))) is distinct from 'paywall_locked' then raise 'contournement en posant user_id'; end if;
  if pg_temp.perr($q$ update public.sessions set data = '{"date": 1780000000000, "notes": "corrigée", "exercises": []}' where id = 'i-1' $q$) is distinct from 'ok' then raise 'correction refusée'; end if;
  if pg_temp.perr($q$ update public.sessions set deleted_at = now() where id = 'i-1' $q$) is distinct from 'ok' then raise 'mise à la corbeille refusée'; end if;
  reset role;
  if exists (select 1 from public.sessions where user_id = pg_temp.pu('i') and id in ('i-2', 'i-3')) then raise 'séance refusée pourtant écrite'; end if;
  set role authenticated;
  -- Un abonné passe, verrou allumé (offre de lancement comprise)
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, null, true, %L)', pg_temp.pu('i'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-i1', 'Production')) is distinct from 'ok' then raise 'abonnement de I'; end if;
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('i-4', '{"date": 1780000002000, "exercises": []}') $q$) is distinct from 'ok' then raise 'abonné refusé'; end if;
  -- Un élève de coach, lui, n'a plus d'accès gratuit (20261030000000_payant_tarifs.sql)
  reset role;
  update public.entitlement_claims set revoked_at = now() where original_transaction_id = 'tx-i1';
  perform private.access_refresh(pg_temp.pu('i'));
  insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('i'), pg_temp.pu('c'));
  set role authenticated;
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('i-5', '{"date": 1780000003000, "exercises": []}') $q$) is distinct from 'paywall_locked' then raise 'élève de coach accepté sans abonnement'; end if;
  reset role;
  delete from public.coach_links where student_id = pg_temp.pu('i');
  set role authenticated;
  -- Un compte tout neuf, jamais passé par my_access : aucun essai, refusé verrou allumé
  perform pg_temp.plogin('j');
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('j-1', '{"date": 1780000000000, "exercises": []}') $q$) is distinct from 'paywall_locked' then raise 'nouveau compte accepté sans abonnement'; end if;
  reset role;
  -- Le refus annule tout ce que le déclencheur a écrit (aucune ligne laissée derrière)
  if exists (select 1 from public.entitlements where user_id = pg_temp.pu('j')) then raise 'ligne de J laissée par un refus'; end if;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
  set role authenticated;
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('j-3', '{"date": 1780000002000, "exercises": []}') $q$) is distinct from 'ok' then raise 'verrou éteint'; end if;
end $$;

-- ── Aucune lecture directe, aucune fuite ─────────────────
do $$
declare t text;
begin
  perform pg_temp.plogin('e');
  foreach t in array array['public.entitlements', 'public.entitlement_claims', 'public.appstore_notifications',
                           'public.gift_codes', 'public.gift_redemptions'] loop
    if pg_temp.perr(format('select * from %s', t)) not like 'permission denied%' then raise 'lecture directe de %', t; end if;
  end loop;
  foreach t in array array['private.access_json(pg_temp.pu(''a''))', 'private.access_refresh(pg_temp.pu(''e''))',
                           'private.access_claim(pg_temp.pu(''e''), ''com.mdlf.training.pro.monthly'', null, ''tx-e9'', false)',
                           'private.access_product_kind(''com.mdlf.training.pro.monthly'')',
                           'private.access_paywall_on()',
                           'private.coach_free_limits'] loop
    if pg_temp.perr('select ' || case when t like 'private.coach_free_limits' then '* from ' else '' end || t) not like 'permission denied%' then raise '% appelable', t; end if;
  end loop;
  -- Mon état ne dit rien d'un autre compte
  if public.my_access()::text ~ '(tx-a1|tx-a2|tx-b1|anna|bob)' then raise 'fuite dans my_access'; end if;
  if public.access_state()::text ~ '(tx-|com\.mdlf\.training\.)' then raise 'fuite dans access_state'; end if;
  -- La clé serveur ne lit pas les tables non plus (elle passe par les fonctions srv_*)
  if pg_temp.psrv($q$ select * from public.entitlements $q$) not like 'permission denied%' then raise 'service_role lit entitlements'; end if;
  if pg_temp.psrv($q$ select * from public.appstore_notifications $q$) not like 'permission denied%' then raise 'service_role lit les notifications'; end if;
  if pg_temp.psrv($q$ select * from public.entitlement_claims $q$) not like 'permission denied%' then raise 'service_role lit les transactions'; end if;
  if pg_temp.psrv($q$ update public.entitlements set gift = true $q$) not like 'permission denied%' then raise 'service_role écrit entitlements'; end if;
  if pg_temp.psrv($q$ update public.app_config set value = 'true'::jsonb where key = 'paywall_on' $q$) not like 'permission denied%' then raise 'service_role allume le verrou'; end if;
end $$;
reset role;

-- ── Anonyme : rien ───────────────────────────────────────
set role anon;
set request.jwt.claim.sub = '';
do $$
declare f text;
begin
  foreach f in array array[
    'public.my_access()', 'public.access_state()',
    format('public.srv_access_purchase(%L, %L, null, %L)', pg_temp.pu('a'), 'com.mdlf.training.pro.monthly', 'tx-anon'),
    format('public.srv_access_event(%L, %L, null, false)', 'tx-a1', 'com.mdlf.training.pro.yearly'),
    'public.redeem_gift_code(''ABCDEFGHJKLM'')', 'private.make_gift_code(''lifetime'')',
    '* from public.entitlements', '* from public.entitlement_claims', '* from public.app_config',
    '* from public.gift_codes', '* from public.gift_redemptions', '* from public.appstore_notifications'] loop
    if pg_temp.perr('select ' || f) not like 'permission denied%' then raise 'anon : %', f; end if;
  end loop;
end $$;
reset role;

-- ── Droits déclarés ──────────────────────────────────────
do $$
declare f regprocedure;
begin
  -- RPC du client : authenticated seulement, security definer, search_path vide
  for f in select p.oid::regprocedure from pg_proc p
             where p.pronamespace = 'public'::regnamespace and p.proname in ('my_access', 'access_state', 'redeem_gift_code') loop
    if not has_function_privilege('authenticated', f, 'execute') then raise '% : authenticated sans droit', f; end if;
    if has_function_privilege('anon', f, 'execute') then raise '% : anon a le droit', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('my_access', 'access_state', 'redeem_gift_code')) <> 3 then raise 'RPC du contrat manquantes'; end if;
  -- Fonctions du serveur : service_role seulement
  for f in select p.oid::regprocedure from pg_proc p
             where p.pronamespace = 'public'::regnamespace and p.proname in ('srv_access_purchase', 'srv_access_event') loop
    if not has_function_privilege('service_role', f, 'execute') then raise '% : la clé serveur ne peut pas écrire', f; end if;
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then raise '% : exécutable par un client', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('srv_access_purchase', 'srv_access_event')) <> 2 then raise 'fonctions du serveur manquantes'; end if;
  -- Briques privées : aucun rôle de l'API
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'private'::regnamespace
             and p.proname in ('access_json', 'access_refresh', 'access_claim', 'access_product_kind', 'access_paywall_on',
                               'gift_code_norm', 'gift_new_code', 'gift_refused', 'make_gift_code', 'sessions_paywall') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute') then raise '% : exécutable par l''API', f; end if;
  end loop;
  -- Aucune autre fonction du schéma public exécutable par un client ne touche au droit d'accès
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname not in ('my_access', 'access_state', 'srv_access_purchase', 'srv_access_event', 'redeem_gift_code',
                                 'coach_tier_state', 'student_offer_code')
               and (p.prosrc ilike '%entitlement%' or p.prosrc ilike '%app_config%')
               and (has_function_privilege('authenticated', p.oid::regprocedure, 'execute')
                    or has_function_privilege('anon', p.oid::regprocedure, 'execute'))) then
    raise 'une autre RPC touche au droit d''accès';
  end if;
  -- RLS fermée sur les tables du droit d'accès ; app_config : lecture seule
  if exists (select 1 from pg_policies where tablename in ('entitlements', 'entitlement_claims', 'appstore_notifications', 'gift_codes', 'gift_redemptions')) then raise 'politique RLS inattendue'; end if;
  if exists (select 1 from pg_class where relname in ('entitlements', 'entitlement_claims', 'appstore_notifications', 'app_config', 'gift_codes', 'gift_redemptions') and not relrowsecurity) then raise 'RLS désactivée'; end if;
  -- Le verrou dur : un déclencheur before insert sur sessions, et seulement sur insert
  if not exists (select 1 from pg_trigger g where g.tgrelid = 'public.sessions'::regclass and g.tgname = 'sessions_paywall') then raise 'déclencheur du verrou absent'; end if;
  if exists (select 1 from pg_policies where tablename = 'app_config' and cmd <> 'SELECT') then raise 'app_config : politique d''écriture'; end if;
  if exists (select 1 from pg_trigger g where g.tgrelid = 'public.sessions'::regclass and g.tgname = 'sessions_paywall' and (g.tgtype & 16) <> 0) then raise 'le verrou porte aussi sur update'; end if;
  if has_table_privilege('authenticated', 'public.app_config', 'update') or has_table_privilege('authenticated', 'public.app_config', 'insert')
     or has_table_privilege('anon', 'public.app_config', 'select') then raise 'droits de app_config'; end if;
  -- original_transaction_id unique (une transaction, un compte)
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.entitlements'::regclass and c.contype = 'u'
                   and c.conkey = array[(select attnum from pg_attribute where attrelid = 'public.entitlements'::regclass and attname = 'original_transaction_id')]::int2[])
     then raise 'original_transaction_id non unique'; end if;
end $$;

-- ── Suppression du compte : tout part en cascade ─────────
do $$
declare a uuid := pg_temp.pu('a');
begin
  if not exists (select 1 from public.entitlements where user_id = a) or not exists (select 1 from public.entitlement_claims where user_id = a)
     then raise 'données de A absentes avant la suppression'; end if;
  delete from auth.users where id = a;
  if exists (select 1 from public.entitlements where user_id = a) then raise 'cascade entitlements'; end if;
  if exists (select 1 from public.entitlement_claims where user_id = a) then raise 'cascade entitlement_claims'; end if;
  if exists (select 1 from private.social_rate where user_id = a) then raise 'cascade social_rate'; end if;
  -- Son abonnement redevient réclamable : le compte n'existe plus
  set local role service_role;
  if pg_temp.perr(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('e'), 'com.mdlf.training.pro.yearly', now() + interval '1 year', 'tx-a1')) is distinct from 'ok' then raise 'transaction d''un compte supprimé'; end if;
  set local role authenticated;
  perform pg_temp.plogin('e');
  if public.my_access() ->> 'status' is distinct from 'active' then raise 'E abonné après la libération'; end if;
  reset role;

  -- H (deux codes utilisés) : ses usages partent, les codes restent et leur compteur ne redescend pas
  if (select count(*) from public.gift_redemptions where user_id = pg_temp.pu('h')) is distinct from 2 then raise 'usages de H'; end if;
  delete from auth.users where id = pg_temp.pu('h');
  if exists (select 1 from public.gift_redemptions where user_id = pg_temp.pu('h')) then raise 'cascade gift_redemptions'; end if;
  if exists (select 1 from public.entitlements where user_id = pg_temp.pu('h')) then raise 'cascade entitlements (H)'; end if;
  if (select uses from public.gift_codes where code = (select code from gifts where who = 'duo')) is distinct from 1 then raise 'compteur rendu par une suppression de compte'; end if;
  if not exists (select 1 from public.gift_codes where code = (select code from gifts where who = 'vie')) then raise 'code supprimé avec le compte'; end if;
  -- Un code supprimé par l'administrateur emporte ses usages (et seulement eux)
  delete from public.gift_codes where code = (select code from gifts where who = 'j30b');
  if exists (select 1 from public.gift_redemptions r where r.code = (select code from gifts where who = 'j30b')) then raise 'cascade du code vers ses usages'; end if;
  if not exists (select 1 from public.entitlements where user_id = pg_temp.pu('g')) then raise 'le compte suit le code supprimé'; end if;
end $$;

-- Nettoyage : les tests suivants partent d'une base sans ces comptes
delete from auth.users where id in (select pg_temp.pu(c) from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) c);

-- ═══════════════════════════════════════════════════════════
--  Modèle B (20261029000000_payant_modele_b.sql) : offre de lancement d'Apple, Sandbox accepté,
--  élèves de coach plafonnés, grâce de fin de séance. Comptes : pg_temp.pq('a') → …00000000071a.
-- ═══════════════════════════════════════════════════════════
create function pg_temp.pq(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000071' || translate(c, 'abcdefghij', 'abcdef7890'))::uuid $$;
create function pg_temp.pqlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.pq(c)::text, false) $$;
-- Séance commencée à « began », finie à « done » (l'app enregistre date = fin, duration = durée)
create function pg_temp.psess(id text, began timestamptz, done timestamptz) returns text language sql as
$$ select pg_temp.perr(format('insert into public.sessions (id, data) values (%L, %L)', id,
     jsonb_build_object('date', (extract(epoch from done) * 1000)::bigint,
                        'duration', (extract(epoch from done - began) * 1000)::bigint, 'exercises', '[]'::jsonb))) $$;
grant execute on function pg_temp.pq(text), pg_temp.pqlogin(text), pg_temp.psess(text, timestamptz, timestamptz)
  to authenticated, anon, service_role;
insert into auth.users (id) select pg_temp.pq(c) from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g']) c;

-- ── Offre de lancement d'Apple (« 3 mois gratuits ») et environnement ──
do $$
declare st jsonb;
begin
  set role authenticated;
  perform pg_temp.pqlogin('a');
  perform public.my_access();
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  set role authenticated;
  -- Pas d'abonnement : pas d'essai, même pour un compte tout neuf
  if (public.my_access() ->> 'can_write')::boolean then raise 'compte neuf : droit sans abonnement'; end if;
  -- L'essai gratuit d'Apple (offerType 1) est un abonnement actif, intro_offer et sa fin exposés
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, %L, true, %L)', pg_temp.pq('a'),
     'com.mdlf.training.pro.yearly', now() + interval '90 days', 'tx-q1', now() - interval '1 minute', 'Sandbox')) is distinct from 'ok' then raise 'essai d''Apple'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'active' or not (st ->> 'can_write')::boolean or not (st ->> 'intro_offer')::boolean
     or (st ->> 'intro_until')::timestamptz not between now() + interval '89 days' and now() + interval '91 days'
     or (st ->> 'until')::timestamptz is distinct from (st ->> 'intro_until')::timestamptz then raise 'essai d''Apple : %', st; end if;
  -- Sandbox ACCEPTÉ (examen d'Apple, TestFlight) et enregistré
  reset role;
  if (select environment from public.entitlement_claims where original_transaction_id = 'tx-q1') is distinct from 'Sandbox' then raise 'environnement non enregistré'; end if;
  set role authenticated;
  -- Un évènement en retard (plus ancien) ne change pas l'offre
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L, false, null, null, false, %L)', 'tx-q1',
     'com.mdlf.training.pro.yearly', now() + interval '90 days', now() - interval '1 day', 'Production')) is distinct from 'ok' then raise 'évènement en retard'; end if;
  if not (public.my_access() ->> 'intro_offer')::boolean then raise 'offre effacée par un évènement en retard'; end if;
  reset role;
  if (select environment from public.entitlement_claims where original_transaction_id = 'tx-q1') is distinct from 'Sandbox' then raise 'environnement écrasé par un évènement en retard'; end if;
  set role authenticated;
  -- Fin de l'essai : premier renouvellement payé (offerType absent) → abonné sans offre
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L, false, null, null, false, %L)', 'tx-q1',
     'com.mdlf.training.pro.yearly', now() + interval '455 days', now(), 'Sandbox')) is distinct from 'ok' then raise 'renouvellement'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'active' or (st ->> 'intro_offer')::boolean or st -> 'intro_until' is distinct from 'null'::jsonb then raise 'après l''essai : %', st; end if;
  -- p_intro inconnu (null) : la valeur gardée ne bouge pas ; environnement inconnu : ignoré
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L, false, null, null, null, %L)', 'tx-q1',
     'com.mdlf.training.pro.yearly', now() + interval '455 days', now() + interval '1 minute', 'Xcode')) is distinct from 'ok' then raise 'évènement sans offre'; end if;
  reset role;
  if (select intro_offer from public.entitlement_claims where original_transaction_id = 'tx-q1') then raise 'intro null a écrasé la valeur'; end if;
  if (select environment from public.entitlement_claims where original_transaction_id = 'tx-q1') is distinct from 'Sandbox' then raise 'environnement Xcode écrit'; end if;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
end $$;

-- Les élèves gratuits (10 par coach) ont été retirés par 20261030000000_payant_tarifs.sql : voir tarifs_test.sql.

-- ── Grâce de fin de séance : bornée, et sans antidatage possible ──
do $$
declare ended timestamptz;
begin
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  -- E : abonnement fini il y a 2 heures (Apple a fermé l'accès)
  set role authenticated;
  perform pg_temp.pqlogin('e');
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pq('e'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-qe')) is distinct from 'ok' then raise 'abonnement de E'; end if;
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, %L, false, %L, true)', 'tx-qe', 'com.mdlf.training.pro.monthly', now() - interval '2 hours', now())) is distinct from 'ok' then raise 'fin de E'; end if;
  if (public.my_access() ->> 'can_write')::boolean then raise 'E écrit encore'; end if;
  ended := (public.my_access() ->> 'until')::timestamptz;
  -- Séance commencée 30 min avant la fin, terminée maintenant : enregistrée
  if pg_temp.psess('e-1', ended - interval '30 minutes', now()) is distinct from 'ok' then raise 'séance commencée avec le droit refusée'; end if;
  -- I2 : la même séance renvoyée (réessai réseau, correction, par upsert comme l'app) passe et ne
  -- consomme PAS la seconde grâce
  if pg_temp.perr(format($q$ insert into public.sessions (user_id, id, data) values (%L, 'e-1', '{}')
       on conflict (user_id, id) do update set data = public.sessions.data || '{"note": "renvoyée"}' $q$, pg_temp.pq('e'))) is distinct from 'ok' then raise 'renvoi d''une séance de grâce refusé'; end if;
  reset role;
  if (select count(*) from private.social_rate where user_id = pg_temp.pq('e') and action = 'session_grace') is distinct from 1 then raise 'un renvoi a consommé une grâce'; end if;
  set role authenticated;
  perform pg_temp.pqlogin('e');
  -- Commencée APRÈS la fin : refusée
  if pg_temp.psess('e-2', ended + interval '10 minutes', now()) is distinct from 'paywall_locked' then raise 'séance commencée sans droit acceptée'; end if;
  -- Antidatée (commencée 2 jours avant la fin, plus de 12 h) : refusée
  if pg_temp.psess('e-3', ended - interval '2 days', ended - interval '2 days' + interval '1 hour') is distinct from 'paywall_locked' then raise 'séance antidatée acceptée'; end if;
  -- Date absente ou absurde : refusée
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('e-4', '{"exercises": []}') $q$) is distinct from 'paywall_locked' then raise 'séance sans date acceptée'; end if;
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('e-5', '{"date": "hier", "exercises": []}') $q$) is distinct from 'paywall_locked' then raise 'date texte acceptée'; end if;
  -- Une deuxième passe, la troisième non (2 séances au plus par fin d'accès)
  if pg_temp.psess('e-6', ended - interval '3 hours', ended - interval '1 hour') is distinct from 'ok' then raise 'deuxième séance de grâce'; end if;
  if pg_temp.psess('e-7', ended - interval '4 hours', ended - interval '3 hours') is distinct from 'paywall_locked' then raise 'troisième séance de grâce acceptée'; end if;
  -- Les refus n'ont rien écrit
  reset role;
  if (select count(*) from public.sessions where user_id = pg_temp.pq('e')) is distinct from 2 then raise 'séances de E : %', (select array_agg(id) from public.sessions where user_id = pg_temp.pq('e')); end if;
  -- Plus de 24 h après la fin (heure du serveur) : plus rien, quelle que soit la date déclarée
  delete from private.social_rate where user_id = pg_temp.pq('e') and action = 'session_grace';
  update public.entitlement_claims set expires_at = now() - interval '25 hours', event_at = null where original_transaction_id = 'tx-qe';
  perform private.access_refresh(pg_temp.pq('e'));
  set role authenticated;
  ended := (public.my_access() ->> 'until')::timestamptz;
  if pg_temp.psess('e-8', ended - interval '30 minutes', ended + interval '10 minutes') is distinct from 'paywall_locked' then raise 'grâce au-delà de 24 h'; end if;
  -- I1 : verrou allumé, sans droit, hors grâce : l'app corrige et met à la corbeille par upsert
  -- (insert … on conflict) ; une ligne déjà là n'est pas une séance nouvelle, elle passe
  if pg_temp.perr(format($q$ insert into public.sessions (user_id, id, data) values (%L, 'e-6', '{}')
       on conflict (user_id, id) do update set data = public.sessions.data || '{"notes": "corrigée"}' $q$, pg_temp.pq('e'))) is distinct from 'ok' then raise 'correction par upsert refusée'; end if;
  if pg_temp.perr(format($q$ insert into public.sessions (user_id, id, data, deleted_at) values (%L, 'e-6', '{}', now())
       on conflict (user_id, id) do update set deleted_at = excluded.deleted_at $q$, pg_temp.pq('e'))) is distinct from 'ok' then raise 'mise à la corbeille par upsert refusée'; end if;
  -- … mais une séance NOUVELLE par le même chemin (upsert) reste refusée
  if pg_temp.perr(format($q$ insert into public.sessions (user_id, id, data) values (%L, 'e-9', '{"date": 1}')
       on conflict (user_id, id) do update set data = excluded.data $q$, pg_temp.pq('e'))) is distinct from 'paywall_locked' then raise 'séance nouvelle par upsert acceptée'; end if;
  reset role;
  if (select data ->> 'notes' from public.sessions where user_id = pg_temp.pq('e') and id = 'e-6') is distinct from 'corrigée'
     or (select deleted_at from public.sessions where user_id = pg_temp.pq('e') and id = 'e-6') is null then raise 'correction ou corbeille non écrites'; end if;
  if exists (select 1 from public.sessions where user_id = pg_temp.pq('e') and id = 'e-9') then raise 'e-9 écrite'; end if;
  set role authenticated;
  perform pg_temp.pqlogin('e');
  -- Jamais abonné : aucune grâce
  perform pg_temp.pqlogin('f');
  if pg_temp.psess('f-1', now() - interval '1 hour', now()) is distinct from 'paywall_locked' then raise 'grâce sans abonnement'; end if;
  reset role;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
end $$;

-- ── Verrou sur les MISES À JOUR (relecture du 28/10) ─────
-- Sans droit d'écrire, verrou allumé : ni réécrire la date d'une séance, ni renommer son id, ni la
-- sortir de la corbeille, par UPDATE direct ou par upsert. Corriger sans changer la date et mettre à
-- la corbeille restent permis. Les lignes semées verrou éteint ne se réveillent pas verrou allumé.
do $$
begin
  set role authenticated;
  perform pg_temp.pqlogin('g');
  -- Verrou éteint : une séance vivante et 50 lignes de corbeille « en réserve »
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('g-1', '{"date": 1780000000000, "notes": "a"}') $q$) is distinct from 'ok' then raise 'g-1'; end if;
  if pg_temp.perr($q$ insert into public.sessions (id, data, deleted_at) select 'reserve-' || g, '{}', now() from generate_series(1, 50) g $q$) is distinct from 'ok' then raise 'réserve semée'; end if;
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  set role authenticated;
  perform pg_temp.pqlogin('g');
  if (public.my_access() ->> 'can_write')::boolean then raise 'G ne devrait pas pouvoir écrire'; end if;
  -- Refusés : UPDATE direct de la date, renommage, sortie de la corbeille (direct et par upsert)
  if pg_temp.perr($q$ update public.sessions set data = '{"date": 1790000000000, "exercises": ["NEUVE"]}' where id = 'g-1' $q$) is distinct from 'paywall_locked' then raise 'date réécrite par UPDATE'; end if;
  if pg_temp.perr(format($q$ insert into public.sessions (user_id, id, data) values (%L, 'g-1', '{"date": 1790000000000}') on conflict (user_id, id) do update set data = excluded.data $q$, pg_temp.pq('g'))) is distinct from 'paywall_locked' then raise 'date réécrite par upsert'; end if;
  if pg_temp.perr($q$ update public.sessions set id = 'id-tout-neuf' where id = 'g-1' $q$) is distinct from 'paywall_locked' then raise 'id renommé'; end if;
  if pg_temp.perr($q$ update public.sessions set deleted_at = null, data = '{"date": 1790000000000}' where id = 'reserve-1' $q$) is distinct from 'paywall_locked' then raise 'sortie de corbeille par UPDATE'; end if;
  if pg_temp.perr(format($q$ insert into public.sessions (user_id, id, data, deleted_at) select %L, 'reserve-' || g, jsonb_build_object('date', 1790000000000 + g), null from generate_series(1, 50) g
       on conflict (user_id, id) do update set data = excluded.data, deleted_at = excluded.deleted_at $q$, pg_temp.pq('g'))) is distinct from 'paywall_locked' then raise 'réserve réveillée par upsert'; end if;
  reset role;
  if (select count(*) from public.sessions where user_id = pg_temp.pq('g') and id like 'reserve-%' and deleted_at is null) <> 0 then raise 'une ligne de réserve a été réveillée'; end if;
  if (select data ->> 'date' from public.sessions where user_id = pg_temp.pq('g') and id = 'g-1') is distinct from '1780000000000' then raise 'g-1 modifiée'; end if;
  set role authenticated;
  perform pg_temp.pqlogin('g');
  -- Permis : corriger sans changer la date (UPDATE et upsert), puis mettre à la corbeille
  if pg_temp.perr($q$ update public.sessions set data = '{"date": 1780000000000, "notes": "corrigée"}' where id = 'g-1' $q$) is distinct from 'ok' then raise 'correction refusée'; end if;
  if pg_temp.perr(format($q$ insert into public.sessions (user_id, id, data) values (%L, 'g-1', '{"date": 1780000000000, "notes": "corrigée 2"}') on conflict (user_id, id) do update set data = excluded.data $q$, pg_temp.pq('g'))) is distinct from 'ok' then raise 'correction par upsert refusée'; end if;
  if pg_temp.perr($q$ update public.sessions set deleted_at = now() where id = 'g-1' $q$) is distinct from 'ok' then raise 'mise à la corbeille refusée'; end if;
  -- Une ligne déjà à la corbeille peut changer de contenu (elle reste à la corbeille, rien n'est gagné)
  if pg_temp.perr($q$ update public.sessions set data = '{"date": 1790000000000}' where id = 'reserve-2' $q$) is distinct from 'ok' then raise 'corbeille modifiable sans sortir'; end if;
  -- Avec un droit (abonné), tout redevient possible
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pq('g'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-qg')) is distinct from 'ok' then raise 'abonnement de G'; end if;
  if pg_temp.perr($q$ update public.sessions set deleted_at = null, data = '{"date": 1790000000000}' where id = 'reserve-3' $q$) is distinct from 'ok' then raise 'abonné : sortie de corbeille refusée'; end if;
  if pg_temp.perr($q$ update public.sessions set id = 'renommee' where id = 'reserve-3' $q$) is distinct from 'ok' then raise 'abonné : renommage refusé'; end if;
  reset role;
  -- Ordre des déclencheurs : le verrou des mises à jour passe AVANT sessions_touch
  if (select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.sessions'::regclass and not tgisinternal and (tgtype & 16) <> 0)
     is distinct from array['sessions_paywall_upd', 'sessions_touch'] then raise 'déclencheurs de mise à jour : %', (select array_agg(tgname) from pg_trigger where tgrelid = 'public.sessions'::regclass and not tgisinternal); end if;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
end $$;

-- ── Aucune écriture directe des nouveautés ───────────────
set role authenticated;
do $$ begin
  perform pg_temp.pqlogin('a');
  if pg_temp.perr($q$ update public.entitlement_claims set intro_offer = true $q$) not like 'permission denied%' then raise 'intro_offer modifiable'; end if;
  if (select count(*) from public.app_config) is distinct from 2 then raise 'app_config pour authenticated'; end if;
end $$;
reset role;

-- ── Compte obligatoire : anon ne lit QUE paywall_on ──────
set role anon;
do $$
declare k text[];
begin
  perform set_config('request.jwt.claim.sub', '', false);
  select array_agg(key order by key) into k from public.app_config;
  if k is distinct from array['min_build', 'paywall_on'] then raise 'anon lit : %', k; end if;
  -- anon ne modifie pas min_build non plus
  if pg_temp.perr($q$ update public.app_config set value = '9999'::jsonb where key = 'min_build' $q$) not like 'permission denied%' then raise 'anon modifie min_build'; end if;
  if pg_temp.perr($q$ select updated_at from public.app_config $q$) not like 'permission denied%' then raise 'anon lit updated_at'; end if;
  if pg_temp.perr($q$ update public.app_config set value = 'false'::jsonb where key = 'paywall_on' $q$) not like 'permission denied%' then raise 'anon modifie paywall_on'; end if;
  if pg_temp.perr('select public.my_access()') not like 'permission denied%' then raise 'anon : my_access'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from pg_policies where tablename = 'app_config' and 'anon' = any(roles)) is distinct from 1
     or not exists (select 1 from pg_policies where tablename = 'app_config' and 'anon' = any(roles) and cmd = 'SELECT' and qual like '%paywall_on%')
     then raise 'politique anon de app_config'; end if;
  if has_column_privilege('anon', 'public.app_config', 'updated_at', 'select') or has_table_privilege('anon', 'public.app_config', 'update')
     then raise 'anon a trop de droits sur app_config'; end if;
end $$;

-- Nettoyage
delete from auth.users where id in (select pg_temp.pq(c) from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g']) c);
