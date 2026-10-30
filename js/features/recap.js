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

// Récap ouvert : chiffres et écrans calculés une fois par période (et par état de l'historique)
let recapCache = null;
function recapLoad(key) {
  const h = data.history;
  if (recapCache && recapCache.key === key && recapCache.h === h && recapCache.n === (h || []).length) return recapCache;
  const p = recapPeriodFromKey(key), st = p && recapStats(p);
  recapCache = { key, h, n: (h || []).length, p, st, pages: st ? recapPages(st) : [] };
  return recapCache;
}

function recapSeenKey() { try { return localStorage.getItem(RECAP_SEEN_KEY); } catch { return null; } }
function setRecapSeen(key) { try { localStorage.setItem(RECAP_SEEN_KEY, key); } catch { /* la carte reviendra */ } }

// « 4 séances · 3 h 10 · 12,4 t » (ce qui existe seulement)
function recapTotalsLine(t) {
  return [plural(t.sessions, 'séance', 'séances'), t.duration >= 60_000 ? fmtDuration(t.duration) : '', t.volume > 0 ? fmtVolume(t.volume) : ''].filter(Boolean).join(' · ');
}

// ── Accueil : carte « Ta semaine » (dimanche soir et lundi, jusqu'à ce qu'elle soit ouverte) ──
// Aplat citron vert (couleur de marque des récaps, texte noir) ; en sombre, carte noire bordée de citron
// pour ne pas éblouir sur le noir pur. Titre : le fait le plus positif (recapHeadline). Pastilles en
// nowrap, chiffre et unité insécables. Petit personnage avec les muscles de la semaine. Toute la carte
// est un seul bouton pour VoiceOver ; « Masquer » a sa colonne à droite, jamais sur le personnage.
function recapHomeCard() {
  const info = recapCardInfo({ seenKey: recapSeenKey(), off: data.recapCardOff === true });
  if (!info) return '';
  const { period: p } = info;
  const st = recapStats(p);
  if (!st) return '';
  const head = recapHeadline(st);
  const chips = [st.volume > 0 ? recapNb(fmtVolume(st.volume)) : '', st.duration >= 60_000 ? recapNb(fmtDuration(st.duration)) : '',
    plural(st.sets, 'série', 'séries')].filter(Boolean);
  const levels = st.profile?.levels || {};
  const body = Object.keys(levels).length ? bodyMapHtml(levels, { view: 'front', className: 'recap-card__body' }) : '';
  const aria = `Ta semaine, ${p.label} : ${head}. ${chips.join(', ').replace(/ /g, ' ')}. Voir mon récap`;
  return `
    <section class="recap-card${body ? ' recap-card--body' : ''}" aria-label="Ta semaine">
      <button class="recap-card__open" data-action="open-recap" data-key="${esc(p.key)}" data-from="card" aria-label="${esc(aria)}">
        <span class="recap-card__kicker" aria-hidden="true">Ta semaine · ${esc(p.short)}</span>
        <span class="recap-card__title" aria-hidden="true">${esc(head)}</span>
        <span class="recap-card__chips" aria-hidden="true">${chips.map(c => `<span class="recap-card__chip num">${esc(c)}</span>`).join('')}</span>
        <span class="recap-card__cta" aria-hidden="true">Voir mon récap ${icon('chevron.right', 14)}</span>
        ${body ? `<span class="recap-card__fig" aria-hidden="true">${body}</span>` : ''}
      </button>
      <button class="recap-card__close" data-action="recap-card-hide" data-key="${esc(p.key)}" aria-label="Masquer la carte">${icon('xmark', 14)}</button>
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

// ── Un récap : écrans qui s'enchaînent, façon story ──
// Une couleur pleine par écran (tone, js/data/recap.js), un chiffre géant qui monte à l'arrivée, barres de
// progression en haut, toucher à droite pour avancer et à gauche pour revenir (un seul toucher, au click,
// jamais au pointerdown), balayage horizontal à crans (scroll-snap) et flèches pour VoiceOver.

// « 16,1 t » → { num: '16,1', unit: 't' } ; texte sans nombre en tête : { num: '', unit: texte }
function recapSplitValue(v) {
  const m = String(v ?? '').match(/^([−+]?\d[\d ]*(?:,\d+)?)[\s ]?(.*)$/);
  return m ? { num: m[1], unit: m[2] } : { num: '', unit: String(v ?? '') };
}

function recapCurveSvg(curve) {
  const W = 320, H = 110, pad = 10;
  const ws = curve.map(x => x.w), lo = Math.min(...ws), hi = Math.max(...ws), span = hi - lo || 1;
  const pts = curve.map((x, i) => [pad + i * (W - 2 * pad) / (curve.length - 1), H - pad - (x.w - lo) / span * (H - 2 * pad)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts.at(-1);
  return `<div class="rp-curve"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path class="rp-curve__line" d="${d}" pathLength="1"/>
      ${pts.slice(0, -1).map(([x, y]) => `<circle class="rp-curve__dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"/>`).join('')}
      <circle class="rp-curve__last" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="7"/>
    </svg><div class="rp-curve__axis"><span>${esc(curve[0].label)}</span><span>${esc(curve.at(-1).label)}</span></div></div>`;
}

function recapBarsHtml(bars) {
  const max = Math.max(1, ...bars.values);
  return `<div class="rp-bars">${bars.values.map((n, m) => `<span class="rp-bars__col${m === bars.top ? ' is-top' : ''}">
      <i style="height:${Math.max(n ? 8 : 3, Math.round(n / max * 100))}%"></i><b>${esc(RECAP_MONTH_NAME(m).charAt(0).toLocaleUpperCase('fr-FR'))}</b></span>`).join('')}</div>`;
}

function recapPageHtml(page, i, st) {
  const v = page.value ? recapSplitValue(page.value) : null;
  const unit = page.unit || v?.unit || '';
  const parts = [];
  parts.push(`<div class="rp-kicker">${esc(page.kicker)}</div>`);
  if (page.sub) parts.push(`<div class="rp-sub">${esc(page.sub)}</div>`);
  if (page.title && page.id !== 'summary') parts.push(`<div class="rp-title${page.value ? ' rp-title--small' : ''}">${esc(page.title)}</div>`);
  if (v) {
    parts.push(`<div class="rp-value num">${page.from ? `<span class="rp-from">${esc(page.from)}</span><span class="rp-arrow">→</span>` : ''}`
      + `<span class="rp-num"${v.num ? ` data-count="${esc(v.num)}"` : ''}>${esc(v.num || v.unit)}</span>${v.num && unit ? `<span class="rp-unit">${esc(unit)}</span>` : ''}</div>`);
  }
  if (page.caption) parts.push(`<div class="rp-caption">${esc(page.caption)}</div>`);
  if (page.note) parts.push(`<div class="rp-note">${esc(page.note)}</div>`);
  if (page.chips?.length) parts.push(`<div class="rp-chips">${page.chips.map(c => `<span class="rp-chip num">${esc(c)}</span>`).join('')}</div>`);
  if (page.lines?.length && page.id === 'profile') parts.push(`<dl class="rp-lines">${page.lines.map(([l, x]) => `<div><dt>${esc(l)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl>`);
  if (page.box) parts.push(`<div class="rp-box">${esc(page.box)}</div>`);
  if (page.curve) parts.push(recapCurveSvg(page.curve));
  if (page.strip) parts.push(`<div class="rp-strip">${page.strip.map(w => `<span class="rp-strip__w${w.on ? ' is-on' : ''}"><i></i><b>${esc(w.label)}</b></span>`).join('')}</div>`);
  if (page.bars) parts.push(recapBarsHtml(page.bars));
  if (page.body && page.id === 'profile') {
    parts.push(`<div class="rp-figure">${bodyMapHtml(page.body, { view: 'both', className: 'rp-body', colors: { heat: 'var(--rc-heat)' } })}</div>`);
  }
  // Ouverture : le personnage de la semaine, à droite du chiffre
  const side = page.body && page.id === 'sessions'
    ? `<div class="rp-side">${bodyMapHtml(page.body, { view: 'front', className: 'rp-body', colors: { heat: 'var(--rc-heat)' } })}</div>` : '';
  if (page.pills?.length) parts.push(`<div class="rp-pills">${page.pills.map(([l, x]) => `<span class="rp-pill"><i></i>${esc(l)} <b class="num">${esc(x)}</b></span>`).join('')}</div>`);
  if (page.tiles?.length && page.id !== 'summary') parts.push(`<div class="rp-tiles">${page.tiles.map(([l, x]) => `<div class="rp-tile"><b class="num">${esc(x)}</b><span>${esc(l)}</span></div>`).join('')}</div>`);
  if (page.list?.length) parts.push(`<ul class="rp-list">${page.list.slice(0, 3).map(x => `<li><span>${esc(x.name)}</span><b class="num">${esc(x.value)}</b></li>`).join('')}</ul>`);
  const inner = page.id === 'summary'
    ? `<div class="rp-story"><canvas class="rp-story__img" width="1080" height="1920" aria-hidden="true"></canvas></div>`
    : `<div class="rp-inner${side ? ' rp-inner--side' : ''}">${side}${parts.join('')}</div>`;
  return `
      <section class="recap-page tone-${page.tone}${page.id === 'summary' ? ' recap-page--summary' : ''}${i === recapIndex ? ' is-active' : ''}" data-index="${i}" data-id="${page.id}" data-tone="${page.tone}"
        role="group" aria-roledescription="écran" aria-label="${esc(recapPageAlt(page, st))}">
        <div class="recap-page__body" aria-hidden="true">${inner}</div>
      </section>`;
}

function renderRecap(key) {
  const { p, st, pages } = recapLoad(key);
  if (!st) {
    return `
    <div class="view recap recap--empty view--grouped">
      ${navBar({ title: 'Récap' })}
      <div class="scr"><div class="empty-note">Aucune séance sur cette période.</div></div>
    </div>`;
  }
  if (recapIndex >= pages.length) recapIndex = 0;
  const cur = pages[recapIndex];
  const bars = pages.map((pg, i) => `<i class="${i < recapIndex ? 'is-done' : i === recapIndex ? 'is-on' : ''}"></i>`).join('');
  return `
    <div class="view recap" data-key="${esc(p.key)}" data-tone="${cur.tone}">
      <div class="recap__top">
        <div class="recap__bars" id="recapDots" role="status" aria-label="${esc(`Écran ${recapIndex + 1} sur ${pages.length}`)}">${bars}</div>
        <div class="recap__head">
          <span class="recap__brand" aria-hidden="true"><img src="icon-192.png" alt="" width="20" height="20">MDLF Training</span>
          <span class="recap__period">${esc(p.kind === 'year' ? `Bilan ${p.label}` : p.short)}</span>
          <button class="recap__close" data-action="back" aria-label="Fermer le récap">${icon('xmark', 16)}</button>
        </div>
      </div>
      <div class="recap__track" id="recapTrack" role="region" aria-label="${esc(`${p.title}, ${p.label} : ${pages.length} écrans`)}">
        ${pages.map((pg, i) => recapPageHtml(pg, i, st)).join('')}
      </div>
      <div class="recap__foot">
        <button class="recap__arrow" data-action="recap-prev" aria-label="Écran précédent" ${recapIndex === 0 ? 'disabled' : ''}>${icon('chevron.left', 20)}</button>
        <button class="recap__share" data-action="recap-share" data-key="${esc(p.key)}">${icon('square.and.arrow.up', 20)}<span id="recapShareLbl">${esc(cur.share)}</span></button>
        <button class="recap__arrow" data-action="recap-next" aria-label="Écran suivant" ${recapIndex >= pages.length - 1 ? 'disabled' : ''}>${icon('chevron.right', 20)}</button>
      </div>
    </div>`;
}

// Après le dessin : l'écran gardé est remis en place, le défilement suit les barres, un toucher sur
// l'écran avance (deux tiers droits) ou recule (tiers gauche), le résumé dessine sa story.
function recapMount() {
  const track = $('#recapTrack');
  if (!track) return;
  if (recapIndex) track.scrollTo({ left: recapIndex * track.clientWidth, behavior: 'instant' });
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; recapSetIndex(Math.round(track.scrollLeft / Math.max(1, track.clientWidth))); });
  }, { passive: true });
  track.addEventListener('click', e => {
    if (e.target.closest('button, a')) return;
    const r = track.getBoundingClientRect();
    recapGo(e.clientX - r.left < r.width / 3 ? -1 : 1);
  });
  recapStatusBar();
  recapAnimate(document.querySelector('.recap-page.is-active'));
  recapDrawSummary();
}

// Story du dernier écran : l'image partagée elle-même, dessinée une fois
async function recapDrawSummary() {
  const c = document.querySelector('.recap-page--summary canvas');
  const view = document.querySelector('.view.recap');
  if (!c || !view) return;
  const { st, pages } = recapLoad(view.dataset.key);
  const page = pages.at(-1);
  if (!page) return;
  try { await renderRecapStory(page, st, c); } catch { /* l'aperçu reste vide, le partage redessine */ }
}

// En quittant le récap : barre d'état rendue au thème de l'app
function recapLeave() { Native.statusBar(!document.body.classList.contains('light')); }

// Barre d'état d'iOS lisible sur la couleur de l'écran (texte blanc sur le violet, noir ailleurs)
function recapStatusBar() {
  const tone = document.querySelector('.view.recap')?.dataset.tone;
  if (tone) Native.statusBar(tone === 'violet');
}

// Le chiffre géant monte de 0 à sa valeur (0,6 s, format français gardé) ; rien sous prefers-reduced-motion
function recapAnimate(pageEl) {
  if (!pageEl || reduceMotion.matches) return;
  pageEl.querySelectorAll('[data-count]').forEach(el => {
    const target = el.dataset.count, dec = (target.split(',')[1] || '').length;
    const n = parseFloat(target.replace(/[ \s]/g, '').replace(',', '.').replace('−', '-'));
    if (!isFinite(n) || n === 0) return;
    const t0 = performance.now(), dur = 600;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = k >= 1 ? target : (n * e).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// Écran courant : barres, flèches, couleur du haut et du bas, libellé du bouton, sans redessiner
function recapSetIndex(i) {
  const pages = document.querySelectorAll('.recap-page');
  if (!pages.length) return;
  i = Math.max(0, Math.min(pages.length - 1, i));
  if (i === recapIndex && pages[i].classList.contains('is-active')) return;
  recapIndex = i;
  pages.forEach((pg, k) => pg.classList.toggle('is-active', k === i));
  const view = document.querySelector('.view.recap');
  if (view) view.dataset.tone = pages[i].dataset.tone;
  const bars = $('#recapDots');
  if (bars) {
    [...bars.children].forEach((d, k) => { d.classList.toggle('is-on', k === i); d.classList.toggle('is-done', k < i); });
    bars.setAttribute('aria-label', `Écran ${i + 1} sur ${pages.length}`);
  }
  const prev = $('[data-action="recap-prev"]'), next = $('[data-action="recap-next"]');
  if (prev) prev.disabled = i === 0;
  if (next) next.disabled = i >= pages.length - 1;
  const lbl = $('#recapShareLbl'), key = view?.dataset.key;
  if (lbl && key) {
    const pg = recapLoad(key).pages[i];
    if (pg) lbl.textContent = pg.share;
  }
  recapStatusBar();
  recapAnimate(pages[i]);
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
  const { p, st, pages } = recapLoad(key);
  const page = pages[index];
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
