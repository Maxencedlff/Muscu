-- ═══════════════════════════════════════════════════════════
--  Progression des élèves vue d'un coup d'œil (06/11/2026, audit d'ergonomie : « le coach voit quel
--  élève a progressé en 2 secondes »). Contrat : docs/COACH_SUIVI.md, « Progression des élèves ».
--
--  Ce qui manquait : coach_state() donne la dernière séance et le nombre de séances sur 7 jours, mais
--  pas les records. Ils sont notés dans chaque séance (migration 20261031100000_records_series.sql) et
--  le coach les lit déjà, séance par séance (coach_student_sessions, 30 par page). Pour la liste Mes
--  élèves, il faudrait une page de séances par élève : trop lourd. coach_progress() donne en un appel,
--  pour tous mes élèves, le strict nécessaire aux règles de l'app (js/data/coach-progress.js) :
--    - sessions : les séances des 35 derniers jours (80 au plus), { at, records } du plus récent ;
--      records = records notés AVEC la valeur d'avant (private.session_records(v, true), comme
--      coach_student_sessions), ou null si la séance vient d'une app d'avant les records notés ;
--    - first_at : la plus ancienne séance des 182 derniers jours ;
--    - last_record_at : la dernière séance des 182 derniers jours qui a au moins un record noté valable ;
--    - unnoted_at : la dernière séance des 182 derniers jours sans records notés (app d'avant) : l'app ne
--      dit jamais « stable » sur une période qu'elle ne peut pas juger.
--  Rien d'autre ne sort : ni exercices, ni notes, ni poids du corps. Ce sont des données que le coach voit
--  déjà dans coach_student_sessions (même liste blanche pour les records, mêmes séances : non supprimées,
--  datées, au plus 24 h dans le futur, masquées aux abonnés comprises).
--
--  Sécurité : lecture seule, security definer, search_path vide, utilisateur pris dans auth.uid(),
--  authenticated seulement (anon n'exécute rien). Mes élèves seulement (coach_links.coach_id = moi), et
--  seulement si j'ai encore le rôle de coach (private.is_coach) : sinon { students: [] }. Aucune table
--  nouvelle, aucune écriture.
--
--  Coût : un parcours de l'index sessions_user_done (user_id, done_at desc, id desc) par élève, borné à
--  182 jours ; 50 élèves au plus par coach.
--
--  Réversible : supabase/rollback/20261106000000_coach_progression_down.sql (rien n'est effacé).
--  Une app à jour sur un serveur sans cette fonction (PGRST202) lit les séances des élèves page par page
--  (js/data/coach-progress.js) ; une app d'avant n'appelle jamais cette fonction.
-- ═══════════════════════════════════════════════════════════

create function public.coach_progress() returns jsonb
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

-- ── Droits ───────────────────────────────────────────────

revoke all on function public.coach_progress() from public, anon, authenticated;
grant execute on function public.coach_progress() to authenticated;
