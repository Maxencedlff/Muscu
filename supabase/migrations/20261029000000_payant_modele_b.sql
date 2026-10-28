-- ═══════════════════════════════════════════════════════════
--  Payant V1, MODÈLE B (décision du 28/10/2026, contrat : docs/PAYANT_V1.md).
--  Modifie 20261028000000_payant.sql, DÉJÀ appliquée en production (verrou éteint, aucun vrai
--  utilisateur n'a jamais appelé my_access : il n'y a aucune donnée réelle à migrer).
--
--  1. L'ESSAI GRATUIT EST CELUI D'APPLE. Les 3 mois gratuits sont une offre de lancement configurée
--     dans App Store Connect sur les deux abonnements : Apple exige un moyen de paiement et garantit
--     un seul essai par identifiant Apple et par groupe d'abonnements. L'essai maison disparaît :
--     plus de trial_started_at, plus de trial_days, plus de statut 'trial' calculé par le serveur
--     (sinon on donnerait 3 mois serveur PUIS 3 mois Apple). Sans abonnement, cadeau maison ni coach,
--     le statut est 'none' (jamais eu d'accès) ou 'expired' (accès échu), et can_write est faux quand le
--     verrou est allumé. Verrou éteint : inchangé, can_write toujours vrai.
--     Une transaction en offre de lancement est un abonnement 'active' comme un autre ; le serveur
--     expose en plus intro_offer (true) et intro_until (sa fin), lus dans la transaction SIGNÉE :
--     offerType = 1 (INTRODUCTORY_OFFER) chez Apple (App Store Server Library : OfferType,
--     OfferDiscountType FREE_TRIAL ; la fonction Edge le passe en p_intro).
--  2. « ACCÈS OFFERT » D'APPLE SUPPRIMÉ (com.mdlf.training.access.gift) : produit inconnu, refusé
--     (unknown_product), ses transactions effacées et l'instantané de leurs comptes recalculé (sinon
--     gift resterait vrai : accès à vie). Les codes cadeaux MAISON restent (gift, gift_until,
--     redeem_gift_code).
--  3. SANDBOX ACCEPTÉ, environnement enregistré (entitlement_claims.environment). L'équipe d'examen
--     d'Apple achète en Sandbox sur la version de production : le refuser, c'est un refus quasi
--     certain. Ce que ça ouvre est dans le contrat (TestFlight tourne toujours en Sandbox).
--  4. ÉLÈVES DE COACH, LIMITÉS : un élève n'a l'accès gratuit que si son coach a ENCORE le rôle
--     (user_profiles.coach_at non nul : avant, retirer le rôle laissait ses élèves gratuits pour
--     toujours) et s'il est parmi les 10 plus anciens liens de ce coach, en ne comptant que les élèves
--     sans droit payé propre (un élève abonné ne prend pas de place). Au-delà, l'élève reste suivi
--     mais il lui faut son propre abonnement ou un code. Plafond par coach dans
--     private.coach_free_limits (défaut 10), relevé à la main :
--       insert into private.coach_free_limits (coach_id, max_free) values ('<uuid>', 25)
--         on conflict (coach_id) do update set max_free = excluded.max_free, updated_at = now();
--  5. GRÂCE DE FIN DE SÉANCE (private.sessions_paywall) : une séance COMMENCÉE avec le droit d'écrire
--     s'enregistre même si l'accès a pris fin pendant la séance. Bornée trois fois, toutes côté
--     serveur sauf la date de la séance :
--     - fenêtre à l'heure du SERVEUR : jusqu'à 24 h après la fin de l'accès (until), pour couvrir une
--       salle sans réseau et un envoi le lendemain ;
--     - la séance doit avoir COMMENCÉ avant la fin de l'accès et au plus 12 h avant
--       (début = data.date - data.duration, l'app enregistre date = fin de séance) ;
--     - 2 séances au plus par fin d'accès (journal private.social_rate, action 'session_grace'), compté
--       sous verrou consultatif (envois en parallèle) et seulement pour les VRAIES nouvelles lignes ;
--     - une ligne (user_id, id) déjà présente (correction, mise à la corbeille par upsert) passe
--       toujours, verrou allumé ou non : seules les séances nouvelles sont refusées.
--     Antidater ne permet donc pas de continuer à écrire : la fenêtre se ferme 24 h après la fin à
--     l'heure du serveur, quelle que soit la date déclarée, et ne laisse passer que 2 séances.
--     Sans date de fin (jamais abonné, élève dont le coach n'a plus le rôle) : pas de grâce.
--  6. Ce que la version précédente de ce fichier ajoutait et qui DISPARAÎT (jamais appliqué en
--     production) : rattachement de l'essai à l'identifiant Apple (store_installs, liens, purge à 2
--     ans, verify-app-transaction), plafond « sans preuve », plateforme déclarée. Ce qui RESTE :
--     la seule ligne paywall_on de app_config lisible par anon (compte obligatoire pour enregistrer
--     quand le verrou est allumé).
-- ═══════════════════════════════════════════════════════════

-- ── Compte obligatoire : paywall_on lisible sans compte, et rien d'autre ──

create policy app_config_anon_paywall on public.app_config for select to anon using (key = 'paywall_on');
grant select (key, value) on public.app_config to anon;

-- ── 1. L'essai maison disparaît ──────────────────────────

delete from public.app_config where key = 'trial_days';
-- Ordre imposé (relecture du 28/10) : l'ancienne contrainte refuse 'none', elle part AVANT la mise à
-- jour des lignes 'trial', puis la nouvelle est posée. tests/sql/upgrade_test.sh le vérifie.
alter table public.entitlements drop constraint entitlements_status_check;
update public.entitlements set status = 'none' where status = 'trial';
alter table public.entitlements add constraint entitlements_status_check
  check (status in ('none', 'active', 'expired', 'gift', 'coach_team'));
alter table public.entitlements alter column status set default 'none';
alter table public.entitlements drop column trial_started_at;

-- ── 2. « Accès offert » d'Apple supprimé ─────────────────

-- Les comptes qui avaient un « Accès offert » sont notés AVANT la suppression : leur instantané
-- (entitlements.gift, statut) est recalculé à la fin de ce fichier, une fois access_refresh remplacée.
-- Sans cela, un ancien détenteur garderait gift = true, donc un accès à vie.
create temporary table modele_b_gift_users as
  select distinct user_id from public.entitlement_claims where kind = 'gift';
delete from public.entitlement_claims where kind = 'gift';
alter table public.entitlement_claims drop constraint entitlement_claims_kind_check;
alter table public.entitlement_claims add constraint entitlement_claims_kind_check check (kind = 'sub');

create or replace function private.access_product_kind(product_id text) returns text
  language sql immutable set search_path = '' as
$$
  select case product_id
    when 'com.mdlf.training.pro.monthly' then 'sub'
    when 'com.mdlf.training.pro.yearly'  then 'sub'
  end
$$;

-- ── 1 et 3. Offre de lancement et environnement de chaque transaction ──

alter table public.entitlement_claims
  add column intro_offer boolean not null default false,
  add column environment text check (environment in ('Production', 'Sandbox'));

-- ── 4. Élèves de coach ───────────────────────────────────

-- Plafond d'élèves gratuits par coach (absent : 10). Écrit seulement par l'administrateur.
create table private.coach_free_limits (
  coach_id   uuid primary key references auth.users(id) on delete cascade,
  max_free   int not null check (max_free between 0 and 100000),
  updated_at timestamptz not null default now()
);
revoke all on private.coach_free_limits from public, anon, authenticated, service_role;

-- Droit payé PROPRE (abonnement en cours, cadeau maison en jours ou à vie) : un tel élève n'occupe
-- pas l'une des places gratuites de son coach (relecture du 28/10)
create function private.access_own_paid(uid uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.entitlements e
                  where e.user_id = uid and (e.gift or coalesce(e.expires_at > now(), false)))
$$;

-- Élève gratuit : suivi par un coach qui a ENCORE le rôle, et parmi ses max_free plus anciens liens
-- d'élèves SANS droit payé propre (les élèves abonnés ne prennent pas de place)
create function private.access_coach_free(uid uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (
    select 1
      from public.coach_links l
      join public.user_profiles p on p.user_id = l.coach_id and p.coach_at is not null
     where l.student_id = uid
       and (select count(*) from public.coach_links o
             where o.coach_id = l.coach_id
               and (o.created_at, o.student_id) < (l.created_at, l.student_id)
               and not private.access_own_paid(o.student_id))
           < coalesce((select f.max_free from private.coach_free_limits f where f.coach_id = l.coach_id), 10))
$$;

-- ── État du droit d'accès ────────────────────────────────

-- Recalculé à chaque lecture. Clés : status, until, paywall_on, days_left, can_write, gift, gift_until,
-- coach_team, intro_offer, intro_until, server_now.
--  - status : gift (code maison) > active (abonnement Apple, offre de lancement comprise) >
--    coach_team (élève gratuit) > expired (un accès a existé et il est échu) > none.
--  - until : fin de l'abonnement ou du cadeau en jours ; pour expired, la dernière fin d'accès (fin
--    d'abonnement, remboursement, cadeau en jours) ; null sinon.
--  - intro_offer / intro_until : l'abonnement en cours est dans son offre de lancement (essai gratuit
--    d'Apple) et sa fin. Seulement quand status = 'active'.
create or replace function private.access_json(uid uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  srv_now   timestamptz := now();
  paywall   boolean := private.access_paywall_on();
  e         public.entitlements;
  started   boolean;
  in_team   boolean;
  life      boolean;
  gift_at   timestamptz;
  has_gift  boolean;
  paid      timestamptz;
  intro     boolean := false;
  intro_end timestamptz;
  last_end  timestamptz;        -- dernière fin d'un abonnement (remboursement compris)
  st        text;
  until_at  timestamptz;
begin
  if uid is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into e from public.entitlements t where t.user_id = uid;
  started := found;
  in_team := private.access_coach_free(uid);
  life := started and e.gift;
  gift_at := case when started then e.gift_until end;
  has_gift := life or (gift_at is not null and gift_at > srv_now);
  -- expires_at tient déjà la plus lointaine des deux dates (abonnement, cadeau en jours)
  paid := case when started then e.expires_at end;
  -- Fin de chaque abonnement connu : sa date de fin, ou son remboursement s'il est venu avant
  select max(least(c.expires_at, coalesce(c.revoked_at, c.expires_at))) into last_end
    from public.entitlement_claims c where c.user_id = uid;

  if has_gift then st := 'gift';
  elsif paid is not null and paid > srv_now then st := 'active';
  elsif in_team then st := 'coach_team';
  elsif paid is not null or gift_at is not null or last_end is not null then st := 'expired';
  else st := 'none';
  end if;

  -- Offre de lancement : la transaction qui porte la fin d'accès la plus lointaine
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
    -- Toujours true tant que le verrou est éteint (contrat)
    'can_write',   (not paywall) or st in ('active', 'gift', 'coach_team'),
    'gift',        has_gift,
    'gift_until',  case when life then null else gift_at end,
    'coach_team',  in_team,
    'intro_offer', intro,
    'intro_until', case when intro then intro_end end,
    'server_now',  srv_now
  );
end
$$;
drop function private.access_trial_days();

-- Instantané de public.entitlements recalculé depuis les abonnements du compte et ses codes cadeaux
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
    -- Accès à vie : code cadeau maison lifetime seulement
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
    in_coach_team = private.access_coach_free(uid)
  where t.user_id = uid;
end
$$;

-- Rattacher une transaction vérifiée chez Apple (même noyau que 20261028000000_payant.sql, règles 1 à
-- 4 inchangées), avec en plus l'offre de lancement et l'environnement de l'évènement appliqué.
-- p_intro null : inconnu, la valeur gardée ne bouge pas.
drop function public.srv_access_purchase(uuid, text, timestamptz, text, boolean, timestamptz);
drop function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text);
drop function private.access_claim(uuid, text, timestamptz, text, boolean, timestamptz, boolean);
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

create function public.srv_access_purchase(p_user uuid, p_product text, p_expires timestamptz,
                                           p_original_tx text, p_revoked boolean default false,
                                           p_event_at timestamptz default null,
                                           p_intro boolean default null,
                                           p_environment text default null)
  returns jsonb
  language plpgsql security definer set search_path = '' as
$$
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.rate_limit_window(p_user, 'access_verify', 120, interval '24 hours');
  return private.access_claim(p_user, p_product, p_expires, p_original_tx,
                              coalesce(p_revoked, false), p_event_at, false, p_intro, p_environment);
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

-- ── RPC du client, sans l'essai ──────────────────────────

-- my_access : crée la ligne (statut 'none') au premier appel, renvoie l'état. Ne démarre plus rien.
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
  insert into public.entitlements (user_id, status) values (me, 'none') on conflict (user_id) do nothing;
  st := private.access_json(me);
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

-- Code cadeau maison : même règles que 20261028000000_payant.sql, sans l'essai
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

-- ── 5. Verrou côté serveur, avec la grâce de fin de séance ──

create or replace function private.sessions_paywall() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare
  st      jsonb;
  ended   timestamptz;
  done_ms numeric;
  dur_ms  numeric;
  began   timestamptz;
begin
  if not private.access_paywall_on() then
    return new;
  end if;
  -- L'app corrige et met à la corbeille par upsert (insert … on conflict) : le déclencheur BEFORE
  -- INSERT voit donc aussi ces écritures. Une ligne (user_id, id) déjà là n'est pas une séance
  -- nouvelle : elle passe toujours, et ne consomme jamais de grâce (relecture du 28/10).
  if exists (select 1 from public.sessions s where s.user_id = new.user_id and s.id = new.id) then
    return new;
  end if;
  insert into public.entitlements (user_id, status) values (new.user_id, 'none') on conflict (user_id) do nothing;
  st := private.access_json(new.user_id);
  if (st ->> 'can_write')::boolean then
    return new;
  end if;
  -- Grâce de fin de séance (en-tête, point 5)
  ended := (st ->> 'until')::timestamptz;
  if st ->> 'status' = 'expired' and ended is not null and now() <= ended + interval '24 hours' then
    done_ms := case when jsonb_typeof(new.data -> 'date') = 'number' then (new.data ->> 'date')::numeric end;
    dur_ms  := case when jsonb_typeof(new.data -> 'duration') = 'number' then greatest((new.data ->> 'duration')::numeric, 0) else 0 end;
    if done_ms is not null and done_ms - dur_ms between 0 and 1e14 then
      began := to_timestamp((done_ms - dur_ms) / 1000);
      -- Plusieurs envois en parallèle : un seul compte à la fois, sinon tous verraient « moins de 2 »
      perform pg_advisory_xact_lock(hashtextextended('session_grace:' || new.user_id::text, 0));
      if began <= ended and began >= ended - interval '12 hours'
         and (select count(*) from private.social_rate r
               where r.user_id = new.user_id and r.action = 'session_grace' and r.at > ended) < 2 then
        insert into private.social_rate (user_id, action) values (new.user_id, 'session_grace');
        return new;
      end if;
    end if;
  end if;
  raise exception 'paywall_locked' using errcode = 'P0001';
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.access_coach_free(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_own_paid(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_product_kind(text) from public, anon, authenticated, service_role;
revoke all on function private.access_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_refresh(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_claim(uuid, text, timestamptz, text, boolean, timestamptz, boolean, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function private.sessions_paywall() from public, anon, authenticated, service_role;
revoke all on function public.my_access() from public, anon, authenticated;
revoke all on function public.redeem_gift_code(text) from public, anon, authenticated;
grant execute on function public.my_access() to authenticated;
grant execute on function public.redeem_gift_code(text) to authenticated;
revoke all on function public.srv_access_purchase(uuid, text, timestamptz, text, boolean, timestamptz, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.srv_access_purchase(uuid, text, timestamptz, text, boolean, timestamptz, boolean, text) to service_role;
grant execute on function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text) to service_role;

-- ── Recalcul des anciens détenteurs de l'« Accès offert » (point 2) ──
do $refresh$
declare u uuid;
begin
  for u in select g.user_id from modele_b_gift_users g loop
    perform private.access_refresh(u);
  end loop;
end
$refresh$;
drop table modele_b_gift_users;

-- Administration :
--   select user_id, status, product_id, expires_at from public.entitlements order by updated_at desc;
--   select original_transaction_id, user_id, product_id, expires_at, intro_offer, environment, revoked_at
--     from public.entitlement_claims order by updated_at desc;
-- Codes cadeaux à vie pour les testeurs TestFlight, si besoin (TestFlight achète en Sandbox, accepté) :
--   select private.make_gift_code('lifetime', null, 10, 'TestFlight');
