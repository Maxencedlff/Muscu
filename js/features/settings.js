// ═══════════════════════════════════════════════════════════
//  Réglages
// ═══════════════════════════════════════════════════════════
'use strict';

function agoText(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'aujourd\'hui';
  if (days === 1) return 'hier';
  return `il y a ${days} jours`;
}

function renderSettings() {
  // Interrupteur iOS (le bouton de la rangée porte l'état pour VoiceOver)
  const tog = (on) => `<span class="switch ${on ? 'switch--on' : ''}" aria-hidden="true"><span class="switch__thumb"></span></span>`;
  const last  = data.lastExport;
  const stale = !last || Date.now() - last > 14 * 86400000;
  const nSess = (data.history || []).length;
  return `
    <div class="view settings-view view--grouped">
      ${navBar({ title: 'Réglages' })}
      <div class="scr">

        <div class="group-title">Séance</div>
        <div class="group">
          <button class="cell cell--nav" data-action="setting-rest">
            <span class="cell__body"><span class="cell__title">Repos par défaut</span></span>
            <span class="cell__value num">${fmtRest(data.defaultRest)}</span>
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell" data-action="setting-sound" role="switch" aria-checked="${data.soundOn !== false}">
            <span class="cell__body"><span class="cell__title">Sons</span></span>
            ${tog(data.soundOn !== false)}
          </button>
          <button class="cell" data-action="setting-vibrate" role="switch" aria-checked="${data.vibrateOn !== false}">
            <span class="cell__body"><span class="cell__title">Vibrations</span></span>
            ${tog(data.vibrateOn !== false)}
          </button>
        </div>

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
        </div>

        <div class="group-title">Données</div>
        <div class="group">
          <div class="cell">
            <span class="cell__body"><span class="cell__title ${stale ? 'txt-warn' : ''}" id="lastExportTxt">Dernière sauvegarde : ${last ? agoText(last) : 'jamais'}</span></span>
          </div>
          <button class="cell cell--action" data-action="export"><span class="cell__title">Exporter les données</span></button>
          <button class="cell cell--action" data-action="import"><span class="cell__title">Importer une sauvegarde</span></button>
          <button class="cell cell--destructive cell--left" data-action="wipe-data"><span class="cell__title">Supprimer toutes les données</span></button>
        </div>
        <div class="group-foot">Exporte régulièrement : les données ne sont stockées que sur cet appareil.</div>

        <div class="group-title">À propos</div>
        <div class="group">
          <div class="cell">
            <span class="cell__body"><span class="cell__title">MDLF Training<span id="appVersion"></span> · ${plural(nSess, 'séance', 'séances')}</span></span>
          </div>
          <button class="cell cell--action" data-action="force-update"><span class="cell__title">Rechercher une mise à jour</span></button>
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
  if (t) { t.textContent = 'Dernière sauvegarde : aujourd\'hui'; t.classList.remove('txt-warn'); }
}

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
    action: 'Annuler', duration: 6000,
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
  'wipe-data': async () => {
    if (!(await confirmSheet('Supprimer toutes les données ?', 'Séances, programmes et réglages seront effacés de cet appareil.', 'Tout supprimer'))) return;
    const n = (data.history || []).length;
    if (!(await dialog({ title: 'Es-tu sûr ?', message: `${n} séance${n > 1 ? 's' : ''} seront perdue${n > 1 ? 's' : ''} définitivement. Pense à exporter avant.`,
      actions: [{ label: 'Annuler', value: false, style: 'cancel' }, { label: 'Supprimer', value: true, style: 'destructive' }] }))) return;
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(data)); } catch {}
    if (activeSession) endSession();
    data = makeDefaultData();
    resetSelections();
    save(); render(); showToast('Données supprimées');
  },
  'force-update': async () => {
    await checkForUpdate();
  },
  'export': async () => {
    if (await exportData(themePref())) refreshLastExport();
  },
  'import': async () => {
    if (!(await confirmSheet('Importer une sauvegarde ?', 'Les données actuelles seront remplacées par celles du fichier.', 'Choisir un fichier', false))) return;
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
