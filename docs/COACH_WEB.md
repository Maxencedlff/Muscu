# MDLF Coach sur ordinateur (appli web du coach) : vague 1

Demande d'un coach partenaire (24/11/2026) : faire ses retours sur un iPhone 12 est « horrible », il travaille sur PC ou
tablette. Décision de Maxence : une **application web dans le navigateur** (Linux, Mac, Windows, iPad, tablettes
Android), et des bilans entièrement configurables par chaque coach (vague 2). Note d'architecture et plan en vagues :
`~/.local/share/mdlf/coach-web/NOTE.md` ; maquette validée le 24/11 : `~/.local/share/mdlf/coach-web/maquette/`.

**Vague 1 (ce document)** : connexion par code e-mail, tableau de bord « Élèves », fiche élève « Semaines ».
Rien n'est déployé : ni Vercel, ni mise à jour à chaud. La migration `20261124010000_semaines_coach.sql` est écrite,
pas appliquée ; l'appli marche sans elle.

## Où, et pourquoi sans framework

```
coach-web/index.html        page d'entrée : CSP stricte, scripts partagés de js/ (../js/…), puis js/desk/
coach-web/css/desk.css      styles (jetons clair / sombre, mise en page 768 à 1920 px et plus)
coach-web/js/desk/env.js    remplace js/data/account.js pour les scripts partagés (voir « Réutilisation »)
coach-web/js/desk/model.js  logique pure : lignes du tableau de bord, semaines, courbe, chiffres
coach-web/js/desk/api.js    connexion (code e-mail), appels RPC, lectures du tableau de bord et de la fiche
coach-web/js/desk/apple.js  Se connecter avec Apple (Sign in with Apple JS, nonce, bouton)
coach-web/js/desk/shell.js  cadre : barre latérale, barre d'onglets en bas, icônes, annonces
coach-web/js/desk/dashboard.js, student.js   les deux écrans (gabarits HTML, tout texte reçu passe par esc())
coach-web/js/desk/main.js   routes (#/, #/eleve/<id>, #/reglages), gestes, clavier, inactivité, démarrage
coach-web/vercel.json       en-têtes du futur déploiement (copié dans dist-coach/ par la construction)
scripts/build-coach-web.mjs construction : dist-coach/ (npm run coach-web:build)
```

Choix : **les mêmes scripts classiques que l'app, sans framework ni bundler.** L'app entière est écrite ainsi
(ARCHITECTURE.md) ; la logique à reprendre (`js/data/`) est faite de scripts classiques à portée globale. Un framework
(React, Vue) ou un bundler demanderait soit de recopier cette logique, soit de passer d'abord toute l'app aux modules
ES (prévu, mais c'est un chantier de l'app iPhone, pas de cette vague). Deux écrans faits de listes et d'un tableau
n'ont pas besoin d'un DOM virtuel : un rendu par gabarits (`innerHTML`, textes échappés) et une délégation
d'événements suffisent, comme dans l'app. Aucune dépendance nouvelle : supabase-js est déjà celle de l'app (même
version figée).

## Réutilisation de js/data/ (aucune copie)

`coach-web/index.html` charge **35 fichiers de l'app tels quels**, dans l'ordre de l'`index.html` de l'app (vérifié par
`tests/unit/coach-web.mjs`) : calculs et formats (`util.js`, `store.js`, `records.js`, `measures.js`,
`session-review.js` pour le volume), nettoyage de ce que rend le serveur (`cleanCoachState`, `cleanCoachProgress`,
`cleanCoachPlans`, `cleanChatThreads`, `cleanDietOverview`, `cleanCoachDiet`, `cleanCoachWeights`,
`cleanCoachMeasures`, `cleanCoachSessionRow`), règles du suivi (`studentProgress`, `coachStudentIn`,
`dietShareStatus`, `dietShareWarn`, `dietShareWeekCount`, `planCurrent`, `phaseProgress`), erreurs (`coachErrorKind`,
`authErrorKind`, `otpErrorKind`, `AUTH_ERROR_TEXT`) et accords « Ma coach » (`coachWord`, forme lue par `coach_form`).

Séparé de l'écran de l'app : `personName` (pseudo, sinon « Compte masqué ») est passé de
`js/features/social-ui.js` à `js/data/social.js` (logique pure dont `sortStudentsByProgress` a besoin), sans
changement pour l'app.

**`js/data/account.js` n'est pas chargé** (synchro des séances, Trousseau, copies sur l'appareil). `js/desk/env.js`
fournit les trois noms que les scripts partagés attendent : `sb` (posé par `api.js`), `account` figé à `{ user: null }`
et `onAccountChange` sans effet. Conséquence voulue : les écouteurs des modules partagés (relecture de
`coach_state` au premier plan, envoi des pesées d'un élève, caches `mdlf_*`) ne font jamais rien sur un ordinateur.
L'appli web lit le serveur par ses propres appels (`deskRpc`) et ne garde rien hors de la mémoire de l'onglet. La
clé publique et l'adresse du projet sont identiques à `ACCOUNT_CONFIG` (vérifié par le test unitaire).

## Connexion et sécurité

- **Se connecter avec Apple** (en haut, avant l'e-mail ; section « Connexion avec Apple » ci-dessous), ou code à 6
  chiffres par e-mail (`signInWithOtp` avec `shouldCreateUser: false` : jamais de compte créé par l'e-mail, puis
  `verifyOtp`). Même compte que l'iPhone, même `auth.uid()`. Google sur le web : plus tard.
- **Seul un coach validé entre** : `coach_state().is_coach`, sinon l'écran « Réservé aux coachs ». Le vrai verrou
  reste le serveur : chaque RPC lue ici est `security definer`, `search_path = ''`, prend l'utilisateur dans
  `auth.uid()` et vérifie le lien (`private.coach_require_student` : mon élève, et je suis encore coach), tables
  sans GRANT client. Vérifié : `coach_state`, `coach_progress`, `coach_plans`, `chat_threads`,
  `coach_diet_overview`, `coach_student_sessions`, `coach_student_weights`, `coach_student_measures`,
  `coach_student_diet`, `coach_my_code`, `coach_tier_state`, `coach_form` suffisent ; une seule fonction ajoutée
  (`coach_student_weeks`, ci-dessous) pour lire la fiche en un appel, qui n'expose rien de plus.
- Ordinateur parfois partagé : fermeture après **30 minutes sans geste** (vérifiée au rechargement, au retour sur
  l'onglet et chaque minute), « Se déconnecter de cet ordinateur » (Réglages ; `signOut({ scope: 'local' })` :
  l'iPhone reste connecté). Dans le navigateur, seules la session de supabase-js (`mdlf-coach-web-auth`) et l'heure du
  dernier geste (`mdlf_coach_web_active`) sont gardées ; aucune donnée d'élève (test E2E).
- CSP de la page : scripts et styles du site seulement, plus le seul script `https://appleid.cdn-apple.com`
  (Sign in with Apple JS), aucun script en ligne, `connect-src` vers le projet Supabase seulement, `frame-src 'none'`
  (le script d'Apple n'ouvre aucun cadre ni aucune connexion : il ouvre une fenêtre surgissante sur appleid.apple.com,
  que la CSP ne régit pas, et en reçoit la réponse par `postMessage`, origine vérifiée par le script). En-têtes du
  déploiement (`coach-web/vercel.json`) : la même CSP avec `frame-ancestors 'none'`, HSTS,
  `Referrer-Policy: no-referrer`, `Permissions-Policy` fermée, `X-Frame-Options: DENY`, `noindex`, et
  `Cross-Origin-Opener-Policy: same-origin-allow-popups` (avec `same-origin`, la fenêtre d'Apple perdrait le lien
  avec la page et la connexion finirait toujours en « fenêtre fermée »).

## Connexion avec Apple

Le compte de Maxence, et souvent celui de ses coachs, n'a qu'Apple (aucune adresse e-mail) : sans Apple, pas de site.

**Méthode : Sign in with Apple JS en fenêtre surgissante + `signInWithIdToken`** (`coach-web/js/desk/apple.js`).
Le script officiel d'Apple (`appleid.cdn-apple.com/…/fr_FR/appleid.auth.js`, chargé au démarrage de l'écran de
connexion) ouvre la fenêtre d'Apple (`usePopup: true`) et rend un `id_token` à la page ; la page l'échange contre une
session par `supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce })`. Pourquoi pas le flux OAuth par
redirection (`signInWithOAuth`) : il demande un secret client Apple (JWT signé par une clé .p8) à refaire tous les
6 mois dans Supabase, et une URL de retour sur Supabase. Ici, aucun secret : Supabase vérifie la signature du jeton
avec les clés publiques d'Apple et son audience (le Services ID doit figurer dans `external_apple_client_id` ; doc
Supabase, « Sign in with Apple » : le flux `signInWithIdToken` accepte comme audience n'importe quel identifiant de la
liste, dans n'importe quel ordre ; le premier ne compte que pour `signInWithOAuth`).

- **Nonce** : nonce brut aléatoire (32 octets, base64url) ; Apple reçoit son SHA-256 en hexadécimal (`nonce` de
  `AppleID.auth.init`, recopié tel quel dans le jeton), Supabase reçoit le nonce brut et compare son SHA-256 au jeton
  (même règle que la doc Supabase pour Google et que le flux natif de l'app). Un nonce et un `state` neufs à chaque
  essai, préparés avant le clic : `AppleID.auth.signIn()` part dans le geste, sans attente (sinon Safari bloque la
  fenêtre). `state` revérifié à la réponse.
- **Seul un coach validé entre** : après Apple, même contrôle `coach_state().is_coach` que pour l'e-mail. Limite
  connue : `signInWithIdToken` crée un compte si l'identifiant Apple est inconnu (Supabase n'a pas d'option « sans
  création » pour ce flux, contrairement à l'OTP). Ce compte vide n'a accès à rien (écran « Réservé aux coachs », avec
  « Cet identifiant Apple n'avait pas encore de compte MDLF… ») ; c'est le même comportement que le bouton Apple de
  l'app.
- **Bouton** dessiné par la page selon les règles d'Apple (logo Apple, « Se connecter avec Apple », noir sur fond
  clair, blanc sur fond sombre, 50 px de haut) : le bouton que dessine le script d'Apple pose des styles en ligne,
  refusés par la CSP (`style-src 'self'`).
- **Erreurs** : fenêtre fermée ou « Annuler » (c'est aussi ce que voit le coach quand Apple affiche une erreur, par
  exemple Services ID pas encore configuré) : « Connexion avec Apple annulée. Si la fenêtre d'Apple affichait une
  erreur… reçois un code par e-mail » ; fenêtre bloquée par le navigateur ; Services ID absent de
  `external_apple_client_id` (« Unacceptable audience ») : « La connexion avec Apple n'est pas encore ouverte sur ce
  site » ; hors ligne.
- **Sans le script** (bloqueur, réseau, 10 s sans réponse, navigateur sans Web Crypto) : le bouton et le « ou »
  disparaissent, le texte sous le formulaire dit de recharger ou d'ajouter une adresse dans l'app ; l'e-mail marche.
- **Adresse de retour** : `location.origin + '/'`. Chaque adresse du site (aujourd'hui `https://mdlf-coach.vercel.app/`,
  demain peut-être `https://coach.mdlf.app/`) doit être déclarée sur le Services ID, sinon Apple répond
  « invalid_request ». Les adresses de prévisualisation de Vercel ne marchent donc pas avec Apple (e-mail seulement).

### À faire par Maxence dans developer.apple.com (une fois)

Vérifié sur l'aide d'Apple (« Configure Sign in with Apple for the web », developer.apple.com/help/account) le 24/11/2026.

1. Ouvrir https://developer.apple.com/account/resources/identifiers/list (Certificates, Identifiers & Profiles ›
   Identifiers).
2. Vérifier d'abord l'App ID de l'app : cliquer sur `com.mdlf.training` ; dans la liste des Capabilities,
   « Sign in with Apple » doit être cochée (c'est déjà le cas, la connexion Apple de l'app marche) et réglée en
   « Enable as a primary App ID ». Revenir à la liste sans rien changer.
3. Cliquer sur le bouton **+** (en haut à gauche, à côté de « Identifiers »).
4. Choisir **Services IDs**, puis **Continue**.
5. **Description** : `MDLF Coach (site web)` ; **Identifier** : `com.mdlf.training.coach`. **Continue**, puis
   **Register**.
6. Dans la liste des identifiants, ouvrir le menu en haut à droite (« App IDs ») et choisir **Services IDs** ; cliquer
   sur `com.mdlf.training.coach`.
7. Cocher **Sign in with Apple**, puis cliquer sur **Configure** à côté.
8. Dans la fenêtre qui s'ouvre :
   - liste des **primary App IDs** : choisir `com.mdlf.training` (MDLF Training) ;
   - sous **Website URLs** : le domaine `mdlf-coach.vercel.app` (sans https://) dans **Domains and Subdomains**, et
     l'adresse de retour `https://mdlf-coach.vercel.app/` (avec la barre finale, l'adresse exacte que la page envoie)
     dans **Return URLs**. Si l'écran n'a qu'un seul champ, y mettre les deux, séparés par une virgule :
     `mdlf-coach.vercel.app,https://mdlf-coach.vercel.app/`.
   Puis **Done**.
9. **Continue**, puis **Save** (confirmer si Apple le demande).
10. Aucune clé .p8, aucun « Team ID » ni secret à créer, et rien à téléverser sur le site (Apple ne demande plus de
    fichier de vérification du domaine). Les changements chez Apple peuvent mettre quelques minutes à s'appliquer.

Si un jour le site passe sur `coach.mdlf.app` : refaire les étapes 6 à 9 pour ajouter ce domaine et
`https://coach.mdlf.app/` (un compte individuel a droit à 10 adresses par Services ID).

### Changement Supabase (fait par l'API de gestion, pas depuis le site)

`external_apple_client_id` : `com.mdlf.training` → `com.mdlf.training.coach,com.mdlf.training`. Le Services ID en
premier (la doc Supabase le demande pour un futur `signInWithOAuth`, sans effet sur `signInWithIdToken`, qui accepte
les deux identifiants). Rien d'autre : pas de secret, `site_url` et `uri_allow_list` inchangés (pas de redirection
vers Supabase dans ce flux).

```
PATCH https://api.supabase.com/v1/projects/yopptmdjtnezmccdvaxf/config/auth
{ "external_apple_client_id": "com.mdlf.training.coach,com.mdlf.training" }
```

Vérification : relire la config (`GET …/config/auth`), puis sur le site, « Se connecter avec Apple » avec le compte
Apple de l'app. Avant ce changement, Apple marche mais Supabase répond « Unacceptable audience » : la page dit « pas
encore ouverte sur ce site ». L'app iPhone n'est pas touchée (`com.mdlf.training` reste dans la liste).

## Tableau de bord « Élèves »

- **Liste réelle** de `coach_state().students`, les élèves **à traiter** en tête, du plus urgent : sans séance depuis
  8 jours ou plus (ou jamais venu), en baisse (règles de `studentProgress`, docs/COACH_SUIVI.md), diète pas suivie
  3 jours (`dietShareWarn`), messages non lus (`chat_threads`), sans programme (`coachStudentIn('noprog')`). Puis
  « Les autres » : nouvelles séances, records, la semaine. Ce qui dépend des bilans configurables (« bilan reçu,
  à répondre ») arrive en vague 2.
- **Pastilles des 7 derniers jours** : une par jour, séance faite ce jour-là (`coach_progress`, 35 jours) ; diète
  du jour (suivie, partielle, pas suivie, rien de noté, aujourd'hui en cours) si l'élève la partage
  (`coach_diet_overview`, 8 jours), sinon « Non partagée ».
- Segments À traiter, Tous, À relancer, Nouveautés, Sans programme, compteurs exacts ; **recherche** par pseudo
  (casse et accents ignorés, `normName`) ; phase en cours (« Sèche · sem. 5 sur 8 ») ; dernière séance.
- **Code d'invitation** : le code permanent du coach (`coach_my_code`), « Copier » ; à défaut un code de 7 jours. Le
  palier (« 25 élèves offerts par ton abonnement, 15 places libres ») seulement verrou de l'abonnement allumé.
- À partir de 1240 px, panneau de droite (cette semaine, planning des 7 prochains jours, invitation) ; en dessous, la
  ligne de chiffres en tête et l'invitation derrière « Inviter un élève ».

## Fiche « Semaines »

Semaine du lundi au dimanche (numéro ISO), de la semaine en cours vers le passé : 8 semaines, puis 12 (« Afficher
les semaines précédentes » ; la diète partagée est gardée 90 jours). Colonnes, avec ce que l'élève partage déjà :

| Colonne | Source | Sans partage |
|---|---|---|
| Poids : moyenne des pesées de la semaine, écart avec la semaine pesée d'avant | `coach_student_weights` | « — », « non partagé » |
| Séances faites | séances de la fenêtre | toujours (le coach voit les séances) |
| Volume (t) | `reviewVolume` : charge notée × reps, échauffement exclu, poids du corps seulement s'il est partagé | |
| Records : un par exercice | `records` notés par l'app | |
| Diète : jours suivis sur jours notés, kcal moyennes | `coach_student_diet`, `dietShareStatus` | « — » |
| Eau : litres par jour noté | `coach_student_diet` (`water`) | « — » |
| Mensurations (2 colonnes, toutes dans le panneau) | `coach_student_measures` | « non partagées » |

Les **défis ne sont pas partagés** avec le coach (docs/DEFIS.md, « Coach : rien en V1 ») : le pied du tableau le dit.
Le sommeil, les pas, le stress… viendront des bilans configurables (vague 2) et du partage des données Santé (vague 3).
Courbe du poids sur 90 jours (SVG décrit pour les lecteurs d'écran), mensurations avec leur écart. Les onglets
Bilans, Programme, Nutrition et Messages sont présents, désactivés et annoncés « bientôt ».

## Serveur : `coach_student_weeks` (migration écrite, PAS appliquée)

`supabase/migrations/20261124010000_semaines_coach.sql` : `coach_student_weeks(student uuid, weeks int default 12)`
rend en un appel `{ weeks, from, sessions, weights, measures, diet }`, chaque partie identique à la fonction existante
(mêmes vérifications, même liste blanche des séances, poids du corps seulement avec le consentement) ; fenêtre de 1 à
26 semaines, 150 séances au plus ; `measures` et `diet` appelés seulement si leurs fonctions existent (la migration du
suivi de la diète, 20261118, peut être appliquée avant ou après). Sans la fonction (`PGRST202`), l'appli fait les
mêmes lectures une par une (séances par pages de 30 jusqu'au début de la fenêtre, 6 pages au plus) : rien ne casse.

- Tests : `tests/sql/semaines_coach_test.sql` (droits, anon, autre coach, ex-coach, non-élève, égalité avec les
  fonctions existantes, séance supprimée ou future, liste blanche, bornes) ; `tests/sql/partage_coach_test.sql`
  l'ajoute à la liste des fonctions qui lisent le consentement.
- Retour arrière : `supabase/rollback/20261124010000_semaines_coach_down.sql`, vérifié par
  `tests/sql/semaines_coach_rollback_test.sh` (schéma identique à celui d'avant, puis la migration repasse).
- Ordre de mise en production : la migration quand Maxence le dit, puis le site. Le site d'avant la migration marche.

## Plateformes, ergonomie, accessibilité

- Chrome et Edge (Windows, Mac, Linux), Firefox, Safari macOS, Safari iPadOS 16.4 et plus, Chrome Android tablette.
- **Mise en page** : 3 colonnes à partir de 1240 px (barre latérale, contenu, panneau) ; 2 de 900 à 1239 px (iPad
  paysage 1180) ; sous 900 px (tablette en portrait, 820), barre d'onglets en bas et panneaux sous le contenu ;
  au-delà de 1920 px, largeur bornée et centrée.
- **Tactile** : toute cible fait 44 px au moins (vérifié par le test E2E sur chaque écran), rien ne dépend du survol
  (il ne fait qu'éclaircir), champs à 16 px au moins (pas de zoom de Safari).
- **Clavier** : `/` recherche, `J` / `K` élève suivant ou précédent, `Entrée` ouvre (c'est un lien), `Échap` vide la
  recherche ; focus toujours visible (anneau orange).
- **Lecteur d'écran** : rubriques en `nav`, titres `h1` / `h2`, listes `ul` nommées, pastilles en `role="img"` avec
  leur phrase (« Diète des 7 derniers jours : lundi suivie, … »), tableau avec en-têtes de colonne et de ligne,
  segments en `radiogroup`, onglets en `tablist` (`aria-disabled` pour « bientôt »), annonces en `aria-live`.
- **Design** (règles de Maxence) : SF Pro ou la pile système ; noir pur en sombre, clair selon le réglage du système ;
  un seul orange en accent, jamais en aplat sous un texte noir (boutons teintés : fond orange pâle, texte orange
  foncé) ; aucun dégradé, aucune lueur, aucun verre, aucune ombre de carte, pas de majuscules espacées.

## Tests

- `node tests/unit/run.mjs` : `tests/unit/coach-web.mjs` (contexte vm des scripts exacts de la page) : ordre et
  liste des scripts, même projet Supabase, aucune écriture sur l'appareil, semaines ISO et plages de dates, tri par
  urgence, pastilles, segments, recherche, agrégats des semaines, courbe, un appel ou repli page par page, erreurs,
  palier, échappement des textes reçus, onglets « bientôt » ; Apple : nonce brut et SHA-256, neuf à chaque essai,
  `state` vérifié, erreurs (annulation, fenêtre bloquée, audience refusée, hors ligne).
- `python3 tests/test_coach_web.py` (`npm run test:coach-web`, `PPL_ENGINES=chromium` pour un seul moteur) :
  Chromium, Firefox, WebKit × 1440, 1180, 820 px (tactile en tablette) × sombre, clair : liste, ordre, fond noir pur,
  pas de défilement en largeur, cibles de 44 px, barre latérale ou d'onglets, recherche, fiche, 12 semaines, CSP,
  aucune erreur, rien des élèves dans localStorage ; puis clavier, segments, invitation, un seul appel pour la fiche,
  repli sans la migration, mauvais code, compte non coach, déconnexion, Apple avec un faux Apple JS (bouton au-dessus de
  l'e-mail, nonce, annulation, audience refusée, identifiant Apple inconnu, script injoignable : e-mail seul), et la
  version construite avec le vrai supabase-js. Coach et élèves factices de `tests/coach_web_fixtures.py` sur le faux serveur de
  `tests/fake_account.py` (aucun réseau, code factice).
- `python3 tests/coach_web_captures.py <dossier> [moteur]` : captures de chaque écran, sombre et clair, 1440, 1180, 820.
- CI : job `coach-web` de `tests.yml` (un par moteur, conteneur officiel de Playwright), syntaxe de `coach-web/js`,
  tests SQL et retour arrière dans `unit`. Le job `deploy` l'attend.

## Déploiement (préparé, pas fait)

1. `npm ci && npm run coach-web:build` : `dist-coach/` (page, styles, les 35 scripts partagés exacts, supabase-js,
   `vercel.json`).
2. Projet Vercel à part (par exemple `mdlf-coach`, domaine `coach.mdlf.app`), sans build côté Vercel (dossier
   statique) : `npx vercel@62.0.0 deploy dist-coach --prod --yes --token "$VERCEL_TOKEN"`, avec
   `VERCEL_PROJECT_ID` de ce projet. `git.deploymentEnabled: false` : rien ne part tout seul.
3. Supabase Auth : rien à changer pour le code e-mail (aucun lien de retour). Pour Apple : Services ID dans
   `external_apple_client_id` (« Connexion avec Apple »), aucune URL de retour Supabase.
4. Après la publication : `curl -sI https://coach.mdlf.app` doit rendre 200 et les en-têtes de `vercel.json`.

## Suite : vague 2 (bilans configurables)

Migration des modèles, groupes, plannings, demandes et réponses (NOTE.md, « Bilans configurables ») ; écran « Mes
bilans » sur le web (éditeur, glisser-déposer au doigt, à la souris et au clavier) ; écran du bilan dans l'app iPhone
(build soumise à Apple) ; fiche Semaines qui prend les colonnes du modèle de l'élève ; « Bilans reçus » avec réponse
et note ; signal « bilan reçu, à répondre » dans le tableau de bord.
