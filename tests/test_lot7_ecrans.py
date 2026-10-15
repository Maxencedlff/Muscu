"""Lot 7 (écrans) : défauts de la vérification finale sur Historique, Progrès, Programme, Réglages."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = '7_ecrans'
R = Results(LOT)


def go(page, v, **state):
    sets = ''.join(f'{k} = {json.dumps(val)};' for k, val in state.items())
    page.evaluate(f'() => {{ {sets} view = {json.dumps(v)}; render(); }}')
    page.wait_for_timeout(150)


# Éléments dont le texte est tronqué (contenu plus large que la boîte)
CLIPPED_JS = """sel => [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim())"""


def t_screens(bench, eng, dev, theme):
    tag = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        vw = page.viewport_size['width']  # largeur de l'appareil (innerWidth grandit si la page déborde)

        # 1. Historique : sous-titres et recherche lisibles en entier
        go(page, 'history')
        clipped = page.evaluate(CLIPPED_JS, '.hcell__sub, .hcell__title')
        R.check(not clipped, f'{tag} historique : aucun sous-titre tronqué {clipped[:2]}')
        ph = page.evaluate("""() => { const i = document.querySelector('#histSearch'); const c = document.createElement('canvas').getContext('2d');
            const cs = getComputedStyle(i); c.font = cs.fontSize + ' ' + cs.fontFamily;
            return c.measureText(i.placeholder).width <= i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); }""")
        R.check(ph, f'{tag} historique : texte indicatif de recherche entier')
        shot(page, LOT, f'{tag}-historique')

        # 7. Détail d'une séance : séries au format « 34 kg × 10 · 10 »
        go(page, 'history-detail', historyId=page.evaluate('historySorted()[0].id'))
        sets = page.evaluate("[...document.querySelectorAll('.hex__sets')].map(e => e.textContent)")
        R.check(sets and all(('×' in s) or s.endswith('reps') for s in sets), f'{tag} détail séance : format « kg × reps » {sets[:2]}')

        # 2. Modifier une séance passée : la page ne s'élargit pas
        page.evaluate("document.querySelector('[data-action=\"edit-session\"]').click()")
        page.wait_for_timeout(300)
        sw = page.evaluate('document.documentElement.scrollWidth')
        R.check(sw <= vw, f'{tag} modifier la séance : pas de débordement horizontal ({sw} > {vw})')
        di = page.evaluate("(() => { const r = document.querySelector('#addDate').getBoundingClientRect(); return r.right; })()")
        R.check(di <= vw, f'{tag} modifier la séance : champ date dans l\'écran ({di})')
        dw = page.evaluate("document.querySelector('#addDate').getBoundingClientRect().width")
        R.check(dw >= 165, f'{tag} modifier la séance : date lisible en entier ({dw:.0f} px)')
        shot(page, LOT, f'{tag}-modifier-seance')

        # 3. Programme › Push : « Récupération » non recouvert par le contrôle segmenté
        go(page, 'editor', editorCat='push', editorEditing=False)
        ov = page.evaluate("""() => { const c = [...document.querySelectorAll('.cell--ctl')].find(e => e.textContent.includes('Récupération'));
            const t = c.querySelector('.cell__title'), s = c.querySelector('.segmented');
            const a = t.getBoundingClientRect(), b = s.getBoundingClientRect();
            const overlap = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
            return { overlap, clipped: t.scrollWidth > t.clientWidth + 1, out: b.right > innerWidth }; }""")
        R.check(not ov['overlap'] and not ov['clipped'] and not ov['out'], f'{tag} récupération : libellé lisible {ov}')
        page.evaluate("document.querySelector('[data-action=\"set-cooldown\"]').scrollIntoView({block:'center'})")
        shot(page, LOT, f'{tag}-programme-push')
        # 9. Mode Modifier : sous-titres non tronqués
        go(page, 'editor', editorCat='push', editorEditing=True)
        clipped = page.evaluate(CLIPPED_JS, '.ed-row .cell__sub')
        R.check(not clipped, f'{tag} éditeur modifier : sous-titres entiers {clipped[:2]}')
        go(page, 'editor', editorEditing=False)

        # 10. Fiche exercice : espacement avant « Supprimer » et segment actif
        go(page, 'ex-edit', editExIdx=0, exDraft={'name': 'Développé couché haltères', 'sets': 4, 'rest': None, 'target': None, 'repMax': 12})
        gap = page.evaluate("""() => { const f = [...document.querySelectorAll('.group-foot')].find(e => e.textContent.includes('Quand toutes'));
            return f.nextElementSibling.getBoundingClientRect().top - f.getBoundingClientRect().bottom; }""")
        R.check(gap >= 24, f'{tag} fiche exercice : espace avant « Supprimer » ({gap:.0f} px)')
        act = page.evaluate("[...document.querySelectorAll('[data-action=\"ex-rest\"].segmented__btn--active')].map(b => b.textContent)")
        shown = page.evaluate("document.querySelector('#exRestVal').textContent")
        R.check(act == [shown], f'{tag} fiche exercice : segment actif = valeur affichée ({act} / {shown})')
        go(page, 'editor', exDraft=None, editExIdx=None)

        # 4 et 8. Vue d'ensemble : tuiles entières, aujourd'hui sans rouge
        go(page, 'stats-overview')
        clipped = page.evaluate(CLIPPED_JS, '.tile__val')
        R.check(not clipped, f'{tag} vue d\'ensemble : valeurs des tuiles entières {clipped}')
        bg = page.evaluate("getComputedStyle(document.querySelector('.cal__d--today > .num')).backgroundColor")
        red = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--red').trim()")
        R.check('255, 59, 48' not in bg and '255, 69, 58' not in bg and red not in bg, f'{tag} aujourd\'hui : pas de rouge ({bg})')
        shot(page, LOT, f'{tag}-vue-ensemble')

        # 5 et 6. Détail exercice : carte du graphique, axe Y homogène, dates espacées
        go(page, 'stats-ex', statsExId='p1dcouch', statsMode='volume')
        page.wait_for_timeout(250)
        card = page.evaluate("""() => { const c = getComputedStyle(document.querySelector('#exChart')).backgroundColor;
            const cv = getComputedStyle(document.querySelector('#exChart canvas')).backgroundColor;
            const g = getComputedStyle(document.querySelector('.stats-ex .group')).backgroundColor;
            return [c, getComputedStyle(document.querySelector('.view')).backgroundColor, cv, g]; }""")
        # Le canevas ne doit pas repeindre la carte (en clair son fond égalait celui de la page)
        R.check(card[0] != card[1] and card[0] == card[3] and card[2] in ('rgba(0, 0, 0, 0)', 'transparent'),
                f'{tag} graphique : dans une carte comme le groupe Record {card}')
        ticks = page.evaluate("(() => { const st = chartState; const v = st.vals; const hi = Math.max(...v) * 1.08; return [0, hi / 2, hi].map(axisFmt); })()")
        units = {t.split(' ', 1)[1] if ' ' in t else '' for t in ticks}
        R.check(len(units) == 1 and '' not in units, f'{tag} axe Y du volume : une seule unité {ticks}')
        gaps = page.evaluate("(() => { const l = [...chartState.xLabels].sort((a, b) => a.x - b.x); return l.slice(1).map((r, i) => r.x - (l[i].x + l[i].w)); })()")
        R.check(all(g >= 12 for g in gaps), f'{tag} axe X : étiquettes espacées {[round(g) for g in gaps]}')
        shot(page, LOT, f'{tag}-detail-exo')

        # 11. Réglages › À propos : nom affiché une seule fois
        go(page, 'settings')
        n = page.evaluate("(document.querySelector('.view').innerText.match(/MDLF Training/g) || []).length")
        R.check(n == 1, f'{tag} réglages : « MDLF Training » une seule fois ({n})')
        R.check(not page.errors, f'{tag} aucune erreur JS {page.errors[:2]}')


TESTS = [t_screens]

if __name__ == '__main__':
    run_main(R, TESTS, once=[])
