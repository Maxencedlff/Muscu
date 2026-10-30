// ═══════════════════════════════════════════════════════════
//  Partage de séance : chiffres de l'image (logique pure)
// ═══════════════════════════════════════════════════════════
'use strict';

// Tout ce que montre l'image partagée, calculé à partir d'une entrée d'historique, sans dessin
// ni DOM : testé par tests/unit/run.mjs. Les textes sont déjà formatés (unité de l'utilisateur,
// virgule française) et bruts : le canvas les écrit tels quels, l'aperçu les passe par esc().

const SHARE_MAX_HIGHLIGHTS = 30;  // tous les exercices de la séance (l'image passe en lignes compactes s'il le faut)

// Séries toutes pareilles : « 3 × 15 reps », compact et exact. Séries différentes : le DÉTAIL
// (« 6 · 6 · 6 · 7 reps »), jamais la meilleure suivie du nombre de séries, qui se lisait comme si
// toutes valaient la meilleure (6, 6, 6, 7 affiché « 7 reps · 4 séries » laissait croire à 4 × 7).
// Avec une charge, la meilleure série (« 10 kg × 10 ») reste seule quand elles sont identiques.
function withSetCount(txt, ex, best, hasRecord = false) {
  const sets = workSets(ex.sets).filter(s => (parseInt(s.reps) || 0) > 0);
  const m = measureOf(ex);
  // Record mis en avant : on montre LA série du record, pas le détail de toutes
  if (sets.length < 2 || m === 'cardio' || hasRecord) return txt;
  const same = sets.every(s => String(parseInt(s.reps)) === String(parseInt(sets[0].reps)) && (parseFloat(s.weight) || 0) === (parseFloat(sets[0].weight) || 0));
  if (same) return m === 'reps' && best.w > 0 ? txt : `${sets.length} × ${txt}`;
  return setsText(sets, m, setKind(ex));
}

// Exercice mis en avant : record marquant, sinon meilleure série (« 32,5 kg × 8 », « 12 reps »)
function shareExerciseRow(ex, base, index, bodyKg = null) {
  const rec  = exerciseRecord(ex, base);
  const best = rec ? bestSet([rec.s], ex) : bestSet(ex.sets, ex);
  return {
    index, name: ex.name, exId: ex.exId || null,
    value:  best ? withSetCount(setTxt(best, ex), ex, best, !!rec) : '',
    detail: !!best && !rec && withSetCount(setTxt(best, ex), ex, best, false) !== setTxt(best, ex)
            && !withSetCount(setTxt(best, ex), ex, best, false).startsWith(`${workSets(ex.sets).filter(x => (parseInt(x.reps) || 0) > 0).length} × `),
    record: rec ? rec.label : null,
    volume: exVolume(ex, ex.sets, bodyKg),
  };
}

// Blocs de la liste : un exercice seul [row], ou les exercices d'un même superset (row.group) côte à côte
function shareUnits(rows) {
  const units = [];
  rows.forEach(r => {
    const prev = units.at(-1);
    if (prev && r.group != null && prev[0].group === r.group) prev.push(r); else units.push([r]);
  });
  return units;
}

// Exercices clés : d'abord les records (le plus marquant d'abord), puis le plus gros volume,
// remis dans l'ordre de la séance pour se lire comme elle s'est déroulée. Un superset compte comme
// un seul bloc (rang de son meilleur exercice) et n'est jamais coupé.
// Rang d'un bloc (exercice seul ou superset) : record le plus marquant, sinon plus gros volume
function shareUnitRank(u) {
  return Math.max(...u.map(r => (r.record ? RECORD_RANK[r.record] * 1e9 : 0) + r.volume));
}

function shareHighlights(rows, max = SHARE_MAX_HIGHLIGHTS) {
  return shareUnits(rows.filter(r => r.value))
    .sort((a, b) => shareUnitRank(b) - shareUnitRank(a) || a[0].index - b[0].index)
    .slice(0, max)
    .sort((a, b) => a[0].index - b[0].index)
    .flat();
}

// entry : séance de l'historique. baseline : records d'avant la séance ({ [exId]: { prW, prR, e1rm } }) ;
// absente (séance de l'historique), elle est reconstituée depuis les séances antérieures.
function shareStoryStats(entry, { history = data.history, baseline = null, max = SHARE_MAX_HIGHLIGHTS } = {}) {
  const prog      = entryProg(entry);
  const base      = baseline || historyBaseline(entry, history);
  const all       = entry.exercises || [];
  // Supersets de la séance complète (ssBlocks) : un exercice sans série n'en coupe pas le groupe
  const groupOf   = {};
  ssBlocks(all).forEach(b => { if (b.length > 1) b.forEach(oi => { groupOf[oi] = { id: b[0], kind: ssKind(b.length) }; }); });
  const done      = all.map((ex, oi) => ({ ex, oi })).filter(({ ex }) => (ex.sets || []).length);
  const exercises = done.map(d => d.ex);
  const rows      = done.map(({ ex, oi }, i) => {
    const row = shareExerciseRow(ex, base[recordKey(ex)], i, entryBodyKg(entry));
    // Exercice d'un superset : son groupe et le détail de ses séries (seulement là : séance sans
    // superset inchangée)
    if (groupOf[oi]) Object.assign(row, { group: groupOf[oi].id, kind: groupOf[oi].kind, sets: setsText(ex.sets, measureOf(ex), setKind(ex), { unitEach: true }) });
    return row;
  });
  const volume    = sessionVolume(exercises, entryBodyKg(entry));
  const sameYear  = new Date(entry.date).getFullYear() === new Date().getFullYear();
  const highlights = shareHighlights(rows, max);
  return {
    title:    rawLabel(entry.category, prog),
    color:    sessionMeta(entry.category, prog).color || 'var(--label2)',
    day:      fmtDate(entry.date, sameYear ? 'day' : 'long'),      // « samedi 17 octobre »
    time:     entry.duration ? fmtTime(entry.date) : '',          // une séance passée n'a pas d'heure
    duration: entry.duration ? fmtDuration(entry.duration) : null,
    volume:   volume > 0 ? fmtVolume(volume) : null,
    sets:     exercises.reduce((a, ex) => a + workSets(ex.sets).length, 0),   // séries de travail
    records:  rows.filter(r => r.record).length,
    highlights,
    others:   exercises.length - highlights.length,
    exercises: exercises.map(ex => ({ exId: ex.exId || null, name: ex.name })),   // exercices faits
    muscles:  sessionTopMuscles(entry).map(muscleLabel),             // « Pectoraux », pour VoiceOver
    supersets: shareSupersets(all),                                  // pour VoiceOver
  };
}

// Groupes de la séance, dans l'ordre, avec le détail des séries de chaque exercice (VoiceOver) :
// [{ kind: 'Superset', names: ['Curl biceps (12 kg × 10 · 10)', 'Extension triceps (20 kg × 12)'] }]
function shareSupersets(xs) {
  const named = ex => {
    const sets = (ex.sets || []).length ? setsText(ex.sets, measureOf(ex), setKind(ex), { unitEach: true }) : '—';
    return sets === '—' ? ex.name : `${ex.name} (${sets})`;
  };
  return ssBlocks(xs).filter(b => b.length > 1).map(b => ({ kind: ssKind(b.length), names: b.map(i => named(xs[i])) }));
}

// « 2 records battus », « Nouveau record »
function shareRecordsText(n) {
  return n > 1 ? `${n} records battus` : 'Nouveau record';
}

// « pectoraux, triceps et épaules antérieures » (Intl.ListFormat, voir MDN)
const SHARE_LIST_FR = new Intl.ListFormat('fr-FR', { type: 'conjunction' });

// Description de l'image pour VoiceOver : « Push, samedi 17 octobre. 52 min, 8,4 t, 18 séries,
// 2 records battus. Superset : Curl biceps (12 kg × 10 · 10) et Extension triceps (20 kg × 12).
// Muscles travaillés : pectoraux, triceps et épaules antérieures. »
function shareStoryAlt(st) {
  const parts = [st.duration, st.volume, plural(st.sets, 'série', 'séries')].filter(Boolean);
  if (st.records) parts.push(shareRecordsText(st.records));
  const groups = (st.supersets || []).map(g => ` ${g.kind} : ${SHARE_LIST_FR.format(g.names)}.`).join('');
  const muscles = (st.muscles || []).map(m => m.toLocaleLowerCase('fr-FR'));
  const tail = muscles.length ? ` Muscles travaillés : ${SHARE_LIST_FR.format(muscles)}.` : '';
  return `${st.title}, ${st.day}. ${parts.join(', ')}.${groups}${tail}`;
}

// Nom du fichier partagé : « mdlf-training-push-2026-10-17.png » (clé de séance : [A-Za-z0-9_-])
function shareFileName(entry) {
  const cat = String(entry.category || 'seance').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'seance';
  return `mdlf-training-${cat}-${localISO(entry.date)}.png`;
}
