# Outils de la séance (lot 2) : disques, échauffement, RIR

Mise à jour le 30 octobre 2026. Trois outils facultatifs pendant la séance, livrés par OTA. Rien n'est
obligatoire : valider une série reste un seul toucher sur ✓.

## Fichiers

| Rôle | Fichier |
|------|---------|
| Disques : exercices à barre, jeu de disques, répartition par côté, arrondi au matériel | `js/data/plates.js` |
| Échauffement : règle des paliers, charge de base, numérotation, exclusions | `js/data/warmup.js` |
| RIR : nettoyage, équivalence RPE, effort moyen, ligne de l'historique | `js/data/rir.js` |
| Feuilles « Disques » et « Échauffement », actions | `js/features/session-tools.js` |
| Lignes de séries (É, bouton Disques, sélecteur RIR), toasts | `js/features/session.js` |
| Interrupteur « Noter le RIR » | `js/features/settings.js` (Réglages › Entraînement) |
| Courbe « Effort » (RPE moyen) | `js/features/progress-chart.js`, `exPoint` dans `progress.js` |
| Tests unitaires | `tests/unit/seance-outils.mjs` |
| Tests E2E | `tests/test_seance_outils.py` |

## Disques

- Bouton à la place du numéro de la série à faire, seulement pour un **exercice à barre** : répétitions en
  vraie charge (ni lest ni aide), fiche de la bibliothèque dans la famille « Salle » (ou nom libre) et mot-clé
  de barre (`BARBELL_RE`) sans mot d'un autre matériel (`NOT_BARBELL_RE` : haltère, poulie, machine, smith…).
  La bibliothèque n'a pas de famille « barre chargée » (son filtre « barre » désigne les tractions et dips),
  d'où cette règle par nom. Aussi dans le menu ⋯ (« Disques »).
- Feuille : cible (−/+ d'une paire du plus petit disque), dessin d'un côté (rectangles proportionnels, poids
  sous chaque disque), texte « Par côté : 20 + 2,5 · 65 kg », barre 20 / 15 / 10 kg (45 / 35 lb en livres),
  disques disponibles en pastilles (jeu standard 25, 20, 15, 10, 5, 2,5, 1,25 kg ; 45, 35, 25, 10, 5, 2,5 lb ;
  « Autre » ajoute un disque de 0,25 à 50). Barre et disques mémorisés dans `data.plates` (propre à l'appareil,
  `SYNC_LOCAL_ONLY`). Cible inatteignable : charge la plus proche en dessous, et un bouton la reporte dans la série.
- Calcul : programmation dynamique sur les quarts (0,25), le moins de disques pour la charge atteignable la plus
  proche sous la cible ; un jeu incomplet (15 + 15 là où il n'y a ni 20 ni 10) est bien servi.

## Échauffement

- Menu ⋯ › « Ajouter un échauffement » : exercice en répétitions à vraie charge, charge connue, aucune série
  faite, pas déjà d'échauffement, hors superset (les tours s'enchaînent).
- Règle (`WARMUP_STEPS`) : **40 % × 8, 60 % × 5, 80 % × 3** de la charge de la première série de travail,
  arrondis au matériel (barre + paires du plus petit disque pour une barre, pas de 2,5 kg ou 5 lb sinon). Un
  palier arrondi à la charge de travail ou au-delà disparaît ; deux paliers confondus ne font qu'une série.
- Source : c'est une **convention courante** de montée en charge, pas un protocole publié avec ces chiffres.
  Elle suit l'esprit de deux références : le NSCA (*Essentials of Strength Training and Conditioning*) demande un
  échauffement spécifique au mouvement, à charges légères puis croissantes ; Starting Strength (Rippetoe)
  décrit une montée par paliers à peu près réguliers avec des reps qui diminuent, barre à vide d'abord. Les
  pourcentages exacts sont le choix de l'app ; la feuille le dit (« convention courante »).
- Stockage : `warmup: true` sur la série. Affichage en gris sous un titre « Échauffement », numéro « É » ; les
  séries de travail restent numérotées 1, 2, 3. Toast « Échauffement 1 validé ». La charge d'un échauffement ne
  se reporte jamais sur la série suivante.
- **Exclu partout dans l'app** (`workSets`) : volume (`setsVolume`, `exVolume`), records et 1RM
  (`recomputePRFromHistory`, `exerciseRecord`, `historyBaseline`, badge de la séance), meilleure série
  (`bestSet`, `summaryBestSet`), cible de la prochaine séance et pré-remplissage (`exerciseTarget`,
  `buildSets`), puce « ↑ +2,5 kg », séries par muscle (`muscleSetCounts`), progrès (`exPoint`), texte des
  séries (`setsText`, ligne à part `warmupText`), nombre de séries du bilan, de l'historique et de l'image partagée.
- Compatibilité : une version précédente ignore le champ (elle voit des séries ordinaires) ; `cleanHistoryEntry`
  ne garde que `true`. Historique › Modifier garde `warmup` et `rir` tels quels.

## RIR

- Après validation d'une série en répétitions (hors échauffement), un sélecteur **RIR 0 · 1 · 2 · 3 · 4+**
  apparaît sous la dernière série validée, avec l'équivalent RPE du choix (RIR 0 = RPE 10, 1 = 9, 2 = 8, 3 = 7,
  4+ = ≤ 6 : échelle de Zourdos et al., *J Strength Cond Res*, 2016). Même toucher = effacé. Une série validée
  rouverte montre aussi le sélecteur ; les autres séries notées portent un badge « RIR 2 ».
- Réglage : Réglages › Entraînement › « Noter le RIR » (`data.rirOn`, vrai par défaut, propre à l'appareil).
- Stockage : `rir` entier 0 à 4 sur la série, absent sinon (`cleanRir`).
- Affichage : Historique › Séance, ligne « RIR 2 · — · 1 » sous les séries ; Progrès › Exercice, courbe
  « Effort » (RPE moyen des séries notées, échelle fixe 6 à 10, sans tendance en %) dès qu'une séance en a,
  et « · RPE 8,5 » dans la liste des séances.

## Ce que le serveur ne transmet pas encore

`private.session_public` (`supabase/migrations/20261026050000_social.sql`, repris par
`20261027000000_supersets.sql`) ne garde d'une série que `weight`, `reps` et `dist`. Un **coach ou un ami ne
voit donc ni `warmup` ni `rir`** : chez lui, les séries d'échauffement comptent comme du travail (volume,
flèches, records de `js/data/session-review.js`) et le RIR est absent. Le serveur n'a pas été modifié dans ce
lot ; l'ajouter demande une migration qui étend la liste blanche (deux champs scalaires) et un nettoyage côté
`cleanPublicSession`. Côté app, `session-review.js` applique déjà `workSets` : dès que le serveur enverra
`warmup`, l'échauffement sera exclu sans autre changement.
