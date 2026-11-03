-- ═══════════════════════════════════════════════════════════
--  Payant PLUS (contrat : docs/PAYANT_V1.md, section « Payant plus »). Après
--  20261030000000_payant_tarifs.sql. Rien de ce fichier n'est appliqué en production sans le feu vert
--  de Maxence. Retour arrière : supabase/rollback/20261031000000_payant_plus_down.sql.
--
--  Pas d'achat « à vie » payant : refusé par Maxence le 31/10/2026. Seuls les accès à vie OFFERTS
--  existent (codes maison gift_codes kind 'lifetime' : Maxence, Cyril, testeurs).
--
--  CODES « GRATUIT À VIE » RÉVOCABLES ET TRACÉS. Le système de codes maison existait
--  (gift_codes kind 'lifetime', private.make_gift_code, gift_redemptions = trace de qui a utilisé
--  quel code et quand) mais un accès à vie offert ne se retirait pas. Ajouts :
--  - gift_redemptions.revoked_at / revoke_reason, gift_codes.revoked_at / revoke_reason ;
--  - private.grant_lifetime(user_id, note) : l'administrateur attribue directement un accès à vie
--    à un compte (Maxence, Cyril, testeurs), sans code à transmettre : un code à usage unique est
--    fabriqué au nom du compte et utilisé aussitôt, la trace est celle de tous les codes ;
--  - private.revoke_lifetime(user_id, reason) : retire les accès à vie offerts d'un compte ;
--  - private.revoke_gift_code(code, reason) : désactive un code (plus aucune utilisation) et retire
--    l'accès à vie à ceux qui l'ont utilisé ; les jours déjà offerts par un code 'days' restent
--    (ils ne se recalculent pas, documenté) ;
--  - vue private.lifetime_access : qui a un accès à vie offert, depuis quand, retiré ou non.
--  access_json (my_access, access_state) ne change pas : un accès à vie offert reste le statut 'gift'
--  sans date de fin (until et gift_until à null), comme depuis le 28/10.
--  Aucun code n'est écrit dans ce fichier ni dans le dépôt : ils sont tirés au hasard par la base.
-- ═══════════════════════════════════════════════════════════

-- ── Accès à vie offerts : révocables et tracés ──────────

alter table public.gift_redemptions add column revoked_at timestamptz;
alter table public.gift_redemptions add column revoke_reason text check (char_length(revoke_reason) <= 200);
alter table public.gift_codes add column revoked_at timestamptz;
alter table public.gift_codes add column revoke_reason text check (char_length(revoke_reason) <= 200);

-- Même calcul que 20261030000000_payant_tarifs.sql ; l'accès à vie OFFERT ne compte que les
-- utilisations non retirées
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
                                       where r.user_id = uid and k.kind = 'lifetime' and r.revoked_at is null),
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

-- Code cadeau maison : mêmes règles que 20261029000000_payant_modele_b.sql, et un code désactivé par
-- l'administrateur (revoked_at) est refusé comme un code expiré
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
  if g.revoked_at is not null or (g.expires_at is not null and g.expires_at <= now()) then
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

-- ADMINISTRATION (éditeur SQL, rôle postgres). Accès à vie OFFERT à un compte, sans code à transmettre.
-- Un code à usage unique est tiré au hasard (private.gift_new_code), noté au nom du compte et utilisé
-- aussitôt : même trace que tous les codes (gift_codes.note, gift_redemptions.redeemed_at).
--   select private.grant_lifetime((select user_id from public.user_profiles where username = 'cyril'), 'Cyril, coach partenaire');
-- Renvoie { ok, code, user_id } ; { ok: false, error: 'already_lifetime' } si un accès à vie offert
-- non retiré existe déjà.
create function private.grant_lifetime(uid uuid, note text) returns jsonb
  language plpgsql volatile set search_path = '' as
$$
declare
  c text;
begin
  if uid is null or not exists (select 1 from auth.users u where u.id = uid) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if grant_lifetime.note is null or char_length(btrim(grant_lifetime.note)) not between 2 and 200 then
    raise exception 'invalid_note' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.gift_redemptions r join public.gift_codes k on k.code = r.code
              where r.user_id = uid and k.kind = 'lifetime' and r.revoked_at is null) then
    return jsonb_build_object('ok', false, 'error', 'already_lifetime', 'user_id', uid);
  end if;
  select x into c from private.make_gift_code('lifetime', null, 1, 'attribué : ' || btrim(grant_lifetime.note), null, 1) x limit 1;
  insert into public.gift_redemptions (code, user_id) values (c, uid);
  update public.gift_codes k set uses = k.uses + 1 where k.code = c;
  perform private.access_refresh(uid);
  return jsonb_build_object('ok', true, 'code', c, 'user_id', uid);
end
$$;

-- ADMINISTRATION : retire les accès à vie OFFERTS d'un compte. Renvoie { revoked: n, status }.
--   select private.revoke_lifetime('<uuid>', 'fin du partenariat');
create function private.revoke_lifetime(uid uuid, reason text) returns jsonb
  language plpgsql volatile set search_path = '' as
$$
declare
  n int;
begin
  if revoke_lifetime.reason is null or char_length(btrim(revoke_lifetime.reason)) not between 2 and 200 then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;
  update public.gift_redemptions r set revoked_at = now(), revoke_reason = btrim(revoke_lifetime.reason)
    from public.gift_codes k
   where k.code = r.code and r.user_id = uid and k.kind = 'lifetime' and r.revoked_at is null;
  get diagnostics n = row_count;
  if exists (select 1 from auth.users u where u.id = uid) then
    perform private.access_refresh(uid);
  end if;
  return jsonb_build_object('revoked', n, 'status', (select t.status from public.entitlements t where t.user_id = uid));
end
$$;

-- ADMINISTRATION : désactive un code (plus aucune utilisation) et retire l'accès à vie à ceux qui
-- l'ont utilisé. Les jours déjà offerts par un code 'days' restent acquis. Renvoie { found, revoked }.
--   select private.revoke_gift_code('K7M2QX9PR4TD', 'code publié sur un forum');
create function private.revoke_gift_code(code text, reason text) returns jsonb
  language plpgsql volatile set search_path = '' as
$$
declare
  c text := private.gift_code_norm(revoke_gift_code.code);
  u uuid;
  n int := 0;
begin
  if revoke_gift_code.reason is null or char_length(btrim(revoke_gift_code.reason)) not between 2 and 200 then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;
  update public.gift_codes k set revoked_at = coalesce(k.revoked_at, now()),
                                 revoke_reason = coalesce(k.revoke_reason, btrim(revoke_gift_code.reason))
   where k.code = c;
  if not found then
    return jsonb_build_object('found', false, 'revoked', 0);
  end if;
  for u in
    update public.gift_redemptions r set revoked_at = now(), revoke_reason = btrim(revoke_gift_code.reason)
      from public.gift_codes k
     where k.code = r.code and r.code = c and k.kind = 'lifetime' and r.revoked_at is null
    returning r.user_id
  loop
    n := n + 1;
    perform private.access_refresh(u);
  end loop;
  return jsonb_build_object('found', true, 'revoked', n);
end
$$;

-- Qui a un accès à vie offert, par quel code, depuis quand, retiré ou non (lecture seule,
-- administrateur)
create view private.lifetime_access as
  select r.user_id, p.username, r.code, k.note, r.redeemed_at as since, r.revoked_at, r.revoke_reason
    from public.gift_redemptions r
    join public.gift_codes k on k.code = r.code and k.kind = 'lifetime'
    left join public.user_profiles p on p.user_id = r.user_id;

-- ── Droits ───────────────────────────────────────────────

revoke all on function private.access_refresh(uuid) from public, anon, authenticated, service_role;
revoke all on function private.grant_lifetime(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.revoke_lifetime(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.revoke_gift_code(text, text) from public, anon, authenticated, service_role;
revoke all on private.lifetime_access from public, anon, authenticated, service_role;
revoke all on function public.redeem_gift_code(text) from public, anon, authenticated;
grant execute on function public.redeem_gift_code(text) to authenticated;

-- Instantanés recalculés (rien ne change pour personne : aucune révocation n'existe encore)
do $refresh$
declare u uuid;
begin
  for u in select t.user_id from public.entitlements t loop
    perform private.access_refresh(u);
  end loop;
end
$refresh$;

-- Administration :
--   select * from private.lifetime_access order by since desc;
--   select private.grant_lifetime('<uuid>', 'Maxence');
--   select private.revoke_lifetime('<uuid>', 'raison');
--   select private.revoke_gift_code('<code>', 'raison');
