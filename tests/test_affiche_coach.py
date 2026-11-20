"""Affiche du coach et photo de profil des comptes qui ont un accès (docs/AFFICHE_COACH.md, app iOS simulée, faux serveur
de tests/fake_account.py, faux StoreKit de tests/fake_store.py) :
- coach validé sans photo : « Mon affiche de coach » dans Mes élèves › Invitations et dans Réglages › Coach ; aperçu avec
  ses initiales ; « Ajouter ta photo de profil » ouvre la feuille de la photo, puis l'aperçu revient avec la photo ;
  nom écrit, trois mises en page, story et carré ; « Partager » remet une image PNG de 1080 × 1920 ou 1080 × 1080 à la
  feuille de partage d'iOS, sans rien envoyer au serveur ;
- élève : aucune entrée « Mon affiche », ni dans Mon coach ni dans Réglages › Coach ;
- photo de profil, verrou payant allumé : abonné, coach (sans abonnement) et élève couvert par l'offre de son coach la
  mettent ; le coach voit celle de son élève dans Mes élèves, l'élève celle de son coach dans Mon coach ; un compte sans
  accès voit l'écran d'abonnement.
Images générées (aucune photo de personne). Horloge figée au vendredi 20 novembre 2026.
Captures : $PPL_SCRATCH/shots/lotaffiche/. PPL_AFFICHES=<dossier> : y écrit aussi les PNG des affiches générées.
Lancer : PPL_URL=http://127.0.0.1:8779/ PPL_DEV="iPhone 13" python3 tests/test_affiche_coach.py
"""
import base64
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT
from fake_store import FAKE_STORE
from PIL import Image, ImageDraw

LOT = 'affiche'
R = Results(LOT)
NOW = local_ms(2026, 11, 20, 10, tz=PARIS)
AFFICHES = os.environ.get('PPL_AFFICHES')

# Faux partage d'iOS : garde le nom et l'image reçus (la vraie feuille s'ouvrirait)
FAKE_SHARE = """() => { window.__shared = [];
  Native.shareImage = async (dataUrl, name) => { window.__shared.push({ name, dataUrl }); return 'shared'; }; }"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def portrait_jpeg(name, bg=(52, 78, 110), fg=(226, 196, 160)):
    """Portrait factice dessiné (tête ronde et épaules, aucune personne réelle), 1600 × 1200, JPEG."""
    os.makedirs(SCRATCH, exist_ok=True)
    path = os.path.join(SCRATCH, name)
    w, h = 1600, 1200
    img = Image.new('RGB', (w, h), bg)
    d = ImageDraw.Draw(img)
    d.ellipse([w // 2 - 420, h - 330, w // 2 + 420, h + 500], fill=(30, 34, 40))       # épaules
    d.ellipse([w // 2 - 200, 230, w // 2 + 200, 690], fill=fg)                         # tête
    d.ellipse([w // 2 - 215, 190, w // 2 + 215, 420], fill=(60, 44, 36))               # cheveux
    img.save(path, quality=90)
    return path


def portrait_b64(bg, fg):
    p = portrait_jpeg(f'portrait-{bg[0]}.jpg', bg, fg)
    im = Image.open(p).convert('RGB')
    side = min(im.size)
    im = im.crop(((im.width - side) // 2, 0, (im.width + side) // 2, side)).resize((512, 512))
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=82)
    return base64.b64encode(buf.getvalue()).decode()


def open_app(page, theme, store=None):
    opts = 'window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True})
    if store is not None:
        opts += ' window.__stOpts = %s;' % json.dumps(store)
    page.add_init_script(opts)
    page.add_init_script(FAKE_ACCOUNT)
    if store is not None:
        page.add_init_script(FAKE_STORE)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'})
    settle(page)


def signin(page, username):
    page.evaluate("""async u => { await accountSignInWith('apple', async () => 'add');
        await accountSaveProfile({ username: u, avatar: '🦁' }); await socialEnable(true); }""", username)
    settle(page)


def small_targets(page, sel='#app button, .sheet button, .sheet input'):
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
    R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page)
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')


def toast(page):
    return page.locator('.toast').last.inner_text() if page.locator('.toast').count() else ''


def preview_ready(page):
    page.wait_for_selector('.sheet .share-preview .cposter-form', timeout=20000)
    page.wait_for_function("() => !!(shareState && shareState.blob)", timeout=20000)


def canvas_png(page):
    url = page.evaluate("document.querySelector('.sheet .share-preview__img').toDataURL('image/png')")
    return Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1])))


def save_affiche(page, name):
    if not AFFICHES:
        return
    os.makedirs(AFFICHES, exist_ok=True)
    canvas_png(page).save(os.path.join(AFFICHES, name + '.png'))


PREVIEW_SEEN = """() => { const f = document.querySelector('.sheet .share-preview__frame').getBoundingClientRect();
    const bar = document.querySelector('.sheet .share-preview__actionbar').getBoundingClientRect();
    const body = document.querySelector('.sheet .sheet__body').getBoundingClientRect();
    return f.height >= 100 && f.top >= body.top - 1 && f.bottom <= bar.top + 1; }"""


def send_visible(page):
    """Aperçu entier fixé en haut, « Partager » dans la barre fixée en bas, visibles sans défiler ; défilé jusqu'au bout,
    l'aperçu reste en haut et le dernier réglage s'arrête au-dessus de la barre (rien de recouvert)."""
    settle(page)
    page.evaluate("document.querySelector('.sheet .sheet__body').scrollTop = 0")
    ok_top = page.evaluate(PREVIEW_SEEN) and page.evaluate("""() => { const b = document.querySelector('.sheet .share-preview__send').getBoundingClientRect();
        return b.bottom <= innerHeight + 0.5 && b.top >= 0; }""")
    page.evaluate("document.querySelector('.sheet .sheet__body').scrollTop = 1e6")
    page.wait_for_timeout(150)
    ok_end = page.evaluate(PREVIEW_SEEN) and page.evaluate("""() => { const bar = document.querySelector('.sheet .share-preview__actionbar').getBoundingClientRect();
        const last = document.querySelector('.sheet .cposter-form').getBoundingClientRect();
        return last.bottom <= bar.top + 0.5 && bar.bottom <= innerHeight + 0.5; }""")
    page.evaluate("document.querySelector('.sheet .sheet__body').scrollTop = 0")
    return ok_top and ok_end


def tap(page, sel):
    """Toucher un réglage de l'aperçu : amené au milieu de la feuille (entre l'aperçu fixé en haut et la barre fixée
    en bas), comme un doigt qui fait défiler, puis touché."""
    page.evaluate("s => document.querySelector(s).scrollIntoView({ block: 'center' })", sel)
    page.wait_for_timeout(120)
    page.click(sel)


def pick_seg(page, action, value):
    tap(page, f'.sheet [data-action="{action}"][data-v="{value}"]')
    page.wait_for_function("([a, v]) => document.querySelector(`.sheet [data-action='${a}'][data-v='${v}']`).getAttribute('aria-pressed') === 'true'", arg=[action, value])
    preview_ready(page)


def athlete_jpeg(name, side=2400):
    """Grande photo factice (portrait dessiné de portrait_jpeg, aucune personne réelle), 2400 px de côté : vérifie la
    réduction à 2048 px de la photo gardée pour l'affiche."""
    path = os.path.join(SCRATCH, name)
    Image.open(portrait_jpeg('base-' + name)).resize((side, side)).save(path, quality=88)
    return path


def pick_format(page, f):
    tap(page, f'.sheet [data-action="share-format"][data-f="{f}"]')
    preview_ready(page)


def poster_photo_dims(page):
    """Photo de l'affiche gardée sur l'appareil (IndexedDB) : [largeur, hauteur], ou None."""
    return page.evaluate("""async () => { const b = await posterPhotoLoad(__sb.meId()); if (!b) return null;
        const i = await new Promise(r => { const x = new Image(); x.onload = () => r(x); x.src = URL.createObjectURL(b); }); return [i.naturalWidth, i.naturalHeight]; }""")


def t_coach_affiche(bench, eng, dev, theme):
    t = tag(dev, theme)
    src = athlete_jpeg('athlete.jpg')
    dump = AFFICHES and dev == 'iPhone 13'
    th = 'sombre' if theme == 'dark' else 'clair'
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'camille_coach')
        page.evaluate(FAKE_SHARE)
        page.evaluate("async () => { __sb.makeCoach(__sb.meId()); await coachRefresh(); await coachProRefresh({ minAge: 0 }); await coachCardDeclare('04912ED0123'); }")
        me = page.evaluate('__sb.meId()')

        # Entrée dans Mes élèves › Invitations
        page.evaluate("navigate('coach-students')")
        page.wait_for_selector('[data-action="coach-poster-open"]', timeout=8000)
        cell = page.inner_text('[data-action="coach-poster-open"]')
        R.check('Mon affiche de coach' in cell and 'story' in cell, f'{t} Mes élèves : cellule « Mon affiche de coach » ({cell!r})')
        page.locator('[data-action="coach-poster-open"]').scroll_into_view_if_needed()
        layout(page, t, 'Mes élèves')
        shot(page, LOT, f'01-mes-eleves-{t}')

        # Sans photo : le personnage aux muscles rouges
        page.click('[data-action="coach-poster-open"]')
        preview_ready(page)
        alt = page.get_attribute('.sheet .share-preview__img', 'aria-label')
        code = page.evaluate('formatCoachCode(coachPro.code)')
        R.check('Nouveau coach' in alt and '@camille_coach' in alt and code in alt and 'Carte pro déclarée' in alt, f'{t} aperçu : titre, pseudo, code, badge ({alt!r})')
        R.check(page.evaluate("cposter && cposter.photo === null && !!cposter.body && cposter.silhouette === 'male'"),
                f'{t} sans photo : personnage homme (réglage du compte)')
        R.check(page.evaluate("document.fonts.check('100px \"MDLF Anton\"')"), f'{t} police Anton chargée')
        R.check(send_visible(page), f'{t} aperçu fixé en haut, « Partager » fixé en bas, rien de recouvert')
        # Un toucher sur l'aperçu l'ouvre en plein écran, un autre le ferme
        page.locator('.sheet .share-preview__zoom').scroll_into_view_if_needed()
        page.click('.sheet .share-preview__zoom')
        page.wait_for_selector('.share-zoom .share-zoom__img', timeout=5000)
        R.check(page.evaluate("document.querySelector('.share-zoom__img').naturalHeight === 1920"), f'{t} plein écran : l\'image entière')
        page.click('.share-zoom')
        page.wait_for_function("() => !document.querySelector('.share-zoom')", timeout=5000)
        # Sans nom : « Partager » grisé, la barre dit pourquoi
        R.check(page.evaluate("document.querySelector('.sheet .share-preview__send').disabled") and page.is_visible('.sheet .share-preview__note')
                and 'Ajoute ton prénom pour partager' in page.inner_text('.sheet .share-preview__note'), f'{t} sans nom : partage grisé, « Ajoute ton prénom »')
        R.check(page.locator('.sheet .share-preview__help').count() == 0, f'{t} plus d\'aide « sticker lien » (pas encore sur l\'App Store)')
        layout(page, t, 'Aperçu sans photo')
        shot(page, LOT, f'02-apercu-sans-photo-{t}')
        if dump:
            save_affiche(page, f'sans-photo-story-{th}')

        # Photo de l'affiche choisie ici : gardée sur l'iPhone (2048 px au plus), rien d'envoyé
        sent = page.evaluate('__sb.pp.photos.length')
        with page.expect_file_chooser() as fc:
            tap(page, '.sheet [data-action="coach-poster-photo"]')
        fc.value.set_files(src)
        page.wait_for_function("() => !!(cposter && cposter.photo)", timeout=8000)
        preview_ready(page)
        R.check(page.inner_text('.sheet [data-action="coach-poster-photo"]').strip().startswith('Photo') and 'Changer' in page.inner_text('.sheet [data-action="coach-poster-photo"]'), f'{t} photo de l\'affiche : « Changer »')
        R.check(poster_photo_dims(page) == [2048, 2048], f'{t} photo d\'origine gardée sur l\'appareil, réduite à 2048 px ({poster_photo_dims(page)})')
        R.check(page.evaluate('__sb.pp.photos.length') == sent, f'{t} photo de l\'affiche jamais envoyée')

        # Nom, accord au féminin
        page.evaluate("document.querySelector('#cposterName').scrollIntoView({ block: 'center' })")
        page.fill('#cposterName', 'Camille Martin')
        page.wait_for_function("() => (document.querySelector('.sheet .share-preview__img').getAttribute('aria-label') || '').includes('Camille Martin')", timeout=5000)
        preview_ready(page)
        R.check(json.loads(ls(page, 'mdlf_coach_poster') or '{}').get('name') == 'Camille Martin', f'{t} nom gardé sur l\'appareil')
        page.wait_for_function("() => !document.querySelector('.sheet .share-preview__send').disabled", timeout=8000)
        R.check(not page.is_visible('.sheet .share-preview__note'), f'{t} nom écrit : partage possible')
        page.evaluate("document.querySelector('#cposterSpecialty').scrollIntoView({ block: 'center' })")
        page.fill('#cposterSpecialty', 'Force · Perte de poids')
        page.wait_for_function("() => (document.querySelector('.sheet .share-preview__img').getAttribute('aria-label') || '').includes('Force · Perte de poids')", timeout=5000)
        preview_ready(page)
        layout(page, t, 'Aperçu avec photo')
        shot(page, LOT, f'03-apercu-photo-{t}')
        if dump:
            save_affiche(page, f'homme-story-{th}')
        # Silhouette femme : personnage femme, « Nouvelle coach » ; titre « Coach » seul au choix
        pick_seg(page, 'coach-poster-silhouette', 'female')
        R.check('Nouvelle coach' in page.get_attribute('.sheet .share-preview__img', 'aria-label') and page.inner_text('.sheet [data-action="coach-poster-title"][data-v="gendered"]') == 'Nouvelle coach',
                f'{t} silhouette femme : « Nouvelle coach »')
        R.check(page.evaluate("!!cposter.bodies.female && cposter.body !== null"), f'{t} silhouette femme : personnage femme chargé')
        shot(page, LOT, f'04-apercu-femme-{t}')
        if dump:
            save_affiche(page, f'femme-story-{th}')
        pick_seg(page, 'coach-poster-title', 'neutral')
        R.check(page.get_attribute('.sheet .share-preview__img', 'aria-label').startswith('Affiche « Coach »'), f'{t} titre « Coach » seul')
        R.check(json.loads(ls(page, 'mdlf_coach_poster') or '{}') == {'uid': me, 'name': 'Camille Martin', 'specialty': 'Force · Perte de poids', 'silhouette': 'female', 'neutral': True},
                f'{t} réglages gardés sur l\'appareil ({ls(page, "mdlf_coach_poster")})')
        pick_seg(page, 'coach-poster-title', 'gendered')
        pick_seg(page, 'coach-poster-silhouette', 'male')
        pick_format(page, 'square')
        img = canvas_png(page)
        R.check(img.size == (1080, 1080), f'{t} carré : 1080 × 1080 ({img.size})')
        R.check(send_visible(page), f'{t} carré : « Partager » visible sans défiler, rien de recouvert')
        shot(page, LOT, f'05-apercu-carre-{t}')
        if dump:
            save_affiche(page, f'photo-carre-{th}')

        # Partager : l'image part vers la feuille d'iOS, rien vers le serveur
        before = page.evaluate('__sb.calls.length')
        page.click('.sheet [data-action="share-story-send"]')
        page.wait_for_function('() => window.__shared.length === 1', timeout=8000)
        settle(page)
        sh = page.evaluate('window.__shared[0]')
        png = Image.open(io.BytesIO(base64.b64decode(sh['dataUrl'].split(',', 1)[1])))
        R.check(sh['name'] == 'affiche-coach-carre.png' and png.size == (1080, 1080), f'{t} partage : {sh["name"]} {png.size}')
        # Rien d'envoyé : aucun appel d'écriture (une relecture de fond du compte peut tomber pendant le partage)
        sent = page.evaluate("b => __sb.calls.slice(b).map(c => c.map(String).join(' ')).filter(c => /upload|prepare|commit|insert|upsert|send|post|share/i.test(c))", before)
        R.check(not sent, f'{t} partage : rien envoyé au serveur ({sent})')
        R.check(page.locator('.sheet .share-preview').count() == 0, f'{t} partage fait : aperçu refermé')

        # Réouverture : nom et photo retrouvés ; story partagée en 1080 × 1920
        page.click('[data-action="coach-poster-open"]')
        preview_ready(page)
        R.check(page.input_value('#cposterName') == 'Camille Martin' and page.evaluate('!!cposter.photo'), f'{t} nom et photo retrouvés')
        pick_format(page, 'story')
        page.click('.sheet [data-action="share-story-send"]')
        page.wait_for_function('() => window.__shared.length === 2', timeout=8000)
        sh = page.evaluate('window.__shared[1]')
        png = Image.open(io.BytesIO(base64.b64decode(sh['dataUrl'].split(',', 1)[1])))
        R.check(sh['name'] == 'affiche-coach.png' and png.size == (1080, 1920), f'{t} story : {sh["name"]} {png.size}')

        # Photo de profil mise par le coach : son image d'origine gardée pour l'affiche ; retirée, la copie part aussi
        page.evaluate('posterPhotoClear(__sb.meId())')
        page.evaluate("navigate('account')")
        page.wait_for_selector('[data-action="pph-open"]', timeout=8000)
        page.click('[data-action="pph-open"]')
        page.wait_for_selector('.sheet .pph-sheet [data-action="pph-pick"]', timeout=8000)
        with page.expect_file_chooser() as fc:
            page.click('.sheet [data-action="pph-pick"]')
        fc.value.set_files(portrait_jpeg('profil-coach.jpg'))
        page.wait_for_selector('.sheet .pph-preview__img')
        page.click('.sheet [data-action="pph-use"]')
        page.wait_for_function("() => !document.querySelector('.sheet .pph-sheet')", timeout=10000)
        page.wait_for_function("async () => !!(await posterPhotoLoad(__sb.meId()))", timeout=8000)
        R.check(poster_photo_dims(page) == [1600, 1200], f'{t} photo de profil : image d\'origine gardée pour l\'affiche ({poster_photo_dims(page)})')
        R.check(page.evaluate("me => __sb.pp.photos.some(p => p.user === me && p.state === 'ready')", me), f'{t} photo de profil envoyée (512 px)')
        page.click('[data-action="pph-open"]')
        page.wait_for_selector('.sheet [data-action="pph-remove"]')
        page.click('.sheet [data-action="pph-remove"]')
        tap_dialog(page, 'Retirer')
        page.wait_for_function("() => !document.querySelector('.sheet .pph-sheet')", timeout=10000)
        page.wait_for_function("async () => !(await posterPhotoLoad(__sb.meId()))", timeout=8000)
        R.check(poster_photo_dims(page) is None, f'{t} photo retirée : sa copie pour l\'affiche aussi')

        # Réglages › Coach : la même entrée, sous le code
        page.evaluate("navigate('coach')")
        page.wait_for_selector('[data-action="coach-poster-open"]', timeout=8000)
        page.locator('[data-action="coach-poster-open"]').scroll_into_view_if_needed()
        layout(page, t, 'Réglages › Coach')
        shot(page, LOT, f'06-reglages-coach-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_apercu_grand_texte(bench, eng, dev, theme):
    """Très grand texte (AX33, 33 px) sur iPhone SE : l'aperçu reste visible pendant qu'on touche Silhouette et Titre."""
    if dev != 'iPhone SE':
        return
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        page.add_init_script("""(() => { const st = document.createElement('style'); st.textContent = 'html { font: 33px -apple-system, system-ui, sans-serif !important; }';
            document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st)); })()""")
        open_app(page, theme)
        page.evaluate("checkTypeSize()")
        R.check(page.evaluate("document.documentElement.classList.contains('type-xl')"), f'{t} AX33 : très grand texte')
        signin(page, 'camille_coach')
        page.evaluate("async () => { __sb.makeCoach(__sb.meId()); await coachRefresh(); await coachProRefresh({ minAge: 0 }); }")
        page.evaluate("navigate('coach-students')")
        page.wait_for_selector('[data-action="coach-poster-open"]', timeout=8000)
        page.locator('[data-action="coach-poster-open"]').scroll_into_view_if_needed()
        page.click('[data-action="coach-poster-open"]')
        preview_ready(page)
        for action, value in (('coach-poster-silhouette', 'female'), ('coach-poster-title', 'neutral')):
            sel = f'.sheet [data-action="{action}"][data-v="{value}"]'
            page.evaluate("s => document.querySelector(s).scrollIntoView({ block: 'center' })", sel)
            settle(page)
            seen = page.evaluate(PREVIEW_SEEN)
            hit = page.evaluate("""s => { const e = document.querySelector(s), r = e.getBoundingClientRect();
                const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && e.contains(t); }""", sel)
            R.check(seen and hit, f'{t} AX33 : « {value} » touchable et aperçu visible en même temps')
            page.click(sel)
            preview_ready(page)
            R.check(page.evaluate(PREVIEW_SEEN), f'{t} AX33 : aperçu visible après le choix « {value} »')
        R.check(page.get_attribute('.sheet .share-preview__img', 'aria-label').startswith('Affiche « Coach »'), f'{t} AX33 : aperçu redessiné')
        b = page.evaluate("() => { const b = document.querySelector('.sheet .share-preview__send').getBoundingClientRect(); return b.bottom <= innerHeight + 0.5 && b.top >= 0; }")
        R.check(b, f'{t} AX33 : « Partager » visible sans défiler')
        R.check(not page.errors, f'{t} AX33 : aucune erreur JS {page.errors}')


def t_eleve_sans_affiche(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'lea')
        page.evaluate("""async () => { const c = __sb.addPerson({ username: 'camille_coach', avatar: '🦁', social: false }); __sb.makeCoach(c);
            __sb.link(c, __sb.meId(), Date.now() - 3 * 86400000); await coachRefresh(); }""")
        page.evaluate("routeTo('friends'); navigate('coach-mine')")
        page.wait_for_selector('.coach-mine-view', timeout=8000)
        settle(page)
        R.check(page.locator('[data-action="coach-poster-open"]').count() == 0, f'{t} élève : pas d\'affiche dans Mon coach')
        page.evaluate("navigate('coach')")
        page.wait_for_selector('.view', timeout=8000)
        settle(page)
        R.check(page.locator('[data-action="coach-poster-open"]').count() == 0, f'{t} élève : pas d\'affiche dans Réglages › Coach')
        page.evaluate('openCoachPoster()')
        settle(page)
        R.check(page.locator('.sheet .share-preview').count() == 0, f'{t} élève : l\'affiche ne s\'ouvre pas')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def photo_flow(page, t, who, free_text):
    """Réglages › Compte › Photo de profil : feuille ouverte, image choisie et envoyée."""
    page.evaluate("navigate('account')")
    page.wait_for_selector('[data-action="pph-open"]', timeout=8000)
    cell = page.inner_text('[data-action="pph-open"]')
    page.click('[data-action="pph-open"]')
    page.wait_for_selector('.sheet .pph-sheet [data-action="pph-pick"]', timeout=8000)
    txt = page.inner_text('.sheet .pph-sheet')
    R.check(free_text in txt, f'{t} {who} : feuille ouverte, « {free_text} » ({txt[-140:]!r})')
    R.check(('Pro' in cell) == (free_text == 'Comprise dans MDLF Pro'), f'{t} {who} : mention Pro ({cell!r})')
    with page.expect_file_chooser() as fc:
        page.click('.sheet [data-action="pph-pick"]')
    fc.value.set_files(portrait_jpeg(f'{who}.jpg'))
    page.wait_for_selector('.sheet .pph-preview__img')
    page.click('.sheet [data-action="pph-use"]')
    page.wait_for_function("() => !document.querySelector('.sheet .pph-sheet')", timeout=10000)
    settle(page)
    R.check('Photo de profil enregistrée' in toast(page), f'{t} {who} : photo enregistrée ({toast(page)!r})')


def has_photo(page, uid, scope=''):
    return page.evaluate("""([u, s]) => [...document.querySelectorAll(`${s} [data-pph="${u}"] .avatar__photo`)].some(i => i.complete && i.naturalWidth > 0)""", [uid, scope])


def t_photo_trois_acces(bench, eng, dev, theme):
    t = tag(dev, theme)
    store = {'paywallOn': True}
    coach_b64 = portrait_b64((120, 70, 50), (220, 190, 150))
    eleve_b64 = portrait_b64((60, 100, 80), (230, 200, 170))
    # 1. Abonné (payé lui-même)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, store)
        signin(page, 'paul')
        page.evaluate("async () => { __st.subscribe('com.mdlf.training.pro.yearly', 300); access.loadedAt = 0; await accessRefresh(); }")
        photo_flow(page, t, 'abonné', 'Comprise dans MDLF Pro')
        R.check(not page.errors, f'{t} abonné : aucune erreur JS {page.errors}')
    # 2. Coach (rôle validé, sans abonnement) : voit la photo de son élève dans Mes élèves
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, store)
        signin(page, 'camille_coach')
        sid = page.evaluate("""async b64 => { const me = __sb.meId(); __sb.makeCoach(me);
            const s = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false }); __sb.link(me, s, Date.now() - 5 * 86400000);
            __sb.pp.pro[s] = true; __sb.setPhoto(s, b64, 'image/jpeg'); access.loadedAt = 0; await accessRefresh(); await coachRefresh(); return s; }""", eleve_b64)
        photo_flow(page, t, 'coach', 'Offerte aux coachs')
        page.evaluate("navigate('coach-students')")
        page.wait_for_selector(f'[data-pph="{sid}"]', timeout=8000)
        page.wait_for_function("u => [...document.querySelectorAll(`[data-pph=\"${u}\"] .avatar__photo`)].some(i => i.naturalWidth > 0)", arg=sid, timeout=8000)
        R.check(has_photo(page, sid), f'{t} coach : photo de l\'élève dans Mes élèves')
        shot(page, LOT, f'08-mes-eleves-photo-{t}')
        R.check(not page.errors, f'{t} coach : aucune erreur JS {page.errors}')
    # 3. Élève couvert par l'offre de son coach : met sa photo, voit celle de son coach dans Mon coach
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, store)
        signin(page, 'lea')
        cid = page.evaluate("""async b64 => { const c = __sb.addPerson({ username: 'camille_coach', avatar: '🦁', social: false }); __sb.makeCoach(c);
            __sb.link(c, __sb.meId(), Date.now() - 5 * 86400000); __sb.setPhoto(c, b64, 'image/jpeg'); __st.setCover('active', { coach: c });
            access.loadedAt = 0; await accessRefresh(); await coachRefresh(); return c; }""", coach_b64)
        R.check(page.evaluate("accessStatus()") == 'coach_team', f'{t} élève : couvert par son coach')
        photo_flow(page, t, 'élève couvert', 'Offerte par ton coach')
        page.evaluate("routeTo('friends'); navigate('coach-mine')")
        page.wait_for_selector(f'.coach-mine-view [data-pph="{cid}"]', timeout=8000)
        page.wait_for_function("u => [...document.querySelectorAll(`.coach-mine-view [data-pph=\"${u}\"] .avatar__photo`)].some(i => i.naturalWidth > 0)", arg=cid, timeout=8000)
        R.check(has_photo(page, cid, '.coach-mine-view'), f'{t} élève : photo du coach dans Mon coach')
        R.check(page.locator('[data-action="coach-poster-open"]').count() == 0, f'{t} élève : pas d\'affiche')
        shot(page, LOT, f'09-mon-coach-photo-{t}')
        R.check(not page.errors, f'{t} élève : aucune erreur JS {page.errors}')
    # 4. Sans accès (verrou allumé, ni abonné, ni coach, ni couvert) : écran d'abonnement
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, store)
        signin(page, 'zoe')
        page.evaluate("async () => { access.loadedAt = 0; await accessRefresh(); }")
        page.evaluate("navigate('account')")
        page.wait_for_selector('[data-action="pph-open"]', timeout=8000)
        page.click('[data-action="pph-open"]')
        page.wait_for_selector('.pay-view', timeout=8000)
        R.check(page.locator('.sheet .pph-sheet').count() == 0, f'{t} sans accès : écran d\'abonnement')
        R.check(not page.errors, f'{t} sans accès : aucune erreur JS {page.errors}')


run_main(R, [t_coach_affiche, t_apercu_grand_texte, t_eleve_sans_affiche, t_photo_trois_acces])
