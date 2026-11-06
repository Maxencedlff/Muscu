"""Photos de bilan envoyées au coach (docs/PHOTOS_BILAN.md, app iOS simulée) :
- coach : fiche de l'élève › « Recevoir les photos de bilan » (Face ID, clé publiée : la clé privée n'arrive au serveur
  que chiffrée) ;
- élève : coffre ouvert › « Envoyer à mon coach » sous un jour ; feuille avec chaque photo à cocher (accord photo par
  photo, rien de coché d'avance), ou la photo seule (2 touchers) ; fichier envoyé chiffré (aucun octet JPEG ni EXIF),
  sans remplacement possible ; Mon coach › Bilan › Photos de bilan : liste, « Retirer » (ligne et fichier effacés) ;
  quitter le coach efface tout ;
- coach : `coach-photos:UID` ouvert avec Face ID, photos déchiffrées (sans métadonnées), deux dates côte à côte,
  URL signées de 60 s, aucun bouton pour enregistrer, appui long sans menu, refermé en arrière-plan et après une minute ;
- métadonnées : un vrai JPEG avec localisation GPS, appareil et modèle, redessiné par coachPhotoJpeg : plus rien ;
- serveur pas à jour (PGRST202) ou coquille sans le module du coffre : rien ne s'affiche.

Deux pages, deux comptes : l'app du coach et celle de l'élève (même identifiants des deux côtés), le faux serveur
(tests/fake_account.py, règles de 20261107000000_photos_bilan.sql) recopié de l'une à l'autre. Trousseau factice : un
secret de test tiré au hasard par identifiant (jamais une vraie clé). Images générées (aucune photo de personne).
Horloge figée au vendredi 20 novembre 2026. Captures : $PPL_SCRATCH/shots/lotphotos/.
Lancer : PPL_URL=http://127.0.0.1:8779/ PPL_DEV="iPhone 13" python3 tests/test_photos_bilan.py
"""
import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT
from PIL import Image, ExifTags, ImageDraw

LOT = 'photos'
R = Results(LOT)
NOW = local_ms(2026, 11, 20, 10, tz=PARIS)

# Module du coffre ajouté à la coquille de FAKE_ACCOUNT. Trousseau factice dans sessionStorage : { id: secret de test }.
VAULT = """
(() => {
  window.__vaultCalls = [];
  window.__vaultMode = 'ok';
  const KC = '__fakeKeychain';
  const all = () => JSON.parse(sessionStorage.getItem(KC) || '{}');
  const save = o => sessionStorage.setItem(KC, JSON.stringify(o));
  const fakeKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const err = code => { const e = new Error(code); e.code = code; return e; };
  const ios = () => (__vaultMode === 'cancel' ? Promise.reject(err('CANCELED')) : Promise.resolve());
  const vault = {
    status: async () => ({ biometry: 'faceID', passcode: true }),
    create: async ({ id }) => { __vaultCalls.push('create'); if (!/^[0-9a-f]{16,64}$/.test(id || '')) throw err('FAILED');
      await ios(); const o = all(); o[id] ||= fakeKey(); save(o); return { key: o[id] }; },
    unlock: async ({ id }) => { __vaultCalls.push('unlock'); if (!all()[id]) throw err('NOT_FOUND'); await ios(); return { key: all()[id] }; },
    forget: async ({ id }) => { __vaultCalls.push('forget'); const o = all(); delete o[id]; save(o); return {}; },
    shield: async ({ on }) => { __vaultCalls.push('shield:' + on); return {}; },
  };
  const base = window.Capacitor;
  window.Capacitor = { ...base,
    isPluginAvailable: n => (n === 'MdlfVault' ? !window.__noVault : base.isPluginAvailable(n)),
    registerPlugin: n => (n === 'MdlfVault' ? vault : base.registerPlugin(n)) };
})();
"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def gps_jpeg(name, w, h, rgb, band):
    """JPEG avec localisation GPS (Paris), fabricant et modèle dans l'EXIF : image unie à bandes, aucune personne."""
    os.makedirs(SCRATCH, exist_ok=True)
    path = os.path.join(SCRATCH, name)
    img = Image.new('RGB', (w, h), rgb)
    d = ImageDraw.Draw(img)
    for y in range(0, h, 120):
        d.rectangle([0, y, w, y + 50], fill=band)
    exif = Image.Exif()
    exif[0x010F] = 'FauxAppareil'
    exif[0x0110] = 'Modele de test'
    exif.get_ifd(ExifTags.IFD.GPSInfo).update({1: 'N', 2: (48.0, 51.0, 29.6), 3: 'E', 4: (2.0, 17.0, 40.2)})
    img.save(path, quality=90, exif=exif)
    check = Image.open(path).getexif()
    assert check.get_ifd(ExifTags.IFD.GPSInfo).get(1) == 'N' and check.get(0x010F) == 'FauxAppareil', 'image de test sans GPS'
    return path


def open_app(page, theme, opts=None, vault=True):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, **(opts or {})}))
    page.add_init_script(FAKE_ACCOUNT)
    if not vault:
        page.add_init_script('window.__noVault = true;')
    page.add_init_script(VAULT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username):
    page.evaluate("""async u => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: u }); }""", username)
    page.wait_for_timeout(200)


def coach_page(page, theme, **kw):
    """Je suis max, coach ; lea est mon élève. max …0001, lea …0002 (mêmes identifiants que student_page)."""
    open_app(page, theme, **kw)
    signin(page, 'max')
    ids = page.evaluate("""() => { const me = __sb.meId(); __sb.makeCoach(me);
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false });
        __sb.link(me, lea, Date.now() - 40 * 86400000); return { max: me, lea }; }""")
    page.evaluate('coachRefresh()')
    page.wait_for_timeout(300)
    return ids


def student_page(page, theme, **kw):
    """Je suis lea, élève de max (créé d'abord : …0001), moi …0002."""
    open_app(page, theme, **kw)
    mx = page.evaluate("() => __sb.addPerson({ username: 'max', avatar: '🦁', social: false })")
    signin(page, 'lea')
    ids = page.evaluate("""mx => { const me = __sb.meId(); __sb.makeCoach(mx); __sb.link(mx, me, Date.now() - 40 * 86400000); return { max: mx, lea: me }; }""", mx)
    page.evaluate('coachRefresh()')
    page.wait_for_timeout(300)
    return ids


def copy_server(src, dst):
    """Ce que le serveur garde des photos (clés, lignes, fichiers, file) : d'une page à l'autre."""
    st = src.evaluate("() => JSON.stringify({ pkeys: __sb.co.pkeys, photos: __sb.co.photos, objs: __sb.objs, trash: __sb.trash })")
    dst.evaluate("s => { const o = JSON.parse(s); __sb.co.pkeys = o.pkeys; __sb.co.photos = o.photos; __sb.objs = o.objs; __sb.trash = o.trash; }", st)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, sel='#app button, .tabbar button, .sheet button'):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page):
    return page.evaluate("""() => [...document.querySelectorAll('#app *, .tabbar *, .sheet *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, select, option, svg, use, .icon *, .visually-hidden') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""")


def layout(page, t, name):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page)
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')


def toast(page):
    return page.locator('.toast').last.inner_text() if page.locator('.toast').count() else ''


def add_photo(page, path, pose, days_ago):
    page.set_input_files('#photoFile', path)
    page.wait_for_selector('.sheet .pnew__img')
    page.click(f'.sheet [data-action="photo-pose"][data-pose="{pose}"]')
    day = page.evaluate('d => localISO(Date.now() - d * 86400000)', days_ago)
    page.fill('#phDate', day)
    page.click('.sheet .sheet__btn--confirm')
    page.wait_for_function('() => !document.querySelector(".sheet .pnew__img")')
    page.wait_for_timeout(500)


def t_envoi_complet(bench, eng, dev, theme):
    t = tag(dev, theme)
    face = gps_jpeg('bilan-face.jpg', 1500, 2000, (190, 120, 80), (60, 90, 160))
    back = gps_jpeg('bilan-dos.jpg', 1500, 2000, (120, 160, 90), (40, 40, 40))
    old = gps_jpeg('bilan-ancienne.jpg', 1200, 1600, (200, 200, 120), (150, 60, 60))
    with bench.frozen_page(NOW, eng, dev, theme) as cp, bench.frozen_page(NOW, eng, dev, theme) as sp:
        # ── Coach : activer la réception (une fois, Face ID) ──
        ids = coach_page(cp, theme)
        cp.evaluate(f"navigate(makeRoute('coach-student', '{ids['lea']}'))")
        cp.wait_for_selector('[data-action="cph-setup"]')
        cp.locator('[data-action="cph-setup"]').scroll_into_view_if_needed()
        layout(cp, t, 'Fiche : recevoir les photos')
        shot(cp, LOT, f'01-fiche-recevoir-{t}')
        cp.click('[data-action="cph-setup"]')
        cp.wait_for_selector('[data-action="cph-open"]')
        key = cp.evaluate(f"() => __sb.co.pkeys['{ids['max']}']")
        R.check(key and len(key['wrapped_key']) >= 40 and '"d"' not in json.dumps(key) and cp.evaluate('__vaultCalls').count('create') == 1,
                f'{t} clé publiée, privée seulement chiffrée, Face ID demandé une fois')
        R.check('Réception des photos activée' in toast(cp), f'{t} toast d\'activation ({toast(cp)!r})')
        layout(cp, t, 'Fiche : photos activées')
        shot(cp, LOT, f'02-fiche-activee-{t}')

        # ── Élève : coffre, trois photos sur deux jours ──
        sids = student_page(sp, theme)
        R.check(sids == ids, f'{t} mêmes identifiants des deux côtés ({sids} / {ids})')
        copy_server(cp, sp)
        sp.evaluate("navigate('photo-vault')")
        sp.wait_for_selector('[data-action="pv-start"]')
        sp.click('[data-action="pv-start"]')
        sp.wait_for_selector('.view.photo-vault [data-action="photo-add"]')
        add_photo(sp, face, 'face', 0)
        add_photo(sp, back, 'back', 0)
        add_photo(sp, old, 'face', 14)
        sp.wait_for_selector('[data-action="cph-send-day"]')
        R.check(sp.locator('[data-action="cph-send-day"]').count() == 2, f'{t} coffre : un bouton par jour')
        R.check(not sp.evaluate('__sb.co.photos.length'), f'{t} rien d\'envoyé sans geste')
        layout(sp, t, 'Coffre avec envoi')
        shot(sp, LOT, f'03-coffre-envoyer-{t}')

        # Jour à deux photos : rien de coché d'avance, accord photo par photo
        sp.locator('[data-action="cph-send-day"]').first.click()
        sp.wait_for_selector('.sheet .cphs__item')
        go = sp.locator('.sheet .cphs__go')
        R.check(sp.locator('.sheet .cphs__item[aria-checked="true"]').count() == 0 and go.is_disabled(), f'{t} feuille : rien de coché, Envoyer grisé')
        sp.locator('.sheet .cphs__item').first.click()
        ok_txt = sp.locator('.sheet .cphs__item').first.locator('.cphs__ok')
        R.check(ok_txt.is_visible() and 'Ton coach verra cette photo. Tu peux la retirer quand tu veux.' in ok_txt.inner_text()
                and not sp.locator('.sheet .cphs__item').nth(1).locator('.cphs__ok').is_visible(), f'{t} accord affiché sous la photo cochée seulement')
        sp.locator('.sheet .cphs__item').nth(1).click()
        R.check(go.inner_text() == 'Envoyer 2 photos', f'{t} bouton « Envoyer 2 photos » ({go.inner_text()!r})')
        layout(sp, t, 'Feuille d\'envoi')
        shot(sp, LOT, f'04-feuille-envoi-{t}')
        go.click()
        # Premier envoi : 18 ans ou plus, déclaré une fois
        sp.wait_for_selector('.ios-dialog')
        R.check('18 ans ou plus' in sp.inner_text('.ios-dialog'), f'{t} premier envoi : âge demandé')
        shot(sp, LOT, f'04b-age-{t}')
        tap_dialog(sp, "J'ai 18 ans ou plus")
        sp.wait_for_function('() => !document.querySelector(".sheet .cphs__list")', timeout=15000)
        sp.wait_for_timeout(400)
        R.check('2 photos envoyées à max' in toast(sp), f'{t} toast après envoi ({toast(sp)!r})')
        # Jour à une photo : 2 touchers (Envoyer à mon coach, Envoyer cette photo)
        sp.locator('[data-action="cph-send-day"]').first.click()
        sp.wait_for_selector('.sheet .cphs__one')
        lead = sp.inner_text('.sheet .cphs__lead')
        R.check('Ton coach verra cette photo. Tu peux la retirer quand tu veux.' in lead, f'{t} photo seule : accord affiché ({lead!r})')
        layout(sp, t, 'Feuille d\'envoi (une photo)')
        shot(sp, LOT, f'05-feuille-une-photo-{t}')
        sp.click('.sheet [data-action="cph-send-go"]')
        sp.wait_for_function('() => !document.querySelector(".sheet .cphs__one")', timeout=15000)
        sp.wait_for_timeout(400)
        st = sp.evaluate("() => ({ n: __sb.co.photos.filter(p => p.state === 'ready').length, objs: Object.values(__sb.objs).map(o => o.b64),"
                         " ups: __sb.calls.filter(c => c[0] === 'storage' && c[1] === 'upload').map(c => JSON.parse(c[2])) })")
        R.check(st['n'] == 3 and len(st['objs']) == 3, f'{t} 3 photos prêtes, 3 fichiers ({st["n"]}, {len(st["objs"])})')
        raw = [base64.b64decode(b) for b in st['objs']]
        R.check(all(b[:2] != b'\xff\xd8' and b'JFIF\x00' not in b and b'Exif\x00\x00' not in b and b'FauxAppareil' not in b for b in raw), f'{t} fichiers : du chiffré seulement')
        R.check(all(u['upsert'] is False and u['contentType'] == 'application/octet-stream' and u['path'].startswith(ids['lea'] + '/') for u in st['ups']),
                f'{t} envoi sans remplacement, dans mon dossier ({st["ups"]})')
        R.check(sp.locator('[data-action="cph-send-day"]').count() == 0, f'{t} coffre : plus de bouton une fois tout envoyé')
        # Photo du coffre ouverte : « Envoyée à max », retirer
        sp.locator('.pgal__item').first.click()
        sp.wait_for_selector('.sheet .pview__img')
        R.check('Envoyée à max le' in sp.inner_text('.sheet') and sp.locator('.sheet [data-action="cph-remove"]').count() == 1, f'{t} photo du coffre : envoyée, et retirable')
        shot(sp, LOT, f'06-photo-envoyee-{t}')
        sp.click('.sheet .sheet__btn--cancel')
        sp.wait_for_timeout(300)

        # ── Élève : Mon coach › Photos de bilan ──
        sp.evaluate("navigate('coach-mine')")
        sp.wait_for_selector('[data-action="cph-open-mine"]')
        cell = sp.inner_text('[data-action="cph-open-mine"]')
        R.check('3 photos envoyées' in cell, f'{t} Mon coach : cellule Bilan ({cell!r})')
        sp.click('[data-action="cph-open-mine"]')
        sp.wait_for_selector('.coach-photos-mine-view .cph-row')
        R.check(sp.locator('.cph-row').count() == 3, f'{t} 3 photos listées')
        txt = sp.inner_text('.coach-photos-mine-view')
        R.check('Code de la clé de ton coach' in txt, f'{t} code de la clé montré à l\'élève')
        layout(sp, t, 'Photos envoyées')
        shot(sp, LOT, f'07-photos-envoyees-{t}')

        # ── Coach : ouvrir avec Face ID, comparer ──
        copy_server(sp, cp)
        cp.evaluate(f"navigate(makeRoute('coach-photos', '{ids['lea']}'))")
        cp.wait_for_function("() => document.querySelectorAll('.coach-photos-view .pgal__item img[src^=\"blob:\"]').length === 3", timeout=20000)
        cp.wait_for_timeout(400)
        dec = cp.evaluate("""async () => { const out = []; for (const u of cphUrls.values()) {
            const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); const s = String.fromCharCode(...b.subarray(0, 4096));
            out.push({ free: jpegMetaFree(b), soi: b[0] === 0xFF && b[1] === 0xD8, exif: s.includes('Exif'), make: s.includes('FauxAppareil') }); } return out; }""")
        R.check(len(dec) == 3 and all(d['free'] and d['soi'] and not d['exif'] and not d['make'] for d in dec), f'{t} coach : photos déchiffrées, sans métadonnées {dec}')
        signed = cp.evaluate('__sb.signed')
        R.check(signed and all(s[1] == 60 for s in signed), f'{t} URL signées de 60 s ({signed})')
        R.check(cp.locator('.coach-photos-view .cph-pair').count() >= 1 and cp.locator('#cph-a').count() == 1, f'{t} comparer deux dates côte à côte')
        body = cp.inner_text('.coach-photos-view')
        R.check('Enregistrer' not in body and 'Télécharger' not in body, f'{t} aucun bouton pour enregistrer')
        prot = cp.evaluate("""() => { const s = getComputedStyle(document.querySelector('.coach-photos-view .pgal__item img'));
            return [s.pointerEvents, s.webkitTouchCallout || s.getPropertyValue('-webkit-touch-callout'), s.userSelect || s.webkitUserSelect]; }""")
        R.check(prot[0] == 'none', f'{t} appui long sans menu sur les photos ({prot})')
        R.check('d\'écart' in body and 'Code de ta clé' in body, f'{t} écart entre les dates et code de la clé')
        layout(cp, t, 'Photos du coach')
        shot(cp, LOT, f'08-coach-comparer-{t}')
        cp.locator('.coach-photos-view .pgal__item').first.scroll_into_view_if_needed()
        shot(cp, LOT, f'09-coach-par-date-{t}')
        # Arrière-plan : clé oubliée, images libérées, écran refermé
        cp.evaluate("() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }")
        cp.wait_for_timeout(300)
        R.check(cp.evaluate('cphUrls.size') == 0 and not cphopen(cp) and cp.locator('[data-action="cph-unlock"]').count() == 1, f'{t} arrière-plan : refermé')
        cp.evaluate("() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); }")
        layout(cp, t, 'Photos du coach refermées')
        shot(cp, LOT, f'10-coach-refermees-{t}')
        cp.click('[data-action="cph-unlock"]')
        cp.wait_for_function("() => document.querySelectorAll('.coach-photos-view .pgal__item img[src^=\"blob:\"]').length === 3", timeout=20000)
        cp.clock.run_for(61_000)
        cp.wait_for_timeout(300)
        R.check(not cphopen(cp) and 'une minute sans activité' in cp.inner_text('.coach-photos-view'), f'{t} refermées après une minute sans toucher')

        # ── Élève : retirer une photo, puis quitter le coach ──
        sp.locator('.cph-row').first.locator('[data-action="cph-remove"]').click()
        tap_dialog(sp, 'Retirer')
        sp.wait_for_timeout(500)
        st = sp.evaluate("() => ({ n: __sb.co.photos.length, objs: Object.keys(__sb.objs).length, trash: __sb.trash.length })")
        R.check(st == {'n': 2, 'objs': 2, 'trash': 1} and sp.locator('.cph-row').count() == 2, f'{t} retrait : ligne et fichier effacés {st}')
        copy_server(sp, cp)
        cp.evaluate("goBack()")
        cp.wait_for_timeout(300)
        cp.evaluate(f"navigate(makeRoute('coach-photos', '{ids['lea']}'))")
        cp.wait_for_function("() => document.querySelectorAll('.coach-photos-view .pgal__item img[src^=\"blob:\"]').length === 2", timeout=20000)
        R.check(True, f'{t} coach : la photo retirée n\'apparaît plus')
        # Le coach efface une photo reçue
        cp.locator('.coach-photos-view .pgal__item').first.click()
        cp.wait_for_selector('.sheet [data-action="cph-hide"]')
        layout(cp, t, 'Photo en grand (coach)')
        shot(cp, LOT, f'11-coach-photo-{t}')
        cp.click('.sheet [data-action="cph-hide"]')
        tap_dialog(cp, 'Effacer')
        cp.wait_for_function("() => document.querySelectorAll('.coach-photos-view .pgal__item img[src^=\"blob:\"]').length === 1", timeout=10000)
        R.check(cp.evaluate('__sb.co.photos.length') == 1 and cp.evaluate('__sb.trash.length') == 2, f'{t} coach : photo effacée de chez lui et du serveur')
        copy_server(cp, sp)
        sp.evaluate("navigate('coach-mine')")
        sp.wait_for_selector('[data-action="coach-leave"]')
        sp.click('[data-action="coach-leave"]')
        tap_dialog(sp, 'Quitter mon coach')
        sp.wait_for_timeout(800)
        st = sp.evaluate("() => ({ n: __sb.co.photos.length, objs: Object.keys(__sb.objs).length, sent: localStorage.getItem('mdlf_coach_photos') })")
        R.check(st == {'n': 0, 'objs': 0, 'sent': None}, f'{t} quitter le coach : tout effacé {st}')
        R.check(not cp.errors and not sp.errors, f'{t} aucune erreur JS {cp.errors} {sp.errors}')


def cphopen(page):
    return page.evaluate('cphIsOpen()')


def t_metadonnees(bench, eng, dev, theme):
    """Un vrai JPEG avec GPS : redessiné par coachPhotoJpeg, plus aucune métadonnée (vérifié aussi par Pillow)."""
    t = tag(dev, theme)
    path = gps_jpeg('gps-brut.jpg', 3024, 4032, (170, 140, 110), (30, 60, 90))
    src = open(path, 'rb').read()
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        r = page.evaluate("""async b64 => {
            const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const out = await coachPhotoJpeg(new Blob([raw], { type: 'image/jpeg' }));
            let s = ''; out.bytes.forEach(x => { s += String.fromCharCode(x); });
            return { before: jpegMetaFree(raw), after: jpegMetaFree(out.bytes), w: out.w, h: out.h, b64: btoa(s) }; }""", base64.b64encode(src).decode())
        out = base64.b64decode(r['b64'])
        R.check(r['before'] is False, f'{t} image de départ : métadonnées vues (GPS)')
        R.check(r['after'] is True and max(r['w'], r['h']) == 1080, f'{t} redessinée : sans métadonnées, 1080 px ({r["w"]}×{r["h"]})')
        tmp = os.path.join(SCRATCH, f'gps-redessinee-{tag(dev, theme)}.jpg')
        with open(tmp, 'wb') as fh:
            fh.write(out)
        ex = Image.open(tmp).getexif()
        R.check(len(ex) == 0 and not ex.get_ifd(ExifTags.IFD.GPSInfo) and b'Exif' not in out and b'FauxAppareil' not in out,
                f'{t} Pillow : aucun EXIF ni GPS après ({dict(ex)})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_serveur_ancien(bench, eng, dev, theme):
    """Serveur sans la migration (PGRST202), ou coquille sans le module du coffre : rien ne s'affiche."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as sp:
        student_page(sp, theme)
        sp.evaluate("__sb.fail.photos = 'missing'")
        sp.evaluate("navigate('coach-mine')")
        sp.wait_for_selector('.coach-mine-view')
        sp.wait_for_timeout(500)
        R.check(sp.locator('[data-action="cph-open-mine"]').count() == 0, f'{t} élève, serveur ancien : pas de cellule Bilan')
        sp.evaluate("navigate('coach-share')")
        sp.wait_for_timeout(500)
        R.check(sp.locator('[data-action="cph-open-mine"]').count() == 0, f'{t} Partager : pas de photos')
        R.check(not sp.errors, f'{t} aucune erreur JS {sp.errors}')
    with bench.frozen_page(NOW, eng, dev, theme) as cp:
        ids = coach_page(cp, theme)
        cp.evaluate("__sb.fail.photos = 'missing'")
        cp.evaluate(f"navigate(makeRoute('coach-student', '{ids['lea']}'))")
        cp.wait_for_selector('.coach-student-view .coach-join__who')
        cp.wait_for_timeout(500)
        R.check(cp.locator('[data-action="cph-setup"], [data-action="cph-open"]').count() == 0, f'{t} coach, serveur ancien : pas de photos')
        R.check(not cp.errors, f'{t} aucune erreur JS {cp.errors}')
    with bench.frozen_page(NOW, eng, dev, theme) as cp:
        ids = coach_page(cp, theme, vault=False)
        cp.evaluate(f"navigate(makeRoute('coach-student', '{ids['lea']}'))")
        cp.wait_for_selector('.coach-student-view .coach-join__who')
        cp.wait_for_timeout(500)
        R.check(cp.locator('[data-action="cph-setup"], [data-action="cph-open"]').count() == 0, f'{t} coquille sans le module du coffre : pas de photos')
        R.check(not cp.evaluate("__sb.calls.some(c => c[1] === 'coach_photo_key')"), f'{t} sans le module : aucun appel')


run_main(R, [t_envoi_complet, t_metadonnees, t_serveur_ancien])
