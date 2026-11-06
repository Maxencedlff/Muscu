-- Vérifications de supabase/migrations/20261107000000_photos_bilan.sql (lancées par tests/sql/run.sh) : droits,
-- compartiment privé et ses politiques (storage.objects imité par supabase_stub.sql, l'API Storage par des
-- INSERT / SELECT / DELETE sous le rôle authenticated), clé du coach, préparation, envoi et validation d'une photo,
-- lecture par le seul coach destinataire, retrait, lien rompu, rôle retiré, clé changée, purge, compte supprimé.
-- Chaque bloc échoue (raise) si la règle n'est pas tenue. Valeurs chiffrées factices (le serveur ne lit que leur
-- forme) : aucune vraie clé.
--
-- Comptes simulés (pg_temp.pu('k') → …0000000006b1, l → b2, s → b3, t → b4, a → b5, u → b6) : K kim.p1 et L
-- lea.p1 sont coachs ; S sol.p1 et T tom.p1 élèves de K, U uma.p1 élève de L ; A ami.p1 (ni coach ni élève).

create function pg_temp.perr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.pu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000006b' || translate(c, 'klstau', '123456'))::uuid $$;
create function pg_temp.plogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.pu(c)::text, ''), false) $$;
-- Photo n de l'élève c : identifiant fixe, lisible dans les messages
create function pg_temp.pid(c text, n int) returns uuid language sql immutable as
$$ select ('00000000-0000-4000-8000-0000006b' || translate(c, 'klstau', '123456') || lpad(n::text, 3, '0'))::uuid $$;
-- Clé publique factique (65 octets : 0x04 puis des zéros, ou une autre valeur), IV, clé enveloppée
create function pg_temp.pk(v text default 'A') returns text language sql immutable as
$$ select 'B' || v || repeat('A', 84) || 'A=' $$;
create function pg_temp.prep(c text, n int, day date default date '2026-11-05', pose text default 'face', kid text default repeat('a', 32))
  returns text language plpgsql as
$$
begin
  return public.student_photo_prepare(pg_temp.pid(c, n), kid, day, pose, pg_temp.pk(), repeat('A', 16)) ->> 'path';
exception when others then return sqlerrm;
end
$$;
-- Ce que fait l'API Storage pour un envoi (INSERT sous le rôle de l'appelant, RLS appliquée)
create function pg_temp.upload(path text, size int default 180000) returns text language plpgsql as
$$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('coach-photos', path, (select auth.uid())::text, jsonb_build_object('size', size, 'mimetype', 'application/octet-stream'));
  return 'ok';
exception when others then return sqlerrm;
end
$$;
create function pg_temp.visible(path text) returns boolean language sql as
$$ select exists (select 1 from storage.objects o where o.bucket_id = 'coach-photos' and o.name = path) $$;
grant execute on function pg_temp.perr(text), pg_temp.pu(text), pg_temp.plogin(text), pg_temp.pid(text, int), pg_temp.pk(text),
  pg_temp.prep(text, int, date, text, text), pg_temp.upload(text, int), pg_temp.visible(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.pu(c) from unnest(array['k', 'l', 's', 't', 'a', 'u']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.pu('k'), 'kim.p1', '🦁'), (pg_temp.pu('l'), 'lea.p1', '🦊'), (pg_temp.pu('s'), 'sol.p1', '🦅'),
  (pg_temp.pu('t'), 'tom.p1', '🐼'), (pg_temp.pu('a'), 'ami.p1', '⭐'), (pg_temp.pu('u'), 'uma.p1', '🐻');
update public.user_profiles set coach_at = now() where user_id in (pg_temp.pu('k'), pg_temp.pu('l'));
insert into public.coach_links (student_id, coach_id) values
  (pg_temp.pu('s'), pg_temp.pu('k')), (pg_temp.pu('t'), pg_temp.pu('k')), (pg_temp.pu('u'), pg_temp.pu('l'));

-- ── Droits, compartiment, politiques ─────────────────────
do $$
declare f text; r text;
begin
  foreach f in array array['public.coach_photo_keys', 'public.coach_photo_adults', 'public.coach_photos', 'private.coach_photo_trash'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = f::regclass) then raise 'RLS désactivée : %', f; end if;
    if exists (select 1 from pg_policies p where p.schemaname || '.' || p.tablename = f) then raise 'politique inattendue : %', f; end if;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if has_table_privilege(r, f, 'select') or has_table_privilege(r, f, 'insert') or has_table_privilege(r, f, 'update')
         or has_table_privilege(r, f, 'delete') then raise 'droit direct sur % pour %', f, r; end if;
    end loop;
  end loop;
  foreach f in array array['public.coach_photo_key()', 'public.coach_photo_key_set(text,text,text,text,boolean)', 'public.student_photo_state()',
      'public.student_photo_prepare(uuid,text,date,text,text,text)', 'public.student_photo_commit(uuid)', 'public.student_photo_remove(uuid)',
      'public.coach_student_photos(uuid)', 'public.student_photo_adult()', 'public.coach_photo_hide(uuid)'] loop
    if has_function_privilege('anon', f, 'execute') then raise 'anon exécute %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise 'authenticated n''exécute pas %', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure) then raise 'security definer / search_path : %', f; end if;
  end loop;
  foreach f in array array['public.srv_coach_photo_purge_claim(int)', 'public.srv_coach_photo_purge_done(text[])'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise 'purge exécutable par l''app : %', f; end if;
    if not has_function_privilege('service_role', f, 'execute') then raise 'service_role n''exécute pas %', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure) then raise 'security definer / search_path : %', f; end if;
  end loop;
  foreach f in array array['private.coach_photo_path(uuid,uuid)', 'private.coach_photo_trashed()', 'private.b64_bytes(text)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then raise 'brique privée exécutable : %', f; end if;
  end loop;
  -- Schéma des politiques : authenticated y entre pour ces deux fonctions seulement, anon jamais
  if not has_schema_privilege('authenticated', 'coach_photo_rls', 'usage') or has_schema_privilege('anon', 'coach_photo_rls', 'usage')
     or has_schema_privilege('authenticated', 'private', 'usage') then raise 'droits des schémas'; end if;
  if (select array_agg(p.proname::text order by p.proname) from pg_proc p where p.pronamespace = 'coach_photo_rls'::regnamespace) <> array['can_read', 'can_upload']
    then raise 'fonctions du schéma des politiques'; end if;
  foreach f in array array['coach_photo_rls.can_upload(text)', 'coach_photo_rls.can_read(text)'] loop
    if has_function_privilege('anon', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then raise 'droits de %', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure) then raise 'security definer / search_path : %', f; end if;
  end loop;
  -- Compartiment privé, 1 Mo, du chiffré seulement
  if (select row(b.public, b.file_size_limit, b.allowed_mime_types)::text from storage.buckets b where b.id = 'coach-photos')
     is distinct from row(false, 1048576::bigint, array['application/octet-stream'])::text then raise 'compartiment : %', (select row(b.*) from storage.buckets b where b.id = 'coach-photos'); end if;
  -- Trois politiques sur storage.objects, pour authenticated, aucune UPDATE
  if (select array_agg(p.cmd || ':' || p.roles::text order by p.cmd) from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname like 'coach_photos_%')
     <> array['DELETE:{authenticated}', 'INSERT:{authenticated}', 'SELECT:{authenticated}'] then raise 'politiques du compartiment'; end if;
end $$;

set role anon;
do $$ begin
  if pg_temp.perr($q$ select public.student_photo_state() $q$) not like 'permission denied%' then raise 'anon : état'; end if;
  if pg_temp.perr($q$ select public.coach_photo_key() $q$) not like 'permission denied%' then raise 'anon : clé'; end if;
  if pg_temp.perr($q$ select * from public.coach_photos $q$) not like 'permission denied%' then raise 'anon : table'; end if;
  if pg_temp.perr($q$ select coach_photo_rls.can_read('x') $q$) not like 'permission denied%' then raise 'anon : schéma des politiques'; end if;
  if pg_temp.visible('x') then raise 'anon voit un fichier'; end if;
  if pg_temp.upload(pg_temp.pu('s')::text || '/' || pg_temp.pid('s', 1)::text) not like '%row-level security%' then raise 'anon envoie un fichier'; end if;
end $$;
reset role;

set role authenticated;

-- ── Clé du coach ─────────────────────────────────────────
do $$
declare k jsonb;
begin
  perform pg_temp.plogin('a');
  if pg_temp.perr($q$ select public.coach_photo_key() $q$) <> 'not_coach' then raise 'non-coach : clé'; end if;
  if pg_temp.perr(format('select public.coach_photo_key_set(%L, %L, %L, %L, false)', repeat('a', 32), pg_temp.pk(), repeat('A', 200), repeat('A', 16))) <> 'not_coach'
    then raise 'non-coach : publier'; end if;
  perform pg_temp.plogin('k');
  if public.coach_photo_key() is not null then raise 'clé avant création'; end if;
  -- Formes refusées
  if pg_temp.perr(format('select public.coach_photo_key_set(%L, %L, %L, %L, false)', 'ABC', pg_temp.pk(), repeat('A', 200), repeat('A', 16))) <> 'invalid_key' then raise 'identifiant'; end if;
  if pg_temp.perr(format('select public.coach_photo_key_set(%L, %L, %L, %L, false)', repeat('a', 32), 'AAAA', repeat('A', 200), repeat('A', 16))) <> 'invalid_key' then raise 'clé publique'; end if;
  if pg_temp.perr(format('select public.coach_photo_key_set(%L, %L, %L, %L, false)', repeat('a', 32), pg_temp.pk(), repeat('A', 20), repeat('A', 16))) <> 'invalid_key' then raise 'clé enveloppée courte'; end if;
  if pg_temp.perr(format('select public.coach_photo_key_set(%L, %L, %L, %L, false)', repeat('a', 32), pg_temp.pk(), repeat('A', 200), repeat('A', 12))) <> 'invalid_key' then raise 'IV'; end if;
  k := public.coach_photo_key_set(repeat('a', 32), pg_temp.pk(), repeat('A', 200), repeat('A', 16), false);
  if k ->> 'key_id' <> repeat('a', 32) or k ->> 'public_key' <> pg_temp.pk() or k ->> 'wrapped_key' <> repeat('A', 200) then raise 'clé publiée : %', k; end if;
  if public.coach_photo_key() ->> 'key_id' <> repeat('a', 32) then raise 'clé relue'; end if;
  -- Deuxième appareil en même temps : refusé sans remplacer
  if pg_temp.perr(format('select public.coach_photo_key_set(%L, %L, %L, %L, false)', repeat('b', 32), pg_temp.pk('B'), repeat('A', 200), repeat('A', 16))) <> 'key_exists' then raise 'clé écrasée sans replace'; end if;
  if public.coach_photo_key() ->> 'key_id' <> repeat('a', 32) then raise 'clé changée par un refus'; end if;
  -- Le coach L publie la sienne ; jamais visible d'un autre
  perform pg_temp.plogin('l');
  perform public.coach_photo_key_set(repeat('c', 32), pg_temp.pk('C'), repeat('A', 200), repeat('A', 16), false);
  if public.coach_photo_key() ->> 'key_id' <> repeat('c', 32) then raise 'clé de L'; end if;
end $$;

-- ── Élève : état, préparation ────────────────────────────
do $$
declare st jsonb;
begin
  perform pg_temp.plogin('a');
  if pg_temp.prep('a', 1) <> 'not_found' then raise 'sans coach : préparation'; end if;
  st := public.student_photo_state();
  if st ->> 'coach' <> 'false' or st ->> 'ready' <> 'false' or st -> 'key' <> 'null'::jsonb then raise 'sans coach : état %', st; end if;
  perform pg_temp.plogin('s');
  st := public.student_photo_state();
  if st ->> 'ready' <> 'true' or st #>> '{key,key_id}' <> repeat('a', 32) or st #>> '{key,public_key}' <> pg_temp.pk()
     or st -> 'key' ? 'wrapped_key' or st -> 'photos' <> '[]'::jsonb or (st ->> 'per_day')::int <> 3 then raise 'état de l''élève : %', st; end if;
  if pg_temp.prep('s', 1, kid => repeat('c', 32)) <> 'key_changed' then raise 'clé d''un autre coach acceptée'; end if;
  -- 18 ans ou plus, déclaré une fois : sans, rien ne part
  if st ->> 'adult' <> 'false' then raise 'majeur par défaut'; end if;
  if pg_temp.prep('s', 1) <> 'not_adult' then raise 'envoi sans déclaration d''âge'; end if;
  if public.student_photo_adult() ->> 'adult' <> 'true' or public.student_photo_adult() ->> 'adult' <> 'true' then raise 'déclaration d''âge'; end if;
  perform pg_temp.plogin('t'); perform public.student_photo_adult();
  perform pg_temp.plogin('u'); perform public.student_photo_adult();
  perform pg_temp.plogin('s');
  if pg_temp.prep('s', 1, pose => 'top') <> 'invalid_photo' then raise 'pose inconnue'; end if;
  if pg_temp.prep('s', 1, day => current_date + 3) <> 'invalid_photo' then raise 'date future'; end if;
  if pg_temp.prep('s', 1, day => date '2019-12-31') <> 'invalid_photo' then raise 'date ancienne'; end if;
  if pg_temp.perr(format('select public.student_photo_prepare(%L, %L, %L, %L, %L, %L)', pg_temp.pid('s', 1), repeat('a', 32), '2026-11-05', 'face', 'Bxyz', repeat('A', 16))) <> 'invalid_photo' then raise 'clé éphémère mal formée'; end if;
  if pg_temp.prep('s', 1) <> pg_temp.pu('s')::text || '/' || pg_temp.pid('s', 1)::text then raise 'chemin : %', pg_temp.prep('s', 1); end if;
  if pg_temp.prep('s', 1) <> 'invalid_photo' then raise 'même identifiant deux fois'; end if;
  -- Préparée, pas encore validée : invisible de l'élève comme du coach
  if jsonb_array_length(public.student_photo_state() -> 'photos') <> 0 then raise 'photo en cours listée'; end if;
end $$;

-- ── Fichier : envoi, lecture, validation ─────────────────
do $$
declare p1 text := pg_temp.pu('s')::text || '/' || pg_temp.pid('s', 1)::text; r jsonb;
begin
  perform pg_temp.plogin('t');
  if pg_temp.upload(p1) not like '%row-level security%' then raise 'T envoie dans le dossier de S'; end if;
  perform pg_temp.plogin('s');
  if pg_temp.upload(pg_temp.pu('s')::text || '/' || pg_temp.pid('s', 9)::text) not like '%row-level security%' then raise 'fichier sans préparation'; end if;
  if pg_temp.upload(pg_temp.pu('t')::text || '/' || pg_temp.pid('s', 1)::text) not like '%row-level security%' then raise 'fichier dans le dossier d''un autre'; end if;
  if pg_temp.upload(p1) <> 'ok' then raise 'envoi refusé : %', pg_temp.upload(p1); end if;
  if pg_temp.upload(p1) = 'ok' then raise 'second fichier au même chemin'; end if;
  if not pg_temp.visible(p1) then raise 'l''élève ne voit pas son fichier (retrait impossible)'; end if;
  -- Aucune politique UPDATE : remplacer le fichier ne touche rien
  update storage.objects o set metadata = '{"size": 5}' where o.name = p1;
  if (select (o.metadata ->> 'size')::int from storage.objects o where o.name = p1 and o.bucket_id = 'coach-photos') <> 180000 then raise 'fichier remplacé'; end if;
  perform pg_temp.plogin('k');
  if pg_temp.visible(p1) then raise 'coach : fichier visible avant validation'; end if;
  if jsonb_array_length(public.coach_student_photos(pg_temp.pu('s')) -> 'photos') <> 0 then raise 'coach : photo en cours listée'; end if;
  -- Validation : seulement par l'élève, fichier présent
  if pg_temp.perr(format('select public.student_photo_commit(%L)', pg_temp.pid('s', 1))) <> 'not_found' then raise 'validation par le coach'; end if;
  perform pg_temp.plogin('s');
  if pg_temp.prep('s', 2, pose => 'back') is null then raise 'préparation 2'; end if;
  if pg_temp.perr(format('select public.student_photo_commit(%L)', pg_temp.pid('s', 2))) <> 'not_uploaded' then raise 'validation sans fichier'; end if;
  r := public.student_photo_commit(pg_temp.pid('s', 1));
  if r ->> 'pose' <> 'face' or (r ->> 'bytes')::int <> 180000 or r ->> 'sent_at' is null then raise 'validation : %', r; end if;
  if public.student_photo_commit(pg_temp.pid('s', 1)) -> 'sent_at' <> r -> 'sent_at' then raise 'nouvel essai de validation'; end if;
  r := public.student_photo_state();
  if jsonb_array_length(r -> 'photos') <> 1 or r #>> '{photos,0,id}' <> pg_temp.pid('s', 1)::text or r #>> '{photos,0,taken_on}' <> '2026-11-05' then raise 'état après envoi : %', r; end if;
  -- Fichier trop gros (le compartiment le refuse déjà ; la validation aussi)
  if pg_temp.upload(pg_temp.pu('s')::text || '/' || pg_temp.pid('s', 2)::text, 2000000) <> 'ok' then raise 'envoi 2'; end if;
  if pg_temp.perr(format('select public.student_photo_commit(%L)', pg_temp.pid('s', 2))) <> 'not_uploaded' then raise 'fichier de 2 Mo validé'; end if;
end $$;

do $$
declare p1 text := pg_temp.pu('s')::text || '/' || pg_temp.pid('s', 1)::text; r jsonb;
begin
  -- Coach destinataire : la ligne et le fichier ; jamais l'élève T, l'ami, l'autre coach
  perform pg_temp.plogin('k');
  if not pg_temp.visible(p1) then raise 'coach : fichier invisible'; end if;
  r := public.coach_student_photos(pg_temp.pu('s'));
  if jsonb_array_length(r -> 'photos') <> 1 or r #>> '{photos,0,path}' <> p1 or r #>> '{photos,0,epk}' <> pg_temp.pk()
     or r #>> '{photos,0,key_id}' <> repeat('a', 32) or r #>> '{photos,0,iv}' <> repeat('A', 16) then raise 'coach : photos %', r; end if;
  if jsonb_array_length(public.coach_student_photos(pg_temp.pu('t')) -> 'photos') <> 0 then raise 'coach : photos de T'; end if;
  perform pg_temp.plogin('l');
  if pg_temp.visible(p1) then raise 'autre coach : fichier visible'; end if;
  if pg_temp.perr(format('select public.coach_student_photos(%L)', pg_temp.pu('s'))) <> 'not_found' then raise 'autre coach : liste'; end if;
  perform pg_temp.plogin('t');
  if pg_temp.visible(p1) then raise 'autre élève : fichier visible'; end if;
  if pg_temp.perr(format('select public.coach_student_photos(%L)', pg_temp.pu('s'))) <> 'not_found' then raise 'élève : liste du coach'; end if;
  perform pg_temp.plogin('a');
  if pg_temp.visible(p1) then raise 'ami : fichier visible'; end if;
  -- Le coach n'efface rien (l'API Storage lève le verrou SQL ; les politiques s'appliquent quand même)
  perform pg_temp.plogin('k');
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o where o.bucket_id = 'coach-photos' and o.name = p1;
  perform pg_temp.plogin('s');
  if not pg_temp.visible(p1) then raise 'fichier effacé par le coach'; end if;
end $$;

-- ── Bornes : 3 par jour, 30 préparations par 24 h ────────
do $$
begin
  perform pg_temp.plogin('s');
  -- 2 photos ce jour (1 prête, 1 en cours) : une troisième passe, pas une quatrième
  if pg_temp.prep('s', 3, pose => 'side') not like '%/%' then raise 'troisième photo du jour'; end if;
  if pg_temp.prep('s', 4) <> 'too_many' then raise 'quatrième photo du jour'; end if;
  if pg_temp.prep('s', 4, day => date '2026-11-01') not like '%/%' then raise 'autre jour'; end if;
end $$;
-- Débit : 30 par 24 h (4 déjà comptées)
reset role;
insert into private.social_rate (user_id, action) select pg_temp.pu('s'), 'coach_photo' from generate_series(1, 26);
set role authenticated;
do $$ begin
  perform pg_temp.plogin('s');
  if pg_temp.prep('s', 5, day => date '2026-10-01') <> 'rate_limited' then raise 'débit'; end if;
end $$;
reset role;
delete from private.social_rate r where r.user_id = pg_temp.pu('s') and r.action = 'coach_photo';
set role authenticated;

-- ── Coach : faire disparaître une photo reçue ─────────────
do $$
declare p4 text := pg_temp.pu('s')::text || '/' || pg_temp.pid('s', 4)::text;
begin
  perform pg_temp.plogin('s');
  if pg_temp.upload(p4) <> 'ok' then raise 'envoi 4'; end if;
  perform public.student_photo_commit(pg_temp.pid('s', 4));
  perform pg_temp.plogin('l');
  if pg_temp.perr(format('select public.coach_photo_hide(%L)', pg_temp.pid('s', 4))) <> 'ok' then raise 'autre coach : masquer'; end if;
  perform pg_temp.plogin('s');
  if pg_temp.perr(format('select public.coach_photo_hide(%L)', pg_temp.pid('s', 4))) <> 'not_found' then raise 'élève : masquer'; end if;
  if not exists (select 1 from jsonb_array_elements(public.student_photo_state() -> 'photos') x where x ->> 'id' = pg_temp.pid('s', 4)::text) then raise 'photo masquée par un autre'; end if;
  perform pg_temp.plogin('k');
  perform public.coach_photo_hide(pg_temp.pid('s', 4));
  if pg_temp.visible(p4) then raise 'masquée : encore lisible'; end if;
  perform pg_temp.plogin('s');
  if exists (select 1 from jsonb_array_elements(public.student_photo_state() -> 'photos') x where x ->> 'id' = pg_temp.pid('s', 4)::text) then raise 'masquée : encore listée'; end if;
end $$;

-- ── Retrait : le coach perd l'accès tout de suite, le fichier part en file ──
do $$
declare p1 text := pg_temp.pu('s')::text || '/' || pg_temp.pid('s', 1)::text;
begin
  perform pg_temp.plogin('k');
  perform public.student_photo_remove(pg_temp.pid('s', 1));   -- le coach ne retire rien
  if jsonb_array_length(public.coach_student_photos(pg_temp.pu('s')) -> 'photos') <> 1 then raise 'retrait par le coach'; end if;
  perform pg_temp.plogin('s');
  perform public.student_photo_remove(pg_temp.pid('s', 1));
  perform public.student_photo_remove(pg_temp.pid('s', 1));   -- silencieux la seconde fois
  if jsonb_array_length(public.student_photo_state() -> 'photos') <> 0 then raise 'retrait : état'; end if;
  perform pg_temp.plogin('k');
  if pg_temp.visible(p1) then raise 'retrait : fichier encore lisible par le coach'; end if;
  if jsonb_array_length(public.coach_student_photos(pg_temp.pu('s')) -> 'photos') <> 0 then raise 'retrait : liste du coach'; end if;
  -- L'élève efface lui-même son fichier (API Storage : verrou levé, politique DELETE de son dossier)
  perform pg_temp.plogin('s');
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o where o.bucket_id = 'coach-photos' and o.name = p1;
  perform set_config('storage.allow_delete_query', 'false', true);
  if pg_temp.visible(p1) then raise 'retrait : fichier resté'; end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from private.coach_photo_trash t where t.path = pg_temp.pu('s')::text || '/' || pg_temp.pid('s', 1)::text) then raise 'retrait : pas en file'; end if;
  -- Le SQL seul n'efface aucun fichier (verrou de Supabase)
  if pg_temp.perr($q$ delete from storage.objects $q$) not like 'Direct deletion from storage tables is not allowed%' then raise 'verrou du stockage'; end if;
end $$;
set role authenticated;

-- ── Rôle de coach retiré : plus rien à lire ; lien rompu : tout est effacé ──
do $$
declare p3 text := pg_temp.pu('s')::text || '/' || pg_temp.pid('s', 3)::text;
begin
  perform pg_temp.plogin('s');
  if pg_temp.upload(p3) <> 'ok' then raise 'envoi 3'; end if;
  perform public.student_photo_commit(pg_temp.pid('s', 3));
  perform pg_temp.plogin('k');
  if not pg_temp.visible(p3) then raise 'photo 3 invisible'; end if;
end $$;
reset role;
update public.user_profiles set coach_at = null where user_id = pg_temp.pu('k');
set role authenticated;
do $$
declare p3 text := pg_temp.pu('s')::text || '/' || pg_temp.pid('s', 3)::text;
begin
  perform pg_temp.plogin('k');
  if pg_temp.visible(p3) then raise 'ancien coach : fichier lisible'; end if;
  if pg_temp.perr(format('select public.coach_student_photos(%L)', pg_temp.pu('s'))) <> 'not_found' then raise 'ancien coach : liste'; end if;
  if pg_temp.perr($q$ select public.coach_photo_key() $q$) <> 'not_coach' then raise 'ancien coach : clé'; end if;
  perform pg_temp.plogin('s');
  if public.student_photo_state() ->> 'ready' <> 'false' then raise 'élève d''un ancien coach : envoi possible'; end if;
  if pg_temp.prep('s', 6, day => date '2026-10-02') <> 'not_ready' then raise 'élève d''un ancien coach : préparation'; end if;
  if jsonb_array_length(public.student_photo_state() -> 'photos') <> 1 then raise 'rôle retiré : photos de l''élève effacées'; end if;
end $$;
reset role;
update public.user_profiles set coach_at = now() where user_id = pg_temp.pu('k');
set role authenticated;
do $$
begin
  perform pg_temp.plogin('s');
  perform public.coach_leave();
  if jsonb_array_length(public.student_photo_state() -> 'photos') <> 0 then raise 'lien rompu : photos restées'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.coach_photos p where p.student_id = pg_temp.pu('s')) then raise 'lien rompu : lignes restées'; end if;
  if (select count(*) from private.coach_photo_trash t where t.path like pg_temp.pu('s')::text || '/%') <> 4 then
    raise 'lien rompu : fichiers en file %', (select array_agg(t.path) from private.coach_photo_trash t); end if;
end $$;
insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('s'), pg_temp.pu('k'));
set role authenticated;

-- ── Clé changée : photos de l'ancienne clé effacées ──────
do $$
declare k jsonb;
begin
  perform pg_temp.plogin('t');
  if pg_temp.prep('t', 1) not like '%/%' then raise 'T prépare'; end if;
  if pg_temp.upload(pg_temp.pu('t')::text || '/' || pg_temp.pid('t', 1)::text) <> 'ok' then raise 'T envoie'; end if;
  perform public.student_photo_commit(pg_temp.pid('t', 1));
  perform pg_temp.plogin('k');
  k := public.coach_photo_key_set(repeat('d', 32), pg_temp.pk('D'), repeat('B', 200), repeat('B', 16), true);
  if k ->> 'key_id' <> repeat('d', 32) then raise 'nouvelle clé : %', k; end if;
  if jsonb_array_length(public.coach_student_photos(pg_temp.pu('t')) -> 'photos') <> 0 then raise 'photos de l''ancienne clé restées'; end if;
  perform pg_temp.plogin('t');
  if jsonb_array_length(public.student_photo_state() -> 'photos') <> 0 then raise 'élève : photos de l''ancienne clé'; end if;
  if pg_temp.prep('t', 2) <> 'key_changed' then raise 'ancienne clé acceptée'; end if;
  if pg_temp.prep('t', 2, kid => repeat('d', 32)) not like '%/%' then raise 'nouvelle clé refusée'; end if;
end $$;
reset role;

-- ── Purge (clé serveur) : envois pas aboutis, fichiers sans ligne, file soldée ──
do $$
declare paths text[]; orphan text := pg_temp.pu('u')::text || '/' || pg_temp.pid('u', 7)::text;
begin
  -- Préparation de T vieille de 2 h (jamais validée) ; fichier sans ligne envoyé il y a 2 h
  update public.coach_photos p set created_at = now() - interval '2 hours' where p.id = pg_temp.pid('t', 2);
  insert into storage.objects (bucket_id, name, owner_id, metadata, created_at)
    values ('coach-photos', orphan, pg_temp.pu('u')::text, '{"size": 100}', now() - interval '2 hours');
  set local role service_role;
  select array_agg(x) into paths from public.srv_coach_photo_purge_claim(1000) x;
  if not (pg_temp.pu('t')::text || '/' || pg_temp.pid('t', 2)::text = any (paths)) then raise 'purge : envoi pas abouti absent %', paths; end if;
  if not (orphan = any (paths)) then raise 'purge : fichier orphelin absent %', paths; end if;
  if not (pg_temp.pu('t')::text || '/' || pg_temp.pid('t', 1)::text = any (paths)) then raise 'purge : ancienne clé absente'; end if;
  if (select count(*) from public.srv_coach_photo_purge_claim(2)) <> 2 then raise 'purge : borne'; end if;
  if public.srv_coach_photo_purge_done(paths) <> cardinality(paths) then raise 'purge : file soldée'; end if;
  if exists (select 1 from public.srv_coach_photo_purge_claim(1000) x where x = any (paths) and x <> orphan) then raise 'purge : chemins revenus'; end if;
  reset role;
  if exists (select 1 from public.coach_photos p where p.id = pg_temp.pid('t', 2)) then raise 'purge : envoi pas abouti resté'; end if;
end $$;
-- La purge de l'API efface les fichiers ; ici, le test les retire (verrou levé comme l'API)
set storage.allow_delete_query = 'true';
delete from storage.objects o where o.bucket_id = 'coach-photos';
reset storage.allow_delete_query;
do $$ begin perform public.srv_coach_photo_purge_done(array(select t.path from private.coach_photo_trash t)); end $$;

-- ── Compte supprimé : ses photos partent, en file ────────
set role authenticated;
do $$
begin
  perform pg_temp.plogin('u');
  if pg_temp.prep('u', 1, kid => repeat('c', 32)) not like '%/%' then raise 'U prépare'; end if;
  if pg_temp.upload(pg_temp.pu('u')::text || '/' || pg_temp.pid('u', 1)::text) <> 'ok' then raise 'U envoie'; end if;
  perform public.student_photo_commit(pg_temp.pid('u', 1));
end $$;
reset role;
delete from auth.users where id = pg_temp.pu('l');   -- le coach supprime son compte : clé, lien et photos partent
do $$ begin
  if exists (select 1 from public.coach_photos p where p.student_id = pg_temp.pu('u')) or exists (select 1 from public.coach_photo_keys k where k.coach_id = pg_temp.pu('l'))
    then raise 'compte du coach supprimé : photos ou clé restées'; end if;
  if not exists (select 1 from private.coach_photo_trash t where t.path = pg_temp.pu('u')::text || '/' || pg_temp.pid('u', 1)::text) then raise 'compte supprimé : fichier pas en file'; end if;
end $$;

-- ── Nettoyage (les autres tests partent d'une base sans ces comptes) ──
set storage.allow_delete_query = 'true';
delete from storage.objects o where o.bucket_id = 'coach-photos';
reset storage.allow_delete_query;
delete from private.coach_photo_trash;
delete from private.social_rate r where r.action in ('coach_photo', 'coach_photo_key');
delete from auth.users where id in (select pg_temp.pu(c) from unnest(array['k', 's', 't', 'a', 'u']) c);
