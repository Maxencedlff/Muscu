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
--    l'élève qui a choisi son coach, il peut le quitter à tout moment ; signaler passe par la fonction
--    Edge report, kind profile).
--  - Non-lus : coach_links.chat_coach_read / chat_student_read = id du dernier message lu par chacun
--    (posé par chat_mark_read). Messages et marques d'une même conversation passent l'un après l'autre
--    (verrou par lien) : un message envoyé pendant la lecture n'est jamais compté lu sans avoir été vu.
--  - Texte : 1 à 2000 caractères après nettoyage (\r retirés, plus de deux retours à la ligne de suite
--    ramenés à deux, espaces autour retirés). Vide : empty_message ; trop long : too_long. Pas de liste
--    de mots interdits : conversation privée entre deux personnes qui se sont choisies (voir le contrat).
--  - Pas de temps réel : l'app relit la conversation ouverte toutes les 15 s et l'état (chat_threads)
--    avec le reste (premier plan, onglet Amis).
--  - Pagination : 50 messages par page, par id ; before_id : plus anciens que lui (du plus récent au
--    plus ancien) ; after_id : plus récents que lui (du plus ancien au plus récent, pour la relecture).
--  - Limites : 60 messages par heure et 500 par 24 h ; lectures (chat_messages) 900 par heure,
--    chat_threads 600 par heure, chat_mark_read 600 par heure.
--  - Erreurs lisibles (P0001) : not_found, empty_message, too_long, rate_limited.
--  - Sécurité : table sans GRANT client (RLS activée, aucune politique) ; RPC security definer,
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

alter table public.coach_messages enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.coach_messages from public, anon, authenticated, service_role;

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
  -- Mon propre message est lu par moi
  if th.as_coach then
    update public.coach_links l set chat_coach_read = m.id where l.student_id = th.s_id and l.coach_id = th.c_id;
  else
    update public.coach_links l set chat_student_read = m.id where l.student_id = th.s_id and l.coach_id = th.c_id;
  end if;
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

-- Conversation lue jusqu'au dernier message (ouverture, nouveaux messages affichés)
create function public.chat_mark_read(student uuid default null) returns void
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
    where m.student_id = th.s_id and m.coach_id = th.c_id;
  if th.as_coach then
    update public.coach_links l set chat_coach_read = greatest(l.chat_coach_read, last_id)
      where l.student_id = th.s_id and l.coach_id = th.c_id;
  else
    update public.coach_links l set chat_student_read = greatest(l.chat_student_read, last_id)
      where l.student_id = th.s_id and l.coach_id = th.c_id;
  end if;
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

revoke all on function public.chat_send(text, uuid) from public, anon, authenticated;
revoke all on function public.chat_messages(uuid, bigint, bigint) from public, anon, authenticated;
revoke all on function public.chat_mark_read(uuid) from public, anon, authenticated;
revoke all on function public.chat_threads() from public, anon, authenticated;

grant execute on function public.chat_send(text, uuid) to authenticated;
grant execute on function public.chat_messages(uuid, bigint, bigint) to authenticated;
grant execute on function public.chat_mark_read(uuid) to authenticated;
grant execute on function public.chat_threads() to authenticated;
