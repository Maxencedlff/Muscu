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

4. Capacité **Declared Age Range** sur `com.mdlf.training` (entitlement `com.apple.developer.declared-age-range`,
   `AgeRangePlugin.swift`), puis profil « MDLF Training App Store » régénéré et secret `APPSTORE_PROFILE`
   remplacé : **à faire avant la première build qui contient le module** (IOS.md, « Tranche d'âge »).

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
   - Notifications : Réglages › Social et coach › Notifications, allumer « Bravos » (fenêtre d'iOS),
     depuis un 2e compte dire bravo → notification en moins d'une minute, toucher → la séance ;
     tout éteindre → plus rien ; se déconnecter → plus rien.
4. App Store Connect › Confidentialité de l'app : rien de neuf pour la santé (aucune donnée de Santé ne
   quitte l'iPhone). Le jeton de notification n'est pas un « identifiant de l'appareil » au sens d'Apple
   (il ne sert qu'à l'envoi) ; à confirmer par Maxence au moment de remplir la fiche.

## Retour arrière

- App : la build précédente reste dans TestFlight ; les mises à jour à chaud de la build précédente ne
  sont pas touchées (empreinte différente).
- Serveur : `cron.unschedule('push-send')`, puis `supabase/rollback/20261031910000_notifications_messages_down.sql`
  s'il est en place, puis `supabase/rollback/20261031900000_notifications_push_down.sql`
  (tables, fonctions et déclencheurs retirés ; bravos, demandes et commentaires intacts).

## Messages du chat et commentaires (branche `nuit2-notifs`, 01/11/2026)

Deux types de plus, « Commentaires » et « Messages », éteints par défaut (contrat : docs/NOTIFICATIONS.md).
Ordre (le serveur d'abord ; chaque étape seule ne casse rien) :

1. `bash tests/sql/run.sh && bash tests/sql/rollback_push_messages_check.sh`, puis la migration
   `20261031910000_notifications_messages.sql` (éditeur SQL ou `supabase db push`). L'app d'avant continue
   de marcher (`push_set_prefs` à 3 arguments gardé ; les deux nouvelles clés de `push_prefs` sont ignorées).
2. `supabase functions deploy push-send --project-ref yopptmdjtnezmccdvaxf` : textes des deux types
   (`PUSH_KINDS`). Avant ce déploiement, une notification de ces types serait soldée sans partir
   (`unknown_kind`) ; personne ne peut encore les allumer tant que l'OTA n'est pas publiée.
3. OTA de l'app : deux interrupteurs de plus, toucher → la séance commentée ou la conversation. Une app à
   jour sur un serveur d'avant ne montre pas les deux interrupteurs.

Aucun changement natif : pas de build. Retour arrière : `supabase/rollback/20261031910000_notifications_messages_down.sql`
(avant celui de `20261031900000`, `supabase/rollback/ORDRE.md`).

## Mises à jour à chaud : garde, environnement `ota` et signature (audit du 12/11/2026, M1 et M6)

Déjà en place sur la branche `audit-ota` (aucune action) :
- `js/app/live-update.js` n'accepte un paquet que sous `https://mdlf-ota.vercel.app/bundles/<nom>.zip`
  (texte brut : pas de `%`, `@`, `//`, `?`, `#`, `\`, port ni autre casse) ; l'adresse du manifeste est figée.
- `ota.yml` : job `gate` qui attend le workflow Tests vert sur le commit publié (comme ios.yml), puis
  construit depuis ce SHA exact ; aucun droit par défaut ; étape renommée « empreinte SHA-256 » (ce
  n'est pas une signature) ; job `publish` derrière l'environnement GitHub `ota`.

### Environnement `ota` (Maxence, une fois, AVANT le prochain lancement d'ota.yml)

Sans cet environnement, GitHub le crée tout seul au premier lancement, **sans relecture** : le créer
d'abord.

1. GitHub › Maxencedlff/Muscu › Settings › Environments › **New environment**, nom exact `ota`.
2. **Required reviewers** : cocher, ajouter `Maxencedlff`. Laisser décochée « Prevent self-review »
   (tu es le seul relecteur : sinon personne ne peut approuver ce que tu lances).
3. **Deployment branches and tags** : « Selected branches and tags », règle `main` seulement.
4. Facultatif mais conseillé : déplacer dans l'environnement les secrets propres à l'OTA
   (`VERCEL_OTA_PROJECT_ID`, puis un jeton Vercel limité au projet mdlf-ota, voir ci-dessous) pour qu'ils
   ne soient remis qu'après approbation. `VERCEL_TOKEN` et `VERCEL_ORG_ID` restent au niveau du dépôt
   tant que tests.yml s'en sert pour le site.

En ligne de commande (même résultat ; la relecture se règle avec l'identifiant numérique du compte) :

```bash
ID=$(gh api user -q .id)
gh api -X PUT repos/Maxencedlff/Muscu/environments/ota --input - <<JSON
{ "prevent_self_review": false,
  "reviewers": [{ "type": "User", "id": $ID }],
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
gh api -X POST repos/Maxencedlff/Muscu/environments/ota/deployment-branch-policies -f name=main -f type=branch
```

Ensuite, à chaque `gh workflow run ota.yml …` : le job `gate` attend Tests, puis le job « Publication »
s'arrête sur « Waiting for review » ; Actions › le run › **Review deployments** › cocher `ota` ›
**Approve and deploy**.

Jeton Vercel propre à l'OTA (recommandé par l'audit) : vercel.com › Account Settings › Tokens ›
Create, portée limitée à l'équipe du projet mdlf-ota, expiration ; le poser comme secret
`VERCEL_TOKEN` **de l'environnement `ota`** (il masque celui du dépôt pour ce seul job), puis vérifier
qu'un lancement publie toujours.

### Signature Capgo (à faire AVEC la prochaine build native, pas avant)

Pourquoi : aujourd'hui le SHA-256 vient du même manifeste que l'adresse du paquet ; c'est une empreinte
d'intégrité, pas une signature. Avec une `publicKey` compilée dans l'app, le module natif refuse tout
paquet sans clé de session valide et vérifie le SHA-256 chiffré par la clé privée.

Ce qui est déjà prêt (inactif tant que le secret n'existe pas) :
- `scripts/ota-bundle.py` lit `OTA_CAPGO_PRIVATE_KEY`. Les deux côtés vont ensemble : clé privée ET
  `publicKey` → paquet chiffré par `@capgo/cli@8.98.6` (`bundle encrypt`), manifeste avec `checksum`
  (SHA-256 chiffré) et `sessionKey`, et contrôle de la paire par `bundle decrypt` avec la `publicKey`
  avant toute publication ; ni l'un ni l'autre → comme avant ; l'un sans l'autre → arrêt, rien n'est
  publié. Testé le 12/11 avec une clé jetable (supprimée) : 5 cas (aucun, clé seule, publicKey seule,
  paire valide, paire qui ne correspond pas).
- `ota.yml` passe déjà `secrets.OTA_CAPGO_PRIVATE_KEY` à cette seule étape (vide tant qu'il n'existe pas).
- `js/app/live-update.js` accepte un manifeste signé et transmet `sessionKey` à `Native.ota.download`.

Étapes, dans l'ordre :

1. Sur le PC, à la racine du dépôt (branche de la build) :
   ```bash
   npx @capgo/cli@8.98.6 key create --skip-capgo-app-id-prompt
   ```
   Crée `.capgo_key_v2` (clé privée) et `.capgo_key_v2.pub`, et écrit `publicKey` dans le bloc
   `CapacitorUpdater` de `capacitor.config.json`. Répondre **non** à la question « sync Capacitor » si on
   ne veut pas lancer `cap sync` tout de suite. Vérifier `git status` : seul `capacitor.config.json`
   change ; les deux fichiers de clé ne doivent JAMAIS être commités (ils sont
   déjà ignorés par `.gitignore`).
2. Clé privée en secret GitHub de l'environnement `ota` (réservé à ota.yml, jamais au niveau du dépôt) :
   ```bash
   gh secret set OTA_CAPGO_PRIVATE_KEY -R Maxencedlff/Muscu --env ota < .capgo_key_v2
   ```
   Puis ranger `.capgo_key_v2` hors du dépôt dans le gestionnaire de mots de passe (perdre la clé = plus
   aucune OTA possible pour cette build), et l'effacer du dossier.
3. Commit de `capacitor.config.json` (l'empreinte `runtime` change : c'est une nouvelle build native),
   Tests verts, puis build TestFlight (`ios.yml -f testflight=true`, section 6).
4. Première OTA après cette build : le journal d'ota.yml doit montrer un manifeste avec `sessionKey`. Sur
   l'iPhone de la nouvelle build, Réglages › « Rechercher une mise à jour » doit l'installer. Les builds
   plus anciennes l'ignorent (empreinte différente) : elles restent sans vérification.
5. Une fois la nouvelle build installée par tous (TestFlight puis App Store), relever `min_build` pour
   retirer les anciennes builds non vérifiées (docs/PAYANT_V1.md, « Version minimale ») :
   ```sql
   update public.app_config set value = '<numéro de la build signée>'::jsonb, updated_at = now() where key = 'min_build';
   ```

Retour arrière : supprimer le secret (`gh secret delete OTA_CAPGO_PRIVATE_KEY --env ota`) ne suffit pas,
`ota-bundle.py` s'arrête alors (publicKey sans clé) : il faut aussi une build sans `publicKey`. Une clé
privée compromise se change de la même façon (nouvelle paire, nouvelle build, `min_build` relevé).

## À brancher plus tard

- Réactions emoji (`lot3-reactions`) : une réaction ajoutée est une ligne `bravos` (déclencheur
  `bravos_push`, texte « bravo ») ; changer de réaction (mise à jour) ne notifie pas. Un texte par
  emoji demanderait un type de plus (contrainte de `push_outbox.kind`, `PUSH_KINDS`, `pushTarget`).
- Badge de l'icône (nombre de non-lus) : non envoyé aujourd'hui.
