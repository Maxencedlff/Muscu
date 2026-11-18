#!/usr/bin/env bash
# Prépare le conteneur officiel de Playwright pour la suite E2E (tests.yml, tests-complet.yml).
#
# L'image a les navigateurs (/ms-playwright) et leurs dépendances système, mais :
#  - pas le paquet Python playwright : installé ici à la version de l'image (PLAYWRIGHT_VERSION) ;
#    un écart se voit tout de suite (navigateur introuvable au lancement) ;
#  - pas les polices DejaVu ni Lato de la machine GitHub ubuntu-24.04 : sans elles, sans-serif et
#    system-ui tombent sur WenQuanYi Zen Hei (textes 12 % plus étroits, mises en page différentes).
#    Mêmes paquets Ubuntu 24.04 que la machine GitHub, téléchargés directement (pas d'apt-get update,
#    la partie lente) et vérifiés par empreinte SHA-256.
set -euo pipefail

: "${PLAYWRIGHT_VERSION:?PLAYWRIGHT_VERSION manquant}"
python -m pip install --quiet --break-system-packages --root-user-action=ignore \
  "playwright==$PLAYWRIGHT_VERSION" "pillow==12.1.1"   # pillow : JPEG avec EXIF et GPS du test des photos de bilan

POOL=http://archive.ubuntu.com/ubuntu/pool/main/f   # paquets signés par Ubuntu, empreintes figées ci-dessous
DEBS=(
  "fonts-dejavu/fonts-dejavu-mono_2.37-8_all.deb 8a599d6553307db7ecb795d2f0e5a301e03234afc75c7358b0ba43466454c89a"
  "fonts-dejavu/fonts-dejavu-core_2.37-8_all.deb 40049660c194f3b8a2541fc7369efebb10e9f94bdac836a2f38fafedd10fa73a"
  "fonts-dejavu/fonts-dejavu-extra_2.37-8_all.deb 5502e5ccc416683e5251dc105b37be31158bc2e02133221e56524ea2a8e426fe"
  "fonts-lato/fonts-lato_2.015-1_all.deb f99ebf69230ee90e032a662a6cebddbc3905f038ee80f6577d56ebed3fc5c2be"
)
dir=$(mktemp -d)
for entry in "${DEBS[@]}"; do
  read -r path sum <<< "$entry"
  file="$dir/${path##*/}"
  python - "$POOL/$path" "$file" <<'EOF'
import sys, time, urllib.request
for attempt in range(4):
    try:
        urllib.request.urlretrieve(sys.argv[1], sys.argv[2]); break
    except OSError as e:
        if attempt == 3: raise
        print(f'{sys.argv[1]} : {e}, nouvel essai', flush=True); time.sleep(3 * (attempt + 1))
EOF
  echo "$sum  $file" | sha256sum --check --quiet
done
dpkg -i "$dir"/*.deb > /dev/null
fc-cache -f
# Contrôle : la police par défaut doit être celle de la machine GitHub
match=$(fc-match sans-serif)
echo "sans-serif : $match"
case "$match" in DejaVuSans.ttf:*) ;; *) echo "Police par défaut inattendue (DejaVu Sans attendue)"; exit 1 ;; esac
