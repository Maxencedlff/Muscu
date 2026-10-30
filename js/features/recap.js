// ═══════════════════════════════════════════════════════════
//  Récaps : carte de l'accueil, Progrès › Récaps, écrans qui s'enchaînent, partage
// ═══════════════════════════════════════════════════════════
'use strict';

// Les chiffres viennent de js/data/recap.js (recapStats, recapPages) ; l'image partagée de
// js/features/recap-canvas.js. Un récap = des écrans qui s'enchaînent au doigt (défilement horizontal
// à crans, CSS scroll-snap) ou aux flèches, un chiffre fort par écran, et « Partager » sur chacun.

const RECAP_SEEN_KEY = 'ppl_recap_seen';   // clé de la dernière semaine ouverte depuis la carte de l'accueil
let recapIndex = 0;                         // écran affiché du récap ouvert (gardé entre deux render())
let recapsShowAll = false;                  // Progrès › Récaps : toutes les semaines (sinon les premières)
const RECAPS_FIRST_WEEKS = 8;

function recapSeenKey() { try { return localStorage.getItem(RECAP_SEEN_KEY); } catch { return null; } }
function setRecapSeen(key) { try { localStorage.setItem(RECAP_SEEN_KEY, key); } catch { /* la carte reviendra */ } }

// « 4 séances · 3 h 10 · 12,4 t » (ce qui existe seulement)
function recapTotalsLine(t) {
  return [plural(t.sessions, 'séance', 'séances'), t.duration >= 60_000 ? fmtDuration(t.duration) : '', t.volume > 0 ? fmtVolume(t.volume) : ''].filter(Boolean).join(' · ');
}

// ── Accueil : carte « Ta semaine » (dimanche soir et lundi, jusqu'à ce qu'elle soit ouverte) ──
function recapHomeCard() {
  const info = recapCardInfo({ seenKey: recapSeenKey(), off: data.recapCardOff === true });
  if (!info) return '';
  const { period: p, totals: t } = info;
  const line = recapTotalsLine(t);
  return `
    <section class="home-card recap-card" style="--cat-color:${RECAP_KINDS.week.color}" aria-label="Ta semaine">
      <button class="recap-card__open" data-action="open-recap" data-key="${esc(p.key)}" data-from="card" aria-label="${esc(`Ta semaine, ${p.label} : ${line}. Voir le récap`)}">
        <span class="home-card__title" aria-hidden="true">Ta semaine<span class="home-card__aside">${esc(p.short)}</span></span>
        <span class="recap-card__line num" aria-hidden="true">${esc(line)}</span>
        <span class="recap-card__cta" aria-hidden="true">Voir le récap ${icon('chevron.right', 12)}</span>
      </button>
      <button class="recap-card__close" data-action="recap-card-hide" data-key="${esc(p.key)}" aria-label="Masquer la carte">${icon('xmark', 16)}</button>
    </section>`;
}

// ── Progrès › Récaps : semaines, mois, bilans de l'année ──
function recapCell(x) {
  const { period: p, totals: t } = x;
  const title = p.kind === 'year' ? `Bilan ${p.label}` : p.label;   // « 12 – 18 octobre », « Septembre 2026 », « Bilan 2026 »
  return `
      <button class="cell cell--nav" data-action="open-recap" data-key="${esc(p.key)}">
        <span class="cell__body"><span class="cell__title">${esc(title)}</span><span class="cell__sub num">${esc(recapTotalsLine(t))}</span></span>
        ${icon('chevron.right', 16)}
      </button>`;
}

function renderRecaps() {
  const { weeks, months, years } = recapList();
  const empty = !weeks.length && !months.length && !years.length;
  const shownWeeks = recapsShowAll ? weeks : weeks.slice(0, RECAPS_FIRST_WEEKS);
  const more = weeks.length - shownWeeks.length;
  return `
    <div class="view recaps view--grouped">
      ${navBar({ title: 'Récaps' })}
      <div class="scr">
        ${empty ? `<div class="empty-note">Termine des séances : le récap de ta semaine apparaîtra ici le dimanche soir, celui du mois le 1er, et le bilan de l'année en décembre.</div>` : ''}
        ${years.length ? `<div class="group-title">Bilan de l'année</div><div class="group">${years.map(recapCell).join('')}</div>` : ''}
        ${months.length ? `<div class="group-title">Mois</div><div class="group">${months.map(recapCell).join('')}</div>` : ''}
        ${weeks.length ? `<div class="group-title">Semaines</div><div class="group">${shownWeeks.map(recapCell).join('')}
          ${more > 0 ? `<button class="cell cell--action" data-action="recaps-more">${plural(more, 'semaine de plus', 'semaines de plus')}</button>` : ''}</div>` : ''}
      </div>
    </div>`;
}

// ── Un récap : écrans qui s'enchaînent ──
function recapPageHtml(page, i, st) {
  const value = `<div class="recap-page__value ${page.text ? 'recap-page__value--text' : 'num'}">${esc(page.value)}</div>`;
  let body = '';
  if (page.list) {
    body = `<ul class="recap-list">${page.list.map(x => `<li class="recap-list__row">${medalSvg(20)}<span class="recap-list__name">${esc(x.name)}</span><span class="recap-list__val num">${esc(x.value)}</span></li>`).join('')}</ul>`;
  }
  if (page.tiles) {
    body = `<div class="recap-tiles">${page.tiles.map(([l, v]) => `<div class="recap-tile"><span class="recap-tile__lbl">${esc(l)}</span><span class="recap-tile__val num">${esc(v)}</span></div>`).join('')}</div>`
      + (page.lines.length ? `<ul class="recap-list">${page.lines.map(([l, v]) => `<li class="recap-list__row"><span class="recap-list__name">${esc(l)}</span><span class="recap-list__val">${esc(v)}</span></li>`).join('')}</ul>` : '');
  }
  return `
      <section class="recap-page${i === recapIndex ? ' is-active' : ''}" data-index="${i}" role="group" aria-roledescription="écran" aria-label="${esc(recapPageAlt(page, st))}">
        <div class="recap-page__kicker" aria-hidden="true">${esc(page.kicker)}</div>
        ${page.sub ? `<div class="recap-page__sub" aria-hidden="true">${esc(page.sub)}</div>` : ''}
        <div class="recap-page__hero" aria-hidden="true">
          ${value}
          ${page.caption ? `<div class="recap-page__caption">${esc(page.caption)}</div>` : ''}
          ${page.note ? `<div class="recap-page__note">${esc(page.note)}</div>` : ''}
        </div>
        ${body ? `<div class="recap-page__body" aria-hidden="true">${body}</div>` : ''}
      </section>`;
}

function renderRecap(key) {
  const p = recapPeriodFromKey(key);
  const st = p && recapStats(p);
  if (!st) {
    return `
    <div class="view recap view--grouped">
      ${navBar({ title: 'Récap' })}
      <div class="scr"><div class="empty-note">Aucune séance sur cette période.</div></div>
    </div>`;
  }
  const pages = recapPages(st);
  if (recapIndex >= pages.length) recapIndex = 0;
  const dots = pages.map((pg, i) => `<i class="${i === recapIndex ? 'is-on' : ''}" aria-hidden="true"></i>`).join('');
  return `
    <div class="view recap" style="--cat-color:${RECAP_KINDS[p.kind].color}" data-key="${esc(p.key)}">
      ${navBar({ title: p.kind === 'year' ? `Bilan ${p.label}` : p.title, large: false })}
      <div class="recap__track" id="recapTrack" role="region" aria-label="${esc(`${p.title}, ${p.label} : ${pages.length} écrans`)}">
        ${pages.map((pg, i) => recapPageHtml(pg, i, st)).join('')}
      </div>
      <div class="recap__foot">
        <div class="recap__nav">
          <button class="recap__arrow" data-action="recap-prev" aria-label="Écran précédent" ${recapIndex === 0 ? 'disabled' : ''}>${icon('chevron.left', 22)}</button>
          <div class="recap__dots" id="recapDots" role="status" aria-label="${esc(`Écran ${recapIndex + 1} sur ${pages.length}`)}">${dots}</div>
          <button class="recap__arrow" data-action="recap-next" aria-label="Écran suivant" ${recapIndex >= pages.length - 1 ? 'disabled' : ''}>${icon('chevron.right', 22)}</button>
        </div>
        <button class="btn btn--secondary btn--full share-btn recap__share" data-action="recap-share" data-key="${esc(p.key)}">${icon('square.and.arrow.up', 22)}<span>Partager</span></button>
      </div>
    </div>`;
}

// Après le dessin : l'écran gardé est remis en place et le défilement met à jour les points
function recapMount() {
  const track = $('#recapTrack');
  if (!track) return;
  if (recapIndex) track.scrollTo({ left: recapIndex * track.clientWidth, behavior: 'instant' });
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; recapSetIndex(Math.round(track.scrollLeft / Math.max(1, track.clientWidth))); });
  }, { passive: true });
}

// Écran courant : points, flèches et animation d'arrivée (classe is-active) suivent, sans redessiner
function recapSetIndex(i) {
  const pages = document.querySelectorAll('.recap-page');
  if (!pages.length) return;
  i = Math.max(0, Math.min(pages.length - 1, i));
  if (i === recapIndex && pages[i].classList.contains('is-active')) return;
  recapIndex = i;
  pages.forEach((pg, k) => pg.classList.toggle('is-active', k === i));
  const dots = $('#recapDots');
  if (dots) {
    [...dots.children].forEach((d, k) => d.classList.toggle('is-on', k === i));
    dots.setAttribute('aria-label', `Écran ${i + 1} sur ${pages.length}`);
  }
  const prev = $('[data-action="recap-prev"]'), next = $('[data-action="recap-next"]');
  if (prev) prev.disabled = i === 0;
  if (next) next.disabled = i >= pages.length - 1;
}

function recapGo(delta) {
  const track = $('#recapTrack');
  if (!track) return;
  const n = track.children.length, i = Math.max(0, Math.min(n - 1, recapIndex + delta));
  track.scrollTo({ left: i * track.clientWidth, behavior: reduceMotion.matches ? 'instant' : 'smooth' });
  recapSetIndex(i);
}

// Flèches du clavier (Mac, iPad avec clavier)
document.addEventListener('keydown', e => {
  if (currentView() !== 'recap' || document.querySelector('.sheet-root, .ios-dialog')) return;
  if (e.key === 'ArrowRight') recapGo(1);
  else if (e.key === 'ArrowLeft') recapGo(-1);
});

// ── Partage : l'écran affiché en image story, même aperçu et même feuille que la séance (share.js) ──
async function openRecapShare(key, index = recapIndex) {
  const p = recapPeriodFromKey(key);
  const st = p && recapStats(p);
  const page = st && recapPages(st)[index];
  if (!page) return;
  await openStoryPreview({ stats: { title: `${p.title} · ${p.label}` }, name: recapFileName(p, page), alt: recapPageAlt(page, st) },
    canvas => renderRecapStory(page, st, canvas));
}

function openRecap(key, from = null) {
  if (!recapPeriodFromKey(key)) return;
  recapIndex = 0;
  if (from === 'card') setRecapSeen(key);
  navigate(makeRoute('recap', key));
}

registerActions({
  'open-recap':      (e, el) => { openRecap(el.dataset.key, el.dataset.from); },
  'recap-card-hide': (e, el) => { setRecapSeen(el.dataset.key); render(); showToast('Le récap reste dans Progrès › Récaps'); },
  'go-recaps':       () => { recapsShowAll = false; navigate('recaps'); },
  'recaps-more':     () => { recapsShowAll = true; render(); },
  'recap-prev':      () => { recapGo(-1); },
  'recap-next':      () => { recapGo(1); },
  'recap-share':     (e, el) => { openRecapShare(el.dataset.key); },
  'setting-recap-card': () => {
    if (data.recapCardOff === true) delete data.recapCardOff; else data.recapCardOff = true;
    save(); render();
  },
});
