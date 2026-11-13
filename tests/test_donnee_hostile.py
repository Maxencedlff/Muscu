"""Donnée hostile venue d'un AUTRE compte ou d'Open Food Facts (audit du 12/11/2026, point M8).

Chaque champ qu'un autre compte écrit (pseudo, avatar, commentaire, message du chat coach, séance d'un ami dans le
fil, programme envoyé par un coach : nom, séance, exercice, consigne, commentaire sur une séance) et le nom et la
marque d'un produit Open Food Facts reçoivent des charges hostiles :
- `"><img src=x onerror=__x()>` et `"><script>__x()</script>` : sortie d'un attribut ou d'un texte ;
- `javascript:__x()` : là où un champ pourrait finir dans un href ou un src ;
- `&lt;b&gt;&amp;quot;` : des entités, qui doivent rester littérales (jamais décodées) ;
- 200 × 🏋️‍♂️ (séquence ZWJ) et un texte RTL (U+202E, arabe, hébreu) : jamais de débordement horizontal.
Sur chaque écran : window.__hits reste vide (aucune exécution), aucun <img src=x>, <script>, attribut on*= ou lien
javascript: injecté, le texte s'affiche tel quel (textContent contient la charge littérale) et la page ne défile pas
en largeur (scrollWidth <= clientWidth + 1).

Par appareil et thème : le social (fil, séance d'un ami et ses commentaires, profil, abonnés, Mon profil, ma séance
dans l'Historique), l'élève d'un coach hostile (Mon coach, aperçu du programme, messages, programme ajouté) et Open
Food Facts (route Playwright). Une fois (WebKit iPhone 13, Chromium Pixel 7) : le coach face à un élève hostile.
L'app iOS et Supabase sont simulés (tests/fake_account.py) : aucune requête ne sort.
Lancer : PPL_URL=http://localhost:8731/ PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_donnee_hostile.py
(ou run_all.py donnee_hostile).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'donnee_hostile'
R = Results(LOT)
DAY = 86400_000
HOOK = "window.__x = t => { (window.__hits = window.__hits || []).push(String(t)); };"

IMG = '"><img src=x onerror=__x(\'img\')>'
SCR = '"><script>__x(\'script\')</script>'
JS = "javascript:__x('js')"
ENT = '&lt;b&gt;&amp;quot;'
LIFT = '\U0001F3CB️‍♂️'          # 🏋️‍♂️ : séquence ZWJ
EMOJI = LIFT * 200
RTL = '‮' + 'مرحبا بالعالم שלום עולם ' + 'abc'
CHARGES = {'img': IMG, 'script': SCR, 'js': JS, 'ent': ENT, 'emoji': EMOJI, 'rtl': RTL}
# Ce qu'on cherche dans le texte affiché : la charge entière, sauf l'emoji géant (souvent coupé par l'app à
# 40 ou 80 caractères) dont on cherche 5 répétitions entières
SHOWN = {**CHARGES, 'emoji': LIFT * 5}

# Inspection d'un écran : exécutions, éléments ou attributs injectés, texte affiché, largeur
INSPECT = r"""() => {
    const root = document.body;
    const injected = [];
    for (const e of root.querySelectorAll('*')) {
      const tag = e.tagName.toLowerCase();
      if (tag === 'img' && e.getAttribute('src') === 'x') injected.push('img src=x');
      if (tag === 'script' && /__x/.test(e.textContent)) injected.push('script');
      for (const a of e.attributes) {
        if (/^on/i.test(a.name) && /__x/.test(a.value)) injected.push(`${tag}[${a.name}]`);
        if (/^(href|src|action|formaction|xlink:href|poster|data)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) injected.push(`${tag}[${a.name}=javascript:]`);
      }
    }
    const norm = s => s.replace(/[ ‑]/g, m => (m === '‑' ? '-' : ''));
    const de = document.documentElement;
    return { hits: window.__hits || [], injected, text: norm(root.textContent || ''),
             sw: de.scrollWidth, cw: de.clientWidth };
}"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def screen(page, t, name, expect=()):
    """Vérifie un écran : rien d'exécuté ni d'injecté, charges attendues affichées telles quelles, pas de largeur en trop."""
    page.wait_for_timeout(350)
    r = page.evaluate(INSPECT)
    R.check(not r['hits'], f'{t} {name} : aucune charge exécutée {sorted(set(r["hits"]))}')
    R.check(not r['injected'], f'{t} {name} : aucun élément ni attribut injecté {sorted(set(r["injected"]))}')
    missing = [k for k in expect if SHOWN[k] not in r['text']]
    R.check(not missing, f'{t} {name} : texte affiché tel quel (manque {missing})')
    if 'ent' in expect:
        R.check('<b>&quot;' not in r['text'] and '<b>"' not in r['text'], f'{t} {name} : entités restées littérales')
    R.check(r['sw'] <= r['cw'] + 1, f'{t} {name} : pas de débordement horizontal ({r["sw"]} > {r["cw"]})')


def open_app(page, theme, ppl_v2=None, clock=None):
    page.add_init_script(HOOK)
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2 if ppl_v2 is not None else ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username='max', social=False):
    page.evaluate("""async ([u, s]) => {
        await accountSignInWith('apple', async () => 'add');
        await accountSaveProfile({ username: u });
        if (s) await socialEnable(true);
    }""", [username, social])
    page.wait_for_timeout(200)


def ws(page, sel):
    """wait_for_selector qui nomme le sélecteur et l'écran dans l'erreur (un délai dépassé reste lisible)."""
    try:
        page.wait_for_selector(sel)
    except Exception as e:
        raise RuntimeError(f'{sel} absent (vue {page.evaluate("typeof currentRoute === \'function\' ? currentRoute() : \'?\'")}) : {str(e).splitlines()[0]}') from None


def go(page, route_js, sel):
    page.evaluate(f'navigate({route_js})')
    ws(page, sel)


def hostile_session(sid, key, date):
    v = CHARGES[key]
    return {'id': sid, 'date': date, 'duration': 50 * 60_000, 'programme': 'u_x', 'category': 's1', 'label': v,
            'exercises': [{'name': v, 'sets': [{'weight': '80', 'reps': '8'}]},
                          {'name': 'Squat', 'sets': [{'weight': '100', 'reps': '5'}]}],
            'records': [{'ex': v, 'kind': 'charge', 'before': 80, 'after': 85}]}


# ── Social : six amis hostiles (un par charge) ──────────────

def setup_social(page):
    """Six amis, chacun nommé par une charge : une séance au nom de la charge dans le fil, un commentaire sur sa séance
    et un sur la mienne ; l'ami « js » a aussi l'avatar javascript:."""
    page.evaluate('syncNow()')
    page.wait_for_function('(__sb.upserted || []).some(r => r.id === data.history[0].id)')
    import time
    now = int(time.time() * 1000)
    people = [{'key': k, 'sess': hostile_session(f'h_{k}', k, now - (i + 1) * 3600_000)} for i, k in enumerate(CHARGES)]
    return page.evaluate("""([people, charges]) => {
        const me = __sb.meId(), t = Date.now(), sid = data.history[0].id, ids = {};
        for (const p of people) {
          const id = __sb.addPerson({ username: charges[p.key], avatar: p.key === 'js' ? charges.js : (p.key === 'img' ? charges.img : '🦊'), sessions: [p.sess] });
          __sb.follow(me, id); __sb.follow(id, me);
          __sb.comment(id, id, p.sess.id, charges[p.key], t - 2 * 3600e3);
          __sb.comment(id, me, sid, charges[p.key], t - 3600e3);
          ids[p.key] = id;
        }
        __sb.so.at[me] = t - 30 * 86400e3;
        __sb.so.follows.forEach(f => { f.at = t - 40 * 86400e3; });
        return { ids, sid };
    }""", [people, CHARGES])


def t_social(bench, eng, dev, theme):
    t = tag(dev, theme)
    keys = list(CHARGES)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, social=True)
        s = setup_social(page)
        page.click('.tabbar [data-tab="friends"]')
        ws(page, '.feed-card')
        page.wait_for_timeout(300)
        R.check(page.locator('.feed-card').count() == len(keys), f'{t} fil : une carte par ami hostile ({page.locator(".feed-card").count()})')
        screen(page, t, 'fil', keys)
        for k in keys:
            go(page, f"makeRoute('social-session', '{s['ids'][k]}', 'h_{k}')", '.social-session-view .comments .comment')
            screen(page, t, f'séance de l\'ami {k} et ses commentaires', [k])
            body = page.locator('.comment__body').first.text_content()
            R.check(SHOWN[k] in body, f'{t} commentaire {k} : corps affiché tel quel ({body[:40]!r})')
        go(page, f"makeRoute('social-profile', '{s['ids']['img']}')", '.feed-card')
        screen(page, t, 'profil de l\'ami img', ['img'])
        go(page, f"makeRoute('social-profile', '{s['ids']['emoji']}')", '.feed-card')
        screen(page, t, 'profil de l\'ami emoji', ['emoji'])
        go(page, "'social-me'", '#app')
        screen(page, t, 'Mon profil (activité)')
        # Pseudos hostiles refusés par le nettoyage (cleanPerson, forme USERNAME_RE) : « Compte masqué »
        go(page, f"makeRoute('social-people', 'followers')", '.social-row')
        screen(page, t, 'abonnés (pseudos refusés)')
        R.check(page.locator('.social-row__name', has_text='Compte masqué').count() == len(keys), f'{t} abonnés : pseudos hostiles remplacés par « Compte masqué »')
        page.evaluate("routeTo('history')")
        go(page, f"'history-detail:{s['sid']}'", '.comments .comment')
        screen(page, t, 'ma séance dans l\'Historique (commentaires des amis)', keys)
        view_only_social(page, t, s)
        R.check(not page.errors, f'{t} social : aucune erreur JS {page.errors[:3]}')


def view_only_social(page, t, s):
    """Garde-fou de la vue seule : un pseudo hostile passé au travers du nettoyage des données (régression de
    cleanPerson) doit encore s'afficher comme du texte dans le fil, les commentaires et les abonnés."""
    keys = list(CHARGES)
    page.evaluate("""([charges, ids]) => {
        const byId = Object.fromEntries(Object.entries(ids).map(([k, id]) => [id, charges[k]]));
        for (const f of Object.values(social.feeds)) for (const r of f.rows) if (byId[r.owner]) r.username = byId[r.owner];
        for (const th of Object.values(comments.threads)) for (const c of th.rows) if (byId[c.user_id]) c.username = byId[c.user_id];
        for (const p of social.state.followers) if (byId[p.user_id]) p.username = byId[p.user_id];
    }""", [CHARGES, s['ids']])
    page.evaluate('render()')
    screen(page, t, 'vue seule : commentaires de ma séance, pseudos hostiles', keys)
    R.check(page.locator('.comment__name', has_text='Compte masqué').count() == 0, f'{t} vue seule : pseudos des commentaires injectés')
    page.evaluate("routeTo('friends')")
    ws(page, '.feed-card')
    page.wait_for_timeout(300)
    if page.locator('.feed-card__name', has_text='Compte masqué').count():   # fil relu entre-temps : pseudos remis
        page.evaluate("""([charges, ids]) => { const byId = Object.fromEntries(Object.entries(ids).map(([k, id]) => [id, charges[k]]));
            for (const r of socialFeed('').rows) if (byId[r.owner]) r.username = byId[r.owner]; render(); }""", [CHARGES, s['ids']])
    names = page.locator('.feed-card__name').all_text_contents()
    R.check(all(n != 'Compte masqué' for n in names) and len(names) == len(keys), f'{t} vue seule : pseudos du fil injectés ({len(names)})')
    screen(page, t, 'vue seule : fil, pseudos hostiles', keys)
    go(page, f"makeRoute('social-session', '{s['ids']['img']}', 'h_img')", '.social-session-view .comments .comment')
    page.evaluate("""([charges, id]) => { for (const th of Object.values(comments.threads)) for (const c of th.rows) if (c.user_id === id) c.username = charges.img; render(); }""", [CHARGES, s['ids']['img']])
    screen(page, t, 'vue seule : séance de l\'ami, pseudo hostile', ['img'])
    go(page, f"makeRoute('social-people', 'followers')", '.social-row')
    page.evaluate("""([charges, ids]) => { const byId = Object.fromEntries(Object.entries(ids).map(([k, id]) => [id, charges[k]]));
        for (const p of social.state.followers) if (byId[p.user_id]) p.username = byId[p.user_id]; render(); }""", [CHARGES, s['ids']])
    screen(page, t, 'vue seule : abonnés, pseudos hostiles', keys)


# ── Élève d'un coach hostile ──────────────

HOSTILE_PROG = {
    'name': IMG, 'consigne': f'{ENT} {SCR}',
    'sessions': [
        {'key': 'sA', 'label': RTL, 'color': '#FF9500', 'exercises': [
            {'name': SCR, 'sets': 4, 'repMin': 8, 'repMax': 12, 'consigne': IMG},
            {'name': EMOJI, 'sets': 3, 'consigne': ENT},
            {'name': JS, 'sets': 3, 'consigne': RTL}]},
        {'key': 'sB', 'label': ENT, 'color': '#34C759', 'exercises': [{'name': ENT, 'sets': 5, 'repMax': 5}]},
    ],
}


def t_eleve(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        signin(page)
        page.evaluate('syncNow()')
        # Ma séance doit être sur le serveur pour que la note du coach soit lisible (noteAlive)
        page.wait_for_function('(__sb.upserted || []).some(r => r.id === data.history[0].id)')
        ids = page.evaluate("""([charges, prog]) => {
            const coach = __sb.addPerson({ username: charges.img, avatar: charges.js, social: false });
            __sb.makeCoach(coach); __sb.link(coach, __sb.meId());
            let k = 6;
            for (const v of Object.values(charges)) __sb.msg(__sb.meId(), true, v, Date.now() - (k--) * 600e3);
            __sb.co.progs.push({ coach, student: __sb.meId(), id: 'u_evil', data: prog, sent_at: new Date().toISOString(), seen: false });
            const sid = data.history[0].id;
            __sb.co.notes.push({ coach, student: __sb.meId(), sid, text: charges.img + ' ' + charges.ent, updated_at: new Date().toISOString(), seen: false });
            return { coach, sid };
        }""", [CHARGES, HOSTILE_PROG])
        page.evaluate('coachRefresh()')
        page.wait_for_function('coach.inbox && coach.inbox.programmes.length === 1 && coach.inbox.notes.length === 1')
        page.wait_for_timeout(300)
        page.evaluate("routeTo('dashboard')")
        ws(page, '.coach-home')
        screen(page, t, 'accueil (carte du coach)', ['img'])
        page.click('.tabbar [data-tab="friends"]')
        ws(page, '[data-action="coach-open-mine"]')
        screen(page, t, 'Social (cellule Mon coach, pseudo refusé)')
        page.evaluate("coach.state.coach.username = %s; render()" % json.dumps(IMG))
        screen(page, t, 'vue seule : cellule Mon coach, pseudo hostile', ['img'])
        page.evaluate("navigate('coach-mine')")   # après un render() forcé, le toucher peut tomber sur l'ancien nœud (WebKit)
        ws(page, '.coach-mine-view .coach-prog')
        page.click('[data-action="coach-prog-toggle"]')
        ws(page, '.coach-prog__preview')
        screen(page, t, 'Mon coach (programme et aperçu, pseudo hostile)', ['img', 'script', 'js', 'ent', 'emoji', 'rtl'])
        page.click('.chat-cell')
        ws(page, '.coach-chat-view .chat-msg')
        R.check(page.locator('.chat-msg--theirs').count() == len(CHARGES), f'{t} messages : une bulle par charge')
        screen(page, t, 'messages du coach', list(CHARGES))
        # Programme ajouté : accueil, Programme, Mes programmes, éditeur, séance
        page.evaluate("routeTo('friends'); navigate('coach-mine')")
        ws(page, '.coach-prog [data-action="coach-add-prog"]')
        page.click('.coach-prog [data-action="coach-add-prog"]')
        page.wait_for_timeout(400)
        tap_dialog(page, 'Passer à ce programme')
        page.wait_for_timeout(300)
        pid = page.evaluate('data.activeProgramme')
        R.check(pid.startswith('u_c') and pid.endswith('_u_evil'), f'{t} programme du coach ajouté et actif ({pid})')
        page.evaluate("routeTo('dashboard')")
        ws(page, '.dashboard')
        screen(page, t, 'accueil (programme du coach)', ['img'])
        page.evaluate("routeTo('programmes')")
        page.wait_for_timeout(300)
        screen(page, t, 'page Programme', ['img', 'script', 'ent', 'rtl'])
        go(page, "'my-programmes'", '#app')
        screen(page, t, 'Mes programmes', ['img', 'rtl'])
        go(page, "'editor:sA'", '#app')
        screen(page, t, 'éditeur de la séance du coach', ['script', 'js', 'emoji', 'rtl'])
        page.evaluate("startSession('sA')")
        ws(page, '.ex-card')
        screen(page, t, 'séance du programme du coach', ['script', 'js', 'emoji'])
        page.evaluate("activeSession = null; persistSession(); routeTo('history')")
        page.wait_for_timeout(300)
        go(page, f"'history-detail:{ids['sid']}'", '.coach-note')
        screen(page, t, 'commentaire du coach sur ma séance', ['img', 'ent'])
        R.check(not page.errors, f'{t} élève : aucune erreur JS {page.errors[:3]}')


# ── Open Food Facts ──────────────

NOW_OFF = local_ms(2026, 11, 9, 12, 30, tz=PARIS)
NUTRI = {'energy-kcal_100g': 120, 'proteins_100g': 6, 'carbohydrates_100g': 10, 'fat_100g': 5}
# Nom affiché « Marque · Nom », coupé à 80 caractères (dietCutName) : une ou deux charges par produit
OFF_PRODUCTS = {
    '3017620422003': ({'product_name': IMG, 'brands': f'{JS}, Groupe', 'quantity': '400 g'}, ['img', 'js']),
    '4006381333931': ({'product_name_fr': ENT, 'brands': SCR}, ['ent', 'script']),
    '3760000000123': ({'product_name_fr': EMOJI, 'brands': RTL}, ['rtl', 'emoji']),
}
FAKE_SCANNER = """
window.__scan = { code: null, type: 'ean13' };
const scanner = { scan: async () => ({ code: window.__scan.code, type: window.__scan.type }) };
window.Capacitor = {
  isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: n => n === 'MdlfScanner',
  registerPlugin: name => name === 'MdlfScanner' ? scanner
    : name === 'App' ? { addListener: async () => ({ remove() {} }), getInfo: async () => ({ build: '41', version: '1.2' }) }
    : new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) }),
};
"""


def off_route(route):
    code = route.request.url.split('/product/')[1].split('.json')[0]
    prod = OFF_PRODUCTS.get(code)
    body = {'status': 1, 'code': code, 'product': {**prod[0], 'nutriments': NUTRI}} if prod else None
    if not body:
        return route.fulfill(status=404, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body='{"status":0}')
    route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))


def t_off(bench, eng, dev, theme):
    t = tag(dev, theme)
    d = ppl_v2_today(now_ms=NOW_OFF)
    d['dietPlans'] = {'d_evil': {'name': 'Mon plan', 'meals': [{'id': 'm1', 'name': 'Petit-déjeuner', 'items': []},
                                                               {'id': 'm2', 'name': 'Déjeuner', 'items': []},
                                                               {'id': 'm3', 'name': 'Collation', 'items': []}]}}
    d['dietActive'] = 'd_evil'
    with bench.frozen_page(NOW_OFF, eng, dev, theme) as page:
        page.add_init_script(HOOK)
        page.add_init_script(FAKE_SCANNER)
        page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
        page.route('https://world.openfoodfacts.org/**', off_route)
        seed(page, theme, json.dumps(d, ensure_ascii=False), extra={'ppl_welcome_seen': '1'})
        page.wait_for_timeout(300)
        go(page, "makeRoute('diet-plan', 'd_evil')", '.diet-plan-view [data-action="diet-add-food"]')
        for meal, (code, (_, expect)) in enumerate(OFF_PRODUCTS.items()):
            label = ', '.join(expect)
            page.locator('[data-action="diet-add-food"]').nth(meal).click()
            ws(page, '.diet-cand--scan')
            page.wait_for_timeout(250)
            page.evaluate('c => { window.__scan = { code: c, type: "ean13" }; }', code)
            page.click('.diet-cand--scan')
            ws(page, '.fscan__name')
            screen(page, t, f'fiche Open Food Facts ({label})', expect)
            page.click('.sheet-root .sheet__btn--confirm')
            page.wait_for_timeout(400)
        screen(page, t, 'plan diète avec les produits scannés', list(CHARGES))
        R.check(not page.errors, f'{t} Open Food Facts : aucune erreur JS {page.errors[:3]}')


# ── Une fois : le coach face à un élève hostile ──────────────

ENGINES = [('webkit', 'iPhone 13'), ('chromium', 'Pixel 7')]


def t_coach_face_eleve(bench):
    import time
    now = int(time.time() * 1000)
    for eng, dev in ENGINES:
        t = f'{dev} coach'
        with bench.page(eng, dev, 'dark') as page:
            open_app(page, 'dark')
            signin(page)
            ids = page.evaluate("""([charges, sess]) => {
                const me = __sb.meId(); __sb.makeCoach(me);
                const ev = __sb.addPerson({ username: charges.img, avatar: charges.js, social: false, sessions: [sess] });
                const rtl = __sb.addPerson({ username: charges.rtl, social: false });
                __sb.link(me, ev, Date.now() - 20 * 86400e3); __sb.link(me, rtl, Date.now() - 10 * 86400e3);
                let k = 6;
                for (const v of Object.values(charges)) __sb.msg(ev, false, v, Date.now() - (k--) * 600e3);
                return { ev, rtl };
            }""", [CHARGES, hostile_session('s_evil', 'script', now - DAY)])
            page.evaluate('coachRefresh()')
            page.wait_for_timeout(500)
            page.click('.tabbar [data-tab="friends"]')
            ws(page, '.coach-team .coach-student-row')
            screen(page, t, 'Mes élèves (pseudos refusés)', ['script'])
            # Vue seule : pseudos hostiles passés au travers de cleanPerson
            inject = """([charges, ids]) => { for (const x of coach.state.students) {
                if (x.user_id === ids.ev) x.username = charges.img; if (x.user_id === ids.rtl) x.username = charges.rtl; } render(); }"""
            page.evaluate(inject, [CHARGES, ids])
            screen(page, t, 'vue seule : Mes élèves, pseudos hostiles', ['img', 'rtl', 'script'])
            go(page, f"makeRoute('coach-student', '{ids['ev']}')", '.chat-cell')
            page.evaluate(inject, [CHARGES, ids])
            screen(page, t, 'vue seule : fiche de l\'élève, pseudo hostile', ['img', 'script'])
            go(page, f"makeRoute('coach-session', '{ids['ev']}', 's_evil')", '#app')
            screen(page, t, 'séance de l\'élève', ['script'])
            go(page, f"makeRoute('coach-chat', '{ids['ev']}')", '.coach-chat-view .chat-msg')
            screen(page, t, 'messages de l\'élève', list(CHARGES))
            R.check(not page.errors, f'{t} : aucune erreur JS {page.errors[:3]}')


run_main(R, [t_social, t_eleve, t_off], once=[t_coach_face_eleve])
