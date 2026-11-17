# MDLF Training · feuille de route complète

Mise à jour le 17 novembre 2026. De la PWA « PPL Training » d'avril 2026 à l'app iPhone MDLF Training, puis la suite, dans l'ordre.

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

### 31 octobre → 1er novembre · Lot 3, build 31 et notifications

|   | Date  | Quoi                                                                         | Comment publié              |
|---|-------|------------------------------------------------------------------------------|-----------------------------|
| ✓ | 31/10 | Fiabilité : mini-barre, tempo, synchro                                       | OTA 2a7d297, ppl-v105       |
| ✓ | 31/10 | Lot 3 : records dans la séance, réactions emoji, Mon profil, partage du poids | 6 migrations + OTA 7f729da  |
| ✓ | 31/10 | Lot 3 : commentaires sur les séances, chat coach ↔ élève, signalements       | Serveur + OTA 7f729da       |
| ✓ | 31/10 | Build 31 : notifications, sommeil, séances dans Santé, photos                | TestFlight 31               |
| ✓ | 31/10 | Build 31 : Apple Watch, widget, Siri                                         | TestFlight 31               |
| ✓ | 31/10 | Correctif des mises à jour à chaud (« à jour » au lieu de « en attente »)    | OTA eef8b5e, ppl-v107       |
| ✓ | 31/10 | Serveur de notifications push en service (APNs, envoi chaque minute)         | Serveur                     |
| ✓ | 01/11 | Notifications des messages et des commentaires (éteintes au départ)          | Serveur + OTA 384390b       |
| ✓ | 01/11 | Récaps v3 corrigés selon tes retours, « Mon mois en bref »                   | OTA 384390b, ppl-v108       |
| ✓ | 01/11 | Accessibilité (VoiceOver, contraste sombre), bouton « réessayer » daté        | OTA 384390b                 |
| ✓ | 01/11 | Dépendances de dev mises à jour (alerte glob)                                | Interne                     |
| ✓ | 01/11 | Nouveau design de l'accueil et de Mon profil, niveaux de force               | OTA a484b5a, ppl-v109       |
| ✓ | 01/11 | Coffre à photos : Face ID ou code de l'iPhone, clé dans le trousseau iCloud  | Build 33 (testeurs externes) |
| ✓ | 01/11 | Import CSV : séance datée de sa fin ; CI sur ubuntu-24.04                    | OTA 1a23120, ppl-v112       |
| ✓ | 01/11 | « @mdlftraining » sur la story et les récaps                                 | OTA d127b26, ppl-v113       |
| ✓ | 01/11 | Récap profil : paliers de Progrès, légende, top 3                             | OTA f39e3a5, ppl-v114       |
| ✓ | 01/11 | « Toi : N muscles à l'objectif », carte « Ta semaine » le dimanche et lundi matin | OTA be1785b, ppl-v115  |
| ✓ | 01/11 | Carte « Ta semaine » revenue (masquée seulement par la croix), relecture du récap | OTA 053bcd0, ppl-v117  |

### 2 novembre

|   | Date  | Quoi                                                                         | Comment publié              |
|---|-------|------------------------------------------------------------------------------|-----------------------------|
| ✓ | 02/11 | Partage en story : l'aperçu se ferme quand on part dans Instagram            | OTA d51b58d, ppl-v120       |
| ✓ | 02/11 | Partage en story : la feuille d'iOS se referme au retour (code natif)        | Branche natif-feuille-partage · build 34 |
| ✓ | 02/11 | Page de confidentialité version store (abonnement, lettre, devenir coach)    | Branche confidentialite-store · pas en ligne |
| ✓ | 02/11 | Carrousel Instagram « version coach » (7 images)                              | Bureau › MDLF Instagram › post2_coach |
| ✓ | 02/11 | fitby_dylan passé coach                                                       | Serveur                     |

### 3 → 17 novembre · Vagues 1 à 4, design sobre, nutrition, coach, générateur

|   | Date  | Quoi                                                                                  | Comment publié                                |
|---|-------|---------------------------------------------------------------------------------------|-----------------------------------------------|
| ✓ | 03/11 | Payant complet fusionné dans main (verrou éteint), build 45 sur TestFlight            | Build 45, main 263fc0d, ppl-v123              |
| ✓ | 03/11 | Recherche d'exercices : filtre par groupe puis par muscle                             | OTA f883710, ppl-v124                         |
| ✓ | 04/11 | Story : toutes les séries ; élastiques des tractions et dips ; volume des bips        | OTA, ppl-v125 à v127                          |
| ✓ | 05/11 | Retours des coachs : fourchette de reps, « Avant » d'un autre programme, 5 exercices  | main da8855d                                  |
| ✓ | 07/11 | Vague 1 : suivi du coach, prise et ordre, nutrition, techniques d'intensification     | OTA 2026.11.7-3768be4, ppl-v130               |
| ✓ | 08/11 | Vague 2 : onglet Coach, photos de bilan chiffrées, sauvegarde quotidienne de la base  | OTA 2026.11.8-5d6f6ae, ppl-v132               |
| ✓ | 10/11 | Vague 3 : finitions des experts Apple, texte agrandi, scan de code-barres             | Build 67                                      |
| ✓ | 10/11 | Nutrition : quantités à l'unité, feuille au-dessus du clavier, retour sur aujourd'hui | OTA 2026.11.10-2a0998d puis aa8da2c, ppl-v145 |
| ✓ | 12/11 | RIR sur la dernière série seulement                                                   | OTA f50f417, ppl-v147                         |
| ✓ | 13/11 | Vague 4 : design sobre (un seul orange, noir pur), muscles 3D en rouge, reps fixes    | Build 68, ppl-v152                            |
| ✓ | 13/11 | Vague 4 : repas retirables, sons natifs, mises à jour à chaud signées                 | Build 68                                      |
| ✓ | 13/11 | Bibliothèque illustrée, fiche d'exercice refaite, repas vides par défaut              | OTA 2026.11.13-74703ef, ppl-v158              |
| ✓ | 15/11 | Programme, Historique (personnage par séance), Progrès par muscle                     | OTA f49ee47 à d30aac2, ppl-v170 à v176        |
| ✓ | 15/11 | Coach et Social illustrés, son de fin de repos natif, tempo                           | OTA 344ce65 et 861f613                        |
| ✓ | 16/11 | Nutrition illustrée, Réglages façon iOS, séance en cours avec vignettes               | OTA 42dcdf7, ppl-v183                         |
| ✓ | 16/11 | Nutrition : objectifs du jour, déplacer un aliment, repas types facultatifs           | OTA efbd8b3, ppl-v193                         |
| ✓ | 17/11 | Coach : charges et reps prescrites, notifications en contexte                         | OTA 2026.11.17-4f8d900, ppl-v201              |
| ✓ | 17/11 | Générateur de programme à règles, vacuum guidé, ajout d'exercices, retours testeurs   | OTA 2026.11.17-4f8d900, ppl-v201              |
| ✓ | 17/11 | Muscles : rowing bûcheron compté pour le dos, 52 noms corrigés (audit de 1 913)       | OTA 2026.11.17-d34120e, ppl-v202              |

---

## 2. En cours

|   | Quoi                                                                                                        | Où          | État                                       |
|---|-------------------------------------------------------------------------------------------------------------|-------------|--------------------------------------------|
| ▶ | Vague « regard neuf » : premier lancement, saisie en séance, mots, séance libre, CSV, sauvegarde, VoiceOver | Branche yn2 | Intégration, puis panel 40 juges, puis OTA |

---

## 3. À faire, dans l'ordre

### Avant le paiement · A. Code

|   | Quoi                                                                         | Quand / état              |
|---|------------------------------------------------------------------------------|---------------------------|
| ▶ | Vague « regard neuf » yn2 : intégration, panel 40 juges, OTA et mail         | En cours (17/11)          |
| ○ | Nouveau passage des 12 profils « regard neuf » (6,6/10 le 17/11, objectif 8) | Après yn2                 |
| ○ | Dépôt Muscu remis en privé                                                   | Quand plus aucun chantier |

### Avant le paiement · B. Prêt, attend ton feu vert (serveur ou build)

|   | Quoi                                                                                         | Quand / état                                      |
|---|----------------------------------------------------------------------------------------------|---------------------------------------------------|
| ○ | Élèves gratuits (le coach paie le forfait), code d'offre élève retiré dans App Store Connect | Branche eleves-gratuits, migration 20261116030000 |
| ○ | Écart prescrit / fait chez le coach, notification « élève a terminé »                        | Migrations 20261116010000 et 20261116020000       |
| ○ | Photo de profil                                                                              | Branche photo-profil (serveur + build)            |
| ○ | Build TestFlight 69 : son natif robuste, photo de profil, tout le natif en attente           | Après ton accord                                  |

### Avant le paiement · C. Tes démarches

|   | Quoi                                                                                       | Quand / état                                         |
|---|--------------------------------------------------------------------------------------------|------------------------------------------------------|
| ○ | Pages juridiques : téléphone pro, médiateur (CM2C conseillé), date de mise en ligne, SIRET | Vérifier si le transfert d'adresse a changé le SIRET |
| ○ | App Store Connect : DSA en commerçant, code postal du support, Small Business Program      | À faire                                              |
| ○ | App Store Connect : testeur Sandbox, captures de revue des abonnements, confidentialité    | Liste du 12/11                                       |
| ○ | Contrats des coachs partenaires (3 projets dans docs/juridique)                            | À relire et signer                                   |
| ○ | MDLF_SORTIE=true, build de soumission, soumission App Store, verrou payant allumé          | En dernier                                           |

### Avant le paiement · D. Questions ouvertes

|   | Quoi                                                                  | Quand / état     |
|---|-----------------------------------------------------------------------|------------------|
| ○ | « Garder cet ordre » sur un programme envoyé par le coach ?           | À trancher       |
| ○ | Pull over seul : poulie (dos) ou haltère (pecs + dos) ?               | À trancher       |
| ○ | Consignes et objectifs « max » ou en secondes dans un programme perso | Proposé le 17/11 |

### Après la sortie

|   | Quoi                                                                             | Quand / état           |
|---|----------------------------------------------------------------------------------|------------------------|
| ○ | Progression automatique expliquée (« pourquoi ce poids »), sans décharge imposée | Après la sortie        |
| ○ | Suivi du cycle menstruel                                                         | Recherche faite        |
| ○ | Vraies vidéos d'exercices filmées par les coachs                                 | Attend les vidéos      |
| ○ | Instagram : 3 ou 4 publications par semaine, petits créateurs                    | Après la sortie        |
| ○ | Android : Google Play (25 $), 12 testeurs pendant 14 jours, paiement Google Play | Après la sortie iPhone |
| ○ | Personnage 3D animé                                                              | Après la sortie        |
| ○ | Strava                                                                           | En sommeil             |
| ○ | Appli web pour les coachs                                                        | Seulement si besoin    |
| ○ | Marque INPI                                                                      | Quand l'app rapporte   |

---

## 4. En chiffres (au 30 octobre 2026, vérifiés dans le dépôt ; en ligne mis à jour le 1er novembre)

- 393 commits en tout, dont 373 sur la branche principale, du 15 avril au 30 octobre 2026, sur 22 jours de travail.
- Rythme : 65 commits en avril, 1 en septembre, 307 en octobre. Jours les plus chargés : 25 octobre (65) et 30 octobre (57).
- 43 fusions de branches (travail mené en parallèle).
- 397 tests unitaires, tous verts.
- 118 tests de bout en bout dans 28 fichiers, joués sur 5 téléphones (2 iPhone, 3 Android) en clair et en sombre.
- 5 fichiers de tests du serveur (SQL).
- Bibliothèque : 183 exercices, chacun avec sa fiche « Comment faire ».
- Code de l'app : environ 23 100 lignes de JavaScript (95 fichiers) et 2 800 lignes de CSS.
- Serveur : 10 migrations et 3 fonctions sur la branche principale (le payant attend sur sa branche).
- En ligne le 1er novembre : OTA 2026.11.1-384390b (cache ppl-v108), sur la build TestFlight 31. Les builds 28 et avant ne reçoivent plus les mises à jour.
