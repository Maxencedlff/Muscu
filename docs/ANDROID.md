# MDLF Training sur Android

État au 31 octobre 2026 : **préparation**. Le projet Android existe (Capacitor 8, même contenu web que
l'iPhone), avec ses modules natifs, son icône et son thème noir pur. **Rien n'est publié**, aucun
compte Google n'est créé, et **le code Kotlin n'a jamais été compilé** (pas de SDK Android sur la
machine de développement : le workflow `android.yml` le compilera au premier envoi de la branche).

L'iPhone reste la priorité (feuille de route : Android « après la sortie iPhone »). Rien ici ne change
le comportement de l'app iOS : son empreinte native est identique (`117834dea8c35add` avant et après),
donc les mises à jour à chaud continuent d'arriver sur les iPhone sans nouvelle build.

## 1. Ce qui est fait

| Élément | Où | Remarque |
|---|---|---|
| Plateforme Android Capacitor 8.5.3 (même version que `@capacitor/core` et `@capacitor/ios`, figée) | `android/`, `package.json` | `npm run android:sync` construit `dist/` (empreinte Android) puis copie dans le projet |
| Android 8 minimum (`minSdk 26`), cible Android 16 (`targetSdk 36`) | `android/variables.gradle` | 26 : imposé par Health Connect ; Capacitor 8 demande 24 |
| Kotlin 2.2.20, coroutines 1.10.2 | `android/build.gradle`, `variables.gradle` | Mêmes versions que `@capacitor/filesystem` |
| **MdlfHealth** : Health Connect 1.1.0 | `HealthPlugin.kt` | Mêmes méthodes et réponses que `HealthPlugin.swift` |
| **MdlfLiveActivity** : repos en cours | `LiveActivityPlugin.kt` | Notification continue avec compte à rebours système |
| **MdlfStore** : Google Play Billing 9.1.0 | `StorePlugin.kt` | Même contrat que `StorePlugin.swift` (branche payant) ; **non branché au serveur** |
| Politique de confidentialité pour Health Connect | `PermissionsRationaleActivity.kt`, manifeste | Montre `privacy.html` embarquée (exigée par Health Connect) |
| Icône adaptative + monochrome (Android 13), icône des notifications, écran de démarrage noir pur | `scripts/brand-icons.py --android` | Générées depuis `js/data/app-icons.js`, comme iOS |
| Images de la fiche Play (icône 512, image 1024 × 500) | `android/store/` | Non embarquées dans l'app |
| Sauvegarde Google limitée à `ppl_v2.json` | `res/xml/data_extraction_rules.xml`, `backup_rules.xml` | Remplace la copie iCloud |
| Portrait seulement, comme sur iPhone | manifeste | |
| Pont natif conscient de la plateforme | `js/platform/native.js` | `Native.platform` : `'ios'`, `'android'`, `'web'` |
| Réglages › « Santé » (Health Connect) sans Apple Music sur Android | `js/features/apple-services.js` | iOS : textes inchangés |
| Empreinte native par plateforme | `scripts/runtime.mjs` | iOS ignore `android/` et `@capacitor/android` ; Android préfixée `android-` |
| Compilation de contrôle (APK de débogage + lint) | `.github/workflows/android.yml` | Seulement quand Android change, ou à la main |
| Tests unitaires | `tests/unit/android.mjs` | Empreintes, pont natif simulé Android et iOS, cohérence Kotlin ↔ Swift ↔ pont ↔ manifeste |

### Modules natifs : iOS → Android

| Module iOS (Swift) | Android | Choix |
|---|---|---|
| `MdlfHealth` (HealthKit) | **Health Connect** | Mêmes données, rien d'autre (voir 3.1) |
| `MdlfLiveActivity` (ActivityKit) | **Notification continue** | Android n'a pas de Live Activity (voir 3.2) |
| `MdlfStore` (StoreKit 2, branche payant) | **Google Play Billing 9** | Le serveur décide, comme sur iOS (voir 3.3) |
| `MdlfSound` (AVAudioEngine) | Aucun : Web Audio | Android ne coupe pas le son des médias en mode silencieux : la raison d'être du module iOS n'existe pas. `Native.sound.available` est faux, les bips restent en Web Audio |
| `MdlfCloudBackup` (iCloud) | Aucun : sauvegarde Google | `ppl_v2.json` écrit dans le dossier privé de l'app (`DATA`), seul fichier sauvegardé par Google et restauré à la réinstallation ; `Native.boot` le remet en place |
| `MdlfMusic` (Apple Music) | Aucun | Pas d'équivalent ouvert sur Android (Spotify a fermé son kit). Cellule masquée |
| `MdlfAppIcon` (icônes alternatives) | Aucun | Possible avec des `activity-alias`, mais l'app redémarre et l'icône disparaît un instant de l'écran d'accueil : pas digne de l'iPhone. La rubrique se masque seule (`supported: false`) |
| `MdlfAccount` (Apple, Google, Trousseau) | **À faire** | Rubrique Compte masquée sur Android tant qu'il n'existe pas (voir 4) |

Modules Capacitor officiels déjà compatibles Android sans rien faire : haptique, notifications locales,
écran allumé, barre d'état, écran de démarrage, fichiers, partage, app, mises à jour à chaud (Capgo).

## 2. Mises à jour à chaud

`scripts/runtime.mjs` calcule une empreinte par plateforme. Le manifeste publié par `ota.yml` porte
l'empreinte **iOS** : une app Android (empreinte `android-…`) le refuse toujours (« nécessite une
nouvelle version de l'app »). Aucune mise à jour à chaud n'arrive donc sur Android tant qu'un canal
Android n'existe pas. Quand il le faudra : un second manifeste (`manifest-android.json`) construit avec
`node scripts/build-web.mjs --android`, et l'adresse choisie dans `live-update.js` selon
`Native.platform`. Google Play autorise ces mises à jour pour du contenu web interprété (règle
« Device and Network Abuse » : pas de code exécutable natif téléchargé), mais la règle de prudence
reste celle d'Apple : corrections seulement.

## 3. Modules natifs en détail

### 3.1 Santé : Health Connect (`MdlfHealth`)

- **Données** (mêmes qu'Apple Santé) : écriture de `ExerciseSessionRecord` (« Musculation »,
  `EXERCISE_TYPE_STRENGTH_TRAINING`) et `ActiveCaloriesBurnedRecord` ; lecture de `WeightRecord`,
  `ExerciseSessionRecord` (course, tapis, vélo, vélo d'appartement) et `DistanceRecord`. Le manifeste
  déclare exactement ces 5 autorisations (test unitaire).
- **Disponibilité** : intégré au système depuis Android 14 ; avant, appli à installer. `available` est
  faux tant que `getSdkStatus` ne répond pas `SDK_AVAILABLE` ; le web propose alors d'installer ou de
  mettre à jour Health Connect.
- **Doublons** : chaque séance porte un `clientRecordId` (`mdlf-session-<début>`) : « Envoyer
  l'historique dans Santé » deux fois ne crée pas de doublon.
- **Historique** : sans `READ_HEALTH_DATA_HISTORY` (non demandée), Health Connect ne rend que les
  30 jours précédant la première autorisation, puis tout ce qui suit. Assez pour les pesées et les
  courses récentes ; à revoir si besoin.
- **Différence avec iOS** : Health Connect dit ce qui est accordé (lecture comprise). Après deux refus,
  il ne remontre plus sa fenêtre : l'utilisateur passe par Health Connect › Autorisations des applications.

### 3.2 Repos en cours (`MdlfLiveActivity`)

Notification **continue et silencieuse** (canal « Repos en cours », importance basse) : titre
« Repos · Push », série suivante en texte, compte à rebours dessiné par le système
(`setUsesChronometer` + `setChronometerCountDown`), donc juste même app suspendue. Retirée seule à la
fin (`setTimeoutAfter`), même si l'app est tuée ; la sonnerie reste la notification de fin de repos de
`@capacitor/local-notifications`. Couleur de la séance (mêmes noms que l'extension iOS).

Plus tard (Android 16, « Live Updates ») : `Notification.ProgressStyle` et `setRequestPromotedOngoing`
pour l'afficher en haut de l'écran et sur l'écran toujours allumé, au plus près de la Dynamic Island.
Non fait : API récente, à essayer sur un vrai téléphone.

**Exactitude de l'alarme** : la notification de fin de repos passe par `@capacitor/local-notifications`,
qui déclare `SCHEDULE_EXACT_ALARM`. Depuis Android 14, cette autorisation n'est plus accordée d'office :
sans elle, l'alarme peut arriver avec quelques secondes, voire minutes, de retard en veille. Le compte à
rebours de la notification continue reste juste. Décision à prendre (voir 6).

### 3.3 Abonnements : Google Play Billing (`MdlfStore`)

Même contrat que `StorePlugin.swift` pour que l'écran d'abonnement soit le même :

| Méthode | Android |
|---|---|
| `status()` | `{ canMakePayments, subscriptionIds, giftId }` |
| `products()` | `{ products, missing, canMakePayments }` ; prix formatés par Google, essai gratuit dans `introductoryOffer` |
| `purchase({ productId, appAccountToken })` | `{ status: success \| pending \| userCancelled \| unknown }` ; `appAccountToken` part chez Google en `obfuscatedAccountId` |
| `finish({ transactionId })` | `transactionId` = `purchaseToken` ; confirme l'achat (acknowledge) s'il ne l'est pas déjà |
| `restore()` / `current()` | Achats en cours relus chez Google (pas de fenêtre de connexion) |
| `redeemCode()` | Ouvre la page « Utiliser un code » du Play Store ; l'achat arrive par l'écouteur |
| Événements `transaction` et `change` | Achat, renouvellement, achat sur un autre appareil, rattrapage au lancement (`source`) |

Une transaction Android porte `platform: 'android'`, `purchaseToken`, `orderId`, `packageName`,
`productId`, `purchasedAt`, `acknowledged`, `autoRenewing`, `subscription`, `gift` (pas de `jws`).

**Règle de sûreté (identique à iOS)** : l'app ne décide jamais d'un droit. Le serveur vérifie le
`purchaseToken` auprès de Google et écrit `entitlements`.

**Différence importante** : Google **rembourse automatiquement** un achat non confirmé sous 3 jours.
Le serveur doit donc confirmer lui-même (voir 5) ; `finish()` côté app n'est qu'un filet.

Produits Play à créer (mêmes identifiants qu'App Store Connect) : abonnements
`com.mdlf.training.pro.monthly` (offre de base `monthly`, P1M) et `com.mdlf.training.pro.yearly`
(offre de base `yearly`, P1Y), avec l'essai éventuel en offre ; produit ponctuel
`com.mdlf.training.access.gift` (jamais mis en vente, seulement par code promo).

## 4. Reste à faire dans le code (avant les testeurs)

1. **Compte sur Android** (`MdlfAccount` Kotlin) : connexion Google par Credential Manager
   (`androidx.credentials` + `googleid`, ID token envoyé à Supabase comme sur iOS), session gardée
   chiffrée (clé de l'Android Keystore), code par e-mail inchangé (web). « Continuer avec Apple » :
   masqué sur Android au départ (le compte Apple d'un ancien utilisateur iPhone se relie depuis l'iPhone,
   ou plus tard par la connexion web Apple de Supabase). Règle Google sur la suppression du compte : dans
   l'app (existe déjà) **et** par une page web de demande (à créer, voir 6).
2. **Brancher le paiement** : écran d'abonnement (branche payant) sur `Native.store` quel que soit le
   système, fonction serveur `verify-purchase-android` (voir 5).
3. **Retour arrière** : le bouton retour d'Android passe par l'historique de la vue web (comportement
   par défaut de Capacitor), que le routeur de l'app utilise déjà (écrans et feuilles). À vérifier sur
   un vrai téléphone : feuilles, dialogues, séance en cours, écran de démarrage.
4. **Textes iOS restants** à adapter quand Android approche : « iPhone » dans quelques aides et dans la
   politique de confidentialité, « Réglages de l'iPhone », bouton Apple de l'écran Bienvenue.
5. **Essais sur téléphones** : un Pixel (Android 15/16) et un Samsung (One UI, Health Connect intégré),
   clair et sombre, barre de navigation à gestes et à 3 boutons (marges `env(safe-area-inset-*)` fournies
   par le module SystemBars de Capacitor 8).

## 5. Serveur (à faire, rien n'est écrit)

- Fonction Edge `verify-purchase-android` : reçoit `{ purchaseToken, productId }` du compte connecté,
  appelle `purchases.subscriptionsv2.get` (API Google Play Developer, compte de service dans les secrets
  Supabase, jamais dans le dépôt), vérifie `packageName`, l'état, la date de fin et que
  `obfuscatedExternalAccountId` correspond au compte, écrit `entitlements` (même table qu'iOS,
  `platform = 'android'`, `purchase_token` unique), puis **confirme** l'achat
  (`purchases.subscriptions.acknowledge`).
- Notifications en temps réel de Google (RTDN, Pub/Sub → fonction Edge) : renouvellements, résiliations,
  remboursements, suspension, comme les notifications serveur d'Apple.
- Migration + retour arrière + tests SQL (autre compte, anonyme), selon les règles du dépôt.
- `privacy.html` FR/EN : ajouter le jeton d'achat Google quand il partira au serveur.

## 6. Plan de publication (Google Play)

### Étape 0 : compte (Maxence)
- Compte développeur Google Play **personnel** (25 $ une fois), vérification d'identité (pièce
  d'identité, adresse), vérification d'un téléphone Android avec l'app Play Console. Un compte
  **organisation** (numéro D-U-N-S) échappe au test fermé mais demande une structure (société).
- Profil de paiement (marchand) pour vendre les abonnements ; taux Google : 15 % sur les abonnements.

### Étape 1 : app et test interne (sans attente)
- Créer l'app « MDLF Training » (`com.mdlf.training`), gratuite avec achats intégrés.
- **Clé d'envoi** : créer un keystore d'envoi (gardé hors du dépôt, sauvegardé à deux endroits) ;
  **Play App Signing** activé (Google garde la clé de l'app). Ajouter la signature de release dans
  `android/app/build.gradle` par variables d'environnement (jamais de mot de passe dans le dépôt), et un
  workflow `android-release.yml` qui construit l'AAB signé (secrets GitHub), sur le modèle d'`ios.yml`.
- Test interne (jusqu'à 100 testeurs, disponible en quelques minutes) : Maxence et Cyril, pour essayer
  Health Connect, le repos, les achats (comptes de test de licence : achats sans être débité).

### Étape 2 : test fermé, **12 testeurs pendant 14 jours** (obligatoire pour un compte personnel)
- Exigence Google pour les comptes personnels créés après le 13 novembre 2023 : au moins **12 testeurs
  inscrits au test fermé, sans interruption pendant les 14 derniers jours**, avant de pouvoir demander
  l'accès à la production (puis questionnaire sur le test, examen de quelques jours).
- Viser **15 à 20 inscrits** : il en faut 12 inscrits **sans interruption** pendant 14 jours ; un
  testeur qui se désinscrit ne compte plus, d'où la marge. Sources : amis, salle, testeurs iPhone qui ont un Android,
  coachs partenaires. Liste par groupe Google ou liste d'adresses e-mail dans la Play Console.
- D'après des guides non officiels (à vérifier dans l'aide Play Console le moment venu) : une nouvelle
  version pendant le test ne remet pas le compteur à zéro, mettre le test en pause si. Demander aux testeurs d'**ouvrir l'app** plusieurs fois (Google regarde l'engagement) et de
  répondre au formulaire de retour.
- Calendrier : J0 test fermé ouvert, J14 demande d'accès à la production, ~J21 accès accordé.

### Étape 3 : fiche Play et déclarations
- **Fiche** : nom (30 caractères), description courte (80), description longue (4000), icône 512
  (`android/store/play-icon-512.png`), image de présentation 1024 × 500
  (`android/store/play-feature-1024x500.png`, à habiller), **au moins 2 captures** de téléphone
  (idéalement 4 à 8, en sombre et en clair), catégorie « Santé et remise en forme », e-mail de contact,
  adresse de la politique de confidentialité (page publique de `privacy.html`).
- **Classification du contenu** (questionnaire IARC), **public cible** (15 ans et plus, comme les Amis),
  **publicités** : aucune.
- **Sécurité des données** (Data safety) : reprendre `privacy.html` : compte (e-mail, identifiants),
  séances synchronisées, achats ; chiffrement en transit ; suppression du compte dans l'app et par le web.
- **Health Connect** : formulaire de déclaration des autorisations santé dans la Play Console
  (justifier chacune des 5 autorisations, vidéo de démonstration possible), et déclaration « appli de
  santé ». Sans elle, la version est refusée.
- **Alarmes exactes** : garder `SCHEDULE_EXACT_ALARM` (minuteur de repos = fonction principale, la
  personne l'accorde dans les réglages) ou le retirer et accepter un léger retard en veille (voir 3.2).
- **Suppression du compte** : lien web exigé par Google (page de demande de suppression).

### Étape 4 : pré-inscription (optionnelle, avant la sortie)
- Possible une fois les conditions des comptes personnels remplies (test fermé), avec une fiche
  complète, la classification faite, un AAB dans le canal de pré-inscription et les pays choisis.
- **90 jours au plus** par pays, ensuite il faut publier. Deux campagnes au plus en même temps.
- À la sortie, les inscrits reçoivent une notification et l'app s'installe seule sur les téléphones
  compatibles (Android 6+, hors comptes d'enfants de moins de 13 ans).
- Récompense possible : un produit ponctuel gratuit dédié (pas un abonnement), par exemple un mois
  offert ou un thème ; à livrer obligatoirement (sinon suspension).
- Intérêt pour nous : en parler sur Instagram pendant les 14 jours de test, récolter des inscrits,
  sortir sur Android le même jour que la campagne.

### Étape 5 : production
- Déploiement progressif (10 %, 50 %, 100 %), surveillance d'Android vitals (plantages, ANR).
- `versionCode` incrémenté à chaque envoi (`android/app/build.gradle`).

## 7. Commandes

```bash
npm ci
npm run android:sync          # dist/ (empreinte Android) puis cap sync android
python3 scripts/brand-icons.py --android   # images Android seulement (iOS intact)
cd android && ./gradlew assembleDebug      # demande un JDK 21 et le SDK Android (ANDROID_HOME)
```

Sur la machine actuelle : JDK 21 présent (`/usr/lib/jvm/java-21-openjdk-amd64`), **pas de SDK Android**
(ni `sdkmanager`, ni `adb`). Le workflow `android.yml` compile sur GitHub (APK de débogage et rapport
de lint en artefacts). Pour compiler en local : installer les outils en ligne de commande Android
(environ 3 Go avec la plateforme 36 et Gradle), puis `sdkmanager "platforms;android-36"
"build-tools;36.0.0"`.
