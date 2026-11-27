# Corpus réel de l'import de programme

Vrais documents trouvés sur Internet (27/11/2026) et vraies dictées, pour mesurer le moteur d'import
(`js/data/plan-*.js`) sur ce qu'Apple Vision et la reconnaissance vocale rendent vraiment, et plus seulement sur du
bruit simulé (`tests/unit/plan-corpus-lib.mjs`).

- **41 documents** : 5 capture, 4 imprime, 12 manuscrit, 4 pdf-scanne, 8 pdf-texte, 8 tableau ; 21 en en, 20 en fr.
- **14 dans ce dépôt** (`fichiers/`, vérité dans `verite/`) : licence libre (CC BY, CC BY-SA, domaine public).
- **27 en local seulement** (`~/.local/share/mdlf/corpus-import/`, hors dépôt) : licence non libre ou douteuse,
  ou visages. Seul ce manifeste est versionné ; leur vérité reste en local. Ils ne passent jamais par GitHub.
- **15 dictées** (`dictees-scripts/`) : scripts naturels écrits pour ce corpus (hésitations, « euh », corrections, ordre libre,
  nombres en lettres), lus par les voix françaises de macOS (`say`).
- `sorties/` : ce que rendent Apple Vision (`*.ocr.json`), SFSpeechRecognizer (`*.stt.json`) et whisper.cpp
  (`*.whisper.json`) sur la machine macOS de GitHub (`.github/workflows/corpus-reel.yml`).

Les vraies photos et dictées faites sur un iPhone avec la build ont leur propre dossier (`photos/`, `dictees/`,
`README.md`, `tools/plan-corpus/reels.mjs`) : ce corpus-ci les complète sans attendre la build.

## Mesurer

```sh
node tools/plan-corpus/mesure-reel.mjs              # tableau par catégorie et 10 erreurs les plus fréquentes
node tools/plan-corpus/mesure-reel.mjs --erreurs    # détail par document
node tools/plan-corpus/lecture-locale.mjs           # documents locaux : pdf.js (comme l'app) et Tesseract (approximation)
```

Workflow `Corpus réel (Vision et dictée)` : déclenché à la main (`workflow_dispatch`, une fois le fichier sur la
branche par défaut) ou par un push sur la branche `corpus-reel` qui touche le corpus ou les outils ; artefact
`corpus-reel-sorties` à recopier dans `sorties/`. whisper.cpp (20 min) seulement à la main ou avec `[whisper]`
dans le message du commit.

Chaque document est mesuré deux fois : sur sa transcription humaine (« texte parfait », ce que vaut le moteur seul) et
sur la vraie lecture. Même score que le corpus écrit (`scorePlan`) : exercice, prescription, séance et superset justes.

## Vérité terrain

Même format et mêmes règles que `tests/fixtures/plans/README.md`, plus `source_id`, `file`, `langue` et, pour un PDF,
`pages` (pages lues, 1 = première). `text` est la transcription fidèle de ce qu'un humain lit. Choix propres au réel :
charges en livres non converties (pas de `load`), fourchettes de repos, de durée ou de % non notées (le format n'en a
pas), carnet rempli : la prescription écrite et pas les charges réalisées, tableau par niveau : niveau A (règle de la
semaine 1), échauffements en `optional`.

## Documents dans le dépôt

| id | catégorie | langue | exercices | source | auteur | licence | page | consulté |
|---|---|---|---|---|---|---|---|---|
| img-01-tableau-craie-emom | manuscrit | en | 7 | Wikimedia Commons | Shixart1985 | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [lien](https://commons.wikimedia.org/wiki/File:A_chalkboard_in_a_gym_details_a_structured_workout_plan.jpg) | 2026-11-27 |
| img-02-tableau-blanc-warmup-squat-clean | manuscrit | en | 1 | Wikimedia Commons | Colby Otero | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [lien](https://commons.wikimedia.org/wiki/File:Tableau_d%27entrainement_CrossFit.jpg) | 2026-11-27 |
| img-04-tableau-blanc-hero-wod-kandahar | manuscrit | en | 9 | Flickr | Crossfit Kandahar | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [lien](https://www.flickr.com/photos/78025572@N04/6989044131/) | 2026-11-27 |
| img-06-tableau-blanc-front-squat-burpees | manuscrit | en | 7 | Flickr | Andrew Crookston | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [lien](https://www.flickr.com/photos/39587668@N04/8137299220/) | 2026-11-27 |
| img-07-tableau-blanc-bear-complex | manuscrit | en | 5 | Flickr | Andrew Crookston | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [lien](https://www.flickr.com/photos/39587668@N04/7348704382/) | 2026-11-27 |
| img-08-feuille-wod-manuscrite | manuscrit | en | 10 | Flickr | Andrew Crookston | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [lien](https://www.flickr.com/photos/39587668@N04/8569934565/) | 2026-11-27 |
| img-09-tableau-blanc-hotshots-hero-wod | manuscrit | en | 4 | Flickr | chris.wojtewicz | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [lien](https://www.flickr.com/photos/67661066@N03/9736543630/) | 2026-11-27 |
| img-12-carnet-rempli-force | manuscrit | en | 12 | Flickr | Tier 1 Leadership | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [lien](https://www.flickr.com/photos/80138614@N03/7183468425/) | 2026-11-27 |
| img-13-programme-imprime-flou | imprime | en | 3 | Flickr | Lance Goyke | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [lien](https://www.flickr.com/photos/125473839@N07/26345758509/) | 2026-11-27 |
| img-15-capture-appli-fitbod | capture | en | 4 | Flickr | Kurman Communications LLC | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [lien](https://www.flickr.com/photos/62558987@N07/49896037602/) | 2026-11-27 |
| img-16-tableau-blanc-circuit-2-rounds | manuscrit | en | 5 | Flickr | Andrew Crookston | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [lien](https://www.flickr.com/photos/39587668@N04/8242631025/) | 2026-11-27 |
| img-17-capture-appli-gym-buddy | capture | en | 7 | Flickr | Marco Paköeningrat | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [lien](https://www.flickr.com/photos/33863004@N00/3390344618/) | 2026-11-27 |
| img-18-capture-tweet-leg-day | capture | en | 4 | Flickr | J@YGS | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [lien](https://www.flickr.com/photos/52696904@N03/14850230563/) | 2026-11-27 |
| pdf-02-desbonnet-halteres-1920 | pdf-scanne | fr | 18 | Internet Archive (numérisation d'un exemplaire de l'édition 1920, Librairie de la Culture physique) | Edmond Desbonnet (1867-1953) | [domaine public](https://creativecommons.org/publicdomain/mark/1.0/) | [lien](https://archive.org/details/desbonnetpourdevenirfortetlerester) | 2026-11-27 |

Modifications et remarques :

- **img-01-tableau-craie-emom** : Tableau noir à la craie (salle de CrossFit) : échauffement Tabata, force 5x6 bench, WOD 3 rounds, EMOM 12. Photo de biais, colonne de droite coupée par le cadre (THRUS..., PUSH UPS -...), craie un peu effacée.
- **img-02-tableau-blanc-warmup-squat-clean** : Tableau blanc posé contre un grillage, deux colonnes (Warmup / Hang Squat Cleans 4 on the minute 12 minutes). Petite image (640 px), filtre sépia, reflets, filigrane de l'auteur à droite.
- **img-04-tableau-blanc-hero-wod-kandahar** : Tableau blanc d'un WOD caritatif (Kandahar). Image MODIFIÉE : feuille scotchée (liste de noms complets) et colonne de prénoms à droite masquées en gris ; le masque frôle la fin de « 95/65 ». Reflet de flash au milieu.
- **img-06-tableau-blanc-front-squat-burpees** : Tableau blanc photographié de biais (Instagram 612 px) : front squat toutes les 3 min puis burpees haltères et course. Bas coupé avec scores et prénoms, texte « 45/30 » coupé à droite.
- **img-07-tableau-blanc-bear-complex** : Tableau blanc, gros feutre noir, cadrage serré (612 px), léger flou de bougé, reflet bleuté.
- **img-08-feuille-wod-manuscrite** : Feuille de classeur lignée affichée au mur, au stylo : blocs entre accolades « x3 », temps entouré 20:45. Reflet lumineux au centre, écriture d'une page précédente visible en transparence en bas.
- **img-09-tableau-blanc-hotshots-hero-wod** : Tableau blanc au feutre violet, zéros barrés (3Ø, 4ØØ), annotations « (SCALE WEIGHT) », « (SCALE W BAND) », affiche scotchée en bas. 612 px.
- **img-12-carnet-rempli-force** : Carnet d'entraînement imprimé à spirale, rempli au crayon : 4 séances sur deux pages (abréviations F SQT, P Cln, DL, charges en livres). Noir et blanc, 648 px seulement, bords coupés, écriture pâle : difficile.
- **img-13-programme-imprime-flou** : Programme imprimé (grille Exercise / Tempo / Week 1-4) posé sur une table, photo artistique à faible profondeur de champ : seule la ligne 1A est nette, le reste est flou, deux feuilles se chevauchent, texte en diagonale. 6000x4000. Cas limite pour l'OCR.
- **img-15-capture-appli-fitbod** : Visuel promotionnel de l'appli Fitbod : deux captures d'iPhone (thème sombre), séance « Full Body Workout » avec « 4 SETS • 6 REPS » sous chaque exercice, et écran de récupération musculaire. Liste coupée en bas (superset).
- **img-16-tableau-blanc-circuit-2-rounds** : Tableau blanc photographié de biais, lumière chaude jaune, circuit 2 rounds de 2:00 par station. Bas coupé (scores avec prénoms). 612 px.
- **img-17-capture-appli-gym-buddy** : Capture d'iPhone 3G (320x480) de l'appli Gym Buddy en espagnol/anglais : routine « Bicep », chaque exercice suivi d'une ligne de détail (reps, charges en kg/lb). Très petite résolution.
- **img-18-capture-tweet-leg-day** : Capture d'un tweet d'un coach : séance jambes en une phrase avec hashtags (« #Squats 4x8. #Singleleg squat 5x6... »). Image MODIFIÉE : photo de profil (visage) masquée en gris ; le pseudo reste. Prescriptions coupées par les retours à la ligne.
- **pdf-02-desbonnet-halteres-1920** : Le PDF d'origine fait 289 Mo : j'ai téléchargé les 3 images de pages (feuillets n139-n141 de la visionneuse, 1 600 px de large) et les ai assemblées en un PDF image de 3 pages sans couche texte (PIL). Auteur mort en 1953 : domaine public en France depuis le 1er janvier 2024 (70 ans après la mort). Livre p. 91 = page 1 du PDF, p. 92 = 2, p. 93 = 3. Pas de photo sur ces pages (le livre contient ailleurs des nus d'époque, pages non prises). « livre » ancienne = 500 g, charge laissée vide. Le 18e exercice n'a pas de nombre.

Les images CC BY-SA modifiées (zones masquées) sont rediffusées sous la même licence.

## Documents locaux (non versionnés)

| id | catégorie | langue | exercices | source | auteur | licence | page | consulté |
|---|---|---|---|---|---|---|---|---|
| img-03-tableau-blanc-sunday-workout | manuscrit | en | 9 | Flickr | Eban Crawford | [CC BY-ND 2.0](https://creativecommons.org/licenses/by-nd/2.0/) | [lien](https://www.flickr.com/photos/68385125@N00/4894142022/) | 2026-11-27 |
| img-05-tableau-blanc-amrap-snatch | manuscrit | en | 3 | Flickr | Omar | [CC BY-NC-SA 2.0](https://creativecommons.org/licenses/by-nc-sa/2.0/) | [lien](https://www.flickr.com/photos/25132612@N00/6063342012/) | 2026-11-27 |
| img-10-tableau-blanc-amrap-20 | manuscrit | en | 3 | Flickr | Mike Bitton | [CC BY-NC-SA 2.0](https://creativecommons.org/licenses/by-nc-sa/2.0/) | [lien](https://www.flickr.com/photos/43498104@N00/3288881306/) | 2026-11-27 |
| img-11-capture-stronglifts-5x5 | capture | en | 3 | Flickr | frequeniquity | [CC BY-NC-SA 2.0](https://creativecommons.org/licenses/by-nc-sa/2.0/) | [lien](https://www.flickr.com/photos/17623883@N00/8653381549/) | 2026-11-27 |
| img-14-capture-plan-ipad | capture | en | 7 | Flickr | Jeffrey Zeldman | [CC BY-NC-ND 2.0](https://creativecommons.org/licenses/by-nc-nd/2.0/) | [lien](https://www.flickr.com/photos/48889052497@N01/4823285351/) | 2026-11-27 |
| img-20-tableau-full-body-superset-cadence | tableau | fr | 8 | espace-musculation.com (via Pinterest) | Espace Musculation | droits réservés/inconnue | [lien](https://www.espace-musculation.com/programme-full-body.html) | 2026-11-27 |
| img-21-tableau-split-3-jours-azbody | tableau | fr | 22 | azbody.com (via Pinterest) | AZbody | droits réservés/inconnue | [lien](https://www.pinterest.com/pin/300193131432316499/) | 2026-11-27 |
| img-22-tableau-supersets-repos-15s | tableau | fr | 12 | espace-musculation.com (via Pinterest) | Espace Musculation | droits réservés/inconnue | [lien](https://uk.pinterest.com/pin/477381629272995504/) | 2026-11-27 |
| img-23-fiche-salle-volume-seche | imprime | fr | 16 | Pinterest (tableau de pins, auteur de la fiche inconnu) | inconnu | droits réservés/inconnue | [lien](https://za.pinterest.com/achimwahl193/fitness%C3%BCbungen/) | 2026-11-27 |
| img-24-tableau-half-body-series-combinees | tableau | fr | 8 | espace-musculation.com (via Pinterest) | Espace Musculation | droits réservés/inconnue | [lien](https://www.espace-musculation.com/programme-musculation-half-body.html) | 2026-11-27 |
| img-25-fiche-salle-prise-de-masse-couleurs | imprime | fr | 13 | exercicesdemusculati-rdrytyrd.sitew.fr (via Pinterest) | inconnu (site perso sitew) | droits réservés/inconnue | [lien](http://www.exercicesdemusculati-rdrytyrd.sitew.fr/#Programmes_objectif_Masse_Musculaire.A) | 2026-11-27 |
| img-26-planning-hebdo-4-seances | tableau | fr | 16 | holifit.fr (via Pinterest) | Holifit | droits réservés/inconnue | [lien](http://holifit.fr/2014/11/programme-musculation-special-femme_25.html) | 2026-11-27 |
| img-27-tableau-jambes-series-degressives | tableau | fr | 7 | espace-musculation.com (via Pinterest) | Espace Musculation | droits réservés/inconnue | [lien](https://www.espace-musculation.com/programme-musculation-half-body.html) | 2026-11-27 |
| img-28-tableau-epaules-repos-fusionne | tableau | fr | 5 | espace-musculation.com (via Pinterest) | Espace Musculation | droits réservés/inconnue | [lien](https://www.espace-musculation.com/programme-epaules.html) | 2026-11-27 |
| img-29-tableau-ppl-charges-progression | tableau | fr | 38 | Pinterest (page d'idées, document d'origine inconnu) | inconnu | droits réservés/inconnue | [lien](https://ie.pinterest.com/ideas/programmes-de-conditionnement-physique/912378919317/) | 2026-11-27 |
| img-30-infographie-seance-jambes | imprime | fr | 6 | protrainer.fr (via Pinterest) | Protrainer | droits réservés/inconnue | [lien](https://www.protrainer.fr/) | 2026-11-27 |
| pdf-01-ecole-air-adaptation-2025 | pdf-scanne | fr | 22 | École de l'air et de l'espace (armée de l'Air et de l'Espace) | École de l'air et de l'espace (non nommé) | droits réservés/inconnue | [lien](https://www.ecole-air-espace.fr/) | 2026-11-27 |
| pdf-03-marchesseau-culture-physique-femme | pdf-scanne | fr | 6 | Internet Archive (dépôt d'un particulier) | P.-V. Marchesseau (naturopathe, mort en 1994) | droits réservés/inconnue | [lien](https://archive.org/details/MARCHESSEAUCULTUREPHYSIQUEDELAFEMME) | 2026-11-27 |
| pdf-04-york-barbell-course-2 | pdf-scanne | en | 13 | Internet Archive (numérisation) | Bob Hoffman, York Barbell Company (1946) | droits réservés/inconnue | [lien](https://archive.org/details/york-barbell-and-dumbell-system-1-2) | 2026-11-27 |
| pdf-05-ffhm-programme-minceur | pdf-texte | fr | 25 | FFHMFAC (Fédération Française d'Haltérophilie, Musculation, Force Athlétique et Culturisme, aujourd'hui FFHM), fiche relayée par le club SC Fameck (57) | FFHMFAC | droits réservés/inconnue | [lien](https://scfameck57.sportsregions.fr/) | 2026-11-27 |
| pdf-06-ffaviron-seances-senior | pdf-texte | fr | 17 | Fédération Française d'Aviron, Direction technique nationale / Mission d'aide à la performance | Ashlee Rowe (préparatrice physique des Équipes de France d'aviron) ; infographie Gilles Bosquet | droits réservés/inconnue | [lien](https://map.ffaviron.fr/) | 2026-11-27 |
| pdf-07-world-rugby-activate | pdf-texte | fr | 8 | World Rugby (Activate, programme de prévention des blessures) | World Rugby | droits réservés/inconnue | [lien](https://passport.world.rugby/fr/injury-prevention-and-risk-management/activate/) | 2026-11-27 |
| pdf-08-armee-suisse-preparation | pdf-texte | fr | 3 | Armée suisse (DDPS), détachement de reconnaissance de l'armée — cours de présélection | Armée suisse | droits réservés/inconnue | [lien](https://www.vtg.admin.ch/) | 2026-11-27 |
| pdf-09-ecole-air-preparation-2020 | pdf-texte | fr | 10 | École de l'air et de l'espace (armée de l'Air et de l'Espace), Salon-de-Provence | École de l'air, division formation (non nommé) | droits réservés/inconnue | [lien](https://www.ecole-air-espace.fr/) | 2026-11-27 |
| pdf-10-martinique-progression-muscu | pdf-texte | fr | 10 | Académie de Martinique, site EPS | Équipe EPS académie de Martinique (non nommé) | droits réservés/inconnue | [lien](https://site.ac-martinique.fr/eps/) | 2026-11-27 |
| pdf-11-nia-workout-to-go | pdf-texte | en | 4 | National Institute on Aging (NIH, gouvernement fédéral US), campagne Go4Life | National Institute on Aging, NIH | [domaine public](https://www.usa.gov/government-works) | [lien](https://purl.fdlp.gov/GPO/gpo62941) | 2026-11-27 |
| pdf-12-nhs-newham-home-workout | pdf-texte | en | 7 | London Borough of Newham / Active Newham, reprise des séances « Home workout » du NHS | NHS (contenu) ; Newham Council (mise en page) | droits réservés/inconnue | [lien](https://www.newham.gov.uk/) | 2026-11-27 |
