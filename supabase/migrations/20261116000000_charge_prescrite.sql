-- ═══════════════════════════════════════════════════════════
--  Charge prescrite par le coach (16/11/2026, docs/COACH_V1.md « Charge prescrite ») : la séance d'un élève
--  vue par SON coach (private.session_for_coach) transmet en plus, pour chaque exercice, ce que le coach
--  avait prescrit, pour qu'il voie l'écart entre prescrit et fait (« Prescrit 60 kg × 8 · série 1 à
--  62,5 kg »).
--    - presc : tableau aligné sur exercises (même filtre que private.session_public : objets, 60 au plus),
--      chaque élément null ou { kg: [nombre de 0 à 500 | null, une valeur par série, 100 au plus],
--      lo?: entier de 1 à 100, hi?: entier de 1 à 100 } ; une clé inconnue ne sort pas, une valeur hors
--      bornes devient null. Absent si aucun exercice n'a de prescription (séances d'avant, programmes à soi).
--    - Le coach seulement : private.session_public (fil des amis, Mon profil) ne change pas.
--  Le programme envoyé (coach_programmes.data) ne change pas de contrôle : objet JSON de 200 Ko au plus,
--  validé par l'app (load, loads facultatifs) ; aucune modification de coach_send_programme.
--
--  Sans cette migration : l'app marche, l'élève a ses charges prescrites ; seul l'écart n'apparaît pas
--  chez le coach (le champ ne lui parvient pas).
--  Réversible : supabase/rollback/20261116000000_charge_prescrite_down.sql (texte de 20261031100000).
--  Aucune donnée n'est modifiée.
-- ═══════════════════════════════════════════════════════════

-- Prescription d'un exercice de séance, revalidée : objet ou null
create function private.exercise_presc(v jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select case when jsonb_typeof(v) = 'object' and jsonb_typeof(v -> 'kg') = 'array' then jsonb_strip_nulls(jsonb_build_object(
    'kg', (select coalesce(jsonb_agg(private.bounded_num(k.v, 0, 500) order by k.n), '[]'::jsonb)
           from jsonb_array_elements(v -> 'kg') with ordinality as k(v, n) where k.n <= 100),
    'lo', case when jsonb_typeof(v -> 'lo') = 'number' and (v ->> 'lo')::numeric between 1 and 100 and (v ->> 'lo')::numeric = trunc((v ->> 'lo')::numeric) then v -> 'lo' end,
    'hi', case when jsonb_typeof(v -> 'hi') = 'number' and (v ->> 'hi')::numeric between 1 and 100 and (v ->> 'hi')::numeric = trunc((v ->> 'hi')::numeric) then v -> 'hi' end
  )) end
$$;

-- Prescriptions d'une séance, alignées sur private.session_public(data) -> 'exercises' ; null sans aucune
create function private.session_presc(data jsonb) returns jsonb
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

-- Séance vue par le coach : comme 20261031100000_records_series.sql, avec en plus presc
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

-- Droits : fonctions internes, appelées seulement par les RPC SECURITY DEFINER
revoke all on function private.exercise_presc(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.session_presc(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.session_for_coach(text, jsonb) from public, anon, authenticated, service_role;
