"""Lot 7 (design) : défauts de la vérification finale."""
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = '7_design'
R = Results(LOT)

# Chrono au format iOS : « 0:12 », « 42:07 », « 1:02:07 » (jamais « 00:12 »)
CLOCK = re.compile(r'^(?:[1-9]\d*:[0-5]\d|0):[0-5]\d$|^[1-9]?\d:[0-5]\d$')


def ok_clock(s):
    s = (s or '').strip()
    return bool(CLOCK.match(s)) and not re.match(r'^0\d', s)


def t_clock_format(bench, eng, dev, theme):
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        act = old_active_session()
        act['activeSession']['startedAt'] = int(time.time() * 1000) - 12_000
        act['rest'] = {'endTime': int(time.time() * 1000) + 89_000, 'minimized': True}
        seed(page, theme, ppl_v2_today_json(), act)
        # Fonction de format
        vals = page.evaluate("[fmtClock(12000), fmtClock(9*60000+5000), fmtClock(42*60000+7000), fmtClock(3727000), fmtRest(89)]")
        R.check(vals == ['0:12', '9:05', '42:07', '1:02:07', '1:29'], f'{t} fmtClock au format du repos : {vals}')
        page.wait_for_timeout(1200)
        seen = {}
        for sel in ('#session-clock', '#livebar-elapsed', '#hero-elapsed'):
            loc = page.locator(sel)
            if loc.count():
                seen[sel] = loc.first.inner_text()
        # Accueil : carte « En cours » et mini-barre
        if page.locator('.view.session').count():
            shot(page, LOT, f'chrono-seance-{t}')
            page.locator('[data-action="back"]').first.click()
            page.wait_for_timeout(1200)
        for sel in ('#livebar-elapsed', '#hero-elapsed'):
            loc = page.locator(sel)
            if loc.count():
                seen[sel] = loc.first.inner_text()
        R.check(len(seen) > 0, f'{t} au moins un chrono affiché ({list(seen)})')
        for sel, txt in seen.items():
            R.check(ok_clock(txt), f"{t} {sel} sans zéro devant : « {txt} »")
        shot(page, LOT, f'chrono-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


TESTS = [t_clock_format]

if __name__ == '__main__':
    run_main(R, TESTS, once=[])
