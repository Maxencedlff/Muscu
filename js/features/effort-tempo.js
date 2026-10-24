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
// Notes courtes et douces (le son natif coupe la note précédente : moins de 0,2 s chacune)
const TEMPO_NOTES = { ecc: 'tempoDown', con: 'tempoUp' };

// Effort au tempo pour la série si l'exercice en a un ; null sinon
function tempoEffort(ex, s, ei, si) {
  const tempo = measureOf(ex) === 'reps' ? parseTempo(ex.tempo) : null;
  if (!tempo) return null;
  return { kind: 'tempo', ei, si, start: Date.now() + EFFORT_PREP_S * 1000, tempo,
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
    if (bar) bar.setAttribute('stroke-dashoffset', RING_BIG * (c.prepLeft / EFFORT_PREP_S));
  } else if (c.phase !== 'done') {
    if (time) time.innerHTML = `<span class="tempo__word">${words[c.phase]}</span><span class="tempo__left">${c.phaseLeft}</span>`;
    if (sub) sub.textContent = e.reps ? `Rep ${c.rep} sur ${e.reps}` : `Rep ${c.rep}`;
    if (stop) stop.textContent = 'Terminer';
    if (bar) bar.setAttribute('stroke-dashoffset', e.reps ? RING_BIG * (1 - (c.rep - 1) / e.reps) : 0);
  }
  // Une note au début de la descente et de la montée (« X » : double note), rien aux pauses ;
  // « Rep N » annoncé à VoiceOver, sans chaque phase (trop bavard)
  const key = `${c.phase}:${c.rep}:${c.phase === 'prep' ? c.prepLeft : ''}`;
  if (key !== effortLastSecond) {
    if (c.phase === 'prep') playMelody('tick');
    else if (TEMPO_NOTES[c.phase]) playMelody(c.phase === 'con' && e.tempo[2] === 'X' ? 'tempoX' : TEMPO_NOTES[c.phase]);
    // Nouvelle répétition : changement de rang, ou première phase après la préparation
    const [lastPhase, lastRep] = String(effortLastSecond || '').split(':');
    if (c.phase !== 'prep' && c.phase !== 'done' && (lastPhase === 'prep' || c.rep !== Number(lastRep))) {
      announce(e.reps && c.rep === e.reps ? 'Dernière rep' : `Rep ${c.rep}`);
      if (lastPhase === 'prep') haptic();
    }
  }
  effortLastSecond = key;
  if (c.phase === 'done') finishEffort(c.endAt, e.reps);
}

// « Commencer » pendant la préparation, sinon « Terminer » : seules les répétitions complètes comptent
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
  e.start = Date.now() + EFFORT_PREP_S * 1000;
  delete e.pausedRep;
  effortLastSecond = null;
  persistSession();
}
