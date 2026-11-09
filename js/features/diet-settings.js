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
//  - Écran diet-settings : masquer les calories et les grammes de macros, afficher la série, les accords.
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
  const coachText = coachRole().isCoach ? 'Tes plans diète, y compris ceux que tu prépares pour tes élèves, peuvent renseigner sur la santé.'
    : 'Tes plans diète et tes objectifs peuvent renseigner sur ta santé.';
  const v = await dietAskShort('Copier tes plans sur ton compte ?',
    `${coachText} Avec ton accord, ils sont copiés sur ton compte ; sans lui, ils restent sur cet iPhone.`,
    'Copier sur mon compte', 'Garder sur cet iPhone');
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
async function dietAskCoachAccept() {
  if (dietCoachAccepted()) return true;
  const who = coachName();
  const v = await dietAskShort(`Recevoir les plans diète ${elide('de', who)} ?`,
    `Ton coach pourra t'envoyer des plans diète, gardés sur le serveur jusqu'à ce que tu retires ton accord. Ils peuvent renseigner sur ta santé.`,
    'Accepter', 'Pas maintenant');
  if (!v) return false;
  return dietCoachApply(true);
}
async function dietCoachApply(on) {
  const r = await dietCoachSetAccept(on);
  if (!r.ok) { showToast(coachErrorText(r.kind), { error: true }); return false; }
  save();
  haptic();
  showToast(on ? (dietPending() ? 'Réception activée. Touche Utiliser pour commencer le plan' : 'Réception des plans diète activée') : 'Plans diète du coach effacés du serveur');
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
  const since = c?.on ? `Accord donné le ${esc(fmtDate(Date.parse(c.at), 'short'))}.` : c ? 'Tes plans restent sur cet iPhone.' : '';
  const hasCoach = account.user && !!myCoach();
  return `
    <div class="view view--grouped diet-settings-view">
      ${navBar({ title: 'Réglages', large: true, largeTitle: 'Réglages de la nutrition' })}
      <div class="scr">
        <div class="group-title">Affichage</div>
        <div class="group">
          ${sw('diet-hide-numbers', data.dietHideNumbers === true, 'Masquer les calories et les grammes', 'Seules les cases des repas restent ; les quantités des aliments aussi.')}
          ${sw('diet-streak', data.dietStreakOff !== true, 'Afficher la série', 'Jours complets d\'affilée')}
        </div>
        ${account.user ? `
        <div class="group-title">Compte</div>
        <div class="group">
          ${sw('diet-consent', dietConsentOn(data), 'Copier mes plans sur mon compte', since)}
        </div>
        ${account.dietTooBig ? '<p class="diet-low" role="note">Tes plans sont trop lourds pour être copiés sur ton compte : supprime des plans dont tu ne te sers plus. Le reste de ton compte se synchronise normalement.</p>' : ''}
        <div class="group-foot">Avec ton accord, tes plans diète, tes objectifs et tes aliments perso sont copiés sur le serveur de l'app pour les retrouver sur tes appareils. Retirer ton accord les efface du serveur.</div>` : ''}
        ${hasCoach ? `
        <div class="group-title">Coach</div>
        <div class="group">
          ${sw('diet-coach-toggle', dietCoachAccepted(), `Recevoir les plans diète ${elide('de', esc(coachName()))}`)}
        </div>
        <div class="group-foot">Les plans de ton coach sont gardés sur le serveur jusqu'à ce que tu retires ton accord ou que le coaching s'arrête ; ton coach voit seulement si tu les as ouverts.</div>` : ''}
        <div class="group-foot diet-foot">Dans tous les cas, tes plans sont sur cet iPhone, dans la copie iCloud de l'app et dans tes exports. Les repas que tu coches et les aliments que tu remplaces n'en sortent jamais : ni serveur, ni coach.</div>
        <div class="group group--gap"><button class="cell cell--nav" data-action="diet-privacy">
          <span class="cell__body"><span class="cell__title">Confidentialité de la nutrition</span></span>${icon('chevron.right', 16)}</button></div>
      </div>
    </div>`;
}
SCREENS.set('diet-settings', { render: () => renderDietSettings() });

registerActions({
  'go-diet-settings': () => navigate('diet-settings'),
  'diet-privacy': () => dietOpenPrivacy(),
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
      if (!(await confirmSheet('Retirer ton accord ?', 'Tes plans diète sont effacés du serveur et restent sur cet iPhone.', 'Retirer'))) return;
      dietSetConsent(data, false);
      save();
      dietSyncSoon();
      showToast('Plans gardés sur cet iPhone seulement');
    } else if (await dietAskConsent()) showToast('Plans copiés sur ton compte');
    render();
  },
  'diet-coach-accept': async () => { await dietAskCoachAccept(); render(); },
  'diet-coach-toggle': async () => {
    if (dietCoachAccepted()) {
      if (!(await confirmSheet('Ne plus recevoir ses plans ?', 'Les plans diète que ton coach t\'a envoyés sont effacés du serveur. Ceux que tu suis déjà restent sur cet iPhone.', 'Retirer'))) return;
      await dietCoachApply(false);
    } else await dietAskCoachAccept();
    render();
  },
});
