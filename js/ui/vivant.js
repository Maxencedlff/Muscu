// ═══════════════════════════════════════════════════════════
//  Mouvement utile (direction « sobre et vivante », css/theme-sobre.css)
//  L'app redessine un écran entier à chaque changement : ce module regarde ce qui vient d'être dessiné
//  et anime seulement ce qui a changé de sens (série validée, record, chiffre qui bouge, anneau qui se
//  remplit). Rien ne bloque un toucher : les gestes sont seulement notés au « click » (un seul tap iOS),
//  sans preventDefault. Réduire les animations : aucune animation, les valeurs finales tout de suite.
// ═══════════════════════════════════════════════════════════
'use strict';

const VV_REDUCED = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// Petites barres « 4 dernières semaines » (Progrès, fiche élève) : counts du plus ancien au plus récent,
// décoratives (aria-hidden) : le chiffre et son libellé restent le texte lu par VoiceOver
function weekBarsSvg(counts) {
  if (!Array.isArray(counts) || counts.length < 2 || !counts.some(n => n > 0)) return '';
  const max = Math.max(...counts), last = counts[counts.length - 1];
  const prev = counts.slice(0, -1), avg = prev.reduce((a, b) => a + b, 0) / prev.length;
  const bars = counts.map((n, i) => `<span class="wkbars__b${i === counts.length - 1 ? ' wkbars__b--now' : ''}" style="height:${Math.max(2, Math.round(n / max * 22))}px"></span>`).join('');
  return `<span class="wkbars${last > avg ? ' wkbars--up' : ''}" aria-hidden="true">${bars}</span>`;
}
// Séances par semaine glissante (7 jours), 4 semaines, à partir d'horodatages ; null si la période
// n'est pas entièrement couverte par les données (complete : false)
function weekCounts(stamps, now = Date.now(), weeks = 4, complete = true) {
  if (!complete) return null;
  const W = 7 * 864e5, out = new Array(weeks).fill(0);
  stamps.forEach(t => {
    const k = Math.floor((now - t) / W);
    if (k >= 0 && k < weeks) out[weeks - 1 - k]++;
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

// Anneaux de nutrition : ils partent de vide la première fois qu'on les voit
const vvRings = new WeakSet();
function vvFillRings() {
  document.querySelectorAll('.diet-ring__arc').forEach(arc => {
    if (vvRings.has(arc)) return;
    vvRings.add(arc);
    const to = arc.getAttribute('stroke-dashoffset'), full = arc.getAttribute('stroke-dasharray');
    if (!to || !full || Number(to) >= Number(full)) return;
    arc.setAttribute('stroke-dashoffset', full);
    void arc.getBoundingClientRect();
    arc.classList.add('vv-ring');
    requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', to)));
  });
}

// Image du personnage absente (rendus pas encore livrés) : la carte garde son texte, sans image cassée
document.addEventListener('error', e => {
  if (e.target?.classList?.contains('mcard__img')) e.target.setAttribute('data-missing', '');
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
