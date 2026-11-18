"""Régénère ci_durees.json (durée de chaque processus de run_all.py sur la CI) depuis des journaux de la CI.

Les durées servent à répartir la suite entre les parts parallèles du job e2e (PPL_SHARD, tests.yml).
Usage (moyenne de plusieurs journaux, un par job ou par part) :
    gh run view --log --job <id> > a.log ; …
    python3 ci_durees.py a.log b.log c.log
À refaire quand un fichier de test grossit nettement : une durée fausse déséquilibre les parts, sans rien
sauter (un processus inconnu prend la moyenne de son fichier, ou 60 s).
"""
import json
import os
import re
import sys
from collections import defaultdict

LINE = re.compile(r'═══ (test_\w+\.py) \[(.+?)\](?: : OK| : ÉCHEC)? \((\d+) s\)')

samples = defaultdict(list)
for path in sys.argv[1:]:
    with open(path, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            m = LINE.search(line)
            if m:
                samples[f'{m.group(1)}|{m.group(2).split(" INSTABLE")[0]}'].append(int(m.group(3)))
if not samples:
    sys.exit('Aucune ligne « ═══ test_….py [appareil-thème] … (n s) » trouvée dans les journaux donnés')
out = {'source': 'moyenne des journaux de la CI (ci_durees.py)',
       'durees': {k: round(sum(v) / len(v)) for k, v in sorted(samples.items())}}
dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ci_durees.json')
with open(dest, 'w', encoding='utf-8') as fh:
    json.dump(out, fh, ensure_ascii=False, indent=1)
    fh.write('\n')
print(f'{len(out["durees"])} processus, {sum(out["durees"].values())} s au total → {dest}')
