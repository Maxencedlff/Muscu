-- ═══════════════════════════════════════════════════════════
--  Parrainage : savoir qui a amené quel compte, pour rémunérer cette personne (contrat et formule :
--  docs/PARRAINAGE.md). Deux sortes de parrains :
--  - un PARTENAIRE (influenceur, ami, coach qui a négocié un contrat à part) : code lisible créé à la
--    main par l'administrateur (« LUCAS »), saisi par l'utilisateur dans l'app ;
--  - un COACH de l'app : tout élève qui le rejoint (coach_links) lui est attribué. Le code unique de
--    chaque coach et le −25 % de l'élève viennent du payant (branche payant) : ce fichier ne lit
--    aucune de ses tables, il offre deux points d'accroche (plus bas, « Accroches du payant »).
--
--  Données :
--  - referral_partners : code, nom affiché, actif, taux et durée de commission, notes, compte du
--    partenaire dans l'app (facultatif). Écrit par l'administrateur seulement (éditeur SQL, rôle
--    postgres) : select private.make_partner_code('LUCAS', 'Lucas', 0.25, 12);
--  - Règle des coachs (docs/CONDITIONS_COACH.md) : 20 % du revenu net (proceeds Apple) de chaque
--    abonné apporté, pendant ses 12 premiers mois d'abonnement, tant que le coach a lui-même un
--    abonnement coach actif ; rien sur un mois remboursé ou non payé. Partenaires : 20 % par défaut,
--    réglable par code. Versement par virement dès que le cumul dû atteint 20 € (sinon reporté).
--  - referral_coach_terms : exception pour un coach (taux, durée) ; sans ligne, ou valeurs nulles :
--    private.referral_coach_rate() et private.referral_coach_months() (20 %, 12 mois).
--    Administrateur seulement : select private.set_coach_terms('<uuid du coach>', 0.25, 12);
--  - referral_payouts : virements faits (administrateur, à la main) ; le rapport en déduit le reste dû.
--  - referral_attributions : un compte → son parrain (kind 'partner' + partner_code, ou kind 'coach' +
--    referrer_coach), date, source ('code' saisi, 'coach' adhésion). UNE ligne par compte (unique sur
--    user_id) : première attribution valable gardée, jamais modifiable par l'utilisateur (aucune RPC ne
--    la change ni ne la retire). Pas de double attribution ni de double comptage, par construction.
--  - Délai : la saisie d'un code est possible pendant private.referral_window() (30 jours) après la
--    création du compte. L'adhésion à un coach attribue à tout moment : l'élève prend l'abonnement grâce
--    au code du coach (choix à valider, voir docs/PARRAINAGE.md).
--  - Coach qui est aussi partenaire (son compte = partner_user d'un code actif) : ses élèves sont
--    attribués à son code partenaire (ses conditions négociées), jamais deux fois.
--  - Suppression d'un compte : user_id (élève) ou referrer_coach (coach) passent à null. La ligne reste,
--    sans lien avec la personne : les chiffres des mois déjà payés restent vérifiables.
--
--  Sécurité :
--  - Aucune lecture ni écriture directe : RLS activée sans politique, aucun GRANT à anon,
--    authenticated ni service_role. Tout passe par les fonctions ci-dessous, security definer
--    (propriétaire postgres), search_path vide, utilisateur pris dans auth.uid().
--  - Un utilisateur ne voit que SON parrain (nom affiché ou pseudo du coach, date) : jamais la liste
--    des codes, les taux, les notes, ni les attributions des autres.
--  - Devinette des codes : referral_apply compte chaque essai, réussi ou non, dans private.social_rate
--    (10 par 24 h glissantes). Un code inconnu n'est donc PAS une erreur Postgres (elle annulerait
--    l'écriture du compteur, voir 20261027100000_coach.sql, choix 1) mais une réponse
--    { ok: false, error: 'invalid_code' }. Les autres refus (already_referred, too_late, rate_limited)
--    sont des erreurs P0001 : ils ne révèlent rien sur les codes.
--  - Rapport et parrain d'un compte : service_role seulement (clé serveur : tools/rapport-parrainage.mjs,
--    fonction Edge de validation Apple du payant).
--  - GRANT explicites : chaque fonction perd le droit d'exécution donné par défaut à public (et à anon
--    par Supabase) ; les fonctions de private ne sont exécutables par aucun rôle de l'API.
--
--  Réversible : drop du déclencheur coach_links_referral, des fonctions et des quatre tables (aucune
--  colonne d'une autre table n'est modifiée). Les lignes de private.social_rate sous l'action
--  'referral_try' s'effacent seules après 24 h.
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

create table public.referral_partners (
  -- Forme stockée : majuscules et chiffres, 3 à 20 caractères (saisie normalisée, voir referral_code_norm)
  code              text primary key check (code ~ '^[A-Z0-9]{3,20}$'),
  display_name      text not null check (char_length(btrim(display_name)) between 1 and 40),
  active            boolean not null default true,
  -- Part du revenu net (0,20 = 20 %), pendant commission_months mois (docs/PARRAINAGE.md)
  commission_rate   numeric(5, 4) not null default 0.20 check (commission_rate between 0 and 0.5),
  commission_months int not null default 12 check (commission_months between 1 and 60),
  notes             text check (char_length(notes) <= 2000),
  -- Compte du partenaire dans l'app, s'il en a un : il ne peut pas saisir son propre code, et s'il est
  -- coach, ses élèves sont attribués à ce code
  partner_user      uuid unique references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- Exception aux conditions d'un coach. Pas de ligne, ou valeur nulle : règle commune (20 %, 12 mois).
create table public.referral_coach_terms (
  coach_id          uuid primary key references auth.users(id) on delete cascade,
  commission_rate   numeric(5, 4) check (commission_rate between 0 and 0.5),
  commission_months int check (commission_months between 1 and 60),
  notes             text check (char_length(notes) <= 2000),
  updated_at        timestamptz not null default now()
);

-- Virements faits à un parrain (écrits à la main par l'administrateur, éditeur SQL), en centimes
create table public.referral_payouts (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('partner', 'coach')),
  partner_code text references public.referral_partners(code) on update cascade on delete restrict,
  coach_id     uuid references auth.users(id) on delete set null,
  amount_cents int not null check (amount_cents > 0),
  paid_at      timestamptz not null default now(),
  reference    text check (char_length(reference) <= 200),   -- n° de facture du parrain, libellé du virement
  constraint referral_payouts_kind check ((kind = 'partner' and partner_code is not null and coach_id is null) or kind = 'coach')
);

create table public.referral_attributions (
  id             bigint generated always as identity primary key,
  -- null : compte supprimé depuis (la ligne reste, anonyme, pour les rapports passés)
  user_id        uuid unique references auth.users(id) on delete set null,
  kind           text not null check (kind in ('partner', 'coach')),
  -- on update cascade : un code renommé suit ; jamais supprimé tant qu'il a des comptes
  partner_code   text references public.referral_partners(code) on update cascade on delete restrict,
  -- null après la suppression du compte du coach
  referrer_coach uuid references auth.users(id) on delete set null,
  source         text not null check (source in ('code', 'coach')),
  created_at     timestamptz not null default now(),
  constraint referral_attributions_kind check (
    (kind = 'partner' and partner_code is not null and referrer_coach is null)
    or (kind = 'coach' and partner_code is null)),
  constraint referral_attributions_not_self check (referrer_coach <> user_id)
);
create index referral_attributions_code_at on public.referral_attributions (partner_code, created_at) where partner_code is not null;
create index referral_attributions_coach_at on public.referral_attributions (referrer_coach, created_at) where referrer_coach is not null;

alter table public.referral_partners enable row level security;
alter table public.referral_coach_terms enable row level security;
alter table public.referral_payouts enable row level security;
alter table public.referral_attributions enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.referral_partners, public.referral_coach_terms, public.referral_attributions, public.referral_payouts
  from public, anon, authenticated, service_role;

-- ── Briques privées ──────────────────────────────────────

-- Délai de saisie d'un code après la création du compte (règle ajustable : seule cette fonction la porte)
create function private.referral_window() returns interval
  language sql immutable set search_path = '' as
$$ select interval '30 days' $$;

-- Règle commune des coachs et seuil de versement (docs/CONDITIONS_COACH.md) : une seule place à changer
create function private.referral_coach_rate() returns numeric
  language sql immutable set search_path = '' as $$ select 0.20::numeric $$;
create function private.referral_coach_months() returns int
  language sql immutable set search_path = '' as $$ select 12 $$;
create function private.referral_payout_min_cents() returns int
  language sql immutable set search_path = '' as $$ select 2000 $$;

-- Code saisi → forme stockée (majuscules, sans espaces, tirets, points ni soulignés), ou null
create function private.referral_code_norm(c text) returns text
  language sql immutable set search_path = '' as
$$
  select case when v ~ '^[A-Z0-9]{3,20}$' then v end
  from (select upper(regexp_replace(coalesce(c, ''), '[\s._-]', '', 'g')) as v) x
$$;

-- Administrateur seulement (éditeur SQL) : crée un partenaire, ou met à jour le nom, le taux, la durée
-- et les notes d'un code existant (le réactive aussi). Renvoie le code stocké.
--   select private.make_partner_code('LUCAS', 'Lucas', 0.25, 12, 'Contrat signé le …');
-- Désactiver un code (plus de nouvelles saisies, les attributions restent) :
--   update public.referral_partners set active = false where code = 'LUCAS';
create function private.make_partner_code(code text, display_name text, rate numeric default 0.20,
                                          months int default 12, notes text default null, partner_user uuid default null)
  returns text
  language plpgsql security definer set search_path = '' as
$$
declare
  c text := private.referral_code_norm(code);
begin
  if c is null then
    raise exception 'invalid_code : 3 à 20 lettres ou chiffres' using errcode = 'P0001';
  end if;
  insert into public.referral_partners as p (code, display_name, commission_rate, commission_months, notes, partner_user)
    values (c, btrim(display_name), rate, months, notes, partner_user)
    on conflict on constraint referral_partners_pkey do update
      set display_name = excluded.display_name, commission_rate = excluded.commission_rate,
          commission_months = excluded.commission_months, notes = coalesce(excluded.notes, p.notes),
          partner_user = coalesce(excluded.partner_user, p.partner_user), active = true;
  return c;
end
$$;

-- Administrateur seulement : exception aux conditions d'un coach (null : règle commune)
--   select private.set_coach_terms('<uuid du coach>', 0.20, 12, 'Contrat signé le …');
create function private.set_coach_terms(coach uuid, rate numeric, months int default 12, notes text default null)
  returns void
  language sql security definer set search_path = '' as
$$
  insert into public.referral_coach_terms as t (coach_id, commission_rate, commission_months, notes)
    values (coach, rate, months, notes)
    on conflict (coach_id) do update
      set commission_rate = excluded.commission_rate, commission_months = excluded.commission_months,
          notes = coalesce(excluded.notes, t.notes), updated_at = now()
$$;

-- Nom montré à l'utilisateur pour son parrain : nom affiché du partenaire, ou pseudo du coach
create function private.referral_referrer_of(me uuid) returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('name', coalesce(p.display_name, up.username), 'since', a.created_at)
  from public.referral_attributions a
  left join public.referral_partners p on p.code = a.partner_code
  left join public.user_profiles up on up.user_id = a.referrer_coach
  where a.user_id = me
$$;

-- Mon parrain et si je peux encore saisir un code (commun à referral_state et referral_apply)
create function private.referral_state_of(me uuid) returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object(
    'referrer', private.referral_referrer_of(me),
    'can_enter', not exists (select 1 from public.referral_attributions a where a.user_id = me)
                 and coalesce(u.created_at > now() - private.referral_window(), false),
    'until', u.created_at + private.referral_window()
  )
  from auth.users u where u.id = me
$$;

-- Attribution d'un élève à son coach (adhésion). Coach partenaire : à son code partenaire actif.
-- Déjà un parrain : rien. Jamais d'erreur (n'empêche pas l'adhésion). Renvoie true si une ligne est écrite.
-- Point d'accroche : la fonction du payant qui valide le code unique d'un coach peut l'appeler aussi.
create function private.referral_attribute_coach(student uuid, coach uuid) returns boolean
  language plpgsql security definer set search_path = '' as
$$
declare
  c text;
begin
  if student is null or coach is null or student = coach then return false; end if;
  select p.code into c from public.referral_partners p where p.partner_user = coach and p.active;
  insert into public.referral_attributions (user_id, kind, partner_code, referrer_coach, source)
    values (student, case when c is null then 'coach' else 'partner' end, c,
            case when c is null then coach end, 'coach')
    on conflict (user_id) do nothing;
  return found;
end
$$;

create function private.referral_from_coach_link() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  perform private.referral_attribute_coach(new.student_id, new.coach_id);
  return null;
end
$$;
create trigger coach_links_referral after insert on public.coach_links
  for each row execute function private.referral_from_coach_link();

-- ── Accroches du payant (remplacées par create or replace quand la branche payant sera sur main) ──

-- Code unique d'un coach (créé par le payant) → compte du coach, ou null. Saisi dans « Code d'un coach
-- ou d'un ami », il attribue le compte au coach (sans le faire rejoindre).
create function private.referral_resolve_coach_code(code text) returns uuid
  language sql stable security definer set search_path = '' as
$$ select null::uuid $$;

-- Abonnés actifs d'un parrain pendant un mois : null tant que le payant n'est pas sur main.
-- À réécrire : comptes de referral_attributions (user_id non null) de ce parrain, dont un abonnement
-- payé couvre une partie du mois et qui sont dans leurs `months` premiers mois d'abonnement.
create function private.referral_subscribers(kind text, code text, coach uuid, month date) returns int
  language sql stable security definer set search_path = '' as
$$ select null::int $$;

-- Revenu net (proceeds Apple, centimes) des abonnés de ce parrain pour le mois : null tant que le payant
-- n'est pas sur main. À réécrire : somme des proceeds des mois payés et non remboursés des comptes
-- attribués, pris seulement dans leurs `months` premiers mois d'abonnement.
create function private.referral_net_cents(kind text, code text, coach uuid, month date, months int) returns bigint
  language sql stable security definer set search_path = '' as
$$ select null::bigint $$;

-- Le coach avait-il lui-même un abonnement coach actif ce mois-là ? null (inconnu) tant que le payant
-- n'est pas sur main. Sans abonnement coach actif : aucune commission pour ce mois.
create function private.referral_coach_active(coach uuid, month date) returns boolean
  language sql stable security definer set search_path = '' as
$$ select null::boolean $$;

-- ── Fonctions RPC de l'app (authenticated seulement) ─────

-- Réglages › Compte : { referrer: { name, since } | null, can_enter, until }
create function public.referral_state() returns jsonb
  language sql stable security definer set search_path = '' as
$$ select private.referral_state_of((select auth.uid())) $$;

-- Saisie d'un code (partenaire, ou code unique d'un coach). Réponses :
--   { ok: true, referrer: { name, since } }   (même parrain déjà enregistré : même réponse, sans erreur)
--   { ok: false, error: 'invalid_code' }      (code inconnu, inactif, ou le sien : essai compté)
-- Erreurs P0001 : not_found (pas de compte), already_referred (un autre parrain), too_late (délai
-- passé), rate_limited (10 essais par 24 h).
create function public.referral_apply(code text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  c text := private.referral_code_norm(code);
  cur public.referral_attributions;
  p public.referral_partners;
  coach uuid;
begin
  if me is null or not exists (select 1 from auth.users u where u.id = me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  -- Deux saisies simultanées du même compte : l'une après l'autre
  perform pg_advisory_xact_lock(hashtextextended('referral:' || me::text, 0));
  select * into p from public.referral_partners rp where rp.code = c and rp.active;
  if p.code is null then coach := private.referral_resolve_coach_code(c); end if;
  select * into cur from public.referral_attributions a where a.user_id = me;
  if cur.id is not null then
    if (p.code is not null and cur.partner_code = p.code) or (coach is not null and cur.referrer_coach = coach) then
      return jsonb_build_object('ok', true, 'referrer', private.referral_referrer_of(me));
    end if;
    raise exception 'already_referred' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = me and u.created_at > now() - private.referral_window()) then
    raise exception 'too_late' using errcode = 'P0001';
  end if;
  perform private.rate_limit_window(me, 'referral_try', 10, interval '24 hours');
  if p.code is not null and p.partner_user is distinct from me then
    insert into public.referral_attributions (user_id, kind, partner_code, source) values (me, 'partner', p.code, 'code');
  elsif coach is not null and coach <> me then
    -- Code d'un coach qui est aussi partenaire : à son code partenaire (comme une adhésion)
    select rp.code into c from public.referral_partners rp where rp.partner_user = coach and rp.active;
    insert into public.referral_attributions (user_id, kind, partner_code, referrer_coach, source)
      values (me, case when c is null then 'coach' else 'partner' end, c, case when c is null then coach end, 'code');
  else
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  return jsonb_build_object('ok', true, 'referrer', private.referral_referrer_of(me));
end
$$;

-- ── Administration (service_role seulement) ──────────────

-- Rapport par parrain et par mois, de from_month à to_month (premiers jours de mois ; par défaut les
-- 12 derniers mois, celui en cours compris). Parrains : tous les partenaires, et les coachs qui ont un
-- compte attribué, des conditions ou un versement. kind : 'partner' (code) ou 'coach' (coach_id, pseudo).
-- new_accounts : comptes attribués dans le mois ; total_accounts : depuis le début, à la fin du mois
-- (comptes supprimés depuis compris). Les colonnes d'argent sont nulles tant que le payant n'est pas
-- branché (accroches plus haut) :
--   net_cents          revenu net des abonnés du parrain dans le mois (12 premiers mois de chacun)
--   coach_active       abonnement coach actif ce mois-là (coachs ; null pour un partenaire)
--   commission_cents   net × taux (0 pour un coach sans abonnement coach actif)
--   balance_cents      cumul des commissions jusqu'à la fin du mois, moins les virements faits
--   payable            balance_cents ≥ 20 € : à verser ; sinon reporté au mois suivant
create function public.referral_report(from_month date default null, to_month date default null)
  returns table (month date, kind text, code text, coach_id uuid, display_name text, active boolean,
                 commission_rate numeric, commission_months int, new_accounts int, total_accounts int,
                 active_subscribers int, net_cents bigint, coach_active boolean, commission_cents bigint,
                 paid_cents bigint, balance_cents bigint, payable boolean)
  language sql stable security definer set search_path = '' as
$$
  with bounds as (
    select date_trunc('month', coalesce(from_month, (now() - interval '11 months')::date))::date as f,
           date_trunc('month', coalesce(to_month, now()::date))::date as t
  ),
  refs as (
    select 'partner'::text as k, p.code as c, null::uuid as co, p.display_name as n, p.active as act,
           p.commission_rate as r, p.commission_months as mo, p.created_at as since
    from public.referral_partners p
    union all
    select 'coach', null, x.co, up.username, private.is_coach(x.co),
           coalesce(t.commission_rate, private.referral_coach_rate()),
           coalesce(t.commission_months, private.referral_coach_months()),
           least((select min(a.created_at) from public.referral_attributions a where a.referrer_coach = x.co),
                 (select min(py.paid_at) from public.referral_payouts py where py.coach_id = x.co), t.updated_at)
    from (select a.referrer_coach as co from public.referral_attributions a where a.referrer_coach is not null
          union select t2.coach_id from public.referral_coach_terms t2
          union select py.coach_id from public.referral_payouts py where py.coach_id is not null) x
    left join public.user_profiles up on up.user_id = x.co
    left join public.referral_coach_terms t on t.coach_id = x.co
  ),
  -- Commission de chaque mois, depuis le premier mois du parrain (pour le cumul et le report)
  monthly as (
    select refs.*, m::date as m, n.net, ca.active as coach_on,
           case when n.net is null then null
                when refs.k = 'coach' and ca.active is not true then 0
                else round(n.net * refs.r)::bigint end as comm
    from refs, bounds,
      generate_series(date_trunc('month', refs.since)::date::timestamp, bounds.t::timestamp, interval '1 month') m,
      lateral (select private.referral_net_cents(refs.k, refs.c, refs.co, m::date, refs.mo) as net) n,
      lateral (select case when refs.k = 'coach' then private.referral_coach_active(refs.co, m::date) end as active) ca
  )
  select x.m, x.k, x.c, x.co, x.n, x.act, x.r, x.mo,
    (select count(*)::int from public.referral_attributions a
      where (a.partner_code = x.c or a.referrer_coach = x.co)
        and a.created_at >= x.m and a.created_at < x.m + interval '1 month'),
    (select count(*)::int from public.referral_attributions a
      where (a.partner_code = x.c or a.referrer_coach = x.co) and a.created_at < x.m + interval '1 month'),
    private.referral_subscribers(x.k, x.c, x.co, x.m),
    x.net, x.coach_on, x.comm, pd.paid,
    bal.v, bal.v >= private.referral_payout_min_cents()
  from monthly x, bounds,
    lateral (select coalesce(sum(py.amount_cents), 0)::bigint as paid from public.referral_payouts py
             where (py.partner_code = x.c or py.coach_id = x.co) and py.paid_at < x.m + interval '1 month') pd,
    lateral (select case when bool_or(y.comm is null) then null else sum(y.comm)::bigint - pd.paid end as v
             from monthly y where y.k = x.k and y.c is not distinct from x.c and y.co is not distinct from x.co and y.m <= x.m) bal
  where x.m >= bounds.f
  order by x.m, x.k desc, x.c, x.n
$$;

-- Point d'accroche du payant : à la validation d'un abonnement Apple (fonction Edge, clé serveur),
-- le parrain du compte : { kind, code, coach_id, name, rate, months, since } ou null
create function public.referral_for_user(uid uuid) returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('kind', a.kind, 'code', a.partner_code, 'coach_id', a.referrer_coach,
                            'name', coalesce(p.display_name, up.username),
                            'rate', case when a.kind = 'coach' then coalesce(t.commission_rate, private.referral_coach_rate()) else p.commission_rate end,
                            'months', case when a.kind = 'coach' then coalesce(t.commission_months, private.referral_coach_months()) else p.commission_months end,
                            'since', a.created_at)
  from public.referral_attributions a
  left join public.referral_partners p on p.code = a.partner_code
  left join public.referral_coach_terms t on t.coach_id = a.referrer_coach
  left join public.user_profiles up on up.user_id = a.referrer_coach
  where a.user_id = uid
$$;

-- ── Droits ───────────────────────────────────────────────

revoke all on function private.referral_window() from public, anon, authenticated, service_role;
revoke all on function private.referral_coach_rate() from public, anon, authenticated, service_role;
revoke all on function private.referral_coach_months() from public, anon, authenticated, service_role;
revoke all on function private.referral_payout_min_cents() from public, anon, authenticated, service_role;
revoke all on function private.referral_net_cents(text, text, uuid, date, int) from public, anon, authenticated, service_role;
revoke all on function private.referral_coach_active(uuid, date) from public, anon, authenticated, service_role;
revoke all on function private.referral_code_norm(text) from public, anon, authenticated, service_role;
revoke all on function private.make_partner_code(text, text, numeric, int, text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.set_coach_terms(uuid, numeric, int, text) from public, anon, authenticated, service_role;
revoke all on function private.referral_referrer_of(uuid) from public, anon, authenticated, service_role;
revoke all on function private.referral_state_of(uuid) from public, anon, authenticated, service_role;
revoke all on function private.referral_attribute_coach(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.referral_from_coach_link() from public, anon, authenticated, service_role;
revoke all on function private.referral_resolve_coach_code(text) from public, anon, authenticated, service_role;
revoke all on function private.referral_subscribers(text, text, uuid, date) from public, anon, authenticated, service_role;

revoke all on function public.referral_state() from public, anon, authenticated, service_role;
revoke all on function public.referral_apply(text) from public, anon, authenticated, service_role;
revoke all on function public.referral_report(date, date) from public, anon, authenticated, service_role;
revoke all on function public.referral_for_user(uuid) from public, anon, authenticated, service_role;

grant execute on function public.referral_state() to authenticated;
grant execute on function public.referral_apply(text) to authenticated;
grant execute on function public.referral_report(date, date) to service_role;
grant execute on function public.referral_for_user(uuid) to service_role;
