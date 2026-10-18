# MDLF Training

Application web progressive (PWA) de suivi de musculation, pensée pour l'iPhone et Android :
programme Push / Pull / Legs intégré ou programmes perso, séance en direct avec chrono de repos,
records et 1RM estimé, progrès en courbes, historique, import et export JSON.

- JavaScript sans framework ni étape de build : `index.html` charge des scripts classiques dans un
  ordre fixe.
- Tout reste sur l'appareil, dans le `localStorage` (`ppl_v2` pour la donnée, `ppl_active_session`
  pour la séance en cours, `ppl_theme`, `ppl_v2_backup` pour la sauvegarde avant migration).
- Fonctionne hors ligne grâce au service worker (`sw.js`).

## Lancer en local

Un simple serveur de fichiers statiques suffit :

```sh
python3 -m http.server 8731
```

puis ouvrir <http://localhost:8731/>. Le service worker met les fichiers en cache : après une
modification, recharger deux fois ou cocher « Disable cache » dans les outils de développement.

## Tests

### Tests unitaires (Node)

```sh
node tests/unit/run.mjs
```

Ils couvrent la logique pure sans navigateur : formats français (charges en kg et lbs, virgule,
durées, dates), `calc1RM`, `sanitizeData` / `normalizeData` (migrations, idempotence), `loadData`,
import d'un fichier invalide ou d'un ancien format, validation des saisies (`num`, `weightOk`) et
programmes perso (`userProgrammes`). Les scripts de `js/core/` et `js/data/` sont chargés dans un
contexte `vm` avec un `window`, un `document` et un `localStorage` réduits au minimum. Node 18 ou
plus, aucune dépendance.

### Tests de non-régression (Playwright, Python)

Prérequis : `pip install playwright` puis `python3 -m playwright install chromium webkit`, et le
serveur local ci-dessus lancé sur le port 8731.

```sh
cd tests
python3 run_all.py            # tous les lots, 5 appareils × thèmes clair et sombre
python3 run_all.py 3 4        # seulement les lots 3 et 4
PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_lot1.py   # un lot sur un appareil
```

Variables utiles : `PPL_JOBS` (processus simultanés, 6 par défaut), `PPL_URL` (adresse de l'app),
`PPL_SCRATCH` (dossier des captures), `PPL_DEVICES` et `PPL_THEMES` (ex. `"iPhone 13,Pixel 7"`,
`dark`). Un nom de lot ou d'appareil inconnu est refusé. Un processus en échec est relancé une
fois : s'il passe, il est signalé « INSTABLE » (à surveiller) sans faire échouer la suite.

## Déploiement

Chaque push lance le workflow **Tests** (`.github/workflows/tests.yml`) : tests unitaires, puis
toute la suite Playwright sur iPhone 13 (WebKit) et Pixel 7 (Chromium) en sombre. Sur `main`, et
seulement si tout est vert, le job `deploy` publie en production sur https://muscu-eta.vercel.app
(CLI Vercel figée, secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_WEB_PROJECT_ID`). Vercel ne
publie plus seul (`vercel.json` : `git.deploymentEnabled: false`) : un push rouge ne part jamais en
ligne. Compter 6 à 8 min entre le push et la mise en ligne. TestFlight (`ios.yml`) refuse aussi un
commit dont les tests ne sont pas verts. `.vercelignore` exclut tests, natif, scripts et toute la
documentation (`*.md`, `docs/`).

Avant de publier une version :

1. incrémenter `CACHE` dans `sw.js` (`ppl-v26` → `ppl-v27`…) ;
2. ajouter tout nouveau fichier chargé par la page à `ASSETS` dans `sw.js` (le contrôle statique du
   lot 2 le vérifie) ;
3. lancer les tests unitaires et la suite Playwright.

Les utilisateurs voient alors la bannière « Nouvelle version disponible », jamais pendant une
séance.

## Structure

```
index.html     coquille, sprite d'icônes, ordre de chargement
sw.js          service worker (cache d'abord)
manifest.json  manifeste PWA
css/           styles, dans l'ordre de la cascade
js/core/       utilitaires et formats, dialogues, haptique et sons
js/data/       programmes, stockage et migrations, accès, séance en cours, import / export
js/ui/         thème, navigation, barres, feuilles, gestes
js/features/   un fichier par écran ou fonctionnalité
js/app/        registre des actions, mises à jour, démarrage
tests/         tests Playwright (Python) et tests unitaires (tests/unit/)
scripts/       construction de l'app iOS, images de la marque (brand-icons.py, seule source des icônes)
```

Le rôle de chaque fichier, l'ordre de chargement, le flux d'une action et le modèle de données
sont décrits dans [ARCHITECTURE.md](ARCHITECTURE.md).

## App iPhone

L'app de l'App Store est la même base de code dans une coquille Capacitor : organisation,
fonctions natives, compilation sur GitHub et publication sont décrites dans [IOS.md](IOS.md).
