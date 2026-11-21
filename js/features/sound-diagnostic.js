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

// Un son mesuré : { heard, value } ; buffers === 0 : le moteur n'a rien rendu du tout
function soundLevel(peakDb, buffers) {
  if (buffers === 0) return { heard: false, value: '0 (moteur arrêté, rien n\'est joué)' };
  if (typeof peakDb !== 'number' || peakDb <= SOUND_HEARD_DB) return { heard: false, value: '0 (rien n\'est joué)' };
  return { heard: true, value: `${fmtDb(peakDb)} (le son est joué)` };
}

function soundIncidentTime(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
}

const SILENT_LABELS = {
  on: 'Sans doute activé (les sons de l\'app passent quand même)',
  off: 'Sans doute désactivé',
  unknown: 'Impossible à savoir (iOS ne le dit pas)',
};

// Résultat de selfTest → { verdict, rows: [[libellé, valeur, ok ?]], text } ; ctx : réglages et
// autorisation des notifications, pour le texte copié. Fonction pure (tests unitaires).
function soundDiagReport(res, ctx = {}) {
  const st = res?.before || {};
  const after = res?.after || {};
  const file = res?.file || {};
  const fileLevel = file.played ? soundLevel(file.peakDb) : { heard: false, value: `0 (${file.error || 'rien n\'est joué'})` };
  const steps = (res?.steps || []).map(s => ({ ...s, level: soundLevel(s.peakDb, s.buffers) }));
  const synthOk = steps.length > 0 && steps.every(s => s.level.heard);
  const synthSome = steps.some(s => s.level.heard);
  let verdict;
  if (fileLevel.heard && synthOk) verdict = 'L\'app joue bien les sons. Si tu n\'as rien entendu, c\'est l\'iPhone qui les coupe à la sortie.';
  else if (fileLevel.heard && synthSome) verdict = 'Le fichier sort, mais une partie des sons de fin de repos n\'est pas jouée : le problème vient de l\'app.';
  else if (fileLevel.heard) verdict = 'Le fichier sort, pas les sons de fin de repos : le problème vient de la façon dont l\'app les fabrique.';
  else if (synthOk || synthSome) verdict = 'Les sons de fin de repos sont joués, pas le fichier : la lecture de fichiers est bloquée.';
  else verdict = 'Rien n\'est joué : l\'app n\'arrive pas à envoyer de son à l\'iPhone.';

  const vol = typeof st.outputVolume === 'number' ? `${Math.round(st.outputVolume * 100)}\u00a0%` : '?';
  const inc = st.lastIncident || after.lastIncident;
  const incident = inc ? `${inc.detail}${soundIncidentTime(inc.at) ? ` à ${soundIncidentTime(inc.at)}` : ''}` : 'Aucun';
  const rows = [
    ['Sortie', soundOutputLabel(st.outputs)],
    ['Volume', vol],
    ['Mode silencieux', SILENT_LABELS[res?.silentMode] || SILENT_LABELS.unknown],
    ['Fichier son', fileLevel.value, fileLevel.heard],
    ...steps.map(s => [s.name, s.level.value, s.level.heard]),
    ['Autre app qui joue', st.otherAudioPlaying ? 'Oui' : 'Non'],
    ['Dernier incident', incident],
  ];

  const yes = v => (v === true ? 'oui' : v === false ? 'non' : '?');
  const cat = x => String(x || '?').replace('AVAudioSessionCategory', '').replace('AVAudioSessionMode', '');
  const session = x => `${cat(x.category)} · ${cat(x.mode)} · ${(x.categoryOptions || []).join(', ') || 'sans option'} · active ${yes(x.sessionActive)} · moteur ${yes(x.engineRunning)}`;
  const outputs = (st.outputs || []).map(o => `${o.type} « ${o.name} »`).join(', ') || 'aucune';
  const lines = [
    `Diagnostic du son MDLF Training, ${new Date().toLocaleString('fr-FR')}`,
    `Verdict : ${verdict}`,
    `Sortie : ${soundOutputLabel(st.outputs)} [${outputs}]`,
    `Volume : ${vol}`,
    `Mode silencieux : ${res?.silentMode || 'unknown'} (son système fini en ${Math.round(res?.silentMs ?? -1)} ms)`,
    `Fichier son : ${file.played ? `pic ${fmtDb(file.peakDb)}, moyen ${fmtDb(file.avgDb)}, ${Math.round(file.ms || 0)} ms` : `non joué (${file.error || '?'})`}`,
    ...steps.map(s => `${s.name} : pic ${fmtDb(s.peakDb)}, RMS ${fmtDb(s.rmsDb)}, ${s.buffers} tampons, duck ${yes(s.ducking)}, moteur ${yes(s.engineRunning)}`),
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
  return { verdict, rows, text: lines.join('\n') };
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
    lines.push(`Dernier son : ${new Date(lastSoundCheck.at).toLocaleTimeString('fr-FR')} · ${lastSoundCheck.ok ? 'joué' : 'en panne : ' + lastSoundCheck.reasons.join(', ')}`);
  }
  const journal = diag?.journal || [];
  lines.push(journal.length ? 'Journal :' : 'Journal : vide', ...journal.slice(-12));
  return lines.join('\n');
}

function soundDiagCopyBtn() {
  return '<button class="btn btn--secondary btn--full sound-diag__copy" data-action="sound-diag-copy">Copier le diagnostic</button>';
}

// Ouvre la zone sous la ligne et lance le test (coquille récente) ou affiche l'état (68 et 69)
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
    const report = soundDiagReport(res, { soundOn: data.soundOn !== false, soundLevel: data.soundLevel || 'fort',
      duckMusic: data.duckMusic !== false, notifications: await Native.notificationPermission() });
    soundDiagText = report.text;
    box.innerHTML = `<p class="sound-diag__status" role="status">${esc(report.verdict)}</p>
      <dl class="sound-diag__list">${report.rows.map(([k, v, ok]) =>
        `<div class="sound-diag__row"><dt>${esc(k)}</dt><dd${ok === false ? ' class="sound-diag__bad"' : ''}>${esc(v)}</dd></div>`).join('')}</dl>
      ${soundDiagCopyBtn()}`;
  } finally {
    soundDiagRunning = false;
  }
}

registerActions({
  'sound-diagnostics': () => showSoundDiagnostics(),
  'sound-diag-copy': async () => {
    if (!soundDiagText) return;
    try { await navigator.clipboard.writeText(soundDiagText); showToast('Diagnostic copié, colle\u2011le dans un message'); }
    catch { showToast('Copie impossible, fais une capture d\'écran'); }
  },
});
