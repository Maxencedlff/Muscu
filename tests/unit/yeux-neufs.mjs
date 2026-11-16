// ═══════════════════════════════════════════════════════════
//  Panel « yeux neufs » du 16/11/2026, vague 1 : corrections sans choix produit (séance d'un débutant,
//  objectif et cases, programme du coach, import Strong / Hevy, mots entiers, VoiceOver, « Comment faire »)
// ═══════════════════════════════════════════════════════════

export default function ({ test, run, reset, assert }) {
  const DAY = 86400000;
  const set = (weight, reps) => ({ weight, reps, done: true });
  // Séance simulée sur les vraies fonctions de js/features/session.js ; écran et stockage remplacés le temps du test
  function withSession(fn) {
    // Hors du navigateur : pas de routeur ni de verrou d'écran (startSession les appelle à la fin)
    run(`for (const k of ['routeTo', 'requestWakeLock', 'otaSessionChanged']) globalThis[k] ||= () => {};
      globalThis.__ynOrig = { render, persistSession, haptic, showToast, sp: globalThis.sessProg };
      render = () => {}; persistSession = () => {}; haptic = () => {};
      showToast = (msg, o) => { globalThis.lastToast = { msg, o }; };
      globalThis.sessProg = () => data.programmes[activeSession.programme];`);
    try { fn(); } finally {
      run(`render = __ynOrig.render; persistSession = __ynOrig.persistSession; haptic = __ynOrig.haptic; showToast = __ynOrig.showToast;
        globalThis.sessProg = __ynOrig.sp; activeSession = null;`);
    }
  }
  function seedRow(name, sets, extra = {}) {
    run(`data.activeProgramme = 'ppl';
      data.programmes.ppl.exercises.pull = [{ id: 'row', name: ${JSON.stringify(name)}, sets: 4, ...${JSON.stringify(extra)} }];
      data.history = ${sets ? `[{ id: 'h1', programme: 'ppl', category: 'pull', date: Date.now() - ${DAY}, duration: 3000000,
        exercises: [{ exId: 'row', name: ${JSON.stringify(name)}, sets: ${JSON.stringify(sets)} }] }]` : '[]'};`);
  }

  test('yeux neufs 1 : « Première fois » sous un exercice jamais fait, tant que rien n\'est validé', () => withSession(() => {
    reset();
    seedRow('Rowing barre', null);
    run(`startSession('pull')`);
    const ex = 'activeSession.exercises[0]';
    assert.match(run(`exFirstTimeHtml(${ex})`), /Première fois : prends un poids que tu soulèves 15 fois facilement/);
    // Une série validée : la ligne s'en va
    run(`${ex}.sets[0].weight = '40'; ${ex}.sets[0].reps = '10'; ${ex}.sets[0].done = true`);
    assert.equal(run(`exFirstTimeHtml(${ex})`), '', 'une série validée : plus de ligne');
    // Déjà fait : la colonne « Avant » sert de repère, pas de ligne
    seedRow('Rowing barre', [set('40', '10')]);
    run(`startSession('pull')`);
    assert.equal(run(`exFirstTimeHtml(${ex})`), '', 'déjà fait : pas de ligne');
    // Sans charge à choisir : poids du corps, durée
    for (const name of ['Pompes', 'Tractions pronation', 'Gainage']) {
      seedRow(name, null);
      run(`startSession('pull')`);
      assert.equal(run(`exFirstTimeHtml(${ex})`), '', `${name} : pas de poids à prendre`);
    }
  }));
}
