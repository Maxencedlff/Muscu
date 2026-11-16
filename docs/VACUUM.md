# Vacuum abdominal

Le vacuum (« stomach vacuum », « abdominal hollowing », « drawing-in ») se note en **maintiens chronométrés**, pas en
séries × répétitions. Il travaille le **transverse**, un muscle profond : rien n'est coloré sur le personnage et il
n'entre pas dans les séries d'abdos de la semaine.

Code : `js/data/measures.js` (`HOLD_GUIDES`, `holdGuide`, `setNoun`, `defaultGoal`), `js/data/effort-clock.js`
(`holdCue`), `js/features/effort.js` (chrono guidé), `js/data/exercise-catalogue.js` (`DEEP_MUSCLES`, `DEEP_TARGETS`,
`DEEP_RULES`, `musclesKnown`, `deepInGroup`), `js/data/muscles.js` (champ `deep`), `js/data/exercise-howto.js` (consignes),
`js/features/library.js` (vignette `exhero--deep`), `js/features/progress-chart.js` (records en secondes),
`js/data/store.js` (anciennes séances, `VACUUM_TIME_SCHEMA`).
Tests : `tests/unit/vacuum.mjs`, `tests/test_vacuum.py`.

## 1. Protocole retenu

| Réglage | Valeur | Pourquoi |
|---|---|---|
| Mesure | Durée (type `time` déjà existant, secondes dans `reps`) | Les essais décrivent des maintiens tenus, jamais des répétitions comptées |
| Durée d'un maintien sans séance précédente | 10 s (`HOLD_GUIDES.Vacuum.goal`) | Durée de départ des essais ; on monte à 15-20 s quand c'est facile |
| Nombre | 8 à 10 maintiens conseillés (consignes) ; 5 par défaut dans un programme | Volume courant des protocoles résumés par Golob 2024 |
| Repos entre deux maintiens | 15 s par défaut (`HOLD_GUIDES.Vacuum.rest`), tant que ni le programme ni la séance n'en fixent un | Repos court : l'effort est faible, ce n'est pas une série de force |
| Position | Couché sur le dos genoux pliés d'abord, puis quatre pattes, assis, debout | Urquhart 2005 : c'est couché, en rentrant le **bas** du ventre, que le transverse travaille le plus seul |
| Respiration | Gardée (« Respire petit ») | Bloquer sa respiration est l'erreur fréquente : le vacuum se tient en respirant |
| Colonne de charge | Masquée (`sets--noload`) | Un lest n'a pas de sens sur ce maintien |

Le chrono guidé (`holdCue`) dit quoi faire à chaque instant : pendant la préparation « Expire tout ton air » puis
« Rentre le bas du ventre », au départ « Ventre rentré, respire petit », pendant le maintien « Respire petit, dos
immobile », dans les 3 dernières secondes « Encore un peu », à la fin « Relâche ». Chaque consigne est annoncée
une fois à VoiceOver.

Ce que l'app **ne promet pas** : une taille plus fine ni un ventre plus plat. Aucune étude ne le montre, et le travail
localisé des abdominaux ne fait pas perdre la graisse du ventre (Vispute 2011). La fiche dit seulement ce que le
vacuum travaille.

## 2. Muscles : le transverse seul, sans rouge

- Le transverse est sous les obliques et le grand droit (OpenStax, *Anatomy and Physiology* 2e, 11.4) : le colorer
  sur le personnage reviendrait à colorer un muscle qu'on ne voit pas. La fiche montre le personnage **sans aucun
  rouge** et la légende « Transverse, muscle profond, invisible en surface ».
- Le grand droit reste peu actif pendant un vacuum bien fait (Urquhart 2005) : marquer les abdominaux comme muscle
  principal serait faux. Le vacuum n'a donc **aucun muscle principal** (`primary: []`) et un muscle profond
  (`deep: ['transverse']`).
- Il n'est **pas compté** dans les séries d'abdos de la semaine : les repères de séries hebdomadaires viennent des
  exercices d'hypertrophie (Schoenfeld 2017), aucune dose de ce genre n'est établie pour le transverse.
- Il reste rangé avec les abdominaux dans la Bibliothèque (`DEEP_MUSCLES.transverse.group`), et la recherche le
  trouve par « transverse », « abdos », « ventre ». Un nom saisi librement (« Vacuum à genoux », « drawing in ») est
  reconnu par `DEEP_RULES` avant les règles des abdominaux.

## 3. Ce que le vacuum fait, et ce qu'il ne fait pas

- **Il apprend à activer le transverse.** Teyhen 2005 : l'épaisseur du transverse double en moyenne pendant la
  manœuvre (échographie, 30 personnes avec une lombalgie). Urquhart 2005 : rentrer le bas du ventre couché est la
  consigne qui l'active le plus indépendamment des autres abdominaux.
- **Il ne gaine pas mieux qu'un gainage.** Grenier et McGill 2007 : le gainage serré (« bracing ») rend la colonne
  plus stable que le vacuum ; le transverse n'y compte presque pas. Le vacuum ne remplace donc ni la planche ni le
  dead bug.
- **Contre le mal de dos, il n'est pas meilleur qu'un autre exercice.** Saragiotto 2016 (Cochrane, 29 essais) :
  les exercices de contrôle moteur font mieux que rien, mais pas mieux que les autres exercices.
- **Il ne fait pas perdre de ventre.** Vispute 2011 : six semaines d'abdominaux sans changer l'alimentation ne
  changent ni le tour de taille ni la graisse du ventre.
- Golob 2024 (revue de 22 essais) : vacuum et gainage serré améliorent tous deux la stabilité du tronc et l'épaisseur
  des muscles ; les comparaisons directes manquent. C'est la source des durées et du volume retenus.

## 4. Anciennes séances

Avant le 16/11/2026, le vacuum se notait en séries × reps. Ces séances restent lisibles telles quelles :

- dans l'**Historique**, une séance d'avant reste « 12 reps » : son nom est figé en répétitions (schéma 7 de
  `LEGACY_REPS_BY_SCHEMA`, historique seulement) ;
- un **programme** qui contient du vacuum passe aux maintiens : c'est une prescription, pas une donnée faite ;
- en **séance**, une dernière fois notée en reps n'est ni montrée dans « Avant » ni reprise : « 12 reps » ne devient
  jamais « 12 s » (`buildSets`) ;
- dans **Progrès**, une courbe n'a qu'une grandeur, celle de la dernière séance ; les séances en reps restent dans
  l'Historique. Records : « Plus long maintien » et « Temps total sous tension », ni charge ni 1RM.

Le schéma des données ne change pas : `CACHE` du service worker passe à `ppl-v199`.

## 5. Sources

- Urquhart DM, Hodges PW et al. Abdominal muscle recruitment during a range of voluntary exercises.
  *Manual Therapy* 2005;10(2):144-153. doi:10.1016/j.math.2004.08.011
- Teyhen DS et al. The use of ultrasound imaging of the abdominal drawing-in maneuver in
  subjects with low back pain. *J Orthop Sports Phys Ther* 2005;35(6):346-355. doi:10.2519/jospt.2005.35.6.346
- Golob, Opara Zupančič, Kozinc. Abdominal hollowing vs. abdominal bracing: a scoping review of clinical
  trials on effectiveness for trunk stability and rehabilitation. *J Funct Morphol Kinesiol* 2024;9(4):193.
- Grenier SG, McGill SM. Quantification of lumbar stability by using 2 different abdominal activation strategies.
  *Arch Phys Med Rehabil* 2007;88(1):54-62. doi:10.1016/j.apmr.2006.10.014
- Saragiotto BT et al. Motor control exercise for chronic non-specific low-back pain.
  *Cochrane Database Syst Rev* 2016;(1):CD012004. doi:10.1002/14651858.CD012004
- Vispute SS, Smith JD, LeCheminant JD, Hurley KS. The effect of abdominal exercise on abdominal fat.
  *J Strength Cond Res* 2011;25(9):2559-2564. doi:10.1519/JSC.0b013e3181fb4a46
- OpenStax. *Anatomy and Physiology* 2e, 11.4 « Axial muscles of the abdominal wall and thorax ».
- Schoenfeld BJ, Ogborn D, Krieger JW. Dose-response relationship between weekly resistance training volume and
  increases in muscle mass. *J Sports Sci* 2017;35(11):1073-1082.
