"""Paquet de mise à jour à chaud : dist/ → ota-site/ (publié sur https://mdlf-ota.vercel.app).

    npm run web:build && python3 scripts/ota-bundle.py

ota-site/
  manifest.json           { version, seq, runtime, url, checksum, size, publishedAt } (jamais mis en cache)
  bundles/<version>.zip   contenu de dist/ avec index.html à la racine (immuable)
  vercel.json             en-têtes de cache

Format attendu par @capgo/capacitor-updater : zip du dossier web, index.html à la racine, sans
fichier caché ; checksum = SHA-256 du zip, vérifié par le module natif avant d'installer.
"""
import hashlib
import json
import os
import shutil
import sys
import time
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST = os.path.join(ROOT, 'dist')
OUT = os.path.join(ROOT, 'ota-site')
BASE_URL = os.environ.get('OTA_BASE_URL', 'https://mdlf-ota.vercel.app')


def main():
    info_path = os.path.join(DIST, 'build-info.json')
    if not os.path.exists(os.path.join(DIST, 'index.html')) or not os.path.exists(info_path):
        sys.exit('dist/ absent ou incomplet : lancer npm run web:build')
    build = json.load(open(info_path, encoding='utf-8'))
    if build['version'].endswith('-local'):
        sys.exit('Contenu non commité (version « -local ») : on ne publie que du code enregistré dans git')

    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(os.path.join(OUT, 'bundles'))
    zip_name = f"{build['version']}.zip"
    zip_path = os.path.join(OUT, 'bundles', zip_name)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for folder, dirs, files in os.walk(DIST):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
            for f in sorted(files):
                if f.startswith('.'):
                    continue
                full = os.path.join(folder, f)
                z.write(full, os.path.relpath(full, DIST))

    data = open(zip_path, 'rb').read()
    manifest = {
        'version': build['version'],
        'seq': build['seq'],
        'runtime': build['runtime'],
        'url': f'{BASE_URL}/bundles/{zip_name}',
        'checksum': hashlib.sha256(data).hexdigest(),
        'size': len(data),
        'publishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=2)
    json.dump({'headers': [
        {'source': '/manifest.json', 'headers': [{'key': 'Cache-Control', 'value': 'no-store'}]},
        {'source': '/bundles/(.*)', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=31536000, immutable'}]},
    ]}, open(os.path.join(OUT, 'vercel.json'), 'w'), indent=2)
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
