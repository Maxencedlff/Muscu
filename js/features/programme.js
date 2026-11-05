// ═══════════════════════════════════════════════════════════
//  Onglet Programme : séances du programme actif, Mes programmes, catalogue, programmes perso
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
          <button class="cell cell--nav" data-action="go-my-programmes">
            <span class="cell__body"><span class="cell__title">Mes programmes</span></span>
            <span class="cell__value">${esc(pm.name)}</span>
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell cell--action" data-action="new-programme">${icon('plus', 20)}<span>Créer un programme</span></button>
        </div>
        ${coachEditorConsigneHtml(data.activeProgramme)}
        ${sessions}
        <div class="group group--gap">
          <button class="cell cell--nav" data-action="go-library">
            <span class="cell__body"><span class="cell__title">Bibliothèque d'exercices</span>
              <span class="cell__sub">${EXERCISE_CATALOGUE.length} exercices, leurs muscles et leur matériel</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
        ${dietProgrammeGroupHtml()}
        <div class="group-title">Partager</div>
        <div class="group">
          <button class="cell cell--action" data-action="share-programme">${icon('square.and.arrow.up', 20)}<span>Envoyer ce programme</span></button>
        </div>
        <div class="group-foot">Envoie tes séances et tes exercices par message. Tes charges, records et ton historique restent sur ton téléphone.</div>
        ${manage}
      </div>
    </div>`;
}

// Mes programmes : la liste choisie (data.myProgrammes), dans son ordre ; coche sur l'actif, un toucher
// l'active. « Modifier » : poignées ≡ pour ranger, ⊖ pour retirer un programme intégré (il reste dans
// « Tous les programmes ») ou supprimer un programme créé (confirmation, comme dans l'onglet).
let myProgEditing = false;
function renderMyProgrammes() {
  const ids = data.myProgrammes || [];
  const info = id => {
    const pm = progMeta(id), keys = sessionKeys(id);
    const color = keys.length ? sessionMeta(keys[0], id).color : 'var(--label3)';
    const names = isUserProg(id)
      ? (keys.map(k => esc(rawLabel(k, id))).join(' · ') || 'Aucune séance')
      : Object.values(pm.sessions).map(x => x.label).join(' · ');
    return { pm, color, names };
  };
  const square = (pm, color) => `<span class="psq" style="--c:${color}">${esc(pm.name.charAt(0).toUpperCase())}</span>`;
  const row = id => {
    const { pm, color, names } = info(id);
    const on = data.activeProgramme === id;
    return `
      <button class="cell cell--pick" data-action="select-prog" data-id="${esc(id)}" aria-pressed="${on}">
        ${square(pm, color)}
        <span class="cell__body">
          <span class="cell__title">${esc(pm.name)}</span>
          <span class="cell__sub cell__sub--1">${names}</span>
          ${coachFromLine(id) ? `<span class="cell__sub coach-from">${coachFromLine(id)}</span>` : ''}
        </span>
        <span class="cell__check">${on ? icon('checkmark', 20) : ''}</span>
      </button>`;
  };
  // Mode Modifier : même ligne que les exercices d'une séance (⊖ puis bouton rouge, poignée ≡)
  const editRow = id => {
    const { pm, color } = info(id);
    const active = id === data.activeProgramme, created = !PROGRAMMES[id];
    const verb = created ? 'Supprimer' : 'Retirer';
    const minus = active
      ? '<span class="mp-keep" aria-hidden="true"></span>'
      : `<button class="ed-minus" data-action="ed-reveal" aria-label="${verb} ${esc(pm.name)}">${icon('minus', 14)}</button>`;
    return `
      <div class="cell ed-row ed-row--edit mp-row" data-id="${esc(id)}">
        ${minus}
        ${square(pm, color)}
        <span class="cell__body">
          <span class="cell__title ed-name">${esc(pm.name)}</span>
          ${active ? '<span class="cell__sub">Programme actif</span>' : ''}
        </span>
        ${active ? '' : `<button class="ed-del" data-action="${created ? 'delete-programme' : 'remove-my-prog'}" data-id="${esc(id)}">${verb}</button>`}
        <span class="ed-handle mp-handle" role="button" aria-label="Déplacer ${esc(pm.name)}">${icon('line.3.horizontal', 22)}</span>
      </div>`;
  };
  const editing = myProgEditing;
  const right = `<button class="navbar__text ${editing ? 'navbar__text--bold' : ''}" data-action="toggle-my-prog-edit">${editing ? 'OK' : 'Modifier'}</button>`;
  return `
    <div class="view my-programmes view--grouped">
      ${navBar({ title: 'Mes programmes', right })}
      <div class="scr">
        <div class="group mp-list">${ids.map(editing ? editRow : row).join('')}</div>
        ${editing
          ? '<div class="group-foot">Fais glisser ≡ pour ranger tes programmes. Un programme retiré reste dans « Tous les programmes ».</div>'
          : `<div class="group group--gap">
               <button class="cell cell--action" data-action="go-prog-add">${icon('plus', 20)}<span>Ajouter un programme</span></button>
             </div>
             <div class="group-foot">Ton historique reste disponible quand tu changes de programme.</div>`}
      </div>
    </div>`;
}

// Ajouter un programme : en créer un, ou en prendre un dans « Tous les programmes » (intégrés)
function renderProgAdd() {
  const row = id => {
    const pm = PROGRAMMES[id], adv = PROGRAMME_ADVICE[id];
    const color = Object.values(pm.sessions)[0]?.color || 'var(--label3)';
    const state = data.activeProgramme === id ? 'Actif' : inMyProgrammes(id) ? 'Ajouté' : '';
    return `
      <button class="cell cell--nav" data-action="open-prog-info" data-id="${esc(id)}">
        <span class="psq" style="--c:${color}">${esc(pm.name.charAt(0).toUpperCase())}</span>
        <span class="cell__body">
          <span class="cell__title">${esc(pm.name)}</span>
          <span class="cell__sub">${adv ? `${adv.perWeek} séances par semaine · ` : ''}${Object.values(pm.sessions).map(x => esc(x.label)).join(' · ')}</span>
        </span>
        ${state ? `<span class="cell__value">${state}</span>` : ''}
        ${icon('chevron.right', 16)}
      </button>`;
  };
  return `
    <div class="view prog-add view--grouped">
      ${navBar({ title: 'Ajouter un programme' })}
      <div class="scr">
        <div class="group">
          <button class="cell cell--action" data-action="new-programme">${icon('plus', 20)}<span>Créer un programme</span></button>
        </div>
        <div class="group-foot">Tes séances et tes exercices, vide ou à partir d'un programme existant.</div>
        <div class="group-title">Tous les programmes</div>
        <div class="group">${catalogueProgrammeIds().map(row).join('')}</div>
      </div>
    </div>`;
}

// Séances d'un programme intégré expliquées en français (« Push · pousser », muscles en dessous) :
// écran de résultat du premier lancement et fiche du catalogue
function programmeSessionsHtml(id) {
  return programmePreview(id).map(s => `
    <div class="cell prog-sess">
      ${catBadge(s.color)}
      <span class="cell__body">
        <span class="cell__title">${esc(s.label)}${s.plain ? ` <span class="prog-sess__plain">· ${esc(s.plain.toLowerCase())}</span>` : ''}</span>
        <span class="cell__sub">${esc(s.muscles)}</span>
      </span>
    </div>`).join('');
}

// Fiche d'un programme du catalogue : pourquoi, muscles travaillés, séances ; l'ajouter ou l'utiliser
function renderProgInfo(id) {
  const pm = PROGRAMMES[id];
  if (!pm || id === 'custom') return renderProgAdd();
  const adv = PROGRAMME_ADVICE[id] || {};
  const active = data.activeProgramme === id, mine = inMyProgrammes(id);
  return `
    <div class="view prog-info view--grouped">
      ${navBar({ title: pm.name, large: true })}
      <div class="scr">
        <p class="prog-info__why">${recommendReason(id, { ...adv, orMore: false })}</p>
        <div class="group group--pad prog-info__map">
          ${bodyMapHtml(programmeMuscleLevels(id), { captions: true, label: `Muscles travaillés par ${pm.name}` })}
        </div>
        <div class="group-title">Séances</div>
        <div class="group">${programmeSessionsHtml(id)}</div>
        <div class="prog-info__actions">
          ${active
            ? '<p class="prog-info__state">Programme actif</p>'
            : `<button class="btn btn--primary prog-info__btn" data-action="prog-info-use" data-id="${esc(id)}">Utiliser ce programme</button>`}
          ${mine
            ? (active ? '' : '<p class="prog-info__state">Dans mes programmes</p>')
            : `<button class="btn btn--secondary prog-info__btn" data-action="prog-info-add" data-id="${esc(id)}">Ajouter à mes programmes</button>`}
        </div>
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

// Ordre de Mes programmes
makeReorderable({
  view: 'my-programmes', list: '.mp-list', row: '.mp-row', handle: '.mp-handle',
  onMove: (from, to) => { if (moveMyProgramme(from, to)) save(); },
});

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
  'go-my-programmes': () => {
    myProgEditing = false;
    navigate('my-programmes');
  },
  'toggle-my-prog-edit': () => {
    myProgEditing = !myProgEditing; render();
  },
  'remove-my-prog': (e, el) => {
    if (removeMyProgramme(el.dataset.id)) { save(); render(); haptic(); }
  },
  'go-prog-add': () => {
    navigate('prog-add');
  },
  'open-prog-info': (e, el) => {
    navigate(makeRoute('prog-info', el.dataset.id));
  },
  'prog-info-add': (e, el) => {
    if (!addMyProgramme(el.dataset.id)) return;
    save(); render(); haptic();
    showToast(`${progMeta(el.dataset.id).name} ajouté à tes programmes`);
  },
  // Utiliser = ajouter et activer, puis retour à la racine de l'onglet (Programme ou Entraînement)
  'prog-info-use': (e, el) => {
    const id = el.dataset.id;
    if (!PROGRAMMES[id]) return;
    addMyProgramme(id);
    activateProgramme(id);
    save();
    haptic();
    routeTo(nav.stacks[nav.tab][0]);
    showToast(`Programme : ${progMeta(id).name}`);
  },
  'open-prog-session': (e, el) => {
    editorEditing = false;
    navigate(makeRoute('editor', el.dataset.cat));
  },
  // Mes programmes : un toucher active, puis retour à l'écran d'où l'on vient (onglet Programme ou accueil)
  'select-prog': async (e, el) => {
    const id = el.dataset.id;
    if (id === data.activeProgramme) { goBack(); return; }
    if (!(await confirmSheet(`Passer à ${progMeta(id).name} ?`, 'Ton historique reste disponible.', 'Changer de programme', false))) return;
    activateProgramme(id);
    save();
    goBack();
    showToast(`Programme : ${progMeta().name}`);
  },
  'new-programme': async () => {
    const name = await askText({ title: 'Nouveau programme', message: 'Donne-lui un nom.', placeholder: 'Ex : Force 5×5', confirm: 'Suivant' });
    if (!name) return;
    const start = await dialog({ type: 'sheet', title: `Partir de quoi pour « ${name} » ?`,
      message: 'Tu pourras ensuite ajouter, renommer ou supprimer des séances et des exercices.',
      actions: [
        { label: 'Programme vide', value: 'empty', style: 'preferred' },
        ...Object.entries(PROGRAMMES).filter(([k]) => k !== 'custom').map(([k, pm]) => ({ label: `Copie ${elide('de', pm.name)}`, value: k })),
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
    addMyProgramme(id);
    openProgramme(id);
    showToast(`Programme « ${name} » créé`);
    // Programme vide : on enchaîne sur sa première séance
    if (start === 'empty') openNewSession();
  },
  // Partage du programme actif : feuille de partage d'iOS (app), du navigateur, sinon presse-papiers
  'share-programme': async () => {
    const text = programmeShareText(programmeSharePayload(data.activeProgramme));
    if (Native.isNative) { if ((await Native.shareText(text, progMeta().name)) === 'failed') showToast('Partage impossible', { error: true }); return; }
    if (navigator.share) { try { await navigator.share({ text }); } catch {} return; }
    try { await navigator.clipboard.writeText(text); showToast('Programme copié, colle-le dans un message'); }
    catch { showToast('Partage impossible', { error: true }); }
  },
  'rename-programme': async () => {
    const id = data.activeProgramme, up = data.userProgrammes[id];
    if (!up) return;
    const name = await askText({ title: 'Renommer le programme', value: up.name });
    if (!name) return;
    up.name = name; save(); render();
  },
  // Depuis l'onglet : le programme actif ; depuis Mes programmes › Modifier : celui de la ligne (data-id)
  'delete-programme': async (e, el) => {
    const id = el?.dataset.id || data.activeProgramme, up = data.userProgrammes[id];
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
    data.myProgrammes = (data.myProgrammes || []).filter(x => x !== id);
    if (id === data.activeProgramme) {
      // Programme suivant de la liste, sinon PPL (remis dans la liste : l'actif y est toujours)
      const next = data.myProgrammes[0] || 'ppl';
      addMyProgramme(next);
      if (currentView() === 'my-programmes') { activateProgramme(next); save(); render(); }
      else openProgramme(next);
    } else { save(); render(); }
    showToast('Programme supprimé');
  },
});
