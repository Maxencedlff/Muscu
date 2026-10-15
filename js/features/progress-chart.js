// ═══════════════════════════════════════════════════════════
//  Progrès › Exercice : courbe et sélection d'un point
// ═══════════════════════════════════════════════════════════
'use strict';

let chartState = null; // { vals, dates, points, mode, unit, color, xLabels, sel }

function metricOf(p, bw) {
  if (statsMode === 'charge') return bw ? p.maxReps : toUnitW(p.maxLoad);
  if (statsMode === '1rm')    return bw ? p.maxReps : toUnitW(p.best1RM || p.maxLoad);
  return bw ? p.totalReps : toUnitW(p.volume);
}
function fmtMetricVal(v, bw) {
  if (bw) return `${Math.round(v)} reps`;
  if (statsMode === 'volume') return fmtVolume(data.unit === 'lbs' ? v / KG_TO_LBS : v);
  return `${statsMode === '1rm' ? '~' : ''}${fmtNum(Math.round(v * 10) / 10)} ${unitLbl()}`;
}

// Progrès › Exercice : l'exercice vient de la route (« stats-ex:EXID »)
function renderStatsExercise(exId) {
  const it = exerciseIndex().get(exId);
  if (!it) {
    return `<div class="view stats-ex view--grouped">${navBar({ title: 'Exercice' })}
      <div class="scr"><div class="empty-note">Aucune donnée pour cet exercice.</div></div></div>`;
  }
  const bw     = isBodyweight(it);
  const pts    = it.points;
  const sec    = exSection(it);
  const color  = sec.cat ? sessionMeta(sec.cat, sec.prog).color : sessionMeta(it.cat, it.prog).color;
  const vals   = pts.map(p => metricOf(p, bw));
  chartState   = { vals, dates: pts.map(p => p.date), points: pts, bw, mode: statsMode, color, xLabels: [], sel: null };

  // Record charge (poids puis reps) et 1RM estimé : record et dernière séance
  const prBest = bestSet(pts.flatMap(p => p.sets));
  const rec1RM = Math.max(0, ...pts.map(p => p.best1RM));
  const last   = pts[pts.length - 1];
  const progEx = Object.values(data.programmes).flatMap(p => Object.values(p.exercises || {}).flat()).find(x => x.id === it.exId);
  const target = progEx?.target;
  const tp     = trendPct(vals);

  const targetBar = (statsMode === 'charge' && target && !bw) ? (() => {
    const pct = Math.min(100, Math.round(last.maxLoad / target * 100));
    return `
      <div class="group-title">Objectif</div>
      <div class="group group--pad">
        <div class="target-row"><span>${fmtW(target)} ${unitLbl()}</span><span class="${pct >= 100 ? 'txt-up' : ''}">${pct >= 100 ? 'Atteint' : pct + ' %'}</span></div>
        <div class="tbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="tbar__fill" style="width:${pct}%"></div></div>
      </div>`;
  })() : '';

  const sessions = pts.slice().reverse().map(p => `
      <button class="cell cell--nav" data-action="open-history" data-id="${esc(p.hid)}">
        <span class="cell__body"><span class="cell__title cell__title--reg">${fmtDate(p.date)}</span></span>
        <span class="cell__value num">${bw ? `${p.sets.map(s => parseInt(s.reps)).join(' · ')} reps` : setTxt(p.best)}</span>
        ${icon('chevron.right', 16)}
      </button>`).join('');

  const modes = [['volume', 'Volume'], ['charge', 'Charge max'], ['1rm', '1RM est.']];
  return `
    <div class="view stats-ex view--grouped">
      ${navBar({ title: '' })}
      <div class="scr">
        <h1 class="scr-title">${esc(it.name)}</h1>
        <div class="segmented seg-full" role="group" aria-label="Mesure affichée">
          ${modes.map(([m, l]) => `<button class="segmented__btn ${statsMode === m ? 'segmented__btn--active' : ''}" aria-pressed="${statsMode === m}" data-action="stats-mode" data-mode="${m}">${l}</button>`).join('')}
        </div>
        <div class="chart-head">
          <span class="chart-head__val num">${fmtMetricVal(vals[vals.length - 1], bw)}</span>
          ${tp === null ? '' : `<span class="chart-head__trend num ${tp > 0 ? 'txt-up' : tp < 0 ? 'txt-down' : 'txt-flat'}">${pctTxt(tp)}</span>`}
          ${statsMode === '1rm' ? `<button class="info-btn" data-action="info-1rm" aria-label="Comment est calculé le 1RM estimé ?">i</button>` : ''}
        </div>
        <div class="chart" id="exChart">
          <canvas class="stats-canvas" role="img" aria-label=""></canvas>
          <div class="chart-bubble num" hidden></div>
        </div>
        <div class="group">
          <div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">Record</span></span>
            <span class="cell__value num">${prBest ? setTxt(prBest) : '—'}</span></div>
          ${!bw && rec1RM ? `
          <div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">Record 1RM est.</span></span>
            <span class="cell__value num">~${fmtW(rec1RM)} ${unitLbl()}</span></div>
          <div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">1RM est. dernière séance</span></span>
            <span class="cell__value num">${last.best1RM ? `~${fmtW(last.best1RM)} ${unitLbl()}` : '—'}</span></div>` : ''}
          <div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">Séances</span></span>
            <span class="cell__value num">${pts.length}</span></div>
        </div>
        ${targetBar}
        <div class="group-title">Séances</div>
        <div class="group">${sessions}</div>
      </div>
    </div>`;
}

// Couleur CSS résolue (accepte un hex comme une var(--x))
function resolveColor(el, c) {
  el.style.color = c;
  const v = getComputedStyle(el).color;
  el.style.color = '';
  return v;
}

function axisFmt(v) {
  if (chartState.bw) return String(Math.round(v));
  // Volume : une seule unité pour toutes les graduations (t ou kg selon le maximum)
  if (chartState.mode === 'volume') {
    if (chartState.axisK) return fmtNum(Math.round(v / 100) / 10) + (data.unit === 'lbs' ? ' k lbs' : ' t');
    return fmtNum(Math.round(v)) + ' ' + unitLbl();
  }
  return fmtNum(Math.round(v * 10) / 10);
}

function drawCharts() {
  const box = $('#exChart');
  if (!box || !chartState) return;
  const canvas = box.querySelector('canvas');
  const st = chartState;
  const { vals, dates } = st;
  const n = vals.length;
  const W = box.clientWidth, H = 200;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const color = resolveColor(canvas, st.color);
  const cs    = getComputedStyle(box);
  const sepC  = cs.getPropertyValue('--sep').trim() || 'rgba(128,128,128,.4)';
  const lblC  = cs.getPropertyValue('--label2').trim() || '#8e8e93';
  const bgC   = cs.getPropertyValue('--cell').trim() || '#1c1c1e';
  const font  = '-apple-system, system-ui, sans-serif';

  // Axe Y : depuis 0 pour le volume, tronqué (mais gradué) pour la charge et le 1RM
  const vMax = Math.max(...vals), vMin = Math.min(...vals);
  let lo = (st.mode === 'volume' || st.bw) ? 0 : vMin - (vMax - vMin) * 0.15 - (vMax === vMin ? vMax * 0.1 : 0);
  if (lo < 0) lo = 0;
  let hi = vMax + (vMax - lo) * 0.08 || 1;
  const ticks = [lo, (lo + hi) / 2, hi];
  st.axisK = hi >= 1000;
  ctx.font = `11px ${font}`;
  const tickW = Math.max(...ticks.map(t => ctx.measureText(axisFmt(t)).width));
  const pL = 4, pR = tickW + 10, pT = 44, pB = 22; // bande du haut réservée à la bulle
  const cW = W - pL - pR, cH = H - pT - pB;
  const xp = i => pL + (n === 1 ? cW / 2 : i / (n - 1) * cW);
  const yp = v => pT + cH - (v - lo) / ((hi - lo) || 1) * cH;
  st.geom = { xp, yp, pL, pR, cW, W, H };

  // Grille et graduations à droite
  ctx.lineWidth = 0.5; ctx.strokeStyle = sepC; ctx.fillStyle = lblC;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ticks.forEach(t => {
    const y = Math.round(yp(t)) + 0.25;
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + cW, y); ctx.stroke();
    ctx.fillText(axisFmt(t), pL + cW + 6, y);
  });

  // Courbe : segments droits
  ctx.beginPath();
  vals.forEach((v, i) => i ? ctx.lineTo(xp(i), yp(v)) : ctx.moveTo(xp(i), yp(v)));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.stroke();

  // Points : dernier et maximum seulement
  const iMax = vals.lastIndexOf(vMax);
  [...new Set([iMax, n - 1])].forEach(i => {
    ctx.beginPath(); ctx.arc(xp(i), yp(vals[i]), 4, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = bgC; ctx.stroke();
  });

  // Sélection au doigt : ligne verticale
  if (st.sel !== null && st.sel < n) {
    const x = Math.round(xp(st.sel)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, pT); ctx.lineTo(x, pT + cH);
    ctx.strokeStyle = lblC; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(xp(st.sel), yp(vals[st.sel]), 5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = bgC; ctx.stroke();
  }

  // Étiquettes X sans chevauchement (espacées d'au moins leur largeur + 6)
  ctx.fillStyle = lblC; ctx.textBaseline = 'alphabetic';
  const lbl = i => fmtDate(dates[i], 'short').replace('.', '');
  const rect = i => {
    const w = ctx.measureText(lbl(i)).width;
    const x = Math.max(pL, Math.min(pL + cW - w, xp(i) - w / 2));
    return { i, x, w };
  };
  const placed = [];
  const lastR = rect(n - 1);
  const free = r => placed.every(p => r.x >= p.x + p.w + 16 || r.x + r.w + 16 <= p.x);
  placed.push(lastR);
  for (let i = 0; i < n - 1; i++) { const r = rect(i); if (free(r)) placed.push(r); }
  ctx.textAlign = 'left';
  placed.forEach(r => ctx.fillText(lbl(r.i), r.x, H - 6));
  st.xLabels = placed.map(r => ({ x: r.x, w: r.w }));

  // Description pour VoiceOver
  const mName = st.mode === 'volume' ? 'Volume' : st.mode === 'charge' ? 'Charge max' : '1RM estimé';
  const tp = trendPct(vals);
  const d = i => fmtDate(dates[i], 'short');
  canvas.setAttribute('aria-label', n > 1
    ? `${mName} : de ${fmtMetricVal(vals[0], st.bw)} le ${d(0)} à ${fmtMetricVal(vals[n - 1], st.bw)} le ${d(n - 1)}${tp === null ? '' : ', ' + pctTxt(tp)}`
    : `${mName} : ${fmtMetricVal(vals[0], st.bw)} le ${d(0)}`);
}

function chartSelect(clientX) {
  const st = chartState, box = $('#exChart');
  if (!st || !box || !st.geom) return;
  const r = box.getBoundingClientRect();
  const x = clientX - r.left;
  let best = 0, bd = Infinity;
  st.vals.forEach((_, i) => { const dd = Math.abs(st.geom.xp(i) - x); if (dd < bd) { bd = dd; best = i; } });
  if (best !== st.sel) { st.sel = best; haptic(); }
  drawCharts();
  const p = st.points[best];
  const b = box.querySelector('.chart-bubble');
  const date = fmtDate(p.date, 'short');
  const set  = st.bw ? `${p.maxReps} reps` : `${fmtW(p.best.weight)} ${unitLbl()} × ${p.best.r}`;
  b.textContent = `${date} · ${set} · ${st.bw ? p.totalReps + ' reps' : fmtVolume(p.volume)}`;
  b.dataset.i = best;
  b.hidden = false;
  const bx = st.geom.xp(best);
  const bw = b.offsetWidth;
  b.style.left = Math.max(0, Math.min(r.width - bw, bx - bw / 2)) + 'px';
}
function chartRelease() {
  const st = chartState;
  if (!st) return;
  clearTimeout(st.hideT);
  st.hideT = setTimeout(() => {
    if (!chartState || chartState !== st) return;
    st.sel = null;
    const b = $('#exChart .chart-bubble');
    if (b) b.hidden = true;
    drawCharts();
  }, 2500);
}
let chartDown = false;
document.addEventListener('pointerdown', e => {
  if (!e.target.closest?.('#exChart')) return;
  chartDown = true; clearTimeout(chartState?.hideT); chartSelect(e.clientX);
});
document.addEventListener('pointermove', e => {
  if (!e.target.closest?.('#exChart') && !chartDown) return;
  if (e.pointerType !== 'mouse' && !chartDown) return;
  if (!$('#exChart')) return;
  chartSelect(e.clientX);
});
document.addEventListener('pointerup', () => { if (chartDown) { chartDown = false; chartRelease(); } });
document.addEventListener('pointercancel', () => { if (chartDown) { chartDown = false; chartRelease(); } });

// Nouveau dessin au redimensionnement, à la rotation et au changement de thème
let chartRaf = null;
function redrawChartSoon() {
  clearTimeout(chartRaf);
  chartRaf = setTimeout(() => { if ($('#exChart')) drawCharts(); }, 120);
}
window.addEventListener('resize', redrawChartSoon);
window.addEventListener('orientationchange', redrawChartSoon);
new MutationObserver(redrawChartSoon).observe(document.body, { attributes: true, attributeFilter: ['class'] });
