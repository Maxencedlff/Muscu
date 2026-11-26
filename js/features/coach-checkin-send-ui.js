// ═══════════════════════════════════════════════════════════
//  Fiche d'un élève : « Envoyer un bilan » (retours de Sophie, coach, 26/11/2026). Un toucher ouvre le choix du bilan
//  (mes modèles, sinon les modèles fournis), un second l'envoie ; l'élève est prévenu et le remplit dans son app. Sous
//  l'action : la dernière demande et son état (« Demandé le 24 nov., pas encore rempli »). Les réponses se lisent sur
//  coach.mdlf.app (Bilans). Données : js/data/coach-checkin-send.js. Rien au pointerdown.
// ═══════════════════════════════════════════════════════════
'use strict';

function coachCkStateText(r) {
  if (!r) return '';
  return r.answeredAt
    ? `« ${r.name} » rempli le ${fmtDate(r.answeredAt, 'short')}. Réponses sur coach.mdlf.app, rubrique Bilans.`
    : `« ${r.name} » demandé le ${fmtDate(r.sentAt, 'short')}, pas encore rempli.`;
}

// Groupe de la fiche : seulement si le serveur a les bilans (lu à l'arrivée sur la fiche)
function coachCheckinSendHtml(uid) {
  if (coachCk.available !== true) return '';
  const last = coachCkLatest(uid);
  return `
        <div class="group">
          <button class="cell cell--action" data-action="coach-ck-send" data-uid="${esc(uid)}">${icon('doc.text', 20)}<span>Envoyer un bilan</span></button>
        </div>
        <div class="group-foot">${esc(last ? coachCkStateText(last) : `${personName(coachStudent(uid))} le remplit dans son app : poids, ressenti, photos selon le bilan choisi.`)}</div>`;
}

// Arrivée sur la fiche : modèles et dernières demandes
function coachCheckinSendEnter(uid) {
  coachCkSetupLoad().then(ok => { if (ok) coachCkStudentLoad(uid); });
}

registerActions({
  'coach-ck-send': async (e, el) => {
    const uid = el.dataset.uid, who = personName(coachStudent(uid));
    if (!coachCk.templates) await coachCkSetupLoad({ minAge: 0 });
    const mine = coachCk.templates || [];
    const minutes = items => `environ ${plural(checkinMinutes(items), 'minute', 'minutes')}`;
    const actions = mine.length
      ? mine.map(t => ({ label: `${t.name} (${minutes(t.items)})`, value: { template: t.id } }))
      : CHECKIN_STARTERS.map((s, i) => ({ label: `${s.name} (${minutes(checkinStarterItems(s, () => 0))})`, value: { starter: i } }));
    const choice = await dialog({ type: 'sheet', title: `Envoyer un bilan à ${who}`,
      message: mine.length ? 'Choisis un de tes bilans.' : 'Choisis un bilan. Tu pourras créer les tiens sur coach.mdlf.app.',
      actions: [...actions, { label: 'Annuler', style: 'cancel' }] });
    if (!choice) return;
    el.disabled = true;
    const r = await coachCkSend(uid, choice);
    el.disabled = false;
    if (!r.ok) { coachToast(r); return; }
    haptic();
    showToast(r.sent ? `Bilan envoyé à ${who}` : `${who} a déjà ce bilan à remplir`);
    render();
  },
});
