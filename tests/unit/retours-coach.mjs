// Retours de Sophie (coach, 26/11/2026) : courbe de charge par exercice (js/data/coach-ex-progress.js), fourchette écrite
// en entier dans l'envoi (sentRangesExplicit, js/data/coach.js), programme réglé sans être actif (progFocusId,
// onActiveProgramme, js/data/accessors.js), modèles et demandes de bilan (js/data/coach-checkin-send.js).
export default function ({ test, run, assert, sameJSON }) {
  const NOW = run('new Date(2026, 10, 26, 18).getTime()');
  const D = k => NOW - k * 86_400_000;
  const row = (k, exercises) => ({ id: `r${k}`, doneAt: D(k), s: { exercises } });
  const squat = (kg, reps = 8) => ({ name: 'Squat barre', sets: [{ weight: '40', reps: '10', warmup: true }, { weight: String(kg), reps: String(reps) }, { weight: String(kg - 5), reps: '10' }] });

  test('courbe de charge : la série de travail la plus lourde de chaque séance, 12 semaines, du plus ancien au plus récent', () => {
    const rows = [row(1, [squat(80), { name: 'Pompes', sets: [{ weight: '', reps: '20' }] }]), row(8, [squat(77.5)]), row(30, [squat(75), { name: 'Gainage', measure: 'time', sets: [{ weight: '10', reps: '60' }] }]),
      row(100, [squat(60)])];
    const s = run(`exerciseLoadSeries(${JSON.stringify(rows)}, ${NOW})`);
    sameJSON(s.map(x => x.name), ['Squat barre'], 'sans charge (pompes) ni hors reps (gainage) : pas de courbe ; 100 jours : hors fenêtre');
    sameJSON(s[0].points.map(p => [p.kg, p.reps]), [[75, 8], [77.5, 8], [80, 8]], 'échauffement exclu, plus lourde série');
    sameJSON(run(`exerciseLoadChange(${JSON.stringify(s[0])})`), { kg: 5, weeks: 4 });
    assert.equal(run(`exerciseLoadChange(${JSON.stringify({ points: [{ date: 1, kg: 5, reps: 1 }] })})`), null, 'un seul point : pas d\'écart');
  });

  test('courbe de charge : même nom (casse, accents) = même exercice, nom de la séance la plus récente ; les plus faits d\'abord', () => {
    const rows = [row(1, [{ ...squat(80), name: 'squat BARRE' }, { name: 'Développé couché', sets: [{ weight: '50', reps: '8' }] }]), row(3, [squat(78)]), row(5, [squat(76)])];
    const s = run(`exerciseLoadSeries(${JSON.stringify(rows)}, ${NOW})`);
    sameJSON(s.map(x => [x.name, x.points.length]), [['squat BARRE', 3], ['Développé couché', 1]]);
  });

  test('courbe de charge : fenêtre couverte seulement si toutes ses séances sont reçues ou si la plus ancienne la dépasse', () => {
    assert.equal(run(`exerciseLoadCovered({ loadedAt: 1, end: false, rows: [{ doneAt: ${D(3)} }] }, ${NOW})`), false);
    assert.equal(run(`exerciseLoadCovered({ loadedAt: 1, end: false, rows: [{ doneAt: ${D(90)} }] }, ${NOW})`), true);
    assert.equal(run(`exerciseLoadCovered({ loadedAt: 1, end: true, rows: [] }, ${NOW})`), true);
    assert.equal(run(`exerciseLoadCovered({ loadedAt: 0, end: true, rows: [] }, ${NOW})`), false, 'rien de lu');
  });

  test('envoi : la fourchette part en entier (bas appliqué écrit), reps fixes et ancien format inchangés', () => {
    const p = { name: 'Force', sessions: [{ key: 'sA', label: 'Jambes', color: '#34C759', exercises: [
      { name: 'Presse à cuisses', sets: 3, repMax: 12, load: 100 }, { name: 'Squat barre', sets: 3, repMin: 6, repMax: 8 },
      { name: 'Fentes', sets: 3, repMax: 10, repFixed: true }, { name: 'Soulevé de terre', sets: 3, repMax: 5 }, { name: 'Gainage', sets: 3, measure: 'time' }] }] };
    const v = run(`coachSentPayload(${JSON.stringify(p)}, 'u_force')`);
    assert.equal(v.ok, true);
    sameJSON(v.data.sessions[0].exercises.map(e => [e.repMin ?? null, e.repMax ?? null, e.repFixed ?? false, e.load ?? null]),
      [[8, 12, false, 100], [6, 8, false, null], [null, 10, true, null], [null, 5, false, null], [null, null, false, null]],
      '8 à 12 écrit en entier ; 6 à 8 gardé ; 10 fixes ; « 5 » seul (ancien format des reps fixes) gardé ; gainage sans reps');
  });

  test('programme affiché : l\'actif sans fournisseur, celui de la page sinon ; onActiveProgramme rend toujours l\'actif', () => {
    run(`data.userProgrammes.u_x = { name: 'X', sessions: {}, archived: false }; data.activeProgramme = 'ppl';`);
    assert.equal(run('progFocusId()'), 'ppl');
    run(`progFocusOf = () => 'u_x'`);
    assert.equal(run('progFocusId()'), 'u_x');
    assert.equal(run('onActiveProgramme(() => progFocusId())'), 'ppl');
    assert.equal(run('progFocusId()'), 'u_x', 'rendu après onActiveProgramme');
    assert.equal(run('onActiveProgramme(() => { try { throw new Error("x"); } catch { return progFocusId(); } })'), 'ppl');
    run(`data.userProgrammes.u_x.archived = true`);
    assert.equal(run('progFocusId()'), 'ppl', 'programme supprimé : l\'actif');
    run(`progFocusOf = () => 'inconnu'`);
    assert.equal(run('progFocusId()'), 'ppl', 'identifiant inconnu : l\'actif');
    run(`progFocusOf = null; delete data.userProgrammes.u_x`);
  });

  test('bilans du coach : modèles et demandes nettoyés (sans nom, sans suivi valide ou sans date : écartés)', () => {
    const t = run(`cleanCkTemplates({ templates: [{ id: 'a', name: ' Hebdo ', items: [{ key: 'weight', kind: 'weight', label: 'Poids', type: 'number', unit: 'kg', required: false }] },
      { id: 'b', name: '', items: [] }, { id: 'c', name: 'Vide', items: [{ kind: 'inconnu' }] }, null] })`);
    sameJSON(t.map(x => [x.id, x.name, x.items.length]), [['a', 'Hebdo', 1]]);
    const r = run(`cleanCkRequests([{ id: 'x', name: 'Hebdo', sent_at: '2026-11-20T10:00:00Z', answered_at: null },
      { id: 'y', name: 'Express', sent_at: '2026-11-25T10:00:00Z', answered_at: '2026-11-25T18:00:00Z' }, { id: 'z', sent_at: 'pas une date' }])`);
    sameJSON(r.map(x => [x.id, x.answeredAt !== null]), [['y', true], ['x', false]], 'du plus récent, sans date : écartée');
  });
}
