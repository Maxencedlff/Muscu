// ═══════════════════════════════════════════════════════════
//  Programme › Séance et Programme › Exercice
// ═══════════════════════════════════════════════════════════
'use strict';

let editorEditing = false;   // mode Modifier de la liste d'exercices
let exDraft       = null;    // brouillon de l'écran Programme › Exercice (exDraft.route : son écran)

// Séance éditée par Programme › Séance (« editor:CAT ») ou Programme › Exercice (« ex-edit:CAT:I ») :
// celle de la route, ou la première séance du programme actif si elle n'en fait plus partie
function editorCatOf(route = currentRoute()) {
  const cat = routeParams(route)[0];
  return cat && sessionKeys().includes(cat) ? cat : firstSession();
}
// Rang de l'exercice modifié par Programme › Exercice, null pour un nouvel exercice
function editExIdxOf(route = currentRoute()) {
  const i = parseInt(routeParams(route)[1]);
  return Number.isInteger(i) && i >= 0 ? i : null;
}

// Brouillon de l'écran Programme › Exercice affiché : repris de l'exercice s'il vise un autre écran
function exDraftFor(route) {
  if (exDraft?.route === route) return exDraft;
  const i  = editExIdxOf(route);
  const ex = i === null ? null : (prog().exercises[editorCatOf(route)] || [])[i];
  exDraft = ex
    ? { route, name: ex.name, sets: ex.sets, rest: ex.rest ?? null, target: ex.target ?? null, repMax: ex.repMax ?? 12, muscles: draftMuscles(ex) }
    : { route, name: '', sets: 3, rest: null, target: null, repMax: 12, muscles: null };
  return exDraft;
}

// Programme › Séance : exercices, récupération, repos, mode Modifier (glisser pour réordonner)
function renderEditor() {
  const cat  = editorCatOf();
  const list = prog().exercises[cat] || [];
  const meta = sessionMeta(cat);
  if (!cat || !sessionKeys().includes(cat)) {
    return `
      <div class="view editor view--grouped">
        ${navBar({ title: 'Séance' })}
        <div class="scr"><div class="empty-note">Programme vide. Crée des séances dans Programme.</div></div>
      </div>`;
  }
  const rows = list.map((ex, i) => {
    const last = lastPerf(data.activeProgramme, cat, ex);
    const best = last ? bestSet(last.ex.sets) : null;
    const sub  = `${plural(ex.sets, 'série', 'séries')}${best ? ` · dernier ${setTxt(best)}` : ''}`;
    if (editorEditing) {
      return `
        <div class="cell ed-row ed-row--edit" data-i="${i}">
          <button class="ed-minus" data-action="ed-reveal" data-i="${i}" aria-label="Supprimer ${esc(ex.name)}">${icon('minus', 14)}</button>
          <span class="cell__body">
            <span class="cell__title ed-name">${esc(ex.name)}</span>
            ${exMusclesSubHtml(ex)}
            <span class="cell__sub">${sub}</span>
          </span>
          <button class="ed-del" data-action="del-ex" data-i="${i}">Supprimer</button>
          <span class="ed-handle" data-i="${i}" role="button" aria-label="Déplacer ${esc(ex.name)}">${icon('line.3.horizontal', 22)}</span>
        </div>`;
    }
    return `
      <button class="cell cell--nav ed-row" data-action="edit-ex" data-i="${i}">
        <span class="cell__body">
          <span class="cell__title ed-name">${esc(ex.name)}</span>
          ${exMusclesSubHtml(ex)}
          <span class="cell__sub">${sub}</span>
        </span>
        ${icon('chevron.right', 16)}
      </button>`;
  }).join('');
  const cd = getCooldown(cat);
  return `
    <div class="view editor view--grouped">
      ${navBar({ title: meta.label, right: list.length ? `<button class="navbar__text ${editorEditing ? 'navbar__text--bold' : ''}" data-action="toggle-edit-mode">${editorEditing ? 'OK' : 'Modifier'}</button>` : '' })}
      <div class="scr">
        <div class="group-title">Exercices</div>
        <div class="group ed-list">
          ${rows || '<div class="cell"><span class="cell__sub">Aucun exercice pour l\'instant</span></div>'}
          ${editorEditing ? '' : `<button class="cell cell--action" data-action="add-ex">${icon('plus', 20)}<span>Ajouter un exercice</span></button>`}
        </div>
        <div class="group-title">Réglages de la séance</div>
        <div class="group">
          <div class="cell cell--ctl cell--flow">
            <span class="cell__body"><span class="cell__title">Récupération</span></span>
            <div class="segmented seg-sm" role="group" aria-label="Récupération">
              ${[24, 48, 72, 96].map(h => `<button class="segmented__btn ${cd === h ? 'segmented__btn--active' : ''}" aria-pressed="${cd === h}" data-action="set-cooldown" data-h="${h}">${h} h</button>`).join('')}
            </div>
          </div>
          <button class="cell cell--nav" data-action="setting-rest">
            <span class="cell__body"><span class="cell__title">Repos par défaut</span></span>
            <span class="cell__value num">${fmtRest(data.defaultRest)}</span>
            ${icon('chevron.right', 16)}
          </button>
          ${isUserProg(data.activeProgramme) ? `
          <button class="cell cell--nav" data-action="edit-custom-session" data-id="${esc(cat)}">
            <span class="cell__body"><span class="cell__title">Nom, icône et couleur</span></span>
            ${icon('chevron.right', 16)}
          </button>` : ''}
        </div>
        <div class="group-foot">La récupération règle le délai avant que la séance soit de nouveau prête.</div>
        ${isUserProg(data.activeProgramme) ? `
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="delete-custom-session" data-id="${esc(cat)}">Supprimer la séance</button>
        </div>` : ''}
      </div>
    </div>`;
}

// Programme › Exercice : nom, séries, repos, objectif, haut de fourchette
function renderExEdit() {
  const editExIdx = editExIdxOf();
  const isEdit = editExIdx !== null;
  const d = exDraftFor(currentRoute());
  const restVal = d.rest ?? data.defaultRest;
  return `
    <div class="view ex-edit view--grouped">
      ${navBar({ title: isEdit ? 'Exercice' : 'Nouvel exercice',
          left: `<button class="navbar__text" data-action="back">Annuler</button>`,
          right: `<button class="navbar__text navbar__text--bold" data-action="save-ex">OK</button>` })}
      <div class="scr">
        <div class="group-title">Nom</div>
        <div class="group">
          <div class="cell cell--field">
            <input type="text" id="exName" class="field" value="${esc(d.name)}" placeholder="Ex : Curl biceps haltères"
                   autocomplete="off" enterkeyhint="done" aria-label="Nom de l'exercice">
          </div>
        </div>
        ${renderExEditMuscles(d)}
        <div class="group-title">Séance</div>
        <div class="group">
          <div class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Séries</span></span>
            <span class="cell__value num" id="exSetsVal">${d.sets}</span>
            <div class="stepper" role="group" aria-label="Séries">
              <button data-action="ex-sets" data-d="-1" aria-label="Une série de moins">${icon('minus', 18)}</button>
              <button data-action="ex-sets" data-d="1" aria-label="Une série de plus">${icon('plus', 18)}</button>
            </div>
          </div>
          <div class="cell cell--ctl cell--wrap">
            <span class="cell__body">
              <span class="cell__title">Repos</span>
              <span class="cell__sub" id="exRestSub">${d.rest == null ? `Par défaut (${fmtRest(data.defaultRest)})` : 'Propre à cet exercice'}</span>
            </span>
            <span class="cell__value num" id="exRestVal">${fmtRest(restVal)}</span>
            <div class="stepper" role="group" aria-label="Ajuster le repos">
              <button data-action="ex-rest-step" data-d="-15" aria-label="Moins 15 secondes">${icon('minus', 18)}</button>
              <button data-action="ex-rest-step" data-d="15" aria-label="Plus 15 secondes">${icon('plus', 18)}</button>
            </div>
            <div class="segmented seg-full" role="group" aria-label="Préréglages de repos">
              ${[60, 90, 120, 180].map(s => `<button class="segmented__btn ${restVal === s ? 'segmented__btn--active' : ''}" aria-pressed="${restVal === s}" data-action="ex-rest" data-s="${s}">${fmtRest(s)}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="group-title">Progression</div>
        <div class="group">
          <label class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Objectif</span></span>
            <span class="field-suffix">
              <input type="text" inputmode="decimal" id="exTarget" class="field field--num" autocomplete="off"
                     value="${d.target ? fmtW(d.target) : ''}" placeholder="—" aria-label="Objectif en ${unitLbl()}">
              <span>${unitLbl()}</span>
            </span>
          </label>
          <label class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Haut de fourchette de reps</span></span>
            <span class="field-suffix">
              <input type="text" inputmode="numeric" id="exRepMax" class="field field--num" autocomplete="off"
                     value="${esc(d.repMax ?? 12)}" aria-label="Haut de fourchette de reps">
              <span>reps</span>
            </span>
          </label>
        </div>
        <div class="group-foot">Quand toutes tes séries atteignent ce nombre de reps, l'app te propose d'augmenter la charge.</div>
        ${isEdit ? `
        <div class="group">
          <button class="cell cell--destructive" data-action="del-ex" data-i="${editExIdx}">Supprimer l'exercice</button>
        </div>
        <div class="group-foot">L'historique de cet exercice est conservé.</div>` : ''}
      </div>
    </div>`;
}

// Glisser pour réordonner (poignée ≡ du mode Modifier)
let edDrag = null;
document.addEventListener('pointerdown', e => {
  const h = e.target.closest?.('.ed-handle');
  if (!h || currentView() !== 'editor') return;
  e.preventDefault();
  const row = h.closest('.ed-row');
  const rows = [...document.querySelectorAll('.ed-list .ed-row')];
  edDrag = { row, rows, from: rows.indexOf(row), idx: rows.indexOf(row), y0: e.clientY, h: row.offsetHeight, id: e.pointerId };
  row.classList.add('is-dragging');
  try { h.setPointerCapture(e.pointerId); } catch {}
});
document.addEventListener('pointermove', e => {
  if (!edDrag || e.pointerId !== edDrag.id) return;
  e.preventDefault();
  const dy = e.clientY - edDrag.y0;
  const n  = edDrag.rows.length;
  const idx = Math.max(0, Math.min(n - 1, edDrag.from + Math.round(dy / edDrag.h)));
  if (idx !== edDrag.idx) { edDrag.idx = idx; haptic(); }
  edDrag.row.style.transform = `translateY(${dy}px)`;
  edDrag.rows.forEach((r, i) => {
    if (r === edDrag.row) return;
    let shift = 0;
    if (edDrag.from < idx && i > edDrag.from && i <= idx) shift = -edDrag.h;
    if (edDrag.from > idx && i < edDrag.from && i >= idx) shift = edDrag.h;
    r.style.transform = shift ? `translateY(${shift}px)` : '';
  });
});
function endEdDrag(e) {
  if (!edDrag || e.pointerId !== edDrag.id) return;
  const { from, idx } = edDrag;
  edDrag = null;
  const arr = prog().exercises[editorCatOf()];
  if (arr && from !== idx) {
    const [moved] = arr.splice(from, 1);
    arr.splice(idx, 0, moved);
    save();
  }
  render();
}
document.addEventListener('pointerup', endEdDrag);
document.addEventListener('pointercancel', endEdDrag);
// iOS : sans ce preventDefault, le glisser de la poignée ferait défiler la liste
document.addEventListener('touchmove', e => { if (edDrag) e.preventDefault(); }, { passive: false });

// Nom saisi dans Programme › Exercice : gardé dans le brouillon, puis les muscles reconnus
// suivent la frappe (muscles.js), dans cet ordre explicite
document.addEventListener('input', e => {
  if (e.target.id !== 'exName' || !exDraft) return;
  exDraft.name = e.target.value;
  refreshExEditMuscles();
});

// ── Actions ─────────────────────────────────────────────────
// Repos de l'exercice : préréglage (ex-rest) ou pas de ±15 s (ex-rest-step)
function setDraftRest(e, el, action) {
  if (!exDraft) return;
  const v = action === 'ex-rest' ? parseInt(el.dataset.s)
    : Math.max(10, Math.min(600, (exDraft.rest ?? data.defaultRest) + parseInt(el.dataset.d)));
  exDraft.rest = v;
  $('#exRestVal').textContent = fmtRest(v);
  $('#exRestSub').textContent = 'Propre à cet exercice';
  document.querySelectorAll('[data-action="ex-rest"]').forEach(b => {
    const on = parseInt(b.dataset.s) === v;
    b.classList.toggle('segmented__btn--active', on); b.setAttribute('aria-pressed', on);
  });
}

registerActions({
  'go-editor': (e, el) => {
    const c = el.dataset.cat;
    navigate(makeRoute('editor', c && sessionKeys().includes(c) ? c : firstSession()));
  },
  'toggle-edit-mode': () => {
    editorEditing = !editorEditing; render();
  },
  'ed-reveal': (e, el) => {
    const row = el.closest('.ed-row');
    const open = !row.classList.contains('is-del');
    document.querySelectorAll('.ed-row.is-del').forEach(r => r.classList.remove('is-del'));
    row.classList.toggle('is-del', open);
  },
  'set-cooldown': (e, el) => {
    prog().cooldowns[editorCatOf()] = parseInt(el.dataset.h);
    save();
    document.querySelectorAll('[data-action="set-cooldown"]').forEach(b => {
      const on = b === el;
      b.classList.toggle('segmented__btn--active', on); b.setAttribute('aria-pressed', on);
    });
  },
  'edit-ex': (e, el) => {
    const cat = editorCatOf(), i = parseInt(el.dataset.i);
    if (!(prog().exercises[cat] || [])[i]) return;
    exDraft = null;
    navigate(makeRoute('ex-edit', cat, i));
  },
  'add-ex': () => {
    // Même feuille de recherche que pendant la séance (bibliothèque + création)
    openAddExSheet({ target: 'programme' });
  },
  'ex-sets': (e, el) => {
    if (!exDraft) return;
    exDraft.sets = Math.max(1, Math.min(10, exDraft.sets + parseInt(el.dataset.d)));
    $('#exSetsVal').textContent = exDraft.sets;
    haptic();
  },
  'ex-rest':      setDraftRest,
  'ex-rest-step': setDraftRest,
  'del-ex': async (e, el) => {
    const i    = parseInt(el.dataset.i);
    const list = prog().exercises[editorCatOf()];
    const name = list[i].name;
    if (!(await confirmSheet(`Supprimer « ${name} » ?`, 'L\'historique de cet exercice est conservé.', 'Supprimer l\'exercice'))) return;
    list.splice(i, 1);
    save();
    if (currentView() === 'ex-edit') { exDraft = null; goBack(); } else render();
  },
  'save-ex': async () => {
    const route = currentRoute(), editorCat = editorCatOf(route), editExIdx = editExIdxOf(route);
    exDraftFor(route);
    const nameIn = $('#exName'), targetIn = $('#exTarget'), repIn = $('#exRepMax');
    const name = nameIn?.value.trim();
    if (!name) { flagInvalid(nameIn, 'Entre un nom'); return; }
    const sets = exDraft?.sets ?? 3;
    const rest = exDraft?.rest ?? null;
    const targetRaw = targetIn?.value.trim() || '';
    if (targetRaw && (!weightOk(targetRaw) || !(parseFloat(storeW(targetRaw)) > 0))) { flagInvalid(targetIn, weightMsg()); return; }
    const target = targetRaw ? parseFloat(storeW(targetRaw)) : null;
    const repRaw = repIn?.value.trim() || '';
    const repMax = repRaw ? num(repRaw, 1, 100, true) : 12;
    if (repMax === null) { flagInvalid(repIn, 'Reps entre 1 et 100'); return; }
    const list = prog().exercises[editorCat] || (prog().exercises[editorCat] = []);
    if (editExIdx !== null && list[editExIdx]) {
      const ex = list[editExIdx];
      if (ex.name !== name) {
        // L'exId garde le lien avec l'historique ; on propose aussi d'y reprendre le nouveau nom
        const progKey = data.activeProgramme;
        const touched = (data.history || []).filter(h => (h.programme || 'ppl') === progKey && h.category === editorCat
          && (h.exercises || []).some(e => sameEx(e, ex)));
        if (touched.length) {
          const n = touched.length;
          const all = await confirmSheet('Renommer aussi dans l\'historique ?',
            `${n} séance${n > 1 ? 's contiennent' : ' contient'} cet exercice.`, 'Renommer partout', false);
          if (all) touched.forEach(h => h.exercises.forEach(e => { if (sameEx(e, ex)) e.name = name; }));
        }
        if (activeSession) activeSession.exercises.forEach(e => { if (e.exId === ex.id) e.name = name; });
        ex.name = name;
      }
      ex.sets   = sets;
      ex.target = target;
      ex.rest   = rest;
      ex.repMax = repMax;
      applyDraftMuscles(ex, exDraft);
    } else {
      const ex = makeExercise(name, sets);
      // Un exercice déjà présent dans l'historique (supprimé puis recréé) retrouve son identifiant
      const known = resolveExId(data.activeProgramme, editorCat, name);
      if (!list.some(e => e.id === known)) ex.id = known;
      ex.target = target;
      ex.rest   = rest;
      ex.repMax = repMax;
      applyDraftMuscles(ex, exDraft);
      list.push(ex);
      recomputePRFromHistory();
    }
    exDraft = null; save();
    goBack();
  },
});
