-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261127010000_sante_coach.sql (à lancer à la main, dans l'éditeur SQL,
--  seulement si Maxence décide de retirer la santé partagée avec le coach). Pas dans migrations/ : Supabase ne
--  l'applique jamais de lui-même.
--
--  Avant : revenir à une version de l'app qui n'appelle plus student_share_health_days ni coach_student_health
--  (une app plus récente sur ce serveur cache la case « Pas, sommeil et cardio » : elle n'est plus dans
--  student_shares().kinds, et la fiche du coach n'affiche pas la santé).
--
--  Effet : les consentements 'health' (public.coach_shares) et tous les jours de santé partagés
--  (public.coach_shared_health_days) sont SUPPRIMÉS : le coach n'en voit plus aucun, ce qui respecte le retrait du
--  consentement. La purge quotidienne pg_cron est retirée. Reprennent leur texte d'avant : la contrainte de
--  coach_shares.kind, private.share_kind_open et student_shares (20261118010000_suivi_diete_coach.sql),
--  coach_student_weeks (20261124010000_semaines_coach.sql), private.checkin_kinds et private.checkin_number
--  (20261125010000_bilans_coach.sql). Les lignes « coach_share_health » du journal private.social_rate sont retirées.
--
--  Bilans : un suivi Sommeil en heures (type number) déjà enregistré dans un modèle ou une demande reste en base,
--  mais n'est plus accepté à l'enregistrement suivant (invalid_template) ni à la réponse (invalid_answer). Refusé
--  ici s'il en existe un : le coach doit d'abord le repasser en échelle (ou le retirer), sinon ses bilans cassent.
--
--  Ordre : à défaire AVANT 20261126010000_programmes_envoyes_coach_down.sql (supabase/rollback/ORDRE.md).
-- ═══════════════════════════════════════════════════════════

begin;

-- Garde : aucun suivi Sommeil en heures dans les modèles ni dans les demandes encore ouvertes
do $$
begin
  if exists (select 1 from public.coach_checkin_templates t, jsonb_array_elements(t.items) e
             where e ->> 'kind' = 'sleep' and e ->> 'type' = 'number') then
    raise exception 'un modèle de bilan a un suivi Sommeil en heures : le repasser en échelle avant ce retour arrière';
  end if;
end
$$;

drop function public.student_share_health_days(jsonb);
drop function public.coach_student_health(uuid);

-- Consentements « health » : supprimés (cascade : jours partagés), puis la table vide
delete from public.coach_shares c where c.kind = 'health';
drop table public.coach_shared_health_days;
drop function private.health_day_ok(jsonb);
drop function private.health_int_ok(jsonb, int);
drop function private.health_share_first_day();

alter table public.coach_shares drop constraint coach_shares_kind_check;
alter table public.coach_shares add constraint coach_shares_kind_check
  check (kind in ('weight', 'sleep', 'steps', 'resting_hr', 'measures', 'diet', 'diet_log'));

-- Textes de 20261118010000_suivi_diete_coach.sql
create or replace function private.share_kind_open(kind text) returns boolean
  language sql immutable set search_path = '' as
$$ select kind in ('weight', 'measures', 'diet', 'diet_log') $$;

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

-- Texte de 20261124010000_semaines_coach.sql
create or replace function public.coach_student_weeks(student uuid, weeks integer default 12) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  w integer := least(greatest(coalesce(weeks, 12), 1), 26);
  from_ms bigint;
  measures jsonb := null;
  diet jsonb := null;
begin
  perform private.coach_require_student(me, student);
  from_ms := (extract(epoch from (date_trunc('week', now()) - make_interval(weeks => w - 1) - interval '1 day')) * 1000)::bigint;
  if to_regprocedure('public.coach_student_measures(uuid)') is not null then
    execute 'select public.coach_student_measures($1)' into measures using student;
  end if;
  if to_regprocedure('public.coach_student_diet(uuid)') is not null then
    execute 'select public.coach_student_diet($1)' into diet using student;
  end if;
  return jsonb_build_object(
    'weeks', w,
    'from', from_ms,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'done_at', x.done_at,
               's', private.session_for_coach(x.id, x.data) || private.coach_session_body(me, student, x.done_at))
             order by x.done_at desc, x.id desc)
      from (select y.id, y.done_at, y.data from public.sessions y
            where y.user_id = student and y.deleted_at is null and y.done_at is not null
              and y.done_at >= from_ms and y.done_at <= private.max_done_at()
            order by y.done_at desc, y.id desc
            limit 150) x), '[]'::jsonb),
    'weights', public.coach_student_weights(student),
    'measures', measures,
    'diet', diet);
end
$$;

-- Textes de 20261125010000_bilans_coach.sql
create or replace function private.checkin_kinds() returns jsonb
  language sql immutable set search_path = '' as
$$
  select '{
    "weight":             {"label": "Poids", "types": ["number"], "unit": "kg"},
    "measures":           {"label": "Mensurations", "types": ["number"], "unit": "cm"},
    "photos":             {"label": "Photos", "types": ["photo"]},
    "diet_adherence":     {"label": "Respect du plan diète", "types": ["auto"]},
    "training_adherence": {"label": "Respect de l''entraînement", "types": ["auto"]},
    "steps":              {"label": "Pas par jour", "types": ["number"], "unit": "steps"},
    "cardio":             {"label": "Cardio", "types": ["number"], "unit": "min"},
    "pain":               {"label": "Douleurs ou blessures", "types": ["yesno", "text"], "sensitive": true},
    "sleep":              {"label": "Sommeil", "types": ["scale"], "scale": 5, "lo": "Mal", "hi": "Très bien"},
    "energy":             {"label": "Énergie", "types": ["scale"], "scale": 5, "lo": "À plat", "hi": "Au top"},
    "hunger":             {"label": "Faim", "types": ["scale"], "scale": 5, "lo": "Aucune", "hi": "Tout le temps"},
    "stress":             {"label": "Stress", "types": ["scale"], "scale": 5, "lo": "Aucun", "hi": "Très fort"},
    "digestion":          {"label": "Digestion", "types": ["scale"], "scale": 5, "lo": "Difficile", "hi": "Parfaite"},
    "fatigue":            {"label": "Fatigue", "types": ["scale"], "scale": 5, "lo": "Aucune", "hi": "Très forte"},
    "mood":               {"label": "Humeur", "types": ["scale"], "scale": 5, "lo": "Au plus bas", "hi": "Excellente"},
    "libido":             {"label": "Libido", "types": ["scale"], "scale": 5, "lo": "Très basse", "hi": "Très haute", "sensitive": true},
    "cycle":              {"label": "Cycle menstruel", "types": ["choice"], "sensitive": true}
  }'::jsonb
$$;

create or replace function private.checkin_number(v jsonb, unit text) returns numeric
  language plpgsql immutable set search_path = '' as
$$
declare
  n numeric;
  lo numeric := case unit when 'kg' then 25 when 'cm' then 10 when 'steps' then 0 when 'min' then 0 else -1000000 end;
  hi numeric := case unit when 'kg' then 300 when 'cm' then 250 when 'steps' then 100000 when 'min' then 10080 else 1000000 end;
begin
  if jsonb_typeof(v) is distinct from 'number' then return null; end if;
  n := (v #>> '{}')::numeric;
  if n < lo or n > hi then return null; end if;
  return case when unit in ('steps', 'min') then round(n) else round(n, 2) end;
end
$$;

revoke all on function private.share_kind_open(text) from public, anon, authenticated, service_role;
revoke all on function private.checkin_kinds() from public, anon, authenticated, service_role;
revoke all on function private.checkin_number(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.student_shares() from public, anon, authenticated;
revoke all on function public.coach_student_weeks(uuid, integer) from public, anon, authenticated;
grant execute on function public.student_shares() to authenticated;
grant execute on function public.coach_student_weeks(uuid, integer) to authenticated;

delete from private.social_rate r where r.action = 'coach_share_health';

-- Purge quotidienne (seulement là où pg_cron existe)
do $cron$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-sante-coach-90-jours';
  end if;
end
$cron$;

commit;
