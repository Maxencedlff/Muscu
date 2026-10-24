-- ═══════════════════════════════════════════════════════════
--  Comptes MDLF Training : séances et profil synchronisés (js/data/sync.js, js/data/account.js)
--
--  Sécurité : RLS sur chaque table, chacun ne lit et n'écrit que ses lignes ((select auth.uid()),
--  évalué une fois par requête). Aucun accès anonyme aux données. GRANT explicites : depuis le
--  30/10/2026, une table de public n'est plus exposée à l'API sans GRANT.
--  Pas de DELETE côté client : une séance supprimée devient une tombstone (deleted_at), pour que les
--  autres appareils l'apprennent. Le compte et toutes ses lignes partent avec auth.users (on delete
--  cascade), via la fonction delete-account.
--  Jamais de poids du corps ni de donnée de Santé ici (règle Apple 5.1.3) : l'app les retire avant
--  l'envoi (sessionPayload, profilePayload).
-- ═══════════════════════════════════════════════════════════

create table public.sessions (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         text not null check (char_length(id) between 1 and 64),
  data       jsonb not null,
  client_mod timestamptz not null default now(),
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  -- Garde-fou de taille : une séance fait quelques Ko
  constraint sessions_data_size check (pg_column_size(data) < 200000)
);
create index sessions_user_updated on public.sessions (user_id, updated_at);

create table public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint profiles_doc_size check (pg_column_size(doc) < 1000000)
);

-- updated_at posé par le serveur (curseur de synchro), jamais par le client
create function public.touch_updated_at() returns trigger
  language plpgsql set search_path = '' as
$$ begin new.updated_at := now(); return new; end $$;
create trigger sessions_touch before insert or update on public.sessions
  for each row execute function public.touch_updated_at();
create trigger profiles_touch before insert or update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.sessions enable row level security;
alter table public.profiles enable row level security;

create policy sessions_select on public.sessions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy sessions_insert on public.sessions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy sessions_update on public.sessions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy profiles_select on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy profiles_insert on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy profiles_update on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.sessions, public.profiles from anon, authenticated;
grant select, insert, update on public.sessions, public.profiles to authenticated;

-- Réveil quotidien (cron Vercel) : une vraie requête à la base, sans aucune donnée, pour que le projet
-- gratuit ne soit pas mis en pause après 7 jours calmes
create function public.ping() returns timestamptz
  language sql stable security invoker set search_path = '' as $$ select now() $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
