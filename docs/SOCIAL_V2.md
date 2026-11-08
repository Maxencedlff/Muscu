# Social V2 : l'onglet Social, l'onglet Coach et un fil plus vivant

Demande de Maxence (06/11/2026) : « amis j'aimerais le nommer social, et le refaire en mieux. C'est pas très
beau et agréable pour le moment » ; et, sur le mode coach, caché dans l'onglet Amis où un coach ne le trouvera
pas : « très important, quitte à faire un autre truc à côté de amis ». Règle n°1 : tout doit être très simple
et évident, pour les pratiquants et pour les coachs.

Branche `social-refonte`. Aucune fonction serveur, aucune migration : tout part des données que l'app reçoit
déjà (`feed`, `social_state`, `coach_state`, `coach_progress`).

## Décision

**Le 5e onglet s'appelle « Social » (icône des personnes). Pour un compte coach, le même onglet s'appelle
« Coach » (icône de la planchette) et s'ouvre sur ses élèves ; un contrôle segmenté « Élèves | Social » en
tête lui rend ses amis et son fil d'un toucher.**

Un élève et un pratiquant ne voient jamais « Coach » : leur onglet est « Social ». L'élève trouve « Mon coach »
en tête de Social ; un pratiquant sans coach y trouve « Rejoindre un coach », en tête lui aussi (et dans Réglages ›
Coach). Intégration du 07/11 (branche `vague2`) : la refonte le mettait en bas de Social, mais le panel du 07/11
(20 personas, vague 1) demande qu'il soit visible sans défiler ; il reste donc en tête, au-dessus de la carte
d'activation des amis et de la recherche.

### Les trois propositions comparées

Maquettes HTML (CSS de l'app), iPhone 13, clair et sombre : écran du coach, fil d'un pratiquant, Social d'un
élève. Captures gardées dans le dossier des maquettes (voir le rendu du chantier).

| | A. Social segmenté | B. Onglet Coach (retenue) | C. Carte sur l'accueil |
|---|---|---|---|
| Idée | Onglet « Social » pour tous ; un coach a « Élèves \| Amis » en tête | Onglet « Coach » pour un compte coach (Élèves \| Social), « Social » pour les autres | Onglet « Social » inchangé ; carte « Mes élèves » en tête d'Entraînement |
| Évidence pour le coach | Moyenne : il doit deviner que ses élèves sont dans « Social » | **Forte** : le mot et l'icône de son métier sont dans la barre d'onglets, toujours visibles | Bonne à l'ouverture de l'app, mais la carte pousse « Démarrer » vers le bas et disparaît dès qu'on change d'onglet |
| Bruit pour un pratiquant sans coach | Aucun | Aucun | Aucun |
| Simplicité | Un onglet, deux contenus | Un onglet, un nom qui dit ce qu'il contient | Deux entrées pour la même chose (carte et onglet) |
| Touchers : fiche d'un élève | 2 | **2** | 2 (depuis l'accueil seulement) |
| Touchers : qui a progressé | 1 | **1** | 0 sur l'accueil, puis 1 pour le détail |
| Coût | Faible | Faible : le libellé suit `coachRole()`, déjà gardé sur l'appareil | Moyen : l'accueil est l'écran le plus chargé |

Pourquoi B :
- **Le coach cherche « Coach »**, pas « Social » : c'est la remarque du fondateur. Hevy fait de même en séparant
  le suivi d'élèves de l'app sociale (Hevy Coach, tableau de bord à part), sans demander au coach d'installer
  une seconde app ici.
- **5 onglets au plus** (iOS) : un 6e onglet ferait apparaître « Plus » ; B réutilise la 5e place.
- **Un coach est aussi un pratiquant** : ses séances restent dans Entraînement, Historique, Progrès ; ses amis
  et son fil sont dans le segment Social, au même endroit.
- **Une icône = un sens** : personnes = Social ; planchette = Coach (onglet d'un coach, « Rejoindre un coach »).
  Les deux mots sont dans docs/ERGONOMIE.md.

Ce qu'on perd : le coach atteint son fil d'amis en 2 touchers au lieu d'un (onglet, puis Social). Accepté :
pour un coach, ses élèves passent avant son fil. « Rejoindre un coach » reste en tête de Social (une seule
cellule, discrète), et dans Réglages › Coach ; le message d'invitation dit « onglet Social › Rejoindre un coach ».

### Touchers, avant et après

| Action | Avant | Après |
|---|---|---|
| Coach : ouvrir la fiche d'un élève | 3 (Amis › Mes élèves › l'élève) | **2** (Coach › l'élève) |
| Coach : voir qui a progressé | 2 (Amis › Mes élèves, signal de chaque ligne) | **1** (Coach : « Cette semaine » et liste triée) |
| Coach : voir son fil d'amis | 1 (Amis) | 2 (Coach › Social) |
| Élève : ouvrir Mon coach | 2 (Amis › Mon coach) | 2 (Social › Mon coach) |
| Commenter la séance d'un ami | carte, défiler jusqu'aux commentaires, champ | **Commenter, champ** (la séance s'ouvre sur ses commentaires) |
| Inviter un ami | aucun moyen dans l'app | 1 (fil vide ou Mon profil › Inviter un ami) |

Mesurés par `tests/test_social_v2.py` (fiche d'un élève en 2 touchers, qui a progressé en 1).

## Ce qui change à l'écran

### Onglet Coach (compte coach)
- Grand titre « Coach », segments **Élèves | Social** ; Élèves à l'ouverture de l'app, gardé au retour d'une
  fiche et après avoir retiré un élève ; une notification de demande d'abonnement ouvre Social.
- **Élèves** : « Cette semaine », trois chiffres d'un coup d'œil (records battus en vert avec ↑, élèves à
  relancer en orange, nouveautés à lire), rien à toucher (VoiceOver lit une phrase) ; puis le contenu de Mes
  élèves (planning, élèves triés avec leur signal, invitations, retirés), le même que Réglages › Coach › Mes
  élèves (`coachTeamHtml`). Calcul pur : `teamWeekSummary` (js/data/coach-progress.js).
- **Social** : exactement l'onglet Social d'un pratiquant (sans « Rejoindre un coach »).

### Onglet Social
- Recherche de pseudo avec la loupe, 44 pt de haut.
- **Carte de séance** (inspirée de Strava et Hevy, sans copie) : avatar, pseudo et « il y a 2 h » (vers son
  profil) ; nom de la séance en grand avec sa couleur ; trois chiffres côte à côte (durée, volume, séries sans
  l'échauffement) ; le record noté le plus marquant en **pastille dorée** (« 🏆 Record · Squat 125 kg +1 ») ;
  les trois muscles les plus travaillés en puces discrètes (`feedMuscles`, d'après le nom des exercices) ; puis
  la réaction (un toucher 👏, appui long : le choix) et **Commenter**. Strava a montré en 2026 qu'une carte du
  corps automatique dans le fil agace : ici, des mots, pas de silhouette.
- **Fil vide** : « Ton fil t'attend », mon pseudo, **Inviter un ami** (feuille de partage d'iOS : « Ajoute-moi
  dans l'onglet Social : mon pseudo est max. ») ; la recherche est le champ juste au-dessus (le bouton « Rechercher un
  pseudo » qui le doublait est retiré depuis le panel du 08/11).
- « Mon coach » (élève) en tête, carte arrondie ; « Rejoindre un coach » (pratiquant sans coach) au même endroit,
  visible sans défiler (panel du 07/11).
- **Mon profil** : « Modifier » (pseudo et avatar, écran du compte) et « Inviter un ami ».

### Règles tenues
Noir pur en sombre, tokens de css/base.css seulement ; 44 pt partout (« Commenter » devient l'icône seule sous
340 pt de large) ; rien au `pointerdown` ; pas d'animation nouvelle autre que le fond pressé (les durées
tombent à zéro avec `prefers-reduced-motion`, règle de css/components.css).

## Ce qui manque côté données (sans migration)
- **Nombre de commentaires** sur la carte : `feed` ne le renvoie pas. La carte dit « Commenter » sans compte.
- **Muscles** : déduits du nom des exercices (bibliothèque, puis règles), pas des muscles que l'ami a choisis
  dans son app (la liste blanche `private.session_public` ne les envoie pas). Un exercice inconnu n'en a pas.
- **Volume** : charge notée × reps, poids du corps non compté (comme la séance d'un ami).

## Fichiers
js/ui/router.js et js/ui/navbar.js (libellé et icône du 5e onglet : `tabMeta`, `syncTabMeta`),
js/features/social-ui.js (onglet, segments, carte, fil vide, Commenter, Inviter), js/features/coach-ui.js
(`coachCellHtml`, `coachTeamHtml`, `coachTeamEnter`), js/features/coach-progress-ui.js (`coachTeamWeekHtml`),
js/features/social-me-ui.js (Modifier, Inviter un ami), js/features/push-ui.js (segment ouvert par une
notification), js/data/social.js (`feedMuscles`, `friendInviteText`), js/data/coach-progress.js
(`teamWeekSummary`), js/data/coach.js (texte d'invitation), js/data/guide.js, css/social.css, css/coach.css,
index.html (icônes `coach` et `magnifyingglass`). Tests : tests/test_social_v2.py, tests/unit/social.mjs,
tests/unit/coach-progress.mjs, et les libellés des tests existants.

## À faire avec Maxence
- privacy.html et cgu.html disent « Social » depuis le commit 5db2255 (chemins réels : « Social › Mon profil ›
  Gérer », « Réglages › Social et coach ») : textes juridiques, à relire avec lui (docs/JURIDIQUE.md).
