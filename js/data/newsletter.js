// ═══════════════════════════════════════════════════════════
//  Lettre d'information (newsletter) : inscription par consentement explicite, désinscription.
//  Contrat : docs/NEWSLETTER.md ; serveur : supabase/migrations/20261031230000_newsletter.sql.
//  Appels au serveur et état, sans affichage. Écran : js/features/newsletter-ui.js (écran Compte).
//
//  - Jamais coché d'avance : seul le geste de la personne sur l'interrupteur appelle
//    newsletter_subscribe, avec la VERSION du texte montré (NEWSLETTER_CONSENT_VERSION). Le serveur
//    horodate lui-même le consentement ; l'appareil n'envoie aucune date.
//  - Se désinscrire est toujours possible (newsletter_unsubscribe, jamais limité) : le serveur
//    supprime la ligne.
//  - L'adresse est celle du compte, lue par le serveur au moment d'un envoi. L'ENVOI N'EST PAS BRANCHÉ.
//  - Rien n'est gardé sur l'appareil : l'état est relu à l'ouverture de l'écran Compte. Tant qu'il
//    n'est pas connu, l'interrupteur est éteint et désactivé (aucune inscription supposée).
//  - Résultats : { ok: true, data } ou { ok: false, kind } ; l'écran s'abonne par onNewsletterChange.
// ═══════════════════════════════════════════════════════════
'use strict';

// Version du texte de consentement. Tout changement de NEWSLETTER_CONSENT_TEXT demande une nouvelle
// version (v2…), notée dans docs/NEWSLETTER.md : le serveur garde la version acceptée.
const NEWSLETTER_CONSENT_VERSION = 'v1';
const NEWSLETTER_CONSENT_TEXT = 'Je veux recevoir par e-mail la lettre d\'information de MDLF Training (nouveautés de l\'app, au plus une par mois). Je peux me désinscrire à tout moment, ici ou par le lien de chaque e-mail.';

const newsletter = { userId: null, state: null, loading: false, busy: false, error: null, loadedAt: 0 };
const newsletterListeners = [];
function onNewsletterChange(fn) { newsletterListeners.push(fn); }
function notifyNewsletter() { for (const fn of newsletterListeners) { try { fn(); } catch { /* écran absent */ } } }

// ── Logique pure ────────────────────────────────────────────

// newsletter_state() nettoyé : inscrit seulement si le serveur le dit exactement
function cleanNewsletterState(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const at = Date.parse(r.consented_at);
  const subscribed = r.subscribed === true;
  return {
    subscribed,
    consentedAt: subscribed && Number.isFinite(at) ? at : null,
    version: subscribed && typeof r.version === 'string' && /^v\d{1,3}$/.test(r.version) ? r.version : null,
  };
}

const NEWSLETTER_ERRORS = ['invalid_version', 'rate_limited', 'not_found'];
const NEWSLETTER_TEXT = {
  offline: 'Pas de connexion. Réessaie avec du réseau.',
  rate_limited: 'Trop de changements aujourd\'hui. Réessaie demain.',
  not_found: 'Connecte-toi d\'abord à ton compte.',
  signed_out: 'Connecte-toi d\'abord à ton compte.',
  invalid_version: 'Mets l\'app à jour, puis réessaie.',
  server: 'Le serveur ne répond pas. Réessaie plus tard.',
};
function newsletterErrorKind(error) {
  if (!error) return null;
  const msg = String(error.message || error.error || '');
  if (isNetworkError(error) || /fetch|network|load failed/i.test(msg)) return 'offline';
  for (const k of NEWSLETTER_ERRORS) if (msg.includes(k)) return k;
  return 'server';
}
function newsletterErrorText(kind) { return NEWSLETTER_TEXT[kind] || NEWSLETTER_TEXT.server; }

// ── Appels au serveur ───────────────────────────────────────

async function newsletterRpc(fn, args) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  const uid = account.user.id;
  try {
    const { data: res, error } = await sb.rpc(fn, args);
    if (account.user?.id !== uid) return { ok: false, kind: 'signed_out' };
    return error ? { ok: false, kind: newsletterErrorKind(error) } : { ok: true, data: res };
  } catch (e) {
    return { ok: false, kind: newsletterErrorKind(e) || 'server' };
  }
}

function newsletterReset(userId) {
  Object.assign(newsletter, { userId, state: null, loading: false, busy: false, error: null, loadedAt: 0 });
}

async function newsletterRefresh({ minAge = 0 } = {}) {
  if (!sb || !account.user) return false;
  if (newsletter.userId !== account.user.id) newsletterReset(account.user.id);
  if (newsletter.loading) return false;
  if (minAge && newsletter.loadedAt && Date.now() - newsletter.loadedAt < minAge) return true;
  newsletter.loading = true;
  try {
    const r = await newsletterRpc('newsletter_state');
    if (r.ok) { newsletter.state = cleanNewsletterState(r.data); newsletter.loadedAt = Date.now(); }
    newsletter.error = r.ok ? null : r.kind;
    return r.ok;
  } finally {
    newsletter.loading = false;
    notifyNewsletter();
  }
}

// on = true : inscription (geste explicite, version du texte montré) ; false : désinscription
async function newsletterSet(on) {
  if (newsletter.busy) return { ok: false, kind: 'busy' };
  newsletter.busy = true;
  notifyNewsletter();
  try {
    const r = on
      ? await newsletterRpc('newsletter_subscribe', { consent_version: NEWSLETTER_CONSENT_VERSION })
      : await newsletterRpc('newsletter_unsubscribe');
    if (r.ok) { newsletter.state = cleanNewsletterState(r.data); newsletter.error = null; newsletter.loadedAt = Date.now(); }
    return r.ok ? { ok: true, data: newsletter.state } : r;
  } finally {
    newsletter.busy = false;
    notifyNewsletter();
  }
}

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id !== newsletter.userId) newsletterReset(id);
});
