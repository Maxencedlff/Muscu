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

// Séries d'avant la séance en cours, résumées par exercice (sessionPriorOf, js/data/records.js) : les badges
// de record s'y comparent avec les règles des records notés à l'enregistrement, donc annoncent exactement ce
// qui sera noté (charge, lest, reps, aide, temps, durée, distance, allure ; égaler n'est jamais battre).
// Toute la séance est « d'après » l'historique (séances passées seulement : jamais de date future), d'où
// date: maintenant. Recalculé quand la séance ou l'historique change (séance reçue par la synchro, séance
// passée ajoutée ou supprimée) ; une séance passée corrigée sur place pendant la séance n'est relue qu'au
// prochain changement de l'historique (rare, et l'enregistrement recalcule tout).
let livePriorCache = null;
function livePrior(ex) {
  if (!activeSession) return null;
  const h = data.history || [], c = livePriorCache;
  if (!c || c.sess !== activeSession || c.hist !== h || c.n !== h.length) {
    livePriorCache = { sess: activeSession, hist: h, n: h.length,
      of: sessionPriorOf({ programme: activeSession.programme, category: activeSession.category, date: Date.now() }, h) };
  }
  return livePriorCache.of(ex);
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
      // Exercice sans mesure (la séance écrit la sienne depuis longtemps : startSession, feuille d'ajout) d'une
      // donnée d'avant le schéma 6 : les mots de cardio appris depuis ne le font pas changer de mesure
      pinLegacyCardioWords(ex, loadedSchema);
      if (ex.sets.some(st => !('prev' in st))) {
        const last = lastPerf(activeSession.programme, activeSession.category, ex);
        ex.sets.forEach((st, i) => {
          if (!('prev' in st)) st.prev = last?.ex.sets[i] ? { weight: last.ex.sets[i].weight, reps: last.ex.sets[i].reps } : null;
        });
      }
    });
    return { rest: saved.rest || null };
  } catch { activeSession = null; return null; }
}

// Programme auquel appartient la séance en cours (peut différer du programme affiché)
function sessProg() {
  return (activeSession && data.programmes[activeSession.programme]) || prog();
}
