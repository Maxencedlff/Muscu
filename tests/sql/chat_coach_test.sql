-- Vérifications de supabase/migrations/20261031510000_chat_coach.sql (lancées par tests/sql/run.sh) :
-- qui lit et écrit, non-lus (écrire ne vaut pas lecture, marque jusqu'au dernier message reçu),
-- pagination, lien rompu, rôle retiré, compte à la fois coach et élève, signalement (copie gardée
-- après le départ de l'élève et le retrait par le coach), limites, droits. Chaque bloc échoue (raise) si la règle n'est pas tenue. Comptes à part
-- (…00000000091x, pseudos m…) : indépendant des autres fichiers.
--
-- K mkev.m et L mlau.m sont coachs ; S msam.m et T mteo.m sont élèves de K ; W mwil.m est élève de L ;
-- U mugo.m n'est ni l'un ni l'autre ; V mvic.m (élève de L) sert aux limites.

create function pg_temp.err(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.u(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000091' || translate(c, 'klstuvw', 'abcdef0'))::uuid $$;
create function pg_temp.login(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.u(c)::text, false) $$;
grant execute on function pg_temp.err(text), pg_temp.u(text), pg_temp.login(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.u(c) from unnest(array['k', 'l', 's', 't', 'u', 'v', 'w']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.u('k'), 'mkev.m', '🦁'), (pg_temp.u('l'), 'mlau.m', '🦊'), (pg_temp.u('s'), 'msam.m', '🦅'),
  (pg_temp.u('t'), 'mteo.m', '🐼'), (pg_temp.u('u'), 'mugo.m', '⭐'), (pg_temp.u('v'), 'mvic.m', '🦉'),
  (pg_temp.u('w'), 'mwil.m', '🌊');
update public.user_profiles set coach_at = now() where user_id in (pg_temp.u('k'), pg_temp.u('l'));

set role authenticated;
do $$
declare ck text; cl text;
begin
  perform pg_temp.login('k'); ck := public.coach_create_invite();
  perform pg_temp.login('l'); cl := public.coach_create_invite();
  perform pg_temp.login('s'); perform public.coach_join(ck);
  perform pg_temp.login('t'); perform public.coach_join(ck);
  perform pg_temp.login('w'); perform public.coach_join(cl);
  perform pg_temp.login('v'); perform public.coach_join(cl);
end $$;

-- ── Qui lit, qui écrit ───────────────────────────────────
do $$
declare j jsonb; r record;
begin
  perform pg_temp.login('s');
  j := public.chat_send('  Salut coach  ');
  if j ->> 'body' <> 'Salut coach' or (j ->> 'mine')::boolean is not true or j -> 'id' is null or j -> 'at' is null then raise 'envoi : %', j; end if;
  perform pg_temp.login('k');
  select * into r from public.chat_messages(student => pg_temp.u('s'));
  if r.body <> 'Salut coach' or r.mine then raise 'coach lit : %', r; end if;
  perform public.chat_send('Bien reçu', pg_temp.u('s'));
  -- L'élève voit les deux, du plus récent au plus ancien
  perform pg_temp.login('s');
  if (select array_agg(body order by id desc) from public.chat_messages()) is distinct from array['Bien reçu', 'Salut coach'] then raise 'élève lit'; end if;
  if (select array_agg(mine order by id desc) from public.chat_messages()) is distinct from array[false, true] then raise 'mine'; end if;
  -- Un autre élève du même coach : sa conversation à lui, vide ; jamais celle de S
  perform pg_temp.login('t');
  if exists (select 1 from public.chat_messages()) then raise 'T voit S'; end if;
  if pg_temp.err($q$ select * from public.chat_messages(student => pg_temp.u('s')) $q$) is distinct from 'not_found' then raise 'T lit S'; end if;
  if pg_temp.err($q$ select public.chat_send('coucou', pg_temp.u('s')) $q$) is distinct from 'not_found' then raise 'T écrit à S'; end if;
  -- Un autre coach, quelqu'un sans coach, un élève qui se désigne lui-même : not_found
  perform pg_temp.login('l');
  if pg_temp.err($q$ select * from public.chat_messages(student => pg_temp.u('s')) $q$) is distinct from 'not_found' then raise 'L lit S'; end if;
  if pg_temp.err($q$ select public.chat_send('yo', pg_temp.u('s')) $q$) is distinct from 'not_found' then raise 'L écrit à S'; end if;
  perform pg_temp.login('u');
  if pg_temp.err($q$ select * from public.chat_messages() $q$) is distinct from 'not_found' then raise 'U sans coach'; end if;
  if pg_temp.err($q$ select public.chat_send('yo') $q$) is distinct from 'not_found' then raise 'U écrit'; end if;
  if pg_temp.err($q$ select public.chat_mark_read() $q$) is distinct from 'not_found' then raise 'U marque'; end if;
  perform pg_temp.login('s');
  if pg_temp.err($q$ select * from public.chat_messages(student => pg_temp.u('s')) $q$) is distinct from 'not_found' then raise 'S comme coach'; end if;
  -- Texte : nettoyé, 2000 caractères au plus, vide refusé
  if pg_temp.err($q$ select public.chat_send(repeat('é', 2000)) $q$) <> 'ok' then raise '2000 refusés'; end if;
  if pg_temp.err($q$ select public.chat_send(repeat('a', 2001)) $q$) is distinct from 'too_long' then raise '2001'; end if;
  if pg_temp.err($q$ select public.chat_send(E' \n\t ') $q$) is distinct from 'empty_message' then raise 'vide'; end if;
  if pg_temp.err($q$ select public.chat_send(null) $q$) is distinct from 'empty_message' then raise 'null'; end if;
  if public.chat_send(E'a\r\n\n\n\nb') ->> 'body' <> E'a\n\nb' then raise 'nettoyage'; end if;
end $$;

-- ── Non-lus ──────────────────────────────────────────────
do $$
declare st jsonb; th jsonb;
begin
  -- S a écrit après la réponse de K sans marquer la conversation lue : « Bien reçu » reste non lu
  -- (écrire ne vaut pas lecture : l'app ne l'a peut-être pas affiché) ; ses propres messages ne comptent jamais
  perform pg_temp.login('s');
  st := public.chat_threads();
  if (st -> 'coach' ->> 'unread')::int <> 1 or (st ->> 'unread')::int <> 1 or st -> 'students' <> '[]'::jsonb then raise 'S : %', st; end if;
  if (st -> 'coach' -> 'last' ->> 'mine')::boolean is not true or st -> 'coach' -> 'last' ->> 'body' <> E'a\n\nb' then raise 'dernier : %', st -> 'coach' -> 'last'; end if;
  perform public.chat_mark_read();
  if (public.chat_threads() ->> 'unread')::int <> 0 then raise 'S : marquée lue'; end if;
  -- K : 3 messages de S jamais marqués lus (« Salut coach », lu par chat_messages mais pas marqué ; le
  -- 2000 « é » et « a b », après sa réponse) ; T : rien
  perform pg_temp.login('k');
  st := public.chat_threads();
  select e into th from jsonb_array_elements(st -> 'students') e where e ->> 'student_id' = pg_temp.u('s')::text;
  if (th ->> 'unread')::int <> 3 or (st ->> 'unread')::int <> 3 or st -> 'coach' <> 'null'::jsonb then raise 'K : %', st; end if;
  if char_length(th -> 'last' ->> 'body') > 120 then raise 'aperçu non coupé'; end if;
  select e into th from jsonb_array_elements(st -> 'students') e where e ->> 'student_id' = pg_temp.u('t')::text;
  if (th ->> 'unread')::int <> 0 or th -> 'last' <> 'null'::jsonb then raise 'T vide : %', th; end if;
  -- Répondre ne vaut pas lecture : les 3 messages de S restent non lus jusqu'à la marque
  perform public.chat_send('Top', pg_temp.u('s'));
  if (public.chat_threads() ->> 'unread')::int <> 3 then raise 'K a répondu : non-lus perdus'; end if;
  perform public.chat_mark_read(pg_temp.u('s'));
  if (public.chat_threads() ->> 'unread')::int <> 0 then raise 'K : marquée lue'; end if;
  perform pg_temp.login('s');
  if (public.chat_threads() ->> 'unread')::int <> 1 then raise 'S : réponse non lue'; end if;
  perform public.chat_mark_read();
end $$;

-- ── Marque jusqu'au dernier message reçu par l'app (up_to) ──
do $$
declare seen bigint; late bigint;
begin
  -- L'app de S a lu la conversation jusqu'à seen ; K écrit juste après, avant la marque
  perform pg_temp.login('k');
  perform public.chat_send('Premier', pg_temp.u('s'));
  perform pg_temp.login('s');
  seen := (select max(id) from public.chat_messages());
  perform pg_temp.login('k');
  late := (public.chat_send('Arrivé pendant la lecture', pg_temp.u('s')) ->> 'id')::bigint;
  -- S répond (sans voir le dernier) puis marque jusqu'à ce qu'elle a reçu : le dernier reste non lu
  perform pg_temp.login('s');
  perform public.chat_send('Ok');
  perform public.chat_mark_read(up_to => seen);
  if (public.chat_threads() -> 'coach' ->> 'unread')::int <> 1 then raise 'up_to : message pas encore affiché compté lu'; end if;
  -- Une marque plus ancienne ne recule pas
  perform public.chat_mark_read(up_to => 0);
  if (public.chat_threads() -> 'coach' ->> 'unread')::int <> 1 then raise 'up_to : la marque a reculé'; end if;
  -- Relu ensuite : marqué
  if not exists (select 1 from public.chat_messages(after_id => seen) where id = late) then raise 'relecture after_id'; end if;
  perform public.chat_mark_read(up_to => late);
  if (public.chat_threads() -> 'coach' ->> 'unread')::int <> 0 then raise 'up_to : marqué'; end if;
end $$;

-- ── Pagination ───────────────────────────────────────────
reset role;
insert into public.coach_messages (student_id, coach_id, from_coach, body)
  select '00000000-0000-0000-0000-00000000091d', '00000000-0000-0000-0000-00000000091a', i % 2 = 0, 'm' || i from generate_series(1, 120) i;
set role authenticated;
do $$
declare first_ids bigint[]; older bigint[]; newer bigint[]; mid bigint;
begin
  perform pg_temp.login('t');
  select array_agg(id order by id desc) into first_ids from public.chat_messages();
  if array_length(first_ids, 1) <> 50 or first_ids[1] < first_ids[50] then raise 'page 1'; end if;
  select array_agg(id order by id desc) into older from public.chat_messages(before_id => first_ids[50]);
  if array_length(older, 1) <> 50 or older[1] >= first_ids[50] then raise 'page 2'; end if;
  if (select count(*) from public.chat_messages(before_id => older[50])) <> 20 then raise 'page 3'; end if;
  -- after_id : les plus récents d'abord manquants, du plus ancien au plus récent
  mid := first_ids[10];
  select array_agg(id) into newer from public.chat_messages(after_id => mid);
  if array_length(newer, 1) <> 9 or newer[1] > newer[9] or newer[9] <> first_ids[1] then raise 'after_id : %', newer; end if;
  if exists (select 1 from public.chat_messages(after_id => first_ids[1])) then raise 'after_id : rien de neuf'; end if;
end $$;

-- ── Coach et élève à la fois : deux conversations séparées ──
do $$
declare ck text;
begin
  perform pg_temp.login('k'); ck := public.coach_create_invite();
  perform pg_temp.login('l'); perform public.coach_join(ck);
  perform public.chat_send('Pour mon coach');
  perform public.chat_send('Pour mon élève', pg_temp.u('w'));
  perform pg_temp.login('k');
  if (select array_agg(body) from public.chat_messages(student => pg_temp.u('l'))) is distinct from array['Pour mon coach'] then raise 'K'; end if;
  perform pg_temp.login('w');
  if (select array_agg(body) from public.chat_messages()) is distinct from array['Pour mon élève'] then raise 'W'; end if;
  perform pg_temp.login('l');
  if (public.chat_threads() -> 'coach' -> 'last' ->> 'body') <> 'Pour mon coach' then raise 'L : coach'; end if;
  if (select e -> 'last' ->> 'body' from jsonb_array_elements(public.chat_threads() -> 'students') e
      where e ->> 'student_id' = pg_temp.u('w')::text) <> 'Pour mon élève' then raise 'L : élève'; end if;
end $$;

-- ── Rôle retiré : conversation fermée des deux côtés ─────
reset role;
update public.user_profiles set coach_at = null where user_id = '00000000-0000-0000-0000-00000000091a';
set role authenticated;
do $$ begin
  perform pg_temp.login('s');
  if pg_temp.err($q$ select public.chat_send('encore là ?') $q$) is distinct from 'not_found' then raise 'S écrit'; end if;
  if pg_temp.err($q$ select * from public.chat_messages() $q$) is distinct from 'not_found' then raise 'S lit'; end if;
  if public.chat_threads() -> 'coach' <> 'null'::jsonb then raise 'S : fil'; end if;
  perform pg_temp.login('k');
  if pg_temp.err($q$ select * from public.chat_messages(student => pg_temp.u('s')) $q$) is distinct from 'not_found' then raise 'K lit'; end if;
  if public.chat_threads() -> 'students' <> '[]'::jsonb then raise 'K : fil'; end if;
end $$;
reset role;
update public.user_profiles set coach_at = now() where user_id = '00000000-0000-0000-0000-00000000091a';

-- ── Signaler : copie des messages, gardée après la rupture du lien ──
set role authenticated;
do $$
declare rid bigint;
begin
  -- Motif inconnu, conversation qui n'est pas la mienne : refusés
  perform pg_temp.login('s');
  if pg_temp.err($q$ select public.report_chat('insulte') $q$) is distinct from 'invalid_reason' then raise 'motif inconnu'; end if;
  if pg_temp.err($q$ select public.report_chat(null) $q$) is distinct from 'invalid_reason' then raise 'motif nul'; end if;
  if pg_temp.err($q$ select public.report_chat('spam', pg_temp.u('t')) $q$) is distinct from 'not_found' then raise 'S signale T'; end if;
  perform pg_temp.login('l');
  if pg_temp.err($q$ select public.report_chat('spam', pg_temp.u('s')) $q$) is distinct from 'not_found' then raise 'autre coach'; end if;
  perform pg_temp.login('u');
  if pg_temp.err($q$ select public.report_chat('spam') $q$) is distinct from 'not_found' then raise 'sans coach'; end if;
  -- L'élève S signale son coach K ; le coach K signale son élève T
  perform pg_temp.login('s');
  rid := public.report_chat('harcelement');
  if rid is null then raise 'S : id de public.reports attendu'; end if;
  perform pg_temp.login('t');
  perform public.chat_send('Message de T');
  perform pg_temp.login('k');
  perform public.report_chat('spam', pg_temp.u('t'));
end $$;
-- L'élève ne lit jamais la copie
do $$ begin
  perform pg_temp.login('s');
  if pg_temp.err('select * from public.chat_reports') not like 'permission denied%' then raise 'chat_reports lisible'; end if;
end $$;
reset role;
do $$
declare r record; msgs jsonb;
begin
  select * into r from public.reports x where x.reporter_id = pg_temp.u('s') and x.target_ref like 'chat_reports:%';
  if r.kind <> 'profile' or r.target_user <> pg_temp.u('k') or r.target_username <> 'mkev.m' or r.reason <> 'harcelement'
     or r.notified_at is not null or r.details not like '%chat_reports%' then raise 'file de modération : %', r; end if;
  select c.messages into msgs from public.chat_reports c where 'chat_reports:' || c.id = r.target_ref;
  if msgs is null or jsonb_array_length(msgs) <> (select count(*) from public.coach_messages m where m.student_id = pg_temp.u('s'))
     or jsonb_array_length(msgs) > 50 then raise 'copie : % messages', jsonb_array_length(msgs); end if;
  -- Du plus ancien au plus récent, avec le sens et la date
  if (msgs -> 0 ->> 'body') <> 'Salut coach' or (msgs -> 0 ->> 'from_coach')::boolean or msgs -> 0 -> 'at' is null
     or (msgs -> -1 ->> 'id')::bigint <> (select max(id) from public.coach_messages m where m.student_id = pg_temp.u('s')) then raise 'copie : ordre %', msgs -> 0; end if;
  if not exists (select 1 from public.chat_reports c join public.reports x on x.target_ref = 'chat_reports:' || c.id
                 where c.reporter_id = pg_temp.u('k') and c.target_user = pg_temp.u('t') and x.target_user = pg_temp.u('t')
                   and c.messages -> -1 ->> 'body' = 'Message de T') then raise 'coach signale son élève'; end if;
end $$;

-- ── Lien rompu : tout part en cascade ────────────────────
set role authenticated;
do $$
declare ck text;
begin
  perform pg_temp.login('s');
  perform public.coach_leave();
  if pg_temp.err($q$ select * from public.chat_messages() $q$) is distinct from 'not_found' then raise 'parti : lit'; end if;
  perform pg_temp.login('k'); ck := public.coach_create_invite();
  perform pg_temp.login('s'); perform public.coach_join(ck);
  if exists (select 1 from public.chat_messages()) then raise 'revenu : anciens messages'; end if;
  perform pg_temp.login('k');
  perform public.coach_remove_student(pg_temp.u('t'));
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.coach_messages where student_id in (pg_temp.u('s'), pg_temp.u('t'))) then raise 'cascade du lien'; end if;
  -- Les copies signalées restent : l'élève parti (S), l'élève retiré (T)
  if (select count(*) from public.chat_reports where student_id in (pg_temp.u('s'), pg_temp.u('t'))) <> 2
     or exists (select 1 from public.chat_reports where student_id in (pg_temp.u('s'), pg_temp.u('t')) and jsonb_array_length(messages) = 0)
    then raise 'preuve perdue avec le lien'; end if;
end $$;
-- 50 derniers messages au plus ; purge à 12 mois au signalement suivant
insert into public.coach_messages (student_id, coach_id, from_coach, body)
  select '00000000-0000-0000-0000-00000000091f', '00000000-0000-0000-0000-00000000091b', true, 'n' || i from generate_series(1, 60) i;
update public.chat_reports set created_at = now() - interval '13 months' where student_id = pg_temp.u('t');
set role authenticated;
do $$ begin
  perform pg_temp.login('v'); perform public.report_chat('autre');
end $$;
reset role;
do $$
declare msgs jsonb;
begin
  select messages into msgs from public.chat_reports where reporter_id = pg_temp.u('v');
  if jsonb_array_length(msgs) <> 50 or msgs -> -1 ->> 'body' <> 'n60' or msgs -> 0 ->> 'body' <> 'n11' then raise '50 derniers : %', jsonb_array_length(msgs); end if;
  if exists (select 1 from public.chat_reports where student_id = pg_temp.u('t')) then raise 'purge des 12 mois'; end if;
  delete from public.coach_messages where student_id = pg_temp.u('v');
end $$;

-- ── Limites ──────────────────────────────────────────────
set role authenticated;
do $$
declare i int;
begin
  perform pg_temp.login('v');
  for i in 1..60 loop perform public.chat_send('msg ' || i); end loop;
  if pg_temp.err($q$ select public.chat_send('61e') $q$) is distinct from 'rate_limited' then raise '61e par heure'; end if;
  for i in 1..900 loop perform public.chat_messages(); end loop;
  if pg_temp.err($q$ select * from public.chat_messages() $q$) is distinct from 'rate_limited' then raise 'lecture sans limite'; end if;
  for i in 1..600 loop perform public.chat_mark_read(); end loop;
  if pg_temp.err($q$ select public.chat_mark_read() $q$) is distinct from 'rate_limited' then raise 'marque sans limite'; end if;
  for i in 1..600 loop perform public.chat_threads(); end loop;
  if pg_temp.err($q$ select public.chat_threads() $q$) is distinct from 'rate_limited' then raise 'fils sans limite'; end if;
  -- Signalements : 10 par 24 h (public.reports, tous types confondus ; V en a déjà fait un) ; refusé : pas de copie
  for i in 1..9 loop perform public.report_chat('spam'); end loop;
  if pg_temp.err($q$ select public.report_chat('spam') $q$) is distinct from 'rate_limited' then raise '11e signalement'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.chat_reports where reporter_id = pg_temp.u('v')) <> 10 then raise 'copie gardée malgré la limite'; end if;
end $$;
set role authenticated;
do $$ begin perform null; end $$;
reset role;
delete from private.social_rate where user_id = '00000000-0000-0000-0000-00000000091f' and action = 'chat_h';
insert into private.social_rate (user_id, action, at)
  select '00000000-0000-0000-0000-00000000091f', 'chat', now() - interval '2 hours' from generate_series(1, 440);
set role authenticated;
do $$ begin
  perform pg_temp.login('v');
  if pg_temp.err($q$ select public.chat_send('501e') $q$) is distinct from 'rate_limited' then raise '501e par jour'; end if;
end $$;
reset role;

-- ── Tables fermées, anonyme sans rien ────────────────────
set role authenticated;
do $$ begin
  perform pg_temp.login('k');
  if pg_temp.err('select * from public.coach_messages') not like 'permission denied%' then raise 'coach_messages lisible'; end if;
  if pg_temp.err($q$ insert into public.coach_messages (student_id, coach_id, from_coach, body) values (pg_temp.u('s'), pg_temp.u('k'), true, 'x') $q$)
     not like 'permission denied%' then raise 'écriture directe'; end if;
  if pg_temp.err('update public.coach_links set chat_coach_read = 0') not like 'permission denied%' then raise 'marque écrite directement'; end if;
  if pg_temp.err('select * from public.chat_reports') not like 'permission denied%' then raise 'chat_reports lisible'; end if;
  if pg_temp.err($q$ insert into public.chat_reports (reporter_id, target_user, student_id, coach_id, reason, messages) values (pg_temp.u('k'), pg_temp.u('s'), pg_temp.u('s'), pg_temp.u('k'), 'spam', '[]') $q$)
     not like 'permission denied%' then raise 'chat_reports : écriture directe'; end if;
end $$;
reset role;
set role anon;
set request.jwt.claim.sub = '';
do $$
declare f text;
begin
  foreach f in array array['public.chat_send(''yo'')', '* from public.chat_messages()', 'public.chat_mark_read()', 'public.chat_threads()', 'public.report_chat(''spam'')'] loop
    if pg_temp.err('select ' || f) not like 'permission denied%' then raise 'anon : %', f; end if;
  end loop;
end $$;
reset role;

-- ── Droits déclarés ──────────────────────────────────────
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('chat_send', 'chat_messages', 'chat_mark_read', 'chat_threads', 'report_chat') loop
    if not has_function_privilege('authenticated', f, 'execute') then raise '% : authenticated sans droit', f; end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute') then raise '% : anon ou public a le droit', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('chat_send', 'chat_messages', 'chat_mark_read', 'chat_threads', 'report_chat')) <> 5 then raise 'fonctions manquantes ou en double'; end if;
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'private'::regnamespace and p.proname in ('chat_thread', 'chat_lock', 'chat_clean', 'chat_unread', 'chat_last', 'chat_report_before_insert') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute') then raise '% : exécutable depuis l''API', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.coach_messages', 'select') or has_table_privilege('anon', 'public.coach_messages', 'select')
     or has_table_privilege('service_role', 'public.coach_messages', 'select') then raise 'coach_messages : GRANT'; end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.coach_messages'::regclass) then raise 'coach_messages : RLS'; end if;
  if has_table_privilege('authenticated', 'public.chat_reports', 'select') or has_table_privilege('anon', 'public.chat_reports', 'select')
     or has_table_privilege('service_role', 'public.chat_reports', 'select') then raise 'chat_reports : GRANT'; end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.chat_reports'::regclass) then raise 'chat_reports : RLS'; end if;
end $$;

-- ── Compte supprimé : sa conversation part avec lui ; ses signalements aussi, pas ceux qui le visent ──
do $$ begin
  delete from auth.users where id = pg_temp.u('l');
  if exists (select 1 from public.coach_messages where coach_id = pg_temp.u('l') or student_id = pg_temp.u('l')) then raise 'cascade du compte'; end if;
  delete from auth.users where id = pg_temp.u('k');
  if not exists (select 1 from public.chat_reports where target_user = pg_temp.u('k')) then raise 'compte signalé supprimé : preuve perdue'; end if;
  delete from auth.users where id = pg_temp.u('s');
  if exists (select 1 from public.chat_reports where reporter_id = pg_temp.u('s')) then raise 'compte qui signale supprimé : copie gardée'; end if;
  delete from auth.users where id::text like '00000000-0000-0000-0000-00000000091_';
  delete from private.social_rate where user_id::text like '00000000-0000-0000-0000-00000000091_';
end $$;
