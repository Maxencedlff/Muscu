# Social V1 : contrat entre le serveur et l'app

Décisions de Maxence (26/10/2026) :
- 5e onglet « Amis » ;
- réaction « Bravo » sans texte (31/10/2026 : cinq réactions, voir « Réactions et Mon profil ») ;
- 13+ déclaré à Apple et case « J'ai 15 ans ou plus » à l'activation ;
- pseudo obligatoire pour être trouvé ;
- les abonnés voient tout l'historique, avec « Visible sur mon profil » par séance (éteint = masquée), mais jamais les notes, le poids du corps ni Santé (décision du 25/10) ;
- avatar = emoji ou initiale.

Hors V1 :
- envoi de programmes (V2) ;
- coach (V3) ;
- push (V4) ;
- liens de profil mdlf.app/u/… (ils demandent une build).

## Principes
- **Comptes privés** : on ne voit les séances de quelqu'un qu'après qu'il a accepté la demande.
- **Écritures par fonction seulement** : toutes passent par des fonctions RPC `security definer`, avec `set search_path = ''` et l'utilisateur pris dans `auth.uid()`. Aucune écriture directe sur les nouvelles tables.
- **Lecture des autres** : elle ne passe que par les RPC. `user_profiles` garde sa RLS « sa ligne seulement ».
- **Liste blanche** : une séance montrée à un autre n'expose que ses champs, filtrés côté serveur.
- **Erreurs** : chaque exception a un message court en snake_case (`social_not_enabled`, `username_required`, `age_required`, `rate_limited`, `not_found`), que l'app traduit en français.
- **Blocage** : il coupe tout dans les deux sens (recherche, demandes, fil, bravos) et n'est jamais révélé. Une demande vers quelqu'un qui t'a bloqué (ou que tu as bloqué, ou sans social) répond comme une demande normale et crée une demande « fantôme » (`status = 'ghost'`) : son auteur la voit dans `requested`, personne d'autre ne la voit (ni `pending_in`, ni badge, ni `respond_follow`), et elle ne devient jamais une vraie demande. `cancel_follow` la retire ; le déblocage la supprime.
- **Social de l'appelant requis** : `feed` et `search_profiles` renvoient une liste vide, et `toggle_bravo` répond `not_found`, tant que l'appelant n'a pas activé le social.
- **Suppression du compte** : tout part en cascade avec `auth.users`.
- **GRANT explicites** : obligatoires depuis le 30/10/2026. `anon` n'a rien.

## Données
- **user_profiles** : nouvelle colonne `social_at timestamptz`, nulle tant que le social n'est pas activé. On ne peut pas l'écrire directement, seulement par `social_enable` et `social_disable`.
- **sessions** : nouvelle colonne générée `done_at bigint` (à partir de `data->'date'`), indexée `(user_id, done_at desc) where deleted_at is null`.
- **Champs que l'app envoie en plus dans `sessions.data`** :
  - `label` : nom affiché de la séance (`rawLabel`), calculé au moment de la synchro ;
  - `hidden: true` : séance masquée aux abonnés (absent = visible).
- **follows** `(follower_id, followee_id, status 'pending'|'accepted'|'ghost', created_at, responded_at)`.
- **blocks** `(blocker_id, blocked_id, created_at)`.
- **bravos** `(session_owner, session_id, user_id, created_at, kind, updated_at)`, clé primaire sur les trois premiers champs : c'est la table des réactions (`kind` et `updated_at` ajoutés le 31/10/2026, voir plus bas).
- **user_profiles.activity_seen_at** (31/10/2026) : date de la dernière consultation de l'activité, écrite seulement par `mark_activity_seen`.
- **reports** : signalements, écrits par la fonction Edge `report` et par les RPC `report_comment` et `report_chat` (file de modération commune ; l'alerte par e-mail part toujours de la fonction Edge).

## Liste blanche d'une séance vue par un autre (`private.session_public`)
`{ date, duration, programme, category, label, records, exercises: [{ name, measure, ss, sets: [{ weight, reps, dist, warmup, rir }] }] }`

`ss` : identifiant du superset de l'exercice (ajouté le 27/10/2026, migration 20261027000000_supersets.sql).

Ajoutés le 31/10/2026 (migration 20261031100000_records_series.sql) :
- `records` : records battus que l'app a notés dans la séance à son enregistrement (`sessionRecords`, js/data/records.js), revalidés par `private.session_records` : au plus 20 éléments `{ ex, kind, after, w?, d? }` (le coach reçoit en plus `before`, la valeur d'avant, par `private.session_for_coach` : elle peut venir d'une séance masquée, un ami ne la reçoit donc jamais), `ex` texte de 80 caractères au plus, `kind` parmi `charge`, `reps`, `lest`, `aide`, `temps`, `duree`, `distance`, `allure`, `before` et `after` nombres de 0 à 100 000, `w` nombre facultatif, `d` distance fixe (0.5, 1, 2, 5 ou 10, obligatoire pour une allure). Tout autre élément ou clé est écarté ; jamais le 1RM estimé. Absent si la séance n'en a pas noté (version d'avant) : l'app les recalcule alors comme avant, seulement quand toutes les séances de la personne sont chargées.
- par série, `warmup` (`true` seulement) et `rir` (entier 0 à 4) : l'échauffement est exclu du volume et des séries chez l'ami et le coach ; le coach voit le RIR.

Fil : la carte d'une séance qui a des records notés montre le plus marquant (« 🏆 Nouveau record : Squat 100 kg »).

Rien d'autre ne sort : ni `notes`, ni `bodyKg`, ni `healthSaved`, ni `hidden`, ni aucune clé future. Valeurs simples seulement (texte tronqué à 200 caractères, nombre, booléen), 60 exercices et 100 séries au plus.

## Fonctions RPC (rôle `authenticated` seulement)

| Fonction | Renvoie | Règles |
|---|---|---|
| `social_enable(age_ok boolean)` | `void` | Erreur `username_required` sans pseudo, `age_required` si `age_ok` n'est pas vrai. Pose `social_at = now()`. Peut être rappelée sans effet. |
| `social_disable()` | `void` | Remet `social_at` à null : invisible dans la recherche, séances invisibles pour les abonnés. Les relations sont gardées. |
| `social_state()` | `jsonb` | `{ enabled, username, avatar, pending_in: [p], following: [p], followers: [p], requested: [p], blocked: [p], badge }`, où `p = { user_id, username, avatar, since }`. `badge` = nombre de demandes reçues en attente. `requested` comprend les demandes fantômes. Dans `blocked`, `username` et `avatar` valent `null` pour un compte sans social. |
| `search_profiles(q text)` | `table(user_id, username, avatar, relation)` | `q` normalisé (minuscules, sans accent, sans `@`), 2 caractères minimum, recherche par préfixe du pseudo, 20 résultats triés par pseudo (la correspondance exacte d'abord). Exclut soi-même, les profils sans `social_at`, et les blocages dans les deux sens. Vide si l'appelant n'a pas activé le social. `relation` vaut `'none'`, `'requested'` (demande en attente ou fantôme), `'following'` ou `'follows_you'` (son abonnement à moi est accepté). |
| `request_follow(target uuid)` | `text` | `'requested'`, ou `'following'` si la relation existe déjà. `social_not_enabled` si l'appelant n'a pas activé le social. Cible bloquée ou bloquante, ou sans social : renvoie `'requested'` et crée une demande fantôme. `not_found` sur soi-même. Au plus 30 demandes par jour, fantômes comprises. |
| `cancel_follow(target uuid)` | `void` | Retire ma demande ou mon abonnement. |
| `respond_follow(follower uuid, accept boolean)` | `void` | Accepte, ou supprime la ligne si refusé. Sans effet sur une demande fantôme, absente, ou si un blocage existe entre les deux. |
| `remove_follower(follower uuid)` | `void` | Supprime l'abonnement de quelqu'un à moi. |
| `block_user(target uuid)` / `unblock_user(target uuid)` | `void` | Le blocage supprime mes demandes et abonnements vers l'autre, son abonnement vers moi et les bravos échangés ; sa demande en attente devient fantôme. Silencieux pour un identifiant inconnu, `not_found` sur soi-même. Le déblocage supprime les demandes fantômes entre les deux. |
| `feed(before_at bigint default null, before_owner uuid default null, before_id text default null, only_user uuid default null)` | `table(owner, username, avatar, id, done_at, s jsonb, bravos int, my_bravo boolean)` | Séances des personnes que je suis, si leur abonnement est accepté, leur social activé (et le mien), sans blocage, séance non supprimée, non masquée et datée au plus 24 h dans le futur. Triées par `(done_at, owner, id)` décroissant, 20 par page. Page suivante : `before_at`, `before_owner`, `before_id` = `done_at`, `owner`, `id` de la dernière carte (les séances à la même milliseconde ne sont ni perdues ni doublées). `only_user` sert à l'écran d'un profil (appel par nom : `feed(only_user => …)`) : vide si je ne le suis pas. |
| `toggle_bravo(owner uuid, session_id text)` | `jsonb {bravos, mine}` | Seulement sur une séance que `feed` me montrerait, sinon `not_found`. Pas sur mes propres séances. Au plus 200 par jour. Depuis les réactions : pose un 👏, ou retire ma réaction quelle qu'elle soit (anciennes versions de l'app). |
| `my_bravos()` | `table(session_id text, bravos int)` | Bravos reçus sur mes séances, pour Historique. Gardée pour les anciennes versions : compte toutes les réactions. |

## Réactions et Mon profil (31/10/2026, migration `20261031200000_reactions_profil.sql`)

Décisions de Maxence (30/10/2026) :
- cinq réactions, liste fermée, sans texte (rien à modérer) : 👏 `clap` Applaudissements, 🔥 `fire` Chaud, 💪 `strong` Costaud, 🏆 `trophy` Record, 😮 `wow` Impressionnant ;
- une réaction par personne et par séance, changeable et retirable ; un toucher pose 👏 (ou retire la mienne), un appui long ouvre le choix ;
- sur MES séances, la liste de qui a réagi (pseudo, avatar, réaction), seulement pour les personnes que j'ai acceptées ;
- écran « Mon profil » dans l'onglet Amis, ouvert par mon avatar en haut à droite ;
- pastille de l'onglet pour une nouvelle activité, remise à zéro à l'ouverture de Mon profil (vu côté serveur).

### Règles
- **Données** : la table `bravos` garde sa clé primaire (une ligne par personne et par séance) et gagne `kind` (contrainte `bravos_kind`, défaut `clap`) et `updated_at` (pose ou dernier changement). Les bravos d'avant deviennent des 👏 par la valeur par défaut, sans recopie ; leur `updated_at` reprend leur `created_at`.
- **Une réaction compte tant que son auteur voit la séance** (`private.can_see(auteur, propriétaire)` : abonnement accepté, social activé des deux côtés, aucun blocage). Un abonné retiré ou désabonné disparaît des comptes, de « qui a réagi » et de l'activité ; sa ligne reste et recompte s'il est de nouveau accepté. Le blocage supprime les réactions échangées, comme avant. Seule exception : `my_bravos`, inchangée.
- **Compatibilité** : `toggle_bravo` et `my_bravos` ne changent pas ; `feed` garde ses colonnes dans le même ordre (`bravos` = total des réactions qui comptent, `my_bravo` = j'ai réagi) et en ajoute deux à la fin. Une ancienne version de l'app continue de marcher ; elle voit chaque réaction comme un bravo.
- **Ordre de mise en production** : migration d'abord, puis l'OTA. Une app à jour sur un serveur d'avant compte tout en 👏 (feed sans `reactions`) mais ne peut pas réagir (`set_reaction` absente).
- **Limites** : 200 réactions posées ou changées par 24 h (compteur `bravo`, partagé avec `toggle_bravo`) ; reposer la même ou retirer ne compte pas. Lectures, par heure : `my_activity` 120, `my_shown_sessions` 120, `session_reactions` 300, `my_reactions` 300, `mark_activity_seen` 120.
- **Nouveautés** (`activity_new`) : réactions à mes séances et demandes acceptées plus récentes que `activity_seen_at` (ou que l'activation du social). Un nouvel abonné n'en est pas une : c'est moi qui l'ai accepté. Les demandes reçues restent comptées à part (`badge`). La pastille de l'onglet affiche `badge + activity_new` (plus les nouveautés du coach).
- **Erreurs** : `invalid_reaction` (réaction hors liste ou texte), `not_found`, `rate_limited`.

### Fonctions RPC (rôle `authenticated` seulement)

| Fonction | Renvoie | Règles |
|---|---|---|
| `set_reaction(owner uuid, session_id text, kind text)` | `jsonb {bravos, mine, my_reaction, reactions}` | Pose, change ou retire (`kind` null) ma réaction. Mêmes séances que `toggle_bravo` (sinon `not_found`). `reactions` : comptes par sorte, ex. `{"fire": 2, "clap": 1}`. |
| `feed(…)` | `table(owner, username, avatar, id, done_at, s, bravos, my_bravo, reactions jsonb, my_reaction text)` | Comme avant, avec les comptes par sorte et ma réaction (ou null). Supprimée puis recréée (type de retour changé), droits redonnés. |
| `my_reactions()` | `table(session_id, total int, top text, reactions jsonb)` | Réactions reçues sur mes séances non supprimées, pour l'Historique. `top` : la plus fréquente (égalité : ordre de la liste). |
| `session_reactions(session_id text)` | `table(user_id, username, avatar, kind, at)` | Qui a réagi à MA séance, du plus récent au plus ancien, 200 au plus. Séance d'un autre, inconnue ou supprimée : vide. |
| `my_activity(before_at timestamptz default null, before_key text default null)` | `table(kind, user_id, username, avatar, at, reaction, session_id, session_label, session_at, is_new)` | `kind` : `reaction`, `follower` (abonnement accepté), `accepted` (ma demande acceptée), `request` (demande reçue, jamais fantôme). 50 par page, triées par `(at, kind:user_id:session_id)` ; page suivante : `before_at` = `at` de la dernière ligne tel que reçu (microsecondes comprises), `before_key` = sa clé `kind:user_id:session_id` (session_id vide hors réaction) : les lignes à la même date ne sont ni perdues ni doublées. Blocages exclus. Vide sans social. |
| `mark_activity_seen()` | `void` | `activity_seen_at = now()`. |
| `my_shown_sessions(before_at bigint default null, before_id text default null)` | mêmes colonnes que `feed` | Mes séances telles que mes abonnés les voient (`private.session_shown`, liste blanche), 20 par page, curseur `(done_at, id)`. |
| `social_state()` | `jsonb` | Comme avant, plus `activity_new` (0 à 99) et `shown_sessions` (mes séances visibles). |

### Retour arrière
`supabase/rollback/20261031200000_reactions_profil_down.sql`, à lancer à la main : chaque réaction redevient un bravo (la ligne reste), `feed` et `social_state` reprennent leur forme d'origine, les nouvelles fonctions et colonnes partent. Vérifié par `tests/sql/rollback_check.sh` (migrations, réaction posée, retour arrière, puis les tests du social d'avant les réactions).

### App
- **Fil** : bouton emoji seul, sans texte, « 👏 » (ma réaction à la place une fois posée, pleine à la teinte ; VoiceOver : « Réagir » ou « Retirer ma réaction (…) ») et résumé « 🔥👏 3 ». Un toucher : 👏, ou retirer la mienne ; appui long (0,42 s) : bulle des cinq réactions au-dessus du bouton (Échap ou toucher à côté la ferme ; retoucher la mienne la retire). Rien ne se passe au pointerdown ; le clic qui suit l'appui long est avalé. VoiceOver : consigne « Maintiens pour choisir », double-toucher maintenu.
- **Séance d'un ami** : rangée des cinq réactions (sans geste), « Ta réaction : Chaud » et le résumé.
- **Mon profil** (`social-me`, mon avatar en haut à droite de l'onglet, point rouge s'il y a du nouveau) : avatar, pseudo, chiffres (séances visibles, abonnés, abonnements : ces deux-là ouvrent leur liste, `social-people:followers|following`, avec « Retirer » pour un abonné), Activité (8 lignes puis « Afficher plus », point bleu sur les nouveautés, une demande reçue avec Accepter et Refuser, une réaction ouvre ma séance dans l'Historique), mes séances vues par mes abonnés (avec leurs réactions ; une séance ouvre sa page avec qui a réagi), puis Gérer. Ouvrir Mon profil appelle `mark_activity_seen` une fois l'activité lue.
- **Gérer** : demandes envoyées, bloqués, règles, Désactiver le social (abonnés et abonnements sont passés dans Mon profil).
- **Historique** : « 🔥 2 » (la plus fréquente et le total) à côté du titre d'une séance qui a reçu des réactions ; dans le détail, « Réactions (N) » et la liste de qui a réagi.
- **privacy.html** : « Réactions » remplace « Bravos » (FR et EN), avec qui voit qui a réagi et la date de consultation de l'activité.

## Commentaires (31/10/2026, migration `20261031500000_commentaires.sql`)

Demande de Maxence (feuille de route « Plus tard » : commentaires libres), choix pris par défaut (les plus sûrs et les plus simples, à valider) :
- commentaire en texte libre sous une séance, **500 caractères** au plus, pas d'image, pas de mention, pas de réponse en fil (une liste à plat) ;
- **mots interdits** (français et anglais) refusés avant l'écriture, liste **côté serveur** (`private.comment_words`, complétable sans migration) ;
- **signalement** d'un commentaire (motifs de la fonction `report`), **masqué automatiquement au 3e signalement** de personnes différentes ;
- le propriétaire de la séance supprime n'importe quel commentaire de sa séance, l'auteur le sien ;
- notification dans l'activité de Mon profil (pas de push : il faudrait une build).

### Règles
- **Qui écrit** : le propriétaire de la séance et les personnes qui la voient dans leur fil (`private.can_see`), sur une séance montrable (`private.session_shown` : ni supprimée, ni masquée). Social de l'appelant requis (`social_not_enabled`). Ailleurs : `not_found`.
- **Qui lit** : les mêmes. Le propriétaire lit aussi les commentaires d'une séance qu'il a masquée ensuite (lecture seule). Séance qu'on ne voit pas : liste vide.
- **Un commentaire compte tant que son auteur voit la séance** (comme une réaction) : abonné retiré, désabonné, bloqué ou social désactivé → plus montré à personne ; sa ligne reste et revient s'il est de nouveau accepté.
- **Blocage respecté** entre le lecteur et l'auteur, dans les deux sens : un abonné de A ne voit pas les commentaires de quelqu'un qu'il a bloqué (ou qui l'a bloqué), sur aucune séance. Rien n'est supprimé au blocage (les signalements gardent leur preuve), tout est filtré à la lecture.
- **Texte** : `\r` retirés, plus de deux retours à la ligne ramenés à deux, espaces autour retirés ; 1 à 500 caractères (`empty_comment`, `too_long`). L'app nettoie de la même façon (`commentClean`, js/data/comments.js) et l'affiche avec `white-space: pre-wrap`, jamais en HTML.
- **Mots interdits** (`comment_forbidden`) : minuscules, accents retirés, chiffres « leet » lus (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s), lettres répétées ramenées à une, lettres isolées recollées (« c o n n a r d »). Mode `word` : mot entier (avec s, e, es ou x) ; mode `contains` : n'importe où dans un mot. Deux ou trois mots voisins recollés sont refusés seulement s'ils forment **exactement** un mot interdit de 6 lettres ou plus (« tue-toi », « kill your self », « sa lope ») : « situe-toi », « youpi nouveau » passent. Mots courants qui ressemblent à un mot interdit une fois les lettres répétées ramenées à une (« cône », « fagot », « nigaud », « Niger », « Pornic », « chili con carne ») : liste `private.comment_allowed`, retirés du texte (mot entier) avant la comparaison. Un mot anglais qui est aussi un mot français courant n'est pas dans la liste (« retard » retiré le 31/10/2026 ; « retarded » reste). Faux positifs connus et acceptés : un mot `contains` caché dans un nom propre rare (« Scunthorpe »), « chatte » au sens de l'animal.
- **Signalement** (`report_comment(comment_id, reason)`) : un commentaire que je vois, pas le mien ; une fois par personne (refaire ne fait rien) ; copie du texte gardée dans `comment_reports` (le signalement survit à la suppression, `comment_id` passe à null) ; au 3e signalant distinct, `masked_at` est posé : plus personne ne le voit, sauf son auteur (`masked: true`, « Masqué après des signalements »). Chaque signalement entre aussi dans `public.reports` (`kind: 'session'`, `target_ref: 'comment_reports:<id>'`, details : le texte) ; la RPC renvoie l'id de cette ligne (null si déjà signalé par moi) et l'app demande l'alerte par e-mail à la fonction Edge `report` (`{ report_id }`), comme pour un profil (corrigé le 31/10/2026 : avant, personne n'était prévenu).
- **Activité** : `my_activity` gagne la sorte `comment` (commentaire d'un autre sur une de mes séances, visible, non masqué) et deux colonnes à la fin, `comment_id` et `comment_text` (120 caractères) ; clé de départage `comment:user_id:session_id:comment_id`. `private.activity_new` les compte (pastille). Une ancienne version de l'app ignore ces lignes (`cleanActivityRow`).
- **Limites** : 30 commentaires par heure et 150 par 24 h ; signalements : ceux de `public.reports`, 10 par 24 h tous types confondus ; `list_comments` 600 lectures par heure. Supprimer n'est jamais limité.
- **Erreurs** : `empty_comment`, `too_long`, `comment_forbidden`, `social_not_enabled`, `not_found`, `invalid_reason`, `rate_limited`.

### Fonctions RPC (rôle `authenticated` seulement)

| Fonction | Renvoie | Règles |
|---|---|---|
| `list_comments(owner uuid, session_id text, before_id bigint default null)` | `table(id bigint, user_id, username, avatar, body, at, mine, can_delete, masked)` | Du plus récent au plus ancien, 30 par page ; page suivante : `before_id` = `id` du dernier reçu. `can_delete` : le mien ou ma séance. |
| `add_comment(owner uuid, session_id text, body text)` | `jsonb` (mêmes champs) | Voir les règles. |
| `delete_comment(comment_id bigint)` | `boolean` | `true` si supprimé ; `false` sinon (inconnu ou pas à moi : rien n'est révélé). |
| `report_comment(comment_id bigint, reason text)` | `bigint` | Id de la ligne de `public.reports` (null : déjà signalé par moi). Voir les règles. |
| `my_activity(…)` | `table(…, comment_id bigint, comment_text text)` | Comme avant, plus la sorte `comment`. Supprimée puis recréée (type de retour changé), droits redonnés. |

### Modération (Maxence, éditeur SQL)
- Signalements récents : requête en bas de la migration (les plus signalés d'abord). Un commentaire contraire aux règles : `delete from public.session_comments where id = …` (le signalement garde la copie).
- Ajouter un mot : `insert into private.comment_words (word, lang, mode) values ('mot', 'fr', 'word');` (forme : minuscules sans accents, a-z et 0-9). Accepter un mot courant refusé à tort : `insert into private.comment_allowed (phrase) values ('mot');`.
- Alerte e-mail : comme un profil signalé (fonction Edge `report`, mode `{ report_id }`) ; sans alerte partie, la ligne garde `notified_at` nul (requête de rattrapage de `20261026050000_social.sql`).

### App
- **Séance d'un ami** et **ma séance vue par mes abonnés** (`social-session`) : groupe « Commentaires (N) », du plus ancien au plus récent, « Afficher les commentaires précédents », saisie en bas (compteur à partir de 450 caractères, bouton rond grisé si vide ou trop long), menu ⋯ par commentaire : « Signaler » (puis proposer de bloquer l'auteur, sans quitter la séance) sur celui d'un autre, « Supprimer » sur le mien et sur ma séance (confirmation pour celui d'un autre).
- **Historique › Séance** (ma séance, Amis activé) : le même groupe ; séance masquée : lecture seule.
- **Mon profil › Activité** : « lea a commenté ta séance Push : « … » », point bleu si nouveau ; toucher : ma séance dans l'Historique.
- **Saisie** : brouillon gardé par séance ; un changement reçu pendant la frappe ne redessine que la liste (le clavier reste).
- **privacy.html** : « Commentaires » dans Communauté (FR et EN).

### Ordre de mise en production
Migration d'abord, puis l'OTA. Une app à jour sur un serveur d'avant affiche « Commentaires indisponibles pour l'instant » sous chaque séance, sans rien casser. Retour arrière : `supabase/rollback/20261031500000_commentaires_down.sql` (après celui du chat s'il est en place), vérifié par `tests/sql/rollback_social_check.sh`.

## Fonction Edge `report` (vérifie le JWT)
- **Entrée** : POST `{ target_user uuid, kind: 'profile'|'session', target_ref?: text, reason: 'spam'|'harcelement'|'sexuel'|'violence'|'haine'|'autre', details?: text (500 caractères max) }`.
- **Effet** : insère dans `reports`, au plus 10 signalements par jour et par utilisateur.
- **Autre entrée** : POST `{ report_id }` seul (31/10/2026), alerte d'un signalement déjà écrit par `report_comment` ou `report_chat` : la ligne doit être à l'appelant et sans alerte partie (`notified_at` nul), sinon `{ ok: true }` sans rien envoyer (rien n'est révélé, redemander ne double pas l'e-mail). `report_id` qui n'est pas un entier positif : 400 `invalid`.
- **Alerte** : envoie un e-mail à contact@mdlf.app par Resend (secret `RESEND_API_KEY`, expéditeur noreply@mdlf.app). Le mail contient le pseudo signalé, le motif, la référence et un rappel du délai de réponse de 24 h.
- **Réponse** : `{ ok: true }`.

## App
- **Onglet « Amis »** (5e), avec un badge égal à `social_state().badge`. Le badge est rafraîchi à l'ouverture de l'app, au retour au premier plan et à l'ouverture de l'onglet.
- **États de l'onglet** :
  - sans compte : explication et bouton « Se connecter » ;
  - sans social : carte d'activation avec le pseudo (obligatoire, sinon lien pour le choisir), la case « J'ai 15 ans ou plus », un lien vers les règles de la communauté et le bouton « Activer » ;
  - social activé : champ de recherche, demandes reçues, puis le fil.
- **Fil** : chaque carte montre l'avatar et le pseudo, la date, le nom de la séance, la durée et un résumé des exercices, avec le bouton de réaction et le résumé des réactions (voir « Réactions et Mon profil »). Un toucher ouvre le détail des séries.
- **Profil d'un autre** : ses séances (`feed` avec `only_user`), puis les actions : se désabonner ou annuler la demande, Bloquer, Signaler.
- **Commentaires** : voir « Commentaires » ci-dessus.
- **Gestion** : demandes envoyées, bloqués (avec « Débloquer »), et « Désactiver le social » ; abonnés (avec « Retirer ») et abonnements dans Mon profil.
- **Bilan de fin de séance** : interrupteur « Visible sur mon profil », allumé par défaut, seulement si le social est activé ; éteint, la séance est enregistrée avec `hidden: true`.
- **Historique › séance** : le même interrupteur « Visible sur mon profil » (le champ `hidden`) et qui a réagi quand il y en a. Dans la liste, un œil barré marque une séance masquée (VoiceOver : « Masquée à tes abonnés »).
- **privacy.html** : section « Communauté », qui contient :
  - ce que voient les abonnés ;
  - les blocages et les signalements (gardés 12 mois) ;
  - la majorité numérique à 15 ans ;
  - les règles de la communauté et l'engagement de traiter un signalement sous 24 h.
