-- Envois simultanés des pesées (public.student_share_weights, 20261031300000_partage_coach.sql), lancé
-- par tests/sql/run.sh : deux connexions réelles (dblink, sur ce Postgres jetable seulement).
--   1. le verrou par élève est pris en tête de la fonction et tenu jusqu'à la fin de la transaction ;
--   2. un second envoi du même élève attend le premier, puis remplace la liste (jamais de 23505).
-- Comptes simulés : …0000000000a1 coach, …0000000000a2 élève (pseudos cc1/cc2).

create schema test_dblink;
create extension dblink schema test_dblink;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
insert into public.user_profiles (user_id, username) values
  ('00000000-0000-0000-0000-0000000000a1', 'cc1.v'), ('00000000-0000-0000-0000-0000000000a2', 'cc2.v');
update public.user_profiles set coach_at = now() where user_id = '00000000-0000-0000-0000-0000000000a1';
insert into public.coach_links (student_id, coach_id) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1');
set role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
  perform public.student_set_share('weight', true);
end $$;
reset role;

do $$
declare
  cs text := format('host=%s port=%s dbname=postgres user=postgres', split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'));
  open_tx text := $q$ begin; set local role authenticated; set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-0000000000a2' $q$;
  n int;
begin
  perform test_dblink.dblink_connect('c1', cs);
  perform test_dblink.dblink_connect('c2', cs);
  -- 1. c1 envoie sans valider : le verrou de l'élève est tenu
  perform test_dblink.dblink_exec('c1', open_tx);
  select x.n into n from test_dblink.dblink('c1', $q$ select public.student_share_weights('[{"date": 1780000000000, "kg": 80}, {"date": 1780086400000, "kg": 81}]') $q$) as x(n int);
  if n <> 2 then raise 'premier envoi : %', n; end if;
  if pg_try_advisory_xact_lock(hashtextextended('coach_share_weights:00000000-0000-0000-0000-0000000000a2', 0)) then
    raise 'verrou de l''élève absent pendant l''envoi';
  end if;
  -- 2. c2 envoie en même temps : il attend c1
  perform test_dblink.dblink_exec('c2', open_tx);
  perform test_dblink.dblink_send_query('c2', $q$ select public.student_share_weights('[{"date": 1780000000000, "kg": 79}, {"date": 1780086400000, "kg": 80}, {"date": 1780172800000, "kg": 81}]') $q$);
  perform pg_sleep(0.2);
  if test_dblink.dblink_is_busy('c2') = 0 then raise 'le second envoi n''a pas attendu le premier'; end if;
  perform test_dblink.dblink_exec('c1', 'commit');
  select x.n into n from test_dblink.dblink_get_result('c2') as x(n int);
  if n is distinct from 3 then raise 'second envoi : %', n; end if;
  perform * from test_dblink.dblink_get_result('c2') as x(n int);   -- fin des résultats de la requête asynchrone
  perform test_dblink.dblink_exec('c2', 'commit');
  perform test_dblink.dblink_disconnect('c1');
  perform test_dblink.dblink_disconnect('c2');
  if (select count(*) from public.coach_shared_weights where student_id = '00000000-0000-0000-0000-0000000000a2') <> 3 then raise 'liste finale'; end if;
end $$;

delete from auth.users where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');
drop extension dblink;
drop schema test_dblink;
