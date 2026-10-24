// ═══════════════════════════════════════════════════════════
//  Chrono d'effort : séries mesurées en durée (gainage, chaise, L-sit, suspension…)
//  ▶ sur la série en cours → préparation → effort → série validée → repos lancé tout seul
// ═══════════════════════════════════════════════════════════
'use strict';

// État dans la séance (persisté avec elle, repris après un rechargement) :
// activeSession.effort = { ei, si, start, target, sides, side1Held?, side2Start? } : voir effortClock
// (js/data/effort-clock.js) ; sides = 2 pour un exercice tenu d'un côté puis de l'autre.
// Tout se calcule depuis les horodatages : le chrono reste juste si l'app passe en arrière-plan.
let effortInterval = null;
let effortLastSecond = null;  // dernière seconde affichée (bips et annonces une seule fois)

// Effort encore valable (série existante, à faire, mesurée en durée) ; sinon il est abandonné
function effortStillValid() {
  const e = activeSession?.effort;
  const ex = e && activeSession.exercises[e.ei], s = ex?.sets[e.si];
  return !!(s && !s.done && measureOf(ex) === 'time' && Number.isFinite(e.start));
}

function effortSheetHtml() {
  const e = activeSession.effort, ex = activeSession.exercises[e.ei];
  return `
    <div class="rs rs--effort">
      <div class="rs__top">
        <button class="rs__collapse rs__collapse--left" data-action="cancel-effort">Annuler</button>
        <h2 class="rs__title" tabindex="-1">${esc(ex.name)}</h2>
      </div>
      <div class="rs__ring">
        <svg class="rest-ring rest-ring--big" viewBox="0 0 220 220" aria-hidden="true">
          <circle cx="110" cy="110" r="100" class="rest-ring__track"/>
          <circle cx="110" cy="110" r="100" class="rest-ring__bar" stroke-dasharray="${RING_BIG}" stroke-dashoffset="${RING_BIG}"/>
        </svg>
        <div class="rs__center">
          <div class="rs__time num" role="timer" aria-live="off" id="effortTime"></div>
          <div class="rs__resume" id="effortSub"></div>
          <div class="rs__resume">Série ${e.si + 1} sur ${ex.sets.length}</div>
        </div>
      </div>
      <div class="rs__adj">
        <button class="rs__skip rs__done" data-action="stop-effort" id="effortStop">Terminer</button>
      </div>
      ${ex.sets[e.si].prev?.reps ? `<div class="rs__next">Dernière fois : ${fmtSeconds(ex.sets[e.si].prev.reps)}</div>` : ''}
    </div>`;
}

function updateEffortUI() {
  if (!effortStillValid()) { cancelEffort(); return; }
  const e = activeSession.effort, c = effortClock(e), two = e.sides === 2;
  const time = $('#effortTime'), sub = $('#effortSub'), bar = $('.sess-sheet--effort .rest-ring__bar'), stop = $('#effortStop');
  const sideTxt = two ? `Côté ${c.side} · ` : '';
  if (c.phase === 'prep') {
    if (time) time.textContent = String(c.prepLeft);
    if (sub) sub.textContent = 'Mets-toi en position';
    if (stop) stop.textContent = 'Commencer';
    if (bar) bar.setAttribute('stroke-dashoffset', RING_BIG * (c.prepLeft / EFFORT_PREP_S));
  } else if (c.phase === 'switch') {
    if (time) time.textContent = String(c.switchLeft);
    if (sub) sub.textContent = 'Change de côté';
    if (stop) stop.textContent = 'Commencer';
    if (bar) bar.setAttribute('stroke-dashoffset', RING_BIG * (c.switchLeft / EFFORT_SWITCH_S));
  } else {
    if (time) time.textContent = fmtRest(e.target ? c.left : c.elapsed);
    if (sub) sub.textContent = sideTxt + (e.target ? `Objectif ${fmtSeconds(e.target)}` : 'Chrono libre');
    if (stop) stop.textContent = two && c.side === 1 ? 'Côté suivant' : 'Terminer';
    if (bar) bar.setAttribute('stroke-dashoffset', e.target ? RING_BIG * (1 - c.left / e.target) : 0);
  }
  // Bips : chaque seconde de préparation et de changement de côté, puis les 3 dernières de l'effort ;
  // départs annoncés (VoiceOver) et marqués d'une vibration
  const key = `${c.phase}:${c.side}:${c.phase === 'prep' ? c.prepLeft : c.phase === 'switch' ? c.switchLeft : (e.target ? c.left : 'x')}`;
  if (key !== effortLastSecond) {
    const [lastPhase, lastSide] = String(effortLastSecond || '').split(':');
    if (c.phase === 'prep' || c.phase === 'switch' || (e.target && c.left >= 1 && c.left <= 3)) playMelody('tick');
    if (c.phase === 'switch' && lastPhase !== 'switch') { announce('Change de côté'); haptic(); }
    if (c.phase === 'effort' && lastPhase && (lastPhase !== 'effort' || lastSide !== String(c.side))) {
      announce(two ? `Côté ${c.side}, partez` : 'Partez'); haptic();
    }
    if (c.phase === 'effort' && e.target && c.left === 10 && e.target > 15) announce('10 secondes');
  }
  effortLastSecond = key;
  if (c.phase === 'done') finishEffort(c.endAt, e.side1Held != null ? Math.min(e.side1Held, e.target) : e.target);
}

// ▶ sur une série en durée : un seul chrono à la fois (un repos en cours s'arrête)
function startEffort(ei, si) {
  const ex = activeSession?.exercises[ei], s = ex?.sets[si];
  if (!s || s.done) return;
  if (restActive) { stopRest(); closeRestSheet(); removeRestUI(); }
  const target = num(s.reps, 1, MEASURES.time.max, true);
  activeSession.effort = { ei, si, start: Date.now() + EFFORT_PREP_S * 1000, target, sides: bothSides(ex) ? 2 : 1 };
  effortLastSecond = null;
  persistSession();
  haptic();
  openEffortSheet();
  runEffortClock();
}

function openEffortSheet() {
  closeSessSheets();
  const root = openSessSheet({ cls: 'sess-sheet--effort', label: 'Chrono', html: effortSheetHtml() });
  root.style.setProperty('--cat-color', sessionMeta(activeSession.category, activeSession.programme).color);
  updateEffortUI();
}

function runEffortClock() {
  clearInterval(effortInterval);
  effortInterval = setInterval(updateEffortUI, 200);
  // App en arrière-plan : la notification annonce la fin de l'effort (le repos suit au retour)
  if (activeSession.effort.target) {
    const e = activeSession.effort, ex = activeSession.exercises[e.ei];
    const total = e.sides === 2 ? 2 * e.target + EFFORT_SWITCH_S : e.target;
    afterPaint(() => Native.scheduleRestEnd(e.start + total * 1000, `Repos ${fmtRest(exRest(ex))}`, `${ex.name} terminé`));
  }
}

function clearEffort() {
  clearInterval(effortInterval); effortInterval = null; effortLastSecond = null;
  if (activeSession) delete activeSession.effort;
}

// Fin de l'effort (objectif atteint ou « Terminer ») : durée tenue enregistrée, série validée,
// repos calé sur la vraie fin de l'effort (si l'app revient en retard, le repos a déjà avancé)
function finishEffort(endAt, held) {
  if (!activeSession?.effort) return;               // déjà fini (horloge et retour au premier plan)
  const { ei, si } = activeSession.effort;
  clearEffort();                                     // d'abord : plus de seconde validation possible
  document.querySelector('.sess-sheet--effort')?._close?.();
  const s = activeSession.exercises[ei]?.sets[si];
  if (!s || s.done) return;
  const prevReps = s.reps;
  s.reps = String(Math.max(1, Math.round(held)));
  Native.cancelRestEnd();
  validateSet(ei, si, { restFrom: endAt, prevReps });
  announce(`Terminé, ${fmtSeconds(s.reps)} tenues`);
}

// Bouton du bas : « Commencer » (passe la préparation ou le changement de côté), « Côté suivant »
// (chrono libre à deux côtés), « Terminer » (fin anticipée : le temps tenu est enregistré)
function stopEffortEarly() {
  const e = activeSession?.effort;
  if (!e) return;
  const c = effortClock(e), now = Date.now();
  if (c.phase === 'prep') { e.start = now; }
  else if (c.phase === 'switch') {
    if (e.target) e.start = now - (e.target + EFFORT_SWITCH_S) * 1000;   // côté 2 démarre maintenant
    else e.side2Start = now;
  } else if (e.sides === 2 && c.side === 1) {
    // Côté 1 terminé avant l'objectif (ou chrono libre) : on garde le temps tenu, puis changement de côté
    e.side1Held = c.elapsed;
    if (e.target) e.start = now - e.target * 1000;
    else e.side2Start = now + EFFORT_SWITCH_S * 1000;
  } else {
    // Fin : avec deux côtés, la série vaut le côté le plus faible
    const held = e.sides === 2 && e.side1Held != null ? Math.min(e.side1Held, c.elapsed) : c.elapsed;
    finishEffort(now, held);
    return;
  }
  persistSession(); updateEffortUI();
}

function cancelEffort() {
  if (!activeSession?.effort) return;
  clearEffort();
  Native.cancelRestEnd();
  document.querySelector('.sess-sheet--effort')?._close?.();
  persistSession();
}

// Séance restaurée (rechargement, mise à jour à chaud) : effort repris, ou terminé s'il l'est déjà
function resumeEffort() {
  if (!activeSession?.effort) return;
  if (!effortStillValid()) { clearEffort(); persistSession(); return; }
  const c = effortClock(activeSession.effort);
  if (c.phase === 'done') { const e = activeSession.effort; finishEffort(c.endAt, e.side1Held != null ? Math.min(e.side1Held, e.target) : e.target); return; }
  openEffortSheet();
  runEffortClock();
}

// Retour au premier plan : l'effort fini pendant l'absence est validé à son heure de fin
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && activeSession?.effort) updateEffortUI();
});

registerActions({
  'start-effort': (e, el) => startEffort(parseInt(el.dataset.ei), parseInt(el.dataset.si)),
  'stop-effort': () => stopEffortEarly(),
  'cancel-effort': () => cancelEffort(),
});
