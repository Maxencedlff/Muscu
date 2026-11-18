"""Photo de profil (docs/PHOTO_PROFIL.md, app iOS simulée, faux serveur de tests/fake_account.py, règles de
20261117010000_photo_profil.sql) :
- Réglages › Compte : cellule « Photo de profil » avec la mention « Pro » (aucune pour un coach) ; feuille, choix d'une
  image (sélecteur de fichier ouvert dans le geste), aperçu du carré, « Utiliser cette photo » ; fichier envoyé carré,
  512 px, JPEG ou WebP, léger, sans EXIF ni localisation ; photo posée sur l'avatar ; « Retirer la photo » : effacée
  du serveur, l'emoji revient ;
- profil d'un ami : sa photo, « Signaler la photo » (référence photo:<id>, motif), masquée aussitôt ici ; pas de photo
  pour un inconnu ; image illisible : l'emoji reste ;
- droit : verrou allumé sans abonnement → écran d'abonnement ; coach → feuille, sans « Pro » ;
- serveur pas à jour (PGRST202) : rien ne s'affiche, aucune demande des photos des autres.
Images générées (aucune photo de personne). Horloge figée au lundi 16 novembre 2026.
Captures : $PPL_SCRATCH/shots/lotphotoprofil/.
Lancer : PPL_URL=http://127.0.0.1:8779/ PPL_DEV="iPhone 13" python3 tests/test_photo_profil.py
"""
import base64
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT
from PIL import Image, ExifTags, ImageDraw

LOT = 'photoprofil'
R = Results(LOT)
NOW = local_ms(2026, 11, 16, 10, tz=PARIS)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def gps_jpeg(name, w, h):
    """JPEG paysage avec localisation GPS, fabricant et modèle : disque orange sur fond bleu, aucune personne."""
    os.makedirs(SCRATCH, exist_ok=True)
    path = os.path.join(SCRATCH, name)
    img = Image.new('RGB', (w, h), (40, 70, 120))
    d = ImageDraw.Draw(img)
    r = min(w, h) // 3
    d.ellipse([w // 2 - r, h // 2 - r, w // 2 + r, h // 2 + r], fill=(230, 140, 60))
    d.rectangle([0, 0, w // 6, h], fill=(200, 40, 40))   # bande à gauche : coupée par le recadrage carré
    exif = Image.Exif()
    exif[0x010F] = 'FauxAppareil'
    exif[0x0110] = 'Modele de test'
    exif.get_ifd(ExifTags.IFD.GPSInfo).update({1: 'N', 2: (48.0, 51.0, 29.6), 3: 'E', 4: (2.0, 17.0, 40.2)})
    img.save(path, quality=92, exif=exif)
    assert Image.open(path).getexif().get(0x010F) == 'FauxAppareil', 'image de test sans EXIF'
    return path


def pattern_jpeg_b64(rgb, ring):
    """Photo de profil d'un ami : JPEG opaque de 512 px, anneaux de couleur (aucune personne), en base64."""
    img = Image.new('RGB', (512, 512), rgb)
    d = ImageDraw.Draw(img)
    for i, r in enumerate(range(240, 0, -60)):
        d.ellipse([256 - r, 256 - r, 256 + r, 256 + r], fill=ring if i % 2 == 0 else rgb)
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=80)
    return base64.b64encode(buf.getvalue()).decode()


def open_app(page, theme, opts=None):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, **(opts or {})}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username='max', fail=None):
    page.evaluate("""async ([u, f]) => { if (f) __sb.fail.pphoto = f; await accountSignInWith('apple', async () => 'add');
        await accountSaveProfile({ username: u, avatar: '🦁' }); await socialEnable(true); }""", [username, fail])
    page.wait_for_timeout(300)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, sel='#app button, .sheet button'):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => getComputedStyle(e).visibility !== 'hidden')
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page):
    return page.evaluate("""() => [...document.querySelectorAll('#app *, .sheet *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, select, option, svg, use, .icon *, .visually-hidden') && e.scrollWidth > e.clientWidth + 1
        && getComputedStyle(e).display !== 'inline' && getComputedStyle(e).visibility !== 'hidden')
        .map(e => e.textContent.trim().slice(0, 30))""")


def layout(page, t, name):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page)
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')


def toast(page):
    return page.locator('.toast').last.inner_text() if page.locator('.toast').count() else ''


def has_photo(page, sel):
    """L'avatar `sel` montre une photo chargée (image décodée, pas seulement posée)."""
    return page.evaluate("""s => { const i = document.querySelector(s + ' .avatar__photo'); return !!(i && i.complete && i.naturalWidth > 0); }""", sel)


def t_compte_envoi_retrait(bench, eng, dev, theme):
    t = tag(dev, theme)
    src = gps_jpeg('profil-gps.jpg', 3000, 2000)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page)
        me = page.evaluate('__sb.meId()')
        page.evaluate("navigate('account')")
        page.wait_for_selector('[data-action="pph-open"]', timeout=5000)
        cell = page.inner_text('[data-action="pph-open"]')
        R.check('Photo de profil' in cell and 'Pro' in cell and 'Aucune' in cell, f'{t} Compte : cellule « Photo de profil », mention Pro ({cell!r})')
        foot = page.inner_text('.account-view')
        R.check('Personne d\'autre ne voit la photo' in foot, f'{t} Compte : qui voit la photo, dit sous le groupe')
        layout(page, t, 'Compte')
        shot(page, LOT, f'01-compte-{t}')

        page.click('[data-action="pph-open"]')
        page.wait_for_selector('.sheet .pph-sheet [data-action="pph-pick"]')
        lead = page.inner_text('.sheet .pph-sheet')
        R.check('Visible seulement de tes amis et de ton coach' in lead and 'Comprise dans MDLF Pro' in lead and 'sans la localisation' in lead,
                f'{t} feuille : portée, Pro, sans métadonnées')
        R.check(page.locator('.sheet [data-action="pph-remove"]').count() == 0, f'{t} sans photo : pas de « Retirer »')
        layout(page, t, 'Feuille')
        shot(page, LOT, f'02-feuille-{t}')

        # Un seul toucher : le sélecteur de fichier s'ouvre dans le geste
        with page.expect_file_chooser() as fc:
            page.click('.sheet [data-action="pph-pick"]')
        fc.value.set_files(src)
        page.wait_for_selector('.sheet .pph-preview__img')
        page.wait_for_function("() => document.querySelector('.sheet .pph-preview__img').naturalWidth > 0")
        dims = page.evaluate("() => { const i = document.querySelector('.sheet .pph-preview__img'); return [i.naturalWidth, i.naturalHeight]; }")
        R.check(dims == [512, 512], f'{t} aperçu : carré de 512 px ({dims})')
        R.check(not page.evaluate("__sb.pp.photos.length"), f'{t} rien d\'envoyé avant « Utiliser cette photo »')
        layout(page, t, 'Aperçu')
        shot(page, LOT, f'03-apercu-{t}')

        page.click('.sheet [data-action="pph-use"]')
        page.wait_for_function("() => !document.querySelector('.sheet .pph-sheet')", timeout=10000)
        page.wait_for_timeout(300)
        R.check('Photo de profil enregistrée' in toast(page), f'{t} toast ({toast(page)!r})')
        obj = page.evaluate("""me => { const p = __sb.pp.photos.find(x => x.user === me && x.state === 'ready');
            const o = p && __sb.objs[me + '/' + p.id]; return o ? { b64: o.b64, size: o.size, type: o.type, path: me + '/' + p.id } : null; }""", me)
        R.check(obj and obj['type'] in ('image/jpeg', 'image/webp') and obj['size'] <= 80 * 1024, f'{t} fichier léger, JPEG ou WebP ({obj and obj["size"]} o, {obj and obj["type"]})')
        raw = base64.b64decode(obj['b64']) if obj else b''
        im = Image.open(io.BytesIO(raw)) if raw else None
        R.check(im is not None and im.size == (512, 512), f'{t} fichier carré de 512 px ({im and im.size})')
        R.check(raw and b'Exif' not in raw and b'FauxAppareil' not in raw and not (im and len(im.getexif())), f'{t} fichier sans EXIF ni localisation')
        # Recadrage au centre : la bande rouge de gauche est coupée, le disque orange au milieu
        if im:
            px = im.convert('RGB')
            mid, left = px.getpixel((256, 256)), px.getpixel((4, 256))
            R.check(mid[0] > 180 and mid[2] < 120 and left[0] < 120, f'{t} carré central (milieu {mid}, bord {left})')
        page.wait_for_function("() => { const i = document.querySelector('.account-hero .avatar__photo'); return i && i.naturalWidth > 0; }", timeout=5000)
        R.check('Ajoutée' in page.inner_text('[data-action="pph-open"]'), f'{t} Compte : « Ajoutée »')
        R.check(not page.evaluate("__sb.signed.some(s => s[0].startsWith(__sb.meId()))"), f'{t} ma photo affichée sans la relire du serveur')
        layout(page, t, 'Compte avec photo')
        shot(page, LOT, f'04-compte-photo-{t}')

        # Réglages : la cellule du compte montre la photo aussi
        page.evaluate("navigate('settings')")
        page.wait_for_timeout(400)
        R.check(has_photo(page, '#accountGroup'), f'{t} Réglages : photo sur la cellule du compte')

        # Retirer : effacée du serveur, l'emoji revient
        page.evaluate("navigate('account')")
        page.wait_for_selector('[data-action="pph-open"]')
        page.click('[data-action="pph-open"]')
        page.wait_for_selector('.sheet [data-action="pph-remove"]')
        page.click('.sheet [data-action="pph-remove"]')
        tap_dialog(page, 'Retirer')
        page.wait_for_function("() => !document.querySelector('.sheet .pph-sheet')", timeout=10000)
        page.wait_for_timeout(300)
        R.check(page.evaluate("me => !__sb.pp.photos.some(p => p.user === me)", me) and obj and page.evaluate("p => __sb.trash.includes(p) && !__sb.objs[p]", obj['path']),
                f'{t} retirée : ligne effacée, fichier en purge et retiré')
        R.check(page.locator('.account-hero .avatar__photo').count() == 0 and '🦁' in page.inner_text('.account-hero'), f'{t} l\'emoji revient')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_vu_par_ami(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page)
        ids = page.evaluate("""([a, b]) => { const me = __sb.meId();
            const lea = __sb.addPerson({ username: 'lea', avatar: '🦊' }), zoe = __sb.addPerson({ username: 'zoe', avatar: '🐼' });
            const bad = __sb.addPerson({ username: 'eve', avatar: '🦉' });
            __sb.follow(me, lea); __sb.follow(bad, me);
            __sb.setPhoto(lea, a, 'image/jpeg'); __sb.setPhoto(zoe, b, 'image/jpeg'); __sb.setPhoto(bad, btoa('pas une image'));
            return { me, lea, zoe, bad }; }""", [pattern_jpeg_b64((40, 110, 90), (235, 225, 210)), pattern_jpeg_b64((90, 60, 140), (240, 200, 80))])
        page.evaluate("socialRefresh()")
        page.wait_for_timeout(300)
        page.evaluate(f"navigate(makeRoute('social-profile', '{ids['lea']}'))")
        page.wait_for_selector('.social-profile-view .account-hero')
        page.wait_for_function("() => { const i = document.querySelector('.social-profile-view .account-hero .avatar__photo'); return i && i.naturalWidth > 0; }", timeout=5000)
        page.wait_for_selector('[data-action="pph-report"]', timeout=5000)
        R.check(page.locator('[data-action="pph-report"]').inner_text() == 'Signaler la photo', f'{t} profil d\'ami : « Signaler la photo »')
        layout(page, t, 'Profil d\'un ami')
        shot(page, LOT, f'05-profil-ami-{t}')
        R.check(page.evaluate("__sb.signed.every(s => s[1] === 1800)"), f'{t} URL signées de 30 min')

        # Signaler : motif propre à une photo, référence photo:<id>, masquée aussitôt ici
        page.click('[data-action="pph-report"]')
        page.wait_for_selector('.ios-dialog')
        sheet_txt = page.inner_text('.ios-dialog')
        R.check('Nudité ou contenu sexuel' in sheet_txt and 'Ce n\'est pas cette personne' in sheet_txt, f'{t} motifs d\'une photo')
        shot(page, LOT, f'06-signaler-photo-{t}')
        tap_dialog(page, 'Ce n\'est pas cette personne')
        page.wait_for_selector('.ios-dialog', timeout=5000)
        rep = page.evaluate("() => __sb.so.reports[__sb.so.reports.length - 1]")
        pid = page.evaluate(f"() => __sb.pp.photos.find(p => p.user === '{ids['lea']}').id")
        R.check(rep and rep['kind'] == 'profile' and rep['target_ref'] == f'photo:{pid}' and rep['reason'] == 'autre' and 'pas cette personne' in (rep.get('details') or ''),
                f'{t} signalement : profil, référence de la photo, motif ({rep})')
        tap_dialog(page, 'OK')
        page.wait_for_timeout(300)
        R.check(page.locator('.social-profile-view .account-hero .avatar__photo').count() == 0 and '🦊' in page.inner_text('.social-profile-view .account-hero'),
                f'{t} photo signalée : plus montrée ici, l\'emoji la remplace')
        R.check(page.locator('[data-action="pph-report"]').count() == 0, f'{t} plus de « Signaler la photo »')

        # Inconnu (zoe) : jamais sa photo ; abonné (eve) dont l'image est illisible : l'emoji reste
        page.evaluate(f"navigate(makeRoute('social-profile', '{ids['zoe']}'))")
        page.wait_for_selector('.social-profile-view .account-hero')
        page.wait_for_timeout(600)
        R.check(page.locator('.social-profile-view .avatar__photo').count() == 0, f'{t} inconnu : pas de photo')
        page.evaluate(f"navigate(makeRoute('social-profile', '{ids['bad']}'))")
        page.wait_for_selector('.social-profile-view .account-hero')
        page.wait_for_timeout(800)
        R.check(page.locator('.social-profile-view .account-hero .avatar__photo').count() == 0 and '🦉' in page.inner_text('.social-profile-view .account-hero'),
                f'{t} image illisible : l\'emoji reste')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_droit(bench, eng, dev, theme):
    t = tag(dev, theme)
    locked = "access.state = cleanAccess({ status: 'none', paywall_on: true, can_write: false, gift: false, coach_team: false, server_now: Date.now() }); window.__st = { paywallOn: true };"
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page)
        page.evaluate(locked)
        page.evaluate("navigate('account')")
        page.wait_for_selector('[data-action="pph-open"]')
        page.click('[data-action="pph-open"]')
        page.wait_for_selector('.pay-view', timeout=5000)
        R.check(page.locator('.sheet .pph-sheet').count() == 0, f'{t} verrou allumé, sans abonnement : écran d\'abonnement')
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page)
        page.evaluate("async () => { __sb.makeCoach(__sb.meId()); await coachRefresh(); }")
        page.evaluate(locked)
        page.evaluate("navigate('account')")
        page.wait_for_selector('[data-action="pph-open"]')
        R.check('Pro' not in page.inner_text('[data-action="pph-open"]'), f'{t} coach : pas de mention Pro')
        page.click('[data-action="pph-open"]')
        page.wait_for_selector('.sheet [data-action="pph-pick"]', timeout=5000)
        R.check('Offerte aux coachs' in page.inner_text('.sheet .pph-sheet'), f'{t} coach : photo offerte, feuille ouverte')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_serveur_ancien(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, fail='missing')
        ids = page.evaluate("() => { const lea = __sb.addPerson({ username: 'lea', avatar: '🦊' }); __sb.follow(__sb.meId(), lea); return { lea }; }")
        page.evaluate("navigate('account')")
        page.wait_for_selector('.account-view')
        page.wait_for_timeout(500)
        R.check(page.locator('[data-action="pph-open"]').count() == 0, f'{t} serveur ancien : pas de cellule')
        R.check('Tes amis voient ton pseudo et ton avatar' in page.inner_text('.account-view'), f'{t} serveur ancien : texte d\'avant')
        page.evaluate(f"navigate(makeRoute('social-profile', '{ids['lea']}'))")
        page.wait_for_selector('.social-profile-view')
        page.wait_for_timeout(500)
        asked = page.evaluate("__sb.calls.filter(c => c[0] === 'pphoto').map(c => c[1])")
        R.check('profile_photos' not in asked, f'{t} serveur ancien : aucune demande des photos des autres ({asked})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_compte_envoi_retrait, t_vu_par_ami, t_droit, t_serveur_ancien])
