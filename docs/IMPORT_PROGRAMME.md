# Importer un programme

Demande de Maxence (27/11/2026) : le coach importe un programme qu'il a déjà (texte, PDF, photo d'une feuille même
manuscrite, dictée), et l'app construit le programme. **Gratuit, sans IA payante, sur tous les téléphones** (iPhone 14
Pro sans Apple Intelligence compris).

## Principe

Tout devient du texte **sur le téléphone**, puis un moteur maison, en JavaScript pur et testé, le comprend et apprend
des corrections.

| Source | Texte obtenu par | Vague |
|---|---|---|
| Texte collé (message, WhatsApp, Notes, copier-coller d'Excel) | tel quel | 1 (OTA) |
| PDF texte | pdf.js 4.10.38 embarqué (`vendor/pdfjs/`), morceaux placés remis en lignes et colonnes | 1 (OTA) |
| Fichier texte, export CSV Hevy / Strong | tel quel ; le CSV part dans l'import existant (`import-ui.js`) | 1 (OTA) |
| Photo, PDF scanné, manuscrit | Apple Vision (`VNRecognizeTextRequest`, fr-FR, iOS 13+), boîtes de chaque ligne | 2 (build) |
| Dictée | `SFSpeechRecognizer` sur l'appareil, `contextualStrings` = noms et alias de la bibliothèque | 2 (build) |
| Android : photo | ML Kit Text Recognition (sur l'appareil, gratuit) | plus tard |

La partie native de la vague 2 (modules `PlanReaderPlugin`, `PlanDictationPlugin`, pont `js/platform/plan-reader.js`)
est préparée sur la branche `import-natif`. Le moteur l'attend déjà : `planTextFromBoxes(items)` prend des boîtes
`{ text, x, y, w, h }` (origine en haut à gauche) et rend le texte, cases d'un tableau séparées par des tabulations.

## Le moteur (`js/data/plan-*.js`)

- `plan-grammar.js` : une ligne → `{ presc, name, marks }`. Séries × reps (« 4x8 », « 4 × 8-12 », « 4*8 », « 4 séries
  de 8 à 12 », « quatre fois huit », « 3 × max », « 3 × 45 s », pyramide « 12/10/8/6 », « 1x5 top set puis 3x8 »),
  repos (« 90 s », « 1'30 », « 1 min 30 », « 2:00 », « une minute trente », « sans repos »), charge (kg, lb, %), RPE,
  RIR, tempo (« 3-1-1 », « 30X0 »), « par bras », techniques (drop set, dégressif, rest-pause, cluster, top set et
  back-off, dernière ou toutes les séries), repères de superset (A1 / A2, « + »). Bruit d'une photo corrigé
  (« rep0s », « 4xl0 », « rnin ») ; une pause dans la rep (« pause 2 s ») n'est pas le repos.
- `plan-match.js` : le nom. Dictionnaire appris d'abord, bibliothèque et alias, abréviations de salle (DC, DI, DM,
  SDT, RDL, OHP, HT, élév lat, leg ext, ext triceps…), homophones de la dictée (« lègue curl », « face poule »,
  « squatte »), noms anglais des apps, puis recherche approchée (fautes, mots collés, index inversé). Score de 0 à 1 ;
  sous 0,62 : pas reconnu, gardé sous son nom.
- `plan-table.js` : tableaux en texte (tabulations, « | », espaces alignés ; en-tête français ou anglais, fautes de
  lecture tolérées ; noms coupés sur deux lignes ; colonne « Séance » ; semaines en colonnes : la première) et texte
  placé d'une photo ou d'un PDF.
- `plan-parser.js` : découpage (dictée recoupée aux « ensuite », « séance suivante » et entre deux prescriptions ;
  « Lundi : DC 4x8, squat 5x5 » = une séance, deux exercices), en-têtes (« Lundi », « Séance A », « Push »,
  « Jour 1 », capitales), jours de repos, sections ignorées (échauffement, conseils, variantes), lignes de suite
  (« Repos 2 min » sous l'exercice), mode guidé (nom, puis prescription), supersets, confiance par ligne :
  **sûr**, **à vérifier** (nom approché, séries ou reps non lues), **pas compris** (hors bibliothèque).
  `planDraftProgramme` en fait un programme perso : séries, fourchette ou reps fixes, repos, tempo, charge prescrite,
  technique (`intens`), superset (`ss`) ; ce qui n'a pas de champ (%, RPE, RIR, max, par bras, pyramide, durée) va
  dans la consigne de l'exercice.
- `plan-aliases.js` : dictionnaire appris (`data.planAliases`, 600 au plus, synchronisé avec le compte par union).

## L'écran

Programme › Ajouter un programme › **Importer un programme** (un seul bouton, qui remplace « Importer depuis Hevy ou
Strong » : le fichier CSV y passe aussi), et la fiche d'un élève côté coach.

1. Coller le texte, ou « Choisir un fichier » (PDF, texte, CSV).
2. **Vérifier l'import** : chaque ligne montre la ligne source en petit, puis ce qui est compris. « À vérifier » et
   « Pas compris » : fond gris de remplissage et mot en clair, jamais d'orange (réservé aux boutons). Un toucher sur
   une ligne : changer l'exercice (les plus proches d'abord), modifier séries et reps (même grammaire), la retirer.
3. **Enregistrer le programme** : il s'ajoute à Mes programmes (il devient l'actif si le programme d'office n'a
   jamais servi) ; pour un élève, il est créé sans toucher aux séances du coach, « Envoyer à … » en bas de sa page.
   Les exercices corrigés sont retenus.

## Mesure

Corpus `tests/fixtures/plans/` : 54 plans écrits à l'aveugle (sans voir le moteur) avec leur vérité attendue
(794 exercices), plus des variantes simulées de façon déterministe (`tests/unit/plan-corpus-lib.mjs`) : photo
bruitée des plans propres et libres (fautes de lecture typiques d'un OCR, environ 4 % des caractères) et tableau
photographié (morceaux placés, dans le désordre, avec bruit), soit 98 cas.

Une ligne est juste si l'exercice, la prescription (séries, reps, durée, repos, max et ce que la ligne dit de plus :
charge, %, RPE, RIR, tempo, par bras, technique), la séance et le superset sont justes ; une ligne inventée compte
comme fausse.

```sh
node tools/plan-corpus/mesure.mjs            # tableau par catégorie
node tools/plan-corpus/mesure.mjs --erreurs  # détail des lignes fausses
```

Seuils vérifiés par `tests/unit/plan-import.mjs` : 90 % sur les plans propres et les tableaux, 75 % sur le libre, la
dictée et la photo.

Limites connues : la dictée « en superset X et Y, chacun 4 × 10 », le circuit « 4 tours » qui donne les séries à
tous ses postes, les distances (« 6 × 20 m »), les reps d'un top set « de 3 » sans séries.

## Notre propre IA (préparée, pas branchée)

Chaque correction enrichit le dictionnaire du coach. La mise en commun, **anonyme et volontaire**, ferait progresser
tout le monde :

- ce qui partirait : `planAliasesSharePayload()` : paires « mots → fiche de la bibliothèque », jamais un nom inventé
  (il peut contenir un prénom), 5 mots au plus, aucun nombre de 3 chiffres ou plus, ni compte ni identifiant ;
- côté serveur (à créer) : une table `plan_alias_votes (key text, name text, voter_hash text, unique (key, name,
  voter_hash))`, `voter_hash` = empreinte salée côté serveur, jamais l'identifiant ; une paire n'est servie qu'avec
  au moins 3 votants distincts et aucune paire concurrente plus votée ; liste servie en lecture seule, téléchargée
  avec les mises à jour ;
- dans l'app : une case « Partager mes corrections, sans mon nom » (Réglages › Coach), décochée d'office ; à décrire
  dans privacy.html et App Privacy avant de la brancher.

## Vague 2 : ce que demandera la build

- Modules Swift (branche `import-natif`) : Vision (`VNRecognizeTextRequest`, `.accurate`, `recognitionLanguages =
  ["fr-FR", "en-US"]`, `usesLanguageCorrection`, boîtes de chaque ligne converties en haut à gauche),
  `VNDocumentCameraViewController` pour cadrer la feuille, `PDFKit` pour rendre les pages d'un PDF scanné en images ;
  `SFSpeechRecognizer(locale: fr-FR)`, `requiresOnDeviceRecognition = true` quand `supportsOnDeviceRecognition`,
  `contextualStrings` = noms et alias de la bibliothèque (100 au plus par requête, les plus courants), mode guidé.
- Info.plist : `NSCameraUsageDescription` (« Pour photographier un programme écrit sur papier. La photo est lue sur
  ton iPhone et n'est pas envoyée. »), `NSMicrophoneUsageDescription` (« Pour dicter ton programme. »),
  `NSSpeechRecognitionUsageDescription` (« Pour comprendre ta dictée, sur ton iPhone. »),
  `NSPhotoLibraryUsageDescription` si l'on choisit une photo existante (le sélecteur `PHPicker` n'en demande pas).
- App Privacy : rien de nouveau tant que tout reste sur l'appareil (la photo, l'audio et le texte ne quittent pas
  l'iPhone ; seul le programme créé se synchronise, comme aujourd'hui). Sans `requiresOnDeviceRecognition`, Apple
  envoie l'audio à ses serveurs : à déclarer dans privacy.html, d'où le choix sur l'appareil.
- « Partager vers MDLF » (Fichiers, Photos, WhatsApp) : extension de partage (Share Extension) avec un groupe d'apps
  (`group.com.mdlf.training`) : l'extension dépose le fichier dans le conteneur commun et ouvre l'app
  (`mdlf://import`) ; nouvelle cible Xcode, profil de provisionnement et capacité App Groups à créer ; à réserver à
  une build dédiée.
- Build TestFlight (règle 2.5.2 : une nouvelle fonction passe par une build, pas une OTA) ; `ios.yml` en mode contrôle
  sur la branche d'abord.

## Vague 3 : un petit modèle dans le navigateur du coach (option)

Sur l'appli web du coach, sur ordinateur : WebLLM (MLC, Apache 2.0) sur WebGPU, **seulement quand le moteur n'est pas
sûr** de lignes et que le navigateur le permet (`navigator.gpu`, adaptateur avec assez de mémoire), jamais imposé :
bouton « Demander au modèle sur cet ordinateur » sous les lignes à vérifier.

- Faisabilité : WebGPU est là dans Chrome et Edge de bureau, Safari récent ; pas sur tous les PC (cartes anciennes).
- Taille : Llama 3.2 1B Instruct en q4f16 ≈ 0,7 Go à télécharger, ≈ 0,9 Go de mémoire graphique (chiffres de tiers à
  vérifier dans `prebuiltAppConfig` de web-llm avant la vague 3) ; un 3B ≈ 2 Go. Téléchargé une fois, gardé dans le
  cache du navigateur ; rien ne quitte l'ordinateur.
- Usage : le modèle reçoit seulement les lignes douteuses et la liste des fiches proches, et doit répondre par un nom
  de la liste (sortie contrainte en JSON) ; sa réponse passe ensuite par l'écran de vérification, comme une correction.
- Apple Intelligence (Foundation Models, iOS 26) en renfort sur les iPhone qui l'ont : même rôle, plus tard.
