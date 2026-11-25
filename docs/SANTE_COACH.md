# Pas, sommeil et cardio partagés avec le coach (vague 3 de l'interface coach)

Branche `sante-coach` (25/11/2026). **Migration appliquée en production le 25/11/2026** (feu vert de Maxence) ; rien n'est publié côté app (pas d'OTA) ;
pas d'OTA ; la partie native demande une **build iOS soumise à Apple**.

Ce que ça fait : l'élève coche « Pas, sommeil et cardio » dans Réglages › Social et coach › Partager avec mon coach.
L'app lit alors Santé sur son iPhone et envoie à son coach, et à lui seul, **un résumé par jour**. Ce résumé sert à
trois endroits :

1. **Bilans** : les suivis « Pas par jour », « Cardio » et « Sommeil » (en heures) se préremplissent, corrigeables.
2. **Site du coach** (coach-web, `coach.mdlf.app`) : colonnes Pas, Sommeil, Cardio de la fiche « Semaines » (moyennes de
   la semaine), seulement si l'élève partage (docs/COACH_WEB.md, « Vague 3 »).
3. **Mode grand écran** (iPad, branche `coach-ipad`) : c'est le même site embarqué dans l'app ; les colonnes y sont
   sans rien de plus (testé avec le faux hôte `MDLF_COACH_HOST`).

## Ce qui part, et rien d'autre

Un jour = `{ day, steps?, sleep?, cardio? }` :

| Champ | Contenu | Source Santé |
|---|---|---|
| `day` | date locale de l'iPhone, `AAAA-MM-JJ` | — |
| `steps` | pas du jour (0 à 100 000) | `stepCount`, `HKStatisticsCollectionQuery` `cumulativeSum` par jour : Santé fusionne iPhone et Apple Watch, rien ne compte deux fois |
| `sleep` | minutes **endormi** de la nuit qui se termine ce jour-là (0 à 1 440) | `sleepAnalysis`, catégories « endormi » d'iOS 16 et plus : `asleepUnspecified`, `asleepCore`, `asleepDeep`, `asleepREM`, unies entre sources (`sleepNights` de `js/data/health-sleep.js`). Jamais `inBed` ni `awake` : une nuit « au lit » seule n'est pas envoyée |
| `cardio` | minutes d'entraînements cardio du jour (0 à 1 440) | entraînements `HKWorkout` des types cardio (course, marche, vélo, elliptique, rameur, escaliers, natation, randonnée, HIIT, corde, danse, boxe, ski de fond…), toutes sources ; intervalle actif `[fin − durée, fin]`, **union** par jour (Apple Watch + Strava = une fois). La musculation n'en fait pas partie |

Jamais : heures de coucher ou de réveil, phases, fréquence cardiaque, lieux, appareil ou app d'origine, poids de Santé.
iOS ne dit pas si la lecture est refusée : tout vide → rien n'est envoyé ; `cardio` vaut 0 un jour qui a des pas ou une
nuit seulement si au moins un entraînement a été lu sur la fenêtre (sinon il est absent, jamais un zéro inventé).

Rien n'entre dans `data` (copie iCloud et compte, règle Apple 5.1.3(ii)) : lecture en mémoire (`healthDays`), seule
l'empreinte du dernier envoi est gardée (`mdlf_coach_share_h`, effacée à la déconnexion, `CROSS_USER_CACHE_KEYS`).

## Consentement (RGPD art. 9) et autorisation de Santé

- Case **décochée par défaut**, affichée seulement si la coquille sait lire (`Native.health.daysSupported()` : clé
  `days` de `authorizationStatus`, build du 25/11) **et** si le serveur l'accepte (`student_shares().kinds` contient
  `health`). Navigateur, Android, build antérieure, serveur d'avant : case cachée, saisie manuelle dans les bilans.
- Cocher ouvre une feuille d'accord explicite (ce qui part, 90 jours, « Santé va te demander l'accès ») ; « Partager »
  → **fenêtre d'iOS** (`requestDaysAuthorization` : lecture des pas, du sommeil et des entraînements, rien en écriture),
  c'est le **seul** moment où elle est demandée (jamais au lancement) → `student_set_share('health', true)` (accord daté
  sur le serveur) → lecture de 92 jours → envoi. Annuler la feuille : rien.
- Envoi ensuite à chaque relecture du partage (démarrage, premier plan…), Santé relue au plus toutes les 10 min,
  envoyé seulement si le résumé a changé, et seulement depuis l'appareil qui a déjà envoyé (un iPad sans Santé n'écrase
  rien).
- Décocher : confirmation, puis tout est effacé du serveur (clé étrangère `on delete cascade`). Quitter le coach, être
  retiré, supprimer un compte : effacé aussi.
- Bilans : le préremplissage lit Santé **seulement si la case est cochée** (audit du 25/11, B2 : c'est l'accord donné,
  et le texte d'accès figé dans la build ne promet rien d'autre), sans jamais demander l'autorisation ; case décochée :
  à la main. Répondre au bilan vaut partage de ces réponses (docs/BILANS.md).
- **Blocage** (audit B1) : si l'élève et son coach se bloquent (dans un sens ou l'autre), `coach_student_health` rend
  `shared: false` et `student_share_health_days` refuse (`not_shared`). Défense en profondeur, en plus du traitement
  général du blocage (branche `audit-coach-fix`, migration `20261127010000_blocage_coupe_coach.sql`, qui coupe le lien et
  efface donc aussi l'accord et les jours ; la migration santé est numérotée `20261127050000` pour passer après elle).
- **Version de l'accord** (m5) : `coach_shares.consent_version` = `sante-2026-11-25` pour chaque accord `health`
  (déclencheur), pour savoir sur quel texte l'élève a dit oui.

## Serveur : `supabase/migrations/20261127050000_sante_coach.sql` (appliquée en production le 25/11/2026, après 20261127040000_photos_web_appairage)

- `coach_shares.kind` : + `health` ; `private.share_kind_open` : + `health`.
- Table `public.coach_shared_health_days (student_id, kind, day, steps, sleep_min, cardio_min)`, un jour par ligne,
  clé étrangère vers le consentement `on delete cascade`, RLS sans politique, aucun GRANT.
- `student_share_health_days(days)` : fusion jour par jour, 92 jours et 16 Ko au plus, bornes, `not_shared` sans
  accord, 120 envois par heure ; `coach_student_health(student)` : mon élève seulement ; `coach_student_weeks` rend
  aussi `health` (fiche Semaines en un appel) ; `student_shares` annonce `health`.
- **90 jours glissants** : jamais écrit au-delà, supprimé à l'envoi, jamais lu, purge pg_cron quotidienne
  (`purge-sante-coach-90-jours`, 03:43 UTC).
- Bilans : le suivi « Sommeil » accepte aussi le type nombre en heures (`unit: 'h'`, 0 à 24) : `private.checkin_kinds`
  et `private.checkin_number` redéfinies. L'échelle reste le type par défaut : les modèles existants ne changent pas.
- Retour arrière : `supabase/rollback/20261127050000_sante_coach_down.sql` (efface jours et accords `health`, remet les
  textes d'avant) ; ordre dans `supabase/rollback/ORDRE.md`. Dépend de `20261118010000` (diète), `20261124010000`
  (semaines) et `20261125010000` (bilans) : à appliquer après elles.

## Corrections de l'audit RSSI du 25/11

B1 blocage, B2 bilans sans la case, M1 commentaires de `PrivacyInfo.xcprivacy` et `SOUMISSION.md` ; m1 sommeil
prérempli au centième (« 7,27 » comme « 7 h 16 » de l'aide) ; m2 sommeil lu du plus récent (une limite coupe les nuits
anciennes) ; m3 `activityDays` rejette en cas d'erreur de lecture (le web garde sa lecture d'avant) ; m4 total du
cardio de la semaine sous la moyenne dans la fiche ; m5 `consent_version` ; m7 « dernier jour reçu le … » dans le pied
de la fiche quand il date de plus de 2 jours.

## Bilans

- `js/data/checkins.js` : `sleep` types `['scale', 'number']`, unité `h` (« h/nuit », réponse « 7 h 15 par nuit ») ;
  `checkinPrefill` remplit `steps` (moyenne par jour), `cardio` (minutes de la période) et `sleep` **en nombre
  seulement** (heures par nuit, au centième). Un sommeil en échelle est un ressenti : jamais deviné ; l'écran montre
  seulement « 7 h 05 par nuit en moyenne sur 6 nuits, d'après Santé ».
- `js/data/checkin-student.js` : `checkinReadHealth(req)` (période du bilan, jusqu'à aujourd'hui), gardé en mémoire
  pour CE bilan. Une valeur touchée ou passée par l'élève n'est jamais remplacée ; texte « lu dans Santé. Touche pour
  corriger ».

## Ce qui demande une build iOS

Tout le reste passe par mise à jour à chaud, mais **sans la build rien ne s'affiche** (case cachée) :

| Natif | Pourquoi |
|---|---|
| `HealthPlugin.swift` : `requestDaysAuthorization`, `activityDays` (pas par jour, entraînements cardio), clé `days` de `authorizationStatus`, `sleep` jusqu'à 92 nuits | nouvelles lectures HealthKit (`stepCount`) |
| `Info.plist` : `NSHealthShareUsageDescription` réécrit | dit le partage avec le coach (texte en français) |

Le natif change l'empreinte (`runtime`) des mises à jour à chaud : le web de cette branche n'ira qu'à cette build.
Ordre de mise en service : migration (quand Maxence le dit), puis build TestFlight, puis le site du coach. Le site et
l'app d'avant marchent sur le serveur à jour ; l'app à jour sur un serveur d'avant cache la case.

À vérifier sur un vrai iPhone (TestFlight) : Partager › cocher → feuille → fenêtre de Santé (Pas, Sommeil,
Entraînements) ; le site du coach montre les colonnes le lendemain ; Réglages › Santé › Accès aux données › MDLF
Training : couper « Pas » → plus rien de neuf ; décocher → plus rien chez le coach.

## App Store Connect : confidentialité de l'app

Santé et forme › **Santé** (Health : « Health and medical data, including … HealthKit API ») et Santé et forme ›
**Forme physique** (Fitness : « Fitness and exercise data ») : déjà déclarées (pesées partagées, séances), finalité
**Fonctionnalité de l'app**, **liées** à l'identité, **sans suivi**. À cocher/mettre à jour dans la fiche : la case
**Santé** doit rester cochée et sa description couvrir les données lues dans HealthKit (pas, sommeil, cardio) envoyées
au coach ; **Forme physique** cochée. `ios/App/App/PrivacyInfo.xcprivacy` déclare déjà les deux types (rien à changer).
Règle 5.1.3 (i) : partage à un tiers seulement avec permission et pour la gestion de la santé, jamais pour la
publicité ; (ii) : jamais dans iCloud. Les deux sont tenues (accord explicite, `data` jamais touché). Lu sur
developer.apple.com le 25/11/2026 (app-privacy-details et review guidelines).

`privacy.html` (FR et EN) : section Coach (`#partage-sante`, `#share-health`), Apple Santé, résumé et « ce qui ne
part jamais » mis à jour, date du 25/11/2026.

## Tests

- Unitaires (`node tests/unit/run.mjs`) : `tests/unit/sante-eleve.mjs` (résumé par jour, sommeil iOS 16, union du
  cardio, lecture refusée, 90 jours, bornes, période d'un bilan, sommeil en heures, préremplissage, case cachée,
  autorisation au geste seulement, envoi puis rien sans changement, décocher, pont natif iOS / build antérieure /
  Android / navigateur) ; `tests/unit/coach-web-sante.mjs` (site) ; `android.mjs`, `coach-share.mjs`, `juridique.mjs`
  mis à jour.
- SQL : `tests/sql/sante_coach_test.sql`, `tests/sql/sante_coach_rollback_test.sh`, `prod_order_test.sh`.
- E2E app : `tests/test_sante_coach.py` (fausse coquille Santé `FAKE_HEALTH`) ; E2E site : `tests/test_coach_web_sante.py`.
- Faux serveur : `tests/fake_account.py` (`student_share_health_days`, `coach_student_health`, `__sb.shareHealth`,
  `__sb.fail.health = 'missing'`).
- iOS : `ios.yml` compile le module Swift à chaque envoi qui touche `ios/`.
