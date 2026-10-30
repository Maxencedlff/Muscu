-- Vérifications de supabase/migrations/20261031400000_parrainage.sql (lancées par tests/sql/run.sh).
-- Chaque bloc échoue (raise) si la règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.ru('a') → …00000000070a) : A nouveau compte, B nouveau compte, C compte de
-- 40 jours (délai passé), D nouveau compte qui essaie des codes au hasard, E compte du partenaire PAUL (et
-- coach), F et 7 nouveaux comptes élèves, 9 coach sans contrat partenaire (kevin.p1).
-- pg_temp.rlogin change d'utilisateur (auth.uid()) sans changer de rôle, comme un autre jeton.

create function pg_temp.rerr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.ru(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000070' || c)::uuid $$;
create function pg_temp.rlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', case when c is null then '' else pg_temp.ru(c)::text end, false) $$;
grant execute on function pg_temp.rerr(text), pg_temp.ru(text), pg_temp.rlogin(text) to authenticated, anon, service_role;

insert into auth.users (id, created_at) values
  (pg_temp.ru('a'), now() - interval '1 day'), (pg_temp.ru('b'), now()), (pg_temp.ru('c'), now() - interval '40 days'),
  (pg_temp.ru('d'), now()), (pg_temp.ru('e'), now()), (pg_temp.ru('f'), now());

-- ── Codes : administrateur seulement ─────────────────────
do $$
begin
  if private.make_partner_code(' lu-cas ', 'Lucas', 0.25, 12, 'contrat signé') is distinct from 'LUCAS' then raise 'code normalisé'; end if;
  perform private.make_partner_code('PAUL', 'Paul', 0.20, 12, null, pg_temp.ru('e'));
  perform private.make_partner_code('VIEUX', 'Ancien');
  update public.referral_partners set active = false where code = 'VIEUX';
  if pg_temp.rerr($q$ select private.make_partner_code('X', 'trop court') $q$) not like 'invalid_code%' then raise 'code trop court accepté'; end if;
  if pg_temp.rerr($q$ select private.make_partner_code('ABC', 'taux', 0.9) $q$) not like '%check%' then raise 'taux de 90 %% accepté'; end if;
  -- Mise à jour d'un code existant : nom et taux changent, notes gardées si absentes
  perform private.make_partner_code('LUCAS', 'Lucas B.', 0.25, 12);
  if (select notes from public.referral_partners where code = 'LUCAS') is distinct from 'contrat signé' then raise 'notes perdues'; end if;
  perform private.make_partner_code('LUCAS', 'Lucas', 0.25, 12);
end $$;

set role authenticated;
do $$
begin
  perform pg_temp.rlogin('a');
  if pg_temp.rerr($q$ select private.make_partner_code('MOI', 'Moi') $q$) not like 'permission denied%' then raise 'make_partner_code depuis l''app'; end if;
  if pg_temp.rerr($q$ select * from public.referral_partners $q$) not like 'permission denied%' then raise 'liste des codes lisible'; end if;
  if pg_temp.rerr($q$ select * from public.referral_attributions $q$) not like 'permission denied%' then raise 'attributions lisibles'; end if;
  if pg_temp.rerr($q$ insert into public.referral_attributions (user_id, partner_code) values (auth.uid(), 'LUCAS') $q$) not like 'permission denied%' then raise 'attribution écrite en direct'; end if;
  if pg_temp.rerr($q$ select * from public.referral_report() $q$) not like 'permission denied%' then raise 'rapport ouvert à authenticated'; end if;
  if pg_temp.rerr($q$ select public.referral_for_user(auth.uid()) $q$) not like 'permission denied%' then raise 'referral_for_user ouvert à authenticated'; end if;
end $$;

-- ── Saisie ───────────────────────────────────────────────
do $$
declare r jsonb;
begin
  perform pg_temp.rlogin('a');
  r := public.referral_state();
  if r -> 'referrer' <> 'null'::jsonb or (r ->> 'can_enter')::boolean is not true then raise 'état initial : %', r; end if;
  -- Code inconnu : réponse, pas une erreur (l'essai reste compté)
  r := public.referral_apply('NIMPORTE');
  if r is distinct from '{"ok": false, "error": "invalid_code"}'::jsonb then raise 'code inconnu : %', r; end if;
  if public.referral_apply('VIEUX') ->> 'error' is distinct from 'invalid_code' then raise 'code inactif accepté'; end if;
  if public.referral_apply(null) ->> 'error' is distinct from 'invalid_code' then raise 'code vide'; end if;
  -- Saisie normalisée (minuscules, espaces)
  r := public.referral_apply(' lucas ');
  if (r ->> 'ok')::boolean is not true or r #>> '{referrer,name}' is distinct from 'Lucas' then raise 'saisie : %', r; end if;
  -- Même code une 2e fois (nouvel essai après coupure) : même réponse
  if (public.referral_apply('LUCAS') ->> 'ok')::boolean is not true then raise 'même code refusé'; end if;
  -- Un autre parrain ensuite : refusé, le premier reste
  if pg_temp.rerr($q$ select public.referral_apply('PAUL') $q$) is distinct from 'already_referred' then raise 'parrain changé'; end if;
  r := public.referral_state();
  if r #>> '{referrer,name}' is distinct from 'Lucas' or (r ->> 'can_enter')::boolean then raise 'état après saisie : %', r; end if;
  -- Ce que voit l'utilisateur : nom et date seulement (ni code, ni taux, ni notes)
  if (select array_agg(k order by k) from jsonb_object_keys(r -> 'referrer') k) is distinct from array['name', 'since'] then raise 'champs du parrain : %', r; end if;

  -- Délai de 30 jours passé
  perform pg_temp.rlogin('c');
  if (public.referral_state() ->> 'can_enter')::boolean then raise 'can_enter après 30 jours'; end if;
  if pg_temp.rerr($q$ select public.referral_apply('LUCAS') $q$) is distinct from 'too_late' then raise 'saisie après 30 jours'; end if;

  -- Son propre code : invalide
  perform pg_temp.rlogin('e');
  if public.referral_apply('PAUL') ->> 'error' is distinct from 'invalid_code' then raise 'propre code accepté'; end if;

  -- Force brute : 10 essais par 24 h, échecs compris
  perform pg_temp.rlogin('d');
  for i in 1..10 loop
    if public.referral_apply('ESSAI' || i) ->> 'error' is distinct from 'invalid_code' then raise 'essai %', i; end if;
  end loop;
  if pg_temp.rerr($q$ select public.referral_apply('LUCAS') $q$) is distinct from 'rate_limited' then raise 'force brute non limitée'; end if;

  -- B ne voit pas le parrain de A
  perform pg_temp.rlogin('b');
  if public.referral_state() -> 'referrer' <> 'null'::jsonb then raise 'parrain d''un autre compte visible'; end if;
  perform public.referral_apply('PAUL');
end $$;
reset role;

-- ── anon : rien ──────────────────────────────────────────
set role anon;
do $$
begin
  perform pg_temp.rlogin(null);
  if pg_temp.rerr($q$ select public.referral_state() $q$) not like 'permission denied%' then raise 'referral_state ouvert à anon'; end if;
  if pg_temp.rerr($q$ select public.referral_apply('LUCAS') $q$) not like 'permission denied%' then raise 'referral_apply ouvert à anon'; end if;
  if pg_temp.rerr($q$ select * from public.referral_report() $q$) not like 'permission denied%' then raise 'rapport ouvert à anon'; end if;
  if pg_temp.rerr($q$ select * from public.referral_partners $q$) not like 'permission denied%' then raise 'codes lisibles par anon'; end if;
end $$;
reset role;

-- ── Rapport (service_role) ───────────────────────────────
set role service_role;
do $$
declare r record; n int;
begin
  select * into r from public.referral_report(date_trunc('month', now())::date, date_trunc('month', now())::date) where code = 'LUCAS';
  if r.new_accounts <> 1 or r.total_accounts <> 1 or r.commission_rate <> 0.25 or r.active_subscribers is not null then raise 'rapport LUCAS : %', r; end if;
  select count(*) into n from public.referral_report();
  if n <> 3 then raise 'rapport des 12 derniers mois : % lignes (codes créés ce mois-ci seulement)', n; end if;
  if public.referral_for_user(pg_temp.ru('a')) ->> 'code' is distinct from 'LUCAS' then raise 'referral_for_user'; end if;
  if public.referral_for_user(pg_temp.ru('d')) is not null then raise 'referral_for_user sans parrain'; end if;
  if pg_temp.rerr($q$ select * from public.referral_partners $q$) not like 'permission denied%' then raise 'service_role lit les tables en direct'; end if;
end $$;
reset role;

-- ── Droits des fonctions, RLS ────────────────────────────
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'referral\_%' loop
    if has_function_privilege('anon', f, 'execute') then raise '% : anon a le droit', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'referral\_%') <> 4 then raise 'fonctions du contrat'; end if;
  if not has_function_privilege('authenticated', 'public.referral_apply(text)', 'execute') then raise 'apply sans droit'; end if;
  if has_function_privilege('service_role', 'public.referral_apply(text)', 'execute') then raise 'apply pour service_role'; end if;
  if has_function_privilege('authenticated', 'public.referral_report(date, date)', 'execute') then raise 'rapport pour authenticated'; end if;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'private'::regnamespace
             and (p.proname like 'referral\_%' or p.proname in ('make_partner_code', 'set_coach_terms')) loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute') then raise '% : exécutable par l''API', f; end if;
  end loop;
  if exists (select 1 from pg_policies where tablename like 'referral\_%') then raise 'politique RLS inattendue'; end if;
  if exists (select 1 from pg_class where relname in ('referral_partners', 'referral_attributions', 'referral_coach_terms', 'referral_payouts') and not relrowsecurity) then raise 'RLS désactivée'; end if;
end $$;

-- ── Coachs : tout élève qui rejoint un coach lui est attribué, une seule fois ─
insert into auth.users (id, created_at) values (pg_temp.ru('7'), now()), (pg_temp.ru('9'), now());
insert into public.user_profiles (user_id, username, avatar_emoji) values (pg_temp.ru('9'), 'kevin.p1', '🦁');
do $$
declare e uuid := pg_temp.ru('e'); k uuid := pg_temp.ru('9'); r jsonb; n int;
begin
  -- E est le compte du partenaire PAUL : F, nouveau, rejoint E comme coach → attribué au code PAUL
  insert into public.coach_links (student_id, coach_id) values (pg_temp.ru('f'), e);
  if (select partner_code from public.referral_attributions where user_id = pg_temp.ru('f')) is distinct from 'PAUL' then raise 'élève du coach partenaire non attribué'; end if;
  -- A (déjà parrainé par LUCAS) rejoint E : rien ne change, pas de double attribution
  insert into public.coach_links (student_id, coach_id) values (pg_temp.ru('a'), e);
  if (select array_agg(partner_code) from public.referral_attributions where user_id = pg_temp.ru('a')) is distinct from array['LUCAS'] then raise 'double attribution'; end if;
  -- K, coach sans contrat partenaire : G le rejoint → attribué au coach ; C (40 jours) aussi (pas de délai pour l'adhésion)
  insert into public.coach_links (student_id, coach_id) values (pg_temp.ru('7'), k), (pg_temp.ru('c'), k);
  if (select count(*) from public.referral_attributions where referrer_coach = k and kind = 'coach' and source = 'coach') <> 2 then raise 'élèves du coach non attribués'; end if;
  -- Nom montré à l'élève : le pseudo du coach
  perform set_config('request.jwt.claim.sub', pg_temp.ru('7')::text, true);
  if public.referral_state() #>> '{referrer,name}' is distinct from 'kevin.p1' then raise 'parrain coach : %', public.referral_state(); end if;
  -- F saisit ensuite le code PAUL : ok (même parrain) ; LUCAS : already_referred ; G (coach) saisit LUCAS : refusé
  perform set_config('request.jwt.claim.sub', pg_temp.ru('f')::text, true);
  if (public.referral_apply('paul') ->> 'ok')::boolean is not true then raise 'même parrain que le coach refusé'; end if;
  if pg_temp.rerr($q$ select public.referral_apply('LUCAS') $q$) is distinct from 'already_referred' then raise 'second parrain après le coach'; end if;
  perform set_config('request.jwt.claim.sub', pg_temp.ru('7')::text, true);
  if pg_temp.rerr($q$ select public.referral_apply('LUCAS') $q$) is distinct from 'already_referred' then raise 'élève du coach re-parrainé'; end if;
  -- Quitter le coach ne retire pas l'attribution ; le rejoindre de nouveau n'en ajoute pas
  delete from public.coach_links where student_id = pg_temp.ru('7');
  insert into public.coach_links (student_id, coach_id) values (pg_temp.ru('7'), k);
  if (select count(*) from public.referral_attributions where user_id = pg_temp.ru('7')) <> 1 then raise 'attribution perdue ou doublée'; end if;
  -- Rapport : une ligne pour le coach, règle commune (20 %, 12 mois), puis exception posée par l'administrateur
  set local role service_role;
  select count(*) into n from public.referral_report() where kind = 'coach' and coach_id = k
    and month = date_trunc('month', now())::date and new_accounts = 2 and commission_rate = 0.20 and commission_months = 12
    and display_name = 'kevin.p1' and net_cents is null and commission_cents is null and balance_cents is null and payable is null;
  if n <> 1 then raise 'rapport coach : règle commune 20 %% / 12 mois, argent inconnu sans le payant'; end if;
  if public.referral_for_user(pg_temp.ru('7')) ->> 'kind' is distinct from 'coach' or (public.referral_for_user(pg_temp.ru('7')) ->> 'rate')::numeric <> 0.20 then raise 'referral_for_user coach'; end if;
  reset role;
  perform private.set_coach_terms(k, 0.15, 12);
  set local role service_role;
  if (select commission_rate from public.referral_report() where coach_id = k and month = date_trunc('month', now())::date) <> 0.15 then raise 'taux du coach'; end if;
  if (select count(*) from public.referral_report() where kind = 'partner' and code = 'PAUL' and month = date_trunc('month', now())::date and new_accounts = 2) <> 1 then raise 'rapport PAUL (B et F)'; end if;
  reset role;
  -- Le coach ne s'attribue pas lui-même
  if private.referral_attribute_coach(k, k) then raise 'coach attribué à lui-même'; end if;
  delete from public.coach_links where coach_id in (e, k);
end $$;
set role authenticated;
do $$ begin
  perform pg_temp.rlogin('7');
  if pg_temp.rerr($q$ select private.set_coach_terms(auth.uid(), 0.5) $q$) not like 'permission denied%' then raise 'set_coach_terms depuis l''app'; end if;
  if pg_temp.rerr($q$ select * from public.referral_coach_terms $q$) not like 'permission denied%' then raise 'conditions des coachs lisibles'; end if;
end $$;
reset role;

-- ── Argent : commission, coach sans abonnement coach, report sous 20 €, virements ─
-- Accroches du payant remplacées le temps du test (transaction annulée ensuite) : 100 € net par mois
-- pour le coach kevin.p1 (taux 15 % posé plus haut), abonnement coach inactif le mois dernier.
begin;
create or replace function private.referral_net_cents(kind text, code text, coach uuid, month date, months int) returns bigint
  language sql stable security definer set search_path = '' as
$$ select case when coach = '00000000-0000-0000-0000-000000000709' then 10000::bigint end $$;
create or replace function private.referral_coach_active(coach uuid, month date) returns boolean
  language sql stable security definer set search_path = '' as
$$ select month <> (date_trunc('month', now()) - interval '1 month')::date $$;
update public.referral_attributions set created_at = now() - interval '2 months' where user_id = pg_temp.ru('7');
do $$
declare k uuid := pg_temp.ru('9'); m0 date := date_trunc('month', now())::date; r record; got text := '';
begin
  for r in select * from public.referral_report((m0 - interval '2 months')::date, m0) where coach_id = k order by month loop
    got := got || format('%s/%s/%s/%s ', r.commission_cents, r.coach_active, r.balance_cents, r.payable);
  end loop;
  -- Il y a 2 mois : 15 € (sous le seuil, reporté) ; le mois dernier : coach inactif, 0 ; ce mois : 30 € cumulés, à verser
  if got is distinct from '1500/t/1500/f 0/f/1500/f 1500/t/3000/t ' then raise 'commissions : %', got; end if;
  insert into public.referral_payouts (kind, coach_id, amount_cents, reference) values ('coach', k, 3000, 'Facture 2026-001');
  select * into r from public.referral_report(m0, m0) where coach_id = k;
  if r.paid_cents <> 3000 or r.balance_cents <> 0 or r.payable then raise 'après virement : %', r; end if;
  -- Partenaire sans revenu connu : argent nul (pas de faux zéro)
  select * into r from public.referral_report(m0, m0) where code = 'LUCAS';
  if r.commission_cents is not null or r.balance_cents is not null then raise 'partenaire sans revenu : %', r; end if;
end $$;
rollback;

-- ── Suppression du compte : lien effacé, ligne anonyme gardée ─
do $$
begin
  delete from auth.users where id = pg_temp.ru('a');
  if exists (select 1 from public.referral_attributions where user_id = pg_temp.ru('a')) then raise 'lien au compte supprimé gardé'; end if;
  if (select count(*) from public.referral_attributions where partner_code = 'LUCAS' and user_id is null) <> 1 then raise 'ligne anonyme absente'; end if;
  if pg_temp.rerr($q$ delete from public.referral_partners where code = 'LUCAS' $q$) not like '%foreign key%' then raise 'code supprimé malgré ses attributions'; end if;
end $$;

-- Nettoyage
delete from auth.users where id in (select pg_temp.ru(c) from unnest(array['b', 'c', 'd', 'e', 'f', '7', '9']) c);
delete from public.referral_attributions;
delete from public.referral_partners;
delete from public.referral_coach_terms;
