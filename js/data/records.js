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
// Renvoie { label, s } ou null.
function exerciseRecord(ex, base) {
  const score = s => (parseFloat(s.weight) || 0) * 100 + (+s.reps);
  let rec = null;
  (ex.sets || []).forEach(s => {
    const l = recordLabel(s, base, ex);
    if (!l) return;
    const rank = RECORD_RANK[l], best = rec && RECORD_RANK[rec.label];
    if (!rec || rank > best || (rank === best && score(s) > score(rec.s))) rec = { label: l, s };
  });
  return rec;
}

// Clé d'un exercice dans une ligne de base (exercice sans exId : son nom normalisé)
function recordKey(ex) { return ex.exId || 'n:' + normName(ex.name); }

// Records d'avant une séance de l'historique, par exId : mêmes règles que recomputePRFromHistory
// (même programme et même séance, séances strictement antérieures). Sert à retrouver les records
// battus par une séance passée, dont la ligne de base n'a pas été conservée.
function historyBaseline(entry, history) {
  const prog = entry.programme || 'ppl';
  const before = (history || []).filter(h => h !== entry && h.date < entry.date
    && (h.programme || 'ppl') === prog && h.category === entry.category);
  const baseline = {};
  (entry.exercises || []).forEach(ex => {
    if (measureOf(ex) !== 'reps' || isAssisted(ex)) return;
    let prW = 0, prR = 0, e1rm = 0, seen = false;
    before.forEach(h => (h.exercises || []).forEach(he => {
      if (!sameEx(he, ex)) return;
      (he.sets || []).forEach(s => {
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
