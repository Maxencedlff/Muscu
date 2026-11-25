-- Vérifications de supabase/migrations/20261127030000_bilans_accord_majeur.sql (lancées par tests/sql/run.sh) :
-- accord daté pour les bilans (sans lui, aucun envoi ; version du texte vérifiée ; retrait qui arrête les envois ;
-- effacé avec le lien) ; libido et cycle rendus et acceptés seulement après « J'ai 18 ans ou plus » (déclaration des
-- photos de bilan, ou celle de l'accord du cycle, gardée aussi après son retrait) ; droits.
-- Comptes simulés : K coach ; S élève qui n'a rien déclaré ; A élève qui déclare ses 18 ans ; U élève qui accepte
-- puis retire le cycle ; N personne.

create function pg_temp.mu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000ac' || translate(c, 'ksaun', '12345') || '00')::uuid $$;
create function pg_temp.mlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.mu(c)::text, ''), false) $$;
create function pg_temp.merr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create temp table mk (k text primary key, v uuid);
grant all on pg_temp.mk to authenticated;
grant execute on function pg_temp.mu(text), pg_temp.mlogin(text), pg_temp.merr(text) to authenticated, anon;

insert into auth.users (id) select pg_temp.mu(c) from unnest(array['k', 's', 'a', 'u', 'n']) c;
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at) values
  (pg_temp.mu('k'), 'kim.am', '🦁', now()), (pg_temp.mu('s'), 'sol.am', '🦅', null), (pg_temp.mu('a'), 'ana.am', '🦊', null),
  (pg_temp.mu('u'), 'uma.am', '🐼', null), (pg_temp.mu('n'), 'nul.am', '⭐', null);
insert into public.coach_links (student_id, coach_id) select pg_temp.mu(c), pg_temp.mu('k') from unnest(array['s', 'a', 'u']) c;

-- ── Droits ───────────────────────────────────────────────
do $$ begin
  if has_function_privilege('anon', 'public.student_checkin_consent(boolean,int)', 'execute') then raise 'anon exécute student_checkin_consent'; end if;
  if not has_function_privilege('authenticated', 'public.student_checkin_consent(boolean,int)', 'execute') then raise 'authenticated sans student_checkin_consent'; end if;
  if has_function_privilege('authenticated', 'private.checkin_is_adult(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.checkin_health_ok(uuid,uuid)', 'execute') then raise 'fonctions privées exécutables'; end if;
  if has_table_privilege('authenticated', 'public.checkin_health_consents', 'select')
     or has_table_privilege('anon', 'public.checkin_health_consents', 'select') then raise 'table de l''accord lisible'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.checkin_health_consents'::regclass) then raise 'RLS'; end if;
  if not (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
          where p.oid in ('public.student_checkin_consent(boolean,int)'::regprocedure, 'public.student_checkins()'::regprocedure,
                          'public.student_checkin_answer(uuid,jsonb)'::regprocedure, 'private.checkin_is_adult(uuid)'::regprocedure)) then
    raise 'security definer / search_path'; end if;
end $$;

-- ── Bilan avec sommeil, libido et cycle, envoyé à S, A et U ──
set role authenticated;
do $$
declare tpl uuid;
begin
  perform pg_temp.mlogin('k');
  tpl := (public.coach_template_save(null, 'Hebdo', '[{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}, {"key": "libido", "kind": "libido", "label": "Libido", "type": "scale", "required": false, "scale": 5, "lo": "Très basse", "hi": "Très haute"}, {"key": "cycle", "kind": "cycle", "label": "Cycle menstruel", "type": "choice", "required": false}]') ->> 'id')::uuid;
  if (public.coach_checkin_send_now(tpl, array[pg_temp.mu('s'), pg_temp.mu('a'), pg_temp.mu('u')]) ->> 'sent')::int <> 3 then raise 'envoi'; end if;
  insert into pg_temp.mk values ('tpl', tpl);
end $$;
reset role;
insert into pg_temp.mk select c, r.id from unnest(array['s', 'a', 'u']) c join public.coach_checkin_requests r on r.student_id = pg_temp.mu(c);

-- ── S : mineur ou rien déclaré, pas d'accord ─────────────
set role authenticated;
do $$
declare r jsonb; req uuid := (select v from pg_temp.mk where k = 's');
begin
  perform pg_temp.mlogin('s');
  r := public.student_checkins();
  if (r ->> 'adult')::boolean or not (r ->> 'adult_asked')::boolean then raise 'S : adult %', r; end if;
  if (r -> 'health' ->> 'consented')::boolean or (r -> 'health' ->> 'current')::int <> 1 then raise 'S : accord %', r -> 'health'; end if;
  if (select jsonb_agg(e ->> 'kind') from jsonb_array_elements(r -> 'requests' -> 0 -> 'items') e) <> '["sleep"]' then raise 'S : libido ou cycle rendus %', r -> 'requests' -> 0 -> 'items'; end if;
  if (r -> 'cycle' ->> 'asked')::boolean then raise 'S : cycle proposé à un élève sans déclaration'; end if;
  -- Sans accord : aucun envoi
  if pg_temp.merr(format('select public.student_checkin_answer(%L, %L)', req, '{"sleep": 3}')) <> 'no_health_consent' then raise 'envoi sans accord'; end if;
  -- Accord : seulement à la version du texte en vigueur
  if pg_temp.merr('select public.student_checkin_consent(true)') <> 'invalid_version' then raise 'accord sans version'; end if;
  if pg_temp.merr('select public.student_checkin_consent(true, 2)') <> 'invalid_version' then raise 'accord d''une autre version'; end if;
  r := public.student_checkin_consent(true, 1);
  if not (r ->> 'consented')::boolean or (r ->> 'version')::int <> 1 or r ->> 'at' is null then raise 'accord %', r; end if;
  if not (public.student_checkins() -> 'health' ->> 'consented')::boolean then raise 'accord pas relu'; end if;
  -- Libido sans déclaration : refusée
  if pg_temp.merr(format('select public.student_checkin_answer(%L, %L)', req, '{"sleep": 3, "libido": 2}')) <> 'not_adult' then raise 'libido sans déclaration'; end if;
  if pg_temp.merr(format('select public.student_checkin_answer(%L, %L)', req, '{"sleep": 3, "cycle": "luteal"}')) <> 'not_adult' then raise 'cycle sans déclaration'; end if;
  if pg_temp.merr(format('select public.student_checkin_answer(%L, %L)', req, '{"sleep": 3}')) <> 'ok' then raise 'envoi avec accord'; end if;
end $$;
reset role;
do $$ begin
  if (select version from public.checkin_health_consents where student_id = pg_temp.mu('s')) <> 1
     or (select consented_at from public.checkin_health_consents where student_id = pg_temp.mu('s')) is null then raise 'accord pas daté'; end if;
  if exists (select 1 from public.coach_checkin_answers a where a.request_id = (select v from pg_temp.mk where k = 's') and a.item_key <> 'sleep') then raise 'réponse de trop'; end if;
end $$;

-- ── A : déclare ses 18 ans (déclaration des photos), retire puis redonne l'accord ──
set role authenticated;
do $$
declare r jsonb; req uuid := (select v from pg_temp.mk where k = 'a');
begin
  perform pg_temp.mlogin('a');
  perform public.student_photo_adult();
  r := public.student_checkins();
  if not (r ->> 'adult')::boolean or (r ->> 'adult_asked')::boolean then raise 'A : adult %', r; end if;
  if (select jsonb_agg(e ->> 'kind') from jsonb_array_elements(r -> 'requests' -> 0 -> 'items') e) <> '["sleep", "libido"]' then raise 'A : suivis %', r -> 'requests' -> 0 -> 'items'; end if;
  if not (r -> 'cycle' ->> 'asked')::boolean then raise 'A : cycle pas proposé'; end if;
  perform public.student_checkin_consent(true, 1);
  -- Retrait : plus d'envoi
  r := public.student_checkin_consent(false);
  if (r ->> 'consented')::boolean or r ->> 'at' is not null then raise 'retrait %', r; end if;
  if pg_temp.merr(format('select public.student_checkin_answer(%L, %L)', req, '{"libido": 4}')) <> 'no_health_consent' then raise 'envoi après retrait'; end if;
  perform public.student_checkin_consent(true, 1);
  if pg_temp.merr(format('select public.student_checkin_answer(%L, %L)', req, '{"libido": 4}')) <> 'ok' then raise 'libido d''un adulte refusée'; end if;
end $$;
reset role;

-- Texte de l'accord changé (version 2) : U, qui avait accepté la version 1, réaccepte avant l'envoi suivant
insert into public.checkin_health_consents (student_id, coach_id, version) values (pg_temp.mu('u'), pg_temp.mu('k'), 1);
create or replace function private.checkin_health_version() returns int language sql immutable set search_path = '' as $$ select 2 $$;
set role authenticated;
do $$
declare req uuid := (select v from pg_temp.mk where k = 'u');
begin
  perform pg_temp.mlogin('u');
  if (public.student_checkins() -> 'health' ->> 'consented')::boolean then raise 'ancienne version comptée'; end if;
  if pg_temp.merr(format('select public.student_checkin_answer(%L, %L)', req, '{"sleep": 2}')) <> 'no_health_consent' then raise 'envoi avec une ancienne version'; end if;
  if pg_temp.merr('select public.student_checkin_consent(true, 1)') <> 'invalid_version' then raise 'ancienne version acceptée'; end if;
  -- U : l'accord du cycle (avec « 18 ans ou plus ») vaut déclaration, qui reste après le retrait du cycle
  perform public.student_checkin_cycle(true, true);
  perform public.student_checkin_cycle(false);
  if not (public.student_checkins() ->> 'adult')::boolean then raise 'déclaration perdue avec le retrait du cycle'; end if;
  -- N : sans coach, pas d'accord possible
  perform pg_temp.mlogin('n');
  if pg_temp.merr('select public.student_checkin_consent(true, 1)') <> 'not_found' then raise 'accord sans coach'; end if;
  -- S quitte son coach : l'accord part avec le lien
  perform pg_temp.mlogin('s');
  perform public.coach_leave();
end $$;
reset role;
create or replace function private.checkin_health_version() returns int language sql immutable set search_path = '' as $$ select 1 $$;
do $$ begin
  if not exists (select 1 from public.coach_photo_adults where user_id = pg_temp.mu('u')) then raise 'cycle : déclaration pas gardée'; end if;
  if exists (select 1 from public.checkin_health_consents where student_id = pg_temp.mu('s')) then raise 'accord gardé après le départ'; end if;
  if not exists (select 1 from public.checkin_health_consents where student_id = pg_temp.mu('a')) then raise 'accord de A perdu'; end if;
end $$;
-- A bloque son coach : lien coupé (20261127010000), accord effacé avec lui
set role authenticated;
do $$ begin perform pg_temp.mlogin('a'); perform public.block_user(pg_temp.mu('k')); end $$;
reset role;
do $$ begin
  if exists (select 1 from public.checkin_health_consents where student_id = pg_temp.mu('a')) then raise 'accord gardé après le blocage'; end if;
end $$;
