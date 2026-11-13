// ═══════════════════════════════════════════════════════════
//  Nutrition, écrans du jour (Nutrition V1, docs/NUTRITION_V1.md)
//
//  - Entraînement › Nutrition (route nutrition, nutrition:AAAA-MM-JJ pour un jour passé) : frise des 7
//    jours, anneau des calories et barres des macros (mangé sur repère), repas du plan à cocher d'un
//    toucher (un repas coché se replie, le suivant passe devant), aliment remplacé pour la journée par
//    un équivalent (js/data/food-swap.js), série de jours complets.
//  - Carte de l'accueil (nutritionHomeCard) : nom du plan, où en est la journée et tous les repas du jour
//    (coché ou non, kcal), le prochain à cocher sans ouvrir l'écran. Plan reçu d'un coach : carte « Nouveau plan diète » (accueil, Nutrition, Mon coach).
//  - Coach : groupe « Plan diète » de la fiche d'un élève (envoi, ouvert ou pas encore).
//  - Plans et repas se préparent dans Programme › Plans diète (js/features/diet-editor.js).
// ═══════════════════════════════════════════════════════════
'use strict';

const dietOpenMeals = new Set();   // repas cochés dépliés à la main (identifiants), le temps de la session
const DIET_MACROS = [
  { k: 'p', label: 'Protéines', short: 'P' },
  { k: 'c', label: 'Glucides', short: 'G' },
  { k: 'f', label: 'Lipides', short: 'L' },
];

const dietN = v => fmtNum(Math.round(v));
// Nom d'aliment à l'écran : « Oeuf dur » (Ciqual) → « Œuf dur », « boeuf » → « bœuf ». Affichage seulement,
// les données gardent le nom d'origine (recherche, synchro)
const foodName = n => String(n ?? '').replace(/\b([OoBb]?)([Oo])e(ufs?)\b/g, (m, b, o, r) => b + (o === 'O' ? 'Œ' : 'œ') + r);
const elideName = n => (n.length > 60 ? n.slice(0, 58) + '…' : n);
// « 620 kcal · P 45 · G 70 · L 15 » et sa version dite par VoiceOver
// Lettre et chiffre insécables (« L\u00a01 » ne se coupe jamais, panel t6 : le « 1 » passait seul à la ligne)
function dietMacroLine(m) { return `${dietN(m.kcal)}\u00a0kcal · P\u00a0${dietN(m.p)} · G\u00a0${dietN(m.c)} · L\u00a0${dietN(m.f)}`; }
function dietMacroSpoken(m) { return `${dietN(m.kcal)} kilocalories, ${dietMacroGramsSpoken(m)}`; }
function dietMacroGramsSpoken(m) { return `${dietN(m.p)} grammes de protéines, ${dietN(m.c)} de glucides, ${dietN(m.f)} de lipides`; }
// Ligne abrégée à l'écran (« P 4 · G 47 »), dite en toutes lettres par VoiceOver (sinon « P 4 g » lettre par lettre)
function dietSrPair(visible, spoken) { return `<span aria-hidden="true">${visible}</span><span class="sr-text">${spoken}</span>`; }
// Texte d'un dialogue (message lu tel quel) : en toutes lettres pour tous, « 4 g de protéines, 47 g de glucides… »
function dietMacroWords(m, fmt = dietN) { return `${fmt(m.p)} g de protéines, ${fmt(m.c)} g de glucides, ${fmt(m.f)} g de lipides`; }
// Légende des lettres, une fois par écran ou par feuille, au-dessus de la première ligne « P 7 · G 77 · L 1 » : les lignes
// restent courtes (iPhone SE, texte agrandi), la débutante sait ce que veut dire chaque lettre (demande de Maxence,
// vague 4). Cachée à VoiceOver : chaque ligne y est déjà dite en toutes lettres. Rien quand les chiffres sont masqués
function dietMacroLegendHtml(extra = '') {
  if (data.dietHideNumbers === true) return '';
  return `<p class="diet-legend${extra ? ` ${extra}` : ''}" aria-hidden="true">${DIET_MACROS.map(m => `<span class="diet-legend__k"><b>${m.short}</b>\u00a0${m.label.toLowerCase()}</span>`).join(' · ')}</p>`;
}
function dietDayTitle(day) {
  const today = dietDayKey();
  if (day === today) return 'Aujourd\'hui';
  const t = new Date(`${day}T12:00:00`).getTime();
  if (daysAgo(t) === 1) return 'Hier';
  const s = fmtDate(t, 'day');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// Jour affiché : aujourd'hui, sauf un jour passé choisi dans la frise pendant la consultation en cours.
// Le choix vit en mémoire seulement : rechargement, route restaurée (retour, historique), lendemain ou retour dans
// l'app après DIET_PICK_MS : aujourd'hui (retour de Maxence du 10/11 : l'app rouverte le matin était restée sur
// « Hier », ses ajouts partaient sur la veille)
let dietPick = null;   // { day, today, at } : jour passé choisi, jour où il l'a été, quand (js/data/nutrition.js)
function dietRouteDay(day) { return dietPickedDay(dietPick, day, dietWeek(data).map(x => x.day)); }
// Écrans qui montrent la journée (Nutrition, carte de l'accueil) : redessinés au retour dans l'app et à minuit
let dietShownDay = dietDayKey();
function dietRefreshDay({ resumed = false } = {}) {
  const today = dietDayKey(), changed = today !== dietShownDay;
  dietShownDay = today;
  if (resumed && dietPickStale(dietPick)) dietPick = null;
  if (dietPick && dietPick.today !== today) dietPick = null;
  const view = typeof currentView === 'function' ? currentView() : '';
  if (view === 'nutrition' && routeParams(currentRoute())[0] && !dietPick) {
    // Route d'un jour passé qui n'est plus choisi : remise sur aujourd'hui, sans animation
    const next = navClone(nav);
    next.stacks[next.tab][next.stacks[next.tab].length - 1] = 'nutrition';
    navCommit(next, 'none', 'replace');
  } else if (changed && (view === 'nutrition' || view === 'dashboard')) render();
}
document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'visible') dietRefreshDay({ resumed: true }); });
window.addEventListener?.('pageshow', e => { if (e.persisted) dietRefreshDay({ resumed: true }); });
// Passage de minuit écran ouvert : vérifié chaque minute (un minuteur jusqu'à minuit s'endort avec l'app)
setInterval(() => { if (dietDayKey() !== dietShownDay) dietRefreshDay(); }, 60000);
// Toast d'un ajout sur un jour passé : « Ajouté à hier · Dîner »
function dietPastWord(day) { const t = dietDayTitle(day); return t === 'Hier' ? 'à hier' : `au ${t.charAt(0).toLowerCase()}${t.slice(1)}`; }
// Part remplie d'une jauge : sur les nombres affichés (arrondis au gramme ou à la kcal), pour que « 4 / 4 g »
// soit toujours une jauge pleine (panel du 07/11 : 3,6 sur 4,4 g affichés « 4 / 4 g », jauge aux 4/5)
const dietRatio = (v, goal) => dietShownRatio(v, goal);

// Anneau des calories (SVG) : piste grise, arc de la part mangée
function dietRingSvg(ratio, size = 112, stroke = 12) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg class="diet-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="diet-ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
      <circle class="diet-ring__arc${ratio > 0 ? '' : ' diet-ring__arc--zero'}" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
        stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - ratio)).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
}

// Journée du jour encore vide : un appel à cocher le premier repas, pour que l'écran à 0 dise quoi faire
// (« Coche ton petit-déjeuner une fois mangé »). Repas nommé autrement : son nom entre guillemets.
const DIET_CALL_NAMES = { 'petit-déjeuner': 'ton petit-déjeuner', 'déjeuner': 'ton déjeuner', 'dîner': 'ton dîner', 'collation': 'ta collation', 'goûter': 'ton goûter' };
function dietCallText(name) {
  const known = DIET_CALL_NAMES[String(name).trim().toLowerCase()];
  return known ? `Coche ${known} une fois mangé` : `Coche « ${name} » une fois mangé`;
}
function dietCallHtml(pr) {
  if (pr.nDone || !pr.next || pr.day !== dietDayKey()) return '';
  // Texte seul : le rond à cocher est celui du repas, plus bas (un deuxième rond, plus petit, faisait deux dessins pour un geste)
  return `<p class="diet-sum__call">${esc(dietCallText(pr.next.meal.name))}</p>`;
}

// Repas vides du plan (rien de prévu, on y ajoute ce qu'on mange) : ils ne se cochent pas. Avec eux, l'état dit « repas
// prévus » : « Journée complète » après le seul petit-déjeuner rempli, ou « 0 repas coché sur 1 » au-dessus de
// quatre repas, faisaient croire la journée finie ou le compte faux (panel vague 4)
// Repas retiré pour la journée : pas « libre », la journée reste « complète » sans lui (on a choisi de ne pas le manger)
const dietHasFreeMeals = pr => pr.meals.some(x => !x.meal.items.length);
// Aliments notés hors plan ce jour-là (jour vide : tout ce qu'on a mangé)
const dietNotedCount = pr => pr.meals.reduce((n, x) => n + x.extras.length, 0);
function dietStatusText(pr) {
  // Rien à cocher (jour vide, repas tous retirés) : ce qu'on a noté, sans « 0 sur 0 »
  if (!pr.nMeals) { const n = dietNotedCount(pr); return n ? plural(n, 'aliment noté', 'aliments notés') : 'Rien de noté pour l\'instant'; }
  // Jour vide : un repas est fait dès qu'on y a noté un aliment (ou coché son plan copié)
  if (pr.blank) return pr.complete ? 'Journée complète' : pr.nDone ? `${pr.nDone} ${pr.nDone > 1 ? 'repas notés' : 'repas noté'} sur ${pr.nMeals}` : 'Rien de noté pour l\'instant';
  const free = dietHasFreeMeals(pr);
  if (pr.complete) return free ? (pr.nMeals > 1 ? 'Repas prévus cochés' : 'Repas prévu coché') : 'Journée complète';
  if (free) return `${pr.nMeals > 1 ? 'Repas prévus cochés' : 'Repas prévu coché'} : ${pr.nDone} sur ${pr.nMeals}`;
  return `${pr.nDone} ${pr.nDone > 1 ? 'repas cochés' : 'repas coché'} sur ${pr.nMeals}`;
}

// Bilan du jour : anneau (calories) et trois barres (macros), mangé sur repère
function dietSummaryHtml(pr) {
  const { eaten, goal, own } = pr;
  const hide = data.dietHideNumbers === true;
  const ratio = dietRatio(eaten.kcal, goal.kcal);
  // Calories fixées mais pas cette macro : son total tiré du plan ne colle pas forcément aux calories fixées
  // (2 000 kcal pour des macros qui en font 1 535) : mangé seul, sans repère ni jauge
  const free = k => own.kcal && !own[k];
  const bars = DIET_MACROS.map(({ k, label }) => free(k) ? `
          <div class="diet-bar diet-bar--${k} diet-bar--free" role="img" aria-label="${label} : ${dietN(eaten[k])} grammes, pas d'objectif">
            <div class="diet-bar__head"><span class="diet-bar__label">${label}</span><span class="diet-bar__val num"><b>${dietN(eaten[k])}</b> g</span></div>
            <div class="diet-bar__sub">Pas d'objectif</div>
          </div>` : `
          <div class="diet-bar diet-bar--${k}" role="img" aria-label="${label} : ${dietN(eaten[k])} grammes sur ${dietN(goal[k])}">
            <div class="diet-bar__head"><span class="diet-bar__label">${label}</span><span class="diet-bar__val num"><b>${dietN(eaten[k])}</b> / ${dietN(goal[k])} g</span></div>
            <div class="diet-bar__track"><span class="diet-bar__fill" style="width:${(dietRatio(eaten[k], goal[k]) * 100).toFixed(1)}%"></span></div>
          </div>`).join('');
  const streak = data.dietStreakOff ? 0 : dietStreak(data);
  const n = pr.nMeals;   // repas à cocher (ceux qui ont des aliments)
  const status = `<span${pr.complete ? ' class="diet-sum__done"' : ''}>${pr.complete ? icon('checkmark', 14) : ''}${dietStatusText(pr)}</span>`;
  const line = `<p class="diet-sum__line">${status}${streak >= 2 ? `<span class="diet-sum__streak">${icon('flame', 14)}${streak} jours complets d'affilée</span>` : ''}</p>
        ${dietCallHtml(pr)}`;
  // Chiffres masqués (Réglages de la nutrition) : les repas cochés seulement
  if (hide) return `<section class="diet-sum diet-sum--plain${pr.complete ? ' diet-sum--complete' : ''}" aria-label="Bilan de la journée">${line}</section>`;
  return `
      <section class="diet-sum${pr.complete ? ' diet-sum--complete' : ''}" aria-label="Bilan de la journée">
        <div class="diet-sum__main">
          <div class="diet-sum__ring" role="img" aria-label="${dietN(eaten.kcal)} kilocalories sur ${dietN(goal.kcal)}">
            ${dietRingSvg(ratio)}
            <span class="diet-sum__kcal" aria-hidden="true"><b class="num">${dietN(eaten.kcal)}</b><span class="num">sur ${dietN(goal.kcal)} kcal</span></span>
          </div>
          <div class="diet-sum__bars">${bars}</div>
        </div>
        ${line}
        ${own.kcal || own.p || own.c || own.f ? '' : `<p class="diet-sum__hint">Repère : le total prévu par ton plan${Object.keys(pr.swaps).length ? ', remplacements du jour compris' : ''}.</p>`}
        ${dietLowKcal(pr.plan) ? dietLowNoteHtml(!!pr.plan.targets?.kcal) : ''}
      </section>`;
}

// Frise des 7 derniers jours : un toucher ouvre le jour (aujourd'hui : route sans paramètre). Panel vague 4 : elle
// reprenait les pastilles de « Cette semaine » de l'accueil (semaine du lundi, séances faites) pour un autre sens. Ici,
// un sélecteur de date comme le Calendrier d'iOS : la lettre et le numéro du jour, le jour choisi plein, et sous le
// numéro un petit point pour la journée (plein : complète, anneau : en partie).
function dietWeekHtml(day) {
  const today = dietDayKey();
  return `<div class="diet-week" role="group" aria-label="7 derniers jours">${dietWeek(data).map(w => {
    // Lettre seule comme le Calendrier d'iOS : le numéro dessous distingue mardi et mercredi (panel vague 4)
    const d = new Date(w.ts), letter = d.toLocaleDateString('fr-FR', { weekday: 'narrow' }).toUpperCase();
    const label = `${w.day === today ? 'Aujourd\'hui' : fmtDate(w.ts, 'day')}${w.complete ? ', journée complète' : w.some ? ', en partie' : ''}`;
    return `<button class="diet-week__day${w.day === day ? ' diet-week__day--on' : ''}" data-action="diet-day" data-day="${w.day}" aria-pressed="${w.day === day}" aria-label="${esc(label)}">
        <span class="diet-week__letter" aria-hidden="true">${letter}</span>
        <span class="diet-week__num num${w.day === today ? ' diet-week__num--today' : ''}" aria-hidden="true">${d.getDate()}</span>
        <span class="diet-week__dot${w.complete ? ' diet-week__dot--done' : w.some ? ' diet-week__dot--some' : ''}" aria-hidden="true"></span>
      </button>`;
  }).join('')}</div>`;
}

// Bouton rond à cocher : rond vide tant que le repas n'est pas coché, rond vert avec sa coche une fois coché, comme une
// série en séance (panel vague 4 : la coche dessinée d'office se lisait « déjà fait »). L'icône reste dans le bouton,
// invisible, pour l'animation qui la trace au moment de cocher. Un seul toucher, rien au pointerdown
// day null (carte de l'accueil) : le jour est lu au toucher, jamais figé à l'affichage (carte restée ouverte après minuit)
function dietCheckBtn(meal, done, day, extra = '') {
  return `<button class="diet-check${done ? ' diet-check--on' : ''}" data-action="diet-check" data-meal="${esc(meal.id)}"${day ? ` data-day="${day}"` : ''} aria-pressed="${done}"
      aria-label="${done ? `${esc(meal.name)} coché, décocher` : `Cocher ${esc(meal.name)}`}"${extra}>${icon('checkmark', 20)}</button>`;
}

// Aliment du plan : un toucher ouvre la feuille (remplacer, changer la quantité, retirer pour aujourd'hui).
// Retiré pour la journée : nom barré en gris, « Remettre » à droite (un toucher le remet)
// day '' : aujourd'hui, lu au toucher (écran resté ouvert après minuit)
function dietItemRowHtml(it, pr, day) {
  const when = !day || day === dietDayKey() ? 'aujourd\'hui' : 'ce jour';
  if (pr.removed?.includes(it.id)) return `
            <button class="diet-item diet-item--off" data-action="diet-restore" data-item="${esc(it.id)}" data-day="${day}"
              aria-label="${esc(foodName(it.name))}, retiré ${when}. Remettre">
              <span class="diet-item__body">
                <span class="diet-item__name">${esc(foodName(it.name))}</span>
                <span class="diet-item__sub num">Retiré ${when} · ${esc(dietQtyText(it))}</span>
              </span>
              <span class="diet-item__back">Remettre</span>
            </button>`;
  const swap = pr.swaps[it.id], eat = swap || it, m = dietItemMacros(eat), qty = dietIsQtyChange(it, swap);
  const nums = data.dietHideNumbers ? '' : ` · ${dietN(m.kcal)} kcal · P ${dietN(m.p)} · G ${dietN(m.c)} · L ${dietN(m.f)}`;
  const note = !swap ? '' : qty ? `Prévu : ${dietQtyText(it)}` : `Remplace ${foodName(it.name)}`;
  return `
            <button class="diet-item" data-action="diet-swap" data-item="${esc(it.id)}" data-day="${day}"
              aria-label="${esc(foodName(eat.name))}, ${esc(dietQtySpoken(eat))}${data.dietHideNumbers ? '' : `, ${dietN(m.kcal)} kilocalories`}${swap ? `, ${qty ? `prévu ${esc(dietQtySpoken(it))}` : `remplace ${esc(foodName(it.name))}`}` : ''}. Modifier">
              <span class="diet-item__body">
                <span class="diet-item__name">${esc(foodName(eat.name))}</span>
                <span class="diet-item__sub num">${note ? `<span class="diet-item__swapped">${esc(note)}</span>` : ''}${esc(dietQtyText(eat))}${nums}</span>
              </span>
              <span class="diet-item__swap" aria-hidden="true">${icon('arrow.left.arrow.right', 18)}</span>
            </button>`;
}

// Aliment ajouté pour la journée, hors plan : « Ajouté aujourd'hui » en couleur d'action ; ⋯ : quantité ou retirer
function dietExtraRowHtml(it, meal, day) {
  const m = dietItemMacros(it), when = !day || day === dietDayKey() ? 'aujourd\'hui' : 'ce jour';
  const nums = data.dietHideNumbers ? '' : ` · ${dietN(m.kcal)} kcal · P ${dietN(m.p)} · G ${dietN(m.c)} · L ${dietN(m.f)}`;
  return `
            <button class="diet-item diet-item--extra" data-action="diet-extra" data-meal="${esc(meal.id)}" data-extra="${esc(it.id)}" data-day="${day}"
              aria-label="${esc(foodName(it.name))}, ${esc(dietQtySpoken(it))}${data.dietHideNumbers ? '' : `, ${dietN(m.kcal)} kilocalories`}, ajouté ${when}, hors plan. Modifier">
              <span class="diet-item__body">
                <span class="diet-item__name">${esc(foodName(it.name))}</span>
                <span class="diet-item__sub num"><span class="diet-item__swapped">Ajouté ${when}</span>${esc(dietQtyText(it))}${nums}</span>
              </span>
              <span class="diet-item__swap" aria-hidden="true">${icon('ellipsis', 18)}</span>
            </button>`;
}

// Repas retiré pour la journée, ou repas d'un jour vide : une ligne pour reprendre ses aliments prévus, d'un toucher.
// Jour vide : « Copier le plan de ce repas » ; repas retiré : « Remettre le repas prévu ». Les aliments sont nommés dessous
function dietMealPlanRowHtml(x, day) {
  const { meal, off } = x;
  const names = meal.items.map(it => foodName(it.name)), kcal = dietMealMacros(meal).kcal;
  const label = off ? 'Remettre le repas prévu' : 'Copier le plan de ce repas';
  const when = !day || day === dietDayKey() ? 'aujourd\'hui' : 'ce jour';
  const sub = `${off ? `Retiré ${when} · ` : ''}${names.join(', ')}${data.dietHideNumbers ? '' : ` · ${dietN(kcal)}\u00a0kcal`}`;
  return `
            <button class="diet-item diet-item--plan" data-action="diet-meal-back" data-op="${off ? 'on' : 'copy'}" data-meal="${esc(meal.id)}" data-day="${day}"
              aria-label="${esc(label)} : ${esc(names.join(', '))}${data.dietHideNumbers ? '' : `, ${dietN(kcal)} kilocalories`}">
              <span class="diet-item__body">
                <span class="diet-item__name">${esc(label)}</span>
                <span class="diet-item__sub num">${esc(sub)}</span>
              </span>
            </button>`;
}

function dietMealHtml(x, pr, day) {
  const { meal, macros, done, extras = [], live = meal.items } = x;
  const isNext = pr.next?.meal.id === meal.id;
  const open = !done || dietOpenMeals.has(meal.id);
  const cleared = x.off || x.copyable;   // retiré pour la journée, ou repas d'un jour vide pas encore copié
  const when = !day || day === dietDayKey() ? 'aujourd\'hui' : 'ce jour';
  const emptyText = x.off ? `Retiré pour ${when}` : x.copyable ? 'Ajoute ce que tu manges' : 'Rien de prévu : ajoute ce que tu manges';
  // Titre : un repas coché se déplie au toucher ; pas coché, il est déjà ouvert (simple texte)
  const title = `${isNext ? '<span class="diet-meal__eyebrow">Ensuite</span>' : ''}
              <span class="diet-meal__name">${esc(meal.name)}</span>
              ${(cleared || !meal.items.length) && !extras.length ? `<span class="diet-meal__macros">${emptyText}</span>`
                : data.dietHideNumbers ? '' : `<span class="diet-meal__macros num"><span aria-hidden="true">${dietMacroLine(macros)}</span><span class="sr-text">${dietMacroSpoken(macros)}</span></span>`}`;
  // ⋯ : menu du repas (« Retirer ce repas pour aujourd'hui »), pour tout repas du plan pas encore retiré (jour vide
  // compris : un repas sauté ne bloque pas « Journée complète »)
  const menu = meal.items.length && !x.off ? `<button class="diet-meal__menu" data-action="diet-day-meal-menu" data-meal="${esc(meal.id)}" data-day="${day}" aria-label="Options de ${esc(meal.name)}">${icon('ellipsis', 20)}</button>` : '';
  return `
        <article class="diet-meal${done ? ' diet-meal--done' : ''}${isNext ? ' diet-meal--next' : ''}" data-meal="${esc(meal.id)}">
          <div class="diet-meal__head">
            ${done ? `<button class="diet-meal__title" data-action="diet-meal-open" data-meal="${esc(meal.id)}" aria-expanded="${open}">${title}<span class="diet-meal__more" aria-hidden="true">${icon('chevron.down', 14)}</span></button>`
              : `<div class="diet-meal__title">${title}</div>`}
            ${menu}${live.length ? dietCheckBtn(meal, done, day) : ''}
          </div>
          ${meal.note && open ? `<p class="diet-meal__note">${icon('info.circle', 14)}<span>${esc(meal.note)}</span></p>` : ''}
          ${open ? `<div class="diet-meal__items">${cleared ? dietMealPlanRowHtml(x, day) : meal.items.map(it => dietItemRowHtml(it, pr, day)).join('')}${extras.map(it => dietExtraRowHtml(it, meal, day)).join('')}
            <button class="diet-item diet-item--add" data-action="diet-day-add" data-meal="${esc(meal.id)}" data-day="${day}" aria-label="Ajouter un aliment à ${esc(meal.name)}">${icon('plus', 18)}<span class="diet-item__name">Ajouter un aliment</span></button></div>` : ''}
        </article>`;
}

// Carte d'un plan reçu de mon coach (écran Nutrition, Mon coach) : nom, repas, « Utiliser ce plan »
// Sans l'accord « recevoir les plans de mon coach » : invitation, sans rien du contenu du plan. « Recevoir » demande
// l'accord puis prend le plan d'un seul geste (panel vague 4 : « Accepter » puis « Utiliser », deux validations)
function dietInviteCardHtml(item) {
  const who = esc(coachName());
  return `
        <article class="coach-prog diet-inbox diet-invite">
          <div class="coach-prog__eyebrow">Plans diète</div>
          <h3 class="coach-prog__name">${who} veut t'envoyer un plan diète</h3>
          <p class="coach-prog__meta">Ton plan actuel reste dans Plans diète. Tu peux retirer ton accord quand tu veux.</p>
          <button class="btn btn--primary coach-prog__btn" data-action="diet-take" data-id="${esc(item.id)}">Recevoir</button>
        </article>`;
}
function dietInboxCardHtml(item) {
  if (!dietCoachAccepted()) return dietInviteCardHtml(item);
  const { status } = dietInboxStatus(item);
  const who = esc(coachName());
  if (item.tooNew) return `
        <article class="coach-prog diet-inbox">
          <div class="coach-prog__eyebrow">Plan diète ${elide('de', who)}</div>
          <h3 class="coach-prog__name">${esc(item.data.name)}</h3>
          <p class="coach-prog__meta">Mets l'app à jour pour recevoir ce plan.</p>
        </article>`;
  const eyebrow = status === 'update' ? `Mis à jour par ${who}` : status === 'new' ? `Nouveau plan diète ${elide('de', who)}` : `Reçu ${elide('de', who)}`;
  const total = item.meta ? null : dietPlanMacros(item.data);
  const btn = status === 'current' ? '<p class="coach-prog__done">C\'est ton plan</p>'
    : `<button class="btn btn--primary coach-prog__btn" data-action="diet-take" data-id="${esc(item.id)}">${status === 'update' ? 'Mettre à jour' : 'Utiliser ce plan'}</button>`;
  return `
        <article class="coach-prog diet-inbox">
          <div class="coach-prog__eyebrow">${eyebrow}${coachNewDotHtml(!item.seen)}</div>
          <h3 class="coach-prog__name">${esc(item.data.name)}</h3>
          ${item.meta ? '<p class="coach-prog__meta">Détail disponible avec du réseau.</p>'
            : `<p class="coach-prog__meta num">${plural(item.data.meals.length, 'repas', 'repas')} · ${dietN(total.kcal)} kcal par jour</p>`}
          ${item.data.consigne ? `<p class="coach-prog__consigne">${icon('info.circle', 14)}<span>${esc(item.data.consigne)}</span></p>` : ''}
          ${item.data.dropped ? `<p class="coach-prog__meta">${plural(item.data.dropped, 'aliment illisible ignoré', 'aliments illisibles ignorés')}.</p>` : ''}
          ${btn}
        </article>`;
}
// Mon coach : accord pour les plans diète (toujours visible, l'élève peut l'activer avant un envoi), puis
// les plans reçus (contenu seulement avec l'accord)
function dietInboxHtml() {
  const list = dietInbox(), on = dietCoachAccepted();
  return `<div class="group-title">Plans diète</div>
        <div class="group">
          <button class="cell" data-action="diet-coach-toggle" role="switch" aria-checked="${on}">
            <span class="cell__body"><span class="cell__title">Recevoir les plans diète ${elide('de', esc(coachName()))}</span>
              <span class="cell__sub">${on ? 'Gardés sur le serveur jusqu\'à ce que tu retires ton accord.' : 'Sans ton accord, ton coach ne peut pas t\'en envoyer.'}</span></span>
            ${switchHtml(on)}
          </button>
        </div>
        ${list.length ? `<div class="coach-progs">${(on ? list : list.slice(0, 1)).map(dietInboxCardHtml).join('')}</div>` : ''}`;
}

function dietEmptyHtml() {
  return `
        <div class="diet-empty">
          <span class="diet-empty__icon" aria-hidden="true">${icon('fork.knife', 34)}</span>
          <h2 class="diet-empty__title">Pas encore de plan diète</h2>
          <p class="diet-empty__sub">Ton coach peut t'en envoyer un. Tu peux aussi créer le tien : tes repas, tes aliments et leurs quantités, les macros se calculent seules.</p>
          <button class="btn btn--primary diet-empty__btn" data-action="diet-new-plan">Créer mon plan</button>
        </div>`;
}

// Source et licence (Licence Ouverte : source, version, date, pas d'aval de l'Anses ; ODbL : attribution d'Open Food Facts), précaution ; sur l'écran
// Nutrition, la ligne d'écoute des troubles alimentaires, toujours visible
function dietSourceFoot({ help = false } = {}) {
  return `<div class="diet-foot">
      <p class="group-foot">Source des valeurs : table Ciqual 2025 de l'Anses (version du 03/11/2025), doi.org/10.57745/RDMHWY, Licence Ouverte Etalab 2.0. Valeurs arrondies ; pour quelques aliments, l'énergie est calculée par l'app. L'Anses ne valide pas ces plans.</p>
      <p class="group-foot">Produits scannés : Open Food Facts (openfoodfacts.org), © les contributeurs d'Open Food Facts, base libre sous licence ODbL (Open Database License) ; valeurs à vérifier sur l'étiquette.</p>
      <p class="group-foot">Ces chiffres sont des repères pour suivre un plan, pas un avis médical ni diététique. Pour un régime lié à une maladie, une grossesse ou un trouble alimentaire, parles-en à un médecin ou à un diététicien.</p>
      ${help ? '<p class="group-foot diet-help">Si manger, compter ou te peser devient une source d\'angoisse, tu peux en parler : Anorexie Boulimie Info Écoute, 0810 037 037 (lundi, mardi, jeudi et vendredi, de 16 h à 18 h).</p>' : ''}
    </div>`;
}
// Objectif très bas : information, jamais un blocage (NICE NG246)
// own : objectif de calories fixé (« Cet objectif »), sinon total du plan (« Ce plan »)
function dietLowNoteHtml(own = true) {
  return `<p class="diet-low" role="note">${icon('info.circle', 14)}<span>${own ? 'Cet objectif' : 'Ce plan'} est très bas pour un adulte qui s'entraîne. Les recommandations de santé réservent les régimes sous 1 200 kcal par jour à un suivi médical. Tu peux en parler à un médecin ou à un diététicien.</span></p>`;
}
// Bas de l'écran Nutrition : réglages (repas du jour, chiffres, série, accord). Le choix des repas du jour y est dit
// (« Repas du jour : pré-remplis par le plan ») : on sait qu'il existe sans ouvrir les réglages
function dietSettingsCellHtml() {
  return `<div class="group group--gap"><button class="cell cell--nav" data-action="go-diet-settings">
      <span class="cell__body"><span class="cell__title">Réglages de la nutrition</span><span class="cell__sub">Repas du jour : ${data.dietEmptyDays ? 'vides, je note ce que je mange' : 'pré-remplis par le plan'}</span></span>${icon('chevron.right', 16)}</button></div>`;
}

function renderNutrition(dayParam) {
  const plan = dietActivePlan(data);
  const day = dietRouteDay(dayParam);
  const pending = account.user && myCoach() ? dietPending() : null;
  // « Mon plan » : le plan suivi, dont le retour dira « Nutrition » (panel vague 4 : « Plan » seul, et un écran titré
  // « Aujourd'hui » ouvert depuis la carte « Nutrition », faisaient trois noms pour un même endroit)
  const right = plan ? `<button class="navbar__text" data-action="diet-open-plan" data-id="${esc(data.dietActive)}">Mon plan</button>` : '';
  // Titre : la destination (Nutrition), comme la carte de l'accueil et le retour des écrans suivants ; le jour affiché
  // passe en tête de la ligne du plan, en gras
  const head = navBar({ title: 'Nutrition', large: true, right });
  if (!plan) {
    return `<div class="view view--grouped nutrition-view">${head}<div class="scr">
        ${pending ? `<div class="coach-progs">${dietInboxCardHtml(pending)}</div>` : ''}
        ${dietEmptyHtml()}${dietSettingsCellHtml()}${dietSourceFoot({ help: true })}</div></div>`;
  }
  const pr = dietDayProgress(data, data.dietActive, day);
  // Plan du coach : « envoyé par max » (« · de max » se lisait comme une quantité, panel Apple vague 4)
  const by = plan.fromCoach ? ` · envoyé par ${esc(plan.fromCoach.name || 'ton coach')}` : '';
  const from = `<p class="diet-plan-from"><b class="diet-plan-from__day">${esc(dietDayTitle(day))}</b> · ${esc(plan.name)}${by}</p>`;
  // Aujourd'hui : pas de jour figé dans les boutons, lu au toucher (écran resté ouvert après minuit)
  const past = day !== dietDayKey(), attrDay = past ? day : '';
  const meals = pr.meals.length ? pr.meals.map(x => dietMealHtml(x, pr, attrDay)).join('')
    : '<div class="empty-note">Ce plan n\'a aucun repas. Ajoute-les dans le plan.</div>';
  return `
    <div class="view view--grouped nutrition-view">
      ${head}
      <div class="scr">
        ${from}
        ${pending ? `<div class="coach-progs">${dietInboxCardHtml(pending)}</div>` : ''}
        ${dietWeekHtml(day)}
        ${past ? '<button class="btn btn--secondary diet-today" data-action="diet-today">Revenir à aujourd\'hui</button>' : ''}
        ${dietSummaryHtml(pr)}
        ${!data.dietHideNumbers && dietTargetGap(plan) ? `<p class="diet-gap" role="note">${icon('info.circle', 14)}<span>${esc(dietTargetGap(plan))}${plan.fromCoach
          ? ` Suis le plan de ${esc(plan.fromCoach.name || 'ton coach')} ; en cas de doute, demande-lui.` : ''}</span></p>` : ''}
        ${plan.consigne ? `<p class="coach-prog__consigne diet-consigne">${icon('info.circle', 14)}<span>${esc(plan.consigne)}</span></p>` : ''}
        <h2 class="group-title">Repas</h2>
        ${pr.meals.length ? dietMacroLegendHtml() : ''}
        <div class="diet-meals">${meals}</div>
        ${dietSettingsCellHtml()}
        ${dietSourceFoot({ help: true })}
      </div>
    </div>`;
}
SCREENS.set('nutrition', { render: day => renderNutrition(day), enter: () => { loadFoods(); dietMaybeAskConsent(); } });
function dietGoToday() {
  dietPick = null;
  if (currentView() === 'nutrition') navigate('nutrition', { replace: true });
}

// ── Accueil : carte du jour ─────────────────────────────────

function nutritionHomeCard() {
  const pending = account.user && myCoach() ? dietPending() : null;
  const ok = dietCoachAccepted();   // sans accord : invitation, rien du plan (ni son nom)
  const card = pending ? `
    <section class="home-card account-card coach-home" aria-labelledby="dietPendingTitle">
      <div class="account-card__text">
        <h2 class="account-card__title" id="dietPendingTitle">${!ok ? `${esc(coachName())} veut t'envoyer un plan diète` : dietInboxStatus(pending).status === 'update' ? `Plan diète mis à jour par ${esc(coachName())}` : `Nouveau plan diète ${elide('de', esc(coachName()))}`}</h2>
        <p class="account-card__sub">${ok ? esc(pending.data.name) : 'Ton plan actuel reste dans Plans diète'}</p>
      </div>
      <button class="account-card__btn" data-action="diet-take" data-id="${esc(pending.id)}">${ok ? 'Utiliser' : 'Recevoir'}</button>
      <button class="account-card__close" data-action="diet-dismiss" data-id="${esc(pending.id)}" aria-label="Plus tard">${icon('xmark', 16)}</button>
    </section>` : '';
  const plan = dietActivePlan(data);
  if (!plan) return card;
  const day = dietDayKey(), pr = dietDayProgress(data, data.dietActive, day);
  // Plan sans aucun aliment et rien de noté : rien à suivre aujourd'hui (pas de « 0 sur 0 kcal »). Jour vide ou repas
  // retirés : la carte reste (le repère du plan, ce qu'on a noté)
  if (!pr.meals.some(x => x.meal.items.length || x.extras.length)) return card;
  const next = pr.next;
  const hide = data.dietHideNumbers === true;
  const head = hide ? (pr.nMeals ? `${pr.nDone} sur ${plural(pr.nMeals, 'repas', 'repas')}` : esc(dietStatusText(pr))) : `<b>${dietN(pr.eaten.kcal)}</b> sur ${dietN(pr.goal.kcal)} kcal`;
  // Tous les repas du jour (vague 4) : nom, kcal, coché ou non ; le prochain porte le bouton à cocher (un toucher).
  // Plus de 4 repas : 3 autour du prochain et « et 2 autres ». Le reste de la carte ouvre Nutrition
  const { shown, more } = dietHomeMeals(pr);
  // Repas sans aliment prévu ni noté (jour vide) : pas de « 0 kcal »
  const kcalOf = x => (hide || (!x.live.length && !x.extras.length) ? '' : `<span class="diet-home__mkcal num">${dietN(x.macros.kcal)}\u00a0kcal</span>`);
  const rows = shown.map(x => {
    const isNext = next?.meal.id === x.meal.id;
    const state = x.done ? 'done' : isNext ? 'next' : 'todo';
    return `
        <div class="diet-home__meal diet-home__meal--${state}" data-meal="${esc(x.meal.id)}">
          <span class="diet-home__mtext" aria-hidden="true"><span class="diet-home__mname">${esc(x.meal.name)}</span>${kcalOf(x)}</span>
          <span class="diet-home__mstate">${x.done ? `<span class="diet-home__done" aria-hidden="true">${icon('checkmark', 12)}</span>` : isNext ? dietCheckBtn(x.meal, false, null) : ''}</span>
        </div>`;
  }).join('');
  const moreText = more ? `et ${more} ${more > 1 ? 'autres' : 'autre'}` : '';
  // VoiceOver : le bouton du haut dit tout (plan, calories, chaque repas) ; les lignes sont cachées, sauf le bouton à cocher
  const spokenMeals = pr.meals.filter(x => x.meal.items.length || x.extras.length)
    .map(x => `${x.meal.name}${x.done ? ' coché' : next?.meal.id === x.meal.id ? ' ensuite' : ''}${hide || (!x.live.length && !x.extras.length) ? '' : `, ${dietN(x.macros.kcal)} kilocalories`}`).join(' ; ');
  const spoken = `Nutrition, ${plan.name} : ${hide ? (pr.nMeals ? `${pr.nDone} repas cochés sur ${pr.nMeals}` : dietStatusText(pr)) : `${dietN(pr.eaten.kcal)} kilocalories sur ${dietN(pr.goal.kcal)}`}${pr.complete ? `, ${dietStatusText(pr).toLowerCase()}` : ''}. ${spokenMeals}. Ouvrir`;
  return `${card}
    <section class="home-card diet-home${pr.complete ? ' diet-home--complete' : ''}">
      <button class="diet-home__open" data-action="go-nutrition" aria-label="${esc(spoken)}">
        <span class="diet-home__ring" aria-hidden="true">${dietRingSvg(hide ? pr.nDone / Math.max(1, pr.nMeals) : dietRatio(pr.eaten.kcal, pr.goal.kcal), 44, 6)}</span>
        <span class="diet-home__text" aria-hidden="true">
          <span class="diet-home__title"><span class="home-card__title">Nutrition</span><span class="diet-home__plan">${esc(plan.name)}</span></span>
          <span class="diet-home__kcal num">${head}</span>
          ${pr.complete ? `<span class="diet-home__next">${icon('checkmark', 12)}${dietStatusText(pr)}</span>` : ''}
        </span>
      </button>
      <div class="diet-home__meals" data-action="go-nutrition">${rows}
        ${moreText ? `<div class="diet-home__more" aria-hidden="true">${moreText}</div>` : ''}
      </div>
    </section>`;
}

// ── Programme : entrée des plans ────────────────────────────

function dietProgrammeGroupHtml() {
  const plan = dietActivePlan(data);
  return `
        <div class="group-title">Nutrition</div>
        <div class="group">
          <button class="cell cell--nav" data-action="go-diet-plans">
            <span class="cell__body"><span class="cell__title">Plans diète</span>
              <span class="cell__sub">Repas, aliments et quantités ; macros calculées</span></span>
            <span class="cell__value">${plan ? esc(plan.name) : 'Aucun'}</span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

// ── Coach : plan diète d'un élève ───────────────────────────

function coachDietGroupHtml(uid) {
  const sent = coachDietSentStatus(uid);
  return `
        <div class="group">
          <button class="cell cell--action" data-action="coach-send-diet" data-uid="${esc(uid)}">${icon('paperplane', 20)}<span>Envoyer un plan diète</span></button>
          ${sent.map(x => `
          <div class="cell coach-sent" data-diet="${esc(x.id)}"><span class="cell__body"><span class="cell__title">${esc(x.name)}</span><span class="cell__sub">Envoyé le ${esc(fmtDate(x.sentAt, 'short'))}${x.gone ? ' · supprimé de tes plans' : ''}</span><span class="cell__sub coach-sent__state coach-sent__state--${x.seen ? 'used' : 'unseen'}">${x.seen ? 'Vu' : 'Pas encore ouvert'}</span></span></div>`).join('')}
        </div>`;
}

// ── Remplacer un aliment pour la journée ────────────────────

async function dietSwapSheet(itemId, day) {
  const planId = data.dietActive, plan = dietActivePlan(data);
  const it = plan?.meals.flatMap(m => m.items).find(x => x.id === itemId);
  if (!it) return;
  await loadFoods();
  const e = dietDay(data, planId, day), cur = e.swaps[itemId], current = dietIsQtyChange(it, cur) ? null : cur, eat = cur || it;
  const cands = swapCandidates(it, { own: data.dietFoods || [] });
  const ref = dietItemMacros(it), hide = data.dietHideNumbers === true;
  // Écart des kcal affichées (arrondies), pas des valeurs exactes : 213 kcal face à 215 se lit moins 2 kcal, comme on le
  // calcule de tête (panel t5)
  const shownGap = c => -Math.round(ref.kcal) + Math.round(c.macros.kcal);
  const row = (c, i) => `
      <button class="diet-cand" data-swap="${i}">
        <span class="diet-cand__body"><span class="diet-cand__name">${esc(foodName(c.food.name))}</span>
          <span class="diet-cand__sub num">${hide ? `${c.g} g` : dietSrPair(`${c.g} g · ${dietMacroLine(c.macros)}`, `${c.g} grammes, ${dietMacroSpoken(c.macros)}`)}</span></span>
        ${hide ? '' : `<span class="diet-cand__delta num" aria-label="écart : ${swapDeltaText(shownGap(c), 'kilocalories')}">${swapDeltaText(shownGap(c), 'kcal')}</span>`}
      </button>`;
  const body = `
    <div class="diet-swap">
      <p class="diet-swap__orig"><b>${esc(foodName(it.name))}</b><span class="num">${hide ? esc(dietQtyText(it)) : dietSrPair(`${esc(dietQtyText(it))} · ${dietMacroLine(ref)}`, `${esc(dietQtySpoken(it))}, ${dietMacroSpoken(ref)}`)}</span></p>
      <p class="diet-swap__rule">${swapRuleText(it)}, macros proches, même famille d'aliments.</p>
      ${dietMacroLegendHtml()}
      ${current ? `<button class="diet-cand diet-cand--back" data-swap="back"><span class="diet-cand__body"><span class="diet-cand__name">Remettre ${esc(foodName(it.name))}</span><span class="diet-cand__sub">Aujourd'hui, tu manges ${esc(foodName(current.name))}</span></span>${icon('arrow.clockwise', 18)}</button>` : ''}
      ${cands.length ? `<div class="diet-cands">${cands.map(row).join('')}</div>`
        : `<p class="diet-swap__none">${foodDb ? 'Aucun équivalent assez proche dans la base pour cet aliment.' : 'Base d\'aliments indisponible pour l\'instant.'}</p>`}
      <div class="diet-swap__acts">
        <button class="diet-cand" data-swap="qty"><span class="diet-cand__body"><span class="diet-cand__name">Changer la quantité</span><span class="diet-cand__sub num">${esc(dietQtyText(eat))}</span></span></button>
        <button class="diet-cand diet-cand--off" data-swap="off"><span class="diet-cand__body"><span class="diet-cand__name">Retirer pour ${day === dietDayKey() ? 'aujourd\'hui' : 'ce jour'}</span></span></button>
      </div>
      <p class="diet-swap__foot">Seulement pour ${day === dietDayKey() ? 'aujourd\'hui' : 'ce jour'} : ton plan ne change pas.</p>
    </div>`;
  const p = sheet({ title: 'Remplacer', cancel: 'Annuler', confirm: '', body });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  root?.addEventListener('click', ev => { const b = ev.target.closest('[data-swap]'); if (b) root._close(b.dataset.swap); });
  const choice = await p;
  if (choice == null) return;
  if (choice === 'qty') {
    const q = await dietAskQty(eat, eat);
    if (!q || !dietSetPlanQty(data, planId, itemId, q, day)) return;
    save(); haptic(); render(); announce(`${foodName(eat.name)} : ${dietQtySpoken(q)}`);
    return;
  }
  if (choice === 'off') { dietRemovePlanItem(planId, it, day); return; }
  if (choice === 'back') { dietSetSwap(data, planId, itemId, null, day); showToast(`${foodName(it.name)} remis`); }
  else {
    const c = cands[Number(choice)];
    if (!c) return;
    const prev = cur || null;
    dietSetSwap(data, planId, itemId, { name: c.food.name, food: c.food.code, fam: c.food.fam, g: c.g, per: c.food.per }, day);
    // Annuler, comme « Retirer pour aujourd'hui » (panel Apple vague 4 : le remplacement changeait les totaux sans retour)
    showToast(`Remplacé par ${foodName(c.food.name)}`, { action: 'Annuler', duration: 5000, onAction: () => {
      dietSetSwap(data, planId, itemId, prev, day); save(); render(); announce(`Remis : ${foodName((prev || it).name)}`);
    } });
  }
  haptic();
  save();
  render();
}

// Retirer pour la journée : la ligne reste, barrée, avec « Remettre » ; Annuler dans le toast
function dietRemovePlanItem(planId, it, day) {
  dietSetRemoved(data, planId, it.id, true, day);
  save(); haptic('light'); render();
  showToast(`Retiré pour ${day === dietDayKey() ? 'aujourd\'hui' : 'ce jour'} : ${foodName(it.name)}`, { action: 'Annuler', duration: 5000, onAction: () => {
    dietSetRemoved(data, planId, it.id, false, day); save(); render(); announce(`Remis : ${foodName(it.name)}`);
  } });
}

// ── Actions ─────────────────────────────────────────────────

registerActions({
  'go-nutrition': () => navigate('nutrition'),
  'diet-day': (e, el) => {
    const day = el.dataset.day, today = dietDayKey();
    dietPick = day === today ? null : { day, today, at: Date.now() };
    const route = day === dietDayKey() ? 'nutrition' : makeRoute('nutrition', day);
    navigate(route, { replace: routeName(currentRoute()) === 'nutrition' });
  },
  // Cocher : un seul toucher, retour haptique ; journée complète : petit son de réussite
  'diet-check': (e, el) => {
    const planId = data.dietActive;
    if (!planId) return;
    const day = el.dataset.day || dietDayKey(), meal = el.dataset.meal;
    const on = dietToggleMeal(data, planId, meal, day);
    if (!on) dietOpenMeals.delete(meal);
    save();
    const pr = dietDayProgress(data, planId, day);
    haptic(on ? (pr.complete ? 'success' : 'medium') : 'light');
    if (on && pr.complete) { try { validationSound(); } catch {} }   // pas de toast : il couvrait la carte du repas ; « Journée complète » s'affiche déjà en haut, avec le son
    render();
    if (on) { announce(pr.complete ? dietStatusText(pr) : `Coché. ${pr.next ? `Ensuite : ${pr.next.meal.name}` : ''}`); return; }
    // Décoché par erreur : Annuler le recoche (le toast l'annonce à VoiceOver, « Annuler disponible »)
    const name = pr.meals.find(x => x.meal.id === meal)?.meal.name || 'Repas';
    showToast(`Décoché : ${name}`, { action: 'Annuler', duration: 5000, onAction: () => {
      if (!dietDay(data, planId, day).done.includes(meal)) dietToggleMeal(data, planId, meal, day);
      save(); render(); announce(`Recoché : ${name}`);
    } });
  },
  // ⋯ d'un repas : « Retirer ce repas pour aujourd'hui » (ses aliments prévus, sa coche et ses ajouts : pas mangés),
  // Annuler dans le toast (ne défait que le retrait) ; la ligne « Remettre le repas prévu » le remet. Le plan ne change pas
  'diet-day-meal-menu': async (e, el) => {
    const planId = data.dietActive, day = el.dataset.day || dietDayKey(), mealId = el.dataset.meal;
    const meal = dietActivePlan(data)?.meals.find(m => m.id === mealId);
    if (!meal) return;
    const when = day === dietDayKey() ? 'aujourd\'hui' : 'ce jour';
    const v = await dialog({ type: 'sheet', title: meal.name, message: `Seulement pour ${when} : ton plan ne change pas.`,
      actions: [{ label: `Retirer ce repas pour ${when}`, value: 'off', style: 'destructive' }, { label: 'Annuler', style: 'cancel' }] });
    if (v !== 'off') return;
    const gone = dietSetMealOff(data, planId, mealId, day);
    if (!gone) return;
    dietOpenMeals.delete(mealId);
    save(); haptic('light'); render();
    showToast(`Retiré pour ${when} : ${meal.name}`, { action: 'Annuler', duration: 6000, onAction: () => {
      dietUndoMealOff(data, planId, mealId, gone, day); save(); render(); announce(`Remis : ${meal.name}`);
    } });
  },
  // Repas retiré : « Remettre le repas prévu » ; jour vide : « Copier le plan de ce repas ». Un toucher, à cocher ensuite
  'diet-meal-back': (e, el) => {
    const planId = data.dietActive, day = el.dataset.day || dietDayKey(), mealId = el.dataset.meal;
    const meal = dietActivePlan(data)?.meals.find(m => m.id === mealId);
    const ok = meal && (el.dataset.op === 'copy' ? dietCopyMealPlan(data, planId, mealId, day) : dietSetMealOn(data, planId, mealId, day));
    if (!ok) return;
    save(); haptic(); render(); announce(`${meal.name} : plan du repas remis, à cocher une fois mangé`);
  },
  'diet-meal-open': (e, el) => {
    const id = el.dataset.meal;
    if (dietOpenMeals.has(id)) dietOpenMeals.delete(id); else dietOpenMeals.add(id);
    render();
  },
  'diet-swap': async (e, el) => { await dietSwapSheet(el.dataset.item, el.dataset.day || dietDayKey()); },
  'diet-today': () => { dietGoToday(); announce('Aujourd\'hui'); },
  'diet-restore': (e, el) => {
    const planId = data.dietActive, day = el.dataset.day || dietDayKey();
    const it = dietActivePlan(data)?.meals.flatMap(m => m.items).find(x => x.id === el.dataset.item);
    if (!it) return;
    dietSetRemoved(data, planId, it.id, false, day);
    save(); haptic(); render(); announce(`Remis : ${foodName(it.name)}`);
  },
  // Ajouter un aliment à un repas pour la journée (recherche, code-barres ou création), coché ou non : il reste
  // dans son état, ses totaux et ceux du jour se recalculent ; le plan ne change pas
  'diet-day-add': async (e, el) => {
    const planId = data.dietActive, day = el.dataset.day || dietDayKey(), mealId = el.dataset.meal;
    const meal = dietActivePlan(data)?.meals.find(m => m.id === mealId);
    if (!meal) return;
    if ((dietDay(data, planId, day).extras[mealId] || []).length >= DIET_ITEM_MAX) { showToast(`${DIET_ITEM_MAX} ajouts au plus par repas`, { error: true }); return; }
    const pick = await dietChooseFood();
    const it = pick && foodToItem(pick.food, pick.g, pick.por);
    if (!it) return;
    const added = dietAddExtra(data, planId, mealId, it, day);
    if (!added) return;
    dietOpenMeals.add(mealId);
    save();
    haptic();
    render();
    showToast(day === dietDayKey() ? `Ajouté à ${meal.name} : ${added.name}` : `Ajouté ${dietPastWord(day)} · ${meal.name}`, { action: 'Annuler', duration: 5000, onAction: () => {
      dietSetExtra(data, planId, mealId, added.id, null, day); save(); render(); announce(`Retiré : ${added.name}`);
    } });
  },
  'diet-extra': async (e, el) => {
    const planId = data.dietActive, day = el.dataset.day || dietDayKey(), mealId = el.dataset.meal;
    const it = (dietDay(data, planId, day).extras[mealId] || []).find(x => x.id === el.dataset.extra);
    if (!it) return;
    const choice = await dialog({ type: 'sheet', title: foodName(it.name), message: `${dietQtyText(it)}, ajouté pour ${day === dietDayKey() ? 'aujourd\'hui' : 'ce jour'} : ton plan ne change pas.`,
      actions: [{ label: 'Changer la quantité', value: 'g' }, { label: 'Retirer', value: 'del', style: 'destructive' }, { label: 'Annuler', style: 'cancel' }] });
    if (choice === 'g') {
      const q = await dietAskQty(it, it);
      if (!q || !dietSetExtra(data, planId, mealId, it.id, q, day)) return;
      save(); haptic(); render(); announce(`${foodName(it.name)} : ${dietQtySpoken(q)}`);
    } else if (choice === 'del') {
      const before = { g: it.g, por: it.por };
      dietSetExtra(data, planId, mealId, it.id, null, day);
      save(); haptic('light'); render();
      showToast(`Retiré : ${foodName(it.name)}`, { action: 'Annuler', duration: 5000, onAction: () => {
        dietAddExtra(data, planId, mealId, { ...it, ...before }, day); save(); render();
      } });
    }
  },
  'diet-take': async (e, el) => {
    const item = dietInbox().find(x => x.id === el.dataset.id);
    if (!item) return;
    if (item.meta) {
      // Gardé hors ligne : nom seul ; relu sur le serveur avant de le prendre
      await coachRefresh();
      const fresh = dietInbox().find(x => x.id === item.id);
      if (!fresh || fresh.meta) { showToast(coachErrorText('offline'), { error: true }); return; }
    }
    // Donnée de santé : le plan du coach n'est reçu qu'avec l'accord de l'élève (« Recevoir les plans diète »)
    // Accord demandé ici même : le plan est pris dans la foulée, sans « Touche Utiliser » (un seul geste)
    if (!dietCoachAccepted() && !(await dietAskCoachAccept({ quiet: true }))) return;
    if (item.tooNew) { showToast('Mets l\'app à jour pour recevoir ce plan.'); return; }
    const it = dietInbox().find(x => x.id === item.id);
    const id = importCoachDiet(data, it, myCoach());
    if (!id) { showToast(coachErrorText('server'), { error: true }); return; }
    save();
    haptic();
    coachMarkInboxSeen('programme', it.id);
    const before = Object.keys(data.dietPlans || {}).length > 1;
    showToast(before ? `Plan en cours : ${it.data.name}. L'ancien reste dans Plans diète` : `Plan en cours : ${it.data.name}`);
    render();
  },
  'diet-dismiss': (e, el) => { coachMarkInboxSeen('programme', el.dataset.id); render(); showToast('Il reste dans Social › Mon coach'); },
  'coach-send-diet': async (e, el) => {
    const uid = el.dataset.uid, ids = coachSendableDiets();
    if (!ids.length) {
      const go = await dialog({ title: 'Aucun plan à envoyer', message: 'Crée d\'abord un plan diète avec au moins un aliment, dans Programme › Plans diète.',
        actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Créer un plan', value: true, style: 'preferred' }] });
      if (go === true) switchToDietPlans();
      return;
    }
    const who = personName(coachStudent(uid));
    const planId = await dialog({ type: 'sheet', title: 'Envoyer un plan diète', message: `Choisis un de tes plans pour ${who}. Un nouvel envoi du même plan le met à jour chez ${who}.`,
      actions: [...ids.map(id => ({ label: data.dietPlans[id].name, value: id })), { label: 'Annuler', style: 'cancel' }] });
    if (!planId) return;
    // Relecture avant l'envoi, comme un programme (écran Envoyer, bouton « Envoyer à … ») : un plan diète
    // touche à la santé de l'élève, jamais envoyé au premier toucher (panel du 07/11)
    const plan = data.dietPlans[planId];
    // Texte court, unités abrégées comme à l'écran, l'écart avec l'objectif en premier (panel t5 : la phrase VoiceOver
    // « 2 000 kilocalories, 150 grammes » s'affichait telle quelle, à côté de « 575 kcal »)
    // ; l'élève voit le même écart sous le plan, dans sa Nutrition du jour : dit au coach (panel t7)
    // Une ligne (panel v4 t1 : sept lignes de chiffres, on ne savait pas si c'était une erreur) : repas et kcal prévues,
    // l'objectif et l'écart entre parenthèses ; l'écart se lit comme une information, pas un blocage
    const meals = plural(plan.meals.filter(m => m.items.length).length, 'repas', 'repas');
    const kcal = Math.round(dietPlanMacros(plan).kcal), goal = Math.round(Number(plan.targets?.kcal) || 0);
    const diff = Math.max(kcal, goal) + -Math.min(kcal, goal), gap = goal && diff > goal * 0.1 ? ' (' + (kcal < goal ? '−' : '+') + dietN(diff) + ')' : '';
    const ok = await dialog({ title: `Envoyer « ${plan.name} » à\u00a0${who}\u00a0?`,
      message: goal ? `${meals} · ${dietN(kcal)} kcal prévues pour ${dietN(goal)} visées${gap}.`
        : `${meals} · ${dietN(kcal)} kcal prévues, sans objectif du jour.`,
      actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Envoyer', value: true, style: 'preferred' }] });
    if (ok !== true) return;
    el.disabled = true;
    const r = await coachSendDiet(uid, planId);
    el.disabled = false;
    if (coachToast(r, `Plan envoyé à ${who}`, { inline: true })) { haptic(); coachRefresh(); }   // « Envoyé le … » sous le plan
  },
});

// Programme › Plans diète depuis un autre onglet (fiche d'un élève)
function switchToDietPlans() {
  switchTab('program', { reset: true });
  navigate('diet-plans');
}
