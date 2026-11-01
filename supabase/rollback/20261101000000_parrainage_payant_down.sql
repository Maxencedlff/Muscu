-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261101000000_parrainage_payant.sql (à lancer à la main, dans
--  l'éditeur SQL). Pas dans migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Avant : redéployer verify-purchase et appstore-notify dans leur version qui n'appelle pas
--  srv_subscription_payment (sinon chaque achat écrit une erreur dans les journaux, sans rien bloquer :
--  l'accès est écrit avant). Sortir le dernier rapport (select * from public.referral_report();).
--
--  Effet :
--  - les paiements d'Apple notés sont MIS DE CÔTÉ dans private.parrainage_payant_archive_payments
--    (aucun rôle de l'API n'y a accès), puis public.subscription_payments est supprimée ;
--  - les quatre accroches du parrainage reprennent leur version vide de 20261031400000_parrainage.sql
--    (null : « inconnu » dans le rapport) ; les déclencheurs et fonctions ajoutés disparaissent.
--
--  Ordre : à lancer AVANT le retour arrière du parrainage (20261031400000, la table des paiements
--  référence referral_attributions) et avant celui des tarifs (20261030000000, coach_product_limit).
-- ═══════════════════════════════════════════════════════════

begin;

create table private.parrainage_payant_archive_payments as select * from public.subscription_payments;
revoke all on private.parrainage_payant_archive_payments from public, anon, authenticated, service_role;

drop trigger referral_attributions_payments on public.referral_attributions;
drop trigger entitlement_claims_payments on public.entitlement_claims;
drop function public.srv_subscription_payment(text, text, text, text, timestamptz, timestamptz, bigint, text, text, boolean, timestamptz, text);
drop table public.subscription_payments;
drop function private.payment_link();
drop function private.payment_forget();
drop function private.payment_from_claim();
drop function private.payment_from_attribution();

-- Accroches : texte exact de 20261031400000_parrainage.sql
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

drop function private.referral_paid(text, text, uuid, int);
drop function private.payment_net_cents(bigint, text, text);
drop function private.referral_vat_rate(text);
drop function private.referral_apple_rate();

commit;
