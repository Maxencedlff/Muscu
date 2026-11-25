"""Appli web du coach, vague 4 (docs/COACH_WEB.md) : Messages, Programme, Nutrition dans les trois moteurs (Chromium,
Firefox, WebKit), à 1440, 1180 et 820 px (tactile en tablette), en sombre et en clair.

    python3 tests/test_coach_web_v4.py
    PPL_ENGINES=chromium python3 tests/test_coach_web_v4.py

Faux Supabase de tests/fake_account.py, données de COACH_WEB_SEED et COACH_WEB_V4_SEED (tests/coach_web_fixtures.py) :
aucun réseau, code factice. Un navigateur à la fois, sans fenêtre. Captures des échecs dans
$PPL_SCRATCH/shots/coach-web-v4-echecs/.
"""
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright  # noqa: E402
import fixtures  # noqa: E402,F401  (textes lus ramenés aux espaces simples : typo_norm)
from coach_web_fixtures import static_server, launch, open_desk  # noqa: E402
from test_coach_web import check, no_hscroll, small_targets  # noqa: E402

ENGINES = [e for e in os.environ.get('PPL_ENGINES', 'chromium,firefox,webkit').split(',') if e]
SIZES = [(1440, 900, False), (1180, 820, True), (820, 1180, True)]
FAILS = os.path.join(os.environ.get('PPL_SCRATCH', '/tmp/ppl-tests'), 'shots', 'coach-web-v4-echecs')


def wait_js(page, expr, timeout=15_000):
    """Attend qu'une expression soit vraie, par page.evaluate (WebKit refuse wait_for_function sous la CSP de la page)."""
    for _ in range(timeout // 100):
        if page.evaluate(expr):
            return
        page.wait_for_timeout(100)
    raise AssertionError(f'jamais vrai : {expr}')


def go(page, hash_, wait):
    page.evaluate(f"location.hash = {hash_!r}.replace('LEA', window.__lea)")
    page.wait_for_selector(wait)


def tap(page, sel, touch):
    el = page.locator(sel).first
    el.tap() if touch else el.click()


def common(page, tag, theme):
    bg = page.evaluate('getComputedStyle(document.body).backgroundColor')
    check(bg == ('rgb(0, 0, 0)' if theme == 'dark' else 'rgb(242, 242, 247)'), f'{tag} : fond {bg}')
    no_hscroll(page, tag)
    small = small_targets(page)
    check(not small, f'{tag} : cibles de moins de 44 px {small[:5]}')


def matrix_case(browser, url, engine, w, h, touch, theme):
    tag = f'{engine} {w}px {theme}'
    ctx, page = open_desk(browser, url, width=w, height=h, theme=theme, touch=touch, v4=True, checkins=True)
    try:
        # ── Messages : la conversation de Léa, ses non-lus effacés à l'ouverture, envoi ──
        check(page.locator('.nav-i[href="#/messages"] .badge, .tabbar .nav-i[href="#/messages"] .badge').first.inner_text() == '3', f'{tag} : 3 non-lus (Léa 2, Tom 1)')
        go(page, '#/messages', '.msg-lst')
        rows = page.locator('.msg-row')
        check('lea' in rows.first.inner_text() and '2' in rows.first.inner_text(), f'{tag} : non lues en tête {rows.first.inner_text()!r}')
        common(page, f'{tag} messages', theme)
        tap(page, '.msg-row:has-text("lea")', touch)
        page.wait_for_selector('.bub')
        wait_js(page, "!document.querySelector('.msg-row.on .badge')")
        check(page.locator('.bub').count() == 7, f'{tag} : {page.locator(".bub").count()} messages')
        check(page.locator('.ref').count() >= 2, f'{tag} : séances et bilan dans le fil')
        check('Ton commentaire' in page.locator('.chat-b').inner_text(), f'{tag} : commentaire de séance dans le fil')
        if w >= 1240:
            check(page.locator('.msg-side').is_visible(), f'{tag} : « lea en bref »')
        if w < 900:
            check(not page.locator('.msg-list').is_visible(), f'{tag} : portrait, la liste laisse la place au fil')
        gap = page.evaluate("(() => { const b = document.getElementById('chat-b'); return b.scrollHeight - b.scrollTop - b.clientHeight; })()")
        check(gap < 4, f'{tag} : fil en bas à l\'ouverture ({gap})')
        page.fill('#chat-in', 'Oui, des pâtes complètes, même poids cru.')
        page.keyboard.press('Enter') if not touch else tap(page, '[data-ms=send]', touch)
        wait_js(page, "[...document.querySelectorAll('.bub.tx')].some(b => b.innerText.includes('pâtes complètes'))")
        check(page.input_value('#chat-in') == '', f'{tag} : saisie vidée')
        sent = page.evaluate("window.__sb.co.msgs.filter(m => m.student === window.__lea && m.fromCoach).at(-1).body")
        check(sent == 'Oui, des pâtes complètes, même poids cru.', f'{tag} : message envoyé {sent!r}')
        common(page, f'{tag} conversation', theme)

        # ── Programme : séances envoyées, colonne « La dernière fois », modification puis envoi ──
        go(page, '#/eleve/LEA/programme', '.pg-row[data-k]')
        check(page.locator('.pg-row[data-k]').count() == 5, f'{tag} : 5 exercices dans Haut A')
        first = page.locator('.pg-row[data-k]').first
        check('Top set' in first.inner_text() and 'Back-off' in first.inner_text(), f'{tag} : top set et back-off {first.inner_text()!r}')
        check('45 × 7' in first.inner_text() or '55 × 8' in first.inner_text() or 'Pas encore fait' in first.inner_text(), f'{tag} : la dernière fois')
        common(page, f'{tag} programme', theme)
        k = first.get_attribute('data-k')
        # Taper puis toucher « Envoyer » directement (le champ quitté par le clic ne perd pas le clic)
        page.fill(f'#pg-sets-{k}', '5')
        tap(page, '[data-pg=send]', touch)
        wait_js(page, "!document.querySelector('.savebar.stick')")
        data = page.evaluate("window.__sb.co.progs.find(p => p.student === window.__lea && p.id === 'seche4').data")
        ex = data['sessions'][0]['exercises'][0]
        check(ex['sets'] == 5 and ex['loads'][:2] == [45, 40] and ex['intens'] == 'topback' and '_k' not in ex, f'{tag} : programme envoyé {ex}')
        # Bas A : cluster sur la première série
        tap(page, '[data-pg=session][data-v="1"]', touch)
        page.wait_for_selector('.pg-row:has-text("Hip thrust")')
        check('1re en cluster' in page.locator('.pg-row:has-text("Hip thrust")').inner_text(), f'{tag} : cluster sur la 1re série')

        # ── Nutrition : plan envoyé, semaine cochée, jour, chiffres ──
        go(page, '#/eleve/LEA/nutrition', '.nt-day')
        check(page.locator('.nt-day').count() == 7, f'{tag} : 7 jours')
        check('Plan « Sèche »' in page.locator('.nt-head').inner_text(), f'{tag} : plan envoyé')
        tap(page, '.nt-day >> nth=0', touch)
        page.wait_for_selector('.nt-meal')
        check(page.locator('.nt-meal').count() == 4 and 'Flocons' in page.locator('.nt-meal').first.inner_text(), f'{tag} : repas du lundi avec les aliments du plan')
        check('Calories' in page.locator('.mac').inner_text(), f'{tag} : macros du jour')
        common(page, f'{tag} nutrition', theme)
        check(not page.evaluate('window.__csp || []'), f'{tag} : CSP {page.evaluate("window.__csp")}')
        check(not page.errors, f'{tag} : erreurs {page.errors}')
        keys = page.evaluate("Object.keys(localStorage).filter(k => !['mdlf_push_ask', 'mdlf_push_remind'].includes(k)).sort()")
        check(keys == [], f'{tag} : localStorage {keys}')
        keys = page.evaluate("Object.keys(sessionStorage).sort()")
        check(keys == ['mdlf-coach-web-auth', 'mdlf_coach_web_active'], f'{tag} : sessionStorage {keys}')
    except Exception:
        os.makedirs(FAILS, exist_ok=True)
        page.screenshot(path=os.path.join(FAILS, tag.replace(' ', '_') + '.png'), full_page=True)
        raise
    finally:
        ctx.close()


def journeys(browser, url, engine):
    """Parcours détaillés, un par moteur : relecture, commentaire, signalement, envoi groupé, repli du serveur, partage."""
    ctx, page = open_desk(browser, url, width=1440, v4=True, checkins=True)
    try:
        # Relecture : un message de l'élève arrive, il s'affiche au plus 15 s après, et il est marqué lu
        go(page, '#/messages/LEA', '.bub')
        page.evaluate("window.__sb.msg(window.__lea, false, 'Message arrivé pendant la lecture')")
        page.clock.run_for(16_000)
        wait_js(page, "document.querySelector('.chat-b').innerText.includes('arrivé pendant la lecture')")
        wait_js(page, "(window.__sb.co.reads[window.__lea] || {}).coach === Math.max(...window.__sb.co.msgs.filter(m => m.student === window.__lea).map(m => m.id))")
        # Maj + Entrée : à la ligne, pas d'envoi
        page.fill('#chat-in', 'ligne 1')
        page.keyboard.press('Shift+Enter')
        page.keyboard.type('ligne 2')
        check(page.input_value('#chat-in') == 'ligne 1\nligne 2', 'Maj + Entrée : à la ligne')
        # Trop long : refusé avec le compteur
        page.fill('#chat-in', 'a' * 2003)
        check(page.locator('#chat-count').inner_text().startswith('3 caractères en trop') and page.locator('[data-ms=send]').is_disabled(), 'trop long')
        page.fill('#chat-in', '')
        # Limite de chat_send dépassée : le message reste dans le champ, « Réessayer » le renvoie une fois la limite passée
        page.evaluate("__sb.so.day[window.__coachId + 'chat'] = 500")
        page.fill('#chat-in', 'Message refusé puis renvoyé')
        page.click('[data-ms=send]')
        page.wait_for_selector('.chat-fail[role=alert] >> text=Réessayer')
        check(page.input_value('#chat-in') == 'Message refusé puis renvoyé', 'limite : message gardé dans le champ')
        page.evaluate("__sb.so.day[window.__coachId + 'chat'] = 0")
        page.click('.chat-fail [data-ms=send]')
        wait_js(page, "document.querySelector('.chat-b').innerText.includes('Message refusé puis renvoyé') && !document.querySelector('.chat-fail')")
        check(page.input_value('#chat-in') == '', 'limite : champ vidé après le nouvel essai')
        # Commentaire de séance depuis le fil
        page.locator('[data-ms=note-open]').last.click()
        page.fill('#note-in', 'Super régularité cette semaine.')
        page.click('[data-ms=note-save]')
        page.wait_for_selector('.ref-note:has-text("Super régularité")')
        check(any(n['text'] == 'Super régularité cette semaine.' for n in page.evaluate('window.__sb.co.notes')), 'commentaire enregistré (coach_set_note)')
        # Signaler : raison, copie des messages côté serveur
        page.click('[data-ms=report]')
        page.click('dialog .ch-o[data-v=spam]')
        page.click('dialog [data-cf=yes]')
        page.wait_for_selector('dialog .dlg-t:has-text("Signalement envoyé")')
        page.click('dialog [data-cf=yes]')
        check(len(page.evaluate('window.__sb.co.chatReports || []')) == 1, 'signalement copié par le serveur')
        # Brouillon depuis Nutrition, puis onglet Messages de la fiche
        go(page, '#/eleve/LEA/nutrition', '.nt-day')
        page.click('[data-nt=write]')
        page.wait_for_selector('.chat.in-fiche')
        check(page.input_value('#chat-in').startswith('À propos de '), 'brouillon « À propos de … »')

        # Programme : quitter avec des changements demande confirmation
        go(page, '#/eleve/LEA/programme', '.pg-row[data-k]')
        k = page.locator('.pg-row[data-k]').first.get_attribute('data-k')
        page.click(f'#pg-open-{k}')
        page.select_option(f'#pg-tech-{k}', 'cluster')
        page.wait_for_selector(f'[data-pg=set-n][data-k="{k}"]')
        page.click(f'[data-pg=set-n][data-k="{k}"][data-v="1"]')
        page.click(f'[data-pg=where][data-k="{k}"][data-v="last"]')
        page.click('.crumb a')
        page.wait_for_selector('dialog.confirm')
        page.click('dialog [data-cf=no]')
        check('/programme' in page.evaluate('location.hash'), 'reste sur le programme')
        # Envoi à plusieurs : Tom garde SES charges (aucune ici), Léa les siennes
        page.click('[data-pg=send-many]')
        page.click('dialog .ch-o:has-text("tom")')
        page.click('dialog [data-cf=yes]')
        wait_js(page, "window.__sb.co.progs.filter(p => p.id === 'seche4' && p.data.sessions.length === 4).length >= 2")
        progs = page.evaluate("window.__sb.co.progs.filter(p => p.id === 'seche4')")
        lea, tom = page.evaluate('[window.__lea, window.__students[1]]')
        pl = next(p for p in progs if p['student'] == lea)['data']['sessions'][0]['exercises'][0]
        pt = next(p for p in progs if p['student'] == tom)['data']['sessions'][0]['exercises'][0]
        check(pl['intens'] == 'cluster-last' and pl.get('loads') == [45, 40, 40, 40], f'Léa : {pl}')
        check(pt['intens'] == 'cluster-last' and 'loads' not in pt and 'load' not in pt, f'Tom : sans les charges de Léa {pt}')
        # Envoyer un de mes programmes (compte du coach) à Hugo, qui n'en a pas
        hugo = page.evaluate("window.__sb.co.links.find(l => window.__sb.profiles[l.student]?.username === 'hugo').student")
        page.evaluate(f"location.hash = '#/eleve/{hugo}/programme'")
        page.wait_for_selector('.empty:has-text("Aucun programme envoyé")')
        page.click('.empty [data-pg=send-mine]')
        page.click('dialog .ch-o:has-text("Force 3 jours")')
        page.click('dialog [data-cf=yes]')
        page.wait_for_selector('.pg-row:has-text("Squat")')
        page.click('[data-pg=send]')
        wait_js(page, f"window.__sb.co.progs.some(p => p.student === '{hugo}' && p.id === 'u_force3')")
        check(not page.errors, f'parcours : erreurs {page.errors}')
        ctx.close()

        # Serveur sans coach_student_programmes : la version gardée sur le compte du coach
        ctx, page = open_desk(browser, url, width=1180, height=820, touch=True, v4=True,
                              pre="window.__sb.fail.progs = 'missing'; window.__sb.co.progs.find(p => p.id === 'seche4' && p.student === window.__lea).id = 'u_seche4';")
        go(page, '#/eleve/LEA/programme', '.pg-row[data-k]')
        check('Version de ce programme gardée sur ton compte' in page.locator('.pg-note').inner_text(), 'repli : version du compte annoncée')
        check(page.locator('[data-pg=send]').is_disabled() and page.locator('[data-pg=send-many]').is_disabled(), 'repli : lecture seule, jamais de charges effacées')
        go(page, '#/eleve/LEA/nutrition', '.nt-day')
        check('Plan lu sur ton compte' in page.inner_text('main'), 'repli : plan du compte')
        # Jade ne partage pas sa diète : rien d'autre que l'endroit où l'activer
        jade = page.evaluate("window.__sb.co.links.find(l => window.__sb.profiles[l.student]?.username === 'jade').student")
        page.evaluate(f"location.hash = '#/eleve/{jade}/nutrition'")
        page.wait_for_selector('.empty:has-text("ne partage pas")')
        check(page.locator('.nt-day').count() == 0 and 'kcal' not in page.inner_text('[role=tabpanel]').replace('Plan', ''), 'diète non partagée : aucun chiffre')
        check(not page.errors, f'repli : erreurs {page.errors}')
        # Embarquée dans l'app : session donnée par l'hôte, bouton « Revenir à l'appli »
        ctx.close()
        ctx, page = open_desk(browser, url, width=1180, height=820, touch=True, v4=True, login=False, host=True)
        page.wait_for_selector('.lst')
        check(page.locator('#login-email').count() == 0, 'embarquée : pas d\'écran de connexion')
        page.click('[data-action=host-exit]')
        check(page.evaluate('window.__exited') is True, 'embarquée : Revenir à l\'appli appelle l\'hôte')
        check('mdlf-coach-web-auth' not in page.evaluate('Object.keys(localStorage).concat(Object.keys(sessionStorage))'), 'embarquée : session jamais copiée dans le navigateur')
    finally:
        ctx.close()


def main():
    with sync_playwright() as pw, static_server() as url:
        for engine in ENGINES:
            browser = launch(pw, engine)
            try:
                for theme in ('dark', 'light') if os.environ.get('PPL_V4_PARTS', 'all') != 'journeys' else ():
                    for w, h, touch in SIZES:
                        matrix_case(browser, url, engine, w, h, touch, theme)
                        print(f'ok  {engine} {w}px {theme}')
                journeys(browser, url, engine)
                print(f'ok  {engine} parcours')
            except Exception:
                traceback.print_exc()
                sys.exit(1)
            finally:
                browser.close()
    print('Vague 4 de l\'appli web du coach : OK')


if __name__ == '__main__':
    main()
