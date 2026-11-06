# Suivi du coach : planification, bilan, courbe du poids

Demandes de deux coachs partenaires (vocaux du 03 au 05/11/2026) :
1. « dès que tu as un nouveau client, tu fais un genre de calendrier, comme un agenda… un mini cut qui va durer
   6 semaines, c'est écrit 6 semaines, je le vois dans mon calendrier, c'est bien ordonné » ;
2. « un côté bilan où ton client t'envoie ses mensurations, possiblement des photos » ;
3. voir la courbe du poids que l'élève partage.

Branche `coach-suivi` (partie de main da8855d), V1 du 05/11/2026. Rien n'est appliqué en production : les deux
migrations et l'OTA attendent le feu vert de Maxence (ordre plus bas).

Code : `js/data/coach-plan.js` et `js/features/coach-plan-ui.js` (planification), `js/data/coach-share.js` et
`js/features/coach-share-ui.js` (bilan), `css/coach-plan.css`. Serveur :
`supabase/migrations/20261105000000_coach_planning.sql`, `supabase/migrations/20261105010000_partage_mensurations.sql`.
Tests : `tests/sql/coach_planning_test.sql`, `tests/sql/partage_mensurations_test.sql`, `tests/unit/coach-plan.mjs`,
`tests/unit/coach-share.mjs`, `tests/test_coach_suivi.py` (faux serveur `tests/fake_account.py`).

## Décisions

| Sujet | Décision | Pourquoi |
|---|---|---|
| Unité du planning | Une **phase** = objectif, nom (facultatif), jour de début, durée en semaines (1 à 52), programme suivi (facultatif), note | C'est le vocabulaire des coachs : « un mini cut de 6 semaines ». Pas d'agenda à l'heure : ils raisonnent en blocs de semaines. |
| Objectifs | Prise de masse, Sèche, Mini cut, Maintien, Reprise, Force, Préparation, Décharge, Autre ; une couleur chacun | Les mots des coachs (« sèche », « mini cut ») plus les blocs courants d'une périodisation (décharge, force, préparation). « Autre » + le nom couvre le reste. |
| Dates | Un **jour du calendrier** (`date`), jamais un instant | La semaine se compte selon le jour du calendrier de chacun : l'heure d'été ne décale rien (calcul en jours UTC, `planDayNum`) ; un coach et un élève dans deux fuseaux différents peuvent changer de semaine à quelques heures d'écart, le jour où l'un est déjà le lendemain. |
| Chevauchement | **Refusé** (`overlap`), bord à bord accepté | « Où en est l'élève » n'a qu'une réponse. Vérifié dans l'app avant l'envoi (message qui nomme la phase en conflit), par la RPC sous un verrou par élève, et garanti par une **contrainte d'exclusion** (`btree_gist`, `daterange` qui ne se chevauchent pas), même pour deux enregistrements simultanés (test `coach_planning_concurrence_test.sql`). |
| Enchaînement | Le début proposé d'une nouvelle phase est le lendemain de la dernière | Le coach construit son calendrier sans calcul : « Ajouter » enchaîne. |
| Programme associé | Le **nom** du programme, choisi parmi les programmes du coach (ou aucun) | Les programmes du coach vivent sur son appareil ; un lien vers un programme envoyé demanderait de suivre ses renvois et ses suppressions. Le nom suffit à l'élève (« Programme : Sèche 4 jours »). |
| Note | Lue par **le coach seul** ; le serveur ne la donne jamais à l'élève | C'est un pense-bête (« objectif −2 kg avant les fêtes ») ; pour parler à l'élève, il y a les messages. Sous le champ : « Visible par toi seul. N'y note pas de données de santé. » Droit d'accès : voir « Note du coach et RGPD ». |
| Ce que voit l'élève | Sa phase en cours (ou la prochaine) dans Mon coach, en lecture seule, et « Mini cut, semaine 3 sur 6 » sous le nom du coach dans l'onglet Amis | « Discret » : pas de carte sur l'accueil (l'app s'ouvre en salle), pas de notification. |
| Vue d'ensemble | Mes élèves › **Planning** : une ligne par élève sur 16 semaines (3 passées, 12 à venir), barre colorée par phase, aujourd'hui marqué ; « Mini cut · sem. 3/6 » dans chaque ligne de Mes élèves | C'est « le calendrier bien ordonné ». 16 semaines tiennent dans la largeur d'un iPhone sans défilement horizontal (environ 15 px par semaine sur un iPhone SE). |
| Lien rompu | Planning **effacé** (cascade sur `coach_links`) | Comme les messages : quitter, être retiré ou supprimer un compte efface tout ; un nouveau coach ne voit jamais le planning de l'ancien. |
| Bilan | Les **mensurations** rejoignent « Partager avec mon coach », sur le modèle exact du poids | Même consentement par donnée, horodaté sur le serveur, décoché par défaut, effacement en décochant ou en quittant. L'élève comprend un seul modèle. |
| Photos | **Pas en V1** | Voir « Photos du coffre : pourquoi pas en V1 ». |
| Courbe du poids | Existait déjà (fiche de l'élève, depuis le 30/10) ; gardée, dans un « Bilan » qui enchaîne poids puis mensurations | Voir « Poids ». |

## Planification

### Données (migration 20261105000000_coach_planning.sql)

`public.coach_phases (id bigint identity, student_id, coach_id, name ≤ 40, goal, start_on date, weeks 1..52,
prog_name ≤ 40 | null, note ≤ 500, created_at, updated_at)`, clé étrangère vers `coach_links (student_id, coach_id)`
on delete cascade. RLS activée sans politique, aucun GRANT sur la table ni sur sa séquence (règle des projets
Supabase depuis le 30/10/2026 : une table `public` sans GRANT n'est pas exposée ; ici on révoque en plus tout ce que
les privilèges par défaut auraient donné). Contrainte d'exclusion `coach_phases_no_overlap` : extension `btree_gist`
dans le schéma `extensions`, proposée par Supabase (vérifié le 06/11/2026 sur la page officielle « Database ›
Extensions », supabase.com/docs/guides/database/extensions : « btree_gist, Support for indexing common datatypes in
GiST »). La RPC traduit `23P01` en `overlap` et une clé étrangère cassée (lien rompu pendant l'appel) en `not_found`.

| Fonction | Qui | Renvoie | Règles |
|---|---|---|---|
| `coach_plans()` | coach | `{ students: [{ student_id, phases }] }` | Tous mes élèves, même sans phase ; vide si je ne suis plus coach. Phases avec la note. |
| `student_plan()` | élève | `{ coach, phases: [{ name, goal, start, weeks, prog_name }] }` | Seulement mon coach actuel ; **jamais** la note, l'identifiant du coach ni celui des phases. |
| `coach_plan_save(student, phase_id, name, goal, start_date, weeks, programme, note)` | coach | phases de l'élève | `phase_id` null = création. `not_found` (pas mon élève, plus coach, phase d'un autre), `invalid_phase` (objectif, début avant 2020 ou dans plus de 2 ans, durée), `too_long`, `overlap`, `too_many` (30 phases), `rate_limited` (120 par heure). Textes nettoyés (caractères de contrôle, espaces, lignes vides). |
| `coach_plan_delete(student, phase_id)` | coach | phases de l'élève | Silencieux si la phase n'existe pas ; jamais limité. |

Toutes `security definer`, `search_path = ''`, utilisateur pris dans `auth.uid()`, `authenticated` seulement.
Rôle de coach retiré par l'administrateur : il ne lit ni n'écrit plus, l'élève voit encore son planning tant que
le lien existe.

### App

- **Coach** : Mes élèves › cellule « Planning » (nombre d'élèves en phase cette semaine) → `coach-planning` ;
  ligne « Mini cut · sem. 3/6 » (ou « Prochaine : Sèche, dans 5 jours ») sous chaque élève ; fiche d'un élève :
  groupe « Planification » (carte de la phase en cours, « Planning complet », « Ajouter une phase ») ;
  `coach-plan:UID` : frise proportionnelle de toutes les phases avec le jour présent, puis « En cours », « À venir »,
  « Terminées ». Une phase se touche pour la modifier.
- **Carte d'une phase** : pastille de l'objectif, « Semaine 3 sur 6 », une case par semaine (passées pleines, la
  semaine en cours entourée ; au-delà de 16 semaines, une barre), « Du 9 nov. au 20 déc. », programme, jours
  restants, note (coach seulement). Lue par VoiceOver en une phrase.
- **Feuille d'une phase** : objectif en pastilles (boutons radio, 44 pt), nom (proposé : l'objectif), début, durée
  avec − et + et la date de fin calculée en direct, programme, note. Enregistrer vérifie le chevauchement avant
  l'envoi ; une erreur (hors ligne, serveur) laisse la feuille ouverte avec la saisie. « Supprimer la phase »
  demande confirmation.
- **Élève** : Mon coach › « Ta phase » (ou « Ta prochaine phase ») et « Ensuite : … » ; cellule Mon coach de l'onglet
  Amis : « max · Mini cut, semaine 3 sur 6 ».
- **Serveur pas à jour** (`PGRST202`) : `plan.available = false`, rien ne s'affiche. Rien de lu encore : rien non
  plus. Dernier état gardé sur l'appareil (`mdlf_coach_plan`, par compte ; côté élève, seulement pour le coach qui
  l'a donné) pour l'afficher hors ligne.
- Relu après chaque `coachRefresh`, à l'ouverture du planning et de la vue d'ensemble.

### Note du coach et RGPD

La note porte sur l'élève : c'est une donnée personnelle le concernant, même si l'app ne la lui montre pas. Elle
reste privée dans l'app, mais l'élève peut l'obtenir par son **droit d'accès** (RGPD, art. 15) :
1. il écrit à l'adresse de contact de `privacy.html` en indiquant son pseudo ;
2. on vérifie que la demande vient bien du titulaire du compte (réponse depuis l'adresse du compte, ou message
   envoyé depuis l'app) ;
3. on extrait ses phases, notes comprises (requête de lecture, rôle postgres) :
   `select p.start_on, p.weeks, p.goal, p.name, p.prog_name, p.note, p.updated_at from public.coach_phases p
   where p.student_id = '<uuid de l'élève>' order by p.start_on;`
4. on lui envoie le résultat sous un mois (art. 12.3) et on le note dans le registre des demandes.
Les notes sont effacées avec le planning dès que le suivi s'arrête : il n'y a alors plus rien à transmettre.
La feuille demande de ne pas y écrire de données de santé (art. 9) ; le contrat des coachs le rappellera.

### Sécurité de l'appareil

`mdlf_coach_plan` (planning, notes du coach comprises, pour l'affichage hors ligne) et `mdlf_coach_share_m`
(empreinte du dernier envoi des mensurations) sont dans `CROSS_USER_CACHE_KEYS` (`js/data/account.js`) : effacés à
la déconnexion et à l'effacement des données ; `planReset(null)` efface aussi le planning. Après une reconnexion,
les mensurations repartent au prochain geste (case cochée, mesure saisie).

## Bilan : mensurations partagées (migration 20261105010000_partage_mensurations.sql)

Même modèle que le poids (`docs/COACH_V1.md`, « Partage avec le coach ») :
- **Consentement** : `coach_shares.kind` accepte `measures` ; une ligne par élève, pour le coach actuel, horodatée ;
  `private.share_kind_open` ouvre `weight` et `measures`. Décoché par défaut.
- **Données** : `coach_shared_measures (student_id, part, at, cm)`, séparées des séances, clé étrangère vers le
  consentement `(student_id, 'measures')` on delete cascade : décocher, quitter, être retiré, supprimer un compte
  efface tout, historique compris. Décocher le poids ne touche pas aux mensurations, et l'inverse.
- **Double barrière** : l'app n'envoie que si le serveur vient de dire « coché » ; le serveur refuse (`not_shared`)
  sans consentement actif.
- **Envoi** : `student_share_measures({ chest: [{ date, cm }], … })` remplace tout (miroir de `data.bodyMeasures`),
  dates ramenées au début du jour (une valeur datée avant 2000 ou dans le futur ne part pas, sinon le serveur
  refuserait tout l'envoi ; la saisie refuse ces dates), mesures connues seulement (les 10 clés de `BODY_MEASURES`), 10 à 250 cm, 400
  valeurs par mesure, 4000 en tout, 256 Ko ; 60 envois par heure. Envoyé au cochage, à chaque mensuration saisie,
  supprimée ou importée sur cet appareil, et à la relecture si cet appareil a déjà envoyé pour ce coach et que ses
  mensurations ont changé (empreinte `mdlf_coach_share_m`, même règle que les pesées : un second appareil sans
  mensurations n'écrase rien).
- **Lecture** : `coach_student_measures(student)` pour le seul coach consenti, encore coach : `{ shared, since,
  measures }`. Personne d'autre (autre coach, ami, autre élève, l'élève lui-même par cette fonction).
- **Serveur pas à jour** : `student_shares()` annonce les données qu'il accepte (`kinds`) ; sans `kinds`, l'app ne
  montre que le poids. `coach_student_measures` absente : la fiche n'a pas de groupe Mensurations.

App :
- Élève : Réglages › Partager avec mon coach : case « Mensurations » sous « Poids du corps », texte de ce que voit le
  coach (« la date et la valeur de chaque mensuration… Jamais tes photos »), « 3 mesures partagées depuis le 5 nov. ».
  Progrès › Mesures dit « Partagées avec ton coach » au lieu de « Privé » quand la case est cochée.
- Coach : fiche de l'élève, groupe « Mensurations » (nombre de mesures, date de la dernière, tour de taille depuis le
  début) → `coach-measures:UID` (dernière valeur de chaque mesure et écart depuis la première) →
  `coach-measure:UID:CLÉ` (courbe de Progrès, écart, historique, en lecture seule).

## Poids : la courbe existait

Vérifié avant d'écrire du code : depuis le 30/10 (migration 20261031300000), la fiche d'un élève qui partage son
poids montre la dernière pesée, la tendance sur 30 jours et la courbe (composant de Progrès, 90 pesées au plus,
bulle au toucher, description VoiceOver). Un coach qui ne la voit pas est dans l'un de ces cas : son élève n'a pas
coché « Poids du corps », il n'a saisi aucune pesée dans l'app (celles de Santé ne partent jamais), ou il n'en a
qu'une (la courbe en demande deux ; la dernière pesée s'affiche quand même). Rien à refaire côté serveur ; côté
écran, le poids est désormais suivi des mensurations dans le même bloc, et le planning est au-dessus.

## Photos du coffre : pourquoi pas en V1

Les photos de progression vivent dans le coffre (`docs/COFFRE_PHOTOS.md`) : chiffrées en AES-GCM avec une clé du
trousseau iCloud rendue seulement après Face ID, sur l'iPhone, jamais sur nos serveurs, et c'est écrit tel quel dans
l'app et dans la politique de confidentialité. Les envoyer au coach casserait cette promesse tant que ces trois
points ne sont pas réglés :

1. **Stockage** : un espace de fichiers privé (Supabase Storage, compartiment non public), un dossier par lien
   élève-coach, des URL signées de quelques minutes, une taille bornée (photo réduite à 1200 px comme dans le coffre)
   et un nombre borné par semaine ; effacement en cascade réel des fichiers (pas seulement des lignes) au retrait du
   consentement, au départ du coach et à la suppression du compte, par un déclencheur et une tâche de rattrapage.
2. **Chiffrement** : de bout en bout pour que nous ne puissions pas voir les photos. Il faut une paire de clés par
   coach (clé privée dans son trousseau, clé publique sur le serveur), chaque photo chiffrée sur l'iPhone de l'élève
   avec une clé à usage unique enveloppée pour le coach. Changement de téléphone du coach, coach qui perd sa clé,
   révocation : à concevoir et à tester comme le coffre. Sans ce chiffrement, ce sont des photos de corps, souvent
   en sous-vêtements, lisibles par quiconque accède au stockage : risque élevé (RGPD, données sensibles possibles,
   et règle 5.1.1 d'Apple sur les données de santé et forme).
3. **Consentement** : une case à part (« Photos »), jamais cochée avec les mensurations, photo par photo au moment
   de l'envoi (« Envoyer cette photo à max ? »), avec la liste de ce qui est parti et la possibilité de retirer une
   photo ; mention dans la politique de confidentialité et dans les conditions du coach (il ne les télécharge pas,
   ne les publie pas, notamment sur Instagram, sans un accord écrit séparé, voir les contrats des coachs partenaires).

À faire dans un chantier dédié (une build native est sans doute nécessaire pour la clé du coach dans le trousseau),
avec une relecture sécurité avant toute mise en ligne.

## Mise en production (à faire par Maxence, rien n'a été appliqué)

1. `supabase/migrations/20261105000000_coach_planning.sql`
2. `supabase/migrations/20261105010000_partage_mensurations.sql`
3. Puis l'OTA (une app à jour sur un serveur d'avant cache simplement ces fonctions ; une app d'avant sur un serveur
   à jour continue de marcher : `student_shares()` garde sa forme, `kinds` en plus).

Les deux sont dans `tests/sql/prod_order_test.sh` (ordre réel de la production, après les cinq du payant) et
`supabase/rollback/ORDRE.md`. Retours arrière : `supabase/rollback/20261105010000_partage_mensurations_down.sql`
puis `20261105000000_coach_planning_down.sql` ; celui des mensurations doit passer **avant** celui du partage du
poids (`20261031300000_partage_coach_down.sql`), qui supprime la table des consentements.

## Limites de la V1

- Pas de notification à l'élève quand le coach crée ou change une phase (il le voit à l'ouverture de Mon coach).
- Pas de glisser-déposer sur le planning : on touche une phase pour changer ses dates.
- L'élève ne reçoit pas l'identifiant des phases (séquence globale, rien à en déduire sur les autres élèves).
- Une phase n'est pas liée au programme envoyé (nom seulement) : l'élève ne peut pas l'ouvrir depuis la carte.
- Pas de rappel « bilan à faire » pour l'élève (par exemple chaque lundi) : il partage ce qu'il note.
- Les mensurations ne se synchronisent pas entre les appareils de l'élève : c'est l'appareil où il les note qui
  envoie (comme les pesées).
- Pas de photos (voir plus haut).
