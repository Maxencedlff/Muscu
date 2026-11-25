-- Vérifications de supabase/migrations/20261125010000_bilans_coach.sql (lancées par tests/sql/run.sh) : droits
-- (anon, autre coach, ex-coach, coach dont le rôle est retiré, non-élève), blocage, effacement (départ, retrait,
-- suppression du compte), accord du cycle (refus sans « 18 ans ou plus »), validation des suivis et des réponses
-- (mêmes cas que js/data/checkins.js), copie figée, idempotence, limites, envoi planifié (heures, fuseau, heure
-- d'été du dimanche 25 octobre 2026 à Paris, groupe et planning de l'élève, rappel, fermeture), notifications en
-- file (bon type, réglage éteint : rien), photos d'un autre élève refusées, purge. Chaque bloc échoue (raise) si la
-- règle n'est pas tenue. Comptes à part (…000000000bcX) ; jetons et clés faux et évidents.
--
-- K (bil0.k) est coach de S, T, U, V ; L (bil1.l) est coach de W ; X (bil2.x) est coach de Y, puis perd son rôle ;
-- A n'est ni coach ni élève.

create function pg_temp.bu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-000000000bc' || translate(c, 'klxstuvwya', '0123456789'))::uuid $$;
create function pg_temp.blogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.bu(c)::text, ''), false) $$;
create function pg_temp.berr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
-- Photo de bilan factice (identifiant au format de l'app)
create function pg_temp.bph(n int) returns uuid language sql immutable as
$$ select ('00000000-0000-4000-8000-000000bc' || lpad(n::text, 4, '0'))::uuid $$;
-- Suivis canoniques (tels que les rend checkinItemClean)
create function pg_temp.bi(k text) returns jsonb language sql immutable as
$$
  select case k
    when 'weight' then '{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": true, "unit": "kg"}'
    when 'sleep' then '{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}'
    when 'photos' then '{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face"]}}'
    when 'cycle' then '{"key": "cycle", "kind": "cycle", "label": "Cycle menstruel", "type": "choice", "required": false}'
    when 'question' then '{"key": "qabc12345", "kind": "custom", "label": "Ta difficulté ?", "type": "text", "required": false}'
  end::jsonb
$$;
grant execute on function pg_temp.bu(text), pg_temp.blogin(text), pg_temp.berr(text), pg_temp.bph(int), pg_temp.bi(text)
  to authenticated, anon;

insert into auth.users (id) select pg_temp.bu(c) from unnest(array['k', 'l', 'x', 's', 't', 'u', 'v', 'w', 'y', 'a']) c;
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at)
  select pg_temp.bu(c), 'bil' || translate(c, 'klxstuvwya', '0123456789') || '.' || c, '🦊', case when c in ('k', 'l', 'x') then now() end
  from unnest(array['k', 'l', 'x', 's', 't', 'u', 'v', 'w', 'y', 'a']) c;
insert into public.coach_links (student_id, coach_id)
  select pg_temp.bu(c), pg_temp.bu('k') from unnest(array['s', 't', 'u', 'v']) c;
insert into public.coach_links (student_id, coach_id) values (pg_temp.bu('w'), pg_temp.bu('l')), (pg_temp.bu('y'), pg_temp.bu('x'));
-- Accord daté pour les bilans (20261127030000_bilans_accord_majeur, s'il est là) : donné par chaque élève lié, et
-- S déclare ses 18 ans (libido et cycle) ; l'accord lui-même est vérifié par bilans_accord_majeur_test.sql
do $$ begin
  if to_regclass('public.checkin_health_consents') is not null then
    execute 'insert into public.checkin_health_consents (student_id, coach_id, version) select student_id, coach_id, private.checkin_health_version() from public.coach_links on conflict do nothing';
    insert into public.coach_photo_adults (user_id) select pg_temp.bu(c) from unnest(array['s', 't', 'u', 'v', 'w', 'y']) c on conflict do nothing;
  end if;
end $$;
-- S : appareil et « Mon coach » allumé ; T : appareil, « Mon coach » éteint
insert into public.push_devices (token, user_id, env) values
  (repeat('b', 64), pg_temp.bu('s'), 'production'), (repeat('c', 64), pg_temp.bu('t'), 'production');
insert into public.push_prefs (user_id, coach) values (pg_temp.bu('s'), true), (pg_temp.bu('t'), false);
-- Photos de bilan (20261107000000) : clé factice de K ; S a une photo prête (1) et une en cours (2) ; T une prête (3)
insert into public.coach_photo_keys (coach_id, key_id, public_key, wrapped_key, wrap_iv)
  values (pg_temp.bu('k'), repeat('0', 32), 'BA' || repeat('A', 84) || 'A=', repeat('A', 64), repeat('A', 16));
insert into public.coach_photos (id, student_id, coach_id, key_id, taken_on, pose, epk, iv, state, bytes, sent_at) values
  (pg_temp.bph(1), pg_temp.bu('s'), pg_temp.bu('k'), repeat('0', 32), current_date, 'face', 'BA' || repeat('A', 84) || 'A=', repeat('A', 16), 'ready', 100, now()),
  (pg_temp.bph(2), pg_temp.bu('s'), pg_temp.bu('k'), repeat('0', 32), current_date, 'side', 'BA' || repeat('A', 84) || 'A=', repeat('A', 16), 'pending', null, null),
  (pg_temp.bph(3), pg_temp.bu('t'), pg_temp.bu('k'), repeat('0', 32), current_date, 'face', 'BA' || repeat('A', 84) || 'A=', repeat('A', 16), 'ready', 100, now());

-- ── Droits ───────────────────────────────────────────────
do $$
declare f text; r text;
begin
  foreach f in array array['public.coach_checkin_templates', 'public.coach_groups', 'public.coach_group_members', 'public.coach_checkin_schedules',
                           'public.coach_checkin_requests', 'public.coach_checkin_answers', 'public.coach_checkin_reviews', 'public.checkin_cycle_consents'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = f::regclass) then raise 'RLS désactivée : %', f; end if;
    if exists (select 1 from pg_policies p where p.schemaname || '.' || p.tablename = f) then raise 'politique RLS : %', f; end if;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if has_table_privilege(r, f, 'select') or has_table_privilege(r, f, 'insert') or has_table_privilege(r, f, 'update')
         or has_table_privilege(r, f, 'delete') then raise '% a un droit sur %', r, f; end if;
    end loop;
  end loop;
  foreach f in array array['public.coach_checkin_setup()', 'public.coach_template_save(uuid,text,jsonb)', 'public.coach_template_duplicate(uuid)',
      'public.coach_template_delete(uuid)', 'public.coach_group_save(uuid,text,uuid[])', 'public.coach_group_delete(uuid)',
      'public.coach_schedule_save(uuid,uuid,uuid,text,int,int,int,text,int,int,boolean)', 'public.coach_schedule_delete(uuid)',
      'public.coach_checkin_send_now(uuid,uuid[])', 'public.coach_checkins_overview()', 'public.coach_student_checkins(uuid,int)',
      'public.coach_checkin_review(uuid,text,int,boolean)', 'public.student_checkins()', 'public.student_checkin_answer(uuid,jsonb)',
      'public.student_checkin_cycle(boolean,boolean)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute') then raise 'anon ou service_role exécute %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise 'authenticated n''exécute pas %', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure) then
      raise 'security definer / search_path : %', f; end if;
  end loop;
  -- Aucune fonction privée des bilans exécutable par l'API
  if exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'checkin%'
             and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                  or has_function_privilege('service_role', p.oid, 'execute'))) then
    raise 'fonction privée des bilans exécutable par l''API'; end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'checkin%'
             and not coalesce(p.proconfig @> array['search_path=""'], false)) then raise 'fonction privée sans search_path vide'; end if;
end $$;
set role anon;
do $$ begin
  if pg_temp.berr('select public.student_checkins()') not like 'permission denied%' then raise 'anon : student_checkins'; end if;
  if pg_temp.berr('select public.coach_checkin_setup()') not like 'permission denied%' then raise 'anon : coach_checkin_setup'; end if;
  if pg_temp.berr('select * from public.coach_checkin_requests') not like 'permission denied%' then raise 'anon : table'; end if;
end $$;
reset role;

-- ── Validation : mêmes réponses que js/data/checkins.js ──
-- Attendu calculé par checkinItemClean et checkinValueClean (accepté = le nettoyage du client le rend inchangé)
create temp table bk_items (x jsonb, ok boolean);
create temp table bk_values (it jsonb, v jsonb, ok boolean);
insert into pg_temp.bk_items (x, ok) values
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', true),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist", "hips", "thighL"]}}', true),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face", "side", "back"]}}', true),
  ('{"key": "diet_adherence", "kind": "diet_adherence", "label": "Respect du plan diète", "type": "auto", "required": false}', true),
  ('{"key": "training_adherence", "kind": "training_adherence", "label": "Respect de l''entraînement", "type": "auto", "required": false}', true),
  ('{"key": "steps", "kind": "steps", "label": "Pas par jour", "type": "number", "required": false, "unit": "steps"}', true),
  ('{"key": "cardio", "kind": "cardio", "label": "Cardio", "type": "number", "required": false, "unit": "min"}', true),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', true),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}', true),
  ('{"key": "energy", "kind": "energy", "label": "Énergie", "type": "scale", "required": false, "scale": 5, "lo": "À plat", "hi": "Au top"}', true),
  ('{"key": "hunger", "kind": "hunger", "label": "Faim", "type": "scale", "required": false, "scale": 5, "lo": "Aucune", "hi": "Tout le temps"}', true),
  ('{"key": "stress", "kind": "stress", "label": "Stress", "type": "scale", "required": false, "scale": 5, "lo": "Aucun", "hi": "Très fort"}', true),
  ('{"key": "digestion", "kind": "digestion", "label": "Digestion", "type": "scale", "required": false, "scale": 5, "lo": "Difficile", "hi": "Parfaite"}', true),
  ('{"key": "fatigue", "kind": "fatigue", "label": "Fatigue", "type": "scale", "required": false, "scale": 5, "lo": "Aucune", "hi": "Très forte"}', true),
  ('{"key": "mood", "kind": "mood", "label": "Humeur", "type": "scale", "required": false, "scale": 5, "lo": "Au plus bas", "hi": "Excellente"}', true),
  ('{"key": "libido", "kind": "libido", "label": "Libido", "type": "scale", "required": false, "scale": 5, "lo": "Très basse", "hi": "Très haute"}', true),
  ('{"key": "cycle", "kind": "cycle", "label": "Cycle menstruel", "type": "choice", "required": false}', true),
  ('{"key": "qabc12345", "kind": "custom", "label": "Ta difficulté ?", "type": "text", "required": false}', true),
  ('{"key": "qzz000111", "kind": "custom", "label": "Moral", "type": "scale", "required": true, "scale": 10, "lo": "", "hi": ""}', true),
  ('{"key": "qn0000001", "kind": "custom", "label": "Verres d''eau", "type": "number", "required": false, "unit": "verres"}', true),
  ('{"key": "weight", "kind": "weight", "label": " Poids", "type": "number", "required": false, "unit": "kg"}', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids  du matin", "type": "number", "required": false, "unit": "kg"}', false),
  ('{"key": "weight", "kind": "weight", "label": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "type": "number", "required": false, "unit": "kg"}', true),
  ('{"key": "weight", "kind": "weight", "label": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "type": "number", "required": false, "unit": "kg"}', false),
  ('{"key": "weight", "kind": "weight", "label": "", "type": "number", "required": false, "unit": "kg"}', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids matin", "type": "number", "required": false, "unit": "kg"}', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids\tmatin", "type": "number", "required": false, "unit": "kg"}', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids é 🙂", "type": "number", "required": false, "unit": "kg"}', true),
  ('{"key": "poids", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "lb"}', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "scale", "required": false, "unit": "kg"}', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": true, "unit": "kg"}', true),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": "true", "unit": "kg"}', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg", "extra": 1}', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg", "scale": 5}', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": true}', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', true),
  ('{"key": "cycle", "kind": "cycle", "label": "Cycle menstruel", "type": "choice", "required": true}', false),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 10, "lo": "Mal", "hi": "Très bien"}', true),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 7, "lo": "Mal", "hi": "Très bien"}', false),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "", "hi": "Très bien"}', false),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Nul", "hi": "Très bien"}', true),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": " Nul", "hi": "Très bien"}', false),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"}', false),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["hips", "waist"]}}', false),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist", "hips", "thighL"]}}', true),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": []}}', false),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist", "nose"]}}', false),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist"], "extra": 1}}', false),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": null}', false),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face"]}}', true),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["back", "face"]}}', false),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["top"]}}', false),
  ('{"key": "q1234567", "kind": "custom", "label": "Ta difficulté ?", "type": "text", "required": false}', false),
  ('{"key": "QABC12345", "kind": "custom", "label": "Ta difficulté ?", "type": "text", "required": false}', false),
  ('{"key": "qabc1234_", "kind": "custom", "label": "Ta difficulté ?", "type": "text", "required": false}', false),
  ('{"key": "qabc12345", "kind": "custom", "label": "Ta difficulté ?", "type": "photo", "required": false}', false),
  ('{"key": "qabc12345", "kind": "custom", "label": "", "type": "text", "required": false}', false),
  ('{"key": "qzz000111", "kind": "custom", "label": "Moral", "type": "scale", "required": true, "scale": 10, "lo": "Bas", "hi": "Haut"}', true),
  ('{"key": "qzz000111", "kind": "custom", "label": "Moral", "type": "scale", "required": true, "scale": 5, "lo": "", "hi": ""}', true),
  ('{"key": "qzz000111", "kind": "custom", "label": "Moral", "type": "scale", "required": true, "scale": "10", "lo": "", "hi": ""}', false),
  ('{"key": "qn0000001", "kind": "custom", "label": "Verres d''eau", "type": "number", "required": false, "unit": ""}', true),
  ('{"key": "qn0000001", "kind": "custom", "label": "Verres d''eau", "type": "number", "required": false, "unit": "uuuuuuuuuuuuu"}', false),
  ('{"key": "qn0000001", "kind": "custom", "label": "Verres d''eau", "type": "number", "required": false, "unit": "uuuuuuuuuuuu"}', true),
  ('{"kind": "nope", "key": "nope", "label": "x", "type": "text", "required": false}', false),
  ('["weight"]', false),
  ('"weight"', false),
  ('null', false),
  ('{"key": "weight", "kind": "weight", "type": "number", "required": false, "unit": "kg"}', false),
  ('{"key": "weight", "kind": "weight", "label": 5, "type": "number", "required": false, "unit": "kg"}', false);
insert into pg_temp.bk_values (it, v, ok) values
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}', '1', true),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}', '5', true),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}', '0', false),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}', '6', false),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}', '3.5', false),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}', '"3"', false),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}', '3', true),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 10, "lo": "Mal", "hi": "Très bien"}', '10', true),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 10, "lo": "Mal", "hi": "Très bien"}', '11', false),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}', 'null', false),
  ('{"key": "sleep", "kind": "sleep", "label": "Sommeil", "type": "scale", "required": false, "scale": 5, "lo": "Mal", "hi": "Très bien"}', 'true', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', '{"yes": true}', true),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', '{"yes": false}', true),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', '{"yes": true, "note": "Genou"}', true),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', '{"yes": false, "note": "Genou"}', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', '{"yes": true, "note": ""}', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', '{"yes": true, "note": " Genou"}', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', '{"yes": "oui"}', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', '{"yes": true, "note": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', '{"yes": true, "note": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', '{"yes": true, "extra": 1}', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', '{"yes": true, "note": "Ligne 1\nLigne 2"}', true),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "yesno", "required": false}', '[true]', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '"Bien"', true),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '""', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '" Bien"', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '"Bien\n\n\nmieux"', true),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '"Bien\n\n\n\nmieux"', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '"Bien\r\nmieux"', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '"a  b"', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '"a\tb"', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '"a b"', true),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '"a \nb"', true),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"', true),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '5', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '"é🙂"', true),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '"a\u0007b"', false),
  ('{"key": "pain", "kind": "pain", "label": "Douleurs ou blessures", "type": "text", "required": false}', '" a"', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', '70', true),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', '70.5', true),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', '70.25', true),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', '70.255', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', '24.99', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', '25', true),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', '300', true),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', '300.01', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', '"70"', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', '-1', false),
  ('{"key": "weight", "kind": "weight", "label": "Poids", "type": "number", "required": false, "unit": "kg"}', '{"kg": 70}', false),
  ('{"key": "steps", "kind": "steps", "label": "Pas par jour", "type": "number", "required": false, "unit": "steps"}', '8000', true),
  ('{"key": "steps", "kind": "steps", "label": "Pas par jour", "type": "number", "required": false, "unit": "steps"}', '8000.5', false),
  ('{"key": "steps", "kind": "steps", "label": "Pas par jour", "type": "number", "required": false, "unit": "steps"}', '0', true),
  ('{"key": "steps", "kind": "steps", "label": "Pas par jour", "type": "number", "required": false, "unit": "steps"}', '100000', true),
  ('{"key": "steps", "kind": "steps", "label": "Pas par jour", "type": "number", "required": false, "unit": "steps"}', '100001', false),
  ('{"key": "cardio", "kind": "cardio", "label": "Cardio", "type": "number", "required": false, "unit": "min"}', '10080', true),
  ('{"key": "cardio", "kind": "cardio", "label": "Cardio", "type": "number", "required": false, "unit": "min"}', '10081', false),
  ('{"key": "cardio", "kind": "cardio", "label": "Cardio", "type": "number", "required": false, "unit": "min"}', '30.2', false),
  ('{"key": "qn0000001", "kind": "custom", "label": "Verres d''eau", "type": "number", "required": false, "unit": "verres"}', '-1000000', true),
  ('{"key": "qn0000001", "kind": "custom", "label": "Verres d''eau", "type": "number", "required": false, "unit": "verres"}', '1000000', true),
  ('{"key": "qn0000001", "kind": "custom", "label": "Verres d''eau", "type": "number", "required": false, "unit": "verres"}', '1000000.01', false),
  ('{"key": "qn0000001", "kind": "custom", "label": "Verres d''eau", "type": "number", "required": false, "unit": "verres"}', '3.14', true),
  ('{"key": "qn0000001", "kind": "custom", "label": "Verres d''eau", "type": "number", "required": false, "unit": "verres"}', '3.141', false),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist", "hips", "thighL"]}}', '{"waist": 80}', true),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist", "hips", "thighL"]}}', '{"waist": 80, "hips": 95.5}', true),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist", "hips", "thighL"]}}', '{}', false),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist", "hips", "thighL"]}}', '{"waist": 9}', false),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist", "hips", "thighL"]}}', '{"waist": 80, "chest": 100}', false),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist", "hips", "thighL"]}}', '{"waist": "80"}', false),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist", "hips", "thighL"]}}', '{"waist": 80, "hips": 300}', false),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist", "hips", "thighL"]}}', '[80]', false),
  ('{"key": "measures", "kind": "measures", "label": "Mensurations", "type": "number", "required": false, "unit": "cm", "options": {"keys": ["waist", "hips", "thighL"]}}', '{"waist": 80.123}', false),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face", "side", "back"]}}', '{"ids": ["00000000-0000-4000-8000-000000bc0001"]}', true),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face", "side", "back"]}}', '{"ids": ["00000000-0000-4000-8000-000000bc0001", "00000000-0000-4000-8000-000000bc0002"]}', true),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face", "side", "back"]}}', '{"ids": []}', false),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face", "side", "back"]}}', '{"ids": ["00000000-0000-4000-8000-000000bc0001", "00000000-0000-4000-8000-000000bc0001"]}', false),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face", "side", "back"]}}', '{"ids": ["nope"]}', false),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face", "side", "back"]}}', '{"ids": ["00000000-0000-4000-8000-000000BC0001"]}', false),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face", "side", "back"]}}', '{"ids": ["00000000-0000-4000-8000-000000bc0100", "00000000-0000-4000-8000-000000bc0101", "00000000-0000-4000-8000-000000bc0102", "00000000-0000-4000-8000-000000bc0103", "00000000-0000-4000-8000-000000bc0104", "00000000-0000-4000-8000-000000bc0105", "00000000-0000-4000-8000-000000bc0106", "00000000-0000-4000-8000-000000bc0107", "00000000-0000-4000-8000-000000bc0108"]}', true),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face", "side", "back"]}}', '{"ids": ["00000000-0000-4000-8000-000000bc0100", "00000000-0000-4000-8000-000000bc0101", "00000000-0000-4000-8000-000000bc0102", "00000000-0000-4000-8000-000000bc0103", "00000000-0000-4000-8000-000000bc0104", "00000000-0000-4000-8000-000000bc0105", "00000000-0000-4000-8000-000000bc0106", "00000000-0000-4000-8000-000000bc0107", "00000000-0000-4000-8000-000000bc0108", "00000000-0000-4000-8000-000000bc0109"]}', false),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face", "side", "back"]}}', '{"ids": ["00000000-0000-4000-8000-000000bc0001"], "extra": 1}', false),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face", "side", "back"]}}', '["00000000-0000-4000-8000-000000bc0001"]', false),
  ('{"key": "photos", "kind": "photos", "label": "Photos", "type": "photo", "required": false, "options": {"poses": ["face", "side", "back"]}}', '"00000000-0000-4000-8000-000000bc0001"', false),
  ('{"key": "diet_adherence", "kind": "diet_adherence", "label": "Respect du plan diète", "type": "auto", "required": false}', '{"done": 3, "of": 7}', true),
  ('{"key": "diet_adherence", "kind": "diet_adherence", "label": "Respect du plan diète", "type": "auto", "required": false}', '{"done": 0, "of": 1}', true),
  ('{"key": "diet_adherence", "kind": "diet_adherence", "label": "Respect du plan diète", "type": "auto", "required": false}', '{"done": 8, "of": 7}', false),
  ('{"key": "diet_adherence", "kind": "diet_adherence", "label": "Respect du plan diète", "type": "auto", "required": false}', '{"done": 3, "of": 32}', false),
  ('{"key": "diet_adherence", "kind": "diet_adherence", "label": "Respect du plan diète", "type": "auto", "required": false}', '{"done": -1, "of": 7}', false),
  ('{"key": "diet_adherence", "kind": "diet_adherence", "label": "Respect du plan diète", "type": "auto", "required": false}', '{"done": 1.5, "of": 7}', false),
  ('{"key": "diet_adherence", "kind": "diet_adherence", "label": "Respect du plan diète", "type": "auto", "required": false}', '{"done": 3, "of": 0}', false),
  ('{"key": "diet_adherence", "kind": "diet_adherence", "label": "Respect du plan diète", "type": "auto", "required": false}', '{"done": 3}', false),
  ('{"key": "diet_adherence", "kind": "diet_adherence", "label": "Respect du plan diète", "type": "auto", "required": false}', '{"done": 3, "of": 7, "x": 1}', false),
  ('{"key": "diet_adherence", "kind": "diet_adherence", "label": "Respect du plan diète", "type": "auto", "required": false}', '{"done": 31, "of": 31}', true),
  ('{"key": "cycle", "kind": "cycle", "label": "Cycle menstruel", "type": "choice", "required": false}', '"menses"', true),
  ('{"key": "cycle", "kind": "cycle", "label": "Cycle menstruel", "type": "choice", "required": false}', '"luteal"', true),
  ('{"key": "cycle", "kind": "cycle", "label": "Cycle menstruel", "type": "choice", "required": false}', '"unknown"', true),
  ('{"key": "cycle", "kind": "cycle", "label": "Cycle menstruel", "type": "choice", "required": false}', '"autre"', false),
  ('{"key": "cycle", "kind": "cycle", "label": "Cycle menstruel", "type": "choice", "required": false}', '1', false),
  ('{"key": "qabc12345", "kind": "custom", "label": "Ta difficulté ?", "type": "text", "required": false}', '"Libre"', true);
do $$
declare n int;
begin
  select count(*) into n from pg_temp.bk_items c where private.checkin_item_ok(c.x) is distinct from c.ok;
  if n > 0 then raise 'suivis : % écart(s) avec checkins.js, dont %', n,
    (select c.x::text || ' attendu ' || c.ok from pg_temp.bk_items c where private.checkin_item_ok(c.x) is distinct from c.ok limit 1); end if;
  select count(*) into n from pg_temp.bk_values c where private.checkin_value_ok(c.it, c.v) is distinct from c.ok;
  if n > 0 then raise 'réponses : % écart(s) avec checkins.js, dont %', n,
    (select c.it ->> 'key' || ' ' || c.v::text || ' attendu ' || c.ok from pg_temp.bk_values c where private.checkin_value_ok(c.it, c.v) is distinct from c.ok limit 1); end if;
  if (select count(*) from pg_temp.bk_items where ok) < 20 or (select count(*) from pg_temp.bk_values where ok) < 30 then raise 'cas acceptés trop peu nombreux'; end if;
  -- Liste de suivis : 1 à 60, sans doublon
  if private.checkin_items_ok('[]') or not private.checkin_items_ok(jsonb_build_array(pg_temp.bi('weight'))) then raise 'liste vide ou simple'; end if;
  if private.checkin_items_ok(jsonb_build_array(pg_temp.bi('weight'), pg_temp.bi('weight'))) then raise 'doublon accepté'; end if;
  if private.checkin_items_ok((select jsonb_agg(jsonb_build_object('key', 'q' || lpad(i::text, 8, '0'), 'kind', 'custom', 'label', 'Q' || i, 'type', 'text', 'required', false))
                               from generate_series(1, 61) i)) then raise '61 suivis acceptés'; end if;
  if not private.checkin_items_ok((select jsonb_agg(jsonb_build_object('key', 'q' || lpad(i::text, 8, '0'), 'kind', 'custom', 'label', 'Q' || i, 'type', 'text', 'required', false))
                                   from generate_series(1, 60) i)) then raise '60 suivis refusés'; end if;
  if private.checkin_items_ok('{"a": 1}') or private.checkin_items_ok(null) is distinct from false then raise 'liste qui n''en est pas une'; end if;
  -- Textes : même nettoyage que checkinLine et checkinText
  if private.checkin_line(E' a \t b  c ', 60) <> 'a b c' then raise 'checkinLine'; end if;
  if private.checkin_text(E'  a\r\nb\n\n\n\n\nc \u0007 d  ', 1000) <> E'a\nb\n\n\nc d' then raise 'checkinText : %', private.checkin_text(E'  a\r\nb\n\n\n\n\nc \u0007 d  ', 1000); end if;
  if private.checkin_line('Copie de ' || repeat('é', 60), 60) <> 'Copie de ' || repeat('é', 51) then raise 'coupe en caractères'; end if;
end $$;

-- ── Modèles (coach K) ────────────────────────────────────
create temp table bk (k text primary key, v uuid);
grant all on pg_temp.bk to authenticated;
set role authenticated;
do $$
declare r jsonb; id1 uuid; i int;
begin
  perform set_config('request.jwt.claim.sub', '', false);
  if pg_temp.berr('select public.coach_checkin_setup()') <> 'not_signed_in' then raise 'sans compte'; end if;
  perform pg_temp.blogin('s');
  if pg_temp.berr('select public.coach_checkin_setup()') <> 'not_coach' then raise 'élève : setup'; end if;
  if pg_temp.berr(format('select public.coach_template_save(null, %L, %L)', 'Hebdo', jsonb_build_array(pg_temp.bi('weight')))) <> 'not_coach' then raise 'élève : modèle'; end if;
  perform pg_temp.blogin('k');
  r := public.coach_checkin_setup();
  if r <> '{"templates": [], "schedules": [], "groups": []}' then raise 'setup vide : %', r; end if;
  -- Nom nettoyé ; suivis refusés tels quels
  r := public.coach_template_save(null, '  Hebdo   du  dimanche ', jsonb_build_array(pg_temp.bi('weight'), pg_temp.bi('sleep'), pg_temp.bi('photos'), pg_temp.bi('cycle'), pg_temp.bi('question')));
  if r ->> 'name' <> 'Hebdo du dimanche' or (r ->> 'version')::int <> 1 or jsonb_array_length(r -> 'items') <> 5 then raise 'modèle créé : %', r; end if;
  id1 := (r ->> 'id')::uuid;
  insert into pg_temp.bk values ('hebdo', id1);
  if pg_temp.berr(format('select public.coach_template_save(null, %L, %L)', '   ', jsonb_build_array(pg_temp.bi('weight')))) <> 'invalid_template' then raise 'nom vide'; end if;
  if pg_temp.berr(format('select public.coach_template_save(null, %L, %L)', 'X', '[]')) <> 'invalid_template' then raise 'aucun suivi'; end if;
  if pg_temp.berr(format('select public.coach_template_save(null, %L, %L)', 'X', jsonb_build_array(pg_temp.bi('weight') || '{"label": " Poids"}'))) <> 'invalid_template' then raise 'intitulé pas propre accepté'; end if;
  if pg_temp.berr(format('select public.coach_template_save(null, %L, %L)', 'X', jsonb_build_array(pg_temp.bi('cycle') || '{"required": true}'))) <> 'invalid_template' then raise 'cycle obligatoire accepté'; end if;
  if pg_temp.berr(format('select public.coach_template_save(null, %L, %L)', 'X', jsonb_build_array(pg_temp.bi('weight'), pg_temp.bi('weight')))) <> 'invalid_template' then raise 'doublon'; end if;
  if pg_temp.berr(format('select public.coach_template_save(null, %L, null)', 'X')) <> 'invalid_template' then raise 'suivis null'; end if;
  -- Remplacer : même suivis = même version ; suivis changés = version + 1
  r := public.coach_template_save(id1, 'Hebdo', jsonb_build_array(pg_temp.bi('weight'), pg_temp.bi('sleep'), pg_temp.bi('photos'), pg_temp.bi('cycle'), pg_temp.bi('question')));
  if (r ->> 'version')::int <> 1 or r ->> 'name' <> 'Hebdo' then raise 'renommé : %', r; end if;
  -- Un modèle d'un autre coach : not_found
  perform pg_temp.blogin('l');
  if pg_temp.berr(format('select public.coach_template_save(%L, %L, %L)', id1, 'Vol', jsonb_build_array(pg_temp.bi('weight')))) <> 'not_found' then raise 'modèle d''un autre coach modifié'; end if;
  if pg_temp.berr(format('select public.coach_template_duplicate(%L)', id1)) <> 'not_found' then raise 'modèle d''un autre coach copié'; end if;
  perform public.coach_template_delete(id1);   -- silencieux, sans effet
  if jsonb_array_length(public.coach_checkin_setup() -> 'templates') <> 0 then raise 'L voit les modèles de K'; end if;
  perform pg_temp.blogin('k');
  if jsonb_array_length(public.coach_checkin_setup() -> 'templates') <> 1 then raise 'modèle de K effacé par L'; end if;
  -- Copie
  r := public.coach_template_duplicate(id1);
  if r ->> 'name' <> 'Copie de Hebdo' or (r ->> 'version')::int <> 1 or r -> 'items' <> public.coach_checkin_setup() -> 'templates' -> 0 -> 'items' then raise 'copie : %', r; end if;
  insert into pg_temp.bk values ('copie', (r ->> 'id')::uuid);
  -- 50 modèles au plus
  for i in 3..50 loop perform public.coach_template_save(null, 'M' || i, jsonb_build_array(pg_temp.bi('sleep'))); end loop;
  if pg_temp.berr(format('select public.coach_template_save(null, %L, %L)', 'M51', jsonb_build_array(pg_temp.bi('sleep')))) <> 'too_many' then raise '51e modèle'; end if;
  if pg_temp.berr(format('select public.coach_template_duplicate(%L)', id1)) <> 'too_many' then raise '51e modèle par copie'; end if;
  perform public.coach_template_delete(id) from (select (t ->> 'id')::uuid as id from jsonb_array_elements(public.coach_checkin_setup() -> 'templates') t
                                                 where t ->> 'name' ~ '^M[0-9]+$') z;
  if jsonb_array_length(public.coach_checkin_setup() -> 'templates') <> 2 then raise 'suppression des modèles'; end if;
  -- Modèle des plannings (poids et sommeil)
  r := public.coach_template_save(null, 'Planifié', jsonb_build_array(pg_temp.bi('weight'), pg_temp.bi('sleep')));
  insert into pg_temp.bk values ('plan', (r ->> 'id')::uuid);
  r := public.coach_template_save(null, 'Groupe', jsonb_build_array(pg_temp.bi('sleep')));
  insert into pg_temp.bk values ('groupe', (r ->> 'id')::uuid);
end $$;

-- ── Groupes ──────────────────────────────────────────────
do $$
declare r jsonb; i int;
begin
  perform pg_temp.blogin('k');
  -- Membres : mes élèves liés seulement (W est l'élève de L, A n'est l'élève de personne), sans doublon, dans l'ordre
  r := public.coach_group_save(null, ' Prépa ', array[pg_temp.bu('t'), pg_temp.bu('w'), pg_temp.bu('s'), pg_temp.bu('a'), pg_temp.bu('t'), pg_temp.bu('u')]);
  if r ->> 'name' <> 'Prépa' or r -> 'members' <> jsonb_build_array(pg_temp.bu('t'), pg_temp.bu('s'), pg_temp.bu('u')) then raise 'groupe : %', r; end if;
  insert into pg_temp.bk values ('prepa', (r ->> 'id')::uuid);
  if pg_temp.berr(format('select public.coach_group_save(null, %L, null)', '  ')) <> 'invalid_group' then raise 'nom de groupe vide'; end if;
  for i in 2..50 loop perform public.coach_group_save(null, 'G' || i, null); end loop;
  if pg_temp.berr(format('select public.coach_group_save(null, %L, null)', 'G51')) <> 'too_many' then raise '51e groupe'; end if;
  perform public.coach_group_delete((g ->> 'id')::uuid) from jsonb_array_elements(public.coach_checkin_setup() -> 'groups') g where g ->> 'name' ~ '^G[0-9]+$';
  if jsonb_array_length(public.coach_checkin_setup() -> 'groups') <> 1 then raise 'suppression des groupes'; end if;
  perform pg_temp.blogin('l');
  if pg_temp.berr(format('select public.coach_group_save(%L, %L, null)', (select v from pg_temp.bk where k = 'prepa'), 'Vol')) <> 'not_found' then raise 'groupe d''un autre coach'; end if;
end $$;
reset role;
do $$ begin
  -- 500 membres au plus (élèves factices liés à K le temps du test)
  insert into auth.users (id) select ('00000000-0000-0000-0000-0000bc' || lpad(i::text, 6, '0'))::uuid from generate_series(1, 501) i;
  insert into public.coach_links (student_id, coach_id) select ('00000000-0000-0000-0000-0000bc' || lpad(i::text, 6, '0'))::uuid, pg_temp.bu('k') from generate_series(1, 501) i;
  perform pg_temp.blogin('k');
  if jsonb_array_length(public.coach_group_save(null, 'Tous', (select array_agg(('00000000-0000-0000-0000-0000bc' || lpad(i::text, 6, '0'))::uuid order by i) from generate_series(1, 501) i)) -> 'members') <> 500 then
    raise '500 membres au plus'; end if;
  perform public.coach_group_delete(g.id) from public.coach_groups g where g.coach_id = pg_temp.bu('k') and g.name = 'Tous';
  delete from auth.users where id::text like '00000000-0000-0000-0000-0000bc%';
end $$;
set role authenticated;

-- ── Plannings ────────────────────────────────────────────
do $$
declare r jsonb; tpl uuid := (select v from pg_temp.bk where k = 'plan'); grp uuid := (select v from pg_temp.bk where k = 'prepa');
begin
  perform pg_temp.blogin('k');
  if pg_temp.berr(format('select public.coach_schedule_save(%L, %L, %L)', tpl, pg_temp.bu('s'), grp)) <> 'invalid_schedule' then raise 'deux cibles'; end if;
  if pg_temp.berr(format('select public.coach_schedule_save(%L)', tpl)) <> 'invalid_schedule' then raise 'aucune cible'; end if;
  if pg_temp.berr(format('select public.coach_schedule_save(%L, %L)', tpl, pg_temp.bu('w'))) <> 'not_found' then raise 'élève d''un autre coach'; end if;
  if pg_temp.berr(format('select public.coach_schedule_save(%L, %L)', gen_random_uuid(), pg_temp.bu('s'))) <> 'not_found' then raise 'modèle inconnu'; end if;
  if pg_temp.berr(format('select public.coach_schedule_save(%L, %L, null, %L)', tpl, pg_temp.bu('s'), 'daily')) <> 'invalid_schedule' then raise 'fréquence'; end if;
  if pg_temp.berr(format('select public.coach_schedule_save(%L, %L, null, %L, 7)', tpl, pg_temp.bu('s'), 'week')) <> 'invalid_schedule' then raise 'jour 7'; end if;
  if pg_temp.berr(format('select public.coach_schedule_save(%L, %L, null, %L, 0, 29)', tpl, pg_temp.bu('s'), 'month')) <> 'invalid_schedule' then raise 'le 29'; end if;
  if pg_temp.berr(format('select public.coach_schedule_save(%L, %L, null, %L, 0, 1, 24)', tpl, pg_temp.bu('s'), 'week')) <> 'invalid_schedule' then raise '24 h'; end if;
  if pg_temp.berr(format('select public.coach_schedule_save(%L, %L, null, %L, 0, 1, 18, %L)', tpl, pg_temp.bu('s'), 'week', 'Mars/Olympus')) <> 'invalid_schedule' then raise 'fuseau inconnu'; end if;
  if pg_temp.berr(format('select public.coach_schedule_save(%L, %L, null, %L, 0, 1, 18, %L, 169)', tpl, pg_temp.bu('s'), 'week', 'Europe/Paris')) <> 'invalid_schedule' then raise 'rappel 169 h'; end if;
  if pg_temp.berr(format('select public.coach_schedule_save(%L, %L, null, %L, 0, 1, 18, %L, null, 337)', tpl, pg_temp.bu('s'), 'week', 'Europe/Paris')) <> 'invalid_schedule' then raise 'échéance 337 h'; end if;
  -- S : chaque dimanche à 18 h (Paris), rappel 24 h après, échéance 48 h
  r := public.coach_schedule_save(tpl, pg_temp.bu('s'), null, 'week', 0, 1, 18, 'Europe/Paris', 24, 48, false);
  if (r ->> 'next_at')::timestamptz <= now() or (r ->> 'next_at')::timestamptz > now() + interval '7 days'
     or extract(dow from ((r ->> 'next_at')::timestamptz at time zone 'Europe/Paris')) <> 0
     or extract(hour from ((r ->> 'next_at')::timestamptz at time zone 'Europe/Paris')) <> 18 then raise 'prochain envoi : %', r; end if;
  insert into pg_temp.bk values ('plan_s', (r ->> 'id')::uuid);
  -- Remplacé pour la même cible (pas un second planning) ; en pause : pas de prochain envoi ; à la demande : non plus
  r := public.coach_schedule_save(tpl, pg_temp.bu('s'), null, 'week', 0, 1, 18, 'Europe/Paris', 24, 48, true);
  if (r ->> 'id')::uuid <> (select v from pg_temp.bk where k = 'plan_s') or r -> 'next_at' <> 'null' or not (r ->> 'paused')::boolean then raise 'pause : %', r; end if;
  r := public.coach_schedule_save(tpl, pg_temp.bu('s'), null, 'manual', 0, 1, 18, 'Europe/Paris', 24, 48, false);
  if r -> 'next_at' <> 'null' then raise 'à la demande : %', r; end if;
  r := public.coach_schedule_save(tpl, pg_temp.bu('s'), null, 'week', 0, 1, 18, 'Europe/Paris', 24, 48, false);
  if jsonb_array_length(public.coach_checkin_setup() -> 'schedules') <> 1 then raise 'un seul planning pour S et ce modèle'; end if;
  -- L ne supprime pas le planning de K
  perform pg_temp.blogin('l');
  perform public.coach_schedule_delete((r ->> 'id')::uuid);
  perform pg_temp.blogin('k');
  if jsonb_array_length(public.coach_checkin_setup() -> 'schedules') <> 1 then raise 'planning de K supprimé par L'; end if;
end $$;
reset role;

-- Prochain envoi : jour et heure LOCAUX, sans décalage à l'heure d'été (Paris : dimanche 25 octobre 2026 à 3 h)
do $$ begin
  if private.checkin_next_at('week', 0, 1, 18, 'Europe/Paris', '2026-10-12 00:00+00') <> '2026-10-18 16:00+00' then raise 'dimanche 18 h, heure d''été'; end if;
  if private.checkin_next_at('week', 0, 1, 18, 'Europe/Paris', '2026-10-20 00:00+00') <> '2026-10-25 17:00+00' then raise 'dimanche 18 h, heure d''hiver'; end if;
  if private.checkin_next_at('week', 0, 1, 18, 'Europe/Paris', '2026-10-18 16:00+00') <> '2026-10-25 17:00+00' then raise 'strictement après'; end if;
  if private.checkin_next_at('week', 0, 1, 18, 'Europe/Paris', '2026-10-18 15:59+00') <> '2026-10-18 16:00+00' then raise 'le jour même'; end if;
  if private.checkin_advance('week', 1, 18, 'Europe/Paris', '2026-10-18 16:00+00') <> '2026-10-25 17:00+00' then raise 'semaine suivante'; end if;
  if private.checkin_advance('2weeks', 1, 18, 'Europe/Paris', '2026-10-18 16:00+00') <> '2026-11-01 17:00+00' then raise 'deux semaines'; end if;
  if private.checkin_advance('month', 28, 8, 'Europe/Paris', '2026-03-28 07:00+00') <> '2026-04-28 06:00+00' then raise 'mois, heure d''été de mars'; end if;
  if private.checkin_next_at('month', 0, 1, 9, 'America/New_York', '2026-10-15 00:00+00') <> '2026-11-01 14:00+00' then raise 'New York, fin de l''heure d''été'; end if;
  if private.checkin_next_at('month', 0, 28, 9, 'Europe/Paris', '2026-10-28 09:00+00') <> '2026-11-28 08:00+00' then raise 'mois suivant'; end if;
  if private.checkin_next_at('manual', 0, 1, 9, 'Europe/Paris', now()) is not null then raise 'à la demande : jamais'; end if;
end $$;

-- ── Envoi à la demande, réponses de l'élève ──────────────
set role authenticated;
do $$
declare r jsonb; hebdo uuid := (select v from pg_temp.bk where k = 'hebdo'); req uuid; at1 text;
begin
  perform pg_temp.blogin('k');
  -- S, T et U reçoivent ; W (élève de L) et A sont ignorés ; S en double compte une fois
  r := public.coach_checkin_send_now(hebdo, array[pg_temp.bu('s'), pg_temp.bu('t'), pg_temp.bu('w'), pg_temp.bu('a'), pg_temp.bu('s'), pg_temp.bu('u')]);
  if (r ->> 'sent')::int <> 3 then raise 'envoyés : %', r; end if;
  -- Déjà ouverte : pas doublée
  if (public.coach_checkin_send_now(hebdo, array[pg_temp.bu('s')]) ->> 'sent')::int <> 0 then raise 'demande doublée'; end if;
  if pg_temp.berr(format('select public.coach_checkin_send_now(%L, %L)', gen_random_uuid(), array[pg_temp.bu('s')])) <> 'not_found' then raise 'modèle inconnu'; end if;
  perform pg_temp.blogin('l');
  if pg_temp.berr(format('select public.coach_checkin_send_now(%L, %L)', hebdo, array[pg_temp.bu('w')])) <> 'not_found' then raise 'modèle d''un autre coach envoyé'; end if;
  perform pg_temp.blogin('s');
  if pg_temp.berr(format('select public.coach_checkin_send_now(%L, %L)', hebdo, array[pg_temp.bu('t')])) <> 'not_coach' then raise 'élève qui envoie'; end if;

  -- Élève S : une demande ouverte, sans le cycle (pas d'accord)
  r := public.student_checkins();
  if jsonb_array_length(r -> 'requests') <> 1 or (r -> 'cycle' ->> 'consented')::boolean or not (r -> 'cycle' ->> 'asked')::boolean then raise 'élève : %', r; end if;
  req := (r -> 'requests' -> 0 ->> 'id')::uuid;
  insert into pg_temp.bk values ('req_s', req);
  if r -> 'requests' -> 0 ->> 'coach_id' <> pg_temp.bu('k')::text or r -> 'requests' -> 0 -> 'review' <> 'null' then raise 'demande : %', r; end if;
  if exists (select 1 from jsonb_array_elements(r -> 'requests' -> 0 -> 'items') e where e ->> 'kind' = 'cycle') then raise 'cycle rendu sans accord'; end if;
  if jsonb_array_length(r -> 'requests' -> 0 -> 'items') <> 4 then raise 'suivis rendus : %', r -> 'requests' -> 0 -> 'items'; end if;

  -- Réponses refusées
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, '[]')) <> 'invalid_answer' then raise 'pas un objet'; end if;
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, '{"sleep": 3}')) <> 'invalid_answer' then raise 'obligatoire manquant (poids)'; end if;
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, '{"weight": 70, "mood": 3}')) <> 'invalid_answer' then raise 'suivi inconnu'; end if;
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, '{"weight": "70"}')) <> 'invalid_answer' then raise 'nombre en texte'; end if;
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, '{"weight": 70, "sleep": 6}')) <> 'invalid_answer' then raise 'échelle'; end if;
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, '{"weight": 70, "sleep": null}')) <> 'invalid_answer' then raise 'null'; end if;
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, '{"weight": 70, "qabc12345": " Dur "}')) <> 'invalid_answer' then raise 'texte pas propre'; end if;
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, '{"weight": 70, "cycle": "luteal"}')) <> 'no_consent' then raise 'cycle sans accord'; end if;
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, '{"weight": 70, "cycle": "autre"}')) <> 'invalid_answer' then raise 'phase inconnue'; end if;
  -- Photos : une prête de S chez K, oui ; en cours, d'un autre élève, inconnue : non
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, jsonb_build_object('weight', 70, 'photos', jsonb_build_object('ids', jsonb_build_array(pg_temp.bph(2)))))) <> 'invalid_answer' then raise 'photo en cours'; end if;
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, jsonb_build_object('weight', 70, 'photos', jsonb_build_object('ids', jsonb_build_array(pg_temp.bph(3)))))) <> 'invalid_answer' then raise 'photo d''un autre élève'; end if;
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, jsonb_build_object('weight', 70, 'photos', jsonb_build_object('ids', jsonb_build_array(pg_temp.bph(9)))))) <> 'invalid_answer' then raise 'photo inconnue'; end if;
  -- Un autre élève ne répond pas à la demande de S
  perform pg_temp.blogin('t');
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, '{"weight": 70}')) <> 'not_found' then raise 'T répond pour S'; end if;
  perform pg_temp.blogin('k');
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', req, '{"weight": 70}')) <> 'not_found' then raise 'le coach répond'; end if;

  -- Accord du cycle : 18 ans exigés, puis réponse acceptée
  perform pg_temp.blogin('s');
  if pg_temp.berr('select public.student_checkin_cycle(true, false)') <> 'not_adult' then raise 'accord sans 18 ans'; end if;
  if pg_temp.berr('select public.student_checkin_cycle(true)') <> 'not_adult' then raise 'accord sans déclaration'; end if;
  if (public.student_checkin_cycle(true, true) ->> 'consented')::boolean is not true then raise 'accord'; end if;
  r := public.student_checkins();
  if not (r -> 'cycle' ->> 'consented')::boolean or (r -> 'cycle' ->> 'asked')::boolean or jsonb_array_length(r -> 'requests' -> 0 -> 'items') <> 5 then raise 'cycle rendu avec accord : %', r; end if;
  r := public.student_checkin_answer(req, jsonb_build_object('weight', 70.5, 'sleep', 4, 'cycle', 'luteal', 'qabc12345', E'Genou\nun peu',
                                                            'photos', jsonb_build_object('ids', jsonb_build_array(pg_temp.bph(1)))));
  at1 := r ->> 'answered_at';
  if at1 is null then raise 'réponse : %', r; end if;
  -- Idempotent : même date, rien de changé
  r := public.student_checkin_answer(req, '{"weight": 99}');
  if r ->> 'answered_at' <> at1 then raise 'deuxième réponse : %', r; end if;
  r := public.student_checkins();
  if r -> 'requests' -> 0 ->> 'answered_at' <> at1 then raise 'répondue : %', r; end if;
  -- A (personne) : rien ; sans accord, sans coach : not_found
  perform pg_temp.blogin('a');
  if (public.student_checkins() - 'adult' - 'adult_asked' - 'health') <> '{"requests": [], "cycle": {"consented": false, "asked": false}}' then raise 'A voit des bilans'; end if;
  if pg_temp.berr('select public.student_checkin_cycle(true, true)') <> 'not_found' then raise 'accord sans coach'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  if pg_temp.berr('select public.student_checkins()') <> 'not_signed_in' then raise 'sans compte'; end if;
end $$;

-- ── Lecture et retour du coach ───────────────────────────
do $$
declare r jsonb; req uuid := (select v from pg_temp.bk where k = 'req_s'); req_t uuid;
begin
  perform pg_temp.blogin('k');
  r := public.coach_student_checkins(pg_temp.bu('s'));
  if jsonb_array_length(r) <> 1 or r -> 0 -> 'answers' <> jsonb_build_object('weight', 70.5, 'sleep', 4, 'cycle', 'luteal', 'qabc12345', E'Genou\nun peu',
       'photos', jsonb_build_object('ids', jsonb_build_array(pg_temp.bph(1)))) then raise 'réponses lues : %', r; end if;
  if r -> 0 -> 'review' <> 'null' or r -> 0 ->> 'student_id' <> pg_temp.bu('s')::text then raise 'fiche : %', r; end if;
  r := public.coach_checkins_overview();
  if jsonb_array_length(r) <> 3 or not exists (select 1 from jsonb_array_elements(r) e where e ->> 'request_id' = req::text and e ->> 'answered_at' is not null and not (e ->> 'reviewed')::boolean) then
    raise 'tableau de bord : %', r; end if;
  -- Retour : pas répondu, trop long, note hors bornes, envoi vide
  req_t := (select (e ->> 'request_id')::uuid from jsonb_array_elements(r) e where e ->> 'student_id' = pg_temp.bu('t')::text);
  insert into pg_temp.bk values ('req_t', req_t);
  if pg_temp.berr(format('select public.coach_checkin_review(%L, %L, null, true)', req_t, 'Bravo')) <> 'not_answered' then raise 'pas répondu'; end if;
  if pg_temp.berr(format('select public.coach_checkin_review(%L, %L, null, false)', req, repeat('a', 2001))) <> 'too_long' then raise 'trop long'; end if;
  if pg_temp.berr(format('select public.coach_checkin_review(%L, %L, 11, false)', req, 'ok')) <> 'invalid_score' then raise 'note 11'; end if;
  if pg_temp.berr(format('select public.coach_checkin_review(%L, %L, null, true)', req, '  ')) <> 'empty_reply' then raise 'envoi vide'; end if;
  -- Brouillon : l'élève ne le voit pas
  r := public.coach_checkin_review(req, ' Très bien  la semaine ', 8, false);
  if r ->> 'reply' <> 'Très bien la semaine' or (r ->> 'score')::int <> 8 or (r ->> 'sent')::boolean then raise 'brouillon : %', r; end if;
  perform pg_temp.blogin('s');
  if public.student_checkins() -> 'requests' -> 0 -> 'review' <> 'null' then raise 'brouillon vu par l''élève'; end if;
  perform pg_temp.blogin('k');
  r := public.coach_checkin_review(req, repeat('é', 2000), 9, true);
  if not (r ->> 'sent')::boolean then raise 'envoi : %', r; end if;
  -- Un brouillon ensuite ne retire pas l'envoi
  r := public.coach_checkin_review(req, 'Bravo pour la semaine', 9, false);
  if not (r ->> 'sent')::boolean then raise 'envoi retiré par un brouillon'; end if;
  perform pg_temp.blogin('s');
  r := public.student_checkins() -> 'requests' -> 0 -> 'review';
  if r ->> 'reply' <> 'Bravo pour la semaine' or r ? 'score' or r ->> 'reviewed_at' is null then raise 'retour vu par l''élève : %', r; end if;
  -- Autre coach, élève, non-élève : not_found
  perform pg_temp.blogin('l');
  if pg_temp.berr(format('select public.coach_student_checkins(%L)', pg_temp.bu('s'))) <> 'not_found' then raise 'autre coach lit S'; end if;
  if pg_temp.berr(format('select public.coach_checkin_review(%L, %L, null, false)', req, 'x')) <> 'not_found' then raise 'autre coach répond'; end if;
  if jsonb_array_length(public.coach_checkins_overview()) <> 0 then raise 'tableau de bord de L'; end if;
  perform pg_temp.blogin('k');
  if pg_temp.berr(format('select public.coach_student_checkins(%L)', pg_temp.bu('a'))) <> 'not_found' then raise 'non-élève'; end if;
  perform pg_temp.blogin('t');
  if pg_temp.berr(format('select public.coach_student_checkins(%L)', pg_temp.bu('s'))) <> 'not_found' then raise 'élève qui lit un élève'; end if;
end $$;

-- Copie figée : modifier puis supprimer le modèle ne change pas une demande envoyée
do $$
declare hebdo uuid := (select v from pg_temp.bk where k = 'hebdo'); r jsonb; before jsonb;
begin
  perform pg_temp.blogin('k');
  before := public.coach_student_checkins(pg_temp.bu('t')) -> 0 -> 'items';
  r := public.coach_template_save(hebdo, 'Hebdo v2', jsonb_build_array(pg_temp.bi('sleep')));
  if (r ->> 'version')::int <> 2 then raise 'version : %', r; end if;
  if public.coach_student_checkins(pg_temp.bu('t')) -> 0 -> 'items' <> before or public.coach_student_checkins(pg_temp.bu('t')) -> 0 ->> 'name' <> 'Hebdo' then
    raise 'demande changée par le modèle'; end if;
  perform public.coach_template_delete(hebdo);
  r := public.coach_student_checkins(pg_temp.bu('t')) -> 0;
  if r -> 'items' <> before or r -> 'template_id' <> 'null' then raise 'demande après suppression du modèle : %', r; end if;
  -- T peut encore y répondre (poids seul : sommeil, photos, question passés)
  perform pg_temp.blogin('t');
  perform public.student_checkin_answer((select v from pg_temp.bk where k = 'req_t'), '{"weight": 80}');
end $$;
reset role;

do $$ begin
  if (select r.template_version from public.coach_checkin_requests r where r.id = (select v from pg_temp.bk where k = 'req_t')) <> 1 then raise 'version de la copie'; end if;
  -- Notifications en file : S (réglage allumé, appareil) une ligne checkin par demande ; T (réglage éteint) rien
  if (select count(*) from private.push_outbox o where o.recipient = pg_temp.bu('s') and o.kind = 'checkin' and o.actor = pg_temp.bu('k')
        and o.ref = (select v from pg_temp.bk where k = 'req_s')::text) <> 1 then raise 'notification de S'; end if;
  if exists (select 1 from private.push_outbox o where o.recipient = pg_temp.bu('t')) then raise 'T notifié réglage éteint'; end if;
  -- U n'a pas d'appareil : rien
  if exists (select 1 from private.push_outbox o where o.recipient = pg_temp.bu('u')) then raise 'U notifié sans appareil'; end if;
end $$;

-- push_claim : une demande ouverte part (ref = id de la demande) ; répondue, elle n'est plus voulue
do $$
declare r jsonb; open_id uuid;
begin
  -- Nouvelle demande pour S (le modèle copie), encore ouverte
  perform pg_temp.blogin('k');
  perform public.coach_checkin_send_now((select v from pg_temp.bk where k = 'copie'), array[pg_temp.bu('s')]);
  open_id := (select r2.id from public.coach_checkin_requests r2 where r2.student_id = pg_temp.bu('s') and r2.answered_at is null);
  insert into pg_temp.bk values ('req_s2', open_id);
  r := public.push_claim(200);
  if not exists (select 1 from jsonb_array_elements(r) e where e ->> 'kind' = 'checkin' and e ->> 'ref' = open_id::text and (e ->> 'wanted')::boolean
                 and e ->> 'actor_name' = 'bil0.k') then raise 'push_claim, demande ouverte : %', r; end if;
  if not exists (select 1 from jsonb_array_elements(r) e where e ->> 'kind' = 'checkin' and e ->> 'ref' = '' and not (e ->> 'wanted')::boolean) then
    raise 'push_claim, demande répondue encore voulue : %', r; end if;
end $$;

-- Retirer l'accord du cycle efface toutes mes réponses au cycle
set role authenticated;
do $$ begin
  perform pg_temp.blogin('s');
  if (public.student_checkin_cycle(false) ->> 'consented')::boolean then raise 'retrait'; end if;
  perform pg_temp.blogin('k');
  if public.coach_student_checkins(pg_temp.bu('s')) -> 1 -> 'answers' ? 'cycle' then raise 'réponse au cycle gardée'; end if;
  if not (public.coach_student_checkins(pg_temp.bu('s')) -> 1 -> 'answers' ? 'weight') then raise 'autres réponses effacées'; end if;
  perform pg_temp.blogin('s');
  if exists (select 1 from jsonb_array_elements(public.student_checkins() -> 'requests') q, jsonb_array_elements(q -> 'items') e where e ->> 'kind' = 'cycle') then
    raise 'cycle rendu après retrait'; end if;
  if not (public.student_checkins() -> 'cycle' ->> 'asked')::boolean then raise 'accord pas reproposé'; end if;
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', (select v from pg_temp.bk where k = 'req_s2'), '{"weight": 70, "cycle": "menses"}')) <> 'no_consent' then
    raise 'cycle après retrait'; end if;
end $$;

-- Limite : 30 envois à la demande par 24 h
do $$
declare n int;
begin
  perform pg_temp.blogin('k');
  for n in 1..30 loop
    exit when pg_temp.berr(format('select public.coach_checkin_send_now(%L, %L)', (select v from pg_temp.bk where k = 'copie'), array[pg_temp.bu('v')])) = 'rate_limited';
  end loop;
  if n > 28 or pg_temp.berr(format('select public.coach_checkin_send_now(%L, %L)', (select v from pg_temp.bk where k = 'copie'), array[pg_temp.bu('v')])) <> 'rate_limited' then
    raise 'limite des envois (% passés)', n; end if;
end $$;
reset role;
delete from private.social_rate where user_id = pg_temp.bu('k') and action = 'checkin_send';

-- ── Blocage, coach dont le rôle est retiré ──────────────
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.bu('v'), pg_temp.bu('k'));
set role authenticated;
do $$ begin
  perform pg_temp.blogin('k');
  if pg_temp.berr(format('select public.coach_student_checkins(%L)', pg_temp.bu('v'))) <> 'not_found' then raise 'coach lit un élève qui l''a bloqué'; end if;
  if exists (select 1 from jsonb_array_elements(public.coach_checkins_overview()) e where e ->> 'student_id' = pg_temp.bu('v')::text) then raise 'tableau de bord : bloqué'; end if;
  if (public.coach_checkin_send_now((select v from pg_temp.bk where k = 'plan'), array[pg_temp.bu('v')]) ->> 'sent')::int <> 0 then raise 'envoi à un élève bloqué'; end if;
  if pg_temp.berr(format('select public.coach_schedule_save(%L, %L)', (select v from pg_temp.bk where k = 'plan'), pg_temp.bu('v'))) <> 'not_found' then raise 'planning pour un bloqué'; end if;
  perform pg_temp.blogin('v');
  if jsonb_array_length(public.student_checkins() -> 'requests') <> 0 then raise 'élève qui a bloqué son coach voit ses bilans'; end if;
  -- Coach X (élève Y) : il perd son rôle
  perform pg_temp.blogin('x');
  perform public.coach_template_save(null, 'X', jsonb_build_array(pg_temp.bi('sleep')));
  perform public.coach_checkin_send_now((public.coach_checkin_setup() -> 'templates' -> 0 ->> 'id')::uuid, array[pg_temp.bu('y')]);
  perform public.coach_schedule_save((public.coach_checkin_setup() -> 'templates' -> 0 ->> 'id')::uuid, pg_temp.bu('y'));
end $$;
reset role;
update public.user_profiles set coach_at = null where user_id = pg_temp.bu('x');
update public.coach_checkin_schedules set next_at = now() - interval '1 minute' where coach_id = pg_temp.bu('x');
set role authenticated;
do $$ begin
  perform pg_temp.blogin('x');
  if pg_temp.berr(format('select public.coach_student_checkins(%L)', pg_temp.bu('y'))) <> 'not_found' then raise 'ex-coach lit son élève'; end if;
  if pg_temp.berr('select public.coach_checkin_setup()') <> 'not_coach' then raise 'ex-coach : setup'; end if;
  if pg_temp.berr('select public.coach_checkins_overview()') <> 'not_coach' then raise 'ex-coach : tableau de bord'; end if;
end $$;
reset role;
do $$ begin
  -- L'envoi planifié ne crée rien pour un ex-coach, mais avance son planning
  perform private.checkin_tick();
  if (select count(*) from public.coach_checkin_requests r where r.student_id = pg_temp.bu('y')) <> 1 then raise 'envoi planifié d''un ex-coach'; end if;
  if (select s.next_at <= now() from public.coach_checkin_schedules s where s.coach_id = pg_temp.bu('x')) then raise 'planning de l''ex-coach pas avancé'; end if;
end $$;

-- ── Envoi planifié ───────────────────────────────────────
-- Planning de S (dimanche 18 h, Paris, rappel 24 h, échéance 48 h) ramené avant le passage à l'heure d'hiver
update public.coach_checkin_schedules set next_at = '2026-10-18 16:00+00' where id = (select v from pg_temp.bk where k = 'plan_s');
delete from private.push_outbox where recipient = pg_temp.bu('s');
do $$
declare r public.coach_checkin_requests%rowtype; first uuid; plan uuid := (select v from pg_temp.bk where k = 'plan');
begin
  if private.checkin_tick('2026-10-18 15:59+00') <> 0 then raise 'avant l''heure'; end if;
  if private.checkin_tick('2026-10-18 16:05+00') <> 1 then raise 'à l''heure'; end if;
  select * into r from public.coach_checkin_requests x where x.template_id = plan and x.student_id = pg_temp.bu('s');
  if r.period_start <> '2026-10-18' or r.sent_at <> '2026-10-18 16:05+00' or r.due_at <> '2026-10-20 16:05+00' or r.remind_at <> '2026-10-19 16:05+00'
     or r.schedule_id <> (select v from pg_temp.bk where k = 'plan_s') or r.name <> 'Planifié' then raise 'demande planifiée : %', row_to_json(r); end if;
  first := r.id;
  if (select s.next_at from public.coach_checkin_schedules s where s.id = (select v from pg_temp.bk where k = 'plan_s')) <> '2026-10-25 17:00+00' then
    raise 'heure d''hiver : prochain envoi %', (select s.next_at from public.coach_checkin_schedules s where s.id = (select v from pg_temp.bk where k = 'plan_s')); end if;
  if (select count(*) from private.push_outbox o where o.recipient = pg_temp.bu('s') and o.kind = 'checkin' and o.ref = first::text) <> 1 then raise 'notification planifiée'; end if;
  -- Rappel une fois, à remind_at
  if private.checkin_tick('2026-10-19 16:00+00') <> 0 then raise 'demande en trop'; end if;
  if exists (select 1 from private.push_outbox o where o.kind = 'checkin_reminder') then raise 'rappel trop tôt'; end if;
  perform private.checkin_tick('2026-10-19 16:10+00');
  perform private.checkin_tick('2026-10-19 16:20+00');
  if (select count(*) from private.push_outbox o where o.recipient = pg_temp.bu('s') and o.kind = 'checkin_reminder' and o.actor = pg_temp.bu('k') and o.ref = first::text) <> 1 then
    raise 'rappel : % ligne(s)', (select count(*) from private.push_outbox o where o.kind = 'checkin_reminder'); end if;
  if (select x.reminded_at from public.coach_checkin_requests x where x.id = first) <> '2026-10-19 16:10+00' then raise 'rappel noté'; end if;
  -- Dimanche 25 octobre : 18 h à Paris = 17 h UTC (heure d'hiver)
  if private.checkin_tick('2026-10-25 16:30+00') <> 0 then raise 'heure d''été appliquée à tort'; end if;
  if private.checkin_tick('2026-10-25 17:00+00') <> 1 then raise 'dimanche 25 à 18 h'; end if;
  if (select x.cancelled_at from public.coach_checkin_requests x where x.id = first) <> '2026-10-25 17:00+00' then raise 'demande précédente pas fermée'; end if;
  if (select count(*) from public.coach_checkin_requests x where x.template_id = plan and x.student_id = pg_temp.bu('s') and x.answered_at is null and x.cancelled_at is null) <> 1 then
    raise 'une seule demande ouverte'; end if;
  -- Fermée : closed, et plus de notification valable
  perform set_config('request.jwt.claim.sub', pg_temp.bu('s')::text, false);
  if pg_temp.berr(format('select public.student_checkin_answer(%L, %L)', first, '{"weight": 70}')) <> 'closed' then raise 'réponse à une demande fermée'; end if;
  if private.push_valid('checkin_reminder', pg_temp.bu('s'), pg_temp.bu('k'), first::text) then raise 'notification d''une demande fermée'; end if;
  -- Arrêt de trois semaines : une seule demande, pas de rattrapage, prochain envoi dans le futur
  if private.checkin_tick('2026-11-22 17:30+00') <> 1 then raise 'reprise après arrêt'; end if;
  if (select s.next_at from public.coach_checkin_schedules s where s.id = (select v from pg_temp.bk where k = 'plan_s')) <> '2026-11-29 17:00+00' then raise 'prochain envoi après arrêt'; end if;
  -- Pause : rien
  update public.coach_checkin_schedules s set paused_at = now() where s.id = (select v from pg_temp.bk where k = 'plan_s');
  if private.checkin_tick('2026-11-29 17:05+00') <> 0 then raise 'planning en pause envoyé'; end if;
end $$;

-- Groupe et planning de l'élève : le planning de U (en pause) passe avant celui de son groupe ; fuseau de New York
set role authenticated;
do $$
declare grp uuid := (select v from pg_temp.bk where k = 'prepa'); tpl uuid := (select v from pg_temp.bk where k = 'groupe'); r jsonb;
begin
  perform pg_temp.blogin('k');
  r := public.coach_schedule_save(tpl, null, grp, 'month', 0, 1, 9, 'America/New_York', null, 72, false);
  if (r ->> 'group_id')::uuid <> grp or r -> 'student_id' <> 'null' then raise 'planning du groupe : %', r; end if;
  insert into pg_temp.bk values ('plan_g', (r ->> 'id')::uuid);
  perform public.coach_schedule_save(tpl, pg_temp.bu('u'), null, 'week', 1, 1, 9, 'Europe/Paris', null, 48, true);
end $$;
reset role;
update public.coach_checkin_schedules set next_at = private.checkin_next_at('month', 0, 1, 9, 'America/New_York', '2026-10-15 00:00+00')
  where id = (select v from pg_temp.bk where k = 'plan_g');
do $$
declare tpl uuid := (select v from pg_temp.bk where k = 'groupe');
begin
  if private.checkin_tick('2026-11-01 13:59+00') <> 0 then raise 'New York : 9 h, pas 8 h'; end if;
  if private.checkin_tick('2026-11-01 14:00+00') <> 2 then raise 'groupe : S et T, pas U'; end if;
  if exists (select 1 from public.coach_checkin_requests r where r.template_id = tpl and r.student_id = pg_temp.bu('u')) then raise 'U reçoit le planning du groupe'; end if;
  if (select array_agg(r.student_id order by r.student_id) from public.coach_checkin_requests r where r.template_id = tpl)
     <> array[pg_temp.bu('s'), pg_temp.bu('t')] then raise 'membres servis'; end if;
  if (select max(r.period_start) from public.coach_checkin_requests r where r.template_id = tpl) <> '2026-11-01' then raise 'période locale'; end if;
  if (select s.next_at from public.coach_checkin_schedules s where s.id = (select v from pg_temp.bk where k = 'plan_g')) <> '2026-12-01 14:00+00' then raise 'mois suivant à New York'; end if;
  -- T : réglage éteint, pas de notification ; S : une
  if exists (select 1 from private.push_outbox o where o.recipient = pg_temp.bu('t')) then raise 'T notifié réglage éteint'; end if;
  if not exists (select 1 from private.push_outbox o join public.coach_checkin_requests r on r.id::text = o.ref
                 where o.recipient = pg_temp.bu('s') and o.kind = 'checkin' and r.template_id = tpl) then raise 'S pas notifiée'; end if;
end $$;

-- ── Effacement : départ de l'élève, retrait, suppression du compte ──
do $$
declare n_tpl int; n_grp int;
begin
  n_tpl := (select count(*) from public.coach_checkin_templates t where t.coach_id = pg_temp.bu('k'));
  n_grp := (select count(*) from public.coach_groups g where g.coach_id = pg_temp.bu('k'));
  if not exists (select 1 from public.coach_checkin_reviews v join public.coach_checkin_requests r on r.id = v.request_id where r.student_id = pg_temp.bu('s')) then
    raise 'retour de S absent avant le départ'; end if;
  perform set_config('request.jwt.claim.sub', pg_temp.bu('s')::text, false);
  perform public.student_checkin_cycle(true, true);
  -- S quitte son coach (le lien part)
  delete from public.coach_links l where l.student_id = pg_temp.bu('s');
  if exists (select 1 from public.coach_checkin_requests r where r.student_id = pg_temp.bu('s'))
     or exists (select 1 from public.coach_checkin_answers a where a.request_id in (select v from pg_temp.bk where k in ('req_s', 'req_s2')))
     or exists (select 1 from public.coach_checkin_reviews v where v.request_id = (select v from pg_temp.bk where k = 'req_s'))
     or exists (select 1 from public.checkin_cycle_consents c where c.student_id = pg_temp.bu('s'))
     or exists (select 1 from public.coach_group_members m where m.student_id = pg_temp.bu('s'))
     or exists (select 1 from public.coach_checkin_schedules s where s.student_id = pg_temp.bu('s')) then
    raise 'données de S gardées après son départ'; end if;
  if (select count(*) from public.coach_checkin_templates t where t.coach_id = pg_temp.bu('k')) <> n_tpl
     or (select count(*) from public.coach_groups g where g.coach_id = pg_temp.bu('k')) <> n_grp then raise 'modèles ou groupes du coach effacés'; end if;
  if private.push_valid('checkin', pg_temp.bu('s'), pg_temp.bu('k'), (select v from pg_temp.bk where k = 'req_s2')::text) then raise 'notification après le départ'; end if;
  -- De retour chez le même coach : rien ne revient
  insert into public.coach_links (student_id, coach_id) values (pg_temp.bu('s'), pg_temp.bu('k'));
  if (public.student_checkins() - 'adult' - 'adult_asked' - 'health') <> '{"requests": [], "cycle": {"consented": false, "asked": false}}' then raise 'bilans revenus avec le lien'; end if;
  -- T : compte supprimé
  delete from auth.users where id = pg_temp.bu('t');
  if exists (select 1 from public.coach_checkin_requests r where r.student_id = pg_temp.bu('t'))
     or exists (select 1 from public.coach_group_members m where m.student_id = pg_temp.bu('t')) then raise 'données de T gardées après la suppression'; end if;
  -- U retiré par le coach (lien supprimé) : son planning part, celui du groupe reste
  delete from public.coach_links l where l.student_id = pg_temp.bu('u');
  if exists (select 1 from public.coach_checkin_schedules s where s.student_id = pg_temp.bu('u')) then raise 'planning de U gardé'; end if;
  if not exists (select 1 from public.coach_checkin_schedules s where s.id = (select v from pg_temp.bk where k = 'plan_g')) then raise 'planning du groupe effacé'; end if;
  -- Groupe supprimé : son planning part
  perform set_config('request.jwt.claim.sub', pg_temp.bu('k')::text, false);
  perform public.coach_group_delete((select v from pg_temp.bk where k = 'prepa'));
  if exists (select 1 from public.coach_checkin_schedules s where s.id = (select v from pg_temp.bk where k = 'plan_g')) then raise 'planning d''un groupe supprimé'; end if;
  -- Compte du coach supprimé : modèles, groupes, plannings partis
  delete from auth.users where id = pg_temp.bu('x');
  if exists (select 1 from public.coach_checkin_templates t where t.coach_id = pg_temp.bu('x'))
     or exists (select 1 from public.coach_checkin_requests r where r.coach_id = pg_temp.bu('x')) then raise 'données de l''ex-coach gardées'; end if;
end $$;

-- ── Purge : plus de 24 mois ─────────────────────────────
do $$
declare old uuid; n int;
begin
  insert into public.coach_checkin_requests (coach_id, student_id, template_id, name, items, period_start, sent_at, answered_at)
    values (pg_temp.bu('k'), pg_temp.bu('s'), null, 'Vieux', jsonb_build_array(pg_temp.bi('sleep')), '2024-10-01', now() - interval '24 months 1 day', now() - interval '24 months')
    returning id into old;
  insert into public.coach_checkin_answers values (old, 'sleep', '3');
  insert into public.coach_checkin_requests (coach_id, student_id, template_id, name, items, period_start, sent_at, answered_at)
    values (pg_temp.bu('k'), pg_temp.bu('s'), null, 'Récent', jsonb_build_array(pg_temp.bi('sleep')), '2024-12-01', now() - interval '23 months', now() - interval '23 months');
  n := private.checkin_purge();
  if n <> 1 or exists (select 1 from public.coach_checkin_requests r where r.id = old)
     or exists (select 1 from public.coach_checkin_answers a where a.request_id = old)
     or not exists (select 1 from public.coach_checkin_requests r where r.name = 'Récent') then raise 'purge'; end if;
end $$;

-- Ménage : comptes du test effacés (cascade), file vidée
delete from auth.users where id in (select pg_temp.bu(c) from unnest(array['k', 'l', 'x', 's', 't', 'u', 'v', 'w', 'y', 'a']) c);
