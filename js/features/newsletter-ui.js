// ═══════════════════════════════════════════════════════════
//  Lettre d'information, écran Compte : un interrupteur ÉTEINT par défaut, le texte exact du
//  consentement dessous, et le lien vers la confidentialité. Données : js/data/newsletter.js ;
//  contrat : docs/NEWSLETTER.md.
//  - L'interrupteur n'est allumé que si le SERVEUR dit que le compte est inscrit ; état inconnu
//    (chargement, hors ligne) : éteint et désactivé, avec la raison en clair, et « Réessayer » après
//    un échec. Compte sans adresse (Apple seul) : éteint et désactivé, avec ce qu'il faut ajouter
//    (se désinscrire reste possible si une inscription existe déjà).
//  - L'état est relu à l'ouverture de l'écran (crochet enter, account-ui.js) et quand le compte
//    change pendant que l'écran est ouvert (connexion faite sur l'écran Compte, session restaurée).
//  - Toucher l'interrupteur est le geste de consentement (inscription) ou de retrait (désinscription),
//    au clic seulement (rien au pointerdown). Aucune inscription ailleurs dans l'app.
// ═══════════════════════════════════════════════════════════
'use strict';

function newsletterSubText() {
  const st = newsletter.state;
  if (newsletter.busy) return 'Enregistrement…';
  if (!st) return newsletter.error ? `Lettre d'information indisponible. ${newsletterErrorText(newsletter.error)}` : 'Chargement…';
  if (!st.hasEmail) return NEWSLETTER_NO_EMAIL_TEXT;
  return st.subscribed && st.consentedAt
    ? `Inscrit depuis le ${new Date(st.consentedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'Désactivée';
}

// Groupe de l'écran Compte (appelé par renderAccount, js/features/account-ui.js)
function renderNewsletterGroup() {
  const st = newsletter.state;
  const on = st?.subscribed === true;
  const off = !st || newsletter.busy || (!on && !st.hasEmail);
  const retry = !st && newsletter.error && !newsletter.loading;
  return `
        <div class="group-title">Lettre d'information</div>
        <div class="group">
          <button class="cell" data-action="newsletter-toggle" role="switch" aria-checked="${on}" aria-describedby="newsletterConsent" ${off ? 'disabled' : ''}>
            <span class="cell__body"><span class="cell__title">Recevoir la lettre par e-mail</span>
              <span class="cell__sub" id="newsletterSub">${esc(newsletterSubText())}</span></span>
            <span class="switch ${on ? 'switch--on' : ''}" aria-hidden="true"><span class="switch__thumb"></span></span>
          </button>
          ${retry ? '<button class="cell cell--action" data-action="newsletter-retry"><span class="cell__title">Réessayer</span></button>' : ''}
        </div>
        <div class="group-foot" id="newsletterConsent">${esc(NEWSLETTER_CONSENT_TEXT)} Envoyée à l'adresse de ton compte. <button class="link-inline" data-action="newsletter-privacy">Confidentialité</button></div>`;
}

registerActions({
  'newsletter-toggle': async () => {
    const st = newsletter.state;
    if (!st || newsletter.busy || (!st.subscribed && !st.hasEmail)) return;
    const want = !st.subscribed;
    const r = await newsletterSet(want);
    if (!r.ok) {
      if (r.kind !== 'busy') { haptic(); showToast(newsletterErrorText(r.kind)); }
      return;
    }
    haptic();
    showToast(want ? 'Inscription enregistrée' : 'Tu es désinscrit');
  },
  // Relecture après un échec : « Chargement… » tout de suite, puis l'état ou la raison
  'newsletter-retry': () => { newsletter.error = null; newsletterRefresh(); render(); },
  'newsletter-privacy': () => { window.open(LEGAL_URLS.newsletter, '_blank'); },
});

// Redessin quand l'état arrive, seulement sur l'écran Compte
onNewsletterChange(() => { if (currentView() === 'account') render(); });
// Compte changé l'écran ouvert (connexion faite ici, session restaurée, adresse ajoutée) : relire
// l'état. Écouteur posé après celui de newsletter.js (remise à zéro) et avant le redessin de
// account-ui.js, qui affiche donc « Chargement… » puis l'état.
onAccountChange(() => { if (currentView() === 'account' && newsletterNeedsRefresh(newsletter, account.user)) newsletterRefresh(); });
