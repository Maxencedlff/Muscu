// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : démarrage, routes, connexion, gestes (docs/COACH_WEB.md)
//
//  Routes (hash, aucune configuration de serveur) : #/ tableau de bord, #/eleve/<id> fiche Semaines,
//  #/eleve/<id>/bilans[/<bilan>] onglet Bilans, #/eleve/<id>/programme[/<séance>], #/eleve/<id>/nutrition,
//  #/eleve/<id>/messages, #/messages[/<élève>] Messages, #/bilans Mes bilans, #/bilans-recus Bilans reçus, #/reglages,
//  #/plans-diete[/<plan>] Plans diète, #/eleve/<id>/nutrition/<edit | new | plan> éditeur d'un plan diète.
//  Quitter un écran avec des changements pas enregistrés (bilan en cours d'édition, réponse en cours, programme
//  modifié pas envoyé, plan diète pas enregistré) demande confirmation : le lien revient en arrière tant que le coach n'a pas dit oui.
//  Connexion avec Apple (js/desk/apple.js) ou par code e-mail ; seul un compte coach validé (coach_state().is_coach) entre, et chaque RPC le revérifie
//  sur le serveur. 28 min sans geste : bandeau « Toujours là ? » ; 30 min : la réponse en cours part en brouillon, l'écran
//  est vidé, puis déconnexion. Données relues au retour sur l'onglet (60 s au moins d'écart), et toutes les 90 s sur le
//  tableau de bord et Bilans reçus quand l'onglet est visible (rien n'est redessiné si rien n'a changé).
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_REFRESH_MS = 60_000;
const DESK_POLL_MS = 90_000;
const DESK_IDLE_WARN_MS = DESK_IDLE_MS - 2 * 60_000;
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
  const m = /^#\/eleve\/([0-9a-f-]{1,64})(?:\/(bilans|programme|nutrition|messages)(?:\/([0-9a-z_-]{1,64}))?)?$/i.exec(h);
  if (m) {
    const tab = { bilans: 'checkins', programme: 'programme', nutrition: 'nutrition', messages: 'messages' }[m[2]] || 'weeks';
    return { name: 'student', id: decodeURIComponent(m[1]), tab, request: tab === 'checkins' ? m[3] || null : null, part: tab === 'programme' || tab === 'nutrition' ? m[3] || null : null };
  }
  const mm = /^#\/messages(?:\/([0-9a-f-]{1,64}))?$/i.exec(h);
  if (mm) return { name: 'messages', id: mm[1] ? decodeURIComponent(mm[1]) : null };
  const dd = /^#\/plans-diete(?:\/([A-Za-z0-9_-]{1,64}))?$/.exec(h);
  if (dd) return { name: 'diets', id: dd[1] || null };
  if (h === '#/reglages') return { name: 'settings' };
  if (h === '#/bilans') return { name: 'bilans' };
  if (h === '#/bilans-recus') return { name: 'received' };
  return { name: 'dash' };
}

// Verrou contre les rendus en cascade : remplacer #app fait perdre le focus au champ en cours (blur, change), dont le
// geste peut demander un rendu PENDANT celui-ci (innerHTML réentrant : NotFoundError). Ce rendu-là est refait juste
// après, avec l'état à jour (queueMicrotask)
let deskPainted = '';
let deskPainting = false, deskPaintAgain = null;
function deskPaint(html, opts = {}) {
  if (deskPainting) { if (!deskPaintAgain) { deskPaintAgain = opts; queueMicrotask(() => { const o = deskPaintAgain; deskPaintAgain = null; deskRender(o); }); } return; }
  deskPainting = true;
  try { deskPaint0(html, opts); } finally { deskPainting = false; }
}
function deskPaint0(html, { focusMain = false, quiet = false } = {}) {
  const root = document.getElementById('app');
  // Relecture régulière (quiet) qui ne change rien à l'écran : rien n'est redessiné (focus, sélection, défilement intacts)
  if (quiet && html === deskPainted) return;
  deskPainted = html;
  const active = document.activeElement?.id;
  const ae = document.activeElement;
  const caret = active && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && ae.type !== 'email' ? ae.selectionStart : null;
  const sy = window.scrollY;
  // Cadres qui défilent seuls (fil des messages) : position gardée d'un rendu à l'autre, en bas s'ils y étaient
  const keep = [...root.querySelectorAll('[data-keep-scroll]')].map(el => ({ key: el.dataset.keepScroll, top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight }));
  root.innerHTML = html;
  frTypoNode(root);
  deskRoving(root);
  root.querySelectorAll('[data-keep-scroll]').forEach(el => {
    const k = keep.find(x => x.key === el.dataset.keepScroll);
    if (!k || k.gap < 40 || ms.stick) el.scrollTop = el.scrollHeight;
    else if (ms.prepend) el.scrollTop = el.scrollHeight - el.clientHeight - k.gap;
    else el.scrollTop = k.top;
  });
  ms.stick = false; ms.prepend = false;
  if (active && document.getElementById(active)) {
    const el = document.getElementById(active); el.focus({ preventScroll: true });
    if (caret !== null && el.setSelectionRange) el.setSelectionRange(caret, caret);
  } else if (focusMain) document.getElementById('main')?.focus({ preventScroll: true });
  if (!focusMain && window.scrollY !== sy) window.scrollTo(0, sy);
}
// Compteurs de la barre latérale : bilans à répondre, modèles de bilan
function deskCounts() {
  return { checkins: view.dash?.ckOv ? deskCkToAnswer(view.dash.ckOv, view.dash.rows.map(r => r.id)).length : null, templates: bl.setup ? bl.setup.templates.length : null,
    unread: view.dash?.threads ? view.dash.rows.reduce((a, r) => a + (r.unread || 0), 0) : 0, diets: dt.acc ? deskDtPlanIds(dt.acc).length : null };
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
  return deskFrame({ active: 'settings', students: view.dash?.rows.length ?? null, counts: deskCounts(), main: `<div class="head"><div class="grow"><h1 class="title">Réglages</h1></div></div>
    <section class="narrow" aria-labelledby="h-acc"><h2 class="gh" id="h-acc">Compte</h2><div class="group">
      <div class="row"><div class="grow">Connecté${email ? ` avec ${esc(email)}` : ''}</div></div>
      ${deskHosted() ? (deskHost.exit ? `<button type="button" class="row act" data-action="host-exit">${deskIcon('back', 'sm')}<span class="grow">Revenir à l'appli</span></button>` : '')
    : `<button type="button" class="row act" data-action="signout">${deskIcon('signout', 'sm')}<span class="grow">Se déconnecter de cet ordinateur</span></button>`}
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
  const frame = (active, main) => deskFrame({ active, students: view.dash.rows.length, counts: deskCounts(), main });
  if (route.name === 'student') {
    const s = view.student && view.student.id === route.id ? view.student : null;
    const row = view.dash.rows.find(r => r.id === route.id) || null;
    const d = s ? { ...s, row } : { row, loading: !!row };
    deskPaint(frame('students', deskStudentHtml(d, ui, route.tab)), opts);
    return;
  }
  if (route.name === 'messages') { deskPaint(frame('messages', deskMessagesHtml(route)), opts); return; }
  if (route.name === 'bilans') { deskPaint(frame('templates', deskBilansHtml()), opts); return; }
  if (route.name === 'received') { deskPaint(frame('checkins', deskReceivedHtml(view.dash)), opts); return; }
  if (route.name === 'diets') { deskPaint(frame('diet', deskDtLibHtml(route)), opts); return; }
  deskPaint(frame('students', deskDashboardHtml(view.dash, ui)), opts);
}

// ── Données ─────────────────────────────────────────────────

async function deskRefresh({ force = false, quiet = false } = {}) {
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
  // Résumés des conversations partagés avec js/data/coach-chat.js (non-lus remis à zéro par chatMarkRead)
  chat.threads = view.dash.threads;
  if (view.dash.threads) chat.available = true;
  deskRender({ quiet });
  const route = deskRoute();
  if (route.name === 'student') deskOpenStudent(route.id);
  // Onglets de la vague 4 : à l'ouverture seulement (ensuite, chacun relit ses données lui-même)
  if (force) deskOpenTab(route);
  // Nombre de modèles (barre latérale) et écran Mes bilans : relus avec le tableau de bord
  deskOpenBilans({ keep: true, quiet });
}
async function deskOpenStudent(id, { force = false } = {}) {
  // Même élève déjà affiché : relu en arrière-plan, sans « Chargement… » ni perte de la réponse en cours d'écriture
  const same = view.student?.id === id && !view.student.error && !view.student.loading;
  if (!force && view.student?.id === id && !view.student.error && Date.now() - view.student.at < DESK_REFRESH_MS) return;
  if (!view.dash?.rows.some(r => r.id === id)) { deskRender(); return; }
  if (same) view.student.at = Date.now();
  else {
    view.student = { id, loading: true, at: Date.now() };
    rv.drafts = {};
    rv.sel = deskRoute().request;
    deskRender();
  }
  const now = Date.now();
  const [r, ck] = await Promise.all([deskLoadWeeks(id, DESK_WEEKS_MAX, now), deskLoadStudentCheckins(id)]);
  if (deskRoute().id !== id || view.student?.id !== id) return;
  if (!r.ok) {
    if (r.kind === 'signed_out') return deskEndSession();
    // Relecture de fond qui échoue (réseau) : la fiche affichée reste ; l'élève parti, lui, s'affiche
    if (same && r.kind !== 'not_found') return;
    view.student = { id, error: r.kind, at: Date.now() }; deskRender(); return;
  }
  const prev = same ? view.student : null;
  const phases = view.dash.plans ? view.dash.plans[id] || [] : null;
  const weeks = deskWeeks({ ...r.data, phases, now, count: DESK_WEEKS_MAX });
  view.student = { id, at: Date.now(), now, weeks, weights: r.data.weights, measures: r.data.measures, diet: r.data.diet, health: r.data.health ?? null, sessions: r.data.sessions,
    chart: deskWeightChart(r.data.weights, now),
    // Bilans de l'élève (null : serveur sans les bilans ou lecture refusée ; ckKind dit pourquoi)
    checkins: ck.ok ? ck.data : prev?.checkins || null, ckKind: ck.ok || prev?.checkins ? null : ck.kind };
  deskRender();
}
async function deskEndSession({ expired = false } = {}) {
  // Embarquée dans l'app : la session appartient à l'hôte, on lui rend la main
  if (deskHosted()) { deskHost.exit?.(); return; }
  deskWipe();
  await deskSignOut();
  if (expired) deskMarkExpired();
  Object.assign(view, { dash: null, student: null, notCoach: false, dashAt: 0 });
  location.hash = '#/';
  location.reload();
}

// Écran vidé avant la déconnexion et le rechargement : aucune donnée d'élève ne reste affichée, même sous la fenêtre
// « Quitter le site ? » du navigateur (changements pas enregistrés ailleurs que dans la réponse)
function deskWipe() {
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  deskIdleBanner(false);
  const t = document.getElementById('toast'); if (t) { t.hidden = true; t.textContent = ''; }
  deskPainted = '';
  document.getElementById('app').innerHTML = '<main class="login" id="main" tabindex="-1"><div class="login-card"><div class="brand lg">MDLF <span>Coach</span></div><p class="sub" role="status">Session fermée.</p></div></main>';
}

// ── Fin de session après 30 min sans geste ──────────────────

let deskIdleEnding = false, deskIdleBack = null;
// Bandeau « Toujours là ? » (hors de #app : un rendu ne l'efface pas) ; le focus revient où il était quand il part
function deskIdleBanner(show) {
  const el = document.getElementById('idle');
  if (!show) {
    if (!el) return;
    const back = deskIdleBack; deskIdleBack = null;
    const had = el.contains(document.activeElement);
    el.remove();
    if (had && back?.isConnected) back.focus({ preventScroll: true });
    return;
  }
  if (el) return;
  deskIdleBack = document.activeElement;
  const b = document.createElement('div');
  b.id = 'idle'; b.className = 'idle'; b.setAttribute('role', 'alertdialog');
  b.setAttribute('aria-labelledby', 'idle-t'); b.setAttribute('aria-describedby', 'idle-d');
  b.innerHTML = `<div class="grow"><b id="idle-t">Toujours là ?</b><span class="t2 blk" id="idle-d">Sans geste de ta part, la session se ferme dans 2 minutes. Une réponse en cours sera gardée en brouillon.</span></div>
    <button type="button" class="btn tint" data-action="idle-stay">Rester connecté</button>`;
  frTypoNode(b);
  document.body.appendChild(b);
  b.querySelector('button').focus({ preventScroll: true });
}
// Geste du coach : la session continue, le bandeau part
function deskActivity() {
  if (deskIdleEnding) return;
  deskTouch();
  deskIdleBanner(false);
}
async function deskIdleEnd() {
  if (deskIdleEnding) return;
  deskIdleEnding = true;
  // Écran vidé tout de suite ; la réponse en cours part en brouillon (8 s au plus : un serveur qui ne répond pas ne
  // retarde pas la fermeture), puis déconnexion et rechargement
  deskWipe();
  await Promise.race([deskRvSaveDrafts(), new Promise(r => setTimeout(r, 8000))]);
  await deskEndSession({ expired: true });
}
function deskIdleTick() {
  if (!desk.user || deskIdleEnding || deskHosted()) return;
  const idle = deskIdleFor();
  if (idle > DESK_IDLE_MS) { deskIdleEnd(); return; }
  if (idle > DESK_IDLE_WARN_MS) deskIdleBanner(true);
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
  if (a === 'filter') { ui.filter = el.dataset.filter; deskRender(); }
  else if (a === 'copy-code') deskCopy(el.dataset.code);
  else if (a === 'invite') document.getElementById('invite-dialog')?.showModal();
  else if (a === 'new-invite') { const r = await deskNewInvite(); if (r.ok) { view.dash.code = r.code; view.dash.codeExpires = Date.now() + 7 * 86_400_000; deskRender(); } else deskToast(deskErrorText(r.kind)); }
  else if (a === 'more-weeks') { ui.weeks = DESK_WEEKS_MAX; deskRender(); }
  else if (a === 'reload') { if (deskRoute().name === 'student') deskOpenStudent(deskRoute().id, { force: true }); else deskRefresh({ force: true }); }
  else if (a === 'signout') deskEndSession();
  else if (a === 'idle-stay') deskActivity();
  else if (a === 'host-exit') { if (await deskLeaveAllOk()) deskHost?.exit?.(); }
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
  deskActivity();
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
// Dans le bandeau : seulement compté ; « Rester connecté » le ferme au clic (l'enlever ici perdrait le clic et le focus)
document.addEventListener('pointerdown', e => { if (e.target.closest?.('#idle')) deskTouch(); else deskActivity(); }, { passive: true });
// Lire en faisant défiler compte aussi comme activité (molette, doigt), une fois toutes les 5 s au plus. L'événement
// « scroll » n'est pas écouté : les rendus et le fil des messages défilent seuls et garderaient la session ouverte.
let deskScrollAt = 0;
const deskOnScroll = () => { const n = Date.now(); if (n - deskScrollAt < 5000) return; deskScrollAt = n; deskActivity(); };
window.addEventListener('wheel', deskOnScroll, { passive: true });
window.addEventListener('touchmove', deskOnScroll, { passive: true });
// Changement d'écran : avec des changements pas enregistrés, le lien revient en arrière et le coach confirme
let deskHash = location.hash || '#/', deskHashBack = false;
window.addEventListener('hashchange', async () => {
  if (deskHashBack) { deskHashBack = false; return; }
  const from = deskHash, to = location.hash || '#/';
  const leavingEditor = from === '#/bilans' && to !== '#/bilans' && deskCkDirty();
  const sameStudent = (h) => (/^#\/eleve\/([0-9a-f-]+)/i.exec(h) || [])[1];
  const leavingReply = sameStudent(from) && sameStudent(from) !== sameStudent(to) && deskRvDirty();
  const progOf = h => (/^#\/eleve\/([0-9a-f-]+)\/programme/i.exec(h) || [])[1];
  const leavingProg = progOf(from) && progOf(from) !== progOf(to) && deskPgDirty();
  const leavingDiet = deskDtRouteKey(from) && deskDtRouteKey(from) !== deskDtRouteKey(to) && deskDtDirty();
  if (desk.user && (leavingEditor || leavingReply || leavingProg || leavingDiet)) {
    deskHashBack = true;
    history.replaceState(null, '', from);
    deskHashBack = false;
    // Plusieurs changements en cours (réponse ET programme) : chacun demandé, aucun perdu sans le dire
    const ok = (!leavingEditor || await deskCkLeaveOk()) && (!leavingReply || await deskRvLeaveOk()) && (!leavingProg || await deskPgLeaveOk()) && (!leavingDiet || await deskDtLeaveOk());
    if (!ok) return;
    if (leavingEditor) deskCkSelect(bl.draft?.id || bl.sel);
    if (leavingReply) rv.drafts = {};
    if (leavingProg) deskPgReset();

    history.replaceState(null, '', to);
  }
  // Sortie de l'éditeur des plans diète (changements confirmés ou aucun) : brouillon oublié, raccourcis coupés
  if (deskDtRouteKey(from) && deskDtRouteKey(from) !== deskDtRouteKey(to)) deskDtReset();
  deskHash = location.hash || '#/';
  ui.weeks = DESK_WEEKS_SHOWN;
  const route = deskRoute();
  if (route.name === 'student' && route.request) rv.sel = route.request;
  deskRender({ focusMain: true });
  window.scrollTo(0, 0);
  if (route.name === 'student' && desk.user) deskOpenStudent(route.id);
  if (route.name === 'bilans' && desk.user) deskOpenBilans({ keep: true });
  if (desk.user) deskOpenTab(route);
});
// Rendre la main à l'app hôte : chaque changement pas enregistré est confirmé d'abord
async function deskLeaveAllOk() {
  return (!deskCkDirty() || await deskCkLeaveOk()) && (!deskRvDirty() || await deskRvLeaveOk()) && (!deskPgDirty() || await deskPgLeaveOk()) && (!deskDtDirty() || await deskDtLeaveOk());
}
// Onglets de la vague 4 : Messages (relecture régulière), Programme et Nutrition (lectures propres)
function deskOpenTab(route) {
  if (!view.dash) return;
  const chatId = deskChatKey(route);
  if (route.name === 'messages' || chatId) { deskChatStart(); if (chatId) deskChatOpen(chatId); else deskChatTick({ now: true }); }
  else deskChatStop();
  if (route.name === 'student' && route.tab === 'programme') deskPgOpen(route.id);
  if (route.name === 'student' && route.tab === 'nutrition') { if (route.part) deskDtOpenStudent(route.id, route.part); else deskNtOpen(route.id); }
  if (route.name === 'diets') deskDtOpenLib(route);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !desk.user || deskIdleEnding) return;
  if (deskIdleFor() > DESK_IDLE_MS) deskIdleEnd(); else { deskIdleTick(); deskRefresh(); }
});
setInterval(deskIdleTick, 15_000);
// Tableau de bord et Bilans reçus relus régulièrement, onglet visible seulement
setInterval(() => {
  if (!desk.user || deskIdleEnding || document.visibilityState !== 'visible') return;
  const n = deskRoute().name;
  if (n === 'dash' || n === 'received') deskRefresh({ quiet: true });
}, DESK_POLL_MS);

// ── Démarrage ───────────────────────────────────────────────

// Point d'entrée unique du démarrage (le site, ou l'app iPhone qui embarque la page : window.MDLF_COACH_HOST)
async function deskStart() {
  const r = await deskResume();
  // Embarquée : session de l'hôte refusée (expirée, autre compte) → l'hôte reprend la main
  if (!r.ok && deskHosted()) { deskHost.exit?.(); return; }
  if (!r.ok) { ui.login.error = deskAuthText(r.kind); }
  else if (r.expired || deskTakeExpired()) ui.login.error = 'Session fermée après 30 minutes sans activité : reconnecte-toi.';
  deskRender();
  if (desk.user) deskRefresh({ force: true });
  else deskAppleLoad();
}
deskApple.onChange = () => { if (!desk.user) deskRender(); };
deskStart();
