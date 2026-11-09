// ═══════════════════════════════════════════════════════════
//  Nutrition, écrans du jour (Nutrition V1, docs/NUTRITION_V1.md)
//
//  - Entraînement › Nutrition (route nutrition, nutrition:AAAA-MM-JJ pour un jour passé) : frise des 7
//    jours, anneau des calories et barres des macros (mangé sur repère), repas du plan à cocher d'un
//    toucher (un repas coché se replie, le suivant passe devant), aliment remplacé pour la journée par
//    un équivalent (js/data/food-swap.js), série de jours complets.
//  - Carte de l'accueil (nutritionHomeCard) : où en est la journée et le prochain repas, à cocher
//    sans ouvrir l'écran. Plan reçu d'un coach : carte « Nouveau plan diète » (accueil, Nutrition, Mon coach).
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
// « 620 kcal · P 45 · G 70 · L 15 » et sa version dite par VoiceOver
// Lettre et chiffre insécables (« L\u00a01 » ne se coupe jamais, panel t6 : le « 1 » passait seul à la ligne)
function dietMacroLine(m) { return `${dietN(m.kcal)}\u00a0kcal · P\u00a0${dietN(m.p)} · G\u00a0${dietN(m.c)} · L\u00a0${dietN(m.f)}`; }
function dietMacroSpoken(m) { return `${dietN(m.kcal)} kilocalories, ${dietMacroGramsSpoken(m)}`; }
function dietMacroGramsSpoken(m) { return `${dietN(m.p)} grammes de protéines, ${dietN(m.c)} de glucides, ${dietN(m.f)} de lipides`; }
// Ligne abrégée à l'écran (« P 4 · G 47 »), dite en toutes lettres par VoiceOver (sinon « P 4 g » lettre par lettre)
function dietSrPair(visible, spoken) { return `<span aria-hidden="true">${visible}</span><span class="sr-text">${spoken}</span>`; }
// Texte d'un dialogue (message lu tel quel) : en toutes lettres pour tous, « 4 g de protéines, 47 g de glucides… »
function dietMacroWords(m, fmt = dietN) { return `${fmt(m.p)} g de protéines, ${fmt(m.c)} g de glucides, ${fmt(m.f)} g de lipides`; }
function dietDayTitle(day) {
  const today = dietDayKey();
  if (day === today) return 'Aujourd\'hui';
  const t = new Date(`${day}T12:00:00`).getTime();
  if (daysAgo(t) === 1) return 'Hier';
  const s = fmtDate(t, 'day');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// Jour affiché : celui de la route s'il est dans les 7 derniers jours, sinon aujourd'hui
function dietRouteDay(day) {
  const week = dietWeek(data).map(x => x.day);
  return week.includes(day) ? day : dietDayKey();
}
// Part remplie d'une jauge : sur les nombres affichés (arrondis au gramme ou à la kcal), pour que « 4 / 4 g »
// soit toujours une jauge pleine (panel du 07/11 : 3,6 sur 4,4 g affichés « 4 / 4 g », jauge aux 4/5)
const dietRatio = (v, goal) => dietShownRatio(v, goal);

// Anneau des calories (SVG) : piste grise, arc de la part mangée
function dietRingSvg(ratio, size = 112, stroke = 12) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg class="diet-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="diet-ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
      <circle class="diet-ring__arc" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
        stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - ratio)).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
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
  const status = pr.complete ? `<span class="diet-sum__done">${icon('checkmark', 14)}Journée complète</span>`
    : `<span>${pr.nDone} ${pr.nDone > 1 ? 'repas cochés' : 'repas coché'} sur ${n}</span>`;
  const line = `<p class="diet-sum__line">${status}${streak >= 2 ? `<span class="diet-sum__streak">${icon('flame', 14)}${streak} jours complets d'affilée</span>` : ''}</p>`;
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

// Frise des 7 derniers jours : un toucher ouvre le jour (aujourd'hui : route sans paramètre)
function dietWeekHtml(day) {
  const today = dietDayKey();
  return `<div class="diet-week" role="group" aria-label="7 derniers jours">${dietWeek(data).map(w => {
    const letter = new Date(w.ts).toLocaleDateString('fr-FR', { weekday: 'narrow' }).toUpperCase();
    const label = `${w.day === today ? 'Aujourd\'hui' : fmtDate(w.ts, 'day')}${w.complete ? ', journée complète' : w.some ? ', en partie' : ''}`;
    return `<button class="diet-week__day${w.day === day ? ' diet-week__day--on' : ''}" data-action="diet-day" data-day="${w.day}" aria-pressed="${w.day === day}" aria-label="${esc(label)}">
        <span class="diet-week__letter" aria-hidden="true">${letter}</span>
        <span class="diet-week__dot${w.complete ? ' diet-week__dot--done' : w.some ? ' diet-week__dot--some' : ''}" aria-hidden="true">${w.complete ? icon('checkmark', 13) : ''}</span>
      </button>`;
  }).join('')}</div>`;
}

// Bouton rond à cocher (vert une fois coché) : un seul toucher, rien au pointerdown
// day null (carte de l'accueil) : le jour est lu au toucher, jamais figé à l'affichage (carte restée ouverte après minuit)
function dietCheckBtn(meal, done, day, extra = '') {
  return `<button class="diet-check${done ? ' diet-check--on' : ''}" data-action="diet-check" data-meal="${esc(meal.id)}"${day ? ` data-day="${day}"` : ''} aria-pressed="${done}"
      aria-label="${done ? `${esc(meal.name)} coché, décocher` : `Cocher ${esc(meal.name)}`}"${extra}>${icon('checkmark', 20)}</button>`;
}

function dietItemRowHtml(it, pr, day) {
  const swap = pr.swaps[it.id], eat = swap || it, m = dietItemMacros(eat);
  const nums = data.dietHideNumbers ? '' : ` · ${dietN(m.kcal)} kcal · P ${dietN(m.p)} · G ${dietN(m.c)} · L ${dietN(m.f)}`;
  return `
            <button class="diet-item" data-action="diet-swap" data-item="${esc(it.id)}" data-day="${day}"
              aria-label="${esc(eat.name)}, ${eat.g} grammes${data.dietHideNumbers ? '' : `, ${dietN(m.kcal)} kilocalories`}${swap ? `, remplace ${esc(it.name)}` : ''}. Remplacer">
              <span class="diet-item__body">
                <span class="diet-item__name">${esc(eat.name)}</span>
                <span class="diet-item__sub num">${swap ? `<span class="diet-item__swapped">Remplace ${esc(it.name)}</span>` : ''}${eat.g} g${nums}</span>
              </span>
              <span class="diet-item__swap" aria-hidden="true">${icon('arrow.left.arrow.right', 18)}</span>
            </button>`;
}

// Aliment ajouté pour la journée, hors plan : « Ajouté aujourd'hui » en couleur d'action ; ⋯ : quantité ou retirer
function dietExtraRowHtml(it, meal, day) {
  const m = dietItemMacros(it), when = day === dietDayKey() ? 'aujourd\'hui' : 'ce jour';
  const nums = data.dietHideNumbers ? '' : ` · ${dietN(m.kcal)} kcal · P ${dietN(m.p)} · G ${dietN(m.c)} · L ${dietN(m.f)}`;
  return `
            <button class="diet-item diet-item--extra" data-action="diet-extra" data-meal="${esc(meal.id)}" data-extra="${esc(it.id)}" data-day="${day}"
              aria-label="${esc(it.name)}, ${it.g} grammes${data.dietHideNumbers ? '' : `, ${dietN(m.kcal)} kilocalories`}, ajouté ${when}, hors plan. Modifier">
              <span class="diet-item__body">
                <span class="diet-item__name">${esc(it.name)}</span>
                <span class="diet-item__sub num"><span class="diet-item__swapped">Ajouté ${when}</span>${it.g} g${nums}</span>
              </span>
              <span class="diet-item__swap" aria-hidden="true">${icon('ellipsis', 18)}</span>
            </button>`;
}

function dietMealHtml(x, pr, day) {
  const { meal, macros, done, extras = [] } = x;
  const isNext = pr.next?.meal.id === meal.id;
  const open = !done || dietOpenMeals.has(meal.id);
  // Titre : un repas coché se déplie au toucher ; pas coché, il est déjà ouvert (simple texte)
  const title = `${isNext ? '<span class="diet-meal__eyebrow">Ensuite</span>' : ''}
              <span class="diet-meal__name">${esc(meal.name)}</span>
              ${data.dietHideNumbers ? '' : `<span class="diet-meal__macros num"><span aria-hidden="true">${dietMacroLine(macros)}</span><span class="sr-text">${dietMacroSpoken(macros)}</span></span>`}`;
  return `
        <article class="diet-meal${done ? ' diet-meal--done' : ''}${isNext ? ' diet-meal--next' : ''}" data-meal="${esc(meal.id)}">
          <div class="diet-meal__head">
            ${done ? `<button class="diet-meal__title" data-action="diet-meal-open" data-meal="${esc(meal.id)}" aria-expanded="${open}">${title}<span class="diet-meal__more" aria-hidden="true">${icon('chevron.down', 14)}</span></button>`
              : `<div class="diet-meal__title">${title}</div>`}
            ${meal.items.length ? dietCheckBtn(meal, done, day) : ''}
          </div>
          ${meal.note && open ? `<p class="diet-meal__note">${icon('info.circle', 14)}<span>${esc(meal.note)}</span></p>` : ''}
          ${open ? (meal.items.length ? `<div class="diet-meal__items">${meal.items.map(it => dietItemRowHtml(it, pr, day)).join('')}${extras.map(it => dietExtraRowHtml(it, meal, day)).join('')}
            <button class="diet-item diet-item--add" data-action="diet-day-add" data-meal="${esc(meal.id)}" data-day="${day}" aria-label="Ajouter un aliment à ${esc(meal.name)}">${icon('plus', 18)}<span class="diet-item__name">Ajouter un aliment</span></button></div>`
            : '<p class="diet-meal__empty">Aucun aliment dans ce repas.</p>') : ''}
        </article>`;
}

// Carte d'un plan reçu de mon coach (écran Nutrition, Mon coach) : nom, repas, « Utiliser ce plan »
// Sans l'accord « recevoir les plans de mon coach » : invitation, sans rien du contenu du plan
function dietInviteCardHtml() {
  const who = esc(coachName());
  return `
        <article class="coach-prog diet-inbox diet-invite">
          <div class="coach-prog__eyebrow">Plans diète</div>
          <h3 class="coach-prog__name">${who} veut t'envoyer un plan diète</h3>
          <p class="coach-prog__meta">Accepte pour le recevoir. Tu peux retirer ton accord quand tu veux.</p>
          <button class="btn btn--primary coach-prog__btn" data-action="diet-coach-accept">Accepter</button>
        </article>`;
}
function dietInboxCardHtml(item) {
  if (!dietCoachAccepted()) return dietInviteCardHtml();
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
// Bas de l'écran Nutrition : réglages (chiffres, série, accord)
function dietSettingsCellHtml() {
  return `<div class="group group--gap"><button class="cell cell--nav" data-action="go-diet-settings">
      <span class="cell__body"><span class="cell__title">Réglages de la nutrition</span></span>${icon('chevron.right', 16)}</button></div>`;
}

function renderNutrition(dayParam) {
  const plan = dietActivePlan(data);
  const day = dietRouteDay(dayParam);
  const pending = account.user && myCoach() ? dietPending() : null;
  const right = plan ? `<button class="navbar__text" data-action="diet-open-plan" data-id="${esc(data.dietActive)}">Plan</button>` : '';
  const title = dietDayTitle(day);
  const head = navBar({ title, large: true, right });
  if (!plan) {
    return `<div class="view view--grouped nutrition-view">${head}<div class="scr">
        ${pending ? `<div class="coach-progs">${dietInboxCardHtml(pending)}</div>` : ''}
        ${dietEmptyHtml()}${dietSettingsCellHtml()}${dietSourceFoot({ help: true })}</div></div>`;
  }
  const pr = dietDayProgress(data, data.dietActive, day);
  const from = plan.fromCoach ? `<p class="diet-plan-from">${esc(plan.name)} · ${elide('de', esc(plan.fromCoach.name || 'ton coach'))}</p>` : `<p class="diet-plan-from">${esc(plan.name)}</p>`;
  const meals = pr.meals.length ? pr.meals.map(x => dietMealHtml(x, pr, day)).join('')
    : '<div class="empty-note">Ce plan n\'a aucun repas. Ajoute-les dans le plan.</div>';
  return `
    <div class="view view--grouped nutrition-view">
      ${head}
      <div class="scr">
        ${from}
        ${pending ? `<div class="coach-progs">${dietInboxCardHtml(pending)}</div>` : ''}
        ${dietWeekHtml(day)}
        ${dietSummaryHtml(pr)}
        ${!data.dietHideNumbers && dietTargetGap(plan) ? `<p class="diet-gap" role="note">${icon('info.circle', 14)}<span>${esc(dietTargetGap(plan))}</span></p>` : ''}
        ${plan.consigne ? `<p class="coach-prog__consigne diet-consigne">${icon('info.circle', 14)}<span>${esc(plan.consigne)}</span></p>` : ''}
        <h2 class="group-title">Repas</h2>
        <div class="diet-meals">${meals}</div>
        ${dietSettingsCellHtml()}
        ${dietSourceFoot({ help: true })}
      </div>
    </div>`;
}
SCREENS.set('nutrition', { render: day => renderNutrition(day), enter: () => { loadFoods(); dietMaybeAskConsent(); } });

// ── Accueil : carte du jour ─────────────────────────────────

function nutritionHomeCard() {
  const pending = account.user && myCoach() ? dietPending() : null;
  const ok = dietCoachAccepted();   // sans accord : invitation, rien du plan (ni son nom)
  const card = pending ? `
    <section class="home-card account-card coach-home" aria-labelledby="dietPendingTitle">
      <div class="account-card__text">
        <h2 class="account-card__title" id="dietPendingTitle">${!ok ? `${esc(coachName())} veut t'envoyer un plan diète` : dietInboxStatus(pending).status === 'update' ? `Plan diète mis à jour par ${esc(coachName())}` : `Nouveau plan diète ${elide('de', esc(coachName()))}`}</h2>
        <p class="account-card__sub">${ok ? esc(pending.data.name) : 'Accepte pour le recevoir'}</p>
      </div>
      ${ok ? `<button class="account-card__btn" data-action="diet-take" data-id="${esc(pending.id)}">Utiliser</button>`
        : '<button class="account-card__btn" data-action="diet-coach-accept">Accepter</button>'}
      <button class="account-card__close" data-action="diet-dismiss" data-id="${esc(pending.id)}" aria-label="Plus tard">${icon('xmark', 16)}</button>
    </section>` : '';
  const plan = dietActivePlan(data);
  if (!plan) return card;
  const day = dietDayKey(), pr = dietDayProgress(data, data.dietActive, day);
  if (!pr.nMeals) return card;   // aucun repas rempli : rien à suivre aujourd'hui (pas de « 0 sur 0 kcal »)
  const next = pr.next;
  const hide = data.dietHideNumbers === true;
  const line = pr.complete ? 'Journée complète' : next ? `${esc(next.meal.name)}${hide ? '' : ` · ${dietN(next.macros.kcal)} kcal`}` : '';
  const head = hide ? `${pr.nDone} sur ${plural(pr.nMeals, 'repas', 'repas')}` : `<b>${dietN(pr.eaten.kcal)}</b> sur ${dietN(pr.goal.kcal)} kcal`;
  return `${card}
    <section class="home-card diet-home${pr.complete ? ' diet-home--complete' : ''}">
      <button class="diet-home__open" data-action="go-nutrition" aria-label="Nutrition : ${hide ? `${pr.nDone} repas cochés sur ${pr.nMeals}` : `${dietN(pr.eaten.kcal)} kilocalories sur ${dietN(pr.goal.kcal)}`}${pr.complete ? ', journée complète' : next ? `, ensuite ${esc(next.meal.name)}` : ''}. Ouvrir">
        <span class="diet-home__ring" aria-hidden="true">${dietRingSvg(hide ? pr.nDone / Math.max(1, pr.nMeals) : dietRatio(pr.eaten.kcal, pr.goal.kcal), 44, 6)}</span>
        <span class="diet-home__text" aria-hidden="true">
          <span class="home-card__title">Nutrition</span>
          <span class="diet-home__kcal num">${head}</span>
          ${line ? `<span class="diet-home__next">${pr.complete ? icon('checkmark', 12) : ''}${line}</span>` : ''}
        </span>
      </button>
      ${next && next.meal.items.length ? dietCheckBtn(next.meal, false, null) : ''}
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
  const e = dietDay(data, planId, day), current = e.swaps[itemId];
  const cands = swapCandidates(it, { own: data.dietFoods || [] });
  const ref = dietItemMacros(it), hide = data.dietHideNumbers === true;
  // Écart des kcal affichées (arrondies), pas des valeurs exactes : 213 kcal face à 215 se lit moins 2 kcal, comme on le
  // calcule de tête (panel t5)
  const shownGap = c => -Math.round(ref.kcal) + Math.round(c.macros.kcal);
  const row = (c, i) => `
      <button class="diet-cand" data-swap="${i}">
        <span class="diet-cand__body"><span class="diet-cand__name">${esc(c.food.name)}</span>
          <span class="diet-cand__sub num">${hide ? `${c.g} g` : dietSrPair(`${c.g} g · ${dietMacroLine(c.macros)}`, `${c.g} grammes, ${dietMacroSpoken(c.macros)}`)}</span></span>
        ${hide ? '' : `<span class="diet-cand__delta num" aria-label="écart : ${swapDeltaText(shownGap(c), 'kilocalories')}">${swapDeltaText(shownGap(c), 'kcal')}</span>`}
      </button>`;
  const body = `
    <div class="diet-swap">
      <p class="diet-swap__orig"><b>${esc(it.name)}</b><span class="num">${hide ? `${it.g} g` : dietSrPair(`${it.g} g · ${dietMacroLine(ref)}`, `${it.g} grammes, ${dietMacroSpoken(ref)}`)}</span></p>
      <p class="diet-swap__rule">${swapRuleText(it)}, macros proches, même famille d'aliments.</p>
      ${current ? `<button class="diet-cand diet-cand--back" data-swap="back"><span class="diet-cand__body"><span class="diet-cand__name">Remettre ${esc(it.name)}</span><span class="diet-cand__sub">Aujourd'hui, tu manges ${esc(current.name)}</span></span>${icon('arrow.clockwise', 18)}</button>` : ''}
      ${cands.length ? `<div class="diet-cands">${cands.map(row).join('')}</div>`
        : `<p class="diet-swap__none">${foodDb ? 'Aucun équivalent assez proche dans la base pour cet aliment.' : 'Base d\'aliments indisponible pour l\'instant.'}</p>`}
      <p class="diet-swap__foot">Seulement pour ${day === dietDayKey() ? 'aujourd\'hui' : 'ce jour'} : ton plan ne change pas.</p>
    </div>`;
  const p = sheet({ title: 'Remplacer', cancel: 'Annuler', confirm: '', body });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  root?.addEventListener('click', ev => { const b = ev.target.closest('[data-swap]'); if (b) root._close(b.dataset.swap); });
  const choice = await p;
  if (choice == null) return;
  if (choice === 'back') { dietSetSwap(data, planId, itemId, null, day); showToast(`${it.name} remis`); }
  else {
    const c = cands[Number(choice)];
    if (!c) return;
    dietSetSwap(data, planId, itemId, { name: c.food.name, food: c.food.code, fam: c.food.fam, g: c.g, per: c.food.per }, day);
    showToast(`Remplacé par ${c.food.name}`);
  }
  haptic();
  save();
  render();
}

// ── Actions ─────────────────────────────────────────────────

registerActions({
  'go-nutrition': () => navigate('nutrition'),
  'diet-day': (e, el) => {
    const day = el.dataset.day;
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
    if (on && pr.complete) { try { validationSound(); } catch {} announce('Journée complète, bravo'); }   // pas de toast : il couvrait la carte du repas ; « Journée complète » s'affiche déjà en haut, avec le son
    render();
    if (on) { announce(pr.complete ? 'Journée complète' : `Coché. ${pr.next ? `Ensuite : ${pr.next.meal.name}` : ''}`); return; }
    // Décoché par erreur : Annuler le recoche (le toast l'annonce à VoiceOver, « Annuler disponible »)
    const name = pr.meals.find(x => x.meal.id === meal)?.meal.name || 'Repas';
    showToast(`Décoché : ${name}`, { action: 'Annuler', duration: 5000, onAction: () => {
      if (!dietDay(data, planId, day).done.includes(meal)) dietToggleMeal(data, planId, meal, day);
      save(); render(); announce(`Recoché : ${name}`);
    } });
  },
  'diet-meal-open': (e, el) => {
    const id = el.dataset.meal;
    if (dietOpenMeals.has(id)) dietOpenMeals.delete(id); else dietOpenMeals.add(id);
    render();
  },
  'diet-swap': async (e, el) => { await dietSwapSheet(el.dataset.item, el.dataset.day || dietDayKey()); },
  // Ajouter un aliment à un repas pour la journée (recherche, code-barres ou création), coché ou non : il reste
  // dans son état, ses totaux et ceux du jour se recalculent ; le plan ne change pas
  'diet-day-add': async (e, el) => {
    const planId = data.dietActive, day = el.dataset.day || dietDayKey(), mealId = el.dataset.meal;
    const meal = dietActivePlan(data)?.meals.find(m => m.id === mealId);
    if (!meal) return;
    if ((dietDay(data, planId, day).extras[mealId] || []).length >= DIET_ITEM_MAX) { showToast(`${DIET_ITEM_MAX} ajouts au plus par repas`, { error: true }); return; }
    const pick = await dietChooseFood();
    const it = pick && foodToItem(pick.food, pick.g);
    if (!it) return;
    const added = dietAddExtra(data, planId, mealId, it, day);
    if (!added) return;
    dietOpenMeals.add(mealId);
    save();
    haptic();
    render();
    showToast(`Ajouté à ${meal.name} : ${added.name}`, { action: 'Annuler', duration: 5000, onAction: () => {
      dietSetExtra(data, planId, mealId, added.id, null, day); save(); render(); announce(`Retiré : ${added.name}`);
    } });
  },
  'diet-extra': async (e, el) => {
    const planId = data.dietActive, day = el.dataset.day || dietDayKey(), mealId = el.dataset.meal;
    const it = (dietDay(data, planId, day).extras[mealId] || []).find(x => x.id === el.dataset.extra);
    if (!it) return;
    const choice = await dialog({ type: 'sheet', title: it.name, message: `${it.g} g, ajouté pour ${day === dietDayKey() ? 'aujourd\'hui' : 'ce jour'} : ton plan ne change pas.`,
      actions: [{ label: 'Changer la quantité', value: 'g' }, { label: 'Retirer', value: 'del', style: 'destructive' }, { label: 'Annuler', style: 'cancel' }] });
    if (choice === 'g') {
      const g = await dietAskGrams(it, it.g);
      if (g == null || !dietSetExtra(data, planId, mealId, it.id, g, day)) return;
      save(); haptic(); render(); announce(`${it.name} : ${g} grammes`);
    } else if (choice === 'del') {
      const before = it.g;
      dietSetExtra(data, planId, mealId, it.id, null, day);
      save(); haptic('light'); render();
      showToast(`Retiré : ${it.name}`, { action: 'Annuler', duration: 5000, onAction: () => {
        dietAddExtra(data, planId, mealId, { ...it, g: before }, day); save(); render();
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
    if (!dietCoachAccepted() && !(await dietAskCoachAccept())) return;
    if (item.tooNew) { showToast('Mets l\'app à jour pour recevoir ce plan.'); return; }
    const it = dietInbox().find(x => x.id === item.id);
    const id = importCoachDiet(data, it, myCoach());
    if (!id) { showToast(coachErrorText('server'), { error: true }); return; }
    save();
    haptic();
    coachMarkInboxSeen('programme', it.id);
    showToast(`Plan en cours : ${it.data.name}`);
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
    const gap = dietTargetGap(plan);
    const ok = await dialog({ title: `Envoyer « ${plan.name} » à\u00a0${who}\u00a0?`,
      message: `${gap ? `${gap} ` : ''}${plan.targets ? `Objectif du jour : ${dietTargetsLong(plan)}.` : 'Sans objectifs du jour.'} ${plural(plan.meals.filter(m => m.items.length).length, 'repas', 'repas')}, ${dietN(dietPlanMacros(plan).kcal)} kcal prévues.${gap ? ` ${who} verra le même écart sous le plan, dans sa Nutrition du jour.` : ''}`,
      actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Envoyer', value: true, style: 'preferred' }] });
    if (ok !== true) return;
    el.disabled = true;
    const r = await coachSendDiet(uid, planId);
    el.disabled = false;
    if (coachToast(r, `Plan envoyé à ${who}`)) { haptic(); coachRefresh(); }
  },
});

// Programme › Plans diète depuis un autre onglet (fiche d'un élève)
function switchToDietPlans() {
  switchTab('program', { reset: true });
  navigate('diet-plans');
}
