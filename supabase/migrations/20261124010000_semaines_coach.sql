-- Fiche « Semaines » de l'appli web du coach (docs/COACH_WEB.md), 24/11/2026. ÉCRITE, PAS APPLIQUÉE.
--
-- coach_student_weeks(student, weeks) rend en un seul appel tout ce dont la fiche a besoin, pour un élève de ce coach :
--   { weeks, from, sessions: [{ id, done_at, s }], weights, measures, diet }
-- Rien de nouveau n'est exposé : chaque partie est exactement ce que rendent déjà les fonctions existantes, avec les
-- mêmes vérifications (private.coach_require_student : mon élève, et je suis encore coach) :
--   - sessions : même requête et même liste blanche que coach_student_sessions (private.session_for_coach, poids du
--     corps seulement avec le consentement : private.coach_session_body), sur la fenêtre demandée au lieu de 30 par page,
--     150 séances au plus ; sans le commentaire du coach (la fiche ne s'en sert pas) ;
--   - weights : public.coach_student_weights(student) ;
--   - measures : public.coach_student_measures(student), null si le serveur ne l'a pas ;
--   - diet : public.coach_student_diet(student), null si la migration 20261118010000_suivi_diete_coach.sql n'est pas
--     appliquée (appel dynamique : cette migration-ci s'applique avant ou après elle).
-- weeks : 1 à 26 (12 par défaut) ; la fenêtre commence au lundi d'il y a (weeks - 1) semaines, un jour plus tôt pour
-- les fuseaux à l'est d'UTC (l'appli coupe au jour près dans le fuseau du coach).
-- Sans cette fonction (PGRST202), l'appli web fait les mêmes lectures une par une (js/desk/api.js, deskLoadWeeks).
-- Retour arrière : supabase/rollback/20261124010000_semaines_coach_down.sql. Tests : tests/sql/semaines_coach_test.sql.

create or replace function public.coach_student_weeks(student uuid, weeks integer default 12) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  w integer := least(greatest(coalesce(weeks, 12), 1), 26);
  from_ms bigint;
  measures jsonb := null;
  diet jsonb := null;
begin
  perform private.coach_require_student(me, student);
  from_ms := (extract(epoch from (date_trunc('week', now()) - make_interval(weeks => w - 1) - interval '1 day')) * 1000)::bigint;
  if to_regprocedure('public.coach_student_measures(uuid)') is not null then
    execute 'select public.coach_student_measures($1)' into measures using student;
  end if;
  if to_regprocedure('public.coach_student_diet(uuid)') is not null then
    execute 'select public.coach_student_diet($1)' into diet using student;
  end if;
  return jsonb_build_object(
    'weeks', w,
    'from', from_ms,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'done_at', x.done_at,
               's', private.session_for_coach(x.id, x.data) || private.coach_session_body(me, student, x.done_at))
             order by x.done_at desc, x.id desc)
      from (select y.id, y.done_at, y.data from public.sessions y
            where y.user_id = student and y.deleted_at is null and y.done_at is not null
              and y.done_at >= from_ms and y.done_at <= private.max_done_at()
            order by y.done_at desc, y.id desc
            limit 150) x), '[]'::jsonb),
    'weights', public.coach_student_weights(student),
    'measures', measures,
    'diet', diet);
end
$$;
revoke all on function public.coach_student_weeks(uuid, integer) from public, anon, authenticated;
grant execute on function public.coach_student_weeks(uuid, integer) to authenticated;
