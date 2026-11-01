# Coffre à photos (Progrès › Mesures › Photos)

Les photos de progression sont rangées dans un coffre, sur le modèle de l'album « Masqués » de Photos sur iOS :
il s'ouvre avec **Face ID** (ou Touch ID, Optic ID) et, à défaut, avec **le code de l'iPhone**. Il n'y a pas de
code propre à l'app : rien à retenir, rien à oublier, et donc pas de « code oublié = coffre vidé ».

Code : `js/data/photo-vault.js` (logique, sans DOM), `js/features/photo-vault-ui.js` (écran),
`js/data/progress-photos.js` (IndexedDB), `ios/App/App/VaultPlugin.swift` (trousseau, Face ID, écran de
confidentialité), `js/platform/native.js` (`Native.vault`).
Tests : `tests/unit/photo-vault.mjs`, `tests/test_coffre.py`.

## Ce qui protège quoi

| Menace | Protection |
|---|---|
| Quelqu'un tient l'iPhone déverrouillé (ami, famille) | Face ID, ou le code de l'iPhone. Les essais sont limités par iOS lui-même (Face ID se bloque après plusieurs échecs, le code de l'iPhone a ses délais croissants). |
| Coffre laissé ouvert | Refermé en quittant l'écran, quand l'app passe en arrière-plan, et après 1 min sans toucher l'écran. La clé est alors effacée de la mémoire de l'app, les images libérées (`URL.revokeObjectURL`) et les feuilles de photo retirées. Après une fermeture, Face ID n'est redemandé qu'en entrant dans le coffre ou au toucher de « Ouvrir ». |
| Sélecteur d'apps (capture d'écran d'iOS) | JS : la classe `pv-shield` recouvre l'écran dès que l'app cesse d'être active (`appStateChange` de `@capacitor/app`). Natif : un flou posé sur la fenêtre à `willResignActive`, donc avant la capture, retiré seulement au retour de l'app. |
| Copie de la sauvegarde de l'iPhone (iCloud ou ordinateur) | Les photos y sont chiffrées (AES-GCM 256 bits) et la clé n'est **pas** utilisable hors de cet iPhone (voir « Clé et sauvegardes »). Contrairement à l'ancien code à 6 chiffres, il n'y a plus rien à deviner hors ligne. |
| Lecture des fichiers de l'app | En clair, seulement l'identifiant et la date de chaque photo. La pose, la taille et l'image sont chiffrées. |

## Clé

- **Clé du coffre** : 32 octets tirés par `SecRandomCopyBytes` à la création, rangés dans le trousseau d'iOS
  (`kSecClassGenericPassword`, service `com.mdlf.training.photo-vault`) avec un contrôle d'accès
  `SecAccessControlCreateWithFlags(…, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .userPresence, …)`.
  - `.userPresence` : « biométrie ou code de l'appareil » ; la clé reste lisible si les visages ou empreintes
    enregistrés changent (contrairement à `.biometryCurrentSet`, utilisé avant). [1]
  - Le contrôle d'accès est évalué par la Secure Enclave [3] : iOS ne rend la clé qu'après Face ID ou le code.
  - Création : Face ID (ou le code) via `LAContext.evaluatePolicy(.deviceOwnerAuthentication)`, puis la clé est
    tirée et rangée. Une clé déjà présente (le trousseau survit à la suppression de l'app) est reprise, **jamais
    remplacée** : une clé écrasée rendrait les photos illisibles pour toujours.
  - Ouverture : `SecItemCopyMatching` avec un `LAContext` (raison en français) : iOS affiche lui-même la feuille
    Face ID, puis le code de l'iPhone en repli.
- **Photos** : chiffrées dans la vue web (WebCrypto), en AES-GCM avec un IV de 96 bits neuf par photo.
  L'identifiant et la date sont liés en données authentifiées : une ligne recopiée sous un autre identifiant ne
  se déchiffre pas. La clé reçue est importée **non extractible** et vérifiée par un témoin chiffré (`check`) :
  une clé qui n'est pas celle du coffre est refusée (« coffre illisible », voir plus bas).
- **Pourquoi la clé passe par le JS** plutôt qu'un chiffrement côté natif : les images doivent de toute façon
  être déchiffrées dans la vue web pour s'afficher, donc la clé n'y ajoute pas d'exposition réelle tant que le
  coffre est ouvert ; et faire passer chaque photo (150 à 300 ko) en base64 par le pont Capacitor coûterait du
  temps et de la mémoire pour rien. La clé n'est en mémoire que coffre ouvert.
- **Réglages du coffre** (IndexedDB, magasin `meta`) : seulement `{ v: 2, checkIv, check, created }`. Ni clé,
  ni clé emballée, ni sel, ni compteur d'essais.

## Clé et sauvegardes (même iPhone, nouvel iPhone)

Vérifié dans la documentation Apple le 1er novembre 2026 :

- **Valeurs compatibles avec `.userPresence`** : `SecAccessControlCreateWithFlags` prend « une des valeurs de
  `kSecAttrAccessible` » [4]. Apple montre `.userPresence` avec `kSecAttrAccessibleWhenUnlocked` [2] et avec
  `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` [5]. `kSecAttrAccessibleAlways` est déconseillé [2] ;
  un élément synchronisé par le trousseau iCloud (`kSecAttrSynchronizable`) ne peut pas être `ThisDeviceOnly` [8].
- **Même iPhone** : un élément `…ThisDeviceOnly` « peut être restauré sur l'appareil qui a fait la sauvegarde,
  mais n'est pas migré quand on restaure la sauvegarde d'un autre appareil » [2]. Restaurer l'iPhone (après un
  effacement, par exemple) depuis sa sauvegarde iCloud ou d'ordinateur rend donc la clé, et les photos se rouvrent.
- **Nouvel iPhone** :
  - avec `ThisDeviceOnly` : la clé « ne migre jamais vers un nouvel appareil » [6][7] ;
  - sans `ThisDeviceOnly` (`kSecAttrAccessibleWhenUnlocked`) : la clé migre seulement par une **sauvegarde
    d'ordinateur chiffrée** [9]. Par la **sauvegarde iCloud**, le trousseau de l'appareil est chiffré avec une clé
    dérivée de l'UID de la Secure Enclave et « ne peut être restauré que sur l'appareil d'origine » [10], donc
    la clé ne suivrait pas non plus.

**Choix : `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.** Aucune option ne fait suivre la clé vers un nouvel
iPhone dans tous les cas sans affaiblir le coffre : la variante migrable ne passe que par une sauvegarde
d'ordinateur chiffrée (pas par iCloud, le cas courant), et elle mettrait la clé dans cette sauvegarde, lisible
par qui connaît (ou casse) son mot de passe : les outils d'extraction lisent les éléments non `ThisDeviceOnly`
d'une sauvegarde chiffrée avec son mot de passe, pas les `ThisDeviceOnly` [11]. Le trousseau iCloud synchronisé
ferait suivre la clé, mais Apple ne documente pas son mélange avec `.userPresence`, et la clé sortirait de
l'iPhone : écarté.
Entre les deux variantes `ThisDeviceOnly`, `WhenPasscodeSetThisDeviceOnly` **efface** la clé si le code de
l'iPhone est retiré [5][6] (photos perdues) ; `WhenUnlockedThisDeviceOnly` n'a pas cette règle. Le coffre exige
de toute façon un code sur l'iPhone (sans lui, `.deviceOwnerAuthentication` échoue avec `passcodeNotSet` [12]),
vérifié à la création et à chaque ouverture.

**Le compromis, dit à l'utilisateur** (présentation, pied du coffre ouvert, guide, politique de confidentialité) :
sur un nouvel iPhone, les photos du coffre ne suivent pas. L'app le détecte et le dit au lieu de planter :

- clé absente du trousseau (`errSecItemNotFound`, sans feuille d'iOS puisqu'il n'y a rien à lire) ou clé qui
  ne correspond pas au témoin : écran **« Coffre illisible sur cet iPhone »** avec le nombre de photos,
  « Réessayer », et « Vider le coffre… » (une confirmation « Effacer N photos ? ») pour en créer un nouveau ;
- coffre vide dans ce cas : rien à perdre, retour direct à la présentation ;
- des photos en clair d'avant le coffre pas encore rangées sont **gardées** quand on vide un coffre illisible :
  elles iront dans le nouveau.

Piste pour plus tard, si des utilisateurs changent d'iPhone avec des photos à garder : un bouton « Enregistrer
dans Photos » (ou l'export des photos du coffre ouvert) avant le changement.

## Où vont les photos (et où elles ne vont pas)

- **IndexedDB** `mdlf-vault`, dans le bac à sable de l'app : chiffrées.
- **Pas** dans la pellicule, ni dans l'export JSON, ni dans la copie iCloud de l'app (`ppl_v2` seulement).
- **Pas** sur nos serveurs : pas dans la synchro du compte, ni chez le coach, ni chez les amis, ni dans les récaps,
  les partages ou les notifications. Aucun de ces modules ne lit IndexedDB (`grep photo` sur `js/` : seulement
  `progress-photos.js`, `photo-vault*.js`, des textes, et `wipeLocalData`).
- **Sauvegarde de l'iPhone** : oui, comme tout le bac à sable, mais chiffrées ; lisibles seulement sur cet iPhone.
- **« Supprimer toutes les données »** vide le coffre (photos, réglages, ancienne base) et retire la clé du trousseau.

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
- **E2E** (`tests/test_coffre.py`) : faux module `MdlfVault` injecté dans la page (`FAKE_SHELL`), clé de test
  tirée par `crypto.getRandomValues` et gardée dans `sessionStorage` le temps du test (survit à un rechargement,
  comme le trousseau ; retirée pour simuler un autre iPhone). Jamais une vraie clé.

## Limites assumées

- **Le Swift n'a pas été compilé** au moment de l'écrire (pas de Xcode sur la machine) : à compiler et essayer
  sur un iPhone avant la build (création, ouverture, annulation, iPhone sans code, réinstallation de l'app).
- **Code de l'iPhone retiré après la création** : avec `WhenUnlockedThisDeviceOnly`, Apple ne documente pas
  ce que devient un élément `.userPresence` sans code. Attendu : illisible tant qu'il n'y a pas de code (l'app
  affiche « Code de l'iPhone requis »), de nouveau lisible ensuite. À vérifier sur un iPhone de test.
- **Transfert direct d'iPhone à iPhone** (Démarrage rapide) : non documenté pour le trousseau `ThisDeviceOnly` ;
  à traiter comme un nouvel iPhone (coffre illisible).
- **Réparation qui change la carte mère** : nouvel UID, donc comme un nouvel iPhone.
- **Mémoire flash** : la suppression de l'ancienne base ne garantit pas l'effacement physique des blocs. C'est le
  chiffrement matériel d'iOS (Data Protection) qui couvre ce cas.
- **Retour en arrière d'une mise à jour à chaud** : si le contenu revient à une version d'avant le coffre, les photos
  migrées ne s'y affichent pas (elles sont dans la nouvelle base). Elles réapparaissent avec la version suivante.

## Mise en service

Une seule livraison, avec la build : `VaultPlugin.swift` est dans le projet Xcode et enregistré dans
`MainViewController` (le contrôleur racine créé par `SceneDelegate`), `NSFaceIDUsageDescription` est dans
Info.plist. L'empreinte runtime change : la partie JS ne part pas seule en mise à jour à chaud.

## Sources

1. Apple, `SecAccessControlCreateFlags.userPresence` : https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/userpresence
2. Apple, *Restricting keychain item accessibility* : https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility
3. Apple Platform Security, *Keychain data protection* : https://support.apple.com/guide/security/secb0694df1a/web
4. Apple, `SecAccessControlCreateWithFlags(_:_:_:_:)` : https://developer.apple.com/documentation/security/secaccesscontrolcreatewithflags(_:_:_:_:)
5. Apple, *Accessing keychain items with Face ID or Touch ID* : https://developer.apple.com/documentation/localauthentication/accessing-keychain-items-with-face-id-or-touch-id
6. Apple, `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` : https://developer.apple.com/documentation/security/ksecattraccessiblewhenpasscodesetthisdeviceonly
7. Apple, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` : https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly
8. Apple, `kSecAttrSynchronizable` : https://developer.apple.com/documentation/security/ksecattrsynchronizable
9. Apple, `kSecAttrAccessibleWhenUnlocked` : https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlocked
10. Apple Platform Security, *Security of iCloud Backup* : https://support.apple.com/guide/security/sec2c21e7f49/web
11. Elcomsoft, *Extracting and Decrypting iOS Keychain* (source tierce) : https://blog.elcomsoft.com/2020/08/extracting-and-decrypting-ios-keychain-physical-logical-and-cloud-options-explored/
12. Apple, `LAPolicy.deviceOwnerAuthentication` : https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication
13. Apple, `kSecUseAuthenticationContext` (contexte déjà authentifié réutilisé sans redemander) : https://developer.apple.com/documentation/security/ksecuseauthenticationcontext
