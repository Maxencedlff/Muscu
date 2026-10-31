-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031100000_records_series.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide de retirer les records notés et les séries précisées).
--  Pas dans migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Effet : private.session_public reprend son texte de 20261027000000_supersets.sql et
--  private.session_for_coach celui de 20261027100000_coach.sql (plus de records, ni de warmup ni de
--  rir par série, pour les amis comme pour le coach) ; private.session_records et private.bounded_num
--  disparaissent ; les trois index et la clé primaire private.social_rate.id sont retirés. Aucune
--  donnée n'est touchée : les records notés restent dans sessions.data, ils ne sortent plus.
--  Après le retour arrière, l'app peut rester telle quelle (elle affiche les records s'ils arrivent).
--
--  Ordre : indépendant des migrations postérieures. Aucune d'elles n'appelle session_records ni
--  bounded_num ni ne lit social_rate.id ; celles qui appellent session_public ou session_for_coach
--  (reactions_profil, partage_coach) reçoivent la forme d'avant, sans casser. Peut donc être lancé
--  avec ou sans elles en place (vérifié des deux façons par tests/sql/rollback_nuit_check.sh).
-- ═══════════════════════════════════════════════════════════

begin;

-- Texte d'origine (20261027000000_supersets.sql)
create or replace function private.session_public(data jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select jsonb_strip_nulls(jsonb_build_object(
    'date',      private.scalar(data -> 'date'),
    'duration',  private.scalar(data -> 'duration'),
    'programme', private.scalar(data -> 'programme'),
    'category',  private.scalar(data -> 'category'),
    'label',     private.scalar(data -> 'label'),
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',    private.scalar(e.v -> 'name'),
        'measure', private.scalar(e.v -> 'measure'),
        'ss',      private.scalar(e.v -> 'ss'),
        'sets',    coalesce((
          select jsonb_agg(jsonb_build_object(
            'weight', private.scalar(st.v -> 'weight'),
            'reps',   private.scalar(st.v -> 'reps'),
            'dist',   private.scalar(st.v -> 'dist')
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

-- Texte d'origine (20261027100000_coach.sql)
create or replace function private.session_for_coach(id text, data jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select private.session_public(data) || jsonb_strip_nulls(jsonb_build_object(
    'id',     id,
    'notes',  case when jsonb_typeof(data -> 'notes') = 'string' then to_jsonb(left(data ->> 'notes', 2000)) end,
    'hidden', case when coalesce(data ->> 'hidden', '') = 'true' then true end
  ))
$$;

drop function private.session_records(jsonb, boolean);
drop function private.bounded_num(jsonb, numeric, numeric);

revoke all on function private.session_for_coach(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.session_public(jsonb) from public, anon, authenticated, service_role;

drop index public.coach_notes_student_coach;
drop index public.coach_programmes_student_coach;
drop index public.reports_target_user;
alter table private.social_rate drop column id;

commit;
