// ═══════════════════════════════════════════════════════════
//  Mouvement utile (direction « sobre et vivante », css/theme-sobre.css)
//  L'app redessine un écran entier à chaque changement : ce module regarde ce qui vient d'être dessiné
//  et anime seulement ce qui a changé de sens (série validée, record, chiffre qui bouge, anneau qui se
//  remplit). Rien ne bloque un toucher : les gestes sont seulement notés au « click » (un seul tap iOS),
//  sans preventDefault. Réduire les animations : aucune animation, les valeurs finales tout de suite.
// ═══════════════════════════════════════════════════════════
'use strict';

const VV_REDUCED = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// Petites barres « 4 dernières semaines » (Progrès, fiche élève) : counts du plus ancien au plus récent, semaines du
// calendrier (lundi à dimanche, comme la semaine de l'accueil), la dernière est la semaine en cours. Panel vague 4 :
// les barres sans valeur ni période se lisaient comme un détail du chiffre du mois ; chaque barre porte son nombre,
// la semaine en cours a la même couleur partout (le texte, jamais le vert « fait »), et VoiceOver lit les valeurs.
// Semaine sans séance : barre grise au plancher (une absence se lit, elle ne disparaît pas).
const WKBARS_H = 28, WKBARS_MIN = 6;
function weekBarsSvg(counts, caption = 'par semaine') {
  if (!Array.isArray(counts) || counts.length < 2) return '';
  const max = Math.max(1, ...counts), n = counts.length;
  const cols = counts.map((c, i) => {
    const cls = `wkbars__b${c > 0 ? '' : ' wkbars__b--vide'}${i === n - 1 ? ' wkbars__b--now' : ''}`;
    return `<span class="wkbars__col"><span class="${cls}" style="height:${c > 0 ? Math.max(10, Math.round(c / max * WKBARS_H)) : WKBARS_MIN}px"></span>`
      + `<span class="wkbars__n num${i === n - 1 ? ' wkbars__n--now' : ''}">${c}</span></span>`;
  }).join('');
  const before = counts.slice(0, -1).join(', ');
  const spoken = `Séances par semaine, ${n} dernières semaines : ${before}, et ${counts[n - 1]} cette semaine`;
  return `<span class="wkbars" role="img" aria-label="${spoken}"><span class="wkbars__bars">${cols}</span>`
    + `${caption ? `<span class="wkbars__lbl">${caption}</span>` : ''}</span>`;
}
// Lundi 0 h de la semaine du calendrier qui contient now, reculé de back semaines (heure locale, changement d'heure compris)
function weekStartMs(now = Date.now(), back = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (d.getDay() + 6) % 7 - 7 * back);
  return d.getTime();
}
// Séances par semaine du calendrier (lundi à dimanche), les `weeks` dernières, semaine en cours comprise, à partir
// d'horodatages ; null si la période n'est pas entièrement couverte par les données (complete : false)
function weekCounts(stamps, now = Date.now(), weeks = 4, complete = true) {
  if (!complete) return null;
  const starts = Array.from({ length: weeks }, (_, k) => weekStartMs(now, k)), out = new Array(weeks).fill(0);
  stamps.forEach(t => {
    if (!(t <= now)) return;
    const k = starts.findIndex(st => t >= st);
    if (k >= 0) out[weeks - 1 - k]++;
  });
  return out;
}

// ── Chiffres qui défilent ──
// « 5,0 t », « 52 », « 1 240 » : le premier nombre du premier nœud de texte. Pas pour « 1 h 05 », ni les chronos.
const VV_NUM = /(\d[\d   ]*)(?:,(\d+))?/;
function vvParse(txt) {
  const m = VV_NUM.exec(txt);
  if (!m) return null;
  const int = m[1].replace(/[   ]/g, '');
  return { m, value: Number(int + (m[2] ? '.' + m[2] : '')), dec: m[2]?.length || 0 };
}
function vvFormat(v, dec) { return v.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
function vvTextNode(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (/\d/.test(n.nodeValue)) return n;
  return null;
}
function vvRoll(el, from, ms = 520) {
  const node = vvTextNode(el);
  if (!node || /\d\s?h\s?\d|:\d/.test(el.textContent)) return;
  const final = node.nodeValue, p = vvParse(final);
  if (!p || !Number.isFinite(p.value) || p.value === from) return;
  const pre = final.slice(0, p.m.index), post = final.slice(p.m.index + p.m[0].length);
  const t0 = performance.now();
  if (typeof vvRolling !== 'undefined') vvRolling.add(el);
  // VoiceOver lit la valeur finale : le texte qui défile est masqué le temps du décompte
  const label = el.getAttribute('aria-label');
  if (!label) el.setAttribute('aria-label', el.textContent.trim());
  const step = t => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    if (!node.isConnected) { vvRolling.delete(el); return; }
    node.nodeValue = k >= 1 ? final : pre + vvFormat(from + (p.value - from) * e, p.dec) + post;
    if (k < 1) return requestAnimationFrame(step);
    vvRolling.delete(el);
    if (!label) el.removeAttribute('aria-label');
  };
  requestAnimationFrame(step);
}

// Valeurs suivies d'un rendu à l'autre (même écran, même place) : elles défilent quand elles changent
const VV_WATCH = '.stat-pair__val, .chart-head__val, .diet-sum__kcal, .session-head__count, .week__count b, .cell__value.num';
const vvPrev = new Map();
const vvRolling = new WeakSet();
function vvWatchValues() {
  const route = typeof currentRoute === 'function' ? currentRoute() : '';
  document.querySelectorAll(VV_WATCH).forEach((el, i) => {
    if (vvRolling.has(el)) return;
    const key = `${route}|${i}`, p = vvParse(el.textContent);
    if (!p) return;
    const before = vvPrev.get(key);
    vvPrev.set(key, p.value);
    if (before !== undefined && before !== p.value) vvRoll(el, before, 420);
  });
}

// ── Série validée, record battu ──
let vvPending = null;   // { ei, si } de la série qu'on vient de valider
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-action="validate-set"]');
  if (b && b.getAttribute('aria-disabled') !== 'true') vvPending = { ei: b.dataset.ei, si: b.dataset.si, at: Date.now() };
}, true);

function vvBurstAt(host, x, y) {
  const s = document.createElement('span');
  s.className = 'vv-burst';
  s.style.left = `${x}px`; s.style.top = `${y}px`;
  host.appendChild(s);
  setTimeout(() => s.remove(), 450);
}
function vvRecord(host, target) {
  if (!host || !target || host.dataset.vvRec) return;
  host.dataset.vvRec = '1';
  host.classList.add('vv-rec');
  const h = host.getBoundingClientRect(), t = target.getBoundingClientRect();
  vvBurstAt(host, t.left - h.left + t.width / 2, t.top - h.top + t.height / 2);
}

function vvSetDone() {
  if (!vvPending || Date.now() - vvPending.at > 1500) { vvPending = null; return; }
  const row = document.querySelector(`.session-set--done[data-ei="${vvPending.ei}"][data-si="${vvPending.si}"]`);
  if (!row) return;
  vvPending = null;
  row.querySelector('.set-check--done')?.classList.add('vv-fill');
  const badge = row.querySelector('.pr-badge');
  if (badge) { badge.classList.add('vv-rec'); vvRecord(row, badge.querySelector('.medal') || badge); }
}

// Barre de progression de la séance : elle avance depuis sa valeur d'avant (l'écran est redessiné)
let vvBar = null;
function vvProgress() {
  const fill = document.querySelector('.session-progress .progress-bar__fill');
  if (!fill) { vvBar = null; return; }
  const w = fill.style.width;
  if (vvBar !== null && vvBar !== w && !fill.dataset.vv) {
    fill.dataset.vv = '1';
    fill.style.width = vvBar;
    void fill.offsetWidth;
    requestAnimationFrame(() => { fill.style.width = w; });
  }
  fill.dataset.vv = '1';
  vvBar = w;
}

// Bilan qui s'ouvre : les trois chiffres comptent depuis zéro, la médaille du record s'allume
function vvSummary() {
  const v = document.querySelector('.summary--pop:not([data-vv])');
  if (!v) return;
  v.dataset.vv = '1';
  v.querySelectorAll('.sum-tile__value').forEach(el => vvRoll(el, 0, 640));
  const line = v.querySelector('.sum-line');
  const medal = line?.querySelector('.medal');
  if (medal) setTimeout(() => vvRecord(line, medal), 180);
}

// Anneaux et barres de nutrition : ils se remplissent. La première fois qu'on les voit, depuis vide ; ensuite
// (repas coché, aliment remplacé : l'écran est redessiné), depuis leur valeur d'avant, à la même place
const vvRings = new WeakSet();
const vvGauge = new Map();
function vvFillFrom(el, attr, from, to) {
  el.style.transition = 'none';
  if (attr === 'width') el.style.width = from; else el.setAttribute(attr, from);
  void el.getBoundingClientRect();
  el.style.transition = '';
  el.classList.add('vv-ring');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (attr === 'width') el.style.width = to; else el.setAttribute(attr, to);
  }));
}
function vvFillRings() {
  const route = typeof currentRoute === 'function' ? currentRoute() : '';
  document.querySelectorAll('.diet-ring__arc, .diet-bar__fill').forEach((el, i) => {
    if (vvRings.has(el)) return;
    vvRings.add(el);
    const ring = el.classList.contains('diet-ring__arc'), key = `${route}|${ring ? 'r' : 'b'}${i}`;
    const attr = ring ? 'stroke-dashoffset' : 'width';
    const to = ring ? el.getAttribute(attr) : el.style.width, empty = ring ? el.getAttribute('stroke-dasharray') : '0%';
    const before = vvGauge.get(key);
    vvGauge.set(key, to);
    if (!to || !empty) return;
    const from = before ?? empty;
    if (from === to) return;
    vvFillFrom(el, attr, from, to);
  });
}

// Image du personnage absente (fichier manquant) : la ligne garde son texte, sans image cassée
document.addEventListener('error', e => {
  if (e.target?.classList?.contains('mgc__img')) e.target.setAttribute('data-missing', '');
}, true);

let vvQueued = false;
function vvAfterRender() {
  vvQueued = false;
  if (VV_REDUCED()) { vvPending = null; return; }
  vvSetDone();
  vvProgress();
  vvSummary();
  vvFillRings();
  vvWatchValues();
}
function vvStart() {
  const root = document.getElementById('app') || document.body;
  new MutationObserver(() => {
    if (vvQueued) return;
    vvQueued = true;
    requestAnimationFrame(vvAfterRender);
  }).observe(root, { childList: true, subtree: true });
  vvAfterRender();
}
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vvStart);
  else vvStart();
}
