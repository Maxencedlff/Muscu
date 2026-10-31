# Apple Watch, widget et Siri

Branche `nuit-watch`. **Code natif écrit mais NON COMPILÉ** (pas de Xcode sur la machine où il a été
écrit) et **pas encore branché dans le projet Xcode** : la build actuelle ne change pas tant que les
étapes ci-dessous ne sont pas faites. Le JS, lui, est prêt et testé : il ne fait rien tant que la
coquille installée n'a pas les nouveaux modules.

**Mises à jour à chaud** : l'empreinte native (`runtime`, `scripts/runtime-version.mjs`) ne compte que
le Swift référencé dans une phase « Sources » du projet Xcode. Tant que ces fichiers n'y sont pas, la
branche a donc **la même empreinte que main** (`117834dea8c35add` au 31/10) et une mise à jour à chaud
faite depuis elle, ou depuis main après fusion, est acceptée par les builds installées ; le JS de la
montre, du widget et de Siri y reste muet. C'est vérifié par deux tests de `tests/unit/companions.mjs`.
Dès que l'intégration Xcode est faite (étapes plus bas), l'empreinte change : à partir de là, plus
aucune mise à jour à chaud n'atteint les anciennes builds, comme pour tout changement natif. **Fusionner
l'intégration Xcode dans main seulement avec la build qui l'apporte** (branche « build »), jamais avant
une mise à jour à chaud encore attendue par les builds installées.

## Ce que ça fait

| Partie | Pour l'utilisateur | Où |
|---|---|---|
| **App Apple Watch** | Pendant la séance : exercice, série « 2 sur 4 », charge prévue, bouton **Valider** ; pendant le repos : compte à rebours, −15 / +15 s, **Passer**, série suivante. Sans séance : la prochaine séance, « Démarre ta séance sur l'iPhone » | `ios/App/Watch/` (nouvelle cible) |
| **Widget** | Écran d'accueil (petit, moyen) : prochaine séance (prête ou « prête dans 5 h »), séances de la semaine face à l'objectif, une pastille par jour ; séance en cours avec son chrono. Écran verrouillé : rectangulaire et circulaire (jauge de la semaine) | `ios/App/Widgets/` (dans l'extension RestActivity existante) |
| **Siri / Raccourcis** | « Démarrer ma séance dans MDLF Training » (aussi Spotlight, app Raccourcis, bouton Action) : ouvre l'app et démarre la prochaine séance, ou revient à la séance en cours | `ios/App/AppExtras/StartSessionIntent.swift` |

Rien ne part au serveur : la montre parle à l'iPhone (WatchConnectivity), le widget lit un fichier
laissé sur l'iPhone (App Group). `privacy.html` et la fiche Confidentialité d'App Store Connect ne
changent donc pas.

## Comment c'est construit

Une seule vérité : la séance de l'iPhone (le JS). La montre et le widget n'ont aucune règle à eux.

```
js/features/watch.js ──watchState()──▶ MdlfWatch (WatchPlugin.swift) ──WatchConnectivity──▶ app de la montre
        ▲                                                                                     │
        └──── watchActionFor() vérifie ◀── notifyListeners('action') ◀── geste { type, ei, si, at } ┘

js/features/home-widget.js ──widgetSnapshot()──▶ MdlfWidget ──App Group──▶ NextSessionWidget (RestActivity)

Siri ──▶ StartSessionIntent (ouvre l'app) ──▶ ShortcutInbox ──▶ MdlfShortcuts ──▶ js/features/siri.js ──▶ startSessionFlow()
```

| Fichier | Rôle | Cible Xcode |
|---|---|---|
| `ios/App/Shared/CompanionShared.swift` | Types échangés (`WatchSessionState`, `WatchAction`, `WidgetSnapshot`), App Group, clés, versions | **App + MDLFWatch + RestActivity** |
| `ios/App/AppExtras/WatchPlugin.swift` | Module `MdlfWatch` + `WatchLink` (session WatchConnectivity unique, gestes gardés en attendant la vue web) | App |
| `ios/App/AppExtras/WidgetPlugin.swift` | Module `MdlfWidget` : écrit l'instantané dans l'App Group, recharge le widget | App |
| `ios/App/AppExtras/ShortcutsPlugin.swift` | Module `MdlfShortcuts` + `ShortcutInbox` (demande de Siri gardée jusqu'à ce que le JS la prenne) | App |
| `ios/App/AppExtras/StartSessionIntent.swift` | `AppIntent` « Démarrer ma séance » et `AppShortcutsProvider` (phrases en français) | App |
| `ios/App/Watch/*.swift` | App de la montre : `MDLFWatchApp`, `WatchSessionModel` (WatchConnectivity), écrans, couleurs | MDLFWatch |
| `ios/App/Widgets/NextSessionWidget.swift` | Widget (frise : maintenant, heure où la séance sera prête, lundi suivant) | RestActivity |
| `ios/App/Widgets/PrivacyInfo.xcprivacy` | Manifeste de confidentialité de l'extension (UserDefaults de l'App Group, 1C8F.1) | RestActivity (ressource) |
| `js/features/watch.js`, `home-widget.js`, `siri.js` | Logique (pure, testée dans `tests/unit/companions.mjs`) et branchement | web |

Règles de sûreté :

- **Geste de la montre** : il porte la série visée (`ei`, `si`) et son heure (`at`). Un geste de plus
  de 30 s est ignoré deux fois : à l'arrivée côté natif (`WatchAction.isFresh`) et au moment où le JS
  l'applique (`watchActionFor`), car la vue web, suspendue pendant que l'iPhone est verrouillé, ne le
  traite qu'au déverrouillage. Le JS ne valide que si c'est toujours la série en cours et qu'elle est
  validable depuis la montre. Sinon la montre reçoit l'état réel.
- **Rien avant la fin du démarrage** : la montre et Siri ne sont écoutés qu'une fois la séance restaurée
  (`watchBoot()` et `siriBoot()`, appelés par `init.js`). Un geste gardé par le natif
  (`retainUntilConsumed`) est donc jugé sur la vraie séance, jamais sur « pas de séance » ; une demande
  de Siri arrivée pendant le chargement reste dans `ShortcutInbox` et ne peut pas démarrer une séance
  neuve par-dessus celle enregistrée. Vérifié de bout en bout par `tests/test_watch.py` (coquille factice).
- **Ce qui ne se valide pas au poignet** (le bouton est remplacé par une phrase) : série en durée ou
  cardio, chrono d'effort en cours, série rouverte sur l'iPhone, valeur inhabituelle à confirmer.
- **La montre n'envoie un geste que si l'iPhone est joignable**, puis attend le nouvel état (5 s au plus,
  sinon « Pas arrivé, réessaie »). Elle ne devine jamais l'état suivant.
- **Siri** : rien ne démarre pendant Bienvenue, les questions du premier lancement, un dialogue ou une
  feuille ouverte, ni pour une demande de plus d'une minute. Séance déjà en cours : on y retourne.
- **Envois économes** : l'état de la montre n'est renvoyé que s'il a changé (il est calculé à chaque
  `persistSession()`), l'instantané du widget seulement quand l'app passe en arrière-plan et s'il a changé
  (iOS limite le nombre de rechargements d'un widget).
- **Fin de repos montre au poignet baissé** : l'app de la montre est suspendue ; c'est la notification
  de fin de repos de l'iPhone, déjà programmée, que watchOS relaie sur la montre.

## Étapes pour l'intégrer (Xcode sur un Mac)

À faire sur une branche « build » : tout ceci change l'empreinte native (`runtime`,
`scripts/runtime-version.mjs`). Ses dossiers Swift couvrent déjà `AppExtras/`, `Watch/` et `Widgets/` ;
chaque fichier y compte dès qu'il est ajouté à une phase « Sources » du projet Xcode.

### 1. Identifiants et App Group (developer.apple.com)

1. **Identifiers › App Groups › +** : `group.com.mdlf.training`.
2. **Identifiers** : cocher la capacité **App Groups** (avec ce groupe) sur `com.mdlf.training` et
   `com.mdlf.training.RestActivity`.
3. **Identifiers › +** : `com.mdlf.training.watchkitapp` (App ID de la montre ; aucune capacité).
4. **Profiles** : régénérer « MDLF Training App Store » et « MDLF Training Rest Activity App Store »
   (la capacité a changé), créer « MDLF Training Watch App Store » pour `com.mdlf.training.watchkitapp`.
   Mettre les trois en base64 dans les secrets GitHub (`APPSTORE_PROFILE`,
   `APPSTORE_PROFILE_REST_ACTIVITY`, nouveau `APPSTORE_PROFILE_WATCH`).

### 2. App iPhone (cible App)

1. Glisser `ios/App/AppExtras/` dans le groupe App (« Create groups », cible **App** seulement).
2. Ajouter `ios/App/Shared/CompanionShared.swift` aux cibles **App, RestActivity** (et MDLFWatch à l'étape 4).
3. **Signing & Capabilities › + App Groups** : `group.com.mdlf.training` (ajoute
   `com.apple.security.application-groups` à `App/App.entitlements`).
4. `App/MainViewController.swift`, dans `capacitorDidLoad()` :
   ```swift
   bridge?.registerPluginInstance(WatchPlugin())
   bridge?.registerPluginInstance(WidgetPlugin())
   bridge?.registerPluginInstance(ShortcutsPlugin())
   ```
5. `App/AppDelegate.swift`, dans `didFinishLaunchingWithOptions` avant `return true` (un geste de la
   montre réveille l'app en arrière-plan, parfois sans charger la vue web) :
   ```swift
   WatchLink.shared.activate()
   ```

### 3. Widget (cible RestActivity existante)

1. Ajouter `ios/App/Widgets/NextSessionWidget.swift` et `ios/App/Widgets/PrivacyInfo.xcprivacy` à la cible **RestActivity**.
2. **Signing & Capabilities › + App Groups** sur RestActivity : `group.com.mdlf.training` (crée
   `RestActivity/RestActivity.entitlements` et `CODE_SIGN_ENTITLEMENTS`).
3. `RestActivity/RestActivityBundle.swift` :
   ```swift
   var body: some Widget {
       RestLiveActivity()
       NextSessionWidget()
   }
   ```
   (et mettre à jour le commentaire « aucun widget d'écran d'accueil »).

### 4. App de la montre (nouvelle cible)

1. **File › New › Target › watchOS › App** : nom `MDLFWatch`, « Watch App for Existing iOS App » →
   App, interface SwiftUI, sans tests. Identifiant `com.mdlf.training.watchkitapp`, watchOS 10.0.
2. Supprimer les fichiers générés (`ContentView.swift`, `MDLFWatchApp.swift` du modèle) et glisser
   `ios/App/Watch/*.swift` dans la cible MDLFWatch ; y ajouter aussi `Shared/CompanionShared.swift`.
3. Réglages de la cible : `INFOPLIST_KEY_WKCompanionAppBundleIdentifier = com.mdlf.training`,
   `INFOPLIST_KEY_CFBundleDisplayName = MDLF`, `MARKETING_VERSION` et `CURRENT_PROJECT_VERSION`
   repris de l'app (`$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` : App Store Connect exige les mêmes).
4. Icône : `Assets.xcassets › AppIcon` de la montre, une image 1024 × 1024 (celle de l'iPhone, `brand-icons.py`).
5. Vérifier que la cible App embarque la montre (**Build Phases › Embed Watch Content**, ajouté par Xcode).

### 5. Signature et CI

1. `ios/ExportOptions.plist › provisioningProfiles` : ajouter
   `com.mdlf.training.watchkitapp` → `MDLF Training Watch App Store`.
2. `.github/workflows/ios.yml` : ajouter `APPSTORE_PROFILE_WATCH` à la boucle des profils.
3. `scripts/runtime-version.mjs › RUNTIME_INPUTS` : ajouter le nouveau `RestActivity/RestActivity.entitlements`,
   ainsi que l'Info.plist et les droits de la cible MDLFWatch.
4. Tests : `tests/unit/companions.mjs` vérifie aujourd'hui que le projet Xcode **ne** référence **pas**
   encore ces fichiers (deux tests : noms partagés, et « aucun Swift de la montre dans le projet ») ;
   les inverser (comme celui de `CloudBackupPlugin`) une fois l'intégration faite : `WatchPlugin.swift in
   Sources`, `registerPluginInstance(WatchPlugin())`, entitlements de l'App Group.

Sans Mac : la même chose peut se faire sur la CI macOS avec la gemme Ruby `xcodeproj` (ajout de cibles,
fichiers et réglages par script), mais ce script serait lui aussi écrit à l'aveugle. Xcode est plus sûr
pour la première fois, puis la CI compile et envoie comme aujourd'hui.

## Contrôles avant TestFlight

- [ ] La CI (mode contrôle) compile les trois cibles sans erreur ni nouvel avertissement.
- [ ] Simulateur iPhone + montre appairée : démarrer une séance, la montre affiche l'exercice ; Valider
      sur la montre → la série est cochée sur l'iPhone, le repos démarre des deux côtés ; −15 / +15 / Passer.
- [ ] Série en durée (gainage) : la montre dit « Série à saisir sur l'iPhone ».
- [ ] iPhone verrouillé, montre au poignet : Valider fonctionne (app iPhone réveillée) ; sinon « Pas arrivé, réessaie ».
- [ ] Widget petit, moyen, verrouillé : clair **et** sombre (fond noir pur), la semaine repart à zéro le lundi.
- [ ] « Dis Siri, démarrer ma séance dans MDLF Training » : app fermée, app ouverte, séance en cours, Bienvenue affichée.
- [ ] VoiceOver sur la montre et le widget (étiquettes en français).

## Limites connues (V1)

- Pas de séance d'entraînement watchOS (`HKWorkoutSession`) : pas de fréquence cardiaque ni d'app
  gardée au premier plan. À ajouter ensuite, avec l'autorisation Santé de la montre.
- La charge et les répétitions se modifient sur l'iPhone ; la montre valide les valeurs prévues.
- Le widget n'a pas de bouton (widgets interactifs : iOS 17, App Intents dans l'extension) : le toucher ouvre l'app.
- Pas de complication de cadran pour la montre (WidgetKit sur watchOS) : possible plus tard avec le même instantané.
