-- ═══════════════════════════════════════════════════════════
--  Séance publique : le second côté d'une série notée par bras (docs/UNILATERAL.md). NON appliquée en
--  production : attend le feu vert de Maxence.
--
--  L'app range le bras droit d'une série dans la série (side2 : { weight, reps, sub? }) et le premier bras d'un
--  exercice (sideFirst : 'droit', absent sinon). private.session_public (amis : feed ; coach :
--  session_for_coach, coach_student_sessions) les laissait de côté : l'ami et le coach ne voyaient que le bras gauche.
--  Ils passent maintenant, bornés comme les sous-séries (20261106100000_seance_publique_intensif_prise.sql) :
--  reps entières de 1 à 4000, charge de 0 à 1000 kg (3 décimales) ou vide, 6 sous-séries au plus, sous-séries
--  seulement si la série garde une technique à sous-séries, jamais sur un échauffement. Le reste de la fonction est
--  celui de 20261117020000_charge_coach.sql, à l'octet près : une séance sans ces champs sort comme avant.
--
--  Retour arrière : supabase/rollback/20261120010000_seance_publique_par_bras_down.sql
-- ═══════════════════════════════════════════════════════════

-- Second côté d'une série : { weight, reps, sub? }, null sinon (absent, illisible, échauffement)
create function private.set_side2(st jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case
    when jsonb_typeof(st -> 'side2') = 'object' and st -> 'warmup' is distinct from 'true'::jsonb
         and private.sub_reps(st -> 'side2' -> 'reps') is not null
         and (coalesce(jsonb_typeof(st -> 'side2' -> 'weight'), 'null') = 'null' or private.sub_weight(st -> 'side2' -> 'weight') is not null)
      then jsonb_strip_nulls(jsonb_build_object(
        'weight', private.sub_weight(st -> 'side2' -> 'weight'),
        'reps',   private.sub_reps(st -> 'side2' -> 'reps'),
        'sub',    case when st -> 'tech' in ('"drop"', '"rp"', '"cluster"') then private.set_sub(st -> 'side2' -> 'sub') end
      ))
  end
$$;

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
        'sideFirst', case when e.v -> 'sideFirst' = '"droit"'::jsonb then e.v -> 'sideFirst' end,
        'sets',    coalesce((
          select jsonb_agg(jsonb_build_object(
            'weight', case jsonb_typeof(st.v -> 'weight') when 'string' then to_jsonb(left(st.v ->> 'weight', 200))
                                                          when 'number' then st.v -> 'weight' when 'boolean' then st.v -> 'weight' end,
            'reps',   case jsonb_typeof(st.v -> 'reps') when 'string' then to_jsonb(left(st.v ->> 'reps', 200))
                                                        when 'number' then st.v -> 'reps' when 'boolean' then st.v -> 'reps' end,
            'dist',   case jsonb_typeof(st.v -> 'dist') when 'string' then to_jsonb(left(st.v ->> 'dist', 200))
                                                        when 'number' then st.v -> 'dist' when 'boolean' then st.v -> 'dist' end,
            'warmup', case when st.v -> 'warmup' = 'true'::jsonb then true end,
            'rir',    case when st.v -> 'rir' in ('0', '1', '2', '3', '4') then st.v -> 'rir' end,
            'side2',  private.set_side2(st.v)
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

revoke all on function private.set_side2(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.session_public(jsonb) from public, anon, authenticated, service_role;
