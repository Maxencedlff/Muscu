#!/usr/bin/env python3
"""Génère toutes les images de la marque à partir du catalogue js/data/app-icons.js.

Source unique : le dessin du signe (appIconGlyph / appIconSvg) et le catalogue des icônes
(APP_ICONS) sont dans js/data/app-icons.js, le fichier que l'app utilise pour ses vignettes.
Ce script le charge avec Node (même principe que tests/unit/run.mjs), demande les SVG voulus,
puis les rend en PNG avec CairoSVG.

Produit (et écrase) :
  icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png     PWA (icône par défaut)
  ios/App/App/Assets.xcassets/AppIcon.appiconset                  1024 clair (opaque), sombre, teinté
  ios/App/App/Assets.xcassets/AppIcon-*.appiconset                icônes alternatives (1024 opaques)
  ios/App/App/Assets.xcassets/Splash.imageset                     écran de démarrage 2732 × 2732
  ios/App/RestActivity/Assets.xcassets/MDLFMark.imageset          marque de la Live Activity (gabarit)
et met à jour ASSETCATALOG_COMPILER_ALTERNATE_APP_ICON_NAMES dans le projet Xcode.

Déterministe : mêmes entrées, mêmes octets. Dépendances : Node, CairoSVG, Pillow.
Lancer depuis n'importe où :  python3 scripts/brand-icons.py
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys

import cairosvg
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOGUE = os.path.join(ROOT, 'js', 'data', 'app-icons.js')
XCASSETS = os.path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets')
MARK_SET = os.path.join(ROOT, 'ios', 'App', 'RestActivity', 'Assets.xcassets', 'MDLFMark.imageset')
PBXPROJ = os.path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj')

SPLASH_BG = '#111111'     # fond de l'écran de démarrage (celui de l'icône par défaut)
SPLASH_SIZE = 2732        # carré qui couvre tous les écrans (contentMode scaleAspectFill)
SPLASH_SCALE = 0.22       # signe d'environ 520 px de large sur 2732 (≈ 150 pt à l'écran)
TINTED_GLYPH = '#FFFFFF'  # icône teintée : signe en niveaux de gris (blanc = teinte pleine)

# Charge le catalogue dans un contexte vm et rend les SVG demandés (liste de { key, id, options })
NODE_RENDER = r"""
const fs = require('fs'), vm = require('vm');
const [file, spec] = process.argv.slice(1);
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(file, 'utf8') + '\nthis.out = { APP_ICONS, appIconSvg, alternateAppIconNames };', ctx);
const { APP_ICONS, appIconSvg, alternateAppIconNames } = ctx.out;
const svgs = {};
for (const { key, id, options } of JSON.parse(spec)) {
  const icon = APP_ICONS.find(i => i.id === id);
  if (!icon) throw new Error('icône inconnue : ' + id);
  svgs[key] = appIconSvg(icon, options || {});
}
process.stdout.write(JSON.stringify({ icons: APP_ICONS, alternates: alternateAppIconNames(), svgs }));
"""


def node_render(spec):
    out = subprocess.run(['node', '-e', NODE_RENDER, CATALOGUE, json.dumps(spec)],
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def png(svg, size, mode):
    """Rend un SVG carré en PNG size × size ; mode 'RGB' (opaque) ou 'RGBA'."""
    raw = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(raw)).convert(mode)


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, format='PNG', optimize=True)
    print('  ' + os.path.relpath(path, ROOT))


def write_json(path, obj):
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
        fh.write('\n')


def appiconset(name, images):
    """Jeu d'icônes iOS « single size » : images = [(fichier, Image, apparence | None)]."""
    folder = os.path.join(XCASSETS, f'{name}.appiconset')
    shutil.rmtree(folder, ignore_errors=True)
    entries = []
    for filename, img, appearance in images:
        save(img, os.path.join(folder, filename))
        entry = {'filename': filename, 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}
        if appearance:   # iOS 18 : variantes sombre et teintée
            entry = {'appearances': [{'appearance': 'luminosity', 'value': appearance}], **entry}
        entries.append(entry)
    write_json(os.path.join(folder, 'Contents.json'), {'images': entries, 'info': {'author': 'xcode', 'version': 1}})


def update_pbxproj(alternates):
    """Liste des icônes alternatives dans les réglages Debug et Release de la cible App."""
    with open(PBXPROJ, encoding='utf-8') as fh:
        text = fh.read()
    value = '"' + ' '.join(alternates) + '"'
    new, n = re.subn(r'(ASSETCATALOG_COMPILER_ALTERNATE_APP_ICON_NAMES = )[^;]*;', rf'\g<1>{value};', text)
    if n != 2:
        sys.exit(f'project.pbxproj : {n} réglage(s) ASSETCATALOG_COMPILER_ALTERNATE_APP_ICON_NAMES au lieu de 2 (Debug, Release)')
    if new != text:
        with open(PBXPROJ, 'w', encoding='utf-8') as fh:
            fh.write(new)
        print('  ios/App/App.xcodeproj/project.pbxproj (icônes alternatives)')


def main():
    probe = node_render([])
    icons = probe['icons']
    default = icons[0]
    assert default['asset'] == 'AppIcon', "la première icône du catalogue doit être l'icône par défaut (AppIcon)"

    spec = [
        {'key': 'default', 'id': default['id']},
        {'key': 'dark', 'id': default['id'], 'options': {'background': False}},
        {'key': 'tinted', 'id': default['id'], 'options': {'background': False, 'color': TINTED_GLYPH}},
        {'key': 'splash', 'id': default['id'], 'options': {'background': SPLASH_BG, 'scale': SPLASH_SCALE}},
        {'key': 'mark', 'id': default['id'], 'options': {'background': False, 'color': '#000000', 'scale': 1}},
    ] + [{'key': 'alt:' + i['id'], 'id': i['id']} for i in icons[1:]]
    res = node_render(spec)
    svgs = res['svgs']

    print('PWA')
    with open(os.path.join(ROOT, 'icon.svg'), 'w', encoding='utf-8') as fh:
        fh.write(svgs['default'] + '\n')
    print('  icon.svg')
    for name, size in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
        save(png(svgs['default'], size, 'RGB'), os.path.join(ROOT, name))

    print('iOS : icône par défaut (clair opaque, sombre et teinté transparents)')
    appiconset('AppIcon', [
        ('AppIcon.png', png(svgs['default'], 1024, 'RGB'), None),
        ('AppIcon-dark.png', png(svgs['dark'], 1024, 'RGBA'), 'dark'),
        ('AppIcon-tinted.png', png(svgs['tinted'], 1024, 'RGBA'), 'tinted'),
    ])

    print('iOS : icônes alternatives')
    keep = {'AppIcon.appiconset'} | {f"{i['asset']}.appiconset" for i in icons}
    for d in sorted(os.listdir(XCASSETS)):   # icône retirée du catalogue : jeu supprimé
        if d.endswith('.appiconset') and d not in keep:
            shutil.rmtree(os.path.join(XCASSETS, d))
            print('  supprimé : ' + d)
    for i in icons[1:]:
        appiconset(i['asset'], [(f"{i['asset']}.png", png(svgs['alt:' + i['id']], 1024, 'RGB'), None)])
    update_pbxproj(res['alternates'])

    print('iOS : écran de démarrage')
    splash = png(svgs['splash'], SPLASH_SIZE, 'RGB')
    for f in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
        save(splash, os.path.join(XCASSETS, 'Splash.imageset', f))

    print('iOS : marque de la Live Activity (image gabarit, seul le canal alpha compte)')
    mark = png(svgs['mark'], 1024, 'RGBA')
    mark = mark.crop(mark.getchannel('A').getbbox())
    for scale, height in (('2x', 40), ('3x', 60)):
        width = round(mark.width * height / mark.height)
        save(mark.resize((width, height), Image.LANCZOS), os.path.join(MARK_SET, f'MDLFMark@{scale}.png'))


if __name__ == '__main__':
    main()
