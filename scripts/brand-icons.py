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
  ios/App/Watch/Assets.xcassets/AppIcon.appiconset                icône de l'app Apple Watch (1024 opaque)
  android/app/src/main/res/                                       icône adaptative (premier plan, monochrome,
                                                                  fond), écran de démarrage, icône des notifications
  android/store/                                                  icône 512 et image de présentation de la fiche Play
et met à jour ASSETCATALOG_COMPILER_ALTERNATE_APP_ICON_NAMES dans le projet Xcode.

Déterministe : mêmes entrées, mêmes octets. Dépendances : Node, CairoSVG, Pillow.
Lancer depuis n'importe où :  python3 scripts/brand-icons.py            (tout)
                              python3 scripts/brand-icons.py --android  (Android seulement, iOS intact)
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
WATCH_ICON_SET = os.path.join(ROOT, 'ios', 'App', 'Watch', 'Assets.xcassets', 'AppIcon.appiconset')
PBXPROJ = os.path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj')
ANDROID_RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
ANDROID_STORE = os.path.join(ROOT, 'android', 'store')

SPLASH_BG = '#111111'     # fond de l'écran de démarrage (celui de l'icône par défaut)
SPLASH_SIZE = 2732        # carré qui couvre tous les écrans (contentMode scaleAspectFill)
SPLASH_SCALE = 0.22       # signe d'environ 520 px de large sur 2732 (≈ 150 pt à l'écran)
TINTED_GLYPH = '#FFFFFF'  # icône teintée : signe en niveaux de gris (blanc = teinte pleine)

# Android (developer.android.com/develop/ui/views/launch/icon_design_adaptive) : calques de 108 dp dont
# seuls les 72 dp du centre sont visibles et les 66 dp garantis, quel que soit le masque du fabricant.
ANDROID_DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
ADAPTIVE_DP = 108
ADAPTIVE_SCALE = 0.5      # signe d'environ 54 dp de large : dans la zone sûre de 66 dp
SPLASH_ICON_DP = 288      # icône de l'écran de démarrage d'Android 12 : 288 dp, visible dans un cercle de 192 dp
SPLASH_ICON_SCALE = 0.42  # signe d'environ 120 dp, dans le cercle visible
NOTIF_DP = 24             # petite icône des notifications : blanc sur transparent (seul l'alpha compte)
ANDROID_BLACK = '#000000' # noir pur de l'interface (écran de démarrage, fiche Play)

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


def android_assets(svgs, default):
    """Icône adaptative, écran de démarrage, icône des notifications et images de la fiche Play."""
    print('Android : icône adaptative (premier plan, monochrome) et icône des notifications')
    for name in os.listdir(ANDROID_RES):   # images d'exemple de Capacitor remplacées par celles de la marque
        folder = os.path.join(ANDROID_RES, name)
        for f in ('ic_launcher.png', 'ic_launcher_round.png', 'splash.png'):
            if os.path.isfile(os.path.join(folder, f)):
                os.remove(os.path.join(folder, f))
        if name.startswith('drawable-land') or name.startswith('drawable-port'):
            if not os.listdir(folder):
                os.rmdir(folder)
    for f in ('drawable/ic_launcher_background.xml', 'drawable-v24/ic_launcher_foreground.xml'):
        path = os.path.join(ANDROID_RES, f)
        if os.path.isfile(path):
            os.remove(path)
            if not os.listdir(os.path.dirname(path)):
                os.rmdir(os.path.dirname(path))
    notif = png(svgs['android-notif'], 1024, 'RGBA')
    notif = notif.crop(notif.getchannel('A').getbbox())
    for density, k in ANDROID_DENSITIES.items():
        size = round(ADAPTIVE_DP * k)
        save(png(svgs['android-fg'], size, 'RGBA'), os.path.join(ANDROID_RES, f'mipmap-{density}', 'ic_launcher_foreground.png'))
        save(png(svgs['android-mono'], size, 'RGBA'), os.path.join(ANDROID_RES, f'mipmap-{density}', 'ic_launcher_monochrome.png'))
        box = round(NOTIF_DP * k)
        side = max(notif.width, notif.height)
        square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        square.paste(notif, ((side - notif.width) // 2, (side - notif.height) // 2))
        save(square.resize((box, box), Image.LANCZOS), os.path.join(ANDROID_RES, f'drawable-{density}', 'ic_stat_mdlf.png'))
    adaptive = ('<?xml version="1.0" encoding="utf-8"?>\n'
                '<!-- Généré par scripts/brand-icons.py : ne pas modifier -->\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@color/ic_launcher_background"/>\n'
                '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
                '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n'
                '</adaptive-icon>\n')
    for f in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        write_text(os.path.join(ANDROID_RES, 'mipmap-anydpi-v26', f), adaptive)
    write_text(os.path.join(ANDROID_RES, 'values', 'ic_launcher_background.xml'),
               '<?xml version="1.0" encoding="utf-8"?>\n<!-- Généré par scripts/brand-icons.py : fond de l\'icône par défaut -->\n'
               f'<resources>\n    <color name="ic_launcher_background">{default["bg"]}</color>\n</resources>\n')

    print('Android : écran de démarrage (fond noir pur, signe au centre)')
    save(png(svgs['android-splash'], round(SPLASH_ICON_DP * 4), 'RGBA'),
         os.path.join(ANDROID_RES, 'drawable-xxxhdpi', 'splash_icon.png'))
    write_text(os.path.join(ANDROID_RES, 'drawable', 'splash.xml'),
               '<?xml version="1.0" encoding="utf-8"?>\n'
               '<!-- Généré par scripts/brand-icons.py : écran de démarrage avant Android 12 et fond du thème -->\n'
               '<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n'
               '    <item android:drawable="@color/mdlf_black"/>\n'
               '    <item android:gravity="center" android:width="288dp" android:height="288dp" android:drawable="@drawable/splash_icon"/>\n'
               '</layer-list>\n')

    print('Android : fiche Google Play (icône 512 × 512, image de présentation 1024 × 500)')
    save(png(svgs['default'], 512, 'RGB'), os.path.join(ANDROID_STORE, 'play-icon-512.png'))
    feature = Image.new('RGB', (1024, 500), ANDROID_BLACK)
    glyph = png(svgs['android-feature'], 500, 'RGBA')
    feature.paste(glyph, (262, 0), glyph)
    save(feature, os.path.join(ANDROID_STORE, 'play-feature-1024x500.png'))


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(text)
    print('  ' + os.path.relpath(path, ROOT))


def main():
    android_only = '--android' in sys.argv[1:]
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
        {'key': 'android-fg', 'id': default['id'], 'options': {'background': False, 'scale': ADAPTIVE_SCALE}},
        {'key': 'android-mono', 'id': default['id'], 'options': {'background': False, 'color': TINTED_GLYPH, 'scale': ADAPTIVE_SCALE}},
        {'key': 'android-notif', 'id': default['id'], 'options': {'background': False, 'color': '#FFFFFF', 'scale': 1}},
        {'key': 'android-splash', 'id': default['id'], 'options': {'background': False, 'scale': SPLASH_ICON_SCALE}},
        {'key': 'android-feature', 'id': default['id'], 'options': {'background': False, 'scale': 0.6}},
    ] + [{'key': 'alt:' + i['id'], 'id': i['id']} for i in icons[1:]]
    res = node_render(spec)
    svgs = res['svgs']

    if os.path.isdir(ANDROID_RES):
        android_assets(svgs, default)
    if android_only:
        return

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

    print('watchOS : icône de l\'app de la montre (la même, opaque : watchOS la découpe en rond)')
    save(png(svgs['default'], 1024, 'RGB'), os.path.join(WATCH_ICON_SET, 'AppIcon.png'))
    write_json(os.path.join(WATCH_ICON_SET, 'Contents.json'), {'images': [
        {'filename': 'AppIcon.png', 'idiom': 'universal', 'platform': 'watchos', 'size': '1024x1024'}],
        'info': {'author': 'xcode', 'version': 1}})

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
