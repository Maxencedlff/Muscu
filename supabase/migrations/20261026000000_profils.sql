-- ═══════════════════════════════════════════════════════════
--  Profils publics du compte : pseudo et avatar (un emoji), js/data/account.js et js/data/account-auth.js
--
--  Séparé de profiles.doc (programmes et réglages, privés et synchronisés) : le pseudo et l'avatar
--  serviront plus tard à se retrouver entre amis. Pour l'instant, chacun ne voit que sa ligne.
--
--  Sécurité :
--  - RLS : select / insert / update de sa propre ligne seulement ; pas de DELETE côté client (la ligne
--    part avec auth.users, on delete cascade, via la fonction delete-account).
--  - GRANT par colonne : le client n'écrit que username et avatar_emoji. user_id vient de auth.uid()
--    (valeur par défaut, vérifiée par la RLS) ; username_changed_at, created_at et updated_at sont posés
--    par le serveur. Depuis le 30/10/2026, une table de public n'est plus exposée sans GRANT.
--  - Pseudo : minuscules, 3 à 20 caractères, lettres sans accent, chiffres, point et tiret bas, ni au
--    début ni à la fin, jamais deux points de suite (même règle que USERNAME_RE côté client).
--    Mots réservés et injures dans private.username_rules (schéma non exposé à l'API), vérifiés par
--    le déclencheur private.check_username, qui impose aussi 30 jours entre deux changements.
--  - Avatar : un emoji de la liste blanche (même liste qu'AVATAR_EMOJIS côté client ; un test
--    unitaire vérifie que les deux listes sont identiques). Aucune photo : rien à modérer.
--  - public.username_available(nom) : seule façon de savoir si un pseudo est pris (sans lire les
--    autres lignes), exécutable par un compte connecté seulement.
-- ═══════════════════════════════════════════════════════════

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.user_profiles (
  user_id             uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  username            text unique,
  avatar_emoji        text not null default '🔥',
  username_changed_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint user_profiles_username_format check (
    username is null or (
      username = lower(username)
      and username ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$'
      and position('..' in username) = 0
    )
  ),
  constraint user_profiles_avatar_emoji check (
    char_length(avatar_emoji) <= 8
    and avatar_emoji = any (array[
      '⚽', '🏀', '🎾', '🥊', '🥋', '🎯', '🏓', '🏆', '🥇', '👟',
      '🦁', '🐯', '🐻', '🐺', '🦊', '🐼', '🦅', '🦈', '🐙', '🦉',
      '🔥', '⚡', '⭐', '🌙', '🌊', '🌲', '🚀', '🎧', '💎', '🍀'
    ])
  )
);

-- Mots interdits dans un pseudo. exact : le pseudo entier (une fois points et tirets bas retirés) ;
-- contains : n'importe où dans le pseudo (même normalisation). Un radical qui se trouve dans des mots
-- courants est en exact (« nique » dans « technique », « pute » dans « député », « admin » dans
-- « badminton », « pedo » dans « pedometer »). Liste à compléter sans migration de
-- table (insert dans private.username_rules depuis l'éditeur SQL).
create table private.username_rules (
  word text primary key check (word = lower(word) and word ~ '^[a-z0-9]+$'),
  mode text not null check (mode in ('exact', 'contains'))
);
revoke all on private.username_rules from public, anon, authenticated;

insert into private.username_rules (word, mode) values
  -- Réservés : l'app, l'équipe, les rôles techniques
  ('mdlf', 'contains'), ('mdlftraining', 'contains'), ('admin', 'exact'), ('administrateur', 'contains'),
  ('moderateur', 'contains'), ('moderator', 'contains'), ('support', 'exact'), ('staff', 'exact'),
  ('officiel', 'contains'), ('official', 'contains'), ('root', 'exact'), ('system', 'exact'),
  ('systeme', 'exact'), ('null', 'exact'), ('undefined', 'exact'), ('anonymous', 'exact'),
  ('anonyme', 'exact'), ('apple', 'exact'), ('google', 'exact'), ('supabase', 'exact'),
  ('help', 'exact'), ('aide', 'exact'), ('contact', 'exact'), ('security', 'exact'), ('securite', 'exact'),
  ('compte', 'exact'), ('account', 'exact'),
  ('settings', 'exact'), ('reglages', 'exact'), ('privacy', 'exact'), ('test', 'exact'),
  -- Injures et insultes (français) : radicaux recherchés partout dans le pseudo
  ('connard', 'contains'), ('connasse', 'contains'), ('encule', 'contains'), ('enkule', 'contains'),
  ('salope', 'contains'), ('salaud', 'contains'), ('putain', 'contains'), ('pute', 'exact'),
  ('batard', 'contains'), ('fdp', 'contains'), ('ntm', 'exact'), ('nique', 'exact'),
  ('niquer', 'exact'), ('pede', 'exact'), ('tapette', 'contains'),
  ('gouine', 'contains'), ('negro', 'exact'), ('negre', 'contains'), ('bougnoul', 'contains'),
  ('youpin', 'contains'), ('bite', 'exact'), ('couille', 'contains'), ('chatte', 'exact'),
  ('merde', 'contains'), ('nazi', 'contains'), ('hitler', 'contains'), ('pedo', 'exact'),
  ('violeur', 'contains'), ('viol', 'exact'), ('suicide', 'contains'), ('terroriste', 'contains'),
  -- Injures et insultes (anglais)
  ('fuck', 'contains'), ('shit', 'contains'), ('bitch', 'contains'), ('cunt', 'contains'),
  ('asshole', 'contains'), ('dick', 'exact'), ('pussy', 'contains'), ('whore', 'contains'),
  ('slut', 'contains'), ('nigger', 'contains'), ('nigga', 'contains'), ('faggot', 'contains'),
  ('fag', 'exact'), ('retard', 'exact'), ('rapist', 'contains'), ('porn', 'contains'),
  ('sex', 'exact'), ('kys', 'exact'), ('killyourself', 'contains'), ('pedophile', 'contains');

-- Pseudo interdit (mots réservés ou injures) : comparaison sans points ni tirets bas
create function private.username_forbidden(name text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (
    select 1 from private.username_rules r
    where (r.mode = 'exact' and r.word = replace(replace(lower(name), '.', ''), '_', ''))
       or (r.mode = 'contains' and position(r.word in replace(replace(lower(name), '.', ''), '_', '')) > 0)
  )
$$;

-- Avant insert ou update : pseudo autorisé, 30 jours entre deux changements, dates posées par le
-- serveur. Erreurs lisibles par l'app (message exact) : username_forbidden, username_too_soon,
-- username_required (un pseudo choisi ne redevient pas vide : sinon effacer puis rechoisir
-- contournerait le délai). Le premier choix (pas encore de pseudo) n'est pas un changement : il est libre.
create function private.check_username() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.username_changed_at := null;
    if new.username is not null and private.username_forbidden(new.username) then
      raise exception 'username_forbidden' using errcode = 'P0001';
    end if;
    return new;
  end if;
  new.created_at := old.created_at;
  new.username_changed_at := old.username_changed_at;
  if new.username is not distinct from old.username then
    return new;
  end if;
  if new.username is null then
    raise exception 'username_required' using errcode = 'P0001';
  end if;
  if private.username_forbidden(new.username) then
    raise exception 'username_forbidden' using errcode = 'P0001';
  end if;
  if old.username is not null then
    if old.username_changed_at is not null and old.username_changed_at > now() - interval '30 days' then
      raise exception 'username_too_soon' using errcode = 'P0001';
    end if;
    new.username_changed_at := now();
  end if;
  return new;
end
$$;
create trigger user_profiles_check before insert or update on public.user_profiles
  for each row execute function private.check_username();

alter table public.user_profiles enable row level security;

create policy user_profiles_select on public.user_profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy user_profiles_insert on public.user_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy user_profiles_update on public.user_profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.user_profiles from public, anon, authenticated;
grant select on public.user_profiles to authenticated;
grant insert (username, avatar_emoji), update (username, avatar_emoji) on public.user_profiles to authenticated;

-- Pseudo libre ? Format valide, ni réservé ni injurieux, et personne d'autre ne l'a (son propre
-- pseudo actuel compte comme libre). Ne renvoie qu'un booléen : aucune ligne d'un autre compte n'est lue
-- par l'appelant.
create function public.username_available(name text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select (select auth.uid()) is not null
     and name is not null
     and name = lower(name)
     and name ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$'
     and position('..' in name) = 0
     and not private.username_forbidden(name)
     and not exists (
       select 1 from public.user_profiles p
       where p.username = name and p.user_id <> (select auth.uid())
     )
$$;

revoke all on function public.username_available(text) from public, anon, authenticated;
grant execute on function public.username_available(text) to authenticated;
revoke all on function private.username_forbidden(text) from public, anon, authenticated;
revoke all on function private.check_username() from public, anon, authenticated;
