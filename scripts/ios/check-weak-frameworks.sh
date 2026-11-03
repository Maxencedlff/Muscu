#!/usr/bin/env bash
# Frameworks d'Apple plus récents que la cible de l'app (IPHONEOS_DEPLOYMENT_TARGET = 16.4) : liés en
# faible (-weak_framework dans OTHER_LDFLAGS de la cible App, ios/App/App.xcodeproj/project.pbxproj).
# Lié en fort, un framework absent de l'iPhone (DeclaredAgeRange n'existe qu'à partir d'iOS 26) fait
# planter l'app dès son lancement, avant toute ligne de code : dyld refuse de la charger.
# Usage : bash scripts/ios/check-weak-frameworks.sh <chemin/App.app> (appelé par .github/workflows/ios.yml)
set -euo pipefail

APP="${1:?chemin du .app attendu}"
WEAK=(DeclaredAgeRange)

EXE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Info.plist")
BIN="$APP/$EXE"
test -f "$BIN" || { echo "Exécutable introuvable : $BIN"; exit 1; }

# Bibliothèques chargées, une par ligne « LC_LOAD_WEAK_DYLIB /System/…/X.framework/X » (fichiers, pas de
# « | grep -q » : avec pipefail, il échoue au hasard sur SIGPIPE)
LOADS=$(mktemp)
# Debug (Xcode 16+, ENABLE_DEBUG_DYLIB) : le code de l'app est dans App.debug.dylib, l'exécutable n'est qu'un lanceur
BINS=("$BIN"); [ -f "$APP/$EXE.debug.dylib" ] && BINS+=("$APP/$EXE.debug.dylib")
otool -l "${BINS[@]}" | awk '$1 == "cmd" { cmd = $2 } $1 == "name" && cmd ~ /^LC_LOAD/ { print cmd, $2 }' > "$LOADS"
fail=0
for fw in "${WEAK[@]}"; do
  strong=$(grep -v '^LC_LOAD_WEAK_DYLIB ' "$LOADS" | grep "/$fw.framework/$fw\$" | cut -d' ' -f1 | sort -u | paste -sd' ' - || true)
  if [ -n "$strong" ]; then
    echo "::error::$fw lié en fort ($strong) : plantage au lancement avant iOS 26. Ajouter -weak_framework $fw à OTHER_LDFLAGS de la cible App."
    fail=1
  elif grep -qx "LC_LOAD_WEAK_DYLIB .*/$fw.framework/$fw" "$LOADS"; then
    echo "$fw : lié en faible (LC_LOAD_WEAK_DYLIB)"
  else
    echo "::error::$fw absent des bibliothèques chargées par $EXE (LC_LOAD_WEAK_DYLIB attendu) : module natif retiré ou non compilé ?"
    fail=1
  fi
done
rm -f "$LOADS"
exit "$fail"
