// ═══════════════════════════════════════════════════════════
//  Programme › Séance et Programme › Exercice
// ═══════════════════════════════════════════════════════════
'use strict';

let editorEditing = false;   // mode Modifier de la liste d'exercices
let exDraft       = null;    // brouillon de l'écran Programme › Exercice (exDraft.route : son écran)
let exQueue       = null;    // réglages enchaînés après un ajout multiple : { cat, ids, pos }

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
    ? { route, name: ex.name, sets: ex.sets, rest: ex.rest ?? null, target: ex.target ?? null, repMax: ex.repMax ?? 12, repMin: ex.repMin ?? null, repFixed: fixedReps(ex) !== null, ...intensDraftOf(ex), measure: ex.measure ?? null, tempo: ex.tempo ?? null, tempoGuide: ex.tempoGuide === true, tempoPrep: tempoPrepOf(ex), muscles: draftMuscles(ex), musclesSecondary: draftSecondary(ex), musclesReset: false, ssLeave: false, grip: cleanGrip(ex.grip), equip: customEquipOf(ex.name) }
    : { route, name: '', sets: 3, rest: null, target: null, repMax: 12, repMin: null, repFixed: false, ...intensDraftOf(null), measure: null, tempo: null, tempoGuide: false, tempoPrep: TEMPO_PREP_DEFAULT, muscles: null, musclesSecondary: null, musclesReset: false, grip: null, equip: null };
  exDraft._init = exDraftSnapshot(exDraft);
  return exDraft;
}
// Réglages du brouillon comparables (sans la route ni l'état initial) : sert à savoir s'il a changé
function exDraftSnapshot(d) { const { route, _init, ...rest } = d; return JSON.stringify(rest); }

// ── Ajout depuis la Bibliothèque (« lib-pick », js/features/library.js) : le réglage suit tout de suite ──
// Retour de Maxence (16/11) : « quand tu ajoutes un exercice, il faut recliquer dessus pour le configurer ».
// Un exercice : Programme › Exercice s'ouvre à sa place, nom rempli et valeurs par défaut (3 séries, 8 à 12 reps,
// repos par défaut) ; « OK » l'ajoute, « Annuler » n'ajoute rien. Plusieurs : tous ajoutés d'un coup avec ces valeurs
// (rien n'est perdu si l'on s'arrête), puis leurs réglages l'un après l'autre (« 1 sur 3 », « Suivant »).
// L'écran du choix est remplacé : OK, Annuler ou le retour ramènent à la séance.
function progPickExercises(cat, names) {
  if (names.length === 1) { openExEditNew(cat, names[0]); return; }
  const list = prog().exercises[cat] || (prog().exercises[cat] = []);
  const ids = [];
  names.forEach(name => {
    if (list.some(e => sameExerciseName(e.name, name))) return;
    const ex = makeExercise(name, 3);
    const known = resolveExId(data.activeProgramme, cat, name);   // supprimé puis repris : même suivi (comme save-ex)
    if (!list.some(e => e.id === known)) ex.id = known;
    list.push(ex);
    ids.push(ex.id);
  });
  if (!ids.length) { showToast('Déjà dans cette séance'); return; }
  recomputePRFromHistory();
  save();
  haptic();
  exDraft = null;
  exQueue = ids.length > 1 ? { cat, ids, pos: 0 } : null;
  navigate(makeRoute('ex-edit', cat, list.findIndex(e => e.id === ids[0])), { replace: true });
}
// Nouvel exercice (« Créer », ou un exercice choisi seul) : brouillon prérempli, puis l'écran à la place du choix
function openExEditNew(cat, name = '') {
  const route = makeRoute('ex-edit', cat);
  exDraft = null; exQueue = null;
  const d = exDraftFor(route);
  name = String(name || '').trim();
  d.name = name.charAt(0).toUpperCase() + name.slice(1);   // tapé en minuscules : « Hip thrust »
  d.muscles = null;
  d._init = exDraftSnapshot(d);   // rien de changé : « Annuler » ferme sans demander
  navigate(route, { replace: true });
}
// Position dans les réglages enchaînés de l'écran affiché ({ pos, n }), null hors de cette suite
function exQueueAt(route) {
  if (!exQueue) return null;
  const i = editExIdxOf(route), ex = i === null ? null : (prog().exercises[editorCatOf(route)] || [])[i];
  return ex && editorCatOf(route) === exQueue.cat && ex.id === exQueue.ids[exQueue.pos] ? { pos: exQueue.pos, n: exQueue.ids.length } : null;
}
// Exercice suivant de la suite (un exercice supprimé entre-temps est sauté) ; false s'il n'y en a plus
function exQueueNext() {
  const list = prog().exercises[exQueue?.cat] || [];
  while (exQueue && ++exQueue.pos < exQueue.ids.length) {
    const i = list.findIndex(e => e.id === exQueue.ids[exQueue.pos]);
    if (i >= 0) { navigate(makeRoute('ex-edit', exQueue.cat, i), { replace: true }); return true; }
  }
  exQueue = null;
  return false;
}

// Matériel d'un exercice créé par la personne (la bibliothèque connaît déjà le sien) : sert aux filtres de matériel
// de la Bibliothèque et de la feuille d'ajout. Rien de choisi : visible avec tous les filtres, comme avant.
function exEquipHtml(d) {
  const name = String(d.name || '').trim();
  if (!name || catalogueEntry(name)) return '';
  return `
        <div class="group-title">Matériel</div>
        <div class="group">
          <div class="cell cell--ctl cell--wrap">
            <div class="ax__equip ex-equip" role="group" aria-label="Matériel">
              ${[{ id: '', label: 'Non précisé' }, ...EQUIPMENT].map(({ id, label }) => `<button class="ax__chip" aria-pressed="${(d.equip || '') === id}" data-action="ex-equip" data-equip="${id}">${esc(label)}</button>`).join('')}
            </div>
          </div>
        </div>`;
}
function refreshExEquip() { const box = $('#exEquip'); if (box && exDraft) box.innerHTML = exEquipHtml(exDraft); }

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
    const best = last ? bestSet(last.ex.sets, ex) : null;
    const plan = canTech(ex) ? intensText(ex, { short: true }) : '';   // technique prescrite (« 1re en cluster »)
    // Morceaux insécables suivis de leur « · » : la ligne se coupe après le point, jamais devant
    const parts = [setsRangeHtml(ex), plan, best ? `<span class="ed-last">dernier ${setTxt(best, ex)}</span>` : ''].filter(Boolean);
    // Le « · » est un séparateur visuel : caché à VoiceOver, qui lit « 4 séries de 8 à 12 reps, dernier … »
    const sub  = parts.map((x, k) => k < parts.length - 1 ? `<span class="ed-seg">${x}<span aria-hidden="true">\u00a0·</span></span>` : x).join(' ');
    const tag  = ssTagHtml(list, i);
    if (editorEditing) {
      return `
        <div class="cell ed-row ed-row--edit" data-i="${i}">
          <button class="ed-minus" data-action="ed-reveal" data-i="${i}" aria-label="Supprimer ${esc(ex.name)}">${icon('minus', 14)}</button>
          <span class="cell__body">
            <span class="cell__title ed-name">${tag}${esc(ex.name)}</span>
            ${exMusclesSubHtml(ex)}
            ${gripSubHtml(ex)}
            <span class="cell__sub">${sub}</span>
            ${coachExConsigneSub(data.activeProgramme, ex)}
          </span>
          <button class="ed-del" data-action="del-ex" data-i="${i}">Supprimer</button>
          <button class="ed-handle" data-action="reorder-menu" aria-label="Déplacer ${esc(ex.name)}">${icon('line.3.horizontal', 22)}</button>
        </div>`;
    }
    // Vignette du muscle principal, comme la liste de Progrès ; pas en mode Modifier, où ⊖ et ≡ prennent sa place
    const main = exerciseMuscles(ex).primary?.[0];
    return `
      <button class="cell cell--nav ed-row" data-action="edit-ex" data-i="${i}">
        ${progRowThumbHtml(isMuscleId(main) ? main : null)}
        <span class="cell__body">
          <span class="cell__title ed-name">${tag}${esc(ex.name)}</span>
          ${exMusclesSubHtml(ex)}
          ${gripSubHtml(ex)}
          <span class="cell__sub">${sub}</span>
          ${coachExConsigneSub(data.activeProgramme, ex)}
        </span>
        ${icon('chevron.right', 16)}
      </button>`;
  }).join('');
  const cd = getCooldown(cat);
  return `
    <div class="view editor view--grouped">
      ${navBar({ title: esc(sessionTitle(cat)), right: list.length ? `<button class="navbar__text ${editorEditing ? 'navbar__text--bold' : ''}" data-action="toggle-edit-mode">${editorEditing ? 'OK' : 'Modifier'}</button>` : '' })}
      <div class="scr">
        ${coachEditorConsigneHtml(data.activeProgramme)}
        <div class="group-title">Exercices</div>
        <div class="group ed-list">
          ${rows || '<div class="cell"><span class="cell__sub">Aucun exercice pour l\'instant</span></div>'}
          <button class="cell cell--action" data-action="add-ex">${icon('plus', 20)}<span>Ajouter un exercice</span></button>
          ${list.length >= 2 ? `<button class="cell cell--action" data-action="ed-superset">${icon('link', 20)}<span>Créer un superset</span></button>` : ''}
        </div>
        ${list.length >= 2 ? `<div class="group-foot">Superset : de 2 à ${SS_MAX} exercices enchaînés sans repos.</div>` : ''}
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
            <span class="cell__body"><span class="cell__title">Nom et description</span></span>
            ${icon('chevron.right', 16)}
          </button>` : ''}
        </div>
        <div class="group-foot">Récupération : délai avant que la séance soit de nouveau prête.</div>
        ${isUserProg(data.activeProgramme) ? `
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="delete-custom-session" data-id="${esc(cat)}">Supprimer la séance</button>
        </div>` : ''}
      </div>
    </div>`;
}

// Programme › Exercice : nom, séries, repos, objectif, haut de fourchette
// Mesure des séries (js/data/measures.js) : choisie à la main, sinon d'après le nom
function exMeasureBtns(d) {
  const cur = measureOf({ name: d.name, measure: d.measure });
  return Object.entries(MEASURES).map(([k, M]) =>
    `<button class="segmented__btn ${cur === k ? 'segmented__btn--active' : ''}" aria-pressed="${cur === k}" data-action="ex-measure" data-m="${k}">${M.label}</button>`).join('');
}
// Tempo (js/data/tempo.js) : préréglages, saisie libre et phrase en clair ; répétitions seulement
function exTempoHtml(d) {
  if (measureOf({ name: d.name, measure: d.measure }) !== 'reps') return '';
  const t = parseTempo(d.tempo), cur = formatTempo(t);
  return `
        <div class="group-title">Tempo</div>
        <div class="group">
          <div class="cell cell--ctl cell--wrap">
            <div class="ax__equip tempo__presets" role="group" aria-label="Tempo">
              ${[{ tempo: '', label: 'Aucun' }, ...TEMPO_PRESETS].map(p => `<button class="ax__chip" aria-pressed="${cur === p.tempo}" data-action="ex-tempo" data-tempo="${p.tempo}">${p.label}${p.tempo ? ` <span class="num">${shortTempo(p.tempo)}</span>` : ''}</button>`).join('')}
            </div>
          </div>
          <label class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Personnalisé</span></span>
            <input type="text" id="exTempoIn" class="field field--num" autocomplete="off" inputmode="text" enterkeyhint="done" maxlength="${TEMPO_INPUT_MAX}"
                   value="${esc(shortTempo(cur))}" placeholder="Ex. 3-1-1" aria-label="Tempo personnalisé, par exemple 3-1-1">
          </label>
          ${t ? `<div class="cell cell--ctl cell--wrap">
            <div class="segmented seg-full" role="group" aria-label="Pendant la série">
              ${[[false, 'Rappel seulement'], [true, 'Guidé au son']].map(([g, label]) => `<button class="segmented__btn ${d.tempoGuide === g ? 'segmented__btn--active' : ''}" aria-pressed="${d.tempoGuide === g}" data-action="ex-tempo-guide" data-guide="${g}">${label}</button>`).join('')}
            </div>
          </div>` : ''}
          ${t && d.tempoGuide ? `<div class="cell cell--ctl cell--wrap">
            <span class="cell__body"><span class="cell__title">Préparation</span></span>
            <div class="segmented seg-full" role="group" aria-label="Temps de préparation avant la première rep">
              ${TEMPO_PREP_CHOICES.map(s => `<button class="segmented__btn ${d.tempoPrep === s ? 'segmented__btn--active' : ''}" aria-pressed="${d.tempoPrep === s}" data-action="ex-tempo-prep" data-prep="${s}">${s} s</button>`).join('')}
            </div>
          </div>` : ''}
        </div>
        <div class="group-foot">${t ? `${esc(tempoSentence(t, d.name))}. Plus lent, c'est plus dur : baisse la charge.` : 'En secondes : descente, arrêt en bas, montée. X = explosif.'}</div>`;
}
function refreshExTempo() { const box = $('#exTempo'); if (box && exDraft) box.innerHTML = exTempoHtml(exDraft); }

function applyDraftMeasure(ex, draft) {
  if (draft?.measure && MEASURES[draft.measure]) ex.measure = draft.measure; else delete ex.measure;
  const tempo = measureOf(ex) === 'reps' ? formatTempo(parseTempo(draft?.tempo)) : '';
  // Guidage au son : stocké seulement quand il est choisi (le rappel seul est le défaut), avec sa préparation
  const guide = !!(tempo && draft?.tempoGuide === true);
  applyTempo(ex, tempo, guide, draft);
  if (activeSession) activeSession.exercises.forEach(e => { if (e.exId === ex.id) applyTempo(e, tempo, guide, draft); });
  // Séance en cours : l'exercice suit le nouveau choix tout de suite
  if (activeSession) activeSession.exercises.forEach(e => { if (e.exId === ex.id) e.measure = measureOf(ex); });
}

// Progression selon la mesure. Répétitions : objectif de charge (courbe de Progrès), puis Fourchette
// (bas et haut, puce « +2,5 kg » de la séance au haut, retour au bas) ou Fixe (« 4 × 12 » : un seul
// nombre, la charge monte quand toutes les séries l'atteignent ; repFixed, fixedReps de js/data/goals.js).
// Les deux modes partagent le champ #exRepMax : passer de l'un à l'autre garde le nombre. Durée : l'objectif de chaque série est la durée de la dernière fois,
// vers laquelle décompte le ▶ ; ni charge ni fourchette. Cardio : rien. target et repMax restent
// enregistrés tels quels hors répétitions (save-ex), pour retrouver les réglages si l'on revient aux reps.
function exProgressionHtml(d) {
  const m = measureOf({ name: d.name, measure: d.measure });
  if (m === 'time') return `
        <div class="group-title">Progression</div>
        <div class="group">
          <div class="cell">
            <span class="cell__body">
              <span class="cell__title">Objectif</span>
              <span class="cell__sub">Durée de la dernière fois, série par série</span>
            </span>
          </div>
        </div>
        <div class="group-foot">En séance, ▶ décompte jusqu'à cette durée. Ajoute quelques secondes pour progresser.</div>`;
  if (m !== 'reps') return '';
  const target = d.targetText ?? (d.target ? fmtW(d.target) : '');
  const repMax = d.repMaxText ?? String(d.repMax ?? 12);
  const repMin = d.repMinText ?? (d.repMin ? String(d.repMin) : '');
  const fixed = d.repFixed === true;
  const minHint = Math.max(1, (num(repMax, 1, 100, true) ?? 12) - 4);   // bas laissé vide : 4 sous le haut
  const modes = [[false, 'Fourchette'], [true, 'Fixe']].map(([f, label]) =>
    `<button class="segmented__btn ${fixed === f ? 'segmented__btn--active' : ''}" aria-pressed="${fixed === f}" data-action="ex-rep-mode" data-fixed="${f}">${label}</button>`).join('');
  const fields = fixed ? `
          <label class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Reps par série</span></span>
            <span class="field-suffix">
              <input type="text" inputmode="numeric" id="exRepMax" class="field field--num" autocomplete="off"
                     value="${esc(repMax)}" aria-label="Reps par série, toujours le même nombre">
              <span>reps</span>
            </span>
          </label>` : `
          <label class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Bas de fourchette</span></span>
            <span class="field-suffix">
              <input type="text" inputmode="numeric" id="exRepMin" class="field field--num" autocomplete="off"
                     value="${esc(repMin)}" placeholder="${minHint}" aria-label="Bas de fourchette de reps">
              <span>reps</span>
            </span>
          </label>
          <label class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Haut de fourchette</span></span>
            <span class="field-suffix">
              <input type="text" inputmode="numeric" id="exRepMax" class="field field--num" autocomplete="off"
                     value="${esc(repMax)}" aria-label="Haut de fourchette de reps">
              <span>reps</span>
            </span>
          </label>`;
  const sets = d.sets ?? 3, n = num(repMax, 1, 100, true) ?? 12;
  return `
        <div class="group-title">Progression</div>
        <div class="group">
          <label class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Objectif</span></span>
            <span class="field-suffix">
              <input type="text" inputmode="decimal" id="exTarget" class="field field--num" autocomplete="off"
                     value="${esc(target)}" placeholder="—" aria-label="Objectif en ${unitLbl()}">
              <span>${unitLbl()}</span>
            </span>
          </label>
          <div class="cell cell--ctl cell--wrap">
            <div class="segmented seg-full" role="group" aria-label="Répétitions">${modes}</div>
          </div>${fields}
        </div>
        <div class="group-foot">${fixed
    ? `Le même nombre à chaque série : <span class="num">${setsRepsHtml({ sets, repMax: n, repFixed: true, measure: 'reps' })}</span>. Quand toutes les séries l'atteignent, l'app propose plus de charge.`
    : 'Quand toutes les séries atteignent le haut, l\'app propose plus de charge. Tu repars alors du bas. Laisse le bas vide pour 4 reps sous le haut.'}</div>`;
}
function refreshExProgression() {
  const box = $('#exProg');
  if (!box || !exDraft) return;
  // Saisie en cours gardée si la rubrique disparaît puis revient (Répétitions → Durée → Répétitions)
  const t = $('#exTarget'), r = $('#exRepMax'), rn = $('#exRepMin');
  if (t) exDraft.targetText = t.value;
  if (r) exDraft.repMaxText = r.value;
  if (rn) exDraft.repMinText = rn.value;
  box.innerHTML = exProgressionHtml(exDraft);
}

// Programme › Exercice d'un superset : avec qui, et « Retirer » (appliqué par OK, comme le reste)
function exSupersetHtml(i, d) {
  const list = prog().exercises[editorCatOf()] || [];
  const g = ssGroupOf(list, i);
  if (!g) return '';
  const others = g.filter(k => k !== i).map(k => list[k].name).join(', ');
  return `
        <div class="group-title">${ssKind(g.length)} ${ssTags(list)[i][0]}</div>
        <div class="group">
          <div class="cell cell--ctl">
            <span class="cell__body">
              <span class="cell__title">${d.ssLeave ? 'Retiré à l\'enregistrement' : `Avec ${esc(others)}`}</span>
            </span>
            <button class="ed-ss-btn" data-action="ex-ss-leave" aria-pressed="${d.ssLeave}">${d.ssLeave ? 'Garder' : 'Retirer'}</button>
          </div>
        </div>
        <div class="group-foot">Enchaînés sans repos. Le repos vient après le dernier exercice du tour.</div>`;
}

function renderExEdit() {
  const editExIdx = editExIdxOf();
  const isEdit = editExIdx !== null;
  const d = exDraftFor(currentRoute());
  const restVal = d.rest ?? data.defaultRest;
  const q = exQueueAt(currentRoute());   // ajout multiple : « 2 sur 3 », « Suivant » jusqu'au dernier
  const more = q && q.pos < q.n - 1;
  return `
    <div class="view ex-edit view--grouped">
      ${navBar({ title: q ? `${q.pos + 1} sur ${q.n}` : isEdit ? 'Exercice' : 'Nouvel exercice',
          left: `<button class="navbar__text" data-action="cancel-ex">Annuler</button>`,
          right: `<button class="navbar__text navbar__text--bold" data-action="save-ex"${more ? ' aria-label="Suivant : enregistrer et régler l\'exercice suivant"' : ''}>${more ? 'Suivant' : 'OK'}</button>` })}
      <div class="scr">
        <div class="group-title">Nom</div>
        <div class="group">
          <div class="cell cell--field">
            <input type="text" id="exName" class="field" value="${esc(d.name)}" maxlength="${EX_NAME_MAX}" placeholder="Ex : Curl biceps haltères"
                   autocomplete="off" enterkeyhint="done" aria-label="Nom de l'exercice">
          </div>
        </div>
        <div id="exAlias">${aliasNoteHtml(d.name, 'group-foot ex-alias')}</div>
        ${renderExEditMuscles(d)}
        <div id="exEquip">${exEquipHtml(d)}</div>
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
        <div class="group-title">Mesure</div>
        <div class="group">
          <div class="cell cell--ctl cell--wrap">
            <div class="segmented seg-full seg-fit" role="group" aria-label="Mesure des séries" id="exMeasure">
              ${exMeasureBtns(d)}
            </div>
          </div>
        </div>
        <div class="group-foot">Durée pour le gainage ou la chaise, cardio pour la distance. Par défaut, choisie d'après le nom.</div>
        <div id="exGrip">${exGripHtml(d)}</div>
        <div id="exTempo">${exTempoHtml(d)}</div>
        <div id="exProg">${exProgressionHtml(d)}</div>
        <div id="exIntens">${exIntensHtml(d)}</div>
        ${isEdit ? exSupersetHtml(editExIdx, d) : ''}
        ${isEdit ? `
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="del-ex" data-i="${editExIdx}">Supprimer l'exercice</button>
        </div>
        <div class="group-foot">L'historique de cet exercice est conservé.</div>` : ''}
      </div>
    </div>`;
}

// Glisser pour réordonner les exercices (poignée ≡ du mode Modifier, js/ui/reorder.js)
makeReorderable({
  view: 'editor', list: '.ed-list', row: '.ed-row', handle: '.ed-handle',
  onMove: (from, to) => {
    const arr = prog().exercises[editorCatOf()];
    if (!arr) return;
    // Superset : un exercice du groupe glissé hors de lui en sort ; un exercice déposé au milieu d'un
    // groupe passe juste après lui (js/data/supersets.js, ssGather)
    const moved = arr[from], id = ssId(moved);
    moveItem(arr, from, to);
    const i = arr.indexOf(moved);
    const left = id && ssId(arr[i - 1]) !== id && ssId(arr[i + 1]) !== id;
    if (left) delete moved.ss;
    ssNormalize(ssGather(arr));
    save();
    if (left) { render(); showToast('Retiré du superset'); }
    else if (arr.indexOf(moved) !== to) render();
  },
  nameOf: i => prog().exercises[editorCatOf()]?.[i]?.name || '',
  // Monter / Descendre (VoiceOver) : comme le menu de la séance, un superset n'est jamais coupé (js/data/supersets.js)
  step: (i, dir, dry) => {
    const cat = editorCatOf(), arr = prog().exercises[cat];
    const moved = arr && ssMove(arr, i, dir);
    if (!moved) return -1;
    if (!dry) { const ex = arr[i]; arr.splice(0, arr.length, ...moved); save(); return arr.indexOf(ex); }
    return moved.indexOf(arr[i]);
  },
});

// Nom saisi dans Programme › Exercice : gardé dans le brouillon, puis les muscles reconnus
// suivent la frappe (muscles.js), dans cet ordre explicite
document.addEventListener('input', e => {
  if (e.target.id !== 'exName' || !exDraft) return;
  exDraft.name = e.target.value;
  const alias = $('#exAlias');
  if (alias) alias.innerHTML = aliasNoteHtml(exDraft.name, 'group-foot ex-alias');
  refreshExEditMuscles();
  refreshExGrip();   // la prise proposée dépend du nom (js/features/grip-ui.js)
  refreshExEquip();  // matériel : exercices hors bibliothèque seulement
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

// Objectif de charge refusé : 0 n'est pas un objectif (le champ vide l'est : « aucun objectif »), d'où un message
// différent de weightMsg (« entre 0 et 1000 kg » laissait croire que 0 passait)
function targetMsg() {
  return `Au-dessus de 0 ${unitLbl()} (${data.unit === 'lbs' ? '2205' : '1000'} ${unitLbl()} au plus), ou laisse vide`;
}

registerActions({
  'ex-measure': (e, el) => {
    if (!exDraft || !MEASURES[el.dataset.m]) return;
    exDraft.measure = el.dataset.m;
    const box = $('#exMeasure');
    if (box) box.innerHTML = exMeasureBtns(exDraft);
    refreshExTempo();
    refreshExProgression();
    refreshExGrip();
    refreshExIntens();   // technique : répétitions seulement (js/features/programme-intensif.js)
    haptic();
  },
});

registerActions({
  'ex-tempo': (e, el) => {
    if (!exDraft) return;
    exDraft.tempo = el.dataset.tempo || null;
    refreshExTempo();
    haptic();
  },
  'ex-tempo-prep': (e, el) => {
    if (!exDraft) return;
    exDraft.tempoPrep = Number(el.dataset.prep);
    refreshExTempo();
    haptic();
  },
  // Les deux usages du tempo : simple rappel sous l'exercice (défaut), ou ▶ qui bipe chaque phase
  'ex-tempo-guide': (e, el) => {
    if (!exDraft) return;
    exDraft.tempoGuide = el.dataset.guide === 'true';
    refreshExTempo();
    haptic();
  },
});

// Saisie libre du tempo : lue à la sortie du champ (la phrase et les préréglages suivent)
document.addEventListener('change', e => {
  if (e.target.id !== 'exTempoIn' || !exDraft) return;
  const t = parseTempo(e.target.value);
  if (e.target.value.trim() && !t) { flagInvalid(e.target, 'Tempo : 3 ou 4 chiffres, ex. 3-1-1'); return; }
  exDraft.tempo = t ? formatTempo(t) : null;
  refreshExTempo();
});

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
  // Même écran que la Bibliothèque (groupes illustrés, recherche, matériel), en mode choix
  'add-ex': () => openLibPick(editorCatOf()),
  'ex-equip': (e, el) => {
    if (!exDraft) return;
    exDraft.equip = el.dataset.equip || null;
    refreshExEquip();
    $(`#exEquip [data-equip="${el.dataset.equip}"]`)?.focus({ preventScroll: true });
    haptic();
  },
  'ed-superset': () => editorSupersetCreate(editorCatOf()),
  'ex-ss-leave': () => {
    if (!exDraft) return;
    exDraft.ssLeave = !exDraft.ssLeave;
    render();
    haptic();
  },
  'ex-sets': (e, el) => {
    if (!exDraft) return;
    exDraft.sets = Math.max(1, Math.min(10, exDraft.sets + parseInt(el.dataset.d)));
    $('#exSetsVal').textContent = exDraft.sets;
    if (exDraft.repFixed) refreshExProgression();   // « 4 × 12 » du bas de la rubrique
    if (TECHS[exDraft.intensTech]?.sub) refreshExIntens();   // « Série 2 », cases de « Plusieurs séries »
    haptic();
  },
  // Reps en fourchette (« 8 à 12 ») ou fixes (« 4 × 12 ») : le nombre saisi est gardé d'un mode à l'autre
  'ex-rep-mode': (e, el) => {
    if (!exDraft) return;
    const fixed = el.dataset.fixed === 'true';
    if (exDraft.repFixed === fixed) return;
    exDraft.repFixed = fixed;
    refreshExProgression();
    haptic();
  },
  'ex-rest':      setDraftRest,
  'ex-rest-step': setDraftRest,
  'del-ex': async (e, el) => {
    const i    = parseInt(el.dataset.i);
    const list = prog().exercises[editorCatOf()];
    const name = list[i].name;
    if (!(await confirmSheet(`Supprimer « ${name} » ?`, 'L\'historique de cet exercice est conservé.', 'Supprimer l\'exercice'))) return;
    const ssBefore = new Map(list.map(x => [x, x.ss]));   // « Annuler » rend aussi le superset dont il faisait partie
    const [removed] = list.splice(i, 1);
    ssNormalize(list);
    save();
    if (currentView() === 'ex-edit') { exDraft = null; exQueue = null; goBack(); } else render();
    showToast(`« ${name} » supprimé`, { action: 'Annuler', duration: 5000, onAction: () => {
      if (list.includes(removed)) return;
      list.splice(Math.min(i, list.length), 0, removed);
      list.forEach(x => { if (ssBefore.get(x) !== undefined) x.ss = ssBefore.get(x); });
      ssNormalize(ssGather(list));
      save(); render();
    } });
  },
  // Annuler la fiche : confirmation seulement si quelque chose a changé
  'cancel-ex': async () => {
    const fieldsChanged = ['#exName', '#exTarget', '#exRepMax', '#exTempoIn'].some(sel => { const f = $(sel); return f && f.value !== f.defaultValue; });
    const draftChanged = exDraft && exDraft._init !== exDraftSnapshot(exDraft);
    if ((fieldsChanged || draftChanged) && !(await confirmSheet('Abandonner les modifications ?', 'Les réglages de cet exercice ne seront pas enregistrés.', 'Abandonner'))) return;
    // Ajout multiple : les exercices restants gardent leurs valeurs par défaut
    exDraft = null; exQueue = null;
    goBack();
  },
  'save-ex': async () => {
    const route = currentRoute(), editorCat = editorCatOf(route), editExIdx = editExIdxOf(route);
    exDraftFor(route);
    const nameIn = $('#exName'), targetIn = $('#exTarget'), repIn = $('#exRepMax'), repMinIn = $('#exRepMin');
    // Nom déjà plus long que le champ (fiche d'avant le maxlength) : gardé tel quel, sa clé de records en dépend
    const name = nameIn?.value.trim();
    if (!name || !hasVisible(name)) { flagInvalid(nameIn, 'Entre un nom'); return; }
    const sets = exDraft?.sets ?? 3;
    const rest = exDraft?.rest ?? null;
    // Hors répétitions, la rubrique n'est pas affichée : objectif et fourchette gardent leur valeur
    let target = exDraft?.target ?? null, repMax = exDraft?.repMax ?? 12, repMin = exDraft?.repMin ?? null;
    const repFixed = exDraft?.repFixed === true;   // reps fixes : un seul nombre, jamais de bas
    if (targetIn) {
      const targetRaw = targetIn.value.trim();
      if (targetRaw && (!weightOk(targetRaw) || !(parseFloat(storeW(targetRaw)) > 0))) { flagInvalid(targetIn, targetMsg()); return; }
      target = targetRaw ? parseFloat(storeW(targetRaw)) : null;
    }
    if (repIn) {
      const repRaw = repIn.value.trim();
      repMax = repRaw ? num(repRaw, 1, 100, true) : 12;
      if (repMax === null) { flagInvalid(repIn, 'Reps entre 1 et 100'); return; }
    }
    if (repFixed) repMin = null;
    else if (repMinIn) {
      const raw = repMinIn.value.trim();
      repMin = raw ? num(raw, 1, 99, true) : null;
      if (raw && (repMin === null || repMin >= repMax)) { flagInvalid(repMinIn, `Bas de fourchette sous ${repMax}`); return; }
      // Bas vide : 4 sous le haut (le 12 par défaut garde son sens d'avant, de 8 à 12 sans rien écrire).
      // Sans quoi un haut seul hors 12 se relirait en reps fixes (fixedReps, ancien format)
      if (!raw && repMax !== 12) {
        if (repMax < 2) { flagInvalid(repIn, 'Fourchette : 2 reps au moins'); return; }
        repMin = Math.max(1, repMax - 4);
      }
    }
    const tempoIn = $('#exTempoIn');
    if (tempoIn && exDraft) {
      const raw = tempoIn.value.trim(), t = parseTempo(raw);
      if (raw && !t) { flagInvalid(tempoIn, 'Tempo : 3 ou 4 chiffres, ex. 3-1-1'); return; }
      exDraft.tempo = t ? formatTempo(t) : null;
    }
    const list = prog().exercises[editorCat] || (prog().exercises[editorCat] = []);
    if (editExIdx !== null && list[editExIdx]) {
      const ex = list[editExIdx];
      if (ex.name !== name) {
        // L'exId garde le lien avec l'historique ; on propose aussi d'y reprendre le nouveau nom
        const progKey = data.activeProgramme;
        const touched = (data.history || []).filter(h => entryProg(h) === progKey && h.category === editorCat
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
      if (repMin) ex.repMin = repMin; else delete ex.repMin;
      if (repFixed) ex.repFixed = true; else delete ex.repFixed;
      applyDraftMeasure(ex, exDraft);
      // Technique et séries choisies (js/features/programme-intensif.js) : en répétitions seulement, mesure et séries
      // tout juste appliquées
      applyDraftIntens(ex, exDraft);
      applyDraftMuscles(ex, exDraft);
      applyDraftGrip(ex, exDraft);
      if (exDraft?.ssLeave) editorSupersetLeave(editorCat, editExIdx);
    } else {
      const ex = makeExercise(name, sets);
      // Un exercice déjà présent dans l'historique (supprimé puis recréé) retrouve son identifiant
      const known = resolveExId(data.activeProgramme, editorCat, name);
      if (!list.some(e => e.id === known)) ex.id = known;
      ex.target = target;
      ex.rest   = rest;
      ex.repMax = repMax;
      if (repMin) ex.repMin = repMin; else delete ex.repMin;
      if (repFixed) ex.repFixed = true; else delete ex.repFixed;
      applyDraftMeasure(ex, exDraft);
      // Technique et séries choisies (js/features/programme-intensif.js) : en répétitions seulement, mesure et séries
      // tout juste appliquées
      applyDraftIntens(ex, exDraft);
      applyDraftMuscles(ex, exDraft);
      applyDraftGrip(ex, exDraft);
      list.push(ex);
      recomputePRFromHistory();
    }
    setCustomEquip(name, exDraft?.equip);
    const queued = !!exQueueAt(route);
    exDraft = null; save();
    if (queued && exQueueNext()) return;
    exQueue = null;
    goBack();
  },
});
