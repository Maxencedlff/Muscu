-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261116010000_charge_prescrite.sql (à lancer à la main, dans
--  l'éditeur SQL, sur décision de Maxence). Pas dans migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Effet : private.session_for_coach reprend son texte de 20261031100000_records_series.sql (plus de presc) ;
--  private.session_presc et private.exercise_presc disparaissent. Aucune donnée n'est touchée : la
--  prescription reste dans sessions.data, elle ne sort plus. L'app peut rester telle quelle (le coach ne
--  voit plus l'écart, l'élève garde ses charges prescrites).
--  Ordre : indépendant, à lancer AVANT le retour arrière des records (20261031100000).
-- ═══════════════════════════════════════════════════════════

begin;

create or replace function private.session_for_coach(id text, data jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select private.session_public(data) || jsonb_strip_nulls(jsonb_build_object(
    'id',      id,
    'notes',   case when jsonb_typeof(data -> 'notes') = 'string' then to_jsonb(left(data ->> 'notes', 2000)) end,
    'hidden',  case when coalesce(data ->> 'hidden', '') = 'true' then true end,
    'records', private.session_records(data -> 'records', true)
  ))
$$;
revoke all on function private.session_for_coach(text, jsonb) from public, anon, authenticated, service_role;

drop function private.session_presc(jsonb);
drop function private.exercise_presc(jsonb);

commit;
