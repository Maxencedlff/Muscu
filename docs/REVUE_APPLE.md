# Revue d'Apple : note d'examen, compte de démo, captures des abonnements

Préparé le 31/10/2026 (branche `nuit-legal`) pour la première build payante. **Rien n'est envoyé ni créé
dans App Store Connect** : tout ce qui suit est à faire par Maxence. Règles lues le 31/10/2026 sur
https://developer.apple.com/app-store/review/guidelines/ .

## 1. Ce que l'examen va regarder

| Règle | Exigence (texte d'Apple) | Où c'est dans l'app |
|---|---|---|
| 2.1(a) | « include demo account info (and turn on your back-end service!) if your app includes a login » ; aucun texte provisoire | Compte de démo (section 3) ; **les emplacements « À COMPLÉTER » des pages juridiques doivent être remplis avant l'envoi** (docs/JURIDIQUE.md). |
| 3.1.1 | « Apps may not use their own mechanisms to unlock content or functionality, such as license keys… » | **Risque** : les codes cadeaux maison (Réglages › Abonnement › J'ai un code) débloquent l'accès. Voir section 5. |
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
1. **Codes cadeaux maison (règle 3.1.1)** : « J'ai un code » débloque l'accès sans achat d'Apple. Lecture
   la plus sûre : c'est un « own mechanism to unlock content ». Options : (a) masquer « J'ai un code » dans
   la build d'examen et le garder pour plus tard (refus possible quand même à la mise à jour suivante) ;
   (b) le retirer et n'utiliser que les **codes d'offre d'Apple** (1 an gratuit au maximum, déjà en place) ;
   (c) le garder en le présentant comme accès offert à des testeurs et partenaires, sans vente hors d'Apple
   (accepté par certains examinateurs, refusé par d'autres). **Recommandation : (b), ou (a) au minimum.**
   Rien n'est changé dans le code de cette branche (décision produit de Maxence).
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
