"""Retours du panel du 26/11 (16 juges sur captures) : générateur, champ coupé, Réglages, calendrier de l'Historique,
barre d'onglets, pastilles de Programme › Exercice. Un contrôle par point :
- Sur mesure : questions sans barre d'onglets, « Voir le programme » collé en bas et visible à la question 7 ; aperçu :
  seule la priorité en rouge, dite dessous ; phrase du temps chiffrée ; jamais deux variantes d'un même mouvement dans une
  séance ; programme nommé d'après les réponses ; pas de toast qui cache « Envoyer ce programme » ;
- « Coupé à 80 caractères » en gris secondaire (plus l'orange-jaune) ;
- Réglages : icône de l'Âge propre (gâteau), jamais l'horloge de l'Historique ; aide du Sexe qui dit à quoi il sert ;
  « Sauvegarde : Jamais » en gris tant qu'il n'y a rien à perdre ; tests du son regroupés, sans « GO » ni « hauteurs » ;
  texte agrandi : titres coupés entre syllabes, adresse du crédit coupée à ses « / » ;
- Historique : un jour avec séance cerclé de vert, lu « 1 séance » par VoiceOver ;
- barre d'onglets : libellé d'un onglet non choisi à 4,5:1 au moins, clair et sombre ;
- Programme › Exercice : rangée de pastilles jusqu'au bord de la carte, première pastille alignée sur les textes.
Captures : $PPL_SCRATCH/shots/lotretours_reglages/.
Lancer : PPL_DEV="iPhone SE" PPL_THEME=dark python3 test_retours_reglages.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'retours_reglages'
R = Results(LOT)

CONTRAST_JS = """([fg, bg]) => {
  const rgb = c => { const p = document.createElement('i'); p.style.color = c; document.body.append(p);
    const v = getComputedStyle(p).color.match(/[\\d.]+/g).map(Number); p.remove(); return v; };
  const lum = c => { const [r, g, b] = rgb(c).slice(0, 3).map(x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def tap(page, sel):
    page.click(sel)
    settle(page)


def go(page, r):
    page.evaluate('r => { if (currentRoute() === r) render(); else routeTo(r); }', r)
    settle(page)


def big_text(page):
    page.add_style_tag(content='html { font-size: 33px !important; }')
    page.evaluate("document.documentElement.classList.add('type-xl'); window.dispatchEvent(new Event('resize')); render()")
    settle(page)


def t_generateur(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("openProgGen()")
        settle(page)
        R.check(page.locator('.tabbar').is_hidden(), f'{t} questions du Sur mesure : pas de barre d\'onglets')
        icon_age = page.evaluate("document.querySelector('.view.prog-gen [data-action=\"set-profile-age\"] use')?.getAttribute('href')")
        R.check(icon_age == '#i-birthday', f'{t} Sur mesure : icône de l\'âge propre ({icon_age})')
        tap(page, '[data-action="gen-next"][data-step="toi"]')
        for v in ('muscle', 'intermediaire', '4', '60'):
            tap(page, f'[data-action="gen-set"][data-val="{v}"]')
        tap(page, '[data-action="gen-next"][data-step="materiel"]')
        tap(page, '[data-action="gen-zone"][data-val="fessiers"]')
        btn = page.evaluate("""(() => { const r = document.querySelector('[data-action="gen-next"][data-step="options"]').getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, h: innerHeight }; })()""")
        R.check(btn['top'] >= 0 and btn['bottom'] <= btn['h'] + 0.5, f'{t} question 7 : « Voir le programme » à l\'écran sans défiler {btn}')
        R.check(page.locator('.tabbar').is_hidden(), f'{t} question 7 : onglets masqués (rien ne quitte le questionnaire)')
        shot(page, LOT, f'gen-q7-{t}')
        tap(page, '[data-action="gen-next"][data-step="options"]')
        R.check(page.evaluate('currentRoute()') == 'prog-gen:apercu' and page.locator('.tabbar').is_visible(), f'{t} aperçu : barre d\'onglets revenue')
        txt = page.inner_text('.view.prog-gen')
        heat = page.evaluate("[...new Set([...document.querySelectorAll('.view.prog-gen [data-muscle][data-heat]')].map(e => e.dataset.muscle))]")
        R.check(heat == ['glutes'] and 'En rouge : ta priorité, les fessiers' in txt, f'{t} aperçu : seule la priorité en rouge, dite dessous {heat}')
        R.check('le temps limite' not in txt, f'{t} aperçu : plus de « le temps limite … »')
        dup = page.evaluate("""(() => { const out = [];
            for (const s of generateProgramme(genInputs()).sessions) { const n = s.exercises.map(e => e.name);
              n.forEach((a, i) => n.slice(i + 1).forEach(b => { if (genSameMove(a, b)) out.push(`${s.label} : ${a} / ${b}`); })); }
            return out; })()""")
        R.check(not dup, f'{t} aperçu : jamais deux variantes du même mouvement dans une séance {dup}')
        title = page.inner_text('.view.prog-gen .navbar__largetitle, .view.prog-gen h1').strip() if page.locator('.view.prog-gen h1').count() else ''
        R.check('Haut / Bas 4 jours, fessiers' in (title or txt), f'{t} aperçu : nommé d\'après les réponses ({title!r})')
        shot(page, LOT, f'gen-apercu-{t}')
        tap(page, '[data-action="gen-use"]')
        tap_dialog(page, 'Utiliser ce programme')
        page.wait_for_timeout(400)
        R.check(page.locator('.toast').count() == 0 or not page.locator('.toast').is_visible(), f'{t} programme créé : pas de toast posé sur « Envoyer ce programme »')
        R.check(page.evaluate('data.userProgrammes[data.activeProgramme].name') == 'Haut / Bas 4 jours, fessiers', f'{t} programme créé avec ce nom')
        shot(page, LOT, f'gen-programme-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:3]}')


def t_reglages(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        # Rien à perdre (aucune séance) : « Jamais » en gris secondaire
        d = json.loads(ppl_v2_today_json())
        d0 = {**d, 'history': []}
        seed(page, theme, json.dumps(d0, ensure_ascii=False))
        skip_questions(page)
        go(page, 'settings')
        v = page.locator('[data-action="go-backup"] .cell__value')
        R.check(v.count() == 1 and 'txt-warn' not in (v.get_attribute('class') or ''), f'{t} Sauvegarde sans séance : « Jamais » en gris, pas en rouge')
        # Âge : icône propre, nulle part ailleurs ; l'horloge reste à l'Historique
        uses = page.evaluate("""(() => [...document.querySelectorAll('use')].filter(u => u.getAttribute('href') === '#i-birthday')
            .map(u => u.closest('[data-action]')?.dataset.action))()""")
        R.check(uses == ['set-profile-age'], f'{t} Âge : icône gâteau, seule à la porter {uses}')
        R.check(page.locator('[data-action="set-profile-age"] use[href="#i-clock.history"]').count() == 0, f'{t} Âge : plus l\'horloge de l\'Historique')
        R.check('Sert à comparer ta force, facultatif' in page.inner_text('.view.settings-view'), f'{t} Sexe : aide qui dit à quoi il sert')
        # Sons : tests regroupés, sans jargon
        st = page.inner_text('.view.settings-view')
        R.check(page.locator('.view.settings-view .group-title:text-is("Tester le son")').count() == 1
                and 'Tester les aigus' in st and 'hauteurs' not in st and ' GO' not in st, f'{t} sons : tests sous « Tester le son », sans « GO » ni « hauteurs »')
        shot(page, LOT, f'reglages-{t}')
        page.locator('.view.settings-view .group-title:text-is("Tester le son")').scroll_into_view_if_needed()
        shot(page, LOT, f'reglages-sons-{t}')
        # Avec des séances jamais sauvegardées : rouge d'alerte
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        go(page, 'settings')
        R.check(page.locator('[data-action="go-backup"] .cell__value.txt-warn').count() == 1, f'{t} Sauvegarde jamais faite avec des séances : alerte')
        # Texte agrandi : coupure entre syllabes, adresse coupée à ses « / »
        big_text(page)
        css = page.evaluate("""(() => { const e = document.querySelector('.view.settings-view .cell__title'), s = getComputedStyle(e);
            return [s.hyphens || s.webkitHyphens, s.overflowWrap]; })()""")
        R.check(css[0] == 'auto' and css[1] == 'break-word', f'{t} texte agrandi : titres coupés entre syllabes {css}')
        R.check(page.evaluate("document.querySelector('.credit-foot').innerHTML.includes('/<wbr>')"), f'{t} texte agrandi : adresse du crédit coupée aux « / »')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} texte agrandi : rien ne déborde')
        page.locator('.credit-foot').scroll_into_view_if_needed()
        shot(page, LOT, f'reglages-legal-AX-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:3]}')


def t_champ_coupe(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        col = page.evaluate("""(() => { const box = document.createElement('div'); box.className = 'view view--grouped';
            box.innerHTML = '<div class="group"><div class="cell"><input id="tCut" maxlength="80"></div></div>'; document.getElementById('app').append(box);
            fieldNote(document.getElementById('tCut'), cutNoticeText(80), 'field-warn');
            const p = document.createElement('i'); p.style.color = 'var(--label2)'; document.body.append(p);
            const want = getComputedStyle(p).color; p.remove();
            const n = document.querySelector('.field-warn'); return [n ? getComputedStyle(n).color : null, want, n?.textContent]; })()""")
        R.check(col[0] == col[1] and col[2].startswith('Coupé à 80'), f'{t} « Coupé à 80 caractères » en gris secondaire {col}')


def t_calendrier(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json(), extra={'mdlf_hist_cal': '1'})
        page.locator('.tabbar [data-tab="history"]').click()
        settle(page)
        page.wait_for_selector('.hcal [data-action="hcal-day"]')
        day = page.locator('.hcal [data-action="hcal-day"]').first
        ring = day.evaluate("""b => { const s = getComputedStyle(b.querySelector('.num')); const p = document.createElement('i');
            p.style.color = 'var(--green-text)'; document.body.append(p); const want = getComputedStyle(p).color; p.remove();
            return [s.borderTopWidth, s.borderTopColor, want]; }""")
        R.check(ring[0] == '2px' and ring[1] == ring[2], f'{t} calendrier : jour avec séance cerclé de vert {ring}')
        lab = day.get_attribute('aria-label') or ''
        R.check(' séance' in lab and ' : ' in lab, f'{t} calendrier : VoiceOver dit le nombre de séances ({lab})')
        page.locator('.hcal').scroll_into_view_if_needed()
        shot(page, LOT, f'calendrier-{t}')
        big_text(page)
        over = page.evaluate("""[...document.querySelectorAll('.hcal .cal__d--has > .num')].filter(n => { const r = n.getBoundingClientRect(), c = n.parentElement.getBoundingClientRect();
            return r.left < c.left - 0.5 || r.right > c.right + 0.5; }).length""")
        R.check(over == 0 and page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} calendrier, texte agrandi : cercles dans leur case ({over})')
        page.locator('.hcal').scroll_into_view_if_needed()
        shot(page, LOT, f'calendrier-AX-{t}')


def t_onglets(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        cols = page.evaluate("""(() => { const b = document.querySelector('.tabbar .tabbar__btn:not(.tabbar__btn--active) .tabbar__label');
            return [getComputedStyle(b).color, getComputedStyle(document.querySelector('.tabbar')).backgroundColor]; })()""")
        ratio = page.evaluate(CONTRAST_JS, cols)
        R.check(ratio >= 4.5, f'{t} onglet non choisi : {ratio:.2f}:1 (4,5 au moins) {cols}')


def t_pastilles(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("r => navigate(r)", 'programmes')
        page.wait_for_selector('.programmes')
        page.click('[data-action="open-prog-session"][data-cat="pull"]')
        page.wait_for_selector('.view.editor')
        page.click('.ed-row[data-i="0"]')
        page.wait_for_selector('.view.ex-edit')
        for sel in ('.ex-equip', '.tempo__presets'):
            m = page.evaluate("""s => { const row = document.querySelector(s); if (!row) return null; const card = row.closest('.group').getBoundingClientRect();
                const r = row.getBoundingClientRect(), first = row.querySelector('.ax__chip').getBoundingClientRect();
                const title = document.querySelector('.view.ex-edit .group .cell__title, .view.ex-edit .group input')?.getBoundingClientRect();
                return { rowL: r.left - card.left, rowR: card.right - r.right, firstL: first.left - card.left, scroll: row.scrollWidth > row.clientWidth }; }""", sel)
            if m is None:
                # Matériel : seulement pour un exercice créé par la personne (la bibliothèque connaît le sien)
                R.check(sel == '.ex-equip', f'{t} {sel} absent')
                continue
            R.check(abs(m['rowL']) <= 0.5 and abs(m['rowR']) <= 0.5 and abs(m['firstL'] - 16) <= 0.5,
                    f'{t} {sel} : rangée jusqu\'aux bords de la carte, 1re pastille à 16 pt {m}')
        page.locator('.tempo__presets, .ex-equip').first.scroll_into_view_if_needed()
        shot(page, LOT, f'pastilles-{t}')


def o_captures(bench):
    """Captures Chromium (--mute-audio) : iPhone SE normal et AX33, iPhone 13, sombre et clair."""
    for dev in ('iPhone SE', 'iPhone 13'):
        for theme in THEMES:
            for ax in ((False, True) if dev == 'iPhone SE' else (False,)):
                n = f'{dev}-{theme}{"-AX33" if ax else ""}'.replace(' ', '_')
                with bench.page('chromium', dev, theme) as page:
                    seed(page, theme, ppl_v2_today_json(), extra={'mdlf_hist_cal': '1'})
                    if ax:
                        big_text(page)
                    go(page, 'settings')
                    shot(page, LOT, f'cap-reglages-{n}')
                    page.locator('.view.settings-view .group-title:text-is("Tester le son")').scroll_into_view_if_needed()
                    shot(page, LOT, f'cap-sons-{n}')
                    page.locator('.credit-foot').scroll_into_view_if_needed()
                    shot(page, LOT, f'cap-legal-{n}')
                    page.locator('.tabbar [data-tab="history"]').click()
                    settle(page)
                    shot(page, LOT, f'cap-calendrier-{n}')
                    page.evaluate("openProgGen()")
                    settle(page)
                    page.evaluate("genAns.zones = ['fessiers']; navigate(makeRoute('prog-gen', 'options'))")
                    settle(page)
                    shot(page, LOT, f'cap-gen-q7-{n}')
                    page.evaluate("navigate(makeRoute('prog-gen', 'apercu'))")
                    settle(page)
                    shot(page, LOT, f'cap-gen-apercu-{n}')
                    R.check(not page.errors, f'captures {n} : aucune erreur JS {page.errors[:3]}')


run_main(R, [t_generateur, t_reglages, t_champ_coupe, t_calendrier, t_onglets, t_pastilles], once=[o_captures])
