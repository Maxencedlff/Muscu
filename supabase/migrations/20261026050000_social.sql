-- ═══════════════════════════════════════════════════════════
--  Social V1 : abonnements, blocages, bravos, signalements (contrat : docs/SOCIAL_V1.md)
--
--  Sécurité :
--  - Comptes privés : on ne voit les séances de quelqu'un qu'après qu'il a accepté la demande, que son
--    social est activé (user_profiles.social_at) et qu'aucun blocage n'existe, dans un sens ou dans
--    l'autre (private.can_see, seule règle de visibilité, utilisée par feed et toggle_bravo).
--  - Aucune lecture ni écriture directe sur follows, blocks, bravos et reports : RLS activée sans
--    aucune politique, et aucun GRANT à anon ni à authenticated. Tout passe par les fonctions RPC
--    ci-dessous, security definer (propriétaire postgres), search_path vide (noms qualifiés) et
--    utilisateur pris dans auth.uid(), jamais dans un paramètre. reports n'est écrit que par la
--    fonction Edge report (clé serveur, service_role).
--  - user_profiles garde sa RLS « sa ligne seulement ». social_at n'a aucun GRANT par colonne : le
--    client ne peut l'écrire qu'avec social_enable et social_disable.
--  - Liste blanche : une séance montrée à un autre passe par private.session_public, qui recopie
--    seulement { date, duration, programme, category, label, exercises: [{ name, measure, sets:
--    [{ weight, reps, dist }] }] }, avec des valeurs simples (texte, nombre, booléen). Jamais notes,
--    bodyKg, healthSaved, hidden, ni une clé ajoutée plus tard dans sessions.data.
--  - Blocage jamais révélé : la recherche et le fil se taisent. Une demande vers quelqu'un qui m'a
--    bloqué (ou que j'ai bloqué, ou sans social) crée une demande « fantôme » (status 'ghost') : je la
--    vois dans social_state.requested comme une demande normale, mais elle n'existe pour personne
--    d'autre (ni pending_in, ni badge, ni respond_follow, ni can_see) et ne devient jamais une vraie
--    demande. Bloquer supprime mes demandes et abonnements vers l'autre, son abonnement vers moi et les
--    bravos échangés ; sa demande en attente devient fantôme (de son côté, rien ne change, comme une
--    demande sans réponse). Débloquer supprime les fantômes entre les deux comptes. Demandes et
--    blocages d'une même paire de comptes sont sérialisés (verrou private.lock_pair) : une demande
--    envoyée pendant un blocage en cours ne passe pas entre les mailles.
--  - Le social de l'appelant est requis pour feed, search_profiles et toggle_bravo (sinon rien, ou
--    not_found) : on ne regarde pas les autres sans être soi-même visible.
--  - Fil : curseur complet (done_at, user_id, id) pour les séances à la même milliseconde ; séances
--    datées à plus de 24 h dans le futur ignorées (elles resteraient sinon en tête du fil). Textes
--    tronqués à 200 caractères, 60 exercices et 100 séries au plus par séance montrée (une séance très
--    compressible passe la limite de taille stockée mais pèserait des Mo une fois envoyée).
--  - Limites sur 24 h glissantes : 30 demandes d'abonnement et 200 bravos donnés (journal
--    private.social_rate, qui compte aussi les demandes neutres et les bravos retirés puis remis, pour
--    qu'annuler et recommencer ne contourne rien), 10 signalements (comptés sur reports).
--  - Signalements gardés 12 mois : purge quotidienne par pg_cron quand l'extension est disponible
--    (cas de Supabase), et à chaque nouveau signalement dans tous les cas (déclencheur).
--  - Erreurs lisibles par l'app (message exact, errcode P0001) : social_not_enabled,
--    username_required, age_required, rate_limited, not_found.
--  - Suppression du compte : toutes les lignes partent en cascade avec auth.users.
--  - GRANT explicites (obligatoires depuis le 30/10/2026) : anon n'a rien ; chaque fonction perd
--    d'abord le droit d'exécution donné par défaut à public (et à anon par Supabase), puis seul
--    authenticated le reçoit. Les fonctions de private ne sont exécutables par aucun rôle de l'API.
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- Social activé : date de l'activation, null sinon. Pas de GRANT par colonne (voir 20261026000000_profils.sql :
-- le client n'écrit que username et avatar_emoji).
alter table public.user_profiles add column social_at timestamptz;

-- Recherche par préfixe du pseudo parmi les profils visibles. text_pattern_ops : comparaison octet par
-- octet (~>=~, ~<~) indexable quelle que soit la collation de la base.
create index user_profiles_social_username on public.user_profiles (username text_pattern_ops)
  where social_at is not null and username is not null;

-- Date de la séance (ms depuis 1970, data.date côté app) pour trier le fil. Expression écrite avec des
-- fonctions intégrées seulement : elle est évaluée avec les droits de qui écrit la ligne
-- (authenticated, sans accès au schéma private). CASE imbriqués : le test de type passe avant la
-- conversion (l'ordre d'un AND n'est pas garanti). Date absente, non numérique ou hors bornes : null
-- (la séance n'apparaît pas dans le fil, mais la synchro ne casse jamais).
alter table public.sessions add column done_at bigint generated always as (
  case when jsonb_typeof(data -> 'date') = 'number' then
    case when (data ->> 'date')::numeric between 0 and 100000000000000
      then floor((data ->> 'date')::numeric)::bigint end
  end
) stored;
create index sessions_user_done on public.sessions (user_id, done_at desc, id desc)
  where deleted_at is null and done_at is not null;

create table public.follows (
  follower_id  uuid not null references auth.users(id) on delete cascade,
  followee_id  uuid not null references auth.users(id) on delete cascade,
  -- ghost : demande fantôme, visible seulement par son auteur (voir l'en-tête)
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'ghost')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
-- Demandes reçues et abonnés (la clé primaire sert déjà « qui je suis »)
create index follows_followee on public.follows (followee_id, status);

create table public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
-- Sens inverse : « m'a-t-il bloqué ? »
create index blocks_blocked on public.blocks (blocked_id, blocker_id);

create table public.bravos (
  session_owner uuid not null references auth.users(id) on delete cascade,
  session_id    text not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (session_owner, session_id, user_id),
  -- Un bravo vise une séance qui existe (elles ne sont jamais effacées, sauf avec le compte)
  foreign key (session_owner, session_id) references public.sessions(user_id, id) on delete cascade,
  constraint bravos_not_self check (session_owner <> user_id)
);
-- Bravos donnés (suppression au blocage)
create index bravos_user on public.bravos (user_id, session_owner);

-- Signalements, écrits seulement par la fonction Edge report (service_role). target_username : le
-- pseudo au moment du signalement (il peut changer ensuite), posé par le déclencheur. notified_at :
-- e-mail d'alerte parti (null = à traiter sans alerte, voir la requête en bas de ce fichier).
create table public.reports (
  id              bigint generated always as identity primary key,
  reporter_id     uuid not null references auth.users(id) on delete cascade,
  target_user     uuid not null references auth.users(id) on delete cascade,
  target_username text,
  kind            text not null check (kind in ('profile', 'session')),
  target_ref      text check (char_length(target_ref) between 1 and 64),
  reason          text not null check (reason in ('spam', 'harcelement', 'sexuel', 'violence', 'haine', 'autre')),
  details         text check (char_length(details) <= 500),
  created_at      timestamptz not null default now(),
  notified_at     timestamptz,
  constraint reports_not_self check (reporter_id <> target_user)
);
create index reports_reporter_at on public.reports (reporter_id, created_at desc);
create index reports_at on public.reports (created_at);

-- Journal des limites par jour (demandes, bravos) : une ligne par action comptée, purgée après 24 h
create table private.social_rate (
  user_id uuid not null references auth.users(id) on delete cascade,
  action  text not null,
  at      timestamptz not null default now()
);
create index social_rate_user_action_at on private.social_rate (user_id, action, at);

alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.bravos enable row level security;
alter table public.reports enable row level security;
alter table private.social_rate enable row level security;
-- Aucune politique : RLS fermée pour anon et authenticated (défense en profondeur, en plus des GRANT)
revoke all on public.follows, public.blocks, public.bravos, public.reports from public, anon, authenticated;
revoke all on private.social_rate from public, anon, authenticated, service_role;
-- La fonction Edge report insère, relit la ligne insérée et note l'envoi de l'alerte
revoke all on public.follows, public.blocks, public.bravos, public.reports from service_role;
grant select, insert, update (notified_at) on public.reports to service_role;

-- ── Briques privées (schéma non exposé, appelées depuis les fonctions security definer) ──

-- Limite sur 24 h glissantes : refuse (rate_limited) au-delà de max_per_day, sinon compte l'action. Verrou
-- de transaction par utilisateur et action : deux appels simultanés ne passent pas tous les deux.
create function private.rate_limit(uid uuid, action text, max_per_day int) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  perform pg_advisory_xact_lock(hashtextextended('social_rate:' || action || ':' || uid::text, 0));
  delete from private.social_rate r where r.user_id = uid and r.action = rate_limit.action and r.at < now() - interval '24 hours';
  if (select count(*) from private.social_rate r where r.user_id = uid and r.action = rate_limit.action) >= max_per_day then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into private.social_rate (user_id, action) values (uid, rate_limit.action);
end
$$;

-- Verrou de transaction sur une paire de comptes (ordre indifférent) : request_follow, respond_follow,
-- block_user et unblock_user d'une même paire passent l'un après l'autre. Pris avant tout autre verrou
-- (rate_limit) : toujours le même ordre, pas d'interblocage.
create function private.lock_pair(a uuid, b uuid) returns void
  language plpgsql set search_path = '' as
$$
begin
  perform pg_advisory_xact_lock(hashtextextended('pair:' || least(a::text, b::text) || ':' || greatest(a::text, b::text), 0));
end
$$;

-- Social activé ?
create function private.social_on(uid uuid) returns boolean
  language sql stable set search_path = '' as
$$ select exists (select 1 from public.user_profiles p where p.user_id = uid and p.social_at is not null) $$;

-- Blocage entre deux comptes, dans un sens ou dans l'autre
create function private.blocked_between(a uuid, b uuid) returns boolean
  language sql stable set search_path = '' as
$$
  select exists (
    select 1 from public.blocks k
    where (k.blocker_id = a and k.blocked_id = b) or (k.blocker_id = b and k.blocked_id = a)
  )
$$;

-- Seule règle de visibilité : viewer voit les séances de owner (abonnement accepté, social activé des
-- deux côtés, aucun blocage). Un compte qui a désactivé le social ne voit plus rien non plus.
create function private.can_see(viewer uuid, owner uuid) returns boolean
  language sql stable set search_path = '' as
$$
  select viewer is not null and owner is not null and viewer <> owner
     and exists (select 1 from public.follows f
                 where f.follower_id = viewer and f.followee_id = owner and f.status = 'accepted')
     and private.social_on(viewer) and private.social_on(owner)
     and not private.blocked_between(viewer, owner)
$$;

-- Borne haute des dates montrées : maintenant + 24 h, en ms (une horloge d'iPhone en avance passe,
-- une séance datée de l'an 5000 non)
create function private.max_done_at() returns bigint
  language sql stable set search_path = '' as
$$ select (extract(epoch from now()) * 1000)::bigint + 86400000 $$;

-- Séance montrable aux abonnés : non supprimée, datée, pas dans le futur lointain, non masquée
-- (hidden: true ; « true » en texte compte aussi, par prudence)
create function private.session_shown(data jsonb, deleted_at timestamptz, done_at bigint) returns boolean
  language sql stable set search_path = '' as
$$
  select deleted_at is null and done_at is not null and done_at <= private.max_done_at()
     and coalesce(data ->> 'hidden', '') <> 'true'
$$;

-- Valeur simple (texte de 200 caractères au plus, nombre, booléen) ou null : un objet glissé à la
-- place d'un nom ne fait pas sortir de clés, un texte géant ne sort pas en entier
create function private.scalar(v jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case jsonb_typeof(v)
    when 'string' then to_jsonb(left(v #>> '{}', 200))
    when 'number' then v
    when 'boolean' then v
  end
$$;

-- Liste blanche d'une séance vue par un autre (docs/SOCIAL_V1.md). Clés absentes ou nulles omises.
create function private.session_public(data jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select jsonb_strip_nulls(jsonb_build_object(
    'date',      private.scalar(data -> 'date'),
    'duration',  private.scalar(data -> 'duration'),
    'programme', private.scalar(data -> 'programme'),
    'category',  private.scalar(data -> 'category'),
    'label',     private.scalar(data -> 'label'),
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',    private.scalar(e.v -> 'name'),
        'measure', private.scalar(e.v -> 'measure'),
        'sets',    coalesce((
          select jsonb_agg(jsonb_build_object(
            'weight', private.scalar(st.v -> 'weight'),
            'reps',   private.scalar(st.v -> 'reps'),
            'dist',   private.scalar(st.v -> 'dist')
          ) order by st.n)
          from jsonb_array_elements(case when jsonb_typeof(e.v -> 'sets') = 'array' then e.v -> 'sets' else '[]'::jsonb end)
               with ordinality as st(v, n)
          where jsonb_typeof(st.v) = 'object' and st.n <= 100
        ), '[]'::jsonb)
      ) order by e.n)
      from jsonb_array_elements(case when jsonb_typeof(data -> 'exercises') = 'array' then data -> 'exercises' else '[]'::jsonb end)
           with ordinality as e(v, n)
      where jsonb_typeof(e.v) = 'object' and e.n <= 60
    ), '[]'::jsonb)
  ))
$$;

-- Personne d'une liste de social_state : { user_id, username, avatar, since }. only_social : pseudo et
-- avatar seulement si son social est activé (liste des bloqués : un compte sans social a pu être
-- bloqué par son identifiant, son pseudo ne doit pas en sortir)
create function private.person(uid uuid, since timestamptz, only_social boolean default false) returns jsonb
  language sql stable set search_path = '' as
$$
  select jsonb_build_object(
    'user_id', uid,
    'username', case when not only_social or p.social_at is not null then p.username end,
    'avatar', case when not only_social or p.social_at is not null then p.avatar_emoji end,
    'since', since)
  from (select 1) one left join public.user_profiles p on p.user_id = uid
$$;

-- Signalement (fonction Edge report) : 10 par 24 h et par compte (rate_limited), date et pseudo visé
-- posés par le serveur, signalements de plus de 12 mois purgés (durée annoncée dans privacy.html).
create function private.report_before_insert() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  perform pg_advisory_xact_lock(hashtextextended('report:' || new.reporter_id::text, 0));
  if (select count(*) from public.reports r
      where r.reporter_id = new.reporter_id and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  new.created_at := now();
  new.notified_at := null;
  new.target_username := (select p.username from public.user_profiles p where p.user_id = new.target_user);
  delete from public.reports r where r.created_at < now() - interval '12 months';
  return new;
end
$$;
create trigger reports_before_insert before insert on public.reports
  for each row execute function private.report_before_insert();

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- Activer le social : pseudo obligatoire (pour être trouvé), case « J'ai 15 ans ou plus » cochée.
-- Rappeler la fonction ne change pas la date d'activation.
create function public.social_enable(age_ok boolean) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or not exists (select 1 from public.user_profiles p where p.user_id = me and p.username is not null) then
    raise exception 'username_required' using errcode = 'P0001';
  end if;
  if age_ok is not true then
    raise exception 'age_required' using errcode = 'P0001';
  end if;
  update public.user_profiles p set social_at = coalesce(p.social_at, now()) where p.user_id = me;
end
$$;

-- Désactiver : invisible dans la recherche, séances invisibles pour les abonnés ; relations gardées
create function public.social_disable() returns void
  language sql security definer set search_path = '' as
$$ update public.user_profiles p set social_at = null where p.user_id = (select auth.uid()) and p.social_at is not null $$;

-- État de l'onglet Amis. since : date de la demande (en attente) ou de l'acceptation (abonnement),
-- du blocage pour les bloqués. Listes du plus récent au plus ancien. requested comprend mes demandes
-- fantômes (indiscernables) ; pending_in, badge, following et followers ignorent les comptes avec qui
-- un blocage existe (défense en profondeur : le blocage supprime déjà ces lignes).
create function public.social_state() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id)
  select jsonb_build_object(
    'enabled',    coalesce(p.social_at is not null, false),
    'username',   p.username,
    'avatar',     p.avatar_emoji,
    'pending_in', coalesce((select jsonb_agg(private.person(f.follower_id, f.created_at) order by f.created_at desc)
                            from public.follows f where f.followee_id = me.id and f.status = 'pending'
                              and not private.blocked_between(me.id, f.follower_id)), '[]'::jsonb),
    'following',  coalesce((select jsonb_agg(private.person(f.followee_id, f.responded_at) order by f.responded_at desc)
                            from public.follows f where f.follower_id = me.id and f.status = 'accepted'
                              and not private.blocked_between(me.id, f.followee_id)), '[]'::jsonb),
    'followers',  coalesce((select jsonb_agg(private.person(f.follower_id, f.responded_at) order by f.responded_at desc)
                            from public.follows f where f.followee_id = me.id and f.status = 'accepted'
                              and not private.blocked_between(me.id, f.follower_id)), '[]'::jsonb),
    'requested',  coalesce((select jsonb_agg(private.person(f.followee_id, f.created_at) order by f.created_at desc)
                            from public.follows f where f.follower_id = me.id and f.status in ('pending', 'ghost')), '[]'::jsonb),
    'blocked',    coalesce((select jsonb_agg(private.person(k.blocked_id, k.created_at, true) order by k.created_at desc)
                            from public.blocks k where k.blocker_id = me.id), '[]'::jsonb),
    'badge',      (select count(*)::int from public.follows f where f.followee_id = me.id and f.status = 'pending'
                     and not private.blocked_between(me.id, f.follower_id))
  )
  from me left join public.user_profiles p on p.user_id = me.id
$$;

-- Recherche par préfixe du pseudo. q normalisé : sans espaces autour, sans « @ », accents retirés
-- (translate : l'extension unaccent n'est pas forcément installée ; majuscules accentuées comprises,
-- car lower() ne les connaît pas sous la collation C), minuscules. Moins de 2 caractères : rien.
-- Préfixe par plage octet par octet : v <= pseudo < v || '~' (« ~ » vient après tous les caractères
-- permis dans un pseudo), servie par l'index user_profiles_social_username et triée dans son ordre
-- (USING ~<~) : la correspondance exacte vient d'elle-même en premier, et seules 20 lignes sont lues.
-- Pas de LIKE, donc rien à échapper : « % » et « _ » sont des caractères comme les autres. Exclus :
-- soi-même, les profils sans social, les blocages dans les deux sens. L'appelant doit avoir activé le
-- social (sinon rien) : on ne parcourt pas l'annuaire sans y figurer.
-- relation : 'following' (abonnement accepté), 'requested' (ma demande en attente, fantôme compris),
-- 'follows_you' (son abonnement à moi est accepté), sinon 'none'.
create function public.search_profiles(q text) returns table (user_id uuid, username text, avatar text, relation text)
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id),
  norm as (
    select lower(translate(replace(btrim(coalesce(q, '')), '@', ''),
      'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝŸýÿ',
      'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYYyy')) as v
  ),
  pat as (select norm.v from norm where char_length(norm.v) between 2 and 20)
  select p.user_id, p.username, p.avatar_emoji,
    case
      when f_out.status = 'accepted' then 'following'
      when f_out.status in ('pending', 'ghost') then 'requested'
      when f_in.status = 'accepted' then 'follows_you'
      else 'none'
    end
  from me, pat
  join public.user_profiles p on p.username operator(pg_catalog.~>=~) pat.v
                             and p.username operator(pg_catalog.~<~) (pat.v || '~')
  left join public.follows f_out on f_out.follower_id = (select id from me) and f_out.followee_id = p.user_id
  left join public.follows f_in on f_in.follower_id = p.user_id and f_in.followee_id = (select id from me)
  where me.id is not null
    and private.social_on(me.id)
    and p.social_at is not null
    and p.user_id <> me.id
    and not private.blocked_between(me.id, p.user_id)
  order by p.username using operator(pg_catalog.~<~)
  limit 20
$$;

-- Demande d'abonnement : 'requested' (en attente) ou 'following' (déjà accepté). Cible bloquée,
-- bloquante ou sans social : demande fantôme (voir l'en-tête), même réponse. Cible inconnue :
-- 'requested' sans rien créer. Comptée dans la limite des 30 par jour, demandes fantômes et neutres
-- comprises (sinon la limite trahirait le blocage). Verrou de la paire : un blocage en cours est
-- terminé avant qu'on regarde s'il existe.
create function public.request_follow(target uuid) returns text
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  cur text;
begin
  if me is null or not private.social_on(me) then
    raise exception 'social_not_enabled' using errcode = 'P0001';
  end if;
  if target is null or target = me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.lock_pair(me, target);
  select f.status into cur from public.follows f where f.follower_id = me and f.followee_id = target;
  if cur = 'accepted' then return 'following'; end if;
  if cur in ('pending', 'ghost') then return 'requested'; end if;
  perform private.rate_limit(me, 'follow', 30);
  if exists (select 1 from auth.users u where u.id = target) then
    insert into public.follows (follower_id, followee_id, status)
      values (me, target, case when private.social_on(target) and not private.blocked_between(me, target)
                               then 'pending' else 'ghost' end)
      on conflict do nothing;
  end if;
  return 'requested';
end
$$;

-- Retirer ma demande (fantôme comprise) ou mon abonnement
create function public.cancel_follow(target uuid) returns void
  language sql security definer set search_path = '' as
$$ delete from public.follows f where f.follower_id = (select auth.uid()) and f.followee_id = target $$;

-- Répondre à une demande reçue : acceptée, ou ligne supprimée si refusée. Sans demande en attente
-- (fantôme, déjà traitée, celle d'un autre) ou avec un blocage entre les deux : rien.
create function public.respond_follow(follower uuid, accept boolean) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or follower is null or follower = me then return; end if;
  perform private.lock_pair(me, follower);
  if private.blocked_between(me, follower) then return; end if;
  if accept is true then
    update public.follows f set status = 'accepted', responded_at = now()
      where f.follower_id = follower and f.followee_id = me and f.status = 'pending';
  else
    delete from public.follows f where f.follower_id = follower and f.followee_id = me and f.status = 'pending';
  end if;
end
$$;

-- Retirer un abonné (ou une demande reçue ; jamais une demande fantôme, que je ne connais pas)
create function public.remove_follower(follower uuid) returns void
  language sql security definer set search_path = '' as
$$
  delete from public.follows f
  where f.follower_id = follower and f.followee_id = (select auth.uid()) and f.status <> 'ghost'
$$;

-- Bloquer : mes demandes et abonnements vers lui supprimés, son abonnement à moi supprimé (comme un
-- abonné retiré), sa demande en attente devenue fantôme (comme une demande sans réponse), bravos
-- échangés supprimés. Silencieux pour un identifiant inconnu ou déjà bloqué (rien n'est révélé, rien
-- n'est refait) ; not_found sur soi-même.
create function public.block_user(target uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or target is null then return; end if;
  if target = me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = target) then return; end if;
  perform private.lock_pair(me, target);
  if exists (select 1 from public.blocks k where k.blocker_id = me and k.blocked_id = target) then return; end if;
  delete from public.follows f where f.follower_id = me and f.followee_id = target;
  delete from public.follows f where f.follower_id = target and f.followee_id = me and f.status = 'accepted';
  update public.follows f set status = 'ghost' where f.follower_id = target and f.followee_id = me and f.status = 'pending';
  delete from public.bravos b
    where (b.user_id = me and b.session_owner = target) or (b.user_id = target and b.session_owner = me);
  insert into public.blocks (blocker_id, blocked_id) values (me, target) on conflict do nothing;
end
$$;

-- Débloquer. S'il ne reste aucun blocage entre les deux comptes, les demandes fantômes entre eux sont
-- supprimées : elles ne deviennent jamais de vraies demandes (il faudra redemander).
create function public.unblock_user(target uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or target is null or target = me then return; end if;
  perform private.lock_pair(me, target);
  delete from public.blocks k where k.blocker_id = me and k.blocked_id = target;
  if not private.blocked_between(me, target) then
    delete from public.follows f
      where f.status = 'ghost'
        and ((f.follower_id = me and f.followee_id = target) or (f.follower_id = target and f.followee_id = me));
  end if;
end
$$;

-- Fil : séances des personnes que je vois (private.can_see), montrables (private.session_shown), par
-- (done_at, user_id, id) décroissant, 20 par page. Page suivante : before_at, before_owner, before_id
-- = done_at, owner, id de la dernière carte (curseur complet : 25 séances à la même milliseconde
-- donnent 20 puis 5). before_at seul : séances strictement plus anciennes. only_user : écran d'un
-- profil (vide si je ne le vois pas). s : liste blanche private.session_public.
-- Performance : pour chaque compte visible, au plus 20 séances lues dans l'index sessions_user_done
-- (déjà dans l'ordre, borne haute dans la condition d'index), puis tri des candidates et limite à 20 ;
-- la liste blanche et les bravos ne sont calculés que pour ces 20 cartes. Les règles de
-- private.can_see et private.session_shown sont recopiées ici en SQL direct : une fonction qui fixe
-- search_path n'est jamais intégrée au plan par Postgres, et l'appeler pour chaque compte et chaque
-- séance coûtait 60 ms au lieu de 5 pour 200 comptes suivis. Les tests de social_test.sql vérifient
-- que feed et toggle_bravo (qui, lui, appelle les fonctions) donnent la même visibilité.
create function public.feed(before_at bigint default null, before_owner uuid default null,
                            before_id text default null, only_user uuid default null)
  returns table (owner uuid, username text, avatar text, id text, done_at bigint, s jsonb, bravos int, my_bravo boolean)
  language sql stable security definer set search_path = '' as
$$
  with me as (
    select u.id, private.max_done_at() as max_at
    from (select (select auth.uid()) as id) u
    -- Le social de l'appelant est requis (private.can_see)
    where exists (select 1 from public.user_profiles mp where mp.user_id = u.id and mp.social_at is not null)
  ),
  seen as (
    -- private.can_see : abonnement accepté, social activé de l'autre côté, aucun blocage
    select f.followee_id as uid, op.username, op.avatar_emoji
    from me
    join public.follows f on f.follower_id = me.id and f.status = 'accepted'
    join public.user_profiles op on op.user_id = f.followee_id and op.social_at is not null
    where (only_user is null or f.followee_id = only_user)
      and not exists (select 1 from public.blocks k
                      where (k.blocker_id = me.id and k.blocked_id = f.followee_id)
                         or (k.blocker_id = f.followee_id and k.blocked_id = me.id))
  ),
  page as (
    select seen.uid, seen.username, seen.avatar_emoji, c.id, c.done_at, c.data
    from me, seen
    cross join lateral (
      -- private.session_shown : non supprimée, datée, pas dans le futur lointain, non masquée
      select x.id, x.done_at, x.data
      from public.sessions x
      where x.user_id = seen.uid and x.deleted_at is null and x.done_at is not null
        and x.done_at <= least(coalesce(before_at, 9223372036854775807), me.max_at)
        and coalesce(x.data ->> 'hidden', '') <> 'true'
        and (before_at is null
             or x.done_at < before_at
             or (before_owner is not null and before_id is not null
                 and (x.user_id, x.id) < (before_owner, before_id)))
      order by x.done_at desc, x.id desc
      limit 20
    ) c
    order by c.done_at desc, seen.uid desc, c.id desc
    limit 20
  )
  select pg.uid, pg.username, pg.avatar_emoji, pg.id, pg.done_at, private.session_public(pg.data),
    (select count(*)::int from public.bravos b where b.session_owner = pg.uid and b.session_id = pg.id),
    exists (select 1 from public.bravos b
            where b.session_owner = pg.uid and b.session_id = pg.id and b.user_id = (select id from me))
  from page pg
  order by pg.done_at desc, pg.uid desc, pg.id desc
$$;

-- Bravo mis ou retiré, seulement sur une séance que feed me montrerait (sinon not_found, y compris
-- mes propres séances). Seuls les bravos mis comptent dans la limite des 200 par jour.
create function public.toggle_bravo(owner uuid, session_id text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if not private.can_see(me, toggle_bravo.owner) or not exists (
    select 1 from public.sessions x
    where x.user_id = toggle_bravo.owner and x.id = toggle_bravo.session_id
      and private.session_shown(x.data, x.deleted_at, x.done_at)
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  delete from public.bravos b
    where b.session_owner = toggle_bravo.owner and b.session_id = toggle_bravo.session_id and b.user_id = me;
  if not found then
    perform private.rate_limit(me, 'bravo', 200);
    insert into public.bravos (session_owner, session_id, user_id)
      values (toggle_bravo.owner, toggle_bravo.session_id, me) on conflict do nothing;
  end if;
  return jsonb_build_object(
    'bravos', (select count(*)::int from public.bravos b
               where b.session_owner = toggle_bravo.owner and b.session_id = toggle_bravo.session_id),
    'mine', exists (select 1 from public.bravos b
                    where b.session_owner = toggle_bravo.owner and b.session_id = toggle_bravo.session_id and b.user_id = me)
  );
end
$$;

-- Bravos reçus sur mes séances (non supprimées), pour Historique
create function public.my_bravos() returns table (session_id text, bravos int)
  language sql stable security definer set search_path = '' as
$$
  select b.session_id, count(*)::int
  from public.bravos b
  join public.sessions x on x.user_id = b.session_owner and x.id = b.session_id and x.deleted_at is null
  where b.session_owner = (select auth.uid())
  group by b.session_id
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.rate_limit(uuid, text, int) from public, anon, authenticated, service_role;
revoke all on function private.social_on(uuid) from public, anon, authenticated, service_role;
revoke all on function private.blocked_between(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_see(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.session_shown(jsonb, timestamptz, bigint) from public, anon, authenticated, service_role;
revoke all on function private.scalar(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.session_public(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.lock_pair(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.max_done_at() from public, anon, authenticated, service_role;
revoke all on function private.person(uuid, timestamptz, boolean) from public, anon, authenticated, service_role;
revoke all on function private.report_before_insert() from public, anon, authenticated, service_role;

revoke all on function public.social_enable(boolean) from public, anon, authenticated;
revoke all on function public.social_disable() from public, anon, authenticated;
revoke all on function public.social_state() from public, anon, authenticated;
revoke all on function public.search_profiles(text) from public, anon, authenticated;
revoke all on function public.request_follow(uuid) from public, anon, authenticated;
revoke all on function public.cancel_follow(uuid) from public, anon, authenticated;
revoke all on function public.respond_follow(uuid, boolean) from public, anon, authenticated;
revoke all on function public.remove_follower(uuid) from public, anon, authenticated;
revoke all on function public.block_user(uuid) from public, anon, authenticated;
revoke all on function public.unblock_user(uuid) from public, anon, authenticated;
revoke all on function public.feed(bigint, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.toggle_bravo(uuid, text) from public, anon, authenticated;
revoke all on function public.my_bravos() from public, anon, authenticated;

grant execute on function public.social_enable(boolean) to authenticated;
grant execute on function public.social_disable() to authenticated;
grant execute on function public.social_state() to authenticated;
grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.request_follow(uuid) to authenticated;
grant execute on function public.cancel_follow(uuid) to authenticated;
grant execute on function public.respond_follow(uuid, boolean) to authenticated;
grant execute on function public.remove_follower(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.feed(bigint, uuid, text, uuid) to authenticated;
grant execute on function public.toggle_bravo(uuid, text) to authenticated;
grant execute on function public.my_bravos() to authenticated;

-- Purge quotidienne des signalements de plus de 12 mois (03:17 UTC) avec pg_cron, disponible sur
-- Supabase. Sans l'extension (Postgres local des tests), seule la purge du déclencheur reste.
-- cron.schedule avec un nom remplace la tâche du même nom : rejouer la migration ne la double pas.
do $cron$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-reports-12-mois', '17 3 * * *',
      $job$delete from public.reports where created_at < now() - interval '12 months'$job$);
  end if;
end
$cron$;

-- Signalements reçus sans alerte partie (Resend injoignable ou clé absente), à traiter à la main :
--   select * from public.reports where notified_at is null order by created_at;
