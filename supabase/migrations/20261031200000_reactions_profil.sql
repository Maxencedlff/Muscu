-- ═══════════════════════════════════════════════════════════
--  Social V1.1 : réactions, « qui a réagi », Mon profil et son activité (contrat : docs/SOCIAL_V1.md,
--  section « Réactions et Mon profil »). 20261026050000_social.sql est déjà en production : elle ne
--  change pas, tout le changement est ici. Retour arrière : supabase/rollback/20261031200000_reactions_profil_down.sql.
--
--  - Réactions : la table bravos devient la table des réactions. Une colonne kind (liste fermée :
--    clap 👏, fire 🔥, strong 💪, trophy 🏆, wow 😮 ; pas de texte libre, rien à modérer) et une colonne
--    updated_at (dernière pose ou changement, pour l'activité). Les bravos existants deviennent des
--    👏 par la valeur par défaut de kind : aucune ligne n'est recopiée, rien ne se perd, et le retour
--    arrière n'est qu'un « drop column ». Clé primaire inchangée : une seule réaction par personne et
--    par séance (changeable, retirable).
--  - Compatibilité des anciennes versions de l'app : toggle_bravo et my_bravos ne changent pas
--    (toggle_bravo pose un 👏, ou retire ma réaction quelle qu'elle soit). feed garde ses colonnes
--    (bravos = nombre de réactions, my_bravo = j'ai réagi) et en gagne deux à la fin (reactions,
--    my_reaction) : une ancienne app les ignore.
--  - Une réaction compte tant que son auteur voit la séance (private.can_see(auteur, propriétaire) :
--    abonnement accepté, social activé des deux côtés, aucun blocage). Un abonné retiré, désabonné ou
--    bloqué disparaît des comptes et de la liste « qui a réagi » ; sa ligne reste (elle repart avec
--    le blocage, comme avant, ou revient s'il est de nouveau accepté). Seule exception : my_bravos,
--    gardée telle quelle pour les anciennes versions.
--  - Qui a réagi : session_reactions(session_id) seulement sur MES séances, seulement les personnes
--    que j'ai acceptées (règle ci-dessus). Personne ne voit qui a réagi aux séances des autres.
--  - Activité : my_activity() liste, du plus récent au plus ancien, les réactions à mes séances, mes
--    nouveaux abonnés, mes demandes acceptées et les demandes reçues. Vu côté serveur :
--    user_profiles.activity_seen_at, posé seulement par mark_activity_seen (aucun GRANT par colonne).
--    social_state() renvoie activity_new (réactions et demandes acceptées plus récentes que
--    activity_seen_at, ou que l'activation du social) et shown_sessions (mes séances visibles).
--    Un nouvel abonné ne compte pas dans activity_new : c'est moi qui l'ai accepté.
--  - Mes séances telles que les autres les voient : my_shown_sessions(), même liste blanche
--    (private.session_public) et mêmes règles d'affichage (private.session_shown) que le fil.
--  - Limites : 200 réactions posées ou changées par 24 h (même compteur 'bravo' que toggle_bravo :
--    passer d'une fonction à l'autre ne contourne rien) ; lectures bornées par heure (my_activity et
--    my_shown_sessions 120, session_reactions et my_reactions 300, mark_activity_seen 120).
--  - Erreurs lisibles (P0001) : invalid_reaction (réaction hors liste), not_found, rate_limited.
--  - Sécurité : RPC security definer, search_path vide, utilisateur pris dans auth.uid(), anon n'a
--    rien, chaque RPC perd le droit d'exécution de public et anon puis seul authenticated le reçoit.
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- Réaction : 👏 par défaut (bravos existants et toggle_bravo des anciennes versions)
alter table public.bravos
  add column kind text not null default 'clap'
    constraint bravos_kind check (kind in ('clap', 'fire', 'strong', 'trophy', 'wow')),
  add column updated_at timestamptz not null default now();
-- Bravos d'avant : leur date d'origine (pas celle de la migration, sinon ils seraient tous « nouveaux »)
update public.bravos set updated_at = created_at;
-- Activité et pastille : réactions reçues, des plus récentes aux plus anciennes
create index bravos_owner_updated on public.bravos (session_owner, updated_at desc);

-- Activité vue jusqu'à : pas de GRANT par colonne (le client n'écrit que username et avatar_emoji)
alter table public.user_profiles add column activity_seen_at timestamptz;

-- ── Briques privées ──────────────────────────────────────

-- Réactions d'une séance qui comptent (auteur qui voit encore la séance), par sorte : { clap: 2, fire: 1 }
create function private.reaction_counts(owner uuid, sid text) returns jsonb
  language sql stable set search_path = '' as
$$
  select coalesce(jsonb_object_agg(t.kind, t.n), '{}'::jsonb)
  from (select b.kind, count(*)::int as n
        from public.bravos b
        where b.session_owner = owner and b.session_id = sid and private.can_see(b.user_id, owner)
        group by b.kind) t
$$;

-- Total d'un objet de comptes
create function private.reaction_total(counts jsonb) returns int
  language sql immutable set search_path = '' as
$$ select coalesce(sum(v.value::int), 0)::int from jsonb_each_text(coalesce(counts, '{}'::jsonb)) v $$;

-- Réaction la plus fréquente ; à égalité, la première de la liste (👏, 🔥, 💪, 🏆, 😮)
create function private.reaction_top(counts jsonb) returns text
  language sql immutable set search_path = '' as
$$
  select v.key from jsonb_each_text(coalesce(counts, '{}'::jsonb)) v
  order by v.value::int desc, array_position(array['clap', 'fire', 'strong', 'trophy', 'wow'], v.key)
  limit 1
$$;

-- Activité vue jusqu'à : activity_seen_at, sinon l'activation du social (rien d'avant n'est « nouveau »)
create function private.activity_seen(uid uuid) returns timestamptz
  language sql stable set search_path = '' as
$$ select coalesce(p.activity_seen_at, p.social_at) from public.user_profiles p where p.user_id = uid $$;

-- Nouveautés de l'activité : réactions à mes séances et demandes acceptées, plus récentes que l'activité vue
create function private.activity_new(uid uuid) returns int
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

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- Poser, changer ou retirer (kind null) ma réaction, seulement sur une séance que feed me montrerait
-- (sinon not_found, y compris mes propres séances). Réaction hors liste : invalid_reaction. Poser ou
-- changer compte dans la limite des 200 par 24 h (compteur 'bravo', partagé avec toggle_bravo) ;
-- reposer la même réaction ou retirer ne compte pas. Renvoie { bravos, mine, my_reaction, reactions }.
create function public.set_reaction(owner uuid, session_id text, kind text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  cur text;
  counts jsonb;
begin
  if set_reaction.kind is not null and set_reaction.kind not in ('clap', 'fire', 'strong', 'trophy', 'wow') then
    raise exception 'invalid_reaction' using errcode = 'P0001';
  end if;
  if not private.can_see(me, set_reaction.owner) or not exists (
    select 1 from public.sessions x
    where x.user_id = set_reaction.owner and x.id = set_reaction.session_id
      and private.session_shown(x.data, x.deleted_at, x.done_at)
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select b.kind into cur from public.bravos b
    where b.session_owner = set_reaction.owner and b.session_id = set_reaction.session_id and b.user_id = me
    for update;
  if set_reaction.kind is null then
    delete from public.bravos b
      where b.session_owner = set_reaction.owner and b.session_id = set_reaction.session_id and b.user_id = me;
  elsif cur is distinct from set_reaction.kind then
    perform private.rate_limit(me, 'bravo', 200);
    insert into public.bravos as b (session_owner, session_id, user_id, kind, updated_at)
      values (set_reaction.owner, set_reaction.session_id, me, set_reaction.kind, now())
      on conflict on constraint bravos_pkey
      do update set kind = excluded.kind, updated_at = excluded.updated_at;
  end if;
  counts := private.reaction_counts(set_reaction.owner, set_reaction.session_id);
  return jsonb_build_object(
    'bravos', private.reaction_total(counts),
    'mine', set_reaction.kind is not null,
    'my_reaction', set_reaction.kind,
    'reactions', counts);
end
$$;

-- Fil : comme 20261026050000_social.sql (mêmes règles, même curseur, mêmes performances), avec en plus
-- reactions (comptes par sorte, private.reaction_counts) et my_reaction (la mienne, ou null).
-- bravos = total des réactions qui comptent, my_bravo = j'ai réagi (anciennes versions de l'app).
-- Le type de retour change : la fonction est supprimée puis recréée, ses droits redonnés en bas.
drop function public.feed(bigint, uuid, text, uuid);
create function public.feed(before_at bigint default null, before_owner uuid default null,
                            before_id text default null, only_user uuid default null)
  returns table (owner uuid, username text, avatar text, id text, done_at bigint, s jsonb, bravos int, my_bravo boolean,
                 reactions jsonb, my_reaction text)
  language sql stable security definer set search_path = '' as
$$
  with me as (
    select u.id, private.max_done_at() as max_at
    from (select (select auth.uid()) as id) u
    where exists (select 1 from public.user_profiles mp where mp.user_id = u.id and mp.social_at is not null)
  ),
  seen as (
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
  ),
  rx as (
    select pg.*, private.reaction_counts(pg.uid, pg.id) as counts,
      (select b.kind from public.bravos b
       where b.session_owner = pg.uid and b.session_id = pg.id and b.user_id = (select id from me)) as mine
    from page pg
  )
  select rx.uid, rx.username, rx.avatar_emoji, rx.id, rx.done_at, private.session_public(rx.data),
    private.reaction_total(rx.counts), rx.mine is not null, rx.counts, rx.mine
  from rx
  order by rx.done_at desc, rx.uid desc, rx.id desc
$$;

-- Réactions reçues sur mes séances (non supprimées), pour Historique : total, la plus fréquente et
-- les comptes par sorte. Seules comptent celles des personnes qui voient encore mes séances.
create function public.my_reactions() returns table (session_id text, total int, top text, reactions jsonb)
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then return; end if;
  perform private.rate_limit_window(me, 'my_reactions', 300, interval '1 hour');
  return query
    select t.sid, private.reaction_total(t.counts), private.reaction_top(t.counts), t.counts
    from (
      select x.id as sid, private.reaction_counts(me, x.id) as counts
      from public.sessions x
      where x.user_id = me and x.deleted_at is null
        and exists (select 1 from public.bravos b where b.session_owner = me and b.session_id = x.id)
    ) t
    where t.counts <> '{}'::jsonb;
end
$$;

-- Qui a réagi à MA séance : pseudo, avatar, réaction et date, du plus récent au plus ancien ; seules
-- les personnes qui voient encore mes séances (private.can_see), 200 au plus. Séance d'un autre,
-- inconnue ou supprimée : liste vide (rien n'est révélé).
create function public.session_reactions(session_id text)
  returns table (user_id uuid, username text, avatar text, kind text, at timestamptz)
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then return; end if;
  perform private.rate_limit_window(me, 'reactions_read', 300, interval '1 hour');
  return query
    select b.user_id, p.username, p.avatar_emoji, b.kind, b.updated_at
    from public.bravos b
    join public.sessions x on x.user_id = b.session_owner and x.id = b.session_id and x.deleted_at is null
    join public.user_profiles p on p.user_id = b.user_id
    where b.session_owner = me and b.session_id = session_reactions.session_id
      and private.can_see(b.user_id, me)
    order by b.updated_at desc, b.user_id
    limit 200;
end
$$;

-- Activité de Mon profil, du plus récent au plus ancien, 50 par page. Page suivante : before_at = at de
-- la dernière ligne reçue, tel que le serveur l'a renvoyé (microsecondes comprises), et before_key = sa
-- clé kind:user_id:session_id (session_id vide hors réaction) ; plusieurs lignes à la même date ne sont
-- ni perdues ni doublées (B et C acceptés dans la même transaction ont le même at). Sans before_key :
-- strictement avant before_at.
-- Lignes :
--   reaction : réaction à une de mes séances (non supprimée), d'une personne qui voit mes séances ;
--   follower : abonnement à moi accepté (date de l'acceptation) ;
--   accepted : ma demande acceptée (date de l'acceptation), l'autre ayant le social activé ;
--   request  : demande reçue en attente (jamais une demande fantôme).
-- Blocages exclus dans les deux sens. is_new : réaction ou demande acceptée plus récente que
-- l'activité vue (private.activity_seen). session_label : nom de ma séance (texte de 60 caractères
-- au plus), session_at : sa date. Vide tant que mon social n'est pas activé.
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

-- Activité vue (ouverture de Mon profil) : la pastille de l'onglet Amis repart de zéro
create function public.mark_activity_seen() returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then return; end if;
  perform private.rate_limit_window(me, 'activity_seen', 120, interval '1 hour');
  update public.user_profiles p set activity_seen_at = now() where p.user_id = me;
end
$$;

-- Mes séances telles que mes abonnés les voient : mêmes règles que le fil (private.session_shown),
-- même liste blanche, mêmes colonnes que feed (owner = moi), 20 par page, curseur (done_at, id).
create function public.my_shown_sessions(before_at bigint default null, before_id text default null)
  returns table (owner uuid, username text, avatar text, id text, done_at bigint, s jsonb, bravos int, my_bravo boolean,
                 reactions jsonb, my_reaction text)
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then return; end if;
  perform private.rate_limit_window(me, 'my_shown', 120, interval '1 hour');
  return query
    select t.user_id, p.username, p.avatar_emoji, t.id, t.done_at, private.session_public(t.data),
      private.reaction_total(t.counts), false, t.counts, null::text
    from (
      select x.user_id, x.id, x.done_at, x.data, private.reaction_counts(me, x.id) as counts
      from public.sessions x
      where x.user_id = me and private.session_shown(x.data, x.deleted_at, x.done_at)
        and (my_shown_sessions.before_at is null
             or x.done_at < my_shown_sessions.before_at
             or (my_shown_sessions.before_id is not null and x.done_at = my_shown_sessions.before_at
                 and x.id < my_shown_sessions.before_id))
      order by x.done_at desc, x.id desc
      limit 20
    ) t
    left join public.user_profiles p on p.user_id = t.user_id
    order by t.done_at desc, t.id desc;
end
$$;

-- État de l'onglet Amis : comme 20261026050000_social.sql, avec en plus activity_new (pastille) et
-- shown_sessions (mes séances visibles, chiffre de Mon profil). Même type de retour : create or replace.
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
                     and not private.blocked_between(me.id, f.follower_id)),
    'activity_new', least(private.activity_new(me.id), 99),
    'shown_sessions', (select count(*)::int from public.sessions x
                       where x.user_id = me.id and private.session_shown(x.data, x.deleted_at, x.done_at))
  )
  from me left join public.user_profiles p on p.user_id = me.id
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.reaction_counts(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.reaction_total(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.reaction_top(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.activity_seen(uuid) from public, anon, authenticated, service_role;
revoke all on function private.activity_new(uuid) from public, anon, authenticated, service_role;

revoke all on function public.set_reaction(uuid, text, text) from public, anon, authenticated;
revoke all on function public.feed(bigint, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.my_reactions() from public, anon, authenticated;
revoke all on function public.session_reactions(text) from public, anon, authenticated;
revoke all on function public.my_activity(timestamptz, text) from public, anon, authenticated;
revoke all on function public.mark_activity_seen() from public, anon, authenticated;
revoke all on function public.my_shown_sessions(bigint, text) from public, anon, authenticated;
revoke all on function public.social_state() from public, anon, authenticated;

grant execute on function public.set_reaction(uuid, text, text) to authenticated;
grant execute on function public.feed(bigint, uuid, text, uuid) to authenticated;
grant execute on function public.my_reactions() to authenticated;
grant execute on function public.session_reactions(text) to authenticated;
grant execute on function public.my_activity(timestamptz, text) to authenticated;
grant execute on function public.mark_activity_seen() to authenticated;
grant execute on function public.my_shown_sessions(bigint, text) to authenticated;
grant execute on function public.social_state() to authenticated;
