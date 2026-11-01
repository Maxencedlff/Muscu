-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261031910000_notifications_messages.sql (à lancer à la main,
--  dans l'éditeur SQL, seulement si Maxence décide d'annuler les notifications des messages et des
--  commentaires). Pas dans migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Effet : déclencheurs sur session_comments et coach_messages retirés ; notifications de ces deux types
--  encore en file effacées ; réglages comments et messages effacés ; push_wanted, push_enqueue, push_claim
--  et push_prefs reprennent leur texte de 20261031900000 ; push_set_prefs à 5 arguments supprimé (celui
--  à 3 reste). Messages, commentaires et autres notifications : aucune ligne touchée.
--  L'app s'adapte seule : elle ne montre que les types que push_prefs renvoie (3 après ce retour
--  arrière) et écrit alors avec push_set_prefs à 3 arguments (seul un écran Notifications resté ouvert
--  pendant le retour arrière dit « Réglage non enregistré » au premier toucher). La fonction push-send
--  n'a pas besoin d'être redéployée (types inconnus de la file : il n'y en a plus).
--  À démonter AVANT 20261031900000_notifications_push_down.sql (supabase/rollback/ORDRE.md).
--  Vérifié par tests/sql/rollback_push_messages_check.sh (pg_dump identique à la base d'avant).
-- ═══════════════════════════════════════════════════════════

begin;

drop trigger if exists session_comments_push on public.session_comments;
drop trigger if exists coach_messages_push on public.coach_messages;
drop function if exists private.push_on_comment();
drop function if exists private.push_on_chat_message();

-- Texte d'origine (20261031900000_notifications_push.sql)
create or replace function private.push_wanted(recipient uuid, kind text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select coalesce((select case kind
                            when 'reaction' then p.reactions
                            when 'follow_request' then p.follows
                            when 'coach_note' then p.coach
                            when 'coach_programme' then p.coach
                            else false end
                   from public.push_prefs p where p.user_id = recipient), false)
$$;

create or replace function private.push_enqueue(recipient uuid, kind text, actor uuid, ref text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare r text := coalesce(left(push_enqueue.ref, 64), '');
begin
  if recipient is null or actor is null or recipient = actor then return; end if;
  if not private.push_wanted(recipient, kind) then return; end if;
  if not exists (select 1 from public.push_devices d where d.user_id = recipient) then return; end if;
  if private.blocked_between(recipient, actor) then return; end if;
  -- Deux actions simultanées sur le même objet : une seule ligne
  perform pg_advisory_xact_lock(hashtextextended(recipient::text || kind || actor::text || r, 0));
  if exists (select 1 from private.push_outbox o
             where o.recipient = push_enqueue.recipient and o.kind = push_enqueue.kind and o.actor = push_enqueue.actor
               and o.ref = r and o.created_at > now() - interval '24 hours') then
    return;
  end if;
  insert into private.push_outbox (recipient, kind, actor, ref) values (recipient, kind, actor, r);
end
$$;

create or replace function public.push_prefs() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('reactions', coalesce(p.reactions, false), 'follows', coalesce(p.follows, false),
                            'coach', coalesce(p.coach, false))
  from (select (select auth.uid()) as id) me left join public.push_prefs p on p.user_id = me.id
$$;

create or replace function public.push_claim(max_rows int) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare res jsonb;
begin
  delete from private.push_outbox o where o.created_at < now() - interval '7 days';
  delete from public.push_devices d where d.seen_at < now() - interval '60 days';
  with picked as (
    select o.id from private.push_outbox o
      where o.sent_at is null and o.attempts < 5 and o.created_at > now() - interval '24 hours'
        and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
      order by o.created_at
      limit least(greatest(coalesce(max_rows, 50), 1), 200)
      for update skip locked
  ), claimed as (
    update private.push_outbox o set claimed_at = now(), attempts = o.attempts + 1
      from picked where o.id = picked.id
      returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'ref', c.ref, 'token', d.token, 'env', d.env,
           'actor_name', up.username,
           'wanted', private.push_wanted(c.recipient, c.kind) and not private.blocked_between(c.recipient, c.actor))
           order by c.id), '[]'::jsonb)
    into res
    from claimed c
    left join public.push_devices d on d.user_id = c.recipient
    left join public.user_profiles up on up.user_id = c.actor;
  return res;
end
$$;

drop function if exists public.push_set_prefs(boolean, boolean, boolean, boolean, boolean);
drop function if exists private.push_valid(text, uuid, uuid, text);
drop function if exists private.push_open_ref(text, text, uuid);

delete from private.push_outbox where kind in ('comment', 'chat_message');
alter table private.push_outbox drop constraint push_outbox_kind_check;
alter table private.push_outbox add constraint push_outbox_kind_check
  check (kind in ('reaction', 'follow_request', 'coach_note', 'coach_programme'));

alter table public.push_prefs drop column if exists comments, drop column if exists messages;

commit;
