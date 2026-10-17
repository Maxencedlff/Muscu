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
| `ios/App/` | Projet Xcode (Swift Package Manager) : équipe `NMK739Z59B`, iPhone uniquement, portrait, iOS 16.4+, icône, écran de démarrage, `PrivacyInfo.xcprivacy` |
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
| `Native.backup()` / `boot()` | `save()`, démarrage | Copie `ppl_v2.json` dans les Documents de l'app (sauvegardés par iCloud) ; restaurée si le stockage web est vide, jamais écrasée avant |
| `Native.hideSplash()` | démarrage | Écran de démarrage retiré après le premier rendu (filet à 4 s) |

L'autorisation des notifications est demandée au premier repos, au moment où elle a du sens.

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
| `ios/App/App/LiveActivityPlugin.swift` (`MdlfLiveActivity`) | `start`, `update`, `end`, `isAvailable` ; opérations exécutées dans l'ordre d'arrivée ; reprend la Live Activity d'une séance restaurée au lieu d'en créer une autre ; au lancement, retire celle d'un repos déjà fini |
| `ios/App/RestActivity/` | Extension WidgetKit `com.mdlf.training.RestActivity` : écran verrouillé (`RestActivityViews.swift`), Dynamic Island compacte, minimale et étendue (`RestLiveActivity.swift`), marque MDLF Training (`Assets.xcassets`) |
| `js/features/rest-activity.js` | Données envoyées (`restActivityPayload`, logique pure testée) et branchement : `syncRestActivity()` là où la notification de fin de repos est programmée (début, ±15 s, autre durée, reprise), `endRestActivity()` dans `stopRest()` (fin, Passer, annulation, fin de séance) |
| `scripts/ios/add-rest-activity-target.rb` | Crée la cible d'extension dans le projet Xcode (gem `xcodeproj`), idempotent |

- **Aucune mise à jour chaque seconde** : le temps restant et l'anneau sont dessinés par iOS à
  partir de l'heure de fin (`Text(timerInterval:)`, `ProgressView(timerInterval:)`). L'app n'envoie
  rien d'autre qu'au début, à ±15 s et à la fin, ce qui économise la batterie et reste juste app
  suspendue.
- **Repos fini app en arrière-plan** : la date de péremption (`staleDate`) vaut l'heure de fin ;
  passé cette heure, l'extension affiche « C'est reparti » sans que l'app ait à se réveiller. Au
  retour dans l'app, `restFinished()` la retire.
- **Fin immédiate** (`dismissalPolicy: .immediate`), comme le demande Apple dès que la tâche est finie.
- **Couleur** : `var(--orange)` devient la couleur système `systemOrange` (claire ou sombre selon
  l'écran) ; une couleur de séance perso (`#RRGGBB`) est reprise telle quelle.
- **Taille** : textes bornés (séance 40, exercice 60, charge 30 caractères) sous la limite de 4 Ko.
- `NSSupportsLiveActivities = YES` dans `Info.plist` ; aucune autorisation à demander (l'utilisateur
  peut les couper dans Réglages › MDLF Training).
- **Versions** : `MARKETING_VERSION` et `CURRENT_PROJECT_VERSION` sont réglées au niveau du projet
  (et non des cibles) : App Store Connect refuse une extension dont la version diffère de l'app.
- **Contrôle sur la CI** : en Debug, l'argument de lancement `-MDLFDemoRestActivity` démarre un repos
  factice ; ios.yml photographie la Dynamic Island compacte, puis étendue (mise à jour avec alerte
  22 s après), et tente l'écran verrouillé (⌘L de Simulator.app).

Références Apple : ActivityKit « Displaying live data with Live Activities », WidgetKit
`ActivityConfiguration` / `DynamicIsland`, HIG « Live Activities » (marge de 14 pt, hauteur
de 160 pt au plus, marque sans conteneur, contenu serré contre la caméra). Capacitor : « iOS custom
native code » (module enregistré par `MainViewController`).

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
