// ═══════════════════════════════════════════════════════════
//  Défis (docs/DEFIS.md) : « 100 pompes par jour », noté en plusieurs fois, jour par jour. Logique pure.
//
//  - Chargé avant store.js et sync.js : sanitizeData appelle sanitizeDefis, applyRemoteProfile appelle mergeDefis.
//  - data.defis = { [id]: défi } ; un défi :
//      { id, name, measure: 'reps' | 'time', goals: [{ from: 'AAAA-MM-JJ', n }], start, length: 30 | 60 | 0,
//        remind: 'HH:MM' | null, pauses: [{ from, to? }], endedAt?, deleted?, at, log: { jour: [{ id, n, at }] }, gone: [id] }
//    goals : objectif par jour, daté (changer l'objectif ne réécrit pas les jours passés) ; length 0 : sans fin ;
//    pauses : jours neutres (ni tenus ni manqués, la série continue) ; at : dernière modification des réglages.
//  - Synchro (profil du compte, comme les programmes) : réglages du défi au plus récent (at), ajouts réunis par
//    identifiant moins ceux retirés (gone, réunis aussi) : un ajout fait hors ligne sur deux appareils n'est jamais perdu,
//    un ajout annulé ne revient jamais. Supprimer laisse une trace (deleted) pour qu'un autre appareil ne le ressuscite pas.
//  - Le jour est le jour local (localISO) lu au moment du toucher : 23 h 59 compte pour aujourd'hui, 0 h 01 pour demain.
//  - Les reps des défis ne comptent pas dans Progrès (séries par muscle, volume) : la fiche du défi a ses chiffres.
//  - Montre (plus tard) : tout passe par defiToday / defiAdd / defiUndo, sans écran ; un message de la montre n'a qu'à
//    appeler defiAdd(data, id, n) puis save().
// ═══════════════════════════════════════════════════════════
'use strict';

const DEFI_MAX         = 4;        // défis en cours en même temps
const DEFI_ID_RE       = /^[a-z0-9]{1,12}$/;
const DEFI_DAY_RE      = /^\d{4}-\d{2}-\d{2}$/;
const DEFI_NAME_MAX    = 60;
const DEFI_GOAL_MAX    = { reps: 2000, time: 3600 };   // 2 000 reps ou 1 h par jour
const DEFI_ADD_MAX     = { reps: 1000, time: 3600 };   // un ajout
const DEFI_DAY_ADDS    = 40;       // ajouts par jour
const DEFI_LOG_DAYS    = 800;      // jours gardés (deux ans et plus)
const DEFI_GONE_MAX    = 300;      // ajouts retirés dont on garde la trace
const DEFI_LENGTHS     = [30, 60, 0];
// Suggestions en tête du choix de l'exercice (noms de la bibliothèque) et objectif proposé
const DEFI_SUGGESTIONS = [
  { name: 'Pompes', goal: 100 },
  { name: 'Tractions pronation', goal: 20 },
  { name: 'Squat poids du corps', goal: 100 },
  { name: 'Gainage (planche)', goal: 120 },
  { name: 'Dips', goal: 50 },
  { name: 'Burpees', goal: 50 },
];

const defiIsObj = o => !!o && typeof o === 'object' && !Array.isArray(o);

// ── Jours (heure locale, sans Date.parse : « 2026-11-24 » serait lu en UTC) ──
function defiDate(day) { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function defiAddDays(day, n) { const t = defiDate(day); t.setDate(t.getDate() + n); return localISO(t.getTime()); }
function defiDaysBetween(a, b) { return Math.round((defiDate(b) - defiDate(a)) / 86400000); }

// ── Nettoyage ───────────────────────────────────────────────

function cleanDefiEntry(e, measure) {
  if (!defiIsObj(e)) return null;
  const n = num(e.n, 1, DEFI_ADD_MAX[measure] || DEFI_ADD_MAX.reps, true);
  if (n === null || typeof e.id !== 'string' || !DEFI_ID_RE.test(e.id)) return null;
  return { id: e.id, n, at: Number.isFinite(e.at) && e.at > 0 ? Math.round(e.at) : 0 };
}
function cleanDefiLog(v, measure, now = Date.now()) {
  if (!defiIsObj(v)) return {};
  const oldest = localISO(now - DEFI_LOG_DAYS * 86400000), newest = localISO(now + 2 * 86400000);
  const out = {};
  for (const day of Object.keys(v).sort()) {
    const list = v[day];
    if (!DEFI_DAY_RE.test(day) || day < oldest || day > newest || !Array.isArray(list)) continue;
    const ids = new Set();
    const items = list.map(e => cleanDefiEntry(e, measure)).filter(x => x && !ids.has(x.id) && ids.add(x.id)).slice(0, DEFI_DAY_ADDS);
    if (items.length) out[day] = items;
  }
  return out;
}
function cleanDefiGoals(list, measure) {
  if (!Array.isArray(list)) return [];
  const by = new Map();
  for (const g of list) {
    if (!defiIsObj(g) || typeof g.from !== 'string' || !DEFI_DAY_RE.test(g.from)) continue;
    const n = num(g.n, 1, DEFI_GOAL_MAX[measure] || DEFI_GOAL_MAX.reps, true);
    if (n !== null) by.set(g.from, n);
  }
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([from, n]) => ({ from, n }));
}
function cleanDefiPauses(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(p => defiIsObj(p) && DEFI_DAY_RE.test(p.from) && (p.to == null || (DEFI_DAY_RE.test(p.to) && p.to >= p.from)))
    .map(p => (p.to ? { from: p.from, to: p.to } : { from: p.from })).sort((a, b) => (a.from < b.from ? -1 : 1)).slice(-50);
}
// Un défi, ou null s'il n'est pas lisible. Supprimé : la trace seule (id, deleted, at)
function cleanDefi(c, id, now = Date.now()) {
  if (!defiIsObj(c) || !DEFI_ID_RE.test(id)) return null;
  const at = Number.isFinite(c.at) && c.at > 0 ? Math.round(c.at) : 0;
  if (c.deleted === true) return { id, deleted: true, at };
  const measure = c.measure === 'time' ? 'time' : 'reps';
  const name = typeof c.name === 'string' ? c.name.replace(/\s+/g, ' ').trim().slice(0, DEFI_NAME_MAX).trim() : '';
  const goals = cleanDefiGoals(c.goals, measure);
  if (!name || !hasVisible(name) || !goals.length || typeof c.start !== 'string' || !DEFI_DAY_RE.test(c.start)) return null;
  const out = { id, name, measure, goals, start: c.start, length: DEFI_LENGTHS.includes(c.length) ? c.length : 0,
    remind: typeof c.remind === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(c.remind) ? c.remind : null,
    pauses: cleanDefiPauses(c.pauses), at, log: cleanDefiLog(c.log, measure, now),
    gone: Array.isArray(c.gone) ? [...new Set(c.gone.filter(x => typeof x === 'string' && DEFI_ID_RE.test(x)))].slice(-DEFI_GONE_MAX) : [] };
  if (Number.isFinite(c.endedAt) && c.endedAt > 0) out.endedAt = Math.round(c.endedAt);
  return out;
}
function cleanDefis(v, now = Date.now()) {
  if (!defiIsObj(v)) return {};
  const out = {};
  for (const [id, c] of Object.entries(v)) { const x = cleanDefi(c, id, now); if (x) out[id] = x; }
  return out;
}
// Appelé par sanitizeData
function sanitizeDefis(d, now = Date.now()) {
  if (d.defis === undefined) return d;
  d.defis = cleanDefis(d.defis, now);
  if (!Object.keys(d.defis).length) delete d.defis;
  if (d.defisRecapOff !== undefined && d.defisRecapOff !== true) delete d.defisRecapOff;
  return d;
}

// ── Lecture ─────────────────────────────────────────────────

// Défis visibles (ni supprimés), en cours d'abord puis terminés ; ordre de création
function defiList(d, { ended = false } = {}) {
  return Object.values(d.defis || {}).filter(c => !c.deleted && !!c.endedAt === ended).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : (a.at || 0) - (b.at || 0)));
}
function defiGet(d, id) { const c = d.defis?.[id]; return c && !c.deleted ? c : null; }
// Objectif d'un jour : le dernier fixé à cette date ou avant (avant le premier : le premier)
function defiGoalOn(c, day) {
  let g = c.goals[0]?.n || 0;
  for (const x of c.goals) if (x.from <= day) g = x.n;
  return g;
}
function defiGoal(c) { return defiGoalOn(c, localISO()); }
function defiDayTotal(c, day) { return (c.log?.[day] || []).reduce((s, e) => s + e.n, 0); }
function defiPausedOn(c, day) { return (c.pauses || []).some(p => p.from <= day && (!p.to || day <= p.to)); }
function defiPaused(c, day = localISO()) { return defiPausedOn(c, day); }
// Dernier jour du défi (inclus), pauses comprises en plus ; null : sans fin
function defiLastDay(c) {
  if (!c.length) return null;
  let last = defiAddDays(c.start, c.length - 1);
  for (const p of c.pauses || []) {
    const to = p.to || localISO();
    if (p.from > last) continue;
    last = defiAddDays(last, defiDaysBetween(p.from, to < last ? to : last) + 1);
  }
  return last;
}
// État d'un jour : 'done' (objectif atteint), 'missed' (jour passé sous l'objectif), 'paused', 'today' (en cours),
// 'out' (hors du défi : avant le début, après la fin, ou à venir)
function defiDayState(c, day, today = localISO()) {
  const last = defiLastDay(c), endDay = c.endedAt ? localISO(c.endedAt) : null;
  if (day < c.start || day > today || (last && day > last) || (endDay && day > endDay)) return 'out';
  if (defiPausedOn(c, day)) return 'paused';
  if (defiDayTotal(c, day) >= defiGoalOn(c, day)) return 'done';
  return day === today ? 'today' : 'missed';
}
// Série : jours tenus d'affilée jusqu'à aujourd'hui ; aujourd'hui pas encore tenu ne la casse pas, les pauses non plus
function defiStreak(c, today = localISO()) {
  let n = 0, day = today;
  for (let i = 0; i < DEFI_LOG_DAYS && day >= c.start; i++, day = defiAddDays(day, -1)) {
    const st = defiDayState(c, day, today);
    if (st === 'done') n++;
    else if (st === 'missed') break;
    // today, paused, out (après la fin) : on continue
  }
  return n;
}
// Chiffres de la fiche : total, record d'un jour, jours tenus et manqués, jours écoulés
function defiStats(c, today = localISO()) {
  let total = 0, best = 0, bestDay = null, held = 0, missed = 0;
  for (const [day, list] of Object.entries(c.log || {})) {
    const t = list.reduce((s, e) => s + e.n, 0);
    if (day < c.start) continue;
    total += t;
    if (t > best) { best = t; bestDay = day; }
  }
  const last = defiLastDay(c), endDay = c.endedAt ? localISO(c.endedAt) : null;
  let stop = today;
  if (last && last < stop) stop = last;
  if (endDay && endDay < stop) stop = endDay;
  for (let day = c.start, i = 0; day <= stop && i < DEFI_LOG_DAYS; day = defiAddDays(day, 1), i++) {
    const st = defiDayState(c, day, today);
    if (st === 'done') held++; else if (st === 'missed') missed++;
  }
  // Jour du défi (« Jour 12 sur 30 ») : jours écoulés depuis le début, pauses retirées
  let dayNo = 0;
  for (let day = c.start, i = 0; day <= stop && i < DEFI_LOG_DAYS; day = defiAddDays(day, 1), i++) if (!defiPausedOn(c, day)) dayNo++;
  return { total, best, bestDay, held, missed, streak: defiStreak(c, today), dayNo, last, finished: !!(last && today > last) };
}
// Ce que montre la carte de l'accueil
function defiToday(c, today = localISO()) {
  const goal = defiGoalOn(c, today), done = defiDayTotal(c, today);
  return { day: today, goal, done, ratio: goal > 0 ? Math.min(1, done / goal) : 0, reached: done >= goal, paused: defiPausedOn(c, today) };
}
// Boutons de pas adaptés à l'objectif : 100 pompes → +5 +10 +20 ; 20 tractions → +1 +5 ; 120 s → +15 +30 +60
function defiSteps(goal, measure = 'reps') {
  if (measure === 'time') return goal <= 60 ? [10, 30] : goal <= 180 ? [15, 30, 60] : [30, 60, 120];
  if (goal <= 10) return [1, 2];
  if (goal <= 30) return [1, 5];
  if (goal <= 60) return [5, 10];
  if (goal <= 150) return [5, 10, 20];
  if (goal <= 400) return [10, 25, 50];
  return [25, 50, 100];
}

// ── Écriture ────────────────────────────────────────────────

// Nouveau défi ; { ok, id?, error? } (error : 'name', 'goal', 'full')
function defiCreate(d, { name, measure = 'reps', goal, length = 30, remind = null }, now = Date.now()) {
  const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!n || !hasVisible(n) || n.length > DEFI_NAME_MAX) return { ok: false, error: 'name' };
  const m = measure === 'time' ? 'time' : 'reps';
  const g = num(goal, 1, DEFI_GOAL_MAX[m], true);
  if (g === null) return { ok: false, error: 'goal' };
  if (defiList(d).length >= DEFI_MAX) return { ok: false, error: 'full' };
  const id = uid();
  const c = cleanDefi({ name: n, measure: m, goals: [{ from: localISO(now), n: g }], start: localISO(now), length: DEFI_LENGTHS.includes(length) ? length : 30, remind, at: now }, id, now);
  (d.defis ||= {})[id] = c;
  return { ok: true, id };
}
// Ajout du jour (ou d'un jour passé) ; renvoie l'ajout (pour Annuler), null si refusé
function defiAdd(d, id, n, day = localISO(), now = Date.now()) {
  const c = defiGet(d, id);
  if (!c || c.endedAt || !DEFI_DAY_RE.test(day) || day > localISO(now) || day < c.start) return null;
  const e = cleanDefiEntry({ id: uid(), n, at: now }, c.measure);
  if (!e || (c.log[day] || []).length >= DEFI_DAY_ADDS) return null;
  c.log[day] = [...(c.log[day] || []), e];
  return { day, entry: e };
}
// Retire un ajout (Annuler, ou corriger) ; true s'il existait. Sa trace (gone) l'empêche de revenir par la synchro
function defiUndo(d, id, day, entryId) {
  const c = defiGet(d, id);
  const list = c?.log?.[day];
  if (!list || !list.some(e => e.id === entryId)) return false;
  const rest = list.filter(e => e.id !== entryId);
  if (rest.length) c.log[day] = rest; else delete c.log[day];
  c.gone = [...c.gone.filter(x => x !== entryId), entryId].slice(-DEFI_GONE_MAX);
  return true;
}
// Corriger un jour : son total devient n (0 : rien). Les ajouts du jour sont retirés et remplacés par un seul.
// Renvoie { before } (anciens ajouts, pour Annuler) ou null
function defiSetDay(d, id, day, n, now = Date.now()) {
  const c = defiGet(d, id);
  if (!c || !DEFI_DAY_RE.test(day) || day > localISO(now) || day < c.start) return null;
  const v = num(n, 0, DEFI_ADD_MAX[c.measure], true);
  if (v === null) return null;
  const before = (c.log[day] || []).slice();
  for (const e of before) defiUndo(d, id, day, e.id);
  if (v > 0) c.log[day] = [{ id: uid(), n: v, at: now }];
  return { before };
}
// Remettre des ajouts retirés (Annuler d'une correction) : nouveaux identifiants, les anciens restent retirés
function defiRestoreDay(d, id, day, entries, now = Date.now()) {
  const c = defiGet(d, id);
  if (!c) return false;
  for (const e of c.log[day] || []) defiUndo(d, id, day, e.id);
  const list = entries.map(e => cleanDefiEntry({ id: uid(), n: e.n, at: e.at || now }, c.measure)).filter(Boolean);
  if (list.length) c.log[day] = list;
  return true;
}
// Réglages : objectif (à partir d'aujourd'hui), nom, durée, rappel
function defiEdit(d, id, { goal, length, remind, name } = {}, now = Date.now()) {
  const c = defiGet(d, id);
  if (!c) return false;
  const today = localISO(now);
  if (goal !== undefined) {
    const g = num(goal, 1, DEFI_GOAL_MAX[c.measure], true);
    if (g === null) return false;
    if (g !== defiGoalOn(c, today)) c.goals = cleanDefiGoals([...c.goals.filter(x => x.from !== today), { from: today, n: g }], c.measure);
  }
  if (length !== undefined && DEFI_LENGTHS.includes(length)) c.length = length;
  if (remind !== undefined) c.remind = typeof remind === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(remind) ? remind : null;
  if (typeof name === 'string' && hasVisible(name)) c.name = name.replace(/\s+/g, ' ').trim().slice(0, DEFI_NAME_MAX).trim();
  c.at = now;
  return true;
}
// Pause (à partir d'aujourd'hui) et reprise (la pause s'arrête hier ; reprise le jour même : pause effacée)
function defiPause(d, id, on, now = Date.now()) {
  const c = defiGet(d, id);
  if (!c) return false;
  const today = localISO(now), open = c.pauses.find(p => !p.to);
  if (on && !open) c.pauses.push({ from: today });
  else if (!on && open) {
    if (open.from >= today) c.pauses = c.pauses.filter(p => p !== open);
    else open.to = defiAddDays(today, -1);
  } else return false;
  c.at = now;
  return true;
}
// Arrêter : le défi passe dans « Terminés », ses chiffres restent
function defiStop(d, id, now = Date.now()) {
  const c = defiGet(d, id);
  if (!c || c.endedAt) return false;
  c.endedAt = now; c.remind = null; c.at = now;
  return true;
}
function defiResume(d, id, now = Date.now()) {
  const c = defiGet(d, id);
  if (!c || !c.endedAt || defiList(d).length >= DEFI_MAX) return false;
  delete c.endedAt; c.at = now;
  return true;
}
// Supprimer : la trace seule reste (synchro)
function defiDelete(d, id, now = Date.now()) {
  if (!defiGet(d, id)) return null;
  const before = d.defis[id];
  d.defis[id] = { id, deleted: true, at: now };
  return before;
}
// Défis terminés d'eux-mêmes (30 ou 60 jours passés) : arrêtés au premier passage, pour libérer la place
function defiCloseFinished(d, now = Date.now()) {
  let n = 0;
  for (const c of defiList(d)) {
    const last = defiLastDay(c);
    if (last && localISO(now) > last) { c.endedAt = defiDate(last).setHours(23, 59, 0, 0); c.remind = null; c.at = now; n++; }
  }
  return n;
}

// ── Synchro : fusion de deux versions ─────────────────────
// Réglages au plus récent (at) ; ajouts réunis par identifiant, sans ceux retirés d'un côté ou de l'autre.
// Commutative : A fusionné avec B donne la même chose que B avec A.
function mergeDefi(a, b, now = Date.now()) {
  if (!a) return b; if (!b) return a;
  const win = (b.at || 0) > (a.at || 0) || ((b.at || 0) === (a.at || 0) && stableJson(b) > stableJson(a)) ? b : a;
  if (win.deleted) return { id: win.id, deleted: true, at: win.at };
  if (a.deleted || b.deleted) return { ...win };   // supprimé avant une modification plus récente : la modification gagne
  const gone = new Set([...(a.gone || []), ...(b.gone || [])]);
  const log = {};
  for (const src of [a.log || {}, b.log || {}]) {
    for (const [day, list] of Object.entries(src)) {
      const m = new Map((log[day] || []).map(e => [e.id, e]));
      for (const e of list) if (!gone.has(e.id) && !m.has(e.id)) m.set(e.id, e);
      const items = [...m.values()].sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
      if (items.length) log[day] = items; else delete log[day];
    }
  }
  for (const day of Object.keys(log)) { log[day] = log[day].filter(e => !gone.has(e.id)); if (!log[day].length) delete log[day]; }
  return cleanDefi({ ...win, log, gone: [...gone] }, win.id, now);
}
function mergeDefis(local, remote, now = Date.now()) {
  const l = cleanDefis(local, now), r = cleanDefis(remote, now);
  const out = {};
  for (const id of new Set([...Object.keys(l), ...Object.keys(r)])) { const m = mergeDefi(l[id], r[id], now); if (m) out[id] = m; }
  return out;
}

// ── Textes ──────────────────────────────────────────────────

// « 63 » ou « 1:30 » (temps) ; avec l'unité : « 63 reps », « 1 min 30 s »
function defiVal(n, measure) {
  if (measure !== 'time') return fmtNum(n);
  const m = Math.floor(n / 60), s = n % 60;
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${s}`;
}
function defiUnit(c) { return c.measure === 'time' ? 's' : 'reps'; }
function defiAmount(n, measure) {
  if (measure !== 'time') return `${fmtNum(n)} ${n > 1 ? 'reps' : 'rep'}`;
  const m = Math.floor(n / 60), s = n % 60;
  return m ? `${m} min${s ? ` ${s} s` : ''}` : `${s} s`;
}
function defiAmountSpoken(n, measure) {
  if (measure !== 'time') return `${n} répétition${n > 1 ? 's' : ''}`;
  const m = Math.floor(n / 60), s = n % 60;
  return [m ? `${m} minute${m > 1 ? 's' : ''}` : '', s ? `${s} seconde${s > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ');
}
function defiStepLabel(n, measure) { return measure === 'time' && n >= 60 ? `+${n / 60} min` : `+${n}${measure === 'time' ? ' s' : ''}`; }
function defiLengthText(c) { return c.length ? `${c.length} jours` : 'Sans fin'; }
// « 12 jours de suite », « 1 jour », « Pas encore de jour tenu »
function defiStreakText(n) { return n ? `${n} jour${n > 1 ? 's' : ''} de suite` : 'Pas encore de jour tenu'; }
// Titre court d'un défi : « 100 pompes par jour » (nom tel qu'écrit, en minuscule après le nombre)
function defiTitle(c, goal = defiGoal(c)) {
  const nm = c.name.charAt(0).toLowerCase() + c.name.slice(1);
  return c.measure === 'time' ? `${c.name} : ${defiAmount(goal, 'time')} par jour` : `${fmtNum(goal)} ${nm} par jour`;
}
// Recap d'une période (semaine, mois, année) : défis actifs sur [from, to] (jours inclus) avec un total > 0
function defiPeriodSummary(d, from, to, today = localISO()) {
  const out = [];
  for (const c of [...defiList(d), ...defiList(d, { ended: true })]) {
    let total = 0, held = 0, counted = 0;
    const stop = to < today ? to : today;
    for (let day = from > c.start ? from : c.start, i = 0; day <= stop && i < 400; day = defiAddDays(day, 1), i++) {
      const st = defiDayState(c, day, today);
      if (st === 'out' || st === 'paused') continue;
      counted++;
      total += defiDayTotal(c, day);
      if (st === 'done') held++;
    }
    if (total > 0) out.push({ id: c.id, name: c.name, measure: c.measure, total, held, days: counted });
  }
  return out;
}
