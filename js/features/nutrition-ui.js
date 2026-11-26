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
  { k: 'p', label: 'Protéines', short: 'Prot.' },
  { k: 'c', label: 'Glucides', short: 'Gluc.' },
  { k: 'f', label: 'Lipides', short: 'Lip.' },
];

const dietN = v => fmtNum(Math.round(v));
// foodName (« Oeuf dur » → « Œuf dur » à l'écran) : js/data/food-swap.js, partagé avec l'appli web du coach
const elideName = n => (n.length > 60 ? n.slice(0, 58) + '…' : n);
// Macros abrégées des petits espaces : « Prot. 45 · Gluc. 70 · Lip. 15 » (avant le 17/11, « P 45 · G 70 · L 15 » : des
// lettres seules qu'un débutant ne lisait pas, regard neuf du 16/11). Abréviation et chiffre insécables (le « 1 » ne
// passe jamais seul à la ligne, panel t6). unit : « \u00a0g » après chaque nombre ; fmt : arrondi (dietN) ou décimales
function dietMacroAbbr(m, { fmt = dietN, unit = '' } = {}) {
  return DIET_MACROS.map(x => `${x.short}\u00a0${fmt(m[x.k])}${unit}`).join(' · ');
}
// « 620 kcal · Prot. 45 · Gluc. 70 · Lip. 15 » et sa version dite par VoiceOver
function dietMacroLine(m) { return `${dietN(m.kcal)}\u00a0kcal · ${dietMacroAbbr(m)}`; }
function dietMacroSpoken(m) { return `${dietN(m.kcal)} kilocalories, ${dietMacroGramsSpoken(m)}`; }
function dietMacroGramsSpoken(m) { return `${dietN(m.p)} grammes de protéines, ${dietN(m.c)} de glucides, ${dietN(m.f)} de lipides`; }
// Ligne abrégée à l'écran (« Prot. 4 · Gluc. 47 »), dite en toutes lettres par VoiceOver (sinon « P 4 g » lettre par lettre)
function dietSrPair(visible, spoken) { return `<span aria-hidden="true">${visible}</span><span class="sr-text">${spoken}</span>`; }
// ── Visuels qui portent du sens (refonte illustrée, comme l'accueil) ──
// Icône de la famille d'un aliment (famille d'équivalence de la table Ciqual, scripts/prepare-foods.py) : viande, féculent,
// laitier, matière grasse, fruit, légume, sucré, boisson, plat composé, aide culinaire. Un seul gris : l'icône dit « quoi »,
// jamais un état. Aliment perso ou scanné : famille tirée de ses macros (dietFamOf). Cachée à VoiceOver (le nom suffit)
function dietFoodFam(it) { return DIET_FAMS.includes(it?.fam) ? it.fam : it?.per ? dietFamOf(it.per) : 'a'; }
function dietFoodIconHtml(it, extra = '') {
  const cls = extra ? 'diet-ico ' + extra : 'diet-ico';
  return '<span class="' + cls + '" aria-hidden="true">' + icon('food.' + dietFoodFam(it), 20) + '</span>';
}
// Même pastille pour une action de la liste (ajouter, copier le plan, reprendre) : l'icône de l'action, en couleur d'action
function dietActIconHtml(name) { return '<span class="diet-ico diet-ico--act" aria-hidden="true">' + icon(name, 18) + '</span>'; }
// Part des calories venant des protéines, glucides et lipides (4, 4 et 9 kcal par gramme) : barre fine en trois
// segments, aux couleurs des macros du bilan (légende : les noms du bilan et la légende des lettres). Cachée à VoiceOver :
// les grammes sont déjà dits. Rien sans calories ou chiffres masqués
function dietMixHtml(m, extra = '') {
  const e = { p: 4 * (m.p || 0), c: 4 * (m.c || 0), f: 9 * (m.f || 0) }, t = e.p + e.c + e.f;
  if (!(t > 0) || data.dietHideNumbers === true) return '';
  const segs = DIET_MACROS.filter(({ k }) => e[k] > 0)
    .map(({ k }) => '<span class="diet-mix__seg diet-mix__seg--' + k + '" style="flex-grow:' + (e[k] / t * 100).toFixed(1) + '"></span>');
  return '<span class="diet-mix' + (extra ? ' ' + extra : '') + '" aria-hidden="true">' + segs.join('') + '</span>';
}
// Texte d'un dialogue (message lu tel quel) : en toutes lettres pour tous, « 4 g de protéines, 47 g de glucides… »
function dietMacroWords(m, fmt = dietN) { return `${fmt(m.p)} g de protéines, ${fmt(m.c)} g de glucides, ${fmt(m.f)} g de lipides`; }
// Légende des couleurs, une fois par écran ou par feuille, au-dessus de la première ligne de macros : la pastille de
// chaque macro et son nom (« ● Protéines · ● Glucides · ● Lipides »). Avant le 17/11 elle expliquait aussi les lettres
// (« P protéines ») ; les lignes disent désormais « Prot. », « Gluc. », « Lip. » (dietMacroAbbr). Cachée à VoiceOver :
// chaque ligne y est déjà dite en toutes lettres. Rien quand les chiffres sont masqués. Pastilles de couleur partout
// (recherche, remplacer, fiche scannée, Mon plan, journal) : la même couleur dit la même macro sur tous les écrans
// (panel nutri-v2) ; dots: false pour un texte sans couleur
function dietMacroLegendHtml(extra = '', { dots = true } = {}) {
  if (data.dietHideNumbers === true) return '';
  const dot = k => (dots ? '<i class="diet-dot diet-dot--' + k + '"></i>' : '');
  // « · » collé au mot d'avant par une espace insécable : jamais seul en début de ligne (« Glucides ·Lipides », 26/11)
  return `<p class="diet-legend${extra ? ` ${extra}` : ''}" aria-hidden="true">${DIET_MACROS.map(m => `<span class="diet-legend__k">${dot(m.k)}${m.label}</span>`).join('\u00a0· ')}</p>`;
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
// Bandeau « … · Annuler » d'une action de la Nutrition (aliment remplacé, verre d'eau, sel) : retiré dès le geste suivant
// sur l'écran ou dans une de ses feuilles (juges du 26/11 : « Remplacé par Riz blanc » restait affiché pendant l'ajout de
// l'eau et cachait « Bouteille », « 1 L » et la ligne Protéines). Capture : retiré avant l'action, qui peut poser le sien
document.addEventListener?.('click', e => {
  const b = e.target.closest?.('button, [data-action]');
  if (!b || b.closest('.toast') || typeof currentView !== 'function' || currentView() !== 'nutrition') return;
  document.querySelectorAll('.toast--action').forEach(removeToast);
}, true);
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
  if (!pr.plan.fromCoach && dietProgressFinished(pr)) return 'Objectif de calories atteint';
  // Rien à cocher (jour vide, repas tous retirés) : ce qu'on a noté, sans « 0 sur 0 »
  if (!pr.nMeals) { const n = dietNotedCount(pr); return n ? plural(n, 'aliment noté', 'aliments notés') : 'Rien de noté pour l\'instant'; }
  // Jour vide : un repas est fait dès qu'on y a noté un aliment (ou coché son plan copié)
  // Plan perso : « fini » seulement à l'objectif de calories (dietProgressFinished), sinon un simple compte
  if (!pr.plan.fromCoach) {
    // Jour vide : « 1 repas noté » (« sur 1 » à côté de quatre repas affichés prêtait à confusion, panel du 16/11)
    if (pr.blank) return pr.nDone ? `${pr.nDone} ${pr.nDone > 1 ? 'repas notés' : 'repas noté'}` : 'Rien de noté pour l\'instant';
    return `${pr.nDone} ${pr.nDone > 1 ? 'repas cochés' : 'repas coché'} sur ${pr.nMeals}`;
  }
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
  // Sans repère (plan neuf, aucun objectif ni aliment prévu) : pas de « 0 sur 0 » (26/11), le mangé seul
  const noGoal = !(goal.kcal > 0);
  const free = k => (own.kcal && !own[k]) || !(goal[k] > 0);
  const bars = DIET_MACROS.map(({ k, label }) => free(k) ? `
          <div class="diet-bar diet-bar--${k} diet-bar--free" role="img" aria-label="${label} : ${dietN(eaten[k])} grammes, pas d'objectif">
            <div class="diet-bar__head"><span class="diet-bar__label"><i class="diet-dot diet-dot--${k}"></i>${label}</span><span class="diet-bar__val num"><b>${dietN(eaten[k])}</b> g</span></div>
            <div class="diet-bar__sub">Pas d'objectif</div>
          </div>` : `
          <div class="diet-bar diet-bar--${k}" role="img" aria-label="${label} : ${dietN(eaten[k])} grammes sur ${dietN(goal[k])}">
            <div class="diet-bar__head"><span class="diet-bar__label"><i class="diet-dot diet-dot--${k}"></i>${label}</span><span class="diet-bar__val num"><b>${dietN(eaten[k])}</b> / ${dietN(goal[k])} g</span></div>
            <div class="diet-bar__track"><span class="diet-bar__fill" style="width:${(dietRatio(eaten[k], goal[k]) * 100).toFixed(1)}%"></span></div>
          </div>`).join('');
  const streak = data.dietStreakOff ? 0 : dietFinishedStreak(data);
  const n = pr.nMeals;   // repas à cocher (ceux qui ont des aliments)
  const fin = dietProgressFinished(pr);
  const status = `<span${fin ? ' class="diet-sum__done"' : ''}>${fin ? icon('checkmark', 14) : ''}${dietStatusText(pr)}</span>`;
  const line = `<p class="diet-sum__line">${status}${streak >= 2 ? `<span class="diet-sum__streak">${icon('flame', 14)}${streak} jours complets d'affilée</span>` : ''}</p>
        ${dietCallHtml(pr)}`;
  // Chiffres masqués (Réglages de la nutrition) : les repas cochés seulement
  if (hide) return `<section class="diet-sum diet-sum--plain${fin ? ' diet-sum--complete' : ''}" aria-label="Bilan de la journée">${line}</section>`;
  return `
      <section class="diet-sum${fin ? ' diet-sum--complete' : ''}" aria-label="Bilan de la journée">
        <div class="diet-sum__main">
          <div class="diet-sum__ring" role="img" aria-label="${dietN(eaten.kcal)} kilocalories${noGoal ? ', pas d\'objectif' : ` sur ${dietN(goal.kcal)}`}">
            ${dietRingSvg(noGoal ? 0 : ratio)}
            <span class="diet-sum__kcal" aria-hidden="true"><b class="num">${dietN(eaten.kcal)}</b><span class="num">${noGoal ? 'kcal' : `sur ${dietN(goal.kcal)} kcal`}</span></span>
          </div>
          <div class="diet-sum__bars">${bars}</div>
        </div>
        ${line}
        ${noGoal && !own.p && !own.c && !own.f && !dietHasMealItems(pr.plan) ? '<p class="diet-sum__hint">Pas encore d\'objectif : touche « Mon plan » en haut, puis « Objectifs du jour ».</p>' : ''}
        ${own.kcal || own.p || own.c || own.f || !dietHasMealItems(pr.plan) ? '' : `<p class="diet-sum__hint">Repère : ${dietPersonal(pr.plan) ? 'le total de tes repas types' : 'le total prévu par ton plan'}${Object.keys(pr.swaps).length ? ', remplacements du jour compris' : ''}.</p>`}
        ${dietLowKcal(pr.plan) ? dietLowNoteHtml(!!pr.plan.targets?.kcal) : ''}
        ${dietSaltRowHtml(pr)}
      </section>`;
}

// Frise des 7 derniers jours : un toucher ouvre le jour (aujourd'hui : route sans paramètre). Panel vague 4 : elle
// reprenait les pastilles de « Cette semaine » de l'accueil (semaine du lundi, séances faites) pour un autre sens. Ici,
// un sélecteur de date comme le Calendrier d'iOS : la lettre et le numéro du jour, le jour choisi plein, et sous le
// numéro un petit point pour la journée (plein : complète, anneau : en partie).
function dietWeekHtml(day) {
  const today = dietDayKey();
  return `<div class="diet-week" role="group" aria-label="7 derniers jours">${dietWeek(data).map(w => {
    // Une lettre comme le Calendrier d'iOS et « Cette semaine » de l'accueil (L M M J V S D) : « Ma » et « Me » d'ici
    // faisaient deux notations dans l'app (juges du 26/11). Le jour entier est dit par VoiceOver (aria-label)
    const d = new Date(w.ts), letter = ['D', 'L', 'M', 'M', 'J', 'V', 'S'][d.getDay()];
    const label = `${w.day === today ? 'Aujourd\'hui' : fmtDate(w.ts, 'day')}${w.finished ? (dietActivePlan(data)?.fromCoach ? ', journée complète' : ', objectif atteint') : w.some ? ', en partie' : ''}`;
    return `<button class="diet-week__day${w.day === day ? ' diet-week__day--on' : ''}" data-action="diet-day" data-day="${w.day}" aria-pressed="${w.day === day}" aria-label="${esc(label)}">
        <span class="diet-week__letter" aria-hidden="true">${letter}</span>
        <span class="diet-week__num num${w.day === today ? ' diet-week__num--today' : ''}" aria-hidden="true">${d.getDate()}</span>
        <span class="diet-week__dot${w.finished ? ' diet-week__dot--done' : w.some ? ' diet-week__dot--some' : ''}" aria-hidden="true"></span>
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
              ${dietFoodIconHtml(it)}
              <span class="diet-item__body">
                <span class="diet-item__name">${esc(foodName(it.name))}</span>
                <span class="diet-item__sub num">Retiré ${when} · ${esc(dietQtyText(it))}</span>
              </span>
              <span class="diet-item__back">Remettre</span>
            </button>`;
  const swap = pr.swaps[it.id], eat = swap || it, m = dietItemMacros(eat), qty = dietIsQtyChange(it, swap);
  const nums = data.dietHideNumbers ? '' : ` · ${dietMacroLine(m)}`;
  const note = !swap ? '' : qty ? `Prévu : ${dietQtyText(it)}` : `Remplace ${foodName(it.name)}`;
  return `
            <button class="diet-item" data-action="diet-swap" data-swipe-del="diet-item-del" data-item="${esc(it.id)}" data-day="${day}"
              aria-label="${esc(foodName(eat.name))}, ${esc(dietQtySpoken(eat))}${data.dietHideNumbers ? '' : `, ${dietN(m.kcal)} kilocalories`}${swap ? `, ${qty ? `prévu ${esc(dietQtySpoken(it))}` : `remplace ${esc(foodName(it.name))}`}` : ''}. Remplacer ou modifier">
              ${dietFoodIconHtml(eat)}
              <span class="diet-item__body">
                <span class="diet-item__name">${esc(foodName(eat.name))}</span>
                <span class="diet-item__sub num">${note ? `<span class="diet-item__swapped">${esc(note)}</span>` : ''}${esc(dietQtyText(eat))}${nums}</span>
              </span>
              <span class="diet-item__swap diet-item__swap--txt" aria-hidden="true">${icon('arrow.left.arrow.right', 16)}<span>Remplacer</span></span>
            </button>`;
}

// Aliment ajouté pour la journée, hors plan : « Ajouté aujourd'hui » en couleur d'action ; ⋯ : quantité ou retirer
function dietExtraRowHtml(it, meal, day) {
  const m = dietItemMacros(it), when = !day || day === dietDayKey() ? 'aujourd\'hui' : 'ce jour';
  const nums = data.dietHideNumbers ? '' : ` · ${dietMacroLine(m)}`;
  return `
            <button class="diet-item diet-item--extra" data-action="diet-extra" data-swipe-del="diet-extra-del" data-meal="${esc(meal.id)}" data-extra="${esc(it.id)}" data-day="${day}"
              aria-label="${esc(foodName(it.name))}, ${esc(dietQtySpoken(it))}${data.dietHideNumbers ? '' : `, ${dietN(m.kcal)} kilocalories`}, ajouté ${when}, hors plan. Modifier">
              ${dietFoodIconHtml(it)}
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
  // Plan perso : « Copier le repas type » (ses repas sont des habitudes facultatives, pas un menu prévu)
  const personal = dietPersonal(dietActivePlan(data));
  const label = off ? (personal ? 'Remettre le repas type' : 'Remettre le repas prévu') : personal ? 'Copier le repas type' : 'Copier le plan de ce repas';
  const when = !day || day === dietDayKey() ? 'aujourd\'hui' : 'ce jour';
  const sub = `${off ? `Retiré ${when} · ` : ''}${names.join(', ')}${data.dietHideNumbers ? '' : ` · ${dietN(kcal)}\u00a0kcal`}`;
  return `
            <button class="diet-item diet-item--plan" data-action="diet-meal-back" data-op="${off ? 'on' : 'copy'}" data-meal="${esc(meal.id)}" data-day="${day}"
              aria-label="${esc(label)} : ${esc(names.join(', '))}${data.dietHideNumbers ? '' : `, ${dietN(kcal)} kilocalories`}">
              ${dietActIconHtml(off ? 'arrow.clockwise' : 'doc.on.doc')}
              <span class="diet-item__body">
                <span class="diet-item__name">${esc(label)}</span>
                <span class="diet-item__sub num">${esc(sub)}</span>
              </span>
            </button>${off || x.extras?.length ? '' : dietMealReuseRowHtml(meal, day)}`;
}
// Jour vide : « Reprendre le repas d'hier » (ou du dernier jour des 7 d'avant où ce repas a été mangé), à côté de
// « Copier le plan de ce repas ». Ce qui sera repris est nommé dessous ; rien à reprendre, ou repas déjà noté (pas de
// double ajout d'un second toucher) : pas de ligne
function dietReuseDayWord(from, day) {
  const t = new Date(`${day}T12:00:00`).getTime();
  if (localISO(t - 86400000) === from) return 'd\'hier';
  return `du ${new Date(`${from}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })}`;
}
function dietMealReuseRowHtml(meal, day) {
  const d0 = day || dietDayKey(), src = dietMealReuseSource(data, data.dietActive, meal.id, d0);
  if (!src) return '';
  const label = `Reprendre le repas ${dietReuseDayWord(src.day, d0)}`;
  const names = src.items.map(it => foodName(it.name)), kcal = src.items.reduce((a, it) => a + dietItemMacros(it).kcal, 0);
  const sub = `${names.join(', ')}${data.dietHideNumbers ? '' : ` · ${dietN(kcal)}\u00a0kcal`}`;
  return `
            <button class="diet-item diet-item--plan" data-action="diet-meal-reuse" data-meal="${esc(meal.id)}" data-day="${d0}"
              aria-label="${esc(label)} : ${esc(names.join(', '))}${data.dietHideNumbers ? '' : `, ${dietN(kcal)} kilocalories`}">
              ${dietActIconHtml('clock.history')}
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
              <span class="diet-meal__nameline"><span class="diet-meal__name">${esc(meal.name)}</span>${done ? `<span class="diet-meal__more" aria-hidden="true">${icon('chevron.down', 14)}</span>` : ''}</span>
              ${(cleared || !meal.items.length) && !extras.length ? `<span class="diet-meal__macros">${emptyText}</span>`
                : data.dietHideNumbers ? '' : `<span class="diet-meal__macros num"><span aria-hidden="true">${dietMacroLine(macros)}</span><span class="sr-text">${dietMacroSpoken(macros)}</span></span>`}`;
  // ⋯ : menu du repas (« Retirer ce repas pour aujourd'hui »), pour tout repas du plan pas encore retiré (jour vide
  // compris : un repas sauté ne bloque pas « Journée complète »)
  const menu = meal.items.length && !x.off ? `<button class="diet-meal__menu" data-action="diet-day-meal-menu" data-meal="${esc(meal.id)}" data-day="${day}" aria-label="Options de ${esc(meal.name)}">${icon('ellipsis', 20)}</button>` : '';
  return `
        <article class="diet-meal${done ? ' diet-meal--done' : ''}${isNext ? ' diet-meal--next' : ''}" data-meal="${esc(meal.id)}">
          <div class="diet-meal__head">
            ${done ? `<button class="diet-meal__title" data-action="diet-meal-open" data-meal="${esc(meal.id)}" aria-expanded="${open}">${title}</button>`
              : `<div class="diet-meal__title">${title}</div>`}
            ${menu}${live.length || extras.length ? dietCheckBtn(meal, done, day) : ''}
          </div>
          ${(cleared || !meal.items.length) && !extras.length ? '' : dietMixHtml(macros, 'diet-meal__mix')}
          ${meal.note && open ? `<p class="diet-meal__note">${icon('info.circle', 14)}<span>${esc(meal.note)}</span></p>` : ''}
          ${open ? `<div class="diet-meal__items">${cleared ? dietMealPlanRowHtml(x, day) : meal.items.map(it => dietItemRowHtml(it, pr, day)).join('')}${extras.map(it => dietExtraRowHtml(it, meal, day)).join('')}
            <button class="diet-item diet-item--add" data-action="diet-day-add" data-meal="${esc(meal.id)}" data-day="${day}" aria-label="Ajouter un aliment à ${esc(meal.name)}">${dietActIconHtml('plus')}<span class="diet-item__name">Ajouter un aliment</span></button></div>` : ''}
        </article>`;
}

// Carte d'un plan reçu de mon coach (écran Nutrition, Mon coach) : nom, repas, « Utiliser ce plan »
// Sans l'accord « recevoir les plans de mon coach » : invitation, sans rien du contenu du plan. « Recevoir » demande
// l'accord puis prend le plan d'un seul geste (panel vague 4 : « Accepter » puis « Utiliser », deux validations)
function dietInviteCardHtml(item) {
  const who = esc(coachName());
  return `
        <article class="coach-prog diet-inbox diet-invite">
          <div class="coach-prog__eyebrow">Plans de nutrition</div>
          <h3 class="coach-prog__name">${who} veut t'envoyer un plan de nutrition</h3>
          <p class="coach-prog__meta">Ton plan actuel reste dans Plans de nutrition. Tu peux retirer ton accord quand tu veux.</p>
          <button class="btn btn--primary coach-prog__btn" data-action="diet-take" data-id="${esc(item.id)}">Recevoir</button>
        </article>`;
}
function dietInboxCardHtml(item) {
  if (!dietCoachAccepted()) return dietInviteCardHtml(item);
  const { status } = dietInboxStatus(item);
  const who = esc(coachName());
  if (item.tooNew) return `
        <article class="coach-prog diet-inbox">
          <div class="coach-prog__eyebrow">Plan de nutrition ${elide('de', who)}</div>
          <h3 class="coach-prog__name">${esc(item.data.name)}</h3>
          <p class="coach-prog__meta">Mets l'app à jour pour recevoir ce plan.</p>
        </article>`;
  const eyebrow = status === 'update' ? `Mis à jour par ${who}` : status === 'new' ? `Nouveau plan de nutrition ${elide('de', who)}` : `Reçu ${elide('de', who)}`;
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
  return `<div class="group-title">Plans de nutrition</div>
        <div class="group">
          <button class="cell" data-action="diet-coach-toggle" role="switch" aria-checked="${on}">
            <span class="cell__body"><span class="cell__title">Recevoir les plans de nutrition ${elide('de', nameBreakHtml(coachName()))}</span>
              <span class="cell__sub">${on ? 'Gardés sur le serveur jusqu\'au retrait de ton accord.' : `Sans accord, ${myCoachWord('ton')} ne peut pas t'en envoyer.`}</span></span>
            ${switchHtml(on)}
          </button>
        </div>
        ${list.length ? `<div class="coach-progs">${(on ? list : list.slice(0, 1)).map(dietInboxCardHtml).join('')}</div>` : ''}`;
}

function dietEmptyHtml() {
  return `
        <div class="diet-empty">
          <span class="diet-empty__icon" aria-hidden="true">${icon('fork.knife', 34)}</span>
          <h2 class="diet-empty__title">Pas encore de plan de nutrition</h2>
          <p class="diet-empty__sub">${myCoachWord('Ton')} peut t'en envoyer un, ou crée le tien. Les calories et les macros se calculent seules.</p>
          <button class="btn btn--primary diet-empty__btn" data-action="diet-new-plan">Créer mon plan</button>
        </div>`;
}

// Source et licence (Licence Ouverte : source, version, date, pas d'aval de l'Anses ; ODbL : attribution d'Open Food Facts), précaution ; sur l'écran
// Nutrition, la ligne d'écoute des troubles alimentaires, toujours visible
function dietSourceFoot({ help = false } = {}) {
  return `<div class="diet-foot">
      <p class="group-foot">Source des valeurs : table Ciqual 2025 de l'Anses (version du 03/11/2025), doi.org/10.57745/RDMHWY, Licence Ouverte Etalab 2.0. Valeurs arrondies. L'énergie de quelques aliments est calculée par l'app. L'Anses ne valide pas ces plans.</p>
      <p class="group-foot">Produits scannés : Open Food Facts (openfoodfacts.org), © les contributeurs d'Open Food Facts, base libre sous licence ODbL. Valeurs à vérifier sur l'étiquette.</p>
      <p class="group-foot">Ces chiffres sont des repères, pas un avis médical ni diététique. En cas de maladie, de grossesse ou de trouble alimentaire, parles-en à un médecin ou à un diététicien.</p>
      ${help ? '<p class="group-foot diet-help">Si manger, compter ou te peser devient une source d\'angoisse, tu peux en parler : Anorexie Boulimie Info Écoute, 0810 037 037 (lundi, mardi, jeudi et vendredi, de 16 h à 18 h).</p>' : ''}
    </div>`;
}
// Objectif très bas : information, jamais un blocage (NICE NG246)
// own : objectif de calories fixé (« Cet objectif »), sinon total du plan (« Ce plan »)
function dietLowNoteHtml(own = true) {
  return `<p class="diet-low" role="note">${icon('info.circle', 14)}<span>${own ? 'Cet objectif' : 'Ce plan'} est très bas pour un adulte qui s'entraîne. Les recommandations de santé réservent les régimes sous 1 200 kcal par jour à un suivi médical. Parles-en à un médecin ou à un diététicien.</span></p>`;
}
// Bas de l'écran Nutrition : réglages (repas du jour, chiffres, série, accord). Le choix des repas du jour y est dit
// (« Repas du jour : pré-remplis par le plan ») : on sait qu'il existe sans ouvrir les réglages
function dietSettingsCellHtml() {
  return `<div class="group group--gap"><button class="cell cell--nav" data-action="go-diet-settings">
      <span class="cell__body"><span class="cell__title">Réglages de la nutrition</span><span class="cell__sub">Repas du jour : ${dietEmptyDaysFor(data, data.dietActive) ? 'vides' : 'pré-remplis par le plan'}</span></span>${icon('chevron.right', 16)}</button></div>`;
}

// Plan à plusieurs jours : quel jour du plan vaut aujourd'hui. Entraînement / repos : « Aujourd'hui : jour de repos ·
// Changer » (un toucher passe à l'autre ; selon la séance par défaut) ; semaine : « Mardi · Repos · Voir la semaine »
function dietDayLineHtml(plan, day) {
  const mode = plan?.days?.mode;
  if (!mode) return '';
  const idx = dietDayIndex(data, data.dietActive, day), today = day === dietDayKey();
  if (mode === 'session') {
    // Aujourd'hui sans réponse ni séance : la question, une fois par jour ; le menu du jour d'entraînement d'ici là
    if (idx.ask) return dietDayAskHtml('diet-dayline');
    const word = idx.kind === 'r' ? 'jour de repos' : 'jour d\'entraînement';
    const why = { manual: 'Choisi à la main', session: 'Séance faite ou commencée', ask: idx.kind === 't' ? 'Tu as prévu une séance' : 'Pas de séance prévue', none: 'Aucune séance ce jour-là' }[idx.src] || '';
    return `<div class="diet-dayline">
          <p class="diet-dayline__txt"><b>${today ? 'Aujourd\'hui' : esc(dietDayTitle(day))} : ${word}</b><span>${why}</span></p>
          <button class="diet-dayline__btn" data-action="diet-day-kind"${today ? '' : ` data-day="${day}"`} aria-label="Changer : passer en ${idx.kind === 'r' ? 'jour d\'entraînement' : 'jour de repos'}">Changer</button>
        </div>`;
  }
  return `<div class="diet-dayline">
          <p class="diet-dayline__txt"><b>${DIET_WEEKDAYS[idx.i]} · ${dietKindWord(idx.kind)}</b><span>Le plan change chaque jour de la semaine</span></p>
          <button class="diet-dayline__btn" data-action="diet-open-day" data-id="${esc(data.dietActive)}" data-dayi="${idx.i}">Voir la semaine</button>
        </div>`;
}
// « Séance aujourd'hui ? Oui | Non » : posée une fois par jour (plan entraînement / repos), en haut de Nutrition et sur la
// carte de l'accueil ; la réponse vaut pour la journée, une séance faite ensuite passe devant, « Changer » reste possible
function dietDayAskHtml(cls) {
  // Question et explication sur toute la largeur, Oui | Non dessous en pleine largeur (panel du 18/11, tour 3 : tassé à côté)
  return `<div class="${cls} diet-dayask">
          <p class="diet-dayline__txt"><b>Séance aujourd'hui ?</b><span>Oui : repas des jours de séance. Non : repas des jours de repos.</span></p>
          <span class="diet-dayask__btns">
            <button class="diet-dayline__btn" data-action="diet-day-ask" data-v="t" aria-label="Oui, séance aujourd'hui : jour d'entraînement">Oui</button>
            <button class="diet-dayline__btn" data-action="diet-day-ask" data-v="r" aria-label="Non, pas de séance aujourd'hui : jour de repos">Non</button>
          </span>
        </div>`;
}
// Sel du jour (18/11) : une ligne sobre sous les macros, « Sel 2,1 g sur 3 à 5 g » et « + Sel ajouté ». Affichée avec un
// objectif de sel, ou dès qu'un sel ajouté est noté. Aucune alerte, aucun rouge
function dietSaltGoalText(g) {
  if (!g) return '';
  return g.min != null && g.max != null ? `${fmtNum(g.min, 1)} à ${fmtNum(g.max, 1)}\u00a0g` : g.max != null ? `${fmtNum(g.max, 1)}\u00a0g au plus` : `${fmtNum(g.min, 1)}\u00a0g au moins`;
}
// Repère du sel (panel nutri-final t1) : « repère 3 à 5 g », « 5 g au plus » (un plafond, pas une quantité à atteindre)
function dietSaltRefText(g) {
  if (!g) return '';
  return g.min != null && g.max != null ? 'repère ' + dietSaltGoalText(g) : dietSaltGoalText(g);
}
// Au-dessus du haut du repère : l'écart, dit en orange (le vert voulait dire « réussi »)
function dietSaltOver(goal, g) {
  const over = goal?.max != null ? dietR1(g + (-goal.max)) : 0;
  return over > 0 ? over : 0;
}
function dietSaltRowHtml(pr) {
  const goal = dietSaltGoal(pr.plan), salt = dietDaySalt(data, pr);
  if (!goal && !salt.added) return '';
  const top = goal ? (goal.max ?? goal.min) : null;
  const ratio = top ? Math.min(1, salt.g / top) : 0, zone = goal?.min != null && goal.max != null ? goal.min / goal.max : null;
  const attrDay = pr.day === dietDayKey() ? '' : ` data-day="${pr.day}"`;
  const over = dietSaltOver(goal, salt.g);
  // « 2,1 g · repère 3 à 5 g » ; le sel des aliments cochés compte déjà (dit sous la barre et dans la feuille)
  const val = `<b>${fmtNum(dietR1(salt.g), 1)}</b>\u00a0g${goal ? ` · ${dietSaltRefText(goal)}` : ''}`;
  const note = over ? `${fmtNum(over, 1)}\u00a0g au-dessus du repère` : goal ? 'Sel des repas compris' : '';
  const spoken = `Sel : ${fmtNum(dietR1(salt.g), 1)} grammes, sel des repas compris${goal ? `, ${dietSaltRefText(goal).replace(/\u00a0g/g, ' grammes')}` : ''}${over ? `, ${fmtNum(over, 1)} gramme au-dessus du repère` : ''}. Détail, cuillère ou autre quantité`;
  return `
        <div class="diet-salt${over ? ' diet-salt--over' : ''}">
          <button class="diet-salt__open" data-action="diet-salt"${attrDay} aria-label="${esc(spoken)}">
            <span class="diet-salt__line" aria-hidden="true"><span class="diet-salt__label">Sel</span><span class="diet-salt__val num">${val}</span></span>
            ${goal ? waterBarHtml(ratio, zone) : ''}
            ${note ? `<span class="diet-salt__note" aria-hidden="true">${note}</span>` : ''}
          </button>
          <button class="water-add diet-salt__add" data-action="diet-salt-pinch"${attrDay} aria-label="Ajouter une pincée de sel, environ 0,4 gramme">${icon('plus', 14)}<span class="water-add__lbl">Pincée <small class="water-add__qty">0,4\u00a0g</small></span></button>
        </div>`;
}

function renderNutrition(dayParam) {
  const plan0 = dietActivePlan(data);
  const day = dietRouteDay(dayParam);
  const plan = plan0 ? dietDayPlan(data, data.dietActive, day) : null;
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
        ${waterShown() ? waterCardHtml(dietDayKey()) : ''}${dietEmptyHtml()}${waterShown() ? '' : waterInviteHtml()}${dietSettingsCellHtml()}${dietSourceFoot({ help: true })}</div></div>`;
  }
  const pr = dietDayProgress(data, data.dietActive, day);
  // Plan du coach : « envoyé par max » (« · de max » se lisait comme une quantité, panel Apple vague 4)
  const by = plan.fromCoach ? ` · envoyé par ${esc(plan.fromCoach.name || coachWord('ton', coachFormOf(plan.fromCoach.coachId)))}` : '';
  // Suivi de la diète partagé : dit ici, un toucher mène au réglage (panel nutri-final t1 : « max verra-t-il ma coche ? »)
  const shared = account.user && myCoach() && typeof coachShareOn === 'function' && coachShareOn('diet_log')
    ? `<button class="diet-plan-share" data-action="coach-open-share">${icon('person.2', 14)}<span>Partagé avec ${esc(personName(myCoach()))}</span>${icon('chevron.right', 12)}</button>` : '';
  const from = `<p class="diet-plan-from"><b class="diet-plan-from__day">${esc(dietDayTitle(day))}</b> · ${esc(plan.name)}${by}</p>${shared}`;
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
        ${dietDayLineHtml(plan0, day)}
        ${dietSummaryHtml(pr)}
        ${!data.dietHideNumbers && !dietPersonal(plan) && dietTargetGap(plan) ? `<p class="diet-gap" role="note">${icon('info.circle', 14)}<span>${esc(dietTargetGap(plan, dietMealsNoun(plan)))}${plan.fromCoach
          ? ` Suis le plan de ${esc(plan.fromCoach.name || coachWord('ton', coachFormOf(plan.fromCoach.coachId)))} ; en cas de doute, demande-lui.` : ''}</span></p>` : ''}
        ${plan.consigne ? `<p class="coach-prog__consigne diet-consigne">${icon('info.circle', 14)}<span>${esc(plan.consigne)}</span></p>` : ''}
        <h2 class="group-title">Repas</h2>
        ${pr.meals.length ? dietMacroLegendHtml() : ''}
        <div class="diet-meals">${meals}</div>
        ${waterNutritionHtml(day, { past })}
        ${dietSettingsCellHtml()}
        ${dietSourceFoot({ help: true })}
      </div>
    </div>`;
}
SCREENS.set('nutrition', { render: day => renderNutrition(day), enter: () => { loadFoods(); dietMaybeAskConsent(); } });
// Changer de jour dans Nutrition (frise, « Revenir à aujourd'hui ») : seule la partie du jour change. Avant le 16/11, la
// route remplacée relançait la transition d'écran (tout l'écran glissait, le défilement revenait en haut, le grand titre
// réapparaissait) : « ça fait un refresh pas beau ». Désormais la barre et le défilement restent, le contenu sous la
// frise arrive en fondu avec un petit glissement dans le sens du jour choisi (180 ms, coupé avec Réduire les animations)
function dietSwapDay(route) {
  const scr = $('.nutrition-view .scr'), from = dietRouteDay(routeParams(currentRoute())[0]);
  navReplaceQuiet(route);
  if (!scr) { render(); return; }
  const to = dietRouteDay(routeParams(route)[0]), y = window.scrollY;
  const focusDay = document.activeElement?.closest?.('.diet-week__day')?.dataset.day;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderNutrition(routeParams(route)[0]);
  const fresh = $('.scr', tmp);
  if (!fresh) { render(); return; }
  frTypoNode(fresh);
  scr.replaceChildren(...fresh.childNodes);
  window.scrollTo(0, y);
  if (focusDay) scr.querySelector(`.diet-week__day[data-day="${focusDay}"]`)?.focus({ preventScroll: true });
  if (reduceMotion.matches || to === from) return;
  const dx = to < from ? -12 : 12;
  for (const el of scr.children) {
    if (el.classList.contains('diet-week')) continue;
    el.animate?.([{ opacity: 0.6, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });   // jamais d'écran vide : on part de 60 %
  }
}
function dietGoToday() {
  dietPick = null;
  if (currentView() === 'nutrition') dietSwapDay('nutrition');
}

// ── Accueil : carte du jour ─────────────────────────────────

function nutritionHomeCard() {
  const pending = account.user && myCoach() ? dietPending() : null;
  const ok = dietCoachAccepted();   // sans accord : invitation, rien du plan (ni son nom)
  const card = pending ? `
    <section class="home-card account-card coach-home" aria-labelledby="dietPendingTitle">
      <div class="account-card__text">
        <h2 class="account-card__title" id="dietPendingTitle">${!ok ? `${nameBreakHtml(coachName())} veut t'envoyer un plan de nutrition` : dietInboxStatus(pending).status === 'update' ? `Plan de nutrition mis à jour par ${nameBreakHtml(coachName())}` : `Nouveau plan de nutrition ${elide('de', nameBreakHtml(coachName()))}`}</h2>
        <p class="account-card__sub">${ok ? esc(pending.data.name) : 'Ton plan actuel reste dans Plans de nutrition'}</p>
      </div>
      <button class="account-card__btn" data-action="diet-take" data-id="${esc(pending.id)}">${ok ? 'Utiliser' : 'Recevoir'}</button>
      <button class="account-card__close" data-action="diet-dismiss" data-id="${esc(pending.id)}" aria-label="Plus tard">${icon('xmark', 16)}</button>
    </section>` : '';
  const plan = dietActivePlan(data);
  // Sans plan : une ligne « Noter ce que je mange » (retour de Gérard, 26/11 : rien sur l'accueil ne menait à la
  // Nutrition, trouvée par hasard dans Programme au 13e toucher). Un toucher crée le plan perso et ouvre la journée ;
  // l'eau suivie garde sa petite carte (js/features/water-ui.js)
  if (!plan) return card + dietHomeStartHtml() + waterHomeCard();
  const day = dietDayKey(), pr = dietDayProgress(data, data.dietActive, day);
  // Plan sans aucun aliment, sans objectif de calories et rien de noté : la carte reste, avec l'invite « Rien de noté
  // aujourd'hui · Ajouter » et jamais « 0 sur 0 kcal » (avant le 26/11 elle disparaissait : le plan créé, l'accueil
  // n'affichait toujours rien, alors que Plans de nutrition promettait la carte)
  const noGoal = !(pr.goal.kcal > 0);
  // Aucun aliment prévu dans le plan : ses repas se remplissent au fil du jour, comme un jour vide
  const noFood = !pr.meals.some(x => x.meal.items.length);
  const next = pr.next;
  const hide = data.dietHideNumbers === true;
  // Sans objectif de calories : ce qui est mangé seul (« 620 kcal ») ; rien de noté : le compte des repas ou l'état
  const head = hide || (noGoal && !(pr.eaten.kcal > 0)) ? (pr.nMeals ? `${pr.nDone} sur ${plural(pr.nMeals, 'repas', 'repas')}` : esc(dietStatusText(pr)))
    : noGoal ? `<b>${dietN(pr.eaten.kcal)}</b> kcal` : `<b>${dietN(pr.eaten.kcal)}</b> sur ${dietN(pr.goal.kcal)} kcal`;
  // Tous les repas du jour (vague 4) : nom, kcal, coché ou non ; chacun se coche d'un toucher, le prochain en gras
  // (panel nutri-final t1 : « je ne sais pas où cocher le petit-déjeuner déjà mangé »).
  // Plus de 4 repas : 3 autour du prochain et « et 2 autres ». Le reste de la carte ouvre Nutrition
  const { shown, more } = dietHomeMeals(pr);
  // Repas sans aliment prévu ni noté (jour vide) : pas de « 0 kcal », mais « à noter » (le repas attend une saisie)
  const empty = x => !x.live.length && !x.extras.length;
  const kcalOf = x => (empty(x) ? (pr.blank || noFood ? '<span class="diet-home__mkcal">à noter</span>' : '')
    : hide ? '' : `<span class="diet-home__mkcal num">${dietN(x.macros.kcal)}\u00a0kcal</span>`);
  // Jour vide, ou plan sans aliment prévu, sans rien de noté : une invite, la même phrase que l'écran Nutrition
  const blankNothing = (pr.blank || noFood) && pr.meals.every(empty);
  const rows = blankNothing ? `
        <div class="diet-home__meal diet-home__empty" aria-hidden="true"><span class="diet-home__mtext"><span class="diet-home__mname">${dietStatusText(pr) || 'Rien de noté aujourd\'hui'}</span><span class="diet-home__add">Ajouter</span></span></div>` : shown.map(x => {
    const isNext = next?.meal.id === x.meal.id;
    const state = x.done ? 'done' : isNext ? 'next' : 'todo';
    return `
        <div class="diet-home__meal diet-home__meal--${state}" data-meal="${esc(x.meal.id)}">
          <span class="diet-home__mtext" aria-hidden="true"><span class="diet-home__mname">${esc(x.meal.name)}</span>${kcalOf(x)}</span>
          <span class="diet-home__mstate">${x.done ? `<span class="diet-home__done" aria-hidden="true">${icon('checkmark', 12)}</span>` : !empty(x) || isNext ? dietCheckBtn(x.meal, false, null) : ''}</span>
        </div>`;
  }).join('');
  const moreText = !blankNothing && more ? `et ${more} ${more > 1 ? 'autres' : 'autre'}` : '';
  // VoiceOver : le bouton du haut dit tout (plan, calories, chaque repas) ; les lignes sont cachées, sauf le bouton à cocher
  const spokenMeals = pr.meals.filter(x => x.meal.items.length || x.extras.length)
    .map(x => `${x.meal.name}${x.done ? ' coché' : next?.meal.id === x.meal.id ? ' ensuite' : ''}${hide || (!x.live.length && !x.extras.length) ? '' : `, ${dietN(x.macros.kcal)} kilocalories`}`).join(' ; ');
  const spoken = `Nutrition, ${plan.name} : ${hide || (noGoal && !(pr.eaten.kcal > 0)) ? (pr.nMeals ? `${pr.nDone} repas cochés sur ${pr.nMeals}` : dietStatusText(pr)) : noGoal ? `${dietN(pr.eaten.kcal)} kilocalories` : `${dietN(pr.eaten.kcal)} kilocalories sur ${dietN(pr.goal.kcal)}`}${dietProgressFinished(pr) ? `, ${dietStatusText(pr).toLowerCase()}` : ''}. ${blankNothing ? `${dietStatusText(pr) || 'Rien de noté aujourd\'hui'}. Ajouter` : `${spokenMeals}. Ouvrir`}`;
  return `${card}
    <section class="home-card diet-home${dietProgressFinished(pr) ? ' diet-home--complete' : ''}">
      <button class="diet-home__open" data-action="go-nutrition" aria-label="${esc(spoken)}">
        <span class="diet-home__ring" aria-hidden="true">${dietRingSvg(hide ? pr.nDone / Math.max(1, pr.nMeals) : noGoal ? 0 : dietRatio(pr.eaten.kcal, pr.goal.kcal), 44, 6)}</span>
        <span class="diet-home__text" aria-hidden="true">
          <span class="diet-home__title"><span class="home-card__title">Nutrition</span><span class="diet-home__plan">${esc(plan.name)}</span></span>
          <span class="diet-home__kcal num">${head}</span>
          ${dietProgressFinished(pr) ? `<span class="diet-home__next">${icon('checkmark', 12)}${dietStatusText(pr)}</span>` : ''}
        </span>
      </button>
      ${plan.days?.mode === 'session' && dietDayIndex(data, data.dietActive, day).ask ? dietDayAskHtml('diet-home__ask') : ''}
      <div class="diet-home__meals" data-action="go-nutrition">${rows}
        ${moreText ? `<div class="diet-home__more" aria-hidden="true">${moreText}</div>` : ''}
      </div>${waterHomeRowHtml()}
    </section>`;
}

// Accueil sans plan : la même ligne que « Lancer un défi » (titre de section, cellule avec chevron)
function dietHomeStartHtml() {
  return `<section class="diet-start" aria-labelledby="homeNutrition"><h2 class="home-list__title" id="homeNutrition">Nutrition</h2>
      <div class="home-card">
        <button class="home-cell" data-action="diet-home-start">
          <span class="home-cell__text"><span class="home-cell__name">Noter ce que je mange</span><span class="home-cell__sub">Repas et calories du jour</span></span>
          ${icon('chevron.right', 14)}</button>
      </div></section>`;
}

// ── Programme : entrée des plans ────────────────────────────

function dietProgrammeCellHtml(iconHtml = '') {
  const plan = dietActivePlan(data);
  return `
          <button class="cell cell--nav" data-action="go-diet-plans">
            ${iconHtml}
            <span class="cell__body"><span class="cell__title">Plans de nutrition</span>
              <span class="cell__sub">Repas, quantités et objectifs du jour</span></span>
            <span class="cell__value">${plan ? esc(plan.name) : 'Aucun'}</span>
            ${icon('chevron.right', 16)}
          </button>`;
}

// ── Coach : plan diète d'un élève ───────────────────────────

function coachDietGroupHtml(uid) {
  const sent = coachDietSentStatus(uid);
  return `
        <div class="group">
          <button class="cell cell--action" data-action="coach-send-diet" data-uid="${esc(uid)}">${icon('paperplane', 20)}<span>Envoyer un plan de nutrition</span></button>
          ${sent.map(x => `
          <div class="cell coach-sent" data-diet="${esc(x.id)}"><span class="cell__body"><span class="cell__title">${esc(x.name)}</span><span class="cell__sub">Envoyé le ${esc(fmtDate(x.sentAt, 'short'))}${x.gone ? ' · supprimé de tes plans' : ''}</span><span class="cell__sub coach-sent__state coach-sent__state--${x.seen ? 'used' : 'unseen'}">${x.seen ? 'Vu' : 'Pas encore ouvert'}</span></span></div>`).join('')}
        </div>`;
}

// ── Remplacer un aliment pour la journée ────────────────────

async function dietSwapSheet(itemId, day) {
  const planId = data.dietActive, plan = dietDayPlan(data, data.dietActive, day);
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
        ${dietFoodIconHtml(c.food)}
        <span class="diet-cand__body"><span class="diet-cand__name">${esc(foodName(c.food.name))}</span>
          <span class="diet-cand__sub num"><b class="diet-cand__qty">${c.g}\u00a0g${foodCookTag(c.food) ? ` ${foodCookTag(c.food)}` : ''}</b>${hide ? '' : dietSrPair(` · ${dietMacroLine(c.macros)}`, `, ${dietMacroSpoken(c.macros)}`)}</span></span>
        ${hide ? '' : `<span class="diet-cand__delta num" aria-label="écart : ${swapDeltaText(shownGap(c), 'kilocalories')}">${swapDeltaText(shownGap(c), 'kcal')}</span>`}
      </button>`;
  const body = `
    <div class="diet-swap">
      <p class="diet-swap__orig"><b>${esc(foodName(it.name))}</b><span class="num">${hide ? esc(dietQtyText(it)) : dietSrPair(`${esc(dietQtyText(it))} · ${dietMacroLine(ref)}`, `${esc(dietQtySpoken(it))}, ${dietMacroSpoken(ref)}`)}</span></p>
      <p class="diet-swap__rule">${swapRuleText(it)}, quantité déjà calculée.</p>
      ${dietMacroLegendHtml()}
      ${current ? `<button class="diet-cand diet-cand--back" data-swap="back"><span class="diet-cand__body"><span class="diet-cand__name">Remettre ${esc(foodName(it.name))}</span><span class="diet-cand__sub">Aujourd'hui, tu manges ${esc(foodName(current.name))}</span></span>${icon('arrow.clockwise', 18)}</button>` : ''}
      ${cands.length ? `<div class="diet-cands">${cands.map(row).join('')}</div>`
        : `<p class="diet-swap__none">${foodDb ? 'Aucun équivalent assez proche dans la base pour cet aliment.' : 'Base d\'aliments indisponible pour l\'instant.'}</p>`}
      <div class="diet-swap__acts">
        <button class="diet-cand" data-swap="qty"><span class="diet-cand__body"><span class="diet-cand__name">Changer la quantité</span><span class="diet-cand__sub num">${esc(dietQtyText(eat))}</span></span></button>
        ${dietShownMeals(plan).length > 1 ? '<button class="diet-cand" data-swap="move"><span class="diet-cand__body"><span class="diet-cand__name">Déplacer vers…</span></span></button>' : ''}
        <button class="diet-cand diet-cand--off" data-swap="off"><span class="diet-cand__body"><span class="diet-cand__name">Retirer pour ${day === dietDayKey() ? 'aujourd\'hui' : 'ce jour'}</span></span></button>
      </div>
      <p class="diet-swap__foot">Seulement pour ${day === dietDayKey() ? 'aujourd\'hui' : 'ce jour'}. Le plan ne change pas.</p>
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
  if (choice === 'move') { await dietMoveDayItem(planId, day, plan.meals.find(m => m.items.includes(it)), eat, { planItem: it }); return; }
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

// Éditeur du plan : choisir un équivalent (même règle et même liste que dans la journée) ; renvoie le candidat ou null
async function dietPickSwap(it) {
  await loadFoods();
  const cands = swapCandidates(it, { own: data.dietFoods || [] }), ref = dietItemMacros(it);
  const rows = cands.map((c, i) => `
      <button class="diet-cand" data-swap="${i}">
        ${dietFoodIconHtml(c.food)}
        <span class="diet-cand__body"><span class="diet-cand__name">${esc(foodName(c.food.name))}</span>
          <span class="diet-cand__sub num"><b class="diet-cand__qty">${c.g}\u00a0g${foodCookTag(c.food) ? ` ${foodCookTag(c.food)}` : ''}</b>${dietSrPair(` · ${dietMacroLine(c.macros)}`, `, ${dietMacroSpoken(c.macros)}`)}</span></span>
        <span class="diet-cand__delta num" aria-label="écart : ${swapDeltaText(Math.round(c.macros.kcal) - Math.round(ref.kcal), 'kilocalories')}">${swapDeltaText(Math.round(c.macros.kcal) - Math.round(ref.kcal), 'kcal')}</span>
      </button>`).join('');
  const body = `<div class="diet-swap">
      <p class="diet-swap__orig"><b>${esc(foodName(it.name))}</b><span class="num">${dietSrPair(`${esc(dietQtyText(it))} · ${dietMacroLine(ref)}`, `${esc(dietQtySpoken(it))}, ${dietMacroSpoken(ref)}`)}</span></p>
      <p class="diet-swap__rule">${swapRuleText(it)}, quantité déjà calculée.</p>
      ${dietMacroLegendHtml()}
      ${cands.length ? `<div class="diet-cands">${rows}</div>` : `<p class="diet-swap__none">${foodDb ? 'Aucun équivalent assez proche dans la base pour cet aliment.' : 'Base d\'aliments indisponible pour l\'instant.'}</p>`}
      <p class="diet-swap__foot">Remplace l'aliment dans ce repas du plan.</p>
    </div>`;
  const p = sheet({ title: 'Remplacer', cancel: 'Annuler', confirm: '', body });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  root?.addEventListener('click', ev => { const b = ev.target.closest('[data-swap]'); if (b) root._close(b.dataset.swap); });
  const choice = await p;
  return choice == null ? null : cands[Number(choice)] || null;
}

// Retirer pour la journée : la ligne reste, barrée, avec « Remettre » ; Annuler dans le toast
function dietRemovePlanItem(planId, it, day) {
  dietSetRemoved(data, planId, it.id, true, day);
  save(); haptic('light'); render();
  showToast(`Retiré pour ${day === dietDayKey() ? 'aujourd\'hui' : 'ce jour'} : ${foodName(it.name)}`, { action: 'Annuler', duration: 5000, onAction: () => {
    dietSetRemoved(data, planId, it.id, false, day); save(); render(); announce(`Remis : ${foodName(it.name)}`);
  } });
}

// Déplacer un aliment de la journée vers un autre repas, pour ce jour seulement (le plan ne change pas) : un ajout du jour
// change de repas ; un aliment prévu est retiré de son repas et ajouté à l'autre. Annuler remet tout comme avant
async function dietMoveDayItem(planId, day, meal, eat, { extra = null, planItem = null } = {}) {
  const to = meal && await dietPickMeal(dietDayPlan(data, data.dietActive, day), meal.id, `Déplacer ${foodName(eat.name)} vers…`);
  const target = to && dietDayPlan(data, data.dietActive, day)?.meals.find(m => m.id === to);
  if (!target) return;
  if (extra && !dietSetExtra(data, planId, meal.id, extra.id, null, day)) return;
  if (planItem) dietSetRemoved(data, planId, planItem.id, true, day);
  const added = dietAddExtra(data, planId, target.id, { ...eat }, day);
  if (!added) {   // repas d'arrivée plein : rien ne bouge
    if (extra) dietAddExtra(data, planId, meal.id, extra, day);
    if (planItem) dietSetRemoved(data, planId, planItem.id, false, day);
    showToast(`${DIET_ITEM_MAX} ajouts au plus par repas`, { error: true });
    return;
  }
  dietOpenMeals.add(target.id);
  save(); haptic(); render();
  showToast(`Déplacé vers ${target.name}`, { action: 'Annuler', duration: 6000, onAction: () => {
    dietSetExtra(data, planId, target.id, added.id, null, day);
    if (extra) dietAddExtra(data, planId, meal.id, extra, day);
    if (planItem) dietSetRemoved(data, planId, planItem.id, false, day);
    save(); render(); announce(`Remis dans ${meal.name}`);
  } });
}

// ── Actions ─────────────────────────────────────────────────

// Sel ajouté : pincée, cuillère à café, autre quantité ; les ajouts du jour (Supprimer) ; le sel des aliments
function dietSaltBodyHtml(day) {
  const pr = dietDayProgress(data, data.dietActive, day), salt = dietDaySalt(data, pr), goal = dietSaltGoal(pr.plan);
  const list = Array.isArray(data.saltLog?.[day]) ? data.saltLog[day] : [];
  const time = at => (at ? new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
  return `<div class="diet-saltsheet">
      <p class="diet-saltsheet__val num${dietSaltOver(goal, salt.g) ? ' diet-saltsheet__val--over' : ''}"><b>${fmtNum(dietR1(salt.g), 1)}\u00a0g</b>${goal ? ` · ${dietSaltRefText(goal)}, sel des repas compris` : ''}${dietSaltOver(goal, salt.g) ? `<span class="diet-saltsheet__over">${fmtNum(dietSaltOver(goal, salt.g), 1)}\u00a0g au-dessus du repère</span>` : ''}</p>
      <p class="diet-saltsheet__why num">Aliments mangés : ${fmtNum(dietR1(salt.food), 1)}\u00a0g${salt.unknown ? ` (${plural(salt.unknown, 'aliment sans valeur de sel', 'aliments sans valeur de sel')})` : ''} · ajouté : ${fmtNum(dietR1(salt.added), 1)}\u00a0g</p>
      <div class="diet-saltsheet__btns">
        ${SALT_ADDS.map(x => `<button type="button" class="water-add diet-saltsheet__add" data-salt="${x.g}" aria-label="Ajouter ${esc(x.label.toLowerCase())}, environ ${fmtNum(x.g, 1)} gramme${x.g >= 2 ? 's' : ''}">${icon('plus', 14)}<span class="water-add__lbl">${x.label}<small class="water-add__qty">environ ${fmtNum(x.g, 1)}\u00a0g</small></span></button>`).join('')}
        <button type="button" class="water-add diet-saltsheet__add" data-salt="other">Autre</button>
      </div>
      ${list.length ? `<div class="water-log__list">${list.slice().reverse().map(x => `
        <div class="water-log__row"><span class="water-log__txt num">${time(x.at) ? `${time(x.at)} · ` : ''}${fmtNum(x.g, 1)}\u00a0g</span>
          <button type="button" class="water-log__del" data-saltdel="${esc(x.id)}" aria-label="Supprimer ${fmtNum(x.g, 1)} gramme de sel">Supprimer</button></div>`).join('')}</div>` : ''}
      <p class="water-gs__src">Pincée et cuillère à café rase : poids moyens de l'USDA (FoodData Central, sel de table). Le sel des aliments vient de la table Ciqual ou de l'étiquette. Des repères, pas un avis médical.</p>
    </div>`;
}
async function dietSaltSheet(day) {
  const p = sheet({ title: 'Sel', cancel: '', confirm: 'OK', body: dietSaltBodyHtml(day) });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  const paint = () => { const b = root && $('.sheet__body', root); if (b) b.innerHTML = dietSaltBodyHtml(day); };
  root?.addEventListener('click', async ev => {
    const add = ev.target.closest('[data-salt]'), del = ev.target.closest('[data-saltdel]');
    if (add) {
      let g = Number(add.dataset.salt);
      if (add.dataset.salt === 'other') {
        const raw = await dialog({ title: 'Sel ajouté', message: 'En grammes, par exemple 1,5.', input: { decimal: true, value: '', placeholder: '1', unit: 'g', label: 'Sel ajouté, en grammes',
            validate: v => (!String(v).trim() || num(v, 0.1, SALT_ADD_MAX_G) !== null ? null : fieldNumMsg('Sel', 0.1, SALT_ADD_MAX_G, false, 'g')) },
          actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Ajouter', style: 'preferred' }] });
        if (raw == null || !String(raw).trim()) return;
        g = num(raw, 0.1, SALT_ADD_MAX_G);
        if (g === null) return;   // refus dit dans la fenêtre (validate)
      }
      if (!saltAdd(data, g, day)) { showToast(`${SALT_DAY_MAX} ajouts au plus par jour`, { error: true }); return; }
      save(); haptic('light'); paint(); announce(`Ajouté : ${fmtNum(g, 1)} gramme de sel`);
    } else if (del && saltRemove(data, day, del.dataset.saltdel)) { save(); haptic('light'); paint(); announce('Supprimé'); }
  });
  await p;
  render();
}

registerActions({
  'go-nutrition': () => navigate('nutrition'),
  // « Noter ce que je mange » (accueil sans plan) : plan perso créé d'office (4 repas vides, aucun objectif), journée
  // ouverte. Un coach prépare des plans pour ses élèves : écran Nutrition (« Créer mon plan »), rien de créé en silence
  'diet-home-start': () => {
    if (!dietActivePlan(data) && !coachRole().isCoach && dietCanCreate(data)) {
      dietNewPlan(data, 'Mon plan');
      save();
      haptic();
      dietMaybeAskConsent();
    }
    navigate('nutrition');
  },
  'diet-salt': (e, el) => dietSaltSheet(el.dataset.day || dietDayKey()),
  // « + Pincée 0,4 g » : ajoutée d'un toucher, comme « + Verre 25 cl » (panel du 18/11, tour 4) ; la ligne ouvre le détail
  'diet-salt-pinch': (e, el) => {
    const day = el.dataset.day || dietDayKey(), g = SALT_ADDS[0].g, added = saltAdd(data, g, day);
    if (!added) { showToast(`${SALT_DAY_MAX} ajouts au plus par jour`, { error: true }); return; }
    save(); haptic('light'); render();
    showToast(`+ ${fmtNum(g, 1)} g de sel`, { action: 'Annuler', duration: 5000, onAction: () => { saltRemove(data, day, added.id); save(); render(); announce('Annulé'); } });
  },
  // Plan entraînement / repos : un toucher passe à l'autre jour ; revenir au jour choisi par la séance efface le choix
  'diet-day-kind': (e, el) => {
    const planId = data.dietActive, day = el.dataset.day || dietDayKey();
    if (!dietActivePlan(data)?.days) return;
    const cur = dietDayIndex(data, planId, day), next = cur.kind === 'r' ? 't' : 'r';
    const e0 = dietDay(data, planId, day), prev = e0.kind || null, prevBy = e0.kindBy || 'manual';
    dietSetDayKind(data, planId, day, next);
    save(); haptic(); render();
    const word = next === 'r' ? 'Jour de repos' : 'Jour d\'entraînement';
    showToast(word, { action: 'Annuler', duration: 5000, onAction: () => { dietSetDayKind(data, planId, day, prev, prevBy); save(); render(); announce('Annulé'); } });
  },
  // Réponse à « Séance aujourd'hui ? » : retenue pour la journée
  'diet-day-ask': (e, el) => {
    const planId = data.dietActive, day = dietDayKey(), v = el.dataset.v;
    if (!dietActivePlan(data)?.days || !['t', 'r'].includes(v)) return;
    dietSetDayKind(data, planId, day, v, 'ask');
    save(); haptic(); render();
    announce(v === 'r' ? 'Jour de repos' : 'Jour d\'entraînement');
  },
  'diet-day': (e, el) => {
    const day = el.dataset.day, today = dietDayKey();
    dietPick = day === today ? null : { day, today, at: Date.now() };
    const route = day === dietDayKey() ? 'nutrition' : makeRoute('nutrition', day);
    if (routeName(currentRoute()) === 'nutrition') dietSwapDay(route); else navigate(route);
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
    const fin = dietProgressFinished(pr);
    haptic(on ? (fin ? 'success' : 'medium') : 'light');
    if (on && fin) { try { validationSound(); } catch {} }   // pas de toast : il couvrait la carte du repas ; « Journée complète » s'affiche déjà en haut, avec le son
    render();
    if (on) { announce(fin ? dietStatusText(pr) : `Coché. ${pr.next ? `Ensuite : ${pr.next.meal.name}` : ''}`); return; }
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
    const meal = dietDayPlan(data, data.dietActive, day)?.meals.find(m => m.id === mealId);
    if (!meal) return;
    const when = day === dietDayKey() ? 'aujourd\'hui' : 'ce jour';
    const v = await dialog({ type: 'sheet', title: meal.name, message: `Seulement pour ${when}. Le plan ne change pas.`,
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
    const meal = dietDayPlan(data, data.dietActive, day)?.meals.find(m => m.id === mealId);
    const ok = meal && (el.dataset.op === 'copy' ? dietCopyMealPlan(data, planId, mealId, day) : dietSetMealOn(data, planId, mealId, day));
    if (!ok) return;
    // Jour vide : « Remettre le repas prévu » remet aussi son plan (sinon le repas revient vide, contrairement à l'annonce)
    if (el.dataset.op !== 'copy' && dietDay(data, planId, day).blank === true) dietCopyMealPlan(data, planId, mealId, day);
    save(); haptic(); render(); announce(`${meal.name} remis`);
  },
  // Jour vide : « Reprendre le repas d'hier » : ce qui a été mangé devient des ajouts du jour, Annuler dans le toast
  'diet-meal-reuse': (e, el) => {
    const planId = data.dietActive, day = el.dataset.day || dietDayKey(), mealId = el.dataset.meal;
    const meal = dietDayPlan(data, data.dietActive, day)?.meals.find(m => m.id === mealId);
    const r = meal && dietReuseMeal(data, planId, mealId, day);
    if (!r) return;
    dietOpenMeals.add(mealId);
    save(); haptic(); render();
    const what = `${meal.name} ${dietReuseDayWord(r.day, day)}`;
    announce(`Repris : ${what}, ${r.ids.length} aliment${r.ids.length > 1 ? 's' : ''}`);
    showToast(`Repris : ${what}`, { action: 'Annuler', duration: 6000, onAction: () => {
      dietUndoReuseMeal(data, planId, mealId, r.ids, day); save(); render(); announce(`Annulé : ${meal.name}`);
    } });
  },
  'diet-meal-open': (e, el) => {
    const id = el.dataset.meal;
    if (dietOpenMeals.has(id)) dietOpenMeals.delete(id); else dietOpenMeals.add(id);
    render();
  },
  'diet-swap': async (e, el) => { await dietSwapSheet(el.dataset.item, el.dataset.day || dietDayKey()); },
  // Balayé vers la gauche (js/ui/swipe-row.js) : aliment prévu retiré pour la journée, ajout du jour supprimé ; Annuler
  'diet-item-del': (e, el) => {
    const day = el.dataset.day || dietDayKey(), it = dietDayPlan(data, data.dietActive, day)?.meals.flatMap(m => m.items).find(x => x.id === el.dataset.item);
    if (it) dietRemovePlanItem(data.dietActive, it, day);
  },
  'diet-extra-del': (e, el) => {
    const planId = data.dietActive, day = el.dataset.day || dietDayKey(), mealId = el.dataset.meal;
    const it = (dietDay(data, planId, day).extras[mealId] || []).find(x => x.id === el.dataset.extra);
    if (!it || !dietSetExtra(data, planId, mealId, it.id, null, day)) return;
    save(); haptic('light'); render();
    showToast(`Retiré : ${foodName(it.name)}`, { action: 'Annuler', duration: 5000, onAction: () => {
      dietAddExtra(data, planId, mealId, it, day); save(); render(); announce(`Remis : ${foodName(it.name)}`);
    } });
  },
  'diet-today': () => { dietGoToday(); announce('Aujourd\'hui'); },
  'diet-restore': (e, el) => {
    const planId = data.dietActive, day = el.dataset.day || dietDayKey();
    const it = dietDayPlan(data, data.dietActive, day)?.meals.flatMap(m => m.items).find(x => x.id === el.dataset.item);
    if (!it) return;
    dietSetRemoved(data, planId, it.id, false, day);
    save(); haptic(); render(); announce(`Remis : ${foodName(it.name)}`);
  },
  // Ajouter un aliment à un repas pour la journée (recherche, code-barres ou création), coché ou non : il reste
  // dans son état, ses totaux et ceux du jour se recalculent ; le plan ne change pas
  'diet-day-add': async (e, el) => {
    const planId = data.dietActive, day = el.dataset.day || dietDayKey(), mealId = el.dataset.meal;
    const meal = dietDayPlan(data, data.dietActive, day)?.meals.find(m => m.id === mealId);
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
    const choice = await dialog({ type: 'sheet', title: foodName(it.name), message: `${dietQtyText(it)}, ajouté pour ${day === dietDayKey() ? 'aujourd\'hui' : 'ce jour'}. Le plan ne change pas.`,
      actions: [{ label: 'Changer la quantité', value: 'g' },
        ...(dietShownMeals(dietDayPlan(data, data.dietActive, day)).length > 1 ? [{ label: 'Déplacer vers…', value: 'move' }] : []),
        { label: 'Retirer', value: 'del', style: 'destructive' }, { label: 'Annuler', style: 'cancel' }] });
    if (choice === 'g') {
      const q = await dietAskQty(it, it);
      if (!q || !dietSetExtra(data, planId, mealId, it.id, q, day)) return;
      save(); haptic(); render(); announce(`${foodName(it.name)} : ${dietQtySpoken(q)}`);
    } else if (choice === 'move') {
      await dietMoveDayItem(planId, day, dietDayPlan(data, data.dietActive, day).meals.find(m => m.id === mealId), it, { extra: it });
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
    showToast(before ? `Plan en cours : ${it.data.name}. Ancien plan gardé` : `Plan en cours : ${it.data.name}`);
    render();
  },
  'diet-dismiss': (e, el) => { coachMarkInboxSeen('programme', el.dataset.id); render(); showToast(`Il reste dans Social › ${myCoachWord('Mon')}`); },
  'coach-send-diet': async (e, el) => {
    const uid = el.dataset.uid, ids = coachSendableDiets();
    if (!ids.length) {
      const go = await dialog({ title: 'Aucun plan à envoyer', message: 'Crée d\'abord un plan de nutrition avec au moins un aliment, dans Programme › Plans de nutrition.',
        actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Créer un plan', value: true, style: 'preferred' }] });
      if (go === true) switchToDietPlans();
      return;
    }
    const who = personName(coachStudent(uid));
    const planId = await dialog({ type: 'sheet', title: 'Envoyer un plan de nutrition', message: `Choisis un de tes plans pour ${who}. Un nouvel envoi du même plan le met à jour chez ${who}.`,
      actions: [...ids.map(id => ({ label: data.dietPlans[id].name, value: id })), { label: 'Annuler', style: 'cancel' }] });
    if (!planId) return;
    // Aperçu avant l'envoi (jour par jour : kcal, macros, eau, sel), l'élève coché d'office ; jamais envoyé au premier
    // toucher (panel du 07/11 : un plan diète touche à la santé de l'élève). js/features/diet-week.js
    dietSendSel = null;
    navigate(makeRoute('diet-send', planId, uid));
  },
});

// Programme › Plans diète depuis un autre onglet (fiche d'un élève)
function switchToDietPlans() {
  switchTab('program', { reset: true });
  navigate('diet-plans');
}
