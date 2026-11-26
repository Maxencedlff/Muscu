// Le même exercice plusieurs fois dans une séance, et le rôle d'un bloc (js/data/blocks.js) : rang stable, « Avant » du
// même bloc, records communs (un seul par séance), pré-fatigue hors records et volume, nettoyage, données d'une version
// d'avant, programme envoyé par le coach (app et site), dernière fois vue par le coach
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const J = o => JSON.stringify(o);
  const S = (w, r, extra = {}) => ({ weight: String(w), reps: String(r), ...extra });
  const W = (w, r) => S(w, r, { warmup: true });
  // Programme perso à une séance « legs » : Extension quadriceps en pré-fatigue (bloc de plus, en tête), Extension
  // quadriceps, Squat barre
  const setup = () => {
    reset();
    run(`data.userProgrammes.u_test = { name: 'Test', sessions: { legs: { label: 'Jambes', icon: '', desc: '', color: '#ff9500' } }, order: ['legs'], archived: false };
      data.programmes.u_test = { exercises: { legs: [] }, timers: { legs: null }, cooldowns: { legs: 72 } };
      data.activeProgramme = 'u_test';
      (() => { const xs = data.programmes.u_test.exercises.legs;
        const a = makeExercise('Extension quadriceps', 3); a.id = 'ext1'; xs.push(a);
        const sq = makeExercise('Squat barre', 3); sq.id = 'sq1'; xs.push(sq);
        const b = linkBlock(xs, makeExercise('Extension quadriceps', 2)); b.id = 'ext2'; b.role = 'prefat'; xs.unshift(b); })();`);
  };
  const entry = (id, date, exercises) => ({ id, programme: 'u_test', category: 'legs', date, notes: '', exercises });

  test('blocs : un bloc de plus garde son id, pointe le suivi du premier, rang 2, nom « · 2 » en lisant de haut en bas', () => {
    setup();
    const xs = run('data.programmes.u_test.exercises.legs');
    assert.equal(xs[0].id, 'ext2');
    assert.equal(xs[0].exId, 'ext1', 'suivi commun');
    assert.equal(xs[0].occ, 2);
    assert.equal(run('exIdOf(data.programmes.u_test.exercises.legs[0])'), 'ext1');
    assert.equal(run('blockName(data.programmes.u_test.exercises.legs[0], data.programmes.u_test.exercises.legs)'), 'Extension quadriceps', '1er en haut');
    assert.equal(run('blockName(data.programmes.u_test.exercises.legs[1], data.programmes.u_test.exercises.legs)'), 'Extension quadriceps · 2');
    assert.equal(run('blockName(data.programmes.u_test.exercises.legs[2], data.programmes.u_test.exercises.legs)'), 'Squat barre');
    assert.equal(run('nextOcc(data.programmes.u_test.exercises.legs, { name: "Extension quadriceps" })'), 3);
    assert.equal(run('nextOcc(data.programmes.u_test.exercises.legs, { name: "Presse à cuisses" })'), 1);
    assert.equal(run('resolveExId("u_test", "legs", "Extension quadriceps")'), 'ext1', 'retrouvé par le nom : le suivi commun');
  });

  test('blocs : « Avant » du même bloc (rang), jamais les séries lourdes pour la pré-fatigue', () => {
    setup();
    run(`data.history = [${J(entry('h1', 1000, [
      { exId: 'ext1', name: 'Extension quadriceps', occ: 2, role: 'prefat', sets: [W(20, 15), W(20, 15)] },
      { exId: 'sq1', name: 'Squat barre', sets: [S(100, 5)] },
      { exId: 'ext1', name: 'Extension quadriceps', sets: [S(60, 10), S(60, 9), S(60, 8)] },
    ]))}];`);
    const pre = run('lastPerf("u_test", "legs", data.programmes.u_test.exercises.legs[0])');
    assert.equal(pre.ex.occ, 2);
    sameJSON(run('blockPrevSets(lastPerf("u_test", "legs", data.programmes.u_test.exercises.legs[0]).ex).map(s => s.weight)'), ['20', '20'], 'pré-fatigue : ses séries');
    const main = run('lastPerf("u_test", "legs", data.programmes.u_test.exercises.legs[1])');
    assert.equal(main.ex.occ, undefined);
    assert.equal(main.ex.sets[0].weight, '60');
    // Bloc jamais fait sous ce rang : rien (le 3e bloc ne reprend ni le 1er ni le 2e)
    assert.equal(run('lastPerf("u_test", "legs", { exId: "ext1", name: "Extension quadriceps", occ: 3 })'), null);
  });

  test('blocs : records communs à tous les blocs, pré-fatigue exclue (record, 1RM, dernière série, volume)', () => {
    setup();
    run(`data.history = [${J(entry('h1', 1000, [
      { exId: 'ext1', name: 'Extension quadriceps', occ: 2, role: 'prefat', sets: [W(90, 15)] },
      { exId: 'ext1', name: 'Extension quadriceps', sets: [S(60, 10)] },
    ]))}]; recomputePRFromHistory();`);
    const xs = run('data.programmes.u_test.exercises.legs');
    sameJSON(xs[1].pr, { weight: '60', reps: '10' }, 'la pré-fatigue à 90 kg ne fait pas le record');
    sameJSON(xs[0].pr, xs[1].pr, 'le bloc de plus montre le même record');
    assert.equal(xs[0].lastWeight, '60');
    assert.equal(run(`exVolume(${J({ name: 'Extension quadriceps', role: 'prefat', sets: [W(90, 15)] })})`), 0, 'hors volume');
    assert.equal(run(`exVolume(${J({ name: 'Extension quadriceps', sets: [S(60, 10)] })})`), 600);
  });

  test('blocs : deux blocs normaux du même exercice dans une séance, un seul record noté', () => {
    setup();
    run(`data.history = [${J(entry('h1', 1000, [{ exId: 'ext1', name: 'Extension quadriceps', sets: [S(50, 10)] }]))}];`);
    const recs = run(`sessionRecords(${J(entry('h2', 2000, [
      { exId: 'ext1', name: 'Extension quadriceps', sets: [S(55, 10)] },
      { exId: 'sq1', name: 'Squat barre', sets: [S(100, 5)] },
      { exId: 'ext1', name: 'Extension quadriceps', occ: 2, sets: [S(60, 8)] },
    ]))}, data.history)`);
    const ext = recs.filter(r => r.ex === 'Extension quadriceps');
    assert.equal(ext.length, 1, J(recs));
    assert.equal(ext[0].kind, 'charge');
    assert.equal(ext[0].after, 60, 'le meilleur des deux blocs');
    // Séance en cours : les séries des deux blocs, dans l'ordre
    sameJSON(run(`exerciseSetsAcross(${J([{ exId: 'ext1', name: 'Extension quadriceps', sets: [S(55, 10)] }, { exId: 'ext1', name: 'Extension quadriceps', occ: 2, sets: [S(60, 8)] }])}, { exId: 'ext1', name: 'Extension quadriceps' }).map(s => s.weight)`), ['55', '60']);
  });

  test('blocs : rôle posé sur les séries, retiré au retour à Normal ; pré-fatigue numérotée, échauffement « É »', () => {
    reset();
    const ex = run(`(() => { const ex = { name: 'Extension quadriceps', sets: [${J(S(20, 15))}, ${J(S(20, 15))}] }; setBlockRole(ex, 'prefat'); return ex; })()`);
    assert.equal(ex.role, 'prefat');
    assert.ok(ex.sets.every(s => s.warmup === true));
    assert.equal(run(`(() => { const ex = ${J(ex)}; return [warmLook(ex, ex.sets[0]), blockSetNo(ex, 1)]; })()`).join(), 'false,2');
    assert.equal(run(`(() => { const ex = ${J({ ...ex, role: 'warmup' })}; return [warmLook(ex, ex.sets[0]), blockSetNo(ex, 1)]; })()`).join(), 'true,0');
    const back = run(`(() => { const ex = ${J(ex)}; setBlockRole(ex, 'normal'); return ex; })()`);
    assert.ok(!('role' in back) && back.sets.every(s => !('warmup' in s)));
    assert.equal(run('blockRoleLabel({})'), 'Normal');
    assert.equal(run('blockRoleLabel({ role: "warmup" })'), 'Échauffement');
  });

  test('blocs : champs nettoyés (rang, rôle, suivi), gardés tels quels quand ils sont bons', () => {
    setup();
    run(`data.programmes.u_test.exercises.legs.push({ id: 'x9', name: 'Leg curl', sets: 3, occ: 1, role: 'fun', exId: 'x9' },
      { id: 'x8', name: 'Leg curl', sets: 3, occ: 99, exId: 7 }); sanitizeData(data);`);
    const xs = run('data.programmes.u_test.exercises.legs');
    assert.ok(!('occ' in xs[3]) && !('role' in xs[3]) && !('exId' in xs[3]), J(xs[3]));
    assert.ok(!('occ' in xs[4]) && !('exId' in xs[4]), J(xs[4]));
    assert.equal(xs[0].occ, 2); assert.equal(xs[0].role, 'prefat'); assert.equal(xs[0].exId, 'ext1');
    const h = run(`(() => { const h = ${J(entry('h', 1, [{ exId: 'ext1', name: 'Extension quadriceps', occ: 2, role: 'prefat', sets: [W(20, 15)] }, { exId: 'ext1', name: 'Extension quadriceps', occ: '2', role: 1, sets: [S(20, 15)] }]))}; cleanHistoryEntry(h); return h; })()`);
    assert.equal(h.exercises[0].occ, 2); assert.equal(h.exercises[0].role, 'prefat');
    assert.ok(!('occ' in h.exercises[1]) && !('role' in h.exercises[1]));
  });

  test('blocs : séance faite par une version d\'avant (exId = id du bloc) rattachée au suivi commun, une seule fois', () => {
    setup();
    run(`data.history = [${J(entry('old', 1000, [
      { exId: 'ext2', name: 'Extension quadriceps', sets: [S(20, 15), S(20, 15)] },
      { exId: 'ext1', name: 'Extension quadriceps', sets: [S(60, 10)] },
    ]))}];`);
    assert.equal(run('relinkBlockHistory(data)'), 1);
    const xs = run('data.history[0].exercises');
    assert.equal(xs[0].exId, 'ext1'); assert.equal(xs[0].occ, 2); assert.equal(xs[0].role, 'prefat');
    assert.ok(xs[0].sets.every(s => s.warmup === true), 'rôle du bloc : séries marquées');
    assert.equal(run('relinkBlockHistory(data)'), 0, 'idempotent');
    // Au chargement : même rattachement
    run(`data.history[0].exercises[0].exId = 'ext2'; delete data.history[0].exercises[0].occ; localStorage.setItem(KEY, JSON.stringify(data));`);
    assert.equal(run('loadData().history[0].exercises[0].exId'), 'ext1');
  });

  test('blocs : données d\'une nouvelle version lues par la règle d\'avant (sameEx, champs inconnus gardés)', () => {
    setup();
    // Une version d'avant compare par exIdOf (exId || id) : le bloc de plus est bien le même exercice
    assert.equal(run('sameEx(data.programmes.u_test.exercises.legs[0], { exId: "ext1", name: "x" })'), true);
    // Elle démarre la séance avec exId: ex.id (le bloc), et retrouve ce bloc par son id : sessExData d'avant
    assert.equal(run('data.programmes.u_test.exercises.legs.find(e => e.id === "ext2").sets'), 2);
    // Champs gardés par son nettoyage (aucune liste blanche de champs)
    const h = run(`(() => { const h = ${J(entry('h', 1, [{ exId: 'ext1', name: 'Extension quadriceps', occ: 2, role: 'prefat', sets: [W(20, 15)] }]))}; cleanHistoryEntry(h); return h; })()`);
    assert.equal(h.exercises[0].occ, 2);
  });

  test('blocs : programme envoyé par le coach, le même exercice deux fois avec son rôle, repris dans l\'ordre à chaque envoi', () => {
    reset();
    const sent = { name: 'Jambes coach', sessions: [{ key: 'legs', label: 'Jambes', color: '#ff9500', exercises: [
      { name: 'Extension quadriceps', sets: 2, role: 'prefat', repMax: 15, repFixed: true },
      { name: 'Squat barre', sets: 4 },
      { name: 'Extension quadriceps', sets: 3, role: 'moche' },
    ] }] };
    const clean = run(`cleanSentProgramme(${J(sent)})`);
    assert.equal(clean.sessions[0].exercises.length, 3, 'le doublon reste');
    assert.equal(clean.sessions[0].exercises[0].role, 'prefat');
    assert.ok(!('role' in clean.sessions[0].exercises[2]), 'rôle inconnu retiré');
    const id = run(`importCoachProgramme(data, ${J({ id: 'p1', data: sent, sentAt: 10 })}, { user_id: 'coach-1', username: 'coach' })`);
    const xs = run(`data.programmes[${J(id)}].exercises.legs`);
    assert.equal(xs[0].role, 'prefat');
    assert.ok(!xs[0].exId && !xs[0].occ, 'premier bloc : le suivi dans son id');
    assert.equal(xs[2].exId, xs[0].id, 'bloc de plus : même suivi');
    assert.equal(xs[2].occ, 2);
    // Nouvel envoi : les deux blocs gardent id, suivi et rang
    const again = run(`(() => { importCoachProgramme(data, ${J({ id: 'p1', data: sent, sentAt: 20 })}, { user_id: 'coach-1', username: 'coach' }); return data.programmes[${J(id)}].exercises.legs; })()`);
    sameJSON(again.map(e => [e.id, e.exId ?? null, e.occ ?? 1]), xs.map(e => [e.id, e.exId ?? null, e.occ ?? 1]));
    // L'empreinte reproduit l'envoi (rôle compris) : programme pas « modifié par l'élève »
    assert.equal(run(`coachProgrammeStatus(data, ${J({ id: 'p1', data: sent, sentAt: 20 })}, 'coach-1').modified`), false);
    const back = run(`programmeToSent(data, ${J(id)})`);
    sameJSON(back.sessions[0].exercises.map(e => [e.name, e.role ?? '']), [['Extension quadriceps', 'prefat'], ['Squat barre', ''], ['Extension quadriceps', '']]);
  });

  test('blocs : import Hevy, le même exercice repris après un autre devient un bloc de plus (séries entrelacées gardées ensemble)', () => {
    reset();
    const H = '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"\n';
    const row = (ex, i, kg, reps) => `"Legs","14 Jan 2026, 18:02","14 Jan 2026, 19:11","","${ex}",,,${i},"normal",${kg},${reps},,,\n`;
    const csv = H + row('Leg Extension (Machine)', 0, 20, 15) + row('Leg Extension (Machine)', 1, 20, 15) + row('Squat (Barbell)', 0, 100, 5)
      + row('Leg Extension (Machine)', 0, 60, 10) + row('Leg Extension (Machine)', 1, 60, 9);
    const r = run(`(() => { const r = applyImport(readImportCsv(${J(csv)}), {}); return { r, xs: data.history[0].exercises, prog: data.programmes[r.programme].exercises }; })()`);
    sameJSON(r.xs.map(e => [e.name, e.occ ?? 1, e.sets.length]), [['Extension quadriceps', 1, 2], ['Squat barre', 1, 1], ['Extension quadriceps', 2, 2]]);
    assert.equal(r.xs[0].exId, r.xs[2].exId, 'même suivi');
    const list = Object.values(r.prog)[0];
    assert.equal(list.length, 3);
    assert.equal(list[2].exId, list[0].id, 'bloc de plus du programme créé');
    assert.equal(list[2].occ, 2);
    // Superset entrelacé (A, B, A, B) : deux exercices, pas quatre blocs
    const ss = H + row('Bench Press (Barbell)', 0, 80, 8) + row('Bent Over Row (Barbell)', 0, 60, 8) + row('Bench Press (Barbell)', 1, 80, 8) + row('Bent Over Row (Barbell)', 1, 60, 8);
    reset();
    assert.equal(run(`readImportCsv(${J(ss)}).sessions[0].exercises.length`), 2);
  });

  test('blocs : dernière fois vue par le coach, le bloc de travail et pas la pré-fatigue', () => {
    reset();
    const rows = [{ id: 'r1', doneAt: 5, s: { exercises: [
      { name: 'Extension quadriceps', sets: [W(20, 15), W(20, 15)] },
      { name: 'Extension quadriceps', sets: [S(60, 10), S(60, 9)] },
    ] } }];
    sameJSON(run(`studentLastLoads(${J(rows)}, 'Extension quadriceps')`).kg, [60, 60]);
  });

  test('blocs : site du coach, rôle réglé par le coach, charges de chaque élève par bloc de même rang', () => {
    const html = fs.readFileSync(path.join(ROOT, 'coach-web/index.html'), 'utf8');
    assert.ok(html.includes('<script src="../js/data/blocks.js"></script>'));
    const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => path.normalize(path.join('coach-web', m[1])));
    const store = new Map();
    const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, Intl, atob, btoa, TextEncoder, TextDecoder, crypto: globalThis.crypto,
      localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
      navigator: {}, addEventListener() {}, document: { querySelector: () => null, getElementById: () => null, addEventListener() {} } };
    sandbox.window = sandbox;
    const ctx = vm.createContext(sandbox);
    for (const f of files.filter(f => !f.endsWith('main.js'))) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    const desk = code => vm.runInContext(code, ctx);
    const draft = desk(`(() => { const d = deskPgDraft({ name: 'P', sessions: [{ key: 'legs', label: 'Jambes', color: '#ff9500', exercises: [
      { name: 'Extension quadriceps', sets: 2 }, { name: 'Extension quadriceps', sets: 3 }] }] });
      deskPgPatch(d.sessions[0].exercises[0], 'role', 'prefat'); return d; })()`);
    assert.equal(draft.sessions[0].exercises[0].role, 'prefat');
    const out = desk(`deskPgPayload(${J(draft)}, 'p1')`);
    assert.ok(out.ok);
    sameJSON(out.data.sessions[0].exercises.map(e => e.role ?? ''), ['prefat', '']);
    assert.equal(desk(`deskPgPatch(${J({ name: 'X', sets: 3, role: 'prefat' })}, 'role', 'normal')`), true);
    // Envoi groupé : le 2e bloc reprend la charge du 2e bloc de l'autre élève
    const other = desk(`deskPgForOther(${J(draft)}, ${J({ sessions: [{ key: 'legs', exercises: [{ name: 'Extension quadriceps', load: 20 }, { name: 'Extension quadriceps', load: 60 }] }] })})`);
    sameJSON(other.sessions[0].exercises.map(e => e.load ?? null), [20, 60]);
    assert.equal(desk(`deskPgLast(${J([{ doneAt: 1, s: { exercises: [{ name: 'Extension quadriceps', sets: [S(60, 10)] }] } }])}, ${J({ name: 'Extension quadriceps', sets: 2, role: 'prefat' })})`), null);
  });
}
