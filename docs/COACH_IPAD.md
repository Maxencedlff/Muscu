# Mode coach grand écran dans l'app (iPad)

Idée de Maxence validée en principe le 25/11/2026 : sur iPad, l'onglet Coach ouvre la même interface que coach.mdlf.app,
embarquée dans l'app, avec la même session, et un bouton « Revenir à l'appli ». coach.mdlf.app reste pour les
ordinateurs. Sur iPhone, rien ne change.

**Décision de Maxence, par écrit (25/11/2026) : « l'iPad c'est définitif, go »** (point B1 de l'audit). C'est un
choix sans retour : une app publiée pour l'iPad ne peut plus retirer l'iPad de ses versions suivantes (Apple, Technical
Q&A QA1623). Maxence n'a pas d'iPad : le parcours dans la vraie vue web est vérifié sur le simulateur iPad de la CI
(« Test dans la vraie vue web »).

Branche `coach-ipad`. **Rien n'est publié** : ni mise à jour à chaud, ni build TestFlight. L'iPad demande une
**nouvelle build native** (famille d'appareils, orientations, vue web) : une mise à jour à chaud seule ne suffit pas.

## Ce que voit le coach

- Onglet Coach, segment Élèves, sur un grand écran : en tête, la carte « Tes élèves sur tout l'écran », avec
  **Ouvrir le mode grand écran** et **Masquer**. Rien ne s'ouvre d'office.
- Choix retenu sur l'appareil (`mdlf_coach_desk`) : après une première ouverture, la carte devient une simple ligne
  « Mode grand écran » ; après « Masquer », plus rien dans l'onglet. La ligne reste toujours dans Réglages › Coach
  (groupe « Tu es coach »).
- Grand écran : `coachDeskEligible` (js/data/coach-desk.js) : dans l'app **iOS** seulement (pas les tablettes Android
  tant qu'aucun test ne les couvre, audit M2), jamais avec un user agent d'iPhone (iPhone Duo compris), fenêtre d'au
  moins **768 points sur iPad** (iPad Air en portrait 820 : oui ; iPad 13 pouces en Split View à moitié 678 : non). La
  carte suit la largeur (rotation, Split View).
- Mode ouvert puis fenêtre rétrécie (audit M3) : il reste ouvert jusqu'à **678 points** (Split View à moitié sur un
  13 pouces) et se referme en dessous (Slide Over 320, Split View au tiers 375…) avec « Agrandis la fenêtre pour le mode
  grand écran. ».
- Aucune rubrique « bientôt » (Planning, Mes programmes, Plans diète ; audit B3) : coach-web ne les affiche plus du
  tout depuis la correction de son propre audit (coach-web/js/desk/shell.js), sur le site comme dans l'app.
- Session refusée dans le cadre (expirée, révoquée) : retour à l'app avec « Connexion perdue, réessaie. » (audit m1).
- Mode ouvert : l'appli web du coach en plein écran. « Revenir à l'appli » est toujours à l'écran : celui de l'appli
  web (barre latérale et barre d'onglets) dès que le cadre dit l'afficher (message `mdlf-coach-exit-shown`), sinon la
  barre de l'hôte en haut (pendant le chargement, si la page est en erreur ou ne répond pas). Jamais les deux à la fois. Au retour : l'onglet Coach, relu (messages lus, bilans répondus là-bas).

## Cadre isolé plutôt que navigation : le choix

| | Cadre (iframe) **isolé**, par-dessus l'app (retenu) | Navigation de la vue web vers `coach/index.html` |
|---|---|---|
| App pendant le mode coach | Reste vivante dessous : séance en cours, repos, minuteries, Live Activity, synchro | Déchargée : tout repart au retour (écran de lancement, reprise de séance) |
| Retour | Immédiat (le cadre est retiré) | Rechargement complet de l'app |
| « Revenir à l'appli » | Peut vivre dans l'hôte, hors de la page du coach : visible même si elle plante | Seulement dans la page du coach |
| Droits de la page du coach | Aucun : origine opaque, ni fenêtre de l'app, ni Capacitor, ni coffre, ni stockage | Toute la coquille native |
| Mises à jour à chaud | `coach/` voyage dans le même paquet que l'app | Idem, mais `notifyAppReady` rappelé à chaque retour |

**Isolement (audit M1)** : `<iframe sandbox="allow-scripts allow-forms">`, **sans** `allow-same-origin`, ni fenêtres
surgissantes, ni navigation de l'app. Le cadre a une origine opaque (« null ») : `parent.Capacitor`,
`parent.cphCoachUnlock`, `parent.document`… lèvent une erreur, il n'a ni `localStorage` ni IndexedDB (coach-web
embarqué n'en a pas besoin : la session vient de l'hôte, en mémoire). Tout passe par `postMessage`, et chaque côté ne
lit un message que s'il vient de l'autre fenêtre (`event.source`) : l'origine d'un cadre isolé est « null », la source
est la seule preuve. L'app écrit au cadre avec `'*'` (une origine opaque ne se nomme pas) : le cadre ne peut contenir
que nos fichiers, car la CSP de l'app (`frame-src 'self'`) refuse toute navigation du cadre vers un autre site.

**Canal natif réservé à la fenêtre principale** : Capacitor n'injecte son JavaScript que dans la fenêtre principale
(`forMainFrameOnly: true`), mais son canal `window.webkit.messageHandlers.bridge` est joignable depuis tout cadre et son
délégué ne regarde pas d'où vient un message. `MainViewController.mainFrameOnlyBridge()` le réenregistre derrière
`MainFrameOnlyMessageHandler`, qui ignore tout message dont `frameInfo.isMainFrame` est faux, sans toucher au paquet
Capacitor (le délégué est créé dans `loadView`, privé : il est retrouvé par `CapacitorBridge.webViewDelegationHandler`).

Capacitor sert le cadre comme le reste (`capacitor://localhost/coach/index.html` est une adresse de l'application).
Aucune adresse distante : la page vient du paquet (`dist/coach/`).

## Construction

`node scripts/build-web.mjs` (donc `npm run ios:sync`) appelle `embedCoachWeb` (scripts/embed-coach-web.mjs) :
la même sortie que le site (`buildCoachWeb` de scripts/build-coach-web.mjs : page, styles, les scripts partagés exacts,
supabase-js figé) dans `dist/coach/`, puis seulement :

- pas de `vercel.json` (aucun en-tête dans la vue web : Capacitor sert les fichiers) ;
- **CSP resserrée** : `script-src 'self'` seul (le script de Sign in with Apple JS n'est jamais chargé, la session
  vient de l'app), `img-src` avec `blob:` (photos déchiffrées, voir plus bas), `frame-src 'none'` vérifié ;
- deux scripts de liaison (`coach-embed/`) : `bridge-start.js` est le **seul** script actif au chargement ; les scripts
  de la page (et `bridge-end.js` à la fin) sont rangés inertes dans `<template id="mdlf-embed-scripts">`, et
  `bridge-start.js` les charge dans le même ordre une fois la session reçue (la construction échoue si `main.js` n'est
  pas le dernier script, ou s'il y a un script en ligne).

Environ 1,2 Mo de plus dans `dist/` (et dans le paquet des mises à jour à chaud, servi depuis le 25/11 sur notre domaine
`ota.mdlf.app` avec repli sur `mdlf-ota.vercel.app` : IOS.md). CSP de l'app : `frame-src 'self'`
(était `'none'`) : un cadre de ses propres fichiers seulement.

## Session : celle de l'app, par message, un seul rafraîchisseur

1. Ouverture (`coachDeskOpen`, js/features/coach-desk-ui.js) : `sb.auth.getSession()` de l'app (renouvelle des
   jetons expirés), puis le cadre. Hors ligne : « Pas d'Internet : le mode grand écran a besoin du réseau. »
2. Messages (coach-embed/bridge-start.js) :

   | Sens | Message | Rôle |
   |---|---|---|
   | cadre → app | `mdlf-coach-ready` | page prête |
   | app → cadre | `mdlf-coach-session { session }` | les deux jetons de la session de l'app, rien d'autre |
   | cadre → app | `mdlf-coach-tokens { tokens }` | jetons renouvelés dans le cadre |
   | app → cadre | `mdlf-coach-tokens { tokens }` | jetons renouvelés par l'app |
   | cadre → app | `mdlf-coach-exit { reason }` | « Revenir à l'appli » ; `reason: 'session'` → « Connexion perdue, réessaie. » |
   | cadre → app | `mdlf-coach-exit-shown { shown }` | bouton de retour de la page visible ou non |
   | cadre → app | `mdlf-coach-foods` | base Ciqual demandée (éditeur des plans diète, docs/COACH_WEB.md « Plans diète ») |
   | app → cadre | `mdlf-coach-foods { foods }` | `data/foods.json` tel quel, lu par l'app (le cadre, d'origine opaque, ne peut pas le lire : CORS) ; `null` s'il est illisible |

3. À la session reçue, `bridge-start.js` pose le contrat de l'appli web du coach, `window.MDLF_COACH_HOST =
   { session, exit, onSession }` (docs/COACH_WEB.md, « Embarquer dans l'app »), puis charge ses scripts :
   `deskResume` fait `setSession`, client supabase-js sans stockage (`persistSession: false`), sans rafraîchissement
   automatique, sans fermeture après 30 minutes (l'app décide).
4. `bridge-end.js` : les jetons de rafraîchissement de Supabase sont **à usage unique** (rotation) ; deux clients qui
   rafraîchiraient chacun de leur côté finiraient par présenter un jeton déjà remplacé, et passé le délai de
   réutilisation (10 s) Supabase fermerait la session des deux côtés. Donc :
   - l'app est **le seul rafraîchisseur régulier** et envoie ses jetons neufs au cadre, posés par `setSession` ;
   - jeton expiré dans le cadre quand même (iPad sorti de veille avant que l'app renouvelle) : supabase-js le
     renouvelle à la première requête, et les jetons neufs repartent aussitôt à l'app (`sb.auth.setSession`, gardés
     dans le Trousseau comme d'habitude) ;
   - **un jeton n'est retenu que si `setSession` l'a accepté**, des deux côtés (audit m2) ;
   - **jetons venus du cadre : même compte seulement** (contre-audit du 25/11) : avant `sb.auth.setSession`, l'app
     lit le `sub` du jeton d'accès (`coachDeskSameAccount`, js/data/coach-desk.js) et le compare à `account.user.id`.
     Un autre compte (script injecté dans le cadre qui voudrait faire basculer l'app sur le compte de l'attaquant) :
     rien n'est posé, le cadre se ferme avec « Connexion perdue, réessaie. » ;
   - **jamais de déconnexion depuis le cadre** : `signOut` du client du cadre ramène à l'app. Une déconnexion là-bas
     fermerait la session de l'app sur le serveur.
5. Déconnexion de l'app pendant le mode ouvert (session révoquée ailleurs) : le mode se ferme.
6. Retour (`coachDeskClose`) : écouteur de messages retiré, jetons oubliés, cadre vidé (`about:blank`) puis retiré,
   thème de l'app et barre d'état remis, focus rendu au bouton qui avait ouvert.

## Écran hôte

`.coach-desk` (css/coach-desk.css) : fixe, plein écran, au-dessus de l'app (z-index 800 : sous les feuilles, les
alertes et l'écran qui masque les photos quand l'app passe en arrière-plan). Dans un iframe, `env(safe-area-inset-*)`
vaut 0 : **l'hôte laisse les quatre marges de sécurité** (24 points en haut sous la barre d'état, 20 en bas au-dessus de
la barre d'accueil d'un iPad sans bouton). Couleurs de l'appli web du coach, qui suit le réglage clair / sombre du
système (pas celui de l'app) ; la barre d'état suit le même réglage pendant le mode. L'app dessous est `inert` et
cachée aux lecteurs d'écran. Le bouton de l'hôte fait 44 points au moins. Mise en page en colonne flexible : en
grille (`1fr`), WebKit donnait au cadre la hauteur de tout l'écran et le faisait passer sous la barre d'accueil (vu par
le test E2E, pas par Chromium).

## Photos de bilan : rien pour l'instant

Les écrans de photos de coach-web existent (vague 5, docs/PHOTOS_WEB.md), mais le cadre n'a toujours **aucun** accès aux
photos (audit m3) : sans `MDLF_COACH_HOST.photos`, la page embarquée le sait (`deskPhEmbeddedOff`) et l'onglet Bilans dit
« Photos : ouvre coach.mdlf.app sur un ordinateur », sans proposer de relier cet « ordinateur » (le cadre isolé n'a ni
IndexedDB ni clé d'appareil). Testé : tests/unit/photo-link.mjs et `embedded_journey` de tests/test_photos_web.py.
Le jour venu : une demande par message (`mdlf-coach-photo`), le déverrouillage (Face ID) et le déchiffrement dans l'app
(`cphCoachUnlock`, `cphCoachFetch`, clé du trousseau, docs/PHOTOS_BILAN.md), puis les octets de l'image transférés au
cadre (`postMessage` avec transfert d'un `ArrayBuffer`), qui en fait une adresse `blob:` à lui (`img-src blob:` de sa
CSP). La clé privée ne quitte jamais l'app, et le cadre ne reçoit que les photos demandées, déjà déchiffrées.

## iPad dans la build

- `TARGETED_DEVICE_FAMILY = "1,2"` pour l'app et l'extension Live Activity (RestActivity), Debug et Release ; la
  montre reste à 4. Une extension doit couvrir les appareils de son app.
- Info.plist : `UISupportedInterfaceOrientations~ipad` avec les **4 orientations** (Apple exige les quatre pour
  Split View et Slide Over, sans `UIRequiresFullScreen`) ; l'iPhone reste en portrait seul. `UILaunchStoryboardName`
  déjà présent (exigé pour le multitâche). `UIApplicationSupportsMultipleScenes` reste à `false` : une seule fenêtre
  de l'app sur iPad, jamais deux copies des mêmes données.
- Vue web en contenu **mobile** (`MainViewController.webViewConfiguration`) : par défaut, la vue web d'iPadOS se dit
  « Macintosh » et prend une mise en page d'ordinateur. Réglé dans le code natif plutôt que par
  `ios.preferredContentMode` de capacitor.config.json : ce fichier entre aussi dans l'empreinte Android
  (scripts/runtime-version.mjs) et gèlerait ses mises à jour à chaud.
- Icônes : un seul visuel 1024 « universal » (Assets.xcassets), valable pour l'iPad ;
  `ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS` génère les clés iPad des icônes alternatives.
- Natif déjà sûr sur iPad : la montre (`WCSession.isSupported()`), les Live Activities (`areActivitiesEnabled`,
  faux sur iPad), Santé (disponible sur iPad depuis iPadOS 17, refus géré comme sur iPhone).
- L'app elle-même tient sur iPad sans changement (WebKit, 1024 × 1366, 1366 × 1024, Split View 678, Slide Over 320,
  sombre et clair : les cinq onglets et la séance, aucun défilement en largeur, barre d'onglets en bas) : déjà sur grand écran, au-delà de 720 points, colonne de lecture centrée de 640 points,
  barre d'onglets et mini-barre qui la suivent (css/navigation.css, fait pour l'iPhone Duo), feuilles de 600 points au
  plus.

### Pour l'App Store (à faire par Maxence)

- **Captures iPad 13 pouces** (obligatoires dès que l'app tourne sur iPad) : 2064 × 2752 ou 2048 × 2732 en portrait
  (ou l'inverse en paysage), de 1 à 10. Le simulateur « iPad Pro 13-inch » les donne à la bonne taille : le workflow
  iOS (mode contrôle) en joint quatre (portrait 2064 × 2752 et paysage redressé 2752 × 2064, sombre et clair ; étape bornée à 12 min, qui ne fait jamais échouer le contrôle) dans l'artefact `captures-simulateur`,
  dossier `ipad/`. Pour de vraies captures de vente (onglet Coach, mode grand écran ouvert), les refaire sur ce
  simulateur une fois connecté à un compte coach de démonstration.
- Page de l'app : vérifier que la description ne parle pas que d'iPhone ; la catégorie et l'âge ne changent pas.
- Revue d'Apple : l'app est jugée aussi sur iPad (règle 2.4.1 : elle doit y marcher correctement). Tester sur un vrai
  iPad avant la soumission : rotation, Split View, Slide Over, clavier externe.

## Tests

- `node tests/unit/run.mjs` : `tests/unit/coach-ipad.mjs` : règles de grand écran (iPad, iPad en mode ordinateur,
  iPhone couché, Split View, Android refusé, navigateur, 678 points), choix retenu, jetons seuls passés au cadre, CSP de
  la page embarquée, scripts inertes jusqu'à la session ; liaison chargée avec les VRAIS scripts de coach-web dans un
  cadre sans stockage : rien avant la session, messages d'une autre fenêtre ignorés, session reçue par message, en
  mémoire, rafraîchissement arrêté, jetons dans les deux sens retenus seulement s'ils sont acceptés, pas de
  déconnexion, « Connexion perdue » ; `sandbox` sans `allow-same-origin`, source vérifiée, aucun accès direct au cadre,
  aucune photo ; canal natif filtré ; argument `-mdlfE2E` lu seulement en Debug ; projet Xcode, Info.plist, vue web
  mobile, `frame-src 'self'`.
- `python3 tests/test_coach_ipad.py` (`PPL_ENGINES=webkit`, `PPL_NO_BUILD=1` pour réutiliser dist/) : l'app
  **construite**, Chromium et WebKit, iPad 1024 × 1366 et 1366 × 1024, tactile, marges de l'iPad, sombre et clair :
  carte jamais ouverte d'office, ouverture, cadre isolé (origine « null », pas de stockage, `parent.Capacitor`,
  `parent.cphCoachUnlock`, `parent.sb`, `parent.document` inaccessibles), session de l'app reçue par message, aucun
  écran de connexion, aucune entrée « bientôt », plein écran, marges, un seul « Revenir à l'appli » (44 points), fiche,
  rotation, retour, choix retenu, jetons dans les deux sens, message d'une autre fenêtre ignoré, « Se déconnecter » qui
  ramène sans déconnecter, déconnexion de l'app qui ferme le mode, Masquer, Réglages › Coach, iPhone inchangé, Split
  View à 678 points ; **mode ouvert puis 678 (reste), 375 et 320 points (se referme avec le message)** : Split View et
  Slide Over ne se pilotent pas en XCUITest, c'est ce test qui les couvre. Le cadre a son propre faux serveur (il ne
  voit rien de l'app), avec les mêmes comptes. CSP vérifiée dans les deux fenêtres.
- CI : étape « Mode coach grand écran sur iPad » du job `coach-web` (Chromium et WebKit).

### Test dans la vraie vue web (XCUITest, simulateur iPad)

Étape **bloquante** « Test d'interface iPad (XCUITest) » d'ios.yml (mode contrôle) sur l'iPad Pro 13 pouces virtuel,
dans la vraie WKWebView, sous `capacitor://localhost` : `ios/App/UITests/CoachIpadUITests.swift`, cible ajoutée au
projet le temps du test par `scripts/ios/add-ui-tests.rb` (gemme xcodeproj ; jamais dans le projet commité).

- L'app est lancée avec `-mdlfE2E 1`. Seule une build **Debug** lit cet argument (`#if DEBUG`, vérifié par le test
  unitaire) et injecte alors les faux serveurs de `tests/ios_e2e_fixtures.py` (`public/e2e/main.js` dans la fenêtre
  de l'app, `frame.js` dans le cadre) : faux iPhone et faux Supabase des tests web, coach et élèves factices, jetons
  factices, aucun réseau. ios.yml ne les écrit qu'en mode contrôle et vérifie leur absence dans l'archive TestFlight.
- Parcours : onglet Coach, « Ouvrir le mode grand écran », fiche de Léa, onglet Bilans, rotation paysage puis portrait
  (`XCUIDevice.shared.orientation`), arrière-plan puis retour, « Revenir à l'appli », déconnexion (Réglages › compte ›
  Se déconnecter).
- Vérifié dans la vraie vue web, par une ligne d'état « E2E … » lue dans l'arbre d'accessibilité : le cadre isolé
  charge coach-web (élèves affichés), origine « null », session reçue par `postMessage`, `parent.Capacitor` et
  `parent.cphCoachUnlock` inaccessibles depuis le cadre, **appel de plugin tenté depuis le cadre par
  `window.webkit.messageHandlers.bridge` (StatusBar.getInfo) sans aucune réponse du natif** (la fenêtre de l'app
  compte les réponses à ce `callbackId` ; ios.yml exige en plus dans le journal du simulateur le repère « message du
  canal natif ignoré » écrit par `MainFrameOnlyMessageHandler` en Debug), aucune violation de CSP dans l'app ni dans le cadre (comptées
  par `securitypolicyviolation`, et journal du simulateur `log stream` joint à l'artefact).
- Une capture à chaque étape (`XCTAttachment`), exportées dans l'artefact `captures-simulateur`, dossier
  `uitests/captures/`.
- **Limite** : la vraie connexion Supabase (`setSession` sur le vrai serveur, jetons réels, rotation) n'est pas
  couverte par ce test, faute de compte de démonstration réel : elle l'est par les tests web (même code, faux serveur
  fidèle aux réponses de supabase-js) et par supabase-js lui-même.

## Limites connues

- **Risque accepté : le cadre reçoit le jeton de rafraîchissement.** coach-web doit pouvoir appeler le serveur et
  renouveler sa session après une veille : il reçoit donc les deux jetons de la session de l'app, en mémoire. Une
  faille XSS dans coach-web (texte reçu mal échappé) pourrait les lire et ouvrir la session du coach ailleurs, jusqu'à
  sa révocation, **exactement comme sur le site coach.mdlf.app**, où la même page détient la même session. Le cadre
  isolé limite ce que la faille atteint (ni Trousseau, ni Capacitor, ni coffre des photos, ni données de l'app sur
  l'appareil, ni bascule de l'app sur un autre compte), pas la session elle-même. Défenses en place : CSP `script-src
  'self'` sans `unsafe-inline` ni hôte extérieur, tout texte reçu passé par `esc()` dans coach-web. Une session volée
  resterait valable jusqu'à sa révocation côté serveur (Supabase, tableau de bord ou API d'administration) : l'app n'a
  pas aujourd'hui de bouton « Se déconnecter de tous les appareils ».

- Clavier externe : Échap et les raccourcis de coach-web marchent dans le cadre (il a le focus à l'ouverture) ; aucun
  raccourci pour revenir à l'app.
- Le thème suit le système dans le mode grand écran, même si l'app est réglée autrement (coach-web n'a pas de réglage
  de thème).
- Textes « iPhone » : dans l'app, ceux qui parlent de cet appareil disent « iPad » sur un iPad (`phoneName`,
  `thisPhone`, `thePhone`, `ofThePhone` de js/platform/native.js ; audit m5). Restent « iPhone » les textes vrais
  seulement d'un iPhone (montre, écouteur du haut, Dynamic Island) et ceux de l'aide qui nomment « l'app iPhone »
  face au site. Les messages fixes de js/data/access.js et js/data/coach.js (achats bloqués, clé de photos sur un autre
  appareil, contrôle parental) disent encore « iPhone » : à reprendre avec leurs tests.
