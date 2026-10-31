# Entraînement intelligent : niveau de force et semaine plus légère

Branche `nuit-entrainement` (31/10/2026). Tout est calculé **sur l'iPhone**, à partir de l'historique de la
personne : rien de nouveau n'est envoyé au serveur, aucune migration, aucun changement natif (OTA seulement).

- Logique pure : `js/data/training-insights.js` (chargé avant `store.js`, testé par `tests/unit/training-insights.mjs`).
- Écrans : `js/features/training-insights-ui.js`, styles `css/insights.css`, parcours testés par `tests/test_entrainement.py`.

## 1. Niveau de force

### Ce qui est affiché

- **Bibliothèque › Exercice** et **Progrès › Exercice** : groupe « Niveau de force » sous la fiche des cinq
  exercices principaux. Niveau en toutes lettres, 1RM estimé, rapport au poids du corps, échelle à cinq
  segments, prochain palier en kg (« Intermédiaire à 100 kg »), repères hommes ou femmes et source.
- **Bilan de fin de séance** : « Niveau de force » des exercices principaux faits, avec « Nouveau palier »
  quand la séance fait passer au niveau suivant.
- Sans poids du corps : « Ajoute ton poids du corps » (même saisie que Réglages, action `set-body-weight`).
- Sans série de 1 à 12 reps ces 90 derniers jours : « Pas encore de 1RM estimé ».

### Calcul

| Élément | Règle |
|---|---|
| Exercices | `Squat barre`, `Développé couché barre`, `Soulevé de terre`, `Développé militaire barre`, `Rowing barre`, reconnus avec leurs alias (`catalogueEntry`). Les variantes (haltères, machine, prise serrée, sumo, roumain) n'ont pas de repères publiés : rien n'est affiché. |
| 1RM estimé | Meilleure série de travail des 90 derniers jours, formule d'Epley déjà utilisée par l'app (`calc1RM`, 1 à 12 reps). L'échauffement ne compte pas. |
| Poids du corps | `currentBodyKg()` : pesée de Santé, sinon poids saisi dans Réglages. |
| Sexe | La silhouette choisie (Réglages › Apparence, premier lancement). Absente : repères hommes, et la fiche le dit (« silhouette Homme par défaut »). |
| Niveau | Rapport 1RM ÷ poids du corps comparé aux seuils ci-dessous. Sous le seuil « Novice » : Débutant ; au-delà du seuil « Élite » : Élite, sans palier suivant. |

### Seuils (1RM ÷ poids du corps)

Source : **Strength Level**, pages « Strength Standards » de chaque exercice, tableau « Bodyweight Ratio
Standards », relevées le 31/10/2026 (texte brut des pages, pas un résumé) :

- https://strengthlevel.com/strength-standards/squat/kg
- https://strengthlevel.com/strength-standards/bench-press/kg
- https://strengthlevel.com/strength-standards/deadlift/kg
- https://strengthlevel.com/strength-standards/shoulder-press/kg
- https://strengthlevel.com/strength-standards/bent-over-row/kg

Méthode publiée sur ces pages : plus de 48 millions de performances saisies par leurs utilisateurs
(10,9 millions gardées après contrôle des valeurs absurdes et des doublons), de 2015 à mars 2026. Chaque
niveau est un percentile : Débutant, Novice, Intermédiaire, Avancé et Élite font mieux que 5, 20, 50, 80 et
95 % des pratiquants.

| Exercice | Hommes (déb. / nov. / inter. / av. / élite) | Femmes |
|---|---|---|
| Squat barre | 0,75 / 1,25 / 1,75 / 2,25 / 2,75 | 0,50 / 0,75 / 1,25 / 1,75 / 2,25 |
| Développé couché barre | 0,50 / 1,00 / 1,25 / 1,50 / 2,00 | 0,30 / 0,50 / 0,75 / 1,10 / 1,45 |
| Soulevé de terre | 1,00 / 1,50 / 2,00 / 2,50 / 3,25 | 0,75 / 1,00 / 1,50 / 2,00 / 2,50 |
| Développé militaire barre | 0,35 / 0,55 / 0,80 / 1,05 / 1,35 | 0,20 / 0,35 / 0,50 / 0,70 / 0,95 |
| Rowing barre | 0,50 / 0,75 / 1,00 / 1,50 / 1,75 | 0,30 / 0,45 / 0,70 / 0,95 / 1,25 |

Limites, assumées et dites dans l'app (« C'est un repère, pas un examen ») :

- Les rapports sont arrondis par Strength Level. Comparés à leurs tableaux par poids du corps, ils sont justes
  à environ 5 à 10 % près entre 60 et 90 kg ; ils surestiment un peu les seuils des personnes lourdes. Les
  tableaux complets n'ont pas été recopiés (base de données d'un tiers : voir « À décider »).
- Population : des gens qui notent leurs charges sur un site de musculation, pas un échantillon de la
  population générale.
- Le 1RM est une estimation (Epley), elle-même à quelques pour cent près au-delà de 5 reps.

## 2. Semaine plus légère (décharge) et stagnation

### Ce qui est affiché

- **Accueil**, carte « Conseil d'entraînement » : « Semaine plus légère conseillée », avec les raisons
  tirées des séances (« 6 semaines chargées d'affilée », « Plus de progrès sur … », « Effort noté en hausse :
  RPE 8,2 → 10 »), le plan (« Environ 5 séries par séance au lieu de 9, mêmes charges, arrête-toi plus loin
  de l'échec. Pendant 7 jours. »), « Pourquoi ce conseil ? », **Commencer** et **Pas maintenant** (7 jours).
- Pendant la décharge : « Semaine plus légère », séries visées, date de fin, « Terminer la décharge ».
  Le reste de l'app suit le même conseil : la carte des cibles devient « Au programme » avec « 2 séries ·
  80 kg » (moitié des séries prévues, même charge, aucun « + 1 rep » ni « + 2,5 kg ») ; une séance démarrée
  est préremplie avec la moitié des séries de chaque exercice (une au moins) et n'affiche pas la puce
  « ↑ + 2,5 kg ».
- La semaine d'après : « Reprise · Reprends tes charges d'avant » avec les 3 exercices les plus lourds et
  leur meilleure série d'avant la décharge ; croix pour masquer. Tant qu'un exercice n'a pas été refait
  depuis le début de la décharge, sa cible est cette série d'avant, sans gain (« Au programme »), et la
  séance ne propose pas de palier de charge ; une fois refait, la progression habituelle reprend.
- Partout (cibles, préremplissage, colonne « Avant », « dernier … » de l'éditeur), la « dernière fois »
  (`lastPerf`) passe les séances faites pendant la décharge enregistrée : la séance allégée ne devient
  jamais la référence. S'il n'y a qu'elle pour un exercice, elle sert quand même.
- **Progrès › Exercice** : « Pas de nouveau 1RM est. depuis N séances » ou « 1RM est. en baisse sur les 2
  dernières séances », avec le meilleur et sa date.
- **Réglages › Entraînement › Conseils d'entraînement** : coupe la carte et la stagnation (le niveau de
  force reste affiché).

### Règles (constantes en tête de la section « Périodisation » du fichier)

| Signal | Règle |
|---|---|
| Semaine chargée | Semaine complète (lundi → dimanche) avec au moins une séance, des séries de travail ≥ 60 % de la médiane des semaines entraînées des 12 dernières, et des charges ≥ 92 % de celles des 4 semaines d'avant (médiane, exercice par exercice, du meilleur 1RM estimé). Une décharge enregistrée coupe toujours la série. La semaine en cours n'est jamais jugée. |
| Stagnation d'un exercice | Exercice à charge (ni lest, ni aide, ni durée, ni cardio) fait au moins 4 fois en 8 semaines : pas de nouveau meilleur 1RM estimé depuis 3 séances et 14 jours. |
| Recul | Moyenne des 2 dernières séances sous 97 % du meilleur d'avant elles. |
| Effort qui monte | RPE moyen (RIR noté) des 14 derniers jours supérieur d'au moins 0,5 à celui des 28 jours d'avant, avec 6 séries notées au moins de chaque côté. |
| Décharge conseillée | 4 semaines chargées d'affilée ou plus **et** (au moins la moitié des exercices suivis, deux au moins, stagnent ou reculent **ou** l'effort monte avec au moins un exercice qui stagne) ; ou 8 semaines chargées d'affilée sans aucun signe. |
| Silence | Réglage coupé, « Pas maintenant » (7 jours), décharge en cours, et 4 semaines après la fin d'une décharge. |
| Plan | Moitié des séries de travail habituelles par séance (médiane des 28 derniers jours), mêmes charges, plus loin de l'échec, 7 jours. Par exercice : moitié des séries prévues arrondie, une au moins (`deloadSetCount` : 3 → 2, 4 → 2, 5 → 3). |
| Cibles et séance | Décharge en cours : aucun gain, moitié des séries. Les 7 jours d'après : aucun gain pour un exercice pas refait depuis le début de la décharge. Conseils coupés : cibles et séance normales (la carte disparaît aussi). La carte de reprise fermée ne change rien aux cibles. |

### Coût du calcul (accueil, à chaque rendu)

La carte est recalculée à chaque rendu de l'accueil (retour sur l'onglet, chaque action). `trainingAdvice`
ne lit donc chaque séance **qu'une fois** : `entryFacts` en tire séries de travail, meilleur 1RM estimé par
exercice à charge et RPE notés, gardés dans une `Map` propre à l'appel et partagée par les 12 semaines, les
4 semaines d'avant chacune, les courbes et l'effort. Seules les 16 dernières semaines complètes sont relues.

- Mesuré sous Node (contexte de `tests/unit/run.mjs`, 5 séances de 8 exercices par semaine) : 150 séances,
  9 000 lectures de la bibliothèque (`catalogueEntry`) et 33 à 50 ms avant ; 1 920 lectures et 9 à 11 ms
  après. 780 séances : 29 à 43 ms avant, 10 à 14 ms après (le coût ne grandit plus avec l'historique).
  Sur iPhone : non mesuré.
- Pas de cache d'un rendu à l'autre, volontairement : `ppl_v2` n'a pas de date de modification, et une
  séance passée corrigée sur place (séries, charges) doit changer le conseil tout de suite. Une clé
  « nombre de séances + date de la dernière » laisserait passer cette correction.
- Test de coût : `tests/unit/training-insights.mjs` (« coût borné »), au plus 2 500 lectures pour 150 séances.

### Sources

- Bell L., Strafford B.W., Coleman M., Androulakis Korakakis P., Nolan D. *Integrating Deloading into
  Strength and Physique Sports Training Programmes: An International Delphi Consensus Approach.* Sports
  Medicine – Open 9, 87 (2023). https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/
  - Définition : « période de stress d'entraînement réduit destinée à atténuer la fatigue physiologique et
    psychologique, favoriser la récupération et préparer l'entraînement suivant ».
  - « Generally undertaken every 4–6 weeks for a period of ~7 days » ; décharges prévues « toutes les 4 à 8
    semaines » dans la discussion → seuils de 4 et 8 semaines.
  - Accord à 100 % : la décharge peut être prévue, autorégulée (fatigue ressentie) ou les deux ; elle peut
    baisser le volume par les séries ou par les reps ; 95,2 % : la charge peut rester la même pendant que le
    volume baisse → plan « moitié des séries, mêmes charges, plus loin de l'échec ».
  - Le consensus ne donne **aucun seuil chiffré** de stagnation ni de baisse de volume : les seuils 60 %,
    92 %, 3 séances, 14 jours, 97 %, + 0,5 RPE et « la moitié des séries » sont des choix de l'app, prudents
    et tous écrits ici pour être ajustés.
- RIR / RPE : échelle de Zourdos et al. (2016), déjà utilisée par `js/data/rir.js`.

## Données

Trois clés de `ppl_v2`, toutes **sur l'appareil seulement** (`SYNC_LOCAL_ONLY`, jamais dans le profil du
compte), nettoyées par `sanitizeData` :

| Clé | Valeur |
|---|---|
| `trainingTipsOff` | `true` ou absente (conseils allumés) |
| `deload` | `{ start, end, seen? }` : décharge commencée (7 jours, 14 au plus), `seen` = carte de reprise fermée |
| `deloadSnooze` | date jusqu'à laquelle « Pas maintenant » fait taire la carte |

Aucune donnée nouvelle ne quitte l'iPhone : la page de confidentialité n'a pas à changer.

## À décider (Maxence)

- Utilisation commerciale des seuils de Strength Level : seuls les 5 rapports par exercice et par sexe
  (des faits publiés, cités) sont repris, pas leurs tableaux. Leur demander une autorisation écrite, ou
  passer à une autre source (tableaux de Kilgore et Rippetoe, ExRx) si tu préfères zéro risque.
- Sexe : la silhouette sert de réponse. Une vraie question « Repères : femmes / hommes » serait plus
  explicite si des testeuses trouvent ça étrange.
