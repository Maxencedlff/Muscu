-- ═══════════════════════════════════════════════════════════
--  Coach V1 : un coach suit des élèves, voit leurs séances, les commente et leur envoie des
--  programmes (contrat : docs/COACH_V1.md).
--
--  Sécurité :
--  - Devenir coach : user_profiles.coach_at, posé à la main par l'administrateur (éditeur SQL, rôle
--    postgres). Aucune RPC ne l'écrit et aucun GRANT par colonne ne le rend modifiable par le client
--    (le client n'écrit que username et avatar_emoji, voir 20261026000000_profils.sql). La migration
--    ne touche aucun compte. Commande à lancer à part :
--      update public.user_profiles set coach_at = now() where user_id = '<uuid>';
--  - Aucune lecture ni écriture directe sur coach_invites, coach_links, coach_programmes et
--    coach_notes : RLS activée sans aucune politique, aucun GRANT à anon, authenticated ni
--    service_role. Tout passe par les fonctions RPC ci-dessous, security definer (propriétaire
--    postgres), search_path vide et utilisateur pris dans auth.uid(), jamais dans un paramètre.
--  - Un coach ne voit que ses élèves : chaque fonction côté coach vérifie le lien (coach_id = moi,
--    student_id = l'élève) et que je suis encore coach ; sinon not_found (not_coach pour inviter,
--    envoyer un programme ou commenter sans être coach). Les élèves ne voient jamais rien les uns des
--    autres : côté élève, seules les lignes où student_id = moi sortent.
--  - Couper l'accès : programmes et commentaires ont une clé étrangère vers le lien
--    (student_id, coach_id) on delete cascade. Quitter (coach_leave) ou retirer
--    (coach_remove_student) supprime le lien, donc tout le reste dans la même transaction ; et
--    coach_student_sessions relit le lien à chaque appel : l'accès tombe immédiatement.
--  - Liste blanche : une séance montrée au coach passe par private.session_for_coach, qui recopie
--    private.session_public (mêmes champs, mêmes bornes) plus id, notes et hidden. Jamais bodyKg,
--    healthSaved, ni une clé ajoutée plus tard dans sessions.data.
--  - Indépendant du social : ni social_at ni blocage ne sont regardés ; être coach ou élève ne rend
--    visible dans aucune recherche.
--  - Limites : 10 aperçus ou adhésions par heure (coach_preview et coach_join comptés ensemble),
--    30 envois de programme par 24 h, 20 codes créés par 24 h (journal private.social_rate) ;
--    5 codes actifs par coach (le plus ancien remplacé), 50 élèves par coach (team_full).
--  - Erreurs lisibles par l'app (message exact, errcode P0001) : not_coach, already_coached,
--    invalid_code, team_full, not_found, rate_limited, too_long, invalid_programme.
--  - Suppression du compte : toutes les lignes partent en cascade avec auth.users (coach ou élève).
--  - GRANT explicites : chaque RPC perd le droit d'exécution donné par défaut à public (et à anon par
--    Supabase), puis seul authenticated le reçoit. Les fonctions de private : aucun rôle de l'API.
--
--  Choix pris là où le contrat ne disait rien (à relire) :
--  1. Débit de coach_join : Postgres annule tout ce qu'une fonction a écrit quand elle lève une
--     erreur (et PostgREST lance chaque RPC dans sa transaction). Un essai refusé (invalid_code…) ne
--     peut donc pas rester compté sans changer la forme des erreurs du contrat : seuls les essais
--     réussis comptent dans les 10 par heure (ils limitent le remplissage d'une équipe et les
--     aperçus en rafale). La défense contre la devinette des codes est leur taille : 32^8 ≈ 1,1e12
--     codes possibles, au plus 5 actifs par coach pendant 7 jours. Un code trouvé n'ouvre d'ailleurs
--     rien chez le coach : l'élève donne au coach l'accès à SES séances, pas l'inverse.
--  2. Rejoindre le coach qu'on a déjà (nouvel essai après une coupure réseau) : renvoie le coach,
--     sans erreur ; already_coached seulement pour un autre coach. coach_preview pareil.
--  3. coach_preview renvoie since = null (aucun lien encore) ; coach_join, la date du lien.
--  4. Codes : saisie normalisée (majuscules, espaces et tirets retirés). Un code dont le coach n'est
--     plus coach répond invalid_code.
--  5. Coach dont l'administrateur retire coach_at : toutes les fonctions côté coach lui répondent
--     not_coach ou not_found (accès coupé), ses codes deviennent invalides, ses élèves voient encore
--     le lien dans coach_state (pour pouvoir le quitter) et leur boîte. coach_remove_student marche
--     toujours (retirer un accès est toujours permis).
--  6. coach_student_sessions : séances non supprimées et datées, au plus 24 h dans le futur (comme
--     le fil) ; les séances masquées aux abonnés sont comprises. notes tronquées à 2000 caractères.
--  7. coach_send_programme : prog_id = 1 à 64 caractères [A-Za-z0-9_-] (l'app en fait u_c<prog_id>),
--     data = objet JSON, sinon invalid_programme ; plus de 200 Ko (texte JSON) : too_long.
--  8. coach_set_note : séance de l'élève inexistante ou supprimée : not_found ; texte rogné des
--     espaces autour ; plus de 1000 caractères : too_long.
--  9. student_inbox, badge : seulement ce qui vient du coach actuel ; commentaires des séances
--     supprimées exclus. student_mark_seen et coach_revoke_invite : silencieux sur une référence
--     inconnue ou un kind inconnu.
--  10. new_sessions (ajout du 27/10) : séances non supprimées dont done_at (date de la séance) est
--     postérieur à coach_seen_at, ou à la date du lien tant que le coach n'a rien ouvert (un nouvel
--     élève n'arrive pas avec 300 « nouvelles » séances). coach_mark_seen : not_found si ce n'est
--     pas mon élève ou si je ne suis plus coach.
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- Coach : date à laquelle l'administrateur a donné le rôle, null sinon. Pas de GRANT par colonne.
alter table public.user_profiles add column coach_at timestamptz;

-- Codes d'invitation : 8 caractères lisibles, sans 0/O/1/I (32 symboles)
create table public.coach_invites (
  code       text primary key check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  coach_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index coach_invites_coach on public.coach_invites (coach_id, created_at);

-- Un élève a au plus un coach (clé primaire sur student_id)
create table public.coach_links (
  student_id    uuid primary key references auth.users(id) on delete cascade,
  coach_id      uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  -- Dernière ouverture des séances de l'élève par le coach (new_sessions, badge du coach)
  coach_seen_at timestamptz,
  constraint coach_links_not_self check (coach_id <> student_id),
  -- Cible des clés étrangères de coach_programmes et coach_notes (le lien exact, coach compris)
  unique (student_id, coach_id)
);
create index coach_links_coach on public.coach_links (coach_id, created_at);

-- Programmes envoyés. Supprimés avec le lien (quitter, retirer) ou un des deux comptes.
create table public.coach_programmes (
  student_id uuid not null,
  coach_id   uuid not null,
  id         text not null check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  data       jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 204800),
  sent_at    timestamptz not null default now(),
  seen_at    timestamptz,
  primary key (student_id, id),
  foreign key (student_id, coach_id) references public.coach_links (student_id, coach_id) on delete cascade
);

-- Commentaire du coach sur une séance de l'élève. Supprimé avec le lien ou la séance.
create table public.coach_notes (
  student_id uuid not null,
  coach_id   uuid not null,
  session_id text not null,
  text       text not null check (char_length(text) between 1 and 1000),
  updated_at timestamptz not null default now(),
  seen_at    timestamptz,
  primary key (student_id, session_id),
  foreign key (student_id, coach_id) references public.coach_links (student_id, coach_id) on delete cascade,
  foreign key (student_id, session_id) references public.sessions (user_id, id) on delete cascade
);

alter table public.coach_invites enable row level security;
alter table public.coach_links enable row level security;
alter table public.coach_programmes enable row level security;
alter table public.coach_notes enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.coach_invites, public.coach_links, public.coach_programmes, public.coach_notes
  from public, anon, authenticated, service_role;

-- ── Briques privées ──────────────────────────────────────

-- Suis-je coach ?
create function private.is_coach(uid uuid) returns boolean
  language sql stable set search_path = '' as
$$ select exists (select 1 from public.user_profiles p where p.user_id = uid and p.coach_at is not null) $$;

-- Limite sur une fenêtre glissante (même journal et même principe que private.rate_limit, qui est
-- fixé à 24 h) : refuse (rate_limited) au-delà de max_n, sinon compte l'action
create function private.rate_limit_window(uid uuid, action text, max_n int, win interval) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  perform pg_advisory_xact_lock(hashtextextended('social_rate:' || action || ':' || uid::text, 0));
  delete from private.social_rate r where r.user_id = uid and r.action = rate_limit_window.action and r.at < now() - win;
  if (select count(*) from private.social_rate r
      where r.user_id = uid and r.action = rate_limit_window.action and r.at >= now() - win) >= max_n then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into private.social_rate (user_id, action) values (uid, rate_limit_window.action);
end
$$;

-- Code saisi → forme stockée (majuscules, sans espaces ni tirets), ou null s'il ne peut pas exister
create function private.coach_code_norm(c text) returns text
  language sql immutable set search_path = '' as
$$
  select case when v ~ '^[A-HJ-NP-Z2-9]{8}$' then v end
  from (select upper(regexp_replace(coalesce(c, ''), '[\s-]', '', 'g')) as v) x
$$;

-- Nouveau code aléatoire : 8 octets entièrement aléatoires d'un UUID v4 (les octets 6 et 8 portent
-- la version et la variante, ils sont évités), chacun réduit à 32 symboles (256 = 8 × 32 : pas de biais)
create function private.coach_new_code() returns text
  language sql volatile set search_path = '' as
$$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', get_byte(b, i) % 32 + 1, 1), '' order by i)
  from (select uuid_send(gen_random_uuid()) as b) r, unnest(array[0, 1, 2, 3, 4, 5, 10, 11]) i
$$;

-- Code valable → coach (encore coach), sinon invalid_code ; mon propre code : not_found ; déjà un
-- autre coach : already_coached ; équipe pleine : team_full (sauf si j'en fais déjà partie).
-- Commun à coach_preview et coach_join.
create function private.coach_check_code(me uuid, code text) returns uuid
  language plpgsql stable security definer set search_path = '' as
$$
declare
  c text := private.coach_code_norm(code);
  coach uuid;
  cur uuid;
begin
  select i.coach_id into coach from public.coach_invites i
    where i.code = c and i.expires_at > now() and private.is_coach(i.coach_id);
  if coach is null then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  if coach = me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select l.coach_id into cur from public.coach_links l where l.student_id = me;
  if cur = coach then return coach; end if;
  if cur is not null then
    raise exception 'already_coached' using errcode = 'P0001';
  end if;
  if (select count(*) from public.coach_links l where l.coach_id = coach) >= 50 then
    raise exception 'team_full' using errcode = 'P0001';
  end if;
  return coach;
end
$$;

-- Liste blanche d'une séance vue par le coach : private.session_public + id, notes (2000 caractères
-- au plus, texte seulement) et hidden (true, ou absent). Clés absentes ou nulles omises.
create function private.session_for_coach(id text, data jsonb) returns jsonb
  language sql immutable set search_path = '' as
$$
  select private.session_public(data) || jsonb_strip_nulls(jsonb_build_object(
    'id',     id,
    'notes',  case when jsonb_typeof(data -> 'notes') = 'string' then to_jsonb(left(data ->> 'notes', 2000)) end,
    'hidden', case when coalesce(data ->> 'hidden', '') = 'true' then true end
  ))
$$;

-- L'élève de ce coach (lien existant et coach encore coach), sinon not_found
create function private.coach_require_student(me uuid, student uuid) returns void
  language plpgsql stable security definer set search_path = '' as
$$
begin
  if me is null or student is null or not private.is_coach(me)
     or not exists (select 1 from public.coach_links l where l.coach_id = me and l.student_id = student) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end
$$;

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- État de Réglages › Coach et de la cellule de l'onglet Amis.
-- coach : mon coach (since = date du lien). students et invites : vides si je ne suis pas coach.
-- students[] : p + last_session_at (ms), sessions_7d, new_sessions, last_session { done_at, label,
-- programme } (valeurs simples). badge : programmes et commentaires non vus de mon coach + total des
-- new_sessions de mes élèves.
create function public.coach_state() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (
    select u.id, private.is_coach(u.id) as coach, private.max_done_at() as max_at,
           (extract(epoch from now() - interval '7 days') * 1000)::bigint as week_at
    from (select (select auth.uid()) as id) u
  ),
  st as (
    select l.student_id, l.created_at,
      (select max(x.done_at) from public.sessions x
        where x.user_id = l.student_id and x.deleted_at is null and x.done_at is not null and x.done_at <= me.max_at) as last_at,
      (select count(*)::int from public.sessions x
        where x.user_id = l.student_id and x.deleted_at is null and x.done_at >= me.week_at and x.done_at <= me.max_at) as n7,
      (select count(*)::int from public.sessions x
        where x.user_id = l.student_id and x.deleted_at is null and x.done_at <= me.max_at
          and x.done_at > (extract(epoch from coalesce(l.coach_seen_at, l.created_at)) * 1000)::bigint) as nnew,
      (select jsonb_build_object('done_at', x.done_at, 'label', private.scalar(x.data -> 'label'),
                                 'programme', private.scalar(x.data -> 'programme'))
         from public.sessions x
        where x.user_id = l.student_id and x.deleted_at is null and x.done_at is not null and x.done_at <= me.max_at
        order by x.done_at desc, x.id desc limit 1) as last_s
    from me join public.coach_links l on l.coach_id = me.id
    where me.coach
  ),
  mine as (
    select l.coach_id from me join public.coach_links l on l.student_id = me.id
  )
  select jsonb_build_object(
    'is_coach', me.coach,
    'coach',    (select private.person(l.coach_id, l.created_at) from public.coach_links l where l.student_id = me.id),
    'students', coalesce((select jsonb_agg(private.person(st.student_id, st.created_at) || jsonb_build_object(
                                 'last_session_at', st.last_at, 'sessions_7d', st.n7,
                                 'new_sessions', st.nnew, 'last_session', st.last_s)
                               order by st.created_at desc) from st), '[]'::jsonb),
    'invites',  coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'expires_at', i.expires_at) order by i.created_at desc)
                          from public.coach_invites i where i.coach_id = me.id and i.expires_at > now() and me.coach), '[]'::jsonb),
    'badge',    (select count(*)::int from public.coach_programmes cp, mine
                  where cp.student_id = me.id and cp.coach_id = mine.coach_id and cp.seen_at is null)
              + (select count(*)::int from public.coach_notes cn, mine, public.sessions x
                  where cn.student_id = me.id and cn.coach_id = mine.coach_id and cn.seen_at is null
                    and x.user_id = cn.student_id and x.id = cn.session_id and x.deleted_at is null)
              + coalesce((select sum(st.nnew)::int from st), 0)
  )
  from me
$$;

-- Nouveau code d'invitation, valable 7 jours. Codes expirés du coach purgés ; au-delà de 5 codes
-- actifs, les plus anciens sont supprimés. 20 créations par 24 h.
create function public.coach_create_invite() returns text
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  c text;
begin
  if me is null or not private.is_coach(me) then
    raise exception 'not_coach' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_invites:' || me::text, 0));
  perform private.rate_limit_window(me, 'coach_invite', 20, interval '24 hours');
  delete from public.coach_invites i where i.coach_id = me and i.expires_at <= now();
  delete from public.coach_invites i
    where i.code in (select i2.code from public.coach_invites i2 where i2.coach_id = me
                     order by i2.created_at desc, i2.code offset 4);
  loop
    c := private.coach_new_code();
    -- clock_timestamp : ordre de création exact, même pour plusieurs codes dans une transaction
    insert into public.coach_invites (code, coach_id, created_at, expires_at)
      values (c, me, clock_timestamp(), now() + interval '7 days') on conflict do nothing;
    exit when found;
  end loop;
  return c;
end
$$;

-- Supprimer un de mes codes (silencieux sinon)
create function public.coach_revoke_invite(code text) returns void
  language sql security definer set search_path = '' as
$$
  delete from public.coach_invites i
  where i.coach_id = (select auth.uid()) and i.code = private.coach_code_norm(coach_revoke_invite.code)
$$;

-- Qui est le coach de ce code, avant d'accepter ; rien n'est créé
create function public.coach_preview(code text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  coach uuid;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform private.rate_limit_window(me, 'coach_code', 10, interval '1 hour');
  coach := private.coach_check_code(me, code);
  return private.person(coach, null);
end
$$;

-- Rejoindre le coach de ce code. Verrou par coach : deux adhésions simultanées ne dépassent pas 50.
create function public.coach_join(code text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  coach uuid;
  since timestamptz;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform private.rate_limit_window(me, 'coach_code', 10, interval '1 hour');
  coach := private.coach_check_code(me, code);
  perform pg_advisory_xact_lock(hashtextextended('coach_team:' || coach::text, 0));
  coach := private.coach_check_code(me, code);   -- relu sous le verrou
  begin
    insert into public.coach_links (student_id, coach_id) values (me, coach) on conflict do nothing;
  exception when foreign_key_violation then
    raise exception 'invalid_code' using errcode = 'P0001';
  end;
  select l.created_at into since from public.coach_links l where l.student_id = me and l.coach_id = coach;
  if since is null then
    -- Un autre coach a été rejoint en même temps (autre transaction)
    raise exception 'already_coached' using errcode = 'P0001';
  end if;
  return private.person(coach, since);
end
$$;

-- L'élève quitte son coach : lien supprimé, programmes et commentaires avec lui (cascade)
create function public.coach_leave() returns void
  language sql security definer set search_path = '' as
$$ delete from public.coach_links l where l.student_id = (select auth.uid()) $$;

-- Le coach retire un élève : même effet (silencieux si ce n'est pas son élève)
create function public.coach_remove_student(student uuid) returns void
  language sql security definer set search_path = '' as
$$ delete from public.coach_links l where l.coach_id = (select auth.uid()) and l.student_id = student $$;

-- Séances d'un de mes élèves, 30 par page, par (done_at, id) décroissant. Page suivante : before_at
-- et before_id = done_at et id de la dernière ligne (before_at seul : strictement plus anciennes).
-- note : mon commentaire sur la séance.
create function public.coach_student_sessions(student uuid, before_at bigint default null, before_id text default null)
  returns table (id text, done_at bigint, s jsonb, note text)
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  perform private.coach_require_student(me, student);
  return query
    select x.id, x.done_at, private.session_for_coach(x.id, x.data), n.text
    from public.sessions x
    left join public.coach_notes n on n.student_id = x.user_id and n.session_id = x.id and n.coach_id = me
    where x.user_id = student and x.deleted_at is null and x.done_at is not null
      and x.done_at <= private.max_done_at()
      and (before_at is null
           or x.done_at < before_at
           or (before_id is not null and x.done_at = before_at and x.id < before_id))
    order by x.done_at desc, x.id desc
    limit 30;
end
$$;

-- Le coach a ouvert les séances de cet élève : new_sessions repart de zéro
create function public.coach_mark_seen(student uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  perform private.coach_require_student(me, student);
  update public.coach_links l set coach_seen_at = now() where l.coach_id = me and l.student_id = student;
end
$$;

-- Envoyer (ou mettre à jour) un programme à un de mes élèves ; seen_at remis à null. 30 par 24 h.
-- sent_at et updated_at (commentaires) en clock_timestamp : ordre exact dans student_inbox.
create function public.coach_send_programme(student uuid, prog_id text, data jsonb) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or not private.is_coach(me) then
    raise exception 'not_coach' using errcode = 'P0001';
  end if;
  perform private.coach_require_student(me, student);
  if prog_id is null or prog_id !~ '^[A-Za-z0-9_-]{1,64}$' or data is null or jsonb_typeof(data) <> 'object' then
    raise exception 'invalid_programme' using errcode = 'P0001';
  end if;
  if octet_length(data::text) > 204800 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;
  perform private.rate_limit_window(me, 'coach_send', 30, interval '24 hours');
  begin
    insert into public.coach_programmes (student_id, coach_id, id, data, sent_at)
      values (student, me, prog_id, data, clock_timestamp())
      on conflict on constraint coach_programmes_pkey do update
        set data = excluded.data, coach_id = excluded.coach_id, sent_at = excluded.sent_at, seen_at = null;
  exception when foreign_key_violation then
    -- L'élève est parti entre la vérification et l'écriture
    raise exception 'not_found' using errcode = 'P0001';
  end;
end
$$;

-- Commenter une séance d'un de mes élèves ; texte vide (ou null) = supprimer. seen_at remis à null.
create function public.coach_set_note(student uuid, session_id text, text text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  t text := btrim(coalesce(coach_set_note.text, ''));
begin
  if me is null or not private.is_coach(me) then
    raise exception 'not_coach' using errcode = 'P0001';
  end if;
  perform private.coach_require_student(me, student);
  if t = '' then
    delete from public.coach_notes n
      where n.student_id = student and n.session_id = coach_set_note.session_id and n.coach_id = me;
    return;
  end if;
  if char_length(t) > 1000 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.sessions x
                 where x.user_id = student and x.id = coach_set_note.session_id and x.deleted_at is null) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  begin
    insert into public.coach_notes (student_id, coach_id, session_id, text, updated_at)
      values (student, me, coach_set_note.session_id, t, clock_timestamp())
      on conflict on constraint coach_notes_pkey do update
        set text = excluded.text, coach_id = excluded.coach_id, updated_at = excluded.updated_at, seen_at = null;
  exception when foreign_key_violation then
    raise exception 'not_found' using errcode = 'P0001';
  end;
end
$$;

-- Boîte de l'élève : programmes et commentaires de son coach actuel (séances non supprimées)
create function public.student_inbox() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id),
  mine as (select l.coach_id, l.student_id from me join public.coach_links l on l.student_id = me.id)
  select jsonb_build_object(
    'programmes', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'data', cp.data, 'sent_at', cp.sent_at,
                                                                'seen', cp.seen_at is not null) order by cp.sent_at desc, cp.id)
                            from mine join public.coach_programmes cp
                              on cp.student_id = mine.student_id and cp.coach_id = mine.coach_id), '[]'::jsonb),
    'notes',      coalesce((select jsonb_agg(jsonb_build_object('session_id', cn.session_id, 'text', cn.text,
                                                                'updated_at', cn.updated_at, 'seen', cn.seen_at is not null)
                                             order by cn.updated_at desc, cn.session_id)
                            from mine join public.coach_notes cn
                              on cn.student_id = mine.student_id and cn.coach_id = mine.coach_id
                            join public.sessions x on x.user_id = cn.student_id and x.id = cn.session_id and x.deleted_at is null), '[]'::jsonb)
  )
$$;

-- L'élève a vu un programme ou un commentaire (badge)
create function public.student_mark_seen(kind text, ref text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if kind = 'programme' then
    update public.coach_programmes cp set seen_at = now() where cp.student_id = me and cp.id = ref and cp.seen_at is null;
  elsif kind = 'note' then
    update public.coach_notes cn set seen_at = now() where cn.student_id = me and cn.session_id = ref and cn.seen_at is null;
  end if;
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.is_coach(uuid) from public, anon, authenticated, service_role;
revoke all on function private.rate_limit_window(uuid, text, int, interval) from public, anon, authenticated, service_role;
revoke all on function private.coach_code_norm(text) from public, anon, authenticated, service_role;
revoke all on function private.coach_new_code() from public, anon, authenticated, service_role;
revoke all on function private.coach_check_code(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.session_for_coach(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.coach_require_student(uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function public.coach_state() from public, anon, authenticated;
revoke all on function public.coach_create_invite() from public, anon, authenticated;
revoke all on function public.coach_revoke_invite(text) from public, anon, authenticated;
revoke all on function public.coach_preview(text) from public, anon, authenticated;
revoke all on function public.coach_join(text) from public, anon, authenticated;
revoke all on function public.coach_leave() from public, anon, authenticated;
revoke all on function public.coach_remove_student(uuid) from public, anon, authenticated;
revoke all on function public.coach_student_sessions(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.coach_mark_seen(uuid) from public, anon, authenticated;
revoke all on function public.coach_send_programme(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.coach_set_note(uuid, text, text) from public, anon, authenticated;
revoke all on function public.student_inbox() from public, anon, authenticated;
revoke all on function public.student_mark_seen(text, text) from public, anon, authenticated;

grant execute on function public.coach_state() to authenticated;
grant execute on function public.coach_create_invite() to authenticated;
grant execute on function public.coach_revoke_invite(text) to authenticated;
grant execute on function public.coach_preview(text) to authenticated;
grant execute on function public.coach_join(text) to authenticated;
grant execute on function public.coach_leave() to authenticated;
grant execute on function public.coach_remove_student(uuid) to authenticated;
grant execute on function public.coach_student_sessions(uuid, bigint, text) to authenticated;
grant execute on function public.coach_mark_seen(uuid) to authenticated;
grant execute on function public.coach_send_programme(uuid, text, jsonb) to authenticated;
grant execute on function public.coach_set_note(uuid, text, text) to authenticated;
grant execute on function public.student_inbox() to authenticated;
grant execute on function public.student_mark_seen(text, text) to authenticated;
