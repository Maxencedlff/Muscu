-- ═══════════════════════════════════════════════════════════
--  Payant V1, ESSAI COACH PAR OFFRE PROMOTIONNELLE D'APPLE (17/11/2026, contrat : docs/PAYANT_V1.md,
--  section « Essai coach pour qui a déjà eu un essai »). Après 20261116030000_eleves_gratuits.sql.
--  Rien de ce fichier n'est appliqué en production sans le feu vert de Maxence.
--  Retour arrière : supabase/rollback/20261117040000_promo_coach_down.sql.
--
--  LE PROBLÈME. Particulier et coach sont dans le MÊME groupe d'abonnements : Apple n'accorde l'offre de
--  lancement (essai gratuit) qu'une fois par identifiant Apple et par groupe. Un coach qui a déjà eu
--  l'essai particulier n'a donc pas l'essai coach de 2 mois.
--
--  LA RÉPONSE. Une offre promotionnelle d'Apple « 2 mois gratuits » (FREE_TRIAL, TWO_MONTHS) sur chacun des
--  8 abonnements coach (identifiant d'offre <produit>.essai2mois, créé dans App Store Connect le 17/11).
--  Apple la réserve aux clients qui ont ou ont eu un abonnement du groupe, et exige qu'elle soit SIGNÉE par
--  notre serveur (fonction Edge coach-promo-offer). Ce fichier décide QUI y a droit :
--  1. un coach au rôle validé (private.is_coach) ;
--  2. qui n'a JAMAIS eu d'abonnement coach (journal private.coach_sub_seen, rempli par un déclencheur sur
--     entitlement_claims et à la migration : une souscription Apple change de produit sur place, la ligne
--     de entitlement_claims ne garde donc pas la trace d'un ancien palier coach) ;
--  3. que StoreKit dit NON éligible à l'offre de lancement (l'app le transmet ; s'il y a droit, il prend
--     l'essai de lancement normal, sans signature) ;
--  4. une seule fois par compte : dès qu'une transaction coach arrive (offre utilisée ou non), le point 2
--     ferme la porte pour toujours. En attendant, au plus 5 signatures par 24 h et 10 en tout
--     (une signature ne sert qu'à un achat, même raté : il faut pouvoir réessayer, pas à l'infini).
--
--  Tables (RLS fermée, aucun GRANT) :
--  - public.coach_promo_offers : une ligne par compte qui a demandé l'offre (produit, offre, dates,
--    nombre de signatures, première transaction coach vue = redeemed_at).
--  - private.coach_sub_seen : comptes qui ont eu un abonnement coach (date, produit).
--  RPC :
--  - public.coach_promo_state() (authenticated) → { eligible, reason } : reason ∈ not_coach, had_coach,
--    too_many, null. Lecture seule : l'app s'en sert pour afficher « 2 mois offerts ».
--  - public.srv_coach_promo_grant(p_user, p_product, p_intro_eligible) (service_role, fonction Edge) →
--    { ok, error, offer_id } ; error ∈ unknown_product, not_coach, intro_eligible, had_coach, too_many,
--    rate_limited. Un refus n'est pas une exception (le compteur doit rester écrit).
-- ═══════════════════════════════════════════════════════════

-- ── Produits coach ───────────────────────────────────────
-- Liste fermée (les identifiants ne changent pas avec la grille du 17/11)
create function private.coach_promo_product(product_id text) returns boolean
  language sql immutable set search_path = '' as
$$ select product_id in (
     'com.mdlf.training.coach10.monthly',  'com.mdlf.training.coach10.yearly',
     'com.mdlf.training.coach20.monthly',  'com.mdlf.training.coach20.yearly',
     'com.mdlf.training.coach30.monthly',  'com.mdlf.training.coach30.yearly',
     'com.mdlf.training.coachmax.monthly', 'com.mdlf.training.coachmax.yearly') $$;

-- Identifiant de l'offre promotionnelle dans App Store Connect (offerCode, unique dans l'app)
create function private.coach_promo_offer_id(product_id text) returns text
  language sql immutable set search_path = '' as
$$ select product_id || '.essai2mois' $$;

-- ── A eu un abonnement coach ─────────────────────────────
create table private.coach_sub_seen (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  product_id text not null,
  seen_at    timestamptz not null default now()
);
alter table private.coach_sub_seen enable row level security;
revoke all on private.coach_sub_seen from public, anon, authenticated, service_role;

-- Ce qui est déjà connu : abonnements coach en place, et anciens paliers coach du journal des descentes
insert into private.coach_sub_seen (user_id, product_id, seen_at)
  select distinct on (c.user_id) c.user_id, c.product_id, c.created_at
    from public.entitlement_claims c
   where c.user_id is not null and private.coach_promo_product(c.product_id)
   order by c.user_id, c.created_at
on conflict do nothing;
insert into private.coach_sub_seen (user_id, product_id, seen_at)
  select distinct on (g.coach_id) g.coach_id, 'coach_tier_log', g.changed_at
    from private.coach_tier_log g
   order by g.coach_id, g.changed_at
on conflict do nothing;

-- ── Demandes d'offre ─────────────────────────────────────
create table public.coach_promo_offers (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  product_id              text not null,
  offer_id                text not null,
  first_signed_at         timestamptz not null default now(),
  last_signed_at          timestamptz not null default now(),
  signatures              int not null default 1 check (signatures between 1 and 10),
  redeemed_at             timestamptz,
  redeemed_product        text
);
alter table public.coach_promo_offers enable row level security;
-- Aucune politique : RLS fermée, aucune lecture par l'API (défense en profondeur, en plus des GRANT)
revoke all on public.coach_promo_offers from public, anon, authenticated, service_role;

-- Une transaction coach arrive (achat, montée de palier, notification) : le compte a eu un abonnement
-- coach, et s'il avait demandé l'offre, on note quand (offre utilisée ou achat au prix normal : Apple seul
-- le sait, la transaction porte offerType 2 ; la trace suffit à fermer la porte).
create function private.coach_promo_seen_claim() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if new.user_id is not null and private.coach_promo_product(new.product_id) then
    insert into private.coach_sub_seen (user_id, product_id) values (new.user_id, new.product_id)
      on conflict do nothing;
    update public.coach_promo_offers o set redeemed_at = now(), redeemed_product = new.product_id
     where o.user_id = new.user_id and o.redeemed_at is null;
  end if;
  return null;
end
$$;
create trigger entitlement_claims_coach_promo after insert or update of product_id, user_id on public.entitlement_claims
  for each row execute function private.coach_promo_seen_claim();

-- ── Règle ────────────────────────────────────────────────
-- null : droit à l'offre ; sinon la raison du refus (hors éligibilité de lancement, que seul StoreKit connaît)
create function private.coach_promo_refusal(uid uuid) returns text
  language sql stable security definer set search_path = '' as
$$
  select case
    when not private.is_coach(uid) then 'not_coach'
    when exists (select 1 from private.coach_sub_seen s where s.user_id = uid) then 'had_coach'
    when exists (select 1 from public.coach_promo_offers o where o.user_id = uid and o.signatures >= 10) then 'too_many'
  end
$$;

-- L'app : afficher « 2 mois offerts » ? (lecture seule, ne signe rien)
create function public.coach_promo_state() returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  me  uuid := (select auth.uid());
  why text;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  why := private.coach_promo_refusal(me);
  return jsonb_build_object('eligible', why is null, 'reason', why);
end
$$;

-- La fonction Edge, avant de signer : droit vérifié, signature comptée. Refus dans error (pas d'exception :
-- Postgres annulerait le comptage). rate_limited : plus de 5 signatures en 24 h.
create function public.srv_coach_promo_grant(p_user uuid, p_product text, p_intro_eligible boolean) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  why  text;
  n24  int;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not private.coach_promo_product(p_product) then
    return jsonb_build_object('ok', false, 'error', 'unknown_product');
  end if;
  -- Une demande à la fois par compte : deux appareils en même temps ne dépassent pas les plafonds
  perform pg_advisory_xact_lock(hashtextextended('coach_promo:' || p_user::text, 0));
  why := private.coach_promo_refusal(p_user);
  if why is null and p_intro_eligible is distinct from false then why := 'intro_eligible'; end if;
  if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  -- Débit : 5 signatures par 24 h (une signature sert à un seul achat, réussi ou non)
  delete from private.social_rate r where r.user_id = p_user and r.action = 'coach_promo' and r.at < now() - interval '24 hours';
  n24 := (select count(*) from private.social_rate r where r.user_id = p_user and r.action = 'coach_promo');
  if n24 >= 5 then return jsonb_build_object('ok', false, 'error', 'rate_limited'); end if;
  insert into private.social_rate (user_id, action) values (p_user, 'coach_promo');
  insert into public.coach_promo_offers (user_id, product_id, offer_id)
    values (p_user, p_product, private.coach_promo_offer_id(p_product))
  on conflict (user_id) do update
    set product_id = excluded.product_id, offer_id = excluded.offer_id,
        last_signed_at = now(), signatures = public.coach_promo_offers.signatures + 1;
  return jsonb_build_object('ok', true, 'offer_id', private.coach_promo_offer_id(p_product));
end
$$;

-- Vue d'administration (éditeur SQL seulement) : qui a demandé l'offre, combien de fois, utilisée ou non
create view private.coach_promo_admin as
  select o.user_id, p.username, o.product_id, o.signatures, o.first_signed_at, o.last_signed_at,
         o.redeemed_at, o.redeemed_product
    from public.coach_promo_offers o left join public.user_profiles p using (user_id);
revoke all on private.coach_promo_admin from public, anon, authenticated, service_role;

revoke all on function private.coach_promo_product(text), private.coach_promo_offer_id(text),
  private.coach_promo_seen_claim(), private.coach_promo_refusal(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.coach_promo_state() from public, anon, authenticated, service_role;
revoke all on function public.srv_coach_promo_grant(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.coach_promo_state() to authenticated;
grant execute on function public.srv_coach_promo_grant(uuid, text, boolean) to service_role;
