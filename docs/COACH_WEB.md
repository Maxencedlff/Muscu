# MDLF Coach sur ordinateur (appli web du coach) : vagues 1, 2 et 4

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
coach-web/js/desk/checkins-model.js  vague 2 : logique pure des bilans (éditeur, comparaison, colonnes, signal)
coach-web/js/desk/templates.js       vague 2 : écran « Mes bilans » (#/bilans), éditeur, glisser-déposer
coach-web/js/desk/review.js          vague 2 : onglet Bilans de la fiche, liste « Bilans reçus » (#/bilans-recus)
coach-web/js/desk/chat-model.js, messages.js   vague 4 : Messages (#/messages, onglet Messages de la fiche)
coach-web/js/desk/prog-model.js, programme.js  vague 4 : onglet Programme (éditeur des séances, envoi à un ou plusieurs)
coach-web/js/desk/diet-model.js, nutrition.js  vague 4 : onglet Nutrition (plan envoyé, semaine cochée, envoi d'un plan)
coach-web/js/desk/main.js   routes, gestes, clavier, inactivité, confirmation avant de quitter, démarrage (deskStart)
coach-web/vercel.json       seule source des en-têtes : traduits en _headers (Cloudflare Pages) par la construction
coach-web/404.html          page des adresses inconnues (sans elle, Pages répondrait index.html en 200)
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

## Déploiement

Hébergement : **Cloudflare Pages**, projet `mdlf-coach`, domaine `coach.mdlf.app` (depuis le 25/11/2026 ; avant :
Vercel, gardé en secours). Détail, retour arrière et ménage chez Vercel : docs/HEBERGEMENT.md.

1. **Automatique** : job `coach-web-deploy` de `tests.yml`, sur main, seulement quand `unit`, `e2e`, `coach-web` et
   `edge` sont verts. Il construit `dist-coach/`, le publie par wrangler (version figée), vérifie que coach.mdlf.app
   sert la page construite et écrit le commit publié dans le résumé du job.
2. À la main (dépannage seulement) : `npm ci && npm run coach-web:build` (`dist-coach/` : page, styles, scripts
   partagés exacts, supabase-js, `404.html`, `_headers` traduit de `coach-web/vercel.json`), puis
   `npx --yes wrangler@4.157.0 pages deploy dist-coach --project-name mdlf-coach --branch main` avec
   `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` dans l'environnement.
3. Secours Vercel (projet `mdlf-coach`, plus publié depuis le 25/11) : `node scripts/build-coach-web.mjs --vercel`
   (copie `vercel.json` au lieu de `_headers`), puis `npx vercel@62.0.0 deploy dist-coach --prod --yes`.
4. Supabase Auth : rien à changer pour le code e-mail (aucun lien de retour). Pour Apple : Services ID dans
   `external_apple_client_id` (« Connexion avec Apple »), aucune URL de retour Supabase. Le domaine coach.mdlf.app n'a
   pas changé avec l'hébergeur : le Services ID reste bon.
5. Vérifier : `curl -sI https://coach.mdlf.app` rend 200 et les en-têtes de `coach-web/vercel.json`.

## Vague 2 : bilans configurables (partie web du coach)

Contrat serveur et logique partagée : docs/BILANS.md (`js/data/checkins.js`, chargé tel quel après `diet-share.js`).
Rien n'est déployé ; la migration des bilans n'est pas appliquée et **l'appli web marche sans elle** : chaque écran des
bilans dit « Les bilans ne sont pas encore ouverts » (titre, explication, Réessayer ou Voir mes élèves), le tableau de
bord et la fiche Semaines restent entiers, aucun compteur n'est inventé.

### Routes

| Route | Écran |
|---|---|
| `#/bilans` | Mes bilans : modèles, éditeur, envoi, destinataires |
| `#/bilans-recus` | Bilans reçus : à répondre, puis pas encore remplis ; chaque ligne ouvre l'onglet Bilans de l'élève |
| `#/eleve/<id>/bilans[/<bilan>]` | Onglet Bilans de la fiche (le bilan donné, sinon le plus récent répondu) |

La barre latérale ouvre « Bilans reçus » (compteur des bilans à répondre) et « Mes bilans » (nombre de modèles) ; la
barre d'onglets du bas les garde aussi (« Reçus », « Mes bilans »).

### Mes bilans (maquette 7-mes-bilans)

- **Modèles** : nom, fréquence lisible (`checkinScheduleText`), nombre d'élèves (groupes dépliés, élèves encore liés).
  « Nouveau bilan » : partir de zéro ou d'un modèle fourni (`CHECKIN_STARTERS` : Hebdo, Complet du mois, Express).
  « Dupliquer » (`coach_template_duplicate`), « Supprimer ce bilan » avec confirmation (`coach_template_delete` : les
  bilans déjà reçus restent).
- **Éditeur** : les 17 suivis du catalogue par rubrique (Corps, Activité et plan, Ressenti) et « Tes questions ».
  Case ronde (`role="checkbox"`) ; toucher le suivi ou son type ouvre ses réglages sur place : intitulé, type parmi
  ceux permis (`CHECKIN_KINDS[].types`, en `radiogroup`), échelle 1 à 5 ou 1 à 10, libellés des bornes, unité d'une
  question « nombre », mensurations et poses demandées (au moins une), réponse obligatoire (interrupteur
  `role="switch"`, jamais pour un suivi sensible), Monter, Descendre, Supprimer (question). « Ajouter une question » :
  texte, échelle, oui/non, nombre avec unité. En tête : « N suivis sur M · environ N minutes à remplir »
  (`checkinMinutes`).
- **Ordre** dans une rubrique : poignée glissée (Pointer Events à la souris, au doigt et au stylet, `touch-action: none`
  sur la poignée seulement ; la ligne suit le pointeur, l'ordre est validé au relâchement, Échap annule), flèches haut
  et bas, Début et Fin sur la poignée, boutons Monter et Descendre. Chaque déplacement est annoncé dans la zone
  `aria-live` (« Sommeil déplacé en position 3 »). Rien ne dépend du survol.
- **Envoi** : fréquence (Chaque semaine, 2 semaines, Chaque mois, À la demande, en `radiogroup`), jour et heure d'envoi,
  rappel (interrupteur et moment : « Lundi, 18 h », 1 jour après l'envoi), date limite (« À rendre avant : Mardi,
  18 h »). Fuseau : celui de l'ordinateur. « À la demande » : « Envoyer maintenant » avec confirmation
  (`coach_checkin_send_now`, 30 envois par 24 h).
- **Destinataires** (« Envoyé à », Modifier) : groupes et élèves cochés ; création et modification de groupes
  (`coach_group_save`, `coach_group_delete` : un groupe s'enregistre tout de suite, il sert à plusieurs bilans) ;
  fréquence propre d'un élève (« toutes les 2 sem. »), qui prime sur celle de son groupe côté serveur.
- **Enregistrement explicite** : « Enregistrer » envoie le modèle (`coach_template_save`), puis un planning par
  destinataire (`coach_schedule_save`, réglage du bilan ou fréquence propre), puis retire les plannings des
  destinataires enlevés (`coach_schedule_delete`) ; plan calculé par `deskCkSavePlan`. Barre « Changements pas encore
  enregistrés » collée en bas tant qu'il y en a. Changer de modèle, aller sur un autre écran ou fermer l'onglet avec
  des changements : confirmation (le lien revient en arrière tant que le coach n'a pas dit oui ; `beforeunload` pour
  l'onglet). Erreurs bloquantes dites en clair (nom vide, aucun suivi, question vide).
- **Aperçu élève** : le bilan tel que l'élève le verra dans l'app iPhone, en lecture seule (aucun champ actif).
- Réglage du bilan = celui du premier planning d'un groupe, sinon d'un élève ; un modèle sans destinataire n'a pas de
  planning côté serveur, il revient donc à « Chaque semaine, dimanche 18 h » jusqu'à ce qu'il en ait un.

### Onglet Bilans de la fiche élève (maquette 3-bilan)

- Bilan répondu le plus récent (`coach_student_checkins`), ‹ › d'un bilan à l'autre, « face à » un bilan précédent
  au choix (le précédent par défaut, ou aucun) : chiffres (poids, chaque mensuration, nombres) avec leur écart
  (« −0,7 kg depuis S44 »), réponses lisibles (`checkinValueText`) avec l'écart des échelles et des suivis
  automatiques, « Pas de réponse » pour un suivi passé.
- **Photos** : le web ne déchiffre pas encore les photos chiffrées (vague 5) ; l'écran dit seulement « 3 photos
  envoyées, à ouvrir dans l'app iPhone », sans rien promettre de plus.
- Réponse du coach (2000 caractères au plus, compteur) et note de la semaine 1 à 10 (`radiogroup`, jamais montrée à
  l'élève). « Brouillon » (`coach_checkin_review`, `send: false`) ; « Envoyer à <élève> » (`send: true`, puis la même
  réponse dans la conversation par `chat_send { body, student }` ; si ce second envoi échoue, l'écran le dit). Une
  réponse en cours reste en mémoire d'un bilan à l'autre ; quitter la fiche avec une réponse pas enregistrée demande
  confirmation.
- Bilans en attente (envoyés, pas encore remplis, avec leur date limite) et pas remplis à temps listés à côté.

### Fiche Semaines et tableau de bord

- Colonnes en plus : chaque suivi échelle, nombre ou automatique du bilan répondu le plus récent de l'élève (sauf poids
  et mensurations, déjà là), avec la valeur du bilan dont la période commence dans la semaine
  (`deskCkWeekColumns`, `deskCkWeekValues`, `checkinValueNumber`) ; rien sans bilan. Le tableau défile dans son cadre
  si les colonnes sont nombreuses, jamais la page.
- Tableau de bord : `coach_checkins_overview` lu avec le reste ; un bilan répondu dont le retour n'est pas envoyé
  donne « Bilan reçu, à répondre » dans « À faire » et met l'élève dans « À traiter » (juste après les séances en
  baisse) ; badge sur l'onglet Bilans de sa fiche.

### Tests de la vague 2

- `tests/unit/coach-web-bilans.mjs` (dans `node tests/unit/run.mjs`) : lignes de l'éditeur, réordonnancement et
  annonce, réglages d'un suivi nettoyés comme le serveur, erreurs, réglage du bilan et fréquence propre, plan
  d'enregistrement, textes d'envoi, historique, comparaison, colonnes de Semaines, signal du tableau de bord,
  échappement des textes reçus, « pas encore ouverts » sans la migration.
- `python3 tests/test_coach_web_bilans.py` (`PPL_ENGINES=chromium` pour un moteur) : Chromium, Firefox, WebKit ×
  1440, 1180, 820 px (tactile en 1180 et 820 ; glisser au doigt par Pointer Events tactiles) × sombre, clair : signal
  et compteurs, Bilans reçus, onglet Bilans (comparaison, bilan d'avant, brouillon, envoi qui crée un message),
  colonnes de Semaines, Mes bilans (aperçu, modèle fourni, cocher, type, échelle, bornes, glisser, bouton, clavier,
  question perso, fréquence, jour, heure, rappel, date limite, groupe, élève, nouveau groupe, fréquence propre,
  confirmation avant de quitter, enregistrer, dupliquer, supprimer, envoyer maintenant), cibles de 44 px, pas de
  défilement en largeur, fond noir pur, CSP, aucune erreur, localStorage ; puis le serveur sans la migration.
  Faux serveur `tests/fake_checkins.py`, données `COACH_WEB_CHECKINS_SEED` de `tests/coach_web_fixtures.py`.
- `python3 tests/coach_web_captures.py <dossier>` capture aussi Mes bilans (et un suivi ouvert), l'onglet Bilans et
  Bilans reçus.

## Vague 4 : Messages, Programme, Nutrition (maquettes 6-messages, 4-programme, 5-nutrition)

Rien n'est déployé ; la migration `20261126010000_programmes_envoyes_coach.sql` est écrite, pas appliquée, et l'appli
marche sans elle (voir « Serveur de la vague 4 »). Les cinq onglets de la fiche sont ouverts ; Planning, Mes programmes
et Plans diète restent « bientôt » dans la barre latérale.

### Routes

| Route | Écran |
|---|---|
| `#/messages[/<élève>]` | Messages : conversations, fil, « <élève> en bref » (à partir de 1240 px) |
| `#/eleve/<id>/messages` | le même fil dans la fiche (bouton « Écrire » de l'en-tête) |
| `#/eleve/<id>/programme[/<séance>]` | éditeur des séances envoyées à l'élève |
| `#/eleve/<id>/nutrition` | plan diète envoyé, semaine cochée |

### Messages

- **Mêmes RPC et mêmes règles que l'app** : les fonctions de `js/data/coach-chat.js` sont appelées telles quelles, avec
  l'appel du site (`{ rpc: deskRpc }`, paramètre ajouté pour cela ; l'app garde `coachRpc` par défaut). Donc le même
  curseur (seuls les messages REÇUS du serveur l'avancent : un message de l'élève arrivé juste avant ma réponse est
  relu), la même marque de lecture (`chat_mark_read` jusqu'au dernier reçu ; écrire ne vaut pas lecture), le même
  nettoyage et la même limite (2000 caractères, `chatClean`, `chatProblem`, compteur à partir de 1800), les mêmes textes
  d'erreur (`coachErrorText`). Limites du serveur : 60 messages par heure, 500 par 24 h (« Trop de messages d'un coup »).
- **Blocage** : la messagerie du coach ne regarde pas le blocage du social (migration du chat : l'élève a choisi son
  coach, il le quitte ou le coach le retire, ce qui efface la conversation). Le site propose « Signaler »
  (`report_chat`, 50 derniers messages copiés, alerte par la fonction Edge `report`) et dit quand l'élève ne reçoit pas
  les notifications (`coach_push_off`). Le contrôle parental d'Apple (`chatHiddenByAge`) est propre à un iPhone d'enfant :
  `env.js` le fixe à faux sur un ordinateur.
- **Rafraîchissement, comme l'app** : pas de temps réel (l'app non plus). Conversation à l'écran relue toutes les 15 s
  (`CHAT_POLL_MS`, seulement les messages après le dernier reçu, `after_id`), résumés (`chat_threads`, non-lus de la barre
  latérale) toutes les 60 s, seulement onglet visible ; au retour sur l'onglet, tout de suite. Un message envoyé est suivi
  d'une relecture immédiate.
- Liste : `chatInboxRows` de l'app (non lues en tête, puis la plus récente ; la recherche montre aussi les élèves sans
  message). Fil : séparateurs de jour de l'app (`chatDayLabel`), mes messages à droite (gris plus soutenu, jamais orange),
  les siens à gauche ; position gardée d'un rendu à l'autre, en bas s'il y était.
- **Dans le fil** (`deskThreadEvents`, `deskThreadItems`) : les séances de l'élève (`coach_student_sessions`, première page)
  avec « Commenter la séance » / « Modifier le commentaire » sur place (`coach_set_note`, 1000 caractères, vide = supprimé :
  l'élève le voit sous sa séance), et ses bilans répondus (« Répondre au bilan » ouvre l'onglet Bilans, dont la réponse part
  aussi dans la conversation, vague 2). Le fil n'est redessiné que s'il a changé (un lecteur d'écran ne le relit pas
  toutes les 15 s, une saisie en cours n'est pas coupée). Événements plus anciens que le plus ancien message chargé : avec « Afficher les
  messages précédents » ; trois semaines au plus avant le premier message.
- Clavier : Entrée envoie, Maj + Entrée passe à la ligne (jamais pendant une composition d'accent). Fil en `role="log"`
  `aria-live="polite"`, chaque bulle dit « Toi, 14:02 : … » ou « Message reçu, … » aux lecteurs d'écran.
- Nutrition › « Écrire à <élève> à propos de mercredi » ouvre l'onglet Messages avec ce début de message (rien ne part).

### Programme

- **Source** : ce que l'élève a reçu (`coach_student_programmes`, nouvelle lecture) ; plusieurs programmes envoyés : un
  choix. Sans la migration : la version de mon programme gardée sur mon compte (`profiles.doc`, lecture de mon propre
  profil, jamais écrit d'ici), pour les programmes que `coach_state` dit envoyés, **en lecture seule** et annoncée à
  l'écran : les charges prescrites depuis l'iPhone, gardées sur l'iPhone, n'y sont pas, et la renvoyer les effacerait
  chez l'élève (« Envoyer à plusieurs » est coupé aussi). Un de mes programmes pas encore envoyé part normalement.
  D'où l'ordre conseillé : la migration avant le site.
- **Format identique à l'app** : le brouillon est un programme `cleanSentProgramme` ; chaque champ suit les règles de
  l'app (`deskPgPatch`) : séries 1 à 10, fourchette (le bas reste écrit, sinon un haut seul hors 12 se lirait en reps
  fixes) ou reps fixes (`repFixed`), charge prescrite pour toutes les séries (`load`) ou série par série (`loads` : top set
  et back-off, étiquetés par `prescSetTag` ; la charge commune reste en repli, comme `prescKgAt` de l'app : une série
  ajoutée la reprend), repos 10 à 600 s ou celui de l'élève, technique et « sur quelle série »
  (`intensFieldsFor` : Dernière, Toutes, ou des numéros, publiée le 24/11 ; une seule série visée garde la forme
  d'avant), consigne 500 caractères. Envoi par `coachSentPayload` (extrait de `coachSendProgramme` de l'app : même
  nettoyage, même limite de 200 Ko) et `coach_send_programme`. Test unitaire : brouillon inchangé = exactement ce que
  l'élève a reçu ; programme de mon compte = `programmeToSent` de l'app.
- **Ajouter un exercice** (liste du catalogue, `catalogueNames`) : 3 séries de 8 à 12 reps, comme l'app ; Monter,
  Descendre, Retirer (confirmation), réglages d'un exercice dépliés sur place (« Réglages »).
- **La dernière fois** : `studentLastLoads` de l'app sur les séances reçues (12 semaines), « 45 × 7 · 40 × 9, 9, 8 »,
  puis « Dans la fourchette », « Sous la fourchette » ou « Haut de fourchette : monter » (reps fixes : « Reps atteintes :
  monter »), avec la date.
- **Envoyer à plusieurs élèves** : cases à cocher (l'élève de la fiche coché), limite de l'app (30 + 2 par élève sur
  24 h, `coachSendLimit`), file de l'app (`coachSendQueue`, extraite de `coachSendMany` : 4 envois à la fois, arrêt au
  refus de la limite). **Chacun garde SES charges** (`deskPgForOther`) : reprises de ce qu'il a reçu (même séance, même
  exercice, nom comparé comme l'app), aucune pour un exercice qu'il n'avait pas ; séries, reps et techniques sont celles
  du coach. Ce qu'un élève a reçu ne se lit pas (réseau, limite) : rien ne part pour lui, jamais ses charges effacées.
  Le résultat dit qui n'a rien reçu.
- « Envoyer un programme » (en-tête de la fiche) : un de mes programmes (`coachSendableProgrammes`, passée de l'écran de
  l'app à `js/data/coach.js`) mis dans l'éditeur, envoyé ensuite. Rien n'est modifié sur l'iPhone du coach : ses
  programmes restent les siens, l'élève reçoit une mise à jour comme depuis l'écran Envoyer (renvoyer depuis l'iPhone
  remplace la version du site).
- Changements pas envoyés : barre collée en bas, « Annuler les changements », confirmation avant de quitter la fiche,
  de changer de programme ou de fermer l'onglet.

### Nutrition

- **Plan envoyé** (`coach_student_programmes`, lignes `diet_…` ; sans la migration : mon plan du compte dont l'envoi est
  dans `coach_state`) : nom, objectifs (« Entraînement 1 850 kcal · repos 1 650 kcal · eau 2,5 L »), date, vu ou non.
- **Semaine cochée, seulement avec le consentement « Suivi de ma diète »** (`coach_student_diet`, `shared`) : semaine du
  lundi au dimanche, 12 en arrière ; pastilles et statut d'un jour de l'app (`dietShareStatus` : suivi, partiel, pas suivi,
  rien de noté, en cours) ; détail d'un jour : repas cochés ou non, avec les aliments du plan envoyé quand le nom du repas
  correspond (jamais les aliments remplacés ni les heures : l'élève ne les partage pas) ; calories, protéines, glucides,
  lipides face à l'objectif du jour (barres neutres en SVG, la CSP refusant les styles en ligne), eau, sel ; moyennes de
  la semaine et les seuils de l'app. Sans partage : « <élève> ne partage pas le suivi de sa diète » et où l'activer, aucun
  chiffre. Serveur sans le suivi de la diète : le plan seul.
- **Envoi d'un plan** : un de mes plans du compte (`coachSendableDiets`, `coachDietPayload` extrait de `coachSendDiet` de
  l'app) ; refus du serveur si l'élève n'accepte pas les plans de son coach (« Ton élève doit d'abord accepter… »).
- **Modifier un plan, recherche Ciqual : pas sur le web dans cette vague.** L'éditeur de plans de l'app
  (`js/features/diet-editor.js`, jours entraînement / repos, portions, équivalences, base `data/foods.json`) est un écran
  entier ; le refaire au clavier et à la souris est une vague à lui seul. Pour l'instant : on le modifie dans l'app
  (Nutrition › Mes plans), puis on l'envoie d'ici. Les plans ne se lisent sur le compte qu'avec la synchro de la nutrition
  acceptée dans l'app.

### Serveur de la vague 4 : `coach_student_programmes` (migration écrite, PAS appliquée)

Vérifié : les RPC et la RLS existantes suffisent pour Messages (`chat_*`, `report_chat`, `coach_push_off`,
`coach_set_note`, `coach_student_sessions`, `coach_student_checkins`) et pour la semaine de Nutrition
(`coach_student_diet`). Manquait seulement la relecture de ce que le coach a envoyé : `coach_state` ne rend que l'id, la
date et « vu ». `supabase/migrations/20261126010000_programmes_envoyes_coach.sql` : `coach_student_programmes(student)` →
`[{ id, data, sent_at, seen }]`, du plus récent, 40 au plus, seulement les lignes de CE coach pour CET élève
(`private.coach_require_student`), 600 lectures par heure ; un plan diète retiré par l'élève est déjà effacé par le
déclencheur existant. Aucune table, aucun droit de table. Tests : `tests/sql/programmes_envoyes_coach_test.sql` (droits,
anon, autre coach, ancien coach de l'élève, ex-coach, élève, non-élève, données exactes, « vu », retrait de l'accord diète,
limite) ; retour arrière `supabase/rollback/20261126010000_programmes_envoyes_coach_down.sql`, vérifié par
`tests/sql/programmes_envoyes_coach_rollback_test.sh` ; ajoutée à `tests/sql/prod_order_test.sh` et à
`supabase/rollback/ORDRE.md` (n° 18).

### Changements dans le code partagé de l'app (sw.js en ppl-v239)

Sans changement de comportement de l'app : paramètre `{ rpc }` (et `reportAlert`) des fonctions de `js/data/coach-chat.js` ;
`coachSentPayload` (de `coachSendProgramme`), `coachSendQueue` (de `coachSendMany`) et `coachSendableProgrammes(d)` (de
l'écran du coach) dans `js/data/coach.js` ; `coachDietPayload` (de `coachSendDiet`) dans `js/data/coach-diet.js`. Le site
charge en plus `accessors.js`, `goals.js` et `coach-diet.js`, tels quels.

### Tests de la vague 4

- `tests/unit/coach-web-v4.mjs` (dans `node tests/unit/run.mjs`) : fonctions du chat avec l'appel du site (curseur, envoi
  qui n'avance pas le curseur, lecture, nettoyage, Signaler), liste et compteur, fil mêlé, chaque règle de l'éditeur,
  format identique à l'app, charges de chacun à l'envoi groupé, file d'envoi, « La dernière fois », semaine et statuts,
  repas du plan, chiffres et moyennes, envoi d'un plan, échappement des textes reçus, site sans hôte.
- `python3 tests/test_coach_web_v4.py` (`PPL_ENGINES=chromium` pour un moteur) : Chromium, Firefox, WebKit × 1440, 1180,
  820 px × sombre, clair : non-lus, conversation (effacés à l'ouverture, fil en bas, séances et bilans dans le fil,
  envoi), Programme (top set et back-off, modification et envoi au format de l'app, cluster sur la 1re série), Nutrition
  (7 jours, repas du plan, macros), fond noir pur, cibles de 44 px, pas de défilement en largeur, CSP, aucune erreur,
  localStorage ; puis par moteur : relecture à 15 s et marque de lecture, Maj + Entrée, trop long, commentaire de séance,
  Signaler, brouillon depuis Nutrition, confirmation avant de quitter, envoi groupé (Tom sans les charges de Léa), envoi
  d'un de mes programmes, repli sans la migration, diète non partagée, hôte qui embarque la page.
- `python3 tests/coach_web_captures.py <dossier>` capture aussi Messages, Programme (et un exercice déplié) et Nutrition.

## Embarquer dans l'app (iPad et tablettes)

Prévu ensuite (demande de Maxence) : sur iPad et tablette, l'onglet Coach de l'app ouvrira CETTE interface, embarquée
dans l'app (fichiers livrés avec l'app, pas le site distant), avec un bouton « Revenir à l'appli ». Ce qui est déjà prêt :

- **Chemins relatifs, aucune dépendance à la racine** : la page charge `css/…`, `js/desk/…` et les scripts partagés en
  relatif (`../js/…` dans le dépôt, `js/…` dans `dist-coach/`) ; les routes sont dans le `#`. Seule exception : l'adresse
  de retour de Sign in with Apple (`location.origin`), inutile embarquée puisque la session vient de l'app.
- **Session fournie par l'hôte** (`js/desk/api.js`, `deskHost`) : l'app pose, avant les scripts de la page,
  `window.MDLF_COACH_HOST = { session: { access_token, refresh_token }, exit() }`. La page ouvre alors cette session
  (`auth.setSession`) sans écran de connexion, ne la copie pas dans le stockage du navigateur (`persistSession: false`),
  ne ferme pas après 30 minutes (l'app garde sa règle) ; une session refusée ou terminée rend la main à l'hôte (`exit`).
  `exit` ajoute « Revenir à l'appli » (barre latérale, barre d'onglets, Réglages) à la place de « Se déconnecter de cet
  ordinateur », après confirmation s'il reste des changements pas enregistrés. **Aucun renouvellement de jeton dans la
  vue web** (`autoRefreshToken: false`) : chez Supabase un jeton de rafraîchissement ne sert qu'une fois, le renouveler
  ici révoquerait la session de l'app ; l'app renouvelle et rouvre la page (ou lui repasse la session) avant l'heure. Sans `MDLF_COACH_HOST` (le site), rien ne change. Test : `tests/test_coach_web_v4.py` (faux hôte).
- **Aucune supposition sur `window.top` ni `window.parent`** (aucun appel), ni sur un cadre : la page tourne seule.
- **Zones sûres** : `viewport-fit=cover` et `env(safe-area-inset-*)` sur la barre latérale, le contenu, la barre d'onglets
  et le bandeau (encoche, barre d'accueil, coins arrondis).
- **Un seul point d'entrée** : `deskStart()` en fin de `js/desk/main.js`.
- À faire côté app le moment venu : livrer `dist-coach/` dans le paquet, l'ouvrir dans une vue web (WKWebView) avec la
  session du compte, recevoir `exit()` par un pont natif, revoir la CSP (`connect-src` vers Supabase seulement, schéma
  `capacitor://` ou fichier local), et la build iOS (TARGETED_DEVICE_FAMILY passe à iPhone + iPad) soumise à Apple.

