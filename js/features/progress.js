// ═══════════════════════════════════════════════════════════
//  Progrès : index des exercices tiré de l'historique
// ═══════════════════════════════════════════════════════════
'use strict';

let statsMode = 'volume';   // 'volume' | 'charge' | '1rm'
let ovMonth   = null; // { y, m } du calendrier de la vue d'ensemble

// Mesures d'un exercice dans une séance
function exPoint(h, e) {
  const sets = (e.sets || []).filter(s => (parseInt(s.reps) || 0) > 0);
  if (!sets.length) return null;
  const wts = sets.map(s => parseFloat(s.weight) || 0);
  const hasWeight = wts.some(w => w > 0);
  const totalReps = sets.reduce((a, s) => a + (parseInt(s.reps) || 0), 0);
  const volume    = hasWeight ? setsVolume(sets) : totalReps;
  const maxLoad   = hasWeight ? Math.max(...wts) : 0;
  const best1RM   = hasWeight ? Math.max(0, ...sets.map(s => calc1RM(s.weight, s.reps)).filter(v => v !== null)) : 0;
  const maxReps   = Math.max(...sets.map(s => parseInt(s.reps) || 0));
  return { date: h.date, hid: h.id, sets, hasWeight, totalReps, volume, maxLoad, best1RM, maxReps, best: bestSet(sets) };
}

// Tous les exercices de l'historique, tous programmes confondus, regroupés par exId
function exerciseIndex() {
  const map = new Map();
  const hist = (data.history || []).slice().sort((a, b) => a.date - b.date);
  hist.forEach(h => (h.exercises || []).forEach(e => {
    const key = exIdOf(e) || 'n:' + normName(e.name);
    const p = exPoint(h, e);
    if (!p) return;
    let it = map.get(key);
    if (!it) { it = { exId: key, name: e.name, points: [], cat: h.category, prog: h.programme || 'ppl' }; map.set(key, it); }
    it.name = e.name; it.cat = h.category; it.prog = h.programme || 'ppl';
    it.points.push(p);
  }));
  return map;
}

// Section d'un exercice : séance du programme actif, d'un autre programme, ou « Autres »
function exSection(it) {
  const match = (list) => (list || []).some(x => x.id === it.exId || (String(it.exId).startsWith('n:') && normName(x.name) === normName(it.name)));
  const pid = data.activeProgramme;
  for (const cat of sessionKeys(pid)) if (match(data.programmes[pid]?.exercises?.[cat])) return { key: pid + ':' + cat, cat, prog: pid };
  for (const [p, pd] of Object.entries(data.programmes)) {
    if (p === pid) continue;
    for (const cat of Object.keys(pd.exercises || {})) {
      if (match(pd.exercises[cat]) && (!isUserProg(p) || userSessions(p)?.[cat])) return { key: p + ':' + cat, cat, prog: p };
    }
  }
  return { key: 'other', cat: null, prog: null };
}

function isBodyweight(it) { return it.points.every(p => !p.hasWeight); }
function mainMetric(it, p) { return isBodyweight(it) ? p.maxReps : p.maxLoad; }

// Tendance : moyenne des 3 dernières séances contre les 3 premières
function trendPct(vals) {
  const n = vals.length;
  if (n < 2) return null;
  const k = Math.min(3, Math.floor(n / 2));
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const a = avg(vals.slice(0, k)), b = avg(vals.slice(-k));
  if (!(a > 0)) return null;
  return Math.round((b - a) / a * 100);
}
function pctTxt(p) { return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`; }

function sparkline(vals) {
  const W = 60, H = 24;
  if (vals.length < 2) return `<svg class="spark" width="${W}" height="${H}" aria-hidden="true"></svg>`;
  const min = Math.min(...vals), max = Math.max(...vals), r = (max - min) || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * (W - 4) + 2).toFixed(1)},${(H - 3 - (v - min) / r * (H - 6)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(',');
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.2" fill="currentColor"/></svg>`;
}

function weekStart(ts = Date.now()) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

// Exercices dont la charge max de la semaine dépasse le record d'avant la semaine
function weekRecordCount(idx) {
  const ws = weekStart();
  let records = 0;
  idx.forEach(it => {
    if (isBodyweight(it)) return;
    const before = it.points.filter(p => p.date < ws).map(p => p.maxLoad);
    const week   = it.points.filter(p => p.date >= ws).map(p => p.maxLoad);
    if (before.length && week.length && Math.max(...week) > Math.max(...before)) records++;
  });
  return records;
}

// Sections : séances du programme actif d'abord, puis autres programmes, puis Autres ;
// exercices dans l'ordre du programme à l'intérieur de chaque section
function statsSections(idx) {
  const sections = new Map();
  sessionKeys().forEach(c => sections.set(data.activeProgramme + ':' + c, { cat: c, prog: data.activeProgramme, items: [] }));
  idx.forEach(it => {
    const s = exSection(it);
    if (!sections.has(s.key)) sections.set(s.key, { cat: s.cat, prog: s.prog, items: [] });
    sections.get(s.key).items.push(it);
  });
  if (sections.has('other')) { const o = sections.get('other'); sections.delete('other'); sections.set('other', o); }
  sections.forEach(sec => {
    if (!sec.cat) return;
    const order = (data.programmes[sec.prog]?.exercises?.[sec.cat] || []).map(x => x.id);
    sec.items.sort((a, b) => (order.indexOf(a.exId) + 1 || 999) - (order.indexOf(b.exId) + 1 || 999));
  });
  return sections;
}

// Cellule d'un exercice : dernière performance, courbe et tendance
function statsRow(it) {
  const bw   = isBodyweight(it);
  const vals = it.points.map(p => mainMetric(it, p));
  const last = it.points[it.points.length - 1];
  const tp   = trendPct(vals);
  const cls  = tp > 0 ? 'txt-up' : tp < 0 ? 'txt-down' : 'txt-flat';
  return `
      <button class="cell cell--nav prow" data-action="open-stats-ex" data-ex="${esc(it.exId)}">
        <span class="cell__body">
          <span class="cell__title prow__name">${esc(it.name)}</span>
          <span class="cell__sub num">${bw ? `${last.maxReps} reps` : setTxt(last.best)}</span>
        </span>
        <span class="prow__spark ${cls}">${sparkline(vals.slice(-12))}</span>
        <span class="prow__trend num ${cls}">${tp === null ? '' : pctTxt(tp)}</span>
        ${icon('chevron.right', 16)}
      </button>`;
}

function statsSectionTitle(sec, key) {
  if (key === 'other') return 'Autres';
  const label = sessionMeta(sec.cat, sec.prog).label;
  return sec.prog === data.activeProgramme ? label : `${label} · ${progMeta(sec.prog).name}`;
}

function renderStats() {
  const idx  = exerciseIndex();
  const now  = new Date();
  const monthCount = (data.history || []).filter(h => { const d = new Date(h.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
  const streak  = computeStreak();
  const records = weekRecordCount(idx);

  let list = '';
  statsSections(idx).forEach((sec, key) => {
    if (sec.items.length) list += `<div class="group-title">${statsSectionTitle(sec, key)}</div><div class="group">${sec.items.map(statsRow).join('')}</div>`;
  });

  return `
    <div class="view stats view--grouped">
      ${navBar({ title: 'Progrès' })}
      <div class="scr">
        <div class="tiles">
          <div class="tile"><span class="tile__val num">${monthCount}</span><span class="tile__lbl">${monthCount > 1 ? 'séances' : 'séance'} ce mois-ci</span></div>
          <div class="tile"><span class="tile__val num">${streak}</span><span class="tile__lbl">${streak > 1 ? 'semaines' : 'semaine'} d'affilée</span></div>
          <div class="tile"><span class="tile__val num">${records}</span><span class="tile__lbl">${records > 1 ? 'records' : 'record'} cette semaine</span></div>
        </div>
        <div class="group">
          <button class="cell cell--nav" data-action="go-stats-overview">
            ${icon('chart', 22)}
            <span class="cell__body"><span class="cell__title">Vue d'ensemble</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
        ${idx.size ? list : `<div class="empty-note">Termine des séances pour voir ta progression ici.</div>`}
      </div>
    </div>`;
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'go-stats': (e, el) => {
    if (el.closest('.tabbar')) switchTab('progress'); else navigate('stats');
  },
  'stats-mode': (e, el) => {
    statsMode = el.dataset.mode; render();
  },
  'open-stats-ex': (e, el) => {
    navigate(makeRoute('stats-ex', el.dataset.ex));
  },
  'go-stats-overview': () => {
    ovMonth = null; navigate('stats-overview');
  },
  'info-1rm': async () => {
    await dialog({ title: '1RM estimé', message: 'Charge maximale estimée pour une seule répétition, calculée avec la formule d\'Epley : poids × (1 + reps / 30). Elle n\'est fiable que jusqu\'à 12 reps : au-delà, la courbe reprend la charge max de la séance.',
      actions: [{ label: 'OK', value: true, style: 'preferred' }] });
  },
});
