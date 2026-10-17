// ═══════════════════════════════════════════════════════════
//  Réglages › Icône de l'app (app iOS uniquement)
// ═══════════════════════════════════════════════════════════
'use strict';

// Catalogue et dessin des vignettes : js/data/app-icons.js. Changement : Native.appIcon (module
// Swift AppIconPlugin). Dans le navigateur, la section n'existe pas : une PWA ne peut pas changer
// son icône. iOS confirme lui-même chaque changement par une alerte : elle n'est pas masquée.

// Lu une fois au démarrage : seule l'app change l'icône, l'état reste donc juste ensuite
let appIconState = { supported: false, name: null };
let appIconBusy  = false;

if (Native.isNative) {
  Native.appIcon.get().then(s => {
    appIconState = s;
    if (s.supported && $('.settings-view')) render();   // Réglages déjà affichés
  });
}

function renderAppIconGroup() {
  if (!Native.isNative || !appIconState.supported) return '';
  const current = appIconFromNative(appIconState.name);
  const tiles = APP_ICONS.map(i => {
    const on = i === current;
    return `<button class="app-icon" data-action="set-app-icon" data-id="${i.id}" aria-pressed="${on}">
              <span class="app-icon__img">${appIconSvg(i, { attrs: 'aria-hidden="true" focusable="false"' })}
                ${on ? `<span class="app-icon__check">${icon('checkmark', 13)}</span>` : ''}</span>
              <span class="app-icon__name">${esc(i.label)}</span>
            </button>`;
  }).join('');
  return `
        <div class="group-title" id="appIconTitle">Icône de l'app</div>
        <div class="group group--pad">
          <div class="app-icons" role="group" aria-labelledby="appIconTitle">${tiles}</div>
        </div>
        <div class="group-foot">L'icône change sur l'écran d'accueil ; iOS le confirme par une alerte.</div>`;
}

registerActions({
  'set-app-icon': async (e, el) => {
    const chosen = APP_ICONS.find(i => i.id === el.dataset.id);
    if (!chosen || appIconBusy || chosen === appIconFromNative(appIconState.name)) return;
    appIconBusy = true;
    const name = nativeAppIconName(chosen.id);
    const ok = await Native.appIcon.set(name);
    appIconBusy = false;
    if (!ok) { showToast('L\'icône n\'a pas pu être changée', { error: true }); return; }
    appIconState = { ...appIconState, name };
    if (currentView() !== 'settings') return;
    render();
    // Le rendu remplace les boutons : le focus revient sur la vignette choisie (VoiceOver annonce « sélectionné »)
    $(`.app-icon[data-id="${chosen.id}"]`)?.focus({ preventScroll: true });
  },
});
