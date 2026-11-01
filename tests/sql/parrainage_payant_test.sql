-- Vérifications de supabase/migrations/20261101000000_parrainage_payant.sql (lancées par tests/sql/run.sh).
-- Chaque bloc échoue (raise) si la règle n'est pas tenue. Comparaisons en « is distinct from » : une
-- accroche qui rendrait null (inconnu) ne passe jamais pour un bon montant.
--
-- Comptes simulés (pg_temp.pu('k') → …00000000080a ; s → b, t → c, u → d, v → e, w → f, r → 9, p → 8) :
-- K coach validé (code permanent ABCDEFGHJKLM), S élève qui rejoint K, T saisit le code permanent de K,
-- U saisit le code partenaire LUCAS (25 %, 12 mois), V paie avant d'avoir un parrain, W sans parrain,
-- R paie 3 mois puis rejoint K (pas de commission rétroactive), P (code ANNUEL) paie 6 mois puis un an.
-- Small Business Program d'Apple noté au 01/02/2025 : 30 % avant, 15 % après.
-- Données saisies en UTC (comme le serveur Supabase) ; les accroches sont ensuite lues depuis une
-- session en Europe/Paris : elles découpent les mois en UTC quel que soit le fuseau de la session.
--
-- Revenu net à 15 % : 6,49 € en France → 6490 / 10 / 1,2 × 0,85 = 459,7 ; à 30 % : 378,6 ;
-- 6,49 € en Belgique (15 %) : 455,9 ; 4,89 € (15 %) : 346,4 ; 55,00 € (15 %) : 3895,8.

set timezone = 'UTC';

create function pg_temp.perr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.pu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000080' || translate(c, 'kstuvwrp', 'abcdef98'))::uuid $$;
-- Un paiement de Production, 6,49 € par mois en France, sauf précision
create function pg_temp.pay(tx text, orig text, d timestamptz, price bigint default 6490, cur text default 'EUR',
                            sf text default 'FRA', env text default 'Production', trial boolean default false,
                            product text default 'com.mdlf.training.pro.monthly', token text default null,
                            revoked timestamptz default null, len interval default interval '1 month') returns jsonb
  language sql as
$$ select public.srv_subscription_payment(tx, orig, product, env, d, d + len, price, cur, sf, trial, revoked, token) $$;
create function pg_temp.net(kind text, code text, coach uuid, m text, months int default 12) returns bigint
  language sql as $$ select private.referral_net_cents(kind, code, coach, m::date, months) $$;
grant execute on function pg_temp.perr(text), pg_temp.pu(text) to authenticated, anon, service_role;
grant execute on function pg_temp.pay(text, text, timestamptz, bigint, text, text, text, boolean, text, text, timestamptz, interval) to service_role;

-- Small Business Program au 01/02/2025 le temps du test (remis à null à la fin)
create or replace function private.referral_apple_small_business_since() returns timestamptz
  language sql immutable set search_path = '' as $$ select '2025-02-01 00:00+00'::timestamptz $$;
insert into auth.users (id, created_at) values
  (pg_temp.pu('k'), now()), (pg_temp.pu('s'), now()), (pg_temp.pu('t'), now()), (pg_temp.pu('u'), now()),
  (pg_temp.pu('v'), now()), (pg_temp.pu('w'), now()), (pg_temp.pu('r'), now()), (pg_temp.pu('p'), now());
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at) values
  (pg_temp.pu('k'), 'coach.pp', '🦁', now()), (pg_temp.pu('s'), 'eleve.pp', '🦊', null);
insert into public.coach_invites (code, coach_id, created_at, expires_at, permanent) values
  ('ABCDEFGHJKLM', pg_temp.pu('k'), now(), 'infinity', true),
  ('QRSTUVWX', pg_temp.pu('k'), now(), now() + interval '7 days', false);
select private.make_partner_code('LUCAS', 'Lucas', 0.25, 12);
select private.make_partner_code('ANNUEL', 'Annuel', 0.20, 12);

-- ── Part d'Apple datée ───────────────────────────────────
do $$
begin
  if private.referral_apple_rate('2025-01-31 23:59+00') is distinct from 0.30 then raise 'avant le Small Business Program'; end if;
  if private.referral_apple_rate('2025-02-01 00:00+00') is distinct from 0.15 then raise 'depuis le Small Business Program'; end if;
end $$;

-- ── Une seule source de vérité : l'adhésion attribue par referral_attributions ─
do $$
begin
  if to_regclass('public.coach_origins') is not null then raise 'coach_origins existe encore (deux sources)'; end if;
  if exists (select 1 from pg_proc where proname = 'coach_origin_for_user') then raise 'coach_origin_for_user existe encore'; end if;
  insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('s'), pg_temp.pu('k'));
  if (select referrer_coach from public.referral_attributions where user_id = pg_temp.pu('s')) is distinct from pg_temp.pu('k')
    then raise 'élève non attribué à son coach'; end if;
end $$;

-- ── Code permanent du coach saisi comme code de parrainage ─
do $$
begin
  if private.referral_resolve_coach_code('abcd-efgh-jklm') is distinct from pg_temp.pu('k') then raise 'code permanent non reconnu'; end if;
  if private.referral_resolve_coach_code('QRSTUVWX') is not null then raise 'code de 7 jours pris pour le parrainage'; end if;
  if private.referral_resolve_coach_code(null) is not null then raise 'code vide'; end if;
  -- Coach qui perd son rôle : son code ne parraine plus
  update public.user_profiles set coach_at = null where user_id = pg_temp.pu('k');
  if private.referral_resolve_coach_code('ABCDEFGHJKLM') is not null then raise 'code d''un ancien coach accepté'; end if;
  update public.user_profiles set coach_at = now() where user_id = pg_temp.pu('k');
end $$;
set role authenticated;
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', pg_temp.pu('t')::text, true);
  r := public.referral_apply('QRSTUVWX');
  if r ->> 'error' is distinct from 'invalid_code' then raise 'code de 7 jours : %', r; end if;
  r := public.referral_apply('abcd efgh jklm');
  if (r ->> 'ok')::boolean is not true or r #>> '{referrer,name}' is distinct from 'coach.pp' then raise 'code permanent : %', r; end if;
  perform set_config('request.jwt.claim.sub', pg_temp.pu('u')::text, true);
  if (public.referral_apply('LUCAS') ->> 'ok')::boolean is not true then raise 'code partenaire'; end if;
  perform set_config('request.jwt.claim.sub', pg_temp.pu('p')::text, true);
  if (public.referral_apply('ANNUEL') ->> 'ok')::boolean is not true then raise 'code ANNUEL'; end if;
  -- Le coach ne se parraine pas avec son propre code
  perform set_config('request.jwt.claim.sub', pg_temp.pu('k')::text, true);
  if public.referral_apply('ABCDEFGHJKLM') ->> 'error' is distinct from 'invalid_code' then raise 'propre code du coach accepté'; end if;
  -- Paiements illisibles et non écrivables depuis l'app
  if pg_temp.perr($q$ select * from public.subscription_payments $q$) not like 'permission denied%' then raise 'paiements lisibles'; end if;
  if pg_temp.perr($q$ select public.srv_subscription_payment('x', 'x', 'com.mdlf.training.pro.monthly', 'Production', now()) $q$)
     not like 'permission denied%' then raise 'srv_subscription_payment appelable par un client'; end if;
  if pg_temp.perr($q$ select private.referral_apple_rate(now()) $q$) not like 'permission denied%' then raise 'part d''Apple appelable'; end if;
end $$;
reset role;
do $$ begin
  if (select referrer_coach from public.referral_attributions where user_id = pg_temp.pu('t') and source = 'code') is distinct from pg_temp.pu('k')
    then raise 'attribution par le code permanent'; end if;
end $$;
set role anon;
do $$ begin
  if pg_temp.perr($q$ select public.srv_subscription_payment('x', 'x', 'com.mdlf.training.pro.monthly', 'Production', now()) $q$)
     not like 'permission denied%' then raise 'srv_subscription_payment appelable par anon'; end if;
end $$;
reset role;

-- ── Écriture des paiements (clé serveur) ─────────────────
set role service_role;
do $$
declare r jsonb;
begin
  if pg_temp.perr($q$ select * from public.subscription_payments $q$) not like 'permission denied%' then raise 'service_role lit la table en direct'; end if;
  -- U (LUCAS) : un essai gratuit, puis 13 mois payés depuis janvier 2025 ; un paiement Sandbox
  perform pg_temp.pay('u-trial', 'u-orig', '2024-12-01', 0, trial => true, token => pg_temp.pu('u')::text);
  for i in 0..12 loop
    r := pg_temp.pay('u-' || i, 'u-orig', ('2025-01-05'::timestamptz + make_interval(months => i)), token => pg_temp.pu('u')::text);
    if (r ->> 'recorded')::boolean is not true then raise 'paiement de U non noté (appAccountToken) : %', r; end if;
  end loop;
  perform pg_temp.pay('u-sbx', 'u-sbx-orig', '2025-03-10', env => 'Sandbox', token => pg_temp.pu('u')::text);
  -- Même transaction deux fois : une ligne ; le remboursement (mars, fait en avril) n'est jamais défait
  perform pg_temp.pay('u-2', 'u-orig', '2025-03-05', revoked => '2025-04-20', token => pg_temp.pu('u')::text);
  perform pg_temp.pay('u-2', 'u-orig', '2025-03-05', token => pg_temp.pu('u')::text);
  -- Produit inconnu, environnement inconnu : ignorés
  if (pg_temp.pay('x-1', 'x-orig', now(), product => 'com.mdlf.training.lifetime', token => pg_temp.pu('w')::text) ->> 'recorded')::boolean then raise 'produit inconnu noté'; end if;
  if (pg_temp.pay('x-2', 'x-orig', now(), env => 'Xcode', token => pg_temp.pu('w')::text) ->> 'recorded')::boolean then raise 'environnement inconnu noté'; end if;
  -- T (code permanent du coach) : mars en dollars (K actif) ; avril en Belgique (K actif), dont un remboursé en
  -- mai (K inactif) ; mai en Belgique (K inactif)
  perform pg_temp.pay('t-1', 't-orig', '2025-03-03', 3990, 'USD', 'USA', token => pg_temp.pu('t')::text);
  perform pg_temp.pay('t-2', 't-orig', '2025-04-03', 6490, 'EUR', 'bel', token => pg_temp.pu('t')::text);
  perform pg_temp.pay('t-3', 't-orig2', '2025-04-20', 6490, 'EUR', 'BEL', token => pg_temp.pu('t')::text, revoked => '2025-05-15');
  perform pg_temp.pay('t-4', 't-orig', '2025-05-03', 6490, 'EUR', 'BEL', token => pg_temp.pu('t')::text);
  -- V : paiement arrivé sans compte retrouvable (ni transaction d'origine connue ni appAccountToken) : rien
  r := pg_temp.pay('v-1', 'v-orig', '2025-02-10');
  if (r ->> 'recorded')::boolean then raise 'paiement sans compte noté : %', r; end if;
  -- K : abonnement coach de mars 2025 (essai gratuit d'Apple), payé en avril, remboursé en mai ; Sandbox en juin
  perform pg_temp.pay('k-1', 'k-orig', '2025-03-01', 0, trial => true, product => 'com.mdlf.training.coach10.monthly', token => pg_temp.pu('k')::text);
  perform pg_temp.pay('k-2', 'k-orig', '2025-04-01', 15990, product => 'com.mdlf.training.coach10.monthly', token => pg_temp.pu('k')::text);
  perform pg_temp.pay('k-3', 'k-orig', '2025-05-01', 15990, product => 'com.mdlf.training.coach10.monthly', token => pg_temp.pu('k')::text, revoked => '2025-05-03');
  perform pg_temp.pay('k-4', 'k-sbx', '2025-06-01', 15990, env => 'Sandbox', product => 'com.mdlf.training.coach10.monthly', token => pg_temp.pu('k')::text);
  -- R : 3 mois payés sans parrain (janvier à mars 2025)
  for i in 0..2 loop
    perform pg_temp.pay('r-' || i, 'r-orig', ('2025-01-10'::timestamptz + make_interval(months => i)), token => pg_temp.pu('r')::text);
  end loop;
  -- P (ANNUEL) : premier mois payé le 31 janvier à 23 h 30 UTC (déjà le 1er février à Paris), 5 autres mois,
  -- puis un abonnement annuel à 55 € le 15 juillet : il ne reste que 6 des 12 mois, la moitié compte
  perform pg_temp.pay('p-0', 'p-orig', '2025-01-31 23:30+00', token => pg_temp.pu('p')::text);
  for i in 1..5 loop
    perform pg_temp.pay('p-' || i, 'p-orig', ('2025-02-15'::timestamptz + make_interval(months => i - 1)), token => pg_temp.pu('p')::text);
  end loop;
  perform pg_temp.pay('p-6', 'p-orig', '2025-07-15', 55000, product => 'com.mdlf.training.pro.yearly', token => pg_temp.pu('p')::text, len => interval '1 year');
end $$;
reset role;

do $$
begin
  if (select count(*) from public.subscription_payments where transaction_id = 'u-2') is distinct from 1::bigint then raise 'doublon'; end if;
  if (select revoked_at from public.subscription_payments where transaction_id = 'u-2') is distinct from '2025-04-20'::timestamptz then raise 'remboursement défait'; end if;
  if (select storefront from public.subscription_payments where transaction_id = 't-2') is distinct from 'BEL' then raise 'pays en majuscules'; end if;
  if exists (select 1 from public.subscription_payments where transaction_id in ('x-1', 'x-2', 'v-1')) then raise 'paiement ignoré noté'; end if;
  if (select count(*) from public.subscription_payments where user_id = pg_temp.pu('u') and attribution_id is not null) is distinct from 15::bigint then raise 'attribution des paiements de U'; end if;
  -- V : la transaction d'origine arrive (verify-purchase), le paiement est alors noté
  perform public.srv_access_purchase(pg_temp.pu('v'), 'com.mdlf.training.pro.monthly', '2025-03-10', 'v-orig', false, '2025-02-10', false, 'Production');
  if (pg_temp.pay('v-1', 'v-orig', '2025-02-10') ->> 'recorded')::boolean is not true then raise 'paiement après la transaction d''origine'; end if;
  if (select user_id from public.subscription_payments where transaction_id = 'v-1') is distinct from pg_temp.pu('v') then raise 'paiement de V sans compte'; end if;
  if (select attribution_id from public.subscription_payments where transaction_id = 'v-1') is not null then raise 'attribution sans parrain'; end if;
  -- R rejoint K maintenant : ses paiements passés lui sont rattachés, sans rien rapporter au coach
  insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('r'), pg_temp.pu('k'));
  if (select count(*) from public.subscription_payments where user_id = pg_temp.pu('r') and attribution_id is not null) is distinct from 3::bigint
    then raise 'paiements de R non rattachés'; end if;
end $$;
-- V saisit ensuite LUCAS : ses paiements déjà faits lui sont rattachés
set role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', pg_temp.pu('v')::text, true);
  if (public.referral_apply('LUCAS') ->> 'ok')::boolean is not true then raise 'code de V'; end if;
end $$;
reset role;

-- ── Accroches : abonnés, revenu net, abonnement coach (lues depuis Paris) ─
set timezone = 'Europe/Paris';
do $$
declare got text;
begin
  if (select attribution_id from public.subscription_payments where transaction_id = 'v-1') is null then raise 'parrain trouvé après le paiement : non rattaché'; end if;
  -- LUCAS. Janvier (30 %) : U seul ; février (15 %) : U + V
  if pg_temp.net('partner', 'LUCAS', null, '2025-01-01') is distinct from 379::bigint then raise 'net janvier : %', pg_temp.net('partner', 'LUCAS', null, '2025-01-01'); end if;
  if pg_temp.net('partner', 'LUCAS', null, '2025-02-01') is distinct from 919::bigint then raise 'net février : %', pg_temp.net('partner', 'LUCAS', null, '2025-02-01'); end if;
  -- Mars payé puis remboursé en avril : compté en mars, retiré en avril (avril : +460 −460 = 0)
  if pg_temp.net('partner', 'LUCAS', null, '2025-03-01') is distinct from 460::bigint then raise 'net mars'; end if;
  if pg_temp.net('partner', 'LUCAS', null, '2025-04-01') is distinct from 0::bigint then raise 'net avril (payé puis remboursé) : %', pg_temp.net('partner', 'LUCAS', null, '2025-04-01'); end if;
  -- 12e mois de U (décembre) compté, 13e (janvier 2026) non
  if pg_temp.net('partner', 'LUCAS', null, '2025-12-01') is distinct from 460::bigint then raise 'net du 12e mois'; end if;
  if pg_temp.net('partner', 'LUCAS', null, '2026-01-01') is distinct from 0::bigint then raise 'net du 13e mois'; end if;
  -- Durée de 3 mois : le paiement d'avril de U (4e mois) sort, son remboursement de mars reste retiré
  if pg_temp.net('partner', 'LUCAS', null, '2025-04-01', 3) is distinct from -460::bigint then raise 'durée de 3 mois : %', pg_temp.net('partner', 'LUCAS', null, '2025-04-01', 3); end if;
  -- Essai gratuit (décembre 2024) et Sandbox : jamais comptés
  if pg_temp.net('partner', 'LUCAS', null, '2024-12-01') is distinct from 0::bigint then raise 'essai gratuit compté'; end if;
  -- Abonnés : février, U et V ; mai, U seul (V n'a payé qu'un mois) ; février 2026 : plus personne
  if private.referral_subscribers('partner', 'LUCAS', null, '2025-02-01') is distinct from 2 then raise 'abonnés février : %', private.referral_subscribers('partner', 'LUCAS', null, '2025-02-01'); end if;
  if private.referral_subscribers('partner', 'LUCAS', null, '2025-05-01') is distinct from 1 then raise 'abonnés mai : %', private.referral_subscribers('partner', 'LUCAS', null, '2025-05-01'); end if;
  if private.referral_subscribers('partner', 'LUCAS', null, '2026-02-01') is distinct from 0 then raise 'abonnés après 12 mois'; end if;

  -- ANNUEL. Le 31 janvier 23 h 30 UTC compte en janvier (mois en UTC, même lu depuis Paris), à 30 %
  if pg_temp.net('partner', 'ANNUEL', null, '2025-01-01') is distinct from 379::bigint then raise 'mois en UTC (janvier) : %', pg_temp.net('partner', 'ANNUEL', null, '2025-01-01'); end if;
  if pg_temp.net('partner', 'ANNUEL', null, '2025-02-01') is distinct from 460::bigint then raise 'mois en UTC (février) : %', pg_temp.net('partner', 'ANNUEL', null, '2025-02-01'); end if;
  -- Annuel de juillet : 6 mois restants sur 12 → la moitié de 3895,8
  if pg_temp.net('partner', 'ANNUEL', null, '2025-07-01') is distinct from 1948::bigint then raise 'annuel au prorata : %', pg_temp.net('partner', 'ANNUEL', null, '2025-07-01'); end if;
  if private.referral_subscribers('partner', 'ANNUEL', null, '2025-12-01') is distinct from 1 then raise 'abonné annuel en décembre'; end if;

  -- Coach K. Abonnement coach : mars (essai d'Apple) et avril actifs ; mai remboursé, juin Sandbox, janvier rien
  select string_agg(coalesce(private.referral_coach_active(pg_temp.pu('k'), m::date)::text, 'null'), ' ' order by m) into got
    from generate_series('2025-01-01'::date, '2025-06-01'::date, interval '1 month') m;
  if got is distinct from 'false false true true false false' then raise 'abonnement coach actif : %', got; end if;
  if private.referral_coach_active(null, '2025-01-01') is not null then raise 'coach supprimé'; end if;
  if private.referral_coach_active(pg_temp.pu('u'), '2025-02-01') then raise 'abonnement particulier pris pour coach'; end if;
  -- T en dollars (mars, K actif) : inconnu, jamais inventé ; février (K inactif, aucun paiement) : 0
  if pg_temp.net('coach', null, pg_temp.pu('k'), '2025-02-01') is distinct from 0::bigint then raise 'février du coach'; end if;
  if pg_temp.net('coach', null, pg_temp.pu('k'), '2025-03-01') is not null then raise 'dollars : revenu net inventé'; end if;
  -- Avril (K actif) : deux paiements en Belgique → 912 ; mai (K inactif) : le paiement de mai ne rapporte
  -- rien, mais le remboursement d'un paiement d'avril (versé) est repris : −456
  if pg_temp.net('coach', null, pg_temp.pu('k'), '2025-04-01') is distinct from 912::bigint then raise 'net avril du coach : %', pg_temp.net('coach', null, pg_temp.pu('k'), '2025-04-01'); end if;
  if pg_temp.net('coach', null, pg_temp.pu('k'), '2025-05-01') is distinct from -456::bigint then raise 'net mai du coach : %', pg_temp.net('coach', null, pg_temp.pu('k'), '2025-05-01'); end if;
  if pg_temp.net('coach', null, pg_temp.pu('k'), '2025-06-01') is distinct from 0::bigint then raise 'coach sans paiement ce mois'; end if;
  -- R : paiements d'avant l'adhésion, jamais rapportés au coach (pas de commission rétroactive)
  if pg_temp.net('coach', null, pg_temp.pu('k'), '2025-01-01') is distinct from 0::bigint then raise 'commission rétroactive : %', pg_temp.net('coach', null, pg_temp.pu('k'), '2025-01-01'); end if;
  if private.referral_subscribers('coach', null, pg_temp.pu('k'), '2025-04-01') is distinct from 1 then raise 'abonnés du coach en avril'; end if;
end $$;
set timezone = 'UTC';

-- ── Rapport du mois en cours, de bout en bout ────────────
set role service_role;
do $$
declare r record; m0 date := date_trunc('month', now())::date;
begin
  perform pg_temp.pay('w-1', 'w-orig', now(), token => pg_temp.pu('w')::text);   -- W : sans parrain, ne compte nulle part
  perform pg_temp.pay('s-1', 's-orig', now(), 4890, token => pg_temp.pu('s')::text); -- S : offre élève 4,89 €
  select * into r from public.referral_report(m0, m0) where kind = 'coach' and coach_id = pg_temp.pu('k');
  -- Le coach n'a pas d'abonnement coach ce mois-ci : rien ne lui revient
  if r.net_cents is distinct from 0::bigint or r.active_subscribers is distinct from 1 or r.coach_active is not false
     or r.commission_cents is distinct from 0::bigint then raise 'rapport coach inactif : %', r; end if;
end $$;
reset role;
do $$ begin
  perform pg_temp.pay('k-5', 'k-orig', now(), 15990, product => 'com.mdlf.training.coach10.monthly', token => pg_temp.pu('k')::text);
  perform pg_temp.pay('r-3', 'r-orig', now(), token => pg_temp.pu('r')::text);   -- R : 4e mois payé, après l'adhésion
end $$;
set role service_role;
do $$
declare r record; m0 date := date_trunc('month', now())::date;
begin
  select * into r from public.referral_report(m0, m0) where kind = 'coach' and coach_id = pg_temp.pu('k');
  -- S 346,4 + R 459,7 = 806 ; 20 % → 161
  if r.coach_active is not true or r.net_cents is distinct from 806::bigint or r.commission_cents is distinct from 161::bigint
     or r.active_subscribers is distinct from 2 then raise 'rapport du coach actif : %', r; end if;
end $$;
reset role;

-- ── Suppression d'un compte ──────────────────────────────
do $$
begin
  -- V (parrainé) : identifiants d'Apple effacés, montant et parrain gardés
  delete from auth.users where id = pg_temp.pu('v');
  if exists (select 1 from public.subscription_payments where transaction_id = 'v-1' or original_transaction_id = 'v-orig') then raise 'identifiants d''Apple gardés'; end if;
  if (select count(*) from public.subscription_payments where user_id is null and transaction_id is null and attribution_id is not null) is distinct from 1::bigint
    then raise 'paiement anonyme absent'; end if;
  if pg_temp.net('partner', 'LUCAS', null, '2025-02-01') is distinct from 919::bigint then raise 'mois passé changé par la suppression'; end if;
  -- Apple renouvelle encore l'abonnement du compte supprimé : rien n'est noté
  if (pg_temp.pay('v-2', 'v-orig', now(), token => pg_temp.pu('v')::text) ->> 'recorded')::boolean then raise 'paiement d''un compte supprimé noté'; end if;
  -- W, sans parrain : ses paiements sont effacés avec son compte
  delete from auth.users where id = pg_temp.pu('w');
  if exists (select 1 from public.subscription_payments where transaction_id like 'w-%' or (user_id is null and attribution_id is null))
    then raise 'paiement sans parrain gardé après la suppression'; end if;
end $$;

-- ── Droits, RLS ──────────────────────────────────────────
do $$
declare f regprocedure;
begin
  if exists (select 1 from pg_policies where tablename = 'subscription_payments') then raise 'politique RLS inattendue'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.subscription_payments'::regclass) then raise 'RLS désactivée'; end if;
  if has_table_privilege('service_role', 'public.subscription_payments', 'select') or has_table_privilege('authenticated', 'public.subscription_payments', 'select')
    then raise 'table lisible par l''API'; end if;
  if not has_function_privilege('service_role', 'public.srv_subscription_payment(text, text, text, text, timestamptz, timestamptz, bigint, text, text, boolean, timestamptz, text)', 'execute')
    then raise 'srv_subscription_payment sans droit pour la clé serveur'; end if;
  if has_function_privilege('authenticated', 'public.referral_report(date, date)', 'execute') or not has_function_privilege('service_role', 'public.referral_report(date, date)', 'execute')
    then raise 'droits du rapport réécrit'; end if;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'private'::regnamespace
             and p.proname in ('payment_link', 'payment_forget', 'payment_from_attribution', 'referral_apple_rate', 'referral_apple_small_business_since', 'referral_vat_rate',
                               'payment_net_cents', 'referral_paid', 'referral_months', 'referral_resolve_coach_code', 'referral_subscribers',
                               'referral_net_cents', 'referral_coach_active') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute')
      then raise '% : exécutable par l''API', f; end if;
  end loop;
  if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.srv_subscription_payment(text, text, text, text, timestamptz, timestamptz, bigint, text, text, boolean, timestamptz, text)'::regprocedure)
    then raise 'srv_subscription_payment : security definer et search_path vide'; end if;
end $$;

-- Nettoyage
delete from auth.users where id in (select pg_temp.pu(c) from unnest(array['k', 's', 't', 'u', 'r', 'p']) c);
delete from public.subscription_payments;
delete from public.referral_attributions;
delete from public.referral_partners;
create or replace function private.referral_apple_small_business_since() returns timestamptz
  language sql immutable set search_path = '' as $$ select null::timestamptz $$;
reset timezone;
do $$ begin
  if private.referral_apple_rate(now()) is distinct from 0.30 then raise 'sans adhésion au Small Business Program : 30 %%'; end if;
end $$;
