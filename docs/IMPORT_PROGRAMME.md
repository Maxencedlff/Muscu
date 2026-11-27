# Importer un programme

Demande de Maxence (27/11/2026) : le coach importe un programme qu'il a déjà (texte, PDF, photo d'une feuille même
manuscrite, dictée), et l'app construit le programme. **Gratuit, sans IA payante, sur tous les téléphones** (iPhone 14
Pro sans Apple Intelligence compris).

## Principe

Tout devient du texte **sur le téléphone**, puis un moteur maison, en JavaScript pur et testé, le comprend et apprend
des corrections.

**Tout part dans une seule build TestFlight (branche `import-build`), jamais en mise à jour à chaud** : c'est une
fonction nouvelle (règle 2.5.2 d'Apple ; règle du projet, IOS.md « Règle Apple » et docs/BUILD.md). Même Coller et
PDF, qui ne touchent pas au natif, sont une fonction nouvelle (deux écrans, le bouton d'« Ajouter un programme »
changé, une entrée sur la fiche d'un élève, une donnée de plus copiée sur le compte). La garde `features.json`
(docs/REVUE_APPLE.md, 6.2) fait refuser à `ota.yml` toute mise à jour à chaud qui l'apporterait.

| Source | Texte obtenu par | Livraison |
|---|---|---|
| Texte collé (message, WhatsApp, Notes, copier-coller d'Excel) | tel quel | build |
| PDF texte | pdf.js 4.10.38, build **legacy** embarquée (`vendor/pdfjs/`, empreintes sha256 vérifiées par `tests/unit/pdfjs-vendor.mjs`), morceaux placés remis en lignes et colonnes | build |
| Fichier texte, export CSV Hevy / Strong | tel quel ; le CSV part dans l'import existant (`import-ui.js`) | build |
| Photo, PDF scanné, manuscrit | Apple Vision (`VNRecognizeTextRequest`, fr-FR, iOS 13+), boîtes de chaque ligne | build |
| Dictée | `SFSpeechRecognizer` sur l'appareil, `contextualStrings` = noms et alias de la bibliothèque | build |
| Android : photo | ML Kit Text Recognition (sur l'appareil, gratuit) | plus tard |

La partie native (modules `PlanReaderPlugin`, `PlanDictationPlugin`, second pont natif `js/platform/plan-reader.js`,
dédié à l'import) vient de la branche `import-natif`, réunie avec l'écran et le moteur dans `import-build`. Le moteur la lit déjà : `planTextFromPages(pages)` prend les pages de
`PlanReader` (lignes et mots, boîtes de 0 à 1, origine en haut à gauche) et `planTextFromBoxes(items)` des boîtes
`{ text, x, y, w, h }` ; le texte rendu garde les cases d'un tableau séparées par des tabulations. L'écran propose
« Photo », « Scanner une feuille » et « Dicter » **en haut**, au-dessus de la zone de texte, seulement quand
`PlanReader.available` (et, pour Dicter, `PlanReader.dictation.available` ET `status().onDevice` : la dictée hors
ligne doit être possible sur l'appareil) ; sinon il reste sur Coller et Choisir un fichier. Une lecture de plusieurs
pages montre « Page N sur M » et un bouton Annuler (`onProgress`, `PlanReader.cancelRead`) ; Vision lit des
miniatures bornées à 3 000 px (`CGImageSourceCreateThumbnailAtIndex`), pas l'image entière. Un PDF sans texte passe par
`PlanReader.readFile` (scan). Dictée : « Tout d'un coup », ou « Pas à pas » (« Quel exercice ? » puis « Combien de
séries et de reps ? », vocabulaire réduit à chaque question, `planDictationWords`). Annuler abandonne toute la dictée ;
une réponse vide repose la même question (rien ne se décale) ; « J'ai fini » lit ce qui est déjà dicté. Testé avec un faux pont de même
forme (`tests/test_import_programme.py`).

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
  sous 0,62 : pas reconnu, gardé sous son nom. Le matériel écrit mais absent de la fiche pèse moitié moins que le
  mouvement (« Rowing menton barre » = rowing menton) ; « X ou Y » = X ; un nom pas sûr est relu sans ses mots
  inconnus du début et de la fin (« à la maison avec la kettlebell swing »), puis par la prononciation.
- `plan-table.js` : tableaux en texte (tabulations, « | », espaces alignés ; en-tête français ou anglais, fautes de
  lecture tolérées ; noms coupés sur deux lignes ; colonne « Séance » ; semaines en colonnes : la première) et texte
  placé d'une photo ou d'un PDF. Tableaux réels : colonne de groupe (« Muscles (superset) ») et première case vide =
  même groupe, sa case de repos fusionnée vaut pour lui ; une seule case de repos au milieu d'un tableau vaut pour tout
  le tableau ; colonne N° (machine) ignorée ; planning de la semaine (« Jours | Groupes musculaires ») sans exercice ;
  catalogue d'une fiche de salle (rangée sans séries ni reps) pas pris pour un exercice ; fiche en cartes (étiquette
  du groupe, nom, en-tête des cases, valeurs) ; reps série par série (« 5 | 5 | 5 | 5 | 5 »). Texte placé : une ligne
  de Vision penchée reste une rangée (morceaux d'une rangée côte à côte, jamais l'un sur l'autre) ; lettres d'une
  autre police collées par pdf.js (« sé » « A » « nces ») ; décor d'une capture (barre d'état, « 1 of 2 ») ignoré.
- `plan-blocks.js` : blocs d'un WOD ou d'un circuit (« 5 rounds », « 6 RFT », « faire 4 tours », « EMOM 12 »,
  « Tabata », « 21-15-9 », « 2:00 each station ») qui valent pour les exercices qui suivent, et accolade « >x3 » en fin
  de ligne (les lignes de reps voisines prennent ses séries et s'enchaînent).
- `plan-phonetic.js` : phonétique simplifiée du français pour la dictée (règles générales, pas une liste de cas) ;
  dernier recours du nom (« Lip trust » = hip thrust, « quête Lebel swing » = swing kettlebell) et des nombres mal
  entendus après « fois » (« quatre fois nuit » = 4 x 8).
- `plan-parser.js` : découpage (dictée recoupée aux « ensuite », « séance suivante » et entre deux prescriptions ;
  « Lundi : DC 4x8, squat 5x5 » = une séance, deux exercices), en-têtes (« Lundi », « Séance A », « Push »,
  « Jour 1 », capitales), jours de repos, sections ignorées (échauffement, conseils, variantes), lignes de suite
  (« Repos 2 min » sous l'exercice), mode guidé (nom, puis prescription), supersets, confiance par ligne :
  **sûr**, **à vérifier** (nom approché, matériel écrit différent de celui de la fiche : « Tirage horizontal machine »
  lu comme « Tirage horizontal câble », séries ou reps non lues), **pas compris** (hors bibliothèque). Une précision
  retirée pour trouver la fiche reste dans la consigne quand elle compte (« Weighted dips » = Dips, consigne « Lesté »).
  Limites : 20 000 caractères lus à l'écran, 300 exercices, 14 séances ; une limite atteinte est dite sur l'écran
  « Vérifier l'import » (« Programme incomplet »), jamais en silence.
  `planDraftProgramme` en fait un programme perso : séries, fourchette ou reps fixes, repos, tempo, charge prescrite,
  technique (`intens`), superset (`ss`) ; ce qui n'a pas de champ (%, RPE, RIR, max, par bras, pyramide, durée) va
  dans la consigne de l'exercice.
- `plan-aliases.js` : dictionnaire appris (`data.planAliases` { mots lus : nom }, `data.planAliasesAt` { mots lus :
  date }, 600 au plus : les plus anciennes sortent, à l'enregistrement comme dans `sanitizeData`). Copié sur le compte
  (privacy.html, FR et EN). Fusion de la synchro datée clé par clé (`mergePlanAliases`) : une correction oubliée laisse
  une pierre tombale datée, et ne revient pas d'un appareil qui l'a encore. Liste et effacement : Réglages ›
  Programmes › Corrections retenues (cellule montrée dès qu'il y en a une). Clés lues avec `Object.hasOwn` (« constructor
  4x8 » ne plante pas).

Empreintes figées de pdf.js (fichiers de `pdfjs-dist@4.10.38/legacy/build/`, renommés en `.js`) :
`pdf.min.js` 44ec6f011027ee77791386b66c14876a5fc29e20bf0433c07c6726fff7212b72,
`pdf.worker.min.js` bd88805178a26c729db8c0107a5b630cb900ec070f4d8c7529a3e45530afd41d. Aucune faille connue sur cette
version ; la branche 4.x n'est plus suivie par Mozilla : passer à une 5.x se fera en remplaçant les deux fichiers et
les empreintes du test.

## L'écran

Programme › Ajouter un programme › **Importer un programme** (un seul bouton, qui remplace « Importer depuis Hevy ou
Strong » : le fichier CSV y passe aussi), et la fiche d'un élève côté coach.

1. Photo, Scanner une feuille, Dicter en haut (app iPhone et iPad), puis coller le texte, ou « Choisir un fichier »
   (PDF, texte, CSV, image). Le pied de l'écran dit ce qui part : la photo, la voix et le texte sont lus sur
   l'appareil sans être envoyés ; avec un compte, le programme enregistré et les corrections y sont copiés.
2. **Vérifier l'import** : chaque ligne montre la ligne source en petit, puis ce qui est compris. « À vérifier » et
   « Pas compris » : fond gris de remplissage et mot en clair, jamais d'orange (réservé aux boutons). Un toucher sur
   une ligne : changer l'exercice (les plus proches d'abord), modifier séries et reps (même grammaire), la retirer.
3. **Enregistrer le programme** : il s'ajoute à Mes programmes (il devient l'actif si le programme d'office n'a
   jamais servi) ; pour un élève, il est ajouté aux programmes du coach (« Ajouté à tes programmes, prêt à envoyer à … », dit à
   l'écran et dans le message de fin) sans toucher à ses séances, « Envoyer à … » en bas de sa page.
   Les exercices corrigés sont retenus.

## Mesure

**Chiffres de laboratoire pour la photo et la dictée** : le bruit photo est simulé (`plan-corpus-lib.mjs`, et il
ressemble par construction à ce que corrige `planDeOcr`), la dictée est écrite, pas dite. Ils ne disent pas ce que
donneront de vraies photos ni une vraie voix. Les vrais cas : `tests/fixtures/plans/reels/` (10 photos et 10 dictées
fournies par Maxence après la build, texte lu récupéré sur l'iPhone, passé par `node tools/plan-corpus/reels.mjs`).
Relecture de l'audit : sur 5 plans écrits par l'auditeur, environ 26 lignes justes sur 29.

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

Limites connues : les reps d'un top set « de 3 » sans séries. (La dictée « en superset X et Y, chacun 4 × 10 », le
circuit « 4 tours » donné à tous ses postes et les distances « 6 × 20 m » sont lus depuis le corpus réel.)

### Corpus réel (27/11/2026)

41 documents réels et 15 dictées dites par des voix de macOS (`tests/fixtures/plans/reels/SOURCES.md`), lus par
Apple Vision, pdf.js, SFSpeechRecognizer et whisper.cpp. `node tools/plan-corpus/mesure-reel.mjs --lots`.

Contre le sur-réglage : partage fait **avant** de toucher au moteur (`tools/plan-corpus/lots.json` : par document,
par catégorie, ordre d'un hachage du nom, 60 % en apprentissage). Le moteur n'a été réglé que sur le lot
d'apprentissage ; le lot de contrôle ne montre que ses chiffres (`--lot controle --erreurs` refuse). Aucune règle
écrite pour un seul document ni mot tiré d'une vérité ; les exemples des tests (`tests/unit/plan-import-reel.mjs`)
sont écrits pour eux. Justesse des lignes, toutes sources : apprentissage 12,7 % → 33,3 %, contrôle 16,5 % → 25,2 %
(détail par catégorie dans le message du commit et le rapport du 27/11). L'écart entre les deux lots dit ce qui reste
propre au lot d'apprentissage.

Ce qui reste dur : la fiche en cartes à plusieurs colonnes lue par pdf.js (trois cartes côte à côte, cases sur
plusieurs lignes), les voix de synthèse robotiques (Eddy, Flo) que la reconnaissance vocale ne comprend pas, les
photos de biais ou floues (Vision mêle ou perd les lignes), les mouvements CrossFit absents de la bibliothèque (box
jump, wall ball, power clean, thruster à la barre, push press : un exercice demande ses sous-muscles sourcés,
fichier généré `js/data/exercise-parts.js`, et sa fiche « Comment faire »), les choix d'interprétation d'une vérité
(« Pull over » seul = haltère ou poulie, « Développé haltères » = couché ou militaire selon la séance).

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

## La build : ce qu'elle contient

- Modules Swift (branche `import-natif`) : Vision (`VNRecognizeTextRequest`, `.accurate`, `recognitionLanguages =
  ["fr-FR", "en-US"]`, `usesLanguageCorrection`, boîtes de chaque ligne converties en haut à gauche),
  `VNDocumentCameraViewController` pour cadrer la feuille, `PDFKit` pour rendre les pages d'un PDF scanné en images ;
  `SFSpeechRecognizer(locale: fr-FR)`, `requiresOnDeviceRecognition = true` quand `supportsOnDeviceRecognition`,
  `contextualStrings` = noms et alias de la bibliothèque (100 au plus par requête, les plus courants), mode guidé.
- Info.plist (textes réels de la build) :
  - `NSCameraUsageDescription`, passage ajouté : « pour photographier ou numériser un programme d'entraînement sur
    papier (le texte est lu directement sur ton appareil, l'image n'est pas envoyée) » ;
  - `NSMicrophoneUsageDescription` : « MDLF Training utilise le micro seulement quand tu dictes ton programme
    d'entraînement. Ta voix est transformée en texte directement sur ton appareil : elle n'est ni enregistrée ni
    envoyée. » ;
  - `NSSpeechRecognitionUsageDescription` : « MDLF Training transforme ta dictée en texte pour remplir ton programme
    d'entraînement. La reconnaissance se fait sur ton appareil, hors ligne. Si ton appareil ne sait pas le faire hors
    ligne, la dictée n'est pas proposée. » (exact : Dicter n'apparaît que si `status().onDevice`, et le pont refuse
    `OFFLINE_UNAVAILABLE` sans jamais basculer vers les serveurs d'Apple) ;
  - Photos passe par `PHPicker` : aucune autorisation (`NSPhotoLibraryUsageDescription` inchangé).
- App Privacy : rien de nouveau tant que tout reste sur l'appareil (la photo, l'audio et le texte ne quittent pas
  l'iPhone ; seul le programme créé se synchronise, comme aujourd'hui). Sans `requiresOnDeviceRecognition`, Apple
  envoie l'audio à ses serveurs : à déclarer dans privacy.html, d'où le choix sur l'appareil.
- « Partager vers MDLF » (Fichiers, Photos, WhatsApp) : extension de partage (Share Extension) avec un groupe d'apps
  (`group.com.mdlf.training`) : l'extension dépose le fichier dans le conteneur commun et ouvre l'app
  (`mdlf://import`) ; nouvelle cible Xcode, profil de provisionnement et capacité App Groups à créer ; à réserver à
  une build dédiée.
- Build TestFlight (règle 2.5.2 : une nouvelle fonction passe par une build, pas une OTA) ; `ios.yml` en mode contrôle
  sur la branche d'abord ; « What to Test » et le paragraphe de la note d'examen : docs/REVUE_APPLE.md, section 6.7.
  À l'approbation, ajouter `programme.import-texte-pdf`, `programme.import-photo-dictee` et
  `reglages.corrections-retenues` à `store/derniere-build.json`.

## Renfort de l'IA (Claude, payant, sur le serveur)

Décision de Maxence (27/11/2026) : le moteur ci-dessus lit toujours d'abord, gratuitement, sur le téléphone ; Claude
ne vient qu'en renfort quand il hésite, ou si le coach le demande, après un accord à chaque envoi. Tout est dans
**docs/IMPORT_IA.md** (fonction `plan-import-ai`, quotas, cache, confidentialité, mesure sur le corpus réel).

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
