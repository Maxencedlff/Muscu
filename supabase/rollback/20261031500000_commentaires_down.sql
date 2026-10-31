-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031500000_commentaires.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide d'annuler les commentaires). Pas dans migrations/ :
--  Supabase ne l'applique jamais de lui-même. Si le chat coach est en place, lancer d'abord
--  20261031510000_chat_coach_down.sql (ordre inverse des migrations), même s'ils sont indépendants.
--
--  Effet : commentaires, signalements de commentaires et liste des mots interdits supprimés
--  (définitivement : exporter comment_reports avant si une enquête est en cours) ; my_activity et
--  private.activity_new reprennent exactement leur forme de 20261031200000_reactions_profil.sql.
--  Vérifié par tests/sql/rollback_social_check.sh (migrations, données, retour arrière, puis tous les
--  tests d'avant les commentaires et le chat).
--  Après le retour arrière, l'app doit revenir à une version qui n'appelle pas list_comments
--  (une app à jour affiche alors « Commentaires indisponibles » sans rien casser).
-- ═══════════════════════════════════════════════════════════

begin;

drop function public.list_comments(uuid, text, bigint);
drop function public.add_comment(uuid, text, text);
drop function public.delete_comment(bigint);
drop function public.report_comment(bigint, text);

-- Activité : forme de 20261031200000_reactions_profil.sql (type de retour d'origine)
drop function public.my_activity(timestamptz, text);
create function public.my_activity(before_at timestamptz default null, before_key text default null)
  returns table (kind text, user_id uuid, username text, avatar text, at timestamptz, reaction text,
                 session_id text, session_label text, session_at bigint, is_new boolean)
  language plpgsql security definer set search_path = '' as
$$
#variable_conflict use_column
declare
  me uuid := (select auth.uid());
  seen timestamptz;
begin
  if me is null or not private.social_on(me) then return; end if;
  perform private.rate_limit_window(me, 'activity', 120, interval '1 hour');
  seen := private.activity_seen(me);
  return query
    select a.kind, a.uid, p.username, p.avatar_emoji, a.at, a.reaction, a.sid, a.label, a.sat,
      coalesce(a.kind in ('reaction', 'accepted') and a.at > seen, false)
    from (
      select 'reaction'::text as kind, b.user_id as uid, b.updated_at as at, b.kind as reaction, b.session_id as sid,
        case when jsonb_typeof(x.data -> 'label') = 'string' then left(x.data ->> 'label', 60) end as label, x.done_at as sat
      from public.bravos b
      join public.sessions x on x.user_id = b.session_owner and x.id = b.session_id and x.deleted_at is null
      where b.session_owner = me and private.can_see(b.user_id, me)
      union all
      select 'follower', f.follower_id, f.responded_at, null, null, null, null
      from public.follows f
      join public.user_profiles op on op.user_id = f.follower_id and op.social_at is not null
      where f.followee_id = me and f.status = 'accepted' and f.responded_at is not null
        and not private.blocked_between(me, f.follower_id)
      union all
      select 'accepted', f.followee_id, f.responded_at, null, null, null, null
      from public.follows f
      join public.user_profiles op on op.user_id = f.followee_id and op.social_at is not null
      where f.follower_id = me and f.status = 'accepted' and f.responded_at is not null
        and not private.blocked_between(me, f.followee_id)
      union all
      select 'request', f.follower_id, f.created_at, null, null, null, null
      from public.follows f
      where f.followee_id = me and f.status = 'pending'
        and not private.blocked_between(me, f.follower_id)
    ) a
    left join public.user_profiles p on p.user_id = a.uid
    where my_activity.before_at is null or a.at < my_activity.before_at
       or (my_activity.before_key is not null and a.at = my_activity.before_at
           and (a.kind || ':' || a.uid::text || ':' || coalesce(a.sid, '')) collate "C" > my_activity.before_key collate "C")
    order by a.at desc, (a.kind || ':' || a.uid::text || ':' || coalesce(a.sid, '')) collate "C"
    limit 50;
end
$$;

create or replace function private.activity_new(uid uuid) returns int
  language sql stable set search_path = '' as
$$
  with seen as (select private.activity_seen(uid) as at)
  select case when not private.social_on(uid) then 0 else (
    (select count(*)::int from seen, public.bravos b
       join public.sessions x on x.user_id = b.session_owner and x.id = b.session_id and x.deleted_at is null
     where b.session_owner = uid and b.updated_at > seen.at and private.can_see(b.user_id, uid))
    + (select count(*)::int from seen, public.follows f
       join public.user_profiles op on op.user_id = f.followee_id and op.social_at is not null
     where f.follower_id = uid and f.status = 'accepted' and f.responded_at > seen.at
       and not private.blocked_between(uid, f.followee_id))
  ) end
$$;

drop function private.comment_row(public.session_comments, uuid);
drop table public.comment_reports;
drop table public.session_comments;
drop table private.comment_words;
drop function private.comment_report_before_insert();
drop function private.comment_shown(uuid, uuid, uuid, timestamptz);
drop function private.comments_writable(uuid, uuid, text);
drop function private.comments_readable(uuid, uuid, text);
drop function private.comment_clean(text);
drop function private.comment_forbidden(text);
drop function private.comment_squeeze(text);
drop function private.comment_norm(text);

revoke all on function private.activity_new(uuid) from public, anon, authenticated, service_role;
revoke all on function public.my_activity(timestamptz, text) from public, anon, authenticated;
grant execute on function public.my_activity(timestamptz, text) to authenticated;

commit;
