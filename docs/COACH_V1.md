# Coach V1 : contrat entre le serveur et l'app

Décisions de Maxence (26 et 27/10/2026) :
- un coach suit des élèves ; il garde toutes les fonctions d'un utilisateur normal ;
- **depuis le 30/10** (docs/PAYANT_V1.md, « Tarifs du 30/10 ») : plus d'élève gratuit (un élève a −25 % pendant 12 mois avec le code de son coach) ; le rôle coach est une **demande vérifiée à la main** (carte professionnelle d'éducateur sportif) ; le coach paie un **abonnement à paliers** (10, 20, 30 élèves, illimité), refus `tier_full` au-delà ; chaque coach a un **code permanent** de 12 caractères ;
- pas de messagerie en V1 ; à la place, des **consignes** (sur un programme ou un exercice) et un **commentaire** du coach sur une séance (31/10/2026 : messages texte ajoutés, voir « Messages ») ;
- **envoi de programmes** du coach vers l'élève ;
- les élèves d'un même coach ne se voient pas entre eux ;
- notifications push : pas en V1 (elles demandent une build). Un badge dans l'app à la place. Depuis la build 31 : « Mon coach » et, le 01/11/2026, « Messages » (docs/NOTIFICATIONS.md).

Hors V1 : paiement, push, plusieurs coachs pour un élève, groupes d'élèves (messagerie : ajoutée le 31/10/2026, voir « Messages »).

## Principes (mêmes règles que docs/SOCIAL_V1.md)
- **Écritures par fonction seulement** : RPC `security definer`, `set search_path = ''`, utilisateur pris dans `auth.uid()`. Aucune écriture directe sur les nouvelles tables, RLS activée, GRANT explicites (`anon` n'a rien, `authenticated` seulement EXECUTE sur les RPC).
- **Erreurs** en snake_case : `not_coach`, `already_coached`, `invalid_code`, `team_full`, `not_found`, `rate_limited`, `too_long`, `invalid_programme` et `username_required` (ajoutés par le serveur, voir « Précisions du serveur »).
- **Indépendant du social** : être coach ou élève ne demande pas d'avoir activé Amis, et ne rend visible dans aucune recherche. Un blocage social entre deux comptes n'empêche pas une relation coach (c'est l'élève qui l'a choisie avec un code) ; l'élève peut quitter à tout moment.
- **Tranche d'âge partagée par Apple** (app iOS seulement, `js/data/age-range.js`) : moins de 15 ans possible → « Rejoindre un coach » masqué (Amis, Réglages › Coach, parrainage ; un coach déjà suivi reste) ; mineur avec « Limites de communication » → messages coupés côté app (`chatAvailable`, erreur `age_limited`). Le serveur n'en sait rien.
- **Suppression du compte** : tout part en cascade avec `auth.users`.

## Données
- `user_profiles.coach_at timestamptz` : non nul = coach. Écrit seulement par l'administrateur (aucune RPC ne le pose). La migration ne touche aucun compte : Maxence est déclaré coach par une commande SQL lancée à part.
- `coach_invites (code text primary key, coach_id, created_at, expires_at)` : code d'invitation de 8 caractères lisibles (sans 0/O/1/I), valable 7 jours, au plus 5 codes actifs par coach.
- `coach_links (coach_id, student_id unique, created_at)` : un élève a au plus UN coach. Limite d'élèves = palier de l'abonnement coach (`tier_full`, 20261030), au moins 50 verrou éteint ; `team_full` ne sort plus.
- `coach_programmes (coach_id, student_id, id text, data jsonb, sent_at, seen_at)`, clé `(student_id, id)` : programmes envoyés. `data` = programme complet (voir plus bas), 200 Ko au plus.
- `coach_notes (coach_id, student_id, session_id text, text, updated_at, seen_at)`, clé `(student_id, session_id)` : commentaire du coach sur une séance de l'élève, 1000 caractères au plus, `seen_at` pour le badge.

## Accès gratuit des élèves (Payant V1, 28/10/2026) : RETIRÉ le 30/10, voir docs/PAYANT_V1.md
Calculé par `private.access_coach_free(uid)` (migration `20261029000000_payant_modele_b.sql`), lu par `my_access()` (`status: 'coach_team'`, `coach_team: true`) et par le verrou des séances. Contrat complet : `docs/PAYANT_V1.md`, « Élèves de coach ».
- **Le coach doit avoir encore le rôle** (`user_profiles.coach_at` non nul). Retirer le rôle à un coach retire l'accès gratuit de ses élèves au prochain calcul (avant le 28/10, ils restaient gratuits pour toujours : bogue corrigé).
- **Au plus 10 élèves gratuits par coach**, dans l'ordre des liens (`coach_links.created_at`, les plus anciens d'abord). Au-delà, l'élève reste suivi (le coach voit ses séances, lui envoie des programmes et des commentaires) mais il lui faut son propre abonnement ou un code cadeau. Quand un ancien élève part, le suivant entre dans les 10.
- Plafond propre à un coach : `private.coach_free_limits (coach_id, max_free)`, hors de l'API (absent : 10). Pour le relever :
  `insert into private.coach_free_limits (coach_id, max_free) values ('<uuid>', 25) on conflict (coach_id) do update set max_free = excluded.max_free, updated_at = now();`
- Le plafond de 50 élèves suivis (`team_full`) ne change pas : il borne le suivi, pas la gratuité.
- Côté élève, Réglages › Abonnement dit : « Accès offert par ton coach tant qu'il te suit ».

## Ce que le coach voit d'un élève
Ses séances complètes, notes de séance comprises, **sans** `healthSaved` ni le `bodyKg` de `sessions.data` : liste blanche `private.session_for_coach` = celle de `private.session_public` + `notes` + `hidden` + `id` (donc, depuis la migration 20261031100000_records_series.sql, les records notés, l'échauffement et le RIR de chaque série : voir docs/SOCIAL_V1.md). `bodyKg` n'apparaît que si l'élève partage son poids avec ce coach (voir « Partage avec le coach »). Les séances masquées aux abonnés restent visibles du coach (il est là pour ça), et l'écran d'acceptation le dit.
Ses programmes perso : non en V1 (le coach envoie les siens).

## Séances faites avec le programme du coach (ajout du 27/10)
- Une séance faite avec un programme reçu a pour `programme` l'id local `u_c<8 caractères du coach>_<prog_id>` (voir plus bas) : le coach la reconnaît à son propre préfixe et l'affiche « Ton programme : <nom> ». Une séance faite avec le programme d'un ancien coach n'est pas attribuée au nouveau.
- `coach_links.coach_seen_at timestamptz` : dernière fois que le coach a ouvert les séances de cet élève. `coach_state().students[]` ajoute `new_sessions` (séances terminées après `coach_seen_at`) et `last_session: { done_at, label, programme }`. `badge` côté coach = nombre total de `new_sessions`.
- `coach_mark_seen(student uuid)` : pose `coach_seen_at = now()` (appelé à l'ouverture des séances de l'élève).
- App : dans « Mes élèves », pastille du nombre de nouvelles séances et ligne « Push · ton programme · hier » ; dans les séances d'un élève, les séances faites avec un programme du coach portent la mention « Ton programme ». Badge de l'onglet Amis = social + coach (élève ou coach).

## Partage avec le coach (ajout du 30/10, migration 20261031300000_partage_coach.sql)
Décision de Maxence : l'élève choisit, donnée par donnée, ce que son coach voit en plus de ses séances. Tout est décoché par défaut, révocable à tout moment.
- **Données** : `weight` (poids du corps) ouverte. `sleep`, `steps`, `resting_hr` prévues dans le modèle (contrainte de `coach_shares.kind`, `COACH_SHARE_KINDS` de js/data/coach-share.js) mais refusées (`invalid_kind`) et non affichées tant que la build HealthKit n'est pas là (`private.share_kind_open`).
- **Consentement** : `coach_shares (student_id, coach_id, kind, granted_at)`, clé `(student_id, kind)`, clé étrangère vers `coach_links (student_id, coach_id)` on delete cascade : quitter, être retiré, supprimer un des comptes efface le consentement.
- **Pesées** : `coach_shared_weights (student_id, at bigint ms, kg numeric(5,2))`, séparées des séances (jamais dans `sessions.data`, `bodyWeightLog` reste dans `SYNC_LOCAL_ONLY`), clé étrangère vers `coach_shares (student_id, 'weight')` on delete cascade : décocher efface toutes les pesées envoyées, historique compris ; le coach n'en garde aucune copie côté serveur. Seules les pesées **saisies dans l'app** (`data.bodyWeightLog`) partent, jamais une pesée de Santé.
- **bodyKg d'une séance** (vue du coach) : `private.coach_session_body(coach, élève, done_at)` vérifie le consentement poids à chaque appel et donne la dernière pesée partagée au plus tard à `done_at` (aucune avant la 1re pesée). L'app compte alors le poids du corps dans le volume (js/data/session-review.js) ; l'écart avec la séance d'avant est calculé sous une même règle (les deux avec leur poids, sinon aucune). Rien pour les amis : `private.session_public` et le fil ne changent pas.
- **Envoi** : miroir des pesées de l'appareil (date ramenée au début du jour : l'heure de la pesée ne part pas), au cochage et à chaque pesée saisie ; à la relecture (`coachRefresh`), seulement si cet appareil a déjà envoyé pour ce coach et que ses pesées ont changé (empreinte locale `mdlf_coach_share`). Un second appareil sans pesées n'écrase donc rien à la connexion ; une pesée saisie sur un appareil qui en a moins remplace la liste (les pesées ne se synchronisent pas entre appareils). Décocher n'est jamais limité ; cocher : 60 par heure.

| Fonction | Renvoie | Règles |
|---|---|---|
| `student_shares()` | `jsonb` | `{ coach: bool, shares: { weight: { granted_at, n, last_at } } }` : seulement les données cochées pour le coach actuel. |
| `student_set_share(kind text, enabled boolean)` | `jsonb` (= `student_shares()`) | Sans coach : `not_found` ; donnée inconnue ou pas ouverte : `invalid_kind`. Recocher garde `granted_at`. Décocher efface les pesées, jamais limité ; cocher : 60 par heure. |
| `student_share_weights(weights jsonb)` | `int` (pesées gardées) | `[{ date, kg }]` : sans consentement `not_shared` ; pas une liste ou élément hors bornes (date entière après 2000 et au plus 24 h dans le futur, kg 25 à 300) `invalid_data` ; plus de 400 ou plus de 64 Ko `too_long`. Remplace toute la liste ; même instant : la dernière. 60 envois par heure. |
| `coach_student_weights(student uuid)` | `jsonb` | Coach de cet élève, encore coach, sinon `not_found`. `{ shared, since, weights: [{ date, kg }] }` du plus récent ; sans partage : `shared: false`, liste vide. |

App : Réglages › Amis et coach › « Partager avec mon coach » (élève suivi seulement ; aussi dans Réglages › Coach) → écran `coach-share` (une case par donnée ouverte, texte de ce que le coach verra). Coach : sur la fiche d'un élève qui partage, groupe « Poids du corps » (dernière pesée, tendance sur 30 jours, courbe de Progrès) ; page séance : pied de page « poids du corps compté (61,4 kg, sa dernière pesée partagée à cette date…) ».

Mensurations partagées (05/11/2026) : même modèle, case « Mensurations », contrat dans `docs/COACH_SUIVI.md` (« Bilan »). Planification des phases par élève : même document.

## Messages (31/10/2026, migration `20261031510000_chat_coach.sql`)

Demande de Maxence (feuille de route « Plus tard » : chat coach), choix pris par défaut (à valider) :
- texte seul (ni photo, ni vocal, ni pièce jointe), 2000 caractères par message ;
- une conversation par lien coach ↔ élève, **seulement entre un coach et ses élèves liés** ; les élèves d'un même coach ne se voient jamais ;
- **effacée en cascade** dès que le lien est rompu (l'élève quitte, le coach le retire, un compte est supprimé) : rejoindre de nouveau repart d'une conversation vide ;
- pas de temps réel : relecture toutes les 15 s tant que la conversation est à l'écran, et avec l'état du coach (ouverture de l'app, premier plan, onglet Amis) ;
- pas de suppression ni de modification d'un message envoyé en V1 ; pas de liste de mots interdits (conversation privée entre deux personnes qui se sont choisies) ;
- **« Signaler » garde une preuve** (corrigé le 31/10/2026 après relecture : avant, seul le profil était signalé et quitter effaçait tout) : `report_chat` copie les 50 derniers messages dans `chat_reports`, sans lien vers `coach_links`, puis l'alerte par e-mail part ; quitter ou retirer ensuite n'efface pas la copie ;
- **consentement** : l'écran « Rejoindre » liste « Des messages » dans « Ce que X pourra faire » ; les élèves liés avant la messagerie voient une fois « Ton coach peut t'écrire » dans Mon coach (fermée, ou conversation ouverte : plus redite, `mdlf_chat_intro_seen` sur l'appareil) ;
- indépendant du social, comme le reste du coach : un blocage social ne coupe pas la conversation (il faut quitter le coach ou retirer l'élève).

### Règles
- **Conversation désignée par l'élève** : le coach passe `student` (son élève), l'élève passe `null` (« avec mon coach »). Un compte à la fois coach et élève a deux conversations séparées, sans ambiguïté. Chaque appel relit le lien (`private.chat_thread`) et vérifie que le coach a encore le rôle : sinon `not_found`, des deux côtés (rôle retiré : conversation fermée, mais pas effacée tant que le lien existe).
- **Données** : `coach_messages (id bigint identity, student_id, coach_id, from_coach, body, created_at)`, clé étrangère vers `coach_links (student_id, coach_id)` on delete cascade ; RLS activée, aucun GRANT client. Non-lus : `coach_links.chat_coach_read` et `chat_student_read`, id du dernier message lu par chacun.
- **Non-lus** : messages de l'autre au-delà de ma marque. La marque n'avance que par `chat_mark_read`, jusqu'au dernier message que l'app a reçu (`up_to`) : un message arrivé après la lecture de l'app reste non lu. **Écrire ne vaut pas lecture** (avant le 31/10/2026, `chat_send` marquait lu jusqu'à mon message, donc aussi un message de l'autre arrivé juste avant et jamais affiché). Envoi et marque d'une même conversation passent l'un après l'autre (verrou par lien).
- **Signalement** (`report_chat(reason, student)`) : copie des 50 derniers messages (`[{ id, from_coach, body, at }]`, du plus ancien au plus récent) dans `chat_reports (reporter_id, target_user, student_id, coach_id, reason, messages, created_at)`. Aucune clé vers `coach_links` ni vers le compte signalé : la copie survit au départ de l'élève, au retrait par le coach et à la suppression du compte signalé ; effacée avec le compte de celui qui signale ; purgée à 12 mois (déclencheur et pg_cron `purge-chat-reports-12-mois`). Une ligne dans `public.reports` (`kind: 'profile'`, `target_ref: 'chat_reports:<id>'`, details : où lire la copie) ; l'app demande ensuite l'alerte par e-mail à la fonction Edge `report` (`{ report_id }`). Limite : celle de `public.reports` (10 par 24 h, tous types confondus). Lire une conversation signalée : requête en bas de la migration.
- **Texte** : nettoyé comme les commentaires ; 1 à 2000 caractères (`empty_message`, `too_long`).
- **Limites** : 60 messages par heure et 500 par 24 h ; `chat_messages` 900 lectures par heure, `chat_threads` et `chat_mark_read` 600.
- **Erreurs** : `not_found`, `empty_message`, `too_long`, `invalid_reason`, `rate_limited`.

| Fonction | Renvoie | Règles |
|---|---|---|
| `chat_threads()` | `jsonb` | `{ coach: { unread, last } \| null, students: [{ student_id, unread, last }], unread }`, `last = { id, mine, body (120 caractères), at } \| null`. `coach` : avec mon coach (s'il a encore le rôle) ; `students` : mes élèves (si je suis coach). |
| `chat_messages(student uuid default null, before_id bigint default null, after_id bigint default null)` | `table(id bigint, mine boolean, body text, at timestamptz)` | 50 par page. Sans curseur : les plus récents, du plus récent au plus ancien ; `before_id` : plus anciens (même ordre) ; `after_id` : plus récents, du plus ancien au plus récent (relecture). |
| `chat_send(body text, student uuid default null)` | `jsonb { id, mine, body, at }` | Voir les règles. |
| `chat_mark_read(student uuid default null, up_to bigint default null)` | `void` | Conversation lue jusqu'à `up_to` (dernier message reçu par l'app ; null : jusqu'au dernier). La marque ne recule jamais. |
| `report_chat(reason text, student uuid default null)` | `bigint` | Id de la ligne de `public.reports`. Voir « Signalement ». |

### App
- **Entrées** : cellule « Messages » (aperçu du dernier message sur deux lignes au plus, coupé par « … » comme dans Messages d'iOS, voulu : le message entier est dans la conversation ; nombre de non-lus) dans Mon coach (élève) et sur la fiche d'un élève (coach) ; pastille bleue 💬 N par élève dans Mes élèves ; les non-lus s'ajoutent aux pastilles « Mon coach » / « Mes élèves » et au badge de l'onglet Amis (gardés sur l'appareil, `mdlf_chat`, pour un badge juste hors ligne).
- **Conversation** (`coach-chat:@coach` ou `coach-chat:<id de l'élève>`) : bulles façon Messages (les miennes à droite à la teinte, celles de l'autre à gauche en gris), heure, séparateurs « Aujourd'hui », « Hier », date ; « Afficher les messages précédents » ; saisie collée au-dessus de la barre d'onglets ; menu ⋯ « Signaler » (annonce que les 50 derniers messages sont joints, puis que la copie est gardée même si le suivi s'arrête). Ouverte : marquée lue jusqu'au dernier message reçu ; relue toutes les 15 s et juste après chaque envoi (seulement les nouveaux, `after_id` = dernier message reçu du serveur, jamais mon propre envoi) ; pendant la frappe, seule la liste est redessinée. Lien rompu : « les messages ont été effacés ».
- **Serveur sans messagerie** (fonction absente, PostgREST `PGRST202`) : la cellule « Messages » n'apparaît pas.
- **privacy.html** : « Messages » dans Coach (FR et EN), avec la copie gardée 12 mois en cas de signalement.

### Ordre de mise en production
Migration d'abord, puis la fonction Edge `report` (mode `{ report_id }`), puis l'OTA (une app à jour sur un serveur d'avant cache la cellule ; avec une fonction `report` d'avant, le signalement est enregistré mais l'alerte ne part pas : `notified_at` nul, requête de rattrapage). Retour arrière : `supabase/rollback/20261031510000_chat_coach_down.sql`, vérifié par `tests/sql/rollback_social_check.sh`.

## Plan diète (05/11/2026, sans migration)
Le coach envoie un plan diète par le même canal que les programmes : `coach_send_programme(student, 'diet_<plan>', { kind: 'diet', v: 1, diet })`. Sans `name` au premier niveau, une app d'avant la nutrition l'écarte ; l'app actuelle le range dans `inbox.diets` et le retire des « Programmes envoyés ». Contrat complet : `docs/NUTRITION_V1.md`, « Coach : envoi sans migration ».

## Fonctions RPC (rôle `authenticated`)

| Fonction | Renvoie | Règles |
|---|---|---|
| `coach_state()` | `jsonb` | `{ is_coach, coach: p\|null, removed: [p], students: [p + { last_session_at, sessions_7d, new_sessions, last_session, sent }], invites: [{ code, expires_at }], badge, badge_coach, badge_student }`, `p = { user_id, username, avatar, since }`. `badge` (élève) = programmes non vus + commentaires non vus. |
| `coach_create_invite()` | `text` (code) | `not_coach` si pas coach. 5 codes actifs au plus (le plus ancien est remplacé). |
| `coach_revoke_invite(code text)` | `void` | |
| `coach_join(code text)` | `jsonb p` (le coach) | `invalid_code` (inconnu ou expiré), `already_coached` (a déjà un coach), `not_found` (son propre code), `team_full`. 10 essais par heure (`rate_limited`). Le code reste utilisable par d'autres élèves jusqu'à expiration. |
| `coach_preview(code text)` | `jsonb p` | Montre qui est le coach avant d'accepter ; mêmes erreurs que `coach_join`, sans rien créer. |
| `coach_leave()` | `void` | L'élève quitte son coach : lien, programmes envoyés non importés et commentaires supprimés côté serveur (les programmes déjà importés restent chez l'élève). |
| `coach_remove_student(student uuid)` | `void` | Même effet, à l'initiative du coach ; l'élève ne peut plus revenir avant `coach_allow_student`. |
| `coach_allow_student(student uuid)` | `void` | Lève l'interdiction de revenir posée par `coach_remove_student`. Silencieux si l'élève est inconnu. |
| `coach_student_sessions(student uuid, before_at bigint default null, before_id text default null)` | `table(id, done_at, s jsonb, note text)` | Coach de cet élève seulement, sinon `not_found`. 30 par page, triées par `(done_at, id)` décroissant. `note` = son commentaire. |
| `coach_mark_seen(student uuid)` | `void` | Coach de cet élève seulement, sinon `not_found`. Pose `coach_seen_at = now()` : `new_sessions` repart de zéro. |
| `coach_send_programme(student uuid, prog_id text, data jsonb)` | `void` | Coach de cet élève seulement. Remplace un envoi du même `prog_id` (mise à jour), `seen_at` remis à null. 30 envois par jour. |
| `coach_set_note(student uuid, session_id text, text text)` | `void` | Texte vide = supprime. `seen_at` remis à null. |
| `student_inbox()` | `jsonb` | Élève : `{ programmes: [{ id, data, sent_at, seen }], notes: [{ session_id, text, updated_at, seen }] }`. |
| `student_mark_seen(kind text, ref text)` | `void` | `kind` = `programme` ou `note`. |

## Précisions du serveur (migration 20261027100000_coach.sql, 27/10)
Points que le tableau ne disait pas, tranchés côté serveur ; l'app doit les connaître :
- **Pseudo obligatoire pour être élève** : `coach_preview` et `coach_join` lèvent `username_required` si l'appelant n'a pas de pseudo (comme `social_enable`), avant même de regarder le code. Sinon le coach verrait plusieurs élèves sans nom. L'app propose alors de choisir un pseudo.
- **Saisie du code** : majuscules, espaces et tirets ignorés (`abcd-efgh` = `ABCDEFGH`). Un code dont le coach n'a plus le rôle répond `invalid_code`.
- **`coach_join` rejoué** (coupure réseau) vers le coach qu'on a déjà : renvoie le coach, sans erreur. `already_coached` seulement pour un autre coach. Même chose pour `coach_preview`.
- **`coach_preview`** renvoie `since: null` (aucun lien encore) ; `coach_join`, la date du lien.
- **Débit de `coach_preview` + `coach_join`** : 10 par heure à eux deux (aperçu puis acceptation = 2). Seuls les appels réussis comptent : Postgres annule l'écriture du compteur quand la fonction lève une erreur. La protection contre la devinette est la taille du code (32^8 combinaisons).
- **`coach_create_invite`** : en plus de 5 codes actifs, 20 créations par 24 h (`rate_limited`).
- **`coach_send_programme`** : `prog_id` = 1 à 64 caractères `[A-Za-z0-9_-]` et `data` = objet JSON, sinon `invalid_programme` ; plus de 200 Ko (texte JSON) : `too_long`.
- **`coach_set_note`** : texte rogné des espaces ; séance inexistante ou supprimée : `not_found`.
- **`coach_student_sessions`** : séances non supprimées et datées, au plus 24 h dans le futur (comme le fil Amis). `s` = liste blanche `private.session_public` + `id`, `notes` (texte, 2000 caractères au plus) et `hidden` (`true` ou absent).
- **`coach_state().students[]`** : `{ user_id, username, avatar, since, last_session_at, sessions_7d, new_sessions, last_session, sent }`. `sent` = `[{ id, sent_at, seen }]`, les programmes que je lui ai envoyés, du plus récent au plus ancien ; `seen` = l'élève l'a ouvert ou ajouté (`student_mark_seen`), remis à `false` à chaque nouvel envoi du même `id`. Coach seulement : un élève ou un autre coach n'en voit rien. `last_session` = `null` sans séance ; `label` et `programme` peuvent valoir `null`. `badge_student` = programmes et commentaires non vus de mon coach ; `badge_coach` = somme des `new_sessions` de mes élèves ; `badge` = leur somme (gardé pour la compatibilité). Un compte à la fois coach et élève a les deux, séparés.
- **`new_sessions`** : séances dont la date (`done_at`) est postérieure à `coach_seen_at`, ou à la date du lien tant que le coach n'a rien ouvert (un nouvel élève n'arrive pas avec tout son historique en « nouveau »). Une séance faite hors ligne puis synchronisée plus tard, mais datée d'avant la dernière ouverture, ne compte pas.
- **`coach_mark_seen(student)`** : `not_found` si ce n'est pas mon élève ou si je ne suis plus coach.
- **Rôle retiré par l'administrateur** : le coach reçoit `not_coach` (inviter, envoyer, commenter) ou `not_found` (séances, vu) ; `students` et `invites` sont vides ; ses élèves voient encore le lien (pour le quitter) et leur boîte. `coach_remove_student` marche toujours.
- **Élève retiré** (`coach_remove_student`) : il ne peut plus revenir, avec aucun code de ce coach (même un code créé après) ; `coach_preview` et `coach_join` lui répondent `invalid_code`, comme pour un code faux. `coach_state().removed` = `[p]` (coach seulement, `since` = date du retrait) pour proposer « Autoriser à revenir » : `coach_allow_student(student uuid)` lève l'interdiction (silencieux si l'élève est inconnu ou pas retiré) ; l'élève doit ensuite rejoindre avec un code valable. Quitter de soi-même (`coach_leave`) n'interdit rien.
- **Silencieux** (aucune erreur) : `coach_revoke_invite` d'un code inconnu ou d'un autre, `coach_remove_student` d'un non-élève, `student_mark_seen` d'une référence ou d'un `kind` inconnus, `coach_leave` sans coach.
- **Tri de `student_inbox`** : programmes par `sent_at` décroissant, commentaires par `updated_at` décroissant ; commentaires des séances supprimées exclus.

## Programme envoyé (`data`)
Format de js/data/prog-share.js étendu, validé par l'app à la réception :
`{ name, consigne?, sessions: [{ key, label, color, exercises: [{ name, sets, rest?, measure?, tempo?, repMax?, ss?, consigne? }] }] }`.
- `consigne` (programme ou exercice) : texte du coach, 500 caractères au plus.
- À l'import, l'élève reçoit un programme perso (`userProgrammes`, id `u_c<8 premiers caractères alphanumériques de l'id du coach>_<prog_id>`, choix du 27/10 : deux coachs qui envoient le même `prog_id` ne s'écrasent jamais, et le coach reconnaît ses programmes ; un import plus ancien `u_c<prog_id>` du même coach garde sa place), marqué `fromCoach: { coachId, name, sentAt, hash, keptAt? }`. Un nouvel envoi du même `prog_id` met à jour le programme importé (exercices et consignes), en gardant les `id` d'exercices dont le nom ne change pas dans la même séance, pour garder l'historique et les records.
- `order: [clés]` : ordre des séances de tout programme perso (pas seulement reçu), synchronisé dans le profil, parce que jsonb trie les clés d'un objet. Absent, l'ordre des clés de l'appareil fait foi (migration douce) ; une empreinte de profil d'avant ce champ compte comme « inchangé ici » à la synchro.
- `retired: true` sur une séance : séance retirée par le coach dans un nouvel envoi. Gardée pour l'historique (nom, couleur), jamais listée (accueil, programme, choix de séance).
- Consigne d'un programme intégré que le coach envoie : gardée dans `programmes[id].consigne` (les programmes intégrés n'ont pas d'entrée `userProgrammes`).
- L'élève peut l'utiliser comme n'importe quel programme ; s'il le modifie, un nouvel envoi lui demande avant d'écraser.

## App
- **Réglages › Coach** (tout le monde) : « Rejoindre un coach » (saisie du code, puis aperçu du coach et de ce qu'il verra, puis « Accepter ») ; si suivi : le coach, « Quitter mon coach ».
- **Onglet Amis** : en haut, une cellule « Mes élèves » (coach) ou « Mon coach » (élève), avec le badge. L'onglet reste utilisable sans avoir activé Amis pour cette partie.
- **Coach › Mes élèves** : liste (dernière séance, séances sur 7 jours), « Inviter un élève » (code + partage du texte d'invitation avec la feuille de partage), codes actifs ; un élève → ses séances (détail comme Historique, notes comprises) avec « Commenter », « Envoyer un programme » (choisir un de mes programmes, ajouter des consignes au programme et par exercice), « Retirer l'élève ».
- **Élève** : programme reçu → carte « Nouveau programme de <coach> » (Mon coach et accueil) avec « Ajouter à mes programmes » ; consignes visibles dans Programme › Séance, dans la séance (sous le nom de l'exercice, repliable) ; commentaire du coach dans Historique › Séance.
- **Badge** : sur l'onglet Amis = badge social + badge coach.
- Hors ligne : messages clairs, rien de perdu.
