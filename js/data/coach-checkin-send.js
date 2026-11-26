// ═══════════════════════════════════════════════════════════
//  Coach, dans l'app : demander un bilan à un élève (retours de Sophie, coach, 26/11/2026 : « pas d'action Envoyer un
//  bilan », elle l'avait écrit en commentaire de séance). Même fonction que l'appli web du coach : un modèle de bilan
//  (coach_checkin_setup), envoyé tout de suite (coach_checkin_send_now) ; l'élève le remplit dans son app
//  (js/features/checkin-ui.js). Contrat : docs/BILANS.md. Sans données d'écran ; écran : js/features/coach-checkin-send-ui.js.
//
//  - Mes modèles : ceux créés sur coach.mdlf.app ; sans modèle, les modèles fournis (CHECKIN_STARTERS, js/data/checkins.js)
//    sont enregistrés à la volée (coach_template_save) au moment de l'envoi, avec les suivis par défaut.
//  - Serveur sans les bilans (PGRST202) : available = false, l'action n'apparaît pas.
//  - Dernière demande de l'élève (coach_student_checkins, 3 au plus) : « Demandé le 24 nov., pas encore rempli ».
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_CK_MAX_AGE_MS = 60_000;
// available : null tant que rien n'est lu, false sans la migration des bilans
const coachCk = { userId: null, available: null, templates: null, loadedAt: 0, loading: false, students: {} };
let coachCkSeq = 0;

function coachCkReset(userId) {
  coachCkSeq++;
  Object.assign(coachCk, { userId, available: null, templates: null, loadedAt: 0, loading: false, students: {} });
}

// Modèles enregistrés, nettoyés : [{ id, name, items }]
function cleanCkTemplates(raw) {
  return (Array.isArray(raw?.templates) ? raw.templates : [])
    .filter(t => t && typeof t.id === 'string' && typeof t.name === 'string' && t.name.trim())
    .map(t => ({ id: t.id, name: t.name.trim().slice(0, CHECKIN_NAME_MAX), items: checkinItemsClean(t.items) }))
    .filter(t => t.items.length);
}
// Demandes d'un élève : [{ id, name, sentAt, answeredAt, cancelled }] du plus récent
function cleanCkRequests(raw) {
  const t = v => { const n = Date.parse(v); return Number.isFinite(n) ? n : null; };
  return (Array.isArray(raw) ? raw : []).filter(r => r && typeof r.id === 'string')
    .map(r => ({ id: r.id, name: String(r.name || 'Bilan').slice(0, CHECKIN_NAME_MAX), sentAt: t(r.sent_at), answeredAt: t(r.answered_at), cancelled: !!r.cancelled_at }))
    .filter(r => r.sentAt !== null).sort((a, b) => b.sentAt - a.sentAt);
}

async function coachCkSetupLoad({ minAge = COACH_CK_MAX_AGE_MS } = {}) {
  if (!account.user || coachCk.loading || coachCk.available === false) return coachCk.available === true;
  if (minAge && coachCk.templates && Date.now() - coachCk.loadedAt < minAge) return true;
  coachCk.loading = true;
  const seq = coachCkSeq;
  const r = await coachRpc('coach_checkin_setup');
  if (seq !== coachCkSeq) return false;
  coachCk.loading = false;
  if (r.ok) Object.assign(coachCk, { available: true, templates: cleanCkTemplates(r.data), loadedAt: Date.now() });
  else if (r.kind === 'missing') coachCk.available = false;
  notifyCoach();
  return r.ok;
}
async function coachCkStudentLoad(uid) {
  if (!account.user || coachCk.available === false) return false;
  const seq = coachCkSeq;
  const r = await coachRpc('coach_student_checkins', { student: uid, lim: 3 });
  if (seq !== coachCkSeq) return false;
  if (r.ok) coachCk.students[uid] = { list: cleanCkRequests(r.data), loadedAt: Date.now() };
  else if (r.kind === 'missing') coachCk.available = false;
  notifyCoach();
  return r.ok;
}
function coachCkLatest(uid) { return coachCk.students[uid]?.list?.find(r => !r.cancelled) || null; }

// Envoi à un élève. choice = { template: id } (un de mes modèles) ou { starter: i } (modèle fourni, enregistré d'abord).
// → { ok, sent } : sent = 0 quand une demande du même modèle est encore ouverte (le serveur ne la double pas)
async function coachCkSend(uid, choice) {
  let id = choice?.template || null;
  if (!id) {
    const s = CHECKIN_STARTERS[choice?.starter];
    if (!s) return { ok: false, kind: 'server' };
    const saved = await coachRpc('coach_template_save', { id: null, name: s.name, items: checkinStarterItems(s) });
    if (!saved.ok) return saved;
    id = saved.data?.id;
    if (typeof id !== 'string') return { ok: false, kind: 'server' };
    coachCk.templates = null;   // relu au prochain choix
  }
  const r = await coachRpc('coach_checkin_send_now', { template: id, students: [uid] });
  if (!r.ok) return r;
  await coachCkStudentLoad(uid);
  return { ok: true, sent: Number(r.data?.sent) || 0 };
}

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id !== coachCk.userId) coachCkReset(id);
});
