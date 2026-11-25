-- Vérifications de supabase/migrations/20261127010000_sante_coach.sql (lancées par tests/sql/run.sh) :
-- consentement « health » par élève et par coach, un résumé par jour borné (pas, sommeil, cardio), fusion jour par
-- jour, 90 jours glissants, lecture par le seul coach consenti, effacement au retrait, limites, clé health de
-- coach_student_weeks, et le suivi Sommeil des bilans en heures. Chaque bloc échoue (raise) si la règle n'est pas
-- tenue.
--
-- Comptes simulés (pg_temp.hu('k') → …5a11, l → 2, s → 3, t → 4, a → 5) : K kim.hs et L lea.hs sont coachs ;
-- S sol.hs et T tom.hs sont élèves de K ; A ami.hs (ni coach ni élève).

create function pg_temp.herr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.hu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-000000005a1' || translate(c, 'klsta', '12345'))::uuid $$;
create function pg_temp.hlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.hu(c)::text, ''), false) $$;
create function pg_temp.hsend(d jsonb) returns text language plpgsql as
$$ begin return public.student_share_health_days(d)::text; exception when others then return sqlerrm; end $$;
-- Un jour valide, n jours avant aujourd'hui (UTC), complété par extra
create function pg_temp.hday(n int, extra jsonb default '{}') returns jsonb language sql as
$$ select jsonb_build_object('day', to_char((now() at time zone 'utc')::date - n, 'YYYY-MM-DD'),
     'steps', 8400, 'sleep', 435, 'cardio', 30) || extra $$;
grant execute on function pg_temp.herr(text), pg_temp.hu(text), pg_temp.hlogin(text), pg_temp.hsend(jsonb), pg_temp.hday(int, jsonb)
  to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.hu(c) from unnest(array['k', 'l', 's', 't', 'a']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.hu('k'), 'kim.hs', '🦁'), (pg_temp.hu('l'), 'lea.hs', '🦊'), (pg_temp.hu('s'), 'sol.hs', '🦅'),
  (pg_temp.hu('t'), 'tom.hs', '🐼'), (pg_temp.hu('a'), 'ami.hs', '⭐');
update public.user_profiles set coach_at = now() where user_id in (pg_temp.hu('k'), pg_temp.hu('l'));
insert into public.coach_links (student_id, coach_id) values (pg_temp.hu('s'), pg_temp.hu('k')), (pg_temp.hu('t'), pg_temp.hu('k'));

-- ── Droits ───────────────────────────────────────────────
do $$
declare f text;
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.coach_shared_health_days'::regclass) then raise 'RLS désactivée'; end if;
  if exists (select 1 from pg_policies where tablename = 'coach_shared_health_days') then raise 'politique inattendue'; end if;
  foreach f in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(f, 'public.coach_shared_health_days', 'select') or has_table_privilege(f, 'public.coach_shared_health_days', 'insert')
       or has_table_privilege(f, 'public.coach_shared_health_days', 'update') or has_table_privilege(f, 'public.coach_shared_health_days', 'delete') then
      raise 'droit direct sur les jours de santé pour %', f; end if;
  end loop;
  foreach f in array array['public.student_share_health_days(jsonb)', 'public.coach_student_health(uuid)', 'public.student_shares()',
                           'public.coach_student_weeks(uuid, integer)'] loop
    if has_function_privilege('anon', f, 'execute') then raise 'anon exécute %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise 'authenticated n''exécute pas %', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure) then raise 'security definer / search_path : %', f; end if;
  end loop;
  foreach f in array array['private.health_day_ok(jsonb)', 'private.health_share_first_day()', 'private.health_int_ok(jsonb, integer)',
                           'private.share_kind_open(text)', 'private.checkin_kinds()', 'private.checkin_number(jsonb, text)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute') then raise 'brique privée exécutable : %', f; end if;
  end loop;
end $$;

set role anon;
do $$ begin
  if pg_temp.herr($q$ select public.student_share_health_days('[]') $q$) not like 'permission denied%' then raise 'anon : envoi'; end if;
  if pg_temp.herr(format('select public.coach_student_health(%L)', pg_temp.hu('s'))) not like 'permission denied%' then raise 'anon : lecture'; end if;
  if pg_temp.herr($q$ select * from public.coach_shared_health_days $q$) not like 'permission denied%' then raise 'anon : table'; end if;
end $$;
reset role;

set role authenticated;

-- ── Par défaut : rien ; la donnée est annoncée ──────────
do $$
declare st jsonb;
begin
  perform pg_temp.hlogin('s');
  st := public.student_shares();
  if st -> 'shares' <> '{}'::jsonb or not (st -> 'kinds') ? 'health' then raise 'état par défaut : %', st; end if;
  if st -> 'kinds' is distinct from '["weight", "measures", "diet", "diet_log", "health"]'::jsonb then raise 'ordre des données annoncées : %', st -> 'kinds'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0))) <> 'not_shared' then raise 'envoi sans consentement'; end if;
  -- Un autre accord (suivi de la diète) ne vaut pas pour la santé
  perform public.student_set_share('diet_log', true);
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0))) <> 'not_shared' then raise 'accord de la diète pris pour la santé'; end if;
  perform public.student_set_share('diet_log', false);
  perform pg_temp.hlogin('k');
  if public.coach_student_health(pg_temp.hu('s')) is distinct from '{"shared": false, "since": null, "days": []}'::jsonb then raise 'coach sans consentement'; end if;
  perform pg_temp.hlogin('a');
  if pg_temp.herr($q$ select public.student_set_share('health', true) $q$) <> 'not_found' then raise 'cocher sans coach'; end if;
end $$;

-- ── Cocher, envoyer, lire ────────────────────────────────
do $$
declare st jsonb; r jsonb; g timestamptz;
begin
  perform pg_temp.hlogin('s');
  st := public.student_set_share('health', true);
  if st -> 'shares' -> 'health' ->> 'granted_at' is null or (st -> 'shares' -> 'health' ->> 'n')::int <> 0
     or st -> 'shares' -> 'health' ? 'last_at' and st -> 'shares' -> 'health' -> 'last_at' <> 'null'::jsonb then raise 'cocher : %', st; end if;
  g := (st -> 'shares' -> 'health' ->> 'granted_at')::timestamptz;
  -- Refus de forme et de bornes
  if pg_temp.hsend(null) <> 'invalid_data' then raise 'null'; end if;
  if pg_temp.hsend('{}') <> 'invalid_data' then raise 'objet au lieu d''une liste'; end if;
  if pg_temp.hsend('[5]') <> 'invalid_data' then raise 'élément nombre'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0, '{"steps": 100001}'))) <> 'invalid_data' then raise 'pas 100001'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0, '{"steps": -1}'))) <> 'invalid_data' then raise 'pas < 0'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0, '{"sleep": 1441}'))) <> 'invalid_data' then raise 'sommeil 1441'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0, '{"cardio": 1441}'))) <> 'invalid_data' then raise 'cardio 1441'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0, '{"steps": "8400"}'))) <> 'invalid_data' then raise 'pas en texte'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0, '{"sleep": true}'))) <> 'invalid_data' then raise 'sommeil booléen'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0, '{"sleep": 435.5}'))) <> 'invalid_data' then raise 'sommeil décimal'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0, '{"day": "2026-02-30"}'))) <> 'invalid_data' then raise 'date impossible'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0, '{"day": "25/11/2026"}'))) <> 'invalid_data' then raise 'date mal écrite'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0) - 'day')) <> 'invalid_data' then raise 'jour absent'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0, '{"steps": null, "sleep": null, "cardio": null}'))) <> 'invalid_data' then raise 'aucun des trois (null)'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0) - 'steps' - 'sleep' - 'cardio')) <> 'invalid_data' then raise 'aucun des trois (absents)'; end if;
  if pg_temp.hsend((select jsonb_agg(pg_temp.hday(i)) from generate_series(0, 92) i)) <> 'too_long' then raise '93 jours'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0, jsonb_build_object('x', repeat('a', 17000))))) <> 'too_long' then raise 'plus de 16 Ko'; end if;
  -- Rien d'écrit par les refus
  if (public.student_shares() -> 'shares' -> 'health' ->> 'n')::int <> 0 then raise 'refus écrit en base'; end if;
  -- 92 jours envoyés : seuls les 90 derniers sont gardés ; clés en trop jamais gardées
  if pg_temp.hsend((select jsonb_agg(pg_temp.hday(i, '{"secret": "fc"}')) from generate_series(0, 91) i)) <> '90' then raise '90 jours gardés'; end if;
  if (public.student_shares() -> 'shares' -> 'health' ->> 'n')::int <> 90 then raise '90 jours en base'; end if;
  reset role;
  if exists (select 1 from public.coach_shared_health_days where student_id = pg_temp.hu('s') and day < (now() at time zone 'utc')::date - 89) then
    raise 'jour trop vieux écrit'; end if;
  set local role authenticated;
  -- Repartir de zéro : décocher efface tout
  perform pg_temp.hlogin('s');
  perform public.student_set_share('health', false);
  st := public.student_set_share('health', true);
  g := (st -> 'shares' -> 'health' ->> 'granted_at')::timestamptz;
  if coalesce((public.student_shares() -> 'shares' -> 'health' ->> 'n')::int, 0) <> 0 then raise 'décocher : jours restés'; end if;
  -- Même jour deux fois : le dernier ; jour partiel (sommeil seul) accepté ; clé inconnue ignorée
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(1), pg_temp.hday(0, '{"steps": 100}'), pg_temp.hday(0, '{"x": 1}'),
       pg_temp.hday(2, '{"steps": null, "cardio": null}'))) <> '3' then raise 'envoi'; end if;
  st := public.student_shares();
  if (st -> 'shares' -> 'health' ->> 'n')::int <> 3
     or (st -> 'shares' -> 'health' ->> 'last_at')::bigint <> (extract(epoch from (now() at time zone 'utc')::date::timestamp) * 1000)::bigint then raise 'état après envoi : %', st; end if;
  -- L'élève ne lit pas par la fonction du coach
  if pg_temp.herr(format('select public.coach_student_health(%L)', pg_temp.hu('s'))) <> 'not_found' then raise 'élève lit par la fonction coach'; end if;
  -- Le coach consenti : les jours, du plus récent, en résumé (null retirés, jamais la clé inconnue)
  perform pg_temp.hlogin('k');
  r := public.coach_student_health(pg_temp.hu('s'));
  if not (r ->> 'shared')::boolean or (r ->> 'since')::timestamptz is distinct from g or jsonb_array_length(r -> 'days') <> 3 then raise 'lecture du coach : %', r; end if;
  if r -> 'days' -> 0 is distinct from pg_temp.hday(0) then raise 'jour lu : %', r -> 'days' -> 0; end if;
  if r::text like '%"x"%' or r::text like '%secret%' then raise 'clé inconnue gardée'; end if;
  if r -> 'days' -> 2 is distinct from jsonb_build_object('day', to_char((now() at time zone 'utc')::date - 2, 'YYYY-MM-DD'), 'sleep', 435) then
    raise 'jour partiel : %', r -> 'days' -> 2; end if;
  if (public.coach_student_health(pg_temp.hu('t')) ->> 'shared')::boolean then raise 'T partage sans avoir coché'; end if;
  -- Fiche Semaines : clé health = coach_student_health
  if public.coach_student_weeks(pg_temp.hu('s')) -> 'health' is distinct from r then raise 'coach_student_weeks : health différent'; end if;
  if public.coach_student_weeks(pg_temp.hu('t')) -> 'health' is distinct from '{"shared": false, "since": null, "days": []}'::jsonb then raise 'coach_student_weeks : T'; end if;
  -- Les autres partages ne bougent pas
  if public.coach_student_weights(pg_temp.hu('s')) -> 'weights' <> '[]'::jsonb then raise 'santé dans le poids'; end if;
end $$;
reset role;

-- ── Fusion jour par jour, et un jour trop vieux resté en base (appareil hors ligne) supprimé à l'envoi ──
insert into public.coach_shared_health_days (student_id, day, steps) values (pg_temp.hu('s'), (now() at time zone 'utc')::date - 120, 5000);
set role authenticated;
do $$
begin
  perform pg_temp.hlogin('k');
  if exists (select 1 from jsonb_array_elements(public.coach_student_health(pg_temp.hu('s')) -> 'days') x
             where x ->> 'day' = to_char((now() at time zone 'utc')::date - 120, 'YYYY-MM-DD')) then raise 'jour trop vieux lu'; end if;
  perform pg_temp.hlogin('s');
  -- Un envoi d'un seul jour n'efface pas les autres ; le même jour est remplacé, pas ajouté
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(5, '{"steps": 7000}'))) <> '4' then raise 'fusion : les autres jours doivent rester'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(5, '{"steps": 7500, "cardio": null}'))) <> '4' then raise 'fusion : même jour remplacé'; end if;
  perform pg_temp.hlogin('k');
  if (select x from jsonb_array_elements(public.coach_student_health(pg_temp.hu('s')) -> 'days') x
      where x ->> 'day' = to_char((now() at time zone 'utc')::date - 5, 'YYYY-MM-DD'))
     is distinct from jsonb_build_object('day', to_char((now() at time zone 'utc')::date - 5, 'YYYY-MM-DD'), 'steps', 7500, 'sleep', 435) then
    raise 'fusion : dernière valeur du jour (cardio effacé)'; end if;
  if pg_temp.herr(format('select public.coach_student_health(%L)', pg_temp.hu('s'))) <> 'ok' then raise 'lecture'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.coach_shared_health_days where day < (now() at time zone 'utc')::date - 89) then raise 'vieux jour gardé après envoi'; end if;
  delete from public.coach_shared_health_days where student_id = pg_temp.hu('s') and day = (now() at time zone 'utc')::date - 5;
end $$;
set role authenticated;

-- ── Personne d'autre ne lit ──────────────────────────────
do $$ begin
  perform pg_temp.hlogin('l');
  if pg_temp.herr(format('select public.coach_student_health(%L)', pg_temp.hu('s'))) <> 'not_found' then raise 'autre coach'; end if;
  if pg_temp.herr(format('select public.coach_student_weeks(%L)', pg_temp.hu('s'))) <> 'not_found' then raise 'autre coach : semaines'; end if;
  perform pg_temp.hlogin('a');
  if pg_temp.herr(format('select public.coach_student_health(%L)', pg_temp.hu('s'))) <> 'not_found' then raise 'ami'; end if;
  if pg_temp.herr($q$ select * from public.coach_shared_health_days $q$) not like 'permission denied%' then raise 'ami : table'; end if;
  perform pg_temp.hlogin('t');
  if pg_temp.herr(format('select public.coach_student_health(%L)', pg_temp.hu('s'))) <> 'not_found' then raise 'autre élève'; end if;
  perform pg_temp.hlogin('k');
  if pg_temp.herr(format('select public.coach_student_health(%L)', pg_temp.hu('a'))) <> 'not_found' then raise 'non-élève'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  if pg_temp.herr(format('select public.coach_student_health(%L)', pg_temp.hu('s'))) <> 'not_found' then raise 'sans compte'; end if;
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0))) <> 'not_shared' then raise 'envoi sans compte'; end if;
end $$;

-- ── 90 jours glissants : un jour vieilli n'est plus rendu, puis effacé au prochain envoi ──
do $$ begin
  reset role;
  update public.coach_shared_health_days set day = (now() at time zone 'utc')::date - 90
    where student_id = pg_temp.hu('s') and day = (now() at time zone 'utc')::date - 2;
  set local role authenticated;
  perform pg_temp.hlogin('k');
  if jsonb_array_length(public.coach_student_health(pg_temp.hu('s')) -> 'days') <> 2 then raise 'jour de plus de 90 jours rendu au coach'; end if;
  perform pg_temp.hlogin('s');
  perform public.student_share_health_days(jsonb_build_array(pg_temp.hday(0)));
  reset role;
  if exists (select 1 from public.coach_shared_health_days where day < (now() at time zone 'utc')::date - 89) then raise 'jour de plus de 90 jours gardé'; end if;
end $$;
reset role;
set role authenticated;

-- ── Décocher : tout est effacé, les autres accords restent ──
do $$
declare st jsonb;
begin
  perform pg_temp.hlogin('s');
  perform public.student_set_share('weight', true);
  st := public.student_set_share('health', false);
  if st -> 'shares' ? 'health' or not (st -> 'shares' ? 'weight') then raise 'décocher : %', st; end if;
  reset role;
  if exists (select 1 from public.coach_shared_health_days where student_id = pg_temp.hu('s')) then raise 'jours gardés après retrait'; end if;
  set local role authenticated;
  perform pg_temp.hlogin('s');
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0))) <> 'not_shared' then raise 'envoi après retrait'; end if;
  perform pg_temp.hlogin('k');
  if public.coach_student_health(pg_temp.hu('s')) is distinct from '{"shared": false, "since": null, "days": []}'::jsonb then raise 'coach après retrait'; end if;
  -- Retirer le poids n'efface pas la santé
  perform pg_temp.hlogin('s');
  perform public.student_set_share('health', true);
  perform public.student_share_health_days(jsonb_build_array(pg_temp.hday(0)));
  perform public.student_set_share('weight', false);
  reset role;
  if not exists (select 1 from public.coach_shared_health_days where student_id = pg_temp.hu('s')) then raise 'retirer le poids a effacé la santé'; end if;
end $$;
reset role;

-- ── Quitter, être retiré, rôle retiré, limites, compte supprimé ──
do $$ begin
  set local role authenticated;
  perform pg_temp.hlogin('s');
  perform public.coach_leave();
  reset role;
  if exists (select 1 from public.coach_shared_health_days where student_id = pg_temp.hu('s')) or exists (select 1 from public.coach_shares where student_id = pg_temp.hu('s'))
    then raise 'quitter garde le partage'; end if;
  insert into public.coach_links (student_id, coach_id) values (pg_temp.hu('s'), pg_temp.hu('l'));
  set local role authenticated;
  perform pg_temp.hlogin('s');
  if public.student_shares() -> 'shares' <> '{}'::jsonb then raise 'partage repris chez le nouveau coach'; end if;
  perform public.student_set_share('health', true);
  perform public.student_share_health_days(jsonb_build_array(pg_temp.hday(0)));
  -- L'ex-coach (K) ne lit plus S
  perform pg_temp.hlogin('k');
  if pg_temp.herr(format('select public.coach_student_health(%L)', pg_temp.hu('s'))) <> 'not_found' then raise 'ancien coach lit'; end if;
  perform pg_temp.hlogin('l');
  perform public.coach_remove_student(pg_temp.hu('s'));
  reset role;
  if exists (select 1 from public.coach_shared_health_days where student_id = pg_temp.hu('s')) then raise 'retrait garde les jours'; end if;
  -- Rôle retiré : plus de lecture
  set local role authenticated;
  perform pg_temp.hlogin('t');
  perform public.student_set_share('health', true);
  perform public.student_share_health_days(jsonb_build_array(pg_temp.hday(0)));
  reset role;
  update public.user_profiles set coach_at = null where user_id = pg_temp.hu('k');
  set local role authenticated;
  perform pg_temp.hlogin('k');
  if pg_temp.herr(format('select public.coach_student_health(%L)', pg_temp.hu('t'))) <> 'not_found' then raise 'ex-coach lit'; end if;
  reset role;
  update public.user_profiles set coach_at = now() where user_id = pg_temp.hu('k');
  -- 120 envois par heure ; décocher jamais limité
  insert into private.social_rate (user_id, action) select pg_temp.hu('t'), 'coach_share_health' from generate_series(1, 120);
  set local role authenticated;
  perform pg_temp.hlogin('t');
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0))) <> 'rate_limited' then raise 'limite des envois'; end if;
  if pg_temp.herr($q$ select public.student_set_share('health', false) $q$) <> 'ok' then raise 'décocher limité'; end if;
  perform public.student_set_share('health', true);
  reset role;
  delete from private.social_rate where user_id = pg_temp.hu('t') and action = 'coach_share_health';
  set local role authenticated;
  perform pg_temp.hlogin('t');
  if pg_temp.hsend(jsonb_build_array(pg_temp.hday(0))) <> '1' then raise 'envoi après la limite'; end if;
  reset role;
  delete from auth.users where id = pg_temp.hu('t');
  if exists (select 1 from public.coach_shares where student_id = pg_temp.hu('t')) or exists (select 1 from public.coach_shared_health_days where student_id = pg_temp.hu('t'))
    then raise 'cascade élève'; end if;
end $$;
reset role;

-- ── Bilans : le suivi Sommeil en heures par nuit (mêmes règles que js/data/checkins.js) ──
do $$
declare
  h jsonb := '{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "number", "required": false, "unit": "h"}';
  sc jsonb := '{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}';
begin
  if not private.checkin_item_ok(h) then raise 'suivi Sommeil en heures refusé'; end if;
  if not private.checkin_item_ok(sc) then raise 'suivi Sommeil en échelle refusé'; end if;
  if private.checkin_item_ok(h || '{"unit": "min"}') then raise 'Sommeil en nombre avec une autre unité accepté'; end if;
  if private.checkin_item_ok(h - 'unit') then raise 'Sommeil en nombre sans unité accepté'; end if;
  if private.checkin_item_ok(h || '{"scale": 5}') then raise 'Sommeil en nombre avec une échelle accepté'; end if;
  if private.checkin_item_ok(h || '{"type": "text"}') then raise 'Sommeil en texte accepté'; end if;
  if private.checkin_item_clean('{"kind": "sleep", "type": "number"}') is distinct from h then raise 'nettoyage du suivi en heures : %', private.checkin_item_clean('{"kind": "sleep", "type": "number"}'); end if;
  if not private.checkin_value_ok(h, '7.25') then raise '7.25 h refusé'; end if;
  if not private.checkin_value_ok(h, '0') or not private.checkin_value_ok(h, '24') then raise 'bornes 0 et 24 refusées'; end if;
  if private.checkin_value_ok(h, '24.5') then raise '24.5 h accepté'; end if;
  if private.checkin_value_ok(h, '-1') then raise '-1 h accepté'; end if;
  if private.checkin_value_ok(h, '"7"') then raise '7 en texte accepté'; end if;
  if private.checkin_value_ok(h, '7.255') then raise '7.255 (non arrondi) accepté'; end if;
  if not private.checkin_value_ok(sc, '4') or private.checkin_value_ok(sc, '7.25') then raise 'échelle du sommeil changée'; end if;
  -- Les autres unités ne bougent pas
  if private.checkin_number('301', 'kg') is not null or private.checkin_number('8900.6', 'steps') <> 8901 then raise 'autres unités changées'; end if;
end $$;

delete from auth.users where id in (select pg_temp.hu(c) from unnest(array['k', 'l', 's', 'a']) c);
delete from private.social_rate where user_id in (select pg_temp.hu(c) from unnest(array['k', 'l', 's', 't', 'a']) c);
