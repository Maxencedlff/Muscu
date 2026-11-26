// ═══════════════════════════════════════════════════════════
//  Réglages de la nutrition et accords (Nutrition V1, docs/NUTRITION_V1.md « Accords »)
//
//  Deux accords, deux finalités (données de santé : CNIL, RGPD article 9, consentement explicite) :
//  - « Copier mes plans sur mon compte » (dietConsent, js/data/nutrition.js) : plans, objectifs et aliments
//    perso copiés sur le serveur pour les retrouver sur ses appareils. Sans lui, tout reste sur l'iPhone.
//    Question posée une fois, avec un compte, dès qu'un plan existe. Retiré : le profil renvoyé ne les
//    contient plus, ils sont effacés du serveur et restent sur l'iPhone.
//  - « Recevoir les plans diète de mon coach » (élève, js/data/coach-diet.js : student_set_share('diet')) :
//    sans lui, le coach ne peut pas envoyer (serveur à jour) et l'app n'affiche rien du plan (invitation).
//    Retiré : les plans diète que le serveur gardait pour l'élève sont effacés (déclencheur).
//  Questions courtes (deux phrases), « En savoir plus » ouvre privacy.html#nutrition.
//  - Écran diet-settings : Mes aliments, masquer les calories et les grammes de macros, afficher la série, les accords.
//  - Écran diet-foods (Mes aliments) : aliments créés ou scannés, un toucher pour en retirer un.
// ═══════════════════════════════════════════════════════════
'use strict';

let dietConsentOpen = false;   // une seule question à la fois

function dietOpenPrivacy() { window.open(LEGAL_URLS.nutrition, '_blank'); }

// Question courte ; actions : [oui, non] ; « En savoir plus » ouvre le détail et repose la question au retour
async function dietAskShort(title, message, yes, no) {
  if (dietConsentOpen) return null;
  dietConsentOpen = true;
  try {
    for (;;) {
      const v = await dialog({ title, message, actions: [
        { label: yes, value: 'yes', style: 'preferred' },
        { label: no, value: 'no' },   // un vrai choix (enregistré), pas « Annuler »
        { label: 'En savoir plus', value: 'more' },
      ] });
      if (v !== 'more') return v === 'yes' ? true : v === 'no' ? false : null;   // null : fermée sans choisir
      dietOpenPrivacy();
    }
  } finally { dietConsentOpen = false; }
}

// Accord « copier sur mon compte » ; renvoie true s'il est donné
async function dietAskConsent() {
  if (dietConsentOn(data)) return true;
  const coachText = coachRole().isCoach ? 'Tes plans de nutrition, y compris ceux de tes élèves, peuvent renseigner sur la santé.'
    : 'Tes plans de nutrition et tes objectifs peuvent renseigner sur ta santé.';
  const v = await dietAskShort('Copier tes plans sur ton compte ?',
    `${coachText} Sans accord, ils restent sur ${thisPhone()}.`,
    'Copier sur mon compte', `Garder sur ${thisPhone()}`);
  if (v === null) return false;
  dietSetConsent(data, v);
  save();
  dietSyncSoon();
  return v;
}
// À l'ouverture de Nutrition ou des plans : une fois, avec un compte, quand un plan existe
function dietMaybeAskConsent() {
  if (!account.user || data.dietConsentAsked || data.dietConsent || !dietPlanIds(data).length) return;
  setTimeout(() => { if (!data.dietConsentAsked && !data.dietConsent) dietAskConsent().then(() => render()); }, 400);
}
function dietSyncSoon() {
  if (account.user && typeof syncNow === 'function') syncNow().catch?.(() => {});
}

// Accord « recevoir les plans diète de mon coach » (élève) ; renvoie true s'il est donné
// quiet : le plan en attente est pris juste après (diet-take), pas de « Touche Utiliser »
async function dietAskCoachAccept({ quiet = false } = {}) {
  if (dietCoachAccepted()) return true;
  const who = coachName();
  const v = await dietAskShort(`Recevoir les plans de nutrition ${elide('de', who)} ?`,
    `Ils sont gardés sur le serveur jusqu'au retrait de ton accord. Ils peuvent renseigner sur ta santé.`,
    'Accepter', 'Pas maintenant');
  if (!v) return false;
  return dietCoachApply(true, { quiet });
}
async function dietCoachApply(on, { quiet = false } = {}) {
  const r = await dietCoachSetAccept(on);
  if (!r.ok) { showToast(coachErrorText(r.kind), { error: true }); return false; }
  save();
  haptic();
  // Plan en attente : message court, entier même en texte agrandi maximal (4 lignes au plus, panel t6)
  if (!quiet) showToast(on ? (dietPending() ? 'Plan reçu. Touche Utiliser' : `Plans ${myCoachWord('du')} acceptés`) : `Plans ${myCoachWord('du')} supprimés du serveur`);
  coachRefresh();
  return on;
}

function renderDietSettings() {
  const sw = (action, on, title, sub = '') => `
          <button class="cell" data-action="${action}" role="switch" aria-checked="${on}">
            <span class="cell__body"><span class="cell__title">${title}</span>${sub ? `<span class="cell__sub">${sub}</span>` : ''}</span>
            ${switchHtml(on)}
          </button>`;
  const c = data.dietConsent;
  const since = c?.on ? `Accord donné le ${esc(fmtDate(Date.parse(c.at), 'short'))}.` : c ? `Tes plans restent sur ${thisPhone()}.` : '';
  const hasCoach = account.user && !!myCoach();
  return `
    <div class="view view--grouped diet-settings-view">
      ${navBar({ title: 'Réglages', large: true, largeTitle: 'Réglages de la nutrition' })}
      <div class="scr">
        <div class="group-title">Aliments</div>
        <div class="group">
          <button class="cell cell--nav" data-action="go-diet-foods">
            <span class="cell__body"><span class="cell__title">Mes aliments</span><span class="cell__sub">Créés ou scannés</span></span>
            <span class="cell__value num">${(data.dietFoods || []).length}</span>${icon('chevron.right', 16)}</button>
        </div>
        <div class="group-title">Repas du jour</div>
        <div class="group" role="radiogroup" aria-label="Repas du jour">
          ${[[false, 'Pré-remplis par le plan', 'Tu coches chaque repas une fois mangé.'], [true, 'Vides', 'Tu notes ce que tu manges. Le plan fixe les objectifs et se copie repas par repas.']].map(([blank, title, sub]) => {
            const on = dietEmptyDaysFor(data, data.dietActive) === blank;
            return `
          <button class="cell cell--pick" data-action="diet-day-mode" data-blank="${blank}" role="radio" aria-checked="${on}">
            <span class="cell__body"><span class="cell__title">${title}</span><span class="cell__sub">${sub}</span></span>
            <span class="cell__check">${on ? icon('checkmark', 20) : ''}</span>
          </button>`;
          }).join('')}
        </div>
        <div class="group-foot">S'applique dès aujourd'hui. Les repas cochés et les jours passés ne changent pas.</div>
        <div class="group-title">Affichage</div>
        <div class="group">
          ${sw('diet-hide-numbers', data.dietHideNumbers === true, 'Masquer les calories et les grammes', 'Les cases des repas et les quantités restent.')}
          ${sw('diet-streak', data.dietStreakOff !== true, 'Afficher la série', 'Jours complets d\'affilée')}
        </div>
        ${waterSettingsGroupHtml()}
        ${account.user ? `
        <div class="group-title">Compte</div>
        <div class="group">
          ${sw('diet-consent', dietConsentOn(data), 'Copier mes plans sur mon compte', since)}
        </div>
        ${account.dietTooBig ? '<p class="diet-low" role="note">Plans trop lourds pour ton compte. Supprime ceux que tu n\'utilises plus. Le reste du compte se synchronise.</p>' : ''}
        <div class="group-foot">Plans, objectifs et aliments perso sont copiés sur le serveur de l'app, pour tes autres appareils. Retirer l'accord les supprime du serveur.</div>` : ''}
        ${hasCoach ? `
        <div class="group-title">Coach</div>
        <div class="group">
          ${sw('diet-coach-toggle', dietCoachAccepted(), `Recevoir les plans de nutrition ${elide('de', nameBreakHtml(coachName()))}`)}
        </div>
        <div class="group-foot">Ses plans restent sur le serveur jusqu'au retrait de l'accord ou la fin du coaching. ${myCoachWord('Ton')} voit seulement si tu les as ouverts.</div>` : ''}
        <div class="group-foot diet-foot">${PT.dietFoot()}</div>
        <div class="group group--gap"><button class="cell cell--nav" data-action="diet-privacy">
          <span class="cell__body"><span class="cell__title">Confidentialité de la nutrition</span></span>${icon('chevron.right', 16)}</button></div>
      </div>
    </div>`;
}
SCREENS.set('diet-settings', { render: () => renderDietSettings() });

// ── Mes aliments (vague 4) ──────────────────────────────────
// Aliments créés ou scannés, 200 au plus : la liste, un toucher pour retirer (Annuler dans le toast). Ouvert depuis
// les réglages, et quand Mes aliments est plein (création, scan) : jamais le plus ancien retiré en silence.
// Retirer ne change aucun plan : chaque aliment du plan garde ses propres valeurs pour 100 g
function dietOpenFoods() { navigate('diet-foods'); }
function dietFoodCellHtml(x) {
  const hide = data.dietHideNumbers === true, per = x.per;
  const kind = x.code ? 'Scanné' : 'Créé';
  const shown = hide ? kind : `${kind} · 100 g · ${per.k} kcal · ${dietMacroAbbr(per, { fmt: fmtNum })}`;
  const spoken = hide ? kind : `${kind}, pour 100 grammes, ${per.k} kilocalories, ${dietMacroWords(per, fmtNum).replace(/ g /g, ' grammes ')}`;
  return `<button class="cell cell--nav" data-action="diet-food-menu" data-id="${esc(x.id)}">
      ${dietFoodIconHtml(x)}<span class="cell__body"><span class="cell__title">${esc(foodName(x.name))}</span><span class="cell__sub num">${dietSrPair(esc(shown), esc(spoken))}</span></span>${icon('ellipsis', 18)}</button>`;
}
function renderDietFoods() {
  const list = data.dietFoods || [], full = list.length >= DIET_FOODS_MAX;
  return `
    <div class="view view--grouped diet-foods-view">
      ${navBar({ title: 'Mes aliments', large: true })}
      <div class="scr">
        ${list.length ? `
        ${full ? `<p class="diet-low" role="note">${icon('info.circle', 14)}<span>Mes aliments est plein (${DIET_FOODS_MAX}). Retire-en pour en garder d'autres.</span></p>` : ''}
        <p class="diet-foods__count num">${plural(list.length, 'aliment perso', 'aliments perso')}, ${DIET_FOODS_MAX} au plus</p>
        ${dietMacroLegendHtml()}
        <div class="group">${list.map(dietFoodCellHtml).join('')}</div>
        <div class="group-foot">Retirer un aliment ne change pas les plans. Tu pourras le recréer ou le scanner.</div>`
          : '<div class="empty-note">Aucun aliment perso. Ceux que tu crées ou scannes s\'affichent ici.</div>'}
      </div>
    </div>`;
}
SCREENS.set('diet-foods', { render: () => renderDietFoods() });

registerActions({
  'go-diet-settings': () => navigate('diet-settings'),
  'go-diet-foods': () => dietOpenFoods(),
  'diet-food-menu': async (e, el) => {
    const x = (data.dietFoods || []).find(f => f.id === el.dataset.id);
    if (!x) return;
    const v = await dialog({ type: 'sheet', title: foodName(x.name), message: 'Les plans ne changent pas.',
      actions: [{ label: 'Retirer de Mes aliments', value: 'del', style: 'destructive' }, { label: 'Annuler', style: 'cancel' }] });
    if (v !== 'del') return;
    const gone = dietRemoveFood(data, x.id);
    if (!gone) return;
    save(); haptic('light'); render(); dietSyncSoon();
    showToast(`Retiré : ${foodName(x.name)}`, { action: 'Annuler', duration: 5000, onAction: () => {
      if (dietRestoreFood(data, gone)) { save(); render(); dietSyncSoon(); announce(`Remis : ${foodName(x.name)}`); }
    } });
  },
  'diet-privacy': () => dietOpenPrivacy(),
  // Repas du jour : pré-remplis par le plan ou vides (js/data/nutrition.js, dietSetEmptyDays)
  'diet-day-mode': (e, el) => {
    const blank = el.dataset.blank === 'true';
    if (dietEmptyDaysFor(data, data.dietActive) === blank) return;
    dietSetEmptyDays(data, blank);
    save(); haptic(); render();
    announce(blank ? 'Repas du jour vides' : 'Repas du jour pré-remplis par le plan');
  },
  'diet-hide-numbers': () => {
    if (data.dietHideNumbers) delete data.dietHideNumbers; else data.dietHideNumbers = true;
    save(); haptic(); render();
  },
  'diet-streak': () => {
    if (data.dietStreakOff) delete data.dietStreakOff; else data.dietStreakOff = true;
    save(); haptic(); render();
  },
  'diet-consent': async () => {
    if (dietConsentOn(data)) {
      if (!(await confirmSheet('Retirer ton accord ?', `Tes plans sont supprimés du serveur et restent sur ${thisPhone()}.`, 'Retirer'))) return;
      dietSetConsent(data, false);
      save();
      dietSyncSoon();
      showToast(`Plans gardés sur ${thisPhone()} seulement`);
    } else if (await dietAskConsent()) showToast('Plans copiés sur ton compte');
    render();
  },
  'diet-coach-accept': async () => { await dietAskCoachAccept(); render(); },
  'diet-coach-toggle': async () => {
    if (dietCoachAccepted()) {
      if (!(await confirmSheet('Ne plus recevoir ses plans ?', PT.dietCoachRemove(myCoachWord('ton')), 'Retirer'))) return;
      await dietCoachApply(false);
    } else await dietAskCoachAccept();
    render();
  },
});
