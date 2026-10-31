-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031300000_partage_coach.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide de retirer le partage avec le coach). Pas dans
--  migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Avant : revenir à une version de l'app qui n'appelle plus student_shares, student_set_share,
--  student_share_weights ni coach_student_weights (sinon l'écran Partage affiche une erreur).
--
--  Effet : les consentements (public.coach_shares) et les pesées partagées
--  (public.coach_shared_weights) sont SUPPRIMÉS, historique compris : le coach ne voit plus aucune
--  pesée, ce qui respecte le retrait du consentement. coach_student_sessions reprend son texte de
--  20261027100000_coach.sql (plus de bodyKg). Les lignes « coach_share » et « coach_share_up » du
--  journal private.social_rate sont retirées.
--
--  Ordre : indépendant des migrations postérieures (aucune n'appelle ces fonctions ni ne lit ces
--  tables). Peut être lancé avec ou sans elles en place (vérifié par tests/sql/rollback_nuit_check.sh).
-- ═══════════════════════════════════════════════════════════

begin;

-- Texte d'origine (20261027100000_coach.sql) : d'abord, car la version du partage appelle
-- private.coach_session_body (plpgsql ne suit pas cette dépendance)
create or replace function public.coach_student_sessions(student uuid, before_at bigint default null, before_id text default null)
  returns table (id text, done_at bigint, s jsonb, note text)
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  perform private.coach_require_student(me, student);
  return query
    select x.id, x.done_at, private.session_for_coach(x.id, x.data), n.text
    from public.sessions x
    left join public.coach_notes n on n.student_id = x.user_id and n.session_id = x.id and n.coach_id = me
    where x.user_id = student and x.deleted_at is null and x.done_at is not null
      and x.done_at <= private.max_done_at()
      and (before_at is null
           or x.done_at < before_at
           or (before_id is not null and x.done_at = before_at and x.id < before_id))
    order by x.done_at desc, x.id desc
    limit 30;
end
$$;
revoke all on function public.coach_student_sessions(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.coach_student_sessions(uuid, bigint, text) to authenticated;

drop function public.student_shares();
drop function public.student_set_share(text, boolean);
drop function public.student_share_weights(jsonb);
drop function public.coach_student_weights(uuid);
drop function private.coach_session_body(uuid, uuid, bigint);
drop function private.coach_has_share(uuid, uuid, text);
drop function private.share_kind_open(text);

drop table public.coach_shared_weights;
drop table public.coach_shares;

delete from private.social_rate r where r.action in ('coach_share', 'coach_share_up');

commit;
