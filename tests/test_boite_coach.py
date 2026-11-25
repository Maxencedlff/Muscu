"""Boîte de réception du coach (17/11) : segment « Élèves | Messages | Mes amis » de l'onglet Coach, liste des
conversations façon Messages d'iOS (non-lues en tête, recherche, affichage progressif), pastille de l'onglet qui
compte les messages non lus (plus les nouvelles séances), cloche barrée des élèves sans notifications, filtres de
Mes élèves au-delà de 20 élèves (compteurs exacts), envoi d'un programme à plusieurs élèves (limite 30 + 2 par élève,
refus qui dit 24 h), toucher d'une notification (message : la conversation sur le segment Messages ; résumé des
séances : Élèves filtré sur Nouveautés).

L'app iOS et Supabase sont simulés (tests/fake_account.py) : aucune requête ne sort.
Captures : $PPL_SCRATCH/shots/lotboite_coach/.
Lancer : PPL_URL=http://localhost:8845/ PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_boite_coach.py
(ou run_all.py boite_coach).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'boite_coach'
R = Results(LOT)
N = 50   # élèves : filtres (au-delà de 20) et affichage progressif (40 d'abord)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, opts=None):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, **(opts or {})}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
    settle(page)
    page.evaluate("""async () => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: 'coachmax' }); }""")
    settle(page)


# Coach de N élèves : 12 avec des messages (4 non lus), les 10 premiers ont de nouvelles séances, un sur trois a un
# iPhone inscrit avec « Messages » allumé (les autres : cloche barrée), 5 avec un programme envoyé
SETUP = """(n) => {
  const me = __sb.meId(); __sb.makeCoach(me); __sb.setTier(me, 'com.mdlf.training.coachmax.yearly');
  const now = Date.now(), ids = [];
  for (let i = 0; i < n; i++) {
    const s = i < 10 ? [{ id: 's' + i, date: now - 3600e3, duration: 3000e3, programme: 'ppl', category: 'push', label: 'Push', exercises: [] }] : [];
    const id = __sb.addPerson({ username: 'eleve' + String(i).padStart(2, '0'), avatar: ['🦊', '🐻', '🦁'][i % 3], social: false, sessions: s });
    __sb.link(me, id, now - 30 * 86400e3);
    ids.push(id);
  }
  for (let i = 0; i < 12 && i * 3 < n; i++) {
    __sb.msg(ids[i * 3], true, 'Top, on monte de 2,5 kg sur le développé couché la semaine prochaine', now - (20 - i) * 3600e3);
    if (i < 4) __sb.msg(ids[i * 3], false, 'Séance faite, ressenti correct ' + i, now - (10 - i) * 600e3);
  }
  ids.forEach((id, i) => { if (i % 3 === 0) { __sb.push.devices['d'.repeat(60) + String(i).padStart(4, '0')] = id; __sb.push.prefs[id] = { messages: true }; } });
  __sb.co.links.forEach(l => { if (l.coach === me) l.seen = now - 7200e3; });
  return ids;
}"""


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, sel):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); const b = getComputedStyle(e, '::before');
          const pad = b.content !== 'none' && b.position === 'absolute' ? 12 : 0;
          return r.width + pad < 44 || r.height + pad < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page):
    # Dernier message d'une conversation : coupé par « … » à dessein (comme Messages d'iOS)
    return page.evaluate("""() => [...document.querySelectorAll('#app *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .icon *, .chat-row__last, .chat-row__name, .chat-cell__last, .visually-hidden') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""")


def layout(page, t, name, sel):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page, sel)
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')


def badge(page):
    b = page.locator('.tabbar [data-tab="friends"] .tabbar__badge')
    return b.inner_text() if b.count() else ''


def coach_calls(page, fn):
    return page.evaluate('f => __sb.calls.filter(c => c[0] === "coach" && c[1] === f).length', fn)


def t_boite(bench, eng, dev, theme):
    """Segments, Messages (ordre, recherche, cloche, ouverture), filtres et pages de Mes élèves, grand texte."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        ids = page.evaluate(SETUP, N)
        page.evaluate('coachRefresh()')
        settle(page)
        # Pastille de l'onglet : les 4 messages non lus, pas les 10 élèves aux nouvelles séances
        R.check(badge(page) == '4', f'{t} pastille de l\'onglet Coach : messages non lus ({badge(page)!r})')
        page.click('.tabbar [data-tab="friends"]')
        page.wait_for_selector('.coach-team .coach-student-row')
        settle(page)
        segs = page.evaluate("[...document.querySelectorAll('.social-seg .segmented__btn')].map(b => b.dataset.seg)")
        R.check(segs == ['students', 'messages', 'friends'], f'{t} segments Élèves | Messages | Mes amis {segs}')
        R.check(page.locator('.social-seg [data-seg="messages"] .seg-count').inner_text() == '4', f'{t} segment Messages : 4')
        # Filtres de Mes élèves : compteurs exacts
        counts = page.evaluate("Object.fromEntries([...document.querySelectorAll('.coach-filter')].map(b => [b.dataset.filter, +b.querySelector('.coach-filter__n').textContent]))")
        R.check(counts.get('all') == N and counts.get('fresh') == 10 and counts.get('noprog') == N, f'{t} filtres et compteurs {counts}')
        R.check(page.locator('.coach-student-row').count() == 40 and page.locator('.coach-more-rows').count() == 1, f'{t} 40 cartes d\'abord, puis « Afficher »')
        page.locator('.coach-more-rows').scroll_into_view_if_needed()
        settle(page)
        R.check(page.locator('.coach-student-row').count() == N, f'{t} la suite en défilant ({page.locator(".coach-student-row").count()})')
        page.evaluate('scrollTo(0, 0)')
        page.click('.coach-filter[data-filter="fresh"]')
        settle(page)
        R.check(page.locator('.coach-student-row').count() == 10, f'{t} filtre Nouveautés : 10 élèves')
        R.check(page.locator('.push-off-mark').count() > 0, f'{t} cloche barrée dans Mes élèves')
        page.fill('#coachSearch', 'eleve03')
        settle(page)
        R.check(page.locator('.coach-student-row').count() == 1 and page.evaluate("document.activeElement.id") == 'coachSearch', f'{t} recherche dans le filtre, clavier gardé')
        page.fill('#coachSearch', '')
        page.click('.coach-filter[data-filter="all"]')
        layout(page, t, 'Mes élèves', '.coach-filter, .social-seg .segmented__btn, .coach-student-row')
        shot(page, LOT, f'1-eleves-{t}')
        # Messages
        page.click('.social-seg [data-seg="messages"]')
        page.wait_for_selector('#chatRows .chat-row')
        settle(page)
        rows = page.evaluate("[...document.querySelectorAll('#chatRows .chat-row')].map(r => [r.dataset.key, r.classList.contains('chat-row--unread'), !!r.querySelector('.push-off-mark')])")
        R.check(len(rows) == 12, f'{t} 12 conversations ({len(rows)})')
        R.check([r[1] for r in rows[:4]] == [True] * 4 and not any(r[1] for r in rows[4:]), f'{t} non-lues en tête')
        R.check(rows[0][0] == ids[9], f'{t} la plus récente des non-lues d\'abord')
        R.check(all(r[2] is False for r in rows), f'{t} élèves avec « Messages » allumé : pas de cloche')
        R.check(page.locator('#chatRows .chat-row').first.locator('.coach-count').inner_text() == '1', f'{t} pastille de non-lus sur la ligne')
        last = page.evaluate("getComputedStyle(document.querySelector('.chat-row__last')).whiteSpace")
        R.check(last == 'nowrap', f'{t} dernier message sur une ligne ({last})')
        layout(page, t, 'Messages', '.chat-row, .social-seg .segmented__btn')
        shot(page, LOT, f'2-messages-{t}')
        page.fill('#chatSearch', 'eleve01')
        settle(page)
        found = page.evaluate("[...document.querySelectorAll('#chatRows .chat-row')].map(r => r.querySelector('.chat-row__name').textContent)")
        R.check(found == ['eleve01'], f'{t} recherche : élève sans conversation trouvé {found}')
        R.check(page.locator('#chatRows .push-off-mark').count() == 1, f'{t} eleve01 sans notifications : cloche barrée')
        page.fill('#chatSearch', '')
        settle(page)
        page.locator('#chatRows .chat-row').first.click()
        page.wait_for_selector('.coach-chat-view .chat-msg')
        settle(page)
        R.check(page.evaluate('currentRoute()') == f'coach-chat:{ids[9]}', f'{t} un toucher ouvre la conversation')
        R.check(badge(page) == '3', f'{t} conversation lue : pastille à 3 ({badge(page)!r})')
        page.evaluate('goBack()')
        page.wait_for_selector('#chatRows')
        settle(page)
        R.check(page.evaluate('friendsSeg()') == 'messages', f'{t} retour sur Messages')
        # Grand texte : rien de coupé, pas de défilement de côté
        page.evaluate("document.documentElement.classList.add('type-xl'); render()")
        settle(page)
        layout(page, t, 'Messages, grand texte', '.chat-row, .social-seg .segmented__btn')
        shot(page, LOT, f'3-messages-grand-texte-{t}')
        page.click('.social-seg [data-seg="students"]')
        settle(page)
        layout(page, t, 'Mes élèves, grand texte', '.coach-filter, .social-seg .segmented__btn')
        shot(page, LOT, f'4-eleves-grand-texte-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def o_notifications(bench):
    """Toucher d'une notification : message → conversation (segment Messages dessous) ; résumé → Nouveautés."""
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        open_app(page, 'light')
        ids = page.evaluate(SETUP, 25)
        page.evaluate('coachRefresh()')
        settle(page)
        page.evaluate(f"openPushTarget({{ kind: 'chat_message', ref: '{ids[3]}' }})")
        page.wait_for_selector('.coach-chat-view')
        settle(page)
        R.check(page.evaluate('currentRoute()') == f'coach-chat:{ids[3]}', 'notification de message : la conversation')
        page.evaluate('goBack()')
        settle(page)
        R.check(page.evaluate('friendsSeg()') == 'messages' and page.locator('#chatRows').count() == 1, 'retour : boîte de réception')
        page.evaluate("switchTab('train', { reset: true })")
        settle(page)
        page.evaluate("openPushTarget({ kind: 'student_digest', ref: '' })")
        settle(page)
        R.check(page.evaluate('friendsSeg()') == 'students' and page.evaluate('coachFilter') == 'fresh', 'résumé des séances : Élèves, Nouveautés')
        R.check(page.locator('.coach-filter--on').get_attribute('data-filter') == 'fresh', 'filtre Nouveautés affiché')
        R.check(not page.errors, f'notifications : aucune erreur JS {page.errors}')


def o_envoi_groupe(bench):
    """Programme › Envoyer › Envoyer à plusieurs élèves : Tous, envoi, limite 30 + 2 par élève qui dit 24 h."""
    with bench.page('webkit', 'iPhone SE', 'dark') as page:
        open_app(page, 'dark')
        ids = page.evaluate(SETUP, 25)
        page.evaluate('coachRefresh()')
        settle(page)
        prog = page.evaluate('coachSendableProgrammes()[0]')
        R.check(bool(prog), f'un programme à envoyer ({prog})')
        page.click('.tabbar [data-tab="friends"]')
        settle(page)
        page.evaluate(f"navigate(makeRoute('coach-student', '{ids[0]}')); navigate(makeRoute('coach-send', '{ids[0]}', '{prog}'))")
        page.wait_for_selector('[data-action="coach-send-many"]')
        page.click('[data-action="coach-send-many"]')
        page.wait_for_selector('.coach-send-many-view')
        R.check(page.locator('.coach-pick--on[data-uid]').count() == 1, 'l\'élève d\'origine coché d\'office')
        page.click('[data-action="coach-many-all"]')
        settle(page)
        R.check(page.inner_text('#coachManyGo') == 'Envoyer à 25 élèves', f'« Tous » : {page.inner_text("#coachManyGo")!r}')
        R.check('80 sur 24 heures' in page.inner_text('.coach-send-many-view'), 'limite annoncée : 30 + 2 × 25')
        layout(page, 'iPhone_SE-dark', 'envoi groupé', '.coach-pick, #coachManyGo')
        shot(page, LOT, '5-envoi-groupe-iPhone_SE-dark')
        page.click('#coachManyGo')
        settle(page)
        sent = page.evaluate(f"__sb.co.progs.filter(p => p.id === '{prog}').length")
        R.check(sent == 25, f'envoyé aux 25 élèves ({sent})')
        R.check(page.evaluate('currentView()') == 'coach-student', f'retour à la fiche ({page.evaluate("currentView()")})')
        # Limite atteinte : 80 envois en 24 h ; 25 de plus refusés à partir du 56e
        page.evaluate(f"navigate(makeRoute('coach-send', '{ids[0]}', '{prog}'))")
        page.wait_for_selector('[data-action="coach-send-many"]')
        page.click('[data-action="coach-send-many"]')
        page.wait_for_selector('.coach-send-many-view')
        page.click('[data-action="coach-many-all"]')
        settle(page)
        page.evaluate("__sb.co.sends[__sb.meId()] = 70")
        page.click('#coachManyGo')
        page.wait_for_selector('.ios-dialog')
        msg = page.inner_text('.ios-dialog')
        R.check('24 h' in msg and 'une heure' not in msg, f'refus : la vraie durée {msg!r}')
        R.check('Envoyé à 10 sur 25' in msg, f'refus : combien sont partis {msg!r}')
        tap_dialog(page, 'OK')
        R.check(page.inner_text('#coachManyGo') == 'Envoyer à 15 élèves', f'les élèves à refaire restent cochés {page.inner_text("#coachManyGo")!r}')
        R.check(not page.errors, f'envoi groupé : aucune erreur JS {page.errors}')


def o_eleve(bench):
    """Élève : « Messages » à un toucher depuis Social, avec sa pastille."""
    with bench.page('webkit', 'iPhone SE', 'light') as page:
        open_app(page, 'light')
        page.evaluate("""() => { const c = __sb.addPerson({ username: 'kevin', social: false }); __sb.makeCoach(c); __sb.link(c, __sb.meId());
            __sb.msg(__sb.meId(), true, 'Pense à t\\'échauffer', Date.now() - 600e3); }""")
        page.evaluate('coachRefresh()')
        settle(page)
        page.click('.tabbar [data-tab="friends"]')
        page.wait_for_selector('.chat-cell--coach')
        R.check(page.locator('.chat-cell--coach .coach-count').inner_text() == '1', 'Social : « Messages » avec 1 non lu')
        page.click('.chat-cell--coach')
        page.wait_for_selector('.coach-chat-view .chat-msg')
        R.check(page.evaluate('currentRoute()') == 'coach-chat:%40coach', f'un toucher : la conversation ({page.evaluate("currentRoute()")})')
        R.check(not page.errors, f'élève : aucune erreur JS {page.errors}')


run_main(R, [t_boite], once=[o_notifications, o_envoi_groupe, o_eleve])
