// ═══════════════════════════════════════════════════════════
//  Guide de l'app : sujets regroupés par thème (Réglages › Guide de l'app)
//  Donnée seule : l'écran est dans js/features/guide.js
// ═══════════════════════════════════════════════════════════
'use strict';

// Chaque sujet : id (unique, sert de route « guide-topic:ID »), title, icon (symbole du sprite
// d'index.html), color (pastille : blue, green, orange, red, indigo, teal, purple), lead (une ou deux
// phrases), steps (au plus 5 étapes ou points), ordered (étapes à suivre dans l'ordre), iphone (réservé
// à l'app iPhone), related (sujets liés), actions (data-action des éléments décrits).
//
// Libellés de l'app entre crochets : « [Réglages] › [Repos par défaut] ». L'écran les met en valeur,
// et les tests unitaires (tests/unit/guide.mjs) vérifient que chaque libellé et chaque action existent
// bien dans le code : un bouton renommé sans mise à jour du guide fait échouer les tests.
// Ton : tutoiement, phrases courtes, chemin exact pour chaque geste.

const GUIDE_SECTIONS = [
  {
    id: 'commencer', title: 'Commencer',
    topics: [
      {
        id: 'accueil', title: 'L\'écran Entraînement', icon: 'dumbbell', color: 'blue',
        lead: 'L\'onglet [Entraînement] s\'ouvre au lancement. Il te propose la prochaine séance de ton programme.',
        steps: [
          'La carte du haut montre la séance du jour. Touche [Démarrer] pour la lancer.',
          '[À battre aujourd\'hui] rappelle ta dernière performance sur les premiers exercices, avec un petit objectif en plus.',
          '[Cette semaine] compte tes séances face à ton objectif. Touche la carte pour ouvrir [Progrès].',
          '[Autres séances] liste le reste du programme et le temps de récupération qu\'il leur reste.',
          'Le bouton en haut à droite (roue ou avatar) ouvre les [Réglages].',
        ],
        related: ['lancer-seance', 'recuperation', 'objectif'],
        actions: ['start-session', 'session-actions', 'go-settings'],
      },
      {
        id: 'choisir-programme', title: 'Choisir un programme', icon: 'list.bullet', color: 'indigo',
        lead: 'Tes programmes sont rangés dans [Mes programmes], dans l\'ordre que tu choisis. L\'app en propose sept prêts à l\'emploi : PPL, Upper / Lower, Full Body, Bro Split, Arnold Split, Maison et Maison haltères.',
        steps: [
          'Va dans [Programme] › [Mes programmes] et touche celui que tu veux : la coche montre le programme actif.',
          '[Ajouter un programme] › [Tous les programmes] : chaque fiche explique le programme et montre les muscles travaillés. [Ajouter à mes programmes] le garde dans ta liste, [Utiliser ce programme] l\'active tout de suite.',
          '[Modifier] range ta liste avec la poignée ≡. [Retirer] enlève un programme de ta liste ; il reste dans [Tous les programmes].',
          'Sur l\'accueil, la ligne « Programme » sous la date mène aussi à [Mes programmes].',
          'Ton historique reste disponible quand tu changes de programme.',
        ],
        related: ['creer-programme', 'modifier-seance'],
        actions: ['go-my-programmes', 'select-prog', 'go-prog-add', 'open-prog-info', 'prog-info-add', 'prog-info-use', 'toggle-my-prog-edit', 'remove-my-prog'],
      },
      {
        id: 'reglages', title: 'Réglages de base', icon: 'gear', color: 'blue',
        lead: 'Ouvre les [Réglages] depuis le bouton en haut à droite de l\'accueil, ou depuis l\'onglet [Programme].',
        steps: [
          '[Repos par défaut] : le repos entre deux séries, pour les exercices qui n\'ont pas le leur.',
          '[Unité] : kg ou lbs. Tout l\'affichage suit, tes séances ne changent pas.',
          '[Sons] et [Vibrations] : bips du repos et retour au toucher.',
          '[Thème] : [Auto], [Clair] ou [Sombre].',
          '[Silhouette] : la carte des muscles en version [Femme] ou [Homme].',
        ],
        related: ['repos', 'objectif'],
        actions: ['go-settings', 'setting-rest', 'setting-unit', 'setting-sound', 'setting-vibrate', 'set-theme', 'set-silhouette'],
      },
    ],
  },
  {
    id: 'seance', title: 'Pendant la séance',
    topics: [
      {
        id: 'lancer-seance', title: 'Lancer une séance', icon: 'play', color: 'green', ordered: true,
        lead: 'Une séance se lance depuis l\'onglet [Entraînement].',
        steps: [
          'Touche [Démarrer] sur la prochaine séance. Pour une autre, touche-la dans [Autres séances], puis [Démarrer].',
          'Si la récupération n\'est pas finie, le bouton devient [Démarrer quand même].',
          'Les séries sont déjà remplies avec ce que tu as fait la dernière fois. L\'écran reste allumé.',
          'La flèche en haut à gauche réduit la séance sans l\'arrêter. Une barre en bas de l\'écran permet d\'y revenir.',
        ],
        related: ['noter-serie', 'terminer', 'recuperation'],
        actions: ['start-session', 'session-actions', 'resume-session'],
      },
      {
        id: 'noter-serie', title: 'Noter une série', icon: 'checkmark', color: 'green',
        lead: 'Chaque ligne est une série. La colonne [Avant] montre ce que tu as fait la dernière fois.',
        steps: [
          'Tape la charge et les répétitions. Une case laissée vide prend la valeur grise affichée : ton objectif.',
          'Touche le rond à droite pour valider. Le repos démarre tout seul.',
          'Une erreur ? [Annuler] reste quelques secondes en bas de l\'écran.',
          'Touche une série validée pour la corriger. Glisse-la vers la gauche pour la [Supprimer].',
          'Le bouton [Série] sous l\'exercice ajoute une série.',
        ],
        related: ['charges', 'repos', 'records'],
        actions: ['validate-set', 'edit-set', 'save-edit-set', 'delete-set', 'add-set'],
      },
      {
        id: 'charges', title: 'Charges en kg ou en lbs', icon: 'dumbbell', color: 'blue',
        lead: 'La charge se tape dans la colonne [kg] (ou [lbs]), avec une virgule ou un point.',
        steps: [
          '[Réglages] › [Unité] passe tout l\'affichage en kg ou en lbs. Tes séances ne sont pas modifiées.',
          'Si tu changes la charge d\'une série, la suivante prend la même.',
          'Laisse la charge vide pour un exercice sans poids.',
          'Une valeur loin de tes habitudes, comme 180 répétitions au lieu de 18, te demande de confirmer : [Valeur inhabituelle].',
        ],
        related: ['noter-serie', 'lest', 'augmenter-charge'],
        actions: ['setting-unit'],
      },
      {
        id: 'repos', title: 'Repos et minuteur', icon: 'timer', color: 'orange',
        lead: 'Le repos démarre quand tu valides une série. Il se règle sans quitter la séance.',
        steps: [
          'En bas de l\'écran : [−15] ou [+15] secondes, ou [Passer].',
          'Touche le chrono pour l\'agrandir et choisir une durée toute prête. [Réduire] le referme.',
          'Le lien « Repos » sous le nom de l\'exercice change le repos de cet exercice. Il est gardé dans le programme.',
          'Le repos de tous les autres exercices se règle dans [Réglages] › [Repos par défaut].',
          'Dans l\'app iPhone, une notification annonce la fin du repos quand l\'app est en arrière-plan.',
        ],
        related: ['ecran-verrouille', 'menu-exercice'],
        actions: ['rest-adjust', 'skip-rest', 'expand-rest', 'collapse-rest', 'set-rest', 'set-ex-rest', 'setting-rest'],
      },
      {
        id: 'ecran-verrouille', title: 'Le repos sur l\'écran verrouillé', icon: 'timer', color: 'orange', iphone: true,
        lead: 'Dans l\'app iPhone, le repos en cours s\'affiche sur l\'écran verrouillé, et dans la Dynamic Island des iPhone qui en ont une.',
        steps: [
          'Le compte à rebours y tourne tout seul, avec la série qui suit.',
          'Il suit tes changements : 15 secondes en plus ou en moins, autre durée.',
          'Le chrono d\'un exercice en durée, comme le gainage, s\'y affiche aussi.',
          'Il disparaît dès que le repos se termine ou que tu le passes.',
        ],
        related: ['repos', 'duree'],
        actions: [],
      },
      {
        id: 'menu-exercice', title: 'Le menu ··· d\'un exercice', icon: 'ellipsis', color: 'indigo',
        lead: 'Le bouton ··· à droite du nom d\'un exercice regroupe ses options pendant la séance.',
        steps: [
          '[Monter] et [Descendre] changent l\'ordre des exercices.',
          '[Comment faire] ouvre les consignes du mouvement.',
          '[Remplacer l\'exercice], [Régler le repos] et [Tempo] agissent sur cet exercice.',
          '[Relancer le repos] redémarre le chrono.',
          '[Retirer l\'exercice] l\'enlève de cette séance seulement. Le programme ne change pas.',
        ],
        related: ['ajouter-exercice', 'comment-faire', 'tempo'],
        actions: ['ex-menu'],
      },
      {
        id: 'ajouter-exercice', title: 'Ajouter ou remplacer un exercice', icon: 'plus', color: 'blue',
        lead: '[Ajouter un exercice], en bas de la séance, ouvre la recherche dans la bibliothèque.',
        steps: [
          'Tape un nom ou un muscle. Le filtre de matériel ([Tout], [Haltères et banc]…) réduit la liste.',
          'Choisis le nombre de [Séries]. Active [Ajouter au programme] pour le retrouver la prochaine fois.',
          'Un exercice introuvable ? [Créer] l\'ajoute avec le nom tapé.',
          'Pour remplacer : ··· › [Remplacer l\'exercice]. Ceux qui travaillent les mêmes muscles sont en tête, avec une version [Plus facile] ou [Plus dur].',
          'Les séries déjà validées restent sur l\'ancien exercice.',
        ],
        related: ['bibliotheque', 'menu-exercice'],
        actions: ['add-session-ex', 'ax-pick', 'ax-equip', 'ax-sets'],
      },
      {
        id: 'comment-faire', title: 'Comment faire un exercice', icon: 'info.circle', color: 'teal',
        lead: 'Chaque exercice de la bibliothèque a sa fiche : les consignes et l\'erreur la plus fréquente.',
        steps: [
          'Pendant la séance, touche le nom de l\'exercice (suivi d\'un i) ou ··· › [Comment faire].',
          'Hors séance : [Programme] › [Bibliothèque d\'exercices], puis l\'exercice.',
          'La fiche montre aussi les muscles travaillés, le matériel et une version plus facile ou plus dure.',
          'Un exercice que tu as créé n\'a pas de fiche.',
        ],
        related: ['bibliotheque', 'menu-exercice'],
        actions: ['ex-howto', 'go-library', 'open-library-ex'],
      },
      {
        id: 'terminer', title: 'Terminer la séance', icon: 'checkmark', color: 'green', ordered: true,
        lead: 'Touche [Terminer] en haut à droite quand tu as fini.',
        steps: [
          '[Enregistrer la séance] la range dans l\'historique. [Abandonner la séance] l\'efface.',
          'Seules les séries validées sont enregistrées.',
          'Le bilan affiche la durée, le volume, les séries et tes [Nouveaux records].',
          'Écris une note si tu veux, puis touche [Terminé].',
        ],
        related: ['partager-seance', 'records', 'historique'],
        actions: ['finish-session', 'summary-done'],
      },
    ],
  },
  {
    id: 'programmes', title: 'Programmes',
    topics: [
      {
        id: 'creer-programme', title: 'Créer un programme', icon: 'pencil', color: 'purple', ordered: true,
        lead: 'Un programme à toi peut avoir autant de séances que tu veux.',
        steps: [
          '[Programme] › [Créer un programme], puis donne-lui un nom.',
          'Pars d\'un [Programme vide] ou d\'une copie d\'un programme intégré.',
          '[Ajouter une séance] : nom, description et couleur.',
          '[Modifier l\'ordre] range les séances avec la poignée ≡, par exemple dans l\'ordre de ta semaine.',
          'En bas de l\'onglet : [Renommer le programme] ou [Supprimer le programme]. Un programme supprimé va dans [Supprimés récemment].',
        ],
        related: ['modifier-seance', 'choisir-programme', 'corbeille'],
        actions: ['new-programme', 'add-custom-session', 'toggle-prog-order', 'rename-programme', 'delete-programme'],
      },
      {
        id: 'modifier-seance', title: 'Modifier une séance', icon: 'list.bullet', color: 'purple',
        lead: 'Dans l\'onglet [Programme], touche une séance pour voir et changer ses exercices.',
        steps: [
          '[Ajouter un exercice] ouvre la recherche dans la bibliothèque.',
          '[Modifier] affiche la poignée ≡ pour changer l\'ordre, et le bouton − pour supprimer un exercice.',
          '[Récupération] : 24, 48, 72 ou 96 h avant que la séance soit de nouveau prête.',
          'Dans tes propres programmes, [Nom et couleur] et [Supprimer la séance] sont en bas de l\'écran.',
          'Depuis l\'accueil, [Modifier les exercices] ouvre directement la prochaine séance.',
        ],
        related: ['regler-exercice', 'recuperation'],
        actions: ['open-prog-session', 'go-editor', 'add-ex', 'toggle-edit-mode', 'set-cooldown', 'del-ex'],
      },
      {
        id: 'regler-exercice', title: 'Régler un exercice', icon: 'pencil', color: 'purple',
        lead: 'Dans une séance du programme, touche un exercice pour ouvrir sa fiche.',
        steps: [
          '[Séries] et [Repos] : le nombre de séries et un repos propre à cet exercice.',
          '[Mesure] : [Répétitions], [Durée] pour les maintiens comme le gainage, ou [Cardio] pour la distance et les minutes.',
          '[Tempo] : la vitesse de chaque répétition.',
          '[Progression] : un [Objectif] de charge et le [Haut de fourchette de reps].',
          'Renommer un exercice garde son historique. L\'app propose de renommer aussi tes anciennes séances.',
        ],
        related: ['tempo', 'augmenter-charge', 'duree'],
        actions: ['edit-ex', 'save-ex', 'cancel-ex', 'ex-sets', 'ex-rest', 'ex-measure'],
      },
      {
        id: 'bibliotheque', title: 'La bibliothèque d\'exercices', icon: 'dumbbell', color: 'teal',
        lead: '[Programme] › [Bibliothèque d\'exercices] liste tous les exercices connus de l\'app, rangés par zone du corps.',
        steps: [
          'Cherche par nom, muscle ou matériel, ou filtre par matériel.',
          'Chaque fiche montre [Comment faire], les [Muscles], le [Matériel] et la [Mesure].',
          'Pour un exercice au poids du corps, [Poids du corps soulevé] indique la part de ton poids que tu soulèves.',
          '[Plus facile] et [Plus dur] mènent aux variantes du mouvement.',
          '[Voir mes progrès] apparaît si tu as déjà fait l\'exercice.',
        ],
        related: ['comment-faire', 'ajouter-exercice'],
        actions: ['go-library', 'lib-equip', 'open-library-ex', 'open-stats-ex'],
      },
      {
        id: 'partager-programme', title: 'Envoyer un programme', icon: 'square.and.arrow.up', color: 'indigo',
        lead: '[Programme] › [Envoyer ce programme] l\'envoie par message.',
        steps: [
          'Le message liste les séances, les exercices, les séries, le tempo et le repos.',
          'Tes charges, tes records et ton historique restent sur ton téléphone.',
          'La personne lit le programme dans le message. Elle ne peut pas encore l\'importer d\'un toucher.',
          'Hors de l\'app iPhone, le texte est copié : colle-le dans un message.',
        ],
        related: ['creer-programme'],
        actions: ['share-programme'],
      },
    ],
  },
  {
    id: 'cardio', title: 'Cardio et poids du corps',
    topics: [
      {
        id: 'cardio', title: 'Course, vélo, rameur', icon: 'flame', color: 'red',
        lead: 'Le cardio se note en distance et en minutes.',
        steps: [
          'Ajoute-le comme un autre exercice : [Course à pied], [Vélo], [Rameur], [Escaliers], [Tapis de course], [Corde à sauter]…',
          'Chaque série a deux cases : [km] et [Durée] en minutes.',
          'Escaliers, tapis, vélo d\'appartement, elliptique et rameur : ▶ lance un chrono. Note le niveau ou la vitesse avec − et + à chaque changement, puis [Terminer] ouvre le [Bilan].',
          'L\'allure se calcule seule : min/km pour la course et la marche, km/h pour le vélo, temps aux 500 m pour le rameur. [Progrès] montre ta [Meilleure allure] et ta [Plus longue distance].',
          'Un exercice que tu as créé peut passer en cardio : fiche de l\'exercice › [Mesure] › [Cardio].',
        ],
        related: ['courses-sante', 'recuperation'],
        actions: ['stats-cardio-mode', 'ex-measure'],
      },
      {
        id: 'duree', title: 'Gainage et exercices en durée', icon: 'timer', color: 'teal', ordered: true,
        lead: 'Les maintiens (gainage, chaise, suspension) se notent en secondes. L\'app chronomètre pour toi.',
        steps: [
          'Touche ▶ à la place du numéro de la série en cours.',
          'Tu as 5 secondes pour te mettre en position, puis le chrono compte jusqu\'à ton temps de la dernière fois.',
          'Pour un exercice à faire des deux côtés, comme le gainage latéral : côté 1, 5 secondes pour changer, puis côté 2.',
          'À la fin, la série est validée et le repos démarre. [Terminer] arrête plus tôt et garde le temps tenu.',
          'Pour porter du poids, remplis la colonne « +kg ».',
        ],
        related: ['ecran-verrouille', 'regler-exercice'],
        actions: ['start-effort', 'stop-effort', 'cancel-effort'],
      },
      {
        id: 'lest', title: 'Poids du corps et lest', icon: 'dumbbell', color: 'orange',
        lead: 'Pour les tractions, les dips et les pompes, la colonne de charge devient « +kg » : le lest que tu ajoutes.',
        steps: [
          'Laisse-la vide si tu fais l\'exercice sans lest.',
          'Sur une machine d\'assistance, la colonne s\'appelle [Aide] : moins d\'aide, c\'est un progrès.',
          'Le volume compte la part de ton poids que tu soulèves : environ 95 % aux tractions et aux dips, 65 % aux pompes.',
          'Il faut pour cela ton poids : [Réglages] › [Poids du corps], ou Apple Santé dans l\'app iPhone.',
          'Un lest plus lourd que jamais affiche [Record lest].',
        ],
        related: ['poids-corps', 'records'],
        actions: ['set-body-weight'],
      },
      {
        id: 'tempo', title: 'Tempo', icon: 'timer', color: 'indigo',
        lead: 'Le tempo fixe la durée de chaque phase d\'une répétition. 3-1-1 veut dire 3 s pour descendre, 1 s en bas, 1 s pour remonter.',
        steps: [
          'Dans [Programme], touche la séance puis l\'exercice : rubrique [Tempo]. Pendant la séance : ··· › [Tempo].',
          'Choisis [Contrôlé], [Lent], [Très lent], [Explosif] ou un tempo [Personnalisé] (X : le plus vite possible).',
          '[Rappel seulement] affiche le tempo sous le nom de l\'exercice.',
          '[Guidé au son] : touche ▶ sur la série. Après la [Préparation], un son marque chaque phase et l\'écran dit quoi faire : « Descends », « Tiens », « Pousse ».',
          'Seules les répétitions complètes comptent. Plus lent, c\'est plus dur : baisse la charge.',
        ],
        related: ['regler-exercice', 'menu-exercice'],
        actions: ['ex-tempo', 'ex-tempo-guide', 'ex-tempo-prep', 'start-effort'],
      },
    ],
  },
  {
    id: 'progres', title: 'Suivre ses progrès',
    topics: [
      {
        id: 'records', title: 'Records', icon: 'flame', color: 'orange',
        lead: 'Un record s\'affiche sous la série dès que tu la valides.',
        steps: [
          '[Record charge] : plus lourd que jamais sur cet exercice.',
          '[Record reps] : plus de répétitions à ta charge record.',
          '[Record 1RM est.] : ta meilleure estimation de charge maximale sur une seule répétition.',
          'Le bilan de fin de séance les regroupe sous [Nouveaux records], avec une médaille.',
          'Dans [Progrès], chaque exercice garde son [Record].',
        ],
        related: ['progres', 'augmenter-charge'],
        actions: ['info-1rm'],
      },
      {
        id: 'augmenter-charge', title: 'Quand augmenter la charge', icon: 'chart', color: 'green',
        lead: 'L\'app te signale le bon moment pour monter la charge.',
        steps: [
          'Si toutes tes séries de la dernière fois ont atteint le haut de ta fourchette, une pastille « ↑ +2,5 kg » apparaît à côté du nom de l\'exercice.',
          'Touche-la : les séries qui restent prennent 2,5 kg de plus (5 lbs en livres).',
          'Le haut de fourchette se règle dans la fiche de l\'exercice : [Haut de fourchette de reps], 12 par défaut.',
          'Sur l\'accueil, [À battre aujourd\'hui] propose la même hausse, ou une répétition de plus.',
        ],
        related: ['regler-exercice', 'records'],
        actions: ['bump-weight'],
      },
      {
        id: 'progres', title: 'Progrès et courbes', icon: 'chart', color: 'green',
        lead: 'L\'onglet [Progrès] montre tes séances du mois et de l\'année, puis tous tes exercices.',
        steps: [
          'Chaque exercice affiche sa dernière performance, une mini-courbe et sa tendance en %.',
          'Touche-le pour la courbe complète : [Volume], [Charge max] ou [1RM est.].',
          'Pose le doigt sur la courbe pour lire une séance.',
          'Un [Objectif] de charge, réglé dans la fiche de l\'exercice, ajoute une barre de progression.',
          '[Vue d\'ensemble] affiche le calendrier du mois, tes séances par semaine et ton total de séances.',
        ],
        related: ['records', 'muscles'],
        actions: ['go-stats', 'open-stats-ex', 'stats-mode', 'go-stats-overview'],
      },
      {
        id: 'mesures', title: 'Mensurations et photos', icon: 'ruler', color: 'teal',
        lead: 'Dans [Progrès] › [Mesures], note tes tours de poitrine, de taille, de bras… et garde des photos de progression. Tout reste sur ton iPhone.',
        steps: [
          '[Ajouter des mesures] : la date, puis les mesures que tu as prises (laisse vide le reste). Une valeur par jour et par mesure, en cm ou en pouces selon ton unité.',
          'Touche une mesure pour sa courbe, l\'écart avec la mesure d\'avant et depuis la première.',
          '[Ajouter une photo] ouvre la caméra ou la pellicule ; choisis [Face], [Profil] ou [Dos]. La photo est réduite et gardée dans l\'app, pas dans ta pellicule.',
          '[Comparer] met deux dates côte à côte.',
          'Rien ne part sur ton compte, rien n\'est montré à tes amis ni à ton coach. L\'export contient tes mensurations, pas tes photos. [Supprimer toutes les données] efface les deux.',
        ],
        related: ['poids-corps', 'export'],
        actions: ['go-body-measures', 'bm-add', 'open-body-measure', 'photo-add'],
      },
      {
        id: 'muscles', title: 'Muscles travaillés', icon: 'chart', color: 'red',
        lead: 'La carte [Muscles] de l\'onglet [Progrès] colore la silhouette selon le nombre de séries reçues par chaque muscle.',
        steps: [
          'Choisis la période : [Cette semaine] (depuis lundi) ou [4 semaines] (les 28 derniers jours, en moyenne par semaine).',
          'La couleur suit les séries par semaine, 1 par série pour les muscles principaux et ½ pour les secondaires : entretien de 1 à 4, travaillé de 5 à 9, objectif atteint de 10 à 19, gros volume à partir de 20.',
          'Touche un muscle pour voir ses séries (Abdominaux = grand droit ; Obliques = flancs : rotations, gainage latéral). [Peu travaillés] liste les muscles en retard, [Séries par muscle] donne le détail.',
          'Les muscles d\'un exercice de la bibliothèque sont vérifiés. ··· › [Muscles ciblés] les modifie, ou choisit ceux d\'un exercice que tu as créé ; [Rétablir les muscles par défaut] revient aux muscles vérifiés.',
          'La silhouette se change dans [Réglages] › [Silhouette].',
        ],
        related: ['recuperation', 'progres'],
        actions: ['muscle-span', 'go-stats-muscles', 'declare-muscles', 'reset-muscles'],
      },
      {
        id: 'recuperation', title: 'Récupération', icon: 'clock.history', color: 'green',
        lead: 'Après une séance, tes muscles ont besoin de repos. L\'accueil en tient compte pour te proposer la suivante.',
        steps: [
          'Chaque séance a un délai de 24, 48, 72 ou 96 h, réglé dans la séance du programme : [Récupération].',
          'Un anneau à côté de la séance montre le temps qu\'il reste.',
          'Un muscle travaillé par une autre séance compte aussi : l\'accueil te dit lequel et quand.',
          'Après du cardio, ses muscles sont bloqués 24 h au plus.',
          'Pressé ? Touche la séance dans [Autres séances], puis [Passer le délai de récupération].',
        ],
        related: ['accueil', 'modifier-seance'],
        actions: ['set-cooldown', 'session-actions'],
      },
      {
        id: 'objectif', title: 'Objectif par semaine', icon: 'flame', color: 'orange',
        lead: 'La carte [Cette semaine] de l\'accueil remplit un anneau à chaque séance.',
        steps: [
          '[Réglages] › [Objectif] : [Auto] suit le nombre de séances de ton programme, ou choisis de 2 à 6 séances.',
          'Sous chaque jour, un point de la couleur de la séance montre quand tu t\'es entraîné.',
          'Dessous : ton nombre de séances du mois et de l\'année.',
        ],
        related: ['accueil', 'progres'],
        actions: ['setting-weekly-goal'],
      },
      {
        id: 'historique', title: 'Historique', icon: 'clock.history', color: 'blue',
        lead: 'L\'onglet [Historique] liste toutes tes séances, mois par mois.',
        steps: [
          'Le champ [Rechercher] trouve une séance par exercice ou par note.',
          'Les boutons du haut filtrent par séance. [Toutes] affiche tout.',
          'Touche une séance pour son détail : durée, volume, séries et notes.',
          '[Modifier] la corrige. Glisse-la vers la gauche, ou ouvre-la, pour la [Supprimer].',
          'Une séance supprimée reste 30 jours dans [Supprimés récemment].',
        ],
        related: ['seance-passee', 'corbeille', 'partager-seance'],
        actions: ['hist-filter', 'open-history', 'edit-session', 'delete-session', 'swipe-delete-session'],
      },
      {
        id: 'seance-passee', title: 'Ajouter une séance passée', icon: 'plus', color: 'blue', ordered: true,
        lead: 'Une séance faite sans l\'app s\'ajoute après coup.',
        steps: [
          '[Historique] › bouton + en haut à droite.',
          'Choisis la séance, ou [Autre…] pour un autre programme ou une [Séance libre], hors programme.',
          'Règle la [Date de la séance] et remplis les séries. [Reprendre la dernière séance] recopie la précédente.',
          '[Ajouter un exercice] si besoin, puis touche [Ajouter].',
          'Une séance libre compte dans tes progrès sans toucher à ton programme.',
        ],
        related: ['historique'],
        actions: ['go-add-session', 'add-other', 'add-copy-prev', 'add-past-ex', 'save-past-session'],
      },
      {
        id: 'partager-seance', title: 'Partager une séance', icon: 'square.and.arrow.up', color: 'purple',
        lead: '[Partager ma séance] crée une image au format story Instagram.',
        steps: [
          'Le bouton est dans le bilan de fin de séance et dans le détail d\'une séance de l\'[Historique].',
          'L\'image reprend la durée, le volume, les séries, tes records et les muscles travaillés.',
          'Touche [Partager] pour l\'envoyer ou l\'enregistrer.',
        ],
        related: ['terminer', 'historique'],
        actions: ['share-story', 'share-story-send'],
      },
      {
        id: 'corbeille', title: 'Supprimés récemment', icon: 'trash', color: 'red',
        lead: 'Une séance ou un programme supprimé n\'est pas perdu tout de suite.',
        steps: [
          'Ouvre [Réglages] › [Supprimés récemment].',
          'Une séance y reste 30 jours. Un programme y reste jusqu\'à ce que tu le restaures.',
          'Touche une séance : [Restaurer dans l\'historique] ou [Effacer définitivement].',
          'Touche un programme pour le [Restaurer].',
        ],
        related: ['historique', 'creer-programme'],
        actions: ['go-trash', 'trash-session', 'trash-programme', 'trash-empty'],
      },
    ],
  },
  {
    id: 'apple', title: 'Santé et musique',
    topics: [
      {
        id: 'sante', title: 'Apple Santé', icon: 'flame', color: 'red', iphone: true,
        lead: 'L\'app iPhone peut enregistrer tes séances dans Apple Santé et y lire ton poids. La connexion est coupée au départ.',
        steps: [
          'Active-la dans [Réglages] › [Services Apple] › [Apple Santé], puis autorise l\'accès.',
          'Chaque séance terminée devient un entraînement de musculation dans Santé, avec une estimation des calories.',
          '[Envoyer l\'historique dans Santé] y ajoute tes anciennes séances.',
          'L\'app lit aussi ton poids, tes courses et tes sorties vélo.',
          'Ces données restent sur ton iPhone. Elles ne vont ni sur ton compte ni dans la copie iCloud.',
        ],
        related: ['poids-corps', 'courses-sante'],
        actions: ['setting-health', 'health-backfill'],
      },
      {
        id: 'poids-corps', title: 'Poids du corps', icon: 'chart', color: 'teal',
        lead: 'Ton poids sert au volume des exercices au poids du corps et aux calories envoyées à Santé.',
        steps: [
          'Sans Santé : [Réglages] › [Poids du corps], puis tape ton poids. Chaque saisie est gardée, une par jour.',
          'L\'onglet [Progrès] affiche ton [Poids corporel] : la dernière pesée, la tendance sur 30 jours et la courbe. Sans Santé, touche la ligne pour ajouter une pesée.',
          'Avec Santé : l\'app prend ta dernière pesée. Pour la changer, pèse-toi dans l\'app Santé.',
          'Ton poids ne part jamais sur ton compte. Il reste sur ton téléphone, dans tes exports et, dans l\'app iPhone, dans ta copie iCloud.',
          'Si le bilan te propose d\'ajouter ton poids, touche la ligne pour le saisir.',
        ],
        related: ['lest', 'sante'],
        actions: ['set-body-weight', 'retry-body-weight'],
      },
      {
        id: 'courses-sante', title: 'Courses et vélo de Santé', icon: 'clock.history', color: 'green', iphone: true,
        lead: 'Avec Santé activé, tes courses et sorties vélo enregistrées par l\'Apple Watch ou une app comme Strava apparaissent dans l\'app.',
        steps: [
          'Elles s\'affichent dans l\'[Historique] à leur date, avec le filtre [Toutes].',
          'Elles ne se modifient pas ici : elles restent dans Santé.',
          'Une sortie de 20 minutes ou plus compte dans la récupération de tes muscles.',
          'Si les [Réglages] affichent [Courses et vélo de Santé] avec une flèche, touche la ligne pour autoriser leur lecture.',
        ],
        related: ['sante', 'cardio', 'recuperation'],
        actions: ['health-workouts-auth'],
      },
      {
        id: 'musique', title: 'Apple Music', icon: 'music', color: 'red', iphone: true,
        lead: 'Tu pilotes l\'app Musique d\'Apple sans quitter ta séance. La connexion est coupée au départ.',
        steps: [
          'Active [Réglages] › [Services Apple] › [Apple Music], puis autorise l\'accès.',
          'Lance un morceau dans l\'app Musique. Pendant la séance, une barre en haut l\'affiche.',
          'Elle propose morceau précédent, lecture ou pause, et morceau suivant.',
          'Spotify, Deezer et les autres apps ne peuvent pas être pilotées.',
        ],
        related: ['sante'],
        actions: ['setting-music', 'music-play', 'music-pause', 'music-next', 'music-previous'],
      },
    ],
  },
  {
    id: 'coach', title: 'Coach',
    topics: [
      {
        id: 'rejoindre-coach', title: 'Rejoindre un coach', icon: 'person.2', color: 'indigo', iphone: true, ordered: true,
        lead: 'Ton coach suit tes séances, t\'envoie des programmes et commente tes séances. Il faut un compte.',
        steps: [
          'Demande un code à ton coach. Il faut un compte et un pseudo : l\'app te le demande s\'il manque.',
          'En haut de l\'onglet [Amis], touche [Rejoindre un coach] (ou [Réglages] › [Coach]), puis saisis le code ou colle le message reçu.',
          'Tu vois qui est le coach et ce qu\'il verra : toutes tes séances et leurs notes, jamais ton poids ni Santé. Coche [J\'ai 15 ans ou plus], puis [Accepter].',
          '[Quitter mon coach] arrête tout, quand tu veux. Les programmes déjà ajoutés restent chez toi.',
        ],
        related: ['programme-coach', 'coacher'],
        actions: ['coach-open-settings', 'coach-join', 'coach-age', 'coach-accept', 'coach-leave'],
      },
      {
        id: 'programme-coach', title: 'Programme reçu d\'un coach', icon: 'list.bullet', color: 'indigo', iphone: true,
        lead: 'Un programme envoyé par ton coach arrive sur l\'accueil et dans [Mon coach].',
        steps: [
          'Touche [Ajouter à mes programmes] : il rejoint tes programmes, tu peux l\'utiliser tout de suite.',
          'Ses consignes s\'affichent dans la séance du programme et pendant la séance, sous le nom de l\'exercice. Un toucher les replie.',
          'Quand ton coach le modifie, touche [Mettre à jour]. Si tu l\'as changé toi aussi, l\'app te demande avant de remplacer ta version.',
          'Ses commentaires sont dans [Mon coach] et dans [Historique], sous la séance. Une carte de l\'accueil te prévient.',
        ],
        related: ['rejoindre-coach', 'modifier-seance'],
        actions: ['coach-add-prog', 'coach-tip'],
      },
      {
        id: 'coacher', title: 'Suivre des élèves', icon: 'person.2', color: 'purple', iphone: true,
        lead: 'Avec un compte coach, la cellule [Mes élèves] est en haut de l\'onglet [Amis].',
        steps: [
          '[Inviter un élève] crée un code valable 7 jours et ouvre le partage. Tes élèves ne se voient pas entre eux.',
          'Touche un élève pour voir ses séances. Une pastille rouge compte ses nouvelles séances.',
          'Dans une séance, [Commenter] laisse un mot que l\'élève lit dans son historique.',
          '[Envoyer un programme] : choisis un de tes programmes, ajoute des consignes, puis envoie.',
          '[Retirer l\'élève] arrête le suivi.',
        ],
        related: ['rejoindre-coach', 'programme-coach'],
        actions: ['coach-invite', 'coach-comment', 'coach-send', 'coach-remove'],
      },
    ],
  },
  {
    id: 'compte', title: 'Compte et sauvegarde',
    topics: [
      {
        id: 'compte', title: 'Compte', icon: 'gear', color: 'blue', iphone: true,
        lead: 'Le compte est facultatif. Il sauvegarde tes séances et tes programmes en ligne.',
        steps: [
          'En haut des [Réglages], touche [Se connecter] : [Continuer avec Apple], Google ou un code reçu par e-mail.',
          'La sauvegarde se fait après chaque séance. [Sauvegarder maintenant] la lance tout de suite.',
          'Sur un autre iPhone, connecte-toi de la même façon pour tout retrouver.',
          'Ton poids et tes données Santé restent sur l\'iPhone.',
          '[Se déconnecter] garde tes données sur l\'iPhone. [Supprimer mon compte] efface le compte.',
        ],
        related: ['icloud', 'export'],
        actions: ['go-account', 'account-sync', 'account-sign-out', 'account-delete'],
      },
      {
        id: 'icloud', title: 'Copie iCloud', icon: 'arrow.clockwise', color: 'teal', iphone: true,
        lead: 'Dans l\'app iPhone, tes données sont copiées dans ton iCloud, sans rien à régler.',
        steps: [
          'Si tu réinstalles l\'app ou changes d\'iPhone avec le même compte iCloud, tout revient au lancement.',
          'Le fichier de l\'app fait aussi partie de la sauvegarde iCloud de ton iPhone.',
          'La copie est dans ton iCloud : personne d\'autre n\'y a accès.',
          '[Supprimer toutes les données] vide aussi cette copie.',
        ],
        related: ['compte', 'export'],
        actions: ['wipe-data'],
      },
      {
        id: 'export', title: 'Exporter et importer', icon: 'square.and.arrow.up', color: 'indigo',
        lead: 'Un export est un fichier avec toutes tes données, à garder où tu veux.',
        steps: [
          '[Réglages] › [Sauvegarde] › [Exporter les données]. Le fichier contient tes mensurations, pas tes photos de progression.',
          'Sans compte, la ligne [Dernière sauvegarde] passe en orange après 14 jours sans export.',
          '[Importer une sauvegarde] remplace les données de l\'app par celles du fichier (avec un compte, ses séances s\'ajoutent aux tiennes) ; [Annuler] reste disponible quelques secondes.',
          'Tu viens de Hevy ou Strong ? [Importer depuis une autre app] ajoute les séances de leur fichier CSV d\'export, après un aperçu.',
          '[Supprimer toutes les données] efface tout sur cet appareil, photos comprises.',
        ],
        related: ['icloud', 'compte', 'corbeille'],
        actions: ['export', 'import', 'wipe-data'],
      },
    ],
  },
];

// Tous les sujets, dans l'ordre de l'écran, chacun avec sa section
const GUIDE_TOPICS = GUIDE_SECTIONS.flatMap(s => s.topics.map(t => ({ ...t, section: s.id })));

function guideTopic(id) { return GUIDE_TOPICS.find(t => t.id === id) || null; }

// Texte brut d'un sujet (libellés sans crochets) : recherche et VoiceOver
function guidePlain(str) { return String(str ?? '').replace(/\[([^\]]+)\]/g, '$1'); }

// Libellés de l'app cités par un sujet : « [Réglages] › [Repos par défaut] » → ['Réglages', 'Repos par défaut']
function guideLabels(topic) {
  return [topic.lead, ...(topic.steps || [])].flatMap(s => [...String(s).matchAll(/\[([^\]]+)\]/g)].map(m => m[1]));
}

// Recherche : chaque mot tapé (sans accents ni majuscules) doit apparaître dans le titre ou le texte
function guideSearch(query) {
  const words = normName(query).split(' ').filter(Boolean);
  if (!words.length) return GUIDE_TOPICS;
  return GUIDE_TOPICS.filter(t => {
    const hay = normName([t.title, t.lead, ...(t.steps || [])].map(guidePlain).join(' '));
    return words.every(w => hay.includes(w));
  });
}
