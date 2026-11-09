// ═══════════════════════════════════════════════════════════
//  Plans diète : liste et éditeur (Nutrition V1, docs/NUTRITION_V1.md)
//
//  - Programme › Plans diète (diet-plans) : mes plans et ceux reçus d'un coach, le plan suivi d'abord,
//    « Créer un plan ». Un coach y prépare aussi les plans de ses élèves (envoi depuis la fiche de l'élève).
//  - Un plan (diet-plan:ID) : suivre ce plan, total prévu, objectifs du jour (fixés par la personne,
//    jamais calculés par l'app), repas et leurs aliments. Ajouter un aliment : recherche dans la base Ciqual
//    ou dans mes aliments perso, puis la quantité en grammes ; les macros se calculent seules.
//  - Plan reçu d'un coach : lecture seule (le coach le modifie et le renvoie) ; le remplacement d'un
//    aliment pour la journée reste possible dans Nutrition.
// ═══════════════════════════════════════════════════════════
'use strict';

const dietPlanOf = id => { const p = data.dietPlans?.[id]; return p && !p.archived ? p : null; };
const dietMealOf = (plan, mealId) => plan?.meals.find(m => m.id === mealId) || null;

function renderDietPlans() {
  const ids = dietPlanIds(data);
  const row = id => {
    const p = data.dietPlans[id], t = dietPlanMacros(p), on = data.dietActive === id;
    const sub = [plural(p.meals.length, 'repas', 'repas'), `${dietN(t.kcal)} kcal`, p.fromCoach ? elide('de', p.fromCoach.name || 'ton coach') : ''].filter(Boolean).join(' · ');
    return `<button class="cell cell--nav" data-action="diet-open-plan" data-id="${esc(id)}" aria-label="${esc(p.name)}, ${esc(sub)}${on ? ', en cours' : ''}">
        <span class="cell__body"><span class="cell__title">${esc(p.name)}</span><span class="cell__sub num">${esc(sub)}</span></span>
        ${on ? '<span class="cell__value diet-on">En cours</span>' : ''}
        ${icon('chevron.right', 16)}
      </button>`;
  };
  const isCoach = coachRole().isCoach;
  return `
    <div class="view view--grouped diet-plans-view">
      ${navBar({ title: 'Plans diète' })}
      <div class="scr">
        <div class="group">
          ${ids.map(row).join('')}
          <button class="cell cell--action" data-action="diet-new-plan">${icon('plus', 20)}<span>Créer un plan</span></button>
        </div>
        ${dietSettingsCellHtml()}
        <div class="group-foot">${isCoach ? 'Prépare ici les plans de tes élèves, puis envoie-les depuis leur fiche (Coach › Élèves). ' : ''}Le plan en cours s'affiche chaque jour dans Entraînement › Nutrition : tu coches tes repas comme tes séances.</div>
      </div>
    </div>`;
}

function dietTargetsText(plan) {
  const t = plan.targets;
  if (!t) return 'Selon le plan';
  return [t.kcal ? `${dietN(t.kcal)} kcal` : '', ...DIET_MACROS.map(m => (t[m.k] ? `${m.short}\u00a0${t[m.k]}` : ''))].filter(Boolean).join(' · ');
}
// Les mêmes objectifs dits par VoiceOver : « 2 000 kilocalories, 150 grammes de protéines »
function dietTargetsSpoken(plan) {
  const t = plan.targets;
  if (!t) return 'Selon le plan';
  return [t.kcal ? `${dietN(t.kcal)} kilocalories` : '', ...DIET_MACROS.map(m => (t[m.k] ? `${t[m.k]} grammes de ${m.label.toLowerCase()}` : ''))].filter(Boolean).join(', ');
}
function dietTargetsHtml(plan) { return dietSrPair(esc(dietTargetsText(plan)), esc(dietTargetsSpoken(plan))); }

function dietPlanItemCell(plan, meal, it, ro) {
  const m = dietItemMacros(it);
  const inner = `<span class="cell__body"><span class="cell__title">${esc(it.name)}</span>
      <span class="cell__sub num">${dietSrPair(`${it.g} g · ${dietN(m.kcal)} kcal${it.ecalc ? ' (calculées)' : ''} · P ${dietN(m.p)} · G ${dietN(m.c)} · L ${dietN(m.f)}`,
        `${it.g} grammes, ${dietN(m.kcal)} kilocalories${it.ecalc ? ' calculées' : ''}, ${dietMacroGramsSpoken(m)}`)}</span></span>`;
  return ro ? `<div class="cell">${inner}</div>`
    : `<button class="cell cell--nav" data-action="diet-item-menu" data-meal="${esc(meal.id)}" data-item="${esc(it.id)}">${inner}${icon('chevron.right', 16)}</button>`;
}

function renderDietPlan(id) {
  const plan = dietPlanOf(id);
  // Grand titre : le nom du plan entier, même long (iPhone SE) ; la barre compacte, qui le coupe, vient au défilement
  if (!plan) return `<div class="view view--grouped diet-plan-view">${navBar({ title: 'Plan diète' })}<div class="scr"><div class="empty-note">Ce plan n'existe plus.</div></div></div>`;
  const ro = !!plan.fromCoach, on = data.dietActive === id, total = dietPlanMacros(plan);
  const right = ro ? '' : `<button class="navbar__text" data-action="diet-rename" data-id="${esc(id)}">Renommer</button>`;
  const meals = plan.meals.map(meal => `
        <div class="group-title group-title--row diet-meal-title">
          <span>${esc(meal.name)}</span>
          ${ro ? '' : `<button class="group-title__btn diet-meal-edit" data-action="diet-meal-menu" data-meal="${esc(meal.id)}" aria-label="Modifier le repas ${esc(meal.name)}">Modifier</button>`}
        </div>
        <div class="group">
          ${meal.items.map(it => dietPlanItemCell(plan, meal, it, ro)).join('')}
          ${ro ? (meal.items.length ? '' : '<div class="cell"><span class="cell__sub">Aucun aliment</span></div>')
            : `<button class="cell cell--action" data-action="diet-add-food" data-meal="${esc(meal.id)}">${icon('plus', 20)}<span>Ajouter un aliment</span></button>`}
        </div>
        <div class="group-foot num">${meal.note ? `${esc(meal.note)} · ` : ''}${dietSrPair(dietMacroLine(dietMealMacros(meal)), dietMacroSpoken(dietMealMacros(meal)))}</div>`).join('');
  return `
    <div class="view view--grouped diet-plan-view">
      ${navBar({ title: esc(plan.name), right, large: true })}
      <div class="scr">
        <div class="group">
          ${on ? `<div class="cell"><span class="cell__body"><span class="cell__title">Plan en cours</span><span class="cell__sub">Il s'affiche chaque jour dans Entraînement › Nutrition</span></span><span class="diet-on-mark" aria-hidden="true">${icon('checkmark', 18)}</span></div>`
            : `<button class="cell cell--action" data-action="diet-follow" data-id="${esc(id)}">${icon('checkmark', 20)}<span>Utiliser ce plan</span></button>`}
        </div>
        ${plan.consigne ? `<p class="coach-prog__consigne diet-consigne">${icon('info.circle', 14)}<span>${esc(plan.consigne)}</span></p>` : ''}
        <div class="group-title">Par jour</div>
        <div class="group">
          <div class="cell"><span class="cell__body"><span class="cell__title">Total prévu</span><span class="cell__sub num">${dietSrPair(`P\u00a0${dietN(total.p)}\u00a0g · G\u00a0${dietN(total.c)}\u00a0g · L\u00a0${dietN(total.f)}\u00a0g`, dietMacroGramsSpoken(total))}</span></span><span class="cell__value num">${dietN(total.kcal)} kcal</span></div>
          ${ro ? `<div class="cell"><span class="cell__body"><span class="cell__title">Objectifs du jour</span><span class="cell__sub num">${dietTargetsHtml(plan)}</span></span></div>`
            : `<button class="cell cell--nav" data-action="diet-targets" data-id="${esc(id)}"><span class="cell__body"><span class="cell__title">Objectifs du jour</span><span class="cell__sub num">${dietTargetsHtml(plan)}</span></span>${icon('chevron.right', 16)}</button>`}
        </div>
        ${dietTargetGap(plan) ? `<p class="diet-gap" role="note">${icon('info.circle', 14)}<span>${esc(dietTargetGap(plan))}</span></p>` : ''}
        <div class="group-foot">${ro ? `Plan envoyé par ${esc(plan.fromCoach.name || 'ton coach')} : il le modifie et te le renvoie. Dans Nutrition, tu peux remplacer un aliment pour la journée.`
          : 'Les objectifs, c\'est toi (ou ton coach) qui les fixes : l\'app ne calcule pas tes besoins. Sans objectif, le total prévu sert de repère.'}</div>
        ${dietLowKcal(plan) ? dietLowNoteHtml(!!plan.targets?.kcal) : ''}
        ${meals}
        ${ro || plan.meals.length >= DIET_MEAL_MAX ? '' : `<div class="group group--gap"><button class="cell cell--action" data-action="diet-add-meal" data-id="${esc(id)}">${icon('plus', 20)}<span>Ajouter un repas</span></button></div>`}
        <div class="group group--gap">
          ${!ro && coachRole().isCoach ? `<button class="cell cell--action" data-action="diet-send-student" data-id="${esc(id)}">${icon('paperplane', 20)}<span>Envoyer à un élève</span></button>` : ''}
          <button class="cell cell--action" data-action="diet-duplicate" data-id="${esc(id)}">${icon('doc.on.doc', 20)}<span>${ro ? 'Dupliquer pour le modifier' : 'Dupliquer le plan'}</span></button>
        </div>
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="diet-delete" data-id="${esc(id)}">Supprimer le plan</button>
        </div>
        ${dietSourceFoot()}
      </div>
    </div>`;
}
SCREENS.set('diet-plans', { render: () => renderDietPlans(), enter: () => { dietMaybeAskConsent(); } });
SCREENS.set('diet-plan', { render: id => renderDietPlan(id), enter: () => { loadFoods(); } });

// Plan affiché par l'éditeur (route diet-plan:ID), modifiable seulement s'il est à moi
function dietEditedPlan() {
  const [name, id] = [routeName(currentRoute()), routeParams(currentRoute())[0]];
  const plan = name === 'diet-plan' ? dietPlanOf(id) : null;
  return plan && !plan.fromCoach ? { id, plan } : null;
}
function dietSaved() { const e = dietEditedPlan(); if (e) dietTouch(e.plan); save(); render(); }

// ── Feuille de recherche d'un aliment ───────────────────────

function dietFoodResultsHtml(q) {
  if (!foodDb && !(data.dietFoods || []).length) return '<p class="diet-pick__note">Base d\'aliments indisponible pour l\'instant. Tu peux créer ton aliment.</p>';
  if (!q.trim()) return `<p class="diet-pick__note">Tape un aliment : « riz », « poulet », « skyr »… ${foodDb ? `${dietN(foodDb.foods.length)} aliments de la table Ciqual.` : ''}</p>`;
  const res = searchFoods(q, { own: data.dietFoods || [] });
  if (!res.length) return `<p class="diet-pick__note">Rien pour « ${esc(q)} ». Crée ton aliment avec ses valeurs pour 100 g.</p>`;
  return res.map((x, i) => `
        <button class="diet-cand" data-pick="${i}">
          <span class="diet-cand__body"><span class="diet-cand__name">${esc(x.food.name)}</span>
            <span class="diet-cand__sub num">${x.own ? 'Mon aliment · ' : ''}${dietSrPair(`100 g · ${x.food.per.k} kcal${x.food.ecalc ? ' (calculées)' : ''} · P ${fmtNum(x.food.per.p)} · G ${fmtNum(x.food.per.c)} · L ${fmtNum(x.food.per.f)}`,
              `pour 100 grammes, ${x.food.per.k} kilocalories${x.food.ecalc ? ' calculées' : ''}, ${dietMacroWords(x.food.per, fmtNum).replace(/ g /g, ' grammes ')}`)}</span></span>
        </button>`).join('');
}
// Renvoie l'aliment choisi ({ food } de searchFoods), 'new' (créer un aliment), 'scan' (code-barres) ou null
async function dietPickFood() {
  await loadFoods();
  let results = [];
  const body = `
    <div class="diet-pick">
      ${foodScanButtonHtml()}
      <input type="search" id="dietFoodSearch" class="search" placeholder="Rechercher un aliment" autocomplete="off" enterkeyhint="search" aria-label="Rechercher un aliment">
      <div class="diet-pick__list" id="dietFoodList">${dietFoodResultsHtml('')}</div>
      <button class="diet-cand diet-cand--new" data-pick="new">${icon('plus', 18)}<span class="diet-cand__name">Créer un aliment</span></button>
    </div>`;
  const p = sheet({ title: 'Ajouter un aliment', cancel: 'Annuler', confirm: '', body, focus: '#dietFoodSearch' });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  root?.addEventListener('input', ev => {
    if (ev.target.id !== 'dietFoodSearch') return;
    results = searchFoods(ev.target.value, { own: data.dietFoods || [] });
    $('#dietFoodList', root).innerHTML = dietFoodResultsHtml(ev.target.value);
  });
  root?.addEventListener('click', ev => {
    const b = ev.target.closest('[data-pick]');
    if (!b) return;
    const k = b.dataset.pick;
    root._close(k === 'new' || k === 'scan' ? k : results[Number(k)] || null);
  });
  return p;
}

// Choix d'un aliment (recherche, code-barres ou création) puis de sa quantité : { food, g } ou null.
// Sert au plan ; réutilisable partout où l'on ajoute un aliment
async function dietChooseFood() {
  const pick = await dietPickFood();
  if (pick === 'scan') return foodScanFlow();
  const chosen = pick === 'new' ? await dietNewFood() : pick;
  if (!chosen?.food) return null;
  const g = await dietAskGrams(chosen.food);
  return g == null ? null : { food: chosen.food, g };
}

// Aliment perso : nom et valeurs pour 100 g (étiquette du paquet) ; gardé dans mes aliments.
// code : code-barres introuvable sur Open Food Facts, gardé pour retrouver l'aliment au prochain scan
async function dietNewFood(name = '', { code = null } = {}) {
  const field = (id, label, unit, max) => `
      <label class="diet-field"><span class="diet-field__label">${label}</span>
        <input id="${id}" class="diet-field__input num" type="text" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="${label}, pour 100 grammes, ${max} au plus">
        <span class="diet-field__unit">${unit}</span></label>`;
  const codeHint = code ? '<p class="diet-form__hint num">Code-barres ' + dietSrPair(barcodeShown(code), barcodeSpoken(code)) + ' : l\'aliment sera retrouvé à ton prochain scan.</p>' : '';
  const body = `
    <div class="diet-form">
      <label class="diet-field diet-field--name"><span class="diet-field__label">Nom</span>
        <input id="dietFoodName" class="diet-field__input" type="text" maxlength="${DIET_FOOD_NAME_MAX}" autocomplete="off" autocapitalize="sentences" value="${esc(name)}" placeholder="Skyr nature"></label>
      ${codeHint}
      <p class="diet-form__hint">Pour 100 g : recopie les valeurs de l'étiquette, l'énergie comprise. Laissée vide, l'app la calcule (4 kcal par gramme de protéines ou de glucides, 9 de lipides).</p>
      ${field('dietFoodK', 'Énergie', 'kcal', 900)}${field('dietFoodP', 'Protéines', 'g', 100)}${field('dietFoodC', 'Glucides', 'g', 100)}${field('dietFoodF', 'Lipides', 'g', 100)}
      <label class="diet-field"><span class="diet-field__label">Famille</span>
        <select id="dietFoodFam" class="diet-field__input diet-field__select" aria-label="Famille, pour les équivalences">
          <option value="">Selon ses macros</option>
          ${DIET_FAMS.filter(f => f !== 'a').map(f => `<option value="${f}">${esc(FOOD_FAM_LABEL[f])}</option>`).join('')}
        </select></label>
      <p class="diet-form__hint">La famille sert aux équivalences : un aliment n'est remplacé que par un autre de la même famille.</p>
      <p class="diet-form__hint">L'énergie de l'étiquette compte aussi les fibres (2 kcal par gramme) et l'alcool (7 kcal par gramme) : elle peut dépasser ce calcul.</p>
      <p class="diet-form__err" id="dietFoodErr" role="alert"></p>
    </div>`;
  return sheet({ title: 'Nouvel aliment', confirm: 'OK', body, focus: '#dietFoodName', onConfirm: panel => {
    const v = id => $(id, panel).value;
    const nm = dietCutName(v('#dietFoodName'));
    const k0 = num(v('#dietFoodK'), 0, 900), p = num(v('#dietFoodP') || '0', 0, 100), c = num(v('#dietFoodC') || '0', 0, 100), f = num(v('#dietFoodF') || '0', 0, 100);
    const err = msg => { $('#dietFoodErr', panel).textContent = msg; return false; };
    if (!nm) return err('Donne un nom à cet aliment.');
    if (p === null || c === null || f === null) return err('Protéines, glucides et lipides : de 0 à 100 g.');
    // Énergie vide : calculée comme sur une étiquette (4, 4 et 9 kcal par gramme)
    const k = k0 ?? (v('#dietFoodK').trim() ? null : Math.round(4 * p + 4 * c + 9 * f));
    if (k === null) return err('Énergie : de 0 à 900 kcal.');
    const per = cleanDietPer({ k, p, c, f });
    if (!per) return err('Plus de 100 g de macros pour 100 g : vérifie les valeurs.');
    const famPick = $('#dietFoodFam', panel)?.value;
    const food = { id: uid(), name: nm, fam: DIET_FAMS.includes(famPick) ? famPick : dietFamOf(per), per, ...(code ? { code } : {}) };
    data.dietFoods = cleanDietFoods([food, ...(data.dietFoods || []).filter(x => normName(x.name) !== normName(nm) && !(code && x.code === code))]);
    return { food: dietOwnPick(food) };
  } });
}

async function dietAskGrams(food, value = 100) {
  return askNumber({ title: food.name.length > 60 ? `${food.name.slice(0, 58)}…` : food.name,
    message: `Quantité en grammes. Pour 100 g : ${food.per.k} kcal.`,   // macros déjà dans la liste : l'alerte reste courte en texte agrandi
    value: String(value), unit: 'g', min: 1, max: DIET_G_MAX });
}

// ── Objectifs du jour ───────────────────────────────────────

async function dietTargetsSheet(plan) {
  const t = plan.targets || {}, total = dietPlanMacros(plan);
  const row = (k, label, unit) => `
      <label class="diet-field"><span class="diet-field__label">${label}</span>
        <input id="dietT_${k}" class="diet-field__input num" type="text" inputmode="numeric" autocomplete="off" value="${t[k] ?? ''}" placeholder="${dietN(total[k])}" aria-label="${label} par jour, vide : selon le plan">
        <span class="diet-field__unit">${unit}</span></label>`;
  const body = `
    <div class="diet-form">
      ${row('kcal', 'Énergie', 'kcal')}${row('p', 'Protéines', 'g')}${row('c', 'Glucides', 'g')}${row('f', 'Lipides', 'g')}
      <p class="diet-form__hint">Laisse vide pour suivre le total prévu par le plan (en gris). Ces repères sont les tiens ou ceux de ton coach : l'app ne calcule pas tes besoins.</p>
      <p class="diet-form__err" id="dietTErr" role="alert"></p>
    </div>`;
  return sheet({ title: 'Objectifs du jour', confirm: 'OK', body, onConfirm: panel => {
    const out = {};
    for (const k of DIET_TARGET_KEYS) {
      const raw = $(`#dietT_${k}`, panel).value.trim();
      if (!raw) continue;
      const v = num(raw, 1, DIET_TARGET_MAX[k]);
      if (v === null) { $('#dietTErr', panel).textContent = `Valeur entre 1 et ${DIET_TARGET_MAX[k]}.`; return false; }
      out[k] = Math.round(v);
    }
    return { targets: cleanDietTargets(out) };
  } });
}

// ── Actions ─────────────────────────────────────────────────

registerActions({
  'go-diet-plans': () => navigate('diet-plans'),
  'diet-open-plan': (e, el) => navigate(makeRoute('diet-plan', el.dataset.id)),
  'diet-new-plan': async () => {
    // Limite : jamais un plan retiré en silence ; on le dit avant de créer
    if (!dietCanCreate(data, coachRole().isCoach)) {
      showToast(`${coachRole().isCoach ? DIET_PLAN_MAX_COACH : DIET_PLAN_MAX} plans au plus : supprimes-en un d'abord`, { error: true });
      return;
    }
    const name = await askText({ title: 'Nouveau plan', message: 'Quatre repas sont prêts à remplir ; tu pourras les renommer.', placeholder: 'Mon plan', confirm: 'Créer' });
    if (!name) return;
    // Premier plan : suivi d'office, sauf pour un coach (js/data/nutrition.js, dietNewPlan)
    const id = dietNewPlan(data, name, { isCoach: coachRole().isCoach });
    save();
    haptic();
    navigate(makeRoute('diet-plan', id));
    // Avec un compte : l'accord pour copier les plans, demandé une fois (js/features/diet-settings.js)
    dietMaybeAskConsent();
  },
  'diet-follow': (e, el) => {
    const plan = dietPlanOf(el.dataset.id);
    if (!plan) return;
    data.dietActive = el.dataset.id;
    save(); haptic(); render();
    showToast(`Plan en cours : ${plan.name}`);
  },
  'diet-rename': async (e, el) => {
    const plan = dietPlanOf(el.dataset.id);
    if (!plan || plan.fromCoach) return;
    const name = await askText({ title: 'Nom du plan', value: plan.name, confirm: 'OK' });
    if (!name) return;
    plan.name = dietText(name, DIET_NAME_MAX);
    dietSaved();
  },
  'diet-targets': async (e, el) => {
    const plan = dietPlanOf(el.dataset.id);
    if (!plan || plan.fromCoach) return;
    const r = await dietTargetsSheet(plan);
    if (!r) return;
    if (r.targets) plan.targets = r.targets; else delete plan.targets;
    dietSaved();
  },
  'diet-add-meal': async () => {
    const ed = dietEditedPlan();
    if (!ed || ed.plan.meals.length >= DIET_MEAL_MAX) return;
    const name = await askText({ title: 'Nouveau repas', placeholder: 'Collation', confirm: 'Ajouter' });
    if (!name) return;
    ed.plan.meals.push({ id: uid(), name: dietText(name, DIET_NAME_MAX), items: [] });
    dietSaved();
  },
  'diet-meal-menu': async (e, el) => {
    const ed = dietEditedPlan(), meal = dietMealOf(ed?.plan, el.dataset.meal);
    if (!meal) return;
    const i = ed.plan.meals.indexOf(meal);
    const choice = await dialog({ type: 'sheet', title: meal.name, actions: [
      { label: 'Renommer', value: 'rename' },
      ...(ed.plan.meals.length < DIET_MEAL_MAX ? [{ label: 'Copier ce repas', value: 'copy' }] : []),
      { label: meal.note ? 'Modifier la consigne' : 'Ajouter une consigne', value: 'note' },
      ...(i > 0 ? [{ label: 'Monter', value: 'up' }] : []),
      ...(i < ed.plan.meals.length - 1 ? [{ label: 'Descendre', value: 'down' }] : []),
      { label: 'Supprimer le repas', value: 'delete', style: 'destructive' },
      { label: 'Annuler', style: 'cancel' },
    ] });
    if (choice === 'copy') {
      dietCopyMeal(ed.plan, meal.id);
      showToast(`${meal.name} copié`);
    } else if (choice === 'rename') {
      const name = await askText({ title: 'Nom du repas', value: meal.name });
      if (name) meal.name = dietText(name, DIET_NAME_MAX);
    } else if (choice === 'note') {
      const r = await coachTextSheet({ title: 'Consigne du repas', value: meal.note || '', placeholder: 'Par exemple : 1 h avant l\'entraînement',
        max: DIET_NOTE_MAX, existing: false, confirm: 'OK' });
      if (r == null) return;
      const note = dietText(r, DIET_NOTE_MAX);
      if (note) meal.note = note; else delete meal.note;
    } else if (choice === 'up' || choice === 'down') {
      moveItem(ed.plan.meals, i, choice === 'up' ? i - 1 : i + 1);
    } else if (choice === 'delete') {
      if (meal.items.length && !(await confirmSheet('Supprimer ce repas ?', `${meal.name} et ses ${plural(meal.items.length, 'aliment', 'aliments')} sont retirés du plan.`, 'Supprimer'))) return;
      ed.plan.meals.splice(i, 1);
    } else return;
    dietSaved();
  },
  'diet-add-food': async (e, el) => {
    const ed = dietEditedPlan(), meal = dietMealOf(ed?.plan, el.dataset.meal);
    if (!meal) return;
    if (meal.items.length >= DIET_ITEM_MAX) { showToast(`${DIET_ITEM_MAX} aliments au plus par repas`, { error: true }); return; }
    const pick = await dietChooseFood();
    if (!pick) return;
    const it = foodToItem(pick.food, pick.g);
    if (!it) return;
    meal.items.push(it);
    haptic();
    dietSaved();
  },
  'diet-item-menu': async (e, el) => {
    const ed = dietEditedPlan(), meal = dietMealOf(ed?.plan, el.dataset.meal);
    const it = meal?.items.find(x => x.id === el.dataset.item);
    if (!it) return;
    const choice = await dialog({ type: 'sheet', title: it.name, message: `${it.g} g : ${dietN(dietItemMacros(it).kcal)} kcal, ${dietMacroWords(dietItemMacros(it))}`, actions: [
      { label: 'Changer la quantité', value: 'qty' },
      { label: 'Retirer du repas', value: 'remove', style: 'destructive' },
      { label: 'Annuler', style: 'cancel' },
    ] });
    if (choice === 'qty') {
      const g = await dietAskGrams(it, it.g);
      if (g == null) return;
      it.g = Math.round(g);
    } else if (choice === 'remove') {
      meal.items = meal.items.filter(x => x !== it);
    } else return;
    dietSaved();
  },
  'diet-duplicate': (e, el) => {
    if (!dietCanCreate(data, coachRole().isCoach)) {
      showToast(`${coachRole().isCoach ? DIET_PLAN_MAX_COACH : DIET_PLAN_MAX} plans au plus : supprimes-en un d'abord`, { error: true });
      return;
    }
    const nid = dietDuplicatePlan(data, el.dataset.id);
    if (!nid) return;
    save();
    haptic();
    navigate(makeRoute('diet-plan', nid), { replace: true });
    showToast('Plan dupliqué');
  },
  // Coach : envoyer ce plan à un élève, sans passer par sa fiche
  'diet-send-student': async (e, el) => {
    const planId = el.dataset.id, plan = dietPlanOf(planId);
    const students = coach.state?.students || [];
    if (!plan) return;
    if (!students.length) { showToast(coach.state ? 'Tu n\'as pas encore d\'élève.' : coachErrorText('offline'), { error: !coach.state }); return; }
    const uid2 = await dialog({ type: 'sheet', title: `Envoyer « ${plan.name} »`, message: 'Un nouvel envoi du même plan le met à jour chez ton élève.',
      actions: [...students.map(st => ({ label: personName(st), value: st.user_id })), { label: 'Annuler', style: 'cancel' }] });
    if (!uid2) return;
    el.disabled = true;
    const r = await coachSendDiet(uid2, planId);
    el.disabled = false;
    if (coachToast(r, `Plan envoyé à ${personName(students.find(st => st.user_id === uid2))}`)) { haptic(); coachRefresh(); }
  },
  'diet-delete': async (e, el) => {
    const id = el.dataset.id, plan = dietPlanOf(id);
    if (!plan) return;
    if (!(await confirmSheet('Supprimer ce plan ?', `${plan.name} disparaît de tes plans et de Nutrition.${plan.fromCoach ? ' Ton coach pourra te le renvoyer.' : ''}`, 'Supprimer'))) return;
    dietArchivePlan(data, id);
    save();
    goBack();
    showToast('Plan supprimé');
  },
});
