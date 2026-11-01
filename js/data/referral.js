// ═══════════════════════════════════════════════════════════
//  Parrainage : code d'un coach ou d'un ami saisi par l'utilisateur, appels au serveur et logique
//  pure, sans affichage (contrat : docs/PARRAINAGE.md, serveur : supabase/migrations/…_parrainage.sql)
//
//  - Un compte a au plus un parrain, fixé à la première saisie valable, dans les 30 jours qui suivent
//    la création du compte (le serveur décide : referral_state.can_enter). Rien de modifiable ensuite.
//  - L'app ne voit que le nom affiché de SON parrain, jamais la liste des codes.
//  - Lu à la demande (écran Compte, étape du code) : rien au démarrage. Le nom du parrain est gardé
//    sur l'appareil (REFERRAL_CACHE_KEY) pour l'écran Compte hors ligne.
//  - Résultats : { ok: true, data } ou { ok: false, kind }.
// ═══════════════════════════════════════════════════════════
'use strict';

const REFERRAL_CACHE_KEY = 'mdlf_referral';            // { userId, name } : parrain du compte, une fois connu
const REFERRAL_WINDOW_MS = 30 * 86400_000;             // même règle que private.referral_window() (affichage seulement)
const REFERRAL_CODE_RE   = /^[A-Z0-9]{3,20}$/;         // forme stockée côté serveur
const REFERRAL_NAME_MAX  = 40;

const referral = { userId: null, state: null, loading: null, cached: null };
let referralSeq = 0;   // +1 à chaque changement de compte : une réponse arrivée après n'écrit plus rien

// ── Logique pure ────────────────────────────────────────────

// Saisie → forme stockée (majuscules, sans espaces, tirets, points ni soulignés), ou '' si impossible
function normalizeReferralCode(c) {
  const v = String(c ?? '').normalize('NFKC').toUpperCase().replace(/[\s.\-_]/g, '');
  return REFERRAL_CODE_RE.test(v) ? v : '';
}

const cleanReferrerName = v => (typeof v === 'string' ? v.trim().slice(0, REFERRAL_NAME_MAX) : '');
function cleanReferrer(raw) {
  const name = raw && typeof raw === 'object' ? cleanReferrerName(raw.name) : '';
  if (!name) return null;
  const t = Date.parse(raw.since);
  // coach : le parrain est un coach (le serveur le dit, 20261101000000_parrainage_payant.sql). Un code de
  // coach saisi ici parraine sans faire rejoindre ce coach : l'app propose de le rejoindre aussi
  return { name, since: Number.isFinite(t) ? t : null, coach: raw.coach === true };
}
// referral_state() nettoyé : { referrer: { name, since, coach } | null, canEnter, until (ms) | null }
function cleanReferralState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const referrer = cleanReferrer(r.referrer);
  const until = Date.parse(r.until);
  return { referrer, canEnter: !referrer && r.can_enter === true, until: Number.isFinite(until) ? until : null };
}

// Délai de saisie d'après la date de création du compte (avant que le serveur ait répondu)
function referralOpenFor(user, now = Date.now()) {
  const t = Date.parse(user?.created_at);
  return Number.isFinite(t) && now < t + REFERRAL_WINDOW_MS;
}

function referralErrorKind(error) {
  if (!error) return null;
  if (isNetworkError(error) || /fetch|network|load failed/i.test(String(error.message || ''))) return 'offline';
  const msg = String(error.message || error.error || '');
  for (const k of ['already_referred', 'too_late', 'rate_limited', 'invalid_code', 'not_found']) if (msg.includes(k)) return k;
  return 'server';
}
const REFERRAL_ERROR_TEXT = {
  invalid_code: 'Code inconnu. Vérifie l\'orthographe auprès de la personne qui te l\'a donné.',
  already_referred: 'Ton compte a déjà un parrain.',
  too_late: 'Le code se saisit dans les 30 jours qui suivent la création du compte.',
  rate_limited: 'Trop d\'essais aujourd\'hui. Réessaie demain.',
  offline: 'Pas d\'Internet : réessaie avec du réseau.',
  signed_out: 'Connecte-toi d\'abord à ton compte.',
  not_found: 'Connecte-toi d\'abord à ton compte.',
  server: 'Vérification impossible pour l\'instant, réessaie dans un moment.',
};
function referralErrorText(kind) { return REFERRAL_ERROR_TEXT[kind] || REFERRAL_ERROR_TEXT.server; }

// ── État ────────────────────────────────────────────────────

function readReferralCache(userId) {
  try {
    const c = JSON.parse(localStorage.getItem(REFERRAL_CACHE_KEY));
    const name = c && c.userId === userId ? cleanReferrerName(c.name) : '';
    return name ? { name, coach: c.coach === true } : null;
  } catch { return null; }
}
function writeReferralCache() {
  try {
    const r = referral.state?.referrer;
    if (r?.name) localStorage.setItem(REFERRAL_CACHE_KEY, JSON.stringify({ userId: referral.userId, name: r.name, coach: r.coach }));
    else localStorage.removeItem(REFERRAL_CACHE_KEY);
  } catch { /* cache facultatif */ }
}

function referralSync() {
  const id = account.user?.id || null;
  if (id === referral.userId) return;
  referralSeq++;
  Object.assign(referral, { userId: id, state: null, loading: null, cached: id ? readReferralCache(id) : null });
}

// Faut-il proposer de rejoindre le parrain comme coach ? Parrain coach, et pas encore de coach
function referralSuggestJoin(v = referralView()) {
  return !!(v.referrer && v.referrerCoach && !coach.state?.coach);
}

// Ce que l'écran montre : { referrer: nom | null, referrerCoach, canEnter, until }. Sans réponse du serveur : le nom
// gardé sur l'appareil, et la saisie proposée si le compte a moins de 30 jours (le serveur tranche).
function referralView() {
  referralSync();
  if (!account.user) return { referrer: null, referrerCoach: false, canEnter: false, until: null, known: false };
  const st = referral.state;
  if (st) return { referrer: st.referrer?.name || null, referrerCoach: !!st.referrer?.coach, canEnter: st.canEnter, until: st.until, known: true };
  const c = referral.cached;
  const t = Date.parse(account.user.created_at);
  return { referrer: c?.name || null, referrerCoach: !!c?.coach, canEnter: !c && referralOpenFor(account.user),
           until: Number.isFinite(t) ? t + REFERRAL_WINDOW_MS : null, known: false };
}

async function referralRpc(fn, args) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  const seq = referralSeq;
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (seq !== referralSeq) return { ok: false, kind: 'signed_out' };
    return error ? { ok: false, kind: referralErrorKind(error) } : { ok: true, data };
  } catch (e) {
    return { ok: false, kind: referralErrorKind(e) || 'server' };
  }
}

// Lit referral_state une fois par compte (appels simultanés : une seule requête). true si l'état a changé.
function referralLoad() {
  referralSync();
  if (!account.user || referral.state) return Promise.resolve(false);
  if (referral.loading) return referral.loading;
  const seq = referralSeq;
  referral.loading = referralRpc('referral_state').then(r => {
    if (seq !== referralSeq) return false;
    referral.loading = null;
    if (!r.ok) return false;
    const before = JSON.stringify(referralView());
    referral.state = cleanReferralState(r.data);
    writeReferralCache();
    return JSON.stringify(referralView()) !== before;
  });
  return referral.loading;
}

// Saisie d'un code → { ok: true, data: { name, coach } } ou { ok: false, kind }. coach : le parrain est un coach
async function referralApply(code) {
  referralSync();
  const c = normalizeReferralCode(code);
  if (!c) return { ok: false, kind: 'invalid_code' };
  const r = await referralRpc('referral_apply', { code: c });
  if (!r.ok) return r;
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  if (d.ok !== true) return { ok: false, kind: d.error === 'invalid_code' ? 'invalid_code' : 'server' };
  const referrer = cleanReferrer(d.referrer);
  if (!referrer) return { ok: false, kind: 'server' };
  referral.state = { referrer, canEnter: false, until: referral.state?.until ?? null };
  writeReferralCache();
  return { ok: true, data: { name: referrer.name, coach: referrer.coach } };
}
