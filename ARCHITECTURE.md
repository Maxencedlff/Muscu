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
| `account.css` | Compte : calque plein écran (Bienvenue, e-mail, code, pseudo, avatar), boutons de connexion aux chartes Apple et Google (tokens `--siwa-*`, `--gsi-*`), écran Compte, cellule des Réglages, carte de l'accueil |
| `social.css` | Amis : badge de l'onglet, accueil de l'onglet (sans compte, activation), lignes de personnes et petits boutons arrondis, cartes du fil, bouton Bravo, profil d'un autre |
| `coach.css` | Coach : cellule en haut de l'onglet Amis, pastilles de nouveautés, programmes reçus, consignes (Programme › Séance, séance en cours), séances d'un élève, codes d'invitation, saisie des consignes et du commentaire |
| `screens.css` | Écrans à fond groupé (`.view--grouped` : Programme, Progrès, Historique, Réglages) et leur composant de liste groupée (`.group` / `.cell`, seul composant de liste), vignettes « Icône de l'app » (`.app-icons`), accessibilité, paysage, Dynamic Type |

Un renommage de classe touche CSS, gabarits HTML et tests ensemble.

### js/core/

| Fichier | Rôle |
|---|---|
| `util.js` | `uid`, `$`, `esc` (échappement HTML), `localISO`, formats français : nombres (`fmtNum`), durées (`fmtClock`, `fmtRest`, `fmtDuration`), dates (`fmtDate(ts, style)`, `fmtTime`), `icon`, `clone`, `num` (saisie bornée), `normName`, `sameEx`, `plural`, `daysAgo` (jours du calendrier écoulés : « hier », « il y a N jours »), clés d'exercice (`nameKey`, `exKey` ; voir `recordKey`), `entryProg(h)` (programme d'une séance, `ppl` si absent) |
| `dialogs.js` | Annonces VoiceOver (`announce`), `showToast`, `dialog` (alerte et feuille d'actions iOS), gestion du modal (inert + retour du focus), `confirmSheet`, `askNumber`, `askText` |
| `haptics-audio.js` | `haptic`, bips et sons (`beep`, `timerDone`, `validationSound`, `finishSound`, `recordSound`), déverrouillage de l'audio au premier geste |

### js/data/

| Fichier | Rôle |
|---|---|
| `programmes.js` | `PROGRAMMES` (programmes intégrés et exercices par défaut), `exerciseLibrary()` |
| `store.js` | `makeExercise`, `calc1RM`, `setsVolume`, `sessionVolume`, `recomputePRFromHistory`, `lastPerf`, `resolveExId`, `makeDefaultData` (base des migrations), `freshData` (donnée vide au schéma courant : suppression, démarrage à neuf), `sanitizeData` (clés de séance limitées à `SESSION_CAT_RE`, champs d’exercice et séries bornés comme à la saisie), `normalizeData` (migrations), `loadData`, `save`, `latestSessionDate`, `syncTimersFromHistory`, `releaseTimer` ; **charge `data` au chargement** (ou passe en mode secours) |
| `records.js` | Records : `recordLabel` (badge d'une série), `exerciseRecord` (record marquant d'un exercice), `historyBaseline` (records d'avant une séance de l'historique), `recordKey` |
| `accessors.js` | `prog`, silhouette des muscles (`SILHOUETTES`, `bodySilhouette()` : `data.silhouette`, homme si absent), `getCooldown`, `isUserProg`, `userSessions`, `progMeta`, `sessionKeys`, `sessionMeta`, `rawLabel`, `catBadge`, `firstSession`, cumuls de séances (`historyTotals` : mois, année, total), semaine du calendrier (`weekStart`, `addDays`, `dayIndexInWeek`, `weeklySessionCounts` : jours du calendrier, justes aux changements d'heure), unités (`toUnitW`, `fmtW`, `storeW`, `fmtVolume`), `bestSet`, `setTxt` |
| `active-session.js` | `activeSession`, `sessionNotes`, `writeSession(rest)` (écrit la séance et l'état du repos reçu), `restoreSession()` (renvoie `{ rest }` sans relancer le chrono), `computeBaseline`, `sessProg` |
| `measures.js` | `MEASURES` (répétitions, durée `time` en secondes dans `reps`, `cardio` : minutes dans `reps`, km dans `dist`), `measureOf(ex)` (choix enregistré, bibliothèque, puis nom), `measureSetTxt`, `defaultGoal` (objectif d'une série jamais faite : haut de fourchette, 30 s, 20 min). Allure du cardio : `paceKind` (min/km pour la course et la marche, km/h pour le vélo, aucune pour rameur, elliptique, corde), `cardioPace` (bornée : une faute de frappe n'affiche rien), `fmtPace`, `spokenPace`, `setKind(ex)` (allure en cardio, `loadKind` sinon : troisième argument de `measureSetTxt`). Volume en kg et records : répétitions seulement. Poids du corps : `BODYWEIGHT_SHARE` (part soulevée, sources dans le fichier), `loadKind` (charge, lest, aide), `effectiveLoad`, `currentBodyKg` (Santé puis Réglages ; enregistré par séance dans `h.bodyKg`) |
| `health-workouts.js` | Courses et sorties vélo lues dans Santé, logique pure : `validHealthWorkout` (activité connue, au moins 1 min, pas écrit par MDLF), `dedupeHealthWorkouts` (même sortie de l'Apple Watch et de Strava), `loggedInHistory` (déjà notée à la main : séance chronométrée qui la recouvre, ou saisie après coup de durée comparable), `healthCountsForRecovery` (20 min au moins pour compter dans la récupération), `healthWorkoutEntry` (ligne au format d'une séance, id `hk:…`, `isHealthEntry`), `healthHistoryEntries`, `healthEntryLine`. **Jamais dans `data.history`** (copie iCloud, compte : règle 5.1.3) ; lecture et cache dans `apple-services.js` (`healthEntries()`), fusion à l'affichage (Historique) et dans la récupération (`muscleLastWorked`) |
| `exercise-catalogue.js` | `EXERCISE_CATALOGUE` (bibliothèque : nom, muscles principaux et secondaires, matériel `EQUIPMENT`, alias ; tous les exercices de `PROGRAMMES` y figurent), `catalogueEntry(nom)` (nom, alias ou abréviation), `catalogueRank` (mouvement de référence avant ses variantes), `equipmentOf`, `PROGRESSIONS` et `progressionOf` (plus facile / plus dur) |
| `muscles.js` | `MUSCLES` (16 groupes, `minor` pour les petits), `ruleKey` (abréviations de salle développées), recherche `exerciseMatchScore` (début de mot, une faute tolérée, synonymes de muscles), recherche approchée `exercisePartialScore` / `closestExercises` (une partie des mots, quand rien ne les a tous), `similarExercises`, `sameMusclesFirst` (Remplacer : mêmes muscles principaux d'abord), `MUSCLE_RULES` (reconnaissance d'un nom libre par mots-clés, la première règle l'emporte), `musclesOf(nom)`, `musclesVerified(nom)` (exercice de la bibliothèque : muscles vérifiés par défaut, modifiables), `isVerifiedChoice`, `chosenMuscles`, `exerciseMuscles(ex)` (choix de l'utilisateur d'abord, puis bibliothèque, sinon règles du nom), `resetChosenMuscles` (Rétablir, annulable), `musclesLine` |
| `muscle-load.js` | `MUSCLE_SPANS` (semaine, 4 semaines), `muscleSetCounts` (principal 1 série, secondaire ½), `muscleLevel` (paliers 0 / 1–3 / 4–9 / 10+ séries par semaine), `muscleLoad(span)` : séries, paliers, intensités 0..1 et muscles peu travaillés ; `sessionMuscleLevels` / `sessionTopMuscles` : muscles d'une seule séance (image partagée) |
| `app-icons.js` | Marque : `APP_ICONS` (icônes de l'app : id, libellé, jeu d'icônes iOS `asset`, couleurs, flèche de la barre), `DEFAULT_APP_ICON`, `appIconFromNative(nom)` (null ou inconnu : défaut), `nativeAppIconName(id)` (défaut : null), `alternateAppIconNames()`, dessin du signe `appIconGlyph` / `appIconSvg(icône, options)`. Seule source des images de la marque (voir plus bas) |
| `guide.js` | Guide de l'app : `GUIDE_SECTIONS` (7 thèmes, sujets courts : `lead`, 2 à 5 `steps`, `iphone`, `related`, `actions`), `GUIDE_TOPICS`, `guideTopic`, `guideLabels` (libellés de l'app cités entre crochets), `guideSearch` (sans accents, tous les mots). Libellés et actions vérifiés par `tests/unit/guide.mjs` |
| `backup.js` | `importText` (tout vérifié sur une copie ; renvoie `{ ok, reason }` ou `{ ok, count, skipped, theme, previous }`), `undoImport`, `exportData(theme)` (renvoie `true` une fois le fichier remis), `downloadText` |
| `sync.js` | Synchro du compte, logique pure : empreintes (`syncHash`), ce qui part (`planSessionPush`, `sessionPayload` sans poids du corps et avec le nom affiché `label` (rawLabel, jamais stocké : `remoteEntry` le retire à la réception), `hidden` tel quel, `profilePayload` par liste autorisée `SYNC_PROFILE_KEYS`), fusion des séances reçues (`applyRemoteSessions` : modifiée ici → locale gagne ; sans état connu → le compte fait foi ; suppressions reçues → Supprimés récemment) et du profil (`applyRemoteProfile`) |
| `account-auth.js` | Compte, logique pure : premier écran (`firstScreen` : Bienvenue au tout premier lancement seulement ; `accountCardShown`), pseudo (`normalizeUsername`, `usernameProblem`, `USERNAME_RE` identique à la migration, délai de 30 jours), avatar (`AVATAR_EMOJIS` : 30 emojis sans personnage, liste blanche identique au serveur), identités (`identityOf`, `hasApple`, `canUnlink`, `canAddEmail`, `linkedIdentityHoldUntil` : moyen relié depuis moins de 24 h), connexion récente (`lastAuthAt`, `isRecentAuth` : claim amr), erreurs de Supabase → français (`authErrorKind`, `otpErrorKind`, `AUTH_ERROR_TEXT`) |
| `account.js` | Compte facultatif (Supabase ; Apple, Google ou code par e-mail, un seul parcours `finishSignIn`) : session dans le Trousseau, profil public (`accountLoadProfile`, `accountSaveProfile`, `accountUsernameAvailable`), moyens de connexion (`accountLink`, `accountLinkEmailStart/Verify` : comptes sans adresse seulement, `accountUnlink` : Apple révoqué au retrait), nouvelle connexion avant suppression ou ajout d'un moyen (`accountReauthApple/Google/Email*`), `syncNow` (réception, fusion, envoi par lots), état de synchro par compte, `accountForgetDevice` / `accountResetSyncState` avant tout effacement ou import local. Aucun affichage : l'écran s'abonne avec `onAccountChange` |
| `social.js` | Amis (Social V1, contrat `docs/SOCIAL_V1.md`) : appels RPC (`socialRpc`, `socialRefresh`, `socialEnable/Disable`, `socialSearch`, `socialRequestFollow`, `socialCancelFollow`, `socialRespond`, `socialRemoveFollower`, `socialBlock/Unblock`, `socialLoadFeed` par curseur complet, `socialToggleBravo`, `socialLoadMyBravos`) et fonction Edge `report` (`socialReport`) ; nettoyage de ce que renvoie le serveur (`cleanSocialState`, `cleanPerson`, `cleanPublicSession` : liste blanche, `cleanFeedRow`), `socialRelation`, `normalizeSocialQuery`, erreurs traduites (`socialErrorKind`, `SOCIAL_ERROR_TEXT`). Chargé en arrière-plan (connexion, premier plan, ouverture de l'onglet), état « activé » et badge gardés dans `mdlf_social`. Aucun affichage : l'écran s'abonne avec `onSocialChange` |

| `coach.js` | Coach (Coach V1, contrat `docs/COACH_V1.md`) : appels RPC (`coachRefresh`, `coachPreview`, `coachJoin`, `coachLeave`, invitations, `coachLoadSessions` par curseur, `coachMarkSeen`, `coachSetNote`, `coachSendProgramme`, `coachMarkInboxSeen`), nettoyage strict de ce que renvoie le serveur (`cleanCoachState`, `cleanCoachSessionRow`, `cleanSentProgramme`, `cleanInbox`), format d'envoi (`programmeToSent` : consignes et supersets), import et mise à jour d'un programme reçu (`importCoachProgramme` : id `u_c<8 caractères du coach>_<prog_id>` (`coachLocalId` ; un import plus ancien `u_c<prog_id>` du même coach garde sa place), ce qui permet au coach de ne reconnaître que SES programmes (`coachSentIdOf`), `fromCoach`, identifiants d'exercices gardés par nom dans la même séance, séances retirées par le coach gardées avec `retired: true` pour l'historique et exclues de `sessionKeys` ; `coachProgrammeStatus` : nouveau, mise à jour, modifié par l'élève ; `keepMyCoachProgramme`), séances faites avec mon programme (`coachOwnProgrammeName`). Rôle et badge gardés dans `mdlf_coach`. `cleanConsigne` et `cleanFromCoach` sont dans `store.js` (sanitizeData au chargement). Aucun affichage : l'écran s'abonne avec `onCoachChange` |

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
| `router.js` | Routes paramétrées (`makeRoute`, `routeName`, `routeParams`), cinq onglets (`TABS` : Entraînement, Historique, Progrès, Programme, Amis) et piles d'écrans (`nav`), `currentView()` (et `view` en lecture seule), synchronisation avec l'historique du navigateur (`popstate`, entrées des feuilles), mémoire de défilement, table des écrans (`SCREENS` : `render`, `mount`, `enter`, `leave`), `render()` / `paint()` / `show()` avec transitions, `navBoot()` ; actions `back`, `go-home` |
| `navbar.js` | Tab bar (badge des demandes reçues sur Amis : `updateTabBadge`) et mini-barre de séance (posées une fois hors de `#app`), `navBar()`, titres de retour, grand titre qui se replie |
| `sheet.js` | `sheet()` : feuille modale générique (Annuler / OK, glisser pour fermer) |
| `forms.js` | `flagInvalid`, `weightOk`, `weightMsg` |
| `edge-swipe.js` | Geste de retour depuis le bord gauche (app installée sur iOS) |
| `reorder.js` | Glisser pour réordonner (poignée ≡ du mode Modifier) : `makeReorderable({ view, list, row, handle, onMove })`, utilisé par les exercices d’une séance et les séances d’un programme perso |
| `body-map.js` | `bodyMapHtml(niveaux, options)` : personnage 3D face / dos (images de `img/body/<sexe>/<vue>/`, rendues dans Blender par le dépôt mdlf-perso, `src/export_app.py`), homme ou femme (option `body`, par défaut le réglage `bodySilhouette()`). Base grise + un calque par muscle coloré (`data-muscle`, `data-heat`) : couleur × ombrage du calque (`background-blend-mode: multiply`), découpé par son alpha (`mask-image`), opacité du palier ; `BODY_IMG` (tailles, muscles par vue), `bodyImageUrls()` (listées dans `sw.js`), préchargement au repos ; `bodyMapImage()` (même carte dans un canvas, image partagée), `bodyHeatOpacity`, `bodyMapColors()`, `silhouetteSegmentedHtml()` (choix Femme / Homme) |
| `medal.js` | Médaille de record : `MEDAL_PATHS` (tracés partagés avec l'image de partage) et `medalSvg(taille)` |

### js/features/

| Fichier | Rôle |
|---|---|
| `dashboard.js` | Accueil : prochaine séance, récupération par muscle (`catStatus` : délai de la séance pour la force, 24 h au plus pour un muscle travaillé en cardio, `CARDIO_RECOVERY_H`), autres séances, carte « Cette semaine » (anneau, séances du mois et de l'année), démarrage d'une séance (`startSessionFlow`), chronos (`startTicker`) |
| `programme.js` | Onglet Programme, sélecteur de programme, création / renommage / suppression d'un programme perso, `activateProgramme()` |
| `programme-editor.js` | Programme › Séance (liste, mode Modifier, glisser pour réordonner) et Programme › Exercice (brouillon `exDraft`) |
| `custom-session.js` | Séance perso : nom, description, icône, couleur, suppression |
| `session.js` | Séance en cours : démarrage / fin, `persistSession()` (séance et repos, avertissement « stockage plein »), tableau des séries (colonnes Série, Avant, kg / +kg / Aide, Reps / Durée), objectif en gris d'une case vide (`setGoal`, pris à la validation), badges de record, validation et « Annuler » |
| `rest.js` | Repos : mini-barre, feuille détaillée, chrono calé sur une heure de fin, jalons annoncés, `restSnapshot()` / `resumeRest()` pour la séance enregistrée |
| `rest-activity.js` | Live Activity du repos (app iOS) : données envoyées au module natif (`restActivityPayload`, couleur, série suivante), `syncRestActivity()` (via `syncNativeRest()`) / `endRestActivity()` appelés par `rest.js` |
| `session-sheets.js` | Feuilles de la séance (`openSessSheet`), repos d'un exercice, feuille d'ajout / remplacement d'exercice (`openAddExSheet({ target })` : séance en cours, Programme › Séance ou séance passée), menu ⋯, « Comment faire » (`hasHowTo`, `openHowTo` : menu ⋯ ou nom de l'exercice touché sur sa carte) |
| `session-gestures.js` | Balayage d'une série (« Supprimer »), clavier (Entrée, champ actif), recherche de la feuille d'ajout |
| `summary.js` | Fin de séance (« Terminer » : enregistrement, stockage plein) et bilan |
| `add-session.js` | Séance passée : saisie, modification d'une séance, brouillon en `sessionStorage` (crochets `enter` / `leave` de l'écran), ajout d'exercice par la feuille de recherche commune |
| `app-icon.js` | Réglages › Icône de l'app (app iOS seulement) : `renderAppIconGroup()` (grille de vignettes, `aria-pressed`, coche), action `set-app-icon` (`Native.appIcon.set`), état lu une fois au démarrage |
| `settings.js` | Réglages, import / export (résultat affiché ici : thème, toast « Annuler », date de sauvegarde), suppression des données, recherche de mise à jour |
| `social-ui.js` | Onglet Amis (`friends` : sans compte, activation avec pseudo et case « 15 ans ou plus », puis recherche, demandes et fil), séance d'un ami (`social-session:OWNER:ID`), profil d'un autre (`social-profile:ID`), Gérer (`social-manage`), règles (`social-rules`), signalement (feuille de motifs), et dans Historique › Séance « Masquer à mes abonnés » et les bravos reçus (`historySocialGroup`) |
| `coach-ui.js` | Coach : Réglages › Coach (`coach`), aperçu avant d'accepter (`coach-join:CODE`), cellule « Mes élèves » / « Mon coach » en haut de l'onglet Amis (`coachCellHtml`, sans avoir activé Amis), Mon coach (`coach-mine`), carte de l'accueil (`coachHomeCard`), consignes dans Programme › Séance et dans la séance (repliables), commentaire dans Historique › Séance (`historyCoachGroup`), Mes élèves (`coach-students` : nouvelles séances, invitations), un élève (`coach-student:UID`), une séance (`coach-session:UID:ID`, « Commenter »), envoi d'un programme avec consignes (`coach-send:UID:PROG`). Badge de l'onglet Amis = social + coach (`updateTabBadge`) |
| `account-ui.js` | Compte : cellule en tête des Réglages (avatar et pseudo, ou « Se connecter »), écran Réglages › Compte (`account` : pseudo, avatar, moyens de connexion, sauvegarde, déconnexion, suppression avec nouvelle connexion), carte de l'accueil, `maybeShowWelcome()` au démarrage, choix quand un autre compte se connecte |
| `auth-flow.js` | Calque plein écran du compte (`openAuthFlow({ step, mode })`) : Bienvenue, e-mail, code à 6 chiffres (envoi au 6e chiffre, « Renvoyer » après 60 s), pseudo (« Plus tard » pour un compte neuf), avatar ; modes `signin`, `link`, `reauth`, `profile` |
| `progress.js` | Progrès : tuiles et index des exercices tiré de l'historique |
| `progress-chart.js` | Progrès › Exercice : courbe sur canvas, sélection d'un point au doigt ; cardio : courbes Durée / Distance / Allure (ou Vitesse), meilleure allure et plus longue distance |
| `progress-overview.js` | Progrès › Vue d'ensemble : calendrier du mois, séances par semaine |
| `exercise-howto.js`, `exercise-moves.js` (data) et `exercise-anim.js` (ui) | « Comment faire » : consignes et erreur fréquente des exercices courants (tous ceux des programmes intégrés) ; animation (positions clés, coudes et genoux par cinématique inverse) affichée seulement pour les mouvements `ready`, en attente d'un dessin dans le style de la silhouette |
| `effort.js` (features) et `effort-clock.js` (data) | Chrono d'effort des séries en durée : ▶ à la place du numéro de la série en cours, préparation de 5 s, décompte vers l'objectif (ou chrono libre), exercices à deux côtés (gainage latéral : côté 1, 5 s pour changer, côté 2), puis série validée et repos calé sur la vraie fin. État dans `activeSession.effort` (persisté, repris au rechargement) ; horloge pure `effortClock` testée ; notification de fin d'effort |
| `tempo.js` (data) et `effort-tempo.js` (features) | Tempo des répétitions (descente, pause en bas, montée, pause en haut, ex. 3-1-1) : préréglages, lecture et écriture, durée d'une rep, sens selon l'exercice (tirage = montée d'abord). Le ▶ guide chaque rep au son (« Descends », « Tiens », « Pousse »), s'arrête proprement en arrière-plan et ne compte que les reps complètes ; horloge pure `tempoClock` dans `effort-clock.js` ; `applyTempo` applique un tempo (éditeur de programme et feuille de séance) |
| `supersets.js` (data) et `supersets-ui.js` (features) | Supersets : exercices consécutifs au même identifiant `ss` (2 à 5 : superset, tri-set, circuit). Logique pure (`ssBlocks`, `ssTags`, `ssRounds`, `ssChainAfter`, `ssNextSet`, `ssRegroup`, `ssLeave`, `ssMove`, `ssGather`, `ssNormalize`) ; feuille de choix, regroupement en séance (écrit aussi dans le programme si tous ses exercices en viennent) et dans Programme › Séance. Séance : une carte par groupe, séries tour par tour (`renderGroupCard`), enchaînement sans repos par l'ordre du groupe, repos du dernier exercice en fin de tour (`validateSet`). `ss` suit dans l'historique et le fil des abonnés (migration `20261027000000_supersets.sql`) |
| `prog-share.js` (data) | Partage d'un programme par message : texte lisible (séances, exercices, séries, tempo, repos) envoyé par la feuille de partage. Ni charges, ni records, ni historique. L'import chez un ami viendra avec les comptes et des liens |
| `library.js` | Programme › Bibliothèque (`library`) : recherche, filtre de matériel, sections par zone du corps ; fiche d'un exercice (`library-ex:NOM`) : silhouette des muscles, matériel, mesure, part du poids du corps, progression plus facile / plus dure, lien vers ses progrès |
| `muscles.js` | Muscles des exercices : ligne sous le nom (Programme › Séance, feuille d'ajout), mini-silhouette et pastilles (Programme › Exercice, Progrès › Exercice), feuille « Muscles ciblés » ; carte « Muscles » de Progrès et écran Progrès › Séries par muscle (`stats-muscles`, inscrit dans `SCREENS` depuis ce fichier) |
| `guide.js` | Réglages › Guide de l'app : liste par thème avec recherche (`guide`), page d'un sujet (`guide-topic:ID`, « Voir aussi » remplace le sujet affiché), inscrits dans `SCREENS` depuis ce fichier ; testé par `tests/test_guide.py` |
| `history.js` | Historique : recherche, filtre, mois chargés par paquets, détail, balayage pour supprimer avec « Annuler » ; courses et sorties vélo de Santé mêlées à leur date (filtre « Toutes »), non modifiables |
| `share-stats.js` | Partage de séance, logique pure : `shareStoryStats(entry)` (durée, volume, séries, records, 3 à 5 exercices clés), texte VoiceOver, nom du fichier |
| `share-canvas.js` | Partage de séance, dessin : `drawStory` (story Instagram 1080 × 1920, Canvas 2D, zones sûres), couleurs des tokens, point d'accroche `shareStoryHooks.muscleMap` pour la carte des muscles |
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

### localStorage `ppl_v2` (schéma 4)

```js
{
  schema: 4,
  activeProgramme: 'ppl',                    // id intégré (ppl, upper_lower, fullbody, bro, arnold, custom) ou u_xxxxxxxx
  programmes: {                              // données par programme utilisé
    ppl: {
      exercises: { push: [{ id, name, sets, lastWeight, lastReps, pr: { weight, reps } | null,
                            est1RM, target, rest, repMax, muscles?, consigne? }] },   // consigne : programme reçu d'un coach
      timers:    { push: 1712345678901 | null },   // date de la dernière séance (délai de récupération)
      cooldowns: { push: 72 },                     // heures
      skipped:   { push: 1712345678901 },          // facultatif : « Passer le délai », valable jusqu'à la séance suivante
    },
  },
  customSessions: { cat: { label, icon, desc, color } },          // séances de l'ancien programme « Perso »
  userProgrammes: { u_xxxxxxxx: { name, sessions: { cat: { label, icon, desc, color } }, order: [cat], archived,   // order : ordre des séances (userSessionOrder), seul ordre qui survit au serveur (jsonb trie les clés)
                                 consigne?, fromCoach? } },   // séance { …, retired: true } : retirée par le coach, lue par l'historique, jamais listée   // programme reçu d'un coach : id u_c<8 caractères du coach>_<prog_id>, fromCoach { coachId, name, sentAt, hash, keptAt? }
  defaultRest: 90, unit: 'kg' | 'lbs', soundOn: true, vibrateOn: true,
  bodyWeightKg: 72.5, bodyWeightLog: [{ date, kg }],   // facultatifs : poids saisi et pesées (une par jour, 400 au plus) ; jamais sur le compte (SYNC_LOCAL_ONLY)
  silhouette: 'female' | 'male',             // facultatif : carte des muscles (absent = homme), synchronisé
  lastExport: 1712345678901,                 // facultatif
  history: [{ id, programme, category, date, duration?, notes, hidden?,   // hidden : true = masquée aux abonnés (Amis)
              exercises: [{ exId, name, sets: [{ weight, reps }] }] }],   // triée du plus récent au plus ancien
}
```

- `measure` (facultatif, exercices du programme et de l'historique) : `'reps'`, `'time'` ou `'cardio'` ;
  absent, la mesure vient du nom (`measureOf`). Schéma 4 (bibliothèque du 25/10/2026) : les noms devenus
  cardio (« Trail », « treadmill », « fractionné », « vtt », « home trainer » : `LEGACY_REPS_NAMES`,
  liste figée dans `store.js`) reçoivent `measure: 'reps'` quand ils n'en ont pas, pour qu'une ancienne
  séance « Trail · 10 reps » ne devienne pas « 10 min ». Historique : à chaque nettoyage
  (`cleanHistoryEntry`, aussi pour une séance reçue d'un appareil resté sur une version précédente ;
  elle repart une fois vers le compte) ; programmes : une seule fois, à la migration.
- `exId` relie un exercice de l'historique à l'exercice du programme (`id`), même après un
  renommage ; un exercice inconnu reçoit `'n:' + normName(nom)` (`nameKey`). Ce format ne doit jamais changer :
  records, historique et synchro en dépendent.
- `muscles` (facultatif) : identifiants de muscles choisis dans Programme › Exercice ; absent, les
  muscles viennent du nom (`exerciseMuscles`). Champ additif, ignoré par une version précédente ; un
  identifiant inconnu est ignoré à la lecture.
- Muscles vérifiés : un exercice de la bibliothèque (`musclesVerified`) a par défaut les muscles du
  catalogue. La personne peut les modifier (confirmation « Modifier les muscles vérifiés ? » quand le
  choix s'en écarte pour la première fois) et les rétablir (« Rétablir les muscles par défaut »,
  `resetChosenMuscles`, toast pour annuler). Son choix (`muscles`, `musclesSecondary`, `exerciseMuscles`,
  `exerciseMusclesSecondary`) prime partout, y compris un choix enregistré avant le verrouillage d'une
  version précédente ou sous un nom devenu alias de la bibliothèque. Un choix égal aux muscles vérifiés
  n'est pas gardé. Mêmes clés de synchro qu'avant (profil, fusion par union).
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
- `mdlf_social` : `{ userId, enabled, badge }` du dernier état des Amis lu (onglet et badge justes hors ligne).
- `mdlf_coach_seen` (« vu » à renvoyer après un échec hors ligne), `mdlf_coach_sent` (coach : mes envois par élève, pour « pas encore de séance avec »), `mdlf_coach_lost` (élève retiré : « Tu ne suis plus … », dit une fois), `mdlf_coach_send_draft` (brouillon de l'écran Envoyer).
- `mdlf_coach` : `{ userId, isCoach, hasCoach, badge, badgeCoach, badgeStudent }` du dernier état du coach lu (cellule de l'onglet Amis et badges hors ligne) ; `mdlf_coach_inbox` : `{ userId, coach, inbox }`, dernière boîte de l'élève (programmes reçus, commentaires du coach lisibles hors ligne).
- `ppl_welcome_seen` : l'écran Bienvenue a été montré (posé quel que soit le choix) ; `ppl_account_card_closed` :
  carte « Sauvegarde tes séances sur un compte » fermée. `mdlf_profile` : cache du profil public
  (pseudo, avatar) du dernier compte, pour l'afficher hors ligne. Jamais dans `ppl_v2` (ni synchronisés
  dans `profiles.doc`).
- `sessionStorage.ppl_restored` : le lancement suit une restauration (`Native.restoredAtBoot`).
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
`test_compte.py` simule la coquille iOS et Supabase (`tests/fake_account.py` : même forme de réponses et
mêmes codes d'erreur que supabase-js) pour le compte : Bienvenue, code e-mail, pseudo, avatar, moyens de
connexion, suppression. `test_social.py` couvre les Amis avec le même faux serveur (RPC du social et fonction `report` selon les
règles de `docs/SOCIAL_V1.md`). `test_coach.py` couvre le coach (RPC du coach simulées selon `docs/COACH_V1.md`) : parcours de l'élève et du coach. `test_icone.py` simule la coquille iOS (faux `window.Capacitor` injecté avant le chargement, faux
module `MdlfAppIcon`) : c'est le modèle à suivre pour tester une fonction réservée à l'app. Voir l'en-tête
de `run_all.py` pour les options.

`node tests/unit/run.mjs` lance les tests unitaires de la logique pure (formats, 1RM, nettoyage et
migrations, import, délais de récupération, clés de séance, saisie, programmes perso ; muscles
dans `tests/unit/muscles.mjs`, records et image partagée dans `tests/unit/share.mjs`, allure et entraînements de Santé dans `tests/unit/cardio.mjs`, icône de l'app
et cohérence avec le projet Xcode dans `tests/unit/app-icons.mjs`) : les scripts
de `js/core/` et `js/data/` sont chargés dans un contexte `vm` de Node, sans navigateur, en moins d'une seconde.

### Partage de séance

`tests/test_partage.py` (lancé par `run_all.py`, seul avec `run_all.py partage`) génère l'image depuis
le bilan et depuis l'historique sur les 5 appareils, vérifie son format (PNG 1080 × 1920), l'aperçu
et le partage, et l'écrit dans `$PPL_SCRATCH/shots/partage/` pour la regarder.

La carte des muscles s'accroche par `shareStoryHooks.muscleMap = (entry, stats, palette) => { levels, colors }`
(ou `null`), que `share.js` remplit avec `storyMuscleMap` et dessine avec `bodyMapImage` (canvas, face et
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


## Serveur des comptes (Supabase)

- `supabase/migrations/` : tables `sessions` (une ligne par séance, tombstone `deleted_at`) et `profiles`
  (document du profil partagé), RLS « chacun ses lignes », pas de DELETE côté client, `ping()` pour le
  réveil quotidien (`ota-api/ping.js`, cron Vercel publié avec le site des mises à jour).
- `supabase/migrations/20261026000000_profils.sql` : profil public `user_profiles` (pseudo unique en
  minuscules, avatar emoji en liste blanche), schéma `private` non exposé (`username_rules` : mots
  réservés et injures ; déclencheur `check_username` : refus, 30 jours entre deux changements), RLS sur sa
  ligne, GRANT par colonne (le client n'écrit que `username` et `avatar_emoji`), `username_available()`.
  Séparé de `profiles.doc` : le pseudo ne fait pas partie du bloc privé synchronisé.
- `supabase/migrations/20261026010000_pseudos_renforces.sql` : mots interdits reconnus aussi en
  chiffres « leet » (`sh1t`, `c0nnard`) et suivis de chiffres, mode `prefix` pour les rôles de l'équipe
  (`admin2`, `support1`), unicité sans points ni tirets bas (`maxdlf` contre `max.dlf`, index
  `user_profiles_username_plain_key`).
- `supabase/functions/delete-account/` : suppression du compte (règle Apple 5.1.1(v)). Règle pure dans
  `delete-policy.js` (même règle côté app : `linkedIdentityHoldUntil`) : preuve Apple (code tout frais
  échangé auprès d'Apple, même identifiant Apple) ou connexion de moins de 10 min (claim `amr`,
  `recent-auth.js`), et aucun moyen de connexion relié depuis moins de 24 h hors création du compte
  (relier Google donne une session « oauth » neuve). Révocation Apple au mieux, après la décision.
  Testé par `tests/unit/account.mjs`.
- `supabase/migrations/20261026050000_social.sql` : Social V1 (contrat `docs/SOCIAL_V1.md`). `user_profiles.social_at`
  (écrit par `social_enable` / `social_disable` seulement), `sessions.done_at` (colonne générée), tables `follows`,
  `blocks`, `bravos`, `reports` sans aucun GRANT client (RLS fermée) : tout passe par les RPC security definer
  (`social_state`, `search_profiles`, `request_follow`, `feed`, `toggle_bravo`…). Règle de visibilité unique
  `private.can_see`, liste blanche `private.session_public`, limites par jour (`private.rate_limit`), fil paginé par
  curseur complet, demandes « fantômes » (`status = 'ghost'`) et verrou par paire de comptes : blocage jamais
  révélé.
- `supabase/functions/report/` : signalement (JWT vérifié, entrée validée par `report-policy.js`, insertion avec la clé
  serveur, 10 par jour imposés par le déclencheur de `reports`, alerte à contact@mdlf.app par Resend, secret
  `RESEND_API_KEY`).
- `supabase/functions/revoke-apple/` : révocation de l'accès Apple après le retrait de l'identité Apple
  (code tout frais, refusée tant qu'Apple est encore relié). `supabase/functions/_shared/` : échange et
  révocation Apple (`apple.ts`), CORS, clés et lecture de l'appelant (`http.ts`). Secrets Apple dans le
  projet Supabase, jamais dans le dépôt.
- Réglages d'authentification (SMTP Resend, modèles du code, Google, liaison manuelle, limites, e-mails
  de sécurité : moyen relié ou retiré, adresse changée) : `scripts/supabase-auth-config.py`, lecture
  seule par défaut (`--notifications` : e-mails de sécurité seulement).
- Dépendances iOS (Swift Package Manager) : figées par
  `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` une fois committé
  (workflow `ios.yml` : artefact `package-resolved`, puis `-onlyUsePackageVersionsFromResolvedFile`).
- `tests/sql/run.sh` : applique toutes les migrations sur un Postgres local jetable (socle Supabase imité
  par `supabase_stub.sql`) puis vérifie RLS, GRANT et déclencheurs (`*_test.sql`). Rien n'est envoyé au projet.
- Google stocke le nom de la personne dans les données d'identité (`identity_data.full_name`) : l'app ne
  le lit jamais.
- Jamais sur le serveur : données Santé, poids du corps, réglages propres à l'appareil (règle 5.1.3).
