# Payant V1 : contrat entre l'app, le serveur et Apple

Décisions de Maxence (26/10 au 28/10/2026), dont le **modèle B** voté le 28/10 au soir, puis **tarifs et rôle coach du 30/10/2026** (section « Tarifs du 30/10 », qui remplace les prix et la règle des élèves ci-dessous) :
- **essai gratuit de 3 mois géré par Apple** : c'est une **offre de lancement** (« 3 mois gratuits ») configurée dans App Store Connect sur les deux abonnements. Apple exige un moyen de paiement et garantit **un seul essai par identifiant Apple et par groupe d'abonnements**. Le serveur ne tient plus d'essai maison ;
- puis **tout est payant** (pas de version gratuite limitée) : particulier **6,49 €/mois** et **55,00 €/an** ; coach de **15,99 €** à **29,99 €/mois** selon le nombre d'élèves (prix du 30/10, voir « Tarifs du 30/10 ») ;
- sans abonnement : le profil et l'historique restent **consultables**, l'**export** reste possible ; on ne peut plus **enregistrer de nouvelle séance** ;
- **compte obligatoire pour enregistrer une séance quand le verrou est allumé** (vote 8 contre 2), connexion avec Apple en premier ; verrou éteint, rien ne change ; Historique, Progrès et export restent toujours ouverts, avec ou sans compte ;
- **« Accès offert » d'Apple supprimé** (10 voix sur 10) : le non consommable `com.mdlf.training.access.gift` n'est plus reconnu nulle part ; Maxence supprime le produit dans App Store Connect ;
- **codes cadeaux maison** (inchangés) : les codes promotionnels d'Apple sont limités à 100 par version, expirent en 28 jours et se saisissent dans l'App Store ; nos codes sont faits par notre serveur (voir « Codes cadeaux maison ») ;
- codes d'offre d'abonnement d'Apple : **1 an gratuit au maximum** ;
- ~~élève suivi par un coach gratuit, 10 au plus par coach~~ : **retiré le 30/10** par Maxence. Un élève paie, avec **−25 % pendant 12 mois** grâce au code de son coach, sans essai gratuit. Le **rôle coach** est réservé aux éducateurs sportifs diplômés (demande vérifiée à la main) et le coach paie un abonnement coach à paliers.

**Payant plus (31/10/2026, branche `nuit-payantplus`)** : accès à vie payant `com.mdlf.training.lifetime`, accès à vie offerts révocables et tracés, reconnaissance de TestFlight. Voir « Payant plus » plus bas.

**Le verrou est livré ÉTEINT.** Tant que `app_config.paywall_on` est faux, l'app ne bloque rien. On allume après validation de Maxence.

## Produits App Store Connect
Groupe d'abonnement `MDLF Training Acces` (id **22520671**), app id **6823561962**. Tous dans le **même groupe** : un seul abonnement actif à la fois par identifiant Apple, et **un seul essai gratuit par identifiant Apple pour tout le groupe** (un particulier qui a déjà eu son essai n'en a pas un second en passant coach).

| Produit | Identifiant | ASC id | Niveau | France | BEL | CHE | CAN | USA |
|---|---|---|---|---|---|---|---|---|
| Coach illimité mensuel | `com.mdlf.training.coachmax.monthly` | 6829035229 | 1 | 29,99 € | 29,99 € | 25,00 CHF | 34,99 $ CA | 24,99 $ |
| Coach illimité annuel | `com.mdlf.training.coachmax.yearly` | 6829035364 | 2 | 250,00 € | 250,00 € | 200,00 CHF | 299,00 $ CA | 229,00 $ |
| Coach 30 élèves mensuel | `com.mdlf.training.coach30.monthly` | 6829035217 | 3 | 24,99 € | 24,99 € | 20,00 CHF | 29,99 $ CA | 22,99 $ |
| Coach 30 élèves annuel | `com.mdlf.training.coach30.yearly` | 6829035393 | 4 | 209,99 € | 209,99 € | 180,00 CHF | 249,99 $ CA | 199,99 $ |
| Coach 20 élèves mensuel | `com.mdlf.training.coach20.monthly` | 6829035210 | 5 | 19,99 € | 19,99 € | 15,00 CHF | 24,99 $ CA | 17,99 $ |
| Coach 20 élèves annuel | `com.mdlf.training.coach20.yearly` | 6829035275 | 6 | 169,00 € | 169,00 € | 120,00 CHF | 199,00 $ CA | 149,00 $ |
| Coach 10 élèves mensuel | `com.mdlf.training.coach10.monthly` | 6829035180 | 7 | 15,99 € | 15,99 € | 14,00 CHF | 19,99 $ CA | 14,99 $ |
| Coach 10 élèves annuel | `com.mdlf.training.coach10.yearly` | 6829035208 | 8 | 134,99 € | 134,99 € | 100,00 CHF | 149,99 $ CA | 119,99 $ |
| MDLF Training mensuel | `com.mdlf.training.pro.monthly` | 6827767578 | 9 | 6,49 € | 6,49 € | 5,00 CHF | 7,99 $ CA | 5,99 $ |
| MDLF Training annuel | `com.mdlf.training.pro.yearly` | 6827767660 | 10 | 55,00 € | 55,00 € | 40,00 CHF | 69,00 $ CA | 49,00 $ |

| Accès à vie (**proposé, PAS créé**) | `com.mdlf.training.lifetime` | à créer | hors groupe | ≈ 90 € (89,99 € proposé) | équivalence | équivalence | équivalence | équivalence |

- **Essai** : offre de lancement « 3 mois gratuits » (FREE_TRIAL, THREE_MONTHS) sur **les dix** abonnements, dans les 5 pays. L'accès à vie n'a pas d'essai.
- **Pays** : FRA, BEL, CHE, CAN, USA (disponibilité de chaque produit, `availableInNewTerritories` vrai). Prix France choisis par Maxence ; les 4 autres pays = **équivalence automatique d'Apple** (`equalizations` du prix France), sauf **CHE coachmax mensuel** relevé à **25,00 CHF** (l'équivalence donnait 20,00 CHF, le même prix que coach30). Ces équivalences sont parfois basses (CHE, USA) : à revoir par Maxence s'il veut des prix ronds par pays. Les autres pays qu'Apple ouvrirait plus tard prendront aussi l'équivalence automatique.
- **Niveaux** (ordre du groupe, 1 = le plus haut) : chaque palier coach est au-dessus du palier inférieur, et tout le coach est au-dessus du particulier. Passer de coach10 à coach20 (ou de particulier à coach) est donc une **montée** : immédiate chez Apple, avec remboursement au prorata de la période en cours ; une **descente** prend effet au renouvellement suivant. Mensuel et annuel d'un même palier sont à deux niveaux voisins (l'API n'en met pas deux au même niveau) : passer du mensuel à l'annuel d'un même palier est une descente, appliquée au renouvellement.
- **Offre élève** : code d'offre « Eleve de coach -25 pct 12 mois » (id `9a963bbc-d2c8-4478-8ba3-6bc74abc067d`) sur `pro.monthly` : nouveaux abonnés seulement (`NEW`), remplace l'essai (`REPLACE_INTRO_OFFERS`), payé chaque mois (`PAY_AS_YOU_GO`, 1 mois × 12) à **4,89 €** (BEL 4,89 €, CHE 3,00 CHF, CAN 4,99 $ CA, USA 3,99 $), puis prix normal. Voir « Élève : −25 % pendant 12 mois ».
- Il manque à chaque produit la **capture de revue** (état `MISSING_METADATA`) : à faire par Maxence.

## Principe de sécurité (le point le plus important)
**L'app ne décide jamais seule.** Un appareil peut être modifié : on ne fait confiance ni à son horloge, ni à son stockage.

- **Le serveur fait foi.** La table `entitlements` est la seule source de vérité, écrite uniquement par le serveur après vérification chez Apple.
- **L'essai est celui d'Apple.** Il n'existe plus de date d'essai côté serveur : rien à réinitialiser en recréant un compte, en réinstallant l'app ou en changeant l'horloge. Une nouvelle adresse e-mail ne redonne rien : c'est Apple qui refuse un second essai au même identifiant Apple.
- **Une preuve d'achat n'est jamais crue sur parole** : l'app transmet la transaction signée par Apple (JWS), et c'est l'**Edge Function** qui en vérifie la signature contre les certificats Apple (racine **Apple Root CA G3** épinglée), puis relit la transaction auprès de l'**App Store Server API**. Aucune RPC ne permet à un client d'écrire un droit d'accès.
- **Un abonnement ne sert qu'à un compte** : `original_transaction_id` est **unique**. La même transaction sur un second compte est refusée (`transaction_taken`).
- **Un remboursé le reste, sauf réabonnement réel** : `revoked_at` n'est levé que par un évènement à la fois **plus récent** et portant une période **strictement plus lointaine**.
- **Le serveur est prévenu par Apple** (App Store Server Notifications V2) : l'accès tombe tout seul, même si l'app n'est jamais rouverte.
- **Hors ligne** : l'app garde le dernier droit connu **signé par le serveur** avec une date d'expiration courte. Elle ne peut pas se prolonger elle-même.

## Données (serveur)
- `entitlements (user_id pk, status, product_id, expires_at, original_transaction_id unique, gift bool, gift_until, in_coach_team bool, updated_at)`.
  - `status` : `none` (jamais eu d'accès) | `active` (abonnement Apple, particulier ou coach, offre de lancement ou code d'offre compris) | `expired` (un accès a existé, il est échu ou remboursé) | `gift` (code cadeau maison) | ~~`coach_team`~~ (élève gratuit, plus produit depuis le 30/10). `in_coach_team` : toujours faux depuis le 30/10.
  - `gift` : accès **à vie** (code cadeau maison `lifetime`). `gift_until` : fin d'un **cadeau en jours**, cumulée à chaque code. `expires_at` : la plus lointaine des deux dates (abonnement payé, cadeau en jours).
  - Plus de `trial_started_at` (retirée par `20261029000000_payant_modele_b.sql`).
  - RLS fermée sans politique, aucun GRANT : lecture seulement par RPC, écriture seulement par les fonctions du serveur.
- `entitlement_claims (original_transaction_id pk, user_id, product_id, kind = 'sub' | 'life' (accès à vie, payant plus), expires_at, revoked_at, event_at, intro_offer, environment, created_at, updated_at)` : registre **à vie** des transactions Apple vérifiées. `intro_offer` : la transaction appliquée en dernier est dans l'offre de lancement. `environment` : `Production` ou `Sandbox`. RLS fermée, aucun GRANT.
- `app_config (key pk, value jsonb)` : `paywall_on` (booléen, défaut **false**) et `min_build` (build native minimale, défaut **0** = aucune). `trial_days` a été retiré. Lisible par `authenticated` ; **anon ne lit que les lignes `paywall_on` et `min_build`** (colonnes `key`, `value`). Écrit seulement par l'administrateur.
- `private.coach_free_limits` : plus lue depuis le 30/10 (gardée pour revenir en arrière).
- `coach_requests`, `coach_offer_codes`, `coach_origins`, `private.tarifs_ex_coach_team`, colonne `coach_invites.permanent` : voir « Tarifs du 30/10 ».
- `gift_codes` et `gift_redemptions` : voir « Codes cadeaux maison » ; colonnes `revoked_at` et `revoke_reason` ajoutées par le payant plus (accès à vie révocables).

## Fonctions RPC (rôle `authenticated`)
| Fonction | Renvoie | Règles |
|---|---|---|
| `my_access()` | `jsonb` | `{ status, until, paywall_on, days_left, can_write, gift, gift_until, coach_team, intro_offer, intro_until, lifetime, also_sub, server_now }` (`lifetime` et `also_sub` : payant plus). Crée la ligne `entitlements` (statut `none`) au premier appel, sans rien donner. `can_write` = droit d'enregistrer une séance : **toujours `true` tant que `paywall_on` est faux** ; verrou allumé, vrai seulement pour `active` et `gift` (plus `coach_team` depuis le 30/10). `intro_offer` / `intro_until` : l'abonnement en cours est dans l'offre de lancement d'Apple, et sa fin. |
| `access_state()` | `jsonb` | Même état, en lecture seule, sans rien créer. |
| `redeem_gift_code(code text)` | `jsonb` | Code cadeau maison : `{ ok, error, kind, access }`, un refus de code n'est **pas** une exception. |
| `coach_request_state()` / `coach_request_submit(card_name, card_number, diploma)` | `jsonb` | Demande du rôle coach (« Tarifs du 30/10 »). |
| `coach_my_code()` | `jsonb` | Code permanent du coach validé. |
| `coach_tier_state()` | `jsonb` | Palier du coach : limite, nombre d'élèves, plein, produit suivant. |
| `student_offer_code(env)` | `jsonb` | Code d'offre Apple −25 % d'un élève, refus dans `error`. |

Aucune RPC d'écriture du droit d'accès venant d'Apple : les écritures d'abonnement viennent des Edge Functions.

## Edge Functions
- **`verify-purchase`** (`verify_jwt = false` dans `supabase/config.toml` : le jeton est vérifié dans le code, `caller()` → `_shared/auth-guard.js` → `auth.getUser`, 401 avant tout travail ; prouvé par `tests/unit/auth-guard.mjs`) : entrée `{ jws }`. Vérifie la chaîne de certificats Apple, le `bundleId`, l'environnement (**Production ou Sandbox, tous deux acceptés**, Xcode refusé), relit la transaction par l'**App Store Server API** (`/inApps/v1/transactions/{id}`, hôte Production ou Sandbox selon la transaction), lit l'**offre de lancement** et écrit `entitlements` par `srv_access_purchase(…, p_intro, p_environment)`. Erreurs : `invalid_jws`, `bad_bundle`, `bad_environment`, `unknown_product`, `bad_type`, `not_purchased`, `invalid_transaction`, `transaction_taken`, `not_found`, `rate_limited`.
- **`coach-request-alert`** (30/10) : alerte e-mail d'une nouvelle demande du rôle coach, voir « Tarifs du 30/10 ».
- **`appstore-notify`** (pas de JWT, vérifiée par la signature Apple ; à déployer avec `--no-verify-jwt`) : reçoit les **App Store Server Notifications V2**. Traite `SUBSCRIBED`, `DID_RENEW`, `DID_CHANGE_RENEWAL_STATUS`, `EXPIRED`, `GRACE_PERIOD_EXPIRED`, `REFUND`, `REVOKE` et `DID_FAIL_TO_RENEW` (période de grâce de facturation), plus, pour l'accès à vie (payant plus), `ONE_TIME_CHARGE` et `REFUND_REVERSED`. Production et Sandbox acceptés ; offre de lancement et environnement remontés par `srv_access_event(…, p_intro, p_environment)`.

## Modèle B : l'essai gratuit est celui d'Apple (28/10/2026)
- **Ce qui a été retiré** (migration `20261029000000_payant_modele_b.sql`, la migration du 28/10 étant déjà en production) : l'essai maison (`trial_started_at`, `trial_days`, statut `trial`), le rattachement de l'essai à l'identifiant Apple (`verify-app-transaction`, `store_installs`, purge à 2 ans, plafond « sans preuve », plateforme déclarée, `appTransaction()` du Swift et du JS), et l'« Accès offert » d'Apple. Le piège évité : sans ce retrait, un compte aurait eu 3 mois de serveur **puis** 3 mois d'Apple.
- **Offre de lancement** : l'achat d'un abonnement par quelqu'un qui y a droit commence par 3 mois gratuits, que StoreKit annonce (`introEligible`, `offer`). Côté serveur, c'est un abonnement `active` comme un autre ; la transaction signée porte **`offerType` = 1** (`OfferType.INTRODUCTORY_OFFER` de l'App Store Server Library) et **`offerDiscountType` = `FREE_TRIAL`** (avec `offerPeriod`, par exemple `P3M`). Le serveur retient `intro_offer`, vrai seulement quand `offerType` vaut 1 **et** `offerDiscountType` vaut `FREE_TRIAL` (une offre de lancement payante ne s'affiche jamais comme « Essai gratuit »), et expose `intro_until` = la fin de cette période. Au premier renouvellement payé (sans `offerType`), `intro_offer` repasse à faux.
- **Écran d'abonnement** (règle 3.1.2(c) d'Apple : l'essai ne doit pas dominer le prix réellement débité) : chaque formule montre **en gros le prix et sa période** (« 55,00 € par an »), et « 3 mois gratuits » en **ligne secondaire** seulement si Apple l'accorde encore. Au-dessus des formules, ce que donne l'abonnement (« tu enregistres de nouvelles séances ; ton historique, tes progrès et l'export restent ouverts »). Le texte du haut dit exactement : « 3 mois gratuits, puis l'abonnement continue sauf si tu le résilies au moins 24 heures avant la fin de l'essai » (Apple demande de résilier au moins 24 h avant : https://support.apple.com/en-us/118428). Les mentions sous les formules disent la même chose (« sauf si tu le résilies au moins 24 heures avant la fin de l'essai », puis le renouvellement automatique « pour la même période », sans promettre « au même prix »).
- **Verrou éteint : aucune formule n'est proposée** (relecture du 28/10). Ni « Voir les formules » dans Réglages › Abonnement, ni prix sur l'écran d'abonnement : acheter ferait commencer l'essai d'Apple pour rien, et la personne serait débitée 3 mois plus tard. « Restaurer mes achats », « Gérer chez Apple » et les codes restent.
- **Décision de Maxence : la build part à l'examen d'Apple avec le verrou ALLUMÉ**, pour que l'abonnement débloque vraiment quelque chose (règle 3.1.2(a)). En **TestFlight**, le verrou reste éteint et les formules sont donc masquées. À côté des boutons, les **mentions de la règle 3.1.2** d'Apple : durée de l'essai, prix et période après l'essai, renouvellement automatique (sauf résiliation au moins 24 h avant la fin de la période), résiliable à tout moment dans les réglages de l'identifiant Apple, puis les liens **Conditions d'utilisation** et **Confidentialité**. Une phrase rappelle qu'un identifiant Apple n'a droit qu'à un seul essai et qu'un même abonnement ne sert qu'à un compte.
- **Réglages › Abonnement** pendant l'essai : « **Essai gratuit jusqu'au <date>, puis <prix>** » (date du serveur, formule lue dans les droits en cours de l'iPhone, prix lu chez StoreKit).
- Le bandeau « il te reste N jours » de l'essai maison a disparu ; le bandeau de l'accueil ne s'affiche plus que quand l'écriture est refusée.

## Sandbox accepté en production (28/10/2026)
- **Pourquoi** : l'équipe d'examen d'Apple teste les achats d'une version de **production** en environnement **Sandbox**. Refuser le Sandbox (ce que faisait `APPLE_ALLOW_SANDBOX`, retiré) menait à un refus quasi certain. `verify-purchase` et `appstore-notify` acceptent donc les deux environnements, avec la **même** chaîne de signature et le **même** `bundleId`, et l'environnement est **enregistré** sur chaque transaction (`entitlement_claims.environment`).
- **Ce que ça ouvre, honnêtement** :
  - Un **compte Sandbox** ne se crée que dans App Store Connect, donc seulement par l'équipe de Maxence, et ne fonctionne que pour les apps de ce compte développeur.
  - Sur un iPhone normal, une app **téléchargée sur l'App Store** achète toujours en **Production** : un utilisateur ne peut pas y payer en Sandbox. Le réglage « Compte Sandbox » n'apparaît que dans **Réglages › Développeur**, donc avec le **mode développeur** activé, après un premier achat dans une app signée pour le développement (documentation StoreKit, vérifiée par Context7 le 28/10).
  - **TestFlight tourne toujours en Sandbox**, même avec un identifiant Apple ordinaire : un testeur TestFlight « s'abonne » sans payer et obtient un vrai accès sur son compte MDLF. Un abonnement TestFlight se **renouvelle chaque jour, 6 fois au plus**, puis s'arrête ; mais le testeur peut **se réabonner gratuitement** autant de fois qu'il veut. **Conséquence : tout testeur TestFlight a l'app gratuite.** C'est l'ouverture réelle, et elle est acceptée parce que le Sandbox est indispensable à l'examen d'Apple.
  - **Règle : jamais de lien TestFlight public une fois le verrou allumé.** Les testeurs restent des personnes invitées par Maxence.
  - Requête d'administration (lecture seule) qui liste les accès Sandbox :
    `select c.user_id, p.username, c.product_id, c.expires_at, c.revoked_at, c.updated_at from public.entitlement_claims c left join public.user_profiles p using (user_id) where c.environment = 'Sandbox' order by c.updated_at desc;`

## Élèves de coach (28/10/2026) : remplacé le 30/10
La gratuité des élèves (statut `coach_team`, 10 élèves gratuits par coach, `private.access_coach_free`) est **retirée** par `20261030000000_payant_tarifs.sql` : voir « Tarifs du 30/10 ».

## Grâce de fin de séance (28/10/2026)
- **Le problème** : une séance commencée avec le droit d'écrire était refusée à « Terminer » si l'abonnement prenait fin pendant la séance.
- **Côté app** : `startSession` note `activeSession.writeOk` (le droit d'écrire au début de la séance). « Terminer » ne passe pas par la porte quand il est vrai. Démarrer une séance, ajouter une séance passée ou en modifier une passent toujours par la porte.
- **Côté serveur** (`private.sessions_paywall`), une séance nouvelle sans droit d'écrire est acceptée seulement si **toutes** ces conditions tiennent :
  - le statut est `expired` et la fin de l'accès (`until`) est connue ;
  - on est **au plus 24 h après cette fin, à l'heure du serveur** (salle sans réseau, envoi le lendemain) ;
  - la séance a **commencé avant la fin et au plus 12 h avant** (début = `data.date - data.duration`, l'app enregistre `date` = fin de séance) ;
  - **2 séances au plus** par fin d'accès (journal `private.social_rate`, action `session_grace`), comptées sous **verrou consultatif** (`pg_advisory_xact_lock(hashtextextended('session_grace:' || user_id, 0))`) : 6 envois simultanés n'en font passer que 2 (`tests/sql/grace_race_test.sh`). Seules les **vraies nouvelles lignes** sont comptées : le test d'existence de la ligne est fait une première fois, puis **refait sous le verrou**, si bien qu'une séance de grâce renvoyée (réessai réseau, correction), même par deux envois simultanés, ne consomme qu'une grâce (`grace_race_test.sh`, second cas).
- **Pourquoi l'antidatage ne sert à rien** : la fenêtre se ferme 24 h après la fin à l'heure du **serveur**, quelle que soit la date déclarée, et ne laisse passer que 2 séances. Sans date de fin connue (jamais abonné, élève dont le coach n'a plus le rôle) : aucune grâce. Une séance refusée quand même reste sur l'iPhone, rien n'est perdu.

## Compte obligatoire quand le verrou est allumé (28/10/2026)
- **Verrou allumé, sans compte** : démarrer une séance, enregistrer une séance passée ou en modifier une ouvre l'écran de connexion (contexte `paywall` d'`openAuthFlow`), **« Continuer avec Apple » en premier**, puis Google et e-mail ; « Annuler » le ferme. Rien n'est supprimé.
- **Verrou éteint ou lu à faux** : **rien ne change**, rien ne bloque.
- **Historique, Progrès et export** restent toujours ouverts.
- **Lire le verrou sans compte** : la seule ligne `paywall_on` de `app_config` est lisible par `anon`. L'app la garde sur l'appareil (`mdlf_paywall_anon`). Sans compte, aucune séance n'atteint le serveur, dont le verrou dur (`sessions_paywall`) reste la vraie garde.
- **Valeur jamais lue** : tant que le verrou n'est **pas mis en service** (constante `PAYWALL_LAUNCHED` de `js/data/access.js`, livrée à `false`), un verrou jamais lu ne ferme **rien**, jamais (« éteint = rien ne bloque »). Une fois mis en service : ouverte seulement **7 jours après la première ouverture de l'app** (date gardée dans le **Trousseau**, `mdlf_first_seen`, elle survit à une réinstallation) ; ensuite une lecture réussie est nécessaire, et l'app le dit (« Connexion à Internet nécessaire »). Un verrou lu à faux une fois ne bloque jamais. Restent ouverts (documentés) : reculer l'horloge de l'iPhone, ou lire le verrou à faux une fois puis bloquer le serveur pour toujours (l'app perd alors toute synchronisation).
- `accessSignInRequired()` exige `account.ready` : au démarrage à froid, un compte connecté ne voit jamais l'écran de connexion.

### Note pour l'équipe d'examen d'Apple (règle 5.1.1(v)), prête à coller
**À trancher par Maxence** : le comportement est codé, cette note l'explique.

> MDLF Training can be used without an account: browsing programs, the exercise library, history, progress charts and data export never require one. An account is only required to record new workouts once the subscription is active, for three reasons. (1) The auto-renewable subscription (with its 3-month free trial offered by Apple) is attached to the user's account on our server, which verifies Apple's signed transactions and App Store Server Notifications; without an account there is nothing to attach the entitlement to, and no way to restore it on a new device. (2) Recorded workouts are synced to that account so they are not lost when the subscription is restored on another iPhone. (3) It lets a coach follow a student's workouts. Sign in with Apple is offered first, alongside Google and a one-time email code; no password is ever required. Users can delete their account and all its data from Settings › Account › Delete my account. Test account for review: [à remplir par Maxence].

## Codes cadeaux maison (28/10/2026)
Fabriqués par Maxence en SQL, utilisés **dans l'app** (Réglages › Abonnement › « J'ai un code »).

- `gift_codes (code pk, kind, days, created_at, expires_at, max_uses défaut 1, uses défaut 0, note)`.
  - `kind` : `lifetime` (accès à vie) ou `days` (N jours offerts, **cumulables**).
  - RLS fermée sans politique, **aucun GRANT** : personne ne lit la table par l'API (sinon tous les codes seraient connus), et **aucune RPC ne crée de code**.
- `gift_redemptions (code, user_id, redeemed_at)`, clé `(code, user_id)` : un compte n'utilise un code qu'une fois. Part en cascade avec le compte ; le compteur `uses` du code, lui, ne redescend pas.
- **Un code ne se devine pas** : la base impose 10 à 24 caractères parmi 32 symboles lisibles (sans `0`/`O`/`1`/`I`). Un code court ou choisi à la main (« NOEL2026 ») est refusé par la contrainte. L'administrateur les fabrique avec `private.make_gift_code(kind, days, n, note [, valid_for, uses_max])`, non exécutable par un rôle de l'API : 12 caractères tirés au hasard, soit 32^12 ≈ 1,2·10^18 possibilités.
  - `select private.make_gift_code('days', 90, 20, 'Beta testeurs');` → 20 codes de 90 jours, valables 1 an, 1 usage chacun.
  - `select private.make_gift_code('lifetime', null, 3, 'Famille');` → 3 accès à vie.
  - `select code, kind, days, uses, max_uses, expires_at, note from public.gift_codes order by created_at desc;`
- **`redeem_gift_code(code text)`** renvoie `{ ok, error, kind, access }` : `access` est la charge utile de `my_access()`, pour que l'app se rafraîchisse d'un seul appel. Saisie souple comme `coach_join` (majuscules, espaces et tirets ignorés).
  - `kind = 'lifetime'` : `gift` passe à vrai, sans date de fin.
  - `kind = 'days'` : `gift_until` = **maximum entre maintenant et l'expiration en cours** + `days` jours. Deux codes de 30 jours donnent donc 60 jours, et un code utilisé pendant un abonnement payé ne perd pas ses jours.
  - **⚠ Un refus de code n'est pas une exception** : il est dans `error` (`invalid_code`, `code_expired`, `code_used_up`, `already_redeemed`), avec `ok: false`. C'est voulu : Postgres annule tout ce qu'une fonction a écrit quand elle lève une exception, donc un refus levé effacerait le comptage de l'essai et on pourrait **tenter des codes sans fin**. L'app doit regarder `ok` et `error`, pas seulement l'exception.
  - **Seuls `rate_limited` et `not_found`** (aucun utilisateur) sont levés en `P0001`. `rate_limited` : plus de **10 essais par heure et par compte, réussis OU ratés**.
  - `uses` est incrémenté sous verrou de ligne : deux appareils qui utilisent le même code en même temps ne dépassent jamais `max_uses`.

## Tarifs du 30/10 (décision de Maxence, migration `20261030000000_payant_tarifs.sql`)

### Grille
| Formule | Mensuel | Annuel (≈ 8,5 mois) | Essai | Élèves |
|---|---|---|---|---|
| Particulier | 6,49 € | 55,00 € | 3 mois, avec moyen de paiement | |
| Coach ≤ 10 élèves | 15,99 € | 134,99 € | 3 mois | 10 |
| Coach 11 à 20 | 19,99 € | 169,00 € | 3 mois | 20 |
| Coach 21 à 30 | 24,99 € | 209,99 € | 3 mois | 30 |
| Coach plus de 30 | 29,99 € (plafond) | 250,00 € | 3 mois | illimité |
| Élève invité par le code de son coach | 4,89 € pendant 12 mois, puis 6,49 € | | **aucun** | |

Annuel = point de prix d'Apple juste en dessous de 8,5 mois (6,49 × 8,5 = 55,16 → 55,00 ; 15,99 × 8,5 = 135,91 → 134,99 ; etc.). L'abonnement coach **comprend l'accès complet** du coach lui-même. Prix touchés en France (après TVA et 30 % d'Apple, avant Small Business Program) : 6,49 → 4,60 € ; 15,99 → 11,33 € ; 19,99 → 14,16 € ; 24,99 → 17,70 € ; 29,99 → 21,24 € (15 % au lieu de 30 % avec le Small Business Program).

### Rôle coach : demande vérifiée à la main
Pour être coach il faut **vraiment** l'être : encadrer contre rémunération exige en France une **carte professionnelle d'éducateur sportif** (BPJEPS, DEJEPS, DESJEPS, Licence ou Master STAPS, CQP…), vérifiable publiquement sur https://recherche-educateur.sports.gouv.fr. **Acheter un abonnement coach ne donne jamais le rôle.**

- **Demande** (`public.coach_requests`, une ligne par compte) : nom tel qu'il figure sur la carte (2 à 80 caractères), numéro de carte professionnelle (6 à 20 lettres et chiffres, en majuscules, espaces, points, barres et tirets ignorés), diplôme (2 à 80). Pas de photo de carte (aucun fichier). Statut `pending` → `approved` / `rejected` (avec motif `reason`, montré à la personne) ; `revoked` quand l'administrateur retire le rôle. `admin_note` : note interne, jamais montrée. RLS fermée, aucune lecture par le client ; la clé serveur ne lit que les colonnes de l'alerte et n'écrit que `notified_at`.
- **RPC** : `coach_request_state()` et `coach_request_submit(card_name, card_number, diploma)` → `{ status ('none' | 'pending' | 'approved' | 'rejected' | 'revoked'), card_name, card_number, diploma, reason, created_at, decided_at, is_coach }`. Erreurs P0001 : `already_coach`, `invalid_name`, `invalid_card`, `invalid_diploma`, `rate_limited` (5 envois par 24 h), `not_found`. Tant qu'elle attend, la demande se corrige ; après un refus ou un retrait, elle se refait et repart en attente.
- **Alerte** : après l'envoi, l'app appelle la fonction Edge **`coach-request-alert`** (jeton vérifié dans le code, `verify_jwt = false`) : un e-mail à contact@mdlf.app par Resend (même secret `RESEND_API_KEY` que `report`), une seule fois par demande (`notified_at`), avec le lien du ministère et les deux commandes SQL. Au mieux : sans Resend, la demande attend dans la vue.
- **Administration** (éditeur SQL, rôle postgres ; aucune de ces fonctions n'est exécutable par l'API) :
  - `select * from private.coach_requests_pending;` (demandes en attente, les plus anciennes d'abord) ;
  - après vérification sur le site du ministère : `select private.approve_coach('<uuid>', 'carte vérifiée le …, valable jusqu''au …');` → pose `user_profiles.coach_at` et crée le **code permanent** du coach ;
  - `select private.reject_coach('<uuid>', 'Carte introuvable sur le site du ministère.');` (demande en attente seulement) ;
  - carte plus valable (elle se renouvelle tous les **5 ans**) : `select private.revoke_coach('<uuid>', 'Carte expirée.');` → `coach_at` retiré. Les **élèves restent liés** (rien n'est supprimé), **aucun nouvel élève** ne peut entrer (ses codes répondent `invalid_code`), le coach ne voit plus leurs séances (règle 5 de `20261027100000_coach.sql`), ses élèves n'obtiennent plus de code d'offre. Une nouvelle validation rend tout, avec le **même code**.
- Les coachs nommés à la main **avant** ce fichier (`coach_at` posé sans demande, par exemple Cyril le 29/10) **restent coachs** et reçoivent leur code permanent à la migration.
- **Côté app**, les formules coach ne sont **proposées** (visibles et achetables) qu'à un compte au rôle validé. Mais Apple montre tout le groupe dans les réglages de l'identifiant Apple : un compte non validé qui y choisit quand même un abonnement coach a l'**accès complet** (il a payé), **pas** le rôle ni d'élèves.

### Un code unique par coach
- **Un seul système de code coach** : `public.coach_invites`. En plus des codes de 7 jours (8 caractères, 5 au plus), chaque coach a **un code permanent** (colonne `permanent`, `expires_at = infinity`, un seul par coach) de **12 caractères** parmi 32 symboles lisibles (sans `0`/`O`/`1`/`I`) : 32^12 ≈ 1,2·10^18. Tiré sans biais dans un UUID v4 (`private.coach_new_code12`).
- **Force brute** : les essais ratés de `coach_preview` / `coach_join` ne sont pas comptés (choix 1 de `20261027100000_coach.sql`) ; avec 12 caractères, même 1 000 essais par seconde pendant un an contre 10 000 coachs donnent une chance de l'ordre de 3·10^-4. Un code trouvé ne donne de toute façon que le droit de devenir élève de ce coach (et de demander un code d'offre).
- `coach_my_code()` → `{ code, created_at }` (recréé s'il a été supprimé par `coach_revoke_invite`) ; `not_coach` sinon. La rotation de `coach_create_invite` ne touche jamais le code permanent. `coach_state().invites` le liste aussi, avec `expires_at = infinity` (l'app l'écarte de la liste des codes de 7 jours et l'affiche à part).
- `coach_code_norm` accepte 8 ou 12 caractères ; saisie souple (majuscules, espaces et tirets ignorés : `ABCD-EFGH-JKLM`).

### Paliers
- `private.coach_student_limit(coach)` : **0** si le compte n'est pas coach ; **verrou éteint** : au moins **50** (comportement d'avant, TestFlight) ; **verrou allumé** : le palier de l'abonnement coach **en cours** (10, 20, 30, illimité pour coachmax), **0 sans abonnement coach** (un coach validé doit s'abonner pour accueillir des élèves). L'ancienne limite fixe de 50 (`team_full`) disparaît.
- `coach_preview` et `coach_join` refusent **`tier_full`** quand l'équipe a atteint la limite : l'app dit à l'élève que son coach doit **passer au palier supérieur**. Vérifié sous le verrou par coach de `coach_join` (deux adhésions simultanées ne dépassent pas).
- **Descente de palier** (ou fin de l'abonnement coach) : les élèves déjà là **restent**, seul l'ajout est bloqué.
- `coach_tier_state()` → `{ is_coach, paywall_on, product_id, limit (null = illimité), students, full, next_product }` : `next_product` est le mensuel du palier suivant (`coach10` sans abonnement coach, null en illimité). L'app montre « 10 élèves sur 10 : passe au palier supérieur » et mène à ce produit.
- Montée de palier : l'utilisateur choisit le palier supérieur dans l'app (StoreKit, même groupe) ; Apple envoie une transaction de la **même** souscription (`original_transaction_id`) avec le nouveau `productId`, que `verify-purchase` et `appstore-notify` écrivent comme d'habitude : le palier est relu à chaque appel.

### Élève : −25 % pendant 12 mois, sans essai
- **Mécanisme choisi : codes d'offre Apple à usage unique** (« one-time-use codes »), distribués par notre serveur.
  - Les **offres promotionnelles** signées par le serveur sont exclues : Apple les réserve aux « existing and previously subscribed customers » (https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-promotional-offers-for-auto-renewable-subscriptions, lu le 30/10) ; un élève est un nouveau client.
  - Les **codes d'offre** acceptent l'éligibilité « New subscribers : customers who have never subscribed to any subscription product within the group », et le choix « No » pour l'offre de lancement : « Eligible customers will redeem the offer code first, then automatically renew to the standard subscription price without using the introductory offer » (https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-offer-codes, lu le 30/10). C'est exactement « −25 % 12 mois sans essai, puis prix normal ».
  - **Code personnalisé** (un mot par coach, « LUCAS25 ») écarté : il se recopie sur les réseaux et n'importe qui l'utiliserait. Un **code à usage unique** n'est remis par **notre serveur** qu'à un élève **lié à un coach validé** et **jamais abonné** ; Apple vérifie en plus « nouvel abonné » et « un code par offre et par client ».
  - Limites d'Apple : 1 million de codes par app et par trimestre ; lots de 500 à 25 000 ; **expiration à 6 mois au plus** (il faut refaire un lot régulièrement) ; 10 offres actives par produit ; une offre ne se modifie plus une fois créée (en créer une autre).
- **Stock** : `public.coach_offer_codes (code pk, environment 'Production' | 'Sandbox', expires_at, batch, assigned_to, coach_id, assigned_at)`, RLS fermée, aucun GRANT. L'administrateur importe le fichier de codes d'Apple :
  `insert into public.coach_offer_codes (code, expires_at, batch) select c, '<expiration du lot>', 'lot 2026-11' from unnest(array['…','…']) c;`
  Contrôle du stock : `select environment, count(*) filter (where assigned_at is null) as libres, min(expires_at) from public.coach_offer_codes group by 1;`
- **`student_offer_code(env default 'Production')`** → `{ ok, error, code, expires_at, coach }`. Refus dans `error` (pas une exception, pour que le débit reste compté) : `not_student` (pas de coach, ou coach sans rôle), `not_new` (une transaction Apple connue ou un code cadeau MDLF), `no_code` (stock vide, ou déjà 3 codes reçus). Le même code est rendu tant qu'il reste valable plus d'un jour ; un nouveau n'est pris que s'il reste au moins 7 jours au lot. `rate_limited` (P0001) au-delà de 20 appels par 24 h.
- **Dans l'app** : « 4,89 €/mois pendant 12 mois, puis 6,49 €/mois. Sans essai gratuit. » Le prix d'un code d'offre n'est **pas** donné par StoreKit : il est écrit en repli par devise (EUR 4,89 €, USD 3,99 $, CAD 4,99 $ CA, CHF 3,00), le prix d'après est lu chez StoreKit. Le bouton ouvre la page d'Apple avec le code prérempli : `https://apps.apple.com/redeem?ctx=offercodes&id=6823561962&code=<CODE>` ; la transaction revient par l'écouteur `Transaction.updates` (`verify-purchase`). Apple montre le prix exact avant de valider.
- **Après 12 mois**, Apple passe tout seul au prix normal. Côté serveur c'est un abonnement `active` comme un autre (`offerType` = 3 dans la transaction signée).

### Attribution élève → coach (accroche des commissions)
- `public.coach_origins (id, student_id unique, coach_id, code, joined_at)` : le **premier** coach rejoint par code (`coach_join`), **jamais modifié** ensuite (ni par un départ, ni par un autre coach, ni par un retrait du rôle). Compte de l'élève supprimé : `student_id` passe à null, la ligne reste anonyme (même choix que `referral_attributions`). Les liens existants ont été recopiés à la migration (`code` null).
- Le coach touchera une **part** des abonnements de ses élèves : le calcul est celui du **parrainage** (branche `lot3-parrainage`, `docs/PARRAINAGE.md`), **rien n'est dupliqué ici**. Accroche : `public.coach_origin_for_user(uid)` → `{ coach_id, joined_at }`, clé serveur seulement. À brancher à la fusion : pour un partenaire coach (`referral_partners.partner_user` = le coach), `private.referral_subscribers` comptera aussi les comptes de `coach_origins` dont c'est le coach.
- Élèves apportés par coach : `select o.coach_id, count(*) from public.coach_origins o group by 1;`

### App (30/10)
- `js/data/plans.js` : les dix produits, palier d'un produit, « soit N mois » **calculé** (prix annuel / prix mensuel StoreKit, arrondi au demi-mois), table de repli du prix de l'offre élève par devise (seul prix écrit dans l'app, vérifié par un test). `js/data/coach-pro.js` : `coach_request_*`, `coach_tier_state`, `coach_my_code`, alerte `coach-request-alert` envoyée sans bloquer. `js/features/coach-pro-ui.js` : écran « Devenir coach », groupe de Réglages › Coach, bandeau « palier plein ».
- **Écran d'abonnement** : onglets Particulier / Coach **seulement pour un coach validé** (les autres voient « Tu es coach ? », qui mène à la demande ; l'écran appelle `coach_request_state` pour cela) ; particulier : mensuel et annuel « soit 8,5 mois » ; coach : bascule mensuel / annuel, 4 paliers, nombre d'élèves suivis, palier « Conseillé », « Ta formule » ; élève lié et jamais abonné : seulement la carte « Offre élève de <coach> » (4,89 € par mois pendant 12 mois, puis le prix StoreKit, sans essai), bouton qui ouvre la page d'Apple avec le code ; `not_new` : retour aux formules habituelles. Règle 3.1.2 sur les trois parcours. **Verrou éteint : rien n'est achetable** (ni particulier, ni coach, ni offre élève).
- Réglages › Coach : code permanent `XXXX-XXXX-XXXX` à partager ; bandeau « 10 élèves sur 10 : passe au palier supérieur » → onglet Coach, palier suivant présélectionné. Réglages › Abonnement : « Offert par ton coach » retiré, « Changer de palier coach » ajouté.
- ~~L'app demande toujours un code élève de Production (elle ne reconnaît pas TestFlight)~~ : **corrigé le 31/10** (payant plus) : l'app lit l'environnement StoreKit (`environment()` du module natif, `AppTransaction.shared`) et demande un code **Sandbox** sous TestFlight, **Production** sinon.
- `privacy.html` (FR et EN) : données de la demande coach (nom sur la carte, numéro, diplôme), finalité (vérification sur le site du ministère), destinataire (l'administrateur, alerté par e-mail Resend), durée (tant que le rôle est actif, puis 1 an après un refus ou un retrait ; effacées avec le compte) ; rattachement élève → coach et code d'offre.

### Ce qui reste réversible
- Anciens élèves gratuits notés dans `private.tarifs_ex_coach_team (user_id, coach_id, noted_at)` ; `private.coach_free_limits` gardée (plus lue). Pour revenir à la gratuité : recréer `private.access_coach_free` et `private.access_own_paid` (texte dans `20261029000000_payant_modele_b.sql`) et la branche `coach_team` de `private.access_json`, puis `select private.access_refresh(user_id) from public.entitlements;`. Le statut `coach_team` reste permis par la contrainte, et la clé `coach_team` de `my_access()` vaut toujours `false`.
- Contrôle avant la migration (production, lecture seule) : `select count(*) from public.entitlements where status = 'coach_team' or in_coach_team;` (verrou éteint : personne ne perd rien tant qu'il n'est pas allumé ; un geste éventuel : un code cadeau maison).

## Précisions du serveur
- **Deux tables** : `entitlement_claims` (chaque transaction Apple, à vie) et `entitlements` (l'instantané du compte).
- **L'état qui fait foi est recalculé à chaque lecture** (`private.access_json`). `entitlements.status` et `in_coach_team` ne sont que le dernier instantané.
- **Ordre des statuts** : `gift` > `active` > `expired` > `none` (`coach_team` n'est plus produit depuis le 30/10).
- **`until`** : fin de l'abonnement ou du cadeau en jours (`active`, `gift`) ; pour `expired`, la dernière fin d'accès (fin d'abonnement, remboursement, cadeau en jours) ; `null` sinon. **`days_left`** : jours entiers restants pour `active` et `gift`, `null` sinon.
- **`app_config`** : une valeur absente ou du mauvais type retombe sur « éteint ». Pour allumer le verrou : `update public.app_config set value = 'true'::jsonb, updated_at = now() where key = 'paywall_on';`
- **Produits reconnus** en dur (`private.access_product_kind`, dernière version dans `20261031000000_payant_plus.sql`, et `PRODUCT_KINDS` de `purchase-policy.js`, comparés par `tests/unit/payant.mjs`) : les **dix** abonnements (`sub`) et l'**accès à vie** `com.mdlf.training.lifetime` (`life`). Tout autre produit, dont l'ancien « Accès offert », est refusé (`unknown_product`), et l'app termine cette transaction pour qu'elle ne revienne pas.
- **Erreurs levées** (message exact, errcode `P0001`) : `not_found`, `transaction_taken`, `unknown_product`, `invalid_transaction`, `rate_limited`, `paywall_locked`, et `invalid_kind` pour l'administrateur qui se trompe de `kind` dans `make_gift_code`.
- **Débit** : 120 appels de `srv_access_purchase` par compte et par 24 h, 10 essais de code cadeau par heure.
- **Partage familial refusé** (`not_purchased`) : il n'est pas activé sur ces produits.
- **Verrou des mises à jour** (relecture du 28/10) : sans lui, un `UPDATE` (ou le « do update » d'un upsert) permettait d'écrire une séance neuve par une ligne déjà là. Le déclencheur `sessions_paywall_upd` (`before update`, fonction `private.sessions_paywall_update`) refuse `paywall_locked`, quand le verrou est allumé et que le compte n'a pas le droit d'écrire, si **l'`id` change**, si **`deleted_at` passe de non nul à null** (sortie de la corbeille) ou si **`data->'date'` change sur une ligne vivante**. Restent permis : corriger une séance sans changer sa date, la mettre à la corbeille, modifier une ligne qui reste à la corbeille. Il couvre le chemin `on conflict do update` et passe avant `sessions_touch` (ordre alphabétique). Des lignes de corbeille semées à l'avance verrou éteint ne se réveillent donc pas verrou allumé (testé). **Côté app**, une séance refusée par ce chemin (par exemple sortie de la corbeille sans droit) est traitée comme une séance nouvelle refusée : isolée dans son lot, gardée dans `syncLockedIds`, **jamais marquée envoyée**, elle reste sur l'iPhone et repart dès que le droit revient.
- **Verrou dur côté serveur** : un déclencheur `before insert on public.sessions` refuse l'enregistrement d'une séance **nouvelle** avec l'erreur P0001 `paywall_locked` quand le verrou est allumé et `can_write` faux, sauf grâce de fin de séance. Les **mises à jour** et les **suppressions** restent permises, **y compris par `upsert`** (`insert … on conflict`, ce que fait l'app pour corriger et mettre à la corbeille) : une ligne `(user_id, id)` déjà présente passe toujours (relecture du 28/10). Côté app (`syncNow`, js/data/account.js) ce refus n'est ni une panne ni un problème de réseau : la séance reste sur l'iPhone, elle n'est **jamais marquée envoyée**, le lot est coupé en deux pour isoler les refusées, le **profil et les programmes partent quand même**. L'accueil le dit et mène à l'abonnement ; dès que le droit revient, ce qui était gardé repart tout seul.
- **Journaux des fonctions Edge** : aucun identifiant de transaction n'y est écrit (relecture du 28/10), seulement le type d'évènement et la cause d'un refus.
- **Pas de contrôle de révocation des certificats** (OCSP, CRL) : la révocation d'une **transaction**, elle, est vue (relecture chez Apple, notifications `REFUND` et `REVOKE`).
- **Suppression du compte avec un abonnement en cours** : la feuille de confirmation dit que l'abonnement continuera d'être facturé par Apple et propose « Gérer chez Apple » avant de supprimer (exigence d'Apple : https://developer.apple.com/support/offering-account-deletion-in-your-app/).
- **Fonctions du serveur** (clé serveur seulement) : `srv_access_purchase(p_user, p_product, p_expires, p_original_tx, p_revoked, p_event_at, p_intro, p_environment)` et `srv_access_event(p_original_tx, p_product, p_expires, p_revoked, p_event_at, p_force, p_uuid, p_account_token, p_intro, p_environment)`.
## Réouverture après un remboursement
- **Réouverture après un remboursement** (`private.access_claim`, règle 4) : la révocation n'est levée que par un évènement **à la fois plus récent** (`event_at` connu des deux côtés) **et portant une période strictement plus lointaine**. Un vrai réabonnement rouvre donc l'accès tout seul, sans support, alors qu'un évènement en retard, rejoué, de même période ou sans date d'évènement ne rouvre rien. Tant qu'une transaction reste révoquée, **sa période ne bouge pas** : sinon un évènement sans date relèverait la barre du réabonnement sans rien rouvrir.
  - En secours (si la période d'Apple ne va pas plus loin que l'ancienne) : `update public.entitlement_claims set revoked_at = null, event_at = null where original_transaction_id = '…';` puis `select private.access_refresh('<user_id>');`

## App
- `js/data/access.js` : lit `my_access()`, garde le dernier état connu par compte (`mdlf_access`), expose `canWrite()`, `accessStatus()`, `accessUntil()`, `accessIntroUntil()`.
  - **Hors ligne** : le dernier état connu vaut **7 jours** au plus après sa lecture (`server_now`) ; un abonnement ou un cadeau daté vaut jusqu'à sa date de fin du serveur plus deux jours. L'horloge de l'appareil ne décide jamais : avancer ou reculer l'horloge ne peut rien ouvrir.
  - `can_write` vient du serveur et n'est jamais recalculé dans l'app.
  - Formules : `accessLoadProducts()` lit les prix (`displayPrice`) et l'essai (`accessTrialOf` : `introEligible` et `offer.paymentMode = 'freeTrial'`) chez StoreKit.
  - Codes cadeaux : `accessRedeemGiftCode(code)` regarde `ok` et `error` de `redeem_gift_code`, pas seulement le bloc d'erreur.
- `js/features/paywall-ui.js` : écran d'abonnement (offre lue chez StoreKit, mentions 3.1.2, conditions et confidentialité), « Restaurer mes achats », **« J'ai un code »** (code cadeau MDLF) et **« J'ai un code d'offre Apple »** (feuille d'Apple), Réglages › Abonnement, porte des écritures `accessGate()`.
- **Mode lecture seule** (verrou allumé, `can_write` faux) : Historique, Progrès, profil et **export** restent ouverts ; démarrer ou enregistrer une séance propose l'abonnement. Rien n'est supprimé.

## Natif (iOS, StoreKit 2)
`ios/App/App/StorePlugin.swift`, module Capacitor `MdlfStore`. **Cette section décrit le module tel qu'il est vraiment** : la première version de ce contrat décrivait un plugin imaginaire (`price` au lieu de `displayPrice`, un `jws` à la racine de `restore()`), ce qui a cassé l'écran d'abonnement sans qu'aucun test ne le voie. `tests/unit/store-contract.mjs` lit désormais le vrai Swift et vérifie clé par clé ce que l'app consomme et ce que le faux StoreKit des tests rend.

- `status()` → `{ canMakePayments, subscriptionIds }`, sans aucun appel réseau. `canMakePayments` est **faux** quand les achats sont bloqués (Temps d'écran, profil de gestion) : l'écran ne propose alors aucun bouton d'achat.
- `products()` → `{ products, missing, canMakePayments }`. Chaque produit : `{ id, displayName, description, displayPrice, price, currency, period: { unit, value }, introEligible, offer? }`. **Le prix affichable est `displayPrice`**. **Offre de lancement (l'essai gratuit de 3 mois, modèle B)** : `introEligible` vaut vrai quand Apple accorde encore l'essai à cet identifiant Apple, et `offer` vaut alors `{ displayPrice, price, paymentMode, period: { unit, value }, periodCount }` ; l'app n'annonce un essai que si `introEligible` et `paymentMode = 'freeTrial'` (`accessTrialOf`), et sa durée est `period × periodCount`. Sinon elle montre le prix normal. (chaîne déjà formatée par Apple dans la monnaie de la boutique) ; `price` est un **nombre**, inutilisable tel quel à l'écran. `missing` liste les identifiants qu'Apple ne connaît pas encore (contrat **Paid Apps** non signé, produit pas encore « Prêt à être envoyé ») : `products` est alors **vide** et l'écran le dit, sans prix inventé.
- `purchase({ productId, appAccountToken? })` : **ne rejette jamais** sur annulation. Il résout `{ status: 'success' | 'userCancelled' | 'pending' }` ; pour `success`, la réponse porte **toute la transaction** (`jws`, `transactionId`, `originalTransactionId`, `productId`, `purchasedAt`, `expiresAt`, `revokedAt`, `environment`, `subscription`…). L'app passe **toujours** `appAccountToken` = identifiant du compte MDLF (UUID Supabase) : sans lui, un achat dont la vérification échoue (réseau coupé juste après le paiement) devient **orphelin**, le serveur ne pouvant le rattacher à aucun compte. Un vrai problème (produit absent, preuve non vérifiée) est un rejet avec un code.
- `finish({ transactionId })` → `{ finished, reason? }` : **obligatoire**. `purchase()`, `restore()`, `current()` et l'écouteur rendent le JWS **sans terminer** la transaction, exprès : un achat perdu par le réseau revient au lancement suivant (`Transaction.unfinished`). L'app appelle `finish()` **après** que le serveur a confirmé, ou sur un refus définitif (`invalid_jws`, `bad_bundle`, `unknown_product`). **Jamais** sur une erreur passagère (503 : Apple injoignable) ni sur `transaction_taken` : la transaction est gardée, et simplement plus réenvoyée tant qu'on reste sur ce compte.
- `restore()` → `{ synced, cancelled, entitlements, unverified }`. `AppStore.sync()` demande le mot de passe du compte Apple : à n'appeler que sur « Restaurer mes achats ». **Le JWS est dans chaque `entitlements[i]`, jamais à la racine** ; l'app les envoie tous. Fermer la fenêtre d'Apple n'est pas une erreur (`cancelled: true`, les droits déjà connus sont rendus).
- `current()` → `{ entitlements, unverified }` : les droits en cours (`Transaction.currentEntitlements`) **sans rien demander à l'utilisateur**. L'app le lit au lancement quand le verrou est allumé et `can_write` faux, pour rattraper un achat qui n'est jamais arrivé au serveur (réseau coupé, app réinstallée, nouvel iPhone).
- `redeemCode()` → `{ presented: true }`, ou `{ presented: false, cancelled: true }` si la fenêtre est fermée : **ce n'est pas un succès**. Elle n'accepte que les **codes d'offre d'abonnement** d'Apple ; les **codes cadeaux maison** se saisissent dans un champ de l'app. L'écran propose les deux séparément et ne promet jamais qu'un code d'Apple se saisit dans l'app.
- **Écouteur permanent** `Transaction.updates` (plus `Transaction.unfinished` au lancement) : toute transaction (renouvellement, code utilisé, achat sur un autre appareil) est transmise au serveur, puis terminée par `finish()`. Le module émet le même événement sous **deux noms** (`transaction` et `change`, en `retainUntilConsumed`) : l'app s'abonne à **un seul** des deux, sinon chaque transaction serait traitée deux fois.
- Une transaction `.unverified` (signature d'Apple invalide) est **refusée par le module**, jamais transmise au web et jamais finie.

Hors app iOS (web) : aucun achat possible, l'écran invite à utiliser l'app.

## Ordre de déploiement (relecture du 28/10)
Toujours dans cet ordre, une étape seulement quand la précédente est en place :
1. **Contrôle avant la migration**, en lecture seule, sur la production : `select status, count(*) from public.entitlements group by 1;` (les lignes `trial` deviennent `none`, les anciens « Accès offert » perdent leur accès à vie ; rien d'autre ne doit surprendre). `tests/sql/upgrade_test.sh` rejoue cette montée de version sur des données réalistes.
2. **Migrations** `20261029000000_payant_modele_b.sql` puis `20261030000000_payant_tarifs.sql` (contrôle : `select count(*) from public.entitlements where status = 'coach_team' or in_coach_team;`). `tests/sql/upgrade_test.sh` rejoue les deux.
3. **Fonctions Edge** `verify-purchase` et `appstore-notify` (elles reconnaissent les produits coach : déployées avant la migration tarifs, la base refuserait un achat coach `unknown_product`, sans dégât), puis `coach-request-alert`. Elles envoient `p_intro` et `p_environment` : déployées AVANT la migration, la base ne connaîtrait pas ces paramètres et refuserait chaque achat et chaque notification.
4. **Build de l'app ET mise à jour à chaud, ensemble** (une seule étape) : `StorePlugin.swift` change, donc l'**empreinte native** change, et une mise à jour à chaud publiée avant la build n'atteindrait aucun appareil. Le contenu web lit `paywall_on` et `min_build` sans compte (lecture `anon`, posée par la migration) et ne connaît plus le statut `trial` : il ne doit pas précéder la migration.

**Version minimale (`min_build`)** : `app_config.min_build` (livré à 0, lisible sans compte comme `paywall_on`) est la build native minimale. Une app dont la build est plus ancienne affiche un écran « Mets à jour l'app » (lien TestFlight, à remplacer par la page App Store à la sortie publique) qui ne se ferme pas ; ses séances restent sur l'iPhone. Ce code part AVEC la build payante : il protège les builds suivantes. Le jour d'allumer le verrou, régler `min_build` sur la première build payante :
`update public.app_config set value = '<build>'::jsonb, updated_at = now() where key = 'min_build';`

**Builds déjà installées sans ce code** (celles d'avant le payant) : elles ne recevront jamais le nouveau contenu web (empreinte native) et ne liront pas `min_build`. Verrou allumé, leur synchronisation échouerait au premier refus sans rien proposer. **On attend qu'elles ne soient plus utilisées avant d'allumer le verrou.** Ces builds n'appellent jamais `my_access()` : un compte qui synchronise encore mais n'a pas de ligne `entitlements` tourne sur une ancienne build. Requête de contrôle (lecture seule), à voir tomber à zéro :
`select count(*) from auth.users u where exists (select 1 from public.sessions s where s.user_id = u.id and s.updated_at > now() - interval '14 days') and not exists (select 1 from public.entitlements e where e.user_id = u.id);`
Les utilisateurs sans compte d'une ancienne build ne synchronisent rien : le verrou ne les touche pas.

**Allumer le verrou**, plus tard, après validation de Maxence :
- vérifier que la requête des anciennes builds ci-dessus est tombée à zéro, et régler `min_build` sur la première build payante ;
- publier une mise à jour à chaud avec **`PAYWALL_LAUNCHED = true`** dans `js/data/access.js` (sans elle, un verrou jamais lu ne ferme jamais rien) ;
- puis `update public.app_config set value = 'true'::jsonb, updated_at = now() where key = 'paywall_on';`
- et ne plus publier de lien TestFlight public (voir « Sandbox accepté »).

## Ce qui reste à faire par Maxence (ne peut pas être fait par l'API)
1. Signer le contrat **Paid Apps** sur App Store Connect (RIB, fiscalité) : sans lui, StoreKit ne renvoie aucun produit (`missing`).
2. Vérifier le statut micro-entreprise pour la vente d'applications ; demander le **Small Business Program** (15 % au lieu de 30 %).
3. Ajouter la **capture de revue** (et vérifier nom et description) des **dix** abonnements et de l'offre de lancement ; supprimer le produit « Accès offert » (`com.mdlf.training.access.gift`) s'il est encore là.
4. Créer un **testeur Sandbox** ; pour tester l'offre élève, un lot de **codes Sandbox** (ASC › l'abonnement mensuel › Codes d'offre › « Eleve de coach -25 pct 12 mois » › codes à usage unique, environnement Sandbox), importé avec `environment = 'Sandbox'`.
5. Avant d'allumer le verrou : générer un **lot de codes à usage unique de production** de l'offre élève (500 au moins, expiration 6 mois au plus), télécharger le fichier et l'importer dans `public.coach_offer_codes` ; le refaire avant chaque expiration (contrôle du stock dans « Tarifs du 30/10 »).
6. Fournir l'**URL de notification** à App Store Connect (fonction `appstore-notify`) et la clé d'API **In-App Purchase** (.p8 téléchargeable une seule fois) → secrets `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY`, `APPLE_ISSUER_ID`. `APPLE_ALLOW_SANDBOX` n'existe plus : le retirer s'il avait été posé.
7. Suivre l'**ordre de déploiement** ci-dessus : contrôle, migrations, `verify-purchase` (`verify_jwt = false`), `appstore-notify` (`--no-verify-jwt`), `coach-request-alert` (`verify_jwt = false`, secret `RESEND_API_KEY` déjà posé pour `report`), mise à jour à chaud, build (`StorePlugin.swift` connaît les dix produits).
8. Valider les demandes coach (sous 48 h, comme l'écran le promet) avec `private.approve_coach` / `private.reject_coach` après vérification sur https://recherche-educateur.sports.gouv.fr.
9. Trancher la règle 5.1.1(v) (note ci-dessus) et le lien TestFlight public (voir « Sandbox accepté ») ; revoir si besoin les prix des pays hors France (équivalences d'Apple).
10. Statut de commerçant DSA, mentions légales de professionnel, CGV/CGU, médiateur de la consommation (voir la mémoire du projet) ; fiche Confidentialité d'App Store Connect si elle doit citer la demande coach.
11. Fabriquer ses premiers codes cadeaux : `select private.make_gift_code('days', 90, 10, 'Beta');`

## Payant plus (31/10/2026, migration `20261031000000_payant_plus.sql`)

Retour arrière : `supabase/rollback/20261031000000_payant_plus_down.sql` (à la main, vérifié par `tests/sql/rollback_payant_plus.sh`). Rien n'est créé dans App Store Connect, rien n'est déployé.

### 1. Accès à vie payant
- **Produit proposé** : `com.mdlf.training.lifetime`, **achat non consommable** (« Non-Consumable »), prix proposé **89,99 €** (≈ 90 €, point de prix d'Apple), équivalences d'Apple dans les 4 autres pays, **partage familial désactivé** (une transaction `FAMILY_SHARED` est refusée, `not_purchased`). **Rien n'est créé** : c'est à Maxence de le créer dans App Store Connect (voir la liste plus bas).
- **Hors du groupe d'abonnements** : un non consommable n'appartient à aucun groupe. Acheter l'accès à vie **n'arrête pas** un abonnement en cours ; Apple continue de le facturer. L'app le dit avant l'achat (mentions sous la carte « À vie »), le redit après (feuille « Ton abonnement continue », bouton « Gérer chez Apple ») et dans Réglages › Abonnement tant que le serveur voit les deux (`also_sub`).
- **Serveur** : nature `life` dans `entitlement_claims` (contrainte `kind in ('sub', 'life')`), même registre, même unicité (`original_transaction_id` : un achat à vie ne sert qu'à un compte, `transaction_taken`), même vérification par `verify-purchase` (type attendu `Non-Consumable`, pas de date de fin) et mêmes notifications par `appstore-notify` :
  - `ONE_TIME_CHARGE` (achat, ou code d'offre de ce produit) : écrit l'achat ;
  - `REFUND` : l'accès tombe (`revoked_at`) ;
  - `REFUND_REVERSED` (Apple annule un remboursement après un litige, et demande de rendre l'accès) : **traité seulement pour l'accès à vie** ; le serveur rouvre l'achat si l'évènement est **plus récent** que le remboursement (règle 4 bis de `private.access_claim`). Une notification rejouée d'avant le remboursement, ou une relecture par `verify-purchase` (date d'achat d'origine), ne rouvre rien. Pour un abonnement, `REFUND_REVERSED` reste ignoré (secours SQL de « Réouverture après un remboursement »).
  - une transaction ne change jamais de nature (abonnement ↔ à vie) : `invalid_transaction`.
- **Sandbox (TestFlight, examen d'Apple) : 7 jours seulement.** TestFlight achète toujours en Sandbox, sans payer. Un abonnement Sandbox s'arrête tout seul ; un non consommable, jamais : sans borne, **tout testeur TestFlight aurait un accès à vie réel et définitif** sur son compte MDLF. Un achat à vie Sandbox vaut donc **7 jours après l'achat** (`private.access_life_test_days()`, fin fixée une fois, jamais prolongée par une relecture), affiché « Accès à vie (test) » et « Fin du test ». L'équipe d'examen d'Apple a largement le temps de vérifier l'achat. Les testeurs qui doivent garder l'app reçoivent un **accès à vie offert** (point 2).
- **`my_access()`** gagne deux clés : **`lifetime`** (`'purchase'` achat payé en Production, `'gift'` accès à vie offert, `'test'` achat Sandbox de 7 jours, `null` sinon) et **`also_sub`** (un abonnement Apple tourne encore à côté d'un accès à vie payé ou offert). Achat à vie payé : `status = 'active'`, `until = null`, `days_left = null`, `can_write` vrai, `intro_offer` faux. Ordre : accès à vie offert > achat à vie > cadeau en jours > abonnement > expiré > aucun. Hors ligne, un accès sans date de fin garde la règle des 7 jours (comme un cadeau à vie).
- **Offre élève** : un acheteur à vie a une transaction Apple, il n'est donc plus « nouveau » (`not_new`).
- **App** : `js/data/plans.js` (`PLAN_LIFETIME_ID`, `PLAN_SOLD_IDS`, période `life`), `js/data/access.js` (`accessLifetime`, `accessAlsoSub`, produits lus chez StoreKit, prix jamais écrit), `js/features/paywall-ui.js` : carte « À vie » sous les deux formules du particulier (« <prix> en une fois », « Un seul paiement, sans abonnement »), mentions propres (débité à la confirmation, rien ne se renouvelle, un abonnement en cours n'est pas arrêté), écran `paywall` raison `life` pour un abonné (Réglages › Abonnement › « Passer à l'accès à vie »), états « Accès à vie », « Accès offert à vie », « Accès à vie (test) ». Verrou éteint : rien n'est achetable, comme les abonnements.
- **Natif** (`StorePlugin.swift`, **non compilé**) : `lifetimeIds`, `soldIds` (lus par `products()`, acceptés par `purchase()`, lus dans `current()` et `restore()`), clé `lifetime` dans une transaction, `lifetimeIds` dans `status()`. Le produit n'a ni `period`, ni `introEligible`, ni `offer` (vérifié par `tests/unit/store-contract.mjs`). **Changement natif : il faut une build** (empreinte native), comme tout le payant.

### 2. Accès « gratuit à vie » : attribués, révocables, tracés
- **Ce qui existait** : les codes cadeaux maison `lifetime` (`private.make_gift_code('lifetime', …)`, saisis dans « J'ai un code »), tracés par `gift_redemptions` (qui, quel code, quand) et `gift_codes.note`. **Ce qui manquait** : retirer un accès à vie offert, et l'attribuer à un compte sans lui faire saisir un code.
- **Ajouts** (fonctions `private.*`, exécutables par **aucun** rôle de l'API, seulement dans l'éditeur SQL) :
  - **`private.grant_lifetime(user_id, note)`** : un code à usage unique est tiré au hasard, noté « attribué : <note> », utilisé aussitôt au nom du compte. Réponse `{ ok, code, user_id }`, ou `{ ok: false, error: 'already_lifetime' }`. Erreurs `not_found` (compte inconnu), `invalid_note` (2 à 200 caractères). Exemple :
    `select private.grant_lifetime((select user_id from public.user_profiles where username = '<pseudo>'), 'Cyril, coach partenaire');`
  - **`private.revoke_lifetime(user_id, reason)`** : retire les accès à vie **offerts** du compte (`gift_redemptions.revoked_at`, `revoke_reason`). Un achat à vie **payé** ne se retire pas ainsi (seul un remboursement d'Apple le fait). Erreur `invalid_reason`.
  - **`private.revoke_gift_code(code, reason)`** : désactive un code (`gift_codes.revoked_at` : refusé ensuite comme un code expiré, `code_expired`) et retire l'accès à vie à ceux qui l'ont utilisé. Les **jours** déjà offerts par un code `days` restent acquis (ils se cumulent et ne se recalculent pas).
  - **`private.lifetime_access`** (vue) : qui a un accès à vie, d'où il vient (`gift` ou `purchase`), depuis quand, retiré ou non et pourquoi. Les achats Sandbox n'y sont pas.
  - `select * from private.lifetime_access order by since desc;`
- Un code retiré ne se réutilise pas (`already_redeemed`) ; une nouvelle attribution reste possible.
- **Aucun code n'est écrit dans le dépôt** : ils sont tirés par la base (32^12 possibilités). Les tests n'utilisent que des codes tirés au hasard ou des faux évidents.

### 3. Fusion de main
`main` (lot 1 et lot 2, cache `ppl-v104`) fusionné dans la branche : `sw.js` garde le `CACHE` de `main` (`ppl-v104`, **pas de montée**) et ajoute les fichiers du payant à `ASSETS`.

### 4. TestFlight reconnu
- **Le problème** : l'app demandait toujours un code d'offre élève de **Production** ; sous TestFlight (toujours Sandbox), un tel code ne passe pas.
- **Correction** : méthode native **`environment()`** → `{ environment: 'production' | 'sandbox' | 'other' | 'unknown' }`, lue dans **`AppTransaction.shared`** (iOS 16+, propriété `environment`, documentation StoreKit lue par Context7 le 31/10). Elle ne montre **aucune fenêtre** : `AppTransaction.refresh()`, qui demande le mot de passe Apple, n'est jamais appelé. Échec ou signature non vérifiée : `unknown`. `accessStoreEnvironment()` (js/data/access.js) la lit une fois par lancement, et `student_offer_code` reçoit `env = 'Sandbox'` seulement pour `sandbox`, sinon `Production` (navigateur, ancienne coquille sans la méthode, réponse inconnue).
- **Ce que ça ouvre** : rien. L'environnement n'ouvre aucun accès ; un compte qui mentirait recevrait un code Sandbox, inutilisable sur l'App Store, et userait un de ses 3 codes.
- Le reçu `sandboxReceipt` (`Bundle.main.appStoreReceiptURL`) n'est pas utilisé : il est déprécié depuis iOS 18.

### Ce que Maxence doit faire (payant plus)
1. Valider le prix de l'accès à vie (89,99 € proposé) puis **créer le produit** dans App Store Connect : type **Non consommable**, identifiant **`com.mdlf.training.lifetime`**, nom et description fr-FR et en-US, prix France puis équivalences, disponibilité dans les 5 pays, **partage familial désactivé**, capture de revue. Le soumettre avec la build qui le contient.
2. Dans App Store Connect › App › Informations sur l'app : vérifier que l'URL des notifications V2 est celle d'`appstore-notify` (elle reçoit aussi `ONE_TIME_CHARGE` et `REFUND_REVERSED`).
3. Ordre de déploiement : migration `20261031000000_payant_plus.sql` **avant** les fonctions Edge `verify-purchase` et `appstore-notify` (sinon la base refuse `com.mdlf.training.lifetime`, `unknown_product`, sans dégât), puis la **build** (le Swift change) avec la mise à jour à chaud.
4. Attribuer les accès à vie offerts (Maxence, Cyril, testeurs) avec `private.grant_lifetime`, après la migration.

## Journal App Store Connect
- **28/10** : `pro.monthly` 5,99 € et `pro.yearly` 41,99 € créés, offre de lancement 3 mois dans les 5 pays ; « Accès offert » supprimé.
- **30/10** (API, rien n'est soumis à l'examen, aucun produit supprimé) :
  - `pro.monthly` (6827767578) : prix de départ **6,49 €** (France, en remplacement de 5,99 €), équivalences BEL/CHE/CAN/USA ; `pro.yearly` (6827767660) : **55,00 €** (au lieu de 41,99 €), équivalences.
  - **Huit abonnements coach créés** dans le groupe 22520671 (identifiants, ids, prix : table « Produits App Store Connect »), noms et descriptions en français (fr-FR) et en anglais (en-US), disponibles dans les 5 pays, note de revue (réservés aux coachs vérifiés), offre de lancement **3 mois gratuits** dans les 5 pays sur chacun.
  - **Niveaux du groupe** remis dans l'ordre coachmax > coach30 > coach20 > coach10 > particulier (1 à 10).
  - CHE `coachmax.monthly` relevé à 25,00 CHF (équivalence à 20,00 CHF = coach30).
  - **Code d'offre** « Eleve de coach -25 pct 12 mois » créé sur `pro.monthly` (id `9a963bbc-d2c8-4478-8ba3-6bc74abc067d`) : `NEW`, `REPLACE_INTRO_OFFERS`, `PAY_AS_YOU_GO` 12 × 1 mois, 4,89 € (et équivalences), actif. **Aucun code généré** (ni production ni Sandbox) : à faire par Maxence (points 4 et 5), un lot expire en 6 mois au plus.
