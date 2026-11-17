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
//    MDLF (vérifié par le serveur, `redeem_gift_code`), hors app iOS seulement (règle 3.1.1 d'Apple,
//    giftCodeInApp) ; « J'ai un code d'offre Apple » ouvre la fenêtre d'Apple, qui n'accepte que les
//    codes d'offre d'abonnement. On ne promet jamais qu'un code d'Apple se saisit dans l'app.
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
//  - Élève d'un coach (décision du 16/11/2026) : il ne paie rien, c'est l'abonnement coach qui le
//    comprend. « Offert par ton coach <nom> », sans formule à acheter ; pendant les 7 jours de grâce,
//    la date de fin ; au-delà du palier du coach ou sans abonnement coach, un message clair puis les
//    formules habituelles (jamais d'achat silencieux). Côté coach : « Tes élèves n'ont rien à payer ».
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
const PAY_CODE_NOTE_IOS = 'Un code d\'offre reçu d\'Apple se saisit avec « J\'ai un code d\'offre Apple », dans la fenêtre d\'Apple.';

let payBusy = false;   // un seul achat, une seule restauration à la fois

// ── Petits gabarits ─────────────────────────────────────────

// État en clair, pour les Réglages et l'écran d'abonnement
const ACCESS_STATUS_TEXT = {
  none: 'Sans abonnement', active: 'Abonné', expired: 'Abonnement terminé',
  gift: 'Accès offert', coach_team: 'Offert par ton coach', unknown: 'Pas à jour',
};
function accessStatusText() {
  const st = accessStatus();
  if (accessGiftForever()) return 'Accès offert à vie';
  if (st === 'active' && accessIntroUntil()) return 'Essai gratuit';
  return ACCESS_STATUS_TEXT[st] || ACCESS_STATUS_TEXT.unknown;
}

// Valeur courte affichée dans la cellule des Réglages (un mot : sur 320 pt, « Tout est ouvert » collait au titre)
function accessShortValue() {
  if (!paywallOn()) return 'Ouvert';
  if (accessStatus() === 'coach_team') return 'Offert';
  return accessStatusText();
}

// « Offert par ton coach lucas » (pseudo du serveur, sinon celui du coach connu de l'app)
function payCoverName(cover) {
  return cover?.coach || (typeof myCoach === 'function' && myCoach() ? personName(myCoach()) : '');
}
function payCoverTitle(cover) {
  const name = payCoverName(cover);
  return name ? `Offert par ton coach ${name}` : 'Offert par ton coach';
}
// Ce qu'on dit à l'élève de son offre : { tone: 'ok' | 'warn', text } ou null (pas de coach, verrou éteint)
function payCoverNote() {
  const cover = accessCoachCover();
  if (!cover || !paywallOn()) return null;
  const name = payCoverName(cover) || 'ton coach';
  const mine = accessStatus() === 'active';   // il paie aussi lui-même
  // Offert sans rien payer : le titre le dit déjà (« Offert par ton coach <nom> », « Rien à payer »)
  if (cover.state === 'active') {
    return mine ? { tone: 'ok', text: `Ton coach ${name} t'offre l'accès : tu peux résilier ton propre abonnement dans « Gérer chez Apple ».` } : null;
  }
  if (cover.state === 'grace') {
    return { tone: 'warn', text: `Ton coach ${name} a arrêté ou changé son abonnement coach. Ton accès reste offert jusqu'au ${cover.until ? fmtDate(cover.until) : 'dans quelques jours'}${mine ? '' : ' ; ensuite, tu pourras t\'abonner si tu veux continuer'}.` };
  }
  if (mine) return null;
  return { tone: 'warn', text: cover.state === 'over_limit'
    ? `Ton coach ${name} suit plus d'élèves que sa formule n'en comprend : ton accès n'est plus offert. Il peut passer à la formule au-dessus. En attendant, tu peux t'abonner toi-même.`
    : `Ton coach ${name} n'a pas d'abonnement coach en cours : ton accès n'est pas offert. Tu peux t'abonner toi-même, ton historique reste là.` };
}
function payCoverNoteHtml() {
  const n = payCoverNote();
  return n ? `<div class="pay-note pay-cover pay-cover--${n.tone}" role="status"><p>${esc(n.text)}</p></div>` : '';
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

// Les entrées de code : le code cadeau MDLF (champ dans l'app), JAMAIS dans l'app iOS (règle 3.1.1,
// giftCodeInApp) ; dans l'app iOS, le code d'offre d'abonnement d'Apple (sa propre fenêtre)
function payCodeCellsHtml() {
  return `${giftCodeInApp(Native.platform) ? '<button class="cell cell--action" data-action="pay-code"><span class="cell__title">J\'ai un code</span></button>' : ''}
          ${Native.store.available ? '<button class="cell cell--action" data-action="pay-apple-code"><span class="cell__title">J\'ai un code d\'offre Apple</span></button>' : ''}`;
}
// Note sous les codes : dans l'app iOS, seul le code d'offre d'Apple existe
function payCodeNoteHtml() {
  const note = giftCodeInApp(Native.platform) ? PAY_CODE_NOTE : Native.store.available ? PAY_CODE_NOTE_IOS : '';
  return note ? `<div class="group-foot">${note}</div>` : '';
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
// est éteint, sans compte, ou pour un abonné (essai d'Apple compris). Élève offert par son coach : seulement
// pendant les 7 jours de grâce (date de fin), et quand l'offre s'est arrêtée.
function accessBannerHtml() {
  if (!paywallOn()) return '';
  const cover = accessCoachCover();
  if (canWrite() && cover?.state === 'grace' && accessStatus() === 'coach_team') {
    return `
        <button class="pay-banner" data-action="access-open-settings">
          <span class="pay-banner__text">${esc(`Offert par ton coach jusqu'au ${cover.until ? fmtDate(cover.until) : '…'}`)}</span>
          <span class="pay-banner__more">Voir ${icon('chevron.right', 12)}</span>
        </button>`;
  }
  if (!canWrite()) {
    // Des séances que le compte a refusées (verrou du serveur) : on le dit, elles restent ici
    const n = typeof accountLockedCount === 'function' ? accountLockedCount() : 0;
    const txt = n
      ? `${plural(n, 'séance n\'est pas sauvegardée', 'séances ne sont pas sauvegardées')} sur ton compte`
      : cover?.state === 'over_limit' || cover?.state === 'ended' ? 'Ton accès n\'est plus offert par ton coach'
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
  // Essai coach offert (offre promotionnelle signée) : seulement quand l'essai de lancement n'est plus accordé
  const promo = opts.current ? null : accessCoachPromoFor(p);
  const trial = p.trial ? `${payDurationText(p.trial)} ${p.trial.value > 1 || p.trial.unit === 'month' ? 'gratuits' : 'gratuit'}`
    : promo ? `${payDurationText(promo)} ${promo.value > 1 || promo.unit === 'month' ? 'offerts' : 'offert'}` : '';
  const months = opts.months ? `soit ${planMonthsText(opts.months)}` : '';
  const sub = [months, trial].filter(Boolean).join(', ');
  return `
          <button class="pay-plan${opts.current ? ' pay-plan--current' : ''}" data-action="pay-buy" data-id="${esc(p.id)}"${promo ? ' data-promo="1"' : ''} ${access.buying || opts.current ? 'disabled' : ''}>
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
const PAY_BENEFITS = 'Avec l\'abonnement, tu enregistres de nouvelles séances et tu peux mettre une vraie photo de profil. Ton historique, tes progrès et l\'export restent ouverts, abonné ou non.';
const PAY_COACH_BENEFITS = 'Tes élèves n\'ont rien à payer : l\'abonnement coach comprend ton propre accès complet, le leur et leur suivi. Tu peux changer de palier à tout moment chez Apple.';

// Mentions exigées par Apple (règle 3.1.2) à côté des boutons d'achat : durée de l'essai, prix et
// période après l'essai, renouvellement automatique, résiliation à tout moment. Tout est lu chez
// StoreKit ; les liens Conditions et Confidentialité suivent (payLegalHtml).
function payTermsHtml(list) {
  const trial = list.find(p => p.trial);
  const promo = trial ? null : list.map(p => accessCoachPromoFor(p)).find(Boolean);
  const prices = list.map(p => `${esc(p.price)} ${payPer(p)}`).join(' ou ');
  const first = trial
    ? `Essai gratuit de ${esc(payDurationText(trial.trial))}, puis ${prices} selon la formule choisie. Le paiement est débité sur ton compte Apple à la fin de l'essai, sauf si tu le résilies au moins 24 heures avant la fin de l'essai.`
    : promo
    ? `Essai coach : ${esc(payDurationText(promo))} offerts, puis ${prices} selon la formule choisie. Le paiement est débité sur ton compte Apple à la fin de l'essai, sauf si tu le résilies au moins 24 heures avant la fin de l'essai.`
    : `${prices} selon la formule choisie, débité sur ton compte Apple à la confirmation de l'achat.`;
  // Conditions de l'offre (règle 3.1.2 et page Abonnements d'Apple : dire les limites d'éligibilité)
  const promoRule = promo ? '<p>Essai coach réservé aux coachs vérifiés qui n\'ont jamais eu d\'abonnement coach, une seule fois par compte. Si Apple ne l\'accepte pas, rien n\'est débité.</p>' : '';
  return `
        <div class="pay-terms" role="note">
          <p>${first}</p>${promoRule}
          <p>L'abonnement se renouvelle automatiquement pour la même période, sauf si tu le résilies au moins 24 heures avant la fin de la période en cours. Tu peux le résilier à tout moment dans les réglages de ton identifiant Apple.</p>
        </div>`;
}

// ── Particulier, coach ──────────────────────────────────────

let payCoachPeriod = 'month';   // onglet Coach : Mensuel ou Annuel

// Formules du particulier (mensuel, annuel « soit 8,5 mois »)
function payProHtml(list) {
  const pro = list.filter(p => planOf(p.id)?.tier.key === 'pro');
  if (!pro.length) return payMissingHtml();
  return `<p class="pay-benefits">${PAY_BENEFITS}</p>
        <div class="pay-plans">${pro.map(p => payPlanHtml(p, { months: payYearMonths(list, p) })).join('')}</div>${payTermsHtml(pro)}${payLegalHtml()}`;
}

// Paliers coach, réservés à un coach validé : 4 formules pour la période choisie, nombre d'élèves suivis,
// palier conseillé (celui qui les contient, ou celui demandé par le bandeau « passe au palier
// supérieur »), formule en cours marquée « Ta formule ».
function payCoachHtml(list, pre) {
  const tier = coachPro.tier;
  const students = tier ? tier.students : (coach.state?.students.length ?? 0);
  const current = tier?.product_id || null;
  // Élèves au-delà de la formule : le palier qui les contient tous (leur accès offert revient)
  const wanted = planOf(pre)?.tier.coach ? planOf(pre).tier
    : tier?.uncovered > 0 ? planTierFor(students)
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
  // personne serait débitée 3 mois plus tard (relecture du 28/10). Vaut aussi pour les paliers coach.
  // Restaurer et les codes restent.
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
  // Élève offert par son coach (ou dans les 7 jours de grâce) : rien à acheter, il ne paie pas
  if (accessStatus() === 'coach_team') return '';
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
  const value = st === 'pending' ? 'En vérification' : st === 'rejected' ? 'Demande refusée' : '';
  return `
        <div class="group">
          <button class="cell cell--nav" data-action="coach-request-open">
            <span class="cell__body"><span class="cell__title">Tu es coach&nbsp;?</span><span class="cell__sub">Éducateur sportif diplômé : fais vérifier ta carte</span></span>
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
  // Onglet Coach sans essai de lancement : l'essai coach offert, s'il est accordé
  const promo = coachTab && !trial ? shown.map(p => accessCoachPromoFor(p)).find(Boolean) : null;
  const off = !paywallOn();
  // Élève offert par son coach : « Offert par ton coach <nom> », rien à acheter
  const offered = !off && !coachTab && accessStatus() === 'coach_team';
  // Accès à vie offert, onglet Particulier : rien à acheter, le haut de l'écran le dit aussi
  const forever = !off && !coachTab && accessGiftForever();
  const title = off ? 'Tout est ouvert' : coachTab ? 'MDLF Training pour coachs' : forever ? 'Accès offert à vie'
    : offered ? payCoverTitle(accessCoachCover()) : end ? 'Abonnement nécessaire' : 'MDLF Training, sans limite';
  // Formulation exacte : l'abonnement continue tout seul après l'essai, et Apple demande de résilier au
  // moins 24 h avant sa fin (https://support.apple.com/en-us/118428)
  const sub = off ? 'L\'abonnement n\'est pas encore demandé.'
    : forever ? 'Tu enregistres tes séances sans abonnement.'
    : offered ? 'Tu n\'as rien à payer tant que ton coach te suit.'
    : trial
    ? `${esc(payDurationText(trial.trial))} gratuits, puis l'abonnement continue sauf si tu le résilies au moins 24 heures avant la fin de l'essai.`
    : promo
    ? `Essai coach : ${esc(payDurationText(promo))} offerts, puis l'abonnement continue sauf si tu le résilies au moins 24 heures avant la fin de l'essai.`
    : 'Pour enregistrer de nouvelles séances, choisis une formule.';
  const stale = accessStale() && account.user ? `<p class="social-inline-error" role="status">${esc(access.error === 'offline' ? 'Pas d\'Internet : état pas à jour.' : 'État pas à jour.')}</p>` : '';
  const planned = Native.store.available && access.products?.length && !off;
  return `
    <div class="view view--grouped pay-view">
      ${head}
      <div class="scr">
        ${stale}
        <div class="social-hero pay-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon(coachTab ? 'coach' : 'flame', 40)}</span>
          <h2 class="social-hero__title">${title}</h2>
          <p class="social-hero__sub">${sub}</p>
        </div>
        ${payTabsHtml(coachTab ? 'coach' : 'pro')}
        ${coachTab ? '' : payCoverNoteHtml()}
        ${payPlansHtml(coachTab ? 'coach' : 'pro', pre)}
        <div class="group">
          <button class="cell cell--action" data-action="pay-restore"><span class="cell__title">Restaurer mes achats</span></button>
          ${payCodeCellsHtml()}
        </div>
        ${payCodeNoteHtml()}
        ${forever || offered ? '' : '<div class="group-foot">Un identifiant Apple n\'a droit qu\'à un seul essai gratuit, et un même abonnement ne peut servir qu\'à un compte MDLF.</div>'}
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
    // Essai coach offert : seulement pour un coach validé (les autres ne voient pas les paliers)
    if (account.user && coachRole().isCoach) accessLoadCoachPromo();
  },
});

// ── Réglages › Abonnement ──────────────────────────────────

function renderAccessSettingsGroup() {
  if (!accountAvailable() || !account.user) return '';
  return `
        <div class="group">
          <button class="cell cell--nav" data-action="access-open-settings">
            ${cellIco('checkmark.seal', 'blue')}
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
  const endLabel = st === 'active' ? 'Renouvellement' : st === 'coach_team' ? 'Offert jusqu\'au' : 'Fin';
  // Essai gratuit d'Apple en cours : « Essai gratuit jusqu'au <date>, puis <prix> » (formule lue sur
  // l'iPhone, prix lu chez StoreKit ; sans eux, la date seule)
  const plan = intro ? (access.products || []).find(p => p.id === access.currentProduct) : null;
  const introLine = intro ? `Essai gratuit jusqu'au ${fmtDate(intro)}${plan ? `, puis ${plan.price} ${payPer(plan)}` : ''}` : '';
  const offNote = !on ? `
        <div class="group-foot">Tout est ouvert pour l'instant : l'abonnement n'est pas encore demandé.</div>` : '';
  // Accès à vie offert ET abonnement particulier lu sur cet iPhone : peut-être encore facturé (le
  // renouvellement automatique n'est pas lu, d'où le conditionnel). Un palier coach, lui, reste utile :
  // il donne le nombre d'élèves
  const alsoNote = on && accessGiftForever() && access.currentProduct && !planIsCoach(access.currentProduct) ? `
        <div class="group-foot" role="note">Si ton abonnement Apple se renouvelle encore, tu peux le résilier dans « Gérer chez Apple » : l'accès offert à vie suffit.</div>` : '';
  // Élève offert par son coach : « Offert par ton coach <nom> » en clair (titre sur toute la largeur)
  const offered = on && st === 'coach_team';
  const rows = `
        <div class="group">
          ${offered ? `<div class="cell pay-cover-cell">
            <span class="cell__body"><span class="cell__title">${esc(payCoverTitle(accessCoachCover()))}</span><span class="cell__sub">Rien à payer</span></span>
          </div>` : `<div class="cell">
            <span class="cell__body"><span class="cell__title">État</span></span>
            <span class="cell__value">${esc(on ? accessStatusText() : 'Tout est ouvert')}</span>
          </div>`}
          ${!introLine && until ? `<div class="cell">
            <span class="cell__body"><span class="cell__title">${endLabel}</span></span>
            <span class="cell__value">${esc(fmtDate(until))}</span>
          </div>` : ''}
        </div>${introLine ? `
        <div class="group-foot pay-intro-line">${esc(introLine)}.</div>` : ''}${offNote}${alsoNote}${payCoverNoteHtml()}`;
  const actions = `
        <div class="group">
          ${on && (st === 'none' || st === 'expired' || st === 'unknown')
            ? '<button class="cell cell--action" data-action="pay-open" data-reason="offer"><span class="cell__title">Voir les formules</span></button>' : ''}
          ${on && coachRole().isCoach ? `<button class="cell cell--action" data-action="pay-open" data-reason="offer" data-tab="coach"><span class="cell__title">${planIsCoach(access.currentProduct) ? 'Changer de palier coach' : 'Voir les formules coach'}</span></button>` : ''}
          ${Native.store.available ? '<button class="cell cell--action" data-action="pay-manage"><span class="cell__title">Gérer chez Apple</span></button>' : ''}
          <button class="cell cell--action" data-action="pay-restore"><span class="cell__title">Restaurer mes achats</span></button>
          ${payCodeCellsHtml()}
        </div>
        ${payCodeNoteHtml()}
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
    if (!giftCodeInApp(Native.platform)) return;   // app iOS : pas de code maison (règle 3.1.1)
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
    accessUntil(), accountLockedCount(), accessCoachCover()]);
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
// Rôle coach, palier, coach de l'élève : l'écran d'abonnement en dépend (onglet Coach, nom du coach)
onCoachChange(() => { if (PAYWALL_VIEWS.includes(currentView()) && !document.activeElement?.matches?.('input, textarea, select')) render(); });
// La synchro aussi change ce qui est montré : une séance refusée par le compte (verrou du serveur)
// doit apparaître dans le bandeau sans attendre le prochain dessin
onAccountChange(() => { accessApplyChange(); });
document.addEventListener('focusout', () => { if (accessShownKey() !== accessShown) setTimeout(accessApplyChange, 0); });

// Écouteur permanent des transactions d'Apple : posé une fois au chargement
accessOnTransaction();
