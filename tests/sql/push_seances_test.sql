-- Vérifications de supabase/migrations/20261116020000_notifications_seances_eleves.sql (lancées par tests/sql/run.sh) :
-- réglage à part (défaut éteint, écritures à 3, 5 et 6 arguments), séance d'un élève mise en file sans son
-- contenu, une par élève et par heure, rien pour une séance corrigée, ancienne, d'avant le lien, supprimée,
-- d'un élève d'un autre coach ou d'un coach sans le rôle ; séance datée après coup ; écran à ouvrir, nom et
-- durée rendus par push_claim, relus à l'envoi. Chaque bloc échoue (raise) si la règle n'est pas tenue.
-- Comptes à part (…0000000009cx) ; jetons faux et évidents (répétitions de « 3 », « 4 »).
--
-- E sese.s est l'élève de K skev.s (coach) ; F sfab.s est l'élève de C scla.s (coach, sans appareil).

create function pg_temp.err(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.u(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000009c' || translate(c, 'ekfc', '1234'))::uuid $$;
create function pg_temp.login(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.u(c)::text, ''), false) $$;
create function pg_temp.n(who text) returns int language sql as
$$ select count(*)::int from private.push_outbox where kind = 'student_session' and recipient = pg_temp.u(who) $$;
-- Date de séance (ms) il y a « ago »
create function pg_temp.ms(ago interval) returns bigint language sql as
$$ select (extract(epoch from now() - ago) * 1000)::bigint $$;
grant execute on function pg_temp.err(text), pg_temp.u(text), pg_temp.login(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.u(c) from unnest(array['e', 'k', 'f', 'c']) c;
insert into public.user_profiles (user_id, username, avatar_emoji, social_at, coach_at) values
  (pg_temp.u('e'), 'sese.s', '🦁', null, null), (pg_temp.u('k'), 'skev.s', '⭐', null, now()),
  (pg_temp.u('f'), 'sfab.s', '🦊', null, null), (pg_temp.u('c'), 'scla.s', '🦅', null, now());
insert into public.coach_links (student_id, coach_id, created_at) values
  (pg_temp.u('e'), pg_temp.u('k'), now() - interval '30 days'), (pg_temp.u('f'), pg_temp.u('c'), now() - interval '30 days');
insert into public.push_devices (token, user_id, env) values
  (repeat('3', 64), pg_temp.u('k'), 'production'), (repeat('4', 64), pg_temp.u('e'), 'production');

-- ── Réglage : éteint par défaut ; les écritures à 3 et 5 arguments n'y touchent pas ──
set role authenticated;
do $$
declare p jsonb;
begin
  perform pg_temp.login('k');
  p := public.push_prefs();
  if p ->> 'student_sessions' <> 'false' then raise 'défaut : %', p; end if;
  p := public.push_set_prefs(reactions => true, follows => null, coach => null);
  p := public.push_set_prefs(reactions => null, follows => null, coach => true, comments => null, messages => true);
  if p ->> 'student_sessions' <> 'false' or p ->> 'coach' <> 'true' then raise '« coach » allumé n''allume pas les séances des élèves : %', p; end if;
  p := public.push_set_prefs(reactions => null, follows => null, coach => null, comments => null, messages => null, student_sessions => true);
  if p ->> 'student_sessions' <> 'true' or p ->> 'reactions' <> 'true' or p ->> 'messages' <> 'true' then raise '6 types : %', p; end if;
  p := public.push_set_prefs(reactions => false, follows => null, coach => null, comments => null, messages => null);
  if p ->> 'student_sessions' <> 'true' then raise 'l''écriture à 5 a éteint les séances : %', p; end if;
  perform pg_temp.login(null);
  if pg_temp.err($q$ select public.push_set_prefs(true, true, true, true, true, true) $q$) is distinct from 'not_signed_in' then raise 'réglage sans compte'; end if;
  perform pg_temp.login('k');
  if pg_temp.err($q$ select private.push_on_student_session() $q$) not like 'permission denied%' then raise 'déclencheur ouvert à l''API'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  if pg_temp.err($q$ select public.push_set_prefs(true, true, true, true, true, true) $q$) not like 'permission denied%' then raise 'anon écrit des réglages'; end if;
end $$;
reset role;

-- ── Séance terminée : une ligne, l'id seul ; puis une par élève et par heure ──
insert into public.sessions (user_id, id, data) values
  (pg_temp.u('e'), 'e-1', jsonb_build_object('date', pg_temp.ms('10 minutes'), 'label', 'Push', 'duration', 3120000,
                                             'notes', 'genou', 'exercises', '[{"name": "Squat", "sets": [{"weight": "140"}]}]'::jsonb));
do $$ begin
  if pg_temp.n('k') <> 1 then raise 'séance terminée : % notification(s)', pg_temp.n('k'); end if;
  if (select ref from private.push_outbox where kind = 'student_session') <> 'e-1' then raise 'ref : id de la séance'; end if;
  if (select actor from private.push_outbox where kind = 'student_session') <> pg_temp.u('e') then raise 'auteur : l''élève'; end if;
  if pg_temp.n('e') <> 0 then raise 'l''élève n''est pas prévenu de sa propre séance'; end if;
end $$;
insert into public.sessions (user_id, id, data) values (pg_temp.u('e'), 'e-2', jsonb_build_object('date', pg_temp.ms('5 minutes')));
update public.sessions set data = data || '{"label": "Push corrigée"}' where user_id = pg_temp.u('e') and id = 'e-1';
do $$ begin
  if pg_temp.n('k') <> 1 then raise 'une par élève et par heure, rien pour une correction : %', pg_temp.n('k'); end if;
end $$;

-- ── Ce qui ne sonne jamais ──
delete from private.push_outbox where kind = 'student_session';
insert into public.sessions (user_id, id, data) values
  (pg_temp.u('e'), 'old', jsonb_build_object('date', pg_temp.ms('3 days'))),                     -- historique synchronisé
  (pg_temp.u('e'), 'futur', jsonb_build_object('date', pg_temp.ms('-3 days'))),                  -- horloge folle
  (pg_temp.u('f'), 'f-1', jsonb_build_object('date', pg_temp.ms('1 minute')));                    -- autre coach, sans appareil
insert into public.sessions (user_id, id, data, deleted_at) values (pg_temp.u('e'), 'del', jsonb_build_object('date', pg_temp.ms('1 minute')), now());
do $$ begin
  if pg_temp.n('k') <> 0 then raise 'ancienne, future ou supprimée : % notification(s)', pg_temp.n('k'); end if;
  if pg_temp.n('c') <> 0 then raise 'coach sans appareil : rien'; end if;
end $$;
-- Séance d'avant le lien (lien tout neuf)
update public.coach_links set created_at = now() where student_id = pg_temp.u('e');
insert into public.sessions (user_id, id, data) values (pg_temp.u('e'), 'avant-lien', jsonb_build_object('date', pg_temp.ms('2 hours')));
update public.coach_links set created_at = now() - interval '30 days' where student_id = pg_temp.u('e');
-- Coach sans le rôle
update public.user_profiles set coach_at = null where user_id = pg_temp.u('k');
insert into public.sessions (user_id, id, data) values (pg_temp.u('e'), 'sans-role', jsonb_build_object('date', pg_temp.ms('1 minute')));
update public.user_profiles set coach_at = now() where user_id = pg_temp.u('k');
-- Réglage éteint
update public.push_prefs set student_sessions = false where user_id = pg_temp.u('k');
insert into public.sessions (user_id, id, data) values (pg_temp.u('e'), 'eteint', jsonb_build_object('date', pg_temp.ms('1 minute')));
update public.push_prefs set student_sessions = true where user_id = pg_temp.u('k');
do $$ begin
  if pg_temp.n('k') <> 0 then raise 'avant le lien, sans le rôle ou réglage éteint : % notification(s)', pg_temp.n('k'); end if;
end $$;

-- ── Séance datée après coup (done_at qui passe de null à une date) ──
insert into public.sessions (user_id, id, data) values (pg_temp.u('e'), 'e-3', '{"label": "Jambes"}');
do $$ begin if pg_temp.n('k') <> 0 then raise 'sans date : rien'; end if; end $$;
update public.sessions set data = data || jsonb_build_object('date', pg_temp.ms('2 minutes'), 'duration', 45000)
  where user_id = pg_temp.u('e') and id = 'e-3';
do $$ begin if pg_temp.n('k') <> 1 then raise 'datée après coup : %', pg_temp.n('k'); end if; end $$;

-- ── Envoi : écran à ouvrir, nom, durée ; rien de plus ; relu à l'envoi ──
set role service_role;
do $$
declare res jsonb; r jsonb;
begin
  res := public.push_claim(50);
  select x into r from jsonb_array_elements(res) x where x ->> 'kind' = 'student_session';
  if r ->> 'wanted' <> 'true' then raise 'voulue : %', r; end if;
  if r ->> 'ref' <> pg_temp.u('e')::text || '/e-3' then raise 'écran : %', r; end if;
  if r ->> 'label' <> 'Jambes' or r ->> 'actor_name' <> 'sese.s' then raise 'nom et pseudo : %', r; end if;
  if r ? 'minutes' then raise 'durée de moins d''une minute : absente (%)', r; end if;
  if r::text ~ '(genou|Squat|140)' then raise 'contenu de la séance dans la notification : %', r; end if;
end $$;
reset role;
delete from private.push_outbox where kind = 'student_session';
insert into public.sessions (user_id, id, data) values
  (pg_temp.u('e'), 'e-4', jsonb_build_object('date', pg_temp.ms('1 minute'), 'label', repeat('x', 80), 'duration', 3120000));
update public.sessions set deleted_at = now() where user_id = pg_temp.u('e') and id = 'e-4';
set role service_role;
do $$
declare r jsonb;
begin
  select x into r from jsonb_array_elements(public.push_claim(50)) x where x ->> 'kind' = 'student_session';
  if r ->> 'wanted' <> 'false' or r ->> 'ref' <> '' or r ? 'label' then raise 'supprimée avant l''envoi : %', r; end if;
end $$;
reset role;
update public.sessions set deleted_at = null where user_id = pg_temp.u('e') and id = 'e-4';
update private.push_outbox set claimed_at = null where kind = 'student_session';
set role service_role;
do $$
declare r jsonb;
begin
  select x into r from jsonb_array_elements(public.push_claim(50)) x where x ->> 'kind' = 'student_session';
  if r ->> 'minutes' <> '52' or char_length(r ->> 'label') <> 40 then raise 'durée et nom bornés : %', r; end if;
end $$;
reset role;

-- ── Lien rompu avant l'envoi ; réglage éteint : file vidée ──
update private.push_outbox set claimed_at = null where kind = 'student_session';
delete from public.coach_links where student_id = pg_temp.u('e');
set role service_role;
do $$
declare r jsonb;
begin
  select x into r from jsonb_array_elements(public.push_claim(50)) x where x ->> 'kind' = 'student_session';
  if r ->> 'wanted' <> 'false' then raise 'lien rompu : %', r; end if;
end $$;
reset role;
insert into public.coach_links (student_id, coach_id, created_at) values (pg_temp.u('e'), pg_temp.u('k'), now() - interval '30 days');
delete from private.push_outbox where kind = 'student_session';
insert into private.push_outbox (recipient, kind, actor, ref) values (pg_temp.u('k'), 'student_session', pg_temp.u('e'), 'e-1');
set role authenticated;
do $$ begin
  perform pg_temp.login('k');
  perform public.push_set_prefs(reactions => null, follows => null, coach => null, comments => null, messages => null, student_sessions => false);
end $$;
reset role;
do $$ begin if pg_temp.n('k') <> 0 then raise 'éteint : file vidée'; end if; end $$;

-- Ménage (les autres tests partagent la base)
delete from private.push_outbox where recipient in (pg_temp.u('e'), pg_temp.u('k'), pg_temp.u('f'), pg_temp.u('c'));
delete from auth.users where id in (pg_temp.u('e'), pg_temp.u('k'), pg_temp.u('f'), pg_temp.u('c'));
