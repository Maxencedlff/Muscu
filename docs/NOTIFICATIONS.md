# Notifications push

Contrat des notifications push de l'app iPhone (APNs). Ordre de mise en service : `docs/BUILD.md`.

## Ce que la personne reçoit

| Réglage (Réglages › Amis et coach › Notifications) | Déclencheur côté serveur | Texte | Toucher |
|---|---|---|---|
| Bravos | ligne ajoutée dans `bravos` (séance à moi) | « Bravo ! » · « max.dlf t'a dit bravo pour ta séance » | Historique › la séance (Historique si elle n'est pas sur l'iPhone) |
| Demandes d'abonnement | ligne `follows` en `pending` (jamais `ghost`) | « Nouvelle demande » · « max.dlf veut suivre tes séances » | Onglet Amis |
| Commentaires | ligne ajoutée dans `session_comments` par un autre sur une séance à moi | « Nouveau commentaire » · « max.dlf a commenté ta séance » | Historique › la séance (Historique si elle n'est pas sur l'iPhone) |
| Mon coach | `coach_notes` ajouté ou texte changé ; `coach_programmes` ajouté ou contenu changé | « Ton coach » · « kevin a commenté ta séance » / « kevin t'a envoyé un programme » | Historique › la séance ; Amis › Mon coach |
| Messages | ligne ajoutée dans `coach_messages` par l'autre personne (mon coach, ou un de mes élèves) | « Nouveau message » · « kevin t'a envoyé un message » | Amis › la conversation (avec mon coach, ou avec cet élève) |

- **Rien sans accord** : les cinq types sont éteints par défaut (pas de ligne `push_prefs` = tout
  éteint). La fenêtre d'autorisation d'iOS ne s'ouvre qu'au toucher d'un interrupteur ; le jeton de
  l'iPhone n'est inscrit qu'à ce moment-là.
- **Écran verrouillé** : seul le pseudo de l'auteur apparaît, jamais le texte d'un commentaire, d'un
  message ni le nom d'un programme. La file ne garde d'ailleurs que l'id du commentaire ou du message.
- **Pas de doublon** : la même notification (destinataire, type, auteur, objet) n'est pas recréée pendant
  24 h (bravo retiré puis remis, commentaire retouché).
- **Anti-rafale (commentaires, messages)** : une salve d'un même auteur sonne une fois. Pas de nouvelle
  notification (destinataire, type, auteur) si celle des 15 dernières minutes compte encore (message pas
  encore lu, commentaire toujours visible) ; lu entre-temps, le message suivant sonne. 15 min : regroupe
  une salve (un chat s'écrit en quelques messages en quelques minutes), plafonne à 4 notifications par
  heure et par auteur alors que 60 messages et 30 commentaires par heure sont permis, et rappelle un oubli
  au bout d'un quart d'heure. Plusieurs séances commentées d'affilée par la même personne : une seule
  notification (la première séance).
- **Blocage** : aucune notification entre deux comptes bloqués, y compris si le blocage est posé entre la
  mise en file et l'envoi (le chat lui-même ne regarde pas les blocages ; ses notifications si). Une
  demande fantôme ne notifie jamais (elle ne doit rien révéler).
- **Modération, relue aussi à l'envoi** (`private.push_valid`) : commentaire supprimé, masqué (3
  signalements), signalé par moi, ou dont l'auteur ne voit plus la séance (désabonné, social coupé, séance
  masquée) : rien. Message : lien coach ↔ élève rompu, rôle de coach retiré, conversation que j'ai
  signalée, ou déjà lu (conversation ouverte dans l'app) : rien.
- **Séance en cours** : le toucher d'une notification n'arrache jamais de l'écran de la séance.
- Les rappels de fin de repos restent des notifications locales (`LocalNotifications`), sans serveur.

## Données sur le serveur (`20261031900000_notifications_push.sql`, `20261031910000_notifications_messages.sql`)

| Table | Contenu | Accès |
|---|---|---|
| `public.push_devices` | jeton APNs (hexadécimal, 64 à 200 caractères), compte, environnement (`production` / `sandbox`), dates | RPC seulement |
| `public.push_prefs` | cinq booléens par compte (`reactions`, `follows`, `coach`, `comments`, `messages`) | RPC seulement |
| `private.push_outbox` | file : destinataire, type, auteur, objet (id de séance, de programme, de commentaire ou de message ; jamais un texte), état d'envoi | déclencheurs et RPC de l'envoi |
| `private.push_apns_auth` | une ligne : jeton du fournisseur APNs (JWT d'une heure, pas la clé .p8), son `iat`, l'identifiant de clé | RPC de l'envoi |

RLS activée sans politique et aucun GRANT de table : tout passe par des fonctions `security definer`
(`search_path = ''`, `auth.uid()`).

| RPC | Rôle | Effet |
|---|---|---|
| `push_register(token, env)` | authenticated | inscrit ou rafraîchit le jeton de cet appareil pour mon compte ; un jeton d'un autre compte passe au mien ; 10 appareils au plus |
| `push_unregister(token)` | authenticated | retire ce jeton s'il est à moi |
| `push_release(token)` | authenticated | retire ce jeton s'il est à un AUTRE compte (laissé sur cet iPhone par une session finie hors de l'app) ; le mien n'est jamais touché |
| `push_prefs()` | authenticated | `{ reactions, follows, coach, comments, messages }` |
| `push_set_prefs(reactions, follows, coach, comments, messages)` | authenticated | `null` = inchangé ; un type éteint vide sa file en attente. La version à 3 arguments reste (app d'avant) et ne touche pas aux deux autres |
| `push_claim(max_rows)` | service_role | prend la file (une ligne par appareil, `wanted` relu avec la modération), `ref` = écran à ouvrir (séance du commentaire, élève de la conversation), ménage : file de plus de 7 jours, appareils muets depuis 60 jours |
| `push_done(ids, dead_tokens)` | service_role | solde les notifications traitées, retire les jetons morts |
| `push_auth_get()` | service_role | jeton du fournisseur APNs gardé `{ token, iat, key_id }`, ou `null` |
| `push_auth_swap(expected, token, iat, key_id)` | service_role | le remplace seulement s'il porte encore `expected` (`null` : pas encore de ligne) ; rend la ligne gagnante |

Suppression d'un jeton : « tout éteint », déconnexion (`pushForgetDevice`, avant la fin de session),
suppression du compte (cascade), réponse 410 / `BadDeviceToken` d'APNs, 60 jours sans nouvelles.

`mdlf_push` (`{ userId, token }`) n'est vidé qu'après une réponse **sans erreur** de `push_unregister` (ou
`push_release`). Déconnexion ou « Supprimer toutes les données » hors ligne, erreur du serveur, délai de 3 s
dépassé, ou plus de session (`push_unregister` ne ferait rien : aucun appel) : le marqueur reste, et la
connexion suivante d'un AUTRE compte passe par `push_release` (ci-dessous). Sans ce marqueur, le compte B
connecté ensuite recevrait les notifications de A. Si A revient, rien à faire : le jeton est déjà le sien.

Session finie hors de l'app (jeton de rafraîchissement refusé ou révoqué : événement `SIGNED_OUT`) : plus
de session, donc aucune RPC possible à ce moment. `mdlf_push` garde `{ userId, token }` ; à la connexion
suivante d'un AUTRE compte sur cet iPhone, `pushOnAccount` appelle `push_release` AVANT de relire les
réglages et de réinscrire le jeton (l'ordre inverse retirerait le jeton du nouveau compte). Même chose si
cette connexion est annulée au choix de fusion : `pushForgetDevice` voit que la session (lue par
`sb.auth.getSession`) n'est pas le compte du jeton et appelle `push_release`. Hors ligne : `mdlf_push`
reste, nouvel essai au prochain lancement. Limite assumée : entre la fin de session et la connexion
suivante, l'iPhone (celui de ce compte) peut encore recevoir ses notifications, au plus 60 jours. Même
limite après une déconnexion hors ligne.

Réinstallation ou nouvel iPhone : les réglages restent sur le compte, mais iOS n'a rien accordé ici
(`permission` = `prompt`) et l'iPhone n'a pas de jeton. Réglages › Notifications montre alors les
interrupteurs éteints (vrai pour cet iPhone) et une ligne « Réactiver sur cet iPhone » (`pushReactivate` :
fenêtre d'iOS puis jeton) ; la cellule des Réglages dit « À réactiver » (`pushNeedsReactivate`).

Tests : `tests/sql/push_test.sql` (anon, autre compte, défauts, déclencheurs, blocage, fantôme, file,
reprise, suppression du compte, `push_release`) et `tests/sql/push_messages_test.sql` (commentaires et
messages : réglages, salve, lu, masqué, signalé, bloqué, lien rompu, écran à ouvrir) ; retours arrière :
`tests/sql/rollback_push_messages_check.sh` (pg_dump identique), puis `tests/sql/rollback_push_check.sh`.

## Envoi (`supabase/functions/push-send/`)

- Appelée chaque minute par la base (pg_cron + pg_net, `docs/BUILD.md`) avec l'en-tête
  `x-push-secret` ; `verify_jwt = false` (aucun jeton de session).
- Règles pures dans `push-policy.js` (testées par `tests/unit/push.mjs`) : textes, requête APNs
  (HTTP/2, `apns-push-type: alert`, `apns-topic`, priorité 10, expiration 24 h), suite donnée à chaque
  réponse (envoyée, jeton mort, nouvel essai, abandon).
- Jeton du fournisseur ES256 (`providerTokenCache`) : Apple refuse plus d'un nouveau jeton toutes les 20 min
  (429 `TooManyProviderTokenUpdates`). Une seule signature partagée par les 10 envois simultanés (promesse
  gardée), et par les instances de la fonction (qui vivent peu) : ligne `private.push_apns_auth`, renouvelée
  après 40 min par échange conditionnel (`push_auth_swap`), si bien que deux instances qui renouvellent
  ensemble gardent la même. 403 `InvalidProviderToken` ou `ExpiredProviderToken` : ce jeton est écarté une
  fois ; autre 403, ou réponse tardive pour un jeton déjà remplacé : rien ne change. Base injoignable : signé
  et gardé en mémoire.
- Secrets (jamais dans le dépôt) : `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `PUSH_CRON_SECRET`,
  `APNS_TOPIC` facultatif. Un secret APNs absent : 503 sans toucher à la file.
- Nouvel essai : la ligne reste en file, reprise 5 minutes plus tard, 5 essais au plus, abandonnée après 24 h.

## App

| Fichier | Rôle |
|---|---|
| `ios/App/App/PushPlugin.swift` (`MdlfPush`) | autorisation (`permission`, `requestPermission`), jeton (`register`), `openSettings`, notifications reçues par le routeur de Capacitor (`willPresent` : bannière et relecture des badges ; `didReceive` : toucher gardé jusqu'à l'abonnement du web) |
| `ios/App/App/AppDelegate.swift` | relaie le jeton d'APNs par NotificationCenter (`.capacitorDidRegisterForRemoteNotifications`) |
| `ios/App/App/App.entitlements` | `aps-environment = production` |
| `js/platform/native.js` | `Native.push.*` (sans effet dans le navigateur et sur une build antérieure : `unavailable`) |
| `js/data/push.js` | réglages, jeton, déconnexion, écran du toucher (`pushTarget`), logique testée par `tests/unit/push.mjs`. Les types « Commentaires » et « Messages » ne sont montrés que si le serveur les renvoie (serveur d'avant : 3 interrupteurs, `push_set_prefs` à 3 arguments) |
| `js/features/push-ui.js` | Réglages › Notifications, cellule des Réglages, toucher d'une notification |

E2E : `tests/test_notifications.py` (faux module `MdlfPush` et fausses RPC dans `tests/fake_account.py`).
