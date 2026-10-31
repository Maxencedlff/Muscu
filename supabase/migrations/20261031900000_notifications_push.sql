-- ═══════════════════════════════════════════════════════════
--  Notifications push (APNs) : appareils, réglages par type, file d'envoi. Contrat : docs/NOTIFICATIONS.md
--
--  Principes :
--  1. Rien n'est envoyé sans accord : chaque type est éteint par défaut (push_prefs), la personne
--     l'allume dans Réglages › Notifications, et iOS a sa propre autorisation (sans elle, pas de jeton).
--  2. Un jeton d'appareil n'appartient qu'à un compte (clé primaire sur le jeton : se connecter à un
--     autre compte sur le même iPhone le déplace). Supprimé : à la demande (déconnexion, tout éteint),
--     avec le compte (cascade), quand APNs le dit mort (410, BadDeviceToken), ou sans nouvelles depuis 60 jours.
--  3. Les déclencheurs (bravo reçu, demande d'abonnement, commentaire ou programme du coach) n'écrivent
--     qu'une ligne dans private.push_outbox, et seulement si le destinataire l'a demandé, a un appareil et
--     n'est pas bloqué avec l'auteur. Ils ne font JAMAIS échouer l'action d'origine (exception avalée).
--     La même notification (destinataire, type, auteur, objet) n'est pas recréée pendant 24 h : un bravo
--     retiré puis remis ne sonne pas deux fois.
--  4. L'envoi est fait par la fonction Edge push-send (clé serveur), qui lit la file par push_claim et la
--     solde par push_done. Aucun contenu saisi (commentaire, nom de programme) ne part dans la notification :
--     seulement le pseudo de l'auteur et le type (écran verrouillé).
--  5. RLS activée partout, aucune politique, aucun GRANT de table : tout passe par les RPC security
--     definer (search_path vide, auth.uid()) ; celles de l'envoi sont réservées à service_role.
--  Retour arrière : supabase/rollback/20261031900000_notifications_push_down.sql
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- Jeton APNs : 32 octets en hexadécimal aujourd'hui (64 caractères) ; Apple prévient qu'il peut grandir :
-- jusqu'à 200 caractères acceptés. env : environnement APNs de la build (Release : production).
create table public.push_devices (
  token      text primary key check (token ~ '^[0-9a-f]{64,200}$'),
  user_id    uuid not null references auth.users(id) on delete cascade,
  env        text not null check (env in ('production', 'sandbox')),
  created_at timestamptz not null default now(),
  seen_at    timestamptz not null default now()
);
create index push_devices_user on public.push_devices (user_id);

-- Réglages : une ligne par compte, créée au premier réglage ; absente = tout éteint
create table public.push_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  reactions  boolean not null default false,   -- bravo reçu sur une de mes séances
  follows    boolean not null default false,   -- nouvelle demande d'abonnement
  coach      boolean not null default false,   -- commentaire ou programme de mon coach
  updated_at timestamptz not null default now()
);

-- File d'envoi. ref : séance (bravo, commentaire), programme (coach), '' (demande d'abonnement).
-- claimed_at : prise par un envoi en cours (reprise après 5 min si l'envoi a planté) ; sent_at : soldée.
create table private.push_outbox (
  id         bigint generated always as identity primary key,
  recipient  uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('reaction', 'follow_request', 'coach_note', 'coach_programme')),
  actor      uuid not null references auth.users(id) on delete cascade,
  ref        text not null default '' check (char_length(ref) <= 64),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at    timestamptz,
  attempts   int not null default 0
);
create index push_outbox_pending on private.push_outbox (created_at) where sent_at is null;
create index push_outbox_dedupe on private.push_outbox (recipient, kind, actor, ref, created_at desc);

-- Jeton du fournisseur APNs (JWT signé par la clé .p8, valable une heure) partagé par les instances de
-- push-send : Apple refuse plus d'un nouveau jeton toutes les 20 min (429 TooManyProviderTokenUpdates).
-- Une seule ligne ; lue et écrite par push_auth_get / push_auth_swap (service_role) seulement. Ce n'est
-- pas la clé .p8 (secret de la fonction Edge, jamais en base) : un jeton qui expire seul en une heure.
create table private.push_apns_auth (
  id         boolean primary key default true check (id),
  token      text not null check (char_length(token) between 1 and 1024),
  iat        bigint not null,
  key_id     text not null check (char_length(key_id) between 1 and 32),
  updated_at timestamptz not null default now()
);

alter table public.push_devices enable row level security;
alter table public.push_prefs enable row level security;
alter table private.push_outbox enable row level security;
alter table private.push_apns_auth enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.push_devices, public.push_prefs from public, anon, authenticated, service_role;
revoke all on private.push_outbox from public, anon, authenticated, service_role;

-- ── File : ajout par les déclencheurs ────────────────────

-- Préférence du destinataire pour un type de notification
create function private.push_wanted(recipient uuid, kind text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select coalesce((select case kind
                            when 'reaction' then p.reactions
                            when 'follow_request' then p.follows
                            when 'coach_note' then p.coach
                            when 'coach_programme' then p.coach
                            else false end
                   from public.push_prefs p where p.user_id = recipient), false)
$$;

create function private.push_enqueue(recipient uuid, kind text, actor uuid, ref text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare r text := coalesce(left(push_enqueue.ref, 64), '');
begin
  if recipient is null or actor is null or recipient = actor then return; end if;
  if not private.push_wanted(recipient, kind) then return; end if;
  if not exists (select 1 from public.push_devices d where d.user_id = recipient) then return; end if;
  if private.blocked_between(recipient, actor) then return; end if;
  -- Deux actions simultanées sur le même objet : une seule ligne
  perform pg_advisory_xact_lock(hashtextextended(recipient::text || kind || actor::text || r, 0));
  if exists (select 1 from private.push_outbox o
             where o.recipient = push_enqueue.recipient and o.kind = push_enqueue.kind and o.actor = push_enqueue.actor
               and o.ref = r and o.created_at > now() - interval '24 hours') then
    return;
  end if;
  insert into private.push_outbox (recipient, kind, actor, ref) values (recipient, kind, actor, r);
end
$$;

-- Déclencheurs : jamais d'échec de l'action d'origine à cause d'une notification
create function private.push_on_bravo() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  begin
    perform private.push_enqueue(new.session_owner, 'reaction', new.user_id, new.session_id);
  exception when others then null;
  end;
  return null;
end
$$;

create function private.push_on_follow() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  -- Seulement une vraie demande : une demande fantôme (bloqué, social éteint) ne doit rien révéler
  if new.status = 'pending' then
    begin
      perform private.push_enqueue(new.followee_id, 'follow_request', new.follower_id, '');
    exception when others then null;
    end;
  end if;
  return null;
end
$$;

create function private.push_on_coach_note() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if tg_op = 'UPDATE' and new.text is not distinct from old.text then return null; end if;
  begin
    perform private.push_enqueue(new.student_id, 'coach_note', new.coach_id, new.session_id);
  exception when others then null;
  end;
  return null;
end
$$;

create function private.push_on_coach_programme() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data then return null; end if;
  begin
    perform private.push_enqueue(new.student_id, 'coach_programme', new.coach_id, new.id);
  exception when others then null;
  end;
  return null;
end
$$;

create trigger bravos_push after insert on public.bravos
  for each row execute function private.push_on_bravo();
create trigger follows_push after insert on public.follows
  for each row execute function private.push_on_follow();
create trigger coach_notes_push after insert or update of text on public.coach_notes
  for each row execute function private.push_on_coach_note();
create trigger coach_programmes_push after insert or update of data on public.coach_programmes
  for each row execute function private.push_on_coach_programme();

-- ── RPC de l'app (authenticated) ─────────────────────────

-- Inscrit (ou rafraîchit) le jeton de cet appareil pour mon compte. Un jeton déjà inscrit pour un autre
-- compte passe au mien (même iPhone, autre compte). 10 appareils au plus par compte : les plus anciens
-- sortent.
create function public.push_register(token text, env text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  if token is null or token !~ '^[0-9a-f]{64,200}$' or env is null or env not in ('production', 'sandbox') then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;
  -- clock_timestamp : ordre exact des inscriptions, même dans une seule transaction
  insert into public.push_devices (token, user_id, env, seen_at) values (token, me, env, clock_timestamp())
    on conflict on constraint push_devices_pkey do update
      set user_id = excluded.user_id, env = excluded.env, seen_at = excluded.seen_at,
          created_at = case when public.push_devices.user_id = excluded.user_id then public.push_devices.created_at else now() end;
  delete from public.push_devices d
    where d.user_id = me and d.token in (select x.token from public.push_devices x where x.user_id = me
                                         order by x.seen_at desc offset 10);
end
$$;

-- Retire le jeton de cet appareil de mon compte (déconnexion, tout éteint). Celui d'un autre : rien.
create function public.push_unregister(token text) returns void
  language sql security definer set search_path = '' as
$$ delete from public.push_devices d where d.token = push_unregister.token and d.user_id = (select auth.uid()) $$;

-- Jeton de cet appareil laissé sur un AUTRE compte (sa session a fini hors de l'app : jeton de
-- rafraîchissement refusé, fusion annulée) : retiré à la connexion du compte suivant, pour que les
-- notifications de l'ancien compte n'arrivent plus sur l'iPhone d'un autre. Le jeton fait foi, comme pour
-- le déplacement dans push_register (qui le détient pourrait déjà se l'inscrire) ; le mien n'est jamais
-- touché : une inscription faite entre-temps par ce compte reste.
create function public.push_release(token text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  delete from public.push_devices d where d.token = push_release.token and d.user_id <> me;
end
$$;

-- Mes réglages (tout éteint sans ligne)
create function public.push_prefs() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('reactions', coalesce(p.reactions, false), 'follows', coalesce(p.follows, false),
                            'coach', coalesce(p.coach, false))
  from (select (select auth.uid()) as id) me left join public.push_prefs p on p.user_id = me.id
$$;

-- Écrit mes réglages ; null = inchangé. Tout éteint : la file en attente pour moi est vidée.
create function public.push_set_prefs(reactions boolean, follows boolean, coach boolean) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  insert into public.push_prefs (user_id, reactions, follows, coach)
    values (me, coalesce(push_set_prefs.reactions, false), coalesce(push_set_prefs.follows, false), coalesce(push_set_prefs.coach, false))
    on conflict on constraint push_prefs_pkey do update
      set reactions = coalesce(push_set_prefs.reactions, public.push_prefs.reactions),
          follows = coalesce(push_set_prefs.follows, public.push_prefs.follows),
          coach = coalesce(push_set_prefs.coach, public.push_prefs.coach),
          updated_at = now();
  -- Un type éteint : ses notifications pas encore parties ne partent plus
  delete from private.push_outbox o where o.recipient = me and o.sent_at is null and not private.push_wanted(me, o.kind);
  return public.push_prefs();
end
$$;

-- ── RPC de l'envoi (service_role, fonction Edge push-send) ─────

-- Prend au plus max_rows notifications à envoyer (non soldées, non prises depuis 5 min, moins de 5
-- essais, de moins de 24 h) et les marque prises. Préférences, appareils et blocages relus ici : un type
-- éteint ou un blocage posé entre-temps arrête l'envoi. Une ligne par appareil du destinataire.
-- Ménage au passage : notifications de plus de 7 jours, appareils muets depuis 60 jours.
create function public.push_claim(max_rows int) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare res jsonb;
begin
  delete from private.push_outbox o where o.created_at < now() - interval '7 days';
  delete from public.push_devices d where d.seen_at < now() - interval '60 days';
  with picked as (
    select o.id from private.push_outbox o
      where o.sent_at is null and o.attempts < 5 and o.created_at > now() - interval '24 hours'
        and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
      order by o.created_at
      limit least(greatest(coalesce(max_rows, 50), 1), 200)
      for update skip locked
  ), claimed as (
    update private.push_outbox o set claimed_at = now(), attempts = o.attempts + 1
      from picked where o.id = picked.id
      returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'ref', c.ref, 'token', d.token, 'env', d.env,
           'actor_name', up.username,
           'wanted', private.push_wanted(c.recipient, c.kind) and not private.blocked_between(c.recipient, c.actor))
           order by c.id), '[]'::jsonb)
    into res
    from claimed c
    left join public.push_devices d on d.user_id = c.recipient
    left join public.user_profiles up on up.user_id = c.actor;
  return res;
end
$$;

-- Solde les notifications traitées (envoyées, ou plus à envoyer) et retire les jetons qu'APNs dit morts
create function public.push_done(ids bigint[], dead_tokens text[]) returns void
  language sql security definer set search_path = '' as
$$
  update private.push_outbox o set sent_at = now() where o.id = any(coalesce(ids, '{}'));
  delete from public.push_devices d where d.token = any(coalesce(dead_tokens, '{}'));
$$;

-- Jeton du fournisseur gardé (null s'il n'y en a pas encore)
create function public.push_auth_get() returns jsonb
  language sql stable security definer set search_path = '' as
$$ select jsonb_build_object('token', a.token, 'iat', a.iat, 'key_id', a.key_id) from private.push_apns_auth a $$;

-- Échange conditionnel : la ligne n'est remplacée que si elle porte encore le jeton attendu (null : pas
-- encore de ligne). Deux instances qui renouvellent en même temps gardent celui de la première : chacune
-- reçoit la ligne gagnante.
create function public.push_auth_swap(expected text, token text, iat bigint, key_id text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
begin
  insert into private.push_apns_auth as a (id, token, iat, key_id) values (true, token, iat, key_id)
    on conflict (id) do update set token = excluded.token, iat = excluded.iat, key_id = excluded.key_id, updated_at = now()
    where a.token = push_auth_swap.expected;
  return public.push_auth_get();
end
$$;

-- ── Droits ───────────────────────────────────────────────

revoke all on function private.push_wanted(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.push_enqueue(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.push_on_bravo() from public, anon, authenticated, service_role;
revoke all on function private.push_on_follow() from public, anon, authenticated, service_role;
revoke all on function private.push_on_coach_note() from public, anon, authenticated, service_role;
revoke all on function private.push_on_coach_programme() from public, anon, authenticated, service_role;

revoke all on function public.push_register(text, text) from public, anon, authenticated, service_role;
revoke all on function public.push_unregister(text) from public, anon, authenticated, service_role;
revoke all on function public.push_release(text) from public, anon, authenticated, service_role;
revoke all on function public.push_prefs() from public, anon, authenticated, service_role;
revoke all on function public.push_set_prefs(boolean, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function public.push_claim(int) from public, anon, authenticated, service_role;
revoke all on function public.push_done(bigint[], text[]) from public, anon, authenticated, service_role;
revoke all on function public.push_auth_get() from public, anon, authenticated, service_role;
revoke all on function public.push_auth_swap(text, text, bigint, text) from public, anon, authenticated, service_role;

grant execute on function public.push_register(text, text) to authenticated;
grant execute on function public.push_unregister(text) to authenticated;
grant execute on function public.push_release(text) to authenticated;
grant execute on function public.push_prefs() to authenticated;
grant execute on function public.push_set_prefs(boolean, boolean, boolean) to authenticated;
grant execute on function public.push_claim(int) to service_role;
grant execute on function public.push_done(bigint[], text[]) to service_role;
grant execute on function public.push_auth_get() to service_role;
grant execute on function public.push_auth_swap(text, text, bigint, text) to service_role;
