-- Vérifications de supabase/migrations/20261124010000_semaines_coach.sql (lancées par tests/sql/run.sh) :
-- coach_student_weeks rend, pour un élève de ce coach seulement, exactement ce que rendent déjà
-- coach_student_sessions (même liste blanche, sur la fenêtre), coach_student_weights, coach_student_measures et
-- coach_student_diet ; refus pour un autre coach, un ex-coach (rôle retiré), un non-élève, anon ; fenêtre bornée.
-- Comptes simulés : K coach, L autre coach, S et T élèves de K, A ni coach ni élève.

create function pg_temp.wu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000000e' || translate(c, 'klsta', '12345'))::uuid $$;
create function pg_temp.wlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.wu(c)::text, ''), false) $$;
create function pg_temp.werr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.wu(text), pg_temp.wlogin(text), pg_temp.werr(text) to authenticated, anon;

insert into auth.users (id) select pg_temp.wu(c) from unnest(array['k', 'l', 's', 't', 'a']) c;
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at) values
  (pg_temp.wu('k'), 'kim.w1', '🦁', now()), (pg_temp.wu('l'), 'lea.w1', '🦊', now()), (pg_temp.wu('s'), 'sol.w1', '🦅', null),
  (pg_temp.wu('t'), 'tom.w1', '🐼', null), (pg_temp.wu('a'), 'ami.w1', '⭐', null);
insert into public.coach_links (student_id, coach_id) values (pg_temp.wu('s'), pg_temp.wu('k')), (pg_temp.wu('t'), pg_temp.wu('k'));
-- Séances de S : une tous les 3 jours sur 200 jours, une supprimée, une dans le futur lointain, un champ hors liste blanche
insert into public.sessions (user_id, id, data, deleted_at)
  select pg_temp.wu('s'), 'w' || d, jsonb_build_object('date', (extract(epoch from now()) * 1000)::bigint - d * 86400000::bigint,
    'label', 'Push', 'healthSaved', true, 'exercises', jsonb_build_array(jsonb_build_object('name', 'Squat', 'measure', 'reps',
    'sets', jsonb_build_array(jsonb_build_object('weight', '80', 'reps', '8'))))), case when d = 4 then now() end
  from generate_series(1, 200, 3) d;
insert into public.sessions (user_id, id, data) values
  (pg_temp.wu('s'), 'futur', jsonb_build_object('date', (extract(epoch from now()) * 1000)::bigint + 30 * 86400000::bigint, 'label', 'Push'));
-- Poids partagé par S
insert into public.coach_shares (student_id, coach_id, kind) values (pg_temp.wu('s'), pg_temp.wu('k'), 'weight');
insert into public.coach_shared_weights (student_id, at, kg) values (pg_temp.wu('s'), (extract(epoch from now()) * 1000)::bigint - 10 * 86400000::bigint, 61.5);

-- ── Droits ───────────────────────────────────────────────
do $$ begin
  if has_function_privilege('anon', 'public.coach_student_weeks(uuid, integer)', 'execute') then raise 'anon exécute coach_student_weeks'; end if;
  if not has_function_privilege('authenticated', 'public.coach_student_weeks(uuid, integer)', 'execute') then raise 'authenticated ne l''exécute pas'; end if;
  if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.coach_student_weeks(uuid, integer)'::regprocedure) then
    raise 'security definer / search_path'; end if;
end $$;
set role anon;
do $$ begin
  if pg_temp.werr(format('select public.coach_student_weeks(%L)', pg_temp.wu('s'))) not like 'permission denied%' then raise 'anon : lecture'; end if;
end $$;
reset role;

set role authenticated;
do $$
declare r jsonb; ref jsonb; n int;
begin
  -- Le coach de S : fenêtre de 12 semaines par défaut, mêmes séances que coach_student_sessions sur la fenêtre
  perform pg_temp.wlogin('k');
  r := public.coach_student_weeks(pg_temp.wu('s'));
  if (r ->> 'weeks')::int <> 12 then raise 'fenêtre par défaut : %', r ->> 'weeks'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'done_at', x.done_at, 's', x.s) order by x.done_at desc, x.id desc), '[]'::jsonb) into ref
    from public.coach_student_sessions(pg_temp.wu('s')) x where x.done_at >= (r ->> 'from')::bigint;
  n := jsonb_array_length(r -> 'sessions');
  if n < 25 or n > 30 then raise 'séances de la fenêtre : %', n; end if;
  if (select jsonb_agg(e) from (select e from jsonb_array_elements(r -> 'sessions') e limit jsonb_array_length(ref)) z) <> ref then
    raise 'séances différentes de coach_student_sessions'; end if;
  if exists (select 1 from jsonb_array_elements(r -> 'sessions') e where e ->> 'id' in ('w4', 'futur')) then raise 'séance supprimée ou future rendue'; end if;
  if exists (select 1 from jsonb_array_elements(r -> 'sessions') e where e -> 's' ? 'healthSaved') then raise 'champ hors liste blanche'; end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'sessions') e where (e -> 's' ->> 'bodyKg')::numeric = 61.5) then raise 'poids du corps consenti absent'; end if;
  if r -> 'weights' <> public.coach_student_weights(pg_temp.wu('s')) then raise 'pesées différentes'; end if;
  if r -> 'measures' <> public.coach_student_measures(pg_temp.wu('s')) then raise 'mensurations différentes'; end if;
  if to_regprocedure('public.coach_student_diet(uuid)') is not null and r -> 'diet' <> public.coach_student_diet(pg_temp.wu('s')) then raise 'diète différente'; end if;
  -- Bornes de la fenêtre : 1 à 26 semaines
  if (public.coach_student_weeks(pg_temp.wu('s'), 0) ->> 'weeks')::int <> 1 then raise 'borne basse'; end if;
  if (public.coach_student_weeks(pg_temp.wu('s'), 500) ->> 'weeks')::int <> 26 then raise 'borne haute'; end if;
  if jsonb_array_length(public.coach_student_weeks(pg_temp.wu('s'), 26) -> 'sessions') > 150 then raise 'plus de 150 séances'; end if;
  if jsonb_array_length(public.coach_student_weeks(pg_temp.wu('s'), 1) -> 'sessions') > 4 then raise 'fenêtre d''une semaine trop large'; end if;
  -- T, élève sans rien partagé : séances vides, pesées non partagées
  r := public.coach_student_weeks(pg_temp.wu('t'));
  if jsonb_array_length(r -> 'sessions') <> 0 or (r -> 'weights' ->> 'shared')::boolean then raise 'élève sans partage'; end if;
  -- Refus : non-élève, autre coach, élève qui n'en est pas un, compte anonyme
  if pg_temp.werr(format('select public.coach_student_weeks(%L)', pg_temp.wu('a'))) <> 'not_found' then raise 'non-élève lu'; end if;
  perform pg_temp.wlogin('l');
  if pg_temp.werr(format('select public.coach_student_weeks(%L)', pg_temp.wu('s'))) <> 'not_found' then raise 'autre coach lit S'; end if;
  perform pg_temp.wlogin('s');
  if pg_temp.werr(format('select public.coach_student_weeks(%L)', pg_temp.wu('t'))) <> 'not_found' then raise 'un élève lit un autre élève'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  if pg_temp.werr(format('select public.coach_student_weeks(%L)', pg_temp.wu('s'))) <> 'not_found' then raise 'sans compte'; end if;
end $$;
reset role;
-- Ex-coach : rôle retiré par l'administrateur, le lien existe encore
update public.user_profiles set coach_at = null where user_id = pg_temp.wu('k');
set role authenticated;
do $$ begin
  perform pg_temp.wlogin('k');
  if pg_temp.werr(format('select public.coach_student_weeks(%L)', pg_temp.wu('s'))) <> 'not_found' then raise 'ex-coach lit encore'; end if;
end $$;
reset role;
update public.user_profiles set coach_at = now() where user_id = pg_temp.wu('k');
