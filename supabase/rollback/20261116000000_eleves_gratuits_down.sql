-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261116000000_eleves_gratuits.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide de revenir aux tarifs du 30/10 : élève payant, −25 %
--  pendant 12 mois par code d'offre Apple). Pas dans migrations/ : Supabase ne l'applique jamais de
--  lui-même. Aucune migration plus récente ne dépend de ce fichier.
--
--  Avant : revenir à une version de l'app qui connaît l'offre élève (student_offer_code), et
--  réactiver dans App Store Connect le code d'offre « Eleve de coach -25 pct 12 mois ».
--
--  Effet :
--  - private.access_json et public.coach_tier_state reprennent leur texte de
--    20261030000000_payant_tarifs.sql, public.student_offer_code revient (même texte, mêmes droits) ;
--  - les élèves offerts par leur coach perdent cet accès (statut recalculé : none, expired ou leur
--    propre abonnement) ; rien n'est supprimé de leurs séances ;
--  - private.coach_cover, private.coach_cover_grace, le déclencheur entitlement_claims_tier_log et le
--    journal private.coach_tier_log (descentes de palier des 30 derniers jours) disparaissent.
-- ═══════════════════════════════════════════════════════════

begin;

drop trigger entitlement_claims_tier_log on public.entitlement_claims;
drop function private.coach_tier_log_claim();
drop table private.coach_tier_log;

-- ── Textes d'origine (20261030000000_payant_tarifs.sql) ─
create or replace function private.access_json(uid uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  srv_now   timestamptz := now();
  paywall   boolean := private.access_paywall_on();
  e         public.entitlements;
  started   boolean;
  life      boolean;
  gift_at   timestamptz;
  has_gift  boolean;
  paid      timestamptz;
  intro     boolean := false;
  intro_end timestamptz;
  last_end  timestamptz;
  st        text;
  until_at  timestamptz;
begin
  if uid is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into e from public.entitlements t where t.user_id = uid;
  started := found;
  life := started and e.gift;
  gift_at := case when started then e.gift_until end;
  has_gift := life or (gift_at is not null and gift_at > srv_now);
  paid := case when started then e.expires_at end;
  select max(least(c.expires_at, coalesce(c.revoked_at, c.expires_at))) into last_end
    from public.entitlement_claims c where c.user_id = uid;

  if has_gift then st := 'gift';
  elsif paid is not null and paid > srv_now then st := 'active';
  elsif paid is not null or gift_at is not null or last_end is not null then st := 'expired';
  else st := 'none';
  end if;

  if st = 'active' then
    select c.intro_offer, c.expires_at into intro, intro_end
      from public.entitlement_claims c
     where c.user_id = uid and c.revoked_at is null and c.expires_at > srv_now
     order by c.expires_at desc, c.original_transaction_id limit 1;
    intro := coalesce(intro, false);
  end if;

  until_at := case
    when st = 'gift'    then case when life then null else paid end
    when st = 'active'  then paid
    when st = 'expired' then greatest(paid, gift_at, last_end)
  end;

  return jsonb_build_object(
    'status',      st,
    'until',       until_at,
    'paywall_on',  paywall,
    'days_left',   case when st in ('active', 'gift') and until_at is not null
                        then greatest(ceil(extract(epoch from until_at - srv_now) / 86400)::int, 0) end,
    'can_write',   (not paywall) or st in ('active', 'gift'),
    'gift',        has_gift,
    'gift_until',  case when life then null else gift_at end,
    'coach_team',  false,
    'intro_offer', intro,
    'intro_until', case when intro then intro_end end,
    'server_now',  srv_now
  );
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
    'next_product', case
                      when paid is null then 'com.mdlf.training.coach10.monthly'
                      when paid < 20 then 'com.mdlf.training.coach20.monthly'
                      when paid < 30 then 'com.mdlf.training.coach30.monthly'
                      when paid < 2147483647 then 'com.mdlf.training.coachmax.monthly'
                    end);
end
$$;

create function public.student_offer_code(env text default 'Production') returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me    uuid := (select auth.uid());
  e     text := case when student_offer_code.env = 'Sandbox' then 'Sandbox' else 'Production' end;
  coach uuid;
  k     public.coach_offer_codes;
  fail  jsonb := jsonb_build_object('ok', false, 'code', null, 'expires_at', null, 'coach', null);
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform private.rate_limit_window(me, 'offer_code', 20, interval '24 hours');
  select l.coach_id into coach from public.coach_links l where l.student_id = me and private.is_coach(l.coach_id);
  if coach is null then
    return fail || jsonb_build_object('error', 'not_student');
  end if;
  if exists (select 1 from public.entitlement_claims c where c.user_id = me)
     or exists (select 1 from public.entitlements t where t.user_id = me and (t.gift or t.gift_until is not null)) then
    return fail || jsonb_build_object('error', 'not_new');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('offer_code:' || me::text, 0));
  select * into k from public.coach_offer_codes o
   where o.assigned_to = me and o.environment = e and o.expires_at > now() + interval '1 day'
   order by o.assigned_at desc limit 1;
  if k.code is null then
    if (select count(*) from public.coach_offer_codes o where o.assigned_to = me) >= 3 then
      return fail || jsonb_build_object('error', 'no_code');
    end if;
    select * into k from public.coach_offer_codes o
     where o.assigned_at is null and o.environment = e and o.expires_at > now() + interval '7 days'
     order by o.expires_at, o.code limit 1 for update skip locked;
    if k.code is null then
      return fail || jsonb_build_object('error', 'no_code');
    end if;
    update public.coach_offer_codes o set assigned_to = me, coach_id = coach, assigned_at = now()
     where o.code = k.code;
  end if;
  return jsonb_build_object('ok', true, 'error', null, 'code', k.code, 'expires_at', k.expires_at,
                            'coach', private.person(coach, null));
end
$$;

drop function private.coach_cover(uuid);
drop function private.coach_cover_grace();

revoke all on function private.access_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public.coach_tier_state() from public, anon, authenticated;
revoke all on function public.student_offer_code(text) from public, anon, authenticated;
grant execute on function public.coach_tier_state() to authenticated;
grant execute on function public.student_offer_code(text) to authenticated;

-- Instantanés des élèves recalculés (lignes existantes seulement)
do $refresh$
declare u uuid;
begin
  for u in select e.user_id from public.entitlements e join public.coach_links l on l.student_id = e.user_id loop
    perform private.access_refresh(u);
  end loop;
end
$refresh$;

commit;
