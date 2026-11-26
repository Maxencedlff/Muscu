-- Remontée des erreurs de l'app (docs/ERREURS_PROD.md). PAS APPLIQUÉE EN PRODUCTION sans le feu vert de Maxence.
--
-- Un rapport = une erreur JavaScript non rattrapée dans l'app installée : type, message nettoyé, pile reconstruite
-- (fichier de l'app, ligne, colonne), version et plateforme. AUCUNE donnée personnelle : pas de compte, pas
-- d'adresse IP, pas d'appareil, pas d'heure locale. Les contraintes ci-dessous refusent un message qui contient
-- encore un chiffre ou un @ (poids, dates, e-mails) : l'app les remplace avant l'envoi
-- (js/data/error-report.js), la fonction error-report le revérifie (error-policy.js), la base aussi.
--
-- Droits : personne ne lit ni n'écrit en direct (anon et authenticated sans aucun droit, RLS sans politique) ;
-- seule la clé serveur (fonction error-report) insère, et Maxence lit par l'éditeur SQL ou scripts/erreurs-prod.mjs.
-- Le déclencheur regroupe la même erreur de la même version (hits), tient une limite globale de 200 erreurs
-- nouvelles par heure et efface les lignes sans nouvelle occurrence depuis 90 jours.
-- Retour arrière : supabase/rollback/20261129010000_erreurs_prod_down.sql.

create table public.error_reports (
  id bigint generated always as identity primary key,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  hits integer not null default 1 check (hits between 1 and 1000000),
  fingerprint text not null default '' check (fingerprint ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('error', 'rejection')),
  name text not null check (name ~ '^[A-Za-z]{1,40}$'),
  message text not null check (char_length(message) <= 200 and message ~ '^[ -~]*$' and message !~ '[0-9@]'),
  frames jsonb not null check (jsonb_typeof(frames) = 'array' and jsonb_array_length(frames) <= 12 and octet_length(frames::text) <= 4000),
  build text not null check (build ~ '^[A-Za-z0-9._+-]{1,40}$'),
  platform text not null check (platform in ('ios', 'android', 'web'))
);
create index error_reports_recent on public.error_reports (last_at desc);
create index error_reports_fingerprint on public.error_reports (fingerprint, last_at desc);
alter table public.error_reports enable row level security;
revoke all on table public.error_reports from public, anon, authenticated, service_role;
revoke all on sequence public.error_reports_id_seq from public, anon, authenticated, service_role;
grant select, insert on table public.error_reports to service_role;

create function private.error_report_before_insert() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  new.first_at := now();
  new.last_at := now();
  new.hits := 1;
  new.fingerprint := encode(sha256(convert_to(
    new.kind || '|' || new.name || '|' || new.message || '|' || new.frames::text || '|' || new.build || '|' || new.platform, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('error_reports', 0));
  -- Même erreur, même version, vue dans les dernières 24 h : compteur seulement, pas de nouvelle ligne
  update public.error_reports e set hits = least(e.hits + 1, 1000000), last_at = now()
    where e.id = (select r.id from public.error_reports r
                  where r.fingerprint = new.fingerprint and r.last_at > now() - interval '24 hours'
                  order by r.last_at desc limit 1);
  if found then return null; end if;
  if (select count(*) from public.error_reports r where r.first_at > now() - interval '1 hour') >= 200 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  delete from public.error_reports r where r.last_at < now() - interval '90 days';
  return new;
end
$$;
create trigger error_reports_before_insert before insert on public.error_reports
  for each row execute function private.error_report_before_insert();
revoke all on function private.error_report_before_insert() from public, anon, authenticated, service_role;
