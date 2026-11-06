-- Imitation minimale de ce que Supabase fournit avant nos migrations (schéma auth, rôles, auth.uid()),
-- pour tester les migrations sur un Postgres local jetable (tests/sql/run.sh). Jamais appliqué ailleurs.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
-- Schéma des extensions de Supabase (btree_gist, 20261105000000_coach_planning.sql)
create schema extensions;
create table auth.users (id uuid primary key, email text);
-- Comme Supabase : l'identifiant vient du JWT, ici d'un réglage de session posé par le test
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
-- Identités (moyens de connexion) : écrites par le serveur d'authentification, rôle supabase_auth_admin
-- (sans accès au schéma private, comme sur Supabase). Mêmes colonnes utiles et même cascade que Supabase.
create role supabase_auth_admin nologin;
create table auth.identities (
  id          uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null,
  created_at  timestamptz default now(),
  unique (provider_id, provider)
);
alter table auth.users add column created_at timestamptz default now();
grant usage on schema auth to supabase_auth_admin;
grant select, insert, update, delete on auth.users, auth.identities to supabase_auth_admin;
-- Droits par défaut de Supabase sur ce que postgres crée dans public : sans eux, un oubli de REVOKE
-- dans une migration passerait inaperçu ici (les tests « anon n'a rien » seraient vrais par hasard)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
-- Storage (photos de bilan, 20261107000000_photos_bilan.sql) : colonnes utiles de storage.buckets et
-- storage.objects (migrations de supabase/storage 0008, 0013, 0014, 0018), RLS activée sur les objets, droits
-- donnés par Supabase aux rôles de l'API, et le verrou 0055-prevent-direct-deletes.sql (28/01/2026) : un DELETE
-- en SQL est refusé sauf si storage.allow_delete_query vaut 'true' (ce que fait l'API Storage elle-même).
create schema storage;
create table storage.buckets (
  id text primary key, name text not null unique, owner uuid, owner_id text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  public boolean default false, file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
  owner uuid, owner_id text, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb, version text, user_metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
$$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create function storage.protect_delete() returns trigger language plpgsql as
$$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') <> 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using hint = 'This prevents accidental data loss from orphaned objects.', errcode = '42501';
  end if;
  return null;
end
$$;
create trigger protect_objects_delete before delete on storage.objects for each statement execute function storage.protect_delete();
create trigger protect_buckets_delete before delete on storage.buckets for each statement execute function storage.protect_delete();
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
