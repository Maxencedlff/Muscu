// ═══════════════════════════════════════════════════════════
//  Plans à plusieurs jours, copies et envoi (docs/NUTRITION_V1.md, « Jours du plan » ; demandes des coachs du 18/11)
//
//  - Un plan a un jour (comme avant), deux (« Jour d'entraînement » et « Jour de repos » : l'app choisit selon la séance
//    du jour, l'élève peut changer d'un toucher) ou sept (lundi à dimanche, chaque jour marqué entraînement ou repos).
//    Logique : js/data/nutrition.js (dietPlanDays, dietSetDayMode, dietCopyMealToDays, dietCopyDayToDays).
//  - Vue des jours (diet-plan:ID) : un jour par ligne avec ses calories, ses macros et ses objectifs ; un toucher ouvre
//    le jour (diet-plan:ID:I), où l'on glisse d'un jour à l'autre. Copier un repas vers d'autres jours, copier un jour,
//    « Mettre ce jour sur les 7 jours » (confirmation, Annuler). Inspiré d'Everfit (« Copy Day », jours de repos « sans
//    séance » ou « jours fixes ») ; la copie vers plusieurs jours cochés en plus.
//  - Envoi (diet-send:ID[:ÉLÈVE]) : aperçu jour par jour (kcal, macros, eau, sel), élèves à cocher, un envoi par élève
//    par coach_send_programme (même canal, 200 Ko au plus). Le plan reste dans « Mes diètes », modèle réutilisable.
// ═══════════════════════════════════════════════════════════
'use strict';

// ── Plan : consigne, organisation des jours, actions ────────

function dietPlanInfoHtml(id, plan, ro) {
  if (ro) return plan.consigne ? `<p class="coach-prog__consigne diet-consigne">${icon('info.circle', 14)}<span>${esc(plan.consigne)}</span></p>` : '';
  return `<div class="group">
          <button class="cell cell--nav" data-action="diet-consigne" data-id="${esc(id)}"><span class="cell__body"><span class="cell__title">Consigne</span>
            <span class="cell__sub">${plan.consigne ? esc(plan.consigne) : 'Facultatif. Affichée en haut de la journée'}</span></span>${icon('chevron.right', 16)}</button>
          <button class="cell cell--nav" data-action="diet-days-mode" data-id="${esc(id)}"><span class="cell__body"><span class="cell__title">Jours</span>
            <span class="cell__sub">${esc(dietDaysWord(plan))}</span></span>${icon('chevron.right', 16)}</button>
        </div>`;
}
function dietPlanActsHtml(id, plan, ro) {
  return `<div class="group group--gap">
          ${!ro && coachRole().isCoach ? `<button class="cell cell--action" data-action="diet-send-student" data-id="${esc(id)}">${icon('paperplane', 20)}<span>Aperçu et envoi</span></button>` : ''}
          <button class="cell cell--action" data-action="diet-duplicate" data-id="${esc(id)}">${icon('doc.on.doc', 20)}<span>${ro ? 'Dupliquer pour le modifier' : 'Dupliquer le plan'}</span></button>
        </div>
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="diet-delete" data-id="${esc(id)}">Supprimer le plan</button>
        </div>`;
}
// Objectifs d'un jour en une ligne (aperçu, vue des jours) : « Objectif 2 300 kcal · Eau 3 à 5 L · Sel 3 à 5 g »
function dietDayGoalLine(o) {
  const t = o?.targets;
  if (!t) return 'Sans objectif : le total sert de repère';
  return `Objectif ${dietTargetsText({ targets: t })}`;
}
// Écart pour l'aperçu, une ligne par jour, au-delà de 5 % : « 731 kcal prévues sur 2 300 : il manque 1 569 kcal »
// (« 1 569 kcal sous l'objectif » se lisait comme 1 569 kcal prévues, panel du 18/11) ; jour sans aliment : dit aussi
function dietGapShort(sum) {
  const goal = Number(sum.targets?.kcal) || 0, kcal = Math.round(sum.macros.kcal), diff = kcal - goal;
  if (!sum.meals) return 'Aucun aliment ce jour-là';
  // Plus de 5 % (panel, tour 5 : « 1 827 kcal pour 2 000 », 8,6 %, passait sans rien dire)
  if (!goal || Math.abs(diff) <= goal * 0.05) return '';
  return `${fmtNum(kcal)}\u00a0kcal prévues sur ${fmtNum(goal)} : ${diff < 0 ? `il manque ${fmtNum(-diff)}\u00a0kcal` : `${fmtNum(diff)}\u00a0kcal en trop`}`;
}
// « Eau 3 à 5 L · Sel 3 à 5 g » d'un jour (objectifs), '' sans
function dietWaterSaltText(t) {
  return [t.water ? `Eau ${t.waterMin ? `${fmtNum(t.waterMin, 2)} à ` : ''}${fmtNum(t.water, 2)}\u00a0L` : '', dietSaltTargetText(t)].filter(Boolean).join(' · ');
}
// Jour du plan suivi aujourd'hui (vue des jours de l'élève : « Aujourd'hui »)
function dietTodayIndex(id) { return data.dietActive === id ? dietDayIndex(data, id, dietDayKey()).i : -1; }

function renderDietWeek(id, plan) {
  const ro = !!plan.fromCoach, on = data.dietActive === id, today = dietTodayIndex(id), hide = data.dietHideNumbers === true && ro;
  const days = dietPlanDays(plan);
  const row = (o, i) => {
    const m = dietPlanMacros(o), kind = dietDayKindAt(plan, i), n = dietShownMeals(o).filter(x => x.items.length).length;
    const line1 = [plan.days.mode === 'week' ? dietKindWord(kind) : '', n ? plural(n, 'repas', 'repas') : 'Aucun aliment', hide || !n ? '' : `${dietN(m.kcal)} kcal`].filter(Boolean).join(' · ');
    const macros = hide || !n ? '' : dietMacroAbbr(m);
    return `<button class="cell cell--nav diet-dayrow" data-action="diet-open-day" data-id="${esc(id)}" data-dayi="${i}">
            <span class="cell__body"><span class="cell__title">${esc(dietDayName(plan, i))}${i === today ? '<span class="diet-dayrow__today">Aujourd\'hui</span>' : ''}</span>
              <span class="cell__sub num">${esc(line1)}${macros ? ` · ${dietSrPair(esc(macros), esc(dietMacroGramsSpoken(m)))}` : ''}</span>
              ${hide ? '' : `<span class="cell__sub num">${esc(dietDayGoalLine(o))}</span>`}</span>${icon('chevron.right', 16)}</button>`;
  };
  const foot = plan.days.mode === 'session'
    ? 'Chaque jour, l\'app prend le jour d\'entraînement si une séance est faite ou commencée, sinon le jour de repos. L\'élève peut changer d\'un toucher.'
    : 'Chaque jour suit le calendrier, du lundi au dimanche.';
  return `
    <div class="view view--grouped diet-plan-view">
      ${navBar({ title: esc(plan.name), right: ro ? '' : `<button class="navbar__text" data-action="diet-rename" data-id="${esc(id)}">Renommer</button>`, large: true })}
      <div class="scr">
        <div class="group">
          ${on ? `<div class="cell"><span class="cell__body"><span class="cell__title">Plan en cours</span><span class="cell__sub">Il s'affiche chaque jour sur l'accueil, carte Nutrition</span></span><span class="diet-on-mark" aria-hidden="true">${icon('checkmark', 18)}</span></div>`
            : `<button class="cell cell--action" data-action="diet-follow" data-id="${esc(id)}">${icon('checkmark', 20)}<span>Utiliser ce plan</span></button>`}
        </div>
        ${dietPlanInfoHtml(id, plan, ro)}
        <div class="group-title">${plan.days.mode === 'week' ? 'Semaine' : 'Jours'}</div>
        ${dietMacroLegendHtml()}
        <div class="group">${days.map(row).join('')}</div>
        <div class="group-foot">${foot}</div>
        ${dietPlanActsHtml(id, plan, ro)}
        ${dietSourceFoot()}
      </div>
    </div>`;
}

// ── Écran d'un jour ─────────────────────────────────────────

// Haut de l'écran d'un jour : nom du plan, choix du jour (7 jours ou entraînement / repos), type du jour (semaine)
function dietDayHeadHtml(id, plan, di, ro) {
  const today = dietTodayIndex(id);
  const pick = plan.days.mode === 'week'
    ? `<div class="diet-week diet-daypick" role="group" aria-label="Jours du plan">${DIET_WEEKDAYS.map((n, i) => `
          <button class="diet-week__day${i === di ? ' diet-week__day--on' : ''}" data-action="diet-goto-day" data-id="${esc(id)}" data-dayi="${i}" aria-pressed="${i === di}"
            aria-label="${esc(`${n}, ${dietDayKindAt(plan, i) === 'r' ? 'jour de repos' : 'jour d\'entraînement'}${i === today ? ', aujourd\'hui' : ''}`)}">
            <span class="diet-week__letter" aria-hidden="true">${n.slice(0, 3)}</span>
            <span class="diet-week__kind${dietDayKindAt(plan, i) === 'r' ? ' diet-week__kind--r' : ''}" aria-hidden="true">${dietDayKindAt(plan, i) === 'r' ? 'Repos' : icon('dumbbell', 14)}</span>
            <span class="diet-week__dot${i === today ? ' diet-week__dot--done' : ''}" aria-hidden="true"></span>
          </button>`).join('')}</div>
        <p class="diet-week__legend" aria-hidden="true"><span>${icon('dumbbell', 14)} jour d'entraînement</span><span><span class="diet-week__kind diet-week__kind--r">Repos</span> jour de repos</span></p>`
    : `<div class="segmented seg-full diet-daypick" role="group" aria-label="Jour du plan">${[0, 1].map(i => `<button class="segmented__btn${i === di ? ' segmented__btn--active' : ''}" data-action="diet-goto-day" data-id="${esc(id)}" data-dayi="${i}" aria-pressed="${i === di}">${i ? 'Repos' : 'Entraînement'}</button>`).join('')}</div>`;
  const kind = plan.days.mode === 'week' && !ro ? `<div class="group-title">Type de jour</div>
        <div class="segmented seg-full diet-daykind" role="group" aria-label="Type de ${esc(DIET_WEEKDAYS[di])}">${[['t', 'Entraînement'], ['r', 'Repos']].map(([k, l]) => `
          <button class="segmented__btn${dietDayKindAt(plan, di) === k ? ' segmented__btn--active' : ''}" data-action="diet-day-set-kind" data-k="${k}" aria-pressed="${dietDayKindAt(plan, di) === k}">${l}</button>`).join('')}</div>` : '';
  return `<p class="diet-plan-from"><b>${esc(plan.name)}</b>${di === today ? ' · aujourd\'hui' : ''}</p>${pick}${kind}`;
}
// Bas de l'écran d'un jour : copier ce jour, le mettre sur tous les jours, jour précédent et suivant
function dietDayFootHtml(id, plan, di, ro) {
  const n = dietPlanDays(plan).length, week = plan.days.mode === 'week';
  const nav = `<div class="diet-daynav">
          ${di > 0 ? `<button class="diet-daynav__btn" data-action="diet-goto-day" data-id="${esc(id)}" data-dayi="${di - 1}">${icon('chevron.left', 14)}<span>${esc(dietDayName(plan, di - 1))}</span></button>` : '<span></span>'}
          ${di < n - 1 ? `<button class="diet-daynav__btn diet-daynav__btn--next" data-action="diet-goto-day" data-id="${esc(id)}" data-dayi="${di + 1}"><span>${esc(dietDayName(plan, di + 1))}</span>${icon('chevron.right', 14)}</button>` : '<span></span>'}
        </div>
        <div class="group-foot">Glisse vers la gauche ou la droite pour changer de jour.</div>`;
  if (ro) return nav;
  return `<div class="group group--gap">
          <button class="cell cell--action" data-action="diet-copy-day" data-dayi="${di}">${icon('doc.on.doc', 20)}<span>${week ? 'Copier ce jour vers…' : `Copier vers le ${di ? 'jour d\'entraînement' : 'jour de repos'}`}</span></button>
          ${week && dietSameKindDays(plan, di).length ? `<button class="cell cell--action" data-action="diet-day-same" data-dayi="${di}">${icon('doc.on.doc', 20)}<span class="cell__body"><span>Copier vers les autres jours ${dietDayKindAt(plan, di) === 'r' ? 'de repos' : 'd\'entraînement'}</span>
            <span class="cell__sub">${esc(dietSameKindDays(plan, di).map(i => DIET_WEEKDAYS[i].toLowerCase()).join(', '))}</span></span></button>` : ''}
          ${week ? `<button class="cell cell--action" data-action="diet-day-all" data-dayi="${di}">${icon('calendar', 20)}<span>Mettre pareil sur les 7 jours</span></button>` : ''}
        </div>
        ${nav}`;
}

// Les autres jours du même type (semaine) : un menu de repos fait une fois, mis d'un toucher sur tous les jours de repos
function dietSameKindDays(plan, di) {
  const k = dietDayKindAt(plan, di);
  return plan.days?.mode === 'week' ? DIET_WEEKDAYS.map((_, i) => i).filter(i => i !== di && dietDayKindAt(plan, i) === k) : [];
}

// ── Choisir des jours (copies) ──────────────────────────────

// Feuille à cases : les jours du plan sauf except, « Tous » ; renvoie les index cochés, ou null
async function dietPickDays(plan, except, title, confirm = 'Copier') {
  const days = dietPlanDays(plan).map((_, i) => i).filter(i => i !== except);
  const sel = new Set();
  // Liste iOS (panel nutri-final t1 : la grille de boutons faisait brouillon) : une ligne par jour, coche à droite,
  // « Tous les autres jours » en tête
  const row = (k, on, title, sub) => `
        <button type="button" class="sheet-list__row diet-dpick__row${on ? ' diet-dpick__row--on' : ''}" role="checkbox" aria-checked="${on}" data-dpick="${k}">
          <span class="diet-dpick__txt"><span class="diet-dpick__title">${title}</span>${sub ? `<span class="diet-dpick__sub">${sub}</span>` : ''}</span>
          <span class="diet-dpick__mark" aria-hidden="true">${on ? icon('checkmark', 18) : ''}</span></button>`;
  const rows = () => `<div class="sheet-list">${row('all', sel.size === days.length, 'Tous les autres jours', '')}</div>
      <div class="sheet-list">${days.map(i => row(i, sel.has(i), esc(dietDayName(plan, i)), plan.days?.mode === 'week' ? dietKindWord(dietDayKindAt(plan, i)) : '')).join('')}</div>
      <p class="diet-form__err" id="dietDaysErr" role="alert"></p>`;
  const p = sheet({ title, confirm, body: `<div class="diet-dpick">${rows()}</div>`, onConfirm: panel => {
    if (!sel.size) { $('#dietDaysErr', panel).textContent = 'Coche au moins un jour.'; return false; }
    return { days: [...sel].sort((a, b) => a - b) };
  } });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  root?.addEventListener('click', ev => {
    const b = ev.target.closest('[data-dpick]');
    if (!b) return;
    const k = b.dataset.dpick;
    if (k === 'all') { if (sel.size === days.length) sel.clear(); else days.forEach(i => sel.add(i)); }
    else { const i = Number(k); if (sel.has(i)) sel.delete(i); else sel.add(i); }
    haptic('light');
    $('.diet-dpick', root).innerHTML = rows();
  });
  const r = await p;
  return r?.days || null;
}
// Liste des jours pour un toast : « mardi, jeudi », « 6 jours »
function dietDaysListText(plan, list) {
  return list.length > 3 ? plural(list.length, 'jour', 'jours') : list.map(i => dietDayName(plan, i).toLowerCase()).join(', ');
}
// Copier un repas vers d'autres jours (menu d'un repas) ; Annuler remet les jours comme avant
async function dietCopyMealFlow(ed, meal) {
  const to = await dietPickDays(ed.root, ed.day, 'Copier vers…');   // titre court : le nom du repas coupait le titre sur SE
  if (!to) return;
  const before = dietCopyMealToDays(ed.root, ed.day, meal.id, to);
  if (!before) { showToast(`${DIET_MEAL_MAX} repas au plus par jour`, { error: true }); return; }
  dietTouch(ed.root); save(); haptic(); render();
  showToast(`${meal.name} copié : ${dietDaysListText(ed.root, to)}`, { action: 'Annuler', duration: 6000, onAction: () => {
    const p = dietPlanOf(ed.id); dietRestoreDays(p, before); dietTouch(p); save(); render(); announce('Copie annulée');
  } });
}

// ── Glisser d'un jour à l'autre (écran d'un jour) ───────────

// Seulement un glissé horizontal net (60 px, peu de vertical), jamais depuis le bord gauche (retour d'iOS), un champ,
// un contrôle ou une ligne qui se balaie pour supprimer
let dietSwipe = null;
document.addEventListener('touchstart', e => {
  const t = e.touches?.[0], scr = e.target?.closest?.('.diet-dayswipe');
  dietSwipe = t && scr && t.clientX > 24 && !e.target.closest('[data-swipe-del], input, textarea, select, .segmented, .diet-week')
    ? { x: t.clientX, y: t.clientY, scr } : null;
}, { passive: true });
document.addEventListener('touchend', e => {
  const s = dietSwipe, t = e.changedTouches?.[0];
  dietSwipe = null;
  if (!s || !t) return;
  const dx = t.clientX - s.x, dy = t.clientY - s.y;
  if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return;
  const id = s.scr.dataset.plan, di = Number(s.scr.dataset.dayi), plan = dietPlanOf(id);
  const next = di + (dx < 0 ? 1 : -1);
  if (!plan || next < 0 || next >= dietPlanDays(plan).length) return;
  dietGotoDay(id, next);
}, { passive: true });
function dietGotoDay(id, i) {
  navReplaceQuiet(makeRoute('diet-plan', id, i));
  render();
  haptic('light');
  announce(dietDayName(dietPlanOf(id), i));
}

// ── Envoi : aperçu par jour, plusieurs élèves ───────────────

let dietSendSel = null;   // { key, ids: Set, busy, done }
function dietSendFor(planId, uid) {
  const key = `${planId}/${uid || ''}`;
  if (dietSendSel?.key !== key) dietSendSel = { key, ids: new Set(uid && coachStudent(uid) ? [uid] : []), busy: false, done: 0 };
  return dietSendSel;
}
function dietSendBtnText(m) {
  if (m.busy) return `Envoi… ${m.done} sur ${m.ids.size}`;
  return m.ids.size ? `Envoyer à ${plural(m.ids.size, 'élève', 'élèves')}` : 'Choisis des élèves';
}
function renderDietSend(planId, uid) {
  const plan = dietPlanOf(planId);
  if (!plan || plan.fromCoach) return `<div class="view view--grouped">${navBar({ title: 'Envoyer' })}<div class="scr"><div class="empty-note">Ce plan n'existe plus.</div></div></div>`;
  const m = dietSendFor(planId, uid), all = (coach.state?.students || []).slice().sort((a, b) => personName(a).localeCompare(personName(b), 'fr'));
  const allOn = all.length > 0 && all.every(st => m.ids.has(st.user_id));
  const wsAll = dietPlanDays(plan).map(o => dietWaterSaltText(o.targets || {}));
  const sameWs = wsAll.every(x => x === wsAll[0]) && wsAll[0] ? wsAll[0] : null;
  const days = dietPlanDays(plan).map((o, i) => {
    const sum = dietDaySummary(plan, i), gap = dietGapShort(sum);
    const name = plan.days ? `${sum.name}${plan.days.mode === 'week' ? ` · ${dietKindWord(sum.kind)}` : ''}` : 'Chaque jour';
    // Deux lignes par jour (panel du 18/11, tour 2) : calories prévues sur l'objectif et l'écart, puis macros, eau et
    // sel ; le détail s'ouvre d'un toucher (l'écran du jour)
    const goal = Number(o?.targets?.kcal) || 0, t = o?.targets || {};
    const l1 = !sum.meals ? 'Aucun aliment' : `${dietN(sum.macros.kcal)}${goal ? ` sur ${dietN(goal)}` : ''}\u00a0kcal${gap ? ` · ${gap.replace(/^.*: /, '')}` : ''}`;
    // Eau et sel : une fois sous « Aperçu » quand ils sont les mêmes chaque jour (deux lignes par jour, panel tour 4)
    const ws = dietWaterSaltText(t);
    const l2 = [sum.meals ? dietMacroAbbr(sum.macros) : '', ws === sameWs ? '' : ws].filter(Boolean).join(' · ');
    const tag = plan.days ? `<button class="cell cell--nav diet-sendday" data-action="diet-open-day" data-id="${esc(planId)}" data-dayi="${i}">` : '<div class="cell diet-sendday">';
    return `${tag}<span class="cell__body"><span class="cell__title">${esc(name)}</span>
          <span class="cell__sub num${gap ? ' diet-sendday__gap' : ''}">${gap ? icon('info.circle', 12) : ''}${esc(l1)}</span>
          ${l2 ? `<span class="cell__sub num">${esc(l2)}</span>` : ''}</span>${plan.days ? `${icon('chevron.right', 16)}</button>` : '</div>'}`;
  }).join('');
  const rows = all.map(st => {
    const on = m.ids.has(st.user_id);
    return `<button class="cell coach-pick${on ? ' coach-pick--on' : ''}" role="checkbox" aria-checked="${on}" data-action="diet-send-pick" data-uid="${esc(st.user_id)}" ${m.busy ? 'disabled' : ''}>
            <span class="coach-pick__box" aria-hidden="true">${on ? icon('checkmark', 14) : ''}</span>${personAvatar(st, 's')}
            <span class="cell__body"><span class="cell__title">${esc(personName(st))}</span></span></button>`;
  }).join('');
  return `
    <div class="view view--grouped diet-send-view">
      ${navBar({ title: 'Envoyer', large: false })}
      <div class="scr">
        <h1 class="scr-title">${esc(plan.name)}</h1>
        ${plan.consigne ? `<p class="coach-prog__consigne diet-consigne">${icon('info.circle', 14)}<span>${esc(plan.consigne)}</span></p>` : ''}
        <div class="group-title">Aperçu</div>
        ${sameWs ? `<p class="diet-plan-from num">Chaque jour : ${esc(sameWs)}</p>` : ''}
        ${dietMacroLegendHtml()}
        <div class="group">${days}</div>
        <div class="group-title">Élèves</div>
        ${!coach.state ? `<div class="group"><div class="cell"><span class="cell__sub">${esc(coachErrorText('offline'))}</span></div></div>`
          : !all.length ? '<div class="group"><div class="cell"><span class="cell__sub">Aucun élève pour l\'instant.</span></div></div>' : `
        <div class="group">
          <button class="cell coach-pick coach-pick--all${allOn ? ' coach-pick--on' : ''}" role="checkbox" aria-checked="${allOn}" data-action="diet-send-all" ${m.busy ? 'disabled' : ''}>
            <span class="coach-pick__box" aria-hidden="true">${allOn ? icon('checkmark', 14) : ''}</span><span class="cell__body"><span class="cell__title">Tous</span></span><span class="cell__value num">${all.length}</span></button>
        </div>
        <div class="group">${rows}</div>`}
        <div class="group-foot">Le plan reste dans Mes diètes. Un nouvel envoi le met à jour chez l'élève, qui doit avoir accepté les plans de nutrition.</div>
        <button class="btn btn--primary btn--full coach-send-btn" id="dietSendGo" data-action="diet-send-go" data-id="${esc(planId)}" ${m.busy || !m.ids.size ? 'disabled' : ''}>${esc(dietSendBtnText(m))}</button>
      </div>
    </div>`;
}
SCREENS.set('diet-send', { render: (planId, uid) => renderDietSend(planId, uid), enter: () => { if (account.user) coachRefresh(); } });

// Un envoi par élève, 3 à la fois ; arrêté au premier refus de limite
async function dietSendMany(uids, planId) {
  const queue = uids.slice(), sent = [], failed = [];
  let rate = false;
  const worker = async () => {
    while (queue.length && !rate) {
      const uid = queue.shift(), r = await coachSendDiet(uid, planId);
      if (r.ok) sent.push(uid);
      else { if (r.kind === 'send_rate') rate = true; failed.push({ uid, kind: r.kind }); }
      if (dietSendSel) { dietSendSel.done = sent.length + failed.length; const b = $('#dietSendGo'); if (b) b.textContent = dietSendBtnText(dietSendSel); }
    }
  };
  await Promise.all([1, 2, 3].map(worker));
  return { sent, failed, rate, left: queue.length };
}
const dietSendError = kind => (kind === 'too_big' ? 'Plan trop gros pour être envoyé : retire des jours ou des aliments.' : coachErrorText(kind));

// ── Actions ─────────────────────────────────────────────────

registerActions({
  'diet-open-day': (e, el) => navigate(makeRoute('diet-plan', el.dataset.id, el.dataset.dayi)),
  'diet-goto-day': (e, el) => dietGotoDay(el.dataset.id, Number(el.dataset.dayi)),
  'diet-consigne': async (e, el) => {
    const plan = dietPlanOf(el.dataset.id);
    if (!plan || plan.fromCoach) return;
    const r = await coachTextSheet({ title: 'Consigne du plan', value: plan.consigne || '', placeholder: 'Par exemple : pèse les féculents cuits',
      max: CONSIGNE_MAX, existing: false, confirm: 'OK' });
    if (r == null) return;
    const c = cleanConsigne(r);
    if (c) plan.consigne = c; else delete plan.consigne;
    dietTouch(plan); save(); render();
  },
  // Organisation des jours : un seul, entraînement et repos, semaine. Revenir à un seul jour garde le premier (Annuler)
  'diet-days-mode': async (e, el) => {
    const plan = dietPlanOf(el.dataset.id);
    if (!plan || plan.fromCoach) return;
    const cur = plan.days?.mode || 'one';
    const v = await dialog({ type: 'sheet', title: 'Jours', message: 'Entraînement et repos : l\'app choisit selon la séance du jour. Semaine : un plan par jour, du lundi au dimanche.',
      actions: [['one', 'Tous les jours pareils'], ['session', 'Entraînement et repos'], ['week', 'Semaine (lundi à dimanche)']]
        .map(([value, label]) => ({ label: value === cur ? `${label} (actuel)` : label, value })).concat([{ label: 'Annuler', style: 'cancel' }]) });
    if (!v || v === cur) return;
    if (v === 'one' && !(await confirmSheet(`Garder seulement ${dietDayName(plan, 0).toLowerCase() || 'le premier jour'} ?`, 'Les autres jours sont retirés du plan.', 'Garder'))) return;
    const snap = dietDaysSnapshot(plan);
    dietSetDayMode(plan, v);
    dietTouch(plan); save(); haptic(); render();
    const said = { one: `Un seul jour : ${dietDayName({ days: { mode: cur } }, 0).toLowerCase() || 'le premier'} gardé`, session: 'Jour de repos ajouté, copie du premier jour',
      week: '7 jours, copies du premier jour' }[v];
    showToast(said, { action: 'Annuler', duration: 6000, onAction: () => {
      const p = dietPlanOf(el.dataset.id); dietRestoreDays(p, snap); dietTouch(p); save(); render();
    } });
  },
  'diet-day-set-kind': (e, el) => {
    const ed = dietEditedPlan();
    if (!ed || ed.root.days?.mode !== 'week' || !['t', 'r'].includes(el.dataset.k)) return;
    ed.root.days.kinds[ed.day] = el.dataset.k;
    haptic('light'); dietSaved();
  },
  'diet-copy-day': async (e, el) => {
    const ed = dietEditedPlan();
    if (!ed?.root.days) return;
    const name = dietDayName(ed.root, ed.day);
    const to = ed.root.days.mode === 'session' ? [ed.day ? 0 : 1] : await dietPickDays(ed.root, ed.day, `Copier ${name.toLowerCase()} vers…`);
    if (!to) return;
    if (ed.root.days.mode === 'session' && !(await confirmSheet(`Copier vers le ${dietDayName(ed.root, to[0]).toLowerCase()} ?`, 'Ses repas et ses objectifs sont remplacés par ceux de ce jour.', 'Copier'))) return;
    const before = dietCopyDayToDays(ed.root, ed.day, to);
    if (!before) return;
    dietTouch(ed.root); save(); haptic(); render();
    showToast(`${name} copié : ${dietDaysListText(ed.root, to)}`, { action: 'Annuler', duration: 6000, onAction: () => {
      const p = dietPlanOf(ed.id); dietRestoreDays(p, before); dietTouch(p); save(); render(); announce('Copie annulée');
    } });
  },
  'diet-day-same': async (e, el) => {
    const ed = dietEditedPlan();
    if (ed?.root.days?.mode !== 'week') return;
    const to = dietSameKindDays(ed.root, ed.day), name = dietDayName(ed.root, ed.day), word = dietDayKindAt(ed.root, ed.day) === 'r' ? 'de repos' : 'd\'entraînement';
    if (!to.length || !(await confirmSheet(`Copier ${name.toLowerCase()} sur les autres jours ${word} ?`, `${dietDaysListText(ed.root, to).replace(/^./, c => c.toUpperCase())} : repas et objectifs remplacés.`, 'Copier'))) return;
    const before = dietCopyDayToDays(ed.root, ed.day, to);
    if (!before) return;
    dietTouch(ed.root); save(); haptic(); render();
    showToast(`${name} copié : ${dietDaysListText(ed.root, to)}`, { action: 'Annuler', duration: 6000, onAction: () => {
      const p = dietPlanOf(ed.id); dietRestoreDays(p, before); dietTouch(p); save(); render(); announce('Copie annulée');
    } });
  },
  'diet-day-all': async (e, el) => {
    const ed = dietEditedPlan();
    if (ed?.root.days?.mode !== 'week') return;
    const name = dietDayName(ed.root, ed.day);
    if (!(await confirmSheet(`Mettre ${name.toLowerCase()} sur les 7 jours ?`, 'Les repas, les objectifs et le type de jour (entraînement ou repos) des 6 autres jours sont remplacés.', 'Remplacer'))) return;
    const to = [0, 1, 2, 3, 4, 5, 6].filter(i => i !== ed.day);
    const before = dietCopyDayToDays(ed.root, ed.day, to);
    if (!before) return;
    ed.root.days.kinds = ed.root.days.kinds.map(() => dietDayKindAt(ed.root, ed.day));
    dietTouch(ed.root); save(); haptic(); render();
    showToast('Même plan sur les 7 jours', { action: 'Annuler', duration: 6000, onAction: () => {
      const p = dietPlanOf(ed.id); dietRestoreDays(p, before); dietTouch(p); save(); render(); announce('Annulé');
    } });
  },
  'diet-send-student': (e, el) => { dietSendSel = null; navigate(makeRoute('diet-send', el.dataset.id)); },
  'diet-send-pick': (e, el) => {
    const m = dietSendSel;
    if (!m || m.busy) return;
    if (m.ids.has(el.dataset.uid)) m.ids.delete(el.dataset.uid); else m.ids.add(el.dataset.uid);
    haptic('light'); render();
  },
  'diet-send-all': () => {
    const m = dietSendSel, all = coach.state?.students || [];
    if (!m || m.busy) return;
    m.ids = new Set(all.every(st => m.ids.has(st.user_id)) ? [] : all.map(st => st.user_id));
    haptic('light'); render();
  },
  'diet-send-go': async (e, el) => {
    const m = dietSendSel, planId = el.dataset.id, plan = dietPlanOf(planId);
    if (!m || m.busy || !m.ids.size || !plan) return;
    const ids = [...m.ids].filter(id => coachStudent(id)), limit = coachSendLimit();
    if (ids.length > limit) { showToast(`${limit} envois au plus sur 24 heures`, { error: true }); return; }
    // Confirmation qui nomme les élèves et dit les jours loin de l'objectif (coach débutant, panel du 18/11 : « peur
    // d'écraser le plan du mauvais élève », « rien ne m'empêche d'envoyer un plan à moitié rempli »)
    const names = ids.map(id => personName(coachStudent(id)));
    const who = names.length > 3 ? plural(names.length, 'élève', 'élèves') : names.join(', ').replace(/, ([^,]*)$/, ' et $1');
    // Écarts dits en clair (« Lundi : il manque 1 569 kcal ») et « Revoir les jours » à côté d'Envoyer (panel, tour 3)
    // Par sens (panel nutri-final, tour ciblé : « et 2 autres jours » laissait croire qu'ils étaient aussi en trop) : deux jours
    // nommés par groupe au plus, puis « et 1 autre jour en trop » / « et 2 autres jours où il manque des kcal »
    const gapsAll = dietPlanDays(plan).map((_, i) => [i, dietGapShort(dietDaySummary(plan, i))]).filter(([, g]) => g)
      .map(([i, g]) => ({ over: g.includes('en trop'), txt: `${plan.days ? dietDayName(plan, i) : 'Chaque jour'} : ${g.replace(/^.*: /, '')}` }));
    const group = (list, tail) => (!list.length ? '' : `${list.slice(0, 2).map(x => x.txt).join('. ')}${list.length > 2 ? `, et ${plural(list.length - 2, 'autre jour', 'autres jours')} ${tail}` : ''}.`);
    const gaps = gapsAll;
    const gapText = [group(gapsAll.filter(x => x.over), 'en trop'), group(gapsAll.filter(x => !x.over), 'où il manque des kcal')].filter(Boolean).join(' ');
    const msg = [gapText, 'Un plan déjà envoyé est mis à jour chez l\'élève. Ce qu\'il a déjà coché reste.'].filter(Boolean).join(' ');
    // Alerte à deux boutons (pas une feuille destructive : envoyer n'efface rien)
    const go = await dialog({ title: `Envoyer « ${plan.name} » à ${who} ?`, message: msg,
      actions: [{ label: gaps.length ? 'Revoir les jours' : 'Annuler', style: 'cancel' }, { label: 'Envoyer', value: true, style: 'preferred' }] });
    if (go !== true) { if (gaps.length) window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' }); return; }
    m.busy = true; m.done = 0; render();
    const r = await dietSendMany(ids, planId);
    m.busy = false;
    if (!r.failed.length) {
      haptic('success');
      showToast(r.sent.length > 1 ? `« ${plan.name} » envoyé à ${plural(r.sent.length, 'élève', 'élèves')}` : `Plan envoyé à ${personName(coachStudent(r.sent[0]))}`);
      dietSendSel = null; goBack(); coachRefresh();
      return;
    }
    r.sent.forEach(id => m.ids.delete(id));
    await dialog({ title: r.sent.length ? `Envoyé à ${r.sent.length} sur ${ids.length}` : 'Rien n\'a été envoyé',
      message: `${dietSendError(r.failed[0].kind)} ${plural(r.failed.length + r.left, 'élève reste coché', 'élèves restent cochés')}.`, actions: [{ label: 'OK', style: 'preferred' }] });
    render(); coachRefresh();
  },
});
