-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261117000000_charge_coach.sql (à lancer à la main, dans
--  l'éditeur SQL, sur décision de Maxence). Pas dans migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Effet : les six fonctions reprennent leur texte d'avant (séance montrée, records, prescriptions, séance
--  vue par le coach, progression des élèves, envoi d'un programme). Aucune donnée n'est touchée ; les
--  réponses sont les mêmes, seulement plus lentes, et l'envoi de programmes revient à 30 par 24 h.
--  Ordre : indépendant, à lancer AVANT tout retour arrière plus ancien qui touche ces fonctions
--  (charge prescrite, séance publique, progression, plans diète, records).
-- ═══════════════════════════════════════════════════════════

begin;

-- 20261106100000_seance_publique_intensif_prise.sql
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

-- 20261031100000_records_series.sql
create or replace function private.session_records(v jsonb, with_before boolean) returns jsonb
  language sql immutable set search_path = '' as
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

-- 20261116010000_charge_prescrite.sql
create or replace function private.session_presc(data jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case when bool_or(p is not null) then jsonb_agg(coalesce(p, 'null'::jsonb) order by n) end
  from (
    select private.exercise_presc(e.v -> 'presc') as p, e.n
    from jsonb_array_elements(case when jsonb_typeof(data -> 'exercises') = 'array' then data -> 'exercises' else '[]'::jsonb end)
         with ordinality as e(v, n)
    where jsonb_typeof(e.v) = 'object' and e.n <= 60
  ) x
$$;

create or replace function private.session_for_coach(id text, data jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select private.session_public(data) || jsonb_strip_nulls(jsonb_build_object(
    'id',      id,
    'notes',   case when jsonb_typeof(data -> 'notes') = 'string' then to_jsonb(left(data ->> 'notes', 2000)) end,
    'hidden',  case when coalesce(data ->> 'hidden', '') = 'true' then true end,
    'records', private.session_records(data -> 'records', true),
    'presc',   private.session_presc(data)
  ))
$$;

-- 20261106000000_coach_progression.sql
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
    'last_record_at', (select max(y.done_at) from public.sessions y
                       where y.user_id = st.student_id and y.deleted_at is null and y.done_at is not null
                         and y.done_at >= st.horizon_at and y.done_at <= st.max_at
                         and jsonb_array_length(coalesce(private.session_records(y.data -> 'records', false), '[]'::jsonb)) > 0),
    'unnoted_at', (select max(y.done_at) from public.sessions y
                   where y.user_id = st.student_id and y.deleted_at is null and y.done_at is not null
                     and y.done_at >= st.horizon_at and y.done_at <= st.max_at
                     and jsonb_typeof(y.data -> 'records') is distinct from 'array')
  ) order by st.student_id), '[]'::jsonb))
  from st
$$;

-- 20261106200000_plans_diete_coach.sql
create or replace function public.coach_send_programme(student uuid, prog_id text, data jsonb) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
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
  perform private.rate_limit_window(me, 'coach_send', 30, interval '24 hours');
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

revoke all on function private.session_public(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.session_records(jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function private.session_presc(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.session_for_coach(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.coach_progress() from public, anon, authenticated;
grant execute on function public.coach_progress() to authenticated;
revoke all on function public.coach_send_programme(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.coach_send_programme(uuid, text, jsonb) to authenticated;

commit;
