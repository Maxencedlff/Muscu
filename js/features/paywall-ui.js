// ═══════════════════════════════════════════════════════════
//  Abonnement (Payant V1), écrans. Contrat : docs/PAYANT_V1.md ; droit d'accès : js/data/access.js.
//
//  - Écran d'abonnement (`paywall`, paramètre `offer` ou `end`) : les deux formules, dont les PRIX ET
//    L'ESSAI GRATUIT SONT LUS CHEZ STOREKIT et jamais écrits en dur (modèle B : l'essai de 3 mois est
//    l'offre de lancement d'Apple ; « 3 mois gratuits, puis <prix> par an », ou le prix normal si la
//    personne n'y a plus droit), les mentions de la règle 3.1.2 d'Apple à côté des boutons (durée de
//    l'essai, prix et période après l'essai, renouvellement automatique, résiliation, liens Conditions
//    et Confidentialité), et « Restaurer mes achats ».
//  - DEUX SORTES DE CODES, jamais mélangées : « J'ai un code » ouvre un champ pour un code cadeau
//    MDLF (vérifié par le serveur, `redeem_gift_code`) ; « J'ai un code d'offre Apple » ouvre la
//    fenêtre d'Apple, qui n'accepte que les codes d'offre d'abonnement. On ne promet jamais qu'un
//    code d'Apple se saisit dans l'app.
//  - Bandeau de l'accueil (accessBannerHtml, appelée par js/features/dashboard.js) seulement quand le
//    verrou est allumé et l'écriture refusée : « Abonnement nécessaire pour enregistrer ».
//  - Réglages › Abonnement (`subscription`) : état en clair, « Essai gratuit jusqu'au <date>, puis
//    <prix> » pendant l'offre de lancement, date de fin, gérer chez Apple, restaurer, code. Cellule
//    des Réglages : renderAccessSettingsGroup (js/features/settings.js).
//  - Séance COMMENCÉE avec le droit d'écrire (activeSession.writeOk, posé par startSession) : la
//    terminer ne passe pas par la porte, même si l'accès a pris fin pendant la séance ; le serveur
//    l'accepte dans sa grâce bornée (24 h après la fin de l'accès, 2 séances au plus).
//  - Mode lecture seule : accessGate() est appelée par les points d'écriture d'une séance (démarrer,
//    enregistrer, séance passée, séance libre, modifier). Historique, Progrès, profil et export ne
//    passent jamais par là : ils restent ouverts. Rien n'est supprimé, la séance en cours est gardée.
//  - Sans compte et verrou allumé (règle du 28/10/2026) : la même porte ouvre l'écran de connexion
//    (Apple en premier, puis Google et e-mail), avec un texte qui dit pourquoi. Verrou éteint : rien
//    ne change.
//  - Accès à vie : seulement offert (code cadeau à vie), jamais vendu (refusé le 31/10/2026). L'écran
//    le dit (« Accès offert à vie ») et ne propose rien de plus à acheter pour soi.
//  - Hors app iOS (navigateur) : aucun achat possible, l'écran invite à utiliser l'app.
//  Rien au pointerdown : actions au clic seulement. Zones de 44 px, textes en français sans tirets.
// ═══════════════════════════════════════════════════════════
'use strict';

const PAYWALL_VIEWS = ['paywall', 'subscription'];
// Liens obligatoires (règle 3.1.2) : conditions d'utilisation (cgu.html, qui renvoie en tête au
// contrat de licence standard d'Apple), conditions de vente et confidentialité (js/data/legal-links.js)
const PAY_TERMS_URL   = LEGAL_URLS.terms;
const PAY_SALES_URL   = LEGAL_URLS.sales;
const PAY_PRIVACY_URL = LEGAL_URLS.privacy;
const PAY_MANAGE_URL  = 'https://apps.apple.com/account/subscriptions';
const PAY_PLAN_LABEL  = { [ACCESS_MONTHLY_ID]: 'Mensuel', [ACCESS_YEARLY_ID]: 'Annuel' };
// Deux sortes de codes, jamais mélangées : le code cadeau MDLF se saisit dans l'app (« J'ai un
// code »), le code d'offre d'abonnement d'Apple passe par la fenêtre d'Apple.
const PAY_CODE_NOTE = 'Un code MDLF se saisit ici, avec « J\'ai un code ». Un code d\'offre reçu d\'Apple s\'ouvre dans la fenêtre d\'Apple.';

let payBusy = false;   // un seul achat, une seule restauration à la fois

// ── Petits gabarits ─────────────────────────────────────────

// État en clair, pour les Réglages et l'écran d'abonnement
const ACCESS_STATUS_TEXT = {
  none: 'Sans abonnement', active: 'Abonné', expired: 'Abonnement terminé',
  gift: 'Accès offert', unknown: 'Pas à jour',
};
function accessStatusText() {
  const st = accessStatus();
  if (accessGiftForever()) return 'Accès offert à vie';
  if (st === 'active' && accessIntroUntil()) return 'Essai gratuit';
  return ACCESS_STATUS_TEXT[st] || ACCESS_STATUS_TEXT.unknown;
}

// Valeur courte affichée dans la cellule des Réglages
function accessShortValue() {
  if (!paywallOn()) return 'Tout est ouvert';
  return accessStatusText();
}

// Durée lue chez StoreKit ({ unit, value }) → « 3 mois », « 1 an », « 2 semaines », « 7 jours »
const PAY_UNIT_TEXT = { day: ['jour', 'jours'], week: ['semaine', 'semaines'], month: ['mois', 'mois'], year: ['an', 'ans'] };
function payDurationText(t) {
  const w = t && PAY_UNIT_TEXT[t.unit];
  return w ? plural(t.value, w[0], w[1]) : '';
}

function payToast(r, okText) {
  if (r.ok) { if (okText) showToast(okText); return true; }
  if (r.reason === 'cancel') return false;   // fenêtre d'Apple fermée : rien à dire
  // Abonnement rattaché à un autre compte MDLF : un toast ne dirait pas quoi faire
  if (r.kind === 'transaction_taken') { payTakenDialog(); return false; }
  showToast(accessErrorText(r.kind), { error: true });
  return false;
}

// Cet abonnement appartient à un autre compte MDLF : on explique et on mène au bon endroit
async function payTakenDialog() {
  const choice = await dialog({
    title: 'Abonnement sur un autre compte',
    message: 'Cet abonnement Apple est déjà rattaché à un autre compte MDLF. Connecte-toi à ce compte pour le retrouver. Un abonnement ne peut pas servir à deux comptes.',
    actions: [{ label: 'Voir mon compte', value: 'account', style: 'preferred' },
      { label: 'Plus tard', style: 'cancel' }] });
  if (choice === 'account') navigate('account');
}

// Les deux entrées de code : le code cadeau MDLF (champ dans l'app) et, dans l'app iOS seulement,
// le code d'offre d'abonnement d'Apple (sa propre fenêtre)
function payCodeCellsHtml() {
  return `<button class="cell cell--action" data-action="pay-code"><span class="cell__title">J'ai un code</span></button>
          ${Native.store.available ? '<button class="cell cell--action" data-action="pay-apple-code"><span class="cell__title">J\'ai un code d\'offre Apple</span></button>' : ''}`;
}

// Feuille de saisie du code cadeau MDLF. L'erreur reste dans la feuille, la saisie est gardée (même
// règle que la feuille du code coach). Renvoie { kind } une fois le code accepté, null sinon.
function payCodeSheet() {
  return sheet({
    title: 'J\'ai un code', confirm: 'Valider', focus: '#payCode',
    body: `<div class="coach-sheet">
        <label class="coach-sheet__label" for="payCode">Code reçu de MDLF Training</label>
        <input class="coach-code-input" id="payCode" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off"
               spellcheck="false" enterkeyhint="go" placeholder="Ex : K7M2QX9PR4TD" aria-describedby="payCodeHelp">
        <p class="coach-sheet__hint" id="payCodeHelp" aria-live="polite">Lettres et chiffres. Les espaces et les tirets sont ignorés.</p>
      </div>`,
    onConfirm: async panel => {
      const input = panel.querySelector('#payCode'), help = panel.querySelector('#payCodeHelp');
      const btn = panel.querySelector('.sheet__btn--confirm');
      const fail = msg => { help.textContent = msg; help.classList.add('coach-sheet__hint--bad'); input.setAttribute('aria-invalid', 'true'); haptic('medium'); return false; };
      if (!normalizeGiftCode(input.value)) return fail('Code introuvable : il fait au moins 10 lettres et chiffres.');
      btn.disabled = true; btn.textContent = 'Vérification…';
      const r = await accessRedeemGiftCode(input.value);
      btn.disabled = false; btn.textContent = 'Valider';
      return r.ok ? { kind: r.kind } : fail(accessErrorText(r.kind));
    },
  });
}

// Liens obligatoires (Apple) : conditions d'utilisation, de vente et confidentialité, sous les formules
function payLegalHtml() {
  return `
        <div class="pay-legal">
          <button class="pay-legal__link" data-action="pay-terms">Conditions d'utilisation</button>
          <button class="pay-legal__link" data-action="pay-sales">Conditions de vente</button>
          <button class="pay-legal__link" data-action="pay-privacy">Confidentialité</button>
        </div>`;
}

// ── Bandeau de l'accueil ────────────────────────────────────

// Bandeau discret en haut de l'accueil, seulement quand l'écriture est refusée. Rien quand le verrou
// est éteint, sans compte, ou pour un abonné (essai d'Apple compris, offre élève comprise).
function accessBannerHtml() {
  if (!paywallOn()) return '';
  if (!canWrite()) {
    // Des séances que le compte a refusées (verrou du serveur) : on le dit, elles restent ici
    const n = typeof accountLockedCount === 'function' ? accountLockedCount() : 0;
    const txt = n
      ? `${plural(n, 'séance n\'est pas sauvegardée', 'séances ne sont pas sauvegardées')} sur ton compte`
      : 'Abonnement nécessaire pour enregistrer une séance';
    return `
        <button class="pay-banner pay-banner--off" data-action="pay-open" data-reason="end">
          <span class="pay-banner__text">${txt}</span>
          <span class="pay-banner__more">Voir ${icon('chevron.right', 12)}</span>
        </button>`;
  }
  return '';
}

// ── Écran d'abonnement ─────────────────────────────────────

// Une formule : nom, prix et essai lus chez StoreKit. Aucun prix ni aucune durée n'est écrit dans l'app.
// Règle 3.1.2(c) d'Apple : le prix réellement débité et sa période dominent (en gros), l'essai gratuit
// n'est qu'une ligne secondaire. opts : { label, tag, current, months } (palier coach, annuel).
function payPlanHtml(p, opts = {}) {
  const label = opts.label || PAY_PLAN_LABEL[p.id] || 'Abonnement';
  const tag = opts.current ? 'Ta formule' : opts.tag || (p.id === ACCESS_YEARLY_ID ? 'Le plus avantageux' : '');
  const trial = p.trial ? `${payDurationText(p.trial)} ${p.trial.value > 1 || p.trial.unit === 'month' ? 'gratuits' : 'gratuit'}` : '';
  const months = opts.months ? `soit ${planMonthsText(opts.months)}` : '';
  const sub = [months, trial].filter(Boolean).join(', ');
  return `
          <button class="pay-plan${opts.current ? ' pay-plan--current' : ''}" data-action="pay-buy" data-id="${esc(p.id)}" ${access.buying || opts.current ? 'disabled' : ''}>
            <span class="pay-plan__name">${esc(label)}${tag ? `<span class="pay-plan__tag">${esc(tag)}</span>` : ''}</span>
            <span class="pay-plan__price num">${access.buying === p.id ? 'Achat…' : `${esc(p.price)} <span class="pay-plan__per">${payPer(p)}</span>`}</span>
            ${sub ? `<span class="pay-plan__trial">${esc(sub)}</span>` : ''}
          </button>`;
}
const payPer = p => (p.period === 'year' ? 'par an' : 'par mois');
// Mois de la formule mensuelle que paie l'annuelle du même palier (« soit 8,5 mois »), calculé
function payYearMonths(list, p) {
  const plan = planOf(p.id);
  if (!plan || plan.period !== 'year') return null;
  return planYearMonths(list.find(x => x.id === planId(plan.tier.key, 'month')), p);
}

// Ce que donne l'abonnement, dit avant les formules
const PAY_BENEFITS = 'Avec l\'abonnement, tu enregistres de nouvelles séances. Ton historique, tes progrès et l\'export restent ouverts, abonné ou non.';
const PAY_COACH_BENEFITS = 'L\'abonnement coach comprend ton propre accès complet et le suivi de tes élèves. Tu peux changer de palier à tout moment chez Apple.';

// Mentions exigées par Apple (règle 3.1.2) à côté des boutons d'achat : durée de l'essai, prix et
// période après l'essai, renouvellement automatique, résiliation à tout moment. Tout est lu chez
// StoreKit ; les liens Conditions et Confidentialité suivent (payLegalHtml).
function payTermsHtml(list) {
  const trial = list.find(p => p.trial);
  const prices = list.map(p => `${esc(p.price)} ${payPer(p)}`).join(' ou ');
  const first = trial
    ? `Essai gratuit de ${esc(payDurationText(trial.trial))}, puis ${prices} selon la formule choisie. Le paiement est débité sur ton compte Apple à la fin de l'essai, sauf si tu le résilies au moins 24 heures avant la fin de l'essai.`
    : `${prices} selon la formule choisie, débité sur ton compte Apple à la confirmation de l'achat.`;
  return `
        <div class="pay-terms" role="note">
          <p>${first}</p>
          <p>L'abonnement se renouvelle automatiquement pour la même période, sauf si tu le résilies au moins 24 heures avant la fin de la période en cours. Tu peux le résilier à tout moment dans les réglages de ton identifiant Apple.</p>
        </div>`;
}

// ── Particulier, coach, élève ───────────────────────────────

let payCoachPeriod = 'month';   // onglet Coach : Mensuel ou Annuel

// Élève d'un coach, jamais abonné : son offre (code d'offre d'Apple, −25 % pendant 12 mois, sans essai)
// à la place des formules habituelles. Le serveur a le dernier mot (not_new : déjà abonné une fois).
function payIsStudentOffer() {
  return coachRole().hasCoach && accessStatus() === 'none' && access.studentOffer?.error !== 'not_new'
    && access.studentOffer?.error !== 'not_student';
}

// Prix de l'offre élève : repli par devise (StoreKit ne donne pas le prix d'un code d'offre), puis le
// mensuel lu chez StoreKit. Sans devise connue : en pourcentage, sans chiffre inventé.
function payStudentLines(monthly) {
  const price = planStudentPrice(monthly?.currency);
  const after = monthly ? `${monthly.price} par mois` : 'le prix normal';
  return price
    ? { big: price, per: 'par mois', sub: `pendant ${PLAN_STUDENT_MONTHS} mois, puis ${after}. Sans essai gratuit.`,
        terms: `${price} par mois pendant ${PLAN_STUDENT_MONTHS} mois, puis ${after}, débité sur ton compte Apple quand tu confirmes dans la page d'Apple.` }
    : { big: '25 % de moins', per: '', sub: `pendant ${PLAN_STUDENT_MONTHS} mois, puis ${after}. Sans essai gratuit.`,
        terms: `25 % de moins pendant ${PLAN_STUDENT_MONTHS} mois, puis ${after}, débité sur ton compte Apple quand tu confirmes dans la page d'Apple.` };
}
function payStudentHtml(list) {
  const monthly = list.find(p => p.id === ACCESS_MONTHLY_ID);
  const l = payStudentLines(monthly);
  const who = myCoach() ? elide('de', personName(myCoach())) : 'de ton coach';
  const busy = access.studentBusy;
  return `<p class="pay-benefits">${PAY_BENEFITS}</p>
        <div class="pay-student">
          <span class="pay-plan__name">Offre élève ${esc(who)}</span>
          <span class="pay-plan__price num">${esc(l.big)}${l.per ? ` <span class="pay-plan__per">${l.per}</span>` : ''}</span>
          <span class="pay-plan__trial">${esc(l.sub)}</span>
          <button class="btn btn--primary btn--full pay-student__btn" data-action="pay-student" ${busy ? 'disabled' : ''}>${busy ? 'Un instant…' : 'Obtenir mon offre élève'}</button>
        </div>
        <div class="pay-terms" role="note">
          <p>${esc(l.terms)}</p>
          <p>Ton code d'offre s'ouvre dans la page d'Apple, qui affiche le prix exact avant que tu confirmes. L'abonnement se renouvelle automatiquement chaque mois, sauf si tu le résilies au moins 24 heures avant la fin de la période en cours. Tu peux le résilier à tout moment dans les réglages de ton identifiant Apple.</p>
        </div>${payLegalHtml()}`;
}

// Formules du particulier (mensuel, annuel « soit 8,5 mois »)
function payProHtml(list) {
  const pro = list.filter(p => planOf(p.id)?.tier.key === 'pro');
  if (!pro.length) return payMissingHtml();
  const notNew = access.studentOffer?.error === 'not_new' && coachRole().hasCoach
    ? '<div class="pay-note" role="status"><p>L\'offre élève est réservée à un premier abonnement.</p></div>' : '';
  return `${notNew}<p class="pay-benefits">${PAY_BENEFITS}</p>
        <div class="pay-plans">${pro.map(p => payPlanHtml(p, { months: payYearMonths(list, p) })).join('')}</div>${payTermsHtml(pro)}${payLegalHtml()}`;
}

// Paliers coach, réservés à un coach validé : 4 formules pour la période choisie, nombre d'élèves suivis,
// palier conseillé (celui qui les contient, ou celui demandé par le bandeau « passe au palier
// supérieur »), formule en cours marquée « Ta formule ».
function payCoachHtml(list, pre) {
  const tier = coachPro.tier;
  const students = tier ? tier.students : (coach.state?.students.length ?? 0);
  const current = tier?.product_id || null;
  const wanted = planOf(pre)?.tier.coach ? planOf(pre).tier
    : tier?.full && current ? planNextTier(current) : planTierFor(students);
  const per = payCoachPeriod;
  const shown = PLAN_COACH_TIERS.map(t => list.find(p => p.id === planId(t.key, per))).filter(Boolean);
  if (!shown.length) return payMissingHtml();
  const seg = `
        <div class="pay-period"><div class="segmented seg-full" role="group" aria-label="Période">
          <button class="segmented__btn ${per === 'month' ? 'segmented__btn--active' : ''}" aria-pressed="${per === 'month'}" data-action="pay-period" data-period="month">Mensuel</button>
          <button class="segmented__btn ${per === 'year' ? 'segmented__btn--active' : ''}" aria-pressed="${per === 'year'}" data-action="pay-period" data-period="year">Annuel</button>
        </div></div>`;
  const count = `<p class="pay-benefits">${PAY_COACH_BENEFITS} Tu suis ${plural(students, 'élève', 'élèves')}.</p>`;
  const plans = shown.map(p => {
    const t = planOf(p.id).tier;
    return payPlanHtml(p, { label: t.label, current: current === p.id, tag: t === wanted && current !== p.id ? 'Conseillé' : '',
      months: payYearMonths(list, p) });
  }).join('');
  return `${count}${seg}<div class="pay-plans">${plans}</div>${payTermsHtml(shown)}${payLegalHtml()}`;
}

function payMissingHtml() {
  // Apple ne connaît pas encore les produits (contrat Paid Apps en attente, produit pas validé) :
  // on le dit, sans prix inventé et sans écran cassé
  const pending = access.missing && access.missing.length;
  return `<div class="pay-note" role="status"><p>${pending
    ? 'Les formules ne sont pas encore proposées par Apple.'
    : 'Les formules n\'ont pas pu être lues chez Apple.'}</p>
          <p>Tes séances, tes progrès et ton export restent à toi.</p>
          <button class="pay-note__btn" data-action="pay-reload-products">Réessayer</button></div>`;
}

// Ce qui peut s'acheter, ou pourquoi rien ne peut l'être. tab : 'pro' ou 'coach'.
function payPlansHtml(tab = 'pro', pre = null) {
  // Verrou éteint : rien à vendre. Proposer une formule ferait commencer l'essai d'Apple pour rien, et la
  // personne serait débitée 3 mois plus tard (relecture du 28/10). Vaut aussi pour les paliers coach et
  // l'offre élève. Restaurer et les codes restent.
  if (!paywallOn()) {
    return `<div class="pay-note" role="status"><p>Rien à acheter pour l'instant&nbsp;: tes séances s'enregistrent comme avant.</p></div>`;
  }
  if (!Native.store.available) {
    return `<div class="pay-note" role="status"><p>Les abonnements s'achètent dans l'app MDLF Training sur iPhone.</p>
          <p>Tes séances et tes progrès restent accessibles ici.</p></div>`;
  }
  if (access.canPay === false) {
    return `<div class="pay-note" role="status"><p>Les achats sont bloqués sur cet iPhone.</p>
          <p>Regarde dans Réglages, Temps d'écran, Restrictions, Achats intégrés.</p></div>`;
  }
  const list = access.products;
  if (list === null) return '<div class="pay-note" role="status"><p>Chargement des formules…</p></div>';
  if (!list.length) return payMissingHtml();
  if (tab === 'coach' && coachRole().isCoach) return payCoachHtml(list, pre);
  // Accès à vie offert : rien de plus à acheter pour soi
  if (accessGiftForever()) {
    return '<div class="pay-note" role="status"><p>On t\'a offert l\'accès à vie : rien d\'autre à acheter.</p></div>';
  }
  if (payIsStudentOffer()) return payStudentHtml(list);
  return payProHtml(list);
}

// Onglets Particulier / Coach : seulement pour un coach validé (les autres ne voient jamais les paliers)
function payTabsHtml(tab) {
  if (!paywallOn() || !coachRole().isCoach || !Native.store.available) return '';
  return `
        <div class="pay-tabs"><div class="segmented seg-full" role="group" aria-label="Formule">
          <button class="segmented__btn ${tab !== 'coach' ? 'segmented__btn--active' : ''}" aria-pressed="${tab !== 'coach'}" data-action="pay-tab" data-tab="pro">Particulier</button>
          <button class="segmented__btn ${tab === 'coach' ? 'segmented__btn--active' : ''}" aria-pressed="${tab === 'coach'}" data-action="pay-tab" data-tab="coach">Coach</button>
        </div></div>`;
}

// Pas encore coach : le chemin vers la demande (le rôle se vérifie, il ne s'achète pas)
function payCoachLinkHtml() {
  if (!account.user || coachRole().isCoach) return '';
  const st = coachPro.request?.status;
  const value = st === 'pending' ? 'En cours de vérification' : st === 'rejected' ? 'Demande refusée' : '';
  return `
        <div class="group">
          <button class="cell cell--nav" data-action="coach-request-open">
            <span class="cell__body"><span class="cell__title">Tu es coach ?</span><span class="cell__sub">Éducateur sportif diplômé : fais vérifier ta carte</span></span>
            ${value ? `<span class="cell__value">${esc(value)}</span>` : ''}
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

// reason : 'end' (écriture refusée) ou 'offer' (depuis les Réglages ou un bandeau) ; tab : 'pro' ou
// 'coach' ; pre : formule à mettre en avant (montée de palier)
function renderPaywall(reason = 'offer', tab = 'pro', pre = null) {
  const head = navBar({ title: 'Abonnement', large: false });
  const end = reason === 'end';
  const coachTab = tab === 'coach' && coachRole().isCoach;
  const shown = (access.products || []).filter(p => planIsCoach(p.id) === coachTab);
  const trial = shown.find(p => p.trial);
  const off = !paywallOn();
  const student = !off && !coachTab && payIsStudentOffer() && Native.store.available && access.products?.length;
  // Accès à vie offert, onglet Particulier : rien à acheter, le haut de l'écran le dit aussi
  const forever = !off && !coachTab && accessGiftForever();
  const title = off ? 'Tout est ouvert' : coachTab ? 'MDLF Training pour coachs' : forever ? 'Accès offert à vie' : end ? 'Abonnement nécessaire' : 'MDLF Training, sans limite';
  // Formulation exacte : l'abonnement continue tout seul après l'essai, et Apple demande de résilier au
  // moins 24 h avant sa fin (https://support.apple.com/en-us/118428)
  const sub = off ? 'L\'abonnement n\'est pas encore demandé.'
    : forever ? 'Tu enregistres tes séances sans abonnement.'
    : student ? `Avec le code de ton coach, ton abonnement est à 25 % de moins pendant ${PLAN_STUDENT_MONTHS} mois.`
    : trial
    ? `${esc(payDurationText(trial.trial))} gratuits, puis l'abonnement continue sauf si tu le résilies au moins 24 heures avant la fin de l'essai.`
    : 'Pour enregistrer de nouvelles séances, choisis une formule.';
  const stale = accessStale() && account.user ? `<p class="social-inline-error" role="status">${esc(access.error === 'offline' ? 'Pas d\'Internet : état pas à jour.' : 'État pas à jour.')}</p>` : '';
  const planned = Native.store.available && access.products?.length && !off;
  return `
    <div class="view view--grouped pay-view">
      ${head}
      <div class="scr">
        ${stale}
        <div class="social-hero pay-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon(coachTab ? 'person.2' : 'flame', 40)}</span>
          <h2 class="social-hero__title">${title}</h2>
          <p class="social-hero__sub">${sub}</p>
        </div>
        ${payTabsHtml(coachTab ? 'coach' : 'pro')}
        ${payPlansHtml(coachTab ? 'coach' : 'pro', pre)}
        <div class="group">
          <button class="cell cell--action" data-action="pay-restore"><span class="cell__title">Restaurer mes achats</span></button>
          ${payCodeCellsHtml()}
        </div>
        <div class="group-foot">${PAY_CODE_NOTE}</div>
        ${forever ? '' : '<div class="group-foot">Un identifiant Apple n\'a droit qu\'à un seul essai gratuit, et un même abonnement ne peut servir qu\'à un compte MDLF.</div>'}
        ${coachTab ? '' : payCoachLinkHtml()}
        ${planned ? '' : payLegalHtml()}
      </div>
    </div>`;
}
SCREENS.set('paywall', {
  render: (reason, tab, pre) => renderPaywall(reason || 'offer', tab === 'coach' ? 'coach' : 'pro', pre || null),
  enter: () => {
    accessRefresh(); accessLoadStoreStatus(); accessLoadProducts();
    if (account.user) coachProRefresh({ minAge: 30_000 });
  },
});

// ── Réglages › Abonnement ──────────────────────────────────

function renderAccessSettingsGroup() {
  if (!accountAvailable() || !account.user) return '';
  return `
        <div class="group">
          <button class="cell cell--nav" data-action="access-open-settings">
            <span class="cell__body"><span class="cell__title">Abonnement</span></span>
            <span class="cell__value">${esc(accessShortValue())}</span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

function renderSubscription() {
  const head = navBar({ title: 'Abonnement', large: false });
  if (!account.user) {
    return `<div class="view view--grouped pay-settings-view">${head}<div class="scr">
        <div class="empty-note">Connecte-toi pour voir ton abonnement.</div></div></div>`;
  }
  const on = paywallOn();
  // Verrou éteint : on ne montre ni « essai terminé » ni date passée, qui inquiéteraient pour rien
  const until = on ? accessUntil() : null;
  const st = accessStatus();
  const intro = on ? accessIntroUntil() : null;
  const endLabel = st === 'active' ? 'Renouvellement' : 'Fin';
  // Essai gratuit d'Apple en cours : « Essai gratuit jusqu'au <date>, puis <prix> » (formule lue sur
  // l'iPhone, prix lu chez StoreKit ; sans eux, la date seule)
  const plan = intro ? (access.products || []).find(p => p.id === access.currentProduct) : null;
  const introLine = intro ? `Essai gratuit jusqu'au ${fmtDate(intro)}${plan ? `, puis ${plan.price} ${payPer(plan)}` : ''}` : '';
  const offNote = !on ? `
        <div class="group-foot">Tout est ouvert pour l'instant : l'abonnement n'est pas encore demandé.</div>` : '';
  // Accès à vie offert ET abonnement particulier lu sur cet iPhone : Apple continue de le facturer (un
  // palier coach, lui, reste utile : il donne le nombre d'élèves)
  const alsoNote = on && accessGiftForever() && access.currentProduct && !planIsCoach(access.currentProduct) ? `
        <div class="group-foot" role="note">Ton abonnement Apple continue d'être facturé. Avec l'accès offert à vie, tu peux le résilier dans « Gérer chez Apple ».</div>` : '';
  const rows = `
        <div class="group">
          <div class="cell">
            <span class="cell__body"><span class="cell__title">État</span></span>
            <span class="cell__value">${esc(on ? accessStatusText() : 'Tout est ouvert')}</span>
          </div>
          ${!introLine && until ? `<div class="cell">
            <span class="cell__body"><span class="cell__title">${endLabel}</span></span>
            <span class="cell__value">${esc(fmtDate(until))}</span>
          </div>` : ''}
        </div>${introLine ? `
        <div class="group-foot pay-intro-line">${esc(introLine)}.</div>` : ''}${offNote}${alsoNote}`;
  const actions = `
        <div class="group">
          ${on && (st === 'none' || st === 'expired' || st === 'unknown')
            ? '<button class="cell cell--action" data-action="pay-open" data-reason="offer"><span class="cell__title">Voir les formules</span></button>' : ''}
          ${on && coachRole().isCoach ? `<button class="cell cell--action" data-action="pay-open" data-reason="offer" data-tab="coach"><span class="cell__title">${planIsCoach(access.currentProduct) ? 'Changer de palier coach' : 'Voir les formules coach'}</span></button>` : ''}
          ${Native.store.available ? '<button class="cell cell--action" data-action="pay-manage"><span class="cell__title">Gérer chez Apple</span></button>' : ''}
          <button class="cell cell--action" data-action="pay-restore"><span class="cell__title">Restaurer mes achats</span></button>
          ${payCodeCellsHtml()}
        </div>
        <div class="group-foot">${PAY_CODE_NOTE}</div>
        <div class="group-foot">L'abonnement se gère dans les réglages de ton identifiant Apple : c'est là que tu peux changer de formule ou l'arrêter.</div>`;
  const stale = accessStale() ? `<p class="social-inline-error" role="status">${esc(access.error === 'offline' ? 'Pas d\'Internet : état pas à jour.' : 'État pas à jour.')}</p>` : '';
  return `
    <div class="view view--grouped pay-settings-view">
      ${head}
      <div class="scr">${stale}${rows}${actions}${payLegalHtml()}</div>
    </div>`;
}
SCREENS.set('subscription', { render: () => renderSubscription(), enter: () => { accessRefresh(); accessLoadCurrentPlan(); } });

// ── Mode lecture seule : la porte des écritures ─────────────

// Ouvre l'écran d'abonnement (depuis un bandeau, une cellule ou un refus d'écriture)
// tab 'coach' (coach validé seulement) et pre : formule à mettre en avant (montée de palier)
function openPaywall(reason = 'offer', tab = null, pre = null) {
  const r = reason === 'end' ? 'end' : 'offer';
  navigate(tab === 'coach' ? makeRoute('paywall', r, 'coach', ...(pre ? [pre] : [])) : makeRoute('paywall', r));
}

// Appelée par chaque point d'écriture d'une séance. true : on continue. false : l'abonnement est
// proposé et l'appelant s'arrête, SANS rien supprimer (la séance en cours reste en cours).
// Le dernier état connu peut être vieux : il est relu avant tout refus (accessEnsure).
async function accessGate() {
  if (canWrite()) return true;
  if (await accessEnsure()) return true;
  // Sans compte, verrou allumé : il faut un compte (l'abonnement lui est rattaché). Les moyens de connexion
  // sont ceux de toujours ; fermer l'écran ne perd rien (la séance en cours reste en cours).
  if (!account.user) {
    if (accessSignInRequired()) accessSignInPrompt(); else accessOfflinePrompt();
    return false;
  }
  openPaywall('end');
  return false;
}

// Sans compte et verrou jamais lu depuis plus de 7 jours (accessUnknownExpired) : une lecture
// réussie suffit, on ne parle ni de compte ni d'abonnement
function accessOfflinePrompt() {
  dialog({ title: 'Connexion à Internet nécessaire',
    message: 'MDLF Training doit vérifier une fois ses réglages en ligne. Connecte-toi à Internet, puis réessaie. Tes séances restent sur cet iPhone.',
    actions: [{ label: 'OK', style: 'preferred' }] });
}

// Écran de connexion, avec le texte du verrou (auth-flow.js, contexte « paywall »)
function accessSignInPrompt() {
  if (typeof openAuthFlow !== 'function') return;
  openAuthFlow({ step: 'welcome', closable: true, context: 'paywall' });
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'pay-open': (e, el) => { openPaywall(el.dataset.reason, el.dataset.tab, el.dataset.id); },
  'pay-tab': (e, el) => { navigate(makeRoute('paywall', 'offer', el.dataset.tab === 'coach' ? 'coach' : 'pro'), { replace: true }); },
  'pay-period': (e, el) => { payCoachPeriod = el.dataset.period === 'year' ? 'year' : 'month'; haptic(); render(); },
  // Offre élève : le serveur donne un code d'offre d'Apple à usage unique (Production), la page d'Apple
  // l'applique. Sous TestFlight, aucun code n'est demandé (accessStudentOffer) : on le dit, sans erreur
  'pay-student': async () => {
    if (access.studentBusy) return;
    access.studentBusy = true; render();
    try {
      const r = await accessStudentOffer();
      if (!r.ok) { showToast(accessErrorText(r.kind), { error: r.kind !== 'testflight', duration: 4000 }); return; }
      window.open(planRedeemUrl(r.code), '_blank');
      showToast('Confirme ton offre élève dans la page d\'Apple');
    } finally { access.studentBusy = false; render(); }
  },
  'coach-request-open': () => { navigate('coach-request'); },
  'access-open-settings': () => { navigate('subscription'); accessRefresh(); },
  'pay-terms': () => { window.open(PAY_TERMS_URL, '_blank'); },
  'pay-sales': () => { window.open(PAY_SALES_URL, '_blank'); },
  'pay-privacy': () => { window.open(PAY_PRIVACY_URL, '_blank'); },
  'pay-manage': () => { window.open(PAY_MANAGE_URL, '_blank'); },
  'pay-reload-products': async () => { access.products = null; render(); await accessLoadProducts({ force: true }); render(); },
  'pay-buy': async (e, el) => {
    if (payBusy) return;
    payBusy = true;
    try {
      const r = await accessBuy(el.dataset.id);
      if (payToast(r, 'Abonnement actif')) { if (currentView() === 'paywall') goBack(); else render(); return; }
      render();
    } finally { payBusy = false; }
  },
  'pay-restore': async () => {
    if (payBusy) return;
    payBusy = true;
    showToast('Restauration…');
    try {
      const r = await accessRestore();
      payToast(r, 'Achats restaurés');
      render();
    } finally { payBusy = false; }
  },
  // Code cadeau MDLF : saisi dans l'app, vérifié par le serveur (redeem_gift_code)
  'pay-code': async () => {
    const res = await payCodeSheet();
    if (!res) return;
    render();
    showToast(res.kind === 'lifetime' ? 'Accès offert à vie activé' : 'Code accepté : des jours en plus');
  },
  // Code d'offre d'abonnement d'Apple : sa propre fenêtre, le code utilisé revient par l'écouteur
  'pay-apple-code': async () => {
    const r = await accessRedeemCode();
    if (!r.ok) { payToast(r); return; }
    showToast('Saisis ton code d\'offre dans la fenêtre d\'Apple');
  },
  'access-retry': async () => { await accessRefresh(); render(); },
});

// ── Mises à jour de l'écran ─────────────────────────────────

// Ce que les écrans hors abonnement montrent de l'accès (bandeau de l'accueil, cellule des Réglages) :
// ils ne sont redessinés que si cette signature change, jamais pendant une saisie
function accessShownKey() {
  return JSON.stringify([account.user?.id || null, paywallOn(), accessStatus(), accessIntroUntil(), canWrite(),
    accessUntil(), accountLockedCount()]);
}
let accessShown = null;
const PAY_WATCH_VIEWS = ['dashboard', 'settings'];
function accessApplyChange() {
  const v = currentView(), key = accessShownKey();
  if (document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  if (PAYWALL_VIEWS.includes(v)) { render(); accessShown = key; return; }
  if (key !== accessShown && PAY_WATCH_VIEWS.includes(v)) { render(); accessShown = key; return; }
  accessShown = key;
}
accessShown = accessShownKey();
onAccessChange(() => { accessApplyChange(); });
// Rôle coach, palier, coach de l'élève : l'écran d'abonnement en dépend (onglet Coach, offre élève)
onCoachChange(() => { if (PAYWALL_VIEWS.includes(currentView()) && !document.activeElement?.matches?.('input, textarea, select')) render(); });
// La synchro aussi change ce qui est montré : une séance refusée par le compte (verrou du serveur)
// doit apparaître dans le bandeau sans attendre le prochain dessin
onAccountChange(() => { accessApplyChange(); });
document.addEventListener('focusout', () => { if (accessShownKey() !== accessShown) setTimeout(accessApplyChange, 0); });

// Écouteur permanent des transactions d'Apple : posé une fois au chargement
accessOnTransaction();
