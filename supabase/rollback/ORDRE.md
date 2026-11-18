# Retours arrière : ordre de démontage

Les fichiers `*_down.sql` de ce dossier défont une migration de `supabase/migrations/`. Supabase ne les applique jamais de lui-même : chacun se lance à la main dans l'éditeur SQL, sur décision de Maxence, après avoir lu son en-tête (ce qu'il faut couper avant, ce qui est effacé, ce qui est mis de côté).

## Règle

**Toujours de la migration la plus récente vers la plus ancienne.** Cet ordre est le seul vérifié marche par marche par `tests/sql/rollback_nuit_check.sh`, qui compare après chaque retour arrière le `pg_dump` complet (schéma, droits, politiques, déclencheurs et données) avec celui d'une base où la migration n'a jamais été appliquée.

| # | Retour arrière | Dépend de (à démonter avant) | Peut se lancer seul sur la pile complète |
|---|---|---|---|
| −17 | `20261117090000_badge_carte_pro_down.sql` (efface les déclarations ; les signalements restent dans `public.reports`) | rien | oui (vérifié) |
| −16 | `20261117060000_reaction_jaime_down.sql` (chaque ❤️ redevient un 👏 ; `push_claim` reprend celui du résumé des séances, −15) | rien | oui (vérifié) |
| −15 | `20261117050000_messages_coach_down.sql` (résumé des séances et `coach_push_off` : résumés en file effacés, une notification par élève et par heure comme avant ; push-send peut rester) | J'aime (−16) : il reprend son `push_claim` | oui pour les autres lots (vérifié, sans `reaction_jaime_test.sql`) ; défaire −16 avant pour garder le texte de la notification d'une réaction |
| −14 | `20261117040000_promo_coach_down.sql` (supprimer d'abord la fonction Edge `coach-promo-offer` ; demandes d'offre et comptes déjà coachs mis de côté dans `private.promo_coach_archive_*`) | rien | oui (vérifié) |
| −13 | `20261117030000_grille_coach_down.sql` (grille coach du 17/11 : retour aux limites 10, 20, 30, illimité ; remettre aussi les prix dans App Store Connect) | rien | non lancé seul dans `rollback_nuit_check.sh` étape 5 : les tests des tarifs et des élèves offerts attendent la grille du 17/11 ; vérifié marche par marche (étapes 2, 3, 6) et dans `prod_order_test.sh` |
| −12 | `20261117020000_charge_coach_down.sql` (fonctions d'avant : mêmes réponses, plus lentes ; envoi de programmes revenu à 30 par 24 h) | rien | oui (vérifié) |
| −11 | `20261117010000_photo_profil_down.sql` (vider d'abord le compartiment `profile-photos` par l'API Storage : il refuse sinon ; redéployer ensuite `coach-photos-purge` dans sa version d'avant, qui ne connaît pas ce compartiment) | rien | oui (vérifié) |
| −10 | `20261116030000_eleves_gratuits_down.sql` (élèves offerts par leur coach : retour à l'élève payant et au code d'offre −25 %) | rien | non lancé seul dans `rollback_nuit_check.sh` étape 5 : les tests des tarifs et du payant attendent la règle du 16/11 ; vérifié marche par marche (étapes 2, 3, 6) et dans `prod_order_test.sh` |
| −9 | `20261116020000_notifications_seances_eleves_down.sql` | résumé des séances (−15) : il remplace ses fonctions et s'appuie sur `student_sessions` ; J'aime (−16) : il remplace son `push_claim` | oui pour les autres lots (vérifié, sans `messages_coach_test.sql`) ; refuse s'il reste un résumé en file : défaire −16 puis −15 avant |
| −8 | `20261116010000_charge_prescrite_down.sql` | rien | oui (vérifié) |
| −7 | `20261107000000_photos_bilan_down.sql` (vider d'abord le compartiment `coach-photos` par l'API Storage : il refuse sinon ; il retire lui-même la tâche pg_cron `coach-photos-purge` et le secret Vault `photos_purge_secret` ; restent à la main `supabase functions delete coach-photos-purge` et `supabase secrets unset PHOTOS_PURGE_SECRET`) | rien | oui (vérifié) |
| −6 | `20261106200000_plans_diete_coach_down.sql` | rien | oui (vérifié) |
| −5 | `20261106100000_seance_publique_intensif_prise_down.sql` | rien | oui (vérifié) |
| −4 | `20261106000000_coach_progression_down.sql` | rien | oui (vérifié) |
| −3 | `20261105010000_partage_mensurations_down.sql` | plans diète du coach (−6) : il réécrit après lui la contrainte de `coach_shares.kind`, `share_kind_open` et `student_shares` | oui pour les autres lots (vérifié) ; l'accord des plans diète ne marche plus alors : défaire −6 avant |
| −2 | `20261105000000_coach_planning_down.sql` | rien | oui (vérifié) |
| −1 | `20261101000000_parrainage_payant_down.sql` | rien | oui (vérifié) |
| 0a | `20261031910000_notifications_messages_down.sql` | séances des élèves (−8) : elles remplacent ses fonctions | non |
| 0 | `20261031900000_notifications_push_down.sql` | notifications des messages et commentaires (0a) : elles remplacent ses fonctions | non |
| 1 | `20261031620000_strava_down.sql` (Strava en sommeil : migration à ne pas appliquer au lancement, docs/STRAVA.md) | rien | oui (vérifié) |
| 2 | `20261031510000_chat_coach_down.sql` | notifications des messages (0a) : son déclencheur lit coach_messages | non |
| 3 | `20261031500000_commentaires_down.sql` | notifications des messages (0a) : elles s'appuient sur les commentaires ; le chat (2) avant, conseillé par son en-tête | non |
| 4 | `20261031400000_parrainage_down.sql` | parrainage du payant (−1) : la table des paiements référence les attributions | non, refuse sans rien changer |
| 5 | `20261031300000_partage_coach_down.sql` | mensurations partagées (−3) : leur table s'appuie sur `coach_shares` ; plans diète du coach (−6) : son accord et son déclencheur sont sur `coach_shares` | non |
| 6 | `20261031230000_newsletter_down.sql` | rien | oui (vérifié) |
| 7 | `20261031200000_reactions_profil_down.sql` | J'aime (−15) : il réécrit `set_reaction` et `reaction_top` ; commentaires (3) | non |
| 8 | `20261031100000_records_series_down.sql` | progression des élèves (−4) : `coach_progress` lit `private.session_records` ; séance publique (−5) de préférence avant (seul, il remplace aussi son `session_public`) | non (seul, tout le reste marche : vérifié sans les tests de la progression ni de la séance publique) |
| 9 | `20261031000000_payant_plus_down.sql` | rien | oui (vérifié) |
| 10 | `20261030000000_payant_tarifs_down.sql` | payant plus (9), élèves offerts (−10) | non, refuse sans rien changer |
| 11 | `20261029000000_payant_modele_b_down.sql` | tarifs (10) | non, refuse sans rien changer |

« Dépend de » : la migration plus récente réécrit des fonctions de celle-ci (my_activity, réécrite par les commentaires, pour 7 ; access_json, access_refresh, access_claim, srv_access_* pour 10 et 11). Les retours arrière 4, 10 et 11 s'arrêtent d'eux-mêmes (exception, transaction annulée) si la migration du dessus est encore en place. Pour 7, suivre l'ordre : lancé avant 3, il retire mark_activity_seen et my_shown_sessions que les commentaires utilisent.

Les retours arrière marqués « oui (vérifié) » ont été lancés seuls sur la pile complète, puis les tests SQL de tous les autres lots ont été relancés et sont verts : ils ne cassent aucune migration postérieure restée en place.

## En production : ordre de la mise en production, et son inverse

**État de la production relu le 17/11/2026** (lecture seule : fonctions et colonnes présentes, `entitlements` encore au format du 28/10 avec `trial_started_at` et des lignes `trial`) : toutes les migrations de `main` jusqu'au lot 3 (notifications push et des messages comprises), `20261028000000_payant.sql`, puis, dans cet ordre :

- `20261105000000_coach_planning.sql`, `20261105010000_partage_mensurations.sql`, `20261106000000_coach_progression.sql`, `20261106100000_seance_publique_intensif_prise.sql` (07/11 vers 20 h, avant l'OTA 2026.11.7-2633219) ;
- `20261106200000_plans_diete_coach.sql` (juste après cette OTA) ;
- `20261107000000_photos_bilan.sql` (vague 2, avec la fonction `coach-photos-purge`, son secret et sa planification) ;
- `20261116010000_charge_prescrite.sql`, puis la fonction Edge `push-send` redéployée (v7), puis `20261116020000_notifications_seances_eleves.sql` (12 et 13 de l'ancienne liste, en production le 17/11/2026, dans cet ordre).

Chacune dans une transaction par l'éditeur SQL (API de gestion). Les migrations du payant datées d'avant (modèle B, tarifs, payant plus, lettre, parrainage du payant) n'y étaient **pas** : elles sont arrivées **après** des migrations plus récentes qu'elles (liste ci-dessous).

### État de la production au 17/11/2026, après la mise en production du payant (feu vert de Maxence)

**Les 10 migrations de la liste ci-dessous sont en production**, appliquées le 17/11/2026 entre 14 h 30 et 14 h 45 (heure de Paris), dans cet ordre, chacune dans sa transaction (`begin; … commit;` par l'API de gestion), **verrou `paywall_on` toujours éteint**. Rien d'autre : Strava (`20261031620000`) n'est pas appliquée.

- **Avant** (lecture seule) : `entitlements` = 3 `trial`, 2 `coach_team` ; les 191 fonctions et 480 colonnes, contraintes, déclencheurs et politiques de la production identiques, empreinte par empreinte, à une copie locale (Postgres 17) des migrations de la liste du haut.
- **Après chaque migration** : mêmes empreintes (source des fonctions, `SECURITY DEFINER`, réglages, colonnes, contraintes, déclencheurs, politiques) que la même copie locale avancée d'une marche ; à la fin 250 fonctions et 642 objets identiques, et les droits effectifs d'`anon`, `authenticated` et `service_role` sur 308 tables et fonctions identiques. `entitlements` : 5 `none` (les `trial` et `coach_team` du 28/10 sont devenus `none`).
- **Répétition** juste avant : `prod_order_test.sh` vert (Postgres 17), puis les 10 migrations rejouées sur une copie locale chargée des **données réelles** de la production (droits des 6 comptes identiques à ceux relus ensuite en production).
- **Droits réels relus en production** (RPC appelées comme chaque compte, transaction annulée) : les 6 comptes ont `can_write` vrai ; les 3 coachs (dont Dylan et Elkoue) gardent leur rôle (limite 50 verrou éteint) et leur code permanent créé par les tarifs ; Cyril reste élève de Dylan, eleve_demo et lilou de maxencedlf. `coach_cover` des 3 élèves = `ended` (aucun abonnement coach) : sans effet verrou éteint, mais **ils perdraient l'accès si le verrou était allumé sans abonnement coach de leur coach**.
- **Secrets** posés (`supabase secrets set`) : `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY` (clé In-App Purchase `78L95MG5FL`), `APPLE_ISSUER_ID`.
- **Fonctions Edge**, toutes `verify_jwt = false` (jeton vérifié dans le code : 401 `{"error":"auth"}` sans jeton, contrôlé) : `verify-purchase` v6 (était v4 du 28/10 en `verify_jwt = true` : la passerelle ne vérifie que l'ancien secret HS256, le projet signe en ES256), `appstore-notify` v7 (la v5 du 13/11 avait déjà ce code), `coach-request-alert` v1, puis après les migrations 6 à 10 : `coach-photos-purge` v5 (purge lancée une fois à la main par la commande de sa tâche pg_cron : `{"removed":0,"failed":false}` ; tâche `coach-photos-purge` toujours chaque heure à 17), `delete-account` v14, `coach-promo-offer` v1. `report`, `revoke-apple` et `push-send` inchangées (code identique à la branche ; leur numéro de version a avancé d'un cran au téléchargement de sauvegarde, corps identique).
- `profile_photo_rls` n'est pas exposé par l'API (schémas exposés : `public`, `graphql_public`) ; compartiment `profile-photos` privé.
- **App Store Connect** : code d'offre « Eleve de coach -25 pct 12 mois » (`9a963bbc-…`) **désactivé** ; aucun code d'offre actif sur `pro.monthly`.
- **Sauvegarde d'avant** : `~/.local/share/mdlf/sauvegardes/prod_20261117_payant/` (définitions et droits des fonctions, colonnes, contraintes, déclencheurs, politiques, index, cron, compartiments, contenu JSON des 43 tables public et private, code déployé des fonctions Edge en ESZIP et en source `edge/src_<fonction>/`, code d'offre avant et après).
- **Défaire** : retours arrière de la liste dans l'ordre inverse (10 → 1, en-tête de chaque fichier). Côté fonctions : supprimer `coach-promo-offer` avant −10 ; avant −1 (modèle B), redéployer `verify-purchase` depuis `edge/src_verify-purchase/` de la sauvegarde (v4, ancienne signature) et `appstore-notify` depuis le parent de `d589cca` (la v5 d'avant envoyait déjà `p_intro` et `p_environment` : aucune notification d'Apple n'a jamais été reçue, `appstore_notifications` et `entitlement_claims` étaient vides) ; `coach-photos-purge` et `delete-account` d'avant depuis `edge/src_<fonction>/` après −7 (photo de profil). Code d'offre : PATCH `active: true`.

### État de la production au 18/11/2026, après la vague 3 (feu vert de Maxence)

**La production est à jour de toute la liste ci-dessous (1 à 13)**, verrou `paywall_on` toujours éteint, Strava (`20261031620000`) toujours pas appliquée. Le 18/11/2026, depuis la branche `vague-3` (`acd5a9a`), entre 06 h 36 et 06 h 39 (heure de Paris), dans cet ordre :

1. Fonction Edge `push-send` redéployée (`supabase functions deploy push-send --use-api --yes`) : **v9**, `verify_jwt = false` inchangé, `index.ts` et `push-policy.js` (❤️ et `student_digest`). La v8 d'avant avait le code de la v7 du 17/11 (même `ezbr_sha256` `cc6e8447…`, numéro avancé par le téléchargement de sauvegarde).
2. `20261117050000_messages_coach.sql`, puis `20261117060000_reaction_jaime.sql`, puis `20261117090000_badge_carte_pro.sql`, chacune dans sa transaction (`begin; … commit;` par l'API de gestion).

- **Avant** (lecture seule) : les 250 fonctions, 642 objets (colonnes, contraintes, déclencheurs, politiques) et les droits effectifs d'`anon`, `authenticated` et `service_role` sur 308 tables et fonctions identiques, empreinte par empreinte, à une copie locale (Postgres 17) des migrations de la production jusqu'à `20261117040000`.
- **Répétition** juste avant, en local : `prod_order_test.sh`, `rollback_messages_coach_check.sh`, `rollback_reaction_jaime_check.sh` et `rollback_nuit_check.sh` verts. `rollback_nuit_check.sh` a échoué une fois sur trois passages (`commentaires_test.sql`, « vue : pastille », pendant l'étape « 20261105010000 seul ») puis est repassé vert en entier : test probablement sensible à l’horloge (deux `now()` de transactions successives), lot des commentaires du 31/10, sans lien avec la vague 3.
- **Après chaque migration** : mêmes empreintes que la même copie locale avancée d'une marche ; à la fin 262 fonctions, 673 objets et 322 droits identiques. Droits : `coach_push_off` à `authenticated` seul ; `coach_card_state`, `coach_card_declare`, `coach_card_withdraw`, `coach_card_badge`, `report_coach_card` à `authenticated` (et `service_role`) ; `public.coach_cards`, `private.coach_cards_review` et les fonctions privées sans aucun droit d'API ; rien d'`anon`.
- **RPC relues sur les vrais comptes** (appelées comme chaque compte, transaction annulée) : `set_reaction` avec `like` acceptée ; `push_claim` rend `reaction: like` et le nom de la séance pour une réaction, et un résumé `{ kind: student_digest, ref: '', count: 1 }` au-delà de 3 séances notifiées dans l'heure ; `coach_push_off` rend les élèves sans notification des 2 coachs qui en ont, `[]` pour les autres ; badge : déclaration d'un faux numéro, badge vu par une élève sans le numéro, `not_coach` pour un élève. Droits et accès des 6 comptes (`access_state`, `my_access`, `coach_tier_state`, `coach_state`…) identiques avant et après ; les 10 réactions existantes (toutes 👏) intactes ; file, appareils, réglages, tâches pg_cron et signalements inchangés ; aucune carte déclarée, aucun ❤️, aucun résumé en base.
- **Notifications** : aucune envoyée (aucune ligne soldée depuis) ; appels de la planification `push-send` à 200 (`{"sent":0,…}`) chaque minute avant, pendant et après.
- `controle-supabase` : 0 haut (96 moyen, 76 bas ; écarts avec la veille : les 6 RPC ajoutées, `coach_cards` sous RLS sans politique et son index pas encore servi).
- **Sauvegarde d'avant** : `~/.local/share/mdlf/sauvegardes/prod_20261118_vague3/` (définitions et droits des fonctions, droits effectifs, colonnes, contraintes, déclencheurs, politiques, index, cron, compartiments, contenu JSON des 55 tables public et private, empreintes d'avant, code déployé de `push-send` en ESZIP et en source `edge/src_push-send_v7/`, les 3 retours arrière).
- **Défaire** : OTA d'avant, puis `20261117090000_badge_carte_pro_down.sql`, `20261117060000_reaction_jaime_down.sql`, `20261117050000_messages_coach_down.sql`, dans cet ordre. `push-send` peut rester ; pour revenir à la v7, redéployer depuis `edge/src_push-send_v7/` de la sauvegarde (après le retour arrière de `20261117050000`, sinon un résumé en file serait soldé sans envoi).

### Ordre appliqué (vérifié par `tests/sql/prod_order_test.sh`)

Production simulée avec des données dans l'ordre ci-dessus, puis cette liste ; schéma obtenu identique à une base neuve, tests de tous les lots verts, puis retours arrière dans l'ordre inverse, état d'avant retrouvé à chaque marche.

1. `20261029000000_payant_modele_b.sql` (contrôle avant, lecture seule : `select status, count(*) from public.entitlements group by 1;` ; les lignes `trial` deviennent `none` : sans effet tant que le verrou `paywall_on` est éteint, `can_write` reste vrai pour tous)
2. `20261030000000_payant_tarifs.sql`
3. `20261031000000_payant_plus.sql`
4. `20261031230000_newsletter.sql`
5. `20261101000000_parrainage_payant.sql`
6. `20261116030000_eleves_gratuits.sql` (élèves offerts par leur coach, décision du 16/11/2026, docs/PAYANT_V1.md) : APRÈS 1 à 3 (il réécrit `access_json` des tarifs) ; collée avant, elle échoue dans sa transaction sans rien changer (`prod_order_test.sh`, étape 6). Aucune fonction Edge à redéployer pour elle.
7. `20261117010000_photo_profil.sql` (photo de profil, docs/PHOTO_PROFIL.md : indépendante, passe aussi seule sur la production de départ, étape 7 ; avec `coach-photos-purge` redéployée, qui purge aussi ce compartiment, et `delete-account` ; avant l'OTA qui montre la cellule). Renommée le 17/11 (anciens noms `20261116000000` puis `20261117000000`) pour garder l'ordre des dates égal à l'ordre de la production.
8. `20261117020000_charge_coach.sql` (charge côté coach, mesures de `tests/charge/` : séances lues 3 fois plus vite à réponse identique, progression sans relire 182 jours, envoi de programmes à 30 + 2 par élève sur 24 h ; après 20261116010000 (en production) et les plans diète, dont elle réécrit les fonctions ; sans OTA)
9. `20261117030000_grille_coach.sql` (grille coach du 17/11/2026 : 10, 25, 50, 100 élèves, docs/PAYANT_V1.md) : APRÈS 6 (il réécrit `coach_tier_state` des élèves offerts). Aucune fonction Edge à redéployer. Les prix se changent dans App Store Connect, à part.
10. `20261117040000_promo_coach.sql` (essai coach par offre promotionnelle d'Apple, docs/PAYANT_V1.md) : APRÈS 6 (il relit le journal des descentes de palier `private.coach_tier_log`) ; puis la fonction Edge `coach-promo-offer` (secrets de `verify-purchase`), puis la build 69 avec l'OTA.
11. `20261117050000_messages_coach.sql` (boîte Messages du coach, test de charge du 17/11 : résumé des séances au-delà de 3 par heure, `coach_push_off`) : la fonction Edge `push-send` (avec `push-policy.js`, version qui connaît aussi ❤️) redéployée AVANT (elle doit connaître `student_digest`, sinon la ligne est soldée sans envoi), puis la migration, puis l'OTA (une app d'avant ignore `coach_push_off` ; une app à jour sur un serveur d'avant ne montre aucune cloche). Aucune dépendance au payant : passe aussi seule après 20261116020000. En production depuis le 18/11/2026 (section ci-dessous).
12. `20261117060000_reaction_jaime.sql` (réaction ❤️ « J'aime », docs/SOCIAL_V1.md « J'aime ») : APRÈS 11, dont elle reprend `push_claim` (résumé des séances) en y ajoutant la réaction ; renommée le 17/11 (ancien nom `20261117000000`, plus ancien que la production) ; **avant** l'OTA. Une app à jour sur un serveur d'avant ne peut pas aimer (`invalid_reaction`) ; une app d'avant sur ce serveur ignore les ❤️ sans planter. push-send peut passer juste avant ou juste après la migration : sans les nouveaux champs il dit « lea a aimé ta séance », l'ancien push-send dit encore « Bravo ! » tant qu'il n'est pas redéployé. Retour arrière : l'ordre inverse (OTA d'avant, puis `20261117060000_reaction_jaime_down.sql` ; push-send peut rester).
13. `20261117090000_badge_carte_pro.sql` (badge « Carte pro déclarée », docs/COACH_V1.md « Badge carte pro ») : indépendante (nouvelle table `coach_cards`, aucune fonction existante réécrite), aucune fonction Edge ; avant l'OTA qui montre la section « Carte professionnelle ». Une app d'avant l'ignore.

Mise en production de la vague 3 : `push-send` d'abord (une seule fonction Edge : `index.ts` et `push-policy.js` partent ensemble), puis 11, 12 et 13 dans cet ordre, puis l'OTA. Retour arrière : OTA d'avant, puis 13, 12, 11 défaits dans cet ordre (`push-send` peut rester).

Les fonctions Edge du payant (`verify-purchase`, `appstore-notify`, puis `coach-request-alert`) se déploient juste APRÈS 1 à 3 : elles envoient `p_intro` et `p_environment`, que la base du 28/10 ne connaît pas (docs/PAYANT_V1.md, « Mise en production »).

Jamais `20261031620000_strava.sql` au lancement (Strava en sommeil, docs/STRAVA.md).

Chaque fichier se colle dans l'éditeur SQL, dans cet ordre, l'un après l'autre. Pas de `supabase db push` : il refuse ces fichiers, plus anciens que la dernière migration appliquée ; et **jamais `supabase db push --include-all`**, qui pousserait d'un coup tout ce qui manque (et Strava).

Pour défaire en production : l'ordre inverse de cette liste (13 → 1), avant tout retour arrière plus ancien (tableau du haut).

## Ce qui est mis de côté, pas effacé

- `private.parrainage_archive_*` (parrainage : partenaires, conditions des coachs, attributions, virements) ;
- `private.tarifs_archive_*` (demandes de rôle coach, codes d'offre Apple) ;
- `private.parrainage_payant_archive_payments` (paiements d'Apple notés pour les commissions) ;
- `private.modele_b_archive_*` (offre de lancement et environnement de chaque transaction, plafonds d'élèves gratuits) ;
- `private.payant_plus_*` (accès à vie offerts puis retirés).

Aucun rôle de l'API n'y a accès. Les effacer à la main quand ils ne servent plus. Une nouvelle montée de la migration ne les relit pas.

## Ce qui ne revient pas

- Modèle B : la date de début de l'essai maison (recréée à maintenant pour chaque compte, qui repart pour 90 jours) et les transactions « Accès offert » d'Apple, effacées par la migration. La colonne `entitlements.trial_started_at` revient en dernière position : seule différence de forme avec le 28/10, sans effet.
- Tarifs : les codes permanents des coachs (12 caractères, refusés par la contrainte d'avant).

## Vérifier

```sh
bash tests/sql/rollback_nuit_check.sh     # tous les retours arrière : seuls, puis démontage complet
bash tests/sql/prod_order_test.sh         # mise en production dans l'ordre réel, puis son inverse
bash tests/sql/rollback_lot3_check.sh     # lot 3 : démontage complet et chaque marche seule
bash tests/sql/rollback_check.sh          # réactions, avec données
bash tests/sql/rollback_social_check.sh   # commentaires et chat, avec données
bash tests/sql/rollback_push_check.sh     # notifications push
bash tests/sql/rollback_reaction_jaime_check.sh   # J'aime : ❤️ redevenu 👏, base identique
bash tests/sql/photos_bilan_rollback_test.sh   # photos de bilan : planification et secret de la purge retirés
```

Postgres local jetable, rien n'est envoyé au projet Supabase.
