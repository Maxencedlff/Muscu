// ═══════════════════════════════════════════════════════════
//  Réglages › Compte : connexion avec Apple, état de la synchronisation, déconnexion, suppression
//  (la logique est dans js/data/account.js et js/data/sync.js)
// ═══════════════════════════════════════════════════════════
'use strict';

// Logo Apple du bouton « Se connecter avec Apple » (charte Apple : logo, texte, fond noir ou blanc)
const APPLE_LOGO = '<svg class="siwa__logo" viewBox="0 0 170 170" aria-hidden="true" focusable="false"><path fill="currentColor" d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.2-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.27 2.13-9.51 3.24-12.75 3.35-4.93.21-9.84-1.96-14.75-6.52-3.13-2.73-7.05-7.41-11.74-14.04-5.03-7.08-9.17-15.29-12.41-24.65-3.47-10.11-5.21-19.9-5.21-29.38 0-10.86 2.35-20.22 7.04-28.07 3.69-6.3 8.6-11.27 14.75-14.92s12.79-5.51 19.95-5.63c3.91 0 9.05 1.21 15.43 3.59 6.36 2.39 10.45 3.6 12.24 3.6 1.34 0 5.88-1.42 13.57-4.24 7.27-2.62 13.41-3.7 18.44-3.28 13.63 1.1 23.87 6.47 30.68 16.15-12.19 7.39-18.22 17.73-18.1 31 .11 10.34 3.86 18.94 11.23 25.77 3.34 3.17 7.07 5.62 11.22 7.36-.9 2.61-1.85 5.11-2.86 7.51zM119.11 7.24c0 8.1-2.96 15.67-8.86 22.67-7.12 8.32-15.73 13.13-25.07 12.37a25.2 25.2 0 0 1-.19-3.07c0-7.78 3.39-16.1 9.4-22.9 3-3.44 6.82-6.31 11.45-8.6 4.62-2.25 8.99-3.5 13.1-3.71.12 1.08.17 2.17.17 3.24z"/></svg>';

// Emplacement de la rubrique (absente dans le navigateur ou une coquille iOS sans le module)
function renderAccountGroup() {
  if (!accountAvailable()) return '';
  return `
        <div class="group-title">Compte</div>
        <div id="accountGroup">${renderAccountGroupInner()}</div>`;
}

function syncStatusText() {
  if (account.syncing) return 'Synchronisation…';
  if (account.error) return 'Pas de connexion : tout sera envoyé au prochain essai';
  if (account.lastSync) return `Synchronisé ${agoText(account.lastSync)}`;
  return 'Synchronisation au prochain passage';
}

function renderAccountGroupInner() {
  if (!account.ready) {
    return `<div class="group"><div class="cell"><span class="cell__body"><span class="cell__sub">Chargement…</span></span></div></div>`;
  }
  if (!account.user) {
    return `
        <div class="group">
          <div class="cell cell--wrap">
            <span class="cell__body">
              <span class="cell__title">Sauvegarde et synchro</span>
              <span class="cell__sub">Tes séances et programmes, gardés sur ton compte et retrouvés sur un autre iPhone. Facultatif : l'app marche sans compte.</span>
            </span>
          </div>
          <div class="cell cell--ctl">
            <button class="siwa" data-action="account-sign-in">${APPLE_LOGO}<span>Se connecter avec Apple</span></button>
          </div>
        </div>
        <div class="group-foot">Ni nom ni e-mail demandés. Ton poids et tes données Santé restent sur l'iPhone.</div>`;
  }
  return `
        <div class="group">
          <div class="cell">
            <span class="cell__body">
              <span class="cell__title">Connecté avec Apple</span>
              <span class="cell__sub" id="syncStatus">${esc(syncStatusText())}</span>
            </span>
          </div>
          <button class="cell cell--action" data-action="account-sync" ${account.syncing ? 'disabled' : ''}><span class="cell__title">Synchroniser maintenant</span></button>
          <button class="cell cell--action" data-action="account-sign-out"><span class="cell__title">Se déconnecter</span></button>
          <button class="cell cell--destructive cell--left" data-action="account-delete"><span class="cell__title">Supprimer mon compte</span></button>
        </div>
        <div class="group-foot">Synchronisation automatique à chaque séance. Se déconnecter garde tes données sur cet iPhone.</div>`;
}

registerActions({
  'account-sign-in': async (e, el) => {
    if (el) el.disabled = true;
    try { await accountSignIn(); } finally { refreshAccountUI(); }
  },
  'account-sync': async () => {
    const ok = await syncNow();
    showToast(ok ? 'Synchronisé' : 'Pas de connexion : réessaie plus tard', { error: !ok });
  },
  'account-sign-out': async () => {
    if (!(await confirmSheet('Se déconnecter ?', 'Tes données restent sur cet iPhone et sur ton compte. Tu pourras te reconnecter à tout moment.', 'Se déconnecter'))) return;
    await accountSignOut();
    showToast('Déconnecté');
  },
  'account-delete': async () => {
    if (!(await confirmSheet('Supprimer ton compte ?',
      'Ton compte et tout ce qui est sauvegardé dessus seront effacés définitivement. Apple te demandera de confirmer avec Face ID.',
      'Supprimer mon compte'))) return;
    const res = await accountDelete();
    if (!res.ok) return;
    const wipe = await dialog({ type: 'sheet', title: 'Compte supprimé',
      message: 'Que faire des données de cet iPhone ?',
      actions: [
        { label: 'Les garder sur cet iPhone', value: 'keep', style: 'preferred' },
        { label: 'Les effacer aussi', value: 'wipe', style: 'destructive' },
      ] });
    if (wipe === 'wipe') { data = makeDefaultData(); save(true); render(); }
    if (!res.revoked) {
      await dialog({ title: 'Dernière étape', message: 'Pour retirer aussi l\'accès dans ton identifiant Apple : Réglages de l\'iPhone › ton nom › Connexion et sécurité › Se connecter avec Apple › MDLF Training › Arrêter d\'utiliser.',
        actions: [{ label: 'OK', style: 'preferred' }] });
    } else showToast('Compte supprimé');
  },
});
