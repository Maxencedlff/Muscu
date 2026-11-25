// ═══════════════════════════════════════════════════════════
//  Défis (docs/DEFIS.md, logique dans js/data/defis.js) : section « Défis » en bas de l'accueil, création, ajout
//  rapide, fiche d'un défi, défis terminés.
//
//  - Noter vite : un toucher sur « +10 » ajoute tout de suite (rien au pointerdown, un seul tap iOS). La ligne sous les
//    boutons dit « +10 noté » avec « Annuler » à sa place, sans décaler les boutons (jamais un toast par-dessus).
//    « Annuler » ignore les touchers pendant DEFI_GUARD_MS après son apparition : un double toucher sur « +10 » ne
//    l'annule pas.
//  - Couleurs : l'anneau et les jours tenus en vert (--check-on, « fait », comme la semaine de l'accueil), piste grise ;
//    boutons gris au texte orange (action) ; jamais de rouge (muscles et suppressions), ni flamme, ni confettis.
//  - Les reps des défis ne comptent pas dans Progrès : la fiche le dit.
// ═══════════════════════════════════════════════════════════
'use strict';

const DEFI_GUARD_MS = 700;
const DEFI_UNDO_MS  = 8000;
let defiUndoState = null;      // { id, day, entryId, n, shownAt, timer }
let defiMonthShown = null;     // { id, month: 'AAAA-MM' } : mois du calendrier de la fiche

// ── Visuels ─────────────────────────────────────────────────

// Anneau du jour : piste grise, arc vert ; plein et coché une fois l'objectif atteint ; vide à 0
function defiRingSvg(ratio, size = 44, reached = false) {
  const r = 18, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, ratio));
  const arc = p > 0 ? `<circle class="defi-ring__arc" cx="22" cy="22" r="${r}" stroke-dasharray="${(c * p).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 22 22)"/>` : '';
  const check = reached ? '<path class="defi-ring__check" d="M15.5 22.5l4.5 4.5 8.5-9"/>' : '';
  return `<svg class="defi-ring${reached ? ' defi-ring--done' : ''}" width="${size}" height="${size}" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
    <circle class="defi-ring__track" cx="22" cy="22" r="${r}"/>${arc}${check}</svg>`;
}
function defiSpokenToday(c, t) {
  return `${defiAmountSpoken(t.done, c.measure)} sur ${defiAmountSpoken(t.goal, c.measure)} aujourd'hui${t.reached ? ', objectif atteint' : ''}`;
}

// ── Accueil ─────────────────────────────────────────────────

function defiStepsHtml(c, t, { day = '' } = {}) {
  const steps = defiSteps(t.goal, c.measure);
  const btn = n => `<button class="water-add defi-add num" data-action="defi-add" data-id="${esc(c.id)}" data-n="${n}"${day ? ` data-day="${esc(day)}"` : ''}
      aria-label="Ajouter ${esc(defiAmountSpoken(n, c.measure))}, ${esc(c.name)}">${defiStepLabel(n, c.measure)}</button>`;
  return `<div class="defi-steps" role="group" aria-label="${esc(`Noter, ${c.name}`)}">${steps.map(btn).join('')}
      <button class="water-add defi-add defi-add--other" data-action="defi-other" data-id="${esc(c.id)}"${day ? ` data-day="${esc(day)}"` : ''} aria-label="${esc(`Autre nombre, ${c.name}`)}">Autre</button></div>`;
}
// Ligne sous les boutons : la série, ou « +10 noté » et Annuler juste après un ajout (même place, même hauteur)
function defiFootHtml(c) {
  const u = defiUndoState && defiUndoState.id === c.id ? defiUndoState : null;
  if (u) {
    return `<div class="defi-foot defi-foot--undo" id="defi-foot-${esc(c.id)}"><span class="defi-foot__text num"><b>${esc(`${defiStepLabel(u.n, c.measure)} noté`)}</b> · ${esc(defiStreakText(defiStreak(c)))}</span>
      <button class="defi-foot__undo" data-action="defi-undo" data-id="${esc(c.id)}" aria-label="${esc(`Annuler l'ajout de ${defiAmountSpoken(u.n, c.measure)}`)}">Annuler</button></div>`;
  }
  const s = defiStreak(c);
  return `<div class="defi-foot" id="defi-foot-${esc(c.id)}"><span class="defi-foot__text">${esc(defiStreakText(s))}</span></div>`;
}
function defiHomeCardHtml(c) {
  const t = defiToday(c);
  if (t.paused) {
    return `<div class="defi-card defi-card--paused" data-id="${esc(c.id)}">
        <button class="defi-card__open" data-action="defi-open" data-id="${esc(c.id)}" aria-label="${esc(`${c.name}, en pause. Ouvrir le défi`)}">
          ${defiRingSvg(0)}
          <span class="defi-card__text" aria-hidden="true"><span class="defi-card__name">${esc(c.name)}</span><span class="defi-card__val">En pause</span></span>
          ${icon('chevron.right', 14)}</button></div>`;
  }
  return `<div class="defi-card" data-id="${esc(c.id)}">
      <button class="defi-card__open" data-action="defi-open" data-id="${esc(c.id)}" aria-label="${esc(`${c.name} : ${defiSpokenToday(c, t)}, ${defiStreakText(defiStreak(c))}. Ouvrir le défi`)}">
        ${defiRingSvg(t.ratio, 44, t.reached)}
        <span class="defi-card__text" aria-hidden="true"><span class="defi-card__name">${esc(c.name)}</span>
          <span class="defi-card__val num"><span class="defi-card__num"><b>${defiVal(t.done)}</b>\u00a0/\u00a0${defiVal(t.goal)}\u00a0${defiUnit(c)}</span>${t.reached ? ` · <span class="defi-card__done">Fait</span>` : ''}</span></span>
        ${icon('chevron.right', 14)}</button>
      ${defiStepsHtml(c, t)}
      ${defiFootHtml(c)}
    </div>`;
}
// Section de l'accueil : les défis en cours, ou une seule ligne pour en lancer un
function defisHomeHtml() {
  const list = defiList(data), ended = defiList(data, { ended: true });
  if (!list.length) {
    return `<section class="defis-home" aria-labelledby="homeDefis" data-day="${localISO()}"><h2 class="home-list__title" id="homeDefis">Défis</h2>
      <div class="home-card">
        <button class="home-cell" data-action="defi-new">
          <span class="home-cell__text"><span class="home-cell__name">Lancer un défi</span><span class="home-cell__sub">Par exemple 100 pompes par jour</span></span>
          ${icon('chevron.right', 14)}</button>
        ${ended.length ? defiEndedRowHtml(ended.length) : ''}
      </div></section>`;
  }
  const add = list.length < DEFI_MAX ? '<button class="home-list__btn" data-action="defi-new">Nouveau défi</button>' : '';
  return `<section class="defis-home" aria-labelledby="homeDefis" data-day="${localISO()}"><div class="home-list__head"><h2 class="home-list__title" id="homeDefis">Défis</h2>${add}</div>
      <div class="home-card defis-home__card">${list.map(defiHomeCardHtml).join('')}${ended.length ? defiEndedRowHtml(ended.length) : ''}</div></section>`;
}
function defiEndedRowHtml(n) {
  return `<button class="home-cell defi-ended-row" data-action="defi-ended"><span class="home-cell__text"><span class="home-cell__name defi-ended-row__name">Défis terminés</span></span>
      <span class="home-cell__status num">${n}</span>${icon('chevron.right', 14)}</button>`;
}

// ── Noter ───────────────────────────────────────────────────

function defiAddNow(id, n, day) {
  if (!(n > 0)) return;
  const c = defiGet(data, id);
  if (!c) return;
  day ||= localISO();
  const before = defiToday(c, day).reached;
  const ok = defiAddCheck(data, id, n, day);
  if (!ok.ok) {
    const last = defiLastDay(c);
    showToast(ok.error === 'full' ? `${DEFI_DAY_ADDS} ajouts par jour au plus : corrige le total du jour`
      : ok.error === 'day' && last && day > last ? 'Ce défi est fini : relance-le depuis sa fiche'
      : ok.error === 'day' ? 'Ce jour ne peut plus être noté' : 'Nombre hors limites', { error: true });
    return;
  }
  const r = defiAdd(data, id, n, day);
  save();
  const t = defiToday(c, r.day);
  haptic(!before && t.reached ? 'success' : 'light');
  clearTimeout(defiUndoState?.timer);
  defiUndoState = { id, day: r.day, entryId: r.entry.id, n, shownAt: Date.now(),
    timer: setTimeout(() => { defiUndoState = null; defiRefreshFoot(id); }, DEFI_UNDO_MS) };
  defiRepaint(id);
  defiPlanReminders();
  announce(`Noté : ${defiAmountSpoken(n, c.measure)}. ${defiSpokenToday(c, t)}. Annuler disponible`);
}
// Redessine la carte (ou la fiche) en gardant le focus sur le bouton touché (render le replace)
function defiRepaint() { render(); }
function defiRefreshFoot(id) {
  const el = document.getElementById(`defi-foot-${id}`), c = defiGet(data, id);
  if (el && c && !el.contains(document.activeElement)) el.outerHTML = defiFootHtml(c);
  else if (el && c) render();
}
function defiUndoNow(id) {
  const u = defiUndoState;
  if (!u || u.id !== id || Date.now() - u.shownAt < DEFI_GUARD_MS) return;
  clearTimeout(u.timer);
  defiUndoState = null;
  if (!defiUndo(data, id, u.day, u.entryId)) return;
  save(); haptic('light'); render(); defiPlanReminders();
  const c = defiGet(data, id);
  if (c) announce(`Annulé. ${defiSpokenToday(c, defiToday(c, u.day))}`);
}

// Pavé : un nombre libre (reps), ou des secondes (« 90 », « 1:30 »)
function defiParseAmount(raw, measure) {
  const s = String(raw ?? '').trim().replace(/\s+/g, '');
  if (measure === 'time') {
    const m = s.match(/^(\d{1,3}):([0-5]\d)$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
  }
  return /^\d{1,4}$/.test(s) ? Number(s) : null;
}
async function defiOtherDialog(c, { title, value = '', allowZero = false, message = '' } = {}) {
  const time = c.measure === 'time', max = DEFI_ADD_MAX[c.measure];
  const raw = await dialog({ title: title || c.name, message: message || (time ? 'En secondes, ou en minutes et secondes (1:30).' : 'Nombre de répétitions.'),
    input: { value, placeholder: time ? '60' : '25', unit: time ? 's' : 'reps', label: time ? 'Durée, en secondes' : 'Répétitions',
      validate: v => { const n = defiParseAmount(v, c.measure); return !String(v).trim() || (n !== null && n >= (allowZero ? 0 : 1) && n <= max) ? null : `De ${allowZero ? 0 : 1} à ${max}`; } },
    actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'OK', style: 'preferred' }] });
  if (raw == null || !String(raw).trim()) return null;
  return defiParseAmount(raw, c.measure);
}

// ── Création ────────────────────────────────────────────────

function defiNew() {
  if (defiList(data).length >= DEFI_MAX) {
    dialog({ title: `${DEFI_MAX} défis au plus`, message: 'Arrête un défi pour en lancer un autre.', actions: [{ label: 'OK', style: 'preferred' }] });
    return;
  }
  openAddExSheet({ target: 'defi', exclude: defiList(data).map(c => c.name), onPick: name => { setTimeout(() => defiCreateSheet(name), 240); } });
}
function defiSuggestedGoal(name, measure) {
  const s = DEFI_SUGGESTIONS.find(x => sameExerciseName(x.name, name));
  return s ? s.goal : measure === 'time' ? 60 : 50;
}
// Réglages d'un défi (création et modification) : objectif, durée, rappel
function defiFormHtml({ measure, goal, length, remind, edit = false }) {
  const unit = measure === 'time' ? 's' : 'reps';
  const len = (v, lbl) => `<button type="button" class="segmented__btn ${length === v ? 'segmented__btn--active' : ''}" data-len="${v}" aria-pressed="${length === v}">${lbl}</button>`;
  return `
    <div class="view--grouped defi-form">
      <div class="group-title">Objectif par jour</div>
      <div class="group defi-form__goal">
        <div class="cell"><span class="cell__body"><span class="cell__title">${measure === 'time' ? 'Secondes par jour' : 'Répétitions par jour'}</span></span>
          <span class="defi-form__field"><input id="defiGoal" class="defi-form__input num" type="text" inputmode="numeric" autocomplete="off" maxlength="4" value="${goal}" aria-label="${measure === 'time' ? 'Objectif par jour, en secondes' : 'Objectif par jour, en répétitions'}"><span class="defi-form__unit" aria-hidden="true">${unit}</span></span></div>
      </div>
      ${edit ? '<div class="group-foot">Le nouvel objectif vaut à partir d\'aujourd\'hui ; les jours passés gardent le leur.</div>' : ''}
      <div class="group-title">Durée</div>
      <div class="segmented defi-form__len" role="group" aria-label="Durée du défi">${len(30, '30 jours')}${len(60, '60 jours')}${len(0, 'Sans fin')}</div>
      <div class="group-title">Rappel</div>
      <div class="group${defiRemindAvailable() ? '' : ' group--disabled'}">
        <button type="button" class="cell" id="defiRemindOn" role="switch" aria-checked="${!!remind}"${defiRemindAvailable() ? '' : ' disabled'}>
          <span class="cell__body"><span class="cell__title">Me le rappeler</span><span class="cell__sub">${defiRemindAvailable() ? 'Une notification par jour, sauf si c\'est déjà fait' : 'Dans l\'app iPhone seulement : le navigateur n\'envoie pas de rappel'}</span></span>${switchHtml(!!remind)}</button>
        <label class="cell defi-form__time" ${remind ? '' : 'hidden'}><span class="cell__body"><span class="cell__title">Heure</span></span>
          <input id="defiRemind" type="time" class="defi-form__clock num" value="${remind || '18:00'}" aria-label="Heure du rappel"></label>
      </div>
      <p class="defi-form__err" id="defiErr" role="alert"></p>
    </div>`;
}
function defiFormWire(panel, state) {
  panel.querySelectorAll('[data-len]').forEach(b => b.addEventListener('click', () => {
    state.length = Number(b.dataset.len);
    panel.querySelectorAll('[data-len]').forEach(x => { const on = x === b; x.classList.toggle('segmented__btn--active', on); x.setAttribute('aria-pressed', String(on)); });
    haptic();
  }));
  $('#defiGoal', panel).addEventListener('input', () => { $('#defiErr', panel).textContent = ''; });   // message d'une saisie corrigée retiré
  const sw = $('#defiRemindOn', panel);
  sw.addEventListener('click', async () => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    if (on && !(await defiNotifAllowed())) {
      $('#defiErr', panel).textContent = 'Notifications refusées : autorise-les dans Réglages › MDLF Training › Notifications.';
      return;
    }
    sw.setAttribute('aria-checked', String(on));
    sw.querySelector('.switch')?.classList.toggle('switch--on', on);
    $('.defi-form__time', panel).hidden = !on;
    $('#defiErr', panel).textContent = '';
    haptic();
  });
}
function defiFormRead(panel, measure) {
  const g = defiParseAmount($('#defiGoal', panel).value, 'reps');
  const remindOn = $('#defiRemindOn', panel).getAttribute('aria-checked') === 'true';
  const max = DEFI_GOAL_MAX[measure];
  if (g === null || g < 1 || g > max) { $('#defiErr', panel).textContent = `Objectif : de 1 à ${fmtNum(max)} ${measure === 'time' ? 'secondes' : 'répétitions'}.`; $('#defiGoal', panel).focus(); return null; }
  return { goal: g, remind: remindOn ? ($('#defiRemind', panel).value || '18:00') : null };
}
async function defiCreateSheet(name) {
  const measure = measureOf({ name }) === 'time' ? 'time' : 'reps';
  const state = { length: 30 };
  const body = `<p class="defi-form__ex">${esc(name)}</p>${defiFormHtml({ measure, goal: defiSuggestedGoal(name, measure), length: 30, remind: null })}`;
  const p = sheet({ title: 'Nouveau défi', confirm: 'Lancer', body, onConfirm: panel => {
    const f = defiFormRead(panel, measure);
    if (!f) return false;
    const r = defiCreate(data, { name, measure, goal: f.goal, length: state.length, remind: f.remind });
    if (!r.ok) { $('#defiErr', panel).textContent = r.error === 'full' ? `${DEFI_MAX} défis au plus.` : 'Objectif invalide.'; return false; }
    return r.id;
  } });
  const panel = document.querySelector('.sheet-root:last-of-type .sheet');
  if (panel) defiFormWire(panel, state);
  const id = await p;
  if (!id) return;
  save(); haptic('success'); render(); defiPlanReminders();
  const c = defiGet(data, id);
  defiShowNew(id);
  announce(`${c.name} lancé, ${defiAmountSpoken(defiGoal(c), c.measure)} par jour`);
}
// Nouveau défi : l'accueil défile jusqu'à sa carte, mise en avant un instant (fond sobre, sans lueur)
function defiShowNew(id) {
  // Après la fermeture de la feuille (220 ms) et le retour du focus, qui ferait remonter l'écran
  setTimeout(() => {
    const card = document.querySelector(`.defi-card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    card.classList.add('defi-card--new');
    setTimeout(() => card.classList.remove('defi-card--new'), 2400);
  }, 320);
}
async function defiEditSheet(id) {
  const c = defiGet(data, id);
  if (!c) return;
  const state = { length: c.length };
  const p = sheet({ title: 'Modifier le défi', confirm: 'OK', body: `<p class="defi-form__ex">${esc(c.name)}</p>${defiFormHtml({ measure: c.measure, goal: defiGoal(c), length: c.length, remind: c.remind, edit: true })}`,
    onConfirm: panel => { const f = defiFormRead(panel, c.measure); return f ? { ...f, length: state.length } : false; } });
  const panel = document.querySelector('.sheet-root:last-of-type .sheet');
  if (panel) defiFormWire(panel, state);
  const f = await p;
  if (!f) return;
  defiEdit(data, id, f);
  save(); haptic(); render(); defiPlanReminders();
}

// ── Fiche ───────────────────────────────────────────────────

function defiMonthOf(id, c) {
  if (defiMonthShown?.id === id) return defiMonthShown.month;
  const end = c.endedAt ? localISO(c.endedAt) : localISO();
  return end.slice(0, 7);
}
const DEFI_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function defiMonthName(month) { const [y, m] = month.split('-').map(Number); return `${DEFI_MONTHS[m - 1]} ${y}`; }
const DEFI_STATE_WORDS = { done: 'tenu', missed: 'manqué', paused: 'en pause', today: 'en cours', out: '' };
// Grille du mois : lundi en premier, un rond par jour
function defiMonthHtml(c, month) {
  const today = localISO(), first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const nDays = new Date(y, m, 0).getDate(), lead = (defiDate(first).getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="defi-cal__cell defi-cal__cell--pad" aria-hidden="true"></span>');
  for (let dn = 1; dn <= nDays; dn++) {
    const day = `${month}-${String(dn).padStart(2, '0')}`, st = defiDayState(c, day, today), t = defiDayTotal(c, day);
    const cls = `defi-cal__dot defi-cal__dot--${st}${day === today ? ' defi-cal__dot--now' : ''}`;
    const word = DEFI_STATE_WORDS[st];
    const label = `${dn} ${DEFI_MONTHS[m - 1]}${word ? `, ${word}` : ''}${st !== 'out' && st !== 'paused' ? `, ${defiAmountSpoken(t, c.measure)}` : ''}`;
    // La case est l'élément de liste ; le bouton (jour qu'on peut encore corriger) est dedans
    const editable = st !== 'out' && day >= defiEditFrom();
    cells.push(editable
      ? `<span class="defi-cal__cell" role="listitem"><button class="defi-cal__btn" data-action="defi-day" data-id="${esc(c.id)}" data-day="${day}" aria-label="${esc(`${label}. Corriger`)}"><span class="${cls}" aria-hidden="true">${dn}</span></button></span>`
      : `<span class="defi-cal__cell${st !== 'out' ? ' defi-cal__cell--locked' : ''}" role="listitem" aria-label="${esc(label)}"><span class="${cls}" aria-hidden="true">${dn}</span></span>`);
  }
  const prev = defiAddDays(first, -1).slice(0, 7), next = defiAddDays(`${month}-${nDays}`, 1).slice(0, 7);
  const canPrev = prev >= c.start.slice(0, 7), canNext = next <= today.slice(0, 7);
  const nav = (dir, on, lbl, ico) => `<button class="defi-cal__nav" data-action="defi-month" data-id="${esc(c.id)}" data-month="${dir}" aria-label="${lbl}"${on ? '' : ' disabled'}>${icon(ico, 18)}</button>`;
  return `<div class="defi-cal">
      <div class="defi-cal__head">${nav(prev, canPrev, 'Mois précédent', 'chevron.left')}<h3 class="defi-cal__title" aria-live="polite">${esc(defiMonthName(month).replace(/^./, s => s.toUpperCase()))}</h3>${nav(next, canNext, 'Mois suivant', 'chevron.right')}</div>
      <div class="defi-cal__week" aria-hidden="true">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(l => `<span>${l}</span>`).join('')}</div>
      <div class="defi-cal__grid" role="list" aria-label="${esc(`Jours de ${defiMonthName(month)}`)}">${cells.join('')}</div>
      <div class="defi-cal__key" aria-hidden="true">
        <span><i class="defi-cal__k defi-cal__k--done"></i>Tenu</span><span><i class="defi-cal__k defi-cal__k--missed"></i>Manqué</span><span><i class="defi-cal__k defi-cal__k--paused"></i>En pause</span>
      </div>
    </div>`;
}
// Jours notés, du plus récent au plus ancien (30 au plus ; le calendrier montre le reste)
function defiDaysListHtml(c) {
  const today = localISO();
  const days = Object.keys(c.log || {}).filter(d => d >= c.start).sort().reverse().slice(0, 30);
  if (!days.length) return '<div class="cell"><span class="cell__body"><span class="cell__sub">Rien de noté pour l\'instant.</span></span></div>';
  return days.map(day => {
    const t = defiDayTotal(c, day), g = defiGoalOn(c, day), st = defiDayState(c, day, today), n = (c.log[day] || []).length;
    const when = day === today ? 'Aujourd\'hui' : fmtDate(defiDate(day).getTime(), 'day');
    if (day < defiEditFrom()) {
      return `<div class="cell" role="group" aria-label="${esc(`${when} : ${defiAmountSpoken(t, c.measure)} sur ${defiAmountSpoken(g, c.measure)}${st === 'done' ? ', tenu' : ''}`)}">
        <span class="cell__body" aria-hidden="true"><span class="cell__title">${esc(when.replace(/^./, s => s.toUpperCase()))}</span></span>
        <span class="cell__value num defi-day__val${st === 'done' ? ' defi-day__val--done' : ''}" aria-hidden="true">${st === 'done' ? icon('checkmark', 12) : ''}${defiVal(t)} / ${defiVal(g)}</span></div>`;
    }
    return `<button class="cell cell--nav" data-action="defi-day" data-id="${esc(c.id)}" data-day="${day}" aria-label="${esc(`${when} : ${defiAmountSpoken(t, c.measure)} sur ${defiAmountSpoken(g, c.measure)}${st === 'done' ? ', tenu' : ''}, en ${n} fois. Corriger`)}">
        <span class="cell__body" aria-hidden="true"><span class="cell__title">${esc(when.replace(/^./, s => s.toUpperCase()))}</span><span class="cell__sub num">${plural(n, 'ajout', 'ajouts')}</span></span>
        <span class="cell__value num defi-day__val${st === 'done' ? ' defi-day__val--done' : ''}" aria-hidden="true">${st === 'done' ? icon('checkmark', 12) : ''}${defiVal(t)} / ${defiVal(g)}</span>${icon('chevron.right', 16)}</button>`;
  }).join('');
}
function renderDefi(id) {
  const c = defiGet(data, id);
  if (!c) return `<div class="view view--grouped">${navBar({ title: 'Défi' })}<div class="scr"><div class="empty-state"><div>Défi introuvable</div><div class="empty-state__sub">Il a été supprimé.</div></div></div></div>`;
  const t = defiToday(c), s = defiStats(c), ended = !!c.endedAt;
  const month = defiMonthOf(id, c);
  const lenLine = c.length ? `Jour\u00a0${Math.min(s.dayNo, c.length)}\u00a0sur\u00a0${c.length}` : `Jour\u00a0${s.dayNo}, sans\u00a0fin`;
  const hero = ended ? `
      <div class="defi-hero defi-hero--ended"><div class="defi-hero__text"><p class="defi-hero__big num">${esc(defiTitle(c))}</p>
        <p class="defi-hero__sub">Terminé le ${esc(fmtDate(c.endedAt, 'day'))}</p></div></div>`
    : `
      <div class="defi-hero" role="group" aria-label="${esc(`Aujourd'hui, ${defiAmountSpoken(t.done, c.measure)} sur ${defiAmountSpoken(t.goal, c.measure)}${t.reached ? ', objectif atteint' : ''}${t.paused ? ', en pause' : ''}. ${lenLine.replace(/\u00a0/g, ' ')}`)}">
        <div class="defi-hero__ring" aria-hidden="true">${defiRingSvg(t.ratio, 96, t.reached)}</div>
        <div class="defi-hero__text" aria-hidden="true"><p class="defi-hero__big num"><span class="defi-hero__num"><b>${defiVal(t.done)}</b>\u00a0/\u00a0${defiVal(t.goal)}\u00a0${defiUnit(c)}</span></p>
          <p class="defi-hero__sub"><span>${t.paused ? 'En pause' : t.reached ? 'Fait aujourd\'hui' : 'Aujourd\'hui'}</span><span class="defi-hero__len">${esc(lenLine)}</span></p></div>
      </div>
      ${t.paused ? '' : `${defiStepsHtml(c, t)}${defiFootHtml(c)}`}`;
  const muscles = typeof libExHeroHtml === 'function' ? libExHeroHtml(c.name) : '';
  const stat = (lbl, val, spoken) => `<div class="cell" role="listitem" aria-label="${esc(`${lbl} : ${spoken || val}`)}"><span class="cell__body" aria-hidden="true"><span class="cell__title">${lbl}</span></span><span class="cell__value num" aria-hidden="true">${esc(val)}</span></div>`;
  const actions = ended ? `
        <button class="cell cell--nav defi-act" data-action="defi-restart" data-id="${esc(id)}"><span class="cell__body"><span class="cell__title defi-act__t">Relancer le défi</span></span></button>
        <button class="cell defi-act defi-act--del" data-action="defi-delete" data-id="${esc(id)}"><span class="cell__body"><span class="cell__title">Supprimer le défi</span></span></button>`
    : `
        <button class="cell cell--nav defi-act" data-action="defi-edit" data-id="${esc(id)}"><span class="cell__body"><span class="cell__title defi-act__t">Modifier</span><span class="cell__sub">Objectif, durée, rappel</span></span>${icon('chevron.right', 16)}</button>
        <button class="cell defi-act" data-action="defi-pause" data-id="${esc(id)}"><span class="cell__body"><span class="cell__title defi-act__t">${t.paused ? 'Reprendre' : 'Mettre en pause'}</span><span class="cell__sub">${t.paused ? 'Les jours en pause ne comptent pas' : 'Malade, en voyage : la série est gardée'}</span></span></button>
        <button class="cell defi-act defi-act--del" data-action="defi-stop" data-id="${esc(id)}"><span class="cell__body"><span class="cell__title">Arrêter le défi</span></span></button>`;
  return `
    <div class="view view--grouped defi-view">
      ${navBar({ title: esc(c.name), large: true })}
      <div class="scr">
        <p class="defi-view__goal">${esc(`${defiAmount(defiGoal(c), c.measure)} par jour · ${defiLengthText(c)}${c.remind ? ` · rappel\u00a0à ${c.remind.replace(':', '\u00a0h\u00a0')}` : ''}`)}</p>
        ${hero}
        <div class="group-title">Chiffres</div>
        <div class="group" role="list">
          ${stat('Jours de suite', String(s.streak), defiStreakText(s.streak))}
          ${stat('Jours tenus', `${s.held} sur ${s.held + s.missed}`, `${s.held} jours tenus sur ${s.held + s.missed}`)}
          ${stat('Record d\'un jour', s.best ? defiAmount(s.best, c.measure) : '0', s.best ? `${defiAmountSpoken(s.best, c.measure)}${s.bestDay ? `, le ${fmtDate(defiDate(s.bestDay).getTime(), 'day')}` : ''}` : 'aucun')}
          ${stat('Total', defiAmount(s.total, c.measure), defiAmountSpoken(s.total, c.measure))}
        </div>
        <div class="group-foot">Compté à part : n'entre pas dans Progrès.</div>
        <div class="group-title">Calendrier</div>
        <div class="group defi-cal-group">${defiMonthHtml(c, month)}</div>
        <div class="group-foot">Touche un jour pour le corriger, jusqu'à 2 mois en arrière.</div>
        ${muscles ? `<div class="group-title">Muscles travaillés</div><div class="group defi-muscles">${muscles}</div>` : ''}
        <div class="group-title">Jour par jour</div>
        <div class="group">${defiDaysListHtml(c)}</div>
        <div class="group defi-acts">${actions}</div>
      </div>
    </div>`;
}
SCREENS.set('defi', { render: id => renderDefi(id), leave: () => { defiMonthShown = null; } });

function renderDefisEnded() {
  const list = defiList(data, { ended: true }).reverse();
  return `
    <div class="view view--grouped">
      ${navBar({ title: 'Défis terminés', large: true })}
      <div class="scr">
        <div class="group">${list.map(c => { const s = defiStats(c); return `<button class="cell cell--nav" data-action="defi-open" data-id="${esc(c.id)}">
          <span class="cell__body"><span class="cell__title">${esc(c.name)}</span><span class="cell__sub num">${esc(`${s.held} jours tenus · ${defiAmount(s.total, c.measure)} au total`)}</span></span>${icon('chevron.right', 16)}</button>`; }).join('')
          || '<div class="cell"><span class="cell__body"><span class="cell__sub">Aucun défi terminé.</span></span></div>'}</div>
      </div>
    </div>`;
}
SCREENS.set('defis-ended', { render: () => renderDefisEnded() });

// Corriger un jour : son total (0 : rien)
async function defiDaySheet(id, day) {
  const c = defiGet(data, id);
  if (!c) return;
  const t = defiDayTotal(c, day);
  const when = day === localISO() ? 'Aujourd\'hui' : fmtDate(defiDate(day).getTime(), 'day');
  const k = (c.log[day] || []).length;
  const whenLow = day === localISO() ? 'd\'aujourd\'hui' : `du ${fmtDate(defiDate(day).getTime(), 'day').toLowerCase()}`;
  const n = await defiOtherDialog(c, { title: 'Total du jour', value: t ? String(t) : '', allowZero: true,
    message: k > 1 ? `Remplace les ${k} ajouts ${whenLow}.` : k === 1 ? `Remplace l'ajout ${whenLow}.` : `Pour la journée ${whenLow}.` });
  if (n === null || n === t) return;
  const r = defiSetDay(data, id, day, n);
  if (!r) return;
  save(); haptic(); render(); defiPlanReminders();
  showToast(`${when.replace(/^./, x => x.toUpperCase())} : ${defiAmount(n, c.measure)}`, { action: 'Annuler', screen: true, onAction: () => { defiRestoreDay(data, id, day, r.before); save(); render(); defiPlanReminders(); } });
}

// ── Rappels (notification locale, iPhone) ───────────────────

// Rappels : seulement dans l'app (notification locale) ; le navigateur n'en a pas
function defiRemindAvailable() { return typeof Native !== 'undefined' && !!Native.isNative && typeof Native.scheduleDefiReminders === 'function'; }
async function defiNotifAllowed() {
  if (!defiRemindAvailable()) return false;
  return (await Native.requestNotificationPermission?.()) === 'granted';
}
// Premier jour qu'on peut encore noter ou corriger (avant, le jour ne garde que son total : js/data/defis.js)
function defiEditFrom() { return localISO(Date.now() - DEFI_EDIT_DAYS * 86400000); }
// Rappels des 14 prochains jours (un par défi et par jour), sans aujourd'hui s'il est fait ou passé, ni les jours en pause
function defiReminderPlan(d = data, now = Date.now()) {
  const out = [];
  defiList(d).forEach((c, k) => {
    if (!c.remind) return;
    const [hh, mm] = c.remind.split(':').map(Number);
    for (let i = 0; i < 14; i++) {
      const day = defiAddDays(localISO(now), i), at = defiDate(day); at.setHours(hh, mm, 0, 0);
      if (at.getTime() <= now || defiPausedOn(c, day) || (defiLastDay(c) && day > defiLastDay(c))) continue;
      if (i === 0 && defiToday(c, day).reached) continue;
      out.push({ id: 7100 + k * 20 + i, at: at.getTime(), title: c.name, body: `Défi du jour : ${defiAmount(defiGoalOn(c, day), c.measure)}` });
    }
  });
  return out;
}
// Replanifiés à chaque geste, au lancement, au retour au premier plan (heure locale : un fuseau changé est suivi) et
// après chaque fusion du compte ; annulés quand les données de l'appareil sont effacées (defiCancelReminders)
function defiPlanReminders() {
  if (!defiRemindAvailable()) return;
  Native.scheduleDefiReminders(defiReminderPlan());
}
function defiCancelReminders() { if (defiRemindAvailable()) Native.scheduleDefiReminders([]); }
// Défis de 30 ou 60 jours finis : fermés (lancement, retour, minuit, fusion), puis rappels replanifiés
function defiRefresh() {
  if (defiCloseFinished(data)) save();
  defiPlanReminders();
}
onAccountChange(kind => { if (kind === 'merged') defiPlanReminders(); });   // lancement et retour : js/app/init.js

// ── Actions ─────────────────────────────────────────────────

registerActions({
  'defi-new': () => defiNew(),
  'defi-open': (e, el) => navigate(makeRoute('defi', el.dataset.id)),
  'defi-ended': () => navigate('defis-ended'),
  'defi-add': (e, el) => defiAddNow(el.dataset.id, Number(el.dataset.n), el.dataset.day),
  'defi-other': async (e, el) => {
    const c = defiGet(data, el.dataset.id);
    if (!c) return;
    const n = await defiOtherDialog(c, { title: `${c.name} : ajouter` });
    if (n) defiAddNow(c.id, n, el.dataset.day);
  },
  'defi-undo': (e, el) => defiUndoNow(el.dataset.id),
  'defi-month': (e, el) => { defiMonthShown = { id: el.dataset.id, month: el.dataset.month }; haptic(); render(); },
  'defi-day': (e, el) => defiDaySheet(el.dataset.id, el.dataset.day),
  'defi-edit': (e, el) => defiEditSheet(el.dataset.id),
  'defi-pause': (e, el) => {
    const c = defiGet(data, el.dataset.id);
    if (!c) return;
    const on = !defiPaused(c);
    if (!defiPause(data, c.id, on)) return;
    save(); haptic(); render(); defiPlanReminders();
    announce(on ? 'Défi en pause' : 'Défi repris');
  },
  'defi-stop': async (e, el) => {
    const c = defiGet(data, el.dataset.id);
    if (!c) return;
    const v = await dialog({ type: 'sheet', title: `Arrêter « ${c.name} » ?`, message: 'Il passe dans Défis terminés, avec ses chiffres. Tu peux le relancer.',
      actions: [{ label: 'Arrêter le défi', value: 'stop', style: 'destructive' }, { label: 'Annuler', style: 'cancel' }] });
    if (v !== 'stop' || !defiStop(data, c.id)) return;
    save(); haptic(); defiPlanReminders();
    goBack();
    showToast(`Défi arrêté : ${c.name}`, { action: 'Annuler', onAction: () => { defiResume(data, c.id); save(); render(); defiPlanReminders(); } });
  },
  'defi-restart': (e, el) => {
    if (!defiResume(data, el.dataset.id)) { dialog({ title: `${DEFI_MAX} défis au plus`, message: 'Arrête un défi pour en relancer un autre.', actions: [{ label: 'OK', style: 'preferred' }] }); return; }
    save(); haptic(); render(); defiPlanReminders();
  },
  'defi-delete': async (e, el) => {
    const c = defiGet(data, el.dataset.id);
    if (!c) return;
    const v = await dialog({ type: 'sheet', title: `Supprimer « ${c.name} » ?`, message: `Ses jours notés sont effacés de ${thisPhone()} et de ton compte.`,
      actions: [{ label: 'Supprimer le défi', value: 'del', style: 'destructive' }, { label: 'Annuler', style: 'cancel' }] });
    if (v !== 'del') return;
    const before = defiDelete(data, c.id);
    if (!before) return;
    save(); haptic(); goBack();
    showToast(`Supprimé : ${c.name}`, { action: 'Annuler', onAction: () => { data.defis[c.id] = { ...before, at: Date.now() }; save(); render(); } });
  },
});
