-- Vérifications de supabase/migrations/20261106100000_seance_publique_intensif_prise.sql (lancées par
-- tests/sql/run.sh). Chaque bloc échoue (raise) si la règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.iu('a') → …0000000007ea) : A ana.i1 suit B ben.i1 (accepté, social activé des
-- deux côtés) ; K kim.i1 est coach de B.

create function pg_temp.ierr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.iu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000007e' || c)::uuid $$;
create function pg_temp.ilogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.iu(c)::text, false) $$;
grant execute on function pg_temp.ierr(text), pg_temp.iu(text), pg_temp.ilogin(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.iu(c) from unnest(array['a', 'b', 'c']) c;
insert into public.user_profiles (user_id, username) values
  (pg_temp.iu('a'), 'ana.i1'), (pg_temp.iu('b'), 'ben.i1'), (pg_temp.iu('c'), 'kim.i1');
update public.user_profiles set coach_at = now() where user_id = pg_temp.iu('c');

set role authenticated;
do $$
declare code text;
begin
  perform pg_temp.ilogin('a'); perform public.social_enable(true);
  perform pg_temp.ilogin('b'); perform public.social_enable(true);
  perform pg_temp.ilogin('a'); perform public.request_follow(pg_temp.iu('b'));
  perform pg_temp.ilogin('b'); perform public.respond_follow(pg_temp.iu('a'), true);
  perform pg_temp.ilogin('c'); code := public.coach_create_invite();
  perform pg_temp.ilogin('b'); perform public.coach_join(code);

  insert into public.sessions (id, data) values
    ('i-1', jsonb_build_object('date', 1780000000000, 'category', 'pull', 'label', 'Pull', 'exercises', jsonb_build_array(
      jsonb_build_object('name', 'Tirage vertical', 'grip', jsonb_build_object('hand', 'neutre', 'width', 'serree', 'tool', 'triangle'),
        'sets', jsonb_build_array(
          -- 0 : drop set, deux sous-séries valides (texte et nombre), une clé inconnue retirée
          jsonb_build_object('weight', '60', 'reps', '12', 'tech', 'drop', 'sub', jsonb_build_array(
            jsonb_build_object('weight', '46', 'reps', '5', 'secret', 'fuite-sub'),
            jsonb_build_object('weight', 36.5, 'reps', 4))),
          -- 1 : étiquettes ; top set avec un sub forgé : sub retiré
          jsonb_build_object('weight', '70', 'reps', '3', 'tech', 'top', 'sub', jsonb_build_array(jsonb_build_object('weight', '1', 'reps', '1'))),
          jsonb_build_object('weight', '60', 'reps', '6', 'tech', 'backoff'),
          -- 3 : technique inconnue, technique en objet : rien
          jsonb_build_object('weight', '60', 'reps', '6', 'tech', 'myo'),
          jsonb_build_object('weight', '60', 'reps', '6', 'tech', jsonb_build_object('fuite', 'objet')),
          -- 5 : échauffement : jamais de technique
          jsonb_build_object('weight', '20', 'reps', '8', 'warmup', true, 'tech', 'drop', 'sub', jsonb_build_array(jsonb_build_object('weight', '10', 'reps', '8'))),
          -- 6 : rest-pause sans sous-série valide (bornes, formes) : retiré
          jsonb_build_object('weight', '60', 'reps', '6', 'tech', 'rp', 'sub', jsonb_build_array(
            jsonb_build_object('weight', '60', 'reps', '0'), jsonb_build_object('weight', '60', 'reps', '4001'),
            jsonb_build_object('weight', '60', 'reps', 2.5), jsonb_build_object('weight', '60', 'reps', '3x'),
            jsonb_build_object('weight', '1e9', 'reps', '3'), jsonb_build_object('weight', -5, 'reps', '3'),
            jsonb_build_object('weight', '1000.5', 'reps', '3'), jsonb_build_object('weight', jsonb_build_array(1), 'reps', '3'),
            'pas un objet')),
          -- 7 : cluster au poids du corps ('' et sans charge) ; 8 sous-séries : les 6 premières seulement
          jsonb_build_object('weight', '', 'reps', '3', 'tech', 'cluster', 'sub', (
            select jsonb_agg(case when i = 1 then jsonb_build_object('reps', '3') else jsonb_build_object('weight', '', 'reps', i::text) end)
            from generate_series(1, 8) i)),
          -- 8 : sub qui n'est pas une liste
          jsonb_build_object('weight', '60', 'reps', '6', 'tech', 'drop', 'sub', 'pas une liste'),
          -- 9 : limites justes : 1000 kg, 4000 reps, 3 décimales
          jsonb_build_object('weight', '60', 'reps', '6', 'tech', 'drop', 'sub', jsonb_build_array(
            jsonb_build_object('weight', '1000', 'reps', '4000'), jsonb_build_object('weight', '36.287', 'reps', 1), jsonb_build_object('weight', 0, 'reps', '1'))))),
      -- Prises forgées : valeurs inconnues retirées, objet vide ou non objet : pas de grip
      jsonb_build_object('name', 'Curl', 'grip', jsonb_build_object('hand', 'supination', 'width', 'geante', 'tool', jsonb_build_object('x', 1), 'secret', 'fuite-grip'),
        'sets', jsonb_build_array(jsonb_build_object('weight', '12', 'reps', '10'))),
      jsonb_build_object('name', 'Rowing', 'grip', jsonb_build_object('hand', 'PRONATION', 'handle', 'corde'), 'sets', '[]'::jsonb),
      jsonb_build_object('name', 'Dips', 'grip', 'neutre', 'sets', '[]'::jsonb))));
  -- Ancienne séance, telle qu'une version précédente l'envoyait : doit sortir exactement comme avant
  insert into public.sessions (id, data) values ('i-2', '{"date": 1780000001000, "category": "push", "label": "Push",
    "exercises": [{"name": "Développé", "ss": "g1", "sets": [{"weight": "80", "reps": "8", "rir": 2}, {"weight": "40", "reps": "8", "warmup": true}]}]}');
end $$;

-- ── Ce que voit un ami ───────────────────────────────────
do $$
declare s jsonb; sets jsonb; ex jsonb;
begin
  perform pg_temp.ilogin('a');
  select f.s into s from public.feed(only_user => pg_temp.iu('b')) f where f.id = 'i-1';
  if s is null then raise 'séance absente du fil'; end if;
  ex := s -> 'exercises';
  sets := ex -> 0 -> 'sets';
  if ex -> 0 -> 'grip' is distinct from '{"hand": "neutre", "width": "serree", "tool": "triangle"}'::jsonb then raise 'prise : %', ex -> 0 -> 'grip'; end if;
  if sets -> 0 is distinct from '{"weight": "60", "reps": "12", "tech": "drop", "sub": [{"weight": "46", "reps": "5"}, {"weight": 36.5, "reps": 4}]}'::jsonb then raise 'drop set : %', sets -> 0; end if;
  if sets -> 1 is distinct from '{"weight": "70", "reps": "3", "tech": "top"}'::jsonb then raise 'top set : %', sets -> 1; end if;
  if sets -> 2 ->> 'tech' is distinct from 'backoff' then raise 'back-off : %', sets -> 2; end if;
  if sets -> 3 ? 'tech' or sets -> 4 ? 'tech' then raise 'technique inconnue transmise : %', sets; end if;
  if sets -> 5 is distinct from '{"weight": "20", "reps": "8", "warmup": true}'::jsonb then raise 'échauffement avec technique : %', sets -> 5; end if;
  if sets -> 6 ? 'tech' or sets -> 6 ? 'sub' then raise 'rest-pause invalide transmis : %', sets -> 6; end if;
  if sets -> 7 -> 'sub' is distinct from '[{"reps": "3"}, {"weight": "", "reps": "2"}, {"weight": "", "reps": "3"}, {"weight": "", "reps": "4"}, {"weight": "", "reps": "5"}, {"weight": "", "reps": "6"}]'::jsonb
    then raise 'cluster : 6 premières sous-séries, poids du corps : %', sets -> 7 -> 'sub'; end if;
  if sets -> 8 ? 'tech' or sets -> 8 ? 'sub' then raise 'sub non liste : %', sets -> 8; end if;
  if sets -> 9 -> 'sub' is distinct from '[{"weight": "1000", "reps": "4000"}, {"weight": "36.287", "reps": 1}, {"weight": 0, "reps": "1"}]'::jsonb then raise 'limites : %', sets -> 9; end if;
  if ex -> 1 -> 'grip' is distinct from '{"hand": "supination"}'::jsonb then raise 'prise nettoyée : %', ex -> 1 -> 'grip'; end if;
  if ex -> 2 ? 'grip' or ex -> 3 ? 'grip' then raise 'prise invalide transmise : %', ex; end if;
  if s::text ~ 'secret|fuite|geante|handle|myo|PRONATION|1e9|4001' then raise 'valeur forgée transmise : %', s; end if;
  -- Ancienne séance : exactement la forme d'avant la migration
  select f.s into s from public.feed(only_user => pg_temp.iu('b')) f where f.id = 'i-2';
  if s -> 'exercises' is distinct from '[{"name": "Développé", "ss": "g1", "sets": [{"weight": "80", "reps": "8", "rir": 2}, {"weight": "40", "reps": "8", "warmup": true}]}]'::jsonb
    then raise 'ancienne séance changée : %', s; end if;
  -- Fonctions internes : personne ne les appelle
  if pg_temp.ierr($q$ select private.set_tech('{}') $q$) not like 'permission denied%' then raise 'private.set_tech appelable'; end if;
  if pg_temp.ierr($q$ select private.set_sub('[]') $q$) not like 'permission denied%' then raise 'private.set_sub appelable'; end if;
  if pg_temp.ierr($q$ select private.sub_weight('1') $q$) not like 'permission denied%' then raise 'private.sub_weight appelable'; end if;
  if pg_temp.ierr($q$ select private.sub_reps('1') $q$) not like 'permission denied%' then raise 'private.sub_reps appelable'; end if;
  if pg_temp.ierr($q$ select private.exercise_grip('{}') $q$) not like 'permission denied%' then raise 'private.exercise_grip appelable'; end if;
end $$;

-- ── Ce que voit le coach (même liste blanche, recopiée par session_for_coach) ──
do $$
declare s jsonb;
begin
  perform pg_temp.ilogin('c');
  select x.s into s from public.coach_student_sessions(pg_temp.iu('b')) x where x.id = 'i-1';
  if s -> 'exercises' -> 0 -> 'sets' -> 0 -> 'sub' -> 0 is distinct from '{"weight": "46", "reps": "5"}'::jsonb
     or s -> 'exercises' -> 0 -> 'grip' ->> 'tool' is distinct from 'triangle' then raise 'coach : %', s -> 'exercises' -> 0; end if;
  if s::text ~ 'secret|fuite|geante|handle|myo' then raise 'coach : valeur forgée transmise'; end if;
end $$;

-- ── Taille : une séance chargée au maximum reste bornée (6 sous-séries par série, 100 séries) ──
do $$
declare s jsonb;
begin
  perform pg_temp.ilogin('b');
  insert into public.sessions (id, data) values ('i-3', jsonb_build_object('date', 1780000002000, 'category', 'pull', 'exercises', jsonb_build_array(
    jsonb_build_object('name', 'X', 'sets', (select jsonb_agg(jsonb_build_object('weight', '1', 'reps', '1', 'tech', 'drop',
      'sub', (select jsonb_agg(jsonb_build_object('weight', '1', 'reps', '1')) from generate_series(1, 40)))) from generate_series(1, 120))))));
  perform pg_temp.ilogin('a');
  select f.s into s from public.feed(only_user => pg_temp.iu('b')) f where f.id = 'i-3';
  if jsonb_array_length(s -> 'exercises' -> 0 -> 'sets') <> 100 then raise '100 séries au plus'; end if;
  if exists (select 1 from jsonb_array_elements(s -> 'exercises' -> 0 -> 'sets') st where jsonb_array_length(st -> 'sub') <> 6) then raise '6 sous-séries au plus'; end if;
end $$;

-- ── anon : rien ──────────────────────────────────────────
reset role;
set role anon;
do $$ begin
  if pg_temp.ierr($q$ select private.set_tech('{}') $q$) not like 'permission denied%' then raise 'anon appelle set_tech'; end if;
end $$;
reset role;

-- ── Ménage : comptes du test retirés (le coach de ce test compterait sinon dans le rapport du parrainage
--    d'un test lancé ensuite sur la même base, après le retour arrière du parrainage du payant) ──
delete from auth.users where id in (pg_temp.iu('a'), pg_temp.iu('b'), pg_temp.iu('c'));
do $$ begin
  if exists (select 1 from public.sessions where id like 'i-%') then raise 'séances du test restées'; end if;
end $$;
