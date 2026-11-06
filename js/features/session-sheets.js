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
      <div class="rs__title">Repos · ${ssGroupOf(activeSession.exercises, ei) ? 'après chaque tour' : esc(ex.name)}</div>
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
let axMuscle = NO_MUSCLE_FILTER;   // filtre par muscle de la feuille, remis à zéro à chaque ouverture

const axItemHtml = n => `<button class="ax__item" data-action="ax-pick" data-name="${esc(n)}"><span class="ax__body"><span>${esc(n)}</span>${exMusclesSubHtml({ name: n }, 'ax__sub')}</span></button>`;
const axHintHtml = txt => `<div class="ax__hint">${txt}</div>`;
// Recherche approchée : au plus 3 exercices, pour que « Créer » reste à portée de pouce, juste dessous
const AX_PARTIAL_MAX = 3;

function axListHtml(q) {
  const nq    = normName(q);
  const query = q.trim();
  const eq    = data.exEquip;
  // Toute la bibliothèque (pas de coupure : un exercice ne doit jamais être introuvable sans le chercher)
  // Les exercices créés par la personne (sans matériel connu) restent visibles quel que soit le filtre
  const names = exerciseLibrary().filter(n => !ax.exclude.has(normName(n)) && (eq === 'all' || [eq, null].includes(equipmentOf(n)))
    && muscleFilterMatch(exerciseMuscles({ name: n }), axMuscle));
  // « Créer » reste toujours proposé (en dernier) dès que le nom exact n'existe pas, même quand un alias
  // ou un exercice proche correspond : une variante comme « Tractions lestées » doit avoir son propre suivi
  const create = query && !names.some(n => normName(n) === nq) ? axCreateHtml(query) : '';
  if (!query) {
    if (ax.replaceEi !== null) return axReplaceListHtml(names);
    return names.length ? names.map(axItemHtml).join('')
      : `<div class="ax__empty">Aucun exercice${muscleFilterTargets(axMuscle) ? ' pour ce muscle' : ''}</div>`;
  }
  // Recherche : le nom qui commence par le texte tapé d'abord, les correspondances avec une faute en dernier
  const scored = names.map(n => ({ n, score: exerciseMatchScore(n, q) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  if (scored.length) {
    const exact = scored.some(x => normName(x.n) === nq);
    const guess = !exact && scored[0].score === 1 ? axHintHtml('Tu voulais dire :') : '';
    return guess + scored.map(x => axItemHtml(x.n)).join('') + create;
  }
  // Aucun exercice n'a tous les mots : les plus proches (une partie des mots), au-dessus de « Créer »
  const near = closestExercises(names, q, AX_PARTIAL_MAX);
  return (near.length ? axHintHtml('Les plus proches :') + near.map(axItemHtml).join('') : '') + create;
}

// Remplacer, recherche vide : d'abord les exercices qui partagent les muscles principaux de l'exercice
// remplacé (le plus de muscles en commun, puis le nom le plus proche), ensuite le reste de la bibliothèque.
function axReplaceListHtml(names) {
  const rep = activeSession?.exercises[ax.replaceEi];
  const ranked = rep ? sameMusclesFirst(rep, names) : { same: [], rest: names };
  if (!ranked.same.length) return ranked.rest.map(axItemHtml).join('') || '<div class="ax__empty">Aucun exercice</div>';
  return axHintHtml('Mêmes muscles')
    + ranked.same.map(axItemHtml).join('')
    + (ranked.rest.length ? axHintHtml('Autres exercices') + ranked.rest.map(axItemHtml).join('') : '');
}

// Ligne « Créer » : les muscles devinés d'après le nom sont annoncés, puis proposés à la vérification après la création.
// Nom non reconnu : en séance, rien ne s'ouvre (choix proposé au bilan) ; ailleurs, la feuille des muscles suit.
function axCreateHtml(name) {
  const line = musclesLine(musclesOf(name));
  const sub  = line ? `${line} · devinés` : (ax.target === 'session' ? 'Muscles à choisir au bilan' : 'Muscles à choisir ensuite');
  return `<button class="ax__item ax__item--create" data-action="ax-pick" data-name="${esc(name)}" aria-label="Créer ${esc(name)}, ${esc(sub)}">
    ${icon('plus', 18)}<span class="ax__body"><span>Créer « ${esc(name)} »</span><span class="ax__sub">${esc(sub)}</span></span></button>`;
}

// Remplacer : la version plus facile ou plus dure du même mouvement, en un toucher
function axProgressionHtml(name) {
  const { easier, harder } = progressionOf(name);
  if (!easier && !harder) return '';
  const row = (n, lbl) => n ? `<button class="ax__item" data-action="ax-pick" data-name="${esc(n)}" aria-label="${lbl} : ${esc(n)}">
      <span class="ax__body"><span class="ax__sub">${lbl}</span><span>${esc(n)}</span></span></button>` : '';
  return `<div class="ax__list ax__prog">${row(easier, 'Plus facile')}${row(harder, 'Plus dur')}</div>`;
}

// Filtre de matériel : retenu d'une fois sur l'autre (data.exEquip), pour qui s'entraîne toujours au même endroit
function axEquipHtml() {
  return `<div class="ax__equip" role="group" aria-label="Matériel">
    ${[{ id: 'all', label: 'Tout' }, ...EQUIPMENT].map(({ id, label }) =>
      `<button class="ax__chip" aria-pressed="${data.exEquip === id}" data-action="ax-equip" data-equip="${id}">${label}</button>`).join('')}
  </div>`;
}

// Pastilles du filtre par muscle, partagées avec la Bibliothèque (js/features/library.js)
// action : nom de l'action (« lib-muscle », « ax-muscle ») ; f : filtre en cours { group, muscle }.
// Première ligne : les grands groupes ; seconde, une fois un groupe choisi : ses muscles. Lignes qui
// défilent de côté, pour ne pas manger la hauteur de la liste.
function muscleFilterHtml(action, f) {
  const chip = (label, attrs, on) => `<button class="ax__chip" aria-pressed="${on}" data-action="${action}" ${attrs}>${esc(label)}</button>`;
  const g = MUSCLE_GROUP_BY_ID.get(f?.group);
  const groups = [chip('Tous les muscles', 'data-group=""', !g),
    ...MUSCLE_GROUPS.map(x => chip(x.label, `data-group="${x.id}"`, g?.id === x.id))].join('');
  const sub = g && g.muscles.length > 1
    ? `<div class="mf__row mf__row--sub" role="group" aria-label="Muscles : ${esc(g.label)}">${[chip(g.all, `data-group="${g.id}" data-muscle=""`, !f.muscle),
        ...g.muscles.map(id => chip(muscleLabel(id), `data-group="${g.id}" data-muscle="${id}"`, f.muscle === id))].join('')}</div>`
    : '';
  return `<div class="mf" data-mf="${action}"><div class="mf__row" role="group" aria-label="Groupes de muscles">${groups}</div>${sub}</div>`;
}

// Toucher une pastille : nouveau filtre, pastilles redessinées en place
function muscleFilterTap(el, f) {
  const next = muscleFilterNext(f, el.dataset.group, 'muscle' in el.dataset ? el.dataset.muscle : undefined);
  const box = el.closest('.mf');
  if (box) box.outerHTML = muscleFilterHtml(box.dataset.mf, next);
  haptic();
  return next;
}

// exclude : noms à ne pas proposer (par défaut, les exercices de la séance en cours)
function openAddExSheet({ target = 'session', replaceEi = null, exclude, onPick = null } = {}) {
  const names = exclude ?? (activeSession?.exercises || []).map(e => e.name);
  ax = { target, replaceEi: target === 'session' ? replaceEi : null, exclude: new Set(names.map(normName)), onPick };
  const rep   = ax.replaceEi !== null ? activeSession.exercises[ax.replaceEi] : null;
  axMuscle    = NO_MUSCLE_FILTER;
  axSets      = rep ? Math.max(1, rep.sets.filter(s => !s.done).length) : 3;   // les séries qui restent à faire
  const html = `
    <div class="ax">
      <div class="ax__bar">
        <button class="ax__cancel" data-action="sheet-done">Annuler</button>
        <div class="ax__title">${rep ? 'Remplacer l\'exercice' : 'Ajouter un exercice'}</div>
        <span class="ax__spacer"></span>
      </div>
      ${rep ? `<div class="ax__replacing">À la place de ${esc(rep.name)}</div>${axProgressionHtml(rep.name)}` : ''}
      <input type="search" id="axSearch" class="ax__search" placeholder="Rechercher ou créer" autocomplete="off"
             autocapitalize="sentences" enterkeyhint="done" aria-label="Rechercher un exercice">
      ${axEquipHtml()}
      ${muscleFilterHtml('ax-muscle', axMuscle)}
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
      <div class="ax__list" id="axList">${axListHtml('')}</div>
    </div>`;
  openSessSheet({ cls: 'sess-sheet--addex', label: rep ? 'Remplacer l\'exercice' : 'Ajouter un exercice', html, full: true });
}

// Exercice choisi dans la feuille (liste, « Créer » ou touche Entrée), remis à sa cible
function axPick(name) {
  name = String(name || '').trim();
  if (!name) return;
  name = name.charAt(0).toUpperCase() + name.slice(1);  // nom créé en minuscules : « Hip thrust », pas « hip thrust »
  // Lu avant l'ajout, qui fait entrer le nom dans la bibliothèque
  const created = !exerciseLibrary().some(n => normName(n) === normName(name));
  if (ax.target === 'programme') addExerciseToEditedSession(name);
  else if (ax.target === 'past') ax.onPick?.(name, axSets);
  else pickExercise(name);
  // Hors séance, nom inventé : muscles devinés proposés à la vérification (un toucher sur OK les confirme,
  // fermer garde la devinette), muscles inconnus demandés. En séance, aucune feuille par-dessus
  // l'entraînement : les muscles inconnus sont demandés au bilan.
  if (ax.target === 'session') return;
  if (created && exerciseMuscles({ name }).source === 'rules') askMusclesToCheck(name);
  else askMusclesIfUnknown(name);
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
  const exObj = { exId, name: inProg ? inProg.name : name, measure: measureOf(inProg || { name }), ...(inProg?.tempo ? { tempo: inProg.tempo } : {}), ...(inProg?.tempoGuide === true ? { tempoGuide: true, tempoPrep: tempoPrepOf(inProg) } : {}), ...(cleanGrip(inProg?.grip) ? { grip: cleanGrip(inProg.grip) } : {}), sets: buildSets(sp, sc, { exId, name }, axSets, inProg || {}) };
  let target;
  if (ax.replaceEi !== null) {
    // Les séries déjà validées sont du travail fait : l'ancien exercice les garde (sans ses séries
    // restantes) et le nouveau se place juste après ; « Annuler » rend la séance d'avant
    const before = clone(activeSession.exercises), old = activeSession.exercises[ax.replaceEi];
    const done = old?.sets.filter(s => s.done) || [];
    // Superset : le remplaçant prend sa place dans le groupe ; l'ancien, avec ses séries faites, en sort
    // et passe juste avant le groupe (le groupe garde sa taille et son repos)
    const xs = activeSession.exercises, g = ssGroupOf(xs, ax.replaceEi);
    if (g) exObj.ss = old.ss;
    if (done.length && g) {
      old.sets = done; delete old.ss;
      xs.splice(ax.replaceEi, 1, exObj); xs.splice(g[0], 0, old); target = ax.replaceEi + 1;
    } else if (done.length) { old.sets = done; xs.splice(ax.replaceEi + 1, 0, exObj); target = ax.replaceEi + 1; }
    else { activeSession.exercises.splice(ax.replaceEi, 1, exObj); target = ax.replaceEi; }
    showToast(done.length ? `Remplacé, ${plural(done.length, 'série gardée', 'séries gardées')}` : 'Exercice remplacé', {
      action: 'Annuler', duration: 5000,
      onAction: () => restoreSessionExercises(before),
    });
  } else {
    activeSession.exercises.push(exObj);
    target = activeSession.exercises.length - 1;
    showToast(toProg ? 'Ajouté à la séance et au programme' : 'Ajouté à la séance');
  }
  activeSession.lastEi = null; activeSession.lastDone = null;
  closeSessSheets();
  haptic();
  persistSession();
  render();
  setTimeout(() => exCardOf(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

// « Annuler » d'un remplacement ou d'un retrait : la liste d'avant revient ; série rouverte et chrono
// abandonnés, leurs positions (ei) ne valant plus
function restoreSessionExercises(before) {
  if (!activeSession) return;
  cancelEffort();
  editingSet = null;
  activeSession.exercises = before;
  activeSession.lastEi = null; activeSession.lastDone = null;
  persistSession();
  render();
}

// Tempo choisi pendant la séance : préréglage ou saisie libre, puis rappel seul ou guidé au son.
// Appliqué à l'exercice de la séance et à celui du programme (la prochaine fois aussi).
async function chooseSessionTempo(ei) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  const pick = await dialog({ type: 'sheet', title: 'Tempo', message: 'Descente, pause en bas, montée, en secondes.', actions: [
    ...TEMPO_PRESETS.map(p => ({ label: `${p.label} ${shortTempo(p.tempo)}`, value: p.tempo })),
    { label: 'Personnalisé…', value: 'custom' },
    ...(ex.tempo ? [{ label: 'Sans tempo', value: 'none', style: 'destructive' }] : []),
    { label: 'Annuler', style: 'cancel' },
  ] });
  if (!pick || !activeSession) return;
  let tempo = null;
  if (pick === 'custom') {
    const raw = await askText({ title: 'Tempo personnalisé', message: '3 ou 4 chiffres, ex. 3-1-1 (X = explosif).', value: ex.tempo ? shortTempo(ex.tempo) : '', placeholder: '3-1-1' });
    if (!raw) return;
    const t = parseTempo(raw);
    if (!t) { showToast('Tempo illisible, ex. 3-1-1', { error: true }); return; }
    tempo = formatTempo(t);
  } else if (pick !== 'none') tempo = pick;
  let guide = false;
  if (tempo) {
    const mode = await dialog({ type: 'sheet', title: `Tempo ${shortTempo(tempo)}`, message: 'Pendant la série :', actions: [
      { label: 'Rappel seulement', value: 'rappel', style: 'preferred' },
      { label: 'Guidé au son', value: 'guide' },
      { label: 'Annuler', style: 'cancel' },
    ] });
    if (!mode || !activeSession) return;
    guide = mode === 'guide';
  }
  applyTempo(ex, tempo, guide);
  const inProg = ex.exId && (sessProg().exercises[activeSession.category] || []).find(e => e.id === ex.exId);
  if (inProg) { applyTempo(inProg, tempo, guide); save(); }
  persistSession();
  render();
  showToast(tempo ? `Tempo ${shortTempo(tempo)}${guide ? ', guidé au son' : ''}` : 'Tempo retiré');
}

// ── « Comment faire » d'un exercice : fiche de la bibliothèque, s'il y a des consignes, une animation ou une vidéo ──
function hasHowTo(ex) { return !!(exerciseHowTo(ex.name) || exerciseMove(ex.name) || exerciseVideo(ex.name)); }
// Nom tel que tapé : la fiche montre les muscles choisis pour lui (alias compris)
function openHowTo(ex) { navigate(makeRoute('library-ex', ex.name)); }

// ── Menu ⋯ d'un exercice ──
// Choix proposés pour l'exercice ei de la liste xs de la séance (curEi : exercice de la série en cours).
// Faire maintenant, Plus tard (js/data/session-order.js), Monter et Descendre gardent les
// supersets entiers (js/data/supersets.js) ; dans un groupe, le repos réglé est celui du tour.
function exerciseMenuActions(xs, ei, curEi = null) {
  const ex = xs[ei], inGroup = !!ssGroupOf(xs, ei), order = orderChoiceFor(xs, ei, curEi);
  return [
    ...(order === 'now' ? [{ label: 'Faire maintenant', value: 'now' }] : []),
    ...(order === 'later' ? [{ label: 'Plus tard', value: 'later' }] : []),
    ...(ssCanMove(xs, ei, -1) ? [{ label: 'Monter', value: 'up' }] : []),
    ...(ssCanMove(xs, ei, 1)  ? [{ label: 'Descendre', value: 'down' }] : []),
    ...(hasHowTo(ex) ? [{ label: 'Comment faire', value: 'howto' }] : []),
    ...(xs.length > 1 ? [{ label: inGroup ? 'Modifier le superset' : 'Superset avec…', value: 'superset' }] : []),
    ...(inGroup ? [{ label: 'Retirer du superset', value: 'ss-leave' }] : []),
    { label: 'Remplacer l\'exercice', value: 'replace' },
    // Échauffement (js/data/warmup.js) : exercice à charge sans série faite, hors superset (les tours s'enchaînent)
    ...(!inGroup && canWarmup(ex) ? [{ label: 'Ajouter un échauffement', value: 'warmup' }] : []),
    ...(isBarbellExercise(ex) ? [{ label: 'Disques', value: 'plates' }] : []),
    // Prise (js/data/grips.js) : seulement pour les mouvements où elle compte
    ...(gripOptionsFor(ex) ? [{ label: 'Prise', value: 'grip' }] : []),
    { label: inGroup ? 'Régler le repos du tour' : 'Régler le repos', value: 'rest' },
    ...(measureOf(ex) === 'reps' ? [{ label: ex.tempo ? `Tempo (${shortTempo(ex.tempo)})` : 'Tempo', value: 'tempo' }] : []),
    { label: 'Muscles ciblés', value: 'muscles' },
    { label: 'Relancer le repos', value: 'restart' },
    { label: 'Retirer l\'exercice', value: 'remove', style: 'destructive' },
    { label: 'Annuler', style: 'cancel' },
  ];
}
async function exerciseMenu(ei) {
  const ex = activeSession.exercises[ei];
  if (!ex) return;
  const choice = await dialog({ type: 'sheet', title: ex.name, actions: exerciseMenuActions(activeSession.exercises, ei, currentSet()?.ei) });
  if (!choice || !activeSession || activeSession.exercises[ei] !== ex) return;
  if (choice === 'now') { sessionDoNow(ei); return; }
  if (choice === 'later') { sessionDoLater(ei); return; }
  if (['up', 'down', 'replace', 'remove'].includes(choice)) cancelEffort();   // positions des séries modifiées
  const xs = activeSession.exercises;
  if (choice === 'grip') {
    openGripSheet(ei);
    return;
  } else if (choice === 'up' || choice === 'down') {
    const moved = ssMove(xs, ei, choice === 'up' ? -1 : 1);
    if (moved) activeSession.exercises = moved;
    activeSession.lastEi = null; activeSession.lastDone = null;
    editingSet = null;
    syncNativeRest();   // pendant un repos : notification et Live Activity annoncent le nouvel exercice suivant
    render();
  } else if (choice === 'superset') {
    await sessionSupersetPick(ei);
    return;
  } else if (choice === 'ss-leave') {
    sessionSupersetLeave(ei);
    return;
  } else if (choice === 'howto') {
    openHowTo(ex);
  } else if (choice === 'replace') {
    openAddExSheet({ replaceEi: ei });
  } else if (choice === 'warmup') {
    openWarmupSheet(ei);
  } else if (choice === 'plates') {
    openPlatesSheet(ei, Math.max(0, ex.sets.findIndex(s => !s.done)));
  } else if (choice === 'muscles') {
    if (await declareMusclesFor(ex.name)) render();
  } else if (choice === 'rest') {
    openExRestSheet(restEi(ei), render);
  } else if (choice === 'tempo') {
    await chooseSessionTempo(ei);
  } else if (choice === 'restart') {
    openRest(exRest(xs[restEi(ei)]));
  } else if (choice === 'remove') {
    const done = ex.sets.filter(s => s.done).length;
    if (done && !(await confirmSheet('Retirer l\'exercice ?', `Les ${done} séries validées de cet exercice ne seront pas enregistrées. Le programme ne change pas.`, 'Retirer'))) return;
    const before = clone(xs);
    xs.splice(ei, 1);
    ssNormalize(xs);
    activeSession.lastEi = null; activeSession.lastDone = null;
    editingSet = null;
    render();
    showToast('Exercice retiré', { action: 'Annuler', duration: 5000, onAction: () => restoreSessionExercises(before) });
  }
  persistSession();
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'ex-menu': async (e, el) => {
    await exerciseMenu(parseInt(el.dataset.ei));
  },
  // Nom de l'exercice touché sur sa carte : même fiche que « Comment faire » du menu ⋯
  'ex-howto': (e, el) => {
    const ex = activeSession?.exercises[parseInt(el.dataset.ei)];
    if (ex && hasHowTo(ex)) openHowTo(ex);
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
  'ax-muscle': (e, el) => {
    axMuscle = muscleFilterTap(el, axMuscle);
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
