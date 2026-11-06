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
function techSubAt(ds) {
  const s = activeSession?.exercises[parseInt(ds.ei)]?.sets[parseInt(ds.si)];
  return s && setTech(s) ? { s, x: s.sub?.[parseInt(ds.k)] || null, k: parseInt(ds.k) } : null;
}

// Numéro d'une série de travail à faire (ou rouverte) : bouton qui ouvre le choix d'une technique.
// Même aspect que le numéro ; zone de toucher de 44 px (session.css)
function setTechNumHtml(ex, ei, si) {
  const t = setTech(ex.sets[si]);
  return `<button class="set-n set-tech-n num" data-action="tech-set" data-ei="${ei}" data-si="${si}" aria-label="${setSpokenName(ex, si)}, ${esc(ex.name)} : technique d'intensification${t ? `, ${TECHS[t].label}` : ''}">${setDisplayNo(ex.sets, si)}</button>`;
}

// Sous la série : titre de la technique (+ une sous-série, retirer), puis une ligne par sous-série,
// remplie comme une série (charge proposée, objectif de la dernière fois en gris, ✓)
function techBlockHtml(ex, ei, s, si) {
  const t = setTech(s);
  if (!t || !canTech(ex)) return '';
  const T = TECHS[t], name = setSpokenName(ex, si).toLowerCase();
  const add = T.sub && (s.sub || []).length < TECH_SUB_MAX
    ? `<button class="tech__add" data-action="tech-add-sub" data-ei="${ei}" data-si="${si}" aria-label="Ajouter ${T.fem ? 'une' : 'un'} ${T.subName}, ${name}">${icon('plus', 14)}${T.subName}</button>` : '';
  const rows = T.sub ? (s.sub || []).map((x, k) => subRowHtml(ex, ei, s, si, x, k)).join('') : '';
  return `
    <div class="tech" role="group" aria-label="${T.label}, ${name}">
      <div class="tech__cap">
        <span class="tech__name">${T.label}</span><span class="tech__hint">${T.hint}</span>
        ${add}
        <button class="tech__x" data-action="tech-remove" data-ei="${ei}" data-si="${si}" aria-label="Retirer le ${T.label.toLowerCase()} de la ${name}">${icon('xmark', 14)}</button>
      </div>
      ${rows}
    </div>`;
}

function subRowHtml(ex, ei, s, si, x, k) {
  const T = TECHS[setTech(s)], tag = `${T.short}${k + 1}`, kind = loadKind(ex);
  const spoken = `${T.subName} ${k + 1}, ${setSpokenName(ex, si).toLowerCase()}, ${esc(ex.name)}`;
  const prev = x.prev ? `${hasLoad(x.prev.weight) ? fmtW(x.prev.weight, { plain: true }) + '&nbsp;× ' : ''}${esc(x.prev.reps)}` : '—';
  const at = `data-ei="${ei}" data-si="${si}" data-k="${k}"`;
  if (x.done) {
    const w = hasLoad(x.weight) ? fmtW(x.weight, { plain: true }) : '';
    return `
      <div class="session-set session-set--done session-set--sub" data-action="sub-reopen" ${at} role="button" tabindex="0">
        <span class="sr-text">${capitalize(spoken)} validé${T.fem ? 'e' : ''}, ${esc(measureSetTxt(x, 'reps', kind))}. Modifier</span>
        <span class="set-n tech-tag" aria-hidden="true">${tag}</span>
        <span class="set-prev num" aria-hidden="true">${prev}</span>
        <span class="set-val num" aria-hidden="true">${w || '—'}</span>
        <span class="set-val num" aria-hidden="true">${esc(x.reps)}</span>
        <span class="set-check-zone" aria-hidden="true"><span class="set-check set-check--done">${icon('checkmark', 18)}</span></span>
      </div>`;
  }
  const first = (s.sub || []).findIndex(y => !y.done);
  const cur = s.done && first === k;
  const wait = !s.done || first < k;
  const kg = subWeightKg(s, k, techOpts(ex));
  return `
      <div class="session-set session-set--sub ${cur ? 'session-set--subcur' : ''}" ${at}>
        <span class="set-n tech-tag" aria-hidden="true">${tag}</span>
        <span class="set-prev num">${x.prev ? '<span class="visually-hidden">La dernière fois </span>' : ''}${prev}</span>
        <input type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" class="set-input num" data-action="sub-weight" ${at}
               value="${esc(fmtW(kg, { plain: true }))}" placeholder="—" aria-label="${loadSpoken(ex)}, ${spoken}, en ${unitLbl()}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" class="set-input set-input--required num" data-action="sub-reps" ${at}
               value="${esc(x.reps)}" placeholder="${esc(x.prev?.reps || '')}" aria-label="Répétitions, ${spoken}">
        <button class="set-check-zone ${wait ? 'set-check-zone--wait' : ''}" data-action="sub-validate" ${at} ${wait ? 'aria-disabled="true"' : ''} aria-label="Valider ${T.fem ? 'la' : 'le'} ${spoken}"><span class="set-check"></span></button>
      </div>`;
}

// ── Choix d'une technique ────────────────────────────────────
async function techMenuChoice(ei, choice) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  const idx = ex.sets.map((s, i) => i).filter(i => !isWarmupSet(ex.sets[i]));
  if (!idx.length) return;
  if (choice === 'tech-drop-last') { setTechOn(ei, idx.at(-1), 'drop'); return; }
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
    message: 'Drop set : charge allégée sans repos. Rest-pause et cluster : même charge après une courte pause. Notés sous la série. Top set et back-off la marquent.', actions: [
      ...TECH_IDS.map(id => ({ label: `${id === cur ? '✓ ' : ''}${TECHS[id].label}`, value: id })),
      ...(cur ? [{ label: 'Retirer la technique', value: 'none', style: 'destructive' }] : []),
      { label: 'Annuler', style: 'cancel' },
    ] });
  if (!t || activeSession?.exercises[ei]?.sets[si] !== s) return;
  setTechOn(ei, si, t === 'none' ? null : t);
}
function setTechOn(ei, si, t) {
  const ex = activeSession?.exercises[ei], s = ex?.sets[si];
  if (!s) return;
  const before = { tech: s.tech, sub: s.sub ? clone(s.sub) : undefined };
  if (!applyTech(s, t)) { if (t) showToast(`Déjà en ${TECHS[t].label.toLowerCase()}`); return; }
  haptic();
  persistSession();
  render();
  const undo = () => { if (!activeSession) return; delete s.tech; delete s.sub; Object.assign(s, before.tech ? { tech: before.tech } : {}, before.sub ? { sub: before.sub } : {}); persistSession(); render(); };
  showToast(t ? `${TECHS[t].label} · ${setSpokenName(ex, si)}` : 'Technique retirée', { action: 'Annuler', duration: 4000, onAction: undo });
}

// ── Validation d'une sous-série ──────────────────────────────
function validateSub(ds) {
  const hit = techSubAt(ds);
  if (!hit?.x || hit.x.done) return;
  const { s, x, k } = hit, ei = parseInt(ds.ei), si = parseInt(ds.si);
  const ex = activeSession.exercises[ei], T = TECHS[setTech(s)];
  if (!s.done) { showToast(`Valide d'abord la ${setSpokenName(ex, si).toLowerCase()}`); return; }
  const first = s.sub.findIndex(y => !y.done);
  if (first < k) { showToast(`Valide d'abord ${T.fem ? 'la' : 'le'} ${T.subName} ${first + 1}`); return; }
  const q = sel => document.querySelector(`[data-action="${sel}"][data-ei="${ei}"][data-si="${si}"][data-k="${k}"]`);
  const wIn = q('sub-weight'), rIn = q('sub-reps');
  restoreClearedInput(wIn); restoreClearedInput(rIn);
  if (wIn && !weightOk(wIn.value)) { flagInvalid(wIn, weightMsg()); return; }
  const reps = num(String(x.reps ?? '').trim() || x.prev?.reps || '', 1, MEASURES.reps.max, true);
  if (reps === null) { flagInvalid(rIn, 'Note tes répétitions'); return; }
  const wasAuto = !!x.auto, wasReps = x.reps;
  x.weight = wIn ? storeW(wIn.value) : subWeightKg(s, k, techOpts(ex));
  delete x.auto;
  x.reps = String(reps);
  x.done = true;
  haptic();
  afterPaint(validationSound);
  const xs = activeSession.exercises;
  const more = s.sub.some(y => !y.done);
  // Sous-série suivante : la courte pause de la technique ; dernière : le repos habituel de l'exercice
  if (more) { if (T.pause) openRest(T.pause, false); else stopRest(); }
  else if (xs.every(e => e.sets.every(st => st.done))) stopRest();
  else openRest(exRest(xs[restEi(ei)]), false);
  document.activeElement?.blur?.();
  persistSession();
  render();
  showToast(`${capitalize(T.subName)} ${k + 1} validé${T.fem ? 'e' : ''}`, { action: 'Annuler', duration: 4000, onAction: () => {
    if (!activeSession || !x.done) return;
    x.done = false; x.reps = wasReps;
    if (wasAuto) x.auto = true;
    stopRest(); persistSession(); render();
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
  if (a === 'sub-weight') { x.weight = storeW(e.target.value); delete x.auto; } else x.reps = e.target.value;
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
        <div class="group-foot">Posée sur les séries à chaque séance, à remplir sous la série. Un élève la reçoit avec ton programme.</div>`;
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
    const v = await dialog({ type: 'sheet', title: 'Technique d\'intensification', message: 'Posée sur les séries de l\'exercice à chaque séance.', actions: [
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
