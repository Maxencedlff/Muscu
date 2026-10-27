# Social V1 : contrat entre le serveur et l'app

Décisions de Maxence (26/10/2026) :
- 5e onglet « Amis » ;
- réaction « Bravo » sans texte ;
- 13+ déclaré à Apple et case « J'ai 15 ans ou plus » à l'activation ;
- pseudo obligatoire pour être trouvé ;
- les abonnés voient tout l'historique, avec « Masquer à mes abonnés » par séance, mais jamais les notes, le poids du corps ni Santé (décision du 25/10) ;
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
- **bravos** `(session_owner, session_id, user_id, created_at)`, clé primaire sur les trois premiers champs.
- **reports** : signalements, écrits uniquement par la fonction Edge `report`.

## Liste blanche d'une séance vue par un autre (`private.session_public`)
`{ date, duration, programme, category, label, exercises: [{ name, measure, ss, sets: [{ weight, reps, dist }] }] }`

`ss` : identifiant du superset de l'exercice (ajouté le 27/10/2026, migration 20261027000000_supersets.sql).

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
| `toggle_bravo(owner uuid, session_id text)` | `jsonb {bravos, mine}` | Seulement sur une séance que `feed` me montrerait, sinon `not_found`. Pas sur mes propres séances. Au plus 200 par jour. |
| `my_bravos()` | `table(session_id text, bravos int)` | Bravos reçus sur mes séances, pour Historique. |

## Fonction Edge `report` (vérifie le JWT)
- **Entrée** : POST `{ target_user uuid, kind: 'profile'|'session', target_ref?: text, reason: 'spam'|'harcelement'|'sexuel'|'violence'|'haine'|'autre', details?: text (500 caractères max) }`.
- **Effet** : insère dans `reports`, au plus 10 signalements par jour et par utilisateur.
- **Alerte** : envoie un e-mail à contact@mdlf.app par Resend (secret `RESEND_API_KEY`, expéditeur noreply@mdlf.app). Le mail contient le pseudo signalé, le motif, la référence et un rappel du délai de réponse de 24 h.
- **Réponse** : `{ ok: true }`.

## App
- **Onglet « Amis »** (5e), avec un badge égal à `social_state().badge`. Le badge est rafraîchi à l'ouverture de l'app, au retour au premier plan et à l'ouverture de l'onglet.
- **États de l'onglet** :
  - sans compte : explication et bouton « Se connecter » ;
  - sans social : carte d'activation avec le pseudo (obligatoire, sinon lien pour le choisir), la case « J'ai 15 ans ou plus », un lien vers les règles de la communauté et le bouton « Activer » ;
  - social activé : champ de recherche, demandes reçues, puis le fil.
- **Fil** : chaque carte montre l'avatar et le pseudo, la date, le nom de la séance, la durée et un résumé des exercices, avec un bouton « Bravo » et son compte. Un toucher ouvre le détail des séries.
- **Profil d'un autre** : ses séances (`feed` avec `only_user`), puis les actions : se désabonner ou annuler la demande, Bloquer, Signaler.
- **Gestion** : abonnés (avec « Retirer »), abonnements, bloqués (avec « Débloquer »), et « Désactiver le social ».
- **Historique › séance** : « Masquer à mes abonnés » (le champ `hidden`) et « N bravos » quand il y en a.
- **privacy.html** : section « Communauté », qui contient :
  - ce que voient les abonnés ;
  - les blocages et les signalements (gardés 12 mois) ;
  - la majorité numérique à 15 ans ;
  - les règles de la communauté et l'engagement de traiter un signalement sous 24 h.
