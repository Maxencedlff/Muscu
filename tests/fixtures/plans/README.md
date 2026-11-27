# Corpus de plans d'entraînement (import de texte libre)

54 programmes de musculation tels qu'un coach ou un pratiquant les colle dans l'appli, chacun accompagné de la vérité attendue. Le corpus sert à mesurer le moteur d'import. Il a été écrit sans lire le code du moteur (`js/data/plan-*.js`).

## Format

Un fichier `NN-slug.json` par plan :

```json
{
  "id": "07-bro-split-5-jours",
  "category": "propre | tableau | libre | dictee",
  "description": "d'où vient le plan, ce qu'il teste",
  "text": "texte brut exact (\n, \t compris)",
  "expected": {
    "title": "nom du programme ou null",
    "sessions": [
      { "label": "en-tête de séance ou null", "exercises": [ { "line": "...", "name": "...", "sets": 4, "repMin": 8, "repMax": 12, "rest": 90 } ] }
    ]
  }
}
```

## Répartition

| Catégorie | Plans | Contenu |
|---|---|---|
| propre | 01-18 | PPL 3 et 6 j, StrongLifts, Madcow, Upper/Lower, Full Body, Bro split, Arnold, PHUL, machines, maison, anglais, partage d'appli, RPE/RIR/tempo, nSuns %, supersets A1/A2, drop/rest-pause, fessiers |
| tableau | 19-30 | tabulations Excel/Sheets, Markdown `\|`, PDF aligné par espaces, colonne « Séries x Reps », en-tête anglais, cellules vides, noms coupés sur deux lignes, colonnes par semaine, colonne Séance |
| libre | 31-44 | WhatsApp, abréviations, fautes, mail en phrases, sans accents, nombres en lettres, emojis, jours de repos, échauffements, séparateurs mélangés, exercices hors bibliothèque, forum |
| dictee | 45-54 | dictée iOS sans ponctuation, homophones, hésitations et auto-correction ; 48, 49 et 50 en mode guidé (une ligne exercice puis une ligne prescription) |

Le corpus compte 794 exercices attendus.

## Règles de la vérité attendue

- Un champ absent veut dire que le texte ne le donne pas pour cet exercice. Le moteur ne doit pas l'inventer.
- `name` reprend exactement un nom de la bibliothèque. Il vaut `null` pour un exercice qui n'y est pas, et `raw` garde alors le nom humain. Les noms ambigus ont été tranchés comme le ferait un coach : « Développé couché » donne Développé couché barre, « Squat » donne Squat barre, « Tractions » donne Tractions pronation, « Tirage vertical » ou « tirage poitrine » donnent Tirage vertical prise large, « poulie basse » donne Tirage horizontal câble, « Mollets » donne Mollets debout.
- `line` est le début de la ligne source, ou du fragment de phrase pour les dictées. C'est toujours une sous-chaîne de `text`.
- Reps fixes : `repMin` = `repMax`. Une pyramide « 12-10-8-6 » donne le min et le max. `amrap: true` pour max, AMRAP ou échec, sans reps. `seconds` pour un exercice en durée.
- `rest` est donné en secondes. Une consigne de repos générale (« repos 1 min 30 sauf indication », « 3 à 5 min sur les mouvements de force ») n'est attachée à aucun exercice. « pas de repos » vaut 0.
- `load` est en kg. Un lest « +10 kg » ou « @+15kg » donne 10 ou 15, « PDC » ne donne rien. `pct`, `rpe` et `rir` sont numériques, la virgule décimale est acceptée (8,5 donne 8.5).
- `tempo` est toujours écrit avec des tirets (« 3010 » donne « 3-0-1-0 », « 30X0 » donne « 3-0-X-0 »).
- `tech` vaut drop, rp, cluster ou topback. `techWhere` vaut last ou all seulement quand le texte le précise. Un drop set sans précision vaut last. Pour un top set + back-off, on ne note ni séries ni reps.
- `ss` porte la même lettre pour les exercices enchaînés (A, puis B, puis C dans la séance). Un tri-set garde une seule lettre.
- Circuit « 4 tours » : chaque poste vaut 4 séries de sa durée, avec le repos entre exercices.
- Tableau avec une colonne par semaine : on retient la semaine 1.
- Dictée avec auto-correction (« 12 euh non pardon 10 ») : c'est la dernière valeur qui compte.
- `optional: true` marque une ligne qu'on accepte lue comme exercice ou ignorée (cardio d'échauffement ou de retour au calme).
- Les échauffements génériques, notes, titres, jours de repos, signatures et formules de politesse ne sont pas des exercices.
- `label` vaut `null` quand le plan n'a pas d'en-tête de séance. Pour les dictées, c'est le nom dit (« push », « bas du corps »). Les labels se comparent sans tenir compte de la casse, des emojis ni de la ponctuation.
