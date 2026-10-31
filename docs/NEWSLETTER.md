# Lettre d'information (newsletter) : contrat entre l'app et le serveur

Préparé le 31/10/2026 (branche `nuit-legal`). **L'inscription et la désinscription sont codées ; l'envoi
n'est pas branché** : aucune lettre ne part tant que Maxence n'a pas construit et validé le service
d'envoi décrit à la fin.

## Règles
- **Consentement explicite** (RGPD art. 4.11, 6.1.a et 7 ; article L34-5 du Code des postes et des
  communications électroniques pour la prospection par e-mail) : un interrupteur **éteint par défaut**,
  dans Réglages › Compte › Lettre d'information, sous le texte exact de ce qui est accepté. Rien n'est
  coché d'avance, ni à la création du compte, ni par un achat, ni par le coach. Aucune autre entrée.
- **Compte obligatoire** : l'adresse utilisée est celle du compte (`auth.users.email`), lue au moment
  de l'envoi, jamais recopiée. Pas de collecte d'adresse sans compte.
- **Compte sans adresse** (créé seulement avec Apple : l'app ne demande pas l'e-mail à Apple,
  `requestedScopes = []` dans `AccountPlugin.swift`) : **inscription refusée** (`no_email`), pour ne
  jamais enregistrer un consentement qu'on ne pourrait pas honorer. L'écran Compte le dit, interrupteur
  éteint et désactivé : « Ajoute une connexion Google ou e-mail à ton compte pour recevoir la lettre. »
  Dès qu'une adresse est reliée (Google ou e-mail), l'état est relu et l'inscription devient possible.
  Une inscription existante reste toujours retirable.
- **Horodatage par le serveur** : `consented_at = now()` ; l'appareil n'envoie que la **version du texte**
  (`consent_version`), jamais de date.
- **Désinscription toujours possible et immédiate** : l'interrupteur, le lien de chaque e-mail (prévu)
  ou un e-mail à contact@mdlf.app. Elle n'est jamais limitée en nombre d'appels et **supprime la ligne**
  (aucune donnée gardée ensuite). Supprimer le compte la supprime aussi (`on delete cascade`).
- Inscription limitée à 20 par compte et par 24 h (`private.rate_limit_window`, action
  `newsletter_subscribe`) ; la désinscription ne l'est pas.

## Texte du consentement (versions)
Le texte vit dans `js/data/newsletter.js` (`NEWSLETTER_CONSENT_TEXT`), montré sous l'interrupteur et lu
par VoiceOver (`aria-describedby`). **Changer le texte = nouvelle version** : ajouter une ligne ici et
monter `NEWSLETTER_CONSENT_VERSION` (`tests/unit/juridique.mjs` vérifie que le texte en cours figure ici).

| Version | Depuis | Texte exact |
|---|---|---|
| v1 | 31/10/2026 (pas encore publiée) | Je veux recevoir par e-mail la lettre d'information de MDLF Training (nouveautés de l'app, au plus une par mois). Je peux me désinscrire à tout moment, ici ou par le lien de chaque e-mail. |

## Serveur (`supabase/migrations/20261031230000_newsletter.sql`)
- `public.newsletter_subscriptions (user_id pk → auth.users on delete cascade, consented_at, consent_version
  'vN', source 'app', unsubscribe_token uuid unique)`. RLS activée **sans politique**, aucun GRANT (ni
  `authenticated`, ni `anon`, ni `service_role`) : tout passe par les fonctions.
- RPC du compte connecté (`authenticated` seulement, security definer, `search_path = ''`, `auth.uid()`) :

| Fonction | Renvoie | Règles |
|---|---|---|
| `newsletter_state()` | `{ subscribed, consented_at, version, has_email }` | `not_found` sans session. `has_email` : le compte a une adresse non vide (`private.newsletter_has_email`). |
| `newsletter_subscribe(consent_version)` | même forme | `no_email` (compte sans adresse), `invalid_version` (format `v` + 1 à 3 chiffres), `rate_limited` (20 / 24 h), `not_found`. Réinscription : nouvel horodatage, même ligne. |
| `newsletter_unsubscribe()` | même forme | Supprime la ligne. Jamais limitée. |

- Préparé pour le service d'envoi (`service_role` seulement, jamais l'app) :
  - `newsletter_recipients()` → `(user_id, email, consent_version, unsubscribe_token)` : inscrits ayant une
    adresse (une ligne d'un compte qui n'a plus d'adresse n'est jamais destinataire) ;
  - `newsletter_unsubscribe_token(token)` → `boolean` : lien de désinscription en un clic ; un jeton
    inconnu (déjà désinscrit, compte supprimé) rend faux sans dire s'il a existé.
- Tests : `tests/sql/newsletter_test.sql` (rien coché d'avance, horodatage serveur, compte sans adresse,
  autre compte, anon, clé serveur, débit, cascade, droits) ; retour arrière : `supabase/rollback/20261031230000_newsletter_down.sql`,
  vérifié par `tests/sql/newsletter_rollback_test.sh`.

## App
- `js/data/newsletter.js` : état (`newsletter`), `newsletterRefresh()` à l'ouverture de l'écran Compte
  (pas plus d'une fois par 30 s) et quand le compte change l'écran ouvert (`newsletterNeedsRefresh` :
  connexion faite sur l'écran Compte, session restaurée après son ouverture, adresse ajoutée),
  `newsletterSet(on)`. Rien n'est gardé sur l'appareil.
- `js/features/newsletter-ui.js` : groupe « Lettre d'information » de l'écran Compte. État inconnu
  (chargement, hors ligne) : interrupteur **éteint et désactivé**, raison écrite (« Lettre d'information
  indisponible. Pas de connexion… ») et bouton « Réessayer » après un échec. Compte sans adresse :
  éteint et désactivé, avec ce qu'il faut ajouter. Toast « Inscription enregistrée » / « Tu es désinscrit ».
- Tests : `tests/test_juridique.py` (E2E : éteint par défaut, seul l'état est lu à l'ouverture, version
  seule envoyée, désinscription, hors ligne et « Réessayer », changement de compte, connexion faite sur
  l'écran Compte, compte Apple seul puis adresse ajoutée), `tests/unit/juridique.mjs`.
- `privacy.html#newsletter` (FR et EN) décrit les données, la finalité, la base légale, l'envoi par
  Resend (à venir), la désinscription et la durée.

## Confidentialité chez Apple (avec la build qui propose l'inscription)
L'adresse e-mail sert désormais aussi à la lettre (marketing du développeur), en plus de la connexion :
- **Manifeste** `ios/App/App/PrivacyInfo.xcprivacy` : finalité `NSPrivacyCollectedDataTypePurposeDeveloperAdvertising`
  ajoutée à `NSPrivacyCollectedDataTypeEmailAddress` (fait sur cette branche ; part avec la prochaine build,
  ce fichier n'entre pas dans l'empreinte native des OTA).
- **App Store Connect › Confidentialité de l'app** (Maxence) : Coordonnées › Adresse e-mail, cocher
  « Publicité ou marketing du développeur » en plus de « Fonctionnalité de l'app » ; toujours liée à
  l'identité, jamais de suivi. À faire **avant** d'envoyer à l'examen la version qui contient l'interrupteur.

## Brancher l'envoi plus tard (à faire, avec le feu vert de Maxence)
1. Appliquer la migration (ordre habituel, après les migrations du payant).
2. Fonction Edge `newsletter-send` (clé serveur, déclenchée à la main) : lit `newsletter_recipients()`,
   envoie par Resend **un e-mail par destinataire** (jamais d'adresses en copie), avec :
   - l'expéditeur `MDLF Training <noreply@mdlf.app>` (domaine déjà vérifié chez Resend) ;
   - les en-têtes `List-Unsubscribe: <https://…/newsletter-unsubscribe?t=<token>>, <mailto:contact@mdlf.app?subject=unsubscribe>`
     et `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058, exigés par Gmail et Yahoo pour les envois en nombre) ;
   - un lien de désinscription visible en bas de chaque lettre, et l'identité de l'éditeur.
3. Fonction Edge `newsletter-unsubscribe` (sans JWT, publique) : `POST` (un clic) ou `GET` (page de
   confirmation avec un bouton, pour que les antivirus qui suivent les liens ne désinscrivent personne),
   qui appelle `newsletter_unsubscribe_token(token)` et répond toujours la même page.
4. Adresses relais d'Apple (`@privaterelay.appleid.com`) : déclarer `noreply@mdlf.app` (et le domaine)
   dans Certificates, Identifiers & Profiles › Services › Sign in with Apple for Email Communication,
   sinon Apple refuse ces e-mails.
5. Rédiger la première lettre (sobre, pas de ton marketing appuyé), la montrer à Maxence avant tout envoi.
