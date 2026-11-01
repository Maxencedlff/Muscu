-- Vérifications de 20261030000000_payant_tarifs.sql (tarifs du 30/10, rôle coach vérifié à la main,
-- paliers, code unique du coach, attribution, codes d'offre des élèves), lancées par tests/sql/run.sh.
-- Comptes simulés …0000000008xx : M demande le rôle coach, N est refusé, P est un élève, Q un autre
-- compte, R un particulier abonné. Rien n'est appliqué en production : Postgres local jetable.

create function pg_temp.terr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.tu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000008' || c)::uuid $$;
create function pg_temp.tn(i int) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-000000000' || (900 + i)::text)::uuid $$;
create function pg_temp.tlogin(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, false) $$;
create function pg_temp.tsrv(stmt text) returns text language plpgsql as
$$
declare r text;
begin
  set local role service_role;
  r := pg_temp.terr(stmt);
  set local role authenticated;
  return r;
end
$$;
grant execute on function pg_temp.terr(text), pg_temp.tu(text), pg_temp.tn(int), pg_temp.tlogin(uuid), pg_temp.tsrv(text)
  to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.tu(c) from unnest(array['10', '11', '12', '13', '14']) c;
insert into auth.users (id) select pg_temp.tn(i) from generate_series(1, 31) i;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.tu('10'), 'marc.t1', '🦁'), (pg_temp.tu('11'), 'nina.t1', '🦊'), (pg_temp.tu('12'), 'paul.t1', '🐼'),
  (pg_temp.tu('13'), 'quentin.t1', '⭐'), (pg_temp.tu('14'), 'rose.t1', '🦉');
insert into public.user_profiles (user_id, username, avatar_emoji)
  select pg_temp.tn(i), 'eleve' || i || '.t1', '🐺' from generate_series(1, 31) i;

-- ── Produits : les 10 abonnements, tous « sub » ; paliers ──
do $$ begin
  if (select count(*) from unnest(array['pro', 'coach10', 'coach20', 'coach30', 'coachmax']) t, unnest(array['monthly', 'yearly']) p
       where private.access_product_kind('com.mdlf.training.' || t || '.' || p) = 'sub') <> 10 then raise 'produits reconnus'; end if;
  if private.access_product_kind('com.mdlf.training.access.gift') is not null then raise 'accès offert revenu'; end if;
  if private.coach_product_limit('com.mdlf.training.coach20.yearly') <> 20 or private.coach_product_limit('com.mdlf.training.pro.monthly') is not null
     or private.coach_product_limit('com.mdlf.training.coachmax.monthly') <> 2147483647 then raise 'paliers'; end if;
end $$;

-- ── Demande du rôle coach : envoi, saisie, refus d'un autre compte ──
set role authenticated;
do $$
declare st jsonb;
begin
  perform pg_temp.tlogin(pg_temp.tu('10'));
  if public.coach_request_state() ->> 'status' is distinct from 'none' then raise 'état initial'; end if;
  if pg_temp.terr($q$ select public.coach_request_submit('M', '12345AB', 'BPJEPS') $q$) is distinct from 'invalid_name' then raise 'nom trop court'; end if;
  if pg_temp.terr($q$ select public.coach_request_submit('Marc Dupont', '12-3', 'BPJEPS') $q$) is distinct from 'invalid_card' then raise 'carte trop courte'; end if;
  if pg_temp.terr($q$ select public.coach_request_submit('Marc Dupont', '049 12ED 0123 é', 'BPJEPS') $q$) is distinct from 'invalid_card' then raise 'carte avec accent'; end if;
  if pg_temp.terr($q$ select public.coach_request_submit('Marc Dupont', '04912ED0123', ' ') $q$) is distinct from 'invalid_diploma' then raise 'diplôme vide'; end if;
  st := public.coach_request_submit('  Marc   Dupont ', '049 12-ed.0123', 'BPJEPS AF');
  if st ->> 'status' <> 'pending' or st ->> 'card_number' <> '04912ED0123' or st ->> 'card_name' <> 'Marc Dupont'
     or (st ->> 'is_coach')::boolean then raise 'demande : %', st; end if;
  -- Correction tant qu'elle attend
  st := public.coach_request_submit('Marc Dupont', '04912ED0124', 'BPJEPS AF');
  if st ->> 'card_number' <> '04912ED0124' then raise 'correction'; end if;
  -- Pas coach tant qu'elle n'est pas validée : aucun code, aucune invitation
  if pg_temp.terr($q$ select public.coach_my_code() $q$) is distinct from 'not_coach' then raise 'code avant validation'; end if;
  if pg_temp.terr($q$ select public.coach_create_invite() $q$) is distinct from 'not_coach' then raise 'invitation avant validation'; end if;
  if (public.coach_tier_state() ->> 'is_coach')::boolean or (public.coach_tier_state() ->> 'limit')::int <> 0 then raise 'palier avant validation'; end if;
  -- Un autre compte ne voit pas la demande de M et n'a que la sienne
  perform pg_temp.tlogin(pg_temp.tu('13'));
  if public.coach_request_state() ->> 'status' is distinct from 'none' or public.coach_request_state()::text ~ '0412' then raise 'fuite de la demande'; end if;
  -- Aucune lecture ni écriture directe, aucune validation par le client
  if pg_temp.terr($q$ select * from public.coach_requests $q$) not like 'permission denied%' then raise 'lecture directe des demandes'; end if;
  if pg_temp.terr($q$ update public.coach_requests set status = 'approved' $q$) not like 'permission denied%' then raise 'écriture directe des demandes'; end if;
  if pg_temp.terr(format('select private.approve_coach(%L)', pg_temp.tu('13'))) not like 'permission denied%' then raise 'auto-validation'; end if;
  if pg_temp.terr($q$ select * from private.coach_requests_pending $q$) not like 'permission denied%' then raise 'vue des demandes lisible'; end if;
  -- 5 envois par 24 h
  perform public.coach_request_submit('Quentin Q', 'AAAAAA1', 'CQP');
  perform public.coach_request_submit('Quentin Q', 'AAAAAA2', 'CQP');
  perform public.coach_request_submit('Quentin Q', 'AAAAAA3', 'CQP');
  perform public.coach_request_submit('Quentin Q', 'AAAAAA4', 'CQP');
  perform public.coach_request_submit('Quentin Q', 'AAAAAA5', 'CQP');
  if pg_temp.terr($q$ select public.coach_request_submit('Quentin Q', 'AAAAAA6', 'CQP') $q$) is distinct from 'rate_limited' then raise '6e envoi'; end if;
  -- La clé serveur lit les colonnes de l'alerte, pas le motif ni la note
  if pg_temp.tsrv($q$ select card_number, notified_at from public.coach_requests $q$) is distinct from 'ok' then raise 'alerte : lecture'; end if;
  if pg_temp.tsrv($q$ select admin_note from public.coach_requests $q$) not like 'permission denied%' then raise 'note lisible par la clé serveur'; end if;
  if pg_temp.tsrv($q$ update public.coach_requests set status = 'approved' $q$) not like 'permission denied%' then raise 'statut modifiable par la clé serveur'; end if;
  if pg_temp.tsrv($q$ update public.coach_requests set notified_at = now() where false $q$) is distinct from 'ok' then raise 'alerte : notified_at'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  if pg_temp.terr($q$ select public.coach_request_submit('Anon A', '123456', 'CQP') $q$) not like 'permission denied%' then raise 'anon envoie une demande'; end if;
  if pg_temp.terr($q$ select public.coach_request_state() $q$) not like 'permission denied%' then raise 'anon lit une demande'; end if;
  if pg_temp.terr($q$ select public.student_offer_code() $q$) not like 'permission denied%' then raise 'anon demande un code d''offre'; end if;
  if pg_temp.terr($q$ select public.coach_tier_state() $q$) not like 'permission denied%' then raise 'anon lit un palier'; end if;
end $$;
reset role;

-- ── Validation, refus, retrait (administrateur) ──────────
do $$
declare st jsonb;
begin
  if (select count(*) from private.coach_requests_pending where user_id in (pg_temp.tu('10'), pg_temp.tu('13'))) <> 2 then raise 'demandes en attente'; end if;
  st := private.reject_coach(pg_temp.tu('13'), 'Carte introuvable sur le site du ministère.');
  if st ->> 'status' <> 'rejected' or st ->> 'reason' not like 'Carte introuvable%' then raise 'refus : %', st; end if;
  if (select coach_at from public.user_profiles where user_id = pg_temp.tu('13')) is not null then raise 'refusé devenu coach'; end if;
  if pg_temp.terr(format('select private.reject_coach(%L, %L)', pg_temp.tu('13'), 'x')) is distinct from 'not_found' then raise 'refus d''une demande déjà traitée'; end if;
  st := private.approve_coach(pg_temp.tu('10'), 'carte vérifiée');
  if st ->> 'status' <> 'approved' or not (st ->> 'is_coach')::boolean then raise 'validation : %', st; end if;
  if (select count(*) from public.coach_invites where coach_id = pg_temp.tu('10') and permanent and code ~ '^[A-HJ-NP-Z2-9]{12}$' and expires_at = 'infinity') <> 1 then raise 'code permanent'; end if;
end $$;

set role authenticated;
do $$
declare c text; c2 text; st jsonb;
begin
  perform pg_temp.tlogin(pg_temp.tu('10'));
  c := public.coach_my_code() ->> 'code';
  if c !~ '^[A-HJ-NP-Z2-9]{12}$' or public.coach_my_code() ->> 'code' <> c then raise 'coach_my_code'; end if;
  if pg_temp.terr($q$ select public.coach_request_submit('Marc Dupont', '04912ED0124', 'BPJEPS') $q$) is distinct from 'already_coach' then raise 'redemande d''un coach'; end if;
  -- La rotation des codes de 7 jours ne supprime jamais le code permanent
  for i in 1..7 loop perform public.coach_create_invite(); end loop;
  reset role;
  if (select count(*) from public.coach_invites where coach_id = pg_temp.tu('10') and not permanent) <> 5 then raise 'rotation'; end if;
  set role authenticated;
  if public.coach_my_code() ->> 'code' <> c then raise 'code permanent remplacé par la rotation'; end if;
  reset role;
  -- Codes uniques par coach
  if (select count(*) from public.coach_invites where permanent and coach_id = pg_temp.tu('10')) <> 1 then raise 'un seul code permanent'; end if;
  -- Refusé : il peut refaire sa demande, qui repart en attente
  perform pg_temp.tlogin(pg_temp.tu('13'));
  delete from private.social_rate where user_id = pg_temp.tu('13') and action = 'coach_request';
  set role authenticated;
  st := public.coach_request_submit('Quentin Q', '04912ED0999', 'Licence STAPS');
  if st ->> 'status' <> 'pending' or st -> 'reason' <> 'null'::jsonb then raise 'nouvelle demande après refus : %', st; end if;
end $$;
reset role;

-- ── Paliers : verrou éteint 50 au moins ; verrou allumé = palier payé ──
set role authenticated;
do $$
declare c text; st jsonb;
begin
  perform pg_temp.tlogin(pg_temp.tu('10'));
  c := public.coach_my_code() ->> 'code';
  st := public.coach_tier_state();
  if (st ->> 'limit')::int <> 50 or st ->> 'next_product' <> 'com.mdlf.training.coach10.monthly' then raise 'verrou éteint : %', st; end if;
  -- Verrou allumé, sans abonnement coach : aucun élève ne peut entrer
  reset role;
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  set role authenticated;
  if (public.coach_tier_state() ->> 'limit')::int <> 0 or not (public.coach_tier_state() ->> 'full')::boolean then raise 'coach sans abonnement'; end if;
  perform pg_temp.tlogin(pg_temp.tn(1));
  if pg_temp.terr(format('select public.coach_join(%L)', c)) is distinct from 'tier_full' then raise 'élève accepté sans abonnement coach'; end if;
  -- Coach avec l'essai d'Apple sur le palier 10 : accès complet et 10 élèves
  if pg_temp.tsrv(format('select public.srv_access_purchase(%L, %L, %L, %L, false, now(), true, %L)', pg_temp.tu('10'),
       'com.mdlf.training.coach10.monthly', now() + interval '90 days', 'tx-coach10', 'Sandbox')) is distinct from 'ok' then raise 'achat coach'; end if;
  perform pg_temp.tlogin(pg_temp.tu('10'));
  st := public.my_access();
  if st ->> 'status' <> 'active' or not (st ->> 'intro_offer')::boolean or not (st ->> 'can_write')::boolean then raise 'coach en essai : %', st; end if;
  st := public.coach_tier_state();
  if (st ->> 'limit')::int <> 10 or st ->> 'product_id' <> 'com.mdlf.training.coach10.monthly' or (st ->> 'full')::boolean
     or st ->> 'next_product' <> 'com.mdlf.training.coach20.monthly' then raise 'palier 10 : %', st; end if;
  for i in 1..10 loop
    perform pg_temp.tlogin(pg_temp.tn(i));
    if (public.coach_join(lower(substr(c, 1, 4) || '-' || substr(c, 5, 4) || ' ' || substr(c, 9))) ->> 'username') <> 'marc.t1' then raise 'adhésion %', i; end if;
  end loop;
  -- 11e : refus clair, le coach doit passer au palier supérieur
  perform pg_temp.tlogin(pg_temp.tn(11));
  if pg_temp.terr(format('select public.coach_preview(%L)', c)) is distinct from 'tier_full' then raise 'aperçu du 11e'; end if;
  if pg_temp.terr(format('select public.coach_join(%L)', c)) is distinct from 'tier_full' then raise '11e élève accepté'; end if;
  perform pg_temp.tlogin(pg_temp.tu('10'));
  st := public.coach_tier_state();
  if not (st ->> 'full')::boolean or (st ->> 'students')::int <> 10 then raise 'palier plein : %', st; end if;
  -- Montée au palier 20 (même groupe Apple : une nouvelle transaction de la même souscription)
  if pg_temp.tsrv(format('select public.srv_access_event(%L, %L, %L, false, now() + interval ''1 second'')', 'tx-coach10',
       'com.mdlf.training.coach20.monthly', now() + interval '30 days')) is distinct from 'ok' then raise 'montée de palier'; end if;
  if (public.coach_tier_state() ->> 'limit')::int <> 20 then raise 'palier 20 : %', public.coach_tier_state(); end if;
  perform pg_temp.tlogin(pg_temp.tn(11));
  perform public.coach_join(c);
  -- Descente au palier 10 : les 11 restent, aucun 12e
  if pg_temp.tsrv(format('select public.srv_access_event(%L, %L, %L, false, now() + interval ''2 seconds'')', 'tx-coach10',
       'com.mdlf.training.coach10.monthly', now() + interval '30 days')) is distinct from 'ok' then raise 'descente de palier'; end if;
  perform pg_temp.tlogin(pg_temp.tn(12));
  if pg_temp.terr(format('select public.coach_join(%L)', c)) is distinct from 'tier_full' then raise '12e après la descente'; end if;
  reset role;
  if (select count(*) from public.coach_links where coach_id = pg_temp.tu('10')) <> 11 then raise 'élèves gardés après la descente'; end if;
  -- Illimité (coachmax) : au-delà de 30 et de l'ancienne limite de 50
  set role authenticated;
  if pg_temp.tsrv(format('select public.srv_access_event(%L, %L, %L, false, now() + interval ''3 seconds'')', 'tx-coach10',
       'com.mdlf.training.coachmax.yearly', now() + interval '365 days')) is distinct from 'ok' then raise 'palier illimité'; end if;
  for i in 12..31 loop
    perform pg_temp.tlogin(pg_temp.tn(i));
    perform public.coach_join(c);
  end loop;
  perform pg_temp.tlogin(pg_temp.tu('10'));
  st := public.coach_tier_state();
  if st -> 'limit' <> 'null'::jsonb or (st ->> 'students')::int <> 31 or (st ->> 'full')::boolean or st -> 'next_product' <> 'null'::jsonb then raise 'illimité : %', st; end if;
end $$;
reset role;

-- ── Élève : plus de gratuité, attribution gardée, code d'offre ──
insert into public.coach_offer_codes (code, environment, expires_at, batch) values
  ('PRODCODE0001', 'Production', now() + interval '90 days', 'test'),
  ('PRODCODE0002', 'Production', now() + interval '90 days', 'test'),
  ('SANDCODE0001', 'Sandbox',    now() + interval '90 days', 'test'),
  ('OLDCODE00001', 'Production', now() + interval '2 days',  'test');
set role authenticated;
do $$
declare st jsonb; r jsonb;
begin
  -- Élève lié par le code du coach : pas d'accès gratuit, verrou allumé
  perform pg_temp.tlogin(pg_temp.tn(1));
  st := public.my_access();
  if st ->> 'status' <> 'none' or (st ->> 'can_write')::boolean or (st ->> 'coach_team')::boolean then raise 'élève gratuit : %', st; end if;
  -- Son code d'offre −25 % : le même à chaque appel, jamais un code proche de l'expiration
  r := public.student_offer_code();
  if not (r ->> 'ok')::boolean or r ->> 'code' <> 'PRODCODE0001' or r -> 'coach' ->> 'username' <> 'marc.t1' then raise 'code élève : %', r; end if;
  if public.student_offer_code() ->> 'code' <> 'PRODCODE0001' then raise 'code élève non idempotent'; end if;
  if public.student_offer_code('Sandbox') ->> 'code' <> 'SANDCODE0001' then raise 'code Sandbox'; end if;
  perform pg_temp.tlogin(pg_temp.tn(2));
  if public.student_offer_code() ->> 'code' <> 'PRODCODE0002' then raise 'deuxième élève'; end if;
  perform pg_temp.tlogin(pg_temp.tn(3));
  if public.student_offer_code() ->> 'error' <> 'no_code' then raise 'stock vide : %', public.student_offer_code(); end if;
  -- Un compte qui n'est l'élève de personne : refusé
  perform pg_temp.tlogin(pg_temp.tu('13'));
  if public.student_offer_code() ->> 'error' <> 'not_student' then raise 'non élève'; end if;
  -- Un élève déjà abonné : pas un nouveau client
  if pg_temp.tsrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.tn(4),
       'com.mdlf.training.pro.monthly', now() + interval '30 days', 'tx-eleve4')) is distinct from 'ok' then raise 'abonnement élève'; end if;
  perform pg_temp.tlogin(pg_temp.tn(4));
  if public.student_offer_code() ->> 'error' <> 'not_new' then raise 'déjà abonné'; end if;
  if public.my_access() ->> 'status' <> 'active' then raise 'élève abonné : %', public.my_access(); end if;
  -- Personne ne lit le stock ni les attributions
  if pg_temp.terr($q$ select * from public.coach_offer_codes $q$) not like 'permission denied%' then raise 'stock lisible'; end if;
  if pg_temp.terr($q$ select * from public.referral_attributions $q$) not like 'permission denied%' then raise 'attributions lisibles'; end if;
end $$;
reset role;

-- ── Attribution (une seule source : referral_attributions du parrainage) : gardée quand l'élève part,
--    pas changée par un autre coach ──
do $$
declare c2 text;
begin
  if to_regclass('public.coach_origins') is not null then raise 'seconde table d''attribution'; end if;
  if (select referrer_coach from public.referral_attributions where user_id = pg_temp.tn(1) and kind = 'coach' and source = 'coach')
     is distinct from pg_temp.tu('10') then raise 'attribution'; end if;
  delete from public.coach_links where student_id = pg_temp.tn(1);
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';   -- N n'a pas d'abonnement coach
  -- Un second coach (N, validé à la main) : l'élève le rejoint, l'attribution reste à M
  insert into public.coach_requests (user_id, card_name, card_number, diploma) values (pg_temp.tu('11'), 'Nina N', 'ZZZZZZ9', 'DEJEPS');
  perform private.approve_coach(pg_temp.tu('11'));
  c2 := (select code from public.coach_invites where coach_id = pg_temp.tu('11') and permanent);
  set role authenticated;
  perform pg_temp.tlogin(pg_temp.tn(1));
  perform public.coach_join(c2);
  reset role;
  if (select referrer_coach from public.referral_attributions where user_id = pg_temp.tn(1)) is distinct from pg_temp.tu('10') then raise 'attribution changée'; end if;
  -- Compte de l'élève supprimé : la ligne reste, anonyme
  delete from auth.users where id = pg_temp.tn(31);
  if not exists (select 1 from public.referral_attributions where user_id is null and referrer_coach = pg_temp.tu('10')) then raise 'attribution anonymisée'; end if;
end $$;

-- ── Retrait du rôle : élèves gardés, ajout bloqué ────────
do $$
declare c text := (select code from public.coach_invites where coach_id = pg_temp.tu('10') and permanent);
begin
  perform private.revoke_coach(pg_temp.tu('10'), 'Carte expirée.');
  if (select status from public.coach_requests where user_id = pg_temp.tu('10')) <> 'revoked' then raise 'statut retiré'; end if;
  if (select count(*) from public.coach_links where coach_id = pg_temp.tu('10')) <> 29 then raise 'élèves gardés : %', (select count(*) from public.coach_links where coach_id = pg_temp.tu('10')); end if;
  set role authenticated;
  perform pg_temp.tlogin(pg_temp.tn(30));
  perform public.coach_leave();
  if pg_temp.terr(format('select public.coach_join(%L)', c)) is distinct from 'invalid_code' then raise 'ajout après retrait'; end if;
  -- Sans rôle, plus de code d'offre pour ses élèves
  perform pg_temp.tlogin(pg_temp.tn(5));
  if public.student_offer_code() ->> 'error' <> 'not_student' then raise 'code d''offre d''un coach retiré'; end if;
  -- L'abonnement coach acheté reste un accès complet
  perform pg_temp.tlogin(pg_temp.tu('10'));
  if public.my_access() ->> 'status' <> 'active' then raise 'accès du coach retiré'; end if;
  if pg_temp.terr($q$ select public.coach_my_code() $q$) is distinct from 'not_coach' then raise 'code d''un coach retiré'; end if;
  reset role;
  -- Validé de nouveau : tout revient, même code
  perform private.approve_coach(pg_temp.tu('10'));
  if (select code from public.coach_invites where coach_id = pg_temp.tu('10') and permanent) <> c then raise 'code changé'; end if;
end $$;

-- ── Abonnement coach d'un compte non validé : accès complet, pas de rôle ──
set role authenticated;
do $$ begin
  if pg_temp.tsrv(format('select public.srv_access_purchase(%L, %L, %L, %L)', pg_temp.tu('14'),
       'com.mdlf.training.coach30.monthly', now() + interval '30 days', 'tx-rose')) is distinct from 'ok' then raise 'achat coach par un particulier'; end if;
  perform pg_temp.tlogin(pg_temp.tu('14'));
  if public.my_access() ->> 'status' <> 'active' then raise 'accès'; end if;
  if (public.coach_tier_state() ->> 'is_coach')::boolean or (public.coach_tier_state() ->> 'limit')::int <> 0 then raise 'rôle donné par l''achat'; end if;
  if pg_temp.terr($q$ select public.coach_create_invite() $q$) is distinct from 'not_coach' then raise 'invitation sans rôle'; end if;
end $$;
reset role;

-- ── Droits ───────────────────────────────────────────────
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'private'::regnamespace
             and p.proname in ('coach_product_limit', 'coach_request_json', 'coach_new_code12', 'coach_ensure_code', 'approve_coach',
                               'reject_coach', 'revoke_coach', 'coach_paid_limit', 'coach_student_limit') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute') then raise '% : exécutable par l''API', f; end if;
  end loop;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('coach_request_state', 'coach_request_submit', 'coach_my_code', 'coach_tier_state', 'student_offer_code') loop
    if not has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then raise '% : droits', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.coach_offer_codes', 'select') or has_table_privilege('anon', 'public.referral_attributions', 'select')
     or has_table_privilege('service_role', 'public.coach_offer_codes', 'select') then raise 'tables lisibles'; end if;
  -- Anciens élèves gratuits notés, plus de fonction de gratuité
  if exists (select 1 from pg_proc where proname in ('access_coach_free', 'access_own_paid')) then raise 'gratuité élève restée'; end if;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
end $$;
