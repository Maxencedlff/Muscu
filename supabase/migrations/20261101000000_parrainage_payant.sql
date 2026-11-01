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
--     remboursement. Seulement pour un compte retrouvé (transaction d'origine connue, ou appAccountToken
--     d'un compte qui existe) : rien n'est noté pour un compte supprimé. Le parrain est rattaché par la
--     base, y compris quand le code est saisi après le premier paiement.
--  3. Accroches :
--     - referral_resolve_coach_code(code) : code PERMANENT d'un coach validé (coach_invites.permanent)
--       → son compte. Les codes de 7 jours ne valent que pour rejoindre le coach, pas pour le parrainage ;
--     - « N premiers mois d'abonnement payé » (docs/CONDITIONS_COACH.md) : les périodes payées du compte
--       sont additionnées dans l'ordre (un mois = 1, un an = 12) depuis son premier paiement de
--       Production ; une période qui dépasse N n'est comptée que pour sa part (6 mois payés puis un
--       annuel : la moitié de l'annuel). Un paiement d'AVANT l'adhésion à un coach consomme ses mois
--       mais ne rapporte rien au coach (pas de commission rétroactive) ;
--     - referral_subscribers : comptes attribués dont une période ainsi comptée couvre une partie du mois ;
--     - referral_net_cents : Σ revenu net des périodes comptées achetées dans le mois, moins celui des
--       périodes remboursées dans le mois (« un remboursement fait après coup est retiré du relevé du
--       mois où il a lieu ») ; pour un coach, seulement les périodes achetées un mois où son abonnement
--       coach était actif (remboursement compris : on ne reprend que ce qui a été versé) ;
--     - referral_coach_active(coach, mois) : une période d'abonnement coach de Production, non
--       remboursée, couvre une partie du mois (essai gratuit d'Apple compris : c'est un abonnement actif).
--     public.referral_report ne remet plus la commission d'un coach inactif à zéro lui-même : c'est
--     referral_net_cents qui applique la règle, achat et remboursement compris.
--  4. Revenu net d'un paiement = prix TTC ÷ (1 + TVA du pays de la boutique) × (1 − part d'Apple). Part
--     d'Apple : 30 %, ou 15 % pour les paiements faits depuis la date d'adhésion au Small Business
--     Program (private.referral_apple_small_business_since(), null tant qu'Apple ne l'a pas confirmée) :
--     les mois passés gardent le taux de leur date. TVA : taux normaux de la zone euro
--     (private.referral_vat_rate). Hors euro, ou pays inconnu : revenu net INCONNU (null), le rapport
--     laisse la case vide (« inconnu », jamais « 0 € ») et le relevé d'Apple fait foi. Ces montants sont
--     une estimation : le relevé d'App Store Connect du mois reste la pièce de référence. Sandbox
--     (TestFlight, équipe d'examen d'Apple), essai gratuit et prix nul : jamais comptés.
--     Limites connues : un remboursement annulé par Apple (REFUND_REVERSED) n'est pas suivi ; un
--     remboursement arrivé après la suppression du compte n'est plus retrouvé (identifiants effacés).

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

-- Attribution du compte, si elle manque. Suppression du compte (user_id qui passe à null) : identifiants
-- d'Apple effacés.
create function private.payment_link() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if tg_op = 'UPDATE' and old.user_id is not null and new.user_id is null then
    new.transaction_id := null;
    new.original_transaction_id := null;
    return new;
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
-- transaction d'origine, sinon par l'appAccountToken (uuid du compte) ; introuvable (compte supprimé,
-- transaction d'un autre) : rien n'est noté. Réponse : { recorded }.
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
begin
  if p_transaction_id is null or p_original_tx is null or p_purchased_at is null
     or private.access_product_kind(p_product) is null
     or p_environment is null or p_environment not in ('Production', 'Sandbox') then
    return jsonb_build_object('recorded', false);
  end if;
  select c.user_id into owner from public.entitlement_claims c where c.original_transaction_id = p_original_tx;
  if owner is null and p_account_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select u.id into owner from auth.users u where u.id = p_account_token::uuid;
  end if;
  if owner is null then
    return jsonb_build_object('recorded', false);
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
          updated_at = now()
    where p.user_id = owner;
  return jsonb_build_object('recorded', found);
end
$$;

-- ── Revenu net ───────────────────────────────────────────

-- Date d'adhésion au Small Business Program d'Apple (15 % au lieu de 30 %) : null tant qu'Apple ne l'a pas
-- confirmée. Une seule place à changer (comme private.referral_coach_rate), par l'administrateur :
--   create or replace function private.referral_apple_small_business_since() returns timestamptz
--     language sql immutable set search_path = '' as $f$ select '2026-12-01 00:00+00'::timestamptz $f$;
create function private.referral_apple_small_business_since() returns timestamptz
  language sql immutable set search_path = '' as $$ select null::timestamptz $$;

-- Part d'Apple sur le prix hors taxes à une date : 15 % depuis l'adhésion au Small Business Program,
-- 30 % avant ou sans adhésion (le cas le plus prudent) : les mois passés gardent le taux de leur date
create function private.referral_apple_rate(paid_at timestamptz) returns numeric
  language sql stable set search_path = '' as
$$
  select case when paid_at >= private.referral_apple_small_business_since() then 0.15 else 0.30 end::numeric
$$;

-- TVA (taux normal) des pays de la zone euro au 01/11/2026, par code de boutique d'Apple (ISO 3166-1
-- alpha-3) ; null : pays dont le revenu net n'est pas calculé (relevé d'Apple seulement)
create function private.referral_vat_rate(storefront text) returns numeric
  language sql immutable set search_path = '' as
$$
  select case storefront
    when 'FRA' then 0.20 when 'BEL' then 0.21 when 'LUX' then 0.17 when 'DEU' then 0.19
    when 'NLD' then 0.21 when 'ESP' then 0.21 when 'ITA' then 0.22 when 'PRT' then 0.23
    when 'IRL' then 0.23 when 'AUT' then 0.20 when 'FIN' then 0.255 when 'GRC' then 0.24
    when 'SVK' then 0.23 when 'SVN' then 0.22 when 'EST' then 0.24 when 'LVA' then 0.21
    when 'LTU' then 0.21 when 'CYP' then 0.19 when 'MLT' then 0.18 when 'HRV' then 0.25
    when 'BGR' then 0.20
  end::numeric
$$;

-- Revenu net d'un paiement en centimes d'euro ; null si inconnu (autre devise, pays hors liste, prix absent)
create function private.payment_net_cents(price_milli bigint, currency text, storefront text, purchased_at timestamptz)
  returns numeric
  language sql stable security definer set search_path = '' as
$$
  select case when currency = 'EUR' and price_milli is not null and private.referral_vat_rate(storefront) is not null
              then price_milli / 10.0 / (1 + private.referral_vat_rate(storefront))
                   * (1 - private.referral_apple_rate(purchased_at))
         end
$$;

-- Durée de commission d'un parrain (mois) : conditions du partenaire, ou exception du coach, ou règle commune
create function private.referral_months(kind text, code text, coach uuid) returns int
  language sql stable security definer set search_path = '' as
$$
  select case when referral_months.kind = 'coach'
              then coalesce((select t.commission_months from public.referral_coach_terms t
                              where t.coach_id = referral_months.coach), private.referral_coach_months())
              else (select p.commission_months from public.referral_partners p where p.code = referral_months.code) end
$$;

-- Périodes PAYÉES des comptes attribués à un parrain, comptées dans les `months` premiers mois
-- d'abonnement payé de chaque compte (en-tête, point 3), avec leur part (weight) et leur revenu net
-- pondéré. Une période d'avant l'adhésion à un coach consomme ses mois mais n'est pas rendue.
create function private.referral_paid(kind text, code text, coach uuid, months int)
  returns table (attribution_id bigint, purchased_at timestamptz, expires_at timestamptz,
                 revoked_at timestamptz, net numeric)
  language sql stable security definer set search_path = '' as
$$
  with pays as (
    select p.id, p.attribution_id, a.source, a.created_at as attributed_at, p.purchased_at, p.expires_at,
           p.revoked_at, private.payment_net_cents(p.price_milli, p.currency, p.storefront, p.purchased_at) as net,
           greatest(1, round(extract(epoch from coalesce(p.expires_at, p.purchased_at + interval '1 month') - p.purchased_at)
                             / 2629746.0))::int as len
      from public.referral_attributions a
      join public.subscription_payments p on p.attribution_id = a.id
     where ((referral_paid.kind = 'partner' and a.partner_code = referral_paid.code)
            or (referral_paid.kind = 'coach' and a.referrer_coach = referral_paid.coach))
       and p.environment = 'Production' and not p.free_trial and coalesce(p.price_milli, 1) > 0
  ),
  ordered as (
    select x.*, coalesce(sum(x.len) over (partition by x.attribution_id order by x.purchased_at, x.id
                                          rows between unbounded preceding and 1 preceding), 0) as before
      from pays x
  )
  select o.attribution_id, o.purchased_at, o.expires_at, o.revoked_at,
         o.net * least(1, (greatest(coalesce(referral_paid.months, 0), 0) - o.before)::numeric / o.len)
    from ordered o
   where o.before < greatest(coalesce(referral_paid.months, 0), 0)
     and (o.source = 'code' or o.purchased_at >= o.attributed_at)
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
                               private.referral_months(referral_subscribers.kind, referral_subscribers.code,
                                                       referral_subscribers.coach)) x
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
    select x.*,
           -- Coach : seulement ce qui a été acheté un mois où son abonnement coach était actif
           referral_net_cents.kind <> 'coach' or coalesce(private.referral_coach_active(referral_net_cents.coach,
             date_trunc('month', x.purchased_at at time zone 'UTC')::date), false) as earns
      from private.referral_paid(referral_net_cents.kind, referral_net_cents.code,
                                 referral_net_cents.coach, referral_net_cents.months) x
  ),
  lines as (
    select x.net from paid x, bounds b where x.earns and x.purchased_at >= b.f and x.purchased_at < b.t
    union all
    select -x.net from paid x, bounds b where x.earns and x.revoked_at >= b.f and x.revoked_at < b.t
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

-- Rapport : texte de 20261031400000_parrainage.sql, sauf la commission d'un coach inactif, que
-- referral_net_cents met déjà à zéro (achat et remboursement compris)
create or replace function public.referral_report(from_month date default null, to_month date default null)
  returns table (month date, kind text, code text, coach_id uuid, display_name text, active boolean,
                 commission_rate numeric, commission_months int, new_accounts int, total_accounts int,
                 active_subscribers int, net_cents bigint, coach_active boolean, commission_cents bigint,
                 paid_cents bigint, balance_cents bigint, payable boolean)
  language sql stable security definer set search_path = '' as
$$
  with bounds as (
    select date_trunc('month', coalesce(from_month, (now() - interval '11 months')::date))::date as f,
           date_trunc('month', coalesce(to_month, now()::date))::date as t
  ),
  refs as (
    select 'partner'::text as k, p.code as c, null::uuid as co, p.display_name as n, p.active as act,
           p.commission_rate as r, p.commission_months as mo, p.created_at as since
    from public.referral_partners p
    union all
    select 'coach', null, x.co, up.username, private.is_coach(x.co),
           coalesce(t.commission_rate, private.referral_coach_rate()),
           coalesce(t.commission_months, private.referral_coach_months()),
           least((select min(a.created_at) from public.referral_attributions a where a.referrer_coach = x.co),
                 (select min(py.paid_at) from public.referral_payouts py where py.coach_id = x.co), t.updated_at)
    from (select a.referrer_coach as co from public.referral_attributions a where a.referrer_coach is not null
          union select t2.coach_id from public.referral_coach_terms t2
          union select py.coach_id from public.referral_payouts py where py.coach_id is not null) x
    left join public.user_profiles up on up.user_id = x.co
    left join public.referral_coach_terms t on t.coach_id = x.co
  ),
  -- Commission de chaque mois, depuis le premier mois du parrain (pour le cumul et le report)
  monthly as (
    select refs.*, m::date as m, n.net, ca.active as coach_on,
           case when n.net is null then null
                else round(n.net * refs.r)::bigint end as comm
    from refs, bounds,
      generate_series(date_trunc('month', refs.since)::date::timestamp, bounds.t::timestamp, interval '1 month') m,
      lateral (select private.referral_net_cents(refs.k, refs.c, refs.co, m::date, refs.mo) as net) n,
      lateral (select case when refs.k = 'coach' then private.referral_coach_active(refs.co, m::date) end as active) ca
  )
  select x.m, x.k, x.c, x.co, x.n, x.act, x.r, x.mo,
    (select count(*)::int from public.referral_attributions a
      where (a.partner_code = x.c or a.referrer_coach = x.co)
        and a.created_at >= x.m and a.created_at < x.m + interval '1 month'),
    (select count(*)::int from public.referral_attributions a
      where (a.partner_code = x.c or a.referrer_coach = x.co) and a.created_at < x.m + interval '1 month'),
    private.referral_subscribers(x.k, x.c, x.co, x.m),
    x.net, x.coach_on, x.comm, pd.paid,
    bal.v, bal.v >= private.referral_payout_min_cents()
  from monthly x, bounds,
    lateral (select coalesce(sum(py.amount_cents), 0)::bigint as paid from public.referral_payouts py
             where (py.partner_code = x.c or py.coach_id = x.co) and py.paid_at < x.m + interval '1 month') pd,
    lateral (select case when bool_or(y.comm is null) then null else sum(y.comm)::bigint - pd.paid end as v
             from monthly y where y.k = x.k and y.c is not distinct from x.c and y.co is not distinct from x.co and y.m <= x.m) bal
  where x.m >= bounds.f
  order by x.m, x.k desc, x.c, x.n
$$;

-- ── Droits ───────────────────────────────────────────────

revoke all on function private.payment_link() from public, anon, authenticated, service_role;
revoke all on function private.payment_forget() from public, anon, authenticated, service_role;
revoke all on function private.payment_from_attribution() from public, anon, authenticated, service_role;
revoke all on function private.referral_apple_rate(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.referral_apple_small_business_since() from public, anon, authenticated, service_role;
revoke all on function private.referral_vat_rate(text) from public, anon, authenticated, service_role;
revoke all on function private.payment_net_cents(bigint, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.referral_paid(text, text, uuid, int) from public, anon, authenticated, service_role;
revoke all on function private.referral_months(text, text, uuid) from public, anon, authenticated, service_role;
-- create or replace garde les droits : les accroches restent fermées à tous les rôles de l'API
revoke all on function private.referral_resolve_coach_code(text) from public, anon, authenticated, service_role;
revoke all on function private.referral_subscribers(text, text, uuid, date) from public, anon, authenticated, service_role;
revoke all on function private.referral_net_cents(text, text, uuid, date, int) from public, anon, authenticated, service_role;
revoke all on function private.referral_coach_active(uuid, date) from public, anon, authenticated, service_role;

-- create or replace garde aussi les droits du rapport (service_role seulement)
revoke all on function public.srv_subscription_payment(text, text, text, text, timestamptz, timestamptz, bigint, text, text, boolean, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.srv_subscription_payment(text, text, text, text, timestamptz, timestamptz, bigint, text, text, boolean, timestamptz, text)
  to service_role;

-- Administration :
--   select date_trunc('month', purchased_at) m, count(*), sum(price_milli) / 1000.0 from public.subscription_payments
--    where environment = 'Production' and not free_trial group by 1 order by 1;   -- paiements par mois
--   select * from public.referral_report('2026-11-01', '2026-11-01');            -- relevé du mois
