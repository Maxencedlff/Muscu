-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261029000000_payant_modele_b.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide de revenir au payant du 28/10 : essai maison de 90 jours
--  calculé par le serveur, « Accès offert » d'Apple). Pas dans migrations/ : Supabase ne l'applique
--  jamais de lui-même. Rend le schéma de 20261028000000_payant.sql, celui de la production d'avant.
--
--  ORDRE : 20261031000000_payant_plus_down.sql puis 20261030000000_payant_tarifs_down.sql D'ABORD
--  (ils réécrivent access_json, access_refresh, access_claim et srv_access_* par-dessus ce fichier).
--  Ce script s'arrête sans rien changer si les tarifs sont encore en place. Aucune autre migration
--  postérieure ne lit ce qu'il retire (vérifié par tests/sql/rollback_nuit_check.sh).
--
--  Avant : remettre les fonctions Edge de validation Apple dans leur version du 28/10 (elles passent
--  p_intro et p_environment, que srv_access_purchase et srv_access_event n'accepteront plus) et
--  revenir à une version de l'app qui lit trial / trial_days dans my_access et ne lit pas min_build
--  sans compte.
--
--  Effet :
--  - l'essai maison revient : statut 'trial' par défaut et dans la contrainte, app_config.trial_days
--    (90) remis, private.access_trial_days recréée. La date de début d'essai, supprimée par le modèle B,
--    ne revient pas : la colonne trial_started_at est recréée à MAINTENANT pour chaque compte, qui
--    repart donc pour 90 jours (choix sûr : personne n'est bloqué). Elle est ajoutée en dernière
--    colonne de public.entitlements (seule différence de forme avec le 28/10, sans effet : rien ne
--    lit cette table par position) ;
--  - le produit « Accès offert » d'Apple (com.mdlf.training.access.gift) est de nouveau reconnu. Ses
--    transactions, effacées par le modèle B, ne reviennent pas ;
--  - offre de lancement et environnement de chaque transaction (entitlement_claims.intro_offer,
--    environment) et plafonds d'élèves gratuits (private.coach_free_limits) sont MIS DE CÔTÉ dans
--    private.modele_b_archive_claims et private.modele_b_archive_coach_free_limits, puis retirés ;
--  - élève de coach : de nouveau gratuit dès qu'il est lié, sans plafond ni condition de rôle
--    (access_coach_free et access_own_paid disparaissent) ;
--  - grâce de fin de séance retirée (sessions_paywall reprend son texte, le déclencheur
--    sessions_paywall_upd et sa fonction disparaissent) ; app_config redevient illisible sans compte
--    (politique app_config_anon_paywall et droit de lecture d'anon retirés, ligne min_build effacée) ;
--  - access_product_kind, access_trial_days, access_json, access_refresh, access_claim,
--    srv_access_purchase, srv_access_event, my_access et redeem_gift_code reprennent leur texte (et leur
--    signature) de 20261028000000_payant.sql. Les instantanés sont recalculés.
-- ═══════════════════════════════════════════════════════════

begin;

do $garde$
begin
  if to_regprocedure('private.coach_product_limit(text)') is not null then
    raise exception 'tarifs encore en place : lancer d''abord supabase/rollback/20261030000000_payant_tarifs_down.sql';
  end if;
end
$garde$;

-- ── Archives ─────────────────────────────────────────────
create table private.modele_b_archive_claims as
  select original_transaction_id, user_id, intro_offer, environment from public.entitlement_claims;
create table private.modele_b_archive_coach_free_limits as select * from private.coach_free_limits;
revoke all on private.modele_b_archive_claims, private.modele_b_archive_coach_free_limits
  from public, anon, authenticated, service_role;

-- ── Compte obligatoire : app_config redevient réservée aux comptes ─
drop policy app_config_anon_paywall on public.app_config;
revoke select (key, value) on public.app_config from anon;
delete from public.app_config where key = 'min_build';
insert into public.app_config (key, value) values ('trial_days', '90'::jsonb);

-- ── Essai maison et « Accès offert » ─────────────────────
-- Même ordre que le modèle B : l'ancienne contrainte part, les lignes 'none' (inconnu le 28/10)
-- redeviennent 'trial', puis la contrainte d'avant est posée ; le recalcul de la fin les corrige
alter table public.entitlements drop constraint entitlements_status_check;
update public.entitlements set status = 'trial' where status = 'none';
alter table public.entitlements add constraint entitlements_status_check
  check (status in ('trial', 'active', 'expired', 'gift', 'coach_team'));
alter table public.entitlements alter column status set default 'trial';
alter table public.entitlements add column trial_started_at timestamptz not null default now();

alter table public.entitlement_claims drop constraint entitlement_claims_kind_check;
alter table public.entitlement_claims add constraint entitlement_claims_kind_check check (kind in ('sub', 'gift'));
alter table public.entitlement_claims drop column intro_offer;
alter table public.entitlement_claims drop column environment;

-- ── Fonctions du modèle B retirées ───────────────────────
drop trigger sessions_paywall_upd on public.sessions;
drop function private.sessions_paywall_update();
drop function public.srv_access_purchase(uuid, text, timestamptz, text, boolean, timestamptz, boolean, text);
drop function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text);
drop function private.access_claim(uuid, text, timestamptz, text, boolean, timestamptz, boolean, boolean, text);
drop function private.access_coach_free(uuid);
drop function private.access_own_paid(uuid);
drop table private.coach_free_limits;

-- ── Textes d'origine (20261028000000_payant.sql) ─────────
create or replace function private.access_product_kind(product_id text) returns text
  language sql immutable set search_path = '' as
$$
  select case product_id
    when 'com.mdlf.training.pro.monthly' then 'sub'
    when 'com.mdlf.training.pro.yearly'  then 'sub'
    when 'com.mdlf.training.access.gift' then 'gift'
  end
$$;

create function private.access_trial_days() returns int
  language sql stable set search_path = '' as
$$
  select coalesce((select case when jsonb_typeof(c.value) = 'number'
                                then least(greatest(floor((c.value)::text::numeric), 0), 3650)::int end
                   from public.app_config c where c.key = 'trial_days'), 90)
$$;

create or replace function private.access_json(uid uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  srv_now   timestamptz := now();
  paywall   boolean := private.access_paywall_on();
  n_days    int := private.access_trial_days();
  e         public.entitlements;
  started   boolean := false;
  in_team   boolean := false;
  life      boolean := false;   -- accès à vie (non consommable d'Apple ou code lifetime)
  gift_at   timestamptz;        -- fin d'un cadeau en jours
  has_gift  boolean := false;
  trial_end timestamptz;
  paid      timestamptz;
  st        text;
  until_at  timestamptz;
  left_days int;
begin
  if uid is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into e from public.entitlements t where t.user_id = uid;
  started := found;
  in_team := exists (select 1 from public.coach_links l where l.student_id = uid);
  life := started and e.gift;
  gift_at := case when started then e.gift_until end;
  has_gift := life or (gift_at is not null and gift_at > srv_now);
  -- expires_at tient déjà la plus lointaine des deux dates (abonnement, cadeau en jours)
  paid := case when started then e.expires_at end;
  -- Essai pas encore démarré : on raisonne comme s'il commençait maintenant (until reste null)
  trial_end := coalesce(e.trial_started_at, srv_now) + make_interval(days => n_days);

  -- Le cadeau passe avant tout le reste (choix 3)
  if has_gift then st := 'gift';
  elsif paid is not null and paid > srv_now then st := 'active';
  elsif in_team then st := 'coach_team';
  elsif not started or trial_end > srv_now then st := 'trial';
  else st := 'expired';
  end if;

  until_at := case
    when st = 'gift'    then case when life then null else paid end
    when st = 'active'  then paid
    when st = 'trial'   then case when started then trial_end end
    when st = 'expired' then greatest(trial_end, paid)
  end;
  left_days := case
    when st = 'coach_team' then null
    when st = 'trial' and not started then n_days
    when until_at is null then null
    else greatest(ceil(extract(epoch from until_at - srv_now) / 86400)::int, 0)
  end;

  return jsonb_build_object(
    'status',     st,
    'until',      until_at,
    'paywall_on', paywall,
    'trial_days', n_days,
    'days_left',  left_days,
    -- Toujours true tant que le verrou est éteint (contrat)
    'can_write',  (not paywall) or st in ('trial', 'active', 'gift', 'coach_team'),
    'gift',       has_gift,
    'gift_until', case when life then null else gift_at end,
    'coach_team', in_team,
    'server_now', srv_now
  );
end
$$;

create or replace function private.access_refresh(uid uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  gift_tx   text;
  gift_prod text;
  sub_tx    text;
  sub_prod  text;
  sub_until timestamptz;
begin
  select c.original_transaction_id, c.product_id into gift_tx, gift_prod
    from public.entitlement_claims c
    where c.user_id = uid and c.kind = 'gift' and c.revoked_at is null
    order by c.created_at desc, c.original_transaction_id limit 1;
  select c.original_transaction_id, c.product_id, c.expires_at into sub_tx, sub_prod, sub_until
    from public.entitlement_claims c
    where c.user_id = uid and c.kind = 'sub' and c.revoked_at is null and c.expires_at is not null
    order by c.expires_at desc, c.original_transaction_id limit 1;

  insert into public.entitlements (user_id, status, trial_started_at)
    values (uid, 'trial', now()) on conflict (user_id) do nothing;
  update public.entitlements t set
    -- Accès à vie : non consommable d'Apple ou code cadeau lifetime
    gift                    = gift_tx is not null
                              or exists (select 1 from public.gift_redemptions r
                                         join public.gift_codes k on k.code = r.code
                                         where r.user_id = uid and k.kind = 'lifetime'),
    product_id              = coalesce(gift_prod, sub_prod),
    -- greatest ignore les null : la plus lointaine des deux dates, ou null s'il n'y en a aucune
    expires_at              = greatest(sub_until, t.gift_until),
    original_transaction_id = coalesce(gift_tx, sub_tx),
    updated_at              = now()
  where t.user_id = uid;
  -- Instantané du statut, une fois les colonnes à jour
  update public.entitlements t set
    status        = private.access_json(uid) ->> 'status',
    in_coach_team = exists (select 1 from public.coach_links l where l.student_id = uid)
  where t.user_id = uid;
end
$$;

create function private.access_claim(p_user uuid, p_product text, p_expires timestamptz,
                                     p_original_tx text, p_revoked boolean,
                                     p_event_at timestamptz default null,
                                     p_force boolean default false) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  k        text := private.access_product_kind(p_product);
  cur      public.entitlement_claims;
  -- Une période de fin n'a de sens que pour un abonnement (l'accès offert est à vie)
  new_end  timestamptz := case when k = 'sub' then p_expires end;
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
  -- Deux comptes qui présentent la même transaction en même temps : l'un des deux attend et sera
  -- refusé. Le verrou sérialise aussi deux évènements de la même transaction.
  perform pg_advisory_xact_lock(hashtextextended('access_tx:' || p_original_tx, 0));
  select * into cur from public.entitlement_claims c where c.original_transaction_id = p_original_tx;
  if cur.user_id is not null and cur.user_id <> p_user then
    raise exception 'transaction_taken' using errcode = 'P0001';
  end if;

  if cur.user_id is null then
    begin
      insert into public.entitlement_claims
          (original_transaction_id, user_id, product_id, kind, expires_at, revoked_at, event_at)
        values (p_original_tx, p_user, p_product, k, new_end,
                case when p_revoked then now() end, p_event_at);
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
      product_id = p_product,
      kind       = k,
      expires_at = case
                     -- Règle 2 : Apple ferme l'accès, ou règle 4 : la nouvelle période fait foi
                     when p_revoked or p_force or reopen then new_end
                     -- Règle 3 : révoquée et pas rouverte, sa période ne bouge pas
                     when cur.revoked_at is not null then cur.expires_at
                     else greatest(cur.expires_at, new_end)
                   end,
      revoked_at = case
                     when reopen then null
                     when p_revoked then coalesce(cur.revoked_at, now())
                     else cur.revoked_at
                   end,
      event_at   = greatest(cur.event_at, p_event_at),
      updated_at = now()
    where c.original_transaction_id = p_original_tx;
  end if;
  perform private.access_refresh(p_user);
  return private.access_json(p_user);
end
$$;

create function public.srv_access_purchase(p_user uuid, p_product text, p_expires timestamptz,
                                           p_original_tx text, p_revoked boolean default false,
                                           p_event_at timestamptz default null)
  returns jsonb
  language plpgsql security definer set search_path = '' as
$$
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.rate_limit_window(p_user, 'access_verify', 120, interval '24 hours');
  return private.access_claim(p_user, p_product, p_expires, p_original_tx,
                              coalesce(p_revoked, false), p_event_at, false);
end
$$;

create function public.srv_access_event(p_original_tx text, p_product text, p_expires timestamptz,
                                        p_revoked boolean default false,
                                        p_event_at timestamptz default null,
                                        p_force boolean default false,
                                        p_uuid text default null,
                                        p_account_token text default null)
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
  -- Repêchage par appAccountToken : l'achat n'a jamais été remonté par l'app
  if owner is null and p_account_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select u.id into owner from auth.users u where u.id = p_account_token::uuid;
  end if;
  if owner is null then
    return jsonb_build_object('matched', false, 'duplicate', false);
  end if;
  perform private.access_claim(owner, p_product, p_expires, p_original_tx,
                               coalesce(p_revoked, false), p_event_at, coalesce(p_force, false));
  return jsonb_build_object('matched', true, 'duplicate', false,
                            'user_id', owner, 'access', private.access_json(owner));
end
$$;

create or replace function public.my_access() returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  st jsonb;
begin
  if me is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  insert into public.entitlements (user_id, status, trial_started_at)
    values (me, 'trial', now()) on conflict (user_id) do nothing;
  st := private.access_json(me);
  -- Instantané seulement (le calcul ci-dessus fait foi) : écrit uniquement s'il a changé
  update public.entitlements t set
    status        = st ->> 'status',
    in_coach_team = (st ->> 'coach_team')::boolean,
    updated_at    = now()
  where t.user_id = me
    and (t.status is distinct from st ->> 'status'
         or t.in_coach_team is distinct from (st ->> 'coach_team')::boolean);
  return st;
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
  -- L'essai existe (et a donc démarré à l'heure du serveur) avant qu'on y ajoute un cadeau
  insert into public.entitlements (user_id, status, trial_started_at)
    values (me, 'trial', now()) on conflict (user_id) do nothing;
  -- L'essai est compté AVANT toute vérification, et le restera : la suite ne lève plus rien
  perform private.rate_limit_window(me, 'gift_code', 10, interval '1 hour');
  if c is null then
    return private.gift_refused(me, 'invalid_code');
  end if;
  -- Verrou de la ligne du code : deux appareils qui l'utilisent en même temps passent l'un après
  -- l'autre, et le second relit uses déjà incrémenté (pas de course sur max_uses)
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
    -- Les jours s'ajoutent au maximum entre maintenant et l'expiration en cours (choix 4 bis)
    update public.entitlements t set
      gift_until = greatest(now(), coalesce(t.expires_at, now())) + make_interval(days => g.days),
      updated_at = now()
    where t.user_id = me;
  end if;
  -- gift (accès à vie) et expires_at sont recalculés depuis les codes utilisés et les transactions
  perform private.access_refresh(me);
  return jsonb_build_object('ok', true, 'error', null, 'kind', g.kind, 'access', private.access_json(me));
end
$$;

create or replace function private.sessions_paywall() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if not private.access_paywall_on() then
    return new;
  end if;
  -- Compte qui n'a encore jamais lu son accès : son essai démarre ici, à l'heure du serveur
  insert into public.entitlements (user_id, status, trial_started_at)
    values (new.user_id, 'trial', now()) on conflict (user_id) do nothing;
  if not (private.access_json(new.user_id) ->> 'can_write')::boolean then
    raise exception 'paywall_locked' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- ── Droits (comme 20261028000000_payant.sql) ─────────────
revoke all on function private.access_product_kind(text) from public, anon, authenticated, service_role;
revoke all on function private.access_trial_days() from public, anon, authenticated, service_role;
revoke all on function private.access_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_refresh(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_claim(uuid, text, timestamptz, text, boolean, timestamptz, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.sessions_paywall() from public, anon, authenticated, service_role;
revoke all on function public.my_access() from public, anon, authenticated;
revoke all on function public.redeem_gift_code(text) from public, anon, authenticated;
grant execute on function public.my_access() to authenticated;
grant execute on function public.redeem_gift_code(text) to authenticated;
revoke all on function public.srv_access_purchase(uuid, text, timestamptz, text, boolean, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.srv_access_purchase(uuid, text, timestamptz, text, boolean, timestamptz) to service_role;
grant execute on function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text) to service_role;

-- Instantanés recalculés (essai, élèves de coach)
do $refresh$
declare u uuid;
begin
  for u in select t.user_id from public.entitlements t loop
    perform private.access_refresh(u);
  end loop;
end
$refresh$;

commit;
