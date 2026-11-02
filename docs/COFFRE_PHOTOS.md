# Coffre à photos (Progrès › Mesures › Photos)

Les photos de progression sont rangées dans un coffre, sur le modèle de l'album « Masqués » de Photos sur iOS :
il s'ouvre avec **Face ID** (ou Touch ID, Optic ID) et, à défaut, avec **le code de l'iPhone**. Il n'y a pas de
code propre à l'app : rien à retenir, rien à oublier, et donc pas de « code oublié = coffre vidé ». La clé du coffre
est dans le **trousseau iCloud** : le coffre suit sur un nouvel iPhone.

Code : `js/data/photo-vault.js` (logique, sans DOM), `js/features/photo-vault-ui.js` (écran),
`js/data/progress-photos.js` (IndexedDB), `ios/App/App/VaultPlugin.swift` (trousseau iCloud, Face ID, écran de
confidentialité), `js/platform/native.js` (`Native.vault`).
Tests : `tests/unit/photo-vault.mjs`, `tests/test_coffre.py`.

## Ce qui protège quoi

| Menace | Protection |
|---|---|
| Quelqu'un tient l'iPhone déverrouillé (ami, famille) | Face ID, ou le code de l'iPhone, demandé par l'app (`LAContext.evaluatePolicy(.deviceOwnerAuthentication)`) avant toute lecture de la clé. Les essais sont limités par iOS lui-même (Face ID se bloque après plusieurs échecs, le code de l'iPhone a ses délais croissants). |
| Coffre laissé ouvert | Refermé en quittant l'écran, quand l'app passe en arrière-plan, et après 1 min sans toucher l'écran. La clé est alors effacée de la mémoire de l'app, les images libérées (`URL.revokeObjectURL`) et les feuilles de photo retirées. Après une fermeture, Face ID n'est redemandé qu'en entrant dans le coffre ou au toucher de « Ouvrir ». |
| Sélecteur d'apps (capture d'écran d'iOS) | JS : la classe `pv-shield` recouvre l'écran dès que l'app cesse d'être active (`appStateChange` de `@capacitor/app`). Natif : un flou posé sur la fenêtre à `willResignActive`, donc avant la capture, retiré seulement au retour de l'app. |
| Copie de la sauvegarde iCloud de l'iPhone | Les photos y sont chiffrées (AES-GCM 256 bits) ; la clé n'y est pas : les éléments du trousseau iCloud ne font pas partie de la sauvegarde iCloud [11]. |
| Copie d'une sauvegarde d'ordinateur chiffrée | Photos chiffrées, mais la clé y est aussi (élément migrable [9]) : qui connaît ou casse le mot de passe de cette sauvegarde peut lire les photos. Voir « Limites ». |
| Compte iCloud | La clé est dans le trousseau iCloud, chiffré de bout en bout : « déchiffrable seulement sur tes appareils de confiance », ni Apple ni nous ne pouvons la lire [10]. Les photos ne vont pas dans iCloud. |
| Lecture des fichiers de l'app | En clair, seulement l'identifiant et la date de chaque photo. La pose, la taille et l'image sont chiffrées. |

## Clé

- **Une clé par coffre** : 32 octets tirés par `SecRandomCopyBytes`, rangés dans le trousseau
  (`kSecClassGenericPassword`, service `com.mdlf.training.photo-vault`, compte `vault-key.<id>`) avec
  `kSecAttrSynchronizable = true` et `kSecAttrAccessibleWhenUnlocked`. `id` (128 bits, hexadécimal) est tiré par le JS
  et écrit dans les réglages du coffre **avant** la demande de clé : une création interrompue (Face ID annulé,
  app tuée) reprend la même clé au lieu d'en laisser une orpheline.
- **Toutes les requêtes précisent `kSecAttrSynchronizable`** : `true` à l'ajout, `kSecAttrSynchronizableAny` pour
  chercher, lire et effacer.
- **Création** (`create`) : Face ID (ou le code), puis lecture de la clé de cet `id` ; si elle existe déjà (ici, ou
  arrivée par le trousseau iCloud), elle est reprise ; sinon tirée et ajoutée. `errSecDuplicateItem` (arrivée
  entre-temps) : on relit celle qui est là. Jamais remplacée.
- **Ouverture** (`unlock`) : présence de la clé vérifiée sans rien lire de secret (attributs seulement) ; absente :
  `NOT_FOUND` tout de suite, sans feuille d'iOS. Présente : Face ID (ou le code), puis lecture. **Aucun chemin ne
  rend la clé sans authentification réussie.**
- **Face ID est un contrôle de l'app**, pas une protection de l'élément par la Secure Enclave : un élément
  synchronisable ne peut pas porter de contrôle d'accès (voir plus bas). C'est le modèle de l'album « Masqués » :
  il arrête qui tient l'iPhone déverrouillé, pas quelqu'un qui contrôle le système (iPhone débridé).
- **Photos** : chiffrées dans la vue web (WebCrypto), en AES-GCM avec un IV de 96 bits neuf par photo.
  L'identifiant et la date sont liés en données authentifiées : une ligne recopiée sous un autre identifiant ne
  se déchiffre pas. La clé reçue est importée **non extractible** et vérifiée par un témoin chiffré (`check`).
- **Pourquoi la clé passe par le JS** plutôt qu'un chiffrement côté natif : les images doivent de toute façon
  être déchiffrées dans la vue web pour s'afficher, et faire passer chaque photo (150 à 300 ko) en base64 par le
  pont Capacitor coûterait du temps et de la mémoire pour rien. La clé n'est en mémoire que coffre ouvert.
- **Réglages du coffre** (IndexedDB, magasin `meta`) : `{ v: 3, id, checkIv, check, created }`, ou
  `{ v: 3, id, pending: true }` pendant une création pas encore aboutie. Ni clé, ni sel, ni compteur d'essais.

## Trousseau iCloud : ce que dit Apple

Vérifié le 1er novembre 2026 :

- **Accessibilité compatible avec la synchronisation** : un élément `kSecAttrSynchronizable` « ne peut pas avoir
  une valeur de `kSecAttrAccessible` incompatible avec la synchronisation, c'est-à-dire celles qui finissent par
  `ThisDeviceOnly` » [8]. Restent `kSecAttrAccessibleWhenUnlocked` (choisie : l'app ne lit la clé qu'au premier
  plan, iPhone déverrouillé [9]) et `kSecAttrAccessibleAfterFirstUnlock` (utile seulement en arrière-plan [12]).
- **Pas de contrôle d'accès sur un élément synchronisable** : la doc de `kSecAttrSynchronizable` interdit le
  contrôle d'accès `SecAccess` de macOS [8], sans parler de `SecAccessControl`. Le test de régression d'Apple sur
  les ACL du trousseau, lui, est explicite : le même élément avec un `kSecAttrAccessControl` s'ajoute en local,
  et `SecItemAdd` rend `errSecParam` dès qu'on met `kSecAttrSynchronizable` à vrai (« add sync »), quelle que
  soit la classe de protection tirée [13]. D'où Face ID côté app.
- **Chiffrement de bout en bout** : « mots de passe et trousseau » sont chiffrés de bout en bout même avec la
  protection standard ; ces données « ne peuvent être déchiffrées que sur tes appareils de confiance » [10].
- **Hors de la sauvegarde iCloud** : les éléments du trousseau iCloud n'en font pas partie, « ils sont déjà dans
  le nuage » (Apple, cité par [11]).
- **Trousseau iCloud désactivé** : un élément synchronisable n'est synchronisé que si le trousseau iCloud est
  activé [14] ; il reste alors dans le trousseau de l'iPhone (pas de mention contraire d'Apple ; à vérifier sur
  un iPhone de test). En désactivant le trousseau iCloud, iOS propose de garder ou de supprimer les éléments de
  l'iPhone ; une copie chiffrée reste sur iCloud [15]. Supprimer à ce moment-là retire la clé de l'iPhone : le
  coffre devient « illisible pour l'instant » jusqu'à la réactivation.
- **Supprimer une clé synchronisée la retire de tous les appareils** [8].

## Nouvel iPhone, clé absente

- Le coffre (photos et réglages) arrive avec la sauvegarde de l'iPhone ; la clé, avec le trousseau iCloud, parfois
  plus tard. Clé absente : écran **« Coffre illisible pour l'instant »** (nombre de photos ; « la clé arrive avec le
  trousseau iCloud, parfois après un moment : réessaie plus tard » ; « si le trousseau iCloud était désactivé sur
  l'ancien iPhone, la clé y est restée »). Bouton **« Réessayer »** en premier ; « Vider le coffre… » en lien
  secondaire, avec une confirmation (« si la clé arrive plus tard, il sera trop tard »).
- **Jamais de nouvelle clé pour un coffre existant** : `unlock` ne crée rien, et `create` n'est appelé que sans
  coffre. Vider un coffre illisible **ne touche pas à la clé** (absente ici ; un autre iPhone peut encore en avoir
  besoin) et le coffre suivant prend un nouvel `id`, donc une nouvelle clé : aucun conflit possible dans le
  trousseau iCloud avec l'ancienne.
- Clé présente mais qui ne correspond pas au témoin : même écran.
- Coffre vide et clé absente : rien à perdre, retour direct à la présentation.
- Les photos en clair d'avant le coffre pas encore rangées sont gardées quand on vide un coffre illisible.
- Textes : la présentation dit « Active-le pour retrouver ton coffre sur un nouvel iPhone » ; le pied du coffre
  ouvert, le guide et la politique de confidentialité disent que le coffre suit par le trousseau iCloud. Il n'existe
  pas d'API publique pour savoir si le trousseau iCloud est activé : l'app ne l'affirme jamais, elle l'explique
  là où c'est utile (présentation, écran « illisible »).

## Version précédente (clé liée à l'iPhone)

Une version intermédiaire de cette branche gardait la clé avec `.userPresence` et
`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` (photos perdues sur un nouvel iPhone). Elle n'a jamais été
compilée ni publiée : pas de migration à écrire. Les éléments de cette version (compte `vault-key`, sans
identifiant) n'existent sur aucun iPhone.

## Où vont les photos (et où elles ne vont pas)

- **IndexedDB** `mdlf-vault`, dans le bac à sable de l'app : chiffrées.
- **Pas** dans la pellicule, ni dans l'export JSON, ni dans la copie iCloud de l'app (`ppl_v2` seulement).
- **Pas** sur nos serveurs : pas dans la synchro du compte, ni chez le coach, ni chez les amis, ni dans les récaps,
  les partages ou les notifications. Aucun de ces modules ne lit IndexedDB (`grep photo` sur `js/` : seulement
  `progress-photos.js`, `photo-vault*.js`, des textes, et `wipeLocalData`).
- **Sauvegarde de l'iPhone** : oui, comme tout le bac à sable, mais chiffrées ; lisibles sur un nouvel iPhone quand
  la clé y est arrivée par le trousseau iCloud.
- **« Supprimer toutes les données »** vide le coffre (photos, réglages, ancienne base) et retire la clé du trousseau,
  donc de tous les appareils du trousseau iCloud [8].

## Migration (builds 30 et 31)

Les photos prises avant le coffre étaient en clair dans la base `mdlf-photos`. À la création du coffre (et à
chaque ouverture, si une migration a été interrompue), elles sont chiffrées dans `mdlf-vault`. On vérifie qu'elles
y sont toutes, puis l'ancienne base est supprimée **en entier** : `deleteDatabase` efface le fichier, alors que
vider le magasin laisserait les octets en clair dans les pages libres du fichier SQLite de WebKit. Création
annulée (Face ID refusé) : rien n'est écrit, l'ancienne base reste.

## Hors de l'app iPhone (navigateur, tests)

- **Navigateur** et **coquille sans le module** (`Native.vault.available` faux) : écran « Coffre indisponible ».
  Pas de repli sur un code ou une clé gardée dans la page : ce serait un coffre moins sûr sous le même nom. Dans
  une coquille sans le module, les photos en clair d'avant le coffre ne sont jamais touchées ; elles seront
  rangées par la build qui a le module. En pratique, ce cas n'arrive pas : le module change l'empreinte runtime,
  donc ce contenu n'est jamais appliqué en mise à jour à chaud à une build qui ne l'a pas.
- **Tests unitaires** : `Native.vault` remplacé par un faux module qui tire une clé de test au hasard.
- **E2E** (`tests/test_coffre.py`) : faux module `MdlfVault` injecté dans la page (`FAKE_SHELL`), une clé de test
  par identifiant de coffre, tirée par `crypto.getRandomValues` et gardée dans `sessionStorage` le temps du test
  (survit à un rechargement, comme le trousseau ; retirée puis remise pour simuler un nouvel iPhone où le trousseau
  iCloud arrive après l'app). Jamais une vraie clé.

## Limites assumées

- **Le Swift n'a pas été compilé** au moment de l'écrire (pas de Xcode sur la machine) : à compiler et essayer
  sur un iPhone avant la build (création, ouverture, annulation, iPhone sans code, réinstallation, nouvel iPhone
  avec et sans trousseau iCloud).
- **Face ID côté app** : moins fort qu'un contrôle d'accès évalué par la Secure Enclave (impossible avec la
  synchronisation). Sur un iPhone débridé, du code injecté dans l'app pourrait lire la clé sans Face ID.
- **Sauvegarde d'ordinateur chiffrée** : la clé (élément migrable) y est, à côté des photos chiffrées ; sa sûreté
  est celle du mot de passe de la sauvegarde (les outils d'extraction lisent ces éléments avec le mot de passe [11]).
  La sauvegarde iCloud, elle, ne contient pas la clé.
- **« Supprimer toutes les données » sur un iPhone** retire la clé de tous les appareils du trousseau iCloud. Si un
  autre iPhone utilise encore le même coffre (sauvegarde restaurée sur deux iPhone), ses photos y deviennent
  illisibles.
- **Trousseau iCloud désactivé, puis éléments supprimés de l'iPhone** : le coffre est illisible jusqu'à la
  réactivation du trousseau iCloud.
- **Mémoire flash** : la suppression de l'ancienne base ne garantit pas l'effacement physique des blocs. C'est le
  chiffrement matériel d'iOS (Data Protection) qui couvre ce cas.
- **Retour en arrière d'une mise à jour à chaud** : si le contenu revient à une version d'avant le coffre, les photos
  migrées ne s'y affichent pas (elles sont dans la nouvelle base). Elles réapparaissent avec la version suivante.

## Mise en service

Une seule livraison, avec la build : `VaultPlugin.swift` est dans le projet Xcode et enregistré dans
`MainViewController` (le contrôleur racine créé par `SceneDelegate`), `NSFaceIDUsageDescription` est dans
Info.plist. L'empreinte runtime change : la partie JS ne part pas seule en mise à jour à chaud.

## Sources

1. Apple, *Restricting keychain item accessibility* : https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility
2. Apple, `LAPolicy.deviceOwnerAuthentication` (repli sur le code, `passcodeNotSet`) : https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication
3. Apple Platform Security, *Keychain data protection* : https://support.apple.com/guide/security/secb0694df1a/web
4. Apple, `SecAccessControlCreateWithFlags(_:_:_:_:)` : https://developer.apple.com/documentation/security/secaccesscontrolcreatewithflags(_:_:_:_:)
5. Apple, *Accessing keychain items with Face ID or Touch ID* : https://developer.apple.com/documentation/localauthentication/accessing-keychain-items-with-face-id-or-touch-id
6. Apple, `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` : https://developer.apple.com/documentation/security/ksecattraccessiblewhenpasscodesetthisdeviceonly
7. Apple, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` : https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly
8. Apple, `kSecAttrSynchronizable` : https://developer.apple.com/documentation/security/ksecattrsynchronizable
9. Apple, `kSecAttrAccessibleWhenUnlocked` : https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlocked
10. Apple, *iCloud data security overview* (trousseau chiffré de bout en bout) : https://support.apple.com/en-us/102651
11. Elcomsoft, *Extracting and Decrypting iOS Keychain* (source tierce, cite Apple sur la sauvegarde iCloud) : https://blog.elcomsoft.com/2020/08/extracting-and-decrypting-ios-keychain-physical-logical-and-cloud-options-explored/
12. Apple, `kSecAttrAccessibleAfterFirstUnlock` : https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlock
13. Apple, code source de Security, test `sec_acl_stress.c` (« add sync » → `errSecParam`) : https://github.com/apple-oss-distributions/Security/blob/main/secacltests/sec_acl_stress.c
14. Apple Developer Forums, *kSecUseDataProtectionKeychain creates sometimes keys into iCloud keychain* (synchronisé seulement trousseau iCloud activé) : https://developer.apple.com/forums/thread/733767
15. Apple, *Set up iCloud Keychain* (désactivation : garder ou supprimer de l'iPhone) : https://support.apple.com/HT204085
