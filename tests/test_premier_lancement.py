"""Premier lancement : trois questions (où, combien de fois, niveau), puis le programme conseillé.

Nouvel utilisateur seulement ; « Retour », « Plus tard », silhouette, « Commencer » (programme, filtre
de matériel, objectif de la semaine) et « Voir les autres programmes ». La règle de choix elle-même est
testée sans navigateur (tests/unit/onboarding.mjs).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'premier_lancement'
R = Results(LOT)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def step(page):
    return page.evaluate("document.querySelector('.onb .onb__page')?.className.match(/onb__page--(\\w+)/)?.[1] || null")


def tap(page, sel):
    page.click(sel)
    page.wait_for_timeout(350)


def small_targets(page):
    # Mesure après les animations d'entrée (une page en cours d'apparition est plus petite : faux échec 13/11)
    page.wait_for_function("""() => document.getAnimations().every(a => a.playState !== 'running'
        || (a.effect && a.effect.getTiming().iterations === Infinity))""", timeout=3000)
    return page.evaluate("""() => [...document.querySelectorAll('.onb button')].filter(e => e.offsetParent)
        .map(e => e.getBoundingClientRect()).filter(r => r.width < 44 || r.height < 44).length""")


def overflowing(page):
    return page.evaluate("""() => [...document.querySelectorAll('.onb button, .onb p, .onb h1, .onb .cell__title, .onb .cell__sub')]
        .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 30))""")


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def t_parcours(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        R.check(page.evaluate("document.getElementById('app').inert") is True, f'{t} app inerte sous les questions')
        R.check(page.locator('.onb [data-action="onb-back"]').count() == 0, f'{t} 1re question : pas de Retour')
        R.check(page.locator('.onb #onbTitle').inner_text().startswith('Où t'), f'{t} « Où t\'entraînes-tu ? »')
        R.check(page.locator('.onb [data-action="onb-place"]').count() == 3, f'{t} trois lieux')
        R.check(page.get_attribute('.onb__progress', 'aria-valuenow') == '1', f'{t} avancement 1 sur 3')
        R.check(small_targets(page) == 0 and not overflowing(page) and no_hscroll(page), f'{t} lieu : 44 pt, rien de coupé {overflowing(page)}')
        R.check(page.locator('.onb [data-action="onb-have"]').inner_text().strip() == 'J\'ai déjà un programme'
                and page.locator('.onb [data-action="onb-coach"]').inner_text().strip() == 'Je suis coach', f'{t} 1re question : déjà un programme, coach')
        shot(page, LOT, f'1-ou-{t}')

        tap(page, '[data-action="onb-place"][data-val="salle"]')
        R.check(step(page) == 'freq', f'{t} un toucher : question suivante')
        labels = [x.strip() for x in page.locator('.onb [data-action="onb-freq"] .cell__title').all_inner_texts()]
        R.check(labels == ['2 fois', '3 fois', '4 fois', '5 fois ou plus'], f'{t} fréquences {labels}')
        R.check(small_targets(page) == 0 and not overflowing(page), f'{t} fréquence : 44 pt, rien de coupé')
        tap(page, '[data-action="onb-freq"][data-val="3"]')
        R.check(step(page) == 'level', f'{t} niveau')
        R.check(page.locator('.onb [data-action="onb-level"]').count() == 3, f'{t} trois niveaux, dont la reprise')

        # Retour : réponse précédente cochée
        tap(page, '[data-action="onb-back"]')
        R.check(step(page) == 'freq' and page.get_attribute('[data-action="onb-freq"][data-val="3"]', 'aria-pressed') == 'true',
                f'{t} Retour : « 3 fois » coché')
        tap(page, '[data-action="onb-freq"][data-val="3"]')
        tap(page, '[data-action="onb-level"][data-val="confirme"]')
        R.check(step(page) == 'result', f'{t} résultat')
        R.check(page.locator('#onbTitle').inner_text().strip() == 'PPL', f'{t} salle, 3 fois, déjà entraîné : PPL')
        rows = page.locator('.onb .prog-sess').all_inner_texts()
        R.check(len(rows) == 3 and 'Pousser (Push)' in rows[0] and 'pectoraux' in rows[0], f'{t} séances en clair {rows[:1]}')
        R.check(page.locator('.onb [data-action="onb-later"]').count() == 0, f'{t} résultat : pas de « Plus tard »')

        # Niveau débutant : Full Body, phrase explicative
        tap(page, '[data-action="onb-back"]')
        tap(page, '[data-action="onb-level"][data-val="debutant"]')
        R.check(page.locator('#onbTitle').inner_text().strip() == 'Full Body', f'{t} débutant, 3 fois : Full Body')
        R.check(page.locator('.onb__reason').inner_text().strip() == '3 séances par semaine, tout le corps à chaque fois. Pour débuter : machines et haltères, environ 45 min.',
                f'{t} phrase du Full Body')

        # Silhouettes : Femme et Homme côte à côte, muscles du programme surlignés, un toucher choisit
        bodies = page.locator('.onb .onb__body')
        R.check(bodies.count() == 2 and bodies.nth(0).get_attribute('aria-label') == 'Silhouette femme'
                and bodies.nth(1).get_attribute('aria-label') == 'Silhouette homme', f'{t} deux silhouettes nommées pour VoiceOver')
        R.check(page.locator('.onb [aria-pressed="true"][data-action="onb-silhouette"]').count() == 0, f'{t} aucune silhouette cochée d\'office')
        R.check(page.locator('#onbBodies').inner_text().replace('\u00a0', ' ').startswith('Quelle silhouette te ressemble ?'), f'{t} question de la silhouette')
        lit = page.evaluate("[...document.querySelectorAll('.onb__body[data-val=\"male\"] [data-muscle][data-heat]')].map(p => p.dataset.muscle)")
        R.check({'chest', 'quads', 'lats'} <= set(lit), f'{t} muscles du Full Body surlignés {sorted(set(lit))[:6]}')
        R.check(page.locator('.onb .segmented').count() == 0, f'{t} plus de contrôle segmenté')
        tap(page, '.onb [data-action="onb-silhouette"][data-val="female"]')
        R.check(page.evaluate('data.silhouette') == 'female' and page.evaluate('data.onboarded') is False and step(page) == 'result',
                f'{t} femme choisie, résultat toujours là')
        R.check(page.locator('.onb [data-val="female"]').get_attribute('aria-pressed') == 'true'
                and 'onb__body--on' in page.locator('.onb [data-val="female"]').get_attribute('class'), f'{t} silhouette choisie encadrée, état annoncé')
        R.check(small_targets(page) == 0 and not overflowing(page) and no_hscroll(page), f'{t} résultat : 44 pt, rien de coupé {overflowing(page)}')
        R.check(page.evaluate("(() => { const r = document.querySelector('[data-action=\"onb-start\"]').getBoundingClientRect(); return r.bottom <= innerHeight; })()"),
                f'{t} « Commencer » visible sans défiler')
        R.check(int(page.evaluate("getComputedStyle(document.querySelector('.onb__actions')).zIndex") or 0) >= 2, f'{t} boutons du bas au-dessus des séparateurs de la liste')
        # Panel v4 t1 : au moins une séance entière visible au-dessus de « Commencer » (SE : une demi-ligne), et rien de la
        # liste sous les boutons (Duo en paysage : un bout de carte dans la safe area)
        geo = page.evaluate("""(() => { const root = document.querySelector('.onb'); root.scrollTop = 0;
            const a = document.querySelector('.onb__actions').getBoundingClientRect(), row = document.querySelector('.onb__group .cell').getBoundingClientRect();
            return { rowBottom: row.bottom, actTop: a.top, actBottom: a.bottom, h: root.clientHeight, pb: getComputedStyle(root).paddingBottom }; })()""")
        R.check(geo['rowBottom'] <= geo['actTop'] + 1, f'{t} première séance entière au-dessus de « Commencer » {geo}')
        R.check(geo['pb'] == '0px' and geo['actBottom'] >= geo['h'] - 1, f'{t} bloc des boutons jusqu\'au bord bas, rien dessous {geo}')
        shot(page, LOT, f'2-resultat-{t}')

        # Application fermée avant la fin : les questions reviennent
        page.reload()
        page.wait_for_selector('.onb__page--place')
        R.check(page.evaluate('data.onboarded') is False, f'{t} sans choix : questions au lancement suivant')

        tap(page, '[data-action="onb-place"][data-val="halteres"]')
        tap(page, '[data-action="onb-freq"][data-val="4"]')
        tap(page, '[data-action="onb-level"][data-val="debutant"]')
        R.check(page.locator('#onbTitle').inner_text().strip() == 'Maison haltères', f'{t} haltères : Maison haltères')
        tap(page, '[data-action="onb-start"]')
        page.wait_for_timeout(300)
        got = page.evaluate('[data.activeProgramme, data.exEquip, data.weeklyGoal, data.onboarded]')
        R.check(got == ['maison_halteres', 'halteres', 4, True], f'{t} Commencer : programme, matériel, objectif {got}')
        R.check(page.evaluate('data.myProgrammes') == ['maison_halteres'], f'{t} Mes programmes : le conseil seul')
        R.check(page.locator('.onb').count() == 0 and page.evaluate('view') == 'dashboard', f'{t} accueil après Commencer')
        R.check(page.evaluate("document.getElementById('app').inert") is False, f'{t} app de nouveau active')
        page.reload()
        page.wait_for_selector('#app > *')
        page.wait_for_timeout(400)
        R.check(page.locator('.onb').count() == 0, f'{t} questions jamais deux fois')
        R.check(page.evaluate('trainingLevel()') == 'debutant', f'{t} niveau gardé (repère de la bulle des muscles)')
        # Panel « yeux neufs » du 16/11 : première séance, aucune charge proposée ; une ligne grise dit laquelle prendre
        page.evaluate("startSession(sessionKeys(data.activeProgramme)[0])")
        page.wait_for_selector('.view.session .ex-card')
        first = page.locator('.ex-card[data-ei="0"] .ex-first')
        R.check(first.count() == 1 and first.inner_text().strip() == 'Première fois : prends une charge que tu soulèves 15 fois facilement'
                and page.evaluate("getComputedStyle(document.querySelector('.ex-first')).color") == page.evaluate("getComputedStyle(document.querySelector('.ex-card__sub')).color"),
                f'{t} 1re séance : « Première fois » en gris sous le nom')
        R.check(no_hscroll(page), f'{t} 1re séance : pas de défilement horizontal')
        shot(page, LOT, f'3-premiere-seance-{t}')
        page.fill('[data-action="set-weight"][data-ei="0"][data-si="0"]', '10')
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]')
        page.wait_for_timeout(300)
        R.check(page.locator('.ex-card[data-ei="0"] .ex-first').count() == 0, f'{t} série validée : la ligne s\'en va')
        page.evaluate("activeSession = null; persistSession()")
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_plus_tard_et_autres(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        # « Plus tard » : rien d'imposé, comme l'ancienne carte
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        tap(page, '[data-action="onb-place"][data-val="rien"]')
        tap(page, '.onb [data-action="onb-later"]')
        got = page.evaluate('[data.activeProgramme, data.exEquip, data.weeklyGoal ?? null, data.onboarded]')
        R.check(got == ['ppl', 'all', None, True] and page.locator('.onb').count() == 0, f'{t} Plus tard : rien de changé {got}')

        # « Voir les autres programmes » : conseil appliqué et coché dans la liste
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        tap(page, '[data-action="onb-place"][data-val="salle"]')
        tap(page, '[data-action="onb-freq"][data-val="5"]')
        tap(page, '[data-action="onb-level"][data-val="debutant"]')
        R.check(page.locator('#onbTitle').inner_text().strip() == 'Full Body', f'{t} débutant, 5 fois : Full Body')
        tap(page, '[data-action="onb-others"]')
        page.wait_for_selector('.view.prog-add')
        row = page.locator('.prog-add [data-action="open-prog-info"][data-id="fullbody"]')
        R.check('Actif' in row.inner_text(), f'{t} Voir les autres : catalogue, Full Body actif')
        R.check(page.evaluate('[data.activeProgramme, data.myProgrammes]') == ['fullbody', ['fullbody']], f'{t} conseil appliqué et dans Mes programmes')
        first = page.evaluate("data.programmes.fullbody.exercises.fullbody.map(e => e.name)")
        R.check(first[0] == 'Presse à cuisses' and not any('barre' in n.lower() for n in first), f'{t} débutant : machines et haltères, pas de barre {first}')
        R.check(page.evaluate('[data.weeklyGoal, data.onboarded]') == [5, True], f'{t} objectif 5, questions passées')

        # « Je reprends ou j'ai une douleur » : Sur mesure directement, niveau « reprise », conseil débutant en attendant
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        tap(page, '[data-action="onb-place"][data-val="salle"]')
        tap(page, '[data-action="onb-freq"][data-val="3"]')
        tap(page, '[data-action="onb-level"][data-val="reprise"]')
        R.check(page.locator('.onb').count() == 0 and page.evaluate('currentRoute()') == 'prog-gen:toi', f'{t} reprise : Sur mesure ouvert')
        R.check(page.evaluate('[data.activeProgramme, data.level, data.onboarded, genAns.level]') == ['fullbody', 'debutant', True, 'reprise'],
                f'{t} reprise : Full Body en attendant, niveau reprise prérempli')

        # « J'ai déjà un programme » : rien d'imposé, Ajouter un programme
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        tap(page, '[data-action="onb-have"]')
        page.wait_for_selector('.view.prog-add')
        R.check(page.locator('.onb').count() == 0 and page.evaluate('[data.onboarded, data.weeklyGoal ?? null]') == [True, None],
                f'{t} déjà un programme : Ajouter un programme, rien d\'imposé')

        # « Je suis coach » sans compte : connexion d'abord ; fermée, on reste sur l'app
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        tap(page, '[data-action="onb-coach"]')
        page.wait_for_selector('.auth')
        R.check(page.locator('.onb').count() == 0 and page.evaluate('data.onboarded') is True, f'{t} coach : questions fermées, connexion proposée')

        # Panel « yeux neufs » du 16/11 : « Importer depuis Strong ou Hevy » sous les niveaux, ouvre le choix du fichier
        # (réponses données appliquées, niveau sans réponse : déjà entraîné)
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        tap(page, '[data-action="onb-place"][data-val="salle"]')
        tap(page, '[data-action="onb-freq"][data-val="4"]')
        link = page.locator('.onb [data-action="onb-import"]')
        R.check(link.count() == 1 and link.inner_text().replace('\u00a0', ' ').strip() == 'Importer mon historique Strong ou Hevy'
                and link.bounding_box()['height'] >= 44, f'{t} niveau : lien d\'import Strong / Hevy, 44 pt')
        R.check(link.bounding_box()['y'] > page.locator('.onb .onb__group').bounding_box()['y'], f'{t} lien sous les niveaux')
        R.check(small_targets(page) == 0 and no_hscroll(page), f'{t} niveau : 44 pt, pas de défilement horizontal')
        shot(page, LOT, f'4-niveau-import-{t}')
        with page.expect_file_chooser() as fc:
            link.click()
        R.check(fc.value is not None and page.evaluate('[data.activeProgramme, data.weeklyGoal, data.onboarded]') == ['upper_lower', 4, True],
                f'{t} import : choix du fichier ouvert, réponses appliquées')
        page.wait_for_timeout(300)
        R.check(page.locator('.onb').count() == 0, f'{t} import : questions fermées')
        # Même cellule dans Réglages › Données (pas seulement dans Sauvegarde)
        page.evaluate("navigate('settings')")
        page.wait_for_selector('.view.settings-view')
        cell = page.locator('.view.settings-view .group-title:text-is("Données") + .group [data-action="import-other-app"]')
        R.check(cell.count() == 1 and cell.inner_text().strip() == 'Importer de Strong ou Hevy', f'{t} Réglages › Données : « Importer de Strong ou Hevy »')

        # Utilisateur existant (séances) : rien
        seed(page, theme, ppl_v2_today_json())
        page.wait_for_timeout(400)
        R.check(page.locator('.onb').count() == 0, f'{t} utilisateur existant : pas de questions')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_parcours, t_plus_tard_et_autres])
