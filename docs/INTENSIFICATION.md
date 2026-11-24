# Techniques d'intensification (V1)

Mise à jour le 24 novembre 2026 (techniques sur n'importe quelle série) ; créé le 5 novembre 2026. Demande de deux coachs partenaires (vocaux du 04/11/2026) : « il fait 12
répétitions à 60 kg, et dès qu'il pose la barre il enchaîne à 46 kg… quand tu notes, il y a une petite ligne
en dessous : drop set, et tu notes que tu en as fait 5 à 46. Ça peut être aussi top set, cluster, rest-pause,
back-off… »

## Fichiers

| Rôle | Fichier |
|------|---------|
| Logique pure : techniques, sous-séries, volume, nettoyage, prescription, textes | `js/data/intensif.js` (chargé avant `store.js`) |
| Écran de la séance : numéro de série touchable, titre et sous-lignes, validation, « Toutes les séries » | `js/features/session-intensif.js` |
| Écran Programme › Exercice : technique et « Sur quelle série » | `js/features/programme-intensif.js` |
| Branchements | `session.js` (lignes, validation, démarrage), `session-sheets.js` (menu ⋯, exercice ajouté), `summary.js` (enregistrement), `add-session.js` (Historique › Modifier), `store.js` (volume, nettoyage), `coach.js` (programme envoyé), `import-csv.js`, `share-stats.js`, `history.js`, `coach-ui.js`, `social-ui.js`, `social.js`, `programme-editor.js` |
| Styles | `css/session.css` (bloc « Techniques d'intensification ») |
| Tests | `tests/unit/intensif.mjs`, `tests/test_intensif.py` |

## Ce que font les autres apps (recherche du 05/11/2026)

- **Hevy** : quatre types de série choisis en touchant le numéro de la série : normale, échauffement (W), drop
  set (D), échec (F). Chaque drop est une série à part marquée D ; le minuteur de repos ne part pas quand la
  série suivante est un drop set. Sources : [aide Hevy, Set Types](https://help.hevyapp.com/hc/en-us/articles/34896293707927-Set-Types-in-Hevy-Explained-Drop-Sets-Warm-Up-Sets-and-More),
  [hevyapp.com, workout set types](https://www.hevyapp.com/features/workout-set-types/).
- **Strong** : lettres W, D, F sur la série (export CSV : `Set Order` = W, D, F). Pas d'aide officielle trouvée ;
  confirmé par des fichiers d'export cités dans docs/IMPORT_CSV.md et un forum Trainerize.
- **Everfit** (coaching) : le coach marque une série Regular, Warmup, Drop Set ou Failure dans le programme.
  Source : [aide Everfit](https://help.everfit.io/en/articles/3060140-create-a-warm-up-drop-or-failure-set).
- **MacroFactor** : Standard, Warm-up, Drop, Myo (rest-pause à la même charge), Failure ; un drop set est **une
  seule série** avec plusieurs couples charge × reps regroupés. Source : [aide MacroFactor](https://help.macrofactorapp.com/en/articles/317-logging-different-types-of-sets).
- **Trainerize** : pas de champ dédié ; les coachs écrivent le schéma dans les notes et demandent un vrai drop set
  avec charge et reps de chaque palier. Source : [demandes de fonctionnalités ABC Trainerize](https://ideas.abcfitness.com/forums/167887-coach-trainer-abc-trainerize/suggestions/45057220-adding-a-dropset-cluster-set-pnf-1-2-rep-reps).
- **Eklo / Ekklo** : aucune information publique sur ces techniques (fiches App Store seulement).

Aucune n'a cluster, top set ni back-off : ce sont pourtant les mots des coachs, on les ajoute.

## Décisions

1. **Cinq techniques** : drop set, rest-pause, cluster (avec sous-séries), top set, back-off (étiquettes).
   Pas d'« échec » : le RIR 0 le note déjà (docs/SEANCE_OUTILS.md). Myo-reps = rest-pause (même geste : même
   charge, pauses courtes), inutile d'en faire une sixième.
2. **Sous-séries rangées dans la série** (`tech` + `sub: [{ weight, reps }]`), comme MacroFactor, plutôt que des
   séries à part comme Hevy. Pourquoi : c'est la « petite ligne en dessous » des coachs ; le nombre de séries,
   les séries par muscle, la numérotation, la cible de la prochaine séance et « Avant » (rangés par rang de
   série) ne bougent pas ; une version précédente de l'app ignore les deux champs et voit la série seule, au
   lieu de prendre un drop de 46 kg pour une vraie série (record « reps à charge égale », pré-remplissage de
   la séance suivante faussés).
3. **Volume** : les sous-séries comptent (`volumeSets`, utilisé par `setsVolume` et `exVolume` : bilan, historique,
   récaps, partage, coach), et leurs reps dans le total de reps (bilan, Progrès au poids du corps). C'est du travail
   réellement soulevé.
4. **Records** : une sous-série ne bat **aucun** record (charge, reps à charge égale, 1RM estimé, meilleure
   série). Elle se fait sans repos ou après 15 à 20 s, sur des muscles déjà fatigués : ce n'est pas un effort
   comparable à une série reposée, et compter « 5 reps à 46 kg » comme record à 46 kg récompenserait le
   drop set plutôt que la progression. La série elle-même reste comparée comme toute série. Mécanique : les
   calculs de records ne parcourent que `ex.sets` ; rien à exclure.
5. **Nombre de séries** : une série avec ses drops compte pour une (comme la littérature qui compte un drop set
   comme une série prolongée, et comme MacroFactor).
6. **Top set et back-off** ne changent aucun calcul : étiquettes seulement (historique, coach). Seule la charge
   pré-remplie d'un back-off est allégée (voir « Programme et coach »).
7. **Mesures** : seulement les exercices en répétitions (`canTech`). Ni maintien ni cardio. Échauffement exclu.
   Machine d'assistance : la sous-ligne reprend la même aide (alléger voudrait dire plus d'aide, à régler soi-même).

## En séance

- **Poser** : toucher le numéro d'une série à faire (ou rouverte) ouvre la feuille des cinq techniques (2 touchers,
  comme Hevy). Un petit point sous le numéro l'indique, discret, en clair comme en sombre. Menu ⋯ : « Technique d'intensification… » seul (choix
  de la série) : c'est le chemin pour une série déjà validée et pour la série en cours d'un exercice à barre, au
  tempo ou en superset, où le numéro laisse la place à Disques, ▶ ou A1. Le guide le dit ainsi. Retirer : × du titre, ou « Retirer la technique » ; « Annuler » dans le toast.
- **Sous-ligne** : remplie comme une série. Charge pré-remplie : drop set 80 % de la série d'avant (ou du drop
  d'avant) arrondi au matériel (`roundLoad`, js/data/plates.js : barre + paires de disques, sinon pas de 2,5 kg
  ou 5 lb), jamais plus lourd ; rest-pause et cluster : la même charge. Tant qu'on n'y touche pas, elle suit la
  charge de la série (`auto`). La dernière fois, même technique sur la série de même rang : ses reps sont l'objectif
  en gris (« Avant » de la sous-ligne), et sa charge est reprise pour un drop seulement si elle est plus légère que
  la charge d'avant (sinon la règle des 80 % : un drop n'est jamais plus lourd). Sans dernière fois : reps à taper.
- **Repos** : après la série, pas de repos avant un drop (comme Hevy) ; 15 s avant une mini-série de rest-pause,
  20 s entre deux blocs de cluster (barre de repos réduite) ; après la dernière sous-série, le repos habituel, ou
  dans un superset l'exercice suivant du tour (« Enchaîne », sans repos, comme après une série). Le minuteur ne
  bouge que si la sous-série suit la dernière série validée : rattraper un drop oublié ou le corriger pendant un
  autre repos le laisse tel quel, et « Annuler » rend le repos d'avant. Pendant la pause, la barre annonce
  « Ensuite : Mini-série 1 · 32 kg × 4 » sans le nom de l'exercice (celui qu'on vient de faire, dit aux lecteurs
  d'écran) : la ligne tient entière sur iPhone SE. Le toast « Série 1 validée · puis rest-pause » et son bouton
  « Annuler la série » (il défait la validation ; la technique se retire par le × de son bloc) se pose au-dessus de la barre, ou en haut de l'écran s'il cacherait « + Série » ou « Plus tard » : il peut
  cacher les séries suivantes, jamais la mini-série à faire, que l'écran centre.
- **Une seule chose en cours** : pendant la pause (ou avant un drop), la sous-série qui suit est seule mise en avant
  (`session-set--subcur`, `aria-current`) ; la série suivante ne l'est qu'une fois la sous-série faite.
- **Sous-série sautée** : seule la sous-série de la série qu'on vient de valider est mise en avant, retient la carte
  dépliée et attire l'écran ; dès qu'une autre série est validée, elle reste à remplir (✓ gris) sans rien retenir.
- Une sous-série se valide après sa série et dans l'ordre ; toucher une sous-série validée la rouvre. « + drop »
  en ajoute une (6 au plus). Rien au pointerdown ; zones de toucher de 44 px ; iOS : un seul toucher. « + mini-série »
  et × sont dessinés en 32 px de haut mais touchables sur 44 (`::after` à −6 px, contigus sans se chevaucher :
  test_intensif.py le vérifie avec elementFromPoint) ; un outil qui mesure la boîte du bouton lit 32.
- **Enregistrement** : seules les sous-séries validées sont gardées ; un drop set sans drop validé perd sa marque.
- **Supersets** : possible (menu ⋯ du membre) ; l'enchaînement du tour prime sur la pause de la technique.
- **Séance fermée puis rouverte** : tout est dans `ppl_active_session` (techniques, sous-séries, `auto`).
- **Apple Watch, Live Activity** : rien de natif ne change. La montre voit et valide les séries ; les sous-séries
  se font sur l'iPhone. Les courtes pauses passent par `openRest` : notification et Live Activity habituelles.

## Programme et coach

- Programme › Exercice › Intensification : **Technique** (drop set, rest-pause, cluster, « 1re série lourde, puis
  allégées »), puis pour les trois premières **Sur quelle série** (voir plus bas). Champ `intens` de l'exercice
  (`INTENS_PLANS`) et, pour une série autre que la dernière, `intensOn` ; nettoyés par `sanitizeData` ; affiché dans la
  liste de la séance (« dernière en drop set », « 1re en cluster », « séries 1 et 3 en drop set » : `intensText`).
- Posé au démarrage de la séance (`applyIntensPlan(ex, intens, intensOn)`) et sur un exercice du programme ajouté en
  cours de séance.
- Coach : `programmeToSent` envoie les deux champs, `cleanSentProgramme` les valide, `COACH_FIELDS` les remplace à
  l'import : l'élève les voit en séance. L'écran « Charge et reps » du coach nomme la technique sous sa série
  (« Série 1 · Cluster » : `prescSetTag`, `intensPlanTechs`). Une version précédente de l'app de l'élève ignore la
  technique, ou seulement `intensOn` (voir « Sur quelle série », « Données et compatibilité »).
- **Back-off allégé** (panel du 16/11 : les back-off étaient pré-remplis à la charge du top set) : au démarrage,
  une série de back-off à faire prend **la charge du top set − 10 %, arrondie à ce qui se charge** (barre et
  disques, sinon pas de 2,5 kg ou 5 lb : `roundLoad`), par `backoffPrefill` (js/data/intensif.js). Exemples :
  top set 80 kg à la barre → 72,5 kg ; haltères 30 kg → 27,5 kg. Une série de back-off déjà plus légère (celle
  de la dernière fois) garde sa charge ; une charge prescrite par le coach passe avant tout
  (docs/COACH_V1.md, « Charge prescrite »). Pourquoi 10 % : le bas de l'allègement courant d'un back-off (5 à
  15 % selon les coachs), assez pour que la case dise « allégée » sans décider à la place du pratiquant ; une case
  vide aurait laissé un ✓ rapide noter 0 kg. Changer de charge au top set ne la recopie plus sur le back-off.
- **Étiquettes top set et back-off** (panel du 16/11 : une ligne entière entre deux séries, avec un × rond, ne
  disait ni à quelle série elle se rapportait, ni ce que faisait le ×) : petite pastille grise **dans la ligne de
  sa série**, sous « Avant » (`techPillHtml`). Plus de ×. Retirer ou changer la technique : le numéro de la série
  ou ⋯ › Technique d'intensification, « Retirer la technique ». Programme d'un coach (technique prescrite par
  `intens`) : ni ×, ni « Retirer la technique » (`techPrescribed`), l'élève ne retire pas ce que son coach a
  prescrit ; le drop set, le rest-pause et le cluster gardent leur bloc de sous-séries, sans × non plus.

## Sur quelle série

Retour d'un coach partenaire (vocal du 24/11/2026) : « t'avais mis un moment où tu peux choisir la dernière série en
cluster, mais moi j'aimerais bien la choisir en première série, il n'y avait pas cette possibilité. » Les techniques à
sous-séries (drop set, rest-pause, cluster) se posent maintenant sur n'importe quelle série, ou plusieurs.

- **Programme et coach** : cellule « Sur quelle série » sous « Technique », feuille « Dernière (par défaut) · Première ·
  Toutes · Série 2 … Série n−1 · Plusieurs séries… » (cette dernière à partir de 3 séries). « Plusieurs séries » ouvre
  des cases à cocher dans la même rubrique, une par série, comme « Répéter » d'une alarme iOS (jamais aucune cochée).
  Changer de technique garde les séries choisies ; baisser le nombre de séries retire les numéros de trop (rien de
  coché qui reste : la dernière). Top set et back-off restent « 1re lourde, puis allégées », sans choix de série.
- **En séance** : le numéro d'une série (2 touchers) ou ⋯ › Plus d'options › Technique d'intensification › « Sur quelle
  série ? » posaient déjà une technique sur n'importe quelle série ; la feuille finit par **« Toutes les séries »**
  (drop set, rest-pause ou cluster sur chaque série de travail, validées comprises : leurs sous-séries restent à remplir
  sans rien retenir ; « Retirer les techniques » ; un seul « Annuler »).
- **Ce qui ne change pas** : toutes les règles plus haut sont par série, pas « dernière série » : volume (sous-séries
  comprises), records et 1RM (jamais une sous-série), nombre de séries, repos (pas de repos avant un drop, 15 ou 20 s
  avant une mini-série ou un bloc, puis le repos habituel avant la série suivante), drop set d'un exercice à un bras
  (bras gauche, son drop, bras droit, son drop, puis le repos), montre (la série se valide, la sous-série s'annonce),
  récap, historique (« Drop set série 1 : … ») et CSV (« 1.1 »). Tests : `tests/unit/intensif.mjs` (séries choisies),
  `tests/test_intensif.py` (`t_programme_series`, `t_seance_series`, `t_un_bras_series`).

### Données et compatibilité

- `intens` garde **une clé d'avant** : `X-last` pour une ou plusieurs séries choisies, `X-all` pour toutes.
  `intensOn: { plan, sets }` ne s'ajoute que pour d'autres séries que la seule dernière : `plan` répète la clé
  (`cluster-last`), `sets` les numéros de série de travail (1 = la première, échauffements à part), triés, de 1 au
  nombre de séries de l'exercice. Forme la plus simple à l'enregistrement (`intensFieldsFor`) : la seule dernière ou
  toutes cochées redeviennent les clés d'avant, sans `intensOn`.
- **Aucune migration à faire** : un programme existant (`drop-last`…) n'a pas `intensOn` et garde exactement la
  dernière série. `sanitizeData` sert de migration douce : il retire un `intensOn` qui ne vaut plus rien (autre clé,
  numéros hors des séries) et ne touche à rien d'autre.
- **Version précédente de l'app** (même compte, ou élève) : elle comprend la clé, pose donc la technique sur la
  dernière série, et garde `intensOn` sans le lire (son `sanitizeData` ne retire que les champs qu'il connaît ;
  Programme › Exercice modifie l'exercice en place). Si elle change de technique, `plan` ne correspond plus : le
  champ est ignoré puis retiré ici, au lieu de poser la nouvelle technique sur les anciennes séries. Synchro : le
  programme part entier dans `profiles.doc` (`SYNC_UNION_KEYS`, fusion par programme) ; rien n'est effacé.
- Élève sur une version précédente : son import (`cleanSentProgramme`) ne garde pas `intensOn`, il voit la technique
  sur la dernière série jusqu'à sa mise à jour.

## Ailleurs

- **Historique** (détail), **relecture du coach**, **séance d'un ami** : lignes « Drop set série 4 : 55 kg × 6 · 45 kg × 5 »
  et « Top set série 1 · Back-off séries 2, 3 » (`techLines` ; « S4 » écrit en toutes lettres depuis le 20/11, règle 11 de
  la grille avant panel). Historique › Modifier garde les techniques telles quelles.
- **Image partagée** : le détail des séries se termine par « , drop set 55 kg × 6 » (deux techniques au plus).
- **Import Hevy / Strong** : une série `dropset` (Hevy) ou `D` (Strong) devient une sous-série du drop set de la
  série de travail qui la précède ; sans série avant (ou en durée, cardio), une série ordinaire.
- **Feuilles d'actions** (`css/components.css`) : le menu ⋯ a deux choix de plus ; une feuille plus haute que
  l'écran (exercice d'un superset sur iPhone SE) fait maintenant défiler ses choix, Annuler reste en bas.
- **Export** : il n'y a pas d'export CSV dans l'app ; la sauvegarde JSON garde les champs.
- **Synchro** : la séance part entière (`sessions.data`) ; les anciennes séances n'ont pas les champs et
  `cleanTechSet` ne touche pas une série qui ne les a pas : leur empreinte ne change pas.

## Limites connues

- **Serveur** : la migration `supabase/migrations/20261106100000_seance_publique_intensif_prise.sql` (pas encore
  appliquée en production, ordre dans supabase/rollback/ORDRE.md) fait passer `tech` et `sub` par série et `grip`
  (prise, js/data/grips.js) par exercice dans `private.session_public`, donc chez un ami (fil, Mon profil) et
  chez le coach (`session_for_coach`). Listes blanches et bornes : techniques connues, jamais sur un
  échauffement ; 6 sous-séries au plus, reps entières de 1 à 4000, charge de 0 à 1000 kg (3 décimales) ou
  vide ; prise aux valeurs fixes de `js/data/grips.js`. Le reste n'est jamais transmis ; une séance sans ces
  champs sort comme avant. Test : `tests/sql/intensif_prise_test.sql` ; retour arrière :
  `supabase/rollback/20261106100000_seance_publique_intensif_prise_down.sql`. Tant qu'elle n'est pas appliquée,
  le coach voit la série, pas le drop. Le programme envoyé, lui, passe déjà (JSON libre côté serveur).
- **Prise reçue** : `cleanPublicSession` la garde nettoyée (`cleanGrip`, js/data/grips.js) et la séance d'un ami
  ou d'un élève l'affiche (« Prise neutre », `reviewGripHtml`), comme l'historique.
- Une version précédente de l'app qui modifie la séance (Historique › Modifier) perd les sous-séries.
- La montre ne montre pas les sous-lignes.
- Lien de partage d'un programme (`prog-share.js`) : ne porte pas la technique, comme la fourchette de reps.
- Une version précédente de l'app (élève compris) pose une technique choisie sur la 1re série sur la dernière (voir
  « Sur quelle série »).
