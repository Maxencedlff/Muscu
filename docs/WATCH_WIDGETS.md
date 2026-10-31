# Apple Watch, widget et Siri

Écrit sur la branche `nuit-watch`, **intégré au projet Xcode et compilé sur la branche `build-ios`**
(31/10/2026) avec la build qui apporte aussi les notifications push et la Santé détaillée (docs/BUILD.md).

**Mises à jour à chaud** : l'empreinte native (`runtime`, `scripts/runtime-version.mjs`) compte le Swift
référencé dans une phase « Sources » du projet Xcode, plus les Info.plist et droits des cibles. L'intégration
change donc l'empreinte : une mise à jour à chaud faite depuis `build-ios` ne va qu'aux builds qui ont la
montre, et une faite depuis `main` (sans l'intégration) ne va qu'aux builds plus anciennes. Fusionner
`build-ios` dans `main` seulement quand cette build est celle que les utilisateurs ont.

## Ce que ça fait

| Partie | Pour l'utilisateur | Où |
|---|---|---|
| **App Apple Watch** | Pendant la séance : exercice, série « 2 sur 4 », charge prévue, bouton **Valider** ; pendant le repos : compte à rebours, −15 / +15 s, **Passer**, série suivante. Sans séance : la prochaine séance, « Démarre ta séance sur l'iPhone » | `ios/App/Watch/` (nouvelle cible) |
| **Widget** | Écran d'accueil (petit, moyen) : prochaine séance (prête ou « prête dans 5 h »), séances de la semaine face à l'objectif, une pastille par jour ; séance en cours avec son chrono. Écran verrouillé : rectangulaire et circulaire (jauge de la semaine) | `ios/App/Widgets/` (dans l'extension RestActivity existante) |
| **Siri / Raccourcis** | « Démarrer ma séance dans MDLF Training » (aussi Spotlight, app Raccourcis, bouton Action) : ouvre l'app et démarre la prochaine séance, ou revient à la séance en cours | `ios/App/AppExtras/StartSessionIntent.swift` |

Rien ne part au serveur : la montre parle à l'iPhone (WatchConnectivity), le widget lit un instantané
laissé sur l'iPhone (trousseau partagé, voir plus bas). `privacy.html` et la fiche Confidentialité d'App Store Connect ne
changent donc pas.

## Comment c'est construit

Une seule vérité : la séance de l'iPhone (le JS). La montre et le widget n'ont aucune règle à eux.

```
js/features/watch.js ──watchState()──▶ MdlfWatch (WatchPlugin.swift) ──WatchConnectivity──▶ app de la montre
        ▲                                                                                     │
        └──── watchActionFor() vérifie ◀── notifyListeners('action') ◀── geste { type, ei, si, at } ┘

js/features/home-widget.js ──widgetSnapshot()──▶ MdlfWidget ──trousseau partagé──▶ NextSessionWidget (RestActivity)

Siri ──▶ StartSessionIntent (ouvre l'app) ──▶ ShortcutInbox ──▶ MdlfShortcuts ──▶ js/features/siri.js ──▶ startSessionFlow()
```

| Fichier | Rôle | Cible Xcode |
|---|---|---|
| `ios/App/Shared/CompanionShared.swift` | Types échangés (`WatchSessionState`, `WatchAction`, `WidgetSnapshot`), trousseau partagé (`SharedKeychain`), clés, versions | **App + MDLFWatch + RestActivity** |
| `ios/App/AppExtras/WatchPlugin.swift` | Module `MdlfWatch` + `WatchLink` (session WatchConnectivity unique, gestes gardés en attendant la vue web) | App |
| `ios/App/AppExtras/WidgetPlugin.swift` | Module `MdlfWidget` : écrit l'instantané dans le trousseau partagé, recharge le widget | App |
| `ios/App/AppExtras/ShortcutsPlugin.swift` | Module `MdlfShortcuts` + `ShortcutInbox` (demande de Siri gardée jusqu'à ce que le JS la prenne) | App |
| `ios/App/AppExtras/StartSessionIntent.swift` | `AppIntent` « Démarrer ma séance » et `AppShortcutsProvider` (phrases en français) | App |
| `ios/App/Watch/*.swift` | App de la montre : `MDLFWatchApp`, `WatchSessionModel` (WatchConnectivity), écrans, couleurs | MDLFWatch |
| `ios/App/Widgets/NextSessionWidget.swift` | Widget (frise : maintenant, heure où la séance sera prête, lundi suivant) | RestActivity |
| `ios/App/Widgets/PrivacyInfo.xcprivacy` | Manifeste de confidentialité de l'extension | RestActivity (ressource) |
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

## Intégration (faite sur `build-ios`)

Sans Mac : le projet a été modifié avec la gemme Ruby `xcodeproj` (cibles, fichiers, réglages), puis
compilé par la CI macOS.

| Où | Quoi |
|---|---|
| Cible **App** | `AppExtras/*.swift` et `Shared/CompanionShared.swift` ; `WatchPlugin`, `WidgetPlugin`, `ShortcutsPlugin` enregistrés dans `MainViewController` ; `WatchLink.shared.activate()` dans `AppDelegate` ; phase « Embed Watch Content » (`$(CONTENTS_FOLDER_PATH)/Watch`) et dépendance vers MDLFWatch |
| Cible **RestActivity** | `Widgets/NextSessionWidget.swift` (déclaré dans `RestActivityBundle`), `Widgets/PrivacyInfo.xcprivacy`, `CompanionShared.swift`, droits `RestActivity/RestActivity.entitlements` |
| Cible **MDLFWatch** (nouvelle) | watchOS 10, `com.mdlf.training.watchkitapp`, `Watch/*.swift` + `CompanionShared.swift`, `Watch/Info.plist` (`WKApplication`, `WKCompanionAppBundleIdentifier = com.mdlf.training`, versions de l'app), icône `Watch/Assets.xcassets` (produite par `scripts/brand-icons.py`), profil « MDLF Training Watch App Store » en Release |
| Signature | `ios/ExportOptions.plist` et `ios.yml` : profil de la montre (secret `APPSTORE_PROFILE_WATCH`) ; la compilation de contrôle n'impose plus le SDK iPhone (`-sdk`), qui casserait la cible watchOS |
| Empreinte | `RUNTIME_INPUTS` : `RestActivity.entitlements`, `Watch/Info.plist` et l'icône de la montre ; tests de `tests/unit/companions.mjs` inversés (tout est dans le projet) |

**Trousseau partagé au lieu d'un App Group.** Un App Group (`group.…`) doit être créé à la main sur
developer.apple.com : l'API App Store Connect ne sait ni le créer ni l'attacher à un identifiant. Un groupe
de trousseau de l'équipe, lui, est accepté par tout profil (`keychain-access-groups : NMK739Z59B.*`) : l'app
et l'extension ont `$(AppIdentifierPrefix)com.mdlf.training.shared` dans leurs droits, l'instantané du
widget y est rangé (`SharedKeychain`, lisible après le premier déverrouillage, jamais sauvegardé). Dans les
droits de l'app, le groupe de l'app (`$(AppIdentifierPrefix)com.mdlf.training`) reste le premier : c'est
le groupe par défaut de ses éléments du trousseau (connexion Google), inchangé.

Côté Apple (API, 31/10/2026) : capacité Push Notifications sur `com.mdlf.training`, identifiant
`com.mdlf.training.watchkitapp` (« MDLF Training Watch »), profil « MDLF Training App Store » recréé (avec
`aps-environment`), profil « MDLF Training Watch App Store » créé ; secrets `APPSTORE_PROFILE` et
`APPSTORE_PROFILE_WATCH` mis à jour. Le profil de l'extension n'a pas changé.

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
