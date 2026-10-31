#!/usr/bin/env python3
"""Seuils du niveau de force (js/data/strength-standards.js) calculés depuis l'export OpenPowerlifting.

Données : export CSV officiel, domaine public (LICENSE.txt de l'archive :
« OpenPowerlifting data is contributed to the public domain »), téléchargé depuis
https://openpowerlifting.gitlab.io/opl-csv/bulk-csv.html. Les données brutes ne sont pas dans le dépôt :
seule la petite table résultante l'est. Méthode et choix des percentiles : docs/ENTRAINEMENT.md.

    python3 -I scripts/strength-standards.py chemin/openpowerlifting-latest.zip > js/data/strength-standards.js
    python3 -I scripts/strength-standards.py chemin/openpowerlifting-latest.zip --explore   # percentiles bruts

Population retenue, une ligne par compétiteur et par mouvement :
  - équipement « Raw » (sans genouillères, combinaison ni bandes), hommes et femmes ;
  - fédérations à contrôle antidopage (Tested = Yes) : plus proche d'un pratiquant naturel ;
  - âge connu de 18 à 49 ans, ou inconnu ;
  - meilleure tentative réussie de la PREMIÈRE compétition retenue de la personne dans ce mouvement (la
    première qui passe les filtres ci-dessus : quelqu'un qui a débuté en équipé ou avant 18 ans est pris à sa
    première compétition raw d'adulte) : on mesure quelqu'un qui débute en compétition après quelques années
    de salle, pas son record de carrière.
Le rapport charge ÷ poids du corps (pesée officielle) est ensuite découpé par sexe et catégorie de poids.
"""
import csv
import io
import json
import sys
import zipfile
from datetime import date

LIFTS = (('squat', 'Best3SquatKg'), ('bench', 'Best3BenchKg'), ('deadlift', 'Best3DeadliftKg'))
# Catégories IPF (borne haute en kg, None = au-delà) : assez de compétiteurs dans chacune
CLASSES = {
    'M': (59, 66, 74, 83, 93, 105, 120, None),
    'F': (47, 52, 57, 63, 69, 76, 84, None),
}
# Percentiles des compétiteurs (première compétition) pour Novice, Intermédiaire, Avancé, Élite.
# Débutant = sous le seuil Novice. Justification : docs/ENTRAINEMENT.md (« Niveau de force »).
PERCENTILES = (2, 15, 50, 90)
MIN_LIFTERS = 300           # en dessous, la catégorie n'est pas publiée
STEP = 0.05                 # rapports arrondis au 0,05 le plus proche


def class_of(sex, bw):
    """Indice de la catégorie de poids (la dernière, sans borne, prend tout ce qui dépasse)."""
    return next(i for i, top in enumerate(CLASSES[sex]) if top is None or bw <= top)


def to_float(s):
    try:
        return float(s)
    except (TypeError, ValueError):   # case vide, illisible ou absente (ligne trop courte)
        return None


def csv_name(z):
    names = [n for n in z.namelist() if n.endswith('.csv')]
    if not names:
        raise SystemExit("aucun CSV dans l'archive : est-ce bien l'export OpenPowerlifting ?")
    return names[0]


def first_meets(zip_path):
    """{(lift, sex, classe): [rapport, …]} : première compétition de chaque compétiteur, par mouvement."""
    first = {}   # (lift, nom) -> (date, sexe, poids, charge)
    with zipfile.ZipFile(zip_path) as z:
        with z.open(csv_name(z)) as raw:
            for row in csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8', newline='')):
                if row['Equipment'] != 'Raw' or row['Sex'] not in CLASSES or row['Tested'] != 'Yes':
                    continue
                age = to_float(row['Age'])
                if age is not None and not 18 <= age <= 49:
                    continue
                bw = to_float(row['BodyweightKg'])
                if bw is None or not 35 <= bw <= 250:
                    continue
                d = date.fromisoformat(row['Date'])
                for lift, col in LIFTS:
                    kg = to_float(row[col])
                    if kg is None or kg <= 0 or kg / bw > 6:   # échec (négatif) ou saisie absurde
                        continue
                    key = (lift, row['Name'])
                    if key not in first or d < first[key][0]:
                        first[key] = (d, row['Sex'], bw, kg)
    groups = {}
    for (lift, _), (_, sex, bw, kg) in first.items():
        groups.setdefault((lift, sex, class_of(sex, bw)), []).append(kg / bw)
    return groups


def pct(sorted_vals, p):
    """Percentile p (0..100), interpolation linéaire."""
    k = (len(sorted_vals) - 1) * p / 100
    lo = int(k)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def table(groups):
    out = {}
    for lift, _ in LIFTS:
        for sex, tops in CLASSES.items():
            rows = []
            for i, top in enumerate(tops):
                vals = sorted(groups.get((lift, sex, i), []))
                if len(vals) < MIN_LIFTERS:
                    raise SystemExit(f'{lift} {sex} {top} : {len(vals)} compétiteurs, trop peu')
                thr = [round(round(pct(vals, p) / STEP) * STEP, 2) for p in PERCENTILES]
                rows.append({'max': top, 'n': len(vals), 'thr': thr})
            out.setdefault(lift, {})[sex] = rows
    return out


def explore(groups):
    ps = (1, 2, 5, 10, 15, 20, 25, 50, 75, 90, 95)
    print('lift sex class n ' + ' '.join(f'p{p}' for p in ps))
    for lift, _ in LIFTS:
        for sex, tops in CLASSES.items():
            for i, top in enumerate(tops):
                vals = sorted(groups.get((lift, sex, i), []))
                if vals:
                    print(lift, sex, top or f'{tops[-2]}+', len(vals), ' '.join(f'{pct(vals, p):.2f}' for p in ps))


def js(tab, export_name):
    lines = [
        '// Seuils du niveau de force, GÉNÉRÉS par scripts/strength-standards.py : ne pas modifier à la main.',
        f'// Source : {export_name}, OpenPowerlifting (https://www.openpowerlifting.org), domaine public.',
        '// Rapport charge ÷ poids du corps des compétiteurs Raw de fédérations contrôlées, à leur première',
        f'// compétition ; seuils [novice, intermédiaire, avancé, élite] = percentiles {", ".join(map(str, PERCENTILES))}.',
        '// max : borne haute de la catégorie de poids en kg (null = au-delà). Méthode : docs/ENTRAINEMENT.md',
        "'use strict';",
        '',
        'const STRENGTH_STANDARDS = {',
    ]
    for lift, by_sex in tab.items():
        lines.append(f'  {lift}: {{')
        for sex, rows in by_sex.items():
            key = 'male' if sex == 'M' else 'female'
            cells = ', '.join(f'{{ max: {json.dumps(r["max"])}, thr: [{", ".join(f"{t:.2f}" for t in r["thr"])}] }}' for r in rows)
            lines.append(f'    {key}: [{cells}],')
        lines.append('  },')
    lines.append('};')
    return '\n'.join(lines) + '\n'


def main(argv):
    paths = [a for a in argv[1:] if not a.startswith('--')]
    if len(paths) != 1:
        raise SystemExit(__doc__)
    groups = first_meets(paths[0])
    if '--explore' in argv:
        explore(groups)
        return
    with zipfile.ZipFile(paths[0]) as z:
        export_name = csv_name(z).split('/')[-1]
    tab = table(groups)
    sys.stdout.write(js(tab, export_name))
    for lift, by_sex in tab.items():
        for sex, rows in by_sex.items():
            print(lift, sex, ' '.join(f'{r["max"]}:{r["n"]}' for r in rows), file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv)
