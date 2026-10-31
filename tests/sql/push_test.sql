-- Vérifications de supabase/migrations/20261031900000_notifications_push.sql (lancées par tests/sql/run.sh).
-- Chaque bloc échoue (raise) si la règle n'est pas tenue. Jetons : faux, évidents (répétitions de « a », « b »…).
--
-- Comptes simulés (pg_temp.pu('a') → …0000000009a1, b → a2, c → a3, d → a4, e → a5) : A reçoit, B et C
-- agissent, D n'a pas d'appareil, E est le coach de A.

create function pg_temp.perr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.pu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000009a' || translate(c, 'abcde', '12345'))::uuid $$;
create function pg_temp.plogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.pu(c)::text, ''), false) $$;
create function pg_temp.tok(c text) returns text language sql immutable as $$ select repeat(c, 64) $$;
create function pg_temp.outbox(k text) returns int language sql as
$$ select count(*)::int from private.push_outbox where kind = k $$;
grant execute on function pg_temp.perr(text), pg_temp.pu(text), pg_temp.plogin(text), pg_temp.tok(text)
  to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.pu(c) from unnest(array['a', 'b', 'c', 'd', 'e']) c;
insert into public.user_profiles (user_id, username, avatar_emoji, social_at) values
  (pg_temp.pu('a'), 'alice.p1', '🦁', now()), (pg_temp.pu('b'), 'bruno.p1', '🦊', now()),
  (pg_temp.pu('c'), 'carla.p1', '🦅', now()), (pg_temp.pu('d'), 'dina.p1', '🐼', now()),
  (pg_temp.pu('e'), 'emile.p1', '⭐', now());
insert into public.sessions (user_id, id, data) values
  (pg_temp.pu('a'), 'pa-1', '{"date": 1}'), (pg_temp.pu('a'), 'pa-2', '{"date": 2}'), (pg_temp.pu('d'), 'pd-1', '{"date": 1}');

-- ── Personne d'autre que l'app et la fonction d'envoi ────
set role anon;
do $$ begin
  if pg_temp.perr($q$ select public.push_prefs() $q$) not like 'permission denied%' then raise 'anon lit des réglages'; end if;
  if pg_temp.perr(format($q$ select public.push_register(%L, 'production') $q$, pg_temp.tok('a'))) not like 'permission denied%' then raise 'anon inscrit un jeton'; end if;
  if pg_temp.perr($q$ select * from public.push_devices $q$) not like 'permission denied%' then raise 'anon lit les jetons'; end if;
  if pg_temp.perr(format($q$ select public.push_release(%L) $q$, pg_temp.tok('a'))) not like 'permission denied%' then raise 'anon retire un jeton'; end if;
  if pg_temp.perr($q$ select public.push_auth_get() $q$) not like 'permission denied%' then raise 'anon lit le jeton du fournisseur'; end if;
  if pg_temp.perr($q$ select public.push_auth_swap(null, 'faux.jwt', 1, 'FAKEKEY123') $q$) not like 'permission denied%' then raise 'anon pose le jeton du fournisseur'; end if;
end $$;
reset role;
set role authenticated;
do $$ begin
  perform pg_temp.plogin('a');
  if pg_temp.perr($q$ select * from public.push_devices $q$) not like 'permission denied%' then raise 'lecture directe des jetons'; end if;
  if pg_temp.perr($q$ select * from public.push_prefs $q$) not like 'permission denied%' then raise 'lecture directe des réglages'; end if;
  if pg_temp.perr($q$ insert into public.push_prefs (user_id, reactions) values (auth.uid(), true) $q$) not like 'permission denied%' then raise 'écriture directe des réglages'; end if;
  if pg_temp.perr($q$ select * from private.push_outbox $q$) not like 'permission denied%' then raise 'lecture de la file'; end if;
  if pg_temp.perr($q$ select public.push_claim(10) $q$) not like 'permission denied%' then raise 'un compte prend la file'; end if;
  if pg_temp.perr($q$ select public.push_done('{1}', '{}') $q$) not like 'permission denied%' then raise 'un compte solde la file'; end if;
  if pg_temp.perr($q$ select public.push_auth_get() $q$) not like 'permission denied%' then raise 'un compte lit le jeton du fournisseur'; end if;
  if pg_temp.perr($q$ select public.push_auth_swap(null, 'faux.jwt', 1, 'FAKEKEY123') $q$) not like 'permission denied%' then raise 'un compte pose le jeton du fournisseur'; end if;
  if pg_temp.perr($q$ select * from private.push_apns_auth $q$) not like 'permission denied%' then raise 'lecture directe du jeton du fournisseur'; end if;
end $$;

-- ── Réglages : tout éteint par défaut, jeton validé ──────
do $$
declare p jsonb;
begin
  perform pg_temp.plogin('a');
  if public.push_prefs() is distinct from '{"reactions": false, "follows": false, "coach": false}'::jsonb then raise 'défaut : %', public.push_prefs(); end if;
  if pg_temp.perr($q$ select public.push_register('pas-un-jeton', 'production') $q$) is distinct from 'invalid_token' then raise 'jeton invalide accepté'; end if;
  if pg_temp.perr(format($q$ select public.push_register(%L, 'production') $q$, upper(pg_temp.tok('a')))) is distinct from 'invalid_token' then raise 'majuscules acceptées'; end if;
  if pg_temp.perr(format($q$ select public.push_register(%L, 'beta') $q$, pg_temp.tok('a'))) is distinct from 'invalid_token' then raise 'environnement inconnu accepté'; end if;
  perform public.push_register(pg_temp.tok('a'), 'production');
  perform public.push_register(pg_temp.tok('a'), 'production');   -- relancé à chaque démarrage : une seule ligne
  p := public.push_set_prefs(true, null, null);
  if p is distinct from '{"reactions": true, "follows": false, "coach": false}'::jsonb then raise 'réglage : %', p; end if;
  -- B : un appareil, rien d'allumé ; D : tout allumé, aucun appareil
  perform pg_temp.plogin('b');
  perform public.push_register(pg_temp.tok('b'), 'sandbox');
  perform pg_temp.plogin('d');
  perform public.push_set_prefs(true, true, true);
  -- Sans compte : refusé
  perform pg_temp.plogin(null);
  if pg_temp.perr($q$ select public.push_set_prefs(true, true, true) $q$) is distinct from 'not_signed_in' then raise 'réglage sans compte'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.push_devices) <> 2 then raise 'appareils : %', (select count(*) from public.push_devices); end if;
end $$;

-- ── Bravo reçu ───────────────────────────────────────────
do $$ begin
  insert into public.bravos (session_owner, session_id, user_id) values (pg_temp.pu('a'), 'pa-1', pg_temp.pu('b'));
  if pg_temp.outbox('reaction') <> 1 then raise 'bravo non mis en file'; end if;
  -- Retiré puis remis : pas une deuxième fois (24 h)
  delete from public.bravos where session_owner = pg_temp.pu('a') and user_id = pg_temp.pu('b');
  insert into public.bravos (session_owner, session_id, user_id) values (pg_temp.pu('a'), 'pa-1', pg_temp.pu('b'));
  if pg_temp.outbox('reaction') <> 1 then raise 'bravo remis : deux notifications'; end if;
  -- Autre séance : une autre notification
  insert into public.bravos (session_owner, session_id, user_id) values (pg_temp.pu('a'), 'pa-2', pg_temp.pu('b'));
  if pg_temp.outbox('reaction') <> 2 then raise 'bravo sur une autre séance oublié'; end if;
  -- D a tout allumé mais aucun appareil : rien
  insert into public.bravos (session_owner, session_id, user_id) values (pg_temp.pu('d'), 'pd-1', pg_temp.pu('b'));
  if exists (select 1 from private.push_outbox where recipient = pg_temp.pu('d')) then raise 'mis en file sans appareil'; end if;
  -- Bloqué : rien (C bloqué par A)
  insert into public.blocks (blocker_id, blocked_id) values (pg_temp.pu('a'), pg_temp.pu('c'));
  insert into public.bravos (session_owner, session_id, user_id) values (pg_temp.pu('a'), 'pa-1', pg_temp.pu('c'));
  if exists (select 1 from private.push_outbox where actor = pg_temp.pu('c')) then raise 'notification d''un compte bloqué'; end if;
  delete from public.blocks;
end $$;

-- ── Demande d'abonnement ─────────────────────────────────
do $$ begin
  -- A n'a pas allumé « demandes » : rien
  insert into public.follows (follower_id, followee_id, status) values (pg_temp.pu('b'), pg_temp.pu('a'), 'pending');
  if pg_temp.outbox('follow_request') <> 0 then raise 'demande notifiée sans accord'; end if;
  update public.push_prefs set follows = true where user_id = pg_temp.pu('a');
  insert into public.follows (follower_id, followee_id, status) values (pg_temp.pu('c'), pg_temp.pu('a'), 'pending');
  if pg_temp.outbox('follow_request') <> 1 then raise 'demande non mise en file'; end if;
  -- Demande fantôme : jamais révélée
  insert into public.follows (follower_id, followee_id, status) values (pg_temp.pu('d'), pg_temp.pu('a'), 'ghost');
  if pg_temp.outbox('follow_request') <> 1 then raise 'demande fantôme notifiée'; end if;
end $$;

-- ── Coach : commentaire et programme ─────────────────────
do $$ begin
  update public.push_prefs set coach = true where user_id = pg_temp.pu('a');
  insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('a'), pg_temp.pu('e'));
  insert into public.coach_notes (student_id, coach_id, session_id, text) values (pg_temp.pu('a'), pg_temp.pu('e'), 'pa-1', 'Bien joué');
  if pg_temp.outbox('coach_note') <> 1 then raise 'commentaire non mis en file'; end if;
  update public.coach_notes set seen_at = now() where student_id = pg_temp.pu('a');   -- lu : rien de neuf
  update public.coach_notes set text = 'Bien joué !' where student_id = pg_temp.pu('a');   -- retouché dans les 24 h
  if pg_temp.outbox('coach_note') <> 1 then raise 'commentaire retouché : deux notifications'; end if;
  insert into public.coach_programmes (student_id, coach_id, id, data) values (pg_temp.pu('a'), pg_temp.pu('e'), 'prog1', '{"name": "PPL"}');
  if pg_temp.outbox('coach_programme') <> 1 then raise 'programme non mis en file'; end if;
  -- Le contenu saisi ne va jamais dans la file
  if exists (select 1 from private.push_outbox where ref like '%Bien%' or ref like '%PPL%') then raise 'texte saisi dans la file'; end if;
end $$;

-- ── Jetons : un seul compte par jeton, retrait par son compte seulement ──
set role authenticated;
do $$ begin
  -- C essaie de retirer le jeton de A : rien
  perform pg_temp.plogin('c');
  perform public.push_unregister(pg_temp.tok('a'));
  -- B se connecte sur l'iPhone de A : le jeton passe à B
  perform pg_temp.plogin('b');
  perform public.push_register(pg_temp.tok('a'), 'production');
end $$;
reset role;
do $$ begin
  if (select user_id from public.push_devices where token = pg_temp.tok('a')) <> pg_temp.pu('b') then raise 'jeton pas déplacé'; end if;
  if (select count(*) from public.push_devices where token = pg_temp.tok('a')) <> 1 then raise 'jeton en double'; end if;
end $$;
set role authenticated;
do $$ begin
  perform pg_temp.plogin('a');
  perform public.push_unregister(pg_temp.tok('a'));   -- A ne peut plus retirer ce jeton : il est à B
  perform pg_temp.plogin('b');
  perform public.push_unregister(pg_temp.tok('a'));
  -- A se reconnecte sur son iPhone ; 11 appareils pour A : le plus ancien sort
  perform pg_temp.plogin('a');
  perform public.push_register(pg_temp.tok('a'), 'production');
  for i in 1..10 loop perform public.push_register(repeat('f', 62) || lpad(to_hex(i), 2, '0'), 'production'); end loop;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.push_devices where user_id = pg_temp.pu('a')) <> 10 then raise 'plus de 10 appareils'; end if;
  if exists (select 1 from public.push_devices where token = pg_temp.tok('a')) then raise 'le plus ancien appareil est resté'; end if;
  -- Retour à un seul appareil pour A
  delete from public.push_devices where user_id = pg_temp.pu('a');
  insert into public.push_devices (token, user_id, env) values (pg_temp.tok('a'), pg_temp.pu('a'), 'production');
end $$;

-- ── Session de A finie hors de l'app, B se connecte sur le même iPhone : le jeton de A est retiré ──
set role authenticated;
do $$ begin
  perform pg_temp.plogin(null);
  if pg_temp.perr(format($q$ select public.push_release(%L) $q$, pg_temp.tok('a'))) not like '%not_signed_in%' then raise 'retrait sans compte'; end if;
  perform pg_temp.plogin('b');
  perform public.push_register(pg_temp.tok('b'), 'sandbox');
  perform public.push_release(pg_temp.tok('b'));   -- le mien (inscrit entre-temps) : gardé
  perform public.push_release(pg_temp.tok('a'));   -- celui de A laissé sur cet iPhone : retiré
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.push_devices where token = pg_temp.tok('a')) then raise 'jeton de A resté après la connexion de B'; end if;
  if (select user_id from public.push_devices where token = pg_temp.tok('b')) is distinct from pg_temp.pu('b') then raise 'push_release a retiré le jeton du compte connecté'; end if;
  if (select count(*) from public.push_devices where user_id = pg_temp.pu('a')) <> 0 then raise 'autre appareil de A touché'; end if;
  insert into public.push_devices (token, user_id, env) values (pg_temp.tok('a'), pg_temp.pu('a'), 'production');
end $$;

-- ── Envoi : file prise une fois, préférences relues, jetons morts retirés ──
set role service_role;
do $$
declare rows jsonb; again jsonb; ids bigint[];
begin
  rows := public.push_claim(50);
  if jsonb_array_length(rows) <> 5 then raise 'prises : %', rows; end if;   -- 2 bravos, 1 demande, 1 commentaire, 1 programme
  if exists (select 1 from jsonb_array_elements(rows) r where r ->> 'token' is distinct from pg_temp.tok('a')) then raise 'mauvais appareil : %', rows; end if;
  if (select r ->> 'actor_name' from jsonb_array_elements(rows) r where r ->> 'kind' = 'follow_request') <> 'carla.p1' then raise 'pseudo de l''auteur'; end if;
  if exists (select 1 from jsonb_array_elements(rows) r where (r ->> 'wanted')::boolean is not true) then raise 'wanted faux'; end if;
  again := public.push_claim(50);
  if jsonb_array_length(again) <> 0 then raise 'prise deux fois : %', again; end if;
  select array_agg((r ->> 'id')::bigint) into ids from jsonb_array_elements(rows) r;
  perform public.push_done(ids, array[pg_temp.tok('b')]);
end $$;
reset role;
do $$ begin
  if exists (select 1 from private.push_outbox where sent_at is null) then raise 'non soldées'; end if;
  if exists (select 1 from public.push_devices where token = pg_temp.tok('b')) then raise 'jeton mort gardé'; end if;
  -- Prise plantée : reprise après 5 minutes, 5 essais au plus
  insert into private.push_outbox (recipient, kind, actor, ref, claimed_at, attempts) values
    (pg_temp.pu('a'), 'reaction', pg_temp.pu('c'), 'x1', now() - interval '6 minutes', 1),
    (pg_temp.pu('a'), 'reaction', pg_temp.pu('c'), 'x2', now() - interval '6 minutes', 5),
    (pg_temp.pu('a'), 'reaction', pg_temp.pu('c'), 'x3', now() - interval '1 minute', 1);
end $$;
set role service_role;
do $$
declare rows jsonb;
begin
  rows := public.push_claim(50);
  if jsonb_array_length(rows) <> 1 or rows -> 0 ->> 'ref' <> 'x1' then raise 'reprise : %', rows; end if;
end $$;
reset role;

-- Type éteint entre la mise en file et l'envoi : wanted faux ; tout éteint : la file en attente est vidée
do $$ begin
  update private.push_outbox set claimed_at = null, attempts = 1 where ref = 'x3';
  update public.push_prefs set reactions = false where user_id = pg_temp.pu('a');
end $$;
set role service_role;
do $$
declare rows jsonb;
begin
  rows := public.push_claim(50);
  if jsonb_array_length(rows) <> 1 or (rows -> 0 ->> 'wanted')::boolean is not false then raise 'type éteint : %', rows; end if;
end $$;
reset role;
do $$ begin
  update private.push_outbox set claimed_at = null where ref = 'x3';
  update public.push_prefs set reactions = true where user_id = pg_temp.pu('a');
end $$;
set role authenticated;
do $$ begin
  perform pg_temp.plogin('a');
  perform public.push_set_prefs(false, false, false);
end $$;
reset role;
do $$ begin
  if exists (select 1 from private.push_outbox where recipient = pg_temp.pu('a') and sent_at is null) then raise 'file gardée après tout éteint'; end if;
end $$;

-- ── Une notification ne fait jamais échouer l'action ─────
do $$ begin
  update public.push_prefs set reactions = true where user_id = pg_temp.pu('a');
  -- File cassée (table renommée) : le bravo passe quand même
  alter table private.push_outbox rename to push_outbox_hors_service;
  insert into public.bravos (session_owner, session_id, user_id) values (pg_temp.pu('a'), 'pa-2', pg_temp.pu('c'));
  alter table private.push_outbox_hors_service rename to push_outbox;
end $$;

-- ── Jeton du fournisseur APNs : une ligne, remplacée seulement si elle porte encore le jeton lu ──
set role service_role;
do $$
declare r jsonb;
begin
  if public.push_auth_get() is not null then raise 'jeton du fournisseur avant le premier envoi'; end if;
  r := public.push_auth_swap(null, 'faux.jwt.1', 1000, 'FAKEKEY123');
  if r ->> 'token' <> 'faux.jwt.1' or (r ->> 'iat')::bigint <> 1000 or r ->> 'key_id' <> 'FAKEKEY123' then raise 'première pose : %', r; end if;
  -- Seconde instance qui avait lu « rien » : la première gagne
  r := public.push_auth_swap(null, 'faux.jwt.2', 1001, 'FAKEKEY123');
  if r ->> 'token' <> 'faux.jwt.1' then raise 'pose concurrente gagnante : %', r; end if;
  -- Renouvellement attendu par deux instances : une seule remplace, l'autre reçoit son jeton
  r := public.push_auth_swap('faux.jwt.1', 'faux.jwt.3', 3400, 'FAKEKEY123');
  if r ->> 'token' <> 'faux.jwt.3' then raise 'renouvellement : %', r; end if;
  r := public.push_auth_swap('faux.jwt.1', 'faux.jwt.4', 3401, 'FAKEKEY123');
  if r ->> 'token' <> 'faux.jwt.3' then raise 'renouvellement concurrent gagnant : %', r; end if;
  if pg_temp.perr($q$ select public.push_auth_swap('faux.jwt.3', '', 1, 'K') $q$) = 'ok' then raise 'jeton vide accepté'; end if;
  if pg_temp.perr($q$ select * from private.push_apns_auth $q$) not like 'permission denied%' then raise 'service_role lit la table directement'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from private.push_apns_auth) <> 1 then raise 'plus d''une ligne'; end if;
end $$;

-- ── Suppression du compte : tout part avec lui ───────────
do $$ begin
  delete from auth.users where id = pg_temp.pu('a');
  if exists (select 1 from public.push_devices where user_id = pg_temp.pu('a')) then raise 'jetons gardés'; end if;
  if exists (select 1 from public.push_prefs where user_id = pg_temp.pu('a')) then raise 'réglages gardés'; end if;
  if exists (select 1 from private.push_outbox where recipient = pg_temp.pu('a')) then raise 'file gardée'; end if;
  delete from auth.users where id in (pg_temp.pu('b'), pg_temp.pu('c'), pg_temp.pu('d'), pg_temp.pu('e'));
end $$;
