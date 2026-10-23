# Architecture de MDLF Training

PWA de musculation en JavaScript sans build : `index.html` charge les feuilles de style puis des
scripts classiques, dans un ordre fixe. Pas de framework, pas de bundler, pas de dépendance.

## Principe de chargement

Les scripts de `js/` sont des **scripts classiques** qui partagent la portée globale : une
fonction ou une variable `let`/`const` déclarée au niveau supérieur d'un fichier est visible des
autres fichiers. C'est voulu pour cette étape (découpage sans changement de comportement) ; le
passage aux modules ES est prévu ensuite (voir la fin du document).

Conséquences à respecter :

- **L'ordre de `index.html` compte.** Le code exécuté au chargement (initialiseurs comme
  `let addCat = firstSession()`, `data = loadData()`, `applyTheme(...)`) ne peut appeler que des
  fonctions et lire que des variables déjà définies par un fichier chargé **avant**. Le code appelé
  plus tard (rendu, écouteurs, actions) peut tout utiliser.
- Les écouteurs globaux (`document.addEventListener`) sont posés au chargement, dans l'ordre des
  fichiers. L'ordre d'origine a été conservé (par exemple le brouillon de la séance passée est
  enregistré avant la saisie en direct d'`init.js`).
- Deux fichiers ne doivent jamais déclarer le même nom au niveau supérieur (erreur de syntaxe au
  chargement du second).
- Les tests Playwright lisent des globales de la page (`data`, `view`, `render()`,
  `activateProgramme()`, `handleAction()`…) : elles doivent rester accessibles.
- Chaque fichier commence par `'use strict';`.

## Arborescence

```
index.html            coquille, sprite d'icônes, ordre de chargement des CSS et des scripts
sw.js                 service worker : cache d'abord, une version = un cache complet (ASSETS)
manifest.json         manifeste PWA
css/                  styles (ordre de cascade fixé par index.html)
js/core/              briques sans écran : utilitaires, dialogues, haptique et sons
js/data/              donnée : programmes, stockage, accès, séance en cours, sauvegardes
js/app/actions.js     registre des actions (chargé avant les écrans qui s'y inscrivent)
js/ui/                infrastructure d'écran : thème, navigation, barres, feuilles, gestes
js/features/          un fichier (ou plusieurs) par écran ou fonctionnalité
js/app/               mises à jour du service worker, démarrage et écouteurs globaux
tests/                tests de non-régression Playwright (Python) et tests unitaires (tests/unit/)
scripts/              construction de l'app iOS (build-web.mjs), mises à jour à chaud, images de la marque (brand-icons.py)
```

### css/

| Fichier | Rôle |
|---|---|
| `base.css` | Tous les tokens (seul endroit avec des couleurs en dur, y compris ceux de la navigation), reset, typographie, boutons, contrôles iOS réutilisables (segmenté, interrupteur, stepper, pastilles), chacun défini une seule fois |
| `training.css` | Barre de progression, styles de base de la séance et du repos |
| `views.css` | Séance passée (saisie), état vide de l'accueil, bouton d'ajout d'exercice et notes, toast |
| `components.css` | Badges, bandeau de séance, dialogues iOS, saisie invalide, bannière de mise à jour, écran de secours |
| `navigation.css` | Barre de navigation (avec ses plafonds Dynamic Type), tab bar, mini-barre de séance, accueil, feuilles modales, transitions, geste de retour |
| `session.css` | Séance active, repos, bilan |
| `muscles.css` | Silhouette musculaire, pastilles de muscles, carte « Muscles » de Progrès, écran Séries par muscle, feuille « Muscles ciblés » |
| `share.css` | Partage de séance : bouton « Partager ma séance », aperçu de l'image au format 9:16 |
| `screens.css` | Écrans à fond groupé (`.view--grouped` : Programme, Progrès, Historique, Réglages) et leur composant de liste groupée (`.group` / `.cell`, seul composant de liste), vignettes « Icône de l'app » (`.app-icons`), accessibilité, paysage, Dynamic Type |

Un renommage de classe touche CSS, gabarits HTML et tests ensemble.

### js/core/

| Fichier | Rôle |
|---|---|
| `util.js` | `uid`, `$`, `esc` (échappement HTML), `localISO`, formats français : nombres (`fmtNum`), durées (`fmtClock`, `fmtRest`, `fmtDuration`), dates (`fmtDate(ts, style)`, `fmtTime`), `icon`, `clone`, `num` (saisie bornée), `normName`, `sameEx`, `plural` |
| `dialogs.js` | Annonces VoiceOver (`announce`), `showToast`, `dialog` (alerte et feuille d'actions iOS), gestion du modal (inert + retour du focus), `confirmSheet`, `askNumber`, `askText` |
| `haptics-audio.js` | `haptic`, bips et sons (`beep`, `timerDone`, `validationSound`, `finishSound`, `recordSound`), déverrouillage de l'audio au premier geste |

### js/data/

| Fichier | Rôle |
|---|---|
| `programmes.js` | `PROGRAMMES` (programmes intégrés et exercices par défaut), `exerciseLibrary()` |
| `store.js` | `makeExercise`, `calc1RM`, `setsVolume`, `sessionVolume`, `recomputePRFromHistory`, `lastPerf`, `resolveExId`, `makeDefaultData` (base des migrations), `freshData` (donnée vide au schéma courant : suppression, démarrage à neuf), `sanitizeData` (clés de séance limitées à `SESSION_CAT_RE`, champs d’exercice et séries bornés comme à la saisie), `normalizeData` (migrations), `loadData`, `save`, `latestSessionDate`, `syncTimersFromHistory`, `releaseTimer` ; **charge `data` au chargement** (ou passe en mode secours) |
| `records.js` | Records : `recordLabel` (badge d'une série), `exerciseRecord` (record marquant d'un exercice), `historyBaseline` (records d'avant une séance de l'historique), `recordKey` |
| `accessors.js` | `prog`, `getCooldown`, `isUserProg`, `userSessions`, `progMeta`, `sessionKeys`, `sessionMeta`, `rawLabel`, `catBadge`, `firstSession`, régularité, unités (`toUnitW`, `fmtW`, `storeW`, `fmtVolume`), `bestSet`, `setTxt` |
| `active-session.js` | `activeSession`, `sessionNotes`, `writeSession(rest)` (écrit la séance et l'état du repos reçu), `restoreSession()` (renvoie `{ rest }` sans relancer le chrono), `computeBaseline`, `sessProg` |
| `measures.js` | `MEASURES` (répétitions, durée `time` en secondes dans `reps`, `cardio` : minutes dans `reps`, km dans `dist`), `measureOf(ex)` (choix enregistré, bibliothèque, puis nom), `measureSetTxt`. Volume en kg et records : répétitions seulement. Poids du corps : `BODYWEIGHT_SHARE` (part soulevée, sources dans le fichier), `loadKind` (charge, lest, aide), `effectiveLoad`, `currentBodyKg` (Santé puis Réglages ; enregistré par séance dans `h.bodyKg`) |
| `exercise-catalogue.js` | `EXERCISE_CATALOGUE` (bibliothèque : nom, muscles principaux et secondaires, matériel `EQUIPMENT`, alias ; tous les exercices de `PROGRAMMES` y figurent), `catalogueEntry(nom)` (nom, alias ou abréviation), `equipmentOf`, `PROGRESSIONS` et `progressionOf` (plus facile / plus dur) |
| `muscles.js` | `MUSCLES` (16 groupes, `minor` pour les petits), `ruleKey` (abréviations de salle développées), recherche `exerciseMatchScore` (début de mot, une faute tolérée, synonymes de muscles), `similarExercises`, `MUSCLE_RULES` (reconnaissance d'un nom libre par mots-clés, la première règle l'emporte), `musclesOf(nom)`, `chosenMuscles`, `exerciseMuscles(ex)` (choix de l'utilisateur, sinon nom), `musclesLine` |
| `muscle-load.js` | `MUSCLE_SPANS` (semaine, 4 semaines), `muscleSetCounts` (principal 1 série, secondaire ½), `muscleLevel` (paliers 0 / 1–3 / 4–9 / 10+ séries par semaine), `muscleLoad(span)` : séries, paliers, intensités 0..1 et muscles peu travaillés ; `sessionMuscleLevels` / `sessionTopMuscles` : muscles d'une seule séance (image partagée) |
| `app-icons.js` | Marque : `APP_ICONS` (icônes de l'app : id, libellé, jeu d'icônes iOS `asset`, couleurs, flèche de la barre), `DEFAULT_APP_ICON`, `appIconFromNative(nom)` (null ou inconnu : défaut), `nativeAppIconName(id)` (défaut : null), `alternateAppIconNames()`, dessin du signe `appIconGlyph` / `appIconSvg(icône, options)`. Seule source des images de la marque (voir plus bas) |
| `backup.js` | `importText` (tout vérifié sur une copie ; renvoie `{ ok, reason }` ou `{ ok, count, skipped, theme, previous }`), `undoImport`, `exportData(theme)` (renvoie `true` une fois le fichier remis), `downloadText` |

### js/app/actions.js

Registre des actions. Chaque fichier d'écran déclare les siennes :

```js
registerActions({
  'validate-set': (e, el) => { validateSet(parseInt(el.dataset.ei), parseInt(el.dataset.si)); },
  'finish-session': async () => { … },
});
```

`handleAction(e, el, action)` ne fait qu'aiguiller vers la fonction enregistrée (`e` vaut `null`
lors d'un appel direct, comme depuis la feuille d'actions de l'accueil). Une action inconnue ne
fait rien. Dans une action, `return` remplace l'ancien `break` de sortie du `switch`.

### js/ui/

| Fichier | Rôle |
|---|---|
| `theme.js` | Thème clair / sombre / auto (appliqué au chargement), Dynamic Type, bascule différée pendant une séance |
| `router.js` | Routes paramétrées (`makeRoute`, `routeName`, `routeParams`), onglets (`TABS`) et piles d'écrans (`nav`), `currentView()` (et `view` en lecture seule), synchronisation avec l'historique du navigateur (`popstate`, entrées des feuilles), mémoire de défilement, table des écrans (`SCREENS` : `render`, `mount`, `enter`, `leave`), `render()` / `paint()` / `show()` avec transitions, `navBoot()` ; actions `back`, `go-home` |
| `navbar.js` | Tab bar et mini-barre de séance (posées une fois hors de `#app`), `navBar()`, titres de retour, grand titre qui se replie |
| `sheet.js` | `sheet()` : feuille modale générique (Annuler / OK, glisser pour fermer) |
| `forms.js` | `flagInvalid`, `weightOk`, `weightMsg` |
| `edge-swipe.js` | Geste de retour depuis le bord gauche (app installée sur iOS) |
| `reorder.js` | Glisser pour réordonner (poignée ≡ du mode Modifier) : `makeReorderable({ view, list, row, handle, onMove })`, utilisé par les exercices d’une séance et les séances d’un programme perso |
| `body-map.js` | `bodyMapSvg(niveaux, options)` : silhouette face / dos en SVG texte, chaque muscle coloriable (`data-muscle`) ; `bodyHeatOpacity`, `bodyMapColors()` (couleurs résolues pour un SVG autonome) |
| `medal.js` | Médaille de record : `MEDAL_PATHS` (tracés partagés avec l'image de partage) et `medalSvg(taille)` |

### js/features/

| Fichier | Rôle |
|---|---|
| `dashboard.js` | Accueil : prochaine séance, autres séances, régularité, démarrage d'une séance (`startSessionFlow`), chronos (`startTicker`) |
| `programme.js` | Onglet Programme, sélecteur de programme, création / renommage / suppression d'un programme perso, `activateProgramme()` |
| `programme-editor.js` | Programme › Séance (liste, mode Modifier, glisser pour réordonner) et Programme › Exercice (brouillon `exDraft`) |
| `custom-session.js` | Séance perso : nom, description, icône, couleur, suppression |
| `session.js` | Séance en cours : démarrage / fin, `persistSession()` (séance et repos, avertissement « stockage plein »), tableau des séries, badges de record, validation et « Annuler » |
| `rest.js` | Repos : mini-barre, feuille détaillée, chrono calé sur une heure de fin, jalons annoncés, `restSnapshot()` / `resumeRest()` pour la séance enregistrée |
| `rest-activity.js` | Live Activity du repos (app iOS) : données envoyées au module natif (`restActivityPayload`, couleur, série suivante), `syncRestActivity()` (via `syncNativeRest()`) / `endRestActivity()` appelés par `rest.js` |
| `session-sheets.js` | Feuilles de la séance (`openSessSheet`), repos d'un exercice, feuille d'ajout / remplacement d'exercice (`openAddExSheet({ target })` : séance en cours, Programme › Séance ou séance passée), menu ⋯ |
| `session-gestures.js` | Balayage d'une série (« Supprimer »), clavier (Entrée, champ actif), recherche de la feuille d'ajout |
| `summary.js` | Fin de séance (« Terminer » : enregistrement, stockage plein) et bilan |
| `add-session.js` | Séance passée : saisie, modification d'une séance, brouillon en `sessionStorage` (crochets `enter` / `leave` de l'écran), ajout d'exercice par la feuille de recherche commune |
| `app-icon.js` | Réglages › Icône de l'app (app iOS seulement) : `renderAppIconGroup()` (grille de vignettes, `aria-pressed`, coche), action `set-app-icon` (`Native.appIcon.set`), état lu une fois au démarrage |
| `settings.js` | Réglages, import / export (résultat affiché ici : thème, toast « Annuler », date de sauvegarde), suppression des données, recherche de mise à jour |
| `progress.js` | Progrès : tuiles et index des exercices tiré de l'historique |
| `progress-chart.js` | Progrès › Exercice : courbe sur canvas, sélection d'un point au doigt |
| `progress-overview.js` | Progrès › Vue d'ensemble : calendrier du mois, séances par semaine |
| `exercise-howto.js`, `exercise-moves.js` (data) et `exercise-anim.js` (ui) | « Comment faire » : consignes et erreur fréquente des exercices courants (tous ceux des programmes intégrés) ; animation (positions clés, coudes et genoux par cinématique inverse) affichée seulement pour les mouvements `ready`, en attente d'un dessin dans le style de la silhouette |
| `library.js` | Programme › Bibliothèque (`library`) : recherche, filtre de matériel, sections par zone du corps ; fiche d'un exercice (`library-ex:NOM`) : silhouette des muscles, matériel, mesure, part du poids du corps, progression plus facile / plus dure, lien vers ses progrès |
| `muscles.js` | Muscles des exercices : ligne sous le nom (Programme › Séance, feuille d'ajout), mini-silhouette et pastilles (Programme › Exercice, Progrès › Exercice), feuille « Muscles ciblés » ; carte « Muscles » de Progrès et écran Progrès › Séries par muscle (`stats-muscles`, inscrit dans `SCREENS` depuis ce fichier) |
| `history.js` | Historique : recherche, filtre, mois chargés par paquets, détail, balayage pour supprimer avec « Annuler » |
| `share-stats.js` | Partage de séance, logique pure : `shareStoryStats(entry)` (durée, volume, séries, records, 3 à 5 exercices clés), texte VoiceOver, nom du fichier |
| `share-canvas.js` | Partage de séance, dessin : `drawStory` (story Instagram 1080 × 1920, Canvas 2D, zones sûres), couleurs des tokens, point d'accroche `shareStoryHooks.muscleSvg` pour la silhouette des muscles |
| `share.js` | Partage de séance, écran : bouton du bilan et d'Historique › Séance, aperçu, partage (`Native.shareImage` dans l'app iOS, `navigator.share` ou téléchargement dans la PWA) |

### js/app/

| Fichier | Rôle |
|---|---|
| `updates.js` | Service worker : enregistrement, bannière « Nouvelle version disponible » (jamais pendant une séance), `checkForUpdate` |
| `init.js` | Écouteur de clic global vers le registre, saisie en direct, sauvegarde à la mise en arrière-plan, wake lock, écran de secours, démarrage (`DOMContentLoaded`) |

## Flux d'une action

```
toucher un élément [data-action="validate-set"]
  → écouteur de clic d'init.js
  → handleAction(e, el, 'validate-set')        (js/app/actions.js)
  → fonction enregistrée par session.js
  → modification de data / activeSession
  → save()                                     (écrit ppl_v2, toast si le stockage est plein)
  → render()                                   (redessine l'écran courant, garde le défilement)
  → persistSession()                           (toujours, après chaque action)
```

`render()` ne fait que redessiner l'écran courant. L'écran affiché se lit dans la navigation
(`currentRoute()`, `currentView()`) et ne change que par `navigate(route)` (empiler), `goBack()`,
`routeTo(route)` (revenir à un écran de la pile, sinon à la racine d'un onglet, sinon empiler) ou
`switchTab(tab)`.

Un écran qui affiche un élément précis porte son paramètre dans sa route, jamais dans une variable
partagée : `history-detail:ID`, `stats-ex:EXID`, `editor:CAT`, `ex-edit:CAT:RANG`
(`makeRoute('editor', cat)`, lus par `routeParams`). Chaque onglet garde ainsi ses propres écrans,
et le hash (`#progress/stats-ex:p1dcouch`) décrit l'écran affiché.

Les effets propres à un écran sont des crochets de `SCREENS` appelés par le routeur : `mount`
après chaque dessin (courbe de Progrès › Exercice, version dans Réglages, série courante de la
séance), `enter` / `leave` à l'arrivée et au départ (wake lock de la séance, brouillon de la séance
passée).

La saisie dans les champs (`input`) ne passe pas par le registre : `init.js` recopie la valeur dans
`activeSession` ou dans le brouillon de la séance passée au fil de la frappe, sans redessiner.

## Modèle de données

Les charges sont toujours stockées **en kg**, en chaîne (`'32.5'`, `''` pour le poids du corps) ;
l'affichage convertit en lbs si besoin (`toUnitW` / `fmtW` à l'affichage, `storeW` à la saisie).
Les reps sont stockées en chaîne.

Une seule fonction par format, dans `util.js` et `accessors.js` : `fmtW(kg)` pour une charge en
texte (« 1 032,5 »), `fmtW(kg, { plain: true })` pour la valeur d'un champ de saisie (« 1032,5 »,
relue par `num()`), `fmtClock` / `fmtRest` / `fmtDuration` pour les durées, `fmtDate(ts, style)` et
`fmtTime` pour les dates. Ne pas réécrire de `toLocaleDateString` ou d'arrondi de charge ailleurs.

### localStorage `ppl_v2` (schéma 3)

```js
{
  schema: 3,
  activeProgramme: 'ppl',                    // id intégré (ppl, upper_lower, fullbody, bro, arnold, custom) ou u_xxxxxxxx
  programmes: {                              // données par programme utilisé
    ppl: {
      exercises: { push: [{ id, name, sets, lastWeight, lastReps, pr: { weight, reps } | null,
                            est1RM, target, rest, repMax, muscles? }] },
      timers:    { push: 1712345678901 | null },   // date de la dernière séance (délai de récupération)
      cooldowns: { push: 72 },                     // heures
      skipped:   { push: 1712345678901 },          // facultatif : « Passer le délai », valable jusqu'à la séance suivante
    },
  },
  customSessions: { cat: { label, icon, desc, color } },          // séances de l'ancien programme « Perso »
  userProgrammes: { u_xxxxxxxx: { name, sessions: { cat: { label, icon, desc, color } }, archived } },
  defaultRest: 90, unit: 'kg' | 'lbs', soundOn: true, vibrateOn: true,
  lastExport: 1712345678901,                 // facultatif
  history: [{ id, programme, category, date, duration?, notes,
              exercises: [{ exId, name, sets: [{ weight, reps }] }] }],   // triée du plus récent au plus ancien
}
```

- `exId` relie un exercice de l'historique à l'exercice du programme (`id`), même après un
  renommage ; un exercice inconnu reçoit `'n:' + normName(nom)`.
- `muscles` (facultatif) : identifiants de muscles choisis dans Programme › Exercice ; absent, les
  muscles viennent du nom (`exerciseMuscles`). Champ additif, ignoré par une version précédente ; un
  identifiant inconnu est ignoré à la lecture.
- Un programme perso supprimé est **archivé** (`archived: true`) et non effacé : l'historique garde
  les noms et couleurs de ses séances.
- `pr`, `est1RM`, `lastWeight`, `lastReps` sont recalculés depuis l'historique
  (`recomputePRFromHistory`) ; l'historique fait foi.
- `timers` avance jusqu'à la dernière séance de l'historique (`syncTimersFromHistory`) et recule
  quand on supprime la séance qui le fixait (`releaseTimer`). « Passer le délai » n'y touche pas :
  il écrit `skipped[cat]`, que `catStatus` lit (séance considérée comme jamais faite) et que
  `sanitizeData` retire dès qu'une séance plus récente existe. Champ additif : une version
  précédente l'ignore.
- Clés de séance (`customSessions`, `sessions` des programmes perso) : `[A-Za-z0-9_-]{1,40}`
  (`SESSION_CAT_RE`) ; une clé hors de cet alphabet est retirée par `sanitizeData`, car elle est
  écrite telle quelle dans les attributs (`data-cat`) et les sélecteurs.

### localStorage `ppl_active_session`

```js
{
  activeSession: { category, programme, startedAt, lastEi?,
                   baseline: { [exId]: { prW, prR, e1rm } },        // records d'avant la séance
                   exercises: [{ exId, name, rest?, bumped?,
                                 sets: [{ weight, reps, plannedWeight, prev: { weight, reps } | null, done }] }] },
  sessionNotes: '',
  rest: { endTime, minimized, total } | null,                       // repos calé sur une heure de fin
}
```

### Autres clés

- `ppl_theme` : `'auto'`, `'light'` ou `'dark'` (lu aussi par le script en tête d'`index.html`).
- `ppl_v2_backup` : copie brute de `ppl_v2` avant une migration, un import ou une suppression totale
  (proposée par l'écran de secours).
- `ppl_statusbar_hint` : le conseil « barre d'état » a déjà été montré.
- `sessionStorage.ppl_add_draft` : brouillon de la séance passée tant que l'écran est ouvert.

## Règles

- **Migrations additives et idempotentes.** `normalizeData` complète ce qui manque et ne retire
  rien ; `sanitizeData` ne retire que ce qui ferait planter l'app ou serait réinjecté tel quel dans le HTML (champs bornés comme à la saisie, fichier d'un schéma plus récent refusé à l'import). Un changement de schéma
  incrémente `SCHEMA`, sauvegarde l'ancien texte dans `ppl_v2_backup` et reste lisible par
  l'import d'un ancien fichier. Les formats de `ppl_v2`, `ppl_active_session`, `ppl_theme` et
  `ppl_v2_backup` ne changent pas sans migration.
- **La donnée ne connaît pas l'écran.** `js/data/` n'appelle que `js/core/` (le seul effet
  visible est le toast « Stockage plein » de `save()`) : ses fonctions renvoient un résultat, et
  l'écran appelant (`settings.js`, `session.js`, `init.js`) affiche, redessine ou relance le repos.
- **Échappement.** Tout texte saisi par l'utilisateur (noms, notes, libellés de séances perso)
  passe par `esc()` avant d'entrer dans un gabarit HTML ; `sessionMeta()` renvoie des libellés déjà
  échappés, `rawLabel()` le texte brut (pour `textContent` et les dialogues).
- **Images de la marque générées, jamais retouchées à la main.** Le signe et ses couleurs vivent
  dans `js/data/app-icons.js` ; `python3 scripts/brand-icons.py` (Node, CairoSVG, Pillow ;
  déterministe) en tire `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, les jeux
  d'icônes iOS, l'écran de démarrage et la marque de la Live Activity (détail dans IOS.md). Ces
  couleurs sont celles des images, pas de l'interface : elles restent hors des tokens.
- **iOS : rien de révélé au `pointerdown`.** Faire apparaître un élément dès le toucher (bouton
  « Supprimer » d'une série, par exemple) fait avaler le tap par Safari : il faudrait toucher deux
  fois. Le contenu est révélé seulement quand le geste est reconnu (`pointermove` au-delà du seuil).
- Pas d'`overflow: hidden` sur `body` (rectangle visible dans la zone sûre d'iOS) ; seulement
  `overflow-x`.
- Couleurs en dur seulement dans les tokens de `css/base.css` ; tailles de police en `rem`
  (Dynamic Type) ; textes de l'interface en français.
- Une nouvelle version publiée incrémente `CACHE` dans `sw.js` et liste tout nouveau fichier dans
  `ASSETS` (le cache est téléchargé d'un bloc : l'app ne mélange jamais deux versions).

## Tests

`tests/run_all.py` lance les lots Playwright (Python) sur 5 appareils (WebKit iPhone 13 / SE,
Chromium Pixel 7 / Galaxy S8 / S9+) en thèmes clair et sombre, plus des tests uniques
(service worker, contrôles statiques), puis les tests par domaine (`test_muscles.py`, `test_partage.py`, `test_icone.py`).
`test_icone.py` simule la coquille iOS (faux `window.Capacitor` injecté avant le chargement, faux
module `MdlfAppIcon`) : c'est le modèle à suivre pour tester une fonction réservée à l'app. Voir l'en-tête
de `run_all.py` pour les options.

`node tests/unit/run.mjs` lance les tests unitaires de la logique pure (formats, 1RM, nettoyage et
migrations, import, délais de récupération, clés de séance, saisie, programmes perso ; muscles
dans `tests/unit/muscles.mjs`, records et image partagée dans `tests/unit/share.mjs`, icône de l'app
et cohérence avec le projet Xcode dans `tests/unit/app-icons.mjs`) : les scripts
de `js/core/` et `js/data/` sont chargés dans un contexte `vm` de Node, sans navigateur, en moins d'une seconde.

### Partage de séance

`tests/test_partage.py` (lancé par `run_all.py`, seul avec `run_all.py partage`) génère l'image depuis
le bilan et depuis l'historique sur les 5 appareils, vérifie son format (PNG 1080 × 1920), l'aperçu
et le partage, et l'écrit dans `$PPL_SCRATCH/shots/partage/` pour la regarder.

La silhouette des muscles s'accroche par `shareStoryHooks.muscleSvg = (entry, stats, palette) => svg`
(texte SVG ou `null`), que `share.js` remplit avec `storyMuscleSvg` : `bodyMapSvg` autonome (face et
dos), intensités de `sessionMuscleLevels(entry)` (séries de la séance par muscle, rapportées au plus
travaillé), coloriée dans la couleur de la séance. L'image passe alors à la mise en page « chiffres +
silhouette » ; si aucun muscle n'est reconnu, elle se dessine en ligne. La description VoiceOver
nomme les trois muscles les plus travaillés (`sessionTopMuscles`).

## Suite prévue : modules ES

1. Passer chaque fichier en `type="module"` avec des `import` / `export` explicites ; `index.html`
   ne chargera plus qu'un point d'entrée (`js/app/init.js`).
2. Regrouper l'état partagé (aujourd'hui des `let` globaux : `activeSession`, état de la séance
   passée, variables de repos…) dans des objets d'état par domaine, modifiés par des fonctions dédiées.
3. Exposer explicitement sur `window` ce que les tests lisent (`data`, `view`, `render`…), ou faire
   évoluer les tests.
4. Ensuite seulement : renommer les dernières classes CSS héritées écran par écran (`.set-row2` est devenu `.session-set`, `.color-swatch2` est devenu `.color-swatch`).
