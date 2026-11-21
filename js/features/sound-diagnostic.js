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

function soundIncidentTime(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
}

// « le décompte 1 et le GO » : sons nommés dans une phrase
function soundNames(steps) {
  const names = steps.map(s => `le ${s.name === 'GO' ? 'GO' : s.name.charAt(0).toLowerCase() + s.name.slice(1)}`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}` : names[0] || '';
}

const SOUND_RETRY = 'Ferme et rouvre l\'app, puis refais le test. Si ça continue, copie le diagnostic et envoie\u2011le à Maxence.';

// Résultat de selfTest → { ok, title, detail, action, rows: [[libellé, valeur, joué ?]], text }. Vue simple : un son
// est « Joué » ou « Pas joué » ; les niveaux en dB, l'état du moteur et le mode silencieux estimé ne vont que dans le
// texte copié. ctx : réglages et autorisation des notifications, pour ce texte. Fonction pure (tests unitaires).
function soundDiagReport(res, ctx = {}) {
  const st = res?.before || {};
  const after = res?.after || {};
  const file = res?.file || {};
  const fileHeard = !!file.played && soundHeard(file.peakDb);
  const steps = (res?.steps || []).map(s => ({ ...s, heard: soundHeard(s.peakDb, s.buffers) }));
  const missing = steps.filter(s => !s.heard);
  let ok = false, title, detail, action = SOUND_RETRY;
  if (steps.length && !missing.length && fileHeard) {
    ok = true;
    title = 'Le son est bien joué par l\'app';
    detail = 'Si tu n\'as rien entendu, le son est coupé après l\'app, par l\'iPhone.';
    action = 'Le son sort de l\'app : vérifie le volume, la sortie (Bluetooth) et le mode Concentration.';
  } else if (!fileHeard && !steps.some(s => s.heard)) {
    title = 'L\'app n\'a joué aucun son';
    detail = 'Le problème vient de l\'app : elle n\'arrive pas à envoyer de son à l\'iPhone.';
  } else if (missing.length) {
    title = missing.length === steps.length ? 'L\'app n\'a pas joué la fin de repos' : `L'app n'a pas joué ${soundNames(missing)}`;
    detail = 'Le problème vient de l\'app, pas de ton iPhone.';
  } else {
    title = 'L\'app n\'a pas joué le son enregistré';
    detail = 'Les sons de fin de repos sont joués : seul le son enregistré pose problème, dans l\'app.';
  }

  const vol = typeof st.outputVolume === 'number' ? `${Math.round(st.outputVolume * 100)}\u00a0%` : '?';
  const inc = st.lastIncident || after.lastIncident;
  const incident = inc ? `${inc.detail}${soundIncidentTime(inc.at) ? ` à ${soundIncidentTime(inc.at)}` : ''}` : 'Aucun';
  const rows = [
    ['Sortie', soundOutputLabel(st.outputs)],
    ['Volume', vol],
    ['Son enregistré', fileHeard ? 'Joué' : 'Pas joué', fileHeard],
    ...steps.map(s => [s.name, s.heard ? 'Joué' : 'Pas joué', s.heard]),
    ['Autre app qui joue', st.otherAudioPlaying ? 'Oui' : 'Non'],
    ['Dernier incident', incident],
  ];

  const yes = v => (v === true ? 'oui' : v === false ? 'non' : '?');
  const cat = x => String(x || '?').replace('AVAudioSessionCategory', '').replace('AVAudioSessionMode', '');
  const session = x => `${cat(x.category)} · ${cat(x.mode)} · ${(x.categoryOptions || []).join(', ') || 'sans option'} · active ${yes(x.sessionActive)} · moteur ${yes(x.engineRunning)}`;
  const outputs = (st.outputs || []).map(o => `${o.type} « ${o.name} »`).join(', ') || 'aucune';
  const lines = [
    `Diagnostic du son MDLF Training, ${new Date().toLocaleString('fr-FR')}`,
    `Verdict : ${title}. ${detail}`,
    `À faire : ${action}`,
    `Sortie : ${soundOutputLabel(st.outputs)} [${outputs}]`,
    `Volume : ${vol}`,
    `Mode silencieux : ${res?.silentMode || 'unknown'} (estimé, son système fini en ${Math.round(res?.silentMs ?? -1)} ms)`,
    `Son enregistré : ${file.played ? `pic ${fmtDb(file.peakDb)}, moyen ${fmtDb(file.avgDb)}, ${Math.round(file.ms || 0)} ms` : `non joué (${file.error || '?'})`}`,
    ...steps.map(s => `${s.name} : ${s.heard ? 'joué' : 'pas joué'}, pic ${fmtDb(s.peakDb)}, RMS ${fmtDb(s.rmsDb)}, ${s.buffers} tampons, duck ${yes(s.ducking)}, moteur ${yes(s.engineRunning)}`),
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
  return { ok, title, detail, action, rows, text: lines.join('\n') };
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

// Pastille du verdict et des lignes : coche verte (joué) ou croix rouge (pas joué) ; le mot à côté dit la même chose
function soundMark(ok) {
  return `<span class="sound-diag__mark sound-diag__mark--${ok ? 'ok' : 'bad'}" aria-hidden="true">${icon(ok ? 'checkmark' : 'xmark', 12)}</span>`;
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
    box.innerHTML = `<div class="sound-diag__verdict" tabindex="-1">
        ${soundMark(r.ok)}
        <div class="sound-diag__verdict-body">
          <p class="sound-diag__title">${esc(r.title)}</p>
          <p class="sound-diag__detail">${esc(r.detail)}</p>
          <p class="sound-diag__action">${esc(r.action)}</p>
        </div>
      </div>
      <dl class="sound-diag__list">${r.rows.map(([k, v, ok]) =>
        `<div class="sound-diag__row"><dt>${esc(k)}</dt><dd${ok === false ? ' class="sound-diag__bad"' : ''}>${typeof ok === 'boolean' ? soundMark(ok) : ''}${esc(v)}</dd></div>`).join('')}</dl>
      <p class="sound-diag__recap">${soundMark(r.ok)}<span>${esc(r.title)}</span></p>
      ${soundDiagCopyBtn()}`;
    // Le verdict d'abord : amené en haut de l'écran, juste sous la barre de navigation (collante : sa hauteur,
    // encoche et texte agrandi compris, sert de marge) et lu par VoiceOver
    const verdict = box.querySelector('.sound-diag__verdict');
    verdict.style.scrollMarginTop = `${($('.navbar')?.offsetHeight || 0) + 12}px`;
    verdict.scrollIntoView({ block: 'start' });
    verdict.focus({ preventScroll: true });
  } finally {
    soundDiagRunning = false;
  }
}

registerActions({
  'sound-diagnostics': () => showSoundDiagnostics(),
  'sound-diag-copy': async () => {
    if (!soundDiagText) return;
    try { await navigator.clipboard.writeText(soundDiagText); showToast('Diagnostic copié. Colle\u2011le dans un message à Maxence.'); }
    catch { showToast('Copie impossible, fais une capture d\'écran'); }
  },
});
