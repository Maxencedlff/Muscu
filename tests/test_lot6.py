"""Lot 6 : accessibilité, Dynamic Type et finitions de bord (critères d'acceptation du plan)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 6
R = Results(LOT)

# Nom accessible approché (aria-label, aria-labelledby, contenu visible pour VoiceOver, label, title)
AUDIT_JS = r"""() => {
  const out = { unnamed: [], symbol: [], small: [], svg: [], wide: [] };
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[inert], [aria-hidden="true"], .edge-layer'); };
  const text = el => {
    if (el.nodeType === 3) return el.textContent;
    if (el.nodeType !== 1 || el.getAttribute('aria-hidden') === 'true' || el.tagName === 'svg') return '';
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    return [...el.childNodes].map(text).join('');
  };
  const name = el => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return lb.split(' ').map(id => document.getElementById(id)?.textContent || '').join(' ');
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      if (el.labels && el.labels.length) return [...el.labels].map(l => l.textContent).join(' ');
      return el.getAttribute('title') || el.getAttribute('placeholder') || '';
    }
    return text(el) || el.getAttribute('title') || '';
  };
  const label = el => (el.className && el.className.baseVal === undefined ? String(el.className).split(' ')[0] : el.tagName) + '|' + (el.dataset.action || '');
  document.querySelectorAll('button, [role=button], input:not([type=hidden]), textarea, select, a[href]').forEach(el => {
    if (!vis(el)) return;
    const n = name(el).replace(/\s+/g, ' ').trim();
    if (!n) out.unnamed.push(label(el));
    else if (/^[\s✓✕—–\-·×+⋯…↑↓←→‹›]*$/.test(n)) out.symbol.push(label(el) + ' « ' + n + ' »');
    const r0 = el.getBoundingClientRect();
    // zone de tap agrandie par un ::after en position absolue (inset négatif)
    const af = getComputedStyle(el, '::after'), ex = { t: 0, r: 0, b: 0, l: 0 };
    if (af.content !== 'none' && af.position === 'absolute') {
      ex.t = Math.max(0, -parseFloat(af.top) || 0); ex.b = Math.max(0, -parseFloat(af.bottom) || 0);
      ex.l = Math.max(0, -parseFloat(af.left) || 0); ex.r = Math.max(0, -parseFloat(af.right) || 0);
    }
    const r = { width: r0.width + ex.l + ex.r, height: r0.height + ex.t + ex.b };
    if (el.type !== 'checkbox' && el.type !== 'radio' && (r.width < 43.5 || r.height < 43.5)) out.small.push(label(el) + ` ${Math.round(r.width)}×${Math.round(r.height)}`);
  });
  document.querySelectorAll('#app svg, .tabbar svg, .livebar svg, .ios-dialog svg, .sheet-root svg, .sess-sheet svg').forEach(s => {
    if (!s.closest('[aria-hidden="true"]')) out.svg.push(s.getAttribute('class') || 'svg');
  });
  const W = innerWidth;
  document.querySelectorAll('#app *, .tabbar *, .sheet-root *, .sess-sheet *, .ios-dialog *').forEach(el => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) {
      // un élément rogné par un parent qui défile horizontalement n'est pas un débordement de la page
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') { clipped = true; break; } p = p.parentElement; }
      if (!clipped) out.wide.push(label(el) + ` ${Math.round(r.left)}→${Math.round(r.right)}`);
    }
  });
  out.scroll = document.documentElement.scrollWidth <= innerWidth;
  if (!out.scroll) {
    // coupable le plus profond : son contenu dépasse le bord droit, aucun de ses enfants ne l'explique
    const off = e => e.getBoundingClientRect().left + e.scrollWidth > W + 1;
    document.querySelectorAll('body *').forEach(e => {
      if (e instanceof SVGElement || !off(e) || [...e.children].some(c => !(c instanceof SVGElement) && off(c))) return;
      out.wide.push('dépasse:' + label(e) + ' « ' + (e.textContent || '').trim().slice(0, 20) + ' »');
    });
  }
  for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k] = [...new Set(out[k])].slice(0, 8);
  return out;
}"""


def tap(page, sel, wait=350):
    page.locator(sel).first.click(timeout=8000)
    page.wait_for_timeout(wait)


def audit(page, t, where, small=True, wide=True):
    a = page.evaluate(AUDIT_JS)
    R.check(not a['unnamed'], f'{t} {where} : contrôles sans nom {a["unnamed"]}')
    R.check(not a['symbol'], f'{t} {where} : noms réduits à un symbole {a["symbol"]}')
    R.check(not a['svg'], f'{t} {where} : svg sans aria-hidden {a["svg"]}')
    if small:
        R.check(not a['small'], f'{t} {where} : cibles < 44×44 {a["small"]}')
    if wide:
        R.check(not a['wide'] and a['scroll'], f'{t} {where} : débordement horizontal {a["wide"]}')
    return a


# Écrans visités : (nom, étapes à toucher depuis l'accueil)
VIEWS = [
    ('accueil', []),
    ('historique', ['[data-action="go-history"]']),
    ('historique-detail', ['[data-action="go-history"]', '[data-action="open-history"]']),
    ('progres', ['[data-action="go-stats"]']),
    ('progres-exercice', ['[data-action="go-stats"]', '[data-action="open-stats-ex"]']),
    ('programme', ['[data-action="go-program"]']),
    ('editeur', ['[data-action="go-program"]', '.cell--nav[data-cat="push"]']),
    ('reglages', ['[data-action="go-program"]', '[data-action="go-settings"]']),
    ('seance', ['[data-action="start-session"][data-cat="push"]']),
]


def visit(page, steps):
    page.evaluate("switchTab('train', { reset: true }); Object.keys(TABS).forEach(t => { nav.stacks[t] = [TABS[t].root]; }); render()")
    page.wait_for_timeout(200)
    for s in steps:
        tap(page, s)


def t_views(bench, eng, dev, theme):
    """Balayage de tous les écrans : noms, symboles, svg, cibles 44 pt, débordements."""
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = f'{dev}-{theme}'
        for name, steps in VIEWS:
            try:
                visit(page, steps)
            except Exception as e:
                R.check(False, f'{t} {name} : navigation impossible {str(e).splitlines()[0]}')
                continue
            audit(page, t, name)
            if name in ('accueil', 'seance'):
                shot(page, LOT, f'{name}-{t}')
        # Séance : libellés VoiceOver des séries
        w = page.locator('[data-action="set-weight"][data-ei="0"][data-si="1"]')
        R.check(w.get_attribute('aria-label') == 'Charge série 2, Développé couché haltères, en kg', f'{t} libellé charge ({w.get_attribute("aria-label")})')
        R.check(page.locator('[data-action="set-reps"][data-ei="0"][data-si="1"]').get_attribute('aria-label') == 'Répétitions série 2, Développé couché haltères', f'{t} libellé reps')
        R.check(page.locator('[data-action="validate-set"][data-ei="0"][data-si="1"]').get_attribute('aria-label') == 'Valider la série 2, Développé couché haltères', f'{t} libellé ✓')
        page.locator('[data-action="validate-set"][data-ei="0"][data-si="0"]').click()
        page.wait_for_timeout(500)
        lbl = page.locator('.set-row2--done').first.get_attribute('aria-label') or ''
        R.check(lbl.startswith('Série 1 validée, 32,5 kilos, 10 répétitions'), f'{t} libellé série validée ({lbl})')
        R.check(page.locator('[role="timer"][aria-live="off"]').count() >= 1, f'{t} chrono role=timer aria-live=off')
        R.check(page.locator('.rest-mini [aria-label="Moins 15 secondes"]').count() == 1 and page.locator('.rest-mini [aria-label="Passer le repos"]').count() == 1, f'{t} libellés du repos')
        audit(page, t, 'séance en repos')
        page.click('[data-action="expand-rest"]'); page.wait_for_timeout(450)
        audit(page, t, 'feuille du repos')
        R.check(page.evaluate("document.querySelector('#app').inert"), f'{t} #app inerte sous la feuille du repos')
        if dev == 'iPhone 13':
            shot(page, LOT, f'repos-feuille-{t}')
        page.keyboard.press('Escape'); page.wait_for_timeout(350)
        R.check(page.locator('.sess-sheet').count() == 0 and not page.evaluate("document.querySelector('#app').inert"), f'{t} Échap ferme la feuille, #app réactivé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def t_dialog_focus(bench):
    """Feuille « Terminer » : focus dans la feuille, #app inerte, retour du focus sur « Terminer »."""
    for eng, dev in (('chromium', 'Pixel 7'), ('webkit', 'iPhone 13')):
        with bench.page(eng, dev, 'dark') as page:
            seed(page, 'dark', ppl_v2_today_json())
            tap(page, '[data-action="start-session"][data-cat="push"]')
            page.locator('[data-action="validate-set"][data-ei="0"][data-si="0"]').click()
            page.wait_for_timeout(300)
            fin = page.locator('[data-action="finish-session"]')
            fin.focus()
            fin.click(); page.wait_for_timeout(450)
            st = page.evaluate("""() => { const d = document.querySelector('.ios-dialog');
                return { open: !!d, inside: !!d && d.contains(document.activeElement), inert: document.querySelector('#app').inert,
                         tab: !!document.querySelector('.tabbar')?.inert, lb: d && d.getAttribute('aria-labelledby'), db: d && d.getAttribute('aria-describedby') }; }""")
            R.check(st['open'] and st['inside'] and st['inert'], f'{dev} feuille Terminer : focus dedans et #app inerte {st}')
            R.check(bool(st['lb']), f'{dev} feuille Terminer : aria-labelledby {st}')
            page.keyboard.press('Escape'); page.wait_for_timeout(400)
            back = page.evaluate("[document.querySelector('.ios-dialog') === null, document.activeElement?.dataset?.action, document.querySelector('#app').inert]")
            R.check(back[0] and back[1] == 'finish-session' and back[2] is False, f'{dev} fermeture : focus revenu sur Terminer {back}')
            R.check(not page.errors, f'{dev} dialogue : aucune erreur JS {page.errors[:2]}')


def t_announce(bench):
    """Annonces : fin de repos dans #sr-polite, toasts recopiés, erreur visible au moins 4 s."""
    with bench.page('chromium', 'Pixel 7', 'light') as page:
        seed(page, 'light', ppl_v2_today_json())
        R.check(page.locator('#sr-polite[aria-live="polite"].visually-hidden').count() == 1 and page.locator('#sr-assert[aria-live="assertive"]').count() == 1, 'régions aria-live présentes')
        tap(page, '[data-action="start-session"][data-cat="push"]')
        page.locator('[data-action="validate-set"][data-ei="0"][data-si="0"]').click()
        page.wait_for_timeout(300)
        R.check('Série 1 validée' in page.locator('#sr-polite').inner_text(), 'toast recopié dans #sr-polite')
        page.evaluate("restEndTime = Date.now() + 9000; restTimeLeft = 9; restTotal = 90")
        page.wait_for_timeout(800)
        R.check(page.locator('#sr-polite').inner_text().strip() == '10 secondes', f'jalon « 10 secondes » ({page.locator("#sr-polite").inner_text()})')
        page.evaluate("restEndTime = Date.now() + 500")
        page.wait_for_timeout(1200)
        txt = page.locator('#sr-polite').inner_text()
        R.check(txt.startswith('Repos terminé, série 2 de Développé couché haltères'), f'annonce de fin de repos ({txt})')
        page.evaluate("showToast('Erreur de test', { error: true })")
        page.wait_for_timeout(3000)
        R.check(page.locator('.toast').count() == 1 and 'Erreur de test' in page.locator('#sr-assert').inner_text(), 'toast d\'erreur ≥ 4 s et annoncé en assertif')
        R.check(not page.errors, f'annonces : aucune erreur JS {page.errors[:2]}')


def t_dynamic_type(bench):
    """Police racine forcée à 28 px sur iPhone SE : aucun débordement horizontal, séries sur 2 lignes."""
    with bench.page('webkit', 'iPhone SE', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json())
        page.add_style_tag(content='html { font-size: 28px !important; }')
        page.evaluate("window.dispatchEvent(new Event('resize'))")
        page.wait_for_timeout(200)
        for name, steps in VIEWS:
            visit(page, steps)
            audit(page, 'AX 28 px', name, small=False)
            if name in ('accueil', 'seance', 'historique-detail', 'progres'):
                shot(page, LOT, f'ax28-{name}-iPhone_SE')
        R.check(page.evaluate("document.documentElement.classList.contains('type-xl')"), 'AX : classe type-xl posée')
        two = page.evaluate("""() => { const r = document.querySelector('.set-row2--current');
            const n = r.querySelector('.set-n').getBoundingClientRect(), i = r.querySelector('.set-input').getBoundingClientRect();
            return i.top >= n.bottom - 1; }""")
        R.check(two, 'AX : la série passe sur 2 lignes')
        R.check(not page.errors, f'AX : aucune erreur JS {page.errors[:2]}')


def t_landscape(bench):
    """iPhone 13 en paysage : feuille du repos entièrement visible, « Réduire » accessible."""
    dev = dict(bench.p.devices['iPhone 13'])
    dev['viewport'] = {'width': 844, 'height': 390}
    ctx = bench.browser('webkit').new_context(**dev, color_scheme='dark', service_workers='block')
    page = ctx.new_page()
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    try:
        seed(page, 'dark', ppl_v2_today_json())
        tap(page, '[data-action="start-session"][data-cat="push"]')
        page.locator('[data-action="validate-set"][data-ei="0"][data-si="0"]').click()
        page.wait_for_timeout(400)
        page.click('[data-action="expand-rest"]'); page.wait_for_timeout(500)
        g = page.evaluate("""() => { const p = document.querySelector('.sess-sheet__panel').getBoundingClientRect();
            const b = document.querySelector('.sess-sheet--rest [data-action="collapse-rest"]');
            const br = b && b.getBoundingClientRect(); const t = document.querySelector('.rs__time');
            return { top: p.top, bottom: p.bottom, h: innerHeight, btn: !!b && br.top >= 0 && br.bottom <= innerHeight && br.width >= 44,
                     fs: parseFloat(getComputedStyle(t).fontSize), inner: document.querySelector('.sess-sheet__body').scrollHeight <= document.querySelector('.sess-sheet__body').clientHeight + 1 }; }""")
        R.check(g['top'] >= 0 and g['bottom'] <= g['h'] + 1 and g['inner'], f'paysage : feuille du repos entièrement visible {g}')
        R.check(g['btn'], f'paysage : bouton « Réduire » visible {g}')
        R.check(abs(g['fs'] - 48) < 1, f'paysage : chrono 48 px {g}')
        shot(page, LOT, 'paysage-repos-iPhone_13')
        page.click('[data-action="collapse-rest"]'); page.wait_for_timeout(350)
        R.check(page.locator('.sess-sheet').count() == 0 and page.locator('.rest-mini').count() == 1, 'paysage : Réduire revient à la barre')
        R.check(not page.errors, f'paysage : aucune erreur JS {page.errors[:2]}')
    finally:
        ctx.close()


def t_reduced_motion(bench):
    """Réduction des mouvements : pas de pulsation de fin de repos ni de point pulsé."""
    with bench.page('chromium', 'Pixel 7', 'dark', reduced_motion='reduce') as page:
        seed(page, 'dark', ppl_v2_today_json())
        tap(page, '[data-action="start-session"][data-cat="push"]')
        page.locator('[data-action="validate-set"][data-ei="0"][data-si="0"]').click()
        page.wait_for_timeout(300)
        page.evaluate("restEndTime = Date.now() + 300")
        page.wait_for_timeout(700)
        an = page.evaluate("[...document.querySelectorAll('.rest-mini, .set-row2--go, .livebar__dot')].map(e => getComputedStyle(e).animationName)")
        R.check(all(a == 'none' for a in an), f'mouvements réduits : aucune animation {an}')


def t_theme_meta(bench):
    """Changer de thème met à jour la meta de la barre d'état et prévient une fois."""
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json())
        page.evaluate("applyTheme('light')")
        page.wait_for_timeout(150)
        meta = page.evaluate("document.querySelector('meta[name=\"apple-mobile-web-app-status-bar-style\"]').content")
        R.check(meta == 'default', f'meta barre d\'état en clair ({meta})')
        R.check(page.evaluate("typeof setThemePref") == 'function', 'setThemePref exposé')
        page.evaluate("setThemePref('dark')")
        page.wait_for_timeout(150)
        R.check('prochain lancement' in (page.locator('.toast').inner_text() if page.locator('.toast').count() else ''), 'toast « La barre d\'état s\'adaptera au prochain lancement »')
        page.evaluate("document.querySelector('.toast')?.remove(); setThemePref('light')")
        page.wait_for_timeout(150)
        R.check(page.locator('.toast').count() == 0, 'toast affiché une seule fois')
        R.check(page.evaluate("document.querySelector('meta[name=\"apple-mobile-web-app-status-bar-style\"]').content") == 'default', 'meta suivie')


TESTS = [t_views]

if __name__ == '__main__':
    run_main(R, TESTS, once=[t_dialog_focus, t_announce, t_dynamic_type, t_landscape, t_reduced_motion, t_theme_meta])
