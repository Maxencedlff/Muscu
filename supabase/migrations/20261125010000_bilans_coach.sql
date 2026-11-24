-- ═══════════════════════════════════════════════════════════
--  Bilans configurables par le coach (24/11/2026, vocaux du coach et décision de Maxence : autant de bilans
--  qu'il veut, à la fréquence qu'il veut, avec tous les suivis du catalogue et ses propres questions, envoyés à
--  des élèves ou à des groupes). Contrat : docs/BILANS.md. ÉCRITE, PAS APPLIQUÉE : attend le feu vert de Maxence.
--  Retour arrière : supabase/rollback/20261125010000_bilans_coach_down.sql. Tests : tests/sql/bilans_coach_test.sql.
--
--  Validation : private.checkin_item_ok et private.checkin_value_ok acceptent exactement ce que js/data/checkins.js
--  rend tel quel (checkinItemClean, checkinValueClean) : une valeur est acceptée si et seulement si le nettoyage du
--  client la rendrait inchangée (forme canonique). Le serveur ne corrige rien dans les suivis ni dans les réponses :
--  ce que le client aurait corrigé (intitulé avec espaces en trop, nombre en texte, note d'un « non », photo en
--  double…) est refusé (invalid_template, invalid_answer). Les noms (modèle, groupe) et le retour du coach sont
--  nettoyés comme le fait le faux serveur (tests/fake_checkins.py), sur lequel l'appli web est testée.
--
--  Accès :
--  - Tables : RLS activée sans politique, aucun GRANT ; RPC security definer, search_path vide, utilisateur pris
--    dans auth.uid(), authenticated seulement (jamais anon).
--  - Le coach ne lit que ses élèves liés (coach_links), s'il est encore coach (private.is_coach), sans blocage
--    entre eux (private.blocked_between). L'élève ne voit que les demandes de son coach actuel, sans blocage.
--  - Tout ce qui touche un élève (demandes, réponses, retours, accord du cycle, groupes, plannings à son nom)
--    n'existe que sous un lien élève-coach : clé étrangère (student_id, coach_id) vers coach_links on delete
--    cascade. Quitter le coach, être retiré, supprimer un des deux comptes efface tout. Modèles et groupes
--    restent au coach (effacés avec son compte).
--  - Cycle menstruel : accord explicite de l'élève (student_checkin_cycle, déclaration « 18 ans ou plus »
--    exigée), lié à son coach actuel. Sans accord, le suivi n'est pas rendu à l'élève et une réponse est refusée
--    (no_consent) ; retirer l'accord efface toutes ses réponses au cycle.
--  - Photos : aucun stockage de plus. Une réponse photo cite des photos de bilan déjà envoyées par l'élève à ce
--    coach (public.coach_photos, état ready, chiffrées de bout en bout : 20261107000000_photos_bilan.sql).
--
--  Envoi : « À la demande » (coach_checkin_send_now, 30 envois par 24 h) ou planifié (private.checkin_tick, pg_cron
--  toutes les 15 min) : heure locale du planning (fuseau IANA), l'heure d'été ne décale rien ; planning de l'élève
--  prioritaire sur celui de son groupe pour un même modèle ; la demande non répondue de la période d'avant est
--  fermée (cancelled_at) ; rappel à remind_at. Chaque demande et chaque rappel passent par la file existante
--  private.push_outbox (types checkin et checkin_reminder, réglage « Mon coach » de l'élève, push_prefs.coach).
--  push-send doit connaître ces deux types AVANT cette migration (sinon la ligne est soldée sans envoi).
--  Purge quotidienne : bilans envoyés il y a plus de 24 mois.
--
--  Bornes : 50 modèles et 50 groupes par coach, 60 suivis par modèle, 500 membres par groupe, 30 envois à la
--  demande par 24 h glissantes (private.rate_limit_window « checkin_send »), retour du coach de 2 000 caractères.
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

-- Modèle de bilan du coach. items : suivis dans l'ordre choisi, forme canonique (private.checkin_items_ok).
-- version : + 1 à chaque changement des suivis (les demandes gardent la version de leur copie).
create table public.coach_checkin_templates (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  items      jsonb not null check (case when jsonb_typeof(items) = 'array' then jsonb_array_length(items) between 1 and 60 else false end),
  version    int not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, coach_id)   -- cible des clés étrangères des plannings (le modèle ET son coach)
);
create index coach_checkin_templates_coach on public.coach_checkin_templates (coach_id, created_at);

-- Groupe d'élèves du coach (« Prépa compétition »), et ses membres : élèves liés seulement
create table public.coach_groups (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (id, coach_id)
);
create index coach_groups_coach on public.coach_groups (coach_id, created_at);

create table public.coach_group_members (
  group_id   uuid not null,
  student_id uuid not null,
  coach_id   uuid not null,
  added_at   timestamptz not null default now(),
  primary key (group_id, student_id),
  foreign key (group_id, coach_id) references public.coach_groups (id, coach_id) on delete cascade,
  foreign key (student_id, coach_id) references public.coach_links (student_id, coach_id) on delete cascade
);
create index coach_group_members_link on public.coach_group_members (student_id, coach_id);

-- Planning d'un modèle pour un élève OU un groupe. weekday : 0 = dimanche (week, 2weeks) ; monthday : 1 à 28
-- (month) ; send_hour : heure locale dans timezone ; manual : jamais envoyé seul (next_at null).
-- next_at : prochain envoi (null en pause ou à la demande) ; last_at : dernier passage de l'envoi.
create table public.coach_checkin_schedules (
  id             uuid primary key default gen_random_uuid(),
  coach_id       uuid not null,
  template_id    uuid not null,
  student_id     uuid,
  group_id       uuid,
  freq           text not null check (freq in ('week', '2weeks', 'month', 'manual')),
  weekday        int not null default 0 check (weekday between 0 and 6),
  monthday       int not null default 1 check (monthday between 1 and 28),
  send_hour      int not null default 18 check (send_hour between 0 and 23),
  timezone       text not null default 'Europe/Paris' check (char_length(timezone) between 1 and 64),
  remind_after_h int check (remind_after_h between 1 and 168),
  due_after_h    int not null default 48 check (due_after_h between 1 and 336),
  paused_at      timestamptz,
  next_at        timestamptz,
  last_at        timestamptz,
  created_at     timestamptz not null default now(),
  constraint coach_checkin_schedules_target check (num_nonnulls(student_id, group_id) = 1),
  foreign key (template_id, coach_id) references public.coach_checkin_templates (id, coach_id) on delete cascade,
  foreign key (group_id, coach_id) references public.coach_groups (id, coach_id) on delete cascade,
  foreign key (student_id, coach_id) references public.coach_links (student_id, coach_id) on delete cascade,
  unique (template_id, student_id),
  unique (template_id, group_id)
);
create index coach_checkin_schedules_due on public.coach_checkin_schedules (next_at) where paused_at is null and next_at is not null;
create index coach_checkin_schedules_coach on public.coach_checkin_schedules (coach_id, created_at);
create index coach_checkin_schedules_link on public.coach_checkin_schedules (student_id, coach_id) where student_id is not null;
create index coach_checkin_schedules_group on public.coach_checkin_schedules (group_id, coach_id) where group_id is not null;

-- Demande envoyée à un élève : COPIE FIGÉE du modèle (name, items, template_version) au moment de l'envoi ;
-- modifier ou supprimer le modèle ne la change pas. Une seule demande ouverte par élève et par modèle.
create table public.coach_checkin_requests (
  id               uuid primary key default gen_random_uuid(),
  coach_id         uuid not null,
  student_id       uuid not null,
  template_id      uuid references public.coach_checkin_templates (id) on delete set null,
  schedule_id      uuid references public.coach_checkin_schedules (id) on delete set null,
  name             text not null check (char_length(name) between 1 and 60),
  items            jsonb not null check (case when jsonb_typeof(items) = 'array' then jsonb_array_length(items) between 1 and 60 else false end),
  template_version int not null default 1,
  period_start     date not null,
  sent_at          timestamptz not null default now(),
  due_at           timestamptz,
  remind_at        timestamptz,
  reminded_at      timestamptz,
  answered_at      timestamptz,
  cancelled_at     timestamptz,
  foreign key (student_id, coach_id) references public.coach_links (student_id, coach_id) on delete cascade
);
create unique index coach_checkin_requests_open on public.coach_checkin_requests (student_id, template_id)
  where answered_at is null and cancelled_at is null;
create index coach_checkin_requests_link on public.coach_checkin_requests (student_id, coach_id, sent_at desc);
create index coach_checkin_requests_coach on public.coach_checkin_requests (coach_id, sent_at desc);
create index coach_checkin_requests_sent on public.coach_checkin_requests (sent_at);
create index coach_checkin_requests_template on public.coach_checkin_requests (template_id) where template_id is not null;
create index coach_checkin_requests_schedule on public.coach_checkin_requests (schedule_id) where schedule_id is not null;
create index coach_checkin_requests_remind on public.coach_checkin_requests (remind_at)
  where remind_at is not null and reminded_at is null and answered_at is null and cancelled_at is null;

-- Réponse à un suivi (forme canonique, private.checkin_value_ok). Suivi passé : aucune ligne.
create table public.coach_checkin_answers (
  request_id uuid not null references public.coach_checkin_requests (id) on delete cascade,
  item_key   text not null check (item_key ~ '^(?:[a-z_]{3,20}|q[a-z0-9]{8})$'),
  value      jsonb not null,
  primary key (request_id, item_key)
);

-- Retour du coach sur un bilan répondu. sent_at null : brouillon (l'élève ne le voit pas). score : note du coach,
-- jamais rendue à l'élève.
create table public.coach_checkin_reviews (
  request_id  uuid primary key references public.coach_checkin_requests (id) on delete cascade,
  coach_id    uuid not null references auth.users(id) on delete cascade,
  reply       text not null default '' check (char_length(reply) <= 2000),
  score       int check (score between 1 and 10),
  reviewed_at timestamptz not null default now(),
  sent_at     timestamptz
);

-- Accord de l'élève pour le suivi du cycle menstruel, donné à SON coach actuel (effacé avec le lien)
create table public.checkin_cycle_consents (
  student_id        uuid primary key,
  coach_id          uuid not null,
  adult_declared_at timestamptz not null default now(),
  consented_at      timestamptz not null default now(),
  foreign key (student_id, coach_id) references public.coach_links (student_id, coach_id) on delete cascade
);

alter table public.coach_checkin_templates enable row level security;
alter table public.coach_groups enable row level security;
alter table public.coach_group_members enable row level security;
alter table public.coach_checkin_schedules enable row level security;
alter table public.coach_checkin_requests enable row level security;
alter table public.coach_checkin_answers enable row level security;
alter table public.coach_checkin_reviews enable row level security;
alter table public.checkin_cycle_consents enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.coach_checkin_templates, public.coach_groups, public.coach_group_members, public.coach_checkin_schedules,
  public.coach_checkin_requests, public.coach_checkin_answers, public.coach_checkin_reviews, public.checkin_cycle_consents
  from public, anon, authenticated, service_role;

-- Nouveaux types de la file des notifications (tous ceux d'avant, plus checkin et checkin_reminder)
alter table private.push_outbox drop constraint push_outbox_kind_check;
alter table private.push_outbox add constraint push_outbox_kind_check
  check (kind in ('reaction', 'follow_request', 'coach_note', 'coach_programme', 'comment', 'chat_message', 'student_session',
                  'student_digest', 'checkin', 'checkin_reminder'));

-- ── Validation (mêmes règles que js/data/checkins.js) ────

-- Catalogue fermé des suivis (CHECKIN_KINDS) : intitulé par défaut, types permis, unité, échelle par défaut,
-- suivis sensibles (jamais obligatoires)
create function private.checkin_kinds() returns jsonb
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

-- checkinLine : une ligne, caractères de contrôle remplacés, blancs (ceux de \s en JavaScript) réduits à une
-- espace, bords retirés, max_len caractères au plus (points de code, comme Array.from)
create function private.checkin_line(v text, max_len int) returns text
  language sql immutable set search_path = '' as
$$
  select btrim(left(btrim(regexp_replace(
           regexp_replace(coalesce(v, ''), '[\u0001-\u001f\u007f-\u009f]', ' ', 'g'),
           '[\u0009-\u000d    -     　﻿]+', ' ', 'g'), ' '), max_len), ' ')
$$;

-- trim() de JavaScript (blancs et fins de ligne aux deux bords)
create function private.checkin_trim(v text) returns text
  language sql immutable set search_path = '' as
$$
  select regexp_replace(v, '^[\u0009-\u000d    -     　﻿]+|[\u0009-\u000d    -     　﻿]+$', '', 'g')
$$;

-- checkinText : retours à la ligne gardés (\r\n et \r deviennent \n, 3 au plus d'affilée), autres contrôles
-- remplacés par une espace, espaces réduites, bords retirés, max_len caractères au plus
create function private.checkin_text(v text, max_len int) returns text
  language sql immutable set search_path = '' as
$$
  select private.checkin_trim(left(private.checkin_trim(
           regexp_replace(regexp_replace(
             regexp_replace(regexp_replace(coalesce(v, ''), '\r\n?', E'\n', 'g'), '[\u0001-\u0009\u000b-\u001f\u007f-\u009f]', ' ', 'g'),
             ' +', ' ', 'g'), '\n{4,}', E'\n\n\n', 'g')), max_len))
$$;

-- checkinItemClean : un suivi tel que le client le garde, ou null s'il est refusé
create function private.checkin_item_clean(raw jsonb) returns jsonb
  language plpgsql immutable set search_path = '' as
$$
declare
  k text;
  def jsonb;
  typ text;
  item_key text;
  lbl text;
  sensitive boolean;
  res jsonb;
  picked jsonb;
begin
  if raw is null or jsonb_typeof(raw) <> 'object' or jsonb_typeof(raw -> 'kind') is distinct from 'string' then return null; end if;
  k := raw ->> 'kind';
  if k <> 'custom' then
    def := private.checkin_kinds() -> k;
    if def is null then return null; end if;
  end if;
  if jsonb_typeof(raw -> 'type') is distinct from 'string'
     or not (coalesce(def -> 'types', '["scale", "yesno", "number", "text"]'::jsonb) ? (raw ->> 'type')) then
    return null;
  end if;
  typ := raw ->> 'type';
  if k = 'custom' then
    if jsonb_typeof(raw -> 'key') is distinct from 'string' or (raw ->> 'key') !~ '^q[a-z0-9]{8}$' then return null; end if;
    item_key := raw ->> 'key';
  else
    item_key := k;
  end if;
  lbl := case when jsonb_typeof(raw -> 'label') = 'string' then private.checkin_line(raw ->> 'label', 120) else '' end;
  if lbl = '' then lbl := coalesce(def ->> 'label', ''); end if;
  if lbl = '' then return null; end if;
  sensitive := coalesce(def -> 'sensitive' = 'true'::jsonb, false);
  res := jsonb_build_object('key', item_key, 'kind', k, 'label', lbl, 'type', typ,
                            'required', not sensitive and coalesce(raw -> 'required' = 'true'::jsonb, false));
  if typ = 'scale' then
    res := res || jsonb_build_object(
      'scale', case when raw -> 'scale' = '10'::jsonb then 10 when raw -> 'scale' = '5'::jsonb then 5
                    else coalesce((def ->> 'scale')::int, 5) end,
      'lo', coalesce(nullif(case when jsonb_typeof(raw -> 'lo') = 'string' then private.checkin_line(raw ->> 'lo', 30) else '' end, ''),
                     nullif(def ->> 'lo', ''), ''),
      'hi', coalesce(nullif(case when jsonb_typeof(raw -> 'hi') = 'string' then private.checkin_line(raw ->> 'hi', 30) else '' end, ''),
                     nullif(def ->> 'hi', ''), ''));
  end if;
  if typ = 'number' then
    res := res || jsonb_build_object('unit', case when def is not null then def ->> 'unit'
                                                  when jsonb_typeof(raw -> 'unit') = 'string' then private.checkin_line(raw ->> 'unit', 12)
                                                  else '' end);
  end if;
  if k = 'measures' then
    select jsonb_agg(m order by o) into picked
      from unnest(array['chest', 'waist', 'hips', 'shoulders', 'neck', 'armL', 'armR', 'thighL', 'thighR', 'calf']) with ordinality u(m, o)
      where jsonb_typeof(raw -> 'options' -> 'keys') = 'array' and (raw -> 'options' -> 'keys') ? m;
    if picked is null then return null; end if;
    res := res || jsonb_build_object('options', jsonb_build_object('keys', picked));
  end if;
  if k = 'photos' then
    select jsonb_agg(m order by o) into picked
      from unnest(array['face', 'side', 'back']) with ordinality u(m, o)
      where jsonb_typeof(raw -> 'options' -> 'poses') = 'array' and (raw -> 'options' -> 'poses') ? m;
    if picked is null then return null; end if;
    res := res || jsonb_build_object('options', jsonb_build_object('poses', picked));
  end if;
  return res;
end
$$;

-- Un suivi accepté : déjà sous la forme que lui donnerait checkinItemClean
create function private.checkin_item_ok(item jsonb) returns boolean
  language sql immutable set search_path = '' as
$$ select coalesce(private.checkin_item_clean(item) = item, false) $$;

-- Les suivis d'un modèle : 1 à 60, tous acceptés, sans clé en double (checkinItemsClean les rendrait inchangés)
create function private.checkin_items_ok(items jsonb) returns boolean
  language sql immutable set search_path = '' as
$$
  select case when jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 60 then
    coalesce((select bool_and(private.checkin_item_ok(e)) and count(distinct e ->> 'key') = count(*)
              from jsonb_array_elements(items) e), false)
  else false end
$$;

-- checkinNumber : un nombre JSON dans les bornes de son unité, arrondi (pas et minutes à l'unité, sinon au
-- centième) ; null sinon. Un nombre écrit en texte n'est jamais canonique (le client le convertit) : refusé.
create function private.checkin_number(v jsonb, unit text) returns numeric
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

-- checkinValueClean : la réponse que le client garderait pour ce suivi, ou null si elle est refusée. Ne sert qu'à
-- private.checkin_value_ok : un texte trop long (que le client couperait) est rendu null d'emblée.
create function private.checkin_value_clean(item jsonb, v jsonb) returns jsonb
  language plpgsql immutable set search_path = '' as
$$
declare
  typ text := item ->> 'type';
  t text;
  n numeric;
  d numeric;
  res jsonb;
begin
  if item is null or v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if typ = 'scale' then
    if jsonb_typeof(v) <> 'number' then return null; end if;
    n := (v #>> '{}')::numeric;
    return case when n = trunc(n) and n between 1 and (case when item -> 'scale' = '10'::jsonb then 10 else 5 end) then v end;
  elsif typ = 'yesno' then
    if jsonb_typeof(v) <> 'object' or jsonb_typeof(v -> 'yes') is distinct from 'boolean' then return null; end if;
    if jsonb_typeof(v -> 'note') = 'string' and char_length(v ->> 'note') > 4000 then return null; end if;
    t := case when v -> 'yes' = 'true'::jsonb and jsonb_typeof(v -> 'note') = 'string' then private.checkin_text(v ->> 'note', 1000) else '' end;
    return case when t <> '' then jsonb_build_object('yes', v -> 'yes', 'note', t) else jsonb_build_object('yes', v -> 'yes') end;
  elsif typ = 'text' then
    if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 4000 then return null; end if;
    t := private.checkin_text(v #>> '{}', 1000);
    return case when t <> '' then to_jsonb(t) end;
  elsif typ = 'number' and item ->> 'kind' = 'measures' then
    if jsonb_typeof(v) <> 'object' then return null; end if;
    select jsonb_object_agg(k, private.checkin_number(v -> k, 'cm')) into res
      from jsonb_array_elements_text(coalesce(item -> 'options' -> 'keys', '[]'::jsonb)) k
      where private.checkin_number(v -> k, 'cm') is not null;
    return res;
  elsif typ = 'number' then
    return to_jsonb(private.checkin_number(v, case when item ->> 'kind' = 'custom' then 'custom' else item ->> 'unit' end));
  elsif typ = 'photo' then
    if jsonb_typeof(v) <> 'object' or jsonb_typeof(v -> 'ids') is distinct from 'array' then return null; end if;
    select jsonb_agg(z.x order by z.o) into res from (
      select e #>> '{}' as x, min(o) as o
      from jsonb_array_elements(v -> 'ids') with ordinality a(e, o)
      where jsonb_typeof(e) = 'string' and (e #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      group by e #>> '{}'
      order by min(o) limit 9) z;
    return case when res is not null then jsonb_build_object('ids', res) end;
  elsif typ = 'auto' then
    if jsonb_typeof(v) <> 'object' or jsonb_typeof(v -> 'done') is distinct from 'number' or jsonb_typeof(v -> 'of') is distinct from 'number' then
      return null;
    end if;
    d := (v ->> 'done')::numeric;
    n := (v ->> 'of')::numeric;
    return case when d = trunc(d) and n = trunc(n) and d >= 0 and n >= 1 and d <= n and n <= 31
                then jsonb_build_object('done', v -> 'done', 'of', v -> 'of') end;
  elsif typ = 'choice' then
    return case when jsonb_typeof(v) = 'string' and (v #>> '{}') in ('menses', 'follicular', 'ovulation', 'luteal', 'unknown') then v end;
  end if;
  return null;
end
$$;

-- Une réponse acceptée : déjà sous la forme que lui donnerait checkinValueClean
create function private.checkin_value_ok(item jsonb, value jsonb) returns boolean
  language sql immutable set search_path = '' as
$$ select coalesce(private.checkin_value_clean(item, value) = value, false) $$;

-- ── Planification ────────────────────────────────────────

-- Premier envoi strictement après « after » : jour (weekday, ou monthday) et heure (send_hour) LOCAUX dans tz,
-- convertis en instant ; l'heure d'été ne décale donc jamais l'heure affichée. null pour manual.
create function private.checkin_next_at(freq text, weekday int, monthday int, send_hour int, tz text, after timestamptz)
  returns timestamptz
  language plpgsql stable set search_path = '' as
$$
declare
  d date;
  slot timestamptz;
begin
  if freq is null or freq not in ('week', '2weeks', 'month') then return null; end if;
  d := (after at time zone tz)::date;
  if freq = 'month' then
    d := make_date(extract(year from d)::int, extract(month from d)::int, monthday);
  else
    d := d + ((weekday - extract(dow from d)::int + 7) % 7);
  end if;
  slot := (d + make_interval(hours => send_hour)) at time zone tz;
  if slot <= after then
    d := case when freq = 'month' then (d + interval '1 month')::date else d + 7 end;
    slot := (d + make_interval(hours => send_hour)) at time zone tz;
  end if;
  return slot;
end
$$;

-- Envoi suivant celui de « slot » : 7 ou 14 jours locaux plus tard, ou le même jour du mois suivant
create function private.checkin_advance(freq text, monthday int, send_hour int, tz text, slot timestamptz) returns timestamptz
  language plpgsql stable set search_path = '' as
$$
declare d date := (slot at time zone tz)::date;
begin
  d := case freq when 'week' then d + 7
                 when '2weeks' then d + 14
                 else (make_date(extract(year from d)::int, extract(month from d)::int, monthday) + interval '1 month')::date end;
  return (d + make_interval(hours => send_hour)) at time zone tz;
end
$$;

-- Crée une demande (copie figée du modèle) et met sa notification en file ; null si le modèle n'est pas à ce
-- coach ou si une demande de ce modèle est déjà ouverte pour cet élève
create function private.checkin_open(coach uuid, student uuid, tpl uuid, sched uuid, sent timestamptz, due_h int, remind_h int,
                                     period date) returns uuid
  language plpgsql security definer set search_path = '' as
$$
declare
  t public.coach_checkin_templates%rowtype;
  rid uuid;
begin
  select * into t from public.coach_checkin_templates x where x.id = tpl and x.coach_id = coach;
  if t.id is null then return null; end if;
  insert into public.coach_checkin_requests as r (coach_id, student_id, template_id, schedule_id, name, items, template_version,
                                                  period_start, sent_at, due_at, remind_at)
    values (coach, student, t.id, sched, t.name, t.items, t.version, period, sent, sent + make_interval(hours => due_h),
            case when remind_h is not null then sent + make_interval(hours => remind_h) end)
    on conflict (student_id, template_id) where answered_at is null and cancelled_at is null do nothing
    returning r.id into rid;
  if rid is not null then perform private.push_enqueue(student, 'checkin', coach, rid::text); end if;
  return rid;
end
$$;

-- Passage de l'envoi planifié (pg_cron toutes les 15 min ; at_time : instant simulé par les tests). Pour chaque
-- planning dû : une demande par élève visé (élève du planning, ou membres du groupe qui n'ont pas leur propre
-- planning pour ce modèle), coach encore coach, sans blocage ; la demande non répondue d'une période d'avant est
-- fermée ; une demande déjà ouverte de cette période (autre groupe, envoi à la demande du jour) est gardée.
-- Puis next_at avance d'une période (plusieurs si l'envoi a été arrêté longtemps : jamais de rattrapage en
-- rafale). Enfin les rappels dus. Rend le nombre de demandes créées.
create function private.checkin_tick(at_time timestamptz default now()) returns int
  language plpgsql security definer set search_path = '' as
$$
declare
  s record;
  q record;
  st uuid;
  period date;
  nxt timestamptz;
  i int;
  n int := 0;
begin
  for s in
    select x.* from public.coach_checkin_schedules x
    where x.paused_at is null and x.next_at is not null and x.next_at <= at_time and x.freq <> 'manual'
    order by x.next_at, x.id
    for update skip locked
  loop
    period := (s.next_at at time zone s.timezone)::date;
    if private.is_coach(s.coach_id) then
      for st in
        select l.student_id from public.coach_links l
        where l.coach_id = s.coach_id
          and (l.student_id = s.student_id
               or (s.group_id is not null
                   and exists (select 1 from public.coach_group_members m where m.group_id = s.group_id and m.student_id = l.student_id)
                   and not exists (select 1 from public.coach_checkin_schedules y
                                   where y.template_id = s.template_id and y.student_id = l.student_id)))
          and not private.blocked_between(s.coach_id, l.student_id)
        order by l.student_id
      loop
        if exists (select 1 from public.coach_checkin_requests r
                   where r.student_id = st and r.template_id = s.template_id and r.answered_at is null and r.cancelled_at is null
                     and r.period_start >= period) then
          continue;
        end if;
        update public.coach_checkin_requests r set cancelled_at = at_time
          where r.student_id = st and r.template_id = s.template_id and r.answered_at is null and r.cancelled_at is null;
        if private.checkin_open(s.coach_id, st, s.template_id, s.id, at_time, s.due_after_h, s.remind_after_h, period) is not null then
          n := n + 1;
        end if;
      end loop;
    end if;
    nxt := private.checkin_advance(s.freq, s.monthday, s.send_hour, s.timezone, s.next_at);
    i := 0;
    while nxt <= at_time and i < 600 loop
      nxt := private.checkin_advance(s.freq, s.monthday, s.send_hour, s.timezone, nxt);
      i := i + 1;
    end loop;
    update public.coach_checkin_schedules x set next_at = nxt, last_at = at_time where x.id = s.id;
  end loop;

  for q in
    select r.id, r.student_id, r.coach_id from public.coach_checkin_requests r
    where r.remind_at is not null and r.remind_at <= at_time
      and r.reminded_at is null and r.answered_at is null and r.cancelled_at is null
    order by r.remind_at
    for update skip locked
  loop
    update public.coach_checkin_requests r set reminded_at = at_time where r.id = q.id;
    perform private.push_enqueue(q.student_id, 'checkin_reminder', q.coach_id, q.id::text);
  end loop;
  return n;
end
$$;

-- Purge quotidienne : bilans envoyés il y a plus de 24 mois (réponses et retours partent avec eux)
create function private.checkin_purge(at_time timestamptz default now()) returns int
  language plpgsql security definer set search_path = '' as
$$
declare n int;
begin
  delete from public.coach_checkin_requests r where r.sent_at < at_time - interval '24 months';
  get diagnostics n = row_count;
  return n;
end
$$;

-- ── Briques des RPC ──────────────────────────────────────

-- Le coach appelant (connecté, encore coach), sinon not_signed_in ou not_coach
create function private.checkin_coach() returns uuid
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  if not private.is_coach(me) then raise exception 'not_coach' using errcode = 'P0001'; end if;
  return me;
end
$$;

-- Élève lié à ce coach, sans blocage entre eux
create function private.checkin_my_student(coach uuid, student uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select coach is not null and student is not null
    and exists (select 1 from public.coach_links l where l.coach_id = coach and l.student_id = student)
    and not private.blocked_between(coach, student)
$$;

create function private.checkin_template_json(t public.coach_checkin_templates) returns jsonb
  language sql stable set search_path = '' as
$$
  select jsonb_build_object('id', t.id, 'name', t.name, 'items', t.items, 'version', t.version,
                            'created_at', t.created_at, 'updated_at', t.updated_at)
$$;

create function private.checkin_schedule_json(s public.coach_checkin_schedules) returns jsonb
  language sql stable set search_path = '' as
$$
  select jsonb_build_object('id', s.id, 'template_id', s.template_id, 'student_id', s.student_id, 'group_id', s.group_id,
                            'freq', s.freq, 'weekday', s.weekday, 'monthday', s.monthday, 'send_hour', s.send_hour,
                            'timezone', s.timezone, 'remind_after_h', s.remind_after_h, 'due_after_h', s.due_after_h,
                            'paused', s.paused_at is not null, 'next_at', s.next_at)
$$;

-- Groupe et ses membres (élèves encore liés : les autres sont partis avec leur lien)
create function private.checkin_group_json(g public.coach_groups) returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('id', g.id, 'name', g.name, 'members', coalesce((
    select jsonb_agg(m.student_id order by m.added_at, m.student_id)
    from public.coach_group_members m
    join public.coach_links l on l.student_id = m.student_id and l.coach_id = m.coach_id
    where m.group_id = g.id), '[]'::jsonb))
$$;

-- ── RPC du coach (authenticated seulement) ───────────────

-- Éditeur : { templates, schedules, groups }
create function public.coach_checkin_setup() returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := private.checkin_coach();
begin
  return jsonb_build_object(
    'templates', coalesce((select jsonb_agg(private.checkin_template_json(t) order by t.created_at, t.id)
                           from public.coach_checkin_templates t where t.coach_id = me), '[]'::jsonb),
    'schedules', coalesce((select jsonb_agg(private.checkin_schedule_json(s) order by s.created_at, s.id)
                           from public.coach_checkin_schedules s where s.coach_id = me), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(private.checkin_group_json(g) order by g.created_at, g.id)
                        from public.coach_groups g where g.coach_id = me), '[]'::jsonb));
end
$$;

-- Crée (id null, 50 au plus : too_many) ou remplace un modèle. Nom nettoyé (60 caractères) ; suivis refusés,
-- en double, plus de 60 ou aucun : invalid_template. version + 1 si les suivis changent. Pas à moi : not_found.
create function public.coach_template_save(id uuid, name text, items jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := private.checkin_coach();
  nm text := private.checkin_line(coach_template_save.name, 60);
  t public.coach_checkin_templates%rowtype;
begin
  if nm = '' or not private.checkin_items_ok(coach_template_save.items) then
    raise exception 'invalid_template' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('checkin_template:' || me::text, 0));
  if coach_template_save.id is null then
    if (select count(*) from public.coach_checkin_templates x where x.coach_id = me) >= 50 then
      raise exception 'too_many' using errcode = 'P0001';
    end if;
    insert into public.coach_checkin_templates (coach_id, name, items) values (me, nm, coach_template_save.items)
      returning * into t;
  else
    update public.coach_checkin_templates x
      set name = nm, items = coach_template_save.items, updated_at = now(),
          version = x.version + case when x.items = coach_template_save.items then 0 else 1 end
      where x.id = coach_template_save.id and x.coach_id = me
      returning * into t;
    if t.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  end if;
  return private.checkin_template_json(t);
end
$$;

-- Copie d'un de mes modèles, « Copie de … » (60 caractères), version 1
create function public.coach_template_duplicate(id uuid) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := private.checkin_coach();
  t public.coach_checkin_templates%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('checkin_template:' || me::text, 0));
  select * into t from public.coach_checkin_templates x where x.id = coach_template_duplicate.id and x.coach_id = me;
  if t.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if (select count(*) from public.coach_checkin_templates x where x.coach_id = me) >= 50 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;
  insert into public.coach_checkin_templates (coach_id, name, items)
    values (me, private.checkin_line('Copie de ' || t.name, 60), t.items)
    returning * into t;
  return private.checkin_template_json(t);
end
$$;

-- Supprime un de mes modèles : ses plannings partent (cascade), les bilans envoyés gardent leur copie
-- (template_id passe à null). Silencieux s'il n'existe pas.
create function public.coach_template_delete(id uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := private.checkin_coach();
begin
  delete from public.coach_checkin_templates x where x.id = coach_template_delete.id and x.coach_id = me;
end
$$;

-- Crée (50 au plus : too_many) ou remplace un groupe. Nom nettoyé (40 caractères ; vide : invalid_group).
-- Membres : mes élèves liés seulement (les autres ignorés), 500 au plus, dans l'ordre donné.
create function public.coach_group_save(id uuid, name text, members uuid[]) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := private.checkin_coach();
  nm text := private.checkin_line(coach_group_save.name, 40);
  g public.coach_groups%rowtype;
begin
  if nm = '' then raise exception 'invalid_group' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('checkin_group:' || me::text, 0));
  if coach_group_save.id is null then
    if (select count(*) from public.coach_groups x where x.coach_id = me) >= 50 then
      raise exception 'too_many' using errcode = 'P0001';
    end if;
    insert into public.coach_groups (coach_id, name) values (me, nm) returning * into g;
  else
    update public.coach_groups x set name = nm where x.id = coach_group_save.id and x.coach_id = me returning * into g;
    if g.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  end if;
  delete from public.coach_group_members m where m.group_id = g.id;
  insert into public.coach_group_members (group_id, student_id, coach_id, added_at)
    select g.id, z.u, me, now() + make_interval(secs => z.o / 1000000.0)
    from (select u, min(o) as o from unnest(coalesce(coach_group_save.members, '{}'::uuid[])) with ordinality a(u, o)
          where u is not null and exists (select 1 from public.coach_links l where l.student_id = u and l.coach_id = me)
          group by u order by min(o) limit 500) z;
  return private.checkin_group_json(g);
end
$$;

-- Supprime un de mes groupes (membres et plannings du groupe avec lui). Silencieux s'il n'existe pas.
create function public.coach_group_delete(id uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := private.checkin_coach();
begin
  delete from public.coach_groups x where x.id = coach_group_delete.id and x.coach_id = me;
end
$$;

-- Crée ou remplace le planning de ce modèle pour cet élève (mon élève lié, sans blocage) OU ce groupe.
-- Modèle, élève ou groupe pas à moi : not_found ; cible absente ou double, fréquence, bornes ou fuseau mauvais :
-- invalid_schedule. next_at recalculé (null en pause ou à la demande).
create function public.coach_schedule_save(template uuid, student uuid default null, grp uuid default null,
                                           freq text default 'week', weekday int default 0, monthday int default 1,
                                           send_hour int default 18, timezone text default 'Europe/Paris',
                                           remind_after_h int default null, due_after_h int default 48,
                                           paused boolean default false) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := private.checkin_coach();
  tz text := coalesce(nullif(btrim(coach_schedule_save.timezone), ''), 'Europe/Paris');
  pause boolean := coalesce(coach_schedule_save.paused, false);
  s public.coach_checkin_schedules%rowtype;
  nxt timestamptz;
begin
  if not exists (select 1 from public.coach_checkin_templates t where t.id = coach_schedule_save.template and t.coach_id = me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if num_nonnulls(coach_schedule_save.student, coach_schedule_save.grp) <> 1 then
    raise exception 'invalid_schedule' using errcode = 'P0001';
  end if;
  if coach_schedule_save.student is not null and not private.checkin_my_student(me, coach_schedule_save.student) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if coach_schedule_save.grp is not null
     and not exists (select 1 from public.coach_groups g where g.id = coach_schedule_save.grp and g.coach_id = me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if coach_schedule_save.freq is null or coach_schedule_save.freq not in ('week', '2weeks', 'month', 'manual')
     or coach_schedule_save.weekday is null or coach_schedule_save.weekday not between 0 and 6
     or coach_schedule_save.monthday is null or coach_schedule_save.monthday not between 1 and 28
     or coach_schedule_save.send_hour is null or coach_schedule_save.send_hour not between 0 and 23
     or coach_schedule_save.due_after_h is null or coach_schedule_save.due_after_h not between 1 and 336
     or (coach_schedule_save.remind_after_h is not null and coach_schedule_save.remind_after_h not between 1 and 168)
     or char_length(tz) > 64
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = tz) then
    raise exception 'invalid_schedule' using errcode = 'P0001';
  end if;
  nxt := case when pause then null
              else private.checkin_next_at(coach_schedule_save.freq, coach_schedule_save.weekday, coach_schedule_save.monthday,
                                           coach_schedule_save.send_hour, tz, now()) end;
  perform pg_advisory_xact_lock(hashtextextended('checkin_schedule:' || me::text, 0));
  update public.coach_checkin_schedules x
    set freq = coach_schedule_save.freq, weekday = coach_schedule_save.weekday, monthday = coach_schedule_save.monthday,
        send_hour = coach_schedule_save.send_hour, timezone = tz, remind_after_h = coach_schedule_save.remind_after_h,
        due_after_h = coach_schedule_save.due_after_h,
        paused_at = case when pause then coalesce(x.paused_at, now()) end, next_at = nxt
    where x.template_id = coach_schedule_save.template and x.coach_id = me
      and (x.student_id = coach_schedule_save.student or x.group_id = coach_schedule_save.grp)
    returning * into s;
  if s.id is null then
    insert into public.coach_checkin_schedules (coach_id, template_id, student_id, group_id, freq, weekday, monthday, send_hour,
                                                timezone, remind_after_h, due_after_h, paused_at, next_at)
      values (me, coach_schedule_save.template, coach_schedule_save.student, coach_schedule_save.grp, coach_schedule_save.freq,
              coach_schedule_save.weekday, coach_schedule_save.monthday, coach_schedule_save.send_hour, tz,
              coach_schedule_save.remind_after_h, coach_schedule_save.due_after_h, case when pause then now() end, nxt)
      returning * into s;
  end if;
  return private.checkin_schedule_json(s);
end
$$;

-- Supprime un de mes plannings. Silencieux s'il n'existe pas.
create function public.coach_schedule_delete(id uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  delete from public.coach_checkin_schedules x where x.id = coach_schedule_delete.id and x.coach_id = me;
end
$$;

-- « À la demande » : une demande tout de suite à chacun de ces élèves (mes élèves liés, sans blocage ; les
-- autres ignorés, 500 au plus) ; une demande déjà ouverte du même modèle n'est pas doublée. 30 envois par 24 h
-- glissantes (rate_limited). Rend { sent }.
create function public.coach_checkin_send_now(template uuid, students uuid[]) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := private.checkin_coach();
  st uuid;
  sent int := 0;
begin
  if not exists (select 1 from public.coach_checkin_templates t where t.id = coach_checkin_send_now.template and t.coach_id = me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.rate_limit_window(me, 'checkin_send', 30, interval '24 hours');
  for st in
    select z.u from (select u, min(o) as o from unnest(coalesce(coach_checkin_send_now.students, '{}'::uuid[])) with ordinality a(u, o)
                     where u is not null group by u order by min(o) limit 500) z
    order by z.o
  loop
    continue when not private.checkin_my_student(me, st);
    if private.checkin_open(me, st, coach_checkin_send_now.template, null, now(), 48, null,
                            (now() at time zone 'Europe/Paris')::date) is not null then
      sent := sent + 1;
    end if;
  end loop;
  return jsonb_build_object('sent', sent);
end
$$;

-- Tableau de bord, « Bilans reçus » : demandes des 35 derniers jours de mes élèves liés, sans blocage
create function public.coach_checkins_overview() returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := private.checkin_coach();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('request_id', r.id, 'student_id', r.student_id, 'name', r.name, 'sent_at', r.sent_at,
                                        'due_at', r.due_at, 'answered_at', r.answered_at, 'reviewed', v.sent_at is not null)
                     order by r.sent_at desc, r.id)
    from public.coach_checkin_requests r
    join public.coach_links l on l.student_id = r.student_id and l.coach_id = r.coach_id
    left join public.coach_checkin_reviews v on v.request_id = r.id
    where r.coach_id = me and r.sent_at > now() - interval '35 days' and not private.blocked_between(me, r.student_id)
  ), '[]'::jsonb);
end
$$;

-- Bilans d'un de mes élèves, du plus récent au plus ancien (lim : 1 à 52, 26 par défaut), avec réponses et
-- retour. Pas mon élève, bloqué, ou plus coach : not_found.
create function public.coach_student_checkins(student uuid, lim int default 26) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  perform private.coach_require_student(me, coach_student_checkins.student);
  if private.blocked_between(me, coach_student_checkins.student) then raise exception 'not_found' using errcode = 'P0001'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'template_id', r.template_id, 'student_id', r.student_id, 'name', r.name, 'items', r.items,
             'period_start', r.period_start, 'sent_at', r.sent_at, 'due_at', r.due_at, 'answered_at', r.answered_at,
             'cancelled_at', r.cancelled_at,
             'answers', coalesce((select jsonb_object_agg(a.item_key, a.value) from public.coach_checkin_answers a where a.request_id = r.id),
                                 '{}'::jsonb),
             'review', (select jsonb_build_object('reply', v.reply, 'score', v.score, 'reviewed_at', v.reviewed_at, 'sent', v.sent_at is not null)
                        from public.coach_checkin_reviews v where v.request_id = r.id))
           order by r.sent_at desc, r.id)
    from (select x.* from public.coach_checkin_requests x
          where x.coach_id = me and x.student_id = coach_student_checkins.student
          order by x.sent_at desc, x.id
          limit least(greatest(coalesce(coach_student_checkins.lim, 26), 1), 52)) r
  ), '[]'::jsonb);
end
$$;

-- Retour du coach sur un bilan répondu. reply nettoyé (2 000 caractères : too_long) ; score 1 à 10 ou null
-- (invalid_score) ; send faux : brouillon ; send vrai : l'élève le voit (reply vide : empty_reply), et il reste
-- envoyé ensuite. Pas répondu : not_answered ; pas mon élève, bloqué, ou plus coach : not_found.
create function public.coach_checkin_review(request uuid, reply text, score int, send boolean) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  rq public.coach_checkin_requests%rowtype;
  t text;
  v public.coach_checkin_reviews%rowtype;
  go boolean := coalesce(coach_checkin_review.send, false);
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  select * into rq from public.coach_checkin_requests x where x.id = coach_checkin_review.request and x.coach_id = me for update;
  if rq.id is null or not private.is_coach(me) or not private.checkin_my_student(me, rq.student_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if rq.answered_at is null then raise exception 'not_answered' using errcode = 'P0001'; end if;
  if char_length(coalesce(coach_checkin_review.reply, '')) > 20000 then raise exception 'too_long' using errcode = 'P0001'; end if;
  t := private.checkin_text(coalesce(coach_checkin_review.reply, ''), 2001);
  if char_length(t) > 2000 then raise exception 'too_long' using errcode = 'P0001'; end if;
  if coach_checkin_review.score is not null and coach_checkin_review.score not between 1 and 10 then
    raise exception 'invalid_score' using errcode = 'P0001';
  end if;
  if go and t = '' then raise exception 'empty_reply' using errcode = 'P0001'; end if;
  insert into public.coach_checkin_reviews as w (request_id, coach_id, reply, score, reviewed_at, sent_at)
    values (rq.id, me, t, coach_checkin_review.score, now(), case when go then now() end)
    on conflict (request_id) do update
      set reply = excluded.reply, score = excluded.score, reviewed_at = excluded.reviewed_at,
          sent_at = case when go then now() else w.sent_at end
    returning * into v;
  return jsonb_build_object('reply', v.reply, 'score', v.score, 'reviewed_at', v.reviewed_at, 'sent', v.sent_at is not null);
end
$$;

-- ── RPC de l'élève (authenticated seulement) ─────────────

-- Mes bilans chez mon coach actuel (sans blocage) : ouverts, puis les 5 derniers répondus. Le suivi du cycle
-- n'est rendu qu'avec mon accord ; la note du coach jamais ; son retour seulement une fois envoyé.
-- cycle.asked : sans mon accord, un bilan ouvert suit le cycle (sans dire lequel) : l'app peut proposer l'accord.
create function public.student_checkins() returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  coach uuid;
  consented boolean;
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  select l.coach_id into coach from public.coach_links l where l.student_id = me;
  consented := exists (select 1 from public.checkin_cycle_consents c where c.student_id = me and c.coach_id = coach);
  if coach is null or private.blocked_between(me, coach) then
    return jsonb_build_object('requests', '[]'::jsonb, 'cycle', jsonb_build_object('consented', consented, 'asked', false));
  end if;
  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'coach_id', r.coach_id, 'name', r.name,
               'items', coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(r.items) with ordinality z(e, o)
                                  where consented or e ->> 'kind' <> 'cycle'), '[]'::jsonb),
               'period_start', r.period_start, 'sent_at', r.sent_at, 'due_at', r.due_at, 'answered_at', r.answered_at,
               'review', (select jsonb_build_object('reply', v.reply, 'reviewed_at', v.sent_at)
                          from public.coach_checkin_reviews v where v.request_id = r.id and v.sent_at is not null))
             order by r.grp, r.sent_at desc, r.id)
      from ((select x.*, 0 as grp from public.coach_checkin_requests x
             where x.student_id = me and x.coach_id = coach and x.answered_at is null and x.cancelled_at is null)
            union all
            (select x.*, 1 as grp from public.coach_checkin_requests x
             where x.student_id = me and x.coach_id = coach and x.answered_at is not null
             order by x.sent_at desc, x.id limit 5)) r
    ), '[]'::jsonb),
    'cycle', jsonb_build_object('consented', consented, 'asked', not consented and exists (
      select 1 from public.coach_checkin_requests x, jsonb_array_elements(x.items) e
      where x.student_id = me and x.coach_id = coach and x.answered_at is null and x.cancelled_at is null and e ->> 'kind' = 'cycle')));
end
$$;

-- Répondre à un bilan (une seule fois) : { clé: valeur } des suivis répondus, chacun sous forme canonique ;
-- suivi inconnu, valeur refusée, photo qui n'est pas une de mes photos de bilan prêtes chez ce coach, suivi
-- obligatoire sans réponse : invalid_answer ; cycle sans mon accord : no_consent ; demande fermée : closed.
-- Idempotent : déjà répondue, rend la même date sans rien changer.
create function public.student_checkin_answer(request uuid, answers jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  rq public.coach_checkin_requests%rowtype;
  consented boolean;
  e record;
  it jsonb;
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  select * into rq from public.coach_checkin_requests x where x.id = student_checkin_answer.request and x.student_id = me for update;
  if rq.id is null or private.blocked_between(me, rq.coach_id)
     or not exists (select 1 from public.coach_links l where l.student_id = me and l.coach_id = rq.coach_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if rq.answered_at is not null then return jsonb_build_object('answered_at', rq.answered_at); end if;
  if rq.cancelled_at is not null then raise exception 'closed' using errcode = 'P0001'; end if;
  if student_checkin_answer.answers is null or jsonb_typeof(student_checkin_answer.answers) <> 'object' then
    raise exception 'invalid_answer' using errcode = 'P0001';
  end if;
  consented := exists (select 1 from public.checkin_cycle_consents c where c.student_id = me and c.coach_id = rq.coach_id);
  for e in select a.key, a.value from jsonb_each(student_checkin_answer.answers) a loop
    select x into it from jsonb_array_elements(rq.items) x where x ->> 'key' = e.key;
    if it is null or not private.checkin_value_ok(it, e.value) then raise exception 'invalid_answer' using errcode = 'P0001'; end if;
    if it ->> 'kind' = 'cycle' and not consented then raise exception 'no_consent' using errcode = 'P0001'; end if;
    if it ->> 'type' = 'photo' and exists (
         select 1 from jsonb_array_elements_text(e.value -> 'ids') pid
         where not exists (select 1 from public.coach_photos p
                           where p.id = pid::uuid and p.student_id = me and p.coach_id = rq.coach_id and p.state = 'ready')) then
      raise exception 'invalid_answer' using errcode = 'P0001';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(rq.items) x
             where x -> 'required' = 'true'::jsonb and not (student_checkin_answer.answers ? (x ->> 'key'))
               and (consented or x ->> 'kind' <> 'cycle')) then
    raise exception 'invalid_answer' using errcode = 'P0001';
  end if;
  insert into public.coach_checkin_answers (request_id, item_key, value)
    select rq.id, a.key, a.value from jsonb_each(student_checkin_answer.answers) a;
  update public.coach_checkin_requests x set answered_at = now() where x.id = rq.id returning * into rq;
  return jsonb_build_object('answered_at', rq.answered_at);
end
$$;

-- Accord pour le suivi du cycle menstruel, donné à mon coach actuel (pas de coach : not_found). Accepter exige
-- la déclaration « 18 ans ou plus » (adult vrai, sinon not_adult). Retirer efface l'accord ET toutes mes réponses
-- au cycle. Rend { consented }.
create function public.student_checkin_cycle(accept boolean, adult boolean default false) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  coach uuid;
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  select l.coach_id into coach from public.coach_links l where l.student_id = me;
  if coach is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if coalesce(student_checkin_cycle.accept, false) then
    if student_checkin_cycle.adult is not true then raise exception 'not_adult' using errcode = 'P0001'; end if;
    insert into public.checkin_cycle_consents (student_id, coach_id, adult_declared_at, consented_at)
      values (me, coach, now(), now())
      on conflict (student_id) do update
        set coach_id = excluded.coach_id, adult_declared_at = excluded.adult_declared_at, consented_at = excluded.consented_at;
    return jsonb_build_object('consented', true);
  end if;
  delete from public.checkin_cycle_consents c where c.student_id = me;
  delete from public.coach_checkin_answers a using public.coach_checkin_requests r
    where a.request_id = r.id and r.student_id = me and a.item_key = 'cycle';
  return jsonb_build_object('consented', false);
end
$$;

-- ── Notifications (file existante private.push_outbox) ───

-- Comme 20261117050000_messages_coach.sql, plus checkin et checkin_reminder : réglage « Mon coach »
create or replace function private.push_wanted(recipient uuid, kind text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select coalesce((select case kind
                            when 'reaction' then p.reactions
                            when 'follow_request' then p.follows
                            when 'coach_note' then p.coach
                            when 'coach_programme' then p.coach
                            when 'comment' then p.comments
                            when 'chat_message' then p.messages
                            when 'student_session' then p.student_sessions
                            when 'student_digest' then p.student_sessions
                            when 'checkin' then p.coach
                            when 'checkin_reminder' then p.coach
                            else false end
                   from public.push_prefs p where p.user_id = recipient), false)
$$;

-- Comme 20261117050000_messages_coach.sql, plus un bilan (demande ou rappel) : la demande est encore ouverte
-- (ni répondue ni fermée), envoyée par ce coach à cet élève, encore liés, coach encore coach, sans blocage
create or replace function private.push_valid(kind text, recipient uuid, actor uuid, ref text) returns boolean
  language plpgsql stable security definer set search_path = '' as
$$
declare
  rid bigint;
  c_author uuid; c_owner uuid; c_sid text; c_masked timestamptz;
  m_student uuid; m_coach uuid; m_from_coach boolean; m_read bigint;
begin
  if kind in ('checkin', 'checkin_reminder') then
    if ref is null or ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
    return private.is_coach(actor) and not private.blocked_between(recipient, actor)
      and exists (select 1 from public.coach_checkin_requests r
                  join public.coach_links l on l.student_id = r.student_id and l.coach_id = r.coach_id
                  where r.id = ref::uuid and r.student_id = recipient and r.coach_id = actor
                    and r.answered_at is null and r.cancelled_at is null);
  end if;
  if kind = 'student_digest' then return private.is_coach(recipient); end if;
  if kind = 'student_session' then
    return ref is not null and ref <> '' and private.is_coach(recipient)
      and exists (select 1 from public.coach_links l where l.student_id = actor and l.coach_id = recipient)
      and exists (select 1 from public.sessions x
                  where x.user_id = actor and x.id = ref and x.deleted_at is null
                    and x.done_at is not null and x.done_at <= private.max_done_at());
  end if;
  if kind not in ('comment', 'chat_message') then return true; end if;
  if ref is null or ref !~ '^[0-9]{1,18}$' then return false; end if;
  rid := ref::bigint;
  if kind = 'comment' then
    select c.author_id, c.session_owner, c.session_id, c.masked_at into c_author, c_owner, c_sid, c_masked
      from public.session_comments c where c.id = rid;
    return found and c_author = actor and c_owner = recipient and c_masked is null
      and private.comments_readable(recipient, recipient, c_sid)
      and private.comments_writable(actor, recipient, c_sid)
      and not exists (select 1 from public.comment_reports r where r.comment_id = rid and r.reporter_id = recipient);
  end if;
  select m.student_id, m.coach_id, m.from_coach,
         case when m.from_coach then l.chat_student_read else l.chat_coach_read end
    into m_student, m_coach, m_from_coach, m_read
    from public.coach_messages m
    join public.coach_links l on l.student_id = m.student_id and l.coach_id = m.coach_id
    where m.id = rid;
  return found
    and case when m_from_coach then actor = m_coach and recipient = m_student
             else actor = m_student and recipient = m_coach end
    and private.is_coach(m_coach)
    and rid > m_read
    and not exists (select 1 from public.chat_reports r
                    where r.reporter_id = recipient and r.student_id = m_student and r.coach_id = m_coach);
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.checkin_kinds() from public, anon, authenticated, service_role;
revoke all on function private.checkin_line(text, int) from public, anon, authenticated, service_role;
revoke all on function private.checkin_trim(text) from public, anon, authenticated, service_role;
revoke all on function private.checkin_text(text, int) from public, anon, authenticated, service_role;
revoke all on function private.checkin_item_clean(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.checkin_item_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.checkin_items_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.checkin_number(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function private.checkin_value_clean(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.checkin_value_ok(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.checkin_next_at(text, int, int, int, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.checkin_advance(text, int, int, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.checkin_open(uuid, uuid, uuid, uuid, timestamptz, int, int, date) from public, anon, authenticated, service_role;
revoke all on function private.checkin_tick(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.checkin_purge(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.checkin_coach() from public, anon, authenticated, service_role;
revoke all on function private.checkin_my_student(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.checkin_template_json(public.coach_checkin_templates) from public, anon, authenticated, service_role;
revoke all on function private.checkin_schedule_json(public.coach_checkin_schedules) from public, anon, authenticated, service_role;
revoke all on function private.checkin_group_json(public.coach_groups) from public, anon, authenticated, service_role;

revoke all on function public.coach_checkin_setup() from public, anon, authenticated, service_role;
revoke all on function public.coach_template_save(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.coach_template_duplicate(uuid) from public, anon, authenticated, service_role;
revoke all on function public.coach_template_delete(uuid) from public, anon, authenticated, service_role;
revoke all on function public.coach_group_save(uuid, text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.coach_group_delete(uuid) from public, anon, authenticated, service_role;
revoke all on function public.coach_schedule_save(uuid, uuid, uuid, text, int, int, int, text, int, int, boolean) from public, anon, authenticated, service_role;
revoke all on function public.coach_schedule_delete(uuid) from public, anon, authenticated, service_role;
revoke all on function public.coach_checkin_send_now(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.coach_checkins_overview() from public, anon, authenticated, service_role;
revoke all on function public.coach_student_checkins(uuid, int) from public, anon, authenticated, service_role;
revoke all on function public.coach_checkin_review(uuid, text, int, boolean) from public, anon, authenticated, service_role;
revoke all on function public.student_checkins() from public, anon, authenticated, service_role;
revoke all on function public.student_checkin_answer(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.student_checkin_cycle(boolean, boolean) from public, anon, authenticated, service_role;

grant execute on function public.coach_checkin_setup() to authenticated;
grant execute on function public.coach_template_save(uuid, text, jsonb) to authenticated;
grant execute on function public.coach_template_duplicate(uuid) to authenticated;
grant execute on function public.coach_template_delete(uuid) to authenticated;
grant execute on function public.coach_group_save(uuid, text, uuid[]) to authenticated;
grant execute on function public.coach_group_delete(uuid) to authenticated;
grant execute on function public.coach_schedule_save(uuid, uuid, uuid, text, int, int, int, text, int, int, boolean) to authenticated;
grant execute on function public.coach_schedule_delete(uuid) to authenticated;
grant execute on function public.coach_checkin_send_now(uuid, uuid[]) to authenticated;
grant execute on function public.coach_checkins_overview() to authenticated;
grant execute on function public.coach_student_checkins(uuid, int) to authenticated;
grant execute on function public.coach_checkin_review(uuid, text, int, boolean) to authenticated;
grant execute on function public.student_checkins() to authenticated;
grant execute on function public.student_checkin_answer(uuid, jsonb) to authenticated;
grant execute on function public.student_checkin_cycle(boolean, boolean) to authenticated;

-- ── Envoi planifié et purge (pg_cron, disponible sur Supabase ; absent du Postgres local des tests) ──
-- Même nom = même tâche : rejouer ne la double pas. Contrôle après : select jobname, schedule from cron.job
-- where jobname like 'bilans-coach-%'; (deux lignes)
do $cron$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('bilans-coach-envoi', '*/15 * * * *', $job$select private.checkin_tick()$job$);
    perform cron.schedule('bilans-coach-purge', '47 3 * * *', $job$select private.checkin_purge()$job$);
  end if;
end
$cron$;
