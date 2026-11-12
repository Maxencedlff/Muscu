# Photos de bilan envoyées au coach

Demande du coach Dylan (vocal de novembre 2026) : « un côté bilan où ton client t'envoie ses mensurations, possiblement
des photos ». Les mensurations sont partagées depuis le 05/11 (`docs/COACH_SUIVI.md`). Restaient les photos, écartées de
la V1 du bilan : ce sont des photos de corps, souvent en sous-vêtements, et jusqu'ici elles ne quittaient jamais l'iPhone
(`docs/COFFRE_PHOTOS.md`).

Branche `photos-bilan`, V1 du 07/11/2026. **Rien n'est appliqué en production** : migration, fonction serveur,
planification et OTA attendent le feu vert de Maxence (« Mise en production »).

Code : `js/data/coach-photos.js` (chiffrement, métadonnées, appels, sans DOM), `js/features/coach-photos-ui.js` (écrans),
styles en fin de `css/coach.css`. Serveur : `supabase/migrations/20261107000000_photos_bilan.sql`,
`supabase/functions/coach-photos-purge/` (effacement réel des fichiers), `supabase/functions/delete-account/index.ts`
(fichiers effacés juste après le compte, `deleteAccountThenFiles`). Tests : `tests/unit/coach-photos.mjs`, `tests/unit/coach-photos-purge.mjs`,
`tests/sql/photos_bilan_test.sql`, `tests/test_photos_bilan.py` (faux serveur et faux stockage dans `tests/fake_account.py`).

## Décision : chiffrement de bout en bout, sans changement natif

| Question | Décision | Pourquoi |
|---|---|---|
| Chiffrement | **De bout en bout** : la photo est chiffrée sur l'iPhone de l'élève pour la clé du coach ; le serveur ne garde que du chiffré | Voir le comparatif ci-dessous. Le chiffrement au repos de Supabase (« AES-256 » [24]) protège les disques, pas contre qui accède au projet. |
| Clé du coach | Une paire ECDH P-256 par coach, tirée sur son iPhone. Clé publique sur le serveur ; clé privée sur le serveur **chiffrée** (AES-GCM) par un secret de 256 bits de **son trousseau iCloud**, rendu après Face ID par le module natif du coffre (`Native.vault`, déjà dans la build, autre identifiant) | Le coach retrouve ses photos sur un nouvel iPhone (le secret suit par le trousseau iCloud, chiffré de bout en bout par Apple), sans code à retenir, et **sans toucher à `ios/`** : le module du coffre sait déjà créer et rendre un secret par identifiant après Face ID. Une clé privée gardée seulement dans IndexedDB aurait été perdue à chaque réinstallation (IndexedDB peut aussi être vidé par iOS quand la place manque [32]) et WebKit a des défauts connus sur les `CryptoKey` en IndexedDB [29]. |
| Clé d'une photo | Une clé à usage unique par photo : paire ECDH éphémère, HKDF-SHA-256, AES-GCM 256, IV de 96 bits neuf | Une fuite d'une photo n'apprend rien sur les autres. Algorithmes présents dans WebKit depuis iOS 11 (HKDF, `deriveBits`) [25][26] ; P-256 plutôt que X25519, dont la date d'arrivée dans Safari est incertaine (MDN dit 17, WebKit l'active fin 2024) [26][27]. |
| Données liées | Identifiant, élève, coach, clé, jour, pose en données authentifiées (AAD) | Le serveur ne peut ni déplacer une photo vers un autre élève, ni changer sa date ou sa pose, ni la rattacher à une autre clé : elle ne se déchiffre plus. |
| Âge | **18 ans ou plus**, déclaré une fois avant le premier envoi (`coach_photo_adults`, sinon `not_adult`). **Tranche d'âge d'Apple** connue sur l'iPhone (`currentAgeBand()`, js/data/age-range.js) et autre que « adult » (`teen`, `young`, `limited`) : l'envoi n'est pas proposé, `cphSend` refuse (`not_adult`) et la case « 18 ans ou plus » n'est jamais montrée, quoi qu'ait déclaré l'élève ; il peut seulement voir et retirer ce qui serait déjà parti. Tranche inconnue (refus, navigateur, iOS antérieur au 26) : la déclaration fait foi | Un élève peut rejoindre un coach dès 15 ans ; des photos de corps chiffrées, que personne ne peut modérer, envoyées par un mineur à un adulte : refusé. |
| Photo déplacée | Le coach peut **effacer** une photo reçue (« Ne plus voir cette photo », `coach_photo_hide`) ; signalement par les messages (⋯ › Signaler) | Apple 1.2 (contenu des utilisateurs) [52]. |
| Changement de clé | L'élève retient la clé de son coach dès la **première photo partie** (même si la suite de l'envoi échoue), la clé qui a réellement chiffré la photo ; si elle change, une alerte (« La clé de ton coach a changé », avec le code) passe avant tout nouvel envoi. Rangée par compte (`mdlf_coach_photo_pin`, lue pour ce compte seulement) et gardée à la déconnexion (hors `CROSS_USER_CACHE_KEYS` : une clé publique, rien d'autrui) ; effacée avec les données de l'appareil | Confiance au premier usage : une clé glissée par le serveur ne passe plus en silence. |
| Substitution de clé | Le coach vérifie à chaque ouverture que la clé publique du serveur est la sienne (recalculée depuis sa clé privée), et retient sur son iPhone `key_id` et clé publique de sa clé vérifiée (`mdlf_coach_photo_mykey`, par compte, avec la clé enveloppée) : une autre clé servie ensuite est signalée dès la relecture. Deux cas distincts : **secret absent du trousseau** (`NOT_FOUND`, rien de retenu ici) → « Clé absente de cet iPhone », réessayer plus tard ; **secret présent mais clé du serveur qui n'est pas la sienne** (clé publique qui ne correspond pas, clé enveloppée qui ne s'ouvre pas, ou autre clé que celle retenue ici) → « La clé enregistrée sur le serveur n'est plus la tienne », avec le code de SA clé et « Republier ma clé » (Face ID, sa clé revérifiée puis renvoyée, `replace`). **Code de la clé** (64 bits du SHA-256 de la clé publique) montré au coach (celui de la clé qui déchiffre) et à l'élève | Sans annuaire de clés vérifiable, un opérateur qui donnerait une autre clé publique à l'élève recevrait les photos suivantes [55][56]. Le code permet de le vérifier ensemble, comme les « numéros de sécurité » de Signal [57]. |
| Stockage | Supabase Storage, compartiment **privé** `coach-photos` (1 Mo par fichier, `application/octet-stream` seulement), fichier à `<élève>/<photo>` | Supabase n'autorise rien sans politique RLS [5]. Bucket privé : jamais d'URL publique. |
| Lecture | URL signée de **60 s**, demandée par l'app du coach, lue aussitôt (`fetch`), jamais affichée ; l'image déchiffrée vit en `blob:` révoqué à la fermeture | La durée est choisie par l'appelant, sans plafond côté serveur, et une URL signée ne se révoque pas [10][11] ; mais elle ne donne que du chiffré. |
| Consentement | **Photo par photo**, au moment de l'envoi, rien de coché d'avance ; la ligne du serveur est l'accord (horodatée) | RGPD 9.2.a (consentement explicite) [45], CNIL : consentement « contextuel » [51] ; Apple 5.1.2(i) [52]. |
| Retrait | « Retirer » sur chaque photo, jamais limité ; ligne effacée (accès et moyen de déchiffrer perdus sur-le-champ), fichier effacé par l'iPhone puis, à défaut, par la purge | RGPD 7.3 (« aussi simple » que le donner) et 17 [46][48]. |
| Lien rompu | Clé étrangère vers `coach_links` on delete cascade : quitter, être retiré, supprimer un compte efface tout | Même règle que le poids, les mensurations et les messages. |
| Changement natif | **Aucun** : JS, SQL et une fonction serveur | Le module du coffre (trousseau iCloud, Face ID) suffit. C'est pourtant une **fonction nouvelle** : elle arrive aux utilisateurs par une build soumise et décrite dans la note d'examen, jamais par une mise à jour à chaud seule (règles 2.5.2 et 2.3.1(a), IOS.md). Elle est dans le paquet web de la build 67 et décrite dans la note d'examen (docs/REVUE_APPLE.md, section 2). |
| Désactivation | **Interrupteur du serveur** `app_config.coach_photos_on`, sans build ni OTA (voir « Éteindre la fonction ») | Réglage d'exploitation : couper l'envoi en cas d'abus, d'incident de sécurité ou de panne du stockage, sans attendre une build. Allumé dans la build examinée et décrit dans la note d'examen ; jamais éteint pour l'examen seulement (règle 2.5.19). |

### Comparatif : bout en bout ou chiffrement côté serveur

| | Côté serveur seulement (bucket privé, RLS, chiffrement au repos de Supabase) | De bout en bout (retenu) |
|---|---|---|
| Fuite du stockage ou d'une sauvegarde | Photos lisibles | Chiffré illisible |
| Clé serveur (`service_role`) volée, ou politique RLS mal écrite | Photos lisibles | Photos déjà envoyées : chiffré illisible. Photos suivantes : une clé substituée les rendrait lisibles, mais l'élève est prévenu du changement de clé avant d'envoyer |
| Personnel de Supabase, administrateur de MDLF | Photos lisibles | Chiffré illisible (sauf substitution active de clé, voir Limites) |
| URL signée qui fuit | Photo lisible 60 s | Chiffré illisible |
| Fichier oublié par la purge | Photo lisible | Illisible dès que la ligne est effacée (crypto-effacement) |
| Coût en complexité | Faible | Une clé par coach, déjà gérée par le module du coffre ; le reste est du WebCrypto standard |
| Nouvel iPhone du coach | Rien à faire | Le secret arrive par le trousseau iCloud ; s'il n'arrive pas, le coach recrée une clé et ses élèves renvoient |

Pour des photos en sous-vêtements, la ligne du milieu suffit à trancher : avec le chiffrement côté serveur, une erreur de
politique, une clé serveur qui fuit ou un accès au tableau de bord expose toutes les photos de tous les élèves. Avec le
bout en bout, il faut en plus une attaque active et ciblée sur la clé d'un coach, visible par le code de la clé.

## Niveau de protection réel

| Menace | Protégé ? |
|---|---|
| Fuite de la base, du stockage, d'une sauvegarde, d'une URL signée | Oui : du chiffré, sans la clé privée (elle n'est sur le serveur que chiffrée par le trousseau iCloud du coach). |
| Supabase, administrateur de MDLF qui **lit** | Oui. |
| Opérateur, ou jeton de session du coach volé, qui **remplace** la clé publique du coach | Pas pour les photos déjà envoyées (effacées avec l'ancienne clé). Pour les suivantes : l'élève qui a déjà envoyé est prévenu du changement et invité à comparer le code ; un premier envoi, lui, fait confiance à la clé reçue. Le coach le voit : à la relecture (clé autre que celle retenue sur son iPhone), et à l'ouverture, « La clé enregistrée sur le serveur n'est plus la tienne » (distinct de « Clé absente de cet iPhone »), avec le code de sa clé et « Republier ma clé ». Il n'est pas prévenu sur un iPhone où il n'a encore jamais ouvert ses photos, tant qu'il ne les ouvre pas. |
| Autre élève, ami, autre coach, ancien coach, coach dont le rôle est retiré | Oui (politiques et fonctions, tests SQL). |
| Code injecté dans l'app de l'élève ou du coach (dépendance piégée, iPhone débridé) | Non : il voit ce que l'app voit. Même limite que le coffre. |
| Le coach lui-même : capture d'écran, autre appareil qui photographie l'écran | Non. Pas de bouton pour enregistrer, appui long sans menu, flou dans le sélecteur d'apps ; une capture reste possible (iOS ne permet pas de l'empêcher à une app). Texte affiché au coach et dans la politique. |
| iPhone du coach déverrouillé, laissé à quelqu'un | Oui : Face ID (ou le code) à chaque ouverture des photos, refermées en arrière-plan et après une minute. |
| Localisation, appareil, heure dans la photo | Oui : photo redessinée, métadonnées vérifiées octet par octet avant le chiffrement (voir plus bas). |

## Stockage (Supabase), vérifié le 06/11/2026

- **Compartiment** créé en SQL (`insert into storage.buckets`, colonnes `public`, `file_size_limit` en octets,
  `allowed_mime_types` [1][2][3][4]), `public = false`.
- **Politiques** sur `storage.objects` (pour `authenticated`) : INSERT seulement sur le chemin d'une photo préparée par
  l'élève lui-même il y a moins d'une heure ; SELECT sur son propre dossier (le retrait par l'API demande SELECT et
  DELETE [6]) ou, pour le coach, sur une photo prête qui lui est destinée, encore coach ; DELETE sur son propre dossier ;
  **aucune UPDATE** (un envoi `upsert: false` ne demande qu'INSERT [6], un fichier ne peut pas être remplacé). Les deux
  fonctions des politiques sont dans le schéma `coach_photo_rls`, non exposé par l'API, où `authenticated` n'a que USAGE et
  EXECUTE sur elles ; jamais sur `private`.
- **Propriétaire** : `owner_id` vient du `sub` du jeton [7] ; la clé étrangère vers `auth.users` a été retirée par Supabase
  (migration 0017 [19]) : supprimer un compte ne supprime pas ses fichiers. D'où l'étape ajoutée à `delete-account`.
- **Suppression réelle** : un `DELETE` SQL sur `storage.objects` est refusé depuis le 28/01/2026 (`storage.protect_delete`,
  « Direct deletion from storage tables is not allowed. Use the Storage API instead. » [15][16]) et laissait avant un fichier
  orphelin [17]. Donc : la ligne est effacée en SQL (crypto-effacement immédiat), le chemin part dans
  `private.coach_photo_trash` (déclencheur), et l'API Storage efface le fichier : l'iPhone de l'élève au retrait et au
  départ, `delete-account` à la suppression du compte, et la fonction `coach-photos-purge` (clé serveur, chaque heure) pour
  tout le reste, y compris les envois pas aboutis (préparés depuis plus d'une heure) et les fichiers sans ligne.
- **CDN** : avec le Smart CDN (plan Pro), supprimer un objet invalide son cache en 60 s au plus [12] ; sur le plan gratuit,
  la durée n'est pas documentée [14]. L'app envoie `cacheControl: '60'` (au lieu de 3600 par défaut [6]). Ce cache ne
  contient que du chiffré.
- **Taille et coût** : 1 Mo par fichier (photo de 1080 px, 100 à 250 ko) ; 60 photos par élève au plus, soit 15 Mo au
  pire. Stockage inclus : 1 Go en gratuit, 100 Go en Pro puis 0,0213 $ par Go et par mois [22] ; sortie 5 + 5 Go
  (gratuit), 250 + 250 Go (Pro) [23]. 100 élèves à 60 photos : environ 1,5 Go.

## Métadonnées

- La photo du coffre est **redessinée** dans un `canvas` (côté long 1080 px), puis encodée en JPEG : le canvas ne garde que
  des pixels. Aucune source normative ne le garantit [35] : `jpegMetaFree` parcourt donc le JPEG produit, segment par
  segment jusqu'à la fin de l'image, et **refuse l'envoi** s'il reste autre chose que JFIF, le profil de couleur ou le
  segment Adobe (EXIF, XMP, IPTC, MPF, commentaire, octets après la fin de l'image, métadonnées entre deux passes). Le coach
  refait la même vérification sur la photo déchiffrée.
- Vérifié par `tests/test_photos_bilan.py` sur un vrai JPEG de 3024 × 4032 avec localisation GPS, fabricant et modèle :
  plus rien après (lu par `jpegMetaFree` et par Pillow), dans WebKit et Chromium.
- iOS retire déjà la localisation des photos de l'appareil photo choisies par un champ fichier, et, depuis iOS 17, laisse
  le choix dans le menu « Options » du sélecteur [36][37] : on ne s'y fie pas.

## RGPD et CNIL

- **Donnée sensible ?** Une photo n'est une donnée biométrique que traitée par un moyen technique d'identification
  (considérant 51) [39][40]. Mais une photo de corps, suivie dans le temps, à côté du poids et des mensurations, peut
  révéler l'état de santé (art. 4.15, considérant 35 ; CNIL : une donnée devient de santé « par croisement » [41][42] ; CJUE
  C‑184/20 sur les données sensibles déduites indirectement [43]). **On la traite comme une donnée de l'article 9.**
- **Base légale** : consentement explicite, photo par photo (art. 9.2.a) [45], horodaté sur le serveur, retirable aussi
  simplement qu'il est donné (art. 7.3) [46]. Minimisation (art. 5.1.c) [47] : pas de métadonnées, 1080 px, jour et pose
  seulement en clair, 60 photos au plus. Effacement (art. 17) [48] : retrait, lien rompu, compte supprimé.
- **Sous-traitant** : Supabase (DPA avec clauses contractuelles types [49], projet en Irlande [50]).
- **CNIL, applications mobiles** (08/04/2025) : données sensibles seulement si nécessaire et consenti, séparées techniquement
  des autres, consentement au moment de l'usage [51]. Les photos sont dans leur propre table et leur propre compartiment.
- **À faire par Maxence avant la mise en ligne** : inscrire le traitement au registre ; une analyse d'impact (AIPD) est à
  envisager (données sensibles, suivi régulier) ; conditions des coachs : ne pas copier, montrer ni publier les photos sans
  accord écrit séparé (contrats des coachs partenaires).

## Apple (règles du 16/10/2026 [52])

- 5.1.1(i) et (ii) : consentement, retrait facile, politique qui dit comment retirer et effacer : `privacy.html`, écran
  Mon coach › Photos de bilan. 5.1.1(iii) : sélecteur hors processus (champ fichier, déjà en place). 5.1.1(v) : la
  suppression du compte efface lignes et fichiers.
- 5.1.2(i) : partage avec un tiers (le coach) dit clairement et accepté avant ; 5.1.2(ii) : pas d'autre usage.
- 5.1.3 : données de forme « especially sensitive » : aucun usage publicitaire, rien dans iCloud (les photos vont chez
  Supabase, pas dans iCloud ; seul le secret de la clé est dans le trousseau iCloud, comme le coffre).
- 1.2 (contenu des utilisateurs) : l'élève n'envoie que ses propres photos à son coach ; le coach ne peut rien envoyer en
  retour par ce canal ; signalement et blocage existent déjà dans les messages.
- 5.1.1(ix) : une app qui traite des données sensibles devrait être publiée par une entité juridique, pas par un
  développeur individuel [52] : **point à vérifier** sur le compte Apple Developer.
- Étiquette de confidentialité : Apple ne dit rien des données chiffrées de bout en bout [53][54]. Par prudence,
  **déclarer « Photos or Videos »** (liées à l'utilisateur, fonctionnement de l'app, pas de suivi).

## Écrans

| Qui | Où | Touchers |
|---|---|---|
| Coach | Fiche de l'élève › « Recevoir les photos de bilan » (une fois pour tous ses élèves : Face ID, clé créée) | 1 |
| Élève | Coffre ouvert › « Envoyer à mon coach » sous un jour › (photo seule) « Envoyer cette photo » | **2** |
| Élève | Même chose, jour à plusieurs photos : cocher chaque photo (« Ton coach verra cette photo. Tu peux la retirer quand tu veux. » sous la photo cochée), « Envoyer 2 photos » | 2 + une par photo |
| Élève | Mon coach › Bilan › Photos de bilan › « Retirer » ; ou la photo dans le coffre › « Retirer de chez max » ; supprimer une photo envoyée du coffre la retire aussi de chez le coach | 2 |
| Coach | Fiche › Photos de bilan (Face ID d'emblée) : « Comparer » (deux dates en listes, côte à côte pose par pose, écart en jours), puis « Par date » ; toucher une photo l'agrandit | 1 |

- Premier envoi : « As-tu 18 ans ou plus ? » (une fois). Clé du coach changée depuis le dernier envoi : « La clé de ton
  coach a changé », avec le code à comparer, avant tout envoi.
- Coach : une photo agrandie a « Ne plus voir cette photo » (effacée de chez lui et du serveur) ; signaler passe par les
  messages (⋯ › Signaler).
- Coach, clé du serveur qui n'est plus la sienne : « La clé enregistrée sur le serveur n'est plus la tienne », code de sa
  clé, « Republier ma clé » (si sa clé s'ouvre sur cet iPhone) et « Créer une nouvelle clé… ». Sur la fiche de l'élève, la
  cellule le dit aussi, dès la relecture. Nouvelle clé : l'ancien secret n'est effacé du trousseau que s'il a été créé ou
  ouvert par cet iPhone depuis la connexion (jamais un identifiant donné par le seul serveur).
- Élève dont la tranche d'âge d'Apple n'est pas « 18 ans ou plus » : ni bouton d'envoi, ni question sur l'âge ; Mon coach ›
  Photos de bilan ne reste que s'il y a des photos à retirer.
- 3 photos par jour au plus. Rien de coché d'avance, jamais d'envoi groupé caché ni automatique.
- Coffre de l'élève refermé pendant la feuille d'envoi : la feuille se ferme, rien ne part. Photos du coach refermées en
  quittant l'écran, en arrière-plan, après une minute sans toucher : clé privée oubliée, images libérées, flou dans le
  sélecteur d'apps (`cph-shield`, et le flou natif du module).
- Textes : partout « Photos de bilan » ; « Retirer » (pas « Supprimer » : la photo reste dans le coffre).

## Serveur (migration 20261107000000_photos_bilan.sql)

| Fonction | Qui | Règles |
|---|---|---|
| `coach_photo_key()` | coach | Ma clé ou null ; `not_coach`. |
| `coach_photo_key_set(key_id, public_key, wrapped_key, wrap_iv, replace)` | coach | `invalid_key`, `key_exists` (sans `replace`), `replace` efface les photos de l'ancienne clé ; 10 par 24 h. |
| `student_photo_state()` | élève | `{ coach, ready, key: { key_id, public_key }, photos, per_day, max }`, jamais la clé enveloppée. |
| `student_photo_prepare(photo, key_id, taken_on, pose, epk, iv)` | élève | `not_found`, `not_ready`, `key_changed`, `not_adult`, `invalid_photo`, `too_many` (3 par jour, 60 en tout), `rate_limited` (30 par 24 h). |
| `student_photo_commit(photo)` | élève | Fichier présent au bon chemin, 32 o à 1 Mo, sinon `not_uploaded` ; préparation de plus d'une heure : `not_found`. |
| `student_photo_remove(photo)` | élève | Silencieux, jamais limité. |
| `student_photo_adult()` | élève | « 18 ans ou plus », une fois ; renvoie l'état. |
| `coach_photo_hide(photo)` | coach | Efface une photo reçue (même effet qu'un retrait) ; `not_found` si plus coach. |
| `coach_student_photos(student)` | coach | Photos prêtes de mon élève, pour ma clé ; `not_found`. |
| `srv_coach_photo_purge_claim(n)`, `srv_coach_photo_purge_done(paths)` | clé serveur | File de purge (voir Stockage). |

Photos éteintes (`app_config.coach_photos_on` autre que `true`) : `coach_photo_key`, `coach_photo_key_set`,
`student_photo_prepare`, `student_photo_commit` et `coach_student_photos` répondent `disabled` ; `student_photo_state`
renvoie `enabled: false`.

Toutes `security definer`, `search_path = ''`, utilisateur pris dans `auth.uid()`, GRANT explicites ; tables en RLS sans
politique ni GRANT.

**Serveur pas à jour** (`PGRST202`) : rien ne s'affiche, ni chez l'élève ni chez le coach (nouvel essai après 10 min).
**Coquille sans le module du coffre** (navigateur, Android) : rien côté coach ; côté élève, le coffre est déjà indisponible.

## Éteindre la fonction

Réglage d'exploitation (abus, incident de sécurité, panne du stockage) : un réglage du serveur coupe l'envoi, sans build
ni OTA. Il est décrit dans la note d'examen et reste allumé dans la build examinée (docs/REVUE_APPLE.md, section 6.2).
Éditeur SQL du projet (rôle `postgres`) :

```sql
update public.app_config set value = 'false'::jsonb, updated_at = now() where key = 'coach_photos_on';
```

Rallumer : la même ligne avec `'true'::jsonb`. Une valeur absente ou autre que `true` compte comme éteint. Livré
allumé par la migration. `app_config` est lisible par un compte connecté (pas par anon : seuls `paywall_on` et
`min_build` le sont).

| Qui | Éteint |
|---|---|
| Élève | Ni « Envoyer à mon coach » dans le coffre, ni question sur l'âge, ni code de la clé ; Mon coach › Photos de bilan ne reste que s'il a des photos déjà parties, avec « L'envoi de photos de bilan est suspendu pour l'instant. Tu peux retirer celles qui sont déjà parties. » Retrait toujours possible (RGPD 7.3 et 17). |
| Coach | Rien : ni « Recevoir les photos de bilan », ni la cellule de la fiche (`disabled` traité comme un serveur sans la fonction, nouvel essai après 10 min ; écran ouvert refermé). |
| Serveur | `disabled` pour la clé, la préparation, la validation et la liste du coach ; politiques Storage : plus de dépôt, plus de lecture par le coach (URL signée refusée) ; l'élève lit et efface encore son dossier ; la purge et `delete-account` continuent. Les photos déjà envoyées restent (chiffrées) jusqu'à leur retrait, au lien rompu ou au retour arrière. |

Effet à la prochaine relecture de l'app (ouverture d'un écran du coach) ; le serveur refuse dès la ligne SQL. Retirer
la fonction pour de bon : retour arrière (plus bas). Testé : `tests/unit/coach-photos.mjs` (interrupteur),
`tests/sql/photos_bilan_test.sql` (bloc « Interrupteur »), et sur le vrai projet jetable du 07/11 (voir « Essai sur un
vrai projet Supabase »).

## Mise en production (à faire par Maxence, rien n'a été appliqué)

0. **Essai sur un vrai projet Supabase : fait le 07/11/2026** (voir « Essai sur un vrai projet Supabase » plus bas). À
   refaire seulement si la migration change de nouveau.
1. `supabase/migrations/20261107000000_photos_bilan.sql` : seule migration de la vague 2 (`supabase/rollback/ORDRE.md`,
   « Vague 2 ») ; elle ne s'appuie que sur des migrations déjà en production, pas sur celles du payant.
2. Fonction : `supabase functions deploy coach-photos-purge` ; secret : `umask 077; openssl rand -hex 32 > ~/.config/mdlf/photos_purge_secret`,
   puis `supabase secrets set PHOTOS_PURGE_SECRET="$(cat ~/.config/mdlf/photos_purge_secret)"`.
3. Planification (éditeur SQL, `pg_cron` et `pg_net` déjà activés pour les notifications, docs/BUILD.md) :
   `select vault.create_secret('<valeur>', 'photos_purge_secret');` puis
   `select cron.schedule('coach-photos-purge', '17 * * * *', $$ select net.http_post(url := 'https://yopptmdjtnezmccdvaxf.supabase.co/functions/v1/coach-photos-purge', headers := jsonb_build_object('x-purge-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'photos_purge_secret'))) $$);`
4. `supabase functions deploy delete-account` (compte supprimé d'abord, puis ses fichiers : si la suppression échoue, rien
   n'est effacé, aucune photo « prête » ne reste sans fichier ; fichiers pas effacés : la purge s'en charge).
5. Étiquette de confidentialité d'App Store Connect : ajouter « Photos or Videos » (liées à l'utilisateur, fonctionnement
   de l'app, pas de suivi) **avant la build** : dès qu'elle est installée, l'app envoie des photos, l'étiquette doit déjà
   le dire.
6. La build qui embarque la fonction (fonction nouvelle : jamais une mise à jour à chaud seule, IOS.md, « Règle Apple »), décrite dans
   la note d'examen. Une app d'avant sur ce serveur ne voit rien de nouveau ; cette app sur un serveur d'avant n'affiche rien.
7. Avant 1. : vérifier qu'aucune politique du tableau de bord sur `storage.objects` ne s'ajoute aux nôtres (les politiques permissives s'additionnent : une politique INSERT ou UPDATE sans filtre `bucket_id` rouvrirait le remplacement d'un fichier) :
   `select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects';`
   et que les schémas exposés de l'API (tableau de bord, Data API) ne comprennent pas `coach_photo_rls`.

Arrêt : `select cron.unschedule('coach-photos-purge');`. Retour arrière : `supabase/rollback/20261107000000_photos_bilan_down.sql`
après avoir vidé le compartiment par l'API (il refuse sinon) ; indépendant des autres. Il retire lui-même la tâche
`coach-photos-purge` et le secret Vault `photos_purge_secret` ; restent à la main `supabase functions delete coach-photos-purge`
et `supabase secrets unset PHOTOS_PURGE_SECRET`.

## Essai sur un vrai projet Supabase (07/11/2026)

Projet jetable `mdlf-essai-photos` (plan gratuit, eu-west-1, Postgres 17.11, GoTrue 2.197), créé par l'API de gestion
puis **supprimé** à la fin ; la production n'a pas été touchée. Toutes les migrations de `main` sauf Strava, puis
celle-ci, appliquées par `POST /v1/projects/{ref}/database/query` (rôle `postgres`) ; `coach-photos-purge` et
`delete-account` déployées (`supabase functions deploy --project-ref <projet jetable> --use-api`), secret
`PHOTOS_PURGE_SECRET` tiré au hasard. Comptes factices `@example.com` créés par l'API d'administration, vrais jetons,
vraie API Storage. **90 contrôles, tous verts** :

- Clé publiée par le coach ; état de l'élève (clé du coach, jamais la clé enveloppée) ; `not_adult` avant la déclaration.
- Envoi : `not_uploaded` sans fichier ; dépôt refusé au coach, sur un chemin non préparé, en double et en remplacement
  (`x-upsert: true`) ; dépôt de l'élève accepté avec son jeton. **`metadata->>'size'` est bien rempli par Storage**
  (150000) et `student_photo_commit` l'accepte ; `cacheControl` enregistré `max-age=60`.
- Lecture : URL signée du coach, contenu identique au chiffré envoyé ; **refus** pour un 2e coach non lié (URL signée,
  téléchargement, liste) et pour un anonyme (URL signée, téléchargement, RPC, URL publique) ; coach dont le rôle est
  retiré : URL signée refusée, rendue avec le rôle. Le coach ne peut pas effacer le fichier.
- Retrait par l'élève : URL signée du coach refusée aussitôt, chemin en file ; `coach-photos-purge` : 401 avec un mauvais
  secret, fichier effacé avec le bon ; envoi pas abouti (plus d'une heure) et fichier sans ligne effacés aussi ;
  `DELETE` SQL direct sur `storage.objects` refusé (`protect_delete`). Lien rompu : lignes effacées, l'élève liste et
  efface son dossier par l'API.
- Planification réelle : `pg_net` activé, `vault.create_secret`, `cron.schedule`, commande de la tâche lancée à la main :
  `postgres` lit `vault.decrypted_secrets`, la purge répond 200 à `pg_net`.
- `delete-account` : refusé sans connexion récente ; accepté après connexion par code e-mail (`amr` otp) ; compte
  supprimé, lignes effacées, fichiers effacés par la fonction elle-même.
- Retour arrière : refusé tant qu'il reste un fichier ; puis compartiment, politiques, schéma `coach_photo_rls`, tâche
  pg_cron, secret Vault et interrupteur retirés ; il passe aussi sans tâche ni secret ; la migration remonte ensuite.
- Interrupteur éteint par une ligne SQL : `enabled: false`, préparation, dépôt, validation, clé et liste du coach
  refusés, URL signée du coach refusée ; l'élève lit, retire et efface encore ; la purge continue.

Les trois hypothèses de la relecture, vérifiées :

1. **Politiques de `storage.objects` créées par le rôle de migration** : oui. `storage.objects` appartient à
   `supabase_storage_admin`, mais la migration lancée en `postgres` crée les trois politiques sans erreur (vues dans
   `pg_policies`), et le vrai Storage les applique.
2. **Droits de `postgres` sur `storage.objects`** : INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER (un
   `DELETE` reste bloqué par `protect_delete`, levé par `storage.allow_delete_query` dans le retour arrière, qui passe).
3. **Suppression dans `vault.secrets`** : `postgres` a SELECT et DELETE ; le retour arrière retire bien
   `photos_purge_secret`.

Rien d'autre n'a cassé ; l'essai a seulement conduit à ajouter l'interrupteur (« Éteindre la fonction »).

## Tests

- `tests/sql/photos_bilan_test.sql` : droits, compartiment, politiques (envoi, lecture, effacement par qui), clé, bornes,
  retrait, rôle retiré, lien rompu, clé changée, purge, compte supprimé. Dans `run.sh`, `prod_order_test.sh`,
  `rollback_nuit_check.sh` (seul, puis tous les autres tests verts) et `upgrade_test.sh`. `supabase_stub.sql` imite
  `storage.buckets`, `storage.objects` et leur verrou `protect_delete`. `tests/sql/photos_bilan_rollback_test.sh` : retour
  arrière qui retire la tâche pg_cron et le secret Vault de la purge (imités), sans toucher aux autres, et passe sans eux.
- `tests/unit/coach-photos.mjs` : métadonnées (EXIF, XMP, IPTC, commentaire, octets après la fin, entre deux passes),
  clé du coach (chiffrée, rouverte, substitution repérée), chiffrement (clé neuve par photo, données liées, autre clé),
  nettoyage des réponses ; tranche d'âge d'Apple (envoi et déclaration refusés) ; clé retenue dès la première photo partie,
  celle qui a chiffré, par compte, gardée à la déconnexion ; coach : secret absent ou clé qui n'est plus la sienne,
  alerte à la relecture, « Republier ma clé », session refermée si la clé publique change, ancien secret effacé seulement
  s'il a servi ici. `tests/unit/coach-photos-purge.mjs` : secret, chemins, tour de purge ; ordre de `delete-account`.
- `tests/test_photos_bilan.py` : parcours complet coach et élève dans deux pages, captures clair et sombre.

## Limites de la V1

- Substitution active de clé par l'opérateur du serveur : seulement détectable par le code de la clé (voir plus haut).
- Capture d'écran par le coach : impossible à empêcher.
- Coach qui perd le secret de son trousseau (trousseau iCloud désactivé, nouvel iPhone) : il recrée une clé, ses photos
  reçues sont effacées, les élèves les renvoient.
- Premier envoi : l'élève fait confiance à la clé que le serveur lui donne (pas d'annuaire de clés vérifiable) ; le code de la clé permet de vérifier.
- L'âge est déclaré, pas vérifié, quand la tranche d'âge d'Apple est inconnue (iOS antérieur au 26, refus de la partager,
  tranche pas encore demandée : elle l'est à l'ouverture de l'onglet Social).
- Pas de message dans le fil coach-élève quand la clé du coach change (l'élève est prévenu à son envoi suivant).
- Pas de notification au coach quand une photo arrive (il la voit en ouvrant la fiche) ; pas de rappel « bilan à faire ».
- 60 photos par élève : au-delà, l'élève retire d'anciennes photos.
- Un secret de 32 octets reste dans le trousseau iCloud du coach après la suppression de son compte (inutilisable : la clé
  chiffrée est effacée du serveur).
- Le Swift n'est pas modifié ; le module du coffre est utilisé tel quel, avec un autre identifiant.

## Sources

Recherche du 06/11/2026.

1. Supabase, *Creating buckets* : https://supabase.com/docs/guides/storage/buckets/creating-buckets
2. supabase/storage, migration 0008 (public) : https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0008-add-public-to-buckets.sql
3. supabase/storage, migration 0013 (limites) : https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0013-add-bucket-custom-limits.sql
4. supabase/storage, migration 0014 (octets) : https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0014-use-bytes-for-max-size.sql
5. Supabase, *Storage access control* : https://supabase.com/docs/guides/storage/security/access-control
6. supabase-js, `StorageFileApi.ts` (droits demandés par chaque appel, `cacheControl`) : https://github.com/supabase/supabase-js/blob/master/packages/core/storage-js/src/packages/StorageFileApi.ts
7. Supabase, *Ownership* : https://supabase.com/docs/guides/storage/security/ownership
10. Supabase, `createSignedUrl` : https://supabase.com/docs/reference/javascript/storage-from-createsignedurl
11. Supabase, *Serving downloads* (révocation) : https://supabase.com/docs/guides/storage/serving/downloads
12. Supabase, *Smart CDN* : https://supabase.com/docs/guides/storage/cdn/smart-cdn
14. Supabase, *CDN fundamentals* : https://supabase.com/docs/guides/storage/cdn/fundamentals
15. supabase/storage, migration 0055 (`protect_delete`) : https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0055-prevent-direct-deletes.sql
16. Historique de la migration 0055 (28/01/2026) : https://github.com/supabase/storage/commits/master/migrations/tenant/0055-prevent-direct-deletes.sql
17. Supabase, *Delete objects* : https://supabase.com/docs/guides/storage/management/delete-objects
19. supabase/storage, migration 0017 (clé étrangère du propriétaire retirée) : https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0017-drop-owner-foreign-key.sql
22. Supabase, *Storage pricing* : https://supabase.com/docs/guides/storage/management/pricing
23. Supabase, *Egress* : https://supabase.com/docs/guides/platform/manage-your-usage/egress
24. Supabase, *Security* (AES-256 au repos) : https://supabase.com/security
25. MDN, *SubtleCrypto* : https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
26. MDN browser-compat-data : https://unpkg.com/@mdn/browser-compat-data@latest/data.json
27. Igalia, X25519 dans WebKit : https://blogs.igalia.com/jfernandez/?p=1913
29. WebKit, bug 177350 (`CryptoKey` en IndexedDB) : https://bugs.webkit.org/show_bug.cgi?id=177350
32. Capacitor, *Storage* (IndexedDB repris par iOS) : https://capacitorjs.com/docs/guides/storage
35. Exemple de retrait d'EXIF par canvas (source tierce) : https://orthogonal.info/how-to-strip-exif-data-from-photos/
36. WebKit, bug 257534 (GPS retiré, iOS 16.4) : https://bugs.webkit.org/show_bug.cgi?id=257534
37. WebKit, bug 263192 (menu « Options » d'iOS 17) : https://bugs.webkit.org/show_bug.cgi?id=263192
39. RGPD, considérant 51 : https://gdpr-info.eu/recitals/no-51/
40. RGPD, article 4 : https://gdpr-info.eu/art-4-gdpr/
41. RGPD, considérant 35 : https://gdpr-info.eu/recitals/no-35/
42. CNIL, *Qu'est-ce qu'une donnée de santé ?* : https://www.cnil.fr/fr/quest-ce-ce-quune-donnee-de-sante
43. Covington, CJUE C‑184/20 (commentaire, l'arrêt n'a pas pu être lu) : https://www.insideprivacy.com/eu-data-protection/special-category-data-by-inference-cjeu-significantly-expands-the-scope-of-article-9-gdpr/
45. RGPD, article 9 : https://gdpr-info.eu/art-9-gdpr/
46. RGPD, article 7 : https://gdpr-info.eu/art-7-gdpr/
47. RGPD, article 5 : https://gdpr-info.eu/art-5-gdpr/
48. RGPD, article 17 : https://gdpr-info.eu/art-17-gdpr/
49. Supabase, DPA : https://supabase.com/legal/dpa
50. Supabase, régions : https://supabase.com/docs/guides/platform/regions
51. CNIL, recommandations applications mobiles : https://www.cnil.fr/fr/recommandations-applications-mobiles
52. Apple, *App Review Guidelines* : https://developer.apple.com/app-store/review/guidelines/
53. Apple, *App privacy details* : https://developer.apple.com/app-store/app-privacy-details/
54. Apple Developer Forums, données chiffrées de bout en bout et étiquette (sans réponse) : https://developer.apple.com/forums/thread/710456
55. Meta, *WhatsApp key transparency* : https://engineering.fb.com/2023/04/13/security/whatsapp-key-transparency/
56. transparency.dev, *Strengthen discovery of encryption keys* : https://transparency.dev/application/strengthen-discovery-of-encryption-keys/
57. Signal, *Safety number updates* : https://signal.org/blog/safety-number-updates/
