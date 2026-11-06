-- Vérifications de supabase/migrations/20261105010000_partage_mensurations.sql (lancées par tests/sql/run.sh) :
-- consentement « measures » par élève et par coach, mensurations séparées des séances, lecture par le seul
-- coach consenti, effacement au retrait. Le partage du poids ne change pas. Chaque bloc échoue (raise) si
-- la règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.mu('k') → …0000000000f1, l → f2, s → f3, t → f4, a → f5) : K kim.m1 et L lea.m1
-- sont coachs ; S sol.m1 et T tom.m1 sont élèves de K ; A ami.m1 (ni coach ni élève).

create function pg_temp.merr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.mu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000000f' || translate(c, 'klsta', '12345'))::uuid $$;
create function pg_temp.mlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.mu(c)::text, ''), false) $$;
-- Envoi : renvoie le nombre gardé, ou l'erreur
create function pg_temp.msend(m jsonb) returns text language plpgsql as
$$ begin return public.student_share_measures(m)::text; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.merr(text), pg_temp.mu(text), pg_temp.mlogin(text), pg_temp.msend(jsonb) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.mu(c) from unnest(array['k', 'l', 's', 't', 'a']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.mu('k'), 'kim.m1', '🦁'), (pg_temp.mu('l'), 'lea.m1', '🦊'), (pg_temp.mu('s'), 'sol.m1', '🦅'),
  (pg_temp.mu('t'), 'tom.m1', '🐼'), (pg_temp.mu('a'), 'ami.m1', '⭐');
update public.user_profiles set coach_at = now() where user_id in (pg_temp.mu('k'), pg_temp.mu('l'));
insert into public.coach_links (student_id, coach_id) values (pg_temp.mu('s'), pg_temp.mu('k')), (pg_temp.mu('t'), pg_temp.mu('k'));

-- ── Droits ───────────────────────────────────────────────
do $$
declare f text;
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.coach_shared_measures'::regclass) then raise 'RLS désactivée'; end if;
  if exists (select 1 from pg_policies where tablename = 'coach_shared_measures') then raise 'politique inattendue'; end if;
  foreach f in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(f, 'public.coach_shared_measures', 'select') or has_table_privilege(f, 'public.coach_shared_measures', 'insert')
       or has_table_privilege(f, 'public.coach_shared_measures', 'update') or has_table_privilege(f, 'public.coach_shared_measures', 'delete') then
      raise 'droit direct sur les mensurations pour %', f; end if;
  end loop;
  foreach f in array array['public.student_share_measures(jsonb)', 'public.coach_student_measures(uuid)', 'public.student_shares()'] loop
    if has_function_privilege('anon', f, 'execute') then raise 'anon exécute %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise 'authenticated n''exécute pas %', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure) then raise 'security definer / search_path : %', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'private.share_kind_open(text)', 'execute') then raise 'brique privée exécutable'; end if;
end $$;

set role anon;
do $$ begin
  if pg_temp.merr($q$ select public.student_share_measures('{}') $q$) not like 'permission denied%' then raise 'anon : envoi'; end if;
  if pg_temp.merr(format('select public.coach_student_measures(%L)', pg_temp.mu('s'))) not like 'permission denied%' then raise 'anon : lecture'; end if;
  if pg_temp.merr($q$ select * from public.coach_shared_measures $q$) not like 'permission denied%' then raise 'anon : table'; end if;
end $$;
reset role;

set role authenticated;

-- ── Par défaut : rien ; la donnée est annoncée par le serveur ──
do $$
declare st jsonb;
begin
  perform pg_temp.mlogin('s');
  st := public.student_shares();
  -- kinds : poids et mensurations en tête ; d'autres données ouvertes plus tard s'ajoutent après (plans diète, 20261106200000)
  if (st - 'kinds') is distinct from '{"coach": true, "shares": {}}'::jsonb
     or jsonb_path_query_array(st -> 'kinds', '$[0 to 1]') is distinct from '["weight", "measures"]'::jsonb then raise 'état par défaut : %', st; end if;
  if pg_temp.msend('{"waist": [{"date": 1780000000000, "cm": 80}]}') <> 'not_shared' then raise 'envoi sans consentement'; end if;
  -- Poids coché : ne vaut pas pour les mensurations
  perform public.student_set_share('weight', true);
  if pg_temp.msend('{"waist": [{"date": 1780000000000, "cm": 80}]}') <> 'not_shared' then raise 'consentement poids pris pour les mensurations'; end if;
  perform pg_temp.mlogin('k');
  if public.coach_student_measures(pg_temp.mu('s')) is distinct from '{"shared": false, "since": null, "measures": {}}'::jsonb then raise 'coach sans consentement'; end if;
  perform pg_temp.mlogin('a');
  if pg_temp.merr($q$ select public.student_set_share('measures', true) $q$) <> 'not_found' then raise 'cocher sans coach'; end if;
end $$;

-- ── Cocher, envoyer, lire ────────────────────────────────
do $$
declare st jsonb; m jsonb; g timestamptz;
begin
  perform pg_temp.mlogin('s');
  st := public.student_set_share('measures', true);
  if st -> 'shares' -> 'measures' ->> 'granted_at' is null or (st -> 'shares' -> 'measures' ->> 'n')::int <> 0 or not (st -> 'shares' ? 'weight') then raise 'cocher : %', st; end if;
  g := (st -> 'shares' -> 'measures' ->> 'granted_at')::timestamptz;
  -- Listes refusées
  if pg_temp.msend(null) <> 'invalid_data' then raise 'null'; end if;
  if pg_temp.msend('[]') <> 'invalid_data' then raise 'liste au lieu d''un objet'; end if;
  if pg_temp.msend('{"biceps": []}') <> 'invalid_data' then raise 'mesure inconnue'; end if;
  if pg_temp.msend('{"waist": {"date": 1}}') <> 'invalid_data' then raise 'valeur pas une liste'; end if;
  if pg_temp.msend('{"waist": [5]}') <> 'invalid_data' then raise 'élément nombre'; end if;
  if pg_temp.msend('{"waist": [{"date": "1780000000000", "cm": 80}]}') <> 'invalid_data' then raise 'date texte'; end if;
  if pg_temp.msend('{"waist": [{"date": 1780000000000, "cm": "80"}]}') <> 'invalid_data' then raise 'cm texte'; end if;
  if pg_temp.msend('{"waist": [{"date": 1780000000000.5, "cm": 80}]}') <> 'invalid_data' then raise 'date non entière'; end if;
  if pg_temp.msend('{"waist": [{"date": 1780000000000, "cm": 9.9}]}') <> 'invalid_data' then raise 'cm < 10'; end if;
  if pg_temp.msend('{"waist": [{"date": 1780000000000, "cm": 250.1}]}') <> 'invalid_data' then raise 'cm > 250'; end if;
  if pg_temp.msend('{"waist": [{"date": 900000000000, "cm": 80}]}') <> 'invalid_data' then raise 'avant 2000'; end if;
  if pg_temp.msend(jsonb_build_object('waist', jsonb_build_array(jsonb_build_object('date', (extract(epoch from now()) * 1000)::bigint + 3 * 86400000, 'cm', 80)))) <> 'invalid_data' then raise 'futur'; end if;
  if pg_temp.msend(jsonb_build_object('waist', (select jsonb_agg(jsonb_build_object('date', 1700000000000 + i * 86400000::bigint, 'cm', 80)) from generate_series(1, 401) i))) <> 'too_long' then raise '401 valeurs'; end if;
  if pg_temp.msend((select jsonb_object_agg(k, (select jsonb_agg(jsonb_build_object('date', 1700000000000 + i * 86400000::bigint, 'cm', 80)) from generate_series(1, 400) i))
                    from unnest(array['chest', 'waist', 'hips', 'shoulders', 'neck', 'armL', 'armR', 'thighL', 'thighR', 'calf']) k)) <> '4000' then raise '4000 en tout : accepté'; end if;
  if pg_temp.msend(jsonb_build_object('waist', jsonb_build_array(jsonb_build_object('date', 1780000000000, 'cm', 80, 'x', repeat('a', 270000))))) <> 'too_long' then raise 'plus de 256 Ko'; end if;
  -- La vraie liste (remplace tout) ; clés en trop ignorées ; même instant : la dernière
  if pg_temp.msend('{"waist": [{"date": 1780800000000, "cm": 79.46, "note": "secret"}, {"date": 1779900000000, "cm": 81}, {"date": 1779900000000, "cm": 80.5}],
                     "armL": [{"date": 1780800000000, "cm": 36}], "chest": []}') <> '3' then raise 'envoi'; end if;
  st := public.student_shares();
  if (st -> 'shares' -> 'measures' ->> 'n')::int <> 3 or (st -> 'shares' -> 'measures' ->> 'last_at')::bigint <> 1780800000000
     or (st -> 'shares' -> 'weight' ->> 'n')::int <> 0 then raise 'état après envoi : %', st; end if;
  -- L'élève ne lit pas par la fonction du coach
  if pg_temp.merr(format('select public.coach_student_measures(%L)', pg_temp.mu('s'))) <> 'not_found' then raise 'élève lit par la fonction coach'; end if;
  -- Le coach consenti
  perform pg_temp.mlogin('k');
  m := public.coach_student_measures(pg_temp.mu('s'));
  if m -> 'measures' is distinct from '{"waist": [{"cm": 79.5, "date": 1780800000000}, {"cm": 80.5, "date": 1779900000000}], "armL": [{"cm": 36.0, "date": 1780800000000}]}'::jsonb
     or not (m ->> 'shared')::boolean or (m ->> 'since')::timestamptz is distinct from g then raise 'lecture du coach : %', m; end if;
  -- T ne partage rien
  if (public.coach_student_measures(pg_temp.mu('t')) ->> 'shared')::boolean then raise 'T partage sans avoir coché'; end if;
  -- Poids inchangé : rien de mélangé
  if public.coach_student_weights(pg_temp.mu('s')) -> 'weights' <> '[]'::jsonb then raise 'mensurations dans le poids'; end if;
end $$;

-- ── Personne d'autre ne lit ──────────────────────────────
do $$ begin
  perform pg_temp.mlogin('l');
  if pg_temp.merr(format('select public.coach_student_measures(%L)', pg_temp.mu('s'))) <> 'not_found' then raise 'autre coach'; end if;
  perform pg_temp.mlogin('a');
  if pg_temp.merr(format('select public.coach_student_measures(%L)', pg_temp.mu('s'))) <> 'not_found' then raise 'ami'; end if;
  if pg_temp.merr($q$ select * from public.coach_shared_measures $q$) not like 'permission denied%' then raise 'ami : table'; end if;
  perform pg_temp.mlogin('t');
  if pg_temp.merr(format('select public.coach_student_measures(%L)', pg_temp.mu('s'))) <> 'not_found' then raise 'autre élève'; end if;
  if public.student_shares() -> 'shares' <> '{}'::jsonb then raise 'T voit le partage de S'; end if;
end $$;

-- ── Décocher : tout est effacé, le poids reste ───────────
do $$
declare st jsonb;
begin
  perform pg_temp.mlogin('s');
  perform public.student_share_weights('[{"date": 1780000000000, "kg": 80}]');
  st := public.student_set_share('measures', false);
  if st -> 'shares' ? 'measures' or not (st -> 'shares' ? 'weight') then raise 'décocher : %', st; end if;
  reset role;
  if exists (select 1 from public.coach_shared_measures where student_id = pg_temp.mu('s')) then raise 'mensurations gardées après retrait'; end if;
  if not exists (select 1 from public.coach_shared_weights where student_id = pg_temp.mu('s')) then raise 'décocher les mensurations a effacé le poids'; end if;
  set role authenticated;
  perform pg_temp.mlogin('s');
  if pg_temp.msend('{"waist": [{"date": 1780000000000, "cm": 80}]}') <> 'not_shared' then raise 'envoi après retrait'; end if;
  perform pg_temp.mlogin('k');
  if public.coach_student_measures(pg_temp.mu('s')) is distinct from '{"shared": false, "since": null, "measures": {}}'::jsonb then raise 'coach après retrait'; end if;
  -- Décocher le poids n'efface pas les mensurations
  perform pg_temp.mlogin('s');
  perform public.student_set_share('measures', true);
  perform public.student_share_measures('{"waist": [{"date": 1780000000000, "cm": 80}]}');
  perform public.student_set_share('weight', false);
  reset role;
  if not exists (select 1 from public.coach_shared_measures where student_id = pg_temp.mu('s')) then raise 'décocher le poids a effacé les mensurations'; end if;
end $$;
reset role;

-- ── Quitter, être retiré, rôle retiré, compte supprimé ──
do $$ begin
  set local role authenticated;
  perform pg_temp.mlogin('s');
  perform public.coach_leave();
  reset role;
  if exists (select 1 from public.coach_shared_measures where student_id = pg_temp.mu('s')) or exists (select 1 from public.coach_shares where student_id = pg_temp.mu('s'))
    then raise 'quitter garde le partage'; end if;
  insert into public.coach_links (student_id, coach_id) values (pg_temp.mu('s'), pg_temp.mu('l'));
  set local role authenticated;
  perform pg_temp.mlogin('s');
  if public.student_shares() -> 'shares' <> '{}'::jsonb then raise 'partage repris chez le nouveau coach'; end if;
  perform public.student_set_share('measures', true);
  perform public.student_share_measures('{"calf": [{"date": 1780000000000, "cm": 38}]}');
  perform pg_temp.mlogin('l');
  perform public.coach_remove_student(pg_temp.mu('s'));
  reset role;
  if exists (select 1 from public.coach_shared_measures where student_id = pg_temp.mu('s')) then raise 'retrait garde les mensurations'; end if;
  -- Rôle retiré : plus de lecture
  set local role authenticated;
  perform pg_temp.mlogin('t');
  perform public.student_set_share('measures', true);
  perform public.student_share_measures('{"calf": [{"date": 1780000000000, "cm": 38}]}');
  reset role;
  update public.user_profiles set coach_at = null where user_id = pg_temp.mu('k');
  set local role authenticated;
  perform pg_temp.mlogin('k');
  if pg_temp.merr(format('select public.coach_student_measures(%L)', pg_temp.mu('t'))) <> 'not_found' then raise 'ex-coach lit'; end if;
  reset role;
  update public.user_profiles set coach_at = now() where user_id = pg_temp.mu('k');
  -- 60 envois par heure
  insert into private.social_rate (user_id, action) select pg_temp.mu('t'), 'coach_share_mup' from generate_series(1, 60);
  set local role authenticated;
  perform pg_temp.mlogin('t');
  if pg_temp.msend('{"calf": [{"date": 1780000000000, "cm": 38}]}') <> 'rate_limited' then raise 'limite des envois'; end if;
  if pg_temp.merr($q$ select public.student_set_share('measures', false) $q$) <> 'ok' then raise 'décocher limité'; end if;
  perform public.student_set_share('measures', true);
  reset role;
  delete from private.social_rate where user_id = pg_temp.mu('t') and action = 'coach_share_mup';
  set local role authenticated;
  perform pg_temp.mlogin('t');
  perform public.student_share_measures('{"calf": [{"date": 1780000000000, "cm": 38}]}');
  reset role;
  delete from auth.users where id = pg_temp.mu('t');
  if exists (select 1 from public.coach_shares where student_id = pg_temp.mu('t')) or exists (select 1 from public.coach_shared_measures where student_id = pg_temp.mu('t'))
    then raise 'cascade élève'; end if;
end $$;
reset role;
delete from auth.users where id in (select pg_temp.mu(c) from unnest(array['k', 'l', 's', 'a']) c);
delete from private.social_rate where user_id in (select pg_temp.mu(c) from unnest(array['k', 'l', 's', 't', 'a']) c);
