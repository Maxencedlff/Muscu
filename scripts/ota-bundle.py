"""Paquet de mise à jour à chaud : dist/ → ota-site/ (publié sur https://mdlf-ota.vercel.app).

    npm run web:build && python3 scripts/ota-bundle.py

ota-site/
  manifest.json           { version, seq, runtime, url, checksum, [sessionKey], fileSha256, size, publishedAt }
                          (jamais mis en cache)
  bundles/<version>.zip   contenu de dist/ avec index.html à la racine (immuable)
  vercel.json             en-têtes de cache, réveil quotidien du serveur des comptes
  api/ping.js             ce réveil (copié depuis ota-api/)

Format attendu par @capgo/capacitor-updater : zip du dossier web, index.html à la racine, sans
fichier caché ; checksum = SHA-256 du zip, vérifié par le module natif avant d'installer.

Signature (chiffrement v2 de Capgo, docs/BUILD.md « Signature des mises à jour à chaud ») : la
variable d'environnement OTA_CAPGO_PRIVATE_KEY (secret GitHub réservé à ota.yml) contient la clé
privée RSA. Les deux côtés doivent aller ensemble :
  - clé privée ET publicKey dans capacitor.config.json : le zip est chiffré par la CLI Capgo, le
    manifeste porte le SHA-256 chiffré par la clé privée (checksum) et la clé de session
    (sessionKey) ; la paire est vérifiée (déchiffrement avec la publicKey) avant la publication ;
  - ni l'un ni l'autre : comportement d'origine, paquet en clair et SHA-256 en hexadécimal ;
  - l'un sans l'autre : arrêt. Une app avec publicKey refuse un paquet sans clé de session, et une
    app sans publicKey ne sait pas déchiffrer un paquet chiffré.
Le manifeste porte aussi fileSha256, le SHA-256 du fichier servi (chiffré ou non), pour la
vérification en ligne d'ota.yml.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST = os.path.join(ROOT, 'dist')
OUT = os.path.join(ROOT, 'ota-site')
BASE_URL = os.environ.get('OTA_BASE_URL', 'https://mdlf-ota.vercel.app')
# Version figée de la CLI Capgo (chiffrement des paquets) : une version publiée change le format
# seulement si on change cette ligne
CAPGO_CLI = '@capgo/cli@8.98.6'
B64 = r'[A-Za-z0-9+/]+={0,2}'


def capgo_public_key():
    """publicKey du bloc CapacitorUpdater de capacitor.config.json, ou chaîne vide."""
    config = json.load(open(os.path.join(ROOT, 'capacitor.config.json'), encoding='utf-8'))
    return (config.get('plugins', {}).get('CapacitorUpdater', {}).get('publicKey') or '').strip()


def capgo(args, hint='', timeout=180):
    """Lance la CLI Capgo depuis la racine du dépôt (elle y lit la version du module natif)."""
    res = subprocess.run(['npx', '--yes', CAPGO_CLI, *args], cwd=ROOT, stdin=subprocess.DEVNULL,
                         capture_output=True, text=True, timeout=timeout)
    if res.returncode != 0:
        sys.exit(f'CLI Capgo en échec ({" ".join(args[:2])}), rien n\'est publié.{hint}\n'
                 f'{res.stdout[-2000:]}\n{res.stderr[-2000:]}')
    return res.stdout


def sign_bundle(zip_path, checksum, private_key, public_key):
    """Chiffre zip_path sur place. Renvoie (empreinte chiffrée, clé de session)."""
    with tempfile.TemporaryDirectory() as tmp:
        # Clés dans des fichiers 0600 plutôt qu'en argument : la ligne de commande se lit dans ps
        key_file, pub_file = os.path.join(tmp, 'k'), os.path.join(tmp, 'k.pub')
        for path, text in ((key_file, private_key), (pub_file, public_key)):
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as f:
                f.write(text.strip() + '\n')
        out = capgo(['bundle', 'encrypt', zip_path, checksum, '--key', key_file, '--json'])
        info = json.loads(out[out.index('{'):out.rindex('}') + 1])
        signed, session = info.get('checksum', ''), info.get('ivSessionKey', '')
        if not re.fullmatch(B64, signed) or not re.fullmatch(f'{B64}:{B64}', session):
            sys.exit('Sortie inattendue de « bundle encrypt » : rien n\'est publié')
        encrypted = zip_path + '_encrypted.zip'
        # Contrôle de la paire : la publicKey compilée dans l'app doit retrouver le SHA-256 en clair
        check = capgo(['bundle', 'decrypt', encrypted, session, '--key', pub_file, '--checksum', signed],
                      hint=' La clé privée correspond-elle à la publicKey de capacitor.config.json ?')
        if 'Checksum matches' not in check:
            sys.exit('La clé privée ne correspond pas à la publicKey de capacitor.config.json : rien n\'est publié')
        decrypted = encrypted + '_decrypted.zip'
        if hashlib.sha256(open(decrypted, 'rb').read()).hexdigest() != checksum:
            sys.exit('Paquet déchiffré différent du paquet d\'origine : rien n\'est publié')
        os.remove(decrypted)
        os.replace(encrypted, zip_path)
    return signed, session


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

    private_key = os.environ.get('OTA_CAPGO_PRIVATE_KEY', '').strip()
    public_key = capgo_public_key()
    if private_key and not public_key:
        sys.exit('OTA_CAPGO_PRIVATE_KEY présente mais pas de publicKey dans capacitor.config.json : '
                 'les apps installées ne sauraient pas déchiffrer le paquet (docs/BUILD.md)')
    if public_key and not private_key:
        sys.exit('publicKey dans capacitor.config.json mais OTA_CAPGO_PRIVATE_KEY absente : '
                 'l\'app refuserait un paquet non signé (docs/BUILD.md)')

    checksum = hashlib.sha256(open(zip_path, 'rb').read()).hexdigest()
    signature = sign_bundle(zip_path, checksum, private_key, public_key) if private_key else None
    data = open(zip_path, 'rb').read()
    manifest = {
        'version': build['version'],
        'seq': build['seq'],
        'runtime': build['runtime'],
        'url': f'{BASE_URL}/bundles/{zip_name}',
        'checksum': signature[0] if signature else checksum,
        **({'sessionKey': signature[1]} if signature else {}),
        'fileSha256': hashlib.sha256(data).hexdigest(),
        'size': len(data),
        'publishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=2)
    os.makedirs(os.path.join(OUT, 'api'))
    shutil.copy(os.path.join(ROOT, 'ota-api', 'ping.js'), os.path.join(OUT, 'api', 'ping.js'))
    json.dump({'crons': [{'path': '/api/ping', 'schedule': '17 6 * * *'}], 'headers': [
        {'source': '/manifest.json', 'headers': [{'key': 'Cache-Control', 'value': 'no-store'}]},
        {'source': '/bundles/(.*)', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=31536000, immutable'}]},
    ]}, open(os.path.join(OUT, 'vercel.json'), 'w'), indent=2)
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
