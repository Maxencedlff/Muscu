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
- **Colonnes** : énergie « Règlement UE 1169/2011 » (kcal), protéines « N x facteur de Jones » (valeur de
  référence de Ciqual), glucides, lipides, sucres ; famille d'équivalence et sous-groupe Ciqual.
- **Valeurs particulières** (documentation, p. 9, 10, 16) : « - » = inconnue, jamais zéro (un aliment sans
  protéines, glucides ou lipides connus est écarté ; énergie inconnue recalculée 4/4/9) ; « traces » = 0 ;
  « < x » = 0 (sous la limite de quantification). Aliments infantiles écartés. Résultat : **3 117 aliments,
  261 Ko** (63 Ko compressé), en cache hors ligne (`sw.js`), lu à la première ouverture d'un écran de
  nutrition seulement.
- **Absents de Ciqual** et courants en salle : skyr, whey, certaines marques. D'où l'**aliment perso**
  (nom et valeurs pour 100 g de l'étiquette ; énergie calculée si laissée vide), gardé dans « mes aliments ».
- **Open Food Facts** (codes-barres, marques) : **pas en V1**. Base sous ODbL ([texte](https://opendatacommons.org/licenses/odbl/1-0/)),
  fiches sous DbCL, photos sous CC BY-SA ([OFF](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side)).
  Embarquer un extrait, c'est distribuer une base dérivée (§4.4) : elle reste sous ODbL et doit être
  fournie (§4.6), avec « (c) Open Food Facts contributors » sur chaque écran qui l'affiche. Mélanger OFF et
  nos données dans une même table la ferait passer sous ODbL. Si on l'ajoute : interrogation à la demande
  (« Produced Work », §4.5) ou table séparée, jamais fusionnée.

## Équivalences : la règle (js/data/food-swap.js, testée par tests/unit/nutrition.mjs)

Principe des « exchange lists » de l'ADA / Academy of Nutrition and Dietetics (« Choose Your Foods ») et des
équivalences de la diététique française : dans un même groupe, on échange des quantités qui apportent à
peu près la même chose ([annexe](https://mtsu.pressbooks.pub/nutrition2/back-matter/appendix-b-the-exchange-lists-for-meal-planning/),
[Fédération des diabétiques](https://afd29.federationdesdiabetiques.org/public/content/58/doc/Les%20Equivalences%20glucidiques.pdf)).

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
5. **Dix au plus**, deux au plus par premier mot du nom (riz, pâtes, puis semoule, pommes de terre…).

Le remplacement vaut **pour la journée** : le plan ne change pas, et l'écran le dit. Exemples réels
(base 2025) : 150 g de riz blanc cuit → 160 g de riz étuvé cuit, 155 g de riz basmati, 60 g de galette de
maïs soufflé, 305 g de polenta cuite… ; 150 g de filet de poulet grillé → 165 g de steak grillé, 150 g
d'escalope de dinde rôtie, 145 g d'escalope de veau…

## Santé : précautions

- **Aucun calcul de besoins.** Pas de formule de métabolisme, pas de « tu devrais manger ». Les objectifs
  sont fixés par le coach ou par la personne ; sans objectif, le total prévu par le plan sert de repère, et
  l'écran le dit (« Repère : le total prévu par ton plan »).
- **Pas d'alerte de « trop peu »**, pas de rouge quand on dépasse : la barre se remplit, c'est tout. Les
  études sur les applis de comptage et les troubles du comportement alimentaire (Levinson et al., *Eating
  Behaviors* 2017, [PMC5700836](https://pmc.ncbi.nlm.nih.gov/articles/PMC5700836/) ;
  [PMC8485346](https://pmc.ncbi.nlm.nih.gov/articles/PMC8485346)) recommandent justement de revoir ces
  alertes et d'orienter vers des professionnels.
- **Mention** sous l'écran et chaque plan : valeurs de Ciqual ou saisies, repères et pas avis médical,
  « pour un régime particulier, parles-en à un professionnel de santé ».
- Ce qui est noté (repas cochés) reste **sur l'iPhone** en V1.

## Où ça vit dans l'app, et pourquoi

- **Entraînement › Nutrition** (écran du jour) et une **carte sur l'accueil** quand un plan est suivi.
  L'accueil est l'endroit du « aujourd'hui » : on y démarre sa séance, on y coche son repas. La carte
  montre l'anneau des calories et le prochain repas, avec le bouton à cocher : pas besoin d'ouvrir l'écran
  (« cocher le petit bouton vert, hop tu passes à la suite »). Sans plan, rien sur l'accueil (aucun bruit
  pour qui ne s'en sert pas).
- **Programme › Plans diète** : on prépare ses plans là où on prépare ses programmes. Un coach y écrit les
  plans de ses élèves.
- **Pas de sixième onglet** : iOS en montre cinq au plus sans « Plus », et les cinq sont pris. La nutrition
  suit le même découpage que l'entraînement : on prépare dans Programme, on fait dans Entraînement.
- **Coach** : fiche d'un élève (Amis › Mes élèves) : « Envoyer un plan diète » et l'état de chaque envoi ;
  élève : carte de l'accueil, « Plans diète reçus » dans Mon coach.

## Données (`ppl_v2`)

```js
dietPlans: { [id]: {                 // profil synchronisé, fusion par union (comme userProgrammes)
  name, consigne?, targets?: { kcal?, p?, c?, f? }, archived?, updatedAt?,
  fromCoach?: { coachId, name, sentAt },                // plan reçu : lecture seule
  meals: [{ id, name, note?, items: [{ id, name, food: code Ciqual | null, fam, g, per: { k, p, c, f } }] }] } },
dietActive: id,                      // plan suivi (profil)
dietFoods: [{ id, name, fam, per }], // aliments perso (profil)
dietLog: { 'AAAA-MM-JJ': { plan, done: [id de repas], swaps: { [id d'aliment]: aliment } } },   // SYNC_LOCAL_ONLY
```

- Un plan est **autonome** : chaque aliment garde ses valeurs pour 100 g, relevées au moment du choix. Une
  nouvelle version de Ciqual ne change pas un plan, et un plan reçu s'affiche sans la base.
- Bornes (`sanitizeDiet`, appelé par `sanitizeData`) : 20 plans, 8 repas, 25 aliments par repas, noms de 40
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
- Aucune migration, aucun GRANT nouveau : rien à appliquer côté serveur.

## Hors V1 (et pourquoi)

- **Code-barres, Open Food Facts** : licence ODbL à isoler (voir plus haut) et module natif de lecture.
- **Photo d'un repas, reconnaissance par IA** : fiabilité des macros, coût, données envoyées à un tiers.
- **Journal libre** (« j'ai mangé autre chose ») et portions en unités (« 3 œufs ») : V2 ; en V1, grammes.
- **Coches visibles par le coach** : il faut le consentement de l'élève, donnée par donnée, comme le poids
  (`coach_shares`, kind `diet` à ouvrir, migration à écrire) ; en V1 le journal reste sur l'iPhone.
- **Plusieurs plans selon le jour** (jour d'entraînement, jour de repos), recettes, liste de courses.
- **Calcul des besoins** : volontairement absent (voir « Santé »).
- **Apple Santé** (écrire les macros) : demande une build et la déclaration de confidentialité.

## Avant une mise en production

1. Relecture du fondateur (règles d'équivalence, textes) et des deux coachs sur un plan réel.
2. `privacy.html` : ajouter les plans diète au profil synchronisé (comme les programmes) et dire que les
   repas cochés restent sur l'appareil.
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
| `js/features/diet-editor.js` | Plans diète, éditeur, recherche d'aliment, aliment perso, objectifs |
| `css/nutrition.css` | Styles (couleurs : tokens `--macro-*`, `--check-*` de `css/base.css`) |
| `tests/unit/nutrition.mjs` | Bornes, macros, coches, série, équivalences sur la vraie base, plan du coach, notification |
| `tests/test_nutrition.py` | Parcours complets (5 appareils, clair et sombre) et captures |
