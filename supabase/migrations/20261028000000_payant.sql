-- ═══════════════════════════════════════════════════════════
--  Payant V1 : essai de 3 mois puis abonnement, « accès offert », codes cadeaux maison, élève de coach
--  gratuit (contrat : docs/PAYANT_V1.md).
--
--  Sécurité (le point le plus important : l'app ne décide jamais seule) :
--  - Le serveur fait foi. public.entitlements est la seule source de vérité du droit d'accès, et aucun
--    rôle de l'API ne peut l'écrire : RLS activée sans aucune politique, aucun GRANT à anon,
--    authenticated ni service_role. Même chose pour public.entitlement_claims (les transactions Apple
--    rattachées à un compte).
--  - L'essai démarre à l'heure du SERVEUR, jamais à celle de l'appareil : trial_started_at est posé par
--    now() dans my_access(), au premier appel, et n'est JAMAIS réécrit (insert ... on conflict do
--    nothing). Réinstaller l'app, vider le stockage ou changer l'horloge du téléphone ne redonne pas
--    d'essai, et aucune RPC ne prend de date en paramètre.
--  - Aucune RPC du client n'écrit ni ne prolonge un droit d'accès. Les deux seules fonctions qui
--    écrivent (public.srv_access_purchase et public.srv_access_event) sont réservées à service_role
--    (revoke de public, anon et authenticated) : seules les Edge Functions verify-purchase et
--    appstore-notify, qui ont la clé serveur, peuvent les appeler, et seulement après avoir vérifié la
--    signature d'Apple. Leur noyau est dans le schéma private, exécutable par aucun rôle de l'API.
--  - Un abonnement ne sert qu'à un compte : original_transaction_id est la clé primaire de
--    entitlement_claims et est unique dans entitlements. La même transaction présentée par un second
--    compte est refusée (transaction_taken), même si le premier compte n'a plus l'accès : la ligne de
--    entitlement_claims reste à son nom (elle ne part qu'avec son compte, on delete cascade).
--  - can_write vaut TOUJOURS true tant que app_config.paywall_on est faux (le verrou est livré éteint).
--  - Un élève suivi par un coach (public.coach_links) a can_write à true, statut coach_team.
--  - Un évènement arrivé dans le DÉSORDRE ne coupe pas un abonné (relecture du 28/10) : ni
--    Transaction.unfinished (ordre non garanti au lancement de l'app) ni les notifications V2
--    (réessayées jusqu'à 3 jours, ordre non garanti) ne peuvent faire reculer une date de fin.
--    entitlement_claims.event_at garde la date du dernier évènement appliqué, un évènement plus ancien
--    est ignoré, et la date de fin ne recule que quand Apple ferme l'accès lui-même (remboursement,
--    révocation, expiration, fin de grâce). Une transaction remboursée le reste.
--  - Notifications dédoublonnées (public.appstore_notifications, notificationUUID) : la déduplication
--    et l'écriture sont dans la MÊME transaction, donc une écriture qui échoue ne consomme pas la
--    notification et le réessai d'Apple la retraite.
--  - Achat orphelin repêché : si la transaction d'origine est inconnue du serveur, srv_access_event
--    retombe sur l'appAccountToken de la transaction (l'app y met l'identifiant du compte).
--  - Le verrou n'est PAS seulement côté app : un déclencheur before insert sur public.sessions refuse
--    une nouvelle séance quand le verrou est allumé et que can_write est faux (erreur paywall_locked).
--    Se déconnecter, enregistrer des séances puis se reconnecter ne passe donc plus. update et delete
--    restent ouverts : on ne perd rien et on peut corriger une séance déjà enregistrée.
--  - Codes cadeaux MAISON (public.gift_codes, ajout du 28/10 : les codes promotionnels d'Apple sont
--    limités à 100 par version, expirent en 28 jours et se saisissent dans l'App Store, donc
--    inutilisables ici). Créés UNIQUEMENT par l'administrateur en SQL (private.make_gift_code) : aucune
--    RPC n'en crée. Un code fait 10 à 24 caractères tirés au hasard parmi 32 symboles lisibles
--    (32^12 ≈ 1,2e18 pour la longueur par défaut) : la contrainte de la table l'impose, un code court
--    ou choisi à la main est refusé par la base.
--  - Deviner un code est compté : public.redeem_gift_code compte CHAQUE essai, réussi ou non, dans le
--    journal private.social_rate (10 par heure et par compte, rate_limited au-delà). Pour qu'un échec
--    reste compté, il est RENVOYÉ et non levé : Postgres annule tout ce qu'une fonction a écrit quand
--    elle lève une exception (et PostgREST lance chaque RPC dans sa transaction), donc un refus levé
--    effacerait le compteur et laisserait essayer des codes sans fin. redeem_gift_code renvoie donc
--    { ok: false, error: 'invalid_code' | 'code_expired' | 'code_used_up' | 'already_redeemed' } ;
--    seuls rate_limited et not_found (aucun utilisateur) sont levés, et les annuler ne gêne pas
--    (les essais déjà comptés sont, eux, enregistrés).
--  - Erreurs lisibles par l'app (message exact, errcode P0001) : not_found, transaction_taken,
--    unknown_product, invalid_transaction, rate_limited, paywall_locked.
--  - Suppression du compte : entitlements, entitlement_claims et gift_redemptions partent en cascade
--    avec auth.users (le code cadeau lui-même reste, son compteur uses ne redescend pas).
--  - GRANT explicites : anon n'a rien ; chaque fonction perd le droit d'exécution donné par défaut à
--    public (et à anon par Supabase), puis seul le rôle prévu le reçoit.
--
--  Choix pris là où le contrat ne disait rien (à relire ; repris dans docs/PAYANT_V1.md,
--  « Précisions du serveur ») :
--  1. Deux tables au lieu d'une. Le contrat décrit entitlements avec un seul original_transaction_id,
--     mais un compte peut très bien avoir un abonnement ET un « accès offert » (code promotionnel), ou
--     deux transactions successives. public.entitlement_claims garde chaque transaction vérifiée chez
--     Apple (une ligne par original_transaction_id, à vie) et public.entitlements garde l'instantané du
--     compte, avec exactement les colonnes du contrat. Sans ce registre, remplacer sa transaction par
--     une nouvelle libérerait l'ancienne, qu'un second compte pourrait alors réclamer.
--  2. L'état qui fait foi est RECALCULÉ à chaque lecture (private.access_json) : un essai ou un
--     abonnement arrive à terme sans que personne n'écrive rien. entitlements.status et
--     entitlements.in_coach_team ne sont que le dernier instantané connu, pour pouvoir regarder la base
--     à la main ; ils ne servent jamais à décider.
--  3. Ordre des statuts quand plusieurs droits se cumulent : gift > active > coach_team > trial >
--     expired. Le cadeau passe donc avant tout le reste ; un compte qui paie est « active » même s'il
--     est aussi élève d'un coach, et un élève de coach est « coach_team » même si son essai court
--     encore (c'est ce que le contrat demande d'afficher).
--  4. days_left : nombre de jours entiers restants, arrondi au plus grand (ceil), jamais négatif ;
--     null quand l'accès n'a pas de fin (accès à vie, coach_team). until : la fin de l'abonnement ou du
--     cadeau en jours (active, gift), la fin de l'essai (trial), la dernière date échue (expired), null
--     sans fin. gift_until : la fin d'un cadeau en jours, null pour un accès à vie ou sans cadeau.
--  4 bis. Un code cadeau en jours ajoute ses jours à partir du MAXIMUM entre maintenant et l'expiration
--     en cours (entitlements.expires_at) : deux codes de 30 jours donnent 60 jours, et un code utilisé
--     pendant un abonnement payé ne perd pas ses jours. entitlements.expires_at est donc la plus
--     lointaine des deux dates (abonnement, cadeau), et gift_until garde la part offerte.
--  5. access_state() sur un compte qui n'a encore jamais appelé my_access() : status trial,
--     days_left = trial_days et until null (l'essai n'a pas commencé), et rien n'est créé. L'essai ne
--     démarre qu'avec my_access(), que l'app appelle au lancement.
--  6. app_config : paywall_on faux et trial_days 90 à l'installation ; une valeur absente ou du mauvais
--     type retombe sur ces défauts (le verrou ne s'allume jamais tout seul). trial_days est borné à
--     0..3650 jours. Table lisible par authenticated (politique de lecture), écrite seulement par
--     l'administrateur (aucun GRANT d'écriture, même à service_role) :
--       update public.app_config set value = 'true'::jsonb, updated_at = now() where key = 'paywall_on';
--  7. Produits reconnus (private.access_product_kind) : les deux abonnements et l'accès offert, en dur
--     dans la migration. Un produit inconnu est refusé (unknown_product) plutôt qu'écrit : une
--     transaction d'un autre produit ne donne aucun accès.
--  8. Débit : 120 appels de srv_access_purchase par compte et par 24 h (journal private.social_rate,
--     même brique que le coach). L'écouteur Transaction.updates de StoreKit renvoie une transaction à
--     chaque renouvellement et à chaque restauration : 120 laisse large, et empêche une app modifiée de
--     marteler l'App Store Server API avec notre clé.
--  9. Verrou dur côté serveur (relecture du 28/10) : le déclencheur private.sessions_paywall refuse
--     l'INSERTION d'une séance quand le verrou est allumé et que can_write est faux. Seules les
--     nouvelles séances sont refusées : update et delete restent permis, pour ne rien perdre, pouvoir
--     corriger et pouvoir mettre à la corbeille. Un compte sans ligne entitlements voit son essai
--     démarrer là aussi, à l'heure du serveur : ne jamais appeler my_access() ne donne pas un essai
--     éternel.
--  10. revoked_at est GARDÉ (coalesce) : aucun évènement ultérieur ne réactive une transaction
--     remboursée. Conséquence connue et assumée : Apple garde la même transaction d'origine quand
--     quelqu'un se réabonne après un remboursement, il faut alors un geste de l'administrateur
--     (commande en bas de ce fichier). Côté sûr choisi : on ne redonne jamais l'accès tout seul.
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- Réglages du serveur lus par l'app. Écrits seulement par l'administrateur (éditeur SQL, rôle postgres).
create table public.app_config (
  key        text primary key check (key ~ '^[a-z_]{1,40}$'),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Le verrou est livré ÉTEINT (paywall_on faux) ; essai de 3 mois (90 jours)
insert into public.app_config (key, value) values
  ('paywall_on', 'false'::jsonb),
  ('trial_days', '90'::jsonb);

alter table public.app_config enable row level security;
-- Lecture seule pour un compte connecté : l'app a besoin de savoir si le verrou est allumé
create policy app_config_select on public.app_config for select to authenticated using (true);
revoke all on public.app_config from public, anon, authenticated, service_role;
grant select on public.app_config to authenticated;

-- Registre des transactions Apple vérifiées, une ligne par transaction d'origine, à vie : c'est lui qui
-- fait qu'un abonnement ne sert qu'à un compte (voir le choix 1 de l'en-tête). kind : abonnement ou
-- accès offert. expires_at : fin de la période payée (abonnements seulement). revoked_at :
-- remboursement ou révocation signalés par Apple.
-- event_at : date de l'évènement le plus récent déjà appliqué à cette transaction (purchaseDate pour
-- une transaction relue chez Apple, signedDate pour une notification). Un évènement plus ancien est
-- IGNORÉ : ni Transaction.unfinished (ordre non garanti au lancement), ni les notifications V2
-- (réessayées jusqu'à 3 jours, ordre non garanti) ne peuvent faire reculer une date de fin.
create table public.entitlement_claims (
  original_transaction_id text primary key check (char_length(original_transaction_id) between 1 and 64),
  user_id    uuid not null references auth.users(id) on delete cascade,
  product_id text not null check (char_length(product_id) between 1 and 128),
  kind       text not null check (kind in ('sub', 'gift')),
  expires_at timestamptz,
  revoked_at timestamptz,
  event_at   timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index entitlement_claims_user on public.entitlement_claims (user_id, kind);

-- Notifications d'Apple déjà traitées (déduplication) : Apple réessaie une notification jusqu'à
-- 3 jours, et peut l'envoyer deux fois. Gardées 30 jours, purgées à la notification suivante.
create table public.appstore_notifications (
  notification_uuid text primary key check (char_length(notification_uuid) between 1 and 64),
  at                timestamptz not null default now()
);
create index appstore_notifications_at on public.appstore_notifications (at);

-- Instantané du droit d'accès d'un compte (colonnes du contrat). trial_started_at : heure du serveur au
-- premier my_access(), jamais réécrite. gift : accès à VIE (non consommable d'Apple ou code cadeau
-- lifetime). gift_until : fin d'un cadeau en jours, cumulée à chaque code. expires_at : la plus
-- lointaine des deux dates (abonnement payé, cadeau en jours). status et in_coach_team : dernier
-- calcul, jamais une décision.
create table public.entitlements (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  status                  text not null default 'trial'
                            check (status in ('trial', 'active', 'expired', 'gift', 'coach_team')),
  product_id              text,
  expires_at              timestamptz,
  original_transaction_id text unique
                            references public.entitlement_claims(original_transaction_id) on delete set null,
  trial_started_at        timestamptz not null default now(),
  gift                    boolean not null default false,
  gift_until              timestamptz,
  in_coach_team           boolean not null default false,
  updated_at              timestamptz not null default now()
);

-- Codes cadeaux maison. Écrits SEULEMENT par l'administrateur (private.make_gift_code, rôle postgres) :
-- aucune RPC n'en crée. Le format impose 10 à 24 caractères parmi 32 symboles lisibles (sans 0/O/1/I) :
-- un code choisi à la main, court ou devinable est refusé par la base.
-- kind : lifetime (accès à vie) ou days (N jours offerts, cumulables).
create table public.gift_codes (
  code       text primary key check (code ~ '^[A-HJ-NP-Z2-9]{10,24}$'),
  kind       text not null check (kind in ('lifetime', 'days')),
  days       int check (days between 1 and 3650),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses   int not null default 1 check (max_uses between 1 and 100000),
  uses       int not null default 0 check (uses >= 0),
  note       text check (char_length(note) <= 200),
  -- days obligatoire et seulement pour kind = 'days'
  constraint gift_codes_days check ((kind = 'days') = (days is not null)),
  constraint gift_codes_uses check (uses <= max_uses)
);
create index gift_codes_kind on public.gift_codes (kind, created_at desc);

-- Un compte n'utilise un code qu'une fois (clé primaire). Gardé après usage : c'est lui qui dit
-- qu'un accès à vie a été offert, et qui refuse un second passage.
create table public.gift_redemptions (
  code        text not null references public.gift_codes(code) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);
create index gift_redemptions_user on public.gift_redemptions (user_id);

alter table public.entitlements enable row level security;
alter table public.entitlement_claims enable row level security;
alter table public.appstore_notifications enable row level security;
alter table public.gift_codes enable row level security;
alter table public.gift_redemptions enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT). Les Edge Functions
-- n'écrivent pas les tables, elles appellent les fonctions srv_* ci-dessous ; l'app passe par
-- redeem_gift_code. Personne ne LIT gift_codes : sans quoi tous les codes seraient connus.
revoke all on public.entitlements, public.entitlement_claims, public.appstore_notifications,
  public.gift_codes, public.gift_redemptions from public, anon, authenticated, service_role;

-- ── Briques privées ──────────────────────────────────────

-- Produit d'App Store Connect → nature du droit, ou null si le produit n'est pas des nôtres
create function private.access_product_kind(product_id text) returns text
  language sql immutable set search_path = '' as
$$
  select case product_id
    when 'com.mdlf.training.pro.monthly' then 'sub'
    when 'com.mdlf.training.pro.yearly'  then 'sub'
    when 'com.mdlf.training.access.gift' then 'gift'
  end
$$;

-- Verrou livré éteint : une valeur absente, nulle ou d'un autre type vaut false
create function private.access_paywall_on() returns boolean
  language sql stable set search_path = '' as
$$
  select coalesce((select case when jsonb_typeof(c.value) = 'boolean' then (c.value)::text::boolean end
                   from public.app_config c where c.key = 'paywall_on'), false)
$$;

-- Durée de l'essai en jours (90 par défaut), bornée à 0..3650
create function private.access_trial_days() returns int
  language sql stable set search_path = '' as
$$
  select coalesce((select case when jsonb_typeof(c.value) = 'number'
                                then least(greatest(floor((c.value)::text::numeric), 0), 3650)::int end
                   from public.app_config c where c.key = 'trial_days'), 90)
$$;

-- État complet du droit d'accès d'un compte, recalculé à l'heure du serveur : rien n'est lu dans
-- entitlements.status (voir le choix 2 de l'en-tête). Ne crée rien. not_found sans utilisateur.
-- Renvoie exactement les 10 clés du contrat.
create function private.access_json(uid uuid) returns jsonb
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

-- Instantané de public.entitlements recalculé depuis les transactions du compte et ses codes cadeaux.
-- L'accès offert l'emporte dans le résumé ; sinon la transaction dont la période payée va le plus loin.
-- gift_until n'est jamais recalculé (il cumule les codes, voir redeem_gift_code), seulement relu.
create function private.access_refresh(uid uuid) returns void
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

-- Rattacher une transaction vérifiée chez Apple à un compte, puis recalculer son accès.
-- Noyau commun de verify-purchase et appstore-notify. Refuse une transaction déjà au nom d'un autre
-- compte (transaction_taken), un produit qui n'est pas des nôtres (unknown_product), une transaction
-- mal formée (invalid_transaction) et un compte inconnu (not_found).
--
-- Trois règles qui protègent un abonné contre un évènement arrivé dans le désordre :
--  - p_event_at plus ancien que le dernier évènement appliqué : la ligne n'est PAS touchée (clause
--    where du on conflict). Ni Transaction.unfinished (ordre non garanti) ni une notification
--    réessayée ne peuvent défaire un renouvellement déjà connu.
--  - la date de fin ne RECULE jamais (greatest), sauf quand Apple ferme l'accès lui-même : un
--    remboursement, une révocation, une expiration ou une fin de grâce (p_revoked ou p_force).
--  - revoked_at est gardé : un évènement qui n'est pas une révocation ne RÉACTIVE jamais une
--    transaction remboursée (coalesce). Un réabonnement d'Apple garde la même transaction d'origine :
--    pour le rouvrir à la main, voir la commande en bas de ce fichier.
create function private.access_claim(p_user uuid, p_product text, p_expires timestamptz,
                                     p_original_tx text, p_revoked boolean,
                                     p_event_at timestamptz default null,
                                     p_force boolean default false) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  k     text := private.access_product_kind(p_product);
  owner uuid;
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
  -- Deux comptes qui présentent la même transaction en même temps : l'un des deux attend et sera refusé
  perform pg_advisory_xact_lock(hashtextextended('access_tx:' || p_original_tx, 0));
  select c.user_id into owner from public.entitlement_claims c
    where c.original_transaction_id = p_original_tx;
  if owner is not null and owner <> p_user then
    raise exception 'transaction_taken' using errcode = 'P0001';
  end if;
  insert into public.entitlement_claims as c
      (original_transaction_id, user_id, product_id, kind, expires_at, revoked_at, event_at)
    values (p_original_tx, p_user, p_product, k,
            case when k = 'sub' then p_expires end,
            case when p_revoked then now() end,
            p_event_at)
  on conflict (original_transaction_id) do update set
    product_id = excluded.product_id,
    kind       = excluded.kind,
    -- La date de fin ne recule que si Apple ferme l'accès (remboursement, révocation, expiration)
    expires_at = case when p_revoked or p_force then excluded.expires_at
                      else greatest(c.expires_at, excluded.expires_at) end,
    -- Une transaction remboursée le reste : aucun évènement ultérieur ne la réactive
    revoked_at = coalesce(c.revoked_at, excluded.revoked_at),
    event_at   = greatest(c.event_at, excluded.event_at),
    updated_at = now()
  -- Évènement plus ancien que le dernier appliqué : rien n'est touché
  where c.event_at is null or excluded.event_at is null or excluded.event_at >= c.event_at;
  perform private.access_refresh(p_user);
  return private.access_json(p_user);
end
$$;

-- ── Codes cadeaux maison ─────────────────────────────────

-- Code saisi → forme stockée (majuscules, sans espaces ni tirets), ou null s'il ne peut pas exister
-- (même saisie souple que coach_join : « abcd-efgh-jklm » = « ABCDEFGHJKLM »)
create function private.gift_code_norm(c text) returns text
  language sql immutable set search_path = '' as
$$
  select case when v ~ '^[A-HJ-NP-Z2-9]{10,24}$' then v end
  from (select upper(regexp_replace(coalesce(c, ''), '[\s-]', '', 'g')) as v) x
$$;

-- Nouveau code de 12 caractères : 12 octets entièrement aléatoires d'un UUID v4 (les octets 6 et 8
-- portent la version et la variante, ils sont évités), chacun réduit à 32 symboles (256 = 8 × 32 :
-- pas de biais). 32^12 ≈ 1,2e18 codes possibles : un code ne se devine pas.
create function private.gift_new_code() returns text
  language sql volatile set search_path = '' as
$$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', get_byte(b, i) % 32 + 1, 1), '' order by i)
  from (select uuid_send(gen_random_uuid()) as b) r, unnest(array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13]) i
$$;

-- ADMINISTRATION (éditeur SQL, rôle postgres) : crée n codes d'un coup et les renvoie.
-- Exécutable par aucun rôle de l'API : un client ne peut pas se fabriquer de code.
--   select private.make_gift_code('days', 90, 20, 'Beta testeurs');       -- 20 codes de 90 jours
--   select private.make_gift_code('lifetime', null, 3, 'Famille');        -- 3 accès à vie
--   select private.make_gift_code('days', 30, 1, 'Salon', interval '60 days', 50);  -- 1 code, 50 usages
create function private.make_gift_code(kind text, days int default null, n int default 1,
                                       note text default null,
                                       valid_for interval default interval '1 year',
                                       uses_max int default 1) returns setof text
  language plpgsql volatile set search_path = '' as
$$
declare
  c text;
  i int;
begin
  if make_gift_code.kind is null or make_gift_code.kind not in ('lifetime', 'days') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  for i in 1..greatest(coalesce(make_gift_code.n, 1), 1) loop
    loop
      c := private.gift_new_code();
      insert into public.gift_codes (code, kind, days, expires_at, max_uses, note)
        values (c, make_gift_code.kind,
                case when make_gift_code.kind = 'days' then make_gift_code.days end,
                case when make_gift_code.valid_for is null then null else now() + make_gift_code.valid_for end,
                greatest(coalesce(make_gift_code.uses_max, 1), 1),
                make_gift_code.note)
        on conflict do nothing;
      exit when found;
    end loop;
    return next c;
  end loop;
end
$$;

-- Refus de redeem_gift_code : RENVOYÉ et non levé, pour que l'essai reste compté (voir l'en-tête).
create function private.gift_refused(uid uuid, err text) returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('ok', false, 'error', err, 'kind', null, 'access', private.access_json(uid))
$$;

-- ── Fonctions RPC du client (authenticated seulement) ────

-- Utiliser un code cadeau. Renvoie { ok, error, kind, access } : « access » est la charge utile de
-- my_access(), pour que l'app se rafraîchisse d'un seul appel.
-- ATTENTION (et c'est voulu) : un refus de code n'est pas une exception, il est dans « error »
-- (invalid_code, code_expired, code_used_up, already_redeemed). Sans cela, Postgres annulerait le
-- comptage de l'essai et on pourrait tenter des codes sans fin. Seuls rate_limited (plus de 10 essais
-- par heure, réussis OU ratés) et not_found (aucun utilisateur) sont levés en P0001.
create function public.redeem_gift_code(code text) returns jsonb
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

-- État du droit d'accès, et DÉMARRAGE de l'essai au premier appel, à l'heure du serveur.
-- trial_started_at n'est jamais réécrit : rappeler la fonction ne prolonge rien.
create function public.my_access() returns jsonb
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

-- Même état, en lecture seule : ne crée rien et ne démarre donc pas l'essai (écrans qui ne doivent
-- pas le lancer). Compte qui n'a jamais appelé my_access() : trial, days_left = trial_days, until null.
create function public.access_state() returns jsonb
  language sql stable security definer set search_path = '' as
$$ select private.access_json((select auth.uid())) $$;

-- ── Fonctions du serveur (service_role seulement) ────────
-- Appelées par les Edge Functions verify-purchase et appstore-notify avec la clé serveur, une fois la
-- signature d'Apple vérifiée. Aucun client ne peut les exécuter (revoke de public, anon, authenticated).

-- verify-purchase : la transaction relue chez Apple est rattachée au compte de l'appelant.
-- p_event_at : purchaseDate de la transaction (stable d'une relecture à l'autre, et croissant d'un
-- renouvellement au suivant) : une transaction du mois N parcourue après celle du mois N+1
-- (Transaction.unfinished, ordre non garanti) ne fait plus reculer la date de fin.
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

-- appstore-notify : un évènement d'Apple ne dit pas quel compte est concerné, il porte la transaction
-- d'origine. Tout est fait ici dans UNE transaction de base de données (déduplication comprise) : si
-- l'écriture échoue, la notification n'est pas marquée vue et le réessai d'Apple la retraitera.
--  - p_uuid : notificationUUID. Déjà vu : { duplicate: true }, rien n'est réécrit.
--  - p_event_at : signedDate de la notification. Plus ancien que le dernier évènement appliqué :
--    la transaction n'est pas touchée (private.access_claim).
--  - p_force : vrai pour les évènements où Apple FERME l'accès (EXPIRED, GRACE_PERIOD_EXPIRED), seuls
--    cas où la date de fin peut reculer.
--  - p_account_token : appAccountToken de la transaction (l'app y met l'identifiant du compte). Il
--    sert de repêchage quand la transaction d'origine est inconnue (achat jamais remonté par l'app) :
--    sans lui, l'achat resterait orphelin pour toujours.
-- Transaction inconnue et sans repêchage, ou produit qui n'est pas des nôtres : { matched: false }, et
-- la fonction Edge répond 200 pour qu'Apple ne réessaie pas sans fin.
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

-- ── Verrou côté serveur (le client ne décide pas) ────────

-- Le verrou ne peut pas vivre seulement dans l'app : se déconnecter met can_write à vrai côté app, et
-- la synchronisation suivante téléverserait tout. Ce déclencheur refuse donc une NOUVELLE séance quand
-- le verrou est allumé et que le droit d'écrire est tombé. update et delete restent ouverts : on ne
-- perd rien, on peut corriger une séance déjà enregistrée et la mettre à la corbeille.
-- Verrou éteint : aucun coût (une seule lecture de app_config, et rien d'autre).
create function private.sessions_paywall() returns trigger
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
-- Nommé pour passer avant sessions_touch (les déclencheurs d'une table se suivent par ordre de nom)
create trigger sessions_paywall before insert on public.sessions
  for each row execute function private.sessions_paywall();

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.access_product_kind(text) from public, anon, authenticated, service_role;
revoke all on function private.access_paywall_on() from public, anon, authenticated, service_role;
revoke all on function private.access_trial_days() from public, anon, authenticated, service_role;
revoke all on function private.access_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_refresh(uuid) from public, anon, authenticated, service_role;
revoke all on function private.access_claim(uuid, text, timestamptz, text, boolean, timestamptz, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.sessions_paywall() from public, anon, authenticated, service_role;
revoke all on function private.gift_code_norm(text) from public, anon, authenticated, service_role;
revoke all on function private.gift_new_code() from public, anon, authenticated, service_role;
revoke all on function private.gift_refused(uuid, text) from public, anon, authenticated, service_role;
-- Création des codes : l'administrateur et personne d'autre
revoke all on function private.make_gift_code(text, int, int, text, interval, int)
  from public, anon, authenticated, service_role;

revoke all on function public.my_access() from public, anon, authenticated;
revoke all on function public.access_state() from public, anon, authenticated;
revoke all on function public.redeem_gift_code(text) from public, anon, authenticated;
grant execute on function public.my_access() to authenticated;
grant execute on function public.access_state() to authenticated;
grant execute on function public.redeem_gift_code(text) to authenticated;

-- Écriture du droit d'accès : la clé serveur et personne d'autre
revoke all on function public.srv_access_purchase(uuid, text, timestamptz, text, boolean, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.srv_access_purchase(uuid, text, timestamptz, text, boolean, timestamptz) to service_role;
grant execute on function public.srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text) to service_role;

-- Comptes dont l'abonnement vient de tomber, à regarder à la main en cas de doute :
--   select user_id, status, product_id, expires_at from public.entitlements
--     where status = 'expired' and expires_at is not null order by expires_at desc;
-- Codes cadeaux et leur usage :
--   select code, kind, days, uses, max_uses, expires_at, note from public.gift_codes order by created_at desc;
-- Réabonnement après un remboursement : Apple garde la même transaction d'origine, et revoked_at est
-- gardé exprès (un évènement en retard ne doit pas réactiver un remboursé). Pour rouvrir l'accès :
--   update public.entitlement_claims set revoked_at = null, event_at = null
--     where original_transaction_id = '…';
--   select private.access_refresh('<user_id>');
