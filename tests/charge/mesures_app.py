"""Mesure de l'app côté coach avec beaucoup d'élèves, dans le navigateur simulé (faux serveur __sb, aucune requête
ne sort) : coach « illimité » avec 50, 150 puis 300 élèves, chacun avec ~150 séances sur un an, pesées,
mensurations, quelques messages ; un élève a 500 messages.

Pour chaque taille, sur iPhone SE (WebKit) et Pixel 7 (Chromium) :
- ouverture de l'onglet Coach jusqu'à la liste complète des élèves (ms), nœuds du DOM, mémoire JS (Chromium) ;
- défilement de la liste : images de plus de 50 ms pendant un défilement de toute la liste ;
- relecture de l'état (coachRefresh, comme au retour au premier plan) : temps de rendu de la liste ;
- recherche d'un élève (frappe, filtre) ;
- fiche d'un élève (150 séances) : ouverture, page suivante ; conversation de 500 messages : ouverture,
  messages plus anciens ;
- boîte de réception du coach (segment Messages, 17/11) : ouverture, lignes dessinées (40 d'abord), hauteur, défilement
  jusqu'à la dernière conversation (affichage progressif), recherche, relecture des conversations ;
- captures des écrans (taille 150) dans le dossier donné.

Lancer depuis tests/ (serveur local sur un port libre, jamais 8731) :
    PPL_URL=http://127.0.0.1:<port>/ python3 charge/mesures_app.py --tailles 50,150,300 --captures <dossier> [--json f]
                                     [--appareil "iPhone SE"]
Sur GitHub : gh workflow run charge-coach.yml --ref <branche> (.github/workflows/charge-coach.yml).
"""
import json
import os
import statistics
import sys
import time

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(here))
from fixtures import Bench, seed, ppl_v2_today_json  # noqa: E402
from fake_account import FAKE_ACCOUNT  # noqa: E402

DEVICES = [('webkit', 'iPhone SE'), ('chromium', 'Pixel 7')]

# Coach, N élèves (pseudo eleveNNN), 150 séances chacun sur un an, 156 pesées, 10 mensurations sur 12 mois,
# 3 messages (1 non lu) ; l'élève « cible » (le premier) a 500 messages. Un élève sur 10 a décroché.
SETUP = """(n) => {
  const me = __sb.meId(); __sb.makeCoach(me); __sb.setTier(me, 'com.mdlf.training.coachmax.yearly');
  const DAY = 86400000, now = Date.now();
  const EX = ['Développé couché haltères', 'Développé incliné haltères', 'Écarté haltères plat', 'Développé militaire haltères',
    'Élévations latérales', 'Extension triceps poulie', 'Rowing haltère unilatéral', 'Tirage vertical prise large',
    'Tirage horizontal câble', 'Curl biceps haltères', 'Curl marteau', 'Squat barre', 'Presse à cuisses', 'Leg curl machine'];
  const LAB = ['Push', 'Pull', 'Legs'], CAT = ['push', 'pull', 'legs'];
  const ids = [];
  for (let i = 0; i < n; i++) {
    const off = i % 10 === 9 ? 25 : 0, s = [];
    for (let k = 0; k < 150; k++) {
      const c = k % 3, ex = [];
      for (let e = 0; e < 6 + (k % 3); e++) {
        const sets = [];
        for (let j = 0; j < 3 + ((k + e) % 3); j++) sets.push({ weight: String(20 + ((e * 7 + k) % 40)), reps: String(6 + ((j + k) % 6)) });
        ex.push({ name: EX[(c * 5 + e + k) % EX.length], sets });
      }
      s.push({ id: 'h' + String(k).padStart(4, '0'), date: now - (off + k * 365 / 150) * DAY - 3600000 * (k % 7), duration: (45 + k % 30) * 60000,
               programme: 'ppl', category: CAT[c], label: LAB[c], notes: k % 5 === 0 ? 'Bonne séance, focus technique' : '',
               records: k % 3 === 0 ? [{ ex: 'Squat barre', kind: 'charge', before: 60 + k % 20, after: 62.5 + k % 20 }] : [], exercises: ex });
    }
    const id = __sb.addPerson({ username: 'eleve' + String(i).padStart(3, '0'), avatar: ['🦊', '🐻', '🦁', '🐼'][i % 4], social: false, sessions: s });
    __sb.link(me, id, now - (380 - i % 370) * DAY);
    __sb.share(id, Array.from({ length: 156 }, (_, d) => ({ date: now - d * DAY * 7 / 3, kg: 70 + (i % 20) + Math.sin(d / 20) * 2 })));
    const parts = ['chest', 'waist', 'hips', 'shoulders', 'neck', 'armL', 'armR', 'thighL', 'thighR', 'calf'];
    __sb.shareMeasures(id, Object.fromEntries(parts.map(p => [p, Array.from({ length: 12 }, (_, m) => ({ date: now - m * 30 * DAY, cm: 30 + i % 15 + m / 10 }))])));
    const nm = i === 0 ? 500 : 3;
    for (let m = 0; m < nm; m++) __sb.msg(id, m % 2 === 0, m % 2 ? 'Séance faite, ressenti correct' : 'Top, on monte de 2,5 kg', now - (nm - m) * 3600000);
    ids.push(id);
  }
  __sb.co.links.forEach(l => { if (l.coach === me) l.seen = new Date(now - 3 * DAY).toISOString(); });
  return ids;
}"""

# Images trop longues pendant un défilement de toute la liste (rAF), à vitesse d'un pouce (~2 500 px/s)
SCROLL = """async () => {
  const H = document.documentElement.scrollHeight - innerHeight; const frames = []; let last = performance.now();
  window.scrollTo(0, 0);
  await new Promise(res => { const step = t => { frames.push(t - last); last = t; window.scrollBy(0, 40);
    if (window.scrollY + 1 >= H || frames.length > 2000) res(); else requestAnimationFrame(step); }; requestAnimationFrame(step); });
  window.scrollTo(0, 0);
  frames.shift();
  return { frames: frames.length, long: frames.filter(f => f > 50).length, worst: Math.round(Math.max(0, ...frames)), height: H };
}"""


def full_shot(page, path):
    """Capture de toute la page si elle tient dans une image (32 767 px au plus, densité comprise), sinon l'écran."""
    tall = page.evaluate('document.documentElement.scrollHeight * devicePixelRatio') < 32_000
    page.screenshot(path=path, full_page=tall)


def ms_since(t0):
    return round((time.perf_counter() - t0) * 1000)


def heap(page):
    return page.evaluate('performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null')


def nodes(page):
    return page.evaluate('document.getElementsByTagName("*").length')


def measure(bench, eng, dev, n, shots):
    out = {'appareil': dev, 'eleves': n}
    with bench.page(eng, dev, 'dark') as page:
        page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
        page.add_init_script(FAKE_ACCOUNT)
        page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
        seed(page, 'dark', ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
        page.evaluate("""async () => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: 'max' }); }""")
        t0 = time.perf_counter()
        ids = page.evaluate(SETUP, n)
        out['preparation_ms'] = ms_since(t0)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(500)
        out['heap_avant_mo'] = heap(page)
        # Onglet Coach : jusqu'à ce que toutes les lignes soient là, et la progression reçue
        t0 = time.perf_counter()
        page.click('.tabbar [data-tab="friends"]')
        # Liste par pages de 40 depuis le 17/11 (COACH_PAGE) : la première page
        page.wait_for_function(f'() => document.querySelectorAll(".coach-team .coach-student-row").length >= {min(n, 40)}', timeout=120_000)
        out['onglet_coach_ms'] = ms_since(t0)
        page.wait_for_function('() => typeof progress === "object" && progress.facts && !progress.loading', timeout=60_000)
        page.wait_for_timeout(300)
        out['onglet_coach_complet_ms'] = ms_since(t0)
        out['noeuds_dom'] = nodes(page)
        out['hauteur_eleves_px'] = page.evaluate('document.documentElement.scrollHeight')
        out['filtres'] = page.evaluate("Object.fromEntries([...document.querySelectorAll('.coach-filter')].map(b => [b.dataset.filter, b.querySelector('.coach-filter__n').textContent]))")
        out['heap_mo'] = heap(page)
        out['badge'] = page.evaluate('(document.querySelector(".tabbar [data-tab=friends] .tabbar__badge") || {}).textContent || ""')
        out['lignes_decroche'] = page.evaluate('document.querySelectorAll(".coach-student-row .progress-sig--warn").length')
        if shots and n == 150:
            page.screenshot(path=os.path.join(shots, f'01-liste-haut-{dev}.png'.replace(' ', '_')))
            page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight / 2)')
            page.wait_for_timeout(300)
            page.screenshot(path=os.path.join(shots, f'02-liste-milieu-{dev}.png'.replace(' ', '_')))
            full_shot(page, os.path.join(shots, f'03-liste-entiere-{dev}.png'.replace(' ', '_')))
            page.evaluate('window.scrollTo(0, 0)')
        sc = page.evaluate(SCROLL)
        out['defilement'] = sc
        # Relecture de l'état (retour au premier plan) : liste redessinée
        rr = []
        for _ in range(3):
            rr.append(page.evaluate('async () => { const t = performance.now(); await coachRefresh(); await new Promise(r => requestAnimationFrame(() => r())); return Math.round(performance.now() - t); }'))
        out['relecture_ms'] = statistics.median(rr)
        out['rendu_liste_ms'] = page.evaluate('() => { const t = performance.now(); render(); return Math.round(performance.now() - t); }')
        # Recherche : un pseudo précis, puis effacée
        if page.locator('#coachSearch').count():
            t0 = time.perf_counter()
            page.fill('#coachSearch', 'eleve042' if n > 42 else 'eleve001')
            page.wait_for_function('() => document.querySelectorAll(".coach-team .coach-student-row").length === 1')
            out['recherche_ms'] = ms_since(t0)
            if shots and n == 150:
                page.screenshot(path=os.path.join(shots, f'04-recherche-{dev}.png'.replace(' ', '_')))
            page.fill('#coachSearch', '')
        else:
            out['recherche_ms'] = None
        # Boîte de réception : segment Messages
        t0 = time.perf_counter()
        page.click('.social-seg [data-seg="messages"]')
        page.wait_for_selector('#chatRows .chat-row', timeout=60_000)
        out['messages_ms'] = ms_since(t0)
        page.wait_for_timeout(300)
        out['messages_lignes'] = page.locator('#chatRows .chat-row').count()
        out['messages_hauteur_px'] = page.evaluate('document.documentElement.scrollHeight')
        out['messages_noeuds_dom'] = nodes(page)
        out['messages_defilement'] = page.evaluate(SCROLL)
        if shots and n in (150, 300):
            page.screenshot(path=os.path.join(shots, f'08-messages-{n}-{dev}.png'.replace(' ', '_')))
        # Jusqu'à la dernière conversation : pages chargées en défilant
        t0 = time.perf_counter()
        for _ in range(20):
            if not page.locator('.chat-more-rows').count():
                break
            page.locator('.chat-more-rows').scroll_into_view_if_needed()
            page.wait_for_timeout(120)
        out['messages_toutes_ms'] = ms_since(t0)
        out['messages_toutes_lignes'] = page.locator('#chatRows .chat-row').count()
        out['messages_toutes_hauteur_px'] = page.evaluate('document.documentElement.scrollHeight')
        page.evaluate('window.scrollTo(0, 0)')
        t0 = time.perf_counter()
        page.fill('#chatSearch', 'eleve042' if n > 42 else 'eleve001')
        page.wait_for_function('() => document.querySelectorAll("#chatRows .chat-row").length === 1')
        out['messages_recherche_ms'] = ms_since(t0)
        page.fill('#chatSearch', '')
        rr = []
        for _ in range(3):
            rr.append(page.evaluate('async () => { const t = performance.now(); await chatRefresh(); await new Promise(r => requestAnimationFrame(() => r())); return Math.round(performance.now() - t); }'))
        out['messages_relecture_ms'] = statistics.median(rr)
        out['messages_rendu_ms'] = page.evaluate('() => { const t = performance.now(); document.querySelector("#chatRows").__html = null; refreshChatInbox(); return Math.round(performance.now() - t); }')
        # Fiche de l'élève cible (150 séances, 500 messages)
        t0 = time.perf_counter()
        page.evaluate(f'navigate(makeRoute("coach-student", "{ids[0]}"))')
        page.wait_for_selector('[data-action="coach-open-session"]', timeout=60_000)
        out['fiche_ms'] = ms_since(t0)
        out['fiche_seances'] = page.locator('[data-action="coach-open-session"]').count()
        if shots and n == 150:
            page.wait_for_timeout(500)
            page.screenshot(path=os.path.join(shots, f'05-fiche-{dev}.png'.replace(' ', '_')))
            full_shot(page, os.path.join(shots, f'06-fiche-entiere-{dev}.png'.replace(' ', '_')))
        more = page.locator('[data-action="coach-more"]')
        if more.count():
            t0 = time.perf_counter()
            before = out['fiche_seances']
            more.first.click()
            page.wait_for_function(f'() => document.querySelectorAll("[data-action=coach-open-session]").length > {before}', timeout=30_000)
            out['fiche_page_suivante_ms'] = ms_since(t0)
        # Conversation de 500 messages
        t0 = time.perf_counter()
        page.evaluate(f'navigate(makeRoute("coach-chat", "{ids[0]}"))')
        page.wait_for_selector('.chat-msg', timeout=30_000)
        out['chat_ms'] = ms_since(t0)
        out['chat_messages_affiches'] = page.locator('.chat-msg').count()
        if shots and n == 150:
            page.wait_for_timeout(400)
            page.screenshot(path=os.path.join(shots, f'07-chat-{dev}.png'.replace(' ', '_')))
        cm = page.locator('[data-action="chat-more"]')
        if cm.count():
            t0 = time.perf_counter()
            before = out['chat_messages_affiches']
            cm.first.click()
            page.wait_for_function(f'() => document.querySelectorAll(".chat-msg").length > {before}', timeout=30_000)
            out['chat_plus_anciens_ms'] = ms_since(t0)
        out['appels'] = page.evaluate('(() => { const c = {}; for (const x of __sb.calls) if (x[0] === "coach") c[x[1]] = (c[x[1]] || 0) + 1; return c; })()')
        out['erreurs_js'] = page.errors[:3]
        page.evaluate('history.back()')
    return out


def main():
    arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    sizes = [int(x) for x in arg('--tailles', '50,150,300').split(',')]
    shots = arg('--captures')
    if shots:
        os.makedirs(shots, exist_ok=True)
    only = arg('--appareil')
    res = []
    bench = Bench()
    try:
        for eng, dev in [d for d in DEVICES if not only or d[1] == only]:
            for n in sizes:
                try:
                    r = measure(bench, eng, dev, n, shots)
                except Exception as e:   # une taille qui casse (délai dépassé) est un résultat, pas un arrêt
                    r = {'appareil': dev, 'eleves': n, 'echec': str(e).splitlines()[0][:300]}
                res.append(r)
                print(json.dumps(r, ensure_ascii=False), flush=True)
    finally:
        bench.close()
    if arg('--json'):
        with open(arg('--json'), 'w', encoding='utf-8') as f:
            json.dump(res, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
