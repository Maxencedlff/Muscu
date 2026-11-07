# Règles de simplicité de MDLF Training

L'app va avoir beaucoup de fonctions. Pratiquants et coachs doivent pouvoir s'en servir sans réfléchir :
c'est la priorité. Toute nouvelle fonction, et tout agent qui touche à l'interface, suit ces règles.
En cas de doute, on fait plus simple.

## 1. Une icône = un sens, un mot = un sens

Une même icône ou un même mot mène toujours à la même chose, partout.

| Icône | Sens unique | Où |
|---|---|---|
| Roue (`gear`) | Réglages (le compte est en tête des Réglages) | En haut à droite d'Entraînement et de Programme, même bouton, même place (`settingsButtonHtml`, js/features/settings.js) |
| Avatar seul | Mon profil | En haut à droite d'Amis seulement (`meButtonHtml`) |
| `+` | Ajouter l'objet de l'écran (série, exercice, séance, mesure, photo) | Jamais pour autre chose |
| `⋯` | Menu des actions de l'objet à côté | Exercice en séance, conversation |
| Chevron vers le bas (`chevron.down`) | Replier ou déplier : réduire la séance en cours (en haut à gauche), montrer la suite d'une carte (« Voir les exercices ») | Jamais pour déplacer quelque chose (« Plus tard » a sa flèche) |
| Flèche vers une ligne (`arrow.down.to.line`) | Plus tard : repousser l'exercice en cours en fin de séance | Séance seulement |
| Deux feuilles (`doc.on.doc`) | Dupliquer (faire une copie à modifier) | « Dupliquer le plan » ; jamais `+`, réservé à l'ajout |
| `ⓘ` | Comment faire (explication) | Après un nom d'exercice |
| Chevron `›` | Ouvre l'écran détaillé de la ligne | Fin de ligne |
| `✕` | Fermer, écarter ou retirer d'une liste en cours (carte, feuille, suggestion, technique d'une série) | Jamais pour effacer une séance ou une donnée enregistrée (« Supprimer », en rouge) |
| Partager (carré et flèche) | Envoyer à quelqu'un : une autre app (programme, récap, code coach) ou un élève (programme, plan diète) | Fiche d'un élève : « Envoyer un programme » et « Envoyer un plan diète » ont la même icône |
| Coche | Choisir ou valider (série, programme actif, « Suivre ce plan ») | |

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
| Volume | charge × reps (« +33 kg de volume », jamais « +33 kg » seul) | tonnage |
| Échauffement | séries légères hors volume et hors records | |
| Réglages | l'écran des réglages | Paramètres |
| Mon profil | sa page côté Amis | |
| Supprimer la séance | retirer une séance d'un programme | |
| Supprimer de l'historique | effacer une séance faite (corbeille 30 jours) | |
| Terminer | finir la séance en cours | pour arrêter un chrono : « Arrêter » |
| Terminé | fermer le bilan | |

Un nouveau mot ou un mot qui change : mettre à jour ce lexique, le guide (js/data/guide.js) et les tests
qui citent le libellé (le test du guide échoue si un libellé cité n'existe plus).

## 4. Tailles

- Toute zone touchable fait au moins 44 × 44 px (pastilles, puces de filtre, ±, champs de recherche).
- Texte à 12 px au moins (0,706 rem), sauf la barre d'onglets (10 px, comme iOS).
- Une famille de filtres = une ligne qui défile de côté (`.mf__row`, `.ax__equip`), jamais un pavé de puces.
- Un texte trop long se coupe avec des points de suspension sur la partie la moins utile (le nom), jamais
  au milieu d'un nombre.
- Toast : 60 signes au plus (40 à côté d'un bouton), sur deux lignes plutôt que coupé ; son bouton dit ce qu'il
  défait (« Annuler la série » quand le texte parle aussi de la suite). Il ne cache jamais la série en cours ni
  « + Série » / « Plus tard » de sa carte (il passe alors en haut), et un toast avec « Annuler » reste 6 s au moins,
  retenu sous le doigt ou le focus de VoiceOver (js/core/dialogs.js).
- Sombre : noir pur ; vérifier chaque écran en clair et en sombre, iPhone 13 et iPhone SE.

## 5. Ce qui va dans un menu avancé

À l'écran : ce qui sert à chaque séance (valider, charge, reps, repos, objectif). Dans le menu `⋯` ou les
Réglages : ce qui sert rarement ou aux confirmés (tempo, échauffement auto, disques, superset, reps en
réserve, fourchette de reps, muscles ciblés). Une option avancée est coupée par défaut pour un nouvel
utilisateur quand elle ajoute un geste à chaque série, sans jamais changer le réglage de quelqu'un qui
l'utilise déjà. Un réglage propre à l'appareil se retrouve vide après une réinstallation ou sur un nouvel
iPhone : il se déduit alors des données (reps en réserve : `rirOn: 'auto'`, montré si l'historique en a).

## 6. Vérifier

Avant de dire « fini » : captures avant et après (clair et sombre, iPhone 13 et SE), `verif_ui --ux`, et
les tests qui comptent les touchers (tests/test_ergo.py).
