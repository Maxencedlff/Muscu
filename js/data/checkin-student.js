// ═══════════════════════════════════════════════════════════
//  Bilans configurables, côté élève (docs/BILANS.md, « App iPhone (élève) ») : lecture des demandes, brouillon,
//  préremplissage, envoi. Aucun affichage (écran : js/features/checkin-ui.js). Logique partagée avec l'appli web du
//  coach : js/data/checkins.js (formes des suivis et des réponses, mêmes règles que le serveur).
//
//  - student_checkins() relu au démarrage, au retour au premier plan et à l'ouverture de Mon coach (chaque lecture
//    de coach_state réussie, js/data/coach.js, relance celle-ci : 60 s au plus près), à l'ouverture de l'écran du
//    bilan et quand le réseau revient. Dernière liste gardée sur l'appareil (CK_CACHE_KEY), pour la carte d'accueil
//    et l'écran hors ligne.
//  - Envoi idempotent : un seul appel à la fois par demande, rien si elle est déjà répondue ; la réponse est gardée
//    (CK_OUTBOX_KEY) AVANT l'appel : hors ligne, elle repart toute seule au retour du réseau. Le serveur est
//    idempotent lui aussi (déjà répondue : même date, rien de changé).
//  - Brouillon par compte et par demande (CK_DRAFT_KEY) : écrit à chaque réponse touchée, effacé à l'envoi et quand
//    la demande n'est plus ouverte.
//  - Déconnexion : liste, brouillons et envois en attente effacés de l'appareil (même règle que les caches du coach,
//    CROSS_USER_CACHE_KEYS de js/data/account.js : rien ne reste en clair sur un iPhone partagé).
//  - Cycle menstruel : jamais proposé si la tranche d'âge d'Apple est connue et autre que « 18 ans ou plus »
//    (currentAgeBand, js/data/age-range.js) ; ailleurs, accord explicite (student_checkin_cycle) et retrait.
//  - Serveur sans les bilans (PGRST202) : ck.available = false, rien ne s'affiche, nouvel essai après 10 min.
// ═══════════════════════════════════════════════════════════
'use strict';

const CK_CACHE_KEY  = 'mdlf_checkins';         // { userId, coachId, raw: réponse de student_checkins } : dernière liste lue
const CK_DRAFT_KEY  = 'mdlf_checkin_drafts';   // { userId, drafts: { [demande]: { answers, skipped: [clé], at } } }
const CK_OUTBOX_KEY = 'mdlf_checkin_outbox';   // { userId, items: { [demande]: { answers, at } } } : envois en attente du réseau
const CK_SENT_KEY   = 'mdlf_checkin_sent';     // { userId, items: { [demande]: { answers, at } } } : mes 5 derniers envois (récapitulatif : le serveur ne rend pas les réponses à l'élève)
const CK_REFRESH_MS = 60_000;                  // relecture au plus toutes les minutes (premier plan, Mon coach)
const CK_RETRY_MS   = 10 * 60_000;             // serveur sans les bilans : nouvel essai après 10 min
const CK_DRAFT_MAX  = 10;                      // brouillons gardés (les plus récents)
const CK_PERIOD_MIN = 7, CK_PERIOD_MAX = 31;   // jours couverts par un bilan (auto : of ≤ 31)
const CK_ERRORS = ['invalid_answer', 'already_answered', 'closed', 'no_consent', 'not_adult', 'not_found', 'rate_limited', 'too_long'];

// available : null tant que rien n'est lu, false si le serveur n'a pas les bilans. cycle : accord donné ;
// cycleAsked : un bilan ouvert du coach contient le suivi du cycle (champ facultatif du serveur, voir docs/BILANS.md)
const ck = { userId: null, coachId: null, available: null, requests: [], cycle: false, cycleAsked: false, loading: false, again: false,
  error: null, loadedAt: 0, triedAt: 0, coachSeenAt: 0, sending: new Set(), health: null };
let ckSeq = 0;   // +1 au changement de compte : une réponse arrivée après n'écrit plus rien
const ckListeners = [];
function onCheckinChange(fn) { ckListeners.push(fn); }
function notifyCheckins() { for (const fn of ckListeners) { try { fn(); } catch { /* écran absent */ } } }

// ── Logique pure ────────────────────────────────────────────

// student_checkins() → { requests, cycle, cycleAsked }
function cleanStudentCheckins(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const requests = (Array.isArray(r.requests) ? r.requests : []).slice(0, 50).map(cleanCheckinRequest).filter(Boolean);
  return { requests, cycle: r.cycle?.consented === true, cycleAsked: r.cycle?.asked === true };
}

// Tranche d'âge d'Apple connue et autre que « 18 ans ou plus » : le cycle n'est jamais proposé (comme les photos)
function checkinCycleBlocked() { return typeof currentAgeBand === 'function' && currentAgeBand() !== null && currentAgeBand() !== 'adult'; }

// Suivis montrés à l'élève : ceux du bilan, sans le cycle tant qu'il n'y a pas d'accord (ou si l'âge l'interdit)
function checkinItemsShown(req, consent = ck.cycle) {
  return (req?.items || []).filter(it => it.kind !== 'cycle' || (consent && !checkinCycleBlocked()));
}

// Jours couverts : les N jours qui finissent le jour de l'envoi (inclus). N : l'écart avec le bilan précédent du même
// nom (7 à 31 jours), 7 sans bilan précédent. → { from, to (ms, début du jour suivant), days, keys: ['AAAA-MM-JJ'] }
function checkinPeriod(req, list = ck.requests) {
  const sent = req?.sentAt || Date.now();
  const prev = (list || []).filter(r => r.id !== req?.id && r.name === req?.name && r.sentAt && r.sentAt < sent).sort((a, b) => b.sentAt - a.sentAt)[0];
  const gap = prev ? daysAgo(prev.sentAt, sent) : CK_PERIOD_MIN;
  const days = Math.min(CK_PERIOD_MAX, Math.max(CK_PERIOD_MIN, gap));
  const end = new Date(sent); end.setHours(0, 0, 0, 0);
  const to = addDays(end.getTime(), 1), from = addDays(end.getTime(), -(days - 1));
  const keys = Array.from({ length: days }, (_, i) => localISO(addDays(from, i) + 12 * 3600e3));
  return { from, to, days, keys };
}

// Numéro de semaine ISO 8601 du jour donné (lundi premier jour, semaine du premier jeudi)
function checkinIsoWeek(ts) {
  const d = new Date(ts); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4, 12);
  return 1 + Math.round(((d - jan4) / 86400e3 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}
// « Semaine 47 » quand la période est une semaine du calendrier (lundi à dimanche), sinon « Du 18 au 24 nov. » : le
// numéro ne ment jamais sur les jours comptés (séances, diète)
function checkinPeriodText(req, list = ck.requests) {
  const p = checkinPeriod(req, list);
  if (p.days === 7 && new Date(p.from).getDay() === 1) return `Semaine ${checkinIsoWeek(p.from + 12 * 3600e3)}`;
  const last = p.to - 12 * 3600e3, a = new Date(p.from), b = new Date(last);
  const first = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear() ? (a.getDate() === 1 ? '1er' : String(a.getDate())) : fmtDate(p.from, 'short');
  return `Du ${first} au ${fmtDate(last, 'short')}`;
}
// « à rendre mardi », « à rendre aujourd'hui », « à rendre le 3 déc. », « en retard depuis hier »
function checkinDueText(req, now = Date.now()) {
  if (!req?.dueAt) return '';
  const n = daysAgo(now, req.dueAt);   // jours restants (calendrier)
  if (n < 0) return n === -1 ? 'en retard depuis hier' : `en retard depuis le ${fmtDate(req.dueAt, 'short')}`;
  if (n === 0) return req.dueAt < now ? 'en retard depuis aujourd\'hui' : 'à rendre aujourd\'hui';
  if (n === 1) return 'à rendre demain';
  if (n < 7) return `à rendre ${CHECKIN_WEEKDAYS[new Date(req.dueAt).getDay()]}`;
  return `à rendre le ${fmtDate(req.dueAt, 'short')}`;
}

// Séances prévues sur la période : objectif de la semaine (réglé, sinon séances du programme) au prorata des jours
function checkinPlanned(days, goal) {
  const g = Number.isFinite(goal) && goal > 0 ? goal : 3;
  return Math.min(31, Math.max(1, Math.round(g * days / 7)));
}

// Ce que l'app sait déjà pour un bilan (contexte de checkinPrefill, js/data/checkins.js). goal : séances par semaine
// (weeklyGoal de l'accueil) ; health : résumé de Santé pour la période de CE bilan (checkinReadHealth), ou null
function checkinContext(req, { d = data, list = ck.requests, goal = typeof weeklyGoal === 'function' ? weeklyGoal() : 3, health = ck.health?.id === req?.id && checkinHealthAllowed() ? ck.health : null, now = Date.now() } = {}) {
  const p = checkinPeriod(req, list);
  const today = localISO(now);
  const diet = p.keys.filter(k => k <= today).map(day => {
    const x = typeof dietShareDay === 'function' ? dietShareDay(d, day, today) : null;
    return { day, status: x ? dietShareStatus(x) : 'none' };
  });
  return {
    weights: sharedWeightsPayload(d),
    measures: sharedMeasuresPayload(d),
    // Rien de noté de toute la période (pas de plan diète) : pas de préremplissage (« 0 jour sur 7 » serait faux)
    dietDays: diet.some(x => x.status !== 'none') ? diet : [],
    sessions: (d?.history || []).filter(h => Number.isFinite(h?.date) && h.date >= p.from && h.date < p.to).length,
    planned: checkinPlanned(p.days, goal),
    steps: Number.isFinite(health?.steps) ? health.steps : null,
    sleepH: Number.isFinite(health?.sleepH) ? health.sleepH : null,
    cardioMin: Number.isFinite(health?.cardioMin) ? health.cardioMin : null,
  };
}

// Réponses de départ d'un bilan : le brouillon d'abord (ce que l'élève a touché), sinon ce que l'app sait.
// → { answers, skipped: Set, from: { clé: source du préremplissage } }
function checkinStart(req, ctx = null) {
  const items = checkinItemsShown(req);
  const pre = checkinPrefill(items, ctx || checkinContext(req));
  const dr = checkinDraft(req.id);
  const answers = { ...pre.values, ...(dr?.answers || {}) };
  const skipped = new Set((dr?.skipped || []).filter(k => items.some(it => it.key === k && !it.required)));
  skipped.forEach(k => { delete answers[k]; });
  const from = {};
  for (const [k, v] of Object.entries(pre.from)) if (!dr?.answers || !Object.hasOwn(dr.answers, k) || JSON.stringify(dr.answers[k]) === JSON.stringify(pre.values[k])) from[k] = v;
  return { answers, skipped, from };
}

// ── Stockage sur l'appareil (par compte) ────────────────────

function ckRead(key, field) {
  try { const c = JSON.parse(localStorage.getItem(key)); return c && c.userId && c.userId === ck.userId && c[field] && typeof c[field] === 'object' ? c : null; }
  catch { return null; }
}
function ckWrite(key, field, value) {
  try {
    if (!ck.userId || !value || !Object.keys(value).length) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ userId: ck.userId, [field]: value }));
  } catch { /* facultatif : sans stockage, rien ne reste hors ligne */ }
}

function checkinDraft(id) { const d = ckRead(CK_DRAFT_KEY, 'drafts')?.drafts?.[id]; return d && typeof d === 'object' ? { answers: d.answers && typeof d.answers === 'object' ? d.answers : {}, skipped: Array.isArray(d.skipped) ? d.skipped : [], at: d.at || 0 } : null; }
function checkinDraftSave(id, { answers = {}, skipped = [] } = {}) {
  if (!ck.userId || !CHECKIN_UUID_RE.test(id || '')) return;
  const all = { ...(ckRead(CK_DRAFT_KEY, 'drafts')?.drafts || {}) };
  all[id] = { answers, skipped: [...skipped], at: Date.now() };
  const kept = Object.entries(all).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, CK_DRAFT_MAX);
  ckWrite(CK_DRAFT_KEY, 'drafts', Object.fromEntries(kept));
}
function checkinDraftClear(id) {
  const all = { ...(ckRead(CK_DRAFT_KEY, 'drafts')?.drafts || {}) };
  if (!Object.hasOwn(all, id)) return;
  delete all[id];
  ckWrite(CK_DRAFT_KEY, 'drafts', all);
}
// Brouillons des demandes qui ne sont plus ouvertes (répondues ailleurs, fermées) : retirés après une lecture réussie
function checkinDraftPrune() {
  const all = ckRead(CK_DRAFT_KEY, 'drafts')?.drafts;
  if (!all) return;
  const open = new Set(ck.requests.filter(r => !r.answeredAt && !r.cancelledAt).map(r => r.id));
  ckWrite(CK_DRAFT_KEY, 'drafts', Object.fromEntries(Object.entries(all).filter(([k]) => open.has(k))));
}

function checkinOutbox() { return ckRead(CK_OUTBOX_KEY, 'items')?.items || {}; }
function checkinQueued(id) { return Object.hasOwn(checkinOutbox(), id); }
function ckOutboxSet(id, answers) { ckWrite(CK_OUTBOX_KEY, 'items', { ...checkinOutbox(), [id]: { answers, at: Date.now() } }); }
function ckOutboxDrop(id) { const all = { ...checkinOutbox() }; delete all[id]; ckWrite(CK_OUTBOX_KEY, 'items', all); }

function ckWriteCache(raw) {
  try {
    if (!ck.userId || !raw) localStorage.removeItem(CK_CACHE_KEY);
    else localStorage.setItem(CK_CACHE_KEY, JSON.stringify({ userId: ck.userId, coachId: ck.coachId, raw }));
  } catch { /* facultatif */ }
}
function ckReadCache(userId) {
  try { const c = JSON.parse(localStorage.getItem(CK_CACHE_KEY)); return c && userId && c.userId === userId ? c : null; } catch { return null; }
}

function ckReset(userId) {
  ckSeq++;
  // Déconnexion : rien des bilans ne reste sur l'appareil (réponses de santé, nom et réponse du coach)
  if (!userId) { try { [CK_CACHE_KEY, CK_DRAFT_KEY, CK_OUTBOX_KEY, CK_SENT_KEY].forEach(k => localStorage.removeItem(k)); } catch { /* rien */ } }
  const c = ckReadCache(userId);
  const st = c ? cleanStudentCheckins(c.raw) : null;
  ck.userId = userId || null;
  if (st) ckMergeSent(st.requests);
  Object.assign(ck, { userId: userId || null, coachId: c?.coachId || null, available: st ? true : null, requests: st?.requests || [], cycle: !!st?.cycle,
    cycleAsked: !!st?.cycleAsked, loading: false, again: false, error: null, loadedAt: 0, triedAt: 0, coachSeenAt: 0, sending: new Set(), health: null });
}
// Plus de coach (quitté, retiré) : la liste et les brouillons partent
function ckForgetCoach() {
  if (!ck.requests.length && !ckReadCache(ck.userId)) return;
  ck.requests = []; ck.cycle = false; ck.cycleAsked = false; ck.coachId = null;
  ckWriteCache(null);
  ckWrite(CK_DRAFT_KEY, 'drafts', null);
  ckWrite(CK_OUTBOX_KEY, 'items', null);
  ckWrite(CK_SENT_KEY, 'items', null);
  notifyCheckins();
}

// ── Lecture ─────────────────────────────────────────────────

// Demandes de mon coach actuel (une liste gardée d'un ancien coach ne s'affiche pas)
function checkinList() {
  const cid = typeof myCoach === 'function' ? myCoach()?.user_id : null;
  if (!account.user || !cid || ck.available === false) return [];
  return ck.requests.filter(r => !r.coach || r.coach === cid);
}
function checkinById(id) { return checkinList().find(r => r.id === id) || null; }
// À remplir : ni répondues, ni fermées, ni en attente d'envoi ; la plus pressée d'abord
function checkinOpen() {
  return checkinList().filter(r => !r.answeredAt && !r.cancelledAt && !checkinQueued(r.id))
    .sort((a, b) => (a.dueAt || Infinity) - (b.dueAt || Infinity) || (a.sentAt || 0) - (b.sentAt || 0));
}
// 'open' | 'queued' | 'sent' | 'closed'
function checkinState(req) {
  if (!req) return 'closed';
  if (req.answeredAt) return 'sent';
  if (req.cancelledAt) return 'closed';
  return checkinQueued(req.id) ? 'queued' : 'open';
}

async function ckRpc(fn, args) {
  if (typeof sb === 'undefined' || !sb || !account.user) return { ok: false, kind: 'signed_out' };
  const seq = ckSeq;
  try {
    const { data: res, error } = await sb.rpc(fn, args);
    if (seq !== ckSeq) return { ok: false, kind: 'signed_out' };
    if (!error) return { ok: true, data: res };
    const msg = String(error.message || '');
    return { ok: false, kind: CK_ERRORS.find(k => msg.includes(k)) || coachErrorKind(error) };
  } catch (e) {
    return { ok: false, kind: coachErrorKind(e) || 'server' };
  }
}

// Relit les demandes (envois en attente d'abord). true si la liste a pu être lue. Demandée pendant une lecture :
// relancée à la fin
async function checkinRefresh({ minAge = 0, now = Date.now() } = {}) {
  if (!account.user || ck.userId !== account.user.id) return false;
  if (!coachRole().hasCoach) { if (coach.state && !coach.state.coach) ckForgetCoach(); return false; }
  if (ck.loading) { ck.again = true; return false; }
  if (ck.available === false && now - ck.triedAt < CK_RETRY_MS) return false;
  if (minAge && ck.loadedAt && now - ck.loadedAt < minAge) return true;
  ck.loading = true; ck.again = false; ck.triedAt = now;
  const seq = ckSeq;
  await checkinFlush();
  const r = seq === ckSeq ? await ckRpc('student_checkins') : { ok: false, kind: 'signed_out' };
  if (seq !== ckSeq) return false;
  ck.loading = false;
  if (!r.ok) {
    ck.error = r.kind;
    if (r.kind === 'missing') { ck.available = false; ck.requests = []; ckWriteCache(null); }
  } else {
    const st = cleanStudentCheckins(r.data);
    ckMergeSent(st.requests);
    Object.assign(ck, { available: true, error: null, loadedAt: Date.now(), requests: st.requests, cycle: st.cycle, cycleAsked: st.cycleAsked,
      coachId: myCoach()?.user_id || null });
    ckWriteCache(r.data);
    checkinDraftPrune();
    // Envoyée ici puis répondue sur le serveur : plus rien en attente pour elle
    Object.keys(checkinOutbox()).forEach(id => { if (!ck.requests.some(x => x.id === id && !x.answeredAt && !x.cancelledAt)) ckOutboxDrop(id); });
  }
  notifyCheckins();
  if (ck.again) { ck.again = false; return checkinRefresh(); }
  return r.ok;
}

// Pas, sommeil et cardio de la période du bilan, lus dans Santé (js/data/health-days.js), seulement si l'élève a coché
// « Pas, sommeil et cardio » pour son coach (audit du 25/11, B2 : c'est l'accord qu'il a donné, et le texte d'accès à
// Santé de la build ne promet rien d'autre) et si la coquille sait les lire (build du 25/11/2026). Ne demande jamais
// l'autorisation. Sans la case : à la main. Gardé en mémoire pour CE bilan (ck.health), jamais sur l'appareil.
const checkinHealthAllowed = () => typeof coachShareOn === 'function' && coachShareOn('health');
// → { id, steps, sleepH, sleepMin, cardioMin, stepDays, nights } ou null
async function checkinReadHealth(req, { now = Date.now() } = {}) {
  if (!req || typeof healthDaysRead !== 'function' || !checkinHealthAllowed()) { ck.health = null; return null; }
  const list = await healthDaysRead({ now });
  if (!list) return null;
  const today = localISO(now);
  const sum = healthPeriodSummary(list, checkinPeriod(req).keys.filter(k => k <= today));
  ck.health = { id: req.id, ...sum };
  return ck.health;
}

// ── Envoi ───────────────────────────────────────────────────

// Réponses de mes derniers envois, remises sur les demandes répondues (récapitulatif de l'écran « Envoyé »)
function ckMergeSent(list) {
  const sent = ckRead(CK_SENT_KEY, 'items')?.items || {};
  for (const r of list) if (r.answeredAt && !Object.keys(r.answers || {}).length && sent[r.id]?.answers) r.answers = checkinAnswersClean(r.items, sent[r.id].answers).answers;
}
function ckMarkAnswered(id, answers, at) {
  const r = ck.requests.find(x => x.id === id);
  if (r) { r.answeredAt = at; r.answers = answers; }
  const sent = { ...(ckRead(CK_SENT_KEY, 'items')?.items || {}), [id]: { answers, at } };
  ckWrite(CK_SENT_KEY, 'items', Object.fromEntries(Object.entries(sent).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 5)));
  ckOutboxDrop(id);
  checkinDraftClear(id);
}
// Un appel au serveur pour une réponse gardée. offline : elle reste en attente
async function ckSendNow(id, answers) {
  const r = await ckRpc('student_checkin_answer', { request: id, answers });
  if (r.ok || r.kind === 'already_answered') {
    const at = checkinTs(r.data?.answered_at) || Date.now();
    ckMarkAnswered(id, answers, at);
    return { ok: true, at };
  }
  if (r.kind === 'offline' || r.kind === 'signed_out') return { ok: true, queued: true, kind: r.kind };
  ckOutboxDrop(id);   // refus du serveur (fermée, réponse refusée, pas d'accord) : l'élève corrige, le brouillon reste
  return { ok: false, kind: r.kind };
}

// Envoi d'un bilan. → { ok: true, at } (envoyé), { ok: true, queued: true } (gardé, part au retour du réseau),
// { ok: false, kind, missing? } (missing : clés des suivis obligatoires sans réponse ; busy : envoi déjà en cours)
async function checkinSend(id, raw, skipped = []) {
  const req = checkinById(id);
  if (!req) return { ok: false, kind: 'not_found' };
  if (req.answeredAt) return { ok: true, at: req.answeredAt };
  if (req.cancelledAt) return { ok: false, kind: 'closed' };
  if (checkinQueued(id)) return { ok: true, queued: true };
  if (ck.sending.has(id)) return { ok: false, kind: 'busy' };
  const items = checkinItemsShown(req);
  const src = { ...(raw || {}) };
  skipped.forEach(k => { const it = items.find(x => x.key === k); if (it && !it.required) delete src[k]; });
  const { answers, missing } = checkinAnswersClean(items, src);
  if (missing.length) return { ok: false, kind: 'missing', missing };
  ck.sending.add(id);
  notifyCheckins();
  const seq = ckSeq;
  ckOutboxSet(id, answers);   // gardée avant l'appel : une coupure pendant l'envoi ne perd rien
  let out;
  try { out = await ckSendNow(id, answers); } finally { if (seq === ckSeq) ck.sending.delete(id); }
  if (seq !== ckSeq) return { ok: false, kind: 'signed_out' };
  notifyCheckins();
  return out;
}

// Réponses en attente (hors ligne au moment d'envoyer) : renvoyées une à une
let ckFlushing = false;
async function checkinFlush() {
  if (ckFlushing || !account.user) return;
  const items = checkinOutbox();
  if (!Object.keys(items).length) return;
  ckFlushing = true;
  const seq = ckSeq;
  let changed = false;
  try {
    for (const [id, v] of Object.entries(items)) {
      if (seq !== ckSeq || ck.sending.has(id)) break;
      ck.sending.add(id);
      const r = await ckSendNow(id, v.answers);
      ck.sending.delete(id);
      if (r.queued) break;   // toujours hors ligne : la suite attendra aussi
      changed = true;
      if (!r.ok) ck.flushError = { id, kind: r.kind };
    }
  } finally { ckFlushing = false; }
  if (changed && seq === ckSeq) notifyCheckins();
}

// ── Cycle menstruel : accord explicite, retrait ─────────────

// accept : true avec « J'ai 18 ans ou plus » coché (adult) ; false : retrait (le serveur efface aussi toutes les
// réponses au cycle). → { ok } ou { ok: false, kind }
async function checkinCycleSet(accept, adult = false) {
  if (accept && checkinCycleBlocked()) return { ok: false, kind: 'not_adult' };
  if (accept && adult !== true) return { ok: false, kind: 'not_adult' };
  const r = await ckRpc('student_checkin_cycle', { accept: !!accept, adult: accept ? true : false });
  if (!r.ok) return r;
  ck.cycle = r.data?.consented === true;
  // Le suivi du cycle n'arrive dans les bilans qu'après l'accord : relu tout de suite
  await checkinRefresh();
  if (!ck.cycle) {
    // Retrait : plus aucune phase du cycle dans les brouillons
    const all = ckRead(CK_DRAFT_KEY, 'drafts')?.drafts || {};
    for (const [id, dr] of Object.entries(all)) {
      const req = ck.requests.find(x => x.id === id);
      (req?.items || []).filter(it => it.kind === 'cycle').forEach(it => { delete dr.answers?.[it.key]; });
    }
    ckWrite(CK_DRAFT_KEY, 'drafts', all);
  }
  notifyCheckins();
  return { ok: true, consented: ck.cycle };
}

// ── Déclencheurs ────────────────────────────────────────────

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id === ck.userId) return;
  ckReset(id);
  notifyCheckins();
  if (id && coachRole().hasCoach) checkinRefresh();
});
// Chaque lecture réussie de coach_state (démarrage, premier plan, Mon coach, notification reçue) : relecture des
// bilans, une minute au plus près ; plus de coach : tout part
if (typeof onCoachChange === 'function') {
  onCoachChange(() => {
    if (!account.user || coach.loadedAt === ck.coachSeenAt) return;
    ck.coachSeenAt = coach.loadedAt;
    if (coach.state && !coach.state.coach) { ckForgetCoach(); return; }
    checkinRefresh({ minAge: CK_REFRESH_MS });
  });
}
window.addEventListener?.('online', () => { if (account.user && coachRole().hasCoach) checkinRefresh(); });
