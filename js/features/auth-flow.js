// ═══════════════════════════════════════════════════════════
//  Écrans plein écran du compte, par-dessus l'app : Bienvenue (premier lancement), e-mail, code à
//  6 chiffres, pseudo, avatar. Un seul calque (.auth), des étapes empilées (retour en haut à gauche).
//
//  openAuthFlow({ step, mode, closable, email, sentAt }) → Promise du résultat :
//    mode 'signin'  (défaut) : connexion (Apple, Google, code e-mail) → 'signed-in' ; un compte tout
//                   neuf passe par le pseudo (« Plus tard » possible) ;
//    mode 'link'    : ajout d'une adresse e-mail à un compte qui n'en a pas (Apple) → 'linked', seulement
//                   une fois l'adresse portée par le compte ;
//    mode 'reauth'  : code envoyé à l'adresse du compte (avant la suppression) → 'reauth' ;
//    mode 'profile' : pseudo ou avatar depuis l'écran Compte → 'saved'.
//  null si l'écran est fermé sans aboutir. L'écran Bienvenue pose WELCOME_SEEN_KEY quel que soit le choix.
// ═══════════════════════════════════════════════════════════
'use strict';

const flow = {
  root: null, steps: [], mode: 'signin', closable: true, resolve: null,
  email: '', sentAt: 0, busy: false, tick: null, first: false,   // first : pseudo d'un compte tout neuf
  notice: '',                                                      // avertissement « Nouveau compte créé » (newAccountNotice)
  username: '', avatar: null, checkTimer: null, checkSeq: 0,
};

function openAuthFlow({ step = 'welcome', mode = 'signin', closable = true, email = '', sentAt = 0 } = {}) {
  if (flow.root) closeAuthFlow(null);
  Object.assign(flow, { steps: [], mode, closable, email, sentAt, busy: false, first: false, notice: '',
    username: account.profile?.username || '', avatar: validAvatar(account.profile?.avatar) });
  const root = document.createElement('div');
  root.className = 'auth';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'authTitle');
  root.addEventListener('submit', onAuthSubmit);
  root.addEventListener('input', onAuthInput);
  flow.root = root;
  document.body.appendChild(root);
  if (step === 'welcome') setLsFlag(WELCOME_SEEN_KEY);   // posé dès l'affichage : jamais deux fois
  authGo(step);
  return new Promise(resolve => { flow.resolve = resolve; });
}

function closeAuthFlow(result) {
  const root = flow.root;
  if (!root) return;
  clearInterval(flow.tick);
  clearTimeout(flow.checkTimer);
  flow.root = null;
  if (root.contains(document.activeElement)) document.activeElement.blur();   // clavier fermé avec le calque
  root.classList.add('auth--out');
  setTimeout(() => root.remove(), reduceMotion.matches ? 0 : 240);
  const resolve = flow.resolve;
  flow.resolve = null;
  resolve?.(result);
}

// Étape suivante (empilée) ou retour (replace) ; le titre reçoit le focus pour VoiceOver, le champ
// pour le clavier
function authGo(step, { replace = false } = {}) {
  if (replace) flow.steps[flow.steps.length - 1] = step; else flow.steps.push(step);
  paintAuth();
}
function authBack() {
  if (flow.steps.length < 2) { if (flow.closable) closeAuthFlow(null); return; }
  flow.steps.pop();
  paintAuth();
}

function paintAuth() {
  const step = flow.steps[flow.steps.length - 1];
  clearInterval(flow.tick);
  const left = flow.steps.length > 1
    ? `<button class="auth__nav" data-action="auth-back" aria-label="Retour">${icon('chevron.left', 22)}<span>Retour</span></button>`
    : flow.closable ? `<button class="auth__nav" data-action="auth-close">Annuler</button>` : '';
  flow.root.innerHTML = `
    <div class="auth__bar">${left}</div>
    <div class="auth__page auth__page--${step}">${AUTH_STEPS[step]()}</div>`;
  flow.root.scrollTop = 0;
  const field = flow.root.querySelector('.auth__input');
  if (field) setTimeout(() => field.focus(), 60);
  else flow.root.querySelector('#authTitle')?.focus({ preventScroll: true });
  if (step === 'code') startResendTick();
  if (step === 'username') checkUsername();
}

// ── Gabarits des étapes ─────────────────────────────────────

const AUTH_STEPS = {
  welcome: () => `
      <div class="auth__hero">
        <div class="auth__logo">${appIconSvg(DEFAULT_APP_ICON, { attrs: 'aria-hidden="true" focusable="false"' })}</div>
        <h1 class="auth__title" id="authTitle" tabindex="-1">Bienvenue dans MDLF Training</h1>
        <p class="auth__lead">Crée un compte pour garder tes séances à l'abri et les retrouver sur un nouvel iPhone.</p>
      </div>
      <div class="auth-buttons">${signInButtonsHtml()}</div>
      <button class="auth__skip" data-action="auth-skip">Commencer sans compte</button>
      <p class="auth__foot">Facultatif et sans publicité. Ton poids et tes données Santé restent sur l'iPhone. <button class="link-inline" data-action="account-privacy">Confidentialité</button></p>
      <p class="auth__error" id="authError" role="alert"></p>`,

  email: () => `
      <h1 class="auth__title auth__title--left" id="authTitle" tabindex="-1">${flow.mode === 'link' ? 'Ajouter une adresse e‑mail' : 'Ton adresse e‑mail'}</h1>
      <p class="auth__lead auth__lead--left">${flow.mode === 'link' ? 'Tu recevras un code pour la confirmer. Tu pourras ensuite te connecter avec.' : 'On t\'envoie un code à 6 chiffres. Pas de mot de passe à retenir.'}</p>
      <form class="auth__form" data-form="email" novalidate>
        <label class="visually-hidden" for="authEmail">Adresse e-mail</label>
        <input class="auth__input" id="authEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="none"
          autocorrect="off" spellcheck="false" enterkeyhint="send" placeholder="nom@exemple.fr" value="${esc(flow.email)}" aria-describedby="authError">
        <p class="auth__error" id="authError" role="alert"></p>
        <button class="btn btn--primary auth__primary" type="submit" data-role="send" ${emailLooksValid(normalizeEmail(flow.email)) ? '' : 'disabled'}>Recevoir un code</button>
      </form>`,

  code: () => `
      <h1 class="auth__title auth__title--left" id="authTitle" tabindex="-1">Saisis le code</h1>
      <p class="auth__lead auth__lead--left">Envoyé à <strong class="auth__email">${esc(flow.email)}</strong>. Il est valable 10 minutes. Pense à regarder dans les indésirables.</p>
      <form class="auth__form" data-form="code" novalidate>
        <label class="visually-hidden" for="authCode">Code à 6 chiffres</label>
        <input class="auth__input auth__code num" id="authCode" type="text" inputmode="numeric" autocomplete="one-time-code"
          pattern="[0-9]*" maxlength="${OTP_LENGTH + 4}" enterkeyhint="done" placeholder="000000" aria-describedby="authError">
        <p class="auth__error" id="authError" role="alert"></p>
        <button class="btn btn--primary auth__primary" type="submit" data-role="verify" disabled>Valider</button>
      </form>
      <div class="auth__links">
        <button class="auth__link" data-action="auth-resend" id="authResend" disabled>Renvoyer le code</button>
        ${flow.mode === 'reauth' ? '' : '<button class="auth__link" data-action="auth-change-email">Changer d\'adresse</button>'}
      </div>`,

  username: () => {
    const next = flow.mode === 'profile' ? usernameNextChange(account.profile) : 0;
    return `
      <button class="auth__avatar" data-action="auth-open-avatar" aria-label="${esc(`Avatar : ${avatarName(flow.avatar)}. Changer`)}">
        <span class="avatar avatar--xl" aria-hidden="true">${esc(flow.avatar)}</span><span class="auth__avatar-edit" aria-hidden="true">Modifier</span>
      </button>
      <h1 class="auth__title" id="authTitle" tabindex="-1">${flow.first ? 'Choisis ton pseudo' : 'Pseudo'}</h1>
      <p class="auth__lead">Il te représentera auprès de tes amis quand l'app le permettra. Pour l'instant, toi seul le vois.</p>
      ${flow.first && flow.notice ? `<p class="auth__notice" role="note">${esc(flow.notice)}</p>` : ''}
      <form class="auth__form" data-form="username" novalidate>
        <label class="visually-hidden" for="authUsername">Pseudo</label>
        <div class="auth__at-field"><span class="auth__at" aria-hidden="true">@</span>
          <input class="auth__input auth__input--at" id="authUsername" type="text" autocomplete="username" autocapitalize="none"
            autocorrect="off" spellcheck="false" maxlength="30" enterkeyhint="done" placeholder="pseudo" value="${esc(flow.username)}"
            aria-describedby="authUsernameStatus" ${next ? 'disabled' : ''}></div>
        <p class="auth__status" id="authUsernameStatus" aria-live="polite">${next ? esc(`Prochain changement possible le ${fmtDate(next, 'day')}`) : '3 à 20 caractères : lettres, chiffres, point, tiret bas'}</p>
        <button class="btn btn--primary auth__primary" type="submit" data-role="save" ${next ? 'disabled' : ''}>${flow.first ? 'Continuer' : 'Enregistrer'}</button>
      </form>
      ${flow.first ? '<button class="auth__skip" data-action="auth-later">Plus tard</button>' : ''}`;
  },

  avatar: () => `
      <h1 class="auth__title" id="authTitle" tabindex="-1">Choisis ton avatar</h1>
      <p class="auth__lead">Un emoji pour te reconnaître.</p>
      <div class="avatar-grid" role="group" aria-labelledby="authTitle">
        ${AVATAR_EMOJIS.map(a => `<button class="avatar-pick" data-action="auth-avatar" data-emoji="${a.emoji}" aria-label="${esc(a.name)}" aria-pressed="${a.emoji === flow.avatar}">${a.emoji}</button>`).join('')}
      </div>
      <button class="btn btn--primary auth__primary" data-action="auth-avatar-done">${flow.steps.includes('username') ? 'OK' : 'Enregistrer'}</button>
      <p class="auth__error" id="authError" role="alert"></p>`,
};

// ── Saisie ──────────────────────────────────────────────────

function authError(msg) {
  const el = flow.root?.querySelector('#authError');
  if (el) el.textContent = msg || '';
  const input = flow.root?.querySelector('.auth__input');
  if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  if (msg) haptic('medium');
}
function setBusy(on) {
  flow.busy = on;
  flow.root?.querySelectorAll('button[type="submit"], .auth-btn').forEach(b => { b.toggleAttribute('aria-busy', on); });
}

// Les champs du calque ne concernent pas la saisie en direct de l'app (init.js) : l'événement s'arrête
// ici (sinon l'écouteur global effacerait aussitôt l'erreur signalée par un code faux)
function onAuthInput(e) {
  e.stopPropagation();
  const t = e.target;
  if (t.id === 'authEmail') {
    flow.email = t.value;
    authError('');
    flow.root.querySelector('[data-role="send"]').disabled = !emailLooksValid(normalizeEmail(t.value));
  } else if (t.id === 'authCode') {
    const digits = codeDigits(t.value);
    if (t.value !== digits) t.value = digits;
    authError('');
    flow.root.querySelector('[data-role="verify"]').disabled = digits.length !== OTP_LENGTH;
    if (digits.length === OTP_LENGTH) submitCode(digits);   // envoi automatique au 6e chiffre
  } else if (t.id === 'authUsername') {
    flow.username = t.value;
    clearTimeout(flow.checkTimer);
    flow.checkTimer = setTimeout(checkUsername, 350);
  }
}

function onAuthSubmit(e) {
  e.preventDefault();
  const form = e.target.dataset.form;
  if (form === 'email') submitEmail();
  if (form === 'code') { const d = codeDigits(flow.root.querySelector('#authCode').value); if (d.length === OTP_LENGTH) submitCode(d); }
  if (form === 'username') submitUsername();
}

// ── E-mail et code ──────────────────────────────────────────

async function submitEmail() {
  if (flow.busy) return;
  const email = normalizeEmail(flow.email);
  if (!emailLooksValid(email)) { authError(authErrorText('email')); return; }
  setBusy(true);
  const r = flow.mode === 'link' ? await accountLinkEmailStart(email) : await accountSendEmailCode(email);
  setBusy(false);
  if (!flow.root) return;
  if (!r.ok) { authError(authErrorText(r.kind)); return; }
  flow.email = email;
  flow.sentAt = r.sentAt;
  authGo('code');
}

async function submitCode(code) {
  if (flow.busy || !flow.root) return;
  setBusy(true);
  const input = flow.root.querySelector('#authCode');
  if (input) input.readOnly = true;
  let r;
  if (flow.mode === 'link') r = await accountLinkEmailVerify(flow.email, code, flow.sentAt);
  else if (flow.mode === 'reauth') r = await accountReauthEmailVerify(code, flow.sentAt);
  else r = await accountVerifyEmailCode(flow.email, code, flow.sentAt, askMergeOtherAccount);
  setBusy(false);
  if (!flow.root) return;
  if (input) input.readOnly = false;
  if (flow.mode === 'link') {
    if (!r.ok) return codeFailed(r.kind);
    closeAuthFlow('linked'); showToast('Adresse e-mail ajoutée : tu peux te connecter avec');
    return;
  }
  if (flow.mode === 'reauth') {
    if (!r.ok) return codeFailed(r.kind);
    closeAuthFlow('reauth');
    return;
  }
  if (r.reason === 'cancel') { closeAuthFlow(null); return; }
  if (!r.ok && r.reason !== 'sync') return codeFailed(r.kind || 'server');
  signedIn(r);
}

function codeFailed(kind) {
  const input = flow.root.querySelector('#authCode');
  if (input && (kind === 'invalid' || kind === 'expired' || kind === 'code')) { input.value = ''; flow.root.querySelector('[data-role="verify"]').disabled = true; }
  authError(authErrorText(kind));
  input?.focus();
}

// « Renvoyer » grisé 60 s après chaque envoi (limite de Supabase), avec le décompte
function startResendTick() {
  const update = () => {
    const btn = flow.root?.querySelector('#authResend');
    if (!btn) { clearInterval(flow.tick); return; }
    const left = Math.ceil((flow.sentAt + OTP_RESEND_MS - Date.now()) / 1000);
    btn.disabled = left > 0 || flow.busy;
    btn.textContent = left > 0 ? `Renvoyer le code (${left} s)` : 'Renvoyer le code';
    if (left <= 0) clearInterval(flow.tick);
  };
  update();
  flow.tick = setInterval(update, 1000);
}

async function resendCode() {
  if (flow.busy || Date.now() < flow.sentAt + OTP_RESEND_MS) return;
  setBusy(true);
  const r = flow.mode === 'link' ? await accountLinkEmailStart(flow.email)
    : flow.mode === 'reauth' ? await accountReauthEmailStart()
    : await accountSendEmailCode(flow.email);
  setBusy(false);
  if (!flow.root) return;
  if (!r.ok) { authError(authErrorText(r.kind)); return; }
  flow.sentAt = r.sentAt;
  authError('');
  const input = flow.root.querySelector('#authCode');
  if (input) { input.value = ''; input.focus(); }
  announce('Nouveau code envoyé');
  startResendTick();
}

// ── Après la connexion ──────────────────────────────────────

function signedIn(res) {
  render();
  if (res.isNew) {
    flow.first = true;
    flow.notice = newAccountNotice(res);
    flow.closable = false;
    flow.steps = [];
    authGo('username');
    return;
  }
  closeAuthFlow('signed-in');
  showToast(signedInToast(res));
}

async function signInWithProvider(provider, el) {
  if (flow.busy) return;
  setBusy(true);
  if (el) el.disabled = true;
  let r;
  try { r = await accountSignInWith(provider, askMergeOtherAccount); }
  catch { r = { ok: false, reason: 'server' }; }
  finally { setBusy(false); if (el?.isConnected) el.disabled = false; notifyAccount(); }
  if (r.reason === 'cancel') return;
  if (!r.ok && r.reason !== 'sync') {
    const msg = r.reason === 'provider' ? `Connexion avec ${provider === 'apple' ? 'Apple' : 'Google'} impossible` : authErrorText(r.kind);
    if (flow.root) authError(msg); else showToast(msg, { error: true });
    return;
  }
  if (flow.root) { signedIn(r); return; }
  // Depuis l'écran Compte : même suite, dans un calque ouvert pour le pseudo
  render();
  if (r.isNew) { openAuthFlow({ step: 'username', mode: 'profile', closable: false }); flow.first = true; flow.notice = newAccountNotice(r); paintAuth(); }
  else showToast(signedInToast(r));
}

// ── Pseudo et avatar ────────────────────────────────────────

// État sous le champ : règle locale d'abord, puis disponibilité demandée au serveur
async function checkUsername() {
  const status = flow.root?.querySelector('#authUsernameStatus');
  const input = flow.root?.querySelector('#authUsername');
  if (!status || !input || input.disabled) return;
  const name = normalizeUsername(flow.username);
  status.className = 'auth__status';
  if (!flow.username.trim()) { status.textContent = '3 à 20 caractères : lettres, chiffres, point, tiret bas'; return; }
  const bad = usernameProblem(name);
  const shown = name !== flow.username.trim() ? ` · enregistré @${name}` : '';
  if (bad) { status.textContent = USERNAME_TEXT[bad]; status.classList.add('auth__status--bad'); return; }
  if (name === account.profile?.username) { status.textContent = 'C\'est ton pseudo actuel'; return; }
  const seq = ++flow.checkSeq;
  status.textContent = `Vérification…${shown}`;
  const free = await accountUsernameAvailable(name);
  if (seq !== flow.checkSeq || !flow.root) return;
  if (free === null) { status.textContent = `Disponibilité vérifiée à l'enregistrement${shown}`; return; }
  status.textContent = free ? `Disponible${shown}` : USERNAME_TEXT.taken;
  status.classList.add(free ? 'auth__status--ok' : 'auth__status--bad');
}

async function submitUsername() {
  if (flow.busy) return;
  const name = normalizeUsername(flow.username);
  const bad = usernameProblem(name);
  const status = flow.root.querySelector('#authUsernameStatus');
  const fail = msg => { status.textContent = msg; status.className = 'auth__status auth__status--bad'; haptic('medium'); };
  if (bad) { fail(USERNAME_TEXT[bad]); return; }
  const changes = { avatar: flow.avatar };
  if (name !== account.profile?.username) changes.username = name;
  setBusy(true);
  const r = await accountSaveProfile(changes);
  setBusy(false);
  if (!flow.root) return;
  if (!r.ok) { fail(USERNAME_TEXT[r.kind] || USERNAME_TEXT.server); return; }
  closeAuthFlow('saved');
  render();
  showToast(flow.first ? `Bienvenue, ${name}` : 'Pseudo enregistré');
}

registerActions({
  'auth-provider': async (e, el) => { await signInWithProvider(el.dataset.provider, el); },
  'auth-email': () => {
    if (flow.root) authGo('email');
    else openAuthFlow({ step: 'email', mode: 'signin' });
  },
  'auth-skip': () => { setLsFlag(WELCOME_SEEN_KEY); closeAuthFlow(null); },
  'auth-back': () => authBack(),
  'auth-close': () => closeAuthFlow(null),
  'auth-resend': async () => { await resendCode(); },
  'auth-change-email': () => {
    // Retour à l'adresse : l'étape « code » est remplacée (pas empilée deux fois)
    if (flow.steps[flow.steps.length - 2] === 'email') authBack(); else authGo('email', { replace: true });
  },
  'auth-later': async () => {
    // Avatar déjà changé : gardé, le pseudo attendra
    if (flow.avatar !== validAvatar(account.profile?.avatar)) await accountSaveProfile({ avatar: flow.avatar });
    closeAuthFlow(null);
    render();
    showToast('Tu pourras choisir ton pseudo dans Réglages › Compte');
  },
  'auth-open-avatar': () => authGo('avatar'),
  'auth-avatar': (e, el) => {
    flow.avatar = validAvatar(el.dataset.emoji);
    flow.root.querySelectorAll('.avatar-pick').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.emoji === flow.avatar)));
    haptic();
  },
  'auth-avatar-done': async () => {
    // Depuis le pseudo : choix gardé pour l'enregistrement du pseudo
    if (flow.steps.includes('username')) { authBack(); return; }
    if (flow.busy) return;
    setBusy(true);
    const r = await accountSaveProfile({ avatar: flow.avatar });
    setBusy(false);
    if (!flow.root) return;
    if (!r.ok) { authError(USERNAME_TEXT[r.kind] || USERNAME_TEXT.server); return; }
    closeAuthFlow('saved');
    render();
    showToast('Avatar enregistré');
  },
});
