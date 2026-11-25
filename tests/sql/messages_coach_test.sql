-- Vérifications de supabase/migrations/20261117050000_messages_coach.sql (lancées par tests/sql/run.sh) :
-- résumé des séances (3 notifications par heure puis un résumé qui accumule les élèves distincts, un
-- résumé à la fois, regroupement de 15 min, un par heure, élèves bloqués ou partis non comptés, réglage
-- éteint, push_claim : count, ref vide, aucun pseudo) ; coach_push_off (anon refusé, sans compte, pas
-- coach, élèves des autres jamais rendus, appareil sans « Messages », « Messages » sans appareil).
-- Chaque bloc échoue (raise) si la règle n'est pas tenue.
-- Comptes à part (…000000000ad0x) ; jetons faux et évidents (répétitions de « 5 », « 6 », « 7 »).
--
-- K (mus7.m) est coach de A à F (six élèves) ; C (mus8.m) est coach de G ; X (mus9.m) n'est pas coach.

create function pg_temp.err(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.u(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-000000000ad' || translate(c, 'abcdefgkCx', '0123456789'))::uuid $$;
create function pg_temp.login(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.u(c)::text, ''), false) $$;
create function pg_temp.n(k text) returns int language sql as
$$ select count(*)::int from private.push_outbox where kind = k and recipient = pg_temp.u('k') $$;
create function pg_temp.ms(ago interval) returns bigint language sql as
$$ select (extract(epoch from now() - ago) * 1000)::bigint $$;
-- Séance terminée il y a une minute
create function pg_temp.seance(who text, id text) returns void language sql as
$$ insert into public.sessions (user_id, id, data) values (pg_temp.u(who), id, jsonb_build_object('date', pg_temp.ms('1 minute'), 'label', 'Push')) $$;
create function pg_temp.digest() returns jsonb language sql as
$$ select x from jsonb_array_elements(public.push_claim(50)) x where x ->> 'kind' = 'student_digest' limit 1 $$;
grant execute on function pg_temp.err(text), pg_temp.u(text), pg_temp.login(text), pg_temp.digest() to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.u(c) from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g', 'k', 'C', 'x']) c;
insert into public.user_profiles (user_id, username, avatar_emoji, social_at, coach_at)
  select pg_temp.u(c), 'mus' || translate(c, 'abcdefgkCx', '0123456789') || '.m', '🦊', null, case when c in ('k', 'C') then now() end
  from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g', 'k', 'C', 'x']) c;
insert into public.coach_links (student_id, coach_id, created_at)
  select pg_temp.u(c), pg_temp.u('k'), now() - interval '30 days' from unnest(array['a', 'b', 'c', 'd', 'e', 'f']) c;
insert into public.coach_links (student_id, coach_id, created_at) values (pg_temp.u('g'), pg_temp.u('C'), now() - interval '30 days');
insert into public.push_devices (token, user_id, env) values
  (repeat('5', 64), pg_temp.u('k'), 'production'), (repeat('6', 64), pg_temp.u('a'), 'production'),
  (repeat('7', 64), pg_temp.u('b'), 'production');
insert into public.push_prefs (user_id, student_sessions) values (pg_temp.u('k'), true);
-- a : appareil et « Messages » ; b : appareil sans « Messages » ; c : « Messages » sans appareil
insert into public.push_prefs (user_id, messages) values (pg_temp.u('a'), true), (pg_temp.u('b'), false), (pg_temp.u('c'), true);

-- ── A. Trois notifications, puis un résumé qui accumule les élèves distincts ──
select pg_temp.seance('a', 'a-1'), pg_temp.seance('b', 'b-1'), pg_temp.seance('c', 'c-1');
do $$ begin
  if pg_temp.n('student_session') <> 3 or pg_temp.n('student_digest') <> 0 then
    raise 'trois premières : % séance(s), % résumé(s)', pg_temp.n('student_session'), pg_temp.n('student_digest'); end if;
end $$;
select pg_temp.seance('d', 'd-1'), pg_temp.seance('e', 'e-1'), pg_temp.seance('d', 'd-2'), pg_temp.seance('a', 'a-2');
do $$
declare r record;
begin
  if pg_temp.n('student_session') <> 3 then raise 'au-delà de 3 : plus de notification individuelle (%)', pg_temp.n('student_session'); end if;
  if pg_temp.n('student_digest') <> 1 then raise 'un seul résumé en attente : %', pg_temp.n('student_digest'); end if;
  select * into r from private.push_outbox where kind = 'student_digest';
  if r.actor <> pg_temp.u('k') or r.ref <> '' then raise 'résumé : auteur = le coach, ref vide (%, %)', r.actor, r.ref; end if;
  -- d deux fois : compté une fois ; a déjà notifiée dans l'heure : pas dans le résumé
  if r.actors <> array[pg_temp.u('d'), pg_temp.u('e')] then raise 'élèves distincts : %', r.actors; end if;
end $$;

-- ── Regroupement : rien avant 15 min ──
set role service_role;
do $$ begin if pg_temp.digest() is not null then raise 'résumé pris avant 15 minutes'; end if; end $$;
reset role;
update private.push_outbox set claimed_at = now(), sent_at = now() where kind = 'student_session';   -- soldées
update private.push_outbox set created_at = now() - interval '16 minutes' where kind = 'student_digest';
-- Élève bloqué et élève parti : ne comptent pas
select pg_temp.seance('f', 'f-1');
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.u('k'), pg_temp.u('e'));
set role service_role;
do $$
declare r jsonb;
begin
  r := pg_temp.digest();
  if r is null then raise 'résumé de plus de 15 min non pris'; end if;
  if r ->> 'wanted' <> 'true' or (r ->> 'count')::int <> 2 then raise 'count : d et f (e bloqué) : %', r; end if;
  if r ->> 'ref' <> '' or r ->> 'actor_name' is not null then raise 'ni écran ni pseudo : %', r; end if;
  if r::text ~ 'mus[0-9]\.m' then raise 'pseudo dans le résumé : %', r; end if;
end $$;
reset role;
delete from public.blocks where blocker_id = pg_temp.u('k');
-- Le blocage a coupé le lien de e (20261127010000_blocage_coupe_coach.sql) : e rejoint K de nouveau
insert into public.coach_links (student_id, coach_id, created_at) values (pg_temp.u('e'), pg_temp.u('k'), now() - interval '30 days') on conflict do nothing;

-- ── Un résumé par heure : le suivant attend l'heure du précédent ──
update private.push_outbox set sent_at = now() where kind = 'student_digest';
select pg_temp.seance('b', 'b-2');   -- b déjà notifiée dans l'heure : rien
update private.push_outbox set created_at = now() - interval '61 minutes' where kind = 'student_session' and actor = pg_temp.u('b');
select pg_temp.seance('b', 'b-3');   -- encore 2 individuelles dans l'heure (a, c) : notifiée
select pg_temp.seance('e', 'e-2');   -- 3 dans l'heure : nouveau résumé
do $$ begin
  if pg_temp.n('student_digest') <> 2 then raise 'nouveau résumé après l''envoi du précédent : %', pg_temp.n('student_digest'); end if;
end $$;
update private.push_outbox set created_at = now() - interval '20 minutes' where kind = 'student_digest' and sent_at is null;
set role service_role;
do $$ begin if pg_temp.digest() is not null then raise 'deux résumés dans l''heure'; end if; end $$;
reset role;
update private.push_outbox set sent_at = now() - interval '61 minutes' where kind = 'student_digest' and sent_at is not null;
set role service_role;
do $$
declare r jsonb;
begin
  r := pg_temp.digest();
  if r is null or (r ->> 'count')::int <> 1 then raise 'après l''heure : pris, un élève : %', r; end if;
end $$;
reset role;

-- ── Lien rompu : 0 élève, rien ; coach sans le rôle : rien ──
update private.push_outbox set claimed_at = null where kind = 'student_digest' and sent_at is null;
delete from public.coach_links where student_id = pg_temp.u('e');
set role service_role;
do $$
declare r jsonb;
begin
  r := pg_temp.digest();
  if r ->> 'wanted' <> 'false' or r ? 'count' then raise 'élève parti : rien (%)', r; end if;
end $$;
reset role;
insert into public.coach_links (student_id, coach_id, created_at) values (pg_temp.u('e'), pg_temp.u('k'), now() - interval '30 days');
update private.push_outbox set claimed_at = null where kind = 'student_digest' and sent_at is null;
update public.user_profiles set coach_at = null where user_id = pg_temp.u('k');
set role service_role;
do $$ begin if pg_temp.digest() ->> 'wanted' <> 'false' then raise 'coach sans le rôle : rien'; end if; end $$;
reset role;
update public.user_profiles set coach_at = now() where user_id = pg_temp.u('k');

-- ── Réglage éteint : résumé en attente vidé, plus rien ──
update private.push_outbox set claimed_at = null, sent_at = null where kind = 'student_digest';
set role authenticated;
do $$ begin
  perform pg_temp.login('k');
  perform public.push_set_prefs(reactions => null, follows => null, coach => null, comments => null, messages => null, student_sessions => false);
end $$;
reset role;
do $$ begin if pg_temp.n('student_digest') <> 0 then raise 'éteint : résumés vidés (%)', pg_temp.n('student_digest'); end if; end $$;
update private.push_outbox set created_at = now() - interval '2 hours' where kind = 'student_session';
select pg_temp.seance('a', 'a-3'), pg_temp.seance('b', 'b-4'), pg_temp.seance('c', 'c-3'), pg_temp.seance('d', 'd-3');
do $$ begin
  if pg_temp.n('student_digest') <> 0 then raise 'éteint : pas de résumé'; end if;
end $$;

-- ── Concurrence : le seuil compte toutes les séances du coach (verrou par coach) ──
do $$ begin
  if (select count(*) from private.push_outbox where kind = 'student_session' and recipient = pg_temp.u('k')
        and created_at > now() - interval '1 hour') > 3 then raise 'plus de 3 individuelles dans l''heure'; end if;
end $$;

-- ── B. coach_push_off ──
set role anon;
do $$ begin
  if pg_temp.err($q$ select public.coach_push_off() $q$) not like 'permission denied%' then raise 'anon lit coach_push_off'; end if;
end $$;
reset role;
set role authenticated;
do $$
declare r jsonb;
begin
  perform pg_temp.login(null);
  if pg_temp.err($q$ select public.coach_push_off() $q$) is distinct from 'not_signed_in' then raise 'sans compte'; end if;
  perform pg_temp.login('x');
  if public.coach_push_off() <> '[]'::jsonb then raise 'pas coach : []'; end if;
  perform pg_temp.login('a');
  if public.coach_push_off() <> '[]'::jsonb then raise 'élève : []'; end if;
  perform pg_temp.login('k');
  r := public.coach_push_off();
  -- a reçoit (appareil et Messages) ; b (pas Messages), c (pas d'appareil), d, e, f (rien) : coupées ; g (autre coach) : jamais
  if r <> (select jsonb_agg(u order by u) from unnest(array[pg_temp.u('b'), pg_temp.u('c'), pg_temp.u('d'), pg_temp.u('e'), pg_temp.u('f')]) u) then
    raise 'coach_push_off : %', r; end if;
  if r::text ~ '(token|messages|seen|5555)' then raise 'rien d''autre que des identifiants : %', r; end if;
  perform pg_temp.login('C');
  if public.coach_push_off() <> jsonb_build_array(pg_temp.u('g')) then raise 'C : son élève seulement : %', public.coach_push_off(); end if;
  if pg_temp.err($q$ select private.push_digest_count(gen_random_uuid(), '{}') $q$) not like 'permission denied%' then raise 'brique ouverte à l''API'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon', 'public.coach_push_off()', 'execute') then raise 'GRANT anon'; end if;
  if not has_function_privilege('authenticated', 'public.coach_push_off()', 'execute') then raise 'GRANT authenticated'; end if;
end $$;

-- Ménage (les autres tests partagent la base)
delete from private.push_outbox where recipient in (select pg_temp.u(c) from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g', 'k', 'C', 'x']) c);
delete from private.social_rate where user_id in (pg_temp.u('k'), pg_temp.u('C'), pg_temp.u('x'));
delete from auth.users where id in (select pg_temp.u(c) from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g', 'k', 'C', 'x']) c);
