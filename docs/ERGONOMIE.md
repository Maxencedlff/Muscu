# Règles de simplicité de MDLF Training

L'app va avoir beaucoup de fonctions. Pratiquants et coachs doivent pouvoir s'en servir sans réfléchir :
c'est la priorité. Toute nouvelle fonction, et tout agent qui touche à l'interface, suit ces règles.
En cas de doute, on fait plus simple.

## 1. Une icône = un sens, un mot = un sens

Une même icône ou un même mot mène toujours à la même chose, partout.

| Icône | Sens unique | Où |
|---|---|---|
| Roue (`gear`) | Réglages (le compte est en tête des Réglages) | En haut à droite d'Entraînement et de Programme, même bouton, même place (`settingsButtonHtml`, js/features/settings.js) |
| Avatar seul | Mon profil | En haut à droite de Social seulement, segment Social compris pour un coach (`meButtonHtml`) |
| Personnes (`person.2`) | Social : les amis, leurs séances | 5e onglet (« Social ») |
| Planchette (`coach`) | Coach : le suivi d'élèves | 5e onglet d'un compte coach (« Coach », docs/SOCIAL_V2.md), « Rejoindre un coach » |
| `+` | Ajouter l'objet de l'écran (série, exercice, séance, mesure, photo) | Jamais pour autre chose |
| `⋯` | Menu des actions de l'objet à côté | Exercice en séance, conversation |
| Chevron vers le bas (`chevron.down`) | Replier ou déplier : réduire la séance en cours (en haut à gauche), montrer la suite d'une carte (« Voir les exercices ») | Jamais pour déplacer quelque chose (« Plus tard » a sa flèche) |
| Flèche qui tourne vers la droite (`arrow.turn.down.right`) | Plus tard : repousser l'exercice en cours en fin de séance (la flèche vers une ligne se lisait « Télécharger », panel Apple de la vague 3) | Séance seulement |
| Deux feuilles (`doc.on.doc`) | Dupliquer (faire une copie à modifier) | « Dupliquer le plan » ; jamais `+`, réservé à l'ajout |
| `ⓘ` | Comment faire (explication) | Après un nom d'exercice |
| Disque (`plate`) | Disques à charger sur la barre : petit, à côté du numéro de la série à faire d'un exercice à barre (jamais à sa place) | Jamais l'haltère, réservée à l'onglet Entraînement |
| Cadenas (`lock`) | État : c'est chiffré (coffre à photos, photos de bilan) | Jamais une action : « Verrouiller », « Refermer » s'écrivent en toutes lettres ; jamais devant un lien ou un bouton d'envoi |
| Chevron `›` | Ouvre l'écran détaillé de la ligne | Fin de ligne |
| `✕` | Fermer, écarter ou retirer d'une liste en cours (carte, feuille, suggestion, technique d'une série) | Jamais pour effacer une séance ou une donnée enregistrée (« Supprimer », en rouge) |
| Partager (carré et flèche, `square.and.arrow.up`) | Ouvrir la feuille de partage d'iOS : envoyer vers une autre app (programme par message, séance, récap, code coach, invitation) | Jamais pour un envoi privé dans l'app |
| Avion en papier (`paperplane`) | Envoi privé dans l'app, chiffré : à son coach (photos de bilan) ou à un élève (programme, plan diète) | Fiche d'un élève : « Envoyer un programme » et « Envoyer un plan diète » ont la même icône |
| Code-barres dans un cadre (`barcode`) | Trouver un produit par son code-barres : « Scanner un code-barres » (caméra) ou « Saisir un code-barres » (sans caméra) | Feuille « Ajouter un aliment » seulement |
| `−` et `+` | Une unité de moins ou de plus (feuille de quantité d'un aliment : « 2 œufs ») ; `+` seul reste l'ajout | Toujours par paire, autour du champ |
| Coche | Choisir ou valider (série, programme actif, « Utiliser ce plan ») | |
| Bulle à lignes (`text.bubble`) | Messages privés avec son coach ou un élève, et leur nombre de non-lus | Jamais pour un commentaire |
| Bulle vide (`bubble.left`) | Commentaire sur une séance : « Commenter » (Social), « Commentée par ton coach » | Jamais pour les messages privés |
| Silhouette dans un cercle (`person.crop.circle`) | Pas encore de compte : « Se connecter » (Réglages, Compte) | Jamais l'haltère, réservée à l'onglet Entraînement |

Exception admise : l'avatar *dans une ligne qui porte son libellé* (ligne « Compte et sauvegarde » des
Réglages, auteur d'un commentaire) illustre la ligne ; c'est le texte qui dit où elle mène.

## 2. Deux touchers pour l'action principale

L'action principale de chaque écran se fait en deux touchers au plus depuis l'écran qui y mène :

| Action | Chemin |
|---|---|
| Lancer la prochaine séance | Entraînement › Démarrer |
| Valider une série | toucher ✓ (la case vide prend la valeur grise) |
| Ajouter un exercice déjà fait | Ajouter un exercice › toucher l'exercice dans « Récents » |
| Finir la séance | Terminer › Enregistrer la séance |
| Voir ses records | onglet Progrès (carte « Derniers records » en tête) |
| Coach : voir qui a progressé | onglet Coach (résumé « Cette semaine » et élèves triés, un toucher) |
| Coach : ouvrir la fiche d'un élève | onglet Coach › l'élève |
| Élève : ouvrir Mon coach | onglet Social › Mon coach |

Quantité d'un aliment : à l'unité quand elle existe (« 2 œufs », « 1 pot »), en un toucher sur `+` ; le
contrôle « Grammes | Œuf » reste à côté, et l'équivalent en grammes est toujours affiché (« 2 œufs · 100 g »).
La feuille s'ouvre sans clavier ; une feuille ouverte avec le clavier se pose au-dessus de lui.

Ce qu'on fait souvent est en haut et visible sans défiler ; le reste est trouvable par la recherche.
Rien ne se déclenche au `pointerdown` : un toucher = un `click`.

## 3. Vocabulaire unique

Toujours le même mot pour la même chose, en français courant, au tutoiement, sans tiret dans les phrases.

| Mot retenu | Pour | Jamais |
|---|---|---|
| Séance | un entraînement (fait ou au programme) | workout, session |
| Série, reps | une série, ses répétitions | set |
| Reps en réserve | RIR (« RIR » seulement si la place manque, avec un `aria-label` en toutes lettres) | RIR seul en libellé |
| Objectif | la série à battre aujourd'hui, toujours avec ses reps (« 35 kg × 8 ») ; même calcul sur l'accueil et en séance (`exerciseGoal`, js/data/goals.js) | cible, target |
| Record | une performance jamais faite, notée dans la séance ; comptée partout de la même façon (`recordCount`, js/data/records.js) | PR |
| Fourchette ; reps fixes | la prescription des reps d'un exercice : « Fourchette » (de 8 à 12, la charge monte au haut puis on repart du bas) ou « Fixe » (« 4 × 12 », espaces insécables, lu « 4 séries de 12 reps » par VoiceOver : `setsRepsHtml`, js/data/goals.js ; la charge monte quand toutes les séries atteignent le nombre, qui ne change pas) | reps cibles, plage |
| Volume | charge × reps (« +33 kg de volume », jamais « +33 kg » seul) | tonnage |
| Échauffement | séries légères hors volume et hors records | |
| Réglages | l'écran des réglages | Paramètres |
| Social | l'onglet des amis et de leurs séances ; le segment du même contenu dans l'onglet Coach | Amis (comme nom d'onglet ou de section) |
| Coach | l'onglet d'un compte coach (segments Élèves et Social) ; Réglages › Coach | |
| Mon profil | sa page côté Social | |
| Suivre ; ceux qui te suivent, les personnes que tu suis | la relation dans Social : « Séances des personnes que tu suis », « Masquée à ceux qui te suivent », Suivre, Ne plus suivre, et les deux listes de Mon profil (Te suivent, Suivis) | amis pour cette relation ; s'abonner, abonnés, abonnements (réservés à l'abonnement payant) |
| Utiliser ce plan ; plan en cours | prendre un plan diète (le sien ou celui du coach) : « Utiliser ce plan », « Plan en cours : … » | Suivre, suivi (réservés à Social) |
| Mes aliments | les aliments créés ou scannés par la personne (Réglages de la nutrition › Mes aliments, 200 au plus ; plein : on prévient, jamais le plus ancien retiré en silence) | aliments perso (en libellé) |
| P, G, L | protéines, glucides, lipides abrégés dans les lignes des listes (« P 7 · G 77 · L 1 »), toujours avec la légende « P protéines · G glucides · L lipides » une fois par écran ou par feuille (`dietMacroLegendHtml`) ; en toutes lettres dans la feuille de quantité et pour VoiceOver | une lettre sans légende à l'écran |
| cru, cuit | étiquette d'un résultat de recherche quand le nom Ciqual le dit (`foodCookTag`) ; « Pesé cuit ? Choisis la version cuite. » dans la feuille de quantité quand l'autre version existe | |
| Coaching | la relation entre un élève et son coach : « si le coaching s'arrête », « Quitter mon coach », « Retirer l'élève » | suivi, suivre ; jamais « il » ou « lui » pour le coach (« Ton coach », son pseudo) |
| Ami | une personne de ta vie qu'on invite (« Inviter un ami », « Entraîne-toi avec tes amis ») | jamais pour dire qui voit tes séances |
| Supprimer la séance | retirer une séance d'un programme | |
| Supprimer de l'historique | effacer une séance faite (corbeille 30 jours) | |
| Terminer | finir la séance en cours | pour arrêter un chrono : « Arrêter » |
| Terminé | fermer le bilan | |

Un nouveau mot ou un mot qui change : mettre à jour ce lexique, le guide (js/data/guide.js) et les tests
qui citent le libellé (le test du guide échoue si un libellé cité n'existe plus).

## 4. Tailles

- Carte d'un résumé sur l'accueil (Nutrition) : 4 lignes de liste au plus, « et 2 autres » au-delà ; une seule
  action par ligne (le bouton à cocher, sur le prochain repas seulement), le reste de la carte ouvre l'écran.

- Toute zone touchable fait au moins 44 × 44 px (pastilles, puces de filtre, ±, champs de recherche).
- Texte à 12 px au moins (0,706 rem), sauf la barre d'onglets (10 px, comme iOS).
- Une famille de filtres = une ligne qui défile de côté (`.mf__row`, `.ax__equip`), jamais un pavé de puces.
- Un texte trop long se coupe avec des points de suspension sur la partie la moins utile (le nom), jamais
  au milieu d'un nombre.
- Toast (vague 3) : en séance, jamais pour annuler. Ce qui s'annule en séance l'est EN LIGNE, à sa place, 6 s, puis disparaît :
  « Annuler » dans la colonne « Avant » de la série validée, ou une ligne « Mis en dernier · Annuler »
  juste au-dessus de la carte de l'exercice (Plus tard, Faire maintenant, remplacé, échauffement, mini-série, technique posée) ou à la place
  d'une carte retirée ; VoiceOver annonce l'état (sessionUndo, js/features/session.js). Rien ne recouvre jamais rien.
  En séance, un simple message prend la même ligne (au-dessus de la carte concernée, 3 s). Hors séance : UNE seule place, en bas, au-dessus de la barre d'onglets, de la
  mini-barre ou du repos, fond opaque ; la page garde sous son contenu la hauteur du toast le temps qu'il est là ; il
  disparaît au changement d'écran. 60 signes au plus (40 à côté d'un bouton), sur deux lignes plutôt que coupé ; son
  bouton dit ce qu'il défait ; avec un bouton, 6 s au moins, retenu sous le doigt ou le focus de VoiceOver (js/core/dialogs.js).
- Sombre : noir pur ; vérifier chaque écran en clair et en sombre, iPhone 13 et iPhone SE.

## 5. Ce qui va dans un menu avancé

Menu `⋯` d'un exercice : lisible sans défiler sur iPhone SE. D'abord Remplacer, Choisir la prise, Comment faire ; puis
Plus tard (ou Faire maintenant) et le superset ; le reste dans « Plus d'options… » ; « Retirer l'exercice » à part.

À l'écran : ce qui sert à chaque séance (valider, charge, reps, repos, objectif). Dans le menu `⋯` ou les
Réglages : ce qui sert rarement ou aux confirmés (tempo, échauffement auto, disques, superset, reps en
réserve, fourchette de reps, muscles ciblés). Une option avancée est coupée par défaut pour un nouvel
utilisateur quand elle ajoute un geste à chaque série, sans jamais changer le réglage de quelqu'un qui
l'utilise déjà. Un réglage propre à l'appareil se retrouve vide après une réinstallation ou sur un nouvel
iPhone : il se déduit alors des données (reps en réserve : `rirOn: 'auto'`, montré si l'historique en a).

## 6. Vérifier

Avant de dire « fini » : captures avant et après (clair et sombre, iPhone 13 et SE), `verif_ui --ux`, et
les tests qui comptent les touchers (tests/test_ergo.py).
