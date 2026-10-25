-- Vérifications de supabase/migrations/20261026000000_profils.sql et des migrations qui le modifient (lancées par tests/sql/run.sh).
-- Chaque bloc échoue (raise) si la règle n'est pas tenue.

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

-- Échec attendu d'une instruction : renvoie le message d'erreur, ou 'ok' si elle est passée
create function pg_temp.err(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.err(text) to authenticated, anon;

-- ── Compte A ─────────────────────────────────────────────
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

do $$ begin
  -- Première ligne : user_id vient de auth.uid(), aucun avatar par défaut (initiale du pseudo,
  -- 20261026040000_avatars2.sql)
  insert into public.user_profiles (username) values ('max.dlf');
  if (select avatar_emoji from public.user_profiles) is not null then raise 'pas d''avatar par défaut'; end if;
  if (select user_id from public.user_profiles) <> '00000000-0000-0000-0000-00000000000a' then raise 'user_id'; end if;
  if (select username_changed_at from public.user_profiles) is not null then raise 'premier choix : pas un changement'; end if;
end $$;

do $$ begin
  -- Colonnes réservées au serveur : refusées (GRANT par colonne)
  if pg_temp.err($q$ update public.user_profiles set username_changed_at = now() - interval '1 year' $q$) not like 'permission denied%' then raise 'username_changed_at modifiable'; end if;
  if pg_temp.err($q$ update public.user_profiles set created_at = now() $q$) not like 'permission denied%' then raise 'created_at modifiable'; end if;
  if pg_temp.err($q$ insert into public.user_profiles (user_id, username) values ('00000000-0000-0000-0000-00000000000b', 'pirate') $q$) not like 'permission denied%' then raise 'user_id inscriptible'; end if;
  if pg_temp.err($q$ delete from public.user_profiles $q$) not like 'permission denied%' then raise 'delete permis'; end if;
  -- Format et liste blanche
  if pg_temp.err($q$ update public.user_profiles set username = 'Max' $q$) not like '%user_profiles_username_format%' then raise 'majuscules acceptées'; end if;
  if pg_temp.err($q$ update public.user_profiles set username = 'ma..x' $q$) not like '%user_profiles_username_format%' then raise 'deux points acceptés'; end if;
  if pg_temp.err($q$ update public.user_profiles set username = '.max' $q$) not like '%user_profiles_username_format%' then raise 'point initial accepté'; end if;
  if pg_temp.err($q$ update public.user_profiles set username = 'ab' $q$) not like '%user_profiles_username_format%' then raise 'trop court accepté'; end if;
  if pg_temp.err($q$ update public.user_profiles set avatar_emoji = '💩' $q$) not like '%user_profiles_avatar_emoji%' then raise 'emoji hors liste accepté'; end if;
  if pg_temp.err($q$ update public.user_profiles set avatar_emoji = '<script>' $q$) not like '%user_profiles_avatar_emoji%' then raise 'texte accepté comme avatar'; end if;
  if pg_temp.err($q$ update public.user_profiles set avatar_emoji = '🔥' $q$) not like '%user_profiles_avatar_emoji%' then raise 'emoji retiré accepté'; end if;
  if pg_temp.err($q$ update public.user_profiles set avatar_emoji = '🦊' $q$) <> 'ok' then raise 'emoji de la liste refusé'; end if;
  if pg_temp.err($q$ update public.user_profiles set avatar_emoji = null $q$) <> 'ok' then raise 'retour à aucun avatar refusé'; end if;
  -- Mots interdits (exact et contains, points et tirets bas ignorés)
  if pg_temp.err($q$ update public.user_profiles set username = 'admin' $q$) <> 'username_forbidden' then raise 'admin accepté'; end if;
  if pg_temp.err($q$ update public.user_profiles set username = 'gros_con.nard' $q$) <> 'username_forbidden' then raise 'injure masquée acceptée'; end if;
  if pg_temp.err($q$ update public.user_profiles set username = 'mdlf_coach' $q$) <> 'username_forbidden' then raise 'mdlf accepté'; end if;
  -- Radical en exact : « technique » et « badminton » restent permis (vérifiés par la fonction)
  if not public.username_available('technique') or not public.username_available('badminton42') then raise 'faux positif'; end if;
end $$;

do $$ begin
  -- Premier changement libre, puis 30 jours d'attente ; l'avatar se change sans limite
  update public.user_profiles set username = 'maxence';
  if (select username_changed_at from public.user_profiles) is null then raise 'date du changement'; end if;
  if pg_temp.err($q$ update public.user_profiles set username = 'maxence2' $q$) <> 'username_too_soon' then raise 'délai de 30 jours'; end if;
  update public.user_profiles set avatar_emoji = '🦊';
  if (select avatar_emoji from public.user_profiles) <> '🦊' then raise 'avatar'; end if;
  if pg_temp.err($q$ update public.user_profiles set username = null $q$) <> 'username_required' then raise 'pseudo effacé'; end if;
  -- Disponibilité : son propre pseudo est libre pour soi
  if not public.username_available('maxence') then raise 'son pseudo'; end if;
  if public.username_available('Maxence') or public.username_available('a') then raise 'format'; end if;
end $$;

-- ── Compte B ─────────────────────────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.user_profiles) <> 0 then raise 'B voit la ligne de A'; end if;
  if public.username_available('maxence') then raise 'pseudo de A annoncé libre'; end if;
  if pg_temp.err($q$ insert into public.user_profiles (username) values ('maxence') $q$) not like '%user_profiles_username_key%' then raise 'doublon accepté'; end if;
  insert into public.user_profiles (avatar_emoji) values ('🐼');   -- « Plus tard » : sans pseudo
  update public.user_profiles set username = 'bob';                -- premier choix : libre
  if (select username_changed_at from public.user_profiles) is not null then raise 'premier choix compté'; end if;
  -- Écrire la ligne de A : invisible (RLS), donc rien de modifié
  update public.user_profiles set avatar_emoji = '🐙' where user_id = '00000000-0000-0000-0000-00000000000a';
end $$;

-- ── Anonyme ──────────────────────────────────────────────
reset role;
set role anon;
set request.jwt.claim.sub = '';
do $$ begin
  if pg_temp.err($q$ select * from public.user_profiles $q$) not like 'permission denied%' then raise 'anon lit la table'; end if;
  if pg_temp.err($q$ select public.username_available('bob') $q$) not like 'permission denied%' then raise 'anon appelle username_available'; end if;
  if pg_temp.err($q$ select * from private.username_rules $q$) not like 'permission denied%' then raise 'anon lit les règles'; end if;
end $$;

reset role;
do $$ begin
  if (select avatar_emoji from public.user_profiles where user_id = '00000000-0000-0000-0000-00000000000a') <> '🦊' then raise 'B a modifié A'; end if;
  -- Suppression du compte : la ligne part avec auth.users
  delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
  if exists (select 1 from public.user_profiles where user_id = '00000000-0000-0000-0000-00000000000a') then raise 'cascade'; end if;
end $$;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if pg_temp.err($q$ select * from private.username_rules $q$) not like 'permission denied%' then raise 'authenticated lit les règles'; end if;
  if pg_temp.err($q$ select private.username_forbidden('x') $q$) not like 'permission denied%' then raise 'authenticated appelle username_forbidden'; end if;
end $$;
reset role;
