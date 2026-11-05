# Prise d'un exercice et ordre de la séance

Demandes des coachs partenaires (vocaux des 03 et 05/11/2026) :

1. « J'ai mis un tirage vertical prise serrée, mais il y a plusieurs types de prise serrée : avec deux
   sangles, serrée neutre, supination, pronation… une petite option où on peut voir le type de prise,
   pour le coaché ou pour soi-même. »
2. « Une machine est prise, je fais une autre machine avant… le programme quand tu le lances, tu ne
   peux pas le sauter. »

Code : `js/data/grips.js`, `js/features/grip-ui.js` (prise) ; `js/data/session-order.js`,
`js/features/session-order-ui.js` (ordre). Tests : `tests/unit/grips.mjs`, `tests/test_prise_ordre.py`.

## 1. La prise

### Ce qu'on règle : trois choses, pas une liste de noms

Les bibliothèques consultées décrivent toutes une prise par les mêmes trois axes :

- **sens des mains** : pronation (paumes vers l'avant ou vers le bas), supination (paumes vers soi),
  neutre (paumes face à face) ; au soulevé de terre, mixte et crochet ;
- **largeur** : serrée, moyenne (largeur des épaules), large ;
- **poignée** (accessoire du câble) : barre droite, barre EZ, triangle (poignée en V), deux poignées,
  corde, barre en V (triceps).

Sources : StrengthLog (« Lat Pulldown Types » : prise large, serrée, neutre serrée, supination, un
bras ; le tirage « standard » de leur appli est en pronation), Fitness Volt et Powerlifting Technique
(« close grip » désigne selon les sources une prise serrée en pronation ou le triangle neutre : c'est
exactement l'ambiguïté soulevée par le coach), Catalyst Athletics (tirage « with any grip width, a
neutral grip, with rope handles […], with a supinated grip, with one arm »). ExRx décline aussi ses
fiches de tirage, rowing et curl par prise et par accessoire, mais son site a refusé la lecture
automatique le 05/11/2026 : non relu ce jour. Hevy (blog « 21 pull-up variations ») range les
variantes comme des exercices de sa bibliothèque ; pour Strong, rien de vérifiable trouvé. Everfit
(blog, mars 2024) laisse le coach écrire une note ou proposer une alternative par exercice. Aucune
source ne montre un réglage court par axe : c'est ce qui manque au coach qui veut dire « serrée,
neutre, deux poignées » sans créer trois exercices.

« Avec deux sangles » est compris comme **deux poignées séparées** (poignées D ou poignées en sangle
accrochées au câble), à la place du triangle. Les sangles de tirage (aide au grip) ne sont pas une
prise : elles vont dans la consigne du coach.

### Où la prise est proposée

Seulement pour les mouvements où elle change l'exercice (`GRIP_FAMILIES`) : tirage vertical,
tractions, tirage horizontal, rowings, développés, extension triceps à la poulie, curls, soulevé de
terre. Jamais pour un maintien ni du cardio. Et seulement pour **ce que le nom ne dit pas déjà** :

| Exercice | Proposé |
|---|---|
| Tirage vertical prise serrée | sens des mains, poignée (la largeur est dans le nom) |
| Tirage vertical prise large | sens des mains, poignée |
| Tractions pronation | largeur |
| Tirage horizontal câble | sens des mains, largeur, poignée |
| Rowing haltère unilatéral | sens des mains (un bras : pas de largeur) |
| Développé couché barre | largeur (à la barre, les mains sont en pronation) |
| Développé couché haltères | sens des mains (pronation ou neutre) |
| Curl biceps barre | sens des mains (supination, pronation), largeur, barre droite ou EZ |
| Curl poulie | sens des mains, poignée |
| Soulevé de terre | pronation, mixte, crochet |
| Curl marteau, curl inversé, face pull, rowing menton, squat… | rien |

Un nom inconnu (exercice créé par la personne) est reconnu par les mêmes mots que les muscles
(`ruleKey`).

### Où on la voit

- Programme › Exercice : rubrique **Prise**, une rangée de pastilles par axe (44 px de haut). Un
  second toucher sur la pastille choisie la retire. Appliquée par OK, comme le reste de la fiche.
- Programme › Séance : « Prise serrée neutre · Deux poignées » sous le nom.
- Séance : la même phrase dans une pastille sous le nom, touchable pour la changer (feuille
  **Prise**, aussi dans ··· › Prise). Un changement en séance va aussi dans le programme : la
  prochaine fois, la même prise. Dans un superset, une ligne par exercice, avec sa lettre.
- Historique › Séance : la prise faite ce jour-là sous le nom.
- Coach : la prise part avec le programme envoyé (`cleanSentProgramme`, `programmeToSent`,
  `COACH_FIELDS` de `importCoachProgramme`), se voit dans l'aperçu « Mon coach » et dans l'écran
  Envoyer. Un nouvel envoi sans prise la retire chez l'élève (champ décidé par le coach, comme le tempo).

### Records et « Avant » : même exercice

**Décision : la prise ne sépare pas l'historique.** Records, colonne Avant, courbe de Progrès et
« À battre » restent ceux de l'exercice, quelle que soit la prise.

Pourquoi :

- Le coach parle d'une indication (« voir le type de prise »), pas d'un nouvel exercice. La prise
  d'un exercice change surtout d'une période à l'autre du programme ; couper l'historique à chaque
  changement ferait perdre la colonne Avant et la progression d'un coup.
- L'écart de charge entre deux prises d'un même tirage est faible (quelques kilos) ; entre deux
  exercices différents (tirage contre rowing), il ne l'est pas : c'est là que la séparation compte,
  et elle existe déjà (identifiant par exercice).
- Séparer demanderait de changer la clé des records (`exId`), la synchro, les records notés dans les
  séances déjà partagées et les écrans du coach : risque élevé pour un gain faible.
- Qui veut un suivi à part pour une variante crée un exercice à son nom (« Tirage vertical
  supination ») : la feuille d'ajout propose toujours « Créer » pour cela.

Pour ne pas comparer sans le savoir, la séance rappelle la prise de la dernière fois quand elle était
différente : « Avant : prise en pronation » sous la pastille. La prise faite est gardée dans
l'historique (`grip` de l'exercice de la séance enregistrée), ce qui permettra plus tard de filtrer
records ou courbes par prise sans rien perdre.

### Données

- Programme : `exercises[cat][i].grip = { hand?, width?, tool? }`, facultatif, nettoyé par
  `sanitizeData` (valeurs connues seulement, retiré s'il n'en reste aucune). Champ additif : une
  version précédente l'ignore et la synchro le transporte avec le reste du programme.
- Séance en cours : `activeSession.exercises[i].grip` copié du programme au démarrage ; `null` quand
  la prise est retirée en séance.
- Historique : `history[].exercises[].grip`, nettoyé par `cleanHistoryEntry`.
- Le texte affiché (`gripText`) n'est fait que de libellés fixes : aucune valeur reçue n'entre dans
  le HTML.

### Photos des prises (plus tard)

Les coachs fourniront des photos. L'emplacement est prêt : `GRIP_PHOTOS` dans `js/data/grips.js`
(`'pulldown/hand-neutre': 'img/prises/tirage-neutre.webp'`, par famille et par réglage, la poignée
d'abord). `gripPhoto` renvoie la première trouvée et la pastille de la séance l'affiche à gauche
(44 × 44 px). Tant que la table est vide, rien n'est affiché, pas même un cadre vide. Penser à lister
les images dans `ASSETS` de `sw.js`.

## 2. L'ordre des exercices en séance

On pouvait déjà valider n'importe quelle série et monter ou descendre un exercice par ···, mais
personne ne le trouvait. Désormais, en un toucher, en bas de chaque carte, à droite de « + Série » :

- sur l'exercice en cours : **Plus tard**, qui le met en dernier ; l'exercice suivant devient celui
  en cours ;
- sur un autre exercice qui reste à faire : **Faire maintenant**, qui le passe juste avant
  l'exercice en cours et en fait la série en cours.

Les deux sont aussi en tête du menu ··· (« Faire plus tard », « Faire maintenant »), à côté de
Monter et Descendre. Un toast propose **Annuler** pendant 4 secondes.

Le menu ··· d'un exercice est devenu plus haut que l'écran d'un iPhone SE : il était coupé en haut
(titre, Faire maintenant et Monter introuvables). Les menus de ce type défilent désormais, Annuler
restant en bas (`css/components.css`, toutes les feuilles d'actions de l'app).

Règles :

- Un **bloc** se déplace toujours en entier : un exercice seul, ou tout son superset. Un superset n'a
  qu'un bouton, celui de la carte ; le menu d'un membre déplace tout le groupe.
- Rien sur un exercice fini, ni « Plus tard » quand il ne reste rien d'autre à faire.
- La série en cours suit (`lastEi` : l'exercice lui-même, ou le dernier membre d'un superset pour
  que le tour reparte du premier qui a une série à faire). Les positions gardées ailleurs suivent
  leur exercice : chrono en cours, série rouverte, sélecteur RIR (`remapSessionOrder`). Les séries
  déjà validées restent où elles sont.
- La séance est enregistrée tout de suite (`persistSession`) : l'ordre survit à la fermeture de l'app,
  et la montre suit.
- Le programme ne change pas : c'est l'ordre de cette séance. Pour changer l'ordre du programme :
  Programme › Séance › Modifier (poignée ≡).

**Pas de glisser pour réordonner en séance.** Les séries se balaient déjà de côté pour « Supprimer »
(`js/features/session-gestures.js`) et la page défile verticalement ; un appui long ou une poignée
sur des cartes hautes de plusieurs écrans se gère mal au pouce, en salle, avec une main. Deux boutons
d'un toucher couvrent le besoin du coach (« je fais une autre machine avant ») sans risque de geste
raté.

## Limites et suite

- Le coach ne voit pas encore la prise dans les séances de son élève : la liste blanche du serveur
  (`private.session_for_coach`) ne transmet pas ce champ. À ajouter côté Supabase avec un test
  (`docs/COACH_V1.md`), sans changement de l'app (`cleanPublicSession` le laisserait à ajouter aussi).
- Le partage de programme par message (`js/data/prog-share.js`) ne transporte pas la prise.
- Records et courbes filtrés par prise : possibles plus tard grâce à `grip` dans l'historique.
- Photos des prises : en attente des coachs.
