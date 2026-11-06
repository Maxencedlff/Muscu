"""Progression des élèves (docs/COACH_SUIVI.md, « Progression des élèves », app iOS simulée) :
- Mes élèves : un signal par élève, lisible d'un coup d'œil (↑ records en vert, à relancer en orange, le reste en
  gris), 3 lignes au plus par élève, tri (nouveautés, à relancer, records, les autres) dit sous la liste ;
- pas de fausse alerte : un élève en décharge qui s'entraîne moins n'est pas « en baisse » ;
- fiche d'un élève : « Cette semaine » en tête (séances faites sur prévues, records avec l'exercice, dernière
  séance qui s'ouvre), signal orange repris pour l'élève à relancer ;
- serveur sans coach_progress (PGRST202) : les séances des élèves actifs sont lues page par page, les records
  apparaissent quand même, aucune erreur ;
- aucune action au pointerdown, cibles de 44 pt, aucun texte coupé, pas de défilement horizontal.

L'app iOS et Supabase sont simulés (tests/fake_account.py, règles de 20261106000000_coach_progression.sql) : aucune
requête ne sort. Horloge figée au mercredi 25 novembre 2026, 10 h (Paris).
Captures : $PPL_SCRATCH/shots/lotprogression/ (liste et fiche, clair et sombre).
Lancer : PPL_URL=http://127.0.0.1:8773/ PPL_DEV="iPhone 13" python3 tests/test_coach_progression.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'progression'
R = Results(LOT)
NOW = local_ms(2026, 11, 25, 10, tz=PARIS)   # mercredi


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, opts=None):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, **(opts or {})}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username):
    page.evaluate("""async u => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: u }); }""", username)
    page.wait_for_timeout(200)


def layout(page, t, name):
    R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} {name} : pas de défilement horizontal')
    small = page.evaluate("""() => [...document.querySelectorAll('#app button, .tabbar button')].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""")
    R.check(not small, f'{t} {name} : cibles de 44 pt {small}')
    cut = page.evaluate("""() => [...document.querySelectorAll('#app *, .tabbar *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, select, option, svg, use, .icon *, .visually-hidden') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""")
    R.check(not cut, f'{t} {name} : aucun texte coupé {cut}')


def ccalls(page, fn):
    return page.evaluate('f => __sb.calls.filter(c => c[0] === "coach" && c[1] === f).map(c => JSON.parse(c[2]))', fn)


def go(page, route_js, sel):
    page.evaluate(f"navigate({route_js})")
    page.wait_for_selector(sel)
    page.wait_for_timeout(400)


def sessions(days, records=None, label='Push', prefix='x'):
    """Séances aux jours `days` (jours du calendrier avant NOW, à 18 h) ; records : { jour: [records notés] }."""
    out = []
    for i, d in enumerate(days):
        at = days_back_ms(NOW, d, 18, tz=PARIS)
        out.append({'id': f'{prefix}{i:02d}', 'date': at, 'duration': 3_000_000, 'programme': 'ppl', 'category': 'push', 'label': label,
                    'exercises': [{'name': 'Squat', 'sets': [{'weight': '100', 'reps': '5'}]}],
                    'records': (records or {}).get(d, [])})
    return out


def rec(ex, kind='charge', before=100, after=105, **kw):
    return {'ex': ex, 'kind': kind, 'before': before, 'after': after, **kw}


def setup(page):
    """Six élèves, un par cas :
    zoe : nouvelles séances pas encore vues ; tom : rien depuis 9 jours ; nina : 1 séance cette semaine, 3 d'habitude ;
    lea : 2 records cette semaine, mini cut avec mon programme « Sèche 4 jours » (4 séances) ;
    hugo : régulier, dernier record il y a 20 jours ; paul : en décharge, 1 séance cette semaine (3 d'habitude)."""
    weeks = lambda first=1: [d for w in range(first, 5) for d in (7 * w + 1, 7 * w + 3, 7 * w + 5)]
    people = {
        'zoe': sessions([0, 2, 4] + weeks(), prefix='z'),
        'tom': sessions([9, 11, 13] + weeks(2), prefix='t'),
        'nina': sessions([1] + weeks(), prefix='n'),
        'lea': sessions([1, 3, 5] + weeks(), {1: [rec('Squat'), rec('Squat', 'reps', 5, 6, w=105)], 3: [rec('Tractions', 'reps', 8, 9, w=0)]}, label='Haut', prefix='l'),
        'hugo': sessions([1, 3, 5] + weeks(), {20: [rec('Soulevé de terre')]}, prefix='h'),
        'paul': sessions([2] + weeks(), prefix='p'),
    }
    people['hugo'] += sessions([20], {20: [rec('Soulevé de terre')]}, prefix='hr')
    return page.evaluate("""([people]) => {
        const me = __sb.meId();
        __sb.makeCoach(me);
        const ids = {};
        for (const [name, s] of Object.entries(people)) {
          ids[name] = __sb.addPerson({ username: name, avatar: '🦊', social: false, sessions: s });
          __sb.link(me, ids[name], Date.now() - 90 * 86400000);
          // Tout est vu, sauf pour Zoé
          if (name !== 'zoe') __sb.co.links.find(l => l.student === ids[name]).seen = Date.now();
          else __sb.co.links.find(l => l.student === ids[name]).seen = Date.now() - 6 * 86400000;
        }
        __sb.addPhase(ids.lea, { goal: 'mini_cut', name: 'Mini cut', start: '2026-11-09', weeks: 6, prog_name: 'Sèche 4 jours' });
        __sb.addPhase(ids.paul, { goal: 'deload', start: '2026-11-23', weeks: 1 });
        // Mon programme « Sèche 4 jours » (4 séances)
        const ses = {};
        ['sA', 'sB', 'sC', 'sD'].forEach((k, i) => { ses[k] = { label: 'Jour ' + (i + 1), icon: '', desc: '', color: '#FF9500' }; });
        data.userProgrammes.u_seche = { name: 'Sèche 4 jours', archived: false, sessions: ses };
        data.programmes.u_seche = { timers: {}, cooldowns: {}, exercises: { sA: [], sB: [], sC: [], sD: [] } };
        data.myProgrammes.push('u_seche'); save();
        return ids;
    }""", [people])


def row_lines(page):
    """Nombre de lignes affichées par ligne d'élève (chaque texte compté selon sa hauteur)."""
    return page.evaluate("""() => [...document.querySelectorAll('.coach-student-row .social-row__text')].map(box => {
        let n = 0;
        for (const el of box.children) {
          if (!el.offsetParent) continue;
          const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3;
          n += Math.round(el.getBoundingClientRect().height / lh);
        }
        return n;
    })""")


def t_liste(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max')
        ids = setup(page)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        go(page, "'coach-students'", '.coach-students-view .coach-student-row[data-signal="records"]')
        page.wait_for_timeout(300)
        names = page.evaluate("[...document.querySelectorAll('.coach-student-row .social-row__name')].map(e => e.textContent.trim())")
        R.check(names == ['zoe', 'tom', 'nina', 'lea', 'hugo', 'paul'], f'{t} tri : nouveautés, à relancer, records, les autres ({names})')
        sig = lambda n: page.locator('.coach-student-row', has_text=n).locator('.progress-sig')
        R.check(sig('lea').inner_text().replace(' ', '') == '↑2recordscettesem.',
                f'{t} Léa : records ({sig("lea").inner_text()!r})')
        R.check('progress-sig--up' in (sig('lea').get_attribute('class') or ''), f'{t} Léa : en vert')
        R.check(sig('tom').inner_text() == '9 jours sans séance' and 'progress-sig--warn' in sig('tom').get_attribute('class'), f'{t} Tom : inactif en orange ({sig("tom").inner_text()!r})')
        R.check(sig('nina').inner_text() == '1 séance au lieu de 3' and 'progress-sig--warn' in sig('nina').get_attribute('class'), f'{t} Nina : en baisse ({sig("nina").inner_text()!r})')
        R.check(sig('hugo').inner_text() == 'Stable depuis 2 sem.' and 'progress-sig--muted' in sig('hugo').get_attribute('class'), f'{t} Hugo : stable en gris ({sig("hugo").inner_text()!r})')
        R.check(sig('paul').inner_text() == '1 séance cette sem.' and 'progress-sig--muted' in sig('paul').get_attribute('class'), f'{t} Paul en décharge : pas « en baisse » ({sig("paul").inner_text()!r})')
        R.check(page.locator('.coach-student-row', has_text='zoe').locator('.coach-count').count() == 1, f'{t} Zoé : pastille des nouvelles séances')
        R.check('Mini cut · sem. 3/6' in page.locator('.coach-student-row', has_text='lea').inner_text(), f'{t} Léa : sa phase en 3e ligne')
        R.check('Push · ' in page.locator('.coach-student-row', has_text='tom').inner_text(), f'{t} Tom sans planning : sa dernière séance en 3e ligne')
        lines = row_lines(page)
        R.check(lines and max(lines) <= 3, f'{t} 3 lignes au plus par élève ({lines})')
        foot = page.locator('.coach-students-view .group-foot').first.inner_text()
        R.check(foot.startswith('En haut, les nouveautés à lire, puis les élèves à relancer') and ' - ' not in foot, f'{t} règle du tri sous la liste ({foot!r})')
        R.check(len(ccalls(page, 'coach_progress')) == 1, f'{t} un seul appel pour tous les élèves')
        R.check(not ccalls(page, 'coach_student_sessions'), f'{t} aucune page de séances lue pour la liste')
        layout(page, t, 'Mes élèves')
        shot(page, LOT, f'1-mes-eleves-{t}')
        # Rien au pointerdown : la ligne ne s'ouvre qu'au clic
        page.evaluate("document.querySelector('.coach-student-row').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
        page.wait_for_timeout(300)
        R.check(page.locator('.coach-students-view').count() == 1, f'{t} pointerdown seul : rien ne s\'ouvre')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_fiche(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max')
        ids = setup(page)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        # Léa : un toucher depuis la liste
        go(page, "'coach-students'", '.coach-students-view .coach-student-row[data-signal="records"]')
        page.locator('.coach-student-row', has_text='lea').click()
        page.wait_for_selector('.coach-student-view .progress-week')
        page.wait_for_timeout(500)
        first = page.evaluate("document.querySelector('.coach-student-view .scr .group-title')?.textContent.trim()")
        R.check(first == 'Cette semaine', f'{t} fiche : « Cette semaine » en tête ({first!r})')
        wk = page.inner_text('.coach-student-view .progress-week')
        R.check('3 sur 4' in wk and 'Prévues : Sèche 4 jours' in wk, f'{t} fiche : séances faites sur prévues ({wk!r})')
        R.check('Squat' in wk and 'Tractions' in wk and '105 kg' in wk and 'avant 100 kg' in wk, f'{t} fiche : records avec l\'exercice')
        R.check(page.locator('.progress-week .review-rec').count() == 2, f'{t} fiche : un record par exercice')
        R.check('Dernière séance' in wk and 'Haut' in wk and 'hier' in wk.lower(), f'{t} fiche : dernière séance')
        layout(page, t, 'Fiche de Léa')
        shot(page, LOT, f'2-fiche-lea-{t}')
        # La dernière séance s'ouvre (2e toucher)
        page.locator('.progress-week [data-action="coach-open-session"]').click()
        page.wait_for_selector('.coach-session-view')
        page.wait_for_timeout(300)
        R.check('Haut' in page.inner_text('.coach-session-view .scr-title'), f'{t} dernière séance ouverte')
        # Tom : le signal orange repris en tête, pas de record
        go(page, f"makeRoute('coach-student', '{ids['tom']}')", '.coach-student-view .progress-week')
        page.wait_for_timeout(400)
        wk = page.inner_text('.coach-student-view .progress-week')
        R.check('9 jours sans séance' in wk and 'Aucun' in wk, f'{t} fiche de Tom ({wk!r})')
        R.check(page.locator('.progress-week .progress-sig--warn').count() == 1, f'{t} fiche de Tom : en orange')
        layout(page, t, 'Fiche de Tom')
        shot(page, LOT, f'3-fiche-tom-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_serveur_ancien(bench, eng, dev, theme):
    t = tag(dev, theme)
    if theme != 'light':
        return
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max')
        ids = setup(page)
        page.evaluate("__sb.fail.progress = 'missing'")
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        go(page, "'coach-students'", '.coach-students-view .coach-student-row')
        page.wait_for_selector('.coach-student-row[data-signal="records"]', timeout=5000)
        page.wait_for_timeout(500)
        sig = page.locator('.coach-student-row', has_text='lea').locator('.progress-sig').inner_text()
        R.check('2 records cette sem.' in sig, f'{t} serveur d\'avant : records lus dans les séances ({sig!r})')
        read = sorted(c['student'] for c in ccalls(page, 'coach_student_sessions'))
        R.check(read == sorted(ids[n] for n in ['zoe', 'tom', 'nina', 'lea', 'hugo', 'paul']), f'{t} serveur d\'avant : une page par élève actif ({len(read)})')
        R.check(len(ccalls(page, 'coach_progress')) == 1, f'{t} serveur d\'avant : fonction absente demandée une fois')
        R.check('9 jours sans séance' in page.locator('.coach-student-row', has_text='tom').inner_text(), f'{t} serveur d\'avant : inactivité')
        # Revenir sur la liste : pas de nouvel appel à la fonction absente
        go(page, "'friends'", '.tabbar')
        go(page, "'coach-students'", '.coach-students-view .coach-student-row')
        R.check(len(ccalls(page, 'coach_progress')) == 1, f'{t} serveur d\'avant : pas redemandée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_liste, t_fiche, t_serveur_ancien])
