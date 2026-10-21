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
    if (restored) resumeRest(restored.rest);
    const draft = !restored && restoreAddDraft();
    navBoot(restored ? { tab: 'train', route: 'session' } : draft ? { tab: 'history', route: 'add-session' } : null);
    if (draft) addSnapshot = '';  // brouillon repris : toute sortie demande confirmation
  } catch (err) {
    console.error(err);
    renderRescue();
    Native.hideSplash();
    return;
  }
  Native.hideSplash();
  Native.statusBar(!document.body.classList.contains('light'));
  liveUpdateBoot();   // app iOS : confirme ce contenu (sinon retour au précédent) et cherche une mise à jour
  // Demande au navigateur de ne pas effacer les données en cas de manque d'espace
  try { navigator.storage?.persisted?.().then(p => { if (!p) navigator.storage.persist?.(); }).catch(() => {}); } catch {}
  registerServiceWorker();
});
