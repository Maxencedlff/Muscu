-- Données réalistes de PRODUCTION après 20261028000000_payant.sql (verrou éteint), avant le modèle B.
-- Lancé par tests/sql/upgrade_test.sh. Comptes …0000000009xx.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000901'), ('00000000-0000-0000-0000-000000000902'),
  ('00000000-0000-0000-0000-000000000903'), ('00000000-0000-0000-0000-000000000904'),
  ('00000000-0000-0000-0000-000000000905'), ('00000000-0000-0000-0000-000000000906');
insert into public.user_profiles (user_id, username, avatar_emoji) values
  ('00000000-0000-0000-0000-000000000904', 'coach.up', '🦁'), ('00000000-0000-0000-0000-000000000905', 'eleve.up', '🦊');
update public.user_profiles set coach_at = now() where user_id = '00000000-0000-0000-0000-000000000904';
insert into public.coach_links (student_id, coach_id) values
  ('00000000-0000-0000-0000-000000000905', '00000000-0000-0000-0000-000000000904');

-- 901 : a ouvert l'app, essai maison démarré (ligne « trial »), deux séances
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000901', false);
select public.my_access() ->> 'status' as statut_901;
insert into public.sessions (id, data) values ('s1', '{"date": 1780000000000, "duration": 3600000, "exercises": []}'),
                                              ('s2', '{"date": 1780090000000, "duration": 3000000, "exercises": []}');
-- 905 : élève du coach 904, une séance
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000905', false);
select public.my_access() ->> 'status' as statut_905;
insert into public.sessions (id, data) values ('e1', '{"date": 1780000000000, "duration": 1800000, "exercises": []}');
reset role;

-- 902 : « Accès offert » d'Apple (non consommable) ; 903 : abonné mensuel
select public.srv_access_purchase('00000000-0000-0000-0000-000000000902', 'com.mdlf.training.access.gift', null, 'G-902') ->> 'status' as statut_902;
select public.srv_access_purchase('00000000-0000-0000-0000-000000000903', 'com.mdlf.training.pro.monthly', now() + interval '20 days', 'S-903') ->> 'status' as statut_903;
-- 906 : code cadeau maison à vie
select private.make_gift_code('lifetime', null, 1, 'montée de version') as code \gset
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000906', false);
select public.redeem_gift_code(:'code') ->> 'ok' as code_906;
reset role;

do $$ begin
  if (select count(*) from public.entitlements where status = 'trial') < 1 then raise 'jeu de départ : aucune ligne trial'; end if;
  if not (select gift from public.entitlements where user_id = '00000000-0000-0000-0000-000000000902') then raise 'jeu de départ : 902 sans accès offert'; end if;
end $$;
