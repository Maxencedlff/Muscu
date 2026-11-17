-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261117040000_promo_coach.sql (à lancer à la main, dans
--  l'éditeur SQL, sur décision de Maxence). Pas dans migrations/ : Supabase ne l'applique jamais de
--  lui-même. Aucune migration plus récente ne dépend de ce fichier.
--
--  Avant : supprimer (ou ne plus déployer) la fonction Edge coach-promo-offer
--  (`supabase functions delete coach-promo-offer`) ; l'app retombe d'elle-même sur l'achat normal
--  (coach_promo_state absente = pas d'offre). Les offres promotionnelles d'App Store Connect peuvent
--  rester : sans signature du serveur, personne ne peut les utiliser.
--
--  Effet : le déclencheur, les fonctions, la vue et les deux tables disparaissent. Les demandes d'offre
--  sont mises de côté dans private.promo_coach_archive_offers et les comptes qui ont eu un abonnement
--  coach dans private.promo_coach_archive_sub_seen (aucun rôle de l'API n'y a accès ; à effacer à la main
--  quand ils ne servent plus). Aucun abonnement, aucun accès ni aucune séance n'est touché.
-- ═══════════════════════════════════════════════════════════

begin;

create table private.promo_coach_archive_offers as table public.coach_promo_offers;
create table private.promo_coach_archive_sub_seen as table private.coach_sub_seen;
revoke all on private.promo_coach_archive_offers, private.promo_coach_archive_sub_seen
  from public, anon, authenticated, service_role;

drop trigger entitlement_claims_coach_promo on public.entitlement_claims;
drop function public.srv_coach_promo_grant(uuid, text, boolean);
drop function public.coach_promo_state();
drop view private.coach_promo_admin;
drop function private.coach_promo_refusal(uuid);
drop function private.coach_promo_seen_claim();
drop table public.coach_promo_offers;
drop table private.coach_sub_seen;
drop function private.coach_promo_offer_id(text);
drop function private.coach_promo_product(text);
-- Journal des débits : les lignes de cette action seulement
delete from private.social_rate where action = 'coach_promo';

commit;
