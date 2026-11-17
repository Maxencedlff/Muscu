-- ═══════════════════════════════════════════════════════════
--  Charge côté coach (mesures du 17/11/2026 : tests/charge/serveur.sh, coachs de 50, 150 et 300 élèves).
--  Aucune table, aucun droit nouveau : des fonctions réécrites à résultat IDENTIQUE, et une limite qui
--  suit la taille de l'équipe. NON appliquée en production : attend le feu vert de Maxence.
--
--  1. Séances lues par le coach (coach_student_sessions, coach_progress) et par les abonnés (feed) :
--     private.session_public, private.session_records et private.session_presc appelaient, pour CHAQUE
--     série, private.scalar trois fois et private.set_tech une fois, et pour chaque record
--     private.bounded_num trois fois. Une fonction SQL à « set search_path » n'est jamais intégrée à la
--     requête qui l'appelle : chaque appel est préparé à nouveau (13 à 80 µs). Une séance de 7 exercices
--     et 28 séries coûtait ~4 ms, une page de 30 séances ~120 ms, coach_progress à 300 élèves ~250 ms.
--     Les mêmes expressions sont écrites ici directement dans la requête (un seul appel par séance) ;
--     les petites fonctions restent (d'autres appelants), le résultat ne change pas d'un octet
--     (tests/sql/charge_coach_test.sql compare avec les anciennes versions sur des séances variées).
--     private.session_for_coach passe en plpgsql : appelée depuis une fonction SQL, private.session_public
--     était préparée à nouveau pour chaque séance (~2 ms) ; dans une expression plpgsql simple, elle est
--     préparée une fois par transaction. Une page de 30 séances : ~120 ms avant, ~35 ms après (Postgres local).
--  2. coach_progress : la dernière séance avec un record (last_record_at) recalculait les records de
--     toutes les séances des 182 derniers jours de chaque élève. Elle lit maintenant les séances de la
--     plus récente à la plus ancienne et s'arrête à la première qui convient (index sessions_user_done).
--  3. Envoi d'un programme ou d'un plan de diète (coach_send_programme) : 30 par 24 h quelle que soit
--     l'équipe ; un coach de 50 élèves ne pouvait pas envoyer le nouveau bloc à tous (refus au 31e).
--     Limite : 30 + 2 par élève suivi (un programme et un plan de diète chacun), toujours glissante sur 24 h.
--
--  Retour arrière : supabase/rollback/20261117000000_charge_coach_down.sql (remet les versions d'avant).
-- ═══════════════════════════════════════════════════════════

-- ── 1. Séance montrée : expressions par série et par exercice écrites dans la requête ──
-- Mêmes règles que 20261106100000_seance_publique_intensif_prise.sql : scalar (texte 200 caractères,
-- nombre, booléen), set_tech (échauffement : rien ; top, backoff ; drop, rp, cluster avec sous-séries
-- valables), exercise_grip appelée une fois par exercice (rare, peu coûteuse).
create or replace function private.session_public(data jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select jsonb_strip_nulls(jsonb_build_object(
    'date',      private.scalar(data -> 'date'),
    'duration',  private.scalar(data -> 'duration'),
    'programme', private.scalar(data -> 'programme'),
    'category',  private.scalar(data -> 'category'),
    'label',     private.scalar(data -> 'label'),
    'records',   private.session_records(data -> 'records', false),
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',    case jsonb_typeof(e.v -> 'name') when 'string' then to_jsonb(left(e.v ->> 'name', 200))
                                                    when 'number' then e.v -> 'name' when 'boolean' then e.v -> 'name' end,
        'measure', case jsonb_typeof(e.v -> 'measure') when 'string' then to_jsonb(left(e.v ->> 'measure', 200))
                                                       when 'number' then e.v -> 'measure' when 'boolean' then e.v -> 'measure' end,
        'ss',      case jsonb_typeof(e.v -> 'ss') when 'string' then to_jsonb(left(e.v ->> 'ss', 200))
                                                  when 'number' then e.v -> 'ss' when 'boolean' then e.v -> 'ss' end,
        'grip',    case when jsonb_typeof(e.v -> 'grip') = 'object' then private.exercise_grip(e.v -> 'grip') end,
        'sets',    coalesce((
          select jsonb_agg(jsonb_build_object(
            'weight', case jsonb_typeof(st.v -> 'weight') when 'string' then to_jsonb(left(st.v ->> 'weight', 200))
                                                          when 'number' then st.v -> 'weight' when 'boolean' then st.v -> 'weight' end,
            'reps',   case jsonb_typeof(st.v -> 'reps') when 'string' then to_jsonb(left(st.v ->> 'reps', 200))
                                                        when 'number' then st.v -> 'reps' when 'boolean' then st.v -> 'reps' end,
            'dist',   case jsonb_typeof(st.v -> 'dist') when 'string' then to_jsonb(left(st.v ->> 'dist', 200))
                                                        when 'number' then st.v -> 'dist' when 'boolean' then st.v -> 'dist' end,
            'warmup', case when st.v -> 'warmup' = 'true'::jsonb then true end,
            'rir',    case when st.v -> 'rir' in ('0', '1', '2', '3', '4') then st.v -> 'rir' end
          ) || case
                 when st.v -> 'warmup' = 'true'::jsonb then '{}'::jsonb
                 when st.v -> 'tech' in ('"top"', '"backoff"') then jsonb_build_object('tech', st.v -> 'tech')
                 when st.v -> 'tech' in ('"drop"', '"rp"', '"cluster"') then coalesce(private.set_tech(st.v), '{}'::jsonb)
                 else '{}'::jsonb
               end order by st.n)
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

-- ── Séance vue par le coach : même contenu que 20261116010000_charge_prescrite.sql, en plpgsql (point 1) ──
create or replace function private.session_for_coach(id text, data jsonb) returns jsonb
  language plpgsql immutable set search_path = '' as
$$
begin
  return private.session_public(data) || jsonb_strip_nulls(jsonb_build_object(
    'id',      id,
    'notes',   case when jsonb_typeof(data -> 'notes') = 'string' then to_jsonb(left(data ->> 'notes', 2000)) end,
    'hidden',  case when coalesce(data ->> 'hidden', '') = 'true' then true end,
    'records', private.session_records(data -> 'records', true),
    'presc',   private.session_presc(data)
  ));
end
$$;

-- ── Records : bounded_num écrit dans la requête (mêmes règles que 20261031100000_records_series.sql) ──
create or replace function private.session_records(v jsonb, with_before boolean) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case when jsonb_typeof(v) = 'array' then coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'ex',     to_jsonb(left(r.v ->> 'ex', 80)),
      'kind',   r.v -> 'kind',
      'before', case when with_before then r.v -> 'before' end,
      'after',  r.v -> 'after',
      'w',      case when jsonb_typeof(r.v -> 'w') = 'number' and (r.v ->> 'w')::numeric between 0 and 100000 then r.v -> 'w' end,
      'd',      case when r.v -> 'd' in ('0.5', '1', '2', '5', '10') then r.v -> 'd' end
    )) order by r.n)
    from jsonb_array_elements(v) with ordinality as r(v, n)
    where r.n <= 20 and jsonb_typeof(r.v) = 'object'
      and jsonb_typeof(r.v -> 'ex') = 'string' and char_length(btrim(r.v ->> 'ex')) > 0
      and jsonb_typeof(r.v -> 'kind') = 'string'
      and r.v ->> 'kind' in ('charge', 'reps', 'lest', 'aide', 'temps', 'duree', 'distance', 'allure')
      -- CASE : le test de type passe avant la conversion (l'ordre des conditions d'un WHERE n'est pas garanti)
      and case when jsonb_typeof(r.v -> 'before') = 'number' then (r.v ->> 'before')::numeric between 0 and 100000 else false end
      and case when jsonb_typeof(r.v -> 'after') = 'number' then (r.v ->> 'after')::numeric between 0 and 100000 else false end
      -- Une allure se rapporte toujours à une distance fixe
      and (r.v ->> 'kind' <> 'allure' or r.v -> 'd' in ('0.5', '1', '2', '5', '10'))
  ), '[]'::jsonb) end
$$;

-- ── Prescriptions : exercise_presc et bounded_num écrits dans la requête (20261116010000_charge_prescrite.sql) ──
create or replace function private.session_presc(data jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case when bool_or(p is not null) then jsonb_agg(coalesce(p, 'null'::jsonb) order by n) end
  from (
    select case when jsonb_typeof(e.v -> 'presc') = 'object' and jsonb_typeof(e.v -> 'presc' -> 'kg') = 'array' then jsonb_strip_nulls(jsonb_build_object(
      'kg', (select coalesce(jsonb_agg(case when jsonb_typeof(k.v) = 'number' and (k.v #>> '{}')::numeric between 0 and 500 then k.v end
                                       order by k.n), '[]'::jsonb)
             from jsonb_array_elements(e.v -> 'presc' -> 'kg') with ordinality as k(v, n) where k.n <= 100),
      'lo', case when jsonb_typeof(e.v -> 'presc' -> 'lo') = 'number' and (e.v -> 'presc' ->> 'lo')::numeric between 1 and 100
                      and (e.v -> 'presc' ->> 'lo')::numeric = trunc((e.v -> 'presc' ->> 'lo')::numeric) then e.v -> 'presc' -> 'lo' end,
      'hi', case when jsonb_typeof(e.v -> 'presc' -> 'hi') = 'number' and (e.v -> 'presc' ->> 'hi')::numeric between 1 and 100
                      and (e.v -> 'presc' ->> 'hi')::numeric = trunc((e.v -> 'presc' ->> 'hi')::numeric) then e.v -> 'presc' -> 'hi' end
    )) end as p, e.n
    from jsonb_array_elements(case when jsonb_typeof(data -> 'exercises') = 'array' then data -> 'exercises' else '[]'::jsonb end)
         with ordinality as e(v, n)
    where jsonb_typeof(e.v) = 'object' and e.n <= 60
  ) x
$$;

-- ── 2. Progression des élèves : dernière séance avec un record, sans relire les 182 jours ──
create or replace function public.coach_progress() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (
    select u.id, private.max_done_at() as max_at,
           (extract(epoch from now() - interval '35 days') * 1000)::bigint as from_at,
           (extract(epoch from now() - interval '182 days') * 1000)::bigint as horizon_at
    from (select (select auth.uid()) as id) u
    where private.is_coach(u.id)
  ),
  st as (
    select l.student_id, me.max_at, me.from_at, me.horizon_at
    from me join public.coach_links l on l.coach_id = me.id
  )
  select jsonb_build_object('students', coalesce(jsonb_agg(jsonb_build_object(
    'student_id', st.student_id,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('at', x.done_at, 'records', private.session_records(x.data -> 'records', true))
                       order by x.done_at desc, x.id desc)
      from (select y.done_at, y.id, y.data from public.sessions y
            where y.user_id = st.student_id and y.deleted_at is null and y.done_at is not null
              and y.done_at >= st.from_at and y.done_at <= st.max_at
            order by y.done_at desc, y.id desc limit 80) x), '[]'::jsonb),
    'first_at', (select min(y.done_at) from public.sessions y
                 where y.user_id = st.student_id and y.deleted_at is null and y.done_at is not null
                   and y.done_at >= st.horizon_at and y.done_at <= st.max_at),
    -- La plus récente d'abord, arrêt à la première qui a un record (même valeur que max(done_at))
    'last_record_at', (select y.done_at from public.sessions y
                       where y.user_id = st.student_id and y.deleted_at is null and y.done_at is not null
                         and y.done_at >= st.horizon_at and y.done_at <= st.max_at
                         and jsonb_array_length(coalesce(private.session_records(y.data -> 'records', false), '[]'::jsonb)) > 0
                       order by y.done_at desc, y.id desc limit 1),
    'unnoted_at', (select max(y.done_at) from public.sessions y
                   where y.user_id = st.student_id and y.deleted_at is null and y.done_at is not null
                     and y.done_at >= st.horizon_at and y.done_at <= st.max_at
                     and jsonb_typeof(y.data -> 'records') is distinct from 'array')
  ) order by st.student_id), '[]'::jsonb))
  from st
$$;

-- ── 3. Envoi d'un programme ou d'un plan diète : limite qui suit la taille de l'équipe ──
-- Comme 20261106200000_plans_diete_coach.sql, seule la limite change.
create or replace function public.coach_send_programme(student uuid, prog_id text, data jsonb) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  team int;
begin
  if me is null or not private.is_coach(me) then
    raise exception 'not_coach' using errcode = 'P0001';
  end if;
  perform private.coach_require_student(me, student);
  if prog_id is null or prog_id !~ '^[A-Za-z0-9_-]{1,64}$' or data is null or jsonb_typeof(data) <> 'object' then
    raise exception 'invalid_programme' using errcode = 'P0001';
  end if;
  if octet_length(data::text) > 204800 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;
  -- Imbriqué : l'accord n'est lu que pour un plan diète
  if prog_id like 'diet\_%' then
    if not private.coach_has_share(me, student, 'diet') then
      raise exception 'diet_not_accepted' using errcode = 'P0001';
    end if;
  end if;
  -- 30 + 2 par élève suivi (un programme et un plan diète chacun), sur 24 h glissantes
  team := (select count(*)::int from public.coach_links l where l.coach_id = me);
  perform private.rate_limit_window(me, 'coach_send', 30 + 2 * team, interval '24 hours');
  begin
    insert into public.coach_programmes (student_id, coach_id, id, data, sent_at)
      values (student, me, prog_id, data, clock_timestamp())
      on conflict on constraint coach_programmes_pkey do update
        set data = excluded.data, coach_id = excluded.coach_id, sent_at = excluded.sent_at, seen_at = null;
  exception when foreign_key_violation then
    -- L'élève est parti entre la vérification et l'écriture
    raise exception 'not_found' using errcode = 'P0001';
  end;
end
$$;

-- Droits inchangés (create or replace les garde) ; redits pour la lecture
revoke all on function private.session_public(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.session_records(jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function private.session_presc(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.session_for_coach(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.coach_progress() from public, anon, authenticated;
grant execute on function public.coach_progress() to authenticated;
revoke all on function public.coach_send_programme(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.coach_send_programme(uuid, text, jsonb) to authenticated;
