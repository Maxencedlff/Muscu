#!/usr/bin/env python3
"""Captures du panel réparties sur plusieurs machines GitHub (.github/workflows/captures-panel.yml).

    python3 tests/panel/gh.py plan --modes rapide,grand-texte [--parcours accueil,programme] [--max 20]
    python3 tests/panel/gh.py fusionner <dossier des parts> <sortie> [--attendus rapide~1,rapide~2]

- plan : une machine par appareil du mode (iPhone 13 sombre, iPhone SE clair…), et les parcours longs
  coupés en lots pour qu'une machine capture au plus ~CIBLE étapes (environ 3 min) ; au plus --max machines
  (20 = la limite du compte). Imprime la matrice (JSON) : nom, mode, opt, appareils, parcours.
- fusionner : rassemble les parts <mode>~<n>/ en un dossier par mode (<sortie>/<mode>/), au même format
  que capture_parcours.py sur le PC : mêmes numéros NN (renumérotés appareil par appareil dans l'ordre des
  parcours du registre, comme une passe unique), mêmes noms de fichiers, index.md, resume.md et etapes.json
  écrits par les fonctions du PC. Durée notée : celle de la machine la plus longue.
"""
import argparse
import inspect
import json
import math
import os
import shutil
import sys
from types import SimpleNamespace

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)

import capture_parcours as cp  # noqa: E402
from parcours import PARCOURS  # noqa: E402

OPT = {'rapide': '--rapide', 'complet': '', 'recents': '--recents', 'grand-texte': '--grand-texte'}
CIBLE = 80          # étapes par machine visées (~2 s l'étape sur GitHub, plus ~1 min de préparation du conteneur)


def poids(pc):
    """Étapes estimées d'un parcours : ses blocs « with r.etape » (une boucle compte une fois), plus la mise en place."""
    return max(1, inspect.getsource(pc.fn).count('.etape(')) + 2


def noms_parcours(mode, liste):
    noms = [x.strip() for x in liste.split(',') if x.strip()] or (cp.GRAND_TEXTE_PARCOURS if mode == 'grand-texte' else [])
    connus = [pc.nom for pc in PARCOURS]
    if inconnus := [n for n in noms if n not in connus]:
        sys.exit(f'Parcours inconnu(s) : {", ".join(inconnus)}')
    return [pc for pc in PARCOURS if not noms or pc.nom in noms]


def lots(pcs, k):
    """k lots de poids proches (le plus lourd d'abord dans le lot le plus léger), ordre du registre dans chaque lot."""
    bacs = [[] for _ in range(k)]
    for pc in sorted(pcs, key=poids, reverse=True):
        min(bacs, key=lambda b: sum(map(poids, b))).append(pc)
    ordre = {pc.nom: i for i, pc in enumerate(PARCOURS)}
    return [sorted(b, key=lambda pc: ordre[pc.nom]) for b in bacs if b]


def plan(modes, parcours, maxi):
    if not modes or any(m not in cp.COMBOS for m in modes):
        sys.exit(f'modes : {", ".join(cp.COMBOS)} (reçu {",".join(modes) or "rien"})')
    choix = {m: noms_parcours(m, parcours) for m in modes}
    k = {m: max(1, min(len(choix[m]), math.ceil(sum(map(poids, choix[m])) / CIBLE))) for m in modes}
    total = lambda: sum(len(cp.COMBOS[m]) * k[m] for m in modes)   # noqa: E731
    while total() > maxi and any(v > 1 for v in k.values()):
        k[max(k, key=lambda m: (k[m], len(cp.COMBOS[m])))] -= 1
    # Plus d'appareils que de machines : plusieurs appareils par machine
    par = math.ceil(sum(len(cp.COMBOS[m]) for m in modes) / maxi) if total() > maxi else 1
    jobs = []
    for m in modes:
        n = len(cp.COMBOS[m])
        for debut in range(0, n, par):
            app = list(range(debut + 1, min(n, debut + par) + 1))
            for lot in lots(choix[m], k[m]):
                tags = ', '.join(f'{cp.COMBOS[m][i - 1][1]} {cp.THEME_FR[cp.COMBOS[m][i - 1][2]]}'
                                 + (f' {cp.combo_fs(cp.COMBOS[m][i - 1])} px' if cp.combo_fs(cp.COMBOS[m][i - 1]) else '') for i in app)
                jobs.append({'nom': f'{m}~{len(jobs) + 1}', 'mode': m, 'opt': OPT[m], 'appareils': ','.join(map(str, app)),
                             'parcours': ','.join(pc.nom for pc in lot),
                             'titre': f'{m} · {tags} · {len(lot)} parcours'})
    return jobs


def fusionner(src, dst, attendus):
    parts = sorted(d for d in os.listdir(src) if os.path.isfile(os.path.join(src, d, 'etapes.json')))
    manquants = [a for a in attendus if a not in parts]
    ordre = {pc.nom: i for i, pc in enumerate(PARCOURS)}
    par_mode = {}
    for d in parts:
        mode = d.split('~')[0]
        lignes = json.load(open(os.path.join(src, d, 'etapes.json'), encoding='utf-8'))
        duree = sum(e.get('duree', 0) for e in lignes)
        info = par_mode.setdefault(mode, {'lignes': [], 'duree': 0})
        info['duree'] = max(info['duree'], duree)
        info['lignes'] += [dict(e, _part=d) for e in lignes]
    for mode, info in par_mode.items():
        out = os.path.join(dst, mode)
        os.makedirs(out, exist_ok=True)
        combos = [c for eng in ('webkit', 'chromium') for c in cp.COMBOS[mode] if c[0] == eng]   # ordre d'une passe sur le PC
        lignes = []
        for c in combos:
            tag = cp.combo_tag(c[1], c[2], cp.combo_fs(c))
            les = sorted((e for e in info['lignes'] if e['combo'] == tag), key=lambda e: (ordre[e['parcours']], e['nn']))
            for nn, e in enumerate(les, 1):
                if e['capture']:
                    neuf = f"{nn:02d}-{e['capture'].split('-', 1)[1]}"
                    shutil.copy2(os.path.join(src, e['_part'], e['capture']), os.path.join(out, neuf))
                    e['capture'] = neuf
                e['nn'] = nn
                del e['_part']
                lignes.append(e)
        noms = {e['parcours'] for e in lignes}
        registre = [pc for pc in PARCOURS if pc.nom in noms]
        run = SimpleNamespace(combos=cp.COMBOS[mode], lignes=lignes, sortie=out)
        cp.ecrire_index(run, registre, info['duree'], mode)
        cp.ecrire_resume(run, registre, info['duree'], mode)
        with open(os.path.join(out, 'etapes.json'), 'w', encoding='utf-8') as f:
            json.dump(lignes, f, ensure_ascii=False, indent=1)
        ko = sum(1 for e in lignes if e['statut'] == 'erreur')
        ab = sum(1 for e in lignes if e['statut'] == 'absent')
        n = sum(1 for e in lignes if e['capture'])
        print(f'{mode} : {n} captures, {len(lignes)} étapes, {ab} absentes, {ko} en erreur, machine la plus longue {info["duree"] / 60:.1f} min')
    if manquants:
        print(f'Parts manquantes (machine en échec) : {", ".join(manquants)}')
        return 1
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('plan')
    p.add_argument('--modes', default='rapide')
    p.add_argument('--parcours', default='')
    p.add_argument('--max', type=int, default=20)
    f = sub.add_parser('fusionner')
    f.add_argument('parts')
    f.add_argument('sortie')
    f.add_argument('--attendus', default='')
    a = ap.parse_args(argv)
    if a.cmd == 'plan':
        modes = list(dict.fromkeys(x.strip() for x in a.modes.split(',') if x.strip()))
        print(json.dumps(plan(modes, a.parcours, a.max), ensure_ascii=False))
        return 0
    return fusionner(a.parts, a.sortie, [x for x in a.attendus.split(',') if x])


if __name__ == '__main__':
    sys.exit(main())
