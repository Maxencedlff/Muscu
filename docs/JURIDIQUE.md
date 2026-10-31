# Pages juridiques de MDLF Training

Préparées le 31/10/2026 (branche `nuit-legal`), sur la base du payant (tarifs du 30/10). Statut de
l'éditeur : **Maxence de La Fouchardière, entrepreneur individuel (EI), micro-entreprise**, SIREN
104 499 660, 34 rue du Plateau, 78210 Saint-Cyr-l'École, franchise en base de TVA. Contact public :
contact@mdlf.app (adresse déjà utilisée dans le dépôt). **Brouillons à faire relire** (par un juriste
avant la mise en ligne payante si possible) : rien n'est publié tant que la branche n'est pas fusionnée.

## Les pages
Pages statiques à la racine du dépôt, une seule feuille de style (`legal.css`, clair et sombre, noir pur),
**aucun script** (la CSP de mdlf.app n'autorise que le script de `web-public/index.html`). Chacune a le
texte français puis une version anglaise (`#en`), le français prévaut. Publiées sur mdlf.app par le job
`deploy` de `.github/workflows/tests.yml` (copie dans `web-public/`).

| Page | Contenu |
|---|---|
| `mentions-legales.html` | Éditeur EI (nom, adresse, SIREN, SIRET, RNE, TVA, téléphone, directeur de publication), hébergeurs (Vercel, Supabase, Resend), vendeur des abonnements (Apple Distribution International), médiateur, signalement, propriété, santé. LCEN art. 1-1 ; mention « EI » (art. L526-22 du Code de commerce). |
| `cgu.html` | Conditions d'utilisation : complètent le **contrat de licence standard d'Apple (EULA)**, lié en tête. Compte, Amis et coach (15 ans), règles de la communauté, contenus, suspension motivée, santé, disponibilité, responsabilité, modification (préavis de 30 jours), droit applicable. |
| `cgv.html` | Conditions de vente des abonnements : vente par Apple (mandataire ; commerçant officiel ADI), ce que donne l'abonnement, **grille des prix** (identique à `docs/PAYANT_V1.md`, vérifiée par `tests/unit/juridique.mjs`), offre élève, essai de 3 mois avec moyen de paiement, renouvellement et changement de formule, **rétractation chez Apple** (14 jours, souscription initiale), **résiliation par Apple**, **politique de remboursement** (`#remboursement`, tout passe par reportaproblem.apple.com), codes, réclamation, **médiation** (`#mediation`), droit applicable. |
| `privacy.html` | Mise à jour : mentions de l'éditeur professionnel (plus « particulier non professionnel »), responsable du traitement et droits, liens vers les trois pages, section **Lettre d'information** (`#newsletter`, FR et EN), courriel de connexion qui ne sert plus « jamais » mais « jamais à de la publicité ». |

## Liens depuis l'app
Une seule liste d'adresses : `js/data/legal-links.js` (`LEGAL_URLS`).
- **Réglages › Informations légales** : Confidentialité, Conditions d'utilisation, Conditions de vente,
  Mentions légales (ouvertes dans Safari).
- **Écran d'abonnement** (règle 3.1.2) : « Conditions d'utilisation » (cgu.html, qui renvoie à l'EULA
  d'Apple), « Conditions de vente » (nouveau), « Confidentialité ».
- **Compte › Lettre d'information** : lien Confidentialité vers `privacy.html#newsletter`.
- Les builds déjà installées ouvrent encore `privacy.html#mentions` : l'ancre est gardée.

## Emplacements à compléter avant la mise en ligne
Marqués en jaune dans les pages (`<span class="a-completer">`). `tests/unit/juridique.mjs` vérifie que
chacun est listé ici.

| Emplacement | Pages | Quoi mettre |
|---|---|---|
| À COMPLÉTER : nouveau SIRET en cours d'attribution | mentions-legales.html | Le SIRET (14 chiffres) dès qu'il est attribué. |
| TO COMPLETE: new SIRET being assigned | mentions-legales.html (EN) | Même SIRET. |
| À VÉRIFIER : numéro RCS si l'activité y est inscrite | mentions-legales.html | Vérifier sur l'avis de situation (INSEE) ou le guichet unique : si l'activité est commerciale et inscrite au RCS, mettre « RCS Versailles … » ; sinon retirer la mention. |
| À COMPLÉTER : numéro de téléphone | mentions-legales.html | Un numéro joignable (exigé pour un professionnel : LCEN et article L221-5 du Code de la consommation). Une ligne dédiée (seconde ligne, numéro virtuel) évite de publier le numéro personnel. |
| TO COMPLETE: phone number | mentions-legales.html (EN) | Même numéro. |
| À COMPLÉTER : téléphone de l'hébergeur | mentions-legales.html | Téléphone de Vercel Inc. tel que Vercel le publie (non trouvé sur une source officielle le 31/10/2026 ; un numéro circule sur des sites tiers, non vérifié). |
| À COMPLÉTER : nom du médiateur, adresse postale, site internet et adresse de saisie en ligne | cgv.html, mentions-legales.html | Voir `docs/MEDIATEUR.md` (recommandation : CM2C). |
| TO COMPLETE: chosen mediator | cgv.html et mentions-legales.html (EN) | Même médiateur. |
| À COMPLÉTER : date de mise en ligne | cgu.html, cgv.html | Date d'entrée en vigueur, le jour où les pages et le payant sont publiés. |

## Choix faits (les plus sûrs et les plus simples)
- **EULA** : on garde le **contrat standard d'Apple** (pas de contrat personnalisé dans App Store Connect),
  complété par nos CGU. Dans App Store Connect, laisser « Contrat de licence standard » et mettre dans la
  description de l'app les liens des Conditions d'utilisation (EULA d'Apple ou cgu.html) et de la
  Confidentialité (voir `docs/REVUE_APPLE.md`).
- **Rétractation et remboursement** : décrits comme ce qu'Apple applique (Conditions générales des services
  multimédias d'Apple, mise à jour du 14/09/2026), avec renvoi vers ces conditions qui priment ; aucun
  engagement de remboursement direct, impossible techniquement.
- **Prix** : grille France TTC, TVA collectée par Apple ; « TVA non applicable, art. 293 B du CGI » pour
  les factures propres de l'éditeur.
- **Tutoiement** comme dans tout le reste de l'app et de `privacy.html`.
- **Pas de plateforme européenne RLL** (fermée le 20/07/2025).

## À faire hors du code (Maxence)
- Statut de **commerçant (trader) au titre du DSA** dans App Store Connect (Business › statut de
  commerçant) : adresse, téléphone et e-mail affichés sur la fiche de l'App Store dans l'UE ; les mêmes
  que dans les mentions légales.
- Adhésion au médiateur (`docs/MEDIATEUR.md`).
- Relecture des quatre pages, puis fusion et publication (le job `deploy` les met en ligne avec le site).
