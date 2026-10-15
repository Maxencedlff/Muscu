# Plan d'amélioration final de PPL Training (niveau Apple Design Award)

Cette synthèse s'appuie sur les 5 audits (architecture, séance active, design visuel, accessibilité et robustesse, progrès et historique). J'ai relu `app.js` (2 867 l.), `style.css` (1 088 l.), `index.html` et `sw.js` pour vérifier les constats douteux.

---

## 0. Verdict et principes

L'app est solide sur l'essentiel. La séance survit à un rechargement, le chrono de repos est calé sur l'horloge réelle et les nouveaux dialogues iOS sont réussis. Elle n'est pas encore au niveau d'une app mise en avant par Apple, pour trois raisons :

1. **Des données fausses ou perdues en silence.** Plusieurs défauts touchent le chiffre le plus important de l'app :
   - le PR est écrit avant l'enregistrement de la séance ;
   - la séance est pré-remplie avec la plus mauvaise série de la fois précédente ;
   - renommer un exercice coupe le lien avec tout son historique ;
   - un import mal formé peut rendre l'app inutilisable (écran noir à chaque lancement) ;
   - si le stockage est plein, l'app affiche « Séance enregistrée ! » alors que la séance est perdue.
2. **Il n'y a pas d'architecture de navigation.** La navigation repose sur 4 icônes sans libellé en haut à droite. Il n'y a ni pile, ni retour système, ni mémoire du défilement.
3. **Il n'y a pas de système de design.** On compte 16 tailles de police, 12 rayons et 54 couleurs écrites en dur. Le thème clair n'a pas été dessiné, il a été inversé. Des emojis servent d'icônes, et les boutons ont des dégradés et des halos.

**Règles qui s'appliquent à tous les lots :**
- **Ne jamais casser `ppl_v2` ni `ppl_active_session`.** Les migrations ne font qu'ajouter des champs : on ne supprime et on ne renomme aucun champ existant. Les migrations sont idempotentes et passent par un champ `data.schema`. Avant toute migration, une copie est faite dans `localStorage['ppl_v2_backup']`, puis on vérifie qu'un ancien export JSON se ré-importe sans perte.
- On reste en vanilla JS, sans build ni dépendance, et l'app fonctionne hors ligne.
- Chaque lot ajoute l'accessibilité de **ses propres** composants : `aria-label`, rôles, cibles de 44 pt. Le lot 6 sert à faire un balayage final, pas à rattraper tout ce qui manque.
- Après chaque lot :
  - incrémenter `CACHE` dans `sw.js` ;
  - lancer Playwright sur WebKit iPhone 13, WebKit iPhone SE et Chromium Pixel 7 (`--mute-audio`), en sombre et en clair, avec `localStorage` vide puis rempli (historique de 9 semaines) ;
  - lire les captures avant de dire que c'est fini ;
  - faire un commit et un push sur GitHub, puis déployer sur Vercel.

---

## 1. Vérification des constats : ce qui est confirmé, nuancé ou écarté

| Constat | Verdict | Preuve dans le code |
|---|---|---|
| PR, e1RM et lastWeight écrits dès qu'une série est validée | **Confirmé** | `validateSet` l.1072-1087 modifie `exData` puis appelle `save()` |
| Pré-remplissage avec la dernière série, puis recopie des reps dans la série suivante | **Confirmé** | `startSession` l.902-903 et `validateSet` l.1066-1070 |
| Badge « PR ! » affiché aussi quand on égale le record | **Confirmé** | l.959 : `s.weight == exData.pr.weight && s.reps == exData.pr.reps` |
| Statistiques, PR et séance précédente retrouvés par le nom de l'exercice | **Confirmé** | l.946, 1777, 1839, 1886, 2203 et `recomputePRFromHistory` l.262 ; `finish-session` l.2662 n'enregistre que `name` |
| Import qui écrase `data` avant de vérifier quoi que ce soit | **Confirmé** | l.2775 `data = normalizeData(d)` passe avant `recomputePRFromHistory()`, qui n'est pas protégée contre `session.exercises` absent. Ensuite l.547 plante hors de tout try au démarrage |
| Stockage plein : le toast d'erreur est remplacé par « Séance enregistrée ! » | **Confirmé** | `save()` l.362 ne renvoie rien, l.2670 affiche le toast quand même ; `persistSession` a un catch vide |
| `.cooldown-btn` absent de la feuille de style | **Confirmé** | utilisé l.1640-1642, seul `.card__cooldown-btn` existe |
| Groupes de Réglages écrasés sur iPhone SE | **Confirmé** | `.settings-list` est en flex column (l.831), `.settings-group` en overflow hidden sans `flex-shrink:0` (l.842) |
| `.date-input` en `color-scheme: dark` | **Confirmé** | style.css l.529 |
| Mini-barre de repos placée à 60 px du bas | **Confirmé** | style.css l.353 |
| Retour qui ramène toujours à l'accueil et ignore les modifications | **Confirmé** | l.2136-2139 |
| `render()` ne garde le défilement que pour la séance | **Confirmé** | l.618-637 |
| Séance passée pré-remplie avec lastWeight et lastReps | **Confirmé** | `initAddSets` l.1400-1408 |
| Toast « Séance ajoutée ! » affiché aussi après une modification | **Confirmé** | l.2338 |
| Chrono qui dérive au retour au premier plan | **Confirmé** | `startRestCountdown` l.1150 recalcule `restEndTime` à partir de `restTimeLeft` arrondi par `Math.ceil` |
| SW en course réseau contre cache sur chaque fichier, avec `skipWaiting` immédiat | **Confirmé** | sw.js l.5-36 |
| Fin de repos signalée seulement par `navigator.vibrate` (absent sur iOS) | **Confirmé** | l.604 ; `haptic()` (astuce de l'interrupteur, l.150) ne marche qu'à la suite d'un geste, donc pas dans un minuteur |
| **« La meta status-bar reste black-translucent en clair »** (audit accessibilité) | **Nuancé** | `index.html` l.17-24 passe déjà la meta à `default` en clair **au lancement**. Le défaut n'existe que si l'on change de thème pendant que l'app tourne, ou si le mode Auto bascule en cours de séance. La correction proposée (un dégradé sombre sous la barre d'état en thème clair) est **écartée** car elle est laide. Voir le lot 6 |
| **« Saisir “32,5” dans un type=number donne une valeur vide »** | **Plausible, non prouvé sur un vrai iPhone** | le test Playwright ne reproduit pas le pavé iOS FR. Le passage en `type="text" inputmode="decimal"` est retenu de toute façon, car il ne coûte presque rien |
| « La formule du volume est fausse (séries × reps × kg) » | **Nuancé** | il s'agit seulement du libellé (l.1890) : le calcul Σ(kg × reps) est bon. On corrige le texte |
| `user-scalable=no` qui bloquerait le zoom iOS | **Nuancé** | iOS ignore cette valeur depuis iOS 10. On la retire pour Android, ce qui impose des champs d'au moins 16 px pour éviter le zoom automatique d'iOS sur un champ |

Point de vigilance trouvé pendant la relecture, qu'aucun auditeur n'a signalé : l.1422 construit une couleur avec `${meta.color}18`, c'est-à-dire un hex auquel on colle un canal alpha. Toute couleur de catégorie qui passerait en `var(--x)` casserait ce code. Il faut le remplacer par `color-mix(in srgb, var(--cat-color) 10%, transparent)`.

---

## 2. Arbitrages entre auditeurs

1. **Contenu de la tab bar.** Le design proposait Séances / Historique / Progrès / Réglages, l'architecture proposait Entraînement / Historique / Progrès / Programme. **Je retiens Entraînement / Historique / Progrès / Programme.** On modifie son programme toutes les semaines, alors que les réglages changent quelques fois par an. Les Réglages passent derrière un bouton « Réglages » dans la barre de navigation de l'onglet Programme.
2. **Chrono de repos.** La séance demandait une barre non bloquante, le design une surcouche améliorée. **Par défaut, ce sera une barre non bloquante.** Toucher la barre ouvre une feuille détaillée qui reprend les idées du design (anneau, chiffres SF Rounded, préréglages en contrôle segmenté). Le repos sert à préparer la série suivante, donc il ne doit pas bloquer l'écran.
3. **Couleurs de catégorie.** Push passe en orange, Pull en indigo, Legs en teal. Comme `PROGRAMMES` est écrit dans le code et non dans les données, **aucune migration n'est nécessaire**. Les couleurs déjà choisies pour les séances Perso restent telles quelles.
4. **Pavé numérique intégré (L) contre clavier système amélioré.** **Je retiens le clavier système amélioré** : sélection du contenu au focus, `enterkeyhint`, Entrée qui passe au champ suivant. Un pavé maison remplace un composant système accessible et coûte cher, alors qu'avec le bon pré-remplissage 80 % des séries se valident en un seul tap.
5. **Défilement du document ou de conteneurs internes.** **Je retiens le défilement du document**, avec barre de navigation collante et tab bar fixe. Cela permet le tap sur la barre d'état pour remonter en haut, le grand titre qui se réduit et une mémoire du défilement plus simple (`scrollY`). On garde seulement `overflow-x:hidden` sur `body`, pas `overflow:hidden` (règle de la zone sûre iOS).
6. **Son qui passe outre le mode silencieux.** `navigator.audioSession.type='playback'` **coupe la musique de l'utilisateur** (Spotify), ce qui est inacceptable en salle. Je propose une option désactivée par défaut qui utilise `'transient'`, à vérifier sur l'appareil. Si la musique est coupée, on retire l'option et le signal repose sur l'écran et VoiceOver.
7. **Suggestion de progression.** Elle prend la forme d'une **puce qu'on touche** (« ↑ +2,5 kg »), jamais d'une modification automatique. Elle apparaît quand toutes les séries précédentes ont atteint `ex.repMax`, un nouveau champ optionnel qui vaut 12 par défaut.
8. **Geste de retour depuis le bord sur iOS.** Il est retenu, mais placé à la fin du lot 3, derrière ses propres critères d'acceptation. Il est désactivé pendant la séance et quand un champ a le focus.

---

## 3. Les lots (à faire dans l'ordre, un à la fois)

### LOT 1 : Intégrité et robustesse des données (aucun changement visuel)

**Objectif.** Chaque chiffre affiché est juste, et aucune action ni aucun import ne peut corrompre `ppl_v2`. Ce lot passe en premier parce que tous les autres vont afficher ces données.

**Changements**

1. **Schéma 3 et identifiant stable des exercices**
   - Dans `normalizeData`, ajouter une migration qui ne s'exécute que si `(d.schema||2) < 3`. Avant de migrer, copier le JSON brut dans `ppl_v2_backup`.
   - Pour chaque entrée d'historique et chaque exercice, poser `exId` en cherchant le nom dans `d.programmes[h.programme||'ppl'].exercises[h.category]`. Si aucun exercice ne correspond, poser `exId = 'n:' + normName(name)`, avec `normName` = minuscules, sans accents, espaces réduits.
   - Terminer par `d.schema = 3`.
   - `finish-session` (l.2662) et `save-past-session` enregistrent `{exId, name, sets}`.
   - Partout où l'on cherche par nom (l.946, 1777, 1839, 1886, 2203 et `recomputePRFromHistory` l.262), utiliser l'aide `sameEx(a, b) = (a.exId && b.exId) ? a.exId === b.exId : normName(a.name) === normName(b.name)`.
   - Dans `save-ex`, si le nom change : `confirmSheet('Renommer aussi dans l\'historique ?', '${n} séances contiennent cet exercice.', 'Renommer partout', false)`. Si l'utilisateur accepte, mettre à jour `h.exercises[].name`. L'`exId` garde le lien dans tous les cas.
2. **PR figé au démarrage de la séance**
   - Supprimer toute écriture sur `exData` dans `validateSet` (l.1072-1087) et dans `save-edit-set` (l.2496-2510).
   - Dans `startSession`, poser `activeSession.baseline[exId] = {prW, prR, e1rm}`. Dans `restoreSession`, si `baseline` manque (séance d'un ancien format), le calculer à la restauration.
   - Dans `finish-session`, après `unshift`, appeler `recomputePRFromHistory()` puis `save()`. L'abandon d'une séance n'a alors plus rien à annuler.
   - Supprimer `data._prRecomputed`. Ne plus lancer le recalcul au démarrage, sauf pendant la migration du schéma 3, protégée par un try.
3. **Pré-remplissage série par série**
   - `startSession` : `prevEx = dernière séance de cette catégorie avec sameEx`, puis `sets[i] = prevEx?.sets[i] ?? prevEx?.sets.at(-1) ?? {weight: ex.lastWeight, reps: ex.lastReps}`.
   - Chaque série garde `prev: {weight, reps}` pour la colonne « Préc. » du lot 4.
   - `validateSet` ne recopie **plus** les reps. Il ne recopie le poids dans la série suivante que si `s.weight !== s.plannedWeight`.
4. **Badge de record juste.** Il compare la série à `baseline` :
   - « Record charge » si le poids dépasse le PR enregistré ;
   - « Record reps » si le poids est égal et que les reps dépassent ;
   - « Record 1RM est. » si `calc1RM` dépasse la baseline ;
   - jamais en cas d'égalité.
5. **Import sûr**
   - Écrire `sanitizeData(d)`. Elle garde les entrées d'historique qui ont `Number.isFinite(date)` et `Array.isArray(exercises)`, et les séries qui ont des reps entières. Elle force `reps = String(parseInt)`. Elle n'accepte que les couleurs qui respectent `/^#[0-9a-f]{6}$/i` (sinon `#8E8E93`). Elle crée `exercises`, `timers` et `cooldowns` quand ils manquent.
   - L'import fait `next = sanitizeData(normalizeData(structuredClone(d)))`, recalcule les PR sur `next` dans un try, puis seulement `data = next`.
   - Juste avant l'import, copier la donnée actuelle dans `ppl_v2_backup` et afficher le toast « Import réussi · Annuler » pendant 6 s, qui restaure la copie.
   - `loadData()` passe aussi par `sanitizeData`.
6. **Écran de secours.** Envelopper l.546-547 et l'initialisation (l.2860-2867) dans un try/catch. En cas d'échec, afficher un écran HTML minimal « Données illisibles » avec trois boutons : « Restaurer la sauvegarde précédente » (`ppl_v2_backup`), « Exporter les données brutes » (téléchargement du JSON de `ppl_v2`) et « Réinitialiser » (avec confirmation).
7. **Stockage plein**
   - `save()` renvoie `true` ou `false`.
   - `finish-session` : si `save()` échoue, ne pas appeler `endSession()`. Afficher le dialogue bloquant « Espace de stockage plein » avec le message « Exporte tes données pour ne pas perdre cette séance. » et les boutons [Exporter] [Plus tard]. La séance reste active.
   - `persistSession` affiche un toast une seule fois par session en cas d'échec.
   - Au premier lancement, appeler `navigator.storage?.persist?.()`.
8. **Saisies bornées.** Une aide `num(v,min,max,int)` renvoie `null` hors bornes :
   - reps : entier de 1 à 100 ;
   - poids : vide ou de 0 à 1 000 ;
   - séries : de 1 à 10 ;
   - repos : de 10 à 600 s.
   Le texte saisi passe par `.replace(',', '.')` avant `storeW`. En cas d'erreur, on ajoute `aria-invalid="true"`, la classe `.set-input--error` (contour rouge) et le toast « Reps entre 1 et 100 ».
9. **Séance passée**
   - Les valeurs sont vides et les anciennes valeurs servent de placeholder.
   - Ajouter un bouton « Reprendre la dernière séance » qui recopie les valeurs.
   - « Enregistrer » est désactivé tant qu'aucune rep n'est saisie.
   - Date : vérifier `^\d{4}-\d{2}-\d{2}$` et refuser une date future, avec le toast « Choisis une date ».
   - Ne toucher à `timers[addCat]` que si la date choisie est plus récente que le timer actuel.
   - Toast « Séance modifiée » ou « Séance ajoutée » selon `editSessionId`, lu avant sa remise à null.
   - On peut modifier une séance d'un autre programme grâce à `data.programmes[h.programme]`.
10. **Séance Perso supprimée pendant qu'elle est en cours.** `delete-custom-session` affiche `confirmSheet('Cette séance est en cours', 'Elle sera abandonnée.', 'Supprimer')` puis appelle `endSession()`. `finish-session` vérifie que la catégorie existe encore. La confirmation indique « ${n} séances de l'historique seront effacées ».
11. **Chrono.** Ajouter `resumeRestCountdown()`, qui relance le `setInterval` sans recalculer `restEndTime`. Il est appelé par `visibilitychange` et par `restoreSession`.
12. **Échappement du HTML.** Passer par `esc()` les reps, `lastReps` et `pr.reps` (l.964, 1001, 1308-1309, 1824) et `s.color` (l.835).
13. **Service worker**
    - Passer à « cache d'abord » pour la coquille de l'app, avec une seule version cohérente par `CACHE`, et mise à jour en arrière-plan.
    - Supprimer `skipWaiting` à l'installation. Quand une version attend (`registration.waiting`) et qu'**aucune séance n'est active**, afficher la bannière « Nouvelle version disponible · Mettre à jour », qui envoie `postMessage('skipWaiting')` puis recharge.
    - `force-update` vide `caches.keys()` avant de désinscrire le SW. Le bouton s'appelle « Rechercher une mise à jour » et indique le résultat (« Tu as la dernière version »).
14. **Volume.** Le delta compare le même nombre de séries (`prevSets.slice(0, n)`). Il est gris tant que l'exercice n'est pas fini, vert s'il est positif, jamais rouge en cours de séance. On retire le delta de l'en-tête. Le libellé de la l.1890 devient « Somme poids × reps de toutes les séries ».

**Fichiers** : `app.js` (normalizeData, loadData, save, persistSession, restoreSession, startSession, validateSet, recomputePRFromHistory, finish-session, save-past-session, initAddSets, import, delete-custom-session, startRestCountdown, renderSession pour le badge et le volume) et `sw.js`.

**Critères d'acceptation (Playwright)**
- Avec un `ppl_v2` d'aujourd'hui injecté, l'app se charge, `data.schema === 3`, 100 % des exercices de l'historique ont un `exId` et le nombre de séances reste le même. Le `ppl_v2_backup` correspond octet pour octet au JSON d'origine.
- Valider 35×6 puis abandonner : le PR reste celui d'avant. Valider 325 puis corriger en 32,5, puis terminer : le PR est juste.
- Séance précédente 32,5×10/10/9/8 : la séance suivante est pré-remplie 10/10/9/8.
- Refaire exactement le PR n'affiche aucun badge.
- Renommer un exercice puis ouvrir les statistiques : la courbe est toujours là.
- Importer `{"activeProgramme":"ppl","programmes":{},"history":[{"id":"x","date":1,"category":"push"}]}` : les données d'avant sont intactes, il n'y a pas d'écran noir après rechargement, et le toast d'erreur s'affiche.
- Remplir le localStorage, puis Terminer : la séance reste active, le dialogue s'affiche et aucun « Séance enregistrée ! » n'apparaît.
- Reps « 0 » ou poids « -40 » sont refusés. Une date vide est refusée.
- Une séance commencée **avant** le lot (ancien `ppl_active_session`) se restaure et se termine correctement.
- 10 allers-retours au premier plan pendant le repos : dérive de moins de 1 s.

**Risques** : la migration de l'historique (d'où la copie de sauvegarde et l'idempotence) et les séances en cours à l'ancien format (`baseline` absent, géré à la restauration). Il faut tester sur une **copie** de l'export réel de Maxence.

---

### LOT 2 : Système de design (tokens, composants de base, icônes, formats)

**Objectif.** Une seule grammaire visuelle iOS, la même en clair et en sombre. Toutes les corrections suivantes s'appuient dessus.

**Changements**

1. **Tokens.** Un seul bloc `:root` / `body.light`, qui remplace l.4-29 et le 2e bloc l.800-811.

| Token | Sombre | Clair |
|---|---|---|
| `--bg` (fond groupé) | `#000` | `#F2F2F7` |
| `--cell` | `#1C1C1E` | `#FFF` |
| `--cell2` | `#2C2C2E` | `#F2F2F7` |
| `--label` | `#FFF` | `#000` |
| `--label2` | `rgba(235,235,245,.6)` | `rgba(60,60,67,.6)` |
| `--label3` | `rgba(235,235,245,.3)` | `rgba(60,60,67,.3)` |
| `--sep` | `rgba(84,84,88,.6)` | `rgba(60,60,67,.29)` |
| `--fill` | `rgba(120,120,128,.36)` | `rgba(120,120,128,.2)` |
| `--tint` | `#0A84FF` | `#007AFF` |
| `--green` / `--red` / `--orange` | `#30D158` / `#FF453A` / `#FF9F0A` | `#34C759` / `#FF3B30` / `#FF9500` |
| `--yellow` / `--indigo` / `--teal` / `--purple` | `#FFD60A` / `#5E5CE6` / `#40C8E0` / `#BF5AF2` | `#FFCC00` / `#5856D6` / `#30B0C7` / `#AF52DE` |
| Texte coloré (clair seulement) | = couleur | `--green-text #248A3D`, `--red-text #D70015`, `--orange-text #C93400`, `--gold-text #A05A00` |

   Les **54 couleurs hex en dur** passent sur ces tokens. Une recherche `grep '#[0-9a-f]\{3,6\}' style.css` ne doit plus rien trouver en dehors des blocs de tokens, et il en va de même pour les couleurs injectées en `style=` dans `app.js` (l.954, 1032, 1846, `drawCharts`).

2. **Typographie**
   - `--font: -apple-system, system-ui, sans-serif` et `--font-rounded: ui-rounded, -apple-system, sans-serif` (chronos).
   - Classes `.t-large` 34/41 700, `.t-title1` 28/34 700, `.t-title2` 22/28 700, `.t-title3` 20/25 600, `.t-headline` 17/22 600, `.t-body` 17/22, `.t-callout` 16/21, `.t-subhead` 15/20, `.t-footnote` 13/18, `.t-caption` 12/16.
   - Graisses autorisées : 400, 600 et 700 (300 pour les chronos géants).
   - Classe `.num { font-variant-numeric: tabular-nums }` sur tous les chiffres.
   - Les tailles sont en `rem` dès ce lot (1 rem = 17 px), pour préparer Dynamic Type au lot 6.
   - Aucun champ de saisie sous 16 px (zoom automatique d'iOS).
3. **Espacements et rayons.** Grille de 4 pt (4/8/12/16/20/24/32), marge latérale de 16 px. Rayons `--r-xs 6`, `--r-sm 10`, `--r-md 12`, `--r-lg 16`, `--r-pill 999`.
4. **Surfaces.** On supprime `border` et `box-shadow` sur `.card`, `.exercise-block`, `.stats-card`, `.history-item`, `.settings-group`, `.editor-row` et `.prog-card` : la hiérarchie vient uniquement de `--bg` et `--cell`. On supprime aussi `border-left` sur `.card` et `.history-item` (il provoque l'encoche dans le coin). Si un accent de couleur est nécessaire, utiliser une pastille de 8 px.
5. **Boutons**
   - `.btn--filled` : `var(--tint)`, texte `#fff`, 50 px de haut, rayon 12, 17/600.
   - `.btn--gray` : `var(--fill)` avec un texte `var(--tint)`.
   - `.btn--plain` : texte tint seul.
   - `.btn--destructive` : texte `var(--red)` sur `var(--fill)`.
   - Plus aucun dégradé ni halo. `:active { opacity:.6 }`, sans effet de zoom.
6. **Contrôles iOS réutilisables**
   - `.segmented` : fond `--fill`, rayon 9, padding 2, 32 px de haut, 13/600. Le segment actif est sur `--cell` (sombre : `#636366`), rayon 7, ombre `0 3px 8px rgba(0,0,0,.12)`, avec `aria-pressed`.
   - `.switch` : 51×31, pastille de 27, `--green` quand il est activé, `role="switch" aria-checked`.
   - `.stepper` : un seul conteneur `--fill` de 94×32, « − | + » séparés par 0,5 px `--sep`, zones de tap de 44 px.
   - `.list-inset` : cellules de 44 px minimum, padding 11/16. Le séparateur est un `::before` qui part de `left:16px`. Les en-têtes de section sont en 13/400 majuscules `--label2`, sans espacement des lettres.
7. **Icônes.** Un sprite SVG `<symbol>` dans `index.html`, dans le style SF Symbols (viewBox 24, trait 1,75, bouts arrondis, `currentColor`) : `chevron.left`, `chevron.right`, `chevron.down`, `pencil`, `trash`, `timer`, `plus`, `minus`, `xmark`, `checkmark`, `arrow.clockwise`, `line.3.horizontal`, `flame`, `chart`, `ellipsis`, `gear`, `dumbbell`, `clock.history`, `list.bullet`.
   - Une aide `icon(name, size=22)` renvoie `<svg aria-hidden="true"><use href="#i-name"/></svg>`.
   - On remplace tous les emojis utilisés comme boutons (l.672 ✎, 995-996 ⏱ ✏, 1067, 1113-1117, 1314-1315 ▲▼, 2077-2078 ✏️🗑️, 1593 ↻).
   - Les catégories intégrées sont représentées par une pastille ronde de 28 px de la couleur de la séance, avec l'initiale en 13/700 blanc. Les emojis restent permis **seulement** pour les séances Perso choisies par l'utilisateur, dans un conteneur fixe de 28×28.
8. **Couleurs de catégorie (dans `PROGRAMMES`)**
   - Push, Upper, Chest et Chest & Back : `var(--orange)` ;
   - Pull, Back et Lower : `var(--indigo)` ;
   - Legs et Full Body : `var(--teal)` ;
   - Shoulders et Shoulders & Arms : `var(--yellow)` ;
   - Arms : `var(--purple)`.
   Remplacer `${meta.color}18` (l.1422) par `color-mix(in srgb, ${meta.color} 10%, transparent)`. Le rouge reste réservé au destructif, le vert à la réussite et le bleu aux éléments interactifs.
9. **Formats (français)**
   - Ajouter `nf = new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2})` et l'aide `fmtNum`, utilisée dans `dispW`, `fmtVolume`, `fmtMetric`, `drawCharts` et les séries de l'historique : « 32,5 kg ».
   - `fmtRest` donne « 1:30 », sans zéro devant.
   - Les durées s'écrivent « 42 min » ou « 1 h 09 ».
   - Les dates s'écrivent « Aujourd'hui », « Hier » ou `{weekday:'short', day:'numeric', month:'short'}`, avec l'année seulement si elle n'est pas l'année en cours.
   - Le chrono de séance est en `mm:ss`.
10. **Matériaux translucides.** Prévoir `@supports not (backdrop-filter…)` et `@media (prefers-reduced-transparency: reduce)` pour remplacer `--dlg-bg` par `#2C2C2E` ou `#F2F2F7` opaques.
11. **Petits correctifs**
    - `.settings-group, .settings-section-title { flex-shrink:0 }`.
    - `.date-input { color-scheme: light dark }`, avec `:root { color-scheme: dark }` et `body.light { color-scheme: light }`.
    - Ajouter la règle `.cooldown-btn` (ou la renommer en `.icon-btn`), en 44×44.
    - `.preset-btn--active` passe en `color:#fff` sur `--tint`.
    - Voile de la surcouche de repos : `rgba(0,0,0,.25)` en clair, `.5` en sombre.
    - Un seul nom partout, « MDLF Training », dans `<title>`, le manifest et `apple-mobile-web-app-title`. La signature du bas de l'accueil part dans Réglages › À propos.
    - `applyTheme` aligne `theme-color` sur `--bg` (`#000` ou `#F2F2F7`).

**Fichiers** : `style.css` (presque entièrement réorganisé autour des tokens), `index.html` (sprite, nom), `app.js` (`PROGRAMMES` color/icon, helpers `icon`, `fmtNum`, `fmtRest`, `fmtDuration`, `fmtDate`, `applyTheme`, couleurs injectées).

**Critères d'acceptation**
- Un script calcule le contraste WCAG de chaque texte visible sur les 16 écrans, en clair et en sombre : tout est à 4,5:1 ou plus (3:1 ou plus pour les textes de 18 pt gras et plus).
- Il n'y a plus de point décimal visible (le script cherche `/\d\.\d/` dans `innerText`, sauf dans les champs de saisie).
- Aucun emoji dans un `<button>` intégré : le script cherche `\p{Extended_Pictographic}` dans les boutons, hors séances Perso.
- Réglages sur iPhone SE : aucune ligne coupée, et la hauteur de chaque `.setting-row` est d'au moins 44.
- Les boutons d'année de la vue d'ensemble mesurent 44×44.
- Un ancien `ppl_v2` contenant des séances Perso en hex s'affiche avec ses couleurs d'origine.

**Risques** : régressions visuelles en cascade, qu'on limite avec une comparaison avant/après des captures sur les 16 écrans × 2 thèmes. Le moteur WebKit de Linux n'a ni SF Pro ni `backdrop-filter`, donc la validation finale se fait sur un iPhone réel.

---

### LOT 3 : Architecture, navigation et accueil

**Objectif.** Une hiérarchie iOS : tab bar, pile par onglet, retour système, transitions, défilement conservé, séance en cours joignable depuis n'importe quel onglet, et un accueil qui répond à la question « je fais quoi aujourd'hui ? ».

**Changements**

1. **Routeur**
   - État `nav = { tab: 'train'|'history'|'progress'|'program', stacks: {train:['home'], history:['list'], progress:['list'], program:['list']} }`.
   - `navigate(route, {replace})` fait un `pushState({tab, stack}, '', '#'+tab+'/'+route)`, puis `show(dir)`.
   - Un écouteur `popstate` restaure l'état avec `dir = 'pop'`.
   - Au démarrage, `replaceState` sur `#train`, ou sur `#train/session` si une séance est restaurée.
   - Tous les `data-action="back"` appellent `history.back()`.
   - La variable `view` existante devient une valeur dérivée (`currentRoute()`), ce qui évite de réécrire toutes les fonctions `renderXxx`.
2. **Tab bar** : `<nav class="tabbar" role="tablist">`.
   - Contenu : 4 `<button role="tab" aria-selected>`, chacun avec une icône SVG de 25 px et un libellé 10/500 :
     - **Entraînement** (`dumbbell`) ;
     - **Historique** (`clock.history`) ;
     - **Progrès** (`chart`) ;
     - **Programme** (`list.bullet`).
   - Dimensions et matière : position fixed en bas, hauteur `calc(49px + env(safe-area-inset-bottom))`, fond `color-mix(in srgb, var(--bg) 80%, transparent)` avec `backdrop-filter: saturate(180%) blur(20px)`, filet de 0,5 px `--sep` en haut.
   - Couleurs : onglet actif en `--tint`, inactifs en `#8E8E93`.
   - Toucher l'onglet actif ramène à la racine de sa pile, puis fait `scrollTo({top:0, behavior: reduce ? 'auto' : 'smooth'})`. On supprime `.header-actions` (l.724-747).
   - La tab bar est masquée pendant la séance, qui s'affiche en plein écran.
3. **Défilement au niveau du document.** On retire `#app { overflow:hidden }` (l.47) et le défilement des conteneurs internes. La barre de navigation est en `position: sticky; top:0`, avec padding `env(safe-area-inset-top)`. Le contenu a `padding-bottom: calc(49px + 16px + env(safe-area-inset-bottom))`, plus 64 px quand la mini-barre de séance est visible. **On ne met jamais `overflow:hidden` sur `body`.**
4. **Mémoire du défilement.** On enregistre `scrollMem[routeKey] = scrollY` avant chaque rendu. Une navigation vers l'avant ou un changement d'onglet part de 0 (ou restaure la position de l'onglet). Un retour (`pop`) restaure la position. Une micro-action (monter ou descendre, +/- série, suppression) garde `scrollY` exactement.
5. **Barre de navigation unique** : composant `navBar({title, large, back, right})`.
   - À la racine d'un onglet : un `<h1 class="t-large">` aligné à gauche, et un `IntersectionObserver` qui affiche le titre compact centré 17/600 et le filet quand le h1 sort de l'écran.
   - Dans une vue empilée : bouton retour = chevron 12×21 suivi du titre de l'écran précédent (« ‹ Historique »), en tint, zone de 44 px, avec `aria-label`.
   - Les actions de droite sont du texte tint (« Modifier », « Enregistrer », « OK »). Plus aucun bouton vert ni espaceur `width:40px`.
6. **Transitions**
   - `show(dir)` passe par `document.startViewTransition` si l'API est disponible et que `prefers-reduced-motion` n'est pas actif.
   - Vers l'avant : glissement de 100 % vers la gauche, l'ancien écran partant à -30 % (0,35 s, `cubic-bezier(.2,.8,.2,1)`). Le retour fait l'inverse. Changement d'onglet : fondu de 150 ms.
   - `view-transition-name: tabbar` empêche la tab bar de bouger.
   - L'animation `cardIn` n'est jouée qu'au premier affichage (classe `.first-paint`).
7. **Feuilles modales.** Un composant `sheet({title, cancel:'Annuler', confirm:'OK', body, onConfirm})` :
   - panneau ancré en bas, rayon 16 en haut, poignée de 36×5 `--label3` ;
   - barre « Annuler | Titre | OK » ;
   - fermeture par glissement vers le bas (plus de 120 px, ou vitesse supérieure à 0,5 px/ms) ou par tap sur le fond ;
   - `role="dialog" aria-modal="true" aria-labelledby`.
   Il **remplace toutes les `.modal`** (l.852, 1181, 1202, 1233, 1367) et l'écran Modifier/Ajouter une séance (l.1492).
8. **Modifications non enregistrées.** Chaque feuille d'édition tient un indicateur `dirty`, calculé par comparaison avec un instantané JSON pris à l'ouverture. Sur « Annuler » quand il y a des modifications, afficher `dialog({type:'sheet', actions:[{label:'Ignorer les modifications', style:'destructive'}, {label:'Continuer la modification', style:'cancel'}]})`. Les saisies d'une séance passée sont gardées dans `sessionStorage` (`ppl_add_draft`).
9. **Séance en cours**
   - Elle s'affiche en plein écran et monte depuis le bas.
   - La flèche est remplacée par un `chevron.down` avec `aria-label="Réduire la séance"`.
   - Une **mini-barre** apparaît au-dessus de la tab bar sur tous les onglets :
     - dimensions et style : 56 px de haut, marges de 8 px, rayon 14, fond `--cell2` ;
     - contenu : pastille de catégorie, « Push · 7/21 » en 15/600, chrono `mm:ss` en `.num` `--label2`, compte à rebours du repos s'il tourne, chevron ;
     - le tap fait `navigate('session')` ;
     - pas d'animation de pulsation si `prefers-reduced-motion` est actif.
   - On supprime le bandeau de l'accueil (l.689-704).
10. **Accueil (onglet Entraînement)**
    - Grand titre « Entraînement », avec en sous-titre « Programme PPL » (15 `--label2`).
    - **Carte « Prochaine séance »** : la séance prête dont la dernière réalisation est la plus ancienne, ou une séance jamais faite.
      - Contenu : pastille de 28 px, nom en 28/700, muscles en 15 `--label2`, puis « Dernière fois : mar. 6 oct. · 5,0 t » et un bouton plein « Démarrer Push » de 50 px.
      - Si c'est la séance en cours, la carte affiche « En cours · 12:34 » et le bouton « Reprendre ».
      - Si aucune séance n'est prête, elle affiche « Prochaine séance prête dans 14 h » (sans les secondes) et un bouton gris « Démarrer quand même ».
    - Les autres séances sont dans une liste groupée en cellules de 60 px : pastille, nom 17/600, statut 15 à droite (« Prête » en `--green-text`, ou « dans 1 j 18 h » en `--label2`) avec un anneau SVG de 28 px.
      - Toucher une cellule ouvre une feuille d'actions : « Démarrer », « Passer le délai de récupération », « Voir les exercices », « Annuler ».
    - On supprime les badges « 2e/3e/Dernière », la pastille de délai « 72h ✎ » (déplacée dans Programme › Séance), la pastille programme et le chrono 34/200 qui affiche les secondes. Le compteur de la mise à jour automatique passe à la minute.
    - La série de semaines 🔥 devient une cellule « Régularité · 9 semaines d'affilée › » qui ouvre Progrès › Vue d'ensemble.
11. **Geste de retour depuis le bord (iOS autonome).** Il démarre sur un `touchstart` avec `clientX < 24` quand la pile compte plus d'un écran. Le `touchmove` déplace la vue de `dx` et fait apparaître l'écran précédent (gardé dans un calque instantané). On valide si `dx` dépasse 35 % de la largeur ou si la vitesse dépasse 0,5 px/ms, puis on appelle `history.back()`. Le geste est désactivé pendant la séance et quand un champ a le focus.

**Fichiers** : `app.js` (`render` remplacé par `show`, routeur, `renderDashboard`, `navBar`, `sheet`, mini-barre, tous les en-têtes l.809-816, 1343-1350, 1492-1498, 1538-1545, 1696-1703, 1908-1915, 2103-2114, cas `go-*` et `back`), `style.css` (`.tabbar`, `.navbar`, `.sheet`, `.livebar`, `::view-transition-*`) et `index.html`.

**Critères d'acceptation**
- Pixel 7 : Historique › Détail, puis retour système → Historique. Un deuxième retour → Entraînement. L'app ne se ferme jamais tant que la pile n'est pas vide.
- Historique défilé à 1 500 px › Détail › retour : `scrollY` vaut 1 500 à ±2 px près. Monter ou descendre un exercice dans l'éditeur : `scrollY` ne change pas.
- Séance en cours : la mini-barre est visible dans les 4 onglets et un tap rouvre la séance. Sur l'accueil, la séance en cours affiche « Reprendre ».
- Modifier une séance passée puis Annuler affiche la feuille « Ignorer les modifications », puis on revient à l'Historique.
- Tab bar : 4 boutons, chacun d'au moins 44 pt de haut. Elle ne recouvre jamais le dernier élément de la liste (le script fait défiler jusqu'en bas et compare les rectangles), sur iPhone SE comme sur 13.
- Avec `prefers-reduced-motion`, aucune animation de transition.
- Captures de l'accueil sur iPhone SE et 13 : le bouton « Démarrer » est visible sans faire défiler.

**Risques**
- C'est le plus gros chantier. Pour le limiter, on garde les fonctions `renderXxx` et on n'ajoute qu'une couche de routage autour.
- Le passage au défilement du document change le calcul de `scrollIntoView` dans la séance : à retester au lot 4.
- Le bouton retour de Pixel 7 juste après l'installation.
- Une séance restaurée doit ouvrir `#train/session` avec la bonne pile.

---

### LOT 4 : Séance active, repos et bilan

**Objectif.** Un tap par série dans 80 % des cas, le plan visible, une liste qui reste utilisable pendant le repos, la possibilité de corriger toute erreur, et un moment de récompense à la fin.

**Changements**

1. **Carte d'exercice**
   - Ligne 1 : nom en 17/600 (2 lignes au plus), compteur « 2/4 », bouton `ellipsis` de 44 pt.
   - Ligne 2 : « Record 32,5 × 10 · Repos 1:30 » en 13 `--label2`. Toucher « Repos » ouvre une feuille avec les préréglages 1:00, 1:30, 2:00 et 3:00 et les boutons ±15 s, sans clavier.
   - On supprime l'encart « SÉANCE DU… » à puces et le bouton « ⏱ Repos » de chaque ligne.
   - Un exercice terminé se replie en une ligne de résumé (« 4 × 8 · 32,5 kg ✓ ») qui se déplie au tap.
2. **Tableau des séries**
   - Grille `grid-template-columns: 32px 1fr 1fr 1fr 56px; gap: 8px` avec les colonnes **Série | Préc. | kg | Reps | ✓**. L'unité apparaît une seule fois, dans l'en-tête de colonne.
   - Toutes les séries sont modifiables : on supprime la condition `isActive` (l.971).
   - La série courante (la première non faite) a un fond `color-mix(var(--cat-color) 8%)` et une bordure gauche de 3 px faite avec une ombre intérieure, avec `aria-current="step"`.
   - Champs : `type="text" inputmode="decimal"` pour le poids et `inputmode="numeric"` pour les reps, `width:100%`, hauteur de 48 px au moins, 20 px `.num`, `enterkeyhint="next"`. Leur valeur est celle de la séance précédente (lot 1), et le placeholder vaut « Préc. ».
   - ✓ : un cercle de 32 px dans une zone de tap de 56×48. Il est vide avec un contour `--sep`, puis plein `--green` avec une coche blanche une fois la série validée.
3. **Saisie**
   - Un `focusin` délégué sur `.set-input` appelle `select()`.
   - Entrée dans le champ poids passe au champ reps, Entrée dans le champ reps valide la série.
   - Une saisie de chiffre ne relance pas `render()` : on met à jour le DOM directement.
4. **Suggestion de progression.** Si toutes les séries précédentes ont au moins `ex.repMax ?? 12` reps, afficher la puce « ↑ +2,5 kg » (ou « +5 lb ») à côté du nom. Un tap applique +2,5 kg aux séries non faites, avec un retour haptique.
5. **Pendant la séance**
   - Toucher une série validée la rouvre en édition sur place, avec les champs et le ✓. Cela remplace la modale `renderEditSetModal`.
   - Un balayage vers la gauche sur une série révèle « Supprimer » (seuil de 80 px, bouton rouge de 74 px).
   - Sous chaque exercice, un lien « + Série » de 44 pt ajoute une série avec le dernier poids et les dernières reps.
   - Le menu `⋯` ouvre une feuille avec : « Monter », « Descendre », « Remplacer l'exercice », « Régler le repos », « Relancer le repos », « Retirer l'exercice » (destructif).
   - Après chaque validation, le toast « Série 2 validée · Annuler » reste 4 s. « Annuler » remet `done=false` et arrête le chrono.
6. **Barre de repos non bloquante**
   - Elle est collée en bas, à `bottom: calc(8px + env(safe-area-inset-bottom))`, fait environ 96 px de haut et laisse une marge de 16 px de chaque côté.
   - Contenu : le compte à rebours en `--font-rounded` 34 px `.num`, un anneau de progression, les boutons « −15 s », « +15 s » et « Passer » (44×44 au moins), et la ligne « Ensuite : Développé incliné · S1 · 30 kg × 10 ».
   - Quand elle est visible, le contenu reçoit `padding-bottom: calc(112px + env(safe-area-inset-bottom))`.
   - Toucher la zone du chrono ouvre la feuille détaillée : anneau SVG de 220 px, chiffres 300 72 px `.num` sans espacement des lettres, contrôle segmenté « 1:00 | 1:30 | 2:00 | 3:00 », boutons ronds ±15 s de 56 px, « Passer » en gris. La feuille se ferme par glissement vers le bas ou par tap sur le fond, et sa hauteur est limitée à `calc(100dvh - env(safe-area-inset-top) - 16px)` avec défilement.
   - On supprime le champ « Durée en secondes », la surcouche plein écran par défaut et le libellé « appuyer pour rouvrir ».
   - Pendant la saisie au clavier, la barre se repositionne avec `visualViewport` ou se masque sur `focusin`.
7. **Fin du repos**
   - La barre pulse deux fois en `--cat-color` et affiche « C'est reparti » pendant 2 s. La série suivante est mise en avant et l'écran défile pour la centrer.
   - On supprime le flash blanc plein écran.
   - `audioCtx` est créé ou relancé avec `resume()` au premier tap et sur `visibilitychange`.
   - L'heure de reprise est affichée (« reprise à 18:42 »).
   - L'option du lot 6 permet de faire sonner la fin du repos en mode silencieux.
8. **Défilement vers la série courante.** `scrollToCurrent()` appelle `scrollIntoView({block:'center'})` sur la première série non faite. Elle est lancée à la reprise, après une restauration et après chaque validation, à la place des l.1097-1100.
9. **En-tête**
   - Sous-titre limité à « 4/21 · 12:34 », sur une seule ligne (`nowrap`) en `.num`.
   - Barre de progression de 6 px en `--cat-color`.
   - « Terminer » devient un bouton texte tint semibold, avec une zone de tap de 44 pt.
10. **Bilan de fin (`#train/summary`)**
    - Il s'affiche après l'enregistrement, en plein écran.
    - Contenu :
      - grand titre « Push », avec la date en dessous ;
      - 3 tuiles : durée, volume (Δ par rapport à la même séance la dernière fois, à nombre de séries égal) et séries ;
      - la section « Nouveaux records », chaque ligne marquée d'une médaille SVG `--yellow` ;
      - un tableau par exercice : meilleure série, avec ↑ ou ↓ par rapport à la fois précédente ;
      - le **champ Notes**, déplacé ici depuis l.1040-1046 et enregistré au fil de la frappe ;
      - le bouton plein « Terminé » de 50 px.
    - Retour haptique et son de fin, et un son distinct si un record est battu.
11. **Ajouter un exercice en séance.** Une feuille plein écran avec un champ de recherche (insensible aux accents) sur la bibliothèque (noms de tous les `PROGRAMMES` + `knownExerciseNames` de l'historique, les plus récents d'abord), la ligne « Créer “xxx” » en dernier et l'interrupteur « Ajouter au programme ». Le compteur de séries se met à jour via `textContent`, sans `render()`.

**Fichiers** : `app.js` (renderSession l.940-1080, validateSet, renderRestOverlay l.1107-1147, openRest/clearRest/timerDone l.586-612 et 1149-1290, edit-set, add-session-ex l.2573-2626, finish-session, nouveau `renderSummary`) et `style.css` (l.200-420 réécrits).

**Critères d'acceptation**
- Pré-remplissage correct, un tap sur ✓ : la série est validée, la barre de repos apparaît **et** les champs de la série suivante restent modifiables pendant le repos (le script remplit un champ pendant que le chrono tourne).
- Mesures sur iPhone SE et 13 : ✓ fait au moins 48×48, les champs ont une hauteur d'au moins 44, aucun texte n'est tronqué (`scrollWidth <= clientWidth` sur les champs, unités et noms). « 31,25 » s'affiche en entier.
- La barre de repos ne recouvre jamais la série courante (les rectangles ne se chevauchent pas après `scrollToCurrent`).
- Annuler une validation remet `done=false`. Le balayage supprime une série. « + Série » en ajoute une. « Retirer l'exercice » le retire de la séance, mais pas du programme.
- Après « Enregistrer », le bilan s'affiche avec les records attendus selon le jeu de test. Les notes saisies dans le bilan sont bien dans `data.history[0].notes`.
- Recharger en pleine séance, au 4e exercice : on revient centré sur la série courante, et le repos restant est exact.
- Le delta de volume n'est jamais rouge pendant la séance.

**Risques**
- `ppl_active_session` à l'ancien format (sans `prev`) : on calcule `prev` à la restauration.
- Conflit entre le balayage et le défilement vertical : verrouiller l'axe après 10 px.
- Clavier iOS et éléments fixes : à tester sur un appareil réel.

---

### LOT 5 : Historique, Progrès et Programme

**Objectif.** Des listes compactes qu'on touche pour voir le détail, des graphiques qui répondent au doigt, et toute la configuration réunie dans une seule hiérarchie.

**Changements**

1. **Historique (liste)**
   - Sections par mois avec un en-tête collant.
   - Cellules de 64 px :
     - à gauche, une pastille de 10 px et « Pull » en 17/600 ;
     - à droite, « lun. 12 oct. » en 15 `--label2` ;
     - en dessous, « 6 exercices · 5,7 t · 1 h 17 » en 13 `--label2` ;
     - un chevron.
   - L'heure n'est affichée que si `duration` existe : une séance passée n'a pas d'heure fictive « 12:00 ».
   - Contrôle segmenté de filtre « Toutes / Push / Pull / Legs » et champ de recherche (exercice ou notes).
   - Bouton « + » dans la barre, qui ouvre la feuille Séance passée.
   - Balayage vers la gauche → « Supprimer », puis toast « Séance supprimée · Annuler » pendant 5 s. On ne retire que le nœud concerné, sans re-rendu complet.
   - Pagination : 3 mois, puis le bouton « Afficher plus », et `content-visibility:auto` sur les mois.
   - Une séance d'un autre programme porte la mention « Programme Upper/Lower ».
2. **Historique (détail)**
   - Exercices en deux lignes : le nom en 15/400, puis les séries en 13 `.num` `--label2`. Si le poids ne change pas, il est mis en facteur : « 67,5 kg · 9 · 10 · 6 · 7 ».
   - Les notes s'affichent en dessous.
   - « Modifier » dans la barre ouvre la feuille d'édition du lot 3.
   - « Supprimer la séance » apparaît en rouge en bas, avec une confirmation.
3. **Progrès (racine)**
   - En tête, 3 tuiles : séances du mois, régularité (semaines d'affilée) et record de la semaine.
   - Ensuite une liste groupée par séance (sections Push, Pull, Legs, plus « Autres » pour les exercices ajoutés en cours de séance ou retirés du programme).
   - Cette liste est construite **à partir de `data.history`, tous programmes confondus, regroupés par `exId`**, et non à partir de `prog().exercises`. Ainsi, « l'historique est conservé » reste vrai après la suppression d'un exercice ou un changement de programme.
   - Chaque ligne affiche : nom, dernière valeur, sparkline de 60×24, et tendance « +25 % » en `--green-text` ou `--red-text`. La tendance compare la moyenne des 3 dernières séances à celle des 3 premières.
   - Une ligne « Vue d'ensemble › » mène à la vue d'ensemble.
   - On supprime les 3 niveaux de navigation empilés.
4. **Progrès › Exercice (détail)**
   - Grand titre et contrôle segmenté « Volume | Charge max | 1RM est. », local à l'écran.
   - **Graphique interactif**, sur toute la largeur :
     - `pointerdown` et `pointermove` sélectionnent le point le plus proche et dessinent une ligne verticale avec une bulle « 13 août · 38 kg × 9 · 1,2 t », avec un retour haptique à chaque changement de point ;
     - 3 graduations Y à droite (min, médiane, max) en 11 px `--label2`, et une grille de 0,5 px `--sep` ;
     - axe Y qui part de 0 pour le volume ; pour la charge et le 1RM, axe tronqué mais **gradué** ;
     - segments droits (`lineTo`), sans lissage ; points seulement sur le dernier et le maximum ;
     - étiquettes X espacées d'au moins `measureText + 6` ;
     - couleurs lues avec `getComputedStyle` ;
     - nouveau dessin sur `resize`, `orientationchange` et changement de thème (avec anti-rebond) ;
     - `role="img"` et `aria-label="Volume : de 820 kg le 29 juin à 1,2 t le 8 oct., +42 %"`.
   - « Record 1RM ~50,7 kg » et « Dernière séance ~49 kg » sont libellés comme deux valeurs distinctes. Le PR s'écrit « 38 kg × 10 ».
   - La barre Objectif n'apparaît qu'en mode Charge.
   - Un bouton ⓘ ouvre un `dialog()` qui explique la formule d'Epley (valable jusqu'à 12 reps) et précise que la courbe 1RM se replie sur la charge max au-delà.
   - La liste des séances où l'exercice apparaît se trouve en dessous.
5. **Vue d'ensemble**
   - Calendrier mensuel sur 7 colonnes, avec une pastille de la couleur de séance les jours d'entraînement. On change de mois par balayage horizontal ou avec des chevrons de 44 pt.
   - Histogramme « séances par semaine » sur 12 semaines, avec une ligne d'objectif à 3.
   - Tuiles « volume total », « durée moyenne » et « série en cours ».
6. **Onglet Programme**
   - Une ligne « Programme actif : PPL › » ouvre un sélecteur iOS : liste groupée avec carré de couleur r7 de 28 px, nom 17, une seule ligne de sous-titre et **une coche tint à droite**.
   - Sélectionner un autre programme affiche `confirmSheet('Passer à Upper/Lower ?', 'Ton historique reste disponible.', 'Changer de programme', false)`, puis on reste sur place.
   - On supprime la description en double (l.791-798) et le badge « ACTIF ».
   - La section « Séances » contient une cellule par séance : « 6 exercices · 21 séries ›».
   - Dans Perso, la section « Séances perso » se termine par la cellule « Ajouter une séance » en tint. Elle est visible même quand Perso n'est pas le programme actif.
7. **Programme › Séance**
   - Liste d'exercices : nom sur 2 lignes au plus (`-webkit-line-clamp:2`), « 4 séries · dernier 33,5 kg × 7 » en 13 `--label2`, chevron.
   - Ligne « Récupération : 72 h » (choix 24/48/72/96 h, repris de la pastille de l'accueil).
   - Ligne « Repos par défaut : 1:30 ».
   - Bouton « Ajouter un exercice » qui ouvre la feuille de recherche du lot 4.
   - **Mode Modifier** (bouton dans la barre) : poignée ≡ à droite pour réordonner par glisser avec les pointer events (retour haptique à chaque échange) et pastille rouge ⊖ à gauche qui révèle « Supprimer ».
   - On supprime ▲▼, −/+, le crayon et la poubelle de chaque ligne.
8. **Programme › Exercice** : champ Nom (renommage avec la confirmation du lot 1), stepper Séries (1 à 10), Repos (segmenté + ±15 s), Objectif (décimal, unité en suffixe), « Haut de fourchette de reps » (`repMax`, 12 par défaut), puis « Supprimer l'exercice » en rouge en bas avec le texte « L'historique de cet exercice est conservé ».
9. **Séance Perso** : grille de 12 emojis sportifs à la place du champ libre, pastilles de couleur avec `aria-label` (« Orange »…), Annuler et OK dans la barre, « Supprimer la séance » seul en bas.
10. **Réglages** (bouton dans la barre de Programme)
    - Liste groupée à fond gris.
    - Groupe « Séance » : Repos par défaut ›, Sons, Vibrations, Son en mode silencieux.
    - Groupe « Affichage » : Thème, Unité.
    - Groupe « Données » :
      - « Dernière sauvegarde : il y a 12 jours », avec `data.lastExport` mis à jour à chaque export ; la ligne passe en `--orange-text` au-delà de 14 jours ;
      - Exporter ;
      - Importer ;
      - « Supprimer toutes les données » (destructif, double confirmation).
    - Groupe « À propos » : « MDLF Training · v19 · 45 séances » et « Rechercher une mise à jour ».

**Fichiers** : `app.js` (renderHistory l.2049-2119, renderStats et renderStatsOverview l.1603-1930, drawCharts l.1931-2043, renderProgrammes et renderCustomManager l.785-920, renderEditor l.1293-1398, renderSettings l.1533-1601, cas select-prog, move-*, del-ex, save-ex) et `style.css`.

**Critères d'acceptation**
- Historique avec 44 séances : au moins 7 cellules visibles sur iPhone 13. Les noms d'exercices du détail ne sont pas tronqués sur iPhone SE.
- Un `pointermove` sur le graphique affiche une bulle dont la valeur correspond à `data.history`. Les étiquettes X ne se chevauchent pas (rectangles de `measureText`). Le graphique est redessiné après un `setViewportSize` en paysage.
- Supprimer un exercice du programme : il reste visible dans Progrès › Autres. Après un changement de programme, « Développé couché haltères » garde ses 15 séances.
- Glisser un exercice de la position 1 à la 3 en mode Modifier donne le bon ordre dans `data`.
- Changer de programme passe par une confirmation, et on reste sur l'onglet Programme.
- Sur iPhone SE, le nom de chaque ligne de l'éditeur fait au moins 60 % de la largeur.
- Avec 1 200 séances, le premier affichage de l'Historique prend moins de 100 ms dans WebKit sur PC.

**Risques** : regrouper par `exId` dépend du lot 1. Le glisser sur iOS doit appeler `preventDefault` sur `touchmove` uniquement sur la poignée. La recherche reste locale et ne coûte rien.

---

### LOT 6 : Accessibilité, Dynamic Type et finitions de bord

**Objectif.** Une séance qu'on peut mener entièrement avec VoiceOver, une app qui respecte la taille du texte iOS, la réduction des animations et de la transparence, le paysage et les zones sûres.

**Changements**

1. **Libellés VoiceOver**
   - Tous les `<svg>` portent `aria-hidden`.
   - Bouton retour : `aria-label="Retour"`, ou le nom de l'écran précédent.
   - Champs : « Charge série 2, Développé couché, en kg » et « Répétitions série 2 ».
   - ✓ : « Valider la série 2 ».
   - Série validée : `aria-label="Série 1 validée, 37 kilos, 10 répétitions"`.
   - Repos : « Moins 15 secondes », « Plus 15 secondes », « Passer le repos ».
   - Poignée : « Réordonner Développé couché ».
   - Les emojis sont enveloppés dans `<span aria-hidden="true">`.
   - `.prog-card` et `.rest-mini` deviennent de vrais `<button>`.
2. **Dialogues et feuilles**
   - Au départ, on retient l'élément qui a ouvert le dialogue (`opener`).
   - Pendant l'ouverture : `$('#app').inert = true`, focus sur le titre ou le premier contrôle, `aria-labelledby` et `aria-describedby`, fermeture avec Échap.
   - À la fermeture : `inert = false`, puis `opener.focus()`.
3. **Annonces.** Ajouter `#sr-polite` et `#sr-assert` en `aria-live` (classe `.visually-hidden`).
   - Les toasts y sont recopiés, et un toast d'erreur reste au moins 4 s.
   - Le repos n'annonce que des jalons : « 30 secondes », « 10 secondes », puis « Repos terminé, série 3 de Développé couché ».
   - `.rest-timer` est en `role="timer" aria-live="off"`.
4. **Dynamic Type**
   - `html { font: -apple-system-body }`, toutes les tailles en `rem` (préparé au lot 2), et plus de largeurs fixes en px sur les textes.
   - Au-delà de `1.3rem`, la grille des séries passe sur 2 lignes (`@container` ou media query sur la taille de police calculée).
   - On retire `user-scalable=no` (index.html l.5).
   - Test à AX5 sur un appareil réel.
5. **Cibles tactiles.** Règle commune : `min-width:44px; min-height:44px`. On agrandit la zone de tap des petits visuels avec `::after { inset:-8px }`. Le script parcourt tous les `button`, `[role=button]` et `input`, et aucun ne doit mesurer moins de 44×44.
6. **Réduction des mouvements.** `const reduce = matchMedia('(prefers-reduced-motion: reduce)')` :
   - `scrollIntoView` passe en `behavior:'auto'` ;
   - la pulsation de fin de repos devient une couleur fixe ;
   - pas de transitions de vues ;
   - pas de point pulsé.
7. **Paysage et zones sûres**
   - Barres, listes et feuilles reçoivent `padding-left: max(16px, env(safe-area-inset-left))`, et l'équivalent à droite.
   - Feuille de repos en paysage (hauteur de 500 px au plus) : 2 colonnes, chrono de 48 px.
8. **Barre d'état et thème**
   - On garde le choix de la meta au lancement (déjà en place).
   - Quand on change de thème pendant que l'app tourne, on met à jour la meta (prise en compte au lancement suivant) et on affiche une fois le toast « La barre d'état s'adaptera au prochain lancement ».
   - En mode Auto, on ne bascule pas le thème pendant une séance active : on attend la fin de la séance.
9. **Son en mode silencieux (option, désactivée par défaut).** `navigator.audioSession.type = 'transient'` au premier geste. Avant de publier, valider sur l'iPhone que la musique de l'utilisateur est seulement baissée (ducking) et non coupée. Sinon, retirer l'option.
10. **Performances**
    - Calculer `sessionVolume` une seule fois par élément et `computeStreak()` une seule fois par rendu.
    - Dans la séance, mettre à jour seulement le nœud modifié lors d'une validation.

**Critères d'acceptation**
- Arbre d'accessibilité Chromium : aucun bouton ni champ sans nom, aucun nom égal à un symbole (« ✓ », « — », « ✕ »).
- Feuille « Terminer » ouverte : `document.activeElement` est dans la feuille et `#app.inert` vaut true. Après fermeture, le focus revient sur « Terminer ».
- `#sr-polite` contient « Repos terminé… » à la fin d'un repos.
- Police racine forcée à 28 px (simulation de Dynamic Type) : aucun débordement horizontal sur iPhone SE (`scrollWidth <= innerWidth` sur toutes les vues).
- 0 cible sous 44×44.
- iPhone 13 en paysage : la feuille de repos est entièrement visible et le bouton « Réduire » est accessible.

---

## 4. Ce que j'écarte volontairement

| Proposition | Raison |
|---|---|
| Pavé numérique intégré avec `inputmode="none"` (séance) | Il remplace un composant système accessible (VoiceOver, dictée) pour un gain marginal une fois le pré-remplissage corrigé. On fait plutôt sélection au focus, Entrée pour passer au champ suivant, puce de progression et menu ⋯. |
| `audioSession.type='playback'` | Il coupe la musique de l'utilisateur en salle. Il est remplacé par l'option `transient`, à valider. |
| `<video muted loop>` caché pour garder l'écran allumé | C'est une astuce fragile. Le Wake Lock fonctionne dans les apps de l'écran d'accueil depuis iOS 18.4. |
| Confettis en cas de record | Bruit visuel. Le bilan avec médaille, haptique et son distinct suffit. |
| Fond sombre forcé sous la barre d'état en thème clair | Laid. On le remplace par une meta choisie au lancement et un toast d'information. |
| Stepper ±2,5 kg permanent sur chaque ligne de série | Il surcharge une ligne déjà dense. La puce de progression et la saisie avec sélection au focus couvrent le besoin. |
| Bibliothèque d'exercices externe avec images ou animations | Dépendance lourde, poids hors ligne. La bibliothèque reste construite à partir des `PROGRAMMES` et de l'historique. |
| Animation `cardIn` à chaque rendu | Supprimée. Elle n'est gardée qu'au premier affichage. |
| Passage à un framework (React, Lit…) | Contraire à la contrainte vanilla sans build. Le routeur et les composants restent de simples fonctions. |

---

## 5. Limites des PWA sur iOS (impossibles sans app native)

- **Alerte de fin de repos écran verrouillé ou app en arrière-plan.** Le JS est gelé, et il n'existe pas de notification locale programmable. La seule solution serait Web Push avec un serveur, hors périmètre. Ce qu'on fait à la place : Wake Lock, l'heure de reprise affichée, et la mention « Garde l'écran allumé pour être prévenu ».
- **Live Activities, Dynamic Island, widgets et complications Apple Watch** : impossible.
- **Vibrations programmées.** `navigator.vibrate` n'existe pas sur iOS, et l'astuce de l'interrupteur `haptic()` ne marche qu'à la suite d'un geste. Pas de vibration à la fin d'un minuteur.
- **Son en mode silencieux** : il dépend du support de l'Audio Session API par Safari, ce qui reste à vérifier sur l'appareil.
- **Barre d'état** : sa couleur est lue au lancement seulement et ne change pas à chaud.
- **Geste de retour natif** : il n'existe pas dans une app en plein écran sur l'écran d'accueil, d'où l'émulation JS du lot 3, moins fluide qu'UIKit.
- **Persistance.** iOS peut purger le stockage d'un site web inutilisé (moins de risques une fois l'app installée et avec `storage.persist()`). L'export daté reste la seule vraie assurance.
- **SF Pro et SF Symbols.** On les approche par `-apple-system` / `ui-rounded` et un sprite SVG dessiné à la main, sans la typographie optique exacte ni la variété des glyphes.
- **Tests.** Le WebKit de Playwright sous Linux n'a ni SF Pro, ni `backdrop-filter`, ni clavier iOS. Chaque lot doit être validé en dernier sur l'iPhone réel de Maxence : saisie « 22,5 », clavier, haptique, son, barre d'état, glisser.