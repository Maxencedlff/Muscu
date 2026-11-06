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
//    mode 'profile' : pseudo ou avatar depuis l'écran Compte → 'saved' ;
//    mode 'referral' : code d'un coach ou d'un ami depuis l'écran Compte (étape 'referral') → 'saved'.
//  Compte tout neuf : « J'ai un code d'un coach ou d'un ami » sous le pseudo ouvre la même étape.
//  null si l'écran est fermé sans aboutir. WELCOME_SEEN_KEY n'est posé que sur un vrai choix
//  (« Commencer sans compte », connexion réussie). resume : { email, sentAt } d'un code demandé avant
//  que iOS ne ferme l'app (PENDING_CODE_KEY) : l'écran du code s'ouvre par-dessus Bienvenue.
// ═══════════════════════════════════════════════════════════
'use strict';

const flow = {
  root: null, steps: [], mode: 'signin', closable: true, resolve: null,
  email: '', sentAt: 0, busy: false, tick: null, first: false,   // first : pseudo d'un compte tout neuf
  notice: '',                                                      // avertissement « Nouveau compte créé » (newAccountNotice)
  cancelExpired: false,                                            // « Me reconnecter autrement » refusé (compte de plus de 10 min)
  resent: false,                                                   // code renvoyé : seul le dernier est valable
  badCode: '',                                                     // code refusé, gardé dans le champ (curseur à la fin, la saisie suivante le remplace)
  username: '', avatar: null, checkTimer: null, checkSeq: 0,
  referralCode: '',                                                // code de parrainage en cours de saisie
};

// Sous le pseudo d'un compte tout neuf : lien vers l'étape du code, ou le parrain déjà enregistré.
// Masqué hors délai (compte de plus de 30 jours, d'après le serveur s'il a répondu).
function referralLinkHtml() {
  const v = referralView();
  // Parrain coach : le code parraine sans faire rejoindre ce coach, on le dit (Social › Rejoindre un coach)
  if (v.referrer) return `<p class="auth__referral-done">${icon('checkmark', 16)}<span>${esc(`Parrainé par ${v.referrer}`)}</span></p>`
    + (referralSuggestJoin(v) ? `<p class="auth__referral-join">${esc(`Pour que ${v.referrer} suive tes séances, rejoins ce coach ensuite dans Social › Rejoindre un coach.`)}</p>` : '');
  return v.canEnter ? '<button class="auth__link auth__referral-link" data-action="auth-referral">J\'ai un code d\'un coach ou d\'un ami</button>' : '';
}

// context : 'coach' quand le pseudo est demandé pour rejoindre un coach (texte du pseudo adapté) ;
// 'paywall' quand le verrou est allumé et qu'il faut un compte pour enregistrer (texte de Bienvenue
// adapté, sans « Commencer sans compte » : on ferme avec « Annuler »)
function openAuthFlow({ step = 'welcome', mode = 'signin', closable = true, email = '', sentAt = 0, resume = null, context = null } = {}) {
  if (flow.root) closeAuthFlow(null);
  if (resume) ({ email, sentAt } = resume);
  Object.assign(flow, { steps: [], mode, context, closable, email, sentAt, busy: false, first: false, notice: '', cancelExpired: false, resent: false, badCode: '', referralCode: '',
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
  if (resume) flow.steps.push(step);   // Bienvenue dessous : « Retour » y ramène
  authGo(resume ? 'code' : step);
  return new Promise(resolve => { flow.resolve = resolve; });
}

function closeAuthFlow(result) {
  const root = flow.root;
  if (!root) return;
  clearInterval(flow.tick);
  clearTimeout(flow.checkTimer);
  flow.root = null;
  forgetPendingCode();   // fermé (connecté ou abandonné) : pas de reprise sur l'écran du code
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
  // Retour : même bouton et même règle que la barre de navigation de l'app (fitBackLabel)
  const left = flow.steps.length > 1
    ? `<button class="auth__nav navbar__back" data-action="auth-back" aria-label="Retour">${icon('chevron.left', 22)}<span class="navbar__back-label">Retour</span></button>`
    : flow.closable ? `<button class="auth__nav" data-action="auth-close">Annuler</button>` : '';
  // Avatar : « OK » en haut à droite, comme une feuille iOS (toujours visible, même sur un iPhone SE)
  const right = step === 'avatar' ? '<button class="auth__nav auth__nav--done" data-action="auth-avatar-done">OK</button>' : '';
  flow.root.innerHTML = `
    <div class="auth__bar">${left}<span class="auth__bar-gap"></span>${right}</div>
    <div class="auth__page auth__page--${step}">${AUTH_STEPS[step]()}</div>`;
  flow.root.scrollTop = 0;
  fitBackLabel(flow.root);
  const field = flow.root.querySelector('.auth__input');
  if (field) setTimeout(() => field.focus(), 60);
  else flow.root.querySelector('#authTitle')?.focus({ preventScroll: true });
  if (step === 'code') startResendTick();
  if (step === 'username') checkUsername();
  if (step === 'username' && flow.first) refreshReferralSlot();
}

// État du parrainage relu sur le serveur : seul le lien sous le pseudo change (la saisie reste)
async function refreshReferralSlot() {
  if (!(await referralLoad())) return;
  const slot = flow.root?.querySelector('#authReferralSlot');
  if (slot) slot.innerHTML = referralLinkHtml();
}

// ── Gabarits des étapes ─────────────────────────────────────

// Pseudo en cours de saisie (normalisé), sinon celui du compte : son initiale remplace l'avatar
function flowUsername() { return normalizeUsername(flow.username) || account.profile?.username || ''; }
function flowAvatarHtml() { return avatarHtml('xl', flow.avatar, flowUsername()); }

const AUTH_STEPS = {
  welcome: () => flow.context === 'paywall' ? `
      <div class="auth__hero">
        <div class="auth__logo">${appIconSvg(DEFAULT_APP_ICON, { attrs: 'aria-hidden="true" focusable="false"' })}</div>
        <h1 class="auth__title auth__title--welcome" id="authTitle" tabindex="-1">Un compte pour enregistrer</h1>
        <p class="auth__lead">Connecte-toi ou crée un compte pour enregistrer tes séances. Ton abonnement, et son essai gratuit, y seront rattachés.</p>
      </div>
      <div class="auth-buttons">${signInButtonsHtml()}</div>
      <p class="auth__again">Déjà un compte ? Utilise le même moyen qu'avant.</p>
      <p class="auth__foot">Tes séances déjà faites restent sur cet iPhone, avec l'historique, les progrès et l'export. <button class="link-inline" data-action="account-privacy">Confidentialité</button></p>
      <p class="auth__error" id="authError" role="alert"></p>` : `
      <div class="auth__hero">
        <div class="auth__logo">${appIconSvg(DEFAULT_APP_ICON, { attrs: 'aria-hidden="true" focusable="false"' })}</div>
        <h1 class="auth__title auth__title--welcome" id="authTitle" tabindex="-1">Bienvenue dans MDLF&nbsp;Training</h1>
        <p class="auth__tagline">Ton carnet de muscu qui te dit quoi soulever pour progresser.</p>
        <p class="auth__lead">Crée un compte pour sauvegarder tes séances et les retrouver sur un nouvel iPhone.</p>
      </div>
      <div class="auth-buttons">${signInButtonsHtml()}</div>
      <p class="auth__again">Déjà un compte ? Utilise le même moyen qu'avant.</p>
      <button class="auth__skip" data-action="auth-skip" aria-describedby="authSkipNote">Commencer sans compte</button>
      <p class="auth__foot" id="authSkipNote">Facultatif, sans publicité. Tu pourras créer un compte plus tard dans Réglages. <button class="link-inline" data-action="account-privacy">Confidentialité</button></p>
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
      <p class="auth__last-code" id="authLastCode" ${flow.resent ? '' : 'hidden'}>${LAST_CODE_ONLY}</p>
      <form class="auth__form" data-form="code" novalidate>
        <label class="visually-hidden" for="authCode">Code à 6 chiffres</label>
        <input class="auth__input auth__code num" id="authCode" type="text" inputmode="numeric" autocomplete="one-time-code"
          pattern="[0-9]*" maxlength="${OTP_LENGTH + 4}" enterkeyhint="done" placeholder="······" aria-describedby="authError">
        <p class="auth__error" id="authError" role="alert"></p>
        <button class="btn btn--primary auth__primary" type="submit" data-role="verify" disabled>Valider</button>
      </form>
      <div class="auth__links">
        <button class="auth__link num" data-action="auth-resend" id="authResend" disabled>Renvoyer le code</button>
        ${flow.mode === 'reauth' ? '' : '<button class="auth__link" data-action="auth-change-email">Changer d\'adresse</button>'}
      </div>`,

  username: () => {
    const next = flow.mode === 'profile' ? usernameNextChange(account.profile) : 0;
    const valid = !usernameProblem(normalizeUsername(flow.username));
    return `
      <button class="auth__avatar" data-action="auth-open-avatar" aria-label="${esc(`Avatar : ${avatarName(flow.avatar)}. Modifier`)}">
        ${flowAvatarHtml()}<span class="auth__avatar-edit" aria-hidden="true">Modifier</span>
      </button>
      <h1 class="auth__title" id="authTitle" tabindex="-1">${flow.first ? 'Choisis ton pseudo' : 'Pseudo'}</h1>
      <p class="auth__lead">${flow.context === 'coach' ? 'Ton coach te reconnaîtra avec ce pseudo.' : 'Tes amis te trouveront avec ce pseudo, une fois le social activé.'}</p>
      ${flow.first && flow.cancelExpired ? cancelExpiredHtml()
        : flow.first && flow.notice ? `<div class="auth__notice" role="note"><p>${esc(flow.notice)}</p>
        <button class="auth__notice-btn" data-action="auth-cancel-account">Me reconnecter autrement</button></div>` : ''}
      <form class="auth__form" data-form="username" novalidate>
        <label class="visually-hidden" for="authUsername">Pseudo</label>
        <div class="auth__at-field"><span class="auth__at" aria-hidden="true">@</span>
          <input class="auth__input auth__input--at" id="authUsername" type="text" autocomplete="username" autocapitalize="none"
            autocorrect="off" spellcheck="false" maxlength="30" enterkeyhint="done" placeholder="pseudo" value="${esc(flow.username)}"
            aria-describedby="authUsernameStatus" ${next ? 'disabled' : ''}></div>
        <p class="auth__status" id="authUsernameStatus" aria-live="polite">${next ? esc(`Prochain changement possible le ${fmtDate(next, 'day')}.`) : USERNAME_HELP}</p>
        <button class="btn btn--primary auth__primary" type="submit" data-role="save" ${next || !valid ? 'disabled' : ''}>${flow.first ? 'Continuer' : 'Enregistrer'}</button>
      </form>
      ${flow.first ? `<div class="auth__referral-slot" id="authReferralSlot">${referralLinkHtml()}</div>` : ''}
      ${flow.first ? '<button class="auth__skip" data-action="auth-later">Plus tard</button>' : ''}
      ${flow.first && !flow.notice && !flow.cancelExpired ? `<p class="auth__again auth__again--link">Tu avais déjà un compte ? <button class="link-inline auth__again-btn" data-action="auth-cancel-account">Reconnecte-toi</button></p>` : ''}`;
  },

  referral: () => `
      <h1 class="auth__title auth__title--left" id="authTitle" tabindex="-1">Code d'un coach ou d'un ami</h1>
      <p class="auth__lead auth__lead--left">Si quelqu'un t'a fait découvrir l'app, saisis son code. Facultatif.</p>
      <form class="auth__form" data-form="referral" novalidate>
        <label class="visually-hidden" for="authReferral">Code</label>
        <input class="auth__input auth__referral" id="authReferral" type="text" autocomplete="off" autocapitalize="characters"
          autocorrect="off" spellcheck="false" maxlength="30" enterkeyhint="done" placeholder="CODE" value="${esc(flow.referralCode)}" aria-describedby="authError authReferralNote">
        <p class="auth__error" id="authError" role="alert"></p>
        <button class="btn btn--primary auth__primary" type="submit" data-role="referral" ${normalizeReferralCode(flow.referralCode) ? '' : 'disabled'}>Valider</button>
      </form>
      <p class="auth__foot" id="authReferralNote">Le code est gardé avec ton compte pour rémunérer la personne qui t'a fait connaître l'app. Il ne lui donne accès ni à ton compte ni à tes séances. <button class="link-inline" data-action="account-privacy">Confidentialité</button></p>`,

  avatar: () => `
      <h1 class="auth__title" id="authTitle" tabindex="-1">Choisis ton avatar</h1>
      <p class="auth__lead">Un emoji, ou l'initiale de ton pseudo.</p>
      <div class="avatar-grid" role="group" aria-labelledby="authTitle">
        <button class="avatar-pick avatar-pick--initial" data-action="auth-avatar" data-emoji="" aria-label="${NO_AVATAR_NAME}" aria-pressed="${flow.avatar === null}">${avatarInitial(flowUsername()) ? esc(avatarInitial(flowUsername())) : icon('dumbbell', 24)}</button>
        ${AVATAR_EMOJIS.map(a => `<button class="avatar-pick" data-action="auth-avatar" data-emoji="${a.emoji}" aria-label="${esc(a.name)}" aria-pressed="${a.emoji === flow.avatar}">${a.emoji}</button>`).join('')}
      </div>
      <p class="auth__error" id="authError" role="alert"></p>`,
};

// Annulation refusée (compte de plus de 10 min) : seul ce message reste, à la place de « Nouveau
// compte créé. Déjà un compte ? » et de son bouton (qui ne peut plus rien faire)
const CANCEL_EXPIRED_TEXT = 'Ce nouveau compte (vide) a plus de 10 minutes : supprime-le dans Réglages › Compte › Supprimer mon compte. Ton ancien compte n\'est pas touché.';
function cancelExpiredHtml() {
  return `<div class="auth__notice auth__notice--alone" role="alert"><p>${esc(CANCEL_EXPIRED_TEXT)}</p></div>`;
}

// Code demandé (connexion) : gardé 10 min pour rouvrir l'écran du code si iOS ferme l'app
function rememberPendingCode() {
  try { localStorage.setItem(PENDING_CODE_KEY, JSON.stringify({ email: flow.email, sentAt: flow.sentAt })); } catch { /* reprise impossible, rien de grave */ }
}
function forgetPendingCode() { try { localStorage.removeItem(PENDING_CODE_KEY); } catch { /* rien */ } }

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
    // Code refusé encore dans le champ : ce qui est tapé derrière le remplace (pas de 7e chiffre ignoré)
    if (flow.badCode && t.value.startsWith(flow.badCode) && t.value.length > flow.badCode.length) t.value = t.value.slice(flow.badCode.length);
    flow.badCode = '';
    const digits = codeDigits(t.value);
    if (t.value !== digits) t.value = digits;
    authError('');
    flow.root.querySelector('[data-role="verify"]').disabled = digits.length !== OTP_LENGTH;
    if (digits.length === OTP_LENGTH) submitCode(digits);   // envoi automatique au 6e chiffre
  } else if (t.id === 'authUsername') {
    flow.username = t.value;
    // Sans emoji, l'avatar suit l'initiale du pseudo tapé
    const shown = flow.root.querySelector('.auth__avatar .avatar');
    if (shown && !flow.avatar) shown.outerHTML = flowAvatarHtml();
    // « Continuer » actif seulement pour un pseudo valable (la disponibilité suit)
    flow.root.querySelector('[data-role="save"]').disabled = !!usernameProblem(normalizeUsername(t.value));
    clearTimeout(flow.checkTimer);
    flow.checkTimer = setTimeout(checkUsername, 350);
  } else if (t.id === 'authReferral') {
    flow.referralCode = t.value;
    authError('');
    flow.root.querySelector('[data-role="referral"]').disabled = !normalizeReferralCode(t.value);
  }
}

function onAuthSubmit(e) {
  e.preventDefault();
  const form = e.target.dataset.form;
  if (form === 'email') submitEmail();
  if (form === 'code') { const d = codeDigits(flow.root.querySelector('#authCode').value); if (d.length === OTP_LENGTH) submitCode(d); }
  if (form === 'username') submitUsername();
  if (form === 'referral') submitReferral();
}

// ── Code de parrainage ──────────────────────────────────────

// Enregistré : depuis le pseudo d'un compte neuf, retour au pseudo (qui affiche « Parrainé par … ») ;
// depuis l'écran Compte, fermé
async function submitReferral() {
  if (flow.busy) return;
  const code = normalizeReferralCode(flow.referralCode);
  if (!code) { authError(referralErrorText('invalid_code')); return; }
  setBusy(true);
  const r = await referralApply(code);
  setBusy(false);
  if (!flow.root) return;
  if (!r.ok) { authError(referralErrorText(r.kind)); flow.root.querySelector('#authReferral')?.focus(); return; }
  haptic('success');
  // Parrain coach : rappel affiché sous « Parrainé par » (pseudo, Réglages › Compte), pas dans le toast
  const text = `Parrainé par ${r.data.name}`;
  if (flow.mode === 'referral') { closeAuthFlow('saved'); render(); showToast(text); return; }
  announce(text);
  authBack();
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
  flow.resent = false;
  if (flow.mode === 'signin') rememberPendingCode();
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

// Code refusé : les chiffres restent (contour et message en rouge), curseur à la fin, jamais de
// sélection automatique (règle iOS de l'app) : le premier chiffre tapé ensuite remplace l'ancien code
// (onAuthInput). Après un renvoi, « Seul le code du dernier e-mail… » reste sous le titre (un seul endroit).
function codeFailed(kind) {
  const input = flow.root.querySelector('#authCode');
  authError(authErrorText(kind));
  if (!input) return;
  input.focus();
  if (kind === 'invalid' || kind === 'expired' || kind === 'code') {
    flow.badCode = input.value;
    try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* champ sans curseur */ }
  }
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
  flow.resent = true;
  flow.badCode = '';
  if (flow.mode === 'signin') rememberPendingCode();
  authError('');
  flow.root.querySelector('#authLastCode')?.removeAttribute('hidden');
  const input = flow.root.querySelector('#authCode');
  if (input) { input.value = ''; input.focus(); }
  announce(`Nouveau code envoyé. ${LAST_CODE_ONLY}`);
  startResendTick();
}

// ── Après la connexion ──────────────────────────────────────

function signedIn(res) {
  setLsFlag(WELCOME_SEEN_KEY);   // vrai choix fait : Bienvenue ne revient plus
  forgetPendingCode();
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
  showToast(signedInToast(res), { duration: SIGNED_IN_TOAST_MS });
}

async function signInWithProvider(provider, el) {
  if (flow.busy) return;
  setBusy(true);
  if (el) el.disabled = true;
  let r;
  try { r = await accountSignInWith(provider, askMergeOtherAccount); }
  catch { r = { ok: false, reason: 'server' }; }
  finally { setBusy(false); if (el?.isConnected) el.disabled = false; notifyAccount(); }
  if (r.reason === 'cancel') { if (r.discarded) announce('Compte annulé'); return; }
  if (!r.ok && r.reason !== 'sync') {
    // Hors ligne : la cause, pas « Connexion impossible »
    const msg = navigator.onLine === false ? authErrorText('offline')
      : r.reason === 'provider' ? `Connexion avec ${provider === 'apple' ? 'Apple' : 'Google'} impossible.` : authErrorText(r.kind);
    if (flow.root) authError(msg); else showToast(msg, { error: true });
    return;
  }
  if (flow.root) { signedIn(r); return; }
  // Depuis l'écran Compte : même suite, dans un calque ouvert pour le pseudo
  setLsFlag(WELCOME_SEEN_KEY);
  render();
  if (r.isNew) { openAuthFlow({ step: 'username', mode: 'profile', closable: false }); flow.first = true; flow.notice = newAccountNotice(r); paintAuth(); }
  else showToast(signedInToast(r), { duration: SIGNED_IN_TOAST_MS });
}

// ── Pseudo et avatar ────────────────────────────────────────

// État sous le champ : règle locale d'abord, puis disponibilité demandée au serveur
async function checkUsername() {
  const status = flow.root?.querySelector('#authUsernameStatus');
  const input = flow.root?.querySelector('#authUsername');
  if (!status || !input || input.disabled) return;
  const name = normalizeUsername(flow.username);
  const save = flow.root.querySelector('[data-role="save"]');
  status.className = 'auth__status';
  if (!flow.username.trim()) { status.textContent = USERNAME_HELP; return; }
  const bad = usernameProblem(name);
  const shown = name !== flow.username.trim() ? ` · enregistré @${name}` : '';
  if (bad) { status.textContent = USERNAME_TEXT[bad]; status.classList.add('auth__status--bad'); return; }
  if (name === account.profile?.username) { status.textContent = 'C\'est ton pseudo actuel'; return; }
  const seq = ++flow.checkSeq;
  status.textContent = `Vérification…${shown}`;
  const free = await accountUsernameAvailable(name);
  if (seq !== flow.checkSeq || !flow.root) return;
  if (free === null) { status.textContent = `Disponibilité vérifiée à l'enregistrement${shown}`; return; }
  status.textContent = free ? `Disponible${shown}` : takenText();
  status.classList.add(free ? 'auth__status--ok' : 'auth__status--bad');
  if (!free && save) save.disabled = true;
}

// Pseudo pris au tout premier choix : sans doute le même utilisateur, avec un autre moyen de connexion
function takenText() { return flow.first ? USERNAME_TEXT.taken_first : USERNAME_TEXT.taken; }

async function submitUsername() {
  if (flow.busy) return;
  const name = normalizeUsername(flow.username);
  const bad = usernameProblem(name);
  const status = flow.root.querySelector('#authUsernameStatus');
  const fail = msg => { status.textContent = msg; status.className = 'auth__status auth__status--bad'; haptic('medium'); };
  if (bad) { fail(USERNAME_TEXT[bad]); return; }
  // Avatar envoyé seulement s'il a changé (un profil tout neuf sans avatar garde le défaut du serveur)
  const changes = {};
  if (flow.avatar !== validAvatar(account.profile?.avatar)) changes.avatar = flow.avatar;
  if (name !== account.profile?.username) changes.username = name;
  setBusy(true);
  const r = await accountSaveProfile(changes);
  setBusy(false);
  if (!flow.root) return;
  if (!r.ok) { fail(r.kind === 'taken' ? takenText() : USERNAME_TEXT[r.kind] || USERNAME_TEXT.server); return; }
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
  'auth-skip': () => { setLsFlag(WELCOME_SEEN_KEY); closeAuthFlow(null); render(); },
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
  'auth-referral': () => authGo('referral'),
  'auth-avatar': (e, el) => {
    flow.avatar = validAvatar(el.dataset.emoji);
    flow.root.querySelectorAll('.avatar-pick').forEach(b => b.setAttribute('aria-pressed', String(validAvatar(b.dataset.emoji) === flow.avatar)));
    haptic();
  },
  'auth-avatar-done': async () => {
    // Depuis le pseudo : choix gardé pour l'enregistrement du pseudo
    if (flow.steps.includes('username')) { authBack(); return; }
    if (flow.busy) return;
    if (flow.avatar === validAvatar(account.profile?.avatar)) { closeAuthFlow(null); return; }   // rien de changé
    setBusy(true);
    const r = await accountSaveProfile({ avatar: flow.avatar });
    setBusy(false);
    if (!flow.root) return;
    if (!r.ok) { authError(USERNAME_TEXT[r.kind] || USERNAME_TEXT.server); return; }
    closeAuthFlow('saved');   // l'avatar changé à l'écran suffit, pas de message
    render();
  },
  // Compte tout neuf créé par erreur : supprimé (rien ne s'y perd), puis retour aux moyens de connexion
  'auth-cancel-account': async (e, el) => {
    if (flow.busy) return;
    setBusy(true);
    el.disabled = true;
    const r = await accountCancelNewAccount();
    setBusy(false);
    if (!flow.root) return;
    if (!r.ok && r.reason === 'expired') {
      // Le message remplace l'avertissement et son bouton (même place, sans redessiner : saisie gardée)
      flow.cancelExpired = true;
      flow.root.querySelectorAll('.auth__notice, .auth__again--link').forEach(n => n.remove());
      flow.root.querySelector('.auth__form[data-form="username"]')?.insertAdjacentHTML('beforebegin', cancelExpiredHtml());
      haptic('medium');
      return;
    }
    if (!r.ok) {
      el.disabled = false;
      const status = flow.root.querySelector('#authUsernameStatus');
      status.textContent = r.reason === 'kept' ? 'Ce compte contient déjà des données : il est gardé. Tu peux te déconnecter dans Réglages › Compte.'
        : navigator.onLine === false ? authErrorText('offline') : 'Annulation impossible pour l\'instant, réessaie dans un moment.';
      status.className = 'auth__status auth__status--bad';
      haptic('medium');
      return;
    }
    render();
    if (currentView() !== 'account') {
      // Retour aux moyens de connexion (Bienvenue, avec « Commencer sans compte ») ; depuis l'écran
      // Compte, il les montre déjà. Aucun choix fait : Bienvenue revient si l'app est fermée ici.
      try { localStorage.removeItem(WELCOME_SEEN_KEY); } catch { /* rien */ }
      Object.assign(flow, { steps: [], first: false, notice: '', cancelExpired: false, closable: false, username: '', avatar: DEFAULT_AVATAR });
      authGo('welcome');
    } else closeAuthFlow(null);
    showToast('Compte annulé. Reconnecte-toi avec le même moyen qu\'avant');
  },
});
