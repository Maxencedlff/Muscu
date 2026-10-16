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
| `Native.keepAwake()` | wake lock de `init.js` | Écran allumé pendant la séance |
| `Native.statusBar()` | `applyTheme()`, démarrage | Texte de la barre d'état adapté au thème |
| `Native.backup()` / `boot()` | `save()`, démarrage | Copie `ppl_v2.json` dans les Documents de l'app (sauvegardés par iCloud) ; restaurée si le stockage web est vide, jamais écrasée avant |
| `Native.hideSplash()` | démarrage | Écran de démarrage retiré après le premier rendu (filet à 4 s) |

L'autorisation des notifications est demandée au premier repos, au moment où elle a du sens.

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

La signature est **manuelle** pour la configuration Release : la signature automatique d'Xcode
exige un appareil enregistré pour créer d'abord un profil de développement. Le certificat et le
profil ont été créés par l'API App Store Connect depuis le PC (clé privée générée localement,
copie dans `~/.config/apple/`). **À renouveler avant octobre 2027** : nouveau certificat
(`POST /v1/certificates`, type DISTRIBUTION), nouveau profil, puis mise à jour des trois secrets.

## Publier une version

1. Mettre à jour `MARKETING_VERSION` (ex. 1.1.0) dans `ios/App/App.xcodeproj/project.pbxproj`.
2. Lancer le mode TestFlight sur `main`.
3. Tester la build dans TestFlight sur un vrai iPhone.
4. Dans App Store Connect : nouvelle version, sélectionner la build, « Soumettre pour vérification ».

## Suite prévue

| Objectif | Ce qu'il faut | Remarques |
|---|---|---|
| **Apple Santé** | Capacité HealthKit sur l'identifiant + module Capacitor HealthKit | Enregistrer chaque séance terminée comme entraînement « Musculation » (durée, calories estimées). Texte de confidentialité déjà prêt |
| **Version payante** | Contrat « Paid Applications » + infos fiscales et bancaires (App Store Connect), Small Business Program (15 %) | Abonnement ou achat unique via StoreKit (RevenueCat simplifie la gestion des reçus) ; garder une partie gratuite |
| **Apple Music** | Capacité MusicKit + module natif | Contrôle de la lecture pendant la séance |
| **Notifications push** (rappels) | Clé APNs | Les rappels de séance peuvent rester en notifications locales, sans serveur |
| **Mises à jour sans App Store** | Capacitor Live Updates (Appflow) ou équivalent | Seulement si les corrections web doivent arriver plus vite que la revue d'Apple |
