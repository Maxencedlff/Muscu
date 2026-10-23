// ═══════════════════════════════════════════════════════════
//  Partage de séance : chiffres de l'image (logique pure)
// ═══════════════════════════════════════════════════════════
'use strict';

// Tout ce que montre l'image partagée, calculé à partir d'une entrée d'historique, sans dessin
// ni DOM : testé par tests/unit/run.mjs. Les textes sont déjà formatés (unité de l'utilisateur,
// virgule française) et bruts : le canvas les écrit tels quels, l'aperçu les passe par esc().

const SHARE_MAX_HIGHLIGHTS = 5;   // exercices mis en avant au plus (l'image en montre 3 à 5 selon la place)

// Exercice mis en avant : record marquant, sinon meilleure série (« 32,5 kg × 8 », « 12 reps »)
function shareExerciseRow(ex, base, index, bodyKg = null) {
  const rec  = exerciseRecord(ex, base);
  const best = rec ? bestSet([rec.s], ex) : bestSet(ex.sets, ex);
  return {
    index, name: ex.name, exId: ex.exId || null,
    value:  best ? setTxt(best, ex) : '',
    record: rec ? rec.label : null,
    volume: exVolume(ex, ex.sets, bodyKg),
  };
}

// Exercices clés : d'abord les records (le plus marquant d'abord), puis le plus gros volume,
// remis dans l'ordre de la séance pour se lire comme elle s'est déroulée.
function shareHighlights(rows, max = SHARE_MAX_HIGHLIGHTS) {
  const rank = r => (r.record ? RECORD_RANK[r.record] * 1e9 : 0) + r.volume;
  return rows.filter(r => r.value)
    .sort((a, b) => rank(b) - rank(a) || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index);
}

// entry : séance de l'historique. baseline : records d'avant la séance ({ [exId]: { prW, prR, e1rm } }) ;
// absente (séance de l'historique), elle est reconstituée depuis les séances antérieures.
function shareStoryStats(entry, { history = data.history, baseline = null, max = SHARE_MAX_HIGHLIGHTS } = {}) {
  const prog      = entry.programme || 'ppl';
  const base      = baseline || historyBaseline(entry, history);
  const exercises = (entry.exercises || []).filter(ex => (ex.sets || []).length);
  const rows      = exercises.map((ex, i) => shareExerciseRow(ex, base[recordKey(ex)], i, entryBodyKg(entry)));
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
    sets:     exercises.reduce((a, ex) => a + ex.sets.length, 0),
    records:  rows.filter(r => r.record).length,
    highlights,
    others:   exercises.length - highlights.length,
    exercises: exercises.map(ex => ({ exId: ex.exId || null, name: ex.name })),   // exercices faits
    muscles:  sessionTopMuscles(entry).map(muscleLabel),             // « Pectoraux », pour VoiceOver
  };
}

// « 2 records battus », « Nouveau record »
function shareRecordsText(n) {
  return n > 1 ? `${n} records battus` : 'Nouveau record';
}

// « pectoraux, triceps et épaules antérieures » (Intl.ListFormat, voir MDN)
const SHARE_LIST_FR = new Intl.ListFormat('fr-FR', { type: 'conjunction' });

// Description de l'image pour VoiceOver : « Push, samedi 17 octobre. 52 min, 8,4 t, 18 séries,
// 2 records battus. Muscles travaillés : pectoraux, triceps et épaules antérieures. »
function shareStoryAlt(st) {
  const parts = [st.duration, st.volume, plural(st.sets, 'série', 'séries')].filter(Boolean);
  if (st.records) parts.push(shareRecordsText(st.records));
  const muscles = (st.muscles || []).map(m => m.toLocaleLowerCase('fr-FR'));
  const tail = muscles.length ? ` Muscles travaillés : ${SHARE_LIST_FR.format(muscles)}.` : '';
  return `${st.title}, ${st.day}. ${parts.join(', ')}.${tail}`;
}

// Nom du fichier partagé : « mdlf-training-push-2026-10-17.png » (clé de séance : [A-Za-z0-9_-])
function shareFileName(entry) {
  const cat = String(entry.category || 'seance').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'seance';
  return `mdlf-training-${cat}-${localISO(entry.date)}.png`;
}
