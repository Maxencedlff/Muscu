-- ═══════════════════════════════════════════════════════════
--  Payant PLUS (contrat : docs/PAYANT_V1.md, section « Payant plus »). Après
--  20261030000000_payant_tarifs.sql. Rien de ce fichier n'est appliqué en production sans le feu vert
--  de Maxence. Retour arrière : supabase/rollback/20261031000000_payant_plus_down.sql.
--
--  1. ACCÈS À VIE PAYANT. Un achat NON CONSOMMABLE d'Apple, com.mdlf.training.lifetime (≈ 90 €,
--     identifiant proposé, rien n'est créé dans App Store Connect par ce fichier), nature 'life' :
--     - hors du groupe d'abonnements (un non consommable n'a pas de groupe) : il ne remplace pas un
--       abonnement en cours, que la personne doit résilier elle-même chez Apple (my_access le signale :
--       also_sub) ;
--     - même registre que les abonnements (entitlement_claims, original_transaction_id unique : un
--       achat ne sert qu'à un compte), même vérification (verify-purchase relit chez Apple), mêmes
--       notifications (appstore-notify : ONE_TIME_CHARGE à l'achat, REFUND, REFUND_REVERSED) ;
--     - en PRODUCTION : expires_at reste NULL (aucune fin), l'accès tombe seulement sur un
--       remboursement (revoked_at) ; seul un remboursement annulé par Apple (REFUND_REVERSED, passé
--       EXPLICITEMENT par appstore-notify : p_reinstate, et plus récent que le remboursement) le
--       rouvre. Aucune autre notification ni relecture ne rouvre un achat à vie remboursé ;
--     - en SANDBOX (TestFlight, examen d'Apple) : un achat à vie de test ne vaut que 7 JOURS après
--       l'achat. Sans cette borne, tout testeur TestFlight (Sandbox, sans payer) aurait un accès à vie
--       réel et définitif sur son compte MDLF. Un abonnement Sandbox s'arrête de lui-même ; un
--       non consommable, jamais.
--     my_access() gagne trois clés : lifetime ('purchase' | 'gift' | 'test' | null), also_sub et
--     life_test_used (achat à vie Sandbox fini : le racheter ne rouvre rien).
--  2. CODES « GRATUIT À VIE » RÉVOCABLES ET TRACÉS. Le système de codes maison existait
--     (gift_codes kind 'lifetime', private.make_gift_code, gift_redemptions = trace de qui a utilisé
--     quel code et quand) mais un accès à vie offert ne se retirait pas. Ajouts :
--     - gift_redemptions.revoked_at / revoke_reason, gift_codes.revoked_at / revoke_reason ;
--     - private.grant_lifetime(user_id, note) : l'administrateur attribue directement un accès à vie
--       à un compte (Maxence, Cyril, testeurs), sans code à transmettre : un code à usage unique est
--       fabriqué au nom du compte et utilisé aussitôt, la trace est celle de tous les codes ;
--     - private.revoke_lifetime(user_id, reason) : retire les accès à vie offerts d'un compte ;
--     - private.revoke_gift_code(code, reason) : désactive un code (plus aucune utilisation) et retire
--       l'accès à vie à ceux qui l'ont utilisé ; les jours déjà offerts par un code 'days' restent
--       (ils ne se recalculent pas, documenté) ;
--     - vue private.lifetime_access : qui a un accès à vie, d'où il vient, depuis quand, retiré ou non.
--     Aucun code n'est écrit dans ce fichier ni dans le dépôt : ils sont tirés au hasard par la base.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Produit à vie ─────────────────────────────────────

alter table public.entitlement_claims drop constraint entitlement_claims_kind_check;
alter table public.entitlement_claims add constraint entitlement_claims_kind_check check (kind in ('sub', 'life'));

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
    when 'com.mdlf.training.lifetime'           then 'life'
  end
$$;

-- Durée d'un achat à vie fait en Sandbox (TestFlight, examen d'Apple)
create function private.access_life_test_days() returns int
  language sql immutable set search_path = '' as
$$ select 7 $$;

-- Même noyau que 20261029000000_payant_modele_b.sql (règles 1 à 4 inchangées), plus l'achat à vie :
--  - nature 'life' : pas de fin en Production ; en Sandbox, fin = achat + 7 jours, fixée une fois ;
--  - une transaction ne change jamais de nature (abonnement ↔ à vie) : invalid_transaction ;
--  - règle 4 bis : un remboursement d'achat à vie n'est levé QUE par p_reinstate (REFUND_REVERSED
--    d'Apple, seul cas où appstore-notify le passe), sur un évènement PLUS RÉCENT que le dernier
--    appliqué. Une ONE_TIME_CHARGE arrivée en retard (Apple réessaie 3 jours), une relecture par
--    verify-purchase ou une notification rejouée ne rouvrent rien, quelle que soit leur date : la date
--    enregistrée d'un remboursement appris par verify-purchase peut être celle de l'ACHAT
--    (purchaseDate), elle ne suffit donc pas à ordonner les évènements.
-- p_reinstate est sans effet sur un abonnement (la règle 4 ne rouvre qu'un vrai réabonnement).
drop function private.access_claim(uuid, text, timestamptz, text, boolean, timestamptz, boolean, boolean, text);
create function private.access_claim(p_user uuid, p_product text, p_expires timestamptz,
                                     p_original_tx text, p_revoked boolean,
                                     p_event_at timestamptz default null,
                                     p_force boolean default false,
                                     p_intro boolean default null,
                                     p_environment text default null,
                                     p_reinstate boolean default false) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  k        text := private.access_product_kind(p_product);
  cur      public.entitlement_claims;
  new_end  timestamptz;
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
  if cur.user_id is not null and cur.kind <> k then
    raise exception 'invalid_transaction' using errcode = 'P0001';
  end if;

  new_end := case
    when k = 'sub' then p_expires
    when k = 'life' and coalesce(env, cur.environment) = 'Sandbox'
      then coalesce(cur.expires_at, coalesce(p_event_at, now()) + make_interval(days => private.access_life_test_days()))
  end;

  if cur.user_id is null then
    begin
      insert into public.entitlement_claims
          (original_transaction_id, user_id, product_id, kind, expires_at, revoked_at, event_at, intro_offer, environment)
        values (p_original_tx, p_user, p_product, k, new_end,
                case when p_revoked then now() end, p_event_at,
                case when k = 'sub' then coalesce(p_intro, false) else false end, env);
    exception when unique_violation then
      raise exception 'transaction_taken' using errcode = 'P0001';
    end;
  -- Règle 1 : un évènement plus ancien que le dernier appliqué ne touche à rien
  elsif cur.event_at is null or p_event_at is null or p_event_at >= cur.event_at then
    reopen := cur.revoked_at is not null and not p_revoked
              and cur.event_at is not null and p_event_at is not null and p_event_at > cur.event_at
              and (
                -- Règle 4 : réabonnement réel = évènement plus récent ET période strictement plus lointaine
                (k = 'sub' and new_end is not null and (cur.expires_at is null or new_end > cur.expires_at))
                -- Règle 4 bis : remboursement d'un achat à vie annulé par Apple (REFUND_REVERSED seulement)
                or (k = 'life' and coalesce(p_reinstate, false))
              );
    update public.entitlement_claims c set
      product_id  = p_product,
      kind        = k,
      expires_at  = case
                      when k = 'life' then new_end
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
      intro_offer = case when k = 'sub' then coalesce(p_intro, cur.intro_offer) else false end,
      environment = coalesce(env, cur.environment),
      updated_at  = now()
    where c.original_transaction_id = p_original_tx;
  end if;
  perform private.access_refresh(p_user);
  return private.access_json(p_user);
end
$$;

-- Notification d'Apple (appstore-notify) : même texte que 20261029000000_payant_modele_b.sql, plus
-- p_reinstate (vrai pour REFUND_REVERSED seulement, voir notify-policy.js), transmis à access_claim
drop function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text);
create function public.srv_access_event(p_original_tx text, p_product text, p_expires timestamptz,
                                        p_revoked boolean default false,
                                        p_event_at timestamptz default null,
                                        p_force boolean default false,
                                        p_uuid text default null,
                                        p_account_token text default null,
                                        p_intro boolean default null,
                                        p_environment text default null,
                                        p_reinstate boolean default false)
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
                               p_intro, p_environment, coalesce(p_reinstate, false));
  return jsonb_build_object('matched', true, 'duplicate', false,
                            'user_id', owner, 'access', private.access_json(owner));
end
$$;

-- ── 2. Accès à vie offerts : révocables et tracés ────────

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

-- Même calcul que 20261030000000_payant_tarifs.sql, plus l'achat à vie.
-- Ordre des statuts : gift à vie > achat à vie ('active', sans fin) > gift en jours > active > expired > none.
-- lifetime : 'purchase' (achat à vie payé, Production), 'gift' (accès à vie offert), 'test' (achat à
-- vie Sandbox, 7 jours), null sinon. also_sub : un abonnement PARTICULIER tourne encore à côté d'un
-- accès à vie (l'app invite à le résilier : Apple ne le fait pas tout seul). Un palier COACH n'y compte
-- jamais : c'est lui seul qui donne le nombre d'élèves (private.coach_paid_limit), l'accès à vie n'en
-- donne aucun ; le résilier fermerait l'équipe du coach. life_test_used : un achat à vie Sandbox est
-- fini et rien ne le remplace (correction 2 du 31/10, rachat lors d'un nouvel examen d'Apple).
create or replace function private.access_json(uid uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  srv_now   timestamptz := now();
  paywall   boolean := private.access_paywall_on();
  e         public.entitlements;
  started   boolean;
  life      boolean;
  life_paid boolean;
  life_kind text;
  life_test boolean;
  gift_at   timestamptz;
  has_gift  boolean;
  paid      timestamptz;
  intro     boolean := false;
  intro_end timestamptz;
  top_kind  text;
  top_env   text;
  also      boolean;
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
  life_paid := exists (select 1 from public.entitlement_claims c
                        where c.user_id = uid and c.kind = 'life' and c.revoked_at is null and c.expires_at is null);
  gift_at := case when started then e.gift_until end;
  has_gift := life or (gift_at is not null and gift_at > srv_now);
  paid := case when started then e.expires_at end;
  select max(least(c.expires_at, coalesce(c.revoked_at, c.expires_at))) into last_end
    from public.entitlement_claims c where c.user_id = uid;
  also := exists (select 1 from public.entitlement_claims c
                   where c.user_id = uid and c.kind = 'sub' and c.revoked_at is null and c.expires_at > srv_now
                     and private.coach_product_limit(c.product_id) is null);

  if life then st := 'gift';
  elsif life_paid then st := 'active';
  elsif has_gift then st := 'gift';
  elsif paid is not null and paid > srv_now then st := 'active';
  elsif paid is not null or gift_at is not null or last_end is not null then st := 'expired';
  else st := 'none';
  end if;

  if st = 'active' and not life_paid then
    select c.intro_offer, c.expires_at, c.kind, c.environment into intro, intro_end, top_kind, top_env
      from public.entitlement_claims c
     where c.user_id = uid and c.revoked_at is null and c.expires_at > srv_now
     order by c.expires_at desc, c.original_transaction_id limit 1;
    intro := coalesce(intro, false) and coalesce(top_kind, '') = 'sub';
  end if;

  life_kind := case
    when life_paid then 'purchase'
    when life then 'gift'
    when st = 'active' and top_kind = 'life' and top_env = 'Sandbox' then 'test'
  end;
  -- Achat à vie Sandbox déjà fini (ses 7 jours passés, jamais remboursé) et aucun accès à vie : le
  -- racheter ne rouvre rien (StoreKit rend la même transaction, dont la fin est fixée une fois).
  -- L'app ne propose plus la carte « À vie » et ne dit jamais « activé » sur ce rachat.
  life_test := life_kind is null and exists (select 1 from public.entitlement_claims c
                 where c.user_id = uid and c.kind = 'life' and c.environment = 'Sandbox'
                   and c.revoked_at is null and c.expires_at <= srv_now);

  until_at := case
    when st = 'gift'    then case when life then null else paid end
    when st = 'active'  then case when life_paid then null else paid end
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
    'lifetime',    life_kind,
    'also_sub',    coalesce(life_kind in ('purchase', 'gift'), false) and also,
    'life_test_used', life_test,
    'server_now',  srv_now
  );
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

-- ADMINISTRATION : retire les accès à vie OFFERTS d'un compte (pas un achat à vie payé : celui-là ne
-- se retire que par un remboursement d'Apple). Renvoie { revoked: n, status }.
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

-- Qui a un accès à vie, d'où il vient (offert ou payé), depuis quand, retiré ou non (lecture seule,
-- administrateur). Les achats Sandbox (7 jours) n'y figurent pas.
create view private.lifetime_access as
  select r.user_id, p.username, 'gift'::text as source, r.code, k.note, r.redeemed_at as since,
         r.revoked_at, r.revoke_reason, null::text as environment
    from public.gift_redemptions r
    join public.gift_codes k on k.code = r.code and k.kind = 'lifetime'
    left join public.user_profiles p on p.user_id = r.user_id
  union all
  select c.user_id, p.username, 'purchase', null, null, c.created_at, c.revoked_at, null, c.environment
    from public.entitlement_claims c
    left join public.user_profiles p on p.user_id = c.user_id
   where c.kind = 'life' and c.expires_at is null;

-- ── Droits ───────────────────────────────────────────────

revoke all on function private.access_life_test_days() from public, anon, authenticated, service_role;
revoke all on function private.access_claim(uuid, text, timestamptz, text, boolean, timestamptz, boolean, boolean, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text, boolean)
  to service_role;
revoke all on function private.access_refresh(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.grant_lifetime(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.revoke_lifetime(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.revoke_gift_code(text, text) from public, anon, authenticated, service_role;
revoke all on private.lifetime_access from public, anon, authenticated, service_role;
revoke all on function public.redeem_gift_code(text) from public, anon, authenticated;
grant execute on function public.redeem_gift_code(text) to authenticated;

-- Instantanés recalculés (rien ne change pour personne : aucune transaction 'life' ni révocation n'existe
-- encore ; access_json renvoie deux clés de plus)
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
