# Machines de cardio : réglage noté au fil du chrono

Code : `js/data/machine-track.js` (logique, plages), `js/features/effort-machine.js` (feuille du chrono et bilan),
tests : `tests/unit/machines.mjs`, `tests/test_cardio.py` (`t_machines`, `t_alias`).

## Principe

- ▶ sur la série à faire d'une machine (Escaliers, Tapis de course, Vélo d'appartement, Vélo elliptique, Rameur) :
  chrono qui monte tout de suite (pas de préparation, la machine tourne déjà).
- Pendant l'effort, une rangée par réglage suivi : gros − / + (64 px), valeur touchée pour la taper.
  Chaque changement est daté à la seconde du chrono ; plusieurs −/+ en moins de 4 s comptent pour un seul changement.
- « Terminer » ouvre le bilan : moyenne pondérée par le temps, temps passé à chaque valeur, champs affichés par la
  machine (distance, étages, cadence, résistance du rameur), facultatifs. « Enregistrer » valide la série
  (durée arrondie à la minute dans `reps`, durée exacte dans `machine.end`), « Reprendre » relance le chrono.
- Rien n'est converti : un niveau n'a pas de vitesse, un niveau d'une marque ne vaut pas celui d'une autre
  (aucun constructeur ne publie de table niveau → vitesse ou niveau → marches/min). Le bilan le rappelle.
- Point de départ : la valeur et l'unité du début de la dernière fois pour cet exercice (le choix « Marches/min »
  ou « mph » reste donc d'une séance à l'autre) ; sans dernière fois, « — » (rien de supposé).

## Format (série de `sessions.data`)

```json
{ "weight": "", "reps": "25", "machine": { "end": 1502,
  "lvl": [[0, 7, "level"], [600, 10, "level"], [1201, 80, "spm"]], "floors": 42 } }
```

`[seconde du chrono, valeur, unité]` ; une valeur vaut jusqu'à la suivante de la même liste ; `null` = changement
d'unité sans valeur encore notée (ce temps n'entre dans aucune moyenne). Les versions précédentes de l'app gardent
le champ tel quel (`cleanHistoryEntry` corrige les champs qu'elle connaît sans reconstruire la série) ; seule la
modification d'une ancienne séance dans une version précédente (`add-session.js`) le perdrait.
Au plus 300 changements par grandeur (limite de taille de `sessions.data` : 200 Ko).

## Plages retenues et sources

Règle : plage plus large que toutes les fiches lues, pour qu'une machine non relevée ne soit jamais bloquée.

### Escaliers (StepMill, stair climber, stepper)

| Marque / modèle | Niveaux | Marches/min | Source |
|---|---|---|---|
| StairMaster StepMill (7000PT, SM916) | 1-20 | 24-162 | https://support.corehandf.com (manuels STM_7000PT_OM.pdf, SM916) |
| Life Fitness PowerMill | 0-25 (21-25 en option) | 12-185 | manuel Life Fitness PowerMill |
| Technogym Climb | 1-30 | 24-165, 1 étage = 16 marches | fiche Technogym Climb |
| Matrix ClimbMill | 25 ou 30 | 24-137 / 160 / 162 selon le modèle | fiches Matrix ClimbMill |

Retenu : un champ, bouton d'unité « Niveau » (0-30, pas de 1, par défaut) ou « Marches/min » (0-200, pas de 5).
Étages : jamais calculés (la hauteur d'un étage varie selon la marque), tapés tels que la machine les affiche.
Muscles : quadriceps et grand fessier principaux, mollets et ischios secondaires (EMG du stair stepping :
Zimmermann et al. 1994, J. Orthop. Sports Phys. Ther. 19(3) 173-180, https://www.bisp-surf.de/Record/PU199501072658 ;
ischios peu activés d'après les auteurs).

### Tapis de course

| Marque / modèle | Vitesse | Inclinaison | Source |
|---|---|---|---|
| Precor TRM 885 | 0,8-25,5 km/h (0,5-16 mph) | −3 % à 15 %, pas de 0,5 % | https://static.precor.com/sell-sheet/all/TRM/TRM885-Product-Brochure-ENG.pdf |
| Technogym Skillrun | jusqu'à 30 km/h (18,6 mph) | −3 % à +25 % | https://www.technogym.com/en-US/product/skillrun_DJJ-SKR.html |
| Life Fitness Integrity | 0,8-23 km/h, pas de 0,1 | 0-15 % | https://lifefitness.com/en-eu/catalog/cardio/treadmills/integrity-series-treadmill |
| Matrix Performance / Performance Plus | 0,8-24 / 26 km/h | 0-18 % / 0-20 % | https://world.matrixfitness.com/eng/cardio/performance/treadmill |
| Star Trac 10TRx FreeRunner | jusqu'à 24 km/h (15 mph) | 0-20 % | https://www.corehandf.com/products/star-trac-freerunner%E2%84%A2-10trx |

Retenu : vitesse en km/h (0-30) ou mph (0-19), pas de 0,1, bouton d'unité (les constructeurs publient les deux ;
la distance de l'app reste en km, l'allure /km ne change pas). Inclinaison −5 % à +30 %, pas de 0,5 %.
Interface : deux rangées compactes toujours visibles plutôt qu'une « valeur active » à choisir : vitesse et pente
se règlent séparément sur la console, un sélecteur coûterait un toucher de plus et cacherait l'autre valeur.

### Vélo d'appartement

| Marque / modèle | Niveaux | Affichage | Source |
|---|---|---|---|
| Life Fitness Integrity+ Lifecycle | 26 | 29-900 W | https://www.lifefitness.com/en-eu/catalog/cardio/bikes-indoor-cycling/integrity-lifecycle-commercial-upright-bike |
| Precor UBK 885 | 50 sur la fiche NA (25 ou 10 ailleurs : contradictoire) | 18-750 W, 20-150 RPM | https://static.precor.com/sell-sheet/all/UBK/UBK885-Product-Brochure-NA.pdf |
| Technogym Excite Bike | 1-25 | watts mesurés à 70 RPM | https://www.technogym.com/library/techspecs/excite/excite_bike_en.pdf |
| Matrix Upright Cycle | 30 | 2-750 W | https://us.matrixfitness.com/eng/cardio/lifestyle/upright-cycle/led |
| Keiser M3i (biking) | 24 vitesses | RPM, watts | https://www.keiser.com/fitness-equipment/cardio-training/m3i-indoor-cycle |

Retenu : « Résistance », niveau 0-100 (vélos de biking à molette graduée), pas de 1. Cadence : affichée par les
consoles (Keiser, Precor, Technogym) mais c'est un résultat, pas un réglage : notée en fin d'exercice, facultative
(0-200 tr/min).

### Vélo elliptique

| Marque / modèle | Niveaux | Rampe | Source |
|---|---|---|---|
| Precor EFX 885 | 20 | 10-35°, affichée en niveaux 1-20 | https://www.precor.com/en-US/products/EFX885 |
| Life Fitness Integrity | 25 | 21 niveaux sur certains modèles | https://www.lifefitness.com/en-us/catalog/cardio/ellipticals/integrity-series-elliptical-cross-trainer |
| Matrix Performance | 25 | fixe | https://us.matrixfitness.com/eng/sellsheet/75525/75540 |
| Technogym Excite+ Synchro | 25 | réglable sur certains modèles seulement | https://www.technogym.com/en-AU/product/excite-synchro_DFH-DGE.html |

Retenu : « Résistance », niveau 0-50. Inclinaison non suivie : rampe souvent fixe, et affichée en niveaux, degrés
ou % selon la marque.

### Rameur

| Marque / modèle | Réglage | Allure | Source |
|---|---|---|---|
| Concept2 RowErg | damper 1-10 | temps / 500 m | https://www.concept2.com/training/articles/damper-setting, https://www.concept2.com/support/monitors/pm5/how-to-use |
| WaterRower S4 | aucun (eau) | temps / 500 m | https://www.waterrower.com/wr_us/equipment/s4-performance-monitor/ |
| Technogym Skillrow | 10 niveaux air + 3 « power » | — | https://www.technogym.com/en-US/product/skillrow_DJR0NDTANEAEANR2.html |
| Life Fitness Row HX | 5 niveaux (eau) | temps / 500 m | https://www.lifefitness.com/en-us/catalog/cardio/rowers/row-hx-trainer |

Retenu : pas de suivi au fil du chrono (la résistance se règle une fois). Le chrono sert à la durée exacte : le
temps aux 500 m est calculé (distance + durée), jamais tapé ; avec les minutes arrondies seules, 2 000 m en 7:32
donneraient 2:00 au lieu de 1:53. Résistance facultative en fin d'exercice, 0-13 (damper Concept2, Skillrow 10 + 3,
Row HX). Drag factor non demandé (lu dans un menu du moniteur, peu connu).

## Incertain / non trouvé

- Pas d'inclinaison chez Life Fitness et Matrix (seul Precor, 0,5 %, est sourcé).
- Bascule mph ↔ km/h sur la console d'un tapis de salle : non documentée par les constructeurs lus (d'où le
  bouton d'unité plutôt qu'une conversion).
- Nombre exact de niveaux Precor UBK 885 et Life Fitness Row HX (fiches contradictoires) : couvert par les plages.
- Alias « marches » non ajouté aux Escaliers : sa clé souple (« marche ») est déjà celle de « Marche rapide ».
