"""Progrès › Mesures › Coffre à photos : Face ID (ou code de l'iPhone), chiffrement, verrouillage, avant / après.

Le trousseau iCloud est simulé par un faux module MdlfVault (FAKE_SHELL) : une clé de test tirée au hasard
dans la page par identifiant de coffre, gardée dans sessionStorage le temps du test (jamais une vraie clé). Vérifie : aucune vignette
hors du coffre ; présentation puis création (Face ID demandé, coffre ouvert) ; photo ajoutée chiffrée dans
IndexedDB (aucun octet JPEG en clair, aucune clé dans les réglages) ; grille par date ; curseur avant / après
(glissé, clavier) ; reverrouillage en quittant l'écran, en arrière-plan et après une minute sans activité ;
Face ID demandé en entrant, annulé, refermé pendant la feuille d'iOS ; migration des photos en clair (gardées
si la création est annulée) ; nouvel iPhone : coffre illisible pour l'instant puis rouvert quand la clé arrive
par le trousseau iCloud, ou vidé en dernier recours sans toucher à la clé (autre clé : illisible aussi) ;
iPhone sans code ; coquille sans le module et navigateur : coffre indisponible, photos en clair intactes ;
écran de confidentialité (app inactive) ; « Supprimer toutes les données » vide le coffre et retire la clé.
Captures : $PPL_SCRATCH/shots/lotcoffre/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_coffre.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import json
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'coffre'
R = Results(LOT)

NOW = local_ms(2026, 11, 2, 21, 0, tz=PARIS)
# Coquille iOS factice avec le module du coffre. Trousseau factice : { id du coffre: clé de test aléatoire } dans
# sessionStorage (survit à un rechargement, comme le trousseau ; une clé retirée simule un nouvel iPhone où le
# trousseau iCloud n'est pas encore arrivé). __vaultMode règle la réponse de la feuille d'iOS : 'ok', 'cancel',
# 'hold' (attend __vaultRelease()), 'fail'. Comme le module : clé absente = NOT_FOUND sans feuille d'iOS.
FAKE_SHELL = """
window.__vaultCalls = [];
window.__vaultMode = 'ok';
window.__vaultBio = 'faceID';
window.__vaultPasscode = true;
const KC = '__fakeKeychain';
const all = () => JSON.parse(sessionStorage.getItem(KC) || '{}');
const save = o => sessionStorage.setItem(KC, JSON.stringify(o));
const kc = { all, get: id => all()[id] || null, set: (id, v) => save({ ...all(), [id]: v }),
  del: id => { const o = all(); delete o[id]; save(o); } };
const fakeKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const err = code => { const e = new Error(code); e.code = code; return e; };
const sheetOfIos = () => new Promise((res, rej) => {
  if (__vaultMode === 'cancel') return rej(err('CANCELED'));
  if (__vaultMode === 'fail') return rej(err('FAILED'));
  if (__vaultMode === 'hold') { window.__vaultRelease = res; return; }
  res();
});
const vault = {
  status: async () => ({ biometry: __vaultBio, passcode: __vaultPasscode }),
  create: async ({ id }) => { __vaultCalls.push('create');
    if (!/^[0-9a-f]{16,64}$/.test(id || '')) throw err('FAILED');
    if (!__vaultPasscode) throw err('NO_PASSCODE');
    await sheetOfIos(); if (!kc.get(id)) kc.set(id, fakeKey()); return { key: kc.get(id) }; },
  unlock: async ({ id }) => { __vaultCalls.push('unlock');
    if (!kc.get(id)) throw err('NOT_FOUND');
    if (!__vaultPasscode) throw err('NO_PASSCODE');
    await sheetOfIos(); return { key: kc.get(id) }; },
  forget: async ({ id }) => { __vaultCalls.push('forget'); kc.del(id); return {}; },
  shield: async ({ on }) => { __vaultCalls.push('shield:' + on); return {}; },
};
window.__fakeKeychain = kc;
window.__fakeKey = fakeKey;
const listeners = {};
window.__fireActive = a => (listeners.appStateChange || []).forEach(cb => cb({ isActive: a }));
window.Capacitor = {
  isNativePlatform: () => true,
  isPluginAvailable: n => n === 'MdlfVault',
  registerPlugin: name => name === 'MdlfVault' ? vault
    : name === 'App' ? { addListener: async (ev, cb) => { (listeners[ev] ||= []).push(cb); return { remove() {} }; }, getInfo: async () => ({ build: '32' }) }
    : new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) }),
};
"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def png_file(name, w, h, rgb, band=None):
    """Image PNG unie (avec une bande d'une autre couleur à gauche si band), sans dépendance."""
    os.makedirs(SCRATCH, exist_ok=True)
    path = os.path.join(SCRATCH, name)
    rows = []
    for _ in range(h):
        px = b''.join(bytes(band if band and x < w // 3 else rgb) for x in range(w))
        rows.append(b'\x00' + px)
    raw = b''.join(rows)

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as fh:
        fh.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                 + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
    return path


def data_json(now):
    d = ppl_v2_today(now_ms=now)
    d['bodyMeasures'] = {'waist': [{'date': days_back_ms(now, 7, 9, tz=PARIS), 'cm': 82}]}
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


def shell(page, script=FAKE_SHELL):
    """Coquille iOS factice (et pas de mise à jour à chaud depuis le réseau)."""
    page.add_init_script(script)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())


def open_vault(page, theme, legacy=False):
    seed(page, theme, data_json(NOW))
    if legacy:
        add_legacy(page)
        page.reload()
        page.wait_for_selector('#app > *')
    page.click('.tabbar [data-action="go-stats"]')
    page.wait_for_selector('.view.stats')
    page.click('[data-action="go-body-measures"]')
    page.wait_for_selector('.view.body-measures')
    page.click('[data-action="go-photo-vault"]')
    page.wait_for_selector('.view.photo-vault .pv-intro, .view.photo-vault .pv-lock, .view.photo-vault .pv-center h1, .view.photo-vault [data-action="photo-add"]')
    page.wait_for_timeout(200)


def create_vault(page):
    page.click('[data-action="pv-start"]')
    page.wait_for_selector('.view.photo-vault [data-action="photo-add"]', timeout=15000)
    page.wait_for_timeout(300)


def reenter(page):
    """Ressort du coffre puis y revient (Face ID demandé d'emblée)."""
    page.click('.view.photo-vault [data-action="back"]')
    page.wait_for_selector('.view.body-measures')
    page.click('[data-action="go-photo-vault"]')
    page.wait_for_selector('.view.photo-vault .pv-intro, .view.photo-vault .pv-lock, .view.photo-vault .pv-center h1, .view.photo-vault [data-action="photo-add"]', timeout=8000)
    page.wait_for_timeout(300)


def add_photo(page, path, pose=None, date=None):
    n = page.locator('.pgal__item').count()
    page.set_input_files('#photoFile', path)
    page.wait_for_selector('.sheet-root .pnew__img')
    page.wait_for_timeout(250)
    if pose:
        page.click(f'.pnew__pose [data-pose="{pose}"]')
    if date:
        page.fill('#phDate', date)
    page.click('.sheet__btn--confirm')
    page.wait_for_function(f"document.querySelectorAll('.pgal__item').length > {n}", timeout=15000)
    page.wait_for_timeout(300)


# Lignes brutes du coffre (IndexedDB « mdlf-vault ») : ce qu'un voleur de la sauvegarde verrait
RAW_ROWS = """() => new Promise(res => {
  const r = indexedDB.open('mdlf-vault');
  r.onsuccess = () => { const db = r.result; const tx = db.transaction(['photos', 'meta']);
    const g = tx.objectStore('photos').getAll(); const m = tx.objectStore('meta').getAll();
    tx.oncomplete = () => { const rows = g.result.map(x => ({ keys: Object.keys(x).sort(), jpeg: (() => { const b = new Uint8Array(x.enc || x.buf || new ArrayBuffer(0)); for (let i = 0; i + 2 < b.length; i++) if (b[i] === 0xFF && b[i + 1] === 0xD8 && b[i + 2] === 0xFF) return true; return false; })(), size: (x.enc || x.buf || new ArrayBuffer(0)).byteLength }));
      db.close(); res({ rows, meta: JSON.stringify(m.result) }); }; };
})"""

LEGACY_EXISTS = """() => new Promise(res => { const r = indexedDB.open('mdlf-photos'); let fresh = false;
  r.onupgradeneeded = () => { fresh = true; r.transaction.abort(); };
  r.onsuccess = () => { r.result.close(); res(true); }; r.onerror = () => res(!fresh); })"""


def add_legacy(page):
    """Ancienne base en clair (builds 30-31) : deux photos JPEG générées dans la page."""
    page.evaluate("""() => new Promise(async res => {
      const mk = async (color) => { const c = document.createElement('canvas'); c.width = 300; c.height = 400;
        const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 300, 400);
        const b = await new Promise(r => c.toBlob(r, 'image/jpeg', .8)); return b.arrayBuffer(); };
      const a = await mk('#c05050'), b = await mk('#5050c0');
      const r = indexedDB.open('mdlf-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' }).createIndex('date', 'date');
      r.onsuccess = () => { const db = r.result; const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').put({ id: 'phold1', date: %d, pose: 'face', bytes: a.byteLength, w: 300, h: 400, type: 'image/jpeg', buf: a });
        tx.objectStore('photos').put({ id: 'phold2', date: %d, pose: 'face', bytes: b.byteLength, w: 300, h: 400, type: 'image/jpeg', buf: b });
        tx.oncomplete = () => { db.close(); res(); }; };
    })""" % (days_back_ms(NOW, 60, 9, tz=PARIS), days_back_ms(NOW, 2, 9, tz=PARIS)))


def calls(page, name):
    return page.evaluate('__vaultCalls').count(name)


def vault_id(page):
    return page.evaluate("vaultMeta().then(m => m && m.id)")


def t_coffre(bench, eng, dev, theme):
    """Parcours complet sur chaque appareil et thème."""
    t = tag(dev, theme)
    face = png_file('coffre-face.png', 300, 400, (200, 80, 80))
    back = png_file('coffre-dos.png', 600, 800, (80, 80, 200), band=(230, 230, 230))
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        shell(page)
        seed(page, theme, data_json(NOW))
        page.click('.tabbar [data-action="go-stats"]')
        page.wait_for_selector('.view.stats')
        page.click('[data-action="go-body-measures"]')
        page.wait_for_selector('.view.body-measures')
        R.check(page.locator('.view.body-measures img').count() == 0, f'{t} Mesures : aucune image hors du coffre')
        entry = page.locator('[data-action="go-photo-vault"]')
        R.check(entry.count() == 1 and 'Coffre à photos' in entry.inner_text() and 'Face ID' in entry.inner_text(), f'{t} Mesures : entrée du coffre')
        entry.click()
        page.wait_for_selector('.pv-intro')
        shot(page, LOT, f'intro-{t}')
        intro = page.inner_text('.pv-intro')
        R.check('Face ID ou le code de ton iPhone' in intro and 'trousseau iCloud' in intro and 'nouvel iPhone' in intro and 'code à 6' not in intro,
                f'{t} présentation : Face ID ou code de l\'iPhone, suit par le trousseau iCloud {intro[:300]!r}')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} présentation : pas de défilement horizontal')

        create_vault(page)
        R.check(calls(page, 'create') == 1 and page.evaluate('vaultIsOpen()'), f'{t} création : clé demandée au trousseau, coffre ouvert')
        meta = page.evaluate(RAW_ROWS)['meta']
        vid = vault_id(page)
        key = page.evaluate('id => __fakeKeychain.get(id)', vid)
        R.check(key and key not in meta and '"v":3' in meta and vid in meta and 'salt' not in meta, f'{t} réglages : identifiant et témoin, aucune clé')

        # Deux photos de face : aujourd'hui et le 1er septembre (l'avant / après compare la même pose à deux dates)
        add_photo(page, face)
        R.check(page.locator('.pcmp').count() == 0 and 'Reprends une photo de face un autre jour' in page.inner_text('.view.photo-vault'),
                f'{t} une photo : pas d\'avant / après, une phrase dit quoi faire')
        add_photo(page, back, date='2026-09-01')
        raw = page.evaluate(RAW_ROWS)
        R.check(len(raw['rows']) == 2 and all(r['keys'] == ['date', 'enc', 'id', 'iv'] and not r['jpeg'] for r in raw['rows']),
                f'{t} IndexedDB : lignes chiffrées, aucun JPEG en clair {raw["rows"]}')
        days = page.locator('.pgal__date').all_inner_texts()
        R.check(days == ['Aujourd\'hui', 'mar. 1 sept.'], f'{t} grille par date {days}')
        R.check('2 photos' in page.inner_text('.pv-summary'), f'{t} résumé {page.inner_text(".pv-summary")!r}')
        R.check(page.locator('[data-action="pv-change"], [data-action="pv-bio-toggle"]').count() == 0, f'{t} ouvert : plus de réglage de code')
        R.check(page.locator('.pcmp__frame .pcmp__img').count() == 2 and '62 jours' in page.inner_text('.pcmp__gap'), f'{t} avant / après : 2 photos, 62 jours')
        # Curseur : glissé du doigt (souris), puis clavier
        f = page.locator('.pcmp__frame').bounding_box()
        page.mouse.move(f['x'] + f['width'] * .5, f['y'] + f['height'] * .5)
        page.mouse.down()
        page.mouse.move(f['x'] + f['width'] * .3, f['y'] + f['height'] * .5, steps=4)
        page.mouse.move(f['x'] + f['width'] * .2, f['y'] + f['height'] * .5, steps=4)
        page.mouse.up()
        pos = page.evaluate("getComputedStyle(document.querySelector('.pcmp__frame')).getPropertyValue('--pos').trim()")
        R.check(pos in ('19%', '20%', '21%'), f'{t} curseur glissé à 20 % : {pos}')
        page.focus('.pcmp__range')
        page.keyboard.press('ArrowRight')
        R.check(page.get_attribute('.pcmp__range', 'aria-valuetext').endswith("% de la photo d'avant"), f'{t} curseur annoncé à VoiceOver')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} coffre ouvert : pas de défilement horizontal')
        page.evaluate('scrollTo(0, 0)')
        shot(page, LOT, f'ouvert-{t}')

        # Verrouillage manuel : plus d'image, bouton Face ID
        page.click('[data-action="pv-lock"]')
        page.wait_for_selector('.pv-lock')
        R.check(page.locator('.view.photo-vault img').count() == 0 and not page.evaluate('vaultIsOpen()'), f'{t} verrouillé : aucune image, clé effacée')
        btn = page.locator('[data-action="pv-open"]')
        box = btn.bounding_box()
        R.check(btn.count() == 1 and 'Ouvrir avec Face ID' in btn.inner_text() and box['height'] >= 44, f'{t} verrouillé : bouton « Ouvrir avec Face ID »')
        shot(page, LOT, f'verrouille-{t}')
        btn.click()
        page.wait_for_selector('.pgal__item', timeout=15000)
        R.check(page.locator('.pgal__item').count() == 2, f'{t} Face ID : photos rendues')

        # Ouvrir une photo, puis quitter l'écran : refermé ; revenir : Face ID d'emblée
        page.locator('.pgal__item').first.click()
        page.wait_for_selector('.sheet-root .pview__img')
        page.wait_for_timeout(300)
        R.check('300 × 400 px' in page.inner_text('.sheet-root'), f'{t} photo ouverte')
        page.locator('.sheet__btn--cancel').click()
        page.wait_for_selector('.sheet-root', state='detached')
        page.click('.view.photo-vault [data-action="back"]')
        page.wait_for_selector('.view.body-measures')
        R.check(not page.evaluate('vaultIsOpen()'), f'{t} quitter l\'écran referme le coffre')
        page.click('[data-action="go-photo-vault"]')
        page.wait_for_selector('.pgal__item', timeout=8000)
        R.check(page.evaluate('vaultIsOpen()') and calls(page, 'unlock') == 2, f'{t} en entrant : Face ID demandé d\'emblée, coffre ouvert')
        R.check(not page.errors, f'{t} aucune erreur JS : {page.errors}')


HIDE = "Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange'))"
SHOW = "Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })"


def t_verrouillages(bench):
    """Arrière-plan, inactivité, Face ID annulé ou en échec, refermé pendant la feuille d'iOS, écran de confidentialité."""
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'dark') as page:
        shell(page)
        open_vault(page, 'dark')
        create_vault(page)
        R.check('shield:true' in page.evaluate('__vaultCalls'), 'écran de confidentialité natif armé coffre ouvert')
        page.evaluate('__fireActive(false)')
        R.check(page.evaluate("document.body.classList.contains('pv-shield')"), 'app inactive : contenu masqué')
        shot(page, LOT, 'selecteur-apps-iPhone_13-dark')
        page.evaluate('__fireActive(true)')
        R.check(not page.evaluate("document.body.classList.contains('pv-shield')"), 'app active : contenu rendu')
        # Arrière-plan
        page.evaluate(HIDE)
        page.wait_for_timeout(200)
        R.check(not page.evaluate('vaultIsOpen()') and page.locator('.pv-lock').count() == 1, 'arrière-plan : refermé sur-le-champ')
        R.check('shield:false' in page.evaluate('__vaultCalls'), 'écran natif désarmé coffre fermé')
        page.evaluate(SHOW)
        page.click('[data-action="pv-open"]')
        page.wait_for_selector('[data-action="photo-add"]', timeout=15000)
        # Inactivité : 59 s ouvert, 61 s refermé, sans redemander Face ID tout seul
        n = calls(page, 'unlock')
        page.clock.run_for(59_000)
        R.check(page.evaluate('vaultIsOpen()'), 'inactif 59 s : encore ouvert')
        page.mouse.click(5, 300)
        page.clock.run_for(59_000)
        R.check(page.evaluate('vaultIsOpen()'), 'un toucher relance la minute')
        page.clock.run_for(2_000)
        page.wait_for_timeout(200)
        R.check(not page.evaluate('vaultIsOpen()') and 'une minute' in page.inner_text('#pvMsg'), 'inactif 1 min : refermé, message')
        R.check(calls(page, 'unlock') == n, 'après l\'inactivité : Face ID pas redemandé tout seul')
        # Face ID annulé : fermé, sans message d'erreur ; en échec : message
        page.evaluate("__vaultMode = 'cancel'")
        page.click('[data-action="pv-open"]')
        page.wait_for_timeout(300)
        R.check(not page.evaluate('vaultIsOpen()') and page.locator('.pv-sub--err').count() == 0 and page.locator('[data-action="pv-open"]').is_enabled(),
                'Face ID annulé : fermé, sans erreur, bouton prêt')
        page.evaluate("__vaultMode = 'fail'")
        page.click('[data-action="pv-open"]')
        page.wait_for_timeout(300)
        R.check('Ouverture impossible' in page.inner_text('#pvMsg') and page.locator('.pv-sub--err').count() == 1, 'Face ID en échec : message')
        shot(page, LOT, 'echec-iPhone_13-dark')
        # Feuille d'iOS ouverte, l'app part en arrière-plan, puis la clé arrive : rien ne s'ouvre
        page.evaluate("__vaultMode = 'hold'")
        page.click('[data-action="pv-open"]')
        page.wait_for_timeout(200)
        R.check(page.locator('[data-action="pv-open"]').is_disabled(), 'feuille d\'iOS ouverte : bouton inactif')
        page.evaluate(HIDE)
        page.evaluate(SHOW)
        page.evaluate('__vaultRelease()')
        page.wait_for_timeout(400)
        R.check(not page.evaluate('vaultIsOpen()') and page.locator('[data-action="pv-open"]').is_enabled(), 'refermé pendant la feuille : resté fermé, bouton prêt')
        page.evaluate("__vaultMode = 'ok'")
        page.click('[data-action="pv-open"]')
        page.wait_for_selector('[data-action="photo-add"]', timeout=15000)
        R.check(page.evaluate('vaultIsOpen()'), 'essai suivant : ouvert')
        # Rechargement (relance de l'app) : même clé dans le trousseau, Face ID d'emblée
        page.reload()
        page.wait_for_selector('#app > *')
        page.evaluate("navigate('photo-vault')")
        page.wait_for_selector('[data-action="photo-add"]', timeout=15000)
        R.check(page.evaluate('vaultIsOpen()'), 'après une relance : ouvert par la même clé')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_migration(bench):
    """Photos en clair d'avant le coffre : gardées si la création est annulée, puis rangées et chiffrées."""
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'light') as page:
        shell(page)
        open_vault(page, 'light', legacy=True)
        R.check('2 photos déjà prises' in page.inner_text('.pv-intro'), f'présentation : photos existantes annoncées {page.inner_text(".pv-intro")[:300]!r}')
        page.evaluate("__vaultMode = 'cancel'")
        page.click('[data-action="pv-start"]')
        page.wait_for_timeout(400)
        meta = page.evaluate(RAW_ROWS)['meta']
        R.check(page.locator('.pv-intro').count() == 1 and page.evaluate(LEGACY_EXISTS) is True and '"pending":true' in meta and 'check' not in meta,
                f'création annulée : présentation, photos en clair intactes, seulement l\'identifiant de clé {meta}')
        vid = vault_id(page)
        page.evaluate("__vaultMode = 'ok'")
        create_vault(page)
        R.check(vault_id(page) == vid, 'nouvel essai : même identifiant, donc même clé')
        page.wait_for_selector('.pgal__item', timeout=8000)
        raw = page.evaluate(RAW_ROWS)
        R.check(len(raw['rows']) == 2 and not any(r['jpeg'] for r in raw['rows']), f'migration : 2 photos chiffrées {raw["rows"]}')
        R.check(page.evaluate(LEGACY_EXISTS) is False, 'migration : ancienne base en clair supprimée')
        R.check(page.locator('.pcmp').count() == 1 and '58 jours' in page.inner_text('.pcmp__gap'), 'migration : avant / après des deux photos')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_illisible(bench):
    """Nouvel iPhone : clé pas encore arrivée par le trousseau iCloud, puis arrivée ; vidé en dernier recours."""
    face = png_file('coffre-face.png', 300, 400, (200, 80, 80))
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'dark') as page:
        shell(page)
        open_vault(page, 'dark')
        create_vault(page)
        add_photo(page, face)
        vid = vault_id(page)
        key = page.evaluate('id => __fakeKeychain.get(id)', vid)
        page.evaluate('id => __fakeKeychain.del(id)', vid)   # nouvel iPhone : photos restaurées, trousseau iCloud pas encore là
        n_create, n_unlock = calls(page, 'create'), calls(page, 'unlock')
        reenter(page)
        txt = page.inner_text('.view.photo-vault')
        R.check(page.inner_text('#pvTitle') == 'Coffre illisible pour l\'instant' and 'trousseau iCloud' in txt and '1 photo' in txt and 'réessaie plus tard' in txt,
                f'clé absente : illisible pour l\'instant, trousseau iCloud expliqué {txt[:400]!r}')
        R.check(calls(page, 'create') == n_create, 'clé absente : aucune nouvelle clé créée pour ce coffre')
        R.check(not page.evaluate('vaultIsOpen()') and page.locator('.view.photo-vault img').count() == 0, 'clé absente : rien d\'ouvert')
        first = page.locator('.pv-center button').first
        R.check(first.get_attribute('data-action') == 'pv-retry' and 'btn--primary' in first.get_attribute('class'), '« Réessayer » proposé en premier, « Vider » en second')
        shot(page, LOT, 'illisible-iPhone_13-dark')
        # La clé arrive par le trousseau iCloud : « Réessayer » rouvre le coffre et ses photos
        page.evaluate('([id, k]) => __fakeKeychain.set(id, k)', [vid, key])
        page.click('[data-action="pv-retry"]')
        page.wait_for_selector('.pgal__item', timeout=15000)
        R.check(page.evaluate('vaultIsOpen()') and page.locator('.pgal__item').count() == 1 and calls(page, 'unlock') > n_unlock,
                'clé arrivée : coffre rouvert avec ses photos')
        # Vider en dernier recours : confirmation, photos effacées, clé jamais touchée
        page.evaluate('id => __fakeKeychain.del(id)', vid)
        reenter(page)
        page.click('[data-action="pv-reset"]')
        page.wait_for_selector('.ios-dialog')
        R.check('Effacer 1 photo' in page.inner_text('.ios-dialog') and 'trop tard' in page.inner_text('.ios-dialog'), f'vider : confirmation {page.inner_text(".ios-dialog")!r}')
        tap_dialog(page, 'Annuler')
        R.check(len(page.evaluate(RAW_ROWS)['rows']) == 1, 'vider annulé : photo gardée')
        page.click('[data-action="pv-reset"]')
        tap_dialog(page, 'Effacer')
        page.wait_for_selector('.pv-intro')
        raw = page.evaluate(RAW_ROWS)
        R.check(raw['rows'] == [] and raw['meta'] == '[]' and calls(page, 'forget') == 0, 'vidé : plus de photo ni de réglage, clé jamais effacée')
        # Nouveau coffre : nouvel identifiant, donc nouvelle clé sans conflit avec l'ancienne
        create_vault(page)
        vid2 = vault_id(page)
        R.check(vid2 and vid2 != vid, f'nouveau coffre : nouvel identifiant de clé {vid} → {vid2}')
        # Une clé qui ne correspond pas au témoin : illisible aussi
        add_photo(page, face)
        page.evaluate('id => __fakeKeychain.set(id, __fakeKey())', vid2)
        reenter(page)
        R.check(page.inner_text('#pvTitle') == 'Coffre illisible pour l\'instant', 'clé qui ne correspond pas : illisible')
        page.click('[data-action="pv-reset"]')
        tap_dialog(page, 'Effacer')
        page.wait_for_selector('.pv-intro')
        # Coffre vide et clé absente : rien à perdre, retour direct à la présentation
        create_vault(page)
        page.evaluate('id => __fakeKeychain.del(id)', vault_id(page))
        reenter(page)
        R.check(page.locator('.pv-intro').count() == 1 and page.evaluate(RAW_ROWS)['meta'] == '[]', 'coffre vide et clé absente : présentation directement')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_sans_code_ni_biometrie(bench):
    """iPhone sans code : coffre fermé, explication ; iPhone sans Face ID : ouvert par le code de l'iPhone."""
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'light') as page:
        shell(page)
        page.add_init_script("window.__vaultPasscode = false; window.__vaultBio = 'none';")
        open_vault(page, 'light')
        R.check(page.inner_text('#pvTitle') == 'Code de l\'iPhone requis' and 'Réglages' in page.inner_text('.pv-center'), 'iPhone sans code : explication')
        shot(page, LOT, 'sans-code-iPhone_13-light')
        page.evaluate('__vaultPasscode = true')
        page.click('[data-action="pv-retry"]')
        page.wait_for_selector('.pv-intro')
        R.check('Ouvert avec le code de ton iPhone' in page.inner_text('.pv-intro'), 'sans Face ID : « le code de ton iPhone »')
        create_vault(page)
        page.click('[data-action="pv-lock"]')
        page.wait_for_selector('.pv-lock')
        R.check(page.inner_text('[data-action="pv-open"]').strip() == 'Ouvrir avec le code de l\'iPhone', f'sans Face ID : bouton {page.inner_text("[data-action=pv-open]")!r}')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_sans_module(bench):
    """Coquille sans le module natif, et navigateur : coffre indisponible, photos en clair jamais touchées."""
    bare = """window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => false,
      registerPlugin: () => new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) }) };"""
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'light') as page:
        shell(page, bare)
        open_vault(page, 'light', legacy=True)
        R.check(page.evaluate('Native.isNative') is True and page.evaluate('Native.vault.available') is False, 'coquille sans module')
        txt = page.inner_text('.view.photo-vault')
        R.check('Coffre indisponible' in txt and 'prochaine version' in txt and page.locator('[data-action="pv-start"]').count() == 0, f'sans module : indisponible {txt[:200]!r}')
        R.check(page.evaluate(LEGACY_EXISTS) is True, 'sans module : photos en clair intactes')
        shot(page, LOT, 'indisponible-iPhone_13-light')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')
    with bench.frozen_page(NOW, 'chromium', 'Pixel 7', 'dark') as page:
        open_vault(page, 'dark')
        txt = page.inner_text('.view.photo-vault')
        R.check(page.evaluate('Native.isNative') is False and 'Coffre indisponible' in txt and 'app iPhone' in txt, f'navigateur : indisponible {txt[:200]!r}')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_tout_supprimer(bench):
    face = png_file('coffre-face.png', 300, 400, (200, 80, 80))
    with bench.frozen_page(NOW, 'chromium', 'Pixel 7', 'dark') as page:
        shell(page)
        open_vault(page, 'dark')
        create_vault(page)
        add_photo(page, face)
        page.evaluate("navigate('settings')")
        page.wait_for_selector('[data-action="wipe-data"]')
        R.check(not page.evaluate('vaultIsOpen()'), 'Réglages : coffre refermé en le quittant')
        page.click('[data-action="wipe-data"]')
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Tout supprimer')
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Supprimer')
        page.wait_for_timeout(800)
        raw = page.evaluate(RAW_ROWS)
        R.check(raw['rows'] == [] and raw['meta'] == '[]', 'Supprimer toutes les données : coffre vidé')
        R.check(calls(page, 'forget') == 1 and page.evaluate('__fakeKeychain.all()') == {}, 'Supprimer toutes les données : clé retirée du trousseau')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_interruptions(bench):
    """Arrière-plan pendant la feuille « Nouvelle photo », inactivité pendant une confirmation."""
    face = png_file('coffre-face.png', 300, 400, (200, 80, 80))
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'dark') as page:
        shell(page)
        open_vault(page, 'dark')
        create_vault(page)
        # Feuille « Nouvelle photo » ouverte, arrière-plan : la photo attend l'ouverture, puis la feuille revient
        page.set_input_files('#photoFile', face)
        page.wait_for_selector('.sheet-root .pnew__img')
        page.evaluate(HIDE)
        page.evaluate(SHOW)
        page.wait_for_timeout(300)
        R.check(page.locator('.sheet-root').count() == 0 and page.locator('.view.photo-vault img').count() == 0, 'verrouillé : feuille et image retirées')
        R.check('ranger ta photo' in page.inner_text('#pvMsg'), f'verrouillé : la photo attend l\'ouverture {page.inner_text("#pvMsg")!r}')
        page.click('[data-action="pv-open"]')
        page.wait_for_selector('.sheet-root .pnew__img', timeout=15000)
        page.wait_for_timeout(300)
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.pgal__item', timeout=8000)
        R.check(page.locator('.pgal__item').count() == 1, 'photo rangée après l\'ouverture')
        # Confirmation de suppression ouverte, inactivité : fermée, la photo reste
        page.locator('.pgal__item').first.click()
        page.wait_for_selector('[data-action="photo-delete"]')
        page.wait_for_timeout(300)
        page.click('[data-action="photo-delete"]')
        page.wait_for_selector('.ios-dialog')
        page.clock.run_for(61_000)
        page.wait_for_timeout(400)
        R.check(page.locator('.ios-dialog').count() == 0 and not page.evaluate('vaultIsOpen()'), 'inactivité : confirmation fermée, coffre fermé')
        R.check(len(page.evaluate(RAW_ROWS)['rows']) == 1, 'la photo n\'a pas été supprimée sans rouvrir le coffre')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_hauteur_se(bench):
    """iPhone SE : présentation et écran verrouillé entiers entre la barre et la tab bar, en clair et en sombre."""
    for theme in ('light', 'dark'):
        with bench.frozen_page(NOW, 'webkit', 'iPhone SE', theme) as page:
            shell(page)
            open_vault(page, theme)
            tab = page.locator('.tabbar').bounding_box()
            cta = page.locator('.pv-cta').bounding_box()
            R.check(cta['y'] + cta['height'] <= tab['y'] + 1, f'SE {theme} : « Créer le coffre » au-dessus de la tab bar {cta} {tab}')
            shot(page, LOT, f'intro-iPhone_SE-{theme}')
            create_vault(page)
            page.click('[data-action="pv-lock"]')
            page.wait_for_selector('.pv-lock')
            tab = page.locator('.tabbar').bounding_box()
            btn = page.locator('[data-action="pv-open"]').bounding_box()
            R.check(btn['y'] + btn['height'] <= tab['y'] + 1 and btn['height'] >= 44, f'SE {theme} : bouton d\'ouverture au-dessus de la tab bar {btn} {tab}')
            shot(page, LOT, f'verrouille-iPhone_SE-{theme}')


def t_panel_apple(bench):
    """Panel Apple du 08/11 (iPhone SE) : titre repris par la barre au défilement."""
    face = png_file('coffre-face.png', 300, 400, (200, 80, 80))
    back = png_file('coffre-dos.png', 600, 800, (80, 80, 200), band=(230, 230, 230))
    with bench.frozen_page(NOW, 'webkit', 'iPhone SE', 'light') as page:
        shell(page)
        open_vault(page, 'light')
        create_vault(page)
        add_photo(page, face, pose='face', date='2026-10-03')
        add_photo(page, face, pose='face')
        add_photo(page, back, pose='back')
        # Une icône = un sens : « Verrouiller » en toutes lettres, le cadenas ne dit que l'état chiffré
        lock = page.evaluate("() => { const b = document.querySelector('.navbar [data-action=pv-lock]'); return [b.textContent.trim(), b.querySelectorAll('.icon').length]; }")
        R.check(lock == ['Verrouiller', 0] and page.locator('.view.photo-vault button .icon--lock').count() == 0,
                f'coffre : « Verrouiller » en toutes lettres, aucun bouton au cadenas {lock}')
        # Avant / après par défaut : Face du 3 octobre contre Face d'aujourd'hui, jamais Face contre Dos du même jour
        sel = page.evaluate("() => [...document.querySelectorAll('.pcmp__sel')].map(s => s.selectedOptions[0].textContent)")
        R.check(len(sel) == 2 and all(s.endswith('Face') for s in sel) and '30 jours' in page.inner_text('.pcmp__gap'),
                f'coffre : avant / après sur la même pose à deux dates {sel} {page.inner_text(".pcmp__gap")!r}')
        bar = lambda: page.evaluate("""() => { const b = document.querySelector('#app .navbar'), ti = b.querySelector('.navbar__title');
            return { collapsed: b.classList.contains('navbar--collapsed'), text: ti.textContent, op: getComputedStyle(ti).opacity }; }""")
        page.evaluate('window.scrollTo(0, 0)')
        page.wait_for_timeout(400)
        b = bar()
        R.check(not b['collapsed'] and b['op'] == '0', f'coffre en haut : grand titre dans l\'écran, barre sans titre visible {b}')
        page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
        page.wait_for_timeout(500)
        b = bar()
        R.check(b['collapsed'] and b['text'] == 'Coffre à photos' and float(b['op']) > .9, f'coffre défilé : « Coffre à photos » dans la barre {b}')
        shot(page, LOT, 'panel-titre-replie-iPhone_SE')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


run_main(R, [t_coffre], once=[t_panel_apple, t_interruptions, t_hauteur_se, t_verrouillages, t_migration, t_illisible, t_sans_code_ni_biometrie, t_sans_module, t_tout_supprimer])
