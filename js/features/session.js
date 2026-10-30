// ═══════════════════════════════════════════════════════════
//  Séance en cours : démarrage, tableau des séries, validation
// ═══════════════════════════════════════════════════════════
'use strict';

let editingSet = null;  // { ei, si, weight?, reps? } — série validée rouverte en édition sur place, avec la saisie en cours
let persistWarned = false; // un seul avertissement « stockage plein » par séance
const openDone = new WeakSet(); // exercices terminés dépliés

// Série à faire : charge et reps reprises de src, « Avant » : la même série la dernière fois
function plannedSet(src, prev) {
  return {
    weight: src?.weight ?? '',
    reps:   src?.reps   ?? '',
    ...(src?.dist ? { dist: src.dist } : {}),
    plannedWeight: src?.weight ?? '',
    // machine : réglages de la dernière fois, point de départ du chrono (machineStart)
    prev:   prev ? { weight: prev.weight, reps: prev.reps, ...(prev.dist ? { dist: prev.dist } : {}), ...(prev.machine ? { machine: prev.machine } : {}) } : null,
    done:   false,
  };
}

// Séries d'un exercice pré-remplies série par série avec la dernière séance (sinon la dernière série faite)
function buildSets(progKey, cat, exLike, n, fallback = {}) {
  const prevEx = lastPerf(progKey, cat, exLike)?.ex;
  return Array.from({ length: n }, (_, i) => {
    const src = prevEx?.sets[i] ?? prevEx?.sets.at(-1) ?? { weight: fallback.lastWeight || '', reps: fallback.lastReps || '' };
    return plannedSet(src, prevEx?.sets[i]);
  });
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
    exercises: exList.map(ex => ({ exId: ex.id, name: ex.name, measure: measureOf(ex), ...(ex.tempo ? { tempo: ex.tempo } : {}), ...(ex.tempoGuide === true ? { tempoGuide: true, tempoPrep: tempoPrepOf(ex) } : {}), ...(ssId(ex) ? { ss: ex.ss } : {}), sets: buildSets(progKey, cat, ex, ex.sets, ex) })),
  };
  ssNormalize(activeSession.exercises);
  activeSession.baseline = computeBaseline(activeSession);
  persistSession();
  otaSessionChanged();   // une mise à jour en file attend la fin de la séance (js/app/live-update.js)
  routeTo('session');
  requestWakeLock();
}

// Séance en cours enregistrée avec son repos, pour survivre à la fermeture de l'app
function persistSession() {
  if (writeSession(restSnapshot()) || !activeSession || persistWarned) return;
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
  return String(s?.prev?.reps || defaultGoal(measureOf(ex), sessExData(ex)?.repMax));
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

// « Développé incliné · S1 · 30 kg × 10 »
function nextSetText() {
  const cur = currentSet();
  if (!cur) return '';
  const ex = activeSession.exercises[cur.ei], s = ex.sets[cur.si];
  const m = measureOf(ex), kind = loadKind(ex);
  return `${ex.name} · S${cur.si + 1}${s.reps !== '' ? ` · ${m !== 'reps' || kind !== 'charge' ? measureSetTxt(s, m, kind) : loadTimes(s.weight) + s.reps}` : ''}`;
}

// Puce « ↑ +2,5 kg » : toutes les séries de la dernière fois ont atteint le haut de la fourchette
function bumpReady(ex) {
  if (ex.bumped || ex.sets.every(s => s.done) || measureOf(ex) !== 'reps' || isAssisted(ex)) return false;
  const prevs = ex.sets.map(s => s.prev).filter(Boolean);
  if (!prevs.length || prevs.length < Math.min(ex.sets.length, 2)) return false;
  const repMax = sessExData(ex)?.repMax ?? 12;
  return prevs.every(p => (parseInt(p.reps) || 0) >= repMax && (parseFloat(p.weight) || 0) > 0);
}

// Ligne repliée d'un exercice terminé : « 4 × 8 · 32,5 kg » (reps différentes : « 10/10/9/8 »), allure du cardio
function doneSummary(ex) {
  const m = measureOf(ex);
  if (m !== 'reps') return ex.sets.map(s => measureSetTxt(s, m, setKind(ex))).join(' · ');
  const reps = ex.sets.map(s => String(s.reps));
  const same = reps.every(r => r === reps[0]);
  const maxW = Math.max(0, ...ex.sets.map(s => parseFloat(s.weight) || 0));
  return `${ex.sets.length} × ${same ? reps[0] : reps.join('/')}${maxW ? ` · ${fmtW(maxW, { plain: true })} ${unitLbl()}` : ''}`;
}

// ── Rendu de la séance ───────────────────────────────────────

function renderSession() {
  const meta = sessionMeta(activeSession.category, activeSession.programme);
  const { total, done } = sessionSetCounts();
  const pct  = total ? Math.round(done / total * 100) : 0;
  const cur  = currentSet();

  const xs     = activeSession.exercises, tags = ssTags(xs);
  const exHtml = ssBlocks(xs).map(b => (b.length > 1 ? renderGroupCard(b, cur, tags) : renderExerciseCard(xs[b[0]], b[0], cur))).join('');

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
  const prevSets = lastPerf(activeSession.programme, activeSession.category, ex)?.ex.sets || [];
  const doneSets = ex.sets.filter(s => s.done);
  const curVol   = exVolume(ex, doneSets, currentBodyKg());
  const prevVol  = exVolume(ex, prevSets.slice(0, doneSets.length), currentBodyKg());
  const delta    = curVol - prevVol;
  return curVol > 0 && prevVol > 0 && Math.round(delta) > 0
    ? ` · <span class="ex-vol__delta ${allDone ? 'ex-vol__delta--up' : ''}">+${fmtVolume(delta)}</span>` : '';
}

// Sous-titre de la carte : record, repos de l'exercice (modifiable), hausse de volume
function exSubHtml(ex, ei, allDone) {
  const pr   = measureOf(ex) === 'reps' ? sessExData(ex)?.pr : null;
  const rest = fmtRest(exRest(ex));
  const tempo = parseTempo(ex.tempo) && measureOf(ex) === 'reps'
    ? `<span class="tempo-pill num" aria-label="Tempo ${esc(shortTempo(ex.tempo))}${ex.tempoGuide === true ? ', guidé au son' : ''}">${ex.tempoGuide === true ? icon('music', 12) : ''}Tempo ${esc(shortTempo(ex.tempo))}</span> `
    : '';
  return `${tempo}${pr ? `<span class="num">Record ${fmtW(pr.weight, { plain: true })} × ${esc(pr.reps)}</span> · ` : ''}<button class="ex-rest-link num" data-action="set-ex-rest" data-ei="${ei}" aria-label="Repos ${rest}, modifier">Repos ${rest}</button>${exVolumeHtml(ex, allDone)}`;
}

function renderExerciseCard(ex, ei, cur) {
  const doneN   = ex.sets.filter(s => s.done).length;
  const allDone = ex.sets.length > 0 && doneN === ex.sets.length;

  if (allDone && !openDone.has(ex)) {
    const base    = (activeSession.baseline || {})[ex.exId];
    const records = ex.sets.filter(s => s.done && recordLabel(s, base, ex)).length;
    return renderCollapsedExercise(ex, ei, records);
  }

  const howTo = !allDone && hasHowTo(ex);
  const chip = bumpReady(ex) ? `<button class="bump-chip" data-action="bump-weight" data-ei="${ei}" aria-label="Augmenter la charge de ${bumpLabel()}">↑ ${bumpLabel()}</button>` : '';
  const rows = ex.sets.map((s, si) => renderSetRow(ex, ei, s, si, cur)).join('');

  return `
    <div class="exercise-block ex-card ${allDone ? 'ex-card--done' : ''}" data-ei="${ei}">
      <div class="ex-card__head">
        ${allDone
          ? `<button class="ex-card__name ex-card__name--btn" data-action="toggle-ex" data-ei="${ei}" aria-expanded="true">${esc(ex.name)}</button>`
          : howTo
            ? `<h2 class="ex-card__name ex-card__name--howto"><button class="ex-howto" data-action="ex-howto" data-ei="${ei}" aria-label="${esc(ex.name)}, comment faire"><span class="ex-howto__text">${esc(ex.name)}${icon('info.circle', 15)}</span></button></h2>`
            : `<h2 class="ex-card__name">${esc(ex.name)}</h2>`}
        ${chip}
        <span class="ex-card__count num"><span aria-hidden="true">${doneN}/${ex.sets.length}</span><span class="visually-hidden">${doneN} sur ${plural(ex.sets.length, 'série validée', 'séries validées')}</span></span>
        <button class="ex-card__more" data-action="ex-menu" data-ei="${ei}" aria-label="Options de ${esc(ex.name)}">${icon('ellipsis', 22)}</button>
      </div>
      <div class="ex-card__sub">${exSubHtml(ex, ei, allDone)}</div>
      ${coachSessionTipHtml(ex)}
      <div class="sets" role="group" aria-label="Séries de ${esc(ex.name)}">
        <div class="sets__head" aria-hidden="true">
          <span>Série</span><span>Avant</span>
          <span>${loadHeader(ex)}</span><span>${MEASURES[measureOf(ex)].count}</span>
          <span>${icon('checkmark', 14)}</span>
        </div>
        ${rows}
      </div>
      <button class="add-set-link" data-action="add-set" data-ei="${ei}">${icon('plus', 16)} Série</button>
    </div>`;
}

// Carte qui montre l'exercice ei (celle de son superset s'il en fait partie)
function exCardOf(ei) {
  return document.querySelector(`.ex-card[data-ei="${ei}"], .ex-card [data-ei="${ei}"]`)?.closest('.ex-card') || null;
}

// Superset (2 à 5 exercices enchaînés) : une seule carte, les séries rangées tour par tour.
// En tête, une ligne par exercice (lettre, nom, séries faites, menu ⋯) ; le repos, celui du dernier
// exercice, part à la fin de chaque tour.
function renderGroupCard(members, cur, tags) {
  const xs      = activeSession.exercises;
  const exs     = members.map(ei => xs[ei]);
  const total   = exs.reduce((a, ex) => a + ex.sets.length, 0);
  const doneN   = exs.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0);
  const allDone = total > 0 && doneN === total;
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
            ? `<button class="ex-howto ss-member__name" data-action="ex-howto" data-ei="${ei}" aria-label="${esc(ex.name)}, comment faire"><span class="ex-howto__text">${esc(ex.name)}${icon('info.circle', 15)}</span></button>`
            : `<span class="ss-member__name">${esc(ex.name)}</span>`}
          ${chip}
          <span class="ex-card__count num"><span aria-hidden="true">${n}/${ex.sets.length}</span><span class="visually-hidden">${n} sur ${plural(ex.sets.length, 'série validée', 'séries validées')}</span></span>
          <button class="ex-card__more" data-action="ex-menu" data-ei="${ei}" aria-label="Options de ${esc(ex.name)}">${icon('ellipsis', 22)}</button>
        </div>`;
  }).join('');

  const rounds = ssRounds(xs, members).map((round, t) => `
        <div class="ss-round" role="group" aria-label="Tour ${t + 1}">
          <div class="ss-round__title">Tour ${t + 1}</div>
          ${round.map(({ ei, si }) => `<div class="ss-exname" aria-hidden="true">${esc(xs[ei].name)}</div>${renderSetRow(xs[ei], ei, xs[ei].sets[si], si, cur, tags[ei])}`).join('')}
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
      <div class="ex-card__sub"><button class="ex-rest-link num" data-action="set-ex-rest" data-ei="${members.at(-1)}" aria-label="Repos ${rest} après chaque tour, modifier">Repos ${rest} après chaque tour</button></div>
      <div class="ss-members">${legend}</div>
      ${members.map(ei => coachSessionTipHtml(xs[ei], tags[ei])).join('')}
      <div class="sets" role="group" aria-label="Séries du ${kind.toLowerCase()}">
        <div class="sets__head" aria-hidden="true">
          <span>Exo</span><span>Avant</span>
          <span>${loadHeader(m0)}</span><span>${MEASURES[measureOf(m0)].count}</span>
          <span>${icon('checkmark', 14)}</span>
        </div>
        ${rounds}
      </div>
      <button class="add-set-link" data-action="add-round" data-ei="${head}">${icon('plus', 16)} Tour</button>
    </div>`;
}

// Série validée : ligne en lecture seule, rouverte en édition au tap ; allure sous la ligne en cardio
// (même place que le badge de record, qui ne concerne que les répétitions)
function renderDoneSetRow(ex, ei, s, si, prev, del, tag) {
  const m      = measureOf(ex), M = MEASURES[m];
  const record = m === 'reps' ? recordLabel(s, (activeSession.baseline || {})[ex.exId], ex) : '';
  const first  = setFirstValue(s, m);
  const kind   = m === 'cardio' ? 'charge' : m === 'time' ? 'lest' : loadKind(ex);
  const load   = first ? `${{ charge: '', lest: 'plus ', aide: 'aide de ' }[kind]}${first} ${m === 'cardio' ? 'kilomètres' : data.unit === 'lbs' ? 'livres' : 'kilos'}, ` : '';
  const pk     = m === 'cardio' ? paceKind(ex) : null;
  const pace   = pk ? cardioPace(s.dist, setMinutes(s), pk) : null;
  const mach   = m === 'cardio' ? machineTxt(s.machine) : '';
  return `
      <div class="set-swipe">
        ${del}
        <div class="session-set session-set--done" data-action="edit-set" data-ei="${ei}" data-si="${si}" role="button" tabindex="0"
             aria-label="Série ${si + 1} validée, ${load}${esc(s.reps)} ${M.spoken}${pace ? `, ${spokenPace(pace, pk)}` : ''}${mach ? `, ${esc(mach)}` : ''}, ${esc(ex.name)}${record ? ', record' : ''}. Modifier">
          ${setNumHtml(si, tag)}
          <span class="set-prev num">${prev}</span>
          <span class="set-val num">${first || '—'}</span>
          <span class="set-val num">${esc(s.reps)}</span>
          <span class="set-check-zone"><span class="set-check set-check--done">${icon('checkmark', 18)}</span></span>
          ${record ? `<span class="set-badge"><span class="pr-badge">${record}</span></span>` : ''}
          ${pace || mach ? `<span class="set-badge">${pace ? `<span class="pace-badge">${fmtPace(pace, pk)}</span>` : ''}${mach ? `<span class="mach-badge">${esc(mach)}</span>` : ''}</span>` : ''}
        </div>
      </div>`;
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

// Première colonne : numéro de la série, ou A1, A2… dans un superset (affiché tour par tour)
function setNumHtml(si, tag) {
  return tag ? `<span class="set-n"><span class="ss-tag">${tag}</span></span>` : `<span class="set-n num">${si + 1}</span>`;
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

  const isCur = !editing && cur && cur.ei === ei && cur.si === si;
  // Série rouverte : la saisie en cours (editingSet) prime, sinon un re-rendu la remettrait à l'ancienne valeur
  const wVal = editing && editingSet.weight !== undefined ? editingSet.weight : (m === 'cardio' ? (s.dist ? fmtNum(s.dist) : '') : fmtW(s.weight, { plain: true }));
  const rVal = editing && editingSet.reps   !== undefined ? editingSet.reps   : s.reps;
  const prevW = prevF;
  // Série validée rouverte : mêmes champs, enregistrés par le ✓
  const wAttr = editing ? 'id="editSetWeight"' : `data-action="${m === 'cardio' ? 'set-dist' : 'set-weight'}" data-ei="${ei}" data-si="${si}"`;
  const rAttr = editing ? 'id="editSetReps"'   : `data-action="set-reps" data-ei="${ei}" data-si="${si}"`;
  const first = ex.sets.findIndex(x => !x.done);
  const waitFor = !editing && first >= 0 && first < si ? first : -1;
  const check = editing
    ? `<button class="set-check-zone" data-action="save-edit-set" aria-label="Enregistrer la série ${si + 1}, ${esc(ex.name)}"><span class="set-check set-check--edit">${icon('checkmark', 18)}</span></button>`
    : waitFor >= 0
      // Une série plus haut n'est pas faite : on valide dans l'ordre (le ✓ grisé le rappelle au toucher)
      ? `<button class="set-check-zone set-check-zone--wait" data-action="validate-set" data-ei="${ei}" data-si="${si}" aria-disabled="true" aria-label="Série ${si + 1}, ${esc(ex.name)} : valide d'abord la série ${waitFor + 1}"><span class="set-check"></span></button>`
      : `<button class="set-check-zone" data-action="validate-set" data-ei="${ei}" data-si="${si}" aria-label="Valider la série ${si + 1}, ${esc(ex.name)}"><span class="set-check"></span></button>`;
  return `
    <div class="set-swipe">
      ${editing ? '' : del}
      <div class="session-set ${isCur ? 'session-set--current' : ''} ${editing ? 'session-set--editing' : ''}" ${isCur ? 'aria-current="step"' : ''} data-ei="${ei}" data-si="${si}">
        ${(m === 'time' || (m === 'reps' && parseTempo(ex.tempo) && ex.tempoGuide === true) || hasMachineClock(ex)) && !editing && si === ex.sets.findIndex(x => !x.done)
          ? setPlayHtml(ex, ei, s, si)
          : setNumHtml(si, tag)}
        <span class="set-prev num">${s.prev ? '<span class="visually-hidden">La dernière fois </span>' : ''}${prev}</span>
        <input type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" class="set-input num" ${wAttr}
               value="${esc(wVal)}" placeholder="${prevW || '—'}" aria-label="${loadSpoken(ex)} série ${si + 1}, ${esc(ex.name)}, en ${m === 'cardio' ? 'kilomètres' : unitLbl()}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="${editing ? 'done' : 'next'}" autocomplete="off" class="set-input set-input--required num" ${rAttr}
               value="${esc(rVal)}" placeholder="${esc(setGoal(ex, s))}" aria-label="${countSpoken(ex)} série ${si + 1}, ${esc(ex.name)}">
        ${check}
      </div>
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
  const prevLastEi = activeSession.lastEi;
  const sameAgain  = prevLastEi === ei;   // même exercice deux fois de suite : fait seul
  activeSession.lastEi = ei;
  editingSet = null;
  haptic();
  afterPaint(validationSound);   // la coche verte d'abord : le son natif active la session audio d'iOS (bloquant)

  const undo = carryWeightToNextSet(ex, si);
  undo.prevLastEi = prevLastEi;   // « Annuler » puis revalider : le superset enchaîne comme la 1re fois
  if (opts.prevReps !== undefined) undo.prevReps = opts.prevReps;
  else if (goalTaken) undo.prevReps = '';
  if ('prevDist' in opts) undo.prevDist = opts.prevDist;
  if ('prevMachine' in opts) undo.prevMachine = opts.prevMachine;
  const xs      = activeSession.exercises;
  const allDone = xs.every(e => e.sets.every(st => st.done));
  // Superset : pas de repos avant la fin du tour, on enchaîne sur l'exercice suivant du groupe.
  // Le même exercice validé deux fois de suite (l'autre est pris) : repos comme d'habitude.
  const group   = ssGroupOf(xs, ei);
  const chain   = !allDone && group && !sameAgain ? ssChainAfter(xs, group, ei) : null;
  if (allDone) { stopRest(); closeSessSheets(); }
  else if (chain) stopRest();
  else openRest(exRest(xs[restEi(ei)]), false, opts.restFrom);

  document.activeElement?.blur?.();
  render();
  scrollToCurrent();
  showToast(chain ? `Enchaîne : ${xs[chain.ei].name}` : `Série ${si + 1} validée`, { action: 'Annuler', duration: 4000, onAction: () => undoValidate(undo) });
}

// La série suivante garde sa valeur prévue, sauf si la charge vient d'être modifiée.
// Renvoie de quoi annuler la validation (série validée et charge d'origine de la suivante).
function carryWeightToNextSet(ex, si) {
  const s       = ex.sets[si];
  const nextSet = ex.sets[si + 1];
  const undo    = { s, next: null, nextW: null, nextR: null };
  if (!nextSet || nextSet.done) return undo;
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
  if (u.prevReps !== undefined) u.s.reps = u.prevReps;   // chrono ou case vide : la valeur d'avant revient
  // Chrono d'une machine : km et réglages notés d'avant (absents : retirés), comme si rien n'avait été enregistré
  if ('prevDist' in u) { if (u.prevDist == null) delete u.s.dist; else u.s.dist = u.prevDist; }
  if ('prevMachine' in u) { if (u.prevMachine == null) delete u.s.machine; else u.s.machine = u.prevMachine; }
  if (u.next && !u.next.done) { u.next.weight = u.nextW; u.next.reps = u.nextR; }
  stopRest();
  closeSessSheets();
  persistSession();
  render();
  scrollToCurrent();
}

// Centre la série courante à l'écran (après validation, reprise ou restauration)
function scrollToCurrent(smooth = true) {
  requestAnimationFrame(() => {
    const row = $('.session-set--current');
    if (!row) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'center', behavior: smooth && !reduce ? 'smooth' : 'auto' });
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
  render();
  showToast('Série modifiée');
  return true;
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
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
      showToast(`Valide d'abord la série ${first + 1}`);
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
    editingSet = null;
    haptic();
    render();
  },
  'add-set': (e, el) => {
    const ex = activeSession?.exercises[parseInt(el.dataset.ei)];
    if (!ex || ex.sets.length >= 20) return;
    const pex = lastPerf(activeSession.programme, activeSession.category, ex)?.ex;
    ex.sets.push(plannedSet(ex.sets.at(-1), pex?.sets[ex.sets.length]));
    openDone.add(ex);
    haptic();
    render();
  },
  // Superset : un tour de plus = une série de plus pour chaque exercice du groupe
  'add-round': (e, el) => {
    const g = activeSession && ssGroupOf(activeSession.exercises, parseInt(el.dataset.ei));
    if (!g) return;
    g.map(ei => activeSession.exercises[ei]).forEach(ex => {
      if (ex.sets.length >= 20) return;
      const pex = lastPerf(activeSession.programme, activeSession.category, ex)?.ex;
      ex.sets.push(plannedSet(ex.sets.at(-1), pex?.sets[ex.sets.length]));
    });
    openDone.add(activeSession.exercises[g[0]]);
    haptic();
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
    ex.sets.forEach(s => {
      if (s.done) return;
      const cur = toUnitW(s.weight || s.prev?.weight) || 0;
      s.weight = storeW(String(Math.round((cur + step) * 100) / 100));
      s.plannedWeight = s.weight;
    });
    ex.bumped = true;
    haptic();
    render();
    showToast(`Charge augmentée : ${bumpLabel()}`);
  },
});
