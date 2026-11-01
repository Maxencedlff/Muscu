-- Vérifications de supabase/migrations/20261101000000_parrainage_payant.sql (lancées par tests/sql/run.sh).
-- Chaque bloc échoue (raise) si la règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.pu('k') → …00000000080a, puis s → b … w → f) : K coach validé (code permanent ABCDEFGHJKLM),
-- S élève qui rejoint K, T saisit le code permanent de K, U saisit le code partenaire LUCAS (25 %, 12 mois),
-- V paie avant d'avoir un parrain, W n'a pas de parrain. Mois fixes (2025) : les accroches sont appelées
-- directement, le rapport complet est vérifié sur le mois en cours.

-- Mois en UTC, comme le serveur Supabase (les accroches découpent les mois en UTC)
set timezone = 'UTC';

create function pg_temp.perr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.pu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000080' || translate(c, 'kstuvw', 'abcdef'))::uuid $$;
-- Un paiement de Production, 6,49 € en France, sauf précision
create function pg_temp.pay(tx text, orig text, d timestamptz, price bigint default 6490, cur text default 'EUR',
                            sf text default 'FRA', env text default 'Production', trial boolean default false,
                            product text default 'com.mdlf.training.pro.monthly', token text default null,
                            revoked timestamptz default null) returns jsonb
  language sql as
$$ select public.srv_subscription_payment(tx, orig, product, env, d, d + interval '1 month', price, cur, sf, trial, revoked, token) $$;
grant execute on function pg_temp.perr(text), pg_temp.pu(text) to authenticated, anon, service_role;
grant execute on function pg_temp.pay(text, text, timestamptz, bigint, text, text, text, boolean, text, text, timestamptz) to service_role;

insert into auth.users (id, created_at) values
  (pg_temp.pu('k'), now()), (pg_temp.pu('s'), now()), (pg_temp.pu('t'), now()), (pg_temp.pu('u'), now()),
  (pg_temp.pu('v'), now()), (pg_temp.pu('w'), now());
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at) values
  (pg_temp.pu('k'), 'coach.pp', '🦁', now()), (pg_temp.pu('s'), 'eleve.pp', '🦊', null);
insert into public.coach_invites (code, coach_id, created_at, expires_at, permanent) values
  ('ABCDEFGHJKLM', pg_temp.pu('k'), now(), 'infinity', true),
  ('QRSTUVWX', pg_temp.pu('k'), now(), now() + interval '7 days', false);
select private.make_partner_code('LUCAS', 'Lucas', 0.25, 12);

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
  -- Le coach ne se parraine pas avec son propre code
  perform set_config('request.jwt.claim.sub', pg_temp.pu('k')::text, true);
  if public.referral_apply('ABCDEFGHJKLM') ->> 'error' is distinct from 'invalid_code' then raise 'propre code du coach accepté'; end if;
  -- Paiements illisibles et non écrivables depuis l'app
  if pg_temp.perr($q$ select * from public.subscription_payments $q$) not like 'permission denied%' then raise 'paiements lisibles'; end if;
  if pg_temp.perr($q$ select public.srv_subscription_payment('x', 'x', 'com.mdlf.training.pro.monthly', 'Production', now()) $q$)
     not like 'permission denied%' then raise 'srv_subscription_payment appelable par un client'; end if;
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
  -- U (LUCAS) : 13 mois payés depuis janvier 2025, un essai gratuit avant, un paiement Sandbox
  perform pg_temp.pay('u-trial', 'u-orig', '2024-12-01', 0, trial => true, token => pg_temp.pu('u')::text);
  for i in 0..12 loop
    r := pg_temp.pay('u-' || i, 'u-orig', ('2025-01-05'::timestamptz + make_interval(months => i)), token => pg_temp.pu('u')::text);
    if (r ->> 'linked')::boolean is not true then raise 'paiement de U non rattaché (appAccountToken) : %', r; end if;
  end loop;
  perform pg_temp.pay('u-sbx', 'u-sbx-orig', '2025-03-10', env => 'Sandbox', token => pg_temp.pu('u')::text);
  -- Même transaction deux fois : une ligne ; le remboursement (mars, fait en avril) n'est jamais défait
  perform pg_temp.pay('u-2', 'u-orig', '2025-03-05', revoked => '2025-04-20');
  perform pg_temp.pay('u-2', 'u-orig', '2025-03-05');
  -- Produit inconnu, environnement inconnu : ignorés
  if (pg_temp.pay('x-1', 'x-orig', now(), product => 'com.mdlf.training.lifetime') ->> 'recorded')::boolean then raise 'produit inconnu noté'; end if;
  if (pg_temp.pay('x-2', 'x-orig', now(), env => 'Xcode') ->> 'recorded')::boolean then raise 'environnement inconnu noté'; end if;
  -- T (code permanent du coach) : un paiement en dollars, un en Belgique
  perform pg_temp.pay('t-1', 't-orig', '2025-02-03', 3990, 'USD', 'USA', token => pg_temp.pu('t')::text);
  perform pg_temp.pay('t-2', 't-orig', '2025-05-03', 6490, 'EUR', 'BEL', token => pg_temp.pu('t')::text);
  -- V : paiement arrivé avant la validation de l'app, sans appAccountToken : noté, pas encore rattaché
  r := pg_temp.pay('v-1', 'v-orig', '2025-02-10');
  if (r ->> 'recorded')::boolean is not true or (r ->> 'linked')::boolean then raise 'paiement orphelin : %', r; end if;
  -- K : abonnement coach de mars 2025 (essai gratuit d'Apple), payé en avril, remboursé en mai ; Sandbox en juin
  perform pg_temp.pay('k-1', 'k-orig', '2025-03-01', 0, trial => true, product => 'com.mdlf.training.coach10.monthly', token => pg_temp.pu('k')::text);
  perform pg_temp.pay('k-2', 'k-orig', '2025-04-01', 15990, product => 'com.mdlf.training.coach10.monthly', token => pg_temp.pu('k')::text);
  perform pg_temp.pay('k-3', 'k-orig', '2025-05-01', 15990, product => 'com.mdlf.training.coach10.monthly', token => pg_temp.pu('k')::text, revoked => '2025-05-03');
  perform pg_temp.pay('k-4', 'k-sbx', '2025-06-01', 15990, env => 'Sandbox', product => 'com.mdlf.training.coach10.monthly', token => pg_temp.pu('k')::text);
end $$;
reset role;

do $$
begin
  if (select count(*) from public.subscription_payments where transaction_id = 'u-2') <> 1 then raise 'doublon'; end if;
  if (select revoked_at from public.subscription_payments where transaction_id = 'u-2') is distinct from '2025-04-20'::timestamptz then raise 'remboursement défait'; end if;
  if exists (select 1 from public.subscription_payments where transaction_id like 'x-%') then raise 'paiement ignoré noté'; end if;
  if (select count(*) from public.subscription_payments where user_id = pg_temp.pu('u') and attribution_id is not null) <> 15 then raise 'attribution des paiements de U'; end if;
  -- V : la transaction d'origine arrive (verify-purchase), le paiement est rattaché au compte
  perform public.srv_access_purchase(pg_temp.pu('v'), 'com.mdlf.training.pro.monthly', '2025-03-10', 'v-orig', false, '2025-02-10', false, 'Production');
  if (select user_id from public.subscription_payments where transaction_id = 'v-1') is distinct from pg_temp.pu('v') then raise 'orphelin non rattaché'; end if;
  if (select attribution_id from public.subscription_payments where transaction_id = 'v-1') is not null then raise 'attribution sans parrain'; end if;
end $$;
-- V saisit ensuite LUCAS : ses paiements déjà faits lui sont rattachés
set role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', pg_temp.pu('v')::text, true);
  if (public.referral_apply('LUCAS') ->> 'ok')::boolean is not true then raise 'code de V'; end if;
end $$;
reset role;

-- ── Accroches : abonnés, revenu net, abonnement coach ────
do $$
declare got text;
begin
  if (select attribution_id from public.subscription_payments where transaction_id = 'v-1') is null then raise 'parrain trouvé après le paiement : non rattaché'; end if;
  -- 6,49 € TTC en France : 6,49 / 1,2 × 0,85 = 4,597 → 460 centimes. Janvier : U seul ; février : U + V
  if private.referral_net_cents('partner', 'LUCAS', null, '2025-01-01', 12) <> 460 then raise 'net janvier : %', private.referral_net_cents('partner', 'LUCAS', null, '2025-01-01', 12); end if;
  if private.referral_net_cents('partner', 'LUCAS', null, '2025-02-01', 12) <> 919 then raise 'net février : %', private.referral_net_cents('partner', 'LUCAS', null, '2025-02-01', 12); end if;
  -- Mars payé puis remboursé en avril : compté en mars, retiré en avril (avril : +460 −460 = 0)
  if private.referral_net_cents('partner', 'LUCAS', null, '2025-03-01', 12) <> 460 then raise 'net mars'; end if;
  if private.referral_net_cents('partner', 'LUCAS', null, '2025-04-01', 12) <> 0 then raise 'net avril (payé puis remboursé) : %', private.referral_net_cents('partner', 'LUCAS', null, '2025-04-01', 12); end if;
  -- 13e mois de U (janvier 2026) : hors des 12 premiers mois ; V hors fenêtre aussi (rien en 2026)
  if private.referral_net_cents('partner', 'LUCAS', null, '2026-01-01', 12) <> 0 then raise 'net du 13e mois'; end if;
  if private.referral_net_cents('partner', 'LUCAS', null, '2025-12-01', 12) <> 460 then raise 'net du 12e mois'; end if;
  -- Durée de 3 mois : le paiement d'avril de U (4e mois) sort, son remboursement de mars reste retiré
  if private.referral_net_cents('partner', 'LUCAS', null, '2025-04-01', 3) <> -460 then raise 'durée de 3 mois : %', private.referral_net_cents('partner', 'LUCAS', null, '2025-04-01', 3); end if;
  -- Essai gratuit (décembre 2024) et Sandbox : jamais comptés, ni comme premier paiement
  if private.referral_net_cents('partner', 'LUCAS', null, '2024-12-01', 12) <> 0 then raise 'essai gratuit compté'; end if;
  -- Abonnés : février, U et V ; mai, U seul (V n'a payé qu'un mois) ; février 2026 : plus personne
  if private.referral_subscribers('partner', 'LUCAS', null, '2025-02-01') <> 2 then raise 'abonnés février : %', private.referral_subscribers('partner', 'LUCAS', null, '2025-02-01'); end if;
  if private.referral_subscribers('partner', 'LUCAS', null, '2025-05-01') <> 1 then raise 'abonnés mai : %', private.referral_subscribers('partner', 'LUCAS', null, '2025-05-01'); end if;
  if private.referral_subscribers('partner', 'LUCAS', null, '2026-02-01') <> 0 then raise 'abonnés après 12 mois'; end if;
  -- Coach K : T en dollars (février) → inconnu ; T en Belgique (mai) : 6,49 / 1,21 × 0,85 = 4,559 → 456
  if private.referral_net_cents('coach', null, pg_temp.pu('k'), '2025-02-01', 12) is not null then raise 'dollars : revenu net inventé'; end if;
  if private.referral_net_cents('coach', null, pg_temp.pu('k'), '2025-05-01', 12) <> 456 then raise 'net Belgique : %', private.referral_net_cents('coach', null, pg_temp.pu('k'), '2025-05-01', 12); end if;
  if private.referral_net_cents('coach', null, pg_temp.pu('k'), '2025-03-01', 12) <> 0 then raise 'coach sans paiement ce mois'; end if;
  if private.referral_subscribers('coach', null, pg_temp.pu('k'), '2025-05-01') <> 1 then raise 'abonnés du coach'; end if;
  -- Abonnement coach : mars (essai d'Apple) et avril actifs ; mai remboursé, juin Sandbox, janvier rien
  select string_agg(coalesce(private.referral_coach_active(pg_temp.pu('k'), m::date)::text, 'null'), ' ' order by m) into got
    from generate_series('2025-01-01'::date, '2025-06-01'::date, interval '1 month') m;
  if got is distinct from 'false false true true false false' then raise 'abonnement coach actif : %', got; end if;
  if private.referral_coach_active(null, '2025-01-01') is not null then raise 'coach supprimé'; end if;
  -- U (abonné particulier) n'est pas coach
  if private.referral_coach_active(pg_temp.pu('u'), '2025-02-01') then raise 'abonnement particulier pris pour coach'; end if;
end $$;

-- ── Rapport du mois en cours, de bout en bout ────────────
set role service_role;
do $$
declare r record; m0 date := date_trunc('month', now())::date;
begin
  perform pg_temp.pay('w-1', 'w-orig', now(), token => pg_temp.pu('w')::text);   -- W : sans parrain, ne compte nulle part
  perform pg_temp.pay('s-1', 's-orig', now(), 4890, token => pg_temp.pu('s')::text); -- S : offre élève 4,89 €
  select * into r from public.referral_report(m0, m0) where kind = 'coach' and coach_id = pg_temp.pu('k');
  -- 4,89 / 1,2 × 0,85 = 3,46 € ; le coach n'a pas d'abonnement coach ce mois-ci : 0 de commission
  if r.net_cents <> 346 or r.active_subscribers <> 1 or r.coach_active is not false or r.commission_cents <> 0
    then raise 'rapport coach : %', r; end if;
end $$;
reset role;
do $$ begin
  perform pg_temp.pay('k-5', 'k-orig', now(), 15990, product => 'com.mdlf.training.coach10.monthly', token => pg_temp.pu('k')::text);
end $$;
set role service_role;
do $$
declare r record; m0 date := date_trunc('month', now())::date;
begin
  select * into r from public.referral_report(m0, m0) where kind = 'coach' and coach_id = pg_temp.pu('k');
  if r.coach_active is not true or r.commission_cents <> 69 then raise 'commission du coach actif (20 %% de 3,46 €) : %', r; end if;
end $$;
reset role;

-- ── Suppression d'un compte : identifiants d'Apple effacés, montant et parrain gardés ─
do $$
begin
  delete from auth.users where id = pg_temp.pu('v');
  if exists (select 1 from public.subscription_payments where transaction_id = 'v-1' or original_transaction_id = 'v-orig') then raise 'identifiants d''Apple gardés'; end if;
  if (select count(*) from public.subscription_payments where user_id is null and transaction_id is null and attribution_id is not null) <> 1
    then raise 'paiement anonyme absent'; end if;
  if private.referral_net_cents('partner', 'LUCAS', null, '2025-02-01', 12) <> 919 then raise 'mois passé changé par la suppression'; end if;
  -- W, sans parrain : ses paiements sont effacés avec son compte
  delete from auth.users where id = pg_temp.pu('w');
  if exists (select 1 from public.subscription_payments where transaction_id = 'w-1' or (user_id is null and attribution_id is null))
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
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'private'::regnamespace
             and p.proname in ('payment_link', 'payment_forget', 'payment_from_claim', 'payment_from_attribution', 'referral_apple_rate', 'referral_vat_rate',
                               'payment_net_cents', 'referral_paid', 'referral_resolve_coach_code', 'referral_subscribers',
                               'referral_net_cents', 'referral_coach_active') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute')
      then raise '% : exécutable par l''API', f; end if;
  end loop;
  if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.srv_subscription_payment(text, text, text, text, timestamptz, timestamptz, bigint, text, text, boolean, timestamptz, text)'::regprocedure)
    then raise 'srv_subscription_payment : security definer et search_path vide'; end if;
end $$;

-- Nettoyage
delete from auth.users where id in (select pg_temp.pu(c) from unnest(array['k', 's', 't', 'u']) c);
delete from public.subscription_payments;
delete from public.referral_attributions;
delete from public.referral_partners;
reset timezone;
