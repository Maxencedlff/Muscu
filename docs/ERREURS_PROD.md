# Remontée des erreurs en production

État au 26/11/2026 : **préparé sur la branche `erreurs-prod`, rien en production.** Ni migration appliquée, ni
fonction déployée, ni OTA. Mise en service : section « Mise en service », après le feu vert de Maxence.

## Le problème

Quand l'app plante chez un testeur ou un élève, personne ne le sait : l'écran de secours s'affiche, ou un bouton
ne fait plus rien, et l'erreur reste dans la console de son iPhone. On l'apprend seulement s'il le dit.

## Choix : solution maison plutôt que Sentry

| Critère | Sentry (offre gratuite « Developer », SDK `@sentry/capacitor`) | Maison (table Supabase + fonction `error-report`) |
|---|---|---|
| Coût | 0 € jusqu'à 5 000 erreurs par mois, 1 seul utilisateur, 30 jours d'historique ; ensuite offre Team à 26 $ par mois (annuel) ou 29 $ | 0 € : même projet Supabase, quelques lignes par jour |
| Sous-traitant | un de plus (Functional Software Inc., États-Unis), même avec la région UE : contrat de sous-traitance, transfert à documenter | aucun nouveau : Supabase (Irlande) l'est déjà pour les comptes |
| Données personnelles | le SDK envoie l'adresse IP par défaut et la déduit côté serveur ; à couper dans le SDK ET dans les réglages du projet (« Security & Privacy »), plus `beforeSend` pour nettoyer messages et fil d'Ariane (clics, requêtes, console, qui peuvent porter des noms d'exercice ou des poids). Chaque réglage oublié est une fuite | rien d'autre que 7 champs en liste blanche ; l'adresse IP ne sert qu'à une limite en mémoire, jamais écrite ; trois barrières (app, fonction, contraintes de la base) refusent chiffres, @ et accents |
| Étiquettes App Store | « Diagnostics › Données de plantage » + « Données de performance » / « Autres diagnostics » selon les options, avec un SDK tiers à déclarer (manifeste de confidentialité de sentry-cocoa) | « Diagnostics › Données de plantage », **non liées à l'identité**, pas de suivi |
| CSP | ajouter `https://*.ingest.de.sentry.io` (ou l'hôte exact) à `connect-src` | rien : même domaine que les comptes (`yopptmdjtnezmccdvaxf.supabase.co`, déjà permis) |
| Mise en ligne | SDK natif (Swift / Kotlin) : nouvelle build TestFlight / App Store obligatoire, `cap sync`, manifeste de confidentialité | JavaScript seulement : passe par une version normale (voir « Mise en service ») ; aucune dépendance ajoutée |
| Ce qu'on perd | — | les plantages natifs (Swift : modules MdlfSound, Live Activity, Santé) ; pas de tableau de bord ni d'alerte automatique (lecture par `scripts/erreurs-prod.mjs`) |

**Recommandation : la solution maison.** Pour une app qui touche à des données de santé, l'argument décisif est
qu'aucune donnée n'a besoin d'être retirée après coup : le rapport ne peut contenir que ce qui est listé, et un
quatrième acteur n'entre pas dans la chaîne. Le coût est nul et la CSP ne bouge pas. Les plantages natifs restent
visibles dans App Store Connect (Xcode Organizer › Crashes, rapports envoyés par les testeurs TestFlight qui ont
accepté le partage), sans rien ajouter.

Sources (vérifiées le 26/11/2026) : [tarifs Sentry](https://sentry.io/pricing/) (Developer : 5k erreurs, 1 utilisateur,
30 jours ; Team 26 $ / 29 $ ; résidence des données disponible), [données collectées par le SDK JavaScript](https://docs.sentry.io/platforms/javascript/data-management/data-collected/)
(adresse IP envoyée par défaut, `sendDefaultPii` déprécié depuis 10.54.0), [données sensibles, guide Capacitor](https://docs.sentry.io/platforms/javascript/guides/capacitor/data-management/sensitive-data/)
(`beforeSend`, nettoyage côté serveur), [manifeste de confidentialité Apple de sentry-cocoa](https://docs.sentry.io/platforms/apple/data-management/apple-privacy-manifest/).

## Ce qui part, exactement

```json
{ "v": 1, "kind": "error", "name": "TypeError",
  "message": "Cannot read properties of undefined (reading '<s>')",
  "frames": [{ "f": "renderProfile", "file": "js/features/account-ui.js", "l": 120, "c": 7 }],
  "build": "2026.11.29-abc1234", "platform": "ios" }
```

Rien d'autre : ni compte, ni jeton (pas d'en-tête `Authorization`, pas de cookie, pas de référent), ni appareil,
ni version d'iOS, ni heure locale. La date est posée par la base.

Nettoyage du message (`errScrubMessage`, `js/data/error-report.js`) : caractères de contrôle et invisibles,
adresses (`<url>`), tout mot avec un @ (`<email>`), jetons et identifiants de 16 caractères ou plus contenant un
chiffre (`<k>`), tout texte entre guillemets (`'<s>'` : pseudo, nom d'exercice, valeur saisie), tous les nombres
(`<n>` : poids, reps, dates), tout mot accentué ou non ASCII (`<t>` : textes français de l'app, noms d'exercice), le
pseudo et l'e-mail du dernier compte même sans guillemets (`<p>`) ; puis 200 caractères au plus.
La pile n'est pas recopiée mais **reconstruite** (`errParseStack`) : nom de fonction s'il ressemble à un
identifiant de code (sinon `?`), fichier de l'app sans paramètre (`js/...` ou `index.html`, sinon `<ext>`), ligne,
colonne. 12 lignes au plus.

Le serveur ne fait pas confiance à l'app : `error-policy.js` **refuse** (400) au lieu de corriger tout rapport qui a
un champ en trop, un chiffre, un @ ou un caractère non ASCII dans le message, un fichier hors de l'app ; la table
a les mêmes contraintes (`check`).

Prouvé par les tests : `tests/unit/error-report.mjs` (« rien de personnel ne part » : pseudo, e-mail, poids,
séance, identifiant de compte et jeton injectés dans le message, la pile, des champs ajoutés à l'erreur et le
stockage ; aucun ne se retrouve dans ce qui part, en-têtes compris), `tests/deno/error_report.test.ts` (fonction
appelée pour de vrai : anonyme, aucune adresse IP ni compte inséré, refus avant écriture, limites),
`tests/sql/erreurs_prod_test.sql` (droits, contraintes, regroupement, limite globale, purge) et
`tests/sql/erreurs_prod_rollback_test.sh`.

## Limites de fréquence

- **App** : 5 rapports au plus par lancement, chaque erreur une seule fois ; toute réponse non 2xx (fonction absente,
  limite atteinte, panne) coupe la remontée jusqu'au prochain lancement. Seulement dans l'app installée
  (`Native.isNative`) : la PWA, muscu-eta et les tests Playwright n'envoient rien.
- **Fonction** : 20 rapports par 10 minutes et par appareil. L'appareil est reconnu par une empreinte SHA-256 de
  son adresse IP **salée par un nombre tiré au démarrage de l'instance**, gardée en mémoire seulement (jamais écrite,
  jamais journalisée, perdue à l'arrêt de l'instance, au plus 5 000 clés). Une instance qui redémarre oublie tout :
  c'est voulu, la limite globale prend le relais.
- **Base** : la même erreur de la même version dans les 24 h n'ajoute pas de ligne (compteur `hits`) ; au plus 200
  erreurs nouvelles par heure (au-delà : 429) ; lignes sans nouvelle occurrence depuis 90 jours effacées.

Remarque honnête : comme pour toute requête vers Supabase (comptes, synchronisation), l'hébergeur voit l'adresse IP
le temps de la requête dans ses journaux d'infrastructure. Le code de l'app ne la garde nulle part.

## Lire les erreurs reçues

```sh
node scripts/erreurs-prod.mjs              # 7 derniers jours, les plus fréquentes d'abord
node scripts/erreurs-prod.mjs --jours 1 --version 2026.11.29-abc1234
```

Lecture seule par l'API de gestion (`read_only`), jeton `~/.config/mdlf/supabase_token`. À lancer après chaque OTA
ou build TestFlight (le lendemain), et dès qu'un testeur dit « ça a planté ».

## Mise en service (feu vert de Maxence)

Dans cet ordre (la fonction avant l'app, sinon l'app s'arrête d'elle-même au premier 404, sans gêne) :

1. **Migration** : appliquer `supabase/migrations/20261129010000_erreurs_prod.sql` (éditeur SQL ou `supabase db push`),
   puis `controle-supabase` / `supabase_advisors.sh yopptmdjtnezmccdvaxf` (aucune alerte attendue : RLS active,
   aucun droit pour anon et authenticated).
2. **Fonction** : `supabase functions deploy error-report --project-ref yopptmdjtnezmccdvaxf` (`verify_jwt = false`
   lu dans `supabase/config.toml`). Aucun secret à ajouter.
3. **Essai** : un rapport factice par `curl` (corps de l'exemple ci-dessus, en-tête `apikey` = clé publique) doit
   répondre 202, puis `node scripts/erreurs-prod.mjs --jours 1` le montre ; l'effacer ensuite
   (`delete from public.error_reports`).
4. **Confidentialité** : `privacy.html` (section « Diagnostics », déjà rédigée sur la branche) publié sur mdlf.app
   par le job deploy, avant l'app.
5. **App Store Connect › Confidentialité de l'app** : ajouter « Diagnostics › Données de plantage » : collectées,
   **non liées à l'identité de l'utilisateur**, **pas utilisées pour le suivi**, finalité « Fonctionnalités de
   l'app ». Rien d'autre ne change (« Autres données de diagnostic » est déjà déclaré, lié, pour la version de
   l'app envoyée avec le profil).
6. **Manifeste iOS** (`ios/App/App/PrivacyInfo.xcprivacy`) : ajouter l'entrée ci-dessous à
   `NSPrivacyCollectedDataTypes`. Pas modifié sur la branche : un envoi qui touche `ios/**` lance la compilation
   de contrôle macOS (ios.yml) ; à faire avec la prochaine build native.

   ```xml
   <dict>
     <!-- Remontée des erreurs JavaScript (docs/ERREURS_PROD.md) : sans compte, sans adresse IP gardée -->
     <key>NSPrivacyCollectedDataType</key>
     <string>NSPrivacyCollectedDataTypeCrashData</string>
     <key>NSPrivacyCollectedDataTypeLinked</key>
     <false/>
     <key>NSPrivacyCollectedDataTypeTracking</key>
     <false/>
     <key>NSPrivacyCollectedDataTypePurposes</key>
     <array>
       <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
     </array>
   </dict>
   ```
7. **App** : fusion dans main puis publication par `publier.sh` (version du cache de `sw.js` relevée à ce moment,
   comme d'habitude). Règle Apple 2.5.2 : c'est un outil de correction sans effet visible ; si Maxence préfère, le
   faire partir avec la prochaine build TestFlight plutôt qu'en OTA.

Arrêt d'urgence : supprimer la fonction (`supabase functions delete error-report`) ; l'app arrête d'envoyer au
premier refus. Retour arrière complet : `supabase/rollback/20261129010000_erreurs_prod_down.sql` (efface les rapports).
