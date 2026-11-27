"""Retours des pratiquants du 26/11 (Inès, Karim, Gérard, puis 16 juges sur captures) : premier lancement, catalogue,
import Hevy, Progrès, Historique, bilan, image partagée, carte des muscles, fiche d'un programme.

- Premier lancement : nom du programme en français (« Corps entier », « Appelé aussi Full Body »), plus de pastille grise
  devant la séance (prise pour un bouton radio) ; « J'ai déjà un programme » mène à « Importer depuis Hevy ou Strong ».
- Séance créée et nommée « Push » à la main : affichée « Push », jamais « Pousser (Push) » ; séance intégrée : « Jambes »,
  plus « Jambes (Legs) ».
- Import Hevy sur une app neuve : le programme importé devient le programme actif, ses exercices se rangent dessous
  dans Progrès, l'Historique ne propose pas de filtre pour une séance jamais faite.
- Progrès : un exercice hors programme se range sous son muscle principal (« Pectoraux, hors programme »).
- Bilan : volume en kg (« 4 200 kg », plus « 4,2 t »), écart « +… par rapport à la dernière fois », « < 1 min ».
- Image partagée : même nom de séance que le bilan, « Soulevé » comme le bilan.
- Carte des muscles : aucun contour sans masque visible (rectangles gris du premier affichage).
- Fiche d'un programme qui n'est pas l'actif : durée estimée tirée de ses propres séances.

Lancer : PPL_DEV="iPhone SE" PPL_THEME=dark python3 test_retours_pratiquants.py (ou sans variable : tout).
Captures : $PPL_SCRATCH/shots/lotretours_pratiquants/.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'retours_pratiquants'
R = Results(LOT)
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'donnees')


def tag(dev, theme):
    return f'{dev}-{theme}'


def go(page, route):
    page.evaluate(f'() => {{ const r = {json.dumps(route)}; if (currentRoute() === r) render(); else routeTo(r); }}')
    settle(page)


def t_premier_lancement(bench, eng, dev, theme):
    """Débutant : « Corps entier » (Full Body en petit), pas de pastille ; « J'ai déjà un programme » : l'import est proposé."""
    with bench.page(eng, dev, theme) as page:
        t = tag(dev, theme)
        seed(page, theme, None)
        page.wait_for_selector('.onb [data-action="onb-place"]')
        page.locator('.onb [data-action="onb-place"]').first.click(); settle(page)
        page.click('.onb [data-action="onb-freq"][data-val="3"]'); settle(page)
        page.click('.onb [data-action="onb-level"][data-val="debutant"]'); settle(page)
        R.check(page.locator('#onbTitle').inner_text().strip() == 'Corps entier', f'{t} résultat : nom en français')
        R.check(page.locator('.onb .onb__eyebrow').inner_text().strip() == 'Ton programme · Full Body', f'{t} résultat : nom courant en petit, sur la ligne du dessus')
        R.check(page.locator('.onb .prog-sess .cat-badge, .onb .prog-sess [class*="badge"]').count() == 0, f'{t} résultat : plus de pastille devant la séance')
        row = page.locator('.onb .prog-sess').first.inner_text()
        R.check('Corps entier' in row and 'jambes' in row.lower(), f'{t} résultat : séance en clair, muscles dessous ({row!r})')
        shot(page, LOT, f'onb_resultat_{t}')
        # Retour à la première question : « J'ai déjà un programme »
        for _ in range(3):
            if page.locator('.onb [data-action="onb-back"]').count():
                page.click('.onb [data-action="onb-back"]'); settle(page)
        page.click('.onb [data-action="onb-have"]'); settle(page)
        page.evaluate("data.tour = 'seen'; save(true); if (typeof tourClose === 'function') tourClose()")
        page.wait_for_selector('.view.prog-add')
        imp = page.locator('.view.prog-add [data-action="import-other-app"]')
        R.check(imp.count() == 1 and imp.inner_text().strip() == 'Importer depuis Hevy ou Strong', f'{t} Ajouter un programme : import proposé')
        names = page.locator('.view.prog-add .cell__title').all_inner_texts()
        R.check(any(n.startswith('Pousser, tirer, jambes') and '(PPL)' in n for n in names), f'{t} catalogue : nom français, nom courant entre parenthèses {names[:4]}')
        shot(page, LOT, f'prog_add_{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_noms_seances(bench, eng, dev, theme):
    """« Push » tapé à la main reste « Push » ; la séance Legs du PPL s'appelle « Jambes »."""
    with bench.page(eng, dev, theme) as page:
        t = tag(dev, theme)
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("""() => { data.userProgrammes.u_karim = { name: 'Karim', archived: false, order: ['s1karim'],
              sessions: { s1karim: { label: 'Push', icon: '', desc: '', color: '#8E8E93' } } };
            data.programmes.u_karim = { exercises: { s1karim: [makeExercise('Développé couché barre', 3)] }, timers: { s1karim: null }, cooldowns: { s1karim: 72 } };
            addMyProgramme('u_karim'); activateProgramme('u_karim'); save(); render(); }""")
        settle(page)
        R.check(page.locator('.hero__name').inner_text().strip() == 'Push', f'{t} séance nommée « Push » à la main : « {page.locator(".hero__name").inner_text()} »')
        R.check(page.evaluate("[sessionTitle('legs', 'ppl'), sessionTitle('push', 'ppl')]") == ['Jambes', 'Pousser'], f'{t} séances intégrées : nom en français seul')


def t_import_hevy(bench, eng, dev, theme):
    """App neuve puis import Hevy : programme Hevy actif, Progrès rangé dessous, filtres de l'Historique sans séance vide."""
    with bench.page(eng, dev, theme) as page:
        t = tag(dev, theme)
        seed(page, theme, None)
        skip_questions(page)
        page.click('[data-action="go-settings"]')
        page.wait_for_selector('[data-action="go-backup"]')
        page.click('[data-action="go-backup"]')
        page.wait_for_selector('[data-action="import-other-app"]')
        with open(os.path.join(DATA_DIR, 'hevy_exemple.csv'), 'rb') as fh:
            buf = fh.read()
        with page.expect_file_chooser() as fc:
            page.click('[data-action="import-other-app"]')
        fc.value.set_files(files=[{'name': 'hevy.csv', 'mimeType': 'text/csv', 'buffer': buf}])
        page.wait_for_selector('.sheet-root:not(.sheet-root--out) .imp', timeout=5000)
        settle(page)
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.toast')
        toast = page.locator('.toast').inner_text()
        R.check('programme Hevy choisi' in toast, f'{t} import : « {toast} »')
        R.check(page.evaluate('data.activeProgramme') == 'u_hevy', f'{t} import : programme Hevy actif')
        go(page, 'stats')
        page.wait_for_selector('[data-action="open-stats-ex"]')
        titles = page.locator('.view.stats .group-title').all_inner_texts()
        R.check(not any(x.strip() in ('Push', 'Pull', 'Legs') for x in titles), f'{t} Progrès : rien sous le PPL jamais fait {titles}')
        R.check(any('Push Day' in x for x in titles), f'{t} Progrès : groupes du programme Hevy {titles}')
        shot(page, LOT, f'progres_import_{t}')
        go(page, 'history')
        cats = page.evaluate("historyFilterKeys().map(f => [f.label, f.n])")
        R.check(cats and all(n > 0 for _, n in cats) and not any(label == 'Push' for label, _ in cats), f'{t} Historique : filtres des seules séances faites {cats}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_progres_muscle(bench):
    """Exercice hors programme : rangé sous son muscle principal ; autre programme : « Bras, programme … »."""
    with bench.page('chromium', 'Pixel 7', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json())
        page.evaluate("""() => { const h = data.history[0];
            h.exercises.push({ exId: 'n:dips', name: 'Dips', sets: [{ weight: '', reps: '10' }] }); save(); }""")
        go(page, 'stats')
        titles = page.locator('.view.stats .group-title').all_inner_texts()
        R.check('Pectoraux, hors programme' in [x.strip() for x in titles] and 'Autres' not in titles, f'Progrès : Dips sous son muscle {titles}')
        R.check(not any(' · ' in x for x in titles), f'Progrès : plus de titre « Bras · Bras & épaules » {titles}')


def t_bilan(bench, eng, dev, theme):
    """Bilan : « 4 200 kg », jamais « t » ; écart « par rapport à la dernière fois » ; séance courte « < 1 min »."""
    with bench.page(eng, dev, theme) as page:
        t = tag(dev, theme)
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("""() => { const h = data.history.find(x => x.category === 'push'); lastSummary = buildSummary(h); openSummary(); }""")
        settle(page)
        page.wait_for_selector('.view.summary .sum-tile')
        tiles = page.locator('.view.summary .sum-tiles').inner_text()
        R.check(re.search(r'\d kg', tiles) and not re.search(r'\d t\b', tiles), f'{t} bilan : volume en kg ({tiles!r})')
        why = page.locator('.sum-tile__delta-why')
        R.check(why.count() == 0 or why.first.inner_text().strip() == 'que la dernière fois', f'{t} bilan : écart dit en clair')
        R.check(page.evaluate("sumDurationHtml(20000).includes('moins d\\'une minute') && !sumDurationHtml(20000).includes('0\\u00a0min')"),
                f'{t} bilan : moins d\'une minute, jamais « 0 min »')
        st = page.evaluate("(() => { const h = data.history.find(x => x.category === 'push'); return shareStoryStats(h).title; })()")
        R.check(st == 'Pousser', f'{t} image partagée : même nom que le bilan ({st!r})')
        shot(page, LOT, f'bilan_{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_carte_muscles(bench, eng, dev, theme):
    """Premier affichage de Progrès : un contour sans son masque n'est jamais visible (aplat gris)."""
    with bench.page(eng, dev, theme) as page:
        t = tag(dev, theme)
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("bodyOutlineMasks.clear()")
        page.evaluate("routeTo('stats')")
        page.wait_for_selector('.view.stats .body-map')
        bad = page.evaluate("""[...document.querySelectorAll('.body-map__ol')].filter(e => !e.style.maskImage && !e.style.webkitMaskImage
            && getComputedStyle(e).visibility !== 'hidden').length""")
        R.check(bad == 0, f'{t} carte des muscles : {bad} contour(s) sans masque visible(s)')
        page.wait_for_timeout(1500)
        shown = page.evaluate("[...document.querySelectorAll('.body-map__ol')].filter(e => getComputedStyle(e).visibility !== 'hidden').length")
        total = page.evaluate("document.querySelectorAll('.body-map__ol').length")
        R.check(total == 0 or shown == total, f'{t} carte des muscles : contours affichés une fois dessinés ({shown}/{total})')


def t_fiche_duree(bench):
    """Fiche d'un programme qui n'est pas l'actif : deux séances de même volume, même durée estimée."""
    with bench.page('chromium', 'Pixel 7', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json())
        mins = page.evaluate("""(() => { const d = PROGRAMMES.bro.defaults, sets = c => d[c].reduce((a, [, n]) => a + n, 0);
            const cats = Object.keys(d); return cats.map(c => [c, sets(c), sessionMinutes(c, 'bro')]); })()""")
        R.check(mins and all(m == max(5, int(n * 150 / 300 + 0.5) * 5) for _, n, m in mins), f'fiche : durée tirée des séances du programme {mins}')


def t_volume(bench):
    """fmtVolume : jamais en tonnes, espace insécable avant l'unité."""
    with bench.page('chromium', 'Pixel 7', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json())
        v = page.evaluate("fmtVolume(4200)")
        R.check(v == '4 200 kg', f'4 200 kg ({v!r})')


def t_liens(bench, eng, dev, theme):
    """Option 2 de Maxence (27/11) : l'orange n'est qu'aux boutons pleins ; liens dans la couleur du texte, en demi-gras ;
    « Liens en couleur » (Réglages › Apparence › Design) leur rend l'accent."""
    with bench.page(eng, dev, theme) as page:
        t = tag(dev, theme)
        seed(page, theme, ppl_v2_today_json())
        # Bouton plein : « Démarrer » de l'accueil ; lien : « Créer un programme » (Ajouter un programme), pris dans la page
        # de l'accueil restée dans la pile (même feuille de style)
        st = lambda: page.evaluate("""() => { const l = document.querySelector('.prog-add .cell--action'), b = document.querySelector('.hero__btn') || window.__heroBtn;
            const lab = getComputedStyle(document.body).color;
            return { link: l && getComputedStyle(l).color, weight: l && +getComputedStyle(l).fontWeight, label: lab, btn: b && getComputedStyle(b).backgroundColor,
                     btnText: b && getComputedStyle(b).color }; }""")
        page.evaluate("window.__heroBtn = document.querySelector('.hero__btn').cloneNode(true); document.body.appendChild(window.__heroBtn); window.__heroBtn.style.position = 'fixed'; window.__heroBtn.style.top = '-200px'")
        go(page, 'prog-add')
        s0 = st()
        want = 'rgb(202, 77, 16)' if theme == 'dark' else 'rgb(184, 70, 15)'
        R.check(s0['btn'] == want and s0['btnText'] == 'rgb(255, 255, 255)', f'{t} bouton plein orange, texte blanc {s0}')
        R.check(s0['link'] == s0['label'] and s0['weight'] >= 600, f'{t} lien dans la couleur du texte, en demi-gras {s0}')
        go(page, 'settings-design')
        sw = page.locator('[data-action="design-links"]')
        R.check(sw.count() == 1 and sw.get_attribute('aria-checked') == 'false', f'{t} Design : « Liens en couleur » éteint par défaut')
        shot(page, LOT, f'design_{t}')
        sw.click(); settle(page)
        R.check(page.evaluate("document.body.classList.contains('links-color') && data.design.links === true"), f'{t} Liens en couleur : allumé et enregistré')
        go(page, 'prog-add')
        s1 = st()
        R.check(s1['link'] not in (s1['label'],) and s1['btn'] == want, f'{t} Liens en couleur : lien dans l\'accent {s1}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_premier_lancement, t_noms_seances, t_import_hevy, t_bilan, t_carte_muscles, t_liens],
         once=[t_progres_muscle, t_fiche_duree, t_volume])
