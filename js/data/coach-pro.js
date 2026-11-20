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
//  - Badge « Carte pro déclarée » (17/11/2026, migration 20261117090000_badge_carte_pro.sql, contrat
//    docs/COACH_V1.md « Badge carte pro ») : le coach validé DÉCLARE le numéro de sa carte (Réglages › Coach) ;
//    le badge dit « déclarée », jamais « vérifiée ». Numéro lu par le coach seul (coach_card_state) ; les
//    autres ne lisent que { shown, declared_at } (coach_card_badge, gardé 5 min). Signalé (report_coach_card,
//    puis alerte e-mail par la fonction Edge report dès le premier) : suspendu à partir de 2 comptes différents,
//    jusqu'à la revue ; au premier, rien ne change à l'écran.
//    'verified' (FranceConnect, plus tard) est montré comme 'declared'.
//  - Résultats : { ok: true, data } ou { ok: false, kind }. L'écran s'abonne par onCoachChange
//    (même signal que le coach : un seul redessin) ; les badges des autres par onCoachBadgeChange.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_REQUEST_STATUSES = ['none', 'pending', 'approved', 'rejected', 'revoked'];
const COACH_DIPLOMAS = ['BPJEPS', 'DEJEPS', 'DESJEPS', 'Licence STAPS', 'Master STAPS', 'CQP', 'Autre'];
// Mêmes bornes que le serveur (coach_request_submit)
const COACH_CARD_RE = /^[A-Z0-9]{6,20}$/;

const coachPro = { userId: null, request: null, tier: null, code: null, card: null, loading: false, error: null, loadedAt: 0 };

// Badge carte pro. Format des cartes du portail EAPS : département sur 3 caractères (075, 02A, 971), année
// sur 2 chiffres, « ED », numéro d'ordre (04912ED0123). Mêmes bornes que coach_card_declare.
const COACH_CARD_STATES = ['none', 'declared', 'suspended', 'removed'];
const COACH_BADGE_CARD_RE = /^\d{2}[\dAB]\d{2}ED\d{4,5}$/;
const COACH_BADGE_LABEL = 'Carte pro déclarée';
const COACH_BADGE_TTL = 5 * 60_000;
const coachBadges = new Map();     // user_id → { shown, declared_at, at, loading }
const coachBadgeListeners = [];
function onCoachBadgeChange(fn) { coachBadgeListeners.push(fn); }
function notifyCoachBadge() { for (const fn of coachBadgeListeners) { try { fn(); } catch { /* écran absent */ } } }

// ── Logique pure ────────────────────────────────────────────

const proStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
// Numéro de carte saisi : majuscules, sans espaces, points, tirets ni barres (comme coach_request_submit, qui les
// ignore aussi : « 04/912 ED.0123 » était refusé ici et accepté par le serveur) ; null s'il n'a pas la bonne forme
function normalizeCardNumber(raw) {
  const c = String(raw ?? '').toUpperCase().replace(/[\s.\-/]/g, '');
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
// Numéro de carte saisi pour le badge : majuscules, sans espaces, points, tirets ni barres ; null s'il
// n'a pas la forme d'une carte du portail EAPS
function normalizeBadgeCard(raw) {
  const c = String(raw ?? '').toUpperCase().replace(/[\s.\-/]/g, '');
  return COACH_BADGE_CARD_RE.test(c) ? c : null;
}
// coach_card_state() nettoyé. 'verified' (plus tard) reste « déclarée » à l'écran.
function cleanCoachCard(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const t = v => { const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };
  const st = r.status === 'verified' ? 'declared' : COACH_CARD_STATES.includes(r.status) ? r.status : 'none';
  const num = typeof r.card_number === 'string' && COACH_BADGE_CARD_RE.test(r.card_number) ? r.card_number : null;
  return { status: st === 'none' || num ? st : 'none', card_number: st === 'none' ? null : num,
    declared_at: t(r.declared_at), suspended_at: t(r.suspended_at), removed_reason: proStr(r.removed_reason, 500) };
}
// coach_card_badge() nettoyé : montré seulement si le serveur le dit exactement
function cleanCoachBadge(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const t = typeof r.declared_at === 'number' ? r.declared_at : Date.parse(r.declared_at);
  return { shown: r.shown === true, declared_at: r.shown === true && Number.isFinite(t) ? t : null };
}

// coach_tier_state() nettoyé. limit null : inconnue. product_id : formule coach en cours. contact : plus haut palier
// plein (100 élèves), aucune formule au-dessus (clé du serveur depuis la grille du 17/11, déduite sinon).
function cleanCoachTier(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const n = v => (Number.isInteger(v) && v >= 0 ? v : null);
  const product = planIsCoach(r.product_id) ? r.product_id : null;
  const next = planIsCoach(r.next_product) ? r.next_product : null;
  const students = n(r.students) ?? 0, limit = n(r.limit);
  // uncovered : élèves que la formule ne couvre pas (au-delà du palier, ou tous sans abonnement coach)
  return { is_coach: r.is_coach === true, paywall_on: r.paywall_on === true, product_id: product, limit, students,
    full: r.full === true || (limit !== null && students >= limit), next_product: next,
    uncovered: Math.min(n(r.uncovered) ?? 0, students),
    contact: r.contact === true || (planOf(product)?.tier.key === 'coachmax' && students >= PLAN_COACH_MAX) };
}
// Des élèves ne sont plus offerts (au-delà du palier, ou sans abonnement coach) : le coach est invité à
// monter de palier. Sinon le palier est plein : « 10 élèves sur 10 : passe au palier supérieur ». null sinon.
function coachTierFullText(tier) {
  // Plus haut palier plein, ou plus de 100 élèves : aucune formule au-dessus
  if (tier?.is_coach && (tier.contact || (tier.uncovered > 0 && tier.students > PLAN_COACH_MAX))) return `${PLAN_COACH_CONTACT}.`;
  if (tier?.is_coach && tier.uncovered > 0) {
    const who = tier.uncovered > 1 ? `${tier.uncovered} élèves` : '1 élève';
    return tier.product_id
      ? `${who} au-delà de ton palier : ${tier.uncovered > 1 ? 'leur' : 'son'} accès n'est plus offert. Passe au palier supérieur.`
      : `Sans abonnement coach, l'accès de ${tier.uncovered > 1 ? `tes ${tier.uncovered} élèves n'est` : 'ton élève n\'est'} pas offert. Prends un abonnement coach.`;
  }
  if (!tier || !tier.is_coach || !tier.full || tier.limit === null) return null;
  return tier.limit === 0
    ? 'Prends un abonnement coach pour accueillir des élèves.'
    : `${tier.students} ${tier.students > 1 ? 'élèves' : 'élève'} sur ${tier.limit} : passe au palier supérieur.`;
}

// Erreurs de la demande → texte
const COACH_PRO_ERRORS = ['already_coach', 'invalid_name', 'invalid_card', 'invalid_diploma', 'not_coach', 'rate_limited', 'not_found',
  'card_suspended', 'card_removed'];
const COACH_PRO_TEXT = {
  already_coach: 'Ton compte est déjà un compte coach.',
  invalid_name: 'Écris ton nom tel qu\'il figure sur ta carte (2 à 80 caractères).',
  invalid_card: 'Recopie le numéro comme sur ta carte (ex. 04/912 ED.0123).',
  invalid_diploma: 'Choisis ton diplôme.',
  not_coach: 'Ton compte n\'est pas un compte coach.',
  rate_limited: 'Trop d\'envois pour aujourd\'hui. Réessaie demain.',
  not_found: 'Connecte-toi d\'abord à ton compte.',
  card_suspended: 'Badge suspendu après des signalements. L\'équipe vérifie ta carte, tu pourras le modifier ensuite.',
  card_removed: 'Badge retiré par l\'équipe. Pour en parler, écris à contact@mdlf.app.',
  invalid_badge_card: 'Ce numéro n\'a pas le bon format. Recopie-le comme sur ta carte, par exemple 04912ED0123.',
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
  Object.assign(coachPro, { userId, request: null, tier: null, code: null, card: null, loading: false, error: null, loadedAt: 0 });
  coachBadges.clear();   // autre compte : les badges vus (blocages compris) sont relus
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
      const [tier, code, card] = await Promise.all([coachProRpc('coach_tier_state'), coachProRpc('coach_my_code'), coachProRpc('coach_card_state')]);
      if (tier.ok) coachPro.tier = cleanCoachTier(tier.data);
      // Serveur sans le badge (migration pas encore appliquée) ou hors ligne : la section reste cachée
      if (card.ok) coachPro.card = cleanCoachCard(card.data);
      const c = code.ok && code.data && typeof code.data === 'object' ? code.data.code : null;
      if (code.ok) coachPro.code = typeof c === 'string' && COACH_CODE_RE.test(c) ? c : null;
      ok = ok && tier.ok;
      coachPro.error = !tier.ok ? tier.kind : !req.ok ? req.kind : null;
    } else {
      coachPro.tier = null; coachPro.code = null; coachPro.card = null;
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
  // En caractères comme char_length du serveur (un emoji compte 1) ; invisibles seuls : pas un nom
  const n = [...name].length;
  if (n < 2 || n > 80 || !hasVisible(name)) return { ok: false, kind: 'invalid_name' };
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

// ── Badge carte pro ─────────────────────────────────────────

// Mon badge : déclarer ou changer de numéro (vérifié ici d'abord, aux bornes du serveur)
async function coachCardDeclare(cardNumber) {
  const card = normalizeBadgeCard(cardNumber);
  if (!card) return { ok: false, kind: 'invalid_badge_card' };
  const r = await coachProRpc('coach_card_declare', { card_number: card });
  if (!r.ok) return r.kind === 'invalid_card' ? { ok: false, kind: 'invalid_badge_card' } : r;
  coachPro.card = cleanCoachCard(r.data);
  if (account.user) coachBadges.delete(account.user.id);
  notifyCoach(); notifyCoachBadge();
  return { ok: true, data: coachPro.card };
}
async function coachCardWithdraw() {
  const r = await coachProRpc('coach_card_withdraw');
  if (!r.ok) return r;
  coachPro.card = cleanCoachCard(r.data);
  if (account.user) coachBadges.delete(account.user.id);
  notifyCoach(); notifyCoachBadge();
  return { ok: true, data: coachPro.card };
}

// Badge d'un coach tel que je le vois : null tant qu'il n'est pas lu
function coachBadgeOf(uid) { const b = uid ? coachBadges.get(uid) : null; return b && b.at ? b : null; }
function coachBadgeShown(uid) { return coachBadgeOf(uid)?.shown === true; }
// Lit le badge (gardé 5 min). Échec (hors ligne, serveur d'avant) : pas montré, relu au prochain passage.
async function coachBadgeLoad(uid, { force = false } = {}) {
  if (!sb || !account.user || typeof uid !== 'string' || !uid) return null;
  const old = coachBadges.get(uid);
  if (old?.loading) return null;
  if (!force && old && Date.now() - old.at < COACH_BADGE_TTL) return old;
  coachBadges.set(uid, { ...(old || { shown: false, declared_at: null }), at: old?.at || 0, loading: true });
  const r = await coachProRpc('coach_card_badge', { coach: uid });
  const b = r.ok ? { ...cleanCoachBadge(r.data), at: Date.now() } : { shown: false, declared_at: null, at: 0 };
  if (!account.user) return null;   // déconnecté pendant l'appel : rien gardé
  coachBadges.set(uid, b);
  if (!old || old.shown !== b.shown || old.declared_at !== b.declared_at) notifyCoachBadge();
  return b;
}

// Signaler le badge d'un coach : enregistré côté serveur, alerte e-mail au mieux. Le badge reste tel que le
// serveur le dit (relu) : suspendu seulement au 2e compte différent. data : id du signalement, ou null si ce
// compte l'avait déjà signalé (already: true).
async function coachCardReport(uid, details = '') {
  const d = String(details || '').trim().slice(0, 300);
  const r = await coachProRpc('report_coach_card', { coach: uid, details: d || null });
  if (!r.ok) return r;
  const id = Number.isSafeInteger(r.data) && r.data > 0 ? r.data : null;
  if (id && typeof socialReportAlert === 'function') socialReportAlert(id);
  await coachBadgeLoad(uid, { force: true });
  return { ok: true, data: id, already: id === null };
}

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id !== coachPro.userId) coachProReset(id);
});
