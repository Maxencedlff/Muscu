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
grant usage on schema public to anon, authenticated;
