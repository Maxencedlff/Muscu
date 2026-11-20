// ═══════════════════════════════════════════════════════════
//  Techniques d'intensification en séance : choix sur une série, sous-séries notées sous la série,
//  validation, et réglage dans Programme › Exercice. Logique : js/data/intensif.js ;
//  décisions : docs/INTENSIFICATION.md
// ═══════════════════════════════════════════════════════════
'use strict';

// Arrondi au matériel (barre et disques, sinon pas des racks : js/data/plates.js) et sens de l'allègement
function techOpts(ex) {
  const setup = plateSetup(), barbell = isBarbellExercise(ex);
  return { round: v => roundLoad(v, { ...setup, barbell }), assisted: loadKind(ex) === 'aide' };
}
// Sous-série touchée : { s, host, side, x, k } ; host : la série (premier côté) ou son second côté (data-side="2",
// série notée par bras : js/data/unilateral.js), dont x est la sous-série k
function techSubAt(ds) {
  const s = activeSession?.exercises[parseInt(ds.ei)]?.sets[parseInt(ds.si)];
  const side = ds.side === '2' ? 2 : 1, host = side === 2 ? s?.side2 : s;
  return s && setTech(s) && host ? { s, host, side, x: host.sub?.[parseInt(ds.k)] || null, k: parseInt(ds.k) } : null;
}

// Sous-série qui suit la dernière validation (pause d'un rest-pause ou d'un cluster, ou entre deux drops) :
// { ei, si, k, label: « Mini-série 1 », set: { weight, reps } } avec la charge proposée et l'objectif de reps ;
// null sinon. La barre de repos, la notification de fin et la Live Activity l'annoncent (js/features/rest.js)
function techNextSub() {
  const xs = activeSession?.exercises;
  const c = xs && techCurrentSub(xs, activeSession.lastDone);
  if (!c) return null;
  const ex = xs[c.ei], s = ex.sets[c.si];
  // Second côté d'une série notée par bras (js/data/unilateral.js) : « Bras droit · 12 kg × 10 »
  if (c.k < 0) return { ...c, label: sideName(ex, 2), set: { weight: side2WeightKg(s), reps: side2RepsGoal(s) } };
  const two = c.side === 2;
  // « Mini-série 1 » : le même repère que la ligne, pas un 2e nom à relier de tête (panel vague 4)
  return { ...c, label: `${capitalize(TECHS[setTech(s)].subName)} ${c.k + 1}`,
    set: { weight: two ? side2SubWeightKg(s, c.k, techOpts(ex)) : subWeightKg(s, c.k, techOpts(ex)),
      reps: two ? side2SubRepsGoal(s, c.k) : String(s.sub[c.k].reps ?? '').trim() || s.sub[c.k].prev?.reps || '' } };
}

// Numéro d'une série de travail à faire (ou rouverte) : bouton qui ouvre le choix d'une technique.
// Même aspect que le numéro (sans indice visuel : le point gris dessous ne disait rien, panel vague 4) ; raccourci du
// choix « Technique… » du menu ⋯ de la série (techMenuActions) ; zone de 44 px (session.css)
function setTechNumHtml(ex, ei, si) {
  const t = setTech(ex.sets[si]);
  return `<button class="set-n set-tech-n num" data-action="tech-set" data-ei="${ei}" data-si="${si}" aria-label="${setSpokenName(ex, si)} : technique d'intensification${t ? `, ${TECHS[t].label}` : ''}">${setDisplayNo(ex.sets, si)}</button>`;
}

// Technique prescrite par le programme d'un coach (intens) : l'élève ne la retire pas d'un toucher (pas de ×, ni
// « Retirer la technique ») ; il peut toujours noter ce qu'il a vraiment fait
function techPrescribed(ex) {
  return !!activeSession && coachLedProgramme(activeSession.programme) && !!cleanIntens(sessExData(ex)?.intens);
}

// Top set, back-off (sans sous-série) : petite pastille dans la ligne de SA série, sous « Avant » (panel du 16/11 :
// l'étiquette sur une ligne à elle, entre deux séries, avec un × rond, ne disait ni à quelle série elle se
// rapportait, ni ce que faisait le ×). Retirer : le numéro de la série ou ⋯ › Technique d'intensification.
// spoken : lue par VoiceOver (série à faire) ; série validée : dans sa phrase, pastille cachée
function techPillHtml(s, { spoken = true } = {}) {
  const t = setTech(s);
  if (!t || TECHS[t].sub) return '';
  return `<span class="tech-pill"${spoken ? '' : ' aria-hidden="true"'}><span class="tech-pill__name">${TECHS[t].label}</span> <span class="tech-pill__hint">${TECHS[t].hint}</span></span>`;
}

// Sous la série (drop set, rest-pause, cluster) : titre de la technique (+ une sous-série, retirer), puis une ligne par
// sous-série, remplie comme une série (charge proposée, objectif de la dernière fois en gris, ✓). Top set et back-off :
// pastille dans la ligne de la série (techPillHtml)
function techBlockHtml(ex, ei, s, si) {
  const t = setTech(s);
  if (!t || !canTech(ex) || !TECHS[t].sub) return '';
  const T = TECHS[t], name = setSpokenName(ex, si).toLowerCase();
  const add = T.sub && (s.sub || []).length < TECH_SUB_MAX
    ? `<button class="tech__add" data-action="tech-add-sub" data-ei="${ei}" data-si="${si}" aria-label="Ajouter ${T.fem ? 'une' : 'un'} ${T.subName}, ${name}${hasSide2(s) ? ', pour les 2 bras' : ''}">${icon('plus', 14)}${T.subName}</button>` : '';
  const rows = T.sub ? (s.sub || []).map((x, k) => subRowHtml(ex, ei, s, si, x, k)).join('') : '';
  return `
    <div class="tech" role="group" aria-label="${T.label}, ${name}">
      <div class="tech__cap${hasSide2(s) ? ' tech__cap--sides' : ''}">
        <span class="tech__label"><span class="tech__name">${T.label}${hasSide2(s) ? '&nbsp;· 2&nbsp;bras' : ''}</span><span class="tech__hint">${T.hint}</span></span>
        <span class="tech__btns">${add}
        ${techPrescribed(ex) ? '' : `<button class="tech__x" data-action="tech-remove" data-ei="${ei}" data-si="${si}" aria-label="Retirer le ${T.label.toLowerCase()} de la ${name}">${icon('xmark', 14)}</button>`}</span>
      </div>
      ${rows}
    </div>`;
}

// side 2 : sous-série du second côté d'une série notée par bras (js/features/session-unilateral.js), pré-remplie avec
// la même sous-série du premier côté (charge dans la case, reps en gris)
function subRowHtml(ex, ei, s, si, x, k, side = 1) {
  // Numéro de la sous-série seul, sous le nom de la technique (« Rest-pause 15 s ») : un seul mot, « mini-série », partout ailleurs
  // « Drop 1 », « Mini-série 1 », « Bloc 1 » : le nom en toutes lettres (panel du 20/11 : « +1 » se lisait « +1 rep » ou
  // « +1 série »), sur deux lignes dans la colonne du numéro
  const T = TECHS[setTech(s)], tag = `${capitalize(T.subName)} ${k + 1}`, kind = loadKind(ex), two = side === 2, host = two ? s.side2 : s;
  const spoken = `${T.subName} ${k + 1}, ${setSpokenName(ex, si).toLowerCase()}${hasSide2(s) ? `, ${sideName(ex, side).toLowerCase()}` : ''}, ${esc(ex.name)}`;
  // Sans dernière fois : rien (le « — » sous « Drop 1 » se lisait comme une valeur, panel du 21/11)
  const prev = x.prev ? `${hasLoad(x.prev.weight) ? fmtW(x.prev.weight, { plain: true }) + '&nbsp;×&nbsp;' : ''}${esc(x.prev.reps)}` : '';
  const at = `data-ei="${ei}" data-si="${si}" data-k="${k}"${two ? ' data-side="2"' : ''}`;
  if (x.done) {
    const w = hasLoad(x.weight) ? fmtW(x.weight, { plain: true }) : '';
    // « Annuler » dans la colonne Avant de la mini-série, comme pour une série (la bande au-dessus de la carte
    // sortait de l'écran : panel de la vague 3)
    const u = undoForSet(ex, si, k, side);
    return `
      <div class="session-set session-set--done session-set--sub" data-action="sub-reopen" ${at} ${u ? '' : 'role="button" tabindex="0"'}>
        <span class="sr-text">${capitalize(spoken)} validé${T.fem ? 'e' : ''}, ${esc(measureSetTxt(x, 'reps', kind))}. Modifier</span>
        ${withSideTag(`<span class="set-n tech-tag" aria-hidden="true">${tag}</span>`, ex, s, side)}
        ${u ? setUndoHtml(u) : `<span class="set-prev num" aria-hidden="true">${prev}</span>`}
        <span class="set-val set-val--w num" aria-hidden="true">${w || '—'}</span>
        <span class="set-val set-val--r num" aria-hidden="true">${esc(x.reps)}</span>
        <span class="set-check-zone" aria-hidden="true"><span class="set-check set-check--done">${icon('checkmark', 18)}</span></span>
      </div>`;
  }
  // Mise en avant : seulement la sous-série qui suit la dernière série validée (une sautée reste à remplir, en gris)
  const first = (host.sub || []).findIndex(y => !y.done);
  const c = techCurrentSub(activeSession.exercises, activeSession.lastDone);
  const cur = c?.ei === ei && c.si === si && c.k === k && (c.side || 1) === side;
  const wait = !host.done || first < k;
  const kg = two ? side2SubWeightKg(s, k, techOpts(ex)) : subWeightKg(s, k, techOpts(ex));
  // Reps pré-remplies dans la case, comme une série (« pré-remplir avec la dernière fois » ; au bras droit : ce que le bras
  // gauche vient de faire) : un ✓ les prend telles quelles. Le gris ne sert plus de suggestion (panel du 20/11)
  const goal = two ? side2SubRepsGoal(s, k) : String(x.reps ?? '').trim() || x.prev?.reps || '';
  return `
      <div class="session-set session-set--sub ${cur ? 'session-set--subcur' : ''}" ${cur ? 'aria-current="step" ' : ''}${at}>
        ${withSideTag(`<span class="set-n tech-tag" aria-hidden="true">${tag}</span>`, ex, s, side)}
        <span class="set-prev num">${x.prev ? '<span class="visually-hidden">La dernière fois </span>' : ''}${prev}</span>
        <input type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" class="set-input num" data-action="sub-weight" ${at}
               value="${esc(fmtW(kg, { plain: true }))}" placeholder="—" aria-label="${loadSpoken(ex)}, ${spoken}, en ${unitLbl()}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" class="set-input set-input--required num" data-action="sub-reps" ${at}
               value="${esc(goal)}" placeholder="max" aria-label="Répétitions, ${spoken}">
        <button class="set-check-zone ${wait ? 'set-check-zone--wait' : ''}" data-action="sub-validate" ${at} ${wait ? 'aria-disabled="true"' : ''} aria-label="Valider ${T.fem ? 'la' : 'le'} ${spoken}"><span class="set-check"></span></button>
      </div>`;
}

// ── Choix d'une technique ────────────────────────────────────
async function techMenuChoice(ei, choice) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  const idx = ex.sets.map((s, i) => i).filter(i => !isWarmupSet(ex.sets[i]));
  if (!idx.length) return;
  const kind = loadKind(ex);
  const si = idx.length === 1 ? idx[0] : await dialog({ type: 'sheet', title: 'Sur quelle série ?', actions: [
    ...idx.map(i => { const s = ex.sets[i], t = setTech(s); return { label: `${setSpokenName(ex, i)}${s.reps !== '' || hasLoad(s.weight) ? ` · ${measureSetTxt(s, 'reps', kind)}` : ''}${t ? ` · ${TECHS[t].label}` : ''}`, value: i }; }),
    { label: 'Annuler', style: 'cancel' },
  ] });
  if (Number.isInteger(si) && activeSession?.exercises[ei] === ex) await openTechSheet(ei, si);
}
// Feuille d'une série : les cinq techniques (celle de la série cochée), retirer, annuler
async function openTechSheet(ei, si) {
  const ex = activeSession?.exercises[ei], s = ex?.sets[si];
  if (!s || isWarmupSet(s) || !canTech(ex)) return;
  const cur = setTech(s);
  const t = await dialog({ type: 'sheet', title: `${setSpokenName(ex, si)} · ${ex.name}`,
    message: 'Drop set : charge baissée, sans repos. Rest-pause, cluster : même charge après 15 à 20 s de repos. Top set : la série la plus lourde. Back-off : une série allégée ensuite.', actions: [
      ...TECH_IDS.map(id => ({ label: `${id === cur ? '✓ ' : ''}${TECHS[id].label}`, value: id })),
      ...(cur && !techPrescribed(ex) ? [{ label: 'Retirer la technique', value: 'none', style: 'destructive' }] : []),
      { label: 'Annuler', style: 'cancel' },
    ] });
  if (!t || activeSession?.exercises[ei]?.sets[si] !== s) return;
  setTechOn(ei, si, t === 'none' ? null : t);
}
function setTechOn(ei, si, t) {
  const ex = activeSession?.exercises[ei], s = ex?.sets[si];
  if (!s) return;
  const before = { tech: s.tech, sub: s.sub ? clone(s.sub) : undefined, side2: s.side2 ? clone(s.side2) : undefined };
  if (!applyTech(s, t)) { if (t) showToast(`Déjà en ${TECHS[t].label.toLowerCase()}`); return; }
  techSides(ex, s);   // exercice unilatéral : drop set de chaque côté (js/data/unilateral.js)
  haptic();
  persistSession();
  render();
  const undo = () => {
    if (!activeSession) return;
    delete s.tech; delete s.sub; delete s.side2;
    Object.assign(s, before.tech ? { tech: before.tech } : {}, before.sub ? { sub: before.sub } : {}, before.side2 ? { side2: before.side2 } : {});
    persistSession(); render();
  };
  // Ligne au-dessus de la carte (« Rest-pause · série 1 · Annuler ») : dans la colonne « Avant », un « Annuler » seul
  // remplaçait la valeur d'avant à côté du × de la technique, sans dire ce qu'il annulait (panel t5)
  sessionUndo(t ? `${TECHS[t].label} · ${setSpokenName(ex, si).toLowerCase()}` : `Technique retirée · ${setSpokenName(ex, si).toLowerCase()}`, { target: { ex }, onAction: undo });
}

// ── Validation d'une sous-série ──────────────────────────────
// Repos après une étape validée dans la série s (sous-série, ou second côté d'une série notée par bras) : la courte
// pause de la technique avant la sous-série qui suit, rien avant l'autre côté ni avant un drop, et après la dernière
// étape comme après une série (validateSet) : l'exercice suivant d'un superset s'enchaîne sans repos, sinon le repos
// habituel de l'exercice. follows : l'étape suit la dernière validation (un rattrapage laisse le repos tel quel).
// Renvoie { nx: l'étape qui suit, chain: l'exercice enchaîné du superset }.
function restAfterStep(ei, s, follows) {
  const xs = activeSession.exercises, nx = setNextStep(s);
  const allDone = xs.every(e => e.sets.every(st => st.done));
  const group = ssGroupOf(xs, ei);
  const chain = follows && !nx && !allDone && group ? ssChainAfter(xs, group, ei) : null;
  if (follows) {
    const pause = nx && nx.k >= 0 ? TECHS[setTech(s)].pause : 0;
    if (nx) { if (pause) openRest(pause, false); else stopRest(); }
    else if (allDone || chain) stopRest();
    else openRest(exRest(xs[restEi(ei)]), false);
  }
  return { nx, chain };
}
// Texte de la ligne « Annuler » : ce qui est défait d'abord, puis ce qui suit (l'autre côté, l'exercice enchaîné)
function stepUndoText(ex, done, { nx, chain }) {
  if (chain) return `${done} · enchaîne ${activeSession.exercises[chain.ei].name}`;
  return nx?.k < 0 ? `${done} · puis ${sideName(ex, 2).toLowerCase()}` : done;
}

function validateSub(ds) {
  const hit = techSubAt(ds);
  if (!hit?.x || hit.x.done) return;
  const { s, host, side, x, k } = hit, ei = parseInt(ds.ei), si = parseInt(ds.si), two = side === 2;
  const ex = activeSession.exercises[ei], T = TECHS[setTech(s)];
  if (!s.done) { showToast(`Valide d'abord la ${setSpokenName(ex, si).toLowerCase()}`); return; }
  if (two && !host.done) { showToast(`Valide d'abord ${sideRef(ex, 2)}`); return; }
  const first = host.sub.findIndex(y => !y.done);
  if (first < k) { showToast(`Valide d'abord ${T.fem ? 'la' : 'le'} ${T.subName} ${first + 1}`); return; }
  const q = sel => document.querySelector(`[data-action="${sel}"][data-ei="${ei}"][data-si="${si}"][data-k="${k}"]${two ? '[data-side="2"]' : ':not([data-side])'}`);
  const wIn = q('sub-weight'), rIn = q('sub-reps');
  restoreClearedInput(wIn); restoreClearedInput(rIn);
  if (wIn && !weightOk(wIn.value)) { flagInvalid(wIn, weightMsg()); return; }
  const reps = num(two ? side2SubRepsGoal(s, k) : String(x.reps ?? '').trim() || x.prev?.reps || '', 1, MEASURES.reps.max, true);
  if (reps === null) { flagInvalid(rIn, 'Note tes reps'); return; }
  const wasAuto = !!x.auto, wasReps = x.reps;
  // Repos : seulement si la sous-série suit la dernière validation ; un rattrapage ou une correction
  // laisse le repos en cours tel quel
  const xs = activeSession.exercises;
  const follows = techCurrentSub(xs, activeSession.lastDone)?.ei === ei && activeSession.lastDone.si === si;
  const restBefore = restSnapshot();
  x.weight = wIn ? storeW(wIn.value) : two ? side2SubWeightKg(s, k, techOpts(ex)) : subWeightKg(s, k, techOpts(ex));
  delete x.auto;
  x.reps = String(reps);
  x.done = true;
  haptic();
  afterPaint(validationSound);
  const next = restAfterStep(ei, s, follows);
  document.activeElement?.blur?.();
  persistSession();
  render();
  if (follows) scrollToCurrent(true, true);
  else requestAnimationFrame(focusCurrentSet);   // rattrapage : le ✓ touché a disparu, le focus va à la série à faire
  const done = `${capitalize(T.subName)} ${k + 1} validé${T.fem ? 'e' : ''}${two ? ` · ${sideName(ex, 2).toLowerCase()}` : ''}`;
  // Comme après une série (validateSet) : ce que « Annuler » défait d'abord, puis ce qui suit
  // Série notée par bras : « Annuler » dans le bandeau au-dessus de la carte, « Avant » reste dans la ligne (panel du 21/11)
  // Série par bras : « au tour du droit », ou « Série 3 validée » après la dernière étape (sideStepText)
  const txt = hasSide2(s) && !next.chain ? sideStepText(ex, s, si, k, side, next.nx) : stepUndoText(ex, done, next);
  sessionUndo(txt, { target: hasSide2(s) ? { ex } : { ex, si, k, side }, onAction: () => {
    if (!activeSession || !x.done) return;
    x.done = false; x.reps = wasReps;
    if (wasAuto) x.auto = true;
    // Le repos d'avant revient (rien n'a changé s'il s'agissait d'un rattrapage)
    if (follows) { stopRest(); if (restBefore) resumeRest(restBefore); }
    persistSession(); render();
  } });
}

CLEAR_ON_FOCUS.add('sub-weight');
CLEAR_ON_FOCUS.add('sub-reps');
// Saisie d'une sous-série : charge (plus calculée d'après la série dès qu'on y touche) et reps
document.addEventListener('input', e => {
  const a = e.target.dataset?.action;
  if (a !== 'sub-weight' && a !== 'sub-reps') return;
  const x = techSubAt(e.target.dataset)?.x;
  if (!x || x.done) return;
  if (a === 'sub-weight') { x.weight = storeW(e.target.value); delete x.auto; } else x.reps = repsInput(e.target);
  persistSession();
});

// ── Programme › Exercice : technique prescrite (envoyée à l'élève avec le programme du coach) ──
function exIntensHtml(d) {
  if (measureOf({ name: d.name, ...(d.measure ? { measure: d.measure } : {}) }) !== 'reps') return '';
  return `
        <div class="group-title">Intensification</div>
        <div class="group">
          <button class="cell cell--nav" data-action="ex-intens">
            <span class="cell__body"><span class="cell__title">Technique</span><span class="cell__sub">${esc(intensLabel(d.intens) || 'Aucune')}</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
        <div class="group-foot">Ajoutée aux séries à chaque séance. Un élève la reçoit avec le programme.</div>`;
}

registerActions({
  'tech-set': async (e, el) => { await openTechSheet(parseInt(el.dataset.ei), parseInt(el.dataset.si)); },
  'tech-remove': (e, el) => setTechOn(parseInt(el.dataset.ei), parseInt(el.dataset.si), null),
  'tech-add-sub': (e, el) => {
    const s = activeSession?.exercises[parseInt(el.dataset.ei)]?.sets[parseInt(el.dataset.si)];
    if (!s || !addSubSet(s)) return;
    haptic(); persistSession(); render();
  },
  'sub-validate': (e, el) => validateSub(el.dataset),
  // Sous-série validée touchée : de nouveau à remplir (sa charge et ses reps restent)
  'sub-reopen': (e, el) => {
    const x = techSubAt(el.dataset)?.x;
    if (!x?.done) return;
    x.done = false;
    haptic(); persistSession(); render();
  },
  'ex-intens': async () => {
    if (!exDraft) return;
    const v = await dialog({ type: 'sheet', title: 'Technique d\'intensification', message: 'Ajoutée aux séries de l\'exercice à chaque séance.', actions: [
      ...Object.keys(INTENS_PLANS).map(k => ({ label: `${exDraft.intens === k ? '✓ ' : ''}${INTENS_PLANS[k].label}`, value: k })),
      ...(exDraft.intens ? [{ label: 'Aucune', value: 'none', style: 'destructive' }] : []),
      { label: 'Annuler', style: 'cancel' },
    ] });
    if (!v || !exDraft) return;
    exDraft.intens = v === 'none' ? null : v;
    const box = $('#exIntens');
    if (box) box.innerHTML = exIntensHtml(exDraft);
  },
});
