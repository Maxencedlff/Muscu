// ═══════════════════════════════════════════════════════════
//  Séance : série notée par bras (ou par jambe) sur un exercice unilatéral. Sous la série (premier côté) et ses
//  sous-séries : la ligne du second côté, pré-remplie avec ce qui vient d'être fait, puis ses sous-séries.
//  Logique : js/data/unilateral.js ; décisions : docs/UNILATERAL.md
// ═══════════════════════════════════════════════════════════
'use strict';

// Nom du côté en titre AU-DESSUS de son groupe (la ligne et ses sous-séries), comme « Échauffement » : sous la ligne,
// il se lisait comme le titre du bloc d'en dessous (panel du 20/11). Texte gris, pas une pastille (la pastille grise dit
// une technique, top set ou back-off : une forme, un sens). Caché à VoiceOver : chaque ligne dit déjà son côté.
// '' pour une série ordinaire.
function sideCaptionHtml() { return ''; }   // remplacé par le côté dans la colonne du numéro (withSideTag), 4e tour
// Côté dans la colonne du numéro, sous le numéro (« 1 », « Gauche ») : un repère par ligne, sans titre répété au-dessus
// de chaque ligne (panel du 20/11, 4e tour : 6 titres pour 3 séries) ; en texte agrandi, sur la ligne en cours même
// quand le haut de la carte est sorti de l'écran. html : la première colonne (numéro, bouton du numéro ou ▶).
function withSideTag(html, ex, s, side) {
  if (!hasSide2(s)) return html;
  const tag = `<span class="set-n__side" aria-hidden="true">${sideShort(ex, side)}</span>`;
  const i = html.lastIndexOf('</');
  return i < 0 ? html : html.slice(0, i) + tag + html.slice(i);
}
// Ligne « Annuler » après une étape d'une série notée par bras (panel du 21/11 : « Série 1 validée, bras gauche puis
// bras droit » faisait croire la série finie). k : -1 pour la ligne du côté, sinon la sous-série k. nx : l'étape qui suit.
//  - un côté fait, l'autre à faire : « Bras gauche validé · au tour du bras droit » ;
//  - une étape suivie d'une sous-série : « Bras droit validé · puis drop set », « Drop 1 validé · bras gauche · puis drop » ;
//  - la dernière étape : « Série 1 validée ».
function sideStepText(ex, s, si, k, side, nx) {
  const fem = sideFem(ex), T = TECHS[setTech(s)];
  if (!nx) return `${setSpokenName(ex, si)} validée`;
  const what = k < 0 ? `${sideName(ex, side)} validé${fem ? 'e' : ''}` : `${capitalize(T.subName)} ${k + 1} validé${T.fem ? 'e' : ''} · ${sideWord(ex, side)}`;
  if (nx.k < 0) return `${what} · au tour ${fem ? 'de la' : 'du'} ${sideWord(ex, 2)}`;
  return `${what} · puis ${k < 0 ? T.label.toLowerCase() : T.subName}`;
}
// VoiceOver de la note d'une ligne notée par bras : « Note de la série 3, bras droit »
function sideNoteWho(ex, si, s, side) {
  return hasSide2(s) ? `de la ${setSpokenName(ex, si).toLowerCase()}, ${sideWord(ex, side)}` : '';
}
// Lien « Commencer par le bras droit » au-dessus des séries, tant qu'aucune série n'est validée (panel du 20/11 :
// le réglage, rangé dans ⋯ › Plus d'options, était introuvable)
function sideFirstLinkHtml(ex, ei) {
  const opt = sideMenuActions(ex).find(a => a.value === 'side-first');
  return opt ? `<button class="side-first-link" data-action="side-first" data-ei="${ei}">${esc(opt.label)}</button>` : '';
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
  // Le bloc du second côté a son propre titre « Drop set » (sans les boutons : « + drop » et × du premier côté valent
  // pour les deux bras)
  const cap = subs ? `<div class="tech__cap" aria-hidden="true"><span class="tech__label"><span class="tech__name">${T.label}</span><span class="tech__hint">${T.hint}</span></span></div>` : '';
  return side2RowHtml(ex, ei, s, si, tag) + (subs ? `<div class="tech" role="group" aria-label="${T.label}, ${name}">${cap}${subs}</div>` : '');
}

// « Avant » du second côté dit à VoiceOver (« 14 × 9 ») ; '' sans dernière fois
const prevTxt = x => (x.prev ? `${hasLoad(x.prev.weight) ? `${fmtW(x.prev.weight, { plain: true })} × ` : ''}${esc(x.prev.reps)}` : '');
// Même mise en page que la ligne du premier côté : numéro au même endroit, « Avant » et « Note » (la note de la série,
// la même des deux côtés : panel du 20/11)
function side2RowHtml(ex, ei, s, si, tag) {
  const x = s.side2, kind = loadKind(ex), at = `data-ei="${ei}" data-si="${si}"`;
  const name = `${setSpokenName(ex, si)}, ${sideName(ex, 2).toLowerCase()}`;
  const exOf = tag ? `, ${esc(ex.name)}` : '';
  const prev = x.prev ? `${hasLoad(x.prev.weight) ? fmtW(x.prev.weight, { plain: true }) + '&nbsp;×&nbsp;' : ''}${esc(x.prev.reps)}` : '—';
  // Même numéro que la série (c'est la même série, de l'autre côté), lettre du superset sinon
  const no = withSideTag(`<span class="set-n${tag ? '' : ' num'}" aria-hidden="true">${tag ? `<span class="ss-tag">${tag}</span>` : setDisplayNo(ex.sets, si)}</span>`, ex, s, 2);
  if (x.done) {
    const u = undoForSet(ex, si, -1, 2);
    const record = recordSet(s).side === 2 ? liveSetBadge(ex, s, livePrior(ex)) : '';
    return `
      <div class="session-set session-set--done session-set--side" data-action="side-reopen" ${at} ${u ? '' : 'role="button" tabindex="0"'}>
        <span class="sr-text">${name} validé${sideFem(ex) ? 'e' : ''}, ${esc(measureSetTxt(x, 'reps', kind))}${exOf}${record ? `, ${esc(record)}` : ''}. Modifier</span>
        ${no}
        ${u ? setUndoHtml(u) : setNoteBtnHtml(ex, ei, s, si, prev, prevTxt(x), sideNoteWho(ex, si, s, 2))}
        <span class="set-val set-val--w num" aria-hidden="true" data-lbl="${unitLbl()}">${hasLoad(x.weight) ? fmtW(x.weight, { plain: true }) : '—'}</span>
        <span class="set-val set-val--r num" aria-hidden="true" data-lbl="Reps">${esc(x.reps)}</span>
        <span class="set-check-zone" aria-hidden="true"><span class="set-check set-check--done">${icon('checkmark', 18)}</span></span>
        ${record ? `<span class="set-badge" aria-hidden="true"><span class="pr-badge">${medalSvg(13)}${esc(record)}</span></span>` : ''}
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
        ${setNoteBtnHtml(ex, ei, s, si, `${x.prev ? '<span class="set-prev__lbl" aria-hidden="true">Avant </span>' : ''}${prev}`, prevTxt(x), sideNoteWho(ex, si, s, 2))}
        <input type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" class="set-input num" data-action="side-weight" ${at}
               value="${esc(fmtW(side2WeightKg(s), { plain: true }))}" placeholder="—" aria-label="${sideFieldName(ex, 2, 'w')}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" class="set-input set-input--required num" data-action="side-reps" ${at}
               value="${esc(reps)}" placeholder="${esc(x.prev?.reps || '')}" aria-label="${sideFieldName(ex, 2, 'r')}">
        <button class="set-check-zone ${wait ? 'set-check-zone--wait' : ''}" data-action="side-validate" ${at} ${wait ? 'aria-disabled="true"' : ''} aria-label="Valider ${setRefName(ex, si)}, ${sideName(ex, 2).toLowerCase()}${exOf}"><span class="set-check"></span></button>
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
  const text = next.chain ? `${setSpokenName(ex, si)} validée · enchaîne ${activeSession.exercises[next.chain.ei].name}` : sideStepText(ex, s, si, -1, 2, next.nx);
  sessionUndo(text, { target: { ex }, onAction: () => {   // « Annuler » dans le bandeau, « Avant » reste dans la ligne
    if (!activeSession || !x.done) return;
    x.done = false;
    Object.assign(x, { weight: before.weight, reps: before.reps });
    if (before.auto) x.auto = true;
    if (follows) { stopRest(); if (restBefore) resumeRest(restBefore); }
    persistSession(); render();
  } });
}

// ── Menu ⋯ › Plus d'options : chaque côté à part, ou les deux ensemble ; le premier bras (sideMenuActions,
// js/data/unilateral.js) ──
// Tout l'exercice à la fois, séries validées comprises (leur second côté noté à l'identique, corrigeable au toucher) :
// jamais un mélange un bras / deux bras (panel du 20/11)
function toggleSides(ei) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  const work = workSets(ex.sets), on = !work.every(hasSide2);
  const before = work.map(s => [s, s.side2 ? clone(s.side2) : undefined]);
  work.forEach(s => (on ? addSide2(s) : removeSide2(s)));
  haptic();
  persistSession();
  render();
  const plural = unilateralLimb(ex) === 'jambe' ? 'jambes' : 'bras';
  sessionUndo(on ? `Chaque ${unilateralLimb(ex)} noté${sideFem(ex) ? 'e' : ''} à part` : `Les deux ${plural} notés ensemble`, { target: { ex }, onAction: () => {
    if (!activeSession) return;
    before.forEach(([s, v]) => { if (v) s.side2 = v; else delete s.side2; });
    persistSession(); render();
  } });
}
// Premier bras : gauche ou droit, retenu pour l'exercice (data.sideFirst) et gardé dans la séance (ex.sideFirst) ; les
// lignes suivent (le premier côté est toujours la série, seul son nom change)
function toggleSideFirst(ei) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  const next = sideFirstOf(ex) === 'droit' ? 'gauche' : 'droit';
  if (next === 'droit') ex.sideFirst = 'droit'; else delete ex.sideFirst;
  setSideFirstPref(ex.name, next);
  ex.sets.forEach(swapSidePrev);   // « Avant » de chaque ligne suit son bras
  save();
  haptic();
  persistSession();
  render();
  sessionUndo(`Tu commences par ${sideRef(ex, 1)}`, { target: { ex } });
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
  'side-first': (e, el) => toggleSideFirst(parseInt(el.dataset.ei)),
  'side-validate': (e, el) => validateSide2(el.dataset),
  // Second côté validé touché : de nouveau à remplir (sa charge et ses reps restent)
  'side-reopen': (e, el) => {
    const x = side2At(el.dataset)?.x;
    if (!x?.done) return;
    x.done = false;
    haptic(); persistSession(); render();
  },
});
