-- Vérifications de 20261122010000_forme_coach.sql (accord « Ma coach »), lancées par tests/sql/run.sh. Comptes
-- simulés …00000000cfXX : A coach, E son élève, K élève de A qui l'a bloqué, O autre compte, N pas coach. Rien n'est
-- appliqué en production : Postgres local jetable.

create function pg_temp.ferr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.fu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000cf' || c)::uuid $$;
create function pg_temp.flogin(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, false) $$;
grant execute on function pg_temp.ferr(text), pg_temp.fu(text), pg_temp.flogin(uuid) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.fu(c) from unnest(array['a1', 'e1', 'c1', '01', '11']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.fu('a1'), 'forme.a1', '🦁'), (pg_temp.fu('e1'), 'forme.e1', '🦊'), (pg_temp.fu('c1'), 'forme.k1', '🦉'),
  (pg_temp.fu('01'), 'forme.o1', '⭐'), (pg_temp.fu('11'), 'forme.n1', '🐺');
update public.user_profiles set coach_at = now() where user_id = pg_temp.fu('a1');
insert into public.coach_links (coach_id, student_id) values (pg_temp.fu('a1'), pg_temp.fu('e1')), (pg_temp.fu('a1'), pg_temp.fu('c1'));
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.fu('c1'), pg_temp.fu('a1'));

-- ── Droits : aucune lecture ni écriture directe ; anon rien ; push_actor_forms à la clé serveur seulement ──
set role authenticated;
do $$
begin
  perform pg_temp.flogin(pg_temp.fu('a1'));
  if pg_temp.ferr($q$ select * from public.coach_forms $q$) not like 'permission denied%' then raise 'lecture directe'; end if;
  if pg_temp.ferr($q$ insert into public.coach_forms (user_id, form) values (auth.uid(), 'elle') $q$) not like 'permission denied%' then raise 'écriture directe'; end if;
  if pg_temp.ferr($q$ select public.push_actor_forms(array[1::bigint]) $q$) not like 'permission denied%' then raise 'push_actor_forms ouvert aux comptes'; end if;
end $$;
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.coach_form(uuid)', 'execute') then raise 'anon lit une forme'; end if;
  if has_function_privilege('anon', 'public.coach_set_form(text)', 'execute') then raise 'anon écrit une forme'; end if;
  if has_function_privilege('anon', 'public.push_actor_forms(bigint[])', 'execute') then raise 'anon lit la file'; end if;
  if not has_function_privilege('service_role', 'public.push_actor_forms(bigint[])', 'execute') then raise 'push-send sans accès'; end if;
end $$;

-- ── Écriture : coach seulement, liste fermée ──
set role authenticated;
do $$
begin
  perform pg_temp.flogin(pg_temp.fu('11'));
  if pg_temp.ferr($q$ select public.coach_set_form('elle') $q$) is distinct from 'not_coach' then raise 'non-coach accepté'; end if;
  perform pg_temp.flogin(pg_temp.fu('a1'));
  if pg_temp.ferr($q$ select public.coach_set_form('femme') $q$) is distinct from 'invalid_form' then raise 'forme inconnue acceptée'; end if;
  if pg_temp.ferr($q$ select public.coach_set_form(null) $q$) is distinct from 'invalid_form' then raise 'forme nulle acceptée'; end if;
  if public.coach_form(pg_temp.fu('a1')) ->> 'form' is not null then raise 'forme avant le choix'; end if;
  perform pg_temp.flogin(pg_temp.fu('e1'));
  if public.coach_form(pg_temp.fu('a1')) ->> 'form' is not null then raise 'élève : forme avant le choix'; end if;
  perform pg_temp.flogin(pg_temp.fu('a1'));
  if public.coach_set_form('il') ->> 'form' <> 'il' then raise 'il'; end if;
  if public.coach_set_form('elle') ->> 'form' <> 'elle' then raise 'elle (remplace il)'; end if;
  if public.coach_set_form('elle') ->> 'form' <> 'elle' then raise 'même forme refusée'; end if;
  if public.coach_form(pg_temp.fu('a1')) ->> 'form' <> 'elle' then raise 'coach : sa forme'; end if;
  perform pg_temp.flogin(pg_temp.fu('e1'));
  if public.coach_form(pg_temp.fu('a1')) ->> 'form' is distinct from 'elle' then raise 'élève : forme absente'; end if;
  perform pg_temp.flogin(pg_temp.fu('c1'));
  if public.coach_form(pg_temp.fu('a1')) ->> 'form' is not null then raise 'blocage : forme montrée'; end if;
  perform pg_temp.flogin(pg_temp.fu('01'));
  if public.coach_form(pg_temp.fu('a1')) ->> 'form' is not null then raise 'autre compte : forme montrée'; end if;
  if public.coach_form(null) ->> 'form' is not null then raise 'coach nul'; end if;
end $$;
reset role;
do $$ begin if (select count(*) from public.coach_forms where user_id = pg_temp.fu('a1')) <> 1 then raise 'une ligne par coach'; end if; end $$;

-- ── push_actor_forms : la forme seulement pour l'auteur coach du destinataire ──
insert into private.push_outbox (recipient, kind, actor, ref) values
  (pg_temp.fu('e1'), 'coach_note', pg_temp.fu('a1'), 'f-1'),     -- coach → son élève : forme
  (pg_temp.fu('a1'), 'chat_message', pg_temp.fu('e1'), '@coach'),  -- élève → coach : rien (pas de forme)
  (pg_temp.fu('01'), 'follow_request', pg_temp.fu('a1'), '');     -- coach → autre compte : rien
create temp table forme_ids as select array_agg(id order by id) ids from private.push_outbox where actor in (pg_temp.fu('a1'), pg_temp.fu('e1'));
grant select on forme_ids to service_role;
set role service_role;
do $$
declare r jsonb; ids bigint[] := (select f.ids from forme_ids f);
begin
  r := public.push_actor_forms(ids);
  if r <> jsonb_build_object(ids[1]::text, 'elle') then raise 'push_actor_forms : %', r; end if;
  if public.push_actor_forms(null) <> '{}'::jsonb then raise 'liste nulle'; end if;
end $$;
reset role;
-- Plus coach : plus rien
update public.user_profiles set coach_at = null where user_id = pg_temp.fu('a1');
set role service_role;
do $$ begin
  if public.push_actor_forms((select f.ids from forme_ids f)) <> '{}'::jsonb then raise 'ancien coach : forme en push'; end if;
end $$;
reset role;
set role authenticated;
do $$
begin
  perform pg_temp.flogin(pg_temp.fu('e1'));
  if public.coach_form(pg_temp.fu('a1')) ->> 'form' is not null then raise 'ancien coach : forme montrée'; end if;
end $$;
reset role;

-- ── Suppression des comptes : formes effacées ; rien ne reste pour les autres tests ──
drop table forme_ids;
delete from private.push_outbox where actor in (select pg_temp.fu(c) from unnest(array['a1', 'e1']) c);
delete from auth.users where id in (select pg_temp.fu(c) from unnest(array['a1', 'e1', 'c1', '01', '11']) c);
do $$ begin if exists (select 1 from public.coach_forms where user_id = pg_temp.fu('a1')) then raise 'forme restée'; end if; end $$;
