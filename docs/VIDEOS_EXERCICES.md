# Vidéos d'exercices des coachs partenaires

Les coachs partenaires se filment sur les exercices de la bibliothèque. La vidéo s'affiche dans la fiche
de l'exercice (Programme › Bibliothèque › exercice, et « Comment faire » pendant la séance), à la place
du mannequin animé, avec le crédit « Vidéo : @coach ». L'élève d'un coach la voit aussi dans l'aperçu
d'un programme reçu (bouton « Vidéo » de Mon coach) et dans sa séance (nom de l'exercice touché).

Tant que le manifeste est vide, rien ne change dans l'app.

## Pièces

| Pièce | Rôle |
|---|---|
| `data/exercise-videos.json` | Manifeste statique versionné : nom de la bibliothèque → fichier, affiche, durée, crédit. Embarqué dans l'app (`scripts/build-web.mjs`, dossier `data/`) et dans le cache de `sw.js` |
| `js/data/exercise-videos.js` | Lecture du manifeste au démarrage (`loadExerciseVideos`), nettoyage strict (`cleanVideoManifest`), `exerciseVideo(nom)`, `videoAutoplayAllowed` |
| `js/ui/exercise-video.js` | Lecteur : `<video playsinline muted loop preload="none">` avec affiche, bouton ▶ / pause, état « indisponible » |
| `scripts/prepare-exercise-video.py` | Conversion d'une vidéo reçue : 720p H.264 + AAC, faststart, affiche JPEG, entrée du manifeste |
| `tests/unit/exercise-videos.mjs`, `tests/test_videos.py` | Tests (manifeste, refus, lecture automatique ; fiche, cellulaire, hors ligne, coach) |

Les vidéos ne sont jamais dans le dépôt, ni dans le paquet de l'app, ni dans le cache du service worker
(`sw.js` laisse passer les requêtes vidéo et les plages `Range` au réseau).

## Format du manifeste

```json
{
  "version": 1,
  "base": "https://yopptmdjtnezmccdvaxf.supabase.co/storage/v1/object/public/exercise-videos/",
  "videos": {
    "Squat barre": {
      "src": "squat-barre.mp4",
      "poster": "squat-barre.jpg",
      "duration": 18,
      "coach": "pseudo_instagram",
      "width": 1280,
      "height": 720
    }
  }
}
```

- La clé est le **nom exact de la bibliothèque** (`js/data/exercise-catalogue.js`) ; le test unitaire le vérifie.
  Un alias est accepté par l'app, mais le dépôt garde le nom exact.
- `base` : préfixe https des fichiers (vide : chemins relatifs à l'app). `src` en `.mp4` / `.m4v`, `poster`
  en `.jpg` / `.webp` / `.png`. Adresses en `https://` seulement : `http:`, `data:`, `javascript:` refusés.
- `coach` : pseudo Instagram sans `@` (lettres, chiffres, point, tiret bas, 30 au plus).
- `duration` en secondes (1 à 300) ; `width` / `height` : taille du fichier (proportions du lecteur).
- Une entrée invalide est ignorée seule ; un manifeste illisible, absent ou d'une autre `version` = aucune vidéo.

## Comportement du lecteur

- Rien n'est téléchargé tant que la fiche n'est pas ouverte : `preload="none"`, adresse posée au montage.
- Lecture automatique, muette, en boucle, quand la vidéo est à moitié visible ; pause quand elle sort de
  l'écran ; un toucher met en pause (et le défilement ne relance pas), un autre relance.
- **Pas de lecture automatique** sur données cellulaires ou en économie de données **quand c'est détectable**
  (`navigator.connection`, Android Chrome), ni quand « Réduire les animations » est activé : affiche + ▶.
  Safari et l'app iOS (WKWebView) n'exposent pas le type de réseau : sur iPhone, la lecture automatique
  se fait aussi en 4G/5G. D'où les fichiers légers (2 à 5 Mo) imposés par le script.
- Vidéo injoignable (hors ligne, fichier absent) : « Vidéo indisponible sans réseau · @coach », les consignes
  restent lisibles.

## Repli : animations 3D du personnage maison

Sans vidéo de coach, cinq exercices pilotes (squat barre, développé couché barre, soulevé de terre, tractions
pronation, curl biceps haltères) montrent une animation 3D de notre personnage (dépôt `mdlf-perso`, branche
`anim`, `src/anim/`) : 1 répétition en boucle, muette, 720 × 720, fond noir, muscles principaux en rouge ombré,
secondaires en rouge atténué. Liste et fichiers : `js/data/exercise-anims.js`, `img/anim/<nom>.mp4|webm|webp`.
Une vidéo de coach ajoutée au manifeste passe toujours devant.

- Même lecteur (`exerciseAnimHtml`, légende « Animation 3D ») ; H.264 d'abord, VP9 si le navigateur ne lit pas
  le H.264 (choix par `canPlayType` au moment de la lecture).
- Lecture automatique même sur données cellulaires (fichier de l'app, ≈ 100 Ko) ; « Réduire les animations » :
  affiche + ▶, rien de chargé avant le toucher.
- `sw.js` : affiches dans le cache de la version ; vidéos mises en cache entières au premier visionnage
  (`ANIM_RE`), puis servies depuis le cache par plages (206), y compris hors ligne.
- Ajouter un exercice : rendu dans `mdlf-perso` (`src/anim/make_anim.sh`), copie des 3 fichiers dans `img/anim/`,
  une ligne dans `EXERCISE_ANIMS`, l'affiche dans `ASSETS` de `sw.js` et `CACHE` monté.

## Hébergement retenu : Supabase Storage du projet existant

Bucket public `exercise-videos` du projet `yopptmdjtnezmccdvaxf` (aucun nouveau compte). MP4 progressif
« faststart » : l'iPhone lit par plages HTTP (`Range`), sans HLS (inutile pour des boucles de 15 à 30 s).

Avant de remplir le manifeste, vérifier une fois que le stockage répond aux plages (Safari en a besoin) :

```sh
curl -sI -r 0-1 "https://yopptmdjtnezmccdvaxf.supabase.co/storage/v1/object/public/exercise-videos/squat-barre.mp4"
# attendu : HTTP/2 206, Content-Range: bytes 0-1/…, Content-Type: video/mp4
```

Volume à surveiller (Supabase › Usage › Egress) : environ 3 à 5 Mo par vue complète. Sur l'offre gratuite,
5 Go de sortie par mois **partagés avec la base et l'authentification** (≈ 1 000 à 1 500 vues) ; l'offre Pro
(25 $/mois) en inclut 250 Go. Au-delà, ou pour ne pas toucher au quota de la base : Cloudflare R2 (sortie
gratuite, 10 Go de stockage offerts, nouveau compte), même manifeste, seule `base` change.

**CSP / ATS** : `index.html` n'a pas de Content-Security-Policy et `Info.plist` ne déclare pas
`NSAppTransportSecurity` : une adresse https externe est lue par l'app iOS sans changement natif (mise à jour
à chaud possible). Si une CSP est ajoutée un jour, y mettre `media-src` et `img-src` pour l'hôte des vidéos.

## Ajouter une vidéo

1. **Recevoir** la vidéo du coach (format plus bas) et vérifier le contrat signé (droits d'usage, crédit).
2. **Préparer** (hors du dépôt, par défaut `~/mdlf-videos/`) :
   ```sh
   python3 scripts/prepare-exercise-video.py ~/Téléchargements/IMG_1234.MOV "Squat barre" --coach pseudo_instagram \
     --debut 2 --fin 22          # facultatif : garder 2 à 4 répétitions propres
   ```
   Le script refuse plus de 60 s, contrôle H.264 / yuv420p / faststart, avertit au-delà de 8 Mo et affiche
   l'entrée du manifeste. Regarder l'affiche `.jpg` (sinon `--affiche 5` pour la prendre à 5 s).
3. **Déposer** `squat-barre.mp4` et `squat-barre.jpg` dans le bucket public `exercise-videos`
   (Supabase › Storage, glisser-déposer ; ne jamais remplacer un fichier publié : nouveau nom, ex.
   `squat-barre-2.mp4`, sinon les caches gardent l'ancien). Vérifier le `curl -r 0-1` ci-dessus.
4. **Ajouter** l'entrée dans `data/exercise-videos.json` (et `base` la première fois).
5. **Tester** : `npm run test:unit` (manifeste valide, nom exact) ; ouvrir la fiche dans l'app locale.
6. **Publier** avec la version suivante de l'app (nouveau `CACHE` dans `sw.js`, mise à jour à chaud de l'app
   iOS) : le manifeste fait partie du contenu de l'app, il n'est pas relu à distance.

Retirer une vidéo : enlever son entrée du manifeste (publication suivante), puis le fichier du bucket.

## Ce que les coachs livrent

- **Fichier** : la vidéo d'origine du téléphone (« Le plus compatible » ou HEVC, 1080p ou 4K, 30 i/s),
  envoyée sans compression (AirDrop, WeTransfer, Drive), jamais par messagerie qui recompresse.
- **Cadrage** : paysage 16/9 (téléphone à l'horizontale), téléphone fixe sur trépied à hauteur de hanche,
  corps entier visible avec la charge, de profil ou de trois quarts selon l'exercice (de profil : squat,
  soulevé de terre, développés ; de face : élévations, curls). Fond neutre, sans autre personne ni logo
  reconnaissable, lumière de face.
- **Contenu** : 2 à 4 répétitions propres à vitesse normale, 15 à 30 s, début et fin sur la position de
  départ (la boucle se raccorde). Pas de musique (droits) ; le son est coupé dans l'app.
- **Une vidéo par exercice**, nommée avec le nom de la bibliothèque (liste fournie au coach).
- **Crédit** : pseudo Instagram à afficher, et accord écrit pour l'usage dans l'app et ses publications.
