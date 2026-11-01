-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261101000000_parrainage_payant.sql (à lancer à la main, dans
--  l'éditeur SQL). Pas dans migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Avant : redéployer verify-purchase et appstore-notify dans leur version qui n'appelle pas
--  srv_subscription_payment (sinon verify-purchase journalise une erreur à chaque achat, sans rien
--  bloquer, et appstore-notify continue : fonction absente = ignorée). Sortir le dernier rapport
--  (select * from public.referral_report();).
--
--  Effet :
--  - les paiements d'Apple notés sont MIS DE CÔTÉ, sans compte ni identifiant d'Apple (attribution,
--    produit, dates, prix, devise, pays), dans private.parrainage_payant_archive_payments (aucun rôle de
--    l'API n'y a accès), puis public.subscription_payments est supprimée ;
--  - les quatre accroches du parrainage reprennent leur version vide et le rapport son texte de
--    20261031400000_parrainage.sql (null : « inconnu ») ; les déclencheurs et fonctions ajoutés
--    disparaissent.
--
--  Ordre : à lancer AVANT le retour arrière du parrainage (20261031400000, qui s'arrête tant que la table
--  des paiements est là) et avant celui des tarifs (20261030000000, coach_product_limit).
-- ═══════════════════════════════════════════════════════════

begin;

create table private.parrainage_payant_archive_payments as
  select id, attribution_id, product_id, environment, purchased_at, expires_at, price_milli, currency,
         storefront, free_trial, revoked_at, created_at
    from public.subscription_payments;
revoke all on private.parrainage_payant_archive_payments from public, anon, authenticated, service_role;

drop trigger referral_attributions_payments on public.referral_attributions;
drop function public.srv_subscription_payment(text, text, text, text, timestamptz, timestamptz, bigint, text, text, boolean, timestamptz, text);
drop table public.subscription_payments;
drop function private.payment_link();
drop function private.payment_forget();
drop function private.payment_from_attribution();

-- Accroches et rapport : texte exact de 20261031400000_parrainage.sql
create or replace function private.referral_resolve_coach_code(code text) returns uuid
  language sql stable security definer set search_path = '' as
$$ select null::uuid $$;
create or replace function private.referral_subscribers(kind text, code text, coach uuid, month date) returns int
  language sql stable security definer set search_path = '' as
$$ select null::int $$;
create or replace function private.referral_net_cents(kind text, code text, coach uuid, month date, months int) returns bigint
  language sql stable security definer set search_path = '' as
$$ select null::bigint $$;
create or replace function private.referral_coach_active(coach uuid, month date) returns boolean
  language sql stable security definer set search_path = '' as
$$ select null::boolean $$;
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
                when refs.k = 'coach' and ca.active is not true then 0
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

drop function private.referral_paid(text, text, uuid, int);
drop function private.referral_months(text, text, uuid);
drop function private.payment_net_cents(bigint, text, text, timestamptz);
drop function private.referral_vat_rate(text);
drop function private.referral_apple_rate(timestamptz);
drop function private.referral_apple_small_business_since();

commit;
