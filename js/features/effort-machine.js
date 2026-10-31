// ═══════════════════════════════════════════════════════════
//  Chrono d'une machine de cardio (escaliers, tapis, vélo d'appartement, elliptique, rameur)
//  Même circuit que le chrono d'effort (js/features/effort.js) : ▶ sur la série, chrono qui monte,
//  réglage de la machine noté au fil de l'effort (−/+ ou saisie directe), puis bilan et série validée.
//  Logique (moyenne, bilan, bornes) : js/data/machine-track.js
// ═══════════════════════════════════════════════════════════
'use strict';

// État dans la séance (persisté avec elle à chaque changement : un rechargement ou un passage en
// arrière-plan ne perd rien, tout se calcule depuis les horodatages) :
// activeSession.effort = { kind: 'machine', ei, si, start, cur: { [slot]: { u, v } }, log: { [slot]: [[t, v, u]] },
//                          review?: fin du chrono (ms), quand le bilan est ouvert }
// Tapis : vitesse et inclinaison en deux rangées compactes, toujours visibles. Les deux se règlent
// séparément sur la console (touches de vitesse et de pente) : un sélecteur de « valeur active » coûterait
// un toucher de plus à chaque changement et cacherait l'autre valeur.

function machineEffort(ex, s, ei, si) {
  const machine = machineOf(ex);
  if (!machine) return null;
  const cur = machineStart(machine, s.prev?.machine), log = {};
  machine.slots.forEach(slot => { log[slot.id] = cur[slot.id].v == null ? [] : [[0, cur[slot.id].v, cur[slot.id].u]]; });
  return { kind: 'machine', ei, si, start: Date.now(), cur, log };
}

function machineSlot(e, id) { return machineOf(activeSession.exercises[e.ei])?.slots.find(x => x.id === id) || null; }
// Secondes du chrono : jusqu'à maintenant, ou jusqu'à l'ouverture du bilan ; jamais au-delà de 600 min
function machineElapsed(e, now = Date.now()) {
  return Math.min(MACHINE_MAX_SEC, Math.max(0, Math.floor(((e.review || now) - e.start) / 1000)));
}

// ── Feuille du chrono ───────────────────────────────────────

function machineSlotHtml(e, slot) {
  const { u, v } = e.cur[slot.id], U = MACHINE_UNITS[u];
  const unitSeg = slot.units.length > 1
    ? `<div class="mach-units" role="group" aria-label="Unité, ${esc(slot.label)}">
        ${slot.units.map(x => `<button class="mach-units__btn" aria-pressed="${x === u}" data-action="mach-unit" data-slot="${slot.id}" data-u="${x}">${MACHINE_UNITS[x].label}</button>`).join('')}
      </div>`
    : `<span class="mach-slot__unit">${u === 'level' ? 'Niveau' : esc(U.label)}</span>`;
  const valTxt = v == null ? '—' : fmtMachineValue(v, u);
  const spoken = v == null ? `${slot.label} pas encore noté` : `${slot.label} : ${fmtMachineValue(v, u)} ${U.spoken}`;
  return `
    <div class="mach-slot" data-slot="${slot.id}">
      <div class="mach-slot__head"><span class="mach-slot__label">${esc(slot.label)}</span>${unitSeg}</div>
      <div class="mach-slot__ctl">
        <button class="mach-btn" data-action="mach-step" data-slot="${slot.id}" data-d="-1" aria-label="Moins, ${esc(slot.label)}">${icon('minus', 26)}</button>
        <button class="mach-val num" data-action="mach-edit" data-slot="${slot.id}" aria-label="${esc(spoken)}. Toucher pour saisir">${valTxt}</button>
        <button class="mach-btn" data-action="mach-step" data-slot="${slot.id}" data-d="1" aria-label="Plus, ${esc(slot.label)}">${icon('plus', 26)}</button>
      </div>
      <div class="mach-slot__since num" data-since="${slot.id}"></div>
    </div>`;
}

function machineSheetHtml(e) {
  const ex = activeSession.exercises[e.ei], machine = machineOf(ex);
  return `
    <div class="rs rs--effort rs--machine">
      <div class="rs__top">
        <button class="rs__collapse rs__collapse--left" data-action="cancel-effort">Annuler</button>
        <h2 class="rs__title" tabindex="-1">${esc(ex.name)}</h2>
      </div>
      <div class="mach-clock">
        <div class="rs__time num" role="timer" aria-live="off" id="effortTime">${fmtClock(machineElapsed(e) * 1000)}</div>
        <div class="rs__resume">Série ${e.si + 1} sur ${ex.sets.length}</div>
      </div>
      ${machine.slots.map(slot => machineSlotHtml(e, slot)).join('')}
      <div class="rs__adj">
        <button class="rs__skip rs__done" data-action="stop-effort" id="effortStop">Terminer</button>
      </div>
      ${machine.slots.length ? '' : `<div class="rs__next">La durée exacte sert au calcul du temps aux 500 m</div>`}
    </div>`;
}

// Chaque seconde : chrono et « depuis 2:10 » sous chaque valeur
function updateMachineUI(e) {
  if (e.review) return;
  const sec = machineElapsed(e), time = $('#effortTime');
  if (time) time.textContent = fmtClock(sec * 1000);
  document.querySelectorAll('.rs--machine [data-since]').forEach(el => {
    const cur = machineCurrent(e.log[el.dataset.since]);
    el.textContent = cur && cur.v != null ? `depuis ${fmtClock(Math.max(0, sec - cur.t) * 1000)}` : '';
  });
}

// Une rangée redessinée seule (la saisie directe d'une autre rangée garde son clavier)
function refreshMachineSlot(e, id) {
  const box = document.querySelector(`.rs--machine .mach-slot[data-slot="${id}"]`), slot = machineSlot(e, id);
  if (!box || !slot) return;
  box.outerHTML = machineSlotHtml(e, slot);
  updateMachineUI(e);
}

// Nouvelle valeur d'une grandeur : datée au chrono, enregistrée tout de suite
function setMachineValue(id, v) {
  const e = activeSession?.effort;
  if (e?.kind !== 'machine' || e.review || !e.cur[id]) return;
  const { u } = e.cur[id];
  e.cur[id].v = v;
  machineLogSet(e.log[id] ||= [], machineElapsed(e), v, u);
  persistSession();
  refreshMachineSlot(e, id);
  const slot = machineSlot(e, id);
  if (v != null) announce(`${slot?.label || ''} ${fmtMachineValue(v, u)} ${MACHINE_UNITS[u].spoken}`);
}

// Autre unité (Niveau ↔ Marches/min, km/h ↔ mph) : rien n'est converti. La valeur repart de la dernière
// notée dans cette unité pendant l'exercice, sinon « — » ; le temps sans valeur n'entre dans aucune moyenne.
function setMachineUnit(id, u) {
  const e = activeSession?.effort, slot = e?.kind === 'machine' ? machineSlot(e, id) : null;
  if (!slot || e.review || !slot.units.includes(u) || e.cur[id].u === u) return;
  const lastSame = [...(e.log[id] || [])].reverse().find(x => x[2] === u && x[1] != null);
  e.cur[id] = { u, v: lastSame ? lastSame[1] : null };
  machineLogSet(e.log[id] ||= [], machineElapsed(e), e.cur[id].v, u);
  haptic();
  persistSession();
  refreshMachineSlot(e, id);
}

// Saisie directe : la valeur devient un champ (clavier numérique), validé par Entrée ou en sortant
function editMachineValue(id) {
  const e = activeSession?.effort, slot = e?.kind === 'machine' ? machineSlot(e, id) : null;
  const btn = document.querySelector(`.rs--machine .mach-val[data-slot="${id}"]`);
  if (!slot || !btn || e.review) return;
  const { u, v } = e.cur[id], [lo, hi] = machineRange(u, slot);
  const input = document.createElement('input');
  Object.assign(input, { type: 'text', className: 'mach-val mach-val--input num', value: v == null ? '' : fmtMachineValue(v, u),
    inputMode: MACHINE_UNITS[u].digits ? 'decimal' : 'numeric', enterKeyHint: 'done', autocomplete: 'off' });
  input.dataset.slot = id;
  input.setAttribute('aria-label', `${slot.label}, de ${fmtNum(lo)} à ${fmtNum(hi)}`);
  btn.replaceWith(input);
  input.focus();
}
function commitMachineInput(input) {
  if (!input?.isConnected || input.dataset.done) return;
  input.dataset.done = '1';
  const e = activeSession?.effort, id = input.dataset.slot, slot = e?.kind === 'machine' ? machineSlot(e, id) : null;
  if (!slot) return;
  const raw = input.value.trim();
  const v = raw === '' ? e.cur[id].v : clampMachineValue(raw, e.cur[id].u, slot);
  if (v != null && v !== e.cur[id].v) setMachineValue(id, v); else refreshMachineSlot(e, id);
}
document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.matches?.('.mach-val--input')) { ev.preventDefault(); ev.target.blur(); }
});
document.addEventListener('focusout', ev => { if (ev.target.matches?.('.mach-val--input')) commitMachineInput(ev.target); });

function stepMachine(id, dir) {
  const e = activeSession?.effort, slot = e?.kind === 'machine' ? machineSlot(e, id) : null;
  if (!slot || e.review) return;
  const next = stepMachineValue(e.cur[id].v, e.cur[id].u, dir, slot);
  haptic();
  if (next !== e.cur[id].v) setMachineValue(id, next);
}

// ── Bilan de fin d'exercice ─────────────────────────────────

// Répartition d'une grandeur : moyenne pondérée par le temps et temps passé à chaque valeur
function machineSummaryHtml(slot, log, end) {
  const { units } = machineSummary(log, end);
  if (!units.length) return `<div class="group-title">${esc(slot.label)}</div><div class="group"><div class="cell"><span class="cell__body"><span class="cell__sub">Aucun réglage noté</span></span></div></div>`;
  const tracked = units.reduce((a, g) => a + g.sec, 0);
  return units.map(g => {
    const U = MACHINE_UNITS[g.u], single = g.values.length === 1;
    const head = single ? machineValueTxt(g.values[0].v, g.u) : `${g.u === 'level' ? 'Niveau moyen' : 'Moyenne'} ${fmtMachineValue(g.avg, g.u, { avg: true })}${g.u === 'level' ? '' : ` ${U.short}`}`;
    const rows = g.values.map(({ v, sec }) => `
        <div class="mach-bar" role="listitem" aria-label="${esc(`${fmtMachineValue(v, g.u)} ${U.spoken} pendant ${fmtSeconds(sec)}`)}">
          <span class="mach-bar__v num">${fmtMachineValue(v, g.u)}</span>
          <span class="mach-bar__track"><span class="mach-bar__fill" style="width:${Math.max(2, Math.round(sec / g.sec * 100))}%"></span></span>
          <span class="mach-bar__t num">${fmtClock(sec * 1000)}</span>
        </div>`).join('');
    return `
      <div class="group-title">${esc(slot.label)}${units.length > 1 ? ` · ${esc(U.label)}` : ''}</div>
      <div class="group group--pad mach-sum">
        <div class="mach-sum__head num">${esc(head.charAt(0).toUpperCase() + head.slice(1))}</div>
        <div role="list">${rows}</div>
        ${end - tracked > 0 && g === units[units.length - 1] ? `<div class="mach-sum__foot num">Sans réglage noté : ${fmtClock((end - tracked) * 1000)}</div>` : ''}
      </div>`;
  }).join('');
}

function machineReviewHtml(e) {
  const ex = activeSession.exercises[e.ei], machine = machineOf(ex), s = ex.sets[e.si], end = machineElapsed(e);
  const withDist = machine.name !== 'Escaliers';   // la « distance » d'un escalier ne vaut rien d'une machine à l'autre
  const pk = paceKind(ex);
  const field = (id, label, value, hint, unit, mode = 'numeric') => `
      <label class="cell cell--field mach-field">
        <span class="cell__body"><span class="cell__title">${label}</span>${hint ? `<span class="cell__sub">${esc(hint)}</span>` : ''}</span>
        <input type="text" id="${id}" class="set-input num mach-field__in" inputmode="${mode}" enterkeyhint="done" autocomplete="off"
               value="${esc(value)}" placeholder="—" aria-label="${esc(label)}${unit ? ` en ${unit}` : ''}">
        ${unit ? `<span class="mach-field__unit">${esc(unit)}</span>` : ''}
      </label>`;
  const extras = (machine.extras || []).map(k => {
    const X = MACHINE_EXTRAS[k];
    return field(`machX-${k}`, X.label, '', X.hint, X.unit);
  }).join('');
  return `
    <div class="rs rs--effort rs--machine rs--review">
      <div class="rs__top">
        <button class="rs__collapse rs__collapse--left" data-action="mach-resume">Reprendre</button>
        <h2 class="rs__title" tabindex="-1">Bilan</h2>
        <button class="rs__collapse rs__collapse--bold" data-action="mach-save">Enregistrer</button>
      </div>
      <div class="mach-clock">
        <div class="rs__time num" id="effortTime">${fmtClock(end * 1000)}</div>
        <div class="rs__resume">${esc(ex.name)} · série ${e.si + 1}</div>
      </div>
      <div class="mach-review">
        ${machine.slots.map(slot => machineSummaryHtml(slot, e.log[slot.id], end)).join('')}
        ${withDist || extras ? `<div class="group-title">Affiché par la machine</div>
        <div class="group">
          ${withDist ? field('machDist', 'Distance', s.dist ? fmtNum(s.dist) : '', '', 'km', 'decimal') : ''}
          ${extras}
        </div>` : ''}
        ${pk === 'split' ? `<div class="group-foot num" id="machSplit"></div>` : ''}
        ${machine.slots.some(x => x.units.includes('level')) ? `<div class="group-foot">Chaque marque a ses niveaux : compare-les sur la même machine.</div>` : ''}
      </div>
      <div class="rs__adj">
        <button class="rs__skip rs__done" data-action="mach-save">Enregistrer</button>
      </div>
    </div>`;
}

// Temps aux 500 m calculé à la frappe de la distance (rameur) : durée exacte du chrono
function refreshMachineSplit() {
  const e = activeSession?.effort, out = $('#machSplit');
  if (!out || e?.kind !== 'machine') return;
  const raw = $('#machDist')?.value ?? '';
  const pace = distOk(raw) ? cardioPace(num(raw, 0, MAX_DIST_KM), machineElapsed(e) / 60, 'split') : null;
  out.textContent = pace ? `Temps moyen aux 500 m : ${fmtPace(pace, 'split').replace(' /500 m', '')}` : 'Temps moyen aux 500 m : calculé avec la distance';
}
document.addEventListener('input', ev => { if (ev.target.id === 'machDist') refreshMachineSplit(); });

function openMachineSheet() {
  const e = activeSession.effort;
  closeSessSheets();
  const root = openSessSheet({ cls: 'sess-sheet--effort', label: e.review ? 'Bilan' : 'Chrono', html: e.review ? machineReviewHtml(e) : machineSheetHtml(e) });
  root.style.setProperty('--cat-color', sessionMeta(activeSession.category, activeSession.programme).color);
  if (e.review) refreshMachineSplit(); else updateMachineUI(e);
}

// « Terminer » : le chrono s'arrête, le bilan s'ouvre (la série n'est validée qu'à « Enregistrer »)
function stopMachine(e) {
  e.review = Date.now();
  persistSession();
  haptic();
  openMachineSheet();
  announce(`Terminé, ${fmtSeconds(machineElapsed(e))}`);
}
// « Reprendre » : le temps du bilan compte (la machine a continué de tourner)
function resumeMachine() {
  const e = activeSession?.effort;
  if (e?.kind !== 'machine' || !e.review) return;
  delete e.review;
  persistSession();
  openMachineSheet();
}

// « Enregistrer » : durée, distance, réglages et champs de la machine dans la série, puis validée
function saveMachine() {
  const e = activeSession?.effort;
  if (e?.kind !== 'machine' || !e.review) return;
  const ex = activeSession.exercises[e.ei], s = ex?.sets[e.si], machine = machineOf(ex);
  if (!s || s.done || !machine) { clearEffort(); document.querySelector('.sess-sheet--effort')?._close?.(); return; }
  const distIn = $('#machDist');
  if (distIn && !distOk(distIn.value)) { flagInvalid(distIn, distMsg()); return; }
  const extras = {};
  for (const k of machine.extras || []) {
    const input = $(`#machX-${k}`), X = MACHINE_EXTRAS[k], raw = input?.value.trim() ?? '';
    if (raw === '') continue;
    const v = num(raw, X.min, X.max, true);
    if (v === null) { flagInvalid(input, `${X.label} : nombre entier de ${X.min} à ${X.max}`); return; }
    extras[k] = v;
  }
  const end = Math.max(1, machineElapsed(e)), endAt = e.review, prevReps = s.reps, prevDist = s.dist, prevMachine = s.machine;
  if (distIn) setDist(s, distIn.value);
  s.reps = String(Math.min(MEASURES.cardio.max, Math.max(1, Math.round(end / 60))));
  const m = cleanMachine({ end, at: e.start, ...e.log, ...extras });   // at : heure du départ (Santé)
  if (m) s.machine = m; else delete s.machine;
  // Champ distance de la ligne : même valeur, sinon validateSet relirait l'ancienne
  const rowDist = document.querySelector(`[data-action="set-dist"][data-ei="${e.ei}"][data-si="${e.si}"]`);
  if (rowDist) rowDist.value = s.dist ? fmtNum(s.dist) : '';
  const { ei, si } = e;
  clearEffort();
  document.querySelector('.sess-sheet--effort')?._close?.();
  validateSet(ei, si, { restFrom: endAt, prevReps, prevDist, prevMachine });
}

// « Annuler » : après une minute de chrono, confirmé (le temps et les réglages seraient perdus)
async function cancelMachine(e) {
  if (machineElapsed(e) >= 60 && !(await confirmSheet('Abandonner le chrono ?', 'Le temps et les réglages notés ne seront pas enregistrés.', 'Abandonner'))) return;
  cancelEffort();
}

registerActions({
  'mach-step': (ev, el) => stepMachine(el.dataset.slot, parseInt(el.dataset.d)),
  'mach-edit': (ev, el) => editMachineValue(el.dataset.slot),
  'mach-unit': (ev, el) => setMachineUnit(el.dataset.slot, el.dataset.u),
  'mach-resume': () => resumeMachine(),
  'mach-save': () => saveMachine(),
});
