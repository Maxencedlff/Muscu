// ═══════════════════════════════════════════════════════════
//  Progrès : index des exercices tiré de l'historique
// ═══════════════════════════════════════════════════════════
'use strict';

// Maquettes de l'écran Progrès (refonte visuelle, 15/11) : une seule est gardée après le choix de Maxence.
//   'A' : Corps en tête (silhouette de la période en grand, chiffres clés en tuiles, records en cartes illustrées)
//   'B' : Records d'abord (records et progrès sur 3 mois en cartes, courbe du volume par semaine, puis le corps)
//   'C' : Par muscle (chaque groupe en carte illustrée : force gagnée en 3 mois et séries de la semaine, à la Fitbod)
const PROGRES_VARIANTE = 'A';

// Courbe d'un exercice : « Charge max » à l'ouverture depuis une liste, la grandeur de la tendance de la liste (panel Apple
// du 08/11 : la liste disait +13 % de charge max, la fiche s'ouvrait sur le volume à +35 %)
let statsMode = 'charge';   // 'charge' | 'volume' | '1rm' | 'effort'
let ovMonth   = null; // { y, m } du calendrier de la vue d'ensemble

// Mesures d'un exercice dans une séance
function exPoint(h, e) {
  const sets = workSets(e.sets).filter(s => (parseInt(s.reps) || 0) > 0);   // sans l'échauffement (js/data/warmup.js)
  if (!sets.length) return null;
  const rpe  = meanRpe(sets);   // effort moyen noté (RIR, js/data/rir.js), null sans note
  const wts = sets.map(s => parseFloat(s.weight) || 0);
  // Durée et cardio se suivent comme le poids du corps : sur le champ reps (secondes, minutes)
  // Aide sans poids du corps : la charge saisie est une aide, suivie en reps (sinon un progrès paraîtrait une baisse)
  let hasWeight = measureOf(e) === 'reps' && !isAssisted(e) && wts.some(w => w > 0);
  // Poids du corps : seulement s'il est connu aujourd'hui, pour que toutes les séances d'un exercice
  // soient comptées dans la même unité (kg effectifs), jamais un mélange de reps et de kg
  const bodyKg = bodyShare(e) && currentBodyKg() ? entryBodyKg(h) : null;
  if (bodyKg) {
    const loads = sets.map(s => effectiveLoad(s, e, bodyKg));
    const volume = exVolume(e, sets, bodyKg);
    const best1RM = Math.max(0, ...sets.map((s, i) => calc1RM(loads[i], s.reps)).filter(v => v !== null));
    return { date: h.date, hid: h.id, sets, hasWeight: true, totalReps: volumeSets(sets).reduce((a, s) => a + (parseInt(s.reps) || 0), 0),
      volume, maxLoad: Math.max(...loads), best1RM, maxReps: Math.max(...sets.map(s => parseInt(s.reps) || 0)), best: bestSet(sets, e), bodyKg, rpe };
  }
  // Reps des sous-séries d'un drop set comprises, comme le volume (js/data/intensif.js)
  const totalReps = volumeSets(sets).reduce((a, s) => a + (parseInt(s.reps) || 0), 0);
  const volume    = hasWeight ? setsVolume(sets) : totalReps;
  const maxLoad   = hasWeight ? Math.max(...wts) : 0;
  const best1RM   = hasWeight ? Math.max(0, ...sets.map(s => calc1RM(s.weight, s.reps)).filter(v => v !== null)) : 0;
  const maxReps   = Math.max(...sets.map(s => parseInt(s.reps) || 0));
  return { date: h.date, hid: h.id, sets, hasWeight, totalReps, volume, maxLoad, best1RM, maxReps, best: bestSet(sets), rpe, ...cardioPoint(e, sets) };
}

// « 5,2 km · 27 min · 5:12 /km » : une séance de cardio en une ligne (séries additionnées)
function cardioPointTxt(p, kind) {
  return [p.dist > 0 ? `${fmtNum(p.dist)} km` : '', `${p.totalReps} min`, fmtPace(p.pace, kind)].filter(Boolean).join(' · ');
}

// Cardio : distance totale (km) et allure moyenne de la séance (minutes et km des séries qui ont les deux)
function cardioPoint(e, sets) {
  if (measureOf(e) !== 'cardio') return {};
  const dist = sets.reduce((a, s) => a + (parseFloat(s.dist) || 0), 0);
  const timed = sets.filter(s => parseFloat(s.dist) > 0);
  const pace = cardioPace(dist, timed.reduce((a, s) => a + setMinutes(s), 0), paceKind(e));
  return { dist: Math.round(dist * 100) / 100, pace };
}

// Tous les exercices de l'historique, tous programmes confondus, regroupés par exId
function exerciseIndex() {
  const map = new Map();
  const hist = (data.history || []).slice().sort((a, b) => a.date - b.date);
  hist.forEach(h => (h.exercises || []).forEach(e => {
    const key = exKey(e);
    const p = exPoint(h, e);
    if (!p) return;
    let it = map.get(key);
    if (!it) { it = { exId: key, name: e.name, points: [], cat: h.category, prog: entryProg(h) }; map.set(key, it); }
    it.name = e.name; it.measure = measureOf(e); it.unit = MEASURES[it.measure].unit; it.cat = h.category; it.prog = entryProg(h);
    it.points.push(p);
  }));
  return map;
}

// Section d'un exercice : séance du programme actif, d'un autre programme, ou « Autres »
function exSection(it) {
  const match = (list) => (list || []).some(x => x.id === it.exId || (String(it.exId).startsWith('n:') && sameExerciseName(x.name, it.name)));
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

// Tendance « +13 % depuis mai » : du premier au dernier point de la courbe affichée, ce que l'œil lit (vague 3-t4 :
// une moyenne des 3 dernières séances contre les 3 premières ne correspondait pas aux points montrés)
function trendPct(vals) {
  const n = vals.length;
  if (n < 2 || !(vals[0] > 0)) return null;
  return Math.round((vals[n - 1] - vals[0]) / vals[0] * 100);
}
// Position horizontale de chaque point d'une courbe, de 0 à 1, selon sa date : deux séances à trois semaines d'écart
// sont plus loin l'une de l'autre que deux séances à deux jours (panel Apple du 08/11 : points espacés selon leur
// rang alors que l'axe porte des dates). Un seul point : au milieu ; toutes les dates égales : selon le rang.
function chartXFracs(dates) {
  const n = dates.length;
  if (n === 1) return [0.5];
  const t0 = dates[0], span = dates[n - 1] - t0;
  return dates.map((t, i) => (span > 0 ? Math.min(1, Math.max(0, (t - t0) / span)) : i / (n - 1)));
}
// Graduations rondes d'un axe (pas de 1, 2, 2,5 ou 5 × 10^k ; 2 à 4 graduations), bornes arrondies vers l'extérieur :
// « 20 / 25 / 30 » plutôt que « 20,5 / 24,6 / 28,6 » (panel Apple de la vague 3)
function chartNiceTicks(lo, hi) {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / 3, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
  const out = [];
  for (let v = a; v <= b + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}
// « depuis mai », « depuis mai 2025 » : début de la période d'une tendance
function sinceTxt(ts, now = Date.now()) {
  const d = new Date(ts), opts = { month: 'long' };
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric';
  return `depuis ${d.toLocaleDateString('fr-FR', opts)}`;
}
function pctTxt(p) { return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}\u00a0%`; }

// dates facultatives : points placés selon la date, comme la grande courbe de la fiche (chartXFracs), pour que les deux
// tracés aient la même forme (panel t6 : la mini-courbe les plaçait au rang)
function sparkline(vals, dates = null) {
  const W = 60, H = 24;
  if (vals.length < 2) return `<svg class="spark" width="${W}" height="${H}" aria-hidden="true"></svg>`;
  const min = Math.min(...vals), max = Math.max(...vals), r = (max - min) || 1;
  const fx = dates && dates.length === vals.length ? chartXFracs(dates) : vals.map((_, i) => i / (vals.length - 1));
  const pts = vals.map((v, i) => `${(fx[i] * (W - 4) + 2).toFixed(1)},${(H - 3 - (v - min) / r * (H - 6)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(',');
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.2" fill="currentColor"/></svg>`;
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

// Cellule d'un exercice : dernière performance, courbe et tendance, sur toutes ses séances comme la courbe « Charge max »
// de sa fiche (même chiffre aux deux endroits ; la mini-courbe ne montrait que les 12 dernières)
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
          <span class="cell__sub num">${it.measure === 'cardio' ? cardioPointTxt(last, paceKind(it)) : bw ? `${last.maxReps} ${it.unit || 'reps'}` : setTxt(last.best, { name: it.name })}</span>
        </span>
        <span class="prow__spark ${cls}">${sparkline(vals, it.points.map(p => p.date))}</span>
        <span class="prow__trend num ${cls}">${tp === null ? '' : pctTxt(tp)}</span>
        ${icon('chevron.right', 16)}
      </button>`;
}

function statsSectionTitle(sec, key) {
  if (key === 'other') return 'Autres';
  const label = sessionMeta(sec.cat, sec.prog).label;
  return sec.prog === data.activeProgramme || sec.prog === FREE ? label : `${label} · ${esc(progMeta(sec.prog).name)}`;
}

// Carte « Derniers records » en tête de Progrès : les 3 plus récents (lignes : recordRowsHtml, js/ui/medal.js)
function statsRecordsHtml() {
  const recs = recentRecords();
  return recs.length ? `<div class="group-title">Derniers records</div><div class="group stats-records">${recordRowsHtml(recs)}</div>` : '';
}

// Progrès sans séance : l'invitation et le geste qui la suit (Entraînement), plutôt qu'un écran éteint à zéro
function statsStartHtml() {
  return `<div class="group stats-start">
          <div class="cell stats-start__msg">${icon('chart', 22)}<p class="stats-empty">Fais ta première séance pour voir tes muscles travaillés ici.</p></div>
          <button class="cell cell--action" data-action="go-home"><span class="cell__title">Démarrer une séance</span></button>
        </div>`;
}

// Séances des 4 dernières semaines du calendrier, sur leur propre ligne sous les chiffres du mois et de l'année (panel
// vague 4 : posées sous « ce mois-ci », elles semblaient le détailler), la semaine en cours à droite
function statsWeekBars() {
  if (!data.history?.length) return '';
  const counts = weekCounts(data.history.map(h => new Date(h.date).getTime()));
  const bars = counts ? weekBarsSvg(counts, '') : '';
  return bars ? `<div class="cell progress-week__row stats-weeks">
            <span class="cell__body"><span class="cell__title">Séances par semaine</span><span class="cell__sub">4 dernières, du lundi au dimanche</span></span>
            ${bars}
          </div>` : '';
}

// ═══════════════════════════════════════════════════════════
//  Maquettes A, B, C (PROGRES_VARIANTE) : briques visuelles
//  Images toujours décoratives (alt vide, aria-hidden) : VoiceOver lit le texte et l'intitulé complet du bouton.
// ═══════════════════════════════════════════════════════════
const PROG_WINDOW_DAYS = 84;   // « 3 mois » : 12 semaines

// Vignette 3D du muscle principal d'un exercice ou d'un groupe (img/muscles/<id>.webp, celle de la Bibliothèque) ;
// fichier absent : js/ui/vivant.js la marque data-missing et la cache
function progThumbHtml(id, cls = '') {
  return id ? `<img class="mgc__img ${cls}" src="img/muscles/${id}.webp" alt="" aria-hidden="true" width="600" height="400" decoding="async">` : '';
}
function exMainMuscle(name) {
  const id = exerciseMuscles({ name }).primary?.[0];
  return isMuscleId(id) ? id : null;
}
function muscleGroupOf(id) { return MUSCLE_GROUPS.find(g => g.muscles.includes(id)) || null; }
function idxByName(idx, name) {
  for (const it of idx.values()) if (sameExerciseName(it.name, name)) return it;
  return null;
}

// Progrès d'un exercice sur la fenêtre : première et dernière séance des 12 semaines (la grandeur de sa liste :
// charge max, ou reps au poids du corps). null sans deux séances, ou si la dernière date de plus de 3 semaines
function exWindowProgress(it, now = Date.now()) {
  if (it.measure === 'cardio') return null;
  const pts = it.points.filter(p => p.date >= now - PROG_WINDOW_DAYS * 86_400_000);
  if (pts.length < 2 || pts.at(-1).date < now - 21 * 86_400_000) return null;
  const bw = isBodyweight(it), a = mainMetric(it, pts[0]), b = mainMetric(it, pts.at(-1));
  if (!(a > 0)) return null;
  const val = v => (bw ? plural(v, 'rep', 'reps') : `${fmtW(v)} ${unitLbl()}`);
  const d = Math.round((b - a) * 100) / 100;
  return { it, bw, from: pts[0].date, before: val(a), after: val(b), pct: Math.round((b - a) / a * 100),
    gain: d > 0 ? (bw ? plural(d, 'rep', 'reps') : `${fmtW(d)} ${unitLbl()}`) : '' };
}

// ── A : records récents en cartes illustrées (liste iOS, vignette du muscle principal à droite) ──
function progRecordCardsHtml(idx) {
  const recs = recentRecords(data.history, 3);
  if (!recs.length) return '';
  const rows = recs.map(({ ex, date, r }) => {
    const it = idxByName(idx, ex), gain = recordGainTxt(r);
    const before = r.before != null ? notedValueTxt(r, 'before') : '';
    const label = `${ex}, record le ${fmtDate(date)} : ${notedValueTxt(r)}${before ? `, avant ${before}` : ''}${gain ? `, ${gain} de plus` : ''}`;
    const tag = it ? 'button' : 'div';
    return `
      <${tag} class="cell mgc prec${it ? ' cell--nav' : ''}"${it ? ` data-action="open-stats-ex" data-ex="${esc(it.exId)}"` : ''} aria-label="${esc(label)}">
        <span class="mgc__text" aria-hidden="true">
          <span class="prec__date">${medalSvg(16)}${esc(fmtDate(date))}</span>
          <span class="mgc__title prec__name">${esc(ex)}</span>
          <span class="prec__val num">${esc(notedValueTxt(r))}</span>
          <span class="mgc__sub num">${before ? `avant ${esc(before)}` : ''}${gain ? `<span class="txt-up">${before ? ' · ' : ''}+${esc(gain)}</span>` : ''}</span>
        </span>
        ${progThumbHtml(exMainMuscle(ex))}
        ${it ? icon('chevron.right', 16) : ''}
      </${tag}>`;
  }).join('');
  return `<div class="group-title">Derniers records</div><div class="group mgcs precs">${rows}</div>`;
}

// ── A : chiffres clés en tuiles (2 × 2), puis les semaines et les écrans liés ──
function progTilesHtml(idx, { monthCount, yearCount }) {
  const ws = weekStart();
  // Records notés de la semaine (charge, reps, temps…), un par exercice : « Derniers records » juste dessous dit pareil
  const weekRecs = recentRecords(data.history, 50).filter(x => x.date >= ws).length;
  let vol = 0;
  idx.forEach(it => it.points.forEach(p => { if (p.date >= ws && p.hasWeight && it.measure !== 'cardio') vol += p.volume; }));
  const tile = (val, lbl) => `<div class="ptile"><span class="ptile__val num">${val}</span><span class="ptile__lbl">${lbl}</span></div>`;
  return `
    <div class="group-title">Chiffres clés</div>
    <div class="ptiles">
      ${tile(monthCount, `${monthCount > 1 ? 'séances' : 'séance'} ce mois-ci`)}
      ${tile(yearCount, `${yearCount > 1 ? 'séances' : 'séance'} cette année`)}
      ${tile(weekRecs, `${weekRecs > 1 ? 'records' : 'record'} cette semaine`)}
      ${tile(fmtVolume(vol), 'soulevés cette semaine')}
    </div>`;
}

// Semaines, Vue d'ensemble et Récaps : les mêmes rangées partout (withPair : les deux chiffres du mois et de l'année)
function statsNavGroupHtml(records, withPair = null) {
  return `<div class="group stats-head">
          ${withPair ? `<div class="stat-pair">
            <div class="stat-pair__item"><span class="stat-pair__val num">${withPair.monthCount}</span><span class="stat-pair__lbl">${withPair.monthCount > 1 ? 'séances' : 'séance'} ce mois-ci</span></div>
            <div class="stat-pair__item"><span class="stat-pair__val num">${withPair.yearCount}</span><span class="stat-pair__lbl">${withPair.yearCount > 1 ? 'séances' : 'séance'} cette année</span></div>
          </div>` : ''}
          ${statsWeekBars()}
          <button class="cell cell--nav" data-action="go-stats-overview">
            ${icon('chart', 22)}
            <span class="cell__body"><span class="cell__title">Vue d'ensemble</span>${records ? `<span class="cell__sub">${plural(records, 'record', 'records')} cette semaine</span>` : ''}</span>
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell cell--nav" data-action="go-recaps">
            ${icon('calendar', 22)}
            <span class="cell__body"><span class="cell__title">Récaps</span><span class="cell__sub">Ta semaine, ton mois, ton année</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

// ── B : records et progrès en cartes illustrées qui défilent de côté ──
// Records récents d'abord (médaille, avant → maintenant), puis les exercices qui ont le plus progressé en 3 mois
function progProgressCardsHtml(idx) {
  const cards = [], seen = new Set();
  recentRecords(data.history, 3).forEach(({ ex, date, r }) => {
    if (r.before == null) return;
    const it = idxByName(idx, ex);
    seen.add(normName(ex));
    cards.push({ it, name: ex, muscle: exMainMuscle(ex), top: `${medalSvg(14)}Record · ${fmtDate(date)}`, topTxt: `Record le ${fmtDate(date)}`,
      before: notedValueTxt(r, 'before'), after: notedValueTxt(r), gain: recordGainTxt(r) });
  });
  const prog = [...idx.values()].map(it => exWindowProgress(it)).filter(p => p && p.pct > 0 && !seen.has(normName(p.it.name)))
    .sort((a, b) => b.pct - a.pct).slice(0, 6 - cards.length);
  prog.forEach(p => cards.push({ it: p.it, name: p.it.name, muscle: exMainMuscle(p.it.name), top: esc(sinceTxt(p.from)), topTxt: sinceTxt(p.from),
    before: p.before, after: p.after, gain: p.gain, pct: p.pct }));
  if (!cards.length) return '';
  const html = cards.map(c => {
    const label = `${c.name}, ${c.topTxt} : ${c.before} puis ${c.after}${c.gain ? `, ${c.gain} de plus` : ''}`;
    const tag = c.it ? 'button' : 'div';
    return `
      <${tag} class="pcard"${c.it ? ` data-action="open-stats-ex" data-ex="${esc(c.it.exId)}"` : ''} aria-label="${esc(label)}">
        <span class="pcard__art">${progThumbHtml(c.muscle, 'pcard__img')}</span>
        <span class="pcard__body" aria-hidden="true">
          <span class="pcard__top">${c.top}</span>
          <span class="pcard__name">${esc(c.name)}</span>
          <span class="pcard__vals num"><span class="pcard__before">${esc(c.before)}</span> <span class="pcard__arrow">→</span> <span class="pcard__after">${esc(c.after)}</span></span>
          ${c.gain ? `<span class="pcard__gain num txt-up">+${esc(c.gain)}${c.pct ? ` · ${pctTxt(c.pct)}` : ''}</span>` : ''}
        </span>
      </${tag}>`;
  }).join('');
  return `<div class="group-title">Tes progrès</div>
    <div class="pcards" role="list" aria-label="Records et progrès récents">${html.replaceAll('class="pcard"', 'role="listitem" class="pcard"')}</div>`;
}

// ── B : courbe d'ensemble, volume soulevé par semaine (12 semaines complètes), tracée à l'ouverture ──
function weeklyVolumes(idx, weeks = 12, now = Date.now()) {
  const starts = Array.from({ length: weeks + 1 }, (_, k) => weekStartMs(now, weeks - k));   // la dernière : semaine en cours
  const vols = new Array(weeks).fill(0);
  idx.forEach(it => {
    if (it.measure === 'cardio') return;
    it.points.forEach(p => {
      if (!p.hasWeight) return;
      for (let k = 0; k < weeks; k++) if (p.date >= starts[k] && p.date < starts[k + 1]) { vols[k] += p.volume; break; }
    });
  });
  return { vols, starts };
}
// Une barre par semaine (ce qui a été fait) et la tendance par-dessus (moyenne des 4 dernières semaines, en orange) :
// les semaines courtes ou de vacances ne cachent plus la progression de fond
function progOverallChartHtml(idx) {
  const { vols, starts } = weeklyVolumes(idx);
  if (vols.filter(v => v > 0).length < 2) return '';
  const W = 320, H = 110, top = 8, n = vols.length, max = Math.max(...vols) || 1;
  const slot = W / n, bw = Math.min(16, slot * 0.55);
  const cx = i => slot * (i + 0.5), y = v => H - v / max * (H - top);
  const trend = vols.map((_, i) => { const w = vols.slice(Math.max(0, i - 3), i + 1); return w.reduce((a, v) => a + v, 0) / w.length; });
  const bars = vols.map((v, i) => `<rect class="pchart__bar${i === n - 1 ? ' pchart__bar--last' : ''}" x="${(cx(i) - bw / 2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, H - y(v)).toFixed(1)}" rx="2"/>`).join('');
  const pts = trend.map((v, i) => `${cx(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const first = trend[3], last = trend.at(-1);
  const tp = first > 0 ? Math.round((last - first) / first * 100) : null;
  const cls = tp > 0 ? 'txt-up' : 'txt-flat';
  const d0 = new Date(starts[0]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const spoken = `Volume soulevé par semaine, 12 dernières semaines complètes : ${vols.map(v => fmtVolume(v)).join(', ')}.${tp === null ? '' : ` Tendance sur 4 semaines : ${pctTxt(tp)}.`}`;
  return `
    <div class="group-title">Volume par semaine</div>
    <div class="group pchart">
      <div class="pchart__head">
        <span class="pchart__val num">${fmtVolume(Math.round(last))}</span>
        <span class="pchart__lbl">par semaine en moyenne${tp === null ? '' : `, <span class="${cls} num">${pctTxt(tp)}</span> depuis ${d0}`}</span>
      </div>
      <svg class="pchart__svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spoken)}">
        ${bars}
        <polyline class="pchart__line" pathLength="1" points="${pts}" fill="none"/>
      </svg>
      <div class="pchart__axis" aria-hidden="true"><span>${d0}</span><span>semaine dernière</span></div>
      <div class="pchart__legend" aria-hidden="true"><i class="pchart__key"></i>Moyenne sur 4 semaines</div>
    </div>`;
}

// ── C : chaque groupe de muscles en carte illustrée : force gagnée en 3 mois, séries par semaine ──
// Force d'un groupe : moyenne des progrès (exWindowProgress) des exercices dont il est le muscle principal
function groupProgress(idx, load) {
  const by = new Map(MUSCLE_GROUPS.map(g => [g.id, []]));
  idx.forEach(it => {
    const g = muscleGroupOf(exMainMuscle(it.name)), p = g && exWindowProgress(it);
    if (p) by.get(g.id).push(p.pct);
  });
  return MUSCLE_GROUPS.map(g => {
    const pcts = by.get(g.id);
    const perWeek = Math.round(g.muscles.reduce((a, m) => a + (load.perWeek[m] || 0), 0));
    return { g, n: pcts.length, pct: pcts.length ? Math.round(pcts.reduce((a, v) => a + v, 0) / pcts.length) : null, perWeek };
  });
}
function progGroupCardsHtml(idx) {
  const load = muscleLoad(muscleSpan);
  const rows = groupProgress(idx, load).map(({ g, n, pct, perWeek }) => {
    const cls = pct > 0 ? 'txt-up' : 'txt-flat';   // une baisse en gris : le rouge, ici, c'est le muscle
    const trend = pct === null ? 'Pas assez de séances' : pct === 0 ? 'Stable' : `${pctTxt(pct)} de force`;
    const sets = `${plural(perWeek, 'série', 'séries')} par semaine`;
    const label = `${g.label} : ${trend}${n ? ` sur ${plural(n, 'exercice', 'exercices')}` : ''} en 3 mois, ${sets}`;
    return `
      <button class="cell cell--nav mgc pgrp" data-action="go-stats-muscles" data-muscle="${g.muscles[0]}" aria-label="${esc(label)}">
        <span class="mgc__text" aria-hidden="true">
          <span class="mgc__title">${esc(g.label)}</span>
          <span class="pgrp__trend num ${pct === null ? '' : cls}">${trend}</span>
          <span class="mgc__sub num">${sets}</span>
        </span>
        ${progThumbHtml(g.id)}
        ${icon('chevron.right', 16)}
      </button>`;
  }).join('');
  return `<div class="group-title">Tes muscles en 3 mois</div><div class="group mgcs pgrps">${rows}</div>
    <div class="group-foot">Force : charge max de chaque exercice, de ta première à ta dernière séance des 12 semaines. Séries ${periodTxt()}, en moyenne par semaine.</div>`;
}

function renderStats() {
  const idx  = exerciseIndex();
  const now  = new Date();
  const monthCount = (data.history || []).filter(h => { const d = new Date(h.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
  const yearCount = historyTotals().year;
  const records = weekRecordCount(idx);
  const has = !!data.history?.length;

  let list = '';
  statsSections(idx).forEach((sec, key) => {
    if (sec.items.length) list += `<div class="group-title">${statsSectionTitle(sec, key)}</div><div class="group">${sec.items.map(statsRow).join('')}</div>`;
  });
  const tail = `${renderWeightGroup()}${renderBodyMeasuresGroup()}
        ${idx.size ? list : has ? `<div class="empty-note">Termine des séances pour voir ta progression ici.</div>` : ''}`;
  const pair = { monthCount, yearCount };

  let top;
  if (!has) top = `${statsStartHtml()}${statsNavGroupHtml(records, pair)}${renderMuscleCard()}`;
  else if (PROGRES_VARIANTE === 'A') top = `${renderMuscleCard({ hero: true })}${progTilesHtml(idx, { monthCount, yearCount })}${statsNavGroupHtml(records)}${progRecordCardsHtml(idx)}`;
  else if (PROGRES_VARIANTE === 'B') top = `${progProgressCardsHtml(idx) || statsRecordsHtml()}${progOverallChartHtml(idx)}${statsNavGroupHtml(records, pair)}${renderMuscleCard()}`;
  else if (PROGRES_VARIANTE === 'C') top = `${progGroupCardsHtml(idx)}${statsNavGroupHtml(records, pair)}${statsRecordsHtml()}${renderMuscleCard()}`;
  else top = `${statsRecordsHtml()}${statsNavGroupHtml(records, pair)}${renderMuscleCard()}`;

  return `
    <div class="view stats view--grouped progres-${PROGRES_VARIANTE.toLowerCase()}">
      ${navBar({ title: 'Progrès' })}
      <div class="scr">
        ${top}
        ${tail}
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
  'stats-cardio-mode': (e, el) => {
    cardioMode = el.dataset.mode; render();
  },
  'open-stats-ex': (e, el) => {
    statsMode = 'charge';
    navigate(makeRoute('stats-ex', el.dataset.ex));
  },
  'go-stats-overview': () => {
    ovMonth = null; navigate('stats-overview');
  },
  'info-1rm': async () => {
    await dialog({ title: '1RM estimé', message: 'Charge estimée pour une seule rep. Fiable jusqu\'à 12 reps.',
      actions: [{ label: 'OK', value: true, style: 'preferred' }] });
  },
});
