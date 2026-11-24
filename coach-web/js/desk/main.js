// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : démarrage, routes, connexion, gestes (docs/COACH_WEB.md)
//
//  Routes (hash, aucune configuration de serveur) : #/ tableau de bord, #/eleve/<id> fiche Semaines, #/reglages.
//  Connexion avec Apple (js/desk/apple.js) ou par code e-mail ; seul un compte coach validé (coach_state().is_coach) entre, et chaque RPC le revérifie
//  sur le serveur. 30 min sans geste : déconnexion. Données relues au retour sur l'onglet (60 s au moins d'écart).
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_REFRESH_MS = 60_000;
const ui = { filter: 'todo', query: '', weeks: DESK_WEEKS_SHOWN, login: { step: 'email', email: '', busy: false, error: '' } };
const view = { dash: null, dashAt: 0, dashError: null, student: null, notCoach: false, appleNew: false };

const DESK_ERRORS = {
  offline: 'Pas d\'Internet : vérifie ta connexion et réessaie.',
  signed_out: 'Ta session est terminée : reconnecte-toi.',
  not_found: 'Cet élève ne te suit plus.',
  rate_limited: 'Trop de demandes : réessaie dans une minute.',
  server: 'Le serveur ne répond pas. Réessaie dans un instant.',
};
function deskErrorText(kind) { return DESK_ERRORS[kind] || DESK_ERRORS.server; }
// Connexion : textes de l'app (AUTH_ERROR_TEXT), sauf ceux propres à l'iPhone
function deskAuthText(kind) {
  if (kind === 'disabled' || kind === 'no_account' || kind === 'not_authorized') return 'Aucun compte MDLF n\'utilise cette adresse pour se connecter. Prends l\'adresse de ton compte coach (dans l\'app : Réglages › Compte).';
  return AUTH_ERROR_TEXT[kind] || DESK_ERRORS[kind] || DESK_ERRORS.server;
}

function deskRoute() {
  const h = location.hash || '#/';
  const m = /^#\/eleve\/([0-9a-f-]{1,64})$/i.exec(h);
  if (m) return { name: 'student', id: decodeURIComponent(m[1]) };
  if (h === '#/reglages') return { name: 'settings' };
  return { name: 'dash' };
}

function deskPaint(html, { focusMain = false } = {}) {
  const root = document.getElementById('app');
  const active = document.activeElement?.id;
  const caret = active === 'q' ? document.getElementById('q').selectionStart : null;
  root.innerHTML = html;
  frTypoNode(root);
  if (active && document.getElementById(active)) {
    const el = document.getElementById(active); el.focus({ preventScroll: true });
    if (caret !== null && el.setSelectionRange) el.setSelectionRange(caret, caret);
  } else if (focusMain) document.getElementById('main')?.focus({ preventScroll: true });
}

// ── Écrans ──────────────────────────────────────────────────

function deskLoginHtml() {
  const l = ui.login;
  const email = l.step === 'email';
  return `<main class="login" id="main" tabindex="-1"><div class="login-card">
    <div class="brand lg">MDLF <span>Coach</span></div>
    <h1 class="title">${email ? 'Connexion' : 'Code reçu par e-mail'}</h1>
    <p class="sub">${email ? 'Avec le compte coach de ton app MDLF Training : Apple, ou un code à 6 chiffres reçu par e-mail.' : `Code envoyé à ${esc(l.email)}. Il est valable 10 minutes.`}</p>
    ${email ? deskAppleButtonHtml(l.busy) : ''}
    <form class="login-f" data-form="${email ? 'email' : 'code'}" novalidate>
      ${email
    ? `<label class="fld"><span>Adresse e-mail</span><input id="login-email" type="email" name="email" autocomplete="email" inputmode="email" required value="${esc(l.email)}" ${l.error ? 'aria-invalid="true" aria-describedby="login-err"' : ''}></label>`
    : `<label class="fld"><span>Code à 6 chiffres</span><input id="login-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required ${l.error ? 'aria-invalid="true" aria-describedby="login-err"' : ''}></label>`}
      <p class="err" id="login-err" role="alert">${esc(l.error)}</p>
      <button class="btn tint lg wide" ${l.busy ? 'disabled aria-busy="true"' : ''}>${email ? 'Recevoir un code' : 'Se connecter'}</button>
      ${email ? '' : '<button type="button" class="btn link" data-action="login-back">Changer d\'adresse ou renvoyer un code</button>'}
    </form>
    <p class="note">${deskApple.state === 'off'
    ? 'Ton compte utilise seulement Apple ? La connexion avec Apple n\'a pas pu se charger (réseau, bloqueur de contenu) : recharge la page, ou ajoute ton adresse e-mail dans l\'app, Réglages › Compte › Moyens de connexion.'
    : 'Ton compte utilise seulement Apple ? Choisis « Se connecter avec Apple », avec le même identifiant Apple que dans l\'app. La connexion avec Google arrive ensuite.'}</p>
    <p class="note">Sur un ordinateur partagé, la session se ferme après 30 minutes sans activité.</p>
  </div></main>`;
}
function deskNotCoachHtml() {
  return `<main class="login" id="main" tabindex="-1"><div class="login-card"><div class="brand lg">MDLF <span>Coach</span></div>
    <h1 class="title">Réservé aux coachs</h1>
    <p class="sub">${view.appleNew
    ? 'Cet identifiant Apple n\'avait pas encore de compte MDLF. Déconnecte-toi, puis reconnecte-toi avec le même identifiant Apple que dans l\'app.'
    : 'Ce compte n\'est pas un compte coach validé. La demande se fait dans l\'app : Réglages › Coach › Devenir coach.'}</p>
    <button type="button" class="btn lg wide" data-action="signout">${deskIcon('signout', 'sm')}Se déconnecter</button></div></main>`;
}
function deskSettingsHtml() {
  const email = desk.user?.email || '';
  return deskFrame({ active: 'settings', students: view.dash?.rows.length ?? null, main: `<div class="head"><div class="grow"><h1 class="title">Réglages</h1></div></div>
    <section class="narrow" aria-labelledby="h-acc"><h2 class="gh" id="h-acc">Compte</h2><div class="group">
      <div class="row"><div class="grow">Connecté${email ? ` avec ${esc(email)}` : ''}</div></div>
      <button type="button" class="row act" data-action="signout">${deskIcon('signout', 'sm')}<span class="grow">Se déconnecter de cet ordinateur</span></button>
    </div><div class="gfoot">Ton iPhone reste connecté. Sur cet ordinateur, la session se ferme aussi après 30 minutes sans activité, et rien de tes élèves n'y est gardé.</div></section>` });
}

function deskRender(opts = {}) {
  if (!desk.user) { deskPaint(deskLoginHtml(), opts); return; }
  if (view.notCoach) { deskPaint(deskNotCoachHtml(), opts); return; }
  const route = deskRoute();
  if (route.name === 'settings') { deskPaint(deskSettingsHtml(), opts); return; }
  if (!view.dash) {
    const body = view.dashError ? `<div class="empty" role="alert">${esc(deskErrorText(view.dashError))}<br><button type="button" class="btn tint" data-action="reload">Réessayer</button></div>`
      : '<div class="empty" role="status">Chargement de tes élèves…</div>';
    deskPaint(deskFrame({ active: 'students', main: body }), opts); return;
  }
  if (route.name === 'student') {
    const s = view.student && view.student.id === route.id ? view.student : null;
    const row = view.dash.rows.find(r => r.id === route.id) || null;
    const d = s ? { ...s, row } : { row, loading: !!row };
    deskPaint(deskFrame({ active: 'students', students: view.dash.rows.length, main: deskStudentHtml(d, ui) }), opts);
    return;
  }
  deskPaint(deskFrame({ active: 'students', students: view.dash.rows.length, main: deskDashboardHtml(view.dash, ui) }), opts);
}

// ── Données ─────────────────────────────────────────────────

async function deskRefresh({ force = false } = {}) {
  if (!desk.user || (!force && Date.now() - view.dashAt < DESK_REFRESH_MS)) return;
  view.dashAt = Date.now();
  const r = await deskLoadDashboard(Date.now());
  if (!r.ok) {
    if (r.kind === 'signed_out') return deskEndSession();
    view.dashError = r.kind; deskRender(); return;
  }
  if (!r.data.state.is_coach) { view.notCoach = true; deskRender(); return; }
  view.dashError = null;
  view.dash = { ...r.data, rows: deskStudentRows(r.data) };
  deskRender();
  const route = deskRoute();
  if (route.name === 'student') deskOpenStudent(route.id);
}
async function deskOpenStudent(id, { force = false } = {}) {
  if (!force && view.student?.id === id && !view.student.error && Date.now() - view.student.at < DESK_REFRESH_MS) return;
  if (!view.dash?.rows.some(r => r.id === id)) { deskRender(); return; }
  view.student = { id, loading: true, at: Date.now() };
  deskRender();
  const now = Date.now();
  const r = await deskLoadWeeks(id, DESK_WEEKS_MAX, now);
  if (deskRoute().id !== id) return;
  if (!r.ok) {
    if (r.kind === 'signed_out') return deskEndSession();
    view.student = { id, error: r.kind, at: Date.now() }; deskRender(); return;
  }
  const phases = view.dash.plans ? view.dash.plans[id] || [] : null;
  const weeks = deskWeeks({ ...r.data, phases, now, count: DESK_WEEKS_MAX });
  view.student = { id, at: Date.now(), now, weeks, weights: r.data.weights, measures: r.data.measures, diet: r.data.diet,
    chart: deskWeightChart(r.data.weights, now) };
  deskRender();
}
async function deskEndSession() {
  await deskSignOut();
  Object.assign(view, { dash: null, student: null, notCoach: false, dashAt: 0 });
  location.hash = '#/';
  location.reload();
}

// ── Gestes ──────────────────────────────────────────────────

async function deskCopy(code) {
  try { await navigator.clipboard.writeText(code); deskToast('Code copié'); }
  catch { deskToast(`Code : ${deskCodeText(code)}`); }
}
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'soon') { e.preventDefault(); deskToast(`${el.dataset.what} : arrive dans une prochaine version`); }
  else if (a === 'filter') { ui.filter = el.dataset.filter; deskRender(); }
  else if (a === 'copy-code') deskCopy(el.dataset.code);
  else if (a === 'invite') document.getElementById('invite-dialog')?.showModal();
  else if (a === 'new-invite') { const r = await deskNewInvite(); if (r.ok) { view.dash.code = r.code; view.dash.codeExpires = Date.now() + 7 * 86_400_000; deskRender(); } else deskToast(deskErrorText(r.kind)); }
  else if (a === 'more-weeks') { ui.weeks = DESK_WEEKS_MAX; deskRender(); }
  else if (a === 'reload') { if (deskRoute().name === 'student') deskOpenStudent(deskRoute().id, { force: true }); else deskRefresh({ force: true }); }
  else if (a === 'signout') deskEndSession();
  else if (a === 'apple') deskAppleClick();
  else if (a === 'login-back') { Object.assign(ui.login, { step: 'email', error: '' }); deskRender(); document.getElementById('login-email')?.focus(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { ui.query = e.target.value.slice(0, SEARCH_MAX); deskRender(); }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const l = ui.login;
  if (l.busy) return;
  if (f.dataset.form === 'email') {
    const email = normalizeEmail(f.email.value);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { l.error = AUTH_ERROR_TEXT.email; l.email = f.email.value; deskRender(); document.getElementById('login-email')?.focus(); return; }
    Object.assign(l, { busy: true, error: '', email }); deskRender();
    const r = await deskSendCode(email);
    Object.assign(l, { busy: false, step: r.ok ? 'code' : 'email', error: r.ok ? '' : deskAuthText(r.kind) });
    deskRender();
    document.getElementById(r.ok ? 'login-code' : 'login-email')?.focus();
  } else {
    const code = String(f.code.value || '').replace(/\D/g, '');
    if (code.length !== 6) { l.error = AUTH_ERROR_TEXT.invalid; deskRender(); document.getElementById('login-code')?.focus(); return; }
    Object.assign(l, { busy: true, error: '' }); deskRender();
    const r = await deskVerifyCode(code);
    Object.assign(l, { busy: false, error: r.ok ? '' : deskAuthText(r.kind) });
    if (!r.ok) { deskRender(); document.getElementById('login-code')?.focus(); return; }
    deskRender({ focusMain: true });
    deskRefresh({ force: true });
  }
});
// Apple : signIn() part dans le geste (aucune attente avant) ; seul un coach validé entre ensuite (deskRefresh)
async function deskAppleClick() {
  const l = ui.login;
  if (l.busy) return;
  const run = deskAppleSignIn();
  Object.assign(l, { busy: true, error: '' }); deskRender();
  const r = await run;
  Object.assign(l, { busy: false, error: r.ok || !r.kind ? '' : DESK_APPLE_TEXT[r.kind] || deskAuthText(r.kind) });
  if (!r.ok) { deskRender(); document.getElementById('apple-signin')?.focus(); return; }
  view.appleNew = !!r.isNew;
  deskRender({ focusMain: true });
  deskRefresh({ force: true });
}
// Clavier : / recherche, J / K élève suivant ou précédent (Entrée ouvre : c'est un lien), Échap vide la recherche
document.addEventListener('keydown', e => {
  deskTouch();
  const t = e.target, typing = t.matches?.('input, textarea, select, [contenteditable]');
  if (e.key === 'Escape' && t.id === 'q' && t.value) { ui.query = ''; deskRender(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !desk.user || deskRoute().name !== 'dash') return;
  if (e.key === '/') { e.preventDefault(); document.getElementById('q')?.focus(); return; }
  if (e.key === 'j' || e.key === 'k' || e.key === 'J' || e.key === 'K') {
    const rows = [...document.querySelectorAll('.lst a.row')];
    if (!rows.length) return;
    const i = rows.indexOf(document.activeElement);
    const next = e.key.toLowerCase() === 'j' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    e.preventDefault(); rows[next].focus(); rows[next].scrollIntoView({ block: 'nearest' });
  }
});
document.addEventListener('pointerdown', () => deskTouch(), { passive: true });
window.addEventListener('hashchange', () => {
  ui.weeks = DESK_WEEKS_SHOWN;
  const route = deskRoute();
  deskRender({ focusMain: true });
  window.scrollTo(0, 0);
  if (route.name === 'student' && desk.user) deskOpenStudent(route.id);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && desk.user) { if (deskIdleFor() > DESK_IDLE_MS) deskEndSession(); else deskRefresh(); } });
setInterval(() => { if (desk.user && deskIdleFor() > DESK_IDLE_MS) deskEndSession(); }, 60_000);

// ── Démarrage ───────────────────────────────────────────────

deskApple.onChange = () => { if (!desk.user) deskRender(); };
(async () => {
  const r = await deskResume();
  if (!r.ok) { ui.login.error = deskAuthText(r.kind); }
  else if (r.expired) ui.login.error = 'Session fermée après 30 minutes sans activité : reconnecte-toi.';
  deskRender();
  if (desk.user) deskRefresh({ force: true });
  else deskAppleLoad();
})();
