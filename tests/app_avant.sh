#!/usr/bin/env bash
# App d'avant les blocs (le même exercice deux fois, js/data/blocks.js), servie à part pour test_blocs.py
# (once_version_avant : les données de cette version lues par une app qui n'a pas encore reçu la mise à jour à chaud).
# Commit = main juste avant les blocs (26/11/2026), le même que tests/unit/blocks.mjs (OLD_SHA). Il faut l'historique
# git (checkout avec fetch-depth: 0). Usage : bash tests/app_avant.sh [port] → PPL_OLD_URL=http://localhost:<port>/
set -euo pipefail
SHA=0ac2e4dc584eeccd9a3c531c37d7f63d66b11788
PORT=${1:-8732}
DIR=${RUNNER_TEMP:-/tmp}/app-avant
[ -n "${CI:-}" ] && git config --global --add safe.directory "$(pwd)"   # conteneur de la CI : dépôt monté par un autre utilisateur
rm -rf "$DIR" && mkdir -p "$DIR"
git archive "$SHA" | tar -x -C "$DIR"
python -m http.server "$PORT" -d "$DIR" > /tmp/serveur-avant.log 2>&1 &
for i in $(seq 1 20); do python -c "import urllib.request as u; u.urlopen('http://localhost:$PORT/')" 2>/dev/null && break; sleep 0.5; done
