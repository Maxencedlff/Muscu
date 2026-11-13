// ═══════════════════════════════════════════════════════════
//  Progrès › Exercice : courbe et sélection d'un point
// ═══════════════════════════════════════════════════════════
'use strict';

// Une courbe d'une autre grandeur (mensurations, js/features/body-measures-ui.js) donne ses propres
// textes : name (VoiceOver), fmtVal(v), axisFmt(v), bubble(point), fromZero
let chartState = null; // { vals, dates, points, mode, unit, color, xLabels, sel, name?, fmtVal?, axisFmt?, bubble?, fromZero? }

function metricOf(p, bw) {
  if (statsMode === 'effort') return p.rpe;   // RPE moyen des séries notées (js/data/rir.js)
  if (statsMode === 'charge') return bw ? p.maxReps : toUnitW(p.maxLoad);
  if (statsMode === '1rm')    return bw ? p.maxReps : toUnitW(p.best1RM || p.maxLoad);
  return bw ? p.totalReps : toUnitW(p.volume);
}
// Unité des courbes sans charge : reps, secondes (maintiens) ou minutes (cardio) ; posée à l'ouverture de l'exercice
let chartUnit = 'reps';
let chartEx   = null;   // { name } de l'exercice affiché : textes des séries (lest, aide)
function fmtMetricVal(v, bw) {
  if (chartState?.fmtVal) return chartState.fmtVal(v);   // courbe d'une autre grandeur (mensurations)
  if (chartState?.cardio) return fmtCardioVal(v, chartState.cardio, chartState.paceKind);
  if (chartState?.effort) return `RPE ${fmtNum(v, 1)}`;
  if (bw) return `${Math.round(v)} ${chartUnit}`;
  if (statsMode === 'volume') return fmtVolume(data.unit === 'lbs' ? v / KG_TO_LBS : v);
  return `${statsMode === '1rm' ? '~' : ''}${fmtNum(Math.round(v * 10) / 10)} ${unitLbl()}`;
}

// Cardio : courbes de durée, de distance et d'allure à la place de Volume / Charge max / 1RM.
// L'allure se lit en min/km (plus bas = mieux) pour la course, en km/h pour le vélo (paceKind).
let cardioMode = 'time';   // 'time' | 'dist' | 'pace'
function cardioMetric(p, mode) { return mode === 'time' ? p.totalReps : mode === 'dist' ? p.dist : p.pace; }
function fmtCardioVal(v, mode, kind) {
  if (mode === 'time') return `${Math.round(v)} min`;
  if (mode === 'dist') return `${fmtNum(Math.round(v * 10) / 10)} km`;
  return fmtPace(v, kind);
}
// Courbes proposées : la durée toujours, la distance et l'allure dès qu'une séance en a
function cardioModes(pts, kind) {
  return [['time', 'Durée'], ...(pts.some(p => p.dist > 0) ? [['dist', 'Distance']] : []),
    ...(pts.some(p => p.pace) ? [['pace', kind === 'speed' ? 'Vitesse' : 'Allure']] : [])];
}

// Progrès › Exercice : l'exercice vient de la route (« stats-ex:EXID »)
function renderStatsExercise(exId) {
  const it = exerciseIndex().get(exId);
  if (!it) {
    return `<div class="view stats-ex view--grouped">${navBar({ title: 'Exercice' })}
      <div class="scr"><div class="empty-note">Aucune donnée pour cet exercice.</div></div></div>`;
  }
  const bw     = isBodyweight(it);
  chartUnit    = it.unit || 'reps';
  chartEx      = { name: it.name };
  const cardio = it.measure === 'cardio';
  const pk     = cardio ? paceKind(it) : null;
  const cModes = cardio ? cardioModes(it.points, pk) : [];
  if (cardio && !cModes.some(([m]) => m === cardioMode)) cardioMode = 'time';
  // Courbe « Effort » (RPE moyen, js/data/rir.js) : proposée dès qu'une séance a des RIR notés
  const hasRpe = !cardio && it.points.some(p => p.rpe != null);
  if (statsMode === 'effort' && !hasRpe) statsMode = 'charge';
  const effort = !cardio && statsMode === 'effort';
  // Courbe d'allure, de distance ou d'effort : seulement les séances qui en ont une
  const pts    = effort ? it.points.filter(p => p.rpe != null) : !cardio || cardioMode === 'time' ? it.points : it.points.filter(p => cardioMetric(p, cardioMode));
  const sec    = exSection(it);
  const color  = sec.cat ? sessionMeta(sec.cat, sec.prog).color : sessionMeta(it.cat, it.prog).color;
  const vals   = pts.map(p => cardio ? cardioMetric(p, cardioMode) : metricOf(p, bw));
  // lowerBetter : allure en min/km, la tendance qui baisse est un progrès
  const lowerBetter = cardio && cardioMode === 'pace' && (pk === 'pace' || pk === 'split');
  chartState   = { vals, dates: pts.map(p => p.date), points: pts, bw, mode: statsMode, color, xLabels: [], sel: null,
                   cardio: cardio ? cardioMode : null, paceKind: pk, lowerBetter, effort };

  // Record charge (poids puis reps) et 1RM estimé : record et dernière séance
  const prBest = bestSet(pts.flatMap(p => p.sets), { name: it.name });
  const rec1RM = Math.max(0, ...pts.map(p => p.best1RM));
  const last   = pts[pts.length - 1];
  const progEx = Object.values(data.programmes).flatMap(p => Object.values(p.exercises || {}).flat()).find(x => x.id === it.exId);
  const target = progEx?.target;
  const tp     = effort ? null : trendPct(vals);   // un effort qui monte n'est ni un progrès ni un recul
  const better = tp === null ? null : lowerBetter ? -tp : tp;

  const targetBar = (statsMode === 'charge' && target && !bw) ? (() => {
    const pct = Math.min(100, Math.round(last.maxLoad / target * 100));
    return `
      <div class="group-title">Objectif</div>
      <div class="group group--pad">
        <div class="target-row"><span>${fmtW(target)} ${unitLbl()}</span><span class="${pct >= 100 ? 'txt-up' : ''}">${pct >= 100 ? 'Atteint' : pct + '\u00a0%'}</span></div>
        <div class="tbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="tbar__fill" style="width:${pct}%"></div></div>
      </div>`;
  })() : '';

  // Séances où un record de cet exercice a été battu (records notés, js/data/records.js) : médaille
  const recHids = exerciseRecordSessions(it, pts);
  const sessions = pts.slice().reverse().map(p => `
      <button class="cell cell--nav" data-action="open-history" data-id="${esc(p.hid)}">
        <span class="cell__body"><span class="cell__title cell__title--reg">${fmtDate(p.date)}${recHids.has(p.hid) ? ` <span class="stats-rec">${medalSvg(16)}<span class="visually-hidden">, record</span></span>` : ''}</span></span>
        <span class="cell__value num">${cardio ? cardioPointTxt(p, pk) : bw ? `${p.sets.map(s => parseInt(s.reps)).join(' · ')} ${chartUnit}` : setTxt(p.best, chartEx)}${p.rpe != null ? ` · RPE ${fmtNum(p.rpe, 1)}` : ''}</span>
        ${icon('chevron.right', 16)}
      </button>`).join('');

  const modes = cardio ? cModes : [['charge', 'Charge max'], ['volume', 'Volume'], ['1rm', '1RM est.'], ...(hasRpe ? [['effort', 'Effort']] : [])];
  const modeOn = cardio ? cardioMode : statsMode;
  // Cardio : meilleure allure (ou vitesse) et plus longue distance à la place du record de charge
  const paces = it.points.map(p => p.pace).filter(Boolean);
  const bestPace = !paces.length ? null : pk === 'speed' ? Math.max(...paces) : Math.min(...paces);
  const maxDist = Math.max(0, ...it.points.map(p => p.dist || 0));
  const cell = (title, val) => `<div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">${title}</span></span>
            <span class="cell__value num">${val}</span></div>`;
  // Maintien : le plus long (lest le plus lourd à durée égale), pas la série la plus lestée
  const holdBest = it.measure === 'time' ? longestHold(pts.flatMap(p => p.sets)) : null;
  const recordCells = cardio ? `
          ${bestPace ? cell(pk === 'speed' ? 'Meilleure vitesse' : 'Meilleure allure', fmtPace(bestPace, pk)) : ''}
          ${fixedDistancePaces(it.points, pk).map(([d, v]) => cell(`Meilleure allure ${recordDistTxt(d)}`, fmtPace(v / 60, pk))).join('')}
          ${maxDist ? cell('Plus longue distance', `${fmtNum(maxDist)} km`) : ''}
          ${cell('Plus longue durée', `${Math.max(0, ...it.points.flatMap(p => p.sets.map(s => parseInt(s.reps) || 0)))} min`)}`
    : holdBest ? cell('Plus long maintien', setTxt(holdBest, chartEx))
    : cell('Record', prBest ? setTxt(prBest, chartEx) : '—');
  return `
    <div class="view stats-ex view--grouped">
      ${navBar({ title: '' })}
      <div class="scr">
        <h1 class="scr-title">${esc(it.name)}</h1>
        ${aliasNoteHtml(it.name, 'scr-sub ex-alias')}
        <div class="segmented seg-full" role="group" aria-label="Mesure affichée">
          ${modes.map(([m, l]) => `<button class="segmented__btn ${modeOn === m ? 'segmented__btn--active' : ''}" aria-pressed="${modeOn === m}" data-action="${cardio ? 'stats-cardio-mode' : 'stats-mode'}" data-mode="${m}">${l}</button>`).join('')}
        </div>
        <div class="chart-head">
          <span class="chart-head__val num">${fmtMetricVal(vals[vals.length - 1], bw)}</span>
          ${tp === null ? '' : `<span class="chart-head__trend num ${better > 0 ? 'txt-up' : better < 0 ? 'txt-down' : 'txt-flat'}">${pctTxt(tp)}</span><span class="chart-head__since">${esc(sinceTxt(pts[0].date))}</span>`}
          ${statsMode === '1rm' && !cardio ? `<button class="info-btn" data-action="info-1rm" aria-label="Comment est calculé le 1RM estimé ?">i</button>` : ''}
        </div>
        <div class="chart" id="exChart">
          <canvas class="stats-canvas" role="img" aria-label=""></canvas>
          <div class="chart-bubble num" hidden></div>
        </div>
        <div class="group">${recordCells}
          ${!bw && rec1RM ? `
          <div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">Record 1RM est.</span><span class="cell__sub">Charge que tu soulèverais une seule fois, calculée d'après tes séries</span></span>
            <span class="cell__value num">~${fmtW(rec1RM)} ${unitLbl()}</span></div>
          <div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">1RM est. dernière séance</span></span>
            <span class="cell__value num">${last.best1RM ? `~${fmtW(last.best1RM)} ${unitLbl()}` : '—'}</span></div>` : ''}
          <div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">Séances</span></span>
            <span class="cell__value num">${pts.length}</span></div>
        </div>
        ${targetBar}
        ${cardio ? '' : strengthGroupHtml(it.name)}
        ${exMusclesGroupHtml({ exId: it.exId, name: it.name })}
        <div class="group-title">Séances</div>
        <div class="group">${sessions}</div>
      </div>
    </div>`;
}

// Série de maintien la plus longue (puis la plus lestée) : { w, r, weight, reps } comme bestSet, null sans
function longestHold(sets) {
  return workSets(sets).reduce((b, s) => {
    const w = parseFloat(s.weight) || 0, r = parseInt(s.reps) || 0;
    if (r <= 0) return b;
    return !b || r > b.r || (r === b.r && w > b.w) ? { w, r, weight: s.weight, reps: s.reps } : b;
  }, null);
}
// Meilleures allures sur les distances fixes des records (course 1, 5, 10 km ; rameur 500 et 2 000 m),
// en secondes : seules les séries d'au moins cette distance comptent. [[d, sec]], vide sans allure
function fixedDistancePaces(points, pk) {
  if (pk !== 'pace' && pk !== 'split') return [];
  const sets = points.flatMap(p => p.sets);
  return (pk === 'split' ? ROW_RECORD_KM : RUN_RECORD_KM).map(d => {
    const v = sets.filter(s => (parseFloat(s.dist) || 0) >= d).map(s => setPaceSec(s, pk)).filter(x => x != null);
    return [d, v.length ? Math.min(...v) : null];
  }).filter(([, v]) => v != null);
}
// Identifiants des séances (points de la courbe) où cet exercice a battu un record
function exerciseRecordSessions(it, pts) {
  const out = new Set(), n = normName(it.name);
  pts.forEach(p => {
    const h = (data.history || []).find(x => x.id === p.hid);
    const ex = h?.exercises?.find(e => exKey(e) === it.exId);
    if (h && entryRecords(h).some(r => normName(r.ex) === normName(ex?.name ?? n))) out.add(p.hid);
  });
  return out;
}

// Couleur CSS résolue (accepte un hex comme une var(--x))
function resolveColor(el, c) {
  el.style.color = c;
  const v = getComputedStyle(el).color;
  el.style.color = '';
  return v;
}

// Tracé en clair : la couleur de la séance assombrie (× 0,7) pour 3:1 au moins sur la carte blanche (l'orange de Push
// faisait 2,2:1, WCAG 1.4.11, panel t5) ; en sombre, telle quelle
function chartLineColor(rgb) {
  if (!document.body.classList.contains('light')) return rgb;
  const m = String(rgb).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  return m ? `rgb(${[m[1], m[2], m[3]].map(v => Math.round(v * 0.7)).join(', ')})` : rgb;
}

function axisFmt(v) {
  if (chartState.fmtVal) return (chartState.axisFmt || chartState.fmtVal)(v);
  if (chartState.effort) return fmtNum(Math.round(v * 10) / 10);
  if (chartState.cardio === 'pace') return chartState.paceKind === 'speed' ? fmtNum(Math.round(v * 10) / 10) : fmtPace(v, 'pace').replace(' /km', '');   // aussi /500 m (même format m:ss)
  if (chartState.cardio === 'dist') return fmtNum(Math.round(v * 10) / 10);
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

  const color = chartLineColor(resolveColor(canvas, st.color));
  const cs    = getComputedStyle(box);
  const sepC  = cs.getPropertyValue('--sep').trim() || 'rgba(128,128,128,.4)';
  const lblC  = cs.getPropertyValue('--label2').trim() || '#8e8e93';
  const bgC   = cs.getPropertyValue('--cell').trim() || '#1c1c1e';
  const font  = '-apple-system, system-ui, sans-serif';

  // Axe Y : depuis 0 pour le volume, tronqué (mais gradué) pour la charge, le 1RM et l'allure
  const vMax = Math.max(...vals), vMin = Math.min(...vals);
  const fromZero = st.fromZero ?? (st.cardio ? st.cardio !== 'pace' : (st.mode === 'volume' || st.bw));
  let lo = fromZero ? 0 : vMin - (vMax - vMin) * 0.15 - (vMax === vMin ? vMax * 0.1 : 0);
  if (lo < 0) lo = 0;
  let hi = vMax + (vMax - lo) * 0.08 || 1;
  // Effort : échelle RPE fixe de 6 (RIR 4 et plus) à 10, lisible d'une séance à l'autre
  if (st.effort) { lo = 5.8; hi = 10.2; }
  // Graduations rondes (pas l'allure en m:ss, pas l'effort à échelle fixe) ; l'unité sur la plus haute
  const ticks = st.effort ? [6, 8, 10] : st.cardio === 'pace' ? [lo, (lo + hi) / 2, hi] : chartNiceTicks(lo, hi);
  if (!st.effort && st.cardio !== 'pace') { lo = ticks[0]; hi = ticks[ticks.length - 1]; }
  const unitTop = st.effort || st.cardio || st.fmtVal || st.mode === 'volume' ? '' : ` ${st.bw ? chartUnit : unitLbl()}`;
  const tickTxt = (t, i) => axisFmt(t) + (i === ticks.length - 1 ? unitTop : '');
  st.axisK = hi >= 1000;
  ctx.font = `11px ${font}`;
  const tickW = Math.max(...ticks.map((t, i) => ctx.measureText(tickTxt(t, i)).width));
  const pL = 4, pR = tickW + 10, pT = 44, pB = 22; // bande du haut réservée à la bulle
  const cW = W - pL - pR, cH = H - pT - pB;
  const fx = chartXFracs(dates);   // points placés selon leur date (js/features/progress.js)
  const xp = i => pL + fx[i] * cW;
  const yp = v => pT + cH - (v - lo) / ((hi - lo) || 1) * cH;
  st.geom = { xp, yp, pL, pR, cW, W, H };

  // Grille et graduations à droite
  ctx.lineWidth = 0.5; ctx.strokeStyle = sepC; ctx.fillStyle = lblC;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ticks.forEach((t, i) => {
    const y = Math.round(yp(t)) + 0.25;
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + cW, y); ctx.stroke();
    ctx.fillText(tickTxt(t, i), pL + cW + 6, y);
  });

  // Courbe : segments droits
  ctx.beginPath();
  vals.forEach((v, i) => i ? ctx.lineTo(xp(i), yp(v)) : ctx.moveTo(xp(i), yp(v)));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.stroke();

  // Points : dernier et meilleur seulement (le plus bas pour une allure en min/km)
  const iMax = vals.lastIndexOf(st.lowerBetter ? vMin : vMax);
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
  const lbl = i => fmtDate(dates[i], 'short');   // « 3 nov. » avec son point, comme partout dans l'app (panel t6)
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
  const mName = st.name || (st.cardio ? cardioModes(st.points, st.paceKind).find(([m]) => m === st.cardio)?.[1]
    : st.effort ? 'Effort' : st.mode === 'volume' ? 'Volume' : st.mode === 'charge' ? 'Charge max' : '1RM estimé');
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
  const set  = st.bubble ? '' : st.bw ? `${p.maxReps} ${chartUnit}` : setTxt(p.best, chartEx);
  b.textContent = st.bubble ? st.bubble(p) : st.cardio ? `${date} · ${cardioPointTxt(p, st.paceKind)}`
    : st.effort ? `${date} · RPE ${fmtNum(p.rpe, 1)} · ${set}`
    : `${date} · ${set} · ${st.bw ? `${p.totalReps} ${chartUnit} en tout` : `volume ${fmtVolume(p.volume)}`}`;   // le total nommé (« 806 kg » seul, panel t5)
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
