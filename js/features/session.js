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
//    « Mis en cours · Annuler » juste au-dessus de sa carte (Plus tard : « <nom> mis en dernier », au-dessus de
//    l'exercice qui prend la suite, celui que l'écran montre) ; retiré : la même ligne là où était sa carte.
// Rien ne recouvre rien : la ligne prend sa place dans la liste. VoiceOver annonce l'état (announce, aria-live).
// target : { ex, si } (série), { ex } (exercice), { at } (exercice retiré, sa position) ; sans onAction, le texte seul.
const SESS_UNDO_MS = 6000;
let sessUndo = null;
function sessionUndo(text, { target = {}, label = 'Annuler', onAction = null, state = '', ms = onAction ? SESS_UNDO_MS : 3000, paint = true, assertive = false } = {}) {
  clearTimeout(sessUndo?.timer);
  document.querySelector('.toast')?.remove();
  sessUndo = { ...target, text, label, onAction, state };
  const inSession = () => typeof currentView === 'function' && currentView() === 'session';
  // Retenu tant que VoiceOver (ou le clavier) est sur « Annuler » : encore 3 s après (WCAG 2.2.1)
  const expire = () => {
    if (document.activeElement?.dataset?.action === 'sess-undo') { sessUndo.timer = setTimeout(expire, 3000); return; }
    sessUndo = null;
    if (inSession()) collapseExUndo(render);
  };
  sessUndo.timer = setTimeout(expire, ms);
  announce(onAction ? `${text}. ${label} disponible` : text, assertive);   // une erreur : annoncée en assertif, comme son toast
  if (!inSession()) return;
  // paint false (message d'une saisie refusée) : la ligne est posée sans redessiner, pour garder le champ signalé et le focus
  const card = paint ? null : exCardOf(activeSession.exercises.indexOf(sessUndo.ex));
  if (card) {
    document.querySelectorAll('.ex-undo').forEach(e => e.remove());
    card.insertAdjacentHTML('beforebegin', exUndoHtml(sessUndo));
    // Ligne posée sous la barre (carte déjà défilée) : ramenée juste sous elle, le focus reste dans le champ (vague 3-t4 :
    // « Reps entre 1 et 100 » invisible)
    const band = card.previousElementSibling, barH = $('#app .navbar')?.getBoundingClientRect().height || 0;
    const top = band?.getBoundingClientRect().top;
    if (top !== undefined && top < barH + 8) window.scrollBy({ top: top - barH - 8 });
  }
  else render();
}
// Tout autre message pendant la séance (« Exercice ajouté », « Valide d'abord la série 1 », « Tempo 3-1-1 »…) : pas de
// toast flottant non plus, la même ligne au-dessus de la carte en cours, 3 s (showToast la délègue ici, js/core/dialogs.js).
// Une feuille de la séance ouverte garde le toast (il passe au-dessus d'elle, en bas).
function sessionNotice(msg, opts = {}) {
  if (typeof currentView !== 'function' || currentView() !== 'session' || !activeSession) return false;
  if (document.querySelector('.sess-sheet:not(.sess-sheet--out), .ios-dialog, .sheet-root')) return false;
  // Série validée en cours de correction : le message va au-dessus de SA carte, pas de celle de la série à faire
  const cur = editingSet || currentSet(), ex = activeSession.exercises[cur ? cur.ei : activeSession.exercises.length - 1];
  if (!ex) return false;
  sessionUndo(msg, { target: { ex }, onAction: opts.action ? opts.onAction : null, ms: opts.error ? 4000 : 3000, paint: false, assertive: !!opts.error });
  return true;
}
// La ligne s'en va en se repliant (hauteur animée, 0,25 s), sans faire sauter la liste d'un coup (panel t7) ;
// mouvement réduit : retirée tout de suite, comme avant
function collapseExUndo(done) {
  const el = document.querySelector('.ex-undo');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!el || reduce || typeof el.animate !== 'function') { done(); return; }
  const h = el.getBoundingClientRect().height, mb = getComputedStyle(el).marginBottom;
  el.style.overflow = 'hidden'; el.style.minHeight = '0';
  el.animate([{ height: `${h}px`, marginBottom: mb, opacity: 1 }, { height: '0px', marginBottom: '0px', opacity: 0 }],
    { duration: 250, easing: 'ease-in-out', fill: 'forwards' });
  setTimeout(done, 250);   // pas anim.finished : la ligne peut être redessinée entre-temps
}
function clearSessionUndo() { clearTimeout(sessUndo?.timer); sessUndo = null; }
// side : 2 pour le second côté d'une série notée par bras (js/features/session-unilateral.js), k : -1 pour sa ligne
const undoForSet = (ex, si, k, side = 1) => (sessUndo && sessUndo.ex === ex && sessUndo.si === si && sessUndo.k === k && (sessUndo.side || 1) === side ? sessUndo : null);
// Colonne « Avant » d'une série qui vient de changer : « Annuler » (ou l'état, « Modifiée »), à la même place à chaque fois
function setUndoHtml(u) {
  return u.onAction ? `<button class="set-undo" data-action="sess-undo" aria-label="${esc(u.text)}, annuler">Annuler</button>`
    : `<span class="set-prev set-undo--state" aria-hidden="true">${esc(u.state || '')}</span>`;
}
// Ligne au-dessus de la carte d'un exercice (ou à la place d'une carte retirée)
function exUndoHtml(u) {
  return `<div class="ex-undo" role="status"><span class="ex-undo__text">${esc(u.text)}</span>${u.onAction ? `<button class="ex-undo__btn" data-action="sess-undo">${esc(u.label)}</button>` : ''}</div>`;
}
// « Série 4 supprimée · Annuler » à la place de la série retirée (deleteSet), là où le regard est déjà : au-dessus de la
// carte, la ligne sortait de l'écran sur un exercice long
function delUndoRows(ex, rows) {
  const u = sessUndo;
  if (u?.ex !== ex || u.delSi === undefined) return rows;
  const out = rows.slice();
  out.splice(Math.min(u.delSi, out.length), 0, exUndoHtml(u).replace('class="ex-undo"', 'class="ex-undo ex-undo--row"'));
  return out;
}
// Bloc (exercice ou superset) replié : toutes ses séries faites, aucune sous-série en attente, pas déplié à la main
function blockCollapsed(block, xs) {
  const ld = activeSession.lastDone;
  return block.every(i => xs[i].sets.length > 0 && xs[i].sets.every(s => s.done) && !techPending(xs, ld, i)) && !openDone.has(xs[block[0]]);
}
function exUndoBefore(block, xs) {
  const u = sessUndo;
  if (!u) return '';
  // « Annuler » d'une série : dans sa ligne ; si la dernière série referme la carte, la ligne passe au-dessus d'elle
  if (u.si !== undefined) return u.ex && block.some(i => xs[i] === u.ex) && blockCollapsed(block, xs) ? exUndoHtml(u) : '';
  // Série supprimée : à sa place dans la carte d'un exercice seul (delUndoRows), au-dessus d'un superset
  if (u.delSi !== undefined && block.length === 1 && !blockCollapsed(block, xs)) return '';
  if (u.ex && block.some(i => xs[i] === u.ex)) return exUndoHtml(u);
  if (u.at !== undefined && !u.ex && block[0] === u.at) return exUndoHtml(u);
  return '';
}
const openDone = new WeakSet(); // exercices terminés dépliés

// Série à faire : charge et reps reprises de src, « Avant » : la même série la dernière fois
function plannedSet(src, prev) {
  const s = {
    weight: src?.weight ?? '',
    reps:   src?.reps   ?? '',
    ...(src?.dist ? { dist: src.dist } : {}),
    plannedWeight: src?.weight ?? '',
    // machine : réglages de la dernière fois, point de départ du chrono (machineStart)
    // tech, sub : technique de la dernière fois (js/data/intensif.js), « Avant » de ses sous-séries
    // note : celle de la même série la dernière fois (js/features/session-notes.js), relue sous la série à faire
    prev:   prev ? { weight: prev.weight, reps: prev.reps, ...(prev.dist ? { dist: prev.dist } : {}), ...(prev.machine ? { machine: prev.machine } : {}), ...(cleanNote(prev.note) ? { note: cleanNote(prev.note) } : {}), ...techFields(prev), ...sideFields(prev) } : null,
    done:   false,
  };
  return s;
}

// Série de plus d'un exercice de la séance (« + Série », « + Tour ») : « La dernière fois » = la série de travail de même
// rang (échauffements retirés des deux côtés). Bloc de pré-fatigue ou d'échauffement (js/data/blocks.js) : ses séries,
// et la nouvelle est marquée comme elles
function pushPlannedSet(ex) {
  const last = lastPerf(activeSession.programme, activeSession.category, ex)?.ex;
  if (blockRole(ex)) {
    ex.sets.push({ ...plannedSet(ex.sets.at(-1), blockPrevSets(last)[ex.sets.length]), warmup: true });
    return;
  }
  const prevWork = workSets(last?.sets);
  ex.sets.push(plannedSet(workSets(ex.sets).at(-1) ?? ex.sets.at(-1), prevWork[workSets(ex.sets).length]));
}

// Séries d'un exercice pré-remplies série par série avec la dernière séance (sinon la dernière série faite).
// Les séries d'échauffement de la dernière fois ne comptent pas (js/data/warmup.js) : la 1re série de
// travail se compare à la 1re série de travail
// Dernière fois notée dans une autre mesure (vacuum en répétitions avant le 16/11/2026, mesure changée à la main) :
// ni « Avant » ni valeur reprise, « 12 reps » ne devient jamais « 12 s ». lastWeight / lastReps du programme ne
// viennent que des séances en répétitions (recomputePRFromHistory) : repris en répétitions seulement.
function buildSets(progKey, cat, exLike, n, fallback = {}) {
  const m = measureOf(exLike), last = lastPerf(progKey, cat, exLike);
  // Bloc du même exercice (js/data/blocks.js) : SA dernière fois ; bloc de pré-fatigue ou d'échauffement : ses séries
  // (toutes marquées), jamais la charge de travail de l'exercice en repli
  const prevSets = last && measureOf(last.ex) === m ? blockPrevSets(last.ex) : [];
  const base = m === 'reps' && !blockRole(exLike) ? { weight: fallback.lastWeight || '', reps: fallback.lastReps || '' } : { weight: '', reps: '' };
  return Array.from({ length: n }, (_, i) => {
    const src = prevSets[i] ?? prevSets.at(-1) ?? base;
    return plannedSet(capReps(src, exLike), prevSets[i]);
  });
}

// Reps reprises de la dernière fois, ramenées aux reps fixes quand il y en a (fixedReps) : un programme
// passé à « 5 × 5 » ne propose plus les 8 reps d'avant (panel du 07/11). Le 12 par défaut (écrit par
// l'éditeur même sans réglage) ne coupe rien.
function capReps(src, exLike) {
  const max = measureOf(exLike) === 'reps' ? fixedReps(exLike) : null;
  return max && parseInt(src.reps) > max ? { ...src, reps: String(max) } : src;
}

// Double progression : + 1 cran (loadStepKg : 2,5 kg ou 5 lb par défaut) sur chaque série de travail à faire (l'échauffement garde ses paliers), aux reps
// de l'objectif (goalRepsAfterBump, js/data/goals.js) : le bas de la fourchette, ces reps en reps fixes, sinon quelques
// reps sous le haut. Seulement quand on touche la puce ↑ (jamais d'office : demande de Maxence du 17/11). Renvoie ces reps.
function bumpExerciseLoad(ex) {
  const step = toUnitW(loadStepKg(sessExData(ex) || ex));   // cran de l'exercice (machine à crans de 5 kg…), unité affichée
  const lo = measureOf(ex) === 'reps' ? goalRepsAfterBump(sessExData(ex) || {}) : null;
  ex.sets.forEach(s => {
    if (s.done || isWarmupSet(s)) return;
    const cur = toUnitW(s.weight || s.prev?.weight) || 0;
    s.weight = storeW(String(Math.round((cur + step) * 100) / 100));
    s.plannedWeight = s.weight;
    if (lo) s.reps = String(lo);
  });
  ex.bumped = true;
  return lo;
}

function startSession(cat) {
  sessionNotes  = '';
  persistWarned = false;
  editingSet    = null;
  const progKey = cat === FREE ? FREE : data.activeProgramme;   // séance libre en direct : vide, hors programme (startFreeSession)
  const exList  = (progKey === FREE ? null : prog().exercises[cat]) || [];
  activeSession = {
    category:  cat,
    programme: progKey,
    startedAt: Date.now(),
    // Commencée avec le droit d'écrire : « Terminer » l'enregistrera même si l'accès prend fin pendant
    // la séance (le serveur l'accepte dans sa grâce bornée, js/features/paywall-ui.js)
    writeOk: typeof canWrite !== 'function' || canWrite(),
    // Bloc de plus du même exercice (js/data/blocks.js) : le suivi commun (exIdOf), son rang et son rôle
    exercises: exList.map(ex => ({ exId: exIdOf(ex), name: ex.name, ...blockFields(ex), measure: measureOf(ex), ...(ex.tempo ? { tempo: ex.tempo } : {}), ...(ex.tempoGuide === true ? { tempoGuide: true, tempoPrep: tempoPrepOf(ex) } : {}), ...(ssId(ex) ? { ss: ex.ss } : {}), ...(cleanGrip(ex.grip) ? { grip: cleanGrip(ex.grip) } : {}), ...(unilateralLimb(ex) && sideFirstPref(ex.name) === 'droit' ? { sideFirst: 'droit' } : {}), sets: buildSets(progKey, cat, ex, ex.sets, ex) })),
  };
  ssNormalize(activeSession.exercises);
  // Cases = la dernière fois (« Avant »), charge et reps, sans hausse d'office (demande de Maxence du 17/11 : « 24 × 13 »
  // pré-rempli après un 24 × 12, « je vais pas forcément réussir du premier coup »). Les décisions yn-v1 du 16/11 (hausse
  // de charge et objectif posés dans les cases, goalPrefill) sont retirées ; la puce ↑ reste pour monter soi-même.
  // Technique prescrite par le programme (coach ou soi : js/data/intensif.js), posée sur ses séries ; back-off
  // allégé (backoffPrefill). Programme d'un coach : reps dans sa fourchette (clampRepsToPlan), puis sa charge et
  // ses reps prescrites en premier (prescPrefill, js/data/coach-presc.js)
  const coachLed = coachLedProgramme(progKey);
  activeSession.exercises.forEach(ex => {
    const d = sessExData(ex);
    // Noté par bras la dernière fois (une série au moins) : tout l'exercice de nouveau par bras (js/data/unilateral.js)
    if (unilateralLimb(ex) && ex.sets.some(st => st.prev?.side2)) exSides(ex);
    // Premier bras d'aujourd'hui différent de la dernière fois : « Avant » de chaque ligne suit son bras
    if (exBySide(ex) && sideFirstOf(lastPerf(progKey, cat, ex)?.ex) !== sideFirstOf(ex)) ex.sets.forEach(swapSidePrev);
    applyIntensPlan(ex, d?.intens, d?.intensOn);
    if (coachLed) clampRepsToPlan(ex, d);
    backoffPrefill(ex);
    prescPrefill(ex, d);
    // Pré-fatigue, échauffement : séries marquées (hors volume, records, « À battre », muscles : js/data/blocks.js)
    if (blockRole(ex)) setBlockRole(ex, blockRole(ex));
  });
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
  showToast('Stockage plein, séance non enregistrée', { error: true });
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
    done:  xs.reduce((a, ex) => a + ex.sets.filter(setComplete).length, 0),   // série par bras : faite avec le bras droit
  };
}

// Bloc du programme correspondant à un exercice de la séance : même suivi, même rang (js/data/blocks.js) ; null s'il a
// été ajouté en cours de route
function sessExData(ex) {
  return ex?.exId ? (sessProg().exercises[activeSession.category] || []).find(e => exIdOf(e) === ex.exId && occOf(e) === occOf(ex)) || null : null;
}
// Badges de record en direct du bloc ex (liveExerciseBadges, js/data/records.js), calculés sur tout l'exercice : ses
// autres blocs de la séance comptent (js/data/blocks.js), jamais deux fois le même record dans une séance
function exBadges(ex) {
  const all = exerciseSetsAcross(activeSession.exercises, ex);
  const badges = liveExerciseBadges(all === ex.sets ? ex : { ...ex, sets: all }, livePrior(ex));
  if (all !== ex.sets) for (const k of [...badges.keys()]) if (!ex.sets.includes(k)) badges.delete(k);
  return badges;
}
// Nom affiché d'un exercice de la séance : « Extension quadriceps · 2 » pour son 2e bloc (js/data/blocks.js)
function exLabel(ex) { return blockName(ex, activeSession?.exercises); }

// Objectif de reps (ou de durée) d'une série : la même série la dernière fois, sinon l'objectif par
// défaut de l'exercice (premier essai). Montré en gris dans la case vide, pris si elle le reste.
function setGoal(ex, s) {
  const d = sessExData(ex);
  return String(s?.prev?.reps || defaultGoal(measureOf(ex), d?.repMin ?? d?.repMax, ex.name));
}
// Prescription de reps du programme : fourchette (« 8–12 reps ») si un bas est réglé, « 4 × 12 » en reps
// fixes (fixedReps, js/data/goals.js), sinon '' ; même règle que l'écran du coach (coachExPlanParts)
function repRangeText(ex) {
  const d = sessExData(ex);
  if (measureOf(ex) !== 'reps' || !d) return '';
  if (d.repMin) return `${d.repMin}–${d.repMax ?? 12} reps`;
  return fixedReps(d) ? setsRepsText({ ...d, measure: 'reps' }) : '';
}
// Même chose en HTML, « 4 séries de 12 reps » pour VoiceOver
function repRangeHtml(ex) {
  const d = sessExData(ex), txt = repRangeText(ex);
  return txt && !d.repMin ? setsRepsHtml({ ...d, measure: 'reps' }) : esc(txt);
}

function exRest(ex) {
  return sessExData(ex)?.rest ?? ex?.rest ?? holdGuide(ex)?.rest ?? data.defaultRest;   // vacuum : repos court par défaut
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

// Série suivante en deux morceaux : { name: « Développé incliné », tail: « Série 1 · 30 kg × 10 » } (tail = step + load), null sans.
// « Série 1 » en toutes lettres, plus « S1 » (panel « yeux neufs » du 16/11 : jargon pour un débutant).
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
  const step = sub ? sub.label : warmLook(ex, s) ? 'Échauffement' : `${holdGuide(ex) ? 'Maintien' : 'Série'} ${blockSetNo(ex, cur.si)}${hasSide2(s) ? ` · ${sideWord(ex, 1)}` : unilateralLimb(ex) && !isWarmupSet(s) ? ` · 2 ${unilateralLimb(ex) === 'jambe' ? 'jambes' : 'bras'}` : ''}`;   // compte des séries de travail, comme leur ligne ; par bras : le bras qui commence ; un bras sur une ligne : « 2 bras »
  return { name: exLabel(ex), step, load, tail: step + load, sub: !!sub, side: !sub && hasSide2(s) };
}
// « Développé incliné · Série 1 · 30 kg × 10 »
function nextSetText() {
  const p = nextSetParts();
  return p ? `${p.name} · ${p.tail}` : '';
}

// Puce « ↑ +2,5 kg » : la dernière fois a atteint le haut de la fourchette partout, ou l'a dépassé (goalBumpDue). Touchée,
// elle monte la charge des séries à faire (bumpExerciseLoad, ex.bumped) : rien n'est monté d'office dans les cases (17/11)
// Programme envoyé par un coach : jamais (c'est lui qui décide de la charge, coachLedProgramme)
function bumpReady(ex) {
  if (ex.bumped || ex.sets.every(s => s.done) || measureOf(ex) !== 'reps' || isAssisted(ex) || coachLedProgramme(activeSession.programme)) return false;
  const work  = workSets(ex.sets);
  // Série notée par bras la dernière fois : le côté le plus faible (weakSet), même règle que l'accueil
  const prevs = work.map(s => s.prev && weakSet(s.prev)).filter(p => p && (parseInt(p.reps) || 0) > 0);
  if (!prevs.length || prevs.length < Math.min(work.length, 2)) return false;
  // Même règle que l'objectif de l'accueil (goalBumpDue, js/data/goals.js) : haut atteint partout, ou dépassé
  return goalBumpDue(sessExData(ex) || { repMax: 12, sets: work.length }, prevs);
}

// Lignes repliées sous « 3 × 10/10/9 · 14 kg · 2 bras » (panel du 20/11 : le drop et les bras ne se voyaient pas) :
// les sous-séries (« Drop 10 kg × 6 », ou par bras s'ils diffèrent : « Drop : gauche 10 kg × 6 · droit 10 kg × 5 »),
// puis chaque bras s'ils diffèrent (« Bras gauche : 14 kg × 10, 10, 9 »). [] sans technique ni bras. Espaces
// insécables dans chaque morceau : une ligne ne se coupe qu'après un « · » suivi d'un morceau entier.
function doneExtraLines(ex) {
  if (measureOf(ex) !== 'reps') return [];
  const work = workSets(ex.sets), kind = loadKind(ex), nb = t => t.replace(/ /g, '\u00a0'), up = t => t.charAt(0).toUpperCase() + t.slice(1);
  const subsTxt = xs => xs.map(x => measureSetTxt(x, 'reps', kind)).join(', ');
  const parts = work.filter(s => subSetsOf(s).length).map(s => {
    const name = up(TECHS[setTech(s)].subName), a = subsTxt(subSetsOf(s)), b = hasSide2(s) ? subsTxt(side2SubsOf(s)) : null;
    if (b === null || b === a) return nb(`${name} ${a}`);
    return `${nb(`${name} :`)} ${nb(`${sideShort(ex, 1).toLowerCase()} ${a}`)} · ${nb(`${sideShort(ex, 2).toLowerCase()} ${b || '—'}`)}`;
  });
  const lines = parts.length ? [parts.join(' · ')] : [];
  const two = work.filter(hasSide2);
  // Chaque bras, toujours (la 1re ligne ne dit plus que « 3 séries · 14 kg · 2 bras »)
  if (two.length) {
    const txt = (sets, side) => `${sideName(ex, side)} : ${setsTextRead(sets, 'reps', kind)}`;
    lines.push(txt(two, 1), txt(two.map(s => s.side2), 2));
  }
  return lines;
}
// Ligne repliée d'un exercice terminé : « 4 × 8 · 32,5 kg » (reps différentes : « 10/10/9/8 »), allure du cardio
function doneSummary(ex) {
  const m = measureOf(ex);
  if (m !== 'reps') return ex.sets.map(s => measureSetTxt(s, m, setKind(ex))).join(' · ');
  // L'échauffement ne se résume pas ; bloc de pré-fatigue ou d'échauffement (js/data/blocks.js) : ses séries, c'est tout le bloc
  const work = blockRole(ex) ? ex.sets : workSets(ex.sets);
  const reps = work.map(s => String(s.reps));
  const same = reps.every(r => r === reps[0]);
  const maxW = Math.max(0, ...work.map(s => parseFloat(s.weight) || 0));
  // Noté par bras : « 3 séries · 14 kg · 2 bras », le détail de chaque bras dans les lignes « Bras gauche : … »,
  // « Bras droit : … » (doneExtraLines ; panel du 21/11 : « 3 × 10/10/9 » ne disait que le bras gauche)
  if (work.some(hasSide2)) {
    const w2 = Math.max(maxW, ...work.map(s => parseFloat(s.side2?.weight) || 0));
    return `${plural(work.length, 'série', 'séries')}${w2 ? ` · ${fmtW(w2, { plain: true })} ${unitLbl()}` : ''} · 2\u00a0${unilateralLimb(ex) === 'jambe' ? 'jambes' : 'bras'}`;
  }
  return `${work.length} × ${same ? reps[0] : reps.join('/')}${maxW ? ` · ${fmtW(maxW, { plain: true })} ${unitLbl()}` : ''}`;
}

// ── Vignettes des exercices ──────────────────────────────────
// Le personnage maison, muscle principal de l'exercice en rouge (img/muscles, la vignette de Programme › Séance et de la
// Bibliothèque), cadré sur le muscle (data-m, css/programme.css). Décorative et cachée à VoiceOver : le nom dit tout.
// Toucher = « Comment faire », comme le nom (même sens, pas un 2e arrêt VoiceOver). Texte agrandi : cachée (comme
// Programme). Image en cache après la 1re fois, décodée hors du fil principal : rien ne ralentit la validation.
let thumbMuscleIdx = null;   // index des muscles choisis, calculé une fois par rendu de la séance
function exThumbHtml(ex, ei, { cls = '', howTo = false } = {}) {
  const id = exerciseMuscles(sessExData(ex) || ex, thumbMuscleIdx || undefined).primary?.[0];
  if (!isMuscleId(id)) return '';
  const tap = howTo ? ` data-action="ex-howto" data-ei="${ei}"` : '';
  return `<span class="prow-thumb ex-thumb ${cls}" data-m="${esc(id)}" aria-hidden="true"${tap}><img class="mgc__img" src="img/muscles/${id}.webp" alt="" width="600" height="400" decoding="async"></span>`;
}

// ── Rendu de la séance ───────────────────────────────────────

function renderSession() {
  const meta = sessionMeta(activeSession.category, activeSession.programme);
  const { total, done } = sessionSetCounts();
  const pct  = total ? Math.round(done / total * 100) : 0;
  const cur  = currentSet();
  // « Pousser (Push) » quand il tient dans la barre, sinon le nom court (fitSessionTitle, après l'affichage)
  const longTitle = activeSession.programme === FREE ? meta.label : esc(sessionTitle(activeSession.category, activeSession.programme));

  const xs     = activeSession.exercises, tags = ssTags(xs);
  thumbMuscleIdx = chosenMusclesIndex();
  const exHtml = ssBlocks(xs).map(b => exUndoBefore(b, xs) + (b.length > 1 ? renderGroupCard(b, cur, tags) : renderExerciseCard(xs[b[0]], b[0], cur))).join('')
    + (sessUndo && sessUndo.at !== undefined && !sessUndo.ex && sessUndo.at >= xs.length ? exUndoHtml(sessUndo) : '');

  return `
    <div class="view session ${restActive ? 'session--resting' : ''}" style="--cat-color:${meta.color}">
      ${navBar({ large: false,
        title: `<span class="navbar__title-main"${longTitle !== meta.label ? ` data-short="${meta.label}"` : ''}>${longTitle}</span>
                <span class="navbar__title-ex" aria-hidden="true"></span>
                <span class="navbar__title-sub session-sub num"><span id="session-count">${done}/${total}</span> · <span id="session-clock">${fmtClock(Date.now() - activeSession.startedAt)}</span></span>`,
        left: `<button class="navbar__icon" data-action="back" aria-label="Réduire la séance">${icon('chevron.down', 24)}</button>`,
        right: `<button class="navbar__text navbar__text--bold" data-action="finish-session">Terminer</button>`,
        extra: `<div class="progress-bar session-progress" role="progressbar" aria-label="Séries validées" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}">
          <div class="progress-bar__fill" style="width:${pct}%"></div>
        </div>` })}
      <div class="session-content">
        ${renderMusicBar()}
        ${coachSessionProgTipHtml()}
        ${lastSessionNoteHtml()}
        ${exHtml}
        <button class="session-add-ex-btn" data-action="add-session-ex">${icon('plus', 20)} Ajouter un exercice</button>
      </div>
    </div>
    ${renderRestOverlay()}`;
}

// Exercice terminé : une ligne de résumé qui se déplie au tap
function renderCollapsedExercise(ex, ei, records, rir = '') {
  return `
      <div class="exercise-block ex-card ex-card--collapsed" data-ei="${ei}">
        <button class="ex-summary" data-action="toggle-ex" data-ei="${ei}" aria-expanded="false">
          ${exThumbHtml(ex, ei, { cls: 'ex-thumb--sm' })}
          <span class="ex-summary__text">
            <span class="ex-summary__name">${esc(exLabel(ex))}</span>
            <span class="ex-summary__line num">${blockRole(ex) ? `${blockRoleLabel(ex)} · ` : ''}${doneSummary(ex)}${records ? ` · ${medalSvg(14)}` : ''}</span>
            ${doneExtraLines(ex).map(l => `<span class="ex-summary__line num">${esc(l)}</span>`).join('')}
            ${collapsedNoteLineHtml(ex)}
          </span>
          <span class="set-check set-check--done ex-summary__check">${icon('checkmark', 18)}</span>
        </button>
        ${collapsedNoteBtnHtml(ex, ei)}${rir}
      </div>`;
}

// Retour du 12/11 (« pour le RIR, c'est pas pratique sur la dernière série ») : la dernière série d'un exercice ou d'un
// superset referme sa carte, et le sélecteur disparaissait avec elle (il fallait déplier la carte). Tant que cette
// série est la dernière validée de la séance, ses reps en réserve se notent sous le résumé replié, sans rien
// bloquer ; il s'en va à la série suivante validée ailleurs (activeSession.lastDone change).
function foldedRirHtml(block) {
  const ld = activeSession.lastDone;
  if (!ld || !block.includes(ld.ei) || !rirShown()) return '';
  const ex = activeSession.exercises[ld.ei], s = ex?.sets[ld.si];
  if (!s?.done || isWarmupSet(s) || measureOf(ex) !== 'reps' || TECHS[setTech(s)]?.sub || (hasSide2(s) && !setComplete(s))) return '';
  const tags = block.length > 1 ? ssTags(activeSession.exercises) : null;
  return `<div class="ex-fold-rir">${rirPickerHtml(ld.ei, ld.si, s, ex, tags ? tags[ld.ei] : '')}</div>`;
}

// Volume comparé au même nombre de séries que la dernière fois : jamais rouge en cours de séance.
// Seule une hausse s'affiche, en gris tant que l'exercice n'est pas fini, en vert ensuite.
function exVolumeHtml(ex, allDone) {
  if (measureOf(ex) !== 'reps') return '';
  const prevSets = workSets(lastPerf(activeSession.programme, activeSession.category, ex)?.ex.sets);
  const doneSets = workSets(ex.sets).filter(s => s.done);
  // Exercice à un bras : une série notée sur une ligne compte pour les deux bras (comparableVolume, js/data/unilateral.js)
  const prevSl   = prevSets.slice(0, doneSets.length);
  const curVol   = comparableVolume(ex, doneSets, currentBodyKg(), prevSl);
  const prevVol  = comparableVolume(ex, prevSl, currentBodyKg(), doneSets);
  const delta    = curVol - prevVol;
  return curVol > 0 && prevVol > 0 && Math.round(delta) > 0
    ? ` · <span class="ex-vol__delta ${allDone ? 'ex-vol__delta--up' : ''}">+${fmtVolume(delta)} de volume</span><span class="visually-hidden"> de plus que la dernière fois</span>` : '';
}

// Sous le nom : seulement la prescription du coach (« Coach : 60 kg × 8 », sa charge reste affichée toute la séance).
// La ligne « Objectif … » est retirée (demande de Maxence du 17/11) : il reste la fourchette, le repos et « Avant ».
// cls : 'ex-goal--member' sous un exercice de superset (aligné sur son nom)
function exGoalHtml(ex, cls = '') {
  const d = sessExData(ex);
  const t = d && measureOf(d) === 'reps' && hasPrescLoad(d) ? exerciseGoal(activeSession.category, d, activeSession.programme) : null;
  if (!t?.coach) return '';
  return `<div class="ex-goal ex-goal--coach num ${cls}"><span aria-hidden="true">Coach : ${esc(t.text)}</span><span class="visually-hidden">Prescrit par ${myCoachWord('ton')} : ${esc(t.spoken)}</span></div>`;
}

// Exercice jamais fait (aucune dernière fois, aucune charge prévue) et rien de validé : une ligne grise dit quelle
// charge prendre, à la place de l'objectif (panel « yeux neufs » du 16/11 : la case kg n'avait que « — »). Exercice
// en charge seulement : ni poids du corps, ni élastique, ni durée, ni cardio.
// cls : 'ex-goal--member' sous un exercice de superset (aligné sur son nom)
const FIRST_TIME_NO_LOAD = new Set(['aucun', 'elastique', 'cardio']);
function exFirstTimeHtml(ex, cls = '') {
  if (measureOf(ex) !== 'reps' || loadKind(ex) !== 'charge' || FIRST_TIME_NO_LOAD.has(equipmentOf(ex.name))) return '';
  if (ex.sets.some(s => s.done || s.prev || hasLoad(s.weight))) return '';
  return `<div class="ex-first ${cls}">Première fois : prends une charge que tu soulèves 15 fois facilement</div>`;
}

// Sous-titre de la carte : record, repos de l'exercice (modifiable), hausse de volume
// Record de l'en-tête de carte : celui du programme, remplacé dès qu'une série du jour le bat (même règle que
// js/data/store.js : charge plus lourde, ou mêmes kilos et plus de reps). Sans quoi l'en-tête affichait
// l'ancien record sous une série marquée « Record » (panel de la vague 3)
function liveHeadRecord(ex, pr) {
  if (isAssisted(ex)) return pr;
  return recordSets(ex.sets).filter(s => s.done && (parseInt(s.reps) || 0) > 0).reduce((best, s) => {   // par bras : le meilleur côté
    const w = parseFloat(s.weight) || 0, r = parseInt(s.reps) || 0, bw = parseFloat(best?.weight) || 0, br = parseInt(best?.reps) || 0;
    return !best || w > bw || (w === bw && r > br) ? { weight: s.weight, reps: s.reps } : best;
  }, pr || null);
}
function exSubHtml(ex, ei, allDone) {
  // Pré-fatigue, échauffement (js/data/blocks.js) : pas de record à viser sur ce bloc
  const pr   = measureOf(ex) === 'reps' && !blockRole(ex) && headRecordShown() && sessExData(ex)?.pr ? liveHeadRecord(ex, sessExData(ex).pr) : null;
  const rest = fmtRest(exRest(ex));
  const tempo = parseTempo(ex.tempo) && measureOf(ex) === 'reps'
    ? `<span class="tempo-pill num" aria-label="Tempo ${esc(shortTempo(ex.tempo))}${ex.tempoGuide === true ? ', guidé au son' : ''}">${ex.tempoGuide === true ? icon('music', 12) : ''}Tempo ${esc(shortTempo(ex.tempo))}</span> `
    : '';
  const range = repRangeHtml(ex);
  return `${tempo}${range ? `<span class="num">${range}</span> · ` : ''}${pr ? `<span class="num">Record ${fmtW(pr.weight, { plain: true })} × ${esc(pr.reps)}</span> · ` : ''}<button class="ex-rest-link num" data-action="set-ex-rest" data-ei="${ei}" aria-label="Repos ${fmtRestSpoken(exRest(ex))}, modifier">Repos ${rest}</button>${exVolumeHtml(ex, allDone)}`;
}

function renderExerciseCard(ex, ei, cur) {
  const doneN   = ex.sets.filter(setComplete).length;   // série notée par bras : comptée une fois le bras droit fait
  // Sous-série d'un drop set encore à faire (js/data/intensif.js) : la carte reste dépliée
  const allDone = ex.sets.length > 0 && doneN === ex.sets.length && !techPending(activeSession.exercises, activeSession.lastDone, ei);

  if (allDone && !openDone.has(ex)) {
    const records = exBadges(ex).size;   // js/data/records.js
    return renderCollapsedExercise(ex, ei, records, foldedRirHtml([ei]));
  }

  const howTo = !allDone && hasHowTo(ex);
  const chip = bumpReady(ex) ? `<button class="bump-chip" data-action="bump-weight" data-ei="${ei}" aria-label="Augmenter la charge de ${loadStepLabel(sessExData(ex) || ex)}">↑ ${loadStepLabel(sessExData(ex) || ex)}</button>` : '';
  // Séries d'échauffement (js/data/warmup.js) : en tête, sous un titre gris ; technique d'intensification
  // et ses sous-séries sous la série (js/features/session-intensif.js)
  // et ses sous-séries sous la série (js/features/session-intensif.js), puis le second côté d'une série notée par bras
  // (js/features/session-unilateral.js)
  // Bloc de pré-fatigue (js/data/blocks.js) : « Pré-fatigue » en tête, comme « Échauffement »
  const rows = delUndoRows(ex, ex.sets.map((s, si) => `${si === 0 && blockRole(ex) === 'prefat' ? '<div class="sets__caption">Pré-fatigue</div>' : si === 0 && warmLook(ex, s) ? '<div class="sets__caption">Échauffement</div>' : ''}${hasSide2(s) ? `<div class="sets__caption sets__caption--pair" aria-hidden="true">Série ${setDisplayNo(ex.sets, si)}</div>` : ''}${renderSetRow(ex, ei, s, si, cur)}${techBlockHtml(ex, ei, s, si)}${side2RowsHtml(ex, ei, s, si)}`)).join('');

  // Exercice de la série à faire : sa vignette cerclée d'orange (la série en cours, seul autre orange de la carte)
  const isCur = cur && cur.ei === ei;
  return `
    <div class="exercise-block ex-card ${allDone ? 'ex-card--done' : ''} ${isCur ? 'ex-card--current' : ''}" data-ei="${ei}">
      <div class="ex-card__top">
      ${exThumbHtml(ex, ei, { howTo })}
      <div class="ex-card__intro">
      <div class="ex-card__head">
        ${allDone
          ? `<button class="ex-card__name ex-card__name--btn" data-action="toggle-ex" data-ei="${ei}" aria-expanded="true">${esc(exLabel(ex))}</button>`
          : howTo
            ? `<h2 class="ex-card__name ex-card__name--howto"><button class="ex-howto" data-action="ex-howto" data-ei="${ei}" aria-label="${esc(exLabel(ex))}, comment faire"><span class="ex-howto__text">${howToNameHtml(exLabel(ex))}</span></button></h2>`
            : `<h2 class="ex-card__name">${esc(exLabel(ex))}</h2>`}
        ${chip}
        <span class="ex-card__count num"><span aria-hidden="true">${doneN}/${ex.sets.length}</span><span class="visually-hidden">${doneN} sur ${ex.sets.length} ${setNoun(ex, ex.sets.length)} ${holdGuide(ex) ? (ex.sets.length > 1 ? 'validés' : 'validé') : (ex.sets.length > 1 ? 'validées' : 'validée')}</span></span>
        <button class="ex-card__more" data-action="ex-menu" data-ei="${ei}" aria-label="Options de ${esc(exLabel(ex))}">${icon('ellipsis', 22)}</button>
      </div>
      ${exGoalHtml(ex)}${exFirstTimeHtml(ex)}
      ${gripLineHtml(ex, ei)}
      ${exNoteLineHtml(ex, ei)}
      <div class="ex-card__sub">${exSubHtml(ex, ei, allDone)}</div>
      </div>
      </div>
      ${bandPickerHtml(ex, ei)}
      ${coachSessionTipHtml(ex)}
      ${sideFirstLinkHtml(ex, ei)}
      <div class="sets${ex.sets.some(st => warmLook(ex, st)) ? ' sets--warm' : ''}${exBySide(ex) ? ' sets--sides' : ex.sets.some(st => TECHS[setTech(st)]?.sub) ? ' sets--tech' : ''}${holdGuide(ex) ? ' sets--noload' : ''}" role="group" aria-label="${holdGuide(ex) ? 'Maintiens' : 'Séries'} de ${esc(exLabel(ex))}${blockRole(ex) ? `, ${blockRoleLabel(ex).toLowerCase()}` : ''}">
        <div class="sets__head" aria-hidden="true">
          <span>${holdGuide(ex) ? 'N°' : 'Série'}</span><span>Avant</span>
          <span>${loadHeader(ex)}</span><span>${MEASURES[measureOf(ex)].count}</span>
          <span>${icon('checkmark', 14)}</span>
        </div>
        ${rows}
      </div>
      <div class="ex-card__foot">
        <button class="add-set-link" data-action="add-set" data-ei="${ei}" aria-label="Ajouter ${holdGuide(ex) ? 'un maintien' : 'une série'}, ${esc(ex.name)}">${icon('plus', 16)} ${holdGuide(ex) ? 'Maintien' : 'Série'}</button>
        ${exNoteFootHtml(ex, ei)}
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
  const doneN   = exs.reduce((a, ex) => a + ex.sets.filter(setComplete).length, 0);
  const allDone = total > 0 && doneN === total && !members.some(ei => techPending(xs, activeSession.lastDone, ei));
  const head    = members[0], kind = ssKind(members.length);

  if (allDone && !openDone.has(exs[0])) {
    return `
      <div class="exercise-block ex-card ex-card--collapsed ss-card" data-ei="${head}">
        <button class="ex-summary" data-action="toggle-ex" data-ei="${head}" aria-expanded="false">
          <span class="ex-summary__text">
            <span class="ex-summary__name">${kind}</span>
            ${members.map(ei => `<span class="ex-summary__line num"><span class="ss-tag ss-tag--sm">${tags[ei]}</span>${esc(exLabel(xs[ei]))} · ${doneSummary(xs[ei])}</span>${doneExtraLines(xs[ei]).map(l => `<span class="ex-summary__line num">${esc(l)}</span>`).join('')}`).join('')}
          </span>
          <span class="set-check set-check--done ex-summary__check">${icon('checkmark', 18)}</span>
        </button>${foldedRirHtml(members)}
      </div>`;
  }

  const legend = members.map(ei => {
    const ex = xs[ei], n = ex.sets.filter(setComplete).length;
    const howTo = !allDone && hasHowTo(ex);
    const chip = bumpReady(ex) ? `<button class="bump-chip" data-action="bump-weight" data-ei="${ei}" aria-label="Augmenter la charge de ${loadStepLabel(sessExData(ex) || ex)}, ${esc(ex.name)}">↑ ${loadStepLabel(sessExData(ex) || ex)}</button>` : '';
    return `
        <div class="ss-member">
          <span class="ss-tag" aria-hidden="true">${tags[ei]}</span>
          ${howTo
            ? `<button class="ex-howto ss-member__name" data-action="ex-howto" data-ei="${ei}" aria-label="${esc(exLabel(ex))}, comment faire"><span class="ex-howto__text">${howToNameHtml(exLabel(ex))}</span></button>`
            : `<span class="ss-member__name">${esc(exLabel(ex))}</span>`}
          ${chip}
          <span class="ex-card__count num"><span aria-hidden="true">${n}/${ex.sets.length}</span><span class="visually-hidden">${n} sur ${plural(ex.sets.length, 'série validée', 'séries validées')}</span></span>
          <button class="ex-card__more" data-action="ex-menu" data-ei="${ei}" aria-label="Options de ${esc(exLabel(ex))}">${icon('ellipsis', 22)}</button>
        </div>${exGoalHtml(ex, 'ex-goal--member')}${exFirstTimeHtml(ex, 'ex-goal--member')}`;
  }).join('');

  const rounds = ssRounds(xs, members).map((round, t) => `
        <div class="ss-round" role="group" aria-label="Tour ${t + 1}">
          <div class="ss-round__title">Tour ${t + 1}</div>
          ${round.map(({ ei, si }) => `${renderSetRow(xs[ei], ei, xs[ei].sets[si], si, cur, tags[ei])}${techBlockHtml(xs[ei], ei, xs[ei].sets[si], si)}${side2RowsHtml(xs[ei], ei, xs[ei].sets[si], si, tags[ei])}`).join('')}
        </div>`).join('');
  const rest = fmtRest(exRest(xs[members.at(-1)]));
  const m0   = exs[0];
  // Vignettes des exercices enchaînés, côte à côte devant « Superset » (les lignes A1, A2 gardent la place des noms) ;
  // celle de l'exercice de la série à faire cerclée d'orange. Circuit de 4 ou 5 : pas la place, aucune
  const thumbs = members.length > 3 ? '' : `<span class="ss-thumbs">${members.map(ei => exThumbHtml(xs[ei], ei, { cls: `ex-thumb--sm${cur && cur.ei === ei ? ' ex-thumb--current' : ''}`, howTo: !allDone && hasHowTo(xs[ei]) })).join('')}</span>`;

  return `
    <div class="exercise-block ex-card ss-card ${allDone ? 'ex-card--done' : ''}" data-ei="${head}">
      <div class="ex-card__head">
        ${thumbs}
        ${allDone
          ? `<button class="ex-card__name ex-card__name--btn" data-action="toggle-ex" data-ei="${head}" aria-expanded="true">${kind}</button>`
          : `<h2 class="ex-card__name">${kind}</h2>`}
        <span class="ex-card__count num"><span aria-hidden="true">${doneN}/${total}</span><span class="visually-hidden">${doneN} sur ${plural(total, 'série validée', 'séries validées')}</span></span>
      </div>
      <div class="ex-card__sub"><button class="ex-rest-link num" data-action="set-ex-rest" data-ei="${members.at(-1)}" aria-label="Repos ${fmtRestSpoken(exRest(xs[members.at(-1)]))} après chaque tour, modifier">Repos ${rest} après chaque tour</button></div>
      <div class="ss-members">${legend}</div>
      ${members.map(ei => gripLineHtml(xs[ei], ei, tags[ei])).join('')}
      ${members.map(ei => exNoteLineHtml(xs[ei], ei, tags[ei])).join('')}
      ${members.map(ei => coachSessionTipHtml(xs[ei], tags[ei])).join('')}
      <div class="sets${exs.some(ex => ex.sets.some(st => warmLook(ex, st))) ? ' sets--warm' : ''}" role="group" aria-label="Séries du ${kind.toLowerCase()}">
        <div class="sets__head" aria-hidden="true">
          <span>Exo</span><span>Avant</span>
          <span>${loadHeader(m0, exs.every(isDumbbellExercise))}</span><span>${MEASURES[measureOf(m0)].count}</span>
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
  const warm   = isWarmupSet(s), look = warmLook(ex, s);   // pré-fatigue : hors records, mais « Série 1 » (js/data/blocks.js)
  // js/data/records.js ; série notée par bras : le badge va sur la ligne du meilleur côté (js/data/unilateral.js)
  const record = warm || recordSet(s).side === 2 ? '' : exBadges(ex).get(s) || '';
  const side = hasSide2(s);   // nom du côté : dans la colonne du numéro (withSideTag)
  const first  = setFirstValue(s, m);
  const kind   = m === 'cardio' ? 'charge' : m === 'time' ? 'lest' : loadKind(ex);
  const load   = first ? `${{ charge: '', lest: 'plus ', aide: 'aide de ' }[kind]}${first} ${m === 'cardio' ? 'kilomètres' : data.unit === 'lbs' ? 'livres' : 'kilos'}, ` : '';
  const pk     = m === 'cardio' ? paceKind(ex) : null;
  const pace   = pk ? cardioPace(s.dist, setMinutes(s), pk) : null;
  const mach   = m === 'cardio' ? machineTxt(s.machine) : '';
  // RIR (js/data/rir.js) : sélecteur sous la dernière série validée, badge « RIR 2 » sur les autres
  const last   = activeSession.lastDone?.ei === ei && activeSession.lastDone?.si === si;
  // Pas de sélecteur sur une série suivie de mini-séries, drops ou blocs (poussée à l'échec, js/data/intensif.js) : il
  // s'intercalait entre la série et sa mini-série pendant la pause de 15 s (panel vague 4)
  const sub    = TECHS[setTech(s)]?.sub || hasSide2(s);   // le second côté suit, sans repos : pas de sélecteur entre les deux
  const rir    = m === 'reps' && !warm ? (last && rirShown() && !sub ? rirPickerHtml(ei, si, s, ex) : rirBadgeHtml(s)) : '';
  const rirSpoken = cleanRir(s.rir) !== null ? `, ${rirTxt(s.rir)} en réserve` : '';
  const noteSpoken = cleanNote(s.note) ? `, avec note : ${esc(cleanNote(s.note))}` : '';   // js/features/session-notes.js
  // La ligne se corrige au toucher (data-action sur la ligne) ; pour VoiceOver, le bouton « Modifier » est sa phrase, pas
  // la ligne entière : la case « Avant » (sa note) et « Annuler » sont des boutons à part, jamais un bouton dans un bouton.
  // « Annuler » en ligne pendant 6 s : la phrase n'est plus annoncée comme un bouton, « Annuler » a sa propre action
  const u = undoForSet(ex, si);
  return `
      <div class="set-swipe">
        ${del}
        <div class="session-set session-set--done ${look ? 'session-set--warmup' : ''}" data-action="edit-set" data-ei="${ei}" data-si="${si}">
          <span class="sr-text" ${u ? '' : 'role="button" tabindex="0"'}>${setSpokenName(ex, si)} validé${look || holdGuide(ex) ? '' : 'e'}, ${side ? `${sideName(ex, 1).toLowerCase()}, ` : ''}${load}${esc(s.reps)} ${M.spoken}${pace ? `, ${spokenPace(pace, pk)}` : ''}${mach ? `, ${esc(mach)}` : ''}${rirSpoken}${noteSpoken}${techPillHtml(s) ? `, ${TECHS[setTech(s)].label}` : ''}${tag ? `, ${esc(ex.name)}` : ''}${record ? `, ${esc(record)}` : ''}. Modifier</span>
          ${withSideTag(setNumHtml(ex, si, tag).replace(/^<span (?!aria-hidden)/, '<span aria-hidden="true" '), ex, s, 1)}
          ${u ? setUndoHtml(u) : setNoteBtnHtml(ex, ei, s, si, prev, prevSpoken(s, m), sideNoteWho(ex, si, s, 1))}
          <span class="set-val set-val--w num" aria-hidden="true"${hasSide2(s) ? ` data-lbl="${unitLbl()}"` : ''}>${first || '—'}</span>
          <span class="set-val set-val--r num" aria-hidden="true"${hasSide2(s) ? ' data-lbl="Reps"' : ''}>${esc(s.reps)}</span>
          <span class="set-check-zone" aria-hidden="true"><span class="set-check set-check--done">${icon('checkmark', 18)}</span></span>
          ${record || pace || mach || techPillHtml(s) ? `<span class="set-badge" aria-hidden="true">${techPillHtml(s, { spoken: false })}${record ? `<span class="pr-badge">${medalSvg(13)}${esc(record)}</span>` : ''}${pace ? `<span class="pace-badge">${fmtPace(pace, pk)}</span>` : ''}${mach ? `<span class="mach-badge">${esc(mach)}</span>` : ''}</span>` : ''}
          ${setNotePreviewHtml(ei, s, si)}
        </div>
        ${rir}
      </div>`;
}

// « Série 2 », « Échauffement 1 » (VoiceOver, toasts) : les séries d'échauffement ont leur propre compte ;
// setRefName : la même chose avec son article (« la série 2 », « l'échauffement 1 »)
function setSpokenName(ex, si) {
  const s = ex.sets[si];
  if (warmLook(ex, s)) return `Échauffement ${ex.sets.slice(0, si + 1).filter(isWarmupSet).length}`;
  return `${holdGuide(ex) ? 'Maintien' : 'Série'} ${blockSetNo(ex, si)}`;   // vacuum : « Maintien 2 »
}
function setRefName(ex, si) {
  const n = setSpokenName(ex, si);
  return warmLook(ex, ex.sets[si]) ? `l'${n.toLowerCase()}` : `${holdGuide(ex) ? 'le' : 'la'} ${n.toLowerCase()}`;
}

// Sélecteur RIR d'une série validée : 0 à 4+, l'équivalent RPE à côté du choix ; un nouveau toucher sur le
// même bouton efface. Facultatif : rien n'attend ce choix. Placé sous la ligne, hors de son bouton « Modifier »
// (pas de boutons imbriqués dans un rôle bouton)
// Le sens des « reps en réserve » dit tant que la personne n'en a jamais noté (panel de la vague 3 : sans phrase,
// « 0 1 2 3 4+ » ne disait ni à quoi ils servent ni qu'on peut les laisser)
let rirUsedCache = null;
function rirEverUsed() {
  const h = data.history || [];
  if (activeSession?.exercises.some(e => e.sets.some(x => cleanRir(x.rir) !== null))) return true;
  if (rirUsedCache?.h !== h || rirUsedCache.n !== h.length) {
    rirUsedCache = { h, n: h.length, used: h.some(e => (e.exercises || []).some(x => (x.sets || []).some(y => cleanRir(y.rir) !== null))) };
  }
  return rirUsedCache.used;
}
// Sélecteur apparu sous le doigt juste après la validation d'une série : le toucher suivant tombait dessus (« 4+ »
// noté sans le vouloir en séance, 22/11). Ses boutons ignorent les touchers pendant RIR_GUARD_MS après son apparition
// (au clic, rien au pointerdown : un seul tap sur iOS). rirShownAt : 'ei:si' → instant d'apparition ; la validation
// d'une série l'efface (rirRearm), le prochain rendu du sélecteur le repose.
const RIR_GUARD_MS = 700;
const rirShownAt = new Map();
function rirRearm(ei, si) { rirShownAt.delete(`${ei}:${si}`); }
function rirTooSoon(ei, si, now = Date.now()) {
  const at = rirShownAt.get(`${ei}:${si}`);
  return at !== undefined && now - at < RIR_GUARD_MS;
}
// tag : lettre du superset (A2) quand le sélecteur est sous le résumé replié de sa carte (foldedRirHtml)
function rirPickerHtml(ei, si, s, ex, tag = null) {
  if (!rirShownAt.has(`${ei}:${si}`)) rirShownAt.set(`${ei}:${si}`, Date.now());
  const r = cleanRir(s.rir), folded = tag !== null;
  return `<div class="rir" role="group" aria-label="Répétitions en réserve, ${setSpokenName(ex, si)}${folded ? `, ${esc(ex.name)}` : ''}">
            <span class="rir__lbl" aria-hidden="true">Reps en réserve${folded ? ` · ${tag ? `${tag} · ` : ''}Série ${setDisplayNo(ex.sets, si)}` : ''}</span>${rirEverUsed() ? '' : `
            <span class="rir__help">Facultatif : reps que tu aurais encore pu faire</span>`}
            <span class="rir__btns">${RIR_CHOICES.map(c => `<button class="rir__btn num" data-action="set-rir" data-ei="${ei}" data-si="${si}" data-rir="${c}" aria-pressed="${r === c}" aria-label="${rirTxt(c)} en réserve, RPE ${rirToRpe(c)}">${rirTxt(c)}</button>`).join('')}</span>
            <span class="rir__rpe num" aria-live="polite">${r === null ? '' : `RPE ${rirToRpe(r)}`}</span>
          </div>`;
}
function rirBadgeHtml(s) {
  const r = cleanRir(s.rir);
  return r === null ? '' : `<span class="set-badge"><span class="rir-badge num">${rirTxt(r)} en réserve</span></span>`;
}

// En-tête de la colonne de charge : kg (barre), kg par haltère (sur deux lignes, isDumbbellExercise), +kg (lest ajouté
// au poids du corps, comme « 8 reps · +10 kg »), Aide (machine d'assistance), km (cardio)
// Superset : « par haltère » seulement si tous ses exercices sont aux haltères (perDb)
function loadHeader(ex, perDb = isDumbbellExercise(ex)) {
  const m = measureOf(ex);
  if (m !== 'reps') return MEASURES[m].load();
  if (perDb) return `<span class="sets__unit">${unitLbl()}<small>par haltère</small></span>`;
  return { charge: unitLbl(), lest: `+${unitLbl()}`, aide: 'Aide' }[loadKind(ex)];
}
// Même colonne, en toutes lettres pour VoiceOver (en-tête et champs) : « Charge ajoutée » plutôt que « Lest »
function loadSpoken(ex) {
  const m = measureOf(ex);
  if (m === 'cardio') return 'Distance';
  if (m === 'reps' && isDumbbellExercise(ex)) return 'Charge par haltère';
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

// Première colonne : numéro de la série de travail (l'échauffement ne décale pas la numérotation), ou A1, A2… dans
// un superset (affiché tour par tour). Échauffement : « Échauf. » (colonne élargie, .sets--warm), « É » sur un écran
// étroit (css/session.css) ; VoiceOver lit toujours « Échauffement 1 » (setSpokenName, dans les libellés de la ligne)
const WARM_NUM_HTML = '<span class="set-n__long">Échauf.</span><span class="set-n__short">É</span>';
function setNumHtml(ex, si, tag) {
  if (tag) return `<span class="set-n"><span class="ss-tag">${tag}</span></span>`;
  if (warmLook(ex, ex.sets[si])) return `<span class="set-n set-n--warm" aria-hidden="true">${WARM_NUM_HTML}</span>`;
  return `<span class="set-n num">${blockSetNo(ex, si)}</span>`;
}

// Disques (js/data/plates.js) : sur la série à faire d'un exercice à barre, le numéro laisse place à un
// bouton qui ouvre la feuille « Disques » pour la charge de la série (ou celle de la dernière fois). Le numéro reste, un petit
// disque (vu de face, avec ses trous de prise) à côté dit ce que le bouton ouvre : seul, il passait pour une cible ou un
// « top set » (panels de la vague 3) ; l'haltère reste à l'onglet Entraînement
function setPlatesHtml(ex, ei, s, si) {
  const kg = s.weight !== '' ? s.weight : s.prev?.weight;
  const load = kg !== '' && kg != null ? `${fmtW(kg, { plain: true })} ${unitLbl()}` : '';
  return `<button class="set-n set-plates" data-action="open-plates" data-ei="${ei}" data-si="${si}" aria-label="Disques à charger${load ? ` pour ${load}` : ''}, ${setSpokenName(ex, si)}"><span class="num">${warmLook(ex, s) ? 'É' : blockSetNo(ex, si)}</span>${icon('plate', 16)}</button>`;   // échauffement : « É », comme sa ligne validée (jamais « 0 »)
}

// ▶ de la série à faire : chrono d'un maintien, série guidée au tempo, ou chrono d'une machine de cardio
// (js/features/effort-machine.js ; déjà lancé et feuille fermée : le même bouton la rouvre)
function setPlayHtml(ex, ei, s, si) {
  const m = measureOf(ex), e = activeSession.effort;
  const live = e?.kind === 'machine' && e.ei === ei && e.si === si;
  const what = m === 'cardio' ? (live ? 'Rouvrir le chrono en cours' : 'Lancer le chrono et noter le réglage de la machine')
    : m === 'time' ? 'Lancer le chrono' : `Lancer la série guidée au tempo ${esc(ex.tempo)}`;
  const goal = s.reps && m !== 'cardio' ? `, ${esc(s.reps)} ${m === 'time' ? 'secondes' : 'répétitions'}` : '';
  return `<button class="set-n set-play${live ? ' set-play--live' : ''}" data-action="start-effort" data-ei="${ei}" data-si="${si}" aria-label="${what}, ${setSpokenName(ex, si).toLowerCase()}, ${esc(ex.name)}${goal}">${icon(live ? 'timer' : 'play', 16)}</button>`;
}

// « Avant » dit à VoiceOver (« 32 × 9 ») : la valeur affichée dans la case, sans espace insécable
function prevSpoken(s, m) {
  if (!s.prev) return '';
  const f = setFirstValue(s.prev, m);
  return `${f ? `${f} × ` : ''}${esc(s.prev.reps)}`;
}

function renderSetRow(ex, ei, s, si, cur, tag) {
  const m       = measureOf(ex);
  const prevF   = setFirstValue(s.prev, m);
  // « 14 × 10 » jamais coupé (insécable et sans retour à la ligne, set-prev__val : css/session.css)
  const prev    = s.prev ? `<span class="set-prev__val">${prevF ? prevF + '&nbsp;×&nbsp;' : ''}${esc(s.prev.reps)}</span>` : '—';
  const editing = editingSet && editingSet.ei === ei && editingSet.si === si;
  // Caché à VoiceOver et inactif tant que le balayage ne l'a pas révélé (setDelShown, js/features/session-gestures.js) : lu
  // avant chaque série, un double toucher supprimait sans le vouloir (panel « yeux neufs » du 16/11). Sans balayage :
  // ⋯ › Plus d'options › « Retirer la dernière série ». Numéro affiché, échauffements à part
  const del     = `<button class="set-del" data-action="delete-set" data-ei="${ei}" data-si="${si}" tabindex="-1" aria-hidden="true" aria-label="Supprimer ${setRefName(ex, si)}, ${esc(ex.name)}">Supprimer</button>`;

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
  // VoiceOver (regard neuf du 16/11, lecteur d'écran) : le groupe dit l'exercice (« Séries de … »), la tête de ligne la
  // série ; les champs ne disent que ce qu'ils attendent. Le ✓ garde la série (il se cherche aussi seul, rotor Boutons) ;
  // le nom de l'exercice ne revient que dans un superset, où les séries de plusieurs exercices alternent
  // Série notée par bras : le côté dans le ✓ et les champs (« Valider la série 3, bras gauche », « Charge du bras
  // gauche, en kilos » : panel du 20/11) ; exOf garde le nom de l'exercice d'un superset
  const sideOf = hasSide2(s) ? `, ${sideWord(ex, 1)}` : '';
  const exOf  = `${sideOf}${tag ? `, ${esc(ex.name)}` : ''}`;
  const check = editing
    ? `<button class="set-check-zone" data-action="save-edit-set" aria-label="Enregistrer ${ref}${exOf}"><span class="set-check set-check--edit">${icon('checkmark', 18)}</span></button>`
    : waitFor >= 0
      // Une série plus haut n'est pas faite : on valide dans l'ordre (le ✓ grisé le rappelle au toucher)
      ? `<button class="set-check-zone set-check-zone--wait" data-action="validate-set" data-ei="${ei}" data-si="${si}" aria-disabled="true" aria-label="${name}${exOf} : valide d'abord ${setRefName(ex, waitFor)}"><span class="set-check"></span></button>`
      : `<button class="set-check-zone" data-action="validate-set" data-ei="${ei}" data-si="${si}" aria-label="Valider ${ref}${exOf}"><span class="set-check"></span></button>`;
  // Première colonne de la série à faire : ▶ (chrono, tempo, machine), sinon « Disques » sur une barre, sinon le numéro
  const isNext = !editing && si === first;
  const play   = isNext && (m === 'time' || (m === 'reps' && parseTempo(ex.tempo) && ex.tempoGuide === true) || hasMachineClock(ex));
  // Ailleurs, le numéro d'une série de travail ouvre le choix d'une technique d'intensification (comme Hevy)
  // Simple numéro : caché, la tête de ligne lue est « Série 2 » (« Série 2, Rowing barre » dans un superset) ; ▶, Disques et
  // le numéro des techniques sont des boutons qui disent déjà la série
  const firstCol = withSideTag(play ? setPlayHtml(ex, ei, s, si) : isNext && !tag && isBarbellExercise(ex) ? setPlatesHtml(ex, ei, s, si)
    : !tag && !warm && canTech(ex) ? setTechNumHtml(ex, ei, si)
    : `<span class="visually-hidden">${name}${exOf}</span>${setNumHtml(ex, si, tag).replace(/^<span (?!aria-hidden)/, '<span aria-hidden="true" ')}`, ex, s, 1);
  // Série validée rouverte : le RIR se corrige là aussi (js/data/rir.js)
  const rir = editing && m === 'reps' && !warm && rirShown() ? rirPickerHtml(ei, si, s, ex) : '';
  return `
    <div class="set-swipe">
      ${editing ? '' : del}
      <div class="session-set ${isCur ? 'session-set--current' : ''} ${editing ? 'session-set--editing' : ''} ${warm ? 'session-set--warmup' : ''}" ${isCur ? 'aria-current="step"' : ''} data-ei="${ei}" data-si="${si}">
        ${firstCol}
        ${undoForSet(ex, si) ? setUndoHtml(undoForSet(ex, si)) : setNoteBtnHtml(ex, ei, s, si, `${s.prev ? '<span class="set-prev__lbl" aria-hidden="true">Avant </span>' : ''}${prev}`, prevSpoken(s, m), sideNoteWho(ex, si, s, 1))}
        <input type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" class="set-input num" ${wAttr}
               value="${esc(wVal)}" placeholder="${prevW || '—'}" aria-label="${sideOf ? sideFieldName(ex, 1, 'w') : `${loadSpoken(ex)}, en ${m === 'cardio' ? 'kilomètres' : unitLbl()}`}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="${editing ? 'done' : 'next'}" autocomplete="off" class="set-input set-input--required num" ${rAttr}
               value="${esc(rVal)}" placeholder="${esc(setGoal(ex, s))}" aria-label="${sideOf ? sideFieldName(ex, 1, 'r') : countSpoken(ex)}">
        ${check}
        ${techPillHtml(s) ? `<span class="set-badge">${techPillHtml(s)}</span>` : ''}
        ${setNotePreviewHtml(ei, s, si)}
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

// Série supprimée (balayage, ou ⋯ › « Retirer la dernière série ») : « Série 2 supprimée · Annuler » au-dessus de la carte,
// comme la validation ; « Annuler » la remet à sa place, avec la série en cours d'avant
function deleteSet(ei, si) {
  const ex = activeSession?.exercises[ei];
  const s = ex?.sets[si];
  if (!s) return;
  if (ex.sets.length === 1) { closeSwipes(); showToast('Dernière série : retire l\'exercice avec ⋯'); return; }
  if (activeSession.effort?.ei === ei) cancelEffort();   // les positions des séries changent
  const name = setSpokenName(ex, si), lastDone = activeSession.lastDone ?? null;
  ex.sets.splice(si, 1);
  activeSession.lastDone = null;
  editingSet = null;
  haptic();
  persistSession();
  sessionUndo(`${name} supprimé${warmLook(ex, s) || holdGuide(ex) ? '' : 'e'}`, { target: { ex, delSi: si }, onAction: () => {
    if (!activeSession?.exercises.includes(ex) || ex.sets.includes(s)) return;
    ex.sets.splice(Math.min(si, ex.sets.length), 0, s);
    activeSession.lastDone = lastDone;
    clearSessionUndo();
    persistSession();
    render();
  } });
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
  rirRearm(ei, si);              // le sélecteur RIR qui va apparaître ignore les touchers un instant
  ex.startedAt ??= Date.now();   // ordre réel de la séance dans l'historique (orderByStart, js/data/session-order.js)
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
  if (opts.undoSides) undo.undoSides = opts.undoSides;   // tempo guidé à un bras : seconds côtés d'avant (finishTempo)
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
  const doneTxt = `${setSpokenName(ex, si)} validé${warmLook(ex, s) || holdGuide(ex) ? '' : 'e'}`;
  // Série notée par bras sans sous-série avant l'autre côté : « puis bras droit » (js/data/unilateral.js)
  const nx = setNextStep(s);
  const next = chain ? `enchaîne ${xs[chain.ei].name}` : nx?.k < 0 ? `puis ${sideName(ex, 2).toLowerCase()}` : techPause !== null ? `puis ${TECHS[setTech(s)].label.toLowerCase()}` : '';
  // Série notée par bras : « Bras gauche validé · au tour du droit » (la série n'est pas finie : panel du 21/11), puis
  // « Annuler » dans le bandeau au-dessus de la carte, « Avant » reste dans la ligne
  const text = hasSide2(s) ? sideStepText(ex, s, si, -1, 1, nx) : next ? `${doneTxt} · ${next}` : doneTxt;
  sessionUndo(text, { target: hasSide2(s) ? { ex } : { ex, si }, onAction: () => undoValidate(undo) });
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
  // Pas vers une série prévue à une autre charge : back-off après un top set, charge prescrite différente
  const otherPlan = (setTech(s) === 'top' && setTech(nextSet) === 'backoff') || String(s.pk ?? '') !== String(nextSet.pk ?? '');
  if (!otherPlan && (parseFloat(s.weight) || 0) !== (parseFloat(s.plannedWeight) || 0)) nextSet.weight = s.weight;
  // Reps : reprises seulement si rien n'était prévu (premier essai d'un exercice), jamais un objectif écrasé
  if (String(nextSet.reps ?? '').trim() === '' && s.reps) nextSet.reps = s.reps;
  return undo;
}

// Saisie d'une charge (ou de reps) sur une série de travail à faire : recopiée dans les séries de travail suivantes à
// faire dont la case est vide (Mehdi, regard neuf du 16/11 : « 100 » tapé en série 1, séries 2 et 3 restées à « — »).
// Jamais une valeur déjà là, jamais l'échauffement, ni une charge prescrite par le coach (pk) ni un back-off (sa
// charge allégée vient du top set, js/data/intensif.js). Une case remplie ainsi suit la frappe (« 1 », « 10 », « 100 »)
// tant qu'on ne l'a pas touchée soi-même : autoFilled, gardé en mémoire seulement (un rechargement la fige).
// Renvoie les index des séries changées.
const autoFilled = new WeakMap();   // série → { weight, reps } : la série d'où vient la copie de ce champ
function fillFollowingSets(ex, si, field) {
  const s = ex?.sets[si];
  if (autoFilled.get(s)) delete autoFilled.get(s)[field];   // tapée à la main : n'est plus une copie
  if (!s || s.done || isWarmupSet(s) || measureOf(ex) === 'cardio') return [];
  const changed = [];
  for (let j = si + 1; j < ex.sets.length; j++) {
    const t = ex.sets[j];
    if (t.done || isWarmupSet(t) || setTech(t) === 'backoff' || String(t.pk ?? '') !== String(s.pk ?? '')) continue;
    // Vide, ou copie d'une série au-dessus (celle-ci ou une plus haute) : une case suit la série tapée la plus proche
    const from = autoFilled.get(t)?.[field];
    if (from ? ex.sets.indexOf(from) > si : String(t[field] ?? '').trim() !== '') continue;
    if (t[field] === s[field]) continue;
    t[field] = s[field];
    if (!autoFilled.has(t)) autoFilled.set(t, {});
    autoFilled.get(t)[field] = s;
    changed.push(j);
  }
  return changed;
}
// Les cases à l'écran suivent la donnée, sans re-rendu (le clavier reste sur la case tapée)
function syncFilledInputs(ex, ei, field, list) {
  for (const j of list) {
    const el = document.querySelector(`[data-action="set-${field}"][data-ei="${ei}"][data-si="${j}"]`);
    if (el && el !== document.activeElement) el.value = field === 'weight' ? fmtW(ex.sets[j].weight, { plain: true }) : ex.sets[j].reps;
  }
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
  u.undoSides?.();
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

// Amène la série courante à l'écran (après validation, reprise ou restauration) ; focus : après un geste
// de l'utilisateur (focusCurrentSet), jamais à l'ouverture ni à la fin d'un repos qu'il n'a pas touché
function scrollToCurrent(smooth = true, focus = false) {
  requestAnimationFrame(() => {
    const row = currentSetRow();
    if (!row) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const behavior = smooth && !reduce ? 'smooth' : 'auto';
    // Ligne « … · Annuler » au-dessus de la carte en cours (sessionUndo) : elle reste visible si possible (panel de la
    // vague 3 : la bande d'une mini-série sortait de l'écran)
    const card = row.closest('.ex-card');
    // La ligne peut aussi coiffer la carte qui vient de se refermer, juste au-dessus de celle-ci
    const any = $('.ex-undo');
    const band = card?.previousElementSibling?.classList.contains('ex-undo') ? card.previousElementSibling
      : any && card && any.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING ? any : null;
    // Reps en réserve de la dernière série sous une carte qui vient de se replier (foldedRirHtml) : pendant le repos, cette
    // carte reste entière sous la barre, la série à faire vient en dessous autant que l'écran le permet (la barre de repos
    // la nomme : « Ensuite : … ») ; à la fin du repos, la série à faire reprend la main
    const fold = restActive ? $('.ex-fold-rir') : null;
    const keep = fold && card && fold.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING ? fold.closest('.ex-card') : null;
    // Ancres possibles, de la plus haute à la plus basse : la ligne « Annuler », la carte repliée gardée pendant le repos,
    // la carte en cours, son nom, la dernière série validée avec son sélecteur « Reps en réserve », ce sélecteur seul.
    // On aligne sous la barre la plus haute qui laisse la série à faire entière à l'écran (panel vague 4 : centrer la
    // série coupait « Reps en réserve » et le nom de l'exercice sous la barre, surtout en texte agrandi). Aucune ne tient :
    // l'ancre la plus basse reste entière et la série descend juste assez pour se montrer, sans jamais la dépasser.
    const rowTop = row.getBoundingClientRect().top;
    const above = sel => card ? [...card.querySelectorAll(sel)].filter(el => el.getBoundingClientRect().top < rowTop).pop() : null;
    // Dernière ligne validée au-dessus : une série (sa rangée avec le balayage), ou une sous-série ou le second côté d'une
    // série notée par bras, sans rangée (texte agrandi : sinon la ligne du bras droit restait sous l'écran)
    const doneAbove = above('.session-set--done'), lastDone = doneAbove?.closest('.set-swipe') || doneAbove;
    // Série notée par bras : l'en-tête « Série 1 » de la paire au-dessus de la ligne en cours reste à l'écran si possible
    const sideCap = above('.sets__caption--pair');
    const anchors = [band, keep, keep ? null : card, keep ? null : card?.querySelector('.ex-card__name'),
      // en-tête des séries : seulement après une série faite (1re série trop basse : le nom reste visible, CI t-grand-texte)
      keep || !lastDone ? null : card?.querySelector('.sets__head'), sideCap, lastDone, lastDone?.querySelector('.rir')]
      .filter(el => el && el.getBoundingClientRect().top <= rowTop);
    const barH = $('#app .navbar')?.getBoundingClientRect().height || 0;
    const room = window.innerHeight - barH - ($('.rest-mini')?.getBoundingClientRect().height || 0) - 24;
    // 8 px d'air sous la barre au-dessus d'une carte ; une ancre dans la carte vient juste sous la barre, sans laisser
    // dépasser le bas de la ligne d'au-dessus (CI : bas des lettres de l'en-tête visibles sous la barre)
    const y = window.scrollY, at = el => el.getBoundingClientRect().top + y - barH - ([band, keep, card].includes(el) ? 8 : 0);
    const fit = anchors.find(el => row.getBoundingClientRect().bottom - el.getBoundingClientRect().top <= room);
    if (fit) window.scrollTo({ top: Math.max(0, at(fit)), behavior });
    else if (anchors.length) {
      const need = row.getBoundingClientRect().bottom + y - barH - room;
      // Texte agrandi, pendant un repos : la série à faire passe avant tout, jamais sous la barre de repos (panel du 20/11 :
      // la barre sur trois rangées la cachait)
      // (taille normale : l'ancre la plus basse reste entière, le sélecteur « Reps en réserve » de la dernière série compris)
      const xl = restActive && document.documentElement.classList.contains('type-xl');
      window.scrollTo({ top: Math.max(0, xl ? need : Math.min(need, at(anchors[anchors.length - 1]))), behavior });
    } else row.scrollIntoView({ block: 'center', behavior });
    if (focus) focusCurrentSet();
  });
}

// Nom de l'exercice en cours repris par la barre quand il passe dessous, comme le grand titre d'iOS qui se replie
// (panel vague 4 : iPhone SE en texte agrandi, scrollToCurrent aligne l'en-tête « kg / Reps » sous la barre et le
// nom de l'exercice n'était plus visible nulle part). Le nom remplace « Push » / « Pull »… le temps qu'il est caché,
// le compteur et le chrono restent dessous. La copie de la barre est cachée à VoiceOver : le nom de la carte reste
// celui qu'il lit, une seule fois.
// Seulement tant que la carte de la série à faire est celle qui passe sous la barre (Mehdi, regard neuf du 16/11 :
// défilé plus bas, ou une autre carte amenée sous la barre par scrollToCard, le titre nommait un exercice qu'on ne
// voyait plus) : sinon le nom de la séance revient. Le titre ne nomme jamais une carte qui n'est pas là.
let curNameObserver = null;
function observeCurrentExName() {
  curNameObserver?.disconnect();
  curNameObserver = null;
  const bar = $('#app .navbar'), slot = bar?.querySelector('.navbar__title-ex');
  const row = currentSetRow(), card = row?.closest('.ex-card'), name = card?.querySelector('.ex-card__name');
  const ex = activeSession?.exercises[parseInt(row?.dataset.ei ?? card?.dataset.ei)];
  bar?.classList.remove('navbar--ex');
  if (!slot || !name || !ex || !('IntersectionObserver' in window)) return;
  slot.textContent = ex.name;   // superset : l'exercice de la série à faire, pas « Superset »
  const top = bar.getBoundingClientRect().height;
  // Repris dès que le nom COMMENCE à passer sous la barre (un nom coupé par le bas de l'écran ne compte pas), tant
  // que la carte couvre encore le haut de l'écran : sa fin qui passe sous la barre (ratio 0) relance le calcul
  let nameUnder = false;
  curNameObserver = new IntersectionObserver(entries => {
    if (!bar.isConnected) return;
    const en = entries.filter(x => x.target === name).pop();
    if (en) nameUnder = en.intersectionRatio < 1 && en.boundingClientRect.top < (en.rootBounds?.top ?? top) + 1;
    bar.classList.toggle('navbar--ex', nameUnder && card.getBoundingClientRect().bottom > top + 1);
  }, { rootMargin: `-${Math.round(top)}px 0px 0px 0px`, threshold: [0, 0.99, 1] });
  curNameObserver.observe(name);
  curNameObserver.observe(card);
}

// Carte d'un exercice (et sa ligne « … · Annuler ») juste sous la barre, après un geste qui la modifie
function scrollToCard(ei) {
  requestAnimationFrame(() => {
    const card = exCardOf(ei);
    if (!card) return;
    const top = card.previousElementSibling?.classList.contains('ex-undo') ? card.previousElementSibling : card;
    const barH = $('#app .navbar')?.getBoundingClientRect().height || 0;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top.getBoundingClientRect().top + window.scrollY - barH - 8), behavior: reduce ? 'auto' : 'smooth' });
  });
}

// Titre de la barre : « Pousser (Push) » s'il tient en entier (iPhone 13), sinon le nom court « Push » plutôt
// qu'un nom coupé (iPhone SE, texte agrandi, « Haut du corps (Upper) »)
function fitSessionTitle() {
  const main = $('#app .navbar__title-main');
  if (main?.dataset.short && main.scrollWidth > main.clientWidth + 1) main.textContent = main.dataset.short;
}

// Nom d'exercice qui ne tient pas en deux lignes à côté de sa vignette (iPhone SE : « Curl concentrati… », un mot plus
// long que la place) : la vignette, décorative, s'efface pour lui laisser la largeur
function fitExNames() {
  document.querySelectorAll('.view.session .ex-card__top').forEach(top => {
    const t = top.querySelector('.ex-howto__text, .ex-card__name');
    if (!t || !top.querySelector('.ex-thumb')) return;
    top.classList.remove('ex-card__top--tight');
    if (t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1) top.classList.add('ex-card__top--tight');
  });
}

// Barre de repos : la série passée sous le nom de l'exercice ne commence jamais par « · » (rest.js ; grille avant
// panel, règle 6). Mesurée sans la classe, la série commence sous la ligne du nom : passée à la ligne
function restNextDot() {
  const n = $('.rest-mini__next'), t = n?.querySelector('.rest-mini__tail'), name = n?.querySelector('.rest-mini__name');
  if (!t || !name) return;
  n.classList.remove('rest-mini__next--wrapped');
  n.classList.toggle('rest-mini__next--wrapped', t.getBoundingClientRect().top >= name.getBoundingClientRect().bottom - 1);
}

// Appelé par render() après l'affichage de la séance
function afterSessionRender(entering) {
  const mini = $('.rest-mini');
  if (mini) document.documentElement.style.setProperty('--rest-h', `${Math.ceil(mini.getBoundingClientRect().height)}px`);
  // Consigne générale du coach (js/features/coach-ui.js) ou note de la dernière fois (js/features/session-notes.js) et
  // aucune série faite : la séance s'ouvre en haut, la ligne visible (sinon elle serait cachée sous la barre par le
  // défilement vers le premier exercice)
  const tipFirst = entering && (coachSessionProgTipHtml() || lastSessionNoteHtml()) && !activeSession.exercises.some(ex => ex.sets.some(s => s.done));
  if (tipFirst) window.scrollTo(0, 0);
  else if (entering) scrollToCurrent(false);
  fitSessionTitle();
  fitExNames();
  restNextDot();
  observeCurrentExName();
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
  sessionUndo(`${setSpokenName(ex, si)} modifié${holdGuide(ex) ? '' : 'e'}`, { target: { ex, si }, state: 'Modifiée' });
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
    // Jamais de focus automatique dans un champ (règle iOS : ni clavier ni poignées de sélection sans le demander) :
    // on touche le champ à corriger. Le focus va au ✓ (bouton, sans clavier) pour que VoiceOver reste sur la série.
    $('.session-set--editing .set-check-zone')?.focus({ preventScroll: true });
  },
  'save-edit-set': saveEditedSet,
  // Bouton révélé par le balayage seulement (jamais un « Supprimer » resté caché)
  'delete-set': (e, el) => {
    if (el?.closest && !el.closest('.set-swipe--open')) return;
    deleteSet(parseInt(el.dataset.ei), parseInt(el.dataset.si));
  },
  // RIR d'une série validée (js/data/rir.js) : un toucher note, le même toucher efface
  'set-rir': (e, el) => {
    const s = activeSession?.exercises[parseInt(el.dataset.ei)]?.sets[parseInt(el.dataset.si)];
    if (!s) return;
    const r = cleanRir(el.dataset.rir);
    if (r === null || rirTooSoon(parseInt(el.dataset.ei), parseInt(el.dataset.si))) return;   // toucher qui suivait la validation
    if (s.rir === r) delete s.rir; else s.rir = r;
    haptic();
    persistSession();
    render();
  },
  'add-set': (e, el) => {
    const ex = activeSession?.exercises[parseInt(el.dataset.ei)];
    if (!ex || ex.sets.length >= 20) return;
    const byside = exBySide(ex);
    pushPlannedSet(ex);
    if (byside) addSide2(ex.sets.at(-1));   // exercice noté par bras : la série ajoutée aussi
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
      const byside = exBySide(ex);
      pushPlannedSet(ex);
      if (byside) addSide2(ex.sets.at(-1));
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
    // La nouvelle charge repart aux reps de l'objectif : la puce et « Objectif 75 kg × 8 » disent la même chose
    const lo = bumpExerciseLoad(ex);
    haptic();
    persistSession();
    render();
    // Reps fixes : on garde le nombre (« toujours 12 reps ») ; fourchette : on repart du bas
    const fixed = lo && fixedReps(sessExData(ex) || {}), step = loadStepLabel(sessExData(ex) || ex);
    showToast(!lo ? `Charge augmentée de ${step}` : fixed ? `Charge augmentée de ${step}, toujours ${lo} reps` : `Charge augmentée de ${step}, retour à ${lo} reps`);
  },
});
