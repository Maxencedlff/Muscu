-- ═══════════════════════════════════════════════════════════
--  Payant V1, deux règles décidées par Maxence le 28/10/2026 (contrat : docs/PAYANT_V1.md, sections
--  « Essai rattaché à l'identifiant Apple » et « Compte obligatoire quand le verrou est allumé »).
--
--  RÈGLE 1 : l'essai gratuit est rattaché à l'IDENTIFIANT APPLE, pas seulement au compte.
--  Avant : une nouvelle adresse e-mail = un nouveau compte = 3 mois gratuits de plus, à l'infini.
--  - Preuve : le JWS de AppTransaction.shared (StoreKit 2), signé par Apple, que l'app obtient sans
--    rien demander à l'utilisateur. Il porte appTransactionId, identifiant UNIQUE et STABLE du
--    téléchargement de l'app par un identifiant Apple (le même après une réinstallation, sur un autre
--    iPhone, après un remboursement ou un changement de pays). La fonction Edge
--    verify-app-transaction en vérifie la signature avec _shared/apple-jws.js (même chaîne jusqu'à
--    Apple Root CA G3, même bundleId com.mdlf.training, Sandbox refusé sans APPLE_ALLOW_SANDBOX=1),
--    puis appelle public.srv_link_app_transaction (clé serveur seulement).
--  - public.apple_app_ids : par identifiant de téléchargement Apple, la date du PREMIER essai, c'est
--    à dire le début de l'essai du premier compte qui l'a présenté. La première écriture fait foi
--    (on conflict do nothing) : un vieux compte qui se connecte plus tard sur l'iPhone d'un proche ne
--    lui retire pas son essai. Cette table N'EST PAS liée aux comptes : supprimer son compte et en
--    recréer un ne rend pas l'essai. Elle ne contient qu'un identifiant opaque d'Apple, son
--    environnement et une date (aucune donnée de la personne) : c'est la donnée minimale contre l'abus.
--  - public.apple_app_links : quel compte a présenté quel identifiant Apple. Part en cascade avec le
--    compte.
--  - Le départ de l'essai d'un compte devient le PLUS ANCIEN entre son propre départ
--    (entitlements.trial_started_at) et celui de chaque identifiant Apple auquel il est lié. Calculé à
--    chaque lecture (private.access_json), donc indépendant de l'ordre des liaisons. Les droits payés,
--    les cadeaux et les élèves de coach ne changent pas : seule la fin de l'essai bouge.
--
--  CAS LIMITES (choix pris, à relire ; repris dans docs/PAYANT_V1.md) :
--  1. Preuve absente (iPhone hors ligne, App Store pas connecté, TestFlight sans APPLE_ALLOW_SANDBOX,
--     vieille coquille sans la méthode, navigateur) : RIEN n'est bloqué tout de suite. Le compte garde
--     son essai, mais tant qu'aucun identifiant Apple n'est lié ET que le verrou est allumé, l'essai
--     est plafonné à trial_unproven_days jours (app_config, 14 par défaut) depuis son propre départ.
--     L'app renvoie la preuve à chaque lancement et juste avant de refuser une séance : la preuve
--     arrive dès que le réseau revient, et l'essai complet avec elle.
--  2. Client modifié qui n'envoie JAMAIS la preuve : il n'a que trial_unproven_days jours par compte,
--     au lieu de 90. Repartir de zéro demande alors un nouveau compte tous les 14 jours (et ses séances
--     ne le suivent pas sur le serveur). Fermer complètement cette porte (plafond à 0) bloquerait les
--     honnêtes dont la preuve échoue un moment : le plafond est donc réglable, sans redéployer.
--  3. Verrou éteint : le plafond ne s'applique pas (rien ne change tant que paywall_on est faux), et
--     can_write reste toujours vrai. La liaison, elle, est faite dès maintenant : quand le verrou
--     s'allumera, l'historique des identifiants Apple sera déjà là.
--  4. Transition : allumer le verrou avec trial_unproven_days = 90 (aucun plafond) tant que des
--     iPhone tournent avec une coquille sans appTransaction() (une mise à jour à chaud peut arriver
--     avant la nouvelle build), puis le redescendre à 14 :
--       update public.app_config set value = '14'::jsonb, updated_at = now() where key = 'trial_unproven_days';
--  5. Un identifiant Apple ne bloque jamais un accès payé, un cadeau ni un élève de coach (seule la
--     fin de l'essai est concernée), et la liaison n'écrit jamais trial_started_at.
--  6. Une preuve ne peut que RAPPROCHER la fin de l'essai (plus ancien des départs) : présenter la
--     preuve d'un autre ne donne rien, au pire elle raccourcit son propre essai.
--
--  RÈGLE 2 : compte obligatoire pour enregistrer une séance QUAND LE VERROU EST ALLUMÉ.
--  L'app doit savoir si le verrou est allumé avant toute connexion. La SEULE ligne paywall_on de
--  public.app_config devient lisible par anon (politique RLS sur la clé, colonnes key et value) :
--  pas de nouvelle fonction, pas de nouvelle surface, et trial_days ou trial_unproven_days restent
--  réservés aux comptes connectés. C'est un réglage public par nature (l'app le montre à l'écran).
--  Sans compte, aucune séance n'atteint le serveur : le verrou dur reste le déclencheur
--  private.sessions_paywall (inchangé, il lit access_json qui applique la règle 1).
--
--  Sécurité : comme 20261028000000_payant.sql. RLS activée sans politique et aucun GRANT sur les deux
--  nouvelles tables ; l'écriture passe par public.srv_link_app_transaction, exécutable par
--  service_role seulement, après vérification de la signature d'Apple par la fonction Edge.
--  Erreurs lisibles (P0001) : not_found, bad_bundle, invalid_app_transaction, rate_limited.
-- ═══════════════════════════════════════════════════════════

-- ── Réglage : plafond de l'essai sans preuve Apple ───────

insert into public.app_config (key, value) values ('trial_unproven_days', '14'::jsonb);

-- Plafond de l'essai d'un compte sans identifiant Apple lié, quand le verrou est allumé (14 jours par
-- défaut, borné à 0..3650). Une valeur absente ou d'un autre type retombe sur 14.
create function private.access_unproven_days() returns int
  language sql stable set search_path = '' as
$$
  select coalesce((select case when jsonb_typeof(c.value) = 'number'
                                then least(greatest(floor((c.value)::text::numeric), 0), 3650)::int end
                   from public.app_config c where c.key = 'trial_unproven_days'), 14)
$$;

-- ── Règle 2 : paywall_on lisible sans compte, et rien d'autre ──

create policy app_config_anon_paywall on public.app_config for select to anon using (key = 'paywall_on');
grant select (key, value) on public.app_config to anon;

-- ── Données ──────────────────────────────────────────────

-- Identifiant de téléchargement Apple (appTransactionId) → date du premier essai. Gardé après la
-- suppression des comptes (voir l'en-tête) : c'est ce qui empêche de repartir de zéro.
create table public.apple_app_ids (
  app_transaction_id text primary key check (app_transaction_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  environment        text not null check (environment in ('Production', 'Sandbox')),
  first_trial_at     timestamptz not null,
  created_at         timestamptz not null default now()
);

-- Compte ↔ identifiant Apple. Un compte peut en avoir plusieurs (changement d'identifiant Apple,
-- deux iPhone), un identifiant Apple plusieurs comptes (c'est le cas que la règle vise).
create table public.apple_app_links (
  user_id            uuid not null references auth.users(id) on delete cascade,
  app_transaction_id text not null references public.apple_app_ids(app_transaction_id) on delete cascade,
  linked_at          timestamptz not null default now(),
  primary key (user_id, app_transaction_id)
);
create index apple_app_links_app on public.apple_app_links (app_transaction_id);

alter table public.apple_app_ids enable row level security;
alter table public.apple_app_links enable row level security;
-- Aucune politique, aucun GRANT : ni lues ni écrites par l'API
revoke all on public.apple_app_ids, public.apple_app_links from public, anon, authenticated, service_role;

-- ── État du droit d'accès : règle 1 ──────────────────────

-- Même fonction que dans 20261028000000_payant.sql, avec la fin de l'essai calculée depuis le plus
-- ancien des départs (compte, identifiants Apple liés) et le plafond sans preuve. Renvoie les 10 clés
-- du contrat plus apple_linked (un identifiant Apple est lié à ce compte).
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
  apple_at  timestamptz;        -- premier essai le plus ancien de ses identifiants Apple
  linked    boolean;
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

  -- Règle 1 : le plus ancien des départs (compte, identifiants Apple liés)
  select min(a.first_trial_at), count(*) > 0 into apple_at, linked
    from public.apple_app_links l join public.apple_app_ids a on a.app_transaction_id = l.app_transaction_id
    where l.user_id = uid;
  -- Essai pas encore démarré : on raisonne comme s'il commençait maintenant (until reste null)
  own_start := case when started then e.trial_started_at else srv_now end;
  trial_end := least(own_start, coalesce(apple_at, own_start)) + make_interval(days => n_days);
  -- Sans preuve Apple et verrou allumé : essai plafonné (cas limites 1 à 3 de l'en-tête)
  if paywall and not linked then
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
    'server_now',   srv_now
  );
end
$$;

-- ── Liaison d'un identifiant Apple (service_role seulement) ──

-- Appelée par la fonction Edge verify-app-transaction, une fois la signature d'Apple vérifiée.
-- p_app_tx : appTransactionId lu dans la charge utile SIGNÉE ; p_environment : Production ou Sandbox ;
-- p_bundle : bundleId de cette charge utile, revérifié ici (défense en profondeur : la fonction Edge
-- le refuse déjà, mais une preuve d'une autre app ne doit jamais rien lier, même si elle passait).
-- L'essai du compte existe (démarré à l'heure du serveur, comme my_access) avant la liaison. Le
-- premier compte qui présente un identifiant Apple en fixe la date (on conflict do nothing).
-- Renvoie la charge utile de my_access(), pour que l'app se rafraîchisse d'un seul appel.
create function public.srv_link_app_transaction(p_user uuid, p_app_tx text, p_environment text, p_bundle text)
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
  if p_app_tx is null or p_app_tx !~ '^[A-Za-z0-9._-]{1,64}$'
     or p_environment is null or p_environment not in ('Production', 'Sandbox') then
    raise exception 'invalid_app_transaction' using errcode = 'P0001';
  end if;
  -- L'app relie au lancement : 30 par 24 h laisse large et protège la base d'une app qui boucle
  perform private.rate_limit_window(p_user, 'apple_link', 30, interval '24 hours');
  insert into public.entitlements (user_id, status, trial_started_at)
    values (p_user, 'trial', now()) on conflict (user_id) do nothing;
  select t.trial_started_at into own from public.entitlements t where t.user_id = p_user;
  -- Deux comptes qui présentent le même identifiant en même temps : l'un attend l'autre
  perform pg_advisory_xact_lock(hashtextextended('apple_app:' || p_app_tx, 0));
  insert into public.apple_app_ids (app_transaction_id, environment, first_trial_at)
    values (p_app_tx, p_environment, own)
    on conflict (app_transaction_id) do nothing;
  insert into public.apple_app_links (user_id, app_transaction_id)
    values (p_user, p_app_tx)
    on conflict (user_id, app_transaction_id) do nothing;
  perform private.access_refresh(p_user);
  return private.access_json(p_user);
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.access_unproven_days() from public, anon, authenticated, service_role;
revoke all on function private.access_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public.srv_link_app_transaction(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.srv_link_app_transaction(uuid, text, text, text) to service_role;

-- ── Conservation limitée (RGPD) ──────────────────────────
-- Un identifiant Apple qui n'est plus rattaché à aucun compte (comptes supprimés) n'est gardé que
-- 2 ans après le premier essai : assez pour empêcher de supprimer puis recréer son compte afin de
-- repartir de zéro, sans garder indéfiniment un identifiant (même opaque) sans personne derrière.
-- Tant qu'un compte l'utilise, il fait partie des données de ce compte et reste. Au-delà de 2 ans,
-- un nouvel essai sur cet identifiant est accepté : c'est voulu.
create function private.purge_apple_app_ids() returns int
  language sql volatile set search_path = '' as
$$
  with gone as (
    delete from public.apple_app_ids a
     where a.first_trial_at < now() - interval '2 years'
       and not exists (select 1 from public.apple_app_links l where l.app_transaction_id = a.app_transaction_id)
    returning 1)
  select count(*)::int from gone
$$;
revoke all on function private.purge_apple_app_ids() from public, anon, authenticated, service_role;

-- Purge quotidienne (03:27 UTC) par pg_cron, comme celle des signalements ; sans l'extension (tests
-- locaux), la fonction s'appelle à la main. Un nom de tâche fixe : rejouer la migration ne la double pas.
do $cron$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-apple-app-ids-2-ans', '27 3 * * *',
      $job$select private.purge_apple_app_ids()$job$);
  end if;
end
$cron$;

-- Administration, en cas de doute :
--   select l.user_id, a.app_transaction_id, a.environment, a.first_trial_at, l.linked_at
--     from public.apple_app_links l join public.apple_app_ids a using (app_transaction_id)
--     order by l.linked_at desc;
-- Rendre l'essai à un identifiant Apple (cas d'un proche qui s'est connecté le premier sur l'iPhone) :
--   update public.apple_app_ids set first_trial_at = now() where app_transaction_id = '…';
