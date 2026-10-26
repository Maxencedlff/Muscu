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
- **Blocage** : il coupe tout dans les deux sens (recherche, demandes, fil, bravos) et n'est jamais révélé. Une demande vers quelqu'un qui t'a bloqué répond comme une demande normale, sans rien créer.
- **Suppression du compte** : tout part en cascade avec `auth.users`.
- **GRANT explicites** : obligatoires depuis le 30/10/2026. `anon` n'a rien.

## Données
- **user_profiles** : nouvelle colonne `social_at timestamptz`, nulle tant que le social n'est pas activé. On ne peut pas l'écrire directement, seulement par `social_enable` et `social_disable`.
- **sessions** : nouvelle colonne générée `done_at bigint` (à partir de `data->'date'`), indexée `(user_id, done_at desc) where deleted_at is null`.
- **Champs que l'app envoie en plus dans `sessions.data`** :
  - `label` : nom affiché de la séance (`rawLabel`), calculé au moment de la synchro ;
  - `hidden: true` : séance masquée aux abonnés (absent = visible).
- **follows** `(follower_id, followee_id, status 'pending'|'accepted', created_at, responded_at)`.
- **blocks** `(blocker_id, blocked_id, created_at)`.
- **bravos** `(session_owner, session_id, user_id, created_at)`, clé primaire sur les trois premiers champs.
- **reports** : signalements, écrits uniquement par la fonction Edge `report`.

## Liste blanche d'une séance vue par un autre (`private.session_public`)
`{ date, duration, programme, category, label, exercises: [{ name, measure, sets: [{ weight, reps, dist }] }] }`

Rien d'autre ne sort : ni `notes`, ni `bodyKg`, ni `healthSaved`, ni `hidden`, ni aucune clé future.

## Fonctions RPC (rôle `authenticated` seulement)

| Fonction | Renvoie | Règles |
|---|---|---|
| `social_enable(age_ok boolean)` | `void` | Erreur `username_required` sans pseudo, `age_required` si `age_ok` n'est pas vrai. Pose `social_at = now()`. Peut être rappelée sans effet. |
| `social_disable()` | `void` | Remet `social_at` à null : invisible dans la recherche, séances invisibles pour les abonnés. Les relations sont gardées. |
| `social_state()` | `jsonb` | `{ enabled, username, avatar, pending_in: [p], following: [p], followers: [p], requested: [p], blocked: [p], badge }`, où `p = { user_id, username, avatar, since }`. `badge` = nombre de demandes reçues en attente. |
| `search_profiles(q text)` | `table(user_id, username, avatar, relation)` | `q` normalisé (minuscules, sans accent, sans `@`), 2 caractères minimum, recherche par préfixe du pseudo, 20 résultats. Exclut soi-même, les profils sans `social_at`, et les blocages dans les deux sens. `relation` vaut `'none'`, `'requested'`, `'following'` ou `'follows_you'`. |
| `request_follow(target uuid)` | `text` | `'requested'`, ou `'following'` si la relation existe déjà. `social_not_enabled` si l'appelant n'a pas activé le social. Cible bloquée ou bloquante, ou sans social : renvoie `'requested'` sans rien créer. Au plus 30 demandes par jour. |
| `cancel_follow(target uuid)` | `void` | Retire ma demande ou mon abonnement. |
| `respond_follow(follower uuid, accept boolean)` | `void` | Accepte, ou supprime la ligne si refusé. |
| `remove_follower(follower uuid)` | `void` | Supprime l'abonnement de quelqu'un à moi. |
| `block_user(target uuid)` / `unblock_user(target uuid)` | `void` | Le blocage supprime les abonnements dans les deux sens et les bravos échangés. |
| `feed(before bigint default null, only_user uuid default null)` | `table(owner, username, avatar, id, done_at, s jsonb, bravos int, my_bravo boolean)` | Séances des personnes que je suis, si leur abonnement est accepté, leur social activé, sans blocage, séance non supprimée et non masquée. Triées par `done_at` décroissant, 20 par page. `only_user` sert à l'écran d'un profil : vide si je ne le suis pas. |
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
