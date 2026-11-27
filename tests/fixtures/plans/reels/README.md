# Cas réels : vraies photos et vraies dictées (import d'un programme)

Les chiffres « photo », « photo-tableau » et « dictee » de `node tools/plan-corpus/mesure.mjs` sont des **chiffres de
laboratoire** : la photo est un bruit simulé (`tests/unit/plan-corpus-lib.mjs`, `ocrNoise` et `photoBoxes`), la dictée
un texte écrit à la main. Ce dossier reçoit les cas **réels**, lus par Apple Vision et par la dictée d'iOS sur un
iPhone, pour mesurer le moteur sur ce que l'app reçoit vraiment. Objectif : 10 photos et 10 dictées, fournies par
Maxence une fois la build TestFlight installée.

## Ajouter un cas

Un cas = deux fichiers de même nom, dans `photos/` ou `dictees/` (`NN-slug`, deux chiffres puis un nom court) :

| Fichier | Contenu |
|---|---|
| `NN-slug.txt` | le texte **tel que l'app l'a obtenu** (lu par Vision, ou dicté), sans aucune retouche |
| `NN-slug.json` | la vérité attendue, au format du corpus (`../README.md`, « Format » et « Règles de la vérité attendue ») ; le champ `text` est facultatif (le script lit le `.txt`) |
| `NN-slug.jpg` | facultatif : la photo d'origine, seulement si elle ne montre ni visage, ni nom, ni numéro (le dépôt peut être public) |

`category` vaut `photo-reelle` ou `dictee-reelle` ; `description` dit l'appareil, l'écriture (imprimé, manuscrit),
la lumière ou le bruit autour.

### Récupérer le texte lu sur l'iPhone

1. Dans l'app (build avec Photo, Scanner et Dicter) : Programme › Ajouter un programme › Importer un programme.
2. Photo, Scanner une feuille ou Dicter, comme le ferait un coach. Ne rien corriger sur l'écran « Vérifier l'import ».
3. Toucher **Modifier le texte** : la zone de texte montre exactement le texte que Vision ou la dictée a rendu (en mode
   « Pas à pas », une ligne par réponse).
4. Tout sélectionner, copier, l'envoyer sur l'ordinateur (Notes, AirDrop, mail à soi-même), le coller dans
   `NN-slug.txt` sans le retoucher.
5. Écrire `NN-slug.json` à partir de la feuille ou de ce qui a été dit (pas à partir de ce que l'app a compris).

## Mesurer

```sh
node tools/plan-corpus/reels.mjs            # tableau par dossier (photos, dictées)
node tools/plan-corpus/reels.mjs --erreurs  # détail des lignes fausses
node tools/plan-corpus/reels.mjs --json     # résultat complet
```

Même score par ligne que `mesure.mjs` (`scorePlan` : exercice, prescription, séance, superset ; une ligne inventée
compte comme fausse). Sans aucun cas, le script le dit et sort sans erreur. Quand les 20 cas seront là, reporter les
chiffres dans `docs/IMPORT_PROGRAMME.md` (« Mesure ») à côté des chiffres de laboratoire, et fixer un seuil dans
`tests/unit/plan-import.mjs` à partir de ce qui est mesuré.
