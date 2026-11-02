# Soumission App Store : abonnements, note d'examen, confidentialité

Préparé le 03/11/2026 (branche `revue-store`). **Rien n'est envoyé à Apple ni mis en production** : tout ce
qui suit est à coller par Maxence dans App Store Connect (ASC). Les noms, descriptions et notes « actuels »
ont été **lus** dans ASC le 03/11 (requêtes GET de l'API, aucune écriture). Complète docs/REVUE_APPLE.md
(règles d'examen, compte de démo, risques) et docs/PAYANT_V1.md (prix, niveaux, déploiement).

## 1. Les dix abonnements

Groupe `MDLF Training Acces` (id 22520671), app 6823561962. Tous en état `MISSING_METADATA` le 03/11 :
il manque la **capture de revue** (fichiers ci-dessous). Partage familial : désactivé sur les dix (lu dans ASC).
Essai : offre de lancement « 3 mois gratuits » sur les dix, 5 pays (docs/PAYANT_V1.md).

Limites d'Apple : nom affiché 35 caractères, description 55 caractères.

| Niv. | Nom de référence (ASC) | ID produit | ASC id | Durée | Prix France | Capture (à envoyer) |
|---|---|---|---|---|---|---|
| 9 | MDLF Training mensuel | `com.mdlf.training.pro.monthly` | 6827767578 | 1 mois | 6,49 € | `sombre/01-com.mdlf.training.pro.monthly.png` |
| 10 | MDLF Training annuel | `com.mdlf.training.pro.yearly` | 6827767660 | 1 an | 55,00 € | `sombre/02-com.mdlf.training.pro.yearly.png` |
| 7 | Coach 10 élèves mensuel | `com.mdlf.training.coach10.monthly` | 6829035180 | 1 mois | 15,99 € | `sombre/03-com.mdlf.training.coach10.monthly.png` |
| 8 | Coach 10 élèves annuel | `com.mdlf.training.coach10.yearly` | 6829035208 | 1 an | 134,99 € | `sombre/04-com.mdlf.training.coach10.yearly.png` |
| 5 | Coach 20 élèves mensuel | `com.mdlf.training.coach20.monthly` | 6829035210 | 1 mois | 19,99 € | `sombre/05-com.mdlf.training.coach20.monthly.png` |
| 6 | Coach 20 élèves annuel | `com.mdlf.training.coach20.yearly` | 6829035275 | 1 an | 169,00 € | `sombre/06-com.mdlf.training.coach20.yearly.png` |
| 3 | Coach 30 élèves mensuel | `com.mdlf.training.coach30.monthly` | 6829035217 | 1 mois | 24,99 € | `sombre/07-com.mdlf.training.coach30.monthly.png` |
| 4 | Coach 30 élèves annuel | `com.mdlf.training.coach30.yearly` | 6829035393 | 1 an | 209,99 € | `sombre/08-com.mdlf.training.coach30.yearly.png` |
| 1 | Coach illimité mensuel | `com.mdlf.training.coachmax.monthly` | 6829035229 | 1 mois | 29,99 € | `sombre/09-com.mdlf.training.coachmax.monthly.png` |
| 2 | Coach illimité annuel | `com.mdlf.training.coachmax.yearly` | 6829035364 | 1 an | 250,00 € | `sombre/10-com.mdlf.training.coachmax.yearly.png` |

Chemins relatifs à `docs/revue/`. `docs/revue/clair/` contient les mêmes en thème clair (contrôle).

### Captures de revue
- PNG **1320 × 2868** (iPhone 6,9 pouces), **RGB sans couche alpha** (ASC refuse la transparence), une
  par produit. Écran d'abonnement réel de l'app (verrou allumé, compte coach validé), prix France, essai
  et mentions 3.1.2 ; StoreKit et serveur simulés, aucun achat.
- La formule concernée est **entourée d'un liseré bleu** (seule retouche de l'écran réel, posée par le
  script) : on lit sur chaque image l'onglet (Particulier ou Coach), la durée (Mensuel / Annuel, « par
  mois » / « par an ») et le prix. Les captures coach montrent le titre « MDLF Training pour coachs ».
- Refaire : serveur local à la racine du dépôt, puis
  `PPL_URL=http://127.0.0.1:8743/ flock /tmp/ppl-e2e.lock python3 store/captures_revue.py sombre` (puis `clair`).

### Nom affiché et description (localisations de chaque abonnement)
Valeurs **actuelles** dans ASC, à garder sauf les deux corrections d'accents marquées ✎.

| Produit | fr-FR nom | fr-FR description | en-US nom | en-US description |
|---|---|---|---|---|
| pro.monthly | MDLF Training mensuel | ✎ actuel « Acces complet, facture chaque mois. » → **Accès complet, facturé chaque mois.** | MDLF Training monthly | Full access, billed monthly. |
| pro.yearly | MDLF Training annuel | ✎ actuel « Acces complet, facture chaque annee. » → **Accès complet, facturé chaque année.** | MDLF Training yearly | Full access, billed yearly. |
| coach10.* | Coach 10 élèves | Accès complet et suivi de 10 élèves au plus. | Coach 10 clients | Full access and up to 10 clients. |
| coach20.* | Coach 20 élèves | Accès complet et suivi de 20 élèves au plus. | Coach 20 clients | Full access and up to 20 clients. |
| coach30.* | Coach 30 élèves | Accès complet et suivi de 30 élèves au plus. | Coach 30 clients | Full access and up to 30 clients. |
| coachmax.* | Coach illimité | Accès complet et élèves illimités. | Coach unlimited | Full access and unlimited clients. |

Mensuel et annuel d'un même palier coach portent le même nom affiché : Apple affiche la durée à côté du
nom (feuille d'achat, Réglages › Abonnements), ce n'est pas bloquant.

### Note pour l'examinateur (champ « Review Notes » de chaque abonnement)
Les notes actuelles sont en français **sans accents** (« accès complet a l app… »). À remplacer par :

- `pro.monthly` et `pro.yearly` :
  > Personal plan: full access to MDLF Training (recording new workouts and syncing them to the account). Offered to every signed-in user with a 3-month free trial (Apple introductory offer). Shown in the app at Settings › Subscription, and when recording a workout once the paywall is on. History, progress charts and data export stay available without a subscription.
- Les huit `coach*` (remplacer N par 10, 20, 30 ou « an unlimited number of ») :
  > Coach plan: full access for the coach and follow-up of up to N students. Coach plans are only offered in the app to accounts whose coach role was verified by us (French professional card of sports instructor). The demo account given in the App Review Information is a verified coach: Settings › Subscription › Coach tab shows the four tiers, with a Monthly / Yearly switch. 3-month free trial (Apple introductory offer).

## 2. Localisation du groupe d'abonnements
Lue dans ASC le 03/11 : **fr-FR** et **en-US**, nom d'affichage du groupe **« MDLF Training »**, « Nom de
l'app personnalisé » **vide** (Apple affiche alors le nom de l'app). Rien à changer.

## 3. Note d'examen générale (App Review Information › Notes)
Le texte complet, prêt à coller, est dans **docs/REVUE_APPLE.md, section 2** (abonnements 3.1.2, compte
5.1.1(v), offre élève). Ce qui doit y figurer, vérifié dans le code :

- **Où trouver l'abonnement** : onglet Entraînement › roue dentée en haut à droite (Réglages) ›
  **Abonnement** (`js/features/paywall-ui.js:398-409` : la ligne n'apparaît **qu'avec un compte
  connecté**, `if (!accountAvailable() || !account.user) return ''`). Verrou allumé : enregistrer une
  séance ouvre aussi l'écran. Onglet **Coach** visible seulement pour un coach validé (docs/PAYANT_V1.md,
  « Écran d'abonnement »).
- **Compte de test** : `[compte de test à créer]` (identifiant et mot de passe à saisir **directement dans
  ASC** › App Review Information › Sign-in required, jamais dans le dépôt). Il doit être un **coach validé**
  (`private.approve_coach`) pour que l'examinateur voie les dix produits ; marche à suivre dans
  docs/REVUE_APPLE.md, section 3.
- Achats testables en **Sandbox** (accepté par `verify-purchase` et `appstore-notify`), « Restaurer mes
  achats » sur le même écran ; suppression du compte : Réglages › Compte › Supprimer mon compte.
- Contact : Maxence de La Fouchardière, contact@mdlf.app, `[numéro de téléphone]`.

## 4. URL de notification serveur App Store
ASC › App › Informations sur l'app › **Notifications du serveur App Store** (version 2), pour
**Production** et **Sandbox** (la même fonction accepte les deux) :

```
https://yopptmdjtnezmccdvaxf.supabase.co/functions/v1/appstore-notify
```

Projet `yopptmdjtnezmccdvaxf` (docs/BUILD.md:64). Fonction déployée : un GET y répond **405** le 03/11
(une fonction absente répond 404) ; elle n'accepte que des POST signés par Apple
(`supabase/functions/appstore-notify/index.ts:1-25`, `--no-verify-jwt`). Avant de coller l'URL : poser
les secrets `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY`, `APPLE_ISSUER_ID` (docs/PAYANT_V1.md, point 6),
puis « Envoyer une notification de test » depuis ASC.

## 5. Confidentialité de l'app (questionnaire ASC)

Nomenclature relue le 03/11/2026 sur https://developer.apple.com/app-store/app-privacy-details/ :
« collecter » = **envoyer hors de l'appareil et garder plus longtemps que le temps de traiter la requête**.
Ce qui reste sur l'iPhone n'est pas déclaré ; ce qu'Apple collecte (iCloud, App Store) n'est pas à notre charge.

**« Collectez-vous des données ? » → Oui.** Pour **chaque** type ci-dessous : **lié à l'identité de
l'utilisateur : Oui** (tout est rattaché au compte, et Apple compte toute donnée personnelle au sens du
RGPD comme liée) ; **utilisé pour le suivi : Non** (aucun SDK publicitaire ni de mesure, aucun courtier :
`NSPrivacyTracking` faux, `ios/App/App/PrivacyInfo.xcprivacy:11-12`).
Finalité : **Fonctionnalité de l'app** (App Functionality), sauf mention contraire.

| Catégorie › type (FR / EN) | Finalités | Ce que c'est | Justification |
|---|---|---|---|
| Coordonnées › **Adresse e-mail** (Email Address) | Fonctionnalité de l'app **+ Publicité ou marketing du développeur** | Connexion par code e-mail ; adresse donnée par Google ; lettre d'information si la personne s'y inscrit | `js/data/account.js:342` (`signInWithOtp`), `js/data/account.js:333` (Google), `supabase/migrations/20261031230000_newsletter.sql:26`, `privacy.html:45`, `:125` |
| Coordonnées › **Nom** (Name) | Fonctionnalité de l'app | Nom transmis par Google (gardé par Supabase Auth) ; nom tel qu'il figure sur la carte professionnelle (demande coach) | `privacy.html:45`, `supabase/migrations/20261030000000_payant_tarifs.sql:241-243` (`card_name`), `privacy.html:86` |
| Santé et forme › **Santé** (Health) | Fonctionnalité de l'app | Pesées saisies dans l'app, envoyées **seulement** si l'élève coche « Poids du corps » pour son coach. **Aucune donnée lue dans Apple Santé** ne part | `supabase/migrations/20261031300000_partage_coach.sql:53-60`, `js/data/coach-share.js:26` (seul `weight` est ouvert, :27-29 fermés), `privacy.html:81`, `:148` |
| Santé et forme › **Forme physique** (Fitness) | Fonctionnalité de l'app | Séances : exercices, séries, charges, répétitions, durées, records | `supabase/migrations/20261025000000_comptes.sql:14-17` (`sessions.data`), `js/data/account.js:864-866`, `privacy.html:50` |
| Contenu utilisateur › **E-mails ou SMS** (Emails or Text Messages) | Fonctionnalité de l'app | Messages entre un coach et son élève (texte, 2000 caractères), gardés sur le serveur | `supabase/migrations/20261031510000_chat_coach.sql:50-56`, `privacy.html:83` |
| Contenu utilisateur › **Autre contenu de l'utilisateur** (Other User Content) | Fonctionnalité de l'app | Programmes et exercices perso, notes de séance, avatar emoji, commentaires, réactions, signalements (motif et texte libre) | `js/data/sync.js:31-33` (clés envoyées), `supabase/migrations/20261026000000_profils.sql:26-29`, `20261031500000_commentaires.sql:54-59`, `20261026050000_social.sql:95`, `:111-121`, `privacy.html:67`, `:69` |
| Identifiants › **Identifiant de l'utilisateur** (User ID) | Fonctionnalité de l'app | Identifiant du compte, identifiant « Se connecter avec Apple », pseudo | `supabase/migrations/20261026000000_profils.sql:26-28`, `js/data/account.js:333`, `privacy.html:44`, `:49` |
| Identifiants › **Identifiant de l'appareil** (Device ID) | Fonctionnalité de l'app | Jeton APNs de l'iPhone, gardé avec le compte quand une notification push est allumée | `supabase/migrations/20261031900000_notifications_push.sql:27-31`, `privacy.html:136` |
| Achats › **Historique des achats** (Purchase History) | Fonctionnalité de l'app (**+ Autres finalités**, voir décision 3) | Produit, dates, identifiants de transaction, environnement ; pour le parrainage : prix, devise, pays de la boutique | `supabase/migrations/20261028000000_payant.sql:143`, `:169`, `20261101000000_parrainage_payant.sql:62-78`, `supabase/functions/verify-purchase/purchase-policy.js:122`, `privacy.html:98`, `:109` |
| Diagnostics › **Autres données de diagnostic** (Other Diagnostic Data) | Fonctionnalité de l'app | Version du contenu de l'app et date du premier lancement de cette version, envoyées avec le profil « pour savoir côté serveur qui a quelle version » | `js/data/sync.js:29-30`, `:33`, `:124-130` |
| Autres données › **Autres types de données** (Other Data Types) | Fonctionnalité de l'app | Numéro de carte professionnelle et diplôme de la demande coach | `supabase/migrations/20261030000000_payant_tarifs.sql:241-245`, `privacy.html:86` |

**Non déclarés (et pourquoi)**

| Type | Raison | Justification |
|---|---|---|
| Données Apple Santé lues (poids, courses, vélo, sommeil) | Restent sur l'iPhone, jamais dans l'historique synchronisé | `js/data/health-workouts.js:7-10`, `js/data/sync.js:44-45` (`bodyWeightKg`, `bodyWeightLog`, `healthOn` locaux), `privacy.html:148` |
| Photos ou vidéos (photos de progression, « coffre ») | **Oui, elles restent sur l'appareil** : IndexedDB chiffrée (AES-GCM), ni serveur, ni pellicule, ni copie iCloud de l'app ; seule la sauvegarde iPhone d'Apple les contient, chiffrées | `js/data/progress-photos.js:5-24`, `js/data/photo-vault.js:7`, `privacy.html:33` |
| Informations sensibles (sexe), mensurations, poids saisi non partagé | Jamais envoyés | `js/data/sync.js:38-45` (`strengthSex`, `bodyMeasures`) |
| Infos financières (moyen de paiement) | Apple encaisse, le développeur ne voit rien (exclu par la définition d'Apple) | `privacy.html:109` |
| Localisation, contacts, audio, historique de navigation | Aucune API utilisée (recherche sans résultat dans `js/` et `ios/App/App`) | grep `geolocation`, `CLLocation`, `CNContact`, `getUserMedia` : aucun usage |
| Historique de recherche | La recherche de pseudo n'est pas gardée : le journal anti-abus ne note que l'action et l'heure, purgé après 24 h | `supabase/migrations/20261026050000_social.sql:127-132` |
| Données d'utilisation, publicité, analytics, rapports de plantage | Aucun outil de mesure ni de plantage (aucun SDK Sentry, Firebase, PostHog…) | `privacy.html:22`, `:193` (« No ads, no analytics, no tracking ») |
| Strava | Interrupteur livré **éteint**, aucun appel au serveur | `js/data/strava.js:25` |
| Mises à jour à chaud, lecture du verrou sans compte | Aucune donnée personnelle ; l'IP n'est pas gardée par l'app | `privacy.html:165`, `privacy.html:37` |

Copie iCloud de l'app : stockage iCloud de l'utilisateur, géré par Apple, inaccessible au développeur :
non collecté au sens d'Apple (« You are not responsible for disclosing data collected by Apple »).

## 6. Décisions de Maxence
1. **Fiche Confidentialité à republier** : celle publiée le 25/10 (3 types, store/FICHE_APP_STORE.md) est
   dépassée ; la section 5 ajoute E-mail, Nom, Santé, Achats, E-mails ou SMS, Identifiant de l'appareil,
   Autres données de diagnostic, Autres types de données.
2. **Manifeste `PrivacyInfo.xcprivacy` incomplet** par rapport à la section 5 : il lui manque
   `EmailsOrTextMessages`, `DeviceID`, `OtherDiagnosticData`, `OtherDataTypes`. À ajouter dans la build
   de soumission (non modifié ici : code natif, nouvelle build).
3. **Achats › Autres finalités** : les prix payés servent aussi à calculer la commission des parrains
   (`subscription_payments`). Recommandation : cocher « Autres finalités » en plus (déclarer plus n'est
   jamais refusé).
4. **Identifiant de l'appareil** pour le jeton push et **Autres données de diagnostic** pour
   `appVersion`/`appSeenAt` : lecture prudente, recommandée. Autre choix possible pour la seconde : ne plus
   envoyer `appVersion`/`appSeenAt` et ne pas la déclarer.
5. **Captures** : envoyer le thème **sombre** ; le liseré bleu est une annotation sur l'écran réel. Si tu
   préfères l'écran brut, retirer le bloc « liseré » de `store/captures_revue.py` et relancer.
6. **« J'ai un code » visible** sur les captures particulier (codes cadeaux maison, risque règle 3.1.1 :
   docs/REVUE_APPLE.md, section 5).
7. **Compte de test coach** à créer, et **numéro de téléphone** de contact à saisir dans ASC.
8. Corriger dans ASC les **accents** des deux descriptions particulier et remplacer les dix **notes de revue**
   (section 1).
