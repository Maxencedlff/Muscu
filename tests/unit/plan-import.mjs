// Import d'un programme (docs/IMPORT_PROGRAMME.md) : grammaire des prescriptions, reconnaissance des noms, tableaux et
// texte placé, supersets, programme créé, dictionnaire appris, et seuils de justesse sur le corpus tests/fixtures/plans/.
import { loadCorpus, measure } from './plan-corpus-lib.mjs';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const read = line => run(`planReadLine(${JSON.stringify(line)})`);
  const presc = line => JSON.parse(JSON.stringify(read(line).presc));
  const match = raw => run(`planMatchExercise(${JSON.stringify(raw)})`);
  const parse = text => run(`planParse(${JSON.stringify(text)})`);

  test('import de programme : séries et reps sous toutes leurs formes', () => {
    const cases = [
      ['Squat 4x8', { sets: 4, repMin: 8, repMax: 8 }],
      ['Squat 4×8-12', { sets: 4, repMin: 8, repMax: 12 }],
      ['Squat 4*8', { sets: 4, repMin: 8, repMax: 8 }],
      ['Squat : 4 séries de 8 à 12 reps', { sets: 4, repMin: 8, repMax: 12 }],
      ['quatre fois huit squat', { sets: 4, repMin: 8, repMax: 8 }],
      ['Tractions 3 × max', { sets: 3, amrap: true }],
      ['Tractions 3 séries au max', { sets: 3, amrap: true }],
      ['Gainage 3 x 45 s', { sets: 3, seconds: 45 }],
      ['10 reps x 4 séries de hip thrust', { repMin: 10, repMax: 10, sets: 4 }],
      ['Leg curl 4 x 12/10/8/6', { sets: 4, repMin: 6, repMax: 12, pyramid: '12/10/8/6' }],
      ['Mollets : 4 séries, 15-20 reps', { sets: 4, repMin: 15, repMax: 20 }],
    ];
    for (const [line, want] of cases) sameJSON(presc(line), want, line);
  });

  test('import de programme : repos, charge, RPE, RIR, tempo, par bras', () => {
    sameJSON(presc('DC 4x8-10 2min'), { sets: 4, repMin: 8, repMax: 10, rest: 120 });
    assert.equal(presc("DC 4x8, repos 1'30").rest, 90);
    assert.equal(presc('DC 4x8 récup 1 min 30').rest, 90);
    assert.equal(presc('Fais trois séries de douze au leg extension avec une minute trente de récup').rest, 90);
    assert.equal(presc('A1. Curl 3x12 pas de repos').rest, 0, 'superset : sans repos');
    assert.equal(presc('Squat 5x5 à 100 kg').load, 100);
    assert.equal(presc('Squat 5x5 à 62,5 kg').load, 62.5);
    assert.equal(presc('Squat 5x5 70%').pct, 70);
    assert.equal(presc('DC 4x8 @RPE 8,5').rpe, 8.5);
    const r = presc('Rowing barre 4 x 8 RIR 2 1 min 30');
    assert.equal(r.rir, 2); assert.equal(r.repMax, 8, 'le 8 reste la rep'); assert.equal(r.rest, 90);
    assert.equal(presc('Leg curl 4x12 tempo 3-1-1').tempo, '3-1-1');
    assert.equal(presc('Curl haltères 3x12 par bras').uni, true);
    assert.equal(presc('Mollets debout 4x10 (pause 2 s en bas)').rest, undefined, 'une pause dans la rep n\'est pas le repos');
  });

  test('import de programme : techniques et supersets', () => {
    sameJSON(presc('Élév lat 4x15 (dernière série en drop set)'), { tech: 'drop', techWhere: 'last', sets: 4, repMin: 15, repMax: 15 });
    assert.equal(presc('Presse 3x15 dégressif').tech, 'drop');
    assert.equal(presc('Curl 3x10 rest-pause 15 s').tech, 'rp');
    assert.equal(presc('Curl 3x10 rest-pause 15 s').rest, undefined, 'la pause du rest-pause n\'est pas le repos');
    assert.equal(presc('Rowing 4x8 en cluster').tech, 'cluster');
    assert.equal(presc('Squat 1x5 top set puis 3x8 back-off').tech, 'topback');
    assert.equal(read('A1) Curl haltères 3x12').marks.ss, 'A1');
    const d = parse('Bras\nA1) Curl haltères 3x12\nA2) Curl marteau 3x12\nB1. Dips 3x10\nCurl 3x10 + extension triceps 3x10');
    const it = d.sessions[0].items;
    assert.equal(it.length, 5);
    assert.ok(it[0].ss && it[0].ss === it[1].ss, 'A1 et A2 ensemble');
    assert.ok(!it[2].ss, 'B1 seul : pas de groupe');
    assert.ok(it[3].ss && it[3].ss === it[4].ss && it[3].ss !== it[0].ss, '« + » : un autre groupe');
  });

  test('import de programme : noms reconnus malgré abréviations, fautes, anglais, photo et dictée', () => {
    const cases = [['DC', 'Développé couché barre'], ['DI haltères', 'Développé incliné haltères'], ['OHP', 'Développé militaire barre'],
      ['RDL', 'Soulevé de terre roumain'], ['SDT', 'Soulevé de terre'], ['HT', 'Hip thrust'], ['Élév lat', 'Élévations latérales'],
      ['Squat', 'Squat barre'], ['Tractions', 'Tractions pronation'], ['dévelopé couchée', 'Développé couché barre'],
      ['tractions pronnation', 'Tractions pronation'], ['Lateral Raises', 'Élévations latérales'], ['Deve1oppé c0uché', 'Développé couché barre'],
      ['lègue curl', 'Leg curl machine'], ['face poule', 'Face pull'], ['Dips lestés', 'Dips'], ['Tirage poitrine', 'Tirage vertical prise large']];
    for (const [raw, name] of cases) assert.equal(match(raw).name, name, raw);
    assert.equal(match('Box jump').name, null, 'hors bibliothèque : pas de rapprochement forcé');
    assert.equal(match('Seal row').name, null, 'un seul mot commun ne suffit pas');
  });

  test('import de programme : séances, jours de repos, échauffement et notes', () => {
    const d = parse('Programme PPL\n\nLundi : Push\nDC 4x8\nDips 3x10\n\nMardi : repos\n\nMercredi - Pull\nÉchauffement : 5 min de rameur\nTractions 4 × max\nBien contrôler la descente\n\nJeudi : squat 5x5, presse 4x10');
    assert.equal(d.title, 'Programme PPL');
    sameJSON(d.sessions.map(s => s.label), ['Lundi : Push', 'Mercredi - Pull', 'Jeudi']);
    sameJSON(d.sessions.map(s => s.items.map(i => i.name)), [['Développé couché barre', 'Dips'], ['Tractions pronation'], ['Squat barre', 'Presse à cuisses']]);
    assert.ok(d.lines.some(l => l.role === 'rest-day'));
    assert.ok(d.notes.some(n => /descente/.test(n)));
  });

  test('import de programme : dictée sans retour à la ligne, et mode guidé', () => {
    const d = parse('séance push développer couché quatre séries de 10 repos 2 minutes ensuite élévation latérale 4 fois 15 séance suivante jambes squatte 4 fois 8 puis lègue curl 3 fois 12');
    sameJSON(d.sessions.map(s => s.items.map(i => [i.name, i.presc.sets, i.presc.repMax])),
      [[['Développé couché barre', 4, 10], ['Élévations latérales', 4, 15]], [['Squat barre', 4, 8], ['Leg curl machine', 3, 12]]]);
    const g = parse('développé couché\n4 séries de 8\nrowing barre\n4 fois 10 repos 90 secondes');
    sameJSON(g.sessions[0].items.map(i => [i.name, i.presc.sets, i.presc.repMax, i.presc.rest]), [['Développé couché barre', 4, 8, undefined], ['Rowing barre', 4, 10, 90]]);
  });

  test('import de programme : tableaux (tabulations, « | », espaces alignés, noms sur deux lignes)', () => {
    const tab = parse('Exercice\tSéries\tReps\tRepos\nSquat barre\t4\t8\t3 min\nPresse à cuisses\t3\t10-12\t\nGainage (planche)\t3\t30 s\t30');
    sameJSON(tab.sessions[0].items.map(i => JSON.parse(JSON.stringify([i.name, i.presc]))), [
      ['Squat barre', { sets: 4, repMin: 8, repMax: 8, rest: 180 }], ['Presse à cuisses', { sets: 3, repMin: 10, repMax: 12 }],
      ['Gainage (planche)', { sets: 3, seconds: 30, rest: 30 }]]);
    const pipes = parse('| Exercice | Séries | Reps | Repos |\n|---|---|---|---|\n| DC | 4 | 6 | 2 min 30 |');
    assert.equal(pipes.sessions[0].items[0].presc.rest, 150);
    const cut = parse('Exercice          Séries   Reps   Récup\nDéveloppé incliné\nhaltères          3        10     1\'30');
    assert.equal(cut.sessions[0].items[0].name, 'Développé incliné haltères');
  });

  test('import de programme : texte placé d\'une photo ou d\'un PDF remis en colonnes, case vide gardée', () => {
    const boxes = [
      { text: 'Exercice', x: 10, y: 10, w: 60, h: 12 }, { text: 'Séries', x: 200, y: 11, w: 40, h: 12 }, { text: 'Reps', x: 280, y: 10, w: 30, h: 12 }, { text: 'Repos', x: 360, y: 9, w: 40, h: 12 },
      { text: 'Squat barre', x: 10, y: 32, w: 80, h: 12 }, { text: '5', x: 202, y: 33, w: 8, h: 12 }, { text: '5', x: 282, y: 31, w: 8, h: 12 }, { text: '3 min', x: 361, y: 32, w: 30, h: 12 },
      { text: 'Presse', x: 10, y: 54, w: 50, h: 12 }, { text: '4', x: 201, y: 55, w: 8, h: 12 }, { text: '3 min', x: 360, y: 54, w: 30, h: 12 },
    ];
    const text = run(`planTextFromBoxes(${JSON.stringify(boxes.reverse())})`);
    assert.equal(text.split('\n')[2], 'Presse\t4\t\t3 min', 'la case Reps vide reste à sa place');
    const d = parse(text);
    sameJSON(d.sessions[0].items.map(i => [i.name, i.presc.sets, i.presc.repMax, i.presc.rest]), [['Squat barre', 5, 5, 180], ['Presse à cuisses', 4, undefined, 180]]);
    assert.equal(d.sessions[0].items[1].level, 'check', 'reps non lues : à vérifier');
  });

  test('import de programme : pages d\'Apple Vision (boîtes de 0 à 1, mots placés) remises en tableau', () => {
    const w = (text, x, y) => ({ text, box: { x, y, w: text.length * 0.012, h: 0.02 } });
    // Une ligne de Vision qui traverse les colonnes : ses mots gardent leur place
    const pages = [{ width: 1000, height: 1400, lines: [
      { text: 'Séance A', box: { x: 0.05, y: 0.05, w: 0.1, h: 0.02 }, words: [] },
      { text: 'Exercice Séries Reps Repos', box: { x: 0.05, y: 0.1, w: 0.7, h: 0.02 }, words: [w('Exercice', 0.05, 0.1), w('Séries', 0.4, 0.1), w('Reps', 0.55, 0.1), w('Repos', 0.7, 0.1)] },
      { text: 'Squat barre 5 5 3 min', box: { x: 0.05, y: 0.14, w: 0.7, h: 0.02 }, words: [w('Squat', 0.05, 0.14), w('barre', 0.12, 0.14), w('5', 0.4, 0.14), w('5', 0.55, 0.14), w('3', 0.7, 0.14), w('min', 0.715, 0.14)] },
    ] }];
    const d = parse(run(`planTextFromPages(${JSON.stringify(pages)})`));
    sameJSON(d.sessions.map(s => [s.label, s.items.map(i => [i.name, i.presc.sets, i.presc.repMax, i.presc.rest])]), [['Séance A', [['Squat barre', 5, 5, 180]]]]);
    assert.ok(run('planDictationWords("exercice").length') <= 300 && run('planDictationWords("exercice").includes("Développé couché barre")'));
  });

  test('import de programme : confiance par ligne et programme créé (valide après nettoyage)', () => {
    reset();
    const d = parse('Push\nDC 4x8-10 2min\nÉlév lat 4x15 (dernière série en drop set)\nTruc bizarre 3x10\nA1. Curl 3x12 tempo 3-1-1\nA2. Barre au front 3x12 70%');
    sameJSON(d.sessions[0].items.map(i => i.level), ['sure', 'sure', 'unknown', 'sure', 'sure']);
    const { up, pd } = JSON.parse(JSON.stringify(run(`planDraftProgramme(${JSON.stringify(d)}, 'Mon import')`)));
    assert.equal(up.name, 'Mon import');
    const ex = pd.exercises[up.order[0]];
    assert.equal(ex[0].sets, 4); assert.equal(ex[0].repMin, 8); assert.equal(ex[0].repMax, 10); assert.equal(ex[0].rest, 120);
    assert.equal(ex[1].intens, 'drop-last');
    assert.equal(ex[2].name, 'Truc bizarre', 'pas compris : gardé sous son nom');
    assert.ok(ex[3].ss && ex[3].ss === ex[4].ss); assert.equal(ex[3].tempo, '3-1-1-0'); assert.equal(ex[4].consigne, '70 % du max');
    run(`data.userProgrammes.u_imp = ${JSON.stringify(up)}; data.programmes.u_imp = ${JSON.stringify(pd)}; data = sanitizeData(data);`);
    const after = JSON.parse(JSON.stringify(run('data.programmes.u_imp.exercises')));
    sameJSON(after, pd.exercises, 'sanitizeData ne retire rien');
  });

  test('import de programme : dictionnaire appris, reconnu au prochain import, nettoyé et synchronisé', () => {
    reset();
    assert.equal(run('planLearnAlias("DC inc", "Développé incliné barre")'), true);
    assert.equal(run('planLearnAlias("DC", "Développé couché barre")'), false, 'déjà connu de la bibliothèque : rien à retenir');
    const d = run('planParse("Push\\nDC inc 4x8", { learned: planLearnedAliases() })');
    assert.equal(d.sessions[0].items[0].name, 'Développé incliné barre');
    assert.equal(d.sessions[0].items[0].how, 'learned');
    assert.ok(run('SYNC_PROFILE_KEYS.includes("planAliases") && SYNC_UNION_KEYS.includes("planAliases")'));
    run('data.planAliases = { ok: "Squat barre", "": "x", long: "' + 'a'.repeat(90) + '", n: 3 }; data = sanitizeData(data);');
    sameJSON(run('data.planAliases'), { ok: 'Squat barre' });
    run('planLearnAlias("Mon exo à moi Thomas 0612345678", "Truc")');
    assert.ok(!run('planAliasesSharePayload()').some(x => x.n === 'Truc' || /\d{3}/.test(x.k)), 'mise en commun : jamais un nom inventé ni un numéro');
  });

  // Seuils de la demande : 90 % des lignes justes sur les plans propres (et les tableaux), plus de 75 % sur le libre,
  // la dictée et la photo bruitée (docs/IMPORT_PROGRAMME.md, « Mesure »)
  test('import de programme : justesse sur le corpus (au moins 60 plans)', () => {
    const corpus = loadCorpus(ROOT);
    assert.ok(corpus.length >= 54, `${corpus.length} plans`);
    const r = measure(corpus, input => run(`planParse(${JSON.stringify(input.boxes ? run(`planTextFromBoxes(${JSON.stringify(input.boxes)})`) : input.text)})`));
    assert.ok(r.details.length >= 60, `${r.details.length} cas mesurés`);
    const min = { propre: 0.9, tableau: 0.9, libre: 0.75, dictee: 0.75, photo: 0.75, 'photo-tableau': 0.75 };
    for (const [k, v] of Object.entries(min)) assert.ok(r.by[k] && r.by[k].lineRate >= v, `${k} : ${(r.by[k]?.lineRate * 100).toFixed(1)} % (seuil ${v * 100} %)`);
  });
}
