// ═══════════════════════════════════════════════════════════
//  Séance en cours : démarrage, tableau des séries, validation
// ═══════════════════════════════════════════════════════════
'use strict';

let editingSet = null;  // { ei, si, weight?, reps? } — série validée rouverte en édition sur place, avec la saisie en cours
let persistWarned = false; // un seul avertissement « stockage plein » par séance
const openDone = new WeakSet(); // exercices terminés dépliés

// Série à faire : charge et reps reprises de src, « Préc. » de la même série la dernière fois
function plannedSet(src, prev) {
  return {
    weight: src?.weight ?? '',
    reps:   src?.reps   ?? '',
    ...(src?.dist ? { dist: src.dist } : {}),
    plannedWeight: src?.weight ?? '',
    prev:   prev ? { weight: prev.weight, reps: prev.reps, ...(prev.dist ? { dist: prev.dist } : {}) } : null,
    done:   false,
  };
}

// Séries d'un exercice pré-remplies série par série avec la dernière séance (sinon la dernière série faite)
function buildSets(progKey, cat, exLike, n, fallback = {}) {
  const prevEx = lastPerf(progKey, cat, exLike)?.ex;
  return Array.from({ length: n }, (_, i) => {
    const src = prevEx?.sets[i] ?? prevEx?.sets.at(-1) ?? { weight: fallback.lastWeight || '', reps: fallback.lastReps || '' };
    return plannedSet(src, prevEx?.sets[i]);
  });
}

function startSession(cat) {
  sessionNotes  = '';
  persistWarned = false;
  editingSet    = null;
  const progKey = data.activeProgramme;
  const exList  = prog().exercises[cat] || [];
  activeSession = {
    category:  cat,
    programme: progKey,
    startedAt: Date.now(),
    exercises: exList.map(ex => ({ exId: ex.id, name: ex.name, measure: measureOf(ex), sets: buildSets(progKey, cat, ex, ex.sets, ex) })),
  };
  activeSession.baseline = computeBaseline(activeSession);
  persistSession();
  routeTo('session');
  requestWakeLock();
}

// Séance en cours enregistrée avec son repos, pour survivre à la fermeture de l'app
function persistSession() {
  if (writeSession(restSnapshot()) || !activeSession || persistWarned) return;
  persistWarned = true;
  showToast('Stockage plein : la séance n\'est plus sauvegardée', { error: true });
}

function endSession() {
  stopRest(); restMinimized = false;
  closeSessSheets();
  activeSession = null;
  sessionNotes  = '';
  editingSet    = null;
  persistWarned = false;
  persistSession();
  releaseWakeLock();
  applyPendingTheme();
  maybeShowUpdateBanner();
}

// ── Petites aides de la séance ───────────────────────────────

function hasLoad(w) { return w !== '' && w != null; }

// « 32,5 kg × » devant les reps, rien pour un exercice au poids du corps
function loadTimes(w) { return hasLoad(w) ? `${fmtW(w, { plain: true })} ${unitLbl()} × ` : ''; }

// Séries validées et prévues de toute la séance
function sessionSetCounts() {
  const xs = activeSession.exercises;
  return {
    total: xs.reduce((a, ex) => a + ex.sets.length, 0),
    done:  xs.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0),
  };
}

// Exercice du programme correspondant à un exercice de la séance (null s'il a été ajouté en cours de route)
function sessExData(ex) {
  return ex?.exId ? (sessProg().exercises[activeSession.category] || []).find(e => e.id === ex.exId) || null : null;
}

function exRest(ex) {
  return sessExData(ex)?.rest ?? ex?.rest ?? data.defaultRest;
}

// Série courante : la première non faite de l'exercice en cours, sinon la première non faite de la séance
function currentSet() {
  if (!activeSession) return null;
  const xs   = activeSession.exercises;
  const pick = ei => { const si = xs[ei]?.sets.findIndex(s => !s.done) ?? -1; return si >= 0 ? { ei, si } : null; };
  const last = activeSession.lastEi;
  if (Number.isInteger(last) && pick(last)) return pick(last);
  for (let ei = 0; ei < xs.length; ei++) { const c = pick(ei); if (c) return c; }
  return null;
}

// « Développé incliné · S1 · 30 kg × 10 »
function nextSetText() {
  const cur = currentSet();
  if (!cur) return '';
  const ex = activeSession.exercises[cur.ei], s = ex.sets[cur.si];
  const m = measureOf(ex);
  return `${ex.name} · S${cur.si + 1}${s.reps !== '' ? ` · ${m !== 'reps' ? measureSetTxt(s, m) : loadTimes(s.weight) + s.reps}` : ''}`;
}

// Puce « ↑ +2,5 kg » : toutes les séries de la dernière fois ont atteint le haut de la fourchette
function bumpReady(ex) {
  if (ex.bumped || ex.sets.every(s => s.done) || measureOf(ex) !== 'reps' || isAssisted(ex)) return false;
  const prevs = ex.sets.map(s => s.prev).filter(Boolean);
  if (!prevs.length || prevs.length < Math.min(ex.sets.length, 2)) return false;
  const repMax = sessExData(ex)?.repMax ?? 12;
  return prevs.every(p => (parseInt(p.reps) || 0) >= repMax && (parseFloat(p.weight) || 0) > 0);
}

// Ligne repliée d'un exercice terminé : « 4 × 8 · 32,5 kg » (reps différentes : « 10/10/9/8 »)
function doneSummary(ex) {
  const m = measureOf(ex);
  if (m !== 'reps') return ex.sets.map(s => measureSetTxt(s, m)).join(' · ');
  const reps = ex.sets.map(s => String(s.reps));
  const same = reps.every(r => r === reps[0]);
  const maxW = Math.max(0, ...ex.sets.map(s => parseFloat(s.weight) || 0));
  return `${ex.sets.length} × ${same ? reps[0] : reps.join('/')}${maxW ? ` · ${fmtW(maxW, { plain: true })} ${unitLbl()}` : ''}`;
}

// ── Rendu de la séance ───────────────────────────────────────

function renderSession() {
  const meta = sessionMeta(activeSession.category, activeSession.programme);
  const { total, done } = sessionSetCounts();
  const pct  = total ? Math.round(done / total * 100) : 0;
  const cur  = currentSet();

  const exHtml = activeSession.exercises.map((ex, ei) => renderExerciseCard(ex, ei, cur)).join('');

  return `
    <div class="view session ${restActive ? 'session--resting' : ''}" style="--cat-color:${meta.color}">
      ${navBar({ large: false,
        title: `<span class="navbar__title-main">${meta.label}</span>
                <span class="navbar__title-sub session-sub num"><span id="session-count">${done}/${total}</span> · <span id="session-clock">${fmtClock(Date.now() - activeSession.startedAt)}</span></span>`,
        left: `<button class="navbar__icon" data-action="back" aria-label="Réduire la séance">${icon('chevron.down', 24)}</button>`,
        right: `<button class="navbar__text navbar__text--bold" data-action="finish-session">Terminer</button>`,
        extra: `<div class="progress-bar session-progress" role="progressbar" aria-label="Séries validées" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}">
          <div class="progress-bar__fill" style="width:${pct}%"></div>
        </div>` })}
      <div class="session-content">
        ${renderMusicBar()}
        ${exHtml}
        <button class="session-add-ex-btn" data-action="add-session-ex">${icon('plus', 20)} Ajouter un exercice</button>
      </div>
    </div>
    ${renderRestOverlay()}`;
}

// Exercice terminé : une ligne de résumé qui se déplie au tap
function renderCollapsedExercise(ex, ei, records) {
  return `
      <div class="exercise-block ex-card ex-card--collapsed" data-ei="${ei}">
        <button class="ex-summary" data-action="toggle-ex" data-ei="${ei}" aria-expanded="false">
          <span class="ex-summary__text">
            <span class="ex-summary__name">${esc(ex.name)}</span>
            <span class="ex-summary__line num">${doneSummary(ex)}${records ? ` · ${medalSvg(14)}` : ''}</span>
          </span>
          <span class="set-check set-check--done ex-summary__check">${icon('checkmark', 18)}</span>
        </button>
      </div>`;
}

// Volume comparé au même nombre de séries que la dernière fois : jamais rouge en cours de séance.
// Seule une hausse s'affiche, en gris tant que l'exercice n'est pas fini, en vert ensuite.
function exVolumeHtml(ex, allDone) {
  if (measureOf(ex) !== 'reps') return '';
  const prevSets = lastPerf(activeSession.programme, activeSession.category, ex)?.ex.sets || [];
  const doneSets = ex.sets.filter(s => s.done);
  const curVol   = exVolume(ex, doneSets, currentBodyKg());
  const prevVol  = exVolume(ex, prevSets.slice(0, doneSets.length), currentBodyKg());
  const delta    = curVol - prevVol;
  return curVol > 0 && prevVol > 0 && Math.round(delta) > 0
    ? ` · <span class="ex-vol__delta ${allDone ? 'ex-vol__delta--up' : ''}">+${fmtVolume(delta)}</span>` : '';
}

// Sous-titre de la carte : record, repos de l'exercice (modifiable), hausse de volume
function exSubHtml(ex, ei, allDone) {
  const pr   = measureOf(ex) === 'reps' ? sessExData(ex)?.pr : null;
  const rest = fmtRest(exRest(ex));
  return `${pr ? `<span class="num">Record ${fmtW(pr.weight, { plain: true })} × ${esc(pr.reps)}</span> · ` : ''}<button class="ex-rest-link num" data-action="set-ex-rest" data-ei="${ei}" aria-label="Repos ${rest}, modifier">Repos ${rest}</button>${exVolumeHtml(ex, allDone)}`;
}

function renderExerciseCard(ex, ei, cur) {
  const doneN   = ex.sets.filter(s => s.done).length;
  const allDone = ex.sets.length > 0 && doneN === ex.sets.length;

  if (allDone && !openDone.has(ex)) {
    const base    = (activeSession.baseline || {})[ex.exId];
    const records = ex.sets.filter(s => s.done && recordLabel(s, base, ex)).length;
    return renderCollapsedExercise(ex, ei, records);
  }

  const chip = bumpReady(ex) ? `<button class="bump-chip" data-action="bump-weight" data-ei="${ei}" aria-label="Augmenter la charge de ${bumpLabel()}">↑ ${bumpLabel()}</button>` : '';
  const rows = ex.sets.map((s, si) => renderSetRow(ex, ei, s, si, cur)).join('');

  return `
    <div class="exercise-block ex-card ${allDone ? 'ex-card--done' : ''}" data-ei="${ei}">
      <div class="ex-card__head">
        ${allDone
          ? `<button class="ex-card__name ex-card__name--btn" data-action="toggle-ex" data-ei="${ei}" aria-expanded="true">${esc(ex.name)}</button>`
          : `<h2 class="ex-card__name">${esc(ex.name)}</h2>`}
        ${chip}
        <span class="ex-card__count num" aria-label="${doneN} séries sur ${ex.sets.length}">${doneN}/${ex.sets.length}</span>
        <button class="ex-card__more" data-action="ex-menu" data-ei="${ei}" aria-label="Options de ${esc(ex.name)}">${icon('ellipsis', 22)}</button>
      </div>
      <div class="ex-card__sub">${exSubHtml(ex, ei, allDone)}</div>
      <div class="sets" role="table" aria-label="Séries de ${esc(ex.name)}">
        <div class="sets__head" role="row">
          <span role="columnheader">Série</span><span role="columnheader">Préc.</span>
          <span role="columnheader">${loadHeader(ex)}</span><span role="columnheader">${MEASURES[measureOf(ex)].count}</span>
          <span role="columnheader" aria-label="Validée">${icon('checkmark', 14)}</span>
        </div>
        ${rows}
      </div>
      <button class="add-set-link" data-action="add-set" data-ei="${ei}">${icon('plus', 16)} Série</button>
    </div>`;
}

// Série validée : ligne en lecture seule, rouverte en édition au tap
function renderDoneSetRow(ex, ei, s, si, prev, del) {
  const m      = measureOf(ex), M = MEASURES[m];
  const record = m === 'reps' ? recordLabel(s, (activeSession.baseline || {})[ex.exId], ex) : '';
  const first  = setFirstValue(s, m);
  const load   = first ? `${first} ${m === 'cardio' ? 'kilomètres' : data.unit === 'lbs' ? 'livres' : 'kilos'}, ` : '';
  return `
      <div class="set-swipe" role="row">
        ${del}
        <div class="session-set session-set--done" data-action="edit-set" data-ei="${ei}" data-si="${si}" role="button" tabindex="0"
             aria-label="Série ${si + 1} validée, ${load}${esc(s.reps)} ${M.spoken}, ${esc(ex.name)}${record ? ', record' : ''}. Modifier">
          <span class="set-n num">${si + 1}</span>
          <span class="set-prev num">${prev}</span>
          <span class="set-val num">${first || '—'}</span>
          <span class="set-val num">${esc(s.reps)}</span>
          <span class="set-check-zone"><span class="set-check set-check--done">${icon('checkmark', 18)}</span></span>
          ${record ? `<span class="set-badge"><span class="pr-badge">${record}</span></span>` : ''}
        </div>
      </div>`;
}

// En-tête de la première colonne : kg (barre, haltères), Lest ou Aide (poids du corps), km, Lest (durée)
function loadHeader(ex) {
  const m = measureOf(ex);
  if (m !== 'reps') return MEASURES[m].load();
  return { charge: unitLbl(), lest: 'Lest', aide: 'Aide' }[loadKind(ex)];
}

// Valeur de la première colonne : charge (ou lest) dans l'unité de l'app, distance en km pour le cardio
function setFirstValue(s, m) {
  if (m === 'cardio') return parseFloat(s?.dist) > 0 ? fmtNum(s.dist) : '';
  return hasLoad(s?.weight) ? fmtW(s.weight, { plain: true }) : '';
}

function renderSetRow(ex, ei, s, si, cur) {
  const m       = measureOf(ex), M = MEASURES[m];
  const prevF   = setFirstValue(s.prev, m);
  const prev    = s.prev ? `${prevF ? prevF + '&nbsp;× ' : ''}${esc(s.prev.reps)}` : '—';
  const editing = editingSet && editingSet.ei === ei && editingSet.si === si;
  const del     = `<button class="set-del" data-action="delete-set" data-ei="${ei}" data-si="${si}" tabindex="-1" aria-label="Supprimer la série ${si + 1}">Supprimer</button>`;

  if (s.done && !editing) return renderDoneSetRow(ex, ei, s, si, prev, del);

  const isCur = !editing && cur && cur.ei === ei && cur.si === si;
  // Série rouverte : la saisie en cours (editingSet) prime, sinon un re-rendu la remettrait à l'ancienne valeur
  const wVal = editing && editingSet.weight !== undefined ? editingSet.weight : (m === 'cardio' ? (s.dist ? fmtNum(s.dist) : '') : fmtW(s.weight, { plain: true }));
  const rVal = editing && editingSet.reps   !== undefined ? editingSet.reps   : s.reps;
  const prevW = prevF;
  // Série validée rouverte : mêmes champs, enregistrés par le ✓
  const wAttr = editing ? 'id="editSetWeight"' : `data-action="${m === 'cardio' ? 'set-dist' : 'set-weight'}" data-ei="${ei}" data-si="${si}"`;
  const rAttr = editing ? 'id="editSetReps"'   : `data-action="set-reps" data-ei="${ei}" data-si="${si}"`;
  const check = editing
    ? `<button class="set-check-zone" data-action="save-edit-set" aria-label="Enregistrer la série ${si + 1}, ${esc(ex.name)}"><span class="set-check set-check--edit">${icon('checkmark', 18)}</span></button>`
    : `<button class="set-check-zone" data-action="validate-set" data-ei="${ei}" data-si="${si}" aria-label="Valider la série ${si + 1}, ${esc(ex.name)}"><span class="set-check"></span></button>`;
  return `
    <div class="set-swipe" role="row">
      ${editing ? '' : del}
      <div class="session-set ${isCur ? 'session-set--current' : ''} ${editing ? 'session-set--editing' : ''}" ${isCur ? 'aria-current="step"' : ''} data-ei="${ei}" data-si="${si}">
        <span class="set-n num">${si + 1}</span>
        <span class="set-prev num">${prev}</span>
        <input type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" class="set-input num" ${wAttr}
               value="${esc(wVal)}" placeholder="${prevW || '—'}" aria-label="${m === 'cardio' ? 'Distance' : m === 'time' ? 'Lest' : { charge: 'Charge', lest: 'Lest', aide: 'Aide' }[loadKind(ex)]} série ${si + 1}, ${esc(ex.name)}, en ${m === 'cardio' ? 'kilomètres' : unitLbl()}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="${editing ? 'done' : 'next'}" autocomplete="off" class="set-input set-input--required num" ${rAttr}
               value="${esc(rVal)}" placeholder="${esc(s.prev?.reps ?? '0')}" aria-label="${m === 'reps' ? 'Répétitions' : `Durée en ${M.spoken}`} série ${si + 1}, ${esc(ex.name)}">
        ${check}
      </div>
    </div>`;
}

// ── Validation d'une série ───────────────────────────────────

function validateSet(ei, si) {
  const ex  = activeSession.exercises[ei];
  const s   = ex?.sets[si];
  if (!s || s.done) return;
  const rIn = document.querySelector(`[data-action="set-reps"][data-ei="${ei}"][data-si="${si}"]`);
  const m   = measureOf(ex);
  const wIn = document.querySelector(`[data-action="${m === 'cardio' ? 'set-dist' : 'set-weight'}"][data-ei="${ei}"][data-si="${si}"]`);
  if (m === 'cardio' ? !distOk(wIn?.value) : (wIn && !weightOk(wIn.value))) { flagInvalid(wIn, m === 'cardio' ? distMsg() : weightMsg()); return; }
  if (num(s.reps, 1, MEASURES[m].max, true) === null) { flagInvalid(rIn, MEASURES[m].msg); return; }
  s.reps = String(parseInt(s.reps));

  s.done = true;
  activeSession.lastEi = ei;
  editingSet = null;
  validationSound();
  haptic();

  const undo = carryWeightToNextSet(ex, si);
  const allDone = activeSession.exercises.every(e => e.sets.every(st => st.done));
  if (!allDone) openRest(exRest(ex), false);
  else { stopRest(); closeSessSheets(); }

  document.activeElement?.blur?.();
  render();
  scrollToCurrent();
  showToast(`Série ${si + 1} validée`, { action: 'Annuler', duration: 4000, onAction: () => undoValidate(undo) });
}

// La série suivante garde sa valeur prévue, sauf si la charge vient d'être modifiée.
// Renvoie de quoi annuler la validation (série validée et charge d'origine de la suivante).
function carryWeightToNextSet(ex, si) {
  const s       = ex.sets[si];
  const nextSet = ex.sets[si + 1];
  const undo    = { s, next: null, nextW: null, nextR: null };
  if (!nextSet || nextSet.done) return undo;
  undo.next = nextSet; undo.nextW = nextSet.weight; undo.nextR = nextSet.reps;
  if ((parseFloat(s.weight) || 0) !== (parseFloat(s.plannedWeight) || 0)) nextSet.weight = s.weight;
  // Reps : reprises seulement si rien n'était prévu (premier essai d'un exercice), jamais un objectif écrasé
  if (String(nextSet.reps ?? '').trim() === '' && s.reps) nextSet.reps = s.reps;
  return undo;
}

// « Annuler » du toast : la série redevient à faire et le repos s'arrête
function undoValidate(u) {
  if (!activeSession || !u.s.done) return;
  u.s.done = false;
  if (u.next && !u.next.done) { u.next.weight = u.nextW; u.next.reps = u.nextR; }
  stopRest();
  closeSessSheets();
  persistSession();
  render();
  scrollToCurrent();
}

// Centre la série courante à l'écran (après validation, reprise ou restauration)
function scrollToCurrent(smooth = true) {
  requestAnimationFrame(() => {
    const row = $('.session-set--current');
    if (!row) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'center', behavior: smooth && !reduce ? 'smooth' : 'auto' });
  });
}

// Appelé par render() après l'affichage de la séance
function afterSessionRender(entering) {
  if (entering) scrollToCurrent(false);
  const a = document.activeElement;
  if (!(a && a.matches?.('.set-input'))) document.body.classList.remove('kb-open');
}

// Série validée rouverte : enregistre ses champs (les records ne sont recalculés qu'à l'enregistrement de la séance).
// Appelé par le ✓, par Entrée, et quand la saisie quitte la série (le ✓ est facile à manquer quand le clavier se ferme).
// Renvoie false si une valeur est invalide (champ signalé, série laissée ouverte), true sinon.
function saveEditedSet() {
  if (!editingSet) return true;
  const { ei, si } = editingSet;
  const s = activeSession.exercises[ei]?.sets[si];
  if (!s) { editingSet = null; render(); return true; }
  // Valeurs : la saisie gardée (editingSet), sinon les champs, sinon la série telle quelle
  const wIn = $('#editSetWeight'), rIn = $('#editSetReps');
  const rRaw = editingSet.reps   ?? rIn?.value ?? s.reps;
  const m = measureOf(activeSession.exercises[ei]);
  const firstRaw = editingSet.weight ?? wIn?.value ?? (m === 'cardio' ? (s.dist ? fmtNum(s.dist) : '') : fmtW(s.weight, { plain: true }));
  if (m === 'cardio' ? !distOk(firstRaw) : !weightOk(firstRaw)) { flagInvalid(wIn, m === 'cardio' ? distMsg() : weightMsg()); return false; }
  const reps = num(rRaw, 1, MEASURES[m].max, true);
  if (reps === null) { flagInvalid(rIn, MEASURES[m].msg); return false; }
  if (m === 'cardio') setDist(s, firstRaw); else s.weight = storeW(firstRaw ?? '');
  s.reps   = String(reps);
  editingSet = null;
  document.activeElement?.blur?.();
  haptic();
  render();
  showToast('Série modifiée');
  return true;
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'resume-session': () => {
    if (!activeSession) return;
    if (currentRoute() !== 'session') navigate('session');
  },
  'validate-set': (e, el) => {
    if (editingSet && !saveEditedSet()) return;   // correction en cours : enregistrée avant de passer à la suite
    validateSet(parseInt(el.dataset.ei), parseInt(el.dataset.si));
  },
  'edit-set': (e, el) => {
    // Série validée rouverte sur place, avec ses champs et le ✓
    if (swipeBlockClick) return;
    if (editingSet && !saveEditedSet()) return;
    editingSet = { ei: parseInt(el.dataset.ei), si: parseInt(el.dataset.si) };
    render();
    // Curseur placé pendant le tap lui-même : iOS n'ouvre le clavier que dans le geste, et un focus
    // différé reviendrait dans le champ après une sortie rapide (qui ne serait alors pas enregistrée)
    $('#editSetReps')?.focus({ preventScroll: true });
  },
  'save-edit-set': saveEditedSet,
  'delete-set': (e, el) => {
    const ei = parseInt(el.dataset.ei), si = parseInt(el.dataset.si);
    const ex = activeSession?.exercises[ei];
    if (!ex?.sets[si]) return;
    if (ex.sets.length === 1) { closeSwipes(); showToast('Dernière série : retire l\'exercice avec ⋯'); return; }
    ex.sets.splice(si, 1);
    editingSet = null;
    haptic();
    render();
  },
  'add-set': (e, el) => {
    const ex = activeSession?.exercises[parseInt(el.dataset.ei)];
    if (!ex || ex.sets.length >= 20) return;
    const pex = lastPerf(activeSession.programme, activeSession.category, ex)?.ex;
    ex.sets.push(plannedSet(ex.sets.at(-1), pex?.sets[ex.sets.length]));
    openDone.add(ex);
    haptic();
    render();
  },
  'toggle-ex': (e, el) => {
    const ex = activeSession?.exercises[parseInt(el.dataset.ei)];
    if (!ex) return;
    if (openDone.has(ex)) openDone.delete(ex); else openDone.add(ex);
    render();
  },
  'bump-weight': (e, el) => {
    const ex = activeSession?.exercises[parseInt(el.dataset.ei)];
    if (!ex) return;
    const step = data.unit === 'lbs' ? 5 : 2.5;
    ex.sets.forEach(s => {
      if (s.done) return;
      const cur = toUnitW(s.weight || s.prev?.weight) || 0;
      s.weight = storeW(String(Math.round((cur + step) * 100) / 100));
      s.plannedWeight = s.weight;
    });
    ex.bumped = true;
    haptic();
    render();
    showToast(`Charge augmentée : ${bumpLabel()}`);
  },
});
