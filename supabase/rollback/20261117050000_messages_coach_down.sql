-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261117050000_messages_coach.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide d'annuler le résumé des séances et coach_push_off).
--  Pas dans migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Effet : résumés encore en file effacés (les élèves qu'ils regroupaient ne sont pas re-notifiés) ;
--  colonne push_outbox.actors retirée ; push_wanted, push_valid, push_enqueue et push_claim reprennent
--  leur texte de 20261116020000 (une notification par élève et par heure, sans plafond par coach) ;
--  coach_push_off et push_digest_count supprimées. Aucune autre ligne touchée.
--  L'app s'adapte seule : coach_push_off absente (PGRST202), aucune cloche barrée. push-send peut rester
--  tel quel (il connaît un type de plus, qui n'arrive plus).
--  À démonter AVANT 20261116020000_notifications_seances_eleves_down.sql (supabase/rollback/ORDRE.md).
--  Vérifié par tests/sql/rollback_messages_coach_check.sh (pg_dump identique à la base d'avant).
-- ═══════════════════════════════════════════════════════════

begin;

drop function if exists public.coach_push_off();

-- Textes de 20261116020000_notifications_seances_eleves.sql
create or replace function private.push_wanted(recipient uuid, kind text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select coalesce((select case kind
                            when 'reaction' then p.reactions
                            when 'follow_request' then p.follows
                            when 'coach_note' then p.coach
                            when 'coach_programme' then p.coach
                            when 'comment' then p.comments
                            when 'chat_message' then p.messages
                            when 'student_session' then p.student_sessions
                            else false end
                   from public.push_prefs p where p.user_id = recipient), false)
$$;

create or replace function private.push_valid(kind text, recipient uuid, actor uuid, ref text) returns boolean
  language plpgsql stable security definer set search_path = '' as
$$
declare
  rid bigint;
  c_author uuid; c_owner uuid; c_sid text; c_masked timestamptz;
  m_student uuid; m_coach uuid; m_from_coach boolean; m_read bigint;
begin
  if kind = 'student_session' then
    return ref is not null and ref <> '' and private.is_coach(recipient)
      and exists (select 1 from public.coach_links l where l.student_id = actor and l.coach_id = recipient)
      and exists (select 1 from public.sessions x
                  where x.user_id = actor and x.id = ref and x.deleted_at is null
                    and x.done_at is not null and x.done_at <= private.max_done_at());
  end if;
  if kind not in ('comment', 'chat_message') then return true; end if;
  if ref is null or ref !~ '^[0-9]{1,18}$' then return false; end if;
  rid := ref::bigint;
  if kind = 'comment' then
    select c.author_id, c.session_owner, c.session_id, c.masked_at into c_author, c_owner, c_sid, c_masked
      from public.session_comments c where c.id = rid;
    return found and c_author = actor and c_owner = recipient and c_masked is null
      and private.comments_readable(recipient, recipient, c_sid)
      and private.comments_writable(actor, recipient, c_sid)
      and not exists (select 1 from public.comment_reports r where r.comment_id = rid and r.reporter_id = recipient);
  end if;
  select m.student_id, m.coach_id, m.from_coach,
         case when m.from_coach then l.chat_student_read else l.chat_coach_read end
    into m_student, m_coach, m_from_coach, m_read
    from public.coach_messages m
    join public.coach_links l on l.student_id = m.student_id and l.coach_id = m.coach_id
    where m.id = rid;
  return found
    and case when m_from_coach then actor = m_coach and recipient = m_student
             else actor = m_student and recipient = m_coach end
    and private.is_coach(m_coach)
    and rid > m_read
    and not exists (select 1 from public.chat_reports r
                    where r.reporter_id = recipient and r.student_id = m_student and r.coach_id = m_coach);
end
$$;

create or replace function private.push_enqueue(recipient uuid, kind text, actor uuid, ref text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  r text := coalesce(left(push_enqueue.ref, 64), '');
  burst boolean := push_enqueue.kind in ('comment', 'chat_message');
  hourly boolean := push_enqueue.kind = 'student_session';
begin
  if recipient is null or actor is null or recipient = actor then return; end if;
  if not private.push_wanted(recipient, kind) then return; end if;
  if not exists (select 1 from public.push_devices d where d.user_id = recipient) then return; end if;
  if private.blocked_between(recipient, actor) then return; end if;
  if not private.push_valid(kind, recipient, actor, r) then return; end if;
  -- Deux actions simultanées : une seule ligne (salve et séances : verrou par auteur, sans l'objet)
  perform pg_advisory_xact_lock(hashtextextended(recipient::text || kind || actor::text || case when burst or hourly then '' else r end, 0));
  if hourly then
    if exists (select 1 from private.push_outbox o
               where o.recipient = push_enqueue.recipient and o.kind = push_enqueue.kind and o.actor = push_enqueue.actor
                 and (o.created_at > now() - interval '1 hour'
                      or (o.ref = r and o.created_at > now() - interval '24 hours'))) then
      return;
    end if;
  elsif burst then
    if exists (select 1 from private.push_outbox o
               where o.recipient = push_enqueue.recipient and o.kind = push_enqueue.kind and o.actor = push_enqueue.actor
                 and o.created_at > now() - interval '15 minutes'
                 -- Message : la précédente ne cède que si elle a été LUE (message encore là, marque de
                 -- lecture au-delà) ; effacé (lien rompu puis renoué), elle compte quand même
                 and (push_enqueue.kind = 'comment' or not exists (
                       select 1 from public.coach_messages m
                       join public.coach_links l on l.student_id = m.student_id and l.coach_id = m.coach_id
                       where o.ref ~ '^[0-9]{1,18}$' and m.id = o.ref::bigint
                         and m.id <= case when m.from_coach then l.chat_student_read else l.chat_coach_read end))) then
      return;
    end if;
  elsif exists (select 1 from private.push_outbox o
                where o.recipient = push_enqueue.recipient and o.kind = push_enqueue.kind and o.actor = push_enqueue.actor
                  and o.ref = r and o.created_at > now() - interval '24 hours') then
    return;
  end if;
  insert into private.push_outbox (recipient, kind, actor, ref) values (recipient, kind, actor, r);
end
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
  ), checked as (
    select c.*, private.push_wanted(c.recipient, c.kind) and not private.blocked_between(c.recipient, c.actor)
                and private.push_valid(c.kind, c.recipient, c.actor, c.ref) as ok
    from claimed c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind,
           'ref', case when not c.ok then ''
                       when c.kind = 'student_session' then
                         case when char_length(c.actor::text || '/' || c.ref) <= 64 then c.actor::text || '/' || c.ref else c.actor::text end
                       else private.push_open_ref(c.kind, c.ref, c.recipient) end,
           'token', d.token, 'env', d.env,
           'actor_name', up.username,
           'wanted', c.ok)
           || case when c.ok and c.kind = 'student_session' then jsonb_strip_nulls(jsonb_build_object(
                'label', case when jsonb_typeof(x.data -> 'label') = 'string' then nullif(left(btrim(x.data ->> 'label'), 40), '') end,
                'minutes', case when jsonb_typeof(x.data -> 'duration') = 'number'
                                     and (x.data ->> 'duration')::numeric between 60000 and 86400000
                                then round((x.data ->> 'duration')::numeric / 60000)::int end))
              else '{}'::jsonb end
           order by c.id), '[]'::jsonb)
    into res
    from checked c
    left join public.push_devices d on d.user_id = c.recipient
    left join public.user_profiles up on up.user_id = c.actor
    left join public.sessions x on c.kind = 'student_session' and x.user_id = c.actor and x.id = c.ref;
  return res;
end
$$;

drop function if exists private.push_digest_count(uuid, uuid[]);

delete from private.push_outbox where kind = 'student_digest';
alter table private.push_outbox drop constraint push_outbox_kind_check;
alter table private.push_outbox add constraint push_outbox_kind_check
  check (kind in ('reaction', 'follow_request', 'coach_note', 'coach_programme', 'comment', 'chat_message', 'student_session'));
alter table private.push_outbox drop column if exists actors;

commit;
