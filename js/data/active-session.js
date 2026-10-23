// ═══════════════════════════════════════════════════════════
//  Séance en cours : persistée pour survivre à la fermeture de l'app
// ═══════════════════════════════════════════════════════════
'use strict';

let activeSession = null;
let sessionNotes  = '';

const SESSION_KEY = 'ppl_active_session';

// Écrit la séance en cours (ou l'efface s'il n'y en a pas). rest : état du repos à reprendre
// ({ endTime, minimized, total }) ou null. Renvoie false si le stockage est plein.
function writeSession(rest = null) {
  try {
    if (!activeSession) { localStorage.removeItem(SESSION_KEY); return true; }
    localStorage.setItem(SESSION_KEY, JSON.stringify({ activeSession, sessionNotes, rest }));
    return true;
  } catch { return false; }
}

// Records de chaque exercice au démarrage de la séance : les badges s'y comparent
function computeBaseline(sess) {
  const baseline = {};
  const list = data.programmes[sess.programme]?.exercises?.[sess.category] || [];
  sess.exercises.forEach(ex => {
    const exData = ex.exId && list.find(e => e.id === ex.exId);
    if (!exData || measureOf(ex) !== 'reps') return;   // durée, cardio : pas de record de charge ni de reps
    baseline[ex.exId] = {
      prW:  parseFloat(exData.pr?.weight) || 0,
      prR:  parseInt(exData.pr?.reps)     || 0,
      e1rm: exData.est1RM || 0,
    };
  });
  return baseline;
}

// Reprend la séance enregistrée : null s'il n'y en a pas, sinon { rest } (repos à relancer, ou null)
function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved?.activeSession?.exercises)) return null;
    activeSession = saved.activeSession;
    sessionNotes  = saved.sessionNotes || '';
    // Séance commencée avec une version précédente : on complète ce qui manque
    if (!activeSession.programme) activeSession.programme = 'ppl';
    if (!activeSession.startedAt) activeSession.startedAt = Date.now();
    activeSession.exercises.forEach(ex => {
      if (!Array.isArray(ex.sets)) ex.sets = [];
      if (ex.sets.some(st => !('prev' in st))) {
        const last = lastPerf(activeSession.programme, activeSession.category, ex);
        ex.sets.forEach((st, i) => {
          if (!('prev' in st)) st.prev = last?.ex.sets[i] ? { weight: last.ex.sets[i].weight, reps: last.ex.sets[i].reps } : null;
        });
      }
    });
    if (!activeSession.baseline) activeSession.baseline = computeBaseline(activeSession);
    return { rest: saved.rest || null };
  } catch { activeSession = null; return null; }
}

// Programme auquel appartient la séance en cours (peut différer du programme affiché)
function sessProg() {
  return (activeSession && data.programmes[activeSession.programme]) || prog();
}
