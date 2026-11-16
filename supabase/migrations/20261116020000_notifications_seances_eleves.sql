-- ═══════════════════════════════════════════════════════════
--  Notifications push, un type de plus (contrat : docs/NOTIFICATIONS.md) : « lea a terminé Push · 52 min »,
--  au coach, quand un de ses élèves enregistre une séance terminée (public.sessions).
--  20261031900000 et 20261031910000 ne changent pas : leurs fonctions sont remplacées ici.
--  Retour arrière : supabase/rollback/20261116020000_notifications_seances_eleves_down.sql
--
--  1. Rien sans accord : réglage à part, student_sessions, éteint par défaut. Pas la colonne coach : elle
--     veut dire « mon coach m'écrit » (commentaire, programme) et des comptes l'ont déjà allumée ; s'en
--     servir enverrait ce nouveau type à qui ne l'a jamais accepté, et un coach qui a lui-même un coach ne
--     pourrait pas garder l'un sans l'autre. L'app l'allume à « Activer » de la feuille du coach, ou par
--     son interrupteur (Réglages › Notifications, montré aux coachs). push_set_prefs à 6 arguments ; ceux
--     à 3 et 5 restent (app d'avant) et ne touchent pas au nouveau.
--  2. Ce qui déclenche : une séance datée qui arrive (insert avec done_at) ou qui le devient (done_at qui
--     passe de null à une date), non supprimée. Rien pour une séance corrigée (elle était déjà datée).
--     Seulement si l'élève a un lien avec ce coach, que le coach a encore le rôle (private.is_coach), et
--     que la séance est récente : au plus 24 h avant maintenant et pas avant la date du lien (une
--     synchronisation de tout l'historique, un import, un nouvel élève avec 300 séances : rien).
--     Ce que le coach voit (20261027100000_coach.sql, point 6) : toutes les séances non supprimées et
--     datées de son élève, celles masquées aux abonnés comprises ; coach_shares ne porte que le poids et
--     les mensurations. La règle est la même ici : pas de filtre de plus.
--  3. Contenu : pseudo de l'élève, nom de la séance (data.label, 40 caractères au plus) et durée en
--     minutes (data.duration) ; jamais une charge, un exercice ni une note. La file ne garde que l'id de la
--     séance ; nom et durée sont relus à l'envoi (push_claim), séance supprimée entre-temps : rien.
--  4. Débit : une notification par élève et par heure au plus (plusieurs séances enregistrées ou corrigées
--     d'affilée), en plus de la règle des types d'avant (même séance : pas deux fois en 24 h).
--  5. Écran à ouvrir (ref rendu par push_claim) : « <id de l'élève>/<id de la séance> » (fiche de l'élève,
--     puis la séance) ; plus de 64 caractères (limite de PushPlugin.swift) : l'id de l'élève seul.
--  6. Le déclencheur ne fait jamais échouer l'enregistrement de la séance (raise warning).
--  7. push-send doit connaître le type AVANT cette migration (sinon la ligne est soldée sans envoi).
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

alter table public.push_prefs
  add column student_sessions boolean not null default false;   -- un de mes élèves a terminé une séance

alter table private.push_outbox drop constraint push_outbox_kind_check;
alter table private.push_outbox add constraint push_outbox_kind_check
  check (kind in ('reaction', 'follow_request', 'coach_note', 'coach_programme', 'comment', 'chat_message', 'student_session'));

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
                            else false end
                   from public.push_prefs p where p.user_id = recipient), false)
$$;

-- Comme 20261031910000, plus la séance d'un élève : encore là (non supprimée, datée, pas dans le futur
-- lointain), élève encore lié à ce coach, coach encore coach
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

-- Comme 20261031910000, plus : séance d'un élève, une par élève et par heure (point 4)
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

-- Comme 20261031910000, plus, pour la séance d'un élève : ref = écran à ouvrir (point 5), label (nom de la
-- séance, 40 caractères au plus) et minutes (durée, 1 à 1440), relus maintenant ; absents sinon
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

-- ── Déclencheur ──────────────────────────────────────────

-- Séance datée qui arrive : son coach (s'il y en a un) est prévenu si elle est récente (point 2)
create function private.push_on_student_session() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare l record;
begin
  begin
    if new.done_at is null or new.deleted_at is not null or new.done_at > private.max_done_at()
       or new.done_at < (extract(epoch from now() - interval '24 hours') * 1000)::bigint then
      return null;
    end if;
    for l in select k.coach_id, k.created_at from public.coach_links k where k.student_id = new.user_id loop
      if new.done_at >= (extract(epoch from l.created_at) * 1000)::bigint then
        perform private.push_enqueue(l.coach_id, 'student_session', new.user_id, new.id);
      end if;
    end loop;
  exception when others then raise warning 'push_on_student_session: % %', sqlstate, sqlerrm;
  end;
  return null;
end
$$;

create trigger sessions_push_insert after insert on public.sessions
  for each row when (new.done_at is not null and new.deleted_at is null)
  execute function private.push_on_student_session();
create trigger sessions_push_update after update on public.sessions
  for each row when (old.done_at is null and new.done_at is not null and new.deleted_at is null)
  execute function private.push_on_student_session();

-- ── RPC de l'app ─────────────────────────────────────────

-- Mes réglages (tout éteint sans ligne) : les six types
create or replace function public.push_prefs() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('reactions', coalesce(p.reactions, false), 'follows', coalesce(p.follows, false),
                            'coach', coalesce(p.coach, false), 'comments', coalesce(p.comments, false),
                            'messages', coalesce(p.messages, false), 'student_sessions', coalesce(p.student_sessions, false))
  from (select (select auth.uid()) as id) me left join public.push_prefs p on p.user_id = me.id
$$;

-- Écrit mes réglages, les six types ; null = inchangé. Un type éteint : sa file en attente est vidée.
-- (PostgREST choisit la version selon les noms envoyés : 3, 5 ou 6.)
create function public.push_set_prefs(reactions boolean, follows boolean, coach boolean, comments boolean, messages boolean,
                                      student_sessions boolean)
  returns jsonb language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  insert into public.push_prefs (user_id, reactions, follows, coach, comments, messages, student_sessions)
    values (me, coalesce(push_set_prefs.reactions, false), coalesce(push_set_prefs.follows, false),
            coalesce(push_set_prefs.coach, false), coalesce(push_set_prefs.comments, false),
            coalesce(push_set_prefs.messages, false), coalesce(push_set_prefs.student_sessions, false))
    on conflict on constraint push_prefs_pkey do update
      set reactions = coalesce(push_set_prefs.reactions, public.push_prefs.reactions),
          follows = coalesce(push_set_prefs.follows, public.push_prefs.follows),
          coach = coalesce(push_set_prefs.coach, public.push_prefs.coach),
          comments = coalesce(push_set_prefs.comments, public.push_prefs.comments),
          messages = coalesce(push_set_prefs.messages, public.push_prefs.messages),
          student_sessions = coalesce(push_set_prefs.student_sessions, public.push_prefs.student_sessions),
          updated_at = now();
  delete from private.push_outbox o where o.recipient = me and o.sent_at is null and not private.push_wanted(me, o.kind);
  return public.push_prefs();
end
$$;

-- ── Droits ───────────────────────────────────────────────

revoke all on function private.push_on_student_session() from public, anon, authenticated, service_role;
revoke all on function public.push_set_prefs(boolean, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.push_set_prefs(boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;
