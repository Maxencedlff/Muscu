// ═══════════════════════════════════════════════════════════
//  Records : badge d'une série, record marquant d'un exercice,
//  records d'avant une séance tirés de l'historique
// ═══════════════════════════════════════════════════════════
'use strict';

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
// les lignes de base sont rangées par exId (computeBaseline) et l'id d'un exercice du programme
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

// Répétitions avec charge (ou lest) : charge > reps à la charge record d'avant
function strengthNoted(ex, cur, prior) {
  let prW = 0, prR = 0;
  prior.forEach(s => { const w = recW(s), r = recR(s); if (w > prW || (w === prW && r > prR)) { prW = w; prR = r; } });
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
function assistedNoted(cur, prior) {
  let minA = Infinity, rAt = 0;
  prior.forEach(s => { const w = recW(s), r = recR(s); if (w < minA || (w === minA && r > rAt)) { minA = w; rAt = r; } });
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
function timedNoted(cur, prior) {
  let maxL = 0, tAtL = 0, bestT = 0, lAtT = 0;
  prior.forEach(s => {
    const w = recW(s), t = recR(s);
    if (w > maxL || (w === maxL && t > tAtL)) { maxL = w; tAtL = t; }
    if (t > bestT || (t === bestT && w > lAtT)) { bestT = t; lAtT = w; }
  });
  let best = null;
  cur.forEach(s => {
    const w = recW(s), t = recR(s);
    const rec = w > maxL && t >= tAtL ? { kind: 'lest', before: maxL, after: w }
      : t > bestT && w >= lAtT ? { kind: 'temps', before: bestT, after: t, w } : null;
    if (rec && betterNoted(rec, best)) best = rec;
  });
  return best ? [best] : [];
}
// Allure d'une série en secondes entières (par km, ou aux 500 m au rameur), null sans allure valable
function setPaceSec(s, kind) {
  const v = cardioPace(s.dist, setMinutes(s), kind);
  return v == null ? null : Math.round(v * 60);
}
// Cardio : durée la plus longue ; distance la plus longue et allure sur distance fixe seulement là où la
// distance a un sens (course, vélo, rameur : paceKind ; pas l'elliptique ni les escaliers). Plusieurs
// records possibles pour un même exercice (un par type). Distances comparées au centième de km.
function cardioNoted(ex, cur, prior) {
  const out = [];
  const maxOf = (sets, f) => Math.max(0, ...sets.map(f));
  const dist = s => Math.round((parseFloat(s.dist) || 0) * 100) / 100;
  const pMin = maxOf(prior, recR), cMin = maxOf(cur, recR);
  if (pMin > 0 && cMin > pMin) out.push({ kind: 'duree', before: pMin, after: cMin });
  const pk = paceKind(ex);
  if (!pk) return out;
  const pDist = maxOf(prior, dist), cDist = maxOf(cur, dist);
  if (pDist > 0 && cDist > pDist) out.push({ kind: 'distance', before: pDist, after: cDist });
  if (pk === 'pace' || pk === 'split') {
    // Plus grande distance fixe dont l'allure est battue : un 10 km rapide dit « 10 km », pas « 1 km »
    const fixed = (pk === 'split' ? ROW_RECORD_KM : RUN_RECORD_KM).slice().reverse();
    const bestAt = (sets, d) => {
      const v = sets.filter(s => dist(s) >= d).map(s => setPaceSec(s, pk)).filter(x => x != null);
      return v.length ? Math.min(...v) : null;
    };
    for (const d of fixed) {
      const b = bestAt(prior, d), a = bestAt(cur, d);
      if (b != null && a != null && a < b) { out.push({ kind: 'allure', before: b, after: a, d }); break; }
    }
  }
  return out;
}

// Records battus par une séance (entry) contre les séances d'avant de l'historique (history, la séance
// elle-même tolérée). Renvoie au plus NOTED_MAX éléments, les plus marquants d'abord.
function sessionRecords(entry, history) {
  const prog = entryProg(entry);
  const before = (history || []).filter(h => h && h !== entry && h.id !== entry.id && h.date < entry.date
    && entryProg(h) === prog && h.category === entry.category);
  const out = [];
  (entry.exercises || []).forEach(ex => {
    const m = measureOf(ex);
    const cur = workSets(ex.sets).filter(s => recR(s) > 0);
    if (!cur.length) return;
    const prior = before.flatMap(h => (h.exercises || []).filter(he => sameEx(he, ex) && measureOf(he) === m)
      .flatMap(he => workSets(he.sets).filter(s => recR(s) > 0)));
    if (!prior.length) return;   // première fois : rien
    const recs = m === 'cardio' ? cardioNoted(ex, cur, prior) : m === 'time' ? timedNoted(cur, prior)
      : isAssisted(ex) ? assistedNoted(cur, prior) : strengthNoted(ex, cur, prior);
    recs.forEach(r => out.push({ ex: String(ex.name || '').slice(0, 80), kind: r.kind, before: round3(r.before), after: round3(r.after),
      ...(r.w != null ? { w: round3(r.w) } : {}), ...(r.d != null ? { d: r.d } : {}) }));
  });
  return out.sort((a, b) => NOTED_RANK[b.kind] - NOTED_RANK[a.kind]).slice(0, NOTED_MAX);
}

// Records d'une séance de l'historique : ceux notés, sinon (séance d'avant les records notés) recalculés
function entryRecords(h, history = data.history) {
  return Array.isArray(h?.records) ? h.records : sessionRecords(h, history);
}

// Records notés à nouveau pour les séances de la même séance type (programme et séance) que `ref`, à
// partir de sa date : après une séance passée ajoutée, modifiée ou supprimée, celles d'après peuvent
// gagner ou perdre un record. Seules les séances qui ont déjà des records notés sont touchées (les
// anciennes se recalculent à l'affichage). Renvoie le nombre de séances changées.
function renoteRecords(ref, history = data.history) {
  if (!ref) return 0;
  let n = 0;
  (history || []).forEach(h => {
    if (!Array.isArray(h.records) || entryProg(h) !== entryProg(ref) || h.category !== ref.category || h.date < ref.date) return;
    const next = sessionRecords(h, history);
    if (JSON.stringify(next) !== JSON.stringify(h.records)) { h.records = next; n++; }
  });
  return n;
}

// Records reçus du serveur (séance d'un ami ou d'un élève), revalidés : tableau, ou null si la séance
// n'en a pas noté (app d'avant) ; élément invalide écarté
function cleanNotedRecords(v) {
  if (!Array.isArray(v)) return null;
  const n = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= NOTED_VALUE_MAX;
  return v.slice(0, NOTED_MAX).filter(r => r && typeof r === 'object' && typeof r.ex === 'string' && r.ex.trim()
    && NOTED_KINDS.includes(r.kind) && n(r.before) && n(r.after) && (r.kind !== 'allure' || RECORD_KM.includes(r.d)))
    .map(r => ({ ex: r.ex.slice(0, 80), kind: r.kind, before: r.before, after: r.after,
      ...(n(r.w) ? { w: r.w } : {}), ...(RECORD_KM.includes(r.d) ? { d: r.d } : {}) }));
}

// Le plus marquant d'une liste de records notés, null sans
function topNotedRecord(records) {
  return (records || []).reduce((b, r) => (betterNoted(r, b) ? r : b), null);
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
