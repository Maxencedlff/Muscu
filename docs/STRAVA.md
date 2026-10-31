# Strava : export des séances

Envoyer une séance terminée vers Strava, en un toucher, depuis le bilan ou Historique › Séance.
Branche `nuit-strava` (31/10/2026). **Rien n'est en production** : migration non appliquée, fonctions
non déployées, secrets non posés, application Strava pas encore créée.

Documentation Strava lue le 31/10/2026 :
[authentification](https://developers.strava.com/docs/authentication/),
[référence de l'API](https://developers.strava.com/docs/reference/) (création d'activité, `SportType`),
[limites](https://developers.strava.com/docs/rate-limits/),
[charte](https://developers.strava.com/guidelines/).

## Ce que voit la personne

- **Réglages › Connexions › Strava** (écran `strava`, `js/features/strava-ui.js`). Il faut un compte MDLF.
  - Pas relié : le bouton officiel « Connect with Strava » (image fournie par Strava, `img/strava/`),
    qui ouvre la page d'autorisation de Strava **dans Safari**. Une ligne « Autorise MDLF Training
    dans Safari, puis reviens ici » reste affichée ; au retour dans l'app (premier plan), l'état est
    relu tout seul.
  - Relié : « Compte Strava : Léa », le nombre de séances envoyées, « Déconnecter Strava »
    (confirmation, puis accès révoqué chez Strava et tout effacé du serveur). Si Strava ne confirme
    pas la révocation, l'app le dit et propose d'ouvrir strava.com/settings/apps.
  - Droit « Créer des activités » décoché à la liaison : la page de retour l'explique, l'accès est
    révoqué aussitôt et rien n'est gardé.
- **Bilan** et **Historique › Séance** : groupe « Strava » avec « Envoyer vers Strava », « Envoi… »
  pendant l'appel, puis « Sur Strava » et le lien **View on Strava** (libellé imposé par la charte).
  Visible seulement si Strava est relié et la séance envoyable. Rien ne part automatiquement.

Séance envoyable (`stravaExportable`) : terminée dans l'app (durée mesurée d'au moins une minute), au
moins une série faite (hors échauffement), début il y a moins de 400 jours. Jamais une sortie lue dans
Santé (`hk:…`), jamais une séance passée saisie à la main (pas de durée ni d'heure réelles), jamais une
séance importée de Hevy ou Strong (`isImportedEntry`, programmes `u_hevy` / `u_strong` de
`js/data/import-csv.js`) : sa `date` est l'heure de DÉBUT lue dans le fichier (dans l'app, c'est la fin),
elle partirait donc avec une heure d'avance, et elle est souvent déjà sur Strava par Hevy ou Strong.

## Ce qui part vers Strava

`stravaActivity(h)` (`js/data/strava.js`), revérifié par `validateExport`
(`supabase/functions/_shared/strava-policy.js`) :

| Champ Strava | Valeur |
|---|---|
| `name` | Nom de la séance (« Push », nom de la séance perso), 100 caractères au plus |
| `sport_type` | Voir le tableau suivant |
| `start_date_local` | Fin − durée, heure locale sans fuseau (`2026-10-31T18:00:30`) |
| `elapsed_time` | Durée en secondes (60 à 86 400 ; une séance oubliée est ramenée à 24 h) |
| `distance` | Cardio d'un seul type avec distance : somme des km × 1000 (course, marche, vélo, rameur) |
| `trainer` | `1` si tous les exercices de cardio sont sur machine (tapis, vélo d'appartement, rameur…) |
| `description` | « 52 min · 18 séries · 4,3 t », une ligne par exercice fait (`setsText`, unité de la personne), « Enregistré avec MDLF Training » |

Jamais : les notes de séance, le poids du corps (le volume est calculé sans lui, comme
`session-review.js`), le RIR, les échauffements, ni rien de Santé.

Type d'activité (`stravaSport`) :

| Séance | `sport_type` |
|---|---|
| Au moins un exercice de musculation | `WeightTraining` |
| Que du cardio, Course à pied / Fractionné / Tapis de course | `Run` (tapis : `trainer`) |
| Trail | `TrailRun` |
| Marche rapide | `Walk` |
| Vélo / Vélo d'appartement | `Ride` (appartement : `trainer`) |
| Rameur | `Rowing` (`trainer`) |
| Vélo elliptique | `Elliptical` |
| Escaliers | `StairStepper` |
| Corde à sauter, cardio de plusieurs types | `Workout` |
| Cardio inconnu de la bibliothèque | famille de l'allure (`paceKind`) : `Run`, `Ride`, `Rowing`, sinon `Workout` |

`VirtualRun` / `VirtualRide` ne sont pas utilisés : chez Strava ils désignent Zwift et autres mondes
virtuels ; une séance en salle est `Run` ou `Ride` avec `trainer`.

## Architecture

```
App (js/data/strava.js, js/features/strava-ui.js)
  ├─ rpc strava_status()                     → { connected, athlete_name, can_write, exports }
  ├─ functions.invoke('strava-connect')       → { url }  → Native.openOutside(url) : Safari
  ├─ functions.invoke('strava-export', corps) → { ok, activity_id }
  └─ functions.invoke('strava-disconnect')    → { ok, revoked }

Safari → strava.com/oauth/authorize → GET …/functions/v1/strava-connect?code&scope&state
        → 302 https://mdlf.app/strava.html#ok (web-public/strava.html, résultat affiché sans script)
```

- **Aucun jeton dans l'app.** Les jetons Strava ne quittent jamais le serveur ; ils sont chiffrés
  (AES-GCM 256, `_shared/strava-crypto.js`, clé `STRAVA_TOKEN_KEY`, identifiant du compte en données
  associées) avant d'entrer en base. Une copie de la base seule ne donne aucun accès Strava.
- **État OAuth** : 32 octets aléatoires, empreinte SHA-256 seule en base, 10 minutes, usage unique.
  C'est lui qui désigne le compte au retour (le navigateur n'a pas le jeton de session de l'app) : voir
  « Liaison et CSRF » plus bas.
- **Un athlète Strava, un seul compte MDLF** : index unique `strava_links_athlete` ; `strava_link_save`
  répond `athlete_taken` si l'athlète est relié à un autre compte, la page de retour affiche `#deja`.
  Les jetons reçus sont alors oubliés **sans être révoqués** : chez Strava, il n'y a qu'un accord par
  athlète et par application, le révoquer couperait aussi l'accès du compte qui détient la liaison.
  Avant de refuser, la liaison du détenteur est vérifiée : si elle est périmée, elle est libérée (voir
  « Liaison périmée » plus bas).
- **Renouvellement** côté serveur (`_shared/strava.ts`, `stravaAccess`) : 5 minutes avant
  l'expiration (jeton d'accès d'environ 6 h). Strava change le jeton de renouvellement à chaque fois
  et invalide l'ancien aussitôt : le dernier reçu est réenregistré ; si deux envois renouvellent en
  même temps, celui qui échoue relit la base et reprend avec les jetons de l'autre.
- **Accès retiré chez Strava** (401, renouvellement refusé) : la liaison est effacée, l'app affiche
  « Strava n'est plus relié ».
- **Double envoi** : `strava_export_begin` réserve la séance (verrou par compte) ; un second toucher
  pendant l'envoi répond `busy`, une séance déjà envoyée renvoie son activité (`already`).
- **Pas de schéma d'URL natif** : la page d'autorisation s'ouvre dans Safari et l'app relit l'état
  quand elle revient au premier plan. **Aucune build nécessaire.** Ouverture par
  `Native.openOutside(url)` (`js/platform/native.js`), jamais `window.open` : l'adresse n'arrive
  qu'après un appel réseau, le geste du toucher est alors terminé, et WKWebView refuse `window.open`
  sans geste (`javaScriptCanOpenWindowsAutomatically`, que Capacitor laisse à `false` ; WebKit bloquait
  aussi `window.open` dans un `fetch().then()`, bug 302803, corrigé fin 2025, alors que l'app vise
  iOS 16.4). Dans l'app, `openOutside` fait `location.assign(url)` : Capacitor annule cette navigation
  vers un autre domaine et la confie à Safari (`WebViewDelegationHandler`, `decidePolicyFor` :
  `UIApplication.shared.open`), sans condition de geste ; l'app reste sur son écran. Même chose pour
  « View on Strava » et « Ouvrir Strava » (après la feuille de confirmation). Amélioration possible plus tard (build) : `ASWebAuthenticationSession` ou un schéma
  `mdlf://` pour revenir dans l'app sans toucher « ◀ MDLF Training ».

### Liaison et CSRF (limite connue)

Au retour de Strava, Safari n'a pas la session de l'app : c'est l'état seul qui désigne le compte MDLF.
Rien ne lie donc cet état au téléphone qui l'a tiré (CSRF OAuth, RFC 9700 §2.1 et §4.7). Scénario : une
personne malveillante tire un lien d'autorisation avec SON compte (POST `strava-connect`, valable 10
minutes) et l'envoie à quelqu'un ; si ce quelqu'un l'ouvre et accepte, son Strava est relié au compte de
la personne malveillante, qui peut alors publier des activités sur son fil (nom et description choisis)
et voit son prénom.

Ce qui le limite aujourd'hui, sans build :

1. `approval_prompt=force` : Strava montre **toujours** son écran d'accord (« MDLF Training veut créer
   des activités »). Avec `auto`, une personne ayant déjà autorisé MDLF Training ne verrait rien et le
   lien relierait en un seul toucher (documentation Strava : « the authorization prompt is skipped if
   the user has already authorized the app »). Testé par `tests/unit/strava-server.mjs`.
2. Un athlète n'est relié qu'à un seul compte (`athlete_taken`, `#deja`) : quelqu'un qui a déjà relié
   son Strava à son propre compte ne peut plus être relié à un autre, même en acceptant.

Risque restant : une personne qui n'a pas relié Strava, reçoit le lien et **accepte** l'écran de
Strava. Son recours : retirer MDLF Training dans strava.com/settings/apps (les jetons du compte
malveillant ne valent plus rien), puis relier Strava à son propre compte ; la liaison périmée du compte
malveillant est alors libérée (« Liaison périmée » ci-dessous). La vraie correction demande une build : `ASWebAuthenticationSession` (ou un lien universel)
avec un schéma de rappel capté par l'app ; Strava renvoie `code` et `state` à l'app, qui les envoie à
une fonction authentifiée par son JWT, et le serveur vérifie que l'état appartient à ce compte
(`state.user_id = auth.uid()`). À faire sur une branche « build ».

### Liaison périmée

Sans sortie, l'index unique bloquerait un athlète pour toujours : la ligne du compte qui le détient ne
disparaît que si ce compte se déconnecte, est supprimé, ou tente un envoi refusé par Strava. Deux cas
réels : la victime du scénario CSRF ci-dessus, qui a retiré l'accès chez Strava ; une personne qui a
perdu l'accès à son ancien compte MDLF (passage d'un e-mail à « Se connecter avec Apple »).

Au retour de Strava, sur `athlete_taken`, `strava-connect` appelle `freeStaleAthlete`
(`_shared/strava.ts`) avant de répondre `#deja` :

1. `strava_link_holder(athlete)` : compte détenteur et ses jetons chiffrés (`service_role`).
2. `holderVerdict` (`_shared/strava-policy.js`, logique pure testée) : même jeton de renouvellement que
   celui reçu à l'instant → même accord, valable ; sinon renouvellement avec le jeton du **détenteur**
   (aucun droit demandé, contrairement à `GET /athlete` qui exige `read`). Réponse 400 ou 401 : accès
   retiré (jeton indéchiffrable aussi : clé changée). Réponse valable : jetons tournés réenregistrés pour
   le détenteur (l'ancien ne vaut plus chez Strava), refus `#deja`. Strava injoignable : `#erreur`, rien
   n'est effacé.
3. Accès retiré : `strava_link_release(détenteur, athlète, jetons lus)` efface la liaison (envois notés
   et états en attente aussi) **seulement si elle n'a pas changé** depuis la lecture : un envoi du
   détenteur qui vient de renouveler ses jetons prouve que son accès vaut encore. Puis une seule nouvelle
   tentative de `strava_link_save`.

La page `#deja` dit donc aussi : « si tu n'as plus accès à l'autre compte, ou si tu ne l'as jamais relié
toi-même, retire MDLF Training dans strava.com/settings/apps, puis réessaie ». Aucun outil de support
n'est nécessaire.

Ce que le détenteur y perd : rien. Son accès était déjà inutilisable ; son prochain envoi aurait effacé
la liaison de la même façon (`stravaAccess`). Hypothèse sur Strava (non documentée, à vérifier dans les
essais à la main) : un nouvel accord pour un athlète déjà autorisé rend le même jeton de renouvellement,
ou du moins n'invalide pas celui du détenteur. Si ce n'était pas le cas, la vérification verrait le
détenteur comme révoqué et la protection `athlete_taken` contre le scénario CSRF ne tiendrait plus (la
page `#ok` s'afficherait pour le nouveau compte, le premier perdrait sa liaison) : il faudrait alors
garder le refus et passer par le webhook. Le webhook de
Strava (« athlete update », `authorized=false`) libérerait la liaison dès le retrait ; il demande
d'enregistrer un abonnement chez Strava : piste pour plus tard.

### Serveur

- Migration `supabase/migrations/20261031620000_strava.sql` (retour arrière :
  `supabase/rollback/20261031620000_strava_down.sql`). Tables `private.strava_links`,
  `private.strava_states`, `private.strava_exports` (schéma jamais exposé, RLS sans politique, aucun
  GRANT). RPC security definer, `search_path = ''` :
  - `strava_status()` : rôle `authenticated`, lit `auth.uid()`, jamais un jeton ni le numéro d'athlète.
  - `strava_state_create`, `strava_state_consume`, `strava_link_save`, `strava_link_get`,
    `strava_link_tokens`, `strava_link_delete`, `strava_link_holder`, `strava_link_release`,
    `strava_export_begin`, `strava_export_finish` :
    rôle `service_role` seulement (fonctions Edge), le compte vient du jeton vérifié ou de l'état.
  - Limites : 10 débuts de liaison par heure, 30 envois par 24 h et par compte (journal
    `private.social_rate`). Elles protègent aussi le quota de l'app chez Strava, commun à tous.
- Fonctions Edge (`verify_jwt = false`, jeton vérifié dans le code comme les autres) :
  `strava-connect` (POST : début ; GET : retour de Strava), `strava-export`, `strava-disconnect`.
  `delete-account` révoque aussi l'accès Strava avant de supprimer le compte.
- Retour de Strava (ancre de `web-public/strava.html`) : `#ok`, `#refuse`, `#droits`, `#deja`
  (athlète relié à un autre compte), `#expire`, `#erreur`.
- Erreurs (`error` du corps) : `auth` 401, `invalid` 400, `not_connected` 409, `busy` 409, `scope` 403,
  `rate_limited` 429, `strava_busy` 503 (quota de Strava), `strava_down` 503, `not_configured` 503,
  `strava` 502, `server` 500. Textes dans `STRAVA_ERROR_TEXT`.

### Tests

- `tests/unit/strava-server.mjs` : adresse d'autorisation, droits accordés, jetons reçus,
  renouvellement, identifiant d'activité (jamais arrondi), validation de l'envoi, chiffrement
  (aller-retour, autre compte, altération, autre clé), état OAuth, `approval_prompt=force`, chaque
  résultat du retour présent sur `web-public/strava.html`, liaison du détenteur périmée ou valable
  (`holderVerdict` : accès retiré, accès valable avec jetons tournés réenregistrés, Strava injoignable,
  même accord, jetons indéchiffrables), sortie donnée par la page `#deja` (strava.com/settings/apps).
- `tests/unit/strava.mjs` : séance envoyable, type d'activité, description (ni notes ni poids),
  corps accepté par la validation du serveur, état nettoyé, cache par compte, séances importées de
  Hevy ou Strong refusées (jusqu'à `applyImport`), `Native.openOutside` (navigation dans l'app, nouvel
  onglet ailleurs, jamais une adresse non https).
- `tests/sql/strava_test.sql` : anon et client sans accès aux tables ni aux RPC serveur, état sans
  jeton, usage unique de l'état, changement d'athlète, athlète déjà relié à un autre compte
  (`athlete_taken`, index unique), liaison périmée (`strava_link_holder`, `strava_link_release` :
jamais avec des jetons qui ont changé ni pour un autre athlète, puis athlète relié au nouveau compte),
déconnexion complète, limites, cascade à la
  suppression du compte. `tests/sql/strava_rollback_check.sh` : retour arrière (deux fois) puis tous
  les autres tests.
- `tests/test_strava.py` : écrans dans l'app iOS simulée (Strava simulé par `tests/fake_account.py`) ;
  les liens vers Strava passent par `Native.openOutside`, jamais `window.open`. Que Safari s'ouvre
  vraiment ne se vérifie que sur un iPhone (liste plus bas).

Les fonctions Edge (TypeScript, Deno) ne sont pas lancées par les tests : leur logique pure l'est ;
le reste est à essayer une fois déployé (liste plus bas).

## Ce que Maxence doit faire avant la mise en production

### 1. Créer l'application sur strava.com/settings/api

Connecté avec **son** compte Strava (le propriétaire de l'application) :

| Champ | Valeur |
|---|---|
| Application Name | `MDLF Training` (jamais « Strava » dans le nom : charte) |
| Category | `Training` (ou `Performance Analysis`) |
| Club | vide |
| Website | `https://mdlf.app` |
| Application Description | « Carnet de musculation pour iPhone. Envoie tes séances terminées vers Strava (création d'activités seulement, rien n'est lu). » |
| Authorization Callback Domain | `yopptmdjtnezmccdvaxf.supabase.co` (domaine du projet Supabase, sans `https://` ni chemin) |
| Icône | `icon-512.png` du dépôt |

Accepter l'API Agreement. Strava donne alors le **Client ID** (public) et le **Client Secret**
(secret : ne jamais le coller dans le dépôt, un message ou un ticket).

### 2. Capacité d'athlètes (indispensable pour les utilisateurs)

Une nouvelle application est en **« Single Player Mode »** : un seul athlète peut la relier (son
propriétaire). Ensuite :

1. Dans le tableau de bord de l'API, passer à **10 athlètes** (bouton d'évolution : limites portées à
   400 requêtes / 15 min et 4 000 / jour) ; de quoi tester avec quelques testeurs TestFlight.
2. Au-delà de 10 : **demander la revue de l'application** par Strava (formulaire du programme
   développeurs, captures de l'écran Réglages › Strava et du bouton d'envoi, lien vers la page de
   confidentialité). Tant qu'elle n'est pas acceptée, le 11e athlète ne peut pas se relier.

### 3. Poser les secrets du projet Supabase

```
supabase secrets set STRAVA_CLIENT_ID=<Client ID> STRAVA_CLIENT_SECRET=<Client Secret> \
  STRAVA_TOKEN_KEY=$(openssl rand -base64 32)
# Facultatif : page de retour ailleurs que https://mdlf.app/strava.html
# supabase secrets set STRAVA_RETURN_URL=https://…/strava.html
```

`STRAVA_TOKEN_KEY` : la générer une fois et la garder (gestionnaire de mots de passe). La changer
rend toutes les liaisons illisibles : elles sont effacées au prochain envoi et chacun doit relier
Strava à nouveau.

### 4. Déployer, dans cet ordre

1. Migration `20261031620000_strava.sql` (puis `bash tests/sql/run.sh` vert avant).
2. Fonctions : `supabase functions deploy strava-connect strava-export strava-disconnect delete-account`.
3. Site public : `web-public/strava.html` part avec le job `deploy` de `tests.yml` (push sur main).
   Vérifier que `https://mdlf.app/strava.html#ok` s'affiche.
4. Mise à jour de l'app (OTA : aucun changement natif).

### 5. Essais à la main une fois déployé (sur l'iPhone, avec son compte Strava)

- Relier : Safari s'ouvre, autoriser, page « Strava est relié », retour dans l'app : « Compte Strava : … ».
- Refuser, puis décocher « Créer des activités » : pages `#refuse` et `#droits`, rien de relié.
- L'écran d'accord de Strava s'affiche **à chaque** liaison, même après une première autorisation
  (`approval_prompt=force`).
- Un toucher sur « Connect with Strava » ouvre bien Safari (et pas seulement la consigne) ; idem
  « View on Strava » et « Ouvrir Strava » après une déconnexion non confirmée.
- Relier le même Strava depuis un second compte MDLF de test : page `#deja`, le premier compte reste
  relié et peut toujours envoyer (vérifie l'hypothèse de « Liaison périmée » : un nouvel accord
  n'invalide pas le jeton du premier compte ; à refaire plus de 6 heures après le dernier envoi).
- Puis retirer MDLF Training dans strava.com/settings/apps et relier depuis le second compte : page
  `#ok`, le premier compte affiche « pas relié » au prochain chargement de Réglages › Strava.
- Envoyer une séance de musculation, une course sur tapis, une sortie vélo : type, durée, distance,
  description corrects sur Strava ; « View on Strava » ouvre l'activité.
- Double toucher sur « Envoyer » : une seule activité.
- Retirer MDLF Training dans strava.com/settings/apps, puis envoyer : « Strava n'est plus relié ».
- Déconnecter depuis l'app : MDLF Training disparaît de strava.com/settings/apps.
- Supprimer un compte de test relié : l'accès disparaît aussi chez Strava.

### 6. App Store Connect

La page de confidentialité (`privacy.html`, section Strava) est à jour. Dans « Confidentialité de
l'app », rien de nouveau n'est collecté à des fins de suivi ; le contenu des séances envoyées part chez
un tiers à la demande de la personne : vérifier la déclaration « Données utilisateur partagées »
(« Fitness » liée à l'utilisateur, fonctionnalité de l'app) avec Maxence avant la soumission.

## Choix pris là où rien n'était tranché

1. Envoi **manuel** seulement (un toucher par séance), pas d'envoi automatique : plus simple et plus
   sûr (pas d'envoi par surprise, pas de doublon avec Santé si la personne relie aussi Santé à Strava).
2. **Notes jamais envoyées** : souvent personnelles (douleurs, ressenti).
3. Séances passées saisies à la main **non envoyables** : pas d'heure ni de durée réelles. Séances
   importées de Hevy ou Strong non plus (heure de début, souvent déjà sur Strava). Choisi plutôt qu'un
   marqueur « terminée dans l'app » posé à la fin de séance : un marqueur rendrait non envoyables
   toutes les séances faites avant cette version.
4. Droit demandé : `activity:write` seul (Strava montre la plus petite demande possible).
5. Page web `/oauth/authorize` dans Safari plutôt que l'app Strava (`strava://oauth/mobile/authorize`,
   qui demanderait `LSApplicationQueriesSchemes` et un schéma de retour natifs, donc une build).
