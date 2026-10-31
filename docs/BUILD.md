# Build unique (branche nuit-build)

Ce que contient cette build native, et l'ordre exact pour la mettre en service. **Rien n'est en
production** tant que Maxence n'a pas donné son feu vert : la branche n'est pas poussée, la migration
n'est pas appliquée, la fonction n'est pas déployée, aucun secret n'est posé.

Compilée sur la branche `build-ios` (31/10/2026, avec l'Apple Watch, le widget et Siri : docs/WATCH_WIDGETS.md) : contrôle simulateur vert, build TestFlight 31.

## Contenu

| Sujet | Natif | Web | Serveur |
|---|---|---|---|
| Photos de progression (branche `lot2-build-photos`, fusionnée) | `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` | `PHOTOS_NATIVE_READY = true` | — |
| Santé : sommeil (lecture) | `HealthPlugin.sleep`, type `sleepAnalysis`, texte `NSHealthShareUsageDescription` | `js/data/health-sleep.js`, ligne de l'accueil | — (jamais envoyé) |
| Santé : séances détaillées | `HealthPlugin.saveWorkouts` (type d'activité, pauses, énergie et distance réparties, identifiant de synchro), texte `NSHealthUpdateUsageDescription` | `js/data/health-export.js`, heure du chrono des machines (`machine.at`) | — |
| Notifications push | `PushPlugin.swift`, `AppDelegate`, `aps-environment`, projet Xcode | `js/data/push.js`, `js/features/push-ui.js` | migration `20261031900000_notifications_push.sql`, fonction `push-send` |

Tout changement natif change l'empreinte (`runtime`) : les mises à jour à chaud de ce contenu ne vont
qu'à cette build, et une build plus ancienne ne reçoit jamais ce contenu (photos, Santé détaillée, push).
Sur une build plus ancienne, le web reste sûr de toute façon : `saveWorkouts` absent → séance écrite comme
avant ; `sleep` absent → pas de ligne ; `MdlfPush` absent → « Mets l'app à jour » dans Réglages ›
Notifications.

## Ordre de mise en service

### 1. Compiler (contrôle, sans secret)

```bash
gh workflow run ios.yml -R Maxencedlff/Muscu --ref nuit-build
```

Corriger ce que le compilateur signale (Swift non compilé : `HealthPlugin.swift`, `PushPlugin.swift`,
`AppDelegate.swift`). Le contrôle signe en Debug sans profil (`CODE_SIGNING_ALLOWED=NO`) : il ne vérifie
pas la capacité push.

### 2. Apple Developer (Maxence, developer.apple.com)

1. ~~Capacité **Push Notifications** sur `com.mdlf.training`~~ : **faite par l'API le 31/10/2026** (pas
   besoin de certificat : la clé du point 2 suffit). HealthKit était déjà coché ; le sommeil ne demande
   aucune capacité de plus.
2. Keys › « + » › **Apple Push Notifications service (APNs)**, environnement « Sandbox & Production » :
   télécharger `AuthKey_XXXXXXXXXX.p8` (téléchargeable une seule fois), noter le **Key ID**. Ranger le
   fichier dans `~/.config/apple/`, jamais dans le dépôt.
3. ~~Profil « MDLF Training App Store » régénéré avec `aps-environment`~~ : **fait par l'API le 31/10/2026**
   (profil recréé, secret GitHub `APPSTORE_PROFILE` remplacé), avec le profil de l'Apple Watch
   (docs/WATCH_WIDGETS.md). Le profil de l'extension RestActivity ne change pas.

### 3. Serveur (après le feu vert n° 2)

```bash
bash tests/sql/run.sh                    # migrations et tests sur un Postgres jetable
bash tests/sql/rollback_push_check.sh    # retour arrière vérifié
supabase db push                         # ou l'éditeur SQL : 20261031900000_notifications_push.sql
```

Sans app qui l'appelle, la migration ne fait rien de visible : sans réglage allumé, aucune ligne n'entre en file.
Si d'autres branches serveur passent avant (lot 3 : réactions emoji, chat du coach), ajouter leurs
déclencheurs dans une migration suivante (voir « À brancher plus tard »).

### 4. Secrets et fonction

```bash
umask 077; openssl rand -hex 32 > ~/.config/mdlf/push_cron_secret   # sert aussi à l'étape 5
supabase secrets set --project-ref yopptmdjtnezmccdvaxf \
  APNS_KEY_P8="$(cat ~/.config/apple/AuthKey_XXXXXXXXXX.p8)" \
  APNS_KEY_ID=XXXXXXXXXX APNS_TEAM_ID=NMK739Z59B \
  PUSH_CRON_SECRET="$(cat ~/.config/mdlf/push_cron_secret)"
supabase functions deploy push-send --project-ref yopptmdjtnezmccdvaxf
```

Contrôle :

```bash
curl -s -X POST https://yopptmdjtnezmccdvaxf.supabase.co/functions/v1/push-send \
  -H "x-push-secret: $(cat ~/.config/mdlf/push_cron_secret)"
# → {"sent":0,"dead":0,"retry":0,"dropped":0,"skipped":0} ; sans en-tête : 401
```

### 5. Planification (chaque minute)

Dans l'éditeur SQL du projet (extensions `pg_cron` et `pg_net` à activer dans Database › Extensions) ;
le secret va dans le coffre de Supabase, jamais en clair dans la tâche :

```sql
select vault.create_secret('<valeur de PUSH_CRON_SECRET>', 'push_cron_secret');
select cron.schedule('push-send', '* * * * *', $$
  select net.http_post(
    url := 'https://yopptmdjtnezmccdvaxf.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-push-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000)
$$);
```

Arrêt : `select cron.unschedule('push-send');`.

### 6. TestFlight

1. `MARKETING_VERSION` (ex. 1.1.0) dans `project.pbxproj` (réglages du projet, Debug et Release).
2. `gh workflow run ios.yml -R Maxencedlff/Muscu --ref main -f testflight=true` (après fusion dans main).
3. À vérifier sur un vrai iPhone (TestFlight = APNs de production) :
   - Photos : « Prendre une photo » et « Choisir » dans Progrès › Mesures.
   - Santé : Réglages › Services Apple › « Sommeil et cardio » ouvre la feuille de Santé (sommeil,
     distances) ; la nuit s'affiche sur l'accueil le matin ; une séance avec 10 min de tapis au chrono
     apparaît dans Santé / Forme en « Musculation » (en pause pendant le tapis) + « Course » ou
     « Marche » avec sa distance ; « Envoyer l'historique » ne crée pas de doublon.
   - Notifications : Réglages › Amis et coach › Notifications, allumer « Bravos » (fenêtre d'iOS),
     depuis un 2e compte dire bravo → notification en moins d'une minute, toucher → la séance ;
     tout éteindre → plus rien ; se déconnecter → plus rien.
4. App Store Connect › Confidentialité de l'app : rien de neuf pour la santé (aucune donnée de Santé ne
   quitte l'iPhone). Le jeton de notification n'est pas un « identifiant de l'appareil » au sens d'Apple
   (il ne sert qu'à l'envoi) ; à confirmer par Maxence au moment de remplir la fiche.

## Retour arrière

- App : la build précédente reste dans TestFlight ; les mises à jour à chaud de la build précédente ne
  sont pas touchées (empreinte différente).
- Serveur : `cron.unschedule('push-send')`, puis `supabase/rollback/20261031900000_notifications_push_down.sql`
  (tables, fonctions et déclencheurs retirés ; bravos, demandes et commentaires intacts).

## À brancher plus tard

- Réactions emoji (`lot3-reactions`) et chat du coach (`nuit-social`) : un déclencheur de plus chacun,
  qui appelle `private.push_enqueue(destinataire, type, auteur, objet)` ; ajouter le type dans la
  contrainte de `push_outbox.kind`, dans `PUSH_KINDS` (`push-policy.js`) et dans `pushTarget`.
- Badge de l'icône (nombre de non-lus) : non envoyé aujourd'hui.
