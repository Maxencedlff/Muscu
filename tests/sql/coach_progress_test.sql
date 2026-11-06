-- Vérifications de supabase/migrations/20261106000000_coach_progression.sql (lancées par tests/sql/run.sh) :
-- coach_progress() donne au coach, pour ses seuls élèves, les séances des 35 derniers jours (date et records
-- notés revalidés), la première séance, le dernier record et la dernière séance sans records notés sur
-- 182 jours ; rien à personne d'autre. Chaque bloc échoue (raise) si la règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.pu('k') → …0000000000f1, s → f2, t → f3, l → f4, a → f5) : K kim.p1 et L lea.p1
-- sont coachs ; S sol.p1 et T tom.p1 sont élèves de K ; A ami.p1 (ni coach ni élève).

create function pg_temp.perr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.pu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000000f' || translate(c, 'kstla', '12345'))::uuid $$;
create function pg_temp.plogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.pu(c)::text, ''), false) $$;
-- Il y a d jours (en ms)
create function pg_temp.pago(d numeric) returns bigint language sql stable as
$$ select ((extract(epoch from now()) - d * 86400) * 1000)::bigint $$;
-- Élève c de coach_progress() (null s'il n'y est pas)
create function pg_temp.pof(p jsonb, c text) returns jsonb language sql immutable as
$$ select x from jsonb_array_elements(p -> 'students') x where x ->> 'student_id' = pg_temp.pu(c)::text $$;
grant execute on function pg_temp.perr(text), pg_temp.pu(text), pg_temp.plogin(text), pg_temp.pago(numeric),
  pg_temp.pof(jsonb, text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.pu(c) from unnest(array['k', 's', 't', 'l', 'a']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.pu('k'), 'kim.p1', '🦁'), (pg_temp.pu('s'), 'sol.p1', '🦅'), (pg_temp.pu('t'), 'tom.p1', '🐼'),
  (pg_temp.pu('l'), 'lea.p1', '🦊'), (pg_temp.pu('a'), 'ami.p1', '⭐');
update public.user_profiles set coach_at = now() where user_id in (pg_temp.pu('k'), pg_temp.pu('l'));
insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('s'), pg_temp.pu('k')), (pg_temp.pu('t'), pg_temp.pu('k'));

-- Séances de S : records notés (un valable, un invalide écarté), app d'avant (sans records), supprimée,
-- trop ancienne pour la fenêtre de 35 jours, au-delà de 182 jours, dans le futur lointain
insert into public.sessions (user_id, id, data, deleted_at)
select pg_temp.pu('s'), x.id, x.data, x.del from (values
  ('s-1', jsonb_build_object('date', pg_temp.pago(1), 'label', 'Legs', 'notes', 'secret', 'bodyKg', 70, 'exercises', '[]'::jsonb,
     'records', jsonb_build_array(
       jsonb_build_object('ex', 'Squat', 'kind', 'charge', 'before', 100, 'after', 105, 'cle', 'x'),
       jsonb_build_object('ex', 'Presse', 'kind', '1rm', 'before', 1, 'after', 2))), null::timestamptz),
  ('s-2', jsonb_build_object('date', pg_temp.pago(3), 'exercises', '[]'::jsonb, 'records', '[]'::jsonb), null),
  ('s-3', jsonb_build_object('date', pg_temp.pago(10), 'exercises', '[]'::jsonb), null),
  ('s-4', jsonb_build_object('date', pg_temp.pago(2), 'exercises', '[]'::jsonb, 'records',
     jsonb_build_array(jsonb_build_object('ex', 'Supprimée', 'kind', 'charge', 'before', 1, 'after', 2))), now()),
  ('s-5', jsonb_build_object('date', pg_temp.pago(50), 'exercises', '[]'::jsonb, 'records',
     jsonb_build_array(jsonb_build_object('ex', 'Tractions', 'kind', 'reps', 'before', 8, 'after', 9, 'w', 0))), null),
  ('s-6', jsonb_build_object('date', pg_temp.pago(200), 'exercises', '[]'::jsonb), null),
  ('s-7', jsonb_build_object('date', pg_temp.pago(-3), 'exercises', '[]'::jsonb, 'records',
     jsonb_build_array(jsonb_build_object('ex', 'Futur', 'kind', 'charge', 'before', 1, 'after', 2))), null)
) as x(id, data, del);
insert into public.sessions (user_id, id, data)
  values (pg_temp.pu('a'), 'a-1', jsonb_build_object('date', pg_temp.pago(1), 'exercises', '[]'::jsonb,
          'records', jsonb_build_array(jsonb_build_object('ex', 'Squat', 'kind', 'charge', 'before', 1, 'after', 2))));

-- ── Droits : anon n'exécute rien, security definer, search_path vide ──
do $$
begin
  if has_function_privilege('anon', 'public.coach_progress()', 'execute') then raise 'anon exécute coach_progress'; end if;
  if not has_function_privilege('authenticated', 'public.coach_progress()', 'execute') then raise 'authenticated n''exécute pas coach_progress'; end if;
  if not (select p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 's'
          from pg_proc p where p.oid = 'public.coach_progress()'::regprocedure) then raise 'security definer / search_path / stable'; end if;
end $$;
set role anon;
do $$ begin
  if pg_temp.perr($q$ select public.coach_progress() $q$) not like 'permission denied%' then raise 'anon : coach_progress'; end if;
end $$;
reset role;

set role authenticated;

-- ── Le coach : ses deux élèves, les bonnes séances, les bons records ──
do $$
declare p jsonb; s jsonb; t jsonb;
begin
  perform pg_temp.plogin('k');
  p := public.coach_progress();
  if jsonb_array_length(p -> 'students') <> 2 then raise 'deux élèves attendus : %', p; end if;
  s := pg_temp.pof(p, 's');
  t := pg_temp.pof(p, 't');
  -- Fenêtre de 35 jours : s-1, s-2, s-3 (s-4 supprimée, s-5 trop ancienne, s-6 hors horizon, s-7 dans le futur lointain)
  if jsonb_array_length(s -> 'sessions') <> 3 then raise 'séances de S : %', s -> 'sessions'; end if;
  if (s -> 'sessions' -> 0 ->> 'at')::bigint < (s -> 'sessions' -> 1 ->> 'at')::bigint then raise 'ordre : plus récente d''abord'; end if;
  -- Records revalidés : le « 1rm » est écarté, la clé inconnue ne sort pas, la valeur d'avant reste (coach)
  if s -> 'sessions' -> 0 -> 'records' is distinct from '[{"ex": "Squat", "kind": "charge", "after": 105, "before": 100}]'::jsonb
    then raise 'records de s-1 : %', s -> 'sessions' -> 0 -> 'records'; end if;
  if s -> 'sessions' -> 1 -> 'records' is distinct from '[]'::jsonb then raise 'séance notée sans record : %', s -> 'sessions' -> 1; end if;
  if jsonb_typeof(s -> 'sessions' -> 2 -> 'records') <> 'null' then raise 'app d''avant : records null attendu : %', s -> 'sessions' -> 2; end if;
  -- Rien d'autre qu'une date et des records
  if exists (select 1 from jsonb_array_elements(s -> 'sessions') x, jsonb_object_keys(x) k where k not in ('at', 'records'))
    then raise 'clé en trop dans une séance : %', s -> 'sessions'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(s) k) <> array['first_at', 'last_record_at', 'sessions', 'student_id', 'unnoted_at']
    then raise 'clés d''un élève : %', s; end if;
  -- Sur 182 jours : première séance s-5 (50 jours), dernier record s-1, dernière séance sans records notés s-3
  if (s ->> 'first_at')::bigint > pg_temp.pago(49) or (s ->> 'first_at')::bigint < pg_temp.pago(51) then raise 'first_at : %', s ->> 'first_at'; end if;
  if (s ->> 'last_record_at')::bigint <> (s -> 'sessions' -> 0 ->> 'at')::bigint then raise 'last_record_at : %', s; end if;
  if (s ->> 'unnoted_at')::bigint <> (s -> 'sessions' -> 2 ->> 'at')::bigint then raise 'unnoted_at : %', s; end if;
  -- T n'a rien : listes vides, dates nulles
  if t -> 'sessions' <> '[]'::jsonb or jsonb_typeof(t -> 'first_at') <> 'null' or jsonb_typeof(t -> 'last_record_at') <> 'null'
     or jsonb_typeof(t -> 'unnoted_at') <> 'null' then raise 'T sans séance : %', t; end if;
end $$;

-- ── Personne d'autre ─────────────────────────────────────
do $$
begin
  -- Un autre coach : ses élèves à lui (aucun)
  perform pg_temp.plogin('l');
  if public.coach_progress() is distinct from '{"students": []}'::jsonb then raise 'autre coach : %', public.coach_progress(); end if;
  -- Un élève (même celui de K) : rien
  perform pg_temp.plogin('s');
  if public.coach_progress() is distinct from '{"students": []}'::jsonb then raise 'élève : %', public.coach_progress(); end if;
  -- Ni coach ni élève
  perform pg_temp.plogin('a');
  if public.coach_progress() is distinct from '{"students": []}'::jsonb then raise 'compte quelconque : %', public.coach_progress(); end if;
  -- Sans session
  perform set_config('request.jwt.claim.sub', '', false);
  if public.coach_progress() is distinct from '{"students": []}'::jsonb then raise 'sans session : %', public.coach_progress(); end if;
end $$;

-- ── Rôle retiré, lien rompu ──────────────────────────────
do $$
begin
  reset role;
  update public.user_profiles set coach_at = null where user_id = pg_temp.pu('k');
  set local role authenticated;
  perform pg_temp.plogin('k');
  if public.coach_progress() is distinct from '{"students": []}'::jsonb then raise 'rôle retiré : %', public.coach_progress(); end if;
  reset role;
  update public.user_profiles set coach_at = now() where user_id = pg_temp.pu('k');
  set local role authenticated;
  perform public.coach_remove_student(pg_temp.pu('t'));
  if jsonb_array_length(public.coach_progress() -> 'students') <> 1 or pg_temp.pof(public.coach_progress(), 't') is not null
    then raise 'élève retiré encore là : %', public.coach_progress(); end if;
end $$;
reset role;

-- Nettoyage : les tests suivants partent d'une base sans ces comptes
delete from auth.users where id in (select pg_temp.pu(c) from unnest(array['k', 's', 't', 'l', 'a']) c);
