-- ═══════════════════════════════════════════════════════════
--  Photos de bilan sur ordinateur : « Relier cet ordinateur » (27/11/2026, vague 5 de l'appli web du coach).
--  Protocole, modèle de menace et décisions : docs/PHOTOS_WEB.md ; protocole en code : js/data/photo-link.js.
--
--  Le serveur ne fait que RELAYER, sans pouvoir lire : la clé privée des photos du coach n'y passe que chiffrée pour
--  l'ordinateur (clé d'enveloppe tirée d'un échange ECDH entre le navigateur et l'iPhone, salée par un secret du QR
--  code que le serveur ne voit jamais). Il garde :
--  - public.coach_photo_pairings : un appairage en cours, 2 minutes, un seul à la fois par coach, à usage unique
--    (waiting → offered → done, chaque étape une fois). device_pub : clé publique éphémère du navigateur ; verifier :
--    SHA-256 du secret du QR (le téléphone prouve qu'il a lu le QR, sans que le serveur connaisse le secret) ;
--    epk : clé publique éphémère du téléphone.
--  - public.coach_photo_devices : les ordinateurs reliés (5 au plus), révocables, l'enveloppe et ce qu'il faut pour
--    la rouvrir côté navigateur. Clé du coach effacée (nouvelle clé ou clé republiée sur l'iPhone, compte supprimé) :
--    déclencheur sur public.coach_photo_keys, plus aucun ordinateur relié ; chaque lecture revérifie aussi que la clé
--    est toujours celle-là. Un déclencheur plutôt qu'une clé étrangère : le retour arrière des photos de bilan reste
--    lançable seul (supabase/rollback/ORDRE.md). Expiration : 30 jours sans usage, 90 jours au plus.
--  Tout part avec le compte (auth.users on delete cascade).
--
--  Accès : tables en RLS sans politique, aucun GRANT ; RPC security definer, search_path vide, utilisateur pris dans
--  auth.uid(), coach validé (private.is_coach), photos allumées (private.coach_photos_on). Une ligne d'un autre coach
--  répond exactement comme une ligne absente (not_found) : rien à deviner. anon n'exécute rien.
--  Bornes : 10 appairages commencés par heure, 600 ouvertures par heure, 5 ordinateurs.
--
--  Dépend de 20261107000000_photos_bilan.sql (en production). Réversible :
--  supabase/rollback/20261127010000_photos_web_appairage_down.sql. Tests : tests/sql/photos_web_appairage_test.sql.
-- ═══════════════════════════════════════════════════════════

create table public.coach_photo_pairings (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null references auth.users(id) on delete cascade,
  device_pub  text not null check (device_pub ~ '^B[A-P][A-Za-z0-9+/]{84}[AEIMQUYcgkosw048]=$'),
  verifier    text not null check (verifier ~ '^[A-Za-z0-9+/]{43}=$'),
  label       text not null check (char_length(label) between 1 and 60),
  state       text not null default 'waiting' check (state in ('waiting', 'offered', 'done')),
  epk         text check (epk ~ '^B[A-P][A-Za-z0-9+/]{84}[AEIMQUYcgkosw048]=$'),
  device_id   uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '2 minutes',
  check ((state = 'waiting') = (epk is null)),
  check ((state = 'done') = (device_id is not null))
);
create index coach_photo_pairings_coach on public.coach_photo_pairings (coach_id);
create index coach_photo_pairings_expires on public.coach_photo_pairings (expires_at);

-- id : celui de l'appairage (il entre dans les données liées de l'enveloppe, js/data/photo-link.js)
create table public.coach_photo_devices (
  id           uuid primary key,
  coach_id     uuid not null,
  key_id       text not null,
  label        text not null check (char_length(label) between 1 and 60),
  wrapped      text not null check (wrapped ~ '^[A-Za-z0-9+/]+={0,2}$' and char_length(wrapped) between 40 and 400),
  iv           text not null check (iv ~ '^[A-Za-z0-9+/]{16}$'),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '90 days'
);
create index coach_photo_devices_coach on public.coach_photo_devices (coach_id);
alter table public.coach_photo_devices add foreign key (coach_id) references auth.users(id) on delete cascade;

-- Clé du coach effacée (remplacée, republiée, compte supprimé) : les ordinateurs qui l'avaient perdent tout
create function private.coach_photo_key_gone() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  delete from public.coach_photo_devices d where d.coach_id = old.coach_id and d.key_id = old.key_id;
  return null;
end
$$;
create trigger coach_photo_devices_key_gone after delete on public.coach_photo_keys
  for each row execute function private.coach_photo_key_gone();

alter table public.coach_photo_pairings enable row level security;
alter table public.coach_photo_devices enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.coach_photo_pairings, public.coach_photo_devices from public, anon, authenticated, service_role;

-- ── Briques privées ──────────────────────────────────────

-- Coach validé, photos allumées : sinon not_coach / disabled (même ordre que coach_photo_key)
create function private.coach_photo_link_me() returns uuid
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or not private.is_coach(me) then raise exception 'not_coach' using errcode = 'P0001'; end if;
  if not private.coach_photos_on() then raise exception 'disabled' using errcode = 'P0001'; end if;
  return me;
end
$$;

-- Ménage : appairages finis depuis plus d'une heure (tous), ordinateurs expirés de ce coach
create function private.coach_photo_link_purge(me uuid) returns void
  language sql security definer set search_path = '' as
$$
  delete from public.coach_photo_pairings p where p.expires_at < now() - interval '1 hour';
  delete from public.coach_photo_devices d
    where d.coach_id = me and (d.expires_at <= now() or d.last_used_at <= now() - interval '30 days');
$$;

-- Nom de l'appareil : texte simple (marques de direction retirées, caractères de contrôle changés en espaces), 60 au plus, « Ordinateur » à défaut
create function private.coach_photo_label(v text) returns text
  language sql immutable set search_path = '' as
$$
  select coalesce(nullif(left(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(v, ''),
    '[\u202a-\u202e\u2066-\u2069]', '', 'g'), '[\u0001-\u001f\u007f-\u009f\u2028\u2029]', ' ', 'g'), '\s+', ' ', 'g')), 60), ''), 'Ordinateur')
$$;

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- Navigateur : commencer un appairage. Il faut une clé de photos (no_key : l'activer d'abord sur l'iPhone), moins
-- de 5 ordinateurs (too_many), 10 essais par heure. Un appairage en cours du même coach est remplacé.
-- → { pair, expires_at }
create function public.coach_photo_pair_start(device_pub text, verifier text, label text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := private.coach_photo_link_me(); p public.coach_photo_pairings%rowtype;
begin
  if device_pub is null or device_pub !~ '^B[A-P][A-Za-z0-9+/]{84}[AEIMQUYcgkosw048]=$'
     or verifier is null or verifier !~ '^[A-Za-z0-9+/]{43}=$' then
    raise exception 'invalid_device' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.coach_photo_keys k where k.coach_id = me) then raise exception 'no_key' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_photo_link:' || me::text, 0));
  perform private.coach_photo_link_purge(me);
  if (select count(*) from public.coach_photo_devices d where d.coach_id = me) >= 5 then raise exception 'too_many' using errcode = 'P0001'; end if;
  perform private.rate_limit_window(me, 'coach_photo_pair', 10, interval '1 hour');
  delete from public.coach_photo_pairings x where x.coach_id = me;
  insert into public.coach_photo_pairings (coach_id, device_pub, verifier, label)
    values (me, coach_photo_pair_start.device_pub, coach_photo_pair_start.verifier, private.coach_photo_label(coach_photo_pair_start.label))
    returning * into p;
  return jsonb_build_object('pair', p.id, 'expires_at', p.expires_at);
end
$$;

-- Téléphone : ce que dit le serveur de l'appairage lu dans le QR (le téléphone vérifie que device_pub est bien
-- celle du QR). Pas le mien, inconnu ou expiré : not_found. → { device_pub, label, state, expires_at }
create function public.coach_photo_pair_peek(pair uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := private.coach_photo_link_me(); p public.coach_photo_pairings%rowtype;
begin
  select * into p from public.coach_photo_pairings x where x.id = pair and x.coach_id = me and x.expires_at > now();
  if p.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  return jsonb_build_object('device_pub', p.device_pub, 'label', p.label, 'state', p.state, 'expires_at', p.expires_at);
end
$$;

-- Téléphone : publier sa clé éphémère, avec la preuve qu'il a lu le QR (verifier). Une seule fois : déjà offert ou
-- fini → already_used ; preuve fausse, pas le mien, expiré → not_found.
create function public.coach_photo_pair_offer(pair uuid, verifier text, epk text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := private.coach_photo_link_me(); p public.coach_photo_pairings%rowtype;
begin
  if epk is null or epk !~ '^B[A-P][A-Za-z0-9+/]{84}[AEIMQUYcgkosw048]=$' then raise exception 'invalid_device' using errcode = 'P0001'; end if;
  select * into p from public.coach_photo_pairings x where x.id = pair and x.coach_id = me and x.expires_at > now() for update;
  if p.id is null or p.verifier is distinct from coach_photo_pair_offer.verifier then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p.state <> 'waiting' then raise exception 'already_used' using errcode = 'P0001'; end if;
  update public.coach_photo_pairings x set state = 'offered', epk = coach_photo_pair_offer.epk where x.id = p.id;
  return jsonb_build_object('expires_at', p.expires_at);
end
$$;

-- Téléphone, après la comparaison des codes et Face ID : l'enveloppe. L'ordinateur est créé (id = l'appairage),
-- l'appairage passe à « done » (à usage unique). key_changed : la clé du coach n'est plus celle-là ;
-- already_used : pas au stade « offered » ; too_many : 5 ordinateurs déjà.
create function public.coach_photo_pair_complete(pair uuid, key_id text, wrapped text, iv text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := private.coach_photo_link_me(); p public.coach_photo_pairings%rowtype; d public.coach_photo_devices%rowtype;
begin
  if key_id is null or key_id !~ '^[0-9a-f]{32}$' or wrapped is null or wrapped !~ '^[A-Za-z0-9+/]+={0,2}$'
     or char_length(wrapped) not between 40 and 400 or coalesce(private.b64_bytes(wrapped), 0) not between 48 and 300
     or iv is null or iv !~ '^[A-Za-z0-9+/]{16}$' then
    raise exception 'invalid_device' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_photo_link:' || me::text, 0));
  select * into p from public.coach_photo_pairings x where x.id = pair and x.coach_id = me and x.expires_at > now() for update;
  if p.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p.state <> 'offered' then raise exception 'already_used' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.coach_photo_keys k where k.coach_id = me and k.key_id = coach_photo_pair_complete.key_id) then
    raise exception 'key_changed' using errcode = 'P0001';
  end if;
  perform private.coach_photo_link_purge(me);
  if (select count(*) from public.coach_photo_devices x where x.coach_id = me) >= 5 then raise exception 'too_many' using errcode = 'P0001'; end if;
  insert into public.coach_photo_devices (id, coach_id, key_id, label, wrapped, iv)
    values (p.id, me, coach_photo_pair_complete.key_id, p.label, coach_photo_pair_complete.wrapped, coach_photo_pair_complete.iv)
    returning * into d;
  update public.coach_photo_pairings x set state = 'done', device_id = d.id where x.id = p.id;
  return jsonb_build_object('device', d.id, 'label', d.label, 'created_at', d.created_at, 'expires_at', d.expires_at);
end
$$;

-- Navigateur : où en est l'appairage. → { state, epk (offered, done), device (done) } ; not_found sinon.
create function public.coach_photo_pair_status(pair uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := private.coach_photo_link_me(); p public.coach_photo_pairings%rowtype;
begin
  select * into p from public.coach_photo_pairings x where x.id = pair and x.coach_id = me and x.expires_at > now();
  if p.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  return jsonb_build_object('state', p.state, 'epk', p.epk, 'device', p.device_id);
end
$$;

-- L'un ou l'autre : abandonner (fenêtre fermée, « Non, annuler » sur l'iPhone). Silencieux.
create function public.coach_photo_pair_cancel(pair uuid) returns void
  language sql security definer set search_path = '' as
$$ delete from public.coach_photo_pairings p where p.id = pair and p.coach_id = (select auth.uid()) and p.state <> 'done' $$;

-- Téléphone : mes ordinateurs reliés (sans l'enveloppe). → [{ id, label, created_at, last_used_at, expires_at }]
create function public.coach_photo_devices() returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := private.coach_photo_link_me();
begin
  perform private.coach_photo_link_purge(me);
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'created_at', d.created_at,
                                                      'last_used_at', d.last_used_at, 'expires_at', d.expires_at) order by d.created_at desc)
                   from public.coach_photo_devices d where d.coach_id = me), '[]'::jsonb);
end
$$;

-- Navigateur : l'enveloppe de CET ordinateur, à chaque ouverture des photos (l'usage repousse l'expiration de
-- 30 jours, jamais au-delà des 90). Retiré, expiré, pas le mien : not_found. 600 par heure.
-- → { id, key_id, wrapped, iv, expires_at }
create function public.coach_photo_device_key(device uuid) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := private.coach_photo_link_me(); d public.coach_photo_devices%rowtype;
begin
  perform private.coach_photo_link_purge(me);
  select * into d from public.coach_photo_devices x where x.id = device and x.coach_id = me
    and exists (select 1 from public.coach_photo_keys k where k.coach_id = me and k.key_id = x.key_id);
  if d.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform private.rate_limit_window(me, 'coach_photo_device', 600, interval '1 hour');
  if d.last_used_at < now() - interval '1 hour' then
    update public.coach_photo_devices x set last_used_at = now() where x.id = d.id;
  end if;
  return jsonb_build_object('id', d.id, 'key_id', d.key_id, 'wrapped', d.wrapped, 'iv', d.iv, 'expires_at', d.expires_at);
end
$$;

-- L'un ou l'autre : retirer un ordinateur (iPhone : « Retirer » ; navigateur : « Oublier cet ordinateur »).
-- Silencieux, jamais limité, marche même photos éteintes ou rôle retiré (retirer un accès doit toujours être possible).
create function public.coach_photo_device_revoke(device uuid) returns void
  language sql security definer set search_path = '' as
$$ delete from public.coach_photo_devices d where d.id = device and d.coach_id = (select auth.uid()) $$;

-- ── Droits des fonctions ─────────────────────────────────
revoke all on function private.coach_photo_key_gone() from public, anon, authenticated, service_role;
revoke all on function private.coach_photo_link_me() from public, anon, authenticated, service_role;
revoke all on function private.coach_photo_link_purge(uuid) from public, anon, authenticated, service_role;
revoke all on function private.coach_photo_label(text) from public, anon, authenticated, service_role;
revoke all on function public.coach_photo_pair_start(text, text, text) from public, anon, authenticated;
revoke all on function public.coach_photo_pair_peek(uuid) from public, anon, authenticated;
revoke all on function public.coach_photo_pair_offer(uuid, text, text) from public, anon, authenticated;
revoke all on function public.coach_photo_pair_complete(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.coach_photo_pair_status(uuid) from public, anon, authenticated;
revoke all on function public.coach_photo_pair_cancel(uuid) from public, anon, authenticated;
revoke all on function public.coach_photo_devices() from public, anon, authenticated;
revoke all on function public.coach_photo_device_key(uuid) from public, anon, authenticated;
revoke all on function public.coach_photo_device_revoke(uuid) from public, anon, authenticated;
grant execute on function public.coach_photo_pair_start(text, text, text) to authenticated;
grant execute on function public.coach_photo_pair_peek(uuid) to authenticated;
grant execute on function public.coach_photo_pair_offer(uuid, text, text) to authenticated;
grant execute on function public.coach_photo_pair_complete(uuid, text, text, text) to authenticated;
grant execute on function public.coach_photo_pair_status(uuid) to authenticated;
grant execute on function public.coach_photo_pair_cancel(uuid) to authenticated;
grant execute on function public.coach_photo_devices() to authenticated;
grant execute on function public.coach_photo_device_key(uuid) to authenticated;
grant execute on function public.coach_photo_device_revoke(uuid) to authenticated;
