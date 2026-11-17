"""Programme sur mesure (générateur à règles) : accès par Ajouter un programme, questions courtes, aperçu,
« Modifier les réponses », « Utiliser ce programme » avec confirmation (rien remplacé sans accord), et premier
lancement : lien discret seulement, « Plus tard » ne relance rien. Règles testées sans navigateur
(tests/unit/program-generator.mjs).
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'generateur'
R = Results(LOT)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def tap(page, sel):
    page.click(sel)
    page.wait_for_timeout(380)


def step(page):
    return page.evaluate("currentRoute()")


def small_targets(page):
    return page.evaluate("""() => [...document.querySelectorAll('.view.prog-gen button')].filter(e => e.offsetParent)
        .map(e => e.getBoundingClientRect()).filter(r => r.height < 44).length""")


def cut_texts(page):
    return page.evaluate("""() => [...document.querySelectorAll('.view.prog-gen .cell__title, .view.prog-gen .cell__sub, .view.prog-gen p, .view.prog-gen .btn')]
        .filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 30))""")


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def ok_screen(page, t, quoi):
    R.check(small_targets(page) == 0 and not cut_texts(page) and no_hscroll(page), f'{t} {quoi} : 44 pt, rien de coupé {cut_texts(page)}')


def answer_all(page, t, first=True):
    """Parcours des questions : prise de muscle, intermédiaire, 4 jours, 75 min, salle, fessiers, épaule."""
    tap(page, '.view.prog-gen [data-action="gen-next"][data-step="toi"]')
    R.check(step(page) == 'prog-gen:objectif', f'{t} « Commencer » : objectif ({step(page)})')
    if first:
        ok_screen(page, t, 'objectif')
        shot(page, LOT, f'2-objectif-{t}')
    tap(page, '[data-action="gen-set"][data-val="muscle"]')
    tap(page, '[data-action="gen-set"][data-val="intermediaire"]')
    tap(page, '[data-action="gen-set"][data-val="4"]')
    tap(page, '[data-action="gen-set"][data-val="75"]')
    R.check(step(page) == 'prog-gen:materiel', f'{t} un toucher par question jusqu\'au matériel ({step(page)})')
    R.check(page.get_attribute('[data-action="gen-gym"]', 'aria-pressed') == 'true', f'{t} salle complète cochée par défaut')
    if first:
        ok_screen(page, t, 'matériel')
        shot(page, LOT, f'3-materiel-{t}')
    tap(page, '[data-action="gen-next"][data-step="materiel"]')
    if first:
        tap(page, '[data-action="gen-zone"][data-val="fessiers"]')
        tap(page, '[data-action="gen-limit"][data-val="epaule"]')
        R.check(page.get_attribute('[data-action="gen-limit"][data-val="epaule"]', 'aria-pressed') == 'true', f'{t} limite cochée, état annoncé')
        R.check('pas un avis médical' in page.inner_text('.view.prog-gen'), f'{t} « pas un avis médical »')
        ok_screen(page, t, 'priorités')
        shot(page, LOT, f'4-options-{t}')
    tap(page, '[data-action="gen-next"][data-step="options"]')
    R.check(step(page) == 'prog-gen:apercu', f'{t} aperçu ({step(page)})')


def t_generateur(bench, eng, dev, theme):
    t = tag(dev, theme)
    year = datetime.date.today().year
    with bench.page(eng, dev, theme) as page:
        d = json.loads(ppl_v2_today_json())
        d.update({'birthYear': year - 26, 'heightCm': 178, 'bodyWeightKg': 74.5, 'strengthSex': 'male'})
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        before = page.evaluate('[data.activeProgramme, data.myProgrammes]')

        # Programme › Mes programmes › Ajouter : « Programme sur mesure » en première ligne
        page.locator('.tabbar [role=tab]').nth(3).click()
        page.wait_for_timeout(350)
        tap(page, '[data-action="go-my-programmes"]')
        tap(page, '[data-action="go-prog-add"]')
        first = page.evaluate("document.querySelector('.prog-add .scr button')?.dataset.action")
        R.check(first == 'go-prog-gen', f'{t} première ligne : sur mesure ({first})')
        shot(page, LOT, f'1-ajouter-{t}')
        tap(page, '[data-action="go-prog-gen"]')

        # Profil repris des Réglages
        R.check(step(page) == 'prog-gen:toi', f'{t} écran « Sur mesure » ({step(page)})')
        vals = [x.strip() for x in page.locator('.view.prog-gen .cell__value').all_inner_texts()]
        R.check(vals[0] == '26 ans' and vals[1] == '178 cm' and vals[2].startswith('74,5') and vals[3] == 'Homme', f'{t} âge, taille, poids, sexe repris {vals}')
        ok_screen(page, t, 'profil')
        shot(page, LOT, f'1b-profil-{t}')

        answer_all(page, t)
        txt = page.inner_text('.view.prog-gen')
        R.check('4 séances parce que tu as 4 jours' in txt, f'{t} pourquoi : 4 séances')
        R.check('pour les fessiers, ta priorité' in txt, f'{t} pourquoi : priorité fessiers')
        R.check('Développé militaire' not in txt and 'Dips' not in txt.replace('Dips assistés', ''), f'{t} épaule : ni développé militaire ni dips')
        R.check(page.locator('.view.prog-gen .gen-sess-title').count() == 4, f'{t} 4 séances')
        R.check(page.locator('.view.prog-gen .body-map[role="img"]').count() == 1
                and page.evaluate("document.querySelectorAll('.view.prog-gen [data-muscle][data-heat]').length") > 5, f'{t} personnage, muscles en rouge')
        mins = page.evaluate("[...document.querySelectorAll('.gen-sess-title .num')].map(e => parseInt(e.textContent.replace(/\\D+/g, '')))")
        R.check(len(mins) == 4 and max(mins) <= 75, f'{t} séances ≤ 75 min {mins}')
        R.check(page.evaluate('data.activeProgramme') == before[0], f'{t} aperçu : rien de changé')
        ok_screen(page, t, 'aperçu')
        shot(page, LOT, f'5-apercu-{t}')

        # Modifier les réponses : retour au début, réponses gardées
        tap(page, '[data-action="gen-edit"]')
        R.check(step(page) == 'prog-gen:toi', f'{t} Modifier : retour au début')
        tap(page, '[data-action="gen-next"][data-step="toi"]')
        R.check(page.get_attribute('[data-action="gen-set"][data-val="muscle"]', 'aria-pressed') == 'true', f'{t} réponse gardée, cochée')
        page.evaluate("navigate(makeRoute('prog-gen', 'apercu'))")
        page.wait_for_timeout(350)

        # Utiliser : confirmation ; Annuler ne change rien
        tap(page, '[data-action="gen-use"]')
        R.check(page.locator('.ios-dialog').count() == 1 and 'reste' in page.inner_text('.ios-dialog'), f'{t} confirmation avant de changer de programme')
        tap_dialog(page, 'Annuler')
        R.check(page.evaluate('[data.activeProgramme, data.myProgrammes]') == before, f'{t} Annuler : rien de changé')
        tap(page, '[data-action="gen-use"]')
        tap_dialog(page, 'Utiliser ce programme')
        got = page.evaluate("""(() => { const id = data.activeProgramme, up = data.userProgrammes[id];
            return { id, name: up?.name, mine: data.myProgrammes, keys: sessionKeys(id), view,
                     ex: data.programmes[id]?.exercises?.[sessionKeys(id)[0]]?.[0] }; })()""")
        R.check(got['id'].startswith('u_') and got['name'] == 'Sur mesure', f'{t} programme créé et actif {got["name"]}')
        R.check(before[0] in got['mine'] and got['mine'][-1] == got['id'], f'{t} l\'ancien reste dans Mes programmes {got["mine"]}')
        R.check(got['keys'] == ['haut_a', 'bas_a', 'haut_b', 'bas_b'] and got['view'] == 'programmes', f'{t} séances, retour à Programme {got["keys"]}')
        R.check(got['ex'] and got['ex']['repMin'] and got['ex']['repMax'] and got['ex']['rest'], f'{t} exercice avec fourchette et repos {got["ex"]}')
        R.check(page.locator('.view.programmes .pcard').count() == 4, f'{t} 4 cartes de séance')
        shot(page, LOT, f'6-programme-{t}')
        page.reload()
        page.wait_for_selector('#app > *')
        R.check(page.evaluate('data.userProgrammes[data.activeProgramme]?.name') == 'Sur mesure', f'{t} gardé après rechargement')
        stored = json.loads(ls(page, 'mdlf_gen_answers') or '{}')
        R.check(stored.get('limits') == ['epaule'] and 'mdlf_gen_answers' not in (ls(page, 'ppl_v2') or ''), f'{t} réponses sur l\'appareil seulement')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_premier_lancement(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        # « Plus tard » : rien n'est relancé, ni au rechargement ni dans l'onglet Programme
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        tap(page, '.onb [data-action="onb-later"]')
        page.reload()
        page.wait_for_selector('#app > *')
        page.wait_for_timeout(500)
        R.check(page.locator('.onb').count() == 0 and page.locator('.view.prog-gen').count() == 0 and page.locator('.ios-dialog').count() == 0,
                f'{t} Plus tard : rien au lancement suivant')
        page.locator('.tabbar [role=tab]').nth(3).click()
        page.wait_for_timeout(400)
        R.check(page.evaluate('view') == 'programmes' and page.locator('.view.prog-gen').count() == 0, f'{t} Plus tard : onglet Programme normal')
        R.check(ls(page, 'mdlf_gen_answers') is None, f'{t} Plus tard : aucune réponse gardée')

        # Lien sous « Commencer » : générateur prérempli avec les trois réponses
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        tap(page, '[data-action="onb-place"][data-val="salle"]')
        tap(page, '[data-action="onb-freq"][data-val="4"]')
        tap(page, '[data-action="onb-level"][data-val="confirme"]')
        link = page.locator('.onb [data-action="onb-custom"]')
        R.check(link.count() == 1 and link.inner_text().strip() == 'Ajuster à mon temps et mon matériel'
                and page.locator('.onb__actions [data-action="onb-custom"]').count() == 1, f'{t} « Ajuster à mon temps et mon matériel » sous Commencer')
        R.check(page.evaluate("(() => { const r = document.querySelector('[data-action=\"onb-start\"]').getBoundingClientRect(); return r.bottom <= innerHeight; })()"),
                f'{t} « Commencer » toujours visible')
        shot(page, LOT, f'7-premier-lancement-{t}')
        tap(page, '[data-action="onb-custom"]')
        R.check(page.locator('.onb').count() == 0 and step(page) == 'prog-gen:toi', f'{t} générateur ouvert ({step(page)})')
        R.check(page.evaluate('[data.onboarded, data.activeProgramme]') == [True, 'upper_lower'], f'{t} conseil appliqué en attendant')
        page.evaluate("navigate(makeRoute('prog-gen', 'jours'))")
        page.wait_for_timeout(350)
        R.check(page.get_attribute('[data-action="gen-set"][data-val="4"]', 'aria-pressed') == 'true', f'{t} 4 jours repris')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_generateur, t_premier_lancement])
