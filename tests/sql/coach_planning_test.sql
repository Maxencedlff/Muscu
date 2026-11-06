-- Vérifications de supabase/migrations/20261105000000_coach_planning.sql (lancées par tests/sql/run.sh) :
-- planning par élève écrit par son seul coach, lu par lui (avec sa note) et par l'élève (sans la note),
-- personne d'autre ; bornes, chevauchement, effacement avec le lien. Chaque bloc échoue (raise) si la
-- règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.qu('k') → …0000000000e1, l → e2, s → e3, t → e4, a → e5) : K kim.q1 et L lea.q1
-- sont coachs ; S sol.q1 et T tom.q1 sont élèves de K ; A ami.q1 (ni coach ni élève).

create function pg_temp.qerr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.qu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000000e' || translate(c, 'klsta', '12345'))::uuid $$;
create function pg_temp.qlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.qu(c)::text, ''), false) $$;
-- Enregistrer une phase (format de l'app) : renvoie le planning, ou l'erreur
create function pg_temp.qsave(student text, id bigint, goal text, start text, weeks int, name text default '', prog text default null, note text default null)
  returns text language plpgsql as
$$ begin return public.coach_plan_save(pg_temp.qu(student), id, name, goal, start::date, weeks, prog, note)::text;
   exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.qerr(text), pg_temp.qu(text), pg_temp.qlogin(text),
  pg_temp.qsave(text, bigint, text, text, int, text, text, text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.qu(c) from unnest(array['k', 'l', 's', 't', 'a']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.qu('k'), 'kim.q1', '🦁'), (pg_temp.qu('l'), 'lea.q1', '🦊'), (pg_temp.qu('s'), 'sol.q1', '🦅'),
  (pg_temp.qu('t'), 'tom.q1', '🐼'), (pg_temp.qu('a'), 'ami.q1', '⭐');
update public.user_profiles set coach_at = now() where user_id in (pg_temp.qu('k'), pg_temp.qu('l'));
insert into public.coach_links (student_id, coach_id) values (pg_temp.qu('s'), pg_temp.qu('k')), (pg_temp.qu('t'), pg_temp.qu('k'));

-- ── Droits : table fermée, anon n'exécute rien ; contrainte d'exclusion en place ──
do $$
declare f text;
begin
  if not exists (select 1 from pg_constraint where conname = 'coach_phases_no_overlap' and contype = 'x') then raise 'contrainte d''exclusion absente'; end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.coach_phases'::regclass) then raise 'RLS désactivée'; end if;
  if exists (select 1 from pg_policies where tablename = 'coach_phases') then raise 'politique inattendue'; end if;
  foreach f in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(f, 'public.coach_phases', 'select') or has_table_privilege(f, 'public.coach_phases', 'insert')
       or has_table_privilege(f, 'public.coach_phases', 'update') or has_table_privilege(f, 'public.coach_phases', 'delete')
       or has_sequence_privilege(f, 'public.coach_phases_id_seq', 'usage') then
      raise 'droit direct sur le planning pour %', f; end if;
  end loop;
  foreach f in array array['public.coach_plans()', 'public.student_plan()',
                           'public.coach_plan_save(uuid, bigint, text, text, date, int, text, text)', 'public.coach_plan_delete(uuid, bigint)'] loop
    if has_function_privilege('anon', f, 'execute') then raise 'anon exécute %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise 'authenticated n''exécute pas %', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure) then raise 'security definer / search_path : %', f; end if;
  end loop;
  foreach f in array array['private.plan_line(text)', 'private.plan_note(text)', 'private.coach_plan_of(uuid, uuid)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise 'brique privée exécutable : %', f; end if;
  end loop;
end $$;

set role anon;
do $$ begin
  if pg_temp.qerr($q$ select public.coach_plans() $q$) not like 'permission denied%' then raise 'anon : coach_plans'; end if;
  if pg_temp.qerr($q$ select public.student_plan() $q$) not like 'permission denied%' then raise 'anon : student_plan'; end if;
  if pg_temp.qerr(format('select public.coach_plan_save(%L, null, %L, %L, %L, 6)', pg_temp.qu('s'), 'x', 'cut', '2026-11-09')) not like 'permission denied%' then raise 'anon : coach_plan_save'; end if;
  if pg_temp.qerr($q$ select * from public.coach_phases $q$) not like 'permission denied%' then raise 'anon : table'; end if;
end $$;
reset role;

set role authenticated;

-- ── Par défaut : planning vide ───────────────────────────
do $$
declare p jsonb;
begin
  perform pg_temp.qlogin('k');
  p := public.coach_plans();
  if jsonb_array_length(p -> 'students') <> 2 or exists (select 1 from jsonb_array_elements(p -> 'students') x where x -> 'phases' <> '[]'::jsonb)
    then raise 'coach : planning vide attendu : %', p; end if;
  perform pg_temp.qlogin('s');
  if public.student_plan() is distinct from '{"coach": true, "phases": []}'::jsonb then raise 'élève : %', public.student_plan(); end if;
  perform pg_temp.qlogin('a');
  if public.student_plan() is distinct from '{"coach": false, "phases": []}'::jsonb then raise 'sans coach : %', public.student_plan(); end if;
  if public.coach_plans() is distinct from '{"students": []}'::jsonb then raise 'pas coach : %', public.coach_plans(); end if;
end $$;

-- ── Le coach écrit ; bornes ──────────────────────────────
do $$
declare r text; p jsonb; id1 bigint;
begin
  perform pg_temp.qlogin('k');
  r := pg_temp.qsave('s', null, 'mini_cut', '2026-11-09', 6, E'  Mini\tcut   Dylan ', 'Sèche 4 jours', E'Objectif −3 kg\r\n\n\n\nvacances');
  p := r::jsonb;
  if jsonb_array_length(p) <> 1 then raise 'création : %', r; end if;
  if p -> 0 ->> 'name' <> 'Mini cut Dylan' or p -> 0 ->> 'goal' <> 'mini_cut' or p -> 0 ->> 'start' <> '2026-11-09'
     or (p -> 0 ->> 'weeks')::int <> 6 or p -> 0 ->> 'prog_name' <> 'Sèche 4 jours' or p -> 0 ->> 'note' <> E'Objectif −3 kg\n\nvacances'
    then raise 'phase nettoyée : %', p -> 0; end if;
  id1 := (p -> 0 ->> 'id')::bigint;
  -- Bornes
  if pg_temp.qsave('s', null, 'sumo', '2027-01-04', 4) <> 'invalid_phase' then raise 'objectif inconnu'; end if;
  if pg_temp.qsave('s', null, null, '2027-01-04', 4) <> 'invalid_phase' then raise 'objectif null'; end if;
  if pg_temp.qsave('s', null, 'cut', '2027-01-04', 0) <> 'invalid_phase' then raise '0 semaine'; end if;
  if pg_temp.qsave('s', null, 'cut', '2027-01-04', 53) <> 'invalid_phase' then raise '53 semaines'; end if;
  if pg_temp.qsave('s', null, 'cut', '2019-12-31', 4) <> 'invalid_phase' then raise 'avant 2020'; end if;
  if pg_temp.qsave('s', null, 'cut', (current_date + 731)::text, 4) <> 'invalid_phase' then raise 'dans plus de 2 ans'; end if;
  if pg_temp.qsave('s', null, 'cut', null, 4) <> 'invalid_phase' then raise 'date null'; end if;
  if pg_temp.qsave('s', null, 'cut', '2027-01-04', null) <> 'invalid_phase' then raise 'durée null'; end if;
end $$;

do $$
declare r text; p jsonb; id1 bigint; id2 bigint;
begin
  perform pg_temp.qlogin('k');
  if pg_temp.qsave('s', null, 'cut', '2027-01-04', 4, repeat('x', 41)) <> 'too_long' then raise 'nom de 41'; end if;
  if pg_temp.qsave('s', null, 'cut', '2027-01-04', 4, '', repeat('x', 41)) <> 'too_long' then raise 'programme de 41'; end if;
  if pg_temp.qsave('s', null, 'cut', '2027-01-04', 4, '', null, repeat('x', 501)) <> 'too_long' then raise 'note de 501'; end if;
  -- Chevauchement : la phase du 9 nov. dure jusqu'au 20 déc. inclus (6 semaines)
  if pg_temp.qsave('s', null, 'bulk', '2026-12-20', 4) <> 'overlap' then raise 'dernier jour chevauché'; end if;
  if pg_temp.qsave('s', null, 'bulk', '2026-10-27', 2) <> 'overlap' then raise 'fin chevauchée (27 oct. + 2 semaines = 9 nov.)'; end if;
  if pg_temp.qsave('s', null, 'bulk', '2026-11-16', 1) <> 'overlap' then raise 'phase dedans'; end if;
  -- Bord à bord : accepté (avant et après)
  p := pg_temp.qsave('s', null, 'bulk', '2026-12-21', 12, '', '', '   ')::jsonb;
  if jsonb_array_length(p) <> 2 or p -> 1 ->> 'prog_name' is not null or p -> 1 ->> 'note' <> '' or p -> 1 ->> 'name' <> '' then raise 'phase suivante : %', p; end if;
  p := pg_temp.qsave('s', null, 'comeback', '2026-10-26', 2)::jsonb;
  if jsonb_array_length(p) <> 3 or p -> 0 ->> 'goal' <> 'comeback' then raise 'ordre par date de début : %', p; end if;
  id1 := (p -> 1 ->> 'id')::bigint;   -- mini cut
  id2 := (p -> 2 ->> 'id')::bigint;   -- prise de masse
  -- Modifier : la phase elle-même ne se chevauche pas ; une autre oui
  p := pg_temp.qsave('s', id1, 'mini_cut', '2026-11-09', 6, 'Mini cut', 'Sèche 4 jours', 'Objectif −3 kg')::jsonb;
  if p -> 1 ->> 'name' <> 'Mini cut' or p -> 1 ->> 'note' <> 'Objectif −3 kg' then raise 'modification : %', p -> 1; end if;
  if pg_temp.qsave('s', id1, 'mini_cut', '2026-11-09', 7) <> 'overlap' then raise 'allongée sur la suivante'; end if;
  -- La phase d'un autre élève, ou inconnue : not_found
  if pg_temp.qsave('t', id1, 'cut', '2027-06-07', 4) <> 'not_found' then raise 'phase de S modifiée via T'; end if;
  if pg_temp.qsave('s', 999999999, 'cut', '2027-06-07', 4) <> 'not_found' then raise 'phase inconnue'; end if;
  -- T : son propre planning, indépendant de celui de S (mêmes dates permises)
  if jsonb_array_length(pg_temp.qsave('t', null, 'cut', '2026-11-09', 6)::jsonb) <> 1 then raise 'planning de T'; end if;
end $$;

-- ── Lecture : coach avec la note, élève sans, personne d'autre ──
do $$
declare p jsonb; ph jsonb;
begin
  perform pg_temp.qlogin('k');
  p := public.coach_plans();
  if (select jsonb_array_length(x -> 'phases') from jsonb_array_elements(p -> 'students') x where x ->> 'student_id' = pg_temp.qu('s')::text) <> 3
     or (select jsonb_array_length(x -> 'phases') from jsonb_array_elements(p -> 'students') x where x ->> 'student_id' = pg_temp.qu('t')::text) <> 1
    then raise 'coach_plans : %', p; end if;
  -- L'élève : ses phases, sans note ni coach
  perform pg_temp.qlogin('s');
  p := public.student_plan();
  if jsonb_array_length(p -> 'phases') <> 3 then raise 'élève : %', p; end if;
  for ph in select * from jsonb_array_elements(p -> 'phases') loop
    if (select array_agg(k order by k) from jsonb_object_keys(ph) k) is distinct from array['goal', 'name', 'prog_name', 'start', 'weeks']
      then raise 'clés vues par l''élève (ni note, ni coach, ni identifiant) : %', ph; end if;
  end loop;
  if p::text like '%Objectif%' then raise 'note du coach vue par l''élève'; end if;
  -- L'élève n'écrit pas, ne lit pas par la fonction du coach
  if pg_temp.qsave('s', null, 'cut', '2028-01-03', 4) <> 'not_found' then raise 'élève écrit'; end if;
  if public.coach_plans() is distinct from '{"students": []}'::jsonb then raise 'élève lit coach_plans'; end if;
  -- Autre élève du même coach : seulement le sien
  perform pg_temp.qlogin('t');
  if jsonb_array_length(public.student_plan() -> 'phases') <> 1 then raise 'T voit le planning de S'; end if;
  -- Autre coach, ami : rien
  perform pg_temp.qlogin('l');
  if pg_temp.qsave('s', null, 'cut', '2028-01-03', 4) <> 'not_found' then raise 'autre coach écrit'; end if;
  if pg_temp.qerr(format('select public.coach_plan_delete(%L, 1)', pg_temp.qu('s'))) <> 'not_found' then raise 'autre coach supprime'; end if;
  if public.coach_plans() is distinct from '{"students": []}'::jsonb then raise 'autre coach lit'; end if;
  perform pg_temp.qlogin('a');
  if pg_temp.qsave('s', null, 'cut', '2028-01-03', 4) <> 'not_found' then raise 'ami écrit'; end if;
  if pg_temp.qerr($q$ select * from public.coach_phases $q$) not like 'permission denied%' then raise 'ami : table'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  if pg_temp.qsave('s', null, 'cut', '2028-01-03', 4) <> 'not_found' then raise 'sans utilisateur'; end if;
end $$;

-- Aucune autre fonction ne lit le planning (fil, profils, coach_state…)
reset role;
do $$ begin
  if exists (select 1 from pg_proc p where p.prosrc ilike '%coach_phases%'
             and p.proname not in ('coach_plans', 'student_plan', 'coach_plan_save', 'coach_plan_delete', 'coach_plan_of')) then
    raise 'une autre fonction lit le planning : %', (select string_agg(p.proname, ', ') from pg_proc p where p.prosrc ilike '%coach_phases%'); end if;
end $$;
set role authenticated;

-- ── Supprimer, limites ───────────────────────────────────
do $$
declare p jsonb; i int;
begin
  perform pg_temp.qlogin('k');
  p := public.coach_plans();
  p := public.coach_plan_delete(pg_temp.qu('s'), ((select x -> 'phases' -> 0 ->> 'id' from jsonb_array_elements(p -> 'students') x where x ->> 'student_id' = pg_temp.qu('s')::text))::bigint);
  if jsonb_array_length(p) <> 2 or p -> 0 ->> 'goal' <> 'mini_cut' then raise 'suppression : %', p; end if;
  -- Suppression d'une phase inconnue : silencieuse
  if jsonb_array_length(public.coach_plan_delete(pg_temp.qu('s'), 999999999)) <> 2 then raise 'suppression silencieuse'; end if;
  -- 30 phases par élève (T en a 1) : la 31e est refusée
  for i in 1..29 loop
    if pg_temp.qsave('t', null, 'maintain', (date '2027-01-04' + (i - 1) * 7)::text, 1) not like '[%' then raise 'phase % de T', i; end if;
  end loop;
  if pg_temp.qsave('t', null, 'maintain', '2028-01-03', 1) <> 'too_many' then raise '31e phase'; end if;
end $$;
reset role;
do $$
begin
  -- 120 enregistrements par heure (le coach en a fait 36 réussis jusqu'ici)
  delete from private.social_rate where user_id = pg_temp.qu('k') and action = 'coach_plan';
  insert into private.social_rate (user_id, action) select pg_temp.qu('k'), 'coach_plan' from generate_series(1, 120);
  set local role authenticated;
  perform pg_temp.qlogin('k');
  if pg_temp.qsave('s', null, 'cut', '2028-06-05', 4) <> 'rate_limited' then raise 'limite des enregistrements'; end if;
  -- Supprimer n'est jamais limité
  if pg_temp.qerr(format('select public.coach_plan_delete(%L, 999999999)', pg_temp.qu('s'))) <> 'ok' then raise 'suppression limitée'; end if;
end $$;

-- ── Lien rompu, rôle retiré, compte supprimé ─────────────
do $$
declare p jsonb;
begin
  -- Rôle de coach retiré : plus de lecture ni d'écriture ; l'élève voit encore son planning
  update public.user_profiles set coach_at = null where user_id = pg_temp.qu('k');
  set local role authenticated;
  perform pg_temp.qlogin('k');
  if public.coach_plans() is distinct from '{"students": []}'::jsonb then raise 'ex-coach lit'; end if;
  if pg_temp.qsave('s', null, 'cut', '2028-06-05', 4) <> 'not_found' then raise 'ex-coach écrit'; end if;
  perform pg_temp.qlogin('s');
  if jsonb_array_length(public.student_plan() -> 'phases') <> 2 then raise 'élève : planning gardé tant que le lien existe'; end if;
  reset role;
  update public.user_profiles set coach_at = now() where user_id = pg_temp.qu('k');
  -- L'élève quitte : planning effacé ; un nouveau coach repart de zéro
  set local role authenticated;
  perform pg_temp.qlogin('s');
  perform public.coach_leave();
  reset role;
  if exists (select 1 from public.coach_phases where student_id = pg_temp.qu('s')) then raise 'quitter garde le planning'; end if;
  insert into public.coach_links (student_id, coach_id) values (pg_temp.qu('s'), pg_temp.qu('l'));
  set local role authenticated;
  perform pg_temp.qlogin('s');
  if public.student_plan() -> 'phases' <> '[]'::jsonb then raise 'planning repris chez le nouveau coach'; end if;
  -- Retiré par le coach : effacé
  perform pg_temp.qlogin('k');
  perform public.coach_plan_delete(pg_temp.qu('t'), 0);
  reset role;
  if (select count(*) from public.coach_phases where student_id = pg_temp.qu('t')) <> 30 then raise 'T : 30 phases'; end if;
  set local role authenticated;
  perform pg_temp.qlogin('k');
  perform public.coach_remove_student(pg_temp.qu('t'));
  reset role;
  if exists (select 1 from public.coach_phases where student_id = pg_temp.qu('t')) then raise 'retrait garde le planning'; end if;
  -- Compte du coach supprimé : cascade
  set local role authenticated;
  perform pg_temp.qlogin('l');
  p := public.coach_plan_save(pg_temp.qu('s'), null, '', 'strength', date '2026-11-02', 8);
  reset role;
  delete from auth.users where id = pg_temp.qu('l');
  if exists (select 1 from public.coach_phases where student_id = pg_temp.qu('s')) then raise 'cascade coach'; end if;
end $$;
reset role;
-- Nettoyage : les tests suivants partent d'une base sans ces comptes
delete from auth.users where id in (select pg_temp.qu(c) from unnest(array['k', 's', 't', 'a']) c);
delete from private.social_rate where user_id in (select pg_temp.qu(c) from unnest(array['k', 'l', 's', 't', 'a']) c);
