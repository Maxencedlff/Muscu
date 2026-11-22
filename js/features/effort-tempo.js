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

// Effort au tempo pour la série si l'exercice en a un ; null sinon. Exercice à un bras ou une jambe (unilateralLimb,
// js/data/unilateral.js) : les deux côtés s'enchaînent (sides: 2), le second avec ses propres reps cibles (reps2 : la
// ligne du second côté si la série est notée par bras, sinon les mêmes)
function tempoEffort(ex, s, ei, si) {
  const tempo = measureOf(ex) === 'reps' && ex.tempoGuide === true ? parseTempo(ex.tempo) : null;
  if (!tempo) return null;
  const prep = tempoPrepOf(ex), reps = num(s.reps, 1, MEASURES.reps.max, true);
  const e = { kind: 'tempo', ei, si, start: Date.now() + prep * 1000, prep, tempo, reps, conFirst: concentricFirst(ex.name) };
  if (unilateralLimb(ex)) {
    e.sides = 2;
    e.reps2 = hasSide2(s) ? num(side2RepsGoal(s), 1, MEASURES.reps.max, true) ?? reps : reps;
  }
  return e;
}

// « Bras gauche · » devant le compteur d'un exercice à un bras, '' sinon
function tempoSidePrefix(e, c) {
  return e.sides === 2 ? `${sideName(activeSession.exercises[e.ei], c.side)} · ` : '';
}
// Reps visées par le côté en cours
const tempoGoal = (e, c) => (c.side === 2 ? e.reps2 ?? e.reps : e.reps);

function updateTempoUI(e) {
  if (e.pausedRep) return;
  const c = tempoClock(e), words = TEMPO_WORDS[e.conFirst ? 'pull' : 'push'];
  const ex = e.sides === 2 ? activeSession.exercises[e.ei] : null;   // exercice à un bras seulement
  const time = $('#effortTime'), sub = $('#effortSub'), stop = $('#effortStop'), bar = $('.sess-sheet--effort .rest-ring__bar');
  const goal = tempoGoal(e, c), side = tempoSidePrefix(e, c), limb = e.sides === 2 ? unilateralLimb(ex) || 'côté' : null;
  if (c.phase === 'prep') {
    if (time) time.innerHTML = `${c.prepLeft}`;
    if (sub) sub.textContent = `${side}Mets-toi en place`;
    if (stop) stop.textContent = 'Commencer';
    if (bar) bar.setAttribute('stroke-dashoffset', RING_BIG * (c.prepLeft / (e.prep || EFFORT_PREP_S)));
  } else if (c.phase === 'switch') {
    if (time) time.innerHTML = `${c.switchLeft}`;
    if (sub) sub.textContent = `Change de ${limb}`;
    if (stop) stop.textContent = 'Commencer';
    if (bar) bar.setAttribute('stroke-dashoffset', RING_BIG * (c.switchLeft / EFFORT_SWITCH_S));
  } else if (c.phase !== 'done') {
    if (time) time.innerHTML = `<span class="tempo__word">${words[c.phase]}</span><span class="tempo__left">${c.phaseLeft}</span>`;
    // « Rep 3 sur 10 » insécable : sur un petit écran, la ligne se coupe après « Bras gauche · »
    if (sub) sub.textContent = side + (goal ? `Rep\u00a0${c.rep}\u00a0sur\u00a0${goal}` : `Rep\u00a0${c.rep}`);
    // Premier côté : le bouton passe au second (comme « Côté suivant » du gainage latéral)
    if (stop) stop.textContent = e.sides === 2 && c.side === 1 ? `${capitalize(limb)} suivant${limb === 'jambe' ? 'e' : ''}` : 'Arrêter';
    if (bar) bar.setAttribute('stroke-dashoffset', goal ? RING_BIG * (1 - (c.rep - 1) / goal) : 0);
  }
  // Un son à chaque seconde, comme un métronome à 60 : le geste de la phase à son début, un coup léger
  // ensuite (« Descends » 3 s : geste, tic, tic) ; « Rep N » annoncé à VoiceOver, sans chaque phase (trop bavard)
  const key = `${c.phase}:${c.side || 1}:${c.rep}:${c.phase === 'prep' ? c.prepLeft : c.phase === 'switch' ? c.switchLeft : c.phaseLeft}`;
  if (key !== effortLastSecond) {
    // Nouvelle répétition : changement de rang ou de côté, ou première phase après la préparation (ou le changement de
    // côté). Le geste de la phase précédé d'un accent, et le numéro dit à voix haute, pour compter sans regarder l'écran
    const [lastPhase, lastSide, lastRep] = String(effortLastSecond || '').split(':');
    const sideChanged = !!lastSide && String(c.side || 1) !== lastSide;
    const fromWait = lastPhase === 'prep' || lastPhase === 'switch';
    const moving = c.phase !== 'prep' && c.phase !== 'switch' && c.phase !== 'done';
    const newRep = moving && (fromWait || sideChanged || c.rep !== Number(lastRep));
    const newPhase = c.phase !== lastPhase || c.rep !== Number(lastRep);
    if (c.phase === 'prep' || c.phase === 'switch') {
      playMelody('tick');
      // Changement de côté : dit et marqué d'une vibration, comme le gainage latéral
      if (c.phase === 'switch' && lastPhase !== 'switch') { announce(`Change de ${limb}, au tour ${limb === 'jambe' ? 'de la' : 'du'} ${sideWord(ex, 2)}`); haptic(); }
    } else if (newRep) {
      playMelody(TEMPO_REP_NOTES[c.phase] || 'tempoRepDown');
      sayCount(c.rep);
      const rep = goal && c.rep === goal ? 'Dernière rep' : `Rep ${c.rep}`;
      announce(e.sides === 2 && (fromWait || sideChanged) ? `${sideName(ex, c.side)}, ${rep.toLowerCase()}` : rep);
      if (fromWait) haptic();
    } else if (moving) playMelody(newPhase ? tempoPhaseNote(e, c.phase) : 'tempoTick');
  }
  effortLastSecond = key;
  if (c.phase === 'done') finishTempo(c.endAt, e.sides === 2 ? c.side1Reps : e.reps, e.sides === 2 ? tempoGoal(e, c) : undefined);
}

// « Commencer » pendant la préparation ou le changement de côté, « Bras suivant » au premier côté d'un exercice à un
// bras (les reps faites sont gardées, puis changement de côté), sinon « Arrêter » : seules les répétitions complètes
// comptent
function stopTempoEarly(e) {
  const c = tempoClock(e), now = Date.now();
  if (c.phase === 'prep' || c.phase === 'switch') {
    if (c.side === 2) e.side2Start = now; else e.start = now;
    if (c.side === 2) e.side1Reps = c.side1Reps;
    persistSession(); updateTempoUI(e); return;
  }
  const done = c.rep - 1;
  if (e.sides === 2 && c.side === 1) {
    if (done < 1) { cancelEffort(); showToast('Aucune rep complète'); return; }
    Object.assign(e, { side1Reps: done, side2Start: now + EFFORT_SWITCH_S * 1000 });
    delete e.side2Prep;
    persistSession(); updateTempoUI(e); return;
  }
  if (e.sides === 2) { finishTempo(now, c.side1Reps, done >= 1 ? done : null); return; }
  if (done < 1) { cancelEffort(); showToast('Aucune rep complète'); return; }
  finishEffort(now, done);
}

// Fin d'une série guidée au tempo. Un seul côté (reps2 undefined) : comme le chrono d'effort. Exercice à un bras :
// reps1 et reps2 (null : second côté arrêté sans rep complète, il reste à noter à la main). Les deux côtés pareils et
// la série notée sur une ligne : une ligne, comme avant ; sinon la série passe par bras (tout l'exercice, exSides,
// js/data/unilateral.js) et le second côté est validé avec ses reps. Le repos part après le second côté seulement.
function finishTempo(endAt, reps1, reps2) {
  if (reps2 === undefined) { finishEffort(endAt, reps1); return; }
  const e = activeSession?.effort;
  if (!e) return;
  const ex = activeSession.exercises[e.ei], s = ex?.sets[e.si];
  if (!s || s.done) { finishEffort(endAt, reps1); return; }
  if (!hasSide2(s) && reps2 === reps1) { finishEffort(endAt, reps1); return; }
  // « Annuler » remet les seconds côtés de l'exercice comme avant (le bandeau de validateSet)
  const before = workSets(ex.sets).map(x => [x, x.side2 ? clone(x.side2) : undefined]);
  if (!hasSide2(s)) exSides(ex);
  const x = s.side2;
  if (reps2 != null) {
    if (x.auto) x.weight = s.weight ?? '';
    delete x.auto;
    Object.assign(x, { reps: String(reps2), done: true });
  }
  finishEffort(endAt, reps1, { undoSides: () => before.forEach(([y, v]) => { if (v) y.side2 = v; else delete y.side2; }) });
}

// App en arrière-plan : impossible de guider sans les bips, la série se met en pause à la répétition
// en cours (l'horloge s'arrête : sur Android et le web les minuteries tournent encore) ; au retour,
// nouvelle préparation puis reprise à cette répétition, du même côté
function pauseTempo(e) {
  const c = tempoClock(e);
  if (c.phase === 'done') return;
  e.pausedRep = c.rep;
  if (e.sides === 2) { e.pausedSide = c.side; if (c.side === 2) e.side1Reps = c.side1Reps; }
  clearInterval(effortInterval); effortInterval = null;
  persistSession();
}
function resumeTempoAfterPause(e) {
  if (!e.pausedRep) return;
  const at = Date.now() + (e.prep || EFFORT_PREP_S) * 1000;
  if (e.sides === 2 && e.pausedSide === 2) Object.assign(e, { firstRep2: e.pausedRep, side2Start: at, side2Prep: true });
  else { e.firstRep = e.pausedRep; e.start = at; delete e.side2Start; delete e.side1Reps; }
  delete e.pausedRep; delete e.pausedSide;
  effortLastSecond = null;
  persistSession();
}
