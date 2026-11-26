-- Vérifications de supabase/migrations/20261128010000_compte_vide_site_coach.sql (lancées par tests/sql/run.sh).
-- Chaque bloc échoue (raise) si la règle n'est pas tenue. Tout est annulé à la fin (rollback).
begin;
\o /dev/null

create function pg_temp.err(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.err(text) to authenticated, anon, service_role;

-- Fabrique : compte créé il y a « age », une identité « prov », une session ouverte « late » après la création
create function pg_temp.mk(n int, prov text, age interval default '1 minute', late interval default '2 seconds') returns uuid
  language plpgsql as
$$
declare u uuid := ('00000000-0000-0000-00ff-' || lpad(n::text, 12, '0'))::uuid;
begin
  insert into auth.users (id, created_at) values (u, now() - age);
  if prov is not null then
    insert into auth.identities (provider_id, user_id, provider) values (prov || '-' || n, u, prov);
  end if;
  insert into auth.sessions (id, user_id, created_at)
    values (('00000000-0000-0000-00ee-' || lpad(n::text, 12, '0'))::uuid, u, now() - age + late);
  return u;
end
$$;
create function pg_temp.sid(n int) returns uuid language sql as
$$ select ('00000000-0000-0000-00ee-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.claim(n int) returns text language sql as
$$ select public.coach_web_orphan_claim(('00000000-0000-0000-00ff-' || lpad(n::text, 12, '0'))::uuid, pg_temp.sid(n)) $$;

-- ── Droits : seule la clé serveur appelle la fonction ; personne ne lit le journal ──
do $$ begin
  if has_function_privilege('anon', 'public.coach_web_orphan_claim(uuid, uuid)', 'execute') then raise 'anon peut appeler'; end if;
  if has_function_privilege('authenticated', 'public.coach_web_orphan_claim(uuid, uuid)', 'execute') then raise 'authenticated peut appeler'; end if;
  if not has_function_privilege('service_role', 'public.coach_web_orphan_claim(uuid, uuid)', 'execute') then raise 'service_role ne peut pas appeler'; end if;
end $$;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(r, 'private.coach_web_orphans', 'select') or has_table_privilege(r, 'private.coach_web_orphans', 'insert') then raise '% lit ou écrit le journal', r; end if;
  end loop;
  if (select prosecdef from pg_proc where oid = 'public.coach_web_orphan_claim(uuid, uuid)'::regprocedure) is not true then raise 'pas security definer'; end if;
  if not exists (select 1 from pg_proc where oid = 'public.coach_web_orphan_claim(uuid, uuid)'::regprocedure and proconfig @> array['search_path=""']) then raise 'search_path non vidé'; end if;
end $$;

set local role authenticated;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-00ff-000000000001', true);
do $$ begin
  if pg_temp.err($q$ select public.coach_web_orphan_claim('00000000-0000-0000-00ff-000000000001', '00000000-0000-0000-00ee-000000000001') $q$) not like 'permission denied%' then raise 'appel du compte lui-même accepté'; end if;
end $$;
reset role;

-- ── Le cas du 26/11 : compte Google tout neuf, sans rien, né de cette connexion ──
select null from pg_temp.mk(1, 'google');
select null from pg_temp.mk(2, 'apple');
do $$ begin
  if pg_temp.claim(1) <> 'orphan' then raise 'Google neuf et vide : %', pg_temp.claim(1); end if;
  if pg_temp.claim(2) <> 'orphan' then raise 'Apple neuf et vide'; end if;
  if (select count(*) from private.coach_web_orphans) <> 2 then raise 'journal : % ligne(s)', (select count(*) from private.coach_web_orphans); end if;
  if (select array_agg(provider order by id) from private.coach_web_orphans) <> array['google', 'apple'] then raise 'journal : fournisseurs'; end if;
end $$;

-- ── Tout le reste est gardé ──
select null from pg_temp.mk(10, 'google', age => '11 minutes');                       -- trop ancien
select null from pg_temp.mk(11, 'email');                                             -- compte e-mail
select null from pg_temp.mk(12, 'google');                                            -- deux identités
insert into auth.identities (provider_id, user_id, provider) values ('apple-12', '00000000-0000-0000-00ff-000000000012', 'apple');
select null from pg_temp.mk(13, null);                                                -- aucune identité
select null from pg_temp.mk(14, 'google');                                            -- deux sessions (app, puis site)
insert into auth.sessions (user_id) values ('00000000-0000-0000-00ff-000000000014');
select null from pg_temp.mk(15, 'google', age => '5 minutes', late => '4 minutes');   -- session ouverte longtemps après la création
select null from pg_temp.mk(16, 'google');                                            -- profil (données de l'app)
insert into public.profiles (user_id) values ('00000000-0000-0000-00ff-000000000016');
select null from pg_temp.mk(17, 'google');                                            -- ligne dans le schéma private
insert into private.social_rate (user_id, action) values ('00000000-0000-0000-00ff-000000000017', 'test');
select null from pg_temp.mk(18, 'google');                                            -- colonne sans clé étrangère
select null from pg_temp.mk(19, 'google');
-- Sans le chat (tests/sql/rollback_social_check.sh le démonte) : deux profils à la place, les comptes restent gardés
do $$ begin
  if to_regclass('public.chat_reports') is not null then
    insert into public.chat_reports (reporter_id, target_user, student_id, coach_id, reason, messages)
      values ('00000000-0000-0000-00ff-000000000019', '00000000-0000-0000-00ff-000000000018', '00000000-0000-0000-00ff-000000000019', '00000000-0000-0000-00ff-000000000018', 'spam', '[]');
  else
    insert into public.profiles (user_id) values ('00000000-0000-0000-00ff-000000000018'), ('00000000-0000-0000-00ff-000000000019');
  end if;
end $$;
select null from pg_temp.mk(20, 'google');                                            -- fichier dans Storage (dossier du compte)
insert into storage.buckets (id, name) values ('test-bucket', 'test-bucket');
insert into storage.objects (bucket_id, name) values ('test-bucket', '00000000-0000-0000-00ff-000000000020/photo.jpg');
select null from pg_temp.mk(21, 'google');                                            -- fichier dont il est propriétaire
insert into storage.objects (bucket_id, name, owner_id) values ('test-bucket', 'ailleurs/x.jpg', '00000000-0000-0000-00ff-000000000021');
-- Table ajoutée après cette migration : comptée sans rien changer à la fonction
create table public.zz_future (id int generated always as identity primary key, who uuid references auth.users(id) on delete cascade);
select null from pg_temp.mk(22, 'google');
insert into public.zz_future (who) values ('00000000-0000-0000-00ff-000000000022');

do $$ declare n int; r text; begin
  foreach n in array array[10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] loop
    r := pg_temp.claim(n);
    if r <> 'kept' then raise 'compte % : % au lieu de kept', n, r; end if;
  end loop;
  -- Pas d'IDOR : la session d'un autre compte, ou une session inconnue, ne vaut rien
  perform pg_temp.mk(30, 'google');
  if public.coach_web_orphan_claim('00000000-0000-0000-00ff-000000000030', pg_temp.sid(1)) <> 'kept' then raise 'session d''un autre compte'; end if;
  if public.coach_web_orphan_claim('00000000-0000-0000-00ff-000000000030', gen_random_uuid()) <> 'kept' then raise 'session inconnue'; end if;
  if public.coach_web_orphan_claim('00000000-0000-0000-00ff-000000000030', null) <> 'kept' then raise 'session absente'; end if;
  if public.coach_web_orphan_claim(null, pg_temp.sid(30)) <> 'kept' then raise 'compte absent'; end if;
  if public.coach_web_orphan_claim(gen_random_uuid(), pg_temp.sid(30)) <> 'kept' then raise 'compte inconnu'; end if;
  if (select count(*) from private.coach_web_orphans) <> 2 then raise 'un refus a écrit au journal'; end if;
  -- Et le compte 30 lui-même, avec sa session : orphelin
  if pg_temp.claim(30) <> 'orphan' then raise 'compte 30 avec sa session'; end if;
end $$;

-- ── Limite : 30 par heure pour tout le projet ; les lignes de plus de 30 jours partent ──
insert into private.coach_web_orphans (provider, at) select 'google', now() - interval '10 minutes' from generate_series(1, 27);
insert into private.coach_web_orphans (provider, at) values ('google', now() - interval '31 days'), ('google', now() - interval '2 hours');
select null from pg_temp.mk(40, 'google');
do $$ begin
  if pg_temp.claim(40) <> 'limit' then raise 'limite des 30 par heure : %', pg_temp.claim(40); end if;
  delete from private.coach_web_orphans where at > now() - interval '1 hour' and id = (select max(id) from private.coach_web_orphans where at > now() - interval '1 hour');
  if pg_temp.claim(40) <> 'orphan' then raise 'sous la limite : refusé'; end if;
  if exists (select 1 from private.coach_web_orphans where at < now() - interval '30 days') then raise 'purge des 30 jours'; end if;
  if not exists (select 1 from private.coach_web_orphans where at < now() - interval '90 minutes') then raise 'ligne de 2 h effacée à tort'; end if;
end $$;

rollback;
