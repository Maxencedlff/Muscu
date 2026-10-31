# Import depuis Hevy et Strong (fichiers CSV d'export)

But (lot 2, point 5 de la feuille de route) : quelqu'un qui quitte Hevy ou Strong garde tout son historique
dans MDLF Training. Réglages › Données › Sauvegarde › **Importer depuis une autre app** : choix du fichier, aperçu, import.

Code : `js/data/import-csv.js` (logique pure, testée dans `tests/unit/import-csv.mjs`), `js/features/import-ui.js`
(feuille d'aperçu et de lien), `tests/test_import.py` (bout en bout), jeux d'essai `tests/donnees/hevy_exemple.csv`
et `strong_exemple.csv` (construits d'après les sources ci-dessous, pas copiés d'un vrai utilisateur).

## Formats lus

### Hevy (`workout_data.csv`, Profil › Settings › Export & Import Data › Export Workouts)
Une ligne par série, 14 colonnes, en-tête en anglais quelle que soit la langue de l'app :

```
"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Push","6 Sep 2026, 18:00","6 Sep 2026, 19:05","","Bench Press (Barbell)",,"",0,"warmup",95,10,,,
```

- **Séance** = mêmes `title` et `start_time`. Durée = `end_time` − `start_time`.
- **Dates** : `d MMM yyyy, HH:mm`, heure locale, **mois dans la langue de l'app** (« 6 Sept. 2026 » en allemand,
  « 6 sept. 2026 » en français, « 6 9月 2026 » en japonais). Lues pour l'anglais, le français, l'espagnol, l'italien,
  l'allemand, le portugais, le néerlandais et le mois en chiffres ; sinon la forme ISO.
- **Unités dans le nom des colonnes**, selon le réglage de l'app : `weight_kg` ou `weight_lbs`, `distance_km` ou
  `distance_miles`. Converties en kg et en km.
- `set_type` : `normal`, `warmup`, `dropset` (ou `drop_set`), `failure`. `superset_id` : même numéro dans une séance =
  superset ; vide = séries simples. `description` = notes de séance, `exercise_notes` = note d'exercice. `rpe` : 1 à 10
  par demi-point.

Sources : [kinoku.app/import-format](https://kinoku.app/import-format) (en-tête, exemples, langues des mois,
valeurs de `set_type`), [thetaperapp.com](https://thetaperapp.com/articles/how-to-export-hevy-data/) (nom du
fichier, 14 colonnes, `superset_id`), [blog.ayjc.net](https://blog.ayjc.net/posts/migrate-strong-hevy-app/) (export réel
en livres et miles), [gossamr/swift-workout-importer](https://github.com/gossamr/swift-workout-importer) (format de
date `d MMM yyyy, HH:mm`, unités dans l'en-tête, vocabulaire de `set_type`),
[matanabudy/workout-data-sync](https://github.com/matanabudy/workout-data-sync/blob/main/examples/hevy_export_sample.csv)
(exemple), [fitarchive.app](https://fitarchive.app/blog/import-strong-hevy-workout-history/) (tableau des colonnes des
deux apps, lettres W/F/D de Strong). L'aide officielle Hevy (help.hevyapp.com, « Export Data », « Import Strong CSV »)
donne le chemin d'export et exige un fichier Strong en anglais, mais ne liste pas les colonnes.

### Strong (Réglages › Export Strong Data / Export Data)
Trois variantes rencontrées, toutes lues :

```
Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-03-02 07:05:00,Upper A,1h 5m,Bench Press (Barbell),1,80,5,0,0,,,8
```
- iPhone : ci-dessus. `Duration` en toutes lettres (« 1h 5m », « 45m », aussi « h:mm » acceptés).
- Ancienne : `Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE,Workout Duration`
  (durée en secondes).
- Strong 6.2 (2026) : **point-virgule**, tout entre guillemets, `"Workout #";"Date";"Workout Name";"Duration (sec)";
  "Exercise Name";"Set Order";"Weight (kg)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"`, avec
  des lignes `Set Order = "Rest Timer"` qui ne sont pas des séries.
- **Séance** = même `Workout #` s'il existe, sinon même `Date` et même `Workout Name`.
- **Dates** : `YYYY-MM-DD HH:MM:SS`, heure locale (lues à la main : `Date.parse` ne lit pas cette forme pareil sur
  Safari et Chrome).
- `Set Order` : numéro, **W** = échauffement, **D** = dégressive, **F** = échec.
- **Unité des charges** : donnée seulement quand la colonne s'appelle `Weight (kg)` ou `Weight (lbs)`. Avec un simple
  `Weight`, le fichier ne la dit pas : l'aperçu propose kg / lb (préréglé sur l'unité de l'app).
- **Distance** : `Distance (meters)` en mètres ; `Distance` seule : au-delà de 50, des mètres, sinon des km (heuristique,
  la colonne n'a pas d'unité connue). `Seconds` = durée de la série (gainage, cardio), jamais le repos.

Sources : [kinoku.app/import-format](https://kinoku.app/import-format) (les trois en-têtes, exemples, « Rest Timer »,
W/D/F), [forum intervals.icu](https://forum.intervals.icu/t/import-strong-data-weightlifting-app/5531) (en-tête
iPhone), [aimarchirico/gymruntohevy](https://github.com/aimarchirico/gymruntohevy) (`strong.csv` point-virgule, « Weight
(kg) », « Distance (meters) »), [gossamr/swift-workout-importer](https://github.com/gossamr/swift-workout-importer)
(`Duration`, `Seconds`, pas d'unité de charge), [truongthanhson/gymbuddy PR 10](https://github.com/truongthanhson/gymbuddy/pull/10)
(RFC 4180, BOM, CRLF), [fitarchive.app](https://fitarchive.app/blog/import-strong-hevy-workout-history/) (« Weight
(lbs) », W/F/D).

Aucune des deux apps ne publie de spécification officielle : les colonnes viennent de fichiers réels cités par ces
sources. Une colonne absente est tolérée (valeur vide), une colonne inconnue est ignorée.

## Conversion vers la séance de l'app
- Les séances arrivent dans un **programme créé** « Hevy » (`u_hevy`) ou « Strong » (`u_strong`), **une séance par nom
  de séance du fichier** (clé `s` + empreinte du nom, stable d'un import à l'autre, couleur par rang). Historique :
  `{ id, programme, category, date, duration?, notes?, exercises }`. Les exercices de chaque séance du programme sont
  ceux de la dernière séance importée à ce nom (la routine telle qu'elle est faite), avec leur nombre de séries :
  la personne peut continuer son programme tel quel. Les séances du programme déjà présentes (réimport) ne sont pas
  touchées ; un programme archivé (supprimé) revient.
- **Nom d'exercice** : reconnu → nom de la bibliothèque (muscles vérifiés) ; sinon exercice créé sous son nom d'origine
  (80 caractères au plus), ou relié à la main dans l'aperçu. Reconnaissance (`matchImportedExercise`) : `catalogueEntry`
  (nom, alias, clé souple) sur le nom tel quel ; puis les mêmes mots dans un autre ordre, nom et matériel réunis
  (« Incline Bench Press (Dumbbell) » = « incline dumbbell bench press ») ; puis sans les mots de position et sans
  « machine » ; puis le mouvement seul, refusé si le matériel (Dumbbell, Smith, Kettlebell, Band, Bodyweight…)
  désigne une autre fiche que celle trouvée. Le vocabulaire anglais de ces apps (`IMPORT_ALIASES`) complète la
  bibliothèque **sans la modifier** (un alias ajouté à `exercise-catalogue.js` changerait la mesure détectée de noms
  existants, voir `LEGACY_REPS_BY_SCHEMA`). Taux sur les 86 noms courants du test : ≥ 85 % (test), 100 % sur les
  jeux d'essai hors « Svend Press (Plate) » et « Landmine Press », volontairement inconnus.
- **Identifiant** (`exId`) : celui de l'exercice du programme créé, lui-même repris du même nom dans un autre programme
  ou l'historique (même courbe de Progrès que les séances déjà faites), sinon nouveau.
- **Séries** : répétitions dès qu'il y en a (`{ weight (kg, chaîne), reps }`) ; sinon distance → cardio
  (`{ dist (km), reps = minutes }`) ; sinon durée seule → maintien (`reps` = secondes). Mesure de l'exercice = celle de
  la majorité de ses séries, écrite comme `storedMeasure` (toujours hors répétitions) ; les séries qui n'y entrent pas
  sont écartées. Livres → kg (`/ 2.20462`, 3 décimales comme `storeW`), miles → km.
- **Échauffements** (`warmup`, `W`) : écartés par défaut (Hevy les exclut du volume), gardés sur demande dans l'aperçu,
  alors marqués `warmup: true` comme ceux de l'app (js/data/warmup.js : hors volume, séries et records).
  Dégressives et échecs : séries ordinaires. **RPE** (1 à 10) : converti en RIR de l'app (`rir` = 10 − RPE, arrondi,
  borné 0 à 4, js/data/rir.js) ; pas de champ `rpe` séparé. **Superset** Hevy : `ss` = `i` + numéro, normalisé par `ssNormalize`.
- **Notes** : notes de séance, puis « Nom : note » pour chaque note d'exercice, 2 000 caractères au plus.
- **Dédoublonnage** : empreinte = minute de début + noms d'exercices normalisés triés, calculée pareil sur l'historique
  et sur le fichier. Réimporter le même fichier n'ajoute rien ; une séance répétée dans un fichier compte une fois.
- Chaque séance passe par `cleanHistoryEntry` (bornes de l'app) avant d'entrer dans l'historique ; les séances existantes
  ne sont jamais modifiées.
- **Compte** : les séances importées n'ont pas d'empreinte de synchro, elles partent comme toute séance créée
  (`planSessionPush`) ; le programme créé part avec le profil (`userProgrammes`, `programmes`, `myProgrammes`, clés déjà
  synchronisées : aucune nouvelle clé de donnée). Envoi retenu pendant les 6 s où « Annuler » est possible
  (`accountHoldSync`, comme l'import d'une sauvegarde). Copie d'avant dans `ppl_v2_backup`.

## Sécurité
Le CSV est une donnée non fiable : lu caractère par caractère (jamais `eval`, jamais `innerHTML` d'un texte brut),
`esc()` sur tout texte affiché (noms, notes, titres), tailles bornées (25 Mo, 200 000 lignes, 20 000 séances, noms 80,
étiquettes 40, notes 2 000), nombres vérifiés (`Number.isFinite`), charges et répétitions aux bornes de l'app
(`MAX_LOAD_KG`, `MAX_COUNT`), clés de séance et identifiants au format exigé par `sanitizeData`. Testé avec un fichier
hostile (HTML, 1e308, −5, RPE 99, nom de 300 caractères).

## Limites connues
- Un seul nom de séance par empreinte : deux séances Hevy commencées la même minute avec les mêmes exercices sont
  vues comme une seule.
- Strong `Distance` sans unité : heuristique mètres / km. Strong `Weight` sans unité : choix dans l'aperçu.
- Mois Hevy dans une langue non listée : la séance est ignorée (comptée dans « Lignes ignorées ») ; exporter avec
  Hevy en anglais.
- Les liens posés à la main ne sont pas mémorisés d'un import à l'autre.
- Pas d'import des mesures corporelles (`measurement_data.csv`, « Export Measurements »).
