// ═══════════════════════════════════════════════════════════
//  Série guidée au tempo (exercice en répétitions avec un tempo, ex. 3-1-1)
//  Même circuit que le chrono d'effort (js/features/effort.js) : ▶, préparation, guidage, série
//  validée et repos lancé. Ici : phase en cours en grand, une note par phase, compteur de reps.
// ═══════════════════════════════════════════════════════════
'use strict';

// Mots des phases, selon que le mouvement commence en poussant (développé) ou en tirant (traction)
const TEMPO_WORDS = {
  push: { ecc: 'Descends', bottom: 'Tiens', con: 'Pousse', top: 'Tiens' },
  pull: { con: 'Tire', top: 'Tiens', ecc: 'Relâche', bottom: 'Tiens' },
};
// Sons des phases (js/core/haptics-audio.js) : un geste qui descend ou qui monte au début du mouvement,
// un coup léger au début des pauses et à chaque seconde d'une phase longue. Tous durent moins de 0,4 s :
// le son natif coupe le précédent, et il en part au plus un par seconde.
const TEMPO_NOTES = { ecc: 'tempoDown', con: 'tempoUp', bottom: 'tempoTick', top: 'tempoTick' };
const TEMPO_REP_NOTES = { ecc: 'tempoRepDown', con: 'tempoRepUp' };
// Son du début d'une phase : montée « X » à part (aussi vite que possible)
function tempoPhaseNote(e, phase) { return phase === 'con' && e.tempo[2] === 'X' ? 'tempoX' : TEMPO_NOTES[phase]; }

// Effort au tempo pour la série si l'exercice en a un ; null sinon
function tempoEffort(ex, s, ei, si) {
  const tempo = measureOf(ex) === 'reps' && ex.tempoGuide === true ? parseTempo(ex.tempo) : null;
  if (!tempo) return null;
  const prep = tempoPrepOf(ex);
  return { kind: 'tempo', ei, si, start: Date.now() + prep * 1000, prep, tempo,
           reps: num(s.reps, 1, MEASURES.reps.max, true), conFirst: concentricFirst(ex.name) };
}

function updateTempoUI(e) {
  if (e.pausedRep) return;
  const c = tempoClock(e), words = TEMPO_WORDS[e.conFirst ? 'pull' : 'push'];
  const time = $('#effortTime'), sub = $('#effortSub'), stop = $('#effortStop'), bar = $('.sess-sheet--effort .rest-ring__bar');
  if (c.phase === 'prep') {
    if (time) time.innerHTML = `${c.prepLeft}`;
    if (sub) sub.textContent = 'Mets-toi en place';
    if (stop) stop.textContent = 'Commencer';
    if (bar) bar.setAttribute('stroke-dashoffset', RING_BIG * (c.prepLeft / (e.prep || EFFORT_PREP_S)));
  } else if (c.phase !== 'done') {
    if (time) time.innerHTML = `<span class="tempo__word">${words[c.phase]}</span><span class="tempo__left">${c.phaseLeft}</span>`;
    if (sub) sub.textContent = e.reps ? `Rep ${c.rep} sur ${e.reps}` : `Rep ${c.rep}`;
    if (stop) stop.textContent = 'Arrêter';
    if (bar) bar.setAttribute('stroke-dashoffset', e.reps ? RING_BIG * (1 - (c.rep - 1) / e.reps) : 0);
  }
  // Un son à chaque seconde, comme un métronome à 60 : le geste de la phase à son début, un coup léger
  // ensuite (« Descends » 3 s : geste, tic, tic) ; « Rep N » annoncé à VoiceOver, sans chaque phase (trop bavard)
  const key = `${c.phase}:${c.rep}:${c.phase === 'prep' ? c.prepLeft : c.phaseLeft}`;
  if (key !== effortLastSecond) {
    // Nouvelle répétition : changement de rang, ou première phase après la préparation. Le geste de la
    // phase précédé d'un accent, et le numéro dit à voix haute, pour compter sans regarder l'écran
    const [lastPhase, lastRep] = String(effortLastSecond || '').split(':');
    const newRep = c.phase !== 'prep' && c.phase !== 'done' && (lastPhase === 'prep' || c.rep !== Number(lastRep));
    const newPhase = c.phase !== lastPhase || c.rep !== Number(lastRep);
    if (c.phase === 'prep') playMelody('tick');
    else if (newRep) {
      playMelody(TEMPO_REP_NOTES[c.phase] || 'tempoRepDown');
      sayCount(c.rep);
      announce(e.reps && c.rep === e.reps ? 'Dernière rep' : `Rep ${c.rep}`);
      if (lastPhase === 'prep') haptic();
    } else if (c.phase !== 'done') playMelody(newPhase ? tempoPhaseNote(e, c.phase) : 'tempoTick');
  }
  effortLastSecond = key;
  if (c.phase === 'done') finishEffort(c.endAt, e.reps);
}

// « Commencer » pendant la préparation, sinon « Arrêter » : seules les répétitions complètes comptent
function stopTempoEarly(e) {
  const c = tempoClock(e), now = Date.now();
  if (c.phase === 'prep') { e.start = now; persistSession(); updateTempoUI(e); return; }
  const done = c.rep - 1;
  if (done < 1) { cancelEffort(); showToast('Aucune répétition complète'); return; }
  finishEffort(now, done);
}

// App en arrière-plan : impossible de guider sans les bips, la série se met en pause à la répétition
// en cours (l'horloge s'arrête : sur Android et le web les minuteries tournent encore) ; au retour,
// nouvelle préparation de 5 s puis reprise à cette répétition
function pauseTempo(e) {
  const c = tempoClock(e);
  if (c.phase === 'done') return;
  e.pausedRep = c.rep;
  clearInterval(effortInterval); effortInterval = null;
  persistSession();
}
function resumeTempoAfterPause(e) {
  if (!e.pausedRep) return;
  e.firstRep = e.pausedRep;
  e.start = Date.now() + (e.prep || EFFORT_PREP_S) * 1000;
  delete e.pausedRep;
  effortLastSecond = null;
  persistSession();
}
