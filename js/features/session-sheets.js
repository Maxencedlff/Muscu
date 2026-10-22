// ═══════════════════════════════════════════════════════════
//  Feuilles de la séance : repos d'un exercice, ajout d'exercice, menu ⋯
// ═══════════════════════════════════════════════════════════
'use strict';

let restEditEi = null;  // exercice dont on règle le repos (feuille)

// Feuille de la séance : comme sheet(), mais sans barre Annuler/OK, non bloquante et mise à jour
// en direct (repos, ajout d'exercice). Fermée aussi par closeTransientUI() lors d'un changement d'écran.
function openSessSheet({ cls = '', label = '', html, full = false, onClose }) {
  document.querySelector(`.sess-sheet${cls ? '.' + cls : ''}`)?.remove();
  const root = document.createElement('div');
  root.className = `sess-sheet ${full ? 'sess-sheet--full' : ''} ${cls}`;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', label);
  root.innerHTML = `
    <div class="sess-sheet__backdrop"></div>
    <div class="sess-sheet__panel">
      <div class="sess-sheet__grabber" aria-hidden="true"></div>
      <div class="sess-sheet__body">${html}</div>
    </div>`;
  const panel = root.querySelector('.sess-sheet__panel');
  const body  = root.querySelector('.sess-sheet__body');
  let closed = false;
  root._close = () => {
    if (closed) return;
    closed = true;
    root.classList.add('sess-sheet--out');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => root.remove(), 220);
    onClose?.();
  };
  const onKey = ev => { if (ev.key === 'Escape') root._close(); };
  document.addEventListener('keydown', onKey);
  root.querySelector('.sess-sheet__backdrop').addEventListener('click', () => root._close());

  // Glisser vers le bas depuis le haut de la feuille (contenu en haut de son défilement)
  let drag = null;
  panel.addEventListener('pointerdown', ev => {
    if (ev.target.closest('input, textarea') || body.scrollTop > 0) return;
    drag = { y0: ev.clientY, dy: 0 };
  });
  panel.addEventListener('pointermove', ev => {
    if (!drag) return;
    drag.dy = Math.max(0, ev.clientY - drag.y0);
    if (drag.dy > 6) { panel.style.transition = 'none'; panel.style.transform = `translateY(${drag.dy}px)`; }
  });
  const end = () => {
    if (!drag) return;
    const dy = drag.dy; drag = null;
    panel.style.transition = ''; panel.style.transform = '';
    if (dy > 110) root._close();
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);

  document.body.appendChild(root);
  return root;
}

function closeSessSheets() {
  document.querySelectorAll('.sess-sheet').forEach(s => s._close?.());
  restSheetOpen = false;
}

// ── Repos d'un exercice : préréglages et ±15 s, sans clavier ──
function exRestSheetHtml(ei) {
  const ex = activeSession.exercises[ei];
  const v  = exRest(ex);
  return `
    <div class="rs rs--ex">
      <div class="rs__title">Repos · ${esc(ex.name)}</div>
      <div class="rs__value num" id="exRestValue">${fmtRest(v)}</div>
      <div class="rs-seg" role="group" aria-label="Durée du repos">
        ${REST_PRESETS.map(p => `<button class="rs-seg__btn num" data-action="ex-rest-set" data-secs="${p}" aria-pressed="${v === p}">${fmtRest(p)}</button>`).join('')}
      </div>
      <div class="rs__adj">
        <button class="rs__round num" data-action="ex-rest-adj" data-d="-15" aria-label="Moins 15 secondes">−15</button>
        <button class="rs__done" data-action="sheet-done">OK</button>
        <button class="rs__round num" data-action="ex-rest-adj" data-d="15" aria-label="Plus 15 secondes">+15</button>
      </div>
    </div>`;
}

// onClose : rafraîchir la carte (lien « Repos ») ou non, selon d'où la feuille est ouverte
function openExRestSheet(ei, onClose) {
  restEditEi = ei;
  openSessSheet({ cls: 'sess-sheet--exrest', label: 'Repos', html: exRestSheetHtml(ei), onClose: () => { restEditEi = null; onClose?.(); } });
}

function setExRest(ei, secs) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  secs = Math.min(600, Math.max(15, secs));
  const exData = sessExData(ex);
  if (exData) { exData.rest = secs; save(); } else ex.rest = secs;
  const val = $('#exRestValue');
  if (val) val.textContent = fmtRest(secs);
  document.querySelectorAll('.sess-sheet--exrest .rs-seg__btn').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.secs === secs)));
  haptic();
}

// ── Ajouter (ou remplacer) un exercice : recherche dans la bibliothèque ──
// Une seule feuille pour trois cibles : la séance en cours ('session'), Programme › Séance
// ('programme') et la séance passée ('past', qui reçoit le choix par onPick(name, sets)).
let ax = { target: 'session', replaceEi: null, exclude: new Set(), onPick: null };
let axSets = 3;

function axListHtml(q) {
  const nq    = normName(q);
  const eq    = data.exEquip;
  const items = exerciseLibrary().filter(n => !ax.exclude.has(normName(n)) && (!nq || normName(n).includes(nq))
    && (eq === 'all' || equipmentOf(n) === eq)).slice(0, 60);
  const exact = items.some(n => normName(n) === nq);
  return items.map(n => `<button class="ax__item" data-action="ax-pick" data-name="${esc(n)}"><span class="ax__body"><span>${esc(n)}</span>${exMusclesSubHtml({ name: n }, 'ax__sub')}</span></button>`).join('')
    + (q.trim() && !exact ? `<button class="ax__item ax__item--create" data-action="ax-pick" data-name="${esc(q.trim())}">${icon('plus', 18)} Créer « ${esc(q.trim())} »</button>` : '')
    + (!items.length && !q.trim() ? '<div class="ax__empty">Aucun exercice</div>' : '');
}

// Filtre de matériel : retenu d'une fois sur l'autre (data.exEquip), pour qui s'entraîne toujours au même endroit
function axEquipHtml() {
  return `<div class="ax__equip" role="group" aria-label="Matériel">
    ${[{ id: 'all', label: 'Tout' }, ...EQUIPMENT].map(({ id, label }) =>
      `<button class="ax__chip" aria-pressed="${data.exEquip === id}" data-action="ax-equip" data-equip="${id}">${label}</button>`).join('')}
  </div>`;
}

// exclude : noms à ne pas proposer (par défaut, les exercices de la séance en cours)
function openAddExSheet({ target = 'session', replaceEi = null, exclude, onPick = null } = {}) {
  const names = exclude ?? (activeSession?.exercises || []).map(e => e.name);
  ax = { target, replaceEi: target === 'session' ? replaceEi : null, exclude: new Set(names.map(normName)), onPick };
  const rep   = ax.replaceEi !== null ? activeSession.exercises[ax.replaceEi] : null;
  axSets      = rep ? rep.sets.length : 3;
  const html = `
    <div class="ax">
      <div class="ax__bar">
        <button class="ax__cancel" data-action="sheet-done">Annuler</button>
        <div class="ax__title">${rep ? 'Remplacer l\'exercice' : 'Ajouter un exercice'}</div>
        <span class="ax__spacer"></span>
      </div>
      ${rep ? `<div class="ax__replacing">À la place de ${esc(rep.name)}</div>` : ''}
      <input type="search" id="axSearch" class="ax__search" placeholder="Rechercher ou créer" autocomplete="off"
             autocapitalize="sentences" enterkeyhint="done" aria-label="Rechercher un exercice">
      ${axEquipHtml()}
      <div class="ax__opts">
        <div class="ax__opt">
          <span>Séries</span>
          <div class="ax-stepper">
            <button data-action="ax-sets" data-d="-1" aria-label="Une série de moins">${icon('minus', 18)}</button>
            <span id="axSets" class="num" aria-live="polite">${axSets}</span>
            <button data-action="ax-sets" data-d="1" aria-label="Une série de plus">${icon('plus', 18)}</button>
          </div>
        </div>
        ${rep || target !== 'session' ? '' : `
        <label class="ax__opt">
          <span>Ajouter au programme</span>
          <input type="checkbox" id="axToProg" class="ax-switch" role="switch">
        </label>`}
      </div>
      <div class="ax__list" id="axList" role="list">${axListHtml('')}</div>
    </div>`;
  openSessSheet({ cls: 'sess-sheet--addex', label: rep ? 'Remplacer l\'exercice' : 'Ajouter un exercice', html, full: true });
}

// Exercice choisi dans la feuille (liste, « Créer » ou touche Entrée), remis à sa cible
function axPick(name) {
  name = String(name || '').trim();
  if (!name) return;
  if (ax.target === 'programme') addExerciseToEditedSession(name);
  else if (ax.target === 'past') ax.onPick?.(name, axSets);
  else pickExercise(name);
  askMusclesIfUnknown(name);
}

// Programme › Séance : l'exercice rejoint le programme ; ses réglages se font ensuite dans Programme › Exercice
function addExerciseToEditedSession(name) {
  const cat  = editorCatOf();
  const list = prog().exercises[cat] || (prog().exercises[cat] = []);
  if (list.some(e => normName(e.name) === normName(name))) { showToast('Déjà dans cette séance'); return; }
  list.push(makeExercise(name, axSets));
  save();
  closeSessSheets();
  haptic();
  showToast('Exercice ajouté');
  render();
}

// Exercice ajouté (ou remplaçant) dans la séance en cours, éventuellement ajouté aussi au programme
function pickExercise(name) {
  if (!activeSession) return;
  const { programme: sp, category: sc } = activeSession;
  const list    = sessProg().exercises[sc] || (sessProg().exercises[sc] = []);
  let inProg    = list.find(e => normName(e.name) === normName(name));
  const toProg  = $('#axToProg')?.checked;
  if (toProg && !inProg && ax.replaceEi === null) {
    inProg = makeExercise(name, axSets);
    list.push(inProg);
    save();
  }
  let exId = inProg ? inProg.id : resolveExId(sp, sc, name);
  if (exId?.startsWith('n:')) exId = null; // résolu à l'enregistrement, comme avant
  const exObj = { exId, name: inProg ? inProg.name : name, sets: buildSets(sp, sc, { exId, name }, axSets, inProg || {}) };
  if (exObj.exId && !activeSession.baseline?.[exObj.exId]) {
    activeSession.baseline = { ...(activeSession.baseline || {}), ...computeBaseline({ ...activeSession, exercises: [exObj] }) };
  }
  let target;
  if (ax.replaceEi !== null) {
    activeSession.exercises.splice(ax.replaceEi, 1, exObj);
    target = ax.replaceEi;
    showToast('Exercice remplacé');
  } else {
    activeSession.exercises.push(exObj);
    target = activeSession.exercises.length - 1;
    showToast(toProg ? 'Ajouté à la séance et au programme' : 'Ajouté à la séance');
  }
  activeSession.lastEi = null;
  closeSessSheets();
  haptic();
  persistSession();
  render();
  setTimeout(() => document.querySelector(`.ex-card[data-ei="${target}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

// ── Menu ⋯ d'un exercice ──
async function exerciseMenu(ei) {
  const ex = activeSession.exercises[ei];
  if (!ex) return;
  const last = activeSession.exercises.length - 1;
  const choice = await dialog({ type: 'sheet', title: ex.name, actions: [
    ...(ei > 0    ? [{ label: 'Monter', value: 'up' }] : []),
    ...(ei < last ? [{ label: 'Descendre', value: 'down' }] : []),
    { label: 'Remplacer l\'exercice', value: 'replace' },
    { label: 'Régler le repos', value: 'rest' },
    { label: 'Muscles ciblés', value: 'muscles' },
    { label: 'Relancer le repos', value: 'restart' },
    { label: 'Retirer l\'exercice', value: 'remove', style: 'destructive' },
    { label: 'Annuler', style: 'cancel' },
  ] });
  if (!choice || !activeSession) return;
  const xs = activeSession.exercises;
  if (choice === 'up' || choice === 'down') {
    const to = choice === 'up' ? ei - 1 : ei + 1;
    [xs[ei], xs[to]] = [xs[to], xs[ei]];
    activeSession.lastEi = null;
    render();
  } else if (choice === 'replace') {
    openAddExSheet({ replaceEi: ei });
  } else if (choice === 'muscles') {
    if (await declareMusclesFor(ex.name)) render();
  } else if (choice === 'rest') {
    openExRestSheet(ei);
  } else if (choice === 'restart') {
    openRest(exRest(ex));
  } else if (choice === 'remove') {
    const done = ex.sets.filter(s => s.done).length;
    if (done && !(await confirmSheet('Retirer l\'exercice ?', `Les ${done} séries validées de cet exercice ne seront pas enregistrées. Le programme ne change pas.`, 'Retirer'))) return;
    xs.splice(ei, 1);
    activeSession.lastEi = null;
    editingSet = null;
    render();
    showToast('Exercice retiré de la séance');
  }
  persistSession();
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'ex-menu': async (e, el) => {
    await exerciseMenu(parseInt(el.dataset.ei));
  },
  'set-ex-rest': (e, el) => {
    const ei = parseInt(el.dataset.ei);
    if (!activeSession?.exercises[ei]) return;
    openExRestSheet(ei, render);
  },
  'ex-rest-set': (e, el) => {
    if (restEditEi !== null) setExRest(restEditEi, parseInt(el.dataset.secs));
  },
  'ex-rest-adj': (e, el) => {
    if (restEditEi !== null) setExRest(restEditEi, exRest(activeSession.exercises[restEditEi]) + parseInt(el.dataset.d));
  },
  'sheet-done': (e, el) => {
    el.closest('.sess-sheet')?._close?.();
  },
  'ax-sets': (e, el) => {
    axSets = Math.min(10, Math.max(1, axSets + parseInt(el.dataset.d)));
    const n = $('#axSets');
    if (n) n.textContent = axSets;
  },
  'ax-equip': (e, el) => {
    data.exEquip = el.dataset.equip;
    save();
    document.querySelectorAll('[data-action="ax-equip"]').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
    const list = $('#axList');
    if (list) { list.innerHTML = axListHtml($('#axSearch')?.value || ''); list.scrollTop = 0; }
  },
  'ax-pick': (e, el) => {
    axPick(el.dataset.name);
  },
  'add-session-ex': () => {
    openAddExSheet();
  },
});
