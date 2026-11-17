-- ═══════════════════════════════════════════════════════════
--  Payant V1, NOUVELLE GRILLE COACH (décision de Maxence du 17/11/2026, contrat : docs/PAYANT_V1.md,
--  « Tarifs »). Après 20261116030000_eleves_gratuits.sql (qui réécrit coach_tier_state). Rien de ce
--  fichier n'est appliqué en production sans le feu vert de Maxence.
--  Retour arrière : supabase/rollback/20261117030000_grille_coach_down.sql.
--
--  Les identifiants des produits Apple ne changent pas, seules les limites (et les prix, réglés dans App
--  Store Connect, jamais ici) :
--    coach10  : 10 élèves (inchangé)
--    coach20  : 25 élèves (au lieu de 20)
--    coach30  : 50 élèves (au lieu de 30)
--    coachmax : 100 élèves (au lieu d'illimité). Au-delà, pas d'achat : l'app dit « Plus de 100 élèves :
--               écris-nous à contact@mdlf.app » (clé contact de coach_tier_state).
--  Tout ce qui lit une limite passe par private.coach_product_limit : le palier payé (coach_paid_limit),
--  la limite d'élèves (coach_student_limit, inchangée : verrou éteint, au moins 50 comme avant ; verrou
--  allumé, le palier payé), le refus tier_full de coach_join, les élèves offerts et leur grâce
--  (coach_cover, journal coach_tier_log). Un coach qui suit déjà plus d'élèves que sa nouvelle limite les
--  garde tous (aucun lien supprimé) ; les élèves au-delà ne sont plus offerts (over_limit, comme une
--  descente de palier, sans grâce : ce n'est pas le coach qui a changé de formule).
-- ═══════════════════════════════════════════════════════════

create or replace function private.coach_product_limit(product_id text) returns int
  language sql immutable set search_path = '' as
$$
  select case product_id
    when 'com.mdlf.training.coach10.monthly'  then 10
    when 'com.mdlf.training.coach10.yearly'   then 10
    when 'com.mdlf.training.coach20.monthly'  then 25
    when 'com.mdlf.training.coach20.yearly'   then 25
    when 'com.mdlf.training.coach30.monthly'  then 50
    when 'com.mdlf.training.coach30.yearly'   then 50
    when 'com.mdlf.training.coachmax.monthly' then 100
    when 'com.mdlf.training.coachmax.yearly'  then 100
  end
$$;

-- Comme 20261116030000_eleves_gratuits.sql, avec la grille du 17/11 : palier suivant à 25, 50 et 100 élèves ;
-- plus de palier illimité (limit toujours un nombre) ; contact : 100 élèves atteints au plus haut palier (ou
-- verrou éteint), aucun palier au-dessus, l'app propose d'écrire à contact@mdlf.app.
create or replace function public.coach_tier_state() returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  me   uuid := (select auth.uid());
  lim  int;
  paid int;
  n    int;
  prod text;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  lim  := private.coach_student_limit(me);
  paid := private.coach_paid_limit(me);
  n    := (select count(*)::int from public.coach_links l where l.coach_id = me);
  select c.product_id into prod from public.entitlement_claims c
   where c.user_id = me and c.revoked_at is null and c.expires_at > now()
     and private.coach_product_limit(c.product_id) is not null
   order by private.coach_product_limit(c.product_id) desc, c.expires_at desc limit 1;
  return jsonb_build_object(
    'is_coach',     private.is_coach(me),
    'paywall_on',   private.access_paywall_on(),
    'product_id',   prod,
    'limit',        lim,
    'students',     n,
    'full',         private.is_coach(me) and n >= lim,
    'uncovered',    case when not private.is_coach(me) then 0 else greatest(n - coalesce(paid, 0), 0) end,
    'next_product', case
                      when paid is null then 'com.mdlf.training.coach10.monthly'
                      when paid < 25 then 'com.mdlf.training.coach20.monthly'
                      when paid < 50 then 'com.mdlf.training.coach30.monthly'
                      when paid < 100 then 'com.mdlf.training.coachmax.monthly'
                    end,
    'contact',      private.is_coach(me) and n >= 100 and coalesce(paid, 0) >= 100);
end
$$;

revoke all on function private.coach_product_limit(text) from public, anon, authenticated, service_role;
revoke all on function public.coach_tier_state() from public, anon, authenticated;
grant execute on function public.coach_tier_state() to authenticated;
