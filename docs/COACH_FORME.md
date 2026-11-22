# « Ma coach » : accord du mot coach

Demande de Maxence (22/11/2026) : l'app écrivait toujours le coach au masculin, alors que beaucoup de coachs sont des
femmes. Une coach doit lire, et ses élèves avec elle, « Ma coach », « Ta coach t'a envoyé un programme », « Quitter ma
coach », « Nouvelle coach » sur son affiche. Branche `coach-feminin`.

## Qui choisit, où

- **Le coach lui-même, à un seul endroit** : Réglages › Coach › « Tes élèves lisent », trois choix en liste iOS à
  coche : « Mon coach » (`il`), « Ma coach » (`elle`), « Ne pas préciser » (`neutre`). Juste sous « Ton code coach ».
- **Jamais deviné** : ni du prénom, ni de la silhouette de l'affiche, ni de la photo.
- **Sans réponse** (jamais choisi, pas encore lu, serveur sans la migration) : l'accord d'avant, « ton coach ».
- `neutre` : l'accord par défaut du français dans les phrases (« ton coach », « il »), et « COACH » seul sur l'affiche.
  Le français n'a pas de forme neutre courante pour « ton/ta » ; la réécriture épicène de chaque phrase n'est pas faite.

## L'affiche

Le titre suit la forme quand elle est connue : `elle` → NOUVELLE COACH, `il` → NOUVEAU COACH, `neutre` → COACH (la
ligne Titre de l'aperçu disparaît alors). Sans forme : comme avant, la silhouette accorde le titre. Le choix « Coach »
seul de l'aperçu reste possible pour `il` et `elle`. La consigne garde « Rejoindre un coach » : c'est le libellé du
bouton que l'élève va chercher, avant de savoir qui est son coach.

## Côté app

- `js/data/coach-form.js` : `coachWord(clé, forme)` (ton, mon, un, le, du, au, ce, nouveau, ancien, et les pronoms
  il, pron « le/la », e « prêt/prête » ; majuscule gardée : « Ton » → « Ta coach »), `myCoachWord(clé)` (forme de mon
  coach, pour l'élève), `myOwnCoachForm()` (la mienne, pour le coach), `coachFormOf(uid)`.
- Forme gardée sur l'appareil (`mdlf_coach_form`, par compte) : textes justes hors ligne et dès le démarrage, y compris
  les notifications locales. Relue au plus toutes les 5 minutes, à chaque état coach lu.
- Choix du coach gardé tout de suite sur l'appareil, envoyé ensuite ; hors ligne ou serveur d'avant, il reste en
  attente et repart au prochain état lu. L'envoi en attente part avant la relecture de ma forme (sinon une lecture
  partie en même temps rendrait l'ancienne valeur et l'écraserait : test unitaire « course »).
- Copie en mémoire de `mdlf_coach_form` (lue à chaque texte) : vidée par `coachFormSave` et au changement de compte.
  La clé est effacée à la déconnexion et par « Supprimer toutes les données » (`CROSS_USER_CACHE_KEYS`).
- Plans de nutrition d'un ancien coach : accordés à la forme de CE coach (`coachFormOf(plan.fromCoach.coachId)`),
  pas à celle du coach actuel.
- Confidentialité : privacy.html, « Accord du mot coach » (`#accord-coach`, FR et EN).
- Coach encore inconnu (bouton « Rejoindre un coach », aperçu avant de rejoindre, guide, erreurs à la saisie d'un code) :
  `coachWord` sans forme, donc l'accord par défaut.
- Constantes de textes qui parlaient du coach : devenues des fonctions ou des getters (la forme change pendant
  l'utilisation).

## Côté serveur

Migration `supabase/migrations/20261122010000_forme_coach.sql`, **écrite, pas appliquée** (feu vert de Maxence).
Retour arrière : `supabase/rollback/20261122010000_forme_coach_down.sql`. Indépendante : aucune fonction existante
réécrite, `push_claim` n'est pas touché.

- Table `public.coach_forms (user_id, form in ('il','elle','neutre'))`, aucun GRANT client.
- `coach_set_form(form)` : coach validé seulement (`not_coach`), liste fermée (`invalid_form`).
- `coach_form(coach)` : le coach lui-même et ses élèves, rien en cas de blocage ni pour un ancien coach (mêmes règles
  que `coach_poster_name`).
- `push_actor_forms(ids)` : clé serveur seulement ; pour des lignes de la file, la forme de l'auteur quand il est le
  coach du destinataire. push-send ne la demande que pour les commentaires : « Commentaire de la coach ». Fonction
  absente : texte d'avant, la notification part quand même.

Ordre de mise en production : la migration, puis `push-send` redéployée (elle tolère l'absence de la fonction, donc
l'ordre inverse marche aussi), puis l'OTA. Une app d'avant ignore tout ; une app à jour sur un serveur d'avant écrit
« ton coach » sans message.

## Tests

- `tests/unit/coach-form.mjs` : `coachWord` pour chaque clé et chaque forme (et les valeurs inconnues), forme gardée
  par compte, et **balayage** de js/ et index.html (commentaires retirés) : il échoue dès qu'un texte écrit « ton
  coach », « un coach », « la coach »… en dur au lieu de passer par `coachWord`. Il ne voit pas les pronoms (« il
  pourra ») : relus à la main.
- `tests/unit/push.mjs`, `tests/deno/push_forme_coach.test.ts` : titre de la notification, fonction absente.
- `tests/sql/forme_coach_test.sql` : droits, écriture, lecture (élève, blocage, ancien coach), file des push ;
  `tests/sql/rollback_nuit_check.sh` : retour arrière seul et dans l'ordre.
- `tests/test_coach_forme.py` : la coach choisit « Ma coach » (et hors ligne, renvoyé au retour du réseau) ; son élève
  lit « Ma coach », « Ta coach depuis le… », aucun accord au masculin dans Mon coach ; serveur d'avant : « Mon coach ».

## Pas fait

- Aperçu avant de rejoindre (« Rejoindre ce coach ») : le serveur ne donne la forme qu'une fois le lien fait. L'aperçu
  prend la forme gardée sur l'appareil pour ce coach (`coachFormOf`, par exemple un ancien coach qu'on rejoint de
  nouveau), sinon l'accord par défaut. L'ouvrir à qui détient un code valide demanderait de réécrire `coach_preview`.
  Juste après « Accepter », la forme est lue tout de suite (`coachFormAwait`, 1,5 s au plus) : « Léa est ta coach ».
- Textes du coach sur ses élèves (« ton élève ») : non concernés (le genre des élèves n'est pas demandé).
