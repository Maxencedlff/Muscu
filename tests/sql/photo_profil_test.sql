-- Vérifications de supabase/migrations/20261117000000_photo_profil.sql (lancées par tests/sql/run.sh) : droits,
-- compartiment privé et ses politiques (storage.objects imité par supabase_stub.sql, l'API Storage par des INSERT /
-- SELECT sous le rôle authenticated), droit Pro ou coach (verrou éteint puis allumé), préparation, envoi, validation,
-- qui voit la photo (moi, ami accepté dans un sens ou l'autre, coach et élève ; pas un inconnu, pas un bloqué),
-- signalements (masquée au 2e signalant), modération, retour à l'emoji, purge, compte supprimé.
-- Chaque bloc échoue (raise) si la règle n'est pas tenue. Aucune vraie donnée.
--
-- Comptes simulés (pg_temp.qu('m') → …0000000007c1, f → c2, n → c3, k → c4, s → c5, x → c6) : M mia.q1 (la photo),
-- F fil.q1 ami accepté de M, N noe.q1 inconnu, K kai.q1 coach de S sam.q1 ; X xav.q1 a demandé à suivre M (pas accepté).

create function pg_temp.qerr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.qu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000007c' || translate(c, 'mfnksx', '123456'))::uuid $$;
create function pg_temp.qlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.qu(c)::text, ''), false) $$;
-- Ce que fait l'API Storage pour un envoi (INSERT sous le rôle de l'appelant, RLS appliquée)
create function pg_temp.qupload(path text, size int default 60000, mime text default 'image/webp') returns text language plpgsql as
$$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('profile-photos', path, (select auth.uid())::text, jsonb_build_object('size', size, 'mimetype', mime));
  return 'ok';
exception when others then return sqlerrm;
end
$$;
create function pg_temp.qsees(path text) returns boolean language sql as
$$ select exists (select 1 from storage.objects o where o.bucket_id = 'profile-photos' and o.name = path) $$;
-- Photo prête pour c : préparation, envoi, validation ; renvoie le chemin
create function pg_temp.qphoto(c text) returns text language plpgsql as
$$
declare p jsonb;
begin
  perform pg_temp.qlogin(c);
  p := public.profile_photo_prepare();
  if pg_temp.qupload(p ->> 'path') <> 'ok' then raise 'envoi refusé pour %', c; end if;
  perform public.profile_photo_commit((p ->> 'id')::uuid);
  return p ->> 'path';
end
$$;
grant execute on function pg_temp.qerr(text), pg_temp.qu(text), pg_temp.qlogin(text), pg_temp.qupload(text, int, text),
  pg_temp.qsees(text), pg_temp.qphoto(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.qu(c) from unnest(array['m', 'f', 'n', 'k', 's', 'x']) c;
insert into public.user_profiles (user_id, username, avatar_emoji, social_at) values
  (pg_temp.qu('m'), 'mia.q1', '🦁', now()), (pg_temp.qu('f'), 'fil.q1', '🦊', now()), (pg_temp.qu('n'), 'noe.q1', null, now()),
  (pg_temp.qu('k'), 'kai.q1', '🦅', null), (pg_temp.qu('s'), 'sam.q1', '🐼', null), (pg_temp.qu('x'), 'xav.q1', null, now());
update public.user_profiles set coach_at = now() where user_id = pg_temp.qu('k');
insert into public.coach_links (student_id, coach_id) values (pg_temp.qu('s'), pg_temp.qu('k'));
-- F suit M (accepté) ; X a demandé (en attente)
insert into public.follows (follower_id, followee_id, status) values
  (pg_temp.qu('f'), pg_temp.qu('m'), 'accepted'), (pg_temp.qu('x'), pg_temp.qu('m'), 'pending');

-- ── Droits, compartiment, politiques ─────────────────────
do $$
declare f text; r text;
begin
  foreach f in array array['public.profile_photos', 'private.profile_photo_bans', 'private.profile_photo_trash'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = f::regclass) then raise 'RLS désactivée : %', f; end if;
    if exists (select 1 from pg_policies p where p.schemaname || '.' || p.tablename = f) then raise 'politique inattendue : %', f; end if;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if has_table_privilege(r, f, 'select') or has_table_privilege(r, f, 'insert') or has_table_privilege(r, f, 'update')
         or has_table_privilege(r, f, 'delete') then raise 'droit direct sur % pour %', f, r; end if;
    end loop;
  end loop;
  foreach f in array array['public.profile_photo_state()', 'public.profile_photo_prepare()', 'public.profile_photo_commit(uuid)',
      'public.profile_photo_remove()', 'public.profile_photos(uuid[])'] loop
    if has_function_privilege('anon', f, 'execute') then raise 'anon exécute %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise 'authenticated n''exécute pas %', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure) then raise 'security definer / search_path : %', f; end if;
  end loop;
  foreach f in array array['public.srv_profile_photo_purge_claim(int)', 'public.srv_profile_photo_purge_done(text[])'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise 'purge exécutable par l''app : %', f; end if;
    if not has_function_privilege('service_role', f, 'execute') then raise 'service_role n''exécute pas %', f; end if;
  end loop;
  foreach f in array array['private.pro_feature(uuid)', 'private.profile_photo_visible(uuid,uuid)', 'private.profile_photo_allowed(uuid)',
      'private.profile_photo_moderate(uuid,text,text)', 'private.profile_photos_on()'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then raise 'brique privée exécutable : %', f; end if;
  end loop;
  if not has_schema_privilege('authenticated', 'profile_photo_rls', 'usage') or has_schema_privilege('anon', 'profile_photo_rls', 'usage')
    then raise 'droits du schéma des politiques'; end if;
  if (select array_agg(p.proname::text order by p.proname) from pg_proc p where p.pronamespace = 'profile_photo_rls'::regnamespace) <> array['can_read', 'can_upload']
    then raise 'fonctions du schéma des politiques'; end if;
  if (select row(b.public, b.file_size_limit, b.allowed_mime_types)::text from storage.buckets b where b.id = 'profile-photos')
     is distinct from row(false, 262144::bigint, array['image/jpeg', 'image/webp'])::text then raise 'compartiment'; end if;
  if (select array_agg(p.cmd || ':' || p.roles::text order by p.cmd) from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname like 'profile_photos_%')
     <> array['DELETE:{authenticated}', 'INSERT:{authenticated}', 'SELECT:{authenticated}'] then raise 'politiques du compartiment'; end if;
end $$;

set role anon;
do $$ begin
  if pg_temp.qerr($q$ select public.profile_photo_state() $q$) not like 'permission denied%' then raise 'anon : état'; end if;
  if pg_temp.qerr($q$ select public.profile_photos(array[]::uuid[]) $q$) not like 'permission denied%' then raise 'anon : photos'; end if;
  if pg_temp.qerr($q$ select * from public.profile_photos $q$) not like 'permission denied%' then raise 'anon : table'; end if;
  if pg_temp.qupload(pg_temp.qu('m')::text || '/' || gen_random_uuid()::text) not like '%row-level security%' then raise 'anon envoie un fichier'; end if;
end $$;
reset role;

set role authenticated;

-- ── Envoi : préparation, fichier, validation ─────────────
do $$
declare p jsonb; st jsonb; first_path text;
begin
  perform pg_temp.qlogin('m');
  st := public.profile_photo_state();
  if st ->> 'enabled' <> 'true' or st ->> 'allowed' <> 'true' or st -> 'photo' <> 'null'::jsonb then raise 'état initial : %', st; end if;
  -- Fichier sans préparation, ou dans le dossier d'un autre : refusé
  if pg_temp.qupload(pg_temp.qu('m')::text || '/' || gen_random_uuid()::text) not like '%row-level security%' then raise 'envoi sans préparation'; end if;
  p := public.profile_photo_prepare();
  if p ->> 'path' <> pg_temp.qu('m')::text || '/' || (p ->> 'id') then raise 'chemin : %', p; end if;
  perform pg_temp.qlogin('f');
  if pg_temp.qupload(p ->> 'path') not like '%row-level security%' then raise 'F envoie dans le dossier de M'; end if;
  perform pg_temp.qlogin('m');
  if pg_temp.qerr(format('select public.profile_photo_commit(%L)', p ->> 'id')) <> 'not_uploaded' then raise 'validation sans fichier'; end if;
  if pg_temp.qupload(p ->> 'path', 60000, 'image/png') <> 'ok' then raise 'envoi'; end if;
  -- Type refusé (le vrai compartiment le refuse avant, la validation aussi)
  if pg_temp.qerr(format('select public.profile_photo_commit(%L)', p ->> 'id')) <> 'not_uploaded' then raise 'PNG accepté'; end if;
  reset role;
  update storage.objects set metadata = jsonb_build_object('size', 300000, 'mimetype', 'image/webp') where name = p ->> 'path';
  set role authenticated;
  if pg_temp.qerr(format('select public.profile_photo_commit(%L)', p ->> 'id')) <> 'not_uploaded' then raise 'trop gros accepté'; end if;
  reset role;
  update storage.objects set metadata = jsonb_build_object('size', 61000, 'mimetype', 'image/webp') where name = p ->> 'path';
  set role authenticated;
  st := public.profile_photo_commit((p ->> 'id')::uuid);
  if st ->> 'path' <> p ->> 'path' then raise 'validation : %', st; end if;
  -- Nouvel essai après une coupure : même réponse
  if public.profile_photo_commit((p ->> 'id')::uuid) ->> 'path' <> p ->> 'path' then raise 'validation répétée'; end if;
  if public.profile_photo_state() -> 'photo' ->> 'path' <> p ->> 'path' then raise 'état après validation'; end if;
  -- Une préparation d'un autre compte n'est pas la mienne
  perform pg_temp.qlogin('f');
  if pg_temp.qerr(format('select public.profile_photo_commit(%L)', p ->> 'id')) <> 'not_found' then raise 'F valide la photo de M'; end if;
  -- Remplacée : l'ancienne ligne part, son fichier en file
  first_path := p ->> 'path';
  if pg_temp.qphoto('m') = first_path then raise 'même chemin'; end if;
  reset role;
  if (select count(*) from public.profile_photos x where x.user_id = pg_temp.qu('m')) <> 1 then raise 'deux photos pour M'; end if;
  if not exists (select 1 from private.profile_photo_trash t where t.path = first_path) then raise 'ancienne photo pas en file'; end if;
  set role authenticated;
end $$;

-- ── Qui voit la photo ────────────────────────────────────
do $$
declare pth text; seen jsonb; ids uuid[] := array[pg_temp.qu('m'), pg_temp.qu('s'), pg_temp.qu('k')];
begin
  perform pg_temp.qlogin('m');
  pth := public.profile_photo_state() -> 'photo' ->> 'path';
  if not pg_temp.qsees(pth) then raise 'M ne voit pas sa photo'; end if;
  -- F (ami accepté, il suit M) : voit
  perform pg_temp.qlogin('f');
  seen := public.profile_photos(ids);
  if jsonb_array_length(seen) <> 1 or seen -> 0 ->> 'path' <> pth then raise 'F : %', seen; end if;
  if not pg_temp.qsees(pth) then raise 'F ne lit pas le fichier'; end if;
  -- Dans l'autre sens : M voit F quand F a une photo (M a accepté F)
  perform pg_temp.qphoto('f');
  perform pg_temp.qlogin('m');
  if jsonb_array_length(public.profile_photos(array[pg_temp.qu('f')])) <> 1 then raise 'M ne voit pas F (ami dans l''autre sens)'; end if;
  -- N (inconnu) et X (demande en attente) : rien
  perform pg_temp.qlogin('n');
  if jsonb_array_length(public.profile_photos(ids)) <> 0 or pg_temp.qsees(pth) then raise 'N voit la photo de M'; end if;
  perform pg_temp.qlogin('x');
  if jsonb_array_length(public.profile_photos(ids)) <> 0 or pg_temp.qsees(pth) then raise 'X (en attente) voit la photo'; end if;
  -- Coach et élève, sans social
  perform pg_temp.qphoto('s');
  perform pg_temp.qlogin('k');
  if jsonb_array_length(public.profile_photos(array[pg_temp.qu('s'), pg_temp.qu('m')])) <> 1 then raise 'coach K et la photo de S'; end if;
  perform pg_temp.qphoto('k');   -- un coach a la photo, même verrou allumé (plus bas)
  perform pg_temp.qlogin('s');
  if jsonb_array_length(public.profile_photos(array[pg_temp.qu('k')])) <> 1 then raise 'S ne voit pas son coach'; end if;
  -- Bloqué : plus rien (F bloque M)
  reset role;
  insert into public.blocks (blocker_id, blocked_id) values (pg_temp.qu('f'), pg_temp.qu('m'));
  set role authenticated;
  perform pg_temp.qlogin('f');
  if jsonb_array_length(public.profile_photos(array[pg_temp.qu('m')])) <> 0 or pg_temp.qsees(pth) then raise 'bloqué : F voit encore M'; end if;
  reset role;
  delete from public.blocks;
  set role authenticated;
  -- Interrupteur éteint : plus rien servi, plus rien envoyé ; retirer reste possible
  reset role;
  update public.app_config set value = 'false'::jsonb where key = 'profile_photos_on';
  set role authenticated;
  perform pg_temp.qlogin('f');
  if jsonb_array_length(public.profile_photos(array[pg_temp.qu('m')])) <> 0 or pg_temp.qsees(pth) then raise 'éteint : servi'; end if;
  perform pg_temp.qlogin('m');
  if pg_temp.qerr('select public.profile_photo_prepare()') <> 'disabled' then raise 'éteint : préparation'; end if;
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'profile_photos_on';
  set role authenticated;
end $$;

-- ── Droit : verrou payant allumé ─────────────────────────
do $$
begin
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  -- Production d'avant le modèle B (20261028000000 seule) : essai maison de 90 jours ; M l'a fini
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'entitlements' and column_name = 'trial_started_at') then
    execute format('insert into public.entitlements (user_id, trial_started_at) values (%L, now() - interval ''2 years'')
                    on conflict (user_id) do update set trial_started_at = excluded.trial_started_at', pg_temp.qu('m'));
  end if;
  set role authenticated;
  -- M sans abonnement : plus de droit, sa photo n'est plus servie ; K coach : toujours
  perform pg_temp.qlogin('m');
  if public.profile_photo_state() ->> 'allowed' <> 'false' then raise 'verrou allumé : M a encore le droit'; end if;
  if pg_temp.qerr('select public.profile_photo_prepare()') <> 'not_allowed' then raise 'verrou allumé : M prépare'; end if;
  perform pg_temp.qlogin('f');
  if jsonb_array_length(public.profile_photos(array[pg_temp.qu('m')])) <> 0 then raise 'verrou allumé : photo de M servie'; end if;
  perform pg_temp.qlogin('k');
  if public.profile_photo_state() ->> 'allowed' <> 'true' then raise 'coach sans droit'; end if;
  perform pg_temp.qlogin('s');
  if jsonb_array_length(public.profile_photos(array[pg_temp.qu('k')])) <> 1 then raise 'photo du coach pas servie'; end if;
  -- Abonné (cadeau) : le droit revient, par la même fonction que l'enregistrement des séances
  reset role;
  insert into public.entitlements (user_id, gift) values (pg_temp.qu('m'), true)
    on conflict (user_id) do update set gift = true;
  set role authenticated;
  perform pg_temp.qlogin('m');
  if public.profile_photo_state() ->> 'allowed' <> 'true' then raise 'abonné sans droit'; end if;
  reset role;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
  set role authenticated;
end $$;

-- ── Signalements et modération ───────────────────────────
do $$
declare pth text; photo uuid;
begin
  perform pg_temp.qlogin('m');
  pth := public.profile_photo_state() -> 'photo' ->> 'path';
  photo := split_part(pth, '/', 2)::uuid;
  reset role;
  -- 1er signalant : encore visible ; le même une 2e fois : encore visible ; 2e signalant : masquée
  insert into public.reports (reporter_id, target_user, kind, target_ref, reason) values (pg_temp.qu('f'), pg_temp.qu('m'), 'profile', 'photo:' || photo, 'sexuel');
  insert into public.reports (reporter_id, target_user, kind, target_ref, reason) values (pg_temp.qu('f'), pg_temp.qu('m'), 'profile', 'photo:' || photo, 'autre');
  if (select p.hidden_at from public.profile_photos p where p.id = photo) is not null then raise 'masquée au 1er signalant'; end if;
  -- Un signalement de photo qui vise un autre compte ne masque rien
  insert into public.reports (reporter_id, target_user, kind, target_ref, reason) values (pg_temp.qu('s'), pg_temp.qu('f'), 'profile', 'photo:' || photo, 'sexuel');
  if (select p.hidden_at from public.profile_photos p where p.id = photo) is not null then raise 'masquée par un signalement d''un autre compte'; end if;
  insert into public.reports (reporter_id, target_user, kind, target_ref, reason) values (pg_temp.qu('k'), pg_temp.qu('m'), 'profile', 'photo:' || photo, 'sexuel');
  if (select p.hidden_at from public.profile_photos p where p.id = photo) is null then raise 'pas masquée au 2e signalant'; end if;
  set role authenticated;
  perform pg_temp.qlogin('m');
  if public.profile_photo_state() -> 'photo' ->> 'hidden' <> 'true' then raise 'M ne sait pas que sa photo est masquée'; end if;
  perform pg_temp.qlogin('k');
  if pg_temp.qsees(pth) then raise 'masquée : fichier encore lisible'; end if;
  reset role;
  if private.profile_photo_moderate(photo, 'restore') <> 1 then raise 'restore'; end if;
  if (select p.hidden_at from public.profile_photos p where p.id = photo) is not null then raise 'pas démasquée'; end if;
  -- Interdit de photo : tout part, plus de préparation
  if private.profile_photo_moderate(photo, 'ban', 'test') <> 1 then raise 'ban'; end if;
  if exists (select 1 from public.profile_photos p where p.user_id = pg_temp.qu('m')) then raise 'ban : photo restée'; end if;
  if not exists (select 1 from private.profile_photo_trash t where t.path = pth) then raise 'ban : fichier pas en file'; end if;
  set role authenticated;
  perform pg_temp.qlogin('m');
  if pg_temp.qerr('select public.profile_photo_prepare()') <> 'banned' then raise 'ban : préparation'; end if;
  reset role;
  delete from private.profile_photo_bans;
  set role authenticated;
end $$;

-- ── Retour à l'emoji, limite, purge, compte supprimé ─────
do $$
declare pth text; i int; paths text[];
begin
  pth := pg_temp.qphoto('m');
  perform public.profile_photo_remove();
  if public.profile_photo_state() -> 'photo' <> 'null'::jsonb then raise 'retour à l''emoji'; end if;
  perform pg_temp.qlogin('f');
  if pg_temp.qsees(pth) then raise 'photo retirée encore lisible'; end if;
  -- 10 préparations par 24 h (M en a fait 3)
  perform pg_temp.qlogin('m');
  for i in 1..7 loop perform public.profile_photo_prepare(); end loop;
  if pg_temp.qerr('select public.profile_photo_prepare()') <> 'rate_limited' then raise 'limite de 10'; end if;
  reset role;
  if (select count(*) from public.profile_photos p where p.user_id = pg_temp.qu('m') and p.state = 'pending') <> 1 then raise 'préparations empilées'; end if;
  -- Préparation de plus d'une heure : effacée par la purge ; fichier sans ligne : mis en file
  update public.profile_photos set created_at = now() - interval '2 hours' where user_id = pg_temp.qu('m');
  insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', pg_temp.qu('n')::text || '/' || gen_random_uuid()::text, '{}');
  update storage.objects set created_at = now() - interval '2 hours' where bucket_id = 'profile-photos';
  set role service_role;
  select array_agg(x) into paths from public.srv_profile_photo_purge_claim(1000) x;
  if not pth = any (paths) then raise 'purge : photo retirée absente'; end if;
  if not exists (select 1 from unnest(paths) x where x like pg_temp.qu('n')::text || '/%') then raise 'purge : fichier orphelin absent'; end if;
  if public.srv_profile_photo_purge_done(paths) <> array_length(paths, 1) then raise 'purge : soldés'; end if;
  reset role;
  if exists (select 1 from public.profile_photos p where p.user_id = pg_temp.qu('m')) then raise 'purge : préparation restée'; end if;
  -- Compte supprimé : sa photo part en file
  select pg_temp.qphoto('s') into pth;
  reset role;
  delete from auth.users where id = pg_temp.qu('s');
  if not exists (select 1 from private.profile_photo_trash t where t.path = pth) then raise 'compte supprimé : photo pas en file'; end if;
  set role authenticated;
end $$;
reset role;

-- Nettoyage (les autres fichiers de test partagent la base)
set storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'profile-photos';
reset storage.allow_delete_query;
delete from public.reports where target_user in (select pg_temp.qu(c) from unnest(array['m', 'f', 'n', 'k', 's', 'x']) c);
delete from public.entitlements where user_id in (select pg_temp.qu(c) from unnest(array['m', 'f', 'n', 'k', 's', 'x']) c);
delete from auth.users where id in (select pg_temp.qu(c) from unnest(array['m', 'f', 'n', 'k', 's', 'x']) c);
