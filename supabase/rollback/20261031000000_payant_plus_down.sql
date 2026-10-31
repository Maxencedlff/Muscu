-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031000000_payant_plus.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide d'annuler la révocation des accès à vie offerts).
--  Pas dans migrations/ : Supabase ne l'applique jamais de lui-même. Vérifié par
--  tests/sql/rollback_payant_plus.sh (migrations, retour arrière, puis les tests des tarifs).
--
--  Effet :
--  - les accès à vie offerts RETIRÉS (gift_redemptions.revoked_at) sont mis de côté dans
--    private.payant_plus_revoked_redemptions puis supprimés : sans cela, la suppression de la colonne
--    les ferait revivre ;
--  - les codes désactivés (gift_codes.revoked_at) sont expirés (expires_at = maintenant) avant la
--    suppression de la colonne, pour rester inutilisables ;
--  - access_refresh et redeem_gift_code reprennent leur texte de 20261030000000_payant_tarifs.sql et
--    20261029000000_payant_modele_b.sql ;
--  - grant_lifetime, revoke_lifetime, revoke_gift_code et la vue private.lifetime_access
--    disparaissent. Les instantanés sont recalculés.
--  Les accès à vie offerts encore valables restent (codes kind 'lifetime').
-- ═══════════════════════════════════════════════════════════

begin;

create table private.payant_plus_revoked_redemptions as
  select * from public.gift_redemptions where revoked_at is not null;
revoke all on private.payant_plus_revoked_redemptions from public, anon, authenticated, service_role;

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

-- Textes d'origine (20261030000000_payant_tarifs.sql, 20261029000000_payant_modele_b.sql)
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

revoke all on function private.access_refresh(uuid) from public, anon, authenticated, service_role;
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
