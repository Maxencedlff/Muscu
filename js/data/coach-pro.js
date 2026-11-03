// ═══════════════════════════════════════════════════════════
//  Rôle coach (tarifs du 30/10/2026) : demande vérifiée à la main, code permanent, palier d'élèves.
//  Appels au serveur et logique pure, sans affichage. Écrans : js/features/coach-pro-ui.js.
//
//  - Être coach, c'est être éducateur sportif diplômé, titulaire d'une carte professionnelle
//    (obligatoire en France pour encadrer contre rémunération). « Devenir coach » est donc une
//    DEMANDE (coach_request_submit : nom tel qu'il figure sur la carte, numéro de carte, diplôme),
//    que l'administrateur vérifie sur https://recherche-educateur.sports.gouv.fr puis valide ou refuse
//    en SQL. Aucune RPC de l'app ne donne le rôle. Pas de photo de la carte : aucun fichier envoyé.
//  - Après l'envoi, l'app prévient l'administrateur par la fonction Edge coach-request-alert, au
//    mieux : un échec ne change rien à la demande, déjà enregistrée.
//  - Coach validé : son code permanent (coach_my_code, 12 caractères) et son palier
//    (coach_tier_state : formule coach en cours, limite d'élèves, élèves suivis, palier suivant).
//    Le serveur refuse un élève de trop (tier_full) ; l'app le dit au coach avant (bandeau).
//  - Les abonnements coach ne sont proposés qu'à un coach validé (js/features/paywall-ui.js).
//  - Résultats : { ok: true, data } ou { ok: false, kind }. L'écran s'abonne par onCoachChange
//    (même signal que le coach : un seul redessin).
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_REQUEST_STATUSES = ['none', 'pending', 'approved', 'rejected', 'revoked'];
const COACH_DIPLOMAS = ['BPJEPS', 'DEJEPS', 'DESJEPS', 'Licence STAPS', 'Master STAPS', 'CQP', 'Autre'];
// Mêmes bornes que le serveur (coach_request_submit)
const COACH_CARD_RE = /^[A-Z0-9]{6,20}$/;

const coachPro = { userId: null, request: null, tier: null, code: null, loading: false, error: null, loadedAt: 0 };

// ── Logique pure ────────────────────────────────────────────

const proStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
// Numéro de carte saisi : majuscules, sans espaces ni tirets ; null s'il n'a pas la bonne forme
function normalizeCardNumber(raw) {
  const c = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  return COACH_CARD_RE.test(c) ? c : null;
}
// coach_request_state() nettoyé
function cleanCoachRequest(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const t = v => { const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };
  return {
    status: COACH_REQUEST_STATUSES.includes(r.status) ? r.status : 'none',
    card_name: proStr(r.card_name, 80), card_number: proStr(r.card_number, 20), diploma: proStr(r.diploma, 80),
    reason: proStr(r.reason, 500), created_at: t(r.created_at), decided_at: t(r.decided_at),
    is_coach: r.is_coach === true,
  };
}
// coach_tier_state() nettoyé. limit null : élèves illimités. product_id : formule coach en cours.
function cleanCoachTier(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const n = v => (Number.isInteger(v) && v >= 0 ? v : null);
  const product = planIsCoach(r.product_id) ? r.product_id : null;
  const next = planIsCoach(r.next_product) ? r.next_product : null;
  const students = n(r.students) ?? 0, limit = n(r.limit);
  return { is_coach: r.is_coach === true, paywall_on: r.paywall_on === true, product_id: product, limit, students,
    full: r.full === true || (limit !== null && students >= limit), next_product: next };
}
// Le palier est plein : « 10 élèves sur 10 : passe au palier supérieur ». null sinon.
function coachTierFullText(tier) {
  if (!tier || !tier.is_coach || !tier.full || tier.limit === null) return null;
  return tier.limit === 0
    ? 'Prends un abonnement coach pour accueillir des élèves.'
    : `${tier.students} ${tier.students > 1 ? 'élèves' : 'élève'} sur ${tier.limit} : passe au palier supérieur.`;
}

// Erreurs de la demande → texte
const COACH_PRO_ERRORS = ['already_coach', 'invalid_name', 'invalid_card', 'invalid_diploma', 'not_coach', 'rate_limited', 'not_found'];
const COACH_PRO_TEXT = {
  already_coach: 'Ton compte est déjà un compte coach.',
  invalid_name: 'Écris ton nom tel qu\'il figure sur ta carte (2 à 80 caractères).',
  invalid_card: 'Numéro de carte introuvable : 6 à 20 lettres et chiffres, comme sur ta carte.',
  invalid_diploma: 'Choisis ton diplôme.',
  not_coach: 'Ton compte n\'est pas un compte coach.',
  rate_limited: 'Trop d\'envois pour aujourd\'hui. Réessaie demain.',
  not_found: 'Connecte-toi d\'abord à ton compte.',
};
function coachProErrorKind(error) {
  if (!error) return null;
  if (isNetworkError(error) || /fetch|network|load failed/i.test(String(error.message || ''))) return 'offline';
  const msg = String(error.message || error.error || '');
  for (const k of COACH_PRO_ERRORS) if (msg.includes(k)) return k;
  return 'server';
}
function coachProErrorText(kind) { return COACH_PRO_TEXT[kind] || coachErrorText(kind); }

// ── Appels au serveur ───────────────────────────────────────

async function coachProRpc(fn, args) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  const uid = account.user.id;
  try {
    const { data: res, error } = await sb.rpc(fn, args);
    if (account.user?.id !== uid) return { ok: false, kind: 'signed_out' };
    return error ? { ok: false, kind: coachProErrorKind(error) } : { ok: true, data: res };
  } catch (e) {
    return { ok: false, kind: coachProErrorKind(e) || 'server' };
  }
}

function coachProReset(userId) {
  Object.assign(coachPro, { userId, request: null, tier: null, code: null, loading: false, error: null, loadedAt: 0 });
}

// Relit ce qu'il faut selon le rôle : la demande (pas encore coach), ou le palier et le code (coach)
async function coachProRefresh({ minAge = 0 } = {}) {
  if (!sb || !account.user) return false;
  if (coachPro.userId !== account.user.id) coachProReset(account.user.id);
  if (coachPro.loading) return false;
  if (minAge && coachPro.loadedAt && Date.now() - coachPro.loadedAt < minAge) return true;
  coachPro.loading = true;
  try {
    const req = await coachProRpc('coach_request_state');
    if (req.ok) coachPro.request = cleanCoachRequest(req.data);
    const isCoach = coachPro.request?.is_coach || coachRole().isCoach;
    let ok = req.ok;
    if (isCoach) {
      const [tier, code] = await Promise.all([coachProRpc('coach_tier_state'), coachProRpc('coach_my_code')]);
      if (tier.ok) coachPro.tier = cleanCoachTier(tier.data);
      const c = code.ok && code.data && typeof code.data === 'object' ? code.data.code : null;
      if (code.ok) coachPro.code = typeof c === 'string' && COACH_CODE_RE.test(c) ? c : null;
      ok = ok && tier.ok;
      coachPro.error = !tier.ok ? tier.kind : !req.ok ? req.kind : null;
    } else {
      coachPro.tier = null; coachPro.code = null;
      coachPro.error = req.ok ? null : req.kind;
    }
    if (ok) coachPro.loadedAt = Date.now();
    return ok;
  } finally {
    coachPro.loading = false;
    notifyCoach();
  }
}

// Envoie (ou corrige, tant qu'elle attend) la demande. Les champs sont vérifiés ici d'abord, aux mêmes
// bornes que le serveur, pour dire tout de suite ce qui ne va pas.
async function coachRequestSubmit({ cardName, cardNumber, diploma }) {
  const name = String(cardName ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return { ok: false, kind: 'invalid_name' };
  const card = normalizeCardNumber(cardNumber);
  if (!card) return { ok: false, kind: 'invalid_card' };
  const dip = String(diploma ?? '').trim();
  if (dip.length < 2 || dip.length > 80) return { ok: false, kind: 'invalid_diploma' };
  const r = await coachProRpc('coach_request_submit', { card_name: name, card_number: card, diploma: dip });
  if (!r.ok) return r;
  coachPro.request = cleanCoachRequest(r.data);
  notifyCoach();
  coachRequestAlert();
  return { ok: true, data: coachPro.request };
}

// Prévient l'administrateur (e-mail), au mieux et sans attendre : la demande est déjà enregistrée
async function coachRequestAlert() {
  if (!sb || !account.user) return false;
  try { return (await sb.functions.invoke('coach-request-alert', { body: {} })).data?.ok === true; }
  catch { return false; }
}

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id !== coachPro.userId) coachProReset(id);
});
