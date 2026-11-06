-- ═══════════════════════════════════════════════════════════
--  Séance vue par un abonné ou par le coach (06/11/2026) : la liste blanche private.session_public (et donc
--  private.session_for_coach, qui la recopie) transmet en plus :
--    - par série, la technique d'intensification (docs/INTENSIFICATION.md, js/data/intensif.js) :
--        tech : 'drop' | 'rp' | 'cluster' | 'top' | 'backoff' (texte), jamais sur une série d'échauffement ;
--        sub  : sous-séries d'un drop set, d'un rest-pause ou d'un cluster, au plus 6 (les 6 premières),
--               chacune { weight?, reps } : reps entier de 1 à 4000 (texte de chiffres ou nombre),
--               weight charge de 0 à 1000 kg (texte décimal, 3 décimales au plus, '' pour le poids du
--               corps, ou nombre) ; une sous-série invalide est écartée, une clé inconnue ne sort pas.
--               drop, rp et cluster ne sortent qu'avec au moins une sous-série valide (comme l'app :
--               cleanTechSet) ; top et backoff jamais avec sub.
--    - par exercice, la prise (js/data/grips.js, cleanGrip, branche prise-ergo) :
--        grip : { hand?, width?, tool? } aux valeurs fixes de l'app, chaque valeur inconnue retirée,
--               absent s'il n'en reste aucune.
--  Ce qui n'est pas dans ces listes ne sort jamais. Une séance sans ces champs sort exactement comme avant
--  (jsonb_strip_nulls retire les clés vides) : l'app d'un ami ou d'un coach sur une version précédente
--  ignore les nouveaux champs.
--
--  Rien d'autre ne change : mêmes fonctions appelantes (feed, my_shown_sessions, coach_student_sessions…),
--  mêmes droits. Fonctions ajoutées : private.sub_weight, private.sub_reps, private.set_sub,
--  private.set_tech, private.exercise_grip (internes, aucun rôle de l'API ne peut les appeler).
--
--  Réversible : supabase/rollback/20261106100000_seance_publique_intensif_prise_down.sql remet le texte de
--  20261031100000_records_series.sql et retire les cinq fonctions. Aucune donnée n'est modifiée.
-- ═══════════════════════════════════════════════════════════

-- Charge d'une sous-série (kg) : '' (poids du corps), texte décimal de 0 à 1000 avec 3 décimales au plus, ou
-- nombre de 0 à 1000 ; sinon null. Pas de conversion d'un texte non vérifié (le motif suffit à borner).
create function private.sub_weight(v jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case
    when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^(|\d{1,3}(\.\d{1,3})?|1000(\.0{1,3})?)$' then v
    when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 1000 then v
  end
$$;

-- Répétitions d'une sous-série : entier de 1 à 4000, en texte de chiffres ou en nombre ; sinon null
create function private.sub_reps(v jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case
    when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^([1-9]\d{0,2}|[1-3]\d{3}|4000)$' then v
    when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 1 and 4000
         and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric) then v
  end
$$;

-- Sous-séries : les 6 premiers éléments, les invalides écartés ; null si ce n'est pas un tableau ou s'il
-- n'en reste aucune. Charge absente (ou null) : poids du corps, la sous-série reste sans weight.
create function private.set_sub(v jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case when jsonb_typeof(v) = 'array' then (
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'weight', private.sub_weight(x.v -> 'weight'),
      'reps',   private.sub_reps(x.v -> 'reps')
    )) order by x.n)
    from jsonb_array_elements(v) with ordinality as x(v, n)
    where x.n <= 6 and jsonb_typeof(x.v) = 'object'
      and private.sub_reps(x.v -> 'reps') is not null
      and (coalesce(jsonb_typeof(x.v -> 'weight'), 'null') = 'null' or private.sub_weight(x.v -> 'weight') is not null)
  ) end
$$;

-- Technique d'une série : { tech } ou { tech, sub }, null sinon (échauffement, technique inconnue, drop set
-- sans sous-série valide)
create function private.set_tech(st jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case
    when st -> 'warmup' = 'true'::jsonb then null
    when st -> 'tech' in ('"top"', '"backoff"') then jsonb_build_object('tech', st -> 'tech')
    when st -> 'tech' in ('"drop"', '"rp"', '"cluster"') and private.set_sub(st -> 'sub') is not null
      then jsonb_build_object('tech', st -> 'tech', 'sub', private.set_sub(st -> 'sub'))
  end
$$;

-- Prise d'un exercice : valeurs fixes de js/data/grips.js (GRIP_HAND, GRIP_WIDTH, GRIP_TOOL) ; null si rien
create function private.exercise_grip(v jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case when jsonb_typeof(v) = 'object' then nullif(jsonb_strip_nulls(jsonb_build_object(
    'hand',  case when v -> 'hand'  in ('"pronation"', '"supination"', '"neutre"', '"mixte"', '"crochet"') then v -> 'hand' end,
    'width', case when v -> 'width' in ('"serree"', '"moyenne"', '"large"') then v -> 'width' end,
    'tool',  case when v -> 'tool'  in ('"barre"', '"ez"', '"triangle"', '"poignees"', '"corde"', '"v"') then v -> 'tool' end
  )), '{}'::jsonb) end
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

-- Droits : fonctions internes, appelées seulement par session_public (elle-même appelée par les RPC
-- SECURITY DEFINER). create or replace garde les droits de session_public ; redits par prudence.
revoke all on function private.sub_weight(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.sub_reps(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.set_sub(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.set_tech(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.exercise_grip(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.session_public(jsonb) from public, anon, authenticated, service_role;
