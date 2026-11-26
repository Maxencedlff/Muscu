# Mise en page tablette (iPad)

Depuis la build 156, l'app tourne en format iPad (`TARGETED_DEVICE_FAMILY` 1,2). Avant ce chantier (branche `ipad-app`,
26/11/2026), tous les écrans étaient la colonne de l'iPhone, centrée à 640 points au milieu de l'écran, avec la barre
d'onglets étalée en bas. Le mode coach grand écran (docs/COACH_IPAD.md) est un sujet à part et ne change pas.

**Rien ne change sur iPhone**, même sur l'iPhone Duo ouvert (plus large qu'un iPad mini) : toute la mise en page tablette
est derrière la classe `html.tablet`, posée par `js/ui/tablet.js` d'après le user agent (iPad, iPadOS en mode ordinateur
avec écran tactile, tablette Android), jamais d'après la seule largeur. Les règles sont dans `css/tablet.css`, chargée en
dernier. Aucun changement natif : une mise à jour à chaud suffit.

## Trois largeurs (classes de taille d'iPadOS, Apple HIG « Layout »)

| Largeur de la fenêtre | Exemples | Mise en page |
|---|---|---|
| sous 744 points | Split View à moitié (678), étroit (507), Slide Over | celle de l'iPhone, rien ne change |
| 744 à 899 | iPad mini en portrait (744), iPad 11 pouces en portrait (834) | barre d'onglets en bas, colonne de lecture de 720 |
| 900 à 1099 | iPad 13 pouces en portrait (1024) | barre d'onglets en bas, écrans de survol en deux colonnes |
| 1100 et plus | paysage (iPad mini 1133, 11 pouces 1194, 13 pouces 1366) | barre latérale à gauche, deux colonnes à sa droite |

Les media queries suivent la rotation et le Split View sans script.

## Ce qui change, écran par écran

- **Barre latérale** (paysage) : les cinq onglets en liste, icône et nom en 17 pt, l'onglet actif sur fond gris (comme la
  barre latérale d'iPadOS) ; badge des demandes au bout de la ligne. Le contenu commence à sa droite ; mini-barre de
  séance, toast et bannière de mise à jour se centrent sur le contenu, et le bas des écrans n'attend plus de barre
  d'onglets (`--tabbar-h` à 0).
- **Accueil** : à gauche la séance du jour (Démarrer, « À battre aujourd'hui ») et « Autres séances » ; à droite la
  séance libre, Nutrition, les cartes (sauvegarde, coach), la semaine, les défis.
- **Progrès** : à gauche la carte des muscles et les groupes en 3 mois ; à droite mensurations, exercices et records.
- **Nutrition** : à gauche la journée (frise des 7 jours, anneau des calories, macros), à droite les repas, jamais
  coupés entre deux colonnes, puis l'eau et les réglages.
- **Réglages** : les groupes en deux colonnes, chaque titre avec son groupe.
- **Programme** (page d'un programme) : les séances à gauche, l'envoi du programme à droite.
- **Séance en cours, repos, bilan, fiche exercice, Historique, Bibliothèque, Coach, Social** : une seule colonne de
  720 au plus, centrée. Sur un écran de saisie, le pouce et l'œil n'ont pas à traverser l'écran ; une liste
  chronologique se lit de haut en bas.
- **Feuilles** (`sheet()`) : au milieu de l'écran, coins arrondis partout, comme la feuille de formulaire d'iPadOS.

## Deux colonnes : les choix

- **Colonnes CSS** (`column-count: 2`) plutôt qu'une grille ou des gabarits propres à l'iPad : le HTML et l'ordre de
  lecture (VoiceOver compris) restent ceux de l'iPhone, aucun écran n'est écrit deux fois, et un bloc n'est jamais
  coupé entre deux colonnes (`break-inside: avoid`).
- **Titre de groupe gardé avec son groupe** : WebKit ignore `break-after: avoid` dans des colonnes (« Apparence » restait
  seul en bas de la colonne de gauche des Réglages). `tabletAfterRender` (`js/ui/tablet.js`, appelée par `paint()` du
  routeur) range chaque titre, son groupe et sa note de pied dans un `.tablet-keep`, seulement sur une tablette ; hors
  deux colonnes, `.tablet-keep` est `display: contents`.
- Nutrition : le titre « Repas » ouvre la colonne de droite (`break-before: column`).

## Tests

- `tests/test_ipad.py` : tous les écrans principaux (le même parcours que `tests/test_ecrans_recents.py`, fonction
  `parcours`) sur iPad 13 pouces en portrait et en paysage, iPad mini, Split View 678 et 507, en sombre et en clair,
  dans WebKit et Chromium : contrôles des iPhone récents (défilement horizontal, marges, textes coupés, 44 pt,
  largeur de lecture) et ceux de la tablette (barre latérale ou barre d'onglets selon la largeur, deux colonnes ou
  une seule, aucun titre seul en bas d'une colonne, écrans pleins centrés), puis un iPhone 17 et l'iPhone Duo en grand
  paysage sans aucune règle de la tablette. CI : job coach-web de tests.yml (Chromium et WebKit), `run_all.py ipad`.
- `tests/unit/tablet.mjs` : qui est tablette, feuille chargée en dernier et entièrement derrière `html.tablet`,
  regroupement des titres.
- Profils d'iPad : `tests/fixtures.py` (`IPAD_PROFILES`, `PPL_DEVICES=ipad`).

## Pistes

- Maître-détail (liste à gauche, détail à droite) pour Historique, Bibliothèque et Coach › Élèves : demande un routeur
  à deux volets, pas seulement du CSS.
- Séance en paysage : l'exercice en cours et la liste des exercices côte à côte.
