-- ═══════════════════════════════════════════════════════════
--  Séance publique : rôle et rang d'un bloc (le même exercice deux fois dans une séance, js/data/blocks.js,
--  docs/SEANCE_OUTILS.md). PRÉPARÉE, PAS APPLIQUÉE : en attente du feu vert de Maxence (26/11/2026).
--
--  L'app range sur l'exercice d'une séance son rôle (role : 'prefat' Pré-fatigue, 'warmup' Échauffement, absent =
--  Normal) et le rang de son bloc (occ : 2 à 20, absent = 1). private.session_public (amis : feed ; coach :
--  session_for_coach, coach_student_sessions) les laissait de côté : l'ami et le coach voient le bloc sous son nom, ses
--  séries en échauffement (warmup, déjà transmis), sans « Pré-fatigue » ni son rang. Ils passent maintenant, en liste
--  blanche : role seulement 'prefat' ou 'warmup', occ seulement un entier de 2 à 20. Le reste de la fonction est celui
--  de 20261120010000_seance_publique_par_bras.sql, à l'octet près : une séance sans ces champs sort comme avant.
--  L'app d'aujourd'hui lit déjà les deux champs reçus (cleanBlockFields) ; une version d'avant les ignore.
--
--  Retour arrière : supabase/rollback/20261129020000_seance_publique_blocs_down.sql
-- ═══════════════════════════════════════════════════════════

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
        'role',    case when e.v -> 'role' in ('"prefat"', '"warmup"') then e.v -> 'role' end,
        'occ',     case when jsonb_typeof(e.v -> 'occ') = 'number' and (e.v ->> 'occ') ~ '^([2-9]|1[0-9]|20)$' then e.v -> 'occ' end,
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
