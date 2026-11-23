# Progression automatique : l'objectif du jour

Une seule règle, dans `js/data/goals.js` (`exerciseGoal`, `goalBumpDue`, `repsBeforeBump`, `loadStepKg`).
Elle sert à l'accueil (« À battre aujourd'hui », `js/features/dashboard.js`) et à la puce ↑ de la séance
(`bumpReady`, `js/features/session.js`). Aucune autre copie du calcul.

Ce que la règle ne change pas :

- Les cases de la séance sont pré-remplies avec « Avant » (la dernière fois), jamais avec l'objectif
  (décision du 17/11). L'objectif n'est qu'une indication ; la charge ne monte que si on touche la puce ↑.
- La charge prescrite par un coach (`load`, `loads`, `js/data/coach-presc.js`) est l'objectif telle quelle.
- Programme envoyé par un coach (`coachLedProgramme`) : jamais de hausse proposée, jamais de rep au-delà du
  haut de sa fourchette.
- Reps fixes (« 4 × 12 ») : + 1 rep jusqu'au nombre, puis la charge monte au même nombre.
- Poids du corps et lest : les reps continuent, pas de charge à monter.

## Double progression

1. Dans la fourchette (8 à 12 ; 12 en haut et 4 en dessous par défaut) : la meilleure série + 1 rep, jamais
   au-delà du haut.
2. Haut atteint (toutes les séries au haut, ou la meilleure au-delà) : la charge monte d'un cran, au bas de la
   fourchette, **sauf si ce cran est gros**.
3. Cran gros (23/11) : plus de 10 % de la charge, ou une hausse qui ferait tomber sous le bas de la fourchette.
   Alors + 1 rep à la même charge, au-delà du haut, jusqu'à `repsBeforeBump` ; ensuite la charge monte.

`repsBeforeBump` : la charge + 1 cran faite au bas de la fourchette donne un 1RM estimé (Epley, comme
partout dans l'app). On cherche les reps qui donnent ce même 1RM à la charge d'aujourd'hui. Au moins le haut
+ 1, au plus 2 × le haut (30 au plus) : un cran énorme finit quand même par passer.

## Cran de charge (`loadStepKg`)

Dans l'ordre : le réglage de l'exercice `loadStep` (kg, de 0,25 à 50, nettoyé par `store.js` ; pas encore
d'écran pour le régler), puis, pour une barre à disques, deux fois le plus petit disque de la personne
(`plateSetup`, 2,5 kg par défaut), puis 2,5 kg (5 lb). La puce ↑, son toast et le gain affiché disent ce cran.

## Exemples (fourchette par défaut, 8 à 12)

| Dernière fois | Cran | Avant le 23/11 | Maintenant |
|---|---|---|---|
| Élévations latérales 8 kg × 15 | 2,5 kg (+ 31 %) | 10,5 kg × 8 | 8 kg × 16, la charge monte à 20 reps |
| Développé militaire haltères 18 kg × 12 partout | 2,5 kg (+ 14 %) | 20,5 kg × 8 | 18 kg × 13, la charge monte à 14 reps |
| Développé couché barre 100 kg × 12 partout | 2,5 kg (+ 2,5 %) | 102,5 kg × 8 | 102,5 kg × 8 (inchangé) |
| Machine 40 kg × 12, crans de 5 kg | 5 kg (+ 12,5 %) | 42,5 kg × 8 | 40 kg × 13, puis 45 kg × 8 |
| Machine 80 kg × 12, crans de 5 kg | 5 kg (+ 6 %) | 82,5 kg × 8 | 85 kg × 8 |

Tests : `tests/unit/progression.mjs`.
