-- ═══════════════════════════════════════════════════════════
--  Bilan de l'élève : partage des mensurations avec le coach (05/11/2026, demande des coachs
--  partenaires). Même modèle que le poids (20261031300000_partage_coach.sql) : une case de plus dans
--  « Partager avec mon coach », décochée par défaut. Contrat : docs/COACH_SUIVI.md, « Bilan ».
--
--  Sécurité (données de forme, consentement explicite), identique au poids :
--  - Consentement : une ligne public.coach_shares (student_id, coach_id, kind = 'measures', granted_at)
--    pour le coach ACTUEL (clé étrangère vers coach_links on delete cascade) : quitter, être retiré,
--    supprimer un des comptes efface le consentement.
--  - Données : public.coach_shared_measures (student_id, part, at, cm), séparées des séances, clé
--    étrangère vers le consentement (student_id, 'measures') on delete cascade : décocher (ou perdre le
--    lien) efface toutes les mensurations envoyées, historique compris. Une mesure ne peut exister que
--    sous un consentement actif.
--  - Envoi : student_share_measures refuse (not_shared) sans consentement actif ; il remplace tout
--    (miroir de l'appareil), 400 valeurs par mesure et 4000 en tout au plus, bornées (10 à 250 cm,
--    dates passées), 256 Ko au plus.
--  - Lecture : seul le coach consenti, encore coach (coach_student_measures) ; un autre coach, un ami,
--    l'élève lui-même par cette fonction : not_found. Rien pour les amis.
--  - Photos : jamais (elles restent dans le coffre de l'iPhone, chiffrées ; docs/COACH_SUIVI.md).
--  - Aucune lecture ni écriture directe : RLS activée sans politique, aucun GRANT sur la table ; RPC
--    security definer, search_path vide, utilisateur pris dans auth.uid() ; anon n'exécute rien.
--  - Limites : cochage compté avec celui du poids (60 par heure, private.social_rate « coach_share ») ;
--    60 envois de mensurations par heure (« coach_share_mup ») ; décocher n'est jamais limité.
--  - student_shares() dit en plus quelles données le serveur accepte (kinds) : l'app n'affiche la case
--    « Mensurations » que sur un serveur qui la connaît.
--
--  Réversible : supabase/rollback/20261105010000_partage_mensurations_down.sql (efface les mensurations
--  partagées et leurs consentements, remet le partage du poids tel qu'il était).
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- 'measures' rejoint la liste des données du consentement
alter table public.coach_shares drop constraint coach_shares_kind_check;
alter table public.coach_shares add constraint coach_shares_kind_check
  check (kind in ('weight', 'sleep', 'steps', 'resting_hr', 'measures'));

-- Mensurations partagées : par mesure (clés de js/data/body-measures.js, BODY_MEASURES), date en ms
-- (début du jour), cm au dixième. Jamais sans consentement (clé étrangère, kind fixé à 'measures').
create table public.coach_shared_measures (
  student_id uuid not null,
  kind       text not null default 'measures' check (kind = 'measures'),
  part       text not null check (part in ('chest', 'waist', 'hips', 'shoulders', 'neck', 'armL', 'armR', 'thighL', 'thighR', 'calf')),
  at         bigint not null check (at > 946684800000),   -- après le 1er janvier 2000
  cm         numeric(4, 1) not null check (cm between 10 and 250),
  primary key (student_id, part, at),
  foreign key (student_id, kind) references public.coach_shares (student_id, kind) on delete cascade
);

alter table public.coach_shared_measures enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.coach_shared_measures from public, anon, authenticated, service_role;

-- ── Briques privées ──────────────────────────────────────

-- Données que l'élève peut cocher aujourd'hui : le poids et les mensurations
create or replace function private.share_kind_open(kind text) returns boolean
  language sql immutable set search_path = '' as
$$ select kind in ('weight', 'measures') $$;

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- Élève : ce que je partage avec mon coach actuel (même forme qu'avant, plus kinds : données que ce
-- serveur accepte). n et last_at : valeurs envoyées pour chaque donnée cochée.
create or replace function public.student_shares() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id),
  l as (select cl.student_id, cl.coach_id from me join public.coach_links cl on cl.student_id = me.id)
  select jsonb_build_object(
    'coach', exists (select 1 from l),
    'kinds', (select jsonb_agg(k order by o) from unnest(array['weight', 'sleep', 'steps', 'resting_hr', 'measures']) with ordinality as t(k, o)
              where private.share_kind_open(k)),
    'shares', coalesce((
      select jsonb_object_agg(c.kind, jsonb_build_object(
        'granted_at', c.granted_at,
        'n', case c.kind
               when 'weight' then (select count(*)::int from public.coach_shared_weights w where w.student_id = c.student_id)
               when 'measures' then (select count(*)::int from public.coach_shared_measures m where m.student_id = c.student_id)
               else 0 end,
        'last_at', case c.kind
               when 'weight' then (select max(w.at) from public.coach_shared_weights w where w.student_id = c.student_id)
               when 'measures' then (select max(m.at) from public.coach_shared_measures m where m.student_id = c.student_id)
               end))
      from l join public.coach_shares c on c.student_id = l.student_id and c.coach_id = l.coach_id), '{}'::jsonb))
$$;

-- Élève : envoyer mes mensurations (remplace tout : miroir de l'appareil). measures = { chest: [{ date: ms,
-- cm }], waist: [...], … }. Renvoie le nombre de valeurs gardées. Sans consentement : not_shared ; forme
-- mauvaise, mesure inconnue, valeur hors bornes : invalid_data ; plus de 400 valeurs pour une mesure, plus
-- de 4000 en tout ou plus de 256 Ko : too_long. Deux valeurs au même instant d'une mesure : la dernière.
create function public.student_share_measures(measures jsonb) returns int
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  n int;
begin
  -- Un envoi à la fois par élève (deux appareils, ou un cochage et une mesure saisie en même temps)
  if me is not null then perform pg_advisory_xact_lock(hashtextextended('coach_share_measures:' || me::text, 0)); end if;
  if me is null or not exists (select 1 from public.coach_shares c where c.student_id = me and c.kind = 'measures') then
    raise exception 'not_shared' using errcode = 'P0001';
  end if;
  if measures is null or jsonb_typeof(measures) <> 'object' then
    raise exception 'invalid_data' using errcode = 'P0001';
  end if;
  if octet_length(measures::text) > 262144 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_each(measures) e
             where e.key not in ('chest', 'waist', 'hips', 'shoulders', 'neck', 'armL', 'armR', 'thighL', 'thighR', 'calf')
                or jsonb_typeof(e.value) <> 'array') then
    raise exception 'invalid_data' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_each(measures) e where jsonb_array_length(e.value) > 400)
     or (select coalesce(sum(jsonb_array_length(e.value)), 0) from jsonb_each(measures) e) > 4000 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;
  -- Chaque valeur : objet { date: entier > 2000-01-01 et pas dans le futur (+24 h), cm : 10 à 250 }
  -- (CASE : les conversions ne sont tentées que sur des nombres, l'ordre d'un OR n'étant pas garanti)
  if exists (select 1 from jsonb_each(measures) e, jsonb_array_elements(e.value) v
             where case when jsonb_typeof(v) = 'object' and jsonb_typeof(v -> 'date') = 'number'
                             and jsonb_typeof(v -> 'cm') = 'number'
                        then (v ->> 'date')::numeric <> trunc((v ->> 'date')::numeric)
                             or (v ->> 'date')::numeric <= 946684800000 or (v ->> 'date')::numeric > private.max_done_at()
                             or (v ->> 'cm')::numeric < 10 or (v ->> 'cm')::numeric > 250
                        else true end) then
    raise exception 'invalid_data' using errcode = 'P0001';
  end if;
  perform private.rate_limit_window(me, 'coach_share_mup', 60, interval '1 hour');
  delete from public.coach_shared_measures m where m.student_id = me;
  insert into public.coach_shared_measures (student_id, part, at, cm)
    select distinct on (x.part, x.at) me, x.part, x.at, x.cm
    from (select e.key as part, (v ->> 'date')::bigint as at, round((v ->> 'cm')::numeric, 1) as cm, o
          from jsonb_each(measures) e, jsonb_array_elements(e.value) with ordinality as t(v, o)) x
    order by x.part, x.at, x.o desc;
  get diagnostics n = row_count;
  return n;
end
$$;

-- Coach : mensurations partagées par un de mes élèves. { shared, since: granted_at | null, measures:
-- { chest: [{ date, cm }] du plus récent au plus ancien, … } } (mesures sans valeur absentes).
-- Pas mon élève, ou plus coach : not_found. Élève qui ne partage pas (ou plus) : shared false, rien.
create function public.coach_student_measures(student uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  since timestamptz;
begin
  perform private.coach_require_student(me, student);
  select c.granted_at into since from public.coach_shares c
    where c.student_id = student and c.coach_id = me and c.kind = 'measures';
  if since is null then
    return jsonb_build_object('shared', false, 'since', null, 'measures', '{}'::jsonb);
  end if;
  return jsonb_build_object('shared', true, 'since', since, 'measures', coalesce((
    select jsonb_object_agg(g.part, g.vals) from (
      select m.part, jsonb_agg(jsonb_build_object('date', m.at, 'cm', m.cm) order by m.at desc) as vals
      from public.coach_shared_measures m where m.student_id = student group by m.part) g), '{}'::jsonb));
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.share_kind_open(text) from public, anon, authenticated, service_role;
revoke all on function public.student_shares() from public, anon, authenticated;
revoke all on function public.student_share_measures(jsonb) from public, anon, authenticated;
revoke all on function public.coach_student_measures(uuid) from public, anon, authenticated;

grant execute on function public.student_shares() to authenticated;
grant execute on function public.student_share_measures(jsonb) to authenticated;
grant execute on function public.coach_student_measures(uuid) to authenticated;
