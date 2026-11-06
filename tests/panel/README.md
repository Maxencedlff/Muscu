# Captures des parcours (panel d'ergonomie)

`capture_parcours.py` parcourt toute l'app comme de vrais utilisateurs (pratiquants et coachs) et produit
un dossier de captures commentées. Le panel (agents ou humains) lit ce dossier au lieu de relancer chacun
un navigateur.

```sh
python3 -m http.server 8768 --bind 127.0.0.1 &          # à la racine du dépôt (ou du worktree)
PPL_URL=http://localhost:8768/ flock /tmp/ppl-e2e.lock python3 tests/panel/capture_parcours.py <sortie> [--rapide]
```

| Option | Effet |
|---|---|
| (aucune) | complet : iPhone 13 et iPhone SE en clair et en sombre, puis Pixel 7 sombre |
| `--rapide` | iPhone 13 sombre + iPhone SE clair |
| `--parcours seance,coach` | seulement ces parcours (`python3 tests/panel/parcours.py` les liste) |
| `--sans-axe` | sans l'audit d'accessibilité axe-core (fait sur le premier appareil seulement) |
| `--debug` | pile complète quand une étape échoue |

Un seul navigateur à la fois (WebKit pour les iPhone, puis Chromium pour le Pixel). App iOS et Supabase
simulés par `tests/fake_account.py` : aucune requête ne sort du poste (tout ce qui n'est pas l'adresse
locale est coupé). Horloge de l'app figée au mercredi 4 novembre 2026, 18 h 30 (Paris) ; données :
6 mois d'entraînement réalistes (`tests/donnees_realistes.py`).

## Ce qui sort

- `NN-<parcours>-<étape>-<appareil>-<thème>.png` : une capture par étape. `NN` est le même numéro pour la
  même étape sur tous les appareils (comparer d'un coup d'œil).
- `index.md` : une ligne par étape et par appareil : touchers faits (et combien), écran (route de l'app,
  feuille ou dialogue ouverts), erreurs JS de la page, problèmes automatiques, lien de la capture.
- `resume.md` : touchers des tâches clés, touchers par parcours, étapes absentes ou en erreur, problèmes
  automatiques regroupés par écran, erreurs JS.
- `etapes.json` : les mêmes données, pour un script.

Touchers : chaque geste de l'utilisateur dans l'étape (un champ touché puis tapé compte 1, un choix dans
une liste aussi). Le défilement est noté sans être compté. Ce que le parcours met en place sans passer par
l'écran (connexion, données du faux serveur) est noté « préparé » et n'est jamais compté.

Problèmes automatiques : `ux.js` de verif-ui (`/mnt/c/Users/maxde/verif-ui`, ou `$VERIF_UI`) s'il est
importable (zones de toucher sous 44 px, textes coupés « … », icônes peu contrastées mesurées sur la capture,
axe-core sur le premier appareil), plus `controles.js` : police sous 12 px (hors libellés de la barre
d'onglets, 10 pt comme iOS), débordement horizontal, élément fixe (barre de saisie, bouton collé en bas)
recouvert par la barre d'onglets, fin d'écran qui reste sous la barre même tout en bas, texte plus large
que sa boîte. Les textes réservés à VoiceOver (`.visually-hidden`) sont masqués le temps des contrôles.
Sans verif-ui, `controles.js` fait aussi les zones de toucher.

## Ajouter un parcours ou une étape

Dans `parcours.py` : une fonction décorée par `@parcours(nom, titre, rôle)`, des blocs `with r.etape(...)`.
Le docstring de la fonction est le texte d'introduction lu par le panel. Exemple en tête du fichier.

- Un élément introuvable (écran pas encore livré sur la branche, bouton renommé) : l'étape est notée
  « ∅ absent » avec la raison, capturée quand même, et le parcours continue. Pour un menu, utiliser
  `choisir_ou_absent` (le menu est refermé avant de passer à la suite).
- `cle='…'` sur des étapes : resume.md additionne leurs touchers sous ce nom de tâche (ex. « Démarrer la
  séance du jour »).
- Chaque parcours repart d'un contexte neuf : `r.lancer(REALISTE)` remplit le stockage, `r.connecter()`
  connecte un compte, `r.raccourci(js, 'quoi')` prépare le faux serveur (`__sb`, voir fake_account.py).

## Limites

- Navigateur, pas un iPhone : pas de clavier à l'écran, pas de Face ID, pas de vraie feuille de partage
  iOS, pas de Dynamic Type ; le coffre à photos s'affiche dans son état « indisponible ».
- Les touchers comptés sont ceux du chemin choisi par le parcours, pas forcément le plus court possible.
- Les contrôles automatiques ont des faux positifs (élément volontairement tronqué, zone de toucher
  élargie par un pseudo-élément) : à confirmer sur la capture.
- Hors ligne : réseau du navigateur coupé et faux serveur en échec ; l'app ne charge plus de nouvelle ressource.
