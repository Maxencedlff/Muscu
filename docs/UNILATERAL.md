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
2. **Quand une série se note par bras** :
   - d'elle-même, quand on pose un drop set, un rest-pause ou un cluster sur un exercice unilatéral (le problème de
     Maxence, sans toucher de plus) ; la technique retirée, ce second côté part avec elle s'il n'est pas fait ;
   - quand la même série était notée par bras la dernière fois (« pré-remplir avec la dernière fois ») ;
   - à la demande : ⋯ › Plus d'options › « Noter chaque bras à part » (toutes les séries à faire), et
     « Noter les deux bras ensemble » pour revenir. Le choix n'existe que sur un exercice unilatéral.
3. **Ordre** : série (bras gauche), ses sous-séries, bras droit, ses sous-séries (`setSteps`). Le côté qui suit est
   seul mis en avant. « + drop » ajoute une sous-série de chaque côté ; le × du drop set le retire des deux.
4. **Repos** : aucun entre les deux côtés ni avant un drop ; la courte pause d'un rest-pause (15 s) ou d'un cluster
   (20 s) avant chaque mini-série, de chaque côté ; le repos habituel **seulement après le dernier bloc du second
   côté** (`techPauseAfter`, `restAfterStep`). Dans un superset, l'exercice suivant s'enchaîne à ce moment-là.
5. **Pré-remplissage** : la ligne du bras droit reprend la charge et les reps faites au bras gauche (dans les cases,
   un ✓ suffit quand les deux côtés sont pareils) ; sa charge suit le bras gauche tant qu'on n'y touche pas. Chaque
   drop du bras droit reprend la charge du même drop du bras gauche, et ses reps en gris. « Avant » de chaque ligne :
   ce côté-là la dernière fois. Rien n'est jamais augmenté d'office (règle de Maxence du 17/11).
6. **Volume et total de reps** : les deux côtés, sous-séries comprises (`volumeSets`). C'est du travail soulevé.
7. **Records, 1RM estimé, meilleure série, cible de la prochaine séance, niveau de force, courbe de Progrès** : le
   **meilleur des deux côtés** (`recordSet` : 1RM estimé, puis charge, puis reps), jamais leur somme. Pourquoi pas
   un record par côté : l'historique d'avant n'a qu'une valeur par série, sans côté ; un record « bras droit »
   n'aurait aucune base de comparaison et séparerait la courbe en deux. Le meilleur côté se compare directement aux
   anciennes séances (où chacun notait son meilleur bras ou les deux pareils) et suit la progression réelle de la
   force. Le badge de record se pose sur la ligne du côté qui le fait.
8. **Nombre de séries** : une série notée par bras compte pour une (les deux côtés travaillent les mêmes muscles
   séparément, chacun une fois).

## Ailleurs

- **Historique** : « Drop set série 3, bras gauche : 10 kg × 6 » puis « Série 3, bras droit : 14 kg × 9 · drop set
  10 kg × 5 » (`techLines`, `sideLines`). Historique › Modifier garde le second côté tel quel.
- **Export** : la sauvegarde JSON garde le champ ; le CSV a une ligne « 3 bras droit » et « 3.1 bras droit ».
- **Synchro** : la séance part entière (`sessions.data`). `cleanSideSet` ne touche pas une série sans `side2` :
  l'empreinte des anciennes séances ne change pas.
- **Nettoyage** (`sanitizeData` › `cleanHistoryEntry`) : charge 0 à 1000 kg ou vide, reps entières, 6 sous-séries
  au plus, sous-séries gardées seulement si la série garde sa technique, jamais sur un échauffement.

## Limites connues

- **Ancien appareil** : il voit le premier côté seul (volume du second en moins, comme les sous-séries d'un drop set) ;
  s'il modifie la séance (Historique › Modifier), il perd le second côté.
- **Amis et coach** : la séance publique (`private.session_public`) ne fait pas encore passer `side2` (liste blanche
  côté serveur) ; ils voient le premier côté. Une migration le fera passer.
- **Volume comparé à une séance notée en un bloc** : « +X kg de volume » sur la carte et la tendance du bilan montent
  la première fois (le second bras n'était pas compté avant). C'est juste : il est désormais noté.
- **Côté de départ** : le premier côté s'appelle « Bras gauche ». Qui commence par le droit lit les côtés à l'envers ;
  les chiffres restent justes.
- Apple Watch et Live Activity : la montre voit et valide la série ; le second côté se fait sur l'iPhone. Les
  courtes pauses d'un rest-pause ou d'un cluster du bras droit passent par `openRest` (notification et Live
  Activity habituelles, « Mini-série +1 »).
