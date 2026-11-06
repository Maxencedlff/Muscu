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
//  - Mensurations (05/11/2026, docs/COACH_SUIVI.md « Bilan ») : même modèle, une case de plus
//    (student_share_measures, data.bodyMeasures), montrée seulement si le serveur l'accepte
//    (student_shares().kinds, migration 20261105010000_partage_mensurations.sql). Jamais les photos.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_SHARE_KEY = 'mdlf_coach_share';   // { userId, coachId, hash } : dernier envoi des pesées de cet appareil (hash null : en attente)
const COACH_SHARE_M_KEY = 'mdlf_coach_share_m';   // même chose pour les mensurations
const COACH_SHARE_MAX = 400;                  // pesées envoyées au plus (comme le serveur et BODY_LOG_MAX)
// Données que l'élève peut partager ; open : affichée et acceptée par le serveur (private.share_kind_open)
const COACH_SHARE_KINDS = [
  { kind: 'weight',     label: 'Poids du corps', open: true },
  { kind: 'sleep',      label: 'Sommeil', open: false },
  { kind: 'steps',      label: 'Pas', open: false },
  { kind: 'resting_hr', label: 'Fréquence cardiaque au repos', open: false },
  { kind: 'measures',   label: 'Mensurations', open: true },
];
const COACH_SHARE_KIND_IDS = COACH_SHARE_KINDS.map(k => k.kind);
// Bornes de date du serveur (student_share_weights, student_share_measures) : après le 1er janvier 2000,
// au plus 24 h dans le futur. Une valeur hors bornes ferait refuser TOUT l'envoi : elle ne part pas.
const SHARE_DATE_MIN = 946684800000;
const shareDateOk = (d, now = Date.now()) => Number.isFinite(d) && d > SHARE_DATE_MIN && d <= now + 86_400_000;

// Élève : { state: { shares, kinds } | null, loading, error, busy: kind en cours de changement, uploads: envois en
// cours par donnée, again: envoi demandé pendant un autre (par donnée : 'force' pour un geste, 'auto' sinon) }
const coachShare = { userId: null, state: null, loading: false, error: null, busy: null, uploads: {}, again: {} };
let coachShareSeq = 0;   // +1 au changement de compte : une réponse arrivée après n'écrit plus rien
// Coach : pesées partagées par élève { [uid]: { shared, since, weights, loading, error, loadedAt } }
const coachWeights = {};
// Coach : mensurations partagées par élève { [uid]: { shared, since, measures, loading, error, loadedAt, missing } }
const coachMeasures = {};

// ── Logique pure ────────────────────────────────────────────

// Données affichées : ouvertes dans l'app ET acceptées par le serveur (kinds de student_shares ; un
// serveur d'avant les mensurations ne l'envoie pas : le poids seul)
function coachShareKindsShown() {
  const server = coachShare.state?.kinds || ['weight'];
  return COACH_SHARE_KINDS.filter(k => k.open && server.includes(k.kind));
}

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
  const kinds = Array.isArray(r.kinds) ? COACH_SHARE_KIND_IDS.filter(k => r.kinds.includes(k)) : ['weight'];
  return { coach: r.coach === true, shares, kinds };
}

// Pesées envoyées : celles saisies dans l'app seulement (bodyWeightLog), nettoyées comme sur l'appareil,
// du plus récent au plus ancien, kg à 2 décimales. Date ramenée au début du jour (heure locale) : le coach
// n'a pas besoin de l'heure de la pesée (minimisation) ; une par jour, comme bodyWeightLog. Rien d'autre de data.
function sharedWeightsPayload(d = data) {
  return cleanBodyWeightLog(d?.bodyWeightLog)
    .map(p => ({ date: new Date(p.date).setHours(0, 0, 0, 0), kg: Math.round(p.kg * 100) / 100 }))
    .filter(p => shareDateOk(p.date)).slice(0, COACH_SHARE_MAX);
}

// Mensurations envoyées : data.bodyMeasures nettoyé (js/data/body-measures.js), date ramenée au début du
// jour, { clé: [{ date, cm }] } du plus récent au plus ancien ; mesures sans valeur absentes. Rien d'autre.
function sharedMeasuresPayload(d = data) {
  const clean = cleanBodyMeasures(d?.bodyMeasures);
  const out = {};
  for (const key of BODY_MEASURE_KEYS) {
    const l = (clean[key] || []).map(p => ({ date: new Date(p.date).setHours(0, 0, 0, 0), cm: p.cm }))
      .filter(p => shareDateOk(p.date)).slice(0, BODY_MEASURE_MAX);
    if (l.length) out[key] = l;
  }
  return out;
}
const measuresCount = m => Object.values(m).reduce((a, l) => a + l.length, 0);
const measuresLast = m => Math.max(0, ...Object.values(m).map(l => l[0]?.date || 0)) || null;

// coach_student_measures() nettoyé : { shared, since, measures: { clé: [{ date, cm }] } } du plus récent
function cleanCoachMeasures(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const shared = r.shared === true;
  const src = shared && r.measures && typeof r.measures === 'object' && !Array.isArray(r.measures) ? r.measures : {};
  const measures = {};
  for (const key of BODY_MEASURE_KEYS) {
    if (!Array.isArray(src[key])) continue;
    const l = src[key].slice(0, BODY_MEASURE_MAX).map(w => ({ date: Number(w?.date), cm: Number(w?.cm) }))
      .filter(w => Number.isFinite(w.date) && w.date > 0 && Number.isFinite(w.cm) && w.cm >= BODY_CM_MIN && w.cm <= BODY_CM_MAX)
      .sort((a, b) => b.date - a.date);
    if (l.length) measures[key] = l;
  }
  return { shared, since: shared ? coachTime(r.since) : null, measures };
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
// Résumé pour la cellule des Réglages : « Poids du corps », « Poids du corps, Mensurations », « Rien » ;
// null tant que l'état n'est pas lu
function coachShareSummary() {
  if (!coachShare.state) return null;
  const on = coachShareKindsShown().filter(k => coachShareOn(k.kind)).map(k => k.label);
  return on.length ? on.join(', ') : 'Rien';
}

function coachShareReset(userId) {
  coachShareSeq++;
  Object.assign(coachShare, { userId, state: null, loading: false, error: null, busy: null, uploads: {}, again: {} });
  Object.keys(coachWeights).forEach(k => delete coachWeights[k]);
  Object.keys(coachMeasures).forEach(k => delete coachMeasures[k]);
}

// Ce qui part pour chaque donnée envoyée depuis l'appareil : clé de l'empreinte locale, fonction du
// serveur, nom de l'argument, liste de l'appareil
const SHARE_UPLOADS = {
  weight:   { key: COACH_SHARE_KEY, rpc: 'student_share_weights', arg: 'weights', payload: () => sharedWeightsPayload(),
    count: p => p.length, lastAt: p => p[0]?.date ?? null },
  measures: { key: COACH_SHARE_M_KEY, rpc: 'student_share_measures', arg: 'measures', payload: () => sharedMeasuresPayload(),
    count: measuresCount, lastAt: measuresLast },
};

function readShareSent(key = COACH_SHARE_KEY) {
  try { const c = JSON.parse(localStorage.getItem(key)); return c && c.userId === coachShare.userId ? c : null; }
  catch { return null; }
}
function writeShareSent(v, key = COACH_SHARE_KEY) {
  try { if (v) localStorage.setItem(key, JSON.stringify({ userId: coachShare.userId, ...v })); else localStorage.removeItem(key); }
  catch { /* facultatif : au pire, un envoi de plus */ }
}

// Relit ce que je partage (élève seulement), puis renvoie les pesées si elles ont changé
async function coachShareRefresh() {
  if (!account.user || !coachRole().hasCoach) {
    if (coachShare.state) { coachShare.state = null; writeShareSent(null); writeShareSent(null, COACH_SHARE_M_KEY); notifyCoach(); }
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
  await Promise.all([coachShareUpload(), coachShareUploadKind('measures')]);
  return true;
}

// Cocher ou décocher une donnée. Cocher le poids (ou les mensurations) envoie aussitôt la liste de l'appareil
async function coachShareSet(kind, on) {
  if (!coachShareKindsShown().some(k => k.kind === kind)) return { ok: false, kind: 'invalid_kind' };
  if (coachShare.busy) return { ok: false, kind: 'busy' };
  coachShare.busy = kind;
  notifyCoach();
  const seq = coachShareSeq;
  const r = await coachRpc('student_set_share', { kind, enabled: !!on });
  if (seq !== coachShareSeq) return { ok: false, kind: 'signed_out' };
  coachShare.busy = null;
  if (r.ok) {
    coachShare.state = cleanShareState(r.data);
    if (!on && SHARE_UPLOADS[kind]) writeShareSent(null, SHARE_UPLOADS[kind].key);   // tout est effacé côté serveur
  }
  notifyCoach();
  if (r.ok && on && SHARE_UPLOADS[kind]) {
    const u = await coachShareUploadKind(kind, { force: true });
    if (!u.ok) return { ok: true, uploadFailed: u.kind };
  }
  return r;
}

// Envoie les pesées si le poids est partagé et qu'elles ont changé depuis le dernier envoi de cet
// appareil. Hors ligne : retenté à la prochaine relecture.
// force : geste sur cet appareil (case cochée ici, pesée saisie ici) : la liste de l'appareil part.
// Sans geste (relecture) : seulement si cet appareil a déjà envoyé pour ce coach. Les pesées ne se
// synchronisent pas : un second appareil sans pesées n'écrase jamais, à la connexion, celles du premier.
// Même règle pour les mensurations (coachShareUploadKind('measures')).
function coachShareUpload(opts) { return coachShareUploadKind('weight', opts); }
async function coachShareUploadKind(kind, { force = false } = {}) {
  const u = SHARE_UPLOADS[kind];
  if (!u || !coachShareOn(kind)) return { ok: true, skipped: true };
  // Envoi déjà en cours : la liste a pu changer depuis son départ (pesée saisie pendant l'envoi) ; il est
  // refait à la fin, avec la liste du moment
  if (coachShare.uploads[kind]) {
    coachShare.again[kind] = force || coachShare.again[kind] === 'force' ? 'force' : 'auto';
    return coachShare.uploads[kind];
  }
  const coachId = myCoach()?.user_id || null;
  const list = u.payload();
  const hash = syncHash(list);
  const last = readShareSent(u.key);
  const mine = last && last.coachId === coachId;
  if (!force && (!mine || last.hash === hash)) return { ok: true, skipped: true };
  // Geste ici, premier envoi pour ce coach : marque « en attente » (hash null) posée avant l'envoi, pour
  // qu'un échec (hors ligne) soit retenté à la relecture (mine, et hash différent)
  if (!mine) writeShareSent({ coachId, hash: null }, u.key);
  const seq = coachShareSeq;
  coachShare.uploads[kind] = (async () => {
    const r = await coachRpc(u.rpc, { [u.arg]: list });
    if (seq !== coachShareSeq) return { ok: false, kind: 'signed_out' };
    if (r.ok) {
      writeShareSent({ coachId, hash }, u.key);
      const st = coachShare.state?.shares?.[kind];
      if (st) { st.n = Number.isInteger(r.data) ? r.data : u.count(list); st.lastAt = u.lastAt(list); }
    } else if (r.kind === 'not_shared') {
      // Décoché ailleurs (autre appareil) : l'état se relit
      if (coachShare.state) delete coachShare.state.shares[kind];
    }
    notifyCoach();
    return r;
  })();
  let r;
  try { r = await coachShare.uploads[kind]; } finally { coachShare.uploads[kind] = null; }
  const again = coachShare.again[kind];
  if (again && seq === coachShareSeq) {
    delete coachShare.again[kind];
    coachShareUploadKind(kind, { force: again === 'force' });
  }
  return r;
}

// Une pesée vient d'être saisie ou effacée sur cet appareil (geste ici : la liste de l'appareil part)
function coachShareWeightsChanged() {
  if (account.user && coachShareOn('weight')) coachShareUpload({ force: true });
}
// Une mensuration vient d'être saisie, effacée ou importée sur cet appareil
function coachShareMeasuresChanged() {
  if (account.user && coachShareOn('measures')) coachShareUploadKind('measures', { force: true });
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

// ── Coach : mensurations d'un élève ─────────────────────────

function coachMeasuresOf(student) {
  return coachMeasures[student] ||= { shared: false, since: null, measures: {}, loading: false, error: null, loadedAt: 0, missing: false, triedAt: 0 };
}
const COACH_MEASURES_RETRY_MS = 10 * 60_000;   // serveur sans les mensurations : nouvel essai après 10 min (migration appliquée entre-temps)
// Serveur sans les mensurations (PGRST202) : missing, rien ne s'affiche
async function coachLoadMeasures(student, now = Date.now()) {
  const f = coachMeasuresOf(student);
  if (f.loading || (f.missing && now - f.triedAt < COACH_MEASURES_RETRY_MS)) return { ok: true };
  f.triedAt = now;
  f.loading = true;
  const seq = coachShareSeq;
  const r = await coachRpc('coach_student_measures', { student });
  if (seq !== coachShareSeq) return { ok: false, kind: 'signed_out' };
  f.loading = false;
  if (!r.ok) { f.error = r.kind; f.missing = r.kind === 'missing'; notifyCoach(); return r; }
  Object.assign(f, cleanCoachMeasures(r.data), { error: null, loadedAt: Date.now(), missing: false });
  notifyCoach();
  return { ok: true };
}

// ── Déclencheurs ────────────────────────────────────────────

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id !== coachShare.userId) coachShareReset(id);
});
