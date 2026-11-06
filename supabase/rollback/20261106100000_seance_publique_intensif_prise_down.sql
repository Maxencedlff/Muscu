-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261106100000_seance_publique_intensif_prise.sql (à lancer à la
--  main, dans l'éditeur SQL, sur décision de Maxence). Pas dans migrations/ : Supabase ne l'applique jamais
--  de lui-même.
--
--  Effet : private.session_public reprend son texte de 20261031100000_records_series.sql (plus de tech ni
--  de sub par série, plus de grip par exercice, pour les amis comme pour le coach) ; private.sub_weight,
--  private.sub_reps, private.set_sub, private.set_tech et private.exercise_grip disparaissent. Aucune
--  donnée n'est touchée : les champs restent dans sessions.data, ils ne sortent plus. L'app peut rester
--  telle quelle (elle affiche ces champs seulement s'ils arrivent).
--
--  Ordre : indépendant. Aucune autre migration n'appelle les cinq fonctions retirées ; private.session_for_coach
--  appelle session_public et reçoit la forme d'avant, sans casser. À lancer AVANT le retour arrière des
--  records (20261031100000), dont il remet le texte.
-- ═══════════════════════════════════════════════════════════

begin;

-- Texte d'origine (20261031100000_records_series.sql)
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

drop function private.set_tech(jsonb);
drop function private.set_sub(jsonb);
drop function private.sub_reps(jsonb);
drop function private.sub_weight(jsonb);
drop function private.exercise_grip(jsonb);

revoke all on function private.session_public(jsonb) from public, anon, authenticated, service_role;

commit;
