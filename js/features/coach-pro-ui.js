// ═══════════════════════════════════════════════════════════
//  Rôle coach (tarifs du 30/10/2026), écrans. Données et appels : js/data/coach-pro.js.
//
//  - « Devenir coach » (`coach-request`) : une DEMANDE, pas un achat. Nom tel qu'il figure sur la carte
//    professionnelle, numéro de la carte, diplôme ; statut « En vérification », « Refusée »
//    (avec le motif) ou « Validée ». L'administrateur vérifie la carte sur le site du ministère des
//    Sports. Les abonnements coach n'apparaissent qu'une fois le rôle validé.
//  - Réglages › Coach (renderCoachProGroup, appelée par js/features/coach-ui.js) : pas encore coach,
//    l'entrée de la demande ; coach validé, son code permanent (à partager) et son palier.
//  - Palier plein (coachTierBannerHtml) : « 10 élèves sur 10 : passe au palier supérieur », mène à
//    l'onglet Coach de l'abonnement avec le palier suivant mis en avant.
//  Tout texte venu du serveur passe par esc(). Rien au pointerdown : actions au clic seulement.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_REQUEST_INTRO = 'Le rôle coach est réservé aux éducateurs sportifs diplômés titulaires d\'une carte professionnelle. On vérifie ta carte sur le site du ministère des Sports, sous 48 h.';
const COACH_REQUEST_STATUS_TEXT = {
  pending: 'En vérification', approved: 'Validée', rejected: 'Refusée', revoked: 'Rôle retiré',
};
let coachRequestEditing = false;   // demande en attente ou refusée : formulaire rouvert pour la corriger
let coachRequestBusy = false;

// ── Bandeau du palier plein ─────────────────────────────────

function coachTierBannerHtml() {
  const txt = coachTierFullText(coachPro.tier);
  if (!txt || !paywallOn()) return '';
  const next = coachPro.tier.next_product || planId(planTierFor(coachPro.tier.students + 1).key, 'month');
  return `
        <button class="pay-banner pay-banner--off coach-tier-banner" data-action="pay-open" data-reason="offer" data-tab="coach" data-id="${esc(next)}">
          <span class="pay-banner__text">${esc(txt)}</span>
          <span class="pay-banner__more">Voir ${icon('chevron.right', 12)}</span>
        </button>`;
}

// ── Réglages › Coach : demande, code permanent, palier ──────

function renderCoachProGroup() {
  if (!account.user) return '';
  if (!coachRole().isCoach) {
    const st = coachPro.request?.status;
    const value = COACH_REQUEST_STATUS_TEXT[st] && st !== 'approved' ? COACH_REQUEST_STATUS_TEXT[st] : '';
    return `
        <div class="group-title">Tu es coach ?</div>
        <div class="group">
          <button class="cell cell--nav" data-action="coach-request-open">
            <span class="cell__body"><span class="cell__title">Devenir coach</span><span class="cell__sub">Pour les éducateurs sportifs diplômés</span></span>
            ${value ? `<span class="cell__value">${esc(value)}</span>` : ''}
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
  }
  const code = coachPro.code;
  const tier = coachPro.tier;
  const plan = planOf(tier?.product_id);
  const tierValue = !paywallOn() ? 'Tout est ouvert'
    : plan ? plan.tier.label : 'Sans abonnement coach';
  const count = !tier ? '' : !tier.students ? 'Aucun élève' : `${plural(tier.students, 'élève', 'élèves')}${tier.limit !== null && paywallOn() ? ` sur ${tier.limit}` : ''}`;
  return `${coachTierBannerHtml()}
        <div class="group-title">Ton code coach</div>
        <div class="group">
          ${code ? `<div class="cell coach-invite coach-code-cell">
            <span class="cell__body"><span class="cell__title coach-code num">${esc(formatCoachCode(code))}</span><span class="cell__sub">Ton code à toi, sans date de fin</span></span>
            <button class="coach-icon-btn" data-action="coach-share-invite" data-code="${esc(code)}" aria-label="Partager ton code coach">${icon('square.and.arrow.up', 20)}</button>
          </div>` : `<div class="cell"><span class="cell__sub">${coachPro.error ? esc(coachProErrorText(coachPro.error)) : 'Chargement…'}</span></div>`}
        </div>
        <div class="group-foot">Tes élèves le saisissent dans Amis › Rejoindre un coach.${paywallOn() ? ' Avec lui, leur abonnement est à 25 % de moins pendant 12 mois.' : ''}</div>
        <div class="group-title">Abonnement coach</div>
        <div class="group">
          <button class="cell cell--nav" data-action="pay-open" data-reason="offer" data-tab="coach">
            <span class="cell__body"><span class="cell__title">Formule</span>${count ? `<span class="cell__sub">${esc(count)}</span>` : ''}</span>
            <span class="cell__value">${esc(tierValue)}</span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

// ── Écran « Devenir coach » ─────────────────────────────────

function coachRequestFormHtml(req) {
  const keep = req && req.status !== 'none' ? req : null;
  const dip = keep?.diploma || '';
  const options = ['<option value="">Choisir</option>', ...COACH_DIPLOMAS.map(d => `<option value="${esc(d)}" ${d === dip ? 'selected' : ''}>${esc(d)}</option>`)].join('');
  return `
        <div class="group coach-req-form">
          <label class="cell coach-req-field">
            <span class="coach-req-field__label">Nom sur la carte</span>
            <input class="coach-req-field__input" id="coachReqName" type="text" autocomplete="name" autocapitalize="words" maxlength="80"
                   placeholder="Prénom Nom" value="${esc(keep?.card_name || '')}">
          </label>
          <label class="cell coach-req-field">
            <span class="coach-req-field__label">Numéro de carte</span>
            <input class="coach-req-field__input num" id="coachReqCard" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="30"
                   placeholder="Ex : 04912ED0123" value="${esc(keep?.card_number || '')}">
          </label>
          <label class="cell coach-req-field">
            <span class="coach-req-field__label">Diplôme</span>
            <select class="coach-req-field__input" id="coachReqDiploma" required>${options}</select>
          </label>
        </div>
        <p class="coach-req-error" id="coachReqError" role="alert" aria-live="polite"></p>
        <button class="btn btn--primary btn--full" data-action="coach-request-send" ${coachRequestBusy ? 'disabled' : ''}>${coachRequestBusy ? 'Envoi…' : keep ? 'Renvoyer ma demande' : 'Envoyer ma demande'}</button>
        <div class="group-foot coach-req-foot">Le numéro est sur ta carte professionnelle d'éducateur sportif. Ces informations servent seulement à vérifier ta carte : seul l'administrateur de MDLF Training les voit.</div>`;
}

function renderCoachRequest() {
  const head = navBar({ title: 'Devenir coach', large: false });
  if (!account.user) {
    return `<div class="view view--grouped coach-req-view">${head}<div class="scr">
        <div class="empty-note">Connecte-toi pour faire ta demande.</div></div></div>`;
  }
  const req = coachPro.request;
  const hero = `
        <div class="social-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">Devenir coach</h2>
          <p class="social-hero__sub">${COACH_REQUEST_INTRO}</p>
        </div>`;
  if (!req && coachPro.loading) return `<div class="view view--grouped coach-req-view">${head}<div class="scr">${hero}<div class="empty-note">Chargement…</div></div></div>`;
  if (!req && coachPro.error) {
    return `<div class="view view--grouped coach-req-view">${head}<div class="scr">${hero}${coachOfflineNote(coachPro.error, 'Pas d\'Internet. La demande se fait avec du réseau.')}</div></div>`;
  }
  if (coachRole().isCoach || req?.is_coach || req?.status === 'approved') {
    return `<div class="view view--grouped coach-req-view">${head}<div class="scr">${hero}
        <div class="group"><div class="cell"><span class="cell__body"><span class="cell__title">Demande</span></span><span class="cell__value">Validée</span></div></div>
        <div class="group-foot">Ton rôle coach est validé. Ton code et tes abonnements coach sont dans Réglages › Coach.</div>
        <button class="btn btn--primary btn--full" data-action="coach-open-settings">Voir mon espace coach</button>
      </div></div>`;
  }
  const st = req?.status || 'none';
  const status = st !== 'none' ? `
        <div class="group">
          <div class="cell"><span class="cell__body"><span class="cell__title">Demande</span></span><span class="cell__value">${esc(COACH_REQUEST_STATUS_TEXT[st] || '')}</span></div>
          ${req.created_at ? `<div class="cell"><span class="cell__body"><span class="cell__title">Envoyée le</span></span><span class="cell__value">${esc(fmtDate(req.created_at))}</span></div>` : ''}
        </div>
        ${(st === 'rejected' || st === 'revoked') && req.reason ? `<div class="group-foot coach-req-reason">Motif : ${esc(req.reason)}</div>` : ''}
        ${st === 'pending' ? '<div class="group-foot">On vérifie ta carte sur le site du ministère des Sports. Tu verras la réponse ici.</div>' : ''}` : '';
  const form = st === 'none' || coachRequestEditing ? coachRequestFormHtml(req)
    : `<div class="group"><button class="cell cell--action" data-action="coach-request-edit"><span class="cell__title">${st === 'pending' ? 'Corriger ma demande' : 'Faire une nouvelle demande'}</span></button></div>`;
  return `
    <div class="view view--grouped coach-req-view">
      ${head}
      <div class="scr">${hero}${status}${form}</div>
    </div>`;
}
SCREENS.set('coach-request', {
  render: () => renderCoachRequest(),
  enter: () => { coachRequestEditing = false; coachProRefresh(); },
});

// ── Actions ─────────────────────────────────────────────────

registerActions({
  'coach-request-edit': () => { coachRequestEditing = true; render(); },
  'coach-request-send': async (e, el) => {
    if (coachRequestBusy) return;
    const val = id => document.getElementById(id)?.value ?? '';
    const fields = { cardName: val('coachReqName'), cardNumber: val('coachReqCard'), diploma: val('coachReqDiploma') };
    const err = document.getElementById('coachReqError');
    coachRequestBusy = true;
    if (el) { el.disabled = true; el.textContent = 'Envoi…'; }
    let r;
    try { r = await coachRequestSubmit(fields); } finally { coachRequestBusy = false; }
    if (!r.ok) {
      if (el) { el.disabled = false; el.textContent = coachPro.request?.status && coachPro.request.status !== 'none' ? 'Renvoyer ma demande' : 'Envoyer ma demande'; }
      if (err) err.textContent = coachProErrorText(r.kind);
      const bad = { invalid_name: 'coachReqName', invalid_card: 'coachReqCard', invalid_diploma: 'coachReqDiploma' }[r.kind];
      document.querySelectorAll('.coach-req-field__input').forEach(i => i.removeAttribute('aria-invalid'));
      if (bad) document.getElementById(bad)?.setAttribute('aria-invalid', 'true');
      haptic('medium');
      return;
    }
    coachRequestEditing = false;
    haptic('success');
    render();
    showToast('Demande envoyée');
  },
});
