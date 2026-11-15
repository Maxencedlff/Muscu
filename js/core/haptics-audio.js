// ═══════════════════════════════════════════════════════════
//  Retour haptique et sons
// ═══════════════════════════════════════════════════════════
'use strict';

// Retour haptique : vibrate() sur Android ; sur iOS 18+, basculer un <input switch> déclenche le Taptic Engine.
// kind : 'light' (toucher, par défaut), 'medium' (erreur de saisie), 'success' ; tout autre argument
// (un événement passé par addEventListener, par exemple) revient à 'light'.
const HAPTIC_KINDS = ['light', 'medium', 'success'];
function haptic(kind = 'light') {
  if (data.vibrateOn === false) return;
  if (Native.haptic(HAPTIC_KINDS.includes(kind) ? kind : 'light')) return;   // app iOS : vrai Taptic Engine
  if (navigator.vibrate) { navigator.vibrate(8); return; }
  // Le clic sur l'interrupteur caché lui donne le focus : rendu ensuite au bouton touché (VoiceOver)
  const prev = document.activeElement;
  try {
    const label = document.createElement('label');
    const sw    = document.createElement('input');
    sw.type = 'checkbox'; sw.setAttribute('switch', '');
    label.appendChild(sw);
    label.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(label);
    label.click();
    label.remove();
    if (prev && prev !== document.body && prev.isConnected) prev.focus({ preventScroll: true });
  } catch {}
}

let audioCtx = null;

// iOS met le contexte en « suspended » (sans geste) ou « interrupted » (appel, arrière-plan, Siri) :
// il est relancé à chaque occasion, sinon les bips suivants restent muets
// App iOS : aucun contexte Web Audio. Les bips y passent par iOS (Native.sound) et un contexte Web Audio
// ouvert par la vue web fait changer à WebKit la catégorie de la session audio de TOUTE l'app (forums Apple
// 24464 et 85256, WebKit 167788 : catégorie « ambiante », coupée par le bouton silencieux). Le module natif
// ne fixant sa catégorie qu'au premier son, tous les sons de l'app devenaient muets en mode silencieux
// après le premier toucher (15/11/2026, app ouverte, sans musique, même le bip d'une série).
function webAudioAllowed() { return !Native.sound?.available; }

function wakeAudio() {
  if (!webAudioAllowed()) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== 'running') audioCtx.resume();
  } catch {}
}

function beep(freq, dur = .15, vol = .35) {
  try {
    wakeAudio();
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + dur);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch {}
}

// Volume des bips (Réglages › Sons) : amplitude de chaque note. « Fort » par défaut depuis le 04/11/2026 :
// à 0,35 (l'ancien réglage, devenu « Bas ») le bip disparaissait sous la musique. Hors fin de repos, la
// musique n'est pas baissée (session .mixWithOthers, ios/App/App/SoundPlugin.swift) : le bip doit porter seul.
const SOUND_LEVELS = { fort: 0.9, normal: 0.6, bas: 0.35 };
function soundVol() { return SOUND_LEVELS[data.soundLevel] ?? SOUND_LEVELS.fort; }

// Mélodies : notes { freq (Hz), start (s depuis le début), dur (s) }. Jouées par iOS dans l'app
// (Native.sound : par-dessus la musique, audibles en mode silencieux), sinon en Web Audio.
const MELODIES = {
  timer:      [[880, 0, .12], [1100, .16, .12], [1320, .32, .35]],
  validation: [[660, 0, .1]],
  finish:     [[880, 0, .1], [1320, .16, .25]],
  record:     [[660, 0, .12], [880, .12, .12], [1100, .24, .12], [1320, .36, .35]],
  tick:       [[440, 0, .08]],
  restCount:  [[880, 0, .11]],                               // repos : chaque bip du decompte 3-2-1 (aigu : ressort de la musique)
  restGo:     [[1050, 0, .1], [1400, .12, .1], [1750, .26, .33]],  // repos : GO, montee nette, differente du decompte
  tempoDown:  [[392, 0, .12]],                  // tempo : début de la descente (grave)
  tempoUp:    [[659, 0, .12]],                  // tempo : début de la montée (aigu)
  tempoX:     [[880, 0, .07], [880, .1, .07]],  // tempo : montée explosive
  tempoRep:   [[523, 0, .08], [1047, .1, .16]], // tempo : nouvelle répétition (deux notes, distincte des phases)
};

// Tous les sons passent par la lecture iOS (.playback, audible en mode silencieux, par-dessus la musique).
// Le passage des confirmations en .ambient (panel t7, build 67) rendait l'app muette, fin du repos comprise,
// sur l'iPhone de Maxence (12/11/2026) : retour au réglage éprouvé, sans nouvelle build (le module natif
// garde le choix ; il sera réessayé, testé sur un vrai iPhone).

// Décompte 3-2-1 et GO de fin de repos : la musique baisse le temps des bips (Réglages › « Baisser la
// musique », oui par défaut ; app iOS, build 68 et suivantes). iOS la remonte 1,2 s après le dernier bip.
const DUCKED_MELODIES = ['restCount', 'restGo'];

// ── Santé de la lecture iOS ─────────────────────────────────
// Le module natif répond au JS avant de jouer (SoundPlugin.swift, play) : un échec n'y est que noté dans
// son journal. Après chaque son, son état est relu (diagnostics, build 68 et suivantes). Lecture en
// panne (catégorie changée par un tiers, session inactive, moteur arrêté, échec noté) : le son suivant
// part avec « duck », seule demande qui force le module à refixer sa catégorie et à réactiver session et
// moteur (prepare) ; le GO de fin de repos est rejoué tout de suite ainsi.
const SOUND_CHECK_DELAY = 350;           // ms après l'envoi : le son est préparé et lancé sur la file audio
const PLAYBACK_CATEGORY = 'AVAudioSessionCategoryPlayback';
let soundNeedsReset = false;
let lastSoundCheck  = null;              // { at, ok, reasons, diag } : affiché par Réglages › Diagnostic du son

// Ce qui cloche dans un état du module (diagnostics), lignes du journal datées de sinceMs ou après
function soundProblems(diag, sinceMs = 0) {
  if (!diag) return [];
  const reasons = [];
  if (diag.category && diag.category !== PLAYBACK_CATEGORY) reasons.push(`catégorie ${diag.category}`);
  if (diag.sessionActive === false) reasons.push('session inactive');
  if (diag.engineRunning === false) reasons.push('moteur arrêté');
  const fails = (diag.journal || []).filter(l => /échec/.test(l) && Date.parse(String(l).slice(0, 20)) >= sinceMs - 1000);
  if (fails.length) reasons.push(fails[fails.length - 1].replace(/^\S+ /, ''));
  return reasons;
}

// Relit l'état du module après un son ; résout { ok, reasons } (ok vrai si rien à relire : build ancienne)
function checkNativeSound(sentAt) {
  return new Promise(resolve => {
    if (typeof Native.sound?.diagnostics !== 'function' || !Native.sound.canDuck) { resolve({ ok: true, reasons: [] }); return; }
    setTimeout(async () => {
      const diag = await Native.sound.diagnostics();
      const reasons = soundProblems(diag, sentAt);
      const ok = !!diag && reasons.length === 0;
      if (!ok) soundNeedsReset = true;
      lastSoundCheck = { at: Date.now(), ok, reasons: diag ? reasons : ['diagnostics sans réponse'], diag };
      resolve({ ok, reasons });
    }, SOUND_CHECK_DELAY);
  });
}

// Joue la mélodie. Résout { ok } une fois l'état du module relu (lecture iOS), tout de suite sinon.
function playMelody(name, { replay = true } = {}) {
  if (data.soundOn === false) return Promise.resolve({ ok: true, reasons: [] });
  const vol = soundVol();
  const notes = MELODIES[name].map(([freq, start, dur]) => ({ freq, start, dur, vol }));
  if (Native.sound.available) {
    const wantsDuck = data.duckMusic !== false && DUCKED_MELODIES.includes(name);
    const forced = soundNeedsReset && !!Native.sound.canDuck;
    if (forced) soundNeedsReset = false;
    const sentAt = Date.now();
    Native.sound.play(notes, true, wantsDuck || forced);
    return checkNativeSound(sentAt).then(res => {
      // GO de fin de repos perdu : rejoué une fois, module remis en état par le duck forcé
      if (!res.ok && replay && name === 'restGo') return playMelody(name, { replay: false });
      return res;
    });
  }
  notes.forEach(n => setTimeout(() => beep(n.freq, n.dur, n.vol), n.start * 1000));
  return Promise.resolve({ ok: true, reasons: [] });
}

// Voix de synthèse (Web Speech API, MDN : speechSynthesis) : compte des répétitions du tempo.
// Sans voix disponible, le son de la répétition suffit ; coupée avec le son de l'app.
function sayCount(n) {
  if (data.soundOn === false || typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(n));
    u.lang = 'fr-FR'; u.rate = 1.15;
    speechSynthesis.speak(u);
  } catch {}
}

function restCountBeep() { playMelody('restCount'); }

function timerDone() {
  const played = playMelody('restGo');
  if (data.vibrateOn !== false && !Native.haptic('success') && navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
  return played;
}

// Réglages › Sons › « Tester la fin de repos » : la vraie séquence, 3-2-1 puis GO, avec les réglages
// (volume, baisser la musique). Résout l'état relu après le GO.
function testRestEndSound() {
  return new Promise(resolve => {
    [0, 1000, 2000].forEach(t => setTimeout(restCountBeep, t));
    setTimeout(() => resolve(playMelody('restGo')), 3000);
  });
}

function validationSound() { playMelody('validation'); }
function finishSound()     { playMelody('finish'); }
function recordSound()     { playMelody('record'); }

// Son : le contexte audio est créé (ou réveillé) au premier geste, iOS refuse de le démarrer depuis un minuteur
document.addEventListener('pointerdown', wakeAudio, { passive: true });
