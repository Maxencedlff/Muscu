// ═══════════════════════════════════════════════════════════
//  Séance en cours : démarrage, tableau des séries, validation
// ═══════════════════════════════════════════════════════════
'use strict';

let editingSet = null;  // { ei, si, weight?, reps? } — série validée rouverte en édition sur place, avec la saisie en cours
let persistWarned = false; // un seul avertissement « stockage plein » par séance

// ── Annuler en ligne : jamais de toast flottant en séance ───
// Panels de la vague 3 (17 personas sur 20) : posé en haut, au milieu ou en bas, le toast couvrait toujours quelque
// chose (nom de l'exercice, objectif, « + Série », la barre). En séance, ce qui s'annule l'est à sa place, 6 s :
//  - une série (validée, modifiée, technique posée) : « Annuler » dans sa colonne « Avant » ;
//  - un exercice (Plus tard, Faire maintenant, remplacé, échauffement ajouté, mini-série validée) : une ligne
//    « Mis en dernier · Annuler » juste au-dessus de sa carte ; retiré : la même ligne là où était sa carte.
// Rien ne recouvre rien : la ligne prend sa place dans la liste. VoiceOver annonce l'état (announce, aria-live).
// target : { ex, si } (série), { ex } (exercice), { at } (exercice retiré, sa position) ; sans onAction, le texte seul.
const SESS_UNDO_MS = 6000;
let sessUndo = null;
function sessionUndo(text, { target = {}, label = 'Annuler', onAction = null, state = '', ms = onAction ? SESS_UNDO_MS : 3000 } = {}) {
  clearTimeout(sessUndo?.timer);
  document.querySelector('.toast')?.remove();
  sessUndo = { ...target, text, label, onAction, state };
  const inSession = () => typeof currentView === 'function' && currentView() === 'session';
  // Retenu tant que VoiceOver (ou le clavier) est sur « Annuler » : encore 3 s après (WCAG 2.2.1)
  const expire = () => {
    if (document.activeElement?.dataset?.action === 'sess-undo') { sessUndo.timer = setTimeout(expire, 3000); return; }
    sessUndo = null;
    if (inSession()) render();
  };
  sessUndo.timer = setTimeout(expire, ms);
  announce(onAction ? `${text}. ${label} disponible` : text);
  if (inSession()) render();
}
function clearSessionUndo() { clearTimeout(sessUndo?.timer); sessUndo = null; }
const undoForSet = (ex, si) => (sessUndo && sessUndo.ex === ex && sessUndo.si === si ? sessUndo : null);
// Colonne « Avant » d'une série qui vient de changer : « Annuler » (ou l'état, « Modifiée »), à la même place à chaque fois
function setUndoHtml(u) {
  return u.onAction ? `<button class="set-undo" data-action="sess-undo" aria-label="${esc(u.text)}, annuler">Annuler</button>`
    : `<span class="set-prev set-undo--state" aria-hidden="true">${esc(u.state || '')}</span>`;
}
// Ligne au-dessus de la carte d'un exercice (ou à la place d'une carte retirée)
function exUndoHtml(u) {
  return `<div class="ex-undo" role="status"><span class="ex-undo__text">${esc(u.text)}</span>${u.onAction ? `<button class="ex-undo__btn" data-action="sess-undo">${esc(u.label)}</button>` : ''}</div>`;
}
function exUndoBefore(block, xs) {
  const u = sessUndo;
  if (!u || u.si !== undefined) return '';
  if (u.ex && block.some(i => xs[i] === u.ex)) return exUndoHtml(u);
  if (u.at !== undefined && !u.ex && block[0] === u.at) return exUndoHtml(u);
  return '';
}
const openDone = new WeakSet(); // exercices terminés dépliés

// Série à faire : charge et reps reprises de src, « Avant » : la même série la dernière fois
function plannedSet(src, prev) {
  return {
    weight: src?.weight ?? '',
    reps:   src?.reps   ?? '',
    ...(src?.dist ? { dist: src.dist } : {}),
    plannedWeight: src?.weight ?? '',
    // machine : réglages de la dernière fois, point de départ du chrono (machineStart)
    // tech, sub : technique de la dernière fois (js/data/intensif.js), « Avant » de ses sous-séries
    prev:   prev ? { weight: prev.weight, reps: prev.reps, ...(prev.dist ? { dist: prev.dist } : {}), ...(prev.machine ? { machine: prev.machine } : {}), ...techFields(prev) } : null,
    done:   false,
  };
}

// Séries d'un exercice pré-remplies série par série avec la dernière séance (sinon la dernière série faite).
// Les séries d'échauffement de la dernière fois ne comptent pas (js/data/warmup.js) : la 1re série de
// travail se compare à la 1re série de travail
function buildSets(progKey, cat, exLike, n, fallback = {}) {
  const prevSets = workSets(lastPerf(progKey, cat, exLike)?.ex.sets);
  return Array.from({ length: n }, (_, i) => {
    const src = prevSets[i] ?? prevSets.at(-1) ?? { weight: fallback.lastWeight || '', reps: fallback.lastReps || '' };
    return plannedSet(capReps(src, exLike), prevSets[i]);
  });
}

// Reps reprises de la dernière fois, ramenées au haut de la fourchette quand il est réglé : un programme
// passé à « 5 reps » ne propose plus les 8 reps d'avant (panel du 07/11). Le 12 par défaut (écrit par
// l'éditeur même sans réglage) ne coupe rien.
function capReps(src, exLike) {
  const max = measureOf(exLike) === 'reps' ? explicitRepMax(exLike) : null;
  return max && parseInt(src.reps) > max ? { ...src, reps: String(max) } : src;
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
    // Commencée avec le droit d'écrire : « Terminer » l'enregistrera même si l'accès prend fin pendant
    // la séance (le serveur l'accepte dans sa grâce bornée, js/features/paywall-ui.js)
    writeOk: typeof canWrite !== 'function' || canWrite(),
    exercises: exList.map(ex => ({ exId: ex.id, name: ex.name, measure: measureOf(ex), ...(ex.tempo ? { tempo: ex.tempo } : {}), ...(ex.tempoGuide === true ? { tempoGuide: true, tempoPrep: tempoPrepOf(ex) } : {}), ...(ssId(ex) ? { ss: ex.ss } : {}), ...(cleanGrip(ex.grip) ? { grip: cleanGrip(ex.grip) } : {}), sets: buildSets(progKey, cat, ex, ex.sets, ex) })),
  };
  ssNormalize(activeSession.exercises);
  // Technique prescrite par le programme (coach ou soi : js/data/intensif.js), posée sur ses séries
  activeSession.exercises.forEach(ex => applyIntensPlan(ex, sessExData(ex)?.intens));
  persistSession();
  otaSessionChanged();   // une mise à jour en file attend la fin de la séance (js/app/live-update.js)
  routeTo('session');
  requestWakeLock();
}

// Séance en cours enregistrée avec son repos, pour survivre à la fermeture de l'app. L'Apple Watch
// suit chaque sauvegarde (js/features/watch.js : rien n'est envoyé si rien n'a changé).
function persistSession() {
  const saved = writeSession(restSnapshot());
  syncWatch();
  if (saved || !activeSession || persistWarned) return;
  persistWarned = true;
  showToast('Stockage plein : la séance n\'est plus sauvegardée', { error: true });
}

function endSession() {
  cancelEffort();
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
  otaSessionChanged();   // séance finie : une mise à jour en file peut de nouveau s'installer
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

// Objectif de reps (ou de durée) d'une série : la même série la dernière fois, sinon l'objectif par
// défaut de l'exercice (premier essai). Montré en gris dans la case vide, pris si elle le reste.
function setGoal(ex, s) {
  const d = sessExData(ex);
  return String(s?.prev?.reps || defaultGoal(measureOf(ex), d?.repMin ?? d?.repMax));
}
// Fourchette de reps du programme (« 8–12 reps ») si un bas est réglé, « 5 reps » si seul le haut l'est
// (hors 12 par défaut : explicitRepMax), sinon '' ; même règle que l'écran du coach (coachExPlanParts)
function repRangeText(ex) {
  const d = sessExData(ex);
  if (measureOf(ex) !== 'reps' || !d) return '';
  if (d.repMin) return `${d.repMin}–${d.repMax ?? 12} reps`;
  return explicitRepMax(d) ? `${explicitRepMax(d)} reps` : '';
}

function exRest(ex) {
  return sessExData(ex)?.rest ?? ex?.rest ?? data.defaultRest;
}
// Exercice dont le repos compte pour ei : le dernier de son superset (repos après chaque tour), sinon lui-même
function restEi(ei) {
  return ssGroupOf(activeSession.exercises, ei)?.at(-1) ?? ei;
}

// Série courante : la première non faite de l'exercice en cours (de son superset, tour par tour),
// sinon la première non faite de la séance
function currentSet() {
  if (!activeSession) return null;
  const xs   = activeSession.exercises;
  const pick = ei => { const si = xs[ei]?.sets.findIndex(s => !s.done) ?? -1; return si >= 0 ? { ei, si } : null; };
  const next = block => (block.length > 1 ? ssNextSet(xs, block, activeSession.lastEi) : pick(block[0]));
  const last = activeSession.lastEi;
  if (Number.isInteger(last) && xs[last]) { const c = next(ssGroupOf(xs, last) || [last]); if (c) return c; }
  for (const block of ssBlocks(xs)) { const c = next(block); if (c) return c; }
  return null;
}

// Série suivante en deux morceaux : { name: « Développé incliné », tail: « S1 · 30 kg × 10 » } (tail = step + load), null sans.
// Pendant la pause d'un rest-pause ou d'un cluster, c'est la sous-série qui suit : « Reprise 1 · 70 kg × 4 »
// (js/features/session-intensif.js), sub: true. La barre de repos coupe le nom, jamais la série ; pendant une
// pause de technique, elle tait le nom (l'exercice qu'on vient de faire) : « Ensuite : Reprise 1 · 32 kg × 4 »
function nextSetParts() {
  const sub = techNextSub();
  const cur = sub || currentSet();
  if (!cur) return null;
  const ex = activeSession.exercises[cur.ei], s = sub ? sub.set : ex.sets[cur.si];
  const m = measureOf(ex), kind = loadKind(ex);
  // Sous-série sans objectif de reps (pas faite la dernière fois) : sa charge seule, « Reprise 1 · 70 kg »
  const load = String(s.reps ?? '') !== '' ? ` · ${m !== 'reps' || kind !== 'charge' ? measureSetTxt(s, m, kind) : loadTimes(s.weight) + s.reps}`
    : sub && hasLoad(s.weight) ? ` · ${fmtW(s.weight, { plain: true })} ${unitLbl()}` : '';
  const step = sub ? sub.label : `S${cur.si + 1}`;
  return { name: ex.name, step, load, tail: step + load, sub: !!sub };
}
// « Développé incliné · S1 · 30 kg × 10 »
function nextSetText() {
  const p = nextSetParts();
  return p ? `${p.name} · ${p.tail}` : '';
}

// Puce « ↑ +2,5 kg » : toutes les séries de la dernière fois ont atteint le haut de la fourchette
function bumpReady(ex) {
  if (ex.bumped || ex.sets.every(s => s.done) || measureOf(ex) !== 'reps' || isAssisted(ex)) return false;
  const work  = workSets(ex.sets);
  const prevs = work.map(s => s.prev).filter(Boolean);
  if (!prevs.length || prevs.length < Math.min(work.length, 2)) return false;
  const repMax = sessExData(ex)?.repMax ?? 12;
  return prevs.every(p => (parseInt(p.reps) || 0) >= repMax && (parseFloat(p.weight) || 0) > 0);
}

// Ligne repliée d'un exercice terminé : « 4 × 8 · 32,5 kg » (reps différentes : « 10/10/9/8 »), allure du cardio
function doneSummary(ex) {
  const m = measureOf(ex);
  if (m !== 'reps') return ex.sets.map(s => measureSetTxt(s, m, setKind(ex))).join(' · ');
  const work = workSets(ex.sets);   // l'échauffement ne se résume pas
  const reps = work.map(s => String(s.reps));
  const same = reps.every(r => r === reps[0]);
  const maxW = Math.max(0, ...work.map(s => parseFloat(s.weight) || 0));
  return `${work.length} × ${same ? reps[0] : reps.join('/')}${maxW ? ` · ${fmtW(maxW, { plain: true })} ${unitLbl()}` : ''}`;
}

// ── Rendu de la séance ───────────────────────────────────────

function renderSession() {
  const meta = sessionMeta(activeSession.category, activeSession.programme);
  const { total, done } = sessionSetCounts();
  const pct  = total ? Math.round(done / total * 100) : 0;
  const cur  = currentSet();

  const xs     = activeSession.exercises, tags = ssTags(xs);
  const exHtml = ssBlocks(xs).map(b => exUndoBefore(b, xs) + (b.length > 1 ? renderGroupCard(b, cur, tags) : renderExerciseCard(xs[b[0]], b[0], cur))).join('')
    + (sessUndo && sessUndo.at !== undefined && !sessUndo.ex && sessUndo.at >= xs.length ? exUndoHtml(sessUndo) : '');

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
        ${coachSessionProgTipHtml()}
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
  const prevSets = workSets(lastPerf(activeSession.programme, activeSession.category, ex)?.ex.sets);
  const doneSets = workSets(ex.sets).filter(s => s.done);
  const curVol   = exVolume(ex, doneSets, currentBodyKg());
  const prevVol  = exVolume(ex, prevSets.slice(0, doneSets.length), currentBodyKg());
  const delta    = curVol - prevVol;
  return curVol > 0 && prevVol > 0 && Math.round(delta) > 0
    ? ` · <span class="ex-vol__delta ${allDone ? 'ex-vol__delta--up' : ''}">+${fmtVolume(delta)} de volume</span>` : '';
}

// Objectif du jour sous le nom (le même que l'accueil : exerciseGoal, js/data/goals.js), puis « Objectif
// atteint » en vert dès qu'une série validée le bat. Rien sans objectif (jamais fait, durée, cardio).
// cls : 'ex-goal--member' sous un exercice de superset (aligné sur son nom)
function exGoalHtml(ex, cls = '') {
  const d = sessExData(ex);
  const t = d && exerciseGoal(activeSession.category, d, activeSession.programme);
  if (!t?.goal) return '';
  return goalReached(t.goal, ex.sets)
    ? `<div class="ex-goal ex-goal--done ${cls}">${icon('checkmark', 13)}Objectif atteint</div>`
    : `<div class="ex-goal num ${cls}">Objectif ${esc(t.text)}</div>`;
}

// Sous-titre de la carte : record, repos de l'exercice (modifiable), hausse de volume
function exSubHtml(ex, ei, allDone) {
  const pr   = measureOf(ex) === 'reps' ? sessExData(ex)?.pr : null;
  const rest = fmtRest(exRest(ex));
  const tempo = parseTempo(ex.tempo) && measureOf(ex) === 'reps'
    ? `<span class="tempo-pill num" aria-label="Tempo ${esc(shortTempo(ex.tempo))}${ex.tempoGuide === true ? ', guidé au son' : ''}">${ex.tempoGuide === true ? icon('music', 12) : ''}Tempo ${esc(shortTempo(ex.tempo))}</span> `
    : '';
  const range = repRangeText(ex);
  return `${tempo}${range ? `<span class="num">${range}</span> · ` : ''}${pr ? `<span class="num">Record ${fmtW(pr.weight, { plain: true })} × ${esc(pr.reps)}</span> · ` : ''}<button class="ex-rest-link num" data-action="set-ex-rest" data-ei="${ei}" aria-label="Repos ${fmtRestSpoken(exRest(ex))}, modifier">Repos ${rest}</button>${exVolumeHtml(ex, allDone)}`;
}

function renderExerciseCard(ex, ei, cur) {
  const doneN   = ex.sets.filter(s => s.done).length;
  // Sous-série d'un drop set encore à faire (js/data/intensif.js) : la carte reste dépliée
  const allDone = ex.sets.length > 0 && doneN === ex.sets.length && !techPending(activeSession.exercises, activeSession.lastDone, ei);

  if (allDone && !openDone.has(ex)) {
    const records = liveExerciseBadges(ex, livePrior(ex)).size;   // js/data/records.js
    return renderCollapsedExercise(ex, ei, records);
  }

  const howTo = !allDone && hasHowTo(ex);
  const chip = bumpReady(ex) ? `<button class="bump-chip" data-action="bump-weight" data-ei="${ei}" aria-label="Augmenter la charge de ${bumpLabel()}">↑ ${bumpLabel()}</button>` : '';
  // Séries d'échauffement (js/data/warmup.js) : en tête, sous un titre gris ; technique d'intensification
  // et ses sous-séries sous la série (js/features/session-intensif.js)
  const rows = ex.sets.map((s, si) => `${si === 0 && isWarmupSet(s) ? '<div class="sets__caption">Échauffement</div>' : ''}${renderSetRow(ex, ei, s, si, cur)}${techBlockHtml(ex, ei, s, si)}`).join('');

  return `
    <div class="exercise-block ex-card ${allDone ? 'ex-card--done' : ''}" data-ei="${ei}">
      <div class="ex-card__head">
        ${allDone
          ? `<button class="ex-card__name ex-card__name--btn" data-action="toggle-ex" data-ei="${ei}" aria-expanded="true">${esc(ex.name)}</button>`
          : howTo
            ? `<h2 class="ex-card__name ex-card__name--howto"><button class="ex-howto" data-action="ex-howto" data-ei="${ei}" aria-label="${esc(ex.name)}, comment faire"><span class="ex-howto__text">${howToNameHtml(ex.name)}</span></button></h2>`
            : `<h2 class="ex-card__name">${esc(ex.name)}</h2>`}
        ${chip}
        <span class="ex-card__count num"><span aria-hidden="true">${doneN}/${ex.sets.length}</span><span class="visually-hidden">${doneN} sur ${plural(ex.sets.length, 'série validée', 'séries validées')}</span></span>
        <button class="ex-card__more" data-action="ex-menu" data-ei="${ei}" aria-label="Options de ${esc(ex.name)}">${icon('ellipsis', 22)}</button>
      </div>
      ${exGoalHtml(ex)}
      ${gripLineHtml(ex, ei)}
      <div class="ex-card__sub">${exSubHtml(ex, ei, allDone)}</div>
      ${bandPickerHtml(ex, ei)}
      ${coachSessionTipHtml(ex)}
      <div class="sets" role="group" aria-label="Séries de ${esc(ex.name)}">
        <div class="sets__head" aria-hidden="true">
          <span>Série</span><span>Avant</span>
          <span>${loadHeader(ex)}</span><span>${MEASURES[measureOf(ex)].count}</span>
          <span>${icon('checkmark', 14)}</span>
        </div>
        ${rows}
      </div>
      <div class="ex-card__foot">
        <button class="add-set-link" data-action="add-set" data-ei="${ei}" aria-label="Ajouter une série, ${esc(ex.name)}">${icon('plus', 16)} Série</button>
        ${orderBtnHtml(ei, cur)}
      </div>
    </div>`;
}

// Carte qui montre l'exercice ei (celle de son superset s'il en fait partie)
function exCardOf(ei) {
  return document.querySelector(`.ex-card[data-ei="${ei}"], .ex-card [data-ei="${ei}"]`)?.closest('.ex-card') || null;
}

// Superset (2 à 5 exercices enchaînés) : une seule carte, les séries rangées tour par tour.
// En tête, une ligne par exercice (lettre, nom, séries faites, menu ⋯) ; le repos, celui du dernier
// exercice, part à la fin de chaque tour. Dans les tours, la lettre seule renvoie à la légende (VoiceOver
// lit le nom dans les libellés de chaque série).
function renderGroupCard(members, cur, tags) {
  const xs      = activeSession.exercises;
  const exs     = members.map(ei => xs[ei]);
  const total   = exs.reduce((a, ex) => a + ex.sets.length, 0);
  const doneN   = exs.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0);
  const allDone = total > 0 && doneN === total && !members.some(ei => techPending(xs, activeSession.lastDone, ei));
  const head    = members[0], kind = ssKind(members.length);

  if (allDone && !openDone.has(exs[0])) {
    return `
      <div class="exercise-block ex-card ex-card--collapsed ss-card" data-ei="${head}">
        <button class="ex-summary" data-action="toggle-ex" data-ei="${head}" aria-expanded="false">
          <span class="ex-summary__text">
            <span class="ex-summary__name">${kind}</span>
            ${members.map(ei => `<span class="ex-summary__line num"><span class="ss-tag ss-tag--sm">${tags[ei]}</span>${esc(xs[ei].name)} · ${doneSummary(xs[ei])}</span>`).join('')}
          </span>
          <span class="set-check set-check--done ex-summary__check">${icon('checkmark', 18)}</span>
        </button>
      </div>`;
  }

  const legend = members.map(ei => {
    const ex = xs[ei], n = ex.sets.filter(s => s.done).length;
    const howTo = !allDone && hasHowTo(ex);
    const chip = bumpReady(ex) ? `<button class="bump-chip" data-action="bump-weight" data-ei="${ei}" aria-label="Augmenter la charge de ${bumpLabel()}, ${esc(ex.name)}">↑ ${bumpLabel()}</button>` : '';
    return `
        <div class="ss-member">
          <span class="ss-tag" aria-hidden="true">${tags[ei]}</span>
          ${howTo
            ? `<button class="ex-howto ss-member__name" data-action="ex-howto" data-ei="${ei}" aria-label="${esc(ex.name)}, comment faire"><span class="ex-howto__text">${esc(ex.name)}</span>${icon('info.circle', 15)}</button>`
            : `<span class="ss-member__name">${esc(ex.name)}</span>`}
          ${chip}
          <span class="ex-card__count num"><span aria-hidden="true">${n}/${ex.sets.length}</span><span class="visually-hidden">${n} sur ${plural(ex.sets.length, 'série validée', 'séries validées')}</span></span>
          <button class="ex-card__more" data-action="ex-menu" data-ei="${ei}" aria-label="Options de ${esc(ex.name)}">${icon('ellipsis', 22)}</button>
        </div>${exGoalHtml(ex, 'ex-goal--member')}`;
  }).join('');

  const rounds = ssRounds(xs, members).map((round, t) => `
        <div class="ss-round" role="group" aria-label="Tour ${t + 1}">
          <div class="ss-round__title">Tour ${t + 1}</div>
          ${round.map(({ ei, si }) => `${renderSetRow(xs[ei], ei, xs[ei].sets[si], si, cur, tags[ei])}${techBlockHtml(xs[ei], ei, xs[ei].sets[si], si)}`).join('')}
        </div>`).join('');
  const rest = fmtRest(exRest(xs[members.at(-1)]));
  const m0   = exs[0];

  return `
    <div class="exercise-block ex-card ss-card ${allDone ? 'ex-card--done' : ''}" data-ei="${head}">
      <div class="ex-card__head">
        ${allDone
          ? `<button class="ex-card__name ex-card__name--btn" data-action="toggle-ex" data-ei="${head}" aria-expanded="true">${kind}</button>`
          : `<h2 class="ex-card__name">${kind}</h2>`}
        <span class="ex-card__count num"><span aria-hidden="true">${doneN}/${total}</span><span class="visually-hidden">${doneN} sur ${plural(total, 'série validée', 'séries validées')}</span></span>
      </div>
      <div class="ex-card__sub"><button class="ex-rest-link num" data-action="set-ex-rest" data-ei="${members.at(-1)}" aria-label="Repos ${fmtRestSpoken(exRest(xs[members.at(-1)]))} après chaque tour, modifier">Repos ${rest} après chaque tour</button></div>
      <div class="ss-members">${legend}</div>
      ${members.map(ei => gripLineHtml(xs[ei], ei, tags[ei])).join('')}
      ${members.map(ei => coachSessionTipHtml(xs[ei], tags[ei])).join('')}
      <div class="sets" role="group" aria-label="Séries du ${kind.toLowerCase()}">
        <div class="sets__head" aria-hidden="true">
          <span>Exo</span><span>Avant</span>
          <span>${loadHeader(m0)}</span><span>${MEASURES[measureOf(m0)].count}</span>
          <span>${icon('checkmark', 14)}</span>
        </div>
        ${rounds}
      </div>
      <div class="ex-card__foot">
        <button class="add-set-link" data-action="add-round" data-ei="${head}" aria-label="Ajouter un tour, ${esc(members.map(ei => xs[ei].name).join(', '))}">${icon('plus', 16)} Tour</button>
        ${orderBtnHtml(head, cur)}
      </div>
    </div>`;
}

// Série validée : ligne en lecture seule, rouverte en édition au tap ; sous la ligne, dans une même rangée :
// le badge de record (liveSetBadge, js/data/records.js : toutes les mesures), l'allure et le niveau en cardio
// VoiceOver : la phrase (texte masqué) est l'intitulé, les cases affichées sont cachées aux lecteurs d'écran
// (un aria-label qui ne reprend pas « 60 », « 10 »… échoue à WCAG 2.5.3)
function renderDoneSetRow(ex, ei, s, si, prev, del, tag) {
  const m      = measureOf(ex), M = MEASURES[m];
  const warm   = isWarmupSet(s);
  const record = warm ? '' : liveSetBadge(ex, s, livePrior(ex));   // js/data/records.js
  const first  = setFirstValue(s, m);
  const kind   = m === 'cardio' ? 'charge' : m === 'time' ? 'lest' : loadKind(ex);
  const load   = first ? `${{ charge: '', lest: 'plus ', aide: 'aide de ' }[kind]}${first} ${m === 'cardio' ? 'kilomètres' : data.unit === 'lbs' ? 'livres' : 'kilos'}, ` : '';
  const pk     = m === 'cardio' ? paceKind(ex) : null;
  const pace   = pk ? cardioPace(s.dist, setMinutes(s), pk) : null;
  const mach   = m === 'cardio' ? machineTxt(s.machine) : '';
  // RIR (js/data/rir.js) : sélecteur sous la dernière série validée, badge « RIR 2 » sur les autres
  const last   = activeSession.lastDone?.ei === ei && activeSession.lastDone?.si === si;
  const rir    = m === 'reps' && !warm ? (last && rirShown() ? rirPickerHtml(ei, si, s, ex) : rirBadgeHtml(s)) : '';
  const rirSpoken = cleanRir(s.rir) !== null ? `, ${rirTxt(s.rir)} en réserve` : '';
  // « Annuler » en ligne pendant 6 s : la ligne se corrige toujours au toucher, mais n'est plus annoncée comme un bouton
  // (pas de bouton dans un bouton pour VoiceOver) ; « Annuler » a sa propre action
  const u = undoForSet(ex, si);
  return `
      <div class="set-swipe">
        ${del}
        <div class="session-set session-set--done ${warm ? 'session-set--warmup' : ''}" data-action="edit-set" data-ei="${ei}" data-si="${si}" ${u ? '' : 'role="button" tabindex="0"'}>
          <span class="sr-text">${setSpokenName(ex, si)} validé${warm ? '' : 'e'}, ${load}${esc(s.reps)} ${M.spoken}${pace ? `, ${spokenPace(pace, pk)}` : ''}${mach ? `, ${esc(mach)}` : ''}${rirSpoken}, ${esc(ex.name)}${record ? `, ${esc(record)}` : ''}. Modifier</span>
          ${setNumHtml(ex, si, tag).replace(/^<span (?!aria-hidden)/, '<span aria-hidden="true" ')}
          ${u ? setUndoHtml(u) : `<span class="set-prev num" aria-hidden="true">${prev}</span>`}
          <span class="set-val set-val--w num" aria-hidden="true">${first || '—'}</span>
          <span class="set-val set-val--r num" aria-hidden="true">${esc(s.reps)}</span>
          <span class="set-check-zone" aria-hidden="true"><span class="set-check set-check--done">${icon('checkmark', 18)}</span></span>
          ${record || pace || mach ? `<span class="set-badge" aria-hidden="true">${record ? `<span class="pr-badge">${esc(record)}</span>` : ''}${pace ? `<span class="pace-badge">${fmtPace(pace, pk)}</span>` : ''}${mach ? `<span class="mach-badge">${esc(mach)}</span>` : ''}</span>` : ''}
        </div>
        ${rir}
      </div>`;
}

// « Série 2 », « Échauffement 1 » (VoiceOver, toasts) : les séries d'échauffement ont leur propre compte ;
// setRefName : la même chose avec son article (« la série 2 », « l'échauffement 1 »)
function setSpokenName(ex, si) {
  const s = ex.sets[si];
  return isWarmupSet(s) ? `Échauffement ${ex.sets.slice(0, si + 1).filter(isWarmupSet).length}` : `Série ${setDisplayNo(ex.sets, si)}`;
}
function setRefName(ex, si) {
  const n = setSpokenName(ex, si);
  return isWarmupSet(ex.sets[si]) ? `l'${n.toLowerCase()}` : `la ${n.toLowerCase()}`;
}

// Sélecteur RIR d'une série validée : 0 à 4+, l'équivalent RPE à côté du choix ; un nouveau toucher sur le
// même bouton efface. Facultatif : rien n'attend ce choix. Placé sous la ligne, hors de son bouton « Modifier »
// (pas de boutons imbriqués dans un rôle bouton)
function rirPickerHtml(ei, si, s, ex) {
  const r = cleanRir(s.rir);
  return `<div class="rir" role="group" aria-label="Répétitions en réserve, ${setSpokenName(ex, si)}">
            <span class="rir__lbl" aria-hidden="true">Reps en réserve</span>
            <span class="rir__btns">${RIR_CHOICES.map(c => `<button class="rir__btn num" data-action="set-rir" data-ei="${ei}" data-si="${si}" data-rir="${c}" aria-pressed="${r === c}" aria-label="${rirTxt(c)} en réserve, RPE ${rirToRpe(c)}">${rirTxt(c)}</button>`).join('')}</span>
            <span class="rir__rpe num" aria-live="polite">${r === null ? '' : `RPE ${rirToRpe(r)}`}</span>
          </div>`;
}
function rirBadgeHtml(s) {
  const r = cleanRir(s.rir);
  return r === null ? '' : `<span class="set-badge"><span class="rir-badge num">${rirTxt(r)} en réserve</span></span>`;
}

// En-tête de la colonne de charge : kg (barre, haltères), +kg (lest ajouté au poids du corps, comme
// « 8 reps · +10 kg »), Aide (machine d'assistance), km (cardio)
function loadHeader(ex) {
  const m = measureOf(ex);
  if (m !== 'reps') return MEASURES[m].load();
  return { charge: unitLbl(), lest: `+${unitLbl()}`, aide: 'Aide' }[loadKind(ex)];
}
// Même colonne, en toutes lettres pour VoiceOver (en-tête et champs) : « Charge ajoutée » plutôt que « Lest »
function loadSpoken(ex) {
  const m = measureOf(ex);
  if (m === 'cardio') return 'Distance';
  return m === 'time' ? 'Charge ajoutée' : { charge: 'Charge', lest: 'Charge ajoutée', aide: 'Aide' }[loadKind(ex)];
}

// Colonne des reps ou de la durée, pour VoiceOver : mêmes mots que les champs (« Durée en secondes »)
function countSpoken(ex) {
  const m = measureOf(ex);
  return m === 'reps' ? 'Répétitions' : `Durée en ${MEASURES[m].spoken}`;
}

// Valeur de la première colonne : charge (ou lest) dans l'unité de l'app, distance en km pour le cardio
function setFirstValue(s, m) {
  if (m === 'cardio') return parseFloat(s?.dist) > 0 ? fmtNum(s.dist) : '';
  return hasLoad(s?.weight) ? fmtW(s.weight, { plain: true }) : '';
}

// Première colonne : numéro de la série de travail (l'échauffement, « É », ne décale pas la numérotation),
// ou A1, A2… dans un superset (affiché tour par tour)
function setNumHtml(ex, si, tag) {
  if (tag) return `<span class="set-n"><span class="ss-tag">${tag}</span></span>`;
  if (isWarmupSet(ex.sets[si])) return `<span class="set-n set-n--warm" aria-hidden="true">É</span>`;
  return `<span class="set-n num">${setDisplayNo(ex.sets, si)}</span>`;
}

// Disques (js/data/plates.js) : sur la série à faire d'un exercice à barre, le numéro laisse place à un
// bouton qui ouvre la feuille « Disques » pour la charge de la série (ou celle de la dernière fois). Le numéro reste, un petit
// disque (vu de face, avec ses trous de prise) à côté dit ce que le bouton ouvre : seul, il passait pour une cible ou un
// « top set » (panels de la vague 3) ; l'haltère reste à l'onglet Entraînement
function setPlatesHtml(ex, ei, s, si) {
  const kg = s.weight !== '' ? s.weight : s.prev?.weight;
  const load = kg !== '' && kg != null ? `${fmtW(kg, { plain: true })} ${unitLbl()}` : '';
  return `<button class="set-n set-plates" data-action="open-plates" data-ei="${ei}" data-si="${si}" aria-label="Disques à charger${load ? ` pour ${load}` : ''}, ${setSpokenName(ex, si)}, ${esc(ex.name)}"><span class="num">${setDisplayNo(ex.sets, si)}</span>${icon('plate', 12)}</button>`;
}

// ▶ de la série à faire : chrono d'un maintien, série guidée au tempo, ou chrono d'une machine de cardio
// (js/features/effort-machine.js ; déjà lancé et feuille fermée : le même bouton la rouvre)
function setPlayHtml(ex, ei, s, si) {
  const m = measureOf(ex), e = activeSession.effort;
  const live = e?.kind === 'machine' && e.ei === ei && e.si === si;
  const what = m === 'cardio' ? (live ? 'Rouvrir le chrono en cours' : 'Lancer le chrono et noter le réglage de la machine')
    : m === 'time' ? 'Lancer le chrono' : `Lancer la série guidée au tempo ${esc(ex.tempo)}`;
  const goal = s.reps && m !== 'cardio' ? `, ${esc(s.reps)} ${m === 'time' ? 'secondes' : 'répétitions'}` : '';
  return `<button class="set-n set-play${live ? ' set-play--live' : ''}" data-action="start-effort" data-ei="${ei}" data-si="${si}" aria-label="${what}, série ${si + 1}, ${esc(ex.name)}${goal}">${icon(live ? 'timer' : 'play', 16)}</button>`;
}

function renderSetRow(ex, ei, s, si, cur, tag) {
  const m       = measureOf(ex);
  const prevF   = setFirstValue(s.prev, m);
  const prev    = s.prev ? `${prevF ? prevF + '&nbsp;× ' : ''}${esc(s.prev.reps)}` : '—';
  const editing = editingSet && editingSet.ei === ei && editingSet.si === si;
  const del     = `<button class="set-del" data-action="delete-set" data-ei="${ei}" data-si="${si}" tabindex="-1" aria-label="Supprimer la série ${si + 1}">Supprimer</button>`;

  if (s.done && !editing) return renderDoneSetRow(ex, ei, s, si, prev, del, tag);

  // Pendant la pause d'un rest-pause ou d'un cluster (ou entre deux drops), la sous-série qui suit est seule
  // mise en avant (session-set--subcur, js/features/session-intensif.js) : une seule chose en cours
  const isCur = !editing && cur && cur.ei === ei && cur.si === si && !techCurrentSub(activeSession.exercises, activeSession.lastDone);
  // Série rouverte : la saisie en cours (editingSet) prime, sinon un re-rendu la remettrait à l'ancienne valeur
  const wVal = editing && editingSet.weight !== undefined ? editingSet.weight : (m === 'cardio' ? (s.dist ? fmtNum(s.dist) : '') : fmtW(s.weight, { plain: true }));
  const rVal = editing && editingSet.reps   !== undefined ? editingSet.reps   : s.reps;
  const prevW = prevF;
  // Série validée rouverte : mêmes champs, enregistrés par le ✓
  const wAttr = editing ? 'id="editSetWeight"' : `data-action="${m === 'cardio' ? 'set-dist' : 'set-weight'}" data-ei="${ei}" data-si="${si}"`;
  const rAttr = editing ? 'id="editSetReps"'   : `data-action="set-reps" data-ei="${ei}" data-si="${si}"`;
  const first = ex.sets.findIndex(x => !x.done);
  const waitFor = !editing && first >= 0 && first < si ? first : -1;
  const name  = setSpokenName(ex, si), ref = setRefName(ex, si), warm = isWarmupSet(s);
  const check = editing
    ? `<button class="set-check-zone" data-action="save-edit-set" aria-label="Enregistrer ${ref}, ${esc(ex.name)}"><span class="set-check set-check--edit">${icon('checkmark', 18)}</span></button>`
    : waitFor >= 0
      // Une série plus haut n'est pas faite : on valide dans l'ordre (le ✓ grisé le rappelle au toucher)
      ? `<button class="set-check-zone set-check-zone--wait" data-action="validate-set" data-ei="${ei}" data-si="${si}" aria-disabled="true" aria-label="${name}, ${esc(ex.name)} : valide d'abord ${setRefName(ex, waitFor)}"><span class="set-check"></span></button>`
      : `<button class="set-check-zone" data-action="validate-set" data-ei="${ei}" data-si="${si}" aria-label="Valider ${ref}, ${esc(ex.name)}"><span class="set-check"></span></button>`;
  // Première colonne de la série à faire : ▶ (chrono, tempo, machine), sinon « Disques » sur une barre, sinon le numéro
  const isNext = !editing && si === first;
  const play   = isNext && (m === 'time' || (m === 'reps' && parseTempo(ex.tempo) && ex.tempoGuide === true) || hasMachineClock(ex));
  // Ailleurs, le numéro d'une série de travail ouvre le choix d'une technique d'intensification (comme Hevy)
  const firstCol = play ? setPlayHtml(ex, ei, s, si) : isNext && !tag && isBarbellExercise(ex) ? setPlatesHtml(ex, ei, s, si)
    : !tag && !warm && canTech(ex) ? setTechNumHtml(ex, ei, si) : setNumHtml(ex, si, tag);
  // Série validée rouverte : le RIR se corrige là aussi (js/data/rir.js)
  const rir = editing && m === 'reps' && !warm && rirShown() ? rirPickerHtml(ei, si, s, ex) : '';
  return `
    <div class="set-swipe">
      ${editing ? '' : del}
      <div class="session-set ${isCur ? 'session-set--current' : ''} ${editing ? 'session-set--editing' : ''} ${warm ? 'session-set--warmup' : ''}" ${isCur ? 'aria-current="step"' : ''} data-ei="${ei}" data-si="${si}">
        ${firstCol}
        ${undoForSet(ex, si) ? setUndoHtml(undoForSet(ex, si)) : `<span class="set-prev num">${s.prev ? '<span class="visually-hidden">La dernière fois </span>' : ''}${prev}</span>`}
        <input type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" class="set-input num" ${wAttr}
               value="${esc(wVal)}" placeholder="${prevW || '—'}" aria-label="${loadSpoken(ex)} ${name.toLowerCase()}, ${esc(ex.name)}, en ${m === 'cardio' ? 'kilomètres' : unitLbl()}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="${editing ? 'done' : 'next'}" autocomplete="off" class="set-input set-input--required num" ${rAttr}
               value="${esc(rVal)}" placeholder="${esc(setGoal(ex, s))}" aria-label="${countSpoken(ex)} ${name.toLowerCase()}, ${esc(ex.name)}">
        ${check}
      </div>
      ${rir}
    </div>`;
}

// Valeur au-delà de l'habituel, demandée avant de valider (unusualSetValue, js/data/measures.js) ;
// une fois confirmée pour l'exercice (ex.oddOk), plus redemandée dans la séance
function unusualSetText(ex, s) {
  // Valeur hors bornes : c'est validateSet qui la refuse et signale le champ, sans question avant
  if (measureOf(ex) !== 'reps' || ex.oddOk || num(s.reps, 1, MEASURES.reps.max, true) === null || !weightOk(fmtW(s.weight, { plain: true }))) return '';
  const done = ex.sets.filter(x => x.done);
  return unusualSetValue(s, {
    prevReps: parseInt(s.prev?.reps) || 0, prevW: parseFloat(s.prev?.weight) || 0,
    prW: parseFloat(sessExData(ex)?.pr?.weight) || 0, repMax: sessExData(ex)?.repMax ?? 12,
    doneReps: done.map(x => parseInt(x.reps) || 0), doneW: done.map(x => parseFloat(x.weight) || 0), kind: loadKind(ex),
  });
}

// ── Validation d'une série ───────────────────────────────────

// opts.restFrom : fin réelle d'un effort chronométré (le repos part de là) ; opts.prevReps, opts.prevDist,
// opts.prevMachine : valeurs d'avant le chrono (reps, km et réglages de la machine), rendues par « Annuler »
function validateSet(ei, si, opts = {}) {
  const ex  = activeSession.exercises[ei];
  const s   = ex?.sets[si];
  if (!s || s.done) return;
  const rIn = document.querySelector(`[data-action="set-reps"][data-ei="${ei}"][data-si="${si}"]`);
  const m   = measureOf(ex);
  const wIn = document.querySelector(`[data-action="${m === 'cardio' ? 'set-dist' : 'set-weight'}"][data-ei="${ei}"][data-si="${si}"]`);
  restoreClearedInput(wIn); restoreClearedInput(rIn);   // champ vidé au toucher, ✓ touché sans en sortir
  if (m === 'cardio' ? !distOk(wIn?.value) : (wIn && !weightOk(wIn.value))) { flagInvalid(wIn, m === 'cardio' ? distMsg() : weightMsg()); return; }
  // Case vide : l'objectif affiché en gris est celui qui est fait (« Annuler » rend la case vide)
  const goalTaken = String(s.reps ?? '').trim() === '';
  if (goalTaken) s.reps = setGoal(ex, s);
  if (num(s.reps, 1, MEASURES[m].max, true) === null) { flagInvalid(rIn, MEASURES[m].msg); return; }
  s.reps = String(parseInt(s.reps));

  s.done = true;
  const prevLastEi = activeSession.lastEi, prevLastDone = activeSession.lastDone ?? null;
  const sameAgain  = prevLastEi === ei;   // même exercice deux fois de suite : fait seul
  activeSession.lastEi = ei;
  activeSession.lastDone = { ei, si };    // le sélecteur RIR se montre sous cette série (js/data/rir.js)
  editingSet = null;
  haptic();
  afterPaint(validationSound);   // la coche verte d'abord : le son natif active la session audio d'iOS (bloquant)

  const undo = carryWeightToNextSet(ex, si);
  undo.prevLastEi = prevLastEi;   // « Annuler » puis revalider : le superset enchaîne comme la 1re fois
  undo.prevLastDone = prevLastDone;
  if (opts.prevReps !== undefined) undo.prevReps = opts.prevReps;
  else if (goalTaken) undo.prevReps = '';
  if ('prevDist' in opts) undo.prevDist = opts.prevDist;
  if ('prevMachine' in opts) undo.prevMachine = opts.prevMachine;
  const xs      = activeSession.exercises;
  const allDone = xs.every(e => e.sets.every(st => st.done));
  // Superset : pas de repos avant la fin du tour, on enchaîne sur l'exercice suivant du groupe.
  // Le même exercice validé deux fois de suite (l'autre est pris) : repos comme d'habitude.
  const group   = ssGroupOf(xs, ei);
  // Drop set, rest-pause, cluster (js/data/intensif.js) : la sous-série suit, sans repos ou après sa courte
  // pause ; dans un superset, l'exercice suivant du tour vient après elle (validateSub)
  const techPause = techPauseAfter(s);
  const chain   = techPause === null && !allDone && group && !sameAgain ? ssChainAfter(xs, group, ei) : null;
  if (allDone && techPause === null) { stopRest(); closeSessSheets(); }
  else if (chain) stopRest();
  else if (techPause !== null) { if (techPause) openRest(techPause, false, opts.restFrom); else stopRest(); }
  else openRest(exRest(xs[restEi(ei)]), false, opts.restFrom);

  document.activeElement?.blur?.();
  render();
  scrollToCurrent(true, true);
  // Le toast nomme d'abord ce que « Annuler » défait (la validation de la série), puis ce qui suit :
  // « Série 1 validée · puis rest-pause » (panel du 07/11). Retirer la technique : le × de son bloc.
  const doneTxt = `${setSpokenName(ex, si)} validé${isWarmupSet(s) ? '' : 'e'}`;
  const next = chain ? `enchaîne ${xs[chain.ei].name}` : techPause !== null ? `puis ${TECHS[setTech(s)].label.toLowerCase()}` : '';
  sessionUndo(next ? `${doneTxt} · ${next}` : doneTxt, { target: { ex, si }, onAction: () => undoValidate(undo) });
}

// La série suivante garde sa valeur prévue, sauf si la charge vient d'être modifiée.
// Renvoie de quoi annuler la validation (série validée et charge d'origine de la suivante).
// Une série d'échauffement ne transmet rien : sa charge n'est pas celle du travail.
function carryWeightToNextSet(ex, si) {
  const s       = ex.sets[si];
  const nextSet = ex.sets[si + 1];
  const undo    = { s, next: null, nextW: null, nextR: null };
  if (!nextSet || nextSet.done || isWarmupSet(s)) return undo;
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
  if (u.prevLastEi !== undefined) activeSession.lastEi = u.prevLastEi;
  if (u.prevLastDone !== undefined) activeSession.lastDone = u.prevLastDone;
  if (u.prevReps !== undefined) u.s.reps = u.prevReps;   // chrono ou case vide : la valeur d'avant revient
  // Chrono d'une machine : km et réglages notés d'avant (absents : retirés), comme si rien n'avait été enregistré
  if ('prevDist' in u) { if (u.prevDist == null) delete u.s.dist; else u.s.dist = u.prevDist; }
  if ('prevMachine' in u) { if (u.prevMachine == null) delete u.s.machine; else u.s.machine = u.prevMachine; }
  if (u.next && !u.next.done) { u.next.weight = u.nextW; u.next.reps = u.nextR; }
  stopRest();
  closeSessSheets();
  persistSession();
  render();
  scrollToCurrent(true, true);
}

// Série (ou sous-série) à faire : celle que l'écran met en avant
function currentSetRow() {
  // Sous-série d'un drop set à faire (js/features/session-intensif.js) : c'est elle qui suit
  return $('.session-set--subcur') || $('.session-set--current');
}

// Focus sur le ✓ de la série à faire, après un geste qui a détruit le bouton touché (valider, Annuler,
// Passer le repos) : VoiceOver reprend là où l'on en est au lieu de repartir du haut de l'écran.
// Le ✓ et non le champ des reps, qui ouvrirait le clavier.
function focusCurrentSet() {
  currentSetRow()?.querySelector('button.set-check-zone')?.focus({ preventScroll: true });
}

// Centre la série courante à l'écran (après validation, reprise ou restauration) ; focus : après un geste
// de l'utilisateur (focusCurrentSet), jamais à l'ouverture ni à la fin d'un repos qu'il n'a pas touché
function scrollToCurrent(smooth = true, focus = false) {
  requestAnimationFrame(() => {
    const row = currentSetRow();
    if (!row) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const behavior = smooth && !reduce ? 'smooth' : 'auto';
    // Ligne « … · Annuler » au-dessus de la carte en cours (sessionUndo), ou toute première série d'un exercice : le haut
    // de la carte (ou la ligne) juste sous la barre, pour que le nom et « Annuler » restent visibles (panel de la vague 3 :
    // en texte agrandi, centrer la série cachait le nom ; la bande d'une mini-série sortait de l'écran) ; la série doit
    // rester à l'écran, sinon elle est centrée comme avant
    const card = row.closest('.ex-card');
    const band = card?.previousElementSibling?.classList.contains('ex-undo') ? card.previousElementSibling : null;
    const top = band || (card && !card.querySelector('.session-set--done') ? card : null);
    const barH = $('#app .navbar')?.getBoundingClientRect().height || 0;
    const room = window.innerHeight - barH - ($('.rest-mini')?.getBoundingClientRect().height || 0) - 24;
    if (top && row.getBoundingClientRect().bottom - top.getBoundingClientRect().top <= room) {
      window.scrollTo({ top: Math.max(0, top.getBoundingClientRect().top + window.scrollY - barH - 8), behavior });
    } else row.scrollIntoView({ block: 'center', behavior });
    if (focus) focusCurrentSet();
  });
}

// Appelé par render() après l'affichage de la séance
function afterSessionRender(entering) {
  // Consigne générale du coach (js/features/coach-ui.js) et aucune série faite : la séance s'ouvre en haut,
  // la consigne visible (sinon elle serait cachée sous la barre par le défilement vers le premier exercice)
  const tipFirst = entering && coachSessionProgTipHtml() && !activeSession.exercises.some(ex => ex.sets.some(s => s.done));
  if (tipFirst) window.scrollTo(0, 0);
  else if (entering) scrollToCurrent(false);
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
  const ex = activeSession.exercises[ei];
  sessionUndo(`${setSpokenName(ex, si)} modifiée`, { target: { ex, si }, state: 'Modifiée' });
  return true;
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  // « Annuler » en ligne (sessionUndo)
  'sess-undo': () => { const u = sessUndo; if (!u?.onAction) return; clearSessionUndo(); u.onAction(); },   // onAction redessine et place le focus
  'resume-session': () => {
    if (!activeSession) return;
    if (currentRoute() !== 'session') navigate('session');
  },
  'validate-set': async (e, el) => {
    if (editingSet && !saveEditedSet()) return;   // correction en cours : enregistrée avant de passer à la suite
    const ei = parseInt(el.dataset.ei), si = parseInt(el.dataset.si);
    const ex = activeSession?.exercises[ei], s = ex?.sets[si];
    // Séries validées dans l'ordre : une série plus haut reste à faire, on y ramène
    const first = ex ? ex.sets.findIndex(x => !x.done) : -1;
    if (s && !s.done && first >= 0 && first < si) {
      showToast(`Valide d'abord ${setRefName(ex, first)}`);
      document.querySelector(`.session-set[data-ei="${ei}"][data-si="${first}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    // Valeurs telles qu'elles seront enregistrées : champ vidé au toucher rendu, case vide = objectif
    document.querySelectorAll(`.set-input[data-ei="${ei}"][data-si="${si}"]`).forEach(restoreClearedInput);
    const odd = s && !s.done ? unusualSetText(ex, { ...s, reps: String(s.reps ?? '').trim() ? s.reps : setGoal(ex, s) }) : '';
    if (odd) {
      if (!(await confirmSheet('Valeur inhabituelle', `${odd} : c'est bien ça ?`, 'Valider quand même', false))) return;
      ex.oddOk = true;
    }
    validateSet(ei, si);
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
    if (activeSession.effort?.ei === ei) cancelEffort();   // les positions des séries changent
    ex.sets.splice(si, 1);
    activeSession.lastDone = null;
    editingSet = null;
    haptic();
    persistSession();
    render();
  },
  // RIR d'une série validée (js/data/rir.js) : un toucher note, le même toucher efface
  'set-rir': (e, el) => {
    const s = activeSession?.exercises[parseInt(el.dataset.ei)]?.sets[parseInt(el.dataset.si)];
    if (!s) return;
    const r = cleanRir(el.dataset.rir);
    if (r === null) return;
    if (s.rir === r) delete s.rir; else s.rir = r;
    haptic();
    persistSession();
    render();
  },
  'add-set': (e, el) => {
    const ex = activeSession?.exercises[parseInt(el.dataset.ei)];
    if (!ex || ex.sets.length >= 20) return;
    // « La dernière fois » de la nouvelle série : la série de travail de même rang (échauffements retirés des deux côtés)
    const prevWork = workSets(lastPerf(activeSession.programme, activeSession.category, ex)?.ex.sets);
    ex.sets.push(plannedSet(workSets(ex.sets).at(-1) ?? ex.sets.at(-1), prevWork[workSets(ex.sets).length]));
    openDone.add(ex);
    haptic();
    persistSession();   // aussi quand l'action est appelée sans clic (registre : handleAction)
    render();
  },
  // Superset : un tour de plus = une série de plus pour chaque exercice du groupe
  'add-round': (e, el) => {
    const g = activeSession && ssGroupOf(activeSession.exercises, parseInt(el.dataset.ei));
    if (!g) return;
    g.map(ei => activeSession.exercises[ei]).forEach(ex => {
      if (ex.sets.length >= 20) return;
      const prevWork = workSets(lastPerf(activeSession.programme, activeSession.category, ex)?.ex.sets);
      ex.sets.push(plannedSet(workSets(ex.sets).at(-1) ?? ex.sets.at(-1), prevWork[workSets(ex.sets).length]));
    });
    openDone.add(activeSession.exercises[g[0]]);
    haptic();
    persistSession();
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
    // La nouvelle charge repart aux reps de l'objectif (goalRepsAfterBump, js/data/goals.js) : le bas de la
    // fourchette, sinon quelques reps sous le haut ; la puce et « Objectif 75 kg × 3 » disent la même chose
    const lo = measureOf(ex) === 'reps' ? goalRepsAfterBump(sessExData(ex) || {}) : null;
    ex.sets.forEach(s => {
      if (s.done || isWarmupSet(s)) return;   // l'échauffement garde ses paliers
      const cur = toUnitW(s.weight || s.prev?.weight) || 0;
      s.weight = storeW(String(Math.round((cur + step) * 100) / 100));
      s.plannedWeight = s.weight;
      if (lo) s.reps = String(lo);
    });
    ex.bumped = true;
    haptic();
    persistSession();
    render();
    showToast(lo ? `Charge augmentée de ${bumpLabel()}, retour à ${lo} reps` : `Charge augmentée de ${bumpLabel()}`);
  },
});
