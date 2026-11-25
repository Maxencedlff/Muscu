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
`invalid_answer`, `too_many`, `rate_limited`, `already_answered`, `closed`, `no_consent`, `not_adult`, `too_long`,
et, comme le faux serveur (`tests/fake_checkins.py`) : `invalid_group`, `invalid_schedule`, `not_answered`,
`invalid_score`, `empty_reply`. (`already_answered` n'est jamais levée : répondre deux fois rend la même date.)

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
| `student_checkins()` | `{ requests: [{ id, coach_id, name, items, period_start, sent_at, due_at, answered_at, review: { reply, reviewed_at } \| null }], cycle: { consented: bool, asked: bool } }` : demandes ouvertes (non répondues, non annulées) et les 5 dernières répondues, de mon coach actuel, sans blocage. Le suivi `cycle` n'est dans `items` que si j'ai donné mon accord. Note du coach (`score`) jamais rendue à l'élève. `asked` : sans mon accord, au moins une demande ouverte de mon coach contient le suivi `cycle` (l'item, lui, reste absent) ; faux avec l'accord, sans coach ou avec un blocage |
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

#### Migration écrite (24/11/2026) : précisions et écarts avec ce qui précède

Vérifiée par `tests/sql/bilans_coach_test.sql` (droits, validation, plannings, effacement, notifications) et
`tests/sql/bilans_coach_rollback_test.sh`.

- **Validation** : `private.checkin_item_ok` et `private.checkin_value_ok` acceptent une valeur si et seulement si
  `checkinItemClean` / `checkinValueClean` la rendraient **inchangée** (forme canonique). Le serveur ne corrige rien
  dans les suivis ni dans les réponses : intitulé avec des espaces en trop, nombre écrit en texte (`"70"`), note d'un
  « non », photo en double, texte de plus de 1 000 caractères… sont refusés (`invalid_template`, `invalid_answer`),
  là où le client les aurait corrigés. Le client envoie toujours la forme nettoyée, donc rien ne change pour lui.
  169 cas comparés à `js/data/checkins.js` dans le test SQL (attendu calculé par `checkins.js`). Seul écart connu,
  sans effet : un nombre JSON écrit avec plus de 15 décimales que JavaScript arrondirait au centième près est
  refusé par le serveur.
- **Noms et retour du coach nettoyés** par le serveur, comme le faux : nom de modèle (`checkinLine`, 60), de groupe
  (40, vide : `invalid_group`), retour (`checkinText`, 2 000, au-delà : `too_long`). « Copie de … » est nettoyé aussi.
- **Erreurs** comme le faux : `coach_student_checkins` et `coach_checkin_review` rendent `not_found` (pas
  `not_coach`) à un compte qui n'est pas coach ; `coach_checkin_review` sur un bilan pas répondu : `not_answered` ;
  `coach_schedule_save` : `invalid_schedule` (cible absente ou double, fréquence, bornes, fuseau inconnu de
  `pg_timezone_names`) et `not_found` (modèle, élève non lié ou bloqué, groupe pas à moi) ; `student_checkin_cycle`
  sans coach : `not_found`.
- `coach_template_delete`, `coach_group_delete`, `coach_schedule_delete` rendent `void` (null côté client) ;
  `coach_schedule_delete` ne demande pas le rôle de coach (un ex-coach peut retirer ses plannings).
- `coach_schedule_save` : tous les paramètres après `template` ont une valeur par défaut (`student` et `grp` null,
  `week`, dimanche, le 1er, 18 h, `Europe/Paris`, sans rappel, 48 h, pas en pause). Le planning existant pour ce
  modèle et cette cible est remplacé (même `id`).
- `coach_group_save` : au-delà de 500 membres, les suivants sont ignorés (pas de `too_many`), comme le faux ; ordre
  donné gardé.
- `coach_checkin_send_now` : 500 élèves au plus par appel ; échéance 48 h, pas de rappel, période = date du jour à
  Paris ; l'appel compte pour la limite des 30 par 24 h même s'il n'envoie rien.
- `coach_student_checkins` rend aussi `student_id` (comme le faux).
- `student_checkins` rend `cycle: { consented, asked }` : `asked` vrai si, sans accord, un bilan ouvert de mon coach
  suit le cycle (sans dire lequel), pour que l'app propose l'accord (proposition de l'app de l'élève, déjà dans le
  faux). Faux sans coach ou avec un blocage.
- **Planification** (`private.checkin_tick(at_time timestamptz default now())`, l'instant est simulé par les tests) :
  le planning de l'élève l'emporte sur celui de son groupe pour un même modèle **même s'il est en pause ou « À la
  demande »** ; une demande ouverte de la même période (autre groupe, envoi à la demande du jour) est gardée et rien
  n'est recréé ; coach qui a perdu son rôle : aucune demande, mais le planning avance ; envoi arrêté plusieurs
  périodes : une seule demande, puis `next_at` reprend dans le futur (pas de rattrapage en rafale). `2weeks` : toutes
  les deux semaines à partir du premier envoi. Échéance et rappel comptés depuis le passage de l'envoi.
- **Tables** : 8 (la liste ci-dessus, `coach_group_members` comprise). Plannings, membres et modèles liés par des clés
  étrangères composées (`(template_id, coach_id)`, `(group_id, coach_id)`) : un planning ne peut viser que les modèles
  et groupes de son coach. Une seule demande ouverte par élève et par modèle (index unique partiel).
- **Notifications** : `private.push_wanted` (types `checkin`, `checkin_reminder` → `push_prefs.coach`),
  `private.push_valid` (demande ouverte, envoyée par ce coach à cet élève, encore liés, coach encore coach, sans
  blocage) et la contrainte `push_outbox_kind_check` sont redéfinis à partir de `20261117050000_messages_coach.sql` ;
  `private.push_enqueue` et `public.push_claim` ne changent pas (`ref` rendu tel quel, `actor_name` = pseudo du coach).
- **pg_cron** : tâches `bilans-coach-envoi` (`*/15 * * * *`, `select private.checkin_tick()`) et `bilans-coach-purge`
  (`47 3 * * *`, `select private.checkin_purge()`), posées seulement si l'extension est disponible (comme
  `20261118010000_suivi_diete_coach.sql`).

### Notifications : `supabase/functions/push-send/push-policy.js`

Deux types de plus, à déployer **avant** la migration (sinon les lignes sont soldées sans envoi) :
`checkin` « Bilan à remplir » / « <coach> t'a demandé ton bilan » ; `checkin_reminder` « Rappel : ton bilan » /
« <coach> attend ton bilan ». `ref` : l'id de la demande. App : toucher ouvre l'écran du bilan (`js/data/push.js`).

## Mise en production

Rien n'est appliqué : chaque étape attend le feu vert de Maxence. La production a déjà `20261107000000_photos_bilan.sql`
et `20261117050000_messages_coach.sql`, dont cette migration reprend `push_wanted`, `push_valid` et la contrainte de la
file ; elle est indépendante de `20261124010000_semaines_coach.sql`.

1. **`push-send` d'abord** (elle doit connaître `checkin` et `checkin_reminder`, sinon une ligne de la file est soldée
   sans envoi) : `supabase functions deploy push-send --use-api --yes`, puis vérifier `verify_jwt = false` inchangé.
2. **La migration**, collée dans l'éditeur SQL (ou l'API de gestion) dans une transaction :
   `begin;` + contenu de `supabase/migrations/20261125010000_bilans_coach.sql` + `commit;`. Jamais `supabase db push`
   (supabase/rollback/ORDRE.md).
3. **Vérifier la planification** :
   `select jobname, schedule, command, active from cron.job where jobname like 'bilans-coach-%' order by jobname;`
   → deux lignes, `bilans-coach-envoi` (`*/15 * * * *`) et `bilans-coach-purge` (`47 3 * * *`). Puis, après le
   premier quart d'heure : `select status, return_message from cron.job_run_details where jobid = (select jobid from
   cron.job where jobname = 'bilans-coach-envoi') order by start_time desc limit 3;` → `succeeded`.
4. Contrôles en lecture : `select count(*) from public.coach_checkin_templates;` (0), droits :
   `select has_function_privilege('anon', 'public.student_checkins()', 'execute');` (faux).
5. Puis l'appli web du coach et l'OTA de l'app (une app d'avant ignore les bilans ; une app à jour sur un serveur
   d'avant reçoit PGRST202 et ne les montre pas).

## Retour arrière

OTA et appli web d'avant, puis `supabase/rollback/20261125010000_bilans_coach_down.sql` dans l'éditeur SQL (il a son
`begin; … commit;`). Il **efface** modèles, groupes, plannings, demandes, réponses, retours et accords du cycle (rien
n'est mis de côté : données de santé), retire les notifications `checkin` et `checkin_reminder` en file, remet
`push_wanted`, `push_valid` et la contrainte de `20261117050000_messages_coach.sql`, retire les deux tâches pg_cron.
Les photos de bilan ne sont pas touchées. `push-send` peut rester. À défaire **avant** tout retour arrière plus ancien,
en particulier `20261117050000`, `20261116020000` (notifications) et `20261107000000` (photos), dont il dépend.
Vérifié par `tests/sql/bilans_coach_rollback_test.sh` (pg_dump complet identique à la base d'avant).

## App iPhone (élève)

Fichiers : `js/data/checkin-student.js` (données, sans affichage), `js/features/checkin-ui.js` (carte d'accueil, écran,
accord du cycle), `css/checkin.css`. Carte posée dans `renderDashboard` (`js/features/dashboard.js`), ouverture par
notification dans `pushTarget` (`js/data/push.js`). Tests : `tests/unit/checkins-eleve.mjs`, `tests/test_bilans_eleve.py`.
Tout est en JS et CSS (passe par OTA), mais c'est une **fonction nouvelle** : d'après NOTE.md (règles 2.5.2 et
2.3.1(a) d'Apple), elle doit partir dans une build soumise à Apple, pas par OTA seule.

### Lecture et cache

- `student_checkins()` relu à chaque lecture réussie de `coach_state` (démarrage, retour au premier plan, ouverture de
  Mon coach, notification reçue), une minute au plus près, à l'ouverture de l'écran du bilan (30 s) et quand le réseau
  revient. Serveur sans la fonction (PGRST202) : rien ne s'affiche, nouvel essai après 10 min.
- Gardé sur l'appareil, par compte : `mdlf_checkins` (dernière réponse du serveur), `mdlf_checkin_drafts` (brouillons,
  10 au plus), `mdlf_checkin_outbox` (envois en attente du réseau), `mdlf_checkin_sent` (mes 5 derniers envois, pour le
  récapitulatif : le serveur ne rend pas les réponses à l'élève), `mdlf_checkin_seen` (réponses du coach lues).
  **Tout est effacé à la déconnexion et quand l'élève n'a plus de coach** (réponses de santé, nom et réponse du coach).
  Ces clés ne sont pas dans `CROSS_USER_CACHE_KEYS` (js/data/account.js n'est pas à ce chantier) : le module les
  efface lui-même sur `onAccountChange`. Les y ajouter serait plus sûr pour `accountForgetDevice`.
- Liste d'un ancien coach jamais montrée (`checkinList` filtre sur `myCoach()`).

### Préremplissage (`checkinContext`, puis `checkinPrefill` de checkins.js)

- Période : les N jours qui finissent le jour de l'envoi (inclus) ; N = écart avec le bilan précédent du même nom, de 7
  à 31 jours, 7 sans bilan précédent. Le contrat ne donne ni la fréquence ni la fin de période : à revoir si le serveur
  rend `period_start` comme début réel de période. En-tête : « Semaine 47 » seulement si la période est une semaine du
  calendrier (lundi à dimanche), sinon « Du 18 au 24 nov. » (les chiffres comptés ne mentent pas sur les jours).
- Poids : dernière pesée de l'app (`sharedWeightsPayload`) ; mensurations : dernière valeur de chaque mensuration
  demandée (`sharedMeasuresPayload`) ; diète : statut `dietShareStatus` de chaque jour de la période
  (`dietShareDay`), rien de prérempli si aucun jour n'a rien de noté ; séances : séances de l'historique dans la
  période sur `weeklyGoal()` × jours / 7 ; pas : **à remplir à la main** (voir « Natif »).
- Le brouillon passe avant le préremplissage, seulement pour les réponses touchées : une nouvelle pesée met à jour un
  poids que l'élève n'a pas corrigé.

### Écran (`checkin:ID`)

- Barre « Plus tard » / nom du bilan / « Envoyer » ; en-tête « <coach> t'a demandé ton bilan », période, durée
  (`checkinMinutes`), date limite. Rubriques : Corps, Photos, Ta semaine, Plan et activité, Question(s) du coach ;
  dans une rubrique, l'ordre du coach.
- Nombres : clavier décimal (entier pour pas et minutes), unité visible, hors bornes dit sous le champ et rien ne
  part. Échelles 1-5 ou 1-10 (deux lignes de 5) en `radiogroup`, `aria-checked`, bornes lues (« 1 sur 5, Mal »).
  Oui/non : précision facultative si oui. Automatique : valeur en orange, corrigée par une fenêtre (`askNumber`).
- « Passer » sur tout suivi facultatif, « Obligatoire » sinon ; un obligatoire vide est montré et rien ne part.
- Envoi : confirmation (« Une fois envoyé, ton bilan ne se modifie plus », suivis passés comptés), puis état « Envoyé »
  avec le récapitulatif ; la réponse du coach (`review.reply`) s'y affiche quand elle arrive, et une carte « <coach> a
  répondu à ton bilan » sur l'accueil tant qu'elle n'est pas lue. La note du coach n'est jamais montrée.
- Envoi idempotent : un appel à la fois par demande, rien si elle est déjà répondue ou en file ; la réponse est écrite
  dans `mdlf_checkin_outbox` avant l'appel. Hors ligne : « En attente du réseau », renvoyée au retour du réseau ou à
  la lecture suivante. Refus du serveur (`closed`, `invalid_answer`, `no_consent`) : dit à l'élève, le brouillon reste.
- Photos : le circuit existant (coffre › « Envoyer à mon coach » › `cphSend`, chiffrement inchangé). Une tuile par
  pose demandée ; « + » ouvre le coffre sur la feuille d'envoi (`pvSendToCoach`) ; au retour, les photos envoyées au
  coach depuis l'arrivée de la demande (un jour de marge) sont jointes (`{ ids }`, 9 au plus). Tranche d'âge Apple
  autre que 18 ans ou plus, réception pas activée par le coach, navigateur : la rubrique le dit et se passe.
- Cycle menstruel : jamais proposé ni montré si `currentAgeBand()` est connue et autre que `adult`. Sinon, accord dans
  une feuille : ce que voit le coach, depuis quand, comment retirer, case « J'ai 18 ans ou plus » à cocher avant que le
  bouton s'active → `student_checkin_cycle(true, true)`. « Retirer mon accord » dans le suivi → confirmation →
  `student_checkin_cycle(false)` ; les phases des brouillons sont effacées.
- Ce que voit le coach, écrit sous le bilan : ses réponses dès l'envoi avec leur date, rien avant, un suivi passé n'est
  pas envoyé, tout lui est retiré si l'élève le quitte.

### Proposer le cycle

`student_checkins` retire le suivi `cycle` des `items` tant que l'élève n'a pas donné son accord ; il rend
`cycle.asked` (vrai si un bilan ouvert de mon coach contient le suivi, sans rien dire de plus, faux après l'accord,
sans coach ou avec un blocage ; testé dans tests/sql/bilans_coach_test.sql). L'app propose alors l'accord dans le
bilan. Mon coach a aussi sa cellule « Bilans » (`checkinMineCellHtml`) avec « Cycle menstruel » pour donner ou retirer
l'accord. Les clés de l'appareil (`mdlf_checkins`, `mdlf_checkin_drafts`, `mdlf_checkin_outbox`, `mdlf_checkin_sent`)
sont effacées avec les données de l'appareil (`accountForgetDevice`).

### Accord daté et questions réservées aux 18 ans (`20261127030000_bilans_accord_majeur.sql`, PAS appliquée)

- **Accord daté** (RGPD art. 9.2.a) : au premier envoi, une feuille « Accord pour tes bilans » : « Tu acceptes d'envoyer
  à <coach> tes réponses de bilan (données de santé) », hébergées chez Supabase (UE), « J'accepte » ou « Annuler » (rien ne part).
  `student_checkin_consent(accept, version)` garde la date et la version du texte (`CK_HEALTH_VERSION`, côté serveur
  `private.checkin_health_version()`, 1) dans `checkin_health_consents`, pour le coach actuel (effacé avec le lien).
  `student_checkin_answer` refuse sans lui (`no_health_consent`). Mon coach : « Accord pour mes bilans », donné le…,
  retrait (plus d'envoi ; les bilans déjà envoyés restent chez le coach). Changer le texte = version + 1, des deux côtés.
- **Libido et cycle** (`CK_ADULT_KINDS`, `private.checkin_adult_kinds()`) : rendus seulement après « J'ai 18 ans ou
  plus » (`coach_photo_adults`, la déclaration des photos de bilan, ou un accord du cycle, qui l'enregistre aussi).
  Sinon `student_checkins` les retire et dit `adult_asked` ; l'app propose « J'ai 18 ans ou plus » dans le bilan
  (`student_photo_adult`), jamais si la tranche d'âge d'Apple dit moins de 18 ans. Réponse sans déclaration :
  `not_adult`. Le coach peut les mettre dans un modèle (aperçu : « 18 ans et plus », sautés pour les autres) et ne sait
  pas qui est mineur.
- Tests : `tests/sql/bilans_accord_majeur_test.sql`, `tests/sql/bilans_accord_majeur_rollback_test.sh`,
  `tests/test_bilans_eleve.py` (`t_majeur_accord`), faux serveur `tests/fake_checkins.py`.

### Natif

- Pas, cardio et sommeil (en heures) de Santé : docs/SANTE_COACH.md (`checkinReadHealth`, build du 25/11/2026) ; sans
  cette build, les champs restent à remplir à la main.
- Tout le reste (écran, données, notifications, photos) est en JS et CSS.
