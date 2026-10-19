# App iPhone (App Store)

L'app iPhone est la PWA embarquée dans une coquille native **Capacitor 8**. Le même code web sert
les deux : la PWA publiée par Vercel et l'app installée depuis l'App Store. Aucune réécriture,
aucun bundler.

## Pourquoi Capacitor

- Le code de l'app (js/, css/) est réutilisé tel quel : une seule base de code à tester et à faire
  évoluer.
- Il donne accès à ce qu'une PWA ne peut pas faire sur iOS : notification de fin de repos écran
  verrouillé, vrai Taptic Engine, écran allumé natif, copie de sécurité des données, et plus tard
  Santé, Apple Music et achats intégrés.
- La compilation iOS se fait sur les Mac de GitHub Actions : pas besoin de Mac.

## Organisation

| Élément | Rôle |
|---|---|
| `js/platform/native.js` | Pont vers iOS (`Native.*`). Dans le navigateur, `Native.isNative` vaut `false` et tout est sans effet |
| `capacitor.config.json` | Identifiant `com.mdlf.training`, nom, dossier web `dist/`, écran de démarrage, notifications |
| `scripts/build-web.mjs` | Copie le contenu web dans `dist/` (sans service worker) et vérifie que tout ce que charge `index.html` est présent |
| `ios/App/` | Projet Xcode (Swift Package Manager) : équipe `NMK739Z59B`, iPhone uniquement, portrait, iOS 16.4+, icônes, écran de démarrage, `PrivacyInfo.xcprivacy` |
| `scripts/brand-icons.py` | Génère toutes les images de la marque (PWA et iOS) depuis `js/data/app-icons.js` (voir « Icône de l'app ») |
| `ios/ExportOptions.plist` | Export App Store Connect avec envoi direct |
| `.github/workflows/ios.yml` | Compilation sur macOS : contrôle (simulateur) ou TestFlight |
| `privacy.html` | Page de confidentialité exigée par Apple (servie par Vercel) |
| `store/` | Fiche App Store (`FICHE_APP_STORE.md`), script et captures d'écran 6,9 pouces |

Les fichiers de l'app iOS sont exclus de la publication Vercel (`.vercelignore`).

## Fonctions natives (native.js)

| Fonction | Branchée dans | Effet dans l'app |
|---|---|---|
| `Native.haptic()` | `haptic()`, `timerDone()` | Taptic Engine (toucher, fin de repos) |
| `Native.scheduleRestEnd()` / `cancelRestEnd()` | `rest.js` | Notification « Repos terminé · Série 3 · Squat » à l'heure de fin, annulée si le repos est passé |
| `Native.liveActivity.start()` / `update()` / `end()` | `rest-activity.js` | Live Activity du repos sur l'écran verrouillé et dans la Dynamic Island (voir plus bas) |
| `Native.keepAwake()` | wake lock de `init.js` | Écran allumé pendant la séance |
| `Native.statusBar()` | `applyTheme()`, démarrage | Texte de la barre d'état adapté au thème |
| `Native.backup()` / `boot()` | `save()`, démarrage | Deux copies : `ppl_v2.json` dans les Documents de l'app (dans la sauvegarde iCloud de l'iPhone) et la copie iCloud de l'app (voir « Copie iCloud ») ; restaurées si le stockage web est vide, jamais écrasées avant |
| `Native.hideSplash()` | démarrage | Écran de démarrage retiré après le premier rendu (filet à 4 s) |
| `Native.appIcon.get()` / `set(nom)` | `app-icon.js` | Icône de l'app choisie dans Réglages (voir « Icône de l'app ») |
| `Native.shareImage(dataUrl, nom)` | `share.js` | Image de la séance écrite dans le cache de l'app (`@capacitor/filesystem`), puis feuille de partage d'iOS (`@capacitor/share` 8.0.3 : Instagram, Messages, Photos…). « Enregistrer l'image » demande l'accès Photos en ajout seul (`NSPhotoLibraryAddUsageDescription`) |

L'autorisation des notifications est demandée au premier repos, au moment où elle a du sens.

### Copie iCloud (`CloudBackupPlugin.swift`)

But : retrouver ses séances après avoir supprimé l'app ou sur un nouvel iPhone, sans compte ni
serveur. La copie des Documents ne suffit pas : elle part avec l'app et ne revient qu'en restaurant
tout l'iPhone.

- Stockage clé-valeur d'iCloud (`NSUbiquitousKeyValueStore`) : le JSON de `ppl_v2` compressé
  (zlib), sa date et son nombre de séances. Limite d'Apple : 1 Mo par app ; au-delà de 900 Ko
  compressés (des années de séances), rien n'est écrit et la copie des Documents reste.
- Envoyé avec le fichier (même délai de 800 ms), **seulement s'il a changé** depuis la dernière
  copie acceptée (empreinte `ppl_cloud_sent`) : l'enregistrement de chaque démarrage n'écrit rien,
  donc ouvrir un vieil iPhone sans rien faire n'écrase pas la copie du nouveau. iOS envoie lui-même
  vers iCloud, par lots, et plus tard hors ligne.
- **Réinstallation** : sans donnée locale ni fichier, `boot()` attend la copie iCloud 2,5 s au plus
  (écran de démarrage), puis la restaure. Arrivée plus tard, ou lue au lancement suivant, elle est
  encore reprise tant qu'il n'y a aucune séance sur l'iPhone (événement `change`, gardé par Swift
  jusqu'à l'abonnement du web). Les enregistrements en attente sont annulés avant le rechargement.
- **Garde-fou, en deux couches** :
  - web (`pushCloud`) : l'écriture iCloud reste fermée tant qu'iCloud n'a pas répondu et qu'aucune
    séance n'existe ; l'état est gardé entre lancements (`ppl_cloud_ready`). Ouverte d'emblée pour
    qui avait déjà des séances avant cette version ;
  - Swift (`save`) : une donnée sans séance n'écrase jamais une copie qui en a, sauf `force`, posé
    par « Supprimer toutes les données » (`Native.eraseCloudOnNextSave()`), qui vide donc aussi
    la copie iCloud.
  Limite connue : réinstaller hors ligne puis enregistrer une séance avant toute connexion remplace
  l'ancienne copie (la sauvegarde iCloud de l'iPhone garde alors le fichier des Documents).
- Deux iPhone sur le même compte : la dernière modification gagne (pas de fusion).
- Entitlement `com.apple.developer.ubiquity-kvstore-identifier` (`App.entitlements`) ; capacité
  iCloud activée sur `com.mdlf.training` et profil App Store régénéré (secret `APPSTORE_PROFILE`).
- Confidentialité : copie dans le compte iCloud de l'utilisateur, aucun accès pour le développeur
  (pas une « collecte » au sens d'App Store Connect) ; `privacy.html` le dit.

### Santé et Apple Music (`js/features/apple-services.js`)

Modules Swift propres à l'app, enregistrés par `ios/App/App/MainViewController.swift` (avec la
Live Activity du repos, plus bas) :

| Module | Côté web | Rôle |
|---|---|---|
| `HealthPlugin.swift` (`MdlfHealth`) | `Native.health.*` | Autorisation, entraînement « Musculation » (HKWorkoutBuilder, énergie active estimée), pesées des 90 derniers jours |
| `MusicPlugin.swift` (`MdlfMusic`) | `Native.music.*` | Morceau en cours du lecteur Musique (titre, artiste, pochette), lecture, pause, suivant, précédent, événement `change` |

- Réglages › Services Apple : interrupteurs `data.healthOn` / `data.musicOn` (désactivés par défaut,
  autorisation demandée à l'activation).
- Fin de séance : `syncWorkoutToHealth(entry)` envoie l'entraînement sans bloquer le bilan.
  Calories : MET 5 × dernier poids × durée (aucune estimation sans pesée).
- Progrès : groupe « Poids corporel » (dernière pesée, tendance sur 30 jours, courbe).
- Séance : barre de lecture en haut, mise à jour par les notifications du lecteur.
- Capacité HealthKit activée sur `com.mdlf.training` (le profil App Store la contient) ; Apple Music
  passe par MediaPlayer et l'autorisation « Médias et Apple Music », sans capacité ni clé.

### Live Activity du repos (écran verrouillé et Dynamic Island)

Pendant un repos, le compte à rebours s'affiche sur l'écran verrouillé et dans la Dynamic Island,
avec la séance (nom et couleur), l'heure de reprise et « Ensuite : Squat · série 3 · 80 kg × 8 ».

| Élément | Rôle |
|---|---|
| `ios/App/Shared/RestActivityAttributes.swift` | Données de la Live Activity (`ActivityAttributes`) : séance et couleur (fixes), heure de fin, durée totale et série suivante (variables). Compilé dans l'app **et** dans l'extension |
| `ios/App/App/LiveActivityPlugin.swift` (`MdlfLiveActivity`) | `start`, `update`, `end` ; opérations exécutées dans l'ordre d'arrivée ; reprend la Live Activity d'une séance restaurée au lieu d'en créer une autre ; au lancement, retire celle d'un repos déjà fini ; à la fermeture de l'app (`willTerminateNotification`), les retire toutes |
| `ios/App/RestActivity/` | Extension WidgetKit `com.mdlf.training.RestActivity` : écran verrouillé (`RestActivityViews.swift`), Dynamic Island compacte, minimale et étendue (`RestLiveActivity.swift`), marque MDLF Training (`Assets.xcassets`) |
| `js/features/rest-activity.js` | Données envoyées (`restActivityPayload`, logique pure testée) et branchement : `syncRestActivity()` appelé par `syncNativeRest()` (`rest.js`), qui aligne aussi la notification de fin de repos (début, ±15 s, autre durée, reprise), `endRestActivity()` dans `stopRest()` (fin, Passer, annulation, fin de séance) et à la reprise d'un repos déjà fini (page rechargée) |
| `scripts/ios/add-rest-activity-target.rb` | Crée la cible d'extension dans le projet Xcode (gem `xcodeproj`), idempotent |

- **Aucune mise à jour chaque seconde** : le temps restant et l'anneau sont dessinés par iOS à
  partir de l'heure de fin (`Text(timerInterval:)`, `ProgressView(timerInterval:)`). L'app n'envoie
  rien d'autre qu'au début, à ±15 s et à la fin, ce qui économise la batterie et reste juste app
  suspendue.
- **Repos fini app en arrière-plan** : la date de péremption (`staleDate`) vaut l'heure de fin ;
  passé cette heure, l'extension affiche « C'est reparti » sans que l'app ait à se réveiller. Au
  retour dans l'app, `restFinished()` la retire. L'écran verrouillé ajoute « Fini depuis 3 min »
  (`Text(_, style: .relative)`, avancé par iOS), pour rester juste même affiché longtemps.
- **App tuée pendant un repos** : sans push, rien ne termine la Live Activity côté serveur, et iOS
  la garde jusqu'à 8 h, puis 4 h de plus sur l'écran verrouillé (ActivityKit, « Displaying live data
  with Live Activities »). Fermée par l'utilisateur (balayage dans le sélecteur d'apps) au premier
  plan ou en arrière-plan actif, l'app reçoit `UIApplication.willTerminateNotification` et termine
  ses Live Activities (1 s au plus). **Limite** : une app suspendue puis tuée par le système (mémoire)
  ne reçoit aucun signal ; la Live Activity reste alors jusqu'au prochain lancement de l'app (retirée
  par `load()`) ou jusqu'à ce qu'iOS l'efface, en affichant depuis quand le repos est fini.
- **Activités terminées encore listées** : juste après `end(…, .immediate)`, une activité peut rester
  un instant dans `Activity.activities` ; seules celles à l'état `.active` ou `.stale` sont reprises.
- **Fin immédiate** (`dismissalPolicy: .immediate`), comme le demande Apple dès que la tâche est finie.
- **Couleur** : `var(--orange)` devient la couleur système `systemOrange` (claire ou sombre selon
  l'écran) ; une couleur de séance perso (`#RRGGBB`) est reprise telle quelle.
- **Taille** : textes bornés (séance 40, exercice 60, charge 30 caractères) sous la limite de 4 Ko.
- `NSSupportsLiveActivities = YES` dans `Info.plist`. Rien à demander côté app : iOS propose lui-même
  « Autoriser les Live Activities de MDLF Training ? » sur l'écran verrouillé la première fois
  (vu sur le simulateur iOS 26), et l'utilisateur peut les couper dans Réglages › MDLF Training.
- **Versions** : `MARKETING_VERSION` et `CURRENT_PROJECT_VERSION` sont réglées au niveau du projet
  (et non des cibles) : App Store Connect refuse une extension dont la version diffère de l'app.
- **Contrôle sur la CI** : en Debug, l'argument de lancement `-MDLFDemoRestActivity` démarre un repos
  factice ; ios.yml signe l'app ad hoc (sans quoi le simulateur ignore l'extension), puis photographie
  la Dynamic Island compacte, étendue (mise à jour avec alerte 22 s après) et l'écran verrouillé
  (⌘L de Simulator.app), pendant puis après le repos.

Références Apple : ActivityKit « Displaying live data with Live Activities », WidgetKit
`ActivityConfiguration` / `DynamicIsland`, HIG « Live Activities » (marge de 14 pt, hauteur
de 160 pt au plus, marque sans conteneur, contenu serré contre la caméra). Capacitor : « iOS custom
native code » (module enregistré par `MainViewController`).

### Icône de l'app (icônes alternatives)

Le signe : un « M » dessiné comme une barre chargée vue de face (les disques forment les
jambages, la barre qui fléchit forme le V), en aplat strict (aucun dégradé, reflet ni ombre).
Réglages › **Icône de l'app** (app iOS seulement, absente de la PWA) propose cinq variantes :

| Libellé | Jeu d'icônes (`Assets.xcassets`) | Fond | Signe |
|---|---|---|---|
| Orange (défaut) | `AppIcon` (+ variantes sombre et teintée d'iOS 18) | `#111111` | `#FF6A1A` |
| Fonte rouillée | `AppIcon-Rouille` | `#1B1815` | `#D9542B` |
| Inversée | `AppIcon-Inversee` | `#FF5A1F` | `#111111` |
| Craie | `AppIcon-Craie` | `#F1ECE3` | `#C9461F` |
| Signature | `AppIcon-Signature` (barre plus fléchie, plus fine) | `#E0582A` | `#15120F` |

| Élément | Rôle |
|---|---|
| `js/data/app-icons.js` | **Seule source** : catalogue `APP_ICONS` (libellé, jeu d'icônes, couleurs) et dessin du signe (`appIconSvg`). Les vignettes de Réglages sont ce même SVG, dessiné en ligne : aucune image à embarquer |
| `scripts/brand-icons.py` | Charge ce fichier avec Node, rend les SVG en PNG (CairoSVG, Pillow), de façon déterministe, et met à jour la liste des icônes alternatives du projet Xcode |
| `ios/App/App/AppIconPlugin.swift` (`MdlfAppIcon`) | `getName` → `{ supported, name? }`, `change({ name })` → `UIApplication.setAlternateIconName` sur le fil principal (`name` absent ou null : icône par défaut ; refus si les icônes alternatives ne sont pas prises en charge). Enregistré par `MainViewController.swift` |
| `js/features/app-icon.js` | Section de Réglages : grille de vignettes (`aria-pressed`, coche), un toucher = changement ; icône courante lue une fois au démarrage |
| `project.pbxproj` (cible App, Debug et Release) | `ASSETCATALOG_COMPILER_ALTERNATE_APP_ICON_NAMES` (écrit par le script) et `ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS = YES` : Xcode compile les jeux alternatifs et remplit lui-même `CFBundleIcons` (rien dans Info.plist) |

- **Images produites** : `icon.svg`, `icon-192.png`, `icon-512.png` (aussi « maskable » : le signe
  tient dans la zone sûre de 80 %), `apple-touch-icon.png` ; `AppIcon` 1024 opaque (Apple refuse la
  transparence), `AppIcon-dark.png` (signe orange sur fond transparent : iOS pose son fond sombre),
  `AppIcon-tinted.png` (signe en niveaux de gris sur fond transparent : iOS applique la teinte) ;
  un 1024 opaque par icône alternative ; écran de démarrage `Splash` 2732 × 2732 (signe sur
  `#111111`) ; marque `MDLFMark` de la Live Activity (image gabarit, seul l'alpha compte).
- **Régénérer** après tout changement du catalogue ou du dessin, puis commiter le script et les
  images ensemble (les tests unitaires vérifient que jeux d'icônes, réglages Xcode et catalogue
  concordent) :

  ```bash
  python3 scripts/brand-icons.py
  ```
- **Ajouter une icône** : une ligne dans `APP_ICONS` (`asset` en `AppIcon-Nom`, sans accent),
  relancer le script, c'est tout. Une icône retirée du catalogue voit son jeu supprimé ; un nom
  natif inconnu (icône d'une ancienne version) s'affiche comme l'icône par défaut.
- **Alerte d'iOS** : après chaque changement, iOS affiche « Vous avez modifié l'icône de
  MDLF Training ». C'est le comportement imposé par le système ; elle n'est pas masquée.
- Changement natif : nouvelle version TestFlight / App Store (les mises à jour à chaud ne le
  transportent pas).

Références Apple : `UIApplication.setAlternateIconName(_:completionHandler:)`,
`supportsAlternateIcons`, réglage de compilation « Alternate App Icon Sets », HIG « App icons »
(variantes Default, Dark et Tinted d'iOS 18).

## Mises à jour à chaud (sans repasser par Apple)

Le contenu web de l'app (js/, css/, index.html) peut être mis à jour sans nouvelle version
TestFlight / App Store, sur le modèle d'Expo Updates.

| Élément | Rôle |
|---|---|
| `@capgo/capacitor-updater` 8.53.0 (MPL-2.0) | Module natif : télécharge un zip, vérifie son SHA-256, l'installe, revient au contenu précédent si le nouveau ne démarre pas. **Mode manuel** (`autoUpdate: false`), **statistiques Capgo coupées** (`statsUrl: ""`) : aucun serveur tiers |
| `js/app/live-update.js` | Décision (`liveUpdateDecision`) et parcours (`checkLiveUpdate`) ; vérifie 3 s après le démarrage puis au retour au premier plan (au plus toutes les 6 h) |
| `scripts/build-web.mjs` | Embarque `window.MDLF_BUILD = { version, seq, runtime }` dans dist/ |
| `scripts/ota-bundle.py` | dist/ → `ota-site/` : `bundles/<version>.zip` (immuable), `manifest.json` (jamais en cache) |
| `.github/workflows/ota.yml` | Tests, paquet, publication sur **https://mdlf-ota.vercel.app**, vérification en ligne du SHA-256 |

**Règles de sûreté**
- **Empreinte native (`runtime`)** : SHA-256 des fichiers Swift, d'Info.plist, des droits, du projet
  Xcode, de capacitor.config.json et des versions des modules natifs. Une mise à jour n'est appliquée
  que si elle a été construite pour la même coquille. Tout changement natif impose donc une version
  TestFlight / App Store ; une coquille plus ancienne ignore les contenus qui ne lui sont pas destinés.
- **Jamais de retour en arrière** : `seq` (date du commit) doit être plus récent que le contenu en place.
- **Démarrage confirmé** : `notifyAppReady` n'est appelé qu'après un démarrage réussi (pas sur
  l'écran de secours) ; sinon le module revient seul au contenu précédent au bout de 10 s, et la
  version fautive n'est jamais retentée.
- **Jamais en pleine séance** : téléchargée en arrière-plan, appliquée au prochain lancement
  (`next` + délai `kill`). Réglages › « Rechercher une mise à jour » l'applique tout de suite hors séance.
- Nouvelle version de l'app installée : retour au contenu d'origine (`resetWhenUpdate`).
- Seul du code commité est publiable (version « -local » refusée).

**Règle Apple (Guideline 2.5.2)** : une app ne doit pas télécharger de code qui « introduit ou
modifie des fonctionnalités ». Les mises à jour à chaud sont donc **réservées aux corrections de
bugs et aux petits ajustements** ; toute nouvelle fonctionnalité passe par une version soumise à
Apple (ios.yml). C'est pourquoi la publication est **manuelle**, avec un motif obligatoire :

```bash
gh workflow run ota.yml -R Maxencedlff/Muscu -f motif="Correction : …"
```

## Commandes

Node 22 est requis (`nvm use 22`).

```bash
npm ci                 # dépendances Capacitor
npm run web:build      # dist/
npm run ios:sync       # dist/ + cap sync ios (après un changement web ou de module natif)
npm run test:unit      # tests unitaires, dont ceux du pont natif
```

## Compilation sur GitHub

```bash
gh workflow run ios.yml -R Maxencedlff/Muscu --ref <branche>                     # contrôle
gh workflow run ios.yml -R Maxencedlff/Muscu --ref main -f testflight=true      # TestFlight
```

- **Contrôle** : compile pour le simulateur, lance l'app sur un iPhone virtuel et joint deux
  captures (artefact `captures-simulateur`). Aucun secret nécessaire.
- **TestFlight** : archive signée (signature automatique par la clé d'API), numéro de build =
  numéro du run, envoi sur App Store Connect.
- Image **macOS 26 avec Xcode 26** : Apple refuse tout envoi compilé avec un SDK antérieur à iOS 26.
- Les builds envoyées arrivent dans le groupe TestFlight interne « Interne » (accès à toutes les builds).
- Le dépôt étant privé, chaque compilation consomme des minutes macOS (environ 10 min par run,
  quota gratuit d'environ 200 min par mois).

### Secrets GitHub (mode TestFlight)

| Secret | Valeur |
|---|---|
| `ASC_KEY_ID` | Clé d'API App Store Connect au rôle **Admin** (`AVSJM6323R`, « MDLF CI ») |
| `ASC_ISSUER_ID` | `02dafbe1-af2c-4c38-9ddc-e66714e62e2d` |
| `ASC_KEY_P8` | Contenu du fichier `AuthKey_AVSJM6323R.p8` |
| `DIST_CERT_P12` / `DIST_CERT_PASSWORD` | Certificat « Apple Distribution » (expire le 16/10/2027) et sa clé, en base64 |
| `APPSTORE_PROFILE` | Profil « MDLF Training App Store » (IOS_APP_STORE, expire le 16/10/2027), en base64 |
| `APPSTORE_PROFILE_REST_ACTIVITY` | Profil « MDLF Training Rest Activity App Store » de l'extension `com.mdlf.training.RestActivity` (IOS_APP_STORE, même certificat, expire le 16/10/2027), en base64 |

La signature est **manuelle** pour la configuration Release : la signature automatique d'Xcode
exige un appareil enregistré pour créer d'abord un profil de développement. Le certificat et le
profil ont été créés par l'API App Store Connect depuis le PC (clé privée générée localement,
copie dans `~/.config/apple/`). **À renouveler avant octobre 2027** : nouveau certificat
(`POST /v1/certificates`, type DISTRIBUTION), deux nouveaux profils (app et extension), puis mise à jour
des quatre secrets.

## Publier une version

1. Mettre à jour `MARKETING_VERSION` (ex. 1.1.0) dans `ios/App/App.xcodeproj/project.pbxproj` (réglages
   du projet, Debug et Release : l'app et l'extension la partagent).
2. Lancer le mode TestFlight sur `main`.
3. Tester la build dans TestFlight sur un vrai iPhone.
4. Dans App Store Connect : nouvelle version, sélectionner la build, « Soumettre pour vérification ».

## Suite prévue

| Objectif | Ce qu'il faut | Remarques |
|---|---|---|
| **Version payante** | Contrat « Paid Applications » + infos fiscales et bancaires (App Store Connect), Small Business Program (15 %) | Abonnement ou achat unique via StoreKit (RevenueCat simplifie la gestion des reçus) ; garder une partie gratuite |
| **Notifications push** (rappels) | Clé APNs | Les rappels de séance peuvent rester en notifications locales, sans serveur |
| **Mises à jour sans App Store** | Capacitor Live Updates (Appflow) ou équivalent | Seulement si les corrections web doivent arriver plus vite que la revue d'Apple |
