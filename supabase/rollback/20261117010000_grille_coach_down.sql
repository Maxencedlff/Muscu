-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261117010000_grille_coach.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence revient à la grille du 30/10 : 10, 20, 30 élèves, illimité).
--  Pas dans migrations/ : Supabase ne l'applique jamais de lui-même. Remet le texte exact de
--  private.coach_product_limit (20261030000000_payant_tarifs.sql) et de public.coach_tier_state
--  (20261116030000_eleves_gratuits.sql). Aucune donnée touchée. Les prix d'App Store Connect se
--  remettent à part.
-- ═══════════════════════════════════════════════════════════
begin;

-- Nombre d'élèves d'un produit coach (2147483647 : illimité) ; null pour un autre produit
create or replace function private.coach_product_limit(product_id text) returns int
  language sql immutable set search_path = '' as
$$
  select case product_id
    when 'com.mdlf.training.coach10.monthly'  then 10
    when 'com.mdlf.training.coach10.yearly'   then 10
    when 'com.mdlf.training.coach20.monthly'  then 20
    when 'com.mdlf.training.coach20.yearly'   then 20
    when 'com.mdlf.training.coach30.monthly'  then 30
    when 'com.mdlf.training.coach30.yearly'   then 30
    when 'com.mdlf.training.coachmax.monthly' then 2147483647
    when 'com.mdlf.training.coachmax.yearly'  then 2147483647
  end
$$;

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
    'limit',        case when lim >= 2147483647 then null else lim end,
    'students',     n,
    'full',         private.is_coach(me) and lim < 2147483647 and n >= lim,
    'uncovered',    case when not private.is_coach(me) then 0 else greatest(n - coalesce(paid, 0), 0) end,
    'next_product', case
                      when paid is null then 'com.mdlf.training.coach10.monthly'
                      when paid < 20 then 'com.mdlf.training.coach20.monthly'
                      when paid < 30 then 'com.mdlf.training.coach30.monthly'
                      when paid < 2147483647 then 'com.mdlf.training.coachmax.monthly'
                    end);
end
$$;

revoke all on function private.coach_product_limit(text) from public, anon, authenticated, service_role;
revoke all on function public.coach_tier_state() from public, anon, authenticated;
grant execute on function public.coach_tier_state() to authenticated;

commit;
