// ═══════════════════════════════════════════════════════════
//  Strava : export des séances terminées (contrat : docs/STRAVA.md), appels et logique pure, sans affichage
//
//  - L'app ne voit jamais un jeton Strava : ils restent chiffrés sur le serveur. Elle lit son état par la
//    RPC strava_status (relié ou non, prénom, séances déjà envoyées) et passe par trois fonctions Edge :
//    strava-connect (adresse de la page d'autorisation, ouverte dans Safari), strava-export (une séance),
//    strava-disconnect (couper l'accès chez Strava et tout effacer).
//  - Ce qui part vers Strava (stravaActivity) : nom de la séance, heure de début, durée, type d'activité,
//    distance d'une séance de cardio, et une description tirée des exercices et des séries. Jamais les
//    notes, le poids du corps, le RIR, ni Santé.
//  - Séance envoyable (stravaExportable) : terminée dans l'app (durée mesurée d'au moins une minute), au
//    moins une série faite, de moins de 400 jours ; jamais une sortie lue dans Santé, jamais une séance
//    importée de Hevy ou Strong (isImportedEntry : heure de début et non de fin, souvent déjà sur Strava).
//  - Retour de Safari : l'état est relu au retour au premier plan (pas de schéma d'URL natif : aucune
//    build nécessaire).
//  - Résultats : { ok: true, … } ou { ok: false, kind } ; textes dans STRAVA_ERROR_TEXT. L'écran
//    (js/features/strava-ui.js) s'abonne par onStravaChange.
// ═══════════════════════════════════════════════════════════
'use strict';

const STRAVA_CACHE_KEY   = 'mdlf_strava';   // { userId, connected, name, canWrite, exports } du dernier état lu
const STRAVA_REFRESH_MS  = 30_000;
const STRAVA_ACTIVITY_URL = 'https://www.strava.com/activities/';
const STRAVA_APPS_URL    = 'https://www.strava.com/settings/apps';
const STRAVA_ID_RE       = /^[A-Za-z0-9_-]{1,64}$/;   // identifiant de séance accepté par le serveur
const STRAVA_DESC_MAX    = 1900;                       // le serveur accepte 2000 caractères
const STRAVA_PAST_DAYS   = 400;                        // comme le serveur (validateExport)

// Cardio : nom de la bibliothèque → type d'activité de Strava (SportType) ; trainer : en salle, sur machine
const STRAVA_CARDIO = {
  'Course à pied':       { sport: 'Run' },
  'Fractionné (course)': { sport: 'Run' },
  'Trail':               { sport: 'TrailRun' },
  'Tapis de course':     { sport: 'Run', trainer: true },
  'Marche rapide':       { sport: 'Walk' },
  'Vélo':                { sport: 'Ride' },
  'Vélo d\'appartement': { sport: 'Ride', trainer: true },
  'Rameur':              { sport: 'Rowing', trainer: true },
  'Vélo elliptique':     { sport: 'Elliptical', trainer: true },
  'Escaliers':           { sport: 'StairStepper', trainer: true },
};
// Types où une distance a un sens chez Strava (allure, vitesse, temps aux 500 m)
const STRAVA_DISTANCE_SPORTS = new Set(['Run', 'TrailRun', 'Walk', 'Ride', 'Rowing']);

const strava = { userId: null, state: null, loading: false, error: null, loadedAt: 0, sending: new Set(), connecting: false };
const stravaListeners = [];
let stravaSeq = 0;   // +1 à chaque changement de compte : une réponse arrivée après n'écrit plus rien

function onStravaChange(fn) { stravaListeners.push(fn); }
function notifyStrava() { for (const fn of stravaListeners) { try { fn(); } catch { /* écran absent */ } } }

// ── Logique pure ────────────────────────────────────────────

// Séries faites d'un exercice (échauffements exclus, case remplie)
function stravaDoneSets(ex) { return workSets(ex?.sets).filter(s => (parseFloat(s.reps) || 0) > 0); }

// Type d'activité d'un exercice de cardio : bibliothèque, sinon famille de l'allure ; Workout sinon
function stravaCardioSport(ex) {
  const known = STRAVA_CARDIO[catalogueEntry(ex?.name || '')?.name];
  if (known) return { sport: known.sport, trainer: known.trainer === true };
  const kind = paceKind(ex);
  return { sport: kind === 'pace' ? 'Run' : kind === 'speed' ? 'Ride' : kind === 'split' ? 'Rowing' : 'Workout', trainer: false };
}

// Type d'activité de la séance : que du cardio d'un seul type → ce type (distance en mètres, sur machine
// si tous les exercices le sont) ; que du cardio de plusieurs types → Workout ; au moins un exercice de
// musculation → WeightTraining
function stravaSport(h) {
  const done = (h?.exercises || []).filter(e => stravaDoneSets(e).length);
  if (!done.length || done.some(e => measureOf(e) !== 'cardio')) return { sport_type: 'WeightTraining' };
  const kinds = done.map(stravaCardioSport);
  const sport = kinds[0].sport;
  if (kinds.some(k => k.sport !== sport)) return { sport_type: 'Workout' };
  const km = done.reduce((a, e) => a + stravaDoneSets(e).reduce((b, s) => b + (parseFloat(s.dist) || 0), 0), 0);
  const out = { sport_type: sport };
  if (STRAVA_DISTANCE_SPORTS.has(sport) && km > 0 && km <= 1000) out.distance = Math.round(km * 1000);
  if (kinds.every(k => k.trainer)) out.trainer = true;
  return out;
}

// Heure locale sans fuseau, comme l'attend Strava (start_date_local) : « 2026-10-31T18:05:00 »
function stravaLocalDate(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Description de l'activité : chiffres de la séance, puis une ligne par exercice fait, dans l'unité de la
// personne. Jamais les notes (souvent personnelles), ni le poids du corps, ni le RIR
function stravaDescription(h) {
  const done = (h.exercises || []).filter(e => stravaDoneSets(e).length);
  const nSets = done.reduce((a, e) => a + stravaDoneSets(e).length, 0);
  const vol = sessionVolume(done, null);
  const head = [fmtDuration(h.duration), plural(nSets, 'série', 'séries'), vol > 0 ? fmtVolume(vol) : '']
    .filter(Boolean).join(' · ').replace(/ /g, ' ');
  const lines = [head, ''];
  for (const e of done) {
    const line = `${String(e.name).replace(/\s+/g, ' ').trim()} : ${setsText(stravaDoneSets(e), measureOf(e), setKind(e))}`.replace(/ /g, ' ');
    if ([...lines.join('\n'), ...line].length > STRAVA_DESC_MAX - 40) { lines.push('…'); break; }
    lines.push(line);
  }
  lines.push('', 'Enregistré avec MDLF Training');
  return lines.join('\n');
}

// Séance qu'on peut envoyer : voir l'en-tête
function stravaExportable(h, nowMs = Date.now()) {
  if (!h || typeof h !== 'object' || isHealthEntry(h) || isImportedEntry(h) || !STRAVA_ID_RE.test(String(h.id || ''))) return false;
  if (!(h.duration >= 60_000) || !Number.isFinite(h.date)) return false;
  const start = h.date - h.duration;
  if (start < nowMs - STRAVA_PAST_DAYS * 86400_000 || start > nowMs + 3600_000) return false;
  return (h.exercises || []).some(e => stravaDoneSets(e).length > 0);
}

// Corps envoyé à strava-export, null si la séance n'est pas envoyable
function stravaActivity(h, nowMs = Date.now()) {
  if (!stravaExportable(h, nowMs)) return null;
  const name = String(rawLabel(h.category, entryProg(h)) || 'Séance').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Séance';
  return {
    session_id: h.id, name, ...stravaSport(h),
    start_date_local: stravaLocalDate(h.date - h.duration),
    elapsed_time: Math.min(86400, Math.round(h.duration / 1000)),
    description: stravaDescription(h),
  };
}

// strava_status nettoyé : { connected, name, canWrite, exports: { [sessionId]: activityId } }
function cleanStravaStatus(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const exports = {};
  for (const e of Array.isArray(r.exports) ? r.exports.slice(0, 1000) : []) {
    if (e && typeof e.session_id === 'string' && STRAVA_ID_RE.test(e.session_id) && /^[1-9]\d{0,18}$/.test(String(e.activity_id))) {
      exports[e.session_id] = String(e.activity_id);
    }
  }
  const connected = r.connected === true;
  const name = connected && typeof r.athlete_name === 'string' && r.athlete_name.trim() ? r.athlete_name.trim().slice(0, 40) : null;
  return { connected, name, canWrite: connected && r.can_write === true, exports: connected ? exports : {} };
}

function stravaActivityUrl(activityId) { return /^[1-9]\d{0,18}$/.test(String(activityId)) ? STRAVA_ACTIVITY_URL + activityId : null; }

// Erreur d'un appel → clé de STRAVA_ERROR_TEXT
function stravaErrorKind(error, status, body) {
  if (isNetworkError(error) && !status) return 'offline';
  const code = String(body?.error || '');
  if (['not_connected', 'busy', 'rate_limited', 'scope', 'strava_busy', 'strava_down', 'not_configured', 'invalid', 'auth'].includes(code)) return code;
  if (status === 401) return 'auth';
  if (status === 429) return 'rate_limited';
  return 'server';
}
const STRAVA_ERROR_TEXT = {
  offline: 'Pas d\'Internet : réessaie avec du réseau.',
  signed_out: 'Connecte-toi d\'abord à ton compte.',
  auth: 'Ta connexion a expiré. Reconnecte-toi, puis réessaie.',
  not_connected: 'Strava n\'est plus relié. Relie-le dans Réglages › Strava.',
  scope: 'Strava ne nous permet pas de créer d\'activité. Relie-le à nouveau en laissant la case cochée.',
  busy: 'Envoi déjà en cours.',
  rate_limited: 'Beaucoup d\'envois aujourd\'hui. Réessaie demain.',
  strava_busy: 'Strava est très demandé en ce moment. Réessaie dans un quart d\'heure.',
  strava_down: 'Strava ne répond pas. Réessaie dans un moment.',
  not_configured: 'Strava n\'est pas encore disponible.',
  invalid: 'Cette séance ne peut pas être envoyée.',
  server: 'Action impossible pour l\'instant, réessaie dans un moment.',
};
function stravaErrorText(kind) { return STRAVA_ERROR_TEXT[kind] || STRAVA_ERROR_TEXT.server; }

// ── État lu et caché ────────────────────────────────────────

function stravaCacheRead(userId) {
  try {
    const c = JSON.parse(localStorage.getItem(STRAVA_CACHE_KEY) || 'null');
    return c && c.userId === userId ? cleanStravaStatus({ connected: c.connected, athlete_name: c.name, can_write: c.canWrite,
      exports: Object.entries(c.exports || {}).map(([session_id, activity_id]) => ({ session_id, activity_id })) }) : null;
  } catch { return null; }
}
function stravaCacheWrite() {
  try {
    if (!strava.userId || !strava.state) localStorage.removeItem(STRAVA_CACHE_KEY);
    else localStorage.setItem(STRAVA_CACHE_KEY, JSON.stringify({ userId: strava.userId, ...strava.state }));
  } catch { /* stockage plein : le cache n'est qu'un confort */ }
}
function stravaReset(userId) {
  stravaSeq++;
  Object.assign(strava, { userId, state: userId ? stravaCacheRead(userId) : null, loading: false, error: null, loadedAt: 0, connecting: false });
  strava.sending.clear();
  if (!userId) stravaCacheWrite();
}

function stravaConnected() { return !!(account.user && strava.state?.connected); }
function stravaActivityOf(sessionId) { return strava.state?.exports?.[sessionId] || null; }

// ── Appels au serveur ───────────────────────────────────────

async function stravaInvoke(fn, body = {}) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  const seq = stravaSeq;
  try {
    const { data: res, error } = await sb.functions.invoke(fn, { body });
    if (seq !== stravaSeq) return { ok: false, kind: 'signed_out' };
    if (error) {
      // Réponse d'erreur de la fonction : error.context est la réponse HTTP (FunctionsHttpError)
      let info = {};
      try { info = await error.context.json(); } catch { /* corps illisible */ }
      return { ok: false, kind: stravaErrorKind(error, error.context?.status, info) };
    }
    return { ok: true, data: res || {} };
  } catch (e) {
    return { ok: false, kind: stravaErrorKind(e, 0, null) };
  }
}

// Relit strava_status. minAge : pas de relecture si le dernier état a moins de minAge ms. true si lu.
async function stravaRefresh({ minAge = 0 } = {}) {
  if (!sb || !account.user || strava.loading) return false;
  if (minAge && strava.state && Date.now() - strava.loadedAt < minAge) return true;
  strava.loading = true;
  const seq = stravaSeq;
  let r;
  try { const { data: res, error } = await sb.rpc('strava_status'); r = error ? { ok: false, error } : { ok: true, res }; }
  catch (e) { r = { ok: false, error: e }; }
  if (seq !== stravaSeq) return false;
  strava.loading = false;
  if (!r.ok) {
    strava.error = isNetworkError(r.error) || /fetch|network|load failed/i.test(String(r.error?.message || '')) ? 'offline' : 'server';
    notifyStrava();
    return false;
  }
  strava.state = cleanStravaStatus(r.res);
  strava.error = null;
  strava.loadedAt = Date.now();
  if (strava.state.connected) strava.connecting = false;
  stravaCacheWrite();
  notifyStrava();
  return true;
}

// Début de liaison : adresse de la page d'autorisation de Strava ({ ok, url }), ouverte par l'écran dans
// Safari. Le retour dans l'app relit l'état (premier plan).
async function stravaConnectUrl() {
  const r = await stravaInvoke('strava-connect');
  if (!r.ok) return r;
  const url = String(r.data.url || '');
  if (!url.startsWith('https://www.strava.com/oauth/authorize?')) return { ok: false, kind: 'server' };
  strava.connecting = true;
  return { ok: true, url };
}

// Envoie une séance de l'historique : { ok, activityId, already } ; l'état est mis à jour tout de suite
async function stravaExport(h) {
  const body = stravaActivity(h);
  if (!body) return { ok: false, kind: 'invalid' };
  if (strava.sending.has(h.id)) return { ok: false, kind: 'busy' };
  strava.sending.add(h.id);
  notifyStrava();
  const seq = stravaSeq;
  const r = await stravaInvoke('strava-export', body);
  if (seq !== stravaSeq) return { ok: false, kind: 'signed_out' };
  strava.sending.delete(h.id);
  const id = r.ok ? String(r.data.activity_id || '') : '';
  if (r.ok && /^[1-9]\d{0,18}$/.test(id)) {
    if (strava.state) strava.state.exports[h.id] = id;
    stravaCacheWrite();
    notifyStrava();
    return { ok: true, activityId: id, already: r.data.already === true };
  }
  if (!r.ok && r.kind === 'not_connected' && strava.state) { strava.state = cleanStravaStatus(null); stravaCacheWrite(); }
  notifyStrava();
  return r.ok ? { ok: false, kind: 'server' } : r;
}

// Déconnexion : { ok, revoked } ; l'état local est vidé dès que le serveur a effacé la liaison
async function stravaDisconnect() {
  const r = await stravaInvoke('strava-disconnect');
  if (!r.ok) return r;
  strava.state = cleanStravaStatus(null);
  strava.connecting = false;
  stravaCacheWrite();
  notifyStrava();
  return { ok: true, revoked: r.data.revoked === true };
}

// ── Déclencheurs : connexion, premier plan (retour de Safari), réseau revenu ───

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id === strava.userId) return;
  stravaReset(id);
  notifyStrava();
  if (id) stravaRefresh();
});
document.addEventListener?.('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !account.user) return;
  // Retour de la page d'autorisation : relecture immédiate ; sinon une fois toutes les 30 s au plus
  stravaRefresh({ minAge: strava.connecting ? 0 : STRAVA_REFRESH_MS });
});
window.addEventListener?.('online', () => { if (account.user && strava.error === 'offline') stravaRefresh(); });
