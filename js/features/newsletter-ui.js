// ═══════════════════════════════════════════════════════════
//  Lettre d'information, écran Compte : un interrupteur ÉTEINT par défaut, le texte exact du
//  consentement dessous, et le lien vers la confidentialité. Données : js/data/newsletter.js ;
//  contrat : docs/NEWSLETTER.md.
//  - L'interrupteur n'est allumé que si le SERVEUR dit que le compte est inscrit ; état inconnu
//    (chargement, hors ligne) : éteint et désactivé, avec la raison en clair.
//  - Toucher l'interrupteur est le geste de consentement (inscription) ou de retrait (désinscription),
//    au clic seulement (rien au pointerdown). Aucune inscription ailleurs dans l'app.
// ═══════════════════════════════════════════════════════════
'use strict';

function newsletterSubText() {
  const st = newsletter.state;
  if (newsletter.busy) return 'Enregistrement…';
  if (!st) return newsletter.error ? `Lettre d'information indisponible. ${newsletterErrorText(newsletter.error)}` : 'Chargement…';
  return st.subscribed && st.consentedAt
    ? `Inscrit depuis le ${new Date(st.consentedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'Désactivée';
}

// Groupe de l'écran Compte (appelé par renderAccount, js/features/account-ui.js)
function renderNewsletterGroup() {
  const st = newsletter.state;
  const on = st?.subscribed === true;
  const off = !st || newsletter.busy;
  return `
        <div class="group-title">Lettre d'information</div>
        <div class="group">
          <button class="cell" data-action="newsletter-toggle" role="switch" aria-checked="${on}" aria-describedby="newsletterConsent" ${off ? 'disabled' : ''}>
            <span class="cell__body"><span class="cell__title">Recevoir la lettre par e-mail</span>
              <span class="cell__sub" id="newsletterSub">${esc(newsletterSubText())}</span></span>
            <span class="switch ${on ? 'switch--on' : ''}" aria-hidden="true"><span class="switch__thumb"></span></span>
          </button>
        </div>
        <div class="group-foot" id="newsletterConsent">${esc(NEWSLETTER_CONSENT_TEXT)} Envoyée à l'adresse de ton compte. <button class="link-inline" data-action="newsletter-privacy">Confidentialité</button></div>`;
}

registerActions({
  'newsletter-toggle': async () => {
    const st = newsletter.state;
    if (!st || newsletter.busy) return;
    const want = !st.subscribed;
    const r = await newsletterSet(want);
    if (!r.ok) {
      if (r.kind !== 'busy') { haptic(); showToast(newsletterErrorText(r.kind)); }
      return;
    }
    haptic();
    showToast(want ? 'Inscription enregistrée' : 'Tu es désinscrit');
  },
  'newsletter-privacy': () => { window.open(LEGAL_URLS.newsletter, '_blank'); },
});

// Redessin quand l'état arrive, seulement sur l'écran Compte
onNewsletterChange(() => { if (currentView() === 'account') render(); });
