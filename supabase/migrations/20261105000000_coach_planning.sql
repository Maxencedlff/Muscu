-- ═══════════════════════════════════════════════════════════
--  Planification du coach (05/11/2026, demande des coachs partenaires) : le coach découpe le suivi
--  de chaque élève en phases (« Mini cut, 6 semaines à partir du 9 nov. »), les voit sur une frise et
--  voit où en est chaque élève (« semaine 3 sur 6 »). L'élève voit sa phase en cours, sans la note.
--  Contrat : docs/COACH_SUIVI.md, « Planification ».
--
--  Sécurité :
--  - public.coach_phases (student_id, coach_id, …) : clé étrangère vers le lien EXACT coach_links
--    (student_id, coach_id) on delete cascade. Quitter le coach, être retiré, supprimer un des deux
--    comptes efface le planning dans la même transaction. Un nouveau coach repart d'un planning vide :
--    il ne voit jamais celui de l'ancien.
--  - Écritures par le seul coach de l'élève, encore coach (private.coach_require_student) ; lecture
--    par ce coach (avec sa note) et par l'élève lui-même (sans la note, qui est un pense-bête du coach).
--    Les autres élèves du coach, les amis, un autre coach : rien (aucune fonction ne le leur donne).
--  - Aucune lecture ni écriture directe : RLS activée sans politique, aucun GRANT sur la table ni sur sa
--    séquence ; RPC security definer, search_path vide, utilisateur pris dans auth.uid() ; anon n'exécute
--    rien.
--  - Phases sans chevauchement pour un même élève (overlap) : « où en est l'élève » n'a qu'une réponse.
--    Garanti par une contrainte d'exclusion (btree_gist, extension proposée par Supabase, dans le schéma
--    extensions) ; en plus, écritures d'un même élève l'une après l'autre (verrou par élève) pour un
--    message clair. La RPC traduit 23P01 en overlap et une clé étrangère cassée (lien rompu pendant
--    l'appel) en not_found.
--  - L'élève ne reçoit ni la note du coach ni l'identifiant des phases (séquence globale : il ne doit
--    rien pouvoir en déduire sur les autres élèves).
--  - Bornes : 30 phases par élève, 1 à 52 semaines, début entre le 1er janvier 2020 et dans 2 ans, nom
--    40 caractères, programme 40, note 500. 120 enregistrements par heure et par coach (private.social_rate).
--  - Rôle de coach retiré par l'administrateur : il ne lit ni n'écrit plus (not_found), coach_plans()
--    est vide ; le planning reste tant que le lien existe et l'élève le voit encore.
--
--  Réversible : supabase/rollback/20261105000000_coach_planning_down.sql (efface le planning).
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- Égalité sur uuid dans un index GiST (contrainte d'exclusion plus bas). Sur Supabase, les extensions
-- vont dans le schéma extensions (doc officielle, « Database › Extensions » : btree_gist y figure).
create extension if not exists btree_gist with schema extensions;

-- Une phase : objectif, début (jour du calendrier, pas un instant : une phase se compte en semaines du
-- calendrier, quel que soit le fuseau), durée en semaines, nom du programme suivi (facultatif, recopié
-- par le coach : son programme vit sur son appareil), note du coach (lue par lui seul).
create table public.coach_phases (
  id         bigint generated always as identity primary key,
  student_id uuid not null,
  coach_id   uuid not null,
  name       text not null default '' check (char_length(name) <= 40),
  goal       text not null check (goal in ('bulk', 'cut', 'mini_cut', 'maintain', 'comeback', 'strength', 'prep', 'deload', 'other')),
  start_on   date not null,
  weeks      smallint not null check (weeks between 1 and 52),
  prog_name  text check (prog_name is null or char_length(prog_name) between 1 and 40),
  note       text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Le lien exact (coach compris) : lien rompu = planning effacé
  foreign key (student_id, coach_id) references public.coach_links (student_id, coach_id) on delete cascade,
  -- Deux phases d'un même élève chez un même coach ne se chevauchent jamais (bord à bord permis)
  constraint coach_phases_no_overlap exclude using gist
    (student_id with =, coach_id with =, daterange(start_on, start_on + weeks * 7) with &&)
);
create index coach_phases_student on public.coach_phases (student_id, coach_id, start_on);

alter table public.coach_phases enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.coach_phases from public, anon, authenticated, service_role;
revoke all on sequence public.coach_phases_id_seq from public, anon, authenticated, service_role;

-- ── Briques privées ──────────────────────────────────────

-- Texte d'une ligne (nom, programme) : caractères de contrôle remplacés, espaces resserrés, rogné
create function private.plan_line(t text) returns text
  language sql immutable set search_path = '' as
$$ select btrim(regexp_replace(regexp_replace(coalesce(t, ''), '[[:cntrl:]]', ' ', 'g'), ' {2,}', ' ', 'g')) $$;

-- Note (plusieurs lignes) : retours chariot retirés, 2 lignes vides au plus, rognée
create function private.plan_note(t text) returns text
  language sql immutable set search_path = '' as
$$ select btrim(regexp_replace(replace(coalesce(t, ''), E'\r', ''), E'\n{3,}', E'\n\n', 'g'), E' \t\n') $$;

-- Planning d'un élève vu par son coach : phases du plus ancien début au plus récent, note comprise
create function private.coach_plan_of(coach uuid, student uuid) returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'goal', p.goal, 'start', to_char(p.start_on, 'YYYY-MM-DD'), 'weeks', p.weeks,
      'prog_name', p.prog_name, 'note', p.note, 'updated_at', p.updated_at) order by p.start_on, p.id), '[]'::jsonb)
  from public.coach_phases p
  where p.student_id = coach_plan_of.student and p.coach_id = coach_plan_of.coach
$$;

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- Coach : le planning de tous mes élèves (y compris ceux sans phase), dans l'ordre des liens.
-- { students: [{ student_id, phases: [...] }] } ; vide si je ne suis pas (ou plus) coach.
create function public.coach_plans() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id)
  select jsonb_build_object('students', coalesce((
    select jsonb_agg(jsonb_build_object('student_id', l.student_id, 'phases', private.coach_plan_of(me.id, l.student_id))
                     order by l.created_at, l.student_id)
    from me join public.coach_links l on l.coach_id = me.id
    where private.is_coach(me.id)), '[]'::jsonb))
$$;

-- Élève : mon planning chez mon coach actuel, SANS la note du coach, son identifiant ni celui des phases.
-- { coach: bool, phases: [{ name, goal, start, weeks, prog_name }] }
create function public.student_plan() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id),
  l as (select cl.student_id, cl.coach_id from me join public.coach_links cl on cl.student_id = me.id)
  select jsonb_build_object(
    'coach', exists (select 1 from l),
    'phases', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.name, 'goal', p.goal, 'start', to_char(p.start_on, 'YYYY-MM-DD'),
                                          'weeks', p.weeks, 'prog_name', p.prog_name) order by p.start_on, p.id)
      from l join public.coach_phases p on p.student_id = l.student_id and p.coach_id = l.coach_id), '[]'::jsonb))
$$;

-- Coach : créer (phase_id null) ou modifier une phase d'un de mes élèves. Renvoie son planning
-- (private.coach_plan_of). Erreurs : not_found (pas mon élève, plus coach, phase inconnue),
-- invalid_phase (objectif, date ou durée hors bornes), too_long, overlap (chevauche une autre phase),
-- too_many (30 phases), rate_limited (120 par heure).
create function public.coach_plan_save(student uuid, phase_id bigint, name text, goal text, start_date date, weeks int,
                                       programme text default null, note text default null) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  n  text := private.plan_line(coach_plan_save.name);
  pg text := nullif(private.plan_line(coach_plan_save.programme), '');
  nt text := private.plan_note(coach_plan_save.note);
  ends date;
begin
  perform private.coach_require_student(me, coach_plan_save.student);
  -- Un enregistrement à la fois par élève : deux phases écrites en même temps ne se chevauchent pas
  perform pg_advisory_xact_lock(hashtextextended('coach_plan:' || coach_plan_save.student::text, 0));
  if coach_plan_save.goal is null
     or coach_plan_save.goal not in ('bulk', 'cut', 'mini_cut', 'maintain', 'comeback', 'strength', 'prep', 'deload', 'other')
     or coach_plan_save.start_date is null or coach_plan_save.start_date < date '2020-01-01'
     or coach_plan_save.start_date > current_date + 730
     or coach_plan_save.weeks is null or coach_plan_save.weeks < 1 or coach_plan_save.weeks > 52 then
    raise exception 'invalid_phase' using errcode = 'P0001';
  end if;
  if char_length(n) > 40 or char_length(coalesce(pg, '')) > 40 or char_length(nt) > 500 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;
  ends := coach_plan_save.start_date + coach_plan_save.weeks * 7;   -- premier jour après la phase
  if exists (select 1 from public.coach_phases p
             where p.student_id = coach_plan_save.student and p.coach_id = me
               and p.id is distinct from coach_plan_save.phase_id
               and p.start_on < ends and coach_plan_save.start_date < p.start_on + p.weeks * 7) then
    raise exception 'overlap' using errcode = 'P0001';
  end if;
  if coach_plan_save.phase_id is null then
    if (select count(*) from public.coach_phases p where p.student_id = coach_plan_save.student and p.coach_id = me) >= 30 then
      raise exception 'too_many' using errcode = 'P0001';
    end if;
    perform private.rate_limit_window(me, 'coach_plan', 120, interval '1 hour');
    begin
      insert into public.coach_phases (student_id, coach_id, name, goal, start_on, weeks, prog_name, note)
        values (coach_plan_save.student, me, n, coach_plan_save.goal, coach_plan_save.start_date, coach_plan_save.weeks, pg, nt);
    exception
      when exclusion_violation then raise exception 'overlap' using errcode = 'P0001';
      when foreign_key_violation then raise exception 'not_found' using errcode = 'P0001';   -- lien rompu entre-temps
    end;
  else
    perform private.rate_limit_window(me, 'coach_plan', 120, interval '1 hour');
    begin
      update public.coach_phases p
        set name = n, goal = coach_plan_save.goal, start_on = coach_plan_save.start_date, weeks = coach_plan_save.weeks,
            prog_name = pg, note = nt, updated_at = now()
        where p.id = coach_plan_save.phase_id and p.student_id = coach_plan_save.student and p.coach_id = me;
    exception
      when exclusion_violation then raise exception 'overlap' using errcode = 'P0001';
    end;
    if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  end if;
  return private.coach_plan_of(me, coach_plan_save.student);
end
$$;

-- Coach : supprimer une phase d'un de mes élèves (silencieux si elle n'existe pas). Renvoie son planning.
-- Jamais limité : retirer une information doit rester toujours possible.
create function public.coach_plan_delete(student uuid, phase_id bigint) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  perform private.coach_require_student(me, coach_plan_delete.student);
  perform pg_advisory_xact_lock(hashtextextended('coach_plan:' || coach_plan_delete.student::text, 0));
  delete from public.coach_phases p
    where p.id = coach_plan_delete.phase_id and p.student_id = coach_plan_delete.student and p.coach_id = me;
  return private.coach_plan_of(me, coach_plan_delete.student);
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.plan_line(text) from public, anon, authenticated, service_role;
revoke all on function private.plan_note(text) from public, anon, authenticated, service_role;
revoke all on function private.coach_plan_of(uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function public.coach_plans() from public, anon, authenticated;
revoke all on function public.student_plan() from public, anon, authenticated;
revoke all on function public.coach_plan_save(uuid, bigint, text, text, date, int, text, text) from public, anon, authenticated;
revoke all on function public.coach_plan_delete(uuid, bigint) from public, anon, authenticated;

grant execute on function public.coach_plans() to authenticated;
grant execute on function public.student_plan() to authenticated;
grant execute on function public.coach_plan_save(uuid, bigint, text, text, date, int, text, text) to authenticated;
grant execute on function public.coach_plan_delete(uuid, bigint) to authenticated;
