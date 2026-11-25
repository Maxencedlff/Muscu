-- ═══════════════════════════════════════════════════════════
--  Santé partagée avec le coach (27/11/2026, vague 3) : pas, sommeil et cardio de l'élève, un résumé par jour,
--  lus par son coach. Même modèle que le suivi de la diète (20261118010000_suivi_diete_coach.sql) : une case de
--  plus dans « Partager avec mon coach » (« Pas, sommeil et cardio »), décochée par défaut. ÉCRITE, PAS APPLIQUÉE :
--  attend le feu vert de Maxence.
--
--  Données de santé (pas, durée de sommeil et minutes de cardio lues dans Santé d'Apple renseignent sur la santé ;
--  RGPD art. 9, consentement explicite) :
--  - Consentement : une ligne public.coach_shares (student_id, coach_id, kind = 'health', granted_at) pour le coach
--    ACTUEL (clé étrangère vers coach_links on delete cascade) : quitter, être retiré, supprimer un des comptes
--    efface le consentement.
--  - Données : public.coach_shared_health_days, UN RÉSUMÉ PAR JOUR, rien de plus : date locale de l'iPhone, pas du
--    jour, minutes endormi de la nuit qui se termine ce jour-là (phases « endormi » d'iOS, jamais le temps au lit
--    seul), minutes d'entraînements cardio du jour. Jamais les heures, ni les sources, ni la fréquence cardiaque,
--    ni le détail des phases. Clé étrangère vers le consentement (student_id, 'health') on delete cascade :
--    décocher (ou perdre le lien) efface tout, historique compris.
--  - Conservation : 90 jours glissants (comme la diète). Un jour plus ancien n'est jamais écrit, il est effacé à
--    chaque envoi de l'élève, la lecture du coach ne le rend jamais, et une purge quotidienne (pg_cron, 03:43 UTC)
--    l'efface pour l'élève qui n'ouvre plus l'app.
--  - Envoi : student_share_health_days refuse (not_shared) sans consentement actif ; il FUSIONNE jour par jour (un
--    jour reçu remplace le même jour, les autres restent), 92 jours au plus, 16 Ko au plus, chaque champ borné
--    (invalid_data sinon) ; seuls les jours de plus de 90 jours sont supprimés.
--  - Lecture : seul le coach consenti, encore coach (coach_student_health, et la clé health de coach_student_weeks) ;
--    un autre coach, un ex-coach, l'élève lui-même par ces fonctions, un non-élève : not_found. Rien pour les amis.
--  - Aucune lecture ni écriture directe : RLS activée sans politique, aucun GRANT sur la table ; RPC security
--    definer, search_path vide, utilisateur pris dans auth.uid() ; anon n'exécute rien.
--  - Limites : cochage compté avec les autres (60 par heure, « coach_share ») ; 120 envois par heure
--    (« coach_share_health ») ; décocher n'est jamais limité.
--  - student_shares() annonce 'health' (kinds) : l'app ne montre la case que sur un serveur qui la connaît.
--
--  Bilans (20261125010000_bilans_coach.sql) : le suivi « Sommeil » accepte aussi le type number, en heures par nuit
--  (unit 'h', 0 à 24, arrondi au centième), pour que le coach demande une moyenne d'heures que l'app pré-remplit.
--  private.checkin_kinds et private.checkin_number sont redéfinies (mêmes règles que js/data/checkins.js) ; un suivi
--  Sommeil en échelle reste accepté tel quel.
--
--  Réversible : supabase/rollback/20261127020000_sante_coach_down.sql (efface les jours partagés et leurs
--  consentements, remet les textes d'avant). Tests : tests/sql/sante_coach_test.sql,
--  tests/sql/sante_coach_rollback_test.sh.
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

alter table public.coach_shares drop constraint coach_shares_kind_check;
alter table public.coach_shares add constraint coach_shares_kind_check
  check (kind in ('weight', 'sleep', 'steps', 'resting_hr', 'measures', 'diet', 'diet_log', 'health'));

-- Un jour de santé partagé : pas (0 à 100 000), minutes de sommeil et de cardio (0 à 1 440), au moins un des trois
create table public.coach_shared_health_days (
  student_id uuid not null,
  kind       text not null default 'health' check (kind = 'health'),
  day        date not null,
  steps      int check (steps between 0 and 100000),
  sleep_min  int check (sleep_min between 0 and 1440),
  cardio_min int check (cardio_min between 0 and 1440),
  check (steps is not null or sleep_min is not null or cardio_min is not null),
  primary key (student_id, day),
  foreign key (student_id, kind) references public.coach_shares (student_id, kind) on delete cascade
);
-- Version du texte d'accord montré à l'élève (audit du 25/11, m5) : posée par le serveur à chaque accord 'health'
-- (la feuille d'accord de l'app, js/features/coach-share-ui.js, texte du 25/11/2026) ; null pour les autres sortes
alter table public.coach_shares add column consent_version text check (char_length(consent_version) <= 40);
create function private.coach_share_consent_version() returns trigger
  language plpgsql set search_path = '' as
$$
begin
  new.consent_version := case when new.kind = 'health' then 'sante-2026-11-25' else new.consent_version end;
  return new;
end
$$;
create trigger coach_shares_consent_version before insert on public.coach_shares
  for each row execute function private.coach_share_consent_version();

-- Purge quotidienne : tous les élèves d'un coup, par date
create index coach_shared_health_days_day on public.coach_shared_health_days (day);

alter table public.coach_shared_health_days enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.coach_shared_health_days from public, anon, authenticated, service_role;

-- ── Briques privées ──────────────────────────────────────

-- Données que l'élève peut cocher : le poids, les mensurations, les plans du coach, le suivi de la diète, et la santé
create or replace function private.share_kind_open(kind text) returns boolean
  language sql immutable set search_path = '' as
$$ select kind in ('weight', 'measures', 'diet', 'diet_log', 'health') $$;

-- Premier jour gardé : 90 jours glissants, aujourd'hui compris (UTC ; l'app envoie ses jours locaux). Propre à la
-- santé : le retour arrière de la diète ne la retire pas.
create function private.health_share_first_day() returns date
  language sql stable set search_path = '' as
$$ select (now() at time zone 'utc')::date - 89 $$;

-- Un entier JSON entre 0 et hi, ou null (absent ou null JSON). CASE : jamais de conversion d'un texte.
create function private.health_int_ok(v jsonb, hi int) returns boolean
  language sql immutable set search_path = '' as
$$
  select case when v is null or jsonb_typeof(v) = 'null' then true
              when jsonb_typeof(v) <> 'number' then false
              else (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric) and (v #>> '{}')::numeric between 0 and hi end
$$;

-- Un jour envoyé par l'app : { day: 'AAAA-MM-JJ', steps, sleep, cardio }, au moins un des trois non null (les
-- clés inconnues sont ignorées, jamais gardées). Jamais null : un jour sans date est refusé, pas laissé passer.
create function private.health_day_ok(v jsonb) returns boolean
  language sql immutable set search_path = '' as
$$
  select case when jsonb_typeof(v) <> 'object' then false
    else coalesce(jsonb_typeof(v -> 'day') = 'string', false) and (v ->> 'day') ~ '^\d{4}-\d{2}-\d{2}$'
      and (v ->> 'day') between '2000-01-01' and '2999-12-31'
      and private.health_int_ok(v -> 'steps', 100000)
      and private.health_int_ok(v -> 'sleep', 1440)
      and private.health_int_ok(v -> 'cardio', 1440)
      and coalesce(jsonb_typeof(v -> 'steps') = 'number' or jsonb_typeof(v -> 'sleep') = 'number' or jsonb_typeof(v -> 'cardio') = 'number', false)
  end
$$;

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- student_shares : texte de 20261118010000_suivi_diete_coach.sql, 'health' ajouté (kinds, n = jours gardés,
-- last_at = début du dernier jour en ms)
create or replace function public.student_shares() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with me as (select (select auth.uid()) as id),
  l as (select cl.student_id, cl.coach_id from me join public.coach_links cl on cl.student_id = me.id)
  select jsonb_build_object(
    'coach', exists (select 1 from l),
    'kinds', (select jsonb_agg(k order by o) from unnest(array['weight', 'sleep', 'steps', 'resting_hr', 'measures', 'diet', 'diet_log', 'health']) with ordinality as t(k, o)
              where private.share_kind_open(k)),
    'shares', coalesce((
      select jsonb_object_agg(c.kind, jsonb_build_object(
        'granted_at', c.granted_at,
        'n', case c.kind
               when 'weight' then (select count(*)::int from public.coach_shared_weights w where w.student_id = c.student_id)
               when 'measures' then (select count(*)::int from public.coach_shared_measures m where m.student_id = c.student_id)
               when 'diet_log' then (select count(*)::int from public.coach_shared_diet_days d where d.student_id = c.student_id)
               when 'health' then (select count(*)::int from public.coach_shared_health_days h where h.student_id = c.student_id)
               else 0 end,
        'last_at', case c.kind
               when 'weight' then (select max(w.at) from public.coach_shared_weights w where w.student_id = c.student_id)
               when 'measures' then (select max(m.at) from public.coach_shared_measures m where m.student_id = c.student_id)
               when 'diet_log' then (select (extract(epoch from max(d.day)::timestamp) * 1000)::bigint from public.coach_shared_diet_days d where d.student_id = c.student_id)
               when 'health' then (select (extract(epoch from max(h.day)::timestamp) * 1000)::bigint from public.coach_shared_health_days h where h.student_id = c.student_id)
               end))
      from l join public.coach_shares c on c.student_id = l.student_id and c.coach_id = l.coach_id), '{}'::jsonb))
$$;

-- Élève : envoyer mes jours de santé, FUSIONNÉS jour par jour : chaque jour reçu remplace le même jour sur le
-- serveur, les autres jours restent ; seuls les jours de plus de 90 jours sont supprimés.
-- days = [{ day: 'AAAA-MM-JJ', steps, sleep: minutes endormi, cardio: minutes }]. Les jours hors des 90 derniers
-- (ou après demain) sont écartés sans erreur. Renvoie le nombre de jours gardés pour l'élève (tous, après la fusion).
-- Sans consentement : not_shared ; forme mauvaise, valeur hors bornes, date irréelle, aucun des trois :
-- invalid_data ; plus de 92 jours ou de 16 Ko : too_long. Deux fois le même jour : le dernier.
create function public.student_share_health_days(days jsonb) returns int
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  first_day date := private.health_share_first_day();
  n int;
begin
  if me is not null then perform pg_advisory_xact_lock(hashtextextended('coach_share_health:' || me::text, 0)); end if;
  -- Blocage entre l'élève et son coach (audit du 25/11, B1) : plus rien ne part, comme sans consentement. Défense en
  -- profondeur : la branche du blocage général peut aussi couper le lien.
  if me is null or not exists (select 1 from public.coach_shares c where c.student_id = me and c.kind = 'health'
                                 and not private.blocked_between(me, c.coach_id)) then
    raise exception 'not_shared' using errcode = 'P0001';
  end if;
  if days is null or jsonb_typeof(days) <> 'array' then
    raise exception 'invalid_data' using errcode = 'P0001';
  end if;
  if jsonb_array_length(days) > 92 or octet_length(days::text) > 16384 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(days) v where not private.health_day_ok(v)) then
    raise exception 'invalid_data' using errcode = 'P0001';
  end if;
  -- Date réelle (2026-02-30 refusé) : vérifiée une fois la forme sûre
  begin
    perform (v ->> 'day')::date from jsonb_array_elements(days) v;
  exception when others then
    raise exception 'invalid_data' using errcode = 'P0001';
  end;
  perform private.rate_limit_window(me, 'coach_share_health', 120, interval '1 hour');
  -- Plus de 90 jours : supprimés ; les autres jours déjà envoyés restent (fusion, pas de miroir)
  delete from public.coach_shared_health_days h where h.student_id = me and h.day < first_day;
  insert into public.coach_shared_health_days (student_id, day, steps, sleep_min, cardio_min)
    select distinct on (x.day) me, x.day, (x.v ->> 'steps')::int, (x.v ->> 'sleep')::int, (x.v ->> 'cardio')::int
    from (select v, (v ->> 'day')::date as day, o from jsonb_array_elements(days) with ordinality as t(v, o)) x
    where x.day >= first_day and x.day <= first_day + 91
    order by x.day, x.o desc
  on conflict (student_id, day) do update set steps = excluded.steps, sleep_min = excluded.sleep_min,
    cardio_min = excluded.cardio_min;
  -- Nombre de jours que le coach voit désormais (tous les jours gardés, pas seulement ceux de cet envoi)
  select count(*)::int into n from public.coach_shared_health_days h where h.student_id = me;
  return n;
end
$$;

-- Coach : jours de santé partagés par un de mes élèves. { shared, since: granted_at | null, days: [{ day, steps,
-- sleep, cardio }] (null retirés) du plus récent au plus ancien, 90 derniers jours }. Pas mon élève, ou plus coach :
-- not_found. Élève qui ne partage pas (ou plus) : shared false, rien.
create function public.coach_student_health(student uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  since timestamptz;
begin
  perform private.coach_require_student(me, student);
  select c.granted_at into since from public.coach_shares c
    where c.student_id = student and c.coach_id = me and c.kind = 'health';
  -- Blocage entre les deux (audit du 25/11, B1) : rien n'est lu, comme sans partage
  if since is null or private.blocked_between(me, student) then
    return jsonb_build_object('shared', false, 'since', null, 'days', '[]'::jsonb);
  end if;
  return jsonb_build_object('shared', true, 'since', since, 'days', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('day', to_char(h.day, 'YYYY-MM-DD'), 'steps', h.steps,
                       'sleep', h.sleep_min, 'cardio', h.cardio_min)) order by h.day desc)
    from public.coach_shared_health_days h
    where h.student_id = student and h.day >= private.health_share_first_day()), '[]'::jsonb));
end
$$;

-- coach_student_weeks : texte de 20261124010000_semaines_coach.sql, clé health ajoutée (public.coach_student_health,
-- null si le serveur ne l'a pas, même règle que measures et diet)
create or replace function public.coach_student_weeks(student uuid, weeks integer default 12) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  w integer := least(greatest(coalesce(weeks, 12), 1), 26);
  from_ms bigint;
  measures jsonb := null;
  diet jsonb := null;
  health jsonb := null;
begin
  perform private.coach_require_student(me, student);
  from_ms := (extract(epoch from (date_trunc('week', now()) - make_interval(weeks => w - 1) - interval '1 day')) * 1000)::bigint;
  if to_regprocedure('public.coach_student_measures(uuid)') is not null then
    execute 'select public.coach_student_measures($1)' into measures using student;
  end if;
  if to_regprocedure('public.coach_student_diet(uuid)') is not null then
    execute 'select public.coach_student_diet($1)' into diet using student;
  end if;
  if to_regprocedure('public.coach_student_health(uuid)') is not null then
    execute 'select public.coach_student_health($1)' into health using student;
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
    'diet', diet,
    'health', health);
end
$$;

-- ── Bilans : le suivi Sommeil aussi en heures par nuit ───

-- Catalogue fermé des suivis (CHECKIN_KINDS) : texte de 20261125010000_bilans_coach.sql, sleep en échelle OU en
-- nombre d'heures (unit 'h')
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
    "sleep":              {"label": "Sommeil", "types": ["scale", "number"], "unit": "h", "scale": 5, "lo": "Mal", "hi": "Très bien"},
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

-- checkinNumber : texte de 20261125010000_bilans_coach.sql, unité 'h' (heures de sommeil par nuit) bornée à 0..24,
-- arrondie au centième
create or replace function private.checkin_number(v jsonb, unit text) returns numeric
  language plpgsql immutable set search_path = '' as
$$
declare
  n numeric;
  lo numeric := case unit when 'kg' then 25 when 'cm' then 10 when 'steps' then 0 when 'min' then 0 when 'h' then 0 else -1000000 end;
  hi numeric := case unit when 'kg' then 300 when 'cm' then 250 when 'steps' then 100000 when 'min' then 10080 when 'h' then 24 else 1000000 end;
begin
  if jsonb_typeof(v) is distinct from 'number' then return null; end if;
  n := (v #>> '{}')::numeric;
  if n < lo or n > hi then return null; end if;
  return case when unit in ('steps', 'min') then round(n) else round(n, 2) end;
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.share_kind_open(text) from public, anon, authenticated, service_role;
revoke all on function private.coach_share_consent_version() from public, anon, authenticated, service_role;
revoke all on function private.health_share_first_day() from public, anon, authenticated, service_role;
revoke all on function private.health_int_ok(jsonb, int) from public, anon, authenticated, service_role;
revoke all on function private.health_day_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.checkin_kinds() from public, anon, authenticated, service_role;
revoke all on function private.checkin_number(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.student_shares() from public, anon, authenticated;
revoke all on function public.student_share_health_days(jsonb) from public, anon, authenticated;
revoke all on function public.coach_student_health(uuid) from public, anon, authenticated;
revoke all on function public.coach_student_weeks(uuid, integer) from public, anon, authenticated;

grant execute on function public.student_shares() to authenticated;
grant execute on function public.student_share_health_days(jsonb) to authenticated;
grant execute on function public.coach_student_health(uuid) to authenticated;
grant execute on function public.coach_student_weeks(uuid, integer) to authenticated;

-- ── Purge quotidienne (pg_cron, disponible sur Supabase ; absent du Postgres local des tests) ──
-- Jours de plus de 90 jours, pour l'élève qui n'ouvre plus l'app. Même nom = même tâche : rejouer ne la double pas.
do $cron$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-sante-coach-90-jours', '43 3 * * *',
      $job$delete from public.coach_shared_health_days where day < (now() at time zone 'utc')::date - 89$job$);
  end if;
end
$cron$;
