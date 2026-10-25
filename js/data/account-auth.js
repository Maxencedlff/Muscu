// ═══════════════════════════════════════════════════════════
//  Compte : logique pure de la connexion et du profil (sans réseau ni écran)
//
//  - Premier écran (firstScreen) : Bienvenue au tout premier lancement seulement, jamais un mur de
//    connexion ; sinon une carte fermable sur l'accueil (accountCardShown).
//  - Pseudo : normalisation (accents retirés, minuscules) et règles identiques à la migration
//    supabase/migrations/20261026000000_profils.sql (USERNAME_RE). Les mots interdits sont vérifiés
//    par le serveur seulement (liste privée).
//  - Avatar : un emoji de AVATAR_EMOJIS, même liste blanche que le serveur (test unitaire). Aucune
//    photo, aucune image de corps.
//  - Moyens de connexion : identités Supabase (apple, google, email) de l'utilisateur.
//  - Connexion récente (amr du jeton, comme supabase/functions/delete-account/recent-auth.js) et
//    traduction des erreurs Supabase en messages français.
//  Le nom et l'e-mail renvoyés par Google (identity_data.full_name, email) ne sont jamais affichés ni
//  copiés ailleurs : seul le pseudo choisi dans l'app sert de nom.
// ═══════════════════════════════════════════════════════════
'use strict';

const OTP_LENGTH    = 6;
const OTP_TTL_MS    = 10 * 60_000;   // durée de validité d'un code (mailer_otp_exp = 600 côté Supabase)
const OTP_RESEND_MS = 60_000;        // « Renvoyer » grisé pendant ce délai (limite d'envoi de Supabase)
const RECENT_AUTH_MS = 10 * 60_000;  // suppression du compte : connexion de moins de 10 min
const WELCOME_SEEN_KEY  = 'ppl_welcome_seen';         // écran Bienvenue déjà montré (quel que soit le choix)
const ACCOUNT_CARD_KEY  = 'ppl_account_card_closed';  // carte « Sauvegarde tes séances » fermée
const USERNAME_RE  = /^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$/;
const USERNAME_MIN = 3, USERNAME_MAX = 20;
const USERNAME_DELAY_MS = 30 * 86400_000;            // 30 jours entre deux changements (déclencheur serveur)

// ── Premier écran ───────────────────────────────────────────

// 'welcome' au tout premier lancement de l'app iOS : aucune séance, carte « Où t'entraînes-tu ? »
// pas encore passée, aucune copie restaurée (Documents ou iCloud), écran jamais montré, pas connecté.
// Sinon 'app'. Dans le navigateur (compte indisponible) : toujours 'app'.
function firstScreen({ accountAvailable, hasHistory, onboarded, restored, welcomeSeen, signedIn }) {
  if (!accountAvailable || signedIn || welcomeSeen || restored || hasHistory || onboarded) return 'app';
  return 'welcome';
}

// Carte unique de l'accueil pour qui n'a pas vu l'écran Bienvenue (utilisateur d'avant les comptes,
// données restaurées) : tant qu'il n'est pas connecté et ne l'a pas fermée
function accountCardShown({ accountAvailable, ready, signedIn, welcomeSeen, cardClosed }) {
  return !!(accountAvailable && ready && !signedIn && !welcomeSeen && !cardClosed);
}

// ── Pseudo ──────────────────────────────────────────────────

// Saisie → forme enregistrée : accents retirés (é → e, œ → oe), minuscules, espaces et tirets en
// tiret bas, « @ » du début retiré. Le reste (emoji, ponctuation) est laissé : usernameProblem le signale.
function normalizeUsername(raw) {
  return String(raw ?? '').trim().replace(/^@+/, '')
    .replace(/œ/gi, 'oe').replace(/æ/gi, 'ae').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[\s-]+/g, '_');
}

// Problème d'un pseudo déjà normalisé : null s'il est valable, sinon une clé de USERNAME_TEXT
function usernameProblem(name) {
  const s = String(name ?? '');
  if (!s) return 'empty';
  if (s.length < USERNAME_MIN) return 'short';
  if (s.length > USERNAME_MAX) return 'long';
  if (!/^[a-z0-9._]+$/.test(s)) return 'chars';
  if (/^[._]|[._]$/.test(s)) return 'edge';
  if (s.includes('..')) return 'dots';
  return USERNAME_RE.test(s) ? null : 'chars';
}

// Messages du pseudo : règles locales et réponses du serveur (profileErrorKind, disponibilité)
const USERNAME_TEXT = {
  empty: 'Choisis un pseudo',
  short: `Au moins ${USERNAME_MIN} caractères`,
  long: `${USERNAME_MAX} caractères au plus`,
  chars: 'Lettres sans accent, chiffres, point et tiret bas seulement',
  edge: 'Ni point ni tiret bas au début ou à la fin',
  dots: 'Pas deux points de suite',
  taken: 'Ce pseudo n\'est pas disponible',
  forbidden: 'Ce pseudo n\'est pas autorisé',
  too_soon: 'Tu as déjà changé de pseudo il y a moins de 30 jours',
  required: 'Ton pseudo ne peut pas être retiré, seulement changé',
  offline: 'Pas d\'Internet : réessaie avec du réseau',
  server: 'Enregistrement impossible pour l\'instant, réessaie dans un moment',
};

// Date à partir de laquelle le pseudo peut de nouveau changer (ms), ou 0 si c'est possible dès maintenant
function usernameNextChange(profile, now = Date.now()) {
  const at = Date.parse(profile?.changedAt || '');
  if (!profile?.username || !Number.isFinite(at)) return 0;
  const next = at + USERNAME_DELAY_MS;
  return next > now ? next : 0;
}

// Erreur de l'enregistrement du profil (PostgREST) → clé de USERNAME_TEXT
function profileErrorKind(error) {
  if (!error) return null;
  if (isNetworkError(error)) return 'offline';
  const msg = String(error.message || '');
  if (error.code === '23505') return 'taken';
  if (/username_forbidden/.test(msg)) return 'forbidden';
  if (/username_too_soon/.test(msg)) return 'too_soon';
  if (/username_required/.test(msg)) return 'required';
  if (error.code === '23514') return /avatar/.test(msg) ? 'server' : 'chars';
  return 'server';
}

// Compte tout juste créé (pas encore de profil, créé il y a moins de 10 min) : on propose le pseudo
function isNewAccount(user, profile, now = Date.now()) {
  if (profile !== null) return false;   // profil présent, ou illisible (undefined) : on ne redemande pas
  const created = Date.parse(user?.created_at || '');
  return Number.isFinite(created) && now - created < 10 * 60_000;
}

// ── Avatar ──────────────────────────────────────────────────

// Liste blanche (même liste et même ordre que la contrainte user_profiles_avatar_emoji du serveur) :
// objets de sport, animaux, nature. Aucun personnage ni partie du corps. Un seul point de code par
// emoji (pas de sélecteur de variante) : la comparaison avec le serveur est exacte.
const AVATAR_EMOJIS = [
  { emoji: '⚽', name: 'Ballon de foot' }, { emoji: '🏀', name: 'Ballon de basket' },
  { emoji: '🎾', name: 'Balle de tennis' }, { emoji: '🥊', name: 'Gant de boxe' },
  { emoji: '🥋', name: 'Kimono' }, { emoji: '🎯', name: 'Cible' },
  { emoji: '🏓', name: 'Ping-pong' }, { emoji: '🏆', name: 'Trophée' },
  { emoji: '🥇', name: 'Médaille d\'or' }, { emoji: '👟', name: 'Chaussure de sport' },
  { emoji: '🦁', name: 'Lion' }, { emoji: '🐯', name: 'Tigre' },
  { emoji: '🐻', name: 'Ours' }, { emoji: '🐺', name: 'Loup' },
  { emoji: '🦊', name: 'Renard' }, { emoji: '🐼', name: 'Panda' },
  { emoji: '🦅', name: 'Aigle' }, { emoji: '🦈', name: 'Requin' },
  { emoji: '🐙', name: 'Pieuvre' }, { emoji: '🦉', name: 'Hibou' },
  { emoji: '🔥', name: 'Flamme' }, { emoji: '⚡', name: 'Éclair' },
  { emoji: '⭐', name: 'Étoile' }, { emoji: '🌙', name: 'Lune' },
  { emoji: '🌊', name: 'Vague' }, { emoji: '🌲', name: 'Sapin' },
  { emoji: '🚀', name: 'Fusée' }, { emoji: '🎧', name: 'Casque audio' },
  { emoji: '💎', name: 'Diamant' }, { emoji: '🍀', name: 'Trèfle' },
];
const DEFAULT_AVATAR = '🔥';
function validAvatar(e) { return AVATAR_EMOJIS.some(a => a.emoji === e) ? e : DEFAULT_AVATAR; }
function avatarName(e) { return (AVATAR_EMOJIS.find(a => a.emoji === e) || AVATAR_EMOJIS.find(a => a.emoji === DEFAULT_AVATAR)).name; }

// ── E-mail et code ──────────────────────────────────────────

function normalizeEmail(raw) { return String(raw ?? '').trim().toLowerCase(); }
// Vérification de forme seulement (le serveur envoie le code ou refuse l'adresse)
function emailLooksValid(e) { return e.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(e); }
// Code saisi ou collé (« 123 456 », « Code : 123456 ») → chiffres seulement, 6 au plus
function codeDigits(raw) { return String(raw ?? '').replace(/\D/g, '').slice(0, OTP_LENGTH); }

// ── Moyens de connexion ─────────────────────────────────────

const LOGIN_PROVIDERS = [
  { provider: 'apple', label: 'Apple' },
  { provider: 'google', label: 'Google' },
  { provider: 'email', label: 'E-mail' },
];
function identityOf(user, provider) { return (user?.identities || []).find(i => i?.provider === provider) || null; }
function hasApple(user) { return !!identityOf(user, 'apple'); }
// Retirer un moyen de connexion : seulement s'il en reste au moins un autre
function canUnlink(user, provider) { return !!identityOf(user, provider) && (user?.identities || []).length >= 2; }
// Identifiant Google du compte (claim sub du jeton Google), pour vérifier qu'une nouvelle connexion
// Google (suppression du compte) vient bien du même compte Google
function googleSubOf(user) { const i = identityOf(user, 'google'); return i?.identity_data?.sub || i?.id || null; }
// Adresse à laquelle un code de connexion peut être envoyé (e-mail vérifié du compte), ou null
function signInEmailOf(user) { return user?.email && (user.email_confirmed_at || identityOf(user, 'email')) ? user.email : null; }
// Moyen principal à afficher sous le pseudo (« Connecté avec Apple ») : le plus ancien
function primaryProvider(user) {
  const ids = (user?.identities || []).filter(i => LOGIN_PROVIDERS.some(p => p.provider === i?.provider));
  ids.sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
  return ids[0]?.provider || null;
}

// ── Jetons ──────────────────────────────────────────────────

// Charge utile d'un JWT (sans vérifier la signature : lecture seule, le serveur vérifie), ou null
function jwtPayload(token) {
  try {
    const part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(part + '='.repeat((4 - part.length % 4) % 4));
    return JSON.parse(decodeURIComponent([...bin].map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
  } catch { return null; }
}
// Dernière vraie connexion de la session (ms), lue dans le claim amr ; même règle que le serveur
const FRESH_AUTH_METHODS = ['otp', 'magiclink', 'oauth', 'email/signup'];
function lastAuthAt(accessToken) {
  const amr = jwtPayload(accessToken)?.amr;
  let best = null;
  for (const a of Array.isArray(amr) ? amr : []) {
    if (a && FRESH_AUTH_METHODS.includes(a.method) && Number.isFinite(a.timestamp) && (best === null || a.timestamp > best)) best = a.timestamp;
  }
  return best === null ? null : best * 1000;
}
function isRecentAuth(accessToken, now = Date.now()) {
  const t = lastAuthAt(accessToken);
  return t !== null && now - t <= RECENT_AUTH_MS - 30_000 && t - now <= 60_000;   // 30 s de marge avant le refus du serveur
}

// ── Erreurs de Supabase Auth ────────────────────────────────

function isNetworkError(e) {
  if (!e) return false;
  if (e.name === 'AuthRetryableFetchError' || e instanceof TypeError) return true;
  return /failed to fetch|network|load failed|fetch failed/i.test(String(e.message || ''));
}

// Erreur de supabase-js → clé de AUTH_ERROR_TEXT. Un code faux et un code expiré donnent la même
// erreur côté Supabase (otp_expired, « Token has expired or is invalid ») : otpErrorKind les distingue
// par l'heure d'envoi.
function authErrorKind(error) {
  if (!error) return null;
  if (isNetworkError(error)) return 'offline';
  const code = error.code || '', msg = String(error.message || '');
  if (code === 'otp_expired') return 'code';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || error.status === 429) return 'rate';
  if (code === 'email_address_invalid' || (code === 'validation_failed' && /email/i.test(msg))) return 'email';
  if (code === 'email_address_not_authorized') return 'not_authorized';
  if (code === 'identity_already_exists' || code === 'email_exists' || code === 'user_already_exists') return 'identity_exists';
  if (code === 'single_identity_not_deletable' || code === 'email_conflict_identity_not_deletable') return 'last_identity';
  if (code === 'manual_linking_disabled') return 'linking_disabled';
  if (['email_provider_disabled', 'provider_disabled', 'otp_disabled', 'signup_disabled'].includes(code)) return 'disabled';
  if (code === 'user_not_found') return 'no_account';
  return 'server';
}
function otpErrorKind(error, sentAt, now = Date.now()) {
  const k = authErrorKind(error);
  if (k !== 'code') return k;
  return sentAt && now - sentAt > OTP_TTL_MS ? 'expired' : 'invalid';
}

const AUTH_ERROR_TEXT = {
  offline: 'Pas d\'Internet : vérifie ta connexion et réessaie',
  invalid: 'Code incorrect. Vérifie les 6 chiffres reçus par e-mail',
  expired: 'Ce code a expiré. Demande un nouveau code',
  code: 'Code incorrect ou expiré',
  rate: 'Trop de demandes : attends une minute avant de redemander un code',
  email: 'Cette adresse e-mail n\'est pas valable',
  not_authorized: 'L\'envoi des codes par e-mail n\'est pas encore ouvert. Utilise Apple pour l\'instant',
  identity_exists: 'Ce moyen de connexion est déjà relié à un autre compte',
  last_identity: 'Garde au moins un moyen de connexion',
  linking_disabled: 'Ajout d\'un moyen de connexion indisponible pour l\'instant',
  disabled: 'Ce moyen de connexion n\'est pas encore ouvert',
  no_account: 'Aucun compte avec cette adresse',
  same_email: 'Cette adresse sert déjà à te connecter',
  other_account: 'Ce n\'est pas le compte relié à MDLF. Choisis le même compte qu\'à la connexion',
  provider: 'Connexion impossible. Réessaie dans un moment',
  server: 'Connexion impossible pour l\'instant, réessaie dans un moment',
};
function authErrorText(kind) { return AUTH_ERROR_TEXT[kind] || AUTH_ERROR_TEXT.server; }
