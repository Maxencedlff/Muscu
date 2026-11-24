"""Appli web du coach, vague 2 (docs/COACH_WEB.md) : bilans configurables dans les trois moteurs (Chromium, Firefox,
WebKit), à 1440 et 1180 px (ordinateur, iPad paysage) et 820 px (tablette en portrait), tactile en 1180 et 820, en
sombre et en clair.

    python3 tests/test_coach_web_bilans.py
    PPL_ENGINES=chromium python3 tests/test_coach_web_bilans.py

Chaque combinaison : signal « Bilan reçu, à répondre » du tableau de bord, liste Bilans reçus, onglet Bilans
(comparaison, brouillon, envoi qui crée un message), colonnes de la fiche Semaines, Mes bilans (modèle fourni, cocher,
type et échelle, réordonner au glisser et au bouton, question perso, fréquence, jour, rappel, date limite,
destinataires élève et groupe, fréquence propre d'un élève, enregistrer, aperçu, confirmation avant de quitter,
dupliquer, supprimer, envoyer maintenant) ; cibles de 44 px, pas de défilement en largeur, fond noir pur en sombre,
aucune erreur, CSP, rien d'élève dans localStorage. Puis, par moteur : serveur sans la migration.
Faux serveur : tests/fake_account.py + tests/fake_checkins.py ; données : tests/coach_web_fixtures.py (aucun réseau,
code factice). Un navigateur à la fois, sans fenêtre. Captures des échecs dans $PPL_SCRATCH/shots/coach-web-echecs/.
"""
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright  # noqa: E402
import fixtures  # noqa: E402,F401  (textes lus ramenés aux espaces simples : typo_norm)
from coach_web_fixtures import static_server, launch, open_desk, COACH_EMAIL, FAKE_CODE  # noqa: E402

ENGINES = [e for e in os.environ.get('PPL_ENGINES', 'chromium,firefox,webkit').split(',') if e]
SIZES = [(1440, 900, False), (1180, 820, True), (820, 1180, True)]
FAILS = os.path.join(os.environ.get('PPL_SCRATCH', '/tmp/ppl-tests'), 'shots', 'coach-web-echecs')


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def common(page, tag, theme, where):
    over = page.evaluate('document.scrollingElement.scrollWidth - innerWidth')
    check(over <= 0, f'{tag} {where} : la page défile en largeur ({over} px)')
    small = page.evaluate("""() => [...document.querySelectorAll('button, a[href], input, select, textarea, [role=tab], [role=radio], [role=switch], [role=checkbox]')]
      .filter(e => e.offsetParent !== null && !e.closest('dialog:not([open])'))
      .map(e => { const r = e.getBoundingClientRect(); return { t: (e.innerText || e.id || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(x => x.h < 44 || x.w < 44)""")
    check(not small, f'{tag} {where} : cibles de moins de 44 px {small[:5]}')
    bg = page.evaluate('getComputedStyle(document.body).backgroundColor')
    check(bg == ('rgb(0, 0, 0)' if theme == 'dark' else 'rgb(242, 242, 247)'), f'{tag} {where} : fond {bg}')
    check(not page.evaluate('window.__csp || []'), f'{tag} {where} : CSP {page.evaluate("window.__csp")}')
    check(not page.errors, f'{tag} {where} : erreurs {page.errors}')


def tap(page, sel, touch):
    loc = page.locator(sel).first if isinstance(sel, str) else sel
    loc.scroll_into_view_if_needed()
    loc.tap() if touch else loc.click()


def wait_js(page, expr, arg=None, timeout=8000):
    """Attend qu'une expression soit vraie, par page.evaluate (wait_for_function passe par eval, que la CSP de la
    page interdit)."""
    import time
    end = time.time() + timeout / 1000
    while True:
        ok = page.evaluate(expr, arg) if arg is not None else page.evaluate(expr)
        if ok:
            return
        if time.time() > end:
            raise AssertionError(f'attente trop longue : {expr}')
        page.wait_for_timeout(50)


def go(page, h):
    page.evaluate(f'location.hash = {json.dumps(h)}')


def live(page, expect=None):
    """Dernière annonce aux lecteurs d'écran (posée 30 ms après le geste : on l'attend)."""
    if expect:
        try:
            wait_js(page, 't => document.getElementById("live").textContent.includes(t)', expect, 3000)
        except Exception:
            pass
    return page.locator('#live').inner_text()


def drag(page, grip, target, touch):
    """Glisse la poignée `grip` jusqu'au milieu haut de `target` : souris (Playwright) ou doigt (Pointer Events
    tactiles synthétiques : Playwright ne sait pas faire glisser au toucher)."""
    # Poignée et place visée toutes deux dans la fenêtre (hors fenêtre, Firefox ne rend pas le relâchement)
    grip.evaluate("(g, t) => { const a = g.getBoundingClientRect(), b = t.getBoundingClientRect(); scrollBy(0, (Math.min(a.top, b.top) + Math.max(a.bottom, b.bottom)) / 2 - innerHeight / 2); }", target.element_handle())
    g = grip.bounding_box()
    t = target.bounding_box()
    vh = page.evaluate('innerHeight')
    check(0 <= t['y'] and g['y'] + g['height'] <= vh, f'glisser : poignée ou cible hors de la fenêtre {g} {t}')
    x, y0, y1 = g['x'] + g['width'] / 2, g['y'] + g['height'] / 2, t['y'] + 4
    if not touch:
        page.mouse.move(x, y0)
        page.mouse.down()
        page.mouse.move(x, (y0 + y1) / 2, steps=4)
        page.mouse.move(x, y1, steps=4)
        page.mouse.up()
        return
    page.evaluate("""([sel, x, y0, y1]) => {
      const el = document.querySelector(sel);
      const ev = (type, y, t = el) => t.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, composed: true }));
      ev('pointerdown', y0);
      for (let i = 1; i <= 8; i++) ev('pointermove', y0 + (y1 - y0) * i / 8);
      ev('pointerup', y1);
    }""", [f'#{grip.get_attribute("id")}', x, y0, y1])


def review_flow(page, tag, theme, touch, w):
    """Tableau de bord, Bilans reçus, onglet Bilans (comparaison, brouillon, envoi), colonnes de Semaines."""
    lea, last = page.evaluate('window.__lea'), page.evaluate('window.__leaLast')
    row = page.locator('.lst a.row', has_text='lea').first
    check('Bilan reçu, à répondre' in row.inner_text(), f'{tag} : signal du bilan reçu {row.inner_text()!r}')
    if w >= 900:
        check(page.locator('.side a[href="#/bilans-recus"] .count').inner_text() == '1', f'{tag} : compteur Bilans reçus')
        check(page.locator('.side a[href="#/bilans"] .count').inner_text() == '3', f'{tag} : compteur Mes bilans')
    tap(page, '.side a[href="#/bilans-recus"]' if w >= 900 else '.tabbar a[href="#/bilans-recus"]', touch)
    page.wait_for_selector('h1:has-text("Bilans reçus")')
    todo = page.locator('ul[aria-labelledby=h-todo] a.row')
    check(todo.count() == 1 and 'lea' in todo.inner_text(), f'{tag} : bilans à répondre {todo.count()}')
    check(page.locator('ul[aria-labelledby=h-w] a.row').count() == 1, f'{tag} : bilan en attente de karim')
    common(page, tag, theme, 'Bilans reçus')
    tap(page, todo.first, touch)
    page.wait_for_selector('.rv-cur')
    check(page.evaluate('location.hash') == f'#/eleve/{lea}/bilans/{last}', f'{tag} : lien du bilan {page.evaluate("location.hash")}')
    check('Semaine 47' in page.inner_text('.rv-cur'), f'{tag} : bilan affiché {page.inner_text(".rv-cur")!r}')
    check(page.locator('#tab-checkins[aria-selected=true]').count() == 1, f'{tag} : onglet Bilans')
    figs = page.inner_text('.rv-figs')
    check('62,2' in figs and 'depuis S46' in figs, f'{tag} : chiffres face à S46 {figs!r}')
    check('3 photos envoyées, à ouvrir dans l\'app iPhone' in page.inner_text('.rv-ph'), f'{tag} : photos')
    check('La collation de 16 h' in page.inner_text('section[aria-labelledby=h-ans]'), f'{tag} : réponse écrite')
    page.select_option('#rv-cmp', page.evaluate("[...document.querySelectorAll('#rv-cmp option')].at(-1).value"))
    figs = page.inner_text('.rv-figs')
    check('−0,7 kg depuis S44' in figs and '−2,0 cm depuis S44' in figs, f'{tag} : comparaison avec S44 {figs!r}')
    # Bilan d'avant puis retour
    tap(page, '[data-rv=older]', touch)
    check('Semaine 46' in page.inner_text('.rv-cur'), f'{tag} : bilan d\'avant')
    tap(page, '[data-rv=newer]', touch)
    common(page, tag, theme, 'onglet Bilans')
    # Brouillon, puis envoi qui poste aussi le message
    page.fill('#rv-reply', 'Très beau bilan, on garde les calories.')
    tap(page, '#score-8', touch)
    check(page.locator('#score-8[aria-checked=true]').count() == 1, f'{tag} : note choisie')
    check(page.locator('#rv-reply').input_value() == 'Très beau bilan, on garde les calories.', f'{tag} : réponse gardée après la note')
    tap(page, '#rv-draft', touch)
    wait_js(page, f"__sb.ck.reviews['{last}'] && !__sb.ck.reviews['{last}'].sent_at")
    check(page.evaluate(f"__sb.ck.reviews['{last}'].score") == 8, f'{tag} : note du brouillon')
    msgs0 = page.evaluate('__sb.co.msgs.length')
    tap(page, '#rv-send', touch)
    page.wait_for_selector('.rv-sent')
    check(page.evaluate(f"!!__sb.ck.reviews['{last}'].sent_at"), f'{tag} : réponse envoyée')
    msg = page.evaluate(f"__sb.co.msgs.slice({msgs0})")
    check(len(msg) == 1 and msg[0]['fromCoach'] and msg[0]['body'] == 'Très beau bilan, on garde les calories.' and msg[0]['student'] == lea, f'{tag} : message {msg}')
    # Semaines : colonnes du bilan de Léa
    tap(page, '#tab-weeks', touch)
    page.wait_for_selector('table.wk tbody tr')
    heads = page.locator('table.wk thead th').all_inner_texts()
    check('Sommeil (sur 5)' in heads and 'Pas par jour (pas/jour)' in heads and not any(h.startswith('Poids (') and 'sur' in h for h in heads), f'{tag} : colonnes {heads}')
    col = heads.index('Sommeil (sur 5)')
    s47 = page.locator('table.wk tbody tr').nth(1).locator('th, td').nth(col).inner_text()
    check(s47 == '3', f'{tag} : sommeil de S47 {s47!r}')
    common(page, tag, theme, 'Semaines avec bilans')


def editor_flow(page, tag, theme, touch, w):
    """Mes bilans : modèle fourni, réglages, ordre, envoi, destinataires, enregistrement, dupliquer, supprimer."""
    tap(page, '.side a[href="#/bilans"]' if w >= 900 else '.tabbar a[href="#/bilans"]', touch)
    page.wait_for_selector('#ck-name')
    check(page.locator('#ck-name').input_value() == 'Hebdo sèche', f'{tag} : premier modèle')
    common(page, tag, theme, 'Mes bilans')
    # Aperçu élève (lecture seule)
    tap(page, '#ck-preview', touch)
    page.wait_for_selector('.pv')
    check(page.locator('.pv input, .pv textarea, .pv select, .pv button').count() == 0, f'{tag} : aperçu en lecture seule')
    check('Ta plus grande difficulté' in page.inner_text('.pv'), f'{tag} : aperçu, question')
    common(page, tag, theme, 'Aperçu élève')
    tap(page, '#pv-close', touch)
    # Nouveau bilan depuis le modèle fourni « Express »
    tap(page, '#ck-new', touch)
    tap(page, '[data-ck=start][data-i="2"]', touch)
    page.wait_for_selector('#ck-name')
    check(page.locator('#ck-name').input_value() == 'Express', f'{tag} : modèle Express')
    page.fill('#ck-name', 'Express perso')
    check('Pas encore enregistré' in page.inner_text('#savebar'), f'{tag} : pas encore enregistré')
    # Cocher Sommeil et Douleurs, décocher Énergie
    tap(page, '#box-sleep', touch)
    tap(page, '#box-pain', touch)
    tap(page, '#box-energy', touch)
    check(page.locator('#box-sleep[aria-checked=true]').count() == 1 and page.locator('#box-energy[aria-checked=false]').count() == 1, f'{tag} : cases')
    # Type et échelle : Sommeil sur 10, Douleurs en texte (touche le type)
    tap(page, '#pill-sleep', touch)
    tap(page, '[data-ck=scale][data-v="10"][data-key=sleep]', touch)
    check(page.inner_text('#pill-sleep') == '1 à 10', f'{tag} : échelle {page.inner_text("#pill-sleep")!r}')
    page.fill('#hi-sleep', 'Parfait')
    tap(page, '#pill-pain', touch)
    tap(page, '[data-ck=type][data-v=text][data-key=pain]', touch)
    check(page.inner_text('#pill-pain') == 'Texte', f'{tag} : type de Douleurs')
    # Ordre au glisser : Sommeil tout en haut de Ressenti
    feel = page.locator('ul[data-group=feel] > li')
    drag(page, page.locator('#grip-sleep'), feel.first, touch)
    wait_js(page, "document.querySelector('ul[data-group=feel] > li').dataset.key === 'sleep' && bl.draft.rows.find(r => r.group === 'feel').key === 'sleep'")
    check('Sommeil déplacé en position 1' in live(page, 'Sommeil déplacé'), f'{tag} : annonce du glisser {live(page)!r}')
    # Ordre au bouton : Stress descend, puis clavier sur la poignée
    tap(page, '#main-stress', touch)
    pos = page.evaluate("[...document.querySelectorAll('ul[data-group=feel] > li')].findIndex(l => l.dataset.key === 'stress')")
    tap(page, '#down-stress', touch)
    check(page.evaluate("[...document.querySelectorAll('ul[data-group=feel] > li')].findIndex(l => l.dataset.key === 'stress')") == pos + 1, f'{tag} : Descendre')
    check(f'Stress déplacé en position {pos + 2}' in live(page, 'Stress déplacé'), f'{tag} : annonce du bouton {live(page)!r}')
    page.focus('#grip-stress')
    page.keyboard.press('ArrowUp')
    check(page.evaluate("[...document.querySelectorAll('ul[data-group=feel] > li')].findIndex(l => l.dataset.key === 'stress')") == pos, f'{tag} : flèche haut')
    tap(page, '#main-stress', touch)
    # Question perso : nombre avec unité
    tap(page, '#addq', touch)
    tap(page, '#addq-number', touch)
    qkey = page.evaluate("document.querySelector('ul[data-group=custom] > li:last-child').dataset.key")
    page.fill(f'#lbl-{qkey}', "Verres d'eau par jour ?")
    page.fill(f'#unit-{qkey}', 'verres')
    # Fréquence, jour, heure, rappel, date limite
    tap(page, '#freq-week', touch)
    page.select_option('#ck-weekday', '1')
    page.select_option('#ck-hour', '9')
    tap(page, '#ck-remind', touch)
    check(page.locator('#ck-remind[aria-checked=false]').count() == 1, f'{tag} : rappel coupé')
    tap(page, '#ck-remind', touch)
    page.select_option('#ck-remind-h', '12')
    page.select_option('#ck-due', '72')
    due = page.evaluate("(s => s.options[s.selectedIndex].text)(document.getElementById('ck-due'))")
    check(due == 'Jeudi, 9 h', f'{tag} : date limite lisible {due!r}')
    # Destinataires : groupe Sèche, Tom, un nouveau groupe Force, fréquence propre de Tom
    tap(page, '#ck-recip', touch)
    g = page.evaluate('window.__group')
    tap(page, f'#tg-{g}', touch)
    tom = page.evaluate('window.__students[1]')
    sarah = page.evaluate('window.__students[6]')
    tap(page, f'#ts-{tom}', touch)
    tap(page, '#ck-new-group', touch)
    page.fill('#ck-gname', 'Force')
    tap(page, f'#gm-{sarah}', touch)
    tap(page, '#ck-gsave', touch)
    wait_js(page, "__sb.ck.groups.some(g => g.name === 'Force')")
    page.wait_for_selector('#ck-recip-done')
    common(page, tag, theme, 'destinataires')
    tap(page, '#ck-recip-done', touch)
    check(page.locator('ul[aria-label=Destinataires] li').count() == 3, f'{tag} : 3 destinataires')
    tap(page, f'#own-{tom}', touch)
    tap(page, f'[data-ck=own-freq][data-v="2weeks"][data-id="{tom}"]', touch)
    check(page.inner_text(f'#own-{tom}') == 'toutes les 2 sem.', f'{tag} : fréquence de Tom')
    common(page, tag, theme, 'éditeur')
    # Quitter sans enregistrer : confirmation, Annuler garde tout
    tap(page, '.side a[href="#/"]' if w >= 900 else '.tabbar a[href="#/"]', touch)
    page.wait_for_selector('dialog.confirm[open]')
    tap(page, 'dialog.confirm [data-cf=no]', touch)
    wait_js(page, "!document.querySelector('dialog.confirm')")
    check(page.evaluate('location.hash') == '#/bilans' and page.locator('#ck-name').input_value() == 'Express perso', f'{tag} : rien de perdu')
    # Enregistrer
    tap(page, '#ck-save', touch)
    wait_js(page, "__sb.ck.templates.some(t => t.name === 'Express perso')")
    page.wait_for_selector('#savebar:has-text("Tout est enregistré")')
    t = page.evaluate("__sb.ck.templates.find(t => t.name === 'Express perso')")
    keys = [i['key'] for i in t['items']]
    check(keys == ['weight', 'pain', 'sleep', 'stress', qkey], f'{tag} : suivis et ordre enregistrés {keys}')
    sl = next(i for i in t['items'] if i['key'] == 'sleep')
    check(sl['scale'] == 10 and sl['hi'] == 'Parfait', f'{tag} : échelle enregistrée {sl}')
    check(next(i for i in t['items'] if i['key'] == 'pain')['type'] == 'text', f'{tag} : type enregistré')
    q = next(i for i in t['items'] if i['key'] == qkey)
    check(q['type'] == 'number' and q['unit'] == 'verres', f'{tag} : question {q}')
    sch = page.evaluate(f"__sb.ck.schedules.filter(s => s.template === '{t['id']}').map(s => [s.group ? 'g' : 's', s.freq, s.weekday, s.send_hour, s.remind_after_h, s.due_after_h])")
    check(sorted(sch) == sorted([['g', 'week', 1, 9, 12, 72], ['g', 'week', 1, 9, 12, 72], ['s', '2weeks', 1, 9, 12, 72]]), f'{tag} : plannings {sch}')
    # Dupliquer, puis supprimer la copie
    tap(page, '#ck-dup', touch)
    wait_js(page, "document.querySelector('#ck-name')?.value === 'Copie de Express perso'")
    tap(page, '#ck-delete', touch)
    page.wait_for_selector('dialog.confirm[open]')
    tap(page, 'dialog.confirm [data-cf=yes]', touch)
    wait_js(page, "!__sb.ck.templates.some(t => t.name === 'Copie de Express perso')")
    # Envoyer maintenant : Express (à la demande) à karim
    if w < 1240:
        tap(page, '#bl-toggle', touch)
    tap(page, f'[data-ck=pick][data-id="{page.evaluate("window.__tpl.express")}"]', touch)
    wait_js(page, "document.querySelector('#ck-name')?.value === 'Express'")
    # Sans destinataire, un modèle n'a pas encore de planning : le coach choisit « À la demande »
    tap(page, '#freq-manual', touch)
    check(page.locator('#freq-manual[aria-checked=true]').count() == 1 and page.locator('#ck-send-now[aria-disabled=true]').count() == 1, f'{tag} : Express à la demande, envoi pas encore possible')
    tap(page, '#ck-recip', touch)
    karim = page.evaluate('window.__students[2]')
    tap(page, f'#ts-{karim}', touch)
    tap(page, '#ck-recip-done', touch)
    tap(page, '#ck-save', touch)
    page.wait_for_selector('#savebar:has-text("Tout est enregistré")')
    n0 = page.evaluate('__sb.ck.requests.length')
    tap(page, '#ck-send-now', touch)
    page.wait_for_selector('dialog.confirm[open]')
    tap(page, 'dialog.confirm [data-cf=yes]', touch)
    wait_js(page, f'__sb.ck.requests.length === {n0 + 1}')
    check(page.evaluate(f"__sb.ck.requests.at(-1).student === '{karim}' && __sb.ck.requests.at(-1).name === 'Express'"), f'{tag} : envoi immédiat')
    common(page, tag, theme, 'après envoi')


def matrix_case(browser, url, engine, w, h, touch, theme):
    tag = f'{engine} {w}px {theme}'
    ctx, page = open_desk(browser, url, width=w, height=h, theme=theme, touch=touch, checkins=True)
    try:
        review_flow(page, tag, theme, touch, w)
        editor_flow(page, tag, theme, touch, w)
        keys = page.evaluate("Object.keys(localStorage).filter(k => !['mdlf_push_ask', 'mdlf_push_remind'].includes(k)).sort()")
        check(keys == ['mdlf-coach-web-auth', 'mdlf_coach_web_active'], f'{tag} : localStorage {keys}')
    except Exception:
        os.makedirs(FAILS, exist_ok=True)
        page.screenshot(path=os.path.join(FAILS, 'bilans_' + tag.replace(' ', '_') + '.png'), full_page=True)
        raise
    finally:
        ctx.close()


def missing_server(browser, url, engine):
    """Serveur sans la migration des bilans (PGRST202) : les écrans le disent, le reste marche."""
    ctx, page = open_desk(browser, url, width=1440, login=False, checkins=True)
    page.evaluate("__sb.fail.checkins = 'missing'")
    page.fill('#login-email', COACH_EMAIL)
    page.click('form[data-form="email"] button')
    page.fill('#login-code', FAKE_CODE)
    page.click('form[data-form="code"] button')
    page.wait_for_selector('.lst')
    check(page.locator('.lst a.row').count() == 10, f'{engine} sans migration : tableau de bord')
    check(page.locator('.side a[href="#/bilans-recus"] .count').count() == 0, f'{engine} sans migration : aucun compteur inventé')
    go(page, '#/bilans')
    page.wait_for_selector('text=Les bilans ne sont pas encore ouverts')
    check(page.locator('[data-ck=reload]').count() == 1 and page.locator('.empty a[href="#/"]').count() == 1, f'{engine} sans migration : actions')
    go(page, '#/bilans-recus')
    page.wait_for_selector('text=Les bilans ne sont pas encore ouverts')
    go(page, '#/eleve/' + page.evaluate('window.__lea') + '/bilans')
    page.wait_for_selector('#panel-checkins >> text=Les bilans ne sont pas encore ouverts')
    go(page, '#/eleve/' + page.evaluate('window.__lea'))
    page.wait_for_selector('table.wk tbody tr')
    check(page.locator('table.wk th.ckh').count() == 0, f'{engine} sans migration : aucune colonne de bilan')
    check(not page.errors, f'{engine} sans migration : erreurs {page.errors}')
    ctx.close()


def main():
    done = 0
    with sync_playwright() as pw, static_server() as url:
        for engine in ENGINES:
            browser = launch(pw, engine)
            try:
                for w, h, touch in SIZES:
                    for theme in ('dark', 'light'):
                        matrix_case(browser, url, engine, w, h, touch, theme)
                        done += 1
                        print(f'  ok    {engine} {w}px {theme}', flush=True)
                missing_server(browser, url, engine)
                print(f'  ok    {engine} : serveur sans la migration', flush=True)
            finally:
                browser.close()
    print(f'\nBilans de l\'appli web du coach : {done} combinaisons et {len(ENGINES)} parcours OK')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
