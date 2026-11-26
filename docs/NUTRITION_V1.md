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

## Repas retirés et journées vides (13/11/2026) : retour de Maxence

« C'est relou d'avoir encore les repas d'avant, on peut pas les suppr. » Le journal affichait chaque jour tous les
aliments du plan ; on ne retirait qu'un aliment à la fois.

- **Retirer ce repas pour aujourd'hui** : `⋯` sur chaque repas du plan pas encore retiré, feuille « Retirer ce repas
  pour aujourd'hui » (`dietSetMealOff`, journal `off`). Sa coche et ses ajouts partent avec lui (pas mangés) ;
  Annuler, dans le toast, ne défait que ce retrait et les remet (`dietUndoMealOff` : une coche faite entre-temps reste).
  Le repas reste, sans rond, avec « Remettre le repas prévu » (`dietSetMealOn`, à recocher). Ce qu'on y ajoute ensuite
  (on a mangé autre chose) compte tout de suite. Le plan ne change pas.
- **Réglage « Repas du jour »** (Réglages de la nutrition, en tête ; rappelé sous la ligne « Réglages de la
  nutrition » du journal) : **Pré-remplis par le plan** (par défaut) ou **Vides** (`dietEmptyDays`, réglage de
  l'appareil, SYNC_LOCAL_ONLY). Jour vide (journal `blank`) : les repas du plan sans aliment prévu, même si le plan
  change ensuite ; ce qu'on note compte tout de suite, plan copié ou non ; « Copier le plan de ce repas »
  (`dietCopyMealPlan`, journal `copied`) remet ses aliments prévus, comptés à la coche. Le plan donne l'objectif.
  Par défaut **Pré-remplis** : le cas principal reste le plan du coach suivi en cochant (un toucher par repas) ; les
  utilisateurs actuels ne voient rien changer.
- **Changer le réglage** vaut pour aujourd'hui sans rien perdre (`dietSetEmptyDays`) : vers Vides, les repas cochés
  gardent leur plan, les autres se vident ; vers Pré-remplis, les repas sans ajout reprennent le plan, ceux où l'on a
  noté ce qu'on a mangé sont retirés (leurs ajouts comptent, pas de double compte) ; un repas retiré le reste. Les
  jours passés ne changent jamais.
- **Mangé** : un aliment prévu ne compte qu'une fois son repas coché ; un ajout compte à la coche dans un jour
  pré-rempli, tout de suite dans un jour vide ou un repas sans aliment prévu. **Journée complète** : jour pré-rempli,
  tous les repas qui ont encore des aliments prévus sont cochés ; jour vide, chaque repas du plan non retiré a un
  aliment noté (ou son plan copié coché) : la série s'allume aussi en mode Vides. Statut d'un jour vide : « 2 repas
  notés sur 4 ». Rien à faire : « Rien de noté pour l'instant », jamais « 0 sur 0 ».
- **Compatibilité** : `off`, `copied`, `blank` sont facultatifs ; un ancien client les ignore (aliments prévus
  affichés, comptés à la coche). Le journal reste sur l'appareil. Le plan du coach ne change jamais.
- **Tests** : tests/unit/nutrition.mjs (un test par cas : retrait, ajouts avant et après, Annuler, jour vide compté,
  complet et série, plan modifié, réglage aller-retour), tests/test_nutrition.py `t_repas_vides`.

## Équivalences : la règle (js/data/food-swap.js, testée par tests/unit/nutrition.mjs)

Principe des « exchange lists » de l'ADA / Academy of Nutrition and Dietetics (« Choose Your Foods ») et des
équivalences de la diététique française : dans un même groupe, on échange des quantités qui apportent à
peu près la même chose ([annexe](https://mtsu.pressbooks.pub/nutrition2/back-matter/appendix-b-the-exchange-lists-for-meal-planning/),
[Fédération des diabétiques](https://afd29.federationdesdiabetiques.org/public/content/58/doc/Les%20Equivalences%20glucidiques.pdf) ;
référence de méthode pour ce document seulement, jamais citée dans l'app).

(Règle 2 changée le 18/11/2026 : le macro principal de la famille, voir « Retours des coachs du 18/11 ».)

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

- **Objectifs du jour : la saisie d'abord, une estimation sur demande** (retour de Maxence du 16/11/2026 : « je parle
  des kcal, je peux pas le modifier ? » ; le champ vide montrait en gris le total des repas, 1 579 kcal, qu'il
  prenait pour une valeur figée). Feuille « Objectifs du jour » : Calories, Protéines, Glucides, Lipides ; un champ
  vide dit « Aucun », le total des repas prévus est écrit dessous, « Aucun objectif » vide tout. Protéines en
  **g ou g/kg** (un toucher sur l'unité ; poids des Réglages ; gardées en grammes dans le plan, les grammes exacts ne
  changent pas tant que le champ n'est pas retouché ; réglage de l'appareil `dietProteinPerKg`). Sans objectif, le
  total prévu par le plan ce jour-là (remplacements du jour compris : un équivalent ne donne jamais « 217 sur
  215 kcal ») sert de repère, et l'écran le dit (« Repère : le total prévu par ton plan »).
- **« Me proposer des objectifs »** (lien secondaire, jamais au centre) : objectif (prise de masse, maintien, sèche),
  activité (4 niveaux), sexe (pré-rempli par Réglages › Entraînement › Sexe), âge (18 à 80 ans), taille, poids
  (Réglages). Calcul sur l'appareil, réponses ni gardées ni envoyées (`js/data/diet-estimate.js`) : Mifflin-St Jeor
  (Am J Clin Nutr 1990) × 1,2 / 1,375 / 1,55 / 1,725 ; + 10 % en prise de masse (bas de la fourchette de 10 à 20 %
  d'Iraki et al., *Sports* 2019, [PMC6680710](https://pmc.ncbi.nlm.nih.gov/articles/PMC6680710)), − 15 % en sèche ;
  protéines 1,8 g/kg (2,2 en sèche : Morton et al., *BJSM* 2018, plateau 1,62 g/kg, IC jusqu'à 2,2 ; ISSN 2017 :
  1,4 à 2,0) ; lipides 0,9 g/kg et au moins 20 % de l'énergie (bas de la fourchette EFSA de 20 à 35 %) ; glucides :
  le reste. Jamais sous le métabolisme de base ni sous 1 200 kcal. Affichage : les quatre valeurs, l'explication
  (« 2 980 kcal = besoins estimés (2 710 kcal) + 10 % », « Protéines 1,8 g/kg · lipides 0,9 g/kg · glucides : le
  reste »), « Estimation, pas un avis médical », la méthode et ses sources (règle 1.4.1 d'Apple : méthode
  publiée) ; « Utiliser ces objectifs » (enregistre) ou « Ajuster » (remplit la saisie). Un coach : ni g/kg ni
  poids pré-rempli (le sien ne vaut pas pour ses élèves). Plan reçu d'un coach : objectifs en lecture seule
  (« Plan et objectifs fixés par … »), « Dupliquer pour le modifier ».
- **Plan perso : repas types facultatifs** (retour de Maxence du 16/11/2026 : « repas prévu, je comprends pas… c'est
  pas parce que j'ai mangé un truc que demain c'est ce repas que j'ai prévu »). Rien dans l'app ne copie le journal
  dans le plan (`dietAddExtra` n'écrit que `dietLog`, testé) : les aliments d'un plan ne viennent que de « Ajouter un
  aliment » de l'écran du plan (`diet-add-food`, `js/features/diet-editor.js`), atteint par « Mon plan » depuis
  Nutrition ; avant le 09/11, le journal ne savait pas ajouter un aliment à la journée, c'était le seul moyen de
  noter un produit (scanné). Désormais, pour un plan perso (ni reçu d'un coach, ni préparé par un coach) : sans
  aliment, l'écran du plan ne montre que les objectifs et « Composer des repas types (facultatif) » ; avec des
  aliments, « Repas types (facultatif) : ce que tu manges d'habitude, pour le copier vite dans ta journée »,
  « Total des repas types », l'écart nommé « Tes repas types font… », « Vider les repas types » (un toucher, repas
  gardés, Annuler). Journal : « Copier le repas type ». Le plan d'un coach garde « Total prévu » et ses repas prévus.
- **Balayer pour supprimer** (retour du 16/11 : « c'est mieux de slider plutôt que de faire Retirer ») : sur un aliment
  du journal (prévu : retiré pour la journée ; ajouté : supprimé) et d'un repas type, balayer à gauche révèle
  « Supprimer » ; au-delà de 60 % de la largeur, le lâcher supprime ; Annuler dans le toast. Axe verrouillé après
  10 px (un défilement n'ouvre rien). VoiceOver : le toucher de la ligne ouvre son menu, « Retirer » en second
  (`js/ui/swipe-row.js`, réutilisable par toute ligne `data-swipe-del`).
- **Changer de jour sans redessiner l'écran** (retour du 16/11 : « ça fait un refresh pas beau ») : la frise et
  « Revenir à aujourd'hui » remplacent la route sans transition (`navReplaceQuiet`) et seul le contenu sous la barre
  change ; défilement, barre et grand titre gardés, léger fondu de 180 ms dans le sens du jour (coupé avec Réduire
  les animations). Avant : transition d'écran complète et retour en haut.
- **Journée « finie »** (point vert de la frise, coche et son, « journée complète » lu par VoiceOver, série) : menu
  d'un coach, tous ses repas cochés ; plan perso, seulement l'objectif de calories atteint à 95 % (« Objectif de
  calories atteint ») ; sans objectif de calories, jamais (un compte : « 2 repas cochés sur 4 »). Panel « regard neuf »
  du 16/11 : « Journée complète » sur un plan de 233 kcal, petit-déjeuner seul noté (`dietDayFinished`,
  `dietProgressFinished`, `dietFinishedStreak`).
- **Demandes de Maxence du 16/11** (« j'ai mis dans petit-déj ce qui devrait être dans déjeuner… supprimer le dîner
  n'a aucun sens… des repas qui ont le même nom… un truc qui calcule automatiquement ») :
  - **Déplacer vers…** : menu d'un aliment de repas type (Annuler le remet à sa place) ; dans la journée, menu d'un
    ajout du jour ou feuille d'un aliment prévu (pour ce jour seulement : retiré de son repas, ajouté à l'autre ; le plan
    ne change pas ; Annuler).
  - **Repas de base** (`base` : b, l, s, d ; Petit-déjeuner, Déjeuner, Collation, Dîner) : « Masquer ce repas »
    (`hidden`, réversible, place gardée, « Repas masqués › Réafficher » en pied du plan ; ni dans la journée, ni dans
    les totaux, ni envoyé à un élève). Repas ajoutés : « Supprimer le repas », confirmation, Annuler.
  - **Noms en double** refusés (sans casse ni accents) : « Un repas porte déjà ce nom ».
  - **Migration douce** (`dietMigratePlan`, `sanitizeDiet`, jamais sur un plan reçu d'un coach, idempotente) : repas de
    base reconnus par leur nom, repas de base supprimé remis masqué (`mb_<clé>`), doublons « (2) ».
  - **Proposition automatique** : Réglages › Âge et Taille (facultatifs, `birthYear`, `heightCm`, sur l'iPhone
    seulement : SYNC_LOCAL_ONLY et hors de la copie iCloud, comme le poids). Feuille Objectifs du jour : carte
    « Proposition » en tête (2 980 kcal · P 134 · G 460 · L 67, explication, « Estimation, pas un avis médical »),
    objectif et activité à choisir et retenus (`dietEstGoal`, `dietEstActivity`), « Appliquer » ou « Ajuster » ;
    jamais appliquée seule ; recalculée avec le poids du moment. Ce qui manque est nommé (« il manque ton âge et ta
    taille ») avec « Compléter » (gardé dans Réglages ; sexe : celui du niveau de force, sinon `dietEstSex`). Pas
    de proposition sous 18 ans ni pour un coach.
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
  propagée) ; même plan différent des deux côtés : fusion à trois voies avec l'empreinte du plan au dernier échange
  (modifié d'un seul côté : ce côté gagne ; vrai conflit : le plus récent, `updatedAt`), 25/11, docs/COACH_WEB.md « Plans diète » ; plan suivi de l'iPhone gardé s'il existe encore. Un profil renvoyé par une ancienne app (sans
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

## Eau (17/11/2026)

Objectif en litres, verres notés d'un toucher, `targets.water` dans le plan du coach : contrat dans `docs/EAU.md`.

## Retours des coachs du 18/11/2026 (branche nutri-coachs)

Vocaux WhatsApp de deux coachs, puis demande de Maxence sur l'éditeur du coach. Rien en production.

### Recherche avant le scan, alias
- Un coach croyait qu'il fallait scanner chaque aliment. Feuille « Ajouter un aliment » : **recherche en tête**, puis une
  ligne discrète « Produit de marque ? Scanner » (« Saisir le code-barres » sans caméra), puis les résultats. Champ vide :
  « Récents » (5 derniers aliments choisis, avec leur dernière quantité, `data.dietRecentFoods`, 8 au plus, sur l'appareil)
  puis « … aliments de la table Ciqual, sans rien scanner ». Un ajout au plan dit « Ajouté : … » avec **Annuler**.
- **Alias** (`ALIASES` de `scripts/prepare-foods.py`, clé `alias` de `data/foods.json`, ignorée par une app d'avant) : un nom de
  salle pour un aliment Ciqual qui est le même produit, aux valeurs Ciqual inchangées, avec la source dite sous le nom
  (« Valeurs Ciqual : Farine de riz ») et gardée dans l'aliment (`of`). Liste : Crème de riz (9520 Farine de riz), Blanc
  et Filet de poulet cru / grillé (36017, 36018), Blanc de dinde grillé (36306 escalope), Porridge à l'eau (9313 flocons
  d'avoine cuits à l'eau), Lait d'amande (18107 boisson à l'amande nature).
- Vérifiés sans alias (déjà trouvés) : flocons d'avoine (32140), beurre de cacahuète (15202), riz basmati cuit (9125),
  steak haché 5 %, thon au naturel, fromage blanc 0 %, blanc d'œuf. **Absents de Ciqual, aucun alias** : whey, skyr,
  cottage cheese, caséine (« Créer « whey » » reste en tête de la recherche).

### Équivalences en un toucher
- Journée : chaque aliment prévu porte « Remplacer » écrit à droite (avant : une icône seule). La feuille donne la
  quantité déjà calculée en gras (« Riz blanc, cuit · **175 g** · 271 kcal… ») et l'écart de kcal à droite.
- Éditeur : « Remplacer par un équivalent » dans le menu d'un aliment (le plan change, Annuler).
- **Règle 2, nouvelle** (`swapAnchor`) : on garde le **macro principal de la famille**, protéines (viandes, laitiers),
  **glucides** (féculents, fruits), **lipides** (matières grasses), calories sinon ; kcal à 20 % près quand on garde un
  macro (15 % pour les calories). Aliments de base (`SWAP_STAPLES` : riz blanc et basmati cuits, pâtes cuites, semoule,
  quinoa, pomme de terre, patate douce, flocons d'avoine, pain blanc, lentilles, poulet, dinde, steak 5 %, thon, œuf dur,
  fromage blanc 0 %, avocat, beurre de cacahuète, huile d'olive) proposés en premier.
- Exemple réel (Ciqual 2025) : 350 g de « Pomme de terre, bouillie/cuite à l'eau » (16,8 g de glucides, 81 kcal pour 100 g)
  → **175 g de « Riz blanc, cuit »** (33,2 g, 155 kcal) : 350 × 16,8 / 33,2 = 177 g, arrondi aux 5 g ; 271 kcal pour 284,
  « −13 kcal ». Testé (`tests/unit/nutrition-coachs.mjs`). Pas d'IA : un calcul.

### Jours du plan : entraînement / repos, semaine
- **Données** : le jour 1 reste au premier niveau (`meals`, `targets`) ; `days` facultatif :
  `{ mode: 'session', more: [jour de repos] }` ou `{ mode: 'week', kinds: [7 × 't' | 'r'], more: [mardi … dimanche] }`, chaque
  jour `{ targets?, meals }`. Les jours ajoutés sont des copies du jour 1 **avec les mêmes identifiants** de repas et
  d'aliments : les coches restent quand l'élève change de jour dans la journée. Choix : « les mêmes repas avec d'autres
  quantités » par défaut (copie), libres ensuite ; le plus simple à comprendre pour un coach (Everfit fait pareil :
  objectifs de repos « Any day there are no workouts » ou « Specific days of the week »,
  help.everfit.io/en/articles/4578482).
- **Quel jour** (`dietDayIndex`, `dietDayPlan`) : `session`, jour d'entraînement si une séance est enregistrée ce jour-là
  ou en cours aujourd'hui (`dietTrainedOn`, même règle que l'eau), sinon repos ; le choix à la main se garde dans le
  journal (`dietLog[jour].kind`, « Aujourd'hui : jour de repos · Changer », un toucher, Annuler). `week` : le jour de la
  semaine. Tout le calcul du jour (coches, totaux, journée complète, eau, sel) lit le plan du jour.
- **Le matin d'un jour ON** (demande du 18/11) : aujourd'hui, sans séance ni réponse, l'app montre le **jour d'entraînement**
  et pose « Séance aujourd'hui ? Oui | Non » (carte Nutrition de l'accueil et haut de Nutrition), une fois par jour ; la
  réponse est gardée pour la journée (`dietLog[jour].kind` + `kindBy: 'ask'`), une séance faite ensuite passe devant,
  « Changer » (choix à la main, `kind` sans `kindBy`) passe devant tout. Ordre complet : `dietDayIndex` (manual, session,
  ask, guess, none). Écarté : déduire du programme (séance suivante disponible selon la récupération) : il dit quand une
  séance est possible, pas si la personne s'entraîne, et se tromperait les semaines irrégulières ; la question est juste et
  coûte un toucher. Jour passé sans séance ni réponse : repos.
- **Éditeur** : cellule « Jours » (Tous les jours pareils, Entraînement et repos, Semaine ; revenir à un seul jour garde le
  premier, confirmation et Annuler), cellule « Consigne » du plan ; vue des jours (une ligne par jour : type, repas, kcal,
  macros, objectifs), écran d'un jour (`diet-plan:ID:I`, choix des 7 jours ou entraînement / repos en tête, type du jour,
  jour précédent et suivant, **glisser** à gauche ou à droite). Copies : « Copier vers d'autres jours… » (menu d'un repas,
  jours à cocher, remplace le repas du même nom), « Copier ce jour vers… », « Mettre pareil sur les 7 jours »
  (confirmation sobre, Annuler). Réordonner (Monter, Descendre) et « Dupliquer ce repas » existaient.
- **Élève** : la ligne du jour sous la frise ; plan à 7 jours, « Mercredi · Repos · Voir la semaine » ouvre le jour, on glisse
  vers les autres.

### Envoi
- « Aperçu et envoi » (`diet-send:ID[:ÉLÈVE]`, `js/features/diet-week.js`) : une ligne par jour (repas, kcal, macros,
  objectifs dont eau et sel, écart court « Prévu : 1 569 kcal sous l'objectif »), élèves à cocher (« Tous »), un envoi par
  élève (3 à la fois, limite de 24 h), le plan reste dans **Plans de nutrition** (même titre que pour un pratiquant depuis le 26/11). Depuis la fiche
  d'un élève, l'élève est coché d'office (remplace l'alerte de relecture).
- **Format** : `{ kind: 'diet', v: 1, diet: { …, days? } }`. `v` reste 1 : une app d'avant lit `meals` et `targets` et affiche
  le jour 1 tous les jours, sans planter (elle ignore `days`) ; un plan v1 sans `days` s'affiche comme avant. **Aucune
  migration** : le serveur ne lit pas `data` (forme, 200 Ko). Taille testée : 7 jours × 6 repas × 8 aliments sous 200 Ko ;
  au-delà, « Plan trop gros pour être envoyé : retire des jours ou des aliments ».
- Synchro (accord de nutrition) : `days` voyage avec le plan. Un appareil resté sur une version d'avant qui réécrit le plan
  le perd (même risque que tout champ ajouté, comme `targets.water`).

### Eau en verres, avec une fourchette
- Objectif du plan en fourchette : `targets.water` reste le **haut** (une app d'avant le lit seul), `targets.waterMin` le bas.
  Feuille Objectifs du jour : « Eau de … à … L » (un seul champ : objectif simple). Atteint dès le bas.
- Carte Eau : « 1 L · objectif 3 à 5 L », jauge avec la zone du bas au haut, **verres à cocher** (`waterGlassPlan` : 1 L si
  la fourchette fait 1 L ou plus, sinon 25 cl, 16 verres au plus), « Un verre = 1 L · 3 au moins » ; un toucher sur un verre
  vide l'ajoute, sur le dernier plein le retire (Annuler). Boutons rapides gardés. Accueil : « 1,2 / 3 à 5 L ».

### Sel
- Ciqual : colonne « Sel chlorure de sodium (g/100 g) » ajoutée à `data/foods.json` (11e colonne, `per.s`, arrondi demi vers
  le haut au centième) ; « traces » et « < x » : 0 ; « - » : inconnu (119 aliments), jamais inventé. Produit scanné : le sel
  d'Open Food Facts (`salt`) compte aussi. Fichier source retéléchargé le 18/11 sur recherche.data.gouv.fr
  (doi:10.57745/RDMHWY, fichier 666260, `Table Ciqual 2025_FR_2025_11_03.xlsx`, sha256 5555c572…fbb0), licence lue dans
  l'API : **Licence Ouverte Etalab 2.0** (pas ODbL, qui est celle d'Open Food Facts) ; même sortie qu'avant pour les autres
  colonnes.
- Objectif en fourchette (`targets.saltMin`, `saltMax`, 0,5 à 15 g ; l'un, l'autre ou les deux), pour le coach comme pour
  un plan perso. Au-dessus de 5 g, la feuille du **coach** dit « Repère de l'OMS pour un adulte : moins de 5 g de sel par
  jour » (who.int/fr/news-room/fact-sheets/detail/salt-reduction : « moins de 5 g de sel par jour, soit un peu moins
  d'une cuillère à café »). Rien n'est bloqué, et rien n'est dit à l'élève : aucune règle ne l'exige, et il n'existe pas
  de repère officiel plus haut pour les sportifs (l'EFSA note seulement des pertes par la sueur plus fortes à l'effort).
- Bilan du jour : une ligne « Sel 2,1 sur 3 à 5 g » et « + Sel ajouté », affichée avec un objectif ou du sel ajouté.
  Feuille Sel : sel des aliments mangés (et combien n'ont pas de valeur), sel ajouté, **Pincée environ 0,4 g** et
  **Cuillère à café environ 6 g** (USDA FoodData Central, « Salt, table », mesures « dash » et « 1 tsp » ; aucune source
  officielle française pour la pincée), Autre en grammes, Supprimer. `data.saltLog` (120 jours) : sur l'appareil seulement
  (SYNC_LOCAL_ONLY, hors copie iCloud). Aucune alerte, aucun rouge.

### Mini-panel du 18/11 (5 agents, une planche de 7 écrans : 7/10 chacun)
Deux coachs nutrition, une pratiquante en sèche, un expert ergonomie Apple, un coach débutant en tech. Corrigé :
« Un verre = 1 L » contredisait « Verre 25 cl » (4 sur 5) → « Une case = 1 L », « verre » gardé pour 25 cl ; sel « sur 3 à 5 g »
ambigu → « objectif 3 à 5 g » ; aperçu « 1 569 kcal sous l'objectif » lu comme prévu → « 731 kcal prévues sur 2 300 : il
manque 1 569 kcal » ; envoi : confirmation qui nomme les élèves et dit les jours loin de l'objectif (peur d'écraser le plan
du mauvais élève) ; toast « Jours : semaine » → « 7 jours, copies du premier jour ». Écarté : macros « Pas d'objectif »
(choix du coach, règle d'avant) ; type de jour prévu d'avance en mode entraînement / repos (voir la limite connue : le
mode Semaine le fait, jour par jour).

### Itérations du panel (mêmes 5 profils, une planche, note et « la chose pour passer à 9 »)
| Tour | Coach 1 | Coach 2 | Pratiquante | Ergonomie | Coach débutant | Corrigé ensuite |
|---|---|---|---|---|---|---|
| 1 | 7 | 7 | 7 | 7 | 7 | voir plus haut |
| 2 | 8 | 8 | 8 | 8 | 7 | question du jour expliquée ; « Copier vers les autres jours de repos » ; aperçu sur deux lignes, le jour s'ouvre d'un toucher ; « Ce qu'il a déjà coché reste » |
| 3 | 8 | 7 | 8 | 8 | 7 | question pleine largeur, Oui / Non dessous ; « repas des jours de séance » ; écarts dits en clair et « Revoir les jours » ; captures avec un plan réaliste (objectifs propres au jour de repos) |
| 4 | 8 | 8 | 8 | 8 | 8 | « Repos » en pastille dans la bande des 7 jours ; « + Pincée 0,4 g » d'un toucher ; eau et sel une fois dans l'aperçu s'ils sont les mêmes chaque jour |
| 5 | 8 | 8 | 8 | 8 | 8 | écart de l'aperçu dès 5 % ; « 175 g cuit » dans Remplacer |

Non traité ici, fait ensuite (branche nutri-suivi-coach) : voir côté coach les coches de l'élève (« Suivi de la diète par le
coach ») ; toast qui recouvrait le bas de l'écran (plus serré, plus bas, seul son bouton se touche : le texte laisse passer les
touchers) et rond à cocher de la carte de l'accueil (dessiné à 26 pt dans sa zone de 44 pt, comme les ronds des repas faits).

### Tests
`tests/unit/nutrition-coachs.mjs` (sel et alias de la base, pomme de terre → riz, jours, copies, envoi et taille, eau,
sel, récents) ; `tests/test_nutri_coachs.py` (lot `nutri_coachs` : éditeur du coach, élève jour de repos et d'entraînement,
Remplacer, eau en verres, sel, semaine et glissé ; iPhone SE et 13, clair et sombre, texte agrandi).

## Suivi de la diète par le coach (18/11/2026, branche nutri-suivi-coach, PAS EN PRODUCTION)

Demande la plus citée par les coachs du mini-panel (plafond à 8/10) : voir si l'élève suit sa diète. Migration
`20261118010000_suivi_diete_coach.sql` écrite et testée, **pas appliquée** ; ordre dans supabase/rollback/ORDRE.md, étape 14.

**Consentement** (même modèle que le poids, docs/COACH_V1.md « Partage avec le coach ») : case « Suivi de ma diète » dans
Réglages › Social et coach › Partager avec mon coach (« Repas cochés, eau, sel et écart avec l'objectif, jour par jour »),
décochée par défaut, montrée seulement si le serveur l'annonce (`student_shares().kinds` contient `diet_log`). Une ligne
`coach_shares` kind **`diet_log`**, datée, pour le coach actuel. `diet` reste l'accord « recevoir les plans diète » : deux
finalités, deux accords, retirer l'un ne touche pas l'autre (testé). Décocher, quitter le coach, être retiré ou supprimer
un compte efface tous les jours envoyés (cascade). Texte de l'écran : ce que le coach voit, « jamais le détail des aliments
ni les heures, 90 jours au plus » ; sans plan suivi, une ligne dit que le coach ne verra rien.

**Données minimales** (`dietShareDay`, js/data/diet-share.js) : par jour `{ day, plan, name, kind ('t' | 'r' | null), meals:
[{ n, ok }], kcal, p, c, f, goal: { kcal, p, c, f }, water (ml), waterGoal, waterMin (ml, objectif du plan seulement), salt,
saltMin, saltMax }`. Repas : ceux à faire ce jour-là (`dietDayRequired`), cochés selon `dietMealSatisfied` ; mangé = la règle
de l'écran (`dietDayProgress`) ; objectif = celui du jour, sinon le total prévu (repère de l'écran). Jamais un aliment, un
remplacement ou une heure (testé). Jour envoyé : un jour du journal, un jour avec de l'eau ou du sel, et aujourd'hui avec le
plan suivi. L'écart en % se calcule à la lecture (`dietShareGap`) : rien de dérivé n'est stocké.

**Conservation : 90 jours glissants.** Justification (RGPD art. 5.1.c minimisation et 5.1.e limitation de la conservation ;
CNIL, données de santé) : la finalité est de juger si une phase de diète a été suivie ; la plus longue phase du planning du
coach fait 12 semaines (docs/COACH_SUIVI.md), plus une semaine de marge. Au-delà, plus rien ne sert au suivi. Tenue de quatre
façons : l'app n'envoie que 90 jours, le serveur écarte tout jour plus ancien et les efface à chaque envoi, la lecture du
coach ne les rend jamais, et une purge quotidienne pg_cron (`purge-diete-coach-90-jours`, 03:41 UTC) efface ceux d'un élève
qui n'ouvre plus l'app. Le coach remonte 12 semaines au plus (chevrons), sous les 90 jours. **Validé par Maxence le 19/11/2026**, avec la migration, un partage du suivi séparé de celui des plans et la règle des pastilles (suivi : calories à ±10 % et protéines à 90 % au moins ; partiel jusqu'à 25 % d'écart ; « Diète pas suivie 3 jours » après 3 jours ; libellé « Diète manquée » remplacé le 19/11 pour reprendre le mot des pastilles).

**Envoi** (corrigé après l'audit du 19/11 : un deuxième appareil sans journal effaçait l'historique vu par le coach) :
seuls les jours qui ont une entrée sur l'appareil (journal de diète, eau ou sel) partent, jamais un jour fabriqué à partir
du seul plan suivi. L'envoi part au cochage de la case, puis 5 s après un geste de diète (coche d'un repas, Remplacer, retirer
ou ajouter un aliment du jour, eau, sel : `dietShareGesture` → `dietShareSchedule`, option `ifChanged`) et à la relecture du partage, et non plus après chaque
`save()`. Le serveur **fusionne jour par jour** (`insert … on conflict update`) : un jour reçu remplace le même jour, les
autres restent, deux appareils s'additionnent ; il ne supprime que les jours de plus de 90 jours et renvoie le nombre de jours
gardés. Un envoi refusé (`rate_limited`, `invalid_data`) est noté dans la console et repart au geste suivant, sans rien
d'affiché. Serveur : 92 jours et 128 Ko au plus par envoi, chaque champ borné (noms de 40 caractères sans contrôle, 8 repas,
kcal 0 à 20 000…), 120 envois par heure (`coach_share_dup`), décocher jamais limité ; RLS fermée, aucun GRANT sur la table,
RPC security definer. Synchronisation : un plan reçu sans `days` (appareil resté sur une version d'avant) garde les jours du
plan local au même identifiant (`mergeDietProfile`).

**Coach** (js/features/coach-diet-ui.js) : carte « Diète » de la fiche, sous l'envoi d'un plan : 7 jours en pastilles (vert
plein et coche = **suivi**, écart de calories de 10 % au plus ; anneau vert et point = **partiel**, 25 % au plus ; gris et trait
= **pas suivi** ; pointillé = rien de noté ; aujourd'hui non fini : anneau simple, « en cours », jamais « pas suivi »). Sans
objectif de calories : tous les repas cochés = suivi, une partie = partiel. Légende des seuils sous la bande. Un toucher sur un
jour : son détail dessous (plan et type du jour, repas cochés et ceux qui manquent, calories et écart en clair, macros sur
objectifs, eau, sel). Semaine d'avant / d'après (12 semaines). Élève qui ne partage pas : « Non partagé par l'élève » et où il
peut le partager, aucun chiffre. Serveur sans la fonction (PGRST202) ou lecture en échec : rien.

**À relancer** (Mes élèves) : `coach_diet_overview()` (un appel pour tous les élèves, 8 derniers jours en bref : aujourd'hui et les 7 d'avant) ; un élève qui
partage sa diète depuis au moins 3 jours et dont les 3 jours d'avant aujourd'hui sont tous « pas suivi » ou sans rien de noté
prend le signal orange « Diète pas suivie 3 jours » (après l'inactivité et la baisse de séances, avant les records). Il compte alors
dans le filtre « À relancer », le résumé de la semaine et le tri.

**Mini-panel du 18/11** (les 5 profils du mini-panel nutrition, une planche de 7 écrans élève et coach, JSON court) :

| Tour | Coach 1 | Coach 2 (prépa) | Pratiquante | Ergonomie | Coach débutant | Corrigé ensuite |
|---|---|---|---|---|---|---|
| 1 | 7 | 6 | 8 | 8 | 6 | texte du partage en 3 paragraphes et « En savoir plus » ; « Annuler » sur le toast du partage donné ; fiche ouverte sur hier (aujourd'hui « en cours », sans %) ; suivi = calories ET protéines (90 %) ; une ligne par macro avec son écart ; eau et sel situés ; partiel en demi-disque, légende en mots ; « Écrire à » ; ligne Diète dans Mes élèves |
| 2 | 8 | 8 | 9 | 9 | 8 | 7 mini-pastilles et « Diète non partagée » dans Mes élèves ; règle repliée (« Comment c'est compté ») ; moyenne de la semaine ; eau et sel chiffrés ; pourquoi un jour est partiel ; message déjà écrit (jamais envoyé seul) |
| 3 | 9 | 8 | 9 | 9 | 9 | moyenne avec l'objectif et l'écart (demande du coach 2), mini-pastilles agrandies : faits après le tour 3, non renotés |

Écarté : rappel « Partagé avec max » sur la carte de l'accueil (pratiquante, pour 10 : la carte de l'accueil est partagée par
tous et resserrée en petite hauteur, à voir avec Maxence) ; compteur « hors diète » dans le résumé de Mes élèves (« à relancer »
compte déjà ces élèves) ; texte agrandi plus compact (comportement commun des listes de l'app).

**Mise en production** : OTA d'abord ou migration d'abord, au choix : une app d'avant ignore `diet_log` (elle ne montre pas la
case, et `cleanShareState` écarte la donnée) ; une app à jour sur un serveur d'avant ne montre pas la case (absente de `kinds`)
ni la carte (PGRST202). Retour arrière : `20261118010000_suivi_diete_coach_down.sql` (efface jours et consentements).

**Tests** : `tests/sql/suivi_diete_test.sql` (droits, RLS, bornes, 90 jours, lecture du seul coach consenti, retrait, quitter,
rôle retiré, limites, cascade), `rollback_nuit_check.sh`, `prod_order_test.sh`, charge 300 élèves (`tests/charge/serveur.sh`) ;
`tests/unit/diet-share.mjs` ; `tests/test_suivi_diete.py` (lot `suivi_diete` : case de l'élève, envoi, retrait ; carte du
coach, détail, semaine d'avant, « Non partagé », À relancer ; iPhone SE et 13, clair et sombre, texte agrandi).

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
  name, consigne?, targets?: { kcal?, p?, c?, f?, water?, waterMin?, saltMin?, saltMax? }, archived?, updatedAt?,
  days?: { mode: 'session' | 'week', kinds?: ['t' | 'r' × 7], more: [{ targets?, meals }] },   // jours 2 et suivants (18/11)
  fromCoach?: { coachId, name, sentAt },                // plan reçu : lecture seule
  meals: [{ id, name, note?, items: [{ id, name, food: code Ciqual | null, fam, g, per: { k, p, c, f }, src, ecalc?,
    por?: { n, u, pl, g } }] }] } },   // por : unité choisie (« 2 œufs »), g fait foi
dietActive: id,                      // plan suivi (profil)
dietFoods: [{ id, name, fam, per, code?, src?, salt?, portion?: { u, pl, g } }], // aliments perso (profil), 200 au plus
dietFoodsGone: [id],                 // aliments perso retirés (profil, avec accord) : la fusion ne les fait pas revenir
dietLog: { 'AAAA-MM-JJ': { plan, done: [id de repas], swaps: { [id d'aliment]: aliment }, extras?, removed?: [id d'aliment], meals: [id], off?: [id de repas], copied?: [id de repas], blank? } },   // SYNC_LOCAL_ONLY ; meals : instantané du jour ; blank : jour commencé vide
dietConsent: { on, at },             // accord daté (profil, part toujours)
dietConsentAsked, dietHideNumbers, dietStreakOff, dietEmptyDays, dietProteinPerKg: true,   // réglages de l'appareil (SYNC_LOCAL_ONLY)
dietCoachConsent: { on, at },        // accord « plans du coach » gardé ici quand le serveur n'est pas à jour (SYNC_LOCAL_ONLY)
// Suivi partagé avec le coach (18/11) : aucune clé de plus ; le consentement vit sur le serveur (coach_shares 'diet_log'),
// l'empreinte du dernier envoi dans localStorage mdlf_coach_share_d
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
- ~~**Coches visibles par le coach**~~ : écrit le 18/11/2026, pas en production (voir « Suivi de la diète par le coach »).
- ~~**Plusieurs plans selon le jour**~~ : fait le 18/11/2026 (voir « Retours des coachs du 18/11 »). Recettes, liste de courses : plus tard.
- ~~**Calcul des besoins**~~ : proposition sur demande depuis le 16/11/2026 (voir « Santé »).
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
| `js/data/diet-estimate.js` | Objectifs du jour : proposition estimée (Mifflin-St Jeor), protéines en g/kg (fonctions pures) |
| `js/data/coach-diet.js` | Envoi par le coach, état des envois, plans reçus |
| `js/data/diet-share.js` | Suivi de la diète partagé avec le coach : résumé d'un jour, envoi, statut par seuils d'écart, À relancer, lecture du coach |
| `js/features/coach-diet-ui.js` | Carte « Diète » de la fiche d'un élève (7 jours en pastilles, détail du jour, semaines d'avant) |
| `js/features/nutrition-ui.js` | Écran du jour, carte de l'accueil, remplacement, entrées Programme et coach |
| `js/data/food-portions.js` | Portions courantes (table), unité du paquet scanné (`offPortion`), textes « 2 œufs » (chargé avant `nutrition.js`) |
| `js/features/diet-qty.js` | Contrôle de quantité « Grammes \| unité » et feuille de quantité (`dietAskQty`) |
| `js/features/diet-editor.js` | Plans diète, éditeur, recherche d'aliment, aliment perso, objectifs |
| `js/features/diet-week.js` | Jours du plan (vue des jours, écran d'un jour, glisser), copies de repas et de jours, aperçu et envoi à plusieurs élèves |
| `js/features/diet-settings.js` | Réglages de la nutrition (Mes aliments, chiffres masqués, série, accord) et question de l'accord |
| `css/nutrition.css` | Styles (couleurs : tokens `--macro-*`, `--check-*` de `css/base.css`) |
| `tests/unit/nutrition.mjs` | Bornes, macros, coches, série, équivalences sur la vraie base, plan du coach, notification |
| `tests/test_nutrition.py` | Parcours complets (5 appareils, clair et sombre) et captures |

## Écran du jour illustré (15/11/2026, branche nutri-v2)

Demande de Maxence : chaque onglet aussi agréable que l'accueil, jamais un écran fait seulement de texte et de chiffres,
chaque visuel porte un sens.

- **Bilan** : anneau des calories (vert = avancée) et une barre par macro, chacune à sa couleur (`--macro-p`, `-c`, `-f`,
  tokens sobres de css/theme-sobre.css) avec une pastille devant son nom : la couleur est nommée. Écran de 320 pt :
  anneau de 92 pt à côté des barres (au-dessus, le bilan prenait tout l'écran).
- **Repas en cartes** : titre plus grand, barre de composition sous l'en-tête (part des kcal venant des protéines,
  glucides et lipides, 4/4/9 kcal par gramme), aux mêmes couleurs ; légende des lettres avec les pastilles.
- **Aliments** : pastille grise avec l'icône de la famille d'équivalence (viande, féculent, laitier, matière grasse,
  fruit, légume, sucré, boisson, plat composé, aide culinaire ; icônes `food.*` du sprite d'index.html), dans le journal,
  Mon plan, la recherche, les équivalents et Mes aliments. Aliment perso ou scanné : famille tirée de ses macros.
  Les actions de la liste (ajouter, copier le plan, reprendre le repas d'hier, remettre) ont leur icône dans la même colonne.
- Images et barres cachées à VoiceOver (noms et grammes déjà dits). Texte agrandi : plus de pastille de famille, comme
  les vignettes de l'accueil. Aucune photo d'aliment : la table Ciqual n'en a pas.
