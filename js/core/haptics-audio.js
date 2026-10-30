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
  try {
    const label = document.createElement('label');
    const sw    = document.createElement('input');
    sw.type = 'checkbox'; sw.setAttribute('switch', '');
    label.appendChild(sw);
    label.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(label);
    label.click();
    label.remove();
  } catch {}
}

let audioCtx = null;

// iOS met le contexte en « suspended » (sans geste) ou « interrupted » (appel, arrière-plan, Siri) :
// il est relancé à chaque occasion, sinon les bips suivants restent muets
function wakeAudio() {
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

// Mélodies : notes { freq (Hz), start (s depuis le début), dur (s) }. Jouées par iOS dans l'app
// (Native.sound : audibles en mode silencieux, par-dessus la musique), sinon en Web Audio.
const MELODIES = {
  timer:      [[880, 0, .12], [1100, .16, .12], [1320, .32, .35]],
  validation: [[660, 0, .1]],
  finish:     [[880, 0, .1], [1320, .16, .25]],
  record:     [[660, 0, .12], [880, .12, .12], [1100, .24, .12], [1320, .36, .35]],
  tick:       [[440, 0, .08]],
  restCount:  [[700, 0, .11]],                               // repos : chaque bip du decompte 3-2-1 (sec, moyen)
  restGo:     [[1050, 0, .1], [1400, .12, .1], [1750, .26, .33]],  // repos : GO, montee nette, differente du decompte
  tempoDown:  [[392, 0, .12]],                  // tempo : début de la descente (grave)
  tempoUp:    [[659, 0, .12]],                  // tempo : début de la montée (aigu)
  tempoX:     [[880, 0, .07], [880, .1, .07]],  // tempo : montée explosive
  tempoRep:   [[523, 0, .08], [1047, .1, .16]], // tempo : nouvelle répétition (deux notes, distincte des phases)
};

function playMelody(name) {
  if (data.soundOn === false) return;
  const notes = MELODIES[name].map(([freq, start, dur]) => ({ freq, start, dur }));
  if (Native.sound.available) { Native.sound.play(notes); return; }
  notes.forEach(n => setTimeout(() => beep(n.freq, n.dur), n.start * 1000));
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
  playMelody('restGo');
  if (data.vibrateOn !== false && !Native.haptic('success') && navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
}

function validationSound() { playMelody('validation'); }
function finishSound()     { playMelody('finish'); }
function recordSound()     { playMelody('record'); }

// Son : le contexte audio est créé (ou réveillé) au premier geste, iOS refuse de le démarrer depuis un minuteur
document.addEventListener('pointerdown', wakeAudio, { passive: true });
