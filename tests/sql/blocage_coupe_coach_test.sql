-- Vérifications de supabase/migrations/20261127010000_blocage_coupe_coach.sql (lancées par tests/sql/run.sh) :
-- un blocage entre un élève et son coach, dans un sens ou dans l'autre, supprime leur lien et tout ce qui en dépend
-- (même cascade que coach_leave) ; plus aucune lecture ni écriture du coach sur cet élève ; impossible de se relier
-- tant que le blocage dure (invalid_code, comme un code faux) ; débloquer permet de revenir avec un code ; un
-- blocage avec un tiers ne touche à aucun lien ; fonctions des déclencheurs exécutables par aucun rôle de l'API.
-- Comptes simulés : K coach de S, L coach de T, M coach de U, A ni coach ni élève.

create function pg_temp.bu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000bc' || translate(c, 'klmstua', '1234567') || '00')::uuid $$;
create function pg_temp.blogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.bu(c)::text, ''), false) $$;
create function pg_temp.berr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.bu(text), pg_temp.blogin(text), pg_temp.berr(text) to authenticated, anon;

insert into auth.users (id) select pg_temp.bu(c) from unnest(array['k', 'l', 'm', 's', 't', 'u', 'a']) c;
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at) values
  (pg_temp.bu('k'), 'kim.bc', '🦁', now()), (pg_temp.bu('l'), 'lou.bc', '🦊', now()), (pg_temp.bu('m'), 'max.bc', '🦊', now()),
  (pg_temp.bu('s'), 'sol.bc', '🦅', null), (pg_temp.bu('t'), 'tom.bc', '🐼', null), (pg_temp.bu('u'), 'uma.bc', '🐼', null),
  (pg_temp.bu('a'), 'ami.bc', '⭐', null);
insert into public.coach_links (student_id, coach_id) values
  (pg_temp.bu('s'), pg_temp.bu('k')), (pg_temp.bu('t'), pg_temp.bu('l')), (pg_temp.bu('u'), pg_temp.bu('m'));
-- Ce qui n'existe que sous le lien de S avec K : séance commentée, programme, partage du poids, conversation, phase
insert into public.sessions (user_id, id, data) values (pg_temp.bu('s'), 'ses_bc', '{"date": 1780000000000, "label": "Haut", "exercises": []}');
insert into public.coach_notes (student_id, coach_id, session_id, text) values (pg_temp.bu('s'), pg_temp.bu('k'), 'ses_bc', 'Bien');
insert into public.coach_programmes (student_id, coach_id, id, data) values (pg_temp.bu('s'), pg_temp.bu('k'), 'p_bc', '{"name":"P"}');
insert into public.coach_shares (student_id, coach_id, kind) values (pg_temp.bu('s'), pg_temp.bu('k'), 'weight');
insert into public.coach_messages (student_id, coach_id, from_coach, body) values (pg_temp.bu('s'), pg_temp.bu('k'), true, 'Salut');
insert into public.coach_phases (student_id, coach_id, goal, start_on, weeks) values (pg_temp.bu('s'), pg_temp.bu('k'), 'cut', current_date, 4);

-- ── Droits ───────────────────────────────────────────────
do $$ begin
  if has_function_privilege('authenticated', 'private.block_cuts_coach()', 'execute')
     or has_function_privilege('anon', 'private.coach_link_not_blocked()', 'execute')
     or has_function_privilege('authenticated', 'private.coach_link_not_blocked()', 'execute') then
    raise 'fonctions des déclencheurs exécutables par l''API'; end if;
  if not (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
          where p.oid in ('private.block_cuts_coach()'::regprocedure, 'private.coach_link_not_blocked()'::regprocedure)) then
    raise 'security definer / search_path'; end if;
end $$;

set role authenticated;
-- Avant : K lit bien S
do $$ begin
  perform pg_temp.blogin('k');
  if pg_temp.berr(format('select public.coach_student_sessions(%L)', pg_temp.bu('s'))) <> 'ok' then raise 'K ne lit pas S avant le blocage'; end if;
  -- Un blocage avec un tiers ne touche à aucun lien
  perform pg_temp.blogin('s');
  perform public.block_user(pg_temp.bu('a'));
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.coach_links where student_id = pg_temp.bu('s') and coach_id = pg_temp.bu('k')) then
    raise 'un blocage d''un tiers a coupé le lien'; end if;
end $$;

-- ── L'élève bloque son coach ─────────────────────────────
set role authenticated;
select pg_temp.blogin('s');
select public.block_user(pg_temp.bu('k'));
reset role;
do $$
declare s uuid := pg_temp.bu('s'); k uuid := pg_temp.bu('k');
begin
  if exists (select 1 from public.coach_links where student_id = s) then raise 'lien gardé après le blocage de l''élève'; end if;
  if exists (select 1 from public.coach_notes where student_id = s) or exists (select 1 from public.coach_programmes where student_id = s)
     or exists (select 1 from public.coach_shares where student_id = s) or exists (select 1 from public.coach_messages where student_id = s)
     or exists (select 1 from public.coach_phases where student_id = s) then
    raise 'données du lien gardées après le blocage'; end if;
  if not exists (select 1 from public.sessions where user_id = s and id = 'ses_bc') then raise 'séance de l''élève effacée'; end if;
  if not exists (select 1 from public.blocks where blocker_id = s and blocked_id = k) then raise 'blocage absent'; end if;
end $$;
set role authenticated;
do $$
declare s uuid := pg_temp.bu('s'); r text;
begin
  perform pg_temp.blogin('k');
  foreach r in array array[
    format('select public.coach_student_sessions(%L)', s), format('select public.coach_student_weights(%L)', s),
    format('select public.coach_student_weeks(%L)', s), format('select public.chat_messages(%L)', s),
    format('select public.chat_send(''coucou'', %L)', s), format('select public.coach_send_programme(%L, ''p2'', ''{"name":"P"}'')', s),
    format('select public.coach_plan_save(%L, null, ''Phase'', ''cut'', current_date, 4, null, null)', s)] loop
    if pg_temp.berr(r) <> 'not_found' then raise 'K agit encore sur S : % → %', r, pg_temp.berr(r); end if;
  end loop;
end $$;
reset role;

-- ── Se relier pendant le blocage : refusé, comme un code faux ──
insert into public.coach_invites (code, coach_id, expires_at) values ('BCBCBCBC', pg_temp.bu('k'), now() + interval '1 day');
do $$ begin
  if pg_temp.berr(format('insert into public.coach_links (student_id, coach_id) values (%L, %L)', pg_temp.bu('s'), pg_temp.bu('k'))) <> 'invalid_code' then
    raise 'lien recréé malgré le blocage'; end if;
end $$;
set role authenticated;
do $$ begin
  perform pg_temp.blogin('s');
  if pg_temp.berr('select public.coach_join(''BCBCBCBC'')') <> 'invalid_code' then raise 'coach_join pendant le blocage : %', pg_temp.berr('select public.coach_join(''BCBCBCBC'')'); end if;
  -- Débloquer ne recrée rien ; un code valable permet ensuite de revenir
  perform public.unblock_user(pg_temp.bu('k'));
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.coach_links where student_id = pg_temp.bu('s')) then raise 'déblocage : lien recréé tout seul'; end if;
end $$;
set role authenticated;
do $$ begin
  perform pg_temp.blogin('s');
  if pg_temp.berr('select public.coach_join(''BCBCBCBC'')') <> 'ok' then raise 'retour après déblocage refusé : %', pg_temp.berr('select public.coach_join(''BCBCBCBC'')'); end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.coach_links where student_id = pg_temp.bu('s') and coach_id = pg_temp.bu('k')) then raise 'retour après déblocage absent'; end if;
end $$;

-- ── Le coach bloque son élève : même coupure ─────────────
set role authenticated;
select pg_temp.blogin('l');
select public.block_user(pg_temp.bu('t'));
reset role;
do $$ begin
  if exists (select 1 from public.coach_links where student_id = pg_temp.bu('t')) then raise 'lien gardé après le blocage du coach'; end if;
  -- Les autres liens ne bougent pas
  if not exists (select 1 from public.coach_links where student_id = pg_temp.bu('u') and coach_id = pg_temp.bu('m')) then raise 'autre lien coupé'; end if;
end $$;

-- ── Blocage posé directement (hors block_user) : coupé aussi ──
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.bu('m'), pg_temp.bu('u'));
do $$ begin
  if exists (select 1 from public.coach_links where student_id = pg_temp.bu('u')) then raise 'insertion directe dans blocks : lien gardé'; end if;
end $$;
