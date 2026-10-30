"""Lance tous les test_lot*.py en parallèle : un processus par (lot, appareil, thème)
plus un processus par lot pour les tests uniques. Code de sortie non nul si un test échoue.

Options : python3 run_all.py [lot ...]   ex. `run_all.py 3 4 muscles` ne lance que les lots 3, 4 et muscles.
PPL_DEVICES (« iPhone 13,Pixel 7 ») et PPL_THEMES (« dark ») restreignent les appareils et thèmes (CI).
Un processus en échec est relancé une fois (PPL_RETRY=0 pour l'éviter) : s'il passe, il est signalé
« INSTABLE » sans faire échouer la suite ; sinon, échec.
PPL_JOBS (défaut 6) règle le nombre de processus simultanés. Garde-fou mémoire : aucun
processus ne démarre tant que la mémoire disponible de WSL est sous 2,5 Go (évite de faire planter WSL).
"""
import glob
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from fixtures import DEVICES, THEMES

here = os.path.dirname(os.path.abspath(__file__))
# Lots numérotés (test_lotN*.py) puis tests par domaine (test_muscles.py…), désignés par leur nom
def lot_of(f):
    m = re.search(r'test_lot(\d+)', f)
    return m.group(1) if m else re.search(r'test_(\w+)\.py', f).group(1)


files = sorted(glob.glob(os.path.join(here, 'test_lot*.py')), key=lambda f: int(lot_of(f)))
files += sorted(f for f in glob.glob(os.path.join(here, 'test_*.py')) if not re.search(r'test_lot\d', f))
# Filtres refusés s'ils ne désignent rien : une faute de frappe ne doit jamais donner « 0/0 OK »
def pick(asked, known, what):
    unknown = [a for a in asked if a not in known]
    if unknown:
        sys.exit(f'{what} inconnu(s) : {", ".join(unknown)} ; connus : {", ".join(known)}')
    return asked


if sys.argv[1:]:
    pick(sys.argv[1:], [lot_of(f) for f in files], 'Lot')
    files = [f for f in files if lot_of(f) in sys.argv[1:]]
env_list = lambda k: [x.strip() for x in os.environ.get(k, '').split(',') if x.strip()]
devices = pick(env_list('PPL_DEVICES'), [d for _, d in DEVICES], 'Appareil') or [d for _, d in DEVICES]
themes = pick(env_list('PPL_THEMES'), THEMES, 'Thème') or THEMES

jobs = []
for f in files:
    for dev in devices:
        for theme in themes:
            jobs.append((f, {'PPL_DEV': dev, 'PPL_THEME': theme}, f'{dev}-{theme}'))
    jobs.append((f, {'PPL_ONCE': '1'}, 'unique'))


def mem_available_mb():
    with open('/proc/meminfo') as fh:
        for line in fh:
            if line.startswith('MemAvailable:'):
                return int(line.split()[1]) // 1024
    return 10**6


def run(job):
    f, env, label = job
    waited = 0
    while mem_available_mb() < 2500:
        time.sleep(2); waited += 2
        if waited % 60 == 0: print(f'… {label} attend de la mémoire ({mem_available_mb()} Mo libres)', flush=True)
    t = time.time()
    # Délai par processus : un test qui se fige (navigateur bloqué sur la CI) devient un échec lisible au
    # lieu de retenir toute la suite jusqu'au délai du job GitHub (vu le 30/10 : 23 min sans une ligne)
    try:
        r = subprocess.run([sys.executable, '-u', f], cwd=here, env={**os.environ, **env},
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                           timeout=int(os.environ.get('PPL_PROC_TIMEOUT', '600')))
    except subprocess.TimeoutExpired as e:
        out = (e.stdout.decode() if isinstance(e.stdout, bytes) else e.stdout) or ''
        return f, label, 124, out + '\n  ÉCHEC : délai de processus dépassé (figé)\n', time.time() - t
    return f, label, r.returncode, r.stdout, time.time() - t


def run_with_retry(job):
    f, label, code, out, dt = run(job)
    if code != 0 and os.environ.get('PPL_RETRY', '1') != '0':
        first = out
        f, label, code, out, dt = run(job)
        if code == 0:
            label += ' INSTABLE (réussi à la 2e tentative)'
            out = out.rstrip() + '\n' + '\n'.join(l for l in first.splitlines() if 'ÉCHEC' in l or 'exception' in l)
    return f, label, code, out, dt


t0 = time.time()
failed, flaky = [], []
with ThreadPoolExecutor(int(os.environ.get('PPL_JOBS', '6'))) as ex:
    for f, label, code, out, dt in ex.map(run_with_retry, jobs):
        name = os.path.basename(f)
        if code != 0:
            failed.append(f'{name} [{label}]')
            sys.stdout.write(f'═══ {name} [{label}] : ÉCHEC ({dt:.0f} s)\n')
            sys.stdout.write('\n'.join(l for l in out.splitlines() if 'KO' in l or 'ÉCHEC' in l or 'exception' in l or 'Traceback' in l) + '\n')
        elif 'INSTABLE' in label:
            flaky.append(f'{name} [{label.split(" INSTABLE")[0]}]')
            print(f'═══ {name} [{label}] ({dt:.0f} s)', flush=True)
            sys.stdout.write('\n'.join(l for l in out.splitlines() if 'ÉCHEC' in l or 'exception' in l) + '\n')
        else:
            last = out.strip().splitlines()[-1] if out.strip() else ''
            print(f'═══ {name} [{label}] : OK ({dt:.0f} s) {last}', flush=True)
print()
print(f'{len(jobs) - len(failed)}/{len(jobs)} processus OK en {time.time() - t0:.0f} s' + (f' ; échecs : {", ".join(failed)}' if failed else '')
      + (f' ; instables : {", ".join(flaky)}' if flaky else ''))
sys.exit(1 if failed else 0)
