# Parrainage : qui a amené qui, et ce qu'on lui doit

Deux sortes de parrains touchent une part du revenu **net** des abonnés qu'ils apportent :

- les **coachs** de l'app : tout élève qui rejoint un coach avec son code lui est rattaché. Règle
  unique (docs/CONDITIONS_COACH.md) : **20 % du net pendant les 12 premiers mois de chaque abonné, tant
  que le coach a lui-même un abonnement coach actif** ;
- les **partenaires** qui ne sont pas coachs (influenceurs, créateurs) : un code lisible créé à la main
  (« LUCAS »), que l'utilisateur saisit dans l'app. Taux réglable par code, 20 % par défaut, 12 mois.

Serveur : `supabase/migrations/20261031400000_parrainage.sql`. App : `js/data/referral.js` (appels et
logique pure), étape `referral` de `js/features/auth-flow.js`, groupe de l'écran Compte
(`js/features/account-ui.js`). Rapport : `tools/rapport-parrainage.mjs`. Tests :
`tests/sql/parrainage_test.sql`, `tests/unit/referral.mjs`, `tests/test_parrainage.py`.

## Une seule attribution par compte

`referral_attributions` a **une ligne au plus par compte** (unique sur `user_id`) : la première
attribution valable gagne, rien ne la change ensuite (aucune fonction ne la modifie ni ne la retire,
l'utilisateur n'a aucun accès direct). Pas de double attribution, donc pas de double comptage.

| Comment | Sorte | Délai | Où |
| --- | --- | --- | --- |
| Saisie d'un code partenaire (« Code d'un coach ou d'un ami ») | `partner`, source `code` | 30 jours après la création du compte | `referral_apply` |
| Adhésion à un coach (code d'invitation `coach_invites`, puis code unique du payant) | `coach`, source `coach` | aucun : l'élève s'abonne grâce au code du coach (−25 %) | déclencheur sur `coach_links` → `private.referral_attribute_coach` |
| Saisie du code permanent d'un coach dans « Code d'un coach ou d'un ami » | `coach`, source `code` | 30 jours | `referral_apply` → `private.referral_resolve_coach_code` |

Cas qui se croisent :

- **Déjà parrainé, puis rejoint un coach** : l'attribution d'avant reste ; le coach suit l'élève et
  l'élève garde son −25 % (payant), mais le coach ne touche rien sur lui. Dit dans les conditions.
- **Rejoint un coach, puis saisit un code** : « Ton compte a déjà un parrain » (sauf le même parrain : ok).
- **Quitte son coach, en rejoint un autre** : l'attribution reste au premier (elle ne suit pas le lien).
  À revoir si Maxence veut que la commission suive le coach actuel.
- **Coach qui est aussi partenaire** (son compte est `partner_user` d'un code actif, ex. un coach
  influenceur avec contrat négocié) : ses élèves sont attribués à son **code partenaire**, avec ses
  conditions à lui ; jamais deux lignes, jamais deux commissions. Son code partenaire et son code de
  coach mènent au même parrain.
- **Code d'invitation coach (`coach_invites`) et code unique du coach (payant)** : deux façons de
  rejoindre le même coach ; l'attribution passe par l'adhésion (`coach_links`), quelle que soit la
  façon. Si le payant crée l'adhésion sans `coach_links`, il appelle
  `private.referral_attribute_coach(élève, coach)` (sans effet si l'élève a déjà un parrain).
- **Élèves déjà liés à un coach avant la migration 20261031400000_parrainage.sql** : **pas de
  rattrapage rétroactif**, décidé le 31/10/2026. Le déclencheur ne joue qu'aux nouvelles adhésions
  (`after insert on coach_links`) ; les liens existants ne reçoivent aucune attribution. Raison : le
  seul coach actuel est le compte de démo, il n'y a aucune commission réelle à rattraper. Si un vrai
  coach avait des élèves liés avant la mise en ligne, il faudrait une migration de rattrapage
  explicite (`private.referral_attribute_coach` sur chaque lien, sans effet sur un élève déjà parrainé).

## Règles réglables

| Règle | Valeur | Où |
| --- | --- | --- |
| Délai de saisie d'un code | 30 jours | `private.referral_window()` (+ `REFERRAL_WINDOW_MS` dans l'app, affichage seulement) |
| Taux et durée des coachs | 20 %, 12 mois | `private.referral_coach_rate()`, `private.referral_coach_months()` ; exception pour un coach : `private.set_coach_terms(coach, taux, mois)` |
| Taux et durée d'un partenaire | 20 %, 12 mois par défaut | `private.make_partner_code(code, nom, taux, mois)` |
| Seuil de versement | 20 € | `private.referral_payout_min_cents()` |
| Essais de saisie | 10 par 24 h, échecs compris | `referral_apply` |
| Format d'un code partenaire | 3 à 20 lettres ou chiffres ; majuscules, espaces, tirets, points ignorés | `private.referral_code_norm`, `normalizeReferralCode` |

## Administration (éditeur SQL, rôle postgres)

```sql
-- Partenaire : créer ou mettre à jour (code, nom affiché, taux, mois, notes, compte dans l'app facultatif)
select private.make_partner_code('LUCAS', 'Lucas', 0.20, 12, 'Contrat signé le 05/11/2026');
-- Désactiver (plus de nouvelles saisies ; les comptes déjà parrainés restent)
update public.referral_partners set active = false where code = 'LUCAS';
-- Exception pour un coach (null : règle commune)
select private.set_coach_terms('<uuid du coach>', 0.25, 12, 'Accord du …');
-- Noter un virement fait (centimes) : le rapport en déduit le reste dû
insert into public.referral_payouts (kind, coach_id, amount_cents, reference) values ('coach', '<uuid>', 3150, 'Facture 2026-004');
insert into public.referral_payouts (kind, partner_code, amount_cents, reference) values ('partner', 'LUCAS', 4200, 'Facture L-12');
```

## Sécurité

- Tables `referral_partners`, `referral_coach_terms`, `referral_attributions`, `referral_payouts` :
  RLS sans politique, aucun GRANT à anon, authenticated ni service_role ; tout passe par des fonctions
  `security definer` à `search_path` vide.
- Un utilisateur ne lit que **son** parrain (nom du partenaire ou pseudo du coach, date). Jamais la
  liste des codes, les taux, les notes, les virements ni les attributions des autres.
- Devinette : un code inconnu répond `{ ok: false, error: 'invalid_code' }` (pas une erreur Postgres,
  qui annulerait le compteur) ; chaque essai compte. Les codes partenaires sont publics (Instagram) :
  la limite empêche surtout d'énumérer la liste.
- anon : rien. Rapport et parrain d'un compte : service_role seulement.
- Suppression d'un compte (élève ou coach) : le lien passe à null ; il reste une ligne anonyme, pour
  que les chiffres des mois déjà payés restent vérifiables. Un coach supprimé disparaît du rapport.

## Contrat des fonctions

| Fonction | Rôle | Réponse |
| --- | --- | --- |
| `referral_state()` | authenticated | `{ referrer: { name, since } \| null, can_enter, until }` |
| `referral_apply(code)` | authenticated | `{ ok: true, referrer }` ; `{ ok: false, error: 'invalid_code' }` (inconnu, inactif, le sien) ; erreurs P0001 `already_referred`, `too_late`, `rate_limited`, `not_found`. Même parrain redonné : `ok: true`. |
| `referral_report(from_month, to_month)` | service_role | une ligne par mois et par parrain, voir ci-dessous |
| `referral_for_user(uid)` | service_role | `{ kind, code, coach_id, name, rate, months, since }` ou null |

## Rapport mensuel (CSV)

```sh
SUPABASE_URL=https://<projet>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<clé> \
  node tools/rapport-parrainage.mjs --mois 2026-11 --sortie parrainage-2026-11.csv
```

`--de 2026-01 --a 2026-12` pour plusieurs mois ; `--json fichier` relit une réponse enregistrée. La clé
reste dans l'environnement. Le CSV (« ; », virgule décimale) ne contient aucune donnée personnelle
d'abonné. À garder chaque mois avec le relevé Apple du même mois : c'est la pièce montrée au parrain.

Colonnes : mois, type (coach ou partenaire), code, coach_id, nom, actif, taux, durée, nouveaux comptes,
comptes au total, abonnés actifs, revenu net, abonnement coach actif, commission du mois, déjà versé,
reste dû, à verser (« oui » dès 20 € cumulés, sinon « non, reporté »). Une case vide veut dire
« inconnu » (paiement dans une autre devise, voir « Branchement sur le payant »), jamais « 0 € ».

## Formule

```
revenu net (par abonné et par mois) = prix payé TTC − TVA − part d'Apple  = « proceeds » Apple
commission du mois = Σ revenu net des abonnés du parrain dans leurs 12 premiers mois × taux
                     (coach : 0 si son propre abonnement coach n'était pas actif ce mois-là)
reste dû = Σ commissions depuis le début − Σ virements faits ; versé dès qu'il atteint 20 €
```

- Mois remboursé ou non payé : pas de revenu net, donc pas de commission ; un remboursement après coup
  sort du net du mois où il est remboursé.
- TVA du pays de l'acheteur (France 20 % : HT = TTC ÷ 1,2) ; part d'Apple sur le HT : 15 % (Small
  Business Program, ou abonné de plus d'un an), sinon 30 %. Le plus simple et le plus juste : prendre
  les proceeds du relevé App Store Connect, déjà nets.
- Exemple, abonnement particulier d'un élève de coach à 4,89 € TTC (−25 %), France, 15 % :
  4,89 ÷ 1,2 = 4,075 € HT ; Apple 0,61 € ; net 3,46 € ; commission 20 % = 0,69 € par mois. Il faut donc
  environ 29 abonnés-mois pour atteindre le seuil de 20 €.
- « 12 premiers mois » : comptés depuis le premier paiement de l'abonné (pas depuis l'attribution).

## Branchement sur le payant (`20261101000000_parrainage_payant.sql`)

**Une seule source de vérité** pour « qui a amené ce compte » : `referral_attributions`. Le
rattachement élève → coach que les tarifs du payant avaient prévu (`coach_origins`) a été retiré avant
sa mise en production : `coach_join` crée la ligne de `coach_links`, et le déclencheur
`coach_links_referral` attribue l'élève (au coach, ou au code partenaire d'un coach partenaire).

**Paiements** : `public.subscription_payments`, une ligne par transaction d'Apple (achat, renouvellement,
changement de palier), écrite par `public.srv_subscription_payment` (clé serveur) depuis `verify-purchase`
(après l'écriture de l'accès, jamais bloquant) et `appstore-notify` (après le droit d'accès : un échec
répond 500, Apple réessaie, l'accès est déjà à jour). Prix payé en millièmes de la devise, devise, pays de
la boutique (`storefront`), essai gratuit, environnement, date de remboursement. Noté seulement pour un
compte retrouvé (transaction d'origine connue ou `appAccountToken` d'un compte existant) : rien pour un
compte supprimé. Le parrain est rattaché par la base, même quand le code est saisi après le premier
paiement. RLS fermée, aucun GRANT. Compte supprimé : paiements sans parrain effacés, ceux d'un compte
parrainé gardés anonymes (sans compte ni identifiant d'Apple).

| Accroche | Version branchée |
| --- | --- |
| `private.referral_resolve_coach_code(code)` | code **permanent** d'un coach validé → son compte (les codes de 7 jours servent seulement à rejoindre) |
| `private.referral_subscribers(kind, code, coach, mois)` | comptes attribués dont une période comptée (ci-dessous) couvre une partie du mois |
| `private.referral_net_cents(kind, code, coach, mois, months)` | Σ revenu net des périodes comptées achetées dans le mois − celui des périodes remboursées dans le mois ; coach : seulement ce qui a été acheté un mois où son abonnement coach était actif |
| `private.referral_coach_active(coach, mois)` | une période d'abonnement coach de Production, non remboursée, couvre une partie du mois (essai gratuit d'Apple compris) |

Règles du calcul :

- **12 premiers mois d'abonnement payé** : les périodes payées du compte s'additionnent dans l'ordre
  (mois = 1, an = 12) depuis son premier paiement de Production ; une période qui dépasse la durée ne
  compte que pour sa part (6 mensualités puis un annuel : la moitié de l'annuel). Une période remboursée
  garde sa place (les relevés passés ne bougent pas).
- **Pas de commission rétroactive** : une période payée avant l'adhésion à un coach consomme ses mois,
  mais ne rapporte rien au coach. Un code saisi (30 jours après la création du compte) compte depuis le
  début.
- **Coach inactif** : rien sur ce qui est acheté un mois sans abonnement coach actif, et un remboursement
  n'est repris que sur ce qui a été versé (achat d'un mois actif), même s'il tombe un mois inactif.
  `public.referral_report` est réécrit en conséquence (il ne met plus lui-même la commission d'un coach
  inactif à 0).
- **Revenu net** d'un paiement = prix TTC ÷ (1 + TVA du pays) × (1 − part d'Apple). Part d'Apple : **30 %**,
  ou 15 % pour les paiements faits depuis l'adhésion au Small Business Program, à noter le jour où Apple
  la confirme :

  ```sql
  create or replace function private.referral_apple_small_business_since() returns timestamptz
    language sql immutable set search_path = '' as $f$ select '2026-12-01 00:00+00'::timestamptz $f$;
  ```

  TVA : taux normaux de la zone euro (`private.referral_vat_rate`). **Autre devise ou pays hors liste :
  inconnu** (case vide, et le cumul du parrain devient inconnu) : le relevé d'App Store Connect fait foi.
  C'est une estimation : contrôler chaque mois avec le relevé d'Apple avant de verser.
- Jamais comptés : Sandbox (TestFlight, équipe d'examen d'Apple), essai gratuit, prix nul. Mois en UTC.
- Limites connues : un remboursement annulé par Apple (`REFUND_REVERSED`) n'est pas suivi ; un
  remboursement arrivé après la suppression du compte n'est plus retrouvé.
- **Code de coach saisi dans « Code d'un coach ou d'un ami »** : il parraine (le coach touche sa part),
  mais ne fait pas rejoindre le coach ; l'app le rappelle (« rejoins-le aussi : Amis › Rejoindre un
  coach »), pour le suivi des séances et l'offre élève.
- À la validation d'un abonnement Apple, `public.referral_for_user(uid)` donne toujours le parrain.
- Vérifié par `tests/sql/parrainage_payant_test.sql` (et `tests/sql/prod_order_test.sh` pour l'ordre de
  mise en production).

## Lien profond (plus tard)

`mdlf.app/r/CODE` n'est pas fait : l'app n'a pas de liens universels (Associated Domains dans
`App.entitlements`, fichier `apple-app-site-association` sur mdlf.app, écoute de `appUrlOpen`), ce qui
demande une nouvelle version sur l'App Store. Le jour venu : garder le code reçu sur l'appareil et le
proposer prérempli dans l'étape du code ; sans l'app, la page renvoie vers l'App Store.

## Obligations légales (France)

- **Contrat écrit obligatoire** dès que ce qu'on verse à un même coach ou partenaire atteint **1 000 € HT
  sur une année** (loi n° 2023-451 du 9 juin 2023 sur l'influence commerciale, article 8 ; seuil du
  décret n° 2025-1137 du 28 novembre 2025, en vigueur depuis le 1er janvier 2026), avec les mentions de
  l'article 8 (identité des parties, missions, rémunération, droit applicable…). Sous le seuil, les
  conditions acceptées dans l'app font foi ; un écrit signé reste conseillé.
- **Mention « Publicité » ou « Collaboration commerciale »** claire sur chaque post, story ou vidéo qui
  parle de l'app (article 5 de la même loi).
- **Statut pour être payé** : le parrain facture la commission (micro-entreprise ou société, numéro
  SIRET) ; pas de virement sans facture. Il déclare lui-même ces revenus.
- Confidentialité : `privacy.html` (FR et EN), section « Code de parrainage » : code saisi ou adhésion
  à un coach conservés avec le compte pour rémunérer cette personne, qui ne reçoit que des nombres.
