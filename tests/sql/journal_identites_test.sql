-- Vérifications de supabase/migrations/20261026020000_journal_identites.sql (lancées par tests/sql/run.sh).
-- Chaque bloc échoue (raise) si la règle n'est pas tenue.

create function pg_temp.err(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.err(text) to authenticated, anon, supabase_auth_admin;

-- Comptes : C ancien (créé il y a 30 jours avec son e-mail), N tout neuf (créé avec Google)
insert into auth.users (id, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', now() - interval '30 days'),
  ('00000000-0000-0000-0000-0000000000c2', now());

-- ── Comme le serveur d'authentification (rôle sans accès au schéma private) ──
set role supabase_auth_admin;
insert into auth.identities (provider_id, user_id, provider) values ('n-google', '00000000-0000-0000-0000-0000000000c2', 'google');
reset role;

do $$ begin
  -- Le premier moyen du compte neuf est journalisé mais toléré (création du compte)
  if (select count(*) from private.identity_events where user_id = '00000000-0000-0000-0000-0000000000c2' and event = 'linked') <> 1 then raise 'ajout non journalisé'; end if;
  if public.recent_identity_change('00000000-0000-0000-0000-0000000000c2', interval '24 hours') is not null then raise 'identité de création du compte comptée'; end if;
end $$;

-- Compte ancien : son e-mail date de la création du compte (événement ramené 30 jours en arrière)
insert into auth.identities (provider_id, user_id, provider, created_at) values
  ('c-email', '00000000-0000-0000-0000-0000000000c1', 'email', now() - interval '30 days');
update private.identity_events set at = now() - interval '30 days' where user_id = '00000000-0000-0000-0000-0000000000c1';

do $$ begin
  if public.recent_identity_change('00000000-0000-0000-0000-0000000000c1', interval '24 hours') is not null then raise 'compte ancien sans changement'; end if;
end $$;

-- L'attaque : relier son Google puis le retirer aussitôt (même rôle que le serveur d'authentification)
set role supabase_auth_admin;
insert into auth.identities (provider_id, user_id, provider) values ('pirate-google', '00000000-0000-0000-0000-0000000000c1', 'google');
delete from auth.identities where provider_id = 'pirate-google';
reset role;

do $$ declare n int; begin
  select count(*) into n from private.identity_events where user_id = '00000000-0000-0000-0000-0000000000c1' and provider = 'google';
  if n <> 2 then raise 'ajout et retrait : % événement(s)', n; end if;
  if not exists (select 1 from private.identity_events where user_id = '00000000-0000-0000-0000-0000000000c1' and event = 'unlinked' and provider = 'google') then raise 'retrait non journalisé'; end if;
  if public.recent_identity_change('00000000-0000-0000-0000-0000000000c1', interval '24 hours') is null then raise 'retrait récent non vu'; end if;
  -- Fenêtre respectée : un événement plus vieux que « since » ne compte pas
  update private.identity_events set at = now() - interval '25 hours' where user_id = '00000000-0000-0000-0000-0000000000c1' and provider = 'google';
  if public.recent_identity_change('00000000-0000-0000-0000-0000000000c1', interval '24 hours') is not null then raise 'fenêtre de 24 h'; end if;
end $$;

-- Compte neuf : un retrait juste après la création n'est jamais toléré (seul le premier ajout l'est)
delete from auth.identities where provider_id = 'n-google';
do $$ begin
  if public.recent_identity_change('00000000-0000-0000-0000-0000000000c2', interval '24 hours') is null then raise 'retrait sur un compte neuf toléré'; end if;
end $$;

-- Purge : les événements de plus de 30 jours partent au prochain événement
insert into private.identity_events (user_id, provider, event, at) values
  ('00000000-0000-0000-0000-0000000000c1', 'google', 'unlinked', now() - interval '31 days');
insert into auth.identities (provider_id, user_id, provider) values ('c-apple', '00000000-0000-0000-0000-0000000000c1', 'apple');
do $$ begin
  if exists (select 1 from private.identity_events where at < now() - interval '30 days') then raise 'purge des 30 jours'; end if;
end $$;

-- ── Rôles de l'API : rien à lire, rien à appeler ──
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
set role authenticated;
do $$ begin
  if pg_temp.err($q$ select * from private.identity_events $q$) not like 'permission denied%' then raise 'authenticated lit le journal'; end if;
  if pg_temp.err($q$ select public.recent_identity_change('00000000-0000-0000-0000-0000000000c1', interval '1 day') $q$) not like 'permission denied%' then raise 'authenticated appelle recent_identity_change'; end if;
  if pg_temp.err($q$ select private.log_identity_event() $q$) not like 'permission denied%' then raise 'authenticated voit la fonction du déclencheur'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  if pg_temp.err($q$ select * from private.identity_events $q$) not like 'permission denied%' then raise 'anon lit le journal'; end if;
  if pg_temp.err($q$ select public.recent_identity_change('00000000-0000-0000-0000-0000000000c1', interval '1 day') $q$) not like 'permission denied%' then raise 'anon appelle recent_identity_change'; end if;
end $$;
reset role;
-- Droits déclarés (et pas seulement l'absence d'usage du schéma)
do $$ begin
  if has_function_privilege('authenticated', 'public.recent_identity_change(uuid, interval)', 'execute')
     or has_function_privilege('anon', 'public.recent_identity_change(uuid, interval)', 'execute') then raise 'execute accordé à un rôle client'; end if;
  if not has_function_privilege('service_role', 'public.recent_identity_change(uuid, interval)', 'execute') then raise 'service_role ne peut pas appeler'; end if;
  if has_table_privilege('service_role', 'private.identity_events', 'select') then raise 'service_role lit la table directement'; end if;
end $$;
-- La clé serveur obtient la date
set role service_role;
do $$ begin
  if public.recent_identity_change('00000000-0000-0000-0000-0000000000c1', interval '24 hours') is null then raise 'service_role : ajout Apple récent non vu'; end if;
end $$;
reset role;

-- ── Suppression du compte : réussit (cascade des identités sans journal), événements effacés ──
set role supabase_auth_admin;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000c1';
reset role;
do $$ begin
  if exists (select 1 from private.identity_events where user_id = '00000000-0000-0000-0000-0000000000c1') then raise 'événements gardés après la suppression du compte'; end if;
end $$;
