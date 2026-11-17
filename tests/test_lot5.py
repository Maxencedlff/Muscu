"""Lot 5 : Historique, Progrès et Programme (critères d'acceptation du plan)."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 5
R = Results(LOT)


def tag(dev, theme):
    return f'{dev}-{theme}'


def go(page, v, **state):
    """Ouvre un écran directement par sa route."""
    sets = ''.join(f'{k} = {json.dumps(val)};' for k, val in state.items())
    page.evaluate(f'() => {{ {sets} const r = {json.dumps(v)}; if (currentRoute() === r) render(); else routeTo(r); }}')
    page.wait_for_timeout(120)


def no_dot_decimal(page, sel):
    import re
    txt = page.locator(sel).inner_text()
    return not re.search(r'\d\.\d', txt)


def visible_count(page, sel):
    return page.evaluate("""sel => {
        const vh = window.innerHeight;
        return [...document.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= vh && r.height > 0; }).length;
    }""", sel)


# ─────────────────────────────────────────────────────────────

def t_history(bench, eng, dev, theme):
    t = tag(dev, theme)
    # Date figée en milieu de mois : en début de mois, l'en-tête du nouveau mois prend la place d'une
    # ligne et le nombre de cellules visibles dépendait du jour où la suite tournait (échec du 05/11/2026)
    at = local_ms(2026, 10, 15, 18)
    with bench.frozen_page(at, eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json(now_ms=at, weeks=14))
        n0 = page.evaluate('data.history.length')
        R.check(n0 >= 44, f'{t} historique : jeu de {n0} séances')
        go(page, 'history')
        vis = visible_count(page, '.hcell')
        # Galaxy S9+ (320 px de large) : les sous-titres longs passent sur 2 lignes au lieu d'être tronqués
        # Vague 4 : le programme d'une séance d'un autre programme a sa ligne (« Programme Bras & épaules ») : une cellule de moins
        # 15/11 : cartes illustrées au gabarit des « Autres séances » de l'accueil (6,4 rem) : deux cartes de moins qu'en
        # liste de texte : 3 cartes entières partout (la 4e affleure la tab bar sur iPhone 13 selon la police : 4 en local,
        # 3 sur GitHub), la suivante entamée invite à défiler
        need = 3
        R.check(vis >= need, f'{t} historique : {vis} cellules visibles (>= {need})')
        h = page.locator('.hcell').first.bounding_box()['height']
        R.check(62 <= h <= 125, f'{t} historique : hauteur de cellule {h:.0f}')
        # Même hauteur de référence que les cartes de l'accueil (.home-cell.mgc : 6,4 rem)
        ref = page.evaluate("6.4 * parseFloat(getComputedStyle(document.documentElement).fontSize)")
        mh = float(page.evaluate("getComputedStyle(document.querySelector('.hcell--card')).minHeight").replace('px', ''))
        R.check(abs(mh - ref) < 1, f'{t} historique : hauteur de référence de l\'accueil ({mh:.0f} px, {ref:.0f} attendus)')
        # Le texte (mesuré au mot près, Range) ne passe jamais sous le personnage (face et dos de la séance)
        under = page.evaluate("""() => [...document.querySelectorAll('.hcell--card')].flatMap(c => {
            const i = c.querySelector('.hcell__map'); if (!i || !i.offsetWidth) return [];
            const left = i.getBoundingClientRect().left;
            return [...c.querySelectorAll('.hcell__title, .hcell__date, .hcell__rec, .hcell__prog, .hcell__sub')].filter(e => {
              const r = document.createRange(); r.selectNodeContents(e);
              return [...r.getClientRects()].some(q => q.width > 0 && q.right > left + 4); }).map(e => e.textContent.trim()); })""")
        R.check(not under, f'{t} historique : aucun texte sous la vignette {under[:3]}')
        # Cartes illustrées (15/11) : chaque séance a son personnage entier, face et dos, décoratif, dans la carte, à droite
        # du texte sans le recouvrir ; muscles principaux de ses exercices en rouge plein : Push → pectoraux, Pull → grand
        # dorsal, Legs → quadriceps ; aucun fondu animé (des dizaines de calques à la fois)
        cards = page.evaluate("""() => [...document.querySelectorAll('.hrow:not(.hrow--health) .hcell--card')].map(c => {
            const i = c.querySelector('.hcell__map .body-map'), b = c.getBoundingClientRect(), tx = c.querySelector('.hcell__body').getBoundingClientRect();
            const r = i && i.getBoundingClientRect();
            const main = i ? [...new Set([...i.querySelectorAll('.body-map__m:not(.body-map__m--sec)')].map(m => m.dataset.muscle))] : [];
            return { t: c.querySelector('.hcell__title').textContent.trim(), views: i ? i.querySelectorAll('.body-map__fig').length : 0, main,
                     hidden: i ? i.getAttribute('aria-hidden') : null, inside: !!r && r.top >= b.top - 1 && r.bottom <= b.bottom + 1 && r.right <= b.right + 1,
                     clear: !!r && r.left >= tx.right, anim: i ? [...i.querySelectorAll('.body-map__m')].some(m => getComputedStyle(m).animationName !== 'none') : null }; })""")
        R.check(cards and all(c['views'] == 2 and c['hidden'] == 'true' and c['main'] for c in cards), f'{t} historique : personnage face et dos, décoratif, sur chaque carte {cards[:1]}')
        R.check(all(c['inside'] for c in cards), f'{t} historique : personnages dans leur carte {[c["t"] for c in cards if not c["inside"]][:3]}')
        R.check(all(c['clear'] for c in cards), f'{t} historique : personnage à droite du texte {[c["t"] for c in cards if not c["clear"]][:3]}')
        R.check(not any(c['anim'] for c in cards), f'{t} historique : calques des personnages sans animation')
        want = {'Push': 'chest', 'Pull': 'lats', 'Legs': 'quads'}
        bad = [c for c in cards if c['t'] in want and want[c['t']] not in c['main']]
        R.check(not bad, f'{t} historique : muscles principaux de la séance {[(c["t"], c["main"]) for c in bad][:3]}')
        heads = page.locator('.hmonth__title').all_inner_texts()
        R.check(heads and all('séance' in x for x in heads), f'{t} historique : nombre de séances par mois {heads[:2]}')
        # Texte agrandi : plus de vignette, aucun titre ni détail coupé
        xl = page.evaluate("""() => { const h = document.documentElement; h.classList.add('type-xl');
            const imgs = [...document.querySelectorAll('.hcell__map')].filter(i => i.offsetWidth > 0).length;
            const cut = [...document.querySelectorAll('.hcell__title, .hcell__sub, .hcell__date')].filter(e => e.scrollWidth > e.clientWidth + 1).length;
            h.classList.remove('type-xl'); return { imgs, cut }; }""")
        R.check(xl == {'imgs': 0, 'cut': 0}, f'{t} historique texte agrandi : personnages retirés, rien de coupé {xl}')
        # Texte agrandi : filtres sur deux colonnes, aucun mot coupé (« Toute/s ») ; chaque mot tient sur une seule ligne
        split = page.evaluate("""() => { const h = document.documentElement; h.classList.add('type-xl');
            const bad = [...document.querySelectorAll('.hist-tools .segmented__btn')].filter(b => {
              const tn = [...b.childNodes].find(n => n.nodeType === 3); if (!tn) return false;
              let at = 0; return tn.textContent.split(' ').some(w => { const r = document.createRange(); r.setStart(tn, at); r.setEnd(tn, at + w.length); at += w.length + 1;
                const tops = new Set([...r.getClientRects()].filter(q => q.width > 0).map(q => Math.round(q.top))); return tops.size > 1; }); }).map(b => b.textContent);
            const sw = document.documentElement.scrollWidth; h.classList.remove('type-xl'); return { bad, sw }; }""")
        R.check(not split['bad'] and split['sw'] <= page.viewport_size['width'], f'{t} historique texte agrandi : filtres sans mot coupé {split}')
        R.check(no_dot_decimal(page, '#histList'), f'{t} historique : aucun point décimal')
        R.check(page.locator('.hcell__date', has_text='12:00').count() == 0, f'{t} historique : pas d\'heure fictive')
        R.check(page.locator('.hmonth').count() == 3 and page.locator('[data-action="hist-more"]').count() == 1,
                f'{t} historique : pagination sur 3 mois')
        shot(page, LOT, f'history_{dev}_{theme}')
        # Records en toutes lettres (« 4 records », pas un chiffre seul après la médaille)
        import re
        recs = page.locator('.hcell__rec').all_inner_texts()
        R.check(recs and all(re.fullmatch(r'\d+ records?', x.strip()) for x in recs), f'{t} historique : records en toutes lettres {recs[:3]}')
        # Filtres tirés de l'historique : la séance « Bras » d'un autre programme a son filtre, qui ne montre qu'elle
        bras = page.locator('[data-action="hist-filter"]', has_text='Bras')
        R.check(bras.count() == 1 and '/' in (bras.get_attribute('data-cat') or ''), f'{t} historique : filtre Bras (autre programme)')
        if bras.count() == 1:
            bras.click()
            tb = set(page.evaluate("[...document.querySelectorAll('.hcell__title')].map(e => e.textContent)"))
            R.check(tb == {'Bras'}, f'{t} historique : filtre Bras ({tb})')
        # Filtre Pull + recherche
        page.click('[data-action="hist-filter"][data-cat="pull"]')
        titles = set(page.evaluate("[...document.querySelectorAll('.hcell__title')].map(e => e.textContent)"))
        R.check(titles == {'Pull'}, f'{t} historique : filtre Pull ({titles})')
        page.fill('#histSearch', 'genou')
        R.check(page.locator('.hcell').count() == 0, f'{t} historique : recherche combinée au filtre')
        page.click('[data-action="hist-filter"][data-cat="all"]')
        R.check(page.locator('.hcell').count() == 1, f'{t} historique : recherche dans les notes ({page.locator(".hcell").count()})')
        page.fill('#histSearch', '')
        # Balayage vers la gauche → Supprimer → Annuler
        cell = page.locator('.hcell').first
        hid = page.locator('.hrow').first.get_attribute('data-id')
        b = cell.bounding_box()
        page.mouse.move(b['x'] + b['width'] - 30, b['y'] + b['height'] / 2)
        page.mouse.down()
        for k in range(1, 8):
            page.mouse.move(b['x'] + b['width'] - 30 - k * 20, b['y'] + b['height'] / 2)
        page.mouse.up()
        page.wait_for_timeout(300)
        R.check(page.locator('.hrow.is-open').count() == 1, f'{t} historique : balayage révèle Supprimer')
        page.click('.hrow.is-open .hrow__del')
        page.wait_for_timeout(250)
        # Confirmation obligatoire : rien ne part avant « Supprimer de l'historique »
        R.check(page.evaluate(f'data.history.some(h => h.id === "{hid}")') and page.locator('.ios-dialog__btn--destructive').count() == 1,
                f'{t} historique : balayage demande confirmation')
        page.click('.ios-dialog__btn--destructive')
        page.wait_for_timeout(250)
        gone = page.evaluate(f'!data.history.some(h => h.id === "{hid}") && data.trash[0]?.entry.id === "{hid}"')
        R.check(gone and page.locator(f'.hrow[data-id="{hid}"]').count() == 0, f'{t} historique : séance passée en corbeille sans re-rendu')
        R.check('Séance supprimée' in page.locator('.toast').inner_text(), f'{t} historique : toast Annuler')
        shot(page, LOT, f'history_undo_{dev}_{theme}')
        page.click('.toast__action')
        page.wait_for_timeout(150)
        R.check(page.evaluate(f'data.history.some(h => h.id === "{hid}")') and page.evaluate('data.history.length') == n0,
                f'{t} historique : Annuler restaure la séance')
        # Détail
        page.click(f'.hrow[data-id="{hid}"] .hcell')
        page.wait_for_selector('.view.history-detail')
        trunc = page.evaluate("""() => [...document.querySelectorAll('.hex__name, .hex__sets')].filter(e => e.scrollWidth > e.clientWidth + 1).length""")
        R.check(trunc == 0, f'{t} détail : aucun nom tronqué ({trunc})')
        R.check(no_dot_decimal(page, '.view.history-detail'), f'{t} détail : aucun point décimal')
        R.check(page.locator('[data-action="edit-session"]').count() == 1 and page.locator('.cell--destructive', has_text='Supprimer de l\'historique').count() == 1,
                f'{t} détail : Modifier et Supprimer')
        # En-tête illustré : personnage décoratif de la séance (face et dos), groupes travaillés écrits ; une vignette par exercice
        hd = page.evaluate("""() => { const i = document.querySelector('.hdhead .hdhead__map .body-map');
            return { img: !!i && i.getAttribute('aria-hidden') === 'true' && i.querySelectorAll('.body-map__fig').length === 2, mus: document.querySelector('.hdhead__mus')?.textContent || '',
                     h1: document.querySelector('.hdhead h1.scr-title')?.textContent || '', ex: document.querySelectorAll('.hex').length,
                     exImg: document.querySelectorAll('.hex img.hex__img[aria-hidden="true"]').length,
                     over: [...document.querySelectorAll('.hex')].filter(c => { const i = c.querySelector('.hex__img'), n = c.querySelector('.hex__name');
                       return i && n && n.getBoundingClientRect().right > i.getBoundingClientRect().left + 1; }).length }; }""")
        R.check(hd['img'] and hd['mus'] and hd['h1'], f'{t} détail : en-tête illustré, groupes écrits {hd}')
        R.check(hd['ex'] > 0 and hd['exImg'] == hd['ex'] and hd['over'] == 0, f'{t} détail : vignette par exercice, sans recouvrir le nom {hd}')
        when = page.inner_text('.hdhead__when')
        tm = page.evaluate("(() => { const e = document.querySelector('.hdhead__time'); return e ? [e.textContent, getComputedStyle(e).whiteSpace] : null; })()")
        R.check(re.search(r'\d{4} ·\u00a0\d{1,2}:\d{2}$', when) is not None and tm and tm[1] == 'nowrap', f'{t} détail : « · heure » d\'un seul tenant {when!r} {tm}')
        # En-tête : le texte (au mot près) s'arrête avant la vignette, en taille normale comme en AX33
        for xl in (False, True):
            hit = page.evaluate("""xl => { const h = document.documentElement; h.classList.toggle('type-xl', xl);
                const i = document.querySelector('.hdhead__map'), r = i && i.offsetWidth ? i.getBoundingClientRect() : null;
                const bad = r ? [...document.querySelectorAll('.hdhead__title, .hdhead__when, .hdhead__mus, .hdhead__prog')].filter(e => {
                  const g = document.createRange(); g.selectNodeContents(e); return [...g.getClientRects()].some(q => q.width > 0 && q.right > r.left); }).map(e => e.textContent) : [];
                const cut = [...document.querySelectorAll('.hdhead__time')].some(e => { const g = document.createRange(); g.selectNodeContents(e); return new Set([...g.getClientRects()].map(q => Math.round(q.top))).size > 1; });
                h.classList.remove('type-xl'); return { bad, cut }; }""", xl)
            R.check(not hit['bad'] and not hit['cut'], f'{t} détail{" AX" if xl else ""} : en-tête sans texte sous l\'image, heure entière {hit}')
        # Records du détail en texte agrandi : la valeur sous le nom, pleine largeur, rien de coupé ; libellé en toutes lettres
        rid = page.evaluate('historySorted().find(h => entryRecords(h).length)?.id')
        if rid:
            go(page, f'history-detail:{rid}')
            rx = page.evaluate("""() => { const h = document.documentElement; h.classList.add('type-xl');
                const out = [...document.querySelectorAll('.history-detail .review-rec')].map(c => { const b = c.querySelector('.cell__body').getBoundingClientRect(),
                  v = c.querySelector('.review-rec__val'), vr = v.getBoundingClientRect();
                  return { below: vr.top >= b.bottom - 1, cut: v.scrollWidth > v.clientWidth + 1, wide: b.width > c.getBoundingClientRect().width * .6 }; });
                h.classList.remove('type-xl'); return out; }""")
            R.check(rx and all(x['below'] and not x['cut'] and x['wide'] for x in rx), f'{t} détail texte agrandi : valeur des records sous le nom {rx[:2]}')
            subs = page.locator('.history-detail .review-rec .cell__sub').all_inner_texts()
            R.check(not any('Record reps' in x for x in subs), f'{t} détail : « Record de répétitions » en toutes lettres {subs[:3]}')
            go(page, f'history-detail:{hid}')
        shot(page, LOT, f'history_detail_{dev}_{theme}')
        page.click('.navbar__back')  # Fusion : barre de navigation du lot 3
        R.check(page.locator('.view.history').count() == 1, f'{t} détail : retour à l\'historique')
        R.check(not page.errors, f'{t} historique : erreurs JS {page.errors[:2]}')


# Horloge figée le dimanche 25 octobre 2026 à 20 h, heure de Paris (jour du passage à l'heure d'hiver : la
# semaine depuis lundi dure 169 h). Pull (lundi) et Legs (mercredi) y sont, Push (samedi d'avant) non.
SUNDAY_EVENING = local_ms(2026, 10, 25, 20, 0, tz=PARIS)


def t_history_corps(bench, eng, dev, theme):
    """Retour de Maxence (15/11) : une séance épaules + abdos montre les deux groupes en rouge plein, les muscles en
    soutien dans une autre teinte ; « Epaules » et « Épaules » (deux programmes) ne font qu'un filtre."""
    t = tag(dev, theme)
    at = local_ms(2026, 10, 15, 18)
    with bench.frozen_page(at, eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json(now_ms=at, weeks=2))
        page.evaluate("""at => {
            const ex = names => names.map(name => ({ name, sets: [{ weight: '20', reps: '10' }, { weight: '20', reps: '10' }] }));
            data.history.push(
              { id: 'ep1', date: at - 3600e3, category: 'Epaules', programme: 'zz-epaules-1', exercises: ex(['Développé militaire', 'Élévations latérales', 'Crunch']) },
              { id: 'ep2', date: at - 30 * 3600e3, category: 'Épaules', programme: 'zz-epaules-2', exercises: ex(['Élévations latérales']) });
            save(); }""", at)
        go(page, 'history')
        pills = page.locator('[data-action="hist-filter"]').all_inner_texts()
        ep = [p for p in pills if p.strip().lower() in ('epaules', 'épaules')]
        R.check(ep == ['Épaules'], f'{t} historique corps : une seule pastille Épaules, avec accent {pills}')
        card = page.evaluate("""() => { const c = document.querySelector('.hrow[data-id="ep1"] .body-map');
            if (!c) return null;
            const ms = [...c.querySelectorAll('.body-map__m')];
            const main = [...new Set(ms.filter(m => !m.classList.contains('body-map__m--sec')).map(m => m.dataset.muscle))];
            const sec = ms.filter(m => m.classList.contains('body-map__m--sec'));
            const col = el => el ? getComputedStyle(el).backgroundColor : '';
            return { main, sec: [...new Set(sec.map(m => m.dataset.muscle))], cMain: col(ms.find(m => !m.classList.contains('body-map__m--sec'))), cSec: col(sec[0]) }; }""")
        R.check(card and 'abs' in card['main'] and any('delts' in m for m in card['main']), f'{t} historique corps : épaules ET abdos en principaux {card}')
        R.check(card and card['sec'] and not set(card['sec']) & set(card['main']), f'{t} historique corps : secondaires en --sec, hors principaux {card}')
        R.check(card and card['cMain'] and card['cSec'] and card['cMain'] != card['cSec'], f'{t} historique corps : deux teintes distinctes {card}')
        page.evaluate("document.querySelector('.hrow[data-id=\"ep1\"]').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'history_corps_{dev}_{theme}')
        # Titres des cartes : le libellé fusionné, avec l'accent, pour les deux séances (données gardées telles quelles)
        tt = page.evaluate("['ep1', 'ep2'].map(id => document.querySelector(`.hrow[data-id=\"${id}\"] .hcell__title`)?.firstChild?.textContent)")
        R.check(tt == ['Épaules', 'Épaules'] and page.evaluate("data.history.find(h => h.id === 'ep1').category") == 'Epaules',
                f'{t} historique corps : titres fusionnés « Épaules », données inchangées {tt}')
        page.locator('[data-action="hist-filter"]', has_text='Épaules').click()
        ids = set(page.evaluate("[...document.querySelectorAll('.hrow')].map(r => r.dataset.id)"))
        R.check(ids == {'ep1', 'ep2'}, f'{t} historique corps : le filtre fusionné montre les deux séances {ids}')
        page.click('.hrow[data-id="ep1"] .hcell')
        page.wait_for_selector('.view.history-detail')
        dm = page.evaluate("""() => { const c = document.querySelector('.hdhead__map .body-map'); if (!c) return null;
            return { main: [...new Set([...c.querySelectorAll('.body-map__m:not(.body-map__m--sec)')].map(m => m.dataset.muscle))],
                     sec: c.querySelectorAll('.body-map__m--sec').length }; }""")
        R.check(dm and 'abs' in dm['main'] and dm['sec'] > 0, f'{t} détail corps : même personnage principal / soutien {dm}')
        h1 = page.inner_text('.hdhead__title').strip()
        R.check(h1 == 'Épaules', f'{t} détail corps : titre fusionné « Épaules » ({h1})')
        # Légende des deux teintes, une seule fois, dans le détail (pas dans la liste : une carte visible de moins sur SE)
        leg = page.evaluate("""() => ({ list: document.querySelectorAll('.view.history .body-legend').length,
            dots: [...document.querySelectorAll('.hdhead .body-legend__dot')].map(d => getComputedStyle(d).backgroundColor),
            txt: document.querySelector('.hdhead .body-legend')?.textContent || '' })""")
        R.check(len(leg['dots']) == 2 and leg['dots'][0] != leg['dots'][1] and 'Ciblés' in leg['txt'] and 'En soutien' in leg['txt'],
                f'{t} détail corps : légende Ciblés / En soutien en deux teintes {leg}')
        shot(page, LOT, f'history_corps_detail_{dev}_{theme}')
        R.check(not page.errors, f'{t} historique corps : erreurs JS {page.errors[:2]}')


def t_history_filtres(bench, eng, dev, theme):
    """Retour de Maxence (15/11) : 20 séances de noms différents. « Toutes » + au plus 4 séances + « Plus » (6 boutons
    au plus, aucun défilement horizontal) ; une séance choisie dans « Plus » filtre la liste et devient visible."""
    t = tag(dev, theme)
    at = local_ms(2026, 10, 15, 18)
    with bench.frozen_page(at, eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json(now_ms=at, weeks=2))
        page.evaluate("""at => {
            const ex = [{ name: 'Curl biceps', sets: [{ weight: '10', reps: '10' }] }];
            for (let i = 1; i <= 20; i++) for (let k = 0; k < 1 + (i % 3); k++)
              data.history.push({ id: `bl${i}-${k}`, date: at - (i * 2 + k) * 86400e3, category: `Bloc ${String(i).padStart(2, '0')}`,
                                  programme: `zz-bloc-${i}`, exercises: ex });
            save(); }""", at)
        go(page, 'history')
        bar = page.evaluate("""() => { const s = document.querySelector('.hist-seg');
            return { n: [...s.querySelectorAll('.segmented__btn')].filter(b => b.offsetWidth > 0).length,
                     sw: s.scrollWidth, cw: s.clientWidth, page: document.documentElement.scrollWidth,
                     more: !!s.querySelector('.hist-seg__more') && s.querySelector('.hist-seg__more').offsetWidth > 0 }; }""")
        R.check(bar['n'] <= 6 and bar['more'], f'{t} filtres : au plus 6 boutons dont « Plus » {bar}')
        R.check(bar['sw'] <= bar['cw'] + 1 and bar['page'] <= page.viewport_size['width'], f'{t} filtres : aucun défilement horizontal {bar}')
        shot(page, LOT, f'history_filtres_{dev}_{theme}')
        page.click('.hist-seg .hist-seg__more')
        page.wait_for_selector('.sheet .hist-pick')
        rows = page.evaluate("""() => [...document.querySelectorAll('.sheet .hist-pick')].map(r => ({ k: r.dataset.pick,
            l: r.querySelector('.cell__title').textContent, n: +r.querySelector('.cell__value').textContent }))""")
        shown = set(page.evaluate("[...document.querySelectorAll('.hist-seg [data-action=\"hist-filter\"]')].filter(b => b.offsetWidth > 0).map(b => b.dataset.cat)"))
        # En tête : « Toutes les séances », cochée (filtre en cours), puis les autres séances
        checks = page.evaluate("[...document.querySelectorAll('.sheet .hist-pick')].filter(r => r.querySelector('.hist-pick__check svg')).map(r => r.dataset.pick)")
        R.check(rows and rows[0]['k'] == 'all' and rows[0]['l'] == 'Toutes les séances' and checks == ['all'], f'{t} filtres : « Toutes les séances » en tête, cochée {rows[:1]} {checks}')
        rows = rows[1:]
        R.check(len(rows) >= 15 and not shown & {r['k'] for r in rows}, f'{t} filtres : « Plus » liste les autres séances ({len(rows)})')
        R.check(all(rows[i]['n'] >= rows[i + 1]['n'] for i in range(len(rows) - 1)), f'{t} filtres : feuille triée par nombre de séances {[r["n"] for r in rows][:6]}')
        shot(page, LOT, f'history_filtres_plus_{dev}_{theme}')
        pick = rows[-1]
        page.click(f'.sheet .hist-pick[data-pick="{pick["k"]}"]')
        page.wait_for_timeout(400)
        titles = set(page.evaluate("[...document.querySelectorAll('.hcell__title')].map(e => e.textContent)"))
        act = page.evaluate("""() => { const b = document.querySelector('.hist-seg .segmented__btn--active[data-action="hist-filter"]');
            return b ? { k: b.dataset.cat, vis: b.offsetWidth > 0 } : null; }""")
        R.check(titles == {pick['l']}, f'{t} filtres : séance choisie dans « Plus » appliquée {titles}')
        R.check(act == {'k': pick['k'], 'vis': True}, f'{t} filtres : filtre choisi visible et actif {act}')
        n2 = page.evaluate("[...document.querySelectorAll('.hist-seg .segmented__btn')].filter(b => b.offsetWidth > 0).length")
        # Coche sur le filtre en cours à la réouverture de la feuille
        page.click('.hist-seg .hist-seg__more')
        page.wait_for_selector('.sheet .hist-pick')
        on = page.evaluate("[...document.querySelectorAll('.sheet .hist-pick')].filter(r => r.querySelector('.hist-pick__check svg')).map(r => r.dataset.pick)")
        R.check(on == [] or on == [pick['k']], f'{t} filtres : coche sur le filtre en cours {on}')
        page.click('.sheet .sheet__btn--cancel')
        page.wait_for_timeout(400)
        R.check(n2 <= 6, f'{t} filtres : toujours au plus 6 boutons ({n2})')
        # Texte agrandi : « Toutes » et le bouton de la feuille (nom du filtre choisi), rien d'autre
        xl = page.evaluate("""() => { document.documentElement.classList.add('type-xl');
            const v = [...document.querySelectorAll('.hist-seg .segmented__btn')].filter(b => b.offsetWidth > 0).map(b => b.textContent.trim());
            return v; }""")
        R.check(len(xl) == 2 and xl[0] == 'Toutes' and xl[1] == pick['l'], f'{t} filtres texte agrandi : Toutes + Filtrer {xl}')
        page.click('.hist-seg .hist-seg__xl')
        page.wait_for_selector('.sheet .hist-pick')
        R.check(page.locator('.sheet .hist-pick').count() >= 20, f'{t} filtres texte agrandi : la feuille liste toutes les séances')
        page.evaluate("document.documentElement.classList.remove('type-xl')")
        R.check(not page.errors, f'{t} filtres : erreurs JS {page.errors[:2]}')


def t_progress(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(SUNDAY_EVENING, eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json(now_ms=SUNDAY_EVENING))
        go(page, 'stats')
        R.check(page.locator('.tile').count() == 0 and page.locator('.stat-pair__item').count() == 2, f'{t} progrès : deux chiffres groupés, plus de tuiles')
        # Records de la semaine sous « Vue d'ensemble » : la dernière semaine des données, seuls les exercices
        # au rang 0 et 3 de leur séance montent de charge (fixtures.ppl_v2_today) : Rowing, Curl biceps (Pull),
        # Squat, Leg curl (Legs) ; ceux de la Push du samedi d'avant ne comptent pas
        n = page.evaluate('weekRecordCount(exerciseIndex())')
        subs = page.locator('[data-action="go-stats-overview"] .cell__sub').all_inner_texts()
        R.check(n == 4 and subs == ['4 records cette semaine'], f'{t} progrès : {n} records de la semaine sous « Vue d\'ensemble » {subs}')
        R.check(page.locator('[data-action="go-stats-overview"]').count() == 1, f'{t} progrès : ligne Vue d\'ensemble')
        R.check(page.locator('.group-title', has_text='Autres').count() == 1, f'{t} progrès : section Autres (Dips)')
        R.check(no_dot_decimal(page, '.view.stats'), f'{t} progrès : aucun point décimal')
        shot(page, LOT, f'progress_{dev}_{theme}')
        page.click('[data-action="open-stats-ex"][data-ex="p1dcouch"]')
        page.wait_for_selector('#exChart canvas')
        page.click('[data-action="stats-mode"][data-mode="charge"]')
        page.wait_for_timeout(150)
        box = page.locator('#exChart').bounding_box()
        page.mouse.move(box['x'] + box['width'] * 0.4, box['y'] + box['height'] / 2)
        page.wait_for_timeout(100)
        bub = page.locator('.chart-bubble')
        R.check(bub.is_visible(), f'{t} graphique : bulle affichée')
        i = int(bub.get_attribute('data-i') or -1)
        expect = page.evaluate("""i => {
            const pts = data.history.filter(h => h.exercises.some(e => e.exId === 'p1dcouch')).sort((a, b) => a.date - b.date);
            const e = pts[i].exercises.find(e => e.exId === 'p1dcouch');
            const w = Math.max(...e.sets.map(s => parseFloat(s.weight) || 0));
            const r = Math.max(...e.sets.filter(s => parseFloat(s.weight) === w).map(s => parseInt(s.reps)));
            return { w: new Intl.NumberFormat('fr-FR').format(w), r, date: new Date(pts[i].date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) };
        }""", i)
        txt = bub.inner_text()
        R.check(f"{expect['w']} kg × {expect['r']}" in txt and expect['date'] in txt, f'{t} graphique : bulle = données ({txt} / {expect})')
        labels = page.evaluate('chartState.xLabels')
        ok = all(a['x'] + a['w'] + 6 <= b['x'] or b['x'] + b['w'] + 6 <= a['x'] for k, a in enumerate(labels) for b in labels[k + 1:])
        R.check(ok and len(labels) >= 2, f'{t} graphique : étiquettes X sans chevauchement ({len(labels)})')
        R.check('kg' in (page.locator('#exChart canvas').get_attribute('aria-label') or ''), f'{t} graphique : aria-label')
        R.check(page.locator('.tbar').count() == 0, f'{t} graphique : pas d\'objectif sans cible')
        R.check(no_dot_decimal(page, '.view.stats-ex'), f'{t} détail exercice : aucun point décimal')
        n_sess = page.evaluate("data.history.filter(h => h.exercises.some(e => e.exId === 'p1dcouch')).length")
        R.check(page.locator('.view.stats-ex [data-action="open-history"]').count() == n_sess, f'{t} détail exercice : {n_sess} séances listées')
        shot(page, LOT, f'progress_ex_{dev}_{theme}')
        # Paysage : nouveau dessin à la nouvelle largeur
        vp = page.viewport_size
        page.set_viewport_size({'width': vp['height'], 'height': vp['width']})
        page.wait_for_timeout(400)
        cw = page.evaluate("document.querySelector('#exChart canvas').getBoundingClientRect().width")
        bw = page.evaluate("document.querySelector('#exChart').clientWidth")
        # Grand écran : la colonne de lecture plafonne à 640 px (a6fb274), le graphique ne peut plus s'élargir
        capped = page.evaluate("innerWidth > 720 && document.querySelector('#exChart').clientWidth <= 640")
        # Appareil déjà en paysage (Duo paysage) : la « rotation » le remet en portrait, plus étroit ; seul le redessin compte
        narrower = vp['height'] < vp['width']
        R.check(abs(cw - bw) < 2 and (cw > vp['width'] or capped or narrower), f'{t} graphique : redessiné à la nouvelle largeur ({cw:.0f}/{bw})')
        page.set_viewport_size(vp)
        page.wait_for_timeout(200)
        # 1RM : bouton d'explication
        page.click('[data-action="stats-mode"][data-mode="1rm"]')
        page.click('[data-action="info-1rm"]')
        page.wait_for_timeout(250)
        R.check('Fiable jusqu\'à 12 reps' in page.locator('.ios-dialog').inner_text(), f'{t} 1RM : explication courte')
        tap_dialog(page, 'OK')
        # Vue d'ensemble
        go(page, 'stats-overview')
        R.check(page.locator('.wk').count() == 12, f'{t} vue d\'ensemble : 12 semaines')
        R.check(page.locator('.stats-overview .cal').count() == 0, f'{t} vue d\'ensemble : calendrier passé dans l\'Historique')
        shot(page, LOT, f'overview_{dev}_{theme}')
        # Historique : calendrier du mois en tête (retour de Maxence du 16/11), repliable, un jour touché montre ses séances
        go(page, 'history')
        # Fermé par défaut (la liste garde ses cartes à l'écran), ouvert par le bouton calendrier de la barre
        tog = page.locator('.navbar [data-action="hcal-toggle"]')
        R.check(tog.get_attribute('aria-expanded') == 'false' and tog.get_attribute('aria-label') == 'Calendrier' and page.locator('.hcal').count() == 0,
                f'{t} historique : calendrier fermé par défaut, bouton « Calendrier » dans la barre')
        bb = tog.bounding_box()
        R.check(bb and bb['width'] >= 44 and bb['height'] >= 44, f'{t} historique : bouton calendrier de 44 pt {bb}')
        tog.click(); page.wait_for_timeout(150)
        navs = page.evaluate("[...document.querySelectorAll('.hcal .cal__nav')].map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); })")
        R.check(navs and min(navs) >= 44, f'{t} historique : chevrons de 44 pt ({navs})')
        page.click('[data-action="hcal-month"][data-d="-1"]'); page.wait_for_timeout(150)
        R.check(page.locator('.hcal .cal__dots i').count() >= 3, f'{t} historique : séances du mois précédent')
        day = page.locator('.hcal [data-action="hcal-day"]').first
        R.check(day.count() == 1 and day.get_attribute('aria-label'), f'{t} historique : jour annoncé « {day.get_attribute("aria-label") if day.count() else ""} »')
        n = len((day.get_attribute('aria-label') or '').split(',')) - 1
        day.click(); page.wait_for_timeout(250)
        R.check(page.locator('.hcal-day .hcell').count() == n and day.get_attribute('aria-pressed') == 'true', f'{t} historique : jour touché, {n} séance(s) dessous')
        R.check(page.locator('.hcal-day .hcell__map').count() >= 1 or page.evaluate("document.documentElement.classList.contains('type-xl')"), f'{t} historique : cartes illustrées (personnage)')
        shot(page, LOT, f'historique_calendrier_{dev}_{theme}')
        page.locator('.hcal [aria-pressed="true"]').click(); page.wait_for_timeout(200)
        R.check(page.locator('.hcal-day').count() == 0, f'{t} historique : même jour retouché, séances cachées')
        R.check(tog.get_attribute('aria-expanded') == 'true', f'{t} historique : bouton dit « développé »')
        go(page, 'history')
        R.check(page.locator('.hcal .cal__grid').count() == 1, f'{t} historique : ouvert gardé')
        page.click('.navbar [data-action="hcal-toggle"]'); page.wait_for_timeout(150)
        R.check(page.locator('.hcal').count() == 0 and page.locator('.navbar [data-action="hcal-toggle"]').get_attribute('aria-expanded') == 'false', f'{t} historique : calendrier fermé')
        R.check(not page.errors, f'{t} progrès : erreurs JS {page.errors[:2]}')


def t_poids(bench, eng, dev, theme):
    """Sans Santé : cumuls du mois et de l'année, pesées saisies en courbe dans Progrès, jamais sur le compte."""
    t = tag(dev, theme)
    now = int(time.time() * 1000)
    d = ppl_v2_today(now)
    d['bodyWeightKg'] = 74
    d['bodyWeightLog'] = [{'date': now - i * 3 * DAY, 'kg': 74 - i * 0.2} for i in range(12)]
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        go(page, 'stats')
        lbls = page.locator('.stat-pair__lbl').all_inner_texts()
        R.check(lbls[0].endswith('ce mois-ci') and lbls[1].endswith('cette année'), f'{t} progrès : mois et année {lbls}')
        R.check('affil' not in page.inner_text('.view.stats'), f'{t} progrès : plus de semaines d\'affilée')
        cell = page.locator('.group-title:has-text("Poids corporel") + .group [data-action="set-body-weight"]')
        R.check(cell.count() == 1 and cell.locator('svg.spark polyline, svg.spark path').count() >= 1, f'{t} poids : courbe des pesées saisies')
        R.check('74' in cell.inner_text() and '30 jours' in cell.inner_text(), f'{t} poids : dernière pesée et tendance {cell.inner_text()!r}')
        R.check(page.evaluate("!('bodyWeightLog' in profilePayload(data)) && SYNC_LOCAL_ONLY.includes('bodyWeightLog')"), f'{t} poids : jamais envoyé sur le compte')
        cell.scroll_into_view_if_needed()
        shot(page, LOT, f'poids_{dev}_{theme}')
        cell.click()
        page.wait_for_selector('.ios-dialog__input')
        page.wait_for_timeout(300)   # fin de l'apparition du dialogue (machine chargée : le toucher arrivait trop tôt)
        page.fill('.ios-dialog__input', '73,4')
        page.locator('.ios-dialog button', has_text='OK').click()
        try:
            page.wait_for_function("data.bodyWeightLog?.[0]?.kg === 73.4 && document.querySelector('.view.stats')?.innerText.includes('73,4')", timeout=3000)
        except Exception:
            pass
        log = page.evaluate('data.bodyWeightLog')
        R.check(log[0]['kg'] == 73.4 and len(log) == 12, f'{t} poids : la pesée du jour remplace la précédente ({len(log)})')
        R.check('73,4' in page.inner_text('.view.stats'), f'{t} poids : courbe mise à jour')
        go(page, 'stats-overview')
        tiles = page.locator('.tile__lbl').all_inner_texts()
        R.check(tiles[:2] == ['Durée moyenne', 'Volume total'] and tiles[-1].endswith('au total') and tiles[-1][0].isupper(),
                f'{t} vue d\'ensemble : Durée, Volume, Séances, avec majuscule comme partout {tiles}')
        shot(page, LOT, f'overview_{dev}_{theme}')
        R.check(not page.errors, f'{t} poids : erreurs JS {page.errors[:2]}')


def t_programme(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        go(page, 'programmes')
        R.check(page.locator('[data-action="open-prog-session"]').count() == 3, f'{t} programme : 3 séances')
        # Programme intégré : séances fixes ; on compose les siennes en créant un programme (lot 8)
        R.check(page.locator('.cell--action', has_text='Ajouter une séance').count() == 0
                and page.locator('[data-action="new-programme"]').count() >= 1, f'{t} programme intégré : « Créer un programme » proposé')
        R.check(page.locator('[data-action="go-settings"]').count() == 1 and page.locator('[data-action="go-settings"] .icon--gear').count() == 1, f'{t} programme : la roue des Réglages, comme sur l\'accueil')
        # Séances en cartes illustrées, comme l'accueil : vignette du groupe principal (décorative), nom, muscles, infos ;
        # VoiceOver lit l'intitulé complet ; le texte ne passe jamais sous la vignette
        cards = page.evaluate("""() => [...document.querySelectorAll('.ps-list .pcard')].map(c => {
            const img = c.querySelector('.pcard__img'), txt = c.querySelector('.mgc__text');
            return { cat: c.dataset.cat, src: img ? img.getAttribute('src') : '', hidden: img ? img.getAttribute('aria-hidden') === 'true' && img.alt === '' : false,
                     name: c.querySelector('.pcard__name').textContent.trim(), muscles: (c.querySelector('.pcard__muscles') || {}).textContent || '',
                     label: c.getAttribute('aria-label') || '',
                     apart: img ? txt.getBoundingClientRect().right <= img.getBoundingClientRect().left + 1 : false }; })""")
        R.check([c['src'] for c in cards][:2] == ['img/muscles/pectoraux.webp', 'img/muscles/dos.webp'],
                f'{t} cartes : vignette du groupe principal {[c["src"] for c in cards]}')
        R.check(all(c['hidden'] for c in cards) and all(c['apart'] for c in cards), f'{t} cartes : vignette décorative, à côté du texte {cards}')
        R.check([c['src'] for c in cards][2:] == ['img/muscles/quads.webp'], f'{t} carte Legs : vignette des quadriceps, cités en premier')
        R.check(cards and cards[0]['name'] == 'Pousser (Push)' and cards[0]['muscles'] == 'Pectoraux · Épaules · Triceps', f'{t} carte Push : nom et muscles {cards[:1]}')
        R.check(all(c['label'].startswith(c['name'] + ', ') and 'exercices' in c['label'] and 'séries' in c['label'] and '≈' not in c['label'] for c in cards),
                f'{t} cartes : intitulé VoiceOver complet {[c["label"] for c in cards]}')
        R.check(page.locator('.plist [data-action="go-my-programmes"] .plist__icon').count() == 1
                and page.locator('.plist [data-action="go-library"] .plist__icon').count() == 1
                and page.locator('.plist [data-action="go-diet-plans"] .plist__icon').count() == 1, f'{t} entrées secondaires : liste iOS avec icône')
        shot(page, LOT, f'programme_{dev}_{theme}')
        page.click('[data-action="open-prog-session"][data-cat="push"]')
        widths = page.evaluate("[...document.querySelectorAll('.ed-row')].map(r => r.querySelector('.ed-name').getBoundingClientRect().width / r.getBoundingClientRect().width)")
        R.check(min(widths) >= 0.6, f'{t} éditeur : noms >= 60 % de la largeur ({min(widths):.2f})')
        thumbs = page.evaluate("[...document.querySelectorAll('.ed-row')].map(r => (r.querySelector('.prow-thumb img') || {}).getAttribute?.('src') || '')")
        R.check(len(thumbs) == 6 and all(x.startswith('img/muscles/') for x in thumbs) and thumbs[0] == 'img/muscles/chest.webp',
                f'{t} éditeur : vignette du muscle principal à gauche de chaque exercice {thumbs[:2]}')
        R.check(page.evaluate("[...document.querySelectorAll('.ed-row')].every(r => { const i = r.querySelector('.prow-thumb'), n = r.querySelector('.ed-name'); return i.getBoundingClientRect().right <= n.getBoundingClientRect().left; })"),
                f'{t} éditeur : vignette à gauche du nom')
        shot(page, LOT, f'editor_{dev}_{theme}')
        page.click('[data-action="toggle-edit-mode"]')
        widths = page.evaluate("[...document.querySelectorAll('.ed-row')].map(r => r.querySelector('.ed-name').getBoundingClientRect().width / r.getBoundingClientRect().width)")
        R.check(min(widths) >= 0.6, f'{t} éditeur (Modifier) : noms >= 60 % ({min(widths):.2f})')
        R.check(page.locator('.ed-row .prow-thumb').count() == 0, f'{t} éditeur (Modifier) : ⊖ et ≡ à la place des vignettes')
        shot(page, LOT, f'editor_edit_{dev}_{theme}')
        before = page.evaluate("data.programmes.ppl.exercises.push.map(e => e.id)")
        hb = page.locator('.ed-handle').first.bounding_box()
        rh = page.locator('.ed-row').first.bounding_box()['height']
        x, y = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
        page.mouse.move(x, y); page.mouse.down()
        for k in range(1, 11):
            page.mouse.move(x, y + rh * 2 * k / 10)
        page.mouse.up()
        page.wait_for_timeout(200)
        after = page.evaluate("data.programmes.ppl.exercises.push.map(e => e.id)")
        exp = before[1:3] + before[:1] + before[3:]
        R.check(after == exp, f'{t} éditeur : glisser 1 → 3 ({after[:3]})')
        R.check(json.loads(ls(page, 'ppl_v2'))['programmes']['ppl']['exercises']['push'][2]['id'] == before[0], f'{t} éditeur : ordre enregistré')
        # Supprimer un exercice : il reste dans Progrès › Autres
        page.locator('.ed-row[data-i="5"] .ed-minus').click()
        page.locator('.ed-row[data-i="5"] .ed-del').click()
        page.wait_for_timeout(250)
        tap_dialog(page, 'Supprimer l\'exercice')
        R.check(page.evaluate("!data.programmes.ppl.exercises.push.some(e => e.id === 'p6extric')"), f'{t} éditeur : exercice supprimé')
        go(page, 'stats')
        autres = page.evaluate("""() => { const t = [...document.querySelectorAll('.group-title')].find(e => e.textContent === 'Autres');
            return t ? t.nextElementSibling.innerText : ''; }""")
        R.check('Extension triceps poulie' in autres, f'{t} progrès : exercice supprimé visible dans Autres')
        # Exercice : écran de réglage
        go(page, 'programmes')
        page.click('[data-action="open-prog-session"][data-cat="pull"]')
        page.click('.ed-row[data-i="0"]')
        page.wait_for_selector('.view.ex-edit')
        page.click('[data-action="ex-sets"][data-d="1"]')
        page.click('[data-action="ex-rest"][data-s="120"]')
        page.fill('#exTarget', '32,5')
        R.check(page.evaluate("getComputedStyle(document.querySelector('#exName')).fontSize") == '17px', f'{t} exercice : champ >= 16 px')
        shot(page, LOT, f'ex_edit_{dev}_{theme}')
        page.click('[data-action="save-ex"]')
        ex = page.evaluate("data.programmes.ppl.exercises.pull[0]")
        R.check(ex['sets'] == 5 and ex['rest'] == 120 and ex['target'] == 32.5 and ex['repMax'] == 12, f'{t} exercice : enregistré ({ex["sets"]}, {ex["rest"]}, {ex["target"]})')
        # Changer de programme (Mes programmes) : confirmation, retour sur Programme
        go(page, 'programmes')
        # Upper / Lower gardé dans Mes programmes (ajout depuis le catalogue : test_mes_programmes.py)
        page.evaluate("addMyProgramme('upper_lower'); save()")
        page.click('[data-action="go-my-programmes"]')
        R.check(page.locator('.cell--pick[aria-pressed="true"] .icon').count() == 1, f'{t} sélecteur : coche sur le programme actif')
        mp = page.evaluate("""() => [...document.querySelectorAll('.mp-list .cell--pick')].map(r => { const n = r.querySelector('.mp-names');
            return { id: r.dataset.id, body: !!r.querySelector('.psq--body .body-map[aria-hidden="true"]'), img: (r.querySelector('.psq--img img') || {}).getAttribute?.('src') || '', cut: n.scrollWidth > n.clientWidth + 1 || getComputedStyle(n).textOverflow === 'ellipsis',
                     lines: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)) }; })""")
        # Un programme couvre plusieurs groupes : personnage entier avec ses muscles, jamais la vignette d'un seul groupe
        multi = [x for x in mp if x['id'] in ('ppl', 'upper_lower')]
        R.check(len(multi) == 2 and all(x['body'] and not x['img'] for x in multi), f'{t} Mes programmes : PPL et Upper / Lower en personnage entier {mp}')
        R.check(all(not x['cut'] and x['lines'] <= 2 for x in mp), f'{t} Mes programmes : séances en entier, 2 lignes au plus {mp}')
        shot(page, LOT, f'picker_{dev}_{theme}')
        page.click('[data-action="select-prog"][data-id="upper_lower"]')
        page.wait_for_timeout(250)
        R.check(page.locator('.ios-dialog').count() == 1 and 'Passer à Upper / Lower' in page.locator('.ios-dialog').inner_text(), f'{t} programme : confirmation')
        tap_dialog(page, 'Changer de programme')
        R.check(page.evaluate('data.activeProgramme') == 'upper_lower' and page.evaluate('view') == 'programmes', f'{t} programme : changé, reste sur Programme')
        go(page, 'stats')
        page.click('[data-action="open-stats-ex"][data-ex="p1dcouch"]')
        n_sess = page.evaluate("data.history.filter(h => h.exercises.some(e => e.exId === 'p1dcouch')).length")
        R.check(page.locator('.view.stats-ex [data-action="open-history"]').count() == n_sess and n_sess >= 9,
                f'{t} programme changé : Développé couché garde ses {n_sess} séances')
        # Réglages
        go(page, 'settings')
        hs = page.evaluate("[...document.querySelectorAll('.view.settings-view .cell')].map(e => e.getBoundingClientRect().height)")
        R.check(min(hs) >= 44, f'{t} réglages : cellules >= 44 ({min(hs):.0f})')
        # Ordre des Réglages iOS (Social et coach seulement avec le module du compte ; Services Apple et Icône : app iOS ;
        # Informations légales en dernier, nuit-legal)
        titles = page.evaluate("[...document.querySelectorAll('.view.settings-view .group-title')].map(e => e.textContent.trim())")
        want = ['Entraînement', 'Sons et vibrations', 'Apparence'] + (['Social et coach'] if page.evaluate('accountAvailable()') else []) + ['Données', 'Aide', 'Informations légales']
        R.check(titles == want, f'{t} réglages : ordre des groupes {titles}')
        # Une icône par ligne, comme les Réglages d'iOS : carré décoratif (VoiceOver le saute), sauf la carte du
        # compte (avatar) et la ligne destructive ; le même symbole ne sert jamais à deux lignes de sens différent
        ico = page.evaluate("""() => [...document.querySelectorAll('.view.settings-view .cell')]
            .filter(c => !c.matches('.account-cell, .cell--destructive'))
            .map(c => { const i = c.querySelector(':scope > .set-ico');
                        return { t: (c.querySelector('.cell__title') || c).textContent.trim().slice(0, 30), ok: !!i && i.getAttribute('aria-hidden') === 'true',
                                 sym: i?.querySelector('use')?.getAttribute('href') || 'img' }; })""")
        R.check(ico and all(r['ok'] for r in ico), f'{t} réglages : une icône décorative par ligne {[r["t"] for r in ico if not r["ok"]]}')
        legal = {'#i-doc.text'}   # Conditions d'utilisation, de vente, mentions légales : un seul sens, « page juridique »
        syms = [r['sym'] for r in ico if r['sym'] not in legal]
        R.check(len(syms) == len(set(syms)), f'{t} réglages : un symbole = une ligne {sorted(s for s in syms if syms.count(s) > 1)}')
        # Texte agrandi : les icônes restent, le titre passe à la ligne à côté de son carré (jamais dessous)
        xl = page.evaluate("""() => { const h = document.documentElement; h.classList.add('type-xl');
            const out = [...document.querySelectorAll('.view.settings-view .cell')].filter(c => c.querySelector(':scope > .set-ico'))
              .map(c => { const i = c.querySelector(':scope > .set-ico').getBoundingClientRect(), b = c.querySelector(':scope > .cell__body').getBoundingClientRect();
                          return { t: c.textContent.trim().slice(0, 30), shown: i.width > 0, beside: b.left >= i.right && b.top < i.bottom }; });
            h.classList.remove('type-xl'); return out; }""")
        R.check(xl and all(r['shown'] and r['beside'] for r in xl), f'{t} réglages texte agrandi : icônes gardées, titre à côté {[r["t"] for r in xl if not (r["shown"] and r["beside"])]}')
        # Texte agrandi, chevron : toujours au bord droit, jamais seul à gauche sous le carré (panel reglages-v2) ; avec une
        # valeur, sur la même rangée qu'elle ; sans valeur, à hauteur du titre. Tailles AX1 et AX3 de la police.
        for fs in (23, 33):
            chev = page.evaluate("""fs => { const h = document.documentElement, old = h.style.fontSize; h.classList.add('type-xl'); h.style.fontSize = fs + 'px';
                const out = [...document.querySelectorAll('.view.settings-view .cell--nav')].filter(c => c.querySelector(':scope > .set-ico'))
                  .map(c => { const cr = c.getBoundingClientRect(), i = c.querySelector(':scope > .set-ico').getBoundingClientRect(),
                                  ch = c.querySelector(':scope > .icon:last-child').getBoundingClientRect(), b = c.querySelector(':scope > .cell__body').getBoundingClientRect(),
                                  v = c.querySelector(':scope > .cell__value:not(:empty)'), vr = v && v.getBoundingClientRect(), mid = ch.top + ch.height / 2;
                              return { t: c.textContent.trim().slice(0, 24), right: cr.right - ch.right <= 16, notUnder: ch.left > i.right + 20,
                                       row: vr ? mid > vr.top && mid < vr.bottom : mid > b.top && mid < b.bottom }; });
                h.classList.remove('type-xl'); h.style.fontSize = old; return out; }""", fs)
            bad = [r['t'] for r in chev if not (r['right'] and r['notUnder'] and r['row'])]
            R.check(chev and not bad, f'{t} réglages texte agrandi {fs} px : chevron à droite, sur la rangée de sa valeur ou de son titre {bad}')
        # Sauvegarde jamais faite : rouge d'alerte système, pas l'orange ambré voisin de l'orange des actions
        warn = page.evaluate("""() => { const v = document.querySelector('[data-action="go-backup"] .cell__value'), p = document.createElement('span');
            p.style.color = 'var(--red-text)'; document.body.append(p); const want = getComputedStyle(p).color; p.remove();
            return [getComputedStyle(v).color, want]; }""")
        R.check(warn[0] == warn[1], f'{t} réglages : « Jamais » en rouge d\'alerte {warn}')
        R.check(page.locator('.view.settings-view [data-action="export"], .view.settings-view #lastExportTxt').count() == 0, f'{t} réglages : export déplacé dans Sauvegarde')
        bk = page.locator('[data-action="go-backup"] .cell__value.txt-warn')
        R.check(bk.count() == 1 and bk.inner_text().strip() == 'Jamais', f'{t} réglages : Sauvegarde « Jamais » en orange sans compte')
        shot(page, LOT, f'settings_{dev}_{theme}')
        go(page, 'backup')
        R.check(page.locator('.view.backup-view').count() == 1 and page.locator('#lastExportTxt.txt-warn').count() == 1, f'{t} sauvegarde : jamais sauvegardé en orange')
        R.check(page.locator('[data-action="export"]').count() == 1 and page.locator('[data-action="import"]').count() == 1, f'{t} sauvegarde : export et import présents')
        hs = page.evaluate("[...document.querySelectorAll('.view.backup-view .cell')].map(e => e.getBoundingClientRect().height)")
        R.check(min(hs) >= 44, f'{t} sauvegarde : cellules >= 44 ({min(hs):.0f})')
        shot(page, LOT, f'backup_{dev}_{theme}')
        # Séance Perso (dans un programme modifiable)
        page.evaluate("activateProgramme('custom')")
        go(page, 'programmes')
        page.click('[data-action="add-custom-session"]')
        R.check(page.locator('.emoji-btn').count() == 0 and page.locator('.color-swatch').count() == 0 and page.locator('#csName').count() == 1, f'{t} séance perso : nom et description, ni icône ni couleur (direction sobre)')
        shot(page, LOT, f'cs_edit_{dev}_{theme}')
        R.check(not page.errors, f'{t} programme : erreurs JS {page.errors[:2]}')


def t_perf(bench):
    """1 200 séances : premier affichage de l'Historique en moins de 100 ms (WebKit)."""
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        d = ppl_v2_today(weeks=400)
        seed(page, 'dark', json.dumps(d, ensure_ascii=False, separators=(',', ':')))
        n = page.evaluate('data.history.length')
        best = 1e9
        for _ in range(3):
            ms = page.evaluate("""() => { routeTo('dashboard');
                const t0 = performance.now(); routeTo('history'); document.body.offsetHeight; return performance.now() - t0; }""")
            best = min(best, ms)
        R.check(n >= 1200 and best < 100, f'perf : historique de {n} séances rendu en {best:.0f} ms')
        print(f'  perf historique {n} séances : {best:.1f} ms')


def t_programme_type_xl(bench):
    """Très grands caractères sur iPhone SE : cartes des séances et exercices sans vignette, texte entier, sans débord."""
    with bench.page('webkit', 'iPhone SE', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json())
        page.add_style_tag(content='html { font-size: 28px !important; }')
        page.evaluate("window.dispatchEvent(new Event('resize'))")
        page.wait_for_timeout(300)
        page.evaluate("switchTab('program')")
        page.wait_for_selector('.ps-list .pcard')
        check = """sel => ({ xl: document.documentElement.classList.contains('type-xl'),
            imgs: [...document.querySelectorAll(sel)].filter(i => i.getBoundingClientRect().width > 0).length,
            cut: [...document.querySelectorAll('.view:not([hidden]) .cell__title, .view:not([hidden]) .cell__sub, .pcard__muscles')]
                .filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim()),
            hscroll: document.documentElement.scrollWidth > innerWidth + 1 })"""
        g = page.evaluate(check, '.pcard__img')
        R.check(g['xl'] and g['imgs'] == 0 and not g['cut'] and not g['hscroll'], f'type-xl programme : cartes sans vignette, rien de coupé {g}')
        page.click('[data-action="open-prog-session"][data-cat="push"]')
        page.wait_for_selector('.view.editor')
        g = page.evaluate(check, '.prow-thumb')
        R.check(g['imgs'] == 0 and not g['cut'] and not g['hscroll'], f'type-xl éditeur : sans vignette, rien de coupé {g}')
        shot(page, LOT, 'editor_type_xl')
        clamped = page.evaluate("[...document.querySelectorAll('.ed-name')].filter(e => e.scrollHeight > e.clientHeight + 1).map(e => e.textContent)")
        R.check(not clamped, f'type-xl éditeur : noms d\'exercice en entier, sans « … » {clamped}')
        # Fiche d'un exercice : aucun mot coupé dans les choix (« Fourchett / e »), tempo personnalisé lisible en entier
        page.click('.ed-row[data-i="0"]')
        page.wait_for_selector('.view.ex-edit')
        broken = page.evaluate("""() => [...document.querySelectorAll('.ex-edit .segmented__btn')].flatMap(b => {
            const out = [], walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
            for (let n; (n = walk.nextNode());) for (const m of n.textContent.matchAll(/\\S+/g)) {
                const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
                if (r.getClientRects().length > 1) out.push(m[0]); }
            return out; })""")
        R.check(not broken, f'type-xl fiche : aucun mot coupé dans les choix {broken}')
        tempo = page.evaluate("""() => { const i = document.querySelector('#exTempoIn'); if (!i) return null;
            const cs = getComputedStyle(i), c = document.createElement('canvas').getContext('2d');
            c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            const need = c.measureText(i.placeholder).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
            return { w: i.clientWidth, need, right: i.getBoundingClientRect().right, vw: innerWidth }; }""")
        R.check(tempo and tempo['w'] + 1 >= tempo['need'] and tempo['right'] <= tempo['vw'], f'type-xl fiche : « Ex. 3-1-1 » entier dans le tempo personnalisé {tempo}')
        shot(page, LOT, 'ex_edit_type_xl')
        page.evaluate("routeTo('my-programmes')")
        page.wait_for_selector('.view.my-programmes')
        names = page.evaluate("[...document.querySelectorAll('.mp-names')].filter(e => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === 'ellipsis').map(e => e.textContent)")
        R.check(not names, f'type-xl Mes programmes : séances en entier {names}')
        R.check(not page.errors, f'type-xl programme : erreurs JS {page.errors[:2]}')


TESTS = [t_history, t_history_corps, t_history_filtres, t_progress, t_poids, t_programme]

if __name__ == '__main__':
    run_main(R, TESTS, once=[t_perf, t_programme_type_xl])
