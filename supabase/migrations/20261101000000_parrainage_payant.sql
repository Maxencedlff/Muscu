-- ═══════════════════════════════════════════════════════════
--  Parrainage branché sur le payant (docs/PARRAINAGE.md, « Accroches du payant ») : les quatre
--  accroches laissées vides par 20261031400000_parrainage.sql reçoivent leur vraie version, et les
--  paiements d'Apple sont notés pour calculer le revenu net de chaque parrain.
--
--  1. UNE SEULE SOURCE DE VÉRITÉ pour « qui a amené ce compte » : public.referral_attributions. Le
--     rattachement élève → coach du payant (public.coach_origins, 20261030000000_payant_tarifs.sql) a
--     été retiré de cette migration-là avant sa mise en production : rejoindre un coach (coach_join)
--     crée la ligne de coach_links, et le déclencheur coach_links_referral du parrainage attribue
--     l'élève à son coach (ou à son code partenaire pour un coach partenaire). Rien n'est dupliqué.
--  2. public.subscription_payments : une ligne par transaction d'Apple (chaque période payée ou
--     offerte : achat, renouvellement, changement de palier), écrite par les fonctions Edge
--     verify-purchase et appstore-notify (clé serveur, public.srv_subscription_payment). Prix payé
--     (millièmes de la devise), devise, pays de la boutique, essai gratuit, environnement, date de
--     remboursement. Le compte et l'attribution sont rattachés par la base (déclencheurs), quel que
--     soit l'ordre d'arrivée : paiement avant la transaction d'origine (notification d'Apple reçue
--     avant la validation de l'app), code de parrainage saisi après le premier paiement.
--  3. Accroches :
--     - referral_resolve_coach_code(code) : code PERMANENT d'un coach validé (coach_invites.permanent)
--       → son compte. Les codes de 7 jours ne valent que pour rejoindre le coach, pas pour le parrainage ;
--     - referral_subscribers : comptes attribués à ce parrain dont une période PAYÉE, prise dans leurs
--       N premiers mois d'abonnement payé, couvre une partie du mois ;
--     - referral_net_cents : Σ revenu net des paiements du mois (date d'achat de la période), moins le
--       revenu net des paiements remboursés dans le mois (« un remboursement fait après coup est retiré
--       du relevé du mois où il a lieu », docs/CONDITIONS_COACH.md) ; seulement les paiements pris dans
--       les N premiers mois d'abonnement payé de chaque compte, comptés depuis son premier paiement ;
--     - referral_coach_active(coach, mois) : une période d'abonnement coach de Production, non
--       remboursée, couvre une partie du mois (essai gratuit d'Apple compris : c'est un abonnement actif).
--  4. Revenu net d'un paiement = prix TTC ÷ (1 + TVA du pays de la boutique) × (1 − part d'Apple). Part
--     d'Apple : private.referral_apple_rate() (15 %, Small Business Program). TVA : taux normaux de la
--     zone euro (private.referral_vat_rate). Hors euro, ou pays inconnu : revenu net INCONNU (null), le
--     rapport laisse la case vide (« inconnu », jamais « 0 € ») et le relevé d'Apple fait foi. Ces
--     montants sont une estimation : le relevé d'App Store Connect du mois reste la pièce de référence.
--     Sandbox (TestFlight, équipe d'examen d'Apple), essai gratuit et prix nul : jamais comptés.
--
--  Sécurité : comme le parrainage. subscription_payments : RLS sans politique, aucun GRANT ; tout passe
--  par des fonctions security definer à search_path vide. srv_subscription_payment : service_role
--  seulement. Suppression d'un compte : ses paiements sans parrain sont effacés ; ceux d'un compte
--  parrainé perdent le compte et les identifiants de transaction d'Apple (déclencheurs), restent le
--  produit, la date, le prix, le pays et l'attribution (anonyme), pour que les commissions des mois
--  passés restent vérifiables.
--
--  Réversible : supabase/rollback/20261101000000_parrainage_payant_down.sql (paiements mis de côté dans
--  private.parrainage_payant_archive_payments, accroches remises à null).
-- ═══════════════════════════════════════════════════════════

-- ── Paiements d'Apple ────────────────────────────────────

create table public.subscription_payments (
  id                      bigint generated always as identity primary key,
  -- Identifiants d'Apple ; effacés à la suppression du compte (null)
  transaction_id          text unique check (char_length(transaction_id) between 1 and 64),
  original_transaction_id text check (char_length(original_transaction_id) between 1 and 64),
  user_id                 uuid references auth.users(id) on delete set null,
  -- Parrain du compte au moment du calcul ; jamais supprimé (referral_attributions reste, anonyme)
  attribution_id          bigint references public.referral_attributions(id) on delete set null,
  product_id              text not null check (char_length(product_id) between 1 and 128),
  environment             text not null check (environment in ('Production', 'Sandbox')),
  purchased_at            timestamptz not null,
  expires_at              timestamptz,
  price_milli             bigint check (price_milli between 0 and 100000000),
  currency                text check (currency ~ '^[A-Z]{3}$'),
  storefront              text check (storefront ~ '^[A-Z]{3}$'),
  free_trial              boolean not null default false,
  revoked_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index subscription_payments_original on public.subscription_payments (original_transaction_id);
create index subscription_payments_user on public.subscription_payments (user_id, purchased_at);
create index subscription_payments_attribution on public.subscription_payments (attribution_id, purchased_at)
  where attribution_id is not null;
alter table public.subscription_payments enable row level security;
revoke all on public.subscription_payments from public, anon, authenticated, service_role;

-- ── Rattachements (déclencheurs) ─────────────────────────

-- Compte (par la transaction d'origine) et attribution du compte, s'ils manquent. Suppression du compte
-- (user_id qui passe à null) : identifiants d'Apple effacés.
create function private.payment_link() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if tg_op = 'UPDATE' and old.user_id is not null and new.user_id is null then
    new.transaction_id := null;
    new.original_transaction_id := null;
    return new;
  end if;
  if new.user_id is null and new.original_transaction_id is not null then
    select c.user_id into new.user_id from public.entitlement_claims c
     where c.original_transaction_id = new.original_transaction_id;
  end if;
  if new.attribution_id is null and new.user_id is not null then
    select a.id into new.attribution_id from public.referral_attributions a where a.user_id = new.user_id;
  end if;
  return new;
end
$$;
create trigger subscription_payments_link before insert or update on public.subscription_payments
  for each row execute function private.payment_link();

-- Suppression du compte : un paiement sans parrain n'a plus de raison d'être gardé, il est effacé ; celui
-- d'un compte parrainé reste, anonyme (sans compte ni identifiant d'Apple), pour le relevé du parrain
create function private.payment_forget() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  delete from public.subscription_payments p where p.id = new.id and p.attribution_id is null;
  return null;
end
$$;
create trigger subscription_payments_forget after update of user_id on public.subscription_payments
  for each row when (old.user_id is not null and new.user_id is null)
  execute function private.payment_forget();

-- Transaction d'origine enregistrée après le paiement (notification reçue avant la validation de l'app)
create function private.payment_from_claim() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  update public.subscription_payments p set user_id = new.user_id, updated_at = now()
   where p.original_transaction_id = new.original_transaction_id and p.user_id is null;
  return null;
end
$$;
create trigger entitlement_claims_payments after insert or update of user_id on public.entitlement_claims
  for each row execute function private.payment_from_claim();

-- Parrain trouvé après le premier paiement (code saisi dans les 30 jours, adhésion à un coach)
create function private.payment_from_attribution() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if new.user_id is not null then
    update public.subscription_payments p set attribution_id = new.id, updated_at = now()
     where p.user_id = new.user_id and p.attribution_id is null;
  end if;
  return null;
end
$$;
create trigger referral_attributions_payments after insert on public.referral_attributions
  for each row execute function private.payment_from_attribution();

-- ── Écriture par les fonctions Edge (clé serveur) ────────

-- Une transaction d'Apple vérifiée (signature et relecture faites par la fonction Edge). Idempotente :
-- la même transaction réécrit la même ligne (date de fin, remboursement). Un remboursement n'est jamais
-- défait (la première date reste). Produit qui n'est pas un des nôtres : ignoré. Compte retrouvé par la
-- transaction d'origine, sinon par l'appAccountToken (uuid du compte), sinon plus tard (déclencheur).
-- Réponse : { recorded, linked }.
create function public.srv_subscription_payment(p_transaction_id text, p_original_tx text, p_product text,
                                                p_environment text, p_purchased_at timestamptz,
                                                p_expires_at timestamptz default null,
                                                p_price_milli bigint default null,
                                                p_currency text default null,
                                                p_storefront text default null,
                                                p_free_trial boolean default false,
                                                p_revoked_at timestamptz default null,
                                                p_account_token text default null)
  returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  owner uuid;
  r public.subscription_payments;
begin
  if p_transaction_id is null or p_original_tx is null or p_purchased_at is null
     or private.access_product_kind(p_product) is null
     or p_environment is null or p_environment not in ('Production', 'Sandbox') then
    return jsonb_build_object('recorded', false, 'linked', false);
  end if;
  select c.user_id into owner from public.entitlement_claims c where c.original_transaction_id = p_original_tx;
  if owner is null and p_account_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select u.id into owner from auth.users u where u.id = p_account_token::uuid;
  end if;
  insert into public.subscription_payments as p (transaction_id, original_transaction_id, user_id, product_id,
      environment, purchased_at, expires_at, price_milli, currency, storefront, free_trial, revoked_at)
    values (p_transaction_id, p_original_tx, owner, p_product, p_environment, p_purchased_at, p_expires_at,
            p_price_milli, upper(p_currency), upper(p_storefront), coalesce(p_free_trial, false), p_revoked_at)
    on conflict (transaction_id) do update
      set expires_at = coalesce(excluded.expires_at, p.expires_at),
          price_milli = coalesce(excluded.price_milli, p.price_milli),
          currency = coalesce(excluded.currency, p.currency),
          storefront = coalesce(excluded.storefront, p.storefront),
          revoked_at = coalesce(p.revoked_at, excluded.revoked_at),
          user_id = coalesce(p.user_id, excluded.user_id),
          updated_at = now()
    returning * into r;
  return jsonb_build_object('recorded', true, 'linked', r.user_id is not null);
end
$$;

-- ── Revenu net ───────────────────────────────────────────

-- Part d'Apple sur le prix hors taxes (Small Business Program : 15 %) : une seule place à changer
create function private.referral_apple_rate() returns numeric
  language sql immutable set search_path = '' as $$ select 0.15::numeric $$;

-- TVA (taux normal) des pays de la zone euro, par code de boutique d'Apple (ISO 3166-1 alpha-3) ;
-- null : pays dont le revenu net n'est pas calculé (relevé d'Apple seulement)
create function private.referral_vat_rate(storefront text) returns numeric
  language sql immutable set search_path = '' as
$$
  select case storefront
    when 'FRA' then 0.20 when 'BEL' then 0.21 when 'LUX' then 0.17 when 'DEU' then 0.19
    when 'NLD' then 0.21 when 'ESP' then 0.21 when 'ITA' then 0.22 when 'PRT' then 0.23
    when 'IRL' then 0.23 when 'AUT' then 0.20 when 'FIN' then 0.255 when 'GRC' then 0.24
    when 'SVK' then 0.23 when 'SVN' then 0.22 when 'EST' then 0.24 when 'LVA' then 0.21
    when 'LTU' then 0.21 when 'CYP' then 0.19 when 'MLT' then 0.18 when 'HRV' then 0.25
  end::numeric
$$;

-- Revenu net d'un paiement en centimes d'euro ; null si inconnu (autre devise, pays hors liste, prix absent)
create function private.payment_net_cents(price_milli bigint, currency text, storefront text) returns numeric
  language sql immutable set search_path = '' as
$$
  select case when currency = 'EUR' and price_milli is not null and private.referral_vat_rate(storefront) is not null
              then price_milli / 10.0 / (1 + private.referral_vat_rate(storefront)) * (1 - private.referral_apple_rate())
         end
$$;

-- Paiements PAYÉS des comptes attribués à un parrain, pris dans les `months` premiers mois d'abonnement
-- payé de chaque compte (depuis son premier paiement de Production) : la base de toutes les accroches
create function private.referral_paid(kind text, code text, coach uuid, months int)
  returns table (attribution_id bigint, purchased_at timestamptz, expires_at timestamptz,
                 revoked_at timestamptz, net numeric)
  language sql stable security definer set search_path = '' as
$$
  with pays as (
    select p.attribution_id, p.purchased_at, p.expires_at, p.revoked_at,
           private.payment_net_cents(p.price_milli, p.currency, p.storefront) as net
      from public.referral_attributions a
      join public.subscription_payments p on p.attribution_id = a.id
     where ((referral_paid.kind = 'partner' and a.partner_code = referral_paid.code)
            or (referral_paid.kind = 'coach' and a.referrer_coach = referral_paid.coach))
       and p.environment = 'Production' and not p.free_trial and coalesce(p.price_milli, 1) > 0
  )
  select x.attribution_id, x.purchased_at, x.expires_at, x.revoked_at, x.net
    from pays x
    join (select y.attribution_id, min(y.purchased_at) as f from pays y group by 1) f using (attribution_id)
   where x.purchased_at < f.f + make_interval(months => greatest(coalesce(referral_paid.months, 0), 0))
$$;

-- ── Accroches (mêmes signatures que 20261031400000_parrainage.sql) ──

create or replace function private.referral_resolve_coach_code(code text) returns uuid
  language sql stable security definer set search_path = '' as
$$
  select i.coach_id from public.coach_invites i
   where i.permanent and i.code = private.coach_code_norm(referral_resolve_coach_code.code)
     and private.is_coach(i.coach_id)
$$;

create or replace function private.referral_subscribers(kind text, code text, coach uuid, month date) returns int
  language sql stable security definer set search_path = '' as
$$
  with bounds as (
    select referral_subscribers.month::timestamp at time zone 'UTC' as f,
           (referral_subscribers.month + interval '1 month')::timestamp at time zone 'UTC' as t
  )
  select count(distinct x.attribution_id)::int
    from bounds b,
         private.referral_paid(referral_subscribers.kind, referral_subscribers.code, referral_subscribers.coach,
           case when referral_subscribers.kind = 'coach'
                then coalesce((select t.commission_months from public.referral_coach_terms t
                                where t.coach_id = referral_subscribers.coach), private.referral_coach_months())
                else (select rp.commission_months from public.referral_partners rp
                       where rp.code = referral_subscribers.code) end) x
   where x.purchased_at < b.t
     and coalesce(x.expires_at, x.purchased_at + interval '1 month') > b.f
     and (x.revoked_at is null or x.revoked_at > b.f)
$$;

create or replace function private.referral_net_cents(kind text, code text, coach uuid, month date, months int) returns bigint
  language sql stable security definer set search_path = '' as
$$
  with bounds as (
    select referral_net_cents.month::timestamp at time zone 'UTC' as f,
           (referral_net_cents.month + interval '1 month')::timestamp at time zone 'UTC' as t
  ),
  paid as (
    select * from private.referral_paid(referral_net_cents.kind, referral_net_cents.code,
                                        referral_net_cents.coach, referral_net_cents.months)
  ),
  lines as (
    select x.net from paid x, bounds b where x.purchased_at >= b.f and x.purchased_at < b.t
    union all
    select -x.net from paid x, bounds b where x.revoked_at >= b.f and x.revoked_at < b.t
  )
  select case when bool_or(l.net is null) then null else coalesce(round(sum(l.net)), 0)::bigint end from lines l
$$;

create or replace function private.referral_coach_active(coach uuid, month date) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select case when referral_coach_active.coach is null then null else exists (
    select 1 from public.subscription_payments p
     where p.user_id = referral_coach_active.coach and private.coach_product_limit(p.product_id) is not null
       and p.environment = 'Production' and p.revoked_at is null
       and p.purchased_at < (referral_coach_active.month + interval '1 month')::timestamp at time zone 'UTC'
       and coalesce(p.expires_at, p.purchased_at) > referral_coach_active.month::timestamp at time zone 'UTC') end
$$;

-- ── Droits ───────────────────────────────────────────────

revoke all on function private.payment_link() from public, anon, authenticated, service_role;
revoke all on function private.payment_forget() from public, anon, authenticated, service_role;
revoke all on function private.payment_from_claim() from public, anon, authenticated, service_role;
revoke all on function private.payment_from_attribution() from public, anon, authenticated, service_role;
revoke all on function private.referral_apple_rate() from public, anon, authenticated, service_role;
revoke all on function private.referral_vat_rate(text) from public, anon, authenticated, service_role;
revoke all on function private.payment_net_cents(bigint, text, text) from public, anon, authenticated, service_role;
revoke all on function private.referral_paid(text, text, uuid, int) from public, anon, authenticated, service_role;
-- create or replace garde les droits : les accroches restent fermées à tous les rôles de l'API
revoke all on function private.referral_resolve_coach_code(text) from public, anon, authenticated, service_role;
revoke all on function private.referral_subscribers(text, text, uuid, date) from public, anon, authenticated, service_role;
revoke all on function private.referral_net_cents(text, text, uuid, date, int) from public, anon, authenticated, service_role;
revoke all on function private.referral_coach_active(uuid, date) from public, anon, authenticated, service_role;

revoke all on function public.srv_subscription_payment(text, text, text, text, timestamptz, timestamptz, bigint, text, text, boolean, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.srv_subscription_payment(text, text, text, text, timestamptz, timestamptz, bigint, text, text, boolean, timestamptz, text)
  to service_role;

-- Administration :
--   select date_trunc('month', purchased_at) m, count(*), sum(price_milli) / 1000.0 from public.subscription_payments
--    where environment = 'Production' and not free_trial group by 1 order by 1;   -- paiements par mois
--   select * from public.referral_report('2026-11-01', '2026-11-01');            -- relevé du mois
