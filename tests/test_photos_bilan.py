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
from fake_account import FAKE_ACCOUNT, FAKE_VAULT as VAULT
from PIL import Image, ExifTags, ImageDraw

LOT = 'photos'
R = Results(LOT)
NOW = local_ms(2026, 11, 20, 10, tz=PARIS)



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
    """Je suis max, coach ; lea est mon élève. max …0002 (…0001 : son identité Apple), un autre compte …0003, lea …0004 :
    mêmes identifiants que student_page."""
    open_app(page, theme, **kw)
    signin(page, 'max')
    ids = page.evaluate("""() => { const me = __sb.meId(); __sb.makeCoach(me);
        __sb.addPerson({ username: 'tom', avatar: '🐼', social: false });
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false });
        __sb.link(me, lea, Date.now() - 40 * 86400000); return { max: me, lea }; }""")
    page.evaluate('coachRefresh()')
    page.wait_for_timeout(300)
    return ids


def student_page(page, theme, **kw):
    """Je suis lea, élève de max : max …0002, moi …0004 (…0003 : mon identité Apple)."""
    open_app(page, theme, opts={'uidStart': 1}, **kw)
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
        .filter(e => getComputedStyle(e).visibility !== 'hidden')
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
        # Coach › Élèves : « Recevoir les photos de bilan » proposé sous la liste (panel du 08/11), pas seulement dans la fiche
        cp.click('.tabbar [data-tab="friends"]')
        cp.wait_for_selector('.coach-team [data-action="cph-setup"]', timeout=5000)
        R.check(cp.locator('.coach-team [data-action="cph-setup"]').count() == 1, f'{t} Coach › Élèves : « Recevoir les photos de bilan »')
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
        R.check('cph-setup' not in cp.evaluate('coachTeamHtml()'), f'{t} Coach › Élèves : plus proposé une fois activé')
        layout(cp, t, 'Fiche : photos activées')
        shot(cp, LOT, f'02-fiche-activee-{t}')

        # ── Élève : coffre, trois photos sur deux jours ──
        sids = student_page(sp, theme)
        R.check(sids == ids, f'{t} mêmes identifiants des deux côtés ({sids} / {ids})')
        copy_server(cp, sp)
        sp.evaluate('cphRefresh()')
        sp.wait_for_timeout(300)
        # Textes de confidentialité vrais quand le coach reçoit les photos (panel du 08/11)
        # Panels de la vague 3 : texte vrai même avant que l'état des photos soit relu du serveur
        keep = sp.evaluate("JSON.stringify(cph.state)")
        sp.evaluate("cph.state = null")
        sp.evaluate("navigate('body-measures')")
        sp.wait_for_selector('.bm-private')
        early = sp.inner_text('.bm-private')
        R.check('ni à ton coach' not in early and 'ton coach ne voit que les photos' in early, f'{t} Mesures, état pas encore lu : bandeau vrai ({early!r})')
        sp.evaluate("s => { cph.state = JSON.parse(s); render(); }", keep)
        bm = sp.inner_text('.bm-private')
        R.check('ton coach ne voit que les photos que tu lui envoies toi-même' in bm and 'ni à ton coach' not in bm, f'{t} Mesures : bandeau vrai ({bm!r})')
        sp.evaluate("coach.preview = { code: 'ESSAI1', person: { user_id: 'x', username: 'max', avatar: '🦁' } }; navigate(makeRoute('coach-join', 'ESSAI1'))")
        sp.wait_for_selector('.coach-join-view .coach-join__item')
        cj = sp.inner_text('.coach-join-view')
        R.check('Des photos de bilan' in cj and 'les photos de ton coffre que tu ne lui envoies pas' in cj and 'ni tes photos' not in cj, f'{t} aperçu « Rejoindre » : photos de bilan dites')
        sp.evaluate("navigate('photo-vault')")
        sp.wait_for_selector('[data-action="pv-start"]')
        intro = sp.inner_text('.pv-feats')
        R.check('Ton coach ne reçoit que les photos que tu choisis de lui envoyer' in intro, f'{t} intro du coffre : envoi au coach dit ({intro!r})')
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
        # Panel Apple du 08/11 : « Retirer » tout de suite dans le toast ; touché, les deux photos repartent de chez le coach
        R.check(sp.locator('.toast .toast__action').inner_text().strip() == 'Retirer', f'{t} toast d\'envoi : « Retirer », le même verbe que la liste')
        sp.click('.toast .toast__action')
        sp.wait_for_function("() => __sb.co.photos.length === 0", timeout=10000)
        sp.wait_for_timeout(300)
        R.check('2 photos retirées de chez ton coach' in toast(sp) and sp.locator('.pgal__sent').count() == 0, f'{t} « Retirer » : photos effacées de chez le coach ({toast(sp)!r})')
        # On les renvoie pour la suite du parcours (âge déjà déclaré)
        sp.locator('[data-action="cph-send-day"]').first.click()
        sp.wait_for_selector('.sheet .cphs__item')
        sp.locator('.sheet .cphs__item').first.click()
        sp.locator('.sheet .cphs__item').nth(1).click()
        sp.locator('.sheet .cphs__go').click()
        sp.wait_for_function('() => !document.querySelector(".sheet .cphs__list")', timeout=15000)
        sp.wait_for_timeout(400)
        # Vignettes du coffre : marque « Envoyée » sur les deux photos parties, pas sur celle d'il y a deux semaines
        marks = sp.evaluate("() => [...document.querySelectorAll('.pgal__item')].map(b => [!!b.querySelector('.pgal__sent'), b.getAttribute('aria-label')])")
        R.check([m[0] for m in marks] == [True, True, False] and all(('envoyée à ton coach' in m[1]) == m[0] for m in marks), f'{t} coffre : photos envoyées marquées {marks}')
        shot(sp, LOT, f'04c-coffre-marques-{t}')
        # Jour à une photo, depuis Mon coach › Photos de bilan › « Envoyer depuis mon coffre » (panel Apple du 08/11) : le coffre
        # s'ouvre (Face ID) directement sur la feuille d'envoi du jour le plus récent qui reste à envoyer, sans paragraphe d'explication
        R.check(sp.locator('.toast.toast--action').count() == 1, f'{t} toast d\'envoi encore là avant de changer d\'écran')
        sp.wait_for_timeout(900)
        sp.evaluate("navigate('coach-photos-mine')")
        sp.wait_for_selector('[data-action="cph-send-from-vault"]')
        # Panels de la vague 3 : un toast avec action ne suit pas sur l'écran suivant
        R.check(sp.locator('.toast.toast--action').count() == 0, f'{t} changement d\'écran : toast « Retirer » parti')
        R.check('Dans le coffre, touche' not in sp.inner_text('.coach-photos-mine-view') and sp.locator('[data-action="cph-send-from-vault"] .icon--paperplane').count() == 1,
                f'{t} « Envoyer depuis mon coffre » : avion en papier, sans mode d\'emploi')
        sp.click('[data-action="cph-send-from-vault"]')
        sp.wait_for_selector('.sheet .cphs__one', timeout=15000)
        R.check(sp.evaluate('currentView()') == 'photo-vault' and sp.inner_text('.sheet .cphs__day') == sp.evaluate('fmtDate(Date.now() - 14 * 86400000)'),
                f'{t} feuille d\'envoi ouverte sur le jour qui reste ({sp.inner_text(".sheet .cphs__day")!r})')
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
        # Une icône = un sens (panel Apple du 08/11) : le cadenas ne sert ni de lien ni de bouton d'envoi
        R.check(sp.locator('.cph-row__link .icon').count() == 0 and sp.locator('.coach-photos-mine-view button .icon--lock').count() == 0,
                f'{t} Photos de bilan : aucun cadenas sur un lien ou un bouton')
        # Deux photos de même pose et même jour : numérotées (panel du 08/11 : deux « Face » indiscernables)
        twins = sp.evaluate("""() => { const keep = cph.state.photos; const f = keep.find(p => p.pose === 'face');
            cph.state.photos = [...keep, { ...f, id: 'f-jumelle' }]; render();
            const out = { see: document.querySelectorAll('.cph-row [data-action=cph-see]').length,
                          names: [...document.querySelectorAll('.cph-row .cell__title')].map(e => e.textContent) };
            cph.state.photos = keep; render(); return out; }""")
        R.check(twins['see'] == 3 and sum(1 for n in twins['names'] if n.endswith('(1)') or n.endswith('(2)')) == 2,
                f'{t} « Voir » sur les 3 photos envoyées d\'ici (pas la jumelle inconnue), jumelles numérotées {twins}')
        # Code de la clé : replié sous « Vérifier le code avec ton coach », hors du texte principal (panel du 08/11)
        txt = sp.inner_text('.coach-photos-mine-view')
        R.check(sp.locator('.coach-photos-mine-view .cph-code').count() == 0 and 'Vérifier le code avec ton coach' in txt
                and sp.get_attribute('[data-action="cph-verify"]', 'aria-expanded') == 'false', f'{t} code de la clé replié')
        sp.click('[data-action="cph-verify"]')
        sp.wait_for_selector('.coach-photos-mine-view .cph-code')
        code = sp.inner_text('.coach-photos-mine-view .cph-code')
        txt = sp.inner_text('.coach-photos-mine-view')
        R.check('comparez' not in txt and 'hébergeur' not in txt and 'demande-lui le code' in txt, f'{t} code : tutoiement, mots simples, où le coach le trouve')
        R.check(code == sp.evaluate('cph.code') and sp.get_attribute('[data-action="cph-verify"]', 'aria-expanded') == 'true', f'{t} déplié : code de la clé de ton coach ({code!r})')
        shot(sp, LOT, f'07b-verifier-cle-{t}')
        sp.click('[data-action="cph-verify"]')
        layout(sp, t, 'Photos envoyées')
        shot(sp, LOT, f'07-photos-envoyees-{t}')
        # « Voir » : le coffre s'ouvre (Face ID) sur la photo d'origine, avec « Retirer de chez max »
        sp.locator('.cph-row [data-action="cph-see"]').first.click()
        sp.wait_for_selector('.sheet .pview__img', timeout=10000)
        R.check(sp.evaluate('currentView()') == 'photo-vault' and sp.locator('.sheet [data-action="cph-remove"]').count() == 1, f'{t} « Voir » : la photo dans le coffre, retirable')
        sp.click('.sheet .sheet__btn--cancel')
        sp.wait_for_function('() => !document.querySelector(".sheet .pview__img")', timeout=10000)   # feuille refermée avant le retour
        sp.evaluate('goBack()')
        sp.wait_for_selector('.coach-photos-mine-view .cph-row', timeout=10000)

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
        chev = cp.evaluate("() => [...document.querySelectorAll('.coach-photos-view .pcmp__pick')].map(p => !!p.querySelector('select') && !!p.querySelector('.icon--chevron-up-chevron-down'))")
        R.check(chev == [True, True], f'{t} coach : menus Avant / Après avec chevrons {chev}')
        cp.evaluate('scrollTo(0, 0)'); cp.wait_for_timeout(300)
        back = cp.evaluate("(() => { const b = document.querySelector('#app .navbar__back'); return [b.classList.contains('navbar__back--icon'), b.querySelector('.navbar__back-label').textContent]; })()")
        R.check(not back[0] and back[1] in ('lea', 'Retour'), f'{t} coach : retour « ‹ lea » (au moins « Retour »), jamais le chevron seul {back}')
        lock = cp.evaluate("() => { const b = document.querySelector('.navbar [data-action=cph-lock]'); return [b.textContent.trim(), b.querySelectorAll('.icon').length]; }")
        R.check(lock == ['Verrouiller', 0], f'{t} coach : « Verrouiller » en toutes lettres, le même verbe que le coffre {lock}')
        cp.evaluate('scrollTo(0, document.body.scrollHeight)'); cp.wait_for_timeout(500)
        bt = cp.evaluate("(() => { const ti = document.querySelector('#app .navbar__title'); return [ti.textContent, document.querySelector('#cphTitle').textContent, ti.scrollWidth <= ti.clientWidth + 1]; })()")
        R.check(bt[0] == bt[1] and bt[2], f'{t} coach : titre replié = grand titre, entier {bt}')
        cp.evaluate('scrollTo(0, 0)'); cp.wait_for_timeout(300)
        sel = cp.evaluate("() => [document.querySelector('#cph-a').value, document.querySelector('#cph-b').value]")
        old_day = cp.evaluate('() => localISO(Date.now() - 14 * 86400000)')
        R.check(sel == [old_day, cp.evaluate('() => localISO()')], f'{t} comparer : la plus ancienne contre la plus récente ({sel})')
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
        R.check(st == {'n': 2, 'objs': 2, 'trash': 3} and sp.locator('.cph-row').count() == 2, f'{t} retrait : ligne et fichier effacés {st}')
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
        R.check(cp.evaluate('__sb.co.photos.length') == 1 and cp.evaluate('__sb.trash.length') == 4, f'{t} coach : photo effacée de chez lui et du serveur')
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


def t_age_apple(bench, eng, dev, theme):
    """Tranche d'âge d'Apple connue et autre que « 18 ans ou plus » (15-17 ans) : ni envoi ni question sur l'âge,
    même avec un coach prêt à recevoir."""
    t = tag(dev, theme)
    face = gps_jpeg('bilan-age.jpg', 900, 1200, (180, 130, 90), (50, 80, 150))
    with bench.frozen_page(NOW, eng, dev, theme) as sp:
        ids = student_page(sp, theme)
        # Coach prêt (clé publiée), tranche 15-17 ans partagée par Apple
        sp.evaluate("""async mx => { const s = await vaultImportKey(bytesToB64(vaultRandom(32)));
            const { rec } = await coachKeyMake(s, mx, vaultNewId()); __sb.co.pkeys[mx] = rec;
            ageRange.stored = { status: 'sharing', lowerBound: 15, upperBound: 17, communicationLimits: false, at: Date.now() }; }""", ids['max'])
        sp.evaluate("navigate('photo-vault')")
        sp.wait_for_selector('[data-action="pv-start"]')
        sp.click('[data-action="pv-start"]')
        sp.wait_for_selector('.view.photo-vault [data-action="photo-add"]')
        add_photo(sp, face, 'face', 0)
        sp.wait_for_timeout(500)
        R.check(sp.evaluate('cph.state && cph.state.ready') is True, f'{t} coach prêt à recevoir')
        R.check(sp.locator('[data-action="cph-send-day"]').count() == 0, f'{t} 15-17 ans : pas de bouton « Envoyer à mon coach »')
        R.check('ton coach' in sp.inner_text('.view.photo-vault').lower() and 'Ton coach ne voit que' not in sp.inner_text('.view.photo-vault'),
                f'{t} 15-17 ans : le coffre ne promet pas d\'envoi')
        shot(sp, LOT, f'12-age-coffre-{t}')
        # Même appelé directement : refusé, sans question ni appel au serveur
        r = sp.evaluate("async () => { const p = photoCache[0]; return (await cphSend([p])).kind; }")
        R.check(r == 'not_adult' and sp.locator('.ios-dialog').count() == 0, f'{t} envoi refusé (not_adult), aucune question sur l\'âge ({r})')
        R.check(not sp.evaluate("__sb.calls.some(c => c[1] === 'student_photo_adult' || c[1] === 'student_photo_prepare')"), f'{t} rien d\'envoyé au serveur')
        sp.evaluate("navigate('coach-mine')")
        sp.wait_for_selector('.coach-mine-view')
        sp.wait_for_timeout(400)
        R.check(sp.locator('[data-action="cph-open-mine"]').count() == 0, f'{t} Mon coach : pas de photos de bilan proposées')
        R.check(not sp.errors, f'{t} aucune erreur JS {sp.errors}')


def t_cle_serveur(bench, eng, dev, theme):
    """Coach : secret absent du trousseau (« Clé absente ») ≠ clé du serveur qui n'est plus la sienne (« n'est plus la
    tienne », code de SA clé, « Republier ma clé »)."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as cp:
        ids = coach_page(cp, theme)
        cp.evaluate(f"navigate(makeRoute('coach-student', '{ids['lea']}'))")
        cp.wait_for_selector('[data-action="cph-setup"]')
        cp.click('[data-action="cph-setup"]')
        cp.wait_for_selector('[data-action="cph-open"]')
        mine = cp.evaluate(f"() => ({{ ...__sb.co.pkeys['{ids['max']}'] }})")
        my_code = cp.evaluate('pub => coachKeyCode(pub)', mine['public_key'])
        R.check(cp.evaluate("() => !!readCphMyKey()"), f'{t} clé retenue sur l\'iPhone du coach')
        # Le serveur sert une autre clé publique (même identifiant)
        cp.evaluate(f"""async () => {{ const s = await vaultImportKey(bytesToB64(vaultRandom(32)));
            const {{ rec }} = await coachKeyMake(s, '{ids['max']}', '{mine['key_id']}');
            __sb.co.pkeys['{ids['max']}'].public_key = rec.public_key; cphLock('test'); await cphCoachRefresh(); render(); }}""")
        cp.wait_for_timeout(300)
        cell = cp.inner_text('[data-action="cph-open"]')
        R.check("n'est plus la tienne" in cell, f'{t} fiche : alerte dès la relecture ({cell!r})')
        cp.click('[data-action="cph-open"]')
        cp.wait_for_selector('[data-action="cph-republish"]', timeout=15000)
        txt = cp.inner_text('.coach-photos-view')
        R.check("La clé enregistrée sur le serveur n'est plus la tienne" in txt and my_code in txt and 'Clé absente' not in txt,
                f'{t} « n\'est plus la tienne », code de ma clé ({my_code})')
        layout(cp, t, 'Clé du serveur différente')
        shot(cp, LOT, f'13-coach-cle-differente-{t}')
        cp.click('[data-action="cph-republish"]')
        tap_dialog(cp, 'Republier')
        cp.wait_for_function('() => cphIsOpen()', timeout=15000)
        cp.wait_for_timeout(300)
        srv = cp.evaluate(f"() => __sb.co.pkeys['{ids['max']}']")
        R.check(srv['public_key'] == mine['public_key'] and srv['key_id'] == mine['key_id'], f'{t} ma clé republiée sur le serveur')
        R.check('Ta clé est republiée' in toast(cp) and my_code in cp.inner_text('.coach-photos-view'), f'{t} ouvert avec ma clé, son code affiché')
        # Secret absent du trousseau, rien de retenu ici : « Clé absente de cet iPhone »
        cp.evaluate("() => { cphLock('test'); localStorage.removeItem('mdlf_coach_photo_mykey'); sessionStorage.removeItem('__fakeKeychain'); }")
        cp.click('[data-action="cph-unlock"]')
        cp.wait_for_selector('#cphTitle')
        cp.wait_for_function("() => document.querySelector('#cphTitle')?.textContent.includes('Clé absente')", timeout=10000)
        txt = cp.inner_text('.coach-photos-view')
        R.check("n'est plus la tienne" not in txt and cp.locator('[data-action="cph-republish"]').count() == 0, f'{t} secret absent : « Clé absente », pas d\'alerte de substitution')
        shot(cp, LOT, f'14-coach-cle-absente-{t}')
        R.check(not cp.errors, f'{t} aucune erreur JS {cp.errors}')


run_main(R, [t_envoi_complet, t_metadonnees, t_serveur_ancien, t_age_apple, t_cle_serveur])
