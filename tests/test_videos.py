"""Vidéos d'exercices des coachs (docs/VIDEOS_EXERCICES.md) : fiche de la bibliothèque, aperçu d'un programme
reçu du coach, manifeste vide ou absent, données cellulaires, hors ligne. Animations 3D du personnage maison
(js/data/exercise-anims.js) en repli sans vidéo : lecture automatique, « réduire les animations », cache du SW.

La vidéo est une mire générée sur place par ffmpeg avec scripts/prepare-exercise-video.py (jamais une
vidéo tierce), servie par une fausse adresse https interceptée (https://videos.mdlf.test/). Aucune requête
ne sort. Sans ffmpeg, les fichiers sont remplacés par des octets quelconques (la lecture échoue : l'état
« indisponible » est vérifié à la place).
Captures : $PPL_SCRATCH/shots/lotvideos/ (clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_videos.py (ou run_all.py videos).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'videos'
R = Results(LOT)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = 'https://videos.mdlf.test/'
EX = 'Squat barre'
COACH = 'coach.test'
FULL_DEVICES = ('iPhone 13', 'Pixel 7')
_files = {}


def test_files():
    """Mire de 6 s préparée par le script du dépôt (720p H.264, faststart, affiche JPEG), une fois par processus."""
    if _files:
        return _files
    out = tempfile.mkdtemp(prefix='ppl-videos-')
    mp4, jpg = os.path.join(out, 'squat-barre.mp4'), os.path.join(out, 'squat-barre.jpg')
    if shutil.which('ffmpeg'):
        src = os.path.join(out, 'mire.mp4')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30',
                        '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac', src], check=True)
        subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'prepare-exercise-video.py'), src, EX,
                        '--coach', COACH, '--sortie', out], check=True, capture_output=True)
    else:
        open(mp4, 'wb').write(b'pas une video')
        open(jpg, 'wb').write(b'pas une image')
    _files.update({'squat-barre.mp4': (mp4, 'video/mp4'), 'squat-barre.jpg': (jpg, 'image/jpeg')})
    return _files


def manifest(videos=True):
    return {'version': 1, 'base': HOST, 'videos': {EX: {'src': 'squat-barre.mp4', 'poster': 'squat-barre.jpg', 'duration': 6,
                                                         'coach': COACH, 'width': 1280, 'height': 720}} if videos else {}}


def serve_videos(page, offline=False):
    """Fausse adresse https des vidéos : plages (Range → 206) comme un vrai hébergement ; requêtes notées."""
    page.video_hits = []

    def handle(route):
        name = route.request.url[len(HOST):].split('?')[0]
        page.video_hits.append((name, route.request.headers.get('range')))
        if offline or name not in test_files():
            return route.abort('internetdisconnected')
        path, ctype = test_files()[name]
        body = open(path, 'rb').read()
        m = re.match(r'bytes=(\d+)-(\d*)', route.request.headers.get('range') or '')
        if not m:
            return route.fulfill(status=200, body=body, headers={'Content-Type': ctype, 'Accept-Ranges': 'bytes'})
        a = int(m.group(1)); b = min(int(m.group(2)) if m.group(2) else len(body) - 1, len(body) - 1)
        route.fulfill(status=206, body=body[a:b + 1], headers={'Content-Type': ctype, 'Accept-Ranges': 'bytes',
                                                                'Content-Range': f'bytes {a}-{b}/{len(body)}'})
    page.route(HOST + '**', handle)


def open_app(page, theme, man='repo', cellular=False, coach=False):
    """man : 'repo' (fichier du dépôt, vide), None (absent : 404), ou un manifeste à servir."""
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    if man is None:
        page.route('**/data/exercise-videos.json', lambda route: route.fulfill(status=404, body='absent'))
    elif man != 'repo':
        page.route('**/data/exercise-videos.json', lambda route: route.fulfill(status=200, body=json.dumps(man), content_type='application/json'))
    if cellular:
        page.add_init_script("Object.defineProperty(navigator, 'connection', { configurable: true, value: { type: 'cellular', effectiveType: '4g', saveData: false } });")
    if coach:
        page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
        page.add_init_script(FAKE_ACCOUNT)
    seed(page, theme, ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
    page.wait_for_function('exerciseVideosLoaded === true')


def open_fiche(page, name=EX):
    page.click('.tabbar [data-tab="program"]')
    page.wait_for_timeout(250)
    page.evaluate("navigate('library')")
    page.wait_for_selector('#libSearch')
    page.fill('#libSearch', name)
    page.wait_for_timeout(100)
    page.locator(f'[data-action="open-library-ex"][data-name="{name}"]').first.click()
    page.wait_for_selector('.library-ex')
    page.wait_for_timeout(250)


def layout_ok(page, t, what):
    R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} {what} : pas de défilement horizontal')
    small = page.evaluate("""() => [...document.querySelectorAll('#app .exvideo button, #app .coach-prog__video')].filter(b => b.getClientRects().length)
        .map(b => b.getBoundingClientRect()).filter(r => r.width < 44 || r.height < 44).length""")
    R.check(small == 0, f'{t} {what} : cibles d\'au moins 44 pt')


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def t_fiche(bench, eng, dev, theme):
    """Fiche avec vidéo : à la place du mannequin, attributs du lecteur, crédit, lecture automatique en Wi-Fi."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        serve_videos(page)
        open_app(page, theme, manifest())
        R.check(page.evaluate(f'exerciseVideo({json.dumps(EX)})?.coach') == COACH, f'{t} manifeste lu')
        open_fiche(page)
        fig = page.locator('.howto .exvideo')
        R.check(fig.count() == 1, f'{t} vidéo dans « Comment faire »')
        R.check(page.locator('.howto__anim').count() == 0 and page.locator('.howto__cues li').count() >= 3, f'{t} mannequin remplacé, consignes gardées')
        attrs = page.evaluate("""() => { const v = document.querySelector('.exvideo video');
            return { playsinline: v.hasAttribute('playsinline'), muted: v.muted, loop: v.loop, poster: v.getAttribute('poster'),
                     label: v.getAttribute('aria-label') }; }""")
        R.check(attrs['playsinline'] and attrs['muted'] and attrs['loop'], f'{t} playsinline, muet, en boucle {attrs}')
        R.check(attrs['poster'] == HOST + 'squat-barre.jpg', f'{t} affiche')
        R.check(COACH in (attrs['label'] or '') and EX in attrs['label'], f'{t} VoiceOver : exercice et coach')
        # Crédit vérifié avant tout chargement : sans ffmpeg (CI), la lecture échoue vite et le crédit devient
        # « Vidéo indisponible… · @coach », testé plus bas
        credit = page.inner_text('.exvideo__credit').strip()
        R.check(credit == f'Vidéo : @{COACH}' or ('indisponible' in credit and COACH in credit), f'{t} crédit « Vidéo : @coach » ({credit})')
        R.check(abs(page.evaluate("(() => { const r = document.querySelector('.exvideo__frame').getBoundingClientRect(); return r.width / r.height; })()") - 16 / 9) < 0.02, f'{t} proportions 16/9')
        # Wi-Fi (ou rien de détectable) : lecture automatique une fois à l'écran
        page.wait_for_function("document.querySelector('.exvideo video').getAttribute('src')", timeout=5000)
        R.check(any(h[0] == 'squat-barre.mp4' for h in page.video_hits), f'{t} vidéo demandée une fois visible')
        playable = page.evaluate("document.createElement('video').canPlayType('video/mp4; codecs=\"avc1.640028\"') !== ''") and shutil.which('ffmpeg')
        if playable:
            try:
                page.wait_for_function("(() => { const v = document.querySelector('.exvideo video'); return v.currentTime > 0.3 && !v.paused; })()", timeout=8000)
                ok = True
            except Exception:
                ok = False
            R.check(ok, f'{t} lecture automatique')
            if ok:
                R.check('exvideo--playing' in fig.get_attribute('class') and page.get_attribute('.exvideo__play', 'aria-label') == 'Mettre la vidéo en pause', f'{t} en lecture : bouton « Mettre en pause »')
                if dev in FULL_DEVICES:
                    shot(page, LOT, f'1-fiche-lecture-{t}')
                # Toucher : pause voulue, pas relancée ; rien au pointerdown
                before = page.evaluate("document.querySelector('.exvideo video').paused")
                page.dispatch_event('.exvideo__play', 'pointerdown')
                page.wait_for_timeout(100)
                R.check(page.evaluate("document.querySelector('.exvideo video').paused") == before, f'{t} rien au pointerdown')
                page.click('.exvideo__play')
                page.wait_for_timeout(200)
                R.check(page.evaluate("document.querySelector('.exvideo video').paused") and page.get_attribute('.exvideo__play', 'aria-label') == 'Lire la vidéo', f'{t} toucher : pause')
                page.click('.exvideo__play')
                page.wait_for_timeout(400)
                R.check(not page.evaluate("document.querySelector('.exvideo video').paused"), f'{t} toucher : reprise')
        else:
            # Navigateur de test sans H.264 (Chromium de Playwright) : état « indisponible », jamais d'erreur JS
            page.wait_for_selector('.exvideo--error', timeout=5000)
            R.check('indisponible' in page.inner_text('.exvideo__credit') and COACH in page.inner_text('.exvideo__credit'), f'{t} sans H.264 : « indisponible », crédit gardé')
        layout_ok(page, t, 'fiche')
        # Retour : la vidéo quitte l'écran (rien ne continue en fond)
        page.click('[data-action="back"]')
        page.wait_for_timeout(300)
        R.check(page.evaluate("[...document.querySelectorAll('#app video')].every(v => v.paused || !v.isConnected)"), f'{t} retour : plus de lecture')
        # Exercice sans vidéo : fiche inchangée
        page.fill('#libSearch', 'Curl marteau')
        page.wait_for_timeout(100)
        page.locator('[data-action="open-library-ex"][data-name="Curl marteau"]').first.click()
        page.wait_for_selector('.library-ex')
        R.check(page.locator('.exvideo').count() == 0 and page.locator('.howto').count() == 1, f'{t} exercice sans vidéo : fiche inchangée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_affiche(bench, eng, dev, theme):
    """Données cellulaires (Android le dit) : affiche et ▶, rien de téléchargé avant le toucher. Captures."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        serve_videos(page)
        open_app(page, theme, manifest(), cellular=True)
        open_fiche(page)
        page.wait_for_timeout(600)
        R.check(page.locator('.exvideo--manual').count() == 1, f'{t} cellulaire : pas de lecture automatique')
        R.check(not page.evaluate("document.querySelector('.exvideo video').getAttribute('src')")
                and not any(h[0] == 'squat-barre.mp4' for h in page.video_hits), f'{t} cellulaire : vidéo pas téléchargée')
        R.check(page.get_attribute('.exvideo__play', 'aria-label') == 'Lire la vidéo' and page.locator('.exvideo__btn').is_visible(), f'{t} bouton ▶ « Lire la vidéo »')
        layout_ok(page, t, 'affiche')
        if dev in FULL_DEVICES:
            shot(page, LOT, f'2-fiche-affiche-{t}')
        page.click('.exvideo__play')
        page.wait_for_timeout(500)
        R.check(page.evaluate("document.querySelector('.exvideo video').getAttribute('src')") == HOST + 'squat-barre.mp4', f'{t} toucher : vidéo chargée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_vide(bench, eng, dev, theme):
    """Manifeste du dépôt (vide), puis absent : aucune vidéo de coach ni requête vers l'hébergement ; l'animation 3D
    prend la place sur le squat, l'exercice sans animation garde sa fiche d'avant."""
    t = tag(dev, theme)
    for man, what in (('repo', 'vide'), (None, 'absent')):
        with bench.page(eng, dev, theme) as page:
            serve_videos(page)
            open_app(page, theme, man)
            R.check(page.evaluate('exerciseVideos.size') == 0, f'{t} manifeste {what} : aucune vidéo')
            open_fiche(page)
            R.check(page.locator('.exvideo').count() == 1 and page.locator('.exvideo--3d').count() == 1
                    and page.locator('.howto').count() == 1, f'{t} manifeste {what} : animation 3D à la place')
            page.click('[data-action="back"]')
            page.wait_for_timeout(300)
            open_fiche(page, 'Curl marteau')
            R.check(page.locator('.exvideo').count() == 0 and page.locator('.howto').count() == 1, f'{t} manifeste {what} : sans animation, fiche comme avant')
            R.check(not page.video_hits, f'{t} manifeste {what} : aucune requête vidéo')
            R.check(not page.errors, f'{t} manifeste {what} : aucune erreur JS {page.errors}')


def t_hors_ligne(bench, eng, dev, theme):
    """Hors ligne : l'affiche ne vient pas, le lecteur dit « indisponible sans réseau », la fiche reste lisible."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        serve_videos(page, offline=True)
        open_app(page, theme, manifest())
        page.evaluate("Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })")
        open_fiche(page)
        page.wait_for_selector('.exvideo--error', timeout=5000)
        R.check(page.inner_text('.exvideo__credit').strip() == f'Vidéo indisponible sans réseau · @{COACH}', f'{t} hors ligne : message')
        R.check(page.locator('.howto__cues li').count() >= 3, f'{t} hors ligne : consignes lisibles')
        if dev in FULL_DEVICES:
            shot(page, LOT, f'4-fiche-hors-ligne-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


COACH_PROG = {'name': 'Force', 'consigne': 'Trois séances par semaine.', 'sessions': [
    {'key': 'sA', 'label': 'Bas', 'color': '#34C759', 'exercises': [
        {'name': EX, 'sets': 5, 'consigne': 'Descends sous la parallèle.'}, {'name': 'Curl marteau', 'sets': 3}]}]}


def t_coach(bench, eng, dev, theme):
    """Élève : aperçu d'un programme reçu, bouton « Vidéo » sur l'exercice filmé, qui ouvre sa fiche avec la vidéo."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        serve_videos(page)
        open_app(page, theme, manifest(), cellular=True, coach=True)
        page.evaluate("""async (prog) => {
            await accountSignInWith('apple', async () => 'add');
            await accountSaveProfile({ username: 'lea' });
            const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false });
            __sb.makeCoach(max);
            __sb.link(max, __sb.meId());
            __sb.co.progs.push({ coach: max, student: __sb.meId(), id: 'u_force', data: prog, sent_at: new Date().toISOString(), seen: false });
            await coachRefresh();
        }""", COACH_PROG)
        page.click('.tabbar [data-tab="friends"]')
        page.wait_for_timeout(400)
        page.click('[data-action="coach-open-mine"]')
        page.wait_for_selector('.coach-mine-view .coach-prog')
        page.click('[data-action="coach-prog-toggle"]')
        page.wait_for_selector('.coach-prog__preview')
        btns = page.locator('.coach-prog__preview .coach-prog__video')
        R.check(btns.count() == 1 and btns.first.get_attribute('aria-label') == f'Voir la vidéo : {EX}', f'{t} aperçu : « Vidéo » sur le seul exercice filmé')
        layout_ok(page, t, 'Mon coach')
        if dev in FULL_DEVICES:
            btns.first.scroll_into_view_if_needed()
            shot(page, LOT, f'3-mon-coach-apercu-{t}')
        btns.first.click()
        page.wait_for_selector('.library-ex .exvideo')
        R.check(page.inner_text('.exvideo__credit').strip() == f'Vidéo : @{COACH}', f'{t} fiche ouverte depuis le coach : même vidéo')
        # Programme ajouté : dans la séance, le nom de l'exercice mène à la même fiche
        R.check(page.evaluate(f"hasHowTo({{ name: {json.dumps(EX)} }})"), f'{t} séance : « Comment faire » mène à la vidéo')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


ANIM_POSTER = 'img/anim/squat-barre.webp'
PLAYING = "(() => { const v = document.querySelector('.exvideo--3d video'); return v && v.currentTime > 0.3 && !v.paused; })()"
CAN_PLAY = """(() => { const v = document.createElement('video');
    return v.canPlayType('video/mp4; codecs="avc1.64001F"') !== '' || v.canPlayType('video/webm; codecs="vp9"') !== ''; })()"""


def t_anim3d(bench, eng, dev, theme):
    """Animation 3D (sans vidéo de coach) : lecteur muet en boucle, carré, lecture automatique même en cellulaire
    (fichier de l'app) ; « réduire les animations » : affiche et ▶, rien de chargé avant le toucher."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        serve_videos(page)
        open_app(page, theme, 'repo', cellular=True)
        open_fiche(page)
        fig = page.locator('.howto .exvideo--3d')
        R.check(fig.count() == 1 and page.locator('.howto__anim').count() == 0, f'{t} animation 3D dans « Comment faire »')
        R.check(page.locator('.howto__cues li').count() >= 3, f'{t} consignes gardées sous l\'animation')
        attrs = page.evaluate("""() => { const v = document.querySelector('.exvideo--3d video');
            return { playsinline: v.hasAttribute('playsinline'), muted: v.muted, loop: v.loop, poster: v.getAttribute('poster'),
                     label: v.getAttribute('aria-label') }; }""")
        R.check(attrs['playsinline'] and attrs['muted'] and attrs['loop'], f'{t} playsinline, muet, en boucle {attrs}')
        R.check(attrs['poster'] == ANIM_POSTER and attrs['label'] == f'Animation 3D de l\'exercice {EX}', f'{t} affiche et VoiceOver {attrs}')
        R.check(page.inner_text('.exvideo--3d .exvideo__credit').strip() == 'Animation 3D', f'{t} légende « Animation 3D »')
        ratio = page.evaluate("(() => { const r = document.querySelector('.exvideo--3d .exvideo__frame').getBoundingClientRect(); return [r.width, r.height]; })()")
        R.check(abs(ratio[0] - ratio[1]) < 1 and ratio[0] <= 321, f'{t} carré, 320 pt au plus {ratio}')
        page.wait_for_function("document.querySelector('.exvideo--3d video').getAttribute('src')", timeout=5000)
        src = page.evaluate("document.querySelector('.exvideo--3d video').getAttribute('src')")
        R.check(src in ('img/anim/squat-barre.mp4', 'img/anim/squat-barre.webm'), f'{t} cellulaire : fichier de l\'app chargé quand même ({src})')
        if page.evaluate(CAN_PLAY):
            try:
                page.wait_for_function(PLAYING, timeout=8000)
                ok = True
            except Exception:
                ok = False
            R.check(ok, f'{t} lecture automatique de l\'animation')
            if ok:
                R.check(page.get_attribute('.exvideo--3d .exvideo__play', 'aria-label') == 'Mettre l\'animation en pause', f'{t} bouton « Mettre l\'animation en pause »')
                page.click('.exvideo--3d .exvideo__play')
                page.wait_for_timeout(200)
                R.check(page.evaluate("document.querySelector('.exvideo--3d video').paused"), f'{t} toucher : pause')
                page.click('.exvideo--3d .exvideo__play')
                page.wait_for_timeout(400)
                R.check(not page.evaluate("document.querySelector('.exvideo--3d video').paused"), f'{t} toucher : reprise')
        if dev in FULL_DEVICES:
            page.locator('.exvideo--3d').scroll_into_view_if_needed()
            shot(page, LOT, f'5-anim3d-lecture-{t}')
        layout_ok(page, t, 'animation 3D')
        R.check(not page.video_hits, f'{t} rien vers l\'hébergement des vidéos')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    with bench.page(eng, dev, theme, reduced_motion='reduce') as page:
        serve_videos(page)
        open_app(page, theme, 'repo')
        open_fiche(page, 'Développé couché barre')
        page.wait_for_timeout(600)
        R.check(page.locator('.exvideo--3d.exvideo--manual').count() == 1, f'{t} réduire les animations : pas de lecture automatique')
        R.check(not page.evaluate("document.querySelector('.exvideo--3d video').getAttribute('src')"), f'{t} réduire les animations : rien de chargé')
        R.check(page.get_attribute('.exvideo--3d .exvideo__play', 'aria-label') == 'Lire l\'animation' and page.locator('.exvideo--3d .exvideo__btn').is_visible(), f'{t} affiche et ▶ « Lire l\'animation »')
        R.check(page.evaluate("document.querySelector('.exvideo--3d video').getAttribute('poster')") == 'img/anim/developpe-couche-barre.webp', f'{t} affiche du développé couché')
        if dev in FULL_DEVICES:
            shot(page, LOT, f'6-anim3d-affiche-{t}')
        layout_ok(page, t, 'affiche 3D')
        page.click('.exvideo--3d .exvideo__play')
        page.wait_for_timeout(400)
        R.check((page.evaluate("document.querySelector('.exvideo--3d video').getAttribute('src')") or '').startswith('img/anim/developpe-couche-barre.'), f'{t} toucher : animation chargée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_anim_sw(bench):
    """Service worker (Chromium) : affiches de la version en cache, vidéo 3D mise en cache au premier visionnage
    puis servie par plages (206) depuis le cache, sans réseau."""
    with bench.page('chromium', 'Pixel 7', 'dark', service_workers='allow') as page:
        seed(page, 'dark', ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
        page.evaluate("Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('service worker jamais prêt')), 60000))])")
        page.reload()
        page.wait_for_selector('#app > *')
        R.check(page.evaluate('!!navigator.serviceWorker.controller'), 'SW : page contrôlée')
        R.check(page.evaluate(f"caches.match('/{ANIM_POSTER}').then(r => !!r)"), 'SW : affiche 3D en cache dès l\'installation')
        page.wait_for_function('exerciseVideosLoaded === true')
        open_fiche(page)
        page.wait_for_function(PLAYING, timeout=8000)
        src = page.evaluate("new URL(document.querySelector('.exvideo--3d video').src).pathname")
        page.wait_for_function(f"caches.match('{src}').then(r => !!r)", timeout=5000)
        page.context.set_offline(True)
        res = page.evaluate(f"""fetch('{src}', {{ headers: {{ Range: 'bytes=100-299' }} }}).then(async r =>
            ({{ status: r.status, len: (await r.arrayBuffer()).byteLength, range: r.headers.get('Content-Range') }}))""")
        page.context.set_offline(False)
        R.check(res['status'] == 206 and res['len'] == 200 and (res['range'] or '').startswith('bytes 100-299/'), f'SW : plage servie depuis le cache hors ligne {res}')
        R.check(not page.errors, f'SW : aucune erreur JS {page.errors}')


def t_sw(bench):
    """Service worker : manifeste dans le cache de la version, vidéos jamais."""
    sw = open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
    assets = sw[sw.index('const ASSETS'):sw.index('];', sw.index('const ASSETS'))]
    R.check("'/data/exercise-videos.json'" in assets and '.mp4' not in assets, 'sw.js : manifeste en cache, aucune vidéo')
    R.check("destination === 'video'" in sw and "headers.has('range')" in sw, 'sw.js : vidéos et plages laissées au réseau')
    R.check(sw.index('ANIM_RE.test(url.pathname)') < sw.index("destination === 'video'"), 'sw.js : animations 3D de l\'app traitées avant la règle des vidéos de coach')
    build = open(os.path.join(ROOT, 'scripts', 'build-web.mjs'), encoding='utf-8').read()
    R.check("'data'" in build, 'build-web : dossier data/ embarqué dans l\'app')


run_main(R, [t_fiche, t_affiche, t_vide, t_hors_ligne, t_coach, t_anim3d], once=[t_sw, t_anim_sw])
