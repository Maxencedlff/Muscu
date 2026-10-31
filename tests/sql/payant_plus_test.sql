-- Vérifications de 20261031000000_payant_plus.sql (accès à vie offerts révocables et tracés), lancées
-- par tests/sql/run.sh après TOUTES les migrations. Pas d'achat à vie payant (refusé le 31/10/2026).
-- Comptes simulés …000000000b0x : 2 tente un code désactivé, 4 reçoit un accès à vie de
-- l'administrateur, 5 utilise un code à vie, 7 utilise un code de jours, 9 est coach avec un palier ET
-- un accès à vie offert. Rien n'est appliqué en production.

create function pg_temp.verr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.vu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-000000000b0' || c)::uuid $$;
create function pg_temp.vlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.vu(c)::text, false) $$;
-- Ce que fait une fonction Edge (clé serveur), sans quitter le rôle courant
create function pg_temp.vsrv(stmt text) returns text language plpgsql as
$$
declare r text;
begin
  set local role service_role;
  r := pg_temp.verr(stmt);
  set local role authenticated;
  return r;
end
$$;
grant execute on function pg_temp.verr(text), pg_temp.vu(text), pg_temp.vlogin(text), pg_temp.vsrv(text)
  to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.vu(c) from unnest(array['2', '4', '5', '7', '9']) c;
insert into public.user_profiles (user_id, username, avatar_emoji)
  select pg_temp.vu(c), 'vie' || c || '.t1', '🦁' from unnest(array['2', '4', '5', '7', '9']) c;
update public.app_config set value = 'true'::jsonb where key = 'paywall_on';

-- ── Aucun achat à vie : seuls les dix abonnements sont des produits ──
do $$ begin
  if private.access_product_kind('com.mdlf.training.lifetime') is not null then raise 'produit à vie reconnu'; end if;
  if (select count(*) from unnest(array['pro', 'coach10', 'coach20', 'coach30', 'coachmax']) t, unnest(array['monthly', 'yearly']) p
       where private.access_product_kind('com.mdlf.training.' || t || '.' || p) = 'sub') <> 10 then raise 'abonnements'; end if;
end $$;
set role authenticated;
do $$ begin
  if pg_temp.vsrv(format('select public.srv_access_purchase(%L, %L, null, %L, false, now(), null, ''Production'')',
       pg_temp.vu('2'), 'com.mdlf.training.lifetime', 'life-x')) is distinct from 'unknown_product' then raise 'achat à vie accepté'; end if;
end $$;

-- ── Coach avec un palier ET un accès à vie offert (Cyril) : le palier coach reste ──
do $$
declare st jsonb;
begin
  perform pg_temp.vlogin('9');
  perform pg_temp.vsrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, now(), null, ''Production'')',
    pg_temp.vu('9'), 'com.mdlf.training.coach10.monthly', now() + interval '20 days', 'sub-9-coach'));
  reset role;
  if not (private.grant_lifetime(pg_temp.vu('9'), 'Coach partenaire') ->> 'ok')::boolean then raise 'attribution coach'; end if;
  if private.coach_paid_limit(pg_temp.vu('9')) is distinct from 10 then raise 'palier coach perdu'; end if;
  set role authenticated;
  st := public.access_state();
  if st ->> 'status' <> 'gift' or st -> 'until' <> 'null'::jsonb or not (st ->> 'can_write')::boolean then raise 'coach à vie : %', st; end if;
end $$;

-- ── Accès à vie attribué par l'administrateur : tracé, révocable ──
reset role;
create temp table vcodes (who text, code text);
grant all on vcodes to authenticated, anon;
do $$
declare r jsonb; st jsonb; c text;
begin
  r := private.grant_lifetime(pg_temp.vu('4'), 'Maxence');
  if not (r ->> 'ok')::boolean or r ->> 'code' !~ '^[A-HJ-NP-Z2-9]{12}$' then raise 'attribution : %', r; end if;
  insert into vcodes values ('grant', r ->> 'code');
  -- Tracé : code au nom du compte, utilisé une fois, à l'heure de l'attribution
  if (select note from public.gift_codes where code = r ->> 'code') <> 'attribué : Maxence'
     or (select uses from public.gift_codes where code = r ->> 'code') <> 1
     or not exists (select 1 from public.gift_redemptions where code = r ->> 'code' and user_id = pg_temp.vu('4') and revoked_at is null)
     then raise 'trace de l''attribution'; end if;
  if (select count(*) from private.lifetime_access where user_id = pg_temp.vu('4') and revoked_at is null) <> 1 then raise 'vue lifetime_access'; end if;
  -- Une seconde attribution ne double rien
  if private.grant_lifetime(pg_temp.vu('4'), 'Maxence') ->> 'error' <> 'already_lifetime' then raise 'double attribution'; end if;
  if pg_temp.verr(format('select private.grant_lifetime(%L, %L)', pg_temp.vu('4'), ' ')) <> 'invalid_note' then raise 'attribution sans note'; end if;
  if pg_temp.verr(format('select private.grant_lifetime(%L, %L)', '00000000-0000-0000-0000-000000000bff', 'inconnu')) <> 'not_found' then raise 'compte inconnu'; end if;
  st := private.access_json(pg_temp.vu('4'));
  if st ->> 'status' <> 'gift' or not (st ->> 'can_write')::boolean or st -> 'until' <> 'null'::jsonb
     or st -> 'gift_until' <> 'null'::jsonb then raise 'accès offert : %', st; end if;
  -- Retrait : l'accès tombe, la trace reste
  if pg_temp.verr(format('select private.revoke_lifetime(%L, %L)', pg_temp.vu('4'), '')) <> 'invalid_reason' then raise 'retrait sans motif'; end if;
  r := private.revoke_lifetime(pg_temp.vu('4'), 'fin du test');
  if (r ->> 'revoked')::int <> 1 or r ->> 'status' <> 'none' then raise 'retrait : %', r; end if;
  st := private.access_json(pg_temp.vu('4'));
  if st ->> 'status' <> 'none' or (st ->> 'can_write')::boolean or (st ->> 'gift')::boolean then raise 'après retrait : %', st; end if;
  if (select revoke_reason from public.gift_redemptions where code = (select code from vcodes where who = 'grant')) <> 'fin du test' then raise 'motif du retrait'; end if;
  if (private.revoke_lifetime(pg_temp.vu('4'), 'encore') ->> 'revoked')::int <> 0 then raise 'retrait rejoué'; end if;
  -- Une nouvelle attribution est possible après un retrait
  if not (private.grant_lifetime(pg_temp.vu('4'), 'Maxence, de retour') ->> 'ok')::boolean then raise 'réattribution'; end if;
  if private.access_json(pg_temp.vu('4')) ->> 'status' <> 'gift' then raise 'réattribution sans accès'; end if;
  -- Codes pour la suite
  select x into c from private.make_gift_code('lifetime', null, 1, 'Testeurs', interval '1 year', 2) x;
  insert into vcodes values ('vie', c);
  select x into c from private.make_gift_code('days', 30, 1, 'Jours') x;
  insert into vcodes values ('jours', c);
end $$;

-- ── Code à vie utilisé, puis désactivé : l'accès tombe, plus personne ne l'utilise ──
set role authenticated;
do $$
declare g jsonb; st jsonb; r jsonb;
begin
  perform pg_temp.vlogin('4');
  -- Le code retiré du compte 4 ne se réutilise pas
  g := public.redeem_gift_code((select code from vcodes where who = 'grant'));
  if g ->> 'error' <> 'already_redeemed' then raise 'code attribué réutilisé : %', g; end if;
  perform pg_temp.vlogin('5');
  g := public.redeem_gift_code(lower((select code from vcodes where who = 'vie')));
  if not (g ->> 'ok')::boolean or g -> 'access' ->> 'status' <> 'gift' or g -> 'access' -> 'until' <> 'null'::jsonb then raise 'code à vie : %', g; end if;
  perform pg_temp.vlogin('7');
  g := public.redeem_gift_code((select code from vcodes where who = 'jours'));
  if not (g ->> 'ok')::boolean or g -> 'access' ->> 'status' <> 'gift' or g -> 'access' -> 'until' = 'null'::jsonb then raise 'code de jours : %', g; end if;
  -- Le client ne désactive rien, ne lit pas la trace
  if pg_temp.verr($q$ select private.revoke_gift_code('ABCDEFGHJKLM', 'x x') $q$) not like 'permission denied%' then raise 'revoke_gift_code appelable'; end if;
  if pg_temp.verr(format('select private.revoke_lifetime(%L, %L)', pg_temp.vu('5'), 'x x')) not like 'permission denied%' then raise 'revoke_lifetime appelable'; end if;
  if pg_temp.verr(format('select private.grant_lifetime(%L, %L)', pg_temp.vu('7'), 'moi-même')) not like 'permission denied%' then raise 'grant_lifetime appelable'; end if;
  if pg_temp.verr($q$ select * from private.lifetime_access $q$) not like 'permission denied%' then raise 'vue lisible'; end if;
  if pg_temp.verr($q$ update public.gift_redemptions set revoked_at = null $q$) not like 'permission denied%' then raise 'retrait effaçable'; end if;
end $$;
reset role;
do $$
declare r jsonb; st jsonb;
begin
  r := private.revoke_gift_code(lower((select code from vcodes where who = 'vie')), 'code publié sur un forum');
  if not (r ->> 'found')::boolean or (r ->> 'revoked')::int <> 1 then raise 'désactivation : %', r; end if;
  if private.access_json(pg_temp.vu('5')) ->> 'status' <> 'none' then raise 'code désactivé : accès gardé'; end if;
  if (private.revoke_gift_code('ZZZZZZZZZZZZ', 'inconnu') ->> 'found')::boolean then raise 'code inconnu trouvé'; end if;
  -- Un code de jours désactivé : les jours déjà offerts restent (documenté)
  r := private.revoke_gift_code((select code from vcodes where who = 'jours'), 'fin de l''offre');
  if (r ->> 'revoked')::int <> 0 or private.access_json(pg_temp.vu('7')) ->> 'status' <> 'gift' then raise 'jours retirés : %', r; end if;
end $$;
set role authenticated;
do $$
declare g jsonb;
begin
  -- Le second usage prévu du code désactivé est refusé
  perform pg_temp.vlogin('2');
  g := public.redeem_gift_code((select code from vcodes where who = 'vie'));
  if (g ->> 'ok')::boolean or g ->> 'error' <> 'code_expired' then raise 'code désactivé utilisé : %', g; end if;
end $$;
reset role;

-- ── Droits : aucune nouvelle brique n'est exécutable par l'API ──
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'private'::regnamespace
             and p.proname in ('access_refresh', 'grant_lifetime', 'revoke_lifetime', 'revoke_gift_code') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute') then raise '% : exécutable par l''API', f; end if;
  end loop;
  if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
           where p.oid = 'private.access_refresh(uuid)'::regprocedure) then raise 'access_refresh : security definer et search_path vide'; end if;
  if has_function_privilege('anon', 'public.redeem_gift_code(text)', 'execute') then raise 'redeem_gift_code pour anon'; end if;
  if not has_function_privilege('authenticated', 'public.redeem_gift_code(text)', 'execute') then raise 'redeem_gift_code fermé'; end if;
  if has_table_privilege('authenticated', 'private.lifetime_access', 'select') or has_table_privilege('service_role', 'private.lifetime_access', 'select')
     then raise 'vue lifetime_access ouverte'; end if;
  if (select prosecdef from pg_proc where oid = 'public.redeem_gift_code(text)'::regprocedure) is not true then raise 'redeem_gift_code invoker'; end if;
end $$;

update public.app_config set value = 'false'::jsonb where key = 'paywall_on';

-- Ménage : les fichiers suivants (payant_test.sql…) comptent sur des tables de codes vierges
delete from public.gift_codes where code in (select code from vcodes) or note like 'attribué : Maxence%' or note = 'attribué : Coach partenaire';
delete from auth.users where id in (select pg_temp.vu(c) from unnest(array['2', '4', '5', '7', '9']) c);
