// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : connexion et appels au serveur (docs/COACH_WEB.md)
//
//  - Même projet Supabase et même compte que l'app iPhone (clé publique « publishable » : la sécurité vient des RPC
//    security definer et de la RLS, chacune vérifie auth.uid() et le lien coach ↔ élève). Adresse et clé identiques à
//    ACCOUNT_CONFIG de js/data/account.js (vérifié par tests/unit/coach-web.mjs).
//  - Connexion par code à 6 chiffres reçu par e-mail (signInWithOtp sans création de compte, puis verifyOtp).
//  - Ordinateur parfois partagé : session fermée après 30 min sans geste (aussi au rechargement), « Se déconnecter de
//    cet ordinateur ». Seuls la session de Supabase et l'heure du dernier geste sont gardées dans le navigateur ;
//    les données des élèves restent en mémoire, jamais dans localStorage ni IndexedDB.
//  - Chaque appel rend { ok: true, data } ou { ok: false, kind } (kinds de coachErrorKind ; 'missing' : fonction
//    absente du serveur, migration pas encore appliquée).
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_CONFIG = Object.freeze({
  url: 'https://yopptmdjtnezmccdvaxf.supabase.co',
  publishableKey: 'sb_publishable_9L0-y5dhw7V8LVm5PuxG5g_Hd7ExHkS',   // clé publique (rien de secret) gitleaks:allow
});
const DESK_AUTH_KEY = 'mdlf-coach-web-auth';     // session de supabase-js
const DESK_ACTIVE_KEY = 'mdlf_coach_web_active'; // heure du dernier geste (ms), rien d'autre
const DESK_IDLE_MS = 30 * 60_000;
const DESK_SESSIONS_PAGES = 6;                   // repli sans coach_student_weeks : 6 pages de 30 séances au plus

const desk = { user: null, email: null, sentAt: 0 };

function deskStore() { try { return window.localStorage; } catch { return null; } }
function deskTouch(now = Date.now()) { try { deskStore()?.setItem(DESK_ACTIVE_KEY, String(now)); } catch { /* stockage bloqué */ } }
function deskIdleFor(now = Date.now()) {
  let t = NaN;
  try { t = Number(deskStore()?.getItem(DESK_ACTIVE_KEY)); } catch { /* stockage bloqué */ }
  return Number.isFinite(t) && t > 0 ? now - t : Infinity;
}

function deskClient() {
  if (sb) return sb;
  if (typeof supabase === 'undefined') return null;
  sb = supabase.createClient(DESK_CONFIG.url, DESK_CONFIG.publishableKey, {
    auth: { storage: deskStore() || undefined, storageKey: DESK_AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return sb;
}

// Session reprise au chargement, sauf après 30 min sans geste (fermée ici, sur le serveur aussi)
async function deskResume(now = Date.now()) {
  const c = deskClient();
  if (!c) return { ok: false, kind: 'server' };
  try {
    const { data } = await c.auth.getSession();
    const user = data?.session?.user || null;
    if (!user) return { ok: true, user: null };
    if (deskIdleFor(now) > DESK_IDLE_MS) { await deskSignOut(); return { ok: true, user: null, expired: true }; }
    desk.user = user;
    deskTouch(now);
    return { ok: true, user };
  } catch (e) { return { ok: false, kind: authErrorKind(e) || 'server' }; }
}

// Code par e-mail : seulement pour un compte qui existe déjà (shouldCreateUser: false)
async function deskSendCode(email) {
  const c = deskClient();
  if (!c) return { ok: false, kind: 'server' };
  try {
    const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) return { ok: false, kind: authErrorKind(error) || 'server' };
    desk.email = email; desk.sentAt = Date.now();
    return { ok: true };
  } catch (e) { return { ok: false, kind: authErrorKind(e) || 'server' }; }
}
async function deskVerifyCode(code) {
  const c = deskClient();
  if (!c || !desk.email) return { ok: false, kind: 'server' };
  try {
    const { data, error } = await c.auth.verifyOtp({ email: desk.email, token: code, type: 'email' });
    if (error) return { ok: false, kind: otpErrorKind(error, desk.sentAt) || 'server' };
    desk.user = data?.user || data?.session?.user || null;
    deskTouch();
    return desk.user ? { ok: true, user: desk.user } : { ok: false, kind: 'server' };
  } catch (e) { return { ok: false, kind: authErrorKind(e) || 'server' }; }
}
// Déconnexion de cet ordinateur : session effacée ici (scope local : l'iPhone reste connecté)
async function deskSignOut() {
  try { await deskClient()?.auth.signOut({ scope: 'local' }); } catch { /* hors ligne : la session locale part quand même */ }
  try { deskStore()?.removeItem(DESK_AUTH_KEY); deskStore()?.removeItem(DESK_ACTIVE_KEY); } catch { /* rien */ }
  desk.user = null;
}

async function deskRpc(fn, args) {
  const c = deskClient();
  if (!c || !desk.user) return { ok: false, kind: 'signed_out' };
  try {
    const { data, error } = await c.rpc(fn, args);
    if (!error) return { ok: true, data };
    if (error.code === 'PGRST301' || /jwt/i.test(String(error.message || ''))) return { ok: false, kind: 'signed_out' };
    return { ok: false, kind: coachErrorKind(error) };
  } catch (e) { return { ok: false, kind: coachErrorKind(e) || 'server' }; }
}
const deskOpt = r => (r.ok ? r.data : null);   // donnée facultative : absente (serveur d'avant, erreur) = null

// Tableau de bord en un passage (8 lectures en parallèle) ; seul coach_state est obligatoire
async function deskLoadDashboard(now = Date.now()) {
  const me = desk.user?.id;
  const [state, progress, threads, plans, diet, code, tier, form] = await Promise.all([
    deskRpc('coach_state'), deskRpc('coach_progress'), deskRpc('chat_threads'), deskRpc('coach_plans'), deskRpc('coach_diet_overview'),
    deskRpc('coach_my_code'), deskRpc('coach_tier_state'), deskRpc('coach_form', { coach: me })]);
  if (!state.ok) return state;
  const st = cleanCoachState(state.data);
  const permanent = deskOpt(code);
  const invites = st.invites.filter(i => Number.isFinite(i.expires_at) && i.expires_at - now < 400 * 86_400_000);
  return { ok: true, data: {
    state: st, now,
    facts: progress.ok ? cleanCoachProgress(progress.data, now) : null,
    threads: threads.ok ? cleanChatThreads(threads.data) : null,
    plans: plans.ok ? cleanCoachPlans(plans.data) : null,
    dietOv: diet.ok ? cleanDietOverview(diet.data) : null,
    code: typeof permanent?.code === 'string' && COACH_CODE_RE.test(permanent.code) ? permanent.code : invites[0]?.code || null,
    codeExpires: typeof permanent?.code === 'string' ? null : invites[0]?.expires_at || null,
    tier: deskTier(deskOpt(tier)),
    form: cleanCoachForm(deskOpt(form)?.form),
  } };
}
// coach_tier_state() : { limit (null = illimité), students } ; null si illisible
function deskTier(raw) {
  // Verrou de l'abonnement éteint : pas d'« élèves offerts » à annoncer (la limite n'est qu'un plafond technique)
  if (!raw || raw.is_coach !== true || raw.paywall_on !== true) return null;
  const limit = Number.isInteger(raw.limit) && raw.limit >= 0 ? raw.limit : null;
  const students = Number.isInteger(raw.students) && raw.students >= 0 ? raw.students : 0;
  return { limit, students, free: limit === null ? null : Math.max(0, limit - students) };
}
async function deskNewInvite() {
  const r = await deskRpc('coach_create_invite');
  return r.ok && typeof r.data === 'string' && COACH_CODE_RE.test(r.data) ? { ok: true, code: r.data } : r.ok ? { ok: false, kind: 'server' } : r;
}

// Fiche « Semaines » d'un élève : un appel (coach_student_weeks, migration 20261124010000_semaines_coach.sql) ;
// serveur d'avant : les lectures existantes en parallèle, séances page par page jusqu'au début de la fenêtre
async function deskLoadWeeks(student, weeks = DESK_WEEKS_MAX, now = Date.now()) {
  const from = deskDayStart(deskWeekStart(now), -7 * (weeks - 1));
  const one = await deskRpc('coach_student_weeks', { student, weeks });
  if (one.ok && one.data && typeof one.data === 'object' && Array.isArray(one.data.sessions)) {
    const d = one.data;
    return { ok: true, data: { via: 'weeks', from,
      sessions: d.sessions.map(cleanCoachSessionRow).filter(Boolean).filter(r => r.doneAt >= from),
      weights: cleanCoachWeights(d.weights), measures: cleanCoachMeasures(d.measures),
      diet: d.diet && typeof d.diet === 'object' ? cleanCoachDiet(d.diet) : null } };
  }
  if (!one.ok && one.kind !== 'missing') return one;
  const [w, m, dt, rows] = await Promise.all([deskRpc('coach_student_weights', { student }), deskRpc('coach_student_measures', { student }),
    deskRpc('coach_student_diet', { student }), deskLoadSessionsSince(student, from)]);
  if (!w.ok && w.kind !== 'missing') return w;
  if (!rows.ok) return rows;
  return { ok: true, data: { via: 'pages', from, sessions: rows.data,
    weights: cleanCoachWeights(deskOpt(w)), measures: cleanCoachMeasures(deskOpt(m)), diet: dt.ok ? cleanCoachDiet(dt.data) : null } };
}
async function deskLoadSessionsSince(student, from) {
  const out = [];
  let cursor = {};
  for (let page = 0; page < DESK_SESSIONS_PAGES; page++) {
    const r = await deskRpc('coach_student_sessions', { student, ...cursor });
    if (!r.ok) return r;
    const list = (Array.isArray(r.data) ? r.data : []).map(cleanCoachSessionRow).filter(Boolean);
    out.push(...list.filter(x => x.doneAt >= from));
    const last = list[list.length - 1];
    if (list.length < COACH_PAGE || !last || last.doneAt < from) break;
    cursor = { before_at: last.doneAt, before_id: last.id };
  }
  return { ok: true, data: out };
}
