-- Vérifications de supabase/migrations/20261116010000_charge_prescrite.sql (lancées par tests/sql/run.sh) :
-- la prescription du coach sort pour SON coach seulement, alignée sur les exercices, revalidée.
--
-- Comptes simulés (pg_temp.pu('a') → …0000000007fa) : A ana.p1 suit B ben.p1 (accepté, social activé des
-- deux côtés) ; K kim.p1 est coach de B.

create function pg_temp.perr2(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.pu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000007f' || c)::uuid $$;
create function pg_temp.plogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.pu(c)::text, false) $$;
grant execute on function pg_temp.perr2(text), pg_temp.pu(text), pg_temp.plogin(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.pu(c) from unnest(array['a', 'b', 'c']) c;
insert into public.user_profiles (user_id, username) values
  (pg_temp.pu('a'), 'ana.p1'), (pg_temp.pu('b'), 'ben.p1'), (pg_temp.pu('c'), 'kim.p1');
update public.user_profiles set coach_at = now() where user_id = pg_temp.pu('c');

set role authenticated;
do $$
declare code text;
begin
  perform pg_temp.plogin('a'); perform public.social_enable(true);
  perform pg_temp.plogin('b'); perform public.social_enable(true);
  perform pg_temp.plogin('a'); perform public.request_follow(pg_temp.pu('b'));
  perform pg_temp.plogin('b'); perform public.respond_follow(pg_temp.pu('a'), true);
  perform pg_temp.plogin('c'); code := public.coach_create_invite();
  perform pg_temp.plogin('b'); perform public.coach_join(code);

  insert into public.sessions (id, data) values
    ('cp-1', jsonb_build_object('date', 1780000000000, 'category', 'sB', 'label', 'Bas', 'exercises', jsonb_build_array(
      -- 0 : sans prescription
      jsonb_build_object('name', 'Gainage', 'measure', 'time', 'sets', jsonb_build_array(jsonb_build_object('weight', '', 'reps', '60'))),
      -- 1 : 60 kg × 8 prescrits, échauffement à null, clé inconnue retirée
      jsonb_build_object('name', 'Squat barre', 'presc', jsonb_build_object('kg', jsonb_build_array(null, 60, 60, 60), 'lo', 8, 'hi', 8, 'secret', 'fuite-presc'),
        'sets', jsonb_build_array(jsonb_build_object('weight', '20', 'reps', '8', 'warmup', true), jsonb_build_object('weight', '62.5', 'reps', '8'),
          jsonb_build_object('weight', '60', 'reps', '8'), jsonb_build_object('weight', '60', 'reps', '7'))),
      -- 2 : valeurs forgées : hors bornes, texte, objet → null ; reps décimales ou hors bornes : retirées
      jsonb_build_object('name', 'Presse', 'presc', jsonb_build_object('kg', jsonb_build_array(501, '60', jsonb_build_object('x', 1), 0, 499.5), 'lo', 2.5, 'hi', 101),
        'sets', '[]'::jsonb),
      -- 3 : presc qui n'est pas un objet, kg qui n'est pas une liste : rien
      jsonb_build_object('name', 'Fentes', 'presc', 'fuite-texte', 'sets', '[]'::jsonb),
      jsonb_build_object('name', 'Mollets', 'presc', jsonb_build_object('kg', 'x'), 'sets', '[]'::jsonb),
      'pas un objet')));
  -- Séance sans aucune prescription : pas de champ presc
  insert into public.sessions (id, data) values ('cp-2', '{"date": 1780000001000, "category": "push", "label": "Push",
    "exercises": [{"name": "Développé", "sets": [{"weight": "80", "reps": "8"}]}]}');
end $$;

-- ── Ce que voit le coach ─────────────────────────────────
do $$
declare s jsonb;
begin
  perform pg_temp.plogin('c');
  select x.s into s from public.coach_student_sessions(pg_temp.pu('b')) x where x.id = 'cp-1';
  if s is null then raise 'séance absente pour le coach'; end if;
  if jsonb_array_length(s -> 'presc') <> jsonb_array_length(s -> 'exercises') then raise 'presc pas aligné : % pour %', s -> 'presc', s -> 'exercises'; end if;
  if s -> 'presc' -> 0 <> 'null'::jsonb then raise 'exercice sans prescription : %', s -> 'presc' -> 0; end if;
  if s -> 'presc' -> 1 is distinct from '{"kg": [null, 60, 60, 60], "lo": 8, "hi": 8}'::jsonb then raise '60 kg × 8 : %', s -> 'presc' -> 1; end if;
  if s -> 'presc' -> 2 is distinct from '{"kg": [null, null, null, 0, 499.5]}'::jsonb then raise 'valeurs forgées : %', s -> 'presc' -> 2; end if;
  if s -> 'presc' -> 3 <> 'null'::jsonb or s -> 'presc' -> 4 <> 'null'::jsonb then raise 'presc invalide transmis : %', s -> 'presc'; end if;
  if s::text ~ 'secret|fuite' then raise 'valeur forgée transmise : %', s; end if;
  -- Le reste de la séance ne change pas (même liste blanche)
  if s -> 'exercises' -> 1 -> 'sets' -> 1 ->> 'weight' is distinct from '62.5' then raise 'séries : %', s -> 'exercises' -> 1; end if;
  select x.s into s from public.coach_student_sessions(pg_temp.pu('b')) x where x.id = 'cp-2';
  if s ? 'presc' then raise 'séance sans prescription : %', s; end if;
end $$;

-- ── Ce que voit un ami : rien de la prescription ─────────
do $$
declare s jsonb;
begin
  perform pg_temp.plogin('a');
  select f.s into s from public.feed(only_user => pg_temp.pu('b')) f where f.id = 'cp-1';
  if s is null then raise 'séance absente du fil'; end if;
  if s ? 'presc' or s::text ~ 'presc' then raise 'prescription montrée à un ami : %', s; end if;
  if pg_temp.perr2($q$ select private.exercise_presc('{}') $q$) not like 'permission denied%' then raise 'private.exercise_presc appelable'; end if;
  if pg_temp.perr2($q$ select private.session_presc('{}') $q$) not like 'permission denied%' then raise 'private.session_presc appelable'; end if;
end $$;
reset role;

-- ── Ménage ───────────────────────────────────────────────
delete from auth.users where id in (pg_temp.pu('a'), pg_temp.pu('b'), pg_temp.pu('c'));
do $$ begin
  if exists (select 1 from public.sessions where id like 'cp-%') then raise 'séances du test restées'; end if;
end $$;
