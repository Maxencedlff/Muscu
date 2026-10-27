# Coach V1 : contrat entre le serveur et l'app

Décisions de Maxence (26 et 27/10/2026) :
- un coach suit des élèves ; il garde toutes les fonctions d'un utilisateur normal ;
- élèves gratuits tant qu'ils sont suivis ; le coach paiera selon son nombre d'élèves, **mais pas en V1** : le rôle coach est donné à la main par l'administrateur (SQL), le temps de tester ;
- pas de messagerie ; à la place, des **consignes** (sur un programme ou un exercice) et un **commentaire** du coach sur une séance ;
- **envoi de programmes** du coach vers l'élève ;
- les élèves d'un même coach ne se voient pas entre eux ;
- notifications push : pas en V1 (elles demandent une build). Un badge dans l'app à la place.

Hors V1 : paiement, push, plusieurs coachs pour un élève, groupes d'élèves, messagerie.

## Principes (mêmes règles que docs/SOCIAL_V1.md)
- **Écritures par fonction seulement** : RPC `security definer`, `set search_path = ''`, utilisateur pris dans `auth.uid()`. Aucune écriture directe sur les nouvelles tables, RLS activée, GRANT explicites (`anon` n'a rien, `authenticated` seulement EXECUTE sur les RPC).
- **Erreurs** en snake_case : `not_coach`, `already_coached`, `invalid_code`, `team_full`, `not_found`, `rate_limited`, `too_long`.
- **Indépendant du social** : être coach ou élève ne demande pas d'avoir activé Amis, et ne rend visible dans aucune recherche. Un blocage social entre deux comptes n'empêche pas une relation coach (c'est l'élève qui l'a choisie avec un code) ; l'élève peut quitter à tout moment.
- **Suppression du compte** : tout part en cascade avec `auth.users`.

## Données
- `user_profiles.coach_at timestamptz` : non nul = coach. Écrit seulement par l'administrateur (aucune RPC ne le pose). La migration ne touche aucun compte : Maxence est déclaré coach par une commande SQL lancée à part.
- `coach_invites (code text primary key, coach_id, created_at, expires_at)` : code d'invitation de 8 caractères lisibles (sans 0/O/1/I), valable 7 jours, au plus 5 codes actifs par coach.
- `coach_links (coach_id, student_id unique, created_at)` : un élève a au plus UN coach. Au plus 50 élèves par coach (`team_full`).
- `coach_programmes (coach_id, student_id, id text, data jsonb, sent_at, seen_at)`, clé `(student_id, id)` : programmes envoyés. `data` = programme complet (voir plus bas), 200 Ko au plus.
- `coach_notes (coach_id, student_id, session_id text, text, updated_at, seen_at)`, clé `(student_id, session_id)` : commentaire du coach sur une séance de l'élève, 1000 caractères au plus, `seen_at` pour le badge.

## Ce que le coach voit d'un élève
Ses séances complètes, notes de séance comprises, **sans** `bodyKg` ni `healthSaved` : liste blanche `private.session_for_coach` = celle de `private.session_public` + `notes` + `hidden` + `id`. Les séances masquées aux abonnés restent visibles du coach (il est là pour ça), et l'écran d'acceptation le dit.
Ses programmes perso : non en V1 (le coach envoie les siens).

## Fonctions RPC (rôle `authenticated`)

| Fonction | Renvoie | Règles |
|---|---|---|
| `coach_state()` | `jsonb` | `{ is_coach, coach: p\|null, students: [p + { last_session_at, sessions_7d }], invites: [{ code, expires_at }], badge }`, `p = { user_id, username, avatar, since }`. `badge` (élève) = programmes non vus + commentaires non vus. |
| `coach_create_invite()` | `text` (code) | `not_coach` si pas coach. 5 codes actifs au plus (le plus ancien est remplacé). |
| `coach_revoke_invite(code text)` | `void` | |
| `coach_join(code text)` | `jsonb p` (le coach) | `invalid_code` (inconnu ou expiré), `already_coached` (a déjà un coach), `not_found` (son propre code), `team_full`. 10 essais par heure (`rate_limited`). Le code reste utilisable par d'autres élèves jusqu'à expiration. |
| `coach_preview(code text)` | `jsonb p` | Montre qui est le coach avant d'accepter ; mêmes erreurs que `coach_join`, sans rien créer. |
| `coach_leave()` | `void` | L'élève quitte son coach : lien, programmes envoyés non importés et commentaires supprimés côté serveur (les programmes déjà importés restent chez l'élève). |
| `coach_remove_student(student uuid)` | `void` | Même effet, à l'initiative du coach. |
| `coach_student_sessions(student uuid, before_at bigint default null, before_id text default null)` | `table(id, done_at, s jsonb, note text)` | Coach de cet élève seulement, sinon `not_found`. 30 par page, triées par `(done_at, id)` décroissant. `note` = son commentaire. |
| `coach_send_programme(student uuid, prog_id text, data jsonb)` | `void` | Coach de cet élève seulement. Remplace un envoi du même `prog_id` (mise à jour), `seen_at` remis à null. 30 envois par jour. |
| `coach_set_note(student uuid, session_id text, text text)` | `void` | Texte vide = supprime. `seen_at` remis à null. |
| `student_inbox()` | `jsonb` | Élève : `{ programmes: [{ id, data, sent_at, seen }], notes: [{ session_id, text, updated_at, seen }] }`. |
| `student_mark_seen(kind text, ref text)` | `void` | `kind` = `programme` ou `note`. |

## Programme envoyé (`data`)
Format de js/data/prog-share.js étendu, validé par l'app à la réception :
`{ name, consigne?, sessions: [{ key, label, color, exercises: [{ name, sets, rest?, measure?, tempo?, repMax?, ss?, consigne? }] }] }`.
- `consigne` (programme ou exercice) : texte du coach, 500 caractères au plus.
- À l'import, l'élève reçoit un programme perso (`userProgrammes`, id `u_c<prog_id>`), marqué `fromCoach: { coachId, name, sentAt }`. Un nouvel envoi du même `prog_id` met à jour le programme importé (exercices et consignes), en gardant les `id` d'exercices dont le nom ne change pas, pour garder l'historique.
- L'élève peut l'utiliser comme n'importe quel programme ; s'il le modifie, un nouvel envoi lui demande avant d'écraser.

## App
- **Réglages › Coach** (tout le monde) : « Rejoindre un coach » (saisie du code, puis aperçu du coach et de ce qu'il verra, puis « Accepter ») ; si suivi : le coach, « Quitter mon coach ».
- **Onglet Amis** : en haut, une cellule « Mes élèves » (coach) ou « Mon coach » (élève), avec le badge. L'onglet reste utilisable sans avoir activé Amis pour cette partie.
- **Coach › Mes élèves** : liste (dernière séance, séances sur 7 jours), « Inviter un élève » (code + partage du texte d'invitation avec la feuille de partage), codes actifs ; un élève → ses séances (détail comme Historique, notes comprises) avec « Commenter », « Envoyer un programme » (choisir un de mes programmes, ajouter des consignes au programme et par exercice), « Retirer l'élève ».
- **Élève** : programme reçu → carte « Nouveau programme de <coach> » (Mon coach et accueil) avec « Ajouter à mes programmes » ; consignes visibles dans Programme › Séance, dans la séance (sous le nom de l'exercice, repliable) ; commentaire du coach dans Historique › Séance.
- **Badge** : sur l'onglet Amis = badge social + badge coach.
- Hors ligne : messages clairs, rien de perdu.
