#!/usr/bin/env python3
"""Base d'aliments embarquée (data/foods.json) tirée de la table Ciqual 2025 de l'Anses.

Source : Anses. 2025. Table de composition nutritionnelle des aliments Ciqual (version du 03/11/2025),
https://doi.org/10.57745/RDMHWY, Licence Ouverte Etalab 2.0 (réutilisation libre avec mention de la source
et de la version, données non altérées). Fichier lu : « Table Ciqual 2025_FR_2025_11_03.xlsx ».

Lancer depuis la racine du dépôt, le fichier téléchargé rangé dans un dossier à part (jamais dans le dépôt) :
    python3 -I scripts/prepare-foods.py /chemin/vers/Table_Ciqual_2025_FR.xlsx data/foods.json

Bibliothèque standard seulement (zipfile + xml.etree), déterministe : même fichier, même sortie.
Règles de lecture (documentation Ciqual 2025, pages 9, 10 et 16) :
  - « - » : valeur inconnue, jamais zéro. Un aliment sans protéines, glucides ou lipides connus est écarté ;
    énergie inconnue : recalculée par les coefficients du règlement UE 1169/2011 (4, 4, 9 kcal par g) ;
  - « traces » : 0 ; « < x » : 0 (sous la limite de quantification, négligeable pour un plan diète) ;
  - virgule décimale ; valeurs gardées à 1 décimale (kcal entières), sans autre retouche.
Protéines : « N x facteur de Jones » (valeur de référence de Ciqual). Énergie : règlement UE 1169/2011.
Colonnes écrites : code, nom, famille, kcal, protéines, glucides, lipides, sucres (null si inconnus),
sous-groupe Ciqual (entier, 301 = pâtes, riz et céréales).
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
    'p': lambda h: h.startswith('Protéines') and 'Jones' in h,
    'c': lambda h: h.startswith('Glucides'),
    'f': lambda h: h.startswith('Lipides'),
    's': lambda h: h.startswith('Sucres'),
}


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
        kcal = value(r.get(head['kcal']))
        if kcal is None:
            kcal = 4 * p + 4 * c + 9 * f
        sugar = value(r.get(head['s']))
        # Sucres (null si inconnus) et sous-groupe Ciqual : départagent les remplaçants (même rayon d'abord)
        foods.append([int(code), name, fam, round(kcal), round(p, 1), round(c, 1), round(f, 1),
                      None if sugar is None else round(sugar, 1), int(r.get(head['grp']))])
    foods.sort(key=lambda x: x[0])
    out = {
        'v': 1,
        'source': 'Anses. 2025. Table de composition nutritionnelle des aliments Ciqual',
        'version': 'Ciqual 2025, version du 03/11/2025',
        'licence': 'Licence Ouverte Etalab 2.0',
        'url': 'https://doi.org/10.57745/RDMHWY',
        'cols': ['code', 'nom', 'fam', 'kcal', 'p', 'g', 'l', 'sucres', 'ssgrp'],
        'foods': foods,
    }
    with open(dst, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write('\n')
    print(f'{len(foods)} aliments écrits dans {dst}, {skipped} écartés')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
