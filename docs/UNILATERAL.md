# Séries notées par bras (exercices unilatéraux)

Mise à jour le 20 novembre 2026. Demande de Maxence pendant sa séance du 19/11 : « je suis embêté sur les drop sets
quand je fais un bras puis l'autre ». Sur un curl concentration, il fait bras gauche lourd, puis allégé, puis bras
droit lourd, puis allégé ; l'app n'avait qu'un bloc de drop set par série et ne savait pas où mettre le second bras.

## Fichiers

| Rôle | Fichier |
|------|---------|
| Drapeau du catalogue (exercices toujours faits d'un côté à la fois) | `UNILATERAL_EXERCISES`, `js/data/exercise-catalogue.js` |
| Logique pure : exercices reconnus, second côté, volume, records, enchaînement, nettoyage, textes | `js/data/unilateral.js` (chargé avant `store.js`) |
| Écran : lignes du second côté, validation, choix du menu ⋯ | `js/features/session-unilateral.js` |
| Branchements | `intensif.js` (volume, étape suivante, technique posée), `session-intensif.js` (sous-séries du second côté, repos), `session.js` (lignes, « Avant », RIR), `session-sheets.js` (menu), `summary.js` (enregistrement), `add-session.js` (Historique › Modifier), `store.js` (nettoyage, records du programme), `records.js`, `goals.js`, `recap.js`, `strength-levels.js`, `progress.js`, `history.js`, `backup.js` (CSV) |
| Tests | `tests/unit/unilateral.mjs`, `tests/test_unilateral.py` |

## Exercices concernés

- **Bibliothèque** : `UNILATERAL_EXERCISES` liste les fiches qui se font **toujours** d'un côté à la fois : rowing
  haltère unilatéral (alias « rowing bûcheron un bras »), curl concentration, extension triceps unilatéral, fentes
  bulgares, pont fessier unilatéral, pistol squat (assisté compris), shrimp squat. Pas le kickback ni les élévations
  latérales : ils se font aussi à deux bras, et les marquer obligerait tout le monde à noter deux côtés.
- **Nom saisi** : « un bras », « 1 bras », « une main », « unilatéral(e) », « single arm », « one arm », « une jambe »,
  « single leg » (« Élévation latérale à un bras », « Leg extension unilatérale »). Bras ou jambe selon le nom.
- Seulement en répétitions. Les maintiens d'un côté puis de l'autre (gainage latéral) passent par le chrono, qui
  enchaîne déjà les deux côtés (`BOTH_SIDES_RE`, js/data/effort-clock.js).
- Un exercice à deux bras ne change pas : aucune ligne, aucun choix de menu en plus.

## Décisions

1. **Le second côté est rangé dans la série** (`side2: { weight, reps, sub? }`), comme les sous-séries d'un drop set
   (docs/INTENSIFICATION.md). La série reste le premier côté. Pourquoi : le nombre de séries, les séries par muscle,
   la numérotation, « Avant », le RIR et la note ne bougent pas ; une version précédente de l'app ignore le champ et
   voit la série seule (le premier côté), au lieu de prendre le bras droit pour une 4e série.
2. **Tout l'exercice se note par bras, jamais une seule série** (panel du 20/11 : couper la seule série 3 mélangeait
   un bras et deux bras, le volume devenait faux) :
   - de lui-même, quand on pose un drop set, un rest-pause ou un cluster sur un exercice unilatéral (le problème de
     Maxence, sans toucher de plus) ; les séries déjà validées reçoivent leur bras droit à l'identique, validé,
     corrigeable au toucher ; la technique retirée, l'exercice reste par bras ;
   - quand l'exercice était noté par bras la dernière fois (« pré-remplir avec la dernière fois ») ; une série ajoutée
     l'est aussi ;
   - à la demande : ⋯ › Plus d'options › « Noter chaque bras à part », et « Noter les deux bras ensemble » pour
     revenir (avec « Annuler »). Le choix n'existe que sur un exercice unilatéral ;
   - **premier bras** : ⋯ › Plus d'options › « Commencer par le bras droit » (ou le gauche), retenu par exercice
     (`data.sideFirst`, synchronisé) et gardé avec la séance (`sideFirst` de l'exercice) : les noms suivent.
3. **Ordre et titres** : série (bras gauche), ses sous-séries, bras droit, ses sous-séries (`setSteps`). Chaque côté a
   son titre AU-DESSUS de son groupe (« Bras gauche », « Bras droit » : sous la ligne, ils se lisaient comme le titre
   du bloc d'en dessous), et le drop du bras droit son propre titre « Drop set ». Le côté qui suit est seul mis en
   avant. « + drop » ajoute une sous-série de chaque côté ; le × du drop set le retire des deux (44 pt dessinés).
   **Compteur** (« 3/3 », barre du haut, « Plus tard ») : une série compte une fois le bras droit et son drop faits
   (`setComplete`). VoiceOver : « Valider la série 3, bras gauche », « Charge du bras gauche, en kilos ».
   **Carte repliée** : « 3 × 10/10/9 · 14 kg · drop set · 2 bras ».
4. **Repos** : aucun entre les deux côtés ni avant un drop ; la courte pause d'un rest-pause (15 s) ou d'un cluster
   (20 s) avant chaque mini-série, de chaque côté ; le repos habituel **seulement après le dernier bloc du second
   côté** (`techPauseAfter`, `restAfterStep`). Dans un superset, l'exercice suivant s'enchaîne à ce moment-là.
5. **Pré-remplissage** : la ligne du bras droit reprend la charge et les reps faites au bras gauche (dans les cases,
   un ✓ suffit quand les deux côtés sont pareils) ; sa charge suit le bras gauche tant qu'on n'y touche pas. Chaque
   drop du bras droit reprend la charge du même drop du bras gauche, et ses reps en gris. « Avant » de chaque ligne :
   ce côté-là la dernière fois. Rien n'est jamais augmenté d'office (règle de Maxence du 17/11).
6. **Volume et total de reps** : les deux côtés, sous-séries comprises (`volumeSets`). C'est du travail soulevé.
   **Comparaisons d'une séance à l'autre** (« +X kg de volume » de la carte, tendance du bilan) : sur un exercice
   unilatéral, une série notée sur une seule ligne valait pour les deux bras ; elle compte donc deux fois
   (`comparableSets`, `comparableVolume`). Refaire 14 × 10 à l'identique donne +0, que l'une ou l'autre fois soit
   notée par bras (panel du 20/11 : « +140 kg » faux). « Avant » du bras droit : la ligne unique de la dernière fois.
   Records, cible et 1RM : le meilleur côté (point 7), qu'une ligne unique égale déjà.
7. **Records, 1RM estimé, meilleure série, cible de la prochaine séance, niveau de force, courbe de Progrès** : le
   **meilleur des deux côtés** (`recordSet` : 1RM estimé, puis charge, puis reps), jamais leur somme. Pourquoi pas
   un record par côté : l'historique d'avant n'a qu'une valeur par série, sans côté ; un record « bras droit »
   n'aurait aucune base de comparaison et séparerait la courbe en deux. Le meilleur côté se compare directement aux
   anciennes séances (où chacun notait son meilleur bras ou les deux pareils) et suit la progression réelle de la
   force. Le badge de record se pose sur la ligne du côté qui le fait.
8. **Nombre de séries** : une série notée par bras compte pour une (les deux côtés travaillent les mêmes muscles
   séparément, chacun une fois).

## Ailleurs

- **Historique, séance d'un ami, relecture du coach** : « Bras gauche : 14 kg × 10, 10, 9 », « Drop set série 3,
  bras gauche : 10 kg × 6 », « Bras droit : 14 kg × 10, 10, 9 », « Drop set série 3, bras droit : 10 kg × 5 »
  (`sidePrefix`, `techLines`, `sideLines`). Historique › Modifier garde le second côté tel quel.
- **Export** : la sauvegarde JSON garde le champ ; le CSV a une ligne « 3 bras droit » et « 3.1 bras droit ».
- **Synchro** : la séance part entière (`sessions.data`). `cleanSideSet` ne touche pas une série sans `side2` :
  l'empreinte des anciennes séances ne change pas.
- **Nettoyage** (`sanitizeData` › `cleanHistoryEntry`) : charge 0 à 1000 kg ou vide, reps entières, 6 sous-séries
  au plus, sous-séries gardées seulement si la série garde sa technique, jamais sur un échauffement.

## Limites connues

- **Ancien appareil** : il voit le premier côté seul (volume du second en moins, comme les sous-séries d'un drop set) ;
  s'il modifie la séance (Historique › Modifier), il perd le second côté.
- **Amis et coach** : la migration `supabase/migrations/20261120010000_seance_publique_par_bras.sql` fait passer
  `side2` et `sideFirst` dans `private.session_public` (bornés comme les sous-séries ; test `tests/sql/par_bras_test.sql`,
  retour arrière dans `supabase/rollback/`). Elle n'est PAS appliquée en production : tant qu'elle ne l'est pas, ils
  voient le premier côté seul. Côté app, l'Historique, la séance d'un ami et la relecture du coach montrent déjà
  « Bras gauche : … » et « Bras droit : … ».
- **Volume affiché d'une ancienne séance** : l'Historique et la courbe de Progrès gardent ce qui a été noté (une ligne
  = un bras) ; seules les comparaisons de séance à séance comptent la ligne unique pour les deux bras.
- Apple Watch et Live Activity : la montre voit et valide la série ; le second côté se fait sur l'iPhone. Les
  courtes pauses d'un rest-pause ou d'un cluster du bras droit passent par `openRest` (notification et Live
  Activity habituelles, « Mini-série +1 »).
