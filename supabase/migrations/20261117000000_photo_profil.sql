-- ═══════════════════════════════════════════════════════════
--  Photo de profil (16/11/2026, demande de Maxence : « une fonction payante pour les gens de mettre une vraie
--  photo de profil, et gratuite pour les coachs »). Contrat, choix et sources : docs/PHOTO_PROFIL.md.
--
--  Droit : INCLUSE dans MDLF Pro, sans achat à part, et offerte aux coachs dont le rôle est actif. Une seule
--  règle, private.pro_feature(uid) : le droit d'écrire du payant (private.access_json ->> 'can_write', le même que
--  pour enregistrer une séance) ou le rôle coach (private.is_coach). Tant que le verrou payant est éteint,
--  can_write vaut toujours vrai : la photo est ouverte à tous, comme le reste.
--
--  Fichier :
--  - Compartiment privé profile-photos (jamais public), 256 ko par fichier, image/jpeg ou image/webp. L'app envoie
--    une image carrée de 512 px recadrée et compressée sur l'iPhone (vers 60 ko), sans les métadonnées de la photo
--    d'origine (lieu, appareil : le canvas ne les recopie pas).
--  - Chemin <utilisateur>/<photo> (deux UUID, comme coach-photos : même purge). Aucune politique UPDATE : une
--    nouvelle photo a un nouveau chemin, l'ancienne part en purge.
--  - Envoi : profile_photo_prepare (droit, interrupteur, 10 par 24 h) → fichier → profile_photo_commit (fichier
--    présent, taille et type vérifiés). Une seule photo prête par compte ; la précédente est effacée au commit.
--
--  Qui la voit (private.profile_photo_visible, seule règle, lecture du fichier comprise) :
--  - moi ;
--  - un ami accepté, dans un sens ou dans l'autre (private.can_see : demande acceptée, social activé des deux côtés,
--    aucun blocage) ;
--  - mon coach et mes élèves (public.coach_links).
--  Et seulement tant que : l'interrupteur est allumé, la photo n'est pas masquée par la modération, son auteur a
--  encore le droit (private.pro_feature) et n'est pas interdit de photo. Lecture par URL signée (l'app la demande
--  pour 30 minutes, puis garde l'image en mémoire) : la politique SELECT de storage.objects applique la même règle.
--
--  Effacement : retour à l'emoji (profile_photo_remove), nouvelle photo, compte supprimé (on delete cascade),
--  modération : la ligne part, son fichier va dans la file private.profile_photo_trash (déclencheur), vidée par la
--  fonction coach-photos-purge (même planification horaire, deuxième compartiment). La ligne effacée, plus personne
--  ne peut demander d'URL ; une URL déjà donnée vaut au plus 30 minutes, ou jusqu'à la purge.
--
--  Modération (règle App Store 1.2, docs/PHOTO_PROFIL.md) :
--  - Signalement par la fonction Edge report existante : kind 'profile', target_ref 'photo:<id>'. Au 2e
--    signalant distinct de la même photo, elle est masquée pour tous (hidden_at) en attendant la relecture ;
--    l'alerte e-mail part dès le 1er (fonction report). Celui qui signale ne la voit plus tout de suite (app).
--  - Administrateur (éditeur SQL) : private.profile_photo_moderate(photo, 'remove' | 'restore' | 'ban'),
--    'ban' efface toutes les photos du compte et lui retire la photo (private.profile_photo_bans).
--  - Interrupteur app_config « profile_photos_on » : à false, plus aucune photo n'est servie ni envoyée.
--
--  Tables : RLS activée sans politique, aucun GRANT ; RPC security definer, search_path vide, utilisateur pris dans
--  auth.uid() ; anon n'exécute rien. Fonctions des politiques dans le schéma profile_photo_rls (non exposé par
--  l'API : à vérifier dans Data API › Exposed schemas, comme coach_photo_rls).
--
--  Réversible : supabase/rollback/20261117000000_photo_profil_down.sql (compartiment vidé d'abord par l'API).
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- Photos : 'pending' (préparée, fichier attendu dans l'heure) ou 'ready' (montrée). hidden_at : masquée par la
-- modération (2 signalants, ou l'administrateur), en attendant sa décision.
create table public.profile_photos (
  id         uuid primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  state      text not null default 'pending' check (state in ('pending', 'ready')),
  bytes      int check (bytes between 1 and 262144),
  created_at timestamptz not null default now(),
  ready_at   timestamptz,
  hidden_at  timestamptz
);
-- Une seule photo prête par compte
create unique index profile_photos_one_ready on public.profile_photos (user_id) where state = 'ready';
create index profile_photos_user on public.profile_photos (user_id, created_at);

-- Comptes privés de photo par l'administrateur (abus répétés)
create table private.profile_photo_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  at      timestamptz not null default now(),
  note    text check (char_length(note) <= 200)
);

-- Fichiers à effacer par l'API Storage (fonction coach-photos-purge)
create table private.profile_photo_trash (
  path text primary key check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  at   timestamptz not null default now()
);

alter table public.profile_photos enable row level security;
alter table private.profile_photo_bans enable row level security;
alter table private.profile_photo_trash enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.profile_photos, private.profile_photo_bans, private.profile_photo_trash
  from public, anon, authenticated, service_role;

-- Compartiment privé : jamais public, 256 ko par fichier, JPEG ou WebP seulement
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('profile-photos', 'profile-photos', false, 262144, array['image/jpeg', 'image/webp']);

-- Interrupteur lu par l'app (profile_photo_state.enabled) et par chaque fonction : true à l'installation
insert into public.app_config (key, value) values ('profile_photos_on', 'true'::jsonb) on conflict (key) do nothing;

-- ── Briques privées ──────────────────────────────────────

-- Fonctions Pro : le même droit que l'enregistrement des séances (verrou éteint : toujours vrai), ou coach actif
create function private.pro_feature(uid uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select uid is not null and (coalesce((private.access_json(uid) ->> 'can_write')::boolean, false) or private.is_coach(uid))
$$;

-- Photos de profil allumées ? Seulement si app_config.profile_photos_on vaut true
create function private.profile_photos_on() returns boolean
  language sql stable set search_path = '' as
$$ select coalesce((select c.value = 'true'::jsonb from public.app_config c where c.key = 'profile_photos_on'), false) $$;

-- Ce compte peut-il avoir une photo (droit, pas interdit) ?
create function private.profile_photo_allowed(uid uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select private.pro_feature(uid) and not exists (select 1 from private.profile_photo_bans b where b.user_id = uid)
$$;

-- viewer voit la photo de owner : soi-même, un ami accepté (un sens ou l'autre), son coach ou son élève
create function private.profile_photo_visible(viewer uuid, owner uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select viewer is not null and owner is not null and (
    viewer = owner
    or private.can_see(viewer, owner) or private.can_see(owner, viewer)
    or exists (select 1 from public.coach_links l
               where (l.coach_id = viewer and l.student_id = owner) or (l.coach_id = owner and l.student_id = viewer)))
$$;

create function private.profile_photo_path(owner uuid, photo uuid) returns text
  language sql immutable set search_path = '' as
$$ select owner::text || '/' || photo::text $$;

-- Ligne effacée (retour à l'emoji, nouvelle photo, compte supprimé, modération, envoi pas abouti) : fichier en file
create function private.profile_photo_trashed() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  insert into private.profile_photo_trash (path) values (private.profile_photo_path(old.user_id, old.id))
    on conflict (path) do nothing;
  return null;
end
$$;
create trigger profile_photos_trashed after delete on public.profile_photos
  for each row execute function private.profile_photo_trashed();

-- Signalement d'une photo (fonction Edge report, kind 'profile', target_ref 'photo:<id>') : masquée pour tous au
-- 2e signalant distinct sur 30 jours. La photo doit être celle du compte signalé (sinon rien).
create function private.profile_photo_reported() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare photo uuid;
begin
  if new.kind <> 'profile' or new.target_ref is null
     or new.target_ref !~ '^photo:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  photo := substr(new.target_ref, 7)::uuid;
  if (select count(distinct r.reporter_id) from public.reports r
      where r.target_user = new.target_user and r.target_ref = new.target_ref
        and r.created_at > now() - interval '30 days') >= 2 then
    update public.profile_photos p set hidden_at = coalesce(p.hidden_at, now())
      where p.id = photo and p.user_id = new.target_user;
  end if;
  return null;
end
$$;
create trigger reports_profile_photo after insert on public.reports
  for each row execute function private.profile_photo_reported();

-- ── Politiques du compartiment (schéma profile_photo_rls, non exposé) ──

create schema profile_photo_rls;
revoke all on schema profile_photo_rls from public, anon, authenticated, service_role;

-- Envoi du fichier : une photo que J'AI préparée il y a moins d'une heure, pas encore prête, photos allumées
create function profile_photo_rls.can_upload(object_name text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.profile_photos p
                 where p.user_id = (select auth.uid()) and p.state = 'pending'
                   and p.created_at > now() - interval '1 hour' and private.profile_photos_on()
                   and private.profile_photo_path(p.user_id, p.id) = object_name)
$$;

-- Lecture du fichier : mon propre dossier (retirer par l'API Storage demande SELECT), ou la photo prête d'un
-- compte que je peux voir, non masquée, dont l'auteur a encore le droit, photos allumées
create function profile_photo_rls.can_read(object_name text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select (select auth.uid()) is not null and (
    split_part(object_name, '/', 1) = (select auth.uid())::text
    or exists (select 1 from public.profile_photos p
               where p.state = 'ready' and p.hidden_at is null
                 and private.profile_photo_path(p.user_id, p.id) = object_name
                 and private.profile_photos_on()
                 and private.profile_photo_visible((select auth.uid()), p.user_id)
                 and private.profile_photo_allowed(p.user_id)))
$$;

revoke all on function profile_photo_rls.can_upload(text), profile_photo_rls.can_read(text) from public, anon, authenticated, service_role;
grant usage on schema profile_photo_rls to authenticated;
grant execute on function profile_photo_rls.can_upload(text), profile_photo_rls.can_read(text) to authenticated;

create policy profile_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos' and profile_photo_rls.can_upload(name));
create policy profile_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos' and profile_photo_rls.can_read(name));
-- Retrait : mon propre dossier seulement
create policy profile_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and split_part(name, '/', 1) = (select auth.uid())::text);

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- Ma photo : { enabled, allowed, banned, photo: { id, path, hidden } | null }. allowed : droit Pro ou coach (le
-- verrou éteint : toujours vrai). Photo gardée mais plus montrée (droit perdu, masquée) : photo rendue, avec hidden.
create function public.profile_photo_state() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id)
  select jsonb_build_object(
    'enabled', private.profile_photos_on(),
    'allowed', private.pro_feature(me.id),
    'banned', exists (select 1 from private.profile_photo_bans b where b.user_id = me.id),
    'photo', (select jsonb_build_object('id', p.id, 'path', private.profile_photo_path(p.user_id, p.id),
                                        'hidden', p.hidden_at is not null)
              from public.profile_photos p where p.user_id = me.id and p.state = 'ready'))
  from me
$$;

-- Préparer une nouvelle photo. Renvoie { id, path } : le fichier va ensuite à profile-photos/<path>, puis
-- profile_photo_commit. Erreurs : disabled, not_allowed (ni Pro ni coach), banned, rate_limited (10 par 24 h).
-- Les préparations précédentes pas abouties sont effacées.
create function public.profile_photo_prepare() returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  photo uuid := gen_random_uuid();
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if not private.profile_photos_on() then raise exception 'disabled' using errcode = 'P0001'; end if;
  if exists (select 1 from private.profile_photo_bans b where b.user_id = me) then raise exception 'banned' using errcode = 'P0001'; end if;
  if not private.pro_feature(me) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('profile_photo:' || me::text, 0));
  perform private.rate_limit_window(me, 'profile_photo', 10, interval '24 hours');
  delete from public.profile_photos p where p.user_id = me and p.state = 'pending';
  insert into public.profile_photos (id, user_id) values (photo, me);
  return jsonb_build_object('id', photo, 'path', private.profile_photo_path(me, photo));
end
$$;

-- Fichier envoyé : la photo devient ma photo de profil, la précédente est effacée. Le fichier doit être là, de
-- 256 ko au plus, JPEG ou WebP. Préparation inconnue, d'un autre ou expirée : not_found ; fichier absent, trop
-- gros ou d'un autre type : not_uploaded. Déjà prête : la même réponse (nouvel essai après une coupure).
create function public.profile_photo_commit(photo uuid) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  p public.profile_photos%rowtype;
  size bigint;
  mime text;
begin
  select * into p from public.profile_photos x where x.id = photo and x.user_id = me;
  if p.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p.state = 'ready' then
    return jsonb_build_object('id', p.id, 'path', private.profile_photo_path(me, p.id), 'hidden', p.hidden_at is not null);
  end if;
  if p.created_at <= now() - interval '1 hour' then raise exception 'not_found' using errcode = 'P0001'; end if;
  if not private.profile_photos_on() then raise exception 'disabled' using errcode = 'P0001'; end if;
  if not private.profile_photo_allowed(me) then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype' into size, mime from storage.objects o
    where o.bucket_id = 'profile-photos' and o.name = private.profile_photo_path(me, photo);
  if size is null or size < 1 or size > 262144 or mime is null or mime not in ('image/jpeg', 'image/webp') then
    raise exception 'not_uploaded' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('profile_photo:' || me::text, 0));
  delete from public.profile_photos x where x.user_id = me and x.state = 'ready';   -- déclencheur : en file
  update public.profile_photos x set state = 'ready', bytes = size, ready_at = now() where x.id = photo;
  return jsonb_build_object('id', photo, 'path', private.profile_photo_path(me, photo), 'hidden', false);
end
$$;

-- Retour à l'emoji (ou à l'initiale) : toutes mes photos effacées. Jamais limité, même photos éteintes.
create function public.profile_photo_remove() returns void
  language sql security definer set search_path = '' as
$$ delete from public.profile_photos p where p.user_id = (select auth.uid()) $$;

-- Photos des comptes que je peux voir, parmi uids (200 au plus) : [{ user_id, id, path }]. Sans droit de voir,
-- photo masquée, auteur sans droit ou photos éteintes : absent (l'app montre l'emoji ou l'initiale).
create function public.profile_photos(uids uuid[]) returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'id', p.id,
                                               'path', private.profile_photo_path(p.user_id, p.id))), '[]'::jsonb)
  from public.profile_photos p
  where private.profile_photos_on()
    and p.user_id = any ((coalesce(uids, array[]::uuid[]))[1:200])
    and p.state = 'ready' and p.hidden_at is null
    and private.profile_photo_visible((select auth.uid()), p.user_id)
    and private.profile_photo_allowed(p.user_id)
$$;

-- ── Administration (éditeur SQL) ─────────────────────────

-- 'remove' : photo effacée ; 'restore' : démasquée (signalement infondé) ; 'ban' : toutes les photos du compte
-- effacées et plus de photo pour lui (private.profile_photo_bans ; levée : delete from private.profile_photo_bans).
-- Renvoie le nombre de photos touchées.
create function private.profile_photo_moderate(photo uuid, action text, note text default null) returns int
  language plpgsql security definer set search_path = '' as
$$
declare
  owner uuid;
  n int;
begin
  select p.user_id into owner from public.profile_photos p where p.id = photo;
  if owner is null then return 0; end if;
  if action = 'remove' then
    delete from public.profile_photos p where p.id = photo;
  elsif action = 'restore' then
    update public.profile_photos p set hidden_at = null where p.id = photo;
  elsif action = 'ban' then
    insert into private.profile_photo_bans (user_id, note) values (owner, note) on conflict (user_id) do nothing;
    delete from public.profile_photos p where p.user_id = owner;
  else
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;
  get diagnostics n = row_count;
  return n;
end
$$;

-- ── Purge des fichiers (clé serveur : fonction coach-photos-purge, deuxième compartiment) ──

-- Prend jusqu'à max_n chemins à effacer. Avant : les préparations de plus d'une heure sans fichier validé sont
-- effacées (déclencheur : en file), et les fichiers sans ligne depuis plus d'une heure sont mis en file.
create function public.srv_profile_photo_purge_claim(max_n int) returns setof text
  language plpgsql security definer set search_path = '' as
$$
begin
  delete from public.profile_photos p where p.state = 'pending' and p.created_at <= now() - interval '1 hour';
  insert into private.profile_photo_trash (path)
    select o.name from storage.objects o
    where o.bucket_id = 'profile-photos' and o.created_at <= now() - interval '1 hour'
      and o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'
      and not exists (select 1 from public.profile_photos p
                      where p.id::text = split_part(o.name, '/', 2) and p.user_id::text = split_part(o.name, '/', 1))
    on conflict (path) do nothing;
  return query select t.path from private.profile_photo_trash t order by t.at, t.path
    limit greatest(1, least(coalesce(max_n, 100), 1000));
end
$$;

create function public.srv_profile_photo_purge_done(paths text[]) returns int
  language plpgsql security definer set search_path = '' as
$$
declare n int;
begin
  delete from private.profile_photo_trash t where t.path = any (coalesce(paths, array[]::text[]));
  get diagnostics n = row_count;
  return n;
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.pro_feature(uuid) from public, anon, authenticated, service_role;
revoke all on function private.profile_photos_on() from public, anon, authenticated, service_role;
revoke all on function private.profile_photo_allowed(uuid) from public, anon, authenticated, service_role;
revoke all on function private.profile_photo_visible(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.profile_photo_path(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.profile_photo_trashed() from public, anon, authenticated, service_role;
revoke all on function private.profile_photo_reported() from public, anon, authenticated, service_role;
revoke all on function private.profile_photo_moderate(uuid, text, text) from public, anon, authenticated, service_role;

revoke all on function public.profile_photo_state() from public, anon, authenticated;
revoke all on function public.profile_photo_prepare() from public, anon, authenticated;
revoke all on function public.profile_photo_commit(uuid) from public, anon, authenticated;
revoke all on function public.profile_photo_remove() from public, anon, authenticated;
revoke all on function public.profile_photos(uuid[]) from public, anon, authenticated;
revoke all on function public.srv_profile_photo_purge_claim(int) from public, anon, authenticated, service_role;
revoke all on function public.srv_profile_photo_purge_done(text[]) from public, anon, authenticated, service_role;

grant execute on function public.profile_photo_state() to authenticated;
grant execute on function public.profile_photo_prepare() to authenticated;
grant execute on function public.profile_photo_commit(uuid) to authenticated;
grant execute on function public.profile_photo_remove() to authenticated;
grant execute on function public.profile_photos(uuid[]) to authenticated;
grant execute on function public.srv_profile_photo_purge_claim(int) to service_role;
grant execute on function public.srv_profile_photo_purge_done(text[]) to service_role;

-- Administration :
--   signalements de photos : select r.id, r.target_user, r.target_ref, r.reason, r.created_at from public.reports r
--                             where r.target_ref like 'photo:%' order by r.created_at desc;
--   voir la photo : tableau de bord › Storage › profile-photos › <utilisateur>/<photo>
--   décider : select private.profile_photo_moderate('<photo>', 'remove' | 'restore' | 'ban', 'note');
