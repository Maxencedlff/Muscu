# MDLF Training · feuille de route complète

Mise à jour le 30 octobre 2026. De la PWA « PPL Training » d'avril 2026 à l'app iPhone MDLF Training, puis la suite, dans l'ordre.

Légende : ✓ = fait, ▶ = en cours, ○ = à faire. OTA = mise à jour à chaud (sans passer par l'App Store).
Build = nouvelle version de l'app compilée (TestFlight, puis App Store). Les codes comme 2b0a3fd sont les repères Git de la publication.
ppl-v104 = numéro de version du cache de l'app (il monte à chaque changement de l'interface).

---

## 1. Ce qui est fait

### Avril → septembre 2026 · PWA « PPL Training » (site web, en ligne à chaque envoi)

|   | Date  | Quoi                                                                        | Comment publié |
|---|-------|-----------------------------------------------------------------------------|----------------|
| ✓ | 15/04 | Carnet PPL : séances, historique, séance précédente, kg et reps pré-remplis | Site web       |
| ✓ | 15/04 | Graphiques de progression par exercice (dates, bande min/max)               | Site web       |
| ✓ | 15/04 | Saisie, modification et suppression de séances passées                      | Site web       |
| ✓ | 15/04 | Exercices au poids du corps, 1RM estimé, notes, volume, objectifs           | Site web       |
| ✓ | 15/04 | Délai de 72 h entre deux séances du même type                               | Site web       |
| ✓ | 16/04 | Repos automatique après chaque série, chrono qui tourne en arrière-plan     | Site web       |
| ✓ | 16/04 | Flash d'écran en fin de repos, mini-barre de repos, clavier numérique       | Site web       |
| ✓ | 16/04 | Choix du programme : PPL, Upper/Lower, Full Body, Bro split, Arnold, perso  | Site web       |
| ✓ | 20/04 | Délai de récupération par séance, bouton Passer, ordre des séances          | Site web       |
| ✓ | 20/04 | Série de semaines d'affilée, volume en direct, vue d'ensemble des stats     | Site web       |
| ✓ | 20/04 | Refonte visuelle, thème clair / sombre, page Réglages, unité lbs            | Site web       |
| ✓ | 20/04 | Durée de la séance, icône de l'app, thème inclus dans l'export              | Site web       |
| ✓ | 20/04 | Bandes grises en bas de l'iPhone : une vingtaine de correctifs              | Site web       |
| ✓ | 21/04 | Modifier une série déjà validée                                             | Site web       |
| ✓ | 28/04 | Records et 1RM recalculés après une suppression ou un import                | Site web       |
| ✓ | 30/09 | Ajouter un exercice à une séance de l'historique                            | Site web       |

### 15 et 16 octobre · Refonte façon Apple

|   | Date  | Quoi                                                                      | Comment publié    |
|---|-------|---------------------------------------------------------------------------|-------------------|
| ✓ | 15/10 | Séance en cours gardée même si l'app se ferme, dialogues façon iOS        | Site web          |
| ✓ | 15/10 | Design iOS, 4 onglets : Entraînement, Historique, Progrès, Programme      | Site web, ppl-v23 |
| ✓ | 15/10 | Séance en tableau (Série, Préc., kg, Reps, ✓), repos non bloquant, bilan  | Site web, ppl-v23 |
| ✓ | 15/10 | Un seul tap suffit sur iPhone                                             | Site web, ppl-v24 |
| ✓ | 15/10 | Programmes perso : plusieurs, nommés, séances et exercices au choix       | Site web, ppl-v25 |
| ✓ | 15/10 | Tests automatiques sur téléphones simulés (Playwright, lots 1 à 7)        | Interne           |
| ✓ | 15/10 | Code rangé en dossiers, ARCHITECTURE.md, README, premiers tests unitaires | Interne           |
| ✓ | 16/10 | Corrections après revue de code                                           | Site web          |

### 16 → 19 octobre · App iPhone (Capacitor) et TestFlight

|   | Date  | Quoi                                                                     | Comment publié            |
|---|-------|--------------------------------------------------------------------------|---------------------------|
| ✓ | 16/10 | App iPhone native, version 1.0, fiche App Store, page de confidentialité | Premières builds          |
| ✓ | 16/10 | Compilation et envoi TestFlight automatiques (GitHub, Xcode 26)          | Interne                   |
| ✓ | 16/10 | Apple Santé (séance Musculation, poids) et Apple Music                   | Build 7, corrigé build 12 |
| ✓ | 16/10 | Mises à jour à chaud (OTA) hébergées chez nous                           | Build 14, 1re OTA 328c87d |
| ✓ | 17/10 | Poids de secours pour les calories, virgule acceptée dans les nombres    | OTA                       |
| ✓ | 17/10 | Données de test réalistes : 6 mois, 78 séances                           | Interne                   |
| ✓ | 17/10 | Carte des muscles travaillés                                             | Build 19                  |
| ✓ | 17/10 | Story Instagram de fin de séance                                         | Build 19                  |
| ✓ | 17/10 | Repos sur l'écran verrouillé (Live Activity, Dynamic Island)             | Build 19                  |
| ✓ | 18/10 | Nouvelle icône (le M en barre chargée) et icônes au choix                | Build 19                  |
| ✓ | 18/10 | Testeurs externes : groupe TestFlight par lien public (20 places)        | Build 19 en revue bêta    |
| ✓ | 18/10 | Audit senior : failles XSS, effacement des données, confidentialité      | OTA, ppl-v32              |
| ✓ | 18/10 | Réordonner les séances d'un programme                                    | OTA                       |
| ✓ | 18/10 | Barrière : rien n'est publié si les tests ne sont pas verts              | Interne                   |
| ✓ | 19/10 | Copie iCloud des données (retrouvées sur un nouvel iPhone)               | Build (code natif)        |
| ✓ | 19/10 | Poids pour les calories lu dans Santé dès qu'il y a une pesée            | OTA                       |

### 20 → 24 octobre · Retours des testeurs et bibliothèque d'exercices

|   | Date  | Quoi                                                                      | Comment publié         |
|---|-------|---------------------------------------------------------------------------|------------------------|
| ✓ | 20/10 | Accueil repensé : grand titre de la séance, cibles du jour, anneaux       | OTA                    |
| ✓ | 21/10 | Supprimés récemment (corbeille), séance libre ou d'un autre programme     | OTA                    |
| ✓ | 21/10 | Corrections après une vraie séance (série modifiée, son, partage)         | OTA, ppl-v40           |
| ✓ | 22/10 | Récupération par muscle, muscles déclarés pour tout exercice              | OTA, ppl-v42           |
| ✓ | 22/10 | Bips joués par iOS : audibles en mode silencieux, par-dessus la musique   | Build 23               |
| ✓ | 22/10 | Fin de la version web : il ne reste que l'app iPhone                      | Site réduit à une page |
| ✓ | 22/10 | Contrôle du code (ESLint) et correctif de sécurité (uuid)                 | Interne                |
| ✓ | 22/10 | Bibliothèque : exercices sans salle et filtre de matériel                 | OTA                    |
| ✓ | 23/10 | Muscles : noms d'habitués reconnus, principal et secondaire               | OTA                    |
| ✓ | 23/10 | Recherche tolérante, synonymes, « Créer » si le nom n'existe pas          | OTA                    |
| ✓ | 23/10 | S'entraîner sans salle : programmes maison, élastiques, kettlebell        | OTA                    |
| ✓ | 23/10 | Mesures par exercice (reps, durée, cardio), texte très grand lisible      | OTA                    |
| ✓ | 23/10 | Poids du corps : lest, aide, part du poids soulevée                       | OTA                    |
| ✓ | 23/10 | « Comment faire » : consignes de 45 exercices                             | OTA                    |
| ✓ | 24/10 | Chrono d'effort pour les séries en durée                                  | OTA                    |
| ✓ | 24/10 | Bannière « Nouvelle version dans TestFlight »                             | OTA                    |
| ✓ | 24/10 | Son natif gardé pendant la séance, chrono d'effort sur l'écran verrouillé | Build 24               |
| ✓ | 24/10 | Tempo des répétitions : rappel, ou guidé au son en option                 | OTA d970ce9            |
| ✓ | 24/10 | Partage de programme par message                                          | OTA c1851c8            |
| ✓ | 24/10 | Vague 1 des testeurs : ergonomie de la séance et du programme             | OTA cc7657f            |

### 25 octobre · Vague 2, comptes et Santé

|   | Date  | Quoi                                                                    | Comment publié        |
|---|-------|-------------------------------------------------------------------------|-----------------------|
| ✓ | 25/10 | Vague 2 : séance, recherche, accueil, programme (champ vidé au toucher) | OTA da7917f           |
| ✓ | 25/10 | Comptes : connexion Apple, synchro, fusion sans perte, suppression      | Build 25 + OTA        |
| ✓ | 25/10 | Comptes 2 : e-mail par code, Google, pseudo, avatar emoji, écran Compte | Build 28, OTA a10adac |
| ✓ | 25/10 | Sécurité des comptes : suppression protégée, journal des connexions     | OTA                   |
| ✓ | 25/10 | Course et vélo : allure, sorties lues dans Apple Santé                  | Build 27              |
| ✓ | 25/10 | Silhouette femme ou homme pour la carte des muscles                     | Build 27              |
| ✓ | 25/10 | Muscles de la bibliothèque vérifiés un par un                           | Build 27              |
| ✓ | 25/10 | « Comment faire » pour tous les exercices de la bibliothèque            | Build 27              |
| ✓ | 25/10 | VoiceOver : séries, compteurs et barres de semaines lisibles            | OTA                   |
| ✓ | 25/10 | Mentions légales (page de confidentialité et Réglages)                  | OTA                   |
| ✓ | 25/10 | Fiche App Store réécrite, nouvelles captures                            | App Store Connect     |
| ✓ | 25/10 | Déclaration « Confidentialité de l'app » (par Maxence)                  | App Store Connect     |
| ✓ | 25/10 | Nom de domaine mdlf.app                                                 | Acheté                |
| ✓ | 25/10 | Passe « sans IA » : textes, Progrès à deux chiffres, point de couleur   | OTA f9ba093           |

### 26 octobre · Social (onglet Amis)

|   | Date  | Quoi                                                                   | Comment publié           |
|---|-------|------------------------------------------------------------------------|--------------------------|
| ✓ | 26/10 | Accueil : avatar à la place de la roue, « Cette semaine » en une carte | OTA e7dc03f              |
| ✓ | 26/10 | Social V1 : demandes à accepter, blocages, bravos, fil, signalements   | OTA 605aa68              |
| ✓ | 26/10 | Premier lancement en 3 questions, Mes programmes, guide de l'app       | OTA 605aa68              |
| ✓ | 26/10 | Muscles modifiables avec confirmation, bouton pour les rétablir        | OTA 26c642a              |
| ✓ | 26/10 | Noms tapés reconnus : alias anglais, argot, exercices d'un testeur     | OTA 26c642a              |
| ✓ | 26/10 | Séries validées dans l'ordre                                           | OTA 26c642a              |
| ✓ | 26/10 | Progrès « Cette semaine » depuis lundi, code en double centralisé      | OTA 70dd43b puis 669de65 |

### 27 → 29 octobre · Supersets et mode coach

|   | Date  | Quoi                                                                     | Comment publié       |
|---|-------|--------------------------------------------------------------------------|----------------------|
| ✓ | 27/10 | Supersets, tri-sets, circuits : tour par tour, repos à la fin du tour    | OTA 133c9b2          |
| ✓ | 27/10 | Supersets en blocs sur l'image story                                     | OTA, ppl-v97         |
| ✓ | 27/10 | Mode coach V1 : élèves invités par code, programmes, commentaires        | OTA 8d3bf0a, ppl-v98 |
| ✓ | 27/10 | Décompte sonore des 3 dernières secondes du repos                        | OTA 8d3bf0a          |
| ✓ | 27/10 | Pentest serveur et app : aucune faille ; déconnexion qui vide les caches | OTA b746bad          |
| ✓ | 28/10 | Story : détail des séries quand elles diffèrent                          | OTA, ppl-v100        |
| ✓ | 28/10 | Mises à jour à chaud automatiques (après 5 min, jamais en séance)        | OTA, ppl-v100        |
| ✓ | 29/10 | « Visible sur mon profil » en fin de séance, œil barré dans l'Historique | OTA a8281cc          |

### 30 octobre · Lot 1

|   | Date  | Quoi                                                                      | Comment publié        |
|---|-------|---------------------------------------------------------------------------|-----------------------|
| ✓ | 30/10 | Cardio sur machines (escaliers, tapis, vélo, elliptique, rameur) + chrono | OTA 49e1070, ppl-v102 |
| ✓ | 30/10 | Exercice « Escaliers » et équivalence « = Pec deck » sous les alias       | OTA 49e1070           |
| ✓ | 30/10 | Personnage 3D : bulle au toucher, 5 paliers, fiche agrandie, sombre       | OTA 49e1070           |
| ✓ | 30/10 | Page Séance du coach : volume, flèches, records, notes                    | OTA 49e1070           |
| ✓ | 30/10 | Vibrations au bon niveau, corrections de la relecture (schéma 6)          | OTA 49e1070           |
| ✓ | 30/10 | CI épinglée, Dependabot, en-têtes de sécurité du site mdlf.app            | Interne + site        |
| ✓ | 30/10 | Correctif : geste de retour sans zoom arrière de la page sur iOS          | OTA f0fba79, ppl-v103 |

### 30 octobre · Lot 2

|   | Date  | Quoi                                                           | Comment publié              |
|---|-------|----------------------------------------------------------------|-----------------------------|
| ✓ | 30/10 | Réglages réorganisés, sous-écran Sauvegarde                    | OTA 2b0a3fd, ppl-v104       |
| ✓ | 30/10 | Calculateur de disques et échauffement automatique             | OTA 2b0a3fd                 |
| ✓ | 30/10 | RIR facultatif par série (le RPE des imports est converti)     | OTA 2b0a3fd                 |
| ✓ | 30/10 | Import depuis Hevy et Strong                                   | OTA 2b0a3fd                 |
| ✓ | 30/10 | Mensurations et photos de progression (sur l'iPhone seulement) | OTA 2b0a3fd, photos : build |
| ✓ | 30/10 | Récaps semaine / mois / année façon Replay, en stories         | OTA 2b0a3fd                 |
| ✓ | 30/10 | Abdominaux et Obliques séparés (muscle, exercices, personnage) | OTA 2b0a3fd                 |
| ✓ | 30/10 | Version de l'app envoyée au serveur, corrections de la synchro | OTA 2b0a3fd                 |
| ✓ | 30/10 | Assemblage, suite complète des tests, relecture                | OTA 2b0a3fd                 |

---

## 2. En cours

|   | Quoi                                                                          | Où                        | État                                   |
|---|-------------------------------------------------------------------------------|---------------------------|----------------------------------------|
| ▶ | Récaps v2 : refonte façon carnet fun, carte citron vert, record avant → après | Branche recaps-v2         | En réalisation                         |
| ▶ | Système payant modèle B : StoreKit, essai 3 mois, codes cadeaux, verrou       | Branche payant            | Prêt, tests verts · attend ta décision |
| ▶ | Abonnements 5,99 €/mois et 41,99 €/an, offre 3 mois gratuits                  | App Store Connect         | Créés · manque la capture de revue     |
| ▶ | Photos de progression dans l'app iPhone (autorisations caméra et photos)      | Branche nuit-build        | Fusionnée dans la build unique         |
| ▶ | Build unique : sommeil, séances détaillées dans Santé, notifications push    | Branche nuit-build        | Écrite, tests verts · non compilée     |

---

## 3. À faire, dans l'ordre

### Reste du lot 2

|   | Quoi                                                 | Quand / état             |
|---|------------------------------------------------------|--------------------------|
| ○ | @compte Instagram sur la story + « on la repartage » | Dès que le compte existe |

### Lot 3 · Serveur (feu vert n° 2 : montré avant la mise en ligne)

|   | Quoi                                                            | Quand / état                                 |
|---|-----------------------------------------------------------------|----------------------------------------------|
| ○ | Records notés dans la séance, visibles par amis et coach        | Feu vert n° 2                                |
| ○ | Nouveaux records : temps, distance, allure, assistés            | Feu vert n° 2                                |
| ○ | Plusieurs réactions emoji + qui a réagi                         | Feu vert n° 2                                |
| ○ | Écran Mon profil, pastille d'activité, bravos dans l'Historique | Feu vert n° 2                                |
| ○ | Partage du poids avec le coach (consentement)                   | Feu vert n° 2                                |
| ○ | Échauffements et RIR visibles par les amis et le coach          | Feu vert n° 2                                |
| ○ | Export vers Strava (jeton côté serveur)                         | Feu vert n° 2                                |
| ○ | 3 index manquants                                               | Feu vert n° 2                                |
| ○ | Mise en ligne du payant modèle B, verrou éteint                 | Prêt · attend ta décision carte / sans carte |

### Build unique (TestFlight, puis App Store)

|   | Quoi                                                  | Quand / état                       |
|---|-------------------------------------------------------|------------------------------------|
| ○ | Paiement Apple (StoreKit)                             | Module écrit sur la branche payant |
| ▶ | Sommeil affiché sur l'accueil (pas partagé au coach)  | Branche nuit-build, docs/BUILD.md  |
| ▶ | Notifications (coach, demandes, bravos)               | Branche nuit-build, docs/BUILD.md  |
| ▶ | Écriture des séances dans Apple Santé (cardio, durée) | Branche nuit-build, docs/BUILD.md  |
| ○ | Vérification de l'âge par Apple pour l'onglet Amis    | À faire                            |
| ○ | Écran « mets à jour l'app » avant d'allumer le verrou | À faire                            |
| ○ | Apple Watch (2e build si trop long)                   | À faire                            |

### Démarches Apple et légales

|   | Quoi                                                                 | Quand / état     |
|---|----------------------------------------------------------------------|------------------|
| ○ | Décider : essai avec ou sans carte bancaire                          | En attente       |
| ○ | Vérifier que la micro-entreprise couvre la vente d'apps              | À faire          |
| ○ | Contrat Paid Apps (RIB, fiscal)                                      | À faire          |
| ○ | Clé In-App Purchase (.p8) → secrets                                  | À faire          |
| ○ | Testeur Sandbox                                                      | À faire          |
| ○ | Small Business Program (15 % au lieu de 30 %)                        | À faire          |
| ○ | Statut de commerçant (DSA) + domiciliation                           | À faire          |
| ○ | Mentions légales pro, CGU, CGV, médiateur (SIREN)                    | À faire          |
| ○ | Fiche Confidentialité de l'app (Santé partagée)                      | À faire          |
| ○ | URL de confidentialité de la fiche → mdlf.app/privacy.html           | À la publication |
| ○ | Âge 13+, prix et pays, mode de publication                           | À la soumission  |
| ○ | Capture de revue, note d'examen, compte de test, URL de notification | À faire          |

### Sortie App Store

|   | Quoi                                          | Quand / état              |
|---|-----------------------------------------------|---------------------------|
| ○ | Codes gratuit à vie (Maxence et les testeurs) | Le jour de l'allumage     |
| ○ | Précommande App Store + lien en bio           | Quand la build est prête  |
| ○ | Allumer le verrou payant                      | Après les démarches Apple |

### Partenariat coachs (vidéos d'exercices et pubs Instagram)

|   | Quoi                                                      | Quand / état         |
|---|-----------------------------------------------------------|----------------------|
| ○ | Décider du partenariat avec les deux coachs               | En attente           |
| ○ | Contrat vidéos : cession de droits + droit à l'image      | Quand tu le demandes |
| ○ | Contrat d'influence (mention « Publicité » obligatoire)   | Quand tu le demandes |
| ○ | Commission : proposition 20 à 25 % du net pendant 12 mois | À décider            |
| ○ | Vérifier leur carte pro et leur statut pour facturer      | À faire              |
| ○ | Code par coach : compter les abonnés qu'il apporte        | Avec le lot 3        |
| ○ | Vidéos hébergées en ligne, 20 à 30 exercices d'abord      | Quand elles arrivent |
| ○ | Vidéos aussi dans le mode coach, pour leurs élèves        | Quand elles arrivent |

### Instagram

|   | Quoi                                       | Quand / état           |
|---|--------------------------------------------|------------------------|
| ○ | Compte dédié pro, app Meta, autorisation   | À faire                |
| ○ | 3 Reels prêts, puis 3 ou 4 par semaine     | Reels prêts            |
| ○ | 5 à 10 petits créateurs contre codes à vie | Dès la précommande     |
| ○ | Pub payante sur un Reel qui a déjà marché  | Jamais avant la sortie |

### Personnage 3D animé

|   | Quoi                                        | Quand / état   |
|---|---------------------------------------------|----------------|
| ○ | Animation : squat + curl d'abord, sur le PC | Après le lot 2 |
| ○ | Puis toute la bibliothèque (Colab)          | Après l'essai  |
| ○ | Version femme, matériel, vues de profil     | Ensuite        |

### Android

|   | Quoi                                                    | Quand / état           |
|---|---------------------------------------------------------|------------------------|
| ○ | Compte Google Play (25 $), 12 testeurs pendant 14 jours | Après la sortie iPhone |
| ○ | Parties natives, paiement Google Play, pré-inscription  | Après la sortie iPhone |

### Après le payant · parrainage et tarifs

|   | Quoi                                                                                      | Quand / état              |
|---|-------------------------------------------------------------------------------------------|---------------------------|
| ○ | Parrainage entre utilisateurs : 1 mois offert à l'ami et au parrain (quand l'ami paie)    | Après le payant + clé IAP |
| ○ | Coachs vérifiés (carte pro), code unique, 20 % du net pendant 12 mois sur leurs élèves    | Branche payant (en cours) |
| ○ | Tarifs : 6,49 €/mois, coach 15,99 à 29,99 € selon les élèves, annuel = 8,5 mois, élève −25 % | Branche payant (en cours) |

### Plus tard

|   | Quoi                                                          | Quand / état          |
|---|---------------------------------------------------------------|-----------------------|
| ○ | Newsletter, commentaires libres, chat coach, widgets, Siri    | Plus tard             |
| ○ | Score de force, périodisation, option à vie, marque INPI      | Plus tard             |
| ○ | Test mini-barre, rôle coach d'un testeur                      | Plus tard             |
| ○ | Messages tout faits en réaction                               | Plus tard             |
| ○ | Coach payant selon son nombre d'élèves                        | Plus tard             |
| ○ | Programmes envoyés entre amis, programmes publics             | Plus tard             |
| ○ | Liens de profil mdlf.app/u/… (demandent une build)            | Plus tard             |
| ○ | Vraie version anglaise                                        | Plus tard             |
| ○ | Autre app de musique (Spotify fermé ; YouTube, Deezer à voir) | Plus tard             |
| ○ | Chronomètre de vitesse dans l'app (vrais temps sur iPhone)    | Si l'app paraît lente |
| ○ | Import des mensurations depuis Hevy                           | Plus tard             |
| ○ | Tests du tempo à renforcer                                    | Pas urgent            |

---

## 4. En chiffres (au 30 octobre 2026, vérifiés dans le dépôt)

- 393 commits en tout, dont 373 sur la branche principale, du 15 avril au 30 octobre 2026, sur 22 jours de travail.
- Rythme : 65 commits en avril, 1 en septembre, 307 en octobre. Jours les plus chargés : 25 octobre (65) et 30 octobre (57).
- 43 fusions de branches (travail mené en parallèle).
- 397 tests unitaires, tous verts.
- 118 tests de bout en bout dans 28 fichiers, joués sur 5 téléphones (2 iPhone, 3 Android) en clair et en sombre.
- 5 fichiers de tests du serveur (SQL).
- Bibliothèque : 183 exercices, chacun avec sa fiche « Comment faire ».
- Code de l'app : environ 23 100 lignes de JavaScript (95 fichiers) et 2 800 lignes de CSS.
- Serveur : 10 migrations et 3 fonctions sur la branche principale (le payant attend sur sa branche).
- En ligne aujourd'hui : OTA 2026.10.30-2b0a3fd (cache ppl-v104), sur la build TestFlight 28.
