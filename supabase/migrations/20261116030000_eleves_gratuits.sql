-- ═══════════════════════════════════════════════════════════
--  Payant V1, ÉLÈVES OFFERTS PAR LEUR COACH (décision de Maxence du 16/11/2026, contrat :
--  docs/PAYANT_V1.md, section « Élèves offerts par leur coach »). Après 20261030000000_payant_tarifs.sql
--  et 20261031000000_payant_plus.sql. Rien de ce fichier n'est appliqué en production sans le feu vert
--  de Maxence. Retour arrière : supabase/rollback/20261116030000_eleves_gratuits_down.sql.
--
--  « Les élèves ne paient pas, ce sont les coachs qui paient un forfait élève. » Remplace l'offre
--  élève du 30/10 (−25 % pendant 12 mois par code d'offre Apple, 4,89 €/mois).
--
--  1. RÈGLE. Un élève a l'accès complet (statut coach_team, can_write vrai) quand il est lié à un
--     coach (public.coach_links) qui :
--     - a toujours le rôle coach (coach_at posé) ;
--     - a un abonnement coach en cours (palier 10, 20, 30 ou illimité, private.coach_paid_limit) ;
--     - et que l'élève est DANS la limite de ce palier : les élèves sont rangés par date d'arrivée chez
--       ce coach (coach_links.created_at, puis student_id), les N premiers sont offerts.
--     Ordre des statuts : gift > active > coach_team > expired > none. Un élève qui a son propre
--     abonnement reste « active » (l'app lui dit qu'il peut le résilier) ; coach_cover dit quand même
--     que son coach l'offre.
--  2. DÉLAI DE GRÂCE de 7 jours (private.coach_cover_grace) quand l'offre du coach s'arrête :
--     - fin ou remboursement de l'abonnement coach : 7 jours après la fin ;
--     - descente de palier (coach30 → coach10, ou coach → particulier) : 7 jours après le changement,
--       pour les élèves que l'ancien palier couvrait (journal private.coach_tier_log, rempli par un
--       déclencheur sur entitlement_claims, la ligne d'une souscription Apple changeant de produit sur
--       place) ;
--     - rôle coach retiré par l'administrateur (carte expirée) : 7 jours après le retrait.
--     Ensuite l'élève retombe sur la règle normale : essai gratuit d'Apple (il n'a jamais acheté, Apple
--     le lui accorde encore) ou abonnement. Rien n'est supprimé : historique, progrès et export restent.
--     Pendant la grâce : statut coach_team, until = fin de la grâce.
--  3. DÉPASSEMENT DU PALIER. Les élèves au-delà de la limite (après la grâce) ne sont pas offerts et
--     ne sont JAMAIS facturés en silence : my_access().coach_cover.state = 'over_limit' et l'app le dit
--     clairement ; coach_tier_state().uncovered compte ces élèves pour inviter le coach à monter de
--     palier. L'ajout d'un élève au-delà du palier reste refusé (tier_full, inchangé).
--  4. my_access() / access_state() : nouvelle clé coach_cover = null (pas de coach) ou
--     { state: 'active' | 'grace' | 'over_limit' | 'ended', until, coach (pseudo) }. coach_team redevient
--     vrai pour un élève offert. Les autres clés ne changent pas.
--  5. OFFRE ÉLÈVE RETIRÉE : public.student_offer_code() disparaît. La table public.coach_offer_codes
--     reste (vide, plus lue) : le retour arrière des tarifs l'archive. Le code d'offre « Eleve de coach
--     -25 pct 12 mois » est à désactiver par Maxence dans App Store Connect.
--  6. Le coach : rien ne change pour lui-même (son abonnement coach lui donne l'accès complet).
--  Colonne entitlements.in_coach_team : reste à false (access_refresh et my_access ne sont pas réécrits) ;
--  le statut qui fait foi est recalculé à chaque lecture (private.access_json).
-- ═══════════════════════════════════════════════════════════

-- ── Délai de grâce ───────────────────────────────────────

create function private.coach_cover_grace() returns interval
  language sql immutable set search_path = '' as
$$ select interval '7 days' $$;

-- ── Journal des descentes de palier ──────────────────────

-- Une souscription Apple garde son original_transaction_id quand le coach change de palier : la ligne
-- d'entitlement_claims change de product_id sur place. On note l'ancien palier pour la grâce de 7 jours.
create table private.coach_tier_log (
  coach_id   uuid not null references auth.users(id) on delete cascade,
  old_limit  int not null,
  changed_at timestamptz not null default now()
);
create index coach_tier_log_coach on private.coach_tier_log (coach_id, changed_at);
revoke all on private.coach_tier_log from public, anon, authenticated, service_role;

create function private.coach_tier_log_claim() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare
  was int := private.coach_product_limit(old.product_id);
begin
  -- Seulement une DESCENTE (ou un passage au particulier) d'un abonnement coach encore couvert
  if was is not null and coalesce(private.coach_product_limit(new.product_id), 0) < was
     and least(old.expires_at, coalesce(old.revoked_at, old.expires_at)) > now() - private.coach_cover_grace() then
    insert into private.coach_tier_log (coach_id, old_limit) values (old.user_id, was);
  end if;
  delete from private.coach_tier_log g where g.changed_at < now() - interval '30 days';
  return null;
end
$$;
create trigger entitlement_claims_tier_log after update of product_id on public.entitlement_claims
  for each row when (old.product_id is distinct from new.product_id)
  execute function private.coach_tier_log_claim();

-- ── Offre du coach à un élève ────────────────────────────

-- null : pas lié à un coach. Sinon { state, until, coach } :
--   active     : offert, sans fin connue (abonnement coach en cours, élève dans le palier) ;
--   grace      : offert jusqu'à until (abonnement coach fini, palier descendu ou rôle retiré, il y a moins de 7 jours) ;
--   over_limit : le coach a un abonnement coach, mais l'élève est au-delà de son palier ;
--   ended      : le coach n'a plus d'abonnement coach (ou plus le rôle), grâce passée.
create function private.coach_cover(uid uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  g        interval := private.coach_cover_grace();
  coach    uuid;
  since    timestamptz;
  rnk      int;
  role_ok  boolean;
  role_end timestamptz;
  on_now   boolean;
  grace_to timestamptz;
  st       text;
begin
  select l.coach_id, l.created_at into coach, since from public.coach_links l where l.student_id = uid;
  if coach is null then
    return null;
  end if;
  -- Rang d'arrivée chez ce coach (0 = le premier) : les N premiers sont dans un palier de N élèves
  rnk := (select count(*) from public.coach_links o
           where o.coach_id = coach and (o.created_at, o.student_id) < (since, uid));
  role_ok := private.is_coach(coach);
  if not role_ok then
    select r.decided_at into role_end from public.coach_requests r where r.user_id = coach and r.status = 'revoked';
  end if;
  if role_ok or role_end > now() - g then
    -- Fenêtres (palier, fin) : abonnements coach en cours (fin null) ou finis depuis moins de 7 jours,
    -- anciens paliers quittés depuis moins de 7 jours. Rôle retiré : tout s'arrête 7 jours après.
    with w as (
      select private.coach_product_limit(c.product_id) as lim,
             case when least(c.expires_at, coalesce(c.revoked_at, c.expires_at)) > now() then null
                  else least(c.expires_at, coalesce(c.revoked_at, c.expires_at)) + g end as until_at
        from public.entitlement_claims c
       where c.user_id = coach and private.coach_product_limit(c.product_id) is not null
         and least(c.expires_at, coalesce(c.revoked_at, c.expires_at)) > now() - g
      union all
      select t.old_limit, t.changed_at + g
        from private.coach_tier_log t
       where t.coach_id = coach and t.changed_at > now() - g
    ), v as (
      select case when role_ok then w.until_at else least(coalesce(w.until_at, 'infinity'::timestamptz), role_end + g) end as until_at
        from w where w.lim > rnk
    )
    select coalesce(bool_or(v.until_at is null), false), max(v.until_at) filter (where v.until_at > now())
      into on_now, grace_to from v;
  end if;
  st := case
    when on_now then 'active'
    when grace_to is not null then 'grace'
    when role_ok and private.coach_paid_limit(coach) is not null then 'over_limit'
    else 'ended'
  end;
  return jsonb_build_object(
    'state', st,
    'until', case when st = 'grace' then grace_to end,
    'coach', (select p.username from public.user_profiles p where p.user_id = coach));
end
$$;

-- ── État du droit d'accès ────────────────────────────────

-- Même calcul que 20261030000000_payant_tarifs.sql, avec l'élève offert par son coach (coach_team)
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
  cover     jsonb;
  in_team   boolean;
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
  cover := private.coach_cover(uid);
  in_team := coalesce(cover ->> 'state' in ('active', 'grace'), false);

  if has_gift then st := 'gift';
  elsif paid is not null and paid > srv_now then st := 'active';
  elsif in_team then st := 'coach_team';
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
    when st = 'gift'       then case when life then null else paid end
    when st = 'active'     then paid
    when st = 'coach_team' then (cover ->> 'until')::timestamptz
    when st = 'expired'    then greatest(paid, gift_at, last_end)
  end;

  return jsonb_build_object(
    'status',      st,
    'until',       until_at,
    'paywall_on',  paywall,
    'days_left',   case when st in ('active', 'gift', 'coach_team') and until_at is not null
                        then greatest(ceil(extract(epoch from until_at - srv_now) / 86400)::int, 0) end,
    'can_write',   (not paywall) or st in ('active', 'gift', 'coach_team'),
    'gift',        has_gift,
    'gift_until',  case when life then null else gift_at end,
    'coach_team',  in_team,
    'coach_cover', cover,
    'intro_offer', intro,
    'intro_until', case when intro then intro_end end,
    'server_now',  srv_now
  );
end
$$;

-- ── Palier du coach : élèves au-delà du palier (non offerts) ──

-- Comme 20261030000000_payant_tarifs.sql, avec uncovered : élèves que le palier payé ne couvre pas
-- (tous sans abonnement coach). L'app invite le coach à monter de palier.
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

-- ── Offre élève −25 % retirée ────────────────────────────

drop function public.student_offer_code(text);

-- ── Droits ───────────────────────────────────────────────

revoke all on function private.coach_cover_grace() from public, anon, authenticated, service_role;
revoke all on function private.coach_tier_log_claim() from public, anon, authenticated, service_role;
revoke all on function private.coach_cover(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public.coach_tier_state() from public, anon, authenticated;
grant execute on function public.coach_tier_state() to authenticated;

-- ── Instantanés des élèves recalculés (lignes existantes seulement) ──
do $refresh$
declare u uuid;
begin
  for u in select e.user_id from public.entitlements e join public.coach_links l on l.student_id = e.user_id loop
    perform private.access_refresh(u);
  end loop;
end
$refresh$;

-- Administration (lecture seule) :
--   élèves offerts, en grâce, au-delà du palier :
--     select l.coach_id, l.student_id, private.coach_cover(l.student_id) from public.coach_links l order by l.coach_id, l.created_at;
--   descentes de palier récentes : select * from private.coach_tier_log order by changed_at desc;
