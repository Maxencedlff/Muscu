// ═══════════════════════════════════════════════════════════
//  Plan diète envoyé par le coach (Nutrition V1, docs/NUTRITION_V1.md « Coach ») : appels et état, sans affichage
//
//  - Même canal que les programmes, sans migration : coach_send_programme(student, 'diet_<plan>', data) avec
//    data = { kind: 'diet', v: 1, diet } (dietToSent, js/data/nutrition.js). Le serveur ne regarde que la
//    forme (objet JSON, 200 Ko au plus) ; la boîte de l'élève (student_inbox) le rend avec les programmes et
//    cleanInbox le range dans inbox.diets. « Vu » : student_mark_seen('programme', id), comme un programme.
//  - Une app d'avant la nutrition ne le montre pas : sans « name » au premier niveau, cleanSentProgramme
//    l'écarte. Seule trace chez elle : le badge « Mon coach » compte l'envoi tant qu'il n'est pas vu.
// ═══════════════════════════════════════════════════════════
'use strict';

// Coach : envoie un de mes plans à un élève (nouvel envoi du même plan = mise à jour chez lui)
async function coachSendDiet(student, planId) {
  const plan = data.dietPlans?.[planId];
  if (!plan || plan.archived || plan.fromCoach) return { ok: false, kind: 'server' };
  const payload = dietToSent(plan);
  if (!payload || !payload.diet.meals.some(m => m.items.length)) return { ok: false, kind: 'empty_diet' };
  if (sentProgrammeBytes(payload) > COACH_PROG_BYTES) return { ok: false, kind: 'too_big' };
  const progId = dietSentId(planId);
  if (!COACH_PROG_ID_RE.test(progId)) return { ok: false, kind: 'server' };
  const r = await coachRpc('coach_send_programme', { student, prog_id: progId, data: payload });
  // Nom envoyé gardé sur l'appareil (coach_state ne renvoie que l'identifiant) : la ligne de l'envoi garde ce nom
  // même si je supprime ou renomme mon plan ensuite
  if (r?.ok) coachRecordSent(student, progId, Date.now(), payload.diet.name);
  return r;
}

// Mes plans que je peux envoyer : les miens (pas ceux reçus d'un coach), non archivés, avec au moins un aliment
function coachSendableDiets(d = data) {
  return dietPlanIds(d).filter(id => !d.dietPlans[id].fromCoach && d.dietPlans[id].meals.some(m => m.items.length));
}

// Coach : plans envoyés à cet élève, d'après coach_state ({ id, sentAt, seen }) : { …, planId, name, gone }.
// Nom : celui de mon plan s'il existe encore, sinon celui gardé à l'envoi (coachRecordSent) ; gone : le plan n'est
// plus dans mes plans (dit en complément discret, l'élève garde le sien)
function coachDietSentStatus(student, d = data) {
  const st = coach.state?.students.find(s => s.user_id === student);
  const mine = Object.keys(d.dietPlans || {});
  const kept = coachSentMap()[student] || {};
  return (st?.sent || []).filter(x => isDietSentId(x.id)).sort((a, b) => b.sentAt - a.sentAt).map(x => {
    const id = mine.find(k => dietSentId(k) === x.id && !d.dietPlans[k].archived);
    const name = id ? d.dietPlans[id].name : sentEntry(kept[x.id]).name || 'Plan diète';
    return { ...x, planId: id || null, name, gone: !id };
  });
}

// Élève : plans reçus de mon coach, du plus récent ; état d'un envoi (new, update, current)
function dietInbox() { return coach.inbox?.diets || []; }
function dietInboxStatus(item, d = data) { return dietReceivedStatus(d, item, myCoach()?.user_id || null); }
// Envoi à proposer (accueil, écran Nutrition) : pas encore vu, et pas déjà pris dans cette version
function dietPending(d = data) {
  return dietInbox().find(x => !x.seen && dietInboxStatus(x, d).status !== 'current') || null;
}

// ── Élève : accord pour recevoir les plans diète de son coach (migration 20261106200000) ──
// Serveur à jour : l'accord est student_set_share('diet') (coach_shares, daté, retiré = plans effacés du
// serveur par déclencheur). Serveur d'avant (invalid_kind ou fonction absente) : accord gardé sur l'appareil
// (data.dietCoachConsent = { on, at }, SYNC_LOCAL_ONLY), seul garde-fou possible côté app.
let dietCoachServerless = false;   // le serveur ne connaît pas encore l'accord 'diet' (réponse invalid_kind)
function dietCoachAccepted(d = data) {
  // Le serveur annonce les données qu'il accepte (student_shares().kinds) : sans 'diet', il est d'avant
  const server = coachShare.state && !dietCoachServerless && (coachShare.state.kinds || []).includes('diet');
  if (server) return coachShareOn('diet');
  return d.dietCoachConsent?.on === true;
}
async function dietCoachSetAccept(on, d = data) {
  const r = await coachShareSet('diet', !!on);
  if (!r.ok && (r.kind === 'invalid_kind' || r.kind === 'missing')) dietCoachServerless = true;
  else if (!r.ok) return r;
  // local : accord donné quand le serveur ne le connaissait pas, à reposer sur le serveur une fois migré
  d.dietCoachConsent = { on: !!on, at: new Date().toISOString(), ...(dietCoachServerless ? { local: true } : {}) };
  return { ok: true, serverless: dietCoachServerless };
}
// Appelé après chaque student_shares() relu (coachShareRefresh). Premier serveur qui annonce 'diet' : l'accord
// donné sur cet appareil avant la migration (local) y est reposé, sinon les envois du coach seraient refusés
// alors que l'élève a dit oui. Une seule fois : ensuite le serveur fait foi (un retrait fait sur un autre
// appareil n'est jamais annulé par l'accord resté ici).
async function dietCoachCarryOver(d = data) {
  const c = d.dietCoachConsent, st = coachShare.state;
  if (!st || !(st.kinds || []).includes('diet')) return false;
  dietCoachServerless = false;
  if (!c?.local) return false;
  if (c.on && !coachShareOn('diet')) {
    const r = await coachShareSet('diet', true);
    if (!r.ok) return false;   // retenté à la prochaine relecture
  }
  d.dietCoachConsent = { on: c.on, at: c.at };
  save(true);
  return c.on;
}
