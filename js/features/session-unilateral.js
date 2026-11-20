// ═══════════════════════════════════════════════════════════
//  Séance : série notée par bras (ou par jambe) sur un exercice unilatéral. Sous la série (premier côté) et ses
//  sous-séries : la ligne du second côté, pré-remplie avec ce qui vient d'être fait, puis ses sous-séries.
//  Logique : js/data/unilateral.js ; décisions : docs/UNILATERAL.md
// ═══════════════════════════════════════════════════════════
'use strict';

// Nom du côté sous la ligne d'une série notée par bras (« Bras gauche ») : texte gris, pas une pastille (la pastille
// grise dit une technique, top set ou back-off : une forme, un sens). '' pour une série ordinaire.
function sideLblHtml(ex, s, side) {
  return hasSide2(s) ? `<span class="side-lbl">${sideName(ex, side)}</span>` : '';
}
// « le bras droit », « la jambe droite »
function sideRef(ex, side) {
  return `${unilateralLimb(ex) === 'jambe' ? 'la' : 'le'} ${sideName(ex, side).toLowerCase()}`;
}
const sideFem = ex => unilateralLimb(ex) === 'jambe';
function side2At(ds) {
  const ei = parseInt(ds.ei), si = parseInt(ds.si), ex = activeSession?.exercises[ei], s = ex?.sets[si];
  return hasSide2(s) ? { ei, si, ex, s, x: s.side2 } : null;
}

// Second côté d'une série notée par bras : sa ligne, puis ses sous-séries (même technique que le premier côté)
// tag : lettre du superset (A1), à la place du numéro
function side2RowsHtml(ex, ei, s, si, tag = '') {
  if (!hasSide2(s)) return '';
  const T = TECHS[setTech(s)];
  const subs = T?.sub && canTech(ex) ? (s.side2.sub || []).map((x, k) => subRowHtml(ex, ei, s, si, x, k, 2)).join('') : '';
  const name = `${setSpokenName(ex, si).toLowerCase()}, ${sideName(ex, 2).toLowerCase()}`;
  return side2RowHtml(ex, ei, s, si, tag) + (subs ? `<div class="tech" role="group" aria-label="${T.label}, ${name}">${subs}</div>` : '');
}

function side2RowHtml(ex, ei, s, si, tag) {
  const x = s.side2, kind = loadKind(ex), at = `data-ei="${ei}" data-si="${si}"`;
  const name = `${setSpokenName(ex, si)}, ${sideName(ex, 2).toLowerCase()}`;
  const exOf = tag ? `, ${esc(ex.name)}` : '';
  const prev = x.prev ? `${hasLoad(x.prev.weight) ? fmtW(x.prev.weight, { plain: true }) + '&nbsp;× ' : ''}${esc(x.prev.reps)}` : '—';
  // Même numéro que la série (c'est la même série, de l'autre côté), lettre du superset sinon
  const no = `<span class="set-n${tag ? '' : ' num'}" aria-hidden="true">${tag ? `<span class="ss-tag">${tag}</span>` : setDisplayNo(ex.sets, si)}</span>`;
  if (x.done) {
    const u = undoForSet(ex, si, -1, 2);
    const record = recordSet(s).side === 2 ? liveSetBadge(ex, s, livePrior(ex)) : '';
    return `
      <div class="session-set session-set--done session-set--side" data-action="side-reopen" ${at} ${u ? '' : 'role="button" tabindex="0"'}>
        <span class="sr-text">${name} validé${sideFem(ex) ? 'e' : ''}, ${esc(measureSetTxt(x, 'reps', kind))}${exOf}${record ? `, ${esc(record)}` : ''}. Modifier</span>
        ${no}
        ${u ? setUndoHtml(u) : `<span class="set-prev num" aria-hidden="true">${prev}</span>`}
        <span class="set-val set-val--w num" aria-hidden="true">${hasLoad(x.weight) ? fmtW(x.weight, { plain: true }) : '—'}</span>
        <span class="set-val set-val--r num" aria-hidden="true">${esc(x.reps)}</span>
        <span class="set-check-zone" aria-hidden="true"><span class="set-check set-check--done">${icon('checkmark', 18)}</span></span>
        <span class="set-badge" aria-hidden="true"><span class="side-lbl">${sideName(ex, 2)}</span>${record ? `<span class="pr-badge">${medalSvg(13)}${esc(record)}</span>` : ''}</span>
      </div>`;
  }
  // Mise en avant comme une sous-série : seulement quand c'est l'étape qui suit (js/data/unilateral.js, setNextStep)
  const c = techCurrentSub(activeSession.exercises, activeSession.lastDone);
  const cur = c?.ei === ei && c.si === si && c.side === 2 && c.k < 0;
  const wait = !s.done;
  // Cases pré-remplies avec le premier côté (charge et reps, « pré-remplir avec ce qui a été fait ») : un ✓ suffit
  // quand les deux côtés sont pareils ; « Avant » : ce côté-là la dernière fois
  const reps = String(x.reps ?? '').trim() || side2RepsGoal(s);
  return `
      <div class="session-set session-set--side ${cur ? 'session-set--subcur' : ''}" ${cur ? 'aria-current="step" ' : ''}${at}>
        <span class="visually-hidden">${name}${exOf}</span>${no}
        <span class="set-prev num">${x.prev ? '<span class="set-prev__lbl" aria-hidden="true">Avant </span><span class="visually-hidden">La dernière fois </span>' : ''}${prev}</span>
        <input type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" class="set-input num" data-action="side-weight" ${at}
               value="${esc(fmtW(side2WeightKg(s), { plain: true }))}" placeholder="—" aria-label="${loadSpoken(ex)}, ${name.toLowerCase()}, en ${unitLbl()}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" class="set-input set-input--required num" data-action="side-reps" ${at}
               value="${esc(reps)}" placeholder="${esc(x.prev?.reps || '')}" aria-label="Répétitions, ${name.toLowerCase()}">
        <button class="set-check-zone ${wait ? 'set-check-zone--wait' : ''}" data-action="side-validate" ${at} ${wait ? 'aria-disabled="true"' : ''} aria-label="Valider ${setRefName(ex, si)}, ${sideName(ex, 2).toLowerCase()}${exOf}"><span class="set-check"></span></button>
        <span class="set-badge" aria-hidden="true"><span class="side-lbl">${sideName(ex, 2)}</span></span>
      </div>`;
}

// ── Validation du second côté ────────────────────────────────
function validateSide2(ds) {
  const hit = side2At(ds);
  if (!hit || hit.x.done) return;
  const { ei, si, ex, s, x } = hit;
  if (!s.done) { showToast(`Valide d'abord ${sideRef(ex, 1)}`); return; }
  const q = a => document.querySelector(`[data-action="${a}"][data-ei="${ei}"][data-si="${si}"]`);
  const wIn = q('side-weight'), rIn = q('side-reps');
  restoreClearedInput(wIn); restoreClearedInput(rIn);
  if (wIn && !weightOk(wIn.value)) { flagInvalid(wIn, weightMsg()); return; }
  const reps = num(rIn ? rIn.value : side2RepsGoal(s), 1, MEASURES.reps.max, true);
  if (reps === null) { flagInvalid(rIn, MEASURES.reps.msg); return; }
  const xs = activeSession.exercises;
  const follows = techCurrentSub(xs, activeSession.lastDone)?.ei === ei && activeSession.lastDone.si === si;
  const restBefore = restSnapshot(), before = { weight: x.weight, reps: x.reps, auto: x.auto };
  x.weight = wIn ? storeW(wIn.value) : side2WeightKg(s);
  delete x.auto;
  x.reps = String(reps);
  x.done = true;
  haptic();
  afterPaint(validationSound);
  // Le repos part après le dernier bloc du second côté seulement (restAfterStep, js/features/session-intensif.js)
  const next = restAfterStep(ei, s, follows);
  document.activeElement?.blur?.();
  persistSession();
  render();
  if (follows) scrollToCurrent(true, true);
  else requestAnimationFrame(focusCurrentSet);
  const done = `${sideName(ex, 2)} validé${sideFem(ex) ? 'e' : ''}`;
  const text = next.nx && setTech(s) ? `${done} · puis ${TECHS[setTech(s)].label.toLowerCase()}` : stepUndoText(ex, done, next);
  sessionUndo(text, { target: { ex, si, k: -1, side: 2 }, onAction: () => {
    if (!activeSession || !x.done) return;
    x.done = false;
    Object.assign(x, { weight: before.weight, reps: before.reps });
    if (before.auto) x.auto = true;
    if (follows) { stopRest(); if (restBefore) resumeRest(restBefore); }
    persistSession(); render();
  } });
}

// ── Menu ⋯ › Plus d'options : chaque côté à part, ou les deux ensemble (sideMenuActions, js/data/unilateral.js) ──
function toggleSides(ei) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  const todo = workSets(ex.sets).filter(s => !s.done), on = !todo.every(hasSide2);
  const before = todo.map(s => [s, s.side2 ? clone(s.side2) : undefined]);
  todo.forEach(s => (on ? addSide2(s) : removeSide2(s)));
  haptic();
  persistSession();
  render();
  const plural = unilateralLimb(ex) === 'jambe' ? 'jambes' : 'bras';
  sessionUndo(on ? `Chaque ${unilateralLimb(ex)} noté${sideFem(ex) ? 'e' : ''} à part` : `Les deux ${plural} notés ensemble`, { target: { ex }, onAction: () => {
    if (!activeSession) return;
    before.forEach(([s, v]) => { if (s.done) return; if (v) s.side2 = v; else delete s.side2; });
    persistSession(); render();
  } });
}

CLEAR_ON_FOCUS.add('side-weight');
CLEAR_ON_FOCUS.add('side-reps');
// Saisie du second côté : la charge ne suit plus le premier côté dès qu'on y touche
document.addEventListener('input', e => {
  const a = e.target.dataset?.action;
  if (a !== 'side-weight' && a !== 'side-reps') return;
  const x = side2At(e.target.dataset)?.x;
  if (!x || x.done) return;
  if (a === 'side-weight') { x.weight = storeW(e.target.value); delete x.auto; } else x.reps = repsInput(e.target);
  persistSession();
});

registerActions({
  'side-validate': (e, el) => validateSide2(el.dataset),
  // Second côté validé touché : de nouveau à remplir (sa charge et ses reps restent)
  'side-reopen': (e, el) => {
    const x = side2At(el.dataset)?.x;
    if (!x?.done) return;
    x.done = false;
    haptic(); persistSession(); render();
  },
});
