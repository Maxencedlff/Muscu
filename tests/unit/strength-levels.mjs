// ═══════════════════════════════════════════════════════════
//  Niveau de force (js/data/strength-levels.js, seuils js/data/strength-standards.js) : exercices reconnus,
//  paliers par sexe et catégorie de poids, 1RM estimé des 90 jours, bilan, sexe facultatif nettoyé et local
// ═══════════════════════════════════════════════════════════
export default function ({ test, run, reset, assert, sameJSON }) {
  const DAY = 86_400_000;
  const NOW = new Date(2026, 10, 2, 10).getTime();
  const at = daysBefore => NOW - daysBefore * DAY;
  const js = v => JSON.stringify(v);
  const set = (weight, reps, extra = {}) => ({ weight: String(weight), reps: String(reps), ...extra });
  const entry = (id, date, exercises) => ({ id, programme: 'ppl', category: 'push', date, notes: '', exercises });
  const ex = (name, sets, exId) => ({ exId: exId || 'n:' + name.toLowerCase(), name, sets });
  const liftExpr = id => `STRENGTH_LIFTS.find(l => l.id === ${js(id)})`;

  test('niveau : squat, développé couché et soulevé de terre reconnus avec leurs alias, pas les variantes', () => {
    reset();
    const lift = n => run(`strengthLiftOf(${js(n)})?.id ?? null`);
    assert.equal(lift('Développé couché'), 'bench');
    assert.equal(lift('bench press'), 'bench');
    assert.equal(lift('Squat barre'), 'squat');
    assert.equal(lift('back squat'), 'squat');
    assert.equal(lift('SDT'), 'deadlift');
    for (const n of ['Développé militaire barre', 'Rowing barre', 'Développé couché haltères', 'Développé couché machine',
      'Développé couché prise serrée', 'Soulevé de terre sumo', 'Soulevé de terre roumain', 'Squat gobelet', 'Mon exercice'])
      assert.equal(lift(n), null, n);
  });

  test('niveau : table OpenPowerlifting complète, catégories croissantes, quatre seuils croissants et plausibles', () => {
    reset();
    const t = run('STRENGTH_STANDARDS');
    assert.deepEqual(Object.keys(t).sort(), ['bench', 'deadlift', 'squat']);
    assert.ok(run('STRENGTH_LIFTS.every(l => catalogueEntry(l.name)?.name === l.name)'), 'exercices de la bibliothèque');
    for (const [lift, bySex] of Object.entries(t)) {
      assert.deepEqual(Object.keys(bySex).sort(), ['female', 'male'], lift);
      for (const [sex, classes] of Object.entries(bySex)) {
        const tag = `${lift} ${sex}`;
        assert.equal(classes.length, 8, tag);
        assert.equal(classes.at(-1).max, null, `${tag} : dernière catégorie ouverte`);
        for (let i = 1; i < classes.length - 1; i++) assert.ok(classes[i].max > classes[i - 1].max, `${tag} : catégories croissantes`);
        for (const c of classes) {
          assert.equal(c.thr.length, 4, tag);
          for (let i = 1; i < 4; i++) assert.ok(c.thr[i] > c.thr[i - 1], `${tag} ${c.max} : seuils croissants`);
          assert.ok(c.thr[0] >= 0.3 && c.thr[3] <= 4, `${tag} ${c.max} : rapports plausibles ${c.thr}`);
        }
      }
    }
  });

  test('niveau : paliers selon le sexe et la catégorie de poids, palier suivant en kg', () => {
    reset();
    const st = (id, e1rm, kg, sex) => run(`strengthStanding(${liftExpr(id)}, ${e1rm}, ${kg}, ${js(sex)})`);
    // Homme de 80 kg (catégorie 74-83) au développé couché : intermédiaire à 1,20 × 80 = 96 kg, avancé à 1,50 × 80 = 120 kg
    let s = st('bench', 96, 80, 'male');
    assert.equal(s.label, 'Intermédiaire');
    assert.equal(s.ratio, 1.2);
    sameJSON(s.next, { label: 'Avancé', kg: 120 });
    assert.equal(s.progress, 0);
    s = st('bench', 108, 80, 'male');
    assert.equal(Math.round(s.progress * 100), 50, 'à mi-chemin de 96 à 120 kg');
    assert.equal(st('bench', 95.9, 80, 'male').label, 'Novice');
    // Même charge, femme de 60 kg (57-63) : 100 / 60 = 1,67 ≥ 1,20 → élite, sans palier suivant
    s = st('bench', 100, 60, 'female');
    assert.equal(s.label, 'Élite');
    assert.equal(s.next, null);
    assert.equal(s.progress, 1);
    // Sous le seuil Novice (1,30 × 80 = 104 kg au squat) : Débutant, progression depuis zéro
    s = st('squat', 52, 80, 'male');
    assert.equal(s.label, 'Débutant');
    sameJSON(s.next, { label: 'Novice', kg: 104 });
    assert.equal(Math.round(s.progress * 100), 50);
    assert.equal(st('deadlift', 244, 80, 'male').label, 'Élite', '3,05 × 80 = 244 kg');
    // Catégorie suivante au-delà de 83 kg : seuils plus bas en rapport au poids du corps
    sameJSON(run(`strengthThresholds(${liftExpr('bench')}, 83, 'male')`), [0.9, 1.2, 1.5, 1.85]);
    sameJSON(run(`strengthThresholds(${liftExpr('bench')}, 83.1, 'male')`), [0.85, 1.15, 1.45, 1.75]);
    sameJSON(run(`strengthThresholds(${liftExpr('squat')}, 150, 'male')`), run(`STRENGTH_STANDARDS.squat.male.at(-1).thr`), 'au-delà de 120 kg');
    // Sexe non précisé, poids du corps inconnu ou absurde : pas de palier
    assert.equal(st('bench', 100, 80, null), null);
    assert.equal(st('bench', 100, 80, 'none'), null);
    assert.equal(st('bench', 100, 0, 'male'), null);
    assert.equal(st('bench', 100, 400, 'male'), null);
    assert.equal(st('bench', 0, 80, 'male'), null);
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
    const best = run(`liftBestE1rm(${js(hist)}, ${liftExpr('bench')}, { now: ${NOW} })`);
    // 90 × (1 + 5/30) = 105 ; 80 × (1 + 10/30) = 106,7
    sameJSON(best, { e1rm: 106.7, date: at(10) });
    const before = run(`liftBestE1rm(${js(hist)}, ${liftExpr('bench')}, { now: ${NOW}, before: ${at(10)} })`);
    sameJSON(before, { e1rm: 105, date: at(30) }, 'avant la séance c');
  });

  test('niveau : bilan, palier franchi par la séance (et pas à la première séance), rien sans sexe', () => {
    reset();
    const old = entry('o', at(20), [ex('Squat barre', [set(90, 5)])]);       // 105 kg : 1,31 × 80 → novice (1,30)
    const now = entry('n', at(0), [ex('Squat barre', [set(125, 5)]), ex('Curl biceps', [set(15, 10)])]);   // 145,8 kg : 1,82 → intermédiaire (1,80)
    const r = run(`sessionStrengthLevels(${js(now)}, ${js([now, old])}, 80, 'male')`);
    assert.equal(r.length, 1, 'le curl n\'a pas de repère');
    assert.equal(r[0].standing.label, 'Intermédiaire');
    assert.equal(r[0].up, true);
    const first = run(`sessionStrengthLevels(${js(old)}, ${js([old])}, 80, 'male')`);
    assert.equal(first[0].up, false, 'aucun niveau d\'avant : pas de « nouveau palier »');
    assert.equal(run(`sessionStrengthLevels(${js(now)}, ${js([now, old])}, null, 'male').length`), 0, 'sans poids du corps');
    assert.equal(run(`sessionStrengthLevels(${js(now)}, ${js([now, old])}, 80, null).length`), 0, 'sans sexe');
  });

  test('niveau : sexe donné par la personne, jamais déduit de la silhouette', () => {
    reset();
    assert.equal(run(`strengthSex({ strengthSex: 'female' })`), 'female');
    assert.equal(run(`strengthSex({ strengthSex: 'male', silhouette: 'female' })`), 'male');
    assert.equal(run(`strengthSex({ strengthSex: 'none' })`), null);
    assert.equal(run(`strengthSex({ silhouette: 'female' })`), null);
    assert.equal(run(`strengthSex({})`), null);
  });

  test('niveau : sexe nettoyé au chargement et gardé sur l\'appareil', () => {
    reset();
    const clean = v => run(`(() => { const d = Object.assign(makeDefaultData(), { strengthSex: ${js(v)} }); sanitizeData(d); return d.strengthSex ?? null; })()`);
    for (const v of ['male', 'female', 'none']) assert.equal(clean(v), v);
    for (const v of ['homme', true, 1, { x: 1 }]) assert.equal(clean(v), null, js(v));
    assert.ok(run(`SYNC_LOCAL_ONLY.includes('strengthSex')`));
    sameJSON(run(`profilePayload({ unit: 'kg', strengthSex: 'female' })`), { unit: 'kg' }, 'rien ne part au serveur');
  });
}
