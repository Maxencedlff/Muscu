-- ═══════════════════════════════════════════════════════════
--  Notifications push, deux types de plus (contrat : docs/NOTIFICATIONS.md) : nouveau message du chat
--  coach ↔ élève (public.coach_messages) et nouveau commentaire sur ma séance (public.session_comments).
--  20261031900000_notifications_push.sql ne change pas : ses fonctions sont remplacées ici.
--  Retour arrière : supabase/rollback/20261031910000_notifications_messages_down.sql
--
--  1. Rien sans accord : deux réglages de plus, comments et messages, éteints par défaut (un compte qui
--     avait allumé « Bravos » n'a pas accepté les commentaires). Un interrupteur par type, comme les trois
--     premiers. push_set_prefs à 5 arguments ; celui à 3 reste pour les versions de l'app d'avant (il
--     ne touche pas aux deux nouveaux).
--  2. Jamais le texte : la file ne garde que l'id du message ou du commentaire (ref), relu à l'envoi pour
--     vérifier qu'il compte encore ; la notification ne porte que le pseudo et l'écran à ouvrir (ref
--     rendu par push_claim : id de la séance pour un commentaire ; pour un message, '@coach' si je suis
--     l'élève, sinon l'id de l'élève : l'app n'a pas besoin de savoir quel compte est connecté, ce qui
--     n'est pas encore le cas quand on touche la notification app fermée).
--  3. Anti-rafale : une salve d'un même auteur ne sonne qu'une fois. Une nouvelle notification
--     (destinataire, type, auteur) n'est pas créée s'il y en a déjà une de moins de 15 minutes ; pour
--     un message, sauf si celui-ci a été lu depuis (un message effacé, lien rompu puis renoué, compte). Un commentaire, lui, se supprime sans
--     limite : supprimé ou masqué, il compte quand même (sinon « publier, supprimer, republier » sonnerait
--     à chaque fois, et un auteur masqué sonnerait aussitôt de nouveau). Pourquoi 15 min : un chat s'écrit en
--     salves de quelques messages en quelques minutes, et plusieurs commentaires d'affilée sont courants ;
--     15 min les regroupent, plafonnent à 4 notifications par heure et par auteur même si on ne lit pas
--     (60 messages et 30 commentaires par heure sont permis), et un oubli est rappelé au bout d'un quart
--     d'heure. Message lu entre-temps (conversation ouverte) : le suivant sonne de nouveau. Les types
--     d'avant gardent leur règle (même objet, 24 h).
--  4. Blocage et modération, relus à la mise en file ET à l'envoi (private.push_valid) :
--     - commentaire : existe encore (pas supprimé), pas masqué (3 signalements), pas signalé par moi,
--       son auteur voit encore la séance (abonnement, social, blocage : comments_writable) et j'ai le
--       social activé (comments_readable) ;
--     - message : existe encore (lien coach ↔ élève pas rompu), le coach a encore le rôle, je n'ai pas
--       signalé cette conversation (report_chat), et pas déjà lu (conversation ouverte dans l'app :
--       inutile de sonner) ;
--     - blocage entre les deux comptes (private.blocked_between, déjà dans push_enqueue et push_claim) :
--       le chat ne regarde pas les blocages, ses notifications si.
--  5. Les déclencheurs ne font jamais échouer l'envoi du message ou du commentaire : une erreur est
--     écrite dans le journal de Postgres (raise warning), jamais renvoyée.
--  6. Les briques sont en plpgsql et ne lisent session_comments ou coach_messages que pour leur type :
--     un retour arrière du chat ou des commentaires fait avant celui-ci ne casse pas les autres types.
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

alter table public.push_prefs
  add column comments boolean not null default false,   -- commentaire d'un autre sur une de mes séances
  add column messages boolean not null default false;   -- message de mon coach ou d'un de mes élèves

-- ref : id du commentaire ou du message (texte) pour les deux nouveaux types
alter table private.push_outbox drop constraint push_outbox_kind_check;
alter table private.push_outbox add constraint push_outbox_kind_check
  check (kind in ('reaction', 'follow_request', 'coach_note', 'coach_programme', 'comment', 'chat_message'));

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
                            else false end
                   from public.push_prefs p where p.user_id = recipient), false)
$$;

-- La notification compte-t-elle encore ? (point 4 de l'en-tête). Types d'avant : toujours vrai (leurs
-- règles sont dans push_enqueue et push_claim).
create function private.push_valid(kind text, recipient uuid, actor uuid, ref text) returns boolean
  language plpgsql stable security definer set search_path = '' as
$$
declare
  rid bigint;
  c_author uuid; c_owner uuid; c_sid text; c_masked timestamptz;
  m_student uuid; m_coach uuid; m_from_coach boolean; m_read bigint;
begin
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

-- Écran à ouvrir au toucher (ref envoyé à l'app) : séance du commentaire ; conversation : '@coach' si le
-- destinataire est l'élève (CHAT_COACH de l'app), sinon l'id de l'élève. Autres types : ref tel quel.
-- Disparu : ''.
create function private.push_open_ref(kind text, ref text, recipient uuid) returns text
  language plpgsql stable security definer set search_path = '' as
$$
declare r text;
begin
  if kind not in ('comment', 'chat_message') then return ref; end if;
  if ref is null or ref !~ '^[0-9]{1,18}$' then return ''; end if;
  if kind = 'comment' then
    select c.session_id into r from public.session_comments c where c.id = ref::bigint;
  else
    select case when m.student_id = recipient then '@coach' else m.student_id::text end into r
      from public.coach_messages m where m.id = ref::bigint;
  end if;
  return coalesce(r, '');
end
$$;

-- Comme 20261031900000, plus : validité (push_valid) et anti-rafale des deux nouveaux types (point 3)
create or replace function private.push_enqueue(recipient uuid, kind text, actor uuid, ref text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  r text := coalesce(left(push_enqueue.ref, 64), '');
  burst boolean := push_enqueue.kind in ('comment', 'chat_message');
begin
  if recipient is null or actor is null or recipient = actor then return; end if;
  if not private.push_wanted(recipient, kind) then return; end if;
  if not exists (select 1 from public.push_devices d where d.user_id = recipient) then return; end if;
  if private.blocked_between(recipient, actor) then return; end if;
  if not private.push_valid(kind, recipient, actor, r) then return; end if;
  -- Deux actions simultanées : une seule ligne (salve : verrou par auteur, sans l'objet)
  perform pg_advisory_xact_lock(hashtextextended(recipient::text || kind || actor::text || case when burst then '' else r end, 0));
  if burst then
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

-- Comme 20261031900000, plus : wanted relit push_valid (commentaire masqué ou supprimé, message lu,
-- conversation signalée entre la mise en file et l'envoi) et ref devient l'écran à ouvrir
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
           'ref', case when c.ok then private.push_open_ref(c.kind, c.ref, c.recipient) else '' end,
           'token', d.token, 'env', d.env,
           'actor_name', up.username,
           'wanted', c.ok)
           order by c.id), '[]'::jsonb)
    into res
    from checked c
    left join public.push_devices d on d.user_id = c.recipient
    left join public.user_profiles up on up.user_id = c.actor;
  return res;
end
$$;

-- ── Déclencheurs ─────────────────────────────────────────

create function private.push_on_comment() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  begin
    perform private.push_enqueue(new.session_owner, 'comment', new.author_id, new.id::text);
  exception when others then raise warning 'push_on_comment: % %', sqlstate, sqlerrm;
  end;
  return null;
end
$$;

create function private.push_on_chat_message() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  begin
    perform private.push_enqueue(case when new.from_coach then new.student_id else new.coach_id end, 'chat_message',
                                 case when new.from_coach then new.coach_id else new.student_id end, new.id::text);
  exception when others then raise warning 'push_on_chat_message: % %', sqlstate, sqlerrm;
  end;
  return null;
end
$$;

create trigger session_comments_push after insert on public.session_comments
  for each row execute function private.push_on_comment();
create trigger coach_messages_push after insert on public.coach_messages
  for each row execute function private.push_on_chat_message();

-- ── RPC de l'app ─────────────────────────────────────────

-- Mes réglages (tout éteint sans ligne) : les cinq types
create or replace function public.push_prefs() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('reactions', coalesce(p.reactions, false), 'follows', coalesce(p.follows, false),
                            'coach', coalesce(p.coach, false), 'comments', coalesce(p.comments, false),
                            'messages', coalesce(p.messages, false))
  from (select (select auth.uid()) as id) me left join public.push_prefs p on p.user_id = me.id
$$;

-- Écrit mes réglages, les cinq types ; null = inchangé. Un type éteint : sa file en attente est vidée.
-- (PostgREST choisit cette version quand l'app envoie les cinq noms, l'ancienne quand elle en envoie trois.)
create function public.push_set_prefs(reactions boolean, follows boolean, coach boolean, comments boolean, messages boolean)
  returns jsonb language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  insert into public.push_prefs (user_id, reactions, follows, coach, comments, messages)
    values (me, coalesce(push_set_prefs.reactions, false), coalesce(push_set_prefs.follows, false),
            coalesce(push_set_prefs.coach, false), coalesce(push_set_prefs.comments, false),
            coalesce(push_set_prefs.messages, false))
    on conflict on constraint push_prefs_pkey do update
      set reactions = coalesce(push_set_prefs.reactions, public.push_prefs.reactions),
          follows = coalesce(push_set_prefs.follows, public.push_prefs.follows),
          coach = coalesce(push_set_prefs.coach, public.push_prefs.coach),
          comments = coalesce(push_set_prefs.comments, public.push_prefs.comments),
          messages = coalesce(push_set_prefs.messages, public.push_prefs.messages),
          updated_at = now();
  delete from private.push_outbox o where o.recipient = me and o.sent_at is null and not private.push_wanted(me, o.kind);
  return public.push_prefs();
end
$$;

-- ── Droits ───────────────────────────────────────────────

revoke all on function private.push_valid(text, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.push_open_ref(text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.push_on_comment() from public, anon, authenticated, service_role;
revoke all on function private.push_on_chat_message() from public, anon, authenticated, service_role;
revoke all on function public.push_set_prefs(boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.push_set_prefs(boolean, boolean, boolean, boolean, boolean) to authenticated;
