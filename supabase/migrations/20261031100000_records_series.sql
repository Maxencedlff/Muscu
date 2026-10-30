-- ═══════════════════════════════════════════════════════════
--  Records notés et séries précisées (31/10/2026) : la liste blanche d'une séance vue par un abonné
--  (private.session_public) et donc par le coach (private.session_for_coach, qui la recopie) garde
--  désormais :
--    - records : les records battus que l'app a notés dans la séance à son enregistrement
--      (js/data/records.js, sessionRecords), au plus 20, chaque élément revalidé ici :
--      { ex: texte (80 caractères au plus), kind: 'charge'|'reps'|'lest'|'aide'|'temps'|'duree'|
--        'distance'|'allure', before: nombre, after: nombre, w?: nombre, d?: 0.5|1|2|5|10 }.
--      Un élément invalide (type inconnu, nombre hors bornes, objet à la place d'un nom) est écarté ;
--      une clé inconnue d'un élément ne sort pas. Jamais le 1RM estimé : l'app ne le note pas, et le
--      type « 1rm » est refusé ici de toute façon. Champ absent (séance d'avant) : rien ne sort.
--    - par série, warmup (true seulement, absent sinon) et rir (entier 0 à 4, absent sinon) : un ami
--      ou un coach exclut l'échauffement du volume et des séries, le coach voit le RIR.
--  Rien d'autre ne change : mêmes fonctions, mêmes droits (create or replace les garde ; redits en
--  bas par prudence).
--
--  Signalés par controle-supabase (même migration) :
--    - index sur les clés étrangères qui n'en avaient pas : coach_notes (student_id, coach_id),
--      coach_programmes (student_id, coach_id) (suppression d'un lien : cascade sans parcours de la
--      table) et reports (target_user) (suppression d'un compte signalé) ;
--    - clé primaire sur private.social_rate (journal sans clé) : colonne id générée.
--
--  Réversible : remettre private.session_public de 20261027000000_supersets.sql, supprimer les trois
--  index et la colonne private.social_rate.id. Aucune donnée n'est modifiée par cette migration.
-- ═══════════════════════════════════════════════════════════

-- Nombre fini dans [lo, hi], sinon null
create function private.bounded_num(v jsonb, lo numeric, hi numeric) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between lo and hi then v end
$$;

-- Records notés d'une séance, revalidés : tableau (vide compris) ou null si le champ n'est pas un tableau
create function private.session_records(v jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case when jsonb_typeof(v) = 'array' then coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'ex',     to_jsonb(left(r.v ->> 'ex', 80)),
      'kind',   r.v -> 'kind',
      'before', r.v -> 'before',
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

create or replace function private.session_public(data jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select jsonb_strip_nulls(jsonb_build_object(
    'date',      private.scalar(data -> 'date'),
    'duration',  private.scalar(data -> 'duration'),
    'programme', private.scalar(data -> 'programme'),
    'category',  private.scalar(data -> 'category'),
    'label',     private.scalar(data -> 'label'),
    'records',   private.session_records(data -> 'records'),
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',    private.scalar(e.v -> 'name'),
        'measure', private.scalar(e.v -> 'measure'),
        'ss',      private.scalar(e.v -> 'ss'),
        'sets',    coalesce((
          select jsonb_agg(jsonb_build_object(
            'weight', private.scalar(st.v -> 'weight'),
            'reps',   private.scalar(st.v -> 'reps'),
            'dist',   private.scalar(st.v -> 'dist'),
            'warmup', case when st.v -> 'warmup' = 'true'::jsonb then true end,
            'rir',    case when st.v -> 'rir' in ('0', '1', '2', '3', '4') then st.v -> 'rir' end
          ) order by st.n)
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

-- Droits : fonctions internes, appelées seulement par les RPC SECURITY DEFINER
revoke all on function private.bounded_num(jsonb, numeric, numeric) from public, anon, authenticated, service_role;
revoke all on function private.session_records(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.session_public(jsonb) from public, anon, authenticated, service_role;

-- ── Index et clé primaire (controle-supabase) ────────────
create index coach_notes_student_coach on public.coach_notes (student_id, coach_id);
create index coach_programmes_student_coach on public.coach_programmes (student_id, coach_id);
create index reports_target_user on public.reports (target_user);
alter table private.social_rate add column id bigint generated always as identity primary key;
