"""Progrès › Mesures › Coffre à photos : code, chiffrement, verrouillage, avant / après.

Vérifie : aucune vignette hors du coffre ; présentation puis création du code (deux saisies, code trop
simple refusé, codes différents refusés) ; photo ajoutée chiffrée dans IndexedDB (aucun octet JPEG en
clair) ; grille par date ; curseur avant / après (glissé, clavier) ; reverrouillage en quittant l'écran, en
arrière-plan et après une minute sans activité ; faux code, attente après 5 erreurs ; changement de code ;
migration des photos en clair de l'ancienne base (supprimée ensuite) ; code oublié = coffre vidé après
double confirmation ; Face ID avec un module natif simulé ; écran de confidentialité (app inactive) ;
« Supprimer toutes les données » vide le coffre.
Codes de test fictifs uniquement.
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
FAKE_CODE = '480213'      # code fictif de test
FAKE_OTHER = '975318'     # autre code fictif
WRONG = '111000'


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


def open_vault(page, theme, init=None, legacy=False):
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
    page.wait_for_selector('.view.photo-vault .pv-intro, .view.photo-vault .pv-lock, .view.photo-vault .pgal, .view.photo-vault [data-action="photo-add"]')
    page.wait_for_timeout(200)


def type_code(page, code, wait_after=True):
    for d in code:
        page.click(f'.pv-key[data-d="{d}"]')
    if wait_after:
        page.wait_for_timeout(250)
        page.wait_for_function("!document.querySelector('.pv-dots--busy')", timeout=15000)
        page.wait_for_timeout(150)


def create_vault(page, code=FAKE_CODE):
    page.click('[data-action="pv-start"]')
    page.wait_for_selector('.pv-lock')
    type_code(page, code)
    type_code(page, code)
    page.wait_for_selector('.view.photo-vault [data-action="photo-add"]', timeout=15000)
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
    page.wait_for_function(f"document.querySelectorAll('.pgal__item').length > {n}", timeout=8000)
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


def t_coffre(bench, eng, dev, theme):
    """Parcours complet sur chaque appareil et thème."""
    t = tag(dev, theme)
    face = png_file('coffre-face.png', 300, 400, (200, 80, 80))
    back = png_file('coffre-dos.png', 600, 800, (80, 80, 200), band=(230, 230, 230))
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        seed(page, theme, data_json(NOW))
        page.click('.tabbar [data-action="go-stats"]')
        page.wait_for_selector('.view.stats')
        page.click('[data-action="go-body-measures"]')
        page.wait_for_selector('.view.body-measures')
        R.check(page.locator('.view.body-measures img').count() == 0, f'{t} Mesures : aucune image hors du coffre')
        entry = page.locator('[data-action="go-photo-vault"]')
        R.check(entry.count() == 1 and 'Coffre à photos' in entry.inner_text(), f'{t} Mesures : entrée du coffre')
        entry.click()
        page.wait_for_selector('.pv-intro')
        shot(page, LOT, f'intro-{t}')
        R.check(page.locator('[data-action="pv-start"]').count() == 1 and 'pas même nous' in page.inner_text('.pv-intro'), f'{t} présentation : créer le code, mise en garde sur l\'oubli')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} présentation : pas de défilement horizontal')

        # Création : code trop simple, puis deux codes différents, puis le bon
        page.click('[data-action="pv-start"]')
        page.wait_for_selector('.pv-lock')
        keys = page.locator('.pv-key[data-d]')
        sizes = [keys.nth(i).bounding_box() for i in range(keys.count())]
        R.check(keys.count() == 10 and all(b['width'] >= 44 and b['height'] >= 44 for b in sizes), f'{t} clavier : 10 touches d\'au moins 44 pt')
        R.check(page.locator('[data-action="pv-forgot"]').count() == 0, f'{t} création : pas de « Code oublié »')
        shot(page, LOT, f'creation-{t}')
        type_code(page, '123456')
        R.check('trop facile' in page.inner_text('#pvMsg') and page.inner_text('#pvTitle') == 'Choisis un code', f'{t} 123456 refusé : {page.inner_text("#pvMsg")!r}')
        type_code(page, FAKE_CODE)
        R.check(page.inner_text('#pvTitle') == 'Confirme ton code', f'{t} confirmation demandée')
        type_code(page, FAKE_OTHER)
        R.check('ne correspondent pas' in page.inner_text('#pvMsg') and page.inner_text('#pvTitle') == 'Choisis un code', f'{t} codes différents : on recommence')
        type_code(page, FAKE_CODE)
        type_code(page, FAKE_CODE)
        page.wait_for_selector('[data-action="photo-add"]', timeout=15000)
        page.wait_for_timeout(300)
        meta = page.evaluate(RAW_ROWS)['meta']
        R.check(FAKE_CODE not in meta and '"iter":600000' in meta, f'{t} réglages : jamais le code, 600 000 tours')

        # Deux photos : face aujourd'hui, dos le 1er septembre
        add_photo(page, face)
        R.check(page.locator('.pcmp').count() == 0, f'{t} une photo : pas d\'avant / après')
        add_photo(page, back, pose='back', date='2026-09-01')
        raw = page.evaluate(RAW_ROWS)
        R.check(len(raw['rows']) == 2 and all(r['keys'] == ['date', 'enc', 'id', 'iv'] and not r['jpeg'] for r in raw['rows']),
                f'{t} IndexedDB : lignes chiffrées, aucun JPEG en clair {raw["rows"]}')
        days = page.locator('.pgal__date').all_inner_texts()
        R.check(days == ['Aujourd\'hui', 'mar. 1 sept.'], f'{t} grille par date {days}')
        R.check('2 photos' in page.inner_text('.pv-summary'), f'{t} résumé {page.inner_text(".pv-summary")!r}')
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

        # Verrouillage manuel : plus d'image, plus d'URL d'objet
        page.click('[data-action="pv-lock"]')
        page.wait_for_selector('.pv-lock')
        R.check(page.locator('.view.photo-vault img').count() == 0 and not page.evaluate('vaultIsOpen()'), f'{t} verrouillé : aucune image, clé effacée')
        R.check(page.locator('[data-action="pv-forgot"]').count() == 1, f'{t} verrouillé : « Code oublié ? »')
        type_code(page, WRONG)
        R.check('Code incorrect' in page.inner_text('#pvMsg'), f'{t} faux code refusé')
        shot(page, LOT, f'faux-code-{t}')
        type_code(page, FAKE_CODE)
        page.wait_for_selector('.pgal__item', timeout=15000)
        R.check(page.locator('.pgal__item').count() == 2, f'{t} bon code : photos rendues')

        # Ouvrir une photo, puis quitter l'écran : refermé
        page.locator('.pgal__item').first.click()
        page.wait_for_selector('.sheet-root .pview__img')
        page.wait_for_timeout(300)
        R.check('300 × 400 px' in page.inner_text('.sheet-root'), f'{t} photo ouverte')
        page.locator('.sheet__btn--cancel').click()
        page.wait_for_selector('.sheet-root', state='detached')
        page.click('.view.photo-vault [data-action="back"]')
        page.wait_for_selector('.view.body-measures')
        R.check(not page.evaluate('vaultIsOpen()'), f'{t} quitter l\'écran referme le coffre')
        R.check(not page.errors, f'{t} aucune erreur JS : {page.errors}')


def t_verrouillages(bench):
    """Arrière-plan, inactivité, attente après 5 erreurs, changement de code."""
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'dark') as page:
        open_vault(page, 'dark')
        create_vault(page)
        # Arrière-plan
        page.evaluate("Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_timeout(200)
        R.check(not page.evaluate('vaultIsOpen()') and page.locator('.pv-lock').count() == 1, 'arrière-plan : refermé sur-le-champ')
        page.evaluate("Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })")
        type_code(page, FAKE_CODE)
        page.wait_for_selector('[data-action="photo-add"]', timeout=15000)
        # Inactivité : 59 s ouvert, 61 s refermé
        page.clock.run_for(59_000)
        R.check(page.evaluate('vaultIsOpen()'), 'inactif 59 s : encore ouvert')
        page.mouse.click(5, 300)
        page.clock.run_for(59_000)
        R.check(page.evaluate('vaultIsOpen()'), 'un toucher relance la minute')
        page.clock.run_for(2_000)
        page.wait_for_timeout(200)
        R.check(not page.evaluate('vaultIsOpen()') and 'une minute' in page.inner_text('#pvMsg'), 'inactif 1 min : refermé, message')
        # 5 erreurs : attente de 30 s
        for _ in range(5):
            type_code(page, WRONG)
        msg = page.inner_text('.pv-lock')
        R.check('Réessaie dans' in msg and page.locator('.pv-key[data-d="1"]').is_disabled(), f'5 erreurs : clavier bloqué {msg!r}')
        shot(page, LOT, 'attente-iPhone_13-dark')
        page.reload()
        page.wait_for_selector('#app > *')
        page.evaluate("navigate('photo-vault')")
        page.wait_for_selector('.pv-lock')
        page.wait_for_timeout(300)
        R.check('Réessaie dans' in page.inner_text('.pv-lock'), 'attente gardée après un rechargement')
        page.clock.run_for(31_000)
        page.wait_for_timeout(300)
        type_code(page, FAKE_CODE)
        page.wait_for_selector('[data-action="photo-add"]', timeout=15000)
        R.check(page.evaluate('vaultIsOpen()'), 'après l\'attente : bon code accepté')
        # Changer de code
        page.click('[data-action="pv-change"]')
        page.wait_for_selector('.pv-lock')
        type_code(page, FAKE_CODE)
        R.check(page.inner_text('#pvTitle') == 'Nouveau code', 'changement : nouveau code demandé')
        type_code(page, FAKE_OTHER)
        type_code(page, FAKE_OTHER)
        page.wait_for_selector('[data-action="photo-add"]', timeout=15000)
        page.click('[data-action="pv-lock"]')
        page.wait_for_selector('.pv-lock')
        type_code(page, FAKE_CODE)
        R.check(not page.evaluate('vaultIsOpen()'), 'ancien code refusé après le changement')
        type_code(page, FAKE_OTHER)
        page.wait_for_selector('[data-action="photo-add"]', timeout=15000)
        R.check(page.evaluate('vaultIsOpen()'), 'nouveau code accepté')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_migration_et_oubli(bench):
    """Photos en clair d'avant le coffre : rangées et chiffrées, ancienne base supprimée ; puis code oublié."""
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'light') as page:
        open_vault(page, 'light', legacy=True)
        R.check('2 photos déjà prises' in page.inner_text('.pv-intro'), f'présentation : photos existantes annoncées {page.inner_text(".pv-intro")[:300]!r}')
        create_vault(page)
        page.wait_for_selector('.pgal__item', timeout=8000)
        raw = page.evaluate(RAW_ROWS)
        R.check(len(raw['rows']) == 2 and not any(r['jpeg'] for r in raw['rows']), f'migration : 2 photos chiffrées {raw["rows"]}')
        R.check(page.evaluate(LEGACY_EXISTS) is False, 'migration : ancienne base en clair supprimée')
        R.check(page.locator('.pcmp').count() == 1 and '58 jours' in page.inner_text('.pcmp__gap'), 'migration : avant / après des deux photos')
        page.click('[data-action="pv-lock"]')
        page.wait_for_selector('.pv-lock')
        # Code oublié : deux confirmations, puis coffre vide
        page.click('[data-action="pv-forgot"]')
        page.wait_for_selector('.ios-dialog')
        R.check('personne ne peut rouvrir' in page.inner_text('.ios-dialog'), 'oubli : explication')
        tap_dialog(page, 'Vider le coffre')
        page.wait_for_selector('.ios-dialog')
        R.check('Effacer 2 photos' in page.inner_text('.ios-dialog'), f'oubli : 2e confirmation chiffrée {page.inner_text(".ios-dialog")!r}')
        shot(page, LOT, 'oubli-iPhone_13-light')
        tap_dialog(page, 'Annuler')
        R.check(len(page.evaluate(RAW_ROWS)['rows']) == 2, 'oubli annulé : photos gardées')
        page.click('[data-action="pv-forgot"]')
        tap_dialog(page, 'Vider le coffre')
        tap_dialog(page, 'Effacer')
        page.wait_for_selector('.pv-intro')
        raw = page.evaluate(RAW_ROWS)
        R.check(raw['rows'] == [] and raw['meta'] == '[]', 'oubli confirmé : coffre vide, plus de réglages')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


# Coquille iOS factice avec le module du coffre (Face ID simulé, trousseau en mémoire)
FAKE_SHELL_VAULT = """
window.__vaultCalls = [];
window.__bioResult = 'ok';
const store = {};
const vault = {
  status: async () => ({ biometry: 'faceID', stored: !!store.key }),
  remember: async ({ key }) => { __vaultCalls.push('remember'); store.key = key; return {}; },
  unlock: async () => { __vaultCalls.push('unlock');
    if (__bioResult === 'cancel') { const e = new Error('annulé'); e.code = 'CANCELED'; throw e; }
    if (!store.key) { const e = new Error('absente'); e.code = 'NOT_FOUND'; throw e; }
    return { key: store.key }; },
  forget: async () => { __vaultCalls.push('forget'); delete store.key; return {}; },
  shield: async ({ on }) => { __vaultCalls.push('shield:' + on); return {}; },
};
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


def t_face_id(bench):
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'dark') as page:
        page.add_init_script(FAKE_SHELL_VAULT)
        page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
        open_vault(page, 'dark')
        R.check(page.evaluate('Native.vault.available') is True, 'module du coffre détecté')
        create_vault(page)
        page.wait_for_selector('.ios-dialog')
        R.check('Face ID' in page.inner_text('.ios-dialog'), 'Face ID proposé après la création')
        tap_dialog(page, 'Utiliser Face ID')
        page.wait_for_timeout(300)
        R.check('remember' in page.evaluate('__vaultCalls') and page.locator('[data-action="pv-bio-toggle"][aria-checked="true"]').count() == 1, 'Face ID activé, réglage coché')
        R.check('shield:true' in page.evaluate('__vaultCalls'), 'écran de confidentialité natif armé coffre ouvert')
        # App inactive (sélecteur d'apps) : contenu masqué ; de nouveau active : visible
        page.evaluate('__fireActive(false)')
        R.check(page.evaluate("document.body.classList.contains('pv-shield')"), 'app inactive : contenu masqué')
        shot(page, LOT, 'selecteur-apps-iPhone_13-dark')
        page.evaluate('__fireActive(true)')
        R.check(not page.evaluate("document.body.classList.contains('pv-shield')"), 'app active : contenu rendu')
        # Ressortir puis revenir : Face ID d'emblée
        page.click('.view.photo-vault [data-action="back"]')
        page.wait_for_selector('.view.body-measures')
        R.check('shield:false' in page.evaluate('__vaultCalls'), 'écran natif désarmé coffre fermé')
        page.click('[data-action="go-photo-vault"]')
        page.wait_for_selector('.pgal, [data-action="photo-add"]', timeout=8000)
        R.check(page.evaluate('vaultIsOpen()') and page.evaluate('__vaultCalls').count('unlock') == 1, 'Face ID ouvre le coffre en entrant')
        # Face ID annulé : clavier du code, touche Face ID pour réessayer
        page.click('[data-action="pv-lock"]')
        page.evaluate("__bioResult = 'cancel'")
        page.click('.pv-key[data-action="pv-bio"]')
        page.wait_for_timeout(300)
        R.check(not page.evaluate('vaultIsOpen()') and page.locator('.pv-key[data-d]').count() == 10, 'Face ID annulé : le code reste possible')
        shot(page, LOT, 'faceid-iPhone_13-dark')
        # Désactiver Face ID : clé retirée du trousseau
        type_code(page, FAKE_CODE)
        page.wait_for_selector('[data-action="pv-bio-toggle"]', timeout=15000)
        page.click('[data-action="pv-bio-toggle"]')
        page.wait_for_timeout(300)
        R.check('forget' in page.evaluate('__vaultCalls') and page.locator('[data-action="pv-bio-toggle"][aria-checked="false"]').count() == 1, 'Face ID désactivé : clé oubliée')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_sans_module(bench):
    """Build installée sans le module natif (OTA avant la build) : code seul, aucune mention de Face ID."""
    shell = """window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => false,
      registerPlugin: () => new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) }) };"""
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'light') as page:
        page.add_init_script(shell)
        page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
        open_vault(page, 'light')
        R.check(page.evaluate('Native.isNative') is True and page.evaluate('Native.vault.available') is False, 'coquille sans module')
        create_vault(page)
        R.check(page.locator('.ios-dialog').count() == 0 and page.locator('[data-action="pv-bio-toggle"]').count() == 0, 'pas de Face ID proposé')
        page.click('[data-action="pv-lock"]')
        R.check(page.locator('[data-action="pv-bio"]').count() == 0, 'pas de touche Face ID')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_tout_supprimer(bench):
    face = png_file('coffre-face.png', 300, 400, (200, 80, 80))
    with bench.frozen_page(NOW, 'chromium', 'Pixel 7', 'dark') as page:
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
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


HIDE = "Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange'))"
SHOW = "Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })"


def t_interruptions(bench):
    """Arrière-plan pendant le calcul du code, pendant la feuille « Nouvelle photo », pendant une confirmation."""
    face = png_file('coffre-face.png', 300, 400, (200, 80, 80))
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'dark') as page:
        open_vault(page, 'dark')
        create_vault(page)
        page.click('[data-action="pv-lock"]')
        page.wait_for_selector('.pv-lock')
        # Code tapé, arrière-plan avant la fin du calcul : coffre fermé, clavier de nouveau utilisable
        type_code(page, FAKE_CODE, wait_after=False)
        page.wait_for_timeout(140)
        page.evaluate(HIDE)
        page.evaluate(SHOW)
        page.wait_for_function("!document.querySelector('.pv-dots--busy')", timeout=15000)
        page.wait_for_timeout(300)
        R.check(not page.evaluate('vaultIsOpen()'), 'arrière-plan pendant le calcul : coffre resté fermé')
        R.check(page.locator('.pv-pad--busy').count() == 0 and not page.locator('.pv-key[data-d="1"]').is_disabled() and page.locator('.pv-dot--on').count() == 0,
                'arrière-plan pendant le calcul : clavier vide et utilisable')
        type_code(page, FAKE_CODE)
        page.wait_for_selector('[data-action="photo-add"]', timeout=15000)
        # Feuille « Nouvelle photo » ouverte, arrière-plan : la photo attend le code, puis la feuille revient
        page.set_input_files('#photoFile', face)
        page.wait_for_selector('.sheet-root .pnew__img')
        page.evaluate(HIDE)
        page.evaluate(SHOW)
        page.wait_for_timeout(300)
        R.check(page.locator('.sheet-root').count() == 0 and page.locator('.view.photo-vault img').count() == 0, 'verrouillé : feuille et image retirées')
        R.check('ranger ta photo' in page.inner_text('#pvMsg'), f'verrouillé : la photo attend le code {page.inner_text("#pvMsg")!r}')
        type_code(page, FAKE_CODE)
        page.wait_for_selector('.sheet-root .pnew__img', timeout=15000)
        page.wait_for_timeout(300)
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.pgal__item', timeout=8000)
        R.check(page.locator('.pgal__item').count() == 1, 'photo rangée après le code')
        # Confirmation de suppression ouverte, inactivité : fermée, la photo reste
        page.locator('.pgal__item').first.click()
        page.wait_for_selector('[data-action="photo-delete"]')
        page.wait_for_timeout(300)
        page.click('[data-action="photo-delete"]')
        page.wait_for_selector('.ios-dialog')
        page.clock.run_for(61_000)
        page.wait_for_timeout(400)
        R.check(page.locator('.ios-dialog').count() == 0 and not page.evaluate('vaultIsOpen()'), 'inactivité : confirmation fermée, coffre fermé')
        R.check(len(page.evaluate(RAW_ROWS)['rows']) == 1, 'la photo n\'a pas été supprimée sans code')
        # Touches de 44 pt au moins et lien « Code oublié » au-dessus de la tab bar
        tab = page.locator('.tabbar').bounding_box()
        link = page.locator('[data-action="pv-forgot"]').bounding_box()
        R.check(link and tab and link['y'] + link['height'] <= tab['y'] + 1, f'« Code oublié ? » au-dessus de la tab bar {link} {tab}')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_hauteur_se(bench):
    """iPhone SE : clavier du code entier entre la barre et la tab bar, en clair et en sombre."""
    for theme in ('light', 'dark'):
        with bench.frozen_page(NOW, 'webkit', 'iPhone SE', theme) as page:
            open_vault(page, theme)
            create_vault(page)
            page.click('[data-action="pv-lock"]')
            page.wait_for_selector('.pv-lock')
            tab = page.locator('.tabbar').bounding_box()
            link = page.locator('[data-action="pv-forgot"]').bounding_box()
            keys = page.locator('.pv-key[data-d]')
            ok44 = all(keys.nth(i).bounding_box()['height'] >= 44 for i in range(keys.count()))
            R.check(link['y'] + link['height'] <= tab['y'] + 1 and ok44, f'SE {theme} : clavier entier au-dessus de la tab bar, touches ≥ 44 {link} {tab}')
            shot(page, LOT, f'clavier-iPhone_SE-{theme}')


run_main(R, [t_coffre], once=[t_interruptions, t_hauteur_se, t_verrouillages, t_migration_et_oubli, t_face_id, t_sans_module, t_tout_supprimer])
