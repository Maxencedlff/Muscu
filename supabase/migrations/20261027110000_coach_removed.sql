-- ═══════════════════════════════════════════════════════════
--  Coach V1, élève retiré (27/10/2026) : un élève retiré par son coach ne peut plus revenir avec
--  aucun code de ce coach, tant que le coach ne l'a pas autorisé (contrat : docs/COACH_V1.md,
--  « Précisions du serveur »). 20261027100000_coach.sql est déjà appliquée en production : elle ne
--  change plus, tout le changement est ici.
--
--  - public.coach_removed (coach_id, student_id, created_at) : mêmes règles que les autres tables du
--    coach (RLS activée sans politique, aucun GRANT, cascade avec auth.users des deux côtés).
--  - coach_remove_student inscrit l'élève (seulement s'il était bien son élève) ; coach_leave
--    n'inscrit rien.
--  - coach_preview et coach_join : le refus passe par private.coach_check_code, qu'elles appellent
--    toutes les deux ; elles-mêmes ne changent pas. L'élève retiré reçoit invalid_code, la même
--    réponse qu'un code faux : rien n'est révélé.
--  - coach_allow_student(student uuid) : lève l'interdiction, silencieuse sinon.
--  - coach_state() renvoie aussi removed: [p] (coach seulement), et pour chaque élève sent: [{ id,
--    sent_at, seen }], les programmes que je lui ai envoyés (seen = seen_at non nul : l'élève l'a
--    ouvert ou ajouté). Rien d'autre que ces trois champs : pas le contenu, déjà connu du coach.
--  - Correction de 20261027100000_coach.sql (déjà en production, donc corrigée ici) : l'app importe un
--    programme reçu sous l'id u_c<8 premiers caractères de l'id du coach>_<prog_id>, et plus
--    u_c<prog_id> (deux coachs successifs peuvent envoyer le même prog_id). Le serveur n'en dépend pas.
--  - Droits : create or replace garde ceux de la fonction remplacée ; ils sont quand même redonnés
--    explicitement en bas (revoke de public et anon, grant à authenticated), comme partout.
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- Élèves retirés par le coach : ils ne peuvent plus le rejoindre (aucun de ses codes) tant qu'il ne
-- les a pas autorisés à revenir (coach_allow_student). Quitter de soi-même n'inscrit rien ici.
create table public.coach_removed (
  coach_id   uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (coach_id, student_id)
);
create index coach_removed_student on public.coach_removed (student_id);

alter table public.coach_removed enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.coach_removed from public, anon, authenticated, service_role;

-- ── Code d'invitation : refus de l'élève retiré ──────────

-- Code valable → coach (encore coach), sinon invalid_code, y compris pour un élève que ce coach a
-- retiré ; mon propre code : not_found ; déjà un autre coach : already_coached ; équipe pleine :
-- team_full (sauf si j'en fais déjà partie). Commun à coach_preview et coach_join.
create or replace function private.coach_check_code(me uuid, code text) returns uuid
  language plpgsql stable security definer set search_path = '' as
$$
declare
  c text := private.coach_code_norm(code);
  coach uuid;
  cur uuid;
begin
  select i.coach_id into coach from public.coach_invites i
    where i.code = c and i.expires_at > now() and private.is_coach(i.coach_id);
  -- Retiré par ce coach : même réponse qu'un code faux (rien n'est révélé)
  if coach is null or exists (select 1 from public.coach_removed r where r.coach_id = coach and r.student_id = me) then
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

-- ── Fonctions RPC ────────────────────────────────────────

-- État de Réglages › Coach et de la cellule de l'onglet Amis.
-- coach : mon coach (since = date du lien). students, removed et invites : vides si je ne suis pas coach.
-- removed : élèves que j'ai retirés (since = date du retrait).
-- students[].sent : programmes que j'ai envoyés à cet élève, { id, sent_at, seen }, du plus récent.
-- students[] : p + last_session_at (ms), sessions_7d, new_sessions, last_session { done_at, label,
-- programme } (valeurs simples). badge_student : programmes et commentaires non vus de mon coach ;
-- badge_coach : total des new_sessions de mes élèves ; badge : leur somme (compatibilité). Un compte
-- coach et élève à la fois a les deux, séparés.
create or replace function public.coach_state() returns jsonb
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
  ,
  b as (
    select
      (select count(*)::int from public.coach_programmes cp, mine
        where cp.student_id = me.id and cp.coach_id = mine.coach_id and cp.seen_at is null)
      + (select count(*)::int from public.coach_notes cn, mine, public.sessions x
          where cn.student_id = me.id and cn.coach_id = mine.coach_id and cn.seen_at is null
            and x.user_id = cn.student_id and x.id = cn.session_id and x.deleted_at is null) as student,
      coalesce((select sum(st.nnew)::int from st), 0) as coach
    from me
  )
  select jsonb_build_object(
    'is_coach', me.coach,
    'coach',    (select private.person(l.coach_id, l.created_at) from public.coach_links l where l.student_id = me.id),
    'students', coalesce((select jsonb_agg(private.person(st.student_id, st.created_at) || jsonb_build_object(
                                 'last_session_at', st.last_at, 'sessions_7d', st.n7,
                                 'new_sessions', st.nnew, 'last_session', st.last_s,
                                 'sent', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'sent_at', cp.sent_at,
                                                                                       'seen', cp.seen_at is not null)
                                                                    order by cp.sent_at desc, cp.id)
                                                   from public.coach_programmes cp
                                                   where cp.student_id = st.student_id and cp.coach_id = me.id), '[]'::jsonb))
                               order by st.created_at desc) from st), '[]'::jsonb),
    'removed',  coalesce((select jsonb_agg(private.person(r.student_id, r.created_at) order by r.created_at desc)
                          from public.coach_removed r where r.coach_id = me.id and me.coach), '[]'::jsonb),
    'invites',  coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'expires_at', i.expires_at) order by i.created_at desc)
                          from public.coach_invites i where i.coach_id = me.id and i.expires_at > now() and me.coach), '[]'::jsonb),
    'badge_coach',   b.coach,
    'badge_student', b.student,
    'badge',         b.coach + b.student
  )
  from me, b
$$;

-- Le coach retire un élève : lien supprimé, programmes et commentaires avec lui (cascade), et l'élève
-- ne peut plus revenir avec aucun code de ce coach (coach_removed) jusqu'à coach_allow_student.
-- Silencieux si ce n'est pas son élève (rien n'est inscrit).
create or replace function public.coach_remove_student(student uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  delete from public.coach_links l where l.coach_id = me and l.student_id = student;
  if found then
    insert into public.coach_removed (coach_id, student_id) values (me, student) on conflict do nothing;
  end if;
end
$$;

-- Autoriser un élève retiré à revenir (il lui faudra un code valable). Silencieux sinon.
create function public.coach_allow_student(student uuid) returns void
  language sql security definer set search_path = '' as
$$ delete from public.coach_removed r where r.coach_id = (select auth.uid()) and r.student_id = student $$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.coach_check_code(uuid, text) from public, anon, authenticated, service_role;

revoke all on function public.coach_state() from public, anon, authenticated;
revoke all on function public.coach_remove_student(uuid) from public, anon, authenticated;
revoke all on function public.coach_allow_student(uuid) from public, anon, authenticated;

grant execute on function public.coach_state() to authenticated;
grant execute on function public.coach_remove_student(uuid) to authenticated;
grant execute on function public.coach_allow_student(uuid) to authenticated;
