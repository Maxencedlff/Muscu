// ═══════════════════════════════════════════════════════════
//  Entraînement intelligent (js/data/training-insights.js) : niveau de force, semaine plus légère,
//  stagnation, reprise après la décharge, nettoyage et classement des réglages
// ═══════════════════════════════════════════════════════════
export default function ({ test, run, reset, assert, sameJSON }) {
  const DAY = 86_400_000;
  // Lundi 2 novembre 2026, 10 h (heure locale) : la semaine en cours commence ce jour-là
  const NOW = new Date(2026, 10, 2, 10).getTime();
  const at = daysBefore => NOW - daysBefore * DAY;
  const js = v => JSON.stringify(v);
  const set = (weight, reps, extra = {}) => ({ weight: String(weight), reps: String(reps), ...extra });
  const entry = (id, date, exercises) => ({ id, programme: 'ppl', category: 'push', date, notes: '', exercises });
  const ex = (name, sets, exId) => ({ exId: exId || 'n:' + name.toLowerCase(), name, sets });

  // ── Niveau de force ──

  test('niveau : exercices principaux reconnus par leur nom et leurs alias, pas les variantes', () => {
    reset();
    const lift = n => run(`strengthLiftOf(${js(n)})?.id ?? null`);
    assert.equal(lift('Développé couché'), 'bench');
    assert.equal(lift('bench press'), 'bench');
    assert.equal(lift('Squat barre'), 'squat');
    assert.equal(lift('back squat'), 'squat');
    assert.equal(lift('SDT'), 'deadlift');
    assert.equal(lift('Développé militaire'), 'ohp');
    assert.equal(lift('Rowing barre'), 'row');
    for (const n of ['Développé couché haltères', 'Développé couché machine', 'Développé couché prise serrée', 'Soulevé de terre sumo',
      'Soulevé de terre roumain', 'Développé militaire haltères', 'Rowing haltère unilatéral', 'Squat gobelet', 'Mon exercice'])
      assert.equal(lift(n), null, n);
  });

  test('niveau : seuils Strength Level (1RM ÷ poids du corps), hommes et femmes, palier suivant en kg', () => {
    reset();
    const st = (id, e1rm, kg, sex) => run(`strengthStanding(STRENGTH_LIFTS.find(l => l.id === ${js(id)}), ${e1rm}, ${kg}, ${js(sex)})`);
    // Homme de 80 kg au développé couché : 1,25 × 80 = 100 kg = intermédiaire pile ; avancé à 1,5 × 80 = 120 kg
    let s = st('bench', 100, 80, 'male');
    assert.equal(s.label, 'Intermédiaire');
    assert.equal(s.ratio, 1.25);
    sameJSON(s.next, { label: 'Avancé', kg: 120 });
    assert.equal(s.progress, 0);
    s = st('bench', 110, 80, 'male');
    assert.equal(s.label, 'Intermédiaire');
    assert.equal(s.progress, 0.5, 'à mi-chemin de 100 à 120 kg');
    // Même charge, femme de 60 kg : 100 / 60 = 1,67 ≥ 1,45 → élite, sans palier suivant
    s = st('bench', 100, 60, 'female');
    assert.equal(s.label, 'Élite');
    assert.equal(s.next, null);
    assert.equal(s.progress, 1);
    // Sous le seuil « novice » (et même sous « débutant ») : Débutant, novice comme prochain palier
    s = st('squat', 40, 80, 'male');
    assert.equal(s.label, 'Débutant');
    sameJSON(s.next, { label: 'Novice', kg: 100 });
    assert.equal(s.progress, 0.4, '40 kg sur 100 kg, depuis zéro');
    assert.equal(st('deadlift', 260, 80, 'male').label, 'Élite', '3,25 × 80 = 260 kg');
    assert.equal(st('ohp', 43.9, 80, 'male').label, 'Débutant', 'novice à 0,55 × 80 = 44 kg, pas encore atteint');
    assert.equal(st('ohp', 44, 80, 'male').label, 'Novice');
    // Poids du corps inconnu ou absurde : pas de niveau
    assert.equal(st('bench', 100, 0, 'male'), null);
    assert.equal(st('bench', 100, 400, 'male'), null);
    assert.equal(st('bench', 0, 80, 'male'), null);
  });

  test('niveau : chaque exercice principal a 5 seuils croissants par sexe et existe dans la bibliothèque', () => {
    reset();
    const lifts = run('STRENGTH_LIFTS.map(l => ({ id: l.id, name: l.name, male: l.male, female: l.female, known: catalogueEntry(l.name)?.name === l.name }))');
    assert.equal(lifts.length, 5);
    for (const l of lifts) {
      assert.ok(l.known, `${l.name} dans la bibliothèque`);
      for (const sex of ['male', 'female']) {
        assert.equal(l[sex].length, 5, `${l.id} ${sex}`);
        for (let i = 1; i < 5; i++) assert.ok(l[sex][i] > l[sex][i - 1], `${l.id} ${sex} croissant`);
      }
      for (let i = 0; i < 5; i++) assert.ok(l.female[i] < l.male[i], `${l.id} : repères femmes sous les repères hommes`);
    }
  });

  test('niveau : meilleur 1RM estimé des 90 derniers jours, séries de travail seulement', () => {
    reset();
    const hist = [
      entry('a', at(100), [ex('Développé couché', [set(120, 1)])]),                                  // trop ancien
      entry('b', at(30), [ex('Développé couché', [set(90, 5), set(100, 5, { warmup: true })])]),     // échauffement ignoré
      entry('c', at(10), [ex('bench press', [set(80, 10)])]),                                        // alias : même exercice
      entry('d', at(5), [ex('Développé couché haltères', [set(50, 10)])]),                          // variante : ignorée
      entry('e', at(3), [ex('Développé couché', [set(95, 15)])]),                                   // > 12 reps : pas d'estimation
    ];
    const best = run(`liftBestE1rm(${js(hist)}, STRENGTH_LIFTS.find(l => l.id === 'bench'), { now: ${NOW} })`);
    // 90 × (1 + 5/30) = 105 ; 80 × (1 + 10/30) = 106,7
    sameJSON(best, { e1rm: 106.7, date: at(10) });
    const before = run(`liftBestE1rm(${js(hist)}, STRENGTH_LIFTS.find(l => l.id === 'bench'), { now: ${NOW}, before: ${at(10)} })`);
    sameJSON(before, { e1rm: 105, date: at(30) }, 'avant la séance c');
    const list = run(`strengthStandings(${js(hist)}, 80, 'male', ${NOW})`);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Développé couché barre');
    assert.equal(list[0].standing.label, 'Intermédiaire');
  });

  test('niveau : bilan, palier franchi par la séance (et pas à la première séance)', () => {
    reset();
    const old = entry('o', at(20), [ex('Squat barre', [set(90, 5)])]);       // 105 kg : novice à 80 kg (100)
    const now = entry('n', at(0), [ex('Squat barre', [set(120, 5)]), ex('Curl biceps', [set(15, 10)])]);   // 140 kg : intermédiaire (140)
    const r = run(`sessionStrengthLevels(${js(now)}, ${js([now, old])}, 80, 'male')`);
    assert.equal(r.length, 1, 'le curl n\'a pas de repère');
    assert.equal(r[0].standing.label, 'Intermédiaire');
    assert.equal(r[0].up, true);
    const first = run(`sessionStrengthLevels(${js(old)}, ${js([old])}, 80, 'male')`);
    assert.equal(first[0].up, false, 'aucun niveau d\'avant : pas de « nouveau palier »');
    assert.equal(run(`sessionStrengthLevels(${js(now)}, ${js([now, old])}, null, 'male').length`), 0, 'sans poids du corps');
  });

  test('niveau : repères femmes avec la silhouette Femme, hommes sinon', () => {
    reset();
    assert.equal(run(`strengthSex({ silhouette: 'female' })`), 'female');
    assert.equal(run(`strengthSex({ silhouette: 'male' })`), 'male');
    assert.equal(run(`strengthSex({})`), 'male');
  });

  // ── Périodisation ──

  // Historique de `weeks` semaines complètes avant NOW, `perWeek` séances par semaine de 3 exercices à 3 séries.
  // e1 : function(semaine, exercice) → charge pour 5 reps ; rir : RIR noté (ou null)
  function block({ weeks = 6, perWeek = 3, load = () => 80, rir = () => null, sets = () => 3 } = {}) {
    const hist = [];
    for (let w = weeks; w >= 1; w--) {
      for (let k = 0; k < perWeek; k++) {
        const date = at(7 * w - 2 * k) - 3600_000;   // lundi, mercredi, vendredi de la semaine w avant NOW
        const exs = ['Développé couché', 'Squat barre', 'Rowing barre'].map((n, i) =>
          ex(n, Array.from({ length: sets(w, i) }, () => set(load(w, i, k), 5, rir(w) == null ? {} : { rir: rir(w) }))));
        hist.push(entry(`w${w}k${k}`, date, exs));
      }
    }
    return hist.sort((a, b) => b.date - a.date);
  }
  const advice = (d, now = NOW) => run(`trainingAdvice(${js({ history: [], ...d })}, ${now})`);

  test('périodisation : semaines chargées d\'affilée, coupées par une semaine légère, vide ou de décharge', () => {
    reset();
    const weeks = sets => sets.map((s, i) => ({ start: i, sessions: s ? 3 : 0, sets: s, deload: false }));
    assert.equal(run(`loadedStreak(${js(weeks([30, 30, 30, 30]))})`), 4);
    assert.equal(run(`loadedStreak(${js(weeks([30, 30, 15, 30, 30]))})`), 2, '15 < 60 % de 30');
    assert.equal(run(`loadedStreak(${js(weeks([30, 0, 30, 30, 30]))})`), 3, 'semaine sans séance');
    assert.equal(run(`loadedStreak(${js(weeks([30, 30, 30, 0]))})`), 0, 'dernière semaine vide');
    const w = weeks([30, 30, 30, 30]); w[2].deload = true;
    assert.equal(run(`loadedStreak(${js(w)})`), 1, 'décharge enregistrée');
    assert.equal(run(`loadedStreak([])`), 0);
    const lighter = weeks([30, 30, 30, 30]); lighter[2].intensity = 0.9; lighter[3].intensity = 1.01;
    assert.equal(run(`loadedStreak(${js(lighter)})`), 1, 'mêmes séries mais charges baissées de 10 %');
    // weekIntensity : une semaine à 90 % des charges des 4 semaines d'avant, sur deux exercices
    const deloaded = block({ weeks: 6, load: w => (w === 2 ? 72 : 80) });
    const tw2 = run(`trainingWeeks(${js(deloaded)}, ${NOW}, 6)`);
    sameJSON(tw2.map(x => x.intensity), [null, 1, 1, 1, 0.9, 1], "la 1re semaine n'a rien avant elle");
    assert.equal(advice({ history: deloaded }), null, 'décharge par la charge il y a deux semaines : série coupée');
    // trainingWeeks : semaines complètes seulement (la semaine en cours n'est pas jugée)
    const tw = run(`trainingWeeks(${js(block({ weeks: 2 }))}.concat([${js(entry('x', NOW - 1000, [ex('Squat barre', [set(80, 5)])]))}]), ${NOW}, 3)`);
    sameJSON(tw.map(x => x.sessions), [0, 3, 3]);
    sameJSON(tw.map(x => x.sets), [0, 27, 27]);
  });

  test('périodisation : courbe du 1RM estimé, progrès, stagnation et recul', () => {
    reset();
    const pts = loads => loads.map((l, i) => entry('p' + i, at(50 - i * 7), [ex('Squat barre', [set(l, 5)])]));
    const status = loads => run(`exerciseTrends(${js(pts(loads))}, ${NOW})`)[0]?.status ?? null;
    assert.equal(status([80, 82.5, 85, 87.5]), 'up');
    assert.equal(status([80, 85, 85, 85, 85]), 'flat', '3 séances et 21 jours sans mieux');
    assert.equal(status([80, 85, 82.5, 80]), 'down', '81,25 en moyenne < 97 % de 85');
    assert.equal(status([80, 85, 85]), null, 'trop peu de séances pour juger');
    // Exercices au poids du corps, en durée ou aidés : jamais jugés sur la charge
    const bw = [0, 1, 2, 3].map(i => entry('b' + i, at(30 - i * 7), [ex('Tractions pronation', [set('', 8)]), ex('Gainage (planche)', [set('', 60)])]));
    sameJSON(run(`exerciseTrends(${js(bw)}, ${NOW})`), []);
    // Stagnation d'un exercice donné (Progrès › Exercice)
    assert.equal(run(`exerciseStall(${js(pts([80, 85, 85, 85, 85]))}, 'n:squat barre', ${NOW})?.sinceBest`), 3);
    assert.equal(run(`exerciseStall(${js(pts([80, 82.5, 85, 87.5]))}, 'n:squat barre', ${NOW})`), null);
  });

  test('périodisation : effort noté qui monte (RIR), seulement avec assez de séries notées', () => {
    reset();
    const h = block({ weeks: 6, rir: w => (w <= 2 ? 0 : 2) });   // RPE 8 puis RPE 10 les deux dernières semaines
    const e = run(`effortTrend(${js(h)}, ${NOW})`);
    assert.equal(e.rising, true);
    assert.equal(e.recent, 10);
    assert.equal(e.prior, 8.2, 'le lundi d\'il y a deux semaines (RPE 10) tombe juste avant les 14 jours');
    assert.equal(run(`effortTrend(${js(block({ weeks: 6 }))}, ${NOW})`), null, 'aucun RIR noté');
  });

  test('périodisation : décharge conseillée quand les progrès stagnent après 4 semaines chargées', () => {
    reset();
    // 6 semaines : progrès les deux premières, puis plus rien sur les trois exercices
    const flat = block({ weeks: 6, load: w => (w >= 5 ? 70 + (6 - w) * 5 : 80) });
    const a = advice({ history: flat });
    assert.equal(a.kind, 'deload');
    assert.equal(a.streak, 6);
    sameJSON(a.stalled.sort(), ['Développé couché', 'Rowing barre', 'Squat barre']);
    assert.equal(a.usualSets, 9);
    assert.equal(a.targetSets, 5, 'environ la moitié des séries habituelles');
    // Mêmes semaines, charges qui montent chaque semaine : rien à dire avant 8 semaines
    const up = block({ weeks: 6, load: w => 100 - w * 2.5 });
    assert.equal(advice({ history: up }), null);
    // 3 semaines seulement : trop tôt, même si ça stagne
    assert.equal(advice({ history: block({ weeks: 3 }) }), null);
    // Une semaine légère récente remet le compteur à zéro
    const light = flat.filter(h => !(h.date >= at(14) && h.date < at(7) && !h.id.endsWith('k0')));
    assert.equal(advice({ history: light }), null, 'une seule séance il y a deux semaines');
  });

  test('périodisation : décharge après 8 semaines chargées même sans stagnation ; effort qui monte + un exercice qui stagne', () => {
    reset();
    const up8 = block({ weeks: 8, load: w => 100 - w * 2.5 });
    const a = advice({ history: up8 });
    assert.equal(a.kind, 'deload');
    sameJSON(a.stalled, []);
    // 5 semaines : un seul exercice stagne (pas la moitié des 3), mais l'effort noté monte
    const tired = block({ weeks: 5, load: (w, i) => (i === 0 ? 80 : 100 - w * 2.5), rir: w => (w <= 2 ? 0 : 2) });
    const b = advice({ history: tired });
    assert.equal(b.kind, 'deload');
    sameJSON(b.stalled, ['Développé couché']);
    assert.equal(b.effort.rising, true);
    // Sans RIR noté, ce seul exercice ne suffit pas
    assert.equal(advice({ history: block({ weeks: 5, load: (w, i) => (i === 0 ? 80 : 100 - w * 2.5) }) }), null);
  });

  test('périodisation : réglage coupé, « Pas maintenant », décharge en cours puis reprise des charges', () => {
    reset();
    const flat = block({ weeks: 6 });
    assert.equal(advice({ history: flat }).kind, 'deload');
    assert.equal(advice({ history: flat, trainingTipsOff: true }), null, 'conseils coupés');
    assert.equal(advice({ history: flat, deloadSnooze: NOW + DAY }), null, 'Pas maintenant');
    assert.equal(advice({ history: flat, deloadSnooze: NOW - DAY }).kind, 'deload', 'délai passé');
    const dl = { start: NOW - DAY, end: NOW + 6 * DAY };
    const on = advice({ history: flat, deload: dl });
    sameJSON({ kind: on.kind, end: on.end, usualSets: on.usualSets, targetSets: on.targetSets },
      { kind: 'deload-active', end: dl.end, usualSets: 9, targetSets: 5 });
    // La semaine d'après : les charges d'avant la décharge, les plus lourdes d'abord
    const after = advice({ history: flat, deload: dl }, NOW + 8 * DAY);
    assert.equal(after.kind, 'resume');
    sameJSON(after.sets.map(s => s.name), ['Développé couché', 'Squat barre', 'Rowing barre']);
    sameJSON(after.sets[0], { name: 'Développé couché', weight: 80, reps: 5 });
    // Carte de reprise fermée, puis plus de conseil la semaine de la décharge (semaine légère enregistrée)
    assert.equal(advice({ history: flat, deload: { ...dl, seen: true } }, NOW + 8 * DAY), null);
    assert.equal(advice({ history: flat, deload: dl }, NOW + 20 * DAY), null, 'après la semaine de reprise');
    // Décharge arrêtée le jour même : pas de nouveau conseil tout de suite, ni pendant 4 semaines
    assert.equal(advice({ history: flat, deload: { start: NOW - 1000, end: NOW - 999, seen: true } }), null, 'arrêtée en route');
    const later = block({ weeks: 6 }).map(h => ({ ...h, date: h.date + 35 * DAY }));
    assert.equal(advice({ history: later, deload: { start: NOW - 1000, end: NOW - 999, seen: true } }, NOW + 35 * DAY).kind, 'deload',
      'cinq semaines chargées plus tard, la décharge peut revenir');
  });

  test('périodisation : réglages nettoyés au chargement et gardés sur l\'appareil', () => {
    reset();
    const clean = d => run(`(() => { const d = Object.assign(makeDefaultData(), ${js(d)}); sanitizeData(d);
      return { off: d.trainingTipsOff, dl: d.deload, sn: d.deloadSnooze }; })()`);
    sameJSON(clean({ trainingTipsOff: true, deload: { start: 10, end: 20, seen: true }, deloadSnooze: 5 }),
      { off: true, dl: { start: 10, end: 20, seen: true }, sn: 5 });
    sameJSON(clean({ trainingTipsOff: 'oui', deload: { start: 20, end: 10 }, deloadSnooze: -1 }), {});
    sameJSON(clean({ deload: { start: 1, end: 1 + 30 * DAY } }), {}, 'décharge de plus de 14 jours');
    sameJSON(clean({ deload: { start: 10, end: 20, seen: 'x', extra: '<b>' } }), { dl: { start: 10, end: 20 } }, 'champs inconnus retirés');
    for (const k of ['trainingTipsOff', 'deload', 'deloadSnooze']) assert.ok(run(`SYNC_LOCAL_ONLY.includes(${js(k)})`), k);
    sameJSON(run(`profilePayload({ unit: 'kg', trainingTipsOff: true, deload: { start: 1, end: 2 }, deloadSnooze: 3 })`), { unit: 'kg' }, 'rien ne part au serveur');
  });
}
