-- Vérifications de supabase/migrations/20261026050000_social.sql (lancées par tests/sql/run.sh).
-- Chaque bloc échoue (raise) si la règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.u('a') → …00000000050a) : A alice.s1, B bruno.s1, C chloe.s1 et F al_x.s1
-- activent le social ; D n'a pas de pseudo ; E elodie.s1 a un pseudo mais n'active pas le social ;
-- G et H servent aux limites par jour. pg_temp.login change d'utilisateur (auth.uid()) sans changer
-- de rôle, comme un autre jeton. Séances datées de mai 2026 (passé) : le fil ignore le futur lointain.

create function pg_temp.err(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.u(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000050' || c)::uuid $$;
create function pg_temp.login(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.u(c)::text, false) $$;
grant execute on function pg_temp.err(text), pg_temp.u(text), pg_temp.login(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.u(c) from unnest(array['a', 'b', 'c', 'd', 'e', 'f', '1', '2']) c;

-- ── Profils et activation ────────────────────────────────
set role authenticated;
do $$
declare first_at timestamptz;
begin
  perform pg_temp.login('a'); insert into public.user_profiles (username) values ('alice.s1');
  perform pg_temp.login('b'); insert into public.user_profiles (username, avatar_emoji) values ('bruno.s1', '🦊');
  perform pg_temp.login('c'); insert into public.user_profiles (username) values ('chloe.s1');
  perform pg_temp.login('d'); insert into public.user_profiles (avatar_emoji) values ('🐼');
  perform pg_temp.login('e'); insert into public.user_profiles (username) values ('elodie.s1');
  perform pg_temp.login('f'); insert into public.user_profiles (username) values ('al_x.s1');
  perform pg_temp.login('1'); insert into public.user_profiles (username) values ('gaston.s1');
  perform pg_temp.login('2'); insert into public.user_profiles (username) values ('hugo.s1');

  -- Sans pseudo (ou sans ligne de profil), case d'âge non cochée : refusé
  perform pg_temp.login('d');
  if pg_temp.err($q$ select public.social_enable(true) $q$) is distinct from 'username_required' then raise 'sans pseudo accepté'; end if;
  perform pg_temp.login('a');
  if pg_temp.err($q$ select public.social_enable(false) $q$) is distinct from 'age_required' then raise 'âge false accepté'; end if;
  if pg_temp.err($q$ select public.social_enable(null) $q$) is distinct from 'age_required' then raise 'âge null accepté'; end if;
  if (select social_at from public.user_profiles) is not null then raise 'activé malgré le refus'; end if;
  -- social_at hors de portée du client (aucun GRANT par colonne)
  if pg_temp.err($q$ update public.user_profiles set social_at = now() $q$) not like 'permission denied%' then raise 'social_at modifiable'; end if;
  perform pg_temp.login('2');
  if pg_temp.err($q$ update public.user_profiles set social_at = null $q$) not like 'permission denied%' then raise 'social_at effaçable'; end if;
  -- Activation, puis rappel sans effet
  perform pg_temp.login('a');
  perform public.social_enable(true);
  select social_at into first_at from public.user_profiles;
  if first_at is null then raise 'non activé'; end if;
  perform pg_sleep(0.01);
  perform public.social_enable(true);
  if (select social_at from public.user_profiles) is distinct from first_at then raise 'rappel : date changée'; end if;
  if not (public.social_state() ->> 'enabled')::boolean then raise 'social_state.enabled'; end if;
  perform pg_temp.login('b'); perform public.social_enable(true);
  perform pg_temp.login('c'); perform public.social_enable(true);
  perform pg_temp.login('f'); perform public.social_enable(true);
  perform pg_temp.login('1'); perform public.social_enable(true);
  perform pg_temp.login('2'); perform public.social_enable(true);
  perform pg_temp.login('e');
  if (public.social_state() ->> 'enabled')::boolean then raise 'E activé'; end if;
  if pg_temp.err($q$ select public.request_follow(pg_temp.u('b')) $q$) is distinct from 'social_not_enabled' then raise 'demande sans social'; end if;
end $$;

-- ── Séances de B et de C ─────────────────────────────────
do $$ begin
  perform pg_temp.login('b');
  insert into public.sessions (id, data) values
    ('b-vue', jsonb_build_object(
      'date', 1780000000000, 'duration', 3600, 'programme', 'ppl', 'category', 'push', 'label', 'Push A',
      'notes', 'note privée', 'bodyKg', 80.5, 'healthSaved', true, 'cleInventee', 'secret-futur',
      'exercises', jsonb_build_array(
        jsonb_build_object('name', 'Développé couché', 'measure', 'reps', 'ss', 'k3x9', 'note', 'secret-ex',
          'sets', jsonb_build_array(jsonb_build_object('weight', '80', 'reps', '8', 'rpe', 'secret-set', 'done', true))),
        jsonb_build_object('name', jsonb_build_object('fuite', 'secret-objet'), 'sets', 'pas une liste'),
        'pas un objet'))),
    ('b-masquee', '{"date": 1780000001000, "hidden": true, "category": "pull", "exercises": []}'),
    ('b-masquee-texte', '{"date": 1780000001500, "hidden": "true", "category": "pull", "exercises": []}'),
    ('b-supprimee', '{"date": 1780000002000, "category": "legs", "exercises": []}'),
    ('b-sans-date', '{"category": "legs", "exercises": []}'),
    ('b-date-texte', '{"date": "1780000003000", "category": "legs", "exercises": []}');
  update public.sessions set deleted_at = now() where id = 'b-supprimee';
  -- 21 séances plus anciennes : pagination
  insert into public.sessions (id, data)
    select 'b-old-' || i, jsonb_build_object('date', 1700000000000 + i, 'category', 'legs', 'exercises', '[]'::jsonb)
    from generate_series(1, 21) i;
  if (select done_at from public.sessions where id = 'b-vue') is distinct from 1780000000000 then raise 'done_at'; end if;
  if (select done_at from public.sessions where id = 'b-sans-date') is not null then raise 'done_at sans date'; end if;
  if (select done_at from public.sessions where id = 'b-date-texte') is not null then raise 'done_at date texte'; end if;
  if pg_temp.err($q$ update public.sessions set done_at = 1 where id = 'b-vue' $q$) = 'ok' then raise 'done_at modifiable'; end if;
  perform pg_temp.login('c');
  insert into public.sessions (id, data) values ('c-1', '{"date": 1780000000500, "category": "push", "exercises": []}');
  perform pg_temp.login('a');
  insert into public.sessions (id, data) values ('a-1', '{"date": 1780000000700, "category": "push", "exercises": []}');
end $$;

-- ── Demande, acceptation, fil ────────────────────────────
do $$
declare r record; st jsonb; n int;
begin
  perform pg_temp.login('a');
  if exists (select 1 from public.feed()) then raise 'fil non vide sans relation'; end if;
  if public.request_follow(pg_temp.u('b')) is distinct from 'requested' then raise 'demande'; end if;
  if public.request_follow(pg_temp.u('b')) is distinct from 'requested' then raise 'demande répétée'; end if;
  if exists (select 1 from public.feed()) then raise 'fil visible en attente'; end if;
  if pg_temp.err($q$ select public.toggle_bravo(pg_temp.u('b'), 'b-vue') $q$) is distinct from 'not_found' then raise 'bravo en attente'; end if;
  if pg_temp.err($q$ select public.request_follow(pg_temp.u('a')) $q$) is distinct from 'not_found' then raise 'demande à soi-même'; end if;
  st := public.social_state();
  if st -> 'requested' -> 0 ->> 'username' is distinct from 'bruno.s1' or st -> 'requested' -> 0 ->> 'avatar' is distinct from '🦊' then raise 'requested : %', st; end if;

  perform pg_temp.login('b');
  st := public.social_state();
  if (st ->> 'badge')::int is distinct from 1 then raise 'badge : %', st; end if;
  if st -> 'pending_in' -> 0 ->> 'user_id' is distinct from pg_temp.u('a')::text or st -> 'pending_in' -> 0 ->> 'username' is distinct from 'alice.s1'
     or st -> 'pending_in' -> 0 ->> 'since' is null then raise 'pending_in : %', st; end if;
  -- activity_new et shown_sessions : ajoutées par 20261031200000_reactions_profil.sql
  if (select array_agg(k order by k) from jsonb_object_keys(st) k)
     is distinct from array['activity_new', 'avatar', 'badge', 'blocked', 'enabled', 'followers', 'following', 'pending_in', 'requested', 'shown_sessions', 'username'] then raise 'clés de social_state : %', st; end if;
  perform public.respond_follow(pg_temp.u('a'), true);
  st := public.social_state();
  if (st ->> 'badge')::int is distinct from 0 or jsonb_array_length(st -> 'followers') is distinct from 1 then raise 'après acceptation : %', st; end if;

  perform pg_temp.login('a');
  if public.request_follow(pg_temp.u('b')) is distinct from 'following' then raise 'déjà abonné'; end if;
  if jsonb_array_length(public.social_state() -> 'following') is distinct from 1 then raise 'following'; end if;
  -- Première page : b-vue (la plus récente montrable) puis les anciennes ; masquées, supprimée, sans date exclues
  select count(*) into n from public.feed();
  if n is distinct from 20 then raise 'page de 20 : %', n; end if;
  select * into r from public.feed() limit 1;
  if r.id is distinct from 'b-vue' or r.owner is distinct from pg_temp.u('b') or r.username is distinct from 'bruno.s1' or r.avatar is distinct from '🦊' or r.done_at is distinct from 1780000000000 then raise 'carte : %', r; end if;
  if exists (select 1 from public.feed() where id in ('b-masquee', 'b-masquee-texte', 'b-supprimee', 'b-sans-date', 'b-date-texte')) then raise 'séance non montrable dans le fil'; end if;
  if exists (select 1 from public.feed() where owner is distinct from pg_temp.u('b')) then raise 'séances d''un autre (ou les miennes)'; end if;
  -- Page suivante : 2 restantes (21 anciennes + b-vue = 22 montrables)
  select count(*) into n from public.feed((select min(done_at) from public.feed()));
  if n is distinct from 2 then raise 'page 2 : %', n; end if;
  -- Liste blanche exacte
  if (select array_agg(k order by k) from jsonb_object_keys(r.s) k) is distinct from array['category', 'date', 'duration', 'exercises', 'label', 'programme'] then raise 'clés de la séance : %', r.s; end if;
  if jsonb_array_length(r.s -> 'exercises') is distinct from 2 then raise 'exercices : %', r.s; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(r.s -> 'exercises' -> 0) k) is distinct from array['measure', 'name', 'sets', 'ss'] then raise 'clés de l''exercice : %', r.s; end if;
  if r.s -> 'exercises' -> 0 ->> 'ss' is distinct from 'k3x9' then raise 'superset : %', r.s; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(r.s -> 'exercises' -> 0 -> 'sets' -> 0) k) is distinct from array['reps', 'weight'] then raise 'clés de la série : %', r.s; end if;
  if r.s -> 'exercises' -> 1 is distinct from '{"sets": []}'::jsonb then raise 'objet glissé dans name : %', r.s; end if;
  if r.s::text ~ '(note|bodyKg|healthSaved|hidden|secret|cleInventee|rpe|done)' then raise 'fuite : %', r.s; end if;
  if r.s ->> 'label' is distinct from 'Push A' or r.s -> 'exercises' -> 0 ->> 'name' is distinct from 'Développé couché' then raise 'valeurs : %', r.s; end if;
  -- Écran d'un profil
  if (select count(*) from public.feed(only_user => pg_temp.u('b'))) is distinct from 20 then raise 'only_user suivi'; end if;
  if exists (select 1 from public.feed(only_user => pg_temp.u('c'))) then raise 'only_user non suivi'; end if;
  if exists (select 1 from public.feed(only_user => pg_temp.u('a'))) then raise 'only_user soi-même'; end if;
end $$;

-- ── Masquer et désactiver ────────────────────────────────
do $$ begin
  perform pg_temp.login('b');
  update public.sessions set data = data || '{"hidden": true}' where id = 'b-vue';
  perform pg_temp.login('a');
  if exists (select 1 from public.feed() where id = 'b-vue') then raise 'séance masquée visible'; end if;
  perform pg_temp.login('b');
  update public.sessions set data = data - 'hidden' where id = 'b-vue';
  perform public.social_disable();
  if (public.social_state() ->> 'enabled')::boolean then raise 'désactivation'; end if;
  perform pg_temp.login('a');
  if exists (select 1 from public.feed()) then raise 'fil d''un social désactivé'; end if;
  if exists (select 1 from public.search_profiles('bru')) then raise 'recherche d''un social désactivé'; end if;
  if pg_temp.err($q$ select public.toggle_bravo(pg_temp.u('b'), 'b-vue') $q$) is distinct from 'not_found' then raise 'bravo social désactivé'; end if;
  -- Relations gardées : réactivation, tout revient
  perform pg_temp.login('b');
  perform public.social_enable(true);
  perform pg_temp.login('a');
  if not exists (select 1 from public.feed() where id = 'b-vue') then raise 'retour après réactivation'; end if;
  -- L'abonné qui désactive son propre social ne voit plus rien
  perform public.social_disable();
  if exists (select 1 from public.feed()) then raise 'fil d''un abonné désactivé'; end if;
  if exists (select 1 from public.search_profiles('bru')) then raise 'recherche par un désactivé'; end if;
  perform public.social_enable(true);
end $$;

-- ── Bravos ───────────────────────────────────────────────
do $$
declare j jsonb;
begin
  perform pg_temp.login('a');
  j := public.toggle_bravo(pg_temp.u('b'), 'b-vue');
  if j is distinct from '{"bravos": 1, "mine": true}' then raise 'bravo mis : %', j; end if;
  if (select bravos from public.feed() where id = 'b-vue') is distinct from 1 or not (select my_bravo from public.feed() where id = 'b-vue') then raise 'bravo dans le fil'; end if;
  j := public.toggle_bravo(pg_temp.u('b'), 'b-vue');
  if j is distinct from '{"bravos": 0, "mine": false}' then raise 'bravo retiré : %', j; end if;
  perform public.toggle_bravo(pg_temp.u('b'), 'b-vue');
  -- Séance non visible, la sienne, d'un inconnu, inexistante : not_found
  if pg_temp.err($q$ select public.toggle_bravo(pg_temp.u('b'), 'b-masquee') $q$) is distinct from 'not_found' then raise 'bravo séance masquée'; end if;
  if pg_temp.err($q$ select public.toggle_bravo(pg_temp.u('b'), 'b-supprimee') $q$) is distinct from 'not_found' then raise 'bravo séance supprimée'; end if;
  if pg_temp.err($q$ select public.toggle_bravo(pg_temp.u('b'), 'nexiste-pas') $q$) is distinct from 'not_found' then raise 'bravo séance inexistante'; end if;
  if pg_temp.err($q$ select public.toggle_bravo(pg_temp.u('a'), 'a-1') $q$) is distinct from 'not_found' then raise 'bravo sur sa séance'; end if;
  if pg_temp.err($q$ select public.toggle_bravo(pg_temp.u('c'), 'c-1') $q$) is distinct from 'not_found' then raise 'bravo non abonné'; end if;
  perform pg_temp.login('b');
  if (select bravos from public.my_bravos() where session_id = 'b-vue') is distinct from 1 or (select count(*) from public.my_bravos()) is distinct from 1 then raise 'my_bravos'; end if;
  perform pg_temp.login('a');
  if exists (select 1 from public.my_bravos()) then raise 'my_bravos d''un autre'; end if;
end $$;

-- ── Aucune écriture ni lecture directe ───────────────────
do $$
declare t text;
begin
  perform pg_temp.login('a');
  if pg_temp.err($q$ insert into public.follows (follower_id, followee_id, status) values (pg_temp.u('a'), pg_temp.u('c'), 'accepted') $q$) not like 'permission denied%' then raise 'insert follows'; end if;
  if pg_temp.err($q$ update public.follows set status = 'accepted' $q$) not like 'permission denied%' then raise 'update follows'; end if;
  if pg_temp.err($q$ delete from public.blocks $q$) not like 'permission denied%' then raise 'delete blocks'; end if;
  if pg_temp.err($q$ insert into public.blocks (blocker_id, blocked_id) values (pg_temp.u('a'), pg_temp.u('c')) $q$) not like 'permission denied%' then raise 'insert blocks'; end if;
  if pg_temp.err($q$ insert into public.bravos (session_owner, session_id, user_id) values (pg_temp.u('c'), 'c-1', pg_temp.u('a')) $q$) not like 'permission denied%' then raise 'insert bravos'; end if;
  if pg_temp.err($q$ update public.bravos set created_at = now() $q$) not like 'permission denied%' then raise 'update bravos'; end if;
  if pg_temp.err($q$ insert into public.reports (reporter_id, target_user, kind, reason) values (pg_temp.u('a'), pg_temp.u('c'), 'profile', 'spam') $q$) not like 'permission denied%' then raise 'insert reports'; end if;
  foreach t in array array['public.follows', 'public.blocks', 'public.bravos', 'public.reports', 'private.social_rate'] loop
    if pg_temp.err(format('select * from %s', t)) not like 'permission denied%' then raise 'lecture directe de %', t; end if;
  end loop;
  if pg_temp.err($q$ select private.session_public('{}') $q$) not like 'permission denied%' then raise 'private.session_public appelable'; end if;
  if pg_temp.err($q$ select private.rate_limit(pg_temp.u('a'), 'follow', 0) $q$) not like 'permission denied%' then raise 'private.rate_limit appelable'; end if;
  -- Les autres profils restent illisibles en direct
  if (select count(*) from public.user_profiles) is distinct from 1 then raise 'user_profiles : RLS'; end if;
end $$;

-- ── Refus, retrait, annulation ───────────────────────────
do $$ begin
  perform pg_temp.login('c'); perform public.request_follow(pg_temp.u('a'));
  perform pg_temp.login('a'); perform public.respond_follow(pg_temp.u('c'), false);
  reset role;
  if exists (select 1 from public.follows where follower_id = pg_temp.u('c') and followee_id = pg_temp.u('a')) then raise 'refus : ligne gardée'; end if;
  set role authenticated;
  perform pg_temp.login('c'); perform public.request_follow(pg_temp.u('a'));
  perform public.cancel_follow(pg_temp.u('a'));
  if jsonb_array_length(public.social_state() -> 'requested') is distinct from 0 then raise 'annulation'; end if;
  perform pg_temp.login('f'); perform public.request_follow(pg_temp.u('a'));
  perform pg_temp.login('a'); perform public.respond_follow(pg_temp.u('f'), true);
  perform public.remove_follower(pg_temp.u('f'));
  if jsonb_array_length(public.social_state() -> 'followers') is distinct from 0 then raise 'retrait d''un abonné'; end if;
  -- Répondre à une demande qui n'existe pas : rien
  perform public.respond_follow(pg_temp.u('f'), true);
  if jsonb_array_length(public.social_state() -> 'followers') is distinct from 0 then raise 'acceptation sans demande'; end if;
end $$;

-- ── Recherche ────────────────────────────────────────────
do $$ begin
  perform pg_temp.login('b');
  -- Préfixe, majuscules et accents, « @ » et espaces ignorés
  if (select array_agg(username) from public.search_profiles('  @ÂLI ')) is distinct from array['alice.s1'] then raise 'accents : %', (select array_agg(username) from public.search_profiles('ÂLI')); end if;
  if (select relation from public.search_profiles('alice.s1')) is distinct from 'follows_you' then raise 'relation follows_you'; end if;
  -- « _ » et « % » pris à la lettre (sinon « al_ » trouverait aussi alice.s1, « al% » tout le monde)
  if (select array_agg(username) from public.search_profiles('al_')) is distinct from array['al_x.s1'] then raise '_ non échappé'; end if;
  if exists (select 1 from public.search_profiles('al%')) then raise '%% non échappé'; end if;
  if exists (select 1 from public.search_profiles('%')) or exists (select 1 from public.search_profiles('\%')) then raise 'joker'; end if;
  -- Exacte d'abord : 'al' trouve al_x.s1 (plus court) avant alice.s1
  if (select array_agg(username) from public.search_profiles('al')) is distinct from array['al_x.s1', 'alice.s1'] then raise 'ordre'; end if;
  -- Trop court, vide, null : rien ; soi-même exclu ; profil sans social exclu
  if exists (select 1 from public.search_profiles('a')) or exists (select 1 from public.search_profiles('')) or exists (select 1 from public.search_profiles(null)) then raise 'moins de 2 caractères'; end if;
  if exists (select 1 from public.search_profiles('bru')) then raise 'soi-même trouvé'; end if;
  if exists (select 1 from public.search_profiles('elo')) then raise 'profil sans social trouvé'; end if;
  perform pg_temp.login('a');
  if (select relation from public.search_profiles('bru')) is distinct from 'following' then raise 'relation following'; end if;
  if (select relation from public.search_profiles('chl')) is distinct from 'none' then raise 'relation none'; end if;
  perform public.request_follow(pg_temp.u('c'));
  if (select relation from public.search_profiles('chl')) is distinct from 'requested' then raise 'relation requested'; end if;
  perform public.cancel_follow(pg_temp.u('c'));
  -- Demande vers un profil sans social : fantôme, visible seulement par moi
  if public.request_follow(pg_temp.u('e')) is distinct from 'requested' then raise 'demande fantôme (sans social)'; end if;
  if public.request_follow(pg_temp.u('e')) is distinct from 'requested' then raise 'demande fantôme répétée'; end if;
  if public.social_state() -> 'requested' -> 0 ->> 'username' is distinct from 'elodie.s1' then raise 'fantôme absent de requested : %', public.social_state(); end if;
  -- E active son social : la demande fantôme ne devient pas une vraie demande
  perform pg_temp.login('e');
  if (public.social_state() ->> 'badge')::int is distinct from 0 or public.social_state() -> 'pending_in' is distinct from '[]' then raise 'E voit le fantôme'; end if;
  perform public.social_enable(true);
  if (public.social_state() ->> 'badge')::int is distinct from 0 then raise 'fantôme devenu demande'; end if;
  perform public.respond_follow(pg_temp.u('a'), true);
  perform public.remove_follower(pg_temp.u('a'));
  perform pg_temp.login('a');
  if exists (select 1 from public.search_profiles('elo') where relation is distinct from 'requested') then raise 'fantôme accepté ou retiré par E'; end if;
  perform public.cancel_follow(pg_temp.u('e'));
  if public.social_state() -> 'requested' is distinct from '[]' then raise 'annulation du fantôme'; end if;
  perform pg_temp.login('e'); perform public.social_disable();
  -- L'appelant sans social ne cherche pas
  perform pg_temp.login('e');
  if exists (select 1 from public.search_profiles('ali')) then raise 'recherche sans social'; end if;
end $$;

-- ── Blocage, dans les deux sens ──────────────────────────
do $$ begin
  -- C suit B, B suit C, C a mis un bravo à B, B un bravo à C
  perform pg_temp.login('c'); perform public.request_follow(pg_temp.u('b'));
  perform pg_temp.login('b'); perform public.respond_follow(pg_temp.u('c'), true); perform public.request_follow(pg_temp.u('c'));
  perform pg_temp.login('c'); perform public.respond_follow(pg_temp.u('b'), true);
  perform public.toggle_bravo(pg_temp.u('b'), 'b-vue');
  perform pg_temp.login('b'); perform public.toggle_bravo(pg_temp.u('c'), 'c-1');
  if (select bravos from public.my_bravos() where session_id = 'b-vue') is distinct from 2 then raise 'avant blocage'; end if;

  perform public.block_user(pg_temp.u('c'));
  perform public.block_user(pg_temp.u('c'));   -- deux fois : sans effet
  if pg_temp.err($q$ select public.block_user(pg_temp.u('b')) $q$) is distinct from 'not_found' then raise 'se bloquer soi-même'; end if;
  -- Identifiant inconnu : silencieux, rien de créé (pas d'oracle d'existence)
  if pg_temp.err($q$ select public.block_user('00000000-0000-0000-0000-0000000005ff') $q$) is distinct from 'ok' then raise 'bloquer un inconnu'; end if;
  if jsonb_array_length(public.social_state() -> 'blocked') is distinct from 1 then raise 'inconnu dans les bloqués'; end if;
  if (select bravos from public.my_bravos() where session_id = 'b-vue') is distinct from 1 then raise 'bravo de C gardé'; end if;
  if jsonb_array_length(public.social_state() -> 'blocked') is distinct from 1 or public.social_state() -> 'blocked' -> 0 ->> 'username' is distinct from 'chloe.s1' then raise 'liste des bloqués'; end if;
  if jsonb_array_length(public.social_state() -> 'followers') is distinct from 1 or jsonb_array_length(public.social_state() -> 'following') is distinct from 0 then raise 'abonnements gardés : %', public.social_state(); end if;
  if exists (select 1 from public.search_profiles('chl')) then raise 'B trouve C'; end if;
  if public.request_follow(pg_temp.u('c')) is distinct from 'requested' then raise 'demande de B vers C bloqué'; end if;

  perform pg_temp.login('c');
  if exists (select 1 from public.search_profiles('bru')) then raise 'C trouve B'; end if;
  if exists (select 1 from public.feed()) or exists (select 1 from public.feed(only_user => pg_temp.u('b'))) then raise 'C voit le fil de B'; end if;
  if exists (select 1 from public.my_bravos()) then raise 'bravo de B à C gardé'; end if;
  if pg_temp.err($q$ select public.toggle_bravo(pg_temp.u('b'), 'b-vue') $q$) is distinct from 'not_found' then raise 'bravo malgré le blocage'; end if;
  -- Demande fantôme : même réponse et même affichage qu'une demande normale, blocage jamais révélé
  if public.request_follow(pg_temp.u('b')) is distinct from 'requested' then raise 'demande vers B bloquant'; end if;
  if public.social_state() -> 'requested' -> 0 ->> 'username' is distinct from 'bruno.s1' or public.social_state() -> 'blocked' is distinct from '[]' then raise 'C voit autre chose qu''une demande : %', public.social_state(); end if;
  if public.request_follow(pg_temp.u('b')) is distinct from 'requested' then raise 'redemande vers B bloquant'; end if;
  perform pg_temp.login('b');
  if (public.social_state() ->> 'badge')::int is distinct from 0 or public.social_state() -> 'pending_in' is distinct from '[]' then raise 'B voit la demande fantôme'; end if;
  perform public.respond_follow(pg_temp.u('c'), true);
  perform pg_temp.login('c');
  if exists (select 1 from public.feed()) then raise 'fantôme accepté'; end if;
  reset role;
  if exists (select 1 from public.follows where (follower_id, followee_id) in ((pg_temp.u('c'), pg_temp.u('b')), (pg_temp.u('b'), pg_temp.u('c'))) and status is distinct from 'ghost') then raise 'vraie demande créée malgré le blocage'; end if;
  if exists (select 1 from public.bravos where (user_id = pg_temp.u('c') and session_owner = pg_temp.u('b')) or (user_id = pg_temp.u('b') and session_owner = pg_temp.u('c'))) then raise 'bravos échangés gardés'; end if;
  set role authenticated;
  perform pg_temp.login('b');
  perform public.unblock_user(pg_temp.u('c'));
  if not exists (select 1 from public.search_profiles('chl')) then raise 'déblocage'; end if;
  -- Déblocage : les fantômes entre les deux disparaissent (ils ne deviennent pas de vraies demandes)
  if (public.social_state() ->> 'badge')::int is distinct from 0 or public.social_state() -> 'requested' is distinct from '[]' then raise 'fantôme après déblocage : %', public.social_state(); end if;
  perform pg_temp.login('c');
  if public.social_state() -> 'requested' is distinct from '[]' then raise 'fantôme de C gardé'; end if;
  if (select relation from public.search_profiles('bru')) is distinct from 'none' then raise 'relation après déblocage'; end if;
end $$;

-- ── Blocage : demande en attente, compte sans social, courses ──
do $$ begin
  -- C a une demande en attente vers A ; A bloque C : de son côté, C voit toujours « demandée »
  perform pg_temp.login('c'); perform public.request_follow(pg_temp.u('a'));
  perform pg_temp.login('a'); perform public.block_user(pg_temp.u('c'));
  if (public.social_state() ->> 'badge')::int is distinct from 0 then raise 'demande d''un bloqué dans le badge'; end if;
  perform pg_temp.login('c');
  if public.social_state() -> 'requested' -> 0 ->> 'username' is distinct from 'alice.s1' then raise 'demande de C disparue au blocage'; end if;
  perform pg_temp.login('a'); perform public.unblock_user(pg_temp.u('c'));
  perform pg_temp.login('c');
  if public.social_state() -> 'requested' is distinct from '[]' then raise 'fantôme gardé au déblocage'; end if;

  -- Bloquer un compte sans social (E) : ni pseudo ni avatar dans ma liste
  perform pg_temp.login('a'); perform public.block_user(pg_temp.u('e'));
  if public.social_state() -> 'blocked' -> 0 is distinct from jsonb_build_object('user_id', pg_temp.u('e'), 'username', null, 'avatar', null,
       'since', public.social_state() -> 'blocked' -> 0 -> 'since') then raise 'pseudo d''un compte sans social : %', public.social_state() -> 'blocked'; end if;
  perform public.unblock_user(pg_temp.u('e'));

  -- Course simulée : une demande en attente coexiste avec un blocage (écrite par le serveur)
  reset role;
  insert into public.blocks (blocker_id, blocked_id) values (pg_temp.u('f'), pg_temp.u('a'));
  insert into public.follows (follower_id, followee_id) values (pg_temp.u('f'), pg_temp.u('a'));
  set role authenticated;
  perform pg_temp.login('a');
  if (public.social_state() ->> 'badge')::int is distinct from 0 or public.social_state() -> 'pending_in' is distinct from '[]' then raise 'demande d''un compte bloquant dans pending_in'; end if;
  perform public.respond_follow(pg_temp.u('f'), true);
  reset role;
  if (select status from public.follows where follower_id = pg_temp.u('f') and followee_id = pg_temp.u('a')) is distinct from 'pending' then raise 'acceptée malgré le blocage'; end if;
  delete from public.blocks where blocker_id = pg_temp.u('f');
  delete from public.follows where follower_id = pg_temp.u('f') and followee_id = pg_temp.u('a');
  set role authenticated;

  -- Un tiers n'accepte pas une demande qui ne lui est pas adressée
  perform pg_temp.login('f'); perform public.request_follow(pg_temp.u('c'));
  perform pg_temp.login('a'); perform public.respond_follow(pg_temp.u('f'), true);
  perform pg_temp.login('b'); perform public.respond_follow(pg_temp.u('f'), true); perform public.respond_follow(pg_temp.u('f'), false);
  perform pg_temp.login('c');
  if (public.social_state() ->> 'badge')::int is distinct from 1 then raise 'demande de F à C modifiée par un tiers'; end if;
  perform public.respond_follow(pg_temp.u('f'), false);
end $$;

-- ── Fil : ex aequo et dates futures ──────────────────────
do $$
declare n1 int; n2 int; last record; ids text[];
begin
  -- C : 25 séances à la même milliseconde, plus une datée dans 2 jours et une dans 2 h
  perform pg_temp.login('c');
  insert into public.sessions (id, data)
    select 'c-meme-' || lpad(i::text, 2, '0'), '{"date": 1785000000000, "category": "push", "exercises": []}'::jsonb from generate_series(1, 25) i;
  insert into public.sessions (id, data) values
    ('c-futur', jsonb_build_object('date', (extract(epoch from now()) * 1000)::bigint + 2 * 86400000, 'category', 'push', 'exercises', '[]'::jsonb)),
    ('c-horloge', jsonb_build_object('date', (extract(epoch from now()) * 1000)::bigint + 2 * 3600000, 'category', 'push', 'exercises', '[]'::jsonb));
  perform pg_temp.login('a'); perform public.request_follow(pg_temp.u('c'));
  perform pg_temp.login('c'); perform public.respond_follow(pg_temp.u('a'), true);
  perform pg_temp.login('a');
  if exists (select 1 from public.feed() where id = 'c-futur') then raise 'séance du futur lointain dans le fil'; end if;
  if (select id from public.feed(only_user => pg_temp.u('c')) limit 1) is distinct from 'c-horloge' then raise 'horloge en avance de 2 h refusée'; end if;
  if pg_temp.err($q$ select public.toggle_bravo(pg_temp.u('c'), 'c-futur') $q$) is distinct from 'not_found' then raise 'bravo sur une séance du futur'; end if;
  -- Curseur complet : 20 puis 6 (les 25 ex aequo + c-horloge), sans doublon ni oubli ; c-1 ensuite
  select count(*) into n1 from public.feed(only_user => pg_temp.u('c'));
  select * into last from public.feed(only_user => pg_temp.u('c')) offset 19 limit 1;
  select count(*) into n2 from public.feed(last.done_at, last.owner, last.id, pg_temp.u('c')) where id like 'c-meme-%';
  if n1 is distinct from 20 or n2 is distinct from 6 then raise 'ex aequo : % puis %', n1, n2; end if;
  select array_agg(id) into ids from (
    select id from public.feed(only_user => pg_temp.u('c'))
    union all
    select id from public.feed(last.done_at, last.owner, last.id, pg_temp.u('c'))) x;
  if (select count(distinct i) from unnest(ids) i where i like 'c-meme-%') is distinct from 25 or cardinality(ids) is distinct from 27 then raise 'pages : %', ids; end if;
  perform public.cancel_follow(pg_temp.u('c'));
end $$;

-- ── Limites par jour ─────────────────────────────────────
do $$
declare i int;
begin
  -- 30 demandes, neutres comprises (cibles inconnues), puis rate_limited
  perform pg_temp.login('1');
  for i in 1..30 loop
    if public.request_follow(gen_random_uuid()) is distinct from 'requested' then raise 'demande %', i; end if;
  end loop;
  if pg_temp.err($q$ select public.request_follow(pg_temp.u('a')) $q$) is distinct from 'rate_limited' then raise '31e demande acceptée'; end if;
  -- Relation déjà là : répond sans compter
  perform pg_temp.login('2');
  perform public.request_follow(pg_temp.u('b'));
  perform pg_temp.login('b'); perform public.respond_follow(pg_temp.u('2'), true);
  perform pg_temp.login('2');
  -- 200 bravos mis (retirés à chaque fois), le 201e est refusé
  for i in 1..200 loop
    perform public.toggle_bravo(pg_temp.u('b'), 'b-vue');
    perform public.toggle_bravo(pg_temp.u('b'), 'b-vue');
  end loop;
  if pg_temp.err($q$ select public.toggle_bravo(pg_temp.u('b'), 'b-vue') $q$) is distinct from 'rate_limited' then raise '201e bravo accepté'; end if;
  -- Une fois les 24 h passées, la limite se libère
  reset role;
  update private.social_rate set at = now() - interval '25 hours' where user_id = pg_temp.u('2');
  set role authenticated;
  if (public.toggle_bravo(pg_temp.u('b'), 'b-vue') ->> 'mine')::boolean is not true then raise 'limite non libérée'; end if;
end $$;

-- ── Signalements (comme la fonction Edge report : clé serveur) ──
reset role;
set role service_role;
do $$
declare i int; r record;
begin
  insert into public.reports (reporter_id, target_user, kind, target_ref, reason, details, created_at, target_username)
    values (pg_temp.u('a'), pg_temp.u('b'), 'session', 'b-vue', 'harcelement', 'Messages répétés', '2000-01-01', 'faux')
    returning * into r;
  if r.target_username is distinct from 'bruno.s1' or r.created_at < now() - interval '1 minute' or r.notified_at is not null then raise 'colonnes posées par le serveur : %', r; end if;
  update public.reports set notified_at = now() where id = r.id;
  if pg_temp.err($q$ update public.reports set reason = 'spam' $q$) not like 'permission denied%' then raise 'reports modifiable'; end if;
  if pg_temp.err($q$ delete from public.reports $q$) not like 'permission denied%' then raise 'reports effaçable'; end if;
  if pg_temp.err($q$ insert into public.reports (reporter_id, target_user, kind, reason) values (pg_temp.u('a'), pg_temp.u('a'), 'profile', 'spam') $q$) not like '%reports_not_self%' then raise 'se signaler soi-même'; end if;
  if pg_temp.err($q$ insert into public.reports (reporter_id, target_user, kind, reason) values (pg_temp.u('a'), pg_temp.u('b'), 'profile', 'insulte') $q$) not like '%reports_reason_check%' then raise 'motif hors liste'; end if;
  if pg_temp.err($q$ insert into public.reports (reporter_id, target_user, kind, reason, details) values (pg_temp.u('a'), pg_temp.u('b'), 'profile', 'spam', repeat('x', 501)) $q$) not like '%reports_details_check%' then raise 'détails trop longs'; end if;
  if pg_temp.err($q$ insert into public.reports (reporter_id, target_user, kind, reason) values (pg_temp.u('a'), '00000000-0000-0000-0000-0000000005ff', 'profile', 'spam') $q$) not like '%foreign key%' then raise 'cible inconnue'; end if;
  -- 10 par 24 h et par compte
  for i in 2..10 loop
    insert into public.reports (reporter_id, target_user, kind, reason) values (pg_temp.u('a'), pg_temp.u('c'), 'profile', 'spam');
  end loop;
  if pg_temp.err($q$ insert into public.reports (reporter_id, target_user, kind, reason) values (pg_temp.u('a'), pg_temp.u('c'), 'profile', 'spam') $q$) is distinct from 'rate_limited' then raise '11e signalement accepté'; end if;
  insert into public.reports (reporter_id, target_user, kind, reason) values (pg_temp.u('c'), pg_temp.u('a'), 'profile', 'autre');
  -- La clé serveur ne lit pas les relations
  if pg_temp.err($q$ select * from public.follows $q$) not like 'permission denied%' then raise 'service_role lit follows'; end if;
end $$;
reset role;
-- Purge des signalements de plus de 12 mois au signalement suivant
update public.reports set created_at = now() - interval '13 months' where reporter_id = pg_temp.u('c');
insert into public.reports (reporter_id, target_user, kind, reason) values (pg_temp.u('2'), pg_temp.u('a'), 'profile', 'spam');
do $$ begin
  if exists (select 1 from public.reports where reporter_id = pg_temp.u('c')) then raise 'purge des 12 mois'; end if;
end $$;

-- ── Anonyme : rien ───────────────────────────────────────
set role anon;
set request.jwt.claim.sub = '';
do $$
declare f text;
begin
  foreach f in array array[
    'public.social_enable(true)', 'public.social_disable()', 'public.social_state()',
    '* from public.search_profiles(''ali'')', 'public.request_follow(pg_temp.u(''a''))',
    'public.cancel_follow(pg_temp.u(''a''))', 'public.respond_follow(pg_temp.u(''a''), true)',
    'public.remove_follower(pg_temp.u(''a''))', 'public.block_user(pg_temp.u(''a''))',
    'public.unblock_user(pg_temp.u(''a''))', '* from public.feed()', 'public.toggle_bravo(pg_temp.u(''b''), ''b-vue'')',
    '* from public.my_bravos()', '* from public.follows', '* from public.blocks', '* from public.bravos',
    '* from public.reports', '* from public.user_profiles', '* from private.social_rate'] loop
    if pg_temp.err('select ' || f) not like 'permission denied%' then raise 'anon : %', f; end if;
  end loop;
end $$;
reset role;

-- ── Droits déclarés : chaque fonction RPC exécutable par authenticated seulement ──
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('social_enable', 'social_disable', 'social_state', 'search_profiles', 'request_follow',
                               'cancel_follow', 'respond_follow', 'remove_follower', 'block_user', 'unblock_user',
                               'feed', 'toggle_bravo', 'my_bravos') loop
    if not has_function_privilege('authenticated', f, 'execute') then raise '% : authenticated sans droit', f; end if;
    if has_function_privilege('anon', f, 'execute') then raise '% : anon a le droit', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('social_enable', 'social_disable', 'social_state', 'search_profiles', 'request_follow',
      'cancel_follow', 'respond_follow', 'remove_follower', 'block_user', 'unblock_user', 'feed', 'toggle_bravo', 'my_bravos')) <> 13 then raise 'fonctions du contrat manquantes'; end if;
end $$;

-- ── Suppression du compte : tout part en cascade ─────────
do $$
declare b uuid := pg_temp.u('b');
begin
  if not exists (select 1 from public.follows where followee_id = b) or not exists (select 1 from public.bravos where session_owner = b)
     or not exists (select 1 from public.reports where target_user = b) then raise 'données de B absentes avant la suppression'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (b, pg_temp.u('d'));
  delete from auth.users where id = b;
  if exists (select 1 from public.follows where b in (follower_id, followee_id)) then raise 'cascade follows'; end if;
  if exists (select 1 from public.blocks where b in (blocker_id, blocked_id)) then raise 'cascade blocks'; end if;
  if exists (select 1 from public.bravos where b in (session_owner, user_id)) then raise 'cascade bravos'; end if;
  if exists (select 1 from public.reports where b in (reporter_id, target_user)) then raise 'cascade reports'; end if;
  if exists (select 1 from public.sessions where user_id = b) then raise 'cascade sessions'; end if;
  if exists (select 1 from public.user_profiles where user_id = b) then raise 'cascade profil'; end if;
  delete from auth.users where id = pg_temp.u('2');
  if exists (select 1 from private.social_rate where user_id = pg_temp.u('2')) then raise 'cascade social_rate'; end if;
end $$;
