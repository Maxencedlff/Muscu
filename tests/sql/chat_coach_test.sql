-- Vérifications de supabase/migrations/20261031510000_chat_coach.sql (lancées par tests/sql/run.sh) :
-- qui lit et écrit, non-lus, pagination, lien rompu, rôle retiré, compte à la fois coach et élève,
-- limites, droits. Chaque bloc échoue (raise) si la règle n'est pas tenue. Comptes à part
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
  -- S a écrit après la réponse de K : écrire vaut lecture, rien de non lu ; ses propres messages ne comptent jamais
  perform pg_temp.login('s');
  st := public.chat_threads();
  if (st -> 'coach' ->> 'unread')::int <> 0 or (st ->> 'unread')::int <> 0 or st -> 'students' <> '[]'::jsonb then raise 'S : %', st; end if;
  if (st -> 'coach' -> 'last' ->> 'mine')::boolean is not true or st -> 'coach' -> 'last' ->> 'body' <> E'a\n\nb' then raise 'dernier : %', st -> 'coach' -> 'last'; end if;
  -- K : 2 messages de S après sa réponse (le 2000 « é » et « a b ») ; T : rien
  perform pg_temp.login('k');
  st := public.chat_threads();
  select e into th from jsonb_array_elements(st -> 'students') e where e ->> 'student_id' = pg_temp.u('s')::text;
  if (th ->> 'unread')::int <> 2 or (st ->> 'unread')::int <> 2 or st -> 'coach' <> 'null'::jsonb then raise 'K : %', st; end if;
  if char_length(th -> 'last' ->> 'body') > 120 then raise 'aperçu non coupé'; end if;
  select e into th from jsonb_array_elements(st -> 'students') e where e ->> 'student_id' = pg_temp.u('t')::text;
  if (th ->> 'unread')::int <> 0 or th -> 'last' <> 'null'::jsonb then raise 'T vide : %', th; end if;
  -- Répondre vaut lecture
  perform public.chat_send('Top', pg_temp.u('s'));
  if (public.chat_threads() ->> 'unread')::int <> 0 then raise 'K a répondu : encore non lu'; end if;
  perform pg_temp.login('s');
  if (public.chat_threads() ->> 'unread')::int <> 1 then raise 'S : réponse non lue'; end if;
  perform public.chat_mark_read();
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
end $$;
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
end $$;
reset role;
set role anon;
set request.jwt.claim.sub = '';
do $$
declare f text;
begin
  foreach f in array array['public.chat_send(''yo'')', '* from public.chat_messages()', 'public.chat_mark_read()', 'public.chat_threads()'] loop
    if pg_temp.err('select ' || f) not like 'permission denied%' then raise 'anon : %', f; end if;
  end loop;
end $$;
reset role;

-- ── Droits déclarés ──────────────────────────────────────
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('chat_send', 'chat_messages', 'chat_mark_read', 'chat_threads') loop
    if not has_function_privilege('authenticated', f, 'execute') then raise '% : authenticated sans droit', f; end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute') then raise '% : anon ou public a le droit', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('chat_send', 'chat_messages', 'chat_mark_read', 'chat_threads')) <> 4 then raise 'fonctions manquantes ou en double'; end if;
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'private'::regnamespace and p.proname in ('chat_thread', 'chat_lock', 'chat_clean', 'chat_unread', 'chat_last') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute') then raise '% : exécutable depuis l''API', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.coach_messages', 'select') or has_table_privilege('anon', 'public.coach_messages', 'select')
     or has_table_privilege('service_role', 'public.coach_messages', 'select') then raise 'coach_messages : GRANT'; end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.coach_messages'::regclass) then raise 'coach_messages : RLS'; end if;
end $$;

-- ── Compte supprimé : sa conversation part avec lui ──────
do $$ begin
  delete from auth.users where id = pg_temp.u('l');
  if exists (select 1 from public.coach_messages where coach_id = pg_temp.u('l') or student_id = pg_temp.u('l')) then raise 'cascade du compte'; end if;
  delete from auth.users where id::text like '00000000-0000-0000-0000-00000000091_';
  delete from private.social_rate where user_id::text like '00000000-0000-0000-0000-00000000091_';
end $$;
