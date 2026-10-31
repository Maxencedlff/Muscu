// ═══════════════════════════════════════════════════════════
//  Réglages › Notifications (app iOS, compte connecté) et toucher d'une notification
//  Donnée et appels : js/data/push.js. Contrat : docs/NOTIFICATIONS.md
// ═══════════════════════════════════════════════════════════
'use strict';

// Cellule des Réglages, groupe « Amis et coach » : seulement dans l'app iOS avec un compte (les
// notifications partent du serveur vers un compte). Valeur : « Activées » / « Désactivées ».
function pushSettingsCell() {
  if (!pushPossible()) return '';
  const on = pushAnyOn(push.prefs) && push.permission === 'granted';
  return `
          <button class="cell cell--nav" data-action="push-open">
            <span class="cell__body"><span class="cell__title">Notifications</span></span>
            <span class="cell__value">${push.prefs ? (on ? 'Activées' : 'Désactivées') : ''}</span>
            ${icon('chevron.right', 16)}
          </button>`;
}

function renderPushSettings() {
  const head = navBar({ title: 'Notifications', large: false });
  if (!pushPossible()) {
    return `<div class="view view--grouped push-view">${head}<div class="scr">
        <div class="empty-note">Les notifications demandent l'app iPhone et un compte.</div></div></div>`;
  }
  if (!push.prefs) {
    const note = push.error
      ? `<div class="group"><button class="cell cell--action" data-action="push-retry"><span class="cell__body"><span class="cell__title">${push.error === 'offline' ? 'Pas d’Internet' : 'Le serveur n’a pas répondu'}</span><span class="cell__sub">Touche pour réessayer.</span></span></button></div>`
      : '<div class="empty-note">Chargement…</div>';
    return `<div class="view view--grouped push-view">${head}<div class="scr">${note}</div></div>`;
  }
  const denied = push.permission === 'denied';
  const unavailable = push.permission === 'unavailable';
  const blocked = denied || unavailable;
  const warn = denied ? `
        <div class="group">
          <button class="cell cell--nav" data-action="push-open-ios-settings">
            <span class="cell__body"><span class="cell__title">Notifications coupées sur l'iPhone</span>
              <span class="cell__sub">Rallume-les dans Réglages › Notifications › MDLF Training</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>` : unavailable ? `
        <div class="group"><div class="cell"><span class="cell__body"><span class="cell__title">Mets l'app à jour</span>
          <span class="cell__sub">Cette version de l'app ne reçoit pas encore de notifications.</span></span></div></div>` : '';
  const rows = PUSH_TYPES.map(t => {
    const on = !blocked && push.prefs[t.id] === true;
    const busy = push.busy === t.id;
    return `
          <button class="cell" data-action="push-toggle" data-kind="${t.id}" role="switch" aria-checked="${on}"${blocked || push.busy ? ' aria-disabled="true"' : ''}${busy ? ' aria-busy="true"' : ''}>
            <span class="cell__body"><span class="cell__title">${esc(t.title)}</span>
              <span class="cell__sub">${esc(t.sub)}</span></span>
            ${switchHtml(on)}
          </button>`;
  }).join('');
  return `<div class="view view--grouped push-view">${head}<div class="scr">${warn}
        <div class="group-title">M'avertir</div>
        <div class="group${blocked ? ' group--disabled' : ''}">${rows}
        </div>
        <div class="group-foot">Tout est éteint au départ. La notification montre le pseudo de la personne, jamais le texte d'un commentaire. Les rappels de fin de repos ne changent pas.</div>
      </div></div>`;
}

SCREENS.set('notifications', { render: () => renderPushSettings(), enter: () => { pushLoad(); } });

// Écran affiché redessiné quand l'état change (lecture, interrupteur)
onPushChange(() => {
  const v = currentView();
  if (v === 'notifications' || v === 'settings') render();
});

// Toucher d'une notification (lancement à froid compris : iOS la garde jusqu'à cet abonnement)
function openPushTarget(p) {
  const t = pushTarget(p, data.history || []);
  if (!t) return;
  if (activeSession && currentView() === 'session') return;   // jamais arraché d'une séance en cours
  closeTransientUI();   // feuille ou dialogue ouvert : fermé avant de changer d'écran
  switchTab(t.tab, { reset: true });
  if (t.screen) navigate(makeRoute(t.screen, ...t.params));
  if (t.tab === 'friends') { socialRefresh(); coachRefresh(); }
}
Native.push.onTap(p => { try { openPushTarget(p); } catch { /* écran indisponible : l'app s'ouvre simplement */ } });
// Reçue app ouverte : badges des Amis et du coach relus sans attendre
Native.push.onReceive(() => { if (account.user) { socialRefresh({ minAge: 0 }); coachRefresh(); } });

const PUSH_FAIL_TEXT = {
  register: 'Inscription aux notifications impossible pour l’instant. Réessaie plus tard.',
  offline: 'Pas d’Internet. Réessaie une fois connecté.',
};

registerActions({
  'push-open': () => navigate('notifications'),
  'push-retry': () => { push.error = null; render(); pushLoad(); },
  'push-open-ios-settings': () => { Native.push.openSettings(); },
  'push-toggle': async (e, el) => {
    if (el.getAttribute('aria-disabled') === 'true') {
      if (push.permission === 'denied') showToast('Rallume les notifications dans les Réglages de l’iPhone');
      return;
    }
    const id = el.dataset.kind;
    const on = !(push.prefs?.[id] === true);
    haptic();
    const r = await pushSetPref(id, on);
    if (r.ok) return;
    if (r.reason === 'denied') {
      await dialog({ title: 'Notifications refusées',
        message: 'Pour les recevoir, autorise MDLF Training dans Réglages › Notifications de l’iPhone.',
        actions: [{ label: 'Plus tard', style: 'cancel' }, { label: 'Ouvrir Réglages', value: 'open', style: 'preferred' }] })
        .then(v => { if (v === 'open') Native.push.openSettings(); });
      return;
    }
    if (r.reason !== 'busy') showToast(PUSH_FAIL_TEXT[r.reason] || 'Réglage non enregistré. Réessaie.', { error: true });
  },
});
