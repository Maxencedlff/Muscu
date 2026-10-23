// ═══════════════════════════════════════════════════════════
//  Onglet Programme : séances du programme actif, sélecteur, programmes perso
// ═══════════════════════════════════════════════════════════
'use strict';

let progEditing = false;   // mode Modifier de la liste des séances (ordre)

function exSetsCount(cat, progId) {
  const list = data.programmes[progId]?.exercises?.[cat] || [];
  return { n: list.length, sets: list.reduce((a, e) => a + (parseInt(e.sets) || 0), 0) };
}

function renderProgrammes() {
  const pid  = data.activeProgramme;
  const pm   = progMeta(pid);
  const cell = (cat, progId, action) => {
    const c = exSetsCount(cat, progId);
    return `
      <button class="cell cell--nav" data-action="${action}" data-cat="${esc(cat)}" data-id="${esc(cat)}">
        ${catDot(cat, progId)}
        <span class="cell__body">
          <span class="cell__title">${sessionMeta(cat, progId).label}</span>
          <span class="cell__sub">${plural(c.n, 'exercice', 'exercices')} · ${plural(c.sets, 'série', 'séries')}</span>
        </span>
        ${icon('chevron.right', 16)}
      </button>`;
  };
  // Ligne du mode Modifier : la séance ne s'ouvre pas, la poignée ≡ la déplace (js/ui/reorder.js)
  const editCell = (cat, progId) => {
    const label = sessionMeta(cat, progId).label;
    return `
      <div class="cell ed-row--edit ps-row">
        ${catDot(cat, progId)}
        <span class="cell__body"><span class="cell__title">${label}</span></span>
        <span class="ed-handle ps-handle" role="button" aria-label="Déplacer ${label}">${icon('line.3.horizontal', 22)}</span>
      </div>`;
  };
  const user = isUserProg(pid);
  const keys = sessionKeys(pid);
  const canReorder = user && keys.length > 1;
  const editing = canReorder && progEditing;
  const sessions = `
      <div class="group-title group-title--row">
        <span>Séances</span>
        ${canReorder ? `<button class="group-title__btn ${editing ? 'group-title__btn--bold' : ''}" data-action="toggle-prog-order">${editing ? 'OK' : 'Modifier l\'ordre'}</button>` : ''}
      </div>
      <div class="group ps-list">
        ${keys.map(c => editing ? editCell(c, pid) : cell(c, pid, 'open-prog-session')).join('')}
        ${user && !editing ? `<button class="cell cell--action" data-action="add-custom-session">${icon('plus', 20)}<span>Ajouter une séance</span></button>` : ''}
      </div>
      ${editing ? `<div class="group-foot">Fais glisser ≡ pour ranger tes séances, par exemple dans l'ordre de ta semaine.</div>` : ''}
      ${user ? '' : `<div class="group-foot">Les séances d'un programme intégré sont fixes, mais tu peux modifier leurs exercices. Pour composer tes propres séances, crée un programme.</div>`}`;
  const manage = pid.startsWith('u_') ? `
      <div class="group group--gap">
        <button class="cell cell--nav" data-action="rename-programme">
          <span class="cell__body"><span class="cell__title">Renommer le programme</span></span>
          ${icon('chevron.right', 16)}
        </button>
        <button class="cell cell--destructive" data-action="delete-programme">Supprimer le programme</button>
      </div>` : '';

  return `
    <div class="view programmes view--grouped">
      ${navBar({ title: 'Programme', right: `<button class="navbar__text" data-action="go-settings">Réglages</button>` })}
      <div class="scr">
        <div class="group">
          <button class="cell cell--nav" data-action="go-prog-picker">
            <span class="cell__body"><span class="cell__title">Programme actif</span></span>
            <span class="cell__value">${esc(pm.name)}</span>
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell cell--action" data-action="new-programme">${icon('plus', 20)}<span>Créer un programme</span></button>
        </div>
        ${sessions}
        <div class="group group--gap">
          <button class="cell cell--nav" data-action="go-library">
            <span class="cell__body"><span class="cell__title">Bibliothèque d'exercices</span>
              <span class="cell__sub">${EXERCISE_CATALOGUE.length} exercices, leurs muscles et leur matériel</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
        ${manage}
      </div>
    </div>`;
}

// Sélecteur de programme façon iOS : liste groupée, coche sur le programme actif
function renderProgPicker() {
  const row = id => {
    const pm    = progMeta(id);
    const keys  = sessionKeys(id);
    const color = keys.length ? sessionMeta(keys[0], id).color : 'var(--label3)';
    const names = isUserProg(id)
      ? (keys.map(k => esc(rawLabel(k, id))).join(' · ') || 'Aucune séance')
      : Object.values(pm.sessions).map(s => s.label).join(' · ');
    const on = data.activeProgramme === id;
    return `
      <button class="cell cell--pick" data-action="select-prog" data-id="${esc(id)}" aria-pressed="${on}">
        <span class="psq" style="--c:${color}">${esc(pm.name.charAt(0).toUpperCase())}</span>
        <span class="cell__body">
          <span class="cell__title">${esc(pm.name)}</span>
          <span class="cell__sub cell__sub--1">${names}</span>
        </span>
        <span class="cell__check">${on ? icon('checkmark', 20) : ''}</span>
      </button>`;
  };
  // « Perso » (ancien programme unique) n'apparaît que s'il est utilisé
  const builtinIds = Object.keys(PROGRAMMES).filter(id => id !== 'custom' || sessionKeys('custom').length || data.activeProgramme === 'custom');
  const mine = Object.entries(data.userProgrammes || {}).filter(([, p]) => !p.archived).map(([id]) => id);
  return `
    <div class="view prog-picker view--grouped">
      ${navBar({ title: 'Programme actif' })}
      <div class="scr">
        <div class="group-title">Mes programmes</div>
        <div class="group">
          ${mine.map(row).join('')}
          <button class="cell cell--action" data-action="new-programme">${icon('plus', 20)}<span>Créer un programme</span></button>
        </div>
        <div class="group-title">Programmes intégrés</div>
        <div class="group">${builtinIds.map(row).join('')}</div>
        <div class="group-foot">Ton historique reste disponible quand tu changes de programme.</div>
      </div>
    </div>`;
}

// Active un programme (intégré ou créé) et prépare ses données à la première utilisation
function activateProgramme(id) {
  data.activeProgramme = id;
  const pd = data.programmes[id] ||= makeProgData(id);
  pd.exercises ||= {}; pd.timers ||= {}; pd.cooldowns ||= {};
  if (isUserProg(id)) {
    Object.keys(userSessions(id) || {}).forEach(cat => {
      if (!(cat in pd.timers)) pd.timers[cat] = null;
      if (!pd.exercises[cat])  pd.exercises[cat] = [];
    });
  }
  addCat     = firstSession();
  histFilter = 'all';
  progEditing = false;
  syncTimersFromHistory();
}

// Programme activé depuis l'onglet : enregistré, retour à la liste des séances
function openProgramme(id) {
  activateProgramme(id);
  save();
  routeTo('programmes');
}

// Ordre des séances d'un programme perso
makeReorderable({
  view: 'programmes', list: '.ps-list', row: '.ps-row', handle: '.ps-handle',
  onMove: (from, to) => { if (moveSession(data.activeProgramme, from, to)) save(); },
});

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'toggle-prog-order': () => {
    progEditing = !progEditing; render();
  },
  'go-program': () => {
    switchTab('program');
  },
  'go-programmes': () => {
    navigate('programmes');
  },
  'go-prog-picker': () => {
    navigate('prog-picker');
  },
  'open-prog-session': (e, el) => {
    editorEditing = false;
    navigate(makeRoute('editor', el.dataset.cat));
  },
  'select-prog': async (e, el) => {
    const id = el.dataset.id;
    if (id === data.activeProgramme) { routeTo('programmes'); return; }
    if (!(await confirmSheet(`Passer à ${progMeta(id).name} ?`, 'Ton historique reste disponible.', 'Changer de programme', false))) return;
    openProgramme(id);
    showToast(`Programme : ${progMeta().name}`);
  },
  'new-programme': async () => {
    const name = await askText({ title: 'Nouveau programme', message: 'Donne-lui un nom.', placeholder: 'Ex : Force 5×5', confirm: 'Suivant' });
    if (!name) return;
    const start = await dialog({ type: 'sheet', title: `Partir de quoi pour « ${name} » ?`,
      message: 'Tu pourras ensuite ajouter, renommer ou supprimer des séances et des exercices.',
      actions: [
        { label: 'Programme vide', value: 'empty', style: 'preferred' },
        ...Object.entries(PROGRAMMES).filter(([k]) => k !== 'custom').map(([k, pm]) => ({ label: `Copie de ${pm.name}`, value: k })),
        { label: 'Annuler', style: 'cancel' },
      ] });
    if (!start) return;
    const id = 'u_' + uid();
    const sessions = {};
    let pdata = { exercises: {}, timers: {}, cooldowns: {} };
    if (start !== 'empty') {
      Object.entries(PROGRAMMES[start].sessions).forEach(([cat, m]) => {
        sessions[cat] = { label: m.label, icon: '', desc: m.desc, color: m.color };
      });
      pdata = makeProgData(start);
    }
    data.userProgrammes[id] = { name, sessions, archived: false };
    data.programmes[id] = pdata;
    openProgramme(id);
    showToast(`Programme « ${name} » créé`);
    // Programme vide : on enchaîne sur sa première séance
    if (start === 'empty') openNewSession();
  },
  'rename-programme': async () => {
    const id = data.activeProgramme, up = data.userProgrammes[id];
    if (!up) return;
    const name = await askText({ title: 'Renommer le programme', value: up.name });
    if (!name) return;
    up.name = name; save(); render();
  },
  'delete-programme': async () => {
    const id = data.activeProgramme, up = data.userProgrammes[id];
    if (!up) return;
    if (activeSession?.programme === id) {
      await dialog({ title: 'Séance en cours', message: 'Termine ou abandonne la séance de ce programme avant de le supprimer.', actions: [{ label: 'OK', style: 'preferred' }] });
      return;
    }
    const n = (data.history || []).filter(h => h.programme === id).length;
    if (!(await confirmSheet(`Supprimer « ${up.name} » ?`,
      `${n ? `Ses ${n} séance${n > 1 ? 's' : ''} déjà faite${n > 1 ? 's' : ''} restent dans l'historique et les progrès. ` : ''}Tu pourras le restaurer dans Réglages › Supprimés récemment.`,
      'Supprimer le programme'))) return;
    // Archivé et non effacé : l'historique garde les noms et couleurs des séances
    up.archived = true;
    openProgramme('ppl');
    showToast('Programme supprimé');
  },
});
