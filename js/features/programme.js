// ═══════════════════════════════════════════════════════════
//  Onglet Programme : séances du programme actif, sélecteur, programmes perso
// ═══════════════════════════════════════════════════════════
'use strict';

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
  const user = isUserProg(pid);
  const sessions = `
      <div class="group-title">Séances</div>
      <div class="group">
        ${sessionKeys(pid).map(c => cell(c, pid, 'open-prog-session')).join('')}
        ${user ? `<button class="cell cell--action" data-action="add-custom-session">${icon('plus', 20)}<span>Ajouter une séance</span></button>` : ''}
      </div>
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
  editorCat = firstSession();
  addCat    = firstSession();
  histFilter = 'all';
  syncTimersFromHistory();
}

// Programme activé depuis l'onglet : enregistré, retour à la liste des séances
function openProgramme(id) {
  activateProgramme(id);
  save();
  view = 'programmes'; render();
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'go-program': () => {
    editorCat = sessionKeys().includes(editorCat) ? editorCat : firstSession();
    switchTab('program');
  },
  'go-programmes': () => {
    navigate('programmes');
  },
  'go-prog-picker': () => {
    view = 'prog-picker'; render();
  },
  'open-prog-session': (e, el) => {
    editorCat = el.dataset.cat; editorEditing = false; view = 'editor'; render();
  },
  'select-prog': async (e, el) => {
    const id = el.dataset.id;
    if (id === data.activeProgramme) { view = 'programmes'; render(); return; }
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
    if (start === 'empty') setTimeout(() => showToast('Ajoute ta première séance'), 2300);
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
      n ? `Ses ${n} séance${n > 1 ? 's' : ''} déjà faite${n > 1 ? 's' : ''} restent dans l'historique et les progrès.` : 'Ses séances et exercices seront supprimés.',
      'Supprimer le programme'))) return;
    // Archivé et non effacé : l'historique garde les noms et couleurs des séances
    up.archived = true;
    openProgramme('ppl');
    showToast('Programme supprimé');
  },
});
