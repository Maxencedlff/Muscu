-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261030000000_payant_tarifs.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide de revenir au modèle B du 29/10 : élèves de coach
--  gratuits, rôle coach donné à la main, pas de paliers). Pas dans migrations/ : Supabase ne
--  l'applique jamais de lui-même.
--
--  ORDRE : 20261031000000_payant_plus_down.sql D'ABORD (le payant plus réécrit access_json,
--  access_refresh et access_product_kind par-dessus ce fichier). Ce script s'arrête sans rien changer
--  si le payant plus est encore en place. Aucune autre migration postérieure ne lit ce que ce fichier
--  retire (vérifié par tests/sql/rollback_nuit_check.sh, démontage complet dans l'ordre inverse).
--
--  Avant : revenir à une version de l'app sans écran de demande de rôle coach, sans palier ni code
--  élève −25 % (coach_request_*, coach_my_code, coach_tier_state, student_offer_code n'existeront
--  plus) et couper la fonction Edge coach-request-alert (elle lit public.coach_requests).
--
--  Effet :
--  - les demandes de rôle coach, les attributions élève → coach et le stock de codes d'offre Apple
--    sont MIS DE CÔTÉ dans private.tarifs_archive_coach_requests, private.tarifs_archive_coach_origins
--    et private.tarifs_archive_coach_offer_codes (aucun rôle de l'API n'y a accès), puis les tables
--    sont supprimées. Archives à effacer à la main quand elles ne servent plus (les demandes
--    contiennent des numéros de carte professionnelle) ;
--  - les coachs validés gardent leur rôle (user_profiles.coach_at reste posé), les rôles retirés le
--    restent ; les codes PERMANENTS des coachs sont supprimés (12 caractères, refusés par la contrainte
--    d'avant) : les élèves déjà liés le restent, un nouvel élève entre avec un code de 7 jours ;
--  - les abonnements coach déjà achetés restent dans le registre et donnent toujours l'accès complet,
--    mais un NOUVEL achat d'un produit coach est refusé (unknown_product) ;
--  - les élèves de coach redeviennent gratuits (10 par coach, private.coach_free_limits, toujours là) :
--    access_coach_free et access_own_paid reviennent, access_json, access_refresh, my_access et
--    access_product_kind reprennent leur texte de 20261029000000_payant_modele_b.sql ; coach_code_norm,
--    coach_create_invite et coach_join celui de 20261027100000_coach.sql, coach_check_code celui de
--    20261027110000_coach_removed.sql (limite fixe de 50 élèves, team_full). Instantanés recalculés ;
--  - private.tarifs_ex_coach_team disparaît (le statut coach_team est recalculé, plus besoin de la liste).
-- ═══════════════════════════════════════════════════════════

begin;

do $garde$
begin
  if to_regprocedure('private.grant_lifetime(uuid, text)') is not null then
    raise exception 'payant plus encore en place : lancer d''abord supabase/rollback/20261031000000_payant_plus_down.sql';
  end if;
end
$garde$;

-- ── Archives ─────────────────────────────────────────────
create table private.tarifs_archive_coach_requests as select * from public.coach_requests;
create table private.tarifs_archive_coach_origins as select * from public.coach_origins;
create table private.tarifs_archive_coach_offer_codes as select * from public.coach_offer_codes;
revoke all on private.tarifs_archive_coach_requests, private.tarifs_archive_coach_origins,
  private.tarifs_archive_coach_offer_codes from public, anon, authenticated, service_role;

-- ── Textes d'origine (20261029000000_payant_modele_b.sql) ─
create or replace function private.access_product_kind(product_id text) returns text
  language sql immutable set search_path = '' as
$$
  select case product_id
    when 'com.mdlf.training.pro.monthly' then 'sub'
    when 'com.mdlf.training.pro.yearly'  then 'sub'
  end
$$;

create function private.access_own_paid(uid uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.entitlements e
                  where e.user_id = uid and (e.gift or coalesce(e.expires_at > now(), false)))
$$;

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

-- ── Textes d'origine (20261027100000_coach.sql, 20261027110000_coach_removed.sql) ─
create or replace function private.coach_code_norm(c text) returns text
  language sql immutable set search_path = '' as
$$
  select case when v ~ '^[A-HJ-NP-Z2-9]{8}$' then v end
  from (select upper(regexp_replace(coalesce(c, ''), '[\s-]', '', 'g')) as v) x
$$;

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
    where i.code in (select i2.code from public.coach_invites i2 where i2.coach_id = me
                     order by i2.created_at desc, i2.code offset 4);
  loop
    c := private.coach_new_code();
    -- clock_timestamp : ordre de création exact, même pour plusieurs codes dans une transaction
    insert into public.coach_invites (code, coach_id, created_at, expires_at)
      values (c, me, clock_timestamp(), now() + interval '7 days') on conflict do nothing;
    exit when found;
  end loop;
  return c;
end
$$;

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
  -- Retiré par ce coach : même réponse qu'un code faux (rien n'est révélé)
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
  if (select count(*) from public.coach_links l where l.coach_id = coach) >= 50 then
    raise exception 'team_full' using errcode = 'P0001';
  end if;
  return coach;
end
$$;

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
  coach := private.coach_check_code(me, code);   -- relu sous le verrou
  begin
    insert into public.coach_links (student_id, coach_id) values (me, coach) on conflict do nothing;
  exception when foreign_key_violation then
    raise exception 'invalid_code' using errcode = 'P0001';
  end;
  select l.created_at into since from public.coach_links l where l.student_id = me and l.coach_id = coach;
  if since is null then
    -- Un autre coach a été rejoint en même temps (autre transaction)
    raise exception 'already_coached' using errcode = 'P0001';
  end if;
  return private.person(coach, since);
end
$$;

-- ── Ce que les tarifs ajoutaient ─────────────────────────
drop function public.student_offer_code(text);
drop function public.coach_origin_for_user(uuid);
drop function public.coach_tier_state();
drop function public.coach_my_code();
drop function public.coach_request_submit(text, text, text);
drop function public.coach_request_state();
drop function private.coach_student_limit(uuid);
drop function private.coach_paid_limit(uuid);
drop function private.revoke_coach(uuid, text);
drop function private.reject_coach(uuid, text);
drop function private.approve_coach(uuid, text);
drop function private.coach_ensure_code(uuid);
drop function private.coach_new_code12();
drop function private.coach_request_json(uuid);
drop function private.coach_product_limit(text);

drop table public.coach_offer_codes;
drop table public.coach_origins;
drop view private.coach_requests_pending;
drop table public.coach_requests;

-- Codes permanents retirés avant la contrainte d'avant (8 caractères seulement)
delete from public.coach_invites where permanent;
drop index public.coach_invites_one_permanent;
alter table public.coach_invites drop constraint coach_invites_code_check;
alter table public.coach_invites add constraint coach_invites_code_check check (code ~ '^[A-HJ-NP-Z2-9]{8}$');
alter table public.coach_invites drop column permanent;

-- ── Droits (comme 20261029000000_payant_modele_b.sql et 20261027100000_coach.sql) ─
revoke all on function private.access_coach_free(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_own_paid(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_product_kind(text) from public, anon, authenticated, service_role;
revoke all on function private.access_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_refresh(uuid) from public, anon, authenticated, service_role;
revoke all on function private.coach_code_norm(text) from public, anon, authenticated, service_role;
revoke all on function private.coach_check_code(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.my_access() from public, anon, authenticated;
revoke all on function public.coach_create_invite() from public, anon, authenticated;
revoke all on function public.coach_join(text) from public, anon, authenticated;
grant execute on function public.my_access() to authenticated;
grant execute on function public.coach_create_invite() to authenticated;
grant execute on function public.coach_join(text) to authenticated;

-- Instantanés recalculés (élèves de coach redevenus gratuits)
do $refresh$
declare u uuid;
begin
  for u in select t.user_id from public.entitlements t loop
    perform private.access_refresh(u);
  end loop;
end
$refresh$;

drop table private.tarifs_ex_coach_team;

commit;
