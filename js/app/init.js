// ═══════════════════════════════════════════════════════════
//  Démarrage, écouteurs globaux, wake lock, écran de secours
// ═══════════════════════════════════════════════════════════
'use strict';

// Tout clic sur un élément [data-action] passe par le registre ; la séance est sauvegardée après chaque action
document.addEventListener('click', async e => {
  const el     = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  try { await handleAction(e, el, action); }
  finally { persistSession(); }
});

// Saisie en direct : séries de la séance, séance passée et notes suivent les champs
document.addEventListener('input', e => {
  const action = e.target.dataset.action;
  // Une saisie corrige l'erreur signalée
  if (e.target.getAttribute?.('aria-invalid') === 'true') {
    e.target.removeAttribute('aria-invalid');
    e.target.classList.remove('set-input--error');
  }

  if (activeSession) {
    const ei = parseInt(e.target.dataset.ei);
    const si = parseInt(e.target.dataset.si);
    if (!isNaN(ei) && !isNaN(si)) {
      if (action === 'set-weight') activeSession.exercises[ei].sets[si].weight = storeW(e.target.value);
      if (action === 'set-reps')   activeSession.exercises[ei].sets[si].reps   = e.target.value;
      if (action === 'set-dist')   setDist(activeSession.exercises[ei].sets[si], e.target.value);
    }
  }

  // Série validée rouverte : saisie gardée jusqu'à l'enregistrement
  if (editingSet && (e.target.id === 'editSetWeight' || e.target.id === 'editSetReps')) {
    editingSet[e.target.id === 'editSetWeight' ? 'weight' : 'reps'] = e.target.value;
  }

  if (currentView() === 'add-session') {
    const exid = e.target.dataset.exid;
    const si   = parseInt(e.target.dataset.si);
    if (exid && !isNaN(si) && addSets[exid]) {
      if (action === 'add-weight') addSets[exid][si].weight = storeW(e.target.value);
      if (action === 'add-reps')   addSets[exid][si].reps   = e.target.value;
      if (action === 'add-dist')   setDist(addSets[exid][si], e.target.value);
      const saveBtn = $('[data-action="save-past-session"]');
      if (saveBtn) saveBtn.disabled = !addHasReps();
    }
    if (action === 'add-date')        addDate  = e.target.value;
    if (action === 'add-notes-input') addNotes = e.target.value;
  }
  if (action === 'session-notes') sessionNotes = e.target.value;
  if (activeSession) persistSession();
});

// iOS peut tuer l'app en arrière-plan : on sauvegarde au moment où elle disparaît
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistSession(); });
window.addEventListener('pagehide', persistSession);

// ── Wake Lock ───────────────────────────────────────────────

let wakeLock = null;

async function requestWakeLock() {
  try {
    if (Native.keepAwake(true)) return;   // app iOS : écran allumé natif
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}

async function releaseWakeLock() {
  if (Native.keepAwake(false)) return;
  try { if (wakeLock) { await wakeLock.release(); wakeLock = null; } } catch {}
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && currentView() === 'session') {
    await requestWakeLock();
  }
});

// ── Écran de secours (donnée illisible) ─────────────────────

function renderRescue() {
  dataBroken = true;
  clearInterval(ticker);
  let hasBackup = false;
  try { hasBackup = !!localStorage.getItem(BACKUP_KEY); } catch {}
  $('#app').innerHTML = `
    <div class="rescue" role="alert">
      <div class="rescue__title">Données illisibles</div>
      <p class="rescue__msg">L'app n'arrive pas à lire tes données. Rien n'a été effacé : choisis quoi faire.</p>
      ${hasBackup ? '<button class="btn btn--primary btn--full" id="rescueRestore">Restaurer la sauvegarde précédente</button>' : ''}
      <button class="btn btn--secondary btn--full" id="rescueExport">Exporter les données brutes</button>
      <button class="btn btn--danger btn--full" id="rescueReset">Réinitialiser</button>
    </div>`;
  $('#rescueRestore')?.addEventListener('click', () => {
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      normalizeData(JSON.parse(raw)); // vérifie qu'elle se lit avant de l'écrire
      localStorage.setItem(KEY, raw);
      clearSyncMetas();               // compte : repartir du compte, sans supprimer ce qui manque ici
      location.reload();
    } catch { showToast('La sauvegarde est illisible elle aussi', { duration: 4000 }); }
  });
  $('#rescueExport').addEventListener('click', () => {
    let raw = '';
    try { raw = localStorage.getItem(KEY) || ''; } catch {}
    downloadText(raw, `muscu-donnees-brutes-${localISO()}.json`);
  });
  $('#rescueReset').addEventListener('click', async () => {
    if (!(await confirmSheet('Tout réinitialiser ?', 'Ton historique et tes exercices seront effacés. Exporte d\'abord les données brutes si tu veux les garder.', 'Réinitialiser'))) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) localStorage.setItem(BACKUP_KEY, raw);
      const d = freshData();
      localStorage.setItem(KEY, JSON.stringify(d));
      localStorage.removeItem(SESSION_KEY);
      clearSyncMetas();   // compte : l'historique vidé ici ne part pas en suppressions, le compte le rendra
    } catch {}
    location.reload();
  });
}

// ── Démarrage ───────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // App iOS : stockage web vide mais copie de sécurité présente → elle est restaurée (rechargement)
  if (await Native.boot()) return;
  if (loadError) { renderRescue(); Native.hideSplash(); return; }
  try {
    syncTimersFromHistory();
    // Séance restaurée (avec son repos), sinon séance passée en cours de saisie
    const restored = restoreSession();
    if (restored) { resumeRest(restored.rest); resumeEffort(); }
    const draft = !restored && restoreAddDraft();
    navBoot(restored ? { tab: 'train', route: 'session' } : draft ? { tab: 'history', route: 'add-session' } : null);
    if (draft) addSnapshot = '';  // brouillon repris : toute sortie demande confirmation
  } catch (err) {
    console.error(err);
    renderRescue();
    Native.hideSplash();
    return;
  }
  watchBoot();   // app iOS : Apple Watch, une fois la séance restaurée (js/features/watch.js)
  // App iOS, tout premier lancement : écran Bienvenue (jamais un mur : « Commencer sans compte »)
  let welcome;
  try { welcome = await maybeShowWelcome(); } catch { /* l'app reste utilisable sans */ }
  // Puis les questions du premier lancement, pour un nouvel utilisateur sans données (compte neuf ou
  // sans compte) : décidées par onboardingNeeded() une fois les données du compte arrivées (première
  // synchro, whenAccountSettled), sans bloquer le démarrage. Un compte existant retrouvé apporte ses
  // séances et son choix déjà fait (data.onboarded) : pas de questions.
  const questions = () => whenAccountSettled().then(() => { try { maybeShowOnboarding(); } catch { /* l'accueil reste utilisable */ } });
  if (welcome) welcome.closed.then(questions);
  else questions();
  Native.hideSplash();
  Native.statusBar(!document.body.classList.contains('light'));
  prefetchBodyMass(); // app iOS : dernière pesée de Santé, pour le volume au poids du corps
  if (noteAppVersion(data, currentBuild()?.version)) save(true);   // version du contenu notée dans le profil (js/data/sync.js)
  accountInit().catch(() => {}); // app iOS : compte (session du Trousseau, synchro) ; sans compte, rien
  maybeShowNativeUpdate();   // app iOS : nouvelle build dans TestFlight
  siriBoot().catch(() => {});   // app iOS : « Démarrer ma séance » demandé à Siri avant le lancement (js/features/siri.js)
  liveUpdateBoot();   // app iOS : confirme ce contenu (sinon retour au précédent) et cherche une mise à jour
  // Demande au navigateur de ne pas effacer les données en cas de manque d'espace
  try { navigator.storage?.persisted?.().then(p => { if (!p) navigator.storage.persist?.(); }).catch(() => {}); } catch {}
  registerServiceWorker();
});
