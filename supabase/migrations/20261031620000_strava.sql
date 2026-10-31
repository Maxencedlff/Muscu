-- ═══════════════════════════════════════════════════════════
--  Strava : export des séances terminées vers Strava (contrat : docs/STRAVA.md).
--
--  Qui fait quoi :
--  - L'app ne voit JAMAIS un jeton Strava. Elle lit seulement son état (strava_status, rôle
--    authenticated) et passe par les fonctions Edge strava-connect (relier), strava-export (envoyer
--    une séance) et strava-disconnect (couper l'accès et effacer).
--  - Les fonctions Edge, avec la clé serveur (rôle service_role), appellent les RPC strava_state_*,
--    strava_link_* et strava_export_* ci-dessous. Elles seules reçoivent l'identifiant du compte en
--    paramètre : la fonction Edge l'a lu dans le jeton de session vérifié (ou dans l'état OAuth à usage
--    unique), jamais dans le corps de la requête.
--
--  Sécurité :
--  - Tables dans le schéma private (jamais exposé par l'API), RLS activée sans aucune politique,
--    aucun GRANT à anon, authenticated ni service_role : tout passe par les fonctions security definer
--    (propriétaire postgres, search_path vide).
--  - Jetons : private.strava_links.tokens est un texte chiffré par la fonction Edge (AES-GCM 256, clé
--    STRAVA_TOKEN_KEY posée en secret du projet, jamais en base ni dans le dépôt, identifiant du compte
--    en données associées : un chiffré recopié sur un autre compte ne se déchiffre pas). Une copie de la
--    base seule ne donne donc aucun accès Strava.
--  - État OAuth : 32 octets aléatoires tirés par la fonction Edge ; seule leur empreinte SHA-256 est
--    gardée (state_hash), 10 minutes, à usage unique (strava_state_consume le supprime).
--  - Limites : 10 débuts de liaison par heure, 30 envois par 24 h et par compte (journal
--    private.social_rate de 20261026050000_social.sql, private.rate_limit_window du coach). Elles
--    protègent aussi le quota Strava de l'app, commun à tous (200 requêtes par 15 min au départ).
--  - Double envoi : strava_export_begin réserve la séance (verrou par compte) ; un second toucher
--    pendant l'envoi répond busy, une séance déjà envoyée répond done avec son activité.
--  - Suppression du compte : tout part en cascade avec auth.users (la fonction delete-account révoque
--    d'abord l'accès chez Strava, au mieux).
--  - Erreurs lisibles (message exact, errcode P0001) : not_connected, rate_limited, invalid.
--
--  Retour arrière : supabase/rollback/20261031620000_strava_down.sql.
-- ═══════════════════════════════════════════════════════════

create table private.strava_links (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  athlete_id   bigint not null check (athlete_id > 0),
  athlete_name text check (char_length(athlete_name) between 1 and 40),
  scope        text not null check (char_length(scope) <= 200),
  tokens       text not null check (char_length(tokens) between 20 and 4000),
  expires_at   timestamptz not null,
  connected_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table private.strava_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  user_id    uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index strava_states_user on private.strava_states (user_id);

create table private.strava_exports (
  user_id     uuid not null references auth.users(id) on delete cascade,
  session_id  text not null check (session_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  activity_id bigint check (activity_id > 0),
  claimed_at  timestamptz not null default now(),
  exported_at timestamptz,
  primary key (user_id, session_id)
);

alter table private.strava_links enable row level security;
alter table private.strava_states enable row level security;
alter table private.strava_exports enable row level security;
revoke all on private.strava_links, private.strava_states, private.strava_exports
  from public, anon, authenticated, service_role;

-- ── Lecture par l'app ───────────────────────────────────────

-- État de Strava pour le compte connecté : { connected, athlete_name, connected_at, can_write,
-- exports: [{ session_id, activity_id }] } (activité en texte : un bigint dépasse les entiers sûrs du JS).
-- Jamais un jeton, jamais l'identifiant Strava.
create function public.strava_status() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id)
  select jsonb_build_object(
    'connected',    l.user_id is not null,
    'athlete_name', l.athlete_name,
    'connected_at', l.connected_at,
    'can_write',    coalesce(l.scope ~ '(^|[ ,])activity:write($|[ ,])', false),
    'exports',      case when l.user_id is null then '[]'::jsonb else coalesce((
                      select jsonb_agg(jsonb_build_object('session_id', e.session_id, 'activity_id', e.activity_id::text)
                                       order by e.exported_at desc)
                      from (select x.session_id, x.activity_id, x.exported_at from private.strava_exports x
                            where x.user_id = me.id and x.activity_id is not null
                            order by x.exported_at desc limit 1000) e), '[]'::jsonb) end
  )
  from me left join private.strava_links l on l.user_id = me.id
  where me.id is not null
$$;

-- ── Fonctions Edge (service_role) : liaison ─────────────────

-- Début de liaison : un seul état en attente par compte (le précédent est remplacé), 10 par heure
create function public.strava_state_create(p_user uuid, p_state_hash text) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if p_user is null or p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  perform private.rate_limit_window(p_user, 'strava_connect', 10, interval '1 hour');
  delete from private.strava_states s where s.user_id = p_user or s.expires_at <= now();
  insert into private.strava_states (state_hash, user_id) values (p_state_hash, p_user);
end
$$;

-- Retour de Strava : compte de l'état s'il est encore valable, null sinon. Usage unique.
create function public.strava_state_consume(p_state_hash text) returns uuid
  language plpgsql security definer set search_path = '' as
$$
declare uid uuid;
begin
  delete from private.strava_states s where s.state_hash = p_state_hash returning
    case when s.expires_at > now() then s.user_id end into uid;
  delete from private.strava_states s where s.expires_at <= now();
  return uid;
end
$$;

-- Liaison enregistrée (nouvelle ou remplacée). Renvoie les jetons chiffrés d'une liaison PRÉCÉDENTE
-- à un autre athlète (la fonction Edge les révoque), null sinon. Changement d'athlète : les envois
-- notés pour l'ancien sont oubliés.
create function public.strava_link_save(p_user uuid, p_athlete_id bigint, p_athlete_name text, p_scope text,
                                        p_tokens text, p_expires_at timestamptz) returns text
  language plpgsql security definer set search_path = '' as
$$
declare old private.strava_links;
begin
  perform pg_advisory_xact_lock(hashtextextended('strava:' || p_user::text, 0));
  select * into old from private.strava_links l where l.user_id = p_user;
  if old.user_id is not null and old.athlete_id <> p_athlete_id then
    delete from private.strava_exports e where e.user_id = p_user;
  end if;
  insert into private.strava_links (user_id, athlete_id, athlete_name, scope, tokens, expires_at)
    values (p_user, p_athlete_id, nullif(left(btrim(coalesce(p_athlete_name, '')), 40), ''), left(coalesce(p_scope, ''), 200), p_tokens, p_expires_at)
  on conflict (user_id) do update set
    athlete_id = excluded.athlete_id, athlete_name = excluded.athlete_name, scope = excluded.scope,
    tokens = excluded.tokens, expires_at = excluded.expires_at, connected_at = now(), updated_at = now();
  return case when old.user_id is not null and old.athlete_id <> p_athlete_id then old.tokens end;
end
$$;

-- Jetons chiffrés et date d'expiration du jeton d'accès (aucune ligne : pas relié)
create function public.strava_link_get(p_user uuid)
  returns table (athlete_id bigint, scope text, tokens text, expires_at timestamptz)
  language sql stable security definer set search_path = '' as
$$
  select l.athlete_id, l.scope, l.tokens, l.expires_at from private.strava_links l where l.user_id = p_user
$$;

-- Jetons renouvelés (le jeton de renouvellement change à chaque fois chez Strava : le dernier fait foi).
-- Ne recrée jamais une liaison effacée entre-temps (déconnexion pendant un envoi).
create function public.strava_link_tokens(p_user uuid, p_tokens text, p_expires_at timestamptz) returns void
  language sql security definer set search_path = '' as
$$
  update private.strava_links l set tokens = p_tokens, expires_at = p_expires_at, updated_at = now()
  where l.user_id = p_user
$$;

-- Déconnexion : liaison, envois notés et états en attente effacés. Renvoie les jetons chiffrés (pour
-- les révoquer chez Strava), null s'il n'y avait pas de liaison.
create function public.strava_link_delete(p_user uuid) returns text
  language plpgsql security definer set search_path = '' as
$$
declare t text;
begin
  perform pg_advisory_xact_lock(hashtextextended('strava:' || p_user::text, 0));
  delete from private.strava_links l where l.user_id = p_user returning l.tokens into t;
  delete from private.strava_exports e where e.user_id = p_user;
  delete from private.strava_states s where s.user_id = p_user;
  return t;
end
$$;

-- ── Fonctions Edge (service_role) : envoi d'une séance ──────

-- Réserve l'envoi d'une séance : { status: 'go' } (envoyer), { status: 'done', activity_id } (déjà sur
-- Strava), { status: 'busy' } (un envoi de cette séance a commencé il y a moins de 2 minutes).
-- Pas relié : not_connected. 30 envois par 24 h (une reprise après un échec ne recompte pas).
create function public.strava_export_begin(p_user uuid, p_session_id text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare e private.strava_exports;
begin
  if p_session_id is null or p_session_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('strava:' || p_user::text, 0));
  if not exists (select 1 from private.strava_links l where l.user_id = p_user) then
    raise exception 'not_connected' using errcode = 'P0001';
  end if;
  select * into e from private.strava_exports x where x.user_id = p_user and x.session_id = p_session_id;
  if e.user_id is not null then
    if e.activity_id is not null then
      return jsonb_build_object('status', 'done', 'activity_id', e.activity_id::text);
    end if;
    if e.claimed_at > now() - interval '2 minutes' then return jsonb_build_object('status', 'busy'); end if;
    update private.strava_exports x set claimed_at = now() where x.user_id = p_user and x.session_id = p_session_id;
    return jsonb_build_object('status', 'go');
  end if;
  perform private.rate_limit_window(p_user, 'strava_export', 30, interval '24 hours');
  insert into private.strava_exports (user_id, session_id) values (p_user, p_session_id);
  return jsonb_build_object('status', 'go');
end
$$;

-- Fin de l'envoi : activité créée (notée), ou échec (p_activity_id nul : réservation levée, on peut
-- réessayer tout de suite)
create function public.strava_export_finish(p_user uuid, p_session_id text, p_activity_id bigint) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if p_activity_id is null then
    delete from private.strava_exports x where x.user_id = p_user and x.session_id = p_session_id and x.activity_id is null;
  else
    update private.strava_exports x set activity_id = p_activity_id, exported_at = now()
    where x.user_id = p_user and x.session_id = p_session_id;
  end if;
end
$$;

-- ── Droits ──────────────────────────────────────────────────

revoke all on function public.strava_status() from public, anon, authenticated, service_role;
revoke all on function public.strava_state_create(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.strava_state_consume(text) from public, anon, authenticated, service_role;
revoke all on function public.strava_link_save(uuid, bigint, text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.strava_link_get(uuid) from public, anon, authenticated, service_role;
revoke all on function public.strava_link_tokens(uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.strava_link_delete(uuid) from public, anon, authenticated, service_role;
revoke all on function public.strava_export_begin(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.strava_export_finish(uuid, text, bigint) from public, anon, authenticated, service_role;

grant execute on function public.strava_status() to authenticated;
grant execute on function public.strava_state_create(uuid, text) to service_role;
grant execute on function public.strava_state_consume(text) to service_role;
grant execute on function public.strava_link_save(uuid, bigint, text, text, text, timestamptz) to service_role;
grant execute on function public.strava_link_get(uuid) to service_role;
grant execute on function public.strava_link_tokens(uuid, text, timestamptz) to service_role;
grant execute on function public.strava_link_delete(uuid) to service_role;
grant execute on function public.strava_export_begin(uuid, text) to service_role;
grant execute on function public.strava_export_finish(uuid, text, bigint) to service_role;
