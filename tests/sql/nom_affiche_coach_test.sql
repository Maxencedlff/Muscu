-- Vérifications de 20261120020000_nom_affiche_coach.sql (nom de l'affiche montré dans Mon coach), lancées par
-- tests/sql/run.sh. Comptes simulés …00000000cdXX : A coach, E son élève, K élève de A qui l'a bloqué, O autre compte,
-- N pas coach. Rien n'est appliqué en production : Postgres local jetable.

create function pg_temp.nerr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.nu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000cd' || c)::uuid $$;
create function pg_temp.nlogin(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, false) $$;
grant execute on function pg_temp.nerr(text), pg_temp.nu(text), pg_temp.nlogin(uuid) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.nu(c) from unnest(array['a1', 'e1', 'c1', '01', '11']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.nu('a1'), 'nom.a1', '🦁'), (pg_temp.nu('e1'), 'nom.e1', '🦊'), (pg_temp.nu('c1'), 'nom.k1', '🦉'),
  (pg_temp.nu('01'), 'nom.o1', '⭐'), (pg_temp.nu('11'), 'nom.n1', '🐺');
update public.user_profiles set coach_at = now() where user_id = pg_temp.nu('a1');
insert into public.coach_links (coach_id, student_id) values (pg_temp.nu('a1'), pg_temp.nu('e1')), (pg_temp.nu('a1'), pg_temp.nu('c1'));
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.nu('c1'), pg_temp.nu('a1'));

-- ── Droits : aucune lecture ni écriture directe, rien pour anon ──
set role authenticated;
do $$
begin
  perform pg_temp.nlogin(pg_temp.nu('a1'));
  if pg_temp.nerr($q$ select * from public.coach_poster_names $q$) not like 'permission denied%' then raise 'lecture directe'; end if;
  if pg_temp.nerr($q$ insert into public.coach_poster_names (user_id, name) values (auth.uid(), 'x') $q$) not like 'permission denied%' then raise 'écriture directe'; end if;
end $$;
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.coach_poster_name(uuid)', 'execute') then raise 'anon lit un nom'; end if;
  if has_function_privilege('anon', 'public.coach_set_poster_name(text)', 'execute') then raise 'anon écrit un nom'; end if;
end $$;

-- ── Écriture : coach seulement, nom nettoyé et borné ──
set role authenticated;
do $$
begin
  perform pg_temp.nlogin(pg_temp.nu('11'));
  if pg_temp.nerr($q$ select public.coach_set_poster_name('Zoé') $q$) is distinct from 'not_coach' then raise 'non-coach accepté'; end if;
  perform pg_temp.nlogin(pg_temp.nu('a1'));
  if pg_temp.nerr($q$ select public.coach_set_poster_name('   ') $q$) is distinct from 'invalid_name' then raise 'nom vide accepté'; end if;
  if pg_temp.nerr(format('select public.coach_set_poster_name(%L)', repeat('a', 41))) is distinct from 'invalid_name' then raise '41 caractères acceptés'; end if;
  if public.coach_set_poster_name(E'  Camille \t\n Martin ') ->> 'name' <> 'Camille Martin' then raise 'nom non nettoyé'; end if;
  if public.coach_set_poster_name(E'Cam\u200Bille \u202EMartin\uFEFF') ->> 'name' <> 'Camille Martin' then raise 'mise en forme invisible gardée'; end if;
  if public.coach_set_poster_name('Camille Martin') ->> 'name' <> 'Camille Martin' then raise 'même nom refusé'; end if;
  -- Lecture : le coach lui-même
  if public.coach_poster_name(pg_temp.nu('a1')) ->> 'name' <> 'Camille Martin' then raise 'coach : son nom'; end if;
  -- Son élève : oui ; élève qui l'a bloqué, autre compte : rien
  perform pg_temp.nlogin(pg_temp.nu('e1'));
  if public.coach_poster_name(pg_temp.nu('a1')) ->> 'name' is distinct from 'Camille Martin' then raise 'élève : nom absent'; end if;
  perform pg_temp.nlogin(pg_temp.nu('c1'));
  if public.coach_poster_name(pg_temp.nu('a1')) ->> 'name' is not null then raise 'blocage : nom montré'; end if;
  perform pg_temp.nlogin(pg_temp.nu('01'));
  if public.coach_poster_name(pg_temp.nu('a1')) ->> 'name' is not null then raise 'autre compte : nom montré'; end if;
  if public.coach_poster_name(null) ->> 'name' is not null then raise 'coach nul'; end if;
end $$;
reset role;

-- Plus coach : plus rien de montré
update public.user_profiles set coach_at = null where user_id = pg_temp.nu('a1');
set role authenticated;
do $$
begin
  perform pg_temp.nlogin(pg_temp.nu('e1'));
  if public.coach_poster_name(pg_temp.nu('a1')) ->> 'name' is not null then raise 'ancien coach : nom montré'; end if;
end $$;
reset role;

-- ── Suppression des comptes : noms effacés ; rien ne reste pour les autres tests (rapport du parrainage) ──
delete from auth.users where id in (select pg_temp.nu(c) from unnest(array['a1', 'e1', 'c1', '01', '11']) c);
do $$ begin if exists (select 1 from public.coach_poster_names where user_id = pg_temp.nu('a1')) then raise 'nom resté'; end if; end $$;
