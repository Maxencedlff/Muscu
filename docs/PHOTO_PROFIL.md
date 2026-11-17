# Photo de profil

Demande de Maxence (16/11/2026) : « ajoute une fonction payante pour les gens de mettre une vraie photo de profil, et
gratuite pour les coachs ». Branche `photo-profil`. **Rien n'est en production** : migration, fonctions Edge, compartiment
et OTA attendent son feu vert (« Mise en production » plus bas).

Code : `js/data/profile-photo.js` (image, appels, lecture des photos des autres, sans écran), `js/features/profile-photo-ui.js`
(cellule de Réglages › Compte, feuille, « Signaler la photo »), `avatarHtml` (`js/features/account-ui.js`, photo posée
par-dessus l'emoji), `proFeatureAllowed` (`js/data/access.js`), styles en fin de `css/account.css`. Serveur :
`supabase/migrations/20261117000000_photo_profil.sql` et son retour arrière `supabase/rollback/20261117000000_photo_profil_down.sql`,
`supabase/functions/coach-photos-purge/index.ts` (deuxième compartiment), `supabase/functions/delete-account/index.ts`.
Tests : `tests/unit/profile-photo.mjs`, `tests/sql/photo_profil_test.sql`, `tests/sql/photo_profil_rollback_test.sh`,
`tests/sql/prod_order_test.sh` (étape 7), `tests/deno/edge.test.ts`, `tests/test_photo_profil.py` (faux serveur et faux
stockage dans `tests/fake_account.py`).

## Décisions

| Question | Décision | Pourquoi |
|---|---|---|
| Prix | **Comprise dans MDLF Pro**, aucun achat à part ; **offerte aux coachs** dont le rôle est actif | Décision de Maxence : pas de nouveau produit App Store, pas de nouvel examen d'achat intégré. |
| Droit | Une seule règle : `private.pro_feature(uid)` côté serveur = `access_json(uid) ->> 'can_write'` (le droit d'enregistrer une séance) **ou** `private.is_coach(uid)` ; côté app `proFeatureAllowed()` = `canWrite()` ou coach. Aucune autre logique de droit dans la photo (test unitaire) | « Même fonction de droit que les autres fonctions Pro ». Verrou éteint : `can_write` toujours vrai, donc ouvert à tous ; l'app l'affiche quand même « Pro ». |
| Droit perdu | Photo gardée mais **plus montrée** aux autres (ni liste ni URL signée) ; l'utilisateur la voit avec un mot et peut la retirer | Pas d'effacement silencieux d'un fichier qu'il a choisi ; elle revient s'il se réabonne. Voir « Points ouverts ». |
| Image | Carré **central**, 512 px au plus, WebP si l'appareil sait l'encoder, sinon JPEG ; qualité baissée de 0,82 à 0,42 jusqu'à 64 ko (256 ko au plus) | WebKit (iPhone) n'encode pas le WebP par `canvas.toBlob` (il rend du PNG) : JPEG en pratique, vers 30 à 60 ko. Redessinée par un canvas : **aucune métadonnée** (lieu, appareil) ne part ; vérifié sur un vrai JPEG avec GPS (test E2E, Pillow). |
| Recadrage | Centre, avec aperçu avant l'envoi (« Utiliser cette photo » / « Choisir une autre photo ») | Le plus simple qui reste juste ; un recadrage à la main (pincer, glisser) est une piste, pas nécessaire pour une pastille ronde. |
| Choix | `<input type="file" accept="image/*">` hors de `#app`, ouvert dans le geste (un seul toucher) : la feuille d'iOS « Prendre une photo / Photothèque » | Comme le coffre à photos ; clés `NSCameraUsageDescription` et `NSPhotoLibraryUsageDescription` déjà dans la build. |
| Stockage | Compartiment **privé** `profile-photos`, 256 ko, `image/jpeg` ou `image/webp`, chemin `<compte>/<photo>` ; aucune politique UPDATE | Jamais d'URL publique ; une nouvelle photo a un nouveau chemin (pas d'image en cache qui resterait l'ancienne). |
| Qui la voit | Moi ; un ami **accepté dans un sens ou dans l'autre** (`private.can_see` : social activé des deux côtés, aucun blocage) ; mon coach ; mes élèves | La demande : « visible seulement des amis acceptés et du coach lié ». Une seule fonction, `private.profile_photo_visible`, pour la liste et pour la politique du fichier. |
| Lecture | `profile_photos(uids)` (200 comptes par appel, regroupés par écran) puis URL signée de **30 min**, lue aussitôt, image gardée en mémoire (`blob:`), jamais sur le disque | Une URL signée ne se révoque pas : 30 min bornent ce qu'une URL copiée donne après un retrait. |
| Repli | L'image est posée **par-dessus** l'emoji ou l'initiale : pas encore lue, hors ligne, illisible (`error`) → l'emoji reste visible, sans saut de mise en page | Demande : « repli sur l'emoji ou l'initiale si l'image ne charge pas ». |
| Effacement | Retour à l'emoji (`profile_photo_remove`), nouvelle photo, compte supprimé (cascade), modération : ligne effacée (plus personne ne peut demander d'URL), fichier en file `private.profile_photo_trash`, effacé par `coach-photos-purge` (même planification horaire) ; retiré aussi tout de suite par l'app (retrait) et par `delete-account` | Même mécanique que les photos de bilan (le SQL ne peut pas effacer un fichier du stockage). |
| Interrupteur | `app_config.profile_photos_on` | Couper en cas d'abus sans build ni OTA. |
| Limites | 10 préparations par 24 h ; préparation non envoyée effacée après 1 h | Empêche de remplir le stockage. |

## Règle App Store 1.2 (contenu des utilisateurs)

Texte : « Apps with user-generated content … must include: a method for filtering objectionable material from being
posted to the app; a mechanism to report offensive content and timely responses to concerns; the ability to block abusive
users from the service; published contact information so users can easily reach you »
([guidelines](https://developer.apple.com/app-store/review/guidelines/#user-generated-content)). Le texte ne prévoit
**aucune exception** pour un cercle restreint : une photo envoyée puis vue par d'autres comptes est du contenu d'utilisateur.

| Exigence | Couverture |
|---|---|
| Filtrage | Audience fermée (seulement amis acceptés et coach, jamais public, jamais dans la recherche) ; règle affichée au choix (« Pas de nudité ni d'image choquante : une photo signalée est masquée ») ; masquée pour tous au **2e signalant distinct** (déclencheur sur `reports`) ; interdiction par compte (`ban`) ; interrupteur global. **Aucun filtre automatique de l'image** : voir « Modération ». |
| Signalement et réponse rapide | « Signaler la photo » sur le profil d'un ami (fonction Edge `report` existante, `kind 'profile'`, `target_ref 'photo:<id>'`, motifs : nudité, violence, haine, « Ce n'est pas cette personne », autre) ; alerte e-mail dès le 1er signalement (déjà en place) ; masquée aussitôt chez celui qui signale ; engagement de 24 h déjà affiché ; décision par `private.profile_photo_moderate`. |
| Blocage | « Bloquer » existant, proposé juste après le signalement ; un blocage coupe la photo dans les deux sens (`can_see`). Coach : quitter ou retirer l'élève. |
| Contact | contact@mdlf.app (privacy.html, règles de la communauté, messages d'erreur). |

## Modération

| Moyen | Sans build ? | Ce qu'il fait | Limite |
|---|---|---|---|
| Audience fermée, signalement, masquage au 2e signalant, `ban`, interrupteur | **Oui** (fait) | Couvre signalement, blocage, réponse rapide | Réagit après coup : une image choquante est vue par quelques amis avant d'être signalée. |
| Modèle sur l'appareil dans la WebView (nsfwjs, TensorFlow.js) | Oui | Classe Neutral / Drawing / Sexy / Porn / Hentai, environ 90 à 93 % de justesse ([nsfwjs](https://github.com/infinitered/nsfwjs)) | 2,6 à 3,5 Mo de modèle plus TensorFlow.js dans l'app ; se contourne (l'envoi passe par l'API) : jamais seul. |
| API de modération appelée par le serveur avant `commit` (OpenAI omni-moderation, gratuite, images jusqu'à 20 Mo ; AWS Rekognition `DetectModerationLabels` ; Google SafeSearch) | Oui (une fonction Edge et un secret) | Vrai filtre avant publication, impossible à contourner par l'app | Un sous-traitant de plus reçoit la photo (privacy.html et registre RGPD à mettre à jour) ; payant hors OpenAI ([OpenAI](https://developers.openai.com/api/docs/guides/moderation), [AWS](https://docs.aws.amazon.com/rekognition/latest/dg/moderation.html), [Google](https://docs.cloud.google.com/vision/docs/detecting-safe-search)). |
| `SensitiveContentAnalysis` (iOS 17+) | **Non : build** (module natif et droit `com.apple.developer.sensitivecontentanalysis.client`) | Détecte la nudité sur l'appareil ; peut flouter la photo d'un ami chez celui qui regarde | Ne marche **que si l'utilisateur a activé** « Avertissement de contenu sensible » ou la Sécurité des communications (sinon `analysisPolicy == .disabled`), et Apple interdit d'envoyer hors de l'appareil le résultat de l'analyse ([doc](https://developer.apple.com/documentation/sensitivecontentanalysis/detecting-nudity-in-media-and-providing-intervention-options)) : ce n'est **pas** un filtre de modération. |

Recommandation : la V1 telle quelle répond à la lettre de la 1.2 par l'audience fermée et le signalement ; si l'équipe
d'examen demande un « filtre », la réponse la plus sûre et sans build est l'API de modération côté serveur, appelée dans
`profile_photo_commit` (via une fonction Edge), à décider par Maxence (sous-traitant de plus).

## RGPD et CNIL

- Une photo n'est **pas** en soi une donnée biométrique : « The processing of photographs should not systematically be
  considered to be processing of special categories of personal data » ([considérant 51](https://gdpr-info.eu/recitals/no-51/)) ;
  elle le devient seulement traitée par un moyen technique spécifique d'identification ([article 4.14](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre1)).
  Donc : **aucune reconnaissance ni comparaison de visage**, ni chez nous ni chez un tiers.
- Base légale : **consentement** (article 6.1.a), geste actif d'envoi, retrait aussi simple (« Retirer la photo ») ;
  minimisation (article 5.1.c : une photo, 512 px, sans métadonnées) ; conservation limitée (5.1.e : effacée au retrait,
  au remplacement, à la suppression du compte) ; effacement (article 17).
- Droit à l'image (article 9 du Code civil, [CNIL](https://www.cnil.fr/fr/demander-le-retrait-de-votre-image-en-ligne)) :
  motif « Ce n'est pas cette personne » au signalement, et « Ne mets que ta propre photo » dans privacy.html.
- privacy.html (FR et EN) mis à jour : section Compte, `#photo-profil`.

## Mise en production (à faire par Maxence, rien n'a été appliqué)

L'ordre compte : serveur d'abord, l'app ensuite. Une app sur un serveur sans la migration n'affiche rien (PGRST202) ; une
app d'avant sur le serveur à jour ne voit rien de nouveau.

1. Migration `supabase/migrations/20261117000000_photo_profil.sql` (éditeur SQL ou `supabase db push`). Elle ne s'appuie
   que sur ce qui est déjà en production (`20261028000000_payant.sql`, social, coach) : vérifié par
   `tests/sql/prod_order_test.sh`, étape 7 (seule sur la production de départ, tests verts, retour arrière à l'identique).
2. Data API › Exposed schemas : vérifier que `profile_photo_rls` n'y est **pas** (comme `coach_photo_rls`).
3. Fonctions : `supabase functions deploy coach-photos-purge` puis `supabase functions deploy delete-account`.
   La purge doit être déployée **après** la migration (sinon chaque passage horaire signale un échec sur le deuxième
   compartiment ; les photos de bilan restent purgées). Si la planification `coach-photos-purge` n'existe pas encore
   (photos de bilan pas en production), la poser comme dans docs/PHOTOS_BILAN.md, « Mise en production », étapes 2 et 3.
4. Étiquette de confidentialité d'App Store Connect : « Photos ou vidéos » est déjà déclarée pour les photos de bilan
   (liée à l'utilisateur, fonctionnement de l'app) ; vérifier qu'elle l'est, sinon l'ajouter avant la build.
5. **Livraison par une build soumise, pas par une mise à jour à chaud seule** (IOS.md, « Règle Apple » : fonction
   nouvelle, nouvelle donnée envoyée) : fusionner `photo-profil` dans `main`, build TestFlight puis App Store, décrite
   dans « What to Test » et la note d'examen (docs/REVUE_APPLE.md), avec un compte de démonstration qui a un ami avec
   photo. Dans la même build (69, branche `serveur-1711`) : les textes `NSCameraUsageDescription` et
   `NSPhotoLibraryUsageDescription` d'Info.plist nomment la photo de profil (test : `tests/unit/profile-photo.mjs`).
6. Retour arrière : `supabase/rollback/20261117000000_photo_profil_down.sql` (en-tête : vider le compartiment d'abord).

Administration : signalements de photos `select … from public.reports where target_ref like 'photo:%'` ; voir la photo dans
Storage › profile-photos ; décider `select private.profile_photo_moderate('<photo>', 'remove' | 'restore' | 'ban', 'note');`.

## Points ouverts

- **Filtre automatique** : aucun en V1 (voir « Modération »).
- **Droit perdu** : la photo reste stockée tant que l'utilisateur ne la retire pas (elle n'est plus montrée). Option :
  l'effacer après 30 jours sans droit (purge).
- **Coach dont le rôle est retiré** : il garde sa photo seulement s'il a un abonnement ; sinon elle n'est plus montrée.
- **Élèves d'un coach** : la photo d'un élève non abonné n'est pas offerte (verrou allumé) ; seul le coach l'a gratuite.
