"""Écrans récents : les écrans principaux sur les derniers iPhone (17 = 16 Pro à 18 Pro, 17 Pro Max, Air) et
sur l'iPhone Duo pliable (fermé, ouvert, paysage, « grand paysage »), en clair et en sombre.

Appareils et hypothèses de taille : tests/fixtures.py (RECENT_PROFILES). L'app y a tout l'écran, comme dans
l'app iOS, et les marges de sécurité (encoche / Dynamic Island, barre d'accueil) sont simulées.

Écrans : accueil, Nutrition, séance (série validée, repos), feuille d'ajout, bilan, Historique, Progrès,
Programme, fiche exercice, Bibliothèque, Réglages, Amis, Mes élèves (coach, faux serveur tests/fake_account.py).
Vérifié sur chacun : pas de défilement horizontal, rien de lisible ou touchable sous l'encoche ni sous la barre
d'accueil, fin de l'écran au-dessus de la barre d'onglets, textes non coupés, boutons de 44 pt, barre d'onglets
collée en bas et pas étalée, feuilles dans l'écran et sous l'encoche, et sur grand écran une largeur de lecture
raisonnable (cartes et textes pas étalés au-delà de MAX_LECTURE px).

Sans PPL_DEVICES : les appareils récents seulement (un appareil ancien demandé par run_all.py est ignoré, la
suite par défaut reste aussi longue). Captures : $PPL_SCRATCH/shots/lotecrans_recents/.
Lancer : PPL_URL=http://localhost:8783/ python3 test_ecrans_recents.py
         PPL_DEV="iPhone Duo paysage" PPL_THEME=dark python3 test_ecrans_recents.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT
from donnees_realistes import six_mois

LOT = 'ecrans_recents'
R = Results(LOT)
# Jeudi 5 novembre 2026, 18 h 30 à Paris : jour, frise de la nutrition et « hier » fixes
NOW = local_ms(2026, 11, 5, 18, 30, tz=PARIS)
MAX_LECTURE = 720       # px : au-delà, une carte ou un paragraphe est jugé étalé (iPad : colonne de lecture ~ 670)
CIBLE = 44

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, '..', 'data', 'foods.json'), encoding='utf-8') as fh:
    FOODS = {r[0]: r for r in json.load(fh)['foods']}


def food(code, g, iid):
    r = FOODS[code]
    return {'id': iid, 'name': r[1], 'food': code, 'fam': r[2], 'g': g, 'per': {'k': r[3], 'p': r[4], 'c': r[5], 'f': r[6]}}


# Même plan que test_nutrition.py (riz, poulet, œuf, banane, huile ; codes Ciqual)
PLAN = {'name': 'Prise de masse', 'targets': {'kcal': 2600, 'p': 160}, 'meals': [
    {'id': 'm1', 'name': 'Petit-déjeuner', 'items': [food(22010, 150, 'i1'), food(13005, 120, 'i2')]},
    {'id': 'm2', 'name': 'Déjeuner', 'note': 'Pèse le riz cuit.', 'items': [food(9104, 200, 'i3'), food(36018, 150, 'i4'), food(17270, 10, 'i5')]},
    {'id': 'm3', 'name': 'Collation', 'items': [food(13005, 120, 'i6')]},
    {'id': 'm4', 'name': 'Dîner', 'items': [food(9104, 150, 'i7'), food(36018, 120, 'i8')]},
]}


def donnees():
    d = six_mois(now_ms=NOW)
    d['dietPlans'] = {'d_masse01': PLAN}
    d['dietActive'] = 'd_masse01'
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


# Coach validé avec deux élèves (comme tests/panel/parcours.py, PREPARE_COACH), Léa suivie aussi dans Amis
PREPARE = """async (sessions) => {
    await accountSignInWith('apple', async () => 'add');
    await accountSaveProfile({ username: 'max' });
    await socialEnable(true);
    const me = __sb.meId();
    __sb.makeCoach(me);
    const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', sessions });
    const tom = __sb.addPerson({ username: 'tom', avatar: '🐻' });
    __sb.follow(me, lea, 'accepted'); __sb.follow(tom, me, 'pending');
    __sb.link(me, lea, Date.now() - 20 * 86400000);
    __sb.link(me, tom);
    __sb.msg(lea, false, "J'ai senti mon épaule sur le développé, je baisse la charge ?", Date.now() - 3 * 3600e3);
    await socialRefresh(); await socialLoadFeed(''); await coachRefresh(); render();
}"""


def seances_lea():
    out = []
    for i, (lab, cat, exs) in enumerate([('Push', 'push', [('Développé couché', '45', '8'), ('Élévations latérales', '8', '12')]),
                                         ('Legs', 'legs', [('Squat barre', '70', '6'), ('Presse à cuisses', '140', '10')]),
                                         ('Pull', 'pull', [('Tirage vertical', '45', '10'), ('Curl biceps', '12', '10')])]):
        out.append({'id': f'lea{i}', 'date': days_back_ms(NOW, i + 1, 10, tz=PARIS), 'duration': 55 * 60_000, 'programme': 'ppl',
                    'category': cat, 'label': lab,
                    'exercises': [{'name': n, 'sets': [{'weight': w, 'reps': rp}] * 3} for n, w, rp in exs]})
    return out


# ─────────────────────────────────────────────────────────────
#  Contrôles de mise en page (dans la page)
# ─────────────────────────────────────────────────────────────
LAYOUT_JS = r"""({ sat, sab, maxw, cible }) => {
  const W = document.documentElement.clientWidth, H = innerHeight;
  const CLICK = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=switch],[role=tab],[data-action]';
  const vis = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05
      && !el.closest('[aria-hidden=true],[inert],.visually-hidden,[class*="sr-"]'); };
  const nom = el => { const t = (el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 32);
    const c = el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''; return `${el.tagName.toLowerCase()}${c}${t ? ` « ${t} »` : ''}`; };
  const fixe = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  const dessus = (el, x, y) => { const t = document.elementFromPoint(Math.min(Math.max(x, 1), W - 1), Math.min(Math.max(y, 1), H - 1)); return !!t && (t === el || el.contains(t)); };
  const texte = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const out = { hscroll: 0, encoche: [], accueil: [], sousBarre: [], fin: null, petits: [], coupes: [], etales: [], barre: [], feuille: [] };

  // 1. Défilement horizontal
  const large = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (large > W + 1) out.hscroll = large;

  // 2. Encoche (haut) et barre d'accueil (bas) : texte ou touchable visible au premier plan dans la marge.
  //    En bas, seul ce qui est fixe compte (le contenu qui défile passe normalement sous la barre d'accueil).
  const feuilles = [...document.querySelectorAll('body *')].filter(e => vis(e) && !e.matches('svg *') && (e.matches(CLICK) || texte(e)));
  for (const e of feuilles) {
    const r = e.getBoundingClientRect();
    if (sat && r.top < sat - 0.5 && r.bottom > 0.5 && dessus(e, r.left + r.width / 2, (Math.max(r.top, 0) + Math.min(r.bottom, sat)) / 2)) out.encoche.push(nom(e));
    if (sab && fixe(e) && r.bottom > H - sab + 0.5 && r.top < H - 0.5 && dessus(e, r.left + r.width / 2, (Math.max(r.top, H - sab) + Math.min(r.bottom, H)) / 2)) out.accueil.push(nom(e));
  }

  // 3. Barre d'onglets : collée en bas, boutons au-dessus de la barre d'accueil, pas étalés sur tout l'écran ;
  //    touchables fixes recouverts par elle ; fin de l'écran défilé au-dessus d'elle
  const bar = document.querySelector('.tabbar');
  const modal = document.querySelector('.ios-dialog, .sess-sheet:not(.sess-sheet--out), .sheet-root:not(.sheet-root--out), .auth, .onb');
  if (bar && vis(bar) && !bar.hidden) {
    const b = bar.getBoundingClientRect();
    if (Math.abs(b.bottom - H) > 1) out.barre.push(`pas collée en bas (bas à ${Math.round(b.bottom)} px pour ${H})`);
    const btns = [...bar.querySelectorAll('.tabbar__btn')].filter(vis);
    for (const x of btns) { const r = x.getBoundingClientRect(); if (r.bottom > H - sab + 0.5) out.barre.push(`${nom(x)} sous la barre d'accueil`); }
    if (btns.length > 1) {
      const c = x => { const r = x.getBoundingClientRect(); return r.left + r.width / 2; };
      const spread = c(btns[btns.length - 1]) - c(btns[0]);
      if (spread > maxw) out.barre.push(`onglets étalés sur ${Math.round(spread)} px (centres du 1er au dernier)`);
    }
    for (const e of [...document.querySelectorAll(CLICK)].filter(vis)) {
      if (bar.contains(e) || !fixe(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.bottom <= b.top + 1 || r.top >= b.bottom) continue;
      const t = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 1), W - 1), Math.min(r.top + r.height / 2, H - 1));
      if (t && bar.contains(t)) out.sousBarre.push(nom(e));
    }
    const scr = document.querySelector('#app .scr');
    if (scr && !modal) {
      const y = scrollY, sy = scr.scrollTop;
      scrollTo(0, document.documentElement.scrollHeight); scr.scrollTop = scr.scrollHeight;
      const last = [...scr.querySelectorAll('*')].filter(e => e.offsetParent && e.getBoundingClientRect().height > 0)
        .sort((a, c) => a.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom).pop();
      if (last && last.getBoundingClientRect().bottom > bar.getBoundingClientRect().top + .5) out.fin = nom(last);
      scrollTo(0, y); scr.scrollTop = sy;
    }
  }

  // 4. Boutons sous 44 pt (zone élargie par un ::before / ::after en position absolue comprise, comme
  //    .stepper button::after), textes coupés (contenu plus large que sa boîte)
  const zoneTap = e => {
    const r = e.getBoundingClientRect();
    let w = r.width, h = r.height;
    for (const ps of ['::before', '::after']) {
      const s = getComputedStyle(e, ps);
      if (!s.content || s.content === 'none' || s.position !== 'absolute') continue;
      const px = v => (v.endsWith('px') ? parseFloat(v) : NaN);
      const [t, b, l, rr] = [s.top, s.bottom, s.left, s.right].map(px);
      const pw = !isNaN(l) && !isNaN(rr) ? r.width - l - rr : parseFloat(s.width) || 0;
      const ph = !isNaN(t) && !isNaN(b) ? r.height - t - b : parseFloat(s.height) || 0;
      w = Math.max(w, pw); h = Math.max(h, ph);
    }
    return [w, h];
  };
  const zone = modal ? [modal, ...(bar ? [bar] : [])] : [document.querySelector('#app'), bar].filter(Boolean);
  for (const z of zone) {
    for (const e of z.querySelectorAll('button')) {
      if (!vis(e) || e.disabled) continue;
      const [w, h] = zoneTap(e);
      if (w < cible - 0.5 || h < cible - 0.5) out.petits.push(`${nom(e)} ${Math.round(w)}×${Math.round(h)}`);
    }
    for (const e of z.querySelectorAll('*')) {
      if (e.children.length || !vis(e) || !e.textContent.trim() || e.matches('input, textarea, select, svg, svg *, use')) continue;
      const s = getComputedStyle(e);
      if (s.display !== 'inline' && e.scrollWidth > e.clientWidth + 1 && s.overflowX !== 'visible') out.coupes.push(`« ${e.textContent.trim().slice(0, 32)} »`);
    }
  }

  // 5. Grand écran : cartes, cellules et paragraphes plus larges que la colonne de lecture
  if (W > maxw) {
    const cand = [...document.querySelectorAll('#app .group, #app .cell, #app [class*="card"], #app p, #app .hero, .sess-sheet__panel, .sheet')]
      .filter(vis).map(e => [e, e.getBoundingClientRect().width]).filter(([, w]) => w > maxw).sort((a, c) => c[1] - a[1]);
    const vus = new Set();
    for (const [e, w] of cand) { const k = e.className.toString().split(' ')[0] || e.tagName; if (vus.has(k)) continue; vus.add(k); out.etales.push(`${nom(e)} ${Math.round(w)} px`); }
  }

  // 6. Feuilles et dialogues : dans l'écran, sous l'encoche, centrés
  for (const p of document.querySelectorAll('.sess-sheet:not(.sess-sheet--out) .sess-sheet__panel, .sheet-root:not(.sheet-root--out) .sheet, .ios-dialog:not(.ios-dialog--out) .ios-dialog__panel')) {
    if (!vis(p)) continue;
    const r = p.getBoundingClientRect();
    if (r.left < -0.5 || r.right > W + 0.5) out.feuille.push(`${nom(p)} déborde de l'écran (${Math.round(r.left)} → ${Math.round(r.right)})`);
    if (r.top < sat - 0.5) out.feuille.push(`${nom(p)} monte sous l'encoche (haut à ${Math.round(r.top)} px)`);
    if (r.bottom > H + 0.5) out.feuille.push(`${nom(p)} sort par le bas (${Math.round(r.bottom)} > ${H})`);
    if (Math.abs(r.left - (W - r.right)) > 2) out.feuille.push(`${nom(p)} pas centrée (${Math.round(r.left)} / ${Math.round(W - r.right)})`);
  }
  for (const k of ['encoche', 'accueil', 'sousBarre', 'petits', 'coupes']) out[k] = [...new Set(out[k])].slice(0, 6);
  return out;
}"""


def audit(page, t, ecran, insets):
    """Contrôles de mise en page de l'écran affiché, une vérification par règle."""
    sat, _, sab, _ = insets
    page.evaluate('() => { scrollTo(0, 0); document.querySelectorAll("#app .scr").forEach(e => { e.scrollTop = 0; }); }')
    page.wait_for_timeout(120)
    o = page.evaluate(LAYOUT_JS, {'sat': sat, 'sab': sab, 'maxw': MAX_LECTURE, 'cible': CIBLE})
    R.check(not o['hscroll'], f"{t} {ecran} : pas de défilement horizontal (page de {o['hscroll']} px)")
    R.check(not o['encoche'], f"{t} {ecran} : rien sous l'encoche / Dynamic Island {o['encoche']}")
    R.check(not o['accueil'], f"{t} {ecran} : rien de fixe sous la barre d'accueil {o['accueil']}")
    R.check(not o['sousBarre'], f"{t} {ecran} : rien de touchable caché sous la barre d'onglets {o['sousBarre']}")
    R.check(not o['fin'], f"{t} {ecran} : fin de l'écran au-dessus de la barre d'onglets ({o['fin']})")
    R.check(not o['barre'], f"{t} {ecran} : barre d'onglets bien placée {o['barre']}")
    R.check(not o['feuille'], f"{t} {ecran} : feuille ou dialogue bien placé {o['feuille']}")
    R.check(not o['petits'], f"{t} {ecran} : boutons de 44 pt {o['petits']}")
    R.check(not o['coupes'], f"{t} {ecran} : aucun texte coupé {o['coupes']}")
    R.check(not o['etales'], f"{t} {ecran} : largeur de lecture ≤ {MAX_LECTURE} px {o['etales'][:4]}")
    return o


# ─────────────────────────────────────────────────────────────
#  Parcours des écrans
# ─────────────────────────────────────────────────────────────
def t_ecrans(bench, eng, dev, theme):
    insets = safe_insets(dev)
    if insets is None:
        print(f'  {dev} : appareil ancien, ignoré (ce lot vise les appareils récents : PPL_DEVICES=recents)', flush=True)
        return
    t = f'{dev}-{theme}'.replace(' ', '_')
    n = [0]
    with bench.frozen_page(NOW, eng, dev, theme, locale='fr-FR') as page:
        page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
        page.add_init_script(FAKE_ACCOUNT)
        page.route(re.compile(r'^https?://(?!127\.0\.0\.1|localhost).*'), lambda route: route.abort())
        seed(page, theme, donnees(), extra={'ppl_welcome_seen': '1'})
        page.wait_for_timeout(400)

        def ecran(nom, prep, attendre=None):
            """Ouvre un écran (prep), le contrôle et le capture ; une étape ratée n'arrête pas les suivantes."""
            n[0] += 1
            try:
                prep()
                if attendre:
                    page.wait_for_selector(attendre, state='visible', timeout=4000)
                page.wait_for_timeout(350)
            except Exception as e:
                R.check(False, f'{t} {nom} : écran inaccessible ({str(e).splitlines()[0][:120]})')
                shot(page, LOT, f'{t}-{n[0]:02d}-{nom}-ECHEC')
                return False
            audit(page, t, nom, insets)
            shot(page, LOT, f'{t}-{n[0]:02d}-{nom}')
            return True

        def tap(sel):
            """Toucher ; si Playwright attend en vain la fin du geste (vu le 06/11 sous charge, l'écran était
            pourtant ouvert), le toucher est rejoué par un clic DOM sur l'élément s'il est au premier plan."""
            loc = page.locator(sel).filter(visible=True).first
            try:
                loc.click(timeout=8000)
            except Exception:
                if loc.count():
                    loc.dispatch_event('click')
                else:
                    raise
            page.wait_for_timeout(350)
        onglet = lambda tab: tap(f'.tabbar [data-tab="{tab}"]')

        ecran('accueil', lambda: None, '.view.dashboard')
        ecran('nutrition', lambda: tap('.diet-home__open'), '.nutrition-view')
        onglet('train')
        page.wait_for_timeout(200)
        if page.locator('.nutrition-view').count():   # le 1er toucher de l'onglet actif ramène à sa racine
            onglet('train')

        # Séance : une série notée et validée, le repos, la feuille d'ajout, le bilan
        def valider():
            tap('.view.dashboard [data-action="start-session"]')
            page.wait_for_selector('.view.session')
            page.fill('.view.session [data-action="set-reps"][data-ei="0"][data-si="0"]', '8')
            tap('.view.session [data-action="validate-set"][data-ei="0"][data-si="0"]')
        ecran('seance-repos', valider, '.rest-mini, .sess-sheet--rest, .rest-overlay')
        if page.locator('[data-action="expand-rest"]').filter(visible=True).count():
            ecran('repos-agrandi', lambda: tap('[data-action="expand-rest"]'), '.sess-sheet--rest')

        def passer():
            for sel in ('.sess-sheet--rest [data-action="skip-rest"]', '.rest-mini [data-action="skip-rest"]'):
                if page.locator(sel).filter(visible=True).count():
                    tap(sel)
                    return
        passer()
        ecran('seance', lambda: None, '.view.session')
        ecran('feuille-ajout', lambda: tap('.view.session [data-action="add-session-ex"]'), '.sess-sheet--addex')
        for sel in ('.sess-sheet [data-action="sheet-done"]', '.sheet__btn--cancel'):
            if page.locator(sel).filter(visible=True).count():
                tap(sel)
                break
        page.keyboard.press('Escape')
        page.wait_for_timeout(300)

        def bilan():
            page.evaluate("""() => { activeSession.startedAt = Date.now() - 52 * 60000;
                activeSession.exercises.forEach(ex => ex.sets.forEach(s => {
                  if (s.done || s.warmup) return;
                  if (String(s.reps ?? '').trim() === '') s.reps = String(setGoal(ex, s));
                  if (String(s.weight ?? '').trim() !== '') s.done = true; }));
                persistSession(); render(); }""")
            page.wait_for_timeout(250)
            passer()
            tap('.view.session [data-action="finish-session"]')
            page.locator('.ios-dialog__btn', has_text='Enregistrer').first.click()
        ecran('bilan', bilan, '.view.summary')
        if page.locator('[data-action="summary-done"]').count():
            page.locator('[data-action="summary-done"]').first.click()
            page.wait_for_timeout(400)

        ecran('historique', lambda: onglet('history'), '.view.history')
        ecran('progres', lambda: onglet('progress'), '.view.stats')
        ecran('programme', lambda: onglet('program'), '.view.programmes')

        def fiche():
            tap('.view.programmes [data-action="open-prog-session"]')
            tap('.view.editor [data-action="edit-ex"]')
        ecran('fiche-exercice', fiche, '.view.ex-edit')
        if page.locator('[data-action="cancel-ex"]').filter(visible=True).count():
            tap('[data-action="cancel-ex"]')
        onglet('program')
        if not page.locator('.view.programmes').count():
            onglet('program')
        ecran('bibliotheque', lambda: tap('[data-action="go-library"]'), '.view.library')

        def reglages():
            onglet('train')
            if not page.locator('.view.dashboard').count():
                onglet('train')
            tap('.view.dashboard [data-action="go-settings"]')
        ecran('reglages', reglages, '.settings-view')

        # Compte, Amis activé, rôle coach avec deux élèves (faux serveur, rien ne sort)
        page.evaluate(PREPARE, seances_lea())
        page.wait_for_timeout(400)
        ecran('amis', lambda: onglet('friends'), '.feed-card, [data-action="coach-open-students"]')
        ecran('mes-eleves', lambda: tap('[data-action="coach-open-students"]'), '.coach-students-view')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


TESTS = [t_ecrans]

if __name__ == '__main__':
    if not os.environ.get('PPL_DEVICES') and not os.environ.get('PPL_DEV'):
        os.environ['PPL_DEVICES'] = 'recents'
    run_main(R, TESTS, once=[])
