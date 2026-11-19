// ═══════════════════════════════════════════════════════════
//  Réglages
// ═══════════════════════════════════════════════════════════
'use strict';

// Pages juridiques publiques (js/data/legal-links.js) : ouvertes dans Safari (_blank)
const SETTINGS_LEGAL_PAGES = [
  ['privacy', 'Confidentialité', 'shield'], ['terms', 'Conditions d\'utilisation', 'doc.text'],
  ['sales', 'Conditions de vente', 'doc.text'], ['mentions', 'Mentions légales', 'doc.text'],
];

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
  // Copie de secours sans les mensurations : la confirmation promet leur effacement
  try { const { bodyMeasures, ...rest } = data; localStorage.setItem(BACKUP_KEY, JSON.stringify(rest)); } catch {}
  if (activeSession) endSession();
  data = freshData();
  resetSelections();
  Native.eraseCloudOnNextSave();   // app iOS : la copie iCloud est vidée elle aussi
  vaultReset();                    // coffre à photos refermé et vidé, clé retirée du trousseau iCloud (js/data/photo-vault.js)
  save();
}

// Ce que « Supprimer toutes les données » efface en plus (photos : seulement là où elles existent)
function wipedExtras() { return photosAllowedHere() ? 'mensurations et photos' : 'mensurations'; }

// Écran Réglages, sur le modèle des Réglages d'iOS : Compte, Entraînement, Sons et vibrations, Apparence,
// Social et coach, Connexions (Strava, js/features/strava-ui.js), Données, Aide. Les groupes propres à l'app iOS (Services Apple, Icône de l'app) suivent
// la section la plus proche ; absents dans le navigateur. Une icône par ligne dans un carré de couleur (cellIco,
// js/ui/forms.js) : chaque symbole a un seul sens dans tout l'écran ; la Silhouette montre le personnage choisi.
function renderSettings() {
  const nSess = (data.history || []).length;
  const soundOn = data.soundOn !== false;
  return `
    <div class="view settings-view view--grouped">
      ${navBar({ title: 'Réglages' })}
      <div class="scr">
${renderAccountGroup()}
${renderAccessSettingsGroup()}

        <div class="group-title">Entraînement</div>
        <div class="group">
          <button class="cell cell--nav" data-action="setting-rest">
            ${cellIco('timer', 'blue')}
            <span class="cell__body"><span class="cell__title">Repos par défaut</span></span>
            <span class="cell__value num">${fmtRest(data.defaultRest)}</span>
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell cell--nav" data-action="setting-weekly-goal">
            ${cellIco('target', 'green')}
            <span class="cell__body"><span class="cell__title">Objectif</span>
              <span class="cell__sub">Séances par semaine</span></span>
            <span class="cell__value num">${data.weeklyGoal ? `${data.weeklyGoal} / semaine` : `Auto · ${weeklyGoal()} / sem.`}</span>
            ${icon('chevron.right', 16)}
          </button>
          <div class="cell cell--ctl">
            ${cellIco('scalemass', 'gray')}
            <span class="cell__body"><span class="cell__title">Unité</span></span>
            <div class="segmented seg-sm" role="group" aria-label="Unité de poids">
              ${['kg', 'lbs'].map(u => `<button class="segmented__btn ${data.unit === u ? 'segmented__btn--active' : ''}" aria-pressed="${data.unit === u}" data-action="setting-unit" data-val="${u}">${u}</button>`).join('')}
            </div>
          </div>
          ${renderBodyWeightSetting()}
          ${strengthSexSettingHtml()}
          ${profileAgeHeightHtml()}
          <button class="cell" data-action="setting-rir" role="switch" aria-checked="${rirShown()}">
            ${cellIco('gauge', 'blue')}
            <span class="cell__body"><span class="cell__title">Reps en réserve</span>
              <span class="cell__sub">Demandées après chaque série</span></span>
            ${switchHtml(rirShown())}
          </button>
          <button class="cell" data-action="setting-record" role="switch" aria-checked="${headRecordShown()}">
            ${cellIco('medal', 'blue')}
            <span class="cell__body"><span class="cell__title">Record en séance</span>
              <span class="cell__sub">Affiché sous chaque exercice</span></span>
            ${switchHtml(headRecordShown())}
          </button>
        </div>

        <div class="group-title">Sons et vibrations</div>
        <div class="group">
          <button class="cell" data-action="setting-sound" role="switch" aria-checked="${soundOn}">
            ${cellIco('speaker.wave.2', 'sable')}
            <span class="cell__body"><span class="cell__title">Sons</span></span>
            ${switchHtml(soundOn)}
          </button>
          ${soundOn ? `<div class="cell cell--ctl">
            ${cellIco('slider.horizontal.3', 'sable')}
            <span class="cell__body"><span class="cell__title">Volume</span></span>
            <div class="segmented seg-sm" role="group" aria-label="Volume des bips">
              ${[['bas', 'Bas'], ['normal', 'Normal'], ['fort', 'Fort']].map(([v, l]) =>
                `<button class="segmented__btn ${data.soundLevel === v ? 'segmented__btn--active' : ''}" aria-pressed="${data.soundLevel === v}" data-action="setting-sound-level" data-val="${v}">${l}</button>`).join('')}
            </div>
          </div>` : ''}
          ${soundOn && Native.sound.canDuck ? `<button class="cell" data-action="setting-duck" role="switch" aria-checked="${data.duckMusic !== false}">
            ${cellIco('music.down', 'sable')}
            <span class="cell__body"><span class="cell__title">Baisser la musique</span>
              <span class="cell__sub">Pendant le décompte de fin de repos</span></span>
            ${switchHtml(data.duckMusic !== false)}
          </button>` : ''}
          <button class="cell" data-action="setting-vibrate" role="switch" aria-checked="${data.vibrateOn !== false}">
            ${cellIco('iphone.radiowaves', 'sable')}
            <span class="cell__body"><span class="cell__title">Vibrations</span></span>
            ${switchHtml(data.vibrateOn !== false)}
          </button>
          ${soundOn ? `<button class="cell cell--action" data-action="sound-test-rest">
            ${cellIco('play', 'sable')}
            <span class="cell__body"><span class="cell__title">Tester la fin de repos</span></span>
          </button>` : ''}
          ${soundOn ? `<button class="cell cell--action" data-action="sound-test-pitch">
            ${cellIco('music', 'sable')}
            <span class="cell__body"><span class="cell__title">Tester les hauteurs</span>
              <span class="cell__sub">Note le dernier bip que tu entends</span></span>
            <span class="cell__value pitch-steps" aria-hidden="true">${PITCH_TEST.map((_, i) => `<span class="pitch-steps__n">${i + 1}</span>`).join(' · ')}</span>
          </button>` : ''}
          <button class="cell cell--action" data-action="sound-diagnostics" aria-expanded="false" aria-controls="sound-diag">
            ${cellIco('waveform', 'gray')}
            <span class="cell__body"><span class="cell__title">Diagnostic du son</span></span>
          </button>
          <div class="sound-diag" id="sound-diag" hidden><pre class="sound-diag__text" aria-live="polite"></pre></div>
        </div>
        <div class="group-foot">Les sons de l'app jouent même en mode silencieux.</div>
${renderAppleServicesGroup(switchHtml)}

        <div class="group-title">Apparence</div>
        <div class="group">
          <div class="cell cell--ctl">
            ${cellIco('circle.lefthalf.filled', 'blue')}
            <span class="cell__body"><span class="cell__title">Thème</span></span>
            <div class="segmented seg-sm" role="group" aria-label="Thème">
              ${[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) =>
                `<button class="segmented__btn ${themePref() === v ? 'segmented__btn--active' : ''}" aria-pressed="${themePref() === v}" data-action="set-theme" data-val="${v}">${l}</button>`).join('')}
            </div>
          </div>
          <div class="cell cell--ctl">
            ${silhouetteIcoHtml()}
            <span class="cell__body"><span class="cell__title">Silhouette</span>
              <span class="cell__sub">Carte des muscles</span></span>
            ${silhouetteSegmentedHtml()}
          </div>
          <button class="cell" data-action="setting-recap-card" role="switch" aria-checked="${data.recapCardOff !== true}">
            ${cellIco('calendar', 'green')}
            <span class="cell__body"><span class="cell__title">Carte « Ta semaine »</span>
              <span class="cell__sub">Sur l'accueil le dimanche soir et le lundi</span></span>
            ${switchHtml(data.recapCardOff !== true)}
          </button>
        </div>
${renderAppIconGroup()}
${renderCoachSettingsGroup()}
${renderConnectionsGroup()}

        <div class="group-title">Données</div>
        <div class="group">
          <button class="cell cell--nav" data-action="go-trash">
            ${cellIco('trash', 'gray')}
            <span class="cell__body"><span class="cell__title">Supprimés récemment</span></span>
            ${trashCount() ? `<span class="cell__value num">${trashCount()}</span>` : ''}
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell cell--nav" data-action="go-backup">
            ${cellIco('archivebox', 'gray')}
            <span class="cell__body"><span class="cell__title">Sauvegarde</span></span>
            ${backupCellValue()}
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell cell--action" data-action="import-other-app">
            ${cellIco('square.and.arrow.down', 'gray')}
            <span class="cell__body"><span class="cell__title">Importer de Strong ou Hevy</span></span>
          </button>
        </div>
        <div class="group">
          <button class="cell cell--destructive" data-action="wipe-data"><span class="cell__title">Supprimer toutes les données</span></button>
        </div>
        ${account.user ? `<div class="group-foot">Supprime les données de ${thisPhone()} seulement. Pour le compte : Compte › Supprimer mon compte.</div>` : ''}

        <div class="group-title">Aide</div>
        <div class="group">
          <button class="cell cell--nav" data-action="go-guide">${cellIco('questionmark.circle', 'blue')}<span class="cell__body"><span class="cell__title">Guide de l'app</span></span>${icon('chevron.right', 16)}</button>
          <div class="cell">
            ${cellIco('info.circle', 'gray')}
            <span class="cell__body"><span class="cell__title">MDLF Training<span id="appVersion"></span></span>
              <span class="cell__sub">${plural(nSess, 'séance enregistrée', 'séances enregistrées')}</span></span>
          </div>
          ${Native.isNative
            ? `<button class="cell cell--action" data-action="live-update-check">${cellIco('arrow.down.circle', 'gray')}<span class="cell__body"><span class="cell__title">Rechercher une mise à jour</span>
                 <span class="cell__sub">${esc(liveUpdateLabel())}</span></span></button>`
            : `<button class="cell cell--action" data-action="force-update">${cellIco('arrow.down.circle', 'gray')}<span class="cell__body"><span class="cell__title">Rechercher une mise à jour</span></span></button>`}
        </div>

        <div class="group-title">Informations légales</div>
        <div class="group">
          ${SETTINGS_LEGAL_PAGES.map(([page, label, ico]) => `<button class="cell cell--nav" data-action="open-legal" data-page="${page}">
            ${cellIco(ico, 'gray')}<span class="cell__body"><span class="cell__title">${label}</span></span>${icon('chevron.right', 16)}</button>`).join('')}
        </div>
        <div class="group-foot">Pages du site mdlf.app, ouvertes dans Safari. L'abonnement est vendu et remboursé par Apple.</div>

      </div>
    </div>`;
}

// Apparence › Silhouette : le personnage maison choisi (corps gris, vue de face) à la place du symbole
function silhouetteIcoHtml() {
  return `<span class="set-ico set-ico--body" aria-hidden="true"><img src="${bodyImgUrl(bodySilhouette(), 'front', 'base')}" alt="" decoding="async"></span>`;
}

// Âge et taille, facultatifs, à côté du poids et du sexe : ils servent seulement à proposer des objectifs de nutrition
// (feuille Objectifs du jour, js/data/diet-estimate.js) et restent sur l'iPhone (SYNC_LOCAL_ONLY, pas dans la copie
// iCloud, comme le poids), ce que dit le sous-titre. Demande de Maxence du 16/11 : « un truc qui calcule automatiquement »
function profileAge(d = data) { return Number.isInteger(d.birthYear) ? new Date().getFullYear() - d.birthYear : null; }
function profileAgeHeightHtml() {
  const age = profileAge(), cm = data.heightCm;
  const cell = (action, ico, title, value, spoken) => `<button class="cell cell--nav" data-action="${action}">
            ${cellIco(ico, 'gray')}
            <span class="cell__body"><span class="cell__title">${title}</span>
              <span class="cell__sub">Facultatif, reste sur ${thisPhone()}</span></span>
            <span class="cell__value num"${value ? '' : ' aria-label="Non renseigné"'}>${value ? esc(value) : '—'}</span>
            ${icon('chevron.right', 16)}
          </button>`;
  return cell('set-profile-age', 'clock.history', 'Âge', age ? `${age} ans` : '') + cell('set-profile-height', 'ruler', 'Taille', cm ? `${fmtNum(cm)} cm` : '');
}
// Saisie d'un nombre du profil ; champ vidé : effacé (facultatif)
async function askProfileNumber({ title, message, value, unit, min, max }) {
  const raw = await dialog({ title, message, input: { value, unit }, actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'OK', style: 'preferred' }] });
  if (raw === null) return undefined;
  if (String(raw).trim() === '') return null;
  const v = num(raw, min, max, true);
  if (v === null) { showToast(`Valeur entre ${min} et ${max}`, { error: true }); return undefined; }
  return v;
}

// Entraînement › Poids du corps : la pesée de Santé quand elle est activée (app iOS, js/features/apple-services.js),
// sinon le poids saisi dans l'app
function renderBodyWeightSetting() {
  if (Native.isNative && data.healthOn === true) return renderBodyWeightCell();
  return `<button class="cell cell--nav" data-action="set-body-weight">
            ${cellIco('bathroom.scale', 'gray')}
            <span class="cell__body"><span class="cell__title">Poids du corps</span>
              <span class="cell__sub">Pour le volume des tractions, dips, pompes</span></span>
            <span class="cell__value num"${data.bodyWeightKg ? '' : ' aria-label="Non renseigné"'}>${data.bodyWeightKg ? `${fmtW(data.bodyWeightKg)} ${unitLbl()}` : '—'}</span>
            ${icon('chevron.right', 16)}
          </button>`;
}

// ── Sauvegarde ──────────────────────────────────────────────

// Sans compte, l'export est la seule copie hors de l'appareil : « jamais » ou plus de 14 jours devient
// un avertissement (orange). Avec un compte, les séances sont déjà dessus : jamais d'alerte.
function exportStale(d = data, hasAccount = !!account.user, now = Date.now()) {
  if (hasAccount) return false;
  return !d.lastExport || now - d.lastExport > 14 * 86400000;
}

// Valeur de la cellule « Sauvegarde » des Réglages : date du dernier export (orange si en retard, sans compte)
function backupCellValue() {
  const last = data.lastExport;
  if (account.user && !last) return '';
  const txt = last ? agoText(last) : 'Jamais';
  return `<span class="cell__value ${exportStale() ? 'txt-warn' : ''}">${txt.charAt(0).toUpperCase()}${txt.slice(1)}</span>`;
}

// Réglages › Données › Sauvegarde : où sont les données, export et import
function renderBackup() {
  const last = data.lastExport;
  const stale = exportStale();
  const lead = account.user
    ? `Séances et programmes sont enregistrés sur ton compte. Le poids du corps et les données Santé restent sur ${thisPhone()}.`
    : `Sans compte, les données sont seulement sur ${thisPhone()}. Exporte-les toutes les 2 semaines ou connecte-toi.`;
  return `
    <div class="view backup-view view--grouped">
      ${navBar({ title: 'Sauvegarde' })}
      <div class="scr">
        <div class="group-foot group-lead">${lead}</div>
        <div class="group">
          <button class="cell cell--action" data-action="export"><span class="cell__title">Exporter les données</span></button>
          <button class="cell cell--action" data-action="import"><span class="cell__title">${account.user ? 'Importer un fichier d\'export' : 'Importer une sauvegarde'}</span></button>
          <div class="cell">
            <span class="cell__body"><span class="cell__title ${stale ? 'txt-warn' : ''}" id="lastExportTxt">${lastExportLabel()} : ${last ? agoText(last) : 'jamais'}</span></span>
          </div>
        </div>
        <div class="group-foot">${account.user
          ? 'L\'export crée un fichier JSON à garder où tu veux. Importer un fichier ajoute ses séances à celles du compte.'
          : 'L\'export crée un fichier JSON à garder où tu veux. Importer une sauvegarde remplace les données actuelles.'} ${photosAllowedHere() ? `Il contient les mensurations, pas les photos : elles restent sur ${thisPhone()}.` : 'Il contient aussi les mensurations.'}</div>
        <div class="group">
          <button class="cell cell--action" data-action="export-csv"><span class="cell__body"><span class="cell__title">Exporter les séances (CSV)</span><span class="cell__sub">Une ligne par série, pour un tableur</span></span></button>
        </div>
        <div class="group-foot">S'ouvre dans Excel, Numbers ou Google Sheets. Ce fichier ne se réimporte pas.</div>
        <div class="group">
          <button class="cell cell--action" data-action="import-other-app"><span class="cell__body"><span class="cell__title">Importer depuis une autre app</span><span class="cell__sub">Fichier CSV de Hevy ou Strong</span></span></button>
        </div>
        <div class="group-foot">Ajoute à l'historique les séances d'un export Hevy ou Strong, après un aperçu.</div>
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

// Carte de l'accueil « Sauvegarde tes séances » (backupCardShown, js/data/backup.js) : après 3 séances sans compte ni
// sauvegarde récente. Même gabarit que la carte du compte (titre, action, croix) ; jamais en même temps qu'elle
// (js/features/dashboard.js). Le bouton propose les deux moyens : un compte (si l'app en a) ou un fichier.
function backupHomeCard() {
  let closedAt = null;
  try { closedAt = Number(localStorage.getItem(BACKUP_CARD_KEY)) || null; } catch { /* stockage indisponible : carte montrée */ }
  if (!backupCardShown({ sessions: (data.history || []).length, ready: !accountAvailable() || account.ready,
    signedIn: !!account.user, hadAccount: !!syncOwner(), stale: exportStale(), closedAt })) return '';
  return `
    <section class="home-card account-card backup-card" aria-labelledby="backupCardTitle">
      <div class="account-card__text">
        <h2 class="account-card__title" id="backupCardTitle">Sauvegarde tes séances</h2>
        <p class="account-card__sub">Elles ne sont que sur ${thisPhone()}.</p>
      </div>
      <button class="account-card__btn" data-action="backup-card-open">Sauvegarder</button>
      <button class="account-card__close" data-action="backup-card-close" aria-label="Fermer">${icon('xmark', 16)}</button>
    </section>`;
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
    if (r.reason === 'invalid') showToast('Fichier non reconnu, rien n\'a changé', { error: true });
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

// Bouton des Réglages en haut à droite, le même sur Entraînement et Programme : toujours la roue.
// Une icône = un sens (docs/ERGONOMIE.md) : l'avatar mène à Mon profil, et seulement sur Social.
function settingsButtonHtml() {
  return `<button class="navbar__icon" data-action="go-settings" aria-label="Réglages">${icon('gear', 24)}</button>`;
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'set-profile-age': async () => {
    const v = await askProfileNumber({ title: 'Âge', message: `Facultatif, reste sur ${thisPhone()}. Sert aux objectifs de nutrition et au programme sur mesure. Laisse vide pour le supprimer.`,
      value: profileAge() ? String(profileAge()) : '', unit: 'ans', min: 10, max: 110 });
    if (v === undefined) return;
    if (v === null) delete data.birthYear; else data.birthYear = new Date().getFullYear() - v;
    save(); render();
  },
  'set-profile-height': async () => {
    const v = await askProfileNumber({ title: 'Taille', message: `Facultatif, reste sur ${thisPhone()}. Sert aux objectifs de nutrition et à choisir des tractions assistées ou non. Laisse vide pour la supprimer.`,
      value: data.heightCm ? String(data.heightCm) : '', unit: 'cm', min: 100, max: 250 });
    if (v === undefined) return;
    if (v === null) delete data.heightCm; else data.heightCm = v;
    save(); render();
  },
  'go-settings': () => {
    navigate('settings');
  },
  'go-backup': () => {
    navigate('backup');
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
  'setting-sound-level': (e, el) => {
    if (!(el.dataset.val in SOUND_LEVELS)) return;
    data.soundLevel = el.dataset.val; save(); render();
    playMelody('restGo');   // on entend tout de suite le nouveau volume
  },
  'setting-duck': () => {
    data.duckMusic = data.duckMusic === false; save(); render();
  },
  // Séquence réelle de fin de repos (3-2-1 puis GO) ; le diagnostic se met à jour après le GO s'il est ouvert
  'sound-test-rest': async () => {
    await testRestEndSound();
    if (!$('#sound-diag')?.hidden) showSoundDiagnostics();
  },
  // Quatre bips de 440 à 1320 Hz ; le numéro du bip en cours s'allume (on dit jusqu'où on entend)
  'sound-test-pitch': async (e, el) => {
    const steps = el.querySelectorAll('.pitch-steps__n');
    steps.forEach(n => n.classList.remove('pitch-steps__n--on'));
    await testPitches(i => steps[i]?.classList.add('pitch-steps__n--on'));
  },
  'sound-diagnostics': () => showSoundDiagnostics(),
  'setting-vibrate': () => {
    data.vibrateOn = !data.vibrateOn; save(); render();
  },
  'setting-rir': () => {
    data.rirOn = !rirShown(); save(); render();
  },
  'setting-record': () => {
    data.recordOn = !headRecordShown(); save(); render();
  },
  'setting-rest': async () => {
    const v = await askNumber({ title: 'Repos par défaut', message: 'Durée entre deux séries, en secondes.', value: data.defaultRest, unit: 's', min: 10, max: 600 });
    if (v !== null) { data.defaultRest = v; save(); render(); }
  },
  // Objectif de séances par semaine (carte « Cette semaine » de l'accueil) : « Auto » suit le nombre de séances du programme
  'setting-weekly-goal': async () => {
    const auto = Math.min(7, Math.max(1, sessionKeys().length));
    const choice = await dialog({ type: 'sheet', title: 'Objectif par semaine', message: 'Séances visées chaque semaine, comptées sur l\'accueil.', actions: [
      { label: `Auto : ${auto} séance${auto > 1 ? 's' : ''} (le programme)`, value: 'auto', style: data.weeklyGoal ? '' : 'preferred' },
      ...[2, 3, 4, 5, 6].map(n => ({ label: `${n} séances`, value: String(n), style: data.weeklyGoal === n ? 'preferred' : '' })),
      { label: 'Annuler', style: 'cancel' },
    ] });
    if (!choice) return;
    if (choice === 'auto') delete data.weeklyGoal; else data.weeklyGoal = parseInt(choice, 10);
    save(); render();
  },
  'wipe-data': async () => {
    if (!(await confirmSheet('Supprimer toutes les données ?', account.user ? `Séances, programmes, réglages, ${wipedExtras()} seront supprimés de ${thisPhone()}, qui sera déconnecté. Le compte garde séances et programmes.` : `Séances, programmes, réglages, ${wipedExtras()} seront supprimés de ${thisPhone()}.`, 'Tout supprimer'))) return;
    const n = (data.history || []).length;
    // Compte : dernière sauvegarde tentée avant d'effacer ; on ne promet que ce qui est vraiment dessus
    if (account.user) await syncNow();
    const pending = account.user ? accountPendingCount(account.user.id) : n;
    const lost = !account.user
      ? `${n} séance${n > 1 ? 's' : ''} seront perdue${n > 1 ? 's' : ''}. Exporte-les d'abord pour les garder.`
      : pending
        ? `${plural(pending, 'séance n\'est pas encore enregistrée', 'séances ne sont pas encore enregistrées')} sur ton compte${account.error === 'offline' ? ' (pas d\'Internet ?)' : ''} et ${pending > 1 ? 'seront perdues' : 'sera perdue'}. Réessaie une fois connecté, ou exporte-les avant.`
        : `${plural(n, 'séance sera supprimée', 'séances seront supprimées')} de ${thisPhone()}. Elles restent sur ton compte. Reconnecte-toi pour les retrouver.`;
    if (!(await dialog({ title: 'Confirmer la suppression ?', message: lost,
      actions: [{ label: 'Annuler', value: false, style: 'cancel' }, { label: account.user && pending ? 'Supprimer quand même' : 'Supprimer', value: true, style: 'destructive' }] }))) return;
    await accountForgetDevice();   // même déconnecté : l'état du dernier compte est oublié, le compte garde tout
    wipeLocalData();
    render(); showToast('Données supprimées');
  },
  'open-legal': (e, el) => { window.open(LEGAL_URLS[el?.dataset.page] || LEGAL_URLS.mentions, '_blank'); },
  'force-update': async () => {
    await checkForUpdate();
  },
  'export': async () => {
    if (await exportData(themePref())) refreshLastExport();
  },
  'export-csv': async () => {
    if (await exportHistoryCsv() === 'empty') showToast('Aucune séance à exporter');
  },
  'backup-card-open': async () => {
    const choice = await dialog({ type: 'sheet', title: 'Sauvegarder tes séances',
      message: accountAvailable() ? `Un compte les garde, même sur un ${newPhone()}. Un fichier est une copie à garder où tu veux.`
        : 'Un fichier est une copie à garder où tu veux.',
      actions: [
        ...(accountAvailable() ? [{ label: 'Créer un compte', value: 'account', style: 'preferred' }] : []),
        { label: 'Exporter un fichier', value: 'file', ...(accountAvailable() ? {} : { style: 'preferred' }) },
        { label: 'Annuler', style: 'cancel' },
      ] });
    if (choice === 'account') navigate('account');
    else if (choice === 'file' && await exportData(themePref())) { render(); showToast('Sauvegarde exportée'); }
  },
  'backup-card-close': () => {
    try { localStorage.setItem(BACKUP_CARD_KEY, String(Date.now())); } catch { /* revient au prochain affichage */ }
    haptic(); render();
  },
  'import': async () => {
    if (!(await confirmSheet('Importer une sauvegarde ?', account.user ? 'Les séances du fichier seront ajoutées à celles du compte. Les programmes actuels ne changent pas.' : 'Les données actuelles seront remplacées par celles du fichier.', 'Choisir un fichier', false))) return;
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

// Réglages › Sons › « Diagnostic du son » : état de la lecture iOS (MdlfSound.diagnostics), dernier
// contrôle fait après un son, réglages et autorisation des notifications, en texte sélectionnable :
// une capture juste après un son raté suffit à savoir ce qui a cassé.
async function soundDiagnosticsText() {
  const diag = await Native.sound.diagnostics();
  const perm = await Native.notificationPermission();
  const yes = v => (v === true ? 'oui' : v === false ? 'non' : '?');
  const lines = [
    `${new Date().toLocaleString('fr-FR')}`,
    `App iOS : ${yes(Native.isNative)} · lecture iOS : ${yes(Native.sound.available)} · état lisible : ${yes(Native.sound.canDuck)}`,
    `Sons : ${data.soundOn !== false ? 'oui' : 'non'} · volume : ${data.soundLevel || 'fort'} · baisser la musique : ${data.duckMusic !== false ? 'oui' : 'non'}`,
    `Notifications : ${perm ?? 'hors app'}`,
  ];
  if (diag) {
    lines.push(`Catégorie : ${String(diag.category || '?').replace('AVAudioSessionCategory', '')}${diag.duckOthers ? ' + duck' : ''}`,
      `Session active : ${yes(diag.sessionActive)} · moteur : ${yes(diag.engineRunning)} · autre son : ${yes(diag.otherAudioPlaying)}`);
  } else if (Native.sound.available) lines.push('État de la lecture iOS illisible (build sans diagnostics)');
  if (lastSoundCheck) {
    lines.push(`Dernier son : ${new Date(lastSoundCheck.at).toLocaleTimeString('fr-FR')} · ${lastSoundCheck.ok ? 'joué' : 'en panne : ' + lastSoundCheck.reasons.join(', ')}`);
  }
  const journal = diag?.journal || [];
  lines.push(journal.length ? 'Journal :' : 'Journal : vide', ...journal.slice(-12));
  return lines.join('\n');
}

async function showSoundDiagnostics() {
  const box = $('#sound-diag');
  if (!box) return;
  const text = await soundDiagnosticsText();
  box.hidden = false;
  box.querySelector('.sound-diag__text').textContent = text;
  $('[data-action="sound-diagnostics"]')?.setAttribute('aria-expanded', 'true');
}
