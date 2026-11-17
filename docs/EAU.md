# Eau : objectif en litres, verres notés d'un toucher

Demande de Maxence du 17/11/2026 : suivre l'eau, avec un objectif en litres et des moyens simples de noter ce qu'on boit.
Branche `hydratation`, rien en production.

## Objectif du jour : la règle

Dans cet ordre (`waterGoalFor`, js/data/water.js) :

1. **Plan de nutrition** : `targets.water` (litres) fixé par le coach. Lecture seule chez l'élève (« Fixé par max dans
   ton plan de nutrition. »), sans bonus d'entraînement : le coach décide.
2. **Choisi à la main** : `data.waterGoalL`, par pas de 0,25 L (grille de 0,25 : depuis 2,3 L, « + » donne 2,5 et « − »
   2,25), de 0,5 à 6 L. La feuille règle cette base et dit le total du jour dessous (« Aujourd'hui : 3,5 L (dont +0,5 L
   séance) »).
3. **Repère conseillé** (par défaut), en une phrase dans l'app : « Repère de l'EFSA : 2 L de boissons par jour pour un
   homme, plus 0,5 L les jours de séance. »
   - **Base** : 80 % de l'apport adéquat de l'EFSA, soit **2,0 L** de boissons pour un homme (2,5 L au total) et
     **1,6 L** pour une femme (2,0 L au total). Sexe non précisé : **1,8 L**. Sexe lu dans Réglages › Entraînement
     (niveau de force), sinon celui donné pour la proposition d'objectifs (`dietEstSex`), jamais la silhouette.
   - **Jour d'entraînement** : **+ 0,5 L** si une séance est enregistrée ce jour-là ou en cours aujourd'hui.

### +0,5 L les jours de séance (décision du 17/11 : option C, vote 5/5 des coachs, pratiquants et expert)

- Réglage **« +0,5 L les jours de séance »** dans Réglages de la nutrition › Eau, **allumé par défaut**, désactivable
  (`data.waterTrainOff = true` quand il est coupé ; absent : allumé ; sur l'appareil seulement).
- Il s'applique au **repère conseillé** comme à l'**objectif choisi** : 3 L choisis deviennent 3,5 L un jour de séance.
  Jamais à un objectif **fixé par le coach** dans le plan : le coach décide.
- La carte dit le total du jour et d'où vient la hausse : « 0 sur 3,5 L (dont +0,5 L séance) » ; VoiceOver : « …, dont
  0,5 litre pour la séance ». L'accueil montre le total seul (« 1,2 / 3,5 L »), pour rester sur une ligne.

### Sources (lues le 17/11/2026)

- **EFSA**, Scientific Opinion on Dietary Reference Values for water, *EFSA Journal* 2010;8(3):1459
  ([doi](https://doi.org/10.2903/j.efsa.2010.1459), texte lu sur la copie de l'université DTU) : « Adequate total water
  intakes for females would have to be 2.0 L/day (P95 3.1 L) and for males 2.5 L/day (P95 4.0 L) » ; ces valeurs
  « include water from drinking water, beverages of all kind, and from food moisture and only apply to conditions of
  moderate environmental temperature and moderate physical activity levels (PAL 1.6) » ; section 3.1 : « Intake of
  water is predominantly through consumption of drinking water and beverages (80%) plus water contained in food (20%) ».
  D'où 80 % pour la part à boire.
- **ACSM**, Exercise and Fluid Replacement, *Med Sci Sports Exerc* 2007;39(2):377-90
  ([PubMed 17277604](https://pubmed.ncbi.nlm.nih.gov/17277604/)) : sueur de 0,5 à 2,0 L par heure selon l'effort et la
  chaleur, plan individuel conseillé (pesée avant et après). Une séance d'environ une heure, bas de la fourchette :
  + 0,5 L. Choix de l'app, pas une consigne de l'ACSM.
- **France** : le PNNS dit de boire de l'eau « à volonté » ; Manger Bouger a longtemps écrit « 1 L à 1,5 L par jour »,
  et l'avis du HCSP de décembre 2025 (PNNS 5) note qu'il n'y a pas de recommandation chiffrée pour le grand public.
  Pas de valeur française reprise : l'EFSA est la seule référence chiffrée et sourcée.
- **Règle en ml/kg écartée** : les « 30 à 35 ml/kg » qui circulent viennent de fiches de soins ; la source primaire
  (NICE CG174, 25 à 30 ml/kg/j) vise la perfusion à l'hôpital, pas une personne en bonne santé. Le poids n'entre donc pas
  dans le calcul.
- Aucune allégation médicale : « Des repères, pas un avis médical. » sous la feuille de l'objectif ; pas d'alerte, pas
  de rouge, rien de bloquant.

## Noter ce qu'on boit

- **Nutrition** : carte « Eau » sous les repas (avant les réglages), au jour de la frise. Verre qui se remplit et jauge,
  « 1,2 sur 2,8 L », « Objectif conseillé / choisi / du plan » ou « Objectif atteint » (sans point d'exclamation).
  Boutons « + Verre 25 cl », « + Bouteille 50 cl », « + 1 L », contenants perso, « Autre » (quantité libre : 33 = 33 cl,
  0,5 = 0,5 L, « 330 ml », « 1,5 L »). « n ajouts · Historique » : les ajouts du jour (heure, quantité, Supprimer) et les
  7 derniers jours. Sans plan : la carte Eau en tête de Nutrition, au-dessus de « Pas encore de plan ».
- **Un toucher ajoute tout de suite** (rien au pointerdown), retour haptique (succès quand l'objectif est atteint), toast
  « + 25 cl · 1,45 sur 2,3 L » avec **Annuler**.
- **Contenants perso** : Réglages de la nutrition › Eau › Contenants (« Ma gourde », 75 cl), 4 au plus, noms uniques ;
  ils s'ajoutent aux boutons. Supprimer : Annuler dans le toast.
- **Activer** : « Suivre l'eau » (bas de Nutrition, ou Réglages de la nutrition › Eau). Éteint par défaut. Un objectif
  d'eau fixé par le coach l'affiche sans rien activer.
- **Minuit** : le jour est lu au toucher (`localISO()`), et l'écran se redessine au changement de jour comme le reste de
  Nutrition (`dietRefreshDay`).

## Accueil : pourquoi une ligne

- Avec un plan suivi : **une ligne** sous les repas de la carte Nutrition, « Eau 1,2 / 2,8 L », jauge fine et
  « + Verre 25 cl » (44 pt). Pas de carte en plus : l'accueil reste celui de l'entraînement, la nutrition y garde une
  seule carte, et le geste le plus fréquent (un verre) se fait sans ouvrir l'écran.
- Sans plan, l'eau suivie : **une petite carte** avec la même ligne, seulement. Rien quand le suivi est éteint.
- Texte agrandi : sans le verre (comme l'anneau), bouton en pleine largeur sous la ligne.

## Couleur

Jauge et verre en **vert** (`--check-on`) : dans le thème sobre, le vert dit « fait et progression » et c'est déjà la
couleur de l'anneau des calories (avancée vers l'objectif du jour). Le bleu est pris par les protéines
(`--sb-macro-p`), l'orange est réservé aux actions (les boutons gardent le texte orange des boutons secondaires), le
rouge aux muscles et aux suppressions. Piste grise (`--fill`), aucun dégradé.

## Données

```js
waterOn: true,                               // suivi activé (réglage de l'appareil)
waterGoalL: 2.75,                            // objectif choisi (base sans bonus), litres, pas de 0,05 (absent : repère)
waterTrainOff: true,                         // +0,5 L les jours de séance coupé (absent : allumé)
waterCups: [{ id, name, ml }],               // contenants perso, 4 au plus, 50 ml à 3 L
waterLog: { 'AAAA-MM-JJ': [{ id, ml, at }] } // ajouts (10 ml à 3 L, 60 par jour), 120 jours
// plan de nutrition : targets.water (litres, 0,5 à 6, pas de 0,05), fixé par le coach
```

- **Sur l'appareil seulement**, comme le journal des repas (`dietLog`, que la synchro n'envoie pas non plus) :
  les cinq clés sont dans `SYNC_LOCAL_ONLY`, `waterLog` est retiré de la copie iCloud (`CLOUD_PRIVATE_KEYS`, règle
  5.1.3(ii) d'Apple : donnée de santé saisie à la main). Dans l'export JSON (Réglages › Sauvegarde). L'export CSV ne
  contient que les séances, la nutrition n'en a pas : rien ajouté.
- **Objectif du coach** : dans le plan, donc copié sur le compte avec l'accord de nutrition (`dietConsent`) comme les
  autres objectifs. Envoi : même canal `coach_send_programme`, format `{ kind: 'diet', v: 1 }` inchangé (champ en plus).
  Le serveur ne lit pas `data` (forme, 200 Ko, accord `diet`) : **aucune migration**. Une app d'avant ignore
  `targets.water` (`cleanDietTargets`) sans rien perdre d'autre.
- Le coach le saisit dans la feuille « Objectifs du jour » d'un plan qu'il prépare (champ « Eau », L). Un plan perso
  n'a pas ce champ : la personne règle son objectif sur la carte Eau (un seul endroit).

## Santé (HealthKit) : préparé, pas branché

Le module natif (ios/App/App/HealthPlugin.swift) écrit les entraînements et l'énergie active, lit le poids, les sorties
et le sommeil ; il **ne sait pas écrire l'eau**. Une mise à jour à chaud ne peut pas l'ajouter. Prêt côté JS :
`waterHealthSample(e)` → `{ type: 'dietaryWater', unit: 'mL', value, start, end, syncId: 'mdlf:eau:<id>' }` (testé, jamais
appelé). Pour une prochaine build :

1. `HealthPlugin.swift` : `HKObjectType.quantityType(forIdentifier: .dietaryWater)` dans les types partagés, demandé à
   part (l'ajouter à `shareTypes` redemanderait l'accord à tout le monde) ; méthode `saveWater({ value, start, syncId })`
   qui écrit un `HKQuantitySample` en `HKUnit.literUnit(with: .milli)` avec `HKMetadataKeySyncIdentifier` = syncId et
   `HKMetadataKeySyncVersion` ; `deleteWater({ syncId })` pour Annuler et Supprimer.
2. `Info.plist` : `NSHealthUpdateUsageDescription` à compléter (l'eau notée dans l'app).
3. JS : après `waterAdd`, si Santé est activé (`healthOn`) et que `Native.health.saveWater` existe, envoyer
   `waterHealthSample(e)` ; `waterRemove` → `deleteWater`. Rien n'est lu depuis Santé (pas de double compte).
4. Déclaration de confidentialité et docs/REVUE_APPLE.md : la nouvelle donnée écrite.

## Rappels : rien pour l'instant

À faire plus tard si demandé : une **notification locale** (`@capacitor/local-notifications`, déjà dans le projet,
docs/NOTIFICATIONS.md), réglable (heures, fréquence), jamais envoyée par le serveur, coupée quand l'objectif du jour est
atteint, et texte factuel (« Eau : 1,2 sur 2,3 L »). Elle demanderait l'autorisation des notifications au moment de
l'activer, pas avant.

## Tests

- `tests/unit/water.mjs` : repère EFSA et bonus, réglage du bonus (allumé par défaut, coupé, jamais sur le coach), priorité plan / choisi / repère, pas de 0,25 L, ajout, Annuler, minuit,
  bornes, nettoyage, contenants, quantité tapée, textes, jour d'entraînement, clés locales et iCloud, `targets.water`
  envoyé et reçu, échantillon Santé, accueil, textes sobres.
- `tests/test_eau.py` (lot `eau`) : parcours accueil → Nutrition → objectif → historique sur chaque appareil et thème ;
  jour de séance (« sur 3,5 L (dont +0,5 L séance) », réglage coupé, iPhone SE clair et sombre, texte agrandi), carte seule sans plan (iPhone SE, texte agrandi), objectif du coach, contenant perso, minuit, suivi éteint.
