#!/usr/bin/env python3
"""Atlas détaillé du personnage (img/body2/) : copie depuis l'export de mdlf-perso et données de l'app.

    python3 tools/gen-body2.py [~/mdlf-perso/out/detail_final]

Lit l'export « detail_final » de mdlf-perso (src/export_detail.py : manifest.json, puis par sexe et par vue
base.webp, base@3x.webp, p3/<sous-muscle>.webp recadrés, lines@3x.webp, hit.png) et écrit :
  img/body2/manifest.json                 copie du manifest (tailles, boîtes 3×, noms, parents, deep)
  img/body2/<sexe>/<vue>/base.webp        corps gris 1× (affiché dans la fiche exercice, sans zoom)
  img/body2/<sexe>/<vue>/p/<id>.webp      sous-muscles 1×, RÉDUITS ici depuis p3 (boîte 1× alignée)
  img/body2/<sexe>/<vue>/base@3x.webp     \
  img/body2/<sexe>/<vue>/p3/<id>.webp      } 3×, chargés au premier zoom seulement (js/ui/body-zoom.js)
  img/body2/<sexe>/<vue>/lines@3x.webp    /
  img/body2/<sexe>/<vue>/hit.png          carte d'indices (1 + rang dans parts, 0 = rien) pour le toucher
  js/data/body-parts.js                   BODY_PARTS : noms, parents, profonds, boîtes 1× et 3× par vue
  sw.js                                   bloc « body2 1× » de ASSETS (1× et cartes de toucher, jamais le 3×)

Les calques 1× des 18 muscles (m/) et leurs versions 3× (m3/) ne sont pas copiés : la fiche colore toujours
des sous-muscles (un muscle sans détail = tous ses sous-muscles, js/data/atlas.js), m/ et m3/ ne serviraient pas.
Formes d'après BodyParts3D, © The Database Center for Life Science, CC BY 4.0, modifiées (crédit : Réglages,
mentions légales).
"""
import json
import math
import os
import re
import shutil
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/mdlf-perso/out/detail_final')
OUT = os.path.join(ROOT, 'img', 'body2')
SEXES, VIEWS = ('male', 'female'), ('front', 'back')
Q1, QA1 = 78, 70   # qualité WebP des sous-muscles 1× (ombrage gris, alpha) : ~30 % de moins qu'à 82/100


def box1(b):
    """Boîte 3× → plus petite boîte 1× entière qui la contient."""
    return [b[0] // 3, b[1] // 3, math.ceil(b[2] / 3), math.ceil(b[3] / 3)]


def reduce_part(src, b3, out):
    """Sous-muscle 3× recadré → 1×, aligné sur la grille 1× (alpha prémultiplié : pas de liseré sombre)."""
    b = box1(b3)
    can = Image.new('RGBA', ((b[2] - b[0]) * 3, (b[3] - b[1]) * 3), (0, 0, 0, 0))
    can.paste(Image.open(src).convert('RGBA'), (b3[0] - b[0] * 3, b3[1] - b[1] * 3))
    small = can.convert('RGBa').resize((b[2] - b[0], b[3] - b[1]), Image.LANCZOS).convert('RGBA')
    small.save(out, 'WEBP', quality=Q1, alpha_quality=QA1, method=6)
    return b


def main():
    man = json.load(open(os.path.join(SRC, 'manifest.json'), encoding='utf-8'))
    assert man['w3'] == man['w'] * 3 and man['h3'] == man['h'] * 3, 'manifest : 3× attendu'
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    shutil.copyfile(os.path.join(SRC, 'manifest.json'), os.path.join(OUT, 'manifest.json'))
    ids = [p['id'] for p in man['parts']]
    boxes, urls = {}, []
    for sex in SEXES:
        boxes[sex] = {}
        for view in VIEWS:
            s, d = os.path.join(SRC, sex, view), os.path.join(OUT, sex, view)
            os.makedirs(os.path.join(d, 'p'))
            os.makedirs(os.path.join(d, 'p3'))
            for f in ('base.webp', 'base@3x.webp', 'lines@3x.webp', 'hit.png'):
                shutil.copyfile(os.path.join(s, f), os.path.join(d, f))
            parts = man['bodies'][sex][view]['parts']
            entry = {}
            for pid in ids:            # ordre du manifest : ordre d'empilement des calques
                if pid not in parts:
                    continue
                b3 = parts[pid]
                shutil.copyfile(os.path.join(s, 'p3', f'{pid}.webp'), os.path.join(d, 'p3', f'{pid}.webp'))
                b1 = reduce_part(os.path.join(s, 'p3', f'{pid}.webp'), b3, os.path.join(d, 'p', f'{pid}.webp'))
                entry[pid] = [b1, b3]
                urls.append(f'/img/body2/{sex}/{view}/p/{pid}.webp')
            boxes[sex][view] = entry
            urls[:0] = [f'/img/body2/{sex}/{view}/base.webp', f'/img/body2/{sex}/{view}/hit.png']
    write_js(man, boxes)
    write_sw(sorted(urls))
    print(f'img/body2 : {len(urls)} fichiers 1× en cache d\'installation, {sum(len(v) for b in boxes.values() for v in b.values())} calques')


def write_js(man, boxes):
    parts = [{k: p[k] for k in ('id', 'name', 'latin', 'parent', 'deep') if p.get(k) is not None} for p in man['parts']]
    js = f"""// ═══════════════════════════════════════════════════════════
//  Atlas du personnage : sous-muscles, noms et boîtes des calques (FICHIER GÉNÉRÉ)
// ═══════════════════════════════════════════════════════════
'use strict';

// Généré par tools/gen-body2.py depuis img/body2/manifest.json (export de mdlf-perso, src/export_detail.py) :
// ne pas modifier à la main, relancer le script. Formes d'après BodyParts3D, © The Database Center for Life
// Science, CC BY 4.0, modifiées.
//   w, h        taille d'une vue en 1× (3× : w3, h3) ; hit : taille de la carte de toucher (hit.png)
//   parts       sous-muscles dans l'ordre d'empilement : id, name (nom de salle), latin (nom officiel),
//               parent (muscle de l'app, js/data/muscles.js ; null : muscle seulement nommé au toucher),
//               deep (profond : jamais de zone de toucher, montré seulement quand l'exercice le travaille)
//   boxes       par sexe et vue : {{ id: [boîte 1× de p/<id>.webp, boîte 3× de p3/<id>.webp] }}, en pixels
//               [x0, y0, x1, y1] de la vue ; un sous-muscle absent d'une vue n'y a pas de calque
const BODY_PARTS = {json.dumps({'w': man['w'], 'h': man['h'], 'w3': man['w3'], 'h3': man['h3'], 'hit': man['hit'], 'parts': parts, 'boxes': boxes}, ensure_ascii=False, separators=(',', ':'))};
"""
    open(os.path.join(ROOT, 'js', 'data', 'body-parts.js'), 'w', encoding='utf-8').write(js)


def write_sw(urls):
    path = os.path.join(ROOT, 'sw.js')
    sw = open(path, encoding='utf-8').read()
    lines, row = [], []
    for u in urls:
        row.append(f"'{u}'")
        if len(row) == 4:
            lines.append('  ' + ', '.join(row) + ',')
            row = []
    if row:
        lines.append('  ' + ', '.join(row) + ',')
    block = '  // <body2-1x> (tools/gen-body2.py) atlas de la fiche exercice en 1× et cartes de toucher ; le 3× n\'est pas\n' \
            '  // ici : mis en cache au premier zoom par la règle « cache d\'abord » du fetch (plus bas)\n' + '\n'.join(lines) + '\n  // </body2-1x>\n'
    pat = re.compile(r'  // <body2-1x>.*?// </body2-1x>\n', re.S)
    if pat.search(sw):
        sw = pat.sub(lambda _: block, sw)
    else:
        anchor = '  // Groupes de muscles illustrés'
        assert anchor in sw, 'sw.js : point d\'insertion introuvable'
        sw = sw.replace(anchor, block + anchor, 1)
    open(path, 'w', encoding='utf-8').write(sw)


if __name__ == '__main__':
    main()
