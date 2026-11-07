-- ═══════════════════════════════════════════════════════════
--  Photos de bilan envoyées au coach (07/11/2026, demande du coach Dylan : « un côté bilan où ton client
--  t'envoie ses mensurations, possiblement des photos »). Contrat, choix et sources : docs/PHOTOS_BILAN.md.
--
--  Chiffrement de bout en bout : le serveur ne voit jamais une photo en clair.
--  - Le coach a UNE paire de clés ECDH P-256 (public.coach_photo_keys). La clé publique est ici en clair ; la
--    clé privée n'y est que chiffrée (AES-GCM) par un secret de 256 bits gardé dans SON trousseau iCloud (module
--    natif du coffre, rendu après Face ID). Le serveur ne peut donc pas la lire.
--  - Chaque photo est chiffrée sur l'iPhone de l'élève avec une clé à usage unique (ECDH éphémère + HKDF +
--    AES-GCM). Le fichier (Storage, compartiment privé coach-photos) n'est que du chiffré ; la ligne
--    public.coach_photos garde la clé publique éphémère (epk) et l'IV, rien qui permette de déchiffrer sans la
--    clé privée du coach.
--  - Limite assumée (docs/PHOTOS_BILAN.md) : un opérateur du serveur qui MODIFIERAIT la clé publique d'un coach
--    pourrait recevoir les photos envoyées ensuite. Le serveur tel qu'il est écrit ne le fait jamais : seul le
--    coach lui-même publie sa clé (coach_photo_key_set, auth.uid()).
--
--  Accès :
--  - Une photo n'existe que sous un lien élève-coach : clé étrangère (student_id, coach_id) vers coach_links on
--    delete cascade. Quitter le coach, être retiré, supprimer un des deux comptes efface les lignes, donc ce qui
--    servait à déchiffrer (crypto-effacement immédiat) ; le fichier part dans la file private.coach_photo_trash
--    (déclencheur), vidée par la fonction coach-photos-purge (API Storage, clé serveur).
--  - Coach qui change de clé (clé perdue) : ses anciennes photos sont effacées (clé étrangère vers sa clé on
--    delete cascade) ; l'élève les renverra.
--  - Lecture du fichier (createSignedUrl, download) : politique SELECT de storage.objects, seulement le coach
--    destinataire, encore coach, d'une photo prête ; l'élève lit son propre dossier (le retrait par l'API
--    Storage demande SELECT et DELETE). Écriture : INSERT seulement sur le chemin d'une photo préparée il y a
--    moins d'une heure par l'élève lui-même ; aucune politique UPDATE (pas de remplacement).
--  - Coach dont l'administrateur retire le rôle : il ne lit plus rien (private.is_coach), les photos restent
--    tant que le lien existe ; l'élève peut les retirer ou quitter.
--  - Tables : RLS activée sans politique, aucun GRANT ; RPC security definer, search_path vide, utilisateur pris
--    dans auth.uid() ; anon n'exécute rien. Les deux fonctions des politiques sont dans un schéma à part,
--    coach_photo_rls, que l'API ne doit pas exposer : authenticated y a USAGE et EXECUTE sur ces deux fonctions
--    seulement, jamais sur private. Les schémas exposés ne sont PAS dans supabase/config.toml (qui ne règle que les
--    fonctions) : ils se règlent dans le tableau de bord (Data API, « Exposed schemas », public par défaut), à
--    vérifier avant la mise en production (docs/PHOTOS_BILAN.md, « Mise en production »).
--
--  Âge : l'élève déclare avoir 18 ans ou plus avant son premier envoi (public.coach_photo_adults), sinon not_adult.
--  Coach : il peut faire disparaître une photo reçue (coach_photo_hide), même effet qu'un retrait.
--
--  Bornes : 3 photos par jour de prise, 60 photos par élève, 30 envois préparés par 24 h (private.social_rate
--  « coach_photo »), 10 changements de clé par 24 h ; fichier de 1 Mo au plus (compartiment et commit) ;
--  photo préparée non envoyée dans l'heure : effacée par la purge. Retirer une photo n'est jamais limité.
--
--  Interrupteur : public.app_config « coach_photos_on » (true à l'installation). Mis à false par l'administrateur
--  (éditeur SQL, docs/PHOTOS_BILAN.md « Désactiver sans nouvelle build ») : l'app n'affiche plus rien de neuf
--  (élève : ni envoi ni déclaration ; coach : rien), le serveur refuse clé, préparation, validation et lecture
--  par le coach (disabled) ; l'élève peut encore voir et retirer ce qui est déjà parti, et la purge continue.
--
--  Réversible : supabase/rollback/20261107000000_photos_bilan_down.sql (compartiment vidé d'abord par l'API).
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- Clé du coach : publique en clair (65 octets, point non compressé), privée chiffrée par son trousseau iCloud
-- (wrapped_key : PKCS#8 chiffré en AES-GCM, wrap_iv : 12 octets). key_id : nom du secret dans le trousseau.
create table public.coach_photo_keys (
  coach_id    uuid primary key references auth.users(id) on delete cascade,
  key_id      text not null check (key_id ~ '^[0-9a-f]{32}$'),
  public_key  text not null check (public_key ~ '^B[A-P][A-Za-z0-9+/]{84}[AEIMQUYcgkosw048]=$'),
  wrapped_key text not null check (wrapped_key ~ '^[A-Za-z0-9+/]+={0,2}$' and char_length(wrapped_key) between 40 and 400),
  wrap_iv     text not null check (wrap_iv ~ '^[A-Za-z0-9+/]{16}$'),
  created_at  timestamptz not null default now(),
  unique (coach_id, key_id)
);

-- Photo envoyée : une ligne = l'accord de l'élève pour CETTE photo et CE coach (created_at). Fichier à
-- coach-photos/<student_id>/<id>. state : 'pending' (préparée, fichier pas encore vérifié), 'ready' (visible).
create table public.coach_photos (
  id         uuid primary key,
  student_id uuid not null,
  coach_id   uuid not null,
  key_id     text not null,
  taken_on   date not null check (taken_on >= date '2020-01-01'),
  pose       text not null check (pose in ('face', 'side', 'back')),
  epk        text not null check (epk ~ '^B[A-P][A-Za-z0-9+/]{84}[AEIMQUYcgkosw048]=$'),
  iv         text not null check (iv ~ '^[A-Za-z0-9+/]{16}$'),
  state      text not null default 'pending' check (state in ('pending', 'ready')),
  bytes      int check (bytes between 1 and 1048576),
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  foreign key (student_id, coach_id) references public.coach_links (student_id, coach_id) on delete cascade,
  foreign key (coach_id, key_id) references public.coach_photo_keys (coach_id, key_id) on delete cascade
);
create index coach_photos_student on public.coach_photos (student_id, taken_on);
create index coach_photos_coach on public.coach_photos (coach_id, student_id);

-- Déclaration « 18 ans ou plus » de l'élève (une fois, horodatée) : sans elle, aucune photo ne part. Les élèves
-- peuvent avoir 15 ans (règle du coach) ; des photos de corps chiffrées, que personne ne peut modérer, envoyées par
-- un mineur à un adulte : refusé (docs/PHOTOS_BILAN.md, « Âge »). Effacée avec le compte.
create table public.coach_photo_adults (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  declared_at timestamptz not null default now()
);

-- Fichiers à effacer par l'API Storage (le SQL n'efface pas le fichier lui-même : docs/PHOTOS_BILAN.md)
create table private.coach_photo_trash (
  path text primary key check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  at   timestamptz not null default now()
);

alter table public.coach_photo_keys enable row level security;
alter table public.coach_photo_adults enable row level security;
alter table public.coach_photos enable row level security;
alter table private.coach_photo_trash enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.coach_photo_keys, public.coach_photo_adults, public.coach_photos, private.coach_photo_trash
  from public, anon, authenticated, service_role;

-- Compartiment privé : jamais public, 1 Mo par fichier, du chiffré seulement
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('coach-photos', 'coach-photos', false, 1048576, array['application/octet-stream']);

-- Interrupteur lu par l'app (student_photo_state.enabled) et par chaque fonction : true à l'installation
insert into public.app_config (key, value) values ('coach_photos_on', 'true'::jsonb) on conflict (key) do nothing;

-- ── Briques privées ──────────────────────────────────────

-- Photos de bilan allumées ? Seulement si app_config.coach_photos_on vaut true (absent ou autre valeur : éteint)
create function private.coach_photos_on() returns boolean
  language sql stable set search_path = '' as
$$ select coalesce((select c.value = 'true'::jsonb from public.app_config c where c.key = 'coach_photos_on'), false) $$;

-- Chemin du fichier d'une photo
create function private.coach_photo_path(student uuid, photo uuid) returns text
  language sql immutable set search_path = '' as
$$ select student::text || '/' || photo::text $$;

-- Ligne effacée (retrait, lien rompu, compte supprimé, clé changée, envoi pas abouti) : fichier mis en file
create function private.coach_photo_trashed() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  insert into private.coach_photo_trash (path) values (private.coach_photo_path(old.student_id, old.id))
    on conflict (path) do nothing;
  return null;
end
$$;
create trigger coach_photos_trashed after delete on public.coach_photos
  for each row execute function private.coach_photo_trashed();

-- Nombre d'octets d'un texte en base64, null s'il est illisible
create function private.b64_bytes(v text) returns int
  language plpgsql immutable set search_path = '' as
$$
begin
  return octet_length(decode(v, 'base64'));
exception when others then
  return null;
end
$$;

-- ── Politiques du compartiment (schéma coach_photo_rls, non exposé) ──

create schema coach_photo_rls;
revoke all on schema coach_photo_rls from public, anon, authenticated, service_role;

-- Envoi du fichier : une photo que J'AI préparée il y a moins d'une heure, pas encore envoyée
create function coach_photo_rls.can_upload(object_name text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.coach_photos p
                 where p.student_id = (select auth.uid()) and p.state = 'pending'
                   and p.created_at > now() - interval '1 hour' and private.coach_photos_on()
                   and private.coach_photo_path(p.student_id, p.id) = object_name)
$$;

-- Lecture du fichier : mon propre dossier (élève, même éteint : retirer demande SELECT), ou une photo prête qui
-- m'est destinée, encore coach, photos allumées
create function coach_photo_rls.can_read(object_name text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select (select auth.uid()) is not null and (
    split_part(object_name, '/', 1) = (select auth.uid())::text
    or exists (select 1 from public.coach_photos p
               where p.coach_id = (select auth.uid()) and p.state = 'ready'
                 and private.coach_photo_path(p.student_id, p.id) = object_name
                 and private.is_coach(p.coach_id) and private.coach_photos_on()))
$$;

revoke all on function coach_photo_rls.can_upload(text), coach_photo_rls.can_read(text) from public, anon, authenticated, service_role;
grant usage on schema coach_photo_rls to authenticated;
grant execute on function coach_photo_rls.can_upload(text), coach_photo_rls.can_read(text) to authenticated;

create policy coach_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'coach-photos' and coach_photo_rls.can_upload(name));
create policy coach_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'coach-photos' and coach_photo_rls.can_read(name));
-- Retrait par l'élève : son propre dossier seulement (le coach n'efface rien, il n'écrit rien)
create policy coach_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'coach-photos' and split_part(name, '/', 1) = (select auth.uid())::text);

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- Coach : ma clé ({ key_id, public_key, wrapped_key, wrap_iv, created_at }) ou null. Pas coach : not_coach.
-- Photos éteintes : disabled (l'app n'affiche alors rien).
create function public.coach_photo_key() returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or not private.is_coach(me) then raise exception 'not_coach' using errcode = 'P0001'; end if;
  if not private.coach_photos_on() then raise exception 'disabled' using errcode = 'P0001'; end if;
  return (select jsonb_build_object('key_id', k.key_id, 'public_key', k.public_key, 'wrapped_key', k.wrapped_key,
                                    'wrap_iv', k.wrap_iv, 'created_at', k.created_at)
          from public.coach_photo_keys k where k.coach_id = me);
end
$$;

-- Coach : publier ma clé. Déjà une clé et replace faux : key_exists (deux appareils en même temps : le second
-- relit celle du premier). replace vrai : l'ancienne est effacée, avec toutes les photos chiffrées pour elle.
-- Forme mauvaise : invalid_key ; 10 par 24 h (rate_limited) ; photos éteintes : disabled.
create function public.coach_photo_key_set(key_id text, public_key text, wrapped_key text, wrap_iv text, replace boolean)
  returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or not private.is_coach(me) then raise exception 'not_coach' using errcode = 'P0001'; end if;
  if not private.coach_photos_on() then raise exception 'disabled' using errcode = 'P0001'; end if;
  if key_id is null or key_id !~ '^[0-9a-f]{32}$'
     or public_key is null or public_key !~ '^B[A-P][A-Za-z0-9+/]{84}[AEIMQUYcgkosw048]=$'
     or wrapped_key is null or wrapped_key !~ '^[A-Za-z0-9+/]+={0,2}$' or char_length(wrapped_key) not between 40 and 400
     or coalesce(private.b64_bytes(wrapped_key), 0) not between 48 and 300
     or wrap_iv is null or wrap_iv !~ '^[A-Za-z0-9+/]{16}$' then
    raise exception 'invalid_key' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_photo_key:' || me::text, 0));
  if exists (select 1 from public.coach_photo_keys k where k.coach_id = me) then
    if replace is not true then raise exception 'key_exists' using errcode = 'P0001'; end if;
    perform private.rate_limit_window(me, 'coach_photo_key', 10, interval '24 hours');
    delete from public.coach_photo_keys k where k.coach_id = me;   -- cascade : photos chiffrées pour elle
  else
    perform private.rate_limit_window(me, 'coach_photo_key', 10, interval '24 hours');
  end if;
  insert into public.coach_photo_keys (coach_id, key_id, public_key, wrapped_key, wrap_iv)
    values (me, coach_photo_key_set.key_id, coach_photo_key_set.public_key, coach_photo_key_set.wrapped_key, coach_photo_key_set.wrap_iv);
  return public.coach_photo_key();
end
$$;

-- Élève : où en sont mes photos chez mon coach actuel. { coach, ready, key: { key_id, public_key } | null,
-- photos: [{ id, taken_on, pose, bytes, sent_at }] (prêtes, de la plus récente), per_day, max }.
-- ready : mon coach est coach et a une clé (sinon rien ne peut partir). enabled : interrupteur
-- app_config.coach_photos_on (faux : l'app ne propose plus d'envoi, l'élève voit et retire ce qui est parti).
create function public.student_photo_state() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id),
  l as (select cl.student_id, cl.coach_id from me join public.coach_links cl on cl.student_id = me.id),
  k as (select k.key_id, k.public_key from l join public.coach_photo_keys k on k.coach_id = l.coach_id
        where private.is_coach(l.coach_id))
  select jsonb_build_object(
    'coach', exists (select 1 from l),
    'enabled', private.coach_photos_on(),
    'ready', exists (select 1 from k),
    'adult', exists (select 1 from me join public.coach_photo_adults a on a.user_id = me.id),
    'key', (select jsonb_build_object('key_id', k.key_id, 'public_key', k.public_key) from k),
    'per_day', 3, 'max', 60,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'taken_on', p.taken_on, 'pose', p.pose,
                                                            'bytes', p.bytes, 'sent_at', p.sent_at)
                                         order by p.taken_on desc, p.sent_at desc)
                        from l join public.coach_photos p on p.student_id = l.student_id and p.coach_id = l.coach_id
                        where p.state = 'ready'), '[]'::jsonb))
$$;

-- Élève : préparer l'envoi d'une photo (accord donné à l'instant dans l'app, pour cette photo). L'identifiant
-- est tiré par l'app (il entre dans les données authentifiées du chiffrement). Renvoie { id, path } : le fichier
-- chiffré va ensuite à coach-photos/<path>, puis student_photo_commit.
-- Erreurs : not_found (pas de coach), not_ready (coach sans clé, ou plus coach), key_changed (clé du coach
-- changée depuis la lecture : relire l'état), invalid_photo, too_many (3 par jour, 60 en tout), rate_limited,
-- disabled (photos éteintes).
create function public.student_photo_prepare(photo uuid, key_id text, taken_on date, pose text, epk text, iv text)
  returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  coach uuid;
  current_key text;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if not private.coach_photos_on() then raise exception 'disabled' using errcode = 'P0001'; end if;
  select l.coach_id into coach from public.coach_links l where l.student_id = me;
  if coach is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  select k.key_id into current_key from public.coach_photo_keys k where k.coach_id = coach;
  if current_key is null or not private.is_coach(coach) then raise exception 'not_ready' using errcode = 'P0001'; end if;
  if student_photo_prepare.key_id is distinct from current_key then raise exception 'key_changed' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.coach_photo_adults a where a.user_id = me) then raise exception 'not_adult' using errcode = 'P0001'; end if;
  if photo is null or taken_on is null or taken_on < date '2020-01-01' or taken_on > current_date + 1
     or pose is null or pose not in ('face', 'side', 'back')
     or epk is null or epk !~ '^B[A-P][A-Za-z0-9+/]{84}[AEIMQUYcgkosw048]=$'
     or iv is null or iv !~ '^[A-Za-z0-9+/]{16}$' then
    raise exception 'invalid_photo' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_photo:' || me::text, 0));
  if (select count(*) from public.coach_photos p where p.student_id = me and p.taken_on = student_photo_prepare.taken_on) >= 3
     or (select count(*) from public.coach_photos p where p.student_id = me) >= 60 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;
  perform private.rate_limit_window(me, 'coach_photo', 30, interval '24 hours');
  begin
    insert into public.coach_photos (id, student_id, coach_id, key_id, taken_on, pose, epk, iv)
      values (photo, me, coach, current_key, student_photo_prepare.taken_on, student_photo_prepare.pose,
              student_photo_prepare.epk, student_photo_prepare.iv);
  exception when unique_violation then
    raise exception 'invalid_photo' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', photo, 'path', private.coach_photo_path(me, photo));
end
$$;

-- Élève : fichier envoyé, la photo devient visible du coach. Le fichier doit être là, au bon chemin, de 1 Mo
-- au plus. Préparation inconnue, d'un autre ou expirée : not_found ; fichier absent ou trop gros : not_uploaded.
-- Déjà prête : renvoie la même chose (nouvel essai après une coupure). Photos éteintes : disabled.
create function public.student_photo_commit(photo uuid) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  p public.coach_photos%rowtype;
  size bigint;
begin
  select * into p from public.coach_photos x where x.id = photo and x.student_id = me;
  if p.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p.state = 'ready' then
    return jsonb_build_object('id', p.id, 'taken_on', p.taken_on, 'pose', p.pose, 'bytes', p.bytes, 'sent_at', p.sent_at);
  end if;
  if p.created_at <= now() - interval '1 hour' then raise exception 'not_found' using errcode = 'P0001'; end if;
  if not private.coach_photos_on() then raise exception 'disabled' using errcode = 'P0001'; end if;
  select (o.metadata ->> 'size')::bigint into size from storage.objects o
    where o.bucket_id = 'coach-photos' and o.name = private.coach_photo_path(me, photo);
  if size is null or size < 32 or size > 1048576 then raise exception 'not_uploaded' using errcode = 'P0001'; end if;
  update public.coach_photos x set state = 'ready', bytes = size, sent_at = now() where x.id = photo
    returning * into p;
  return jsonb_build_object('id', p.id, 'taken_on', p.taken_on, 'pose', p.pose, 'bytes', p.bytes, 'sent_at', p.sent_at);
end
$$;

-- Élève : retirer une photo (prête ou en cours). Le coach n'y a plus accès dans la même transaction ; le fichier
-- part dans la file (et l'app l'efface aussi elle-même). Silencieux si elle n'existe pas. Jamais limité.
create function public.student_photo_remove(photo uuid) returns void
  language sql security definer set search_path = '' as
$$ delete from public.coach_photos p where p.id = photo and p.student_id = (select auth.uid()) $$;

-- Élève : « j'ai 18 ans ou plus », déclaré dans l'app avant le premier envoi (une fois). Renvoie student_photo_state().
create function public.student_photo_adult() returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  insert into public.coach_photo_adults (user_id) values (me) on conflict (user_id) do nothing;
  return public.student_photo_state();
end
$$;

-- Coach : ne plus voir une photo reçue (contenu déplacé, envoyée par erreur) : effacée comme un retrait de
-- l'élève (ligne, puis fichier en file). Pas mon élève ou plus coach : not_found. Silencieux si elle n'existe pas.
create function public.coach_photo_hide(photo uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or not private.is_coach(me) then raise exception 'not_found' using errcode = 'P0001'; end if;
  delete from public.coach_photos p where p.id = photo and p.coach_id = me;
end
$$;

-- Coach : photos prêtes d'un de mes élèves, chiffrées pour ma clé actuelle. { photos: [{ id, path, taken_on,
-- pose, epk, iv, key_id, bytes, sent_at }] } de la plus récente. Pas mon élève, ou plus coach : not_found.
-- Photos éteintes : disabled.
create function public.coach_student_photos(student uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  perform private.coach_require_student(me, student);
  if not private.coach_photos_on() then raise exception 'disabled' using errcode = 'P0001'; end if;
  return jsonb_build_object('photos', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'path', private.coach_photo_path(p.student_id, p.id),
                                        'taken_on', p.taken_on, 'pose', p.pose, 'epk', p.epk, 'iv', p.iv,
                                        'key_id', p.key_id, 'bytes', p.bytes, 'sent_at', p.sent_at)
                     order by p.taken_on desc, p.sent_at desc)
    from public.coach_photos p
    where p.student_id = student and p.coach_id = me and p.state = 'ready'), '[]'::jsonb));
end
$$;

-- ── Purge des fichiers (clé serveur : fonction coach-photos-purge) ──

-- Prend jusqu'à max_n chemins à effacer. Avant : les envois préparés depuis plus d'une heure sans aboutir sont
-- effacés (déclencheur : en file), et les fichiers du compartiment sans ligne depuis plus d'une heure (envoi
-- interrompu entre le fichier et la ligne) sont mis en file.
create function public.srv_coach_photo_purge_claim(max_n int) returns setof text
  language plpgsql security definer set search_path = '' as
$$
begin
  delete from public.coach_photos p where p.state = 'pending' and p.created_at <= now() - interval '1 hour';
  insert into private.coach_photo_trash (path)
    select o.name from storage.objects o
    where o.bucket_id = 'coach-photos' and o.created_at <= now() - interval '1 hour'
      and o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'
      and not exists (select 1 from public.coach_photos p
                      where p.id::text = split_part(o.name, '/', 2) and p.student_id::text = split_part(o.name, '/', 1))
    on conflict (path) do nothing;
  return query select t.path from private.coach_photo_trash t order by t.at, t.path
    limit greatest(1, least(coalesce(max_n, 100), 1000));
end
$$;

-- Chemins effacés par l'API Storage : retirés de la file. Renvoie le nombre retiré.
create function public.srv_coach_photo_purge_done(paths text[]) returns int
  language plpgsql security definer set search_path = '' as
$$
declare n int;
begin
  delete from private.coach_photo_trash t where t.path = any (coalesce(paths, array[]::text[]));
  get diagnostics n = row_count;
  return n;
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.coach_photo_path(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.coach_photo_trashed() from public, anon, authenticated, service_role;
revoke all on function private.b64_bytes(text) from public, anon, authenticated, service_role;
revoke all on function private.coach_photos_on() from public, anon, authenticated, service_role;

revoke all on function public.coach_photo_key() from public, anon, authenticated;
revoke all on function public.coach_photo_key_set(text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.student_photo_state() from public, anon, authenticated;
revoke all on function public.student_photo_prepare(uuid, text, date, text, text, text) from public, anon, authenticated;
revoke all on function public.student_photo_commit(uuid) from public, anon, authenticated;
revoke all on function public.student_photo_remove(uuid) from public, anon, authenticated;
revoke all on function public.coach_student_photos(uuid) from public, anon, authenticated;
revoke all on function public.student_photo_adult() from public, anon, authenticated;
revoke all on function public.coach_photo_hide(uuid) from public, anon, authenticated;
revoke all on function public.srv_coach_photo_purge_claim(int) from public, anon, authenticated, service_role;
revoke all on function public.srv_coach_photo_purge_done(text[]) from public, anon, authenticated, service_role;

grant execute on function public.coach_photo_key() to authenticated;
grant execute on function public.coach_photo_key_set(text, text, text, text, boolean) to authenticated;
grant execute on function public.student_photo_state() to authenticated;
grant execute on function public.student_photo_prepare(uuid, text, date, text, text, text) to authenticated;
grant execute on function public.student_photo_commit(uuid) to authenticated;
grant execute on function public.student_photo_remove(uuid) to authenticated;
grant execute on function public.coach_student_photos(uuid) to authenticated;
grant execute on function public.student_photo_adult() to authenticated;
grant execute on function public.coach_photo_hide(uuid) to authenticated;
grant execute on function public.srv_coach_photo_purge_claim(int) to service_role;
grant execute on function public.srv_coach_photo_purge_done(text[]) to service_role;
