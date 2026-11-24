# Bilans configurables par le coach (vague 2 de l'appli web du coach)

Demande (vocaux du coach, 24/11/2026) et décision de Maxence : chaque coach crée **autant de bilans qu'il veut**, à
**la fréquence qu'il veut**, avec **tous les suivis disponibles** ; il coche, ordonne et adapte (échelles, questions
perso), puis envoie à des élèves ou à des groupes. Multiplateforme : l'éditeur est dans l'appli web du coach
(`coach-web/`, docs/COACH_WEB.md), l'élève remplit dans l'app iPhone. Maquette : `~/.local/share/mdlf/coach-web/maquette/`
(7-mes-bilans, 8-bilan-iphone, 3-bilan).

Branche `coach-bilans` (partie de `coach-web`). **Rien n'est appliqué en production** : migration, fonction push-send,
planification pg_cron et OTA attendent le feu vert de Maxence.

## Contrat

### Logique partagée : `js/data/checkins.js`

Chargé tel quel par l'app (`index.html`) et par l'appli web (`coach-web/index.html`). Catalogue fermé des suivis
(`CHECKIN_KINDS`), nettoyage d'un suivi (`checkinItemClean`) et d'une réponse (`checkinValueClean`) avec **les mêmes
règles que le serveur** (`private.checkin_item_ok`, `private.checkin_value_ok`), préremplissage (`checkinPrefill`),
textes (`checkinValueText`, `checkinScheduleText`, `checkinMinutes`), modèles fournis (`CHECKIN_STARTERS` : Hebdo,
Complet du mois, Express).

#### Un suivi (élément de `items`)

```
{ key, kind, label ≤ 120, type, required, scale?: 5|10, lo?, hi? (≤ 30), unit?, options? }
kind  : weight, measures, photos, diet_adherence, training_adherence, steps, cardio, pain, sleep, energy, hunger,
        stress, digestion, fatigue, mood, libido, cycle, ou custom (question libre)
key   : = kind pour le catalogue ; « q » + 8 caractères [a-z0-9] pour une question libre
type  : permis par sorte (CHECKIN_KINDS[].types) ; question libre : scale | yesno | number | text
unit  : kg (weight), cm (measures), steps (pas par jour), min (cardio) ; question libre « nombre » : texte ≤ 12
options : measures { keys: sous-ensemble de BODY_MEASURE_KEYS, au moins une } ; photos { poses: face|side|back, au moins une }
required : jamais pour les suivis sensibles (pain, libido, cycle) : « Passer » toujours possible
```

#### Une réponse (valeur par clé)

| type | valeur | bornes |
|---|---|---|
| scale | entier | 1 à `scale` |
| yesno | `{ yes, note? }` | note ≤ 1000, seulement si oui |
| number | nombre | kg 25 à 300, cm 10 à 250, pas 0 à 100 000, min 0 à 10 080, libre ± 1 000 000 |
| number (measures) | `{ clé: cm }` | au moins une mensuration de `options.keys` |
| text | texte | 1 à 1000 caractères |
| photo | `{ ids: [uuid] }` | 1 à 9 photos de bilan **déjà envoyées** (`coach_photos`, état `ready`, de cet élève pour ce coach) |
| auto | `{ done, of }` | 0 ≤ done ≤ of, 1 ≤ of ≤ 31 |
| choice (cycle) | `menses` \| `follicular` \| `ovulation` \| `luteal` \| `unknown` | accord de l'élève exigé |

Un suivi passé n'a pas de réponse (aucune ligne). Une réponse invalide est **refusée** (`invalid_answer`), jamais tronquée.

### Serveur : `supabase/migrations/20261125010000_bilans_coach.sql`

Tables (schéma `public`, RLS activée **sans politique**, **aucun GRANT** client ; tout passe par les RPC) :

```
coach_checkin_templates  id, coach_id → auth.users cascade, name, items jsonb, version, created_at, updated_at
coach_groups             id, coach_id, name, created_at
coach_group_members      group_id → coach_groups cascade, student_id, coach_id ; (student_id, coach_id) → coach_links cascade
coach_checkin_schedules  id, coach_id, template_id → templates cascade, student_id | group_id (un seul),
                         freq week|2weeks|month|manual, weekday 0-6 (0 = dimanche), monthday 1-28, send_hour 0-23,
                         timezone (IANA), remind_after_h 1-168 | null, due_after_h 1-336, paused_at, next_at, last_at
                         (élève : (student_id, coach_id) → coach_links cascade ; unique (template_id, student_id), (template_id, group_id))
coach_checkin_requests   id, coach_id, student_id, template_id → templates set null, schedule_id → schedules set null,
                         name, items jsonb (COPIE FIGÉE), template_version, period_start date, sent_at, due_at,
                         remind_at, reminded_at, answered_at, cancelled_at ; (student_id, coach_id) → coach_links cascade
coach_checkin_answers    request_id → requests cascade, item_key, value jsonb ; PK (request_id, item_key)
coach_checkin_reviews    request_id → requests cascade (PK), coach_id, reply ≤ 2000, score 1-10 | null, reviewed_at, sent_at
checkin_cycle_consents   student_id (PK), coach_id, adult_declared_at, consented_at ; (student_id, coach_id) → coach_links cascade
```

RPC (toutes `security definer`, `search_path = ''`, utilisateur pris dans `auth.uid()`, `authenticated` seulement,
jamais `anon`). Erreurs en `P0001` avec le message : `not_signed_in`, `not_coach`, `not_found`, `invalid_template`,
`invalid_answer`, `too_many`, `rate_limited`, `already_answered`, `closed`, `no_consent`, `not_adult`, `too_long`.

Coach (vérifie `private.is_coach(me)` ; pour un élève, `private.coach_require_student` et aucun blocage entre les deux) :

| RPC | Rend |
|---|---|
| `coach_checkin_setup()` | `{ templates: [{ id, name, items, version, created_at, updated_at }], schedules: [{ id, template_id, student_id, group_id, freq, weekday, monthday, send_hour, timezone, remind_after_h, due_after_h, paused, next_at }], groups: [{ id, name, members: [uuid] }] }` (membres encore liés seulement) |
| `coach_template_save(id uuid, name text, items jsonb)` | le modèle ; `id` null = nouveau (50 au plus : `too_many`) ; `version` + 1 si les suivis changent ; `invalid_template` si un suivi est refusé ou s'il n'y en a aucun |
| `coach_template_duplicate(id uuid)` | le nouveau modèle, « Copie de … » (60 caractères au plus) |
| `coach_template_delete(id uuid)` | null ; ses plannings partent ; les bilans déjà envoyés gardent leur copie |
| `coach_group_save(id uuid, name text, members uuid[])` | le groupe ; membres = mes élèves liés seulement (les autres ignorés) ; 50 groupes, 500 membres |
| `coach_group_delete(id uuid)` | null |
| `coach_schedule_save(template uuid, student uuid, grp uuid, freq text, weekday int, monthday int, send_hour int, timezone text, remind_after_h int, due_after_h int, paused boolean)` | le planning (créé ou remplacé pour ce modèle et cette cible) ; `next_at` recalculé |
| `coach_schedule_delete(id uuid)` | null |
| `coach_checkin_send_now(template uuid, students uuid[])` | `{ sent }` : demandes créées tout de suite (« À la demande ») ; 30 envois par 24 h (`rate_limited`) ; une demande déjà ouverte du même modèle n'est pas doublée |
| `coach_checkins_overview()` | `[{ request_id, student_id, name, sent_at, due_at, answered_at, reviewed: bool }]` : demandes des 35 derniers jours de mes élèves liés, non bloqués (tableau de bord, « Bilans reçus ») |
| `coach_student_checkins(student uuid, lim int default 26)` | `[{ id, template_id, name, items, period_start, sent_at, due_at, answered_at, cancelled_at, answers: { clé: valeur }, review: { reply, score, reviewed_at, sent } \| null }]`, du plus récent au plus ancien |
| `coach_checkin_review(request uuid, reply text, score int, send boolean)` | la review ; `send` false = brouillon ; `send` true : l'élève la voit (`student_checkins`) ; l'appli web poste aussi la réponse dans la conversation par `chat_send` |

Élève :

| RPC | Rend |
|---|---|
| `student_checkins()` | `{ requests: [{ id, coach_id, name, items, period_start, sent_at, due_at, answered_at, review: { reply, reviewed_at } \| null }], cycle: { consented: bool } }` : demandes ouvertes (non répondues, non annulées) et les 5 dernières répondues, de mon coach actuel, sans blocage. Le suivi `cycle` n'est dans `items` que si j'ai donné mon accord. Note du coach (`score`) jamais rendue à l'élève |
| `student_checkin_answer(request uuid, answers jsonb)` | `{ answered_at }` ; **idempotent** : déjà répondue, rend la même date sans rien changer ; `closed` si annulée ; `invalid_answer` ; `no_consent` pour un cycle sans accord ; photos vérifiées dans `coach_photos` |
| `student_checkin_cycle(accept boolean, adult boolean)` | `{ consented }` ; accepter exige `adult = true` (`not_adult` sinon) ; retirer efface l'accord **et toutes mes réponses au cycle** |

Planification (pg_cron, toutes les 15 min, `private.checkin_tick()`) : crée les demandes dues (heure locale du
planning, `timezone` ; l'heure d'été ne décale rien), une par élève (planning de l'élève prioritaire sur celui de son
groupe pour un même modèle), ferme la demande non répondue de la période d'avant (`cancelled_at`), envoie le rappel
(`remind_at` passé, pas répondu, pas encore rappelé). Chaque nouvelle demande et chaque rappel passent par la file
existante `private.push_outbox` (types `checkin` et `checkin_reminder`, réglage « Mon coach » de l'élève,
`push_prefs.coach`). Purge quotidienne : bilans de plus de 24 mois.

Effacement : quitter le coach, être retiré, supprimer son compte efface demandes, réponses, retours, accord du cycle,
appartenance aux groupes et plannings de cet élève (clés étrangères vers `coach_links` on delete cascade). Les
modèles et groupes restent chez le coach.

### Notifications : `supabase/functions/push-send/push-policy.js`

Deux types de plus, à déployer **avant** la migration (sinon les lignes sont soldées sans envoi) :
`checkin` « Bilan à remplir » / « <coach> t'a demandé ton bilan » ; `checkin_reminder` « Rappel : ton bilan » /
« <coach> attend ton bilan ». `ref` : l'id de la demande. App : toucher ouvre l'écran du bilan (`js/data/push.js`).
