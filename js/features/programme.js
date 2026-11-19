// ═══════════════════════════════════════════════════════════
//  Onglet Programme : séances du programme actif, Mes programmes, catalogue, programmes perso
// ═══════════════════════════════════════════════════════════
'use strict';

let progEditing = false;   // mode Modifier de la liste des séances (ordre)

function exSetsCount(cat, progId) {
  const list = data.programmes[progId]?.exercises?.[cat] || [];
  return { n: list.length, sets: list.reduce((a, e) => a + (parseInt(e.sets) || 0), 0) };
}

// Muscles les plus travaillés par les exercices d'une séance (« Pectoraux · Épaules · Triceps »), échappés :
// séances sans description (programme créé ou reçu d'un coach). Décompte de exercisesMuscleCount
// (js/features/progress-muscles.js), regroupé par nom court
function sessionMusclesSummary(progId, cat) {
  const count = new Map();
  exercisesMuscleCount(data.programmes[progId]?.exercises?.[cat] || []).forEach((w, id) => {
    const label = MUSCLE_BY_ID.get(id)?.short || muscleLabel(id);
    count.set(label, (count.get(label) || 0) + w);
  });
  return esc([...count.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([l]) => l).join(' · '));
}

// Petite vignette 3D d'un muscle, à gauche d'un exercice de Programme › Séance, comme la liste de Progrès ; cadrée
// sur le muscle (data-m, css/programme.css : un deltoïde reste lisible à 48 px) ; décorative, cachée en texte agrandi
function progRowThumbHtml(id) {
  return id ? `<span class="prow-thumb" data-m="${esc(id)}" aria-hidden="true"><img class="mgc__img" src="img/muscles/${id}.webp" alt="" width="600" height="400" decoding="async"></span>` : '';
}

// Vignette d'une carte de séance : celle du groupe principal (mainGroupOf, js/features/progress-muscles.js, comme
// l'accueil) ; pour les jambes, celle du muscle le plus travaillé (Legs commence par les quadriceps : la vue de dos
// des ischios contredisait le texte)
function progSessionThumbHtml(cat) {
  const list = prog().exercises[cat] || [], index = chosenMusclesIndex();
  let id = mainGroupOf(list, index);
  if (!id) return '';
  if (id === 'jambes') {
    const n = exercisesMuscleCount(list, index);
    id = MUSCLE_GROUP_BY_ID.get('jambes').muscles.slice().sort((x, y) => (n.get(y) || 0) - (n.get(x) || 0))[0];
  }
  return `<img class="mgc__img pcard__img" src="img/muscles/${id}.webp" alt="" aria-hidden="true" width="600" height="400" decoding="async">`;
}

// Vignette d'un programme (Mes programmes, Tous les programmes), d'après ses vrais exercices (ceux par défaut d'un
// programme intégré jamais ouvert). Un programme couvre presque toujours plusieurs groupes : le personnage entier,
// face et dos, avec en rouge les muscles qu'il travaille (bodyMapHtml, comme le récap de la semaine). Programme
// vraiment ciblé (plus de 60 % de ses exercices dans un groupe) : la vignette de ce groupe. Sans exercice : son
// initiale, en gris. Décorative : le nom et les séances sont écrits à côté.
const PROG_FOCUS_SHARE = 0.6;
function programmeExercises(id) {
  return Object.values((data.programmes[id] || makeProgData(id)).exercises || {}).flat();
}
// Groupe dominant (exercisesGroups, js/features/progress-muscles.js) s'il pèse plus de 60 % du programme, sinon null
function programmeFocusGroup(exs) {
  const groups = exercisesGroups(exs, chosenMusclesIndex());
  const total = groups.reduce((a, x) => a + x.n, 0);
  return groups.length && groups[0].n / total > PROG_FOCUS_SHARE ? groups[0].g.id : null;
}
function programmeLevels(exs) {
  const levels = {}, index = chosenMusclesIndex();
  exs.forEach(ex => {
    const m = exerciseMuscles(ex, index);
    m.secondary.forEach(k => { levels[k] = Math.max(levels[k] || 0, 0.4); });
    m.primary.forEach(k => { levels[k] = 1; });
  });
  return levels;
}
function progSquareHtml(id, pm) {
  const exs = programmeExercises(id);
  const focus = exs.length ? programmeFocusGroup(exs) : null;
  if (focus) return `<span class="psq psq--img" aria-hidden="true"><img class="mgc__img" src="img/muscles/${focus}.webp" alt="" width="600" height="400" decoding="async"></span>`;
  const levels = exs.length ? programmeLevels(exs) : {};
  if (Object.keys(levels).length) return `<span class="psq psq--body" aria-hidden="true">${bodyMapHtml(levels, { view: 'both' })}</span>`;
  return `<span class="psq">${esc(pm.name.charAt(0).toUpperCase())}</span>`;
}

// Séance du programme en carte illustrée, comme « Autres séances » sur l'accueil : nom, muscles, exercices, séries et
// durée habituelle à gauche, vignette du groupe principal à droite (sessionThumbHtml, js/features/dashboard.js).
// VoiceOver lit le texte affiché, « environ 55 minutes » à la place de « ≈ 55 min » ; l'image est décorative.
function progSessionCardHtml(cat, progId) {
  const meta = sessionMeta(cat, progId), c = exSetsCount(cat, progId), mins = sessionMinutes(cat);
  const muscles = meta.desc || sessionMusclesSummary(progId, cat);
  const facts = c.n ? [plural(c.n, 'exercice', 'exercices'), plural(c.sets, 'série', 'séries')] : ['Aucun exercice'];
  // « ≈ 55 min » à l'écran, « environ 55 minutes » pour VoiceOver : l'intitulé reste le texte affiché (WCAG 2.5.3)
  const duration = mins ? `\u00a0· <span aria-hidden="true">≈ ${mins} min</span><span class="sr-text">environ ${mins} minutes</span>` : '';
  return `
      <button class="cell cell--nav mgc pcard" data-action="open-prog-session" data-cat="${esc(cat)}" data-id="${esc(cat)}">
        <span class="cell__body mgc__text">
          <span class="cell__title pcard__name">${esc(sessionTitle(cat, progId))}</span>
          ${muscles ? `<span class="pcard__muscles">${muscles}</span>` : ''}
          <span class="cell__sub pcard__facts num">${facts.join('\u00a0· ')}${duration}</span>
        </span>
        ${progSessionThumbHtml(cat)}
        ${icon('chevron.right', 16)}
      </button>`;
}

// « Ordre des séances » : une ligne de la liste, comme « Ajouter une séance », et non un petit lien dans le titre
// (Maxence ne trouvait pas « Modifier l'ordre », 19/11). Flèches haut et bas : ≡ reste à la poignée seule (panel t1).
function orderSessionsCellHtml(action = 'toggle-prog-order', value = '') {
  return `<button class="cell cell--action" data-action="${action}">${icon('arrow.up.arrow.down', 20)}<span class="cell__body">Ordre des séances</span>${value ? `<span class="cell__value">${value}</span>` : ''}</button>`;
}
// Ordre des séances modifiable : programme créé, au moins deux séances
function canReorderSessions(pid = data.activeProgramme) {
  return isUserProg(pid) && sessionKeys(pid).length > 1;
}

// Entrée secondaire de l'onglet en liste iOS : icône neutre dans un carré gris (l'orange reste aux actions)
function progListIconHtml(name) {
  return `<span class="plist__icon" aria-hidden="true">${icon(name, 18)}</span>`;
}

// Page du programme actif (vote du 19/11, 7 juges sur 7 : « un programme, une page ») : tout ce qui règle le programme
// y vit, et seulement là. Ses séances dans l'ordre choisi (jamais triées par la récupération), « Ordre des séances »,
// « Ajouter une séance », puis l'envoyer, le renommer, le supprimer. On y arrive depuis la liste Programmes (racine de
// l'onglet), « Changer l'ordre » de l'accueil, ou en activant un programme.
function renderProgrammes() {
  const pid  = data.activeProgramme;
  const pm   = progMeta(pid);
  // Ligne du mode ordre : la séance ne s'ouvre pas, la poignée ≡ la déplace (js/ui/reorder.js)
  // Tête de file (la séance que l'accueil propose) : « Prochaine » à côté de son nom (panel t1, 17 juges)
  const head = isUserProg(pid) ? nextSessionCat(sessionKeys(pid)) : null;
  const nextTag = cat => cat === head ? ' <span class="ps-next">Prochaine</span>' : '';
  const editCell = (cat, progId) => {
    const label = sessionMeta(cat, progId).label;
    return `
      <div class="cell ed-row--edit ps-row">
        <span class="cell__body"><span class="cell__title">${label}${nextTag(cat)}</span></span>
        <button class="ed-handle ps-handle" data-action="reorder-menu" aria-label="Déplacer ${label}">${icon('line.3.horizontal', 22)}</button>
      </div>`;
  };
  const user = isUserProg(pid);
  const keys = sessionKeys(pid);
  const canReorder = canReorderSessions(pid);
  const editing = canReorder && progEditing;
  const sessions = `
      <div class="group-title group-title--row">
        <span>${editing ? 'Ordre des séances' : 'Séances'}</span>
      </div>
      <div class="group ps-list">
        ${keys.map(c => editing ? editCell(c, pid) : progSessionCardHtml(c, pid)).join('')}
        ${canReorder && !editing ? orderSessionsCellHtml() : ''}
        ${user && !editing ? `<button class="cell cell--action" data-action="add-custom-session">${icon('plus', 20)}<span>Ajouter une séance</span></button>` : ''}
      </div>
      ${editing ? `<div class="group-foot">Fais glisser ≡, ou touche-le pour Monter ou Descendre. La prochaine séance est celle qui attend depuis le plus longtemps ; une séance faite repart à la fin.</div>` : ''}
      ${user ? '' : `<div class="group-foot">Les séances de ce programme sont fixes. Leurs exercices se modifient. Pour composer tes séances, crée un programme.</div>`}`;
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
      ${navBar({ title: esc(pm.name), large: true, sub: '<p class="prog-info__note prog-page__state">Programme actif</p>',
        // Mode ordre : OK en haut à droite, le retour masqué le temps du réglage (comme le mode Modifier d'iOS, panel t1)
        ...(editing ? { left: '<span aria-hidden="true"></span>', right: '<button class="navbar__text navbar__text--bold" data-action="toggle-prog-order">OK</button>' } : {}) })}
      <div class="scr">
        ${coachEditorConsigneHtml(data.activeProgramme)}
        ${sessions}
        ${editing ? '' : `
        <div class="group group--gap">
          <button class="cell cell--action" data-action="share-programme">${icon('square.and.arrow.up', 20)}<span>Envoyer ce programme</span></button>
        </div>
        <div class="group-foot">Envoie les séances et les exercices par message. Tes charges et ton historique ne partent pas.</div>
        ${manage}`}
      </div>
    </div>`;
}

// Programmes (racine de l'onglet Programme) : mes programmes (data.myProgrammes), dans leur ordre ; toucher un programme
// ouvre sa page (le programme actif : ses réglages ; un autre : sa fiche et « Utiliser ce programme »). « Modifier » :
// poignées ≡ pour ranger les programmes, ⊖ pour retirer un programme intégré (il reste dans « Tous les programmes ») ou
// supprimer un programme créé. Dessous : la Bibliothèque d'exercices et les plans de nutrition.
let myProgEditing = false;
function renderMyProgrammes() {
  const ids = data.myProgrammes || [];
  const info = id => {
    const pm = progMeta(id), keys = sessionKeys(id);
    const names = isUserProg(id)
      ? (keys.map(k => esc(rawLabel(k, id))).join(' · ') || 'Aucune séance')
      : Object.values(pm.sessions).map(x => sessionPlainName(x.label) || x.label).join(' · ');
    return { pm, names };
  };
  const row = id => {
    const { pm, names } = info(id);
    const on = data.activeProgramme === id;
    return `
      <button class="cell cell--nav" data-action="open-my-prog" data-id="${esc(id)}">
        ${progSquareHtml(id, pm)}
        <span class="cell__body">
          <span class="cell__title">${esc(pm.name)}</span>
          ${on ? '<span class="cell__sub mp-active">Programme actif</span>' : ''}
          <span class="cell__sub mp-names">${names}</span>
          ${coachFromLine(id) ? `<span class="cell__sub coach-from">${coachFromLine(id)}</span>` : ''}
        </span>
        ${icon('chevron.right', 16)}
      </button>`;
  };
  // Mode Modifier : même ligne que les exercices d'une séance (⊖ puis bouton rouge, poignée ≡)
  const editRow = id => {
    const { pm } = info(id);
    const active = id === data.activeProgramme, created = !PROGRAMMES[id];
    const verb = created ? 'Supprimer' : 'Retirer';
    const minus = active
      ? '<span class="mp-keep" aria-hidden="true"></span>'
      : `<button class="ed-minus" data-action="ed-reveal" aria-label="${verb} ${esc(pm.name)}">${icon('minus', 14)}</button>`;
    return `
      <div class="cell ed-row ed-row--edit mp-row" data-id="${esc(id)}">
        ${minus}
        ${progSquareHtml(id, pm)}
        <span class="cell__body">
          <span class="cell__title ed-name">${esc(pm.name)}</span>
          ${active ? '<span class="cell__sub">Programme actif</span>' : ''}
        </span>
        ${active ? '' : `<button class="ed-del" data-action="${created ? 'delete-programme' : 'remove-my-prog'}" data-id="${esc(id)}">${verb}</button>`}
        <button class="ed-handle mp-handle" data-action="reorder-menu" aria-label="Déplacer ${esc(pm.name)}">${icon('line.3.horizontal', 22)}</button>
      </div>`;
  };
  const editing = myProgEditing;
  // Grand titre : « Mes programmes » compact ne laissait au retour que « Retour » (iPhone 13) ou le chevron (SE)
  // « Ranger » et non « Modifier » (panel t1, 38 juges : trois « Modifier » qui ne faisaient pas la même chose)
  const right = `<button class="navbar__text ${editing ? 'navbar__text--bold' : ''}" data-action="toggle-my-prog-edit">${editing ? 'OK' : 'Ranger'}</button>${editing ? '' : settingsButtonHtml()}`;
  return `
    <div class="view my-programmes view--grouped">
      ${navBar({ title: 'Programmes', right, large: true })}
      <div class="scr">
        <div class="group mp-list">${ids.map(editing ? editRow : row).join('')}
          ${editing ? '' : `<button class="cell cell--action" data-action="go-prog-add">${icon('plus', 20)}<span>Ajouter un programme</span></button>`}
        </div>
        ${editing
          ? '<div class="group-foot">Fais glisser ≡ pour ranger tes programmes. Un programme retiré reste dans « Tous les programmes ».</div>'
          : `<div class="group-foot">Touche un programme pour voir ses séances et ses réglages. Changer de programme garde l'historique.</div>
             <div class="group group--gap plist">
               <button class="cell cell--nav" data-action="go-library">
                 ${progListIconHtml('books.vertical')}
                 <span class="cell__body"><span class="cell__title">Bibliothèque d'exercices</span>
                   <span class="cell__sub">${EXERCISE_CATALOGUE.length} exercices</span></span>
                 ${icon('chevron.right', 16)}
               </button>
               ${dietProgrammeCellHtml(progListIconHtml('fork.knife'))}
             </div>`}
      </div>
    </div>`;
}

// Ajouter un programme : en créer un, ou en prendre un dans « Tous les programmes » (intégrés).
// Vignette du catalogue = séances par semaine en gros : tous ces programmes couvrent le corps entier, le personnage
// serait le même sur chaque ligne (« une icône = un sens ») ; il reste dans la fiche du programme.
function renderProgAdd() {
  const row = id => {
    const pm = PROGRAMMES[id], adv = PROGRAMME_ADVICE[id];
    const state = data.activeProgramme === id ? 'Actif' : inMyProgrammes(id) ? 'Ajouté' : '';
    return `
      <button class="cell cell--nav" data-action="open-prog-info" data-id="${esc(id)}">
        ${adv ? `<span class="psq psq--freq" aria-hidden="true"><b>${adv.perWeek}</b>/ sem</span>` : progSquareHtml(id, pm)}
        <span class="cell__body">
          <span class="cell__title">${esc(pm.name)}</span>
          ${state ? `<span class="cell__sub prog-add__state">${state}</span>` : ''}
          <span class="cell__sub">${adv ? `<span class="psq-freq-txt">${adv.perWeek} séances par semaine\u00a0· </span><span class="sr-text psq-freq-sr">${adv.perWeek} séances par semaine, </span>` : ''}${Object.values(pm.sessions).map(x => esc(sessionPlainName(x.label) || x.label)).join(' · ')}</span>
        </span>
        ${icon('chevron.right', 16)}
      </button>`;
  };
  return `
    <div class="view prog-add view--grouped">
      ${navBar({ title: 'Ajouter un programme' })}
      <div class="scr">
        <div class="group plist">
          <button class="cell cell--nav" data-action="go-prog-gen">
            ${progListIconHtml('slider.horizontal.3')}
            <span class="cell__body"><span class="cell__title">Programme sur mesure</span>
              <span class="cell__sub">${GEN_QUESTIONS} questions, puis un programme modifiable</span></span>
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell cell--action" data-action="new-programme">${icon('plus', 20)}<span>Créer un programme</span></button>
        </div>
        <div class="group-foot">« Créer un programme » part de zéro ou d'un programme existant.</div>
        <div class="group-title">Tous les programmes</div>
        <div class="group">${catalogueProgrammeIds().map(row).join('')}</div>
      </div>
    </div>`;
}

// Séances d'un programme intégré expliquées en français (« Pousser (Push) », muscles en dessous) :
// écran de résultat du premier lancement et fiche du catalogue
function programmeSessionsHtml(id) {
  return programmePreview(id).map(s => `
    <div class="cell prog-sess">
      ${catBadge(s.color)}
      <span class="cell__body">
        <span class="cell__title">${s.plain ? `${esc(s.plain)} <span class="prog-sess__plain">(${esc(s.label)})</span>` : esc(s.label)}</span>
        <span class="cell__sub">${esc(s.muscles)}</span>
      </span>
    </div>`).join('');
}

// Fiche d'un programme du catalogue : pourquoi, muscles travaillés, séances ; l'ajouter ou l'utiliser
function renderProgInfo(id) {
  if (isUserProg(id) && !data.userProgrammes[id]?.archived) return renderUserProgInfo(id);   // créé, ou « Perso »
  const pm = PROGRAMMES[id];
  if (!pm || id === 'custom') return renderProgAdd();
  const adv = PROGRAMME_ADVICE[id] || {};
  const active = data.activeProgramme === id, mine = inMyProgrammes(id);
  return `
    <div class="view prog-info view--grouped">
      ${navBar({ title: pm.name, large: true })}
      <div class="scr">
        ${mine && !active ? '<p class="prog-info__note">Déjà dans tes programmes</p>' : ''}
        <div class="prog-info__actions prog-info__actions--top">
          ${active
            ? '<p class="prog-info__state">Programme actif</p>'
            : `<button class="btn btn--primary prog-info__btn" data-action="prog-info-use" data-id="${esc(id)}">Utiliser ce programme</button>`}
          ${mine ? '' : `<button class="btn btn--secondary prog-info__btn" data-action="prog-info-add" data-id="${esc(id)}">Ajouter à mes programmes</button>`}
        </div>
        <p class="prog-info__why">${recommendReason(id, { ...adv, orMore: false })}</p>
        <div class="group group--pad prog-info__map">
          ${bodyMapHtml(programmeMuscleLevels(id), { captions: true, label: `Muscles travaillés par ${pm.name}` })}
        </div>
        <div class="group-title">Séances</div>
        <div class="group">${programmeSessionsHtml(id)}</div>
      </div>
    </div>`;
}

// Fiches : « Utiliser ce programme » juste sous le nom (visible sans défiler sur iPhone SE, texte agrandi compris).
// Fiche d'un programme créé qui n'est pas l'actif : ses séances dans leur ordre, les muscles travaillés, « Utiliser ce
// programme ». Ses réglages (ordre, exercices, nom) s'ouvrent une fois actif, dans sa page : un seul endroit.
function renderUserProgInfo(id) {
  const pm = progMeta(id), keys = sessionKeys(id), exs = programmeExercises(id);
  const levels = exs.length ? programmeLevels(exs) : {};
  const rows = keys.map(k => `
    <div class="cell prog-sess">
      ${catBadge(sessionMeta(k, id).color)}
      <span class="cell__body"><span class="cell__title">${esc(sessionTitle(k, id))}</span>
        <span class="cell__sub">${plural((data.programmes[id]?.exercises?.[k] || []).length, 'exercice', 'exercices')}</span></span>
    </div>`).join('');
  return `
    <div class="view prog-info view--grouped">
      ${navBar({ title: esc(pm.name), large: true })}
      <div class="scr">
        <p class="prog-info__note">${coachFromLine(id) || 'Déjà dans tes programmes'}</p>
        <div class="prog-info__actions prog-info__actions--top">
          <button class="btn btn--primary prog-info__btn" data-action="prog-info-use" data-id="${esc(id)}">Utiliser ce programme</button>
        </div>
        <div class="group-foot">Une fois actif, tu règles ici ses séances, leur ordre et ses exercices.</div>
        ${Object.keys(levels).length ? `<div class="group group--pad prog-info__map">
          ${bodyMapHtml(levels, { captions: true, label: `Muscles travaillés par ${esc(pm.name)}` })}
        </div>` : ''}
        <div class="group-title">Séances</div>
        <div class="group">${rows || '<div class="cell"><span class="cell__body">Aucune séance</span></div>'}</div>
      </div>
    </div>`;
}

// Ordre des séances, depuis l'accueil (« Changer l'ordre ») : la page du programme actif, en mode ordre, dans
// l'onglet Programme (Programmes › le programme)
let progOrderFromHome = false;   // ordre ouvert par « Changer l'ordre » de l'accueil : OK y ramène
function openSessionOrder() {
  progEditing = true;
  progOrderFromHome = nav.tab === 'train';
  const next = navClone(nav);
  next.tab = 'program';
  next.stacks.program = [TABS.program.root, 'programmes'];
  navCommit(next, 'fade', 'push');
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

// Programme activé depuis l'onglet (créé, ou suivant d'un programme supprimé) : enregistré, puis sa page,
// juste sous la liste Programmes
function openProgramme(id) {
  activateProgramme(id);
  save();
  showActiveProgramme();
}
// Page du programme actif juste sous la liste Programmes (onglet Programme) ; ailleurs, poussée dans l'onglet courant
function showActiveProgramme() {
  if (nav.tab !== 'program') { routeTo('programmes'); return; }
  const next = navClone(nav);
  next.stacks.program = [TABS.program.root, 'programmes'];
  navCommit(next, 'push', 'replace');
}

// Ordre de Mes programmes
makeReorderable({
  view: 'my-programmes', list: '.mp-list', row: '.mp-row', handle: '.mp-handle',
  onMove: (from, to) => { if (moveMyProgramme(from, to)) save(); },
  nameOf: i => progMeta((data.myProgrammes || [])[i]).name,
});

// Ordre des séances d'un programme perso
makeReorderable({
  view: 'programmes', list: '.ps-list', row: '.ps-row', handle: '.ps-handle',
  onMove: (from, to) => { if (moveSession(data.activeProgramme, from, to)) save(); },
  nameOf: i => sessionMeta(sessionKeys(data.activeProgramme)[i], data.activeProgramme).label,
});

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'toggle-prog-order': () => {
    progEditing = !progEditing;
    if (!progEditing && progOrderFromHome) { progOrderFromHome = false; switchTab('train'); return; }   // OK : retour à l'accueil
    progOrderFromHome = false;
    render();
  },
  // « Programme … › » de l'accueil : la page du programme actif (panel t1 : on s'attend à son programme, pas à la liste)
  'go-active-programme': () => {
    myProgEditing = false;
    progEditing = false;
    progOrderFromHome = false;
    const next = navClone(nav);
    next.tab = 'program';
    next.stacks.program = [TABS.program.root, 'programmes'];
    navCommit(next, 'fade', 'push');
  },
  'open-session-order': () => openSessionOrder(),
  'go-program': () => {
    switchTab('program');
  },
  // « Programme … › » de l'accueil : la liste Programmes, racine de l'onglet Programme
  'go-my-programmes': () => {
    myProgEditing = false;
    switchTab('program', { reset: true });
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
    showToast(`${progMeta(el.dataset.id).name} ajouté`);
  },
  // Utiliser = ajouter et activer, puis retour à la racine de l'onglet (Programme ou Entraînement)
  // Onglet Programme : la page du programme devenu actif ; ailleurs (catalogue depuis l'accueil) : la racine
  'prog-info-use': (e, el) => {
    const id = el.dataset.id;
    if (!PROGRAMMES[id] && !(data.userProgrammes[id] && !data.userProgrammes[id].archived)) return;
    addMyProgramme(id);
    activateProgramme(id);
    save();
    haptic();
    // Onglet Programme : sa page, dont le grand titre est le nom (pas de toast, il cacherait une séance) ; ailleurs, un toast
    if (nav.tab === 'program') { showActiveProgramme(); return; }
    routeTo(nav.stacks[nav.tab][0]);
    showToast(`Programme : ${progMeta(id).name}`);
  },
  'open-prog-session': (e, el) => {
    editorEditing = false;
    navigate(makeRoute('editor', el.dataset.cat));
  },
  // Programmes : un toucher ouvre la page du programme (l'actif) ou sa fiche avec « Utiliser ce programme »
  'open-my-prog': (e, el) => {
    const id = el.dataset.id;
    progOrderFromHome = false;
    if (id === data.activeProgramme) { progEditing = false; navigate('programmes'); return; }
    navigate(makeRoute('prog-info', id));
  },
  'new-programme': async () => {
    const name = await askText({ title: 'Nouveau programme', message: 'Donne-lui un nom.', placeholder: 'Ex : Force 5×5', confirm: 'Suivant' });
    if (!name) return;
    const start = await dialog({ type: 'sheet', title: `Partir de quoi pour « ${name} » ?`,
      message: 'Séances et exercices restent modifiables ensuite.',
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
    try { await navigator.clipboard.writeText(text); showToast('Copié, à coller dans un message'); }
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
