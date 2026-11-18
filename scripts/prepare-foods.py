#!/usr/bin/env python3
"""Base d'aliments embarquée (data/foods.json) tirée de la table Ciqual 2025 de l'Anses.

Source : Anses. 2025. Table de composition nutritionnelle des aliments Ciqual (version du 03/11/2025),
https://doi.org/10.57745/RDMHWY, Licence Ouverte Etalab 2.0 (réutilisation libre avec mention de la source
et de la version, données non altérées). Fichier lu : « Table Ciqual 2025_FR_2025_11_03.xlsx ».

Lancer depuis la racine du dépôt, le fichier téléchargé rangé dans un dossier à part (jamais dans le dépôt) :
    python3 -I scripts/prepare-foods.py /chemin/vers/Table_Ciqual_2025_FR.xlsx data/foods.json

Bibliothèque standard seulement (zipfile + xml.etree), déterministe : même fichier, même sortie.
Lecture (conventions de la documentation Ciqual 2025, pages 9, 10 et 16, puis choix de l'app) :
  - « - » : valeur inconnue, jamais zéro (Ciqual). Un aliment sans protéines, glucides ou lipides connus est écarté ;
  - « traces » et « < x » : Ciqual les donne comme « détecté, non quantifiable » et « sous la limite x » ;
    l'app les compte pour 0 (choix de l'app : quantités négligeables pour un plan diète) ;
  - virgule décimale ; valeurs gardées à 1 décimale (kcal entières), sans autre retouche.
Protéines : « N x 6,25 », la valeur de l'étiquetage et celle qu'utilise l'énergie du règlement UE 1169/2011
(Ciqual donne aussi « N x facteur de Jones », plus juste pour la biologie mais incohérente avec l'énergie).
Énergie : colonne « Règlement UE N° 1169/2011 (kcal) ». Inconnue : recalculée par les coefficients du même
règlement, 4 P + 4 G + 9 L + 2 fibres + 7 alcool, SEULEMENT si protéines, fibres et alcool sont connus ; sinon
l'aliment est écarté (une eau-de-vie dont l'alcool est inconnu donnerait 0 kcal). Ces aliments portent e = 1.
Colonnes écrites : code, nom, famille, kcal, protéines, glucides, lipides, sucres (null si inconnus),
sous-groupe Ciqual (entier, 301 = pâtes, riz et céréales), e (1 : énergie calculée par l'app), sel (g pour 100 g,
« Sel chlorure de sodium », null si inconnu ; « traces » et « < x » : 0, comme les autres colonnes).
Alias (ALIASES) : [nom, code], écrits à part ; une app qui ne les connaît pas les ignore.
Aliments infantiles (groupe 11) et ligne « aliment moyen » (groupe 00) écartés.

Famille d'équivalence (colonne « fam », règle des remplacements : docs/NUTRITION_V1.md, js/data/food-swap.js),
tirée du sous-groupe Ciqual :
  v viandes, poissons, œufs, alternatives végétales   f féculents (tubercules, légumineuses, céréales, pains)
  l laitiers (laits, frais, fromages)                 g matières grasses (beurres, huiles, crèmes, oléagineux)
  r fruits        e légumes et soupes        s produits sucrés et glaces        b boissons
  p plats composés et sandwichs              a aides culinaires, sauces, épices (jamais remplacés)
"""
import json
import re
from decimal import Decimal, ROUND_HALF_UP
import sys
import zipfile
import xml.etree.ElementTree as ET

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

FAMILY = {
    '0101': 'e', '0102': 'e', '0103': 'p', '0104': 'p', '0105': 'p', '0106': 'p',
    '0201': 'e', '0202': 'f', '0203': 'f', '0204': 'r', '0205': 'g',
    '0301': 'f', '0302': 'f', '0303': 's', '0304': 'f', '0305': 'p',
    '0401': 'v', '0402': 'v', '0403': 'v', '0404': 'v', '0405': 'v', '0406': 'v', '0407': 'v', '0408': 'v',
    '0409': 'v', '0410': 'v',
    '0501': 'l', '0502': 'l', '0503': 'l', '0504': 'g',
    '0601': 'b', '0602': 'b', '0603': 'b',
    '0701': 's', '0702': 's', '0703': 's', '0704': 's', '0705': 's', '0706': 's', '0707': 'f', '0708': 's', '0709': 's',
    '0801': 's', '0802': 's', '0803': 's',
    '0901': 'g', '0902': 'g', '0903': 'g', '0904': 'g', '0905': 'g',
}
# Colonnes cherchées par mot-clé (les en-têtes contiennent des retours à la ligne)
COLS = {
    'grp': lambda h: h == 'alim_ssgrp_code',
    'code': lambda h: h == 'alim_code',
    'name': lambda h: h == 'alim_nom_fr',
    'kcal': lambda h: h.startswith('Energie') and '1169' in h and 'kcal' in h,
    'p': lambda h: h.startswith('Protéines') and '6.25' in h,
    'fib': lambda h: h.startswith('Fibres'),
    'alc': lambda h: h.startswith('Alcool'),
    'c': lambda h: h.startswith('Glucides'),
    'f': lambda h: h.startswith('Lipides'),
    's': lambda h: h.startswith('Sucres'),
    # « Sel chlorure de sodium (g/100 g) » (le sel des étiquettes ; Ciqual donne aussi le sodium en mg)
    'salt': lambda h: h.startswith('Sel chlorure de sodium'),
}

# Alias recherchables : un nom courant en salle pour un aliment Ciqual dont les valeurs conviennent, sans aucune valeur
# inventée. L'app affiche le nom de l'alias et, dessous, l'aliment Ciqual dont viennent les valeurs (« Valeurs Ciqual :
# Farine de riz »). Ajouter un alias seulement si l'aliment Ciqual est vraiment le même produit (« blanc de poulet » =
# filet de poulet), jamais un voisin (whey ≠ lactosérum en poudre, skyr ≠ fromage blanc : absents de Ciqual)
ALIASES = [
    ('Crème de riz', 9520),               # farine de riz fine, vendue « crème de riz » en salle : Farine de riz
    ('Blanc de poulet, cru', 36017),      # Poulet, filet sans peau cru
    ('Blanc de poulet, grillé', 36018),   # Poulet, filet sans peau grillé/poêlé
    ('Filet de poulet, cru', 36017),
    ('Filet de poulet, grillé', 36018),
    ('Blanc de dinde, grillé', 36306),    # Dinde, escalope grillée/poêlée
    ('Porridge à l\'eau', 9313),          # Flocons d'avoine bouillis/cuits à l'eau
    ('Lait d\'amande', 18107),            # Boisson à l'amande, nature, sans sucres ajoutés
]


def read_sheet(path):
    z = zipfile.ZipFile(path)
    strings = [''.join(t.text or '' for t in si.iter(M + 't'))
               for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(M + 'si')]
    rows = ET.fromstring(z.read('xl/worksheets/sheet1.xml')).find(M + 'sheetData').findall(M + 'row')
    out = []
    for r in rows:
        vals = {}
        for cell in r.findall(M + 'c'):
            col = re.sub(r'\d', '', cell.get('r'))
            v = cell.find(M + 'v')
            if v is None:
                continue
            vals[col] = strings[int(v.text)] if cell.get('t') == 's' else v.text
        out.append(vals)
    return out


def value(raw):
    """Teneur Ciqual → nombre, 0 (traces, « < x ») ou None (inconnue)."""
    if raw is None:
        return None
    t = str(raw).strip().replace(',', '.')
    if t in ('', '-'):
        return None
    if t.lower() == 'traces' or t.startswith('<'):
        return 0.0
    try:
        return float(t)
    except ValueError:
        return None


def half_up(v, step):
    """Arrondi au plus proche, demi vers le haut (0,045 g → 0,05 g ; round() de Python donnerait 0,04)."""
    return float(Decimal(repr(v)).quantize(Decimal(step), rounding=ROUND_HALF_UP))


def clean_name(name):
    return re.sub(r'\s+', ' ', str(name or '')).strip()


def main(src, dst):
    rows = read_sheet(src)
    head = {k: next(col for col, h in rows[0].items() if test(clean_name(h).replace('\n', ' ')))
            for k, test in COLS.items()}
    foods, skipped = [], 0
    for r in rows[1:]:
        fam = FAMILY.get(str(r.get(head['grp'], '')))
        name = clean_name(r.get(head['name']))
        code = str(r.get(head['code'], '')).strip()
        if not fam or not name or not code.isdigit():
            skipped += 1
            continue
        p, c, f = (value(r.get(head[k])) for k in ('p', 'c', 'f'))
        if p is None or c is None or f is None:
            skipped += 1
            continue
        kcal, calc = value(r.get(head['kcal'])), 0
        if kcal is None:
            fib, alc = value(r.get(head['fib'])), value(r.get(head['alc']))
            if fib is None or alc is None:
                skipped += 1
                continue
            kcal, calc = 4 * p + 4 * c + 9 * f + 2 * fib + 7 * alc, 1
        sugar, salt = value(r.get(head['s'])), value(r.get(head['salt']))
        # Sucres (null si inconnus) et sous-groupe Ciqual : départagent les remplaçants (même rayon d'abord)
        foods.append([int(code), name, fam, round(kcal), round(p, 1), round(c, 1), round(f, 1),
                      None if sugar is None else round(sugar, 1), int(r.get(head['grp'])), calc,
                      None if salt is None else half_up(salt, '0.01')])
    foods.sort(key=lambda x: x[0])
    out = {
        'v': 1,
        'source': 'Anses. 2025. Table de composition nutritionnelle des aliments Ciqual',
        'version': 'Ciqual 2025, version du 03/11/2025',
        'licence': 'Licence Ouverte Etalab 2.0',
        'url': 'https://doi.org/10.57745/RDMHWY',
        'cols': ['code', 'nom', 'fam', 'kcal', 'p', 'g', 'l', 'sucres', 'ssgrp', 'e', 'sel'],
        'foods': foods,
        'alias': [[name, code] for name, code in ALIASES if any(f[0] == code for f in foods)],
    }
    with open(dst, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write('\n')
    print(f'{len(foods)} aliments écrits dans {dst}, {skipped} écartés')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
