// ═══════════════════════════════════════════════════════════
//  Réglages › Sons › « Diagnostic du son » (app iOS seulement)
// ═══════════════════════════════════════════════════════════
'use strict';

// Coquille du 21/11/2026 et suivantes (Native.sound.canSelfTest) : le module natif joue un fichier son
// embarqué puis la vraie fin de repos, en mesurant le niveau qui sort de l'app (SoundPlugin.swift,
// selfTest). Le résultat s'affiche en clair (sortie, volume, niveau de chaque son) avec un verdict, et
// « Copier le diagnostic » met le détail technique dans le presse-papier, à coller dans un message.
// Coquilles 68 et 69 (diagnostics sans selfTest) : l'état du module en texte, comme avant.
// Navigateur et Android : la ligne n'existe pas (settings.js, Native.sound.canDuck).

// Sous ce pic (dBFS), rien d'audible n'est sorti : un bip au volume « Bas » culmine vers −10 dB
const SOUND_HEARD_DB = -50;

let soundDiagText = '';      // dernier diagnostic, pour « Copier le diagnostic »
let soundDiagRunning = false;

// Nom d'une sortie audio d'iOS (AVAudioSession.Port) en clair ; name : nom de l'appareil (AirPods…)
const SOUND_PORTS = {
  Speaker: 'Haut-parleur', Receiver: 'Écouteur du haut de l\'iPhone', Headphones: 'Casque filaire',
  BluetoothA2DPOutput: 'Bluetooth', BluetoothLE: 'Bluetooth', BluetoothHFP: 'Bluetooth (appel)',
  AirPlay: 'AirPlay', CarAudio: 'CarPlay', HDMI: 'HDMI', USBAudio: 'USB', LineOut: 'Sortie ligne',
};
function soundOutputLabel(outputs) {
  if (!Array.isArray(outputs) || !outputs.length) return 'Aucune';
  return outputs.map(o => {
    const kind = SOUND_PORTS[o?.type];
    if (!kind) return String(o?.name || o?.type || '?');
    return kind === 'Haut-parleur' || kind.startsWith('Écouteur') || !o?.name ? kind : `${kind} (${o.name})`;
  }).join(', ');
}

// « −12 dB » (vrai signe moins, arrondi au décibel)
function fmtDb(db) { return `${Math.round(db) < 0 ? '−' : ''}${Math.abs(Math.round(db))}\u00a0dB`; }

// Un son mesuré : joué si son pic dépasse SOUND_HEARD_DB ; buffers === 0 : le moteur n'a rien rendu du tout
function soundHeard(peakDb, buffers) {
  return buffers !== 0 && typeof peakDb === 'number' && peakDb > SOUND_HEARD_DB;
}

// Un son du test : la confirmation d'iOS l'emporte (played faux : rien n'est sorti, même si le mélangeur a rendu
// du son) ; joué par le repli ou le son système : seulement si iOS l'a accepté ; sinon le niveau mesuré
function soundStepHeard(s) {
  if (s.played === false) return false;
  if (s.via && s.via !== 'moteur') return s.played === true;
  return soundHeard(s.peakDb, s.buffers);
}

function soundIncidentTime(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
}

// « le décompte 1 et le GO » : sons nommés dans une phrase
function soundNames(steps) {
  const names = steps.map(s => `le ${s.name === 'GO' ? 'GO' : s.name.charAt(0).toLowerCase() + s.name.slice(1)}`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}` : names[0] || '';
}

// Adresse du support (pages juridiques, Réglages) : écrite en tête du texte envoyé ou copié, la feuille de partage
// d'iOS ne sachant pas préremplir un destinataire
const SOUND_SUPPORT = 'contact@mdlf.app';
const SOUND_SEND = 'Si ça continue, envoie le diagnostic au support.';
const SOUND_LOW_VOLUME = 0.5;   // sous 50 % : le premier conseil est de monter le volume
const SOUND_FOCUS = 'Vérifie que le mode Concentration est coupé (Centre de contrôle).';

// Conseil quand l'app joue bien, dans l'ordre du plus probable : volume s'il est bas (sous 50 %), mode
// Concentration, puis la sortie mesurée (haut-parleur, ou appareil qui prend le son). { action, help }
function soundPlayedAdvice(outputs, volume) {
  const o = Array.isArray(outputs) ? outputs[0] : null;
  const low = typeof volume === 'number' && volume < SOUND_LOW_VOLUME;
  let output;
  if (!o || o.type === 'Speaker') output = 'Le son sort par le haut‑parleur de l\'iPhone.';
  else if (o.type === 'Receiver') output = 'Le son part vers l\'écouteur du haut de l\'iPhone, comme pendant un appel : refais le test une fois l\'appel fini.';
  else output = `Le son part vers ${o.name || SOUND_PORTS[o.type] || 'un autre appareil'}. Débranche‑le, ou vérifie son volume.`;
  return low
    ? { action: 'Monte le volume avec les boutons sur le côté.', help: `${SOUND_FOCUS} ${output} ${SOUND_SEND}` }
    : { action: SOUND_FOCUS, help: `${output} ${SOUND_SEND}` };
}

// Résultat de selfTest → { ok, title, detail, action, help, rows: [[libellé, valeur, joué ?]], text }.
// title : verdict ; action : la chose à faire, courte ; detail : d'où vient le problème (vide si le titre le dit
// déjà) ; help : comment faire et la suite. Vue simple : un son est « Joué » ou « Pas joué » ; les niveaux en dB,
// l'état du moteur et le mode silencieux estimé ne vont que dans le texte envoyé ou copié. ctx : réglages et
// autorisation des notifications, pour ce texte. Fonction pure (tests unitaires).
function soundDiagReport(res, ctx = {}) {
  const st = res?.before || {};
  const after = res?.after || {};
  const file = res?.file || {};
  const fileHeard = !!file.played && soundHeard(file.peakDb);
  const steps = (res?.steps || []).map(s => ({ ...s, heard: soundStepHeard(s) }));
  const missing = steps.filter(s => !s.heard);
  let ok = false, title, detail = 'Le problème vient de l\'app, pas de ton iPhone.';
  let action = 'Ferme l\'app, rouvre‑la, puis refais le test.';
  let help = `Pour fermer l'app, glisse‑la vers le haut dans le sélecteur d'apps. ${SOUND_SEND}`;
  if (steps.length && !missing.length && fileHeard) {
    ok = true;
    title = 'L\'app joue le son, c\'est l\'iPhone qui le bloque';
    detail = '';
    ({ action, help } = soundPlayedAdvice(st.outputs, st.outputVolume));
  } else if (!fileHeard && !steps.some(s => s.heard)) {
    title = 'L\'app n\'a joué aucun son';
    detail = 'Le problème vient de l\'app : elle n\'arrive pas à envoyer de son à l\'iPhone.';
  } else if (missing.length) {
    title = missing.length === steps.length ? 'L\'app n\'a pas joué la fin de repos' : `L'app n'a pas joué ${soundNames(missing)}`;
  } else {
    title = 'L\'app n\'a pas joué le son enregistré';
    detail = 'Les sons de fin de repos sont joués : seul le son enregistré pose problème, dans l\'app.';
  }
  const lost = [...(fileHeard ? [] : [{ name: 'son enregistré' }]), ...missing];
  const during = lost.length
    ? `${soundNames(lost).replace(/^l/, 'L')} ${lost.length > 1 ? 'pas joués' : 'pas joué'}`
    : 'Tous les sons joués';

  const vol = typeof st.outputVolume === 'number' ? `${Math.round(st.outputVolume * 100)}\u00a0%` : '?';
  const inc = st.lastIncident || after.lastIncident;
  const incident = inc ? `${inc.detail}${soundIncidentTime(inc.at) ? ` à ${soundIncidentTime(inc.at)}` : ''}` : 'Aucun incident';
  const rows = [
    ['Sortie', soundOutputLabel(st.outputs)],
    ['Volume', vol],
    // L'app joue en lecture (SoundPlugin.swift, .playback) : le bouton silencieux ne la coupe pas, quel que soit
    // l'état estimé (gardé dans la copie)
    ['Mode silencieux', 'Sans effet sur les sons de l\'app'],
    ['Son enregistré', fileHeard ? 'Joué' : 'Pas joué', fileHeard],
    ...steps.map(s => [s.name, s.heard ? 'Joué' : 'Pas joué', s.heard]),
    ['Autre app qui joue', st.otherAudioPlaying ? 'Oui' : 'Non'],
    // Ce test (sons perdus) d'un côté, ce qu'iOS a signalé avant lui de l'autre : « Aucun » à côté d'un GO raté
    // se lisait comme « rien ne cloche »
    ['Pendant ce test', during, lost.length ? false : undefined],
    ['Avant ce test', incident],
  ];

  const yes = v => (v === true ? 'oui' : v === false ? 'non' : '?');
  const cat = x => String(x || '?').replace('AVAudioSessionCategory', '').replace('AVAudioSessionMode', '');
  const session = x => `${cat(x.category)} · ${cat(x.mode)} · ${(x.categoryOptions || []).join(', ') || 'sans option'} · active ${yes(x.sessionActive)} · moteur ${yes(x.engineRunning)}`;
  const outputs = (st.outputs || []).map(o => `${o.type} « ${o.name} »`).join(', ') || 'aucune';
  const lines = [
    `Diagnostic du son MDLF Training, ${new Date().toLocaleString('fr-FR')} (à envoyer à ${SOUND_SUPPORT})`,
    `Verdict : ${title}.${detail ? ` ${detail}` : ''}`,
    `À faire : ${action} ${help}`,
    `Pendant ce test : ${during}`,
    `Sortie : ${soundOutputLabel(st.outputs)} [${outputs}]`,
    `Volume : ${vol}`,
    `Mode silencieux : ${res?.silentMode || 'unknown'} (estimé, son système fini en ${Math.round(res?.silentMs ?? -1)} ms)`,
    `Son enregistré : ${file.played ? `pic ${fmtDb(file.peakDb)}, moyen ${fmtDb(file.avgDb)}, ${Math.round(file.ms || 0)} ms` : `non joué (${file.error || '?'})`}`,
    ...steps.map(s => `${s.name} : ${s.heard ? 'joué' : 'pas joué'}, pic ${fmtDb(s.peakDb)}, RMS ${fmtDb(s.rmsDb)}, ${s.buffers} tampons, duck ${yes(s.ducking)}, moteur ${yes(s.engineRunning)}, par ${s.via || '?'}, confirmé ${yes(s.played)}`),
    `Autre app qui joue : ${yes(st.otherAudioPlaying)} · demande de silence : ${yes(st.secondaryAudioShouldBeSilencedHint)}`,
    `Session avant : ${session(st)}`,
    `Session après : ${session(after)}`,
    `Fréquence : ${st.sampleRate || '?'} Hz`,
    `Réglages : sons ${yes(ctx.soundOn)} · volume ${ctx.soundLevel || '?'} · baisser la musique ${yes(ctx.duckMusic)}`,
    `Notifications : ${ctx.notifications ?? '?'}`,
    `Dernier incident : ${inc ? `${inc.detail} (${inc.at})` : 'aucun'}`,
  ];
  const journal = after.journal?.length ? after.journal : (st.journal || []);
  lines.push(journal.length ? 'Journal :' : 'Journal : vide', ...journal.slice(-12));
  return { ok, title, detail, action, help, rows, text: lines.join('\n') };
}

// Coquilles 68 et 69 : état du module (diagnostics), dernier contrôle fait après un son, réglages
async function soundStateText() {
  const diag = await Native.sound.diagnostics();
  const perm = await Native.notificationPermission();
  const yes = v => (v === true ? 'oui' : v === false ? 'non' : '?');
  const lines = [
    `${new Date().toLocaleString('fr-FR')}`,
    `Sons : ${data.soundOn !== false ? 'oui' : 'non'} · volume : ${data.soundLevel || 'fort'} · baisser la musique : ${data.duckMusic !== false ? 'oui' : 'non'}`,
    `Notifications : ${perm ?? 'hors app'}`,
  ];
  if (diag) {
    lines.push(`Catégorie : ${String(diag.category || '?').replace('AVAudioSessionCategory', '')}${diag.duckOthers ? ' + duck' : ''}`,
      `Session active : ${yes(diag.sessionActive)} · moteur : ${yes(diag.engineRunning)} · autre son : ${yes(diag.otherAudioPlaying)}`);
  } else lines.push('État de la lecture iOS illisible');
  if (lastSoundCheck) {
    // « joué » seulement si iOS l'a confirmé : la build 91 disait « joué » 3 s après l'arrêt du moteur, sans rien de sorti
    const c = lastSoundCheck;
    const state = !c.ok ? `en panne : ${c.reasons.join(', ')}`
      : c.played === true ? (c.via === 'repli' ? 'joué par le repli' : 'joué (confirmé par iOS)')
        : 'envoyé, lecture non confirmée par iOS';
    lines.push(`Dernier son : ${new Date(c.at).toLocaleTimeString('fr-FR')} · ${state}`);
  }
  const journal = diag?.journal || [];
  lines.push(journal.length ? 'Journal :' : 'Journal : vide', ...journal.slice(-12));
  return lines.join('\n');
}

function soundDiagCopyBtn() {
  return '<button class="btn btn--secondary btn--full sound-diag__copy" data-action="sound-diag-copy">Copier le diagnostic</button>';
}

// Bas du résultat : envoyer (feuille de partage d'iOS, texte rempli), copier, refaire le test
function soundDiagActions() {
  return `<div class="sound-diag__actions">
      <button class="btn btn--primary btn--full" data-action="sound-diag-send">Envoyer le diagnostic</button>
      ${soundDiagCopyBtn()}
      <button class="btn btn--secondary btn--full" data-action="sound-diagnostics">Refaire le test</button>
    </div>`;
}

// Pastille d'une ligne : coche verte (joué) ou croix rouge (pas joué) ; le mot à côté dit la même chose
function soundMark(ok) {
  return `<span class="sound-diag__mark sound-diag__mark--${ok ? 'ok' : 'bad'}" aria-hidden="true">${icon(ok ? 'checkmark' : 'xmark', 12)}</span>`;
}
// Pastille du verdict : haut-parleur orange quand l'app joue (rien n'est « réussi » pour qui n'entend rien), croix
// rouge sinon
function soundVerdictMark(ok) {
  return ok ? `<span class="sound-diag__mark sound-diag__mark--info" aria-hidden="true">${icon('speaker.wave.2', 12)}</span>` : soundMark(false);
}

// Ouvre la zone sous la ligne et lance le test (coquille récente) ou affiche l'état (68 et 69). Résultat :
// verdict en tête (amené à l'écran et lu par VoiceOver), consigne, une ligne par son, verdict rappelé
// au-dessus de « Copier le diagnostic ».
async function showSoundDiagnostics() {
  const box = $('#sound-diag');
  if (!box || soundDiagRunning) return;
  box.hidden = false;
  $('[data-action="sound-diagnostics"]')?.setAttribute('aria-expanded', 'true');
  if (!Native.sound.canSelfTest) {
    soundDiagText = await soundStateText();
    box.innerHTML = `<pre class="sound-diag__text" aria-live="polite">${esc(soundDiagText)}</pre>${soundDiagCopyBtn()}`;
    return;
  }
  soundDiagRunning = true;
  box.innerHTML = '<p class="sound-diag__status" role="status">Test en cours, monte le son : un premier son, puis la fin de repos (3, 2, 1, GO).</p>';
  try {
    const res = await runSoundSelfTest();
    if (!res) {
      soundDiagText = '';
      box.innerHTML = '<p class="sound-diag__status" role="status">Le test n\'a pas pu se faire. Réessaie dans un instant.</p>';
      return;
    }
    const r = soundDiagReport(res, { soundOn: data.soundOn !== false, soundLevel: data.soundLevel || 'fort',
      duckMusic: data.duckMusic !== false, notifications: await Native.notificationPermission() });
    soundDiagText = r.text;
    // Pastille dans la ligne du titre seulement : explication et consigne prennent toute la largeur (texte agrandi)
    box.innerHTML = `<div class="sound-diag__verdict" tabindex="-1">
        <p class="sound-diag__title">${soundVerdictMark(r.ok)}<span>${esc(r.title)}</span></p>
        ${r.detail ? `<p class="sound-diag__detail">${esc(r.detail)}</p>` : ''}
        <p class="sound-diag__action">${esc(r.action)}</p>
        <p class="sound-diag__help">${esc(r.help)}</p>
      </div>
      <dl class="sound-diag__list">${r.rows.map(([k, v, ok]) =>
        `<div class="sound-diag__row"><dt>${esc(k)}</dt><dd${ok === false ? ' class="sound-diag__bad"' : ''}>${typeof ok === 'boolean' ? soundMark(ok) : ''}${esc(v)}</dd></div>`).join('')}</dl>
      <p class="sound-diag__recap">${soundVerdictMark(r.ok)}<span>${esc(r.title)}</span></p>
      ${soundDiagActions()}`;
    // Le verdict d'abord, sous la ligne « Diagnostic du son » qui le titre : la ligne est amenée juste sous la
    // barre de navigation (collante : sa hauteur, encoche et texte agrandi compris, sert de marge), et VoiceOver
    // lit le verdict
    const verdict = box.querySelector('.sound-diag__verdict');
    const head = $('.settings-view [data-action="sound-diagnostics"]') || verdict;
    head.style.scrollMarginTop = `${($('.navbar')?.offsetHeight || 0) + 8}px`;
    head.scrollIntoView({ block: 'start' });
    verdict.focus({ preventScroll: true });
  } finally {
    soundDiagRunning = false;
  }
}

// Texte agrandi : message court, sur une ligne, pour ne pas couvrir « Refaire le test » au-dessus de la barre d'onglets
function soundCopiedToast() {
  return document.documentElement.classList.contains('type-xl') ? 'Diagnostic copié' : 'Diagnostic copié. Colle\u2011le dans un message au support.';
}

registerActions({
  'sound-diagnostics': () => showSoundDiagnostics(),
  // Feuille de partage d'iOS (Messages, Mail…) avec le texte déjà rempli ; navigateur qui sait partager en repli,
  // sinon copie
  'sound-diag-send': async () => {
    if (!soundDiagText) return;
    const title = 'Diagnostic du son MDLF Training';
    if (Native.isNative) { if (await Native.shareText(soundDiagText, title) === 'failed') showToast('Envoi impossible, copie le diagnostic'); return; }
    if (navigator.share) { try { await navigator.share({ title, text: soundDiagText }); } catch { /* feuille fermée */ } return; }
    try { await navigator.clipboard.writeText(soundDiagText); showToast(soundCopiedToast()); } catch { /* rien */ }
  },
  'sound-diag-copy': async () => {
    if (!soundDiagText) return;
    try { await navigator.clipboard.writeText(soundDiagText); showToast(soundCopiedToast()); }
    catch { showToast('Copie impossible, fais une capture d\'écran'); }
  },
});
