#!/usr/bin/env python3
"""Sous-muscles travaillés par exercice (js/data/exercise-parts.js), depuis la correspondance de mdlf-perso.

    python3 tools/gen-exercise-parts.py [~/mdlf-perso/data/exercices_sous_muscles.json]

Entrée : data/exercices_sous_muscles.json de mdlf-perso (data/build_correspondance.py, lisible dans le .md à
côté) : par nom d'exercice de la bibliothèque, p / s (sous-muscles principaux / secondaires), i (intensité de
couleur par sous-muscle : 2 = rouge plein, 1 = rouge atténué), src (études), note.
Sortie : EXERCISE_PARTS = { nom: { p: { id: 2|1 }, s: { id: 1|2 }, src: [rang dans EXERCISE_PART_SOURCES] } }.
Vérifié ici : chaque sous-muscle existe dans tools/body2-manifest.json (tools/gen-body2.py) et a une intensité.
La cohérence avec le catalogue (mêmes muscles parents que la bibliothèque) est vérifiée par tests/unit/atlas.mjs,
et à l'exécution par exercisePartLevels (js/data/atlas.js), qui retombe sinon sur les muscles entiers.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/mdlf-perso/data/exercices_sous_muscles.json')
# Groupes nommés d'un seul mot dans la correspondance, deux calques dans l'atlas
GROUPS = {'rhomboids': ['rhomboid_minor', 'rhomboid_major']}


def expand(ids, inten):
    """Liste d'identifiants (groupes développés) et intensités correspondantes."""
    out, lv = [], {}
    for pid in ids:
        for q in GROUPS.get(pid, [pid]):
            if q not in out:
                out.append(q)
                lv[q] = inten.get(pid)
    return out, lv


def main():
    data = json.load(open(SRC, encoding='utf-8'))
    man = json.load(open(os.path.join(ROOT, 'tools', 'body2-manifest.json'), encoding='utf-8'))
    known = {p['id'] for p in man['parts']}
    sources, out = [], {}
    for name, e in data.items():
        p, ip = expand(e['p'], e['i'])
        sec, is_ = expand(e['s'], e['i'])
        e = {**e, 'p': p, 's': sec, 'i': {**is_, **ip}}
        for pid in e['p'] + e['s']:
            if pid not in known:
                sys.exit(f'{name} : sous-muscle inconnu {pid}')
            if e['i'].get(pid) not in (1, 2):
                sys.exit(f'{name} : intensité manquante pour {pid}')
        if set(e['p']) & set(e['s']):
            sys.exit(f'{name} : sous-muscle principal et secondaire')
        idx = []
        for s in e.get('src', []):
            if s not in sources:
                sources.append(s)
            idx.append(sources.index(s))
        out[name] = {'p': {pid: e['i'][pid] for pid in e['p']}, 's': {pid: e['i'][pid] for pid in e['s']}, 'src': idx}
    rows = ',\n'.join(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False, separators=(",", ":"))}' for k, v in out.items())
    srcs = ',\n'.join(f'  {json.dumps(s, ensure_ascii=False)}' for s in sources)
    js = f"""// ═══════════════════════════════════════════════════════════
//  Sous-muscles travaillés par exercice de la bibliothèque (FICHIER GÉNÉRÉ)
// ═══════════════════════════════════════════════════════════
'use strict';

// Généré par tools/gen-exercise-parts.py depuis mdlf-perso/data/exercices_sous_muscles.json (lisible dans
// exercices_sous_muscles.md) : ne pas modifier à la main. Par nom de la bibliothèque (js/data/exercise-catalogue.js) :
//   p, s   sous-muscles principaux et secondaires (js/data/body-parts.js), avec leur intensité de couleur :
//          2 = rouge plein, 1 = rouge atténué (un 1 parmi les principaux : partie moins travaillée du groupe)
//   src    études qui justifient le détail (rangs dans EXERCISE_PART_SOURCES)
// Les muscles parents de p et s sont ceux de la bibliothèque : volumes et séries par semaine inchangés.
// Lu par exercisePartLevels (js/data/atlas.js), qui retombe sur les muscles entiers si l'exercice manque.
const EXERCISE_PARTS = {{
{rows},
}};

const EXERCISE_PART_SOURCES = [
{srcs},
];
"""
    open(os.path.join(ROOT, 'js', 'data', 'exercise-parts.js'), 'w', encoding='utf-8').write(js)
    print(f'js/data/exercise-parts.js : {len(out)} exercices, {len(sources)} sources')


if __name__ == '__main__':
    main()
