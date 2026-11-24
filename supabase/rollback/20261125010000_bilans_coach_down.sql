-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261125010000_bilans_coach.sql (à lancer à la main, dans l'éditeur SQL,
--  seulement si Maxence décide de retirer les bilans configurables). Pas dans migrations/ : Supabase ne l'applique
--  jamais de lui-même.
--
--  Avant : remettre l'OTA d'avant et l'appli web du coach d'avant (une version à jour sur ce serveur voit les RPC
--  absentes, PGRST202, et ne montre pas les bilans).
--
--  Effet : les modèles, groupes, plannings, demandes, réponses, retours du coach et accords du cycle sont
--  SUPPRIMÉS (aucune copie gardée : ce sont des données de santé, docs/BILANS.md). Les notifications checkin et
--  checkin_reminder encore en file sont retirées ; la contrainte push_outbox_kind_check, private.push_wanted et
--  private.push_valid reprennent leur texte de 20261117050000_messages_coach.sql (push_claim n'a pas changé). Les
--  tâches pg_cron bilans-coach-envoi et bilans-coach-purge sont retirées si elles existent. Les lignes
--  « checkin_send » du journal private.social_rate sont retirées. Les photos de bilan (public.coach_photos) ne
--  sont pas touchées.
--  push-send peut rester tel quel : il ne reçoit plus ces deux types.
--
--  Ordre : à défaire AVANT tout retour arrière plus ancien (supabase/rollback/ORDRE.md). Vérifié par
--  tests/sql/bilans_coach_rollback_test.sh (pg_dump identique à une base où la migration n'a jamais été appliquée).
-- ═══════════════════════════════════════════════════════════

begin;

-- Planification (absente du Postgres local des tests : cron.job n'existe pas sans son extension)
do $cron$
begin
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'bilans-coach-envoi') then perform cron.unschedule('bilans-coach-envoi'); end if;
    if exists (select 1 from cron.job where jobname = 'bilans-coach-purge') then perform cron.unschedule('bilans-coach-purge'); end if;
  end if;
end
$cron$;

-- RPC
drop function public.coach_checkin_setup();
drop function public.coach_template_save(uuid, text, jsonb);
drop function public.coach_template_duplicate(uuid);
drop function public.coach_template_delete(uuid);
drop function public.coach_group_save(uuid, text, uuid[]);
drop function public.coach_group_delete(uuid);
drop function public.coach_schedule_save(uuid, uuid, uuid, text, int, int, int, text, int, int, boolean);
drop function public.coach_schedule_delete(uuid);
drop function public.coach_checkin_send_now(uuid, uuid[]);
drop function public.coach_checkins_overview();
drop function public.coach_student_checkins(uuid, int);
drop function public.coach_checkin_review(uuid, text, int, boolean);
drop function public.student_checkins();
drop function public.student_checkin_answer(uuid, jsonb);
drop function public.student_checkin_cycle(boolean, boolean);

-- Notifications : textes de 20261117050000_messages_coach.sql, file sans les deux types, contrainte d'avant
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

delete from private.push_outbox o where o.kind in ('checkin', 'checkin_reminder');
alter table private.push_outbox drop constraint push_outbox_kind_check;
alter table private.push_outbox add constraint push_outbox_kind_check
  check (kind in ('reaction', 'follow_request', 'coach_note', 'coach_programme', 'comment', 'chat_message', 'student_session',
                  'student_digest'));

-- Briques privées
drop function private.checkin_tick(timestamptz);
drop function private.checkin_purge(timestamptz);
drop function private.checkin_open(uuid, uuid, uuid, uuid, timestamptz, int, int, date);
drop function private.checkin_advance(text, int, int, text, timestamptz);
drop function private.checkin_next_at(text, int, int, int, text, timestamptz);
drop function private.checkin_coach();
drop function private.checkin_my_student(uuid, uuid);
drop function private.checkin_template_json(public.coach_checkin_templates);
drop function private.checkin_schedule_json(public.coach_checkin_schedules);
drop function private.checkin_group_json(public.coach_groups);
drop function private.checkin_value_ok(jsonb, jsonb);
drop function private.checkin_value_clean(jsonb, jsonb);
drop function private.checkin_number(jsonb, text);
drop function private.checkin_items_ok(jsonb);
drop function private.checkin_item_ok(jsonb);
drop function private.checkin_item_clean(jsonb);
drop function private.checkin_text(text, int);
drop function private.checkin_trim(text);
drop function private.checkin_line(text, int);
drop function private.checkin_kinds();

-- Données (réponses et retours partent avec les demandes)
drop table public.coach_checkin_answers;
drop table public.coach_checkin_reviews;
drop table public.coach_checkin_requests;
drop table public.coach_checkin_schedules;
drop table public.coach_group_members;
drop table public.coach_groups;
drop table public.coach_checkin_templates;
drop table public.checkin_cycle_consents;

delete from private.social_rate r where r.action = 'checkin_send';

commit;
