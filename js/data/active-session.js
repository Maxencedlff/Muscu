// ═══════════════════════════════════════════════════════════
//  Séance en cours : persistée pour survivre à la fermeture de l'app
// ═══════════════════════════════════════════════════════════
'use strict';

let activeSession = null;
let sessionNotes  = '';

const SESSION_KEY = 'ppl_active_session';

let persistWarned = false; // un seul avertissement « stockage plein » par séance
function persistSession() {
  try {
    if (!activeSession) { localStorage.removeItem(SESSION_KEY); return; }
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      activeSession, sessionNotes,
      rest: restActive ? { endTime: restEndTime, minimized: restMinimized, total: restTotal } : null,
    }));
  } catch {
    if (activeSession && !persistWarned) {
      persistWarned = true;
      showToast('Stockage plein : la séance n\'est plus sauvegardée', { error: true });
    }
  }
}

// Records de chaque exercice au démarrage de la séance : les badges s'y comparent
function computeBaseline(sess) {
  const baseline = {};
  const list = data.programmes[sess.programme]?.exercises?.[sess.category] || [];
  sess.exercises.forEach(ex => {
    const exData = ex.exId && list.find(e => e.id === ex.exId);
    if (!exData) return;
    baseline[ex.exId] = {
      prW:  parseFloat(exData.pr?.weight) || 0,
      prR:  parseInt(exData.pr?.reps)     || 0,
      e1rm: exData.est1RM || 0,
    };
  });
  return baseline;
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved?.activeSession?.exercises)) return false;
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
    const endTime = saved.rest ? Number(saved.rest.endTime) : 0;
    if (endTime > Date.now()) {
      restActive    = true;
      restMinimized = !!saved.rest.minimized;
      restEndTime   = endTime;
      restTimeLeft  = Math.ceil((endTime - Date.now()) / 1000);
      restTotal     = Number(saved.rest.total) || Math.max(restTimeLeft, data.defaultRest);
      resumeRestCountdown();
    }
    return true;
  } catch { activeSession = null; return false; }
}

// Programme auquel appartient la séance en cours (peut différer du programme affiché)
function sessProg() {
  return (activeSession && data.programmes[activeSession.programme]) || prog();
}
