-- ═══════════════════════════════════════════════════════════
--  Pseudos renforcés (suite de 20261026000000_profils.sql, déjà appliquée : elle n'est pas modifiée)
--
--  1. Mots interdits mieux reconnus (private.username_forbidden, mêmes règles private.username_rules) :
--     - comparaison sans points ni tirets bas (comme avant), puis aussi après la lecture des chiffres
--       « leet » : 0→o, 1→i, 3→e, 4→a, 5→s, 7→t (« sh1t », « h1tler », « c0nnard ») ;
--     - mode exact : le mot seul, ou suivi de chiffres seulement (« pute69 », « apple2 ») ;
--     - nouveau mode prefix : le pseudo commence par le mot (« admin2 », « support_team », « staff.max »),
--       pour les rôles de l'équipe. Pas pour tous les mots réservés : « testosterone », « helpful » ou
--       « aiden » doivent rester possibles.
--  2. Pseudos qui ne diffèrent que par les points et tirets bas refusés (« maxdlf » si « max.dlf » est
--     pris) : index unique sur la forme sans points ni tirets bas, et même règle dans
--     public.username_available. Erreur 23505 comme un doublon (« Ce pseudo n'est pas disponible »).
--
--  Avant d'appliquer : la requête de contrôle en bas de ce fichier ne doit renvoyer aucune ligne
--  (sinon la création de l'index échoue, avec le message du bloc de garde ci-dessous).
-- ═══════════════════════════════════════════════════════════

-- Mode prefix
alter table private.username_rules drop constraint username_rules_mode_check;
alter table private.username_rules add constraint username_rules_mode_check check (mode in ('exact', 'contains', 'prefix'));
update private.username_rules set mode = 'prefix' where word in ('admin', 'support', 'staff', 'security', 'securite');
-- Variante sans lettre à remplacer par un chiffre (le « v » n'est pas lu comme un « u » : trop de faux positifs)
insert into private.username_rules (word, mode) values ('fvck', 'contains'), ('phuck', 'contains'), ('fck', 'exact')
  on conflict (word) do nothing;

-- Forme comparée : minuscules, sans points ni tirets bas ; puis la même avec les chiffres « leet » lus.
-- Appelées seulement depuis des fonctions security definer (jamais par le client)
create function private.username_plain(name text) returns text
  language sql immutable set search_path = '' as
$$ select replace(replace(lower(name), '.', ''), '_', '') $$;
create function private.username_leet(name text) returns text
  language sql immutable set search_path = '' as
$$ select translate(private.username_plain(name), '013457', 'oieast') $$;

create or replace function private.username_forbidden(name text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (
    select 1
    from private.username_rules r,
         unnest(array[private.username_plain(name), private.username_leet(name)]) as k(v)
    where (r.mode = 'exact' and (k.v = r.word or k.v ~ ('^' || r.word || '[0-9]+$')))
       or (r.mode = 'contains' and position(r.word in k.v) > 0)
       or (r.mode = 'prefix' and starts_with(k.v, r.word))
  )
$$;

-- Unicité sans points ni tirets bas. L'index s'écrit avec replace() (fonction intégrée) et non
-- private.username_plain : une expression d'index est évaluée avec les droits de qui écrit la ligne
-- (authenticated), qui n'a pas accès au schéma private. username est déjà en minuscules (contrainte
-- user_profiles_username_format). Garde : aucun doublon existant (sinon message clair).
do $$
declare dup text;
begin
  select string_agg(username, ', ') into dup from (
    select username from public.user_profiles p
    where username is not null and exists (
      select 1 from public.user_profiles q
      where q.user_id <> p.user_id and replace(replace(q.username, '.', ''), '_', '') = replace(replace(p.username, '.', ''), '_', ''))
  ) d;
  if dup is not null then
    raise exception 'pseudos en conflit (mêmes lettres, points et tirets bas mis à part) : %', dup;
  end if;
end $$;

create unique index user_profiles_username_plain_key on public.user_profiles ((replace(replace(username, '.', ''), '_', '')));

create or replace function public.username_available(name text) returns boolean
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
       where replace(replace(p.username, '.', ''), '_', '') = replace(replace(name, '.', ''), '_', '')
         and p.user_id <> (select auth.uid())
     )
$$;

-- Droits inchangés : fonctions privées hors de portée du client, username_available pour les connectés
revoke all on function private.username_plain(text) from public, anon, authenticated;
revoke all on function private.username_leet(text) from public, anon, authenticated;
revoke all on function private.username_forbidden(text) from public, anon, authenticated;
revoke all on function public.username_available(text) from public, anon, authenticated;
grant execute on function public.username_available(text) to authenticated;

-- Requête de contrôle à lancer avant d'appliquer (lecture seule) :
--   select replace(replace(username, '.', ''), '_', '') as forme, array_agg(username)
--   from public.user_profiles where username is not null
--   group by 1 having count(*) > 1;
