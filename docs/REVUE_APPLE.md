# Revue d'Apple : note d'examen, compte de démo, captures des abonnements

Préparé le 31/10/2026 (branche `nuit-legal`) pour la première build payante. **Rien n'est envoyé ni créé
dans App Store Connect** : tout ce qui suit est à faire par Maxence. Règles lues le 31/10/2026 sur
https://developer.apple.com/app-store/review/guidelines/ , relues le 12/11/2026 (version « Last Updated:
October 16, 2026 ») pour l'audit du 12/11 : voir la section 6.

## 1. Ce que l'examen va regarder

| Règle | Exigence (texte d'Apple) | Où c'est dans l'app |
|---|---|---|
| 2.1(a) | « include demo account info (and turn on your back-end service!) if your app includes a login » ; aucun texte provisoire | Compte de démo (section 3) ; **les emplacements « À COMPLÉTER » des pages juridiques doivent être remplis avant l'envoi** (docs/JURIDIQUE.md). |
| 2.3.1(a) | « All new features, functionality, and product changes must be described with specificity in the Notes for Review section of App Store Connect » | Note d'examen (section 2) : chaque fonction de la build, photos de bilan comprises. Règle des mises à jour à chaud : section 6.2. |
| 2.5.2 | « nor may they download, install, or execute code which introduces or changes features or functionality of the app » | Mises à jour à chaud réservées aux corrections et aux contenus (IOS.md, docs/BUILD.md) : section 6.2. |
| 2.5.19 | « Don't include any hidden, dormant, or undocumented features in your app » | Aucune fonction cachée : les interrupteurs du serveur (`app_config`) sont des réglages d'exploitation décrits dans la note d'examen. Section 6.2. |
| 3.1.1 | « Apps may not use their own mechanisms to unlock content or functionality, such as license keys… » | **Fait le 12/11** : « J'ai un code » (code cadeau maison) n'existe plus dans l'app iOS, seul « J'ai un code d'offre Apple » reste. Section 6.1. |
| 5.1.1(ii) | « Ensure your purpose strings clearly and completely describe your use of the data » | Textes Appareil photo et Photothèque réécrits le 12/11 (envoi possible au coach). Section 6.4. |
| 5.1.3(ii) | « may not store personal health information in iCloud » | Poids, mensurations, repas cochés et sexe retirés de la copie iCloud clé-valeur le 12/11. Section 6.3. |
| 3.1.2(a) | Abonnement d'au moins 7 jours, « ongoing value », sur tous les appareils | Mensuel ou annuel ; séances synchronisées par le compte ; verrou ALLUMÉ dans la build d'examen (décision de Maxence, docs/PAYANT_V1.md). |
| 3.1.2(c) | Dire clairement ce que l'on obtient pour le prix ; exigences du Schedule 2 | Écran d'abonnement : ce que donne l'abonnement, prix et période en gros, essai en ligne secondaire, renouvellement automatique, résiliation 24 h avant, liens **Conditions d'utilisation**, **Conditions de vente**, **Confidentialité**. Captures : section 4. |
| 5.1.1(v) | « If your app supports account creation, you must also offer account deletion within the app. » ; utilisation sans compte quand c'est possible | Sans compte : programmes, bibliothèque, historique, progrès, export. Compte exigé seulement pour enregistrer une séance une fois l'abonnement en place. Suppression : Réglages › Compte › Supprimer mon compte (révocation de « Se connecter avec Apple » comprise). |

## 2. Note pour l'équipe d'examen (App Review Information › Notes), prête à coller
Remplacer les valeurs entre crochets. **Ne jamais mettre de vrai mot de passe dans le dépôt** : le compte
de démo se tape directement dans App Store Connect.

> MDLF Training is a strength-training log. It can be used without an account: browsing programs and the exercise library, viewing history and progress charts, and exporting data never require one.
>
> Subscriptions (guideline 3.1.2): the paywall is ON in this build. Recording a new workout opens the subscription screen (Settings › Subscription also shows it). Personal plans (monthly, yearly) are offered to everyone, with a 3-month free trial (Apple introductory offer). Coach plans (10, 20, 30 or unlimited students) are only offered to accounts whose coach role was verified by us (qualified sports instructors with a French professional card); the demo account below is a verified coach, so all ten products are visible. Each plan shows its price and period, the trial, auto-renewal, how to cancel, and links to the Terms of Use (Apple standard EULA, supplemented by our terms), Terms of Sale and Privacy Policy. Purchases work in the Sandbox environment; "Restore purchases" is on the same screen.
>
> Account (guideline 5.1.1(v)): an account is only required to record new workouts once subscribed, because the subscription is attached to the user's account on our server (we verify Apple's signed transactions and App Store Server Notifications), so that it can be restored on another device, and so that a coach can follow a student. Sign in with Apple is offered first, then Google and a one-time email code; no password. Account deletion: Settings › Account › Delete my account (this also revokes Sign in with Apple).
>
> Demo account (verified coach, Google sign-in): [ADRESSE DU COMPTE GOOGLE DE DÉMO] / [MOT DE PASSE DU COMPTE GOOGLE DE DÉMO]. You can also sign in with your own Apple ID to see the personal plans.
>
> Student offer: a student who joins a coach with the coach's code gets 25% off the monthly plan for 12 months through a single-use Apple offer code distributed by our server; it cannot be tested without a coach code and a Sandbox offer code.
>
> Codes: the only code that can be entered in the iOS app is an Apple subscription offer code ("J'ai un code d'offre Apple", which opens Apple's own redemption sheet). The app has no license keys or other code of its own to unlock features.
>
> Progress check photos for a coach ("Photos de bilan"): a student who joined a coach can send that coach 1 to 3 progress photos from the app's photo vault (Face ID), one by one, after stating they are 18 or older, and only if the coach turned on receiving photos. Photos are encrypted on the iPhone for that coach only (we cannot read them); the student can remove each photo at any time, and the coach can hide one. The demo account (a coach) shows the receiving side in Social › Coach. Like other server settings, this feature can be switched off on our server for operational reasons (abuse, incident); it is on in this build.
>
> Contact: Maxence de La Fouchardière, contact@mdlf.app, [NUMÉRO DE TÉLÉPHONE].

## 3. Compte de démo à créer (Maxence)
Pourquoi Google : l'app n'a pas de mot de passe ; un code par e-mail arriverait dans une boîte que
l'examinateur ne lit pas, et « Se connecter avec Apple » ne se partage pas. Un compte Google dédié se
partage par adresse et mot de passe.

1. Créer un compte Google dédié à l'examen (adresse du genre `revue.mdlf.<quelque-chose>@gmail.com`),
   **sans validation en deux étapes**, avec un mot de passe long, différent de tout autre, gardé dans le
   gestionnaire de mots de passe (jamais dans le dépôt, jamais dans un mail).
2. Se connecter une fois avec ce compte dans l'app (TestFlight) pour créer le compte MDLF, choisir le
   pseudo `revue`.
3. Lui donner le rôle coach (éditeur SQL, après avoir relevé son `user_id` dans Authentication › Users) :
   `select private.approve_coach('<uuid du compte de démo>', 'Compte de démo pour l''examen d''Apple');`
4. Facultatif : quelques séances (s'entraîner une fois avec le compte) pour que l'historique ne soit pas vide.
5. Coller l'adresse et le mot de passe dans App Store Connect › App Review Information › Sign-in
   required (et dans la note ci-dessus), le numéro de téléphone et l'e-mail de contact.
6. Après l'examen : changer le mot de passe du compte Google ; le compte de démo garde son abonnement
   Sandbox (sans valeur réelle).

## 4. Captures de revue des 10 abonnements
Champ « Capture d'écran pour la revue » de chaque abonnement (aujourd'hui `MISSING_METADATA`). Apple :
« A screenshot of the In-App Purchase that clearly shows the item or service being offered… Upload a
screenshot that meets any of the screenshot specifications your app supports. » (aide d'App Store Connect,
lue le 31/10/2026).

- Fichiers : `docs/revue/sombre/` (**à envoyer**, l'app est en noir pur) et `docs/revue/clair/` (contrôle),
  PNG **1320 × 2868** (iPhone 6,9 pouces, taille déjà acceptée pour la fiche de l'app), un par produit,
  nommés `NN-<identifiant du produit>.png`, dans l'ordre des niveaux du groupe.
- Ce sont les **écrans réels de l'app** (écran d'abonnement, verrou allumé, compte coach validé), la
  formule concernée au centre, avec son prix France, l'essai et les mentions 3.1.2. StoreKit et le serveur
  sont simulés aux prix France du 30/10 (aucun achat réel).
- Refaire les images : `PPL_URL=http://127.0.0.1:8843/ flock /tmp/ppl-e2e.lock python3 store/captures_revue.py sombre`
  (puis `clair`), serveur local lancé à la racine du dépôt.
- Si App Store Connect refuse la taille (cela arrive selon les forums des développeurs), une image
  640 × 920 a été signalée comme acceptée : réduire et recadrer depuis ces fichiers.

| Produit | Fichier |
|---|---|
| `com.mdlf.training.pro.monthly` | `01-com.mdlf.training.pro.monthly.png` |
| `com.mdlf.training.pro.yearly` | `02-com.mdlf.training.pro.yearly.png` |
| `com.mdlf.training.coach10.monthly` | `03-com.mdlf.training.coach10.monthly.png` |
| `com.mdlf.training.coach10.yearly` | `04-com.mdlf.training.coach10.yearly.png` |
| `com.mdlf.training.coach20.monthly` | `05-com.mdlf.training.coach20.monthly.png` |
| `com.mdlf.training.coach20.yearly` | `06-com.mdlf.training.coach20.yearly.png` |
| `com.mdlf.training.coach30.monthly` | `07-com.mdlf.training.coach30.monthly.png` |
| `com.mdlf.training.coach30.yearly` | `08-com.mdlf.training.coach30.yearly.png` |
| `com.mdlf.training.coachmax.monthly` | `09-com.mdlf.training.coachmax.monthly.png` |
| `com.mdlf.training.coachmax.yearly` | `10-com.mdlf.training.coachmax.yearly.png` |

Note de revue de chaque abonnement coach (champ « Review Notes » du produit), à coller :
> Coach plans are only offered in the app to accounts whose coach role was verified (qualified sports instructors). The demo account in the app's review information is a verified coach. A coach plan includes the coach's own full access and following up to 10 / 20 / 30 / unlimited students.

## 5. Risques et choix à trancher avant l'envoi
1. **Codes cadeaux maison (règle 3.1.1)** : **tranché le 12/11 (option (b) dans l'app iOS)**, voir 6.1. Reste
   à décider par Maxence : garder la saisie des codes maison dans le navigateur et sur Android, ou les retirer
   aussi (6.1, « Ce qui reste à décider »).
2. **Lien des conditions** : l'app ouvre `cgu.html`, qui renvoie en tête au contrat de licence standard
   d'Apple. Mettre aussi dans la **description de l'App Store** (FR et EN), comme Apple le demande pour
   le contrat standard :
   - FR : « Conditions d'utilisation (contrat de licence standard d'Apple) : https://www.apple.com/legal/internet-services/itunes/dev/stdeula/ · Conditions de vente : https://mdlf.app/cgv.html · Confidentialité : https://mdlf.app/privacy.html »
   - EN : « Terms of Use (Apple standard EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/ · Terms of Sale: https://mdlf.app/cgv.html · Privacy Policy: https://mdlf.app/privacy.html »
   Garder « Contrat de licence standard d'Apple » dans App Store Connect (pas de contrat personnalisé).
3. **Pages en ligne avant l'envoi** : les liens de l'écran d'abonnement mènent à mdlf.app ; les pages doivent
   être publiées (fusion, puis job `deploy`) et **sans emplacement « À COMPLÉTER »** (règle 2.1(a)).
4. **Statut de commerçant (DSA)** déclaré dans App Store Connect, cohérent avec les mentions légales.
5. **Lien TestFlight public** : jamais une fois le verrou allumé (docs/PAYANT_V1.md, « Sandbox accepté »).
6. **Confidentialité de l'app (étiquettes) et manifeste** : la lettre d'information fait servir l'adresse
   e-mail au marketing du développeur. Dans App Store Connect › Confidentialité de l'app › Adresse e-mail,
   cocher **« Publicité ou marketing du développeur »** (Developer's Advertising or Marketing) en plus de
   « Fonctionnalité de l'app », liée à l'identité, sans suivi. Le manifeste `PrivacyInfo.xcprivacy` le
   déclare déjà sur cette branche (`NSPrivacyCollectedDataTypePurposeDeveloperAdvertising`) ; il part avec
   la build d'examen (docs/NEWSLETTER.md, « Confidentialité chez Apple »).

## 6. Décisions de l'audit du 12/11/2026 (branche `audit-apple`)

Rapport : `docs/audits/audit-2026-11-12.md`, constats M3, M4, M5, m9, m10. Chaque règle est citée dans le texte
officiel relu le 12/11/2026 (https://developer.apple.com/app-store/review/guidelines/ , « Last Updated: October
16, 2026 »). Correction de citation : « hidden, dormant, or undocumented features » est la règle **2.5.19**, pas
2.3.1(a) comme l'écrivait l'audit ; 2.3.1(a) demande de décrire chaque fonction nouvelle dans la note d'examen.

### 6.1 Codes cadeaux (règle 3.1.1, constat M4)

Texte : « If you want to unlock features or functionality within your app, […] you must use in-app purchase. Apps
may not use their own mechanisms to unlock content or functionality, such as license keys, augmented reality
markers, QR codes […] ». Et 3.1.3(b) : « Apps that operate across multiple platforms may allow users to access
content, subscriptions, or features they have acquired in your app on other platforms or your web site […]
provided those items are also available as in-app purchases within the app ».

- **App iOS** : « J'ai un code » (champ du code cadeau MDLF, `redeem_gift_code`) n'est plus affiché, et l'action
  `pay-code` ne fait rien (`giftCodeInApp(Native.platform)`, js/data/access.js ; js/features/paywall-ui.js).
  Seul « J'ai un code d'offre Apple » reste (fenêtre d'Apple, codes d'offre d'abonnement d'App Store Connect,
  jusqu'à 1 an gratuit). Toute coquille iOS est concernée, même une ancienne sans StoreKit : rien ne s'y achète,
  mais un déblocage maison y serait le même mécanisme. La note sous les boutons et le guide (sujet « Gérer son
  abonnement », réservé à l'iPhone) ne parlent plus du code MDLF.
- **Navigateur et Android** : le champ reste (Android : à revoir avec les règles de paiement de Google Play
  avant la sortie Android, docs/ANDROID.md).
- **Accès lié au compte** : un code utilisé hors de l'app iOS donne un droit enregistré sur le compte ; l'app iOS
  le lit comme tout autre droit (3.1.3(b)). L'app iOS ne dit pas où saisir un code maison (pas d'incitation à
  sortir de l'achat intégré).
- **Partenaires et testeurs** : accès offert côté serveur (`private.grant`, sans saisie dans l'app), ou codes
  d'offre d'Apple.
- Tests : `tests/unit/access.mjs` (« code cadeau maison jamais saisi dans l'app iOS »), `tests/test_payant.py`
  (`t_achat` : parcours du code sur la coquille Android, absence du champ sur iOS, accès à vie lu sur iOS ;
  `t_achats_bloques`).

Ce qui reste à décider (Maxence) : l'**accès à vie** offert par code n'est vendu nulle part, ni en achat intégré
ni ailleurs ; 3.1.3(b) parle d'éléments « also available as in-app purchases ». Lecture prudente : un accès à vie
offert hors d'Apple reste acceptable comme cadeau du développeur au compte, mais un examinateur pourrait le
contester. Option sûre : n'offrir que des durées (jours) et des codes d'offre d'Apple.

### 6.2 Mises à jour à chaud et fonctions nouvelles (règles 2.5.2, 2.3.1(a), 2.5.19, constat M3)

Textes : 2.5.2 « Apps should be self-contained in their bundles, and may not […] download, install, or execute
code which introduces or changes features or functionality of the app » ; 2.3.1(a) « All new features,
functionality, and product changes must be described with specificity in the Notes for Review section of App
Store Connect (generic descriptions will be rejected) and accessible for review » ; 2.5.19 « Don't include any
hidden, dormant, or undocumented features in your app; your app's functionality should be clear to end users and
App Review ».

**Règle du projet (IOS.md, « Règle Apple », et docs/BUILD.md, « Mises à jour à chaud ou build ») :**
une mise à jour à chaud ne transporte que des **corrections** (bug, texte, mise en page, accessibilité, vitesse)
et des **contenus** (exercices, aliments, textes juridiques) d'une fonction déjà présente dans la dernière build
examinée par Apple. **Toute fonction nouvelle, ou tout changement de ce que fait une fonction, part dans une build
soumise** (TestFlight externe : revue bêta ; App Store : examen), décrite dans « What to Test » ou la note
d'examen.

Recensement du 12/11 : dernière build approuvée = **build 67** (TestFlight externe, revue bêta, construite depuis
`main` 2a0998d le 10/11 ; aucune version n'est encore passée par l'examen de l'App Store). Mises à jour à chaud
publiées depuis (runtime de la build 67) :

| Mise à jour | Commit | Contenu | Nature |
|---|---|---|---|
| 2026.11.10-aa8da2c (10/11) | 2f28660, aa8da2c | Nutrition rouvre sur aujourd'hui, « Revenir à aujourd'hui », toast « Ajouté à hier » | Correction (repas enregistré sur la veille) |
| même | 2f28660 | Aliment du plan : « Changer la quantité » et « Retirer pour aujourd'hui » (journal `removed`, « Remettre ») | **Fonction nouvelle** (action absente de la build 67) |
| 2026.11.12-b811616 (12/11) | b811616 | Sons : tous en lecture `.playback`, comme avant la build 67 | Correction |
| 2026.11.12-f50f417 (12/11) | 9e87d03 | RIR : noter la dernière série d'un exercice sous sa carte repliée | **Changement de fonction** (le RIR existait, son point d'entrée change) |

Avant la build 67, les fonctions envoyées par mise à jour à chaud (lot 2 du 30/10 : disques, échauffement, RIR ;
vague 2 du 08/11 : photos de bilan, Social V2) sont toutes dans le paquet web embarqué de la build 67 : elles ont
donc été vues par la revue bêta de cette build, mais la note « What to Test » ne les décrivait pas forcément.
À faire à la prochaine soumission (build 68) : décrire dans « What to Test » et dans la note d'examen les deux
lignes « fonction nouvelle » ci-dessus et les photos de bilan (paragraphe ajouté à la note, section 2).

**Interrupteurs du serveur** (`app_config.coach_photos_on`, `paywall_on`, `min_build`) : réglages
d'exploitation (incident, abus, maintenance), décrits dans la note d'examen, allumés dans la build examinée.
Ils ne servent jamais à montrer à Apple une app différente de celle des utilisateurs (docs/PHOTOS_BILAN.md,
« Éteindre la fonction »).

**Garde proposée, non appliquée** (à décider par Maxence ; `ota.yml` est aussi modifié par la branche
`audit-ota`) : un fichier `features.json` versionné à la racine, liste des fonctions visibles (identifiant
stable, par exemple `nutrition.plan-item-remove`, `session.rir-last-set`, `coach.photos-bilan`). `ios.yml`
copie ce fichier dans la build (`dist/features.json`, donc dans l'empreinte `runtime` via
`scripts/runtime-version.mjs`) et l'attache à l'artefact TestFlight. `ota.yml` (ou `scripts/ota-bundle.py`)
refuse de publier si le `features.json` de `main` contient une fonction absente de celui de la dernière build
approuvée (lu dans l'artefact de la build, ou dans un fichier `store/derniere-build.json` mis à jour à
l'approbation) ; un test unitaire oblige à ajouter une entrée quand une nouvelle action `data-action` ou un
nouvel écran apparaît (même principe que le test qui oblige à classer toute clé de `data`). Limite : la garde
ne voit que ce qui est déclaré ; la relecture du motif reste nécessaire.

### 6.3 Copie iCloud sans donnée de santé (règle 5.1.3(ii), constat m10)

Texte : « Apps must not write false or inaccurate data into HealthKit or any other medical research or health
management apps, and may not store personal health information in iCloud ».

Les données de Santé (HealthKit) n'entraient déjà jamais dans `data` (`storableBodyKg`, js/data/measures.js).
Restaient les saisies manuelles, copiées en clair dans le stockage clé-valeur iCloud de l'app
(`NSUbiquitousKeyValueStore`, CloudBackupPlugin.swift). **Choix : les retirer de la copie iCloud** (`cloudCopy`,
js/platform/native.js), plutôt que les chiffrer avec la clé du coffre :

- Retirées : `bodyWeightKg`, `bodyWeightLog`, `bodyMeasures`, `dietLog` (repas cochés), `strengthSex`, et le
  poids noté avec chaque séance (`history[].bodyKg`). Toutes sont déjà dans `SYNC_LOCAL_ONLY` (jamais sur le
  serveur) ; un test unitaire le vérifie.
- Gardées sur l'iPhone : stockage de l'app, fichier `ppl_v2.json` des Documents (complet, dans la sauvegarde de
  l'iPhone que l'utilisateur règle et peut chiffrer), export.
- Pourquoi pas le chiffrement : la clé du coffre ne s'ouvre qu'après Face ID (`evaluatePolicy`) ; l'écrire à
  chaque enregistrement demanderait Face ID ou une seconde clé sans protection, et la reprise au premier
  lancement d'un nouvel iPhone dépendrait de l'arrivée du trousseau iCloud. Plus de code, plus de cas d'échec,
  pour une donnée qui a déjà deux autres copies.
- Prix : sur un nouvel iPhone restauré **seulement** depuis la copie iCloud de l'app (sans sauvegarde de
  l'iPhone ni export), les pesées, mensurations et repas cochés ne reviennent pas ; les séances, programmes et
  réglages, si. Dit dans privacy.html et dans le guide (« Copie iCloud »).
- Migration : aucune action. La première écriture qui suit la mise à jour remplace la copie iCloud par la copie
  filtrée (l'empreinte du texte filtré diffère de celle retenue). Une copie iCloud plus ancienne qui contient
  encore ces clés les rend à la reprise (c'est la donnée de la personne) ; une copie reprise sur un iPhone sans
  séance garde les pesées et mesures déjà saisies sur cet iPhone (`withDevicePrivate`).
- Tests : `tests/unit/run.mjs` (« native : copie iCloud sans poids, mensurations… », « migration », « reprise »,
  « clés retirées d'iCloud = SYNC_LOCAL_ONLY »).

### 6.4 Textes d'autorisation Appareil photo et Photothèque (règle 5.1.1(ii), constat m9)

Texte : « Ensure your purpose strings clearly and completely describe your use of the data ». Les deux textes
disaient que la photo « reste sur ton iPhone », alors qu'une photo du coffre peut partir chez le coach (photos
de bilan). Nouveaux textes (ios/App/App/Info.plist) :

- `NSCameraUsageDescription` : « MDLF Training utilise l'appareil photo pour scanner le code-barres d'un
  aliment et pour tes photos de progression. Elles sont gardées chiffrées dans ton coffre sur ton iPhone ;
  seules celles que tu choisis d'envoyer à ton coach comme photos de bilan partent, chiffrées pour lui seul. »
- `NSPhotoLibraryUsageDescription` : « MDLF Training ouvre ta photothèque pour choisir une photo de
  progression. Elle est gardée chiffrée dans ton coffre sur ton iPhone ; elle ne part que si tu choisis de
  l'envoyer à ton coach comme photo de bilan, chiffrée pour lui seul. »

Info.plist fait partie de l'empreinte `runtime` : ce changement demande une **nouvelle build** (commit à part,
à fusionner avec la build 68 ; fusionné seul dans `main`, il couperait les mises à jour à chaud de la build 67).
Test : `tests/unit/body-measures.mjs`.

### 6.5 Sauvegardes de la base dans la politique de confidentialité (constat M5)

Règle 5.1.1(i) : la politique doit « Explain its data retention/deletion policies ». RGPD art. 13.1.e et 13.2.a.
privacy.html (FR et EN, mise à jour du 12/11) annonce maintenant : sauvegardes chiffrées de la base (AES-256),
gardées **90 jours** chez GitHub (Microsoft, États-Unis, Data Privacy Framework) et en copies chiffrées sur le
poste de l'éditeur (30 dernières, environ un mois) ; après « Supprimer mon compte », les données restent dans ces
copies jusqu'à leur expiration, sans être consultées ni restaurées pour elles-mêmes. GitHub est ajouté aux
hébergeurs. Tests : `tests/unit/juridique.mjs`, `tests/test_juridique.py` (`t_confidentialite`).

