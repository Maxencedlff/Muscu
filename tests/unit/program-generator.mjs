// Générateur de programme sur mesure (js/data/program-generator.js) : profils types chiffrés, matériel et limites
// toujours respectés, durée jamais dépassée, déterminisme, programme MDLF valide après nettoyage.
export default function ({ test, run, reset, assert, sameJSON }) {
  const gen = a => run(`generateProgramme(${JSON.stringify(a)})`);
  const moves = () => new Map(run('GEN_MOVES').map(m => [m.name, m]));
  const all = r => r.sessions.flatMap(s => s.exercises);
  const big = ['chest', 'lats', 'quads', 'hamstrings', 'glutes'];
  // Séances où un muscle est travaillé en principal
  const sessionsHitting = (r, k) => r.sessions.filter(s => s.exercises.some(ex => run(`catalogueEntry(${JSON.stringify(ex.name)})`).primary.includes(k))).length;
  const fits = (r, min) => r.sessions.every(s => s.minutes <= min && s.seconds <= min * 60);

  test('générateur : chaque mouvement est dans la bibliothèque, mesuré en répétitions', () => {
    for (const m of run('GEN_MOVES')) {
      assert.ok(run(`catalogueEntry(${JSON.stringify(m.name)})?.name === ${JSON.stringify(m.name)}`), `${m.name} : nom exact du catalogue`);
      assert.equal(run(`measureOf({ name: ${JSON.stringify(m.name)} })`), 'reps', `${m.name} : répétitions`);
      m.needs.forEach(n => assert.ok([...run('GEN_EQUIP_IDS'), 'parallele'].includes(n), `${m.name} : matériel connu ${n}`));
    }
  });

  test('générateur : débutante, 22 ans, 3 jours × 45 min en salle', () => {
    const r = gen({ age: 22, sex: 'female', heightCm: 165, kg: 58, goal: 'muscle', level: 'debutant', days: 3, minutes: 45, gym: true });
    assert.equal(r.split, 'full');
    assert.deepEqual([...r.sessions.map(s => s.key)], ['fb_a', 'fb_b', 'fb_c']);
    assert.ok(fits(r, 45), `≤ 45 min : ${r.sessions.map(s => s.minutes)}`);
    assert.equal(r.targets.chest, 8, 'débutant : 8 séries visées');
    for (const k of big) assert.ok(r.weekly[k] >= 6 && r.weekly[k] <= 14, `${k} : ${r.weekly[k]} séries`);
    for (const k of ['chest', 'lats', 'quads']) assert.ok(sessionsHitting(r, k) >= 2, `${k} : deux fois par semaine au moins`);
    const ex = all(r), m = moves();
    assert.ok(ex.filter(e => m.get(e.name).guided).length / ex.length >= 0.5, 'débutante : machines et poulies d\'abord');
    assert.ok(!ex.some(e => e.name === 'Tractions pronation' || e.name === 'Dips'), 'pas de tractions ni de dips au poids du corps');
    assert.ok(ex.every(e => e.sets <= 3 && e.repMin >= 8), 'au plus 3 séries, 8 reps au moins');
  });

  test('générateur : reprise, 60 ans, 2 jours × 30 min, machines seulement', () => {
    const r = gen({ age: 60, sex: 'male', goal: 'forme', level: 'reprise', days: 2, minutes: 30, gym: false, equip: ['machines'] });
    assert.equal(r.sessions.length, 2);
    assert.ok(fits(r, 30), `≤ 30 min : ${r.sessions.map(s => s.minutes)}`);
    const m = moves();
    assert.ok(all(r).every(e => m.get(e.name).needs.every(n => n === 'machines')), 'machines ou poids du corps seulement');
    assert.ok(all(r).every(e => e.repMin >= 10), 'fourchettes hautes (10 reps et plus)');
    assert.ok(!all(r).some(e => m.get(e.name).pattern === 'lunge'), 'aucune fente (équilibre)');
    for (const k of ['chest', 'lats', 'quads']) assert.ok(r.weekly[k] >= 2 && r.weekly[k] <= 6, `${k} : ${r.weekly[k]} séries, volume prudent`);
    assert.ok(r.targets.chest <= 5, `cible réduite : ${r.targets.chest}`);
  });

  test('générateur : intermédiaire, 4 jours × 75 min, prise de muscle', () => {
    const r = gen({ age: 28, sex: 'male', heightCm: 178, kg: 74.5, goal: 'muscle', level: 'intermediaire', days: 4, minutes: 75, gym: true });
    assert.equal(r.split, 'upper_lower');
    assert.deepEqual([...r.sessions.map(s => s.label)], ['Haut du corps A', 'Bas du corps A', 'Haut du corps B', 'Bas du corps B']);
    assert.ok(fits(r, 75));
    assert.equal(r.targets.chest, 12);
    for (const k of big) assert.ok(r.weekly[k] >= 10 && r.weekly[k] <= 20, `${k} : ${r.weekly[k]} séries (10 à 20)`);
    for (const k of big) assert.ok(sessionsHitting(r, k) >= 2, `${k} : deux fois par semaine`);
    const m = moves();
    assert.ok(all(r).filter(e => e.compound && !m.get(e.name).bw).every(e => e.repMin === 6 && e.repMax === 10 && e.rest === 150), 'polyarticulaires : 6 à 10 reps, 2 min 30');
    assert.ok(r.why.length >= 2 && r.why.length <= 3 && r.why[0].startsWith('4 séances parce que tu as 4 jours'), r.why[0]);
  });

  test('générateur : maison, haltères fixes de 4 à 10 kg, 3 jours', () => {
    const r = gen({ goal: 'muscle', level: 'intermediaire', days: 3, minutes: 45, gym: false, equip: ['halteres_fixes'], dbLoads: [4, 8, 10] });
    const m = moves();
    assert.ok(all(r).every(e => m.get(e.name).needs.every(n => n === 'halteres')), `haltères ou poids du corps : ${all(r).map(e => e.name)}`);
    assert.ok(!all(r).some(e => m.get(e.name).needs.includes('banc')), 'pas de banc');
    assert.ok(all(r).filter(e => m.get(e.name).needs.includes('halteres')).every(e => e.repMax === 20 && e.repMin >= 12), 'petits haltères : 12 à 20 reps');
    assert.ok(fits(r, 45));
    assert.ok(r.notes.some(n => n.includes('10 kg')), 'remarque sur la charge');
    for (const k of ['chest', 'lats', 'quads', 'glutes']) assert.ok(r.weekly[k] >= 6, `${k} : ${r.weekly[k]}`);
  });

  test('générateur : avancé, 6 jours, pousser / tirer / jambes deux fois', () => {
    const r = gen({ age: 30, goal: 'muscle', level: 'avance', days: 6, minutes: 90, gym: true });
    assert.equal(r.split, 'ppl');
    assert.deepEqual([...r.sessions.map(s => s.key)], ['push_a', 'pull_a', 'legs_a', 'push_b', 'pull_b', 'legs_b']);
    assert.ok(fits(r, 90));
    assert.equal(r.targets.chest, 16);
    for (const k of big) assert.ok(r.weekly[k] >= 14 && r.weekly[k] <= 26, `${k} : ${r.weekly[k]}`);
    assert.ok(all(r).every(e => e.sets <= 5));
    // Variété : Pousser A et Pousser B ne commencent pas par le même exercice
    assert.notEqual(r.sessions[0].exercises[0].name, r.sessions[3].exercises[0].name);
  });

  test('générateur : douleur d\'épaule, aucun développé au-dessus de la tête ni dips', () => {
    const r = gen({ goal: 'muscle', level: 'intermediaire', days: 4, minutes: 60, gym: true, limits: ['epaule'] });
    const m = moves();
    for (const e of all(r)) {
      assert.ok(!m.get(e.name).avoid.includes('epaule'), `${e.name} exclu`);
      assert.notEqual(m.get(e.name).pattern, 'v_push', `${e.name} : pas de développé vertical`);
    }
    assert.ok(all(r).some(e => m.get(e.name).pattern === 'lateral'), 'élévations latérales gardées à la place');
    assert.ok(r.why.at(-1).includes('Épaule'), r.why.at(-1));
    assert.ok(r.notes.some(n => n.includes('pas un avis médical')));
  });

  test('générateur : zone prioritaire, plus de séries et un exercice ajouté', () => {
    const base = gen({ goal: 'muscle', level: 'intermediaire', days: 4, minutes: 75, gym: true });
    const prio = gen({ goal: 'muscle', level: 'intermediaire', days: 4, minutes: 75, gym: true, zones: ['bras'] });
    assert.equal(prio.targets.biceps, 16);
    assert.ok(prio.weekly.biceps > base.weekly.biceps && prio.weekly.triceps > base.weekly.triceps, `${base.weekly.biceps} → ${prio.weekly.biceps}`);
    assert.ok(prio.why[1].includes('pour les biceps') && prio.why[1].includes('tes priorités'), prio.why[1]);
    assert.ok(fits(prio, 75));
  });

  test('générateur : matériel, limites et durée respectés sur toutes les combinaisons', () => {
    const m = moves();
    const equips = [{ gym: true }, { gym: false, equip: [] }, { gym: false, equip: ['halteres', 'banc'] }, { gym: false, equip: ['elastiques', 'traction'] },
      { gym: false, equip: ['kettlebell'] }, { gym: false, equip: ['barre', 'banc'] }];
    const limitsList = [[], ['genou'], ['dos'], ['epaule', 'genou', 'dos']];
    let n = 0;
    for (const days of run('GEN_DAYS')) for (const minutes of run('GEN_MINUTES')) for (const level of Object.keys(run('GEN_LEVELS')))
      for (const goal of Object.keys(run('GEN_GOALS'))) {
        const eq = equips[n % equips.length], limits = limitsList[n % limitsList.length];
        n++;
        const r = gen({ days, minutes, level, goal, ...eq, limits, age: 20 + (n % 60) });
        const have = new Set(eq.gym ? [...run('GEN_EQUIP_IDS'), 'parallele'] : eq.equip);
        const tag = `${days} j, ${minutes} min, ${level}, ${goal}, ${JSON.stringify(eq)}, ${limits}`;
        assert.equal(r.sessions.length, days, tag);
        assert.ok(fits(r, minutes), `${tag} : ${r.sessions.map(s => s.minutes)}`);
        for (const s of r.sessions) {
          assert.ok(s.exercises.length >= 1, `${tag} : séance vide`);
          assert.equal(new Set(s.exercises.map(e => e.name)).size, s.exercises.length, `${tag} : doublon dans ${s.label}`);
          const groups = s.exercises.map(e => run(`genOrderGroup(GEN_MOVES.find(x => x.name === ${JSON.stringify(e.name)}))`));
          assert.ok(groups.every((g, i) => !i || g >= groups[i - 1]), `${tag} : polyarticulaires d'abord dans ${s.label}`);
          for (const e of s.exercises) {
            const mv = m.get(e.name);
            assert.ok(mv.needs.every(x => have.has(x)), `${tag} : ${e.name} demande ${mv.needs}`);
            assert.ok(!mv.avoid.some(l => limits.includes(l)), `${tag} : ${e.name} exclu par ${limits}`);
            assert.ok(e.sets >= 2 && e.sets <= 5 && e.repMin < e.repMax && e.rest >= 60 && e.rest <= 180, `${tag} : ${JSON.stringify(e)}`);
          }
        }
      }
    assert.ok(n >= 400);
  });

  test('générateur : déterministe, réponses inconnues tolérées', () => {
    const a = { age: 35, heightCm: 180, kg: 82, sex: 'male', goal: 'seche', level: 'intermediaire', days: 5, minutes: 60, gym: true, zones: ['fessiers'], limits: ['dos'] };
    sameJSON(gen(a), gen(a), 'mêmes réponses, même programme');
    sameJSON(gen({ ...a, zones: ['fessiers', 'inconnue'] }), gen(a));
    const d = gen({ days: 9, minutes: 7, level: 'x', goal: 'y', equip: 'rien' });
    assert.equal(d.sessions.length, 3, 'valeurs par défaut : 3 jours');
    assert.ok(fits(d, 60));
    const clean = run("genCleanAnswers({ age: '40', kg: '70,5', heightCm: 99, dbLoads: [8, '12', -1, 8] })");
    assert.equal(clean.age, 40); assert.equal(clean.heightCm, null);
    assert.deepEqual([...clean.dbLoads], [8, 12]);
  });

  test('générateur : poids du corps lourd, tractions et pompes assistées d\'abord', () => {
    const heavy = gen({ heightCm: 175, kg: 98, level: 'intermediaire', goal: 'muscle', days: 3, minutes: 60, gym: false, equip: ['traction', 'elastiques'] });
    const light = gen({ heightCm: 175, kg: 68, level: 'intermediaire', goal: 'muscle', days: 3, minutes: 60, gym: false, equip: ['traction', 'elastiques'] });
    const firstPull = r => all(r).find(e => moves().get(e.name).pattern === 'v_pull')?.name;
    assert.equal(firstPull(light), 'Tractions pronation', 'IMC 22 : tractions');
    assert.equal(firstPull(heavy), 'Tractions avec élastique', 'IMC 32 : tractions avec élastique');
    assert.ok(heavy.notes.some(n => n.includes('tout ton poids')));
    // Taille seule, sexe : aucun effet
    sameJSON(gen({ heightCm: 160, days: 4, gym: true }).sessions, gen({ heightCm: 195, days: 4, gym: true }).sessions, 'taille seule sans poids : aucun effet');
    sameJSON(gen({ sex: 'female', days: 4, gym: true }).sessions, gen({ sex: 'male', days: 4, gym: true }).sessions, 'sexe : aucun effet');
  });

  test('générateur : niveau déduit de l\'historique', () => {
    const day = 86400e3, now = Date.UTC(2026, 10, 16);
    const hist = (spanDays, perWeek, lastAgo = 1) => {
      const out = [];
      for (let d = lastAgo; d <= spanDays + lastAgo; d += 7 / perWeek) out.push({ date: now - d * day });
      return out;
    };
    assert.equal(run(`genLevelFromHistory([], ${now})`), null);
    assert.equal(run(`genLevelFromHistory(${JSON.stringify(hist(60, 3))}, ${now})`), 'debutant');
    assert.equal(run(`genLevelFromHistory(${JSON.stringify(hist(400, 3))}, ${now})`), 'intermediaire');
    assert.equal(run(`genLevelFromHistory(${JSON.stringify(hist(1200, 3))}, ${now})`), 'avance');
    assert.equal(run(`genLevelFromHistory(${JSON.stringify(hist(400, 3, 120))}, ${now})`), 'reprise');
    assert.equal(run(`genLevelFromHistory(${JSON.stringify(hist(400, 0.5))}, ${now})`), 'debutant', 'peu régulier');
  });

  test('générateur : programme MDLF normal, gardé tel quel par le nettoyage', () => {
    reset();
    const r = gen({ goal: 'force', level: 'intermediaire', days: 4, minutes: 60, gym: true });
    run(`(() => { const r = generateProgramme(${JSON.stringify(r.answers)}); const { up, pd } = genProgrammeData(r, genProgrammeName());
      data.userProgrammes.u_gen00001 = up; data.programmes.u_gen00001 = pd; data.myProgrammes.push('u_gen00001'); })()`);
    run('sanitizeData(data)');
    const up = run('data.userProgrammes.u_gen00001'), pd = run('data.programmes.u_gen00001');
    assert.equal(up.name, 'Sur mesure');
    assert.deepEqual([...run('sessionKeys("u_gen00001")')], ['haut_a', 'bas_a', 'haut_b', 'bas_b']);
    const first = pd.exercises.haut_a[0];
    assert.equal(first.name, r.sessions[0].exercises[0].name);
    assert.ok(first.repMin === 3 && first.repMax === 6 && first.rest === 180, `force : 3 à 6 reps, 3 min (${JSON.stringify(first)})`);
    assert.equal(pd.exercises.bas_b.length, r.sessions[3].exercises.length);
    assert.equal(run('genProgrammeName()'), 'Sur mesure 2', 'deuxième programme : autre nom');
  });
}
