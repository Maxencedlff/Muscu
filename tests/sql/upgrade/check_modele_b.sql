-- Vérifications après 20261029000000_payant_modele_b.sql et 20261030000000_payant_tarifs.sql appliquées sur les données de production
-- (tests/sql/upgrade/seed_20261028.sql). Chaque bloc échoue (raise) si la règle n'est pas tenue.
do $$
declare st jsonb;
begin
  -- Plus d'essai maison, plus de statut trial, contrainte en place
  if exists (select 1 from public.entitlements where status = 'trial') then raise 'ligne trial restée'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'entitlements' and column_name = 'trial_started_at') then raise 'trial_started_at resté'; end if;
  if (select array_agg(key order by key) from public.app_config) is distinct from array['min_build', 'paywall_on'] then raise 'app_config : %', (select array_agg(key) from public.app_config); end if;
  if pg_temp.perr($q$ update public.entitlements set status = 'trial' where user_id = '00000000-0000-0000-0000-000000000901' $q$) not like '%entitlements_status_check%' then raise 'contrainte de statut absente'; end if;
  -- 901 (ancien essai) : aucun droit, verrou allumé
  update public.app_config set value = 'true'::jsonb where key = 'paywall_on';
  st := private.access_json('00000000-0000-0000-0000-000000000901');
  if st ->> 'status' is distinct from 'none' or (st ->> 'can_write')::boolean then raise '901 : %', st; end if;
  -- 902 (ancien « Accès offert ») : l'accès à vie a disparu, instantané recalculé
  if exists (select 1 from public.entitlement_claims where kind = 'gift' or original_transaction_id = 'G-902') then raise 'claim cadeau restée'; end if;
  if (select gift from public.entitlements where user_id = '00000000-0000-0000-0000-000000000902') then raise '902 garde un accès à vie'; end if;
  st := private.access_json('00000000-0000-0000-0000-000000000902');
  if st ->> 'status' = 'gift' or (st ->> 'can_write')::boolean then raise '902 : %', st; end if;
  if (select status from public.entitlements where user_id = '00000000-0000-0000-0000-000000000902') = 'gift' then raise 'instantané de 902'; end if;
  -- 903 (abonné) : intact
  if private.access_json('00000000-0000-0000-0000-000000000903') ->> 'status' is distinct from 'active' then raise '903 abonné perdu'; end if;
  -- 905 (élève d'un coach qui a le rôle) : plus gratuit depuis 20261030 (tarifs), noté pour pouvoir
  -- revenir en arrière, attribution à son coach gardée, et son coach a reçu son code permanent
  if private.access_json('00000000-0000-0000-0000-000000000905') ->> 'status' is distinct from 'none' then raise '905 encore gratuit'; end if;
  if not exists (select 1 from private.tarifs_ex_coach_team where user_id = '00000000-0000-0000-0000-000000000905') then raise '905 non noté'; end if;
  if (select status from public.entitlements where user_id = '00000000-0000-0000-0000-000000000905') = 'coach_team' then raise 'instantané de 905'; end if;
  -- Lien d'avant le parrainage : aucune attribution rétroactive (décision du 31/10, docs/PARRAINAGE.md)
  if not exists (select 1 from public.coach_links l where l.student_id = '00000000-0000-0000-0000-000000000905') then raise 'lien de 905'; end if;
  if not exists (select 1 from public.coach_invites i join public.coach_links l on l.coach_id = i.coach_id
                  where l.student_id = '00000000-0000-0000-0000-000000000905' and i.permanent) then raise 'code permanent du coach'; end if;
  -- 906 (code cadeau maison à vie) : intact
  if private.access_json('00000000-0000-0000-0000-000000000906') ->> 'status' is distinct from 'gift' then raise '906 code maison perdu'; end if;
  -- Les séances sont toutes là
  if (select count(*) from public.sessions where user_id in ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000905')) <> 3 then raise 'séances perdues'; end if;
  update public.app_config set value = 'false'::jsonb where key = 'paywall_on';
end $$;
