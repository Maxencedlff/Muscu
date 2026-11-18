-- ═══════════════════════════════════════════════════════════
--  Suivi de la diète par le coach (18/11/2026, demande la plus citée par les coachs du panel nutrition) : le
--  coach voit, jour par jour, si son élève suit sa diète. Même modèle que le poids et les mensurations
--  (20261031300000_partage_coach.sql, 20261105010000_partage_mensurations.sql) : une case de plus dans
--  « Partager avec mon coach », décochée par défaut. Contrat : docs/NUTRITION_V1.md, « Suivi de la diète par le
--  coach » ; docs/COACH_V1.md, « Partage avec le coach ».
--
--  Données de santé (CNIL : des apports caloriques suivis jour par jour renseignent sur la santé ; RGPD art. 9,
--  consentement explicite) :
--  - Consentement : une ligne public.coach_shares (student_id, coach_id, kind = 'diet_log', granted_at) pour le
--    coach ACTUEL (clé étrangère vers coach_links on delete cascade) : quitter, être retiré, supprimer un des
--    comptes efface le consentement. 'diet' reste l'accord « recevoir les plans diète » (20261106200000) : deux
--    finalités, deux accords.
--  - Données : public.coach_shared_diet_days, UN RÉSUMÉ PAR JOUR, rien de plus : date, plan (identifiant et nom),
--    type du jour (entraînement / repos), repas (nom et coché ou non, 8 au plus), kcal et macros mangés, objectifs
--    du jour, eau bue et son objectif, sel et son objectif. Jamais le détail des aliments, ni les remplacements, ni
--    les heures. Clé étrangère vers le consentement (student_id, 'diet_log') on delete cascade : décocher (ou
--    perdre le lien) efface tout, historique compris.
--  - Conservation : 90 jours glissants (DIET_SHARE_DAYS). Un jour plus ancien n'est jamais écrit, il est effacé à
--    chaque envoi de l'élève, la lecture du coach ne le rend jamais, et une purge quotidienne (pg_cron, 03:41 UTC)
--    l'efface pour l'élève qui n'ouvre plus l'app. 90 jours = la plus longue phase du planning du coach
--    (12 semaines, docs/COACH_SUIVI.md) plus une semaine de marge : juger si une phase a été suivie.
--  - Envoi : student_share_diet_days refuse (not_shared) sans consentement actif ; il remplace tout (miroir de
--    l'appareil, comme les pesées), 92 jours au plus, 128 Ko au plus, chaque champ borné (invalid_data sinon).
--  - Lecture : seul le coach consenti, encore coach (coach_student_diet, coach_diet_overview) ; un autre coach,
--    un ami, l'élève lui-même par ces fonctions : not_found ou rien. Rien pour les amis.
--  - Aucune lecture ni écriture directe : RLS activée sans politique, aucun GRANT sur la table ; RPC security
--    definer, search_path vide, utilisateur pris dans auth.uid() ; anon n'exécute rien.
--  - Limites : cochage compté avec les autres (60 par heure, « coach_share ») ; 120 envois par heure
--    (« coach_share_dup » : l'app regroupe les coches, un envoi au plus toutes les 5 s) ; décocher n'est jamais
--    limité.
--  - student_shares() annonce 'diet_log' (kinds) : l'app ne montre la case que sur un serveur qui la connaît.
--
--  Réversible : supabase/rollback/20261118010000_suivi_diete_coach_down.sql (efface les jours partagés et leurs
--  consentements, remet student_shares et share_kind_open au texte de 20261106200000_plans_diete_coach.sql).
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

alter table public.coach_shares drop constraint coach_shares_kind_check;
alter table public.coach_shares add constraint coach_shares_kind_check
  check (kind in ('weight', 'sleep', 'steps', 'resting_hr', 'measures', 'diet', 'diet_log'));

-- Un jour de diète partagé. Noms : 40 caractères au plus (DIET_NAME_MAX de l'app), sans caractère de contrôle.
-- meals : [{ n: nom du repas, ok: coché }], 8 au plus (DIET_MEAL_MAX). Grammes et kcal entiers, eau en ml, sel en g.
create table public.coach_shared_diet_days (
  student_id    uuid not null,
  kind          text not null default 'diet_log' check (kind = 'diet_log'),
  day           date not null,
  plan_id       text check (plan_id ~ '^d[A-Za-z0-9_-]{1,44}$'),
  plan_name     text check (char_length(plan_name) between 1 and 40 and plan_name !~ '[[:cntrl:]]'),
  variant       text check (variant in ('t', 'r')),
  meals         jsonb not null default '[]'::jsonb check (jsonb_typeof(meals) = 'array' and jsonb_array_length(meals) <= 8),
  kcal          int not null check (kcal between 0 and 20000),
  p             int not null check (p between 0 and 2000),
  c             int not null check (c between 0 and 2000),
  f             int not null check (f between 0 and 2000),
  goal_kcal     int check (goal_kcal between 0 and 10000),
  goal_p        int check (goal_p between 0 and 600),
  goal_c        int check (goal_c between 0 and 1500),
  goal_f        int check (goal_f between 0 and 600),
  water_ml      int not null default 0 check (water_ml between 0 and 20000),
  water_goal_ml int check (water_goal_ml between 0 and 10000),
  water_min_ml  int check (water_min_ml between 0 and 10000),
  salt_g        numeric(4, 1) check (salt_g between 0 and 100),
  salt_min      numeric(3, 1) check (salt_min between 0 and 15),
  salt_max      numeric(3, 1) check (salt_max between 0 and 15),
  primary key (student_id, day),
  foreign key (student_id, kind) references public.coach_shares (student_id, kind) on delete cascade
);
-- Purge quotidienne : tous les élèves d'un coup, par date
create index coach_shared_diet_days_day on public.coach_shared_diet_days (day);

alter table public.coach_shared_diet_days enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.coach_shared_diet_days from public, anon, authenticated, service_role;

-- ── Briques privées ──────────────────────────────────────

-- Données que l'élève peut cocher : le poids, les mensurations, les plans du coach, et le suivi de la diète
create or replace function private.share_kind_open(kind text) returns boolean
  language sql immutable set search_path = '' as
$$ select kind in ('weight', 'measures', 'diet', 'diet_log') $$;

-- Premier jour gardé : 90 jours glissants, aujourd'hui compris (UTC ; l'app envoie ses jours locaux)
create function private.diet_share_first_day() returns date
  language sql stable set search_path = '' as
$$ select (now() at time zone 'utc')::date - 89 $$;

-- Un nombre entier JSON entre lo et hi (null JSON accepté si nullable). CASE : jamais de conversion d'un texte.
create function private.diet_int_ok(v jsonb, lo numeric, hi numeric, nullable boolean) returns boolean
  language sql immutable set search_path = '' as
$$
  select case when v is null or jsonb_typeof(v) = 'null' then nullable
              when jsonb_typeof(v) <> 'number' then false
              else (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric) and (v #>> '{}')::numeric between lo and hi end
$$;
-- Un nombre JSON (décimal) entre lo et hi, ou null si nullable
create function private.diet_num_ok(v jsonb, lo numeric, hi numeric, nullable boolean) returns boolean
  language sql immutable set search_path = '' as
$$
  select case when v is null or jsonb_typeof(v) = 'null' then nullable
              when jsonb_typeof(v) <> 'number' then false
              else (v #>> '{}')::numeric between lo and hi end
$$;
-- Un nom de 1 à 40 caractères sans caractère de contrôle, ou null si nullable
create function private.diet_name_ok(v jsonb, nullable boolean) returns boolean
  language sql immutable set search_path = '' as
$$
  select case when v is null or jsonb_typeof(v) = 'null' then nullable
              when jsonb_typeof(v) <> 'string' then false
              else char_length(v #>> '{}') between 1 and 40 and (v #>> '{}') !~ '[[:cntrl:]]' end
$$;

-- Un jour envoyé par l'app : forme et bornes (les clés inconnues sont ignorées, jamais gardées)
create function private.diet_day_ok(v jsonb) returns boolean
  language sql immutable set search_path = '' as
$$
  select case when jsonb_typeof(v) <> 'object' then false
    else jsonb_typeof(v -> 'day') = 'string' and (v ->> 'day') ~ '^\d{4}-\d{2}-\d{2}$'
      and (v ->> 'day') between '2000-01-01' and '2999-12-31'
      and case when (v -> 'plan') is null or jsonb_typeof(v -> 'plan') = 'null' then true
               when jsonb_typeof(v -> 'plan') <> 'string' then false
               else (v ->> 'plan') ~ '^d[A-Za-z0-9_-]{1,44}$' end
      and private.diet_name_ok(v -> 'name', true)
      and case when (v -> 'kind') is null or jsonb_typeof(v -> 'kind') = 'null' then true
               else jsonb_typeof(v -> 'kind') = 'string' and (v ->> 'kind') in ('t', 'r') end
      and case when (v -> 'meals') is null then true
               when jsonb_typeof(v -> 'meals') <> 'array' or jsonb_array_length(v -> 'meals') > 8 then false
               else not exists (select 1 from jsonb_array_elements(v -> 'meals') m
                                where jsonb_typeof(m) <> 'object' or not private.diet_name_ok(m -> 'n', false)
                                   or jsonb_typeof(m -> 'ok') is distinct from 'boolean') end
      and private.diet_int_ok(v -> 'kcal', 0, 20000, false)
      and private.diet_int_ok(v -> 'p', 0, 2000, false) and private.diet_int_ok(v -> 'c', 0, 2000, false)
      and private.diet_int_ok(v -> 'f', 0, 2000, false)
      and case when (v -> 'goal') is null or jsonb_typeof(v -> 'goal') = 'null' then true
               when jsonb_typeof(v -> 'goal') <> 'object' then false
               else private.diet_int_ok(v -> 'goal' -> 'kcal', 0, 10000, true) and private.diet_int_ok(v -> 'goal' -> 'p', 0, 600, true)
                and private.diet_int_ok(v -> 'goal' -> 'c', 0, 1500, true) and private.diet_int_ok(v -> 'goal' -> 'f', 0, 600, true) end
      and private.diet_int_ok(v -> 'water', 0, 20000, true)
      and private.diet_int_ok(v -> 'waterGoal', 0, 10000, true) and private.diet_int_ok(v -> 'waterMin', 0, 10000, true)
      and private.diet_num_ok(v -> 'salt', 0, 100, true)
      and private.diet_num_ok(v -> 'saltMin', 0, 15, true) and private.diet_num_ok(v -> 'saltMax', 0, 15, true)
  end
$$;

-- Un jour gardé, tel que le coach le lit (mêmes noms de clés que l'envoi ; null retirés)
create function private.diet_day_json(x public.coach_shared_diet_days) returns jsonb
  language sql stable set search_path = '' as
$$
  select jsonb_strip_nulls(jsonb_build_object(
    'day', to_char(x.day, 'YYYY-MM-DD'), 'plan', x.plan_id, 'name', x.plan_name, 'kind', x.variant, 'meals', x.meals,
    'kcal', x.kcal, 'p', x.p, 'c', x.c, 'f', x.f,
    'goal', nullif(jsonb_strip_nulls(jsonb_build_object('kcal', x.goal_kcal, 'p', x.goal_p, 'c', x.goal_c, 'f', x.goal_f)), '{}'::jsonb),
    'water', x.water_ml, 'waterGoal', x.water_goal_ml, 'waterMin', x.water_min_ml,
    'salt', x.salt_g, 'saltMin', x.salt_min, 'saltMax', x.salt_max))
$$;

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- student_shares : texte de 20261106200000_plans_diete_coach.sql, 'diet_log' ajouté (kinds, n = jours gardés,
-- last_at = début du dernier jour en ms)
create or replace function public.student_shares() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id),
  l as (select cl.student_id, cl.coach_id from me join public.coach_links cl on cl.student_id = me.id)
  select jsonb_build_object(
    'coach', exists (select 1 from l),
    'kinds', (select jsonb_agg(k order by o) from unnest(array['weight', 'sleep', 'steps', 'resting_hr', 'measures', 'diet', 'diet_log']) with ordinality as t(k, o)
              where private.share_kind_open(k)),
    'shares', coalesce((
      select jsonb_object_agg(c.kind, jsonb_build_object(
        'granted_at', c.granted_at,
        'n', case c.kind
               when 'weight' then (select count(*)::int from public.coach_shared_weights w where w.student_id = c.student_id)
               when 'measures' then (select count(*)::int from public.coach_shared_measures m where m.student_id = c.student_id)
               when 'diet_log' then (select count(*)::int from public.coach_shared_diet_days d where d.student_id = c.student_id)
               else 0 end,
        'last_at', case c.kind
               when 'weight' then (select max(w.at) from public.coach_shared_weights w where w.student_id = c.student_id)
               when 'measures' then (select max(m.at) from public.coach_shared_measures m where m.student_id = c.student_id)
               when 'diet_log' then (select (extract(epoch from max(d.day)::timestamp) * 1000)::bigint from public.coach_shared_diet_days d where d.student_id = c.student_id)
               end))
      from l join public.coach_shares c on c.student_id = l.student_id and c.coach_id = l.coach_id), '{}'::jsonb))
$$;

-- Élève : envoyer mes jours de diète (remplace tout : miroir de l'appareil). days = [{ day: 'AAAA-MM-JJ', plan, name,
-- kind, meals: [{ n, ok }], kcal, p, c, f, goal: { kcal, p, c, f }, water, waterGoal, waterMin, salt, saltMin,
-- saltMax }]. Les jours hors des 90 derniers (ou après demain) sont écartés sans erreur. Renvoie le nombre gardé.
-- Sans consentement : not_shared ; forme mauvaise ou valeur hors bornes : invalid_data ; plus de 92 jours ou de
-- 128 Ko : too_long. Deux fois le même jour : le dernier.
create function public.student_share_diet_days(days jsonb) returns int
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  first_day date := private.diet_share_first_day();
  n int;
begin
  if me is not null then perform pg_advisory_xact_lock(hashtextextended('coach_share_diet:' || me::text, 0)); end if;
  if me is null or not exists (select 1 from public.coach_shares c where c.student_id = me and c.kind = 'diet_log') then
    raise exception 'not_shared' using errcode = 'P0001';
  end if;
  if days is null or jsonb_typeof(days) <> 'array' then
    raise exception 'invalid_data' using errcode = 'P0001';
  end if;
  if jsonb_array_length(days) > 92 or octet_length(days::text) > 131072 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(days) v where not private.diet_day_ok(v)) then
    raise exception 'invalid_data' using errcode = 'P0001';
  end if;
  -- Date réelle (2026-02-30 refusé) : vérifiée une fois la forme sûre
  begin
    perform (v ->> 'day')::date from jsonb_array_elements(days) v;
  exception when others then
    raise exception 'invalid_data' using errcode = 'P0001';
  end;
  perform private.rate_limit_window(me, 'coach_share_dup', 120, interval '1 hour');
  delete from public.coach_shared_diet_days d where d.student_id = me;
  insert into public.coach_shared_diet_days (student_id, day, plan_id, plan_name, variant, meals, kcal, p, c, f,
      goal_kcal, goal_p, goal_c, goal_f, water_ml, water_goal_ml, water_min_ml, salt_g, salt_min, salt_max)
    select distinct on (x.day) me, x.day, x.v ->> 'plan', x.v ->> 'name', x.v ->> 'kind',
      coalesce((select jsonb_agg(jsonb_build_object('n', m ->> 'n', 'ok', (m ->> 'ok')::boolean) order by i)
                from jsonb_array_elements(x.v -> 'meals') with ordinality as t(m, i)), '[]'::jsonb),
      (x.v ->> 'kcal')::int, (x.v ->> 'p')::int, (x.v ->> 'c')::int, (x.v ->> 'f')::int,
      (x.v -> 'goal' ->> 'kcal')::int, (x.v -> 'goal' ->> 'p')::int, (x.v -> 'goal' ->> 'c')::int, (x.v -> 'goal' ->> 'f')::int,
      coalesce((x.v ->> 'water')::int, 0), (x.v ->> 'waterGoal')::int, (x.v ->> 'waterMin')::int,
      round((x.v ->> 'salt')::numeric, 1), round((x.v ->> 'saltMin')::numeric, 1), round((x.v ->> 'saltMax')::numeric, 1)
    from (select v, (v ->> 'day')::date as day, o from jsonb_array_elements(days) with ordinality as t(v, o)) x
    where x.day >= first_day and x.day <= first_day + 91
    order by x.day, x.o desc;
  get diagnostics n = row_count;
  return n;
end
$$;

-- Coach : jours de diète partagés par un de mes élèves. { shared, since: granted_at | null, days: [jour] du plus
-- récent au plus ancien, 90 derniers jours }. Pas mon élève, ou plus coach : not_found. Élève qui ne partage pas
-- (ou plus) : shared false, rien.
create function public.coach_student_diet(student uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  since timestamptz;
begin
  perform private.coach_require_student(me, student);
  select c.granted_at into since from public.coach_shares c
    where c.student_id = student and c.coach_id = me and c.kind = 'diet_log';
  if since is null then
    return jsonb_build_object('shared', false, 'since', null, 'days', '[]'::jsonb);
  end if;
  return jsonb_build_object('shared', true, 'since', since, 'days', coalesce((
    select jsonb_agg(private.diet_day_json(d) order by d.day desc)
    from public.coach_shared_diet_days d
    where d.student_id = student and d.day >= private.diet_share_first_day()), '[]'::jsonb));
end
$$;

-- Coach : pour « À relancer » de Mes élèves, en un appel : chaque élève qui me partage sa diète, depuis quand, et
-- ses 4 derniers jours en bref [jour, kcal, objectif kcal, repas cochés, repas]. Pas coach : liste vide.
create function public.coach_diet_overview() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id),
  s as (
    select c.student_id, c.granted_at
    from me
    join public.coach_shares c on c.coach_id = me.id and c.kind = 'diet_log'
    where private.is_coach(me.id))
  select jsonb_build_object('students', coalesce(jsonb_agg(jsonb_build_object(
    'student_id', s.student_id, 'since', s.granted_at,
    'days', coalesce((select jsonb_agg(jsonb_build_array(to_char(d.day, 'YYYY-MM-DD'), d.kcal, d.goal_kcal,
                                (select count(*) from jsonb_array_elements(d.meals) m where (m ->> 'ok')::boolean),
                                jsonb_array_length(d.meals)) order by d.day desc)
                      from public.coach_shared_diet_days d
                      where d.student_id = s.student_id and d.day >= (now() at time zone 'utc')::date - 3), '[]'::jsonb))), '[]'::jsonb))
  from s
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.share_kind_open(text) from public, anon, authenticated, service_role;
revoke all on function private.diet_share_first_day() from public, anon, authenticated, service_role;
revoke all on function private.diet_int_ok(jsonb, numeric, numeric, boolean) from public, anon, authenticated, service_role;
revoke all on function private.diet_num_ok(jsonb, numeric, numeric, boolean) from public, anon, authenticated, service_role;
revoke all on function private.diet_name_ok(jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function private.diet_day_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.diet_day_json(public.coach_shared_diet_days) from public, anon, authenticated, service_role;
revoke all on function public.student_shares() from public, anon, authenticated;
revoke all on function public.student_share_diet_days(jsonb) from public, anon, authenticated;
revoke all on function public.coach_student_diet(uuid) from public, anon, authenticated;
revoke all on function public.coach_diet_overview() from public, anon, authenticated;

grant execute on function public.student_shares() to authenticated;
grant execute on function public.student_share_diet_days(jsonb) to authenticated;
grant execute on function public.coach_student_diet(uuid) to authenticated;
grant execute on function public.coach_diet_overview() to authenticated;

-- ── Purge quotidienne (pg_cron, disponible sur Supabase ; absent du Postgres local des tests) ──
-- Jours de plus de 90 jours, pour l'élève qui n'ouvre plus l'app. Même nom = même tâche : rejouer ne la double pas.
do $cron$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-diete-coach-90-jours', '41 3 * * *',
      $job$delete from public.coach_shared_diet_days where day < (now() at time zone 'utc')::date - 89$job$);
  end if;
end
$cron$;
