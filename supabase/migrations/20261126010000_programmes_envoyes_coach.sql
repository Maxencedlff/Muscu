-- Appli web du coach, vague 4 (docs/COACH_WEB.md, « Programme » et « Nutrition »), 25/11/2026. ÉCRITE, PAS APPLIQUÉE.
--
-- coach_student_programmes(student) : ce que CE coach a envoyé à CET élève (programmes et plans diète, table
-- public.coach_programmes), pour que l'éditeur des séances en grand écran parte de la version que l'élève a reçue,
-- et que l'onglet Nutrition montre le plan diète envoyé :
--   [{ id, data, sent_at, seen }]   du plus récent au plus ancien, 40 au plus
-- Rien de nouveau n'est exposé : chaque ligne a été écrite par ce coach (coach_send_programme), et coach_state lui
-- rend déjà id, sent_at et seen (champ sent) ; seule la donnée envoyée revient en plus.
--   - mêmes vérifications que les autres lectures du coach : private.coach_require_student (mon élève, et je suis
--     encore coach), sinon not_found ;
--   - seulement les lignes de ce coach (coach_id = moi) : un élève qui change de coach ne montre jamais au nouveau ce
--     que l'ancien avait envoyé (le lien rompu efface déjà ces lignes en cascade) ;
--   - plan diète retiré par l'élève (accord « diet » décoché) : la ligne est déjà effacée par le déclencheur de
--     20261106200000_plans_diete_coach.sql, elle ne revient donc pas ;
--   - 600 lectures par heure (comme chat_threads).
-- Aucune table, aucun droit de table nouveau. Sans cette fonction (PGRST202), l'appli web lit la version de ton
-- programme gardée sur ton compte (profiles.doc, lecture du propriétaire seulement) : rien ne casse.
-- Retour arrière : supabase/rollback/20261126010000_programmes_envoyes_coach_down.sql.
-- Tests : tests/sql/programmes_envoyes_coach_test.sql, tests/sql/programmes_envoyes_coach_rollback_test.sh.

create or replace function public.coach_student_programmes(student uuid) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
begin
  perform private.coach_require_student(me, student);
  perform private.rate_limit_window(me, 'coach_progs_read', 600, interval '1 hour');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'data', x.data, 'sent_at', x.sent_at, 'seen', x.seen_at is not null)
           order by x.sent_at desc, x.id)
    from (select p.id, p.data, p.sent_at, p.seen_at from public.coach_programmes p
          where p.student_id = student and p.coach_id = me
          order by p.sent_at desc, p.id
          limit 40) x), '[]'::jsonb);
end
$$;
revoke all on function public.coach_student_programmes(uuid) from public, anon, authenticated;
grant execute on function public.coach_student_programmes(uuid) to authenticated;
