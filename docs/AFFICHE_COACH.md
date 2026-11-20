# Affiche du coach et photo de profil des comptes avec accès

Demande de Maxence (20/11/2026) : « je veux que chaque coach puisse mettre une vraie photo de profil et générer son
affiche », puis « pour les élèves qui paient, on peut aussi ». Branche `affiche-coach`. Aucun changement serveur.

## Photo de profil : qui peut la mettre

Règle unique, déjà en place (docs/PHOTO_PROFIL.md) : `private.pro_feature(uid)` côté serveur, `proFeatureAllowed()` côté
app = droit d'écrire du payant (`access_json ->> 'can_write'`) **ou** rôle coach (`private.is_coach`). Vérifié dans
`20261116030000_eleves_gratuits.sql` (dernière définition de `access_json`) :

| Compte | Pourquoi il a la photo | Mention dans l'app |
|---|---|---|
| Abonné (payé lui-même, essai d'Apple compris) | statut `active` → `can_write` | « Pro », « Comprise dans MDLF Pro » |
| Coach au rôle validé, avec ou sans abonnement coach, essai compris | `is_coach` (et `active` s'il est abonné) | « Offerte aux coachs » |
| Élève couvert par l'offre de son coach (offre en cours ou 7 jours de grâce) | statut `coach_team` → `can_write` | « Offerte par ton coach » |
| Sans accès (verrou allumé) | aucun | écran d'abonnement ; l'emoji ou l'initiale reste |

Le serveur accepte déjà les trois cas : **aucune migration à écrire**. Seule la mention change dans l'app
(`pphFree`, js/features/profile-photo-ui.js), jamais le droit. La migration `20261117010000_photo_profil.sql` attend
toujours son feu vert (docs/PHOTO_PROFIL.md, « Mise en production »).

## Affiche : « photo ronde » sur fond noir (20/11)

Une seule mise en page et un seul fond, le noir : titre énorme (NOUVEAU COACH, NOUVELLE COACH ou COACH), photo ronde
cerclée d'un trait orange plein, le personnage 3D **en entier** derrière (corps entier, bras de chaque côté, jambes
jusqu'en bas, à la taille et au cadrage du concept v2 gardé par Maxence), muscles rouge vif, au plus 10 %
d'assombrissement uniforme ; nom, « @pseudo », badge « Carte pro déclarée », puis le code en noir
sur l'orange plein (« Télécharge MDLF Training et entre mon code ») ; « Programme · Suivi · Messages » en décor en bas.
Rendus : `~/.local/share/mdlf/panel/affiche-coach/v6/` (`comparaison.png` : v2 et v6 côte à côte, `contrastes.json`).

**4e panel (8,4/10, 12 juges sur 40), corrigé en v11** (`v11/`, `comparaison.png` : v10 et v11) : la photo du coach
domine (560 px au moins en story, 46 % de la largeur en carré, juste sous le titre) ; le personnage, entier et aux mêmes
couleurs, passe second (34 à 36 % de la largeur, à gauche) ; tout entre 250 et 1600 px, signature au-dessus de la barre
de réponse. Code en SF Pro Display Heavy (« VV » et « W », « 5 » et « S » bien distincts), jamais coupé au tiret dans
Mes élèves. Sans nom, « Partager » est grisé (« Ajoute ton nom pour partager ton affiche », un lien qui amène au champ Nom), plus d'initiales tirées
du pseudo ; spécialité facultative (40 caractères, sous le nom). Silhouette femme : les faisceaux moyen et bas du grand
pectoral restent au gris (voir plus bas). Compte : avec une photo, la ligne Avatar disparaît (« Changer l'avatar » est
dans la feuille de la photo). Feuille : Silhouette juste sous Story / Carré, aperçu à 30 % de la hauteur sur les petits
écrans ; « Utiliser cette photo » fixé en bas de la feuille de la photo de profil.

**5e panel (8,05/10), corrigé en v12** (`v12/`, `comparaison.png` : v11 et v12) : carte du code coach (une seule,
`coachCodeCellHtml`, dans Mes élèves › Invitations et Réglages › Coach) qui tient toujours en entier : sa taille suit la
largeur de la carte (`cqi`, plancher de 17 px), et plus étroit encore elle passe à la ligne entre blocs entiers
(« BM5T-PRZF- » / « 3VV3 »), sous-titre à la ligne (test E2E en AX33 sur iPhone SE). Story : le bloc remplit la zone
sûre, le titre et la photo prennent la place libre (badge sur la ligne du pseudo quand elle tient ; « Sur MDLF
Training » s'efface alors, l'appel et la signature le disent). Feuille : Nom en premier ; « Ajoute ton nom pour partager
ton affiche » au-dessus de « Partager », un lien qui amène au champ et l'active ; aperçu à 22 % de la hauteur en très
grand texte. Photo de profil en très grand texte : une phrase courte, la règle repliée dans « Ce qui est permis ».

**6e panel ciblé (8,56/10), corrigé en v13** (`v13/`) : spécialité sous son libellé, sur plusieurs lignes, jamais
tronquée ; Compte : une seule ligne « Photo de profil » (valeur Photo, Avatar ou Aucune), sa feuille propose « Choisir
une photo » (MDLF Pro sans accès) et « Choisir un avatar » ; nom long sur deux lignes (prénom puis nom), 64 px d'air de
chaque côté dans sa colonne ; plus de « · Sur MDLF Training » sous le nom (l'appel et la signature le disent), badge sur
la ligne du pseudo en story comme en carré, 20 px au moins au-dessus du code en carré ; aperçu à 18 % sur petit écran
aux plus grandes tailles de texte ; carte du code : Copier et Partager passent sous le code avant qu'il ne se coupe.
Personnage jusqu'à 1780 px demandé : pas fait, il est limité par la largeur de sa colonne (environ 350 px de large pour
790 px de haut) ; atteindre 1780 px demanderait environ 550 px de large, donc de passer sous la photo ou sous le code.

**7e panel ciblé (8,69/10), corrigé en v14** (`v14/`) : story centrée, autant de noir au-dessus qu'en dessous (zone sûre
250 à 1670 px : 250 px laissés en haut et en bas) ; sous la spécialité, ce que l'élève gagne (« Programme sur mesure ·
Suivi · Bilans », blanc secondaire) ; bandeau : « Télécharge MDLF Training », le code, « Entre mon code dans Social ›
Rejoindre un coach » ; carré : bandeau sur toute la largeur en bas, consignes et badge de 26 px au moins, signature
sous le personnage, photo de 34 à 46 % de la largeur ; aperçu : Story / Carré après les réglages (Nom et Silhouette
entiers sans défiler sur iPhone SE), pastille « agrandir » ; rond vide de l'aperçu (ni photo ni nom) : appareil photo
et « Ta photo ici », jamais sur l'image partagée (qui demande un nom, donc ses initiales) ; Compte : vignette ronde de
la photo sur la ligne « Photo de profil » ; « Photo de profil enregistrée » retiré au changement d'écran ; Mon coach en
très grand texte : avatar au-dessus du nom, pseudo coupé après « _ » ou « . ».

**Mon coach** : l'élève voit le nom de l'affiche de son coach en titre, @pseudo dessous, et sa photo de profil s'il en
a mis une. Le nom part au serveur seulement quand le coach **partage** son affiche (dit sous les réglages :
« Quand tu partages ton affiche, tes élèves voient ton nom dans Mon coach ») ; `coach_poster_name(coach)` ne le rend
qu'au coach et à ses élèves, rien en cas de blocage. Migration `supabase/migrations/20261120020000_nom_affiche_coach.sql`
**écrite, pas appliquée** (feu vert de Maxence), retour arrière dans `supabase/rollback/`. Sans elle, Mon coach garde
le pseudo seul et le partage marche.

**Rejoindre en un toucher** : le lien d'invitation en un toucher arrive avec la sortie App Store (build) ; d'ici là, le
code.

**À la sortie sur l'App Store** : l'aide « Ajoute un sticker lien vers l'App Store dans ta story » a été retirée (il n'y
a pas encore de lien) ; à remettre avec un vrai lien d'invitation (le code prérempli à l'ouverture de l'app), et alors
un QR code de ce lien sur l'affiche.

**À corriger dans l'atlas (img/body2, dépôt mdlf-perso)** : la silhouette femme n'a pas de maillage séparé pour le tissu
mammaire. Les calques `img/body2/female/front/p3/chest_sternal.webp` et `chest_abdominal.webp` (et leurs versions 1×
`p/chest_sternal.webp`, `p/chest_abdominal.webp`, parties `chest_sternal` et `chest_abdominal` de
`js/data/body-parts.js`) couvrent la poitrine : un pectoral « ciblé » la colore en rouge dans la fiche exercice et dans
Progrès. Sur l'affiche, ces deux parties sont laissées au gris (`CPA_FEMALE_SKIP`).

**3e panel (7,9/10), corrigé en v10** (`v10/`, `comparaison.png` : v9 et v10, `comparaison_app.png`) : le corps était
caché par le titre et la photo, et le carré plaisait davantage ; la story reprend donc la composition du carré en
vertical (titre en haut, personnage entier à gauche, photo, nom, pseudo en blanc, badge, code et signature à droite),
sans rien posé sur le corps. La consigne du code passe sur deux lignes en story pour rester lisible. Feuille :
l'aperçu de l'image entière est fixé en haut (40 % de l'écran, 30 % en très grand texte), les réglages défilent entre
lui et la barre « Partager » fixée en bas ; en très grand texte, l'aide passe à la fin des réglages. Test E2E sur
iPhone SE en AX33 : aperçu visible pendant qu'on touche Silhouette et Titre.

**Couleurs du personnage (v9)** : exactement l'atlas de l'app en sombre (branche affichage-e, commit 5e2aaa85) : corps
à brightness .46, tous les muscles en #FF453A éclairés par leur calque en lumière douce (soft-light), comme un muscle
ciblé. `v9/comparaison_app.png` : Progrès de l'app en sombre à côté de l'affiche.

**2e panel (8,0/10), corrigé en v8** (`v8/`, `v8/comparaison.png` : v7 et v8) : plus aucune bande ni masque (« corps
coupé en deux »). Le personnage est entier, de la tête aux pieds : en story entre 250 et 1700 px derrière le contenu
(sa tête derrière le titre), dans le carré à gauche sur 40 % de la largeur, sans toucher la photo. Tous les textes posés
sur lui ont un contour noir plein et des couleurs opaques (petites lignes en gras) ; le bloc orange du code reste un
aplat. En très grand texte, l'aperçu devient une vignette collée en haut pendant le défilement. Pour un coach, la
feuille de la photo de profil dit aussi « Ton affiche de coach montre aussi cette photo ».

**Panel de 40 juges (7,9/10), corrigé en v7** (`v7/`, `v7/comparaison.png` : v6 et v7) : tout le texte entre 250 et
1650 px (signature juste sous le bloc orange, « Programme · Suivi · Messages » retiré) ; plus de petits rectangles
derrière les lignes : en story, un bandeau noir pleine largeur (aplat net) porte le pseudo, le badge, le code et la
signature, les jambes restent visibles dessous ; personnage sans sa tête (à partir du cou en story, derrière la photo
dans le carré) ; sans nom, pas de « @PSEUDO » géant : le pseudo seul sur sa ligne, et « Ajoute ton prénom » dans le
champ. Feuille : aperçu en grand en haut (62 % de la largeur au moins, plein écran au toucher), réglages dessous,
« Partager » à la fin sans rien recouvrir, puis « Ajoute un sticker lien vers l'App Store dans ta story » ; en très
grand texte, Silhouette et Titre deviennent une liste avec coche.

Lisibilité sans assombrir le personnage : les gros titres Anton (titre, nom) ont un contour noir plein (trait opaque,
ni flou ni lueur) qui les détache des muscles ; les petites lignes posées sur le corps (pseudo, signature, « Programme
· Suivi · Messages ») ont derrière elles une bande noire pleine, le badge une pastille noire pleine. Contraste mesuré
sur les rendus (87 textes, 10 images) : au moins 8,05:1 (petites lignes contre leur fond réel, titres contre leur
contour noir, code noir sur #FF7A1A). La version claire (v5) et le choix Clair / Noir sont retirés (« nulle »).

### Comment on y est arrivé

1. V1 (trois mises en page au style de l'app) : jugée trop proche d'une fiche de l'app face à l'affiche « Nouveau
   coach » de FitBrothers.
2. Quatre concepts (`v2/`), vote de 10 juges (4 coachs qui recrutent sur Instagram, 3 pratiquants, 3 designers de
   marques fitness), FitBrothers en référence à côté de chacun :

   | Concept | Voix | Note /10 |
   |---|---|---|
   | « Photo ronde » (titre énorme, photo ronde, personnage derrière) | 2 | 7,1 |
   | « Carte d'athlète » (photo plein cadre, bandeau orange) | 6 | 7,6 |
   | « Nom géant » (prénom blanc, nom au trait orange, billet) | 2 | 7,2 |
   | « Signature » (duotone orange) | 0 | 6,0 |
   | Référence FitBrothers | | 7,3 |

3. Choix de Maxence, qui prime sur le vote : « photo ronde » et « nom géant » (`v3/`), puis **« photo ronde » seule**.
   Remarques des juges gardées : photo plus grande (le titre rétrécit d'abord), code remonté, signature au-dessus de
   la barre de réponse d'Instagram, « Nouvelle coach » pour une coach.
4. **Règles anti « design IA » de l'app appliquées à l'affiche aussi** (rappel de Maxence) : noir pur, un seul orange
   plein (#FF7A1A, celui de l'app), blanc plein, aucun dégradé, aucune lueur, aucun halo ni vignettage, aucune ombre,
   aucun verre ; petits textes en casse normale (SF Pro), jamais en capitales espacées ; seuls les gros titres (titre,
   nom, code) en capitales Anton, serrées. Vérifié par un test unitaire (couleurs posées, dégradés créés, espacement
   des lettres, bandes noires sous les petites lignes).
5. Version claire aux couleurs de l'app (v5) essayée puis retirée ; personnage remis en entier et bien visible (v6).

### Décisions

| Question | Décision | Pourquoi |
|---|---|---|
| Où | Mes élèves › Invitations (sous le code permanent) et Réglages › Coach (sous « Ton code coach ») ; coach validé seulement | Là où le coach partage déjà son code. |
| Contenu | Titre, nom en capitales (sinon le pseudo), @pseudo, badge s'il est affiché, consigne et code permanent, signature de l'app | Rien d'un élève (test unitaire). |
| Silhouette | Femme ou homme, choix explicite dans l'aperçu, prérempli avec le réglage de silhouette du compte, gardé sur l'appareil ; donne le personnage de l'atlas (muscles superficiels en rouge) et l'accord du titre ; « COACH » seul au choix | « Attention à respecter aussi pour les femmes » ; jamais déduit du prénom. |
| Zones d'Instagram | Rien d'important dans les 250 px du haut ni du bas (test unitaire) ; le bas n'est jamais vide | Barres de progression et champ de réponse. |
| Police | Anton (gros titres seulement), SIL Open Font License 1.1, réduite au latin (24 ko), dans `fonts/` avec sa licence ; le reste en SF Pro | Condensée, lisible en grand ; libre d'usage commercial. |
| Photo | La photo choisie pour l'affiche (cellule « Photo » de l'aperçu), sinon l'image d'origine de la photo de profil, gardée à son envoi, sinon la photo du serveur (512 px) ; réduite à 2048 px au plus, JPEG, dans IndexedDB de l'appareil seulement, jamais envoyée ; effacée quand le coach retire sa photo de profil ou supprime son compte | Netteté ; rien de plus sur le serveur. |
| Sans photo | Initiales dans le rond ; jamais le personnage à la place de la photo | Demande de Maxence. |
| Détourage | **Pas en V1** | Dans la WebView, un modèle de segmentation (plusieurs Mo de WASM, `wasm-unsafe-eval` à ouvrir dans la CSP) ; natif, l'API Vision d'iOS demande un module natif, donc une build, impossible à tester ici sans Mac. La photo ronde n'en a pas besoin. |
| Lien ou QR | Aucun : le code en gros, avec la consigne | Pas de lien d'invitation dans l'app (TestFlight). Le coach peut ajouter le sticker « Lien » d'Instagram vers l'App Store quand l'app y sera. |
| Partage | Aperçu commun aux images (openStoryPreview), puis feuille de partage d'iOS | Rien n'est publié ni envoyé sans ce toucher ; l'image ne part jamais au serveur, seul le nom de l'affiche part au partage, pour Mon coach (test). |

Code : `js/data/coach-poster.js` (contenu, initiales, réglages et photo de l'appareil), `js/features/coach-poster-art.js`
(dessin), `js/features/coach-poster-ui.js` (entrées, aperçu), réglages dans `sharePreviewBody` (js/features/share.js),
styles et police en fin de `css/share.css`. Tests : `tests/unit/coach-poster.mjs`, `tests/test_affiche_coach.py`.
