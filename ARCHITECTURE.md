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
scripts/              construction de l'app (build-web.mjs, empreinte native par plateforme runtime-version.mjs), mises à jour à chaud, images de la marque (brand-icons.py), seuils du niveau de force (strength-standards.py), gardes des pages juridiques : emplacements à compléter (check-legal-pages.mjs, job deploy, OTA et TestFlight) et pages en ligne avant une OTA ou un envoi TestFlight (check-legal-online.mjs)
privacy.html, mentions-legales.html, cgu.html, cgv.html, legal.css
                      pages juridiques publiques (mdlf.app, publiées par le job deploy via web-public/), sans script ; docs/JURIDIQUE.md
store/                fiche App Store (captures.py) et captures de revue des abonnements (captures_revue.py → docs/revue/)
js/platform/native.js pont vers les modules natifs (iOS, Android) ; sans effet dans le navigateur
ios/                  coquille iOS (Capacitor, modules Swift, extension Live Activity) : IOS.md
android/              coquille Android en préparation (Capacitor, modules Kotlin) : docs/ANDROID.md
```

### css/

| Fichier | Rôle |
|---|---|
| `base.css` | Tous les tokens (seul endroit avec des couleurs en dur, y compris ceux de la navigation), reset, typographie, boutons, contrôles iOS réutilisables (segmenté, interrupteur, stepper, pastilles), chacun défini une seule fois |
| `training.css` | Barre de progression, styles de base de la séance et du repos |
| `views.css` | Séance passée (saisie), état vide de l'accueil, bouton d'ajout d'exercice et notes, toast |
| `components.css` | Badges, bandeau de séance, dialogues iOS, saisie invalide, bannière de mise à jour, écran de secours |
| `navigation.css` | Barre de navigation (avec ses plafonds Dynamic Type), avatar du compte dans la barre, tab bar, mini-barre de séance, feuilles modales, transitions, geste de retour |
| `home.css` | Accueil (onglet Entraînement) : carte de la prochaine séance (« À battre aujourd'hui » et Démarrer dedans), « Cette semaine » (pastilles des jours), « Ensuite » ; une seule couleur d'accent, aucune couleur de séance ; carte resserrée en petite hauteur (iPhone SE) |
| `session.css` | Séance active, repos, bilan |
| `muscles.css` | Silhouette musculaire, pastilles de muscles, carte « Muscles » de Progrès, écran Séries par muscle, feuille « Muscles ciblés » |
| `share.css` | Partage de séance : bouton « Partager ma séance », aperçu de l'image au format 9:16 |
| `recap.css` | Récaps : carte « Ta semaine » de l'accueil, écrans côte à côte (scroll-snap), chiffre énorme en SF Rounded, listes et tuiles du résumé, points et flèches, arrivée légère (coupée avec prefers-reduced-motion) |
| `strength-levels.css` | Niveau de force : échelle à cinq segments des fiches d'exercice, « Nouveau palier » du bilan |
| `account.css` | Compte : calque plein écran (Bienvenue, e-mail, code, pseudo, avatar), boutons de connexion aux chartes Apple et Google (tokens `--siwa-*`, `--gsi-*`), écran Compte, cellule des Réglages, carte de l'accueil |
| `social.css` | Amis : badge de l'onglet, accueil de l'onglet (sans compte, activation), lignes de personnes et petits boutons arrondis, cartes du fil, bouton de réaction, profil d'un autre, Mon profil (carte d'athlète, régularité sur 12 semaines, dernière séance, aperçu des séances, records, activité groupée, « Tout voir ») |
| `strava.css` | Strava : bouton officiel « Connect with Strava » (image de Strava, jamais retouchée), cellule d'envoi d'une séance et lien « View on Strava » en gras |
| `coach.css` | Coach : cellule en haut de l'onglet Amis, pastilles de nouveautés, programmes reçus, consignes (Programme › Séance, séance en cours), séances d'un élève, codes d'invitation, saisie des consignes et du commentaire |
| `paywall.css` | Abonnement : bandeau discret de l'accueil, écran d'abonnement (formules, prix lus chez StoreKit), Réglages › Abonnement, liens vers les conditions et la confidentialité |
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
| `store.js` | `makeExercise`, `calc1RM`, `setsVolume`, `sessionVolume`, `recomputePRFromHistory`, `lastPerf`, `resolveExId`, `makeDefaultData` (base des migrations), `freshData` (donnée vide au schéma courant : suppression, démarrage à neuf), `sanitizeData` (clés de séance limitées à `SESSION_CAT_RE`, champs d’exercice et séries bornés comme à la saisie), `normalizeData` (migrations ; noms dont la mesure a changé gardés en répétitions : `pinLegacyReps` par schéma de bibliothèque, `pinLegacyCardioWords` pour les mots de cardio du schéma 6, règle d'avant figée dans `legacyMeasureByRules`), `loadData` (`loadedSchema` : schéma lu avant migration, pour la séance en cours), `save` (`dataVersion` : +1 à chaque sauvegarde, dans l'empreinte des caches calculés sur l'historique), `latestSessionDate`, `syncTimersFromHistory`, `releaseTimer` ; **charge `data` au chargement** (ou passe en mode secours) |
| `records.js` | Records, un seul calcul qui fait foi : records notés dans la séance (`sessionRecords`, `entryRecords`, `renoteRecords` ; charge, lest, reps à charge égale, aide, temps, durée, distance, allure sur distance fixe ; égaler n'est jamais battre, la première fois et l'échauffement ne comptent pas, jamais le 1RM estimé), séries d'avant résumées par exercice (`sessionPriorOf`), badges en direct calculés par exercice sur ses séries faites, chaque record sur la série qui le fait, jamais sur une série qui en égale une plus tôt dans la séance (`liveExerciseBadges`, `liveSetBadge` : « Record 1RM est. » sur la série du bilan quand l'exercice n'a pas d'autre record, pour soi), série qui fait un record (`notedRecordSet`), 1RM estimé battu pour le bilan (`e1rmRecordSet`), textes (`notedLabel`, `notedValueTxt`), records d'avant les records notés recalculés une fois par version de l'historique (`legacyRecords`, cache lu par `entryRecords`), records récents de Mon profil (`recentRecords` : un par exercice, du plus récent ; `recordGainTxt` : « 2,5 kg », « 1 rep », rien quand mieux veut dire moins). L'ancien calcul (`recordLabel`, `exerciseRecord`, `historyBaseline`, `recordKey`) ne sert plus qu'à `session-review.js` (séances d'anciennes versions reçues par le coach) |
| `accessors.js` | `prog`, silhouette des muscles (`SILHOUETTES`, `bodySilhouette()` : `data.silhouette`, homme si absent), `getCooldown`, `isUserProg`, `userSessions`, `progMeta`, `sessionKeys`, `sessionMeta`, `rawLabel`, `catBadge`, `catDot` (pastille d'une séance de l'onglet Programme), `firstSession`, cumuls de séances (`historyTotals` : mois, année, total), semaine du calendrier (`weekStart`, `addDays`, `dayIndexInWeek`, `weeklySessionCounts` : jours du calendrier, justes aux changements d'heure), Mon profil (`regularity` : moyenne par semaine sur 12 semaines au plus, depuis la première séance ; `firstHistoryDate` : plus ancienne séance ; `memberSince`), palier de la double progression (`bumpLabel` : « 2,5 kg » ou « 5 lb », sans signe ; `bumpStepKg`), unités (`toUnitW`, `fmtW`, `storeW`, `fmtVolume`), `bestSet`, `setTxt` |
| `active-session.js` | `activeSession`, `sessionNotes`, `writeSession(rest)` (écrit la séance et l'état du repos reçu), `restoreSession()` (renvoie `{ rest }` sans relancer le chrono), `computeBaseline`, `sessProg` |
| `measures.js` | `MEASURES` (répétitions, durée `time` en secondes dans `reps`, `cardio` : minutes dans `reps`, km dans `dist`), `measureOf(ex)` (choix enregistré, bibliothèque, puis nom), `measureSetTxt`, `defaultGoal` (objectif d'une série jamais faite : haut de fourchette, 30 s, 20 min). Allure du cardio : `paceKind` (min/km pour la course et la marche, km/h pour le vélo, aucune pour rameur, elliptique, corde), `cardioPace` (bornée : une faute de frappe n'affiche rien), `fmtPace`, `spokenPace`, `setKind(ex)` (allure en cardio, `loadKind` sinon : troisième argument de `measureSetTxt`). Volume en kg : répétitions seulement (records : toutes les mesures, `records.js`). Poids du corps : `BODYWEIGHT_SHARE` (part soulevée, sources dans le fichier), `loadKind` (charge, lest, aide), `effectiveLoad`, `currentBodyKg` (Santé puis Réglages ; enregistré par séance dans `h.bodyKg`) |
| `plates.js` | Disques (logique pure, chargé avant `store.js`) : exercices à barre, barre et disques de la personne (`data.plates`, propre à l'appareil, `cleanPlates`), répartition par côté. Feuille dans `js/features/session-tools.js` |
| `warmup.js` | Échauffement (chargé avant `store.js`) : paliers 40 / 60 / 80 %, `isWarmupSet`, `workSets` (séries de travail : volume, records, séries, récaps, muscles excluent `warmup: true`) |
| `rir.js` | RIR facultatif d'une série validée (`rir` 0 à 4, `cleanRir`, équivalence RPE de Zourdos), réglage `data.rirOn` (appareil), `meanRpe`, `rirLine` |
| `strength-standards.js` | Seuils du niveau de force (`STRENGTH_STANDARDS` : squat, développé couché, soulevé de terre ; hommes et femmes ; par catégorie de poids), **générés** par `scripts/strength-standards.py` depuis l'export public d'OpenPowerlifting. Ne pas modifier à la main |
| `strength-levels.js` | Niveau de force, logique pure et locale (chargé avant `store.js` : `STRENGTH_SEXES` sert au nettoyage) : `STRENGTH_LIFTS` (3 exercices à barre), `STRENGTH_SEXES`, `strengthLiftOf`, `strengthSex` (Réglages › Entraînement › Sexe, null sans réponse ou « Ne pas préciser »), `strengthThresholds` (catégorie de poids), `liftBestE1rm` (90 jours), `strengthStanding`, `sessionStrengthLevels` (bilan, palier franchi). Méthode et source : docs/ENTRAINEMENT.md |
| `import-csv.js` | Import Hevy / Strong, logique pure : lecture CSV, format, dates, correspondance des noms (`matchImportedExercise`, `IMPORT_ALIASES`), conversion (RPE → `rir`, échauffements gardés → `warmup: true`), dédoublonnage, `applyImport`. Formats : docs/IMPORT_CSV.md |
| `import-measures.js` | Import des mesures Hevy (« Export Measurements »), logique pure : `readMeasuresCsv` (poids `weight_kg`/`weight_lbs`, mensurations `<partie>_cm`/`_in`, une valeur par jour), `applyMeasuresImport` (pesées dans `bodyWeightLog`, mensurations dans `bodyMeasures`, jour déjà noté gardé). Format : docs/IMPORT_CSV.md, « Mesures Hevy » |
| `body-measures.js` | Mensurations (`data.bodyMeasures`, LOCAL ONLY dans `SYNC_LOCAL_ONLY`) : mesures, nettoyage, courbes |
| `progress-photos.js` | Photos de progression dans IndexedDB (`mdlf-vault` : lignes chiffrées `{ id, date, iv, enc }` et réglages du coffre ; jamais dans `data` ni dans l'export), ancienne base en clair `mdlf-photos` lue pour la migration puis supprimée, réduction JPEG 1200 px, `photoGapDays` (écart de l'avant / après en jours du calendrier), `photosWipe` appelé par `wipeLocalData` et `vaultReset` |
| `photo-vault.js` | Coffre à photos, sans DOM : clé du coffre dans le trousseau iCloud, une par coffre (`vaultNewId`, identifiant écrit avant la clé), rendue après Face ID ou le code de l'iPhone (`vaultSetup`, `vaultUnlock` via `Native.vault`), importée non extractible et vérifiée par un témoin (`vaultImportKey`, `vaultCreateMeta`, `vaultCheckKey`), photos en AES-GCM (`photoSeal`, `photoUnseal`), session et verrouillage (`vaultLock`, `vaultTouch`, `onVaultLock`), migration (`vaultMigrate`), coffre vidé (`vaultReset`). Indisponible sans le module natif (`vaultAvailable`). Choix, limites et sources : docs/COFFRE_PHOTOS.md |
| `session-review.js` | Relecture de la séance d'un autre (coach, ami), logique pure et comparée à ses seules séances reçues : volume sans poids du corps (`reviewVolume`, `reviewExVolume` : charge notée × reps, lest compris, jamais `currentBodyKg()`), écarts (`volumeDelta` : « = » de −3 à +3 %, `durationDelta` : au-delà de 20 %), références (`prevSameSession` : même programme et même séance, `prevExercise` : dernière fois que l'exercice a été fait, toute séance), `exerciseTrend` (flèche), `reviewRecords` (charge, lest ou reps, ancienne valeur, 3 au plus), `painInNotes` (mots de douleur, sans diagnostic), `reviewSetKind` (jamais le temps aux 500 m : `machine` n'est pas transmis), `sessionReview` |
| `health-workouts.js` | Courses et sorties vélo lues dans Santé, logique pure : `validHealthWorkout` (activité connue, au moins 1 min, pas écrit par MDLF), `dedupeHealthWorkouts` (même sortie de l'Apple Watch et de Strava), `loggedInHistory` (déjà notée à la main : séance chronométrée qui la recouvre, ou saisie après coup de durée comparable), `healthCountsForRecovery` (20 min au moins pour compter dans la récupération), `healthWorkoutEntry` (ligne au format d'une séance, id `hk:…`, `isHealthEntry`), `healthHistoryEntries`, `healthEntryLine`. **Jamais dans `data.history`** (copie iCloud, compte : règle 5.1.3) ; lecture et cache dans `apple-services.js` (`healthEntries()`), fusion à l'affichage (Historique) et dans la récupération (`muscleLastWorked`) |
| `health-export.js` | Écriture des séances dans Santé, logique pure : `healthWorkoutPlan(h, { kg, typicalMs })` découpe une séance en entraînements qui ne se recouvrent pas (cardio fait au chrono d'une machine : son type `HEALTH_MACHINE_ACTIVITY`, à son heure `machine.at` ; le reste en « Musculation » mise en pause pendant ce cardio), énergie active nette `netKcal` ((MET − 1) × kg × h : musculation 5 MET, tapis par les équations de l'ACSM, autres machines Compendium 2011), distance de la série (tapis, vélo, rameur), `part` (identifiant de synchro de Santé `mdlf:<id>:<part>`). Séance sans chrono : cardio seul posé bout à bout, sinon une « Musculation » de la durée habituelle. Envoi : `writeEntryToHealth` (`apple-services.js`) |
| `health-sleep.js` | Sommeil lu dans Santé, logique pure : nuit du jour du réveil (`sleepNightKey` : terminée entre J−1 18 h et J 18 h), union des sources (`unionMs` : Apple Watch et app de sommeil ne comptent pas deux fois), temps au lit si aucune phase « endormi » (`inBedOnly`), `sleepSummary` (nuit d'aujourd'hui, moyenne des 7 dernières à partir de 3), `sleepLine`. **Jamais dans `data`** ni envoyé (règle 5.1.3) |
| `push.js` | Notifications push (contrat `docs/NOTIFICATIONS.md`) : réglages par type (`PUSH_TYPES`, `cleanPushPrefs`, `push_prefs` / `push_set_prefs`), autorisation d'iOS demandée au toucher d'un interrupteur seulement (`pushSetPref`), jeton inscrit (`pushRegisterDevice`, rafraîchi à chaque connexion si un type est allumé) et retiré quand tout est éteint ou à la déconnexion (`pushForgetDevice`, appelé par `account.js` avant la fin de session ; `mdlf_push` garde le dernier jeton, vidé seulement après la réponse sans erreur du serveur), retiré de l'ancien compte à la connexion d'un autre après une session finie hors de l'app (`pushOnAccount` → `push_release`), « Réactiver sur cet iPhone » après une réinstallation (`pushNeedsReactivate`, `pushReactivate`), écran du toucher (`pushTarget`). Aucun affichage : l'écran s'abonne avec `onPushChange` |
| `exercise-catalogue.js` | `EXERCISE_CATALOGUE` (bibliothèque : nom, muscles principaux et secondaires, matériel `EQUIPMENT`, alias ; tous les exercices de `PROGRAMMES` y figurent), `catalogueEntry(nom)` (nom, alias ou abréviation), `catalogueRank` (mouvement de référence avant ses variantes), `equipmentOf`, `PROGRESSIONS` et `progressionOf` (plus facile / plus dur) |
| `muscles.js` | `MUSCLES` (18 groupes, `minor` pour les petits et ceux travaillés surtout en secondaire, jamais « peu travaillés » : lombaires, brachial, avant-bras, obliques, adducteurs… ; `abs` = grand droit et `obliques` = flancs séparés depuis le 30/10/2026, sans migration : un ancien choix `abs` reste valide), `ruleKey` (abréviations de salle développées), recherche `exerciseMatchScore` (début de mot, une faute tolérée, synonymes de muscles), recherche approchée `exercisePartialScore` / `closestExercises` (une partie des mots, quand rien ne les a tous), `similarExercises`, `sameMusclesFirst` (Remplacer : mêmes muscles principaux d'abord), `MUSCLE_RULES` (reconnaissance d'un nom libre par mots-clés, la première règle l'emporte), `musclesOf(nom)`, `musclesVerified(nom)` (exercice de la bibliothèque : muscles vérifiés par défaut, modifiables), `isVerifiedChoice`, `chosenMuscles`, `exerciseMuscles(ex)` (choix de l'utilisateur d'abord, puis bibliothèque, sinon règles du nom), `resetChosenMuscles` (Rétablir, annulable), `musclesLine` |
| `muscle-load.js` | `MUSCLE_SPANS` (semaine, 4 semaines), `muscleSetCounts` (principal 1 série, secondaire ½), `muscleLevel` (paliers 0 / 1–3 / 4–9 / 10+ séries par semaine), `muscleLoad(span)` : séries, paliers, intensités 0..1 et muscles peu travaillés ; `sessionMuscleLevels` / `sessionTopMuscles` : muscles d'une seule séance (image partagée) |
| `recap.js` | Récaps de la semaine, du mois et de l'année, logique pure : périodes (`recapPeriod`, clés `w2026-10-19` / `m2026-10` / `y2026`, `recapPeriodFromKey`), `recapStats` (séances, durée, volume, séries, records battus (`recapRecords` : les records notés de chaque séance, un par exercice, avec leur point de départ dans la période et la courbe en charge ou en lest ; `recapRecordTexts` pour chaque type ; mis en avant : la plus forte hausse en %, dite par `recapBestWhy`), exercice le plus fait et muscle le plus travaillé, jour et moment favoris (heure de début, avec plage et compte), régularité `recapRegularity` (objectif = rythme habituel : médiane des semaines actives des 8 d'avant, 2 au moins ; séances de chaque semaine), paliers de séances (écran pour l'année, mention à l'ouverture sinon), écarts avec la période d'avant, mois de l'année) ; null sans séance. Quand : `recapCardWeek` (dimanche dès 18 h, lundi), `recapCardInfo`, `recapList` (bilan de l'année dès le 1er décembre). Écrans : `recapPages` (chacun se comprend seul, « Mon mois en bref » en dernier), `recapPageAlt`, `recapFileName` |
| `app-icons.js` | Marque : `APP_ICONS` (icônes de l'app : id, libellé, jeu d'icônes iOS `asset`, couleurs, flèche de la barre), `DEFAULT_APP_ICON`, `appIconFromNative(nom)` (null ou inconnu : défaut), `nativeAppIconName(id)` (défaut : null), `alternateAppIconNames()`, dessin du signe `appIconGlyph` / `appIconSvg(icône, options)`. Seule source des images de la marque (voir plus bas) |
| `guide.js` | Guide de l'app : `GUIDE_SECTIONS` (7 thèmes, sujets courts : `lead`, 2 à 5 `steps`, `iphone`, `related`, `actions`), `GUIDE_TOPICS`, `guideTopic`, `guideLabels` (libellés de l'app cités entre crochets), `guideSearch` (sans accents, tous les mots). Libellés et actions vérifiés par `tests/unit/guide.mjs` |
| `backup.js` | `importText` (tout vérifié sur une copie ; renvoie `{ ok, reason }` ou `{ ok, count, skipped, theme, previous }`), `undoImport`, `exportData(theme)` (renvoie `true` une fois le fichier remis), `downloadText` |
| `sync.js` | Synchro du compte, logique pure : empreintes (`syncHash`), ce qui part (`planSessionPush`, `sessionPayload` sans poids du corps et avec le nom affiché `label` (rawLabel, jamais stocké : `remoteEntry` le retire à la réception), `hidden` tel quel, `profilePayload` par liste autorisée `SYNC_PROFILE_KEYS`, dont `appVersion` / `appSeenAt` posés au démarrage par `noteAppVersion` pour savoir côté serveur qui a quelle version), fusion des séances reçues (`applyRemoteSessions` : modifiée ici → locale gagne ; sans état connu → le compte fait foi ; suppressions reçues → Supprimés récemment) et du profil (`applyRemoteProfile`) |
| `account-auth.js` | Compte, logique pure : premier écran (`firstScreen` : Bienvenue au tout premier lancement seulement ; `accountCardShown`), pseudo (`normalizeUsername`, `usernameProblem`, `USERNAME_RE` identique à la migration, délai de 30 jours), avatar (`AVATAR_EMOJIS` : 30 emojis sans personnage, liste blanche identique au serveur), identités (`identityOf`, `hasApple`, `canUnlink`, `canAddEmail`, `linkedIdentityHoldUntil` : moyen relié depuis moins de 24 h), connexion récente (`lastAuthAt`, `isRecentAuth` : claim amr), erreurs de Supabase → français (`authErrorKind`, `otpErrorKind`, `AUTH_ERROR_TEXT`) |
| `account.js` | Verrou de l'abonnement : le serveur refuse l'INSERT d'une séance nouvelle quand `can_write` est faux (`paywall_locked`) ; `isPaywallLocked`, `pushSessionRows` (lot coupé en deux pour isoler les refusées), `accountLockedCount` / `clearPaywallLock` : rien n'est perdu, rien n'est marqué envoyé, le profil part quand même, et le refus n'est pas une erreur de synchro. Compte facultatif (Supabase ; Apple, Google ou code par e-mail, un seul parcours `finishSignIn`) : session dans le Trousseau, profil public (`accountLoadProfile`, `accountSaveProfile`, `accountUsernameAvailable`), moyens de connexion (`accountLink`, `accountLinkEmailStart/Verify` : comptes sans adresse seulement, `accountUnlink` : Apple révoqué au retrait), nouvelle connexion avant suppression ou ajout d'un moyen (`accountReauthApple/Google/Email*`), `syncNow` (réception, fusion, envoi par lots), état de synchro par compte, `accountForgetDevice` / `accountResetSyncState` avant tout effacement ou import local. Aucun affichage : l'écran s'abonne avec `onAccountChange` |
| `age-range.js` | Tranche d'âge partagée par Apple (Declared Age Range, iOS 26, `Native.ageRange`) : réponse nettoyée (`cleanAgeRange`), catégorie (`ageBand` : `adult`, `teen` 15-17 ans, `young` moins de 15 ans, `limited` mineur avec « Limites de communication », null sinon), demande à l'ouverture de l'onglet Amis (`ageRangeCheck`, une fois par lancement, réponse gardée dans `mdlf_age_range` : `ageRangeFresh`), effets lus par les Amis (`socialHiddenByAge`, `socialTeenByAge`). Aucun affichage : l'écran s'abonne avec `onAgeRangeChange`. Détails : IOS.md, « Tranche d'âge » |
| `social.js` | Amis (Social V1, contrat `docs/SOCIAL_V1.md`) : appels RPC (`socialRpc`, `socialRefresh`, `socialEnable/Disable`, `socialSearch`, `socialRequestFollow`, `socialCancelFollow`, `socialRespond`, `socialRemoveFollower`, `socialBlock/Unblock`, `socialLoadFeed` par curseur complet, `socialSetReaction`, `socialLoadMyReactions`, `socialLoadWho`, `socialLoadActivity`, `socialMarkActivitySeen`) et fonction Edge `report` (`socialReport`) ; nettoyage de ce que renvoie le serveur (`cleanSocialState`, `cleanPerson`, `cleanPublicSession` : liste blanche, `cleanFeedRow`), `socialRelation`, `normalizeSocialQuery`, réactions (`REACTIONS`, `cleanReactionCounts`, `reactionsTop`, `withMyReaction`, `tapReaction`), activité (`cleanActivityRow`, `activityText`, `fmtAgo` ; groupée pour Mon profil : `groupActivity`, `reactionsGroupText` « 3 réactions sur Push de vendredi », `sessionDayTxt`, `reactorsLine`), erreurs traduites (`socialErrorKind`, `SOCIAL_ERROR_TEXT`). Chargé en arrière-plan (connexion, premier plan, ouverture de l'onglet), état « activé » et badge gardés dans `mdlf_social`. Aucun affichage : l'écran s'abonne avec `onSocialChange` |

| `comments.js` | Commentaires sur une séance (contrat `docs/SOCIAL_V1.md`, « Commentaires ») : appels RPC par `socialRpc` (`commentsLoad` : 30 par page, `before_id`, relecture 30 s au plus et pas en boucle après une erreur ; `commentsAdd`, `commentsDelete` affiché tout de suite et remis si refusé, `commentsReport` : caché ici pour celui qui signale), nettoyage (`cleanComment`), texte nettoyé et compté comme le serveur (`commentClean`, `commentLength` en caractères, `commentProblem` : 500 au plus). Mots interdits : liste côté serveur seulement. Fils par séance (`commentsOf(owner, id)`), remis à zéro au changement de compte ; un bloqué ou un abonné retiré quitte tous les fils (`commentsForget`, appelé par `forgetPersonActivity`). Aucun affichage : l'écran suit `onSocialChange` |
| `strava.js` | Strava (contrat `docs/STRAVA.md`), **en sommeil pour le lancement** (interrupteur unique `STRAVA_SWITCH.enabled`, livré à `false` : aucune entrée ni aucun appel) : aucun jeton dans l'app ; état par la RPC `strava_status` (`cleanStravaStatus`, cache `mdlf_strava` par compte, vidé à la déconnexion du compte), fonctions Edge `strava-connect` (`stravaConnectUrl` : page d'autorisation ouverte dans Safari par `Native.openOutside`, état relu au retour au premier plan), `strava-export` (`stravaExport`), `strava-disconnect` (`stravaDisconnect`). Logique pure : `stravaExportable` (terminée dans l'app, une série faite, moins de 400 jours, jamais Santé ni une séance importée : `isImportedEntry`), `stravaSport` (type d'activité : `WeightTraining`, ou le cardio d'un seul type, `trainer` sur machine, distance), `stravaDescription` (séries faites, jamais notes, poids du corps ni RIR), `stravaActivity` (corps envoyé). Erreurs → `STRAVA_ERROR_TEXT`. L'écran s'abonne avec `onStravaChange` |
| `coach.js` | Coach (Coach V1, contrat `docs/COACH_V1.md`) : appels RPC (`coachRefresh`, `coachPreview`, `coachJoin`, `coachLeave`, invitations, `coachLoadSessions` par curseur, `coachMarkSeen`, `coachSetNote`, `coachSendProgramme`, `coachMarkInboxSeen`), nettoyage strict de ce que renvoie le serveur (`cleanCoachState`, `cleanCoachSessionRow`, `cleanSentProgramme`, `cleanInbox`), format d'envoi (`programmeToSent` : consignes et supersets), import et mise à jour d'un programme reçu (`importCoachProgramme` : id `u_c<8 caractères du coach>_<prog_id>` (`coachLocalId` ; un import plus ancien `u_c<prog_id>` du même coach garde sa place), ce qui permet au coach de ne reconnaître que SES programmes (`coachSentIdOf`), `fromCoach`, identifiants d'exercices gardés par nom dans la même séance, séances retirées par le coach gardées avec `retired: true` pour l'historique et exclues de `sessionKeys` ; `coachProgrammeStatus` : nouveau, mise à jour, modifié par l'élève ; `keepMyCoachProgramme`), séances faites avec mon programme (`coachOwnProgrammeName`). Rôle et badge gardés dans `mdlf_coach`. `cleanConsigne` et `cleanFromCoach` sont dans `store.js` (sanitizeData au chargement). Aucun affichage : l'écran s'abonne avec `onCoachChange` |
| `coach-share.js` | Partage avec le coach (élève → son coach, `docs/COACH_V1.md` « Partage avec le coach ») : consentement par donnée (`COACH_SHARE_KINDS` : poids ouvert ; sommeil, pas, FC au repos prévus, pas affichés), `coachShareSet` (`student_set_share`), envoi des pesées saisies dans l'app seulement (`sharedWeightsPayload` = `bodyWeightLog`, jamais Santé ; `coachShareUpload`, miroir envoyé quand il change, empreinte dans `mdlf_coach_share`), côté coach `coachLoadWeights` (`coach_student_weights`) et `cleanSessionBodyKg` (bodyKg d'une séance, seulement si partagé). Relu après chaque `coachRefresh` |
| `coach-chat.js` | Messages coach ↔ élève (contrat `docs/COACH_V1.md`, « Messages ») : conversation désignée par une clé (`CHAT_COACH` = avec mon coach, sinon l'identifiant d'un de mes élèves ; `chatArgs`), appels par `coachRpc` (`chatRefresh` après chaque `coachRefresh` : non-lus et derniers messages ; `chatLoad` 50 par page, `chatPoll` : seulement les plus récents que le curseur `c.cursor`, dernier message reçu du serveur, jamais avancé par mon propre envoi ; `chatSend` : écrire ne vaut pas lecture ; `chatMarkRead` jusqu'au curseur, `up_to` ; `chatReport` : `report_chat` puis alerte `socialReportAlert`), nettoyage (`cleanChatMessage`, `cleanChatThreads` : total recalculé), `chatMerge`, `chatDayLabel`, `chatClean` / `chatProblem` (2000 caractères). Total des non-lus gardé dans `mdlf_chat` (badge hors ligne). Serveur sans messagerie (`PGRST202` → `missing`) : `chat.available = false`. Aucun affichage : l'écran suit `onCoachChange` |
| `referral.js` | Parrainage (contrat `docs/PARRAINAGE.md`) : code d'un coach ou d'un ami saisi par l'utilisateur (`referralApply`), état lu à la demande (`referralLoad`, `referralView` : nom du parrain, saisie possible pendant 30 jours), nettoyage (`normalizeReferralCode`, `cleanReferralState`), messages d'erreur. Nom du parrain gardé dans `mdlf_referral`. Affichage : étape `referral` de `auth-flow.js` (lien sous le pseudo d'un compte neuf) et groupe de l'écran Compte (`account-ui.js`) |
| `newsletter.js` | Lettre d'information (contrat `docs/NEWSLETTER.md`) : `NEWSLETTER_CONSENT_VERSION` et `NEWSLETTER_CONSENT_TEXT` (texte exact montré, versionné), état relu chez le serveur (`newsletterRefresh`, `newsletter_state`), `newsletterSet(on)` (`newsletter_subscribe` avec la version seule, horodatage par le serveur ; `newsletter_unsubscribe`, jamais limitée), `cleanNewsletterState` (dont `hasEmail` : compte sans adresse, Apple seul, inscription refusée `no_email`), `newsletterNeedsRefresh` (relire quand le compte change l'écran ouvert), erreurs traduites. Rien gardé sur l'appareil. Aucun affichage : l'écran s'abonne avec `onNewsletterChange` |
| `legal-links.js` | `LEGAL_URLS` : seule liste des adresses des pages juridiques (confidentialité, lettre, mentions, CGU, CGV, remboursement), utilisée par les Réglages, l'écran d'abonnement et la lettre |
| `access.js` | Accès payant (Payant V1, contrat `docs/PAYANT_V1.md`) : lecture du droit d'accès (`my_access` au premier appel, qui crée la ligne sans rien donner, puis `access_state` ; modèle B : l'essai gratuit est l'offre de lancement d'Apple, exposée par `intro_offer` / `intro_until`), nettoyage strict (`cleanAccess` : liste blanche, `server_now` obligatoire, `can_write` forcé à vrai verrou éteint), décisions sur les dates du **serveur** seulement (`canWrite`, `paywallOn`, `accessStatus`, `accessIntroUntil`, `accessUntil`) ; dernier état gardé par compte (`mdlf_access`, verrouillé par `userId`) et valable **7 jours** hors ligne, ou, pour un abonnement et un cadeau datés, jusqu'à la date de fin **du serveur** plus deux jours (un abonné parti trois semaines sans réseau n'est pas coupé) ; au-delà, un droit d'écriture ne vaut plus et un refus reste : une horloge trafiquée ne peut rien ouvrir ; achats par `Native.store` (StoreKit 2 ; produits vendus `PLAN_IDS` de `js/data/plans.js` : les dix abonnements, aucun achat à vie (refusé le 31/10) ; `accessGiftForever` pour un accès à vie offert (statut `gift` sans date de fin) ; environnement StoreKit lu une fois par `accessStoreEnvironment` (TestFlight = Sandbox) : sous TestFlight, aucun code d'offre élève n'est demandé (`kind: 'testflight'`, non résolu, voir `docs/PAYANT_V1.md`), ailleurs un code de Production ; prix lus sous `displayPrice`, essai lu dans l'offre de lancement par `accessTrialOf` (`introEligible`, `offer.paymentMode = 'freeTrial'`), formule en cours par `accessLoadCurrentPlan`, droits en cours sous `entitlements[]`, achat porteur de `appAccountToken`) et vérification par la fonction Edge `verify-purchase` (`accessVerifyPurchase` : `finish()` chez Apple seulement après l'accord du serveur, jamais sur un 503 ni sur `transaction_taken` ; `accessSyncCurrent` rattrape au lancement un achat qu'Apple connaît et pas le serveur ; `accessBuy`, `accessRestore`, `accessRedeemCode`, `accessOnTransaction`) ; codes cadeaux maison saisis dans l'app (`normalizeGiftCode`, `accessRedeemGiftCode` : un refus de `redeem_gift_code` n'est pas une exception, il est dans `{ ok: false, error }`) ; règles du 28/10 : compte obligatoire verrou allumé (`accessSignInRequired`, `accessAnonRefresh` lit la seule ligne `paywall_on` de `app_config` sans compte, gardée dans `mdlf_paywall_anon` ; verrou éteint ou inconnu : rien ne bloque) ; verrou jamais lu sans compte ouvert 7 jours après la première ouverture, une fois le verrou mis en service (`PAYWALL_LAUNCHED`, livré à `false` : jamais bloqué avant) (`accessUnknownExpired`, date `mdlf_first_seen` dans le Trousseau, `accessLoadFirstSeen`). Aucun affichage : l'écran s'abonne avec `onAccessChange` |
| `min-build.js` | Version minimale de l'app (`app_config.min_build`, contrat `docs/PAYANT_V1.md`) : lecture de la seule ligne `min_build` (`minBuildFetch` : `{ ok, min }`, `{ ok: false }` si le serveur est injoignable), valeur nettoyée (`minBuildValue`), décision (`minBuildBlocks` : build native connue ET plus ancienne), lien de mise à jour (`minBuildUpdateUrl` : fiche App Store pour une app de l'App Store, `TESTFLIGHT_URL` sinon). Rien n'est gardé sur l'appareil : hors ligne, jamais bloqué. Aucun affichage (écran dans `js/app/updates.js`) |

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
| `theme.js` | Thème clair / sombre / auto (appliqué au chargement), Dynamic Type (`type-xl` ; l'accueil se redessine quand elle change), bascule différée pendant une séance |
| `router.js` | Routes paramétrées (`makeRoute`, `routeName`, `routeParams`), cinq onglets (`TABS` : Entraînement, Historique, Progrès, Programme, Amis) et piles d'écrans (`nav`), `currentView()` (et `view` en lecture seule), synchronisation avec l'historique du navigateur (`popstate`, entrées des feuilles), mémoire de défilement, table des écrans (`SCREENS` : `render`, `mount`, `enter`, `leave`), `render()` / `paint()` / `show()` avec transitions, `navBoot()` ; actions `back`, `go-home` |
| `navbar.js` | Tab bar (badge des demandes reçues sur Amis : `updateTabBadge`) et mini-barre de séance (posées une fois hors de `#app`), `navBar()`, titres de retour, grand titre qui se replie |
| `sheet.js` | `sheet()` : feuille modale générique (Annuler / OK, glisser pour fermer) |
| `forms.js` | `flagInvalid`, `weightOk`, `weightMsg` |
| `edge-swipe.js` | Geste de retour depuis le bord gauche (app installée sur iOS) |
| `reorder.js` | Glisser pour réordonner (poignée ≡ du mode Modifier) : `makeReorderable({ view, list, row, handle, onMove })`, utilisé par les exercices d’une séance et les séances d’un programme perso |
| `body-map.js` | `bodyMapHtml(niveaux, options)` : personnage 3D face / dos (images de `img/body/<sexe>/<vue>/`, rendues dans Blender par le dépôt mdlf-perso, `src/export_app.py`), homme ou femme (option `body`, par défaut le réglage `bodySilhouette()`). Base grise + un calque par muscle coloré (obliques : calque de face seulement, à part du grand droit) (`data-muscle`, `data-heat`) : couleur × ombrage du calque (`background-blend-mode: multiply`), découpé par son alpha (`mask-image`), opacité du palier ; `BODY_IMG` (tailles, muscles par vue), `bodyImageUrls()` (listées dans `sw.js`), préchargement au repos ; `bodyMapImage()` (même carte dans un canvas, image partagée), `bodyHeatOpacity`, `bodyMapColors()`, `silhouetteSegmentedHtml()` (choix Femme / Homme) |
| `body-tip.js` | Bulle au toucher du personnage 3D : carte d'étiquettes des calques (`bodyHitBuild`, `bodyHitAt`, `bodyHitMap`, tolérance au doigt), placement à côté du muscle sans le cacher (`bodyTipPlace`, `bodyTipSpots`), muscle touché mis en valeur (`bodyTipMarkHtml`), `showBodyTip`, `closeBodyTip` |
| `medal.js` | Médaille de record : `MEDAL_PATHS` (tracés partagés avec l'image de partage) et `medalSvg(taille)` |

### js/features/

| Fichier | Rôle |
|---|---|
| `dashboard.js` | Accueil : prochaine séance, récupération par muscle (`catStatus` : délai de la séance pour la force, 24 h au plus pour un muscle travaillé en cardio, `CARDIO_RECOVERY_H`), carte de la prochaine séance avec ses cibles (`exerciseTarget` : cible, gain, dernière fois), « Ensuite » (autres séances), carte « Cette semaine » (« 2 sur 3 », pastilles des jours, séances du mois et de l'année), place de Démarrer dans le HTML selon l'écran (`heroBtnSpot` : après les cibles, avant sur petite hauteur, sous le nom en très grands caractères ; ordre de lecture = ordre affiché), démarrage d'une séance (`startSessionFlow`), chronos (`startTicker`) |
| `programme.js` | Onglet Programme, sélecteur de programme, création / renommage / suppression d'un programme perso, `activateProgramme()` |
| `programme-editor.js` | Programme › Séance (liste, mode Modifier, glisser pour réordonner) et Programme › Exercice (brouillon `exDraft`) |
| `custom-session.js` | Séance perso : nom, description, icône, couleur, suppression |
| `session.js` | Séance en cours : démarrage / fin, `persistSession()` (séance et repos, avertissement « stockage plein »), tableau des séries (colonnes Série, Avant, kg / +kg / Aide, Reps / Durée), objectif en gris d'une case vide (`setGoal`, pris à la validation), badges de record (`liveSetBadge` contre `livePrior`, js/data/active-session.js : ceux qui seront notés), validation et « Annuler » |
| `rest.js` | Repos : mini-barre, feuille détaillée, chrono calé sur une heure de fin, jalons annoncés, `restSnapshot()` / `resumeRest()` pour la séance enregistrée |
| `rest-activity.js` | Live Activity du repos (app iOS) : données envoyées au module natif (`restActivityPayload`, couleur, série suivante), `syncRestActivity()` (via `syncNativeRest()`) / `endRestActivity()` appelés par `rest.js` |
| `watch.js` | Apple Watch (app iOS) : état envoyé à la montre (`watchState`, `watchBlockReason`) et gestes acceptés (`watchActionFor`), logique pure ; `watchBoot()` appelé par `init.js` une fois la séance restaurée (écouteurs puis premier état ; rien n'est écouté ni envoyé avant), `syncWatch()` appelé par `persistSession()` (rien n'est renvoyé si l'état n'a pas changé), `handleWatchAction()` valide la série, passe le repos ou fait ±15 s comme les boutons de l'iPhone (geste de plus de 30 s refusé). Voir docs/WATCH_WIDGETS.md |
| `home-widget.js` | Widget de l'écran d'accueil et de l'écran verrouillé (app iOS) : instantané `widgetSnapshot()` (prochaine séance, semaine, séance en cours), écrit au démarrage et au passage en arrière-plan s'il a changé |
| `siri.js` | « Démarrer ma séance » (Siri, Raccourcis) : `siriDecision()` (logique pure) puis `startSessionFlow()` ; `siriBoot()` appelé par `init.js` après la restauration de la séance et Bienvenue : il pose l'écouteur (aucune demande suivie avant) et prend la demande laissée au lancement |
| `session-sheets.js` | Feuilles de la séance (`openSessSheet`), repos d'un exercice, feuille d'ajout / remplacement d'exercice (`openAddExSheet({ target })` : séance en cours, Programme › Séance ou séance passée), menu ⋯, « Comment faire » (`hasHowTo`, `openHowTo` : menu ⋯ ou nom de l'exercice touché sur sa carte) |
| `session-tools.js` | Feuilles « Disques » et « Échauffement » de la séance (`js/data/plates.js`, `js/data/warmup.js`) |
| `session-gestures.js` | Balayage d'une série (« Supprimer »), clavier (Entrée, champ actif), recherche de la feuille d'ajout |
| `summary.js` | Fin de séance (« Terminer » : enregistrement, stockage plein) et bilan |
| `add-session.js` | Séance passée : saisie, modification d'une séance, brouillon en `sessionStorage` (crochets `enter` / `leave` de l'écran), ajout d'exercice par la feuille de recherche commune |
| `push-ui.js` | Réglages › Amis et coach › Notifications (`notifications` : trois interrupteurs, iOS refusé → lien vers Réglages de l'iPhone et groupe atténué, build sans le module → « Mets l'app à jour »), cellule des Réglages (`pushSettingsCell`, app iOS et compte seulement), toucher d'une notification (`openPushTarget` : jamais pendant la séance), notification reçue app ouverte → badges relus |
| `app-icon.js` | Réglages › Icône de l'app (app iOS seulement) : `renderAppIconGroup()` (grille de vignettes, `aria-pressed`, coche), action `set-app-icon` (`Native.appIcon.set`), état lu une fois au démarrage |
| `settings.js` | Réglages dans l'ordre des Réglages iOS (Compte, Entraînement, Sons et vibrations, Apparence, Amis et coach, Connexions (Strava), Données, Aide ; groupes iOS Services Apple et Icône de l'app à leur suite), sous-écran Données › Sauvegarde (`backup` : où sont les données, export / import, dernier export : `exportStale` orange seulement sans compte), suppression des données, recherche de mise à jour, groupe « Informations légales » (Confidentialité, Conditions d'utilisation, Conditions de vente, Mentions légales, ouvertes dans Safari par `open-legal`) |
| `import-ui.js` | Réglages › Sauvegarde › Importer depuis une autre app : fichier CSV, aperçu, liens à la main, import annulable |
| `reactions-ui.js` | Réactions : bouton du fil (toucher : 👏 ; appui long : bulle de choix), rangée de la séance d'un ami, résumé « 🔥👏 3 », qui a réagi à mes séances (`whoListHtml`), « 🔥 2 » de l'Historique (`historyReactionsMark`) et son détail (`historyWhoHtml`, `historyReactionsMount`) |
| `comments-ui.js` | Commentaires d'une séance : groupe « Commentaires » (`commentsGroupHtml(owner, id, { writable })` : liste du plus ancien au plus récent, « Afficher les commentaires précédents », saisie avec compteur et bouton rond), menu ⋯ (Signaler puis proposer de bloquer sans quitter la séance, Supprimer avec confirmation pour celui d'un autre), placé dans `social-session` et dans Historique › Séance (`historyCommentsHtml`, `historyCommentsMount`). Brouillon par séance (`commentDrafts`) ; pendant la frappe, seule la liste est redessinée (`refreshCommentsList`, appelé par `onSocialChange`) ; `fitCommentInput` (hauteur du champ, aussi pour les messages) |
| `social-me-ui.js` | Amis › Mon profil (`social-me` : carte d'athlète avec membre depuis, chiffres et régularité ; Mes séances : la dernière en grand, trois en aperçu, « Tout voir » ; Records récents ; Activité groupée, trois lignes puis « Tout voir » ; Gérer) et listes Abonnés / Abonnements (`social-people:followers|following`), bouton avatar de l'onglet avec le point des nouveautés |
| `social-ui.js` | Onglet Amis (`friends` : sans compte, masqué par la tranche d'âge d'Apple (`ageHiddenHtml`), activation avec pseudo et case « 15 ans ou plus », puis recherche, demandes et fil), séance d'un ami (`social-session:OWNER:ID`), profil d'un autre (`social-profile:ID`), Gérer (`social-manage`), règles (`social-rules`), signalement (feuille de motifs), interrupteur « Visible sur mon profil » du bilan (`summarySocialGroup`) et d'Historique › Séance avec les bravos reçus (`historySocialGroup`), œil barré des séances masquées dans la liste (`historyHiddenMark`), note hors ligne au-dessus d'un fil déjà affiché (`feedErrorNote`, reprise par Mon profil) |
| `paywall-ui.js` | Abonnement : bandeau de l'accueil seulement quand l'écriture est refusée (`accessBannerHtml`), écran d'abonnement (`paywall`, paramètre `offer` ou `end` ; accès à vie offert : « Accès offert à vie », rien d'autre à acheter pour soi) avec l'offre lue chez StoreKit (« 3 mois gratuits, puis <prix> », `payOfferText`) et les mentions de la règle 3.1.2 (`payTermsHtml`), « Essai gratuit jusqu'au <date>, puis <prix> » et « Accès offert par ton coach tant qu'il te suit » dans Réglages › Abonnement (`subscription`, cellule `renderAccessSettingsGroup`), « Restaurer mes achats », « J'ai un code » (champ du code cadeau MDLF) et « J'ai un code d'offre Apple » (feuille d'Apple), conditions et confidentialité ; **porte des écritures** `accessGate()` appelée par `startSessionFlow`, `finish-session` (sauf séance commencée avec le droit d'écrire, `activeSession.writeOk` posé par `startSession`), `go-add-session`, `edit-session` et `save-past-session` (Historique, Progrès, profil et export restent ouverts, rien n'est supprimé) ; sans compte et verrou allumé, elle ouvre la connexion (`accessSignInPrompt`, contexte `paywall` d'`openAuthFlow`) |
| `strava-ui.js` | Strava : groupe Réglages › Connexions (`renderConnectionsGroup`), écran `strava` (sans compte, pas relié avec le bouton officiel, relié : prénom, séances envoyées, « Déconnecter Strava » qui révoque et efface), groupe « Strava » du bilan et d'Historique › Séance (`stravaSummaryGroup`, `stravaHistoryGroup` : « Envoyer vers Strava », puis « View on Strava ») redessiné seul (`stravaRefreshBox`) pour ne pas couper la saisie des notes |
| `coach-ui.js` | Coach : Réglages › Coach (`coach`), aperçu avant d'accepter (`coach-join:CODE`), cellule « Mes élèves » / « Mon coach » en haut de l'onglet Amis (`coachCellHtml`, sans avoir activé Amis), Mon coach (`coach-mine`), carte de l'accueil (`coachHomeCard`), consignes dans Programme › Séance et dans la séance (repliables), commentaire dans Historique › Séance (`historyCoachGroup`), Mes élèves (`coach-students` : nouvelles séances, invitations), un élève (`coach-student:UID`), une séance (`coach-session:UID:ID`, « Commenter »), envoi d'un programme avec consignes (`coach-send:UID:PROG`). Badge de l'onglet Amis = social + coach (`updateTabBadge`) |
| `coach-chat-ui.js` | Messages coach ↔ élève : conversation (`coach-chat:@coach` pour l'élève, `coach-chat:<id de l'élève>` pour le coach : bulles, séparateurs de jour, « Afficher les messages précédents », saisie collée au-dessus de la barre d'onglets, menu ⋯ Signaler : `chatReport`, copie des 50 derniers messages gardée côté serveur), relecture toutes les 15 s tant qu'elle est à l'écran et juste après un envoi (crochets `enter` / `leave`, `chatTick`), marquée lue à l'ouverture et à l'arrivée d'un message ; information unique « Ton coach peut t'écrire » dans Mon coach (`chatIntroHtml`, `mdlf_chat_intro_seen`) ; cellule « Messages » (`chatCellHtml`) de Mon coach et de la fiche d'un élève, pastille 💬 N de Mes élèves (`chatBadgeHtml`). Les non-lus s'ajoutent au badge de l'onglet (`updateTabBadge`) et aux pastilles de la cellule coach |
| `coach-share-ui.js` | Partage avec le coach : Réglages › Amis et coach › « Partager avec mon coach » (`coach-share`, élève suivi seulement, tout décoché par défaut, ce que le coach voit dit en clair) ; sur la fiche d'un élève qui partage son poids, sa courbe (`coachWeightGroupHtml`, composant de `progress-chart.js`) |
| `newsletter-ui.js` | Groupe « Lettre d'information » de l'écran Compte (`renderNewsletterGroup`, appelé par `renderAccount`) : interrupteur éteint par défaut, éteint et désactivé tant que l'état du serveur n'est pas connu (« Réessayer » après un échec) ou que le compte n'a pas d'adresse, texte du consentement dessous (`aria-describedby`), lien Confidentialité ; état relu quand le compte change l'écran ouvert (`onAccountChange`) ; actions `newsletter-toggle`, `newsletter-retry`, `newsletter-privacy` |
| `account-ui.js` | Compte : cellule en tête des Réglages (avatar et pseudo, ou « Se connecter »), écran Réglages › Compte (`account` : pseudo, avatar, moyens de connexion, sauvegarde, déconnexion, suppression avec nouvelle connexion), carte de l'accueil, `maybeShowWelcome()` au démarrage, choix quand un autre compte se connecte |
| `auth-flow.js` | Calque plein écran du compte (`openAuthFlow({ step, mode })`) : Bienvenue, e-mail, code à 6 chiffres (envoi au 6e chiffre, « Renvoyer » après 60 s), pseudo (« Plus tard » pour un compte neuf), avatar ; modes `signin`, `link`, `reauth`, `profile` ; contexte `paywall` : Bienvenue dit qu'il faut un compte pour enregistrer (verrou allumé), sans « Commencer sans compte » |
| `progress.js` | Progrès : tuiles et index des exercices tiré de l'historique |
| `progress-chart.js` | Progrès › Exercice : courbe sur canvas, sélection d'un point au doigt ; cardio : courbes Durée / Distance / Allure (ou Vitesse), meilleure allure et plus longue distance |
| `progress-overview.js` | Progrès › Vue d'ensemble : calendrier du mois, séances par semaine |
| `body-measures-ui.js` | Progrès › Mesures : mensurations (courbes via `progress-chart.js`) et l'entrée du coffre à photos |
| `photo-vault-ui.js` | Mesures › Photos (route `photo-vault`) : présentation et création, écran verrouillé (Face ID demandé en entrant et par « Ouvrir »), coffre ouvert (résumé, avant / après au curseur, grille par date), écrans « indisponible », « code de l'iPhone requis » et « illisible pour l'instant » (clé pas encore arrivée par le trousseau iCloud : réessayer, vider en dernier recours), reverrouillage (sortie de l'écran, arrière-plan, une minute d'inactivité), écran de confidentialité (`pv-shield`) |
| `exercise-howto.js`, `exercise-moves.js` (data) et `exercise-anim.js` (ui) | « Comment faire » : consignes et erreur fréquente des exercices courants (tous ceux des programmes intégrés) ; animation (positions clés, coudes et genoux par cinématique inverse) affichée seulement pour les mouvements `ready`, en attente d'un dessin dans le style de la silhouette |
| `effort.js` (features) et `effort-clock.js` (data) | Chrono d'effort des séries en durée : ▶ à la place du numéro de la série en cours, préparation de 5 s, décompte vers l'objectif (ou chrono libre), exercices à deux côtés (gainage latéral : côté 1, 5 s pour changer, côté 2), puis série validée et repos calé sur la vraie fin. État dans `activeSession.effort` (persisté, repris au rechargement) ; horloge pure `effortClock` testée ; notification de fin d'effort |
| `tempo.js` (data) et `effort-tempo.js` (features) | Tempo des répétitions (descente, pause en bas, montée, pause en haut, ex. 3-1-1) : préréglages, lecture et écriture, durée d'une rep, sens selon l'exercice (tirage = montée d'abord). Le ▶ guide chaque rep au son (« Descends », « Tiens », « Pousse »), s'arrête proprement en arrière-plan et ne compte que les reps complètes ; horloge pure `tempoClock` dans `effort-clock.js` ; `applyTempo` applique un tempo (éditeur de programme et feuille de séance) |
| `machine-track.js` (data) et `effort-machine.js` (features) | Chrono des machines de cardio (Escaliers, Tapis de course, Vélo d'appartement, Vélo elliptique, Rameur) : ▶ sur la série, réglage noté au fil de l'effort (−/+ ou saisie directe), bilan puis série validée. Logique pure dans `machine-track.js` (`MACHINES`, `MACHINE_UNITS`, `machineOf`, `machineLogSet`, `machineSummary` : moyenne pondérée par le temps, `machineTxt`, `cleanMachine` : nettoyage à la lecture, chargé avant `store.js`) ; champ `machine` des séries (`{ end, at, lvl, incl…, floors, damper }` ; `at` : départ du chrono, pour Santé), jamais envoyé aux abonnés ni au coach (liste blanche du serveur). Plages et sources : `docs/CARDIO_MACHINES.md` |
| `supersets.js` (data) et `supersets-ui.js` (features) | Supersets : exercices consécutifs au même identifiant `ss` (2 à 5 : superset, tri-set, circuit). Logique pure (`ssBlocks`, `ssTags`, `ssRounds`, `ssChainAfter`, `ssNextSet`, `ssRegroup`, `ssLeave`, `ssMove`, `ssGather`, `ssNormalize`) ; feuille de choix, regroupement en séance (écrit aussi dans le programme si tous ses exercices en viennent) et dans Programme › Séance. Séance : une carte par groupe, séries tour par tour (`renderGroupCard`), enchaînement sans repos par l'ordre du groupe, repos du dernier exercice en fin de tour (`validateSet`). `ss` suit dans l'historique et le fil des abonnés (migration `20261027000000_supersets.sql`) |
| `prog-share.js` (data) | Partage d'un programme par message : texte lisible (séances, exercices, séries, tempo, repos) envoyé par la feuille de partage. Ni charges, ni records, ni historique. L'import chez un ami viendra avec les comptes et des liens |
| `library.js` | Programme › Bibliothèque (`library`) : recherche, filtre de matériel, sections par zone du corps ; fiche d'un exercice (`library-ex:NOM`) : silhouette des muscles, matériel, mesure, part du poids du corps, progression plus facile / plus dure, lien vers ses progrès |
| `muscles.js` | Muscles des exercices : ligne sous le nom (Programme › Séance, feuille d'ajout), mini-silhouette et pastilles (Programme › Exercice, Progrès › Exercice), feuille « Muscles ciblés » ; carte « Muscles » de Progrès et écran Progrès › Séries par muscle (`stats-muscles`, inscrit dans `SCREENS` depuis ce fichier) |
| `muscle-tip.js` | Bulle d'un muscle touché sur la carte de Progrès : séries de la période (moyenne par semaine en « 4 semaines », tronquée au dixième), palier en mots, repère selon le niveau (`muscleTarget`) ; affichage par `body-tip.js` |
| `guide.js` | Réglages › Guide de l'app : liste par thème avec recherche (`guide`), page d'un sujet (`guide-topic:ID`, « Voir aussi » remplace le sujet affiché), inscrits dans `SCREENS` depuis ce fichier ; testé par `tests/test_guide.py` |
| `history.js` | Historique : recherche, filtre, mois chargés par paquets, détail, balayage pour supprimer avec « Annuler » ; courses et sorties vélo de Santé mêlées à leur date (filtre « Toutes »), non modifiables |
| `share-stats.js` | Partage de séance, logique pure : `shareStoryStats(entry)` (durée, volume, séries, records notés de la séance avec la série qui les fait, 3 à 5 exercices clés), texte VoiceOver, nom du fichier |
| `share-canvas.js` | Partage de séance, dessin : `drawStory` (story Instagram 1080 × 1920, Canvas 2D, zones sûres), couleurs des tokens, point d'accroche `shareStoryHooks.muscleMap` pour la carte des muscles |
| `share.js` | Partage de séance, écran : bouton du bilan et d'Historique › Séance, feuille d'aperçu commune `openStoryPreview(state, draw)` (séance, écran d'un récap), partage (`Native.shareImage` dans l'app iOS, `navigator.share` ou téléchargement dans la PWA) |
| `recap-canvas.js` | Récaps, dessin : `drawRecapStory` (un écran en story 1080 × 1920, mêmes aides, zones sûres et signature que `share-canvas.js`), `renderRecapStory` |
| `strength-levels-ui.js` | Niveau de force, écrans : groupe « Niveau de force » (`strengthGroupHtml`, Bibliothèque › Exercice et Progrès › Exercice ; sans sexe indiqué, 1RM estimé sans palier), bilan (`summaryStrengthHtml`), cellule Réglages › Entraînement › Sexe (`strengthSexSettingHtml`), actions `set-strength-sex`, `strength-info` |
| `recap.js` | Récaps, écrans : carte « Ta semaine » de l'accueil (`recapHomeCard`, vue → `ppl_recap_seen`, réglage `data.recapCardOff`), Progrès › Récaps (`renderRecaps`), écrans qui s'enchaînent (`renderRecap` : défilement horizontal à crans, points, flèches, clavier), « Partager » de chaque écran |

### js/app/

| Fichier | Rôle |
|---|---|
| `updates.js` | Service worker : enregistrement, bannière « Nouvelle version disponible » (jamais pendant une séance), `checkForUpdate` ; version minimale de l'app (`checkMinBuild`, règles dans `js/data/min-build.js` : `app_config.min_build` lu au démarrage, au retour au premier plan et au retour du réseau ; écran plein « Mets à jour l'app » qui ne se ferme pas quand la build native est plus ancienne, bouton « Ouvrir l'App Store » ou « Ouvrir TestFlight », app inerte dessous ; serveur injoignable : rien ; jamais pendant une séance ; minimum abaissé : l'écran s'en va ; navigateur : jamais) |
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
  strengthSex: 'male' | 'female' | 'none',   // facultatif : Réglages › Entraînement › Sexe (repères du niveau de force), appareil seulement
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
  activeSession: { category, programme, startedAt, lastEi?,         // (baseline d'une version d'avant : ignoré,
                                                                    //  les badges se comparent à l'historique)
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
- `mdlf_age_range` : `{ status, lowerBound?, upperBound?, communicationLimits?, at }`, dernière réponse de la tranche d'âge d'Apple (appareil seulement, `js/data/age-range.js`).
- `mdlf_coach_seen` (« vu » à renvoyer après un échec hors ligne), `mdlf_coach_sent` (coach : mes envois par élève, pour « pas encore de séance avec »), `mdlf_coach_lost` (élève retiré : « Tu ne suis plus … », dit une fois), `mdlf_coach_send_draft` (brouillon de l'écran Envoyer).
- `mdlf_chat` : `{ userId, unread }`, dernier total des messages non lus (badge de l'onglet Amis hors ligne).
- `mdlf_chat_intro_seen` : `'1'` quand l'élève a fermé l'information « Ton coach peut t'écrire » (ou ouvert la conversation).
- `mdlf_strava` : `{ userId, connected, name, canWrite, exports }` du dernier état de Strava lu (jamais un jeton), dans `CROSS_USER_CACHE_KEYS`.
- `mdlf_push` : `{ userId, token }`, dernier jeton de notification inscrit sur le compte (pour le retirer à la déconnexion, ou de cet ancien compte à la connexion d'un autre).
- `mdlf_coach` : `{ userId, isCoach, hasCoach, badge, badgeCoach, badgeStudent }` du dernier état du coach lu (cellule de l'onglet Amis et badges hors ligne) ; `mdlf_coach_inbox` : `{ userId, coach, inbox }`, dernière boîte de l'élève (programmes reçus, commentaires du coach lisibles hors ligne).
- `mdlf_paywall_anon` : `{ on, at }`, verrou lu sans compte (`js/data/access.js`) ; réglage public, gardé à la déconnexion.
- `mdlf_access` : `{ userId, state }` du dernier droit d'accès lu (`js/data/access.js`) ; valable 7 jours après son `server_now`, effacé à la déconnexion et par `accountForgetDevice` comme les autres caches de compte.
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
règles de `docs/SOCIAL_V1.md`). `test_coach.py` couvre le coach (RPC du coach simulées selon `docs/COACH_V1.md`) : parcours de l'élève et du coach. `test_strava.py` couvre Strava (RPC et fonctions simulées selon `docs/STRAVA.md`) : liaison, envoi, déconnexion, hors ligne. `test_commentaires.py` couvre les commentaires (écrire, mot interdit, Signaler puis Bloquer, Supprimer, Historique, activité, hors ligne) et `test_messages_coach.py` les messages (information unique, non-lus, conversation, relecture pendant la frappe, message de l'autre arrivé juste avant ma réponse, Signaler avec copie et alerte, coach, serveur sans messagerie, lien rompu). `test_parrainage.py` couvre le code de parrainage (création du compte, Réglages › Compte, code inconnu, hors ligne, trop d'essais, compte de plus de 30 jours). `test_payant.py` couvre l'abonnement (`tests/fake_store.py` : RPC d'accès, fonction `verify-purchase` et module StoreKit `MdlfStore` simulés selon `docs/PAYANT_V1.md`, **copiés clé pour clé sur le vrai Swift** et vérifiés par `tests/unit/store-contract.mjs`, avec une horloge de serveur et une horloge d'appareil séparées) : modèle B (offre de lancement lue chez StoreKit, mentions 3.1.2, essai déjà utilisé = prix normal, pas d'essai maison), mode lecture seule, achat, restauration, codes, ancien « Accès offert » refusé, séance commencée avec le droit d'écrire enregistrée malgré la fin de l'accès (grâce), verrou éteint, horloge de l'appareil trafiquée, hors ligne, compte obligatoire verrou allumé (et rien de changé verrou éteint). `test_maj_obligatoire.py` couvre l'écran « Mets à jour l'app » (`app_config.min_build` et build native simulés par `tests/fake_store.py`) : écran plein, lien App Store ou TestFlight, données intactes, build à jour ou minimum à 0, hors ligne jamais bloqué puis réseau revenu, séance en cours, minimum abaissé, navigateur ; `tests/unit/min-build.mjs` vérifie les règles pures et la migration (GRANT et politique `anon`). `test_juridique.py` couvre la lettre d'information (RPC simulées selon `docs/NEWSLETTER.md` : éteinte par défaut, version seule envoyée, désinscription, hors ligne, changement de compte) et les liens des Réglages › Informations légales ; `tests/unit/juridique.mjs` vérifie les pages juridiques (aucun script, liens et ancres, emplacements à compléter listés dans `docs/JURIDIQUE.md`, prix des CGV identiques au contrat du payant). `test_icone.py` simule la coquille iOS (faux `window.Capacitor` injecté avant le chargement, faux
module `MdlfAppIcon`) : c'est le modèle à suivre pour tester une fonction réservée à l'app. `test_watch.py`
fait de même avec de faux modules `MdlfWatch` (gestes gardés jusqu'à l'écoute, comme `retainUntilConsumed`)
et `MdlfShortcuts` : gestes de la montre et demandes de Siri appliqués à la vraie séance. Voir l'en-tête
de `run_all.py` pour les options.

**Date et heure dans les tests.** Un test dont le résultat dépend du jour ou de l'heure (« hier »,
« aujourd'hui », « cette semaine », un écart en jours) fige l'horloge de la page :
`bench.frozen_page(ms, ...)` (`page.clock.install` de Playwright : l'heure part de cet
instant puis avance normalement, minuteries comprises), et calcule ses données depuis ce même instant en
jours du calendrier (`local_ms`, `days_back_ms` de `tests/fixtures.py`), jamais en tranches de 24 h ni
depuis `time.time()`. Les instants choisis sont piégeux exprès (tard le soir, autour du passage à l'heure
d'hiver du 25 octobre 2026) : `test_coach.py`, `test_cardio.py`, `test_mesures.py`, `test_lot5.py`
(records de la semaine) et `test_muscles.py` ; `test_recaps.py` remplace `Date` avant le chargement.

`node tests/unit/run.mjs` lance les tests unitaires de la logique pure (formats, 1RM, nettoyage et
migrations, import, délais de récupération, clés de séance, saisie, programmes perso ; muscles
dans `tests/unit/muscles.mjs`, records et image partagée dans `tests/unit/share.mjs`, allure et entraînements de Santé dans `tests/unit/cardio.mjs`, tempo (notation, sens de départ, phrase d'aide, horloge des phases) dans `tests/unit/tempo.mjs`, icône de l'app
et cohérence avec le projet Xcode dans `tests/unit/app-icons.mjs`, droit d'accès dans `tests/unit/access.mjs`, contrat du module natif StoreKit dans `tests/unit/store-contract.mjs` : il lit `ios/App/App/StorePlugin.swift` et vérifie que chaque clé lue par l'app existe vraiment et que le faux StoreKit n'invente rien, offre de lancement (`introEligible`, `offer`) comprise, aucun achat à vie, méthode `environment()` (seul usage d'`AppTransaction.shared`, jamais `refresh()`) ; ni preuve `appTransaction()` ni « Accès offert » ; garde de l'appelant des fonctions Edge dans `tests/unit/auth-guard.mjs`) : les scripts
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


## Coquilles natives (iOS, Android)

Le même contenu web (`dist/`, `scripts/build-web.mjs`) tourne dans deux coquilles Capacitor. Le web ne
parle au natif que par `js/platform/native.js` (`Native`), qui expose `Native.platform` (`'ios'`,
`'android'`, `'web'`) et coupe sur Android ce qui n'existe que sur iOS (iCloud, Apple Music, icônes
alternatives, compte tant que `MdlfAccount` n'existe pas en Kotlin). Un module qui existe sur les deux
garde le même nom et les mêmes réponses (`MdlfHealth` : HealthKit / Health Connect ; `MdlfLiveActivity` :
Live Activity / notification continue ; `MdlfStore` : StoreKit 2 / Google Play Billing) : les écrans
n'ont pas à connaître le système, sauf pour un libellé (`Native.health.name`). Chaque coquille a son
empreinte native (`scripts/runtime-version.mjs`) : changer Android ne touche jamais aux mises à jour à chaud des
iPhone. Détails : IOS.md et docs/ANDROID.md ; cohérence vérifiée par `tests/unit/android.mjs`.

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
- `supabase/migrations/20261031500000_commentaires.sql` : commentaires sur une séance (`session_comments`, `comment_reports` avec copie du texte, mots interdits `private.comment_words` et mots courants acceptés `private.comment_allowed`, tous sans GRANT client), RPC `list_comments`, `add_comment`, `delete_comment`, `report_comment` (ligne dans `public.reports` pour l'alerte, masqué au 3e signalement), sorte `comment` de `my_activity` et de la pastille. Contrat : `docs/SOCIAL_V1.md`, « Commentaires ». Retour arrière : `supabase/rollback/20261031500000_commentaires_down.sql`.
- `supabase/migrations/20261031510000_chat_coach.sql` : messages coach ↔ élève (`coach_messages`, clé étrangère vers `coach_links` on delete cascade : lien rompu = messages effacés ; marques de lecture dans `coach_links` ; `chat_reports`, copie des messages signalés sans lien vers `coach_links`, gardée 12 mois), RPC `chat_threads`, `chat_messages`, `chat_send`, `chat_mark_read` (`up_to`), `report_chat`. Contrat : `docs/COACH_V1.md`, « Messages ». Retour arrière : `supabase/rollback/20261031510000_chat_coach_down.sql`. Les deux retours arrière sont vérifiés par `tests/sql/rollback_social_check.sh`.
- `supabase/migrations/20261031900000_notifications_push.sql` : notifications push (contrat `docs/NOTIFICATIONS.md`).
  `push_devices` (jeton APNs, un seul compte par jeton), `push_prefs` (trois types, éteints par défaut), file
  `private.push_outbox` remplie par des déclencheurs sur `bravos`, `follows` (`pending` seulement), `coach_notes`,
  `coach_programmes` (accord, appareil, blocage vérifiés ; 24 h sans doublon ; jamais d'échec de l'action
  d'origine). RPC de l'app (`push_register`, `push_unregister`, `push_release`, `push_prefs`, `push_set_prefs`) et de l'envoi,
  service_role seulement (`push_claim`, `push_done`, `push_auth_get` / `push_auth_swap` : jeton du fournisseur APNs
  partagé par les instances, `private.push_apns_auth`). Retour arrière : `supabase/rollback/` (vérifié par
  `tests/sql/rollback_push_check.sh`).
- `supabase/functions/push-send/` : envoi à APNs (HTTP/2, jeton ES256 de la clé .p8), appelé chaque minute par
  pg_cron avec le secret `PUSH_CRON_SECRET` ; règles pures dans `push-policy.js` (`tests/unit/push.mjs`), dont le jeton du fournisseur signé une
  fois pour tous les envois (`providerTokenCache`).
  Mise en service : `docs/BUILD.md`.
- `supabase/functions/report/` : signalement (JWT vérifié, entrée validée par `report-policy.js`, insertion avec la clé
  serveur, 10 par jour imposés par le déclencheur de `reports`, alerte à contact@mdlf.app par Resend, secret
  `RESEND_API_KEY`) ; mode `{ report_id }` : alerte d'un signalement déjà écrit par `report_comment` ou `report_chat`.
- `supabase/functions/revoke-apple/` : révocation de l'accès Apple après le retrait de l'identité Apple
  (code tout frais, refusée tant qu'Apple est encore relié). `supabase/functions/_shared/` : échange et
  révocation Apple (`apple.ts`), CORS, clés et lecture de l'appelant (`http.ts`). Secrets Apple dans le
  projet Supabase, jamais dans le dépôt.
- `supabase/migrations/20261028000000_payant.sql` : Payant V1 (contrat `docs/PAYANT_V1.md`). Tables `entitlements`
  (l'instantané du droit d'accès d'un compte), `entitlement_claims` (registre à vie des transactions Apple :
  `original_transaction_id` unique, une transaction ne sert qu'à un compte), `app_config` (`paywall_on` livré à
  **false**, `trial_days` 90, retiré par la migration suivante) et les codes cadeaux maison (`gift_codes`, `gift_redemptions`), toutes sans GRANT
  client sauf la lecture de `app_config`. Son essai maison (`trial_started_at`, statut `trial`) a été
  retiré par la migration suivante (modèle B) ; l'état qui fait foi est recalculé à chaque lecture
  (`private.access_json`, statuts `gift` > `active` > `coach_team` > `expired` > `none`). RPC client :
  `my_access()`, `access_state()` (ne crée rien), `redeem_gift_code(code)`. Écriture du droit d'accès réservée à
  la clé serveur : `srv_access_purchase` et `srv_access_event`, noyau dans `private`. Un évènement arrivé dans le
  désordre ne coupe pas un abonné (`entitlement_claims.event_at`, date de fin qui ne recule que si Apple ferme
  l'accès, `revoked_at` levé seulement par un évènement plus récent ET d'une période strictement plus lointaine,
  soit un réabonnement réel), les notifications sont dédoublonnées par `notificationUUID`
  (`appstore_notifications`), et le verrou est tenu par le serveur : déclencheur `private.sessions_paywall`
  (`before insert on public.sessions`, erreur `paywall_locked`), `update` et `delete` restant ouverts.
- `supabase/migrations/20261029000000_payant_modele_b.sql` : modèle B (28/10), la migration du 28/10 étant en
  production. Essai maison retiré (`trial_started_at`, `trial_days`, statut `trial` remplacé par `none`) :
  l'essai est l'offre de lancement d'Apple, retenue par transaction (`entitlement_claims.intro_offer`, avec
  `environment` Production ou Sandbox) et exposée par `intro_offer` / `intro_until` ; « Accès offert » d'Apple
  supprimé (produit inconnu, instantané de ses anciens détenteurs recalculé) ; élèves gratuits seulement si le
  coach a encore le rôle et parmi ses 10 plus anciens liens d'élèves sans droit payé propre
  (`private.access_coach_free`, `private.access_own_paid`, plafond par coach dans `private.coach_free_limits`) ;
  dans `private.sessions_paywall`, une ligne déjà présente (correction ou corbeille par upsert) passe toujours,
  et grâce de fin de séance (24 h après la fin à l'heure du serveur, séance commencée dans les 12 h avant la fin,
  2 au plus, comptées sous verrou consultatif, test d'existence refait sous ce verrou) ; déclencheur
  `sessions_paywall_upd` (`private.sessions_paywall_update`, before update) : sans droit, ni changement d'id,
  ni sortie de la corbeille, ni changement de date d'une ligne vivante ; seules les lignes `paywall_on` et
  `min_build` de `app_config` sont lisibles par `anon`.
- `supabase/migrations/20261031000000_payant_plus.sql` : payant plus (31/10, contrat `docs/PAYANT_V1.md`,
  « Payant plus »). Pas d'achat à vie payant (refusé par Maxence le 31/10). Accès à vie offerts révocables et tracés :
  `gift_redemptions.revoked_at` / `revoke_reason`, `gift_codes.revoked_at`, `private.grant_lifetime`,
  `private.revoke_lifetime`, `private.revoke_gift_code`, vue `private.lifetime_access` (administrateur
  seulement). Retour arrière : `supabase/rollback/20261031000000_payant_plus_down.sql`.
- `supabase/migrations/20261031230000_newsletter.sql` : lettre d'information (contrat `docs/NEWSLETTER.md`).
  `newsletter_subscriptions` (une ligne seulement pendant l'inscription : `consented_at` du serveur,
  `consent_version`, `source`, `unsubscribe_token`), RLS sans politique, aucun GRANT ; RPC `newsletter_state`,
  `newsletter_subscribe` (20 par 24 h, `no_email` pour un compte sans adresse), `newsletter_unsubscribe` (supprime la ligne, jamais limitée) pour
  `authenticated` ; `newsletter_recipients` et `newsletter_unsubscribe_token` pour `service_role` seulement
  (envoi pas branché). Retour arrière : `supabase/rollback/20261031230000_newsletter_down.sql` (dossier
  `supabase/rollback/` : jamais appliqué par Supabase, à lancer à la main), vérifié par
  `tests/sql/newsletter_rollback_test.sh`.
- `supabase/migrations/20261031620000_strava.sql` (retour arrière : `supabase/rollback/20261031620000_strava_down.sql`) : Strava
  (contrat `docs/STRAVA.md`). Tables `private.strava_links` (jetons chiffrés AES-GCM par la fonction Edge, clé
  `STRAVA_TOKEN_KEY`), `private.strava_states` (empreinte de l'état OAuth, 10 min, usage unique), `private.strava_exports`
  (séances envoyées, réservation contre le double envoi) ; aucun GRANT. `strava_status()` pour l'app (jamais de jeton) ;
  `strava_state_*`, `strava_link_*`, `strava_export_*` pour `service_role` seulement. Limites : 10 liaisons par heure,
  30 envois par 24 h.
- `supabase/functions/strava-connect/` (POST : adresse d'autorisation ; GET : retour de Strava, échange du code, droit
  `activity:write` vérifié, `approval_prompt=force`, un athlète par compte (`athlete_taken` → `#deja`, sauf liaison du détenteur périmée chez Strava : libérée par
  `freeStaleAthlete`), redirection vers
  `web-public/strava.html#résultat`), `strava-export/`, `strava-disconnect/`.
  Communs : `_shared/strava.ts` (appels à Strava, renouvellement des jetons, révocation), `_shared/strava-policy.js` et
  `_shared/strava-crypto.js` (logique pure testée par `tests/unit/strava-server.mjs`). `delete-account` révoque aussi
  l'accès Strava. Secrets `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_TOKEN_KEY`, jamais dans le dépôt.
- `supabase/rollback/` : retours arrière des migrations, lancés à la main seulement (Supabase ne les applique
  jamais), chacun vérifié par un script de `tests/sql/`.
- `supabase/functions/_shared/auth-guard.js` : garde pure de l'appelant (`requireCaller` : jeton Bearer relu par
  `auth.getUser`, null sinon), utilisée par `caller()` de `_shared/http.ts` pour toutes les fonctions déployées
  avec `verify_jwt = false` (delete-account, revoke-apple, report, verify-purchase) ;
  `tests/unit/auth-guard.mjs` prouve le 401 avant tout travail. `http.ts` porte aussi `bodyJws`.
- `supabase/functions/verify-purchase/` : un achat StoreKit 2. Signature d'Apple VRAIMENT vérifiée
  (`_shared/apple-jws.js` : chaîne jusqu'à Apple Root CA G3 épinglée dans le dépôt, dates, contraintes de base,
  marqueurs d'Apple, trois signatures ECDSA par WebCrypto), décision pure dans `purchase-policy.js`, puis
  relecture de la transaction auprès de l'App Store Server API (jeton ES256, secrets `APPLE_IAP_*`,
  `APPLE_ISSUER_ID`) avant d'écrire. Production et Sandbox acceptés (l'examen d'Apple achète en Sandbox),
  environnement et offre de lancement (`offerType` 1) transmis au serveur.
- `supabase/functions/appstore-notify/` : App Store Server Notifications V2, à déployer avec `--no-verify-jwt`
  (Apple n'a pas de jeton Supabase). Signature invalide : 401, rien d'écrit. `notify-policy.js` traite SUBSCRIBED,
  DID_RENEW, DID_CHANGE_RENEWAL_STATUS, DID_FAIL_TO_RENEW, EXPIRED, GRACE_PERIOD_EXPIRED, REFUND et REVOKE ;
  lit aussi `signedRenewalInfo` (seule source de `gracePeriodExpiresDate`) et répond 200 pour tout le reste,
  500 seulement si notre écriture échoue.
- Réglages d'authentification (SMTP Resend, modèles du code, Google, liaison manuelle, limites, e-mails
  de sécurité : moyen relié ou retiré, adresse changée) : `scripts/supabase-auth-config.py`, lecture
  seule par défaut (`--notifications` : e-mails de sécurité seulement).
- Dépendances iOS (Swift Package Manager) : figées par
  `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` une fois committé
  (workflow `ios.yml` : artefact `package-resolved`, puis `-onlyUsePackageVersionsFromResolvedFile`).
- `tests/sql/run.sh` : applique toutes les migrations sur un Postgres local jetable (socle Supabase imité
  par `supabase_stub.sql`) puis vérifie RLS, GRANT et déclencheurs (`*_test.sql`). Rien n'est envoyé au projet.
  `tests/sql/upgrade_test.sh` rejoue la montée de version de production (migrations jusqu'à `20261028`, données
  réalistes de `tests/sql/upgrade/seed_20261028.sql`, puis la suite, vérifiée par `check_modele_b.sql`) ;
  `tests/sql/grace_race_test.sh` envoie 6 séances de grâce en parallèle et exige qu'il n'en passe que 2 ;
  `tests/sql/rollback_payant_plus.sh` applique le retour arrière du payant plus sur des données (accès offert
  gardé, accès offert retiré, code désactivé) puis relance les tests des tarifs. Les quatre tournent dans la CI (`tests.yml`).
- Google stocke le nom de la personne dans les données d'identité (`identity_data.full_name`) : l'app ne
  le lit jamais.
- Jamais sur le serveur : données Santé (poids, courses, sommeil), poids du corps, réglages propres à l'appareil
  (règle 5.1.3). Le jeton de notification et les trois interrupteurs y vont (privacy.html, « Notifications »).
