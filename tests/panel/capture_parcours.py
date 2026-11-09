#!/usr/bin/env python3
"""Parcourt toute l'app comme de vrais utilisateurs et produit un dossier de captures commentées,
pour qu'un panel (pratiquants, coachs) juge l'ergonomie sans relancer de navigateur.

    PPL_URL=http://localhost:8768/ flock /tmp/ppl-e2e.lock python3 tests/panel/capture_parcours.py <sortie> [--rapide]
        [--parcours nom1,nom2] [--sans-axe]

- rapide : iPhone 13 sombre + iPhone SE clair ; complet (défaut) : iPhone 13 et iPhone SE, clair et sombre,
  plus Pixel 7 sombre ; recents (--recents) : iPhone 17, 17 Pro Max, Air et les quatre tailles du Duo pliable
  (fixtures.RECENT_PROFILES, marges de sécurité simulées), en sombre, plus iPhone 17 et Duo ouvert en clair. Un seul navigateur à la fois (WebKit, puis Chromium).
- Les parcours sont déclarés dans parcours.py (registre PARCOURS) ; chaque étape fait une capture
  <NN>-<parcours>-<étape>-<appareil>-<thème>.png et une ligne de index.md ; resume.md regroupe les touchers
  des parcours clés, les problèmes automatiques par écran et les étapes absentes.
- Un écran ou un bouton absent (branche qui ne l'a pas encore, ou qui l'a renommé) ne fait pas planter :
  l'étape est notée « absent » et le parcours continue.
- App iOS simulée (tests/fake_account.py) : aucune requête ne sort, ni Supabase ni mise à jour à chaud.
"""
import argparse
import contextlib
import datetime
import json
import os
import re
import sys
import time
import traceback
import unicodedata

ICI = os.path.dirname(os.path.abspath(__file__))
TESTS = os.path.dirname(ICI)
sys.path.insert(0, TESTS)
sys.path.insert(0, ICI)

from fixtures import BASE_URL, PARIS, RECENT_DEVICES, device_profile, safe_insets, seed, simulate_safe_area  # noqa: E402
from fake_account import FAKE_ACCOUNT  # noqa: E402
from commun import NOW, Absent  # noqa: E402

COMBOS = {
    'rapide': [('webkit', 'iPhone 13', 'dark'), ('webkit', 'iPhone SE', 'light')],
    'complet': [('webkit', 'iPhone 13', 'light'), ('webkit', 'iPhone 13', 'dark'),
                ('webkit', 'iPhone SE', 'light'), ('webkit', 'iPhone SE', 'dark'),
                ('chromium', 'Pixel 7', 'dark')],
    # Écrans récents : chaque appareil en sombre, le clair sur un iPhone et le Duo ouvert (même mise en page)
    'recents': [(e, d, 'dark') for e, d in RECENT_DEVICES] + [('webkit', 'iPhone 17', 'light'), ('webkit', 'iPhone Duo ouvert', 'light')],
    # Texte agrandi (--grand-texte) : tailles d'accessibilité d'iOS (Dynamic Type AX1 et AX3), taille de police de la page
    # portée à 23 px et 33 px au lieu de 17 px (ce que ferait font: -apple-system-body), iPhone 13 et SE, clair et sombre
    'grand-texte': [('webkit', d, th, fs) for fs in (23, 33) for d in ('iPhone 13', 'iPhone SE') for th in ('light', 'dark')],
}
# Parcours du mode texte agrandi
GRAND_TEXTE_PARCOURS = ['accueil', 'seance', 'coach', 'social', 'photos-bilan', 'nutrition', 'reglages']
THEME_FR = {'dark': 'sombre', 'light': 'clair'}
CIBLE_MINI = 44
POLICE_MINI = 12
EXEMPLES = 5
ATTENTE_MS = 3000        # délai pour trouver un élément avant de le déclarer absent
POSE_MS = 350            # fin des animations (feuilles, toasts) avant une capture

# ─────────────────────────────────────────────────────────────
#  Contrôles : ux.js de verif-ui si importable, sinon controles.js seul
# ─────────────────────────────────────────────────────────────
VERIF_UI = os.environ.get('VERIF_UI', '/mnt/c/Users/maxde/verif-ui')
try:
    sys.path.insert(0, VERIF_UI)
    import verif_ui as _vu  # noqa: E402
    AXE, AXE_FR, UX_JS = _vu.scripts_ux()
except Exception as e:   # pas de verif-ui sur cette machine : contrôles simples
    _vu = None
    AXE = AXE_FR = UX_JS = None
    print(f'verif-ui non importable ({str(e)[:80]}) : contrôles simples seulement', flush=True)
with open(os.path.join(ICI, 'controles.js'), encoding='utf-8') as _f:
    CONTROLES_JS = _f.read()

# Textes réservés à VoiceOver (.visually-hidden, boîtes de 1 px) : masqués le temps des contrôles,
# sinon chacun compte pour un « texte coupé »
MASQUER_JS = """on => {
  if (!on) { document.querySelectorAll('[data-panel-masque]').forEach(e => { e.style.display = e.dataset.panelMasque; delete e.dataset.panelMasque; }); return; }
  for (const e of document.body.querySelectorAll('.visually-hidden, .sr-text, [class*="sr-only"]')) {
    e.dataset.panelMasque = e.style.display; e.style.display = 'none';
  }
}"""

# Fin de l'écran défilé : le dernier élément doit passer au-dessus de la barre d'onglets
DERNIER_JS = """() => {
  const bar = document.querySelector('.tabbar'), scr = document.querySelector('#app .scr');
  if (!bar || !scr || getComputedStyle(bar).display === 'none' || bar.hidden || document.querySelector('.ios-dialog, .sess-sheet, .sheet-root, .auth, .onb')) return null;
  const y = scrollY, sy = scr.scrollTop;
  scrollTo(0, document.documentElement.scrollHeight); scr.scrollTop = scr.scrollHeight;
  const vis = [...scr.querySelectorAll('*')].filter(e => e.offsetParent && e.getBoundingClientRect().height > 0);
  const last = vis.sort((a, b) => a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom).pop();
  const ok = !last || last.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + .5;
  const txt = last ? (last.innerText || last.getAttribute('aria-label') || last.tagName).trim().slice(0, 40) : '';
  scrollTo(0, y); scr.scrollTop = sy;
  return ok ? null : `fin de l'écran sous la barre d'onglets : « ${txt} » reste caché même tout en bas`;
}"""


def slug(s):
    s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:40]


def combo_tag(device, theme, fs=None):
    return f'{slug(device)}{f"-ax{fs}" if fs else ""}-{THEME_FR[theme]}'


def combo_fs(combo):
    """Taille de police imposée (mode texte agrandi), ou None."""
    return combo[3] if len(combo) > 3 else None


# ─────────────────────────────────────────────────────────────
#  Pilote : gestes comptés, étapes capturées
# ─────────────────────────────────────────────────────────────
class Pilote:
    """Ce que voient les parcours : `r.toucher(...)`, `with r.etape(...)`, etc. Un pilote par page."""

    def __init__(self, run, page, parcours, combo):
        self.run, self.page, self.parcours, self.combo = run, page, parcours, combo
        self.engine, self.device, self.theme = combo[:3]
        self.fs = combo_fs(combo)
        self.etape_cour = None
        self.ecran_txt = ''

    # ── Démarrage ──
    def lancer(self, ppl_v2=None, bienvenue_vue=True, extra=None):
        """Stockage vidé puis rempli (données, thème), app chargée. bienvenue_vue=False : premier lancement.
        Options du faux serveur (__fakeOpts) : lues au chargement de la coquille, donc passées à autre_telephone ;
        les écrire dans la page ici serait perdu au rechargement."""
        x = dict(extra or {})
        if bienvenue_vue:
            x['ppl_welcome_seen'] = '1'
        seed(self.page, self.theme, ppl_v2, extra=x, url=self.run.url)
        self.page.wait_for_timeout(400)

    def raccourci(self, js, quoi, arg=None):
        """État préparé sans passer par l'écran (compte, données du faux serveur) : noté, jamais compté."""
        res = self.page.evaluate(js, arg) if arg is not None else self.page.evaluate(js)
        self.page.wait_for_timeout(250)
        self._note(f'(préparé : {quoi})', touche=False)
        return res

    def connecter(self, pseudo='max', amis=False):
        """Connexion Apple à un compte existant, pseudo choisi (préparé : l'écran de connexion a son parcours)."""
        return self.raccourci("""async ([u, en]) => { await accountSignInWith('apple', async () => 'add');
            if (u) await accountSaveProfile({ username: u }); if (en) await socialEnable(true); }""",
                              f'connecté avec Apple, pseudo « {pseudo} »' + (', Social activé' if amis else ''), [pseudo, amis])

    # ── Deux téléphones (le coach et son élève) ──
    def autre_telephone(self, init=None, opts=None):
        """Seconde app dans un contexte neuf, même appareil et même thème (faux serveur à part : le recopier). `init` :
        script ajouté au chargement (module natif simulé) ; `opts` : options du faux serveur (__fakeOpts, ex. uidStart
        pour avoir les mêmes identifiants des deux côtés). Fermée avec le parcours."""
        ctx, page = self.run.page(self.run.browser, self.run.pw, self.combo, opts)
        if init:
            page.add_init_script(init)
        self.run.en_plus.append(ctx)
        return page

    @contextlib.contextmanager
    def sur(self, page):
        """Gestes et captures sur `page` le temps du bloc, puis retour au téléphone d'avant."""
        avant, self.page = self.page, page
        try:
            yield page
        finally:
            self.page = avant

    # ── Gestes ──
    def _loc(self, sel, texte=None, nth=0):
        loc = self.page.locator(sel).filter(visible=True)   # un même bouton existe parfois caché ailleurs (mini-barre, feuille)
        if texte:
            loc = loc.filter(has_text=texte)
        return loc.nth(nth) if nth is not None else loc

    def present(self, sel, texte=None, timeout=0):
        loc = self._loc(sel, texte)
        if timeout:
            with contextlib.suppress(Exception):
                loc.wait_for(state='visible', timeout=timeout)
        return loc.count() > 0

    def attendre(self, sel, quoi=None, timeout=ATTENTE_MS):
        try:
            self.page.locator(sel).first.wait_for(state='visible', timeout=timeout)
        except Exception:
            raise Absent(quoi or f'introuvable : {sel}')

    def toucher(self, sel, quoi, texte=None, nth=0, pause=POSE_MS):
        """Un toucher (compté) sur le premier élément visible de `sel` (filtré par `texte`)."""
        loc = self._loc(sel, texte, nth)
        try:
            loc.wait_for(state='visible', timeout=ATTENTE_MS)
        except Exception:
            raise Absent(f'introuvable : {quoi}')
        try:
            loc.scroll_into_view_if_needed(timeout=ATTENTE_MS)
            loc.click(timeout=ATTENTE_MS)
        except Exception:
            # Élément redessiné en continu (minuteur) : Playwright ne le juge jamais « stable ». S'il est bien
            # au premier plan là où le doigt se poserait, le toucher est rejoué par un clic DOM.
            # Élément à moitié sous la barre (défilement rendu au retour) : centré, comme le ferait un doigt qui fait défiler
            loc.evaluate("e => e.scrollIntoView({ block: 'center' })")
            self.page.wait_for_timeout(300)
            dessus = loc.evaluate("""e => { const r = e.getBoundingClientRect();
                const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && e.contains(t); }""")
            if not dessus:
                raise RuntimeError(f'toucher impossible : {quoi} (élément recouvert ou inactif)') from None
            loc.dispatch_event('click')
        self._note(quoi)
        self.page.wait_for_timeout(pause)

    def choisir(self, libelle, quoi=None):
        """Bouton d'un dialogue ou d'une feuille d'actions iOS de l'app."""
        self.toucher('.ios-dialog__btn', quoi or f'« {libelle} »', texte=libelle)

    def onglet(self, tab, nom):
        self.toucher(f'.tabbar [data-tab="{tab}"]', f'onglet {nom}')

    def retour(self):
        self.toucher('.navbar [data-action="back"]', 'retour')

    def saisir(self, sel, valeur, quoi):
        """Toucher le champ (compté) puis taper la valeur au clavier."""
        loc = self._loc(sel)
        try:
            loc.wait_for(state='visible', timeout=ATTENTE_MS)
        except Exception:
            raise Absent(f'champ introuvable : {quoi}')
        deja = loc.evaluate('e => e === document.activeElement')
        if not deja:   # champ déjà actif (ouvert par le geste précédent) : pas de toucher en plus
            loc.scroll_into_view_if_needed(timeout=ATTENTE_MS)
            loc.click(timeout=ATTENTE_MS)
        loc.fill('')
        loc.type(str(valeur), delay=15)
        self._note(f'{quoi} : « {valeur} »', touche=not deja)
        self.page.wait_for_timeout(150)

    def defiler(self, sel, quoi):
        """Défilement jusqu'à un élément (geste noté, pas un toucher)."""
        loc = self.page.locator(sel).first
        if not loc.count():
            raise Absent(f'introuvable : {quoi}')
        loc.evaluate("e => e.scrollIntoView({ block: 'center' })")
        self.page.wait_for_timeout(200)
        self._note(f'défile jusqu\'à {quoi}', touche=False)

    def bas(self, quoi="bas de l'écran"):
        """Défilement jusqu'en bas de l'écran (geste noté, pas un toucher)."""
        self.page.evaluate("""() => { scrollTo(0, document.documentElement.scrollHeight);
            document.querySelectorAll('#app .scr, #app .view').forEach(e => { e.scrollTop = e.scrollHeight; }); }""")
        self.page.wait_for_timeout(250)
        self._note(f'défile jusqu\'en {quoi}', touche=False)

    def _note(self, quoi, touche=True):
        e = self.etape_cour
        if e is None:
            return
        e['actions'].append(quoi)
        if touche:
            e['touchers'] += 1

    # ── Étapes ──
    @contextlib.contextmanager
    def etape(self, nom, titre, cle=None):
        """Une étape : gestes dans le bloc, puis capture, contrôles et ligne de l'index.
        cle : nom de la tâche clé (resume.md additionne les touchers des étapes de même clé)."""
        self.run.nn += 1
        e = {'nn': self.run.nn, 'parcours': self.parcours.nom, 'etape': nom, 'titre': titre, 'cle': cle,
             'combo': combo_tag(self.device, self.theme, self.fs), 'touchers': 0, 'actions': [], 'statut': 'ok', 'note': '',
             'ecran': '', 'erreurs_js': [], 'problemes': [], 'capture': ''}
        self.etape_cour = e
        t0 = time.time()
        try:
            yield e
        except Absent as x:
            e['statut'], e['note'] = 'absent', str(x)
        except Exception as x:
            e['statut'], e['note'] = 'erreur', f'{type(x).__name__} : {str(x).splitlines()[0][:200]}'
            if self.run.debug:
                traceback.print_exc()
        finally:
            self.etape_cour = None
            self._capturer(e)
            e['duree'] = round(time.time() - t0, 1)
            self.run.lignes.append(e)
            marque = {'ok': '✓', 'absent': '∅', 'erreur': '✗'}[e['statut']]
            print(f"  {marque} {e['nn']:02d} {self.parcours.nom}/{nom} ({e['touchers']} t.) {e['note']}", flush=True)
        # Sortie du bloc : une exception est absorbée par le gestionnaire (contextlib : pas de relance)

    def _capturer(self, e):
        page = self.page
        with contextlib.suppress(Exception):
            page.wait_for_timeout(POSE_MS)
        fichier = f"{e['nn']:02d}-{slug(self.parcours.nom)}-{slug(e['etape'])}-{e['combo']}.png"
        try:
            page.screenshot(path=os.path.join(self.run.sortie, fichier), timeout=15000)
            e['capture'] = fichier
        except Exception as x:
            e['problemes'].append(f'capture impossible : {str(x).splitlines()[0][:80]}')
        e['problemes'] += self._controles(fichier if e['capture'] else None)
        vues = getattr(page, 'erreurs_vues', 0)   # par téléphone : un parcours peut en avoir deux
        errs = page.errors[vues:]
        page.erreurs_vues = len(page.errors)
        e['erreurs_js'] = errs
        e['ecran'] = self.ecran_txt

    def _controles(self, capture):
        page, out = self.page, []
        try:
            page.evaluate(MASQUER_JS, True)
            avec_ux = UX_JS is not None
            if avec_ux:
                axe = self.run.axe and self.combo == self.run.combos[0]
                if axe:
                    page.evaluate(AXE)
                ux = page.evaluate(UX_JS, {'cibleMini': CIBLE_MINI, 'exemples': EXEMPLES, 'locale': AXE_FR if axe else None})
                # axe injecté une fois reste dans la page : on ne garde ses constats que sur la passe prévue
                out += [c for c in ux['constats'] if axe or not c.startswith('accessibilité')]
                if capture:
                    out += self._icones(ux['icones'], capture)
            res = page.evaluate(CONTROLES_JS, {'cibleMini': CIBLE_MINI, 'policeMini': POLICE_MINI, 'exemples': EXEMPLES, 'avecUx': avec_ux})
            out += res['constats']
            ec = res['ecran']
            parts = [ec['vue'] or '?']
            if ec['calque']:
                parts.append(f"calque : {ec['calque']}")
            if ec['feuille']:
                parts.append(f"feuille : {ec['feuille']}")
            if ec['dialogue']:
                parts.append(f"dialogue : {ec['dialogue']}")
            self.ecran_txt = ' · '.join(parts) + (f" ({ec['hash']})" if ec['hash'] else '')
            dernier = page.evaluate(DERNIER_JS)
            if dernier:
                out.append(dernier)
        except Exception as x:
            out.append(f'contrôles impossibles : {str(x).splitlines()[0][:100]}')
            self.ecran_txt = '?'
        with contextlib.suppress(Exception):
            page.evaluate(MASQUER_JS, False)
        return [x for x in map(sans_arrondis, out) if x]

    def _icones(self, icones, capture):
        """Contraste des icônes cliquables mesuré sur la capture (même règle que verif_ui --ux)."""
        if not icones or _vu is None:
            return []
        try:
            from PIL import Image
            im = Image.open(os.path.join(self.run.sortie, capture))
            k = im.size[0] / self.page.viewport_size['width']
            pales = []
            for ic in icones:
                c = ic['cadre']
                box = tuple(int(v * k) for v in (c['x'], c['y'], c['x'] + c['width'], c['y'] + c['height']))
                f = _vu.fond_mesure(im.crop(box))
                *col, a = ic['couleur']
                vue = [col[i] * a + f[i] * (1 - a) for i in range(3)]
                ratio = _vu.contraste(vue, f)
                if ratio < _vu.CONTRASTE_ICONE:
                    pales.append(f"{ic['nom']} {ratio:.2f}:1")
            if not pales:
                return []
            suite = f' … et {len(pales) - EXEMPLES} autre(s)' if len(pales) > EXEMPLES else ''
            return [f'icônes cliquables peu visibles, contraste sous 3:1 ({len(pales)}) : ' + ' ; '.join(pales[:EXEMPLES]) + suite]
        except Exception:
            return []


# ─────────────────────────────────────────────────────────────
#  Passe complète : chaque parcours dans un contexte neuf
# ─────────────────────────────────────────────────────────────
class Run:
    def __init__(self, sortie, combos, url, axe, debug):
        self.sortie, self.combos, self.url, self.axe, self.debug = sortie, combos, url, axe, debug
        self.lignes = []
        self.nn = 0
        self.browser = self.pw = None   # navigateur en cours (Pilote.autre_telephone)
        self.en_plus = []               # contextes ouverts par un parcours, fermés avec lui

    def page(self, browser, p, combo, opts=None):
        _, device, theme = combo[:3]
        ctx = browser.new_context(**device_profile(p, device), color_scheme=theme, service_workers='block',
                                  timezone_id=PARIS, locale='fr-FR')
        if safe_insets(device):   # appareils récents : encoche et barre d'accueil de l'app plein écran
            simulate_safe_area(ctx, safe_insets(device))
        page = ctx.new_page()
        page.errors = []
        page.on('pageerror', lambda e: page.errors.append(str(e).splitlines()[0][:200]))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text
                and page.errors.append('console : ' + m.text.splitlines()[0][:200]))
        page.clock.install(time=NOW / 1000)
        page.add_init_script('window.__fakeOpts = Object.assign({ oldAccounts: true }, window.__fakeOpts || {}, %s);' % json.dumps(opts or {}))
        page.add_init_script(FAKE_ACCOUNT)
        if combo_fs(combo):   # Dynamic Type simulé : taille de police de la page, avant le premier dessin
            page.add_init_script("""(() => { const st = document.createElement('style'); st.textContent = 'html { font: %dpx -apple-system, system-ui, sans-serif !important; }';
                const put = () => { if (!document.documentElement) return false; document.documentElement.appendChild(st); return true; };
                if (!put()) new MutationObserver((m, o) => { if (put()) o.disconnect(); }).observe(document, { childList: true }); })()""" % combo_fs(combo))
        # Mises à jour à chaud et tout ce qui sortirait du poste : coupé (le faux Supabase répond en mémoire)
        page.route(re.compile(r'^https?://(?!127\.0\.0\.1|localhost).*'), lambda route: route.abort())
        return ctx, page

    def jouer(self, parcours_liste):
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            for engine in ('webkit', 'chromium'):
                combos = [c for c in self.combos if c[0] == engine]
                if not combos:
                    continue
                browser = p.chromium.launch(args=['--mute-audio']) if engine == 'chromium' else p.webkit.launch()
                self.browser, self.pw = browser, p
                try:
                    for combo in combos:
                        print(f'── {combo[1]} {THEME_FR[combo[2]]}{f" texte {combo_fs(combo)} px" if combo_fs(combo) else ""}', flush=True)
                        self.nn = 0
                        t0 = time.time()
                        for pc in parcours_liste:
                            ctx, page = self.page(browser, p, combo)
                            r = Pilote(self, page, pc, combo)
                            try:
                                pc.fn(r)
                            except Exception as x:   # hors étape (préparation) : le parcours s'arrête, le reste continue
                                self.nn += 1
                                self.lignes.append({'nn': self.nn, 'parcours': pc.nom, 'etape': 'préparation', 'titre': 'Préparation du parcours',
                                                    'cle': None, 'combo': combo_tag(combo[1], combo[2], combo_fs(combo)), 'touchers': 0, 'actions': [],
                                                    'statut': 'erreur', 'note': f'{type(x).__name__} : {str(x).splitlines()[0][:200]}',
                                                    'ecran': '', 'erreurs_js': page.errors[:], 'problemes': [], 'capture': '', 'duree': 0})
                                print(f'  ✗ {pc.nom} : préparation impossible ({x})', flush=True)
                                if self.debug:
                                    traceback.print_exc()
                            finally:
                                for c in [ctx, *self.en_plus]:
                                    with contextlib.suppress(Exception):
                                        c.close()
                                self.en_plus = []
                        print(f'   {combo[1]} {THEME_FR[combo[2]]}{f" {combo_fs(combo)} px" if combo_fs(combo) else ""} : {time.time() - t0:.0f} s', flush=True)
                finally:
                    browser.close()


# ─────────────────────────────────────────────────────────────
#  Rapports
# ─────────────────────────────────────────────────────────────
def cellule(s):
    return str(s).replace('|', '\\|').replace('\n', ' ')


def ecrire_index(run, registre, duree, mode):
    L = [f'# Parcours capturés — {datetime.date.today().isoformat()}', '',
         f'Mode {mode}, {len(run.combos)} appareil(s) × thème : ' + ', '.join(f'{c[1]} {THEME_FR[c[2]]}{f" {combo_fs(c)} px" if combo_fs(c) else ""}' for c in run.combos)
         + f'. Durée : {duree / 60:.1f} min. Horloge de l\'app figée au mercredi 4 novembre 2026, 18 h 30 (Paris).', '',
         'Colonnes : **touchers** = gestes de l\'utilisateur comptés dans l\'étape (un champ touché puis tapé compte 1) ; '
         '« préparé » = état mis en place sans l\'écran (compte, données du faux serveur), jamais compté. '
         'Statut ✓ fait, ∅ écran ou bouton absent sur cette version, ✗ erreur du parcours (voir la note).', '']
    par_parcours = {}
    for e in run.lignes:
        par_parcours.setdefault(e['parcours'], []).append(e)
    for pc in registre:
        lignes = par_parcours.get(pc.nom)
        if not lignes:
            continue
        L += [f'## {pc.titre} (`{pc.nom}`, {pc.role})', '', pc.doc, '',
              '| NN | Étape | Appareil | Statut | Touchers | Ce qui a été fait | Écran | Erreurs JS | Problèmes automatiques | Capture |',
              '|---|---|---|---|---|---|---|---|---|---|']
        lignes = sorted(lignes, key=lambda e: (e['nn'], e['combo']))
        for e in lignes:
            st = {'ok': '✓', 'absent': '∅ absent', 'erreur': '✗ erreur'}[e['statut']] + (f" : {e['note']}" if e['note'] else '')
            cap = f"[{e['capture']}]({e['capture']})" if e['capture'] else '—'
            L.append('| ' + ' | '.join(cellule(x) for x in (
                f"{e['nn']:02d}", e['titre'], e['combo'], st, e['touchers'], ' → '.join(e['actions']) or '—', e['ecran'] or '—',
                ' ; '.join(e['erreurs_js']) or '—', '<br>'.join(e['problemes']) or '—', cap)) + ' |')
        L.append('')
    with open(os.path.join(run.sortie, 'index.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(L))


def decouper(pb):
    """« titre (n) : ex1 ; ex2 … et k autre(s) » → (titre, [ex1, ex2]) ; sinon (texte, [])."""
    m = re.match(r'^(.*?) \(\d+\) : (.*)$', pb, re.S)
    if not m:
        return pb.splitlines()[0][:160], []
    ex = re.sub(r' … et \d+ autre\(s\)$', '', m.group(2))
    return m.group(1), [x.strip() for x in ex.split(' ; ') if x.strip()]


def sans_arrondis(pb):
    """Zones de toucher : retire les éléments à 44 px une fois arrondis (43,9 px mesurés), faux positifs."""
    if not pb.startswith('zones de toucher'):
        return pb
    titre, ex = decouper(pb)
    garde = [x for x in ex if not ((m := re.search(r'(\d+)×(\d+)$', x)) and min(int(m[1]), int(m[2])) >= CIBLE_MINI)]
    if not garde:
        return None
    return f'{titre} ({len(garde)}) : ' + ' ; '.join(garde)


def ecrire_resume(run, registre, duree, mode):
    L = [f'# Résumé des parcours — {datetime.date.today().isoformat()}', '',
         f'Mode {mode} ; durée {duree / 60:.1f} min ; {len(run.lignes)} étapes capturées ; détail et captures : [index.md](index.md).', '']
    combos = [combo_tag(c[1], c[2], combo_fs(c)) for c in run.combos]
    # 1. Touchers des tâches clés (premier appareil de la passe : les touchers ne dépendent pas de l'écran,
    #    un écart entre appareils est signalé)
    cles = {}
    for e in run.lignes:
        if e['cle']:
            cles.setdefault(e['cle'], {}).setdefault(e['combo'], []).append(e)
    L += ['## Touchers des tâches clés', '', '| Tâche | Touchers | Étapes | Statut |', '|---|---|---|---|']
    for cle, par in cles.items():
        ref = par.get(combos[0]) or next(iter(par.values()))
        n = sum(e['touchers'] for e in ref)
        autres = {c: sum(e['touchers'] for e in v) for c, v in par.items() if sum(e['touchers'] for e in v) != n}
        st = 'complet' if all(e['statut'] == 'ok' for e in ref) else 'incomplet (' + ', '.join(f"{e['etape']} {e['statut']}" for e in ref if e['statut'] != 'ok') + ')'
        if autres:
            st += ' ; autre nombre sur ' + ', '.join(f'{c} : {v}' for c, v in autres.items())
        L.append(f"| {cellule(cle)} | {n} | {', '.join(e['etape'] for e in ref)} | {cellule(st)} |")
    L += ['', '## Touchers par parcours', '', '| Parcours | Touchers (' + combos[0] + ') | Étapes ok / absentes / en erreur |', '|---|---|---|']
    for pc in registre:
        ref = [e for e in run.lignes if e['parcours'] == pc.nom and e['combo'] == combos[0]]
        if ref:
            n = {s: sum(1 for e in ref if e['statut'] == s) for s in ('ok', 'absent', 'erreur')}
            L.append(f"| {pc.titre} | {sum(e['touchers'] for e in ref)} | {n['ok']} / {n['absent']} / {n['erreur']} |")
    # 2. Étapes absentes ou en erreur
    manq = [e for e in run.lignes if e['statut'] != 'ok']
    L += ['', '## Étapes absentes ou en erreur', '']
    if not manq:
        L.append('Aucune.')
    vus = {}
    for e in manq:
        vus.setdefault((e['parcours'], e['etape'], e['statut'], e['note']), []).append(e['combo'])
    for (pcn, et, st, note), cs in vus.items():
        L.append(f"- **{pcn} / {et}** : {st} — {note} ({', '.join(cs) if len(cs) < len(combos) else 'tous les appareils'})")
    # 3. Problèmes automatiques par écran
    L += ['', '## Problèmes automatiques par écran', '',
          'Regroupés par écran (route de l\'app, feuille ou dialogue ouverts) ; entre parenthèses, les appareils où ils apparaissent.', '']
    par_ecran = {}
    for e in run.lignes:
        ecran = re.sub(r' \(#.*\)$', '', e['ecran'] or '?')
        for pb in e['problemes']:
            titre, exemples = decouper(pb)
            d = par_ecran.setdefault(ecran, {}).setdefault(titre, {'ex': {}, 'combos': set()})
            d['combos'].add(e['combo'])
            for x in exemples:
                d['ex'].setdefault(x, None)
    if not par_ecran:
        L.append('Aucun.')
    for ec in sorted(par_ecran):
        L.append(f'### {ec}')
        for titre, d in par_ecran[ec].items():
            ex = list(d['ex'])
            suite = f' … et {len(ex) - 8} autre(s)' if len(ex) > 8 else ''
            cs = ', '.join(sorted(d['combos'])) if len(d['combos']) < len(combos) else 'tous'
            L.append(f"- **{titre}** ({cs})" + (' : ' + ' ; '.join(ex[:8]) + suite if ex else ''))
        L.append('')
    # 4. Erreurs JS
    errs = {}
    for e in run.lignes:
        for x in e['erreurs_js']:
            errs.setdefault(x, set()).add(f"{e['parcours']}/{e['etape']}")
    L += ['## Erreurs JS', '']
    L += [f"- {x} — {', '.join(sorted(v)[:4])}" for x, v in errs.items()] or ['Aucune.']
    with open(os.path.join(run.sortie, 'resume.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(L) + '\n')


def main(argv=None):
    from parcours import PARCOURS
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('sortie', help='dossier de sortie (créé ; les anciennes captures y sont remplacées)')
    ap.add_argument('--rapide', action='store_true', help='iPhone 13 sombre + iPhone SE clair')
    ap.add_argument('--recents', action='store_true', help='iPhone 17, 17 Pro Max, Air et iPhone Duo (fermé, ouvert, paysage)')
    ap.add_argument('--parcours', default='', help='noms séparés par des virgules (défaut : tous)')
    ap.add_argument('--sans-axe', action='store_true', help='sans axe-core (accessibilité) sur le premier appareil')
    ap.add_argument('--debug', action='store_true', help='pile complète des erreurs')
    ap.add_argument('--grand-texte', action='store_true', help='texte agrandi (Dynamic Type AX1 23 px et AX3 33 px), iPhone 13 et SE, '
                    'parcours ' + ', '.join(GRAND_TEXTE_PARCOURS))
    a = ap.parse_args(argv)
    noms = [x.strip() for x in a.parcours.split(',') if x.strip()] or (GRAND_TEXTE_PARCOURS if a.grand_texte else [])
    connus = [pc.nom for pc in PARCOURS]
    if inconnus := [n for n in noms if n not in connus]:
        sys.exit(f'Parcours inconnu(s) : {", ".join(inconnus)} ; connus : {", ".join(connus)}')
    choisis = [pc for pc in PARCOURS if not noms or pc.nom in noms]
    os.makedirs(a.sortie, exist_ok=True)
    for f in os.listdir(a.sortie):
        if f.endswith('.png') or f in ('index.md', 'resume.md', 'etapes.json'):
            os.remove(os.path.join(a.sortie, f))
    mode = 'grand-texte' if a.grand_texte else 'recents' if a.recents else 'rapide' if a.rapide else 'complet'
    url = BASE_URL if BASE_URL.endswith('/') else BASE_URL + '/'
    run = Run(os.path.abspath(a.sortie), COMBOS[mode], url, axe=not a.sans_axe, debug=a.debug)
    t0 = time.time()
    run.jouer(choisis)
    duree = time.time() - t0
    ecrire_index(run, choisis, duree, mode)
    ecrire_resume(run, choisis, duree, mode)
    with open(os.path.join(run.sortie, 'etapes.json'), 'w', encoding='utf-8') as f:
        json.dump(run.lignes, f, ensure_ascii=False, indent=1)
    ko = sum(1 for e in run.lignes if e['statut'] == 'erreur')
    ab = sum(1 for e in run.lignes if e['statut'] == 'absent')
    print(f'\n{len(run.lignes)} étapes, {ab} absentes, {ko} en erreur, {duree / 60:.1f} min → {run.sortie}/resume.md', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
