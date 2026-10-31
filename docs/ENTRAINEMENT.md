# Niveau de force

Branche `nuit-entrainement` (31/10/2026). Tout est calculé **sur l'iPhone**, à partir de l'historique de la
personne : rien de nouveau n'est envoyé au serveur, aucune migration, aucun changement natif (OTA seulement).

- Logique pure : `js/data/strength-levels.js` (testée par `tests/unit/strength-levels.mjs`).
- Seuils : `js/data/strength-standards.js`, **générés** par `scripts/strength-standards.py` (ne pas modifier à la main).
- Écrans : `js/features/strength-levels-ui.js`, styles `css/strength-levels.css`, parcours testés par `tests/test_niveau_force.py`.

La périodisation d'abord construite sur cette branche (semaine plus légère conseillée, suivi de l'effort,
stagnation, carte de reprise, charges tenues après une décharge) a été **retirée le 31/10/2026** (décision de
Maxence) : les propositions de l'app (cibles de l'accueil, préremplissage, puce « ↑ + 2,5 kg ») partent
toujours de la dernière séance réellement faite sur l'exercice. Elle n'avait jamais été publiée (ni OTA, ni
build : `build-ios` ne la contient pas), donc aucune clé `trainingTipsOff`, `deload` ou `deloadSnooze` n'existe
chez les utilisateurs ; aucun nettoyage n'est prévu pour elles. Le code est dans l'historique git (`1746f00`).

## Ce qui est affiché

- **Bibliothèque › Exercice** et **Progrès › Exercice** : groupe « Niveau de force » sous la fiche du squat,
  du développé couché et du soulevé de terre à la barre. Niveau en toutes lettres, 1RM estimé, rapport au poids
  du corps, échelle à cinq segments, prochain palier en kg (« Intermédiaire à 96 kg »), repères hommes ou femmes,
  et la source (« Source : OpenPowerlifting », détail dans le bouton « i »).
- **Bilan de fin de séance** : « Niveau de force » des exercices principaux faits, avec « Nouveau palier »
  quand la séance fait passer au niveau suivant.
- Sans poids du corps : « Ajoute ton poids du corps » (même saisie que Réglages, action `set-body-weight`).
- Sans série de 1 à 12 reps ces 90 derniers jours : « Pas encore de 1RM estimé ».
- **Sexe non indiqué** : voir plus bas.

## Sexe (Réglages › Entraînement › Sexe)

Champ facultatif : Homme, Femme, Ne pas préciser (`data.strengthSex` : `male`, `female`, `none` ou absent).
Il n'est plus déduit de la silhouette des muscles (choix d'affichage, pas une réponse sur soi).

- **Sans réponse** : la fiche montre le 1RM estimé et le rapport au poids du corps, **sans palier**, et une
  ligne « Indiquer mon sexe » ouvre le même choix que Réglages. Le bilan n'affiche pas de niveau.
- **Ne pas préciser** : pareil, sans relance ; un pied de groupe dit où le changer.
- Pourquoi pas de palier par défaut : les repères hommes et femmes diffèrent d'environ 40 % au développé
  couché ; prendre les repères hommes par défaut sous-classerait une femme, et afficher les deux échelles côte
  à côte serait confus. Ne rien supposer et proposer le choix là où il sert est le plus honnête.
- **Donnée de l'appareil seulement** : `SYNC_LOCAL_ONLY` (jamais dans le profil du compte, comme le poids du
  corps), nettoyée par `sanitizeData`. La page de confidentialité n'a donc pas à changer.

## Calcul dans l'app

| Élément | Règle |
|---|---|
| Exercices | `Squat barre`, `Développé couché barre`, `Soulevé de terre`, reconnus avec leurs alias (`catalogueEntry`). Les variantes (haltères, machine, prise serrée, sumo, roumain), le développé militaire et le rowing n'ont pas de repères (OpenPowerlifting ne couvre que les trois mouvements de compétition) : rien n'est affiché. |
| 1RM estimé | Meilleure série de travail des 90 derniers jours, formule d'Epley déjà utilisée par l'app (`calc1RM`, 1 à 12 reps). L'échauffement ne compte pas. |
| Poids du corps | `currentBodyKg()` : pesée de Santé, sinon poids saisi dans Réglages. |
| Catégorie | Catégorie de poids IPF qui contient le poids du corps (hommes 59, 66, 74, 83, 93, 105, 120, 120+ ; femmes 47, 52, 57, 63, 69, 76, 84, 84+). |
| Niveau | Rapport 1RM ÷ poids du corps comparé aux 4 seuils de la catégorie [Novice, Intermédiaire, Avancé, Élite]. Sous Novice : Débutant ; au-delà d'Élite : Élite, sans palier suivant. |

## Seuils : méthode

**Source** : export CSV officiel d'OpenPowerlifting (https://openpowerlifting.gitlab.io/opl-csv/bulk-csv.html),
fichier `openpowerlifting-2026-10-31-4a1c65a7.csv` (archive du 31/10/2026, 830 Mo décompressé, 4 059 941 lignes
annoncées). Les données brutes ne sont pas dans le dépôt ; seul le script et la table résultante le sont.

**Licence vérifiée** (fichier `LICENSE.txt` de l'archive, et page « Introduction » de la documentation
officielle, 31/10/2026) : « OpenPowerlifting data is contributed to the public domain. […] To the extent
possible under law, all CSV data is waived of all copyright and related or neighboring rights. The work is
published from the United States. » L'attribution n'est pas obligatoire mais demandée : l'app écrit « Source :
OpenPowerlifting » sous chaque niveau et l'explique dans le bouton « i ». Usage commercial : rien ne
l'interdit (renonciation à tous les droits) ; seule réserve écrite par le projet : certains pays protègent la
structure d'une base de données, ce qui ne concerne pas des seuils recalculés.

**Population** (`scripts/strength-standards.py`), une valeur par compétiteur et par mouvement :

- équipement `Raw` (sans genouillères, combinaison ni bandes : comme en salle) ;
- fédérations contrôlées antidopage (`Tested = Yes`) : plus proche d'un pratiquant naturel ;
- âge connu de 18 à 49 ans, ou inconnu ; poids du corps de 35 à 250 kg ; tentative réussie (> 0) ;
- **première compétition** de la personne dans ce mouvement, pas son record de carrière : on mesure quelqu'un
  qui se lance en compétition après quelques années de salle ;
- rapport meilleure tentative ÷ pesée officielle, par sexe et catégorie. Effectifs : squat 206 040 hommes et
  99 831 femmes, développé couché 262 397 et 115 167, soulevé de terre 223 340 et 107 394 (au moins 3 051 par
  catégorie). Calcul en 30 s.

**Percentiles retenus** (des compétiteurs à leur première compétition), arrondis au 0,05 :

| Palier | Percentile | Pourquoi |
|---|---|---|
| Novice | 2 | Presque tout compétiteur débutant le dépasse : quelques mois d'entraînement régulier. |
| Intermédiaire | 15 | Les moins forts de ceux qui s'inscrivent à une première compétition : un pratiquant régulier depuis quelques années, sans être spécialiste. |
| Avancé | 50 | Le compétiteur médian à sa première compétition : entraînement sérieux et suivi. |
| Élite | 90 | Les 10 % les plus forts dès leur première compétition, niveau régional ou national. |

Des compétiteurs sont plus forts que la moyenne des salles : c'est pour cela que l'intermédiaire est placé au
15ᵉ percentile et non à la médiane.

### Seuils obtenus (1RM ÷ poids du corps), catégories les plus courantes

Table complète (8 catégories par sexe) : `js/data/strength-standards.js`.

| Mouvement | Hommes 74-83 kg (nov. / inter. / av. / élite) | Femmes 57-63 kg |
|---|---|---|
| Squat | 1,30 / 1,80 / 2,20 / 2,65 | 0,90 / 1,25 / 1,60 / 2,10 |
| Développé couché | 0,90 / 1,20 / 1,50 / 1,85 | 0,50 / 0,70 / 0,90 / 1,20 |
| Soulevé de terre | 1,65 / 2,15 / 2,60 / 3,05 | 1,20 / 1,60 / 2,00 / 2,45 |

Pour un homme de 80 kg : squat intermédiaire à 144 kg, développé couché à 96 kg, soulevé de terre à 172 kg.

### Comparaison à des repères publiés (plausibilité)

| Repère | Hommes ~80 kg (S / DC / ST) | Femmes ~60 kg (S / DC / ST) | Écart avec nos seuils |
|---|---|---|---|
| Strength Level, « Intermédiaire » (percentile 50 de ses utilisateurs, relevé le 31/10/2026, ancienne source) | 1,75 / 1,25 / 2,00 | 1,25 / 0,75 / 1,50 | Nous : 1,80 / 1,20 / 2,15 et 1,25 / 0,70 / 1,60 : à 8 % près |
| Strength Level, « Élite » | 2,75 / 2,00 / 3,25 | 2,25 / 1,45 / 2,50 | Nous : 2,65 / 1,85 / 3,05 et 2,10 / 1,20 / 2,45 : un peu plus bas (première compétition seulement) |
| van den Hoek et al. 2024, percentile 90 de toutes les entrées raw contrôlées, 18-35 ans (J Sci Med Sport 27(10):734-742, doi:10.1016/j.jsams.2024.07.005, 809 986 entrées OpenPowerlifting) | 2,83 / 1,95 / 3,25 | 2,26 / 1,35 / 2,66 | Notre Élite (p90 à la première compétition) est 5 à 10 % sous leur p90 toutes compétitions : attendu, une carrière fait progresser |

Strength Level (utilisateurs d'un carnet en ligne, population sans lien avec la nôtre) tombe au même endroit
pour Intermédiaire, ce qui valide le choix du 15ᵉ percentile ; van den Hoek et al. confirment le haut de l'échelle.

### Limites (dites dans l'app : « C'est un repère, pas un examen »)

- Population de compétiteurs, pas un échantillon de la population générale ; la règle « première
  compétition » et le 15ᵉ percentile corrigent l'écart, sans l'annuler.
- Seuils par catégorie (marches) : changer de catégorie déplace un peu les seuils en rapport au poids.
- La catégorie la plus légère des hommes (≤ 59 kg) a des seuils bas en Novice (beaucoup de jeunes débutants).
- Les mouvements de compétition suivent des règles (profondeur, pause au couché) plus strictes qu'en salle.
- Le 1RM est une estimation (Epley), elle-même à quelques pour cent près au-delà de 5 reps.

### Mettre à jour les seuils

```sh
curl -L -o /chemin/temporaire/opl.zip https://openpowerlifting.gitlab.io/opl-csv/files/openpowerlifting-latest.zip   # 164 Mo
python3 -I scripts/strength-standards.py /chemin/temporaire/opl.zip --explore                              # percentiles bruts
python3 -I scripts/strength-standards.py /chemin/temporaire/opl.zip > js/data/strength-standards.js
```

Puis `npm run test:unit` (table complète, seuils croissants et plausibles) et supprimer l'archive.
