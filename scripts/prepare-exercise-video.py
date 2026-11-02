"""Prépare la vidéo d'un exercice filmée par un coach (procédure complète : docs/VIDEOS_EXERCICES.md).

    python3 scripts/prepare-exercise-video.py <vidéo reçue> "<nom de la bibliothèque>" --coach <pseudo> [options]

Sortie (hors du dépôt par défaut : ~/mdlf-videos/) :
  <slug>.mp4   H.264 High 4.0, yuv420p, 30 i/s, 720 px sur le petit côté, AAC 96 kb/s (ou sans son),
               « faststart » (index en tête : la lecture démarre avant la fin du téléchargement, iPhone compris)
  <slug>.jpg   affiche (poster) prise dans la vidéo, même taille
et affiche l'entrée à coller dans data/exercise-videos.json.

Options : --debut S et --fin S (secondes, pour couper), --affiche S (instant de l'affiche, défaut : 1/3),
--sans-son, --sortie DOSSIER, --crf N (qualité, défaut 26 : plus petit = plus lourd).
Besoin : ffmpeg et ffprobe dans le PATH. Rien n'est envoyé : le dépôt sur l'hébergement se fait à la main.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata

MAX_SECONDS = 60          # au-delà, la vidéo est refusée (boucle courte voulue, données mobiles)
WARN_MB = 8               # au-delà, avertissement : viser 2 à 5 Mo pour 15 à 30 s


def slug(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-') or 'exercice'


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
                         check=True, capture_output=True, text=True).stdout
    info = json.loads(out)
    video = next((s for s in info['streams'] if s.get('codec_type') == 'video'), None)
    if not video:
        sys.exit(f'{path} : aucune piste vidéo')
    # Rotation des vidéos de téléphone (métadonnée « rotate » ou matrice d'affichage) : largeur et hauteur affichées
    rot = int(video.get('tags', {}).get('rotate', 0) or 0)
    for sd in video.get('side_data_list', []) or []:
        if 'rotation' in sd:
            rot = int(sd['rotation'])
    w, h = int(video['width']), int(video['height'])
    if abs(rot) % 180 == 90:
        w, h = h, w
    audio = any(s.get('codec_type') == 'audio' for s in info['streams'])
    return {'w': w, 'h': h, 'duration': float(info['format'].get('duration') or video.get('duration') or 0),
            'audio': audio, 'vcodec': video.get('codec_name'), 'pix': video.get('pix_fmt'), 'profile': video.get('profile')}


def faststart_ok(path):
    """Atome « moov » avant « mdat » : sinon l'iPhone attend tout le fichier avant de lire."""
    with open(path, 'rb') as f:
        head = f.read(1 << 20)
    moov, mdat = head.find(b'moov'), head.find(b'mdat')
    return moov != -1 and (mdat == -1 or moov < mdat)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('source')
    ap.add_argument('exercice', help='nom exact de la bibliothèque (ex. « Squat barre »)')
    ap.add_argument('--coach', required=True, help='pseudo Instagram du coach, sans @')
    ap.add_argument('--debut', type=float, default=0)
    ap.add_argument('--fin', type=float)
    ap.add_argument('--affiche', type=float)
    ap.add_argument('--sans-son', action='store_true')
    ap.add_argument('--sortie', default=os.path.expanduser('~/mdlf-videos'))
    ap.add_argument('--crf', type=int, default=26)
    a = ap.parse_args(argv)

    for tool in ('ffmpeg', 'ffprobe'):
        if not shutil.which(tool):
            sys.exit(f'{tool} introuvable : installer ffmpeg')
    if not re.fullmatch(r'[A-Za-z0-9._]{1,30}', a.coach.lstrip('@')):
        sys.exit('--coach : pseudo de 1 à 30 caractères (lettres, chiffres, point, tiret bas)')
    coach = a.coach.lstrip('@')
    catalogue = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js', 'data', 'exercise-catalogue.js')
    if os.path.exists(catalogue) and f"'{a.exercice}'" not in open(catalogue, encoding='utf-8').read():
        print(f'Attention : « {a.exercice} » ne figure pas tel quel dans js/data/exercise-catalogue.js '
              '(le manifeste doit utiliser le nom exact de la bibliothèque)', file=sys.stderr)
    src = probe(a.source)
    end = min(a.fin, src['duration']) if a.fin else src['duration']
    length = end - a.debut
    if length < 1:
        sys.exit(f'Durée retenue trop courte ({length:.1f} s)')
    if length > MAX_SECONDS:
        sys.exit(f'Durée retenue {length:.0f} s : {MAX_SECONDS} s au plus (couper avec --debut / --fin)')

    os.makedirs(a.sortie, exist_ok=True)
    base = os.path.join(a.sortie, slug(a.exercice))
    mp4, jpg = base + '.mp4', base + '.jpg'
    # 720 px sur le petit côté (paysage 1280 × 720, portrait 720 × 1280), jamais agrandie, dimensions paires
    short = min(src['w'], src['h'])
    target = min(720, short - short % 2)
    scale = f'scale=-2:{target}' if src['w'] >= src['h'] else f'scale={target}:-2'
    cut = ['-ss', f'{a.debut:.3f}', '-t', f'{length:.3f}']
    audio = ['-an'] if a.sans_son or not src['audio'] else ['-c:a', 'aac', '-b:a', '96k', '-ac', '2']
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *cut, '-i', a.source, '-vf', f'{scale},fps=30,format=yuv420p',
                    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-preset', 'slow', '-crf', str(a.crf),
                    '-maxrate', '2500k', '-bufsize', '5000k', '-g', '60', *audio,
                    '-movflags', '+faststart', '-map_metadata', '-1', mp4], check=True)
    at = a.affiche - a.debut if a.affiche is not None else length / 3
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{max(0, min(at, length - 0.1)):.3f}', '-i', mp4,
                    '-frames:v', '1', '-q:v', '4', jpg], check=True)

    out = probe(mp4)
    problems = []
    if out['vcodec'] != 'h264' or out['pix'] != 'yuv420p':
        problems.append(f"codec {out['vcodec']} / {out['pix']} (attendu h264 / yuv420p)")
    if not faststart_ok(mp4):
        problems.append('index « moov » pas en tête (faststart)')
    if problems:
        sys.exit('Vidéo produite non conforme : ' + ' ; '.join(problems))
    mb = os.path.getsize(mp4) / 1e6
    print(f'{mp4}  {out["w"]}×{out["h"]}  {out["duration"]:.1f} s  {mb:.1f} Mo' + (' (lourd : baisser la qualité, --crf 28)' if mb > WARN_MB else ''))
    print(f'{jpg}  {os.path.getsize(jpg) / 1e3:.0f} ko')
    entry = {a.exercice: {'src': os.path.basename(mp4), 'poster': os.path.basename(jpg), 'duration': round(out['duration']),
                          'coach': coach, 'width': out['w'], 'height': out['h']}}
    print('\nEntrée pour data/exercise-videos.json (dans "videos") :')
    print(json.dumps(entry, ensure_ascii=False, indent=2)[1:-1].strip())
    return entry


if __name__ == '__main__':
    main()
