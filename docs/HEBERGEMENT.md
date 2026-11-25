# Hébergement des sites : Cloudflare Pages (Vercel en secours)

Depuis le 25/11/2026, les trois sites de MDLF Training sont servis par **Cloudflare Pages**. Les adresses n'ont pas
changé. Les projets Vercel restent publiés en parallèle comme filet de secours (voir « Ménage chez Vercel »).

**Pourquoi.** Conditions de Vercel (vercel.com/legal/terms, § 4 « Hobby Plan », lu le 25/11/2026) : « You shall only
use the Services under a Hobby plan for your personal or non-commercial use. » L'app devient payante : le plan
gratuit de Vercel ne convient plus. Pages (plan gratuit de Cloudflare) n'a pas cette restriction, et le DNS de mdlf.app
est déjà chez Cloudflare.

## Les trois sites

| Adresse | Projet Pages | Contenu | Publié par | Projet Vercel gardé |
|---|---|---|---|---|
| https://coach.mdlf.app | `mdlf-coach` | `dist-coach/` (`npm run coach-web:build`) | job `coach-web-deploy` de `tests.yml` | `mdlf-coach` |
| https://mdlf.app | `mdlf-web` | `dist-web/` (`node scripts/build-web-public.mjs`) | job `deploy` de `tests.yml` | `muscu` (muscu-eta.vercel.app) |
| https://ota.mdlf.app | `mdlf-ota` | `manifest.json` et `bundles/` de `ota-site/` | `ota.yml` (lancé à la main) | `mdlf-ota` (mdlf-ota.vercel.app) |

DNS (zone mdlf.app chez Cloudflare) : `coach` et `ota` sont des CNAME vers `<projet>.pages.dev` ; la racine `mdlf.app`
est un CNAME aplati (CNAME flattening) vers `mdlf-web.pages.dev`. Tous en « DNS seul », TTL 60 s. Chaque domaine est
aussi déclaré dans le projet Pages (onglet Custom domains), sinon Pages ne le sert pas.

Outils : wrangler (CLI de Cloudflare) par `npx --yes wrangler@4.157.0`, version figée comme celle de la CLI Vercel.
Secrets du dépôt : `CLOUDFLARE_API_TOKEN` (jeton « Account › Cloudflare Pages › Edit », rien d'autre) et
`CLOUDFLARE_ACCOUNT_ID`. Wrangler demande Node 22 ou plus.

## Une seule source pour les en-têtes : vercel.json

Chaque site garde son `vercel.json` (`coach-web/vercel.json`, `web-public/vercel.json`, et celui qu'écrit
`scripts/ota-bundle.py`). `scripts/pages-headers.mjs` le traduit en `_headers` et `_redirects` de Pages au moment de la
construction : Vercel (secours) et Pages servent donc les mêmes en-têtes, et on ne les modifie qu'à un endroit. Le
script refuse ce qu'il ne sait pas traduire (rewrites, motifs autres que `/chemin` et `/dossier/(.*)`, même en-tête posé
par deux règles qui se recouvrent, que Pages joindrait par une virgule) au lieu de le deviner. Tests :
`tests/unit/hebergement.mjs`.

Différences de Pages dont la traduction tient compte (constatées le 25/11/2026 en comparant chaque adresse avec
`curl -sI`) :

- **Adresses en .html.** Pages redirige toujours `/page.html` vers `/page` (308). Vercel, sans `cleanUrls`, servait
  `/privacy.html` tel quel, adresse déclarée à l'App Store et ouverte par l'app. Pour mdlf.app, chaque page reçoit
  donc une réécriture `/page.html /page 200` dans `_redirects` : l'adresse reste en .html, en 200. Effet de bord sans
  gêne : `/privacy` répond aussi (404 chez Vercel). Le site du coach a `cleanUrls: true`, comportement natif de Pages.
- **Adresses inconnues.** Sans `404.html`, Pages sert `index.html` en 200 pour toute adresse (mode « application
  d'une page »). `coach-web/404.html` et `web-public/404.html` gardent un vrai 404.
- **Cache du navigateur.** La zone mdlf.app a un « Browser Cache TTL » de 4 h, appliqué à tout ce qui passe par
  Cloudflare, Pages compris : un `max-age=0, must-revalidate` (valeur par défaut de Vercel et de Pages) devient
  `max-age=14400` sur les .js et .css. Après une publication, un navigateur aurait pu garder 4 h d'anciens scripts
  avec une nouvelle page. `no-cache` (même effet pour le navigateur : revalider à chaque fois) n'est pas réécrit :
  il est posé sur tout le site dans les deux `vercel.json`. Le manifeste OTA (`no-store`) et les paquets
  (`max-age=31536000, immutable`, plus long que 4 h) ne sont pas touchés. Régler la zone sur « Respect Existing
  Headers » (tableau de bord Cloudflare › Caching › Configuration) enlèverait le piège ; le jeton DNS n'y a pas accès.
- **HSTS** : Vercel l'ajoutait de lui-même, Pages non. Coach et site public le déclarent déjà ; `ota-bundle.py`
  l'écrit maintenant (`max-age=63072000`, la valeur que servait ota.mdlf.app chez Vercel).
- **Fichiers servis.** Vercel ne servait ni `README.md` ni `vercel.json` (404, constaté). `dist-web/` et
  `dist-coach/` ne les contiennent pas ; le dossier publié de l'OTA ne contient que `manifest.json` et `bundles/`.
- Restent, sans effet : Pages n'envoie pas `charset=utf-8` dans le Content-Type des .js et .json (les scripts
  prennent l'encodage UTF-8 de la page ; le JSON est UTF-8 par définition), ni `Content-Disposition: inline` ni
  `Accept-Ranges`. Il ajoute `X-Content-Type-Options: nosniff` et `Referrer-Policy` sur l'OTA. Les redirections 308
  de Pages portent les en-têtes de sécurité (celles de Vercel non).

## Mises à jour à chaud : deux adresses pendant la transition

La build 133 (et les précédentes) lit `https://mdlf-ota.vercel.app/manifest.json` en dur
(`js/app/live-update.js`, `OTA_MANIFEST_URL`) et n'accepte qu'un paquet sous `https://mdlf-ota.vercel.app/bundles/`
(`OTA_BUNDLE_PREFIX`). La build suivante lit ota.mdlf.app avec un repli sur Vercel. Donc :

- `ota.yml` publie **aux deux endroits** : Pages d'abord, puis Vercel, puis vérifie aux deux adresses que le
  manifeste est identique octet pour octet à celui construit et que le paquet correspond à `fileSha256` ;
- le champ `url` du manifeste pointe toujours vers `https://mdlf-ota.vercel.app/bundles/…` (`OTA_BASE_URL` par
  défaut dans `ota-bundle.py`) : c'est la seule adresse que la build 133 accepte. Le même paquet est aussi servi par
  ota.mdlf.app ;
- le réveil quotidien du serveur des comptes (`/api/ping`, cron Vercel) reste chez Vercel : Vercel l'appelle sur
  l'adresse *.vercel.app du projet (vercel.com/docs/cron-jobs), la bascule du DNS ne le touche pas.

## Retour arrière (une commande par site)

À lancer depuis WSL ; jeton DNS lu dans `~/.config/mdlf/cloudflare_token`. Zone `a37f56af611681e4af129a78a1a482b7`.
Valeurs d'avant la bascule (25/11/2026).

```bash
# coach.mdlf.app : CNAME remis vers Vercel
T=$(cat ~/.config/mdlf/cloudflare_token); curl -s -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" https://api.cloudflare.com/client/v4/zones/a37f56af611681e4af129a78a1a482b7/dns_records/5c5a05991dd8b3d2389f07e9465c8fe2 -d '{"type":"CNAME","name":"coach.mdlf.app","content":"cname.vercel-dns.com","ttl":60,"proxied":false}'

# ota.mdlf.app : CNAME remis vers Vercel
T=$(cat ~/.config/mdlf/cloudflare_token); curl -s -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" https://api.cloudflare.com/client/v4/zones/a37f56af611681e4af129a78a1a482b7/dns_records/30c12b505ea74c8615754cd02bf88aaa -d '{"type":"CNAME","name":"ota.mdlf.app","content":"cname.vercel-dns.com","ttl":60,"proxied":false}'

# mdlf.app : CNAME aplati supprimé et les deux A de Vercel remis, dans un seul lot atomique (aucun instant sans adresse)
T=$(cat ~/.config/mdlf/cloudflare_token); Z=a37f56af611681e4af129a78a1a482b7; ID=$(curl -s -H "Authorization: Bearer $T" "https://api.cloudflare.com/client/v4/zones/$Z/dns_records?type=CNAME&name=mdlf.app" | python3 -c "import json,sys;print(json.load(sys.stdin)['result'][0]['id'])"); curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" https://api.cloudflare.com/client/v4/zones/$Z/dns_records/batch -d "{\"deletes\":[{\"id\":\"$ID\"}],\"posts\":[{\"type\":\"A\",\"name\":\"mdlf.app\",\"content\":\"64.29.17.1\",\"ttl\":60,\"proxied\":false},{\"type\":\"A\",\"name\":\"mdlf.app\",\"content\":\"216.198.79.1\",\"ttl\":60,\"proxied\":false}]}"
```

Les projets Vercel ont gardé leurs domaines : dès que le DNS revient, Vercel resert le site. Attention : le site du
coach n'est plus publié chez Vercel depuis le 25/11 (version de ce jour-là) ; le remettre à jour avec
`node scripts/build-coach-web.mjs --vercel` puis `npx vercel@62.0.0 deploy dist-coach --prod --yes` (docs/COACH_WEB.md).

## Ménage chez Vercel : quoi supprimer, et quand

Rien n'est supprimé tant que ces conditions ne sont pas remplies. Dans l'ordre :

1. **Une semaine après la bascule (à partir du 02/12/2026), si rien n'a cassé** :
   - retirer les domaines `coach.mdlf.app` et `mdlf.app` des projets Vercel `mdlf-coach` et `muscu` (Settings ›
     Domains) ; supprimer le projet `mdlf-coach` (plus publié depuis le 25/11) ;
   - remettre les TTL DNS à « Auto » ;
   - le projet `muscu` peut aussi partir ; avant, retirer la copie de secours du job `deploy` de `tests.yml` et le
     secret `VERCEL_WEB_PROJECT_ID`.
2. **Quand la build qui lit ota.mdlf.app est installée par tous** (App Store et TestFlight : plus aucune build
   ≤ 133 en usage ; la build 133 ne sait lire que mdlf-ota.vercel.app) :
   - passer `OTA_BASE_URL` à `https://ota.mdlf.app` dans `ota-bundle.py` (le champ `url` du manifeste) et
     `OTA_BUNDLE_PREFIX` de l'app à `https://ota.mdlf.app/bundles/` (nouvelle build) ;
   - déplacer le réveil du serveur des comptes (`ota-api/ping.js`, cron Vercel) vers un workflow GitHub planifié ;
   - retirer de `ota.yml` l'étape « Publication sur mdlf-ota.vercel.app » et sa vérification, puis les secrets
     `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_OTA_PROJECT_ID` ;
   - enlever `mdlf-ota.vercel.app` de la CSP de `index.html` (`connect-src`) et des pages juridiques
     (privacy.html, mentions-legales.html : Vercel comme hébergeur des téléchargements) ;
   - supprimer le projet Vercel `mdlf-ota`, en dernier.
3. Les `vercel.json` peuvent rester : ce sont les sources des en-têtes (ou les renommer, par exemple
   `headers.json`, avec `scripts/pages-headers.mjs`).
