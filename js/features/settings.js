// ═══════════════════════════════════════════════════════════
//  Réglages
// ═══════════════════════════════════════════════════════════
'use strict';

// Confidentialité et mentions légales (page publique, privacy.html) ; _blank l'ouvre dans Safari
const LEGAL_URL = 'https://mdlf.app/privacy.html#mentions';

// « aujourd'hui », « hier », « il y a 3 jours » : jours du calendrier (dernier export, Supprimés récemment)
function agoText(ts) {
  const days = daysAgo(ts);
  if (days <= 0) return 'aujourd\'hui';
  if (days === 1) return 'hier';
  return `il y a ${days} jours`;
}

// Efface les données de cet appareil (copie de secours locale gardée, copie iCloud vidée aussi). Avec un
// compte, l'appelant détache d'abord l'appareil (accountForgetDevice) : rien n'est supprimé du compte.
function wipeLocalData() {
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify(data)); } catch {}
  if (activeSession) endSession();
  data = freshData();
  resetSelections();
  Native.eraseCloudOnNextSave();   // app iOS : la copie iCloud est vidée elle aussi
  photosWipe();                    // photos de progression (IndexedDB, js/data/progress-photos.js)
  save();
}

function renderSettings() {
  // Interrupteur iOS (le bouton de la rangée porte l'état pour VoiceOver)
  const tog = (on) => `<span class="switch ${on ? 'switch--on' : ''}" aria-hidden="true"><span class="switch__thumb"></span></span>`;
  const last  = data.lastExport;
  // Avec un compte, les séances sont déjà sauvegardées : l'export n'est qu'une copie en plus, sans alerte
  const stale = !account.user && (!last || Date.now() - last > 14 * 86400000);
  const nSess = (data.history || []).length;
  return `
    <div class="view settings-view view--grouped">
      ${navBar({ title: 'Réglages' })}
      <div class="scr">
${renderAccountGroup()}
${renderCoachSettingsGroup()}

        <div class="group-title">Séance</div>
        <div class="group">
          <button class="cell cell--nav" data-action="setting-rest">
            <span class="cell__body"><span class="cell__title">Repos par défaut</span></span>
            <span class="cell__value num">${fmtRest(data.defaultRest)}</span>
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell cell--nav" data-action="setting-weekly-goal">
            <span class="cell__body"><span class="cell__title">Objectif</span></span>
            <span class="cell__value num">${data.weeklyGoal ? `${data.weeklyGoal} / semaine` : `Auto · ${weeklyGoal()} / sem.`}</span>
            ${icon('chevron.right', 16)}
          </button>
          ${Native.isNative && data.healthOn === true ? '' : `<button class="cell cell--nav" data-action="set-body-weight">
            <span class="cell__body"><span class="cell__title">Poids du corps</span>
              <span class="cell__sub">Volume des tractions, dips, pompes</span></span>
            <span class="cell__value num"${data.bodyWeightKg ? '' : ' aria-label="Non renseigné"'}>${data.bodyWeightKg ? `${fmtW(data.bodyWeightKg)} ${unitLbl()}` : '—'}</span>
            ${icon('chevron.right', 16)}
          </button>`}
          <button class="cell" data-action="setting-sound" role="switch" aria-checked="${data.soundOn !== false}">
            <span class="cell__body"><span class="cell__title">Sons</span></span>
            ${tog(data.soundOn !== false)}
          </button>
          <button class="cell" data-action="setting-vibrate" role="switch" aria-checked="${data.vibrateOn !== false}">
            <span class="cell__body"><span class="cell__title">Vibrations</span></span>
            ${tog(data.vibrateOn !== false)}
          </button>
        </div>
${renderAppleServicesGroup(tog)}

        <div class="group-title">Affichage</div>
        <div class="group">
          <div class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Thème</span></span>
            <div class="segmented seg-sm" role="group" aria-label="Thème">
              ${[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) =>
                `<button class="segmented__btn ${themePref() === v ? 'segmented__btn--active' : ''}" aria-pressed="${themePref() === v}" data-action="set-theme" data-val="${v}">${l}</button>`).join('')}
            </div>
          </div>
          <div class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Unité</span></span>
            <div class="segmented seg-sm" role="group" aria-label="Unité de poids">
              ${['kg', 'lbs'].map(u => `<button class="segmented__btn ${data.unit === u ? 'segmented__btn--active' : ''}" aria-pressed="${data.unit === u}" data-action="setting-unit" data-val="${u}">${u}</button>`).join('')}
            </div>
          </div>
          <div class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Silhouette</span>
              <span class="cell__sub">Carte des muscles</span></span>
            ${silhouetteSegmentedHtml()}
          </div>
        </div>

${renderAppIconGroup()}

        <div class="group-title">Données</div>
        <div class="group">
          <div class="cell">
            <span class="cell__body"><span class="cell__title ${stale ? 'txt-warn' : ''}" id="lastExportTxt">${lastExportLabel()} : ${last ? agoText(last) : 'jamais'}</span></span>
          </div>
          <button class="cell cell--action" data-action="export"><span class="cell__title">Exporter les données</span></button>
          <button class="cell cell--action" data-action="import"><span class="cell__title">${account.user ? 'Importer un fichier d\'export' : 'Importer une sauvegarde'}</span></button>
          <button class="cell cell--nav" data-action="go-trash">
            <span class="cell__body"><span class="cell__title">Supprimés récemment</span></span>
            <span class="cell__value num">${trashCount() || ''}</span>
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell cell--destructive cell--left" data-action="wipe-data"><span class="cell__title">Supprimer toutes les données</span></button>
        </div>
        <div class="group-foot">${account.user ? 'Tes séances et programmes sont aussi sur ton compte. L\'export te donne en plus un fichier à garder où tu veux. Pour effacer aussi ton compte\u00a0: Compte › Supprimer mon compte.' : 'Exporte régulièrement : les données ne sont stockées que sur cet appareil.'} L'export contient tes mensurations, pas tes photos de progression (trop lourdes) : elles restent dans l'app, et « Supprimer toutes les données » les efface aussi.</div>

        <div class="group-title">À propos</div>
        <div class="group">
          <button class="cell cell--nav" data-action="go-guide"><span class="cell__body"><span class="cell__title">Guide de l'app</span></span>${icon('chevron.right', 16)}</button>
          <div class="cell">
            <span class="cell__body"><span class="cell__title">MDLF Training<span id="appVersion"></span> · ${plural(nSess, 'séance', 'séances')}</span></span>
          </div>
          ${Native.isNative
            ? `<button class="cell cell--action" data-action="live-update-check"><span class="cell__body"><span class="cell__title">Rechercher une mise à jour</span>
                 <span class="cell__sub">${esc(liveUpdateLabel())}</span></span></button>`
            : `<button class="cell cell--action" data-action="force-update"><span class="cell__title">Rechercher une mise à jour</span></button>`}
          <button class="cell cell--action" data-action="open-legal"><span class="cell__body"><span class="cell__title">Mentions légales</span>
            <span class="cell__sub">Confidentialité, éditeur, hébergeurs</span></span></button>
        </div>

      </div>
    </div>`;
}

// Version affichée dans À propos : lue dans le nom du cache du service worker (ppl-vNN)
function fillAppVersion() {
  const el = $('#appVersion');
  if (!el || !window.caches) return;
  caches.keys().then(keys => {
    const v = keys.map(k => (k.match(/v(\d+)$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => b - a)[0];
    if (v && $('#appVersion')) $('#appVersion').textContent = ` · v${v}`;
  }).catch(() => {});
}

function refreshLastExport() {
  const t = $('#lastExportTxt');
  if (t) { t.textContent = `${lastExportLabel()} : aujourd'hui`; t.classList.remove('txt-warn'); }
}

// Avec un compte, « sauvegarde » désigne le compte : le fichier s'appelle export
function lastExportLabel() { return account.user ? 'Dernier export' : 'Dernière sauvegarde'; }

// Sélections des écrans rattachées à la donnée remplacée : reprises sur le programme actif
function resetSelections() {
  addCat = firstSession();
}

// Fichier choisi dans « Importer une sauvegarde » : résultat affiché, « Annuler » pendant 6 s
function importFile(text) {
  const r = importText(text);
  if (!r.ok) {
    if (r.reason === 'invalid') showToast('Fichier invalide : rien n\'a été modifié', { error: true });
    return;
  }
  if (r.theme) applyTheme(r.theme);
  resetSelections();
  render();
  showToast(`Import réussi : ${r.count} séance${r.count > 1 ? 's' : ''}${r.skipped ? ` (${r.skipped} ignorée${r.skipped > 1 ? 's' : ''})` : ''}`, {
    action: 'Annuler', duration: IMPORT_UNDO_MS,
    onAction: () => {
      undoImport(r.previous);
      resetSelections();
      render(); showToast('Import annulé');
    },
  });
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'go-settings': () => {
    navigate('settings');
  },
  'set-theme': (e, el) => {
    setThemePref(el.dataset.val); render();
  },
  'setting-unit': (e, el) => {
    data.unit = el.dataset.val; save(); render();
  },
  'set-silhouette': (e, el) => {
    if (!SILHOUETTES.some(([v]) => v === el.dataset.val)) return;
    data.silhouette = el.dataset.val; save(); render();
  },
  'setting-sound': () => {
    data.soundOn = !data.soundOn; save(); render();
  },
  'setting-vibrate': () => {
    data.vibrateOn = !data.vibrateOn; save(); render();
  },
  'setting-rest': async () => {
    const v = await askNumber({ title: 'Repos par défaut', message: 'Durée entre deux séries, en secondes.', value: data.defaultRest, unit: 's', min: 10, max: 600 });
    if (v !== null) { data.defaultRest = v; save(); render(); }
  },
  // Objectif de séances par semaine (anneau de l'accueil) : « Auto » suit le nombre de séances du programme
  'setting-weekly-goal': async () => {
    const auto = Math.min(7, Math.max(1, sessionKeys().length));
    const choice = await dialog({ type: 'sheet', title: 'Objectif par semaine', message: 'Séances visées chaque semaine, pour l\'anneau de l\'accueil.', actions: [
      { label: `Auto : ${auto} séance${auto > 1 ? 's' : ''} (le programme)`, value: 'auto', style: data.weeklyGoal ? '' : 'preferred' },
      ...[2, 3, 4, 5, 6].map(n => ({ label: `${n} séances`, value: String(n), style: data.weeklyGoal === n ? 'preferred' : '' })),
      { label: 'Annuler', style: 'cancel' },
    ] });
    if (!choice) return;
    if (choice === 'auto') delete data.weeklyGoal; else data.weeklyGoal = parseInt(choice, 10);
    save(); render();
  },
  'wipe-data': async () => {
    if (!(await confirmSheet('Supprimer toutes les données ?', account.user ? 'Séances, programmes, réglages, mensurations et photos seront effacés de cet appareil, qui sera déconnecté de ton compte. Ton compte garde tes séances et programmes.' : 'Séances, programmes, réglages, mensurations et photos seront effacés de cet appareil.', 'Tout supprimer'))) return;
    const n = (data.history || []).length;
    // Compte : dernière sauvegarde tentée avant d'effacer ; on ne promet que ce qui est vraiment dessus
    if (account.user) await syncNow();
    const pending = account.user ? accountPendingCount(account.user.id) : n;
    const lost = !account.user
      ? `${n} séance${n > 1 ? 's' : ''} seront perdue${n > 1 ? 's' : ''} définitivement. Pense à exporter avant.`
      : pending
        ? `${plural(pending, 'séance n\'est pas encore sauvegardée', 'séances ne sont pas encore sauvegardées')} sur ton compte${account.error === 'offline' ? ' (pas d\'Internet ?)' : ''} et ${pending > 1 ? 'seront perdues' : 'sera perdue'}. Réessaie avec du réseau, ou exporte avant.`
        : `${plural(n, 'séance sera effacée', 'séances seront effacées')} de cet iPhone. Elles restent sur ton compte\u00a0: reconnecte-toi pour les retrouver.`;
    if (!(await dialog({ title: 'Es-tu sûr ?', message: lost,
      actions: [{ label: 'Annuler', value: false, style: 'cancel' }, { label: account.user && pending ? 'Supprimer quand même' : 'Supprimer', value: true, style: 'destructive' }] }))) return;
    await accountForgetDevice();   // même déconnecté : l'état du dernier compte est oublié, le compte garde tout
    wipeLocalData();
    render(); showToast('Données supprimées');
  },
  'open-legal': () => { window.open(LEGAL_URL, '_blank'); },
  'force-update': async () => {
    await checkForUpdate();
  },
  'export': async () => {
    if (await exportData(themePref())) refreshLastExport();
  },
  'import': async () => {
    if (!(await confirmSheet('Importer une sauvegarde ?', account.user ? 'Les séances du fichier seront ajoutées à celles de ton compte. Tes programmes actuels ne changent pas.' : 'Les données actuelles seront remplacées par celles du fichier.', 'Choisir un fichier', false))) return;
    const inp = document.createElement('input');
    inp.type  = 'file'; inp.accept = '.json,application/json';
    inp.onchange = ev => {
      const file = ev.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = re => importFile(String(re.target.result));
      reader.readAsText(file);
    };
    inp.click();
  },
});
