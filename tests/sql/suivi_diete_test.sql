-- Vérifications de supabase/migrations/20261118010000_suivi_diete_coach.sql (lancées par tests/sql/run.sh) :
-- consentement « diet_log » par élève et par coach, un résumé par jour borné, lecture par le seul coach consenti,
-- 90 jours glissants, effacement au retrait, limites. Les autres partages ne changent pas. Chaque bloc échoue
-- (raise) si la règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.du('k') → …0d1e1, l → 2, s → 3, t → 4, a → 5) : K kim.sd et L lea.sd sont coachs ;
-- S sol.sd et T tom.sd sont élèves de K ; A ami.sd (ni coach ni élève).

create function pg_temp.derr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.du(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000d1e' || translate(c, 'klsta', '12345'))::uuid $$;
create function pg_temp.dlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.du(c)::text, ''), false) $$;
create function pg_temp.dsend(d jsonb) returns text language plpgsql as
$$ begin return public.student_share_diet_days(d)::text; exception when others then return sqlerrm; end $$;
-- Un jour valide, n jours avant aujourd'hui (UTC), complété par extra
create function pg_temp.dday(n int, extra jsonb default '{}') returns jsonb language sql as
$$ select jsonb_build_object('day', to_char((now() at time zone 'utc')::date - n, 'YYYY-MM-DD'), 'plan', 'd_seche1', 'name', 'Sèche semaine 1',
     'kind', 't', 'meals', '[{"n": "Petit-déjeuner", "ok": true}, {"n": "Déjeuner", "ok": true}, {"n": "Dîner", "ok": false}]'::jsonb,
     'kcal', 1850, 'p', 120, 'c', 210, 'f', 50, 'goal', '{"kcal": 2300, "p": 150, "c": 270, "f": 55}'::jsonb,
     'water', 2500, 'waterGoal', 5000, 'waterMin', 3000, 'salt', 4.14, 'saltMin', 3, 'saltMax', 5) || extra $$;
grant execute on function pg_temp.derr(text), pg_temp.du(text), pg_temp.dlogin(text), pg_temp.dsend(jsonb), pg_temp.dday(int, jsonb)
  to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.du(c) from unnest(array['k', 'l', 's', 't', 'a']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.du('k'), 'kim.sd', '🦁'), (pg_temp.du('l'), 'lea.sd', '🦊'), (pg_temp.du('s'), 'sol.sd', '🦅'),
  (pg_temp.du('t'), 'tom.sd', '🐼'), (pg_temp.du('a'), 'ami.sd', '⭐');
update public.user_profiles set coach_at = now() where user_id in (pg_temp.du('k'), pg_temp.du('l'));
insert into public.coach_links (student_id, coach_id) values (pg_temp.du('s'), pg_temp.du('k')), (pg_temp.du('t'), pg_temp.du('k'));

-- ── Droits ───────────────────────────────────────────────
do $$
declare f text;
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.coach_shared_diet_days'::regclass) then raise 'RLS désactivée'; end if;
  if exists (select 1 from pg_policies where tablename = 'coach_shared_diet_days') then raise 'politique inattendue'; end if;
  foreach f in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(f, 'public.coach_shared_diet_days', 'select') or has_table_privilege(f, 'public.coach_shared_diet_days', 'insert')
       or has_table_privilege(f, 'public.coach_shared_diet_days', 'update') or has_table_privilege(f, 'public.coach_shared_diet_days', 'delete') then
      raise 'droit direct sur les jours de diète pour %', f; end if;
  end loop;
  foreach f in array array['public.student_share_diet_days(jsonb)', 'public.coach_student_diet(uuid)', 'public.coach_diet_overview()', 'public.student_shares()'] loop
    if has_function_privilege('anon', f, 'execute') then raise 'anon exécute %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise 'authenticated n''exécute pas %', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure) then raise 'security definer / search_path : %', f; end if;
  end loop;
  foreach f in array array['private.diet_day_ok(jsonb)', 'private.diet_share_first_day()', 'private.diet_day_json(public.coach_shared_diet_days)',
                           'private.diet_int_ok(jsonb, numeric, numeric, boolean)', 'private.diet_num_ok(jsonb, numeric, numeric, boolean)', 'private.diet_name_ok(jsonb, boolean)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then raise 'brique privée exécutable : %', f; end if;
  end loop;
end $$;

set role anon;
do $$ begin
  if pg_temp.derr($q$ select public.student_share_diet_days('[]') $q$) not like 'permission denied%' then raise 'anon : envoi'; end if;
  if pg_temp.derr(format('select public.coach_student_diet(%L)', pg_temp.du('s'))) not like 'permission denied%' then raise 'anon : lecture'; end if;
  if pg_temp.derr($q$ select public.coach_diet_overview() $q$) not like 'permission denied%' then raise 'anon : vue d''ensemble'; end if;
  if pg_temp.derr($q$ select * from public.coach_shared_diet_days $q$) not like 'permission denied%' then raise 'anon : table'; end if;
end $$;
reset role;

set role authenticated;

-- ── Par défaut : rien ; la donnée est annoncée ──────────
do $$
declare st jsonb;
begin
  perform pg_temp.dlogin('s');
  st := public.student_shares();
  if st -> 'shares' <> '{}'::jsonb or not (st -> 'kinds') ? 'diet_log' or not (st -> 'kinds') ? 'diet' or not (st -> 'kinds') ? 'weight' then raise 'état par défaut : %', st; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0))) <> 'not_shared' then raise 'envoi sans consentement'; end if;
  -- Accord « plans diète » : ne vaut pas pour le suivi
  perform public.student_set_share('diet', true);
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0))) <> 'not_shared' then raise 'accord des plans pris pour le suivi'; end if;
  perform pg_temp.dlogin('k');
  if public.coach_student_diet(pg_temp.du('s')) is distinct from '{"shared": false, "since": null, "days": []}'::jsonb then raise 'coach sans consentement'; end if;
  if public.coach_diet_overview() <> '{"students": []}'::jsonb then raise 'vue d''ensemble sans consentement'; end if;
  perform pg_temp.dlogin('a');
  if pg_temp.derr($q$ select public.student_set_share('diet_log', true) $q$) <> 'not_found' then raise 'cocher sans coach'; end if;
end $$;

-- ── Cocher, envoyer, lire ────────────────────────────────
do $$
declare st jsonb; r jsonb; g timestamptz; ov jsonb;
begin
  perform pg_temp.dlogin('s');
  st := public.student_set_share('diet_log', true);
  if st -> 'shares' -> 'diet_log' ->> 'granted_at' is null or (st -> 'shares' -> 'diet_log' ->> 'n')::int <> 0 then raise 'cocher : %', st; end if;
  g := (st -> 'shares' -> 'diet_log' ->> 'granted_at')::timestamptz;
  -- Refus de forme et de bornes
  if pg_temp.dsend(null) <> 'invalid_data' then raise 'null'; end if;
  if pg_temp.dsend('{}') <> 'invalid_data' then raise 'objet au lieu d''une liste'; end if;
  if pg_temp.dsend('[5]') <> 'invalid_data' then raise 'élément nombre'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"day": "2026-02-30"}'))) <> 'invalid_data' then raise 'date impossible'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"day": "18/11/2026"}'))) <> 'invalid_data' then raise 'date mal écrite'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"plan": "x; drop"}'))) <> 'invalid_data' then raise 'identifiant de plan'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, jsonb_build_object('name', repeat('a', 41))))) <> 'invalid_data' then raise 'nom de 41'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, jsonb_build_object('name', E'a\nb')))) <> 'invalid_data' then raise 'nom avec contrôle'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"kind": "x"}'))) <> 'invalid_data' then raise 'type du jour'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"kcal": "1850"}'))) <> 'invalid_data' then raise 'kcal texte'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"kcal": 1850.5}'))) <> 'invalid_data' then raise 'kcal décimal'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"kcal": 20001}'))) <> 'invalid_data' then raise 'kcal > 20000'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"p": -1}'))) <> 'invalid_data' then raise 'protéines < 0'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0) - 'kcal')) <> 'invalid_data' then raise 'kcal absent'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"goal": {"kcal": 10001}}'))) <> 'invalid_data' then raise 'objectif > 10000'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"water": 20001}'))) <> 'invalid_data' then raise 'eau'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"salt": 100.1}'))) <> 'invalid_data' then raise 'sel'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"saltMax": 16}'))) <> 'invalid_data' then raise 'objectif de sel'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"meals": [{"n": "Dîner", "ok": "oui"}]}'))) <> 'invalid_data' then raise 'coche texte'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, '{"meals": [{"n": "", "ok": true}]}'))) <> 'invalid_data' then raise 'repas sans nom'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, jsonb_build_object('meals', (select jsonb_agg(jsonb_build_object('n', 'R' || i, 'ok', true)) from generate_series(1, 9) i)))))
     <> 'invalid_data' then raise '9 repas'; end if;
  if pg_temp.dsend((select jsonb_agg(pg_temp.dday(i)) from generate_series(0, 92) i)) <> 'too_long' then raise '93 jours'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0, jsonb_build_object('x', repeat('a', 140000))))) <> 'too_long' then raise 'plus de 128 Ko'; end if;
  -- 92 jours envoyés : seuls les 90 derniers sont gardés ; clés en trop jamais gardées ; même jour : le dernier
  if pg_temp.dsend((select jsonb_agg(pg_temp.dday(i, '{"secret": "aliments"}')) from generate_series(0, 91) i)) <> '90' then raise '90 jours gardés'; end if;
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(1), pg_temp.dday(0, '{"kcal": 100}'), pg_temp.dday(0),
       pg_temp.dday(2, '{"plan": null, "name": null, "kind": null, "goal": null, "meals": [], "waterGoal": null, "waterMin": null, "salt": null, "saltMin": null, "saltMax": null}') - 'water')) <> '3'
    then raise 'envoi'; end if;
  st := public.student_shares();
  if (st -> 'shares' -> 'diet_log' ->> 'n')::int <> 3
     or (st -> 'shares' -> 'diet_log' ->> 'last_at')::bigint <> (extract(epoch from (now() at time zone 'utc')::date::timestamp) * 1000)::bigint then raise 'état après envoi : %', st; end if;
  -- L'élève ne lit pas par la fonction du coach
  if pg_temp.derr(format('select public.coach_student_diet(%L)', pg_temp.du('s'))) <> 'not_found' then raise 'élève lit par la fonction coach'; end if;
  -- Le coach consenti : les jours, du plus récent, en résumé (sel arrondi au dixième, jamais la clé secrète)
  perform pg_temp.dlogin('k');
  r := public.coach_student_diet(pg_temp.du('s'));
  if not (r ->> 'shared')::boolean or (r ->> 'since')::timestamptz is distinct from g or jsonb_array_length(r -> 'days') <> 3 then raise 'lecture du coach : %', r; end if;
  if r -> 'days' -> 0 is distinct from (pg_temp.dday(0, '{"salt": 4.1, "saltMin": 3.0, "saltMax": 5.0}')) then raise 'jour lu : %', r -> 'days' -> 0; end if;
  if r::text like '%secret%' then raise 'clé inconnue gardée'; end if;
  if r -> 'days' -> 2 is distinct from jsonb_build_object('day', to_char((now() at time zone 'utc')::date - 2, 'YYYY-MM-DD'), 'meals', '[]'::jsonb,
       'kcal', 1850, 'p', 120, 'c', 210, 'f', 50, 'water', 0) then raise 'jour sans plan ni objectif : %', r -> 'days' -> 2; end if;
  -- Vue d'ensemble : S seul, 3 jours en bref [jour, kcal, objectif, cochés, repas]
  ov := public.coach_diet_overview();
  if jsonb_array_length(ov -> 'students') <> 1 or ov -> 'students' -> 0 ->> 'student_id' <> pg_temp.du('s')::text then raise 'vue d''ensemble : %', ov; end if;
  if ov -> 'students' -> 0 -> 'days' -> 0 is distinct from jsonb_build_array(to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD'), 1850, 2300, 2, 3)
     or ov -> 'students' -> 0 -> 'days' -> 2 is distinct from jsonb_build_array(to_char((now() at time zone 'utc')::date - 2, 'YYYY-MM-DD'), 1850, null, 0, 0)
    then raise 'jours en bref : %', ov -> 'students' -> 0 -> 'days'; end if;
  if (public.coach_student_diet(pg_temp.du('t')) ->> 'shared')::boolean then raise 'T partage sans avoir coché'; end if;
  -- Les autres partages ne bougent pas
  if public.coach_student_weights(pg_temp.du('s')) -> 'weights' <> '[]'::jsonb then raise 'diète dans le poids'; end if;
end $$;

-- ── Personne d'autre ne lit ──────────────────────────────
do $$ begin
  perform pg_temp.dlogin('l');
  if pg_temp.derr(format('select public.coach_student_diet(%L)', pg_temp.du('s'))) <> 'not_found' then raise 'autre coach'; end if;
  if public.coach_diet_overview() <> '{"students": []}'::jsonb then raise 'autre coach : vue d''ensemble'; end if;
  perform pg_temp.dlogin('a');
  if pg_temp.derr(format('select public.coach_student_diet(%L)', pg_temp.du('s'))) <> 'not_found' then raise 'ami'; end if;
  if public.coach_diet_overview() <> '{"students": []}'::jsonb then raise 'ami : vue d''ensemble'; end if;
  if pg_temp.derr($q$ select * from public.coach_shared_diet_days $q$) not like 'permission denied%' then raise 'ami : table'; end if;
  perform pg_temp.dlogin('t');
  if pg_temp.derr(format('select public.coach_student_diet(%L)', pg_temp.du('s'))) <> 'not_found' then raise 'autre élève'; end if;
end $$;

-- ── 90 jours glissants : un jour vieilli n'est plus rendu, puis effacé au prochain envoi ──
do $$ begin
  reset role;
  update public.coach_shared_diet_days set day = (now() at time zone 'utc')::date - 90
    where student_id = pg_temp.du('s') and day = (now() at time zone 'utc')::date - 2;
  set local role authenticated;
  perform pg_temp.dlogin('k');
  if jsonb_array_length(public.coach_student_diet(pg_temp.du('s')) -> 'days') <> 2 then raise 'jour de plus de 90 jours rendu au coach'; end if;
  perform pg_temp.dlogin('s');
  perform public.student_share_diet_days(jsonb_build_array(pg_temp.dday(0)));
  reset role;
  if exists (select 1 from public.coach_shared_diet_days where day < (now() at time zone 'utc')::date - 89) then raise 'jour de plus de 90 jours gardé'; end if;
end $$;
reset role;
set role authenticated;

-- ── Décocher : tout est effacé, les autres accords restent ──
do $$
declare st jsonb;
begin
  perform pg_temp.dlogin('s');
  perform public.student_set_share('weight', true);
  st := public.student_set_share('diet_log', false);
  if st -> 'shares' ? 'diet_log' or not (st -> 'shares' ? 'weight') or not (st -> 'shares' ? 'diet') then raise 'décocher : %', st; end if;
  reset role;
  if exists (select 1 from public.coach_shared_diet_days where student_id = pg_temp.du('s')) then raise 'jours gardés après retrait'; end if;
  set role authenticated;
  perform pg_temp.dlogin('s');
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0))) <> 'not_shared' then raise 'envoi après retrait'; end if;
  perform pg_temp.dlogin('k');
  if public.coach_student_diet(pg_temp.du('s')) is distinct from '{"shared": false, "since": null, "days": []}'::jsonb then raise 'coach après retrait'; end if;
  -- Retirer l'accord des plans diète n'efface pas le suivi
  perform pg_temp.dlogin('s');
  perform public.student_set_share('diet_log', true);
  perform public.student_share_diet_days(jsonb_build_array(pg_temp.dday(0)));
  perform public.student_set_share('diet', false);
  reset role;
  if not exists (select 1 from public.coach_shared_diet_days where student_id = pg_temp.du('s')) then raise 'retirer les plans a effacé le suivi'; end if;
end $$;
reset role;

-- ── Quitter, être retiré, rôle retiré, limites, compte supprimé ──
do $$ begin
  set local role authenticated;
  perform pg_temp.dlogin('s');
  perform public.coach_leave();
  reset role;
  if exists (select 1 from public.coach_shared_diet_days where student_id = pg_temp.du('s')) or exists (select 1 from public.coach_shares where student_id = pg_temp.du('s'))
    then raise 'quitter garde le partage'; end if;
  insert into public.coach_links (student_id, coach_id) values (pg_temp.du('s'), pg_temp.du('l'));
  set local role authenticated;
  perform pg_temp.dlogin('s');
  if public.student_shares() -> 'shares' <> '{}'::jsonb then raise 'partage repris chez le nouveau coach'; end if;
  perform public.student_set_share('diet_log', true);
  perform public.student_share_diet_days(jsonb_build_array(pg_temp.dday(0)));
  perform pg_temp.dlogin('l');
  perform public.coach_remove_student(pg_temp.du('s'));
  reset role;
  if exists (select 1 from public.coach_shared_diet_days where student_id = pg_temp.du('s')) then raise 'retrait garde les jours'; end if;
  -- Rôle retiré : plus de lecture
  set local role authenticated;
  perform pg_temp.dlogin('t');
  perform public.student_set_share('diet_log', true);
  perform public.student_share_diet_days(jsonb_build_array(pg_temp.dday(0)));
  reset role;
  update public.user_profiles set coach_at = null where user_id = pg_temp.du('k');
  set local role authenticated;
  perform pg_temp.dlogin('k');
  if pg_temp.derr(format('select public.coach_student_diet(%L)', pg_temp.du('t'))) <> 'not_found' then raise 'ex-coach lit'; end if;
  if public.coach_diet_overview() <> '{"students": []}'::jsonb then raise 'ex-coach : vue d''ensemble'; end if;
  reset role;
  update public.user_profiles set coach_at = now() where user_id = pg_temp.du('k');
  -- 120 envois par heure ; décocher jamais limité
  insert into private.social_rate (user_id, action) select pg_temp.du('t'), 'coach_share_dup' from generate_series(1, 120);
  set local role authenticated;
  perform pg_temp.dlogin('t');
  if pg_temp.dsend(jsonb_build_array(pg_temp.dday(0))) <> 'rate_limited' then raise 'limite des envois'; end if;
  if pg_temp.derr($q$ select public.student_set_share('diet_log', false) $q$) <> 'ok' then raise 'décocher limité'; end if;
  perform public.student_set_share('diet_log', true);
  reset role;
  delete from private.social_rate where user_id = pg_temp.du('t') and action = 'coach_share_dup';
  set local role authenticated;
  perform pg_temp.dlogin('t');
  perform public.student_share_diet_days(jsonb_build_array(pg_temp.dday(0)));
  reset role;
  delete from auth.users where id = pg_temp.du('t');
  if exists (select 1 from public.coach_shares where student_id = pg_temp.du('t')) or exists (select 1 from public.coach_shared_diet_days where student_id = pg_temp.du('t'))
    then raise 'cascade élève'; end if;
end $$;
reset role;
delete from auth.users where id in (select pg_temp.du(c) from unnest(array['k', 'l', 's', 'a']) c);
delete from private.social_rate where user_id in (select pg_temp.du(c) from unnest(array['k', 'l', 's', 't', 'a']) c);
