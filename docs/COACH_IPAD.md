# Mode coach grand écran dans l'app (iPad, tablettes)

Idée de Maxence validée en principe le 25/11/2026 : sur iPad, l'onglet Coach ouvre la même interface que coach.mdlf.app,
embarquée dans l'app, avec la même session, et un bouton « Revenir à l'appli ». coach.mdlf.app reste pour les
ordinateurs. Sur iPhone, rien ne change.

Branche `coach-ipad`. **Rien n'est publié** : ni mise à jour à chaud, ni build TestFlight. L'iPad demande une
**nouvelle build native** (famille d'appareils, orientations, vue web) : une mise à jour à chaud seule ne suffit pas.

## Ce que voit le coach

- Onglet Coach, segment Élèves, sur un grand écran : en tête, la carte « Tes élèves sur tout l'écran », avec
  **Ouvrir le mode grand écran** et **Masquer**. Rien ne s'ouvre d'office.
- Choix retenu sur l'appareil (`mdlf_coach_desk`) : après une première ouverture, la carte devient une simple ligne
  « Mode grand écran » ; après « Masquer », plus rien dans l'onglet. La ligne reste toujours dans Réglages › Coach
  (groupe « Tu es coach »).
- Grand écran : `coachDeskEligible` (js/data/coach-desk.js) : dans l'app seulement (iOS ou Android), jamais avec un
  user agent d'iPhone (iPhone Duo compris), fenêtre d'au moins **768 points sur iPad** (iPad Air en portrait 820,
  iPad 13 pouces en Split View à moitié 678 : non) et **900 ailleurs** (tablettes Android). La carte suit la largeur
  (rotation, Split View) ; un mode ouvert reste ouvert si la fenêtre rétrécit.
- Mode ouvert : l'appli web du coach en plein écran. « Revenir à l'appli » est toujours à l'écran : celui de l'appli
  web (barre latérale et barre d'onglets, vague 4 de coach-web) dès qu'il est visible, sinon la barre de l'hôte en
  haut (pendant le chargement, si la page est en erreur, ou avec une version de coach-web sans ce bouton). Jamais les
  deux à la fois. Au retour : l'onglet Coach, relu (messages lus, bilans répondus là-bas).

## Iframe plutôt que navigation : le choix

| | Cadre (iframe) de même origine, par-dessus l'app (retenu) | Navigation de la vue web vers `coach/index.html` |
|---|---|---|
| App pendant le mode coach | Reste vivante dessous : séance en cours, repos, minuteries, Live Activity, synchro | Déchargée : tout repart au retour (écran de lancement, reprise de séance) |
| Retour | Immédiat (le cadre est retiré) | Rechargement complet de l'app |
| « Revenir à l'appli » | Peut vivre dans l'hôte, hors de la page du coach : visible même si elle plante | Seulement dans la page du coach |
| Modules natifs | Aucun dans le cadre : Capacitor n'injecte son pont que dans la fenêtre principale (`forMainFrameOnly: true`, JSExport.swift) | Toute la coquille native exposée à la page du coach |
| Mises à jour à chaud | `coach/` voyage dans le même paquet que l'app | Idem, mais `notifyAppReady` du module de mise à jour est rappelé à chaque retour |
| Session | Passée de fenêtre à fenêtre, en mémoire | À faire transiter par un stockage (Trousseau, localStorage) |

Capacitor sert le cadre comme le reste (`capacitor://localhost/coach/index.html` est une adresse de l'application :
WebViewDelegationHandler l'autorise). Aucune adresse distante : la page vient du paquet (`dist/coach/`).

## Construction

`node scripts/build-web.mjs` (donc `npm run ios:sync`) appelle `embedCoachWeb` (scripts/embed-coach-web.mjs) :
la même sortie que le site (`buildCoachWeb` de scripts/build-coach-web.mjs : page, styles, les scripts partagés exacts,
supabase-js figé) dans `dist/coach/`, puis seulement :

- pas de `vercel.json` (aucun en-tête dans la vue web : Capacitor sert les fichiers) ;
- **CSP resserrée** : `script-src 'self'` seul (le script de Sign in with Apple JS n'est jamais chargé, la session
  vient de l'app), `img-src` avec `blob:` (photos déchiffrées, voir plus bas), `frame-src 'none'` vérifié ;
- deux scripts de liaison (`coach-embed/`) : `bridge-start.js` avant tous les autres, `bridge-end.js` après
  `js/desk/main.js` (la construction échoue sinon).

Environ 1,2 Mo de plus dans `dist/` (et dans le paquet des mises à jour à chaud). CSP de l'app : `frame-src 'self'`
(était `'none'`) : un cadre de ses propres fichiers seulement.

## Session : celle de l'app, un seul rafraîchisseur

1. Ouverture (`coachDeskOpen`, js/features/coach-desk-ui.js) : `sb.auth.getSession()` de l'app (renouvelle des
   jetons expirés), puis `window.MDLF_COACH_PARENT = { session(), exit(), onSession(), photos }` dans la fenêtre de
   l'app, puis le cadre. Hors ligne : « Pas d'Internet : le mode grand écran a besoin du réseau. »
2. `bridge-start.js` (premier script du cadre) lit la fenêtre parente, **même origine vérifiée** (une autre origine
   lève une erreur, attrapée : rien n'est posé et la page se comporte comme le site), et pose le contrat de
   l'appli web du coach, `window.MDLF_COACH_HOST = { session: { access_token, refresh_token }, exit, onSession,
   photos }` (docs/COACH_WEB.md, « Embarquer dans l'app »). Seul ce fichier lit la fenêtre parente.
3. coach-web (`deskResume`) : `setSession` avec ces jetons, client supabase-js sans stockage
   (`persistSession: false`) : ni écran de connexion, ni copie de la session dans le navigateur, ni fermeture après
   30 minutes (l'app décide).
4. `bridge-end.js` : les jetons de rafraîchissement de Supabase sont **à usage unique** (rotation) ; deux clients qui
   rafraîchiraient chacun de leur côté finiraient par présenter un jeton déjà remplacé, et passé le délai de
   réutilisation (10 s) Supabase fermerait la session des deux côtés. Donc :
   - rafraîchissement automatique **arrêté dans le cadre** (`stopAutoRefresh`, une fois la session posée) ; l'app reste
     le seul rafraîchisseur régulier et pose ses jetons neufs dans le cadre (`MDLF_COACH_EMBED.setSession`) ;
   - jeton expiré dans le cadre quand même (iPad sorti de veille avant que l'app renouvelle) : supabase-js le
     renouvelle à la première requête, et les jetons neufs repartent aussitôt à l'app (`onSession` → `sb.auth.setSession`,
     gardés dans le Trousseau comme d'habitude) ;
   - **jamais de déconnexion depuis le cadre** : `signOut` du client du cadre ramène à l'app. Une déconnexion là-bas
     fermerait la session de l'app sur le serveur.
5. Déconnexion de l'app pendant le mode ouvert (session révoquée ailleurs) : le mode se ferme.
6. Retour (`coachDeskClose`) : jetons retirés de la fenêtre, cadre vidé (`about:blank`) puis retiré, images libérées,
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

## Photos de bilan : point d'accroche

Les écrans de photos de coach-web n'existent pas encore (vague 5). Le jour venu, ils passent par
`window.MDLF_COACH_HOST.photos` ; **la clé privée du coach ne quitte jamais l'app** (secret du trousseau iCloud rendu
après Face ID par le module du coffre, js/data/coach-photos.js, docs/PHOTOS_BILAN.md). Le cadre ne reçoit que des
adresses `blob:` d'images déjà déchiffrées (même origine : utilisables dans le cadre ; `img-src blob:` dans sa CSP).

| Appel | Rend | Notes |
|---|---|---|
| `available()` | bool | réception des photos activée sur ce compte et cet appareil |
| `isOpen()` | bool | photos déverrouillées (Face ID passé, moins d'une minute sans toucher) |
| `unlock()` | `{ ok, missing, mismatch, refused }` | Face ID dans l'app (`cphCoachUnlock`) |
| `list(élève)` | `{ ok, photos: [{ id, takenOn, pose }] }` | métadonnées seulement (`cphCoachLoad`) |
| `open(élève, id)` | adresse `blob:` ou null | déchiffrée par l'app (`cphCoachFetch`), null si verrouillé |
| `release(adresse)` | | à appeler quand l'image n'est plus affichée |
| `touch()` | | à chaque geste sur une photo (repousse la fermeture d'une minute) |
| `lock()` | | refermer tout de suite |

Les adresses sont toutes libérées quand les photos se referment (une minute sans toucher, `onCphLock`) ou quand le mode
grand écran se ferme : l'écran du cadre doit alors redemander `unlock()`.

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
  iOS (mode contrôle) en joint quatre (portrait et paysage, sombre et clair ; étape bornée à 12 min, qui ne fait jamais échouer le contrôle) dans l'artefact `captures-simulateur`,
  dossier `ipad/`. Pour de vraies captures de vente (onglet Coach, mode grand écran ouvert), les refaire sur ce
  simulateur une fois connecté à un compte coach de démonstration.
- Page de l'app : vérifier que la description ne parle pas que d'iPhone ; la catégorie et l'âge ne changent pas.
- Revue d'Apple : l'app est jugée aussi sur iPad (règle 2.4.1 : elle doit y marcher correctement). Tester sur un vrai
  iPad avant la soumission : rotation, Split View, Slide Over, clavier externe.

## Tests

- `node tests/unit/run.mjs` : `tests/unit/coach-ipad.mjs` : règles de grand écran (iPad, iPad en mode ordinateur,
  iPhone couché, Split View, Android, navigateur), choix retenu, jetons seuls passés au cadre, CSP de la page
  embarquée et ordre de ses scripts, liaison chargée avec les VRAIS scripts de coach-web (session reprise en mémoire,
  rien dans le stockage, rafraîchissement arrêté, jetons dans les deux sens sans écho, pas de déconnexion, rien hors
  de l'app ou depuis une autre origine), projet Xcode, Info.plist, vue web mobile, `frame-src 'self'` de l'app.
- `python3 tests/test_coach_ipad.py` (`PPL_ENGINES=webkit`, `PPL_NO_BUILD=1` pour réutiliser dist/) : l'app
  **construite**, Chromium et WebKit, iPad 1024 × 1366 et 1366 × 1024, tactile, marges de l'iPad, sombre et clair :
  carte jamais ouverte d'office, ouverture, élèves de l'app dans l'appli web, aucun écran de connexion, jetons de
  l'app posés dans le cadre, rien dans le stockage, pas de pont natif dans le cadre, plein écran, marges, un seul
  « Revenir à l'appli » (44 points), fiche d'un élève, rotation mode ouvert, retour, app de nouveau active, choix
  retenu, jetons renouvelés dans les deux sens, « Se déconnecter » qui ramène sans déconnecter, déconnexion de l'app
  qui ferme le mode, Masquer, Réglages › Coach, iPhone inchangé, Split View à 678 points. CSP vérifiée dans les deux
  fenêtres. Captures dans `$PPL_SCRATCH/shots/coach-ipad/`.
- CI : étape « Mode coach grand écran sur iPad » du job `coach-web` (Chromium et WebKit) ; workflow iOS : lancement
  sur un iPad Pro 13 pouces virtuel et captures.

## Limites connues

- Le pont de Capacitor n'est pas injecté dans le cadre, mais son canal (`window.webkit.messageHandlers`) reste
  joignable depuis toute fenêtre de la vue web, et Capacitor ne vérifie pas de quelle fenêtre vient un message. Sans
  importance ici (le cadre ne charge que les fichiers du paquet, CSP `script-src 'self'`), à garder en tête si un jour
  un cadre chargeait autre chose.
- Clavier externe : Échap et les raccourcis de coach-web marchent dans le cadre (il a le focus à l'ouverture) ; aucun
  raccourci pour revenir à l'app.
- Le thème suit le système dans le mode grand écran, même si l'app est réglée autrement (coach-web n'a pas de réglage
  de thème).
- Dépend de la vague 4 de coach-web pour son propre bouton « Revenir à l'appli » et le masquage de « Se déconnecter
  de cet ordinateur » en mode embarqué. Sans elle, la barre de l'hôte assure le retour et `bridge-end.js` empêche la
  déconnexion.
