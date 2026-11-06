-- Vérifications de supabase/migrations/20261031300000_partage_coach.sql (lancées par tests/sql/run.sh) :
-- consentement par élève et par coach, pesées séparées des séances, lecture par le seul coach consenti,
-- effacement au retrait. Chaque bloc échoue (raise) si la règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.pu('k') → …00000000070a, l → b, s → c, t → d, a → e) : K kim.p1 et L lea.p1
-- sont coachs ; S sol.p1 et T tom.p1 sont élèves de K ; A ami.p1 (ami de S, ni coach ni élève).

create function pg_temp.perr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.pu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000070' || translate(c, 'klsta', 'abcde'))::uuid $$;
create function pg_temp.plogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.pu(c)::text, ''), false) $$;
grant execute on function pg_temp.perr(text), pg_temp.pu(text), pg_temp.plogin(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.pu(c) from unnest(array['k', 'l', 's', 't', 'a']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.pu('k'), 'kim.p1', '🦁'), (pg_temp.pu('l'), 'lea.p1', '🦊'), (pg_temp.pu('s'), 'sol.p1', '🦅'),
  (pg_temp.pu('t'), 'tom.p1', '🐼'), (pg_temp.pu('a'), 'ami.p1', '⭐');
update public.user_profiles set coach_at = now() where user_id in (pg_temp.pu('k'), pg_temp.pu('l'));
insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('s'), pg_temp.pu('k')), (pg_temp.pu('t'), pg_temp.pu('k'));

-- ── Droits : aucune table lisible, anon n'exécute rien ───
do $$
declare f text;
begin
  -- Tables : RLS activée, aucune politique, aucun droit pour les rôles de l'API
  if exists (select 1 from pg_class c where c.relname in ('coach_shares', 'coach_shared_weights') and c.relnamespace = 'public'::regnamespace and not c.relrowsecurity) then raise 'RLS désactivée'; end if;
  if exists (select 1 from pg_policies where tablename in ('coach_shares', 'coach_shared_weights')) then raise 'politique inattendue'; end if;
  foreach f in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(f, 'public.coach_shares', 'select') or has_table_privilege(f, 'public.coach_shared_weights', 'select')
       or has_table_privilege(f, 'public.coach_shares', 'insert') or has_table_privilege(f, 'public.coach_shared_weights', 'insert')
       or has_table_privilege(f, 'public.coach_shares', 'delete') or has_table_privilege(f, 'public.coach_shared_weights', 'update') then
      raise 'droit direct sur les tables du partage pour %', f; end if;
  end loop;
  -- RPC : authenticated seulement ; briques privées : personne
  foreach f in array array['public.student_shares()', 'public.student_set_share(text, boolean)', 'public.student_share_weights(jsonb)',
                           'public.coach_student_weights(uuid)', 'public.coach_student_sessions(uuid, bigint, text)'] loop
    if has_function_privilege('anon', f, 'execute') then raise 'anon exécute %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise 'authenticated n''exécute pas %', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure) then raise 'security definer / search_path : %', f; end if;
  end loop;
  foreach f in array array['private.share_kind_open(text)', 'private.coach_has_share(uuid, uuid, text)', 'private.coach_session_body(uuid, uuid, bigint)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise 'brique privée exécutable : %', f; end if;
  end loop;
end $$;

set role anon;
do $$ begin
  if pg_temp.perr($q$ select public.student_shares() $q$) not like 'permission denied%' then raise 'anon : student_shares'; end if;
  if pg_temp.perr($q$ select public.student_set_share('weight', true) $q$) not like 'permission denied%' then raise 'anon : student_set_share'; end if;
  if pg_temp.perr($q$ select public.student_share_weights('[]') $q$) not like 'permission denied%' then raise 'anon : student_share_weights'; end if;
  if pg_temp.perr(format('select public.coach_student_weights(%L)', pg_temp.pu('s'))) not like 'permission denied%' then raise 'anon : coach_student_weights'; end if;
  if pg_temp.perr($q$ select * from public.coach_shared_weights $q$) not like 'permission denied%' then raise 'anon : table des pesées'; end if;
end $$;
reset role;

set role authenticated;

-- ── Séances de S (le poids n'y est jamais : il est retiré par l'app avant l'envoi) ──
do $$ begin
  perform pg_temp.plogin('s');
  insert into public.sessions (id, data) values
    ('p-1', '{"date": 1780000000000, "category": "pull", "label": "Pull", "exercises": [{"name": "Tractions", "measure": "reps", "sets": [{"weight": "", "reps": "10"}]}]}'),
    ('p-2', '{"date": 1780900000000, "category": "pull", "label": "Pull", "exercises": []}'),
    ('p-0', '{"date": 1770000000000, "category": "push", "label": "Push", "exercises": []}'),
    -- Une vieille app aurait-elle envoyé bodyKg dans data : jamais montré, ni au coach ni aux amis
    ('p-vieux', '{"date": 1779000000000, "bodyKg": 99, "exercises": []}');
end $$;

-- ── Par défaut : rien n'est partagé ──────────────────────
do $$
declare st jsonb; r record;
begin
  perform pg_temp.plogin('s');
  -- kinds (données que le serveur accepte) : ajouté par 20261105010000_partage_mensurations.sql
  st := public.student_shares() - 'kinds';
  if st is distinct from '{"coach": true, "shares": {}}'::jsonb then raise 'état par défaut : %', st; end if;
  -- Envoyer sans avoir coché : refusé
  if pg_temp.perr($q$ select public.student_share_weights('[{"date": 1780000000000, "kg": 80}]') $q$) is distinct from 'not_shared' then raise 'envoi sans consentement'; end if;
  -- Le coach : pas partagé, et aucune séance avec bodyKg
  perform pg_temp.plogin('k');
  if public.coach_student_weights(pg_temp.pu('s')) is distinct from '{"shared": false, "since": null, "weights": []}'::jsonb then raise 'coach sans consentement : %', public.coach_student_weights(pg_temp.pu('s')); end if;
  for r in select * from public.coach_student_sessions(pg_temp.pu('s')) loop
    if r.s ? 'bodyKg' then raise 'bodyKg sans consentement : %', r; end if;
  end loop;
  -- Données pas encore ouvertes, ou inconnues : refusées
  perform pg_temp.plogin('s');
  if pg_temp.perr($q$ select public.student_set_share('sleep', true) $q$) is distinct from 'invalid_kind' then raise 'sommeil ouvert trop tôt'; end if;
  if pg_temp.perr($q$ select public.student_set_share('steps', true) $q$) is distinct from 'invalid_kind' then raise 'pas ouverts trop tôt'; end if;
  if pg_temp.perr($q$ select public.student_set_share('resting_hr', true) $q$) is distinct from 'invalid_kind' then raise 'FC ouverte trop tôt'; end if;
  if pg_temp.perr($q$ select public.student_set_share('photos', true) $q$) is distinct from 'invalid_kind' then raise 'donnée inconnue'; end if;
  if pg_temp.perr($q$ select public.student_set_share(null, true) $q$) is distinct from 'invalid_kind' then raise 'kind null'; end if;
  if pg_temp.perr($q$ select public.student_set_share('weight', null) $q$) is distinct from 'invalid_kind' then raise 'enabled null'; end if;
  -- Sans coach : not_found
  perform pg_temp.plogin('a');
  if pg_temp.perr($q$ select public.student_set_share('weight', true) $q$) is distinct from 'not_found' then raise 'cocher sans coach'; end if;
  if public.student_shares() - 'kinds' is distinct from '{"coach": false, "shares": {}}'::jsonb then raise 'état sans coach'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  if pg_temp.perr($q$ select public.student_set_share('weight', true) $q$) is distinct from 'not_found' then raise 'sans utilisateur'; end if;
  if pg_temp.perr($q$ select public.student_share_weights('[]') $q$) is distinct from 'not_shared' then raise 'envoi sans utilisateur'; end if;
end $$;

-- ── Cocher, envoyer, lire ────────────────────────────────
do $$
declare st jsonb; w jsonb; r record; g timestamptz;
begin
  perform pg_temp.plogin('s');
  st := public.student_set_share('weight', true);
  if st -> 'shares' -> 'weight' ->> 'granted_at' is null or (st -> 'shares' -> 'weight' ->> 'n')::int is distinct from 0 then raise 'cocher : %', st; end if;
  g := (st -> 'shares' -> 'weight' ->> 'granted_at')::timestamptz;
  -- Recocher garde la date d'origine (horodatage du consentement)
  perform pg_sleep(0.01);
  if (public.student_set_share('weight', true) -> 'shares' -> 'weight' ->> 'granted_at')::timestamptz is distinct from g then raise 'date du consentement changée'; end if;
  reset role;
  if (select count(*) from public.coach_shares where student_id = pg_temp.pu('s') and coach_id = pg_temp.pu('k') and kind = 'weight') is distinct from 1::bigint then raise 'consentement stocké'; end if;
  set role authenticated;
  perform pg_temp.plogin('s');
  -- Listes refusées : pas une liste, élément mal formé, borne, futur, trop longue
  if pg_temp.perr($q$ select public.student_share_weights('{"date": 1}') $q$) is distinct from 'invalid_data' then raise 'objet au lieu d''une liste'; end if;
  if pg_temp.perr($q$ select public.student_share_weights(null) $q$) is distinct from 'invalid_data' then raise 'null'; end if;
  if pg_temp.perr($q$ select public.student_share_weights('[5]') $q$) is distinct from 'invalid_data' then raise 'élément nombre'; end if;
  if pg_temp.perr($q$ select public.student_share_weights('[{"date": "1780000000000", "kg": 80}]') $q$) is distinct from 'invalid_data' then raise 'date texte'; end if;
  if pg_temp.perr($q$ select public.student_share_weights('[{"date": 1780000000000, "kg": "80"}]') $q$) is distinct from 'invalid_data' then raise 'kg texte'; end if;
  if pg_temp.perr($q$ select public.student_share_weights('[{"date": 1780000000000.5, "kg": 80}]') $q$) is distinct from 'invalid_data' then raise 'date non entière'; end if;
  if pg_temp.perr($q$ select public.student_share_weights('[{"date": 1780000000000, "kg": 24.9}]') $q$) is distinct from 'invalid_data' then raise 'kg < 25'; end if;
  if pg_temp.perr($q$ select public.student_share_weights('[{"date": 1780000000000, "kg": 300.5}]') $q$) is distinct from 'invalid_data' then raise 'kg > 300'; end if;
  if pg_temp.perr($q$ select public.student_share_weights('[{"date": 900000000000, "kg": 80}]') $q$) is distinct from 'invalid_data' then raise 'date avant 2000'; end if;
  if pg_temp.perr(format('select public.student_share_weights(%L)', jsonb_build_array(jsonb_build_object('date', (extract(epoch from now()) * 1000)::bigint + 3 * 86400000, 'kg', 80)))) is distinct from 'invalid_data' then raise 'date future'; end if;
  if pg_temp.perr(format('select public.student_share_weights(%L)', (select jsonb_agg(jsonb_build_object('date', 1700000000000 + i * 86400000::bigint, 'kg', 80)) from generate_series(1, 401) i))) is distinct from 'too_long' then raise 'plus de 400'; end if;
  -- 400 : accepté. Puis la vraie liste (remplace tout) ; clés en trop ignorées ; même instant : la dernière
  if public.student_share_weights((select jsonb_agg(jsonb_build_object('date', 1700000000000 + i * 86400000::bigint, 'kg', 80)) from generate_series(1, 400) i)) is distinct from 400 then raise '400 pesées'; end if;
  if public.student_share_weights('[{"date": 1780800000000, "kg": 79.456, "note": "secret"}, {"date": 1779900000000, "kg": 81}, {"date": 1779900000000, "kg": 80.5}, {"date": 1775000000000, "kg": 83}]') is distinct from 3 then raise 'envoi'; end if;
  st := public.student_shares();
  if (st -> 'shares' -> 'weight' ->> 'n')::int is distinct from 3 or (st -> 'shares' -> 'weight' ->> 'last_at')::bigint is distinct from 1780800000000 then raise 'état après envoi : %', st; end if;
  -- L'élève ne lit pas ses pesées par la fonction du coach
  if pg_temp.perr(format('select public.coach_student_weights(%L)', pg_temp.pu('s'))) is distinct from 'not_found' then raise 'élève lit par la fonction coach'; end if;

  -- Le coach consenti : pesées du plus récent au plus ancien, rien d'autre
  perform pg_temp.plogin('k');
  w := public.coach_student_weights(pg_temp.pu('s'));
  if w -> 'weights' is distinct from '[{"date": 1780800000000, "kg": 79.46}, {"date": 1779900000000, "kg": 80.5}, {"date": 1775000000000, "kg": 83}]'::jsonb
     or not (w ->> 'shared')::boolean or (w ->> 'since')::timestamptz is distinct from g then raise 'lecture du coach : %', w; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(w) k) is distinct from array['shared', 'since', 'weights'] then raise 'clés : %', w; end if;
  -- Séances : bodyKg = dernière pesée au plus tard à la date de la séance ; avant la 1re pesée : rien
  for r in select * from public.coach_student_sessions(pg_temp.pu('s')) loop
    if r.id = 'p-1' and (r.s ->> 'bodyKg')::numeric is distinct from 80.5 then raise 'bodyKg de p-1 : %', r.s; end if;
    if r.id = 'p-2' and (r.s ->> 'bodyKg')::numeric is distinct from 79.46 then raise 'bodyKg de p-2 : %', r.s; end if;
    if r.id = 'p-0' and r.s ? 'bodyKg' then raise 'bodyKg avant la 1re pesée : %', r.s; end if;
    -- p-vieux : bodyKg de data (99) jamais recopié ; seule la pesée partagée compte (83)
    if r.id = 'p-vieux' and (r.s ->> 'bodyKg')::numeric is distinct from 83 then raise 'bodyKg de data recopié : %', r.s; end if;
  end loop;
  -- T, autre élève de K, ne partage rien : rien
  if (public.coach_student_weights(pg_temp.pu('t')) ->> 'shared')::boolean then raise 'T partage sans avoir coché'; end if;
end $$;

-- ── Personne d'autre ne lit ──────────────────────────────
do $$
declare r record;
begin
  -- Un autre coach
  perform pg_temp.plogin('l');
  if pg_temp.perr(format('select public.coach_student_weights(%L)', pg_temp.pu('s'))) is distinct from 'not_found' then raise 'autre coach : pesées'; end if;
  if pg_temp.perr(format('select * from public.coach_student_sessions(%L)', pg_temp.pu('s'))) is distinct from 'not_found' then raise 'autre coach : séances'; end if;
  -- Un ami (ni coach ni élève)
  perform pg_temp.plogin('a');
  if pg_temp.perr(format('select public.coach_student_weights(%L)', pg_temp.pu('s'))) is distinct from 'not_found' then raise 'ami : pesées'; end if;
  if pg_temp.perr(format('select * from public.coach_student_sessions(%L)', pg_temp.pu('s'))) is distinct from 'not_found' then raise 'ami : séances'; end if;
  if pg_temp.perr($q$ select * from public.coach_shared_weights $q$) not like 'permission denied%' then raise 'ami : table'; end if;
  if pg_temp.perr($q$ select * from public.coach_shares $q$) not like 'permission denied%' then raise 'ami : consentements'; end if;
  -- Un autre élève du même coach
  perform pg_temp.plogin('t');
  if pg_temp.perr(format('select public.coach_student_weights(%L)', pg_temp.pu('s'))) is distinct from 'not_found' then raise 'autre élève : pesées'; end if;
  if (public.student_shares() -> 'shares') is distinct from '{}'::jsonb then raise 'T voit le partage de S'; end if;
end $$;

-- Rien pour les amis : la liste blanche publique ne donne jamais bodyKg (même présent dans data), et aucune
-- fonction hors du partage ne lit les tables du partage (fil, profils, bravos…)
reset role;
do $$ begin
  if private.session_public('{"date": 1, "bodyKg": 80, "exercises": []}') ? 'bodyKg' then raise 'session_public donne bodyKg'; end if;
  if exists (select 1 from pg_proc p
             where (p.prosrc ilike '%coach_shared_weights%' or p.prosrc ilike '%coach_shares%' or p.prosrc ilike '%coach_session_body%')
               and p.proname not in ('student_shares', 'student_set_share', 'student_share_weights', 'coach_student_weights',
                                     'coach_student_sessions', 'coach_has_share', 'coach_session_body',
                                     -- mensurations (20261105010000_partage_mensurations.sql), même consentement
                                     'student_share_measures', 'coach_student_measures')) then
    raise 'une autre fonction lit le partage : %', (select string_agg(p.proname, ', ') from pg_proc p
      where p.prosrc ilike '%coach_shared_weights%' or p.prosrc ilike '%coach_shares%' or p.prosrc ilike '%coach_session_body%');
  end if;
end $$;
set role authenticated;

-- ── Décocher : tout est effacé, plus rien ne passe ───────
do $$
declare r record; st jsonb;
begin
  perform pg_temp.plogin('s');
  st := public.student_set_share('weight', false) - 'kinds';
  if st is distinct from '{"coach": true, "shares": {}}'::jsonb then raise 'décocher : %', st; end if;
  -- Décocher deux fois : silencieux
  perform public.student_set_share('weight', false);
  reset role;
  if exists (select 1 from public.coach_shared_weights where student_id = pg_temp.pu('s')) then raise 'pesées gardées après retrait'; end if;
  if exists (select 1 from public.coach_shares where student_id = pg_temp.pu('s')) then raise 'consentement gardé après retrait'; end if;
  set role authenticated;
  -- L'élève après retrait : plus d'envoi possible
  perform pg_temp.plogin('s');
  if pg_temp.perr($q$ select public.student_share_weights('[{"date": 1780000000000, "kg": 80}]') $q$) is distinct from 'not_shared' then raise 'envoi après retrait'; end if;
  -- Le coach : plus rien, même l'historique déjà vu
  perform pg_temp.plogin('k');
  if public.coach_student_weights(pg_temp.pu('s')) is distinct from '{"shared": false, "since": null, "weights": []}'::jsonb then raise 'coach après retrait'; end if;
  for r in select * from public.coach_student_sessions(pg_temp.pu('s')) loop
    if r.s ? 'bodyKg' then raise 'bodyKg après retrait : %', r; end if;
  end loop;
end $$;

-- ── Quitter le coach, être retiré : tout part ; rôle retiré : plus aucune lecture ──
do $$
declare st jsonb;
begin
  -- Quitter : consentement et pesées effacés avec le lien
  perform pg_temp.plogin('s');
  perform public.student_set_share('weight', true);
  perform public.student_share_weights('[{"date": 1780000000000, "kg": 80}]');
  perform public.coach_leave();
  reset role;
  if exists (select 1 from public.coach_shares where student_id = pg_temp.pu('s')) or exists (select 1 from public.coach_shared_weights where student_id = pg_temp.pu('s')) then raise 'quitter garde le partage'; end if;
  -- Nouveau coach (L) : rien n'est repris, il faut recocher
  insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('s'), pg_temp.pu('l'));
  set role authenticated;
  perform pg_temp.plogin('s');
  if public.student_shares() -> 'shares' is distinct from '{}'::jsonb then raise 'partage repris chez le nouveau coach'; end if;
  perform pg_temp.plogin('k');
  if pg_temp.perr(format('select public.coach_student_weights(%L)', pg_temp.pu('s'))) is distinct from 'not_found' then raise 'ancien coach lit encore'; end if;
  -- Retiré par le coach : pareil
  perform pg_temp.plogin('s');
  perform public.student_set_share('weight', true);
  perform public.student_share_weights('[{"date": 1780000000000, "kg": 80}]');
  perform pg_temp.plogin('l');
  if (public.coach_student_weights(pg_temp.pu('s')) -> 'weights' -> 0 ->> 'kg')::numeric is distinct from 80 then raise 'nouveau coach consenti'; end if;
  perform public.coach_remove_student(pg_temp.pu('s'));
  reset role;
  if exists (select 1 from public.coach_shares where student_id = pg_temp.pu('s')) or exists (select 1 from public.coach_shared_weights where student_id = pg_temp.pu('s')) then raise 'retrait garde le partage'; end if;
  -- Rôle de coach retiré par l'administrateur : il ne lit plus (le consentement reste, l'élève peut le couper)
  insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('t'), pg_temp.pu('l')) on conflict do nothing;
  set role authenticated;
  perform pg_temp.plogin('t');
  perform public.student_set_share('weight', true);
  perform public.student_share_weights('[{"date": 1780000000000, "kg": 70}]');
  reset role;
  update public.user_profiles set coach_at = null where user_id = pg_temp.pu('k');
  set role authenticated;
  perform pg_temp.plogin('k');
  if pg_temp.perr(format('select public.coach_student_weights(%L)', pg_temp.pu('t'))) is distinct from 'not_found' then raise 'ex-coach lit encore'; end if;
  reset role;
  update public.user_profiles set coach_at = now() where user_id = pg_temp.pu('k');
end $$;
reset role;

-- ── Limites et suppression du compte ─────────────────────
do $$
declare t uuid := pg_temp.pu('t');
begin
  -- 60 cochages par heure ; décocher n'est jamais limité
  set local role authenticated;
  perform pg_temp.plogin('t');
  for i in 1..59 loop perform public.student_set_share('weight', false); perform public.student_set_share('weight', true); end loop;   -- 60 avec celui du bloc précédent
  if pg_temp.perr($q$ select public.student_set_share('weight', false) $q$) is distinct from 'ok' then raise 'décocher limité'; end if;
  if pg_temp.perr($q$ select public.student_set_share('weight', true) $q$) is distinct from 'rate_limited' then raise 'limite des cochages'; end if;
  -- Liste trop lourde (clés en trop) : too_long
  reset role;
  insert into public.coach_shares (student_id, coach_id, kind) select t, coach_id, 'weight' from public.coach_links where student_id = t;
  set local role authenticated;
  if pg_temp.perr(format('select public.student_share_weights(%L)', jsonb_build_array(jsonb_build_object('date', 1780000000000, 'kg', 70, 'x', repeat('a', 70000))))) is distinct from 'too_long' then raise 'liste de plus de 64 Ko'; end if;
  perform public.student_share_weights('[{"date": 1780000000000, "kg": 70}]');
  reset role;
  -- Compte de l'élève supprimé : consentement et pesées partent en cascade
  if not exists (select 1 from public.coach_shared_weights where student_id = t) then raise 'pesées de T absentes avant la suppression'; end if;
  delete from auth.users where id = t;
  if exists (select 1 from public.coach_shares where student_id = t) or exists (select 1 from public.coach_shared_weights where student_id = t) then raise 'cascade élève'; end if;
end $$;
-- Nettoyage : les tests suivants partent d'une base sans ces comptes
delete from auth.users where id in (select pg_temp.pu(c) from unnest(array['k', 'l', 's', 'a']) c);
