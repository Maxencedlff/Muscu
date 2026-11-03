"""Commentaires sur une séance (app iOS simulée) : écrire sur la séance d'un ami (compteur, mot interdit
refusé, brouillon gardé), menu ⋯ d'un commentaire (Signaler puis Bloquer, Supprimer le mien), ma séance
dans l'Historique (supprimer celui d'un ami, séance masquée en lecture seule), ligne « a commenté » dans
l'activité de Mon profil et pastille, hors ligne, saisie qui garde le clavier quand l'état change,
réponses rapides (un toucher = un commentaire).

L'app iOS et Supabase sont simulés (tests/fake_account.py, règles de
supabase/migrations/20261031500000_commentaires.sql) : aucune requête ne sort.
Captures : $PPL_SCRATCH/shots/lotcommentaires/.
Lancer : PPL_URL=http://localhost:8845/ PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_commentaires.py
(ou run_all.py commentaires).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'commentaires'
R = Results(LOT)
DAY = 86400_000


# Mêmes outils que test_reactions.py (un import relancerait ses tests)
def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, ppl_v2=None, opts=None):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, **(opts or {})}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2, extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username='max', enable=True):
    page.evaluate("""async ([u, en]) => {
        await accountSignInWith('apple', async () => 'add');
        if (u) await accountSaveProfile({ username: u });
        if (en) await socialEnable(true);
    }""", [username, enable])
    page.wait_for_timeout(200)


def sessions(prefix, n, start_days=1):
    import time
    now = int(time.time() * 1000)
    return [{'id': f'{prefix}{i:02d}', 'date': now - (start_days + i) * DAY, 'duration': 50 * 60_000,
             'programme': 'ppl', 'category': 'push', 'label': 'Push',
             'exercises': [{'name': 'Développé couché', 'sets': [{'weight': '80', 'reps': '8'}]}]} for i in range(n)]


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
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .icon *, .visually-hidden') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""")


def toast(page):
    return page.locator('.toast').inner_text() if page.locator('.toast').count() else ''


def layout(page, t, name):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page, '.comments button, .comment-compose button')
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')


def setup(page):
    """Léa (suivie, me suit, 2 séances) ; Paul (suit Léa et me suit) a commenté la séance de Léa ; mes
    séances envoyées ; Léa a commenté ma plus récente il y a 1 h (nouveauté)."""
    page.evaluate('syncNow()')
    page.wait_for_timeout(300)
    return page.evaluate("""(s) => {
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', sessions: s });
        const paul = __sb.addPerson({ username: 'paul', avatar: '🐻' });
        const me = __sb.meId(), t = Date.now();
        __sb.follow(me, lea); __sb.follow(lea, me); __sb.follow(paul, lea); __sb.follow(paul, me);
        __sb.so.at[me] = t - 30 * 86400e3;
        __sb.so.follows.forEach(f => { f.at = t - 40 * 86400e3; });
        __sb.comment(paul, lea, s[0].id, 'Grosse séance 💪', t - 3 * 3600e3);
        const sid = data.history[0].id;
        __sb.comment(lea, me, sid, 'Bravo pour le développé !', t - 3600e3);
        return { lea, paul, me, sid, leaSid: s[0].id };
    }""", sessions('l', 2))


def open_friend_session(page):
    page.click('.tabbar [data-tab="friends"]')
    page.wait_for_selector('.feed-card')
    page.locator('.feed-card').first.locator('.feed-card__main').click()
    page.wait_for_selector('.social-session-view .comments .comment')
    page.wait_for_timeout(300)


def t_ecrire(bench, eng, dev, theme):
    """Séance d'un ami : liste, saisie, envoi, compteur, mot interdit, Signaler puis Bloquer."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page)
        ids = setup(page)
        open_friend_session(page)
        txt = page.inner_text('.comments')
        R.check('paul' in txt and 'Grosse séance 💪' in txt and 'il y a 3 h' in txt, f'{t} commentaire de Paul affiché ({txt!r})')
        send = page.locator('.comment-compose__send')
        R.check(send.is_disabled(), f'{t} Envoyer grisé tant que le champ est vide')
        R.check(page.get_attribute('#commentInput', 'aria-describedby') == 'commentCount' and page.get_attribute('#commentInput', 'aria-label') == 'Ajouter un commentaire', f'{t} champ nommé pour VoiceOver')
        # Compteur près de la limite, bouton grisé au-delà
        page.fill('#commentInput', 'a' * 460)
        R.check(page.inner_text('#commentCount') == '460 / 500' and not send.is_disabled(), f'{t} compteur à 460 ({page.inner_text("#commentCount")!r})')
        page.fill('#commentInput', 'a' * 501)
        R.check(send.is_disabled() and 'is-over' in page.get_attribute('#commentCount', 'class'), f'{t} 501 caractères : envoi impossible')
        # Mot interdit : refus du serveur, brouillon gardé
        page.fill('#commentInput', 'Quel connard')
        send.click()
        page.wait_for_timeout(400)
        R.check('mot interdit' in toast(page) and page.input_value('#commentInput') == 'Quel connard', f'{t} mot interdit refusé, brouillon gardé ({toast(page)!r})')
        R.check(page.evaluate("__sb.so.comments.filter(c => c.user === __sb.meId()).length") == 0, f'{t} rien écrit sur le serveur')
        # Envoi : en bas de la liste, champ vidé
        page.fill('#commentInput', '  Belle perf\n\n\n\nLéa  ')
        send.click()
        page.wait_for_timeout(500)
        mine = page.evaluate("__sb.so.comments.filter(c => c.user === __sb.meId()).map(c => [c.owner, c.sid, c.body])")
        R.check(mine == [[ids['lea'], ids['leaSid'], 'Belle perf\n\nLéa']], f'{t} commentaire envoyé, nettoyé {mine}')
        last = page.locator('.comments .comment').last
        R.check('Belle perf' in last.inner_text() and page.input_value('#commentInput') == '' and send.is_disabled(), f'{t} affiché en bas, champ vidé')
        R.check(page.evaluate("getComputedStyle(document.querySelector('.comments .comment:last-child .comment__body')).whiteSpace") == 'pre-wrap', f'{t} retours à la ligne gardés')
        layout(page, t, 'séance d\'un ami')
        page.evaluate("document.querySelector('.comment-compose').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'1-commentaires-ami-{t}')
        # Saisie en cours : un changement d'état ne redessine que la liste, le champ garde le focus
        page.focus('#commentInput')
        page.keyboard.type('Encore')
        page.evaluate('notifySocial()')
        page.wait_for_timeout(200)
        R.check(page.evaluate("document.activeElement && document.activeElement.id") == 'commentInput' and page.input_value('#commentInput') == 'Encore', f'{t} focus et brouillon gardés pendant la saisie')
        page.evaluate("document.activeElement.blur()")
        # Menu ⋯ du commentaire de Paul : Signaler (pas Supprimer), puis Bloquer
        page.locator('.comments .comment').first.locator('[data-action="comment-menu"]').click()
        page.wait_for_selector('.ios-dialog')
        btns = page.evaluate("[...document.querySelectorAll('.ios-dialog__btn')].map(b => b.innerText.trim())")
        R.check('Signaler' in btns and 'Supprimer' not in btns, f'{t} menu d\'un autre : Signaler seulement {btns}')
        tap_dialog(page, 'Signaler')
        tap_dialog(page, 'Harcèlement')
        page.wait_for_timeout(400)
        rep = page.evaluate("__sb.so.comments.find(c => c.body === 'Grosse séance 💪').reporters")
        R.check(rep == [page.evaluate('__sb.meId()')], f'{t} signalement envoyé {rep}')
        # Alerte par e-mail : demandée à la fonction Edge report pour la ligne de la file commune
        alerts = page.evaluate("__sb.calls.filter(c => c[0] === 'invoke' && c[1] === 'report').map(c => JSON.parse(c[2]))")
        row = page.evaluate("__sb.so.reports.find(r => r.target_ref && r.target_ref.startsWith('comment_reports:'))")
        R.check(row and alerts[-1:] == [{'report_id': row['id']}] and row['notified'] and row['details'] == 'Grosse séance 💪',
                f'{t} alerte du signalement demandée {alerts} {row}')
        R.check(page.locator('.ios-dialog').count() == 1 and 'bloquer paul' in page.inner_text('.ios-dialog').lower(), f'{t} proposition de bloquer Paul')
        tap_dialog(page, 'Bloquer')
        page.wait_for_timeout(500)
        R.check(page.evaluate(f"__sb.so.blocks.some(k => k.blocker === __sb.meId() && k.blocked === '{ids['paul']}')"), f'{t} Paul bloqué')
        R.check(page.locator('.social-session-view').count() == 1 and 'Grosse séance' not in page.inner_text('.comments'), f'{t} on reste sur la séance de Léa, sans le commentaire de Paul')
        # Mon commentaire : Supprimer (sans Signaler)
        page.locator('.comments .comment').last.locator('[data-action="comment-menu"]').click()
        page.wait_for_selector('.ios-dialog')
        btns = page.evaluate("[...document.querySelectorAll('.ios-dialog__btn')].map(b => b.innerText.trim())")
        R.check('Supprimer' in btns and 'Signaler' not in btns, f'{t} mon commentaire : Supprimer seulement {btns}')
        tap_dialog(page, 'Supprimer')
        page.wait_for_timeout(400)
        R.check(page.evaluate("__sb.so.comments.filter(c => c.user === __sb.meId()).length") == 0 and 'Belle perf' not in page.inner_text('.comments'), f'{t} mon commentaire supprimé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_ma_seance(bench, eng, dev, theme):
    """Activité « lea a commenté ta séance », pastille, Historique › Séance : supprimer, séance masquée."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page)
        ids = setup(page)
        page.evaluate('socialRefresh()')
        page.wait_for_timeout(300)
        R.check(page.evaluate('socialActivityNew()') == 1, f'{t} pastille : le commentaire de Léa est une nouveauté')
        page.click('.tabbar [data-tab="friends"]')
        page.wait_for_timeout(400)
        page.click('.navbar [data-action="social-me"]')
        page.wait_for_selector('.social-me-view .activity')
        page.wait_for_timeout(400)
        row = page.locator('.activity-row', has_text='a commenté').first
        R.check(row.count() == 1 and 'lea a commenté ta séance' in row.inner_text() and '« Bravo pour le développé ! »' in row.inner_text(), f'{t} activité : ligne du commentaire ({row.inner_text() if row.count() else None!r})')
        R.check(row.locator('.activity-row__new').count() == 1, f'{t} activité : nouveauté marquée')
        shot(page, LOT, f'2-activite-{t}')
        row.locator('[data-action="social-open-my-session"]').click()
        page.wait_for_selector('.history-detail .comments .comment')
        page.wait_for_timeout(300)
        R.check('Bravo pour le développé !' in page.inner_text('.history-detail .comments'), f'{t} Historique › Séance : commentaire de Léa')
        # Ma séance : je peux supprimer celui de Léa (avec confirmation) ; Signaler aussi
        page.locator('.history-detail .comment').first.locator('[data-action="comment-menu"]').click()
        page.wait_for_selector('.ios-dialog')
        btns = page.evaluate("[...document.querySelectorAll('.ios-dialog__btn')].map(b => b.innerText.trim())")
        R.check('Supprimer' in btns and 'Signaler' in btns, f'{t} ma séance : Supprimer et Signaler {btns}')
        tap_dialog(page, 'Supprimer')
        R.check('ne sera pas prévenu' in page.inner_text('.ios-dialog'), f'{t} confirmation avant de supprimer celui d\'un autre')
        page.locator('.ios-dialog__btn--destructive').click()
        page.wait_for_timeout(400)
        R.check(page.evaluate('__sb.so.comments.length') == 1 and page.locator('.history-detail .comment').count() == 0, f'{t} commentaire de Léa supprimé')
        # Je réponds sur ma séance
        page.fill('#commentInput', 'Merci !')
        page.click('.comment-compose__send')
        page.wait_for_timeout(400)
        R.check(page.locator('.history-detail .comment').count() == 1, f'{t} réponse sur ma séance')
        layout(page, t, 'Historique › Séance')
        page.evaluate("document.querySelector('.comments').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'3-historique-{t}')
        # Masquée : lecture seule
        page.locator('[data-action="history-hide"]').click()
        page.wait_for_timeout(400)
        R.check(page.locator('#commentInput').count() == 0 and 'on ne peut plus en ajouter' in page.inner_text('.history-detail'), f'{t} séance masquée : plus de saisie')
        R.check(page.locator('.history-detail .comment').count() == 1, f'{t} séance masquée : commentaires d\'avant gardés')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_hors_ligne(bench, eng, dev, theme):
    """Hors ligne : message clair et Réessayer ; le réseau revient : la liste arrive."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page)
        setup(page)
        page.click('.tabbar [data-tab="friends"]')
        page.wait_for_selector('.feed-card')
        page.evaluate('__sb.fail.social = "offline"')
        page.locator('.feed-card').first.locator('.feed-card__main').click()
        page.wait_for_selector('.comments__error')
        R.check('Pas d\'Internet' in page.inner_text('.comments'), f'{t} hors ligne : message clair')
        R.check(page.evaluate("__sb.calls.filter(c => c[1] === 'list_comments').length") <= 2, f'{t} hors ligne : pas de relance en boucle')
        page.evaluate('__sb.fail.social = null')
        page.click('[data-action="comments-retry"]')
        page.wait_for_selector('.comments .comment')
        R.check('Grosse séance' in page.inner_text('.comments'), f'{t} Réessayer : liste chargée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_rapides(bench, eng, dev, theme):
    """Réponses rapides sous la séance d'un ami : un toucher = un commentaire ordinaire (même RPC), brouillon
    du champ intact, réponse envoyée retirée de la rangée, erreur du serveur dite ; jamais sur ma séance."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page)
        ids = setup(page)
        open_friend_session(page)
        quick = page.locator('#commentQuick .comment-quick__btn')
        texts = quick.all_inner_texts()
        base = ['Belle séance 💪', 'Régulier 🔥', 'Respect', 'Lâche rien']
        R.check(texts in (base, ['Gros record !'] + base), f'{t} rangée proposée {texts}')
        R.check(page.get_attribute('#commentQuick', 'aria-label') == 'Réponses rapides'
                and quick.nth(0).get_attribute('aria-label').startswith('Envoyer : '), f'{t} rangée nommée pour VoiceOver')
        st = small_targets(page, '.comment-quick button')
        R.check(not st, f'{t} réponses rapides : cibles de 44 pt {st}')
        # Brouillon en cours : jamais touché par une réponse rapide
        page.fill('#commentInput', 'Mon brouillon')
        page.evaluate("document.activeElement.blur()")
        page.locator('#commentQuick .comment-quick__btn', has_text='Respect').click()
        page.wait_for_timeout(500)
        mine = page.evaluate("__sb.so.comments.filter(c => c.user === __sb.meId()).map(c => [c.owner, c.sid, c.body])")
        R.check(mine == [[ids['lea'], ids['leaSid'], 'Respect']], f'{t} un toucher : commentaire envoyé {mine}')
        R.check(page.evaluate("__sb.calls.filter(c => c[1] === 'add_comment').length") == 1, f'{t} un seul envoi')
        R.check('Respect' in page.locator('.comments .comment').last.inner_text(), f'{t} affiché en bas de la liste')
        R.check('Respect' not in page.locator('#commentQuick').inner_text() and page.input_value('#commentInput') == 'Mon brouillon',
                f'{t} réponse retirée de la rangée, brouillon intact')
        layout(page, t, 'réponses rapides')
        # Serveur qui refuse (hors ligne) : erreur dite, rien d'écrit, la réponse reste proposée
        page.evaluate('__sb.fail.social = "offline"')
        page.locator('#commentQuick .comment-quick__btn', has_text='Lâche rien').click()
        page.wait_for_timeout(500)
        R.check(toast(page) != '' and page.evaluate("__sb.so.comments.filter(c => c.user === __sb.meId()).length") == 1, f'{t} hors ligne : erreur dite ({toast(page)!r})')
        R.check('Lâche rien' in page.locator('#commentQuick').inner_text(), f'{t} hors ligne : réponse toujours proposée')
        page.evaluate('__sb.fail.social = null')
        # Ma séance : pas de réponses rapides
        R.check(not page.evaluate(f"commentsGroupHtml('{ids['me']}', '{ids['sid']}').includes('comment-quick')"), f'{t} ma séance : pas de rangée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_capture_rapides(bench):
    """Captures iPhone 15 Pro, clair et sombre : séance d'un ami avec la rangée de réponses rapides."""
    for theme in ('light', 'dark'):
        with bench.page('webkit', 'iPhone 15 Pro', theme) as page:
            open_app(page, theme, ppl_v2_today_json())
            signin(page)
            setup(page)
            open_friend_session(page)
            page.evaluate("document.querySelector('#commentQuick').scrollIntoView({ block: 'center' })")
            R.check(page.locator('#commentQuick .comment-quick__btn').count() >= 4, f'iPhone 15 Pro {theme} : rangée affichée')
            shot(page, LOT, f'4-reponses-rapides-iPhone_15_Pro-{theme}')
            R.check(not page.errors, f'iPhone 15 Pro {theme} : aucune erreur JS {page.errors}')


run_main(R, [t_ecrire, t_ma_seance, t_hors_ligne, t_rapides], once=[t_capture_rapides])
