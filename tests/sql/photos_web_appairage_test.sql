-- Vérifications de supabase/migrations/20261127010000_photos_web_appairage.sql (lancées par tests/sql/run.sh) :
-- droits (anon rien, tables fermées), appairage à usage unique (waiting → offered → done, chaque étape une fois),
-- preuve du QR (verifier), expiration de 2 minutes, un seul appairage à la fois, ordinateurs reliés (5 au plus),
-- enveloppe rendue au seul coach, révocation, clé changée sur l'iPhone, 30 jours sans usage, 90 jours, rôle retiré,
-- photos éteintes, compte supprimé, limites, nom de l'appareil nettoyé. Valeurs factices (le serveur ne lit que leur
-- forme) : aucune vraie clé.
--
-- Comptes simulés (pg_temp.qu('k') → …00000007c1, l → c2, m → c3, n → c4, a → c5) : K, L, M et N sont coachs (K, L et N
-- ont une clé de photos, M n'en a pas) ; A n'est pas coach.

create function pg_temp.qerr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.qu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-000000007c' || translate(c, 'klmna', '12345') || '0')::uuid $$;
create function pg_temp.qlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.qu(c)::text, ''), false) $$;
-- Clé publique factice (65 octets en base64), preuve factice, enveloppe factice
create function pg_temp.qpk(v text default 'A') returns text language sql immutable as $$ select 'B' || v || repeat('A', 84) || 'A=' $$;
create function pg_temp.qver(v text default 'A') returns text language sql immutable as $$ select repeat(v, 43) || '=' $$;
create function pg_temp.qkid(c text) returns text language sql immutable as $$ select repeat(translate(c, 'klmna', '12345'), 32) $$;
grant execute on function pg_temp.qerr(text), pg_temp.qu(text), pg_temp.qlogin(text), pg_temp.qpk(text), pg_temp.qver(text), pg_temp.qkid(text) to authenticated, anon;

insert into auth.users (id) select pg_temp.qu(c) from unnest(array['k', 'l', 'm', 'n', 'a']) c;
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at) values
  (pg_temp.qu('k'), 'kim.q1', '🦁', now()), (pg_temp.qu('l'), 'lou.q1', '🦊', now()), (pg_temp.qu('m'), 'max.q1', '🦅', now()),
  (pg_temp.qu('n'), 'nina.q1', '🐼', now()), (pg_temp.qu('a'), 'ami.q1', '⭐', null);
insert into public.coach_photo_keys (coach_id, key_id, public_key, wrapped_key, wrap_iv)
  select pg_temp.qu(c), pg_temp.qkid(c), pg_temp.qpk(), repeat('A', 80), repeat('A', 16) from unnest(array['k', 'l', 'n']) c;
update public.app_config set value = 'true'::jsonb where key = 'coach_photos_on';

-- ── Droits ───────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['public.coach_photo_pair_start(text, text, text)', 'public.coach_photo_pair_peek(uuid)',
    'public.coach_photo_pair_offer(uuid, text, text)', 'public.coach_photo_pair_complete(uuid, text, text, text)',
    'public.coach_photo_pair_status(uuid)', 'public.coach_photo_pair_cancel(uuid)', 'public.coach_photo_devices()',
    'public.coach_photo_device_key(uuid)', 'public.coach_photo_device_revoke(uuid)'] loop
    if has_function_privilege('anon', f, 'execute') then raise 'anon exécute %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise 'authenticated n''exécute pas %', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure) then raise '% : security definer / search_path', f; end if;
  end loop;
  foreach f in array array['private.coach_photo_link_me()', 'private.coach_photo_link_purge(uuid)', 'private.coach_photo_label(text)', 'private.coach_photo_key_gone()'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then raise '% exécutable par le client', f; end if;
  end loop;
  foreach f in array array['public.coach_photo_pairings', 'public.coach_photo_devices'] loop
    if has_table_privilege('authenticated', f, 'select') or has_table_privilege('authenticated', f, 'insert') or has_table_privilege('anon', f, 'select')
       or has_table_privilege('authenticated', f, 'update') or has_table_privilege('authenticated', f, 'delete') then raise '% : droits de table pour le client', f; end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = f::regclass) then raise '% : RLS pas activée', f; end if;
    if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = split_part(f, '.', 2)) then raise '% : une politique ouvre la table', f; end if;
  end loop;
end $$;
set role anon;
do $$ begin
  if pg_temp.qerr(format('select public.coach_photo_pair_start(%L, %L, %L)', pg_temp.qpk(), pg_temp.qver(), 'x')) not like 'permission denied%' then raise 'anon : appairage'; end if;
  if pg_temp.qerr(format('select public.coach_photo_device_key(%L)', gen_random_uuid())) not like 'permission denied%' then raise 'anon : enveloppe'; end if;
end $$;
reset role;

-- ── Appairage à usage unique ─────────────────────────────
set role authenticated;
create temp table qt (k text primary key, v text);
do $$
declare r jsonb; pair uuid; dev jsonb;
begin
  -- Pas coach, coach sans clé, entrée mal formée
  perform pg_temp.qlogin('a');
  if pg_temp.qerr(format('select public.coach_photo_pair_start(%L, %L, %L)', pg_temp.qpk(), pg_temp.qver(), 'Chrome')) <> 'not_coach' then raise 'non-coach : not_coach attendu'; end if;
  perform pg_temp.qlogin('m');
  if pg_temp.qerr(format('select public.coach_photo_pair_start(%L, %L, %L)', pg_temp.qpk(), pg_temp.qver(), 'Chrome')) <> 'no_key' then raise 'coach sans clé : no_key attendu'; end if;
  perform pg_temp.qlogin('k');
  if pg_temp.qerr(format('select public.coach_photo_pair_start(%L, %L, %L)', 'pas une clé', pg_temp.qver(), 'Chrome')) <> 'invalid_device' then raise 'clé mal formée'; end if;
  if pg_temp.qerr(format('select public.coach_photo_pair_start(%L, %L, %L)', pg_temp.qpk(), 'court', 'Chrome')) <> 'invalid_device' then raise 'preuve mal formée'; end if;

  -- K commence : deux minutes, un seul appairage à la fois
  r := public.coach_photo_pair_start(pg_temp.qpk('B'), pg_temp.qver('B'), 'Chrome sur Windows');
  pair := (r ->> 'pair')::uuid;
  if (r ->> 'expires_at')::timestamptz not between now() + interval '110 seconds' and now() + interval '130 seconds' then raise 'expiration de 2 minutes : %', r; end if;
  r := public.coach_photo_pair_start(pg_temp.qpk(), pg_temp.qver(), 'Chrome sur Windows');
  if pg_temp.qerr(format('select public.coach_photo_pair_peek(%L)', pair)) <> 'not_found' then raise 'le premier appairage aurait dû être remplacé'; end if;
  pair := (r ->> 'pair')::uuid;
  insert into qt values ('pair', pair::text);

  -- Lecture par le téléphone de K ; un autre coach ne voit rien (même réponse qu'un appairage inconnu)
  r := public.coach_photo_pair_peek(pair);
  if r ->> 'device_pub' <> pg_temp.qpk() or r ->> 'state' <> 'waiting' or r ->> 'label' <> 'Chrome sur Windows' then raise 'peek : %', r; end if;
  if r ? 'verifier' then raise 'peek ne doit pas rendre la preuve'; end if;
  if (r ->> 'created_at')::timestamptz not between now() - interval '1 minute' and now() then raise 'peek : heure de la demande %', r; end if;
  perform pg_temp.qlogin('l');
  if pg_temp.qerr(format('select public.coach_photo_pair_peek(%L)', pair)) <> 'not_found' then raise 'autre coach : peek'; end if;
  if pg_temp.qerr(format('select public.coach_photo_pair_status(%L)', pair)) <> 'not_found' then raise 'autre coach : status'; end if;
  if pg_temp.qerr(format('select public.coach_photo_pair_offer(%L, %L, %L)', pair, pg_temp.qver(), pg_temp.qpk('C'))) <> 'not_found' then raise 'autre coach : offre'; end if;
  perform public.coach_photo_pair_cancel(pair);   -- silencieux, sans effet sur l'appairage d'un autre

  -- Offre : preuve du QR obligatoire, une seule fois
  perform pg_temp.qlogin('k');
  if public.coach_photo_pair_status(pair) ->> 'state' <> 'waiting' then raise 'annulé par un autre coach'; end if;
  if pg_temp.qerr(format('select public.coach_photo_pair_offer(%L, %L, %L)', pair, pg_temp.qver('Z'), pg_temp.qpk('C'))) <> 'not_found' then raise 'preuve fausse acceptée'; end if;
  if pg_temp.qerr(format('select public.coach_photo_pair_offer(%L, %L, %L)', pair, pg_temp.qver(), 'mauvaise')) <> 'invalid_device' then raise 'clé éphémère mal formée'; end if;
  if pg_temp.qerr(format('select public.coach_photo_pair_complete(%L, %L, %L, %L)', pair, pg_temp.qkid('k'), repeat('A', 80), repeat('A', 16))) <> 'already_used' then raise 'enveloppe avant l''offre'; end if;
  perform public.coach_photo_pair_offer(pair, pg_temp.qver(), pg_temp.qpk('C'));
  if pg_temp.qerr(format('select public.coach_photo_pair_offer(%L, %L, %L)', pair, pg_temp.qver(), pg_temp.qpk('D'))) <> 'already_used' then raise 'seconde offre acceptée'; end if;
  r := public.coach_photo_pair_status(pair);
  if r ->> 'state' <> 'offered' or r ->> 'epk' <> pg_temp.qpk('C') or r ->> 'device' is not null then raise 'status après l''offre : %', r; end if;

  -- Enveloppe : clé actuelle du coach seulement, une seule fois
  if pg_temp.qerr(format('select public.coach_photo_pair_complete(%L, %L, %L, %L)', pair, repeat('f', 32), repeat('A', 80), repeat('A', 16))) <> 'key_changed' then raise 'autre clé acceptée'; end if;
  if pg_temp.qerr(format('select public.coach_photo_pair_complete(%L, %L, %L, %L)', pair, pg_temp.qkid('k'), 'AAAA', repeat('A', 16))) <> 'invalid_device' then raise 'enveloppe trop courte'; end if;
  perform pg_temp.qlogin('l');
  if pg_temp.qerr(format('select public.coach_photo_pair_complete(%L, %L, %L, %L)', pair, pg_temp.qkid('l'), repeat('A', 80), repeat('A', 16))) <> 'not_found' then raise 'autre coach : enveloppe'; end if;
  perform pg_temp.qlogin('k');
  dev := public.coach_photo_pair_complete(pair, pg_temp.qkid('k'), repeat('A', 80), repeat('A', 16));
  if (dev ->> 'device')::uuid <> pair or dev ->> 'label' <> 'Chrome sur Windows' then raise 'ordinateur créé : %', dev; end if;
  if (dev ->> 'expires_at')::timestamptz not between now() + interval '89 days' and now() + interval '91 days' then raise '90 jours au plus'; end if;
  if pg_temp.qerr(format('select public.coach_photo_pair_complete(%L, %L, %L, %L)', pair, pg_temp.qkid('k'), repeat('B', 80), repeat('A', 16))) <> 'already_used' then raise 'seconde enveloppe acceptée'; end if;
  r := public.coach_photo_pair_status(pair);
  if r ->> 'state' <> 'done' or (r ->> 'device')::uuid <> pair then raise 'status fini : %', r; end if;
  perform public.coach_photo_pair_cancel(pair);   -- un appairage fini ne s'annule pas (l'ordinateur reste)
  if public.coach_photo_pair_status(pair) ->> 'state' <> 'done' then raise 'appairage fini annulé'; end if;

  -- Enveloppe rendue au seul coach ; liste du téléphone sans l'enveloppe
  r := public.coach_photo_device_key(pair);
  if r ->> 'wrapped' <> repeat('A', 80) or r ->> 'key_id' <> pg_temp.qkid('k') or r ->> 'iv' <> repeat('A', 16) then raise 'enveloppe : %', r; end if;
  r := public.coach_photo_devices();
  if jsonb_array_length(r) <> 1 or r -> 0 ? 'wrapped' or r -> 0 ? 'iv' or r -> 0 ->> 'label' <> 'Chrome sur Windows' then raise 'liste : %', r; end if;
  perform pg_temp.qlogin('l');
  if pg_temp.qerr(format('select public.coach_photo_device_key(%L)', pair)) <> 'not_found' then raise 'autre coach : enveloppe lue'; end if;
  if jsonb_array_length(public.coach_photo_devices()) <> 0 then raise 'autre coach : liste'; end if;
  perform public.coach_photo_device_revoke(pair);   -- sans effet chez K
  perform pg_temp.qlogin('k');
  if public.coach_photo_device_key(pair) ->> 'id' <> pair::text then raise 'retiré par un autre coach'; end if;
end $$;

-- ── Expiration de l'appairage ────────────────────────────
do $$
declare pair uuid;
begin
  perform pg_temp.qlogin('k');
  pair := (public.coach_photo_pair_start(pg_temp.qpk(), pg_temp.qver(), 'Firefox sur Linux') ->> 'pair')::uuid;
  insert into qt values ('old', pair::text);
end $$;
reset role;
update public.coach_photo_pairings set expires_at = now() - interval '1 second' where id = (select v::uuid from qt where k = 'old');
set role authenticated;
do $$
declare pair uuid := (select v::uuid from qt where k = 'old');
begin
  perform pg_temp.qlogin('k');
  if pg_temp.qerr(format('select public.coach_photo_pair_peek(%L)', pair)) <> 'not_found' then raise 'expiré : peek'; end if;
  if pg_temp.qerr(format('select public.coach_photo_pair_offer(%L, %L, %L)', pair, pg_temp.qver(), pg_temp.qpk('C'))) <> 'not_found' then raise 'expiré : offre'; end if;
  if pg_temp.qerr(format('select public.coach_photo_pair_status(%L)', pair)) <> 'not_found' then raise 'expiré : status'; end if;
end $$;
reset role;

-- ── Nom de l'appareil nettoyé ────────────────────────────
do $$ begin
  if private.coach_photo_label(E'Chrome\u0007 sur\n‮Windows') <> 'Chrome sur Windows' then raise 'nom : %', private.coach_photo_label(E'Chrome\u0007 sur\n‮Windows'); end if;
  if private.coach_photo_label('   ') <> 'Ordinateur' or private.coach_photo_label(null) <> 'Ordinateur' then raise 'nom vide'; end if;
  if char_length(private.coach_photo_label(repeat('é', 100))) <> 60 then raise '60 caractères au plus'; end if;
end $$;

-- ── 5 ordinateurs au plus ────────────────────────────────
insert into public.coach_photo_devices (id, coach_id, key_id, label, wrapped, iv)
  select gen_random_uuid(), pg_temp.qu('k'), pg_temp.qkid('k'), 'Mac ' || i, repeat('A', 80), repeat('A', 16) from generate_series(1, 4) i;
set role authenticated;
do $$ begin
  perform pg_temp.qlogin('k');
  if pg_temp.qerr(format('select public.coach_photo_pair_start(%L, %L, %L)', pg_temp.qpk(), pg_temp.qver(), 'Edge')) <> 'too_many' then raise '6e ordinateur accepté'; end if;
end $$;
reset role;
-- Appairage déjà offert quand le 5e arrive d'ailleurs : refusé aussi à l'enveloppe
delete from public.coach_photo_devices where coach_id = pg_temp.qu('k') and label = 'Mac 4';
insert into public.coach_photo_pairings (id, coach_id, device_pub, verifier, label, state, epk)
  values ('00000000-0000-4000-8000-00000007c999', pg_temp.qu('k'), pg_temp.qpk(), pg_temp.qver(), 'Edge', 'offered', pg_temp.qpk('C'));
insert into public.coach_photo_devices (id, coach_id, key_id, label, wrapped, iv) values (gen_random_uuid(), pg_temp.qu('k'), pg_temp.qkid('k'), 'Mac 5', repeat('A', 80), repeat('A', 16));
set role authenticated;
do $$ begin
  perform pg_temp.qlogin('k');
  if pg_temp.qerr(format('select public.coach_photo_pair_complete(%L, %L, %L, %L)', '00000000-0000-4000-8000-00000007c999', pg_temp.qkid('k'), repeat('A', 80), repeat('A', 16))) <> 'too_many' then raise '6e ordinateur à l''enveloppe'; end if;
end $$;
reset role;
delete from public.coach_photo_devices where coach_id = pg_temp.qu('k') and label like 'Mac %';

-- ── 10 appairages par heure ──────────────────────────────
set role authenticated;
do $$ begin
  perform pg_temp.qlogin('n');
  for i in 1..10 loop perform public.coach_photo_pair_start(pg_temp.qpk(), pg_temp.qver(), 'Essai'); end loop;
  if pg_temp.qerr(format('select public.coach_photo_pair_start(%L, %L, %L)', pg_temp.qpk(), pg_temp.qver(), 'Essai')) <> 'rate_limited' then raise '11e appairage dans l''heure accepté'; end if;
end $$;
reset role;

-- ── Téléphone : 30 lectures par 10 minutes (N a encore son dernier appairage) ──
create temp table qn as select id from public.coach_photo_pairings where coach_id = pg_temp.qu('n');
grant select on qn to authenticated;
set role authenticated;
do $$
declare pair uuid := (select id from qn);
begin
  perform pg_temp.qlogin('n');
  for i in 1..30 loop perform public.coach_photo_pair_peek(pair); end loop;
  if pg_temp.qerr(format('select public.coach_photo_pair_peek(%L)', pair)) <> 'rate_limited' then raise '31e lecture du téléphone acceptée'; end if;
end $$;
-- Navigateur : 600 relectures par 10 minutes (une relecture toutes les 1,5 s pendant 7 essais ne bute jamais dessus)
do $$
declare pair uuid := (select id from qn);
begin
  perform pg_temp.qlogin('n');
  for i in 1..600 loop perform public.coach_photo_pair_status(pair); end loop;
  if pg_temp.qerr(format('select public.coach_photo_pair_status(%L)', pair)) <> 'rate_limited' then raise '601e relecture acceptée'; end if;
end $$;
reset role;
drop table qn;

-- ── Purge : les ordinateurs expirés de TOUS les coachs (pas seulement de celui qui appelle) ──
insert into public.coach_photo_devices (id, coach_id, key_id, label, wrapped, iv, last_used_at)
  values ('00000000-0000-4000-8000-00000007c905', pg_temp.qu('n'), pg_temp.qkid('n'), 'Oublié', repeat('A', 80), repeat('A', 16), now() - interval '40 days');
set role authenticated;
do $$ begin perform pg_temp.qlogin('l'); perform public.coach_photo_devices(); end $$;
reset role;
do $$ begin if exists (select 1 from public.coach_photo_devices where id = '00000000-0000-4000-8000-00000007c905') then raise 'ordinateur expiré d''un autre coach gardé'; end if; end $$;

-- ── 30 jours sans usage, 90 jours au plus ────────────────
update public.coach_photo_devices set last_used_at = now() - interval '31 days' where id = (select v::uuid from qt where k = 'pair');
set role authenticated;
do $$ begin
  perform pg_temp.qlogin('k');
  if pg_temp.qerr(format('select public.coach_photo_device_key(%L)', (select v from qt where k = 'pair'))) <> 'not_found' then raise '30 jours sans usage : encore relié'; end if;
  -- La liste du téléphone fait le ménage (le refus ci-dessus annule sa transaction, donc son ménage)
  if jsonb_array_length(public.coach_photo_devices()) <> 0 then raise 'ordinateur expiré listé'; end if;
end $$;
reset role;
do $$ begin if exists (select 1 from public.coach_photo_devices where id = (select v::uuid from qt where k = 'pair')) then raise 'ordinateur expiré gardé'; end if; end $$;
insert into public.coach_photo_devices (id, coach_id, key_id, label, wrapped, iv, expires_at)
  values ('00000000-0000-4000-8000-00000007c901', pg_temp.qu('k'), pg_temp.qkid('k'), 'Vieux', repeat('A', 80), repeat('A', 16), now() - interval '1 minute'),
         ('00000000-0000-4000-8000-00000007c902', pg_temp.qu('k'), pg_temp.qkid('k'), 'Neuf', repeat('A', 80), repeat('A', 16), default);
set role authenticated;
do $$ begin
  perform pg_temp.qlogin('k');
  if pg_temp.qerr($q$select public.coach_photo_device_key('00000000-0000-4000-8000-00000007c901')$q$) <> 'not_found' then raise '90 jours : encore relié'; end if;
  -- Usage : la date de dernier usage avance (au plus une fois par heure)
  perform public.coach_photo_device_key('00000000-0000-4000-8000-00000007c902');
end $$;
reset role;
update public.coach_photo_devices set last_used_at = now() - interval '2 hours' where id = '00000000-0000-4000-8000-00000007c902';
set role authenticated;
do $$ begin perform pg_temp.qlogin('k'); perform public.coach_photo_device_key('00000000-0000-4000-8000-00000007c902'); end $$;
reset role;
do $$ begin
  if (select last_used_at from public.coach_photo_devices where id = '00000000-0000-4000-8000-00000007c902') < now() - interval '1 minute' then raise 'dernier usage pas repoussé'; end if;
end $$;

-- ── Rôle retiré, photos éteintes : plus d'enveloppe ; retirer marche toujours ──
update public.user_profiles set coach_at = null where user_id = pg_temp.qu('k');
set role authenticated;
do $$ begin
  perform pg_temp.qlogin('k');
  if pg_temp.qerr($q$select public.coach_photo_device_key('00000000-0000-4000-8000-00000007c902')$q$) <> 'not_coach' then raise 'rôle retiré : enveloppe rendue'; end if;
end $$;
reset role;
update public.user_profiles set coach_at = now() where user_id = pg_temp.qu('k');
update public.app_config set value = 'false'::jsonb where key = 'coach_photos_on';
set role authenticated;
do $$ begin
  perform pg_temp.qlogin('k');
  if pg_temp.qerr($q$select public.coach_photo_device_key('00000000-0000-4000-8000-00000007c902')$q$) <> 'disabled' then raise 'éteint : enveloppe rendue'; end if;
  if pg_temp.qerr(format('select public.coach_photo_pair_start(%L, %L, %L)', pg_temp.qpk(), pg_temp.qver(), 'x')) <> 'disabled' then raise 'éteint : appairage'; end if;
end $$;
reset role;
update public.app_config set value = 'true'::jsonb where key = 'coach_photos_on';

-- ── Retrait par le coach ─────────────────────────────────
set role authenticated;
do $$ begin
  perform pg_temp.qlogin('k');
  perform public.coach_photo_device_revoke('00000000-0000-4000-8000-00000007c902');
  if pg_temp.qerr($q$select public.coach_photo_device_key('00000000-0000-4000-8000-00000007c902')$q$) <> 'not_found' then raise 'retiré : encore relié'; end if;
end $$;
reset role;

-- ── Clé changée sur l'iPhone : plus aucun ordinateur relié ──
insert into public.coach_photo_devices (id, coach_id, key_id, label, wrapped, iv)
  values ('00000000-0000-4000-8000-00000007c903', pg_temp.qu('l'), pg_temp.qkid('l'), 'Mac', repeat('A', 80), repeat('A', 16));
set role authenticated;
do $$ begin
  perform pg_temp.qlogin('l');
  perform public.coach_photo_key_set(repeat('9', 32), pg_temp.qpk('P'), repeat('A', 80), repeat('A', 16), true);
  if pg_temp.qerr($q$select public.coach_photo_device_key('00000000-0000-4000-8000-00000007c903')$q$) <> 'not_found' then raise 'clé changée : encore relié'; end if;
end $$;
reset role;
do $$ begin if exists (select 1 from public.coach_photo_devices where coach_id = pg_temp.qu('l')) then raise 'clé changée : ordinateur gardé'; end if; end $$;

-- ── Compte supprimé : appairages et ordinateurs partis ───
insert into public.coach_photo_devices (id, coach_id, key_id, label, wrapped, iv)
  values ('00000000-0000-4000-8000-00000007c904', pg_temp.qu('k'), pg_temp.qkid('k'), 'Mac', repeat('A', 80), repeat('A', 16));
set role authenticated;
do $$ begin perform pg_temp.qlogin('k'); perform public.coach_photo_pair_start(pg_temp.qpk(), pg_temp.qver(), 'PC'); end $$;
reset role;
delete from auth.users where id = pg_temp.qu('k');
do $$ begin
  if exists (select 1 from public.coach_photo_devices where coach_id = pg_temp.qu('k')) or exists (select 1 from public.coach_photo_pairings where coach_id = pg_temp.qu('k')) then
    raise 'compte supprimé : appairage ou ordinateur gardé';
  end if;
end $$;
drop table qt;
