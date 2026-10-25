// ═══════════════════════════════════════════════════════════
//  Compte : cellule en tête des Réglages (façon identifiant Apple), écran Réglages › Compte (pseudo,
//  avatar, moyens de connexion, sauvegarde, déconnexion, suppression), carte de l'accueil, écran
//  Bienvenue au premier lancement. Les écrans plein écran (Bienvenue, e-mail, code, pseudo, avatar)
//  sont dans js/features/auth-flow.js ; la logique dans js/data/account.js et js/data/account-auth.js.
//  Jamais de mur de connexion : tout reste utilisable sans compte.
// ═══════════════════════════════════════════════════════════
'use strict';

// Logo Apple des boutons « Continuer avec Apple » (charte Apple : logo, texte, fond noir ou blanc)
const APPLE_LOGO = '<svg class="auth-btn__logo" viewBox="0 0 170 170" aria-hidden="true" focusable="false"><path fill="currentColor" d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.2-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.27 2.13-9.51 3.24-12.75 3.35-4.93.21-9.84-1.96-14.75-6.52-3.13-2.73-7.05-7.41-11.74-14.04-5.03-7.08-9.17-15.29-12.41-24.65-3.47-10.11-5.21-19.9-5.21-29.38 0-10.86 2.35-20.22 7.04-28.07 3.69-6.3 8.6-11.27 14.75-14.92s12.79-5.51 19.95-5.63c3.91 0 9.05 1.21 15.43 3.59 6.36 2.39 10.45 3.6 12.24 3.6 1.34 0 5.88-1.42 13.57-4.24 7.27-2.62 13.41-3.7 18.44-3.28 13.63 1.1 23.87 6.47 30.68 16.15-12.19 7.39-18.22 17.73-18.1 31 .11 10.34 3.86 18.94 11.23 25.77 3.34 3.17 7.07 5.62 11.22 7.36-.9 2.61-1.85 5.11-2.86 7.51zM119.11 7.24c0 8.1-2.96 15.67-8.86 22.67-7.12 8.32-15.73 13.13-25.07 12.37a25.2 25.2 0 0 1-.19-3.07c0-7.78 3.39-16.1 9.4-22.9 3-3.44 6.82-6.31 11.45-8.6 4.62-2.25 8.99-3.5 13.1-3.71.12 1.08.17 2.17.17 3.24z"/></svg>';
// « G » de Google (charte Google Identity : logo multicolore, couleurs de la marque dans l'image)
const GOOGLE_LOGO = '<svg class="auth-btn__logo" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const MAIL_ICON = '<svg class="auth-btn__logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg>';

// Page publique (aussi déclarée dans App Store Connect) ; _blank l'ouvre dans Safari, hors de l'app
const PRIVACY_URL = 'https://muscu-eta.vercel.app/privacy.html#compte';
const PROVIDER_NAMES = { apple: 'Apple', google: 'Google', email: 'un e-mail' };
// « Tu étais connecté avec … », « utilise … » : moyen de la dernière connexion
const METHOD_PHRASE = { apple: 'Apple', google: 'Google', email: 'un code par e‑mail' };

// « e‑mail » : trait d'union insécable (U+2011), jamais coupé en fin de ligne sur un petit écran
// Boutons de connexion, du plus au moins recommandé (Bienvenue et Compte). Google masqué tant que
// son client n'est pas configuré dans l'app (account.google).
function signInButtonsHtml() {
  return `
    <button class="auth-btn auth-btn--apple" data-action="auth-provider" data-provider="apple">${APPLE_LOGO}<span>Continuer avec Apple</span></button>
    ${account.google ? `<button class="auth-btn auth-btn--google" data-action="auth-provider" data-provider="google">${GOOGLE_LOGO}<span>Continuer avec Google</span></button>` : ''}
    <button class="auth-btn auth-btn--mail" data-action="auth-email">${MAIL_ICON}<span>Continuer avec un e‑mail</span></button>`;
}

function avatarHtml(size = 'm', emoji = account.profile?.avatar) {
  if (!account.user) return `<span class="avatar avatar--${size} avatar--empty" aria-hidden="true">${icon('dumbbell', size === 'xl' ? 40 : 24)}</span>`;
  return `<span class="avatar avatar--${size}" aria-hidden="true">${esc(validAvatar(emoji))}</span>`;
}
function accountName() { return account.profile?.username || 'Mon compte'; }
function providerLine(user = account.user) {
  const p = primaryProvider(user);
  return p ? `Connecté avec ${PROVIDER_NAMES[p] === 'un e-mail' ? 'un code par e-mail' : PROVIDER_NAMES[p]}` : 'Connecté';
}

// ── Réglages : cellule du compte en tête ────────────────────

// Absente dans le navigateur ou une coquille iOS sans le module
function renderAccountGroup() {
  if (!accountAvailable()) return '';
  return `
        <div class="group account-head" id="accountGroup">${renderAccountGroupInner()}</div>`;
}

function renderAccountGroupInner() {
  if (!account.ready) {
    return `<div class="cell account-cell"><span class="cell__body"><span class="cell__sub">Chargement…</span></span></div>`;
  }
  const signedIn = !!account.user;
  const name = signedIn ? accountName() : 'Se connecter';
  const info = signedIn ? null : accountReconnectInfo();
  const sub = signedIn ? 'Compte et sauvegarde' : info?.ended ? 'Ta session a pris fin' : info ? 'Reconnecte-toi pour reprendre la sauvegarde' : 'Sauvegarde tes séances sur un compte';
  return `
          <button class="cell cell--nav account-cell" data-action="go-account" aria-label="${esc(signedIn ? `${name}, ${sub}` : `${name}. ${sub}`)}">
            ${avatarHtml('l')}
            <span class="cell__body"><span class="account-cell__name">${esc(name)}</span><span class="cell__sub">${esc(sub)}</span></span>
            ${icon('chevron.right', 16)}
          </button>`;
}

// ── Écran Compte ────────────────────────────────────────────

// « Sauvegardé aujourd'hui à 10:02 », « hier à … », « le 21 oct. à … »
function savedAtText(ts) {
  const d = new Date(ts), time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return `aujourd'hui à ${time}`;
  if (days === 1) return `hier à ${time}`;
  return `le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${time}`;
}

function syncStatusText() {
  if (account.syncing) return 'Sauvegarde…';
  if (account.error === 'offline') return 'Pas d\'Internet : sauvegarde dès que le réseau revient';
  if (account.error) return 'Sauvegarde impossible pour l\'instant. Tes séances restent sur cet iPhone, nouvel essai automatique';
  // Heure fixe plutôt que « il y a N min » : la ligne n'est redessinée qu'à la sauvegarde suivante
  if (account.lastSync) return `Sauvegardé ${savedAtText(account.lastSync)} · ${plural((data.history || []).length, 'séance', 'séances')}`;
  return 'Sauvegarde en attente';
}

// Ligne d'un moyen de connexion : relié (avec « Retirer » dans sa feuille), « Ajouter », ou pour
// l'e-mail d'un compte qui a déjà une adresse (Google) : relié aussi pour l'utilisateur, la connexion
// par code à cette adresse marche déjà (signInEmailOf), sans identité à retirer
function methodState(provider, user = account.user) {
  if (identityOf(user, provider)) return 'linked';
  return provider === 'email' && signInEmailOf(user) ? 'active' : 'add';
}
const METHOD_VALUE = { linked: 'Relié', active: 'Relié', add: 'Ajouter' };
function methodCellHtml({ provider, label }) {
  const state = methodState(provider);
  const logo = { apple: APPLE_LOGO, google: GOOGLE_LOGO, email: MAIL_ICON }[provider];
  // Adresse affichée pour l'e-mail seulement : celle qui reçoit les codes (le nom donné par Google
  // n'est jamais repris)
  const addr = provider === 'email' && state !== 'add' ? signInEmailOf(account.user) || identityOf(account.user, 'email')?.identity_data?.email || '' : '';
  const sub = esc(addr);
  return `
          <button class="cell ${state === 'add' ? 'cell--action' : 'cell--nav'} method-cell method-cell--${provider}" data-action="account-method" data-provider="${provider}"
            aria-label="${esc(`${label}, ${METHOD_VALUE[state].toLowerCase()}`)}">
            <span class="method-cell__logo" aria-hidden="true">${logo}</span>
            <span class="cell__body"><span class="cell__title">${label}</span>${sub ? `<span class="cell__sub cell__sub--1">${sub}</span>` : ''}</span>
            <span class="cell__value ${state === 'add' ? 'method-cell__add' : ''}">${METHOD_VALUE[state]}</span>
            ${state === 'add' ? '' : icon('chevron.right', 16)}
          </button>`;
}

function renderAccount() {
  const back = { title: 'Compte' };
  if (!accountAvailable()) return `<div class="view view--grouped account-view">${navBar(back)}<div class="scr"></div></div>`;
  if (!account.user) {
    // iPhone restauré (compte de l'appareil sans session) : on dit avec quoi se reconnecter ; session
    // finie hors de l'app (compte supprimé, connexion expirée) : on le dit, avec le moyen d'avant
    const info = accountReconnectInfo();
    const title = info?.ended ? 'Ta session a pris fin' : info ? 'Reconnecte-toi' : 'Sauvegarde tes séances';
    const lead = info?.ended ? `${SESSION_ENDED_TEXT} ${reconnectLine(info)}.`
      : info ? `${reconnectLine(info)}. Utilise le même moyen pour reprendre la sauvegarde.`
      : 'Retrouve tes séances sur un nouvel iPhone. Facultatif.';
    return `
    <div class="view view--grouped account-view account-view--out">
      ${navBar(back)}
      <div class="scr">
        <div class="account-hero">
          ${avatarHtml('xl')}
          <h2 class="account-hero__name">${title}</h2>
          <p class="account-hero__sub">${esc(lead)}</p>
          ${info ? '' : '<p class="account-hero__sub">Déjà un compte ? Utilise le même moyen qu\'avant.</p>'}
        </div>
        <div class="auth-buttons">${signInButtonsHtml()}</div>
        <p class="account-foot">Avec Apple, tu peux masquer ton e‑mail. Ton poids et tes données Santé restent sur l'iPhone. <button class="link-inline" data-action="account-privacy">Confidentialité</button></p>
      </div>
    </div>`;
  }
  const p = account.profile;
  const methods = LOGIN_PROVIDERS.filter(m => m.provider !== 'google' || account.google || identityOf(account.user, 'google'));
  return `
    <div class="view view--grouped account-view">
      ${navBar(back)}
      <div class="scr">
        <div class="account-hero">
          ${avatarHtml('xl')}
          <h2 class="account-hero__name">${esc(accountName())}</h2>
          <p class="account-hero__sub">${esc(providerLine())}</p>
        </div>

        <div class="group">
          <button class="cell cell--nav" data-action="account-edit-username">
            <span class="cell__body"><span class="cell__title">Pseudo</span></span>
            <span class="cell__value">${p?.username ? esc(p.username) : 'Choisir'}</span>
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell cell--nav" data-action="account-edit-avatar">
            <span class="cell__body"><span class="cell__title">Avatar</span></span>
            <span class="cell__value account-emoji" aria-label="${esc(avatarName(p?.avatar))}">${esc(validAvatar(p?.avatar))}</span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
        <div class="group-foot">Ton pseudo et ton avatar te représenteront auprès de tes amis quand l'app le permettra. Pour l'instant, toi seul les vois.</div>

        <div class="group-title">Moyens de connexion</div>
        <div class="group">${methods.map(methodCellHtml).join('')}</div>
        <div class="group-foot">Tu peux te connecter avec n'importe lequel. Il en faut au moins un.</div>

        <div class="group-title">Sauvegarde</div>
        <div class="group">
          <div class="cell">
            <span class="cell__body">
              <span class="cell__title">Sauvegarde automatique</span>
              <span class="cell__sub" id="syncStatus">${esc(syncStatusText())}</span>
            </span>
          </div>
          <button class="cell cell--action" data-action="account-sync" ${account.syncing ? 'disabled' : ''}><span class="cell__title">Sauvegarder maintenant</span></button>
        </div>
        <div class="group-foot">Après chaque séance. Ton poids et tes données Santé restent sur l'iPhone. <button class="link-inline" data-action="account-privacy">Confidentialité</button></div>

        <div class="group group--gap">
          <button class="cell cell--action" data-action="account-sign-out"><span class="cell__title">Se déconnecter</span></button>
        </div>
        <div class="group-foot">Se déconnecter garde tes données sur cet iPhone.</div>
        <div class="group">
          <button class="cell cell--destructive" data-action="account-delete"><span class="cell__title">Supprimer mon compte</span></button>
        </div>
      </div>
    </div>`;
}
SCREENS.set('account', { render: () => renderAccount() });

// ── Accueil : carte unique pour qui n'a pas vu l'écran Bienvenue ─────

function lsFlag(key) { try { return localStorage.getItem(key) === '1'; } catch { return false; } }
function setLsFlag(key) { try { localStorage.setItem(key, '1'); } catch { /* redemandé au prochain lancement */ } }

// « Tu étais connecté avec Apple · max.dlf »
function reconnectLine(info) {
  const how = info.method ? `Tu étais connecté avec ${METHOD_PHRASE[info.method] || info.method}` : 'Tu étais connecté à un compte';
  return info.username ? `${how} · ${info.username}` : how;
}

// La déconnexion est toujours locale (aucun appareil n'en déconnecte un autre) : compte supprimé, ou
// jeton refusé par le serveur, ou accès Apple retiré
const SESSION_ENDED_TEXT = 'Tu as été déconnecté : ton compte a été supprimé ou ta connexion a expiré. Tes séances sont toujours sur cet iPhone.';

// Bouton de la carte : le moyen d'avant nommé (Apple, Google : sa fenêtre directement ; e-mail :
// l'adresse préremplie, account-reconnect)
function reconnectButtonLabel(info) {
  if (info.method === 'apple' || info.method === 'google') return `Me reconnecter avec ${PROVIDER_NAMES[info.method]}`;
  return info.method === 'email' ? 'Me reconnecter par e‑mail' : 'Me reconnecter';
}

// Carte compacte sous « Démarrer » (titre, action, croix) : jamais devant la séance du jour.
// Session finie hors de l'app, reconnexion (iPhone restauré), sinon proposition de compte pour qui n'a
// pas vu Bienvenue.
function accountHomeCard() {
  const info = accountReconnectInfo();
  if (info?.ended) {
    // Moyen d'avant connu : reconnexion directe (même compte, s'il existe encore) ; sinon l'écran Compte
    return `
    <section class="home-card account-card account-card--reconnect" aria-labelledby="accountCardTitle">
      <div class="account-card__text">
        <h2 class="account-card__title" id="accountCardTitle">Ta session a pris fin</h2>
        <p class="account-card__sub">${SESSION_ENDED_TEXT}</p>
        ${info.method || info.username ? `<p class="account-card__sub">${esc(reconnectLine(info))}</p>` : ''}
      </div>
      ${info.method ? `<button class="account-card__btn" data-action="account-reconnect">${esc(reconnectButtonLabel(info))}</button>`
        : '<button class="account-card__btn" data-action="go-account">Se connecter</button>'}
      <button class="account-card__close" data-action="account-reconnect-close" aria-label="Fermer">${icon('xmark', 16)}</button>
    </section>`;
  }
  if (info) {
    // Titre court : une ligne à côté de la croix, même sur un iPhone SE
    return `
    <section class="home-card account-card account-card--reconnect" aria-labelledby="accountCardTitle">
      <div class="account-card__text">
        <h2 class="account-card__title" id="accountCardTitle">Reprends ta sauvegarde</h2>
        <p class="account-card__sub">${esc(reconnectLine(info))}</p>
      </div>
      <button class="account-card__btn" data-action="account-reconnect">${esc(reconnectButtonLabel(info))}</button>
      <button class="account-card__close" data-action="account-reconnect-close" aria-label="Fermer">${icon('xmark', 16)}</button>
    </section>`;
  }
  if (!accountCardShown({ accountAvailable: accountAvailable(), ready: account.ready, signedIn: !!account.user,
    welcomeSeen: lsFlag(WELCOME_SEEN_KEY), cardClosed: lsFlag(ACCOUNT_CARD_KEY) })) return '';
  return `
    <section class="home-card account-card" aria-labelledby="accountCardTitle">
      <div class="account-card__text"><h2 class="account-card__title" id="accountCardTitle">Sauvegarde tes séances</h2></div>
      <button class="account-card__btn" data-action="go-account">Créer un compte</button>
      <button class="account-card__close" data-action="account-card-close" aria-label="Fermer">${icon('xmark', 16)}</button>
    </section>`;
}

// ── Premier lancement : écran Bienvenue ─────────────────────

// Code demandé avant que iOS ne ferme l'app (moins de 10 min) : { email, sentAt } ou null
function pendingCode() {
  try { const p = JSON.parse(localStorage.getItem(PENDING_CODE_KEY)); return pendingCodeValid(p) ? p : null; }
  catch { return null; }
}

// Appelé au démarrage (init.js), avant que l'écran de lancement ne disparaisse. Ouvert au tout premier
// lancement seulement (firstScreen) ; le drapeau n'est posé que sur un vrai choix (« Commencer sans
// compte », connexion réussie : auth-flow.js), l'écran revient donc si l'app est fermée avant. Un code
// demandé il y a moins de 10 min rouvre l'écran du code (iOS a pu fermer l'app pendant la lecture du mail).
async function maybeShowWelcome() {
  if (!accountAvailable()) return;
  const pending = pendingCode();
  const state = {
    accountAvailable: true, hasHistory: (data.history || []).length > 0, onboarded: !!data.onboarded,
    restored: Native.restoredAtBoot, welcomeSeen: lsFlag(WELCOME_SEEN_KEY),
    // Session gardée dans le Trousseau (elle survit à une réinstallation) : déjà connecté
    signedIn: false,
  };
  if (firstScreen(state) !== 'welcome' && !pending) return;
  state.signedIn = !!(await storedSessionUser());
  const welcome = firstScreen(state) === 'welcome';
  if (!welcome && (!pending || state.signedIn)) return;
  account.google = await Native.account.googleAvailable();
  openAuthFlow(welcome
    ? { step: 'welcome', closable: false, resume: pending }
    : { step: 'code', email: pending.email, sentAt: pending.sentAt });
}

// ── Mises à jour de l'écran ─────────────────────────────────

// Données reçues du compte : écran redessiné, sauf pendant une saisie (clavier et saisie seraient
// perdus) : à la sortie du champ
const EDITABLE = 'input, textarea, [contenteditable="true"]';
function renderAfterMerge() {
  const el = document.activeElement;
  if (!el?.matches?.(EDITABLE)) { render(); return; }
  el.addEventListener('focusout', () => setTimeout(() => {
    if (!document.activeElement?.matches?.(EDITABLE)) render();
  }, 0), { once: true });
}

// Ce qui change la forme des écrans du compte (connexion, profil, moyens reliés) ; la synchro ne
// change que la ligne d'état, mise à jour sans redessiner (un tap en cours ne serait pas perdu)
function accountShapeKey() {
  const u = account.user;
  return JSON.stringify([account.ready, !!u, u?.id, account.profile?.username, account.profile?.avatar, account.google,
    (u?.identities || []).map(i => i.provider).sort(), u?.email]);
}
let accountShape = null;
onAccountChange(kind => {
  if (kind === 'merged') { renderAfterMerge(); return; }
  const shape = accountShapeKey(), changed = shape !== accountShape;
  accountShape = shape;
  const v = currentView();
  // Saisie en cours dans l'écran (pas dans le calque du compte, qui n'est pas redessiné) : on attend
  const typing = document.activeElement?.matches?.(EDITABLE) && document.getElementById('app')?.contains(document.activeElement);
  if (changed && ['settings', 'account', 'dashboard'].includes(v) && !typing) { render(); return; }
  const status = document.getElementById('syncStatus');
  if (status) status.textContent = syncStatusText();
  const btn = document.querySelector('[data-action="account-sync"]');
  if (btn) btn.disabled = account.syncing;
});

// ── Choix quand un autre compte se connecte ─────────────────

// Appareil vidé avant de recevoir les données du compte (copie de secours locale gardée) ; les
// réglages propres à l'appareil restent
function keepOnlyDeviceSettings() {
  const keep = {};
  for (const k of SYNC_LOCAL_ONLY) if (k !== 'history' && k !== 'trash' && data[k] !== undefined) keep[k] = data[k];
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify(data)); } catch { /* copie de secours impossible */ }
  if (activeSession) endSession();
  data = Object.assign(freshData(), keep);
  resetSelections();
  save(true);
}

// Connexion sur un iPhone qui contient les séances d'un autre compte
async function askMergeOtherAccount(n, pending, previous = null) {
  const s = pending > 1 ? 's' : '';
  // pending : compté sur l'état de synchro de l'autre compte (toutes les séances si sa session a pris
  // fin hors de l'app). previous : compte d'avant connu seulement par la copie iCloud de l'app, sans
  // état de synchro : rien n'est promis (ni « elles restent », ni « nulle part ailleurs »)
  const from = previous ? [LOGIN_PROVIDERS.find(p => p.provider === previous.method)?.label, previous.username].filter(Boolean).join(' · ') : '';
  const where = previous ? `${n > 1 ? 'Ces séances viennent' : 'Cette séance vient'} de ton compte précédent${from ? ` (${from})` : ''}. ${n > 1 ? 'Les ajouter' : 'L\'ajouter'} à ce compte ?`
    : !pending ? `${n > 1 ? 'Elles restent' : 'Elle reste'} sur l'autre compte.`
    : `${pending === n ? (n > 1 ? 'Elles' : 'Elle') : `${pending} d'entre elles`} ne ${pending > 1 ? 'sont' : 'est'} sauvegardée${s} nulle part ailleurs : les retirer les effacerait.`;
  const choice = await dialog({ type: 'sheet', title: 'Des séances sont déjà sur cet iPhone',
    message: previous ? `Cet iPhone contient ${plural(n, 'séance', 'séances')}. ${where}` : `Cet iPhone contient ${plural(n, 'séance', 'séances')} d'un autre compte. ${where}`,
    actions: [
      { label: 'Les ajouter à ce compte', value: 'add', style: 'preferred' },
      { label: 'Les retirer de cet iPhone', value: 'replace', style: 'destructive' },
      { label: 'Annuler', value: null, style: 'cancel' },
    ] });
  if (choice === 'replace') keepOnlyDeviceSettings();
  return choice || null;
}

// Compte tout neuf alors qu'un compte d'avant a laissé une trace sur cet iPhone (res.hadAccount) :
// sans doute un autre moyen de connexion qu'à l'origine (Google au lieu d'Apple…), ce qui crée un
// second compte. Affiché sur l'écran du pseudo qui suit, avec « Me reconnecter autrement »
// (auth-flow.js). Sans indice, rien d'inquiétant : une ligne discrète sous « Plus tard » suffit.
function newAccountNotice(res) {
  return res?.isNew && res.hadAccount ? 'Nouveau compte créé. Déjà un compte ?' : '';
}

// Connexion réussie (Apple, Google ou code) : ce qui est arrivé (récupéré) et parti (sauvegardé) ;
// synchro ratée : réseau ou serveur, « récupération » sur un iPhone qui n'avait encore rien
function signedInToast(res) {
  if (res.reason === 'sync') {
    const what = res.newDevice ? 'récupération de tes séances' : 'sauvegarde';
    return res.error === 'offline' ? `Connecté. Pas d'Internet : ${what} dès que le réseau revient`
      : `Connecté. ${what[0].toUpperCase() + what.slice(1)} impossible pour l'instant, nouvel essai automatique`;
  }
  // Court (une ligne de toast sur un iPhone SE) : « 120 séances récupérées, 3 sauvegardées »
  const parts = [];
  if (res.received) parts.push(plural(res.received, 'séance récupérée', 'séances récupérées'));
  if (res.sent) parts.push(res.received ? `${res.sent} sauvegardée${res.sent > 1 ? 's' : ''}` : plural(res.sent, 'séance sauvegardée', 'séances sauvegardées'));
  return parts.length ? parts.join(', ') : 'Connecté : tout est à jour';
}
const SIGNED_IN_TOAST_MS = 3500;

// Moyen de connexion ajouté ou retiré depuis moins de 24 h : suppression refusée (par le serveur aussi), date dite
async function identityRecentDialog(retryAt) {
  const when = retryAt ? ` à partir du ${fmtDate(retryAt, 'day')} à ${fmtTime(retryAt)}` : ' dans 24 heures';
  await dialog({ title: 'Suppression possible plus tard',
    message: `Un moyen de connexion vient de changer. Par sécurité, tu pourras supprimer ton compte${when}.`,
    actions: [{ label: 'OK', style: 'preferred' }] });
}

const APPLE_MANUAL_REVOKE = 'Pour retirer aussi l\'accès dans ton identifiant Apple : Réglages de l\'iPhone › ton nom › Connexion et sécurité › Se connecter avec Apple › MDLF Training › Arrêter d\'utiliser.';

// Supprime le compte après la confirmation d'identité, puis propose de garder les données locales
async function deleteAccountFlow() {
  // Refus connu d'avance : pas de nouvelle connexion demandée pour rien
  const hold = linkedIdentityHoldUntil(account.user);
  if (hold) { await identityRecentDialog(hold); return; }
  if (!hasApple(account.user) && !(await accountRecentlyAuthenticated())) {
    const ok = await reauthenticate('delete');
    if (!ok) return;
  }
  const res = await accountDelete();
  if (res.reason === 'cancel') return;
  if (res.reason === 'identity_recent') { await identityRecentDialog(res.retryAt); return; }
  if (res.reason === 'reauth') { showToast('Confirme d\'abord ton identité, puis réessaie', { error: true }); return; }
  if (!res.ok) {
    const msg = { apple: navigator.onLine === false ? authErrorText('offline') : 'Connexion avec Apple impossible, réessaie', other_account: authErrorText('other_account') }[res.reason] || 'Suppression impossible, vérifie ta connexion';
    showToast(msg, { error: true });
    return;
  }
  const wipe = await dialog({ type: 'sheet', title: 'Compte supprimé',
    message: 'Que faire des données de cet iPhone ?',
    actions: [
      { label: 'Les garder sur cet iPhone', value: 'keep', style: 'preferred' },
      { label: 'Les effacer aussi', value: 'wipe', style: 'destructive' },
    ] });
  if (wipe === 'wipe') wipeLocalData();
  if (currentView() === 'account') goBack(); else render();
  if (res.apple && !res.revoked) {
    await dialog({ title: 'Dernière étape', message: APPLE_MANUAL_REVOKE, actions: [{ label: 'OK', style: 'preferred' }] });
  } else showToast('Compte supprimé');
}

// Nouvelle connexion avec un moyen déjà relié (Apple, Google ou un code par e-mail) : avant la
// suppression d'un compte sans Apple (exigée par le serveur), et avant l'ajout d'un moyen de connexion
// (confort : le serveur ne l'exige pas, mais relier un moyen sur une session restée ouverte n'a pas à
// être aussi simple qu'un tap). true si la session est maintenant récente.
const REAUTH_LABELS = { apple: 'Avec Apple', google: 'Avec Google', email: 'Code par e‑mail' };
const REAUTH_PURPOSE = { delete: 'Pour supprimer ton compte, reconnecte-toi.', link: 'Pour ajouter un moyen de connexion, reconnecte-toi d\'abord avec un moyen déjà relié.' };
async function reauthenticate(purpose = 'delete') {
  const methods = reauthMethods();
  if (!methods.length) { showToast('Confirmation impossible : aucun moyen de connexion disponible', { error: true }); return false; }
  const choice = methods.length === 1 && purpose === 'delete' ? methods[0] : await dialog({ type: 'sheet', title: 'Confirme ton identité',
    message: REAUTH_PURPOSE[purpose],
    actions: [
      ...methods.map((m, i) => ({ label: REAUTH_LABELS[m], value: m, style: i ? 'default' : 'preferred' })),
      { label: 'Annuler', value: null, style: 'cancel' },
    ] });
  if (choice === 'google' || choice === 'apple') {
    const r = choice === 'google' ? await accountReauthGoogle() : await accountReauthApple();
    if (r.ok) return true;
    if (r.reason !== 'cancel') showToast(authErrorText(r.kind || 'provider'), { error: true });
    return false;
  }
  if (choice !== 'email') return false;
  const sent = await accountReauthEmailStart();
  if (!sent.ok) { showToast(authErrorText(sent.kind), { error: true }); return false; }
  return (await openAuthFlow({ step: 'code', mode: 'reauth', email: signInEmailOf(account.user), sentAt: sent.sentAt })) === 'reauth';
}

// Feuille d'un moyen de connexion : retirer (s'il en reste un autre) ou ajouter
async function methodAction(provider) {
  const label = LOGIN_PROVIDERS.find(p => p.provider === provider)?.label || provider;
  if (identityOf(account.user, provider)) {
    if (!canUnlink(account.user, provider)) {
      await dialog({ title: `${label} est ton seul moyen de connexion`, message: 'Ajoute d\'abord un autre moyen de connexion pour pouvoir retirer celui-ci.', actions: [{ label: 'OK', style: 'preferred' }] });
      return;
    }
    const apple = provider === 'apple';
    if (!(await confirmSheet(`Retirer ${label} ?`, `Tu ne pourras plus te connecter avec ${PROVIDER_NAMES[provider]}. Ton compte et tes données ne changent pas.${apple ? ' Apple te demandera de confirmer ton identité.' : ''}`, `Retirer ${label}`))) return;
    const r = await accountUnlink(provider);
    if (r.reason === 'cancel') return;
    // Retrait d'Apple non révoqué : l'alerte (qui remplace tout toast) le dit elle-même
    if (r.ok && apple && !r.revoked) { await dialog({ title: 'Apple retiré : dernière étape', message: APPLE_MANUAL_REVOKE, actions: [{ label: 'OK', style: 'preferred' }] }); return; }
    showToast(r.ok ? `${label} retiré` : authErrorText(r.kind), { error: !r.ok });
    return;
  }
  // E-mail d'un compte qui a déjà une adresse (Google) : rien à ajouter, les codes y arrivent déjà
  if (provider === 'email' && !canAddEmail(account.user)) {
    const addr = signInEmailOf(account.user);
    await dialog({ title: 'Connexion par code',
      message: addr ? `Tu peux déjà te connecter avec un code envoyé à ${addr}, l'adresse de ton compte.` : authErrorText('email_unconfirmed'),
      actions: [{ label: 'OK', style: 'preferred' }] });
    return;
  }
  // Session ancienne : nouvelle connexion avec un moyen déjà relié avant d'en ajouter un
  if (!(await accountRecentlyAuthenticated()) && !(await reauthenticate('link'))) return;
  if (provider === 'email') { await openAuthFlow({ step: 'email', mode: 'link' }); return; }
  const r = await accountLink(provider);
  if (r.reason === 'cancel') return;
  // Déjà relié à un autre compte : la marche à suivre, pas une impasse
  if (r.kind === 'identity_exists') { await identityExistsDialog(provider); return; }
  showToast(r.ok ? `${label} ajouté : tu peux te connecter avec` : authErrorText(r.kind || 'provider'), { error: !r.ok });
}

async function identityExistsDialog(provider) {
  await dialog({ title: identityExistsTitle(provider), message: identityExistsText(provider), actions: [{ label: 'OK', style: 'preferred' }] });
}

// Moyen à utiliser pour se reconnecter à ce compte (« Se déconnecter »)
function reconnectHint() {
  const c = readLoginCache();
  const m = (c?.userId === account.user?.id && c.method) || primaryProvider(account.user);
  if (m === 'email' && signInEmailOf(account.user)) return `Pour te reconnecter, demande un code à ${signInEmailOf(account.user)}.`;
  return m ? `Pour te reconnecter, utilise ${METHOD_PHRASE[m]}.` : 'Tu pourras te reconnecter à tout moment.';
}
// « Se déconnecter ? » : ce qui n'est pas encore sauvegardé et avec quoi revenir
function signOutMessage() {
  const n = account.user ? accountPendingCount(account.user.id) : 0;
  const pending = n ? `${plural(n, 'séance pas encore sauvegardée', 'séances pas encore sauvegardées')} : ${n > 1 ? 'elles restent' : 'elle reste'} sur cet iPhone et ${n > 1 ? 'partiront' : 'partira'} quand tu te reconnecteras à ce compte.`
    : 'Tes données restent sur cet iPhone et sur ton compte.';
  return `${pending} ${reconnectHint()}`;
}

registerActions({
  'go-account': () => navigate('account'),
  'account-privacy': () => { window.open(PRIVACY_URL, '_blank'); },
  'account-card-close': () => { setLsFlag(ACCOUNT_CARD_KEY); haptic(); render(); },
  'account-reconnect-close': () => { accountDismissReconnect(); haptic(); render(); },
  // Carte de reconnexion : le moyen d'avant directement (Apple, Google), l'adresse préremplie (code)
  'account-reconnect': async () => {
    const info = accountReconnectInfo();
    if (info?.method === 'apple' || (info?.method === 'google' && account.google)) { await signInWithProvider(info.method); return; }
    if (info?.method === 'email') { await openAuthFlow({ step: 'email', mode: 'signin', email: info.email || '' }); return; }
    navigate('account');
  },
  'account-sync': async () => {
    if (account.syncing) return;
    const ok = await syncNow();
    showToast(ok ? 'Sauvegardé' : syncStatusText(), { error: !ok });
  },
  'account-sign-out': async () => {
    if (!(await confirmSheet('Se déconnecter ?', signOutMessage(), 'Se déconnecter'))) return;
    await accountSignOut();
    showToast('Déconnecté');
  },
  'account-method': async (e, el) => { await methodAction(el.dataset.provider); },
  'account-edit-username': async () => {
    await openAuthFlow({ step: 'username', mode: 'profile' });
  },
  'account-edit-avatar': async () => {
    await openAuthFlow({ step: 'avatar', mode: 'profile' });
  },
  'account-delete': async () => {
    const apple = hasApple(account.user);
    if (!(await confirmSheet('Supprimer ton compte ?',
      `Ton compte, ton pseudo et tout ce qui est sauvegardé dessus seront effacés définitivement. Les séances de cet iPhone ne sont pas touchées : tu choisiras ensuite de les garder ou non. Tes autres appareils seront déconnectés et garderont leurs séances. ${apple ? 'Apple te demandera de confirmer ton identité.' : 'Tu confirmeras ton identité en te reconnectant.'}`,
      'Supprimer mon compte'))) return;
    await deleteAccountFlow();
  },
});
