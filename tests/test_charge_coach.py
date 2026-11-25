"""Coach avec beaucoup d'élèves (mesures du 17/11/2026, tests/charge/) : ce que les corrections protègent.

- 150 élèves : la liste entière, la recherche qui n'en garde qu'un, chaque pseudo lisible en entier (iPhone SE :
  il était coupé en « eleve… » par les 7 points de la semaine, et les élèves devenaient indiscernables) ;
- une relecture de l'état sans nouveauté ne refait pas le DOM de la liste (avant : ~10 000 nœuds refaits 4 à 6 fois
  par relecture à 300 élèves) ; une vraie nouveauté la redessine ;
- envoi du même programme à ses 150 élèves, l'un après l'autre : aucun refus (limite serveur de 30 par 24 h
  avant 20261117020000_charge_coach.sql, désormais 30 + 2 par élève) ;
- fiche d'un élève de 150 séances : 30 séances, puis 30 de plus.

App iOS et Supabase simulés (tests/fake_account.py) : aucune requête ne sort. Captures : $PPL_SCRATCH/shots/lotcharge_coach/.
Lancer : PPL_DEV="iPhone SE" PPL_THEME=dark python3 test_charge_coach.py (ou run_all.py charge_coach).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'charge_coach'
R = Results(LOT)
N = 150

SETUP = """(n) => {
  const me = __sb.meId(); __sb.makeCoach(me); __sb.setTier(me, 'com.mdlf.training.coachmax.yearly');
  const DAY = 86400000, now = Date.now(), ids = [];
  const sess = (k0, nb) => Array.from({ length: nb }, (_, k) => ({ id: 'h' + String(k).padStart(4, '0'), date: now - (k0 + k * 2.4) * DAY,
    duration: 3000000, programme: 'ppl', category: 'push', label: 'Push',
    exercises: [{ name: 'Développé couché', sets: [{ weight: '60', reps: '8' }, { weight: '60', reps: '7' }] }] }));
  for (let i = 0; i < n; i++) {
    // Pseudos de 20 caractères au plus, comme le serveur : les plus longs doivent rester lisibles
    const name = i % 5 === 0 ? 'eleve.' + String(i).padStart(3, '0') + '.marathon' : 'eleve' + String(i).padStart(3, '0');
    const id = __sb.addPerson({ username: name, avatar: '🦊', social: false, sessions: sess(i % 10 === 9 ? 25 : 0, i === 0 ? 150 : 12) });
    __sb.link(me, id, now - (300 - i) * DAY);
    ids.push(id);
  }
  return ids;
}"""


def open_coach(page, theme):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
    page.evaluate("""async () => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: 'max' }); }""")
    ids = page.evaluate(SETUP, N)
    page.evaluate('coachRefresh()')
    settle(page)
    page.click('.tabbar [data-tab="friends"]')
    # Liste par pages de 40 depuis le 17/11 (COACH_ROWS_PAGE) : la première page, puis la suite en défilant
    page.wait_for_function('() => document.querySelectorAll(".coach-team .coach-student-row").length === 40', timeout=60_000)
    page.wait_for_function('() => typeof progress === "object" && progress.facts && !progress.loading', timeout=30_000)
    settle(page)
    return ids


def t_liste(bench, eng, dev, theme):
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        ids = open_coach(page, theme)
        R.check(page.locator('.coach-more-rows').count() == 1, f'{t} 40 cartes d\'abord, la suite en dessous')
        for _ in range(10):
            if not page.locator('.coach-more-rows').count():
                break
            page.locator('.coach-more-rows').scroll_into_view_if_needed()
            settle(page)
        R.check(page.locator('.coach-team .coach-student-row').count() == N, f'{t} {N} élèves dans la liste, en défilant')
        R.check(page.evaluate("Object.fromEntries([...document.querySelectorAll('.coach-filter')].map(b => [b.dataset.filter, +b.querySelector('.coach-filter__n').textContent]))").get('all') == N,
                f'{t} filtre Tous : {N}, compteur exact')
        page.evaluate('scrollTo(0, 0)')
        cut = page.evaluate("""[...document.querySelectorAll('.coach-team .cstu .social-row__name')]
            .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent).slice(0, 5)""")
        R.check(cut == [], f'{t} chaque pseudo lisible en entier {cut}')
        shot(page, LOT, f'01-liste-{t}')
        # Relecture sans nouveauté : la liste n'est pas refaite (même élément DOM pour la première ligne)
        page.evaluate("document.querySelector('.coach-team .coach-student-row').__mark = 1")
        page.evaluate('async () => { await coachRefresh(); await chatRefresh?.(); }')
        settle(page)
        R.check(page.evaluate("document.querySelector('.coach-team .coach-student-row').__mark === 1"), f'{t} relecture sans nouveauté : liste gardée telle quelle')
        # Une vraie nouveauté (message reçu) : redessinée, la pastille apparaît
        page.evaluate(f"""async () => {{ __sb.msg('{ids[3]}', false, 'Question sur le squat'); await coachRefresh(); }}""")
        settle(page)
        R.check(page.evaluate("document.querySelector('.coach-team .coach-student-row').__mark !== 1"), f'{t} nouveauté : liste redessinée')
        # Recherche
        page.fill('#coachSearch', 'eleve.105')
        settle(page)
        shown = page.evaluate("[...document.querySelectorAll('.coach-team .coach-student-row')].filter(r => !r.hidden).map(r => r.dataset.name)")
        R.check(shown == ['eleve.105.marathon'], f'{t} recherche : un seul élève {shown}')
        shot(page, LOT, f'02-recherche-{t}')
        page.fill('#coachSearch', '')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_envoi_et_fiche(bench, eng, dev, theme):
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        ids = open_coach(page, theme)
        # Le même programme à chacun de ses 150 élèves (pas d'envoi groupé dans l'app : un par un)
        res = page.evaluate("""async (ids) => { const out = {}; for (const id of ids) {
            const { data: _, error } = await sb.rpc('coach_send_programme', { student: id, prog_id: 'u_bloc', data: { name: 'Bloc' } });
            const k = error ? error.message : 'ok'; out[k] = (out[k] || 0) + 1; } return out; }""", ids)
        R.check(res == {'ok': N}, f'{t} programme envoyé à {N} élèves sans refus {res}')
        # Fiche de l'élève aux 150 séances : 30, puis 30 de plus
        page.evaluate(f'navigate(makeRoute("coach-student", "{ids[0]}"))')
        page.wait_for_selector('[data-action="coach-open-session"]')
        settle(page)
        n1 = page.locator('[data-action="coach-open-session"]').count()
        page.locator('[data-action="coach-more"]').first.click()
        page.wait_for_function(f'() => document.querySelectorAll("[data-action=coach-open-session]").length > {n1}', timeout=15_000)
        n2 = page.locator('[data-action="coach-open-session"]').count()
        R.check(n2 - n1 == 30 and 30 <= n1 <= 31, f'{t} fiche : 30 séances puis 30 de plus ({n1}, {n2})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_liste, t_envoi_et_fiche])
