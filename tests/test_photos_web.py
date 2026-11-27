"""Photos de bilan sur ordinateur (docs/PHOTOS_WEB.md) : « Relier cet ordinateur » et l'onglet Bilans, dans Chromium,
Firefox et WebKit.

    python3 tests/test_photos_web.py            # 3 moteurs ; PPL_ENGINES=chromium pour un seul
    PPL_NO_APP=1 python3 tests/test_photos_web.py   # sans le parcours avec l'app iPhone simulée

1. Le site seul (chaque moteur, 1440 px sombre puis 820 px clair et tactile) : le « téléphone » est joué dans la page
   par les fonctions du protocole (js/data/photo-link.js), contre le faux serveur de tests/fake_photo_link.py.
   QR code (relu par OpenCV s'il est installé), code de vérification identique, photos des deux bilans côte à côte,
   zoom, masquées sans geste ou onglet caché, clé non extractible dans IndexedDB et rien d'autre, rien dans
   localStorage, Cache Storage ni service worker, rechargement (reste relié), retrait depuis l'iPhone, clé changée,
   « Oublier cet ordinateur », déconnexion, scripts de connexion tiers (page rechargée avant les photos), serveur sans
   la migration ; attaques : le serveur remplace la clé du téléphone (codes différents, rien de gardé) ou glisse une
   autre clé du coach (rien de gardé).
2. L'app iPhone simulée et l'ordinateur (Chromium et WebKit) : deux pages, deux faux serveurs recopiés l'un vers
   l'autre. Coach › Mes élèves › Ordinateurs reliés › Relier un ordinateur (lecteur natif simulé qui rend le texte du
   QR), code identique sur les deux écrans, Face ID simulé, photos ouvertes sur l'ordinateur ; liste et « Retirer »
   dans l'app ; QR d'un autre compte, QR modifié, serveur qui ment sur la clé du QR, ancienne build (lecteur sans QR).

Aucun réseau, aucune vraie clé : comptes, secrets et images factices tirés par le test. Un navigateur à la fois, sans
fenêtre, Chromium muet. Captures : $PPL_SCRATCH/shots/photos-web/.
"""
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright  # noqa: E402
import fixtures  # noqa: E402
from coach_web_fixtures import static_server, launch, open_desk, NOW  # noqa: E402
from fake_account import FAKE_ACCOUNT, FAKE_VAULT  # noqa: E402
from fake_photo_link import FAKE_PHOTO_LINK  # noqa: E402

ENGINES = [e for e in os.environ.get('PPL_ENGINES', 'chromium,firefox,webkit').split(',') if e]
SHOTS = os.path.join(os.environ.get('PPL_SCRATCH', '/tmp/ppl-tests'), 'shots', 'photos-web')

try:
    import cv2  # noqa: E402
    import numpy  # noqa: E402,F401
except ImportError:
    cv2 = None


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def shot(page, name, locator=None):
    """Capture (page entière, ou un élément). Playwright pose un style le temps d'une capture dans WebKit : les seules
    violations de CSP nées pendant la capture sont retirées de window.__csp (celles de la page restent comptées)."""
    n = page.evaluate('(window.__csp || []).length')
    errs = len(getattr(page, 'errors', []))
    if locator is not None:
        png = locator.screenshot(caret='initial')
    else:
        os.makedirs(SHOTS, exist_ok=True)
        png = page.screenshot(path=os.path.join(SHOTS, name + '.png'), caret='initial')
    page.wait_for_timeout(100)   # événements de la capture arrivés
    if hasattr(page, 'errors'):
        del page.errors[errs:]
    page.evaluate('n => { if (window.__csp) window.__csp.length = Math.min(window.__csp.length, n); if (window.__cspd) window.__cspd.length = Math.min(window.__cspd.length, n); }', n)
    return png


# Données des photos du site seul : clé du coach (secret de trousseau factice), photos face, profil, dos des bilans S46
# et S47 de Léa, chiffrées pour cette clé ; gardées dans sessionStorage d'un rechargement à l'autre (avec l'état du faux
# serveur de l'appairage), comme le serait le vrai serveur. Le « téléphone » (window.__phone) joue l'iPhone du coach.
PHOTOS_SEED = r"""
document.addEventListener('securitypolicyviolation', e => (window.__cspd ||= []).push([e.sourceFile, e.lineNumber, e.columnNumber, e.sample, document.querySelector('dialog[open]')?.className || '', location.hash.slice(-8)]));
document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.__sb, co = sb.co, coach = window.__coachId, lea = window.__students[0], KEEP = '__fakePh';
  const keyId = 'ab'.repeat(16);
  const save = () => { try { sessionStorage.setItem(KEEP, JSON.stringify({ pkeys: co.pkeys, photos: co.photos, objs: sb.objs, pl: { pairs: sb.pl.pairs, devices: sb.pl.devices }, secret: window.__kc, answers: window.__phAnswers })); } catch {} };
  window.addEventListener('pagehide', save);
  window.__phSave = save;
  const kept = JSON.parse(sessionStorage.getItem(KEEP) || 'null');
  const reqs = sb.ck.requests.filter(r => r.student === lea).sort((a, b) => b.sent_at - a.sent_at);
  if (kept) {
    Object.assign(co, { pkeys: kept.pkeys, photos: kept.photos }); sb.objs = kept.objs; sb.pl.pairs = kept.pl.pairs; sb.pl.devices = kept.pl.devices;
    window.__kc = kept.secret; window.__phAnswers = kept.answers;
    Object.entries(kept.answers).forEach(([i, ids]) => { sb.ck.answers[reqs[i].id].photos = { ids }; });
  } else {
    window.__kc = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const { rec } = await coachKeyMake(await vaultImportKey(window.__kc), coach, keyId);
    co.pkeys[coach] = { ...rec, created_at: new Date().toISOString() };
    // Images unies (aucune personne), une couleur par pose et par semaine
    const jpeg = async (rgb) => { const c = document.createElement('canvas'); c.width = 300; c.height = 400; const g = c.getContext('2d'); g.fillStyle = rgb; g.fillRect(0, 0, 300, 400);
      g.fillStyle = '#fff'; g.fillRect(40, 60, 220, 30); return new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8))).arrayBuffer()); };
    window.__phAnswers = {};
    const weeks = [[0, '2026-11-16', ['#d33', '#3a3', '#33d']], [1, '2026-11-09', ['#a55', '#5a5', '#55a']]];
    for (const [i, day, colors] of weeks) {
      const ids = [];
      for (const [k, pose] of ['face', 'side', 'back'].entries()) {
        const id = crypto.randomUUID(), meta = { id, student: lea, coach, keyId, takenOn: day, pose };
        const s = await coachPhotoSeal(rec.public_key, await jpeg(colors[k]), meta);
        let bin = ''; s.ct.forEach(x => { bin += String.fromCharCode(x); });
        sb.objs[`${lea}/${id}`] = { b64: btoa(bin), size: s.ct.length, owner: lea, type: 'application/octet-stream', at: Date.now() };
        co.photos.push({ id, student: lea, coach, key_id: keyId, taken_on: day, pose, epk: s.epk, iv: s.iv, state: 'ready', bytes: s.ct.length, created_at: Date.now(), sent_at: new Date().toISOString() });
        ids.push(id);
      }
      window.__phAnswers[i] = ids;
      sb.ck.answers[reqs[i].id].photos = { ids };
    }
  }
  // L'iPhone du coach, joué ici : mêmes étapes que js/data/photo-link-phone.js, contre le même faux serveur
  const call = (fn, a) => { const r = sb.extraRpc[fn](coach, a); return r && r.error ? Promise.reject(new Error(r.error.message)) : Promise.resolve(r); };
  window.__phone = {
    async offer(text) {
      const q = plinkQrParse(text); if (!q) throw new Error('bad_qr');
      if (q.coach !== coach) throw new Error('other_account');
      const pk = cleanPlinkPeek(await call('coach_photo_pair_peek', { pair: q.pair }));
      if (pk.devicePub !== q.pub) throw new Error('mismatch');
      const E = await crypto.subtle.generateKey(PLINK_P256, false, ['deriveBits']);
      const epk = bytesToB64(new Uint8Array(await crypto.subtle.exportKey('raw', E.publicKey)));
      const ctx = { pair: q.pair, coach, devicePub: q.pub, epk, secret: q.secret };
      const d = await plinkDerive(E.privateKey, q.pub, ctx, 'encrypt');
      await call('coach_photo_pair_offer', { pair: q.pair, verifier: await plinkVerifier(q.secret), epk });
      this.pending = { ctx, d };
      return d.sas;
    },
    async finish() {
      const { ctx, d } = this.pending, rec = co.pkeys[coach];
      const pkcs8 = await coachKeyPkcs8(await vaultImportKey(window.__kc), coach, rec);
      const w = await plinkWrap(d.wrapKey, pkcs8, { device: ctx.pair, coach, keyId: rec.key_id, coachPub: rec.public_key });
      pkcs8.fill(0);
      await call('coach_photo_pair_complete', { pair: ctx.pair, key_id: rec.key_id, wrapped: w.wrapped, iv: w.iv });
    },
  };
  window.__phReady = true;
});
// Session de supabase-js reprise au rechargement (le faux serveur repart de zéro, mêmes comptes)
(() => { const sb = window.__sb, cc = window.supabase.createClient;
  window.supabase.createClient = (u, k, o) => { const c = cc(u, k, o); try { const s = JSON.parse(o?.auth?.storage?.getItem(o.auth.storageKey) || 'null'); if (s && sb.users[s.user?.id]) sb.session = s; } catch {} return c; };
})();
"""


def until(page, expr, timeout=15000):
    """Attend qu'une expression soit vraie, par page.evaluate (wait_for_function passe par eval, refusé par la CSP)."""
    import time
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if page.evaluate(expr):
                return
        except Exception:
            pass   # page en cours de rechargement
        time.sleep(0.1)
    try:
        state = page.evaluate("[typeof window.__mark, typeof ph !== 'undefined' && !!ph.session, typeof view !== 'undefined' && view.student && (view.student.checkins || []).length, document.querySelectorAll('.ph-sec img').length]")
    except Exception as e:
        state = str(e)
    raise AssertionError(f'jamais vrai : {expr} ({state})')


def decode_qr(page):
    """Texte du QR affiché, relu par OpenCV sur une capture (None si OpenCV est absent)."""
    if cv2 is None:
        return None
    import numpy as np
    png = shot(page, 'qr', page.locator('svg.qr'))
    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
    txt, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    return txt or None


def idb_dump(page):
    """Contenu de la base IndexedDB du site : pour chaque entrée, ses champs et la nature de chaque valeur."""
    return page.evaluate("""() => new Promise(res => {
      const kind = v => (v && typeof v === 'object' && 'extractable' in v ? { cryptoKey: true, extractable: v.extractable, type: v.type, usages: v.usages } : typeof v);
      const rq = indexedDB.open('mdlf-coach-web');
      rq.onerror = () => res(null);
      rq.onsuccess = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('link')) { db.close(); res([]); return; }
        const g = db.transaction('link').objectStore('link').getAll();
        g.onsuccess = () => { db.close(); res(g.result.map(e => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, kind(v)])))); };
      };
    })""")


def go_bilans(page):
    lea = page.evaluate('window.__students[0]')
    page.evaluate(f"location.hash = '#/eleve/{lea}/bilans'")
    page.wait_for_selector('.ph-sec')
    until(page, "!document.querySelector('.ph-sec').innerText.includes('Chargement')")


def run_poll(page, ms=1600):
    page.clock.run_for(ms)
    page.wait_for_timeout(50)


def pair_web(page, tap=False, evil=None):
    """Relier depuis l'onglet Bilans : QR, offre du téléphone, code, fin. Rend (code du téléphone, code de la page)."""
    click = (lambda s: page.locator(s).first.tap()) if tap else (lambda s: page.locator(s).first.click())
    click('[data-ph="link"]')
    page.wait_for_selector('dialog.phl[open]')
    click('dialog.phl [data-phl="start"]')
    page.wait_for_selector('dialog.phl svg.qr')
    text = page.evaluate('ph.pair.qr')
    seen = decode_qr(page)
    if seen is not None:
        check(seen == text, f'QR relu par OpenCV différent : {seen!r}')
    if evil:
        page.evaluate(f'__sb.pl.evil = {json.dumps(evil)}')
    sas_phone = page.evaluate('t => __phone.offer(t)', text)
    until(page, 'window.__sb && true')
    run_poll(page)
    page.wait_for_selector('dialog.phl .phl-sas, dialog.phl [role=alert]')
    sas_page = page.locator('dialog.phl .phl-sas').inner_text() if page.locator('dialog.phl .phl-sas').count() else ''
    return sas_phone, sas_page


def web_journey(browser, url, engine):
    for (w, h, touch, theme) in [(1440, 900, False, 'dark'), (820, 1180, True, 'light')]:
        tag = f'{engine} {w}px {theme}'
        ctx, page = open_desk(browser, url, width=w, height=h, theme=theme, touch=touch, checkins=True, pre=FAKE_PHOTO_LINK + PHOTOS_SEED)
        click = (lambda s: page.locator(s).first.tap()) if touch else (lambda s: page.locator(s).first.click())
        if os.environ.get('PPL_DEBUG'):
            page.on('framenavigated', lambda f: print('NAV', f.url, flush=True))
            page.on('console', lambda m: print('CONSOLE', m.text[:160], flush=True))
        try:
            until(page, 'window.__phReady')
            page.evaluate('deskThirdParty = false')   # rechargement après les scripts tiers : third_party_reload
            go_bilans(page)
            until(page, "document.querySelector('.ph-sec')?.innerText.includes('photos envoyées')")   # IndexedDB lue
            sec = page.locator('.ph-sec').inner_text()
            check('3 photos envoyées' in sec or '6 photos envoyées' in sec, f'{tag} : section des photos {sec!r}')
            check(page.locator('.ph-sec img').count() == 0, f'{tag} : aucune image avant de relier')
            click('[data-ph="link"]')
            page.wait_for_selector('dialog.phl[open]')
            check(page.locator('dialog.phl').inner_text().count('partagé') == 1, f'{tag} : mise en garde « ordinateur partagé »')
            shot(page, f'1-relier-{engine}-{w}-{theme}')
            click('dialog.phl [data-phl="start"]')
            page.wait_for_selector('dialog.phl svg.qr')
            shot(page, f'2-qr-{engine}-{w}-{theme}')
            text = page.evaluate('ph.pair.qr')
            check(text.startswith('MDLF1.') and len(text) < 170, f'{tag} : texte du QR {text!r}')
            seen = decode_qr(page)
            check(seen is None or seen == text, f'{tag} : QR relu {seen!r}')
            srv = page.evaluate('__sb.pl.pairs[0]')
            check(srv['verifier'] != text.split('.')[4] and text.split('.')[4] not in json.dumps(srv), f'{tag} : le secret du QR n\'est jamais envoyé au serveur')
            page.evaluate('window.__mark = 1')
            sas = page.evaluate('t => __phone.offer(t)', text)
            run_poll(page)
            page.wait_for_selector('dialog.phl .phl-sas')
            check(page.locator('dialog.phl .phl-sas').inner_text() == sas, f'{tag} : même code sur les deux écrans')
            shot(page, f'3-code-{engine}-{w}-{theme}')
            page.evaluate('__phone.finish()')
            run_poll(page)
            page.wait_for_selector('dialog.phl [data-phl="close"]:has-text("Voir les photos")')
            click('dialog.phl [data-phl="close"]')
            until(page, "document.querySelectorAll('.ph-sec img').length === 6", timeout=15000)
            imgs = page.evaluate("[...document.querySelectorAll('.ph-sec img')].map(i => [i.src.slice(0, 5), i.naturalWidth > 0, i.alt])")
            check(all(s == 'blob:' and ok for s, ok, _ in imgs), f'{tag} : images déchiffrées en blob: {imgs}')
            check(page.locator('.ph-h [role=columnheader]').count() == 3, f'{tag} : deux bilans côte à côte')
            shot(page, f'4-photos-{engine}-{w}-{theme}')
            # IndexedDB : une seule entrée, la clé d'enveloppe non extractible, ni clé du coach ni secret du QR
            dump = idb_dump(page)
            check(len(dump) == 1 and dump[0]['wrapKey'] == {'cryptoKey': True, 'extractable': False, 'type': 'secret', 'usages': ['unwrapKey']}, f'{tag} : IndexedDB {dump}')
            check(set(dump[0]) == {'coach', 'device', 'wrapKey', 'keyId', 'coachPub', 'label', 'linkedAt'}, f'{tag} : champs gardés {sorted(dump[0])}')
            check(page.evaluate("(async () => { try { await crypto.subtle.exportKey('raw', ph.entry.wrapKey); return 'exportée'; } catch { return 'refusée'; } })()") == 'refusée', f'{tag} : clé exportable')
            check(page.evaluate("(async () => { try { await crypto.subtle.exportKey('pkcs8', ph.session.priv); return 'exportée'; } catch { return 'refusée'; } })()") == 'refusée', f'{tag} : clé du coach exportable')
            # « Rester connecté » coché par défaut (26/11/2026) : seules la session et l'heure du dernier geste, dans
            # localStorage ; rien dans l'onglet (hors état du faux serveur, « __… »)
            keys = page.evaluate("Object.keys(localStorage).filter(k => !k.startsWith('mdlf_push_')).sort()")
            check(keys == ['mdlf-coach-web-auth', 'mdlf_coach_web_active'], f'{tag} : localStorage {keys}')
            keys = page.evaluate("Object.keys(sessionStorage).filter(k => !k.startsWith('__')).sort()")
            check(keys == [], f'{tag} : sessionStorage {keys}')
            check(page.evaluate("(async () => (await caches.keys()).length + (navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0))()") == 0, f'{tag} : cache ou service worker')
            # Zoom : les deux bilans pour la même pose, zoom commun
            click('.ph-cell[data-pose="face"]')
            page.wait_for_selector('dialog.phz[open] .phz-view img')
            check(page.locator('dialog.phz .phz-view img').count() == 2, f'{tag} : zoom, deux photos côte à côte')
            click('dialog.phz [data-pz="in"]')
            check(page.locator('dialog.phz .phz-z').inner_text().replace(' ', ' ').replace('\xa0', ' ') == '150 %', f'{tag} : zoom à 150 %')
            tr = page.evaluate("[...document.querySelectorAll('dialog.phz .phz-view img')].map(i => getComputedStyle(i).transform + '|' + i.dataset.zoom)")
            check(len(set(tr)) == 1 and 'scale(1.5)' in tr[0] and tr[0].startswith('matrix(1.5'), f'{tag} : zoom commun {tr}')
            if not touch:
                page.keyboard.press('ArrowRight')
                check(page.locator('#phz-t').inner_text() == 'Profil', f'{tag} : flèche, pose suivante')
            shot(page, f'5-zoom-{engine}-{w}-{theme}')
            click('dialog.phz [data-pz="close"]')
            check(not page.evaluate('window.__csp'), f'{tag} : CSP {page.evaluate("window.__csp")} {page.evaluate("window.__cspd")}')
            # Onglet caché : masquées, images libérées
            page.evaluate("Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange'))")
            check(page.locator('.ph-sec img').count() == 0 and page.locator('[data-ph="show"]').count() == 1, f'{tag} : onglet caché, photos masquées')
            check(page.evaluate('ph.urls.size') == 0 and page.evaluate('ph.session') is None, f'{tag} : clé et images oubliées')
            page.evaluate("Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })")
            # Rechargement : toujours relié, « Afficher les photos » sans l'iPhone
            page.evaluate('__phSave()')
            page.reload()
            until(page, 'window.__phReady')
            # Le faux serveur repart de zéro au rechargement (données des bilans posées après le démarrage de la page)
            page.evaluate('deskRefresh({ force: true }).then(() => deskOpenStudent(deskRoute().id, { force: true }))')
            page.wait_for_selector('.ph-sec [data-ph="show"]')
            check(page.locator('.ph-sec img').count() == 0, f'{tag} : rien d\'affiché tout seul après le rechargement')
            click('[data-ph="show"]')
            until(page, "document.querySelectorAll('.ph-sec img').length === 6", timeout=15000)
            # 5 minutes sans geste : masquées
            page.clock.run_for(5 * 60_000 + 1000)
            page.wait_for_selector('[data-ph="show"]')
            check('5 minutes' in page.locator('.ph-sec').inner_text(), f'{tag} : masquées après 5 minutes')
            # Quitter l'onglet Bilans : rien ne reste ouvert
            click('[data-ph="show"]')
            until(page, "document.querySelectorAll('.ph-sec img').length === 6", timeout=15000)
            page.evaluate("location.hash = location.hash.replace('/bilans', '')")
            page.wait_for_selector('table.wk')
            check(page.evaluate('ph.session') is None and page.evaluate('ph.urls.size') == 0, f'{tag} : onglet quitté, photos refermées')
            go_bilans(page)
            # Réglages : relié, puis retrait depuis l'iPhone
            page.evaluate("location.hash = '#/reglages'")
            page.wait_for_selector('[data-ph="forget"]')
            page.evaluate('__sb.pl.devices = []')
            go_bilans(page)
            click('[data-ph="show"]')
            page.wait_for_selector('[data-ph="link"]')
            check(idb_dump(page) == [], f'{tag} : retiré depuis l\'iPhone, entrée effacée')
            check(not page.errors, f'{tag} : erreurs {page.errors}')
        except Exception:
            os.makedirs(SHOTS, exist_ok=True)
            page.screenshot(path=os.path.join(SHOTS, f'echec-{tag.replace(" ", "_")}.png'), full_page=True)
            raise
        finally:
            ctx.close()


def third_party_reload(browser, url, engine):
    """Connexion par code : le faux Apple JS a été chargé dans la page. « Relier » recharge d'abord la page (session
    gardée), sans aucun script tiers, puis rouvre le dialogue tout seul."""
    ctx, page = open_desk(browser, url, width=1440, checkins=True, pre=FAKE_PHOTO_LINK + PHOTOS_SEED)
    try:
        until(page, 'window.__phReady')
        check(page.evaluate("!!document.querySelector('script[src*=\"appleid\"]')"), f'{engine} : le script d\'Apple est là après la connexion')
        go_bilans(page)
        page.evaluate('window.__avant = true')
        page.locator('[data-ph="link"]').click()
        page.wait_for_selector('dialog.phl[open]', timeout=30000)
        check(page.evaluate('window.__avant') is None, f'{engine} : page rechargée avant les photos')
        check(page.evaluate("!document.querySelector('script[src*=\"appleid\"]')"), f'{engine} : plus aucun script tiers')
        check(page.evaluate("sessionStorage.getItem('mdlf_coach_web_resume')") is None, f'{engine} : reprise consommée')
    finally:
        ctx.close()


def google_journey(browser, url, engine):
    """Se connecter avec Google : aller chez Google (simulé), retour avec ?code=…, session, adresse nettoyée ; refus."""
    # Identité Google posée sur le coach dès l'injection (le retour de Google est traité avant DOMContentLoaded)
    pre = ("window.__googleSub = 'google-sub-coach'; (() => { const u = __sb.users[window.__coachId]; "
           "u.identities.push({ identity_id: 'idt-google', provider: 'google', id: 'google-sub-coach', identity_data: { sub: 'google-sub-coach' }, created_at: u.created_at }); })();")
    ctx, page = open_desk(browser, url, width=1440, login=False, pre=pre)
    try:
        page.wait_for_selector('#google-signin')
        g, a, e = (page.locator(x).bounding_box() for x in ('#google-signin', '#apple-signin', '#login-email'))
        check(a['y'] < g['y'] < e['y'] and g['height'] >= 44, f'{engine} Google : sous Apple, au-dessus de l\'e-mail, 44 px')
        page.locator('#google-signin').click()
        page.wait_for_selector('.lst a.row', timeout=30000)
        check(page.evaluate('location.search') == '', f'{engine} Google : code retiré de l\'adresse ({page.evaluate("location.search")!r})')
        check(page.evaluate("JSON.parse(sessionStorage.getItem('__fakeGoogle') || 'null')") is None, f'{engine} Google : code consommé')
        check(page.locator('.lst a.row').count() == 10, f'{engine} Google : tableau de bord du coach')
        # Session (et vérificateur PKCE, même stockage) dans localStorage (« Rester connecté », coché par défaut), rien dans l'onglet
        check(page.evaluate("Object.keys(sessionStorage).filter(k => k.startsWith('mdlf-coach-web-auth'))") == [], f'{engine} Google : rien dans l\'onglet')
        check(page.evaluate("!!localStorage.getItem('mdlf-coach-web-auth')"), f'{engine} Google : session dans localStorage')
        check(not page.evaluate('window.__csp'), f'{engine} Google : CSP {page.evaluate("window.__csp")}')
    finally:
        ctx.close()
    ctx, page = open_desk(browser, url, width=1440, login=False, pre="window.__googleFail = 'access_denied';")
    try:
        page.locator('#google-signin').click()
        until(page, "document.getElementById('login-err')?.innerText.includes('annulée')", timeout=30000)
        check(page.evaluate('location.search') == '' and page.locator('#login-email').count() == 1, f'{engine} Google refusé : retour à la connexion')
    finally:
        ctx.close()


def embedded_journey(browser, url, engine):
    """Page embarquée dans l'app (mode grand écran iPad, faux hôte SANS photos) : renvoi vers un ordinateur, ni
    « Relier », ni « Afficher », rien dans Réglages, aucune requête d'appairage."""
    ctx, page = open_desk(browser, url, width=1180, height=820, touch=True, login=False, checkins=True, host=True, pre=FAKE_PHOTO_LINK + PHOTOS_SEED)
    try:
        until(page, 'window.__phReady')
        page.wait_for_selector('.lst a.row', timeout=30000)
        go_bilans(page)
        sec = page.locator('.ph-sec').inner_text()
        check('Photos : ouvre coach.mdlf.app sur un ordinateur.' in sec, f'{engine} iPad : renvoi vers un ordinateur ({sec!r})')
        check(page.locator('.ph-sec [data-ph]').count() == 0 and page.locator('.ph-sec img').count() == 0, f'{engine} iPad : ni bouton, ni image')
        page.evaluate("location.hash = '#/reglages'")
        page.wait_for_selector('h1.title')
        check(page.locator('[data-ph]').count() == 0, f'{engine} iPad : rien des photos dans Réglages')
        check(page.evaluate("__sb.calls.filter(c => String(c[1]).startsWith('coach_photo_pair') || c[1] === 'coach_photo_device_key').length") == 0, f'{engine} iPad : aucune requête d\'appairage')
        check(not page.errors, f'{engine} iPad : erreurs {page.errors}')
    finally:
        ctx.close()


def web_attacks(browser, url, engine):
    """Serveur compromis, clé changée, oublier, déconnexion, serveur d'avant (un moteur à la fois, 1440 px)."""
    ctx, page = open_desk(browser, url, width=1440, checkins=True, pre=FAKE_PHOTO_LINK + PHOTOS_SEED)
    try:
        until(page, 'window.__phReady')
        page.evaluate('deskThirdParty = false')   # rechargement des scripts tiers : vu par web_journey
        go_bilans(page)
        # 1. Le serveur relaie au navigateur une autre clé que celle du téléphone : codes différents, rien de gardé
        evil_pub = page.evaluate("(async () => { const k = await crypto.subtle.generateKey(PLINK_P256, true, ['deriveBits']); return bytesToB64(new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey))); })()")
        sas_phone, sas_page = pair_web(page, evil={'epk': evil_pub})
        check(sas_page and sas_page != sas_phone, f'{engine} homme du milieu : les deux codes diffèrent ({sas_phone} / {sas_page})')
        page.evaluate('__phone.finish()')   # le coach n'aurait pas dû accepter : même ainsi, rien ne s'ouvre
        run_poll(page)
        page.wait_for_selector('dialog.phl [role=alert]')
        check('ne correspond pas' in page.locator('dialog.phl').inner_text(), f'{engine} homme du milieu : refus dit')
        check(idb_dump(page) == [] and page.evaluate('ph.entry') is None, f'{engine} homme du milieu : rien de gardé')
        page.locator('dialog.phl [data-phl="close"]').first.click()
        # 2. Le serveur glisse une autre clé publique du coach : l'enveloppe ne s'ouvre pas, rien de gardé
        page.evaluate(f"__sb.pl.evil = {{ coachPub: {json.dumps(evil_pub)} }}")
        pair_web(page)
        page.evaluate('__phone.finish()')
        run_poll(page)
        page.wait_for_selector('dialog.phl [role=alert]')
        check(idb_dump(page) == [] and not page.evaluate('__sb.pl.devices.length'), f'{engine} clé du coach glissée : rien de gardé, ordinateur retiré')
        page.locator('dialog.phl [data-phl="close"]').first.click()
        page.evaluate('__sb.pl.evil = {}')
        # 3. Code expiré : 2 minutes
        page.locator('[data-ph="link"]').first.click()
        page.locator('dialog.phl [data-phl="start"]').click()
        page.wait_for_selector('dialog.phl svg.qr')
        page.clock.run_for(121_000)
        page.wait_for_selector('dialog.phl [role=alert]')
        check('expiré' in page.locator('dialog.phl').inner_text(), f'{engine} code expiré')
        page.locator('dialog.phl [data-phl="close"]').first.click()
        check(page.evaluate('__sb.pl.pairs.length') == 0, f'{engine} appairage expiré annulé sur le serveur')
        # 4. Relié normalement, puis clé changée sur l'iPhone : à relier de nouveau
        sas_phone, sas_page = pair_web(page)
        check(sas_phone == sas_page, f'{engine} codes égaux')
        page.evaluate('__phone.finish()')
        run_poll(page)
        page.locator('dialog.phl [data-phl="close"]').first.click()
        until(page, "document.querySelectorAll('.ph-sec img').length === 6", timeout=15000)
        page.locator('[data-ph="hide"]').click()
        page.evaluate("__sb.co.pkeys[window.__coachId] = { ...__sb.co.pkeys[window.__coachId], key_id: 'cd'.repeat(16) }")
        page.locator('[data-ph="show"]').click()
        page.wait_for_selector('[data-ph="link"]')
        check(idb_dump(page) == [], f'{engine} clé changée : entrée effacée')
        page.evaluate("__sb.co.pkeys[window.__coachId] = { ...__sb.co.pkeys[window.__coachId], key_id: 'ab'.repeat(16) }")
        # 5. Oublier cet ordinateur (Réglages) : entrée effacée ET ordinateur retiré du serveur
        pair_web(page)
        page.evaluate('__phone.finish()')
        run_poll(page)
        page.locator('dialog.phl [data-phl="close"]').first.click()
        page.evaluate("location.hash = '#/reglages'")
        page.locator('[data-ph="forget"]').click()
        page.locator('dialog.confirm [data-cf="yes"]').click()
        page.wait_for_selector('[data-ph="link"]')
        check(idb_dump(page) == [] and page.evaluate('__sb.pl.devices.length') == 0, f'{engine} oublier : effacé ici et sur le serveur')
        # 6. Déconnexion de cet ordinateur : oublie aussi
        go_bilans(page)
        pair_web(page)
        page.evaluate('__phone.finish()')
        run_poll(page)
        page.locator('dialog.phl [data-phl="close"]').first.click()
        page.evaluate("location.hash = '#/reglages'")
        page.locator('[data-action="signout"]').click()
        page.wait_for_selector('#login-email')
        check(idb_dump(page) == [] and page.evaluate('__sb.pl.devices.length') == 0, f'{engine} déconnexion : oublié aussi')
        check(not page.evaluate('window.__csp'), f'{engine} CSP {page.evaluate("window.__csp")}')
        check(not page.errors, f'{engine} attaques : erreurs {page.errors}')
    finally:
        ctx.close()
    # 7. Serveur sans la migration : dit en clair, rien ne casse
    ctx, page = open_desk(browser, url, width=1440, checkins=True, pre=FAKE_PHOTO_LINK + PHOTOS_SEED + "__sb.fail.pairing = 'missing';")
    try:
        until(page, 'window.__phReady')
        page.evaluate('deskThirdParty = false')
        go_bilans(page)
        page.locator('[data-ph="link"]').click()
        page.locator('dialog.phl [data-phl="start"]').click()
        page.wait_for_selector('#toast:not([hidden])')
        check("pas encore reçu" in page.locator('#toast').inner_text(), f'{engine} serveur d\'avant : {page.locator("#toast").inner_text()!r}')
        check(page.locator('table.wk').count() == 0 and page.locator('.rv-bar').count() == 1, f'{engine} serveur d\'avant : l\'onglet Bilans reste entier')
        check(not page.errors, f'{engine} serveur d\'avant : erreurs {page.errors}')
    finally:
        ctx.close()


# ── 2. App iPhone simulée + ordinateur ───────────────────────

FAKE_SCANNER = r"""
(() => {
  window.__qr = null; window.__scanCalls = 0;
  const err = code => { const e = new Error(code); e.code = code; return e; };
  const scanner = { scan: async () => { throw err('CANCELED'); },
    scanQr: async () => { window.__scanCalls++; if (window.__oldBuild) throw err('UNIMPLEMENTED'); if (!window.__qr) throw err('CANCELED'); return { code: window.__qr, type: 'qr' }; } };
  const base = window.Capacitor;
  window.Capacitor = { ...base, isPluginAvailable: n => (n === 'MdlfScanner' ? true : base.isPluginAvailable(n)),
    registerPlugin: n => (n === 'MdlfScanner' ? scanner : base.registerPlugin(n)) };
})();
"""


def copy_state(src, dst, keys=('pl',)):
    """Ce que garde le serveur (appairages, ordinateurs ; option : clés, photos, fichiers), d'une page à l'autre ; les
    expirations ramenées à l'horloge de la page d'arrivée (les deux pages n'ont pas la même)."""
    st = src.evaluate("""keys => JSON.stringify({ pl: { pairs: __sb.pl.pairs.map(p => ({ ...p, left: p.expires - Date.now() })), devices: __sb.pl.devices },
        pkeys: keys.includes('keys') ? __sb.co.pkeys : null, photos: keys.includes('keys') ? __sb.co.photos : null, objs: keys.includes('keys') ? __sb.objs : null })""", list(keys))
    dst.evaluate("""s => { const o = JSON.parse(s); __sb.pl.pairs = o.pl.pairs.map(({ left, ...p }) => ({ ...p, expires: Date.now() + left })); __sb.pl.devices = o.pl.devices;
        if (o.pkeys) { __sb.co.pkeys = o.pkeys; __sb.co.photos = o.photos; __sb.objs = o.objs; } }""", st)


def app_journey(browser, url, engine):
    root = url.replace('coach-web/', '')
    actx = browser.new_context(viewport={'width': 390, 'height': 844}, color_scheme='dark', locale='fr-FR', timezone_id='Europe/Paris', has_touch=True,
                               device_scale_factor=2, is_mobile=engine == 'chromium')
    fixtures.track_idle(actx)
    app = actx.new_page()
    app.errors = []
    app.on('pageerror', lambda e: app.errors.append(str(e)))
    # Mêmes identifiants que le site : coach …0001, Léa …0002 (uidStart -1 : l'identité Apple prend le 0)
    app.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, 'uidStart': -1}))
    app.add_init_script(FAKE_ACCOUNT)
    app.add_init_script(FAKE_VAULT)
    app.add_init_script(FAKE_SCANNER)
    app.add_init_script(FAKE_PHOTO_LINK)
    app.route('https://mdlf-ota.vercel.app/**', lambda r: r.abort())
    fixtures.seed(app, 'dark', fixtures.ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'}, url=root)
    fixtures.settle(app)
    app.evaluate("""async () => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: 'max.coach' }); }""")
    fixtures.settle(app)
    ids = app.evaluate("""async () => { const me = __sb.meId(); __sb.makeCoach(me); const lea = __sb.addPerson({ username: 'lea', social: false });
        __sb.link(me, lea, Date.now() - 40 * 86400000); await coachRefresh(); await cphCoachRefresh(); const r = await cphCoachSetup(); return { me, lea, ok: r.ok }; }""")
    check(ids['ok'] and ids['me'].endswith('0001') and ids['lea'].endswith('0002'), f'{engine} app : comptes {ids}')
    # Photos de Léa pour S47, chiffrées pour la clé créée sur l'iPhone
    photo_ids = app.evaluate("""async ({ me, lea }) => { const k = __sb.co.pkeys[me], ids = [];
        for (const pose of ['face', 'side', 'back']) { const c = document.createElement('canvas'); c.width = 240; c.height = 320; const g = c.getContext('2d'); g.fillStyle = '#c44'; g.fillRect(0, 0, 240, 320);
          const bytes = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8))).arrayBuffer()), id = crypto.randomUUID();
          const s = await coachPhotoSeal(k.public_key, bytes, { id, student: lea, coach: me, keyId: k.key_id, takenOn: '2026-11-16', pose });
          let bin = ''; s.ct.forEach(x => { bin += String.fromCharCode(x); });
          __sb.objs[`${lea}/${id}`] = { b64: btoa(bin), size: s.ct.length, owner: lea, type: 'application/octet-stream', at: Date.now() };
          __sb.co.photos.push({ id, student: lea, coach: me, key_id: k.key_id, taken_on: '2026-11-16', pose, epk: s.epk, iv: s.iv, state: 'ready', bytes: s.ct.length, created_at: Date.now(), sent_at: new Date().toISOString() });
          ids.push(id); } return ids; }""", ids)
    # Ordinateur : le site, connecté au même compte ; photos de Léa dans son dernier bilan
    ctx, web = open_desk(browser, url, width=1440, checkins=True, pre=FAKE_PHOTO_LINK)
    try:
        check(web.evaluate('window.__coachId') == ids['me'] and web.evaluate('window.__students[0]') == ids['lea'], f'{engine} : mêmes comptes des deux côtés')
        web.evaluate('deskThirdParty = false')
        copy_state(app, web, keys=('pl', 'keys'))
        web.evaluate("ids => { __sb.ck.answers[window.__leaLast].photos = { ids }; }", photo_ids)
        go_bilans(web)
        # L'app : Coach › Mes élèves › Ordinateurs reliés
        app.evaluate("navigate('coach-students')")
        fixtures.settle(app)
        app.wait_for_selector('[data-action="plink-open"]')
        app.tap('[data-action="plink-open"]')
        fixtures.settle(app)
        check('Aucun ordinateur relié' in app.inner_text('.plink-view'), f'{engine} app : liste vide')
        shot(app, f'6-app-liste-{engine}')
        # Ancienne build : lecteur sans QR → mise à jour demandée, rien ne part
        app.evaluate('window.__oldBuild = true')
        app.tap('[data-action="plink-scan"]')
        fixtures.settle(app)
        check('Mets à jour' in app.inner_text('body'), f'{engine} app : ancienne build')
        app.evaluate('window.__oldBuild = false')
        # Le site affiche le QR ; l'app le lit
        web.locator('[data-ph="link"]').click()
        web.locator('dialog.phl [data-phl="start"]').click()
        web.wait_for_selector('dialog.phl svg.qr')
        qr = decode_qr(web) or web.evaluate('ph.pair.qr')
        copy_state(web, app)
        # QR modifié (une lettre), puis QR d'un autre compte : refusés sans rien envoyer
        app.evaluate('q => { window.__qr = q.slice(0, 40) + (q[40] === "A" ? "B" : "A") + q.slice(41); }', qr)
        app.tap('[data-action="plink-scan"]')
        fixtures.settle(app)
        check(app.evaluate('__sb.pl.pairs[0].state') == 'waiting', f'{engine} app : QR modifié, rien d\'offert')
        # Serveur qui ment sur la clé du QR : refus
        app.evaluate("q => { window.__qr = q; __sb.pl.evil = { peekPub: 'B' + 'A'.repeat(85) + 'A=' }; }", qr)
        app.tap('[data-action="plink-scan"]')
        fixtures.settle(app)
        check('même clé' in app.inner_text('body') and app.evaluate('__sb.pl.pairs[0].state') == 'waiting', f'{engine} app : serveur qui ment sur la clé du QR')
        app.evaluate('__sb.pl.evil = {}')
        # Le bon QR : code de vérification sur l'iPhone, le même sur l'ordinateur
        app.tap('[data-action="plink-scan"]')
        app.wait_for_selector('.ios-dialog')
        sas_app = app.inner_text('.ios-dialog')
        copy_state(app, web)
        run_poll(web)
        web.wait_for_selector('dialog.phl .phl-sas')
        sas_web = web.locator('dialog.phl .phl-sas').inner_text()
        check(sas_web in sas_app, f'{engine} : même code ({sas_web!r} dans {sas_app!r})')
        shot(app, f'7-app-code-{engine}')
        shot(web, f'8-site-code-{engine}')
        fixtures.tap_dialog(app, 'Relier')
        fixtures.settle(app)
        check(app.evaluate("__vaultCalls.includes('unlock')"), f'{engine} app : Face ID demandé')
        copy_state(app, web)
        run_poll(web)
        web.wait_for_selector('dialog.phl [data-phl="close"]:has-text("Voir les photos")')
        web.locator('dialog.phl [data-phl="close"]').click()
        until(web, "document.querySelectorAll('.ph-sec img').length === 3", timeout=15000)
        shot(web, f'9-site-photos-{engine}')
        # L'app liste l'ordinateur, puis le retire
        app.evaluate("navigate('coach-devices')")
        fixtures.settle(app)
        txt = app.inner_text('.plink-view')
        check('sur Linux' in txt or 'sur Mac' in txt or 'sur Windows' in txt or 'Navigateur' in txt or 'Chrome' in txt, f'{engine} app : ordinateur listé ({txt!r})')
        # La liste peut se redessiner au moment du toucher (relecture des ordinateurs) : le dialogue est attendu, nouvel
        # essai sinon (vu une fois sur la CI, Chromium)
        for essai in range(3):
            app.wait_for_selector('[data-action="plink-revoke"]')
            fixtures.settle(app)
            app.tap('[data-action="plink-revoke"]')
            try:
                app.wait_for_selector('.ios-dialog__btn:has-text("Retirer")', timeout=5000)
                break
            except Exception:
                if essai == 2:
                    shot(app, f'echec-retirer-{engine}')
                    print('DIAG', app.evaluate("JSON.stringify({ devices: plink.devices, busy: plink.busy, view: currentView(), btn: !!document.querySelector('[data-action=plink-revoke]') })"), flush=True)
                check(essai < 2, f'{engine} app : le dialogue « Retirer » ne s\'ouvre pas')
        fixtures.tap_dialog(app, 'Retirer')
        fixtures.settle(app)
        check(app.evaluate('__sb.pl.devices.length') == 0, f'{engine} app : retiré')
        copy_state(app, web)
        web.locator('[data-ph="hide"]').click()
        web.locator('[data-ph="show"]').click()
        web.wait_for_selector('[data-ph="link"]')
        check(idb_dump(web) == [], f'{engine} : retiré depuis l\'iPhone, plus rien sur l\'ordinateur')
        # QR d'un autre compte (ordinateur connecté ailleurs)
        app.evaluate("q => { const p = q.split('.'); p[2] = 'AAAAAAAAAAAAAAAAAAAAAA'; window.__qr = p.join('.'); }", qr)
        app.evaluate("navigate('coach-devices')")
        fixtures.settle(app)
        app.tap('[data-action="plink-scan"]')
        fixtures.settle(app)
        check('autre compte' in app.inner_text('body'), f'{engine} app : QR d\'un autre compte')
        check(not app.errors, f'{engine} app : erreurs {app.errors}')
        check(not web.errors, f'{engine} site : erreurs {web.errors}')
    finally:
        ctx.close()
        actx.close()


def main():
    with static_server() as url, sync_playwright() as pw:
        for engine in ENGINES:
            browser = launch(pw, engine)
            try:
                for fn in [embedded_journey, google_journey, third_party_reload, web_journey, web_attacks] + ([] if os.environ.get('PPL_NO_APP') or engine == 'firefox' else [app_journey]):
                    fn(browser, url, engine)
                    print(f'OK : {fn.__name__} {engine}', flush=True)
            except Exception:
                traceback.print_exc()
                sys.exit(1)
            finally:
                browser.close()
    print('OK : photos de bilan sur ordinateur' + ('' if cv2 else ' (QR relu par le texte : OpenCV absent)'))


if __name__ == '__main__':
    main()
