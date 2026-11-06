// ═══════════════════════════════════════════════════════════
//  Réglages de la nutrition et accord de copie sur le compte (Nutrition V1, docs/NUTRITION_V1.md « Santé »)
//
//  - Écran diet-settings (bas de l'écran Nutrition, Plans diète) : masquer les calories et les grammes de
//    macros (seules les cases des repas restent), afficher la série, accord pour copier les plans sur le compte.
//  - Accord (dietConsent, js/data/nutrition.js) : les plans diète et les objectifs peuvent renseigner sur la
//    santé (CNIL) ; ils ne partent sur le compte, et un plan du coach n'est reçu, qu'avec un accord explicite et
//    daté. Question posée une fois, avec un compte, dès qu'un plan existe ; changeable ici. Retirer l'accord :
//    le profil envoyé ne les contient plus, ils sont effacés du serveur et restent sur l'iPhone.
// ═══════════════════════════════════════════════════════════
'use strict';

const DIET_CONSENT_TEXT = 'Tes plans diète et tes objectifs (calories, protéines, glucides, lipides) peuvent renseigner sur ta santé. Avec ton accord, ils sont copiés sur le serveur de l\'app pour les retrouver sur tes appareils et recevoir les plans de ton coach. Sans ton accord, ils restent sur cet iPhone. Tu peux changer d\'avis dans Réglages.';

let dietConsentOpen = false;   // une seule question à la fois

// Demande l'accord ; renvoie true s'il est donné (déjà, ou maintenant)
async function dietAskConsent() {
  if (dietConsentOn(data)) return true;
  if (dietConsentOpen) return false;
  dietConsentOpen = true;
  try {
    const v = await dialog({ title: 'Tes plans diète', message: DIET_CONSENT_TEXT, actions: [
      { label: 'Garder sur cet iPhone', value: 'no' },   // un vrai choix (enregistré), pas « Annuler »
      { label: 'J\'accepte', value: 'yes', style: 'preferred' },
    ] });
    if (v !== 'yes' && v !== 'no') return false;   // fermée sans choisir : reposée plus tard
    dietSetConsent(data, v === 'yes');
    save();
    dietSyncSoon();
    return v === 'yes';
  } finally { dietConsentOpen = false; }
}
// Avant de recevoir un plan du coach : l'accord, demandé s'il ne l'est pas encore (ou refusé avant)
async function dietEnsureConsent() { return dietConsentOn(data) || dietAskConsent(); }
// À l'ouverture de Nutrition ou des plans : une fois, avec un compte, quand un plan existe
function dietMaybeAskConsent() {
  if (!account.user || data.dietConsentAsked || data.dietConsent || !dietPlanIds(data).length) return;
  setTimeout(() => { if (!data.dietConsentAsked && !data.dietConsent) dietAskConsent().then(() => render()); }, 400);
}
// Le profil part (ou efface les plans du serveur) sans attendre la prochaine synchro
function dietSyncSoon() {
  if (account.user && typeof syncNow === 'function') syncNow().catch?.(() => {});
}

function renderDietSettings() {
  const sw = (action, on, title, sub = '') => `
          <button class="cell" data-action="${action}" role="switch" aria-checked="${on}">
            <span class="cell__body"><span class="cell__title">${title}</span>${sub ? `<span class="cell__sub">${sub}</span>` : ''}</span>
            ${switchHtml(on)}
          </button>`;
  const c = data.dietConsent;
  const since = c?.on ? `Accord donné le ${esc(fmtDate(Date.parse(c.at), 'short'))}.` : c ? 'Tes plans restent sur cet iPhone.' : '';
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
          ${sw('diet-consent', dietConsentOn(data), 'Copier mes plans sur le serveur', since)}
        </div>
        <div class="group-foot">${esc(DIET_CONSENT_TEXT.replace(' Tu peux changer d\'avis dans Réglages.', ''))} Retirer ton accord efface tes plans du serveur ; ils restent sur cet iPhone. Les repas que tu coches ne quittent jamais l'iPhone.</div>`
          : '<div class="group-foot">Sans compte, tes plans et tes repas cochés restent sur cet iPhone.</div>'}
      </div>
    </div>`;
}
SCREENS.set('diet-settings', { render: () => renderDietSettings() });

registerActions({
  'go-diet-settings': () => navigate('diet-settings'),
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
      if (!(await confirmSheet('Retirer ton accord ?', 'Tes plans diète sont effacés du serveur et restent sur cet iPhone. Tu ne pourras plus recevoir les plans de ton coach.', 'Retirer'))) return;
      dietSetConsent(data, false);
      save();
      dietSyncSoon();
      showToast('Plans gardés sur cet iPhone seulement');
    } else if (await dietAskConsent()) showToast('Plans copiés sur ton compte');
    render();
  },
});
