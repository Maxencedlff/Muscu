// ═══════════════════════════════════════════════════════════
//  Plans diète : liste et éditeur (Nutrition V1, docs/NUTRITION_V1.md)
//
//  - Programme › Plans diète (diet-plans) : mes plans et ceux reçus d'un coach, le plan suivi d'abord,
//    « Créer un plan ». Un coach y prépare aussi les plans de ses élèves (envoi depuis la fiche de l'élève).
//  - Un plan (diet-plan:ID) : suivre ce plan, total prévu, objectifs du jour (fixés par la personne ou son
//    coach ; une estimation est proposée sur demande, js/data/diet-estimate.js), repas et leurs aliments. Ajouter un aliment : recherche dans la base Ciqual
//    ou dans mes aliments perso, puis la quantité en grammes ; les macros se calculent seules.
//  - Plan reçu d'un coach : lecture seule (le coach le modifie et le renvoie) ; le remplacement d'un
//    aliment pour la journée reste possible dans Nutrition.
// ═══════════════════════════════════════════════════════════
'use strict';

const dietPlanOf = id => { const p = data.dietPlans?.[id]; return p && !p.archived ? p : null; };
const dietMealOf = (plan, mealId) => plan?.meals.find(m => m.id === mealId) || null;
// Plan perso (ni reçu d'un coach, ni préparé par un coach) : ses repas sont des « repas types » facultatifs, ce que la
// personne mange d'habitude, pour le copier vite dans sa journée ; l'essentiel est le journal du jour et les objectifs
// (retour de Maxence du 16/11 : « c'est pas parce que j'ai mangé un truc que demain c'est ce repas que j'ai prévu »).
// Un plan de coach garde ses repas prévus : c'est un menu à suivre
function dietPersonal(plan) { return !!plan && !plan.fromCoach && !coachRole().isCoach; }
function dietHasMealItems(plan) { return !!plan?.meals.some(m => m.items.length); }
function dietMealsNoun(plan) { return dietPersonal(plan) ? 'Tes repas types' : 'Les repas prévus'; }
// Plans dont la personne a demandé à composer des repas types (le temps de la session : tant qu'aucun aliment n'y est,
// l'écran du plan ne montre que les objectifs)
const dietComposing = new Set();

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
      ${navBar({ title: 'Plans de nutrition' })}
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
// Objectifs en toutes lettres, unités au choix : « 2 000 kilocalories, 150 grammes de protéines » (VoiceOver) ou
// « 2 000 kcal, 150 g de protéines » (confirmation d'envoi au coach, où « P 150 » ne se comprenait pas à côté de
// « 34 g de protéines de moins », panel t6)
function dietTargetsWords(plan, kcal, g) {
  const t = plan.targets;
  if (!t) return 'Selon le plan';
  return [t.kcal ? `${dietN(t.kcal)}${kcal}` : '', ...DIET_MACROS.map(m => (t[m.k] ? `${t[m.k]}${g} de ${m.label.toLowerCase()}` : ''))].filter(Boolean).join(', ');
}
function dietTargetsSpoken(plan) { return dietTargetsWords(plan, ' kilocalories', ' grammes'); }
function dietTargetsHtml(plan) { return dietSrPair(esc(dietTargetsText(plan)), esc(dietTargetsSpoken(plan))); }
// Ligne « Objectifs du jour » de l'éditeur : dit aussi ce qui n'est pas fixé (« P 144 » seul laissait croire que les
// calories ne se réglaient pas, retour du 16/11)
function dietTargetsCellHtml(plan) {
  const t = plan.targets;
  if (!t) return esc('Aucun : le total prévu sert de repère');
  if (t.kcal) return dietTargetsHtml(plan);
  return dietSrPair(esc(`Calories : aucun objectif · ${dietTargetsText(plan)}`), esc(`Calories : aucun objectif, ${dietTargetsSpoken(plan)}`));
}

function dietPlanItemCell(plan, meal, it, ro) {
  const m = dietItemMacros(it);
  const inner = `${dietFoodIconHtml(it)}<span class="cell__body"><span class="cell__title">${esc(foodName(it.name))}</span>
      <span class="cell__sub num">${dietSrPair(`${esc(dietQtyText(it))} · ${dietN(m.kcal)} kcal${it.ecalc ? ' (calculées)' : ''} · P ${dietN(m.p)} · G ${dietN(m.c)} · L ${dietN(m.f)}`,
        `${esc(dietQtySpoken(it))}, ${dietN(m.kcal)} kilocalories${it.ecalc ? ' calculées' : ''}, ${dietMacroGramsSpoken(m)}`)}</span></span>`;
  return ro ? `<div class="cell">${inner}</div>`
    : `<button class="cell cell--nav" data-action="diet-item-menu" data-swipe-del="diet-plan-item-del" data-meal="${esc(meal.id)}" data-item="${esc(it.id)}">${inner}${icon('chevron.right', 16)}</button>`;
}

function renderDietPlan(id) {
  const plan = dietPlanOf(id);
  // Grand titre : le nom du plan entier, même long (iPhone SE) ; la barre compacte, qui le coupe, vient au défilement
  if (!plan) return `<div class="view view--grouped diet-plan-view">${navBar({ title: 'Plan de nutrition' })}<div class="scr"><div class="empty-note">Ce plan n'existe plus.</div></div></div>`;
  const ro = !!plan.fromCoach, on = data.dietActive === id, total = dietPlanMacros(plan);
  const personal = dietPersonal(plan), filled = dietHasMealItems(plan);
  const showMeals = !personal || filled || dietComposing.has(id), gap = dietTargetGap(plan, dietMealsNoun(plan));
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
        ${meal.items.length ? `<div class="group-foot num">${meal.note ? `${esc(meal.note)} · ` : ''}${dietSrPair(dietMacroLine(dietMealMacros(meal)), dietMacroSpoken(dietMealMacros(meal)))}</div>`
          : meal.note ? `<div class="group-foot">${esc(meal.note)}</div>` : ''}`).join('');   /* repas vide : pas de ligne de zéros (panel Apple vague 4) */
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
        ${dietMacroLegendHtml()}
        <div class="group">
          ${personal && !filled ? '' : `<div class="cell"><span class="cell__body"><span class="cell__title">${personal ? 'Total des repas types' : 'Total prévu'}</span><span class="cell__sub num">${dietSrPair(`P\u00a0${dietN(total.p)}\u00a0g · G\u00a0${dietN(total.c)}\u00a0g · L\u00a0${dietN(total.f)}\u00a0g`, dietMacroGramsSpoken(total))}</span></span><span class="cell__value num">${dietN(total.kcal)} kcal</span></div>`}
          ${ro ? `<div class="cell"><span class="cell__body"><span class="cell__title">Objectifs du jour</span><span class="cell__sub num">${dietTargetsHtml(plan)}</span></span></div>`
            : `<button class="cell cell--nav" data-action="diet-targets" data-id="${esc(id)}"><span class="cell__body"><span class="cell__title">Objectifs du jour</span><span class="cell__sub num">${dietTargetsCellHtml(plan)}</span></span>${icon('chevron.right', 16)}</button>`}
        </div>
        ${gap ? `<p class="diet-gap" role="note">${icon('info.circle', 14)}<span>${esc(gap)}</span></p>` : ''}
        <div class="group-foot">${ro ? `Plan et objectifs fixés par ${esc(plan.fromCoach.name || 'ton coach')} : il les modifie et te les renvoie. Dans Nutrition, tu peux remplacer un aliment pour la journée.`
          : personal ? `${plan.targets ? '' : 'Fixe tes objectifs toi-même, ou touche « Objectifs du jour » pour une estimation. '}Ce que tu manges se note chaque jour dans Entraînement › Nutrition.`
            : 'Fixe les objectifs toi-même, ou touche « Objectifs du jour » pour une estimation. Sans objectif, le total prévu sert de repère.'}</div>
        ${dietLowKcal(plan) ? dietLowNoteHtml(!!plan.targets?.kcal) : ''}
        ${personal ? (showMeals ? `<div class="group-title diet-types-title">Repas types (facultatif)</div>
        <div class="group-foot diet-types-foot">Ce que tu manges d'habitude, pour le copier vite dans ta journée. Ce que tu notes dans Nutrition ne s'ajoute jamais ici.</div>`
          : `<div class="group group--gap"><button class="cell cell--action" data-action="diet-compose" data-id="${esc(id)}">${icon('plus', 20)}<span>Composer des repas types (facultatif)</span></button></div>
        <div class="group-foot">Ce que tu manges d'habitude, pour le copier vite dans ta journée.</div>`) : ''}
        ${showMeals ? meals : ''}
        ${personal && filled ? `<div class="group group--gap"><button class="cell cell--action" data-action="diet-clear-meals" data-id="${esc(id)}">${icon('trash', 20)}<span>Vider les repas types</span></button></div>` : ''}
        ${ro || !showMeals || plan.meals.length >= DIET_MEAL_MAX ? '' : `<div class="group group--gap"><button class="cell cell--action" data-action="diet-add-meal" data-id="${esc(id)}">${icon('plus', 20)}<span>Ajouter un repas</span></button></div>`}
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

// « Créer « whey » » en tête des résultats quand rien ne correspond pile à ce qui est tapé (vague 4) : le nom est
// prérempli dans la feuille de création. Le bouton « Créer un aliment » du bas reste, vide
function dietFoodCreateHtml(q) {
  const t = dietCutName(q);
  return t ? `<button class="diet-cand diet-cand--create" data-pick="create">${icon('plus', 18)}<span class="diet-cand__body"><span class="diet-cand__name">Créer «\u00a0${esc(t)}\u00a0»</span>
      <span class="diet-cand__sub">Avec les valeurs de l'étiquette, pour 100 g</span></span></button>` : '';
}
// Ligne d'un résultat : étiquette « cru » ou « cuit » quand le nom Ciqual le dit, puis les valeurs pour 100 g
function dietFoodRowHtml(x, i) {
  const tag = foodCookTag(x.food);
  return `
        <button class="diet-cand" data-pick="${i}">
          ${dietFoodIconHtml(x.food)}
          <span class="diet-cand__body"><span class="diet-cand__name">${esc(foodName(x.food.name))}</span>
            <span class="diet-cand__sub num">${tag ? `<span class="diet-tag" aria-hidden="true">${tag}</span>` : ''}${x.own ? 'Mon aliment · ' : ''}${dietSrPair(`100 g · ${x.food.per.k} kcal${x.food.ecalc ? ' (calculées)' : ''} · P ${fmtNum(x.food.per.p)} · G ${fmtNum(x.food.per.c)} · L ${fmtNum(x.food.per.f)}`,
              `pour 100 grammes, ${x.food.per.k} kilocalories${x.food.ecalc ? ' calculées' : ''}, ${dietMacroWords(x.food.per, fmtNum).replace(/ g /g, ' grammes ')}`)}</span></span>
        </button>`;
}
function dietFoodResultsHtml(q, res = searchFoods(q, { own: data.dietFoods || [] })) {
  if (!foodDb && !(data.dietFoods || []).length) return `${dietFoodCreateHtml(q)}<p class="diet-pick__note">Base d'aliments indisponible pour l'instant. Tu peux créer ton aliment.</p>`;
  if (!q.trim()) return `<p class="diet-pick__note">Tape un aliment : « riz », « poulet », « skyr »… ${foodDb ? `${dietN(foodDb.foods.length)} aliments de la table Ciqual.` : ''}</p>`;
  const create = foodSearchExact(q, res) ? '' : dietFoodCreateHtml(q);
  if (!res.length) return `${create}<p class="diet-pick__note">Rien pour « ${esc(q)} ». Crée ton aliment avec ses valeurs pour 100 g.</p>`;
  return `${create}${dietMacroLegendHtml('diet-legend--list')}${res.map(dietFoodRowHtml).join('')}`;
}
// Renvoie l'aliment choisi ({ food } de searchFoods), 'new' (créer un aliment), { create: nom } (créer, nom tapé),
// 'scan' (code-barres) ou null
async function dietPickFood() {
  await loadFoods();
  let results = [], query = '';
  const body = `
    <div class="diet-pick">
      ${foodScanButtonHtml()}
      <div class="social-search diet-pick__search"><span class="social-search__icon" aria-hidden="true">${icon('magnifyingglass', 17)}</span>
        <input type="search" id="dietFoodSearch" class="search social-search__input" placeholder="Rechercher" autocomplete="off" enterkeyhint="search" aria-label="Rechercher un aliment"></div>
      <div class="diet-pick__list" id="dietFoodList">${dietFoodResultsHtml('')}</div>
      <p class="sr-text" id="dietFoodCount" aria-live="polite"></p>
      <button class="diet-cand diet-cand--new" data-pick="new">${icon('plus', 18)}<span class="diet-cand__name">Créer un aliment</span></button>
    </div>`;
  const p = sheet({ title: 'Ajouter un aliment', cancel: 'Annuler', confirm: '', body, focus: '#dietFoodSearch' });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  root?.addEventListener('input', ev => {
    if (ev.target.id !== 'dietFoodSearch') return;
    query = ev.target.value;
    results = searchFoods(query, { own: data.dietFoods || [] });
    $('#dietFoodList', root).innerHTML = dietFoodResultsHtml(query, results);
    // VoiceOver : nombre de résultats dit à chaque frappe (la liste changeait sans rien annoncer, panel vague 4)
    clearTimeout(root._countT);
    root._countT = setTimeout(() => {
      const c = $('#dietFoodCount', root);
      if (c) c.textContent = !query.trim() ? '' : results.length ? plural(results.length, 'résultat', 'résultats') : 'Aucun résultat';
    }, 500);
  });
  root?.addEventListener('click', ev => {
    const b = ev.target.closest('[data-pick]');
    if (!b) return;
    const k = b.dataset.pick;
    const hit = results[Number(k)];
    root._close(k === 'new' || k === 'scan' ? k : k === 'create' ? { create: dietCutName(query) } : hit ? { ...hit, query } : null);
  });
  return p;
}

// Choix d'un aliment (recherche, code-barres ou création) puis de sa quantité : { food, g, por } ou null (por : unité choisie).
// Sert au plan ; réutilisable partout où l'on ajoute un aliment
async function dietChooseFood() {
  const pick = await dietPickFood();
  if (pick === 'scan') return foodScanFlow();
  // Nom tapé repris avec une majuscule (« whey » → « Whey »), comme le clavier le ferait
  const typed = pick?.create, chosen = pick === 'new' ? await dietNewFood() : typed !== undefined ? await dietNewFood(typed.charAt(0).toUpperCase() + typed.slice(1)) : pick;
  if (!chosen?.food) return null;
  // Rappel cru / cuit : la feuille de quantité peut rendre l'autre version (q.food). Pas quand la recherche disait déjà
  // « cuit » ou « cru » : la version est choisie exprès (panel vague 4, « riz blanc cuit » puis « Pesé cru ? »)
  const q = await dietAskQty(chosen.food, null, { twin: !foodQuerySaysCook(chosen.query) });
  return q && { food: q.food || chosen.food, g: q.g, por: q.por };
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
      <div class="diet-fields">${field('dietFoodK', 'Énergie', 'kcal', 900)}${field('dietFoodP', 'Protéines', 'g', 100)}${field('dietFoodC', 'Glucides', 'g', 100)}${field('dietFoodF', 'Lipides', 'g', 100)}</div>
      <label class="diet-field"><span class="diet-field__label">Une portion</span>
        <input id="dietFoodPortion" class="diet-field__input num" type="text" inputmode="decimal" autocomplete="off" placeholder="Facultatif" aria-label="Poids d'une portion, en grammes, facultatif">
        <span class="diet-field__unit">g</span></label>
      <p class="diet-form__hint">Facultatif : le poids d'un pot, d'une barre ou d'une part. Tu pourras compter en portions plutôt qu'en grammes.</p>
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
    const pRaw = v('#dietFoodPortion').trim(), pg = pRaw ? num(pRaw, 1, DIET_G_MAX) : null;
    if (pRaw && pg === null) return err(`Une portion : de 1 à ${fmtNum(DIET_G_MAX)} g.`);
    const famPick = $('#dietFoodFam', panel)?.value;
    const food = { id: uid(), name: nm, fam: DIET_FAMS.includes(famPick) ? famPick : dietFamOf(per), per, ...(code ? { code } : {}),
      ...(pg ? { portion: { u: 'portion', pl: 'portions', g: pg } } : {}) };
    return { made: food };
  } }).then(r => (r?.made ? dietKeepFood(r.made) : null));
}
// Garde un aliment créé dans Mes aliments. Plein (200) : jamais le plus ancien retiré en silence (vague 4) ; la
// personne choisit : l'ajouter quand même sans le garder, ou faire de la place dans Mes aliments
async function dietKeepFood(food) {
  if (dietFoodsFull(data.dietFoods, food)) {
    const v = await dialog({ title: 'Mes aliments est plein', message: `${DIET_FOODS_MAX} aliments au plus. Retire ceux dont tu ne te sers plus pour garder celui-ci, ou ajoute-le sans le garder.`,
      actions: [{ label: 'Ajouter sans le garder', value: 'once', style: 'preferred' }, { label: 'Gérer Mes aliments', value: 'manage' }, { label: 'Annuler', style: 'cancel' }] });
    if (v === 'manage') dietOpenFoods();
    return v === 'once' ? { food: dietOwnPick(food) } : null;
  }
  data.dietFoods = cleanDietFoods([food, ...(data.dietFoods || []).filter(x => normName(x.name) !== normName(food.name) && !(food.code && x.code === food.code))]);
  return { food: dietOwnPick(food) };
}

async function dietAskGrams(food, value = 100) {
  return askNumber({ title: elideName(foodName(food.name)),
    message: `Quantité en grammes. Pour 100 g : ${food.per.k} kcal.`,   // macros déjà dans la liste : l'alerte reste courte en texte agrandi
    value: String(value), unit: 'g', min: 1, max: DIET_G_MAX });
}

// ── Objectifs du jour ───────────────────────────────────────

// Feuille en trois temps, dans la même feuille (pas de feuille sur une feuille) :
//  - saisie (edit) : Calories, Protéines, Glucides, Lipides ; un champ vide = pas d'objectif (« Aucun »), le total
//    des repas prévus est écrit à part (en gris dans le champ, il passait pour une valeur fixée : retour de
//    Maxence du 16/11, « je peux pas modifier les kcal ? ») ; protéines en g ou en g/kg (poids des Réglages) ;
//  - questions (ask) : « Me proposer des objectifs », 6 réponses, poids (Réglages) et sexe (niveau de force) pré-remplis ;
//  - proposition (result) : valeurs, explication en une ligne, « Utiliser ces objectifs » ou « Ajuster ».
// Un coach prépare les plans de ses élèves : ni g/kg ni poids pré-rempli (ce serait son poids, pas le leur).
// Rend { targets } (null = aucun objectif) ou null si annulée
const DIET_T_ROWS = [['kcal', 'Calories', 'kcal'], ['p', 'Protéines', 'g'], ['c', 'Glucides', 'g'], ['f', 'Lipides', 'g']];

function dietTargetsEditHtml(t, total, kg, plan) {
  const row = (k, label, unit) => {
    const dot = k === 'kcal' ? '' : `<i class="diet-dot diet-dot--${k}" aria-hidden="true"></i>`;
    const unitHtml = k === 'p' && kg
      ? `<button type="button" class="diet-field__unitbtn" data-tunit aria-label="g : grammes. Toucher pour passer en g/kg">g</button>`
      : `<span class="diet-field__unit" aria-hidden="true">${unit}</span>`;
    return `<label class="diet-field"><span class="diet-field__label">${dot}${label}</span>
        <input id="dietT_${k}" class="diet-field__input num" type="text" inputmode="${k === 'p' ? 'decimal' : 'numeric'}" autocomplete="off"
          value="${t[k] ?? ''}" placeholder="Aucun" aria-label="${label} par jour${k === 'kcal' ? ', en kilocalories' : ', en grammes'}. Vide : aucun objectif">
        ${unitHtml}</label>`;
  };
  const word = dietPersonal(plan) ? 'Repas types' : 'Repas prévus';
  const planned = `${word} : ${dietN(total.kcal)} kcal · P ${dietN(total.p)} g · G ${dietN(total.c)} g · L ${dietN(total.f)} g`;
  const plannedSpoken = word + ' : ' + dietN(total.kcal) + ' kilocalories, ' + dietMacroGramsSpoken(total);
  // Sans repas types, pas de « Repas types : 0 kcal » : seulement ce que veut dire un champ vide
  const empty = `Un champ vide : pas d'objectif`;
  const hint = dietHasMealItems(plan) ? `${dietSrPair(esc(planned), esc(plannedSpoken))}. ${empty}, leur total sert de repère.` : `${empty}.`;
  return `<div data-tstep="edit">
      <div class="diet-fields">${DIET_T_ROWS.map(r => row(...r)).join('')}</div>
      <p class="diet-tg__pkg num" id="dietTPkg" aria-live="polite"></p>
      <p class="diet-form__hint num">${hint}</p>
      <p class="diet-form__err" id="dietTErr" role="alert"></p>
      <div class="diet-tg__links">
        <button type="button" class="diet-tg__link" data-tpropose>Me proposer des objectifs</button>
        <button type="button" class="diet-tg__link" data-tclear>Aucun objectif</button>
      </div>
    </div>`;
}

function dietTargetsAskHtml(pre) {
  // Gabarits sans gabarit imbriqué (le contrôle des tirets de tests/unit/nutrition.mjs lit les chaînes à plat)
  const segBtn = (name, cur) => ([v, l]) => '<button type="button" class="segmented__btn' + (v === cur ? ' segmented__btn--active' : '')
    + '" data-tseg="' + name + '" data-v="' + v + '" aria-pressed="' + (v === cur) + '">' + l + '</button>';
  const seg = (name, opts, cur, label) => `<div class="segmented seg-full diet-tg__seg" role="group" aria-label="${label}">
      ${opts.map(segBtn(name, cur)).join('')}</div>`;
  const options = Object.entries(DIET_EST_ACTIVITY).map(([k, a]) => '<option value="' + k + '"' + (k === pre.activity ? ' selected' : '') + '>' + a.label + '</option>').join('');
  const field = (id, label, unit, value, mode) => `<label class="diet-field"><span class="diet-field__label">${label}</span>
      <input id="${id}" class="diet-field__input num" type="text" inputmode="${mode}" autocomplete="off" value="${value ?? ''}" aria-label="${label}, en ${unit === 'ans' ? 'années' : unit === 'cm' ? 'centimètres' : 'kilos'}">
      <span class="diet-field__unit" aria-hidden="true">${unit}</span></label>`;
  return `<div data-tstep="ask" hidden>
      <h3 class="diet-tg__title" tabindex="-1">Me proposer des objectifs</h3>
      <p class="diet-tg__q">Ton objectif</p>
      ${seg('goal', Object.entries(DIET_EST_GOALS).map(([k, g]) => [k, g.label]), pre.goal, 'Ton objectif')}
      <p class="diet-tg__q">Ton activité</p>
      <label class="diet-field">
        <select id="dietEAct" class="diet-field__input diet-field__select diet-tg__select" aria-label="Ton activité">
          ${options}
        </select>${icon('chevron.up.chevron.down', 14)}</label>
      <p class="diet-tg__q">Toi</p>
      ${seg('sex', [['male', 'Homme'], ['female', 'Femme']], pre.sex, 'Sexe')}
      <div class="diet-fields">${field('dietEAge', 'Âge', 'ans', '', 'numeric')}${field('dietECm', 'Taille', 'cm', '', 'numeric')}${field('dietEKg', 'Poids', 'kg', pre.kg ? fmtNum(pre.kg, 1) : '', 'decimal')}</div>
      <p class="diet-form__err" id="dietEErr" role="alert"></p>
      <button type="button" class="btn btn--primary btn--full diet-tg__go" data-tcalc>Calculer</button>
      <button type="button" class="diet-tg__link diet-tg__back" data-tback>Retour</button>
    </div>`;
}

function dietTargetsResultHtml() {
  return `<div data-tstep="result" hidden>
      <h3 class="diet-tg__title" tabindex="-1">Proposition</h3>
      <div class="diet-fields" id="dietEOut"></div>
      <p class="diet-tg__why num" id="dietEWhy"></p>
      <p class="diet-tg__why diet-tg__why--macros num" id="dietEWhyM"></p>
      <p class="diet-form__hint">Estimation, pas un avis médical : pèse-toi chaque semaine et ajuste après deux ou trois semaines. Méthode : Mifflin-St Jeor (1990), protéines selon Morton et al. (2018), prise de masse selon Iraki et al. (2019).</p>
      <button type="button" class="btn btn--primary btn--full diet-tg__go" data-tuse>Utiliser ces objectifs</button>
      <button type="button" class="diet-tg__link diet-tg__back" data-tadjust>Ajuster</button>
    </div>`;
}

async function dietTargetsSheet(plan) {
  const t = plan.targets || {}, total = dietPlanMacros(plan), isCoach = coachRole().isCoach;
  const kg0 = isCoach ? null : currentBodyKg();
  const kg = kg0 && kg0 >= DIET_EST_BOUNDS.kg[0] && kg0 <= DIET_EST_BOUNDS.kg[1] ? kg0 : null;
  // Sexe : celui déclaré dans Réglages › Entraînement (niveau de force), jamais la silhouette (un choix d'affichage)
  const pre = { goal: 'keep', activity: 'mid', sex: isCoach ? null : strengthSex(), kg };
  const body = `<div class="diet-form diet-tg">${dietTargetsEditHtml(t, total, kg, plan)}${dietTargetsAskHtml(pre)}${dietTargetsResultHtml()}</div>`;
  // pExact : grammes exacts derrière le champ tant qu'il n'est pas retouché (144 g affichés « 1,9 g/kg » restent
  // 144 g, pas 142 : l'arrondi du ratio ne change jamais un objectif en silence)
  let perKg = !!kg && data.dietProteinPerKg === true, proposal = null, pExact = t.p ?? null;
  const p = sheet({ title: 'Objectifs du jour', confirm: 'OK', body, onConfirm: panel => {
    const out = {};
    for (const k of DIET_TARGET_KEYS) {
      const raw = $(`#dietT_${k}`, panel).value.trim();
      if (!raw) continue;
      const v = k === 'p' && pExact != null ? pExact : k === 'p' && perKg ? dietProteinGrams(raw, kg) : num(raw, 1, DIET_TARGET_MAX[k]);
      if (v === null || v > DIET_TARGET_MAX[k]) {
        $('#dietTErr', panel).textContent = k === 'p' && perKg ? `Protéines : de ${fmtNum(DIET_PKG_BOUNDS[0], 1)} à ${fmtNum(DIET_PKG_BOUNDS[1], 1)} g/kg.`
          : `${DIET_T_ROWS.find(r => r[0] === k)[1]} : de 1 à ${fmtNum(DIET_TARGET_MAX[k])}.`;
        $(`#dietT_${k}`, panel).focus();
        return false;
      }
      out[k] = Math.round(v);
    }
    if (kg) { if (perKg) data.dietProteinPerKg = true; else delete data.dietProteinPerKg; }
    return { targets: cleanDietTargets(out) };
  } });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  if (!root) return p;
  const okBtn = $('.sheet__btn--confirm', root), pIn = $('#dietT_p', root), unitBtn = $('[data-tunit]', root);
  const show = next => {
    for (const el of root.querySelectorAll('[data-tstep]')) el.hidden = el.dataset.tstep !== next;
    okBtn.style.visibility = next === 'edit' ? '' : 'hidden';   // OK enregistre la saisie : seulement sur elle
    $(`[data-tstep="${next}"] ${next === 'edit' ? '#dietT_kcal' : '.diet-tg__title'}`, root)?.focus({ preventScroll: true });
    $('.sheet__body', root).scrollTop = 0;
  };
  // Protéines : unité, et l'autre écriture dessous (« = 142 g pour 74,5 kg », « 1,9 g/kg pour 74,5 kg »)
  const paintP = () => {
    if (!unitBtn) return;
    unitBtn.textContent = perKg ? 'g/kg' : 'g';
    // Intitulé qui commence par le texte affiché (« g », « g/kg ») : Contrôle vocal et axe (label-content-name-mismatch)
    unitBtn.setAttribute('aria-label', perKg ? 'g/kg : grammes par kilo. Toucher pour passer en g' : 'g : grammes. Toucher pour passer en g/kg');
    pIn.setAttribute('aria-label', `Protéines par jour, en ${perKg ? 'grammes par kilo de poids du corps' : 'grammes'}. Vide : aucun objectif`);
    const raw = pIn.value.trim(), kgTxt = `${fmtNum(kg, 1)} kg (Réglages)`;
    let line = '';
    if (raw && perKg) { const g = pExact ?? dietProteinGrams(raw, kg); line = g ? `= ${fmtNum(g)} g pour ${kgTxt}` : ''; }
    else if (raw) { const r = dietProteinPerKg(num(raw, 1, DIET_TARGET_MAX.p), kg); line = r ? `Soit ${fmtNum(r, 1)} g/kg pour ${kgTxt}` : ''; }
    $('#dietTPkg', root).textContent = line;
  };
  if (unitBtn && perKg && t.p) pIn.value = fmtNum(dietProteinPerKg(t.p, kg), 1);
  paintP();
  pIn.addEventListener('input', () => { pExact = null; paintP(); });
  const fill = v => { pExact = v?.p ?? null; for (const k of DIET_TARGET_KEYS) $(`#dietT_${k}`, root).value = v?.[k] != null ? (k === 'p' && perKg ? fmtNum(dietProteinPerKg(v.p, kg), 1) : String(v[k])) : ''; paintP(); };
  root.addEventListener('click', ev => {
    const el = ev.target.closest('[data-tunit], [data-tclear], [data-tpropose], [data-tback], [data-tcalc], [data-tuse], [data-tadjust], [data-tseg]');
    if (!el) return;
    if (el.matches('[data-tunit]')) {
      // Conversion de la valeur en cours : 144 g ↔ 1,9 g/kg
      const raw = pIn.value.trim();
      const g = raw ? (pExact ?? (perKg ? dietProteinGrams(raw, kg) : num(raw, 1, DIET_TARGET_MAX.p))) : null;
      perKg = !perKg;
      if (g) { pIn.value = perKg ? fmtNum(dietProteinPerKg(g, kg), 1) : String(Math.round(g)); pExact = Math.round(g); }
      paintP(); haptic('light');
    } else if (el.matches('[data-tclear]')) {
      fill(null); $('#dietTErr', root).textContent = ''; haptic('light');
      showToast('Objectifs vidés : touche OK pour enregistrer');
    } else if (el.matches('[data-tpropose]')) show('ask');
    else if (el.matches('[data-tback], [data-tadjust]')) {
      if (el.matches('[data-tadjust]') && proposal) fill(proposal);
      show('edit');
    } else if (el.matches('[data-tseg]')) {
      for (const b of root.querySelectorAll(`[data-tseg="${el.dataset.tseg}"]`)) {
        const on = b === el;
        b.classList.toggle('segmented__btn--active', on);
        b.setAttribute('aria-pressed', String(on));
      }
      haptic('light');
    } else if (el.matches('[data-tcalc]')) {
      const seg = n => $(`[data-tseg="${n}"].segmented__btn--active`, root)?.dataset.v ?? null;
      const age = num($('#dietEAge', root).value, DIET_EST_BOUNDS.age[0], DIET_EST_BOUNDS.age[1], true);
      const cm = num($('#dietECm', root).value, DIET_EST_BOUNDS.cm[0], DIET_EST_BOUNDS.cm[1]);
      const w = num($('#dietEKg', root).value, DIET_EST_BOUNDS.kg[0], DIET_EST_BOUNDS.kg[1]);
      const err = !seg('sex') ? 'Choisis Homme ou Femme : la formule diffère.'
        : age === null ? `Âge : de ${DIET_EST_BOUNDS.age[0]} à ${DIET_EST_BOUNDS.age[1]} ans (la formule vaut pour un adulte).`
          : cm === null ? `Taille : de ${DIET_EST_BOUNDS.cm[0]} à ${DIET_EST_BOUNDS.cm[1]} cm.`
            : w === null ? `Poids : de ${DIET_EST_BOUNDS.kg[0]} à ${DIET_EST_BOUNDS.kg[1]} kg.` : '';
      $('#dietEErr', root).textContent = err;
      if (err) return;
      proposal = dietEstimate({ sex: seg('sex'), kg: w, cm, age, activity: $('#dietEAct', root).value, goal: seg('goal') });
      if (!proposal) return;
      const cell = (k, label, v, unit, spoken) => {
        const dot = k === 'kcal' ? '' : '<i class="diet-dot diet-dot--' + k + '" aria-hidden="true"></i>';
        const val = dietSrPair(fmtNum(v) + ' ' + unit, fmtNum(v) + ' ' + spoken);
        return `<div class="diet-field"><span class="diet-field__label">${dot}${label}</span><span class="diet-field__input num diet-tg__val">${val}</span></div>`;
      };
      $('#dietEOut', root).innerHTML = cell('kcal', 'Calories', proposal.kcal, 'kcal', 'kilocalories')
        + DIET_T_ROWS.slice(1).map(([k, l]) => cell(k, l, proposal[k], 'g', 'grammes')).join('');
      $('#dietEWhy', root).textContent = proposal.why;
      $('#dietEWhyM', root).textContent = proposal.whyMacros;
      show('result');
    } else if (el.matches('[data-tuse]') && proposal) {
      root._close({ targets: cleanDietTargets({ kcal: proposal.kcal, p: proposal.p, c: proposal.c, f: proposal.f }) });
    }
  });
  return p;
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
    const name = await askText({ title: 'Nouveau plan', message: coachRole().isCoach ? 'Quatre repas sont prêts à remplir ; tu pourras les renommer.'
      : 'Tu y fixes tes objectifs du jour ; ce que tu manges se note chaque jour dans Nutrition.', placeholder: 'Mon plan', confirm: 'Créer' });
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
  'diet-compose': (e, el) => { dietComposing.add(el.dataset.id); render(); },
  // Vider les repas types (plan perso) : aliments retirés, repas gardés (le journal s'y rattache) ; Annuler les remet
  'diet-clear-meals': (e, el) => {
    const plan = dietPlanOf(el.dataset.id);
    if (!dietPersonal(plan) || !dietHasMealItems(plan)) return;
    const before = plan.meals.map(m => m.items);
    for (const m of plan.meals) m.items = [];
    dietComposing.delete(el.dataset.id);
    dietSaved();
    showToast('Repas types vidés', { action: 'Annuler', duration: 6000, onAction: () => {
      const p = dietPlanOf(el.dataset.id);
      if (!p) return;
      p.meals.forEach((m, i) => { if (before[i] && !m.items.length) m.items = before[i]; });
      dietTouch(p); save(); render();
    } });
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
    const it = foodToItem(pick.food, pick.g, pick.por);
    if (!it) return;
    meal.items.push(it);
    haptic();
    dietSaved();
  },
  'diet-item-menu': async (e, el) => {
    const ed = dietEditedPlan(), meal = dietMealOf(ed?.plan, el.dataset.meal);
    const it = meal?.items.find(x => x.id === el.dataset.item);
    if (!it) return;
    const choice = await dialog({ type: 'sheet', title: foodName(it.name), message: `${dietQtyText(it)} : ${dietN(dietItemMacros(it).kcal)} kcal, ${dietMacroWords(dietItemMacros(it))}`, actions: [
      { label: 'Changer la quantité', value: 'qty' },
      { label: 'Retirer du repas', value: 'remove', style: 'destructive' },
      { label: 'Annuler', style: 'cancel' },
    ] });
    if (choice === 'qty') {
      const q = await dietAskQty(it, it);
      if (!q) return;
      it.g = q.g;
      if (q.por) it.por = q.por; else delete it.por;
    } else if (choice === 'remove') {
      meal.items = meal.items.filter(x => x !== it);
    } else return;
    dietSaved();
  },
  // Balayé vers la gauche (js/ui/swipe-row.js) : retiré du repas, Annuler le remet à sa place
  'diet-plan-item-del': (e, el) => {
    const ed = dietEditedPlan(), meal = dietMealOf(ed?.plan, el.dataset.meal);
    const i = meal ? meal.items.findIndex(x => x.id === el.dataset.item) : -1;
    if (i < 0) return;
    const [it] = meal.items.splice(i, 1);
    haptic('light');
    dietSaved();
    showToast(`Retiré du repas : ${foodName(it.name)}`, { action: 'Annuler', duration: 5000, onAction: () => {
      const m = dietMealOf(dietPlanOf(ed.id), meal.id);
      if (!m || m.items.some(x => x.id === it.id)) return;
      m.items.splice(Math.min(i, m.items.length), 0, it);
      dietTouch(dietPlanOf(ed.id)); save(); render();
    } });
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
