-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031000000_payant_plus.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide d'annuler l'accès à vie et la révocation des codes).
--  Pas dans migrations/ : Supabase ne l'applique jamais de lui-même. Vérifié par
--  tests/sql/rollback_payant_plus.sh (migrations, retour arrière, puis les tests des tarifs).
--
--  Effet :
--  - les achats à vie (entitlement_claims kind 'life') sont MIS DE CÔTÉ dans
--    private.payant_plus_life_claims puis retirés du registre : leurs détenteurs perdent l'accès tant
--    que l'app et le serveur ne connaissent plus ce produit (à compenser par un code cadeau à vie :
--    select private.make_gift_code('lifetime', null, 1, 'ex achat à vie');) ;
--  - les accès à vie offerts RETIRÉS (gift_redemptions.revoked_at) sont mis de côté dans
--    private.payant_plus_revoked_redemptions puis supprimés : sans cela, la suppression de la colonne
--    les ferait revivre ;
--  - les codes désactivés (gift_codes.revoked_at) sont expirés (expires_at = maintenant) avant la
--    suppression de la colonne, pour rester inutilisables ;
--  - access_product_kind, access_claim, srv_access_event, access_refresh, access_json et redeem_gift_code reprennent
--    leur texte de 20261030000000_payant_tarifs.sql et 20261029000000_payant_modele_b.sql ;
--  - grant_lifetime, revoke_lifetime, revoke_gift_code, access_life_test_days et la vue
--    private.lifetime_access disparaissent. Les instantanés sont recalculés.
--  Après le retour arrière, l'app doit revenir à une version sans l'achat à vie (le module natif le
--  proposerait encore, le serveur le refuserait : unknown_product).
-- ═══════════════════════════════════════════════════════════

begin;

create table private.payant_plus_life_claims as
  select * from public.entitlement_claims where kind = 'life';
revoke all on private.payant_plus_life_claims from public, anon, authenticated, service_role;
create table private.payant_plus_revoked_redemptions as
  select * from public.gift_redemptions where revoked_at is not null;
revoke all on private.payant_plus_revoked_redemptions from public, anon, authenticated, service_role;

update public.entitlements t set original_transaction_id = null
 where t.original_transaction_id in (select c.original_transaction_id from private.payant_plus_life_claims c);
delete from public.entitlement_claims where kind = 'life';
delete from public.gift_redemptions where revoked_at is not null;
update public.gift_codes set expires_at = least(coalesce(expires_at, revoked_at), revoked_at) where revoked_at is not null;

drop view private.lifetime_access;
drop function private.grant_lifetime(uuid, text);
drop function private.revoke_lifetime(uuid, text);
drop function private.revoke_gift_code(text, text);

alter table public.gift_redemptions drop column revoked_at;
alter table public.gift_redemptions drop column revoke_reason;
alter table public.gift_codes drop column revoked_at;
alter table public.gift_codes drop column revoke_reason;

alter table public.entitlement_claims drop constraint entitlement_claims_kind_check;
alter table public.entitlement_claims add constraint entitlement_claims_kind_check check (kind = 'sub');

-- Textes d'origine (20261030000000_payant_tarifs.sql)
create or replace function private.access_product_kind(product_id text) returns text
  language sql immutable set search_path = '' as
$$
  select case product_id
    when 'com.mdlf.training.pro.monthly'        then 'sub'
    when 'com.mdlf.training.pro.yearly'         then 'sub'
    when 'com.mdlf.training.coach10.monthly'    then 'sub'
    when 'com.mdlf.training.coach10.yearly'     then 'sub'
    when 'com.mdlf.training.coach20.monthly'    then 'sub'
    when 'com.mdlf.training.coach20.yearly'     then 'sub'
    when 'com.mdlf.training.coach30.monthly'    then 'sub'
    when 'com.mdlf.training.coach30.yearly'     then 'sub'
    when 'com.mdlf.training.coachmax.monthly'   then 'sub'
    when 'com.mdlf.training.coachmax.yearly'    then 'sub'
  end
$$;

create or replace function private.access_refresh(uid uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  sub_tx    text;
  sub_prod  text;
  sub_until timestamptz;
begin
  select c.original_transaction_id, c.product_id, c.expires_at into sub_tx, sub_prod, sub_until
    from public.entitlement_claims c
    where c.user_id = uid and c.revoked_at is null and c.expires_at is not null
    order by c.expires_at desc, c.original_transaction_id limit 1;
  insert into public.entitlements (user_id, status) values (uid, 'none') on conflict (user_id) do nothing;
  update public.entitlements t set
    gift                    = exists (select 1 from public.gift_redemptions r
                                       join public.gift_codes k on k.code = r.code
                                       where r.user_id = uid and k.kind = 'lifetime'),
    product_id              = sub_prod,
    expires_at              = greatest(sub_until, t.gift_until),
    original_transaction_id = sub_tx,
    updated_at              = now()
  where t.user_id = uid;
  update public.entitlements t set
    status        = private.access_json(uid) ->> 'status',
    in_coach_team = false
  where t.user_id = uid;
end
$$;

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

-- Textes d'origine (20261029000000_payant_modele_b.sql) : access_claim et srv_access_event sans
-- p_reinstate (le payant plus les avait recréées avec ce paramètre en plus)
drop function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text, boolean);
drop function private.access_claim(uuid, text, timestamptz, text, boolean, timestamptz, boolean, boolean, text, boolean);
create function private.access_claim(p_user uuid, p_product text, p_expires timestamptz,
                                     p_original_tx text, p_revoked boolean,
                                     p_event_at timestamptz default null,
                                     p_force boolean default false,
                                     p_intro boolean default null,
                                     p_environment text default null) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  k        text := private.access_product_kind(p_product);
  cur      public.entitlement_claims;
  new_end  timestamptz := case when k = 'sub' then p_expires end;
  env      text := case when p_environment in ('Production', 'Sandbox') then p_environment end;
  reopen   boolean := false;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_original_tx is null or char_length(p_original_tx) not between 1 and 64 then
    raise exception 'invalid_transaction' using errcode = 'P0001';
  end if;
  if k is null then
    raise exception 'unknown_product' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('access_tx:' || p_original_tx, 0));
  select * into cur from public.entitlement_claims c where c.original_transaction_id = p_original_tx;
  if cur.user_id is not null and cur.user_id <> p_user then
    raise exception 'transaction_taken' using errcode = 'P0001';
  end if;

  if cur.user_id is null then
    begin
      insert into public.entitlement_claims
          (original_transaction_id, user_id, product_id, kind, expires_at, revoked_at, event_at, intro_offer, environment)
        values (p_original_tx, p_user, p_product, k, new_end,
                case when p_revoked then now() end, p_event_at, coalesce(p_intro, false), env);
    exception when unique_violation then
      raise exception 'transaction_taken' using errcode = 'P0001';
    end;
  -- Règle 1 : un évènement plus ancien que le dernier appliqué ne touche à rien
  elsif cur.event_at is null or p_event_at is null or p_event_at >= cur.event_at then
    -- Règle 4 : réabonnement réel = évènement plus récent ET période strictement plus lointaine
    reopen := cur.revoked_at is not null and not p_revoked
              and new_end is not null and (cur.expires_at is null or new_end > cur.expires_at)
              and cur.event_at is not null and p_event_at is not null and p_event_at > cur.event_at;
    update public.entitlement_claims c set
      product_id  = p_product,
      kind        = k,
      expires_at  = case
                      when p_revoked or p_force or reopen then new_end
                      when cur.revoked_at is not null then cur.expires_at
                      else greatest(cur.expires_at, new_end)
                    end,
      revoked_at  = case
                      when reopen then null
                      when p_revoked then coalesce(cur.revoked_at, now())
                      else cur.revoked_at
                    end,
      event_at    = greatest(cur.event_at, p_event_at),
      intro_offer = coalesce(p_intro, cur.intro_offer),
      environment = coalesce(env, cur.environment),
      updated_at  = now()
    where c.original_transaction_id = p_original_tx;
  end if;
  perform private.access_refresh(p_user);
  return private.access_json(p_user);
end
$$;

create function public.srv_access_event(p_original_tx text, p_product text, p_expires timestamptz,
                                        p_revoked boolean default false,
                                        p_event_at timestamptz default null,
                                        p_force boolean default false,
                                        p_uuid text default null,
                                        p_account_token text default null,
                                        p_intro boolean default null,
                                        p_environment text default null)
  returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare owner uuid;
begin
  if p_uuid is not null and char_length(p_uuid) between 1 and 64 then
    insert into public.appstore_notifications (notification_uuid) values (p_uuid) on conflict do nothing;
    if not found then
      return jsonb_build_object('matched', false, 'duplicate', true);
    end if;
    delete from public.appstore_notifications n where n.at < now() - interval '30 days';
  end if;
  if p_original_tx is null or private.access_product_kind(p_product) is null then
    return jsonb_build_object('matched', false, 'duplicate', false);
  end if;
  select c.user_id into owner from public.entitlement_claims c
    where c.original_transaction_id = p_original_tx;
  if owner is null and p_account_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select u.id into owner from auth.users u where u.id = p_account_token::uuid;
  end if;
  if owner is null then
    return jsonb_build_object('matched', false, 'duplicate', false);
  end if;
  perform private.access_claim(owner, p_product, p_expires, p_original_tx,
                               coalesce(p_revoked, false), p_event_at, coalesce(p_force, false),
                               p_intro, p_environment);
  return jsonb_build_object('matched', true, 'duplicate', false,
                            'user_id', owner, 'access', private.access_json(owner));
end
$$;

create or replace function public.redeem_gift_code(code text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  c  text := private.gift_code_norm(redeem_gift_code.code);
  g  public.gift_codes;
begin
  if me is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  insert into public.entitlements (user_id, status) values (me, 'none') on conflict (user_id) do nothing;
  -- L'essai est compté AVANT toute vérification, et le restera : la suite ne lève plus rien
  perform private.rate_limit_window(me, 'gift_code', 10, interval '1 hour');
  if c is null then
    return private.gift_refused(me, 'invalid_code');
  end if;
  select * into g from public.gift_codes k where k.code = c for update;
  if not found then
    return private.gift_refused(me, 'invalid_code');
  end if;
  if g.expires_at is not null and g.expires_at <= now() then
    return private.gift_refused(me, 'code_expired');
  end if;
  if exists (select 1 from public.gift_redemptions r where r.code = c and r.user_id = me) then
    return private.gift_refused(me, 'already_redeemed');
  end if;
  if g.uses >= g.max_uses then
    return private.gift_refused(me, 'code_used_up');
  end if;
  insert into public.gift_redemptions (code, user_id) values (c, me);
  update public.gift_codes k set uses = k.uses + 1 where k.code = c;
  if g.kind = 'days' then
    update public.entitlements t set
      gift_until = greatest(now(), coalesce(t.expires_at, now())) + make_interval(days => g.days),
      updated_at = now()
    where t.user_id = me;
  end if;
  perform private.access_refresh(me);
  return jsonb_build_object('ok', true, 'error', null, 'kind', g.kind, 'access', private.access_json(me));
end
$$;

drop function private.access_life_test_days();

revoke all on function private.access_claim(uuid, text, timestamptz, text, boolean, timestamptz, boolean, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text) to service_role;
revoke all on function private.access_refresh(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public.redeem_gift_code(text) from public, anon, authenticated;
grant execute on function public.redeem_gift_code(text) to authenticated;

do $refresh$
declare u uuid;
begin
  for u in select t.user_id from public.entitlements t loop
    perform private.access_refresh(u);
  end loop;
end
$refresh$;

commit;
