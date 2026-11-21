#!/usr/bin/env python3
"""Atlas détaillé du personnage (img/body2/) : copie depuis l'export de mdlf-perso et données de l'app.

    python3 tools/gen-body2.py [~/mdlf-perso/out/detail_final]

Lit l'export « detail_final » de mdlf-perso (src/export_detail.py : manifest.json, puis par sexe et par vue
base.webp, base@3x.webp, p3/<sous-muscle>.webp recadrés, lines@3x.webp, hit.png) et écrit :
  tools/body2-manifest.json               copie du manifest (tailles, boîtes 3×, noms, parents, deep) : hors de img/,
                                          pour ne partir ni dans l'OTA ni sur Vercel (l'app lit js/data/body-parts.js)
  img/body2/<sexe>/<vue>/base.webp        corps gris 1× (affiché dans la fiche exercice, sans zoom)
  img/body2/<sexe>/<vue>/p/<id>.webp      sous-muscles 1×, RÉDUITS ici depuis p3 (boîte 1× alignée)
  img/body2/<sexe>/<vue>/base@3x.webp     \
  img/body2/<sexe>/<vue>/p3/<id>.webp      } 3×, chargés au premier zoom seulement (js/ui/body-zoom.js)
  img/body2/<sexe>/<vue>/lines@3x.webp    /
  img/body2/<sexe>/<vue>/hit.png          carte d'indices (1 + rang dans parts, 0 = rien) pour le toucher
  js/data/body-parts.js                   BODY_PARTS : noms, parents, profonds, boîtes 1× et 3× par vue
  sw.js                                   bloc « body2 1× » de ASSETS (1× et cartes de toucher, jamais le 3×)

Jambes et fessiers : ombrage des calques éclairci au niveau du haut du corps (LEG_TONE).

Personnage femme, vue de face : le tissu mammaire n'est pas un muscle. Les calques des pectoraux (et ce qui passe
dessous) sont évidés sur le volume des seins, de même que les contours de lines@3x et la carte de toucher : le
pectoral ne se colore que sous et autour du sein, vers l'aisselle et le sternum (BREASTS, panel de l'affiche).

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

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/mdlf-perso/out/detail_final')
OUT = os.path.join(ROOT, 'img', 'body2')
MANIFEST = os.path.join(ROOT, 'tools', 'body2-manifest.json')
SEXES, VIEWS = ('male', 'female'), ('front', 'back')
Q1, QA1 = 78, 70   # qualité WebP des sous-muscles 1× (ombrage gris, alpha) : ~30 % de moins qu'à 82/100


# Volume des seins (personnage femme, face), en pixels 3× de la vue : ellipses relevées sur base@3x.webp (pli sous-mammaire,
# bord vers le sternum et vers l'aisselle), bord adouci. Calques évidés : pectoraux et ce qui passe dessous
BREASTS = {('female', 'front'): [(428, 696, 82, 70), (722, 696, 82, 70)]}
BREAST_PARTS = ('chest_sternal', 'chest_abdominal', 'chest_clavicular', 'pec_minor', 'serratus')
BREAST_FEATHER = 2   # bord net (pas de halo), sans marche d'escalier


# Jambes et fessiers : l'ombrage gris de leurs calques est plus sombre que celui du haut du corps (moyenne 112 à 135 sur
# 255, contre 165 à 178 aux pectoraux et aux épaules), d'autres éclairages dans le rendu de mdlf-perso. En clair (multiply),
# le ciblé y virait au rouge presque noir, bord sombre compris (panel atlas-bas t2 : « contour noir » chez la femme).
# Éclaircis ici vers LEG_TONE (gain borné à LEG_GAIN_MAX), le relief des fibres reste
LEG_PARTS = ('glute_max', 'glute_med', 'glute_min', 'tfl', 'sartorius', 'iliopsoas', 'rectus_femoris', 'vastus_lateralis',
             'vastus_medialis', 'vastus_intermedius', 'adductor_longus', 'adductor_brevis', 'adductor_magnus', 'gracilis',
             'pectineus', 'biceps_femoris_long', 'biceps_femoris_short', 'semitendinosus', 'semimembranosus', 'gastro_medial',
             'gastro_lateral', 'soleus', 'tibialis', 'itb', 'achilles', 'knee_tendons', 'peroneus')
LEG_TONE, LEG_GAIN_MAX = 165, 1.6


def leg_tone(src, out):
    """Calque 3× d'un sous-muscle de la jambe, son ombrage éclairci jusqu'à LEG_TONE en moyenne (alpha inchangé)."""
    img = Image.open(src).convert('RGBA')
    r, g, b, a = img.split()
    gray, mask = r.convert('L'), a.point(lambda v: 255 if v > 128 else 0)
    hist = gray.histogram(mask)
    n = sum(hist)
    mean = sum(i * c for i, c in enumerate(hist)) / n if n else LEG_TONE
    gain = min(LEG_GAIN_MAX, LEG_TONE / mean) if mean < LEG_TONE else 1
    if gain > 1:
        r, g, b = (ch.point(lambda v: min(255, round(v * gain))) for ch in (r, g, b))
    Image.merge('RGBA', (r, g, b, a)).save(out, 'WEBP', quality=90, alpha_quality=90, method=6)


def breast_keep(sex, view, size3):
    """Masque 3× (L) de la vue : 255 hors des seins, 0 dedans, bord adouci ; None sans seins."""
    if (sex, view) not in BREASTS:
        return None
    m = Image.new('L', size3, 255)
    dr = ImageDraw.Draw(m)
    for cx, cy, rx, ry in BREASTS[(sex, view)]:
        dr.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=0)
    return m.filter(ImageFilter.GaussianBlur(BREAST_FEATHER))


def cut_alpha(img, keep, box):
    """Image RGBA posée à box (3×) : alpha multiplié par le masque keep."""
    img = img.convert('RGBA')
    r, g, b, a = img.split()
    a = ImageChops.multiply(a, keep.crop((box[0], box[1], box[0] + img.width, box[1] + img.height)))
    return Image.merge('RGBA', (r, g, b, a))


def box1(b):
    """Boîte 3× → plus petite boîte 1× entière qui la contient."""
    return [b[0] // 3, b[1] // 3, math.ceil(b[2] / 3), math.ceil(b[3] / 3)]


def area1(path):
    """Aire visible d'un calque 1× : somme de son alpha, en pixels pleins (poids des muscles qui aident, js/ui/body-map.js)."""
    h = Image.open(path).convert('RGBA').getchannel('A').histogram()
    return round(sum(i * n for i, n in enumerate(h)) / 255)


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
    shutil.copyfile(os.path.join(SRC, 'manifest.json'), MANIFEST)
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
            keep = breast_keep(sex, view, (man['w3'], man['h3']))
            if keep:
                cut_breasts(d, keep, man, ids)
            entry = {}
            for pid in ids:            # ordre du manifest : ordre d'empilement des calques
                if pid not in parts:
                    continue
                b3 = parts[pid]
                if keep and pid in BREAST_PARTS:
                    cut_alpha(Image.open(os.path.join(s, 'p3', f'{pid}.webp')), keep, b3).save(
                        os.path.join(d, 'p3', f'{pid}.webp'), 'WEBP', quality=90, alpha_quality=90, method=6)
                elif pid in LEG_PARTS:
                    leg_tone(os.path.join(s, 'p3', f'{pid}.webp'), os.path.join(d, 'p3', f'{pid}.webp'))
                else:
                    shutil.copyfile(os.path.join(s, 'p3', f'{pid}.webp'), os.path.join(d, 'p3', f'{pid}.webp'))
                b1 = reduce_part(os.path.join(d, 'p3', f'{pid}.webp'), b3, os.path.join(d, 'p', f'{pid}.webp'))
                entry[pid] = [b1, b3, area1(os.path.join(d, 'p', f'{pid}.webp'))]
                urls.append(f'/img/body2/{sex}/{view}/p/{pid}.webp')
            boxes[sex][view] = entry
            urls[:0] = [f'/img/body2/{sex}/{view}/base.webp', f'/img/body2/{sex}/{view}/hit.png']
    write_js(man, boxes)
    write_sw(sorted(urls))
    print(f'img/body2 : {len(urls)} fichiers 1× en cache d\'installation, {sum(len(v) for b in boxes.values() for v in b.values())} calques')


def cut_breasts(d, keep, man, ids):
    """Contours des muscles (lines@3x) effacés sur les seins ; carte de toucher : les seins ne touchent aucun pectoral."""
    lines = os.path.join(d, 'lines@3x.webp')
    cut_alpha(Image.open(lines), keep, (0, 0)).save(lines, 'WEBP', quality=90, alpha_quality=90, method=6)
    hit_path = os.path.join(d, 'hit.png')
    hit = Image.open(hit_path)
    small = keep.resize(hit.size, Image.BILINEAR)
    cut = {ids.index(pid) + 1 for pid in BREAST_PARTS if pid in ids}
    px, k = hit.load(), small.load()
    for y in range(hit.height):
        for x in range(hit.width):
            if k[x, y] < 128 and px[x, y] in cut:
                px[x, y] = 0
    hit.save(hit_path)


def write_js(man, boxes):
    parts = [{k: p[k] for k in ('id', 'name', 'latin', 'parent', 'deep') if p.get(k) is not None} for p in man['parts']]
    js = f"""// ═══════════════════════════════════════════════════════════
//  Atlas du personnage : sous-muscles, noms et boîtes des calques (FICHIER GÉNÉRÉ)
// ═══════════════════════════════════════════════════════════
'use strict';

// Généré par tools/gen-body2.py depuis tools/body2-manifest.json (export de mdlf-perso, src/export_detail.py) :
// ne pas modifier à la main, relancer le script. Formes d'après BodyParts3D, © The Database Center for Life
// Science, CC BY 4.0, modifiées.
//   w, h        taille d'une vue en 1× (3× : w3, h3) ; hit : taille de la carte de toucher (hit.png)
//   parts       sous-muscles dans l'ordre d'empilement : id, name (nom de salle), latin (nom officiel),
//               parent (muscle de l'app, js/data/muscles.js ; null : muscle seulement nommé au toucher),
//               deep (profond : jamais de zone de toucher, montré seulement quand l'exercice le travaille)
//   boxes       par sexe et vue : {{ id: [boîte 1× de p/<id>.webp, boîte 3× de p3/<id>.webp, aire 1×] }}, boîtes en
//               pixels [x0, y0, x1, y1] de la vue, aire en pixels pleins (alpha) ; un sous-muscle absent d'une vue
//               n'y a pas de calque
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
