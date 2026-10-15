// ═══════════════════════════════════════════════════════════
//  Retour haptique et sons
// ═══════════════════════════════════════════════════════════
'use strict';

// Retour haptique : vibrate() sur Android ; sur iOS 18+, basculer un <input switch> déclenche le Taptic Engine
function haptic() {
  if (data.vibrateOn === false) return;
  if (Native.haptic('light')) return;   // app iOS : vrai Taptic Engine
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

function beep(freq, dur = .15, vol = .35) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

function timerDone() {
  if (data.soundOn !== false) { beep(880, .12); setTimeout(() => beep(1100, .12), 160); setTimeout(() => beep(1320, .35), 320); }
  if (data.vibrateOn !== false && !Native.haptic('success') && navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
}

function validationSound() { if (data.soundOn !== false) beep(660, .1); }
function finishSound()     { if (data.soundOn !== false) { beep(880, .1); setTimeout(() => beep(1320, .25), 160); } }

function recordSound() {
  if (data.soundOn === false) return;
  [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => beep(f, i === 3 ? .35 : .12), i * 120));
}

// Son : le contexte audio est créé (ou réveillé) au premier geste, iOS refuse de le démarrer depuis un minuteur
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}
document.addEventListener('pointerdown', unlockAudio, { passive: true });
