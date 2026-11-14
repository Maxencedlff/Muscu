// ═══════════════════════════════════════════════════════════
//  Notes courtes : d'exercice (« siège cran 4 »), de série (« épaule gauche ») et de séance (le bilan)
//  Logique pure ; l'écran est dans js/features/session-notes.js. Chargé avant store.js (cleanNote).
//
//  Où elles vivent (champs facultatifs : une version précédente les ignore sans planter) :
//    - séance de l'historique : notes (texte du bilan, existant) ;
//    - exercice de l'historique ou de la séance en cours : note ;
//    - série validée : note.
//  Elles suivent la séance partout où elle va : sauvegarde, copie iCloud, export, synchro du compte
//  (sessionPayload envoie la séance entière, js/data/sync.js). Le serveur ne les transmet jamais aux
//  abonnés (liste blanche private.session_public) ; le coach reçoit la note de séance
//  (private.session_for_coach), les notes d'exercice et de série lui arriveront le jour où cette liste
//  blanche les ajoutera (l'app les lit déjà : cleanCoachSession, js/data/coach.js).
//
//  Une note d'exercice suit le NOM de l'exercice, pas la séance : la fiche de la bibliothèque (alias,
//  ancien nom, pluriel compris) ou, hors bibliothèque, le nom tel quel. « Pec fly » et « Pec deck »
//  partagent leurs notes, quel que soit le programme ou la séance où l'exercice est fait.
// ═══════════════════════════════════════════════════════════
'use strict';

const NOTE_MAX = 140;   // une ligne, lue d'un coup d'œil entre deux séries

// Note d'exercice ou de série : une seule ligne (retours à la ligne et espaces répétés réduits), bornée,
// null si vide ou si ce n'est pas un texte
function cleanNote(v) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX).trim();
  return t || null;
}

// Clé d'un exercice pour ses notes : fiche de la bibliothèque (catalogueEntry, chargé plus tard mais appelé
// seulement à l'usage), sinon le nom renommé ou tel quel, normalisé
function noteKey(name) {
  const e = typeof catalogueEntry === 'function' ? catalogueEntry(name || '') : null;
  return normName(e ? e.name : typeof currentExerciseName === 'function' ? currentExerciseName(name || '') : name || '');
}

// Index des notes d'exercice de l'historique : clé → [{ text, date, hid, xi }] du plus récent au plus ancien.
// Gardé tant que l'historique ne change pas (dataVersion, +1 à chaque save())
let noteIndexMemo = null;
function exerciseNoteIndex(history = data.history) {
  const h = history || [];
  const ver = typeof dataVersion === 'number' ? dataVersion : 0;
  if (noteIndexMemo && noteIndexMemo.h === h && noteIndexMemo.ver === ver && noteIndexMemo.n === h.length) return noteIndexMemo.map;
  const map = new Map();
  h.slice().sort((a, b) => (b?.date || 0) - (a?.date || 0)).forEach(entry => (entry?.exercises || []).forEach((ex, xi) => {
    const text = cleanNote(ex?.note);
    if (!text) return;
    const k = noteKey(ex.name);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ text, date: entry.date, hid: entry.id, xi });
  }));
  noteIndexMemo = { h, ver, n: h.length, map };
  return map;
}

// Notes d'un exercice, de la plus récente à la plus ancienne (limit au plus)
function exerciseNotes(name, history = data.history, limit = Infinity) {
  return (exerciseNoteIndex(history).get(noteKey(name)) || []).slice(0, limit);
}
// Dernière note d'un exercice dans l'historique : { text, date, hid, xi } ou null
function lastExerciseNote(name, history = data.history) {
  return exerciseNotes(name, history, 1)[0] || null;
}

// Note de la dernière séance du même type (même programme, même séance) : { text, date, hid } ou null.
// Seulement celle de la DERNIÈRE fois : une note plus ancienne ne parle plus de la séance qui vient.
function lastSessionNote(progKey, cat, history = data.history) {
  const last = (history || []).filter(h => h && h.category === cat && entryProg(h) === progKey)
    .reduce((best, h) => (!best || h.date > best.date ? h : best), null);
  const text = last && typeof last.notes === 'string' ? last.notes.trim() : '';
  return text ? { text, date: last.date, hid: last.id } : null;
}

// Notes de série d'un exercice : [{ si, label: « Série 2 » / « Échauffement 1 », text }]
function setNotesOf(ex) {
  const sets = ex?.sets || [];
  return sets.map((s, si) => ({ s, si })).filter(({ s }) => cleanNote(s?.note)).map(({ s, si }) => ({
    si, text: cleanNote(s.note),
    label: s.warmup === true ? `Échauffement ${sets.slice(0, si + 1).filter(x => x?.warmup === true).length}` : `Série ${setDisplayNo(sets, si)}`,
  }));
}

// Retire une note d'exercice de l'historique (« Effacer » sur « Dernière note »). Renvoie true si elle y était.
function clearHistoryExerciseNote(hid, xi, history = data.history) {
  const ex = (history || []).find(h => h?.id === hid)?.exercises?.[xi];
  if (!ex || ex.note === undefined) return false;
  delete ex.note;
  return true;
}
