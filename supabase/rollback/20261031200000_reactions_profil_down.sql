-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031200000_reactions_profil.sql (à lancer à la main,
--  dans l'éditeur SQL, seulement si Maxence décide d'annuler les réactions). Pas dans migrations/ :
--  Supabase ne l'applique jamais de lui-même.
--
--  Effet : chaque réaction redevient un bravo (la ligne reste, sa sorte est oubliée) ; « qui a réagi »,
--  l'activité, la pastille et « mes séances » disparaissent ; feed et social_state reprennent
--  exactement leur forme de 20261026050000_social.sql. toggle_bravo et my_bravos n'ont jamais changé.
--  Vérifié par tests/sql/rollback_check.sh (migrations, retour arrière, puis les tests du social d'origine).
--  Après le retour arrière, l'app doit revenir à une version qui n'appelle pas set_reaction.
-- ═══════════════════════════════════════════════════════════

begin;

create or replace function public.social_state() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id)
  select jsonb_build_object(
    'enabled',    coalesce(p.social_at is not null, false),
    'username',   p.username,
    'avatar',     p.avatar_emoji,
    'pending_in', coalesce((select jsonb_agg(private.person(f.follower_id, f.created_at) order by f.created_at desc)
                            from public.follows f where f.followee_id = me.id and f.status = 'pending'
                              and not private.blocked_between(me.id, f.follower_id)), '[]'::jsonb),
    'following',  coalesce((select jsonb_agg(private.person(f.followee_id, f.responded_at) order by f.responded_at desc)
                            from public.follows f where f.follower_id = me.id and f.status = 'accepted'
                              and not private.blocked_between(me.id, f.followee_id)), '[]'::jsonb),
    'followers',  coalesce((select jsonb_agg(private.person(f.follower_id, f.responded_at) order by f.responded_at desc)
                            from public.follows f where f.followee_id = me.id and f.status = 'accepted'
                              and not private.blocked_between(me.id, f.follower_id)), '[]'::jsonb),
    'requested',  coalesce((select jsonb_agg(private.person(f.followee_id, f.created_at) order by f.created_at desc)
                            from public.follows f where f.follower_id = me.id and f.status in ('pending', 'ghost')), '[]'::jsonb),
    'blocked',    coalesce((select jsonb_agg(private.person(k.blocked_id, k.created_at, true) order by k.created_at desc)
                            from public.blocks k where k.blocker_id = me.id), '[]'::jsonb),
    'badge',      (select count(*)::int from public.follows f where f.followee_id = me.id and f.status = 'pending'
                     and not private.blocked_between(me.id, f.follower_id))
  )
  from me left join public.user_profiles p on p.user_id = me.id
$$;

drop function public.feed(bigint, uuid, text, uuid);
create function public.feed(before_at bigint default null, before_owner uuid default null,
                            before_id text default null, only_user uuid default null)
  returns table (owner uuid, username text, avatar text, id text, done_at bigint, s jsonb, bravos int, my_bravo boolean)
  language sql stable security definer set search_path = '' as
$$
  with me as (
    select u.id, private.max_done_at() as max_at
    from (select (select auth.uid()) as id) u
    -- Le social de l'appelant est requis (private.can_see)
    where exists (select 1 from public.user_profiles mp where mp.user_id = u.id and mp.social_at is not null)
  ),
  seen as (
    -- private.can_see : abonnement accepté, social activé de l'autre côté, aucun blocage
    select f.followee_id as uid, op.username, op.avatar_emoji
    from me
    join public.follows f on f.follower_id = me.id and f.status = 'accepted'
    join public.user_profiles op on op.user_id = f.followee_id and op.social_at is not null
    where (only_user is null or f.followee_id = only_user)
      and not exists (select 1 from public.blocks k
                      where (k.blocker_id = me.id and k.blocked_id = f.followee_id)
                         or (k.blocker_id = f.followee_id and k.blocked_id = me.id))
  ),
  page as (
    select seen.uid, seen.username, seen.avatar_emoji, c.id, c.done_at, c.data
    from me, seen
    cross join lateral (
      -- private.session_shown : non supprimée, datée, pas dans le futur lointain, non masquée
      select x.id, x.done_at, x.data
      from public.sessions x
      where x.user_id = seen.uid and x.deleted_at is null and x.done_at is not null
        and x.done_at <= least(coalesce(before_at, 9223372036854775807), me.max_at)
        and coalesce(x.data ->> 'hidden', '') <> 'true'
        and (before_at is null
             or x.done_at < before_at
             or (before_owner is not null and before_id is not null
                 and (x.user_id, x.id) < (before_owner, before_id)))
      order by x.done_at desc, x.id desc
      limit 20
    ) c
    order by c.done_at desc, seen.uid desc, c.id desc
    limit 20
  )
  select pg.uid, pg.username, pg.avatar_emoji, pg.id, pg.done_at, private.session_public(pg.data),
    (select count(*)::int from public.bravos b where b.session_owner = pg.uid and b.session_id = pg.id),
    exists (select 1 from public.bravos b
            where b.session_owner = pg.uid and b.session_id = pg.id and b.user_id = (select id from me))
  from page pg
  order by pg.done_at desc, pg.uid desc, pg.id desc
$$;

drop function public.set_reaction(uuid, text, text);
drop function public.my_reactions();
drop function public.session_reactions(text);
drop function public.my_activity(timestamptz);
drop function public.mark_activity_seen();
drop function public.my_shown_sessions(bigint, text);
drop function private.activity_new(uuid);
drop function private.activity_seen(uuid);
drop function private.reaction_top(jsonb);
drop function private.reaction_total(jsonb);
drop function private.reaction_counts(uuid, text);

drop index public.bravos_owner_updated;
alter table public.bravos drop column kind, drop column updated_at;
alter table public.user_profiles drop column activity_seen_at;

revoke all on function public.feed(bigint, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.social_state() from public, anon, authenticated;
grant execute on function public.feed(bigint, uuid, text, uuid) to authenticated;
grant execute on function public.social_state() to authenticated;

commit;
