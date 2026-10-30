// ═══════════════════════════════════════════════════════════
//  Partage avec le coach : ce que l'élève choisit de montrer à son coach en plus de ses séances.
//  Contrat : docs/COACH_V1.md, « Partage avec le coach » ; serveur :
//  supabase/migrations/20261031300000_partage_coach.sql. Écrans : js/features/coach-share-ui.js.
//
//  - Tout est décoché par défaut ; le consentement vit sur le serveur (par élève et par coach,
//    horodaté), jamais seulement sur l'appareil. Décocher (ou quitter le coach) efface côté serveur
//    tout ce qui a été envoyé, historique compris.
//  - Aujourd'hui : le poids du corps = les pesées SAISIES dans l'app (data.bodyWeightLog), jamais une
//    pesée lue dans Santé (elles n'entrent jamais dans bodyWeightLog, règle Apple 5.1.3 : voir
//    js/data/store.js). Sommeil, pas et fréquence cardiaque au repos sont prévus (COACH_SHARE_KINDS,
//    open: false) et ne s'affichent pas avant la build HealthKit.
//  - Double barrière : l'app n'envoie que si le serveur vient de dire « coché », et le serveur refuse
//    (not_shared) sans consentement actif.
//  - Les pesées partent dans un stockage dédié (student_share_weights), jamais dans sessions.data
//    (SYNC_LOCAL_ONLY, js/data/sync.js, inchangé). L'envoi remplace la liste : miroir de l'appareil,
//    envoyé au cochage, à une pesée saisie, et à la relecture si l'appareil a déjà envoyé et que ses
//    pesées ont changé (voir coachShareUpload : un autre appareil sans pesées n'écrase rien).
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_SHARE_KEY = 'mdlf_coach_share';   // { userId, coachId, hash } : dernier envoi des pesées de cet appareil (hash null : en attente)
const COACH_SHARE_MAX = 400;                  // pesées envoyées au plus (comme le serveur et BODY_LOG_MAX)
// Données que l'élève peut partager ; open : affichée et acceptée par le serveur (private.share_kind_open)
const COACH_SHARE_KINDS = [
  { kind: 'weight',     label: 'Poids du corps', open: true },
  { kind: 'sleep',      label: 'Sommeil', open: false },
  { kind: 'steps',      label: 'Pas', open: false },
  { kind: 'resting_hr', label: 'Fréquence cardiaque au repos', open: false },
];
const COACH_SHARE_KIND_IDS = COACH_SHARE_KINDS.map(k => k.kind);

// Élève : { state: { shares } | null, loading, error, busy: kind en cours de changement, upload: envoi en cours }
const coachShare = { userId: null, state: null, loading: false, error: null, busy: null, upload: null };
let coachShareSeq = 0;   // +1 au changement de compte : une réponse arrivée après n'écrit plus rien
// Coach : pesées partagées par élève { [uid]: { shared, since, weights, loading, error, loadedAt } }
const coachWeights = {};

// ── Logique pure ────────────────────────────────────────────

function coachShareKindsShown() { return COACH_SHARE_KINDS.filter(k => k.open); }

// student_shares() nettoyé : { coach, shares: { [kind]: { grantedAt, n, lastAt } } }, kinds connus seulement
function cleanShareState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const src = r.shares && typeof r.shares === 'object' && !Array.isArray(r.shares) ? r.shares : {};
  const shares = {};
  COACH_SHARE_KIND_IDS.forEach(k => {
    const v = src[k];
    if (!v || typeof v !== 'object') return;
    const n = Number.isInteger(v.n) && v.n >= 0 ? v.n : 0;
    shares[k] = { grantedAt: coachTime(v.granted_at), n, lastAt: Number.isFinite(Number(v.last_at)) && v.last_at !== null ? Number(v.last_at) : null };
  });
  return { coach: r.coach === true, shares };
}

// Pesées envoyées : celles saisies dans l'app seulement (bodyWeightLog), nettoyées comme sur l'appareil,
// du plus récent au plus ancien, kg à 2 décimales. Date ramenée au début du jour (heure locale) : le coach
// n'a pas besoin de l'heure de la pesée (minimisation) ; une par jour, comme bodyWeightLog. Rien d'autre de data.
function sharedWeightsPayload(d = data) {
  return cleanBodyWeightLog(d?.bodyWeightLog).slice(0, COACH_SHARE_MAX)
    .map(p => ({ date: new Date(p.date).setHours(0, 0, 0, 0), kg: Math.round(p.kg * 100) / 100 }));
}

// coach_student_weights() nettoyé : { shared, since, weights: [{ date, kg }] } du plus récent au plus ancien
function cleanCoachWeights(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const shared = r.shared === true;
  const weights = shared && Array.isArray(r.weights) ? r.weights.slice(0, COACH_SHARE_MAX)
    .map(w => ({ date: Number(w?.date), kg: Number(w?.kg) }))
    .filter(w => Number.isFinite(w.date) && w.date > 0 && Number.isFinite(w.kg) && w.kg >= 25 && w.kg <= 300)
    .sort((a, b) => b.date - a.date) : [];
  return { shared, since: shared ? coachTime(r.since) : null, weights };
}

// Poids du corps d'une séance d'un élève, reçu du serveur (dernière pesée partagée à sa date), ou null
function cleanSessionBodyKg(v) {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 25 && n <= 300 ? n : null;
}

// ── Élève : état et changements ─────────────────────────────

function coachShareOn(kind) { return !!coachShare.state?.shares?.[kind]; }
// Résumé pour la cellule des Réglages : « Poids du corps », « Rien » ; null tant que l'état n'est pas lu
function coachShareSummary() {
  if (!coachShare.state) return null;
  const on = coachShareKindsShown().filter(k => coachShareOn(k.kind)).map(k => k.label);
  return on.length ? on.join(', ') : 'Rien';
}

function coachShareReset(userId) {
  coachShareSeq++;
  Object.assign(coachShare, { userId, state: null, loading: false, error: null, busy: null, upload: null });
  Object.keys(coachWeights).forEach(k => delete coachWeights[k]);
}

function readShareSent() {
  try { const c = JSON.parse(localStorage.getItem(COACH_SHARE_KEY)); return c && c.userId === coachShare.userId ? c : null; }
  catch { return null; }
}
function writeShareSent(v) {
  try { if (v) localStorage.setItem(COACH_SHARE_KEY, JSON.stringify({ userId: coachShare.userId, ...v })); else localStorage.removeItem(COACH_SHARE_KEY); }
  catch { /* facultatif : au pire, un envoi de plus */ }
}

// Relit ce que je partage (élève seulement), puis renvoie les pesées si elles ont changé
async function coachShareRefresh() {
  if (!account.user || !coachRole().hasCoach) {
    if (coachShare.state) { coachShare.state = null; writeShareSent(null); notifyCoach(); }
    return false;
  }
  if (coachShare.loading) return false;
  coachShare.loading = true;
  const seq = coachShareSeq;
  const r = await coachRpc('student_shares');
  if (seq !== coachShareSeq) return false;
  coachShare.loading = false;
  if (!r.ok) { coachShare.error = r.kind; notifyCoach(); return false; }
  coachShare.state = cleanShareState(r.data);
  coachShare.error = null;
  notifyCoach();
  await coachShareUpload();
  return true;
}

// Cocher ou décocher une donnée. Cocher le poids envoie aussitôt les pesées
async function coachShareSet(kind, on) {
  if (!COACH_SHARE_KINDS.some(k => k.kind === kind && k.open)) return { ok: false, kind: 'invalid_kind' };
  if (coachShare.busy) return { ok: false, kind: 'busy' };
  coachShare.busy = kind;
  notifyCoach();
  const seq = coachShareSeq;
  const r = await coachRpc('student_set_share', { kind, enabled: !!on });
  if (seq !== coachShareSeq) return { ok: false, kind: 'signed_out' };
  coachShare.busy = null;
  if (r.ok) {
    coachShare.state = cleanShareState(r.data);
    if (!on && kind === 'weight') writeShareSent(null);   // tout est effacé côté serveur
  }
  notifyCoach();
  if (r.ok && on && kind === 'weight') {
    const u = await coachShareUpload({ force: true });
    if (!u.ok) return { ok: true, uploadFailed: u.kind };
  }
  return r;
}

// Envoie les pesées si le poids est partagé et qu'elles ont changé depuis le dernier envoi de cet
// appareil. Hors ligne : retenté à la prochaine relecture.
// force : geste sur cet appareil (case cochée ici, pesée saisie ici) : la liste de l'appareil part.
// Sans geste (relecture) : seulement si cet appareil a déjà envoyé pour ce coach. Les pesées ne se
// synchronisent pas : un second appareil sans pesées n'écrase jamais, à la connexion, celles du premier.
async function coachShareUpload({ force = false } = {}) {
  if (!coachShareOn('weight')) return { ok: true, skipped: true };
  if (coachShare.upload) return coachShare.upload;
  const coachId = myCoach()?.user_id || null;
  const weights = sharedWeightsPayload();
  const hash = syncHash(weights);
  const last = readShareSent();
  const mine = last && last.coachId === coachId;
  if (!force && (!mine || last.hash === hash)) return { ok: true, skipped: true };
  // Geste ici, premier envoi pour ce coach : marque « en attente » (hash null) posée avant l'envoi, pour
  // qu'un échec (hors ligne) soit retenté à la relecture (mine, et hash différent)
  if (!mine) writeShareSent({ coachId, hash: null });
  const seq = coachShareSeq;
  coachShare.upload = (async () => {
    const r = await coachRpc('student_share_weights', { weights });
    if (seq !== coachShareSeq) return { ok: false, kind: 'signed_out' };
    if (r.ok) {
      writeShareSent({ coachId, hash });
      const st = coachShare.state?.shares?.weight;
      if (st) { st.n = Number.isInteger(r.data) ? r.data : weights.length; st.lastAt = weights[0]?.date ?? null; }
    } else if (r.kind === 'not_shared') {
      // Décoché ailleurs (autre appareil) : l'état se relit
      if (coachShare.state) delete coachShare.state.shares.weight;
    }
    notifyCoach();
    return r;
  })();
  try { return await coachShare.upload; } finally { coachShare.upload = null; }
}

// Une pesée vient d'être saisie ou effacée sur cet appareil (geste ici : la liste de l'appareil part)
function coachShareWeightsChanged() {
  if (account.user && coachShareOn('weight')) coachShareUpload({ force: true });
}

// ── Coach : pesées d'un élève ───────────────────────────────

function coachWeightsOf(student) {
  return coachWeights[student] ||= { shared: false, since: null, weights: [], loading: false, error: null, loadedAt: 0 };
}
async function coachLoadWeights(student) {
  const f = coachWeightsOf(student);
  if (f.loading) return { ok: true };
  f.loading = true;
  const seq = coachShareSeq;
  const r = await coachRpc('coach_student_weights', { student });
  if (seq !== coachShareSeq) return { ok: false, kind: 'signed_out' };
  f.loading = false;
  if (!r.ok) { f.error = r.kind; notifyCoach(); return r; }
  Object.assign(f, cleanCoachWeights(r.data), { error: null, loadedAt: Date.now() });
  notifyCoach();
  return { ok: true };
}

// ── Déclencheurs ────────────────────────────────────────────

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id !== coachShare.userId) coachShareReset(id);
});
