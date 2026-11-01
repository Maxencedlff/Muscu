-- Vérifications de supabase/migrations/20261031910000_notifications_messages.sql (lancées par tests/sql/run.sh) :
-- réglages (défaut éteint, 3 et 5 arguments), commentaire et message mis en file sans leur texte,
-- anti-rafale (salve, lu entre-temps, ancienne notification qui ne compte plus), blocage, masquage,
-- signalement, lien rompu, lecture avant l'envoi, écran à ouvrir rendu par push_claim, déclencheur qui ne
-- fait jamais échouer l'envoi. Chaque bloc échoue (raise) si la règle n'est pas tenue. Comptes à part
-- (…0000000009bx, pseudos n…) ; jetons faux et évidents (répétitions de « 1 », « 2 »).
--
-- O nono.n publie et est l'élève de K nkev.n (coach) ; P npia.n et Q nqui.n sont ses abonnés acceptés.

create function pg_temp.err(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.u(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000009b' || translate(c, 'opqk', '1234'))::uuid $$;
create function pg_temp.login(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.u(c)::text, ''), false) $$;
create function pg_temp.n(k text, who text) returns int language sql as
$$ select count(*)::int from private.push_outbox where kind = k and recipient = pg_temp.u(who) $$;
grant execute on function pg_temp.err(text), pg_temp.u(text), pg_temp.login(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.u(c) from unnest(array['o', 'p', 'q', 'k']) c;
insert into public.user_profiles (user_id, username, avatar_emoji, social_at, coach_at) values
  (pg_temp.u('o'), 'nono.n', '🦁', now(), null), (pg_temp.u('p'), 'npia.n', '🦊', now(), null),
  (pg_temp.u('q'), 'nqui.n', '🦅', now(), null), (pg_temp.u('k'), 'nkev.n', '⭐', null, now());
insert into public.sessions (user_id, id, data) values
  (pg_temp.u('o'), 'o-1', '{"date": 1780000000000}'), (pg_temp.u('o'), 'o-2', '{"date": 1780000100000}');
insert into public.follows (follower_id, followee_id, status, responded_at) values
  (pg_temp.u('p'), pg_temp.u('o'), 'accepted', now()), (pg_temp.u('q'), pg_temp.u('o'), 'accepted', now());
insert into public.coach_links (student_id, coach_id) values (pg_temp.u('o'), pg_temp.u('k'));
insert into public.push_devices (token, user_id, env) values
  (repeat('1', 64), pg_temp.u('o'), 'production'), (repeat('2', 64), pg_temp.u('k'), 'production');

-- ── Réglages : éteints par défaut ; l'ancienne écriture (3 types) ne touche pas aux nouveaux ──
set role authenticated;
do $$
declare p jsonb;
begin
  perform pg_temp.login('o');
  p := public.push_prefs();
  if p ->> 'comments' <> 'false' or p ->> 'messages' <> 'false' then raise 'défaut : %', p; end if;
  p := public.push_set_prefs(reactions => true, follows => null, coach => null);
  if p ->> 'reactions' <> 'true' or p ->> 'comments' <> 'false' or p ->> 'messages' <> 'false' then raise 'ancienne écriture : %', p; end if;
  p := public.push_set_prefs(reactions => null, follows => null, coach => null, comments => true, messages => null);
  if p ->> 'reactions' <> 'true' or p ->> 'comments' <> 'true' or p ->> 'messages' <> 'false' then raise '5 types : %', p; end if;
  p := public.push_set_prefs(reactions => false, follows => null, coach => null);
  if p ->> 'comments' <> 'true' then raise 'l''ancienne écriture a éteint les commentaires : %', p; end if;
  perform pg_temp.login(null);
  if pg_temp.err($q$ select public.push_set_prefs(true, true, true, true, true) $q$) is distinct from 'not_signed_in' then raise 'réglage sans compte'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  if pg_temp.err($q$ select public.push_set_prefs(true, true, true, true, true) $q$) not like 'permission denied%' then raise 'anon écrit des réglages'; end if;
end $$;
reset role;
set role authenticated;
do $$ begin
  perform pg_temp.login('o');
  if pg_temp.err($q$ select private.push_valid('comment', auth.uid(), auth.uid(), '1') $q$) not like 'permission denied%' then raise 'push_valid ouvert à l''API'; end if;
  if pg_temp.err($q$ select private.push_open_ref('comment', '1') $q$) not like 'permission denied%' then raise 'push_open_ref ouvert à l''API'; end if;
end $$;
reset role;

-- ── Commentaire sur ma séance ────────────────────────────
set role authenticated;
do $$
declare c jsonb;
begin
  perform pg_temp.login('p');
  c := public.add_comment(pg_temp.u('o'), 'o-1', 'Texte privé du commentaire');
  perform set_config('pmt.c1', c ->> 'id', false);
end $$;
reset role;
do $$ begin
  if pg_temp.n('comment', 'o') <> 1 then raise 'commentaire non mis en file'; end if;
  if (select ref from private.push_outbox where kind = 'comment') <> current_setting('pmt.c1') then raise 'ref : id du commentaire attendu'; end if;
  if exists (select 1 from private.push_outbox where ref like '%privé%') then raise 'texte du commentaire dans la file'; end if;
  -- Salve : deux autres commentaires de P (même séance puis une autre) : toujours une seule notification
  insert into public.session_comments (session_owner, session_id, author_id, body) values
    (pg_temp.u('o'), 'o-1', pg_temp.u('p'), 'encore'), (pg_temp.u('o'), 'o-2', pg_temp.u('p'), 'et là');
  if pg_temp.n('comment', 'o') <> 1 then raise 'salve : % notifications', pg_temp.n('comment', 'o'); end if;
  -- Une autre personne : sa propre notification
  insert into public.session_comments (session_owner, session_id, author_id, body) values (pg_temp.u('o'), 'o-1', pg_temp.u('q'), 'top');
  if pg_temp.n('comment', 'o') <> 2 then raise 'commentaire de Q oublié'; end if;
  -- Le propriétaire qui répond sur sa séance : rien pour lui
  insert into public.session_comments (session_owner, session_id, author_id, body) values (pg_temp.u('o'), 'o-1', pg_temp.u('o'), 'merci');
  if pg_temp.n('comment', 'o') <> 2 then raise 'notifié de son propre commentaire'; end if;
  -- Le commentaire notifié est masqué (3 signalements) : sa notification ne compte plus, le suivant de P sonne
  update public.session_comments set masked_at = now() where id = current_setting('pmt.c1')::bigint;
  insert into public.session_comments (session_owner, session_id, author_id, body) values (pg_temp.u('o'), 'o-2', pg_temp.u('p'), 'nouveau');
  if pg_temp.n('comment', 'o') <> 3 then raise 'notification d''avant masquée : le nouveau commentaire doit sonner'; end if;
  -- Bloqué : rien
  insert into public.blocks (blocker_id, blocked_id) values (pg_temp.u('o'), pg_temp.u('q'));
  delete from private.push_outbox where actor = pg_temp.u('q');
  insert into public.session_comments (session_owner, session_id, author_id, body) values (pg_temp.u('o'), 'o-2', pg_temp.u('q'), 'bloqué');
  if exists (select 1 from private.push_outbox where actor = pg_temp.u('q')) then raise 'commentaire d''un compte bloqué notifié'; end if;
  delete from public.blocks;
  delete from public.session_comments where author_id = pg_temp.u('q');
end $$;

-- ── Message du chat ──────────────────────────────────────
set role authenticated;
do $$
declare m jsonb;
begin
  perform pg_temp.login('o');
  perform public.push_set_prefs(null, null, null, null, true);
  perform pg_temp.login('k');
  m := public.chat_send('Message privé du coach', pg_temp.u('o'));
  perform set_config('pmt.m1', m ->> 'id', false);
  perform public.chat_send('deuxième', pg_temp.u('o'));
  perform public.chat_send('troisième', pg_temp.u('o'));
end $$;
reset role;
do $$ begin
  if pg_temp.n('chat_message', 'o') <> 1 then raise 'salve du coach : % notifications', pg_temp.n('chat_message', 'o'); end if;
  if (select ref from private.push_outbox where kind = 'chat_message') <> current_setting('pmt.m1') then raise 'ref : id du message attendu'; end if;
  if exists (select 1 from private.push_outbox where ref like '%privé%') then raise 'texte du message dans la file'; end if;
  -- K n'a pas allumé « messages » : la réponse de O ne le notifie pas
  if pg_temp.n('chat_message', 'k') <> 0 then raise 'coach notifié sans accord'; end if;
end $$;
set role authenticated;
do $$ begin
  perform pg_temp.login('k');
  perform public.push_set_prefs(null, null, null, null, true);
  perform pg_temp.login('o');
  perform public.chat_send('réponse');
  perform public.chat_mark_read();   -- O a lu : le prochain message du coach sonne de nouveau
  perform pg_temp.login('k');
  perform public.chat_send('quatrième', pg_temp.u('o'));
end $$;
reset role;
do $$ begin
  if pg_temp.n('chat_message', 'k') <> 1 then raise 'message de l''élève au coach oublié'; end if;
  if pg_temp.n('chat_message', 'o') <> 2 then raise 'lu entre-temps : le message suivant doit sonner (%)', pg_temp.n('chat_message', 'o'); end if;
end $$;

-- ── Envoi : écran à ouvrir, pseudo, relecture de la validité ──
set role service_role;
do $$
declare rows jsonb; r jsonb;
begin
  rows := public.push_claim(50);
  for r in select * from jsonb_array_elements(rows) loop
    if r ->> 'kind' = 'comment' then
      if (r ->> 'wanted')::boolean is distinct from (r ->> 'ref' <> '') then raise 'commentaire : wanted et ref %', r; end if;
      if r ->> 'wanted' = 'true' and (r ->> 'ref' <> 'o-2' or r ->> 'actor_name' <> 'npia.n') then raise 'commentaire : séance à ouvrir %', r; end if;
    elsif r ->> 'kind' = 'chat_message' then
      if r ->> 'ref' <> (case when r ->> 'wanted' = 'true' then pg_temp.u('o')::text else '' end) then raise 'message : élève de la conversation attendu %', r; end if;
      if r ->> 'token' = repeat('1', 64) and r ->> 'actor_name' <> 'nkev.n' then raise 'message : pseudo %', r; end if;
    end if;
    if r ? 'body' or r::text like '%privé%' or r::text like '%quatrième%' then raise 'texte dans la ligne d''envoi %', r; end if;
  end loop;
  -- Le premier message (lu depuis) et le commentaire masqué : plus voulus ; les autres oui
  if (select count(*) from jsonb_array_elements(rows) x where x ->> 'wanted' = 'true') <> 3 then raise 'voulues : %', rows; end if;
  if (select count(*) from jsonb_array_elements(rows) x where x ->> 'wanted' = 'false') <> 2 then raise 'écartées : %', rows; end if;
  perform public.push_done(array(select (x ->> 'id')::bigint from jsonb_array_elements(rows) x), '{}');
end $$;
reset role;

-- Modération et blocage entre la mise en file et l'envoi ; lien rompu ; message lu avant l'envoi
do $$ begin
  delete from private.push_outbox where recipient in (pg_temp.u('o'), pg_temp.u('k'));
  -- Conversation signalée par O : plus de notification de ce coach
  insert into public.chat_reports (reporter_id, target_user, student_id, coach_id, reason, messages)
    values (pg_temp.u('o'), pg_temp.u('k'), pg_temp.u('o'), pg_temp.u('k'), 'spam', '[]');
  insert into public.coach_messages (student_id, coach_id, from_coach, body) values (pg_temp.u('o'), pg_temp.u('k'), true, 'après signalement');
  if pg_temp.n('chat_message', 'o') <> 0 then raise 'conversation signalée : encore notifiée'; end if;
  delete from public.chat_reports where reporter_id = pg_temp.u('o');
  -- Bloqué : le chat continue, sans notification
  insert into public.blocks (blocker_id, blocked_id) values (pg_temp.u('k'), pg_temp.u('o'));
  insert into public.coach_messages (student_id, coach_id, from_coach, body) values (pg_temp.u('o'), pg_temp.u('k'), true, 'bloqué');
  if pg_temp.n('chat_message', 'o') <> 0 then raise 'message entre comptes bloqués notifié'; end if;
  delete from public.blocks;
  -- Mis en file, puis : lu (O ouvre la conversation)
  update public.coach_links set chat_student_read = (select max(id) from public.coach_messages) where student_id = pg_temp.u('o');
  insert into public.coach_messages (student_id, coach_id, from_coach, body) values (pg_temp.u('o'), pg_temp.u('k'), true, 'à lire');
  if pg_temp.n('chat_message', 'o') <> 1 then raise 'message non mis en file'; end if;
  update public.coach_links set chat_student_read = (select max(id) from public.coach_messages) where student_id = pg_temp.u('o');
  -- Commentaire mis en file, puis l'auteur est bloqué
  insert into public.session_comments (session_owner, session_id, author_id, body) values (pg_temp.u('o'), 'o-1', pg_temp.u('q'), 'puis bloqué');
  if pg_temp.n('comment', 'o') <> 1 then raise 'commentaire de Q non mis en file'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (pg_temp.u('q'), pg_temp.u('o'));
end $$;
set role service_role;
do $$
declare rows jsonb;
begin
  rows := public.push_claim(50);
  if jsonb_array_length(rows) <> 2 or exists (select 1 from jsonb_array_elements(rows) r where r ->> 'wanted' <> 'false' or r ->> 'ref' <> '') then
    raise 'lu ou bloqué avant l''envoi : %', rows;
  end if;
  perform public.push_done(array(select (x ->> 'id')::bigint from jsonb_array_elements(rows) x), '{}');
end $$;
reset role;
do $$ begin
  delete from public.blocks;
  delete from private.push_outbox where recipient = pg_temp.u('o');
  -- Lien rompu (l'élève quitte son coach) : messages effacés, la notification en file ne compte plus
  insert into public.coach_messages (student_id, coach_id, from_coach, body) values (pg_temp.u('o'), pg_temp.u('k'), true, 'avant départ');
  if pg_temp.n('chat_message', 'o') <> 1 then raise 'message avant départ non mis en file'; end if;
  delete from public.coach_links where student_id = pg_temp.u('o');
  if private.push_valid('chat_message', pg_temp.u('o'), pg_temp.u('k'), (select ref from private.push_outbox where recipient = pg_temp.u('o'))) then
    raise 'lien rompu : la notification compte encore';
  end if;
  insert into public.coach_links (student_id, coach_id) values (pg_temp.u('o'), pg_temp.u('k'));
  -- ref inattendu : jamais valide, jamais d'erreur
  if private.push_valid('comment', pg_temp.u('o'), pg_temp.u('p'), 'x;drop') or private.push_valid('chat_message', pg_temp.u('o'), pg_temp.u('k'), '') then raise 'ref invalide accepté'; end if;
  if private.push_open_ref('comment', '99999999') <> '' then raise 'commentaire inconnu : écran'; end if;
end $$;

-- ── Type éteint : la file en attente est vidée ───────────
set role authenticated;
do $$ begin
  perform pg_temp.login('o');
  perform public.push_set_prefs(null, null, null, null, false);
end $$;
reset role;
do $$ begin
  if pg_temp.n('chat_message', 'o') <> 0 then raise 'messages éteints : file gardée'; end if;
end $$;

-- ── Une notification ne fait jamais échouer l'envoi ──────
set role authenticated;
do $$ begin
  perform pg_temp.login('o');
  perform public.push_set_prefs(null, null, null, true, true);
end $$;
reset role;
alter table private.push_outbox rename to push_outbox_hors_service;
set role authenticated;
do $$ begin
  perform pg_temp.login('k');
  perform public.chat_send('passe quand même', pg_temp.u('o'));
  perform pg_temp.login('p');
  perform public.add_comment(pg_temp.u('o'), 'o-1', 'passe aussi');
end $$;
reset role;
alter table private.push_outbox_hors_service rename to push_outbox;

-- ── Ménage : comptes supprimés, tout part avec eux ───────
do $$ begin
  delete from auth.users where id in (pg_temp.u('o'), pg_temp.u('p'), pg_temp.u('q'), pg_temp.u('k'));
  if exists (select 1 from private.push_outbox where recipient in (pg_temp.u('o'), pg_temp.u('k'))) then raise 'file gardée'; end if;
end $$;
