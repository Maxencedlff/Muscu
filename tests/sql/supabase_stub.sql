-- Imitation minimale de ce que Supabase fournit avant nos migrations (schéma auth, rôles, auth.uid()),
-- pour tester les migrations sur un Postgres local jetable (tests/sql/run.sh). Jamais appliqué ailleurs.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
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
