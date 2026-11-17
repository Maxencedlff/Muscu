-- Vérifications de supabase/migrations/20261117020000_charge_coach.sql (lancées par tests/sql/run.sh) :
--  1. séance montrée, records, prescriptions et séance vue par le coach : réponses IDENTIQUES aux versions
--     d'avant (copiées ci-dessous dans pg_temp, oracle) sur des séances faites à la main pour chaque règle,
--     puis 2 000 séances tirées au hasard (graine fixe) parmi des valeurs valables, limites et forgées ;
--  2. coach_progress : last_record_at égal au max(done_at) d'avant (séances avec et sans records) ;
--  3. coach_send_programme : 30 + 2 envois par élève sur 24 h, refus au-delà.

-- ── Oracle : les versions d'avant la migration ───────────
create or replace function pg_temp.old_session_records(v jsonb, with_before boolean) returns jsonb
  language sql immutable as
$$
  select case when jsonb_typeof(v) = 'array' then coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'ex',     to_jsonb(left(r.v ->> 'ex', 80)),
      'kind',   r.v -> 'kind',
      'before', case when with_before then r.v -> 'before' end,
      'after',  r.v -> 'after',
      'w',      private.bounded_num(r.v -> 'w', 0, 100000),
      'd',      case when r.v -> 'd' in ('0.5', '1', '2', '5', '10') then r.v -> 'd' end
    )) order by r.n)
    from jsonb_array_elements(v) with ordinality as r(v, n)
    where r.n <= 20 and jsonb_typeof(r.v) = 'object'
      and jsonb_typeof(r.v -> 'ex') = 'string' and char_length(btrim(r.v ->> 'ex')) > 0
      and jsonb_typeof(r.v -> 'kind') = 'string'
      and r.v ->> 'kind' in ('charge', 'reps', 'lest', 'aide', 'temps', 'duree', 'distance', 'allure')
      and private.bounded_num(r.v -> 'before', 0, 100000) is not null
      and private.bounded_num(r.v -> 'after', 0, 100000) is not null
      -- Une allure se rapporte toujours à une distance fixe
      and (r.v ->> 'kind' <> 'allure' or r.v -> 'd' in ('0.5', '1', '2', '5', '10'))
  ), '[]'::jsonb) end
$$;

create or replace function pg_temp.old_session_presc(data jsonb) returns jsonb
  language sql immutable as
$$
  select case when bool_or(p is not null) then jsonb_agg(coalesce(p, 'null'::jsonb) order by n) end
  from (
    select private.exercise_presc(e.v -> 'presc') as p, e.n
    from jsonb_array_elements(case when jsonb_typeof(data -> 'exercises') = 'array' then data -> 'exercises' else '[]'::jsonb end)
         with ordinality as e(v, n)
    where jsonb_typeof(e.v) = 'object' and e.n <= 60
  ) x
$$;

create or replace function pg_temp.old_session_public(data jsonb) returns jsonb
  language sql immutable as
$$
  select jsonb_strip_nulls(jsonb_build_object(
    'date',      private.scalar(data -> 'date'),
    'duration',  private.scalar(data -> 'duration'),
    'programme', private.scalar(data -> 'programme'),
    'category',  private.scalar(data -> 'category'),
    'label',     private.scalar(data -> 'label'),
    'records',   pg_temp.old_session_records(data -> 'records', false),
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',    private.scalar(e.v -> 'name'),
        'measure', private.scalar(e.v -> 'measure'),
        'ss',      private.scalar(e.v -> 'ss'),
        'grip',    private.exercise_grip(e.v -> 'grip'),
        'sets',    coalesce((
          select jsonb_agg(jsonb_build_object(
            'weight', private.scalar(st.v -> 'weight'),
            'reps',   private.scalar(st.v -> 'reps'),
            'dist',   private.scalar(st.v -> 'dist'),
            'warmup', case when st.v -> 'warmup' = 'true'::jsonb then true end,
            'rir',    case when st.v -> 'rir' in ('0', '1', '2', '3', '4') then st.v -> 'rir' end
          ) || coalesce(private.set_tech(st.v), '{}'::jsonb) order by st.n)
          from jsonb_array_elements(case when jsonb_typeof(e.v -> 'sets') = 'array' then e.v -> 'sets' else '[]'::jsonb end)
               with ordinality as st(v, n)
          where jsonb_typeof(st.v) = 'object' and st.n <= 100
        ), '[]'::jsonb)
      ) order by e.n)
      from jsonb_array_elements(case when jsonb_typeof(data -> 'exercises') = 'array' then data -> 'exercises' else '[]'::jsonb end)
           with ordinality as e(v, n)
      where jsonb_typeof(e.v) = 'object' and e.n <= 60
    ), '[]'::jsonb)
  ))
$$;

create or replace function pg_temp.old_session_for_coach(id text, data jsonb) returns jsonb
  language sql immutable as
$$
  select pg_temp.old_session_public(data) || jsonb_strip_nulls(jsonb_build_object(
    'id',      id,
    'notes',   case when jsonb_typeof(data -> 'notes') = 'string' then to_jsonb(left(data ->> 'notes', 2000)) end,
    'hidden',  case when coalesce(data ->> 'hidden', '') = 'true' then true end,
    'records', pg_temp.old_session_records(data -> 'records', true),
    'presc',   pg_temp.old_session_presc(data)
  ))
$$;

-- ── 1a. Séances faites à la main : une par règle ─────────
create temp table cc_cases (k int, data jsonb);
insert into cc_cases values
  (1, '{"date": 1780000000000, "duration": 3600000, "programme": "ppl", "category": "push", "label": "Push", "notes": "Bonne séance",
        "exercises": [{"name": "Développé couché", "sets": [{"weight": "80", "reps": "8"}, {"weight": 82.5, "reps": 6, "rir": 1}]}]}'),
  -- Textes longs (200 et 2 000 caractères), types inattendus
  (2, jsonb_build_object('date', '1780000000000', 'label', repeat('é', 250), 'notes', repeat('n', 2500), 'category', true,
        'exercises', jsonb_build_array(jsonb_build_object('name', repeat('x', 300), 'measure', 'time', 'ss', 2,
          'sets', jsonb_build_array(jsonb_build_object('weight', repeat('9', 250), 'reps', true, 'dist', 5.5)))))),
  -- Séries : échauffement (true, "true"), rir hors liste, techniques valables et forgées, sous-séries
  (3, '{"date": 1780000000000, "exercises": [{"name": "Squat", "sets": [
        {"weight": "20", "reps": "10", "warmup": true, "tech": "top"},
        {"weight": "20", "reps": "10", "warmup": "true"},
        {"weight": "100", "reps": "5", "tech": "top", "rir": 5},
        {"weight": "90", "reps": "8", "tech": "backoff", "rir": "1"},
        {"weight": "80", "reps": "8", "tech": "drop", "sub": [{"weight": "60", "reps": "6"}, {"weight": 1001, "reps": "4"}, {"reps": "0"}]},
        {"weight": "80", "reps": "8", "tech": "rp", "sub": [{"reps": 4}, {"reps": 4.5}]},
        {"weight": "80", "reps": "8", "tech": "cluster", "sub": "pas une liste"},
        {"weight": "80", "reps": "8", "tech": "drop"},
        {"weight": "80", "reps": "8", "tech": "inconnue"},
        {"weight": "80", "reps": "8", "tech": ["top"]},
        "pas un objet", null, 12]}]}'),
  -- Prises : objet valable, partiel, forgé, pas un objet
  (4, '{"date": 1780000000000, "exercises": [
        {"name": "Tirage", "grip": {"hand": "pronation", "width": "large", "tool": "barre"}, "sets": []},
        {"name": "Rowing", "grip": {"hand": "inconnue", "width": "serree", "x": 1}, "sets": []},
        {"name": "Curl", "grip": {"hand": 3}, "sets": []},
        {"name": "Dips", "grip": "large", "sets": "pas une liste"},
        "pas un objet", 7, {"sets": [{"weight": "1"}]}]}'),
  -- Records : chaque type, bornes, before texte (jamais converti), allure sans distance, w, d
  (5, '{"date": 1780000000000, "records": [
        {"ex": "Squat", "kind": "charge", "before": 100, "after": 105, "w": 105},
        {"ex": "Traction", "kind": "lest", "before": 0, "after": 100000, "w": 100001},
        {"ex": "Course", "kind": "allure", "before": 300, "after": 290, "d": 5},
        {"ex": "Course", "kind": "allure", "before": 300, "after": 290},
        {"ex": "Course", "kind": "allure", "before": 300, "after": 290, "d": 3},
        {"ex": "Rameur", "kind": "distance", "before": "abc", "after": 10},
        {"ex": "Rameur", "kind": "distance", "before": 10, "after": "1e9"},
        {"ex": "Rameur", "kind": "duree", "before": -1, "after": 10},
        {"ex": "  ", "kind": "reps", "before": 1, "after": 2},
        {"ex": 5, "kind": "reps", "before": 1, "after": 2},
        {"ex": "Gainage", "kind": "inconnu", "before": 1, "after": 2},
        {"ex": "Gainage", "kind": "temps", "before": 1, "after": 2, "w": "12", "secret": "x"},
        "pas un objet"]}'),
  (6, '{"date": 1780000000000, "records": "pas une liste", "exercises": "pas une liste"}'),
  (7, '{"date": 1780000000000, "records": [], "exercises": []}'),
  (8, '{}'),
  -- Prescriptions : valable, bornes, forgée, pas un objet
  (9, '{"date": 1780000000000, "hidden": true, "exercises": [
        {"name": "Squat", "presc": {"kg": [null, 60, 60.5, 500, 501, -1, "60", {"x": 1}], "lo": 8, "hi": 12, "secret": "x"}, "sets": []},
        {"name": "Presse", "presc": {"kg": [], "lo": 2.5, "hi": 101}, "sets": []},
        {"name": "Fentes", "presc": {"kg": "x", "lo": 8}, "sets": []},
        {"name": "Mollets", "presc": "texte", "sets": []},
        {"name": "Sans", "sets": []}]}'),
  (10, '{"date": 1780000000000, "hidden": "true", "notes": 12, "exercises": [{"name": "Sans", "sets": []}]}');
-- Plus de 100 séries, plus de 60 exercices, plus de 20 records
insert into cc_cases select 11, jsonb_build_object('date', 1780000000000,
  'exercises', (select jsonb_agg(jsonb_build_object('name', 'Ex ' || e, 'presc', jsonb_build_object('kg', jsonb_build_array(e), 'lo', 5, 'hi', 5),
                  'sets', (select jsonb_agg(jsonb_build_object('weight', s::text, 'reps', s)) from generate_series(1, 105) s)))
                from generate_series(1, 65) e),
  'records', (select jsonb_agg(jsonb_build_object('ex', 'R' || r, 'kind', 'charge', 'before', r, 'after', r + 1)) from generate_series(1, 25) r));

-- ── 1b. 2 000 séances au hasard (graine fixe) ────────────
do $$ begin perform setseed(0.17); end $$;
create temp table cc_pool (kind text, v jsonb);
insert into cc_pool select 'any', v from unnest(array[
  'null', 'true', 'false', '0', '1', '4', '5', '-1', '2.5', '12', '100000', '100001', '1001', '4000', '4001',
  '""', '"0"', '"8"', '"80.5"', '"1000.000"', '"abc"', '"true"', '"top"', '"backoff"', '"drop"', '"rp"', '"cluster"',
  '"pronation"', '"large"', '"barre"', '"charge"', '"allure"', '"0.5"', '[]', '{}', '[1, 2]', '{"x": 1}'
]::jsonb[]) v;
create function pg_temp.pick() returns jsonb language sql volatile as
$$ select v from cc_pool order by random() limit 1 $$;
create function pg_temp.maybe(p float8) returns boolean language sql volatile as $$ select random() < p $$;
create function pg_temp.rand_obj(keys text[]) returns jsonb language sql volatile as
$$ select coalesce(jsonb_object_agg(k, pg_temp.pick()) filter (where pg_temp.maybe(0.6)), '{}'::jsonb) from unnest(keys) k $$;
create function pg_temp.rand_session() returns jsonb language plpgsql volatile as
$$
declare ex jsonb := '[]'; s jsonb; e jsonb; recs jsonb := '[]'; i int; j int;
begin
  for i in 1 .. (random() * 5)::int loop
    s := '[]';
    for j in 1 .. (random() * 5)::int loop
      s := s || jsonb_build_array(case when pg_temp.maybe(0.05) then pg_temp.pick()
        else pg_temp.rand_obj(array['weight', 'reps', 'dist', 'warmup', 'rir', 'tech'])
             || case when pg_temp.maybe(0.3) then jsonb_build_object(
                  'tech', case when pg_temp.maybe(0.6) then to_jsonb((array['drop', 'rp', 'cluster'])[1 + (random() * 2)::int]) else pg_temp.pick() end,
                  'sub', jsonb_build_array(jsonb_build_object('reps', 6),
                  pg_temp.rand_obj(array['weight', 'reps']), pg_temp.rand_obj(array['weight', 'reps']))) else '{}' end end);
    end loop;
    e := pg_temp.rand_obj(array['name', 'measure', 'ss']) || jsonb_build_object('sets', case when pg_temp.maybe(0.1) then pg_temp.pick() else s end);
    if pg_temp.maybe(0.3) then e := e || jsonb_build_object('grip', case when pg_temp.maybe(0.2) then pg_temp.pick() else pg_temp.rand_obj(array['hand', 'width', 'tool']) end); end if;
    if pg_temp.maybe(0.3) then e := e || jsonb_build_object('presc', case when pg_temp.maybe(0.2) then pg_temp.pick()
      else pg_temp.rand_obj(array['lo', 'hi']) || jsonb_build_object('kg', jsonb_build_array(pg_temp.pick(), pg_temp.pick(), pg_temp.pick())) end); end if;
    ex := ex || jsonb_build_array(case when pg_temp.maybe(0.05) then pg_temp.pick() else e end);
  end loop;
  for i in 1 .. (random() * 3)::int loop
    recs := recs || jsonb_build_array(pg_temp.rand_obj(array['ex', 'kind', 'before', 'after', 'w', 'd'])
                                      || jsonb_build_object('ex', 'Squat', 'kind', (array['charge', 'allure', 'reps', 'x'])[1 + (random() * 3)::int]));
  end loop;
  return pg_temp.rand_obj(array['date', 'duration', 'programme', 'category', 'label', 'notes', 'hidden'])
         || jsonb_build_object('exercises', ex, 'records', case when pg_temp.maybe(0.1) then pg_temp.pick() else recs end);
end
$$;
insert into cc_cases select 100 + i, pg_temp.rand_session() from generate_series(1, 2000) i;

do $$
declare c record; n int := 0;
begin
  for c in select k, data from cc_cases loop
    if private.session_public(c.data) is distinct from pg_temp.old_session_public(c.data) then
      raise 'session_public différente (cas %) : % ≠ %', c.k, private.session_public(c.data), pg_temp.old_session_public(c.data);
    end if;
    if private.session_for_coach('s' || c.k, c.data) is distinct from pg_temp.old_session_for_coach('s' || c.k, c.data) then
      raise 'session_for_coach différente (cas %) : % ≠ %', c.k, private.session_for_coach('s' || c.k, c.data), pg_temp.old_session_for_coach('s' || c.k, c.data);
    end if;
    if private.session_records(c.data -> 'records', false) is distinct from pg_temp.old_session_records(c.data -> 'records', false) then
      raise 'session_records différente (cas %)', c.k;
    end if;
    if private.session_presc(c.data) is distinct from pg_temp.old_session_presc(c.data) then
      raise 'session_presc différente (cas %) : % ≠ %', c.k, private.session_presc(c.data), pg_temp.old_session_presc(c.data);
    end if;
    n := n + 1;
  end loop;
  -- Le corpus couvre bien les branches rares (sinon l'égalité ne prouverait rien)
  if (select count(*) from cc_cases where private.session_public(data)::text ~ '"sub"') < 20 then raise 'trop peu de sous-séries'; end if;
  if (select count(*) from cc_cases where private.session_public(data)::text ~ '"grip"') < 20 then raise 'trop peu de prises'; end if;
  if (select count(*) from cc_cases where private.session_presc(data) is not null) < 20 then raise 'trop peu de prescriptions'; end if;
  if (select count(*) from cc_cases where jsonb_array_length(private.session_records(data -> 'records', true)) > 0) < 20 then raise 'trop peu de records'; end if;
  if n < 2011 then raise 'corpus incomplet : %', n; end if;
end $$;

-- ── 2 et 3. Progression et envoi de programmes ───────────
create function pg_temp.cu(i int) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000cc' || lpad(i::text, 3, '0'))::uuid $$;
create function pg_temp.cerr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.cu(int), pg_temp.cerr(text) to authenticated;
-- Coach 0, élèves 1 à 40 ; séances des 200 derniers jours, records sur une sur trois (sauf l'élève 1 : aucun)
insert into auth.users (id) select pg_temp.cu(i) from generate_series(0, 40) i;
insert into public.user_profiles (user_id, username, coach_at) values (pg_temp.cu(0), 'coach.cc', now());
insert into public.coach_links (student_id, coach_id) select pg_temp.cu(i), pg_temp.cu(0) from generate_series(1, 40) i;
insert into public.sessions (user_id, id, data)
  select pg_temp.cu(i), 'cc' || d, jsonb_build_object('date', (extract(epoch from now()) * 1000)::bigint - d * 86400000::bigint,
    'records', case when i = 1 then '[]'::jsonb when d % 3 = 0 and i <> 2 then jsonb_build_array(jsonb_build_object('ex', 'Squat', 'kind', 'charge', 'before', 1, 'after', 2))
                    when d % 7 = 0 then '"pas une liste"'::jsonb else '[]'::jsonb end)
  from generate_series(1, 40) i, generate_series(1, 200, 2) d;

set role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', pg_temp.cu(0)::text, false); end $$;
do $$
declare p jsonb; s jsonb; want bigint; ok int := 0; err text;
begin
  p := public.coach_progress();
  if jsonb_array_length(p -> 'students') <> 40 then raise 'progression : % élèves', jsonb_array_length(p -> 'students'); end if;
  for s in select * from jsonb_array_elements(p -> 'students') loop
    -- Ancienne définition : max(done_at) des 182 derniers jours parmi les séances avec au moins un record valable
    reset role;
    select max(y.done_at) into want from public.sessions y
      where y.user_id = (s ->> 'student_id')::uuid and y.deleted_at is null and y.done_at is not null
        and y.done_at >= (extract(epoch from now() - interval '182 days') * 1000)::bigint and y.done_at <= private.max_done_at()
        and jsonb_array_length(coalesce(private.session_records(y.data -> 'records', false), '[]'::jsonb)) > 0;
    set role authenticated;
    if (s ->> 'last_record_at')::bigint is distinct from want then
      raise 'last_record_at de % : % au lieu de %', s ->> 'student_id', s ->> 'last_record_at', want;
    end if;
  end loop;
  -- Élève 1 : listes vides ; élève 2 : listes vides ou pas une liste
  if (select count(*) from jsonb_array_elements(p -> 'students') x where x ->> 'last_record_at' is null) <> 2 then
    raise 'deux élèves sans record (1 et 2) attendus';
  end if;

  -- 40 élèves : 30 + 80 = 110 envois sur 24 h ; le programme de chacun passe, deux fois (programme puis mise à jour)
  for i in 1 .. 40 loop
    perform public.coach_send_programme(pg_temp.cu(i), 'cc1', '{"name": "Bloc"}');
    perform public.coach_send_programme(pg_temp.cu(i), 'cc2', '{"name": "Bloc 2"}');
  end loop;
  for i in 1 .. 30 loop
    perform public.coach_send_programme(pg_temp.cu(i), 'cc3', '{"name": "Bloc 3"}');
  end loop;
  err := pg_temp.cerr(format($q$ select public.coach_send_programme(%L, 'cc4', '{"name": "Un de trop"}') $q$, pg_temp.cu(1)));
  if err <> 'rate_limited' then raise '111e envoi en 24 h : % au lieu de rate_limited', err; end if;
end $$;
reset role;

-- ── Ménage ───────────────────────────────────────────────
delete from auth.users where id in (select pg_temp.cu(i) from generate_series(0, 40) i);
delete from private.social_rate where user_id = pg_temp.cu(0);
do $$ begin
  if exists (select 1 from public.sessions where id like 'cc%' and user_id::text like '00000000-0000-0000-0000-0000000cc%') then raise 'séances du test restées'; end if;
end $$;
