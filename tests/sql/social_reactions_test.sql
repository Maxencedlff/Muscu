-- Vérifications de supabase/migrations/20261031200000_reactions_profil.sql (lancées par tests/sql/run.sh) :
-- réactions, qui a réagi, activité de Mon profil, pastille, mes séances vues par les autres, droits.
-- Chaque bloc échoue (raise) si la règle n'est pas tenue. Comptes à part (…00000000060x, pseudos q…) :
-- indépendant de social_test.sql, quel que soit l'ordre.
--
-- A qana.r publie ; B qben.r et C qcyr.r sont ses abonnés acceptés ; D qdan.r ne le suit pas ; E qeve.r
-- a une demande en attente ; G qgus.r sert aux limites.

create function pg_temp.err(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.u(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000060' || c)::uuid $$;
create function pg_temp.login(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.u(c)::text, false) $$;
grant execute on function pg_temp.err(text), pg_temp.u(text), pg_temp.login(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.u(c) from unnest(array['a', 'b', 'c', 'd', 'e', 'f']) c;

-- Bravos d'avant la migration : impossibles à recréer ici (la migration est déjà passée), on vérifie
-- donc la forme de la table : réaction 👏 par défaut, liste fermée
do $$ begin
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'bravos' and column_name = 'kind') <> '''clap''::text'
    then raise 'kind : 👏 par défaut'; end if;
end $$;

set role authenticated;
do $$
declare c text;
begin
  foreach c in array array['a', 'b', 'c', 'd', 'e', 'f'] loop
    perform pg_temp.login(c);
    insert into public.user_profiles (username) values ('q' || (array['ana', 'ben', 'cyr', 'dan', 'eve', 'gus'])[array_position(array['a', 'b', 'c', 'd', 'e', 'f'], c)] || '.r');
    perform public.social_enable(true);
  end loop;
  perform pg_temp.login('a');
  insert into public.sessions (id, data) values
    ('a-1', '{"date": 1780000000000, "category": "legs", "label": "Legs", "notes": "privé", "bodyKg": 80, "exercises": [{"name": "Squat", "sets": [{"weight": "100", "reps": "5"}]}]}'),
    ('a-2', '{"date": 1780000100000, "category": "push", "label": "Push", "exercises": []}'),
    ('a-hid', '{"date": 1780000200000, "hidden": true, "category": "pull", "exercises": []}'),
    ('a-del', '{"date": 1780000300000, "category": "pull", "exercises": []}');
  update public.sessions set deleted_at = now() where id = 'a-del';
  foreach c in array array['b', 'c', 'e'] loop
    perform pg_temp.login(c); perform public.request_follow(pg_temp.u('a'));
  end loop;
  perform pg_temp.login('a');
  perform public.respond_follow(pg_temp.u('b'), true);
  perform public.respond_follow(pg_temp.u('c'), true);
  perform pg_temp.login('f'); perform public.request_follow(pg_temp.u('a'));
  perform pg_temp.login('a'); perform public.respond_follow(pg_temp.u('f'), true);
end $$;

-- ── Poser, changer, retirer ──────────────────────────────
do $$
declare j jsonb; r record;
begin
  perform pg_temp.login('b');
  j := public.set_reaction(pg_temp.u('a'), 'a-1', 'fire');
  if j is distinct from '{"bravos": 1, "mine": true, "my_reaction": "fire", "reactions": {"fire": 1}}' then raise 'posée : %', j; end if;
  select * into r from public.feed() where id = 'a-1';
  if r.reactions is distinct from '{"fire": 1}' or r.my_reaction is distinct from 'fire' or r.bravos <> 1 or not r.my_bravo then raise 'fil : %', r; end if;
  -- Une seule par personne : changer remplace
  j := public.set_reaction(pg_temp.u('a'), 'a-1', 'trophy');
  if j -> 'reactions' is distinct from '{"trophy": 1}' or j ->> 'my_reaction' <> 'trophy' then raise 'changée : %', j; end if;
  if (select count(*) from public.feed() where id = 'a-1') <> 1 then raise 'une ligne par séance'; end if;
  -- Liste fermée : rien d'autre, pas de texte libre
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'a-1', 'heart') $q$) is distinct from 'invalid_reaction' then raise 'hors liste'; end if;
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'a-1', '<b>bravo</b>') $q$) is distinct from 'invalid_reaction' then raise 'texte libre'; end if;
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'a-1', '') $q$) is distinct from 'invalid_reaction' then raise 'vide'; end if;
  -- Ancienne version de l'app : toggle_bravo retire ma réaction quelle qu'elle soit, puis remet un 👏
  if public.toggle_bravo(pg_temp.u('a'), 'a-1') is distinct from '{"bravos": 0, "mine": false}' then raise 'toggle_bravo retire'; end if;
  if public.toggle_bravo(pg_temp.u('a'), 'a-1') is distinct from '{"bravos": 1, "mine": true}' then raise 'toggle_bravo pose'; end if;
  if (select my_reaction from public.feed() where id = 'a-1') is distinct from 'clap' then raise 'toggle_bravo : 👏'; end if;
  -- Retirer (kind null)
  j := public.set_reaction(pg_temp.u('a'), 'a-1', null);
  if j is distinct from '{"bravos": 0, "mine": false, "my_reaction": null, "reactions": {}}' then raise 'retirée : %', j; end if;
  perform public.set_reaction(pg_temp.u('a'), 'a-1', 'fire');
end $$;
-- Une transaction par appel, comme par l'API : dates distinctes (now() est celui de la transaction)
do $$ begin
  perform pg_temp.login('c');
  perform public.set_reaction(pg_temp.u('a'), 'a-1', 'clap');
  perform public.set_reaction(pg_temp.u('a'), 'a-2', 'strong');
  if (select reactions from public.feed() where id = 'a-1') is distinct from '{"clap": 1, "fire": 1}' then raise 'deux réactions'; end if;
  -- Ce que feed ne montrerait pas : refusé
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'a-hid', 'fire') $q$) is distinct from 'not_found' then raise 'séance masquée'; end if;
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'a-del', 'fire') $q$) is distinct from 'not_found' then raise 'séance supprimée'; end if;
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'nexiste', 'fire') $q$) is distinct from 'not_found' then raise 'séance inconnue'; end if;
  perform pg_temp.login('d');
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'a-1', 'fire') $q$) is distinct from 'not_found' then raise 'non abonné'; end if;
  perform pg_temp.login('e');
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'a-1', 'fire') $q$) is distinct from 'not_found' then raise 'demande en attente'; end if;
  perform pg_temp.login('a');
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'a-1', 'fire') $q$) is distinct from 'not_found' then raise 'sa propre séance'; end if;
  -- Écriture directe impossible
  if pg_temp.err($q$ update public.bravos set kind = 'wow' $q$) not like 'permission denied%' then raise 'update bravos'; end if;
  if pg_temp.err($q$ select * from public.bravos $q$) not like 'permission denied%' then raise 'select bravos'; end if;
end $$;

-- ── Qui a réagi, Historique, activité, pastille ──────────
do $$
declare st jsonb;
begin
  perform pg_temp.login('a');
  if (select array_agg(username || ':' || kind order by username) from public.session_reactions('a-1')) is distinct from array['qben.r:fire', 'qcyr.r:clap'] then raise 'qui a réagi : %', (select array_agg(username || ':' || kind) from public.session_reactions('a-1')); end if;
  if (select user_id from public.session_reactions('a-1') limit 1) is distinct from pg_temp.u('c') then raise 'qui a réagi : plus récent d''abord'; end if;
  -- Historique : total, la plus fréquente (égalité : 👏 avant 🔥), comptes
  if (select row(total, top, reactions)::text from public.my_reactions() where session_id = 'a-1') is distinct from row(2, 'clap', '{"clap": 1, "fire": 1}'::jsonb)::text then raise 'my_reactions a-1'; end if;
  if (select top from public.my_reactions() where session_id = 'a-2') is distinct from 'strong' or (select count(*) from public.my_reactions()) <> 2 then raise 'my_reactions'; end if;
  -- Ancienne version : my_bravos compte toujours les réactions
  if (select bravos from public.my_bravos() where session_id = 'a-1') is distinct from 2 then raise 'my_bravos'; end if;
  -- Activité : 3 réactions, 3 abonnés (B, C, F), 1 demande (E), du plus récent au plus ancien
  if (select count(*) from public.my_activity() where kind = 'reaction') <> 3 or (select count(*) from public.my_activity() where kind = 'follower') <> 3
     or (select count(*) from public.my_activity() where kind = 'request') <> 1 then raise 'activité : %', (select array_agg(kind) from public.my_activity()); end if;
  if (select kind from public.my_activity() limit 1) <> 'reaction' then raise 'activité : la plus récente d''abord'; end if;
  if (select row(session_label, reaction, username, session_at)::text from public.my_activity() where kind = 'reaction' and session_id = 'a-2')
     is distinct from row('Push', 'strong', 'qcyr.r', 1780000100000::bigint)::text then raise 'ligne de réaction'; end if;
  if exists (select 1 from public.my_activity() where kind = 'follower' and is_new) then raise 'un abonné que j''ai accepté n''est pas nouveau'; end if;
  if (select count(*) from public.my_activity() where is_new) <> 3 then raise 'réactions nouvelles'; end if;
  -- Pagination : avant la date de la 2e ligne
  if (select count(*) from public.my_activity((select at from public.my_activity() offset 1 limit 1))) <> 5 then raise 'activité : page suivante'; end if;
  st := public.social_state();
  if (st ->> 'activity_new')::int <> 3 or (st ->> 'shown_sessions')::int <> 2 then raise 'social_state : %', st; end if;
  -- Vu : la pastille repart de zéro
  perform public.mark_activity_seen();
  if (public.social_state() ->> 'activity_new')::int <> 0 or exists (select 1 from public.my_activity() where is_new) then raise 'activité vue'; end if;
  if pg_temp.err($q$ update public.user_profiles set activity_seen_at = null $q$) not like 'permission denied%' then raise 'activity_seen_at modifiable'; end if;
end $$;
-- Curseur stable (at complet + clé kind:user_id:session_id) : après chaque ligne, exactement les lignes
-- d'après, même quand plusieurs lignes ont la même date (B, C et F acceptés dans la même transaction)
do $$
declare all_rows text[]; k int; n int; r record;
begin
  perform pg_temp.login('a');
  select array_agg(x.kind || ':' || x.user_id || ':' || coalesce(x.session_id, '') order by x.o) into all_rows
    from (select m.*, row_number() over () as o from public.my_activity() m) x;
  if (select count(*) from (select at from public.my_activity() group by at having count(*) > 1) d) = 0 then raise 'pas de lignes à la même date : test sans objet'; end if;
  for k in 1 .. array_length(all_rows, 1) loop
    select * into r from (select m.*, row_number() over () as o from public.my_activity() m) x where x.o = k;
    select count(*) into n from public.my_activity(r.at, r.kind || ':' || r.user_id || ':' || coalesce(r.session_id, ''));
    if n <> array_length(all_rows, 1) - k then raise 'curseur après la ligne % : % lignes au lieu de %', k, n, array_length(all_rows, 1) - k; end if;
    if (select array_agg(m.kind || ':' || m.user_id || ':' || coalesce(m.session_id, ''))
        from public.my_activity(r.at, r.kind || ':' || r.user_id || ':' || coalesce(r.session_id, '')) m) is distinct from all_rows[k + 1:]
       and n > 0 then raise 'curseur après la ligne % : ordre', k; end if;
  end loop;
end $$;
-- Réaction changée : de nouveau nouvelle
do $$ begin perform pg_temp.login('b'); perform public.set_reaction(pg_temp.u('a'), 'a-1', 'wow'); end $$;
do $$ begin
  perform pg_temp.login('a');
  if (public.social_state() ->> 'activity_new')::int <> 1 then raise 'réaction changée : nouvelle'; end if;
  perform public.request_follow(pg_temp.u('d'));
end $$;
-- Ma demande acceptée : nouvelle aussi
do $$ begin perform pg_temp.login('d'); perform public.respond_follow(pg_temp.u('a'), true); end $$;
do $$ begin
  perform pg_temp.login('a');
  if (public.social_state() ->> 'activity_new')::int <> 2 or not exists (select 1 from public.my_activity() where kind = 'accepted' and user_id = pg_temp.u('d') and is_new)
    then raise 'demande acceptée'; end if;
  -- Mes séances telles que les autres les voient : visibles seulement, liste blanche, réactions
  if (select array_agg(id order by done_at desc) from public.my_shown_sessions()) is distinct from array['a-2', 'a-1'] then raise 'mes séances visibles'; end if;
  if (select s::text from public.my_shown_sessions() where id = 'a-1') ~ '(privé|bodyKg|notes)' then raise 'liste blanche'; end if;
  if (select reactions from public.my_shown_sessions() where id = 'a-1') is distinct from '{"clap": 1, "wow": 1}' then raise 'mes séances : réactions'; end if;
  if (select array_agg(id) from public.my_shown_sessions(1780000100000, 'a-2')) is distinct from array['a-1'] then raise 'mes séances : page suivante'; end if;
end $$;

-- ── Autres comptes : rien de ce qui est à A ──────────────
do $$ begin
  perform pg_temp.login('c');
  if exists (select 1 from public.session_reactions('a-1')) then raise 'qui a réagi à la séance d''un autre'; end if;
  if exists (select 1 from public.my_reactions()) then raise 'my_reactions d''un autre'; end if;
  if exists (select 1 from public.my_shown_sessions()) then raise 'séances d''un autre'; end if;
  if exists (select 1 from public.my_activity() where kind = 'reaction') then raise 'activité d''un autre'; end if;
end $$;

-- ── Abonné retiré, blocage, social désactivé ─────────────
do $$ begin
  perform pg_temp.login('a');
  perform public.remove_follower(pg_temp.u('c'));
  if exists (select 1 from public.session_reactions('a-1') where user_id = pg_temp.u('c')) then raise 'abonné retiré : encore listé'; end if;
  if (select total from public.my_reactions() where session_id = 'a-1') <> 1 or exists (select 1 from public.my_reactions() where session_id = 'a-2') then raise 'abonné retiré : encore compté'; end if;
  perform pg_temp.login('b');
  if (select reactions from public.feed() where id = 'a-1') is distinct from '{"wow": 1}' then raise 'fil : réaction d''un abonné retiré comptée'; end if;
  perform pg_temp.login('a');
  perform public.block_user(pg_temp.u('b'));
  if exists (select 1 from public.session_reactions('a-1')) or exists (select 1 from public.my_activity() where user_id = pg_temp.u('b')) then raise 'bloqué : encore là'; end if;
  perform public.social_disable();
  if exists (select 1 from public.my_activity()) or (public.social_state() ->> 'activity_new')::int <> 0 or exists (select 1 from public.session_reactions('a-1'))
    then raise 'social désactivé'; end if;
  perform public.social_enable(true);
end $$;

-- ── Limites ──────────────────────────────────────────────
do $$
declare i int;
begin
  perform pg_temp.login('f');
  -- Reposer la même réaction ne compte pas ; changer compte (200 par 24 h, compteur partagé avec toggle_bravo)
  for i in 1..5 loop perform public.set_reaction(pg_temp.u('a'), 'a-1', 'fire'); end loop;
  for i in 1..199 loop
    perform public.set_reaction(pg_temp.u('a'), 'a-1', case when i % 2 = 0 then 'fire' else 'strong' end);
  end loop;
  if pg_temp.err($q$ select public.toggle_bravo(pg_temp.u('a'), 'a-1') $q$) <> 'ok' then raise 'retirer reste permis'; end if;
  if pg_temp.err($q$ select public.toggle_bravo(pg_temp.u('a'), 'a-1') $q$) is distinct from 'rate_limited' then raise 'toggle_bravo : compteur partagé'; end if;
  if pg_temp.err($q$ select public.set_reaction(pg_temp.u('a'), 'a-1', 'wow') $q$) is distinct from 'rate_limited' then raise '201e réaction acceptée'; end if;
end $$;
-- Lectures bornées par heure (compteurs remis à zéro : les blocs d'avant en ont déjà consommé)
reset role;
delete from private.social_rate where user_id = '00000000-0000-0000-0000-00000000060a';
set role authenticated;
do $$
declare i int;
begin
  perform pg_temp.login('a');
  for i in 1..300 loop perform public.session_reactions('a-1'); end loop;
  if pg_temp.err($q$ select * from public.session_reactions('a-1') $q$) is distinct from 'rate_limited' then raise 'session_reactions sans limite'; end if;
  for i in 1..120 loop perform public.mark_activity_seen(); end loop;
  if pg_temp.err($q$ select public.mark_activity_seen() $q$) is distinct from 'rate_limited' then raise 'mark_activity_seen sans limite'; end if;
end $$;
reset role;

-- ── Anonyme : rien ───────────────────────────────────────
set role anon;
set request.jwt.claim.sub = '';
do $$
declare f text;
begin
  foreach f in array array[
    'public.set_reaction(pg_temp.u(''a''), ''a-1'', ''fire'')', '* from public.my_reactions()',
    '* from public.session_reactions(''a-1'')', '* from public.my_activity()', 'public.mark_activity_seen()',
    '* from public.my_shown_sessions()', '* from public.feed()', 'public.social_state()'] loop
    if pg_temp.err('select ' || f) not like 'permission denied%' then raise 'anon : %', f; end if;
  end loop;
end $$;
reset role;

-- ── Droits déclarés ──────────────────────────────────────
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('set_reaction', 'feed', 'my_reactions', 'session_reactions', 'my_activity', 'mark_activity_seen',
                               'my_shown_sessions', 'social_state') loop
    if not has_function_privilege('authenticated', f, 'execute') then raise '% : authenticated sans droit', f; end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute') then raise '% : anon ou public a le droit', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('set_reaction', 'feed', 'my_reactions',
      'session_reactions', 'my_activity', 'mark_activity_seen', 'my_shown_sessions', 'social_state')) <> 8 then raise 'fonctions manquantes ou en double'; end if;
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'private'::regnamespace
             and p.proname in ('reaction_counts', 'reaction_total', 'reaction_top', 'activity_seen', 'activity_new') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then raise '% : exécutable depuis l''API', f; end if;
  end loop;
end $$;

-- ── Suppression du compte : ses réactions partent avec lui ──
do $$ begin
  delete from auth.users where id = pg_temp.u('f');
  if exists (select 1 from public.bravos where user_id = pg_temp.u('f')) then raise 'cascade réactions'; end if;
end $$;
