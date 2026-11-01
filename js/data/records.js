// ═══════════════════════════════════════════════════════════
//  Records : records notés dans la séance (bilan, historique, récaps,
//  image partagée, badges en direct) et ancien calcul gardé pour les
//  séances d'anciennes versions reçues par le coach
// ═══════════════════════════════════════════════════════════
'use strict';

// Un seul calcul fait foi : celui des records notés (plus bas : sessionRecords, sessionPriorOf,
// liveExerciseBadges). Les badges de la séance en cours (liveSetBadge), le bilan, l'historique, les récaps
// (js/data/recap.js) et l'image de la séance (js/features/share-stats.js) le lisent tous.
// Le premier bloc (recordLabel, exerciseRecord, historyBaseline) est l'ancien calcul (charge, reps, 1RM
// estimé contre une ligne de base) : il ne sert plus qu'à js/data/session-review.js, pour les séances
// d'une app d'avant les records notés reçues par le coach.

// Ordre d'importance des badges : charge > reps > 1RM estimé
const RECORD_RANK = { 'Record charge': 3, 'Record lest': 3, 'Record reps': 2, 'Record 1RM est.': 1 };

// Badge de record d'une série validée, comparée aux records d'avant la séance (jamais en cas d'égalité).
// base : { prW, prR, e1rm } ; sans série précédente (prR nul), aucun record.
// ex facultatif : au poids du corps, la charge battue est un lest (« Record lest »)
function recordLabel(s, base, ex = null) {
  if (!base || !base.prR) return '';
  const w = parseFloat(s.weight) || 0;
  const r = parseInt(s.reps)     || 0;
  if (w > base.prW) return ex && loadKind(ex) === 'lest' ? 'Record lest' : 'Record charge';
  if (w === base.prW && r > base.prR) return 'Record reps';
  const e1 = calc1RM(s.weight, s.reps);
  if (e1 && e1 > base.e1rm) return 'Record 1RM est.';
  return '';
}

// Record le plus marquant d'un exercice : charge > reps > 1RM estimé, puis la série la plus lourde.
// Les séries d'échauffement (js/data/warmup.js) ne battent aucun record. Renvoie { label, s } ou null.
function exerciseRecord(ex, base) {
  const score = s => (parseFloat(s.weight) || 0) * 100 + (+s.reps);
  let rec = null;
  workSets(ex.sets).forEach(s => {
    const l = recordLabel(s, base, ex);
    if (!l) return;
    const rank = RECORD_RANK[l], best = rec && RECORD_RANK[rec.label];
    if (!rec || rank > best || (rank === best && score(s) > score(rec.s))) rec = { label: l, s };
  });
  return rec;
}

// Clé d'un exercice dans une ligne de base (exercice sans exId : son nom normalisé). Pas exKey() :
// les lignes de base sont rangées par exId (historyBaseline) et l'id d'un exercice du programme
// n'y figure jamais ; une clé de nom retombe au moins sur l'exercice de même nom.
function recordKey(ex) { return ex.exId || nameKey(ex.name); }

// Records d'avant une séance de l'historique, par exId : mêmes règles que recomputePRFromHistory
// (même programme et même séance, séances strictement antérieures). Sert à retrouver les records
// battus par une séance passée, dont la ligne de base n'a pas été conservée.
function historyBaseline(entry, history) {
  const prog = entryProg(entry);
  const before = (history || []).filter(h => h !== entry && h.date < entry.date
    && entryProg(h) === prog && h.category === entry.category);
  const baseline = {};
  (entry.exercises || []).forEach(ex => {
    if (measureOf(ex) !== 'reps' || isAssisted(ex)) return;
    let prW = 0, prR = 0, e1rm = 0, seen = false;
    before.forEach(h => (h.exercises || []).forEach(he => {
      if (!sameEx(he, ex)) return;
      workSets(he.sets).forEach(s => {
        const w = parseFloat(s.weight) || 0, r = parseInt(s.reps) || 0;
        seen = true;
        if (w > prW || (w === prW && r > prR)) { prW = w; prR = r; }
        const e1 = calc1RM(s.weight, s.reps);
        if (e1 && e1 > e1rm) e1rm = e1;
      });
    }));
    if (seen) baseline[recordKey(ex)] = { prW, prR, e1rm };
  });
  return baseline;
}

// ═══════════════════════════════════════════════════════════
//  Records notés dans la séance (entry.records)
//  À l'enregistrement, l'app (qui a tout l'historique) note les records battus par la séance : ils
//  partent avec elle chez les amis et le coach (private.session_public, migration
//  20261031100000_records_series.sql), qui n'ont plus à les recalculer sur les seules séances reçues.
//  Élément : { ex, kind, before, after, w?, d? }
//    charge   : charge la plus lourde (kg)                          w : —
//    lest     : lest le plus lourd au poids du corps (kg)
//    reps     : plus de reps à la charge record d'avant             w : cette charge (kg, 0 au poids du corps)
//    aide     : moins d'aide (machine d'assistance, kg) à reps ≥
//    temps    : maintien le plus long (s), lest ≥                   w : lest de la série (kg)
//    duree    : cardio le plus long (min)
//    distance : cardio le plus loin (km)
//    allure   : meilleure allure sur une distance fixe, en secondes par km (course) ou aux 500 m (rameur)
//               d : la distance fixe (km) ; seules les séries d'au moins d km y entrent
//  Règles : égaler n'est jamais un record ; la première fois qu'on fait un exercice ne compte pas (aucun
//  élément) ; l'échauffement ne compte pas ; le 1RM estimé n'y est jamais (il reste pour soi, dans le
//  bilan) ; aucun record sur le niveau d'une machine (escaliers, vélo, elliptique : js/data/machine-track.js).
//  Mêmes séances de référence que les badges : même programme, même séance, strictement avant.
// ═══════════════════════════════════════════════════════════

const NOTED_KINDS = ['charge', 'lest', 'aide', 'allure', 'temps', 'reps', 'distance', 'duree'];
const NOTED_RANK  = { charge: 3, lest: 3, aide: 3, allure: 3, temps: 2, reps: 2, distance: 2, duree: 1 };
const NOTED_MAX   = 20;
const NOTED_VALUE_MAX = 100000;
// Distances fixes des allures (km) : course 1, 5 et 10 km ; rameur 500 et 2 000 m
const RUN_RECORD_KM = [1, 5, 10];
const ROW_RECORD_KM = [0.5, 2];
const RECORD_KM = [...ROW_RECORD_KM, ...RUN_RECORD_KM];

const recW = s => parseFloat(s.weight) || 0;
const recR = s => parseInt(s.reps) || 0;
const round3 = v => Math.round(v * 1000) / 1000;

// Le meilleur de deux records d'un même exercice : le type le plus marquant, puis la plus grande valeur
function betterNoted(a, b) {
  if (!b) return true;
  return NOTED_RANK[a.kind] > NOTED_RANK[b.kind] || (NOTED_RANK[a.kind] === NOTED_RANK[b.kind] && a.after > b.after);
}

// ── Séries d'avant résumées ─────────────────────────────────
// Les règles ne lisent des séries d'avant que des meilleurs (maximums, minimums) : on les résume, et deux
// résumés se fusionnent sans revoir les séries (renoteRecords tient ainsi un résumé par exercice au fil de
// l'historique, au lieu de reparcourir toutes les séances d'avant pour chacune).
//   prW, prR     : charge la plus lourde, puis le plus de reps à cette charge (charge, lest ; maintien :
//                  lest le plus lourd, puis la durée la plus longue avec)
//   minA, rAt    : aide la plus petite, puis le plus de reps à cette aide (machine d'assistance)
//   bestT, lAtT  : maintien le plus long, puis le lest le plus lourd sur cette durée
//   maxMin, maxDist : cardio le plus long (min), le plus loin (km au centième)
//   pace[d], split[d] : meilleure allure (s) des séries d'au moins d km, par km ou aux 500 m
//   e1           : meilleur 1RM estimé (jamais noté ni partagé : badge et bilan pour soi seulement)
const recDist = s => Math.round((parseFloat(s.dist) || 0) * 100) / 100;
// Allure d'une série en secondes entières (par km, ou aux 500 m au rameur), null sans allure valable
function setPaceSec(s, kind) {
  const v = cardioPace(s.dist, setMinutes(s), kind);
  return v == null ? null : Math.round(v * 60);
}
function emptyPrior() {
  return { n: 0, prW: 0, prR: 0, minA: Infinity, rAt: 0, bestT: 0, lAtT: 0, maxMin: 0, maxDist: 0, e1: 0, pace: {}, split: {} };
}
// Plus grand couple (a, b) dans l'ordre lexicographique ; inv : a le plus petit d'abord
const lexBetter = (a, b, a0, b0, inv = false) => (inv ? a < a0 : a > a0) || (a === a0 && b > b0);
function mergeBest(into, from) { for (const [d, v] of Object.entries(from)) if (into[d] == null || v < into[d]) into[d] = v; }
// Ajoute à P (modifié en place) les séries de travail sets ; allures seulement pour du cardio
function addPriorSets(P, sets, cardio = true) {
  sets.forEach(s => {
    const w = recW(s), r = recR(s), d = recDist(s);
    P.n++;
    if (lexBetter(w, r, P.prW, P.prR)) { P.prW = w; P.prR = r; }
    if (lexBetter(w, r, P.minA, P.rAt, true)) { P.minA = w; P.rAt = r; }
    if (lexBetter(r, w, P.bestT, P.lAtT)) { P.bestT = r; P.lAtT = w; }
    if (r > P.maxMin) P.maxMin = r;
    if (d > P.maxDist) P.maxDist = d;
    const e1 = calc1RM(s.weight, s.reps);
    if (e1 && e1 > P.e1) P.e1 = e1;
    if (!cardio || !(d > 0)) return;
    for (const [kind, kms] of [['pace', RUN_RECORD_KM], ['split', ROW_RECORD_KM]]) {
      const v = kms.some(k => d >= k) ? setPaceSec(s, kind) : null;
      if (v == null) continue;
      kms.forEach(k => { if (d >= k && (P[kind][k] == null || v < P[kind][k])) P[kind][k] = v; });
    }
  });
  return P;
}
// Fusion de deux résumés (nouveau résumé)
function mergePrior(A, B) {
  if (!B || !B.n) return A;
  if (!A || !A.n) return B;
  const P = { ...A, pace: { ...A.pace }, split: { ...A.split } };
  P.n += B.n;
  if (lexBetter(B.prW, B.prR, P.prW, P.prR)) { P.prW = B.prW; P.prR = B.prR; }
  if (lexBetter(B.minA, B.rAt, P.minA, P.rAt, true)) { P.minA = B.minA; P.rAt = B.rAt; }
  if (lexBetter(B.bestT, B.lAtT, P.bestT, P.lAtT)) { P.bestT = B.bestT; P.lAtT = B.lAtT; }
  P.maxMin = Math.max(P.maxMin, B.maxMin);
  P.maxDist = Math.max(P.maxDist, B.maxDist);
  P.e1 = Math.max(P.e1 || 0, B.e1 || 0);
  mergeBest(P.pace, B.pace); mergeBest(P.split, B.split);
  return P;
}

// Répétitions avec charge (ou lest) : charge > reps à la charge record d'avant
function strengthNoted(ex, cur, P) {
  const { prW, prR } = P;
  let best = null;
  cur.forEach(s => {
    const w = recW(s), r = recR(s);
    const rec = w > prW ? { kind: loadKind(ex) === 'lest' ? 'lest' : 'charge', before: prW, after: w }
      : w === prW && r > prR ? { kind: 'reps', before: prR, after: r, w } : null;
    if (rec && betterNoted(rec, best)) best = rec;
  });
  return best ? [best] : [];
}
// Machine d'assistance : moins d'aide à reps ≥ (celles faites avec la plus petite aide d'avant), sinon
// plus de reps à cette même aide
function assistedNoted(cur, P) {
  const { minA, rAt } = P;
  let best = null;
  cur.forEach(s => {
    const w = recW(s), r = recR(s);
    const rec = w < minA && r >= rAt ? { kind: 'aide', before: minA, after: w }
      : w === minA && r > rAt ? { kind: 'reps', before: rAt, after: r, w } : null;
    // Deux séries à moins d'aide : la plus petite aide
    if (rec && (!best || NOTED_RANK[rec.kind] > NOTED_RANK[best.kind] || (rec.kind === best.kind && (rec.kind === 'aide' ? rec.after < best.after : rec.after > best.after)))) best = rec;
  });
  return best ? [best] : [];
}
// Maintien (gainage, chaise…) : lest plus lourd tenu au moins aussi longtemps qu'avec le lest record
// d'avant, sinon tenir plus longtemps avec au moins le lest du maintien record d'avant
function timedNoted(cur, P) {
  const maxL = P.prW, tAtL = P.prR, { bestT, lAtT } = P;
  let best = null;
  cur.forEach(s => {
    const w = recW(s), t = recR(s);
    const rec = w > maxL && t >= tAtL ? { kind: 'lest', before: maxL, after: w }
      : t > bestT && w >= lAtT ? { kind: 'temps', before: bestT, after: t, w } : null;
    if (rec && betterNoted(rec, best)) best = rec;
  });
  return best ? [best] : [];
}
// Cardio : durée la plus longue ; distance la plus longue et allure sur distance fixe seulement là où la
// distance a un sens (course, vélo, rameur : paceKind ; pas l'elliptique ni les escaliers). Plusieurs
// records possibles pour un même exercice (un par type). Distances comparées au centième de km.
function cardioNoted(ex, cur, P) {
  const out = [];
  const C = addPriorSets(emptyPrior(), cur);
  const pMin = P.maxMin, cMin = C.maxMin;
  if (pMin > 0 && cMin > pMin) out.push({ kind: 'duree', before: pMin, after: cMin });
  const pk = paceKind(ex);
  if (!pk) return out;
  if (P.maxDist > 0 && C.maxDist > P.maxDist) out.push({ kind: 'distance', before: P.maxDist, after: C.maxDist });
  if (pk === 'pace' || pk === 'split') {
    // Plus grande distance fixe dont l'allure est battue : un 10 km rapide dit « 10 km », pas « 1 km »
    const fixed = (pk === 'split' ? ROW_RECORD_KM : RUN_RECORD_KM).slice().reverse();
    for (const d of fixed) {
      const b = P[pk][d] ?? null, a = C[pk][d] ?? null;
      if (b != null && a != null && a < b) { out.push({ kind: 'allure', before: b, after: a, d }); break; }
    }
  }
  return out;
}

// Records battus par une séance (entry) contre les séances d'avant de l'historique (history, la séance
// elle-même tolérée). Renvoie au plus NOTED_MAX éléments, les plus marquants d'abord.
function sessionRecords(entry, history) {
  return notedFromPrior(entry, sessionPriorOf(entry, history));
}
// Résumés des séries de travail d'avant une séance (entry : séance de l'historique, ou séance en cours
// { programme, category, date: début }) : priorOf(ex, mesure), même exercice au sens de sameEx, même
// mesure, séances du même programme et de la même séance strictement d'avant. Chaque résumé est calculé
// une fois (les badges en direct le relisent à chaque affichage d'une série).
function sessionPriorOf(entry, history) {
  const prog = entryProg(entry);
  const before = (history || []).filter(h => h && h !== entry && (entry.id == null || h.id !== entry.id) && h.date < entry.date
    && entryProg(h) === prog && h.category === entry.category);
  const memo = new Map();
  return (ex, m = measureOf(ex)) => {
    const k = `${m}\u0000${exIdOf(ex) || ''}\u0000${normName(ex?.name)}`;
    if (!memo.has(k)) memo.set(k, addPriorSets(emptyPrior(), before.flatMap(h => (h.exercises || [])
      .filter(he => sameEx(he, ex) && measureOf(he) === m).flatMap(he => workSets(he.sets).filter(s => recR(s) > 0))), m === 'cardio'));
    return memo.get(k);
  };
}
// Records que des séries (cur, de travail, faites) battent contre le résumé d'avant P, selon la mesure
function exerciseNoted(ex, m, cur, P) {
  return m === 'cardio' ? cardioNoted(ex, cur, P) : m === 'time' ? timedNoted(cur, P)
    : isAssisted(ex) ? assistedNoted(cur, P) : strengthNoted(ex, cur, P);
}
// Élément noté (valeurs arrondies au millième) d'un record r de l'exercice ex
function notedItem(ex, r) {
  return { ex: String(ex.name || '').slice(0, 80), kind: r.kind, before: round3(r.before), after: round3(r.after),
    ...(r.w != null ? { w: round3(r.w) } : {}), ...(r.d != null ? { d: r.d } : {}) };
}
// Cœur de sessionRecords : priorOf(ex, mesure) donne le résumé des séries de travail d'avant de cet
// exercice (même exercice au sens de sameEx, même mesure).
function notedFromPrior(entry, priorOf) {
  const out = [];
  (entry.exercises || []).forEach(ex => {
    const m = measureOf(ex);
    const cur = workSets(ex.sets).filter(s => recR(s) > 0);
    if (!cur.length) return;
    const prior = priorOf(ex, m);
    if (!prior?.n) return;   // première fois : rien
    exerciseNoted(ex, m, cur, prior).forEach(r => out.push(notedItem(ex, r)));
  });
  return out.sort((a, b) => NOTED_RANK[b.kind] - NOTED_RANK[a.kind]).slice(0, NOTED_MAX);
}
// Résumés des séries d'avant tenus au fil d'un parcours chronologique (renoteRecords) : mêmes réponses
// que le filtre de sessionRecords, sans reparcourir l'historique à chaque séance. sameEx : par identifiant
// si les deux exercices en ont un, sinon par nom ; d'où trois index (identifiant ; nom des exercices sans
// identifiant ; nom de tous).
function priorSetsIndex() {
  const byId = new Map(), noIdByName = new Map(), byName = new Map();
  const add = (map, k, sets, cardio) => { let P = map.get(k); if (!P) map.set(k, P = emptyPrior()); addPriorSets(P, sets, cardio); };
  return {
    add(h) {
      (h.exercises || []).forEach(he => {
        const sets = workSets(he.sets).filter(s => recR(s) > 0);
        if (!sets.length) return;
        const m = measureOf(he), id = exIdOf(he), name = `${m}\u0000${normName(he.name)}`;
        add(byName, name, sets, m === 'cardio');
        add(id ? byId : noIdByName, id ? `${m}\u0000${id}` : name, sets, m === 'cardio');
      });
    },
    prior(ex, m) {
      const id = exIdOf(ex), name = `${m}\u0000${normName(ex.name)}`;
      return id ? mergePrior(byId.get(`${m}\u0000${id}`), noIdByName.get(name)) : byName.get(name);
    },
  };
}

// Records d'une séance de l'historique : ceux notés (revalidés : une sauvegarde importée peut contenir
// n'importe quoi, records: [null] par exemple), sinon (séance d'avant les records notés) recalculés
// (legacyRecords, gardés en cache tant que l'historique ne change pas)
function entryRecords(h, history = data.history) {
  return Array.isArray(h?.records) ? cleanNotedRecords(h.records) : legacyRecords(h, history);
}

// Records notés à nouveau pour les séances de la même séance type (programme et séance) que `ref`, à
// partir de sa date : après une séance passée ajoutée, modifiée ou supprimée, celles d'après peuvent
// gagner ou perdre un record. Seules les séances qui ont déjà des records notés sont touchées (les
// anciennes se recalculent à l'affichage). Renvoie le nombre de séances changées.
// Un seul parcours de la séance type (résumés tenus au fil de l'eau) : 1 000 séances synthétiques, pire
// cas (renoter depuis la plus ancienne), environ 30 ms en Node contre 4 s en recalculant chaque séance
// avec sessionRecords (mesure du 31/10/2026).
function renoteRecords(ref, history = data.history) {
  if (!ref) return 0;
  const prog = entryProg(ref);
  // Séances de cette séance type, dans l'ordre chronologique : chacune est comparée aux séries de celles
  // strictement d'avant (index tenu au fil du parcours ; même date : aucune n'est « d'avant » l'autre)
  const same = (history || []).filter(h => h && entryProg(h) === prog && h.category === ref.category).sort((a, b) => a.date - b.date);
  const idx = priorSetsIndex();
  let n = 0;
  for (let i = 0; i < same.length;) {
    let j = i;
    while (j < same.length && same[j].date === same[i].date) j++;
    for (let k = i; k < j; k++) {
      const h = same[k];
      if (!Array.isArray(h.records) || h.date < ref.date) continue;
      const next = notedFromPrior(h, (ex, m) => idx.prior(ex, m));
      if (JSON.stringify(next) !== JSON.stringify(h.records)) { h.records = next; n++; }
    }
    for (let k = i; k < j; k++) idx.add(same[k]);
    i = j;
  }
  return n;
}

// renoteRecords pour plusieurs séances de référence (séances reçues ou supprimées par la synchro) : une
// seule passe par séance type, à partir de la plus ancienne. Renvoie le nombre de séances changées.
function renoteRecordsFrom(refs, history = data.history) {
  const first = new Map();
  (refs || []).forEach(r => {
    if (!r || typeof r.category !== 'string') return;
    const k = `${entryProg(r)}\u0000${r.category}`, cur = first.get(k);
    if (!cur || r.date < cur.date) first.set(k, r);
  });
  let n = 0;
  first.forEach(r => { n += renoteRecords(r, history); });
  return n;
}

// Records reçus du serveur (séance d'un ami ou d'un élève), revalidés : tableau, ou null si la séance
// n'en a pas noté (app d'avant) ; élément invalide écarté. before (valeur d'avant) n'arrive qu'au coach :
// le serveur ne la donne pas aux amis (private.session_records, migration 20261031100000) ; absente,
// l'élément reste valable sans elle.
function cleanNotedRecords(v) {
  if (!Array.isArray(v)) return null;
  const n = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= NOTED_VALUE_MAX;
  return v.slice(0, NOTED_MAX).filter(r => r && typeof r === 'object' && typeof r.ex === 'string' && r.ex.trim()
    && NOTED_KINDS.includes(r.kind) && (r.before === undefined || n(r.before)) && n(r.after) && (r.kind !== 'allure' || RECORD_KM.includes(r.d)))
    .map(r => ({ ex: r.ex.slice(0, 80), kind: r.kind, ...(n(r.before) ? { before: r.before } : {}), after: r.after,
      ...(n(r.w) ? { w: r.w } : {}), ...(RECORD_KM.includes(r.d) ? { d: r.d } : {}) }));
}

// Le plus marquant d'une liste de records notés, null sans
function topNotedRecord(records) {
  return (records || []).reduce((b, r) => (betterNoted(r, b) ? r : b), null);
}

// Records récents de Mon profil : les `max` derniers records notés (entryRecords), un par exercice (le plus
// récent), du plus récent au plus ancien ; dans une même séance, le plus marquant d'abord. Seules les `scan`
// dernières séances sont lues. Une séance notée (h.records) se lit telle quelle ; une séance d'avant les
// records notés se recalcule sur l'historique (sessionRecords relit toute la séance type), une fois tant que
// l'historique garde la même empreinte (legacyRecords) : Mon profil se redessine sans tout recalculer.
// [{ ex, date, r }] (r : élément noté, ex : nom de l'exercice)
function recentRecords(history = data.history, max = 3, scan = 60) {
  const out = [], seen = new Set();
  const latest = (history || []).filter(h => h && Number.isFinite(h.date)).sort((a, b) => b.date - a.date).slice(0, scan);
  for (const h of latest) {
    const recs = entryRecords(h, history).slice().sort((a, b) => NOTED_RANK[b.kind] - NOTED_RANK[a.kind]);
    for (const r of recs) {
      const k = normName(r.ex);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ex: r.ex, date: h.date, r });
      if (out.length >= max) return out;
    }
  }
  return out;
}

// Records recalculés d'une séance d'avant les records notés, gardés par séance tant que l'historique a la
// même empreinte : même tableau, nombre de séances, plus récente, unité et version des données (dataVersion,
// +1 à chaque save(), js/data/store.js : séance passée modifiée, exercice renommé). Même principe que
// muscleLastCache (accueil). Le résultat est partagé : les appelants le copient avant de le trier.
const legacyRecordsCache = new WeakMap();
function legacyRecords(h, history) {
  if (!h || !Array.isArray(history)) return sessionRecords(h, history);
  const key = `${dataVersion}:${history.length}:${history[0]?.id}:${history[0]?.date}:${data.unit}`;
  const hit = legacyRecordsCache.get(h);
  if (hit?.history === history && hit.key === key) return hit.recs;
  const recs = sessionRecords(h, history);
  legacyRecordsCache.set(h, { history, key, recs });
  return recs;
}

// Gain d'un record sur la valeur d'avant, sans signe (la flèche ↑ est dessinée à côté) : « 2,5 kg »,
// « 1 rep », « 15 s », « 5 min », « 1,2 km ». '' sans valeur d'avant, et quand mieux veut dire moins
// (aide, allure) : une flèche montante y tromperait.
function recordGainTxt(r) {
  if (r?.before == null || !(r.after > r.before)) return '';
  const d = round3(r.after - r.before);
  switch (r.kind) {
    case 'charge': case 'lest': return `${fmtW(d)} ${unitLbl()}`;
    case 'reps':     return plural(d, 'rep', 'reps');
    case 'temps':    return fmtSeconds(d);
    case 'duree':    return `${fmtNum(d)} min`;
    case 'distance': return `${fmtNum(d)} km`;
  }
  return '';
}

// ── Badges en direct de la séance ───────────────────────────
// Même calcul que l'enregistrement : les records d'un exercice sont ceux que ses séries de travail faites
// battent ensemble (exerciseNoted) contre le résumé d'avant la séance (sessionPriorOf), et chacun va sur la
// série qui le fait (notedRecordSet : une seule à valeur égale). Ainsi une série qui égale une série plus tôt
// dans la séance n'a pas de badge, et un « Record reps » battu ensuite par un « Record charge » disparaît
// (un seul record par exercice en force). Une série qui fait plusieurs records (cardio) montre le plus
// marquant (allure > distance > durée). Sans record noté pour l'exercice, « Record 1RM est. » sur la série
// que le bilan montrera (e1rmRecordSet), pour soi. Échauffement, série vide, première fois : rien.
// Renvoie une Map série → libellé.
function liveExerciseBadges(ex, prior) {
  const out = new Map();
  if (!ex || !prior?.n) return out;
  const done = workSets(ex.sets).filter(s => s.done && recR(s) > 0);
  if (!done.length) return out;
  const noted = exerciseNoted(ex, measureOf(ex), done, prior), top = new Map();
  noted.forEach(r => {
    const item = notedItem(ex, r), s = pickRecordSet(done, item);
    if (s && (!top.has(s) || NOTED_RANK[item.kind] > NOTED_RANK[top.get(s).kind])) top.set(s, item);
  });
  top.forEach((r, s) => out.set(s, notedLabel(r)));
  const e1s = !noted.length && e1rmRecordSet(ex, prior, done);
  if (e1s) out.set(e1s, 'Record 1RM est.');
  return out;
}
// Badge d'une série validée de l'exercice (liveExerciseBadges) : « Record charge », « Record 5 km »,
// « Record 1RM est. »…, sinon ''
function liveSetBadge(ex, s, prior) {
  return liveExerciseBadges(ex, prior).get(s) || '';
}
// 1RM estimé battu par une série (répétitions avec charge ou lest seulement) : pour soi, jamais noté
function setBeatsE1rm(ex, s, prior) {
  if (!prior?.n || !s || isWarmupSet(s) || measureOf(ex) !== 'reps' || isAssisted(ex)) return false;
  const e1 = calc1RM(s.weight, s.reps);
  return !!e1 && e1 > (prior.e1 || 0);
}
// Série (parmi sets, par défaut les séries de travail de l'exercice) qui bat le plus son 1RM estimé d'avant,
// la première à égalité ; null sans (bilan et badge en direct : « Record 1RM est. »)
function e1rmRecordSet(ex, prior, sets = workSets(ex.sets)) {
  let best = null, top = 0;
  sets.forEach(s => {
    if (!setBeatsE1rm(ex, s, prior)) return;
    const e1 = calc1RM(s.weight, s.reps);
    if (e1 > top) { top = e1; best = s; }
  });
  return best;
}

// Série de l'exercice qui fait un record noté (r), pour la montrer telle quelle (« 62,5 kg × 6 » sur l'image,
// « × 6 répétitions » dans le récap), null si l'exercice n'a pas cette série (record d'un autre exercice du
// même nom, séance modifiée depuis). À valeur égale : le plus de reps (charge, aide), le plus lourd (temps),
// le plus loin (durée, allure), le plus court (distance).
function notedRecordSet(ex, r) {
  return ex && r ? pickRecordSet(workSets(ex.sets).filter(s => recR(s) > 0), r) : null;
}
// Cœur de notedRecordSet : la série de sets (de travail, faites) qui fait le record r, null sans
function pickRecordSet(sets, r) {
  const W = s => round3(recW(s)), pick = (ok, score) => sets.filter(ok).sort((a, b) => score(b) - score(a))[0] || null;
  switch (r.kind) {
    case 'charge': case 'lest': case 'aide': return pick(s => W(s) === r.after, recR);
    case 'reps':     return pick(s => W(s) === (r.w ?? 0) && recR(s) === r.after, () => 0);
    case 'temps':    return pick(s => recR(s) === r.after && W(s) >= (r.w ?? 0), recW);
    case 'duree':    return pick(s => recR(s) === r.after, recDist);
    case 'distance': return pick(s => recDist(s) === r.after, s => -recR(s));
    case 'allure': {
      const pk = ROW_RECORD_KM.includes(r.d) ? 'split' : 'pace';
      return pick(s => recDist(s) >= r.d && setPaceSec(s, pk) === r.after, recDist);
    }
  }
  return null;
}

// ── Textes ──────────────────────────────────────────────────
// « 500 m », « 2 000 m », « 5 km »
function recordDistTxt(d) { return ROW_RECORD_KM.includes(d) ? `${fmtNum(d * 1000)} m` : `${fmtNum(d)} km`; }
// Libellé : « Record charge », « Record 5 km »…
function notedLabel(r, d = r.d) {
  if (r.kind === 'allure') return `Record ${recordDistTxt(d)}`;
  return { charge: 'Record charge', lest: 'Record lest', reps: 'Record reps', aide: 'Record aide', temps: 'Record temps',
    duree: 'Record durée', distance: 'Record distance' }[r.kind] || 'Record';
}
// Valeur d'un record (after, ou before avec which = 'before') : « 100 kg », « +20 kg », « aide 10 kg »,
// « 80 kg × 10 », « 1 min 15 · +10 kg », « 45 min », « 12,5 km », « 4:50 /km »
function notedValueTxt(r, which = 'after') {
  const v = r[which], u = unitLbl(), ex = { name: r.ex };
  switch (r.kind) {
    case 'charge':   return `${fmtW(v)} ${u}`;
    case 'lest':     return v > 0 ? `+${fmtW(v)} ${u}` : 'sans lest';
    case 'aide':     return v > 0 ? `aide ${fmtW(v)} ${u}` : 'sans aide';
    case 'reps': {
      if (!(r.w > 0)) return `${v} reps`;
      const k = loadKind(ex);
      return k === 'lest' ? `${v} reps · +${fmtW(r.w)} ${u}` : k === 'aide' ? `${v} reps · aide ${fmtW(r.w)} ${u}` : `${fmtW(r.w)} ${u} × ${v}`;
    }
    case 'temps':    return `${fmtSeconds(v)}${r.w > 0 ? ` · +${fmtW(r.w)} ${u}` : ''}`;
    case 'duree':    return `${fmtNum(v)} min`;
    case 'distance': return `${fmtNum(v)} km`;
    case 'allure':   return fmtPace(v / 60, ROW_RECORD_KM.includes(r.d) ? 'split' : 'pace');
  }
  return '';
}
// Ligne du fil des amis : « Squat 100 kg », « Course 5 km en 4:50 /km »
function notedFeedTxt(r) {
  return r.kind === 'allure' ? `${r.ex} ${recordDistTxt(r.d)} à ${notedValueTxt(r)}` : `${r.ex} ${notedValueTxt(r)}`;
}
