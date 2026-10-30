-- Vérifications de supabase/migrations/20261031100000_records_series.sql (lancées par tests/sql/run.sh).
-- Chaque bloc échoue (raise) si la règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.ru('a') → …00000000070a) : A ana.r1 suit B ben.r1 (accepté, social activé
-- des deux côtés) ; K kim.r1 est coach de B ; X xav.r1 a le social mais ne suit personne.

create function pg_temp.rerr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.ru(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000070' || c)::uuid $$;
create function pg_temp.rlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.ru(c)::text, false) $$;
grant execute on function pg_temp.rerr(text), pg_temp.ru(text), pg_temp.rlogin(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.ru(c) from unnest(array['a', 'b', 'c', 'd']) c;
insert into public.user_profiles (user_id, username) values
  (pg_temp.ru('a'), 'ana.r1'), (pg_temp.ru('b'), 'ben.r1'), (pg_temp.ru('c'), 'kim.r1'), (pg_temp.ru('d'), 'xav.r1');
update public.user_profiles set coach_at = now() where user_id = pg_temp.ru('c');

set role authenticated;
do $$
declare code text;
begin
  perform pg_temp.rlogin('a'); perform public.social_enable(true);
  perform pg_temp.rlogin('b'); perform public.social_enable(true);
  perform pg_temp.rlogin('d'); perform public.social_enable(true);
  perform pg_temp.rlogin('a'); perform public.request_follow(pg_temp.ru('b'));
  perform pg_temp.rlogin('b'); perform public.respond_follow(pg_temp.ru('a'), true);
  perform pg_temp.rlogin('c'); code := public.coach_create_invite();
  perform pg_temp.rlogin('b'); perform public.coach_join(code);

  insert into public.sessions (id, data) values
    ('r-1', jsonb_build_object(
      'date', 1780000000000, 'category', 'legs', 'label', 'Legs',
      'records', jsonb_build_array(
        jsonb_build_object('ex', 'Squat', 'kind', 'charge', 'before', 95, 'after', 100, 'secret', 'fuite-cle'),
        jsonb_build_object('ex', 'Course', 'kind', 'allure', 'before', 300, 'after', 290, 'd', 5),
        jsonb_build_object('ex', 'Gainage', 'kind', 'temps', 'before', 60, 'after', 75, 'w', 10),
        -- Écartés : 1RM estimé, type inconnu, nombre en texte, hors bornes, nom objet, allure sans distance fixe
        jsonb_build_object('ex', 'Squat', 'kind', '1rm', 'before', 110, 'after', 115),
        jsonb_build_object('ex', 'Squat', 'kind', 'niveau', 'before', 8, 'after', 9),
        jsonb_build_object('ex', 'Squat', 'kind', 'charge', 'before', '95', 'after', 100),
        jsonb_build_object('ex', 'Squat', 'kind', 'charge', 'before', 95, 'after', 1e9),
        jsonb_build_object('ex', jsonb_build_object('fuite', 'secret-objet'), 'kind', 'charge', 'before', 1, 'after', 2),
        jsonb_build_object('ex', 'Course', 'kind', 'allure', 'before', 300, 'after', 290, 'd', 3),
        'pas un objet'),
      'exercises', jsonb_build_array(jsonb_build_object('name', 'Squat', 'sets', jsonb_build_array(
        jsonb_build_object('weight', '40', 'reps', '8', 'warmup', true),
        jsonb_build_object('weight', '100', 'reps', '5', 'rir', 2),
        jsonb_build_object('weight', '100', 'reps', '5', 'warmup', 'true', 'rir', 7),
        jsonb_build_object('weight', '100', 'reps', '5', 'warmup', false, 'rir', '2'),
        jsonb_build_object('weight', '100', 'reps', '5', 'rir', 1.5)))))),
    -- 21 records : 20 au plus
    ('r-2', jsonb_build_object('date', 1780000001000, 'category', 'legs', 'exercises', '[]'::jsonb,
      'records', (select jsonb_agg(jsonb_build_object('ex', 'E' || i, 'kind', 'reps', 'before', i, 'after', i + 1)) from generate_series(1, 21) i))),
    ('r-3', '{"date": 1780000002000, "category": "legs", "exercises": [], "records": "pas une liste"}'),
    ('r-4', '{"date": 1780000003000, "category": "legs", "exercises": [], "records": []}');
end $$;

-- ── Ce que voit un ami ───────────────────────────────────
do $$
declare s jsonb; sets jsonb;
begin
  perform pg_temp.rlogin('a');
  select f.s into s from public.feed(only_user => pg_temp.ru('b')) f where f.id = 'r-1';
  if s is null then raise 'séance absente du fil'; end if;
  if jsonb_array_length(s -> 'records') is distinct from 3 then raise 'records : %', s -> 'records'; end if;
  -- Sans la valeur d'avant : elle peut venir d'une séance masquée aux abonnés (seul le coach la voit)
  if s -> 'records' -> 0 is distinct from '{"ex": "Squat", "kind": "charge", "after": 100}'::jsonb then raise 'record charge : %', s -> 'records' -> 0; end if;
  if exists (select 1 from jsonb_array_elements(s -> 'records') r where r ? 'before') then raise 'before montré à un ami : %', s -> 'records'; end if;
  -- Mes séances telles que mes abonnés les voient (Mon profil) : pareil
  perform pg_temp.rlogin('b');
  if exists (select 1 from public.my_shown_sessions() m, jsonb_array_elements(m.s -> 'records') r where r ? 'before') then raise 'before dans Mon profil'; end if;
  perform pg_temp.rlogin('a');
  if s -> 'records' -> 1 ->> 'd' is distinct from '5' or s -> 'records' -> 2 ->> 'w' is distinct from '10' then raise 'd, w : %', s -> 'records'; end if;
  if s::text ~ 'secret|fuite|1rm|niveau' then raise 'fuite dans les records : %', s; end if;
  sets := s -> 'exercises' -> 0 -> 'sets';
  if sets -> 0 is distinct from '{"weight": "40", "reps": "8", "warmup": true}'::jsonb then raise 'échauffement : %', sets -> 0; end if;
  if sets -> 1 is distinct from '{"weight": "100", "reps": "5", "rir": 2}'::jsonb then raise 'rir : %', sets -> 1; end if;
  -- warmup en texte, rir hors bornes, en texte ou décimal : absents
  if sets -> 2 ? 'warmup' or sets -> 2 ? 'rir' or sets -> 3 ? 'warmup' or sets -> 3 ? 'rir' or sets -> 4 ? 'rir' then raise 'séries invalides : %', sets; end if;
  if jsonb_array_length((select f.s -> 'records' from public.feed(only_user => pg_temp.ru('b')) f where f.id = 'r-2')) is distinct from 20 then raise '20 records au plus'; end if;
  if (select f.s ? 'records' from public.feed(only_user => pg_temp.ru('b')) f where f.id = 'r-3') then raise 'records non tableau'; end if;
  if (select f.s -> 'records' from public.feed(only_user => pg_temp.ru('b')) f where f.id = 'r-4') is distinct from '[]'::jsonb then raise 'records vide'; end if;

  -- Un compte qui ne suit pas B ne voit rien
  perform pg_temp.rlogin('d');
  if exists (select 1 from public.feed(only_user => pg_temp.ru('b'))) then raise 'séances visibles sans abonnement'; end if;
  if pg_temp.rerr($q$ select private.session_records('[]', true) $q$) not like 'permission denied%' then raise 'private.session_records appelable'; end if;
  if pg_temp.rerr($q$ select private.bounded_num('1', 0, 2) $q$) not like 'permission denied%' then raise 'private.bounded_num appelable'; end if;
end $$;

-- ── Ce que voit le coach ─────────────────────────────────
do $$
declare s jsonb;
begin
  perform pg_temp.rlogin('c');
  select x.s into s from public.coach_student_sessions(pg_temp.ru('b')) x where x.id = 'r-1';
  -- Le coach garde la valeur d'avant (Relecture › Records : « avant 95 kg »)
  if s -> 'records' -> 0 is distinct from '{"ex": "Squat", "kind": "charge", "before": 95, "after": 100}'::jsonb then raise 'coach : record charge %', s -> 'records' -> 0; end if;
  if jsonb_array_length(s -> 'records') is distinct from 3 or s -> 'exercises' -> 0 -> 'sets' -> 1 ->> 'rir' is distinct from '2'
     or s -> 'exercises' -> 0 -> 'sets' -> 0 ->> 'warmup' is distinct from 'true' then raise 'coach : %', s; end if;
  -- Un autre compte n'est pas son coach
  perform pg_temp.rlogin('a');
  if pg_temp.rerr($q$ select * from public.coach_student_sessions(pg_temp.ru('b')) $q$) is distinct from 'not_found' then raise 'coach_student_sessions d''un autre'; end if;
end $$;

-- ── anon : rien ──────────────────────────────────────────
reset role;
set role anon;
do $$ begin
  if pg_temp.rerr($q$ select * from public.feed() $q$) not like 'permission denied%' then raise 'anon lit le fil'; end if;
  if pg_temp.rerr($q$ select private.session_public('{}') $q$) not like 'permission denied%' then raise 'anon appelle session_public'; end if;
end $$;
reset role;

-- ── Index et clé primaire ────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'coach_notes_student_coach') then raise 'index coach_notes'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'coach_programmes_student_coach') then raise 'index coach_programmes'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'reports_target_user') then raise 'index reports'; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'private.social_rate'::regclass and contype = 'p') then raise 'clé primaire social_rate'; end if;
  -- Le journal des limites marche toujours (A a demandé à suivre B : une ligne, avec un id)
  if not exists (select 1 from private.social_rate where user_id = pg_temp.ru('a') and id is not null) then raise 'journal sans id'; end if;
end $$;
