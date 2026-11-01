# Coffre à photos (Progrès › Mesures › Photos)

Les photos de progression sont rangées dans un coffre, sur le modèle de « My Eyes Only » de Snapchat et de l'album
« Masqués » de Photos sur iOS : on y entre avec un code à 6 chiffres, ou avec Face ID dans une build qui a le module natif.

Code : `js/data/photo-vault.js` (logique, sans DOM), `js/features/photo-vault-ui.js` (écran),
`js/data/progress-photos.js` (IndexedDB), `ios/App/App/VaultPlugin.swift` (Face ID, écran de confidentialité).
Tests : `tests/unit/photo-vault.mjs`, `tests/test_coffre.py`.

## Ce qui protège quoi

| Menace | Protection |
|---|---|
| Quelqu'un tient l'iPhone déverrouillé (ami, famille) | Code à 6 chiffres. Les codes trop évidents (000000, 123456, 121212…) sont refusés. 4 erreurs libres, puis 30 s, 1 min, 5 min, 15 min, et 1 h à chaque nouvelle erreur. L'erreur est enregistrée **avant** le calcul : tuer l'app pendant l'essai ne le rend pas gratuit. Reculer l'heure de l'iPhone ne raccourcit pas l'attente ; l'avancer, si (une visite dans Réglages par essai : des mois pour tout essayer). |
| Coffre laissé ouvert | Refermé en quittant l'écran, quand l'app passe en arrière-plan, et après 1 min sans toucher l'écran. La clé est alors effacée de la mémoire, les images libérées (`URL.revokeObjectURL`) et les feuilles de photo retirées. |
| Sélecteur d'apps (capture d'écran d'iOS) | JS : la classe `pv-shield` recouvre l'écran dès que l'app cesse d'être active (`appStateChange` de `@capacitor/app`). Natif (build qui suit la 31) : un flou posé sur la fenêtre à `willResignActive`, donc avant la capture, retiré seulement au retour de l'app. |
| Copie de la sauvegarde de l'iPhone (iCloud ou ordinateur) | Les photos y sont chiffrées (AES-GCM 256 bits), avec la clé emballée par le code. Cela arrête quiconque ouvre les fichiers sans outil, **pas** un attaquant outillé (voir « Limites »). |
| Lecture des fichiers de l'app | Même chose : en clair, seulement l'identifiant et la date de chaque photo. La pose, la taille et l'image sont chiffrées. |

## Clés

- **Clé du coffre (DEK)** : 256 bits tirés au hasard à la création, jamais dérivée du code. Chaque photo est chiffrée
  en AES-GCM avec un IV de 96 bits neuf. L'identifiant et la date sont liés en données authentifiées : une ligne
  recopiée sous un autre identifiant ne se déchiffre pas.
- **Code** : jamais stocké, ni en clair ni haché. Il sert à dériver une clé d'emballage (PBKDF2-HMAC-SHA-256,
  600 000 tours, minimum recommandé par l'OWASP, sel de 128 bits) qui chiffre la DEK. Si l'étiquette GCM est valide,
  le code est juste : il n'existe pas de « hash du code » à comparer.
- **Changer de code** : la même DEK est ré-emballée avec un nouveau sel. Les photos ne sont pas rechiffrées.
- **Face ID** : la DEK est confiée au trousseau avec `.biometryCurrentSet` et
  `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`. Elle n'est lisible qu'après Face ID sur cet iPhone, jamais
  sauvegardée ni copiée ailleurs, et iOS l'invalide si les visages enregistrés changent : il faut alors repasser par
  le code. À son retour dans le JS, la clé est vérifiée par un témoin chiffré (`check`).

## Code oublié

Personne ne peut rouvrir le coffre, pas même nous : rien n'est sur nos serveurs. Comme dans Snapchat, il reste une
seule issue : **vider le coffre**, avec deux confirmations (explication, puis « Effacer N photos ? »). Les photos sont
supprimées et le coffre repart de zéro. Nous n'avons pas prévu de clé de secours : ce serait un second secret à garder,
et sans serveur elle protégerait mal. Nous n'effaçons pas non plus le coffre après un nombre d'erreurs : un ami qui
s'amuse avec le téléphone pourrait détruire les photos.

## Où vont les photos (et où elles ne vont pas)

- **IndexedDB** `mdlf-vault`, dans le bac à sable de l'app : chiffrées.
- **Pas** dans la pellicule, ni dans l'export JSON, ni dans la copie iCloud de l'app (`ppl_v2` seulement).
- **Pas** sur nos serveurs : pas dans la synchro du compte, ni chez le coach, ni chez les amis, ni dans les récaps,
  les partages ou les notifications. Aucun de ces modules ne lit IndexedDB (`grep photo` sur `js/` : seulement
  `progress-photos.js`, `photo-vault*.js`, des textes, et `wipeLocalData`).
- **Sauvegarde de l'iPhone** : oui, comme tout le bac à sable, mais chiffrées.
- **« Supprimer toutes les données »** vide le coffre (photos, réglages) et retire la clé du trousseau.

## Migration (builds 30 et 31)

Les photos prises avant le coffre étaient en clair dans la base `mdlf-photos`. À la création du code (et à chaque
déverrouillage, si une migration a été interrompue), elles sont chiffrées dans `mdlf-vault`. On vérifie qu'elles y
sont toutes, puis l'ancienne base est supprimée **en entier** : `deleteDatabase` efface le fichier, alors que vider le
magasin laisserait les octets en clair dans les pages libres du fichier SQLite de WebKit.

## Limites assumées

- **Attaque hors ligne sur une sauvegarde** : 10⁶ codes seulement. Une RTX 4090 calcule environ 15 000 essais
  PBKDF2-SHA-256 à 600 000 tours par seconde (hashcat, mode 10900) : **un peu plus d'une minute** pour tous les essayer
  sur une sauvegarde d'ordinateur non chiffrée. Le code protège donc des proches et de qui tient l'iPhone, pas d'un
  attaquant outillé qui a la sauvegarde. Les textes de l'app ne promettent pas plus (« chiffrées dans les sauvegardes »).
  Pistes pour relever ce plafond, à décider : une phrase de passe au choix (comme Snapchat) ; dans la build native, un
  second secret aléatoire gardé dans le trousseau (`kSecAttrAccessibleAfterFirstUnlock`, absent des sauvegardes
  d'ordinateur non chiffrées) et mêlé au code ; ou exclure la base de la sauvegarde (photos perdues au changement d'iPhone).
- **Délais entre les essais** : ils sont stockés dans l'app. Ils arrêtent un proche, pas quelqu'un qui lit les fichiers.
  Celui-là se heurte à la limite du point précédent.
- **Mémoire flash** : la suppression de l'ancienne base ne garantit pas l'effacement physique des blocs. C'est le
  chiffrement matériel d'iOS (Data Protection) qui couvre ce cas.
- **Retour en arrière d'une mise à jour à chaud** : si le contenu revient à une version d'avant le coffre, les photos
  migrées ne s'y affichent pas (elles sont dans la nouvelle base). Elles réapparaissent avec la version suivante.

## Mise en service

- **Partie JS** (mise à jour à chaud) : marche seule, au code. `Native.vault.available` est faux sans le module :
  ni Face ID ni écran de confidentialité natif, aucune mention de Face ID. L'empreinte runtime ne change pas.
- **Partie native** (prochaine build) : `VaultPlugin.swift` ajouté au projet Xcode et enregistré dans
  `MainViewController` (le contrôleur racine créé par `SceneDelegate`), plus `NSFaceIDUsageDescription` dans
  Info.plist. Commit séparé : il change l'empreinte et part avec la build.
