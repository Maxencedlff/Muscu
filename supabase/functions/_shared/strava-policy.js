// Règles de Strava côté serveur (logique pure, sans réseau), appliquées par les fonctions Edge
// strava-connect, strava-export et strava-disconnect (Deno) et testées par tests/unit/strava-server.mjs
// (Node). Contrat : docs/STRAVA.md. Documentation Strava lue le 31/10/2026 :
// https://developers.strava.com/docs/authentication/ et https://developers.strava.com/docs/reference/
//
// 1. Autorisation : page web https://www.strava.com/oauth/authorize (ouverte dans Safari par l'app),
//    response_type=code, approval_prompt=auto, scope=activity:write (seul droit demandé : créer des
//    activités ; rien n'est lu chez Strava), state = 32 octets aléatoires à usage unique. Retour sur la
//    fonction strava-connect elle-même (redirect_uri dans le domaine de rappel déclaré chez Strava).
// 2. La personne peut décocher le droit demandé : le droit accordé est relu (hasWriteScope) avant de
//    garder la liaison.
// 3. Envoi : POST /api/v3/activities (activité manuelle) : name, sport_type, start_date_local (heure
//    locale ISO 8601 sans fuseau), elapsed_time (secondes), description, distance (mètres), trainer.
//    validateExport borne tout ce que l'app envoie : la base n'écrit que l'identifiant de séance.
// 4. Jeton d'accès valable environ 6 h : renouvelé quand il lui reste moins de 5 minutes
//    (needsRefresh). Le jeton de renouvellement change à chaque réponse : le dernier reçu fait foi.

export const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
export const SCOPE = 'activity:write';
export const REFRESH_MARGIN_S = 300;

// Types d'activité que l'app peut envoyer (sous-ensemble de SportType de Strava, mêmes noms exacts)
export const SPORT_TYPES = Object.freeze(['WeightTraining', 'Workout', 'Run', 'TrailRun', 'Walk', 'Ride',
  'Rowing', 'Elliptical', 'StairStepper']);
export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 2000;
export const ELAPSED_MIN_S = 60;
export const ELAPSED_MAX_S = 24 * 3600;
export const DISTANCE_MAX_M = 1_000_000;
export const PAST_MAX_DAYS = 400;

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
const length = (s) => [...s].length;
const cut = (s, max) => [...s].slice(0, max).join('');
// eslint-disable-next-line no-control-regex -- les caractères de contrôle sont justement ceux à retirer
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g;

// URL de la page d'autorisation de Strava
export function authorizeUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({ client_id: String(clientId), redirect_uri: redirectUri, response_type: 'code',
    approval_prompt: 'auto', scope: SCOPE, state });
  return `${AUTHORIZE_URL}?${q}`;
}

// Droits accordés (« read,activity:write » dans le retour, séparés par des espaces dans la réponse
// des jetons) : activity:write exactement, jamais un nom voisin
export function hasWriteScope(scope) {
  return String(scope || '').split(/[\s,]+/).includes(SCOPE);
}

// Prénom affiché dans Réglages › Strava (« Connecté : Léa ») : prénom seul, une ligne, 40 caractères
export function athleteName(athlete) {
  const f = typeof athlete?.firstname === 'string' ? athlete.firstname.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim() : '';
  return f ? cut(f, 40) : null;
}

// Réponse de /oauth/token (échange du code ou renouvellement) : jetons et expiration, null si incomplète
export function parseTokens(body) {
  const b = body && typeof body === 'object' ? body : {};
  const access = typeof b.access_token === 'string' ? b.access_token : '';
  const refresh = typeof b.refresh_token === 'string' ? b.refresh_token : '';
  const exp = Number(b.expires_at);
  if (!access || !refresh || !Number.isFinite(exp) || exp <= 0) return null;
  const athleteId = Number(b.athlete?.id);
  return { access, refresh, expiresAt: exp, scope: typeof b.scope === 'string' ? b.scope : null,
    athleteId: Number.isSafeInteger(athleteId) && athleteId > 0 ? athleteId : null, athleteName: athleteName(b.athlete) };
}

export function needsRefresh(expiresAtIso, nowMs = Date.now()) {
  const t = Date.parse(expiresAtIso);
  return !Number.isFinite(t) || t - nowMs < REFRESH_MARGIN_S * 1000;
}

// Identifiant de l'activité créée, en texte, null si absent. Lu directement dans le texte JSON, à la
// profondeur de l'objet racine : JSON.parse arrondirait un entier au-delà de 2^53, et athlete.id (même
// nom de clé, plus profond) n'est pas l'activité.
export function activityIdFrom(text) {
  const t = String(text ?? '');
  try { const root = JSON.parse(t); if (!root || typeof root !== 'object' || Array.isArray(root)) return null; } catch { return null; }
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"') {
      let j = i + 1;
      while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1;
      const key = t.slice(i + 1, j);
      i = j;
      if (depth === 1 && key === 'id') {
        const m = /^\s*:\s*(-?\d+)(?=\s*[,}])/.exec(t.slice(j + 1, j + 40));
        if (m) return /^[1-9]\d{0,18}$/.test(m[1]) ? m[1] : null;
      }
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return null;
}

// Heure locale « 2026-10-31T18:05:00 » plausible : date réelle, pas plus de 400 jours dans le passé,
// pas plus de 14 h dans le futur (fuseau le plus en avance sur l'heure UTC du serveur)
function plausibleLocalDate(s, nowMs) {
  const m = LOCAL_DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi, se);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59 || se > 59) return false;
  return t >= nowMs - PAST_MAX_DAYS * 86400_000 && t <= nowMs + 14 * 3600_000;
}

// Corps envoyé par l'app à strava-export → { ok: true, sessionId, fields } (champs du formulaire de
// Strava) ou { ok: false, error: 'invalid', field }. Clés inconnues ignorées (jamais recopiées).
export function validateExport(body, nowMs = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid', field: 'body' };
  const bad = (field) => ({ ok: false, error: 'invalid', field });
  if (typeof body.session_id !== 'string' || !SESSION_ID_RE.test(body.session_id)) return bad('session_id');
  const name = typeof body.name === 'string' ? body.name.replace(CONTROL_RE, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!name || length(name) > NAME_MAX) return bad('name');
  if (typeof body.sport_type !== 'string' || !SPORT_TYPES.includes(body.sport_type)) return bad('sport_type');
  if (typeof body.start_date_local !== 'string' || !plausibleLocalDate(body.start_date_local, nowMs)) return bad('start_date_local');
  const elapsed = body.elapsed_time;
  if (!Number.isInteger(elapsed) || elapsed < ELAPSED_MIN_S || elapsed > ELAPSED_MAX_S) return bad('elapsed_time');
  let description = null;
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') return bad('description');
    description = body.description.replace(CONTROL_RE, ' ').replace(/[ \t]+\n/g, '\n').trim();
    if (length(description) > DESCRIPTION_MAX) return bad('description');
  }
  let distance = null;
  if (body.distance !== undefined && body.distance !== null) {
    if (typeof body.distance !== 'number' || !Number.isFinite(body.distance) || body.distance <= 0 || body.distance > DISTANCE_MAX_M) return bad('distance');
    distance = Math.round(body.distance * 10) / 10;
  }
  if (body.trainer !== undefined && typeof body.trainer !== 'boolean') return bad('trainer');
  const fields = { name, sport_type: body.sport_type, start_date_local: body.start_date_local, elapsed_time: String(elapsed) };
  if (description) fields.description = description;
  if (distance) fields.distance = String(distance);
  if (body.trainer === true) fields.trainer = '1';
  return { ok: true, sessionId: body.session_id, fields };
}

// Retour dans Safari après Strava : page publique de l'app (la passerelle des fonctions Supabase ne
// sert pas de HTML), le résultat en ancre (#ok, #refuse, #droits, #expire, #erreur) pour qu'aucun
// code ni état ne reste dans l'adresse
export const RETURN_RESULTS = Object.freeze(['ok', 'refuse', 'droits', 'expire', 'erreur']);
export function returnUrl(base, result) {
  return `${base}#${RETURN_RESULTS.includes(result) ? result : 'erreur'}`;
}
