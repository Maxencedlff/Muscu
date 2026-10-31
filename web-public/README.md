# Site public muscu-eta.vercel.app

Depuis le 22/10/2026, la version web (PWA) est arrêtée : seule l'app iOS reste. Ce dossier est tout
ce que publie le site :

- `index.html` : « l'app est sur iPhone », avec le téléchargement des données de l'ancienne PWA si ce
  navigateur en garde (clé `ppl_v2`) ;
- `privacy.html` : copié depuis la racine au moment de la publication (URL déclarée à l'App Store,
  à garder en ligne) ;
- `sw.js` : désinstalle l'ancien service worker et vide ses caches ;
- `strava.html` : retour de la page d'autorisation de Strava (fonction `strava-connect`, docs/STRAVA.md),
  résultat en ancre (`#ok`, `#refuse`, `#droits`, `#expire`, `#erreur`) affiché sans script.

Publication : job `deploy` de `.github/workflows/tests.yml`.
