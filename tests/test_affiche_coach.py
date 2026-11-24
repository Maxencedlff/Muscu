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


NOTE_ABOVE_SEND = """() => { const n = document.querySelector('.sheet .share-preview__note').getBoundingClientRect();
    const b = document.querySelector('.sheet .share-preview__send').getBoundingClientRect();
    return n.height > 0 && n.bottom <= b.top + 1 && n.top >= 0; }"""

HIT = """s => { const e = document.querySelector(s), r = e.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (e === t || e.contains(t)); }"""


def note_link(page, t):
    """« Ajoute ton nom… » touché : amène au champ Nom, entre l'aperçu et la barre fixés, et l'active."""
    page.evaluate("document.querySelector('.sheet .sheet__body').scrollTop = 1e6")
    page.wait_for_timeout(120)
    page.click('.sheet .share-preview__note-link')
    page.wait_for_timeout(200)
    R.check(page.evaluate("document.activeElement && document.activeElement.id === 'cposterName'") and page.evaluate(HIT, '#cposterName'),
            f'{t} note touchée : champ Nom visible et activé')
    page.evaluate("document.activeElement && document.activeElement.blur()")


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
        code_fits(page, t, 'Mes élèves › Invitations', one_line=True)
        page.locator('[data-action="coach-poster-open"]').scroll_into_view_if_needed()
        layout(page, t, 'Mes élèves')
        shot(page, LOT, f'01-mes-eleves-{t}')

        # Sans photo : le personnage aux muscles rouges
        page.click('[data-action="coach-poster-open"]')
        preview_ready(page)
        alt = page.get_attribute('.sheet .share-preview__img', 'aria-label')
        code = page.evaluate('formatCoachCode(coachPro.code)')
        R.check('Nouveau coach' in alt and code in alt and '@camille_coach' not in alt and 'Carte pro' not in alt, f'{t} aperçu : titre et code, ni pseudo ni badge, comme l\'image ({alt!r})')
        R.check(page.evaluate("cposter && cposter.photo === null && !!cposter.body && cposter.silhouette === 'male'"),
                f'{t} sans photo : personnage homme (réglage du compte)')
        R.check(page.evaluate("document.fonts.check('100px \"MDLF Anton\"')"), f'{t} police Anton chargée')
        R.check(send_visible(page), f'{t} aperçu fixé en haut, « Partager » fixé en bas, rien de recouvert')
        # 7e panel : Nom et Silhouette entiers entre l'aperçu et la barre, sans défiler ; pastille « agrandir » sur l'aperçu
        whole = page.evaluate("""() => { document.querySelector('.sheet .sheet__body').scrollTop = 0;
            const top = document.querySelector('.sheet .share-preview__top').getBoundingClientRect().bottom;
            const bar = document.querySelector('.sheet .share-preview__actionbar').getBoundingClientRect().top;
            return [...document.querySelectorAll('.sheet .cposter-row')].slice(0, 2).every(r => { const b = r.getBoundingClientRect(); return b.top >= top - 1 && b.bottom <= bar + 1; }); }""")
        R.check(whole, f'{t} Nom et Silhouette entiers sans défiler')
        # 8e panel : « Voir en grand », vrai bouton sous l'aperçu (44 pt), rien posé sur l'image ; VoiceOver lit la description
        # complète de l'image puis ce que fait le toucher
        sb = page.evaluate("(() => { const b = document.querySelector('.sheet .share-preview__seebig').getBoundingClientRect(), f = document.querySelector('.sheet .share-preview__zoom').getBoundingClientRect(); return { h: b.height, below: b.left >= f.right - 1 || b.top >= f.bottom - 1, alone: document.querySelector('.sheet .share-preview__zoom').children.length === 1 }; })()")
        R.check(sb['h'] >= 44 and sb['below'] and sb['alone'], f'{t} « Voir en grand » à côté de l\'aperçu, rien sur l\'image ({sb})')
        zl = page.get_attribute('.sheet .share-preview__zoom', 'aria-label')
        R.check(zl.startswith(page.get_attribute('.sheet .share-preview__img', 'aria-label').rstrip('.')) and zl.endswith('Touche deux fois pour voir en grand.') and code in zl,
                f'{t} VoiceOver : description complète puis « Touche deux fois pour voir en grand » ({zl!r})')
        page.click('.sheet .share-preview__seebig')
        page.wait_for_selector('.share-zoom .share-zoom__img', timeout=5000)
        page.click('.share-zoom')
        page.wait_for_function("() => !document.querySelector('.share-zoom')", timeout=5000)
        R.check(page.evaluate("(() => { const c = document.querySelector('.sheet .share-preview__img'); return c.getAttribute('aria-label').includes('Affiche'); })()"), f'{t} aperçu sans nom ni photo dessiné')
        # Un toucher sur l'aperçu l'ouvre en plein écran, un autre le ferme
        page.locator('.sheet .share-preview__zoom').scroll_into_view_if_needed()
        page.click('.sheet .share-preview__zoom')
        page.wait_for_selector('.share-zoom .share-zoom__img', timeout=5000)
        R.check(page.evaluate("document.querySelector('.share-zoom__img').naturalHeight === 1920"), f'{t} plein écran : l\'image entière')
        page.click('.share-zoom')
        page.wait_for_function("() => !document.querySelector('.share-zoom')", timeout=5000)
        # Sans nom : « Partager » grisé, la barre dit pourquoi ; Nom en premier ; la note est un lien vers le champ
        R.check(page.evaluate("document.querySelector('.sheet .share-preview__send').disabled") and page.is_visible('.sheet .share-preview__note')
                and 'Ajoute ton nom pour partager' in page.inner_text('.sheet .share-preview__note'), f'{t} sans nom : partage grisé, « Ajoute ton nom »')
        R.check(page.evaluate("!!document.querySelector('.sheet .cposter-form > .cposter-row:first-child #cposterName')"), f'{t} Nom en premier réglage')
        R.check(page.get_attribute('.sheet [data-action="coach-poster-photo"]', 'aria-label') == "Photo de l'affiche : aucune, choisir", f'{t} VoiceOver : photo de l\'affiche, aucune')
        R.check(page.evaluate(NOTE_ABOVE_SEND), f'{t} note au-dessus de « Partager »')
        note_link(page, t)
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
        R.check(page.get_attribute('.sheet [data-action="coach-poster-photo"]', 'aria-label') == "Photo de l'affiche : choisie, changer", f'{t} VoiceOver : photo de l\'affiche, choisie')
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
        page.fill('#cposterSpecialty', 'Force · Perte de poids · Rééducation du dos')
        page.wait_for_timeout(100)
        R.check(page.evaluate("(() => { const a = document.querySelector('#cposterSpecialty'); return a.scrollHeight <= a.clientHeight + 1 && a.scrollWidth <= a.clientWidth + 1; })()"),
                f'{t} spécialité longue : entière, sur plusieurs lignes au besoin')
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
        R.check(json.loads(ls(page, 'mdlf_coach_poster') or '{}') == {'uid': me, 'name': 'Camille Martin', 'specialty': 'Force · Perte de poids', 'silhouette': 'female', 'neutral': True, 'style': 'hero'},
                f'{t} réglages gardés sur l\'appareil ({ls(page, "mdlf_coach_poster")})')
        pick_seg(page, 'coach-poster-title', 'gendered')
        pick_seg(page, 'coach-poster-silhouette', 'male')
        # Style (24/11) : « Avec le bonhomme » par défaut ; « Photo seule » redessine l'aperçu tout de suite, change le
        # texte VoiceOver et reste gardé avec les autres réglages
        R.check(page.get_attribute('.sheet [data-action="coach-poster-style"][data-v="hero"]', 'aria-pressed') == 'true'
                and page.inner_text('.sheet [data-action="coach-poster-style"][data-v="hero"]') == 'Avec le bonhomme'
                and page.inner_text('.sheet [data-action="coach-poster-style"][data-v="photo"]') == 'Photo seule', f'{t} style : « Avec le bonhomme » par défaut')
        hero_png = canvas_png(page)
        pick_seg(page, 'coach-poster-style', 'photo')
        alt = page.get_attribute('.sheet .share-preview__img', 'aria-label')
        R.check(alt.startswith('Affiche « Nouveau coach » sans le personnage, ta photo en grand : Camille Martin'), f'{t} style « Photo seule » : VoiceOver ({alt})')
        photo_png = canvas_png(page)
        R.check(photo_png.size == (1080, 1920) and photo_png.convert('RGB').tobytes() != hero_png.convert('RGB').tobytes(), f'{t} style « Photo seule » : aperçu redessiné')
        R.check(json.loads(ls(page, 'mdlf_coach_poster') or '{}').get('style') == 'photo', f'{t} style gardé avec les réglages')
        shot(page, LOT, f'04b-apercu-photo-seule-{t}')
        if dump:
            save_affiche(page, f'photo-seule-story-{th}')
        pick_format(page, 'square')
        img = canvas_png(page)
        R.check(img.size == (1080, 1080), f'{t} carré : 1080 × 1080 ({img.size})')
        R.check(send_visible(page), f'{t} carré : « Partager » visible sans défiler, rien de recouvert')
        shot(page, LOT, f'05-apercu-carre-{t}')
        if dump:
            save_affiche(page, f'photo-carre-{th}')

        # Feuille de partage annulée : rien n'est envoyé, pas même le nom (audit du 21/11)
        page.evaluate("() => { window.__realShare = Native.shareImage; Native.shareImage = async () => 'cancelled'; }")
        c0 = poster_calls(page, 'coach_set_poster_name')
        page.click('.sheet [data-action="share-story-send"]')
        page.wait_for_function("() => !document.querySelector('.sheet .share-preview')", timeout=8000)
        settle(page)
        R.check(poster_calls(page, 'coach_set_poster_name') == c0, f'{t} partage annulé : nom jamais envoyé')
        page.evaluate("() => { Native.shareImage = window.__realShare; }")
        page.click('[data-action="coach-poster-open"]')
        preview_ready(page)
        pick_format(page, 'square')
        # Partager : l'image part vers la feuille d'iOS, rien vers le serveur
        before = page.evaluate('__sb.calls.length')
        page.click('.sheet [data-action="share-story-send"]')
        page.wait_for_function('() => window.__shared.length === 1', timeout=8000)
        settle(page)
        sh = page.evaluate('window.__shared[0]')
        png = Image.open(io.BytesIO(base64.b64decode(sh['dataUrl'].split(',', 1)[1])))
        R.check(sh['name'] == 'affiche-coach-carre.png' and png.size == (1080, 1080), f'{t} partage : {sh["name"]} {png.size}')
        # Rien d'envoyé : aucun appel d'écriture (une relecture de fond du compte peut tomber pendant le partage)
        # Seule écriture : le nom de l'affiche, pour Mon coach de ses élèves (dit sous les réglages) ; jamais l'image
        sent = page.evaluate("b => __sb.calls.slice(b).map(c => c.map(String).join(' ')).filter(c => /upload|prepare|commit|insert|upsert|send|post|share/i.test(c))", before)
        R.check(all('coach_set_poster_name' in c for c in sent) and len(sent) == 1, f'{t} partage : rien d\'autre que le nom envoyé ({sent})')
        page.wait_for_function("me => (__sb.co.posterNames || {})[me] === 'Camille Martin'", arg=me, timeout=8000)
        R.check(True, f'{t} partage : nom de l\'affiche envoyé pour Mon coach')
        R.check(page.locator('.sheet .share-preview').count() == 0, f'{t} partage fait : aperçu refermé')

        # Réouverture : nom et photo retrouvés ; story partagée en 1080 × 1920
        page.click('[data-action="coach-poster-open"]')
        preview_ready(page)
        R.check(page.input_value('#cposterName') == 'Camille Martin' and page.evaluate('!!cposter.photo'), f'{t} nom et photo retrouvés')
        R.check(page.get_attribute('.sheet [data-action="coach-poster-style"][data-v="photo"]', 'aria-pressed') == 'true' and page.evaluate("cposter.style === 'photo'"),
                f'{t} style « Photo seule » retrouvé à la réouverture')
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
        code_fits(page, t, 'Réglages › Coach', one_line=True)
        page.locator('[data-action="coach-poster-open"]').scroll_into_view_if_needed()
        layout(page, t, 'Réglages › Coach')
        shot(page, LOT, f'06-reglages-coach-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


CODE_FITS = """() => [...document.querySelectorAll('.coach-code-cell')].filter(c => c.offsetParent).map(c => {
    const r = c.getBoundingClientRect(), code = c.querySelector('.coach-code'), sub = c.querySelector('.cell__sub');
    const fs = parseFloat(getComputedStyle(code).fontSize), blks = [...c.querySelectorAll('.coach-code__blk')].map(b => b.getBoundingClientRect());
    const btns = [...c.querySelectorAll('button')].map(b => b.getBoundingClientRect());
    // Taille du titre d'une cellule voisine (« Mon affiche de coach »), sur le même écran
    const near = document.querySelector('[data-action="coach-poster-open"] .cell__title');
    const title = near ? parseFloat(getComputedStyle(near).fontSize) : 0, ico = c.querySelector('.coach-icon-btn .icon').getBoundingClientRect().width;
    return { text: code.textContent, fs, title, ico, blocks: blks.length, together: btns.length === 2 && Math.abs(btns[0].top - btns[1].top) < 2, oneLine: blks.every(b => Math.abs(b.top - blks[0].top) < 2),
      inside: blks.every(b => b.left >= r.left - 0.5 && b.right <= r.right + 0.5) && btns.every(b => b.right <= r.right + 0.5 && b.left >= r.left - 0.5),
      blockWhole: blks.every(b => b.height < fs * 1.7), sub: sub.scrollWidth <= sub.clientWidth + 1 && sub.getBoundingClientRect().right <= r.right + 0.5,
      noOverflow: c.scrollWidth <= c.clientWidth + 1 }; })"""


def code_fits(page, t, where, one_line=False):
    """Carte du code coach (coachCodeCellHtml) : code entier dans la carte (blocs jamais coupés), lisible (17 px au
    moins), sous-titre entier, Copier et Partager dans la carte."""
    cells = page.evaluate(CODE_FITS)
    code = page.evaluate('formatCoachCode(coachPro.code)')
    ok = len(cells) == 1 and all(c['text'] == code and c['blocks'] == 3 and c['inside'] and c['blockWhole'] and c['sub'] and c['noOverflow'] and c['together'] and c['fs'] >= 17 and (c['oneLine'] or not one_line) for c in cells)
    R.check(ok, f'{t} {where} : code coach entier{" sur une ligne" if one_line else ""} ({cells})')
    if 'AX33' in where:
        R.check(all(c['title'] > 0 and c['fs'] >= c['title'] - 0.5 and c['ico'] >= 28 for c in cells),
                f'{t} {where} : code au moins à la taille du titre de la cellule voisine, icônes qui suivent ({cells})')


def t_apercu_grand_texte(bench, eng, dev, theme):
    """Très grand texte (AX33, 33 px) sur iPhone SE : carte du code entière (Mes élèves, Réglages › Coach), aperçu
    réduit à 22 % de la hauteur, Nom, Silhouette et Titre touchables avec l'aperçu visible, note au-dessus de
    « Partager » ; feuille de la photo de profil : phrase courte, règle repliée."""
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
        settle(page)
        code_fits(page, t, 'AX33 Mes élèves › Invitations')
        shot(page, LOT, f'10-code-mes-eleves-ax33-{t}')
        page.locator('[data-action="coach-poster-open"]').scroll_into_view_if_needed()
        page.click('[data-action="coach-poster-open"]')
        preview_ready(page)
        h = page.evaluate("document.querySelector('.sheet .share-preview__zoom').getBoundingClientRect().height / innerHeight")
        R.check(h <= 0.185, f'{t} AX33 : aperçu fixé à 18 % de la hauteur ({h:.3f})')
        seen = page.evaluate("""() => { document.querySelector('.sheet .sheet__body').scrollTop = 0;
            const top = document.querySelector('.sheet .share-preview__top').getBoundingClientRect().bottom;
            const bar = document.querySelector('.sheet .share-preview__actionbar').getBoundingClientRect().top;
            return [...document.querySelectorAll('.sheet .cposter-row')].filter(r => { const b = r.getBoundingClientRect(); return b.top >= top - 1 && Math.min(b.bottom, b.top + 60) <= bar + 1; }).length; }""")
        R.check(seen >= 2, f'{t} AX33 : deux réglages au moins visibles entre l\'aperçu et la barre ({seen})')
        R.check(page.is_visible('.sheet .share-preview__note') and page.evaluate(NOTE_ABOVE_SEND) and page.inner_text('.sheet .share-preview__note').strip() == 'Ajoute ton nom',
                f'{t} AX33 : « Ajoute ton nom » (version courte) au-dessus de « Partager »')
        bar = page.evaluate("document.querySelector('.sheet .share-preview__actionbar').getBoundingClientRect().height / innerHeight")
        R.check(bar <= 0.32, f'{t} AX33 : barre fixée basse, note sur une ligne et « Partager » ({bar:.2f} de la hauteur)')
        page.evaluate("document.querySelector('#cposterName').scrollIntoView({ block: 'center' })")
        settle(page)
        R.check(page.evaluate(PREVIEW_SEEN) and page.evaluate(HIT, '#cposterName'), f'{t} AX33 : Nom touchable et aperçu visible en même temps')
        # « Nom » au-dessus de sa valeur (10e panel)
        above = page.evaluate("(() => { const r = document.querySelector('label[for=cposterName]'), l = r.querySelector('.cposter-row__title').getBoundingClientRect(), i = r.querySelector('#cposterName').getBoundingClientRect(); return l.bottom <= i.top + 1; })()")
        R.check(above, f'{t} AX33 : « Nom » au-dessus de la valeur')
        note_link(page, t + ' AX33')
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
        shot(page, LOT, f'11-apercu-ax33-{t}')
        page.click('.sheet .sheet__btn--cancel')
        page.wait_for_function("() => !document.querySelector('.sheet .share-preview')", timeout=8000)
        # Réglages › Coach : la même carte du code
        page.evaluate("navigate('coach')")
        page.wait_for_selector('.coach-code-cell', timeout=8000)
        settle(page)
        code_fits(page, t, 'AX33 Réglages › Coach')
        shot(page, LOT, f'12-code-reglages-ax33-{t}')
        # Photo de profil : une phrase courte, la règle repliée dans « Ce qui est permis »
        page.evaluate("navigate('account')")
        page.wait_for_selector('[data-action="pph-open"]', timeout=8000)
        page.click('[data-action="pph-open"]')
        page.wait_for_selector('.sheet .pph-sheet [data-action="pph-pick"]', timeout=8000)
        settle(page)
        pick = page.evaluate("(() => { const b = document.querySelector('.sheet [data-action=pph-pick]').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight + 0.5; })()")
        R.check(pick, f'{t} AX33 photo : « Choisir une photo » entier sans défiler')
        R.check(page.is_visible('.sheet .pph-scope-short') and not page.is_visible('.sheet .pph-scope-full') and not page.is_visible('.sheet .pph-rules p'),
                f'{t} AX33 photo : phrase courte, règle repliée')
        page.click('.sheet .pph-rules summary')
        R.check(page.is_visible('.sheet .pph-rules p') and 'nudité' in page.inner_text('.sheet .pph-rules p'), f'{t} AX33 photo : règle dépliée')
        shot(page, LOT, f'13-photo-ax33-{t}')
        R.check(not page.errors, f'{t} AX33 : aucune erreur JS {page.errors}')


PREVIEW_IN_WINDOW = """() => { const W = innerWidth, H = innerHeight, q = s => document.querySelector('.sheet ' + s);
    document.querySelector('.sheet .sheet__body').scrollTop = 0;
    const f = q('.share-preview__frame').getBoundingClientRect(), z = q('.share-preview__zoom'), b = q('.share-preview__seebig').getBoundingClientRect();
    const top = q('.share-preview__top').getBoundingClientRect(), row = q('.cposter-row').getBoundingClientRect();
    const inWin = r => r.left >= -0.5 && r.top >= -0.5 && r.right <= W + 0.5 && r.bottom <= H + 0.5;
    const pts = [[f.left + 4, f.top + 4], [f.right - 4, f.top + 4], [f.left + 4, f.bottom - 4], [f.right - 4, f.bottom - 4], [(f.left + f.right) / 2, (f.top + f.bottom) / 2]];
    const covered = pts.filter(([x, y]) => { const e = document.elementFromPoint(x, y); return !e || !z.contains(e); }).length;
    const apart = b.top >= f.bottom - 0.5 || b.left >= f.right - 0.5;
    return { frame: inWin(f), seebig: inWin(b), covered, apart, below: row.top >= top.bottom - 0.5, square: Math.abs(f.width - f.height) < 1.5,
      ratio: f.width / f.height, fw: Math.round(f.width), fh: Math.round(f.height) }; }"""


def t_apercu_dans_ecran(bench, eng, dev, theme):
    """Capture de l'iPhone de Maxence (23/11) : en Carré, l'aperçu débordait à gauche, « Voir en grand » sortait à droite
    et l'aperçu chevauchait la ligne « Titre ». En Story et en Carré, texte normal et très grand (AX33) : cadre de
    l'aperçu et « Voir en grand » entiers dans la fenêtre, à part l'un de l'autre, rien posé sur l'aperçu, liste dessous."""
    if dev not in ('iPhone SE', 'iPhone 13', 'iPhone 17 Pro Max'):
        return
    for big in (False, True):
        t = tag(dev, theme) + (' AX33' if big else '')
        with bench.frozen_page(NOW, eng, dev, theme) as page:
            if big:
                page.add_init_script("""(() => { const st = document.createElement('style'); st.textContent = 'html { font: 33px -apple-system, system-ui, sans-serif !important; }';
                    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st)); })()""")
            open_app(page, theme)
            if big:
                page.evaluate("checkTypeSize()")
            signin(page, 'camille_coach')
            page.evaluate("async () => { __sb.makeCoach(__sb.meId()); await coachRefresh(); await coachProRefresh({ minAge: 0 }); }")
            page.evaluate("navigate('coach-students')")
            page.wait_for_selector('[data-action="coach-poster-open"]', timeout=8000)
            page.locator('[data-action="coach-poster-open"]').scroll_into_view_if_needed()
            page.click('[data-action="coach-poster-open"]')
            preview_ready(page)
            for style in ('hero', 'photo'):
                if style == 'photo':
                    pick_seg(page, 'coach-poster-style', 'photo')
                for f in ('story', 'square'):
                    pick_format(page, f)
                    settle(page)
                    r, ts = page.evaluate(PREVIEW_IN_WINDOW), f'{t} {style} {f}'
                    R.check(r['frame'] and r['seebig'], f'{ts} : aperçu et « Voir en grand » entiers dans la fenêtre ({r})')
                    R.check(r['covered'] == 0 and r['apart'], f'{ts} : rien posé sur l\'aperçu ({r})')
                    R.check(r['below'], f'{ts} : la liste commence sous l\'aperçu ({r})')
                    R.check(r['square'] if f == 'square' else abs(r['ratio'] - 9 / 16) < 0.02, f'{ts} : proportions gardées ({r})')
                # La ligne Style entière dans la fenêtre, ses deux boutons touchables (44 pt) et jamais coupés
                st = page.evaluate("""() => [...document.querySelectorAll('.sheet [data-action="coach-poster-style"]')].map(b => { const r = b.getBoundingClientRect();
                    return { h: r.height, cut: b.scrollWidth > b.clientWidth + 1, inside: r.left >= -0.5 && r.right <= innerWidth + 0.5 }; })""")
                R.check(len(st) == 2 and all(x['inside'] and not x['cut'] and x['h'] >= 28 for x in st), f'{t} ligne Style entière ({st})')
            R.check(not page.errors, f'{t} : aucune erreur JS {page.errors}')


def t_eleve_sans_affiche(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'lea')
        page.evaluate("""async () => { const c = __sb.addPerson({ username: 'camille_coach', avatar: '🦁', social: false }); __sb.makeCoach(c);
            __sb.link(c, __sb.meId(), Date.now() - 3 * 86400000); await coachRefresh(); }""")
        # Serveur d'avant (migration du nom pas appliquée) : le pseudo seul
        page.evaluate("__sb.fail.posterName = 'missing'")
        page.evaluate("routeTo('friends'); navigate('coach-mine')")
        page.wait_for_selector('.coach-mine-view', timeout=8000)
        settle(page)
        R.check(page.inner_text('.coach-mine__who .coach-join__name') == 'camille_coach' and page.locator('.coach-mine__handle').count() == 0,
                f'{t} Mon coach, serveur d\'avant : pseudo seul')
        R.check(page.locator('[data-action="coach-poster-open"]').count() == 0, f'{t} élève : pas d\'affiche dans Mon coach')
        # Nom de l'affiche partagée : en titre, @pseudo dessous
        page.evaluate("""() => { __sb.fail.posterName = null; const c = myCoach().user_id; (__sb.co.posterNames ||= {})[c] = 'Camille Martin'; coachPosterNames.clear(); coachPosterServer = true; }""")
        page.evaluate("goBack()")
        settle(page)
        page.evaluate("navigate('coach-mine')")
        page.wait_for_function("() => (document.querySelector('.coach-mine__who .coach-join__name') || {}).textContent === 'Camille Martin'", timeout=8000)
        R.check(page.inner_text('.coach-mine__handle') == '@camille_coach', f'{t} Mon coach : nom de l\'affiche, @pseudo dessous')
        layout(page, t, 'Mon coach')
        shot(page, LOT, f'14-mon-coach-nom-{t}')
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
    page.evaluate("navigate('coach')")
    page.wait_for_timeout(150)
    R.check(page.locator('.toast').count() == 0, f'{t} {who} : le toast ne suit pas sur l\'écran suivant')
    page.evaluate("goBack()")
    settle(page)


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
        page.wait_for_selector('.sheet [data-action="pph-offer"]', timeout=8000)
        page.click('.sheet [data-action="pph-offer"]')
        page.wait_for_selector('.pay-view', timeout=8000)
        R.check(True, f'{t} sans accès : écran d\'abonnement')
        R.check(not page.errors, f'{t} sans accès : aucune erreur JS {page.errors}')


def poster_calls(page, fn):
    return page.evaluate("f => __sb.calls.filter(c => c[0] === 'coach' && c[1] === f).length", fn)


def t_sans_migration(bench, eng, dev, theme):
    """Serveur sans la migration du nom (en attente du feu vert) : partage et Mon coach marchent sans message ni erreur,
    pseudo seul ; l'envoi du nom est ignoré, retenté au partage suivant, et passe une fois la migration appliquée ;
    Mon coach ne rappelle pas la fonction absente à chaque ouverture."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        cons = []
        # Erreurs de console, et requêtes en échec hors celle des mises à jour à chaud (coupée exprès par open_app)
        page.on('console', lambda m: cons.append(m.text) if m.type == 'error' and not m.text.startswith('Failed to load resource') else None)
        page.on('requestfailed', lambda q: cons.append(q.url) if 'mdlf-ota' not in q.url else None)
        open_app(page, theme)
        signin(page, 'camille_coach')
        page.evaluate(FAKE_SHARE)
        page.evaluate("async () => { __sb.fail.posterName = 'missing'; __sb.makeCoach(__sb.meId()); await coachRefresh(); await coachProRefresh({ minAge: 0 }); }")
        me = page.evaluate('__sb.meId()')
        page.evaluate("navigate('coach-students')")
        page.wait_for_selector('[data-action="coach-poster-open"]', timeout=8000)
        for n in (1, 2):
            page.locator('[data-action="coach-poster-open"]').scroll_into_view_if_needed()
            page.click('[data-action="coach-poster-open"]')
            preview_ready(page)
            if n == 1:
                page.evaluate("document.querySelector('#cposterName').scrollIntoView({ block: 'center' })")
                page.fill('#cposterName', 'Camille Martin')
                page.wait_for_function("() => !document.querySelector('.sheet .share-preview__send').disabled", timeout=8000)
            # Sans photo (8e panel) : une question, jamais un blocage
            page.click('.sheet [data-action="share-story-send"]')
            page.wait_for_selector('.ios-dialog', timeout=5000)
            R.check('Une affiche avec ta photo inspire plus confiance.' in page.inner_text('.ios-dialog'), f'{t} sans photo, partage {n} : la question est posée')
            if n == 1:
                with page.expect_file_chooser():
                    tap_dialog(page, 'Ajouter ma photo')
                R.check(page.locator('.sheet .share-preview').count() == 1 and page.evaluate('window.__shared.length') == 0, f'{t} « Ajouter ma photo » : sélecteur ouvert, rien partagé')
                page.click('.sheet [data-action="share-story-send"]')   # question posée une fois par ouverture
            else:
                tap_dialog(page, 'Partager sans photo')
            page.wait_for_function(f'() => window.__shared.length === {n}', timeout=8000)
            page.wait_for_function(f"() => __sb.calls.filter(c => c[0] === 'coach' && c[1] === 'coach_set_poster_name').length === {n}", timeout=8000)
            settle(page)
            R.check(page.locator('.sheet .share-preview').count() == 0 and toast(page) == '', f'{t} sans migration, partage {n} : fait, aucun message ({toast(page)!r})')
        R.check(poster_calls(page, 'coach_set_poster_name') == 2, f'{t} sans migration : envoi du nom retenté au partage suivant')
        # Migration appliquée : le partage suivant envoie le nom
        page.evaluate("__sb.fail.posterName = null")
        page.click('[data-action="coach-poster-open"]')
        preview_ready(page)
        page.click('.sheet [data-action="share-story-send"]')
        page.wait_for_selector('.ios-dialog', timeout=5000)
        tap_dialog(page, 'Partager sans photo')
        page.wait_for_function("me => (__sb.co.posterNames || {})[me] === 'Camille Martin'", arg=me, timeout=8000)
        R.check(True, f'{t} migration appliquée : nom envoyé au partage suivant')
        R.check(not page.errors and not cons, f'{t} sans migration, coach : aucune erreur JS ni console {page.errors} {cons}')
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        cons = []
        # Erreurs de console, et requêtes en échec hors celle des mises à jour à chaud (coupée exprès par open_app)
        page.on('console', lambda m: cons.append(m.text) if m.type == 'error' and not m.text.startswith('Failed to load resource') else None)
        page.on('requestfailed', lambda q: cons.append(q.url) if 'mdlf-ota' not in q.url else None)
        open_app(page, theme)
        signin(page, 'lea')
        page.evaluate("""async () => { __sb.fail.posterName = 'missing'; const c = __sb.addPerson({ username: 'camille_coach', avatar: '🦁', social: false }); __sb.makeCoach(c);
            __sb.link(c, __sb.meId(), Date.now() - 3 * 86400000); await coachRefresh(); }""")
        page.evaluate("routeTo('friends')")
        for n in (1, 2, 3):
            page.evaluate("navigate('coach-mine')")
            page.wait_for_selector('.coach-mine-view', timeout=8000)
            settle(page)
            R.check(page.inner_text('.coach-mine__who .coach-join__name') == 'camille_coach' and page.locator('.coach-mine__handle').count() == 0 and toast(page) == '',
                    f'{t} sans migration, Mon coach ({n}) : pseudo seul, aucun message')
            page.evaluate("goBack()")
            settle(page)
        R.check(poster_calls(page, 'coach_poster_name') == 1, f'{t} sans migration : fonction absente appelée une fois, pas à chaque ouverture ({poster_calls(page, "coach_poster_name")})')
        R.check(not page.errors and not cons, f'{t} sans migration, élève : aucune erreur JS ni console {page.errors} {cons}')


BREAKS = """s => [...document.querySelectorAll(s)].filter(e => e.offsetParent).map(e => {
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), chars = [];
    for (let n; (n = w.nextNode());) for (let i = 0; i < n.length; i++) {
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getClientRects()[0]; if (b) chars.push([n.data[i], b.top]); }
    const bad = [];
    for (let i = 1; i < chars.length; i++) if (chars[i][1] > chars[i - 1][1] + 2 && !/[\\s._-]/.test(chars[i - 1][0]) && chars[i][0] !== ' ') bad.push(chars.slice(0, i).map(c => c[0]).join(''));
    return { text: e.textContent, bad, cut: e.scrollWidth > e.clientWidth + 1 }; })"""


def t_mon_coach_grand_texte(bench, eng, dev, theme):
    """Mon coach en AX33 sur iPhone SE : pseudo et nom passent à la ligne après « _ », « . » ou une espace, jamais au
    milieu d'un mot ni rognés (avec et sans le nom de l'affiche)."""
    if dev != 'iPhone SE':
        return
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        page.add_init_script("""(() => { const st = document.createElement('style'); st.textContent = 'html { font: 33px -apple-system, system-ui, sans-serif !important; }';
            document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st)); })()""")
        open_app(page, theme)
        page.evaluate("checkTypeSize()")
        signin(page, 'lea')
        page.evaluate("""async () => { const c = __sb.addPerson({ username: 'camille_coach', avatar: '🦁', social: false }); __sb.makeCoach(c);
            __sb.link(c, __sb.meId(), Date.now() - 3 * 86400000); await coachRefresh(); }""")
        page.evaluate("routeTo('friends')")
        for with_name in (False, True):
            if with_name:
                page.evaluate("() => { (__sb.co.posterNames ||= {})[myCoach().user_id] = 'Camille Martin'; coachPosterNames.clear(); }")
            page.evaluate("navigate('coach-mine')")
            page.wait_for_selector('.coach-mine-view', timeout=8000)
            if with_name:
                page.wait_for_selector('.coach-mine__handle', timeout=8000)
            settle(page)
            res = page.evaluate(BREAKS, '.coach-mine__who .coach-join__name, .coach-mine__handle')
            what = 'nom de l\'affiche et pseudo' if with_name else 'pseudo seul'
            R.check(res and all(not r['bad'] and not r['cut'] for r in res), f'{t} AX33 Mon coach, {what} : coupures propres {res}')
            shot(page, LOT, f'15-mon-coach-ax33-{"nom" if with_name else "pseudo"}-{t}')
            page.evaluate("goBack()")
            settle(page)
        R.check(not page.errors, f'{t} AX33 Mon coach : aucune erreur JS {page.errors}')


POSTER_LEFT = """async () => { const to = (p, v) => Promise.race([p, new Promise(r => setTimeout(() => r(v), 4000))]); const k = localStorage.getItem('mdlf_coach_poster') !== null;
    const db = await to(new Promise(r => { const q = indexedDB.open('mdlf-coach-poster'); q.onupgradeneeded = () => { q.transaction.abort(); r(false); };
      q.onsuccess = () => { const ok = q.result.objectStoreNames.contains('photo'); q.result.close(); r(ok); }; q.onerror = () => r(false); }), 'figé');
    const ph = db === true ? !!(await to(posterPhotoLoad(__sb.meId() || 'x'), 'figé')) : false;
    return { key: k, db, photo: ph }; }"""
POSTER_SEED = """async () => { coachPosterSavePrefs(__sb.meId(), { name: 'Camille Martin', specialty: 'Force', silhouette: 'male', neutral: false });
    const c = document.createElement('canvas'); c.width = c.height = 8; const b = await new Promise(r => c.toBlob(r, 'image/jpeg'));
    await posterPhotoSave(__sb.meId(), b); }"""


def t_donnees_effacees(bench, eng, dev, theme):
    """Audit du 21/11 : réglages et photo d'origine de l'affiche effacés de l'appareil à la déconnexion, à la suppression du
    compte et par « Supprimer toutes les données »."""
    t = tag(dev, theme)
    for parcours in ('déconnexion', 'suppression du compte', 'tout supprimer'):
        with bench.frozen_page(NOW, eng, dev, theme) as page:
            dbg = (lambda m: print(f'  [{parcours}] {m}', flush=True)) if os.environ.get('PPL_DEBUG') else (lambda m: None)
            open_app(page, theme)
            signin(page, 'camille_coach')
            page.evaluate("async () => { __sb.makeCoach(__sb.meId()); await coachRefresh(); }")
            dbg('seed')
            page.evaluate(POSTER_SEED)
            dbg('before')
            before = page.evaluate(POSTER_LEFT)
            R.check(before['key'] and before['photo'], f'{t} {parcours} : affiche gardée avant ({before})')
            dbg('action')
            uid = page.evaluate('__sb.meId()')
            if parcours == 'déconnexion':
                page.evaluate("Promise.race([accountSignOut(), new Promise(r => setTimeout(r, 8000))])")
            elif parcours == 'suppression du compte':
                r = page.evaluate("Promise.race([accountDelete(), new Promise(r => setTimeout(() => r({ ok: false, reason: 'figé' }), 8000))])")
                R.check(r.get('ok'), f'{t} suppression du compte faite ({r})')
            else:
                page.evaluate("() => { handleAction(null, document.createElement('button'), 'wipe-data'); }")   # sans attendre les dialogues
                page.wait_for_selector('.ios-dialog', timeout=5000)
                tap_dialog(page, 'Tout supprimer')
                page.wait_for_timeout(400)
                if page.locator('.ios-dialog__btn', has_text='Supprimer').count():
                    tap_dialog(page, 'Supprimer')
                page.wait_for_function("() => localStorage.getItem('mdlf_coach_poster') === null", timeout=8000)
            dbg('after')
            settle(page)
            left = page.evaluate(POSTER_LEFT.replace("__sb.meId() || 'x'", f"'{uid}'"))
            R.check(not left['key'] and left['photo'] is False and left['db'] != 'figé', f'{t} {parcours} : plus rien de l\'affiche sur l\'appareil ({left})')
            R.check(not page.errors, f'{t} {parcours} : aucune erreur JS {page.errors}')


def t_photo_bannie(bench, eng, dev, theme):
    """Audit du 21/11 : un compte privé de photo (signalements) garde la ligne Avatar et peut changer son avatar."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'zoe')
        page.evaluate("async () => { __sb.pp.bans[__sb.meId()] = true; await profilePhotoRefresh(); }")
        R.check(page.evaluate("!!pph.state?.banned && profilePhotoOn()"), f'{t} compte privé de photo')
        page.evaluate("navigate('account')")
        page.wait_for_selector('[data-action="account-edit-avatar"]', timeout=8000)
        page.click('[data-action="account-edit-avatar"]')
        page.wait_for_selector('.avatar-grid', timeout=8000)
        R.check(True, f'{t} privé de photo : avatar toujours modifiable')
        R.check(not page.errors, f'{t} privé de photo : aucune erreur JS {page.errors}')


run_main(R, [t_donnees_effacees, t_photo_bannie, t_coach_affiche, t_apercu_grand_texte, t_apercu_dans_ecran, t_eleve_sans_affiche, t_photo_trois_acces, t_sans_migration, t_mon_coach_grand_texte])
