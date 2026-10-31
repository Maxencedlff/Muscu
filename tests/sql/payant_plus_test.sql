-- Vérifications de 20261031000000_payant_plus.sql (accès à vie payant, accès à vie offerts révocables
-- et tracés), lancées par tests/sql/run.sh après TOUTES les migrations.
-- Comptes simulés …000000000b0x : 1 achète l'accès à vie, 2 tente de voler son achat, 3 achète en
-- Sandbox (TestFlight), 4 reçoit un accès à vie de l'administrateur, 5 utilise un code à vie, 6 a un
-- abonnement ET l'accès à vie, 7 utilise un code de jours. Rien n'est appliqué en production.

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

insert into auth.users (id) select pg_temp.vu(c) from unnest(array['1', '2', '3', '4', '5', '6', '7']) c;
insert into public.user_profiles (user_id, username, avatar_emoji)
  select pg_temp.vu(c), 'vie' || c || '.t1', '🦁' from unnest(array['1', '2', '3', '4', '5', '6', '7']) c;
update public.app_config set value = 'true'::jsonb where key = 'paywall_on';

-- ── Produit : l'accès à vie est reconnu, les dix abonnements ne changent pas ──
do $$ begin
  if private.access_product_kind('com.mdlf.training.lifetime') is distinct from 'life' then raise 'produit à vie inconnu'; end if;
  if (select count(*) from unnest(array['pro', 'coach10', 'coach20', 'coach30', 'coachmax']) t, unnest(array['monthly', 'yearly']) p
       where private.access_product_kind('com.mdlf.training.' || t || '.' || p) = 'sub') <> 10 then raise 'abonnements'; end if;
  if private.access_product_kind('com.mdlf.training.access.gift') is not null then raise 'accès offert revenu'; end if;
  if private.coach_product_limit('com.mdlf.training.lifetime') is not null then raise 'l''accès à vie donne un palier coach'; end if;
end $$;

-- ── Achat à vie en Production : pas de fin, un seul compte ──
set role authenticated;
do $$
declare st jsonb;
begin
  perform pg_temp.vlogin('1');
  if public.my_access() ->> 'can_write' <> 'false' then raise 'verrou allumé, sans achat : écriture permise'; end if;
  if pg_temp.vsrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, now() - interval ''1 hour'', null, ''Production'')',
       pg_temp.vu('1'), 'com.mdlf.training.lifetime', now() + interval '3 days', 'life-1')) <> 'ok' then raise 'achat à vie refusé'; end if;
  st := public.my_access();
  if st ->> 'status' <> 'active' or st -> 'until' <> 'null'::jsonb or st -> 'days_left' <> 'null'::jsonb
     or st ->> 'lifetime' <> 'purchase' or not (st ->> 'can_write')::boolean or (st ->> 'also_sub')::boolean
     or (st ->> 'intro_offer')::boolean or (st ->> 'gift')::boolean then raise 'achat à vie : %', st; end if;
  -- Une date de fin envoyée avec un achat à vie (Production) est ignorée
  reset role;
  if (select expires_at from public.entitlement_claims where original_transaction_id = 'life-1') is not null then raise 'achat à vie daté'; end if;
  if (select kind from public.entitlement_claims where original_transaction_id = 'life-1') <> 'life' then raise 'nature'; end if;
  set role authenticated;
  -- Le même achat ne sert pas à un autre compte
  if pg_temp.vsrv(format('select public.srv_access_purchase(%L, %L, null, %L)', pg_temp.vu('2'), 'com.mdlf.training.lifetime', 'life-1'))
     is distinct from 'transaction_taken' then raise 'achat à vie volé'; end if;
  perform pg_temp.vlogin('2');
  if public.my_access() ->> 'status' <> 'none' then raise 'le voleur a un accès'; end if;
  -- Une transaction ne change pas de nature
  if pg_temp.vsrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.vu('1'), 'com.mdlf.training.pro.monthly',
       now() + interval '30 days', 'life-1')) is distinct from 'invalid_transaction' then raise 'achat à vie devenu abonnement'; end if;
  -- Le client n'écrit rien lui-même
  if pg_temp.verr(format('select public.srv_access_purchase(%L, %L, null, %L)', pg_temp.vu('2'), 'com.mdlf.training.lifetime', 'life-x'))
     not like 'permission denied%' then raise 'srv_access_purchase appelable par le client'; end if;
end $$;

-- ── Remboursement, notification rejouée, remboursement annulé par Apple ──
do $$
declare st jsonb;
begin
  perform pg_temp.vlogin('1');
  -- REFUND (appstore-notify) : l'accès tombe
  perform pg_temp.vsrv(format('select public.srv_access_event(%L, %L, null, true, now() - interval ''10 minutes'', false, %L, null, null, ''Production'')',
    'life-1', 'com.mdlf.training.lifetime', 'n-life-refund'));
  st := public.access_state();
  if st ->> 'status' <> 'expired' or (st ->> 'can_write')::boolean or st ->> 'lifetime' is not null then raise 'remboursé : %', st; end if;
  -- ONE_TIME_CHARGE rejouée, signée AVANT le remboursement : ne rouvre rien
  perform pg_temp.vsrv(format('select public.srv_access_event(%L, %L, null, false, now() - interval ''1 hour'', false, %L, null, null, ''Production'')',
    'life-1', 'com.mdlf.training.lifetime', 'n-life-replay'));
  if public.access_state() ->> 'status' <> 'expired' then raise 'notification rejouée : accès rouvert'; end if;
  -- verify-purchase : relecture (purchaseDate d'origine, plus ancienne) : ne rouvre rien non plus
  perform pg_temp.vsrv(format('select public.srv_access_purchase(%L, %L, null, %L, false, now() - interval ''1 hour'', null, ''Production'')',
    pg_temp.vu('1'), 'com.mdlf.training.lifetime', 'life-1'));
  if public.access_state() ->> 'status' <> 'expired' then raise 'relecture ancienne : accès rouvert'; end if;
  -- REFUND_REVERSED, plus récent que le remboursement : l'accès revient
  perform pg_temp.vsrv(format('select public.srv_access_event(%L, %L, null, false, now(), false, %L, null, null, ''Production'')',
    'life-1', 'com.mdlf.training.lifetime', 'n-life-reversed'));
  st := public.access_state();
  if st ->> 'status' <> 'active' or st ->> 'lifetime' <> 'purchase' or st -> 'until' <> 'null'::jsonb then raise 'remboursement annulé : %', st; end if;
end $$;

-- ── Achat à vie en Sandbox (TestFlight, examen d'Apple) : 7 jours, pas à vie ──
do $$
declare st jsonb;
begin
  perform pg_temp.vlogin('3');
  perform pg_temp.vsrv(format('select public.srv_access_purchase(%L, %L, null, %L, false, now() - interval ''1 day'', null, ''Sandbox'')',
    pg_temp.vu('3'), 'com.mdlf.training.lifetime', 'life-sb'));
  st := public.my_access();
  if st ->> 'status' <> 'active' or st ->> 'lifetime' <> 'test' or (st ->> 'days_left')::int <> 6
     or (st ->> 'until')::timestamptz not between now() + interval '6 days' - interval '1 minute' and now() + interval '6 days' + interval '1 minute'
     then raise 'achat Sandbox : %', st; end if;
  -- Une relecture plus tard ne prolonge pas la période de test
  perform pg_temp.vsrv(format('select public.srv_access_purchase(%L, %L, null, %L, false, now(), null, ''Sandbox'')',
    pg_temp.vu('3'), 'com.mdlf.training.lifetime', 'life-sb'));
  if (public.access_state() ->> 'until')::timestamptz > now() + interval '6 days' + interval '1 minute' then raise 'test prolongé'; end if;
  -- 8 jours plus tard : terminé
  reset role;
  update public.entitlement_claims set expires_at = now() - interval '1 day' where original_transaction_id = 'life-sb';
  perform private.access_refresh(pg_temp.vu('3'));
  set role authenticated;
  st := public.access_state();
  if st ->> 'status' <> 'expired' or (st ->> 'can_write')::boolean then raise 'test terminé : %', st; end if;
end $$;

-- ── Abonnement ET accès à vie : also_sub, pas d'essai affiché ──
do $$
declare st jsonb;
begin
  perform pg_temp.vlogin('6');
  perform pg_temp.vsrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, now(), true, ''Production'')',
    pg_temp.vu('6'), 'com.mdlf.training.pro.monthly', now() + interval '80 days', 'sub-6'));
  if not (public.my_access() ->> 'intro_offer')::boolean then raise 'essai avant l''achat à vie'; end if;
  perform pg_temp.vsrv(format('select public.srv_access_purchase(%L, %L, null, %L, false, now(), null, ''Production'')',
    pg_temp.vu('6'), 'com.mdlf.training.lifetime', 'life-6'));
  st := public.access_state();
  if st ->> 'lifetime' <> 'purchase' or not (st ->> 'also_sub')::boolean or (st ->> 'intro_offer')::boolean
     or st -> 'until' <> 'null'::jsonb then raise 'abonnement + à vie : %', st; end if;
  -- L'abonnement prend fin : also_sub retombe, l'accès à vie reste
  perform pg_temp.vsrv(format('select public.srv_access_event(%L, %L, now(), false, now() + interval ''1 second'', true, %L, null, false, ''Production'')',
    'sub-6', 'com.mdlf.training.pro.monthly', 'n-sub6-exp'));
  st := public.access_state();
  if st ->> 'lifetime' <> 'purchase' or (st ->> 'also_sub')::boolean or st ->> 'status' <> 'active' then raise 'fin de l''abonnement : %', st; end if;
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
  if (select count(*) from private.lifetime_access where user_id = pg_temp.vu('4') and source = 'gift' and revoked_at is null) <> 1 then raise 'vue lifetime_access'; end if;
  if (select count(*) from private.lifetime_access where user_id = pg_temp.vu('1') and source = 'purchase') <> 1 then raise 'achat absent de la vue'; end if;
  if exists (select 1 from private.lifetime_access where user_id = pg_temp.vu('3')) then raise 'achat Sandbox compté à vie'; end if;
  -- Une seconde attribution ne double rien
  if private.grant_lifetime(pg_temp.vu('4'), 'Maxence') ->> 'error' <> 'already_lifetime' then raise 'double attribution'; end if;
  if pg_temp.verr(format('select private.grant_lifetime(%L, %L)', pg_temp.vu('4'), ' ')) <> 'invalid_note' then raise 'attribution sans note'; end if;
  if pg_temp.verr(format('select private.grant_lifetime(%L, %L)', '00000000-0000-0000-0000-000000000bff', 'inconnu')) <> 'not_found' then raise 'compte inconnu'; end if;
  st := private.access_json(pg_temp.vu('4'));
  if st ->> 'status' <> 'gift' or st ->> 'lifetime' <> 'gift' or not (st ->> 'can_write')::boolean or st -> 'until' <> 'null'::jsonb then raise 'accès offert : %', st; end if;
  -- Retrait : l'accès tombe, la trace reste
  if pg_temp.verr(format('select private.revoke_lifetime(%L, %L)', pg_temp.vu('4'), '')) <> 'invalid_reason' then raise 'retrait sans motif'; end if;
  r := private.revoke_lifetime(pg_temp.vu('4'), 'fin du test');
  if (r ->> 'revoked')::int <> 1 or r ->> 'status' <> 'none' then raise 'retrait : %', r; end if;
  st := private.access_json(pg_temp.vu('4'));
  if st ->> 'status' <> 'none' or (st ->> 'can_write')::boolean or st ->> 'lifetime' is not null then raise 'après retrait : %', st; end if;
  if (select revoke_reason from public.gift_redemptions where code = (select code from vcodes where who = 'grant')) <> 'fin du test' then raise 'motif du retrait'; end if;
  if (private.revoke_lifetime(pg_temp.vu('4'), 'encore') ->> 'revoked')::int <> 0 then raise 'retrait rejoué'; end if;
  -- Une nouvelle attribution est possible après un retrait
  if not (private.grant_lifetime(pg_temp.vu('4'), 'Maxence, de retour') ->> 'ok')::boolean then raise 'réattribution'; end if;
  if private.access_json(pg_temp.vu('4')) ->> 'lifetime' <> 'gift' then raise 'réattribution sans accès'; end if;
  -- Un achat à vie payé ne se retire pas par l'administrateur (seul Apple rembourse)
  if (private.revoke_lifetime(pg_temp.vu('1'), 'essai') ->> 'revoked')::int <> 0 or private.access_json(pg_temp.vu('1')) ->> 'lifetime' <> 'purchase' then raise 'achat payé retiré'; end if;
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
  if not (g ->> 'ok')::boolean or g -> 'access' ->> 'lifetime' <> 'gift' then raise 'code à vie : %', g; end if;
  perform pg_temp.vlogin('7');
  g := public.redeem_gift_code((select code from vcodes where who = 'jours'));
  if not (g ->> 'ok')::boolean or g -> 'access' ->> 'status' <> 'gift' or g -> 'access' ->> 'lifetime' is not null then raise 'code de jours : %', g; end if;
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
             and p.proname in ('access_life_test_days', 'access_claim', 'access_refresh', 'access_json', 'grant_lifetime',
                               'revoke_lifetime', 'revoke_gift_code', 'access_product_kind') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute') then raise '% : exécutable par l''API', f; end if;
  end loop;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'private'::regnamespace
             and p.proname in ('access_claim', 'access_refresh', 'access_json') loop
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  if has_function_privilege('anon', 'public.redeem_gift_code(text)', 'execute') then raise 'redeem_gift_code pour anon'; end if;
  if not has_function_privilege('authenticated', 'public.redeem_gift_code(text)', 'execute') then raise 'redeem_gift_code fermé'; end if;
  if has_table_privilege('authenticated', 'private.lifetime_access', 'select') or has_table_privilege('service_role', 'private.lifetime_access', 'select')
     then raise 'vue lifetime_access ouverte'; end if;
  if (select prosecdef from pg_proc where oid = 'public.redeem_gift_code(text)'::regprocedure) is not true then raise 'redeem_gift_code invoker'; end if;
end $$;

update public.app_config set value = 'false'::jsonb where key = 'paywall_on';

-- Ménage : les fichiers suivants (payant_test.sql…) comptent sur des tables de codes vierges
delete from public.gift_codes where code in (select code from vcodes) or note like 'attribué : Maxence%';
delete from auth.users where id in (select pg_temp.vu(c) from unnest(array['1', '2', '3', '4', '5', '6', '7']) c);
