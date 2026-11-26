# Site public mdlf.app

Depuis le 22/10/2026, la version web (PWA) est arrêtée : seule l'app iOS reste. Ce dossier est tout
ce que publie le site :

- `index.html` : « l'app est sur iPhone », avec le téléchargement des données de l'ancienne PWA si ce
  navigateur en garde (clé `ppl_v2`) ;
- `privacy.html`, `mentions-legales.html`, `cgu.html`, `cgv.html` et leur feuille `legal.css` : pages
  juridiques copiées depuis la racine au moment de la publication, liées depuis l'app par
  `js/data/legal-links.js` (contenu et emplacements à compléter : docs/JURIDIQUE.md). L'URL de
  `privacy.html` est déclarée à l'App Store : à garder en ligne ;
- `sw.js` : désinstalle l'ancien service worker et vide ses caches ;
- `auth-retour.js` : une connexion Google du site du coach qui échoue chez Supabase sans retrouver sa demande
  (`bad_oauth_state`) revient ici (site_url) ; renvoyée vers https://coach.mdlf.app/ avec `error` et `error_code` seuls
  (docs/COACH_WEB.md, « Retour de Google en erreur, et renvoi de mdlf.app ») ;
- `strava.html` (Strava en sommeil, liée nulle part : docs/STRAVA.md) : retour de la page d'autorisation de Strava (fonction `strava-connect`),
  résultat en ancre (`#ok`, `#refuse`, `#droits`, `#expire`, `#erreur`) affiché sans script.

- `404.html` : page des adresses inconnues (sans elle, Cloudflare Pages répondrait index.html en 200).

Publication : job `deploy` de `.github/workflows/tests.yml`, sur Cloudflare Pages (projet `mdlf-web`, construit par
`scripts/build-web-public.mjs` : ni ce README ni `vercel.json` ne sont servis), puis copie de secours sur le projet
Vercel `muscu` (muscu-eta.vercel.app). `vercel.json` reste la seule source des en-têtes : docs/HEBERGEMENT.md.
