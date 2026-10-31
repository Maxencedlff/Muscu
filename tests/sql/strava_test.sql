-- Vérifications de supabase/migrations/20261031620000_strava.sql (lancées par tests/sql/run.sh).
-- Chaque bloc échoue (raise) si la règle n'est pas tenue.
--
-- Comptes simulés : pg_temp.su('a') → …0000000007b1 (relié à Strava), 'b' → …7b2 (autre compte,
-- jamais relié), 'c' → …7b3 (limites). pg_temp.slogin change d'utilisateur (auth.uid()).
-- Jetons : textes factices (« chiffre-factice-… »), jamais un vrai jeton.

create function pg_temp.serr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.su(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000007b' || translate(c, 'abc', '123'))::uuid $$;
create function pg_temp.slogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.su(c)::text, ''), false) $$;
create function pg_temp.shash(n int) returns text language sql immutable as
$$ select lpad(to_hex(n), 64, '0') $$;
grant execute on function pg_temp.serr(text), pg_temp.su(text), pg_temp.slogin(text), pg_temp.shash(int)
  to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.su(c) from unnest(array['a', 'b', 'c']) c;

-- ── Personne d'autre que les fonctions ne touche aux tables ─
do $$ begin
  if exists (select 1 from pg_class c where c.relnamespace = 'private'::regnamespace and c.relname like 'strava_%'
             and c.relkind = 'r' and not c.relrowsecurity) then raise 'RLS désactivée sur une table strava'; end if;
  if exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'private' and g.table_name like 'strava_%'
             and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')) then raise 'GRANT sur une table strava'; end if;
  -- Toutes les fonctions strava : security definer, search_path vide
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'strava_%'
             and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false))) then
    raise 'fonction strava sans security definer ou search_path vide';
  end if;
end $$;

set role anon;
do $$ begin
  if pg_temp.serr('select public.strava_status()') not like 'permission denied%' then raise 'anon lit strava_status'; end if;
  if pg_temp.serr('select * from private.strava_links') not like 'permission denied%' then raise 'anon lit les liaisons'; end if;
  if pg_temp.serr($q$ select public.strava_link_get('00000000-0000-0000-0000-0000000007b1') $q$) not like 'permission denied%' then raise 'anon lit les jetons'; end if;
end $$;
reset role;

set role authenticated;
do $$
declare f text;
begin
  perform pg_temp.slogin('b');
  if pg_temp.serr('select * from private.strava_links') not like 'permission denied%' then raise 'client lit les liaisons'; end if;
  if pg_temp.serr('select * from private.strava_exports') not like 'permission denied%' then raise 'client lit les envois'; end if;
  -- Aucune fonction réservée aux fonctions Edge n'est appelable avec un jeton de session
  foreach f in array array[
    $q$ select public.strava_state_create('00000000-0000-0000-0000-0000000007b2', repeat('a', 64)) $q$,
    $q$ select public.strava_state_consume(repeat('a', 64)) $q$,
    $q$ select public.strava_link_save('00000000-0000-0000-0000-0000000007b2', 1, 'x', 'activity:write', repeat('x', 30), now()) $q$,
    $q$ select * from public.strava_link_get('00000000-0000-0000-0000-0000000007b1') $q$,
    $q$ select public.strava_link_tokens('00000000-0000-0000-0000-0000000007b1', repeat('x', 30), now()) $q$,
    $q$ select public.strava_link_delete('00000000-0000-0000-0000-0000000007b1') $q$,
    $q$ select public.strava_export_begin('00000000-0000-0000-0000-0000000007b1', 's1') $q$,
    $q$ select public.strava_export_finish('00000000-0000-0000-0000-0000000007b1', 's1', 1) $q$] loop
    if pg_temp.serr(f) not like 'permission denied%' then raise 'client appelle une fonction serveur : %', f; end if;
  end loop;
  if public.strava_status() is distinct from '{"connected": false, "athlete_name": null, "connected_at": null, "can_write": false, "exports": []}'::jsonb then
    raise 'état sans liaison : %', public.strava_status();
  end if;
end $$;
reset role;

-- ── Liaison (fonctions Edge) ─────────────────────────────────
set role service_role;
do $$
declare st jsonb; prev text;
begin
  -- État : mal formé refusé, usage unique, remplacé par le suivant, périmé inutilisable
  if pg_temp.serr($q$ select public.strava_state_create('00000000-0000-0000-0000-0000000007b1', 'pas-une-empreinte') $q$) <> 'invalid' then raise 'état mal formé accepté'; end if;
  perform public.strava_state_create(pg_temp.su('a'), pg_temp.shash(1));
  perform public.strava_state_create(pg_temp.su('a'), pg_temp.shash(2));
  if public.strava_state_consume(pg_temp.shash(1)) is not null then raise 'ancien état encore valable'; end if;
  if public.strava_state_consume(pg_temp.shash(2)) is distinct from pg_temp.su('a') then raise 'état valable refusé'; end if;
  if public.strava_state_consume(pg_temp.shash(2)) is not null then raise 'état réutilisé'; end if;
  if public.strava_state_consume(pg_temp.shash(999)) is not null then raise 'état inventé accepté'; end if;

  -- Envoi sans liaison : not_connected
  if pg_temp.serr($q$ select public.strava_export_begin('00000000-0000-0000-0000-0000000007b1', 's1') $q$) <> 'not_connected' then raise 'envoi sans liaison'; end if;

  prev := public.strava_link_save(pg_temp.su('a'), 4242, '  Léa  ', 'read,activity:write', 'chiffre-factice-1-xxxxxxxxxxxx', now() + interval '6 hours');
  if prev is not null then raise 'première liaison : rien à révoquer'; end if;
  if (select count(*) from public.strava_link_get(pg_temp.su('a'))) <> 1 then raise 'liaison absente'; end if;
  if (select count(*) from public.strava_link_get(pg_temp.su('b'))) <> 0 then raise 'liaison d''un autre lue'; end if;
  perform public.strava_link_tokens(pg_temp.su('a'), 'chiffre-factice-2-xxxxxxxxxxxx', now() + interval '6 hours');
  if (select tokens from public.strava_link_get(pg_temp.su('a'))) <> 'chiffre-factice-2-xxxxxxxxxxxx' then raise 'jetons non renouvelés'; end if;
  -- Renouvellement sans liaison : ne recrée rien
  perform public.strava_link_tokens(pg_temp.su('b'), 'chiffre-factice-3-xxxxxxxxxxxx', now());
  if (select count(*) from public.strava_link_get(pg_temp.su('b'))) <> 0 then raise 'liaison recréée par un renouvellement'; end if;
  if pg_temp.serr($q$ select public.strava_link_save('00000000-0000-0000-0000-0000000007b2', 0, 'x', 'read', 'chiffre-factice-xxxxxxxxxxxxx', now()) $q$) not like '%check constraint%' then raise 'athlète 0 accepté'; end if;
  if pg_temp.serr($q$ select public.strava_link_save('00000000-0000-0000-0000-0000000007b2', 1, 'x', 'read', 'court', now()) $q$) not like '%check constraint%' then raise 'jetons trop courts acceptés'; end if;

  -- Envoi : go, busy, finish, done ; échec levé (réessai immédiat)
  st := public.strava_export_begin(pg_temp.su('a'), 's1');
  if st->>'status' <> 'go' then raise 'premier envoi : %', st; end if;
  st := public.strava_export_begin(pg_temp.su('a'), 's1');
  if st->>'status' <> 'busy' then raise 'double toucher : %', st; end if;
  perform public.strava_export_finish(pg_temp.su('a'), 's1', 12345678901234);
  st := public.strava_export_begin(pg_temp.su('a'), 's1');
  if st is distinct from '{"status": "done", "activity_id": "12345678901234"}'::jsonb then raise 'séance déjà envoyée : %', st; end if;
  st := public.strava_export_begin(pg_temp.su('a'), 's2');
  perform public.strava_export_finish(pg_temp.su('a'), 's2', null);
  st := public.strava_export_begin(pg_temp.su('a'), 's2');
  if st->>'status' <> 'go' then raise 'réessai après un échec : %', st; end if;
  perform public.strava_export_finish(pg_temp.su('a'), 's2', null);
  if pg_temp.serr('select * from private.strava_exports') not like 'permission denied%' then raise 'la clé serveur lit la table directement'; end if;
  perform public.strava_export_begin(pg_temp.su('a'), 's2');
end $$;
reset role;
-- Réservation de plus de 2 minutes (envoi interrompu) : reprise possible
update private.strava_exports set claimed_at = now() - interval '3 minutes' where session_id = 's2';
set role service_role;
do $$ begin
  if pg_temp.serr($q$ select public.strava_export_begin('00000000-0000-0000-0000-0000000007b1', 's2') $q$) <> 'ok' then raise 'reprise refusée'; end if;
  if pg_temp.serr($q$ select public.strava_export_begin('00000000-0000-0000-0000-0000000007b1', 'hk:santé') $q$) <> 'invalid' then raise 'identifiant hors alphabet accepté'; end if;
end $$;
reset role;

-- ── L'app ne voit que son état, sans jeton ──────────────────
set role authenticated;
do $$
declare st jsonb;
begin
  perform pg_temp.slogin('a');
  st := public.strava_status();
  if st->>'connected' <> 'true' or st->>'athlete_name' <> 'Léa' or st->>'can_write' <> 'true' then raise 'état relié : %', st; end if;
  if st->'exports' is distinct from '[{"session_id": "s1", "activity_id": "12345678901234"}]'::jsonb then raise 'envois : %', st->'exports'; end if;
  if st::text like '%chiffre-factice%' or st::text like '%4242%' then raise 'jeton ou identifiant Strava renvoyé à l''app'; end if;
  perform pg_temp.slogin('b');
  if (public.strava_status())->>'connected' <> 'false' then raise 'B voit la liaison de A'; end if;
end $$;
reset role;

-- ── Changement d'athlète, déconnexion, limites, cascade ────
set role service_role;
do $$
declare prev text; i int;
begin
  -- Autre athlète : les jetons d'avant sont rendus (à révoquer), les envois notés oubliés
  prev := public.strava_link_save(pg_temp.su('a'), 5151, 'Max', 'read', 'chiffre-factice-4-xxxxxxxxxxxx', now() + interval '6 hours');
  if prev is distinct from 'chiffre-factice-2-xxxxxxxxxxxx' then raise 'jetons de l''ancien athlète non rendus : %', prev; end if;
  if (public.strava_export_begin(pg_temp.su('a'), 's1'))->>'status' <> 'go' then raise 'envois de l''ancien athlète gardés'; end if;
  -- Même athlète reconnecté : rien à révoquer
  if public.strava_link_save(pg_temp.su('a'), 5151, 'Max', 'read,activity:write', 'chiffre-factice-5-xxxxxxxxxxxx', now()) is not null then raise 'même athlète : rien à révoquer'; end if;
  -- Athlète déjà relié à A : B ne peut pas le relier à son compte (lien d'autorisation tiré par B et
  -- ouvert par la personne de A), A garde sa liaison et ses jetons
  if pg_temp.serr($q$ select public.strava_link_save('00000000-0000-0000-0000-0000000007b2', 5151, 'Max', 'activity:write', 'chiffre-factice-b-xxxxxxxxxxxx', now()) $q$) <> 'athlete_taken' then
    raise 'athlète de A relié aussi à B';
  end if;
  if (select count(*) from public.strava_link_get(pg_temp.su('b'))) <> 0 then raise 'liaison créée pour B'; end if;
  if (select tokens from public.strava_link_get(pg_temp.su('a'))) <> 'chiffre-factice-5-xxxxxxxxxxxx' then raise 'jetons de A touchés par B'; end if;
  -- Même refus quand B est déjà relié à un autre athlète : il garde le sien
  perform public.strava_link_save(pg_temp.su('b'), 6262, 'Bob', 'activity:write', 'chiffre-factice-b-xxxxxxxxxxxx', now());
  if pg_temp.serr($q$ select public.strava_link_save('00000000-0000-0000-0000-0000000007b2', 5151, 'Max', 'activity:write', 'chiffre-factice-b2-xxxxxxxxxxx', now()) $q$) <> 'athlete_taken' then
    raise 'B passe à l''athlète de A';
  end if;
  if (select athlete_id from public.strava_link_get(pg_temp.su('b'))) <> 6262 then raise 'liaison de B changée'; end if;
  perform public.strava_link_delete(pg_temp.su('b'));
  -- L'index tient même sans la fonction (deux liaisons simultanées)
  if not exists (select 1 from pg_indexes where schemaname = 'private' and indexname = 'strava_links_athlete' and indexdef like 'CREATE UNIQUE INDEX%(athlete_id)') then
    raise 'index unique sur athlete_id absent';
  end if;
  perform public.strava_state_create(pg_temp.su('a'), pg_temp.shash(3));
  -- Déconnexion : les jetons sont rendus pour la révocation
  if public.strava_link_delete(pg_temp.su('a')) is distinct from 'chiffre-factice-5-xxxxxxxxxxxx' then raise 'jetons non rendus à la déconnexion'; end if;
  if public.strava_link_delete(pg_temp.su('a')) is not null then raise 'seconde déconnexion'; end if;
  if public.strava_state_consume(pg_temp.shash(3)) is not null then raise 'état en attente gardé après la déconnexion'; end if;
  -- Une fois A déconnecté, cet athlète peut être relié à un autre compte
  if pg_temp.serr($q$ select public.strava_link_save('00000000-0000-0000-0000-0000000007b2', 5151, 'Max', 'activity:write', 'chiffre-factice-b3-xxxxxxxxxxx', now()) $q$) <> 'ok' then
    raise 'athlète libéré refusé';
  end if;
  perform public.strava_link_delete(pg_temp.su('b'));

  -- Limites : 10 débuts de liaison par heure, 30 envois par 24 h
  for i in 1..10 loop perform public.strava_state_create(pg_temp.su('c'), pg_temp.shash(100 + i)); end loop;
  if pg_temp.serr($q$ select public.strava_state_create('00000000-0000-0000-0000-0000000007b3', lpad('ff', 64, '0')) $q$) <> 'rate_limited' then raise '11e liaison dans l''heure'; end if;
  perform public.strava_link_save(pg_temp.su('c'), 7, null, 'activity:write', 'chiffre-factice-6-xxxxxxxxxxxx', now());
  for i in 1..30 loop perform public.strava_export_begin(pg_temp.su('c'), 'x' || i); end loop;
  if pg_temp.serr($q$ select public.strava_export_begin('00000000-0000-0000-0000-0000000007b3', 'x31') $q$) <> 'rate_limited' then raise '31e envoi du jour'; end if;
  -- Réservation déjà prise : ne recompte pas
  if (public.strava_export_begin(pg_temp.su('c'), 'x1'))->>'status' <> 'busy' then raise 'reprise comptée comme un envoi'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from private.strava_links where user_id = pg_temp.su('a')) or exists (select 1 from private.strava_exports where user_id = pg_temp.su('a'))
     or exists (select 1 from private.strava_states where user_id = pg_temp.su('a')) then raise 'déconnexion incomplète'; end if;
end $$;

-- Droits sans activity:write : can_write faux (l'app propose de relier à nouveau)
set role authenticated;
do $$ begin
  perform pg_temp.slogin('c');
  if (public.strava_status())->>'can_write' <> 'true' then raise 'droits d''écriture non lus'; end if;
end $$;
reset role;
update private.strava_links set scope = 'read,activity:write_not' where user_id = pg_temp.su('c');
set role authenticated;
do $$ begin
  perform pg_temp.slogin('c');
  if (public.strava_status())->>'can_write' <> 'false' then raise 'scope voisin pris pour activity:write'; end if;
end $$;
reset role;

-- Suppression du compte : tout part en cascade
delete from auth.users where id = pg_temp.su('c');
do $$ begin
  if exists (select 1 from private.strava_links where user_id = pg_temp.su('c')) or exists (select 1 from private.strava_exports where user_id = pg_temp.su('c'))
     or exists (select 1 from private.strava_states where user_id = pg_temp.su('c')) then raise 'données Strava restées après suppression du compte'; end if;
end $$;
delete from auth.users where id in (pg_temp.su('a'), pg_temp.su('b'));
