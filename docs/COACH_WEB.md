# MDLF Coach sur ordinateur (appli web du coach) : vagues 1, 2, 3 et 4

Demande d'un coach partenaire (24/11/2026) : faire ses retours sur un iPhone 12 est « horrible », il travaille sur PC ou
tablette. Décision de Maxence : une **application web dans le navigateur** (Linux, Mac, Windows, iPad, tablettes
Android), et des bilans entièrement configurables par chaque coach (vague 2). Note d'architecture et plan en vagues :
`~/.local/share/mdlf/coach-web/NOTE.md` ; maquette validée le 24/11 : `~/.local/share/mdlf/coach-web/maquette/`.

**Vague 1 (ce document)** : connexion par code e-mail, tableau de bord « Élèves », fiche élève « Semaines ».
**État au 25/11/2026** : le site est en ligne sur **https://coach.mdlf.app** (projet Vercel `mdlf-coach`) ; l'ancienne
adresse `https://mdlf-coach.vercel.app` renvoie vers lui par une redirection 308 (`coach-web/vercel.json`, règle sur
l'hôte), car Apple n'accepte la connexion que sur `coach.mdlf.app`. Les migrations des vagues 1, 2 et 4
(`20261124010000_semaines_coach.sql`, `20261125010000_bilans_coach.sql`, `20261126010000_programmes_envoyes_coach.sql`)
sont appliquées ; l'appli garde ses replis pour un serveur d'avant.

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
coach-web/js/desk/diet-edit-model.js, diet-editor.js  plans diète : logique pure, éditeur et envoi
coach-web/js/desk/diet-lib.js, diet-pick.js           plans diète : liste (#/plans-diete) et Mes aliments ; dialogues (recherche Ciqual, code-barres, équivalents)
coach-web/js/desk/main.js   routes, gestes, clavier, inactivité, confirmation avant de quitter, démarrage (deskStart)
coach-web/vercel.json       seule source des en-têtes : traduits en _headers (Cloudflare Pages) par la construction ;
                            garde aussi la redirection 308 de mdlf-coach.vercel.app vers coach.mdlf.app (copie de secours)
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
- Ordinateur parfois partagé : fermeture après **30 minutes sans geste** (clic, touche, molette ou doigt qui fait
  défiler, compté une fois toutes les 5 s au plus ; vérifiée au rechargement, au retour sur l'onglet et toutes les 15 s).
  À 28 minutes, bandeau « Toujours là ? » avec « Rester connecté ». À 30 minutes : l'écran est vidé tout de suite, la
  réponse à un bilan en cours d'écriture part en brouillon sur le serveur (`coach_checkin_review`, `send: false`, 8 s au
  plus), puis déconnexion et rechargement (« Session fermée après 30 minutes sans activité »). Écran vidé avant : rien
  d'un élève ne reste visible sous la fenêtre « Quitter le site ? » du navigateur. « Se déconnecter de cet ordinateur »
  (Réglages ; `signOut({ scope: 'local' })` : l'iPhone reste connecté). La session est dans **sessionStorage** : fermer
  l'onglet la ferme (une session laissée dans localStorage par une version d'avant est effacée au chargement). Seules la
  session de supabase-js (`mdlf-coach-web-auth`) et l'heure du dernier geste (`mdlf_coach_web_active`) y sont gardées ;
  aucune donnée d'élève, rien dans localStorage (test E2E).
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
- **Adresse de retour** : `location.origin + '/'`. Chaque adresse du site (`https://coach.mdlf.app/`) doit être
  déclarée sur le Services ID, sinon Apple répond « invalid_request » ; l'ancienne `https://mdlf-coach.vercel.app/` est
  refusée par Apple, d'où sa redirection 308 vers `coach.mdlf.app`. Les adresses de prévisualisation de Vercel ne marchent donc pas avec Apple (e-mail seulement).

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
Le stress, le ressenti… viennent des bilans configurables (vague 2) ; les pas, le sommeil et le cardio du partage des
données Santé (vague 3, ci-dessous).
Courbe du poids sur 90 jours (SVG décrit pour les lecteurs d'écran), mensurations avec leur écart. Les onglets
Bilans, Programme, Nutrition et Messages sont présents, désactivés et annoncés « bientôt ».

## Serveur : `coach_student_weeks` (migration appliquée)

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
- Ordre de mise en production suivi : la migration, puis le site. Le site d'avant la migration marche.

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
En ligne ; la migration des bilans est appliquée. Sur un serveur sans elle, **l'appli web marche quand même** : chaque écran des
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

En ligne ; la migration `20261126010000_programmes_envoyes_coach.sql` est appliquée, et l'appli marcherait sans elle
(voir « Serveur de la vague 4 »). Les cinq onglets de la fiche sont ouverts ; Planning et Mes programmes ne sont pas dans
la barre latérale tant qu'ils ne sont pas ouverts (Plans diète y est depuis le 25/11).

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
- **Blocage** : avec la migration `20261127010000_blocage_coupe_coach.sql` (écrite, PAS appliquée), un blocage
  entre l'élève et son coach, dans un sens ou dans l'autre, supprime leur lien : même effacement que « Quitter mon
  coach » (conversation, programmes, notes, partages, phases, photos, bilans), et ils ne peuvent plus se relier tant que
  le blocage dure. Le site dit alors « Cet élève ne te suit plus ». Avant elle, la messagerie du coach ne regardait pas
  le blocage du social (seuls les bilans et les notifications le faisaient). Le site propose « Signaler »
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
- **Modifier un plan, recherche Ciqual** : depuis le 25/11, dans l'onglet (« Modifier ce plan », « Créer un plan ») et dans
  « Plans diète » : voir la section « Plans diète » plus bas.

### Serveur de la vague 4 : `coach_student_programmes` (migration appliquée)

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

## Vague 3 : pas, sommeil, cardio

Contrat serveur et app : docs/SANTE_COACH.md (migration `20261127050000_sante_coach.sql`, écrite, PAS appliquée).

- **Colonnes** de la fiche Semaines, après Eau : « Pas », « Sommeil », « Cardio » (« par jour », « par nuit » en dessous), **seulement si
  l'élève partage** (case « Pas, sommeil et cardio » de l'app, `health.shared === true`). Moyenne de la semaine (lundi
  au dimanche, comme les autres colonnes) sur les seuls jours qui ont une valeur : pas arrondis (« 7 880 »), sommeil en
  minutes (« 7 h 08 »), cardio en minutes par jour (« 33 min/j ») ; semaine en cours : les jours déjà relevés. Le nombre
  de jours comptés est dans le `title` de la case et dans le texte lu par les lecteurs d'écran (« pas par jour, moyenne
  sur 5 jours ») ; « — » pour une semaine sans valeur. Logique pure : `deskHealthWeek`, `deskHealthCell`,
  `deskSleepText`, `deskHealthColumns` (`js/desk/model.js`). Le tableau défile dans son cadre, jamais la page.
- **Source** : `coach_student_weeks` rend `health` (= `coach_student_health(student)`), nettoyé par `cleanCoachHealth`
  (`js/data/coach-share.js`, chargé tel quel) ; toujours un seul appel pour la fiche. Repli sans `coach_student_weeks` :
  `coach_student_health` lu avec les autres lectures.
- **Sans partage** (`shared: false`) : aucune colonne, et dans le pied du tableau « <élève> ne partage pas ses pas, son
  sommeil ni son cardio (réglage dans l'app iPhone : Partager avec mon coach) ».
- **Sans la migration** (`PGRST202`, ou `coach_student_weeks` d'avant sans clé `health`) : `health` vaut null, ni
  colonne ni phrase, rien ne casse.
- Grand écran (iPad, page embarquée avec `MDLF_COACH_HOST`) : mêmes colonnes (testé avec le faux hôte).
- Tests : `tests/unit/coach-web-sante.mjs` (moyennes, jours sans valeur, bornes de la semaine, semaine en cours, textes,
  `cleanCoachHealth` des scripts de la page, colonnes absentes sans partage, phrase, serveur d'avant, un appel ou repli,
  échappement) ; `python3 tests/test_coach_web_sante.py` (`PPL_ENGINES=chromium` pour un moteur ; job `coach-web`) :
  3 moteurs × 1440, 1180, 820 × sombre, clair, valeurs exactes de Léa (`COACH_WEB_HEALTH_SEED`, `health=True` de
  `open_desk`), Tom sans partage, un appel, repli, serveur sans la migration, faux hôte iPad, pas de défilement en
  largeur, cibles de 44 px, CSP, aucune erreur, localStorage. Captures : `9-fiche-sante*` de `tests/coach_web_captures.py`.

## Plans diète en grand écran (25/11, branche diete-web)

Demande de Maxence : créer et modifier un plan diète sur le site, avec la recherche Ciqual (avant : lecture et envoi
d'un plan existant seulement ; l'éditeur n'existait que dans l'app). Rien n'est publié.

### Où
| Route | Écran |
|---|---|
| `#/plans-diete` | Mes plans (du plus récemment modifié), « Créer un plan », « Dupliquer » ; Mes aliments (« 37 sur 200 », Retirer) |
| `#/plans-diete/<plan>` | éditeur d'un de mes plans |
| `#/eleve/<id>/nutrition/edit` | le plan reçu par l'élève (version de `coach_student_programmes`), dans l'éditeur |
| `#/eleve/<id>/nutrition/new`, `…/nutrition/<plan>` | plan neuf, ou un de mes plans, pour cet élève |

« Plans diète » est ouvert dans la barre latérale (nombre de plans) et dans la barre d'onglets (« Diète »).

### Éditeur (js/desk/diet-editor.js ; liste : diet-lib.js ; dialogues : diet-pick.js ; logique : diet-edit-model.js)
- **Repas** : ajouter (nom en double refusé, sans casse ni accents ; 8 au plus), Options (renommer, consigne, Monter,
  Descendre, Dupliquer, Copier vers d'autres jours, Masquer pour un repas de base ou Supprimer), **ordre par
  glisser-déposer** à la poignée (Pointer Events : souris, doigt, stylet ; Échap annule) ou au clavier (flèches, Début,
  Fin), annoncé (« Dîner déplacé en position 1 »). Repas masqués : « Réafficher ».
- **Aliments** : quantité tapée dans la ligne, **en grammes ou à l'unité** (choix de l'unité dans la ligne : « œufs »,
  « pots », passer de l'un à l'autre convertit, `dietQtyUnits`, `dietQtyValue`), **kcal et macros recalculées à chaque
  frappe** (ligne, repas, total du jour face aux objectifs). « Équivalents » (`swapCandidates`, même règle et même liste
  que l'app, quantité déjà calculée, écart de kcal), « Déplacer… » vers un autre repas, Retirer.
- **Ajouter un aliment** (dialogue) : recherche dans la table Ciqual (`data/foods.json`, 266 Ko, **chargé à la première
  ouverture d'un éditeur**, `loadFoods`) et Mes aliments, accents et majuscules ignorés (`searchFoods`), flèches haut et
  bas puis Entrée ; étiquettes cru / cuit, alias (« Valeurs Ciqual : … ») ; quantité (Grammes | unité, − et +, total en
  direct, rappel « Pesé cuit ? » de l'app, `foodCookTwin`) ; « Ajouter », ou « Ajouter et continuer » (Maj + Entrée)
  pour enchaîner. « Créer « whey » » quand rien ne correspond pile (`foodSearchExact`).
- **Aliment perso** : mêmes champs et mêmes règles que la feuille de l'app (`dietFoodFromForm`, extrait de
  `js/features/diet-editor.js`), gardé dans Mes aliments (`dietKeepOwnFood` ; plein : ajouté au plan sans être gardé,
  jamais le plus ancien retiré).
- **Code-barres** : le scan reste sur l'iPhone ; ici on **tape les chiffres** (`normBarcode`, chiffre de contrôle). Code
  déjà gardé : retrouvé sans réseau ; sinon Open Food Facts à la demande (`offLookup`, User-Agent « MDLF Training/1.0
  (Web) », jamais d'extrait embarqué), attribution « © les contributeurs d'Open Food Facts, licence ODbL » sur la fiche
  et au pied de l'éditeur, produit gardé comme un produit scanné (`dietSaveScanned`). Introuvable : « Créer
  l'aliment » (code gardé). CSP : `connect-src` ajoute `https://world.openfoodfacts.org`, seul ajout.
- **Objectifs du jour** : kcal, protéines, glucides, lipides, eau et sel en fourchette ; mêmes bornes et mêmes messages
  que l'app (`dietTargetsFromForm`, extrait de la feuille de l'app ; pas de g/kg : le poids du coach ne vaut pas pour
  ses élèves). Écart dit en clair (`dietTargetGap`), repère très bas (`dietLowKcal`), repère de l'OMS au-dessus de 5 g.
- **Jours** : Tous les jours pareils, Entraînement et repos, Semaine (`dietSetDayMode`, copies du jour 1 aux mêmes
  identifiants) ; jour choisi en tête, type de chaque jour de la semaine, « Copier ce jour vers… », « Mettre pareil sur
  les 7 jours », « Copier vers d'autres jours… » d'un repas.
- **Annuler / Rétablir** (boutons, Ctrl ou ⌘ + Z, Maj + Z ou Ctrl + Y, aussi dans un champ de l'éditeur : chaque frappe
  change déjà le plan) : 80 gestes, la frappe dans un même champ n'en fait qu'un. Ctrl ou ⌘ + S enregistre. Raccourcis
  actifs seulement sur l'écran de l'éditeur ; le brouillon est oublié dès qu'on quitte l'éditeur.
- Barre collée en bas : état, Annuler, Rétablir, Envoyer à plusieurs élèves, Envoyer à <élève> (onglet de l'élève),
  Enregistrer. Quitter l'éditeur ou fermer l'onglet avec des changements : confirmation.
- Tactile : cibles de 44 px, rien au survol ; mise en page 2 colonnes à partir de 1240 px (repas | bilan, objectifs,
  consigne), une colonne en dessous, lignes d'aliments sur deux rangées sous 900 px.

### Où vivent les plans : sur le compte, avec l'accord
- Mes plans et Mes aliments sont ceux que l'iPhone copie sur le compte (`profiles.doc` : `dietPlans`, `dietFoods`,
  `dietFoodsGone`), **seulement avec l'accord « Copier mes plans sur mon compte »** (`dietConsent`, docs/NUTRITION_V1.md,
  « Accords »). Sans lui : l'écran le dit, rien n'est écrit, « Enregistrer » disparaît ; on peut encore composer et
  envoyer (le plan envoyé vit côté élève, avec SON accord). L'accord se donne dans l'app, jamais d'ici.
- **Écriture** (`deskWriteDiet`, js/desk/api.js) : une opération (`deskDtOpSave`, `deskDtOpArchive`, `deskDtOpKeepFood`,
  `deskDtOpKeepScanned`, `deskDtOpRemoveFood`) rejouée sur le document relu ; seules les trois clés de la diète changent ;
  mise à jour **conditionnée par `updated_at`** (posé par le serveur) : si l'iPhone a écrit entre-temps, rien n'est
  écrasé, on relit et on rejoue (3 essais, sinon « réessaie »). Plafonds de l'app : 100 plans vivants, 200 aliments ;
  le site s'arrête à **800 Ko** de profil (marge sous les 900 Ko au-delà desquels l'iPhone n'enverrait plus ses plans).
- **Brouillon périmé** : la date du plan à son ouverture est retenue ; si le plan du compte a changé ailleurs avant
  « Enregistrer », le site le dit : « Recharger » (sa version) ou « Garder ma version » (la mienne remplace la sienne),
  Annuler ne change rien.
- **Version d'un élève** (« Modifier ce plan » dans son onglet) : l'envoi ne change que SON plan (même `diet_<plan>`),
  **jamais mon plan modèle**. « Garder comme nouveau plan » l'ajoute à mes plans sous un nouvel identifiant, nommé
  « Sèche (lea) » ; l'écran le dit en tête.
- **Fusion côté iPhone** (js/data/sync.js, `mergeDietProfile`) : **à trois voies**. L'iPhone retient l'empreinte de
  chaque plan au dernier échange avec le compte (`meta.dietPlans`, comme `meta.pushed` pour les séances). Plan modifié
  d'un seul côté : ce côté gagne, sans regarder l'horloge. Modifié des deux côtés (vrai conflit) : le plus récemment
  modifié (`updatedAt`) gagne ; les dates ne reculent jamais (`dietTouch` et le site : au moins l'ancienne + 1 ms, même
  avec une horloge en retard), une suppression est datée. Sans empreinte (premier échange après la mise à jour) : la
  règle d'avant.
- **Envoi du profil par l'iPhone** (js/data/account.js, `syncNow`) : lui aussi conditionné par `updated_at` (lu au début
  de la synchro) ; si le compte a changé entre sa lecture et son envoi (le site vient d'enregistrer), l'iPhone relit,
  refusionne (`applyRemoteProfile`) et renvoie, 3 essais ; au-delà, la synchro s'arrête sans rien écrire et le dit
  (« Synchro en conflit avec un autre appareil, nouvel essai à la prochaine synchro », `account.error = 'conflict'`).
  Test : la vraie boucle de `syncNow` dans `tests/unit/sync.mjs` (1, 2, 3 et 10 conflits, séance jamais renvoyée).
  Ce que ça protège : les plans diète (fusion à trois voies). Les autres réglages du profil gardent leur règle d'avant :
  avec plusieurs appareils, un réglage changé sur l'un pendant la synchro de l'autre peut encore être remplacé (c'était
  déjà le cas avant ce chantier, hors de son périmètre).
- **Trou restant, accepté** : un 2e appareil resté sur une ancienne build (sans la fusion à trois voies) peut encore
  remettre son ancienne version d'un plan modifié ailleurs, avant que le site ne voie le profil sans `dietSyncV` et
  bloque l'enregistrement. Rare (deux appareils, l'un pas à jour), et le trou disparaît une fois tous les appareils à
  jour.
- **iPhone pas à jour** : l'app à jour écrit `dietSyncV: 1` (`DIET_SYNC_V`) dans le profil avec les plans. Sans elle, le
  site n'écrit pas les plans (« Mets l'app à jour sur ton iPhone avant de modifier tes plans ici ») : une version d'avant
  remettrait son ancienne version d'un plan modifié ici. Composer et envoyer restent possibles. **Ordre de mise en
  production : l'OTA de l'app d'abord, puis le site.**

### Envoi
- Format **exact** de l'app : `coachDietPayload` sur le plan du brouillon (même nettoyage, `dietToSent`, même limite de
  200 Ko, même `prog_id` `diet_<plan>`) ; test unitaire : octets identiques à l'envoi de l'app. Un plan envoyé est
  d'abord enregistré dans mes plans (avec l'accord ; jamais la version d'un élève).
- À un élève (onglet Nutrition) ou à plusieurs (cases à cocher, limite des 24 h de l'app, `coachSendQueue`) ; la
  confirmation nomme les jours loin de leur objectif. Élève qui n'accepte pas les plans de son coach : refus du
  serveur, nommé dans le résultat.

### Serveur : rien à changer
Vérifié : `coach_send_programme` (plans diète déjà acceptés, accord `diet` de l'élève vérifié), `coach_student_programmes`
(migration de la vague 4, appliquée ; sans elle, « Modifier ce plan » part de mon plan du compte) et la RLS
de `profiles` (chacun lit et met à jour sa propre ligne, `updated_at` posé par le déclencheur `profiles_touch`)
suffisent. **Aucune migration.**

### Changements dans le code partagé de l'app (sw.js en ppl-v242)
Sans changement de comportement de l'app, sauf la fusion des plans (à trois voies) et l'envoi conditionnel du profil : `dietQtyUnits`, `dietQtyLabel`, `dietQtyInit`,
`dietQtyValue` passés de `js/features/diet-qty.js` à `js/data/food-portions.js` ; `foodName` de `nutrition-ui.js` à
`js/data/food-swap.js` ; `dietSwapItem` (food-swap.js), `dietFoodFromForm`, `dietKeepOwnFood`, `dietTargetsFromForm`
(nutrition.js) extraits des feuilles de l'éditeur de l'app, qui les appelle ; `loadFoods(url)` (adresse de la base vue
de la page) ; `mergeDietProfile` (trois voies), `dietPlanHashes`, `DIET_SYNC_V` (sync.js), envoi conditionnel du
profil (account.js), `dietTouch` qui ne recule jamais et suppression datée (nutrition.js). Le site charge en plus `diet-estimate.js`, `food-swap.js`,
`food-scan.js`, tels quels. La construction (`buildCoachWeb`, scripts/build-coach-web.mjs) copie `data/foods.json` à côté de la page : `dist-coach/data/` pour le
site, `dist/coach/data/` dans la copie embarquée de l'app (mode grand écran iPad). Embarquée, la page (cadre isolé,
origine opaque) ne peut pas lire ce fichier elle-même : elle le demande à l'app (`MDLF_COACH_HOST.foods()`, message
`mdlf-coach-foods`, docs/COACH_IPAD.md), qui le lit et le lui passe ; test : `t_diete` de tests/test_coach_ipad.py.

### Tests
- `tests/unit/coach-web-diete.mjs` : recherche (accents, vitesse), quantités et unités, format identique à l'app, repas,
  ordre, annuler / rétablir, équivalences (pomme de terre → riz, 175 g), jours, objectifs et aliment perso (mêmes
  messages), opérations sur le compte (accord, autres clés intactes, plafonds, brouillon périmé), écriture concurrente,
  échappement ; `tests/unit/coach-web-diete-sync.mjs` : scénarios de l'audit du 25/11 joués par `applyRemoteProfile`
  (horloge du PC en retard, suppression sur l'iPhone, autre changement sur l'iPhone, conflit, course de la synchro,
  brouillon périmé, version d'un élève, taille).
- `python3 tests/test_coach_web_diete.py` (`PPL_ENGINES=chromium` pour un moteur ; job `coach-web` de tests.yml) :
  3 moteurs × 1440, 1180, 820 px × sombre, clair, puis les parcours (voir l'en-tête du fichier).
- `python3 tests/coach_web_captures_diete.py <dossier>` : 9 écrans, planches sombre et clair côte à côte.

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

