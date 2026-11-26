# Photos de bilan sur ordinateur : « Relier cet ordinateur » (vague 5 de l'appli web du coach)

Branche `photos-web`, 25/11/2026. **Rien n'est appliqué ni publié** : migration écrite et testée en local, site pas
déployé, pas d'OTA, pas de build. Contexte : docs/PHOTOS_BILAN.md (chiffrement des photos), docs/COACH_WEB.md (le site),
docs/COACH_IPAD.md (mode iPad, branche `coach-ipad`).

## Le problème

Une photo de bilan est chiffrée sur l'iPhone de l'élève pour la clé publique de son coach (ECDH P-256 éphémère, HKDF,
AES-GCM). La clé privée du coach n'est sur le serveur que chiffrée par un secret de 256 bits de **son trousseau iCloud**,
rendu par le module natif du coffre après Face ID. Un navigateur sur Windows, Linux ou une tablette Android n'a pas ce
trousseau : il ne peut pas ouvrir les photos. Il faut que l'iPhone confie la clé à l'ordinateur, sans que le serveur
(qui relaie) puisse la lire, et de façon révocable.

## Le protocole, en bref

1. **Navigateur** : paire ECDH P-256 éphémère `D` (privée non extractible), secret `s` de 128 bits. Le serveur reçoit
   `D.pub` et `H(s)` seulement (`coach_photo_pair_start`, 2 minutes, un appairage à la fois). QR code affiché :
   `MDLF1.<appairage>.<coach>.<D.pub>.<s>` (base64url, ~160 caractères).
2. **iPhone** (même compte) : lit le QR (lecteur natif, mode QR), vérifie que le QR est de son compte et que le serveur
   donne bien la clé `D.pub` du QR (`coach_photo_pair_peek`), tire sa paire `E` et publie `E.pub` avec la preuve `H(s)`
   (`coach_photo_pair_offer`, une seule fois).
3. **Les deux** : `Z = ECDH(E, D)`, puis HKDF-SHA-256 (sel `s`, info liée à l'appairage, au coach, à `D.pub`, `E.pub`) :
   une clé AES-GCM d'enveloppe et un **code de vérification à 6 chiffres**, affiché sur les deux écrans.
4. **Le coach** compare, touche « Relier » sur l'iPhone, Face ID : la clé privée des photos (PKCS#8, vérifiée contre la
   clé publique du serveur) est chiffrée par la clé d'enveloppe, données liées (appareil, coach, identifiant et clé
   publique de la clé du coach), puis effacée de la mémoire (`coach_photo_pair_complete`).
5. **Navigateur** : rouvre l'enveloppe une fois (preuve), garde **seulement la clé d'enveloppe, non extractible**, dans
   IndexedDB. À chaque ouverture des photos : `coach_photo_device_key` rend l'enveloppe, `unwrapKey` la rouvre en clé
   privée non extractible, en mémoire tant que les photos sont affichées.

Code : `js/data/photo-link.js` (protocole, partagé par l'app et le site), `js/data/photo-link-phone.js` et
`js/features/photo-link-ui.js` (iPhone), `coach-web/js/desk/photo-device.js` et `photos.js` (navigateur),
`coach-web/js/desk/qr.js` (QR code). Lecture et déchiffrement d'une photo : `cphFetchWith` de `js/data/coach-photos.js`,
le même code que l'app.

## Choix et pourquoi

| Question | Décision | Pourquoi |
|---|---|---|
| Canal authentifié | **Le QR code** (lu à l'écran par l'appareil photo) porte `D.pub` et `s` | C'est le seul canal que le serveur ne voit pas. Avec `D.pub` dans le QR, un serveur qui substitue les clés ne peut ni lire l'enveloppe, ni « coincer » le code de vérification par force brute (il ne choisit pas `D`). |
| Échange de clés | ECDH **P-256** (WebCrypto) | Le même que les photos ; X25519 n'est pas dans tous les Safari visés (iPadOS 16.4). |
| Code de vérification | 6 chiffres tirés de HKDF(Z, s), affichés des deux côtés, à comparer avant « Relier » | Contre un QR substitué (QR d'un attaquant qui a la session du coach, montré par hameçonnage) : le code de l'iPhone ne correspond pas à l'écran du coach. Rien de secret ne quitte l'iPhone avant la comparaison et Face ID. |
| Preuve du QR | Le serveur garde `H(s)`, le téléphone le présente à l'offre | Une autre session du même compte (jeton volé) qui ne lit pas le QR ne peut pas faire d'offre. Le serveur, lui, ne connaît jamais `s` (sel de HKDF). |
| Ce que garde le navigateur | La **clé d'enveloppe**, non extractible, dans IndexedDB ; ni `D`, ni `s`, ni la clé du coach | Une clé non extractible ne se lit pas par le JavaScript : une faille XSS ne peut pas emporter CETTE clé. Elle peut en revanche, au moment d'un appairage, en lancer un elle-même (voir le modèle de menace). L'enveloppe reste sur le serveur : retirer l'ordinateur coupe un navigateur honnête. |
| Preuve de la clé gardée | Avant de garder l'entrée, le navigateur vérifie que la clé rouverte est celle de la clé publique du coach (deux secrets ECDH avec une paire éphémère, rien d'exporté) | Un appairage terminé par un tiers avec sa propre clé (QR et session volés) est refusé, au lieu de laisser des photos illisibles. |
| Ouverture de l'enveloppe | `unwrapKey` (AES-GCM → PKCS#8 → clé ECDH non extractible) | La clé privée du coach ne passe jamais en clair dans le JavaScript du navigateur. |
| Données liées de l'enveloppe | appareil, coach, identifiant et **clé publique** de la clé du coach | Une enveloppe recopiée vers un autre appareil ou un autre coach ne s'ouvre pas ; un serveur qui servirait une autre clé publique du coach (`coach_photo_key`) fait échouer l'ouverture : rien n'est gardé. |
| Durée | Appairage : 2 minutes, usage unique. Ordinateur relié : **30 jours sans usage, 90 jours au plus** ; 5 au plus | Un lien oublié finit seul ; les 90 jours obligent à revoir la liste. |
| Révocation | iPhone (Ordinateurs reliés › Retirer), site (« Oublier cet ordinateur »), clé des photos changée ou republiée (déclencheur), compte supprimé, rôle coach retiré, photos éteintes | Chaque ouverture, et chaque nouvel élève ouvert, relit l'enveloppe sur le serveur : effet à l'action suivante du coach, au plus tard 15 minutes. Contre un navigateur honnête seulement : une clé déjà copiée (ordinateur volé, XSS) ne se révoque pas, seule une nouvelle clé de photos protège les photos suivantes. |
| Session des photos | Rien d'affiché tout seul (« Afficher les photos » à chaque fois) ; masquées à l'onglet caché, après 5 minutes sans geste, après 15 minutes quoi qu'il arrive, en quittant l'onglet Bilans, à la déconnexion ; l'enveloppe est relue sur le serveur à chaque nouvel élève | Un écran d'ordinateur se voit de loin ; c'est l'équivalent de Face ID + une minute de l'iPhone. Rouvrir ne coûte qu'un appel. |
| Déconnexion | « Se déconnecter de cet ordinateur » **oublie aussi** l'ordinateur ; la fermeture après 30 minutes sans geste ne l'oublie pas | Qui se déconnecte explicitement d'un ordinateur (partagé) part tout entier ; la fermeture automatique, c'est le coach qui revient sur SON ordinateur. |
| Scripts tiers | Après la connexion, la page qui ouvre les photos **ne contient aucun script tiers** : si Sign in with Apple JS a été chargé (écran de connexion), « Relier » ou « Afficher » rechargent d'abord la page (session gardée), puis reprennent | Un script tiers a tout le DOM et toutes les clés non extractibles à portée. Google passe par une redirection, sans script. |
| QR code | Encodeur maison (mode octet, correction M, versions 1 à 10), relu par OpenCV dans les tests | La CSP n'autorise aucun script tiers ; le besoin est étroit. |
| Lecture du QR sur l'iPhone | **Lecteur natif** `MdlfScanner.scanQr` (AVFoundation, `.qr`) : nouvelle méthode, **build iOS** | Le lecteur des codes-barres ne lisait que les EAN. Lire un QR avec la caméra du web demanderait une bibliothèque de décodage en JavaScript (WKWebView n'a pas `BarcodeDetector`) : une dépendance de plus, moins fiable. C'est de toute façon une fonction nouvelle : build et note d'examen (règle d'Apple). Ancienne build : « Mets à jour l'app ». |
| iPad (mode coach grand écran, page embarquée) | Aujourd'hui : **pas de photos dans le cadre**. Le cadre est isolé (sandbox sans allow-same-origin : origine opaque, ni IndexedDB, ni sessionStorage, ni clé d'appareil) et l'app ne lui prête pas encore ses photos : l'onglet Bilans dit « Photos : ouvre coach.mdlf.app sur un ordinateur », sans « Relier » ni « Afficher », rien dans Réglages, aucune requête d'appairage (`deskPhEmbeddedOff`). Plus tard : `MDLF_COACH_HOST.photos` (l'app déchiffre, le cadre ne reçoit que des images), déjà pris en charge par la page | Relier un iPad à lui-même n'a pas de sens, et un cadre isolé ne peut rien garder ; sur l'iPhone, les photos s'ouvrent déjà dans l'app (Face ID). |
| Images | Déchiffrées dans le navigateur (`cphFetchWith`), adresses `blob:` libérées à la fermeture ; chiffré lu sans cache (`no-store`) ; pas de service worker ; CSP `img-src blob:` | Rien en clair sur le disque par le site. |

## Modèle de menace

| Menace | Ce qui protège | Reste |
|---|---|---|
| **Vol du QR** (photo de l'écran, partage d'écran en visio, caméra) | Le QR donne `D.pub` et `s`, pas `D.priv` (non extractible, jamais sorti du navigateur) : l'enveloppe ne s'ouvre qu'avec `D.priv`. Il faut aussi la session du coach pour faire une offre, et l'offre ne passe qu'une fois. 2 minutes. | Un voleur qui a AUSSI la session du coach peut faire une offre avant l'iPhone : l'appairage est grillé (« déjà servi » sur l'iPhone), rien ne fuit ; le coach recommence. |
| **QR substitué** (QR d'un attaquant montré au coach : courriel « relie ton ordinateur », page imitée) | QR d'un autre compte : refusé par l'iPhone et par le serveur. QR du compte du coach affiché sur l'écran HONNÊTE du coach : les codes diffèrent. L'iPhone montre l'heure de la demande vue par le serveur et le nom de l'appareil, et demande de vérifier que l'ordinateur est devant soi, sur coach.mdlf.app. | **Hameçonnage qui relaie en direct** (fausse page qui relaie la connexion par code e-mail, obtient la session, puis affiche le QR ET le code de la machine de l'attaquant) : le coach voit le même code des deux côtés, et le nom de l'appareil est choisi par l'attaquant. Le code de vérification n'y peut rien ; c'est la limite connue des liaisons par QR (« QRLjacking », OWASP). Restent : l'adresse dans la barre du navigateur (rappelée sur l'iPhone), Face ID, la liste de l'iPhone. Parades à venir : courriel « un ordinateur a été relié » avec retrait en un geste ; clé d'accès WebAuthn liée à l'origine. |
| **Serveur compromis** (base, API, administrateur, jeton `service_role`) | Il ne voit que `D.pub`, `H(s)`, `E.pub` et l'enveloppe. Sans `s` ni l'une des clés privées : rien à ouvrir. **Homme du milieu** sur la RPC : remplacer `E.pub` pour le navigateur donne deux codes différents et une enveloppe qui ne s'ouvre pas (vérifié par les tests) ; remplacer `D.pub` pour le téléphone est vu (le téléphone compare avec le QR) ; glisser une autre clé du coach fait échouer l'ouverture (données liées). | Un serveur peut refuser le service (supprimer un ordinateur, ne pas relayer) : visible, pas de fuite. Il peut toujours, comme avant, substituer la clé publique du coach donnée aux élèves (limite déjà décrite dans PHOTOS_BILAN.md). |
| **Ordinateur partagé** | Mise en garde avant de relier ; « Se déconnecter de cet ordinateur » oublie le lien ; 30 minutes sans geste ferment la session (photos inaccessibles sans se reconnecter : l'enveloppe demande la session du coach) ; photos masquées onglet caché et après 5 minutes ; liste et retrait depuis l'iPhone. | Un autre utilisateur du même compte système, session du coach ouverte, pendant que les photos sont affichées : il les voit. Comme un iPhone déverrouillé prêté. |
| **Ordinateur perdu ou volé** | Dans le navigateur, le voleur doit ouvrir une session MDLF du coach ; retrait depuis l'iPhone ; 30 et 90 jours. « Retirer » sur l'iPhone propose aussi de créer une nouvelle clé de photos. | **Copie du profil du navigateur** : la clé d'enveloppe n'est non extractible que pour le JavaScript, sur disque elle se lit ; le jeton de rafraîchissement de Supabase y est aussi (localStorage) et les 30 minutes d'inactivité ne sont vérifiées que dans la page, pas par le serveur. Avant le retrait, ces deux éléments donnent l'enveloppe puis, hors du navigateur, la clé privée en clair : **pour toujours** (retirer l'ordinateur ne sert plus). Seule une nouvelle clé de photos protège les photos suivantes ; les anciennes, effacées avec l'ancienne clé, sont renvoyées par les élèves. À régler côté Supabase : durée de session et inactivité maximales (Auth › Sessions), pour que l'expiration existe aussi sur le serveur. |
| **Session expirée ou volée** | Session expirée : rien ne s'ouvre (l'enveloppe demande la session), « reconnecte-toi ». Jeton volé seul (sans la clé d'enveloppe de l'ordinateur) : l'enveloppe ne lui sert à rien. | Jeton + accès au navigateur relié = voir les photos ; même niveau que le reste du compte. |
| **Clé qui fuit par IndexedDB, journaux, cache** | IndexedDB : seule la clé d'enveloppe, non extractible (test : export refusé, champs gardés listés). Journaux : aucune clé ni secret écrit dans la console ; côté serveur, les RPC ne journalisent pas leurs arguments (`s` n'y passe jamais, l'enveloppe y est chiffrée). Cache : pas de service worker, chiffré lu avec `cache: 'no-store'`, images en `blob:` en mémoire (test : Cache Storage vide). localStorage : rien de nouveau (test). | Une capture d'écran du coach : impossible à empêcher (dit à l'écran). |
| **XSS dans le site** | CSP stricte (`script-src 'self'` + Apple sur l'écran de connexion seulement), page rechargée sans script tiers avant les photos, tout texte reçu échappé (`esc`), clés gardées non extractibles. | Un script injecté peut déchiffrer tant qu'il est là ; et s'il est là au moment d'un appairage, il peut le mener lui-même avec une paire extractible, afficher SON QR et SON code : le coach voit le même code, relie, et la clé du coach part en clair. Une faille XSS sur ce site = clé à long terme compromise (nouvelle clé de photos). Trusted Types (`require-trusted-types-for 'script'`) ne s'ajoute pas sans revoir tout le rendu par `innerHTML` : piste suivante. |
| **Rejeu** | Appairage à usage unique (états waiting → offered → done une fois), enveloppe liée à l'appareil, au coach et à la clé. | — |

## Serveur : `20261127040000_photos_web_appairage.sql` (écrite, PAS appliquée)

| Fonction | Qui | Règles |
|---|---|---|
| `coach_photo_pair_start(device_pub, verifier, label)` | navigateur | coach validé, photos allumées, clé de photos (`no_key`), 5 ordinateurs (`too_many`), 10 par heure ; remplace l'appairage en cours |
| `coach_photo_pair_peek(pair)` | iPhone | `{ device_pub, label, state, expires_at }` ; pas le mien, inconnu, expiré : `not_found` |
| `coach_photo_pair_offer(pair, verifier, epk)` | iPhone | preuve du QR ; une fois (`already_used`) |
| `coach_photo_pair_complete(pair, key_id, wrapped, iv)` | iPhone | après l'offre seulement, clé actuelle (`key_changed`), 5 au plus ; crée l'ordinateur (id = appairage) |
| `coach_photo_pair_status(pair)` | navigateur | `{ state, epk, device }` |
| `coach_photo_pair_cancel(pair)` | les deux | silencieux, jamais un appairage fini |
| `coach_photo_devices()` | iPhone | liste, sans l'enveloppe |
| `coach_photo_device_key(device)` | navigateur | l'enveloppe ; 600 par heure ; repousse les 30 jours |
| `coach_photo_device_revoke(device)` | les deux | silencieux, jamais limité, même photos éteintes |

Tables `coach_photo_pairings` et `coach_photo_devices` : RLS activée sans politique, aucun GRANT ; RPC `security definer`,
`search_path = ''`, `auth.uid()`. Déclencheur sur `coach_photo_keys` (clé remplacée ou effacée → ordinateurs effacés) plutôt
qu'une clé étrangère : le retour arrière des photos de bilan reste lançable seul. Tests : `tests/sql/photos_web_appairage_test.sql`.
Retour arrière : `supabase/rollback/20261127040000_photos_web_appairage_down.sql`, vérifié par
`tests/sql/photos_web_appairage_rollback_test.sh` ; dans `prod_order_test.sh` et `rollback_nuit_check.sh`.

## Ce qui demande quoi

| Partie | Comment elle arrive |
|---|---|
| Migration | SQL, à appliquer quand Maxence le dit (avant le site) |
| Site (photos, « Relier », Google) | déploiement Vercel du site (`npm run coach-web:build`) |
| iPhone : écran « Ordinateurs reliés » | JS (OTA possible) mais **inutile sans la build** : le lecteur de QR est natif |
| iPhone : lecteur de QR (`ScannerPlugin.swift`, `scanQr`) | **build iOS**, soumise à Apple, décrite dans la note d'examen |
| Connexion Google sur le site | réglages Supabase et Google (docs/COACH_WEB.md), **avant** le déploiement du site : sans l'adresse de retour dans Supabase, Google renvoie sur https://mdlf.app |
| Google ou Apple inconnu sur le site : aucun compte laissé | migration `20261128010000_compte_vide_site_coach.sql`, puis fonction Edge `coach-web-orphan`, puis le site ; renvoi des erreurs de Supabase par mdlf.app (`web-public/auth-retour.js`, job `deploy`) : docs/COACH_WEB.md, « Identifiant inconnu : aucun compte laissé » |
| Durée de session côté serveur | réglage Supabase (Auth › Sessions : durée et inactivité maximales), conseillé avant d'ouvrir les photos sur ordinateur |

## Tests

- `node tests/unit/run.mjs` : `tests/unit/photo-link.mjs` (QR aller-retour et refus, preuve, protocole complet jusqu'à la
  photo déchiffrée, clés non extractibles, attaques : homme du milieu, QR volé, QR substitué, enveloppe rejouée ou
  modifiée, clé du coach glissée ; QR code conforme : repères, format et version en BCH, versions 1 à 10).
- `bash tests/sql/run.sh` (dont `photos_web_appairage_test.sql`), `bash tests/sql/photos_web_appairage_rollback_test.sh`.
- `python3 tests/test_photos_web.py` : le site seul dans Chromium, Firefox et WebKit, puis l'app iPhone simulée avec
  l'ordinateur (Chromium et WebKit) ; détail en tête du fichier. Faux serveur : `tests/fake_photo_link.py`.

## Limites

- **Hameçonnage qui relaie en direct** et **XSS pendant un appairage** : voir le modèle de menace ; le code de vérification
  ne les arrête pas. Une clé compromise ne se « retire » pas : seule une nouvelle clé de photos protège la suite.
- **Ordinateur volé, profil copié avant le retrait** : la clé du coach peut en être tirée pour toujours (voir plus haut).

- Le coach doit regarder le code de vérification ; un coach qui accepte sans comparer peut relier l'ordinateur d'un
  attaquant qui a déjà sa session.
- Une clé « non extractible » ne l'est que pour le JavaScript : sur le disque d'un ordinateur volé, avec la session,
  elle sert jusqu'au retrait. WebAuthn (Windows Hello, Touch ID, PRF) pour la garder derrière la biométrie de
  l'ordinateur : piste suivante, pas encore assez répandu partout (Firefox, Linux).
- Navigation privée : IndexedDB peut refuser de garder la clé ; le site le dit, l'ordinateur reste relié jusqu'à la
  fermeture de l'onglet seulement (et figure dans la liste de l'iPhone jusqu'à 30 jours : le retirer).
- Capture d'écran possible, comme sur l'iPhone.
