# Import d'un programme aidé par l'IA

Décision de Maxence (27/11/2026) : l'import utilise **d'abord le moteur gratuit, sur le téléphone**
(docs/IMPORT_PROGRAMME.md). Claude ne vient **qu'en renfort** : quand le moteur hésite, ou si le coach touche « Lire
avec l'aide de l'IA ». Les crédits viennent du forfait de Maxence (200 $ par mois) ; un espace de travail « MDLF
Training » de la Console Anthropic, avec sa propre limite de dépense, porte la clé.

Objectif : **le moins de crédits possible, au plus près de 100 % de lignes justes.**

## Le circuit

1. **Le moteur lit** (planParse). `planAiAdvice` (js/data/plan-ai.js) décide :
   - rien n'est proposé si tout est sûr (simple lien neutre « Lire avec l'aide de l'IA » en bas de l'écran) ;
   - bouton plein, en haut, si le moteur hésite : au moins une ligne « pas comprise », ou deux douteuses, ou une sur
     cinq (lignes « à vérifier », et lignes non reprises qui portent un nombre : un exercice peut-être manqué) ;
   - **mode lines** : seulement les lignes douteuses, chacune avec le titre de sa séance, la ligne d'avant et
     d'après (40 au plus) ; **mode plan** : tout le texte quand plus de la moitié est douteuse ; **mode image** : la
     photo, seulement sur choix et second accord.
2. **Accord à chaque envoi** (règle 5.1.2(i) d'Apple, docs/REVUE_APPLE.md 6.8) : feuille qui nomme Anthropic (Claude),
   dit ce qui part et ce qui est gardé. Le nom ou le pseudo d'un élève écrit dans le texte est masqué (`planAiRedact`).
3. **La fonction serveur `plan-import-ai`** (supabase/functions/plan-import-ai) :
   - `index.ts` : vrai appelant (jeton relu, 401 sinon), vrai magasin (SQL), client du SDK officiel
     `@anthropic-ai/sdk` 1.8.0, clé `ANTHROPIC_API_KEY` (Deno.env), adresse et journal du SDK fixés dans le code ;
   - `core.ts` : le déroulé (taille, validation, cache, réservation, appel, règlement), testé sans réseau ;
   - `plan-ai-policy.js` : entrée, consigne, schéma, contrôle des nombres, brouillon, coût (logique pure) ;
   - `library.js` : les 191 fiches de la bibliothèque, générées par `node tools/plan-import-ia/bibliotheque.mjs`
     (un test unitaire refuse une copie périmée).
4. **Le résultat** revient dans le même écran « Vérifier » (`planAiApplyLines`, `planAiAdopt`), mêmes niveaux
   (sûr, à vérifier, pas compris) ; « Lu avec l'aide de l'IA » sous une ligne relue. À l'enregistrement, chaque
   exercice choisi par l'IA et gardé par le coach entre dans le **dictionnaire appris** (`planAiLearnable`) : le
   moteur gratuit le refait seul la fois suivante.

Hors ligne, sans compte, quota du jour, plafond du mois, fonction absente ou en panne : un message clair, et le
résultat du moteur reste.

## Justesse : ce que le serveur refuse

- **L'exercice est un numéro de fiche** (`exercise_id`) de la bibliothèque ou null. Un numéro plutôt qu'une
  énumération des 191 noms : le schéma passe de 4 358 tokens à quelques centaines (mesuré avec `count_tokens`).
  Numéro inexistant : inconnu.
- **Chaque nombre doit être écrit dans la ligne**, en chiffres, en lettres (« vingt-cinq », « dix-huit ») ou en
  durée (« 1'30 », « 2 min », « une minute trente », « 1:30 ») ; sinon il est retiré et la ligne passe « à vérifier ».
  En mode plan, un exercice peut couvrir jusqu'à 4 lignes qui se suivent (`line_end` : « Chin-up » puis « 8 reps »).
- Bornes de l'app : séries 1 à 10, reps 1 à 100, repos 0 (seulement s'il est écrit) ou 10 à 600 s, charge, %, RPE,
  RIR, tempo écrit.
- Consigne : ne rien inventer ; une ligne illisible est « pas comprise », jamais devinée ; un doute = « à vérifier ».

## Modèle et cascade

**Claude Haiku 5.5** (`claude-haiku-5-5`) lit tout, `effort: 'low'`, sortie structurée (`output_config.format`,
schéma strict). C'est le modèle le moins cher de la gamme (0,10 $ / 0,50 $ par million de tokens en entrée / sortie,
lecture du cache 0,01 $) ; la tâche est de l'extraction contrainte par un schéma et contrôlée par le serveur, le cas
pour lequel Anthropic le recommande. `max_tokens` large (4 000 en mode lines, 12 000 en plan) : la réflexion,
active d'office sur ce modèle, compte dedans, et seul ce qui est produit est payé.

**Claude Sonnet 5.5** (`claude-sonnet-5-5`, 2 $ / 10 $) ne reçoit que les lignes dont la réponse **échoue à la
validation** (nombre absent, borne, fiche inexistante ; 30 lignes au plus), ou une réponse entière inutilisable. Pas
de montée sur une réponse « incertaine » : mesuré plus cher et moins juste (ci-dessous). Une ligne incertaine reste
« à vérifier » pour le coach. Pas de bêta de repli côté serveur (`fallbacks`) : un refus garde le résultat du moteur,
et le coût resterait calculé sur le modèle réellement servi.

Chaque appel : délai de 55 s, **aucune nouvelle tentative** (`maxRetries: 0`), réservé au pire cas puis réglé au coût
réel. Le modèle n'est jamais Opus.

## Coûts et abus

Migration `20261130010000_import_ia.sql` (retour arrière `supabase/rollback/20261130010000_import_ia_down.sql`),
**non appliquée** :

- `plan_ai_reserve` : 20 imports aidés par jour et par compte (jour de Paris ; la cascade d'un import compte une
  fois ; 4 appels au plus par import), puis le **plafond du mois** : dépense réglée + réservations au pire cas,
  convertie en euros au taux prudent 1 $ = 1 €, jamais au-delà de **15 €** (`private.plan_ai_settings`) ;
- `plan_ai_settle` : coût réel calculé **par la base**, par modèle (`private.plan_ai_prices`, mêmes prix que
  `PRICES` du code, vérifié par un test), à partir des tokens facturés : entrée, sortie (réflexion comprise),
  écriture et lecture du cache ; un appel coupé sans tokens reste compté au pire cas ;
- `plan_ai_cache_get` / `plan_ai_cache_put` : cache de résultats par empreinte SHA-256 du texte normalisé (par ligne
  en mode lines, partagé ; par plan et par compte en mode plan), 30 jours ; la valeur ne contient que des numéros
  (lignes, fiches, séries, reps), **jamais le texte**. Les photos ne sont pas mises en cache ;
- tables dans `private`, fonctions exécutables seulement par `service_role`.

Le prompt caching d'Anthropic porte sur la consigne et la bibliothèque (préfixe identique, environ 8 000 tokens),
pour Haiku seulement : Sonnet est appelé trop rarement pour que l'écriture du cache (1,25 fois le prix) se rembourse.

## Prix (vérifiés le 27/11/2026)

https://platform.claude.com/docs/en/about-claude/pricing : Haiku 5.5 (prompt de moins de 100 000 tokens) 0,10 $
entrée, 0,125 $ écriture du cache 5 min, 0,01 $ lecture, 0,50 $ sortie ; Sonnet 5.5 2 $, 2,50 $, 0,10 $, 10 $.

## Mesure (27/11/2026, en local, clé de l'espace « MDLF Training »)

`node tools/plan-import-ia/mesure.mjs` lance `tools/plan-import-ia/serveur.ts` (vrai cœur, vrai client, magasin en
mémoire, plafond de campagne de 3 $ tenu d'un lancement à l'autre) et rejoue ce que fait l'app. Résultats détaillés
dans `~/.local/share/mdlf/import-ia/` (jamais dans le dépôt). **Dépense de toute la campagne : 2,84 $.** Une ligne est
juste si exercice, prescription, séance et superset sont justes (`scorePlan`) ; une ligne inventée compte fausse.

Corpus réel (tests/fixtures/plans/reels, branche `corpus-reel`) : tableaux blancs de CrossFit, carnets, captures
d'applis, PDF, et 90 dictées réelles reconnues par SFSpeechRecognizer (dont des voix de synthèse : texte parfois
illisible même pour un humain, « quatre séries de ligne avec Domi reco »). L'aide y est proposée à chaque import.

| Variante | Imports | Moteur seul | Final | $ par import | Appels Sonnet |
|---|---|---|---|---|---|
| Haiku seul, texte (Vision, pdf.js, dictées) | 112 | 8,8 % | 19,0 % | 0,0009 | 0 |
| Haiku seul, **photo envoyée** | 13 | (Vision : 8,2 %) | **32,9 %** | 0,0015 | 0 |
| Cascade « doute » (1re mesure : monte aussi sur incertain) | 112 | 8,8 % | 17,8 % | 0,0213 | 107 |
| Cascade « validation » (réglage retenu), documents | 22 | 6,8 % | 24,6 % | 0,0063 | 4 |
| Même plan importé une 2e fois (cache de résultats) | 112 | | identique | **0** | 0 |

Corpus écrit (tests/fixtures/plans : plans écrits à l'aveugle, photo et tableau photographié simulés), réglage
retenu :

| | Imports | Sans aucun modèle | Moteur seul | Final | $ par import |
|---|---|---|---|---|---|
| propre | 18 | 83 % | 96,1 % | 96,1 % | 0,0001 |
| photo (labo) | 18 | 44 % | 78,9 % | 81,5 % | 0,0003 |
| tableau | 10 | 70 % | 99,2 % | 99,2 % | 0,0020 |
| photo-tableau (labo) | 10 | 50 % | 92,2 % | 95,3 % | 0,0039 |
| **tout** | 56 | **62,5 %** | 89,7 % | **91,0 %** | **0,0012** |

(Arrêté à 56 cas sur 98 par le plafond de la campagne ; sur les 98, le moteur seul n'appellerait aucun modèle dans
57 % des imports, et enverrait 2 ou 3 lignes sinon.) Deux passes identiques diffèrent de 1 à 2 points : les
échantillons sont petits.

Lecture : sur un plan propre, Claude n'est presque jamais appelé ; quand il l'est, il ne relit que 2 ou 3 lignes
pour 0,0003 $ environ. Le gros gain est sur les photos manuscrites ou les tableaux blancs, **surtout avec la photo**
(32,9 % contre 16 à 19 % à partir du texte lu par Vision). La montée vers Sonnet coûte environ 0,02 $ par appel
(8 600 tokens d'entrée), 20 fois un import Haiku.

## Coût estimé par import aidé

- **Texte, quelques lignes douteuses** (cas courant) : 0,0003 à 0,0008 $ ;
- **texte entier** (mode plan) : 0,0015 à 0,002 $ ;
- **avec la photo** : environ 0,0015 $ ;
- **si une ligne monte à Sonnet** : environ 0,02 $ de plus (un import sur cinq sur les documents difficiles, presque
  jamais sur un plan propre).

Avec le plafond de 15 € par mois, cela fait plusieurs milliers d'imports aidés ; le quota de 20 par jour et par
compte empêche un seul compte de le vider.

## Recommandation de réglage

1. Haiku 5.5 seul en premier niveau, `effort: 'low'`, pour tout (texte et photo).
2. Montée vers Sonnet 5.5 **seulement sur échec de la validation** (réglage par défaut), jamais sur l'incertitude.
3. Cache de résultats et prompt caching de Haiku allumés ; pas de cache d'écriture pour Sonnet.
4. Mettre en avant « Envoyer la photo pour une meilleure lecture » quand l'import vient d'une photo (toujours avec
   le second accord) : c'est là que l'IA apporte le plus.
5. Garder les seuils de proposition tels quels (57 à 62 % des imports d'un plan écrit n'appellent aucun modèle).

## Contrôles

- `node tests/unit/run.mjs` : `tests/unit/plan-import-ai.mjs` (entrée, nombres, schéma strict, brouillon, coût,
  bibliothèque à jour ; côté app : proposition, corps envoyé sans nom, fusion, apprentissage) et la garde 401
  (`tests/unit/auth-guard.mjs`, cœur séparé) ;
- `deno test` : `tests/deno/plan_import_ai.test.ts`, faux client et faux magasin, sans réseau (refus sans jeton,
  quota, plafond, taille, validation, cascade, cache sans texte, photo jamais gardée, aucune fuite de la clé) ;
- `bash tests/sql/run.sh` (`import_ia_test.sql`) et `bash tests/sql/import_ia_rollback_test.sh` ;
- E2E : `t_aide_ia` dans `tests/test_import_programme.py` (fausse fonction, clair et sombre).

## À déployer (rien ne l'est)

1. Maxence : appliquer la migration `20261130010000_import_ia.sql` (retour arrière prêt) ;
2. le secret : `supabase secrets set ANTHROPIC_API_KEY=…` (clé de l'espace « MDLF Training », limite de dépense de
   la Console à 20 $ par mois) ;
3. la fonction : `supabase functions deploy plan-import-ai` (`verify_jwt = false` dans config.toml, jeton vérifié
   dans le code) ;
4. la build TestFlight (action `pimp-ai` dans `features.json`, `programme.import-aide-ia` à ajouter à
   `store/derniere-build.json` à l'approbation) ;
5. App Store Connect : App Privacy (docs/revue/SOUMISSION.md, section 5) et la note d'examen (docs/REVUE_APPLE.md,
   section 2, « AI help »).

Ordre : migration, secret, fonction, puis la build. Avant la fonction, l'app dit « Aide de l'IA indisponible » (404).
