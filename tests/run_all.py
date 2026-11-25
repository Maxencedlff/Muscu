"""Lance tous les test_lot*.py en parallèle : un processus par (lot, appareil, thème)
plus un processus par lot pour les tests uniques. Code de sortie non nul si un test échoue.

Options : python3 run_all.py [lot ...]   ex. `run_all.py 3 4 muscles` ne lance que les lots 3, 4 et muscles.
PPL_DEVICES (« iPhone 13,Pixel 7 ») et PPL_THEMES (« dark ») restreignent les appareils et thèmes (CI) ;
PPL_DEVICES=recents lance les iPhone récents et le Duo pliable (fixtures.RECENT_DEVICES), « tous » les deux listes.
Un processus en échec est relancé une fois (PPL_RETRY=0 pour l'éviter) : s'il passe, il est signalé
« INSTABLE » sans faire échouer la suite ; sinon, échec.
PPL_SHARD=k/N (CI) ne lance que la part k sur N : les processus sont répartis entre les N parts selon leur
durée mesurée sur la CI (ci_durees.json, régénéré par ci_durees.py), le plus long d'abord vers la part la
moins chargée. Chaque part calcule la même répartition : tout processus tourne dans exactement une part.
PPL_JOBS (défaut 6) règle le nombre de processus simultanés. Garde-fou mémoire : aucun
processus ne démarre tant que la mémoire disponible de WSL est sous 2,5 Go (évite de faire planter WSL).
"""
import glob
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from fixtures import THEMES, selected_devices

here = os.path.dirname(os.path.abspath(__file__))
# Lots numérotés (test_lotN*.py) puis tests par domaine (test_muscles.py…), désignés par leur nom
def lot_of(f):
    m = re.search(r'test_lot(\d+)', f)
    return m.group(1) if m else re.search(r'test_(\w+)\.py', f).group(1)


files = sorted(glob.glob(os.path.join(here, 'test_lot*.py')), key=lambda f: int(lot_of(f)))
files += sorted(f for f in glob.glob(os.path.join(here, 'test_*.py')) if not re.search(r'test_lot\d', f))
# Appli web du coach (test_coach_web*.py) : pas de run_main, son propre job (coach-web de tests.yml, trois moteurs)
# et test_photos_web.py (photos de bilan sur ordinateur, vague 5) : même job
files = [f for f in files if not os.path.basename(f).startswith('test_coach_web') and os.path.basename(f) != 'test_photos_web.py']
# Mode coach grand écran sur iPad (test_coach_ipad.py) : l'app construite (node, dist/), son étape dans le job coach-web
files = [f for f in files if os.path.basename(f) != 'test_coach_ipad.py']
# Filtres refusés s'ils ne désignent rien : une faute de frappe ne doit jamais donner « 0/0 OK »
def pick(asked, known, what):
    unknown = [a for a in asked if a not in known]
    if unknown:
        sys.exit(f'{what} inconnu(s) : {", ".join(unknown)} ; connus : {", ".join(known)}')
    return asked


stem = lambda f: os.path.basename(f)[len('test_'):-len('.py')]   # « lot7_ecrans », « muscles »
if sys.argv[1:]:
    pick(sys.argv[1:], sorted({lot_of(f) for f in files} | {stem(f) for f in files}), 'Lot')
    files = [f for f in files if lot_of(f) in sys.argv[1:] or stem(f) in sys.argv[1:]]
env_list = lambda k: [x.strip() for x in os.environ.get(k, '').split(',') if x.strip()]
devices = [d for _, d in selected_devices()]   # noms inconnus refusés (fixtures.selected_devices)
themes = pick(env_list('PPL_THEMES'), THEMES, 'Thème') or THEMES


def inventory(f):
    """Nombre de tests par appareil et uniques d'un fichier (PPL_LIST : run_main compte sans lancer de navigateur)."""
    r = subprocess.run([sys.executable, f], cwd=here, env={**os.environ, 'PPL_LIST': '1'},
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=60)
    m = re.search(r'^PPL_LIST (\{.*\})$', r.stdout, re.M)
    if r.returncode != 0 or not m:
        sys.exit(f'{os.path.basename(f)} : inventaire impossible (run_main absent ou erreur à l\'import)\n{r.stdout[-800:]}')
    return json.loads(m.group(1))


# Un processus n'est planifié que s'il a des tests : avant, ~37 processus sur 165 ne vérifiaient rien et
# comptaient « OK » (audit du 12/11, m4). Un processus planifié qui ne vérifie rien échoue (Results.done).
with ThreadPoolExecutor(8) as ex:
    counts = dict(zip(files, ex.map(inventory, files)))
jobs = []
for f in files:
    if counts[f]['tests']:
        for dev in devices:
            for theme in themes:
                jobs.append((f, {'PPL_DEV': dev, 'PPL_THEME': theme}, f'{dev}-{theme}'))
    if counts[f]['once']:
        jobs.append((f, {'PPL_ONCE': '1'}, 'unique'))
    if not counts[f]['tests'] and not counts[f]['once']:
        sys.exit(f'{os.path.basename(f)} : aucun test déclaré dans run_main')


def shard(jobs, spec):
    """Part k/N de `jobs` (voir l'en-tête). Durée inconnue : moyenne du même fichier, sinon 60 s."""
    m = re.fullmatch(r'(\d+)/(\d+)', spec)
    if not m or not 1 <= int(m.group(1)) <= int(m.group(2)):
        sys.exit(f'PPL_SHARD={spec!r} : attendu k/N avec 1 <= k <= N')
    k, n = int(m.group(1)), int(m.group(2))
    try:
        with open(os.path.join(here, 'ci_durees.json'), encoding='utf-8') as fh:
            known = json.load(fh)['durees']
    except (OSError, ValueError, KeyError):
        known = {}
    def cost(job):
        name, label = os.path.basename(job[0]), job[2]
        if f'{name}|{label}' in known:
            return known[f'{name}|{label}']
        same = [v for key, v in known.items() if key.startswith(name + '|') and not key.endswith('|unique')]
        return sum(same) / len(same) if same and label != 'unique' else known.get(f'{name}|unique', 60)
    loads, parts = [0.0] * n, [[] for _ in range(n)]
    for job in sorted(jobs, key=lambda j: (-cost(j), os.path.basename(j[0]), j[2])):
        i = min(range(n), key=lambda b: (loads[b], b))
        loads[i] += cost(job); parts[i].append(job)
    print(f'Part {k}/{n} : {len(parts[k - 1])} processus sur {len(jobs)}, ~{loads[k - 1]:.0f} s de processus estimés '
          f'(parts : {", ".join(f"{x:.0f}" for x in loads)} s)', flush=True)
    return parts[k - 1]


if os.environ.get('PPL_SHARD'):
    jobs = shard(jobs, os.environ['PPL_SHARD'])


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
checks = [0, 0]   # vérifications réussies, faites (lignes « Lot … : n/n »)
with ThreadPoolExecutor(int(os.environ.get('PPL_JOBS', '6'))) as ex:
    for f, label, code, out, dt in ex.map(run_with_retry, jobs):
        name = os.path.basename(f)
        for ok, total in re.findall(r'^Lot .* : (\d+)/(\d+) vérifications', out, re.M)[-1:]:
            checks[0] += int(ok); checks[1] += int(total)
        if code != 0:
            failed.append(f'{name} [{label}]')
            sys.stdout.write(f'═══ {name} [{label}] : ÉCHEC ({dt:.0f} s)\n')
            sys.stdout.write('\n'.join(l for l in out.splitlines() if 'KO' in l or 'ÉCHEC' in l or 'exception' in l or 'Traceback' in l or l.startswith('Lot ')) + '\n')
        elif 'INSTABLE' in label:
            flaky.append(f'{name} [{label.split(" INSTABLE")[0]}]')
            print(f'═══ {name} [{label}] ({dt:.0f} s)', flush=True)
            sys.stdout.write('\n'.join(l for l in out.splitlines() if 'ÉCHEC' in l or 'exception' in l) + '\n')
        else:
            # La ligne « Lot … : n/n vérifications », pas la dernière ligne (souvent un avertissement)
            lot_line = [l for l in out.splitlines() if l.startswith('Lot ')]
            print(f'═══ {name} [{label}] : OK ({dt:.0f} s) {lot_line[-1] if lot_line else ""}', flush=True)
print()
print(f'{checks[0]}/{checks[1]} vérifications OK au total')
print(f'{len(jobs) - len(failed)}/{len(jobs)} processus OK en {time.time() - t0:.0f} s' + (f' ; échecs : {", ".join(failed)}' if failed else '')
      + (f' ; instables : {", ".join(flaky)}' if flaky else ''))
sys.exit(1 if failed else 0)
