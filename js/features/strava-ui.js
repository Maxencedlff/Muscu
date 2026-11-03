// ═══════════════════════════════════════════════════════════
//  Strava, écrans. Contrat : docs/STRAVA.md ; données et appels : js/data/strava.js.
//
//  - Réglages › Connexions › Strava (`strava`) : sans compte, pourquoi il en faut un ; pas relié, le
//    bouton officiel « Connect with Strava » (charte Strava : image fournie par Strava, jamais retouchée)
//    qui ouvre la page d'autorisation dans Safari, puis l'état relu au retour ; relié, le prénom, le nombre
//    de séances envoyées et « Déconnecter Strava » (révoque et efface, après confirmation).
//  - Bilan et Historique › Séance (`stravaSummaryGroup`, `stravaHistoryGroup`) : « Envoyer vers Strava »
//    pour une séance envoyable, puis « View on Strava » (libellé imposé par la charte de Strava, en gras).
//    Rien n'est envoyé automatiquement : chaque séance part sur un toucher.
//  Strava éteint (stravaEnabled, js/data/strava.js) : ni groupe Connexions, ni écran (route retirée
//  par navSanitize), ni cellule d'envoi, ni appel au serveur.
//  Tout texte venu du serveur passe par esc(). Rien au pointerdown : actions au clic seulement.
// ═══════════════════════════════════════════════════════════
'use strict';

const STRAVA_BUTTON_IMG = 'img/strava/connect-with-strava.svg';

// ── Réglages › Connexions ───────────────────────────────────

function renderConnectionsGroup() {
  if (!stravaEnabled() || !accountAvailable()) return '';
  const value = stravaConnected() ? 'Relié' : '';
  return `
        <div class="group-title">Connexions</div>
        <div class="group">
          <button class="cell cell--nav" data-action="strava-open-settings">
            <span class="cell__body"><span class="cell__title">Strava</span>
              <span class="cell__sub">Envoie tes séances terminées</span></span>
            <span class="cell__value">${value}</span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

const STRAVA_SENT_TEXT = 'Ce qui part vers Strava : le nom de la séance, l\'heure, la durée, les exercices et les séries. Jamais tes notes, ton poids ni tes données Santé.';

function renderStravaSettings() {
  const head = navBar({ title: 'Strava', large: false });
  const hero = (sub) => `
        <div class="social-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('link', 40)}</span>
          <h2 class="social-hero__title">Tes séances sur Strava</h2>
          <p class="social-hero__sub">${sub}</p>
        </div>`;
  if (!account.user) {
    return `<div class="view view--grouped strava-view">${head}<div class="scr">
        ${hero('Envoie une séance terminée sur Strava en un toucher. Il faut un compte, gratuit.')}
        <button class="btn btn--primary btn--full" data-action="social-sign-in">Se connecter</button>
      </div></div>`;
  }
  const st = strava.state;
  if (!st) {
    return `<div class="view view--grouped strava-view">${head}<div class="scr">${strava.error
      ? `<div class="social-note" role="status"><p>${esc(stravaErrorText(strava.error))}</p><button class="social-note__btn" data-action="strava-retry">Réessayer</button></div>`
      : '<div class="empty-note">Chargement…</div>'}</div></div>`;
  }
  const stale = strava.error ? `<p class="social-inline-error" role="status">${esc(strava.error === 'offline' ? 'Pas d\'Internet : pas à jour.' : stravaErrorText(strava.error))}</p>` : '';
  if (!st.connected) {
    return `<div class="view view--grouped strava-view">${head}<div class="scr">${stale}
        ${hero('Relie ton compte Strava, puis envoie une séance depuis son bilan ou l\'historique.')}
        <div class="strava-connect-wrap">
          <button class="strava-connect" data-action="strava-connect" aria-label="Connect with Strava, s'ouvre dans Safari"${strava.connecting === 'opening' ? ' disabled' : ''}>
            <img src="${STRAVA_BUTTON_IMG}" width="237" height="48" alt="">
          </button>
        </div>
        ${strava.connecting ? '<p class="strava-hint" role="status">Autorise MDLF Training dans Safari, puis reviens ici.</p>' : ''}
        <div class="group-foot strava-foot">${STRAVA_SENT_TEXT} MDLF Training ne lit rien sur ton compte Strava.</div>
      </div></div>`;
  }
  const n = Object.keys(st.exports).length;
  return `<div class="view view--grouped strava-view">${head}<div class="scr">${stale}
        <div class="group">
          <div class="cell"><span class="cell__body"><span class="cell__title">Compte Strava</span></span>
            <span class="cell__value">${st.name ? esc(st.name) : 'Relié'}</span></div>
          <div class="cell"><span class="cell__body"><span class="cell__title">Séances envoyées</span></span>
            <span class="cell__value num">${n}</span></div>
        </div>
        ${st.canWrite ? `<div class="group-foot">Envoie une séance depuis son bilan, ou depuis Historique › Séance. ${STRAVA_SENT_TEXT}</div>`
          : `<div class="group-foot strava-warn" role="status">Strava ne nous permet pas de créer d'activité. Déconnecte Strava, puis relie-le en laissant la case « Créer des activités » cochée.</div>`}
        <div class="group">
          <button class="cell cell--destructive" data-action="strava-disconnect">Déconnecter Strava</button>
        </div>
        <div class="group-foot">MDLF Training perd l'accès à ton compte Strava et oublie ce qu'il en savait. Les activités déjà envoyées restent sur Strava.</div>
      </div></div>`;
}
// Éteint : aucune entrée n'y mène, et navSanitize (js/ui/router.js) retire la route d'un ancien historique
SCREENS.set('strava', { render: () => renderStravaSettings(), enter: () => { stravaRefresh({ minAge: 5000 }); } });

// ── Bilan et Historique › Séance ────────────────────────────

// Cellule d'envoi d'une séance : « Envoyer vers Strava », « Envoi… », ou « Sur Strava » et son lien
function stravaCell(h, rowClass, mainHtml) {
  const activity = stravaActivityOf(h.id);
  if (activity) {
    return `<div class="${rowClass} strava-sent">${mainHtml('Sur Strava')}
            <button class="strava-view-link" data-action="strava-view" data-id="${esc(h.id)}">View on Strava</button></div>`;
  }
  const sending = strava.sending.has(h.id);
  return `<button class="${rowClass} cell--action strava-send" data-action="strava-export" data-id="${esc(h.id)}"${sending ? ' disabled aria-busy="true"' : ''}>
            ${mainHtml(sending ? 'Envoi…' : 'Envoyer vers Strava')}</button>`;
}

function stravaShown(h) { return !!h && stravaConnected() && stravaExportable(h); }

function stravaHistoryInner(h) {
  if (!stravaShown(h)) return '';
  return `
        <div class="group-title">Strava</div>
        <div class="group">
          ${stravaCell(h, 'cell', t => `<span class="cell__body"><span class="cell__title">${t}</span></span>`)}
        </div>`;
}
function stravaSummaryInner(h) {
  if (!stravaShown(h)) return '';
  return `
        <div class="sum-section-title">Strava</div>
        <div class="sum-list">
          ${stravaCell(h, 'sum-row sum-row--action', t => `<div class="sum-row__main"><div class="sum-row__name">${t}</div></div>`)}
        </div>`;
}
// Boîte redessinée seule quand l'état change (stravaRefreshBox) : la saisie des notes du bilan garde
// son curseur et l'écran son défilement
function stravaBox(h, kind) {
  return `<div id="stravaBox" data-id="${esc(h?.id || '')}" data-kind="${kind}">${kind === 'summary' ? stravaSummaryInner(h) : stravaHistoryInner(h)}</div>`;
}
function stravaHistoryGroup(h) { return stravaBox(h, 'history'); }
function stravaSummaryGroup(h) { return h ? stravaBox(h, 'summary') : ''; }
function stravaRefreshBox() {
  const box = $('#stravaBox');
  if (!box) return;
  const h = (data.history || []).find(x => x.id === box.dataset.id);
  const kind = box.dataset.kind;
  box.innerHTML = kind === 'summary' ? stravaSummaryInner(h) : stravaHistoryInner(h);
}

// ── Actions ─────────────────────────────────────────────────

function stravaToast(r, okText) {
  if (r.ok) { if (okText) showToast(okText); return true; }
  showToast(stravaErrorText(r.kind), { error: true });
  return false;
}

registerActions({
  'strava-open-settings': () => navigate('strava'),
  'strava-retry': async () => { await stravaRefresh(); },
  'strava-connect': async () => {
    if (strava.connecting === 'opening') return;
    strava.connecting = 'opening';
    render();
    const r = await stravaConnectUrl();
    if (!r.ok) { strava.connecting = false; render(); stravaToast(r); return; }
    strava.connecting = true;
    render();
    // Après un appel réseau : plus de geste en cours, window.open serait bloqué dans l'app (Native.openOutside)
    Native.openOutside(r.url);
  },
  'strava-export': async (e, el) => {
    const h = (data.history || []).find(x => x.id === el?.dataset.id);
    if (!h) return;
    haptic();
    const r = await stravaExport(h);
    if (r.ok) announce(r.already ? 'Déjà sur Strava' : 'Séance envoyée sur Strava');
    stravaToast(r, r.ok ? (r.already ? 'Déjà sur Strava' : 'Envoyée sur Strava') : '');
  },
  'strava-view': (e, el) => {
    const url = stravaActivityUrl(stravaActivityOf(el?.dataset.id));
    if (url) Native.openOutside(url);
  },
  'strava-disconnect': async () => {
    const ok = await confirmSheet('Déconnecter Strava ?', 'MDLF Training n\'aura plus accès à ton compte Strava. Les activités déjà envoyées restent sur Strava.', 'Déconnecter');
    if (!ok) return;
    const r = await stravaDisconnect();
    if (!r.ok) { stravaToast(r); return; }
    if (r.revoked) { showToast('Strava déconnecté'); return; }
    // Strava n'a pas confirmé : la liaison est effacée ici, l'accès reste à retirer chez Strava
    const open = await dialog({ title: 'Strava déconnecté', message: 'Strava n\'a pas répondu. Pour être sûr que l\'accès est retiré, ouvre tes applications autorisées sur Strava et retire MDLF Training.',
      actions: [{ label: 'Plus tard', style: 'cancel' }, { label: 'Ouvrir Strava', value: true, style: 'preferred' }] });
    if (open === true) Native.openOutside(STRAVA_APPS_URL);   // après la feuille : plus de geste en cours
  },
});

// Écrans ouverts redessinés quand l'état de Strava change (connexion relue au retour de Safari, envoi)
onStravaChange(() => {
  const v = currentView();
  if (v === 'strava' || v === 'settings') render();
  else stravaRefreshBox();
});
