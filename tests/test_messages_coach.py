"""Messages coach ↔ élève (app iOS simulée) : non-lus dans le badge de l'onglet Social (Coach pour un coach) et sur « Mon coach »,
cellule « Messages », conversation (bulles, séparateur de jour, envoi, marquée lue, relecture des nouveaux
messages), côté coach (pastille dans Mes élèves, fiche de l'élève), serveur sans messagerie (cellule
cachée), lien rompu (conversation effacée), saisie collée au-dessus de la barre d'onglets.

L'app iOS et Supabase sont simulés (tests/fake_account.py, règles de
supabase/migrations/20261031510000_chat_coach.sql) : aucune requête ne sort.
Captures : $PPL_SCRATCH/shots/lotmessages_coach/.
Lancer : PPL_URL=http://localhost:8845/ PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_messages_coach.py
(ou run_all.py messages_coach).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'messages_coach'
R = Results(LOT)

# Horloge figée à l'heure de Paris (voir « Date et heure dans les tests », ARCHITECTURE.md) : la série échouait
# après minuit en CI (UTC), le message « d'il y a 10 minutes » tombant la veille (22/11, 00 h 09 UTC). Instant
# piégeux par défaut, 5 minutes après minuit ; PPL_HORLOGE='2026-11-22T23:59' (heure de Paris) en essaie un autre.
_H = os.environ.get('PPL_HORLOGE', '2026-11-22T00:05')
NOW = local_ms(int(_H[0:4]), int(_H[5:7]), int(_H[8:10]), int(_H[11:13]), int(_H[14:16]), PARIS)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, ppl_v2=None, opts=None):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, **(opts or {})}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2, extra={'ppl_welcome_seen': '1'})
    settle(page)


def signin(page, username='max'):
    page.evaluate("""async (u) => { await accountSignInWith('apple', async () => 'add'); if (u) await accountSaveProfile({ username: u }); }""", username)
    settle(page)


def coach_calls(page, fn):
    return page.evaluate('f => __sb.calls.filter(c => c[0] === "coach" && c[1] === f).map(c => JSON.parse(c[2]))', fn)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, sel):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); const b = getComputedStyle(e, '::before');
          const pad = b.content !== 'none' && b.position === 'absolute' ? 12 : 0;
          return r.width + pad < 44 || r.height + pad < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page):
    return page.evaluate("""() => [...document.querySelectorAll('#app *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .icon *, .chat-cell__last, .visually-hidden') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""")


def layout(page, t, name):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page, '.chat-compose button, .chat-cell, .navbar button')
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')


def badge(page):
    b = page.locator('.tabbar [data-tab="friends"] .tabbar__badge')
    return b.inner_text() if b.count() else ''


def t_eleve(bench, eng, dev, theme):
    """Élève : 2 messages du coach non lus (hier soir, puis aujourd'hui), badge, cellule, conversation, envoi, relecture."""
    t = tag(dev, theme)
    # Messages placés en jours du calendrier depuis l'horloge figée : la veille à 23 h 58, puis aujourd'hui
    # 10 minutes plus tôt (minuit au plus tôt)
    hier = days_back_ms(NOW, 1, 23, 58, PARIS)
    recent = max(NOW - 600_000, days_back_ms(NOW, 0, 0, 0, PARIS))
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(now_ms=NOW))
        signin(page)
        coach_id = page.evaluate("""([hier, recent]) => { const max = __sb.addPerson({ username: 'coachmax', avatar: '🦁', social: false });
            __sb.makeCoach(max); __sb.link(max, __sb.meId());
            __sb.msg(__sb.meId(), true, 'Salut ! Comment s\\'est passée ta séance ?', hier);
            __sb.msg(__sb.meId(), true, 'Pense à t\\'échauffer\\n\\nsur le squat.', recent);
            return max; }""", [hier, recent])
        page.evaluate('coachRefresh()')
        settle(page)
        R.check(page.evaluate('chatUnreadTotal()') == 2 and badge(page) == '2', f'{t} badge de l\'onglet : 2 messages ({badge(page)!r})')
        page.click('.tabbar [data-tab="friends"]')
        page.wait_for_selector('[data-action="coach-open-mine"]')
        # Élève (17/11) : « Messages » juste sous « Mon coach », la conversation à un toucher avec ses non-lus ; « Mon coach »
        # ne les compte plus une deuxième fois
        row = page.locator('.coach-head .chat-cell--coach')
        R.check(row.count() == 1 and row.locator('.coach-count').inner_text() == '2' and 'Pense à t' in row.inner_text(), f'{t} Social : « Messages » avec 2 non lus')
        R.check(page.locator('[data-action="coach-open-mine"] .coach-count').count() == 0, f'{t} « Mon coach » : pas de doublon des messages')
        page.click('[data-action="coach-open-mine"]')
        page.wait_for_selector('.chat-cell')
        # Information unique : ce que la messagerie permet (liens créés avant elle)
        note = page.locator('.chat-intro-note')
        R.check(note.count() == 1 and 'peut t\'écrire' in note.inner_text() and 'Signale' in note.inner_text(), f'{t} information sur les messages')
        cell = page.locator('.chat-cell')
        R.check('Pense à t\'échauffer' in cell.inner_text() and cell.get_attribute('aria-label') is None and cell.locator('.sr-text').inner_text() == ', 2 non lus,', f'{t} cellule Messages : dernier message et non-lus ({cell.get_attribute("aria-label")!r})')
        shot(page, LOT, f'1-mon-coach-{t}')
        cell.click()
        page.wait_for_selector('.coach-chat-view .chat-msg')
        settle(page)
        R.check(page.locator('.chat-msg--theirs').count() == 2 and page.locator('.chat-msg--mine').count() == 0, f'{t} deux bulles du coach')
        days = page.evaluate("[...document.querySelectorAll('.chat-day')].map(e => e.innerText)")
        R.check(days == ['Hier', 'Aujourd\'hui'], f'{t} séparateurs de jour {days}')
        R.check(page.evaluate("getComputedStyle(document.querySelector('.chat-msg__bubble')).whiteSpace") == 'pre-wrap', f'{t} retours à la ligne gardés')
        R.check(len(coach_calls(page, 'chat_mark_read')) == 1 and page.evaluate('chatUnreadTotal()') == 0 and badge(page) == '', f'{t} ouverte : marquée lue, badge éteint')
        last_id = page.evaluate("Math.max(...__sb.co.msgs.map(m => m.id))")
        R.check(coach_calls(page, 'chat_mark_read')[-1] == {'up_to': last_id}, f'{t} marquée lue jusqu\'au dernier reçu {coach_calls(page, "chat_mark_read")[-1]}')
        R.check(page.get_attribute('#chatList', 'role') == 'log', f'{t} liste annoncée par VoiceOver (role log)')
        # Conversation courte (panel du 06/11) : pas de défilement qui glisse l'intro sous la barre de titre
        top = page.evaluate("[document.querySelector('.chat-intro').getBoundingClientRect().top, document.querySelector('.coach-chat-view .navbar').getBoundingClientRect().bottom, scrollY]")
        R.check(top[0] >= top[1] - 1, f'{t} conversation courte : intro visible sous la barre {top}')
        # Envoi
        send = page.locator('.chat-compose .comment-compose__send')
        R.check(send.is_disabled(), f'{t} Envoyer grisé tant que vide')
        page.fill('#chatInput', 'Oui, 100 kg x 5 !')
        send.click()
        settle(page)
        sent = page.evaluate("__sb.co.msgs.filter(m => !m.fromCoach).map(m => m.body)")
        R.check(sent == ['Oui, 100 kg x 5 !'] and page.locator('.chat-msg--mine').count() == 1 and page.input_value('#chatInput') == '', f'{t} message envoyé {sent}')
        # Saisie collée au-dessus de la barre d'onglets, en bas de l'écran
        pos = page.evaluate("""() => { const c = document.querySelector('.chat-compose').getBoundingClientRect(), tb = document.querySelector('.tabbar').getBoundingClientRect();
            return [Math.round(c.bottom), Math.round(tb.top), Math.round(innerHeight)]; }""")
        R.check(pos[0] <= pos[1] and pos[0] > pos[1] - 64, f'{t} saisie juste au-dessus de la barre d\'onglets {pos}')
        layout(page, t, 'conversation')
        shot(page, LOT, f'2-conversation-{t}')
        # Le coach répond pendant que l'élève écrit : la relecture ajoute la bulle, le brouillon reste
        page.focus('#chatInput')
        page.keyboard.type('Et demain')
        page.evaluate("__sb.msg(__sb.meId(), true, 'Top, bravo')")
        page.evaluate('chatTick()')
        settle(page)
        R.check(page.locator('.chat-msg--theirs').count() == 3 and page.input_value('#chatInput') == 'Et demain'
                and page.evaluate("document.activeElement.id") == 'chatInput', f'{t} relecture pendant la saisie : bulle ajoutée, clavier gardé')
        R.check(coach_calls(page, 'chat_messages')[-1].get('after_id') is not None, f'{t} relecture : seulement les nouveaux (after_id)')
        R.check(len(coach_calls(page, 'chat_mark_read')) >= 2, f'{t} nouveau message affiché : marqué lu')
        # Le coach écrit juste avant ma réponse : son message apparaît au-dessus du mien, sans attendre 15 s
        page.evaluate("__sb.msg(__sb.meId(), true, 'Juste avant toi')")
        page.fill('#chatInput', 'Ma réponse')
        page.click('.chat-compose .comment-compose__send')
        settle(page)
        order = page.evaluate("[...document.querySelectorAll('.chat-msg__bubble')].map(b => b.lastChild.textContent).slice(-2)")
        R.check(order == ['Juste avant toi', 'Ma réponse'], f'{t} message de l\'autre arrivé avant ma réponse : affiché {order}')
        R.check(page.evaluate("__sb.co.reads[__sb.meId()].student") == page.evaluate("Math.max(...__sb.co.msgs.map(m => m.id))"), f'{t} puis marqué lu')
        page.evaluate("document.activeElement.blur()")
        # Menu : Signaler (copie des messages côté serveur, puis alerte)
        page.click('[data-action="chat-menu"]')
        page.wait_for_selector('.ios-dialog')
        R.check('Signaler coachmax' in page.inner_text('.ios-dialog'), f'{t} menu : Signaler')
        tap_dialog(page, 'Signaler coachmax')
        page.wait_for_selector('.ios-dialog >> text=Harcèlement')
        R.check('50 derniers messages' in page.inner_text('.ios-dialog'), f'{t} motif : messages joints annoncés')
        tap_dialog(page, 'Harcèlement')
        page.wait_for_selector('.ios-dialog >> text=Signalement envoyé')
        R.check('gardée' in page.inner_text('.ios-dialog'), f'{t} copie gardée même si le suivi s\'arrête')
        rc = page.evaluate("__sb.co.chatReports")
        R.check(len(rc) == 1 and rc[0]['target'] == coach_id and rc[0]['reason'] == 'harcelement' and len(rc[0]['messages']) == page.evaluate('__sb.co.msgs.length'),
                f'{t} conversation copiée pour l\'équipe')
        R.check(coach_calls(page, 'report_chat') == [{'reason': 'harcelement'}], f'{t} report_chat (avec mon coach)')
        alerts = page.evaluate("__sb.calls.filter(c => c[0] === 'invoke' && c[1] === 'report').map(c => JSON.parse(c[2]))")
        R.check(alerts == [{'report_id': page.evaluate('__sb.so.reports.at(-1).id')}] and page.evaluate('__sb.so.reports.at(-1).notified'), f'{t} alerte demandée {alerts}')
        tap_dialog(page, 'OK')
        # Le coach me retire : conversation effacée
        page.evaluate(f"__sb.co.links = __sb.co.links.filter(l => l.student !== __sb.meId()); __sb.co.msgs = []; coachRefresh()")
        settle(page)
        R.check('supprimés' in page.inner_text('.coach-chat-view'), f'{t} lien rompu : conversation effacée ({page.inner_text(".coach-chat-view")[:80]!r})')
        R.check(len(page.evaluate("__sb.co.chatReports")[0]['messages']) > 0, f'{t} lien rompu : la copie signalée reste')
        # Information vue (conversation ouverte) : plus redite
        R.check(page.evaluate("localStorage.getItem('mdlf_chat_intro_seen')") == '1', f'{t} information notée vue')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_coach(bench, eng, dev, theme):
    """Coach : pastille des messages dans Mes élèves, cellule sur la fiche de l'élève, envoi à cet élève seulement."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page)
        ids = page.evaluate("""() => { const me = __sb.meId(); __sb.makeCoach(me);
            const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false });
            const tom = __sb.addPerson({ username: 'tom', social: false });
            __sb.link(me, lea); __sb.link(me, tom);
            __sb.msg(lea, false, 'J\\'ai mal au genou droit', Date.now() - 3600e3);
            return { lea, tom }; }""")
        page.evaluate('coachRefresh()')
        settle(page)
        R.check(badge(page) == '1', f'{t} badge de l\'onglet : 1 message ({badge(page)!r})')
        page.click('.tabbar [data-tab="friends"]')
        page.wait_for_selector('.coach-team .coach-student-row')   # onglet Coach : ses élèves d'abord
        lea_row = page.locator(f'.coach-student-row[data-uid="{ids["lea"]}"]')
        R.check(lea_row.locator('.chat-count').count() == 1 and '1 message non lu' in lea_row.inner_text(), f'{t} Mes élèves : pastille des messages de Léa')
        R.check(page.locator(f'.coach-student-row[data-uid="{ids["tom"]}"] .chat-count').count() == 0, f'{t} Tom : rien')
        shot(page, LOT, f'3-mes-eleves-{t}')
        lea_row.click()
        page.wait_for_selector('.chat-cell')
        page.locator('.chat-cell').scroll_into_view_if_needed()
        page.click('.chat-cell')
        page.wait_for_selector('.coach-chat-view .chat-msg')
        settle(page)
        bar = page.evaluate("[document.querySelector('#app .navbar__back-label')?.dataset.full, document.querySelector('#app .navbar__title').textContent.trim()]")
        R.check(bar[1] == 'Messages' and bar[0] != bar[1], f'{t} conversation ouverte depuis la fiche : « ‹ lea · Messages », pas « lea » deux fois {bar}')
        # Un seul message (panel du 06/11) : l'intro ne passe pas sous la barre de titre
        top = page.evaluate("[document.querySelector('.chat-intro').getBoundingClientRect().top, document.querySelector('.coach-chat-view .navbar').getBoundingClientRect().bottom, scrollY]")
        R.check(top[0] >= top[1] - 1, f'{t} coach, conversation courte : intro visible sous la barre {top}')
        page.fill('#chatInput', 'Repos 2 jours, puis on adapte.')
        page.click('.chat-compose .comment-compose__send')
        settle(page)
        msgs = page.evaluate("__sb.co.msgs.map(m => [m.student, m.fromCoach, m.body])")
        R.check(msgs[-1] == [ids['lea'], True, 'Repos 2 jours, puis on adapte.'], f'{t} envoyé à Léa seulement {msgs[-1]}')
        R.check(coach_calls(page, 'chat_send')[-1].get('student') == ids['lea'], f'{t} chat_send(student : Léa)')
        layout(page, t, 'conversation du coach')
        shot(page, LOT, f'4-conversation-coach-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_sans_serveur(bench, eng, dev, theme):
    """Serveur sans messagerie (migration pas encore appliquée) : cellule cachée, aucune erreur."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page)
        page.evaluate("""() => { __sb.fail.chat = 'missing'; const max = __sb.addPerson({ username: 'coachmax', social: false });
            __sb.makeCoach(max); __sb.link(max, __sb.meId()); }""")
        page.evaluate('coachRefresh()')
        settle(page)
        page.click('.tabbar [data-tab="friends"]')
        page.wait_for_selector('[data-action="coach-open-mine"]')
        page.click('[data-action="coach-open-mine"]')
        page.wait_for_selector('.coach-mine-view')
        settle(page)
        R.check(page.locator('.chat-cell').count() == 0, f'{t} serveur sans messagerie : pas de cellule')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# Geste de retour depuis le bord, arrêté à mi-chemin (js/ui/edge-swipe.js). Le geste écoute les événements touch
# (des pointer events seraient annulés par le défilement d'iOS) et Playwright n'a pas de glissement tactile ; WebKit
# refuse new Touch() hors d'un vrai écran tactile : les événements sont construits à la main (touches, clientX),
# seuls champs lus par le geste. Ainsi le test tourne aussi dans WebKit.
EDGE_HALF = """async () => {
    const fire = (type, x) => { const e = new Event(type, { bubbles: true }), t = [{ identifier: 1, clientX: x, clientY: 400 }];
      Object.defineProperty(e, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : t });
      Object.defineProperty(e, 'changedTouches', { value: t }); document.dispatchEvent(e); };
    fire('touchstart', 6);
    for (let x = 20; x <= innerWidth / 2; x += 25) { fire('touchmove', x); await new Promise(r => setTimeout(r, 30)); }
    const c = document.querySelector('.edge-layer--current'), ta = c?.querySelector('textarea');
    const r = { layer: !!c, under: !!document.querySelector('.edge-layer:not(.edge-layer--current)'), value: ta ? ta.value : null,
      menu: (c?.querySelector('[data-action="chat-menu"]')?.getBoundingClientRect().width || 0) >= 44, sent: c ? c.innerHTML.includes('10 minutes au poids du corps') : null };
    // Doigt ramené vers le bord puis levé lentement : geste abandonné, l'écran reste (vitesse et distance faibles)
    fire('touchmove', 12); await new Promise(r => setTimeout(r, 600)); fire('touchend', 12);
    return r;
}"""


def o_retour_apres_envoi(bench):
    """Coach : message envoyé à lilou, puis geste de retour arrêté à mi-chemin. L'écran qui glisse est l'écran
    réel : saisie vide (pas le texte envoyé, vu le 16/11), bouton ⋯ présent, fiche de lilou dessous."""
    for eng, dev in (('webkit', 'iPhone 13'), ('chromium', 'Pixel 7')):
        t = tag(dev, 'light')
        with bench.page(eng, dev, 'light') as page:
            page.add_init_script("Object.defineProperty(navigator, 'standalone', { get: () => true })")
            open_app(page, 'light', ppl_v2_today_json())
            signin(page)
            lilou = page.evaluate("""() => { const me = __sb.meId(); __sb.makeCoach(me);
                const p = __sb.addPerson({ username: 'lilou', social: false }); __sb.link(me, p); return p; }""")
            page.evaluate('coachRefresh()')
            settle(page)
            page.click('.tabbar [data-tab="friends"]')
            page.click(f'.coach-student-row[data-uid="{lilou}"]')
            page.wait_for_selector('.chat-cell')
            page.locator('.chat-cell').scroll_into_view_if_needed()
            page.click('.chat-cell')
            page.wait_for_selector('#chatInput')
            settle(page)
            text = 'Aujourd\'hui, 10 minutes au poids du corps. Quand tu veux… Love ❤️'
            page.focus('#chatInput')
            page.keyboard.type(text[:20])
            # Écran redessiné en entier pendant la frappe (fin de saisie, retour au premier plan) : le brouillon
            # devient le contenu de départ du <textarea> dans le HTML
            page.evaluate('document.activeElement.blur(); render()')
            page.focus('#chatInput')
            page.keyboard.type(text[20:])
            page.click('.chat-compose .comment-compose__send')
            settle(page)
            page.evaluate('document.activeElement.blur()')
            R.check(page.input_value('#chatInput') == '' and page.locator('.chat-msg--mine').count() == 1, f'{t} message envoyé, saisie vide')
            r = page.evaluate(EDGE_HALF)
            R.check(r['layer'] and r['under'], f'{t} geste à mi-chemin : écran courant qui glisse, fiche dessous {r}')
            R.check(r['value'] == '' and not r['sent'], f'{t} geste de retour : saisie vide, pas le message envoyé {r}')
            R.check(r['menu'], f'{t} geste de retour : bouton ⋯ présent {r}')
            settle(page)
            R.check(page.locator('.edge-layer').count() == 0 and page.locator('#app .coach-chat-view').count() == 1
                    and page.input_value('#chatInput') == '', f'{t} geste abandonné : conversation intacte')
            R.check(not page.errors, f'{t} geste : aucune erreur JS {page.errors}')


def o_minuit(bench):
    """Conversation ouverte au passage de minuit (heure de Paris) : sans nouveau message, « Aujourd'hui » devient
    « Hier » à la relecture suivante ; un message arrivé après minuit ouvre « Aujourd'hui »."""
    avant = local_ms(2026, 11, 21, 23, 59, PARIS) + 50_000          # 23:59:50
    for eng, dev in (('webkit', 'iPhone 13'), ('chromium', 'Pixel 7')):
        t = tag(dev, 'light')
        with bench.frozen_page(avant, eng, dev, 'light') as page:
            open_app(page, 'light', ppl_v2_today_json(now_ms=avant))
            signin(page)
            page.evaluate("""at => { const max = __sb.addPerson({ username: 'coachmax', social: false });
                __sb.makeCoach(max); __sb.link(max, __sb.meId()); __sb.msg(__sb.meId(), true, 'Bonne nuit', at); }""",
                          local_ms(2026, 11, 21, 23, 50, PARIS))
            page.evaluate('coachRefresh()')
            settle(page)
            page.click('.tabbar [data-tab="friends"]')
            page.click('[data-action="coach-open-mine"]')
            page.click('.chat-cell')
            page.wait_for_selector('.coach-chat-view .chat-msg')
            days = lambda: page.evaluate("[...document.querySelectorAll('.chat-day')].map(e => e.innerText)")
            R.check(days() == ['Aujourd\'hui'], f'{t} 23 h 59 : « Aujourd\'hui » {days()}')
            page.clock.fast_forward(20_000)                            # 00:00:10, relecture des 15 s passée
            page.evaluate('chatTick()')
            settle(page)
            R.check(days() == ['Hier'], f'{t} minuit passé, aucun nouveau message : « Hier » {days()}')
            page.evaluate("__sb.msg(__sb.meId(), true, 'Debout !')")
            page.evaluate('chatTick()')
            settle(page)
            R.check(days() == ['Hier', 'Aujourd\'hui'], f'{t} message après minuit : sous « Aujourd\'hui » {days()}')
            R.check(not page.errors, f'{t} minuit : aucune erreur JS {page.errors}')


run_main(R, [t_eleve, t_coach, t_sans_serveur], once=[o_retour_apres_envoi, o_minuit])
