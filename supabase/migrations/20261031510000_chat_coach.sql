-- ═══════════════════════════════════════════════════════════
--  Coach V1.2 : messages entre un coach et son élève, texte seul (contrat : docs/COACH_V1.md, section
--  « Messages »). Les migrations du coach déjà en production ne changent pas : tout est ici.
--  Retour arrière : supabase/rollback/20261031510000_chat_coach_down.sql.
--
--  - Une conversation par lien coach ↔ élève (coach_links), désignée par l'élève : le coach passe
--    l'identifiant de son élève (student), l'élève passe null (« avec mon coach »). Aucune ambiguïté
--    même pour un compte à la fois coach et élève (deux liens = deux conversations).
--  - Lecture et écriture seulement entre un coach et ses élèves liés : chaque fonction relit le lien
--    et vérifie que le coach a toujours le rôle (private.chat_thread) ; sinon not_found. Les élèves
--    d'un même coach ne voient jamais les messages des autres.
--  - Lien rompu (l'élève quitte, le coach le retire, un des comptes est supprimé) : les messages
--    partent en cascade avec le lien (clé étrangère vers coach_links (student_id, coach_id)). Rejoindre
--    de nouveau repart d'une conversation vide.
--  - Indépendant du social, comme le reste du coach : ni social_at ni blocage ne sont regardés (c'est
--    l'élève qui a choisi son coach, il peut le quitter à tout moment).
--  - Signaler (report_chat) : copie des 50 derniers messages dans public.chat_reports, sans lien vers
--    coach_links (la preuve survit au départ de l'élève, au retrait par le coach et à la suppression
--    du compte signalé), gardée 12 mois, effacée avec le compte de celui qui signale ; une ligne dans
--    public.reports (file de modération commune, kind profile, target_ref chat_reports:<id>) dont
--    l'app demande l'alerte par e-mail à la fonction Edge report ({ report_id }).
--  - Non-lus : coach_links.chat_coach_read / chat_student_read = id du dernier message lu par chacun,
--    posé seulement par chat_mark_read, jusqu'au dernier message que l'app a reçu (up_to). Écrire ne
--    vaut pas lecture : un message de l'autre arrivé juste avant ma réponse, que l'app n'a pas encore
--    affiché, reste non lu. Messages et marques d'une même conversation passent l'un après l'autre
--    (verrou par lien).
--  - Texte : 1 à 2000 caractères après nettoyage (\r retirés, plus de deux retours à la ligne de suite
--    ramenés à deux, espaces autour retirés). Vide : empty_message ; trop long : too_long. Pas de liste
--    de mots interdits : conversation privée entre deux personnes qui se sont choisies (voir le contrat).
--  - Pas de temps réel : l'app relit la conversation ouverte toutes les 15 s et l'état (chat_threads)
--    avec le reste (premier plan, onglet Amis).
--  - Pagination : 50 messages par page, par id ; before_id : plus anciens que lui (du plus récent au
--    plus ancien) ; after_id : plus récents que lui (du plus ancien au plus récent, pour la relecture).
--  - Limites : 60 messages par heure et 500 par 24 h ; lectures (chat_messages) 900 par heure,
--    chat_threads 600 par heure, chat_mark_read 600 par heure ; signalements : ceux de public.reports
--    (10 par 24 h, tous types confondus).
--  - Erreurs lisibles (P0001) : not_found, empty_message, too_long, invalid_reason, rate_limited.
--  - Sécurité : tables sans GRANT client (RLS activée, aucune politique) ; RPC security definer,
--    search_path vide, utilisateur pris dans auth.uid() ; public et anon perdent le droit d'exécution,
--    seul authenticated le reçoit ; fonctions de private exécutables par aucun rôle de l'API.
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- Dernier message lu par le coach et par l'élève (id de coach_messages ; 0 = rien lu). Pas de GRANT.
alter table public.coach_links
  add column chat_coach_read   bigint not null default 0,
  add column chat_student_read bigint not null default 0;

create table public.coach_messages (
  id         bigint generated always as identity primary key,
  student_id uuid not null,
  coach_id   uuid not null,
  from_coach boolean not null,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  -- Le lien exact (coach compris) : quitter, retirer ou supprimer un compte efface la conversation
  foreign key (student_id, coach_id) references public.coach_links (student_id, coach_id) on delete cascade
);
create index coach_messages_thread on public.coach_messages (student_id, coach_id, id desc);

-- Signalements d'une conversation : copie des 50 derniers messages au moment du signalement
-- (messages : [{ id, from_coach, body, at }], du plus ancien au plus récent). Aucune clé vers
-- coach_links ni vers le compte signalé : la preuve reste quand la conversation est effacée. Effacée
-- avec le compte de celui qui signale ; purgée à 12 mois (déclencheur et pg_cron).
create table public.chat_reports (
  id          bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_user uuid not null,
  student_id  uuid not null,
  coach_id    uuid not null,
  reason      text not null check (reason in ('spam', 'harcelement', 'sexuel', 'violence', 'haine', 'autre')),
  messages    jsonb not null check (jsonb_typeof(messages) = 'array'),
  created_at  timestamptz not null default now(),
  constraint chat_reports_not_self check (reporter_id <> target_user)
);
create index chat_reports_at on public.chat_reports (created_at);
create index chat_reports_reporter on public.chat_reports (reporter_id);

alter table public.coach_messages enable row level security;
alter table public.chat_reports enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.coach_messages, public.chat_reports from public, anon, authenticated, service_role;

-- ── Briques privées ──────────────────────────────────────

-- Conversation de me : student null = avec mon coach (je suis l'élève) ; sinon avec cet élève (je suis
-- son coach). Le coach doit avoir encore le rôle. Renvoie l'élève, le coach et mon rôle ; sinon not_found.
create function private.chat_thread(me uuid, student uuid, out s_id uuid, out c_id uuid, out as_coach boolean)
  language plpgsql stable security definer set search_path = '' as
$$
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if student is null then
    select l.student_id, l.coach_id, false into s_id, c_id, as_coach
      from public.coach_links l where l.student_id = me;
  elsif student <> me then
    select l.student_id, l.coach_id, true into s_id, c_id, as_coach
      from public.coach_links l where l.student_id = student and l.coach_id = me;
  end if;
  if s_id is null or not private.is_coach(c_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end
$$;

-- Verrou de transaction d'une conversation (envoi et marque de lecture l'un après l'autre)
create function private.chat_lock(student uuid) returns void
  language plpgsql set search_path = '' as
$$ begin perform pg_advisory_xact_lock(hashtextextended('chat:' || student::text, 0)); end $$;

-- Texte nettoyé : comme les commentaires (\r retirés, trois retours à la ligne ou plus → deux, espaces autour)
create function private.chat_clean(t text) returns text
  language sql immutable set search_path = '' as
$$ select btrim(regexp_replace(replace(coalesce(t, ''), E'\r', ''), E'\n{3,}', E'\n\n', 'g'), E' \t\n') $$;

-- Messages non lus par me dans une conversation (ceux de l'autre, après ma marque)
create function private.chat_unread(s_id uuid, c_id uuid, as_coach boolean, read_id bigint) returns int
  language sql stable set search_path = '' as
$$
  select count(*)::int from public.coach_messages m
  where m.student_id = s_id and m.coach_id = c_id and m.from_coach <> as_coach and m.id > read_id
$$;

-- Dernier message d'une conversation, vu par me : { id, mine, body (120 caractères), at } ou null
create function private.chat_last(s_id uuid, c_id uuid, as_coach boolean) returns jsonb
  language sql stable set search_path = '' as
$$
  select jsonb_build_object('id', m.id, 'mine', m.from_coach = as_coach, 'body', left(m.body, 120), 'at', m.created_at)
  from public.coach_messages m
  where m.student_id = s_id and m.coach_id = c_id
  order by m.id desc limit 1
$$;

-- Signalements de plus de 12 mois purgés à chaque nouveau signalement (durée annoncée dans privacy.html)
create function private.chat_report_before_insert() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  new.created_at := now();
  delete from public.chat_reports r where r.created_at < now() - interval '12 months';
  return new;
end
$$;
create trigger chat_reports_before_insert before insert on public.chat_reports
  for each row execute function private.chat_report_before_insert();

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- Envoyer un message. Renvoie { id, mine: true, body, at }.
create function public.chat_send(body text, student uuid default null) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  t text := private.chat_clean(chat_send.body);
  th record;
  m public.coach_messages;
begin
  th := private.chat_thread(me, chat_send.student);
  if t = '' then raise exception 'empty_message' using errcode = 'P0001'; end if;
  if char_length(t) > 2000 then raise exception 'too_long' using errcode = 'P0001'; end if;
  perform private.rate_limit_window(me, 'chat_h', 60, interval '1 hour');
  perform private.rate_limit(me, 'chat', 500);
  perform private.chat_lock(th.s_id);
  begin
    insert into public.coach_messages (student_id, coach_id, from_coach, body)
      values (th.s_id, th.c_id, th.as_coach, t)
      returning * into m;
  exception when foreign_key_violation then
    -- Le lien a été rompu entre la vérification et l'écriture
    raise exception 'not_found' using errcode = 'P0001';
  end;
  -- Pas de marque de lecture : mes messages ne comptent jamais comme non lus pour moi, et un message
  -- de l'autre arrivé avant le mien n'a peut-être pas encore été affiché (chat_mark_read le marquera)
  return jsonb_build_object('id', m.id, 'mine', true, 'body', m.body, 'at', m.created_at);
end
$$;

-- Messages d'une conversation, 50 par page. Sans curseur : les plus récents (du plus récent au plus
-- ancien) ; before_id : plus anciens que lui (même ordre) ; after_id : plus récents que lui (du plus
-- ancien au plus récent). mine : envoyé par moi.
create function public.chat_messages(student uuid default null, before_id bigint default null, after_id bigint default null)
  returns table (id bigint, mine boolean, body text, at timestamptz)
  language plpgsql security definer set search_path = '' as
$$
#variable_conflict use_column
declare
  me uuid := (select auth.uid());
  th record;
begin
  th := private.chat_thread(me, chat_messages.student);
  perform private.rate_limit_window(me, 'chat_read', 900, interval '1 hour');
  if chat_messages.after_id is not null then
    return query
      select m.id, m.from_coach = th.as_coach, m.body, m.created_at
      from public.coach_messages m
      where m.student_id = th.s_id and m.coach_id = th.c_id and m.id > chat_messages.after_id
      order by m.id asc limit 50;
  else
    return query
      select m.id, m.from_coach = th.as_coach, m.body, m.created_at
      from public.coach_messages m
      where m.student_id = th.s_id and m.coach_id = th.c_id
        and (chat_messages.before_id is null or m.id < chat_messages.before_id)
      order by m.id desc limit 50;
  end if;
end
$$;

-- Conversation lue (ouverture, nouveaux messages affichés) jusqu'à up_to, l'id du dernier message que
-- l'app a reçu (null : jusqu'au dernier message). Un message arrivé après la lecture de l'app reste non
-- lu. La marque ne recule jamais.
create function public.chat_mark_read(student uuid default null, up_to bigint default null) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  th record;
  last_id bigint;
begin
  th := private.chat_thread(me, chat_mark_read.student);
  perform private.rate_limit_window(me, 'chat_seen', 600, interval '1 hour');
  perform private.chat_lock(th.s_id);
  select coalesce(max(m.id), 0) into last_id from public.coach_messages m
    where m.student_id = th.s_id and m.coach_id = th.c_id
      and (chat_mark_read.up_to is null or m.id <= chat_mark_read.up_to);
  if th.as_coach then
    update public.coach_links l set chat_coach_read = greatest(l.chat_coach_read, last_id)
      where l.student_id = th.s_id and l.coach_id = th.c_id;
  else
    update public.coach_links l set chat_student_read = greatest(l.chat_student_read, last_id)
      where l.student_id = th.s_id and l.coach_id = th.c_id;
  end if;
end
$$;

-- Signaler la conversation (student null : avec mon coach ; sinon avec cet élève). Copie des 50
-- derniers messages dans chat_reports (même une conversation vide : le signalement porte alors sur la
-- personne), puis une ligne dans public.reports pour l'alerte (déclencheur : 10 par 24 h, pseudo visé,
-- purge à 12 mois ; rate_limited annule aussi la copie). Renvoie l'id de la ligne de public.reports.
create function public.report_chat(reason text, student uuid default null) returns bigint
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  th record;
  other uuid;
  cr_id bigint;
  n int;
  rep_id bigint;
begin
  if report_chat.reason is null
     or report_chat.reason not in ('spam', 'harcelement', 'sexuel', 'violence', 'haine', 'autre') then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;
  th := private.chat_thread(me, report_chat.student);
  other := case when th.as_coach then th.s_id else th.c_id end;
  -- Aucun message ne passe pendant la copie
  perform private.chat_lock(th.s_id);
  insert into public.chat_reports (reporter_id, target_user, student_id, coach_id, reason, messages)
    select me, other, th.s_id, th.c_id, report_chat.reason,
           coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'from_coach', x.from_coach, 'body', x.body, 'at', x.created_at)
                              order by x.id), '[]'::jsonb)
    from (select m.id, m.from_coach, m.body, m.created_at from public.coach_messages m
          where m.student_id = th.s_id and m.coach_id = th.c_id order by m.id desc limit 50) x
    returning id, jsonb_array_length(messages) into cr_id, n;
  insert into public.reports (reporter_id, target_user, kind, target_ref, reason, details)
    values (me, other, 'profile', 'chat_reports:' || cr_id, report_chat.reason,
            'Conversation coach : ' || n || ' derniers messages copiés dans public.chat_reports, n° ' || cr_id ||
            case when th.as_coach then ' (signalé par le coach).' else ' (signalé par l''élève).' end)
    returning id into rep_id;
  return rep_id;
end
$$;

-- Mes conversations : { coach: { unread, last } | null (avec mon coach, s'il a encore le rôle),
-- students: [{ student_id, unread, last }] (mes élèves, si je suis coach), unread } ; unread = total.
create function public.chat_threads() returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  mine jsonb;
  list jsonb;
begin
  if me is null then return jsonb_build_object('coach', null, 'students', '[]'::jsonb, 'unread', 0); end if;
  perform private.rate_limit_window(me, 'chat_threads', 600, interval '1 hour');
  select jsonb_build_object('unread', private.chat_unread(l.student_id, l.coach_id, false, l.chat_student_read),
                            'last', private.chat_last(l.student_id, l.coach_id, false))
    into mine
    from public.coach_links l where l.student_id = me and private.is_coach(l.coach_id);
  select coalesce(jsonb_agg(jsonb_build_object('student_id', l.student_id,
                              'unread', private.chat_unread(l.student_id, l.coach_id, true, l.chat_coach_read),
                              'last', private.chat_last(l.student_id, l.coach_id, true))
                            order by l.created_at desc), '[]'::jsonb)
    into list
    from public.coach_links l where l.coach_id = me and private.is_coach(me);
  return jsonb_build_object('coach', mine, 'students', list,
    'unread', coalesce((mine ->> 'unread')::int, 0)
              + coalesce((select sum((e ->> 'unread')::int) from jsonb_array_elements(list) e), 0)::int);
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.chat_thread(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.chat_lock(uuid) from public, anon, authenticated, service_role;
revoke all on function private.chat_clean(text) from public, anon, authenticated, service_role;
revoke all on function private.chat_unread(uuid, uuid, boolean, bigint) from public, anon, authenticated, service_role;
revoke all on function private.chat_last(uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.chat_report_before_insert() from public, anon, authenticated, service_role;

revoke all on function public.chat_send(text, uuid) from public, anon, authenticated;
revoke all on function public.chat_messages(uuid, bigint, bigint) from public, anon, authenticated;
revoke all on function public.chat_mark_read(uuid, bigint) from public, anon, authenticated;
revoke all on function public.chat_threads() from public, anon, authenticated;
revoke all on function public.report_chat(text, uuid) from public, anon, authenticated;

grant execute on function public.chat_send(text, uuid) to authenticated;
grant execute on function public.chat_messages(uuid, bigint, bigint) to authenticated;
grant execute on function public.chat_mark_read(uuid, bigint) to authenticated;
grant execute on function public.chat_threads() to authenticated;
grant execute on function public.report_chat(text, uuid) to authenticated;

-- Purge quotidienne des signalements de conversation de plus de 12 mois (03:19 UTC) avec pg_cron,
-- comme public.reports (20261026050000_social.sql). Sans l'extension (tests locaux), seule la purge
-- du déclencheur reste.
do $cron$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-chat-reports-12-mois', '19 3 * * *',
      $job$delete from public.chat_reports where created_at < now() - interval '12 months'$job$);
  end if;
end
$cron$;

-- Modération (éditeur SQL, rôle postgres) : une conversation signalée (n° donné par l'alerte)
--   select r.*, jsonb_array_elements(r.messages) from public.chat_reports r where r.id = <n°>;
