-- Vérifications de 20261129010000_erreurs_prod.sql (remontée des erreurs, docs/ERREURS_PROD.md), lancées par
-- tests/sql/run.sh. Rien n'est appliqué en production : Postgres local jetable.

create function pg_temp.eerr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.eerr(text) to authenticated, anon, service_role;

-- ── Droits : ni anon ni un compte connecté ne lisent ou n'écrivent ──
do $$
begin
  if has_table_privilege('anon', 'public.error_reports', 'select') or has_table_privilege('anon', 'public.error_reports', 'insert') then raise 'anon a un droit'; end if;
  if has_table_privilege('authenticated', 'public.error_reports', 'select') or has_table_privilege('authenticated', 'public.error_reports', 'insert') then raise 'authenticated a un droit'; end if;
  if has_table_privilege('service_role', 'public.error_reports', 'update') or has_table_privilege('service_role', 'public.error_reports', 'delete') then raise 'service_role modifie ou efface'; end if;
  if not has_table_privilege('service_role', 'public.error_reports', 'insert') then raise 'service_role ne peut pas insérer'; end if;
  if has_function_privilege('service_role', 'private.error_report_before_insert()', 'execute') then raise 'déclencheur appelable'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.error_reports'::regclass) then raise 'RLS coupée'; end if;
end $$;
set role anon;
do $$ begin
  if pg_temp.eerr($q$ insert into public.error_reports (kind, name, message, frames, build, platform) values ('error', 'Error', 'x', '[]', 'b', 'ios') $q$) not like 'permission denied%' then raise 'anon insère'; end if;
end $$;
reset role;

-- ── Insertion par la clé serveur, empreinte calculée par la base, regroupement ──
set role service_role;
insert into public.error_reports (kind, name, message, frames, build, platform, hits, fingerprint, first_at)
  values ('error', 'TypeError', 'Cannot read properties of undefined (reading ''<s>'')', '[{"f":"render","file":"js/features/session.js","l":12,"c":3}]', '2026.11.29-abc1234', 'ios', 999, 'pirate', '2000-01-01');
insert into public.error_reports (kind, name, message, frames, build, platform)
  values ('error', 'TypeError', 'Cannot read properties of undefined (reading ''<s>'')', '[{"f":"render","file":"js/features/session.js","l":12,"c":3}]', '2026.11.29-abc1234', 'ios');
reset role;
do $$
declare r record;
begin
  if (select count(*) from public.error_reports) <> 1 then raise 'même erreur : une seule ligne attendue'; end if;
  select * into r from public.error_reports;
  if r.hits <> 2 then raise 'compteur : % au lieu de 2', r.hits; end if;
  if r.fingerprint !~ '^[0-9a-f]{64}$' then raise 'empreinte non calculée par la base'; end if;
  if r.first_at < now() - interval '1 minute' then raise 'date fournie par l''appelant gardée'; end if;
end $$;

-- ── Contraintes : un message avec chiffre, @ ou caractère non ASCII est refusé ──
set role service_role;
do $$ begin
  if pg_temp.eerr($q$ insert into public.error_reports (kind, name, message, frames, build, platform) values ('error', 'Error', 'poids 82.5', '[]', 'b', 'ios') $q$) not like '%check constraint%' then raise 'chiffre accepté'; end if;
  if pg_temp.eerr($q$ insert into public.error_reports (kind, name, message, frames, build, platform) values ('error', 'Error', 'max@exemple.invalid', '[]', 'b', 'ios') $q$) not like '%check constraint%' then raise '@ accepté'; end if;
  if pg_temp.eerr($q$ insert into public.error_reports (kind, name, message, frames, build, platform) values ('error', 'Error', 'Développé', '[]', 'b', 'ios') $q$) not like '%check constraint%' then raise 'accent accepté'; end if;
  if pg_temp.eerr($q$ insert into public.error_reports (kind, name, message, frames, build, platform) values ('crash', 'Error', 'x', '[]', 'b', 'ios') $q$) not like '%check constraint%' then raise 'kind inconnu accepté'; end if;
end $$;
reset role;

-- ── Limite globale : 200 erreurs nouvelles par heure, puis rate_limited ; purge à 90 jours ──
delete from public.error_reports;
alter table public.error_reports disable trigger error_reports_before_insert;
insert into public.error_reports (kind, name, message, frames, build, platform, fingerprint)
  select 'error', 'Error', 'e' || chr(97 + g % 26) || repeat('x', g / 26), '[]', 'b', 'ios', repeat('a', 64) from generate_series(1, 200) g;
insert into public.error_reports (kind, name, message, frames, build, platform, fingerprint, first_at, last_at)
  values ('error', 'Error', 'vieille', '[]', 'b', 'ios', repeat('b', 64), now() - interval '100 days', now() - interval '100 days');
alter table public.error_reports enable trigger error_reports_before_insert;
set role service_role;
do $$ begin
  if pg_temp.eerr($q$ insert into public.error_reports (kind, name, message, frames, build, platform) values ('error', 'Error', 'nouvelle', '[]', 'b', 'ios') $q$) <> 'rate_limited' then raise 'limite globale absente'; end if;
end $$;
reset role;
update public.error_reports set first_at = now() - interval '2 hours' where message <> 'vieille';
set role service_role;
insert into public.error_reports (kind, name, message, frames, build, platform) values ('error', 'Error', 'nouvelle', '[]', 'b', 'ios');
reset role;
do $$ begin
  if exists (select 1 from public.error_reports where message = 'vieille') then raise 'purge à 90 jours absente'; end if;
end $$;
delete from public.error_reports;
