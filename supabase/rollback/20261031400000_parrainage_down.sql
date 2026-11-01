-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031400000_parrainage.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide de retirer le parrainage). Pas dans migrations/ :
--  Supabase ne l'applique jamais de lui-même.
--
--  Avant : revenir à une version de l'app qui n'appelle plus referral_state ni referral_apply, et
--  arrêter tools/rapport-parrainage.mjs (referral_report n'existera plus). Sortir le dernier rapport
--  (select * from public.referral_report();) pour payer ce qui reste dû.
--
--  Effet :
--  - les attributions et les virements, qui servent à calculer et prouver les commissions, sont MIS DE
--    CÔTÉ dans private.parrainage_archive_attributions, private.parrainage_archive_payouts,
--    private.parrainage_archive_partners et private.parrainage_archive_coach_terms (aucun rôle de
--    l'API n'y a accès), puis les quatre tables referral_* sont supprimées. Les archives ne sont pas
--    effacées par ce script : les supprimer à la main une fois les comptes soldés ;
--  - le déclencheur coach_links_referral et toutes les fonctions referral_* disparaissent : rejoindre
--    un coach n'attribue plus rien. Aucune colonne d'une autre table n'avait changé.
--  - les lignes « referral_try » du journal private.social_rate sont retirées.
--
--  Ordre : APRÈS 20261101000000_parrainage_payant_down.sql (la table des paiements référence
--  referral_attributions) ; ce script s'arrête sans rien changer tant qu'elle est en place. Indépendant
--  des autres migrations postérieures (vérifié par tests/sql/rollback_nuit_check.sh).
-- ═══════════════════════════════════════════════════════════

begin;

do $garde$
begin
  if to_regclass('public.subscription_payments') is not null then
    raise exception 'parrainage du payant encore en place : lancer d''abord supabase/rollback/20261101000000_parrainage_payant_down.sql';
  end if;
end
$garde$;

create table private.parrainage_archive_partners as select * from public.referral_partners;
create table private.parrainage_archive_coach_terms as select * from public.referral_coach_terms;
create table private.parrainage_archive_attributions as select * from public.referral_attributions;
create table private.parrainage_archive_payouts as select * from public.referral_payouts;
revoke all on private.parrainage_archive_partners, private.parrainage_archive_coach_terms,
  private.parrainage_archive_attributions, private.parrainage_archive_payouts
  from public, anon, authenticated, service_role;

drop trigger coach_links_referral on public.coach_links;

drop function public.referral_state();
drop function public.referral_apply(text);
drop function public.referral_report(date, date);
drop function public.referral_for_user(uuid);
drop function private.referral_from_coach_link();
drop function private.referral_attribute_coach(uuid, uuid);
drop function private.referral_state_of(uuid);
drop function private.referral_referrer_of(uuid);
drop function private.referral_resolve_coach_code(text);
drop function private.referral_subscribers(text, text, uuid, date);
drop function private.referral_net_cents(text, text, uuid, date, int);
drop function private.referral_coach_active(uuid, date);
drop function private.make_partner_code(text, text, numeric, int, text, uuid);
drop function private.set_coach_terms(uuid, numeric, int, text);
drop function private.referral_code_norm(text);
drop function private.referral_window();
drop function private.referral_coach_rate();
drop function private.referral_coach_months();
drop function private.referral_payout_min_cents();

drop table public.referral_payouts;
drop table public.referral_attributions;
drop table public.referral_coach_terms;
drop table public.referral_partners;

delete from private.social_rate r where r.action = 'referral_try';

commit;
