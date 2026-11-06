-- Enregistrements simultanés du planning (public.coach_plan_save, 20261105000000_coach_planning.sql), lancé par
-- tests/sql/run.sh : deux connexions réelles (dblink, sur ce Postgres jetable seulement).
--   1. deux phases qui se chevauchent, écrites en même temps : la seconde attend la première, puis overlap ;
--   2. la contrainte d'exclusion tient même sans passer par la RPC (23P01) ;
--   3. lien rompu pendant l'enregistrement : not_found, jamais une erreur technique.
-- Comptes simulés : …0000000000b1 coach, …0000000000b2 élève (pseudos cb1.v/cb2.v). Test écrit à partir de celui
-- du relecteur (05/11/2026).

create schema test_dblink;
create extension dblink schema test_dblink;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2');
insert into public.user_profiles (user_id, username) values
  ('00000000-0000-0000-0000-0000000000b1', 'cb1.v'), ('00000000-0000-0000-0000-0000000000b2', 'cb2.v');
update public.user_profiles set coach_at = now() where user_id = '00000000-0000-0000-0000-0000000000b1';
insert into public.coach_links (student_id, coach_id) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1');

-- ── 1. Deux enregistrements qui se chevauchent, en même temps ──
do $$
declare
  cs text := format('host=%s port=%s dbname=postgres user=postgres', split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'));
  open_tx text := $q$ begin; set local role authenticated; set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-0000000000b1' $q$;
  r text;
begin
  perform test_dblink.dblink_connect('c1', cs);
  perform test_dblink.dblink_connect('c2', cs);
  perform test_dblink.dblink_exec('c1', open_tx);
  perform * from test_dblink.dblink('c1', $q$ select public.coach_plan_save('00000000-0000-0000-0000-0000000000b2', null, 'A', 'cut', '2027-01-04', 6)::text $q$) as x(t text);
  perform test_dblink.dblink_exec('c2', open_tx);
  perform test_dblink.dblink_send_query('c2', $q$
    select coalesce((select public.coach_plan_save('00000000-0000-0000-0000-0000000000b2', null, 'B', 'bulk', '2027-01-18', 4)::text), 'null') $q$);
  perform pg_sleep(0.3);
  if test_dblink.dblink_is_busy('c2') = 0 then raise 'le second enregistrement n''a pas attendu le premier'; end if;
  perform test_dblink.dblink_exec('c1', 'commit');
  begin
    select x.t into r from test_dblink.dblink_get_result('c2') as x(t text);
    raise 'second enregistrement accepté : %', r;
  exception when others then
    if sqlerrm not like '%overlap%' then raise 'second enregistrement : % (overlap attendu)', sqlerrm; end if;
  end;
  perform test_dblink.dblink_disconnect('c1');
  perform test_dblink.dblink_disconnect('c2');
  if (select count(*) from public.coach_phases where student_id = '00000000-0000-0000-0000-0000000000b2') <> 1 then raise 'deux phases qui se chevauchent'; end if;
end $$;

-- ── 2. La contrainte d'exclusion tient seule (sans la RPC) ──
do $$
declare st text;
begin
  begin
    insert into public.coach_phases (student_id, coach_id, goal, start_on, weeks)
      values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', 'bulk', '2027-02-14', 1);
    raise 'insertion directe qui chevauche acceptée';
  exception when exclusion_violation then null;
  end;
  -- Bord à bord : permis (la phase de 6 semaines du 4 janv. finit le 14 févr. inclus)
  insert into public.coach_phases (student_id, coach_id, goal, start_on, weeks)
    values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', 'bulk', '2027-02-15', 1);
end $$;

-- ── 3. Lien rompu pendant l'enregistrement : not_found ──
do $$
declare
  cs text := format('host=%s port=%s dbname=postgres user=postgres', split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'));
  r text;
begin
  perform test_dblink.dblink_connect('c3', cs);
  perform test_dblink.dblink_connect('c4', cs);
  -- c3 : le lien est supprimé, transaction encore ouverte
  perform test_dblink.dblink_exec('c3', $q$ begin; delete from public.coach_links where student_id = '00000000-0000-0000-0000-0000000000b2' $q$);
  -- c4 : le coach enregistre une phase (voit encore le lien) ; la clé étrangère attend c3
  perform test_dblink.dblink_exec('c4', $q$ begin; set local role authenticated; set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-0000000000b1' $q$);
  perform test_dblink.dblink_send_query('c4', $q$ select public.coach_plan_save('00000000-0000-0000-0000-0000000000b2', null, 'C', 'cut', '2027-06-07', 2)::text $q$);
  perform pg_sleep(0.3);
  perform test_dblink.dblink_exec('c3', 'commit');
  begin
    select x.t into r from test_dblink.dblink_get_result('c4') as x(t text);
    raise 'enregistrement sur un lien rompu accepté : %', r;
  exception when others then
    if sqlerrm not like '%not_found%' then raise 'lien rompu : % (not_found attendu)', sqlerrm; end if;
  end;
  perform test_dblink.dblink_disconnect('c3');
  perform test_dblink.dblink_disconnect('c4');
  if exists (select 1 from public.coach_phases where student_id = '00000000-0000-0000-0000-0000000000b2') then raise 'planning resté après le lien'; end if;
end $$;

delete from auth.users where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
delete from private.social_rate where user_id = '00000000-0000-0000-0000-0000000000b1';
drop extension dblink;
drop schema test_dblink;
