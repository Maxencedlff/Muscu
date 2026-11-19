// ═══════════════════════════════════════════════════════════
//  Eau (docs/EAU.md, logique dans js/data/water.js) : carte de l'écran Nutrition, ligne de la carte Nutrition de
//  l'accueil (ou petite carte seule sans plan), feuilles de l'objectif et de l'historique, contenants perso.
//
//  - Un toucher ajoute tout de suite (retour haptique, « Annuler » dans le toast) : rien au pointerdown.
//  - Jauge et verre en vert (--check-on) : la couleur de l'avancée vers l'objectif, comme l'anneau des calories.
//    Pas de bleu (celui des protéines), pas d'orange (réservé aux actions), jamais de rouge.
//  - Le jour suit celui de Nutrition (frise) ; aujourd'hui est lu au toucher (écran resté ouvert après minuit).
// ═══════════════════════════════════════════════════════════
'use strict';

// Suivi affiché : activé par la personne, ou objectif fixé dans le plan de nutrition (coach)
function waterShown(d = data) {
  return d.waterOn === true || dietPlanDays(dietActivePlan(d)).some(o => cleanWaterLitres(o.targets?.water) !== null);
}
function waterSex() { return strengthSex(data) || data.dietEstSex || null; }
// État d'un jour : bu (ml), objectif ({ l, src, plus… }), jour d'entraînement
function waterState(day = localISO()) {
  const training = waterTrainingDay(data, day, { live: typeof activeSession !== 'undefined' && !!activeSession });
  // Plan du jour (entraînement / repos, jour de la semaine) : son objectif d'eau
  const plan = data.dietActive ? dietDayPlan(data, data.dietActive, day) : null;
  const goal = waterGoalFor(data, { plan: plan && !plan.archived ? plan : null, sex: waterSex(), training });
  const ml = waterDayMl(data, day);
  return { day, ml, goal, training, ratio: goal.l > 0 ? Math.min(1, ml / (goal.l * 1000)) : 0, reached: ml >= Math.round(waterGoalLow(goal) * 1000) };
}
// « 1,2 sur 2,8 L », lu « 1,2 litre sur 2,8 »
function waterValText(st, sep = 'sur') { return `${waterLitres(st.ml)} ${sep} ${waterGoalText(st.goal)}`; }
function waterValSpoken(st) {
  const l = `${waterLitres(st.ml)} litre${st.ml >= 2000 ? 's' : ''}`;
  return st.goal.min != null ? `${l}, objectif ${waterGoalSpoken(st.goal)}` : `${l} sur ${fmtNum(st.goal.l, 2)}${st.goal.plus ? ', dont 0,5 litre pour la séance' : ''}`;
}
// « (dont +0,5 L séance) » : le total du jour dit d'où vient la hausse (option C du 17/11)
function waterPlusHtml(st) { return st.goal.plus ? ` <span class="water-card__plus">(dont +${fmtNum(st.goal.plus, 2)}\u00a0L séance)</span>` : ''; }

// Verre qui se remplit (visuel de la jauge, caché à VoiceOver qui lit les chiffres)
function waterGlassSvg(ratio, size = 44) {
  const id = 'wg' + uid(), top = 6, bottom = 40, h = bottom - top, y = bottom - h * Math.max(0, Math.min(1, ratio));
  const shape = 'M9 6h26l-3.2 32.2a2 2 0 0 1-2 1.8H14.2a2 2 0 0 1-2-1.8Z';
  return `<svg class="water-glass" width="${size}" height="${size}" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <defs><clipPath id="${id}"><path d="${shape}"/></clipPath></defs>
      <rect class="water-glass__fill" x="0" y="${y.toFixed(1)}" width="44" height="${(bottom - y).toFixed(1)}" clip-path="url(#${id})"/>
      <path class="water-glass__line" d="${shape}"/></svg>`;
}
// Jauge ; zone [min, 1] (fourchette, en part du haut) : bande plus claire de la zone à viser
function waterBarHtml(ratio, zoneFrom = null) {
  const zone = zoneFrom != null && zoneFrom > 0 && zoneFrom < 1 ? `<i class="water-bar__zone" style="left:${Math.round(zoneFrom * 1000) / 10}%"></i>` : '';
  return `<span class="water-bar${zone ? ' water-bar--zone' : ''}" aria-hidden="true">${zone}<i class="water-bar__fill" style="width:${Math.round(ratio * 1000) / 10}%"></i></span>`;
}
const waterZoneFrom = st => (st.goal.min != null ? st.goal.min / st.goal.l : null);
// Verres à cocher (fourchette du coach ou objectif) : un toucher sur un verre vide l'ajoute, sur le dernier plein le retire
function waterGlassesHtml(st, attrDay) {
  const { ml, n } = waterGlassPlan(st.goal), full = Math.min(n, Math.floor(st.ml / ml));
  const low = Math.ceil(Math.round(waterGoalLow(st.goal) * 1000) / ml);
  const size = waterQtyText(ml);
  const cells = Array.from({ length: n }, (_, i) => {
    const on = i < full, last = i === full - 1;
    // « Verre » seulement pour 25 cl (comme le bouton « Verre 25 cl ») ; 50 cl et 1 L : « case » (panel du 18/11), dessinée
    // en case et non en verre (une icône = un sens, panel nutri-final t1)
    const w = ml === 250 ? 'Verre' : 'Case';
    const label = on ? (last ? `${w} ${i + 1} sur ${n}, ${waterQtySpoken(ml)}, bu. Retirer` : `${w} ${i + 1} sur ${n}, bu`) : `${w} ${i + 1} sur ${n}. Ajouter ${waterQtySpoken(ml)}`;
    return `<button class="water-cup${on ? ' water-cup--on' : ''}${i >= low ? ' water-cup--extra' : ''}" data-action="water-glass" data-ml="${ml}" data-op="${on ? (last ? 'del' : 'none') : 'add'}"${attrDay ? ` data-day="${esc(attrDay)}"` : ''}
        aria-pressed="${on}" aria-label="${esc(label)}"${on && !last ? ' aria-disabled="true"' : ''}>${ml === 250 ? waterGlassSvg(on ? 1 : 0, 28) : `<span class="water-case${on ? ' water-case--on' : ''}" aria-hidden="true"></span>`}</button>`;
  }).join('');
  return `<div class="water-cups" role="group" aria-label="${esc(`${n} ${ml === 250 ? 'verres' : 'cases'} de ${waterQtySpoken(ml)}`)}">${cells}</div>
          <p class="water-cups__note num">${esc(`${ml === 250 ? 'Un verre' : 'Une case'} = ${size}${st.goal.min != null ? ` · ${low} au moins` : ''}`)}</p>`;
}
// Bouton d'ajout : « + Verre 25 cl » ; day vide : aujourd'hui, lu au toucher
function waterAddBtnHtml(cup, day = '', extra = '') {
  // Nom et quantité sur deux lignes (« Bouteille » / « 50 cl ») : la même forme sur iPhone SE et sur grand écran
  const qty = cup.name === '1 L' ? '' : ` <small class="water-add__qty">${waterQtyText(cup.ml)}</small>`;
  return `<button class="water-add${extra}" data-action="water-add" data-ml="${cup.ml}"${day ? ` data-day="${esc(day)}"` : ''}
      aria-label="Ajouter ${esc(cup.name === '1 L' ? '1 litre' : `${cup.name}, ${waterQtySpoken(cup.ml)}`)}">${icon('plus', 14)}<span class="water-add__lbl">${esc(cup.name)}${qty}</span></button>`;
}

// ── Écran Nutrition ─────────────────────────────────────────

// Carte « Eau » du jour affiché (day : jour de la frise ; past : jour passé, figé dans les boutons)
function waterCardHtml(day, { past = false } = {}) {
  const st = waterState(day), attrDay = past ? day : '';
  const n = waterDay(data, day).length;
  return `
        <h2 class="group-title" id="waterTitle">Eau</h2>
        <section class="water-card" aria-labelledby="waterTitle">
          <button class="water-card__top" data-action="water-goal" aria-label="${esc(`Eau : ${waterValSpoken(st)}${st.reached ? ', objectif atteint' : ''}. Changer l'objectif`)}">
            <span class="water-card__glass">${waterGlassSvg(st.ratio)}</span>
            <span class="water-card__text" aria-hidden="true">
              <span class="water-card__val num"><b>${waterLitres(st.ml)}</b> ${st.goal.min != null ? `L · objectif ${waterGoalText(st.goal)}` : `sur ${fmtNum(st.goal.l, 2)}\u00a0L`}${waterPlusHtml(st)}</span>
              <span class="water-card__goal">${st.reached ? `${icon('checkmark', 12)}Objectif atteint` : st.goal.src === 'plan' ? 'Objectif du plan' : st.goal.src === 'me' ? 'Objectif choisi' : 'Objectif conseillé'}</span>
            </span>
            ${icon('chevron.right', 16)}
          </button>
          ${waterBarHtml(st.ratio, waterZoneFrom(st))}
          ${waterGlassesHtml(st, attrDay)}
          <div class="water-card__btns">
            ${waterCups(data).map(c => waterAddBtnHtml(c, attrDay)).join('')}
            <button class="water-add water-add--other" data-action="water-other"${attrDay ? ` data-day="${esc(attrDay)}"` : ''}>Autre</button>
          </div>
          <button class="water-card__log" data-action="water-log"${attrDay ? ` data-day="${esc(attrDay)}"` : ''}>
            <span>${n ? plural(n, 'ajout', 'ajouts') : 'Rien de noté'} · Historique</span>${icon('chevron.right', 14)}</button>
        </section>`;
}
// Suivi pas encore activé : une ligne, en bas de Nutrition
function waterInviteHtml() {
  return `<div class="group group--gap"><button class="cell cell--nav" data-action="water-on">
      <span class="cell__body"><span class="cell__title">Suivre l'eau</span><span class="cell__sub">Un objectif en litres, un toucher par verre</span></span>${icon('chevron.right', 16)}</button></div>`;
}
// Bloc Eau de l'écran Nutrition : la carte, ou l'invitation
function waterNutritionHtml(day, opts) { return waterShown() ? waterCardHtml(day, opts) : waterInviteHtml(); }

// ── Accueil ─────────────────────────────────────────────────

// Ligne « Eau 1,2 / 2,8 L » et « + Verre » : sous les repas de la carte Nutrition, ou seule dans sa petite carte
function waterHomeRowHtml() {
  if (!waterShown()) return '';
  const st = waterState(), glass = WATER_CUPS_BASE[0];
  return `
      <div class="water-home">
        <button class="water-home__open" data-action="go-nutrition" aria-label="${esc(`Eau : ${waterValSpoken(st)}${st.reached ? ', objectif atteint' : ''}. Ouvrir Nutrition`)}">
          <span class="water-home__line" aria-hidden="true"><span class="water-home__label">Eau</span><span class="water-home__val num"><b>${waterLitres(st.ml)}</b> / ${waterGoalText(st.goal)}</span></span>
          ${waterBarHtml(st.ratio, waterZoneFrom(st))}
        </button>
        ${waterAddBtnHtml(glass, '', ' water-add--home')}
      </div>`;
}
// Sans carte Nutrition (pas de plan suivi) mais l'eau suivie : une petite carte, la même ligne
function waterHomeCard() {
  const row = waterHomeRowHtml();
  return row ? `<section class="home-card water-home-card">${row}</section>` : '';
}

// ── Feuilles ────────────────────────────────────────────────

// Objectif : − / + par 0,25 L, « Revenir au repère conseillé » ; fixé par le plan : lecture seule
async function waterGoalSheet() {
  const st = waterState(), g = st.goal, sex = waterSex();
  // La feuille règle la base (sans le bonus de séance) ; le total du jour est dit dessous
  const bonus = waterTrainBonusOn(data), plusToday = st.training && bonus ? WATER_TRAIN_L : 0;
  const auto = { ...waterAutoGoal({ sex, training: false }), src: 'auto' };
  const todayText = v => (plusToday ? `Aujourd'hui : ${fmtNum(v + plusToday, 2)}\u00a0L (dont +0,5\u00a0L séance)` : '');
  if (g.src === 'plan') {
    await sheet({ title: 'Objectif d\'eau', cancel: '', confirm: 'OK', body: `<div class="water-gs">
        <p class="water-gs__val num">${waterGoalText(g)}</p><p class="water-gs__why">${esc(waterGoalWhy(g))}</p></div>` });
    return;
  }
  let l = g.base;
  const body = `<div class="water-gs">
      <div class="water-gs__step">
        <button type="button" class="water-gs__btn" data-wstep="-1" aria-label="Moins 0,25 litre">${icon('minus', 22)}</button>
        <p class="water-gs__val num" id="waterGsVal" aria-live="polite">${fmtNum(l, 2)}\u00a0L</p>
        <button type="button" class="water-gs__btn" data-wstep="1" aria-label="Plus 0,25 litre">${icon('plus', 22)}</button>
      </div>
      <p class="water-gs__today num" id="waterGsToday">${esc(todayText(l))}</p>
      <p class="water-gs__why" id="waterGsWhy">${esc(waterGoalWhy(g, { sex, bonus }))}</p>
      <button type="button" class="water-gs__link" data-wauto ${g.src === 'auto' ? 'hidden' : ''}>Revenir au repère conseillé (${fmtNum(auto.base, 2)}\u00a0L)</button>
      <p class="water-gs__src">Repères : EFSA (2010), apport en eau des adultes ; ACSM (2007), pertes par la sueur à l'effort. Des repères, pas un avis médical.</p>
    </div>`;
  let mode = g.src;   // 'auto' ou 'me'
  const p = sheet({ title: 'Objectif d\'eau', confirm: 'OK', body, onConfirm: () => ({ l, mode }) });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  if (root) {
    const paint = () => {
      $('#waterGsVal', root).textContent = `${fmtNum(l, 2)}\u00a0L`;
      $('#waterGsToday', root).textContent = todayText(l);
      $('#waterGsWhy', root).textContent = waterGoalWhy({ src: mode }, { sex, bonus });
      $('[data-wauto]', root).hidden = mode === 'auto';
    };
    root.addEventListener('click', ev => {
      const step = ev.target.closest('[data-wstep]');
      if (step) { l = waterStepGoal(l, Number(step.dataset.wstep)); mode = 'me'; haptic('light'); paint(); return; }
      if (ev.target.closest('[data-wauto]')) { l = auto.base; mode = 'auto'; haptic('light'); paint(); }
    });
  }
  const r = await p;
  if (!r) return;
  if (r.mode === 'auto') delete data.waterGoalL; else data.waterGoalL = cleanWaterLitres(r.l);
  save(); render();
  announce(`Objectif d'eau : ${fmtNum(waterState().goal.l, 2)} litres`);
}

// Historique : les ajouts du jour (heure, quantité, Supprimer) et les 7 derniers jours
function waterLogBodyHtml(day) {
  const list = waterDay(data, day);
  const time = at => (at ? new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
  const rows = list.length ? list.slice().reverse().map(e => `
        <div class="water-log__row">
          <span class="water-log__txt num">${time(e.at) ? `${time(e.at)} · ` : ''}${waterQtyText(e.ml)}</span>
          <button type="button" class="water-log__del" data-wdel="${esc(e.id)}" aria-label="${esc(`Supprimer ${waterQtySpoken(e.ml)}${time(e.at) ? ` de ${time(e.at)}` : ''}`)}">Supprimer</button>
        </div>`).join('') : '<p class="water-log__empty">Rien de noté ce jour-là.</p>';
  // Le jour affiché et les 6 d'avant, du plus récent au plus ancien (midi : jamais deux fois le même jour au changement d'heure)
  const days = Array.from({ length: 7 }, (_, i) => localISO(Date.parse(day + 'T12:00:00') - i * 86400000));
  const week = days.map(k => {
    const st = waterState(k);
    return `<div class="water-log__day${k === day ? ' water-log__day--on' : ''}">
          <span class="water-log__dname">${esc(dietDayTitle(k))}</span>
          <span class="water-log__dval num">${waterValText(st, '/')}</span>
          ${waterBarHtml(st.ratio, waterZoneFrom(st))}
        </div>`;
  }).join('');
  return `<div class="water-log">
      <h3 class="water-log__title">${esc(dietDayTitle(day))}</h3>
      <div class="water-log__list">${rows}</div>
      <h3 class="water-log__title">7 derniers jours</h3>
      <div class="water-log__week">${week}</div>
      <p class="water-log__note">Ce que tu bois reste sur cet iPhone et dans tes exports.</p>
    </div>`;
}
async function waterLogSheet(day) {
  const p = sheet({ title: 'Eau', cancel: '', confirm: 'OK', body: waterLogBodyHtml(day) });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  root?.addEventListener('click', ev => {
    const del = ev.target.closest('[data-wdel]');
    if (!del) return;
    const e = waterDay(data, day).find(x => x.id === del.dataset.wdel);
    if (!e || !waterRemove(data, day, e.id)) return;
    save(); haptic('light');
    $('.sheet__body', root).innerHTML = waterLogBodyHtml(day);
    announce(`Supprimé : ${waterQtySpoken(e.ml)}`);
  });
  await p;
  render();
}

// Ajout : tout de suite, retour haptique, toast avec Annuler
function waterAddNow(ml, day) {
  const before = waterState(day);
  const e = waterAdd(data, ml, day);
  if (!e) { showToast('Impossible d\'ajouter : 60 ajouts au plus par jour', { error: true }); return; }
  save();
  const st = waterState(day), reached = st.reached && !before.reached;
  haptic(reached ? 'success' : 'light');
  render();
  showToast(`+ ${waterQtyText(ml)} · ${waterValText(st)}`, { action: 'Annuler', duration: 5000, onAction: () => {
    if (waterRemove(data, day, e.id)) { save(); render(); announce(`Annulé. Eau : ${waterValSpoken(waterState(day))}`); }
  } });
  if (reached) announce('Objectif d\'eau atteint');
}

// ── Réglages de la nutrition : groupe Eau et contenants ─────

function waterSettingsGroupHtml() {
  const on = data.waterOn === true, mine = cleanWaterCups(data.waterCups);
  return `
        <div class="group-title">Eau</div>
        <div class="group">
          <button class="cell" data-action="water-toggle" role="switch" aria-checked="${on}">
            <span class="cell__body"><span class="cell__title">Suivre l'eau</span><span class="cell__sub">Un objectif en litres, un toucher par verre</span></span>
            ${switchHtml(on)}
          </button>
          <button class="cell" data-action="water-train-toggle" role="switch" aria-checked="${waterTrainBonusOn(data)}">
            <span class="cell__body"><span class="cell__title">+0,5 L les jours de séance</span><span class="cell__sub">Sur ton objectif ; celui fixé par ton coach ne change pas</span></span>
            ${switchHtml(waterTrainBonusOn(data))}
          </button>
          <button class="cell cell--nav" data-action="go-water-cups">
            <span class="cell__body"><span class="cell__title">Contenants</span><span class="cell__sub">Verre, bouteille, 1 L${mine.length ? ` et ${plural(mine.length, 'perso', 'perso')}` : ''}</span></span>${icon('chevron.right', 16)}</button>
        </div>
        <div class="group-foot">Ce que tu bois reste sur cet iPhone et dans tes exports : ni copie iCloud, ni serveur, ni coach.</div>`;
}

function renderWaterCups() {
  const mine = cleanWaterCups(data.waterCups), full = mine.length >= WATER_CUPS_MAX;
  const cell = c => `<div class="cell"><span class="cell__body"><span class="cell__title">${esc(c.name)}</span></span><span class="cell__value num">${waterQtyText(c.ml)}</span></div>`;
  return `
    <div class="view view--grouped water-cups-view">
      ${navBar({ title: 'Contenants', large: true })}
      <div class="scr">
        <div class="group-title">Proposés</div>
        <div class="group">${WATER_CUPS_BASE.map(cell).join('')}</div>
        <div class="group-title">Les miens</div>
        <div class="group">
          ${mine.map(c => `<button class="cell cell--nav" data-action="water-cup-menu" data-id="${esc(c.id)}">
            <span class="cell__body"><span class="cell__title">${esc(c.name)}</span></span><span class="cell__value num">${waterQtyText(c.ml)}</span>${icon('ellipsis', 18)}</button>`).join('')}
          ${full ? '' : `<button class="cell cell--nav water-cups__add" data-action="water-cup-add">${icon('plus', 18)}<span class="cell__body"><span class="cell__title">Ajouter un contenant</span></span></button>`}
        </div>
        <div class="group-foot">${full ? `${WATER_CUPS_MAX} contenants perso au plus.` : 'Exemple : Ma gourde, 75 cl. Il s\'ajoute aux boutons de la carte Eau.'}</div>
      </div>
    </div>`;
}
SCREENS.set('water-cups', { render: () => renderWaterCups() });

async function waterCupSheet() {
  const body = `<div class="diet-form">
      <div class="diet-fields">
        <label class="diet-field"><span class="diet-field__label">Nom</span>
          <input id="waterCupName" class="diet-field__input" type="text" autocomplete="off" autocapitalize="sentences" maxlength="${WATER_CUP_NAME_MAX}" placeholder="Ma gourde" aria-label="Nom du contenant"></label>
        <label class="diet-field"><span class="diet-field__label">Quantité</span>
          <input id="waterCupMl" class="diet-field__input num" type="text" inputmode="decimal" autocomplete="off" placeholder="75" aria-label="Quantité, en centilitres">
          <span class="diet-field__unit" aria-hidden="true">cl</span></label>
      </div>
      <p class="diet-form__err" id="waterCupErr" role="alert"></p>
    </div>`;
  return sheet({ title: 'Nouveau contenant', confirm: 'Ajouter', body, focus: '#waterCupName', onConfirm: panel => {
    const name = $('#waterCupName', panel).value, ml = waterParseQty($('#waterCupMl', panel).value);
    const r = ml === null ? { ok: false, error: 'ml' } : waterAddCup(data, name, ml);
    if (r.ok) return true;
    const msg = { name: 'Donne-lui un nom.', ml: 'Quantité : de 5 cl à 3 L.', taken: 'Un contenant porte déjà ce nom.', full: `${WATER_CUPS_MAX} contenants perso au plus.` }[r.error];
    $('#waterCupErr', panel).textContent = msg;
    $(r.error === 'ml' ? '#waterCupMl' : '#waterCupName', panel).focus();
    return false;
  } });
}

registerActions({
  'water-add': (e, el) => {
    const ml = Number(el.dataset.ml);
    if (!Number.isFinite(ml)) return;
    waterAddNow(ml, el.dataset.day || localISO());
  },
  // Verre à cocher : vide → un verre de plus ; dernier plein → retire le dernier ajout de cette taille (Annuler)
  'water-glass': (e, el) => {
    const ml = Number(el.dataset.ml), day = el.dataset.day || localISO();
    if (!Number.isFinite(ml)) return;
    if (el.dataset.op === 'add') { waterAddNow(ml, day); return; }
    if (el.dataset.op !== 'del') return;
    const list = waterDay(data, day), last = [...list].reverse().find(x => x.ml === ml) || list[list.length - 1];
    if (!last || !waterRemove(data, day, last.id)) return;
    save(); haptic('light'); render();
    showToast(`Retiré : ${waterQtyText(last.ml)} · ${waterValText(waterState(day))}`, { action: 'Annuler', duration: 5000, onAction: () => {
      waterAdd(data, last.ml, day, last.at || Date.now()); save(); render();
    } });
  },
  'water-other': async (e, el) => {
    const day = el.dataset.day || localISO();
    const raw = await dialog({ title: 'Quantité bue', message: 'En centilitres, par exemple 33 pour une canette.',
      input: { decimal: true, value: '', placeholder: '33', unit: 'cl', label: 'Quantité bue, en centilitres' },
      actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Ajouter', style: 'preferred' }] });
    if (raw == null || !String(raw).trim()) return;
    const ml = waterParseQty(raw);
    if (ml === null) { showToast('Quantité : de 1 cl à 3 L', { error: true }); return; }
    waterAddNow(ml, day);
  },
  'water-goal': () => waterGoalSheet(),
  'water-log': (e, el) => waterLogSheet(el.dataset.day || localISO()),
  'water-on': () => { data.waterOn = true; save(); haptic(); render(); announce('Suivi de l\'eau activé'); },
  'water-toggle': () => {
    if (data.waterOn) delete data.waterOn; else data.waterOn = true;
    save(); haptic(); render();
  },
  'water-train-toggle': () => {
    if (data.waterTrainOff) delete data.waterTrainOff; else data.waterTrainOff = true;
    save(); haptic(); render();
  },
  'go-water-cups': () => navigate('water-cups'),
  'water-cup-add': async () => {
    if (await waterCupSheet()) { save(); haptic(); render(); announce('Contenant ajouté'); }
  },
  'water-cup-menu': async (e, el) => {
    const c = cleanWaterCups(data.waterCups).find(x => x.id === el.dataset.id);
    if (!c) return;
    const v = await dialog({ type: 'sheet', title: `${c.name}, ${waterQtyText(c.ml)}`,
      actions: [{ label: 'Supprimer le contenant', value: 'del', style: 'destructive' }, { label: 'Annuler', style: 'cancel' }] });
    if (v !== 'del') return;
    const gone = waterRemoveCup(data, c.id);
    if (!gone) return;
    save(); haptic('light'); render();
    showToast(`Supprimé : ${c.name}`, { action: 'Annuler', duration: 5000, onAction: () => {
      const mine = cleanWaterCups(data.waterCups);
      mine.splice(Math.min(gone.index, mine.length), 0, gone.cup);
      data.waterCups = cleanWaterCups(mine);
      save(); render(); announce(`Remis : ${c.name}`);
    } });
  },
});
