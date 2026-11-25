"""Appli web du coach : plans diète en grand écran (docs/COACH_WEB.md, « Plans diète »).

Matrice : Chromium, Firefox, WebKit × 1440, 1180, 820 px (tactile en tablette) × sombre, clair : liste des plans et
Mes aliments, éditeur (macros recalculées à la frappe, recherche Ciqual sans accents, ajout, enregistrement sur le
compte), onglet Nutrition d'un élève (modifier le plan reçu, envoi au format de l'app), fond noir pur, pas de
défilement en largeur, cibles de 44 px, CSP, aucune erreur, rien des élèves dans localStorage.
Parcours, par moteur : plan neuf, repas ajouté, glisser-déposer et flèches, Annuler / Rétablir (Ctrl + Z), unité
(œufs), équivalents, objectifs (erreur puis valeurs), jours d'entraînement et de repos, semaine, aliment perso gardé,
code-barres saisi (Open Food Facts simulé, aucun réseau), envoi à plusieurs (Karim n'accepte pas les plans), confirmation
avant de quitter, écriture concurrente de l'iPhone, compte sans l'accord de copie.
`PPL_ENGINES=chromium` pour un seul moteur. Captures des échecs : $PPL_SCRATCH/shots/coach-web-diete-echecs/.
"""
import json
import os
import re
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright  # noqa: E402
import fixtures  # noqa: E402,F401  (textes lus ramenés aux espaces simples : typo_norm)
from coach_web_fixtures import static_server, launch, open_desk, OFF_PRODUCT  # noqa: E402
from test_coach_web import check  # noqa: E402
from test_coach_web_v4 import wait_js, go, tap, common  # noqa: E402

ENGINES = [e for e in os.environ.get('PPL_ENGINES', 'chromium,firefox,webkit').split(',') if e]
SIZES = [(1440, 900, False), (1180, 820, True), (820, 1180, True)]
FAILS = os.path.join(os.environ.get('PPL_SCRATCH', '/tmp/ppl-tests'), 'shots', 'coach-web-diete-echecs')


def route_off(ctx):
    """Open Food Facts simulé : un seul produit connu, les autres introuvables (404, comme le vrai)."""
    def handle(route):
        if '3017620422003' in route.request.url:
            route.fulfill(status=200, content_type='application/json', body=json.dumps(OFF_PRODUCT),
                          headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'})
        else:
            route.fulfill(status=404, content_type='application/json', body='{"status":0}', headers={'Access-Control-Allow-Origin': '*'})
    ctx.route('https://world.openfoodfacts.org/**', handle)


def total_kcal(page):
    return page.evaluate("Math.round(dietPlanMacros(dietDayObj(dt.draft, dt.day)).kcal)")


def shot_fail(page, tag):
    os.makedirs(FAILS, exist_ok=True)
    page.screenshot(path=os.path.join(FAILS, tag.replace(' ', '_') + '.png'), full_page=True)


def matrix_case(browser, url, engine, w, h, touch, theme):
    tag = f'{engine} {w}px {theme}'
    ctx, page = open_desk(browser, url, width=w, height=h, theme=theme, touch=touch, v4=True, diete=True)
    route_off(ctx)
    try:
        # ── Plans diète : mes plans du compte, Mes aliments ──
        tap(page, '.nav-i[href="#/plans-diete"]:visible', touch)
        page.wait_for_selector('.dt-pl')
        check(page.locator('.dt-pl').count() == 2, f'{tag} : 2 plans')
        check('Sèche' in page.locator('.dt-pl').first.inner_text(), f'{tag} : le plus récemment modifié en tête')
        check('Whey vanille' in page.locator('.dt-foods').inner_text(), f'{tag} : Mes aliments')
        common(page, f'{tag} plans diète', theme)

        # ── Éditeur : macros en direct, recherche, ajout, enregistrement ──
        tap(page, '.dt-pl-a >> nth=0', touch)
        page.wait_for_selector('.dt-it')
        wait_js(page, "dt.foods === 'ready'")
        common(page, f'{tag} éditeur', theme)
        before = total_kcal(page)
        q = page.locator('[data-dt-f="qty"]').first
        q.fill('120')
        wait_js(page, f"Math.round(dietPlanMacros(dt.draft).kcal) !== {before}")
        wait_js(page, "document.querySelector('.savebar').innerText.includes('Pas encore enregistré')")
        live = page.locator('#dt-live-total').inner_text()
        check(str(total_kcal(page)) in live.replace(' ', '').replace(' ', ''), f'{tag} : total en direct {live!r}')
        tap(page, '[data-dt="add"] >> nth=1', touch)
        page.wait_for_selector('#dtp-q')
        page.fill('#dtp-q', 'RIZ BASMATI cuit')
        page.wait_for_selector('#dtp-o-0')
        check('basmati' in page.locator('#dtp-o-0').inner_text().lower(), f'{tag} : recherche sans accents ni capitales')
        common(page, f'{tag} recherche', theme)
        tap(page, '#dtp-o-0', touch)
        page.wait_for_selector('#dtp-qty')
        page.fill('#dtp-qty', '180')
        tap(page, '[data-p="add"]', touch)
        wait_js(page, "!document.querySelector('dialog[open]')")
        check(page.locator('.dt-meal >> nth=1').locator('.dt-it:has-text("basmati, cuit")').count() == 1, f'{tag} : riz ajouté au déjeuner')
        tap(page, '[data-dt="save"]', touch)
        wait_js(page, "(window.__sb.docWrites || []).length === 1")
        saved = page.evaluate("window.__sb.docs[window.__coachId].dietPlans.d_seche")
        check(saved['meals'][0]['items'][0]['g'] == 120 and any('basmati' in i['name'].lower() and i['g'] == 180 for i in saved['meals'][1]['items']), f'{tag} : plan enregistré {saved["meals"][1]}')
        check(saved['updatedAt'] > 1763000000000, f'{tag} : daté')
        doc = page.evaluate("window.__sb.docs[window.__coachId]")
        check('u_seche4' in doc['userProgrammes'] and doc['dietConsent']['on'], f'{tag} : le reste du compte intact')
        check('Tout est enregistré' in page.locator('.savebar').inner_text(), f'{tag} : plus rien à enregistrer')

        # ── Onglet Nutrition de Léa : modifier le plan reçu, envoyer ──
        go(page, '#/eleve/LEA/nutrition', '.nt-acts')
        tap(page, '[data-dt="edit-sent"]', touch)
        page.wait_for_selector('.dt-it')
        check('Version reçue par lea' in page.locator('#dt-status').inner_text(), f'{tag} : version reçue')
        common(page, f'{tag} nutrition élève', theme)
        page.locator('[data-dt-f="qty"]').first.fill('70')
        tap(page, '[data-dt="send"]', touch)
        wait_js(page, "window.__sb.co.progs.find(p => p.student === window.__lea && p.id === 'diet_seche').data.diet.meals[0].items[0].g === 70")
        same = page.evaluate("JSON.stringify(window.__sb.co.progs.find(p => p.student === window.__lea && p.id === 'diet_seche').data) === JSON.stringify(deskDtPayload('d_seche', dt.draft).data)")
        check(same, f'{tag} : envoyé au format exact de l\'app (coachDietPayload)')
        tpl = page.evaluate("window.__sb.docs[window.__coachId].dietPlans.d_seche")
        check(tpl['meals'][0]['items'][0]['g'] == 120 and len(page.evaluate('window.__sb.docWrites')) == 1, f'{tag} : la version de Léa ne remplace pas le plan modèle')
        check('ne change que son plan' in page.locator('#dt-status').inner_text(), f'{tag} : le coach est prévenu')
        check(not page.evaluate('window.__csp || []'), f'{tag} : CSP {page.evaluate("window.__csp")}')
        check(not page.errors, f'{tag} : erreurs {page.errors}')
        keys = page.evaluate("Object.keys(localStorage).filter(k => !['mdlf_push_ask', 'mdlf_push_remind'].includes(k)).sort()")
        check(keys == ['mdlf-coach-web-auth', 'mdlf_coach_web_active'], f'{tag} : localStorage {keys}')
    except Exception:
        shot_fail(page, tag)
        raise
    finally:
        ctx.close()


def journeys(browser, url, engine):
    tag = f'{engine} parcours'
    ctx, page = open_desk(browser, url, width=1440, height=900, theme='dark', v4=True, diete=True)
    route_off(ctx)
    mod = 'Meta' if engine == 'webkit' else 'Control'
    try:
        go(page, '#/plans-diete', '.dt-pl')
        page.click('[data-dt="new"]')
        page.wait_for_selector('#dt-name')
        wait_js(page, "dt.foods === 'ready'")
        page.fill('#dt-name', 'Prise de masse Tom')
        check(page.evaluate('dt.draft.name') == 'Prise de masse Tom', f'{tag} : nom')
        check(page.locator('.dt-meal').count() == 4, f'{tag} : 4 repas de base')
        # Repas ajouté, nom en double refusé
        page.fill('#dt-newmeal', 'déjeuner')
        page.press('#dt-newmeal', 'Enter')
        wait_js(page, "document.getElementById('toast').textContent.includes('déjà ce nom')")
        page.fill('#dt-newmeal', 'Avant la séance')
        page.press('#dt-newmeal', 'Enter')
        wait_js(page, "document.querySelectorAll('.dt-meal').length === 5")
        # Glisser-déposer à la souris : « Avant la séance » en 2e position
        def box(loc):
            # Rendu différé possible (champ quitté, rendu suivant par queueMicrotask) : la boîte se relit jusqu'à être là
            for _ in range(50):
                b = loc.bounding_box()
                if b:
                    return b
                page.wait_for_timeout(100)
            raise AssertionError('élément jamais affiché')
        page.wait_for_timeout(700)
        grip = box(page.locator('.dt-grip').nth(4))
        target = box(page.locator('.dt-meal').nth(1))
        page.mouse.move(grip['x'] + grip['width'] / 2, grip['y'] + grip['height'] / 2)
        page.mouse.down()
        for i in range(1, 11):
            page.mouse.move(grip['x'] + grip['width'] / 2, grip['y'] + (target['y'] + 10 - grip['y']) * i / 10)
        page.mouse.up()
        wait_js(page, "dietShownMeals(dt.draft)[1].name === 'Avant la séance'")
        # Clavier sur la poignée : Début, puis Annuler / Rétablir
        page.focus('.dt-grip >> nth=1')
        page.keyboard.press('Home')
        wait_js(page, "dietShownMeals(dt.draft)[0].name === 'Avant la séance'")
        check('position 1' in page.locator('#live').inner_text(), f'{tag} : déplacement annoncé')
        page.click('.dt-src')
        page.keyboard.press(f'{mod}+z')
        wait_js(page, "dietShownMeals(dt.draft)[1].name === 'Avant la séance'")
        page.keyboard.press(f'{mod}+Shift+z')
        wait_js(page, "dietShownMeals(dt.draft)[0].name === 'Avant la séance'")
        # Œufs à l'unité, au clavier : flèches puis Entrée
        page.click('[data-dt="add"] >> nth=1')
        page.fill('#dtp-q', 'oeuf dur')
        page.wait_for_selector('#dtp-o-0')
        page.keyboard.press('Enter')
        page.wait_for_selector('#dtp-qty')
        check(page.locator('[data-p="mode"][aria-checked="true"]').inner_text() == 'Œuf', f'{tag} : à l\'unité d\'office')
        page.fill('#dtp-qty', '3')
        page.keyboard.press('Shift+Enter')   # Ajouter et continuer
        page.wait_for_selector('#dtp-q')
        page.fill('#dtp-q', 'flocons d avoine')
        page.wait_for_selector('#dtp-o-0')
        page.keyboard.press('ArrowDown')
        page.keyboard.press('ArrowUp')
        page.keyboard.press('Enter')
        page.wait_for_selector('#dtp-qty')
        page.fill('#dtp-qty', '80')
        page.keyboard.press('Enter')
        wait_js(page, "!document.querySelector('dialog[open]')")
        meal = page.evaluate("dietShownMeals(dt.draft)[1].items.map(i => [i.name, i.g, i.por ? i.por.n : null])")
        check(meal[0][1] == 150 and meal[0][2] == 3 and meal[1][1] == 80, f'{tag} : 3 œufs (150 g) et 80 g de flocons {meal}')
        # Unité changée : œufs → grammes, puis équivalents
        page.locator('[data-dt-f="unit"]').first.select_option('-1')
        wait_js(page, "!dietShownMeals(dt.draft)[1].items[0].por")
        page.click('[data-dt="swap"] >> nth=1')
        page.wait_for_selector('[data-c]')
        name = page.locator('[data-c] b').first.inner_text()
        page.click('[data-c] >> nth=0')
        wait_js(page, "!document.querySelector('dialog[open]')")
        check(page.evaluate("dietShownMeals(dt.draft)[1].items[1].name") != 'Flocons d\'avoine', f'{tag} : remplacé par {name}')
        # Objectifs : erreur dite, puis valeurs
        page.fill('#dt-t-kcal', '20000')
        page.press('#dt-t-kcal', 'Enter')
        wait_js(page, "document.getElementById('dt-tg-err').textContent.includes('Calories')")
        page.fill('#dt-t-kcal', '2900')
        page.fill('#dt-t-p', '160')
        page.fill('#dt-t-waterMin', '3')
        page.fill('#dt-t-waterMax', '4')
        page.press('#dt-t-waterMax', 'Enter')
        wait_js(page, "dt.draft.targets && dt.draft.targets.kcal === 2900 && dt.draft.targets.water === 4 && dt.draft.targets.waterMin === 3")
        page.wait_for_timeout(900)
        side = page.locator('.dt-side').inner_text()
        check('sur2900kcal' in re.sub(r'\s', '', side), f'{tag} : bilan face à l\'objectif {side[:200]!r}')
        # Jours d'entraînement et de repos ; objectif du jour de repos
        page.click('[data-dt="mode"][data-v="session"]')
        page.wait_for_selector('[data-dt="day"]')
        page.click('[data-dt="day"][data-v="1"]')
        page.fill('#dt-t-kcal', '2500')
        page.press('#dt-t-kcal', 'Enter')
        wait_js(page, "dt.draft.days.more[0].targets.kcal === 2500 && dt.draft.targets.kcal === 2900")
        # Semaine : mercredi en repos
        page.click('[data-dt="mode"][data-v="week"]')
        page.wait_for_selector('[data-dt="day"][data-v="6"]')
        page.click('[data-dt="day"][data-v="2"]')
        page.click('[data-dt="kind"][data-v="r"]')
        wait_js(page, "dt.draft.days.kinds[2] === 'r'")
        # Aliment perso créé (gardé sur le compte), depuis « Créer « … » »
        page.click('[data-dt="add"] >> nth=0')
        page.fill('#dtp-q', 'skyr islandais maison')
        page.wait_for_selector('[data-p="create-typed"]')
        page.click('[data-p="create-typed"]')
        page.wait_for_selector('#dtp-k')
        check(page.input_value('#dtp-name') == 'Skyr islandais maison', f'{tag} : nom repris')
        page.fill('#dtp-p', '80')
        page.fill('#dtp-c', '30')
        page.click('[data-p="create-ok"]')
        wait_js(page, "document.getElementById('dtp-err').textContent.includes('de macros pour')")
        page.fill('#dtp-p', '11')
        page.fill('#dtp-c', '4')
        page.click('[data-p="create-ok"]')
        page.wait_for_selector('#dtp-qty')
        wait_js(page, "(window.__sb.docs[window.__coachId].dietFoods || []).some(f => f.name === 'Skyr islandais maison')")
        page.keyboard.press('Enter')
        wait_js(page, "!document.querySelector('dialog[open]')")
        # Code-barres saisi : Open Food Facts (simulé), attribution ODbL, produit gardé
        page.click('[data-dt="add"] >> nth=0')
        page.click('[data-p="barcode"]')
        page.fill('#dtp-code', '12345')
        page.press('#dtp-code', 'Enter')
        wait_js(page, "document.querySelector('dialog[open]').innerText.includes('13 chiffres')")
        page.fill('#dtp-code', '3017620422003')
        page.press('#dtp-code', 'Enter')
        page.wait_for_selector('#dtp-qty')
        dlg = page.locator('dialog[open]').inner_text()
        check('Skyr nature' in dlg and 'ODbL' in dlg, f'{tag} : produit et attribution {dlg[:200]!r}')
        check(page.locator('[data-p="mode"][aria-checked="true"]').inner_text().lower() == 'pot', f'{tag} : 1 pot d\'office')
        page.click('[data-p="add"]')
        wait_js(page, "!document.querySelector('dialog[open]')")
        off = page.evaluate("dietDayObj(dt.draft, dt.day).meals[0].items.find(i => i.src === 'off')")
        check(off and off['g'] == 150 and off['food'] is None, f'{tag} : produit au format de l\'app {off}')
        check(page.evaluate("window.__sb.docs[window.__coachId].dietFoods.some(f => f.code === '3017620422003' && f.src === 'off')"), f'{tag} : produit gardé dans Mes aliments')
        # Quitter sans enregistrer : confirmation, puis Annuler
        page.evaluate("location.hash = '#/'")
        page.wait_for_selector('dialog[open] [data-cf="no"]')
        page.click('dialog[open] [data-cf="no"]')
        check(page.evaluate('location.hash').startswith('#/plans-diete/'), f'{tag} : reste sur l\'éditeur')
        # Écriture concurrente de l'iPhone : relue, rejouée, rien d'écrasé
        page.evaluate("window.__sb.fail.docConflict = 1; window.__sb.docs[window.__coachId].unit = 'lbs'")
        page.keyboard.press(f'{mod}+s')
        wait_js(page, "!document.querySelector('[data-dt=save]') || document.querySelector('[data-dt=save]').disabled")
        doc = page.evaluate("window.__sb.docs[window.__coachId]")
        pid = page.evaluate('dt.id')
        check(doc['unit'] == 'lbs' and doc['dietPlans'][pid]['days']['mode'] == 'week', f'{tag} : plan enregistré après une écriture concurrente')
        # Brouillon périmé : le plan change sur l'iPhone (date du compte différente), puis le site enregistre
        page.evaluate("const p = window.__sb.docs[window.__coachId].dietPlans[dt.id]; p.updatedAt += 5000; p.name = 'Modifié sur l\\'iPhone'")
        page.fill('#dt-t-p', '170')
        page.press('#dt-t-p', 'Enter')
        page.click('[data-dt="save"]')
        page.wait_for_selector('dialog[open] [data-cf="keep"]')
        check('changé ailleurs' in page.locator('dialog[open]').inner_text(), f'{tag} : brouillon périmé signalé')
        page.click('dialog[open] [data-cf="keep"]')
        wait_js(page, "window.__sb.docs[window.__coachId].dietPlans[dt.id].name === 'Prise de masse Tom' && dietDayObj(window.__sb.docs[window.__coachId].dietPlans[dt.id], dt.day).targets.p === 170")
        # Envoi à plusieurs : Léa et Tom reçoivent, Karim n'accepte pas les plans
        page.click('[data-dt="send-many"]')
        page.wait_for_selector('dialog[open] .ch-o')
        for who in ('lea', 'tom', 'karim'):
            page.click(f'dialog[open] .ch-o:has-text("{who}")')
        page.click('dialog[open] [data-cf="yes"]')
        page.wait_for_selector('dialog[open] .dlg-t:has-text("Envoyé à 2 sur 3")')
        check('karim' in page.locator('dialog[open]').inner_text(), f'{tag} : Karim nommé')
        page.click('dialog[open] [data-cf="yes"]')
        sent = page.evaluate(f"window.__sb.co.progs.filter(p => p.id === dietSentId('{pid}')).map(p => p.student)")
        check(sorted(sent) == sorted(page.evaluate('window.__students.slice(0, 2)')), f'{tag} : reçu par Léa et Tom {sent}')
        # Dupliquer, puis supprimer la copie
        go(page, '#/plans-diete', '.dt-pl')
        page.click('[data-dt="dup"] >> nth=0')
        page.wait_for_selector('#dt-name')
        wait_js(page, "dt.draft && dt.draft.name.endsWith('(copie)')")
        page.click('[data-dt="delete"]')
        page.click('dialog[open] [data-cf="yes"]')
        page.wait_for_selector('.dt-pl')
        check(page.locator('.dt-pl').count() == 3, f'{tag} : 3 plans après la suppression de la copie')
        check(not page.evaluate('window.__csp || []'), f'{tag} : CSP {page.evaluate("window.__csp")}')
        check(not page.errors, f'{tag} : erreurs {page.errors}')
    except Exception:
        shot_fail(page, tag)
        raise
    finally:
        ctx.close()

    # iPhone pas à jour (profil sans dietSyncV) : le site n'enregistre pas, il le dit ; l'envoi reste possible
    ctx, page = open_desk(browser, url, width=1440, height=900, theme='dark', v4=True, diete=True,
                          pre="document.addEventListener('DOMContentLoaded', () => { delete window.__sb.docs[window.__coachId].dietSyncV; });")
    try:
        go(page, '#/plans-diete', '.dt-pl')
        check('Mets l\'app à jour' in page.locator('.dt-note').inner_text(), f'{engine} iPhone pas à jour : expliqué')
        page.click('.dt-pl-a >> nth=0')
        page.wait_for_selector('.dt-it')
        check(page.locator('[data-dt="save"]').count() == 0, f'{engine} iPhone pas à jour : pas d\'« Enregistrer »')
        check(not page.errors, f'{engine} iPhone pas à jour : erreurs {page.errors}')
    except Exception:
        shot_fail(page, f'{engine} iphone ancien')
        raise
    finally:
        ctx.close()

    # Compte sans l'accord « Copier mes plans sur mon compte » : rien n'est écrit, l'envoi marche
    ctx, page = open_desk(browser, url, width=1180, height=820, theme='light', v4=True, diete=True,
                          pre="document.addEventListener('DOMContentLoaded', () => { window.__sb.docs[window.__coachId].dietConsent = { on: false, at: Date.now() }; });")
    try:
        go(page, '#/plans-diete', '.dt-pl')
        check('Copier mes plans sur mon compte' in page.locator('.dt-note').inner_text(), f'{engine} sans accord : expliqué')
        go(page, '#/eleve/LEA/nutrition/edit', '.dt-it')
        check(page.locator('[data-dt="save"]').count() == 0, f'{engine} sans accord : pas d\'« Enregistrer »')
        page.locator('[data-dt-f="qty"]').first.fill('65')
        page.click('[data-dt="send"]')
        wait_js(page, "window.__sb.co.progs.find(p => p.student === window.__lea && p.id === 'diet_seche').data.diet.meals[0].items[0].g === 65")
        check(not (page.evaluate('window.__sb.docWrites') or []), f'{engine} sans accord : rien écrit sur le compte')
        check(not page.errors, f'{engine} sans accord : erreurs {page.errors}')
    except Exception:
        shot_fail(page, f'{engine} sans accord')
        raise
    finally:
        ctx.close()


def main():
    with sync_playwright() as pw, static_server() as url:
        for engine in ENGINES:
            browser = launch(pw, engine)
            try:
                if os.environ.get('PPL_DIETE_PARTS', 'all') != 'journeys':
                    for theme in ('dark', 'light'):
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
    print('Plans diète de l\'appli web du coach : OK')


if __name__ == '__main__':
    main()
