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
--  - Blocage jamais révélé : la recherche et le fil se taisent, une demande vers quelqu'un qui m'a
--    bloqué (ou que j'ai bloqué, ou sans social) répond 'requested' sans rien créer. Bloquer supprime
--    les abonnements dans les deux sens et les bravos échangés.
--  - Limites sur 24 h glissantes : 30 demandes d'abonnement et 200 bravos donnés (journal
--    private.social_rate, qui compte aussi les demandes neutres et les bravos retirés puis remis, pour
--    qu'annuler et recommencer ne contourne rien), 10 signalements (comptés sur reports).
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

-- Recherche par préfixe du pseudo parmi les profils visibles. text_pattern_ops : LIKE 'préfixe%'
-- indexable quelle que soit la collation de la base.
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
create index sessions_user_done on public.sessions (user_id, done_at desc) where deleted_at is null;

create table public.follows (
  follower_id  uuid not null references auth.users(id) on delete cascade,
  followee_id  uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
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

-- Séance montrable aux abonnés : non supprimée, datée, non masquée (hidden: true ; « true » en texte
-- compte aussi, par prudence)
create function private.session_shown(data jsonb, deleted_at timestamptz, done_at bigint) returns boolean
  language sql immutable set search_path = '' as
$$ select deleted_at is null and done_at is not null and coalesce(data ->> 'hidden', '') <> 'true' $$;

-- Valeur simple (texte, nombre, booléen) ou null : un objet glissé à la place d'un nom ne fait pas
-- sortir de clés
create function private.scalar(v jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$ select case when jsonb_typeof(v) in ('string', 'number', 'boolean') then v end $$;

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
          where jsonb_typeof(st.v) = 'object'
        ), '[]'::jsonb)
      ) order by e.n)
      from jsonb_array_elements(case when jsonb_typeof(data -> 'exercises') = 'array' then data -> 'exercises' else '[]'::jsonb end)
           with ordinality as e(v, n)
      where jsonb_typeof(e.v) = 'object'
    ), '[]'::jsonb)
  ))
$$;

-- Personne d'une liste de social_state : { user_id, username, avatar, since }
create function private.person(uid uuid, since timestamptz) returns jsonb
  language sql stable set search_path = '' as
$$
  select jsonb_build_object('user_id', uid, 'username', p.username, 'avatar', p.avatar_emoji, 'since', since)
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
-- du blocage pour les bloqués. Listes du plus récent au plus ancien.
create function public.social_state() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id)
  select jsonb_build_object(
    'enabled',    coalesce(p.social_at is not null, false),
    'username',   p.username,
    'avatar',     p.avatar_emoji,
    'pending_in', coalesce((select jsonb_agg(private.person(f.follower_id, f.created_at) order by f.created_at desc)
                            from public.follows f where f.followee_id = me.id and f.status = 'pending'), '[]'::jsonb),
    'following',  coalesce((select jsonb_agg(private.person(f.followee_id, f.responded_at) order by f.responded_at desc)
                            from public.follows f where f.follower_id = me.id and f.status = 'accepted'), '[]'::jsonb),
    'followers',  coalesce((select jsonb_agg(private.person(f.follower_id, f.responded_at) order by f.responded_at desc)
                            from public.follows f where f.followee_id = me.id and f.status = 'accepted'), '[]'::jsonb),
    'requested',  coalesce((select jsonb_agg(private.person(f.followee_id, f.created_at) order by f.created_at desc)
                            from public.follows f where f.follower_id = me.id and f.status = 'pending'), '[]'::jsonb),
    'blocked',    coalesce((select jsonb_agg(private.person(k.blocked_id, k.created_at) order by k.created_at desc)
                            from public.blocks k where k.blocker_id = me.id), '[]'::jsonb),
    'badge',      (select count(*)::int from public.follows f where f.followee_id = me.id and f.status = 'pending')
  )
  from me left join public.user_profiles p on p.user_id = me.id
$$;

-- Recherche par préfixe du pseudo. q normalisé : sans espaces autour, sans « @ », accents retirés
-- (translate : l'extension unaccent n'est pas forcément installée ; majuscules accentuées comprises,
-- car lower() ne les connaît pas sous la collation C), minuscules. Moins de 2 caractères : rien.
-- % _ et \ échappés : ce sont des caractères de LIKE (et « _ » est permis dans un pseudo). Exclus :
-- soi-même, les profils sans social, les blocages dans les deux sens. L'appelant doit avoir activé le
-- social (sinon rien) : on ne parcourt pas l'annuaire sans y figurer. Correspondance exacte d'abord.
-- relation : 'following' (abonnement accepté), 'requested' (ma demande en attente), 'follows_you'
-- (il est abonné à moi), sinon 'none'.
create function public.search_profiles(q text) returns table (user_id uuid, username text, avatar text, relation text)
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id),
  norm as (
    select lower(translate(replace(btrim(coalesce(q, '')), '@', ''),
      'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝŸýÿ',
      'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYYyy')) as v
  ),
  pat as (
    select replace(replace(replace(norm.v, '\', '\\'), '%', '\%'), '_', '\_') || '%' as like_q, norm.v
    from norm where char_length(norm.v) >= 2
  )
  select p.user_id, p.username, p.avatar_emoji,
    case
      when f_out.status = 'accepted' then 'following'
      when f_out.status = 'pending' then 'requested'
      when f_in.status = 'accepted' then 'follows_you'
      else 'none'
    end
  from me, pat
  join public.user_profiles p on p.username like pat.like_q escape '\'
  left join public.follows f_out on f_out.follower_id = (select id from me) and f_out.followee_id = p.user_id
  left join public.follows f_in on f_in.follower_id = p.user_id and f_in.followee_id = (select id from me)
  where me.id is not null
    and private.social_on(me.id)
    and p.social_at is not null
    and p.user_id <> me.id
    and not private.blocked_between(me.id, p.user_id)
  order by (p.username = pat.v) desc, char_length(p.username), p.username
  limit 20
$$;

-- Demande d'abonnement : 'requested' (en attente) ou 'following' (déjà accepté). Cible bloquée,
-- bloquante, sans social ou inconnue : 'requested' sans rien créer (jamais révélé). Comptée dans la
-- limite des 30 par jour, demandes neutres comprises (sinon la limite trahirait le blocage).
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
  select f.status into cur from public.follows f where f.follower_id = me and f.followee_id = target;
  if cur = 'accepted' then return 'following'; end if;
  if cur = 'pending' then return 'requested'; end if;
  perform private.rate_limit(me, 'follow', 30);
  if private.social_on(target) and not private.blocked_between(me, target) then
    insert into public.follows (follower_id, followee_id) values (me, target) on conflict do nothing;
  end if;
  return 'requested';
end
$$;

-- Retirer ma demande ou mon abonnement
create function public.cancel_follow(target uuid) returns void
  language sql security definer set search_path = '' as
$$ delete from public.follows f where f.follower_id = (select auth.uid()) and f.followee_id = target $$;

-- Répondre à une demande reçue : acceptée, ou ligne supprimée si refusée. Sans demande en attente : rien.
create function public.respond_follow(follower uuid, accept boolean) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if accept is true then
    update public.follows f set status = 'accepted', responded_at = now()
      where f.follower_id = follower and f.followee_id = me and f.status = 'pending';
  else
    delete from public.follows f where f.follower_id = follower and f.followee_id = me and f.status = 'pending';
  end if;
end
$$;

-- Retirer un abonné (ou une demande reçue)
create function public.remove_follower(follower uuid) returns void
  language sql security definer set search_path = '' as
$$ delete from public.follows f where f.follower_id = follower and f.followee_id = (select auth.uid()) $$;

-- Bloquer : abonnements et demandes supprimés dans les deux sens, bravos échangés supprimés
create function public.block_user(target uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or target is null or target = me or not exists (select 1 from auth.users u where u.id = target) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  delete from public.follows f
    where (f.follower_id = me and f.followee_id = target) or (f.follower_id = target and f.followee_id = me);
  delete from public.bravos b
    where (b.user_id = me and b.session_owner = target) or (b.user_id = target and b.session_owner = me);
  insert into public.blocks (blocker_id, blocked_id) values (me, target) on conflict do nothing;
end
$$;

create function public.unblock_user(target uuid) returns void
  language sql security definer set search_path = '' as
$$ delete from public.blocks k where k.blocker_id = (select auth.uid()) and k.blocked_id = target $$;

-- Fil : séances des personnes que je vois (private.can_see), montrables (private.session_shown),
-- par done_at décroissant, 20 par page ; page suivante : before = done_at de la dernière carte.
-- only_user : écran d'un profil (vide si je ne le vois pas). s : liste blanche private.session_public.
create function public.feed(before bigint default null, only_user uuid default null)
  returns table (owner uuid, username text, avatar text, id text, done_at bigint, s jsonb, bravos int, my_bravo boolean)
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id),
  seen as (
    select f.followee_id as uid
    from me join public.follows f on f.follower_id = me.id and f.status = 'accepted'
    where (only_user is null or f.followee_id = only_user)
      and private.can_see(me.id, f.followee_id)
  )
  select x.user_id, p.username, p.avatar_emoji, x.id, x.done_at, private.session_public(x.data),
    (select count(*)::int from public.bravos b where b.session_owner = x.user_id and b.session_id = x.id),
    exists (select 1 from public.bravos b
            where b.session_owner = x.user_id and b.session_id = x.id and b.user_id = (select id from me))
  from seen
  join public.sessions x on x.user_id = seen.uid and x.deleted_at is null
  join public.user_profiles p on p.user_id = seen.uid
  where private.session_shown(x.data, x.deleted_at, x.done_at)
    and (before is null or x.done_at < before)
  order by x.done_at desc, x.user_id, x.id
  limit 20
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
revoke all on function private.person(uuid, timestamptz) from public, anon, authenticated, service_role;
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
revoke all on function public.feed(bigint, uuid) from public, anon, authenticated;
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
grant execute on function public.feed(bigint, uuid) to authenticated;
grant execute on function public.toggle_bravo(uuid, text) to authenticated;
grant execute on function public.my_bravos() to authenticated;

-- Signalements reçus sans alerte partie (Resend injoignable ou clé absente), à traiter à la main :
--   select * from public.reports where notified_at is null order by created_at;
