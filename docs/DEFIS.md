# Défis : « 100 pompes par jour », noté d'un toucher

Demande de Maxence du 24/11/2026 : « un truc défi, qu'on pourrait voir à la fin de la première page. Genre si je veux
faire 100 pompes par jour, 20 tractions par jour. » Branche `defis`, rien en production.

Code : `js/data/defis.js` (logique pure), `js/features/defis-ui.js` (écrans), `css/defis.css`. Tests :
`tests/unit/defis.mjs`, `tests/test_defis.py` (lot `defis`), parcours `defis` de `tests/panel/parcours.py`.

## Ce que voit la personne

- **Accueil, tout en bas** (sous la semaine, donc sous « Ensuite ») : la section « Défis ».
  - Sans défi : une seule ligne « Lancer un défi », « Par exemple 100 pompes par jour ». Pas de carte vide.
  - Avec des défis : une carte par défi, avec l'anneau du jour, « 63 / 100 reps », « Fait » une fois l'objectif
    atteint, les boutons de pas, puis la série (« 5 jours de suite »). « Nouveau défi » à droite du titre, tant qu'il
    reste de la place (4 défis en cours au plus). « Défis terminés » en dernière ligne s'il y en a.
  - En pause : « En pause », sans boutons.
- **Créer** : la feuille de la bibliothèque (recherche, filtres, « Créer » pour un exercice inventé), avec les
  suggestions en tête (pompes, tractions, squat au poids du corps, gainage, dips, burpees ; un exercice déjà en défi
  n'est pas proposé). Ensuite, la feuille « Nouveau défi » : l'objectif par jour (proposé : 100 pompes, 20 tractions,
  120 s de gainage, sinon 50 reps ou 60 s), la durée (30 jours, 60 jours, sans fin) et le rappel. Un exercice mesuré en
  temps (`measureOf`) donne un objectif en secondes.
- **Noter** : un toucher sur « +10 » ajoute tout de suite (rien au pointerdown, un seul tap iOS), avec un retour
  haptique (succès quand l'objectif est atteint). La ligne de la série devient « +10 noté » avec « Annuler » au même
  endroit et à la même hauteur : les boutons ne bougent pas et aucun toast ne les cache (règle 9 de la grille).
  « Annuler » ignore les touchers pendant 700 ms après son apparition (`DEFI_GUARD_MS`, comme les reps en réserve) :
  un double toucher sur « +10 » n'annule pas le premier. Il reste 8 s.
  - Les pas dépendent de l'objectif (`defiSteps`) : jusqu'à 10 → +1 +2 ; jusqu'à 30 → +1 +5 ; jusqu'à 60 → +5 +10 ;
    jusqu'à 150 → +5 +10 +20 ; jusqu'à 400 → +10 +25 +50 ; au-delà +25 +50 +100. En temps : +10 s +30 s, +15 s +30 s
    +1 min, ou +30 s +1 min +2 min. « Autre » ouvre le pavé numérique (« 1:30 » accepté pour un temps).
  - On note autant de fois qu'on veut dans la journée (40 ajouts par jour au plus).
- **Fiche** (toucher la carte) : grand titre au nom de l'exercice, objectif, durée et rappel ; anneau du jour et les
  mêmes boutons ; « Chiffres » (série, jours tenus sur jours écoulés, record d'un jour, total) ; la phrase « Les défis
  ne comptent pas dans Progrès » ; le calendrier du mois (rond vert plein : tenu ; gris plein : manqué ; pointillé :
  en pause ; anneau : aujourd'hui ; légende dessous ; mois précédents avec les flèches) ; le bonhomme avec le muscle
  travaillé en rouge (l'image de tête de la fiche de la bibliothèque, `libExHeroHtml`) ; « Jour par jour » (30 derniers
  jours notés) ; puis Modifier, Mettre en pause ou Reprendre, Arrêter le défi.
- **Corriger un jour** : toucher un jour du calendrier ou de la liste, taper le total. Annuler dans le toast. 0 vide
  le jour.
- **Arrêter** : confirmation, puis le défi passe dans « Défis terminés » avec ses chiffres (Annuler dans le toast).
  Depuis sa fiche : Relancer, ou Supprimer (confirmation et Annuler). Un défi de 30 ou 60 jours se termine de lui-même
  le lendemain de son dernier jour (`defiCloseFinished`).
- Pas de flamme, pas d'emoji, pas de confettis : « 12 jours de suite » et « Fait ».

## Règles de calcul

- **Le jour est le jour local** (`localISO`, lu au moment du toucher). 23 h 59 compte pour aujourd'hui, 0 h 01 pour
  demain. L'accueil resté ouvert après minuit se redessine à la minute suivante (`startTicker`, js/features/dashboard.js,
  `data-day` de la section). Les jours s'additionnent sur le calendrier (`defiAddDays`, midi local) : rien ne saute aux
  changements d'heure.
- **Objectif daté** : `goals: [{ from, n }]`. Changer l'objectif vaut à partir d'aujourd'hui ; un jour passé garde le
  sien (`defiGoalOn`).
- **Jour tenu** : total du jour ≥ objectif du jour. **Manqué** : jour passé sous l'objectif. **Aujourd'hui** pas encore
  tenu ne casse pas la série. **Pause** : jours neutres, ni tenus ni manqués, la série continue et la fin du défi recule
  d'autant.
- **Série** (`defiStreak`) : jours tenus d'affilée jusqu'à aujourd'hui.

## Progrès : les défis ne comptent pas (décision)

Les reps des défis ne comptent **ni dans les séries par muscle, ni dans le volume, ni dans les records**. Raison :
100 pompes par jour, c'est 700 reps de pectoraux par semaine notées sans séries ni charge ; ajoutées aux séances, elles
feraient passer les pectoraux de « dans l'objectif » à « au-delà » et fausseraient tout le reste (volume, régularité,
niveau de force). Maxence est d'accord (24/11). La fiche le dit, et elle a ses propres chiffres. Les défis restent hors
de `data.history` : rien dans Progrès ne les lit.

## Récaps (semaine, mois, année)

Demande de Maxence du 24/11 : « dans le récap si c'est bien, avec une option si les gens ne veulent pas ».

- Un écran « Défi(s) ce mois-ci », après les autres et avant le résumé : le défi le plus tenu en grand (« Pompes,
  1 380 reps, 13 jours tenus sur 15 »), les autres en liste, et « En plus des séances : ne compte pas dans le volume ni
  les séries ». Le résumé ajoute une ligne « Défi Pompes » seulement s'il lui reste une place (les séances d'abord).
- **Seulement si c'est bien** : seuls les défis qui ont au moins un jour tenu sur la période (`recapDefis`). Aucun
  défi sur la période : pas d'écran, jamais de bloc vide. Les jours en pause ne comptent pas.
- **Le réglage** : Réglages › Apparence › « Défis dans les récaps », allumé par défaut, montré seulement à qui a (eu)
  un défi. Coupé : ni l'écran, ni la ligne du résumé, donc ni l'image partagée (elle est dessinée depuis les mêmes
  écrans). Choisi plutôt qu'un interrupteur dans le récap : c'est le voisin de « Carte « Ta semaine » », le réglage
  d'affichage des récaps qui existe déjà ; le récap reste un écran à regarder et à partager, sans réglage dedans, et un
  seul réglage vaut pour la semaine, le mois et l'année. `defisRecapOff: true` quand il est coupé, synchronisé avec le
  profil (son absence est un choix : `SYNC_ABSENT_IS_CHOICE`).

## Rappel (notification locale)

- Facultatif, à une heure choisie. L'interrupteur demande l'autorisation d'iOS au moment où on l'allume
  (`Native.requestNotificationPermission`) ; refusée : « Notifications refusées : autorise-les dans Réglages › MDLF
  Training › Notifications. », et le rappel reste éteint.
- `defiReminderPlan` prévoit les 14 prochains jours (un rappel par défi et par jour), **sauf aujourd'hui si c'est déjà
  fait**, sans les jours en pause ni après la fin. Replanifié à chaque ajout, annulation, correction ou réglage
  (`Native.scheduleDefiReminders`, identifiants 7100 à 7199, 64 au plus) ; rien n'est demandé à iOS à ce moment-là.
  Texte factuel : « Pompes » / « Défi du jour : 100 reps ».
- Rien dans la PWA (pas de notification locale).

## Données

```js
defis: {
  'k3j9x0q1': {
    id: 'k3j9x0q1', name: 'Pompes', measure: 'reps' | 'time',
    goals: [{ from: '2026-11-01', n: 100 }],      // objectif par jour, daté
    start: '2026-11-01', length: 30 | 60 | 0,     // 0 : sans fin
    remind: '18:00' | null,
    pauses: [{ from: '2026-11-10', to?: '2026-11-12' }],
    endedAt?: 1793...,                             // arrêté (Défis terminés)
    at: 1793...,                                   // dernière modification des réglages
    log: { '2026-11-01': [{ id: 'a1b2c3d4', n: 30, at: 1793... }] },   // ajouts, 40 par jour, 800 jours
    gone: ['a1b2c3d4'],                            // ajouts retirés (300 derniers)
  },
  'old00001': { id: 'old00001', deleted: true, at: 1793... },          // supprimé : la trace seule
},
defisRecapOff: true,                               // « Défis dans les récaps » coupé (absent : allumé)
```

- **Stockage et synchro** : dans `ppl_v2` comme le reste, et sur le compte dans le **profil** (`profiles.doc`,
  `SYNC_PROFILE_KEYS`). Le serveur ne lit pas ce document (jsonb, garde de taille 900 Ko côté app) : **aucune
  migration**, rien à appliquer. Taille : environ 35 octets par ajout, 3 ajouts par jour et 4 défis, soit environ
  150 Ko par an au pire ; le journal garde 800 jours.
- **Fusion des conflits** (`mergeDefis`, appelée dans toutes les branches de `applyRemoteProfile`, comme la nutrition) :
  - réglages du défi : la version la plus récente (`at`) gagne ;
  - ajouts : réunis par identifiant, moins ceux retirés d'un côté ou de l'autre (`gone`, réunis aussi). 30 pompes
    notées hors ligne sur l'iPhone et 40 sur l'iPad donnent 70 ; un ajout annulé ne revient jamais ;
  - suppression : une trace `deleted` (plus récente qu'une modification ailleurs, elle gagne) ;
  - commutative (testé) : l'ordre des appareils ne change rien.
- **Sans compte, hors ligne** : tout marche sur l'appareil ; la synchro rattrape au retour.
- **Copie iCloud et fichier de l'app** : compris (ce n'est pas une donnée de santé saisie, comme les séances).
- **Export** : JSON complet (Réglages › Sauvegarde) ; CSV des séances : une ligne par jour noté, après les séances,
  « Défi » dans la colonne Séance, le total dans Reps, « Objectif 100 » dans Note.
- **Suppression du compte** : le profil part avec le compte (fonction `delete-account`) ; rien à ajouter.
- **Montre (plus tard)** : toute l'écriture passe par `defiAdd`, `defiUndo`, `defiToday`, sans écran. Un message de la
  montre (js/features/watch.js) n'aura qu'à appeler `defiAdd(data, id, n)` puis `save()`, et la liste des défis du
  jour à envoyer est `defiList(data).map(c => ({ id: c.id, name: c.name, ...defiToday(c), steps: defiSteps(defiGoal(c), c.measure) }))`.

## Coach : rien en V1, idée pour plus tard

Le coach ne voit pas les défis. Plus tard : les montrer dans le suivi de l'élève (avec son accord, comme la diète),
et laisser le coach proposer un défi (« 50 squats par jour pendant 30 jours »).

## Tests

- `tests/unit/defis.mjs` : création bornée, ajouts en plusieurs fois, Annuler, minuit et changement d'heure, série,
  pause, objectif daté, correction d'un jour, fusion de la synchro (commutative, ajouts hors ligne des deux côtés,
  annulés jamais ressuscités, suppression), profil synchronisé dans toutes les branches, pas des boutons, textes,
  export CSV, récap (réglage, période sans défi), rappels, arrêt et fin.
- `tests/test_defis.py` : accueil sur chaque appareil et thème (pas des boutons, +10, délai de garde, Annuler, cibles
  de 44 pt, textes coupés, VoiceOver), fiche, calendrier, correction ; création ; 4 défis au plus ; pause et arrêt ;
  minuit ; ligne « Lancer un défi » ; iPhone SE en texte agrandi ; Progrès inchangé ; récap avec et sans le bloc,
  image partagée.
