// ═══════════════════════════════════════════════════════════
//  Réglages › Notifications (app iOS, compte connecté) et toucher d'une notification
//  Donnée et appels : js/data/push.js. Contrat : docs/NOTIFICATIONS.md
// ═══════════════════════════════════════════════════════════
'use strict';

// Cellule des Réglages, groupe « Social et coach » : seulement dans l'app iOS avec un compte (les
// notifications partent du serveur vers un compte). Valeur : « Activées » / « Désactivées » / « À réactiver »
// (réglages du compte allumés, mais pas encore d'accord d'iOS sur cet iPhone : réinstallation, nouvel iPhone).
function pushSettingsCell() {
  if (!pushPossible()) return '';
  const on = pushAnyOn(push.prefs) && push.permission === 'granted';
  const value = !push.prefs ? '' : on ? 'Activées' : pushNeedsReactivate() ? 'À réactiver' : 'Désactivées';
  return `
          <button class="cell cell--nav" data-action="push-open">
            ${cellIco('bell', 'blue')}
            <span class="cell__body"><span class="cell__title">Notifications</span></span>
            <span class="cell__value">${value}</span>
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
      ? `<div class="group"><button class="cell cell--action" data-action="push-retry"><span class="cell__body"><span class="cell__title">${push.error === 'offline' ? 'Pas d’Internet' : 'Le serveur n’a pas répondu'}</span><span class="cell__sub">${push.retriedAt ? `Toujours sans réponse (essai à ${new Date(push.retriedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}). Touche pour réessayer.` : 'Touche pour réessayer.'}</span></span></button></div>`
      : '<div class="empty-note">Chargement…</div>';
    return `<div class="view view--grouped push-view">${head}<div class="scr">${note}</div></div>`;
  }
  const denied = push.permission === 'denied';
  const unavailable = push.permission === 'unavailable';
  // Réinstallation ou nouvel iPhone : les réglages du compte sont allumés, mais rien n'arrivera ici avant
  // l'accord d'iOS et le jeton. Interrupteurs montrés éteints (vrai pour cet iPhone), une ligne pour réactiver.
  const reactivate = pushNeedsReactivate();
  const blocked = denied || unavailable || reactivate;
  const warn = reactivate ? `
        <div class="group">
          <button class="cell cell--action" data-action="push-reactivate"${push.busy ? ' aria-disabled="true"' : ''}${push.busy === 'reactivate' ? ' aria-busy="true"' : ''}>
            <span class="cell__body"><span class="cell__title">Réactiver sur cet iPhone</span>
              <span class="cell__sub">Tes réglages sont gardés sur ton compte. L'iPhone te demandera ton accord.</span></span>
          </button>
        </div>` : denied ? `
        <div class="group">
          <button class="cell cell--nav" data-action="push-open-ios-settings">
            <span class="cell__body"><span class="cell__title">Notifications coupées sur l'iPhone</span>
              <span class="cell__sub">Rallume-les dans Réglages › Notifications › MDLF Training</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>` : unavailable ? `
        <div class="group"><div class="cell"><span class="cell__body"><span class="cell__title">Mets l'app à jour</span>
          <span class="cell__sub">Cette version de l'app ne reçoit pas encore de notifications.</span></span></div></div>` : '';
  const rows = pushShownTypes().map(t => {
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
        <div class="group-foot">Tout est éteint au départ. La notification montre le pseudo de la personne, jamais le texte d'un commentaire ou d'un message (pour la séance d'un élève : son nom et sa durée, jamais les charges). Les rappels de fin de repos ne changent pas.</div>
      </div></div>`;
}

SCREENS.set('notifications', { render: () => renderPushSettings(), enter: () => { pushLoad(); } });

// Écran affiché redessiné quand l'état change (lecture, interrupteur)
onPushChange(() => {
  const v = currentView();
  if (v === 'notifications' || v === 'settings') render();
});

const PUSH_SOCIAL_KINDS = new Set(['follow_request', 'reaction', 'comment']);
// Toucher d'une notification (lancement à froid compris : iOS la garde jusqu'à cet abonnement)
function openPushTarget(p) {
  const t = pushTarget(p, data.history || []);
  if (!t) return;
  if (activeSession && currentView() === 'session') return;   // jamais arraché d'une séance en cours
  closeTransientUI();   // feuille ou dialogue ouvert : fermé avant de changer d'écran
  // Compte coach (onglet Coach à deux segments) : ce qui vient du social (demande d'abonnement, bravo, commentaire
  // d'un abonné) prépare le segment Social, le reste (messages, programmes) Élèves. Bravo et commentaire ouvrent la
  // séance dans l'Historique ; l'onglet Coach s'ouvre ensuite sur Social, là où est l'activité.
  const social = PUSH_SOCIAL_KINDS.has(p?.kind);
  if (t.tab === 'friends' || social) setSocialSeg(social ? 'friends' : t.seg || 'students');
  if (t.filter) { coachFilter = t.filter; coachShownN = COACH_PAGE; }
  switchTab(t.tab, { reset: true });
  // Social masqué par la tranche d'âge (js/data/age-range.js) : l'onglet seul, jamais un écran du social
  if (t.screen && !(socialHiddenByAge() && String(t.screen).startsWith('social-'))) {
    if (t.via) navigate(makeRoute(...t.via));
    navigate(makeRoute(t.screen, ...t.params));
  }
  if (t.tab === 'friends') { if (!socialHiddenByAge()) socialRefresh(); coachRefresh(); }
}
Native.push.onTap(p => { try { openPushTarget(p); } catch { /* écran indisponible : l'app s'ouvre simplement */ } });
// Reçue app ouverte : badges du social et du coach relus sans attendre
Native.push.onReceive(() => { if (account.user) { socialRefresh({ minAge: 0 }); coachRefresh(); } });

// Échec d'un allumage ou d'une réactivation : refus d'iOS expliqué avec un lien vers Réglages, sinon un message
async function pushExplainFailure(reason) {
  if (reason === 'denied') {
    const v = await dialog({ title: 'Notifications refusées',
      message: 'Pour les recevoir, autorise MDLF Training dans Réglages › Notifications de l’iPhone.',
      actions: [{ label: 'Plus tard', style: 'cancel' }, { label: 'Ouvrir Réglages', value: 'open', style: 'preferred' }] });
    if (v === 'open') Native.push.openSettings();
    return;
  }
  if (reason !== 'busy') showToast(PUSH_FAIL_TEXT[reason] || 'Réglage non enregistré. Réessaie.', { error: true });
}

const PUSH_FAIL_TEXT = {
  register: 'Inscription aux notifications impossible pour l’instant. Réessaie plus tard.',
  offline: 'Pas d’Internet. Réessaie une fois connecté.',
};

registerActions({
  'push-open': () => navigate('notifications'),
  // Heure de l'essai affichée si l'échec revient : sinon le message réapparaît identique et on croit
  // que le toucher n'a rien fait
  'push-retry': () => { push.error = null; push.retriedAt = Date.now(); render(); pushLoad(); },
  'push-open-ios-settings': () => { Native.push.openSettings(); },
  'push-reactivate': async (e, el) => {
    if (el.getAttribute('aria-disabled') === 'true') return;
    haptic();
    const r = await pushReactivate();
    if (!r.ok) await pushExplainFailure(r.reason);
  },
  'push-toggle': async (e, el) => {
    if (el.getAttribute('aria-disabled') === 'true') {
      if (push.permission === 'denied') showToast('Rallume les notifications dans les Réglages de l’iPhone');
      else if (pushNeedsReactivate()) showToast('Touche d’abord « Réactiver sur cet iPhone »');
      return;
    }
    const id = el.dataset.kind;
    const on = !(push.prefs?.[id] === true);
    haptic();
    const r = await pushSetPref(id, on);
    if (!r.ok) await pushExplainFailure(r.reason);
  },
});

// ── Demande en contexte (js/data/push.js, pushAskCheck) ─────
// Feuille d'iOS, une à la fois, seulement si l'écran qui l'a demandée est toujours là et qu'aucune autre
// feuille n'est ouverte. Le serveur ne montre jamais le texte d'un message : c'est dit dans la feuille.
const PUSH_ASK_TEXT = {
  student: { title: 'Être prévenu quand ton coach t’écrit ?',
    message: 'Aussi quand il commente une séance ou t’envoie un programme. La notification montre son pseudo, jamais le texte. Modifiable dans Réglages › Notifications.' },
  coach: { title: 'Être prévenu quand un élève t’écrit ou termine une séance ?',
    message: 'La notification montre son pseudo, le nom de la séance et sa durée ; jamais le texte d’un message ni les charges. Modifiable dans Réglages › Notifications.' },
};
let pushAsking = false;
async function pushAskInContext(role, stillHere = () => true) {
  if (pushAsking || !PUSH_ASK_TEXT[role]) return;
  pushAsking = true;
  try {
    const d = await pushAskCheck(role);
    if (d === 'done') { pushAskDone(); return; }
    if (d !== 'ask' || !stillHere() || document.querySelector('.ios-dialog:not(.ios-dialog--out), .sheet-root:not(.sheet-root--out)')) return;
    if (activeSession && currentView() === 'session') return;
    const v = await dialog({ type: 'sheet', ...PUSH_ASK_TEXT[role],
      actions: [{ label: 'Activer', value: 'on', style: 'preferred' }, { label: 'Plus tard', style: 'cancel' }] });
    if (v !== 'on') { pushAskLater(); return; }
    haptic();
    const r = await pushEnableFor(role);
    if (r.ok) { pushAskDone(); showToast('Notifications activées'); return; }
    // Refus d'iOS (la fenêtre ne reviendra pas : ligne vers Réglages dans la conversation) ou build sans le module
    if (r.reason === 'denied' || r.reason === 'unavailable') { pushAskDone(); return; }
    pushAskLater();
    await pushExplainFailure(r.reason);
  } catch { /* écran parti, réseau : redemandé à la prochaine occasion */ } finally { pushAsking = false; }
}

// Conversation, notifications refusées dans iOS : réglages de l'app dans l'app Réglages (module MdlfPush,
// openSettings) ; build où il ne répond pas : Réglages › Notifications de l'app, qui l'explique
async function pushOpenIosSettingsChat() {
  if (!(await Native.push.openSettings())) navigate('notifications');
}
registerActions({ 'push-open-ios-settings-chat': () => { pushOpenIosSettingsChat(); } });

// ── Rappel à l'ouverture « Notifications désactivées » (js/data/push.js, pushRemindCheck) ─────
// Appelé une fois par lancement (init.js), une fois les données du compte arrivées et Bienvenue / les
// questions de départ ouvertes s'il le fallait : rien s'il y a déjà une feuille, un écran plein, une séance.
// Une phrase sur ce qui n'arrive pas, selon le rôle ; « Activer » : fenêtre d'iOS puis les types utiles
// (pushEnableFor), ou, refusées dans iOS, les réglages de l'app dans l'app Réglages.
const PUSH_REMIND_TEXT = {
  student: 'Tu ne reçois pas les messages et les programmes de ton coach.',
  coach: 'Tu ne reçois pas les messages de tes élèves.',
  solo: 'Tu ne reçois pas les bravos et les commentaires sur tes séances.',
};
const PUSH_SETTINGS_PATH = 'Réglages › MDLF Training › Notifications';
const PUSH_REMIND_DELAY_MS = 800;   // l'accueil dessiné d'abord ; Bienvenue ou les questions ouvertes avant
let pushRemindTried = false;

function pushRemindBlocked() {
  return !!activeSession || document.visibilityState === 'hidden'
    || !!document.querySelector('.auth, .onb, .min-build, ' + OPEN_MODAL_SEL);
}

function pushRemindRoleNow() {
  const r = coachRole();
  return pushRemindRole({ isCoach: r.isCoach, hasCoach: r.hasCoach, social: socialEnabled() });
}

async function pushRemindAtLaunch({ delay = PUSH_REMIND_DELAY_MS } = {}) {
  if (pushRemindTried) return;
  pushRemindTried = true;
  if (delay) await new Promise(r => setTimeout(r, delay));
  if (pushAsking || pushRemindBlocked()) return;
  const role = pushRemindRoleNow();
  pushAsking = true;   // la demande en contexte attend (une feuille à la fois)
  try {
    const d = await pushRemindCheck(role, { inSession: !!activeSession });
    if (d === 'done') { pushRemindDone(); return; }
    if (d !== 'show' || pushRemindBlocked()) return;
    const denied = push.permission === 'denied';
    const message = PUSH_REMIND_TEXT[role] + (denied ? ` Elles se rallument dans ${PUSH_SETTINGS_PATH}.` : '');
    pushRemindLater();   // compté dès qu'il est montré (app fermée sans répondre comprise)
    const v = await dialog({ type: 'sheet', title: 'Notifications désactivées', message,
      actions: [{ label: 'Activer', value: 'on', style: 'preferred' }, { label: 'Plus tard', style: 'cancel' }] });
    if (v !== 'on') return;
    haptic();
    if (denied) { await pushRemindOpenSettings(role); return; }
    const r = await pushEnableFor(role);
    if (r.ok) { pushRemindDone(); showToast('Notifications activées'); return; }
    // Refusées dans la fenêtre d'iOS à l'instant, ou build sans le module : on ne revient pas à la charge
    if (r.reason === 'denied' || r.reason === 'unavailable') { pushRemindDone(); return; }
    await pushExplainFailure(r.reason);
  } catch { /* réseau, écran parti : redemandé à l'ouverture suivante (dans la limite) */ } finally { pushAsking = false; }
}

// Refusées dans iOS : réglages de l'app dans l'app Réglages (MdlfPush.openSettings, présent dans toute build qui a
// le module). Au retour, autorisées : les types utiles sont allumés (le toucher sur « Activer » le demandait).
// Réglages qui ne s'ouvrent pas : le chemin, en clair.
async function pushRemindOpenSettings(role) {
  if (!(await Native.push.openSettings())) { showToast(PUSH_SETTINGS_PATH, { duration: 5000 }); return; }
  const back = async () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', back);
    await pushRefreshPermission();
    if (push.permission !== 'granted') return;
    if (pushAnyOn(push.prefs)) { pushRemindDone(); return; }
    const r = await pushEnableFor(role);
    if (r.ok) { pushRemindDone(); showToast('Notifications activées'); }
  };
  document.addEventListener('visibilitychange', back);
}
