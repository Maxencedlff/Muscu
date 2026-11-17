-- Vérifications de supabase/migrations/20261117060000_reaction_jaime.sql (lancées par tests/sql/run.sh) :
-- ❤️ like dans la liste fermée (set_reaction, contrainte), égalités départagées ❤️ d'abord (my_reactions),
-- toggle_bravo des anciennes versions inchangé (👏), et ce que push_claim rend pour une réaction : la sorte
-- relue à l'envoi et le nom de ma séance (40 caractères au plus), rien si elle a été retirée ou si la séance
-- est supprimée, jamais le contenu de la séance. Chaque bloc échoue (raise) si la règle n'est pas tenue.
-- Comptes à part (…0000000009dx) ; jetons faux et évidents (répétitions de « 5 »).
--
-- A jana.j publie ; B jben.j et C jcyr.j sont ses abonnés acceptés.

create function pg_temp.err(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.u(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000009d' || translate(c, 'abc', '123'))::uuid $$;
create function pg_temp.login(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.u(c)::text, false) $$;
-- Notification de réaction de « who » à A dans une réponse de push_claim (null si absente). push_claim prend
-- toute la file d'un coup : un seul appel par bloc, puis pick pour chaque auteur
create function pg_temp.pick(res jsonb, who text) returns jsonb language sql as
$$ select x from jsonb_array_elements(res) x
   where x ->> 'kind' = 'reaction' and x ->> 'actor_name' = (select username from public.user_profiles where user_id = pg_temp.u(who)) $$;
grant execute on function pg_temp.err(text), pg_temp.u(text), pg_temp.login(text), pg_temp.pick(jsonb, text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.u(c) from unnest(array['a', 'b', 'c']) c;

set role authenticated;
do $$
declare c text;
begin
  foreach c in array array['a', 'b', 'c'] loop
    perform pg_temp.login(c);
    insert into public.user_profiles (username) values ('j' || (array['ana', 'ben', 'cyr'])[array_position(array['a', 'b', 'c'], c)] || '.j');
    perform public.social_enable(true);
  end loop;
  perform pg_temp.login('a');
  insert into public.sessions (id, data) values
    ('j-1', '{"date": 1780000000000, "category": "push", "label": "Push", "notes": "épaule", "exercises": [{"name": "Développé", "sets": [{"weight": "100", "reps": "5"}]}]}'),
    ('j-2', jsonb_build_object('date', 1780000100000, 'category', 'legs', 'label', repeat('y', 80), 'exercises', '[]'::jsonb)),
    ('j-3', '{"date": 1780000200000, "category": "pull", "exercises": []}');
  foreach c in array array['b', 'c'] loop
    perform pg_temp.login(c); perform public.request_follow(pg_temp.u('a'));
  end loop;
  perform pg_temp.login('a');
  perform public.respond_follow(pg_temp.u('b'), true);
  perform public.respond_follow(pg_temp.u('c'), true);
end $$;
reset role;
-- A a allumé les notifications de réactions (faux jeton) : chaque première réaction se met en file
insert into public.push_devices (token, user_id, env) values (repeat('5', 64), pg_temp.u('a'), 'production');
insert into public.push_prefs (user_id, reactions) values (pg_temp.u('a'), true);
set role authenticated;

-- ── ❤️ : posée, changée, retirée ; liste toujours fermée ──
do $$
declare j jsonb;
begin
  perform pg_temp.login('b');
  j := public.set_reaction(pg_temp.u('a'), 'j-1', 'like');
  if j is distinct from '{"bravos": 1, "mine": true, "my_reaction": "like", "reactions": {"like": 1}}' then raise '❤️ posée : %', j; end if;
  if (select my_reaction from public.feed() where id = 'j-1') is distinct from 'like' then raise 'fil : ma réaction ❤️'; end if;
  j := public.set_reaction(pg_temp.u('a'), 'j-1', 'fire');
  if j -> 'reactions' is distinct from '{"fire": 1}' then raise '❤️ → 🔥 : %', j; end if;
  j := public.set_reaction(pg_temp.u('a'), 'j-1', 'like');
  if j -> 'reactions' is distinct from '{"like": 1}' then raise '🔥 → ❤️ : %', j; end if;
  j := public.set_reaction(pg_temp.u('a'), 'j-1', null);
  if j -> 'reactions' is distinct from '{}' then raise '❤️ retirée : %', j; end if;
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'j-1', 'heart') $q$) is distinct from 'invalid_reaction' then raise 'hors liste'; end if;
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'j-1', 'LIKE') $q$) is distinct from 'invalid_reaction' then raise 'majuscules'; end if;
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'j-1', '❤️') $q$) is distinct from 'invalid_reaction' then raise 'emoji au lieu du nom'; end if;
  -- Anciennes versions : toggle_bravo pose toujours un 👏, et retire un ❤️ comme toute réaction
  perform public.set_reaction(pg_temp.u('a'), 'j-1', 'like');
  if public.toggle_bravo(pg_temp.u('a'), 'j-1') is distinct from '{"bravos": 0, "mine": false}' then raise 'toggle_bravo retire le ❤️'; end if;
  if public.toggle_bravo(pg_temp.u('a'), 'j-1') is distinct from '{"bravos": 1, "mine": true}' then raise 'toggle_bravo pose'; end if;
  if (select my_reaction from public.feed() where id = 'j-1') is distinct from 'clap' then raise 'toggle_bravo : 👏, pas ❤️'; end if;
  perform public.set_reaction(pg_temp.u('a'), 'j-1', 'like');
end $$;
reset role;
do $$ begin
  if pg_temp.err($q$ insert into public.bravos (session_owner, session_id, user_id, kind) values (pg_temp.u('a'), 'j-3', pg_temp.u('c'), 'heart') $q$) not like '%bravos_kind%' then raise 'contrainte : sorte inconnue acceptée'; end if;
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'bravos' and column_name = 'kind') <> '''clap''::text'
    then raise 'défaut : toujours 👏 (anciennes versions)'; end if;
end $$;

-- ── Égalité : ❤️ d'abord (Historique) ──
set role authenticated;
do $$ begin
  perform pg_temp.login('c');
  perform public.set_reaction(pg_temp.u('a'), 'j-1', 'clap');
  perform pg_temp.login('a');
  if (select row(total, top, reactions)::text from public.my_reactions() where session_id = 'j-1') is distinct from row(2, 'like', '{"clap": 1, "like": 1}'::jsonb)::text
    then raise 'my_reactions : %', (select row(total, top, reactions)::text from public.my_reactions() where session_id = 'j-1'); end if;
  if (select array_agg(username || ':' || kind order by username) from public.session_reactions('j-1')) is distinct from array['jben.j:like', 'jcyr.j:clap'] then raise 'qui a réagi'; end if;
  if not exists (select 1 from public.my_activity() where kind = 'reaction' and reaction = 'like') then raise 'activité : ❤️'; end if;
end $$;
reset role;

-- ── Notification : sorte et nom de MA séance, relus à l'envoi ──
-- La première réaction de chacun a mis la notification en file (une par auteur et par séance sur 24 h)
do $$ begin
  if (select count(*) from private.push_outbox where recipient = pg_temp.u('a') and kind = 'reaction') <> 2 then
    raise 'file : une par auteur (%)', (select count(*) from private.push_outbox where recipient = pg_temp.u('a') and kind = 'reaction'); end if;
end $$;
set role service_role;
do $$
declare res jsonb := public.push_claim(200); r jsonb;
begin
  r := pg_temp.pick(res, 'b');
  if r ->> 'wanted' <> 'true' or r ->> 'reaction' <> 'like' or r ->> 'label' <> 'Push' or r ->> 'ref' <> 'j-1' then raise 'réaction de B : %', r; end if;
  if r::text ~ '(épaule|Développé|100)' then raise 'contenu de la séance dans la notification : %', r; end if;
  r := pg_temp.pick(res, 'c');
  if r ->> 'reaction' <> 'clap' then raise 'réaction de C (changée depuis la mise en file : relue) : %', r; end if;
end $$;
reset role;

-- Réaction changée puis retirée avant l'envoi ; nom long, séance sans nom, séance supprimée
update private.push_outbox set claimed_at = null where recipient = pg_temp.u('a') and kind = 'reaction';
delete from public.bravos where session_owner = pg_temp.u('a') and session_id = 'j-1' and user_id = pg_temp.u('c');
set role service_role;
do $$
declare r jsonb := pg_temp.pick(public.push_claim(200), 'c');
begin
  if r ->> 'wanted' <> 'true' or r ? 'reaction' or r ->> 'label' <> 'Push' then raise 'retirée avant l''envoi : pas de sorte (%)', r; end if;
end $$;
reset role;
delete from private.push_outbox where recipient = pg_temp.u('a') and kind = 'reaction';
insert into private.push_outbox (recipient, kind, actor, ref) values
  (pg_temp.u('a'), 'reaction', pg_temp.u('b'), 'j-2'), (pg_temp.u('a'), 'reaction', pg_temp.u('c'), 'j-3');
insert into public.bravos (session_owner, session_id, user_id, kind) values
  (pg_temp.u('a'), 'j-2', pg_temp.u('b'), 'wow'), (pg_temp.u('a'), 'j-3', pg_temp.u('c'), 'like');
set role service_role;
do $$
declare res jsonb := public.push_claim(200); r jsonb;
begin
  r := pg_temp.pick(res, 'b');
  if r ->> 'reaction' <> 'wow' or char_length(r ->> 'label') <> 40 then raise 'nom borné à 40 : %', r; end if;
  r := pg_temp.pick(res, 'c');
  if r ->> 'reaction' <> 'like' or r ? 'label' then raise 'séance sans nom : pas de label (%)', r; end if;
end $$;
reset role;
update private.push_outbox set claimed_at = null where recipient = pg_temp.u('a') and kind = 'reaction';
update public.sessions set deleted_at = now() where user_id = pg_temp.u('a') and id = 'j-2';
set role service_role;
do $$
declare r jsonb := pg_temp.pick(public.push_claim(200), 'b');
begin
  if r is null or r ? 'label' then raise 'séance supprimée : pas de nom (%)', r; end if;
end $$;
reset role;

-- Réglage éteint : ni sorte ni nom
update private.push_outbox set claimed_at = null where recipient = pg_temp.u('a') and kind = 'reaction';
update public.push_prefs set reactions = false where user_id = pg_temp.u('a');
set role service_role;
do $$
declare r jsonb := pg_temp.pick(public.push_claim(200), 'c');
begin
  if r ->> 'wanted' <> 'false' or r ? 'reaction' or r ? 'label' or r ->> 'ref' <> '' then raise 'non voulue : rien (%)', r; end if;
end $$;
reset role;

-- Les appelants de l'app n'ont toujours pas push_claim
set role authenticated;
do $$ begin
  perform pg_temp.login('a');
  if pg_temp.err($q$ select public.push_claim(10) $q$) not like 'permission denied%' then raise 'push_claim ouvert à l''app'; end if;
end $$;
reset role;

delete from private.push_outbox where recipient = pg_temp.u('a');
delete from auth.users where id in (pg_temp.u('a'), pg_temp.u('b'), pg_temp.u('c'));
