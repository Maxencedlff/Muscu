// ═══════════════════════════════════════════════════════════
//  Séance passée : saisie, modification, brouillon
// ═══════════════════════════════════════════════════════════
'use strict';

let addCat        = firstSession();
let addDate       = localISO();
let addSets       = {};
let addExtras     = [];  // exercices hors programme dans une séance passée : { key, name, exId }
let addProg       = 'ppl'; // programme de la séance passée (celui de la séance modifiée)
let addPrev       = {};  // valeurs de la dernière séance, affichées en placeholder
let editSessionId = null;
let addNotes      = '';

const ADD_DRAFT_KEY = 'ppl_add_draft';
let addSnapshot = null;
function addState() {
  return JSON.stringify({ addCat, addDate, addSets, addExtras, addNotes, addProg, editSessionId });
}
function addDirty() { return addSnapshot !== null && addState() !== addSnapshot; }

// Crochets de l'écran (routeur) : ouvert par la navigation, on mémorise l'état de départ
// pour savoir s'il a été modifié ; quitté, le brouillon n'a plus lieu d'être
function addSessionEnter(dir) {
  if (dir === 'push' || dir === 'up') addSnapshot = addState();
}
function addSessionLeave() {
  addSnapshot = null;
  try { sessionStorage.removeItem(ADD_DRAFT_KEY); } catch {}
}

// Les saisies sont gardées dans sessionStorage tant que l'écran est ouvert
document.addEventListener('input', () => {
  if (currentView() !== 'add-session') return;
  try { sessionStorage.setItem(ADD_DRAFT_KEY, addState()); } catch {}
});

function restoreAddDraft() {
  try {
    const raw = sessionStorage.getItem(ADD_DRAFT_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || typeof d.addSets !== 'object') return false;
    ({ addCat, addDate, addSets, addExtras, addNotes, addProg } = d);
    editSessionId = d.editSessionId || null;
    addExtras = Array.isArray(addExtras) ? addExtras : [];
    return true;
  } catch { return false; }
}

// Données du programme de la séance passée (une séance d'un autre programme reste modifiable)
function addProgData() {
  return data.programmes[addProg] || { exercises: {}, timers: {}, cooldowns: {} };
}

// Valeurs vides : la dernière séance sert de placeholder (bouton « Reprendre la dernière séance »)
function initAddSets(cat) {
  addSets   = {};
  addPrev   = {};
  addExtras = [];
  (addProgData().exercises[cat] || []).forEach(ex => {
    const prevSets = lastPerf(addProg, cat, ex)?.ex.sets || [];
    addPrev[ex.id] = prevSets;
    addSets[ex.id] = Array.from({ length: ex.sets }, () => ({ weight: '', reps: '' }));
  });
}

function addHasReps() {
  return Object.values(addSets).some(sets => (sets || []).some(s => String(s.reps ?? '').trim() !== ''));
}

// Rangée d'une série : la dernière séance (prev) sert de placeholder
function addSetRow(key, si, s, prev) {
  return `
      <div class="set-row set-row--active">
        <span class="set-num">S${si + 1}</span>
        <div class="input-group">
          <input type="text" inputmode="decimal" autocomplete="off" class="set-input" placeholder="${prev?.weight ? fmtW(prev.weight, { plain: true }) : '—'}" aria-label="Charge série ${si + 1}"
                 value="${fmtW(s.weight, { plain: true })}" data-action="add-weight" data-exid="${esc(key)}" data-si="${si}">
          <span class="input-unit">${unitLbl()}</span>
        </div>
        <div class="input-group">
          <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" class="set-input set-input--required" placeholder="${prev ? esc(prev.reps) : '0'}" aria-label="Répétitions série ${si + 1}"
                 value="${esc(s.reps)}" data-action="add-reps" data-exid="${esc(key)}" data-si="${si}">
          <span class="input-unit">reps</span>
        </div>
      </div>`;
}

// Bloc d'un exercice : séries, boutons + / − et, pour un exercice ajouté, « Retirer »
function addExerciseBlock(key, name, prev, removable) {
  const sets = addSets[key] || [];
  return `
      <div class="exercise-block">
        <div class="exercise-header">
          <span class="exercise-name">${esc(name)}</span>
          <div style="display:flex;gap:6px">
            <button class="sets-adj" data-action="add-set-row" data-exid="${esc(key)}">+</button>
            <button class="sets-adj" data-action="rem-set-row" data-exid="${esc(key)}"
                    ${sets.length <= 1 ? 'disabled' : ''} style="opacity:${sets.length <= 1 ? .3 : 1}">−</button>
            ${removable ? `<button class="sets-adj" data-action="rem-extra-ex" data-exid="${esc(key)}" title="Retirer" aria-label="Retirer l'exercice">${icon('xmark', 16)}</button>` : ''}
          </div>
        </div>
        ${sets.map((s, si) => addSetRow(key, si, s, prev[si])).join('')}
      </div>`;
}

function renderAddSession() {
  const exercises = addProgData().exercises[addCat] || [];
  const hasPrev   = !editSessionId && exercises.some(ex => addPrev[ex.id]?.length);

  const catBtns = sessionKeys(addProg).map(c => {
    const meta     = sessionMeta(c, addProg);
    const isActive = addCat === c;
    return `
      <button class="cat-sel-btn ${isActive ? 'cat-sel-btn--active' : ''}"
              data-action="add-cat" data-cat="${esc(c)}"
              style="${isActive ? `border-color:${meta.color};color:${meta.color};background:color-mix(in srgb, ${meta.color} 10%, transparent)` : ''}">
        ${meta.icon} ${meta.label}
      </button>`;
  }).join('');

  return `
    <div class="view add-session">
      ${navBar({ title: editSessionId ? 'Modifier la séance' : 'Séance passée', large: false,
        left: `<button class="navbar__text" data-action="cancel-add-session">Annuler</button>`,
        right: `<button class="navbar__text navbar__text--bold" data-action="save-past-session" ${addHasReps() ? '' : 'disabled'}>${editSessionId ? 'OK' : 'Ajouter'}</button>` })}
      <div class="add-session-meta">
        <div class="cat-selector">${catBtns}</div>
        <div class="date-row">
          <label class="date-label">Date de la séance</label>
          <input type="date" id="addDate" class="date-input"
                 value="${addDate}" max="${localISO()}" data-action="add-date">
        </div>
      </div>
      <div class="add-session-content">
        ${hasPrev ? `<button class="btn btn--secondary btn--full add-copy-prev" data-action="add-copy-prev">Reprendre la dernière séance</button>` : ''}
        ${exercises.map(ex => addExerciseBlock(ex.id, ex.name, addPrev[ex.id] || [], false)).join('')}
        ${addExtras.map(({ key, name }) => addExerciseBlock(key, name, [], true)).join('')}
        <button class="session-add-ex-btn" data-action="add-past-ex">
          + Ajouter un exercice
        </button>
        <div class="session-notes-block">
          <div class="session-notes-label">Notes</div>
          <textarea class="session-notes-input" data-action="add-notes-input"
                    placeholder="Comment s'est passée la séance ? (optionnel)">${esc(addNotes)}</textarea>
        </div>
      </div>
    </div>`;
}

// Date valide et passée, reps entre 1 et 100, charge vide ou entre 0 et 1000 ; sinon le champ fautif est signalé
function addSessionInputsValid(dateEl) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(addDate || '') || addDate > localISO()) {
    flagInvalid(dateEl, 'Choisis une date');
    return false;
  }
  const bad = [...document.querySelectorAll('[data-action="add-reps"], [data-action="add-weight"]')].find(inp => {
    const v = inp.value.trim();
    if (inp.dataset.action === 'add-weight') return !weightOk(v);
    return v !== '' && num(v, 1, 100, true) === null;
  });
  if (bad) { flagInvalid(bad, bad.dataset.action === 'add-reps' ? 'Reps entre 1 et 100' : weightMsg()); return false; }
  return true;
}

// Exercices saisis (séries avec des reps) : ceux du programme dans leur ordre, puis les ajouts
function pastSessionExercises() {
  const clean = sets => (sets || []).filter(s => String(s.reps ?? '').trim() !== '')
    .map(s => ({ weight: s.weight, reps: String(parseInt(s.reps)) }));
  const exercises = (addProgData().exercises[addCat] || [])
    .map(ex => {
      const sets = clean(addSets[ex.id]);
      return sets.length ? { exId: ex.id, name: ex.name, sets } : null;
    })
    .filter(Boolean);
  addExtras.forEach(({ key, name, exId }) => {
    const sets = clean(addSets[key]);
    if (sets.length) exercises.push({ exId: exId || resolveExId(addProg, addCat, name), name, sets });
  });
  return exercises;
}

// Ajoute la séance passée à l'historique, ou remplace la séance modifiée
function storePastSession(exercises) {
  const pData = addProgData();
  const [y, m, d] = addDate.split('-').map(Number);
  const timestamp = new Date(y, m - 1, d, 12, 0, 0).getTime();
  let savedDate = timestamp;

  if (!data.history) data.history = [];
  if (editSessionId) {
    const idx = data.history.findIndex(h => h.id === editSessionId);
    if (idx !== -1) {
      const old = data.history[idx];
      // Même jour : on garde l'heure d'origine
      savedDate = localISO(old.date) === addDate ? old.date : timestamp;
      data.history[idx] = { ...old, programme: addProg, category: addCat, date: savedDate, notes: addNotes.trim(), exercises };
    }
  } else {
    data.history.push({ id: uid(), programme: addProg, category: addCat, date: timestamp, notes: addNotes.trim(), exercises });
    addNotes = '';
  }
  data.history.sort((a, b) => b.date - a.date);
  editSessionId = null;

  // Le délai de récupération ne bouge que si cette séance est plus récente
  if (!data.programmes[addProg]) data.programmes[addProg] = pData;
  const timers = data.programmes[addProg].timers;
  if (savedDate > (timers[addCat] || 0)) timers[addCat] = savedDate;
}

// Exercice choisi dans la feuille d'ajout : il rejoint les ajouts de la séance passée
function addPastExercise(name, sets) {
  const key = 'x_' + uid();
  addExtras.push({ key, name, exId: null });
  addSets[key] = Array.from({ length: sets }, () => ({ weight: '', reps: '' }));
  closeSessSheets();
  haptic();
  render();
  setTimeout(() => {
    const blocks = document.querySelectorAll('.exercise-block');
    blocks[blocks.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'go-add-session': () => {
    addProg       = data.activeProgramme;
    addCat        = firstSession();
    addDate       = localISO();
    editSessionId = null;
    addNotes      = '';
    initAddSets(addCat);
    navigate('add-session');
  },
  'edit-session': (e, el) => {
    const session = (data.history || []).find(h => h.id === el.dataset.id);
    if (!session) return;
    editSessionId = session.id;
    addProg = session.programme || 'ppl';
    addCat  = session.category;
    addDate = localISO(session.date);
    initAddSets(addCat);
    session.exercises.forEach(ex => {
      const exData = (addProgData().exercises[addCat] || []).find(e => sameEx(e, ex));
      const sets   = ex.sets.map(s => ({ weight: s.weight, reps: s.reps }));
      if (exData) { addSets[exData.id] = sets; return; }
      const key = 'x_' + uid();
      addExtras.push({ key, name: ex.name, exId: ex.exId || null });
      addSets[key] = sets.length ? sets : [{ weight: '', reps: '' }];
    });
    addNotes = session.notes || '';
    navigate('add-session');
  },
  'cancel-add-session': async () => {
    if (addDirty()) {
      const choice = await dialog({ type: 'sheet', actions: [
        { label: 'Ignorer les modifications', value: 'discard', style: 'destructive' },
        { label: 'Continuer la modification', style: 'cancel' },
      ] });
      if (choice !== 'discard') return;
    }
    addSnapshot = null;
    goBack();
  },
  'add-cat': (e, el) => {
    addCat = el.dataset.cat;
    const extras = addExtras.map(x => ({ ...x, sets: addSets[x.key] }));
    initAddSets(addCat);
    extras.forEach(({ key, name, exId, sets }) => { addExtras.push({ key, name, exId }); addSets[key] = sets; });
    render();
  },
  'add-copy-prev': () => {
    Object.entries(addPrev).forEach(([id, prev]) => {
      if (!prev.length) return;
      addSets[id] = prev.map(s => ({ weight: s.weight, reps: s.reps }));
    });
    render();
  },
  'add-date': (e, el) => { addDate = el.value; },
  'add-set-row': (e, el) => {
    const exid = el.dataset.exid;
    if (!addSets[exid]) addSets[exid] = [];
    addSets[exid].push({ weight: '', reps: '' });
    render();
  },
  'rem-extra-ex': (e, el) => {
    const exid = el.dataset.exid;
    addExtras = addExtras.filter(x => x.key !== exid);
    delete addSets[exid];
    render();
  },
  'rem-set-row': (e, el) => {
    const exid = el.dataset.exid;
    if (addSets[exid]?.length > 1) addSets[exid].pop();
    render();
  },
  'save-past-session': () => {
    const dateEl = $('#addDate');
    if (dateEl) addDate = dateEl.value;
    const notesEl = $('.session-notes-input');
    if (notesEl) addNotes = notesEl.value;
    if (!addSessionInputsValid(dateEl)) return;

    const exercises = pastSessionExercises();
    if (!exercises.length) { showToast('Entre au moins un exercice avec poids et reps !'); return; }

    const wasEdit = !!editSessionId;
    storePastSession(exercises);
    recomputePRFromHistory();
    save();
    showToast(wasEdit ? 'Séance modifiée' : 'Séance ajoutée');
    routeTo('history');
  },
  // Même feuille de recherche que la séance en cours ; les exercices déjà saisis n'y figurent pas
  'add-past-ex': () => {
    const names = [...(addProgData().exercises[addCat] || []).map(ex => ex.name), ...addExtras.map(x => x.name)];
    openAddExSheet({ target: 'past', exclude: names, onPick: addPastExercise });
  },
});
