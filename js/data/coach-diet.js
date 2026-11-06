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
  return coachRpc('coach_send_programme', { student, prog_id: progId, data: payload });
}

// Mes plans que je peux envoyer : les miens (pas ceux reçus d'un coach), non archivés, avec au moins un aliment
function coachSendableDiets(d = data) {
  return dietPlanIds(d).filter(id => !d.dietPlans[id].fromCoach && d.dietPlans[id].meals.some(m => m.items.length));
}

// Coach : plans envoyés à cet élève, d'après coach_state ({ id, sentAt, seen, name })
function coachDietSentStatus(student, d = data) {
  const st = coach.state?.students.find(s => s.user_id === student);
  const mine = Object.keys(d.dietPlans || {});
  return (st?.sent || []).filter(x => isDietSentId(x.id)).sort((a, b) => b.sentAt - a.sentAt).map(x => {
    const id = mine.find(k => dietSentId(k) === x.id);
    return { ...x, planId: id || null, name: id && !d.dietPlans[id].archived ? d.dietPlans[id].name : 'Plan supprimé' };
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
  d.dietCoachConsent = { on: !!on, at: new Date().toISOString() };
  return { ok: true, serverless: dietCoachServerless };
}
