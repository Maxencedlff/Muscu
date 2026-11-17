-- ═══════════════════════════════════════════════════════════
--  Boîte Messages du coach (17/11/2026, test de charge à 300 élèves : jusqu'à 300 notifications de séances
--  par heure pour un coach). Contrat : docs/NOTIFICATIONS.md (« Séances de mes élèves », « Résumé ») et
--  docs/COACH_V1.md (« Notifications coupées »). NON appliquée en production : attend le feu vert de Maxence.
--  Retour arrière : supabase/rollback/20261117050000_messages_coach_down.sql
--
--  A. Résumé des séances terminées (nouveau type student_digest, même réglage student_sessions).
--     1. Un coach reçoit au plus 3 notifications « séance terminée » par heure glissante, tous élèves
--        confondus (les règles d'avant restent : une par élève et par heure, jamais deux fois la même séance
--        en 24 h). Compté sur la file (lignes student_session des 60 dernières minutes, envoyées ou non).
--     2. Au-delà, la séance n'a pas sa notification : l'élève est ajouté à un résumé, une ligne
--        student_digest par coach en attente (actor = le coach lui-même, ref = '', élèves distincts dans la
--        nouvelle colonne actors). Ligne pas encore prise par l'envoi : l'élève y est ajouté ; sinon une
--        nouvelle ligne est créée.
--     3. Regroupement : un résumé n'est pris par push_claim que 15 minutes après sa création, et pas dans
--        l'heure qui suit le résumé précédent de ce coach (pris ou envoyé). Au plus 3 notifications et un
--        résumé par heure, au lieu d'une par élève.
--     4. À l'envoi (push_claim) : count = élèves du résumé encore liés à ce coach et non bloqués, relu
--        maintenant ; 0, coach sans le rôle ou réglage éteint : rien (wanted faux). Jamais un pseudo ni
--        une séance : « 12 élèves ont terminé leur séance ».
--     5. Concurrence : les séances de deux élèves d'un même coach passent l'une après l'autre (verrou par
--        coach et type, plus par élève) : le seuil de 3 tient même quand ils enregistrent ensemble.
--     6. push-send doit connaître student_digest AVANT cette migration (sinon la ligne est soldée sans envoi).
--  B. Notifications coupées : coach_push_off() rend les identifiants de MES élèves liés qui ne recevraient
--     pas mes messages en notification (aucun appareil inscrit, ou « Messages » éteint). Rien d'autre :
--     ni date, ni appareil, ni autre réglage. 600 lectures par heure, comme chat_threads.
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

alter table private.push_outbox add column actors uuid[];   -- résumé : élèves distincts (sinon null)

alter table private.push_outbox drop constraint push_outbox_kind_check;
alter table private.push_outbox add constraint push_outbox_kind_check
  check (kind in ('reaction', 'follow_request', 'coach_note', 'coach_programme', 'comment', 'chat_message', 'student_session',
                  'student_digest'));

-- ── Briques ──────────────────────────────────────────────

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
                            when 'student_digest' then p.student_sessions
                            else false end
                   from public.push_prefs p where p.user_id = recipient), false)
$$;

-- Élèves d'un résumé encore liés à ce coach et non bloqués (point A4)
create function private.push_digest_count(recipient uuid, actors uuid[]) returns int
  language sql stable security definer set search_path = '' as
$$
  select count(distinct a)::int
  from unnest(coalesce(actors, '{}'::uuid[])) a
  where exists (select 1 from public.coach_links l where l.student_id = a and l.coach_id = recipient)
    and not private.blocked_between(recipient, a)
$$;

-- Comme 20261116020000, plus le résumé : coach encore coach (le nombre d'élèves est relu par push_claim)
create or replace function private.push_valid(kind text, recipient uuid, actor uuid, ref text) returns boolean
  language plpgsql stable security definer set search_path = '' as
$$
declare
  rid bigint;
  c_author uuid; c_owner uuid; c_sid text; c_masked timestamptz;
  m_student uuid; m_coach uuid; m_from_coach boolean; m_read bigint;
begin
  if kind = 'student_digest' then return private.is_coach(recipient); end if;
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

-- Comme 20261116020000, plus : au-delà de 3 séances notifiées dans l'heure, le résumé (points A1, A2, A5)
create or replace function private.push_enqueue(recipient uuid, kind text, actor uuid, ref text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  r text := coalesce(left(push_enqueue.ref, 64), '');
  burst boolean := push_enqueue.kind in ('comment', 'chat_message');
  hourly boolean := push_enqueue.kind = 'student_session';
  digest_id bigint;
begin
  if recipient is null or actor is null or recipient = actor then return; end if;
  if not private.push_wanted(recipient, kind) then return; end if;
  if not exists (select 1 from public.push_devices d where d.user_id = recipient) then return; end if;
  if private.blocked_between(recipient, actor) then return; end if;
  if not private.push_valid(kind, recipient, actor, r) then return; end if;
  -- Deux actions simultanées : une seule ligne (salve : verrou par auteur, sans l'objet ; séances des élèves :
  -- verrou par coach, sans l'élève, pour que le seuil de l'heure tienne)
  perform pg_advisory_xact_lock(hashtextextended(recipient::text || kind
    || case when hourly then '' when burst then actor::text else actor::text || r end, 0));
  if hourly then
    if exists (select 1 from private.push_outbox o
               where o.recipient = push_enqueue.recipient and o.kind = push_enqueue.kind and o.actor = push_enqueue.actor
                 and (o.created_at > now() - interval '1 hour'
                      or (o.ref = r and o.created_at > now() - interval '24 hours'))) then
      return;
    end if;
    if (select count(*) from private.push_outbox o
        where o.recipient = push_enqueue.recipient and o.kind = 'student_session'
          and o.created_at > now() - interval '1 hour') >= 3 then
      select o.id into digest_id from private.push_outbox o
        where o.recipient = push_enqueue.recipient and o.kind = 'student_digest'
          and o.sent_at is null and o.claimed_at is null and o.created_at > now() - interval '24 hours'
        order by o.id desc limit 1;
      if digest_id is null then
        insert into private.push_outbox (recipient, kind, actor, ref, actors)
          values (recipient, 'student_digest', recipient, '', array[actor]);
      else
        update private.push_outbox o set actors = o.actors || push_enqueue.actor
          where o.id = digest_id and not (push_enqueue.actor = any(o.actors));
      end if;
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

-- Comme 20261116020000, plus le résumé : pris 15 min après sa création et pas dans l'heure du précédent
-- (point A3) ; count relu maintenant (point A4)
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
        and (o.kind <> 'student_digest'
             or (o.created_at <= now() - interval '15 minutes'
                 and not exists (select 1 from private.push_outbox p
                                 where p.recipient = o.recipient and p.kind = 'student_digest' and p.id <> o.id
                                   and coalesce(p.sent_at, p.claimed_at) > now() - interval '1 hour')))
      order by o.created_at
      limit least(greatest(coalesce(max_rows, 50), 1), 200)
      for update skip locked
  ), claimed as (
    update private.push_outbox o set claimed_at = now(), attempts = o.attempts + 1
      from picked where o.id = picked.id
      returning o.*
  ), counted as (
    select c.*, case when c.kind = 'student_digest' then private.push_digest_count(c.recipient, c.actors) end as n
    from claimed c
  ), checked as (
    select c.*, private.push_wanted(c.recipient, c.kind) and not private.blocked_between(c.recipient, c.actor)
                and private.push_valid(c.kind, c.recipient, c.actor, c.ref)
                and (c.kind <> 'student_digest' or c.n >= 1) as ok
    from counted c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind,
           'ref', case when not c.ok then ''
                       when c.kind = 'student_digest' then ''
                       when c.kind = 'student_session' then
                         case when char_length(c.actor::text || '/' || c.ref) <= 64 then c.actor::text || '/' || c.ref else c.actor::text end
                       else private.push_open_ref(c.kind, c.ref, c.recipient) end,
           'token', d.token, 'env', d.env,
           'actor_name', case when c.kind = 'student_digest' then null else up.username end,
           'wanted', c.ok)
           || case when c.ok and c.kind = 'student_session' then jsonb_strip_nulls(jsonb_build_object(
                'label', case when jsonb_typeof(x.data -> 'label') = 'string' then nullif(left(btrim(x.data ->> 'label'), 40), '') end,
                'minutes', case when jsonb_typeof(x.data -> 'duration') = 'number'
                                     and (x.data ->> 'duration')::numeric between 60000 and 86400000
                                then round((x.data ->> 'duration')::numeric / 60000)::int end))
                   when c.ok and c.kind = 'student_digest' then jsonb_build_object('count', c.n)
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

-- ── RPC de l'app : notifications coupées (point B) ───────

-- Mes élèves liés qui ne recevraient pas mes messages en notification : [uuid, …] ; pas coach : []
create function public.coach_push_off() returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  if not private.is_coach(me) then return '[]'::jsonb; end if;
  perform private.rate_limit_window(me, 'coach_push_off', 600, interval '1 hour');
  return coalesce((
    select jsonb_agg(l.student_id order by l.student_id)
    from public.coach_links l
    where l.coach_id = me
      and not (exists (select 1 from public.push_devices d where d.user_id = l.student_id)
               and coalesce((select p.messages from public.push_prefs p where p.user_id = l.student_id), false))
  ), '[]'::jsonb);
end
$$;

-- ── Droits ───────────────────────────────────────────────

revoke all on function private.push_digest_count(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.coach_push_off() from public, anon, authenticated, service_role;
grant execute on function public.coach_push_off() to authenticated;
