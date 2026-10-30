-- ═══════════════════════════════════════════════════════════
--  Payant V1, TARIFS ET RÔLE COACH (décisions de Maxence du 30/10/2026, contrat : docs/PAYANT_V1.md).
--  Après 20261029000000_payant_modele_b.sql. Rien de ce fichier n'est appliqué en production sans le
--  feu vert de Maxence.
--
--  1. PRODUITS COACH. Huit abonnements de plus dans le même groupe Apple (22520671) :
--     com.mdlf.training.coach10|coach20|coach30|coachmax . monthly|yearly. Chacun donne l'accès complet
--     (nature 'sub', comme les deux abonnements particulier) et fixe le PALIER du coach : 10, 20, 30
--     élèves, ou illimité (coachmax). Acheter un abonnement coach NE DONNE PAS le rôle coach : le rôle
--     est réservé aux éducateurs sportifs diplômés, vérifiés à la main (point 3). Un compte non validé
--     qui achèterait quand même un abonnement coach (possible depuis les réglages Apple, qui montrent
--     tout le groupe) a l'accès complet, rien de plus.
--  2. PLUS D'ÉLÈVE GRATUIT. La gratuité « élève d'un coach » (statut coach_team, 10 élèves gratuits
--     par coach, 20261029) disparaît : un élève paie comme tout le monde, avec −25 % pendant 12 mois
--     (code d'offre Apple, point 5). Réversible et documenté :
--     - les comptes qui étaient coach_team au moment de la migration sont notés dans
--       private.tarifs_ex_coach_team (avec leur coach) ;
--     - private.coach_free_limits est gardée telle quelle (plus lue) ;
--     - pour revenir en arrière : recréer private.access_coach_free et private.access_own_paid
--       (texte dans 20261029000000_payant_modele_b.sql, point 4) et la branche « coach_team » de
--       private.access_json, puis select private.access_refresh(user_id) from public.entitlements.
--     Le statut 'coach_team' reste accepté par la contrainte (anciens instantanés, caches de l'app) mais
--     n'est plus jamais produit ; la clé coach_team de my_access vaut toujours false.
--  3. RÔLE COACH = DEMANDE VÉRIFIÉE À LA MAIN. public.coach_requests : nom tel qu'il figure sur la
--     carte professionnelle d'éducateur sportif, numéro de la carte, diplôme ; statut pending /
--     approved / rejected / revoked et motif. L'administrateur vérifie la carte sur
--     https://recherche-educateur.sports.gouv.fr puis appelle, dans l'éditeur SQL :
--       select private.approve_coach('<uuid>', 'carte vérifiée le 30/10, valable jusqu''au …');
--       select private.reject_coach('<uuid>', 'Carte introuvable sur le site du ministère.');
--       select private.revoke_coach('<uuid>', 'Carte expirée.');
--     approve_coach pose user_profiles.coach_at et crée le CODE PERMANENT du coach (point 4) ;
--     revoke_coach retire coach_at : les élèves restent liés, aucun nouvel élève ne peut entrer, le
--     coach ne voit plus leurs séances (règle 5 de 20261027100000_coach.sql) ; une nouvelle validation
--     rend tout. Demandes en attente : select * from private.coach_requests_pending;
--     Les coachs déjà nommés à la main avant ce fichier (coach_at posé, sans demande) restent coachs.
--  4. UN CODE UNIQUE PAR COACH, permanent : 12 caractères parmi 32 (32^12 ≈ 1,2·10^18), dans la même
--     table que les codes de 7 jours (public.coach_invites, colonne permanent, expires_at = infinity) :
--     un seul système de code coach, coach_preview et coach_join l'acceptent tels quels. Un code de
--     12 caractères ne se devine pas, même avec les essais ratés non comptés (choix 1 de 20261027).
--     coach_my_code() le rend (et le recrée s'il a été supprimé par coach_revoke_invite).
--  5. ÉLÈVE : −25 % PENDANT 12 MOIS, SANS ESSAI. Mécanisme d'Apple choisi : CODES D'OFFRE À USAGE
--     UNIQUE (« one-time-use codes ») de l'offre « Eleve de coach -25 pct 12 mois » sur le mensuel
--     particulier (nouveaux abonnés seulement, remplace l'offre de lancement). Les offres
--     promotionnelles signées par le serveur ne sont pas permises pour un nouveau client (Apple : «
--     existing and previously subscribed customers »). Un code personnalisé partagé (« LUCAS25 ») se
--     donnerait à n'importe qui ; un code à usage unique n'est remis par notre serveur qu'à un élève lié
--     à un coach validé et jamais abonné : public.coach_offer_codes (stock importé par l'administrateur
--     depuis le fichier d'Apple), RPC student_offer_code().
--  6. PALIERS. Un coach ne peut pas dépasser le nombre d'élèves de son palier : coach_preview et
--     coach_join refusent tier_full (« ton coach doit passer au palier supérieur »). Limite
--     (private.coach_student_limit) : palier de l'abonnement coach en cours (illimité pour coachmax) ;
--     verrou éteint, au moins 50 (comportement d'avant, TestFlight) ; verrou allumé sans abonnement
--     coach : 0. team_full (50 fixe) disparaît. Les élèves déjà là au-delà du palier (descente de
--     palier) restent ; seul l'ajout est bloqué. coach_tier_state() le dit au coach.
--  7. ATTRIBUTION ÉLÈVE → COACH CONSERVÉE (public.coach_origins) : le premier coach rejoint par code,
--     jamais modifiée ensuite, gardée quand l'élève quitte son coach ou que le coach perd son rôle.
--     Elle servira aux commissions des coachs, gérées par le parrainage (branche lot3-parrainage,
--     docs/PARRAINAGE.md) : accroche public.coach_origin_for_user(uid), clé serveur seulement. Rien du
--     parrainage n'est dupliqué ici.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Produits ──────────────────────────────────────────

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

-- Nombre d'élèves d'un produit coach (2147483647 : illimité) ; null pour un autre produit
create function private.coach_product_limit(product_id text) returns int
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

-- ── 2. Plus d'élève gratuit ──────────────────────────────

create table private.tarifs_ex_coach_team (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  coach_id uuid,
  noted_at timestamptz not null default now()
);
revoke all on private.tarifs_ex_coach_team from public, anon, authenticated, service_role;
insert into private.tarifs_ex_coach_team (user_id, coach_id)
  select e.user_id, l.coach_id from public.entitlements e
    left join public.coach_links l on l.student_id = e.user_id
   where e.status = 'coach_team' or e.in_coach_team;

-- Même calcul que 20261029000000_payant_modele_b.sql, sans la branche élève gratuit
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

-- my_access : inchangé (20261029), sans la colonne in_coach_team qui reste à false
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
  update public.entitlements t set status = st ->> 'status', in_coach_team = false, updated_at = now()
  where t.user_id = me and (t.status is distinct from st ->> 'status' or t.in_coach_team);
  return st;
end
$$;

drop function private.access_coach_free(uuid);
drop function private.access_own_paid(uuid);

-- Instantanés recalculés (anciens élèves gratuits)
do $refresh$
declare u uuid;
begin
  for u in select x.user_id from private.tarifs_ex_coach_team x loop
    perform private.access_refresh(u);
  end loop;
end
$refresh$;

-- ── 3. Demandes du rôle coach ────────────────────────────

create table public.coach_requests (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  card_name   text not null check (char_length(card_name) between 2 and 80),
  card_number text not null check (card_number ~ '^[A-Z0-9]{6,20}$'),
  diploma     text not null check (char_length(diploma) between 2 and 80),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'revoked')),
  reason      text check (char_length(reason) <= 500),   -- motif montré au demandeur (refus, retrait)
  admin_note  text check (char_length(admin_note) <= 2000), -- note de l'administrateur, jamais montrée
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  decided_at  timestamptz,
  notified_at timestamptz                                   -- alerte e-mail partie (fonction coach-request-alert)
);
create index coach_requests_pending on public.coach_requests (created_at) where status = 'pending';
alter table public.coach_requests enable row level security;
revoke all on public.coach_requests from public, anon, authenticated, service_role;
-- La fonction Edge coach-request-alert lit la demande et pose notified_at (clé serveur, qui passe
-- outre la RLS sur Supabase) : ces colonnes seulement
grant select (user_id, card_name, card_number, diploma, status, created_at, notified_at) on public.coach_requests to service_role;
grant update (notified_at) on public.coach_requests to service_role;

-- Demandes à traiter, les plus anciennes d'abord (éditeur SQL)
create view private.coach_requests_pending as
  select r.user_id, p.username, r.card_name, r.card_number, r.diploma, r.created_at, r.notified_at
    from public.coach_requests r left join public.user_profiles p using (user_id)
   where r.status = 'pending' order by r.created_at;
revoke all on private.coach_requests_pending from public, anon, authenticated, service_role;

create function private.coach_request_json(uid uuid) returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select coalesce(
    (select jsonb_build_object('status', r.status, 'card_name', r.card_name, 'card_number', r.card_number,
                               'diploma', r.diploma, 'reason', r.reason, 'created_at', r.created_at,
                               'decided_at', r.decided_at)
       from public.coach_requests r where r.user_id = uid),
    jsonb_build_object('status', 'none', 'card_name', null, 'card_number', null, 'diploma', null,
                       'reason', null, 'created_at', null, 'decided_at', null))
  || jsonb_build_object('is_coach', private.is_coach(uid))
$$;

create function public.coach_request_state() returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  return private.coach_request_json(me);
end
$$;

-- Envoyer (ou corriger, tant qu'elle attend ; ou refaire, après un refus ou un retrait) sa demande.
-- Saisie : espaces autour retirés ; numéro de carte en majuscules, espaces, points et tirets ignorés.
create function public.coach_request_submit(card_name text, card_number text, diploma text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me  uuid := (select auth.uid());
  nm  text := regexp_replace(btrim(coalesce(coach_request_submit.card_name, '')), '\s+', ' ', 'g');
  num text := upper(regexp_replace(coalesce(coach_request_submit.card_number, ''), '[\s.\-/]', '', 'g'));
  dip text := regexp_replace(btrim(coalesce(coach_request_submit.diploma, '')), '\s+', ' ', 'g');
begin
  if me is null or not exists (select 1 from auth.users u where u.id = me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if private.is_coach(me) then raise exception 'already_coach' using errcode = 'P0001'; end if;
  if char_length(nm) not between 2 and 80 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if num !~ '^[A-Z0-9]{6,20}$' then raise exception 'invalid_card' using errcode = 'P0001'; end if;
  if char_length(dip) not between 2 and 80 then raise exception 'invalid_diploma' using errcode = 'P0001'; end if;
  perform private.rate_limit_window(me, 'coach_request', 5, interval '24 hours');
  insert into public.coach_requests as r (user_id, card_name, card_number, diploma)
    values (me, nm, num, dip)
  on conflict (user_id) do update set
    card_name = excluded.card_name, card_number = excluded.card_number, diploma = excluded.diploma,
    status = 'pending', reason = null, decided_at = null, updated_at = now(),
    -- Une demande corrigée ou refaite repart à l'administrateur
    notified_at = null, created_at = case when r.status = 'pending' then r.created_at else now() end;
  return private.coach_request_json(me);
end
$$;

-- Code permanent du coach (point 4) : 12 caractères, sans biais (même tirage que coach_new_code)
create function private.coach_new_code12() returns text
  language sql volatile set search_path = '' as
$$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', get_byte(b, i) % 32 + 1, 1), '' order by i)
  from (select uuid_send(gen_random_uuid()) as b) r, unnest(array[0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14]) i
$$;

-- Crée le code permanent du coach s'il n'en a pas, le rend
create function private.coach_ensure_code(uid uuid) returns text
  language plpgsql security definer set search_path = '' as
$$
declare c text;
begin
  perform pg_advisory_xact_lock(hashtextextended('coach_invites:' || uid::text, 0));
  select i.code into c from public.coach_invites i where i.coach_id = uid and i.permanent
    order by i.created_at limit 1;
  while c is null loop
    c := private.coach_new_code12();
    insert into public.coach_invites (code, coach_id, created_at, expires_at, permanent)
      values (c, uid, clock_timestamp(), 'infinity', true) on conflict do nothing;
    if not found then c := null; end if;
  end loop;
  return c;
end
$$;

create function private.approve_coach(uid uuid, note text default null) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
begin
  if not exists (select 1 from public.user_profiles p where p.user_id = uid) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update public.coach_requests r set status = 'approved', reason = null, admin_note = note,
         decided_at = now(), updated_at = now()
   where r.user_id = uid;
  update public.user_profiles p set coach_at = coalesce(p.coach_at, now()) where p.user_id = uid;
  perform private.coach_ensure_code(uid);
  return private.coach_request_json(uid);
end
$$;

create function private.reject_coach(uid uuid, reason text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
begin
  update public.coach_requests r set status = 'rejected', reason = left(reject_coach.reason, 500),
         decided_at = now(), updated_at = now()
   where r.user_id = uid and r.status = 'pending';
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  return private.coach_request_json(uid);
end
$$;

-- Retirer le rôle (carte expirée, plus valable) : élèves gardés, ajout bloqué (codes invalides)
create function private.revoke_coach(uid uuid, reason text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
begin
  update public.user_profiles p set coach_at = null where p.user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  update public.coach_requests r set status = 'revoked', reason = left(revoke_coach.reason, 500),
         decided_at = now(), updated_at = now()
   where r.user_id = uid;
  return private.coach_request_json(uid);
end
$$;

-- ── 4. Un code unique par coach ──────────────────────────

alter table public.coach_invites add column permanent boolean not null default false;
alter table public.coach_invites drop constraint coach_invites_code_check;
alter table public.coach_invites add constraint coach_invites_code_check
  check (code ~ '^[A-HJ-NP-Z2-9]{8}$' or (permanent and code ~ '^[A-HJ-NP-Z2-9]{12}$'));
create unique index coach_invites_one_permanent on public.coach_invites (coach_id) where permanent;

-- Saisie → forme stockée : 8 caractères (code de 7 jours) ou 12 (code permanent)
create or replace function private.coach_code_norm(c text) returns text
  language sql immutable set search_path = '' as
$$
  select case when v ~ '^[A-HJ-NP-Z2-9]{8}$' or v ~ '^[A-HJ-NP-Z2-9]{12}$' then v end
  from (select upper(regexp_replace(coalesce(c, ''), '[\s-]', '', 'g')) as v) x
$$;

-- Codes de 7 jours : comme 20261027100000_coach.sql (5 au plus), le code permanent n'est jamais compté
-- ni supprimé par cette rotation
create or replace function public.coach_create_invite() returns text
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  c text;
begin
  if me is null or not private.is_coach(me) then
    raise exception 'not_coach' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_invites:' || me::text, 0));
  perform private.rate_limit_window(me, 'coach_invite', 20, interval '24 hours');
  delete from public.coach_invites i where i.coach_id = me and i.expires_at <= now();
  delete from public.coach_invites i
    where i.code in (select i2.code from public.coach_invites i2 where i2.coach_id = me and not i2.permanent
                     order by i2.created_at desc, i2.code offset 4);
  loop
    c := private.coach_new_code();
    insert into public.coach_invites (code, coach_id, created_at, expires_at)
      values (c, me, clock_timestamp(), now() + interval '7 days') on conflict do nothing;
    exit when found;
  end loop;
  return c;
end
$$;

create function public.coach_my_code() returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  c  text;
begin
  if me is null or not private.is_coach(me) then
    raise exception 'not_coach' using errcode = 'P0001';
  end if;
  c := private.coach_ensure_code(me);
  return (select jsonb_build_object('code', i.code, 'created_at', i.created_at)
            from public.coach_invites i where i.code = c);
end
$$;

-- Coachs déjà nommés : leur code permanent tout de suite
do $codes$
declare u uuid;
begin
  for u in select p.user_id from public.user_profiles p where p.coach_at is not null loop
    perform private.coach_ensure_code(u);
  end loop;
end
$codes$;

-- ── 6. Paliers ───────────────────────────────────────────

-- Palier payé : le plus haut des abonnements coach en cours (null : aucun)
create function private.coach_paid_limit(uid uuid) returns int
  language sql stable security definer set search_path = '' as
$$
  select max(private.coach_product_limit(c.product_id))
    from public.entitlement_claims c
   where c.user_id = uid and c.revoked_at is null and c.expires_at > now()
     and private.coach_product_limit(c.product_id) is not null
$$;

-- Nombre d'élèves permis : 0 si pas coach ; verrou éteint, au moins 50 (comme avant) ; verrou allumé,
-- le palier payé (0 sans abonnement coach)
create function private.coach_student_limit(uid uuid) returns int
  language sql stable security definer set search_path = '' as
$$
  select case
    when not private.is_coach(uid) then 0
    when not private.access_paywall_on() then greatest(coalesce(private.coach_paid_limit(uid), 0), 50)
    else coalesce(private.coach_paid_limit(uid), 0)
  end
$$;

-- Comme 20261027110000_coach_removed.sql, avec la limite du palier (tier_full) au lieu de 50
create or replace function private.coach_check_code(me uuid, code text) returns uuid
  language plpgsql stable security definer set search_path = '' as
$$
declare
  c text := private.coach_code_norm(code);
  coach uuid;
  cur uuid;
begin
  select i.coach_id into coach from public.coach_invites i
    where i.code = c and i.expires_at > now() and private.is_coach(i.coach_id);
  if coach is null or exists (select 1 from public.coach_removed r where r.coach_id = coach and r.student_id = me) then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  if coach = me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select l.coach_id into cur from public.coach_links l where l.student_id = me;
  if cur = coach then return coach; end if;
  if cur is not null then
    raise exception 'already_coached' using errcode = 'P0001';
  end if;
  if (select count(*) from public.coach_links l where l.coach_id = coach) >= private.coach_student_limit(coach) then
    raise exception 'tier_full' using errcode = 'P0001';
  end if;
  return coach;
end
$$;

-- Palier du coach, pour l'écran Coach et l'écran d'abonnement
create function public.coach_tier_state() returns jsonb
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

-- ── 7. Attribution élève → coach ─────────────────────────

create table public.coach_origins (
  id         bigint generated always as identity primary key,
  -- null : compte supprimé depuis (la ligne reste, anonyme, comme referral_attributions)
  student_id uuid unique references auth.users(id) on delete set null,
  coach_id   uuid references auth.users(id) on delete set null,
  code       text,                -- code saisi (7 jours ou permanent)
  joined_at  timestamptz not null default now()
);
create index coach_origins_coach on public.coach_origins (coach_id, joined_at);
alter table public.coach_origins enable row level security;
revoke all on public.coach_origins from public, anon, authenticated, service_role;
-- Élèves déjà liés : leur coach actuel, à la date du lien
insert into public.coach_origins (student_id, coach_id, code, joined_at)
  select l.student_id, l.coach_id, null, l.created_at from public.coach_links l
  on conflict (student_id) do nothing;

-- Comme 20261027100000_coach.sql, plus l'attribution (premier coach seulement)
create or replace function public.coach_join(code text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  coach uuid;
  since timestamptz;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform private.coach_require_username(me);
  perform private.rate_limit_window(me, 'coach_code', 10, interval '1 hour');
  coach := private.coach_check_code(me, code);
  perform pg_advisory_xact_lock(hashtextextended('coach_team:' || coach::text, 0));
  coach := private.coach_check_code(me, code);   -- relu sous le verrou (palier compris)
  begin
    insert into public.coach_links (student_id, coach_id) values (me, coach) on conflict do nothing;
  exception when foreign_key_violation then
    raise exception 'invalid_code' using errcode = 'P0001';
  end;
  select l.created_at into since from public.coach_links l where l.student_id = me and l.coach_id = coach;
  if since is null then
    raise exception 'already_coached' using errcode = 'P0001';
  end if;
  insert into public.coach_origins (student_id, coach_id, code, joined_at)
    values (me, coach, private.coach_code_norm(code), since)
  on conflict (student_id) do nothing;
  return private.person(coach, since);
end
$$;

-- Accroche du parrainage (commissions) : coach d'origine d'un compte. Clé serveur seulement.
create function public.coach_origin_for_user(uid uuid) returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('coach_id', o.coach_id, 'joined_at', o.joined_at)
    from public.coach_origins o where o.student_id = uid
$$;

-- ── 5. Codes d'offre Apple des élèves ────────────────────

-- Stock de codes à usage unique (fichier d'Apple), importé par l'administrateur :
--   insert into public.coach_offer_codes (code, expires_at, batch)
--     select c, '<date d''expiration du lot>', 'lot 2026-11' from unnest(array['…', '…']) c;
create table public.coach_offer_codes (
  code        text primary key check (code ~ '^[A-Z0-9]{6,64}$'),
  environment text not null default 'Production' check (environment in ('Production', 'Sandbox')),
  expires_at  timestamptz not null,
  batch       text check (char_length(batch) <= 80),
  assigned_to uuid references auth.users(id) on delete set null,
  coach_id    uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  created_at  timestamptz not null default now()
);
create index coach_offer_codes_free on public.coach_offer_codes (environment, expires_at) where assigned_at is null;
create index coach_offer_codes_user on public.coach_offer_codes (assigned_to, assigned_at);
alter table public.coach_offer_codes enable row level security;
revoke all on public.coach_offer_codes from public, anon, authenticated, service_role;

-- Code −25 % de l'élève. Réponse { ok, error, code, expires_at, coach } ; un refus n'est pas une
-- exception (not_student, not_new, no_code) pour que le débit reste compté. Conditions : lié à un
-- coach qui a encore le rôle ; jamais abonné (aucune transaction Apple connue, aucun cadeau) : Apple
-- vérifie aussi « nouvel abonné » au moment d'utiliser le code. Le même code est rendu tant qu'il est
-- valable ; un élève reçoit 3 codes au plus en tout (un code expiré sans être utilisé est remplacé).
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

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.coach_product_limit(text) from public, anon, authenticated, service_role;
revoke all on function private.coach_request_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.coach_new_code12() from public, anon, authenticated, service_role;
revoke all on function private.coach_ensure_code(uuid) from public, anon, authenticated, service_role;
revoke all on function private.approve_coach(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.reject_coach(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.revoke_coach(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.coach_paid_limit(uuid) from public, anon, authenticated, service_role;
revoke all on function private.coach_student_limit(uuid) from public, anon, authenticated, service_role;
revoke all on function private.coach_check_code(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.access_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_refresh(uuid) from public, anon, authenticated, service_role;

revoke all on function public.my_access() from public, anon, authenticated;
revoke all on function public.coach_request_state() from public, anon, authenticated;
revoke all on function public.coach_request_submit(text, text, text) from public, anon, authenticated;
revoke all on function public.coach_my_code() from public, anon, authenticated;
revoke all on function public.coach_tier_state() from public, anon, authenticated;
revoke all on function public.coach_create_invite() from public, anon, authenticated;
revoke all on function public.coach_join(text) from public, anon, authenticated;
revoke all on function public.student_offer_code(text) from public, anon, authenticated;
revoke all on function public.coach_origin_for_user(uuid) from public, anon, authenticated, service_role;

grant execute on function public.my_access() to authenticated;
grant execute on function public.coach_request_state() to authenticated;
grant execute on function public.coach_request_submit(text, text, text) to authenticated;
grant execute on function public.coach_my_code() to authenticated;
grant execute on function public.coach_tier_state() to authenticated;
grant execute on function public.coach_create_invite() to authenticated;
grant execute on function public.coach_join(text) to authenticated;
grant execute on function public.student_offer_code(text) to authenticated;
grant execute on function public.coach_origin_for_user(uuid) to service_role;

-- Administration :
--   select * from private.coach_requests_pending;
--   select user_id, coach_id, noted_at from private.tarifs_ex_coach_team;   -- anciens élèves gratuits
--   select o.coach_id, count(*) from public.coach_origins o group by 1;     -- élèves apportés par coach
--   select environment, count(*) filter (where assigned_at is null) as libres, min(expires_at)
--     from public.coach_offer_codes group by 1;                             -- stock de codes élève
