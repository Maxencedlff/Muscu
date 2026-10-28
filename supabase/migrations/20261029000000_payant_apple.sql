-- ═══════════════════════════════════════════════════════════
--  Payant V1, règles décidées par Maxence le 28/10/2026 (contrat : docs/PAYANT_V1.md, sections
--  « Essai rattaché à l'installation », « Compte obligatoire quand le verrou est allumé » et
--  « Modèle de menace »).
--
--  RÈGLE 1 : l'essai gratuit est rattaché à l'INSTALLATION (identifiant du magasin), pas seulement au
--  compte. Avant : une nouvelle adresse e-mail = un nouveau compte = 3 mois gratuits de plus.
--  - iPhone : la preuve est le JWS de AppTransaction.shared (StoreKit 2), signé par Apple. Il porte
--    appTransactionId, identifiant UNIQUE et STABLE du téléchargement de l'app par un identifiant Apple
--    (le même après réinstallation, sur un autre iPhone, après un remboursement ou un changement de
--    pays). La fonction Edge verify-app-transaction en vérifie la signature avec _shared/apple-jws.js,
--    puis appelle public.srv_link_store_install('apple', …) (clé serveur seulement).
--  - Android (plus tard) : le stockage est indépendant du magasin. public.store_installs
--    (store, install_id) accepte 'apple' et 'google' : un ancrage Android (Play Integrity, ou
--    l'identifiant d'achat Google) se branchera sur srv_link_store_install('google', …) sans migration
--    des données. En attendant, un compte Android garde l'essai complet, rattaché au compte (le plafond
--    « sans preuve » ne vise que les comptes vus sur iPhone, voir PLATEFORME ci-dessous).
--  - public.store_installs : par installation, la date du PREMIER essai. La première écriture fait foi
--    (on conflict do nothing). Elle n'est PAS liée aux comptes : supprimer son compte et en recréer un
--    ne rend pas l'essai. Elle ne contient qu'un identifiant opaque du magasin, son environnement et
--    une date. Purgée 2 ans après le premier essai quand plus aucun compte ne l'utilise (RGPD).
--  - public.store_install_links : quel compte a présenté quelle installation. Cascade avec le compte.
--  - Le départ de l'essai d'un compte est le PLUS ANCIEN entre son propre départ
--    (entitlements.trial_started_at) et celui de chaque installation liée. Calculé à chaque lecture
--    (private.access_json). Les droits payés, cadeaux et élèves de coach ne changent pas.
--  - Premier rattachement (relecture du 28/10) : la date posée sur une installation neuve est le
--    départ du compte SI son essai court encore, sinon maintenant. Sans cela, un ancien compte (essai
--    fini) qui se connecte le premier sur l'iPhone d'un proche lui retirerait son essai. Aucune triche
--    n'en profite : le compte ancien garde son propre départ (plus ancien des deux), et une
--    installation neuve aurait de toute façon donné un essai complet.
--
--  PLATEFORME (qui subit le plafond « sans preuve ») :
--  - L'app déclare sa plateforme à my_access(p_platform) à chaque lancement ('ios' ou 'android'). Le
--    serveur retient entitlements.ios_seen_at dès qu'un iPhone s'est déclaré, et ne l'efface JAMAIS
--    (une déclaration « android » ultérieure ne le retire pas). Le plafond ne vise que ces comptes.
--  - Pourquoi une déclaration : un iPhone non débridé ne peut pas modifier le JS de l'app (il arrive
--    par mise à jour à chaud depuis notre serveur), donc l'app iPhone se déclare toujours. Mentir
--    demanderait d'intercepter le trafic (proxy avec certificat installé) pour bloquer ou réécrire
--    my_access : c'est le reste ouvert documenté, que DeviceCheck ou App Attest fermeraient. Une
--    session Supabase ne porte pas la plateforme de façon fiable, et « Se connecter avec Apple »
--    existe aussi hors iPhone : ni l'un ni l'autre ne vaut mieux.
--  - Compte jamais déclaré (vieille coquille, compte créé par l'API) : pas de plafond. Cela rend
--    aussi la transition douce : les iPhone sur une ancienne version ne sont pas plafonnés.
--
--  MODÈLE DE MENACE (relecture du 28/10, corrigé) :
--  - Il ne faut PAS de client modifié pour ne pas envoyer la preuve : il suffit de se déconnecter de
--    l'App Store (AppTransaction.shared échoue), de créer un nouveau compte, et les séances du
--    téléphone SUIVENT le nouveau compte (choix « add » à la connexion, js/data/account.js). D'où un
--    plafond court : trial_unproven_days = 3 jours par défaut (app_config, réglable). Repartir de zéro
--    demande donc un nouveau compte tous les 3 jours. L'écran dit « Connecte-toi à l'App Store pour
--    ton essai complet de 3 mois » et propose la vérification.
--  - Parade future (non codée) : DeviceCheck (2 bits par appareil chez Apple, qui survivent à la
--    réinstallation et au changement de compte Apple). Elle demande une clé DeviceCheck à créer par
--    Maxence dans le compte développeur.
--  - La preuve n'a pas d'âge limite (appTransactionId est stable) : rejouer une vieille preuve ne
--    rapporte rien, elle ne peut que rapprocher la fin de l'essai.
--
--  CAS LIMITES : hors ligne ou App Store indisponible, rien n'est bloqué tout de suite (l'app réessaie
--  au lancement et avant tout refus) ; verrou éteint, pas de plafond et can_write toujours vrai ;
--  TestFlight (Sandbox) : preuve refusée sans APPLE_ALLOW_SANDBOX, à NE PAS poser en production (les
--  testeurs reçoivent des codes cadeaux à vie avant l'allumage, voir le contrat).
--
--  RÈGLE 2 : compte obligatoire pour enregistrer une séance QUAND LE VERROU EST ALLUMÉ. La SEULE
--  ligne paywall_on de public.app_config devient lisible par anon (colonnes key et value).
--
--  Sécurité : RLS activée sans politique et aucun GRANT sur les deux nouvelles tables ; l'écriture
--  passe par public.srv_link_store_install, exécutable par service_role seulement.
--  Erreurs lisibles (P0001) : not_found, bad_bundle, invalid_app_transaction, rate_limited.
-- ═══════════════════════════════════════════════════════════

-- ── Réglage : plafond de l'essai sans preuve (iPhone) ────

insert into public.app_config (key, value) values ('trial_unproven_days', '3'::jsonb);

-- Plafond de l'essai d'un compte vu sur iPhone sans installation Apple liée, quand le verrou est
-- allumé (3 jours par défaut, borné à 0..3650). Une valeur absente ou d'un autre type retombe sur 3.
create function private.access_unproven_days() returns int
  language sql stable set search_path = '' as
$$
  select coalesce((select case when jsonb_typeof(c.value) = 'number'
                                then least(greatest(floor((c.value)::text::numeric), 0), 3650)::int end
                   from public.app_config c where c.key = 'trial_unproven_days'), 3)
$$;

-- ── Règle 2 : paywall_on lisible sans compte, et rien d'autre ──

create policy app_config_anon_paywall on public.app_config for select to anon using (key = 'paywall_on');
grant select (key, value) on public.app_config to anon;

-- ── Données ──────────────────────────────────────────────

-- Plateforme vue : posée par my_access(p_platform = 'ios'), jamais effacée
alter table public.entitlements add column ios_seen_at timestamptz;

-- Installation (identifiant du magasin) → date du premier essai. Gardée après la suppression des
-- comptes, au plus 2 ans après ce premier essai (private.purge_store_installs).
create table public.store_installs (
  store          text not null check (store in ('apple', 'google')),
  install_id     text not null check (install_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  environment    text not null check (environment in ('Production', 'Sandbox')),
  first_trial_at timestamptz not null,
  created_at     timestamptz not null default now(),
  primary key (store, install_id)
);

-- Compte ↔ installation. Un compte peut en avoir plusieurs (changement d'identifiant Apple, deux
-- appareils), une installation plusieurs comptes (c'est le cas que la règle vise).
create table public.store_install_links (
  user_id    uuid not null references auth.users(id) on delete cascade,
  store      text not null,
  install_id text not null,
  linked_at  timestamptz not null default now(),
  primary key (user_id, store, install_id),
  foreign key (store, install_id) references public.store_installs (store, install_id) on delete cascade
);
create index store_install_links_install on public.store_install_links (store, install_id);

alter table public.store_installs enable row level security;
alter table public.store_install_links enable row level security;
-- Aucune politique, aucun GRANT : ni lues ni écrites par l'API
revoke all on public.store_installs, public.store_install_links from public, anon, authenticated, service_role;

-- ── État du droit d'accès : règle 1 ──────────────────────

-- Même fonction que dans 20261028000000_payant.sql, avec la fin de l'essai calculée depuis le plus
-- ancien des départs (compte, installations liées) et le plafond sans preuve (comptes vus sur iPhone).
-- Renvoie les 10 clés du contrat plus apple_linked (une installation Apple est liée) et trial_shared
-- (l'essai vient d'une installation qu'un autre compte a utilisée avant : identifiant Apple de foyer).
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
  own_start timestamptz;        -- départ de l'essai du compte
  inst_at   timestamptz;        -- premier essai le plus ancien de ses installations
  linked    boolean;            -- une installation Apple est liée
  on_ios    boolean;            -- le compte s'est déjà déclaré sur iPhone
  shared    boolean;
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

  -- Règle 1 : le plus ancien des départs (compte, installations liées)
  select min(i.first_trial_at), coalesce(bool_or(l.store = 'apple'), false) into inst_at, linked
    from public.store_install_links l
    join public.store_installs i on i.store = l.store and i.install_id = l.install_id
    where l.user_id = uid;
  on_ios := started and e.ios_seen_at is not null;
  -- Essai pas encore démarré : on raisonne comme s'il commençait maintenant (until reste null)
  own_start := case when started then e.trial_started_at else srv_now end;
  shared := inst_at is not null and inst_at < own_start;
  trial_end := least(own_start, coalesce(inst_at, own_start)) + make_interval(days => n_days);
  -- Sans preuve Apple, vu sur iPhone, verrou allumé : essai plafonné (en-tête, modèle de menace)
  if paywall and on_ios and not linked then
    trial_end := least(trial_end, own_start + make_interval(days => private.access_unproven_days()));
  end if;

  -- Le cadeau passe avant tout le reste
  if has_gift then st := 'gift';
  elsif paid is not null and paid > srv_now then st := 'active';
  elsif in_team then st := 'coach_team';
  elsif trial_end > srv_now then st := 'trial';
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
    -- Essai pas démarré : les jours qu'il aurait s'il démarrait maintenant (90 sans rien d'autre)
    when st = 'trial' and not started then greatest(ceil(extract(epoch from trial_end - srv_now) / 86400)::int, 0)
    when until_at is null then null
    else greatest(ceil(extract(epoch from until_at - srv_now) / 86400)::int, 0)
  end;

  return jsonb_build_object(
    'status',       st,
    'until',        until_at,
    'paywall_on',   paywall,
    'trial_days',   n_days,
    'days_left',    left_days,
    -- Toujours true tant que le verrou est éteint (contrat)
    'can_write',    (not paywall) or st in ('trial', 'active', 'gift', 'coach_team'),
    'gift',         has_gift,
    'gift_until',   case when life then null else gift_at end,
    'coach_team',   in_team,
    'apple_linked', linked,
    'trial_shared', shared,
    'server_now',   srv_now
  );
end
$$;

-- ── my_access : plateforme déclarée ──────────────────────

-- Même fonction que dans 20261028000000_payant.sql, plus p_platform : 'ios' pose ios_seen_at (une
-- seule fois, jamais effacé), 'android' et toute autre valeur ne changent rien. Appelée sans
-- argument, elle se comporte comme avant.
drop function public.my_access();
create function public.my_access(p_platform text default null) returns jsonb
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
  if p_platform = 'ios' then
    update public.entitlements t set ios_seen_at = now() where t.user_id = me and t.ios_seen_at is null;
  end if;
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

-- ── Liaison d'une installation (service_role seulement) ──

-- Appelée par la fonction Edge verify-app-transaction (store 'apple'), une fois la signature vérifiée ;
-- un ancrage Android appellera la même fonction avec store 'google'.
-- p_install_id : identifiant lu dans la charge utile SIGNÉE ; p_environment : Production ou Sandbox ;
-- p_bundle : identifiant de l'app dans cette charge utile, revérifié ici (défense en profondeur).
-- Premier rattachement d'une installation : départ du compte si son essai court encore, sinon
-- maintenant (en-tête). La première écriture fait foi (on conflict do nothing).
-- Renvoie la charge utile de my_access(), pour que l'app se rafraîchisse d'un seul appel.
create function public.srv_link_store_install(p_user uuid, p_store text, p_install_id text,
                                              p_environment text, p_bundle text)
  returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare own timestamptz;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_bundle is distinct from 'com.mdlf.training' then
    raise exception 'bad_bundle' using errcode = 'P0001';
  end if;
  if p_store is null or p_store not in ('apple', 'google')
     or p_install_id is null or p_install_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     or p_environment is null or p_environment not in ('Production', 'Sandbox') then
    raise exception 'invalid_app_transaction' using errcode = 'P0001';
  end if;
  -- L'app relie au lancement : 30 par 24 h laisse large et protège la base d'une app qui boucle
  perform private.rate_limit_window(p_user, 'install_link', 30, interval '24 hours');
  insert into public.entitlements (user_id, status, trial_started_at)
    values (p_user, 'trial', now()) on conflict (user_id) do nothing;
  -- Une preuve Apple vient d'un iPhone : le compte est vu sur iPhone
  if p_store = 'apple' then
    update public.entitlements t set ios_seen_at = now() where t.user_id = p_user and t.ios_seen_at is null;
  end if;
  select t.trial_started_at into own from public.entitlements t where t.user_id = p_user;
  -- Deux comptes qui présentent la même installation en même temps : l'un attend l'autre
  perform pg_advisory_xact_lock(hashtextextended('store_install:' || p_store || ':' || p_install_id, 0));
  insert into public.store_installs (store, install_id, environment, first_trial_at)
    values (p_store, p_install_id, p_environment,
            case when own > now() - make_interval(days => private.access_trial_days()) then own else now() end)
    on conflict (store, install_id) do nothing;
  insert into public.store_install_links (user_id, store, install_id)
    values (p_user, p_store, p_install_id)
    on conflict (user_id, store, install_id) do nothing;
  perform private.access_refresh(p_user);
  return private.access_json(p_user);
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.access_unproven_days() from public, anon, authenticated, service_role;
revoke all on function private.access_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public.my_access(text) from public, anon, authenticated;
grant execute on function public.my_access(text) to authenticated;
revoke all on function public.srv_link_store_install(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.srv_link_store_install(uuid, text, text, text, text) to service_role;

-- ── Conservation limitée (RGPD) ──────────────────────────
-- Une installation qui n'est plus rattachée à aucun compte (comptes supprimés) n'est gardée que 2 ans
-- après le premier essai : assez pour empêcher de supprimer puis recréer son compte afin de repartir
-- de zéro, sans garder indéfiniment un identifiant (même opaque) sans personne derrière. Tant qu'un
-- compte l'utilise (même plus de 2 ans), elle fait partie des données de ce compte et reste. Au-delà
-- de 2 ans sans compte, un nouvel essai sur cette installation est accepté : c'est voulu.
create function private.purge_store_installs() returns int
  language sql volatile set search_path = '' as
$$
  with gone as (
    delete from public.store_installs i
     where i.first_trial_at < now() - interval '2 years'
       and not exists (select 1 from public.store_install_links l
                        where l.store = i.store and l.install_id = i.install_id)
    returning 1)
  select count(*)::int from gone
$$;
revoke all on function private.purge_store_installs() from public, anon, authenticated, service_role;

-- Purge quotidienne (03:27 UTC) par pg_cron, comme celle des signalements ; sans l'extension (tests
-- locaux), la fonction s'appelle à la main. Un nom de tâche fixe : rejouer la migration ne la double pas.
do $cron$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-store-installs-2-ans', '27 3 * * *',
      $job$select private.purge_store_installs()$job$);
  end if;
end
$cron$;

-- Administration, en cas de doute :
--   select l.user_id, i.store, i.install_id, i.environment, i.first_trial_at, l.linked_at
--     from public.store_install_links l join public.store_installs i using (store, install_id)
--     order by l.linked_at desc;
-- Rendre l'essai à une installation (cas d'un proche) :
--   update public.store_installs set first_trial_at = now() where store = 'apple' and install_id = '…';
-- Codes cadeaux à vie pour les testeurs TestFlight, AVANT d'allumer le verrou (docs/PAYANT_V1.md) :
--   select private.make_gift_code('lifetime', null, 10, 'TestFlight');
