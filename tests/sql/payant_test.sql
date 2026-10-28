-- Vérifications de supabase/migrations/20261028000000_payant.sql (lancées par tests/sql/run.sh).
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

-- ── Réglages livrés : verrou éteint, essai de 90 jours ───
do $$
declare v jsonb;
begin
  if (select value from public.app_config where key = 'paywall_on') is distinct from 'false'::jsonb then raise 'paywall_on livré allumé'; end if;
  if (select value from public.app_config where key = 'trial_days') is distinct from '90'::jsonb then raise 'trial_days'; end if;
  -- Plafond de l'essai sans preuve Apple (20261029000000_payant_apple.sql) : 3 jours
  if (select value from public.app_config where key = 'trial_unproven_days') is distinct from '3'::jsonb then raise 'trial_unproven_days'; end if;
  if (select count(*) from public.app_config) is distinct from 3 then raise 'clés de app_config'; end if;
end $$;

set role authenticated;
do $$ begin
  perform pg_temp.plogin('a');
  -- Lisible par un compte connecté
  if (select value from public.app_config where key = 'paywall_on') is distinct from 'false'::jsonb then raise 'app_config illisible'; end if;
  -- Jamais modifiable par le client
  if pg_temp.perr($q$ update public.app_config set value = 'true'::jsonb where key = 'paywall_on' $q$) not like 'permission denied%' then raise 'paywall_on modifiable par le client'; end if;
  if pg_temp.perr($q$ update public.app_config set value = '36500'::jsonb where key = 'trial_days' $q$) not like 'permission denied%' then raise 'trial_days modifiable'; end if;
  if pg_temp.perr($q$ insert into public.app_config (key, value) values ('autre', '1') $q$) not like 'permission denied%' then raise 'app_config : insertion'; end if;
  if pg_temp.perr($q$ delete from public.app_config $q$) not like 'permission denied%' then raise 'app_config : suppression'; end if;
end $$;

-- ── L'essai démarre à l'heure du serveur, et une seule fois ──
do $$
declare st jsonb; t0 timestamptz; t1 timestamptz;
begin
  perform pg_temp.plogin('a');
  -- Avant tout appel : access_state ne crée rien et montre un essai qui n'a pas commencé
  st := public.access_state();
  if st ->> 'status' is distinct from 'trial' or st -> 'until' is distinct from 'null'::jsonb
     or (st ->> 'days_left')::int is distinct from 90 or not (st ->> 'can_write')::boolean
     or (st ->> 'paywall_on')::boolean or (st ->> 'trial_days')::int is distinct from 90
     or (st ->> 'gift')::boolean or (st ->> 'coach_team')::boolean then raise 'access_state avant essai : %', st; end if;
  if (st ->> 'server_now')::timestamptz not between now() - interval '1 minute' and now() + interval '1 minute' then raise 'server_now : %', st; end if;
  -- Les 10 clés du contrat, plus apple_linked et trial_shared (règle 1, 20261029000000_payant_apple.sql), exactement
  if (select array_agg(k order by k) from jsonb_object_keys(st) k) is distinct from
     array['apple_linked', 'can_write', 'coach_team', 'days_left', 'gift', 'gift_until', 'paywall_on', 'server_now', 'status', 'trial_days', 'trial_shared', 'until']
     then raise 'clés de access_state : %', st; end if;
  -- Rien n'a été créé
  reset role;
  if exists (select 1 from public.entitlements where user_id = pg_temp.pu('a')) then raise 'access_state a créé une ligne'; end if;
  set role authenticated;

  -- my_access : l'essai démarre ici
  st := public.my_access();
  if (select array_agg(k order by k) from jsonb_object_keys(st) k) is distinct from
     array['apple_linked', 'can_write', 'coach_team', 'days_left', 'gift', 'gift_until', 'paywall_on', 'server_now', 'status', 'trial_days', 'trial_shared', 'until']
     then raise 'clés de my_access : %', st; end if;
  if st ->> 'status' is distinct from 'trial' or (st ->> 'days_left')::int is distinct from 90
     or not (st ->> 'can_write')::boolean then raise 'my_access : %', st; end if;
  if (st ->> 'until')::timestamptz not between now() + interval '89 days' and now() + interval '91 days' then raise 'fin de l''essai : %', st; end if;
  reset role;
  select trial_started_at into t0 from public.entitlements where user_id = pg_temp.pu('a');
  if t0 not between now() - interval '1 minute' and now() + interval '1 minute' then raise 'trial_started_at n''est pas l''heure du serveur : %', t0; end if;
  if (select status from public.entitlements where user_id = pg_temp.pu('a')) is distinct from 'trial' then raise 'instantané du statut'; end if;
  set role authenticated;
  -- Rappelée : rien ne bouge (ni l'essai, ni la date)
  perform public.my_access();
  perform public.my_access();
  reset role;
  select trial_started_at into t1 from public.entitlements where user_id = pg_temp.pu('a');
  if t1 is distinct from t0 then raise 'my_access a redémarré l''essai : % → %', t0, t1; end if;
  if (select count(*) from public.entitlements where user_id = pg_temp.pu('a')) is distinct from 1 then raise 'deux lignes'; end if;
  set role authenticated;
  -- access_state donne le même état, sans écrire
  if public.access_state() ->> 'status' is distinct from 'trial'
     or (public.access_state() ->> 'until')::timestamptz is distinct from (public.my_access() ->> 'until')::timestamptz
     then raise 'access_state et my_access divergent'; end if;
end $$;

-- ── Un client ne peut PAS prolonger son essai ────────────
do $$
declare st jsonb; t0 timestamptz;
begin
  -- Essai vieux de 100 jours : terminé
  reset role;
  update public.entitlements set trial_started_at = now() - interval '100 days' where user_id = pg_temp.pu('a');
  select trial_started_at into t0 from public.entitlements where user_id = pg_temp.pu('a');
  set role authenticated;
  perform pg_temp.plogin('a');
  st := public.my_access();
  if st ->> 'status' is distinct from 'expired' or (st ->> 'days_left')::int is distinct from 0 then raise 'essai terminé : %', st; end if;
  if (st ->> 'until')::timestamptz not between now() - interval '11 days' and now() - interval '9 days' then raise 'until d''un essai terminé : %', st; end if;
  -- Le verrou est éteint : on peut toujours écrire
  if not (st ->> 'can_write')::boolean then raise 'can_write faux avec le verrou éteint'; end if;
  -- Rappeler my_access (ou access_state) en rafale ne redonne rien
  for i in 1..5 loop perform public.my_access(); perform public.access_state(); end loop;
  reset role;
  if (select trial_started_at from public.entitlements where user_id = pg_temp.pu('a')) is distinct from t0 then raise 'essai prolongé par my_access'; end if;
  set role authenticated;
  if public.my_access() ->> 'status' is distinct from 'expired' then raise 'statut regagné'; end if;
  -- Aucune autre RPC du client ne touche aux tables du droit d'accès
  if pg_temp.perr($q$ update public.entitlements set trial_started_at = now() $q$) not like 'permission denied%' then raise 'trial_started_at modifiable'; end if;
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
  if not (st ->> 'paywall_on')::boolean or (st ->> 'can_write')::boolean or st ->> 'status' is distinct from 'expired'
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
declare st jsonb; t0 timestamptz;
begin
  perform pg_temp.plogin('a');
  reset role;
  select trial_started_at into t0 from public.entitlements where user_id = pg_temp.pu('a');
  set role authenticated;
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
  -- L'achat ne touche pas la date de début d'essai
  if (select trial_started_at from public.entitlements where user_id = pg_temp.pu('a')) is distinct from t0 then raise 'achat et trial_started_at'; end if;
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
  if st ->> 'status' is distinct from 'trial' or st ->> 'gift' is distinct from 'false' then raise 'E a gagné un accès : %', st; end if;
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

-- ── Accès offert d'Apple (non consommable) ──────────────
do $$
declare st jsonb;
begin
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, null, %L)', pg_temp.pu('b'), 'com.mdlf.training.access.gift', 'tx-b1')) is distinct from 'ok' then raise 'accès offert refusé'; end if;
  perform pg_temp.plogin('b');
  st := public.my_access();
  if st ->> 'status' is distinct from 'gift' or not (st ->> 'gift')::boolean or st -> 'until' is distinct from 'null'::jsonb
     or st -> 'days_left' is distinct from 'null'::jsonb or not (st ->> 'can_write')::boolean then raise 'accès offert : %', st; end if;
  -- Tient même le verrou allumé et l'essai terminé
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  update public.entitlements set trial_started_at = now() - interval '5 years' where user_id = pg_temp.pu('b');
  set role authenticated;
  st := public.my_access();
  if st ->> 'status' is distinct from 'gift' or not (st ->> 'can_write')::boolean then raise 'accès offert avec le verrou : %', st; end if;
  reset role;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
  set role authenticated;
  -- Un accès offert révoqué (remboursement) tombe
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, null, true)', 'tx-b1', 'com.mdlf.training.access.gift')) is distinct from 'ok' then raise 'révocation du cadeau'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'expired' or (st ->> 'gift')::boolean then raise 'cadeau révoqué : %', st; end if;
  -- I1 : un remboursé le RESTE. Un évènement ultérieur qui ne révoque pas ne réactive rien, même
  -- avec une date d'évènement plus récente (notification rejouée, transaction rechargée par l'app).
  if pg_temp.psrv(format('select public.srv_access_event(%L, %L, null, false, %L)', 'tx-b1', 'com.mdlf.training.access.gift', now() + interval '1 day')) is distinct from 'ok' then raise 'évènement après remboursement'; end if;
  if public.my_access() ->> 'status' is distinct from 'expired' then raise 'un remboursé a été réactivé'; end if;
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, null, %L)', pg_temp.pu('b'), 'com.mdlf.training.access.gift', 'tx-b1')) is distinct from 'ok' then raise 'achat après remboursement'; end if;
  if public.my_access() ->> 'status' is distinct from 'expired' then raise 'un remboursé réactivé par verify-purchase'; end if;
  reset role;
  if (select revoked_at from public.entitlement_claims where original_transaction_id = 'tx-b1') is null then raise 'revoked_at effacé'; end if;
  -- L'administrateur peut rouvrir à la main (réabonnement sur la même transaction d'origine)
  update public.entitlement_claims set revoked_at = null, event_at = null where original_transaction_id = 'tx-b1';
  perform private.access_refresh(pg_temp.pu('b'));
  set role authenticated;
  if public.my_access() ->> 'status' is distinct from 'gift' then raise 'réouverture par l''administrateur'; end if;
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
  if g -> 'access' ->> 'status' is distinct from 'trial' then raise 'access dans un refus : %', g; end if;
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
  -- Le cadeau tient le verrou allumé et un essai terminé
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  update public.entitlements set trial_started_at = now() - interval '300 days' where user_id = pg_temp.pu('g');
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

-- ── Élève suivi par un coach ─────────────────────────────
do $$
declare st jsonb;
begin
  perform pg_temp.plogin('d');
  if public.my_access() ->> 'status' is distinct from 'trial' then raise 'D avant le coach'; end if;
  reset role;
  insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('d'), pg_temp.pu('c'));
  -- Essai terminé et verrou allumé : seul le coach le sauve
  update public.entitlements set trial_started_at = now() - interval '200 days' where user_id = pg_temp.pu('d');
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  set role authenticated;
  st := public.my_access();
  if st ->> 'status' is distinct from 'coach_team' or not (st ->> 'coach_team')::boolean
     or not (st ->> 'can_write')::boolean or st -> 'until' is distinct from 'null'::jsonb
     or st -> 'days_left' is distinct from 'null'::jsonb then raise 'élève de coach : %', st; end if;
  if public.access_state() ->> 'status' is distinct from 'coach_team' then raise 'access_state pour un élève'; end if;
  reset role;
  if not (select in_coach_team from public.entitlements where user_id = pg_temp.pu('d')) then raise 'instantané in_coach_team'; end if;
  set role authenticated;
  -- Le coach, lui, n'a rien de plus
  perform pg_temp.plogin('c');
  st := public.my_access();
  if (st ->> 'coach_team')::boolean or st ->> 'status' is distinct from 'trial' then raise 'le coach n''est pas son propre élève : %', st; end if;
  -- L'élève quitte : l'accès tombe au prochain appel, sans écriture d'Apple
  reset role;
  delete from public.coach_links where student_id = pg_temp.pu('d');
  set role authenticated;
  perform pg_temp.plogin('d');
  st := public.my_access();
  if st ->> 'status' is distinct from 'expired' or (st ->> 'coach_team')::boolean or (st ->> 'can_write')::boolean
     then raise 'après le départ du coach : %', st; end if;
  reset role;
  if (select in_coach_team from public.entitlements where user_id = pg_temp.pu('d')) then raise 'instantané in_coach_team non remis'; end if;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
  set role authenticated;
  -- Un abonné qui est aussi élève reste « active » (ordre des statuts, choix 3)
  reset role;
  insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('d'), pg_temp.pu('c'));
  set role authenticated;
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('d'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-d1')) is distinct from 'ok' then raise 'abonnement de D'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'active' or not (st ->> 'coach_team')::boolean then raise 'abonné et élève : %', st; end if;
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
  if st ->> 'status' is distinct from 'expired' or (st ->> 'days_left')::int is distinct from 0 then raise 'EXPIRED n''a pas fermé l''accès : %', st; end if;
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
  reset role;
  update public.entitlements set trial_started_at = now() - interval '200 days' where user_id = pg_temp.pu('i');
  set role authenticated;
  -- Verrou éteint : l'insertion passe, essai terminé ou non
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('i-1', '{"date": 1780000000000, "exercises": []}') $q$) is distinct from 'ok' then raise 'insertion refusée verrou éteint'; end if;
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  set role authenticated;
  if (public.my_access() ->> 'can_write')::boolean then raise 'can_write devrait être faux'; end if;
  -- Verrou allumé et droit tombé : une NOUVELLE séance est refusée par le serveur
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('i-2', '{"date": 1780000001000, "exercises": []}') $q$) is distinct from 'paywall_locked' then raise 'le serveur accepte une nouvelle séance, verrou allumé'; end if;
  if pg_temp.perr(format($q$ insert into public.sessions (user_id, id, data) values (%L, 'i-3', '{"date": 1, "exercises": []}') $q$, pg_temp.pu('i'))) is distinct from 'paywall_locked' then raise 'contournement en posant user_id'; end if;
  -- Corriger et mettre à la corbeille une séance déjà là restent permis : on ne perd rien
  if pg_temp.perr($q$ update public.sessions set data = '{"date": 1780000000000, "notes": "corrigée", "exercises": []}' where id = 'i-1' $q$) is distinct from 'ok' then raise 'correction refusée'; end if;
  if pg_temp.perr($q$ update public.sessions set deleted_at = now() where id = 'i-1' $q$) is distinct from 'ok' then raise 'mise à la corbeille refusée'; end if;
  reset role;
  if exists (select 1 from public.sessions where user_id = pg_temp.pu('i') and id in ('i-2', 'i-3')) then raise 'séance refusée pourtant écrite'; end if;
  set role authenticated;
  -- Un abonné passe, verrou allumé
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pu('i'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-i1')) is distinct from 'ok' then raise 'abonnement de I'; end if;
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('i-4', '{"date": 1780000002000, "exercises": []}') $q$) is distinct from 'ok' then raise 'abonné refusé'; end if;
  -- Un élève de coach aussi
  reset role;
  update public.entitlement_claims set revoked_at = now() where original_transaction_id = 'tx-i1';
  perform private.access_refresh(pg_temp.pu('i'));
  insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('i'), pg_temp.pu('c'));
  set role authenticated;
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('i-5', '{"date": 1780000003000, "exercises": []}') $q$) is distinct from 'ok' then raise 'élève de coach refusé'; end if;
  reset role;
  delete from public.coach_links where student_id = pg_temp.pu('i');
  set role authenticated;
  -- Un compte tout neuf, jamais passé par my_access : son essai démarre dans le déclencheur, à
  -- l'heure du serveur (ne jamais appeler my_access ne donne pas un essai éternel)
  perform pg_temp.plogin('j');
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('j-1', '{"date": 1780000000000, "exercises": []}') $q$) is distinct from 'ok' then raise 'nouveau compte refusé'; end if;
  reset role;
  if (select trial_started_at from public.entitlements where user_id = pg_temp.pu('j')) not between now() - interval '1 minute' and now() + interval '1 minute' then raise 'essai de J non démarré par le déclencheur'; end if;
  update public.entitlements set trial_started_at = now() - interval '200 days' where user_id = pg_temp.pu('j');
  set role authenticated;
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('j-2', '{"date": 1780000001000, "exercises": []}') $q$) is distinct from 'paywall_locked' then raise 'J après son essai'; end if;
  reset role;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
  set role authenticated;
  -- Verrou éteint : tout repasse
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
                           'private.access_claim(pg_temp.pu(''e''), ''com.mdlf.training.access.gift'', null, ''tx-e9'', false)',
                           'private.access_product_kind(''com.mdlf.training.access.gift'')',
                           'private.access_paywall_on()', 'private.access_trial_days()'] loop
    if pg_temp.perr('select ' || t) not like 'permission denied%' then raise '% appelable', t; end if;
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
    format('public.srv_access_purchase(%L, %L, null, %L)', pg_temp.pu('a'), 'com.mdlf.training.access.gift', 'tx-anon'),
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
             and p.proname in ('access_json', 'access_refresh', 'access_claim', 'access_product_kind', 'access_paywall_on', 'access_trial_days',
                               'gift_code_norm', 'gift_new_code', 'gift_refused', 'make_gift_code', 'sessions_paywall') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute') then raise '% : exécutable par l''API', f; end if;
  end loop;
  -- Aucune autre fonction du schéma public exécutable par un client ne touche au droit d'accès
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname not in ('my_access', 'access_state', 'srv_access_purchase', 'srv_access_event', 'redeem_gift_code')
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
--  Règles du 28/10 (supabase/migrations/20261029000000_payant_apple.sql)
--  Règle 1 : l'essai est rattaché à l'installation (identifiant du magasin), plafond sans preuve pour
--  les comptes vus sur iPhone seulement. Règle 2 : paywall_on lisible sans compte, et rien d'autre.
--  Comptes : pg_temp.pq('a') → …00000000071a. Le serveur a déjà vérifié la signature (fonction
--  Edge) : ici on appelle srv_link_store_install comme elle le fait.
-- ═══════════════════════════════════════════════════════════
create function pg_temp.pq(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000071' || translate(c, 'abcdefghij', 'abcdef7890'))::uuid $$;
create function pg_temp.pqlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.pq(c)::text, false) $$;
-- Liaison faite par la fonction Edge (clé serveur), sans quitter le rôle courant
create function pg_temp.plink(c text, app text, env text default 'Production', bundle text default 'com.mdlf.training',
                              store text default 'apple')
  returns text language sql as
$$ select pg_temp.psrv(format('select public.srv_link_store_install(%L, %L, %L, %L, %L)', pg_temp.pq(c), store, app, env, bundle)) $$;
-- Départ de l'essai d'un compte (heure du serveur), posé comme le ferait le temps qui passe
create function pg_temp.pstart(c text, ago interval) returns void language sql as
$$ update public.entitlements set trial_started_at = now() - ago where user_id = pg_temp.pq(c) $$;
grant execute on function pg_temp.pq(text), pg_temp.pqlogin(text), pg_temp.plink(text, text, text, text, text)
  to authenticated, anon, service_role;
insert into auth.users (id) select pg_temp.pq(c) from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) c;
-- G est coach (rôle donné par l'administrateur)
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at) values (pg_temp.pq('g'), 'quentin.p2', '🦁', now());

-- ── Règle 1 : deux comptes sur le même identifiant Apple n'ont qu'un essai ──
do $$
declare st jsonb;
begin
  -- K a commencé son essai il y a 80 jours sur son iPhone, puis la preuve d'Apple arrive
  set role authenticated;
  perform pg_temp.pqlogin('a');
  perform public.my_access('ios');
  reset role;
  perform pg_temp.pstart('a', interval '80 days');
  set role authenticated;
  if pg_temp.plink('a', 'APPTX-1') is distinct from 'ok' then raise 'liaison de K'; end if;
  st := public.my_access('ios');
  if st ->> 'status' is distinct from 'trial' or (st ->> 'days_left')::int is distinct from 10
     or not (st ->> 'apple_linked')::boolean or (st ->> 'trial_shared')::boolean then raise 'K après liaison : %', st; end if;
  reset role;
  if (select first_trial_at from public.store_installs where store = 'apple' and install_id = 'APPTX-1')
     not between now() - interval '80 days 1 minute' and now() - interval '79 days 23 hours' then raise 'date du premier essai de APPTX-1'; end if;
  if (select trial_started_at from public.entitlements where user_id = pg_temp.pq('a')) > now() - interval '79 days' then raise 'trial_started_at réécrit'; end if;
  set role authenticated;

  -- L : nouveau compte (nouvelle adresse) sur le même iPhone, donc le même identifiant Apple
  perform pg_temp.pqlogin('b');
  st := public.my_access('ios');
  if (st ->> 'days_left')::int is distinct from 90 or (st ->> 'apple_linked')::boolean then raise 'L avant liaison (verrou éteint) : %', st; end if;
  if pg_temp.plink('b', 'APPTX-1') is distinct from 'ok' then raise 'liaison de L'; end if;
  st := public.my_access('ios');
  if st ->> 'status' is distinct from 'trial' or (st ->> 'days_left')::int is distinct from 10
     or not (st ->> 'trial_shared')::boolean then raise 'L a un essai neuf : %', st; end if;
  if (public.access_state() ->> 'days_left')::int is distinct from 10 then raise 'access_state de L'; end if;
  perform pg_temp.pqlogin('a');
  if (public.access_state() ->> 'days_left')::int is distinct from 10 then raise 'K a bougé'; end if;

  -- Essai de l'identifiant Apple fini : L est expiré ; verrou éteint il écrit encore
  reset role;
  update public.store_installs set first_trial_at = first_trial_at - interval '20 days' where install_id = 'APPTX-1';
  set role authenticated;
  perform pg_temp.pqlogin('b');
  st := public.my_access();
  if st ->> 'status' is distinct from 'expired' or not (st ->> 'can_write')::boolean then raise 'L expiré, verrou éteint : %', st; end if;
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  set role authenticated;
  if (public.my_access() ->> 'can_write')::boolean then raise 'L écrit après l''essai de son identifiant Apple'; end if;
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('l-1', '{"date": 1, "exercises": []}') $q$) is distinct from 'paywall_locked' then raise 'le serveur accepte la séance de L'; end if;

  -- Ce qui est payé, offert ou donné par un coach ne change pas
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.pq('b'), 'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-l1')) is distinct from 'ok' then raise 'abonnement de L'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'active' or not (st ->> 'can_write')::boolean then raise 'L abonné : %', st; end if;
  reset role;
  update public.entitlement_claims set revoked_at = now() where original_transaction_id = 'tx-l1';
  perform private.access_refresh(pg_temp.pq('b'));
  insert into public.coach_links (student_id, coach_id) values (pg_temp.pq('b'), pg_temp.pq('g'));
  set role authenticated;
  st := public.my_access();
  if st ->> 'status' is distinct from 'coach_team' or not (st ->> 'can_write')::boolean then raise 'L élève de coach : %', st; end if;
  reset role;
  delete from public.coach_links where student_id = pg_temp.pq('b');
  set role authenticated;
  if pg_temp.psrv(format('select public.srv_access_purchase(%L, %L, null, %L)', pg_temp.pq('b'), 'com.mdlf.training.access.gift', 'tx-l2')) is distinct from 'ok' then raise 'accès offert de L'; end if;
  if public.my_access() ->> 'status' is distinct from 'gift' then raise 'L accès offert'; end if;
  reset role;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
end $$;

-- ── Premier rattachement : un vieux compte n'éteint pas l'essai d'un proche ──
do $$
declare st jsonb;
begin
  set role authenticated;
  -- 1. Le proche (M) d'abord, puis le vieux compte (N, essai fini) : la première liaison fait foi
  perform pg_temp.pqlogin('c');
  perform public.my_access('ios');
  if pg_temp.plink('c', 'APPTX-2') is distinct from 'ok' then raise 'liaison de M'; end if;
  if (public.my_access() ->> 'days_left')::int is distinct from 90 then raise 'M : essai complet'; end if;
  perform pg_temp.pqlogin('d');
  perform public.my_access('ios');
  reset role;
  perform pg_temp.pstart('d', interval '300 days');
  set role authenticated;
  if pg_temp.plink('d', 'APPTX-2') is distinct from 'ok' then raise 'liaison de N'; end if;
  perform pg_temp.pqlogin('c');
  if (public.my_access() ->> 'days_left')::int is distinct from 90 then raise 'l''essai de M a été raccourci par N'; end if;
  -- 2. Le vieux compte (N) se connecte le PREMIER sur l'iPhone d'un autre proche (APPTX-4) : la date
  --    posée est maintenant, pas son vieux départ (correction de la relecture)
  perform pg_temp.pqlogin('d');
  if pg_temp.plink('d', 'APPTX-4') is distinct from 'ok' then raise 'liaison de N sur APPTX-4'; end if;
  reset role;
  if (select first_trial_at from public.store_installs where install_id = 'APPTX-4') < now() - interval '1 minute'
     then raise 'le vieux départ de N a été posé sur l''identifiant du proche'; end if;
  set role authenticated;
  perform pg_temp.pqlogin('h');
  perform public.my_access('ios');
  if pg_temp.plink('h', 'APPTX-4') is distinct from 'ok' then raise 'liaison du proche'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'trial' or (st ->> 'days_left')::int is distinct from 90 then raise 'proche privé de son essai : %', st; end if;
  -- 3. Le tricheur ne gagne rien : N reste expiré (le plus ancien des départs reste le sien)
  perform pg_temp.pqlogin('d');
  st := public.my_access();
  if st ->> 'status' is distinct from 'expired' or (st ->> 'trial_shared')::boolean then raise 'N a regagné un essai : %', st; end if;
  -- Compte encore en essai qui lie en premier : son départ est gardé (pas de rajeunissement)
  perform pg_temp.pqlogin('i');
  perform public.my_access('ios');
  reset role;
  perform pg_temp.pstart('i', interval '30 days');
  set role authenticated;
  if pg_temp.plink('i', 'APPTX-5') is distinct from 'ok' then raise 'liaison de I'; end if;
  reset role;
  if (select first_trial_at from public.store_installs where install_id = 'APPTX-5') > now() - interval '29 days' then raise 'départ d''un essai en cours remplacé'; end if;
  set role authenticated;
  -- Se relier plusieurs fois ne crée rien de plus
  perform pg_temp.pqlogin('d');
  if pg_temp.plink('d', 'APPTX-2') is distinct from 'ok' then raise 'liaison répétée'; end if;
  reset role;
  if (select count(*) from public.store_install_links where user_id = pg_temp.pq('d') and install_id = 'APPTX-2') is distinct from 1 then raise 'liaison doublée'; end if;
end $$;

-- ── Sans preuve Apple : plafond de 3 jours, et seulement sur iPhone ──
do $$
declare st jsonb;
begin
  -- O sur iPhone n'a jamais envoyé de preuve (App Store déconnecté), essai démarré il y a 2 jours
  set role authenticated;
  perform pg_temp.pqlogin('e');
  perform public.my_access('ios');
  reset role;
  perform pg_temp.pstart('e', interval '2 days');
  set role authenticated;
  st := public.my_access();
  if st ->> 'status' is distinct from 'trial' or (st ->> 'days_left')::int is distinct from 88
     or not (st ->> 'can_write')::boolean then raise 'O sans preuve, verrou éteint : %', st; end if;
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  set role authenticated;
  st := public.my_access();
  if st ->> 'status' is distinct from 'trial' or (st ->> 'days_left')::int is distinct from 1 or not (st ->> 'can_write')::boolean then raise 'O plafonné : %', st; end if;
  reset role;
  perform pg_temp.pstart('e', interval '5 days');
  set role authenticated;
  st := public.my_access();
  if st ->> 'status' is distinct from 'expired' or (st ->> 'can_write')::boolean then raise 'O au-delà du plafond : %', st; end if;
  if pg_temp.perr($q$ insert into public.sessions (id, data) values ('o-1', '{"date": 1, "exercises": []}') $q$) is distinct from 'paywall_locked' then raise 'le serveur accepte O sans preuve'; end if;
  -- Une déclaration « android » ultérieure n'efface pas l'iPhone
  st := public.my_access('android');
  if st ->> 'status' is distinct from 'expired' then raise 'android a levé le plafond d''un compte vu sur iPhone'; end if;

  -- P sur Android (pas encore d'ancrage) : essai complet, rattaché au compte, même verrou allumé
  perform pg_temp.pqlogin('f');
  perform public.my_access('android');
  reset role;
  perform pg_temp.pstart('f', interval '20 days');
  set role authenticated;
  st := public.my_access('android');
  if st ->> 'status' is distinct from 'trial' or (st ->> 'days_left')::int is distinct from 70 or not (st ->> 'can_write')::boolean then raise 'Android plafonné : %', st; end if;
  -- Compte jamais déclaré (vieille coquille) : pas de plafond non plus
  perform pg_temp.pqlogin('j');
  st := public.my_access();
  if (st ->> 'days_left')::int is distinct from 90 then raise 'compte non déclaré plafonné : %', st; end if;
  -- Compte iPhone tout neuf sans preuve : 3 jours affichés
  perform pg_temp.pqlogin('j');
  st := public.my_access('ios');
  if st ->> 'status' is distinct from 'trial' or (st ->> 'days_left')::int is distinct from 3 then raise 'compte iPhone neuf sans preuve : %', st; end if;
  -- Plafond réglable sans redéployer
  reset role;
  update public.app_config set value = '90'::jsonb where key = 'trial_unproven_days';
  set role authenticated;
  perform pg_temp.pqlogin('e');
  if (public.my_access() ->> 'days_left')::int is distinct from 85 then raise 'plafond réglable'; end if;
  reset role;
  update public.app_config set value = '"beaucoup"'::jsonb where key = 'trial_unproven_days';
  set role authenticated;
  if (public.my_access() ->> 'status') is distinct from 'expired' then raise 'valeur invalide : retour aux 3 jours'; end if;
  reset role;
  update public.app_config set value = '3'::jsonb where key = 'trial_unproven_days';
  set role authenticated;
  -- La preuve arrive (identifiant Apple neuf) : l'essai complet revient, calculé depuis son départ
  if pg_temp.plink('e', 'APPTX-3') is distinct from 'ok' then raise 'liaison de O'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'trial' or (st ->> 'days_left')::int is distinct from 85
     or not (st ->> 'can_write')::boolean or not (st ->> 'apple_linked')::boolean then raise 'O avec preuve : %', st; end if;
  -- Une installation Google (ancrage Android à venir) se stocke au même endroit
  if pg_temp.plink('f', 'GOOGLE-1', 'Production', 'com.mdlf.training', 'google') is distinct from 'ok' then raise 'installation google'; end if;
  perform pg_temp.pqlogin('f');
  st := public.my_access('android');
  if (st ->> 'apple_linked')::boolean or (st ->> 'days_left')::int is distinct from 70 then raise 'P après installation google : %', st; end if;
  reset role;
  if not exists (select 1 from public.store_installs where store = 'google' and install_id = 'GOOGLE-1') then raise 'installation google absente'; end if;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
end $$;

-- ── Preuves refusées par la base ─────────────────────────
do $$
begin
  set role authenticated;
  if pg_temp.plink('f', 'APPTX-9', 'Production', 'com.autre.app') is distinct from 'bad_bundle' then raise 'autre bundleId accepté'; end if;
  if pg_temp.plink('f', 'APPTX-9', 'Production', null) is distinct from 'bad_bundle' then raise 'bundleId absent accepté'; end if;
  if pg_temp.plink('f', 'APPTX-9', 'Xcode') is distinct from 'invalid_app_transaction' then raise 'environnement Xcode accepté'; end if;
  if pg_temp.plink('f', 'APPTX-9', 'Production', 'com.mdlf.training', 'amazon') is distinct from 'invalid_app_transaction' then raise 'magasin inconnu accepté'; end if;
  if pg_temp.plink('f', '', 'Production') is distinct from 'invalid_app_transaction' then raise 'identifiant vide accepté'; end if;
  if pg_temp.plink('f', 'a b''; drop table x', 'Production') is distinct from 'invalid_app_transaction' then raise 'identifiant mal formé accepté'; end if;
  if pg_temp.plink('f', repeat('9', 129), 'Production') is distinct from 'invalid_app_transaction' then raise 'identifiant trop long accepté'; end if;
  if pg_temp.psrv(format('select public.srv_link_store_install(%L, %L, %L, %L, %L)', '00000000-0000-0000-0000-0000000007ff', 'apple', 'APPTX-9', 'Production', 'com.mdlf.training')) is distinct from 'not_found' then raise 'compte inconnu accepté'; end if;
  reset role;
  if exists (select 1 from public.store_installs where install_id = 'APPTX-9') then raise 'preuve refusée pourtant écrite'; end if;
  set role authenticated;
  for i in 1..29 loop
    if pg_temp.plink('f', 'APPTX-F') is distinct from 'ok' then raise 'liaison % refusée trop tôt', i; end if;
  end loop;
  -- 30 par 24 h (dont la liaison google ci-dessus et la 1re de cette boucle)
  if pg_temp.plink('f', 'APPTX-F') is distinct from 'rate_limited' then raise 'débit des liaisons'; end if;
  reset role;
end $$;

-- ── Aucune écriture directe, aucune lecture ──────────────
set role authenticated;
do $$ begin
  perform pg_temp.pqlogin('a');
  if pg_temp.perr($q$ select * from public.store_installs $q$) not like 'permission denied%' then raise 'store_installs lisible'; end if;
  if pg_temp.perr($q$ select * from public.store_install_links $q$) not like 'permission denied%' then raise 'store_install_links lisible'; end if;
  if pg_temp.perr($q$ insert into public.store_installs (store, install_id, environment, first_trial_at) values ('apple', 'X1', 'Production', now()) $q$) not like 'permission denied%' then raise 'store_installs : insertion'; end if;
  if pg_temp.perr($q$ update public.store_installs set first_trial_at = now() $q$) not like 'permission denied%' then raise 'store_installs : rajeunir son identifiant'; end if;
  if pg_temp.perr($q$ delete from public.store_install_links $q$) not like 'permission denied%' then raise 'store_install_links : se délier'; end if;
  if pg_temp.perr($q$ update public.entitlements set ios_seen_at = null $q$) not like 'permission denied%' then raise 'ios_seen_at effaçable'; end if;
  if pg_temp.perr(format('select public.srv_link_store_install(%L, %L, %L, %L, %L)', pg_temp.pq('a'), 'apple', 'APPTX-X', 'Production', 'com.mdlf.training')) not like 'permission denied%' then raise 'srv_link_store_install exécutable par un compte'; end if;
  if (select count(*) from public.app_config) is distinct from 3 then raise 'app_config pour authenticated'; end if;
end $$;
reset role;

-- ── Règle 2 : anon ne lit QUE paywall_on ─────────────────
set role anon;
do $$
declare k text[];
begin
  perform set_config('request.jwt.claim.sub', '', false);
  select array_agg(key) into k from public.app_config;
  if k is distinct from array['paywall_on'] then raise 'anon lit : %', k; end if;
  if (select value from public.app_config where key = 'paywall_on') is distinct from 'false'::jsonb then raise 'anon : paywall_on illisible'; end if;
  if pg_temp.perr($q$ select updated_at from public.app_config $q$) not like 'permission denied%' then raise 'anon lit updated_at'; end if;
  if pg_temp.perr($q$ update public.app_config set value = 'false'::jsonb where key = 'paywall_on' $q$) not like 'permission denied%' then raise 'anon modifie paywall_on'; end if;
  if pg_temp.perr($q$ insert into public.app_config (key, value) values ('x', '1') $q$) not like 'permission denied%' then raise 'anon insère'; end if;
  if pg_temp.perr($q$ delete from public.app_config $q$) not like 'permission denied%' then raise 'anon supprime'; end if;
  if pg_temp.perr($q$ select * from public.store_installs $q$) not like 'permission denied%' then raise 'anon lit store_installs'; end if;
  if pg_temp.perr($q$ select * from public.store_install_links $q$) not like 'permission denied%' then raise 'anon lit store_install_links'; end if;
  if pg_temp.perr(format('select public.srv_link_store_install(%L, %L, %L, %L, %L)', pg_temp.pq('a'), 'apple', 'APPTX-X', 'Production', 'com.mdlf.training')) not like 'permission denied%' then raise 'anon lie une installation'; end if;
  if pg_temp.perr('select public.my_access(''ios'')') not like 'permission denied%' then raise 'anon : my_access'; end if;
end $$;
reset role;
update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
set role anon;
do $$ begin
  if (select value from public.app_config where key = 'paywall_on') is distinct from 'true'::jsonb then raise 'anon ne voit pas le verrou allumé'; end if;
end $$;
reset role;
update public.app_config set value = 'false'::jsonb where key = 'paywall_on';

-- ── Droits déclarés ──────────────────────────────────────
do $$ begin
  if has_function_privilege('authenticated', 'public.srv_link_store_install(uuid, text, text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.srv_link_store_install(uuid, text, text, text, text)', 'execute')
     or not has_function_privilege('service_role', 'public.srv_link_store_install(uuid, text, text, text, text)', 'execute')
     then raise 'droits de srv_link_store_install'; end if;
  if not has_function_privilege('authenticated', 'public.my_access(text)', 'execute')
     or has_function_privilege('anon', 'public.my_access(text)', 'execute') then raise 'droits de my_access(text)'; end if;
  if exists (select 1 from pg_proc where proname = 'my_access' and pronargs = 0) then raise 'ancienne my_access() restée'; end if;
  if has_function_privilege('authenticated', 'private.access_unproven_days()', 'execute')
     or has_function_privilege('service_role', 'private.access_unproven_days()', 'execute') then raise 'access_unproven_days exécutable'; end if;
  if exists (select 1 from pg_policies where tablename in ('store_installs', 'store_install_links')) then raise 'politique RLS inattendue'; end if;
  if exists (select 1 from pg_class where relname in ('store_installs', 'store_install_links') and not relrowsecurity) then raise 'RLS désactivée'; end if;
  if has_table_privilege('service_role', 'public.store_installs', 'select') or has_table_privilege('service_role', 'public.store_install_links', 'insert')
     or has_table_privilege('authenticated', 'public.store_installs', 'select') or has_table_privilege('anon', 'public.store_install_links', 'select')
     then raise 'GRANT sur les tables des installations'; end if;
  if (select count(*) from pg_policies where tablename = 'app_config' and 'anon' = any(roles)) is distinct from 1
     or not exists (select 1 from pg_policies where tablename = 'app_config' and 'anon' = any(roles) and cmd = 'SELECT' and qual like '%paywall_on%')
     then raise 'politique anon de app_config'; end if;
  if has_column_privilege('anon', 'public.app_config', 'updated_at', 'select') or has_table_privilege('anon', 'public.app_config', 'update')
     then raise 'anon a trop de droits sur app_config'; end if;
end $$;

-- ── Suppression du compte : le lien part, l'installation reste ──
do $$
declare st jsonb;
begin
  delete from auth.users where id = pg_temp.pq('a');
  if exists (select 1 from public.store_install_links where user_id = pg_temp.pq('a')) then raise 'cascade store_install_links'; end if;
  if exists (select 1 from public.entitlements where user_id = pg_temp.pq('a')) then raise 'cascade entitlements (K)'; end if;
  if not exists (select 1 from public.store_installs where install_id = 'APPTX-1') then raise 'l''installation est partie avec le compte'; end if;
  if (select count(*) from public.store_install_links where install_id = 'APPTX-1') is distinct from 1 then raise 'les autres liens de APPTX-1 ont bougé'; end if;
  insert into auth.users (id) values (pg_temp.pq('a'));
  set role authenticated;
  perform pg_temp.pqlogin('a');
  perform public.my_access('ios');
  if pg_temp.plink('a', 'APPTX-1') is distinct from 'ok' then raise 'liaison du nouveau compte'; end if;
  st := public.my_access();
  if st ->> 'status' is distinct from 'expired' then raise 'compte recréé : essai neuf : %', st; end if;
  reset role;
end $$;

-- ── Conservation limitée des installations (RGPD) ────────
do $$
declare n int;
begin
  insert into public.store_installs (store, install_id, environment, first_trial_at) values
    ('apple', 'PURGE-VIEUX-ORPHELIN', 'Production', now() - interval '25 months'),
    ('google', 'PURGE-VIEUX-ORPHELIN', 'Production', now() - interval '25 months'),
    ('apple', 'PURGE-RECENT-ORPHELIN', 'Production', now() - interval '6 months'),
    ('apple', 'PURGE-VIEUX-LIE', 'Production', now() - interval '30 months');
  insert into auth.users (id) values ('00000000-0000-0000-0000-00000000a9a9') on conflict do nothing;
  insert into public.store_install_links (user_id, store, install_id)
    values ('00000000-0000-0000-0000-00000000a9a9', 'apple', 'PURGE-VIEUX-LIE');
  n := private.purge_store_installs();
  if n is distinct from 2 then raise 'purge : % ligne(s) au lieu de 2', n; end if;
  if exists (select 1 from public.store_installs where install_id = 'PURGE-VIEUX-ORPHELIN') then raise 'orphelin de plus de 2 ans gardé'; end if;
  if not exists (select 1 from public.store_installs where install_id = 'PURGE-RECENT-ORPHELIN') then raise 'orphelin récent effacé trop tôt'; end if;
  -- Plus de 2 ans, mais un compte l'utilise encore : gardé
  if not exists (select 1 from public.store_installs where install_id = 'PURGE-VIEUX-LIE') then raise 'installation encore utilisée effacée'; end if;
  delete from auth.users where id = '00000000-0000-0000-0000-00000000a9a9';
  if private.purge_store_installs() is distinct from 1 then raise 'orphelin après suppression du compte non purgé'; end if;
  if has_function_privilege('authenticated', 'private.purge_store_installs()', 'execute') then raise 'purge appelable par un client'; end if;
end $$;

-- Nettoyage
delete from auth.users where id in (select pg_temp.pq(c) from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) c);
delete from public.store_installs;
