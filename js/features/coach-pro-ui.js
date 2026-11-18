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
//    (au plus haut palier, 100 élèves : « Plus de 100 élèves : écris-nous à contact@mdlf.app », sans achat)
//    l'onglet Coach de l'abonnement avec le palier suivant mis en avant. Élèves au-delà de la formule
//    (descente de palier, abonnement coach arrêté) : leur accès n'est plus offert, le bandeau le dit.
//  - Badge « Carte pro déclarée » (docs/COACH_V1.md, « Badge carte pro ») : section « Carte professionnelle »
//    de Réglages › Coach (déclarer, changer de numéro, retirer ; état suspendu ou retiré), pastille
//    (cardBadgeHtml) sur le profil du coach, Mon coach, l'aperçu « Rejoindre » et Mon profil, et
//    « Signaler ce badge » (cardBadgeReportCell). Le libellé ne dit jamais « vérifiée » ni « certifié ».
//  Tout texte venu du serveur passe par esc(). Rien au pointerdown : actions au clic seulement.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_REQUEST_INTRO = 'Le rôle coach est réservé aux éducateurs sportifs diplômés, titulaires d\'une carte professionnelle. L\'équipe vérifie la carte sur le site du ministère des Sports, sous 48 h.';
const COACH_REQUEST_STATUS_TEXT = {
  pending: 'En vérification', approved: 'Validée', rejected: 'Refusée', revoked: 'Rôle retiré',
};
let coachRequestEditing = false;   // demande en attente ou refusée : formulaire rouvert pour la corriger
let coachRequestBusy = false;

// ── Bandeau du palier plein ─────────────────────────────────

function coachTierBannerHtml() {
  const txt = coachTierFullText(coachPro.tier);
  if (!txt || !paywallOn()) return '';
  // Élèves au-delà de la formule : le palier qui les contient tous ; palier plein : le suivant
  const t = coachPro.tier;
  const tierFor = n => planTierFor(n) && planId(planTierFor(n).key, 'month');
  const next = t.uncovered > 0 ? tierFor(t.students) : t.next_product || tierFor(t.students + 1);
  // Plus de 100 élèves : pas de formule au-dessus, on écrit (bandeau sans achat, ouvre le courriel)
  if (!next || t.contact) {
    return `
        <a class="pay-banner pay-banner--off coach-tier-banner coach-tier-banner--contact" href="mailto:contact@mdlf.app?subject=${encodeURIComponent('MDLF Training : plus de 100 élèves')}">
          <span class="pay-banner__text">${esc(txt)}</span>
          <span class="pay-banner__more">Écrire ${icon('chevron.right', 12)}</span>
        </a>`;
  }
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
        <div class="group-title">Tu es coach&nbsp;?</div>
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
            <span class="cell__body"><span class="cell__title coach-code num">${esc(formatCoachCode(code))}</span><span class="cell__sub">Code permanent, à mettre dans ta bio</span></span>
            <button class="coach-icon-btn" data-action="coach-share-invite" data-code="${esc(code)}" aria-label="Partager ton code coach">${icon('square.and.arrow.up', 20)}</button>
          </div>` : `<div class="cell"><span class="cell__sub">${coachPro.error ? esc(coachProErrorText(coachPro.error)) : 'Chargement…'}</span></div>`}
        </div>
        <div class="group-foot">Tes élèves le saisissent dans Social › Rejoindre un coach.${paywallOn() ? ' Ils n\'ont rien à payer : ton abonnement coach couvre leur accès, dans la limite d\'élèves de ton palier.' : ''}</div>
        ${coachCardGroupHtml()}
        <div class="group-title">Abonnement coach</div>
        <div class="group">
          <button class="cell cell--nav" data-action="pay-open" data-reason="offer" data-tab="coach">
            <span class="cell__body"><span class="cell__title">Formule</span>${count ? `<span class="cell__sub">${esc(count)}</span>` : ''}</span>
            <span class="cell__value">${esc(tierValue)}</span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

// ── Badge « Carte pro déclarée » ────────────────────────────

const CARD_BADGE_VIEWS = ['coach', 'coach-join', 'coach-mine', 'social-profile', 'social-me'];
const CARD_BADGE_PRIVATE = 'Seuls toi et l\'administrateur de MDLF Training voient ce numéro. Déclarer la carte d\'une autre personne entraîne la suppression du compte.';

// Pastille montrée à tous (lue par coach_card_badge) : « déclarée », jamais « vérifiée »
function cardBadgeHtml(uid, cls = '') {
  if (!coachBadgeShown(uid)) return '';
  return `<span class="card-badge${cls ? ` ${cls}` : ''}">${icon('doc.text', 13)}<span>${COACH_BADGE_LABEL}</span></span>`;
}
// « Signaler ce badge » : sur le badge d'un autre, seulement quand il est montré
function cardBadgeReportCell(uid) {
  if (!uid || uid === account.user?.id || !coachBadgeShown(uid)) return '';
  return `<button class="cell cell--destructive" data-action="coach-card-report" data-uid="${esc(uid)}">Signaler ce badge</button>`;
}

// Réglages › Coach (coach validé) : ma carte, son état et ce que je peux faire
function coachCardGroupHtml() {
  const c = coachPro.card;
  if (!c) return '';   // pas encore lu, hors ligne, ou serveur sans le badge
  const title = '<div class="group-title">Carte professionnelle</div>';
  if (c.status === 'none') {
    return `${title}
        <div class="group">
          <button class="cell cell--action" data-action="coach-card-declare"><span class="cell__title">Déclarer ma carte pro</span></button>
        </div>
        <div class="group-foot">Le badge « ${COACH_BADGE_LABEL} » s'affiche alors sur ton profil et quand un élève te rejoint. ${CARD_BADGE_PRIVATE}</div>`;
  }
  const state = { declared: 'Affiché', suspended: 'Suspendu', removed: 'Retiré' }[c.status];
  const rows = `
          <div class="cell"><span class="cell__body"><span class="cell__title">Numéro</span></span><span class="cell__value num">${esc(c.card_number || '')}</span></div>
          ${c.declared_at ? `<div class="cell"><span class="cell__body"><span class="cell__title">Déclarée le</span></span><span class="cell__value">${esc(fmtDate(c.declared_at))}</span></div>` : ''}
          <div class="cell"><span class="cell__body"><span class="cell__title">Badge</span></span><span class="cell__value">${state}</span></div>`;
  if (c.status === 'suspended') {
    return `${title}<div class="group">${rows}</div>
        <div class="group-foot">Badge suspendu après plusieurs signalements. L'équipe vérifie la carte sur le site du ministère des Sports, puis remet le badge si elle est valide.</div>`;
  }
  if (c.status === 'removed') {
    return `${title}<div class="group">${rows}</div>
        <div class="group-foot">${c.removed_reason ? `Motif : ${esc(c.removed_reason)} ` : ''}Pour contester, écris à contact@mdlf.app.</div>`;
  }
  return `${title}
        <div class="group">${rows}
          <button class="cell cell--action" data-action="coach-card-declare"><span class="cell__title">Changer de numéro</span></button>
        </div>
        <div class="group">
          <button class="cell cell--destructive" data-action="coach-card-withdraw">Retirer le badge</button>
        </div>
        <div class="group-foot">Le badge indique une carte déclarée, pas une carte vérifiée. ${CARD_BADGE_PRIVATE}</div>`;
}

// Saisie du numéro : erreur dans la feuille (saisie gardée), « Envoi… » pendant l'appel
function coachCardSheet() {
  const c = coachPro.card;
  // Prérempli : numéro déjà déclaré, sinon celui de la demande du rôle coach s'il a la bonne forme
  const pre = c?.card_number || normalizeBadgeCard(coachPro.request?.card_number) || '';
  return sheet({
    title: 'Carte pro', confirm: 'Déclarer', focus: '#coachCardNum',
    body: `<div class="coach-sheet">
        <label class="coach-sheet__label" for="coachCardNum">Numéro de ta carte d'éducateur sportif</label>
        <input class="coach-code-input" id="coachCardNum" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off"
               spellcheck="false" enterkeyhint="done" maxlength="20" placeholder="Ex : 04912ED0123" value="${esc(pre)}" aria-describedby="coachCardHelp">
        <p class="coach-sheet__hint" id="coachCardHelp" aria-live="polite">Il est écrit sur ta carte professionnelle. ${CARD_BADGE_PRIVATE}</p>
      </div>`,
    onConfirm: async panel => {
      const input = panel.querySelector('#coachCardNum'), help = panel.querySelector('#coachCardHelp');
      const btn = panel.querySelector('.sheet__btn--confirm');
      btn.disabled = true; btn.textContent = 'Envoi…';
      const r = await coachCardDeclare(input.value);
      btn.disabled = false; btn.textContent = 'Déclarer';
      if (r.ok) return true;
      help.textContent = coachProErrorText(r.kind);
      help.classList.add('coach-sheet__hint--bad');
      input.setAttribute('aria-invalid', 'true');
      haptic('medium');
      return false;
    },
  });
}

async function coachCardReportFlow(uid) {
  const p = (myCoach()?.user_id === uid ? myCoach() : null) || (coach.preview?.person?.user_id === uid ? coach.preview.person : null)
    || (typeof socialPerson === 'function' ? socialPerson(uid) : null);
  const name = personName(p || {});
  const ok = await confirmSheet('Signaler ce badge ?',
    `L'équipe vérifiera la carte de ${name} sur le site du ministère des Sports. ${name} ne saura pas que c'est toi.`,
    'Signaler');
  if (!ok) return;
  const r = await coachCardReport(uid);
  if (!r.ok) { showToast(coachProErrorText(r.kind), { error: true }); return; }
  haptic('success');
  showToast(r.already ? 'Tu as déjà signalé ce badge' : 'Signalement envoyé');
}

onCoachBadgeChange(() => { if (CARD_BADGE_VIEWS.includes(currentView()) && !coachTyping()) render(); });

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
            <span class="coach-req-field__pick"><select class="coach-req-field__input" id="coachReqDiploma" required>${options}</select>${icon('chevron.up.chevron.down', 14)}</span>
          </label>
        </div>
        <p class="coach-req-error" id="coachReqError" role="alert" aria-live="polite"></p>
        <button class="btn btn--primary btn--full" data-action="coach-request-send" ${coachRequestBusy ? 'disabled' : ''}>${coachRequestBusy ? 'Envoi…' : keep ? 'Renvoyer ma demande' : 'Envoyer ma demande'}</button>
        <div class="group-foot coach-req-foot">Ces informations servent seulement à vérifier la carte. Seul l'administrateur de MDLF Training les voit.</div>`;
}

function renderCoachRequest() {
  const head = navBar({ title: '' });   // un seul titre : celui du contenu, repris par la barre au défilement (panel t5)
  if (!account.user) {
    return `<div class="view view--grouped coach-req-view">${head}<div class="scr">
        <div class="empty-note">Connecte-toi pour faire ta demande.</div></div></div>`;
  }
  const req = coachPro.request;
  const hero = `
        <div class="social-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('coach', 40)}</span>
          <h1 class="social-hero__title" data-echo-title>Devenir coach</h1>
          <p class="social-hero__sub">${COACH_REQUEST_INTRO}</p>
        </div>`;
  if (!req && coachPro.loading) return `<div class="view view--grouped coach-req-view">${head}<div class="scr">${hero}<div class="empty-note">Chargement…</div></div></div>`;
  if (!req && coachPro.error) {
    return `<div class="view view--grouped coach-req-view">${head}<div class="scr">${hero}${coachOfflineNote(coachPro.error, 'Pas d\'Internet. La demande se fait avec du réseau.')}</div></div>`;
  }
  if (coachRole().isCoach || req?.is_coach || req?.status === 'approved') {
    return `<div class="view view--grouped coach-req-view">${head}<div class="scr">${hero}
        <div class="group"><div class="cell"><span class="cell__body"><span class="cell__title">Demande</span></span><span class="cell__value">Validée</span></div></div>
        <div class="group-foot">Rôle coach validé. Code et abonnement coach : Réglages › Coach.</div>
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
        ${st === 'pending' ? '<div class="group-foot">Tu verras la réponse ici.</div>' : ''}` : '';
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
  'coach-card-declare': async () => {
    if (!(await coachCardSheet())) return;
    haptic('success');
    render();
    showToast('Carte déclarée');
  },
  'coach-card-withdraw': async () => {
    if (!(await confirmSheet('Retirer le badge ?', `Le badge « ${COACH_BADGE_LABEL} » disparaîtra de ton profil. Tu pourras redéclarer ta carte.`, 'Retirer'))) return;
    const r = await coachCardWithdraw();
    if (!r.ok) { showToast(coachProErrorText(r.kind), { error: true }); return; }
    render();
    showToast('Badge retiré');
  },
  'coach-card-report': async (e, el) => { await coachCardReportFlow(el.dataset.uid); },
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
