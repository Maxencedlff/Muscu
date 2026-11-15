// ═══════════════════════════════════════════════════════════
//  Sons du tempo guidé (MELODIES de js/core/haptics-audio.js, séquence de js/features/effort-tempo.js)
// ═══════════════════════════════════════════════════════════
//
// La lecture iOS (SoundPlugin.swift, render()) additionne des sinus puis écrête à ±1 : un timbre de bois
// fait de plusieurs partiels ne doit jamais dépasser 1 au volume « Fort ». Les sons des phases restent
// reconnaissables à l'oreille (sens de la hauteur, distincts entre eux et de la fin de repos), et la série
// en fait entendre un par seconde, comme un métronome.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const TEMPO = ['tempoDown', 'tempoUp', 'tempoX', 'tempoTick', 'tempoRepDown', 'tempoRepUp'];
const LOUD = 0.9;              // SOUND_LEVELS.fort
const SEMITONE = 2 ** (1 / 12);

export default function ({ test, assert, sameJSON, ROOT }) {
  const src = fs.readFileSync(path.join(ROOT, 'js/core/haptics-audio.js'), 'utf8');
  const audioContext = extra => {
    const box = { data: { soundOn: true }, navigator: {}, document: { addEventListener() {} },
                  Native: { haptic: () => true, sound: { available: false } }, ...extra };
    const c = vm.createContext(box);
    vm.runInContext(src + '\nthis.MELODIES = MELODIES; this.playMelody = playMelody;', c);
    return c;
  };
  const MELODIES = JSON.parse(JSON.stringify(audioContext().MELODIES));
  const gainOf = n => n[3] ?? 1;

  // Amplitude maximale possible : somme des enveloppes de render() (attaque 4 ms, décroissance jusqu'à
  // 0,001 sur la durée), échantillonnée toutes les 0,1 ms. Un sinus ne dépasse jamais 1 : borne exacte.
  function peakBound(notes, vol) {
    const end = Math.max(...notes.map(([, s, d]) => s + d));
    let best = 0;
    for (let t = 0; t <= end; t += 1e-4) {
      let sum = 0;
      for (const n of notes) {
        const k = t - n[1];
        if (k >= 0 && k < n[2]) sum += vol * gainOf(n) * Math.exp(Math.log(0.001) * k / n[2]) * Math.min(1, k / 0.004);
      }
      best = Math.max(best, sum);
    }
    return best;
  }
  // Hauteur entendue de chaque coup : la note la plus forte parmi celles qui partent au même instant
  function strokes(notes) {
    const byStart = new Map();
    for (const n of notes) {
      const k = n[1].toFixed(4), cur = byStart.get(k);
      if (!cur || gainOf(n) > gainOf(cur)) byStart.set(k, n);
    }
    return [...byStart.values()].sort((a, b) => a[1] - b[1]).map(n => n[0]);
  }

  test('sons du tempo : notes valides et dans les bornes de SoundPlugin.swift', () => {
    for (const name of TEMPO) {
      assert.ok(Array.isArray(MELODIES[name]) && MELODIES[name].length > 0, `${name} : défini`);
      for (const n of MELODIES[name]) {
        assert.ok(n.length === 3 || n.length === 4, `${name} : [freq, start, dur, gain ?]`);
        assert.ok(n.every(Number.isFinite), `${name} : nombres finis ${JSON.stringify(n)}`);
        const [f, s, d] = n;
        assert.ok(f > 20 && f < 20000 && s >= 0 && s < 5 && d > 0 && d < 2, `${name} : hors bornes ${JSON.stringify(n)}`);
        assert.ok(gainOf(n) > 0 && gainOf(n) <= 1, `${name} : gain entre 0 et 1`);
      }
      // Le son natif coupe le précédent et il en part un par seconde : chacun finit avant le suivant
      assert.ok(Math.max(...MELODIES[name].map(([, s, d]) => s + d)) < 0.5, `${name} : moins de 0,5 s`);
    }
  });

  test('sons : aucune mélodie n\'écrête au volume « Fort » (somme des partiels sous 1)', () => {
    for (const [name, notes] of Object.entries(MELODIES)) {
      const peak = peakBound(notes, LOUD);
      assert.ok(peak < 1, `${name} : crête possible ${peak.toFixed(3)}`);
    }
    // Garde-fou du calcul : deux notes pleines simultanées dépassent bien 1
    assert.ok(peakBound([[440, 0, .1], [660, 0, .1]], LOUD) > 1);
  });

  test('sons du tempo : la descente descend, la montée monte, la nouvelle rep garde le sens', () => {
    const falls = fs => fs.every((f, i) => i === 0 || f < fs[i - 1]);
    const rises = fs => fs.every((f, i) => i === 0 || f > fs[i - 1]);
    assert.ok(falls(strokes(MELODIES.tempoDown)) && strokes(MELODIES.tempoDown).length === 2, 'descente : aigu puis grave');
    assert.ok(rises(strokes(MELODIES.tempoUp)) && strokes(MELODIES.tempoUp).length === 2, 'montée : grave puis aigu');
    assert.ok(rises(strokes(MELODIES.tempoX)) && strokes(MELODIES.tempoX).length === 3, 'explosive : trois coups qui montent');
    assert.equal(strokes(MELODIES.tempoTick).length, 1, 'tic : un seul coup');
    // Nouvelle rep : un accent plus aigu que tout le reste, puis exactement le geste de la phase
    for (const [rep, phase] of [['tempoRepDown', 'tempoDown'], ['tempoRepUp', 'tempoUp']]) {
      const [accent, ...rest] = strokes(MELODIES[rep]);
      sameJSON(rest, strokes(MELODIES[phase]), `${rep} : le geste de ${phase}`);
      assert.ok(accent > Math.max(...rest), `${rep} : accent plus aigu`);
    }
  });

  test('sons du tempo : distincts entre eux et du décompte de fin de repos', () => {
    const sig = name => JSON.stringify(MELODIES[name]);
    for (const a of TEMPO) for (const b of TEMPO) if (a < b) assert.notEqual(sig(a), sig(b), `${a} ≠ ${b}`);
    // Aucun coup du tempo à moins d'un demi-ton d'une note du décompte ou du GO, et pas de sinus seul
    const rest = [...MELODIES.restCount, ...MELODIES.restGo].map(n => n[0]);
    for (const name of TEMPO) {
      for (const f of strokes(MELODIES[name])) {
        for (const r of rest) assert.ok(Math.max(f / r, r / f) >= SEMITONE, `${name} : ${f} Hz trop près de ${r} Hz (repos)`);
      }
      assert.ok(MELODIES[name].length >= 2 * strokes(MELODIES[name]).length, `${name} : chaque coup a des partiels`);
    }
    // Le tic de chaque seconde reste nettement plus discret que les sons des phases
    for (const name of ['tempoDown', 'tempoUp', 'tempoX']) {
      assert.ok(peakBound(MELODIES.tempoTick, 1) < 0.5 * peakBound(MELODIES[name], 1), `tic plus discret que ${name}`);
    }
  });

  test('playMelody : le gain de chaque note s\'applique au volume choisi ; Web Audio cale les partiels ensemble', () => {
    let sent = null;
    const c = audioContext({ Native: { haptic: () => true, sound: { available: true, play: n => { sent = n; } } } });
    c.playMelody('tempoTick');
    sameJSON(sent.map(n => n.vol), MELODIES.tempoTick.map(n => LOUD * gainOf(n)), 'Fort × gain');
    c.data.soundLevel = 'bas'; c.playMelody('tempoUp');
    sameJSON(sent.map(n => n.vol), MELODIES.tempoUp.map(n => 0.35 * gainOf(n)), 'Bas × gain');
    c.playMelody('restCount');
    assert.ok(sent.every(n => n.vol === 0.35), 'mélodie sans gain : volume entier');

    // Hors app : chaque note programmée sur l'horloge audio (start), sans setTimeout, à son volume
    const started = [], gains = [];
    class FakeCtx {
      constructor() { this.currentTime = 10; this.state = 'running'; this.destination = {}; }
      createOscillator() { return { frequency: {}, connect() {}, start: t => started.push(t), stop() {} }; }
      createGain() {
        const g = { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime: v => gains.push(v) };
        return { gain: g, connect() {} };
      }
    }
    const w = audioContext({ window: { AudioContext: FakeCtx }, setTimeout: () => { throw new Error('setTimeout'); } });
    w.playMelody('tempoRepDown');
    sameJSON(started.map(t => +(t - 10).toFixed(4)), MELODIES.tempoRepDown.map(n => +n[1].toFixed(4)), 'départs');
    sameJSON(gains.map(v => +v.toFixed(4)), MELODIES.tempoRepDown.map(n => +(LOUD * gainOf(n)).toFixed(4)), 'volumes');
    // App iOS : beep() n'ouvre jamais de Web Audio, même appelé directement (webAudioAllowed)
    let opened = 0;
    class CountCtx extends FakeCtx { constructor() { super(); opened++; } }
    const n = audioContext({ window: { AudioContext: CountCtx }, Native: { haptic: () => true, sound: { available: true, play() {} } } });
    n.playMelody('tempoRepDown'); vm.runInContext('beep(784, .1, .5)', n);
    assert.equal(opened, 0, 'aucun contexte Web Audio dans l\'app');
  });

  test('série au tempo : un son par seconde, le geste au début de chaque mouvement, l\'accent à chaque rep', () => {
    // effort-tempo.js chargé seul, l'interface et les sons remplacés par des enregistreurs
    const played = [], said = [];
    const box = {
      $: () => null, RING_BIG: 1, playMelody: n => played.push([box.now, n]), sayCount: n => said.push(n),
      announce() {}, haptic() {}, finishEffort() {}, persistSession() {},
    };
    const c = vm.createContext(box);
    vm.runInContext('let effortLastSecond = null;\n' + fs.readFileSync(path.join(ROOT, 'js/data/effort-clock.js'), 'utf8')
      + '\n' + fs.readFileSync(path.join(ROOT, 'js/features/effort-tempo.js'), 'utf8')
      + '\nDate.now = () => this.now; this.updateTempoUI = updateTempoUI;', c);
    const serie = (tempo, conFirst) => {
      played.length = 0; said.length = 0; vm.runInContext('effortLastSecond = null', c);
      const e = { kind: 'tempo', start: 2000, prep: 2, tempo, reps: 2, conFirst };
      for (box.now = 0; box.now < 2000 + 2 * 5000; box.now += 100) c.updateTempoUI(e);   // toutes les 100 ms, comme effort.js
      return played.filter(([t]) => t >= 2000).map(([t, n]) => `${(t - 2000) / 1000}:${n}`);
    };
    // 3-1-1-0 en poussant : rep (descente), tic, tic, tic (pause en bas), montée ; deux reps
    sameJSON(serie([3, 1, 1, 0], false), ['0:tempoRepDown', '1:tempoTick', '2:tempoTick', '3:tempoTick', '4:tempoUp',
      '5:tempoRepDown', '6:tempoTick', '7:tempoTick', '8:tempoTick', '9:tempoUp']);
    sameJSON([...said], [1, 2], 'numéro de chaque rep dit à voix haute');
    // En tirant, montée explosive : la rep commence par la montée, la descente garde son geste
    sameJSON(serie([3, 0, 'X', 0], true), ['0:tempoRepUp', '1:tempoDown', '2:tempoTick', '3:tempoTick',
      '4:tempoRepUp', '5:tempoDown', '6:tempoTick', '7:tempoTick']);
    // Montée explosive en poussant : son à part
    assert.ok(serie([2, 0, 'X', 0], false).includes('2:tempoX'), 'X : trois coups serrés');
  });
}
