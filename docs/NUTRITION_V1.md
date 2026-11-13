# Nutrition V1 : plan diète, repas cochés, équivalences

Demande des deux coachs partenaires (vocaux des 03 et 04/11/2026), la plus attendue : « la rubrique
macro-nutriments… tu fais le plan diète à quelqu'un, la personne coche quand elle a mangé ses repas, comme
pour les entraînements… et un système d'équivalences : les produits qui ont à peu près les mêmes macros,
pour que la diète soit flexible ». Le fondateur : « pour les macros je suis en train d'étudier pour faire
quelque chose de propre ». Cette V1 est une base propre à valider avec lui, rien n'est en production.

## En une phrase

Le coach (ou la personne elle-même) écrit un plan : des repas, des aliments de la table Ciqual et leurs
quantités, les macros se calculent seules. Chaque jour, l'élève coche ses repas d'un toucher, comme ses
séances, et peut remplacer un aliment par un équivalent proposé, la quantité étant recalculée.

## Ce que font les autres (recherche du 05/11/2026)

| Appli | Plan du coach | Cochage des repas | Équivalences |
|---|---|---|---|
| **Ekklo** (ekklo.com, logiciel français pour coachs ; le nom entendu « Eklo / Eclos ») | Plans alimentaires construits sur une base d'aliments avec valeurs nutritionnelles, et recettes | Rien de public trouvé | Rien de public trouvé ; un avis client reproche « le même aliment avec des macros différentes » ([getapp](https://www.getapp.ie/software/2083928/ekklo)) |
| **Everfit** | Trois formats : plan structuré (repas et portions précis), plan flexible (repas recommandés que l'élève permute), livre de recettes ([aide](https://help.everfit.io/en/articles/10505610-understanding-meal-plan-type)) | « Log Meal » sur chaque repas du plan, une fois, annulable par « Unlog Meal » ([aide](https://help.everfit.io/en/articles/9423729-client-app-structured-meal-plans)) : le plus proche de notre case | Variantes d'une recette (pauvre en glucides, végane, double protéines) ([aide](https://help.everfit.io/en/articles/11520625-choose-variation-alternate-recipes-made-easy)) |
| **ABC Trainerize** | « Smart Meal Planner » : jusqu'à 3 jours générés depuis calories, 3 à 6 repas, macros, régime ([blog](https://www.trainerize.com/blog/introducing-the-smart-meal-planner)) | « Ate Today » | Échange d'un repas entier, parmi ceux du système qui restent dans les macros ; le coach ne peut pas y mettre les siens ([demande](https://ideas.abcfitness.com/forums/167887-coach-trainer-abc-trainerize/suggestions/45173332-allow-trainers-to-enter-own-meals-into-the-smart-m)) |
| **MyFitnessPal** | Pas de coach. « Meal Planner » Premium+ : semaine de recettes et liste de courses ([page](https://www.myfitnesspal.com/premium-plus)) | Non vérifié | Non vérifié |
| **Yazio** | Recettes réservées à PRO ([aide](https://help.yazio.com/hc/articles/208847005)) ; plans repas décrits seulement par un concurrent, non vérifiés | Non vérifié | Non vérifié |
| **MacroFactor** | Suivi de macros dont les objectifs s'ajustent chaque semaine : un plan en macros, pas un plan repas ([App Store](https://apps.apple.com/gb/app/id1553503471)) | Journal des aliments | Aucun planificateur ni remplacement trouvé (absence de résultat, pas une preuve) |
| **Nutrium** (diététiciens, en plus) | Plan détaillé | | Listes d'équivalents par groupe, avec quantités équivalentes, attachées au repas ([aide](https://help.nutrium.com/en/articles/7068252-how-can-i-suggest-foods-with-equivalent-quantities)) : exactement notre idée |

Ce qu'on en retient : le cochage d'un repas entier (Everfit) est le geste le plus simple ; l'équivalence
au niveau de l'aliment, par groupe et quantité recalculée (Nutrium, diététique française), est ce que les
coachs demandent, et aucune des applis grand public ne le fait. On garde les deux, sans générateur de
menus.

## Base d'aliments

- **Table Ciqual 2025** de l'Anses, publiée le 19/11/2025 : 3 484 aliments, 74 constituants
  ([Anses](https://www.anses.fr/fr/actualite/table-ciqual-nouvelle-version-enrichie-plus-representative)).
  Elle « annule et remplace » Ciqual 2020 (page data.gouv). Jeu de données :
  [doi:10.57745/RDMHWY](https://doi.org/10.57745/RDMHWY) sur recherche.data.gouv.fr.
- **Licence : Licence Ouverte Etalab 2.0**, lue le 05/11/2026 dans les métadonnées du jeu (API Dataverse,
  `license.name = "etalab 2.0"`). La documentation (page 4) demande de citer « Anses. 2025. Table de
  composition nutritionnelle des aliments Ciqual », de mentionner source et version, de ne pas altérer
  les données ni en dénaturer le sens. L'app le dit sous l'écran Nutrition et sous chaque plan.
- **Format** : Excel `.xlsx` (1,5 Mo, un onglet de composition) et 5 fichiers XML. On lit le `.xlsx` avec
  la bibliothèque standard de Python (`scripts/prepare-foods.py`, aucune dépendance), téléchargé dans un
  dossier à part, jamais dans le dépôt :
  `python3 -I scripts/prepare-foods.py <Table Ciqual 2025_FR_2025_11_03.xlsx> data/foods.json`.
- **Colonnes** : énergie « Règlement UE 1169/2011 » (kcal), protéines **« N x 6,25 »** (valeur de
  l'étiquetage, cohérente avec l'énergie du règlement ; Ciqual donne aussi « N x facteur de Jones »), glucides,
  lipides, sucres ; famille d'équivalence, sous-groupe Ciqual, marque `e` (énergie calculée par l'app).
- **Valeurs particulières** : la documentation (p. 9, 10, 16) dit que « - » est une valeur inconnue (jamais
  zéro), « traces » une présence non quantifiable, « < x » une valeur sous la limite x. **Choix de l'app**
  (pas une consigne de Ciqual) : « traces » et « < x » comptent pour 0, quantités négligeables pour un plan
  diète. Un aliment sans protéines, glucides ou lipides connus est écarté.
- **Énergie inconnue** (« - » pour 58 aliments) : recalculée par les coefficients du règlement 1169/2011,
  4 P + 4 G + 9 L + 2 fibres + 7 alcool, **seulement si protéines, fibres et alcool sont connus** ; sinon
  l'aliment est écarté (7 : eau-de-vie type calvados, pastis prêt à boire, baba au rhum, poudre maltée…, qui
  auraient eu 0 ou 2 kcal faute d'alcool connu). Les 51 aliments calculés portent `e = 1`, et l'app écrit
  « kcal (calculées) » à côté d'eux. Aliments infantiles écartés. Résultat : **3 110 aliments, 266 Ko**, en
  cache hors ligne (`sw.js`), lu à la première ouverture d'un écran de nutrition seulement.
- Chaque aliment d'un plan garde `src` (`ciqual-2025`, `perso` ou `off` pour un produit scanné) et, le cas échéant, `ecalc: true`.
- **Absents de Ciqual** et courants en salle : skyr, whey, certaines marques. D'où l'**aliment perso**
  (nom et valeurs pour 100 g de l'étiquette, « recopie l'énergie de l'étiquette » ; vide, elle est calculée
  4/4/9, et l'écran dit que l'étiquette compte aussi fibres et alcool), gardé dans « mes aliments ».
- **Open Food Facts** (codes-barres, marques) : base sous ODbL ([texte](https://opendatacommons.org/licenses/odbl/1-0/)),
  fiches sous DbCL, photos sous CC BY-SA ([OFF](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side)).
  Embarquer un extrait, c'est distribuer une base dérivée (§4.4) : elle reste sous ODbL et doit être
  fournie (§4.6). D'où le choix du 09/11/2026 : **interrogation à la demande** (« Produced Work », §4.5),
  jamais d'extrait embarqué ni de table fusionnée. Seuls les produits que la personne scanne sont gardés,
  un par un, dans ses aliments perso (`src: 'off'`, `code`), avec l'attribution « © les contributeurs
  d'Open Food Facts, licence ODbL » sur la fiche du produit et au pied des écrans de nutrition.
  Détail plus bas (« Scanner un produit »).

## Scanner un produit (09/11/2026)

- **Où** : feuille « Ajouter un aliment », bouton « Scanner un code-barres » en tête (icône `barcode`).
  `dietChooseFood()` (recherche, scan ou création, puis quantité en grammes ou à l'unité) sert à tout ajout d'aliment.
- **Clavier** (10/11/2026) : le clavier d'iOS recouvrait la feuille (bouton Scanner caché). La zone visible
  (`visualViewport`) est recopiée dans `--vv-top` et `--vv-h` (js/ui/sheet.js, `followKeyboard`) : la feuille se
  pose au-dessus du clavier, son contenu défile (test : `t_clavier`, clavier simulé).
- **Lecture** : module Swift maison `MdlfScanner` (ios/App/App/ScannerPlugin.swift, AVFoundation :
  EAN-13, EAN-8, UPC-E ; UPC-A arrive en EAN-13). Pas de paquet npm : aucun SDK tiers, aucune collecte,
  rien à ajouter au manifeste de confidentialité, compilé dans la cible App comme les autres modules.
  Sans le module (navigateur, Android, build plus ancienne qu'une mise à jour à chaud), le même bouton
  devient « Saisir un code-barres » : les chiffres tapés passent par le même chemin.
- **Recherche** (js/data/food-scan.js) : `GET world.openfoodfacts.org/api/v2/product/{code}.json?fields=…`,
  User-Agent « MDLF Training/<version> (iOS) » (doublé en X-User-Agent, qu'un navigateur ne peut pas
  remplacer), sans cookie ni contact, 6 s au plus. Code vérifié (chiffre de contrôle) avant tout envoi.
- **Analyse** : kcal pour 100 g, sinon kJ ÷ 4,184, sinon 4/4/9 (`ecalc`) ; kcal hors bornes (des kJ mis dans
  le champ des kcal) : les kJ prennent le relais ; deux macros au moins (la troisième vaut 0) ; bornes de
  `cleanDietPer`, sinon « valeurs incomplètes ». Sel (ou sodium × 2,5) affiché sur la fiche, jamais compté.
- **Fiche** : nom « Marque · Nom », valeurs pour 100 g, quantité (100 g d'office) et ce qu'elle apporte,
  source. Introuvable, incomplet ou hors ligne : « Créer l'aliment » (code gardé, nom prérempli si connu).
  Un code déjà gardé est retrouvé sur l'appareil, sans réseau.
- **Tests** : tests/unit/food-scan.mjs, tests/test_scan_aliment.py (module natif et Open Food Facts simulés).

## Quantités à l'unité (10/11/2026)

Demande de Maxence : « choisir la quantité d'œufs plutôt que le poids » (yaourts, croissants, boulangerie, sandwichs).

- **Stockage** : la quantité reste **toujours en grammes** (`it.g` : macros, coach, synchro, anciennes versions).
  L'unité choisie s'ajoute à côté, pour l'affichage : `it.por = { n, u, pl, g }` (2 œufs de 50 g). Elle n'est
  gardée que si `n × g` redonne `it.g` à 1 g près (`cleanDietPortion`) : une ancienne version qui change les
  grammes sans connaître `por` fait tomber l'unité, jamais les grammes. Une version qui ignore `por` affiche « 100 g ».
- **Table** (js/data/food-portions.js, `FOOD_PORTIONS`) : portions usuelles reliées aux aliments Ciqual par motif
  de nom (œuf 50 g, blanc 30 g, jaune 18 g ; pot de yaourt 125 g, de fromage blanc 100 g, petit-suisse 60 g ;
  croissant 60 g, pain au chocolat 70 g, pain aux raisins 100 g, brioche individuelle 50 g ; baguette 250 g par
  demi, tranche de pain 30 g, de pain de mie 25 g ; sandwich baguette 280 g, panini 200 g, wrap 180 g ; banane
  120 g, pomme 150 g, orange 150 g, kiwi 75 g ; tranche de jambon cuit 40 g, cru 15 g ; steak haché 100 ou
  125 g, filet de poulet 150 g ; carré de chocolat 5 g ; cuillère à soupe d'huile 10 g, à café 5 g ; dose de
  whey 30 g). Poids moyens de la partie mangée, valeurs courantes (tailles de portions usuelles de l'Anses et
  poids du commerce) : affichés « environ ». Deux unités au plus par aliment. Exclusions testées : bœuf, œufs
  de lompe, yaourt à boire, pomme de terre, jus d'orange.
- **Produit scanné** : `serving_size`, `serving_quantity` et `quantity` demandés à Open Food Facts ; `offPortion`
  lit « 1 pot (125 g) », « 2 biscuits (25 g) » (au singulier), « 4 x 125 g » (unité nommée par la table : pot,
  croissant, sinon « unité »), le nom (« Œufs frais » : l'œuf moyen), puis la portion indiquée (« portion »,
  jamais 100 g). L'unité est gardée dans l'aliment perso (`dietFoods[].portion`), exacte (sans « environ »).
- **Aliment perso** : champ facultatif « Une portion » (g) ; on compte ensuite en portions.
- **Écran** (js/features/diet-qty.js) : feuille de quantité « Grammes | Œuf » (contrôle segmenté), boutons − et +
  (pas de 1, ½ pour la baguette, 10 g en grammes), champ que l'on peut taper, équivalence sous le champ
  (« 2 œufs · 100 g · 134 kcal », lue « 2 œufs, 100 grammes, 134 kilocalories »). À l'unité d'office pour un
  ajout, sans clavier à l'ouverture ; en modification, rouvre sur l'unité choisie. Passer d'un mode à l'autre
  convertit (120 g → 2 œufs). Sans unité connue : l'alerte en grammes d'avant. Même contrôle sur la fiche d'un
  produit scanné (« 1 pot » d'office). Les lignes du plan et du jour disent « 2 œufs · 100 g ».
- **Tests** : tests/unit/food-portions.mjs (table, faux amis, pluriels, demi, conversions, `por` périmée,
  envoi au coach, Open Food Facts), tests/test_nutrition.py `t_unites` (2 œufs → 100 g, 134 kcal),
  tests/test_scan_aliment.py `t_pot` (yaourt « 4 x 125 g » → 1 pot).

## Vague 4 (12/11/2026) : demandes de Maxence

- **Carte de l'accueil** (`nutritionHomeCard`) : le nom du plan à côté de « Nutrition », les calories du jour, puis
  **tous les repas du jour** (nom, kcal, rond vert plein une fois coché). Le prochain repas porte le bouton à cocher
  (un toucher) ; le reste de la carte ouvre Nutrition. Compacte : 4 repas au plus listés, au-delà 3 autour du
  prochain (le dernier coché, le prochain, le suivant) et « et 2 autres » (`dietHomeMeals`, js/data/nutrition.js).
  VoiceOver : le bouton du haut dit le plan, les calories et chaque repas ; les lignes sont cachées, sauf le bouton.
- **Recherche** (`dietPickFood`) : quand aucun résultat ne contient chaque mot tapé en entier (`foodSearchExact` :
  « whey », « riz bl »), « Créer « whey » » s'affiche **en tête**, et la feuille de création s'ouvre avec ce nom
  (majuscule au début). « Créer un aliment » reste en bas, vide.
- **Cru, cuit** : étiquette discrète « cru » ou « cuit » sur un résultat quand le nom Ciqual le dit (`foodCookTag` :
  cuit, grillé, poêlé, bouilli, rôti, braisé, vapeur… ; cru, à cuire ; « sec » seulement pour un féculent, une
  banane sèche n'est pas crue ; « blé dur » n'est pas un œuf dur, corrigé aussi dans `foodState` des équivalences).
  Feuille de quantité d'un **nouvel** aliment de la base qui existe dans l'autre version (`foodCookTwin` : même nom
  sans les mots de la cuisson, même famille ; plus de 200 couples, riz, pâtes, quinoa, boulgour, viandes, poissons) : « Pesé
  cuit ? Choisis la version cuite. Les valeurs ne sont pas les mêmes. » et un bouton « Prendre Riz blanc, cuit… »
  qui rouvre la feuille sur l'autre version. Ces aliments passent par la feuille (grammes seuls) plutôt que
  l'alerte à champ, pour porter le bouton. Rien en modification d'une quantité.
- **Mes aliments plein (200)** : avant, le plus ancien partait en silence (`cleanDietFoods`). Maintenant :
  création (`dietKeepFood`) : « Mes aliments est plein », **Ajouter sans le garder** (l'aliment va au repas,
  le plan garde ses valeurs), **Gérer Mes aliments** ou Annuler ; scan (`dietScanFull`) : le produit s'ajoute
  sans être gardé, la fiche le dit et propose « Gérer Mes aliments ». Un aliment déjà gardé (même nom, même
  code-barres) se met à jour sur place, même plein. **Réglages de la nutrition › Mes aliments** (`diet-foods`) :
  « 37 sur 200 », la liste (créé ou scanné, valeurs pour 100 g), un toucher puis « Retirer de Mes aliments »
  (Annuler dans le toast, remis à sa place). Retirer ne change aucun plan.
  Synchro : l'identifiant retiré va dans `dietFoodsGone` (300 au plus, copié avec l'accord comme `dietFoods`) ;
  la fusion par union ne fait plus revenir un aliment retiré d'un autre appareil qui l'avait encore.
- **Macros pour débutants** : les lignes des listes restent « P 7 · G 77 · L 1 » (« 100 g · 155 kcal · 3,3 g prot. ·
  33,2 g gluc. · 0,7 g lip. » fait une fois et demie la longueur et passe à la ligne sur iPhone SE, plus encore en
  texte agrandi) ;
  la légende « **P** protéines · **G** glucides · **L** lipides » s'affiche une fois par écran ou par feuille
  (`dietMacroLegendHtml` : Nutrition sous « Repas », éditeur du plan sous « Par jour », recherche, Remplacer,
  fiche d'un produit scanné, Mes aliments). Cachée à VoiceOver, qui dit déjà chaque ligne en toutes lettres ;
  absente quand les chiffres sont masqués. La feuille de quantité garde ses macros en toutes lettres.
- **Tests** : tests/unit/nutrition.mjs (« vague 4 » : étiquettes, couples cru / cuit, recherche pile, Mes aliments
  plein, retirer et Annuler, synchro des retraits, repas de la carte, textes), tests/unit/food-scan.mjs (scan
  plein), tests/test_nutrition.py `t_vague4` (5 appareils, clair et sombre), `t_vague4_six_repas` (iPhone SE,
  texte agrandi), `t_vague4_plein`.

## Équivalences : la règle (js/data/food-swap.js, testée par tests/unit/nutrition.mjs)

Principe des « exchange lists » de l'ADA / Academy of Nutrition and Dietetics (« Choose Your Foods ») et des
équivalences de la diététique française : dans un même groupe, on échange des quantités qui apportent à
peu près la même chose ([annexe](https://mtsu.pressbooks.pub/nutrition2/back-matter/appendix-b-the-exchange-lists-for-meal-planning/),
[Fédération des diabétiques](https://afd29.federationdesdiabetiques.org/public/content/58/doc/Les%20Equivalences%20glucidiques.pdf) ;
référence de méthode pour ce document seulement, jamais citée dans l'app).

1. **Même famille** (sous-groupe Ciqual ramené à 10 familles) : viandes, poissons, œufs (`v`) ; féculents
   (`f` : tubercules, légumineuses, céréales, pains) ; laitiers (`l`) ; matières grasses (`g`, oléagineux
   compris) ; fruits (`r`) ; légumes (`e`) ; produits sucrés (`s`) ; boissons (`b`) ; plats composés (`p`) ;
   aides culinaires (`a`, jamais remplacées). Aliment perso : famille tirée de ses macros (protéines ≥ 50 %
   de l'énergie → `v`, lipides ≥ 60 % → `g`, glucides ≥ 50 % → `f`).
2. **Quantité recalculée pour garder** : les **protéines** pour une source de protéines (`v`, `l`, dès 5 g
   pour 100 g), les **calories** pour tout le reste. `g' = g × teneur(original) / teneur(remplaçant)`, arrondie
   comme on pèse : au gramme sous 50 g, aux 5 g au-dessus.
3. **Gardé seulement si les macros restent proches** à cette quantité : calories à 15 % près (30 kcal au
   moins), protéines, glucides et lipides chacun à 25 % près (5 g au moins), quantité entre le quart et le
   quadruple de l'original. Exemple : 150 g de filet de poulet grillé ne proposent pas de saumon (trop gras
   à protéines égales).
4. **Classement** : écart pondéré par l'énergie (1 par kcal, 4 par g de protéines ou glucides, 9 par g de
   lipides, 2 par g de sucres), plus des pénalités fixes (autre sous-groupe Ciqual : 25 ; cru contre cuit :
   60 ; abats : 20 ; variantes bio, sans gluten, enrichies : 12), moins 15 pour un aliment courant (poulet,
   riz, flocons d'avoine…), puis les noms courts.
5. **Boissons alcoolisées** (sous-groupe Ciqual 603) : jamais croisées avec les autres boissons, dans aucun
   sens. **Aliment perso** : sa famille est choisie dans le formulaire (proposée d'après ses macros).
6. **Dix au plus**, deux au plus par premier mot du nom (riz, pâtes, puis semoule, pommes de terre…).

Le remplacement vaut **pour la journée** : le plan ne change pas, et l'écran le dit. Exemples réels
(base 2025) : 150 g de riz blanc cuit → 160 g de riz étuvé cuit, 155 g de riz basmati, 60 g de galette de
maïs soufflé, 305 g de polenta cuite… ; 150 g de filet de poulet grillé → 165 g de steak grillé, 150 g
d'escalope de dinde rôtie, 145 g d'escalope de veau…

## Santé : précautions

- **Aucun calcul de besoins.** Pas de formule de métabolisme, pas de « tu devrais manger ». Les objectifs
  sont fixés par le coach ou par la personne ; sans objectif, le total prévu par le plan ce jour-là
  (remplacements du jour compris : un équivalent ne donne jamais « 217 sur 215 kcal ») sert de repère, et
  l'écran le dit (« Repère : le total prévu par ton plan »).
- **Calories fixées, pas une macro** (un coach fixe souvent kcal et protéines) : cette macro s'affiche sans repère
  ni jauge (« Pas d'objectif ») ; son total tiré du plan ne collerait pas aux calories fixées.
- **Repas vides** (plan neuf pas encore rempli) : ni cochables, ni comptés dans « n repas cochés sur N » ou la
  journée complète, jamais proposés comme prochain repas ; sans aucun repas rempli, pas de carte à l'accueil.
- **Frise d'aujourd'hui** : jugée avec le plan suivi (après un changement de plan dans la journée, les coches
  de l'ancien ne la mettent plus en vert) ; les jours passés gardent le plan de ce jour-là.
- **Pas d'alerte de « trop peu »**, pas de rouge quand on dépasse : la barre se remplit, c'est tout. Les
  études sur les applis de comptage et les troubles du comportement alimentaire (Levinson et al., *Eating
  Behaviors* 2017, [PMC5700836](https://pmc.ncbi.nlm.nih.gov/articles/PMC5700836/) ;
  [PMC8485346](https://pmc.ncbi.nlm.nih.gov/articles/PMC8485346)) recommandent justement de revoir ces
  alertes et d'orienter vers des professionnels.
- **Repère très bas** : un objectif, ou le total d'un plan dont chaque repas est rempli (pas un plan en cours de
  remplissage), sous **1 200 kcal** affiche, sans rien bloquer (« Ce plan » sans objectif) : « Cet
  objectif est très bas pour un adulte qui s'entraîne. Les recommandations de santé réservent les régimes
  sous 1 200 kcal par jour à un suivi médical… » (NICE NG246).
- **Réglages de la nutrition** (bas de l'écran Nutrition et de Plans diète) : « Masquer les calories et les
  grammes » (seules les cases des repas et les quantités des aliments restent ; l'éditeur de plan garde les
  chiffres, il sert à construire le plan), « Afficher la série », accord du compte.
- **Écoute**, toujours en bas de l'écran Nutrition : « Si manger, compter ou te peser devient une source
  d'angoisse, tu peux en parler : Anorexie Boulimie Info Écoute, 0810 037 037 (lundi, mardi, jeudi et
  vendredi, de 16 h à 18 h). »
- **Mentions** sous l'écran et chaque plan : source complète (table Ciqual 2025 de l'Anses, version du
  03/11/2025, doi, Licence Ouverte Etalab 2.0, valeurs arrondies, énergie parfois calculée, « l'Anses ne
  valide pas ces plans ») ; « des repères pour suivre un plan, pas un avis médical ni diététique… ».
- **Aucune finalité médicale** dans l'interface (ni maladie, ni perte de poids promise) ; vérifié par
  `tests/unit/nutrition.mjs`.
- Ce qui est noté (repas cochés) reste **sur l'iPhone**.

## Accords (RGPD) : deux accords, deux finalités

Pour la CNIL, des apports caloriques rapprochés du poids sont une donnée de santé (article 9 du RGPD :
consentement explicite). Deux accords séparés, chacun daté et retirable :

**1. « Copier mes plans sur mon compte »** (`data.dietConsent = { on, at }`)
- Sans accord, `profilePayload` (js/data/sync.js) n'envoie ni `dietPlans`, ni `dietActive`, ni `dietFoods` :
  tout reste sur l'iPhone (et dans sa copie iCloud et les exports). L'accord lui-même part toujours dans le
  profil : daté côté serveur (`profiles.doc`).
- Question **courte**, une fois, avec un compte, dès qu'un plan existe : « Copier tes plans sur ton compte ?
  Tes plans diète et tes objectifs peuvent renseigner sur ta santé. Avec ton accord, ils sont copiés sur ton
  compte ; sans lui, ils restent sur cet iPhone. » Boutons « Copier sur mon compte », « Garder sur cet
  iPhone », « En savoir plus » (privacy.html#nutrition, puis la question revient). Compte coach : « Tes plans
  diète, y compris ceux que tu prépares pour tes élèves, peuvent renseigner sur la santé. »
- **Retrait** (Réglages de la nutrition) : le profil renvoyé aussitôt ne contient plus les plans, le document
  du serveur est remplacé : ils en sont effacés ; ils restent sur l'iPhone.
- **Synchro** (`mergeDietProfile`, règle à part dans toutes les branches de `applyRemoteProfile`) : la décision
  la plus récente (`at`) gagne d'où qu'elle vienne (un retrait fait sur A n'est jamais annulé par B en
  conflit) ; accord retenu refusé : rien n'est pris du compte et aucune clé diète ne repart ; accord donné :
  union des plans (aucun plan de l'iPhone perdu, même sur un appareil sans séance ou quand l'accord arrive
  d'ailleurs ; même plan des deux côtés : le compte gagne si rien n'a changé ici, d'où une suppression
  propagée) ; plan suivi de l'iPhone gardé s'il existe encore. Un profil renvoyé par une ancienne app (sans
  nutrition) n'efface rien ici.
- **Taille** : au-delà de 900 Ko, les plans ne partent pas (le reste du profil part) et Réglages de la
  nutrition le dit (`profilePayloadForServer`) : la synchro n'est jamais bloquée.

**2. « Recevoir les plans diète de mon coach »** (élève ; migration `20261106200000_plans_diete_coach.sql`)
- Accord = une ligne `coach_shares` kind `'diet'` (`student_set_share('diet', true)`), comme le partage du
  poids : daté, pour le coach actuel, retiré en quittant le coach.
- Serveur : `coach_send_programme` refuse un identifiant `diet_…` sans cet accord (`diet_not_accepted`) ; le
  coach lit « Ton élève doit d'abord accepter les plans diète dans son app. » Retirer l'accord efface
  aussitôt les plans diète gardés pour l'élève (déclencheur `coach_shares_diet_revoked`).
- App : interrupteur « Recevoir les plans diète de max » dans Mon coach et dans Réglages de la nutrition ;
  question courte (« Ton coach pourra t'envoyer des plans diète, gardés sur le serveur jusqu'à ce que tu
  retires ton accord. Ils peuvent renseigner sur ta santé. ») avec « En savoir plus ». Sans accord, la carte
  devient une **invitation sans rien du plan** (« max veut t'envoyer un plan diète », ni nom ni contenu).
- **Serveur pas encore migré** (`student_set_share('diet')` répond `invalid_kind`) : l'accord est gardé sur
  l'iPhone (`data.dietCoachConsent`, SYNC_LOCAL_ONLY) et sert de garde-fou côté app ; le coach peut encore
  envoyer (serveur d'avant).
- Ordre de mise en production : l'OTA qui sait accepter, PUIS la migration (sinon aucun coach ne peut plus
  envoyer tant que ses élèves n'ont pas la version) ; supabase/rollback/ORDRE.md, étape 10.

## Où ça vit dans l'app, et pourquoi

- **Entraînement › Nutrition** (écran du jour) et une **carte sur l'accueil** quand un plan est suivi.
  L'accueil est l'endroit du « aujourd'hui » : on y démarre sa séance, on y coche son repas. La carte
  montre le nom du plan, l'anneau des calories et les repas du jour, le prochain avec le bouton à cocher : pas besoin d'ouvrir l'écran
  (« cocher le petit bouton vert, hop tu passes à la suite »). Sans plan, rien sur l'accueil (aucun bruit
  pour qui ne s'en sert pas).
- **Programme › Plans diète** : on prépare ses plans là où on prépare ses programmes. Un coach y écrit les
  plans de ses élèves.
- **Pas de sixième onglet** : iOS en montre cinq au plus sans « Plus », et les cinq sont pris. La nutrition
  suit le même découpage que l'entraînement : on prépare dans Programme, on fait dans Entraînement.
- **Premier plan créé** : il devient le plan suivi, sauf pour un coach (il prépare là les plans de ses élèves,
  qui ne s'affichent pas sur son accueil ; « Plan suivi » pour suivre le sien).
- **Coach** : fiche d'un élève (Coach › Élèves) : « Envoyer un plan diète » (choix du plan, puis relecture :
  nom, objectifs du jour, repas, Annuler / Envoyer ; jamais envoyé au premier toucher) et l'état de chaque envoi ;
  élève : carte de l'accueil, « Plans diète reçus » dans Mon coach.

## Données (`ppl_v2`)

```js
dietPlans: { [id]: {                 // profil, AVEC ACCORD seulement ; fusion par union (comme userProgrammes)
  name, consigne?, targets?: { kcal?, p?, c?, f? }, archived?, updatedAt?,
  fromCoach?: { coachId, name, sentAt },                // plan reçu : lecture seule
  meals: [{ id, name, note?, items: [{ id, name, food: code Ciqual | null, fam, g, per: { k, p, c, f }, src, ecalc?,
    por?: { n, u, pl, g } }] }] } },   // por : unité choisie (« 2 œufs »), g fait foi
dietActive: id,                      // plan suivi (profil)
dietFoods: [{ id, name, fam, per, code?, src?, salt?, portion?: { u, pl, g } }], // aliments perso (profil), 200 au plus
dietFoodsGone: [id],                 // aliments perso retirés (profil, avec accord) : la fusion ne les fait pas revenir
dietLog: { 'AAAA-MM-JJ': { plan, done: [id de repas], swaps: { [id d'aliment]: aliment }, meals: [id] } },   // SYNC_LOCAL_ONLY ; meals : instantané du jour
dietConsent: { on, at },             // accord daté (profil, part toujours)
dietConsentAsked, dietHideNumbers, dietStreakOff: true,   // réglages de l'appareil (SYNC_LOCAL_ONLY)
dietCoachConsent: { on, at },        // accord « plans du coach » gardé ici quand le serveur n'est pas à jour (SYNC_LOCAL_ONLY)
```

- Un plan est **autonome** : chaque aliment garde ses valeurs pour 100 g, relevées au moment du choix. Une
  nouvelle version de Ciqual ne change pas un plan, et un plan reçu s'affiche sans la base.
- Identifiants de repas et d'aliments : jamais un nom d'Object (`__proto__`, `constructor`…) ; les
  remplacements se lisent par `Object.hasOwn`.
- Journée passée : jugée avec les repas du plan de ce jour-là (instantané `meals`), pas avec le plan
  modifié depuis ; la carte de l'accueil lit le jour au toucher.
- Bornes (`sanitizeDiet`, appelé par `sanitizeData`) : 20 plans vivants (100 pour un coach, création refusée au-delà), 50 archivés, 8 repas, 25 aliments par repas, noms de 40
  (aliment : 80, coupé au mot), consigne de repas 300, quantité 1 à 2 000 g, kcal 0 à 900 et macros 0 à 100 g
  pour 100 g (101 g au plus à elles trois), objectifs bornés, 200 aliments perso, journal de 120 jours.
- Supprimer un plan l'archive (la synchro par union ne le ferait pas revenir) ; plus suivi.
- Aucune clé ajoutée tant qu'on ne s'en sert pas : le profil et ses empreintes ne changent pas pour les
  autres. Pas de nouveau schéma (champs additifs, ignorés par une version précédente).

## Coach : envoi sans migration

Même canal que les programmes : `coach_send_programme(student, prog_id, data)`. Le serveur ne vérifie que
`prog_id` (`^[A-Za-z0-9_-]{1,64}$`), un objet JSON et 200 Ko au plus ; il n'interprète pas `data`.

- `prog_id = diet_<id du plan sans d_>` ; `data = { kind: 'diet', v: 1, diet: { name, consigne?, targets?, meals } }`.
- **Pas de `name` au premier niveau** : une app d'avant la nutrition passe `data` à `cleanSentProgramme`, qui
  exige un nom, et l'écarte. Limite connue : chez elle, le badge « Mon coach » compte l'envoi tant qu'il
  n'est pas vu (rien à ouvrir) ; il disparaît avec la mise à jour.
- Élève : `student_inbox` le rend avec les programmes ; `cleanInbox` le range dans `inbox.diets`
  (`cleanSentDiet`, mêmes bornes). « Suivre ce plan » : copie locale `dc_<8 caractères du coach>_<envoi>`
  (deux coachs ne s'écrasent jamais), suivie aussitôt, marquée vue (`student_mark_seen('programme', id)`).
  Un nouvel envoi du même plan propose « Mettre à jour » ; les repas gardent leurs identifiants, les coches
  du jour restent. Plan reçu en lecture seule ; le remplacement du jour reste possible.
- Coach : `coach_state().students[].sent` liste aussi les plans (filtrés des « Programmes envoyés »,
  `isDietSentId`) : « Envoyé le …, Vu / Pas encore ouvert ». Quitter le coach ne supprime pas le plan pris.
- **Notification** : le déclencheur `coach_programmes_push` part comme pour un programme ;
  `push-policy.js` dit « t'a envoyé un plan diète » quand `ref` commence par `diet_` (fonction Edge
  `push-send` à redéployer pour ce texte ; avant, « un programme »). Le toucher ouvre Entraînement › Nutrition.
- Migration `20261106200000_plans_diete_coach.sql` (accord de l'élève, voir « Accords ») : écrite, testée
  (`tests/sql/plans_diete_test.sql`, retour arrière vérifié par `rollback_nuit_check.sh`, ordre de production
  par `prod_order_test.sh`), **pas appliquée**. Aucune table ni aucun GRANT nouveau.
- Format : `v` doit valoir 1 ; un envoi d'une version plus récente s'affiche « Mets l'app à jour pour recevoir
  ce plan » ; des aliments illisibles sont écartés et comptés (« 2 aliments illisibles ignorés »).

### Coach : préparer et envoyer vite (règle n°1 : simplicité)
- Sur un plan : « Envoyer à un élève » (sans passer par sa fiche), « Dupliquer le plan » (nouvel
  identifiant, jamais « reçu d'un coach » ; sur un plan reçu : « Dupliquer pour le modifier ») ; dans un repas :
  « Copier ce repas ».
- Gestes pour préparer puis envoyer à un 2e élève un plan voisin de 10 aliments, en partant de l'accueil :
  **avant** ≈ 55 (Programme, Plans diète, Créer, nom, puis 10 aliments × 4 gestes : ajouter, chercher,
  choisir, quantité ; puis Amis, Mes élèves, l'élève, Envoyer, le plan) ; **après** ≈ 6 plus les
  retouches (Programme, Plans diète, le plan, Dupliquer, Envoyer à un élève, l'élève). Même plan à l'identique :
  5 gestes dans les deux cas.
- Limites : 20 plans vivants pour un élève, 100 pour un coach ; au-delà la création (ou la copie) est
  refusée avec un message, jamais un plan retiré en silence. Plans supprimés (archivés) : plafond à part,
  les 50 plus récents.

## Hors V1 (et pourquoi)

- ~~**Code-barres, Open Food Facts**~~ : fait le 09/11/2026 (voir « Scanner un produit »).
- **Photo d'un repas, reconnaissance par IA** : fiabilité des macros, coût, données envoyées à un tiers.
- **Journal libre** (« j'ai mangé autre chose ») : V2. ~~Portions en unités (« 3 œufs »)~~ : fait le 10/11/2026 (voir « Quantités à l'unité »).
- **Coches visibles par le coach** : il faut le consentement de l'élève, donnée par donnée, comme le poids
  (`coach_shares`, kind `diet` à ouvrir, migration à écrire) ; en V1 le journal reste sur l'iPhone.
- **Plusieurs plans selon le jour** (jour d'entraînement, jour de repos), recettes, liste de courses.
- **Calcul des besoins** : volontairement absent (voir « Santé »).
- **Apple Santé** (écrire les macros) : demande une build et la déclaration de confidentialité.

## Avant une mise en production

1. Relecture du fondateur (règles d'équivalence, textes) et des deux coachs sur un plan réel.
2. `privacy.html` : fait (section Nutrition) ; à relire avec le reste des pages juridiques.
3. Redéployer `push-send` pour le texte « plan diète » (facultatif, sans risque).
4. Augmenter `CACHE` de `sw.js` au moment de publier (pas fait ici, sur consigne).

## Fichiers

| Fichier | Rôle |
|---|---|
| `scripts/prepare-foods.py` | Ciqual 2025 `.xlsx` → `data/foods.json` (bibliothèque standard, déterministe) |
| `data/foods.json` | Base embarquée : code, nom, famille, kcal, P, G, L, sucres, sous-groupe |
| `js/data/nutrition.js` | Modèle, bornes (`sanitizeDiet`), macros, journée, série, format d'envoi au coach (chargé avant `store.js`) |
| `js/data/food-swap.js` | Base (chargement, recherche) et règle des équivalences |
| `js/data/coach-diet.js` | Envoi par le coach, état des envois, plans reçus |
| `js/features/nutrition-ui.js` | Écran du jour, carte de l'accueil, remplacement, entrées Programme et coach |
| `js/data/food-portions.js` | Portions courantes (table), unité du paquet scanné (`offPortion`), textes « 2 œufs » (chargé avant `nutrition.js`) |
| `js/features/diet-qty.js` | Contrôle de quantité « Grammes \| unité » et feuille de quantité (`dietAskQty`) |
| `js/features/diet-editor.js` | Plans diète, éditeur, recherche d'aliment, aliment perso, objectifs |
| `js/features/diet-settings.js` | Réglages de la nutrition (Mes aliments, chiffres masqués, série, accord) et question de l'accord |
| `css/nutrition.css` | Styles (couleurs : tokens `--macro-*`, `--check-*` de `css/base.css`) |
| `tests/unit/nutrition.mjs` | Bornes, macros, coches, série, équivalences sur la vraie base, plan du coach, notification |
| `tests/test_nutrition.py` | Parcours complets (5 appareils, clair et sombre) et captures |
