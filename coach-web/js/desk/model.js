// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : logique pure du tableau de bord et de la fiche « Semaines » (docs/COACH_WEB.md)
//
//  Aucun accès au DOM ni au serveur : des données nettoyées par les fonctions de js/data/ (cleanCoachState,
//  cleanCoachProgress, cleanCoachPlans, cleanChatThreads, cleanDietOverview, cleanCoachWeights, cleanCoachMeasures,
//  cleanCoachDiet, cleanCoachSessionRow) entrent, des lignes prêtes à afficher sortent. Les règles viennent de l'app,
//  jamais recopiées : signal d'un élève (studentProgress), statut d'un jour de diète (dietShareStatus), « À relancer »
//  (dietShareWarn), volume (reviewVolume), phase (planCurrent, phaseProgress). Testé par tests/unit/coach-web.mjs.
//  Jours du calendrier en heure locale (localISO, daysAgo), jamais des tranches de 24 h : l'heure d'été ne décale rien.
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_WEEKS_SHOWN = 8;    // semaines affichées d'abord dans la fiche
const DESK_WEEKS_MAX = 12;     // « Afficher les semaines précédentes » : jusqu'à 12 (84 jours de diète gardés sur 90)
const DESK_CHART_DAYS = 90;    // courbe du poids : 90 jours
const DESK_TODO_SHOWN = 2;     // lignes « À faire » d'un élève dans la liste

// ── Jours et semaines ───────────────────────────────────────

// Minuit local du jour de ts, décalé de `days` jours du calendrier (setDate : 23 ou 25 h au changement d'heure)
function deskDayStart(ts, days = 0) { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d.getTime(); }
// Lundi 0 h de la semaine de ts (semaine du lundi au dimanche, comme en France)
function deskWeekStart(ts) { const d = new Date(ts); const back = (d.getDay() + 6) % 7; return deskDayStart(ts, -back); }
// Numéro de semaine ISO 8601 (« S48 ») : la semaine du jeudi
function deskIsoWeek(ts) {
  const d = new Date(ts), t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}
// Les n derniers jours (AAAA-MM-JJ), du plus ancien à aujourd'hui
function deskLastDays(n, now) { return Array.from({ length: n }, (_, i) => localISO(deskDayStart(now, i - n + 1))); }
const DESK_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
// « 23–29 nov. », « 26 oct.–1 nov. », « 28 déc. 2026–3 janv. 2027 »
function deskWeekRange(start) {
  const a = new Date(start), b = new Date(deskDayStart(start, 6));
  const y = a.getFullYear() !== b.getFullYear();
  const left = `${a.getDate()}${a.getMonth() !== b.getMonth() || y ? ` ${DESK_MONTHS[a.getMonth()]}${y ? ` ${a.getFullYear()}` : ''}` : ''}`;
  return `${left}–${b.getDate()} ${DESK_MONTHS[b.getMonth()]}${y ? ` ${b.getFullYear()}` : ''}`;
}
const DESK_WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
// « il y a 54 min », « il y a 2 h », « hier, 21 h 40 », « dim. 15 nov. » ; null sans date
function deskAgo(ts, now) {
  if (!Number.isFinite(ts)) return null;
  const min = Math.floor((now - ts) / 60_000), days = daysAgo(ts, now);
  const hm = () => { const d = new Date(ts); return `${d.getHours()} h ${pad(d.getMinutes())}`; };
  if (days === 0) return min < 1 ? 'à l\'instant' : min < 60 ? `il y a ${min} min` : `il y a ${Math.floor(min / 60)} h`;
  if (days === 1) return `hier, ${hm()}`;
  const d = new Date(ts);
  return `${DESK_WEEKDAYS[d.getDay()].slice(0, 3)}. ${d.getDate()} ${DESK_MONTHS[d.getMonth()]}`;
}

// ── Tableau de bord ─────────────────────────────────────────

// Phase en cours (« Sèche · sem. 5 sur 8 »), sinon la prochaine (« Force dans 6 jours »), sinon « Aucune phase »
function deskPhaseLine(phases, now) {
  if (!Array.isArray(phases)) return null;   // serveur sans planification : rien d'inventé
  const today = localISO(now), cur = planCurrent(phases, today);
  if (cur) { const g = phaseProgress(cur, today); return { text: `${phaseTitle(cur)} · sem. ${g.week} sur ${cur.weeks}`, short: phaseTitle(cur), phase: cur, week: g.week }; }
  const next = planNext(phases, today);
  if (next) return { text: `${phaseTitle(next)} : ${phaseStatusText(next, today).toLowerCase()}`, short: phaseTitle(next), phase: next, week: 0 };
  return { text: 'Aucune phase', short: '', phase: null, week: 0 };
}

// Séances de chaque jour des 7 derniers (du plus ancien à aujourd'hui), null sans les faits de coach_progress
function deskSessionDots(facts, now) {
  if (!facts) return null;
  const days = deskLastDays(7, now), count = Object.fromEntries(days.map(d => [d, 0]));
  for (const s of facts.sessions) { const k = localISO(s.at); if (k in count) count[k]++; }
  return days.map(d => ({ day: d, n: count[d] }));
}
// Diète de chaque jour des 7 derniers : 'ok' | 'part' | 'off' | 'none' | 'today' ; null si l'élève ne la partage pas
function deskDietDots(ov, now) {
  if (!ov) return null;
  const today = localISO(now);
  return deskLastDays(7, now).map(d => ({ day: d, status: dietShareStatus(ov.days[d] || null, { today: d === today }) }));
}

// Ce qu'il y a à faire pour un élève, du plus urgent : { kind, tone, text, n? }.
// act = demande une action du coach (la ligne va dans « À traiter ») ; les autres informent.
function deskTodo({ st, pr, unread, dietWarn, noprog, ckToAnswer = 0 }) {
  const out = [];
  if (pr.tone === 'warn') out.push({ kind: pr.kind, tone: 'warn', text: pr.text, act: true });
  // Bilan reçu, pas encore répondu (coach_checkins_overview, js/desk/checkins-model.js)
  if (ckToAnswer > 0) out.push({ kind: 'checkin', tone: 'warn', n: ckToAnswer, text: ckToAnswer > 1 ? `${ckToAnswer} bilans reçus, à répondre` : 'Bilan reçu, à répondre', act: true });
  if (dietWarn) out.push({ kind: 'diet', tone: 'warn', text: DIET_SHARE_WARN_TEXT, act: true });
  if (unread > 0) out.push({ kind: 'unread', tone: 'badge', n: unread, text: unread > 1 ? 'messages non lus' : 'message non lu', act: true });
  if (noprog) out.push({ kind: 'noprog', tone: 'warn', text: 'Sans programme', act: true });
  if (st.new_sessions > 0) out.push({ kind: 'fresh', tone: 'dot', text: plural(st.new_sessions, 'nouvelle séance', 'nouvelles séances') });
  if (pr.kind === 'records') {
    const r = pr.records[0], n = pr.records.length;
    out.push({ kind: 'records', tone: 'up', text: !r ? pr.text : n === 1 ? `Record : ${r.ex}` : `${n} records : ${r.ex}, …` });
  }
  if (!out.length) out.push({ kind: 'none', tone: 'muted', text: pr.kind === 'regular' || pr.kind === 'stable' ? pr.text : 'Rien à traiter' });
  return out;
}
// Rang d'urgence dans « À traiter » (plus petit = plus urgent) : sans séance depuis longtemps, en baisse, bilan reçu
// à répondre, diète, messages, sans programme ; puis le reste
function deskUrgency(row) {
  const t = row.todo;
  if (t.some(x => x.kind === 'inactive' || x.kind === 'never')) return 0;
  if (t.some(x => x.kind === 'fewer')) return 1;
  if (row.ckToAnswer) return 1.5;
  if (row.dietWarn) return 2;
  if (row.unread) return 3;
  if (row.noprog) return 4;
  if (row.st.new_sessions) return 5;
  if (row.pr.kind === 'records') return 6;
  return 9;
}

// Lignes du tableau de bord, triées par urgence puis par dernière séance puis par nom.
// src : { state (cleanCoachState), facts (cleanCoachProgress | null), plans (cleanCoachPlans | null),
//         threads (cleanChatThreads | null), dietOv (cleanDietOverview | null : serveur sans le suivi),
//         ckOv (deskCkOverview | null : serveur sans les bilans), now }
function deskStudentRows({ state, facts = null, plans = null, threads = null, dietOv = null, ckOv = null, now }) {
  const ckCounts = deskCkAnswerCounts(ckOv);
  const rows = (state?.students || []).map(st => {
    const f = facts ? facts[st.user_id] || null : null;
    const phases = plans ? plans[st.user_id] || [] : null;
    const pr = studentProgress(st, { facts: f, phases, now });
    const unread = threads?.students?.[st.user_id]?.unread || 0;
    const ov = dietOv ? dietOv[st.user_id] || null : null;
    const dietWarn = !!ov && dietShareWarn(ov, now);
    const noprog = coachStudentIn('noprog', st, pr);
    const lastAt = Math.max(st.last_session?.done_at ?? -Infinity, f?.sessions?.[0]?.at ?? -Infinity);
    const row = { id: st.user_id, name: personName(st), st, pr, unread, dietWarn, noprog, lastAt: Number.isFinite(lastAt) ? lastAt : null,
      phase: deskPhaseLine(phases, now), sesDots: deskSessionDots(f, now), n7: pr.n7, dietDots: deskDietDots(ov, now),
      dietShared: dietOv ? !!ov : null, dietOk7: ov ? dietShareWeekCount(ov, now) : null, ckToAnswer: ckCounts[st.user_id] || 0 };
    row.todo = deskTodo(row);
    row.act = row.todo.some(x => x.act);
    row.urgency = deskUrgency(row);
    return row;
  });
  return rows.sort((a, b) => (a.urgency - b.urgency)
    || (a.urgency <= 1 ? (b.pr.daysSince ?? 0) - (a.pr.daysSince ?? 0) : 0)
    || ((b.lastAt ?? -Infinity) - (a.lastAt ?? -Infinity))
    || a.name.localeCompare(b.name, 'fr'));
}

// Segments : À traiter (une action du coach), Tous, À relancer (séances ou diète), Nouveautés (séances pas vues ou
// messages non lus), Sans programme. Compteurs exacts.
const DESK_FILTERS = Object.freeze([['todo', 'À traiter'], ['all', 'Tous'], ['warn', 'À relancer'], ['fresh', 'Nouveautés'], ['noprog', 'Sans programme']]);
function deskRowIn(kind, r) {
  if (kind === 'todo') return r.act;
  if (kind === 'warn') return coachStudentIn('warn', r.st, r.pr) || r.dietWarn;
  if (kind === 'fresh') return coachStudentIn('fresh', r.st, r.pr, r.unread);
  if (kind === 'noprog') return r.noprog;
  return true;
}
function deskFilterCounts(rows) { return Object.fromEntries(DESK_FILTERS.map(([k]) => [k, rows.filter(r => deskRowIn(k, r)).length])); }
// Recherche par pseudo : début de mot, casse et accents ignorés (normName de l'app)
function deskSearch(rows, query) {
  const q = normName(String(query || '').trim());
  if (!q) return rows;
  return rows.filter(r => normName(r.name).split(/[\s._-]+/).some(w => w.startsWith(q)) || normName(r.name).startsWith(q));
}
// Résumé de la semaine : messages non lus, séances faites en 7 jours, records battus, élèves à relancer
function deskTeamSummary(rows) {
  return rows.reduce((a, r) => ({ unread: a.unread + r.unread, sessions: a.sessions + (r.n7 || 0), records: a.records + r.pr.records.length,
    warn: a.warn + (deskRowIn('warn', r) ? 1 : 0) }), { unread: 0, sessions: 0, records: 0, warn: 0 });
}
// Planning : phases qui finissent dans 7 jours, qui commencent dans 7 jours, élèves sans phase (à planifier)
function deskPlanningItems(rows, now) {
  const today = localISO(now), out = [];
  for (const r of rows) {
    const ph = r.phase?.phase;
    if (r.phase && !ph) { out.push({ id: r.id, name: r.name, text: 'Aucune phase prévue', when: null, order: 2 }); continue; }
    if (!ph) continue;
    const g = phaseProgress(ph, today);
    if (g.status === 'current' && g.daysLeft <= 7) out.push({ id: r.id, name: r.name, text: `${phaseTitle(ph)}, finit ${g.daysLeft <= 1 ? 'aujourd\'hui' : `dans ${g.daysLeft} jours`}`, when: planTs(phaseLastDay(ph)), order: 0 });
    else if (g.status === 'upcoming' && g.daysTo <= 7) out.push({ id: r.id, name: r.name, text: `${phaseTitle(ph)} commence ${g.daysTo === 1 ? 'demain' : `dans ${g.daysTo} jours`}`, when: planTs(ph.start), order: 1 });
  }
  return out.sort((a, b) => (a.order - b.order) || ((a.when ?? 0) - (b.when ?? 0)) || a.name.localeCompare(b.name, 'fr'));
}
// Code d'invitation lisible : « K7MP 4QXR », « K7MP 4QXR 9ABC »
function deskCodeText(code) { return String(code || '').replace(/(.{4})(?=.)/g, '$1 '); }

// ── Fiche « Semaines » ──────────────────────────────────────

// Records d'une liste de séances, un par exercice (casse et accents ignorés), comme le signal de l'app
function deskRecordCount(rows) {
  const seen = new Set();
  for (const r of rows) for (const x of r.s.records || []) seen.add(normName(x.ex));
  return seen.size;
}
const deskAvg = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

// ── Pas, sommeil et cardio de Santé (vague 3, docs/COACH_WEB.md) ──

// Moyennes d'une semaine (jours AAAA-MM-JJ du lundi au dimanche) sur les jours partagés (cleanCoachHealth) :
// { steps, sleep, cardio }, chacune { avg, n } (n : jours qui ont une valeur, seuls comptés) ou null sans aucune valeur.
// Pas arrondis à l'unité, sommeil et cardio en minutes entières ; cardio : aussi le total de la semaine (sum, audit m4).
// null si l'élève ne partage pas.
function deskHealthWeek(health, days) {
  if (!health?.shared) return null;
  const set = new Set(days), inWeek = health.days.filter(d => set.has(d.day));
  const avg = k => { const l = inWeek.map(d => d[k]).filter(v => Number.isInteger(v)); return l.length ? { avg: Math.round(deskAvg(l)), n: l.length } : null; };
  const cardio = avg('cardio');
  if (cardio) cardio.sum = inWeek.reduce((a, d) => a + (Number.isInteger(d.cardio) ? d.cardio : 0), 0);
  return { steps: avg('steps'), sleep: avg('sleep'), cardio };
}
// Dernier jour reçu de Santé s'il date de plus de 2 jours (l'élève n'a plus ouvert l'app, ou Santé ne rend plus rien) :
// son instant (midi local), sinon null (audit m7). Rien sans partage ni sans aucun jour.
function deskHealthStale(health, now = Date.now()) {
  const last = health?.shared && health.days?.[0]?.day;
  if (!last) return null;
  const at = new Date(`${last}T12:00:00`).getTime();
  return localISO(now) > localISO(at + 2 * 86_400_000) ? at : null;
}
// Minutes de sommeil → « 7 h 05 », « 8 h 00 », « 45 min »
function deskSleepText(min) {
  if (!Number.isFinite(min)) return '';
  const m = Math.round(min), h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}
// Textes d'une case : { text, sr (pour les lecteurs d'écran), title, small? (cardio : total de la semaine) } ; null sans valeur
function deskHealthCell(kind, v) {
  if (!v) return null;
  const over = kind === 'sleep' ? plural(v.n, 'nuit', 'nuits') : plural(v.n, 'jour', 'jours');
  const title = `Moyenne sur ${over}`;
  if (kind === 'steps') return { text: fmtNum(v.avg), sr: `pas par jour, moyenne sur ${over}`, title };
  if (kind === 'sleep') return { text: deskSleepText(v.avg), sr: `de sommeil par nuit, moyenne sur ${over}`, title };
  const total = Number.isInteger(v.sum) ? `${fmtNum(v.sum)} min en tout` : '';
  return { text: `${v.avg} min/j`, sr: `de cardio par jour, moyenne sur ${over}${total ? `, ${total}` : ''}`, title, ...(total ? { small: total } : {}) };
}
// [clé, intitulé, précision sous l'intitulé (deux lignes : le tableau reste étroit)]
const DESK_HEALTH_COLS = Object.freeze([['steps', 'Pas', 'par jour'], ['sleep', 'Sommeil', 'par nuit'], ['cardio', 'Cardio', 'par jour']]);
// Colonnes Pas, Sommeil, Cardio : seulement si l'élève partage (health.shared === true)
function deskHealthColumns(health) { return health?.shared === true ? DESK_HEALTH_COLS : []; }

// Semaines de la fiche, de la semaine en cours vers le passé.
// src : { sessions: [cleanCoachSessionRow], weights (cleanCoachWeights), measures (cleanCoachMeasures),
//         diet (cleanCoachDiet | null : serveur sans le suivi), health (cleanCoachHealth | null : serveur sans la
//         vague 3), phases (cleanCoachPlans[élève] | null), now, count }
// Une semaine : { start, end, week (numéro ISO), range, current, phase, sessions, volume, records,
//   weight: { avg, n, delta } | null, diet: { ok, noted, kcal } | null, water (L par jour noté) | null,
//   measures: { clé: cm } (dernière mesure de la semaine), health: deskHealthWeek | null }
function deskWeeks({ sessions = [], weights = null, measures = null, diet = null, health = null, phases = null, now, count = DESK_WEEKS_SHOWN }) {
  const cur = deskWeekStart(now), out = [];
  for (let i = 0; i < count; i++) {
    const start = deskDayStart(cur, -7 * i), end = deskDayStart(cur, -7 * i + 7);
    const inWeek = t => t >= start && t < end;
    const ws = sessions.filter(r => inWeek(r.doneAt));
    const volume = ws.reduce((a, r) => a + (reviewVolume(r.s.exercises, reviewBodyKg(r.s)) || 0), 0);
    const wk = weights?.shared ? weights.weights.filter(w => inWeek(w.date)).map(w => w.kg) : [];
    const days = Array.from({ length: 7 }, (_, j) => localISO(deskDayStart(start, j)));
    let dietW = null, water = null;
    if (diet?.shared) {
      const today = localISO(now);
      const noted = days.filter(d => diet.days[d]);
      const st = noted.map(d => dietShareStatus(diet.days[d], { today: d === today }));
      const kcal = deskAvg(noted.map(d => diet.days[d]).filter(x => x.goal || x.kcal > 0).map(x => x.kcal));
      dietW = { ok: st.filter(s => s === 'ok').length, noted: noted.length, kcal: kcal === null ? null : Math.round(kcal) };
      const ml = noted.map(d => diet.days[d].water).filter(x => x > 0);
      water = ml.length ? Math.round(deskAvg(ml) / 100) / 10 : null;
    }
    const m = {};
    if (measures?.shared) for (const [k, list] of Object.entries(measures.measures)) { const v = list.find(x => inWeek(x.date)); if (v) m[k] = v.cm; }
    let phase = null;
    if (Array.isArray(phases)) {
      const day = localISO(start + 3 * 86_400_000), ph = planCurrent(phases, day) || planCurrent(phases, localISO(start));
      if (ph) phase = `${phaseTitle(ph)} ${phaseProgress(ph, day).week}/${ph.weeks}`;
    }
    out.push({ start, end, week: deskIsoWeek(start), range: deskWeekRange(start), current: i === 0, phase,
      sessions: ws.length, volume: Math.round(volume), records: deskRecordCount(ws),
      weight: wk.length ? { avg: Math.round(deskAvg(wk) * 10) / 10, n: wk.length, delta: null } : null,
      diet: dietW, water, measures: m, health: deskHealthWeek(health, days) });
  }
  // Écart de poids avec la semaine pesée d'avant (la plus proche dans le passé)
  out.forEach((w, i) => {
    if (!w.weight) return;
    const prev = out.slice(i + 1).find(x => x.weight);
    if (prev) w.weight.delta = Math.round((w.weight.avg - prev.weight.avg) * 10) / 10;
  });
  return out;
}

// Mensurations à afficher en colonnes : celles qui ont une valeur, dans l'ordre de BODY_MEASURES, 2 au plus (toutes dans
// le panneau « Mensurations » : le tableau tient sans défilement à 1180 px)
function deskMeasureColumns(measures) {
  if (!measures?.shared) return [];
  return BODY_MEASURE_KEYS.filter(k => measures.measures[k]?.length).slice(0, 2);
}
// Dernière valeur de chaque mensuration et écart depuis la première de la fenêtre : [{ key, label, cm, delta, at, from }]
function deskMeasureSummary(measures) {
  if (!measures?.shared) return [];
  return BODY_MEASURE_KEYS.filter(k => measures.measures[k]?.length).map(k => {
    const l = measures.measures[k], last = l[0], first = l[l.length - 1];
    return { key: k, label: bodyMeasureLabel(k), cm: last.cm, at: last.date, from: first.date, delta: l.length > 1 ? Math.round((last.cm - first.cm) * 10) / 10 : null };
  });
}

// Courbe du poids sur `days` jours : géométrie d'un SVG de w × h (axes compris), null sans 2 pesées.
// { points: [{ x, y, kg, date }], ticks: [{ y, kg }], labels: [{ x, text, anchor }], first, last, delta, n, desc }
function deskWeightChart(weights, now, { days = DESK_CHART_DAYS, w = 300, h = 120 } = {}) {
  if (!weights?.shared) return null;
  const from = deskDayStart(now, -days + 1);
  const pts = weights.weights.filter(x => x.date >= from && x.date <= now + 86_400_000).slice().sort((a, b) => a.date - b.date);
  if (pts.length < 2) return null;
  const left = 4, right = w - 34, top = 8, bottom = h - 22;
  const kgs = pts.map(p => p.kg);
  let lo = Math.floor(Math.min(...kgs) * 2) / 2, hi = Math.ceil(Math.max(...kgs) * 2) / 2;
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const t0 = pts[0].date, t1 = Math.max(pts[pts.length - 1].date, t0 + 1);
  const X = t => left + (t - t0) / (t1 - t0) * (right - left), Y = kg => bottom - (kg - lo) / (hi - lo) * (bottom - top);
  const r1 = v => Math.round(v * 10) / 10;
  const step = (hi - lo) / 2;
  const ticks = [0, 1, 2].map(i => ({ y: r1(Y(lo + i * step)), kg: lo + i * step }));
  const mid = t0 + (t1 - t0) / 2;
  const labels = [{ x: r1(X(t0)), text: fmtDate(t0, 'short'), anchor: 'start' }, { x: r1(X(mid)), text: fmtDate(mid, 'short'), anchor: 'middle' },
    { x: r1(X(t1)), text: fmtDate(t1, 'short'), anchor: 'end' }];
  const first = pts[0], last = pts[pts.length - 1];
  return { w, h, right, points: pts.map(p => ({ x: r1(X(p.date)), y: r1(Y(p.kg)), kg: p.kg, date: p.date })), ticks, labels,
    first, last, n: pts.length, delta: Math.round((last.kg - first.kg) * 10) / 10,
    desc: `Poids du ${fmtDate(first.date, 'short')} au ${fmtDate(last.date, 'short')} : de ${fmtNum(first.kg, 1)} à ${fmtNum(last.kg, 1)} kg, ${plural(pts.length, 'pesée', 'pesées')}` };
}

// Chiffres en tête de la fiche : poids moyen des 7 derniers jours et écart avec les 7 d'avant, séances de la semaine en
// cours, diète suivie la dernière semaine complète, eau, records des 4 dernières semaines
function deskStudentStats(weeks, weights, now) {
  const last7 = weights?.shared ? weights.weights.filter(w => w.date >= deskDayStart(now, -6)).map(w => w.kg) : [];
  const prev7 = weights?.shared ? weights.weights.filter(w => w.date >= deskDayStart(now, -13) && w.date < deskDayStart(now, -6)).map(w => w.kg) : [];
  const avg = deskAvg(last7), pavg = deskAvg(prev7);
  const lastFull = weeks[1] || null;
  return {
    weight: avg === null ? null : { avg: Math.round(avg * 10) / 10, delta: pavg === null ? null : Math.round((avg - pavg) * 10) / 10 },
    sessions: weeks[0]?.sessions ?? 0,
    diet: lastFull?.diet ? { ok: lastFull.diet.ok, week: lastFull.week } : null,
    water: lastFull?.water ?? null,
    records: weeks.slice(0, 4).reduce((a, w) => a + w.records, 0),
  };
}
