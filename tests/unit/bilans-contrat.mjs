// ═══════════════════════════════════════════════════════════
//  Bilans configurables : contrat partagé (js/data/checkins.js, docs/BILANS.md)
// ═══════════════════════════════════════════════════════════
//
// Les mêmes règles s'appliquent dans l'app, l'appli web du coach et le serveur (private.checkin_item_ok,
// private.checkin_value_ok, tests/sql/bilans_coach_test.sql) : un suivi ou une réponse refusé ici l'est aussi là-bas.

export default function ({ test, run, assert, sameJSON }) {
  const item = o => run(`checkinItemClean(${JSON.stringify(o)})`);
  const val = (it, v) => run(`(() => { const r = checkinValueClean(${JSON.stringify(it)}, ${JSON.stringify(v)}); return r === undefined ? 'REFUS' : r; })()`);

  test('bilans : catalogue fermé, clés et types permis', () => {
    assert.equal(item({ kind: 'inconnu', type: 'scale' }), null, 'sorte inconnue refusée');
    assert.equal(item({ kind: 'sleep', type: 'text' }), null, 'type non permis pour la sorte');
    sameJSON(item({ kind: 'sleep', type: 'scale', scale: 10 }), { key: 'sleep', kind: 'sleep', label: 'Sommeil', type: 'scale', required: false, scale: 10, lo: 'Mal', hi: 'Très bien' });
    assert.equal(item({ kind: 'custom', key: 'sleep', type: 'text', label: 'X' }), null, 'question libre : clé q + 8 caractères');
    assert.equal(item({ kind: 'custom', key: 'qabc12345', type: 'photo', label: 'X' }), null, 'question libre : jamais photo');
    assert.equal(item({ kind: 'custom', key: 'qabc12345', type: 'text', label: '  ' }), null, 'question libre sans intitulé');
    assert.equal(item({ kind: 'measures', type: 'number', options: { keys: [] } }), null, 'mensurations : au moins une');
    sameJSON(item({ kind: 'measures', type: 'number', options: { keys: ['hips', 'nez', 'waist'] } }).options, { keys: ['waist', 'hips'] }, 'ordre du catalogue, inconnues écartées');
    assert.equal(item({ kind: 'photos', type: 'photo', options: { poses: ['dessus'] } }), null, 'poses : face, profil, dos');
    assert.equal(item({ kind: 'libido', type: 'scale', required: true }).required, false, 'sensible : jamais obligatoire');
    assert.equal(item({ kind: 'cycle', type: 'choice', required: true }).required, false, 'cycle : jamais obligatoire');
    assert.equal(item({ kind: 'custom', key: 'qabc12345', type: 'text', label: 'x'.repeat(200) }).label.length, 120, 'intitulé borné à 120');
  });

  test('bilans : 60 suivis au plus, sans doublon, dans l\'ordre du coach', () => {
    const list = Array.from({ length: 70 }, (_, i) => ({ kind: 'custom', key: `q${String(i).padStart(8, '0')}`, type: 'text', label: `Q${i}` }));
    assert.equal(run(`checkinItemsClean(${JSON.stringify(list)}).length`), 60);
    sameJSON(run(`checkinItemsClean([{ kind: 'stress', type: 'scale' }, { kind: 'sleep', type: 'scale' }, { kind: 'stress', type: 'scale' }]).map(i => i.key)`), ['stress', 'sleep']);
  });

  test('bilans : réponses bornées, invalides refusées (jamais tronquées)', () => {
    const scale5 = item({ kind: 'sleep', type: 'scale' }), scale10 = item({ kind: 'sleep', type: 'scale', scale: 10 });
    assert.equal(val(scale5, 5), 5); assert.equal(val(scale5, 6), 'REFUS'); assert.equal(val(scale5, 2.5), 'REFUS'); assert.equal(val(scale10, 10), 10);
    const kg = item({ kind: 'weight', type: 'number' });
    assert.equal(val(kg, 62.24), 62.24); assert.equal(val(kg, '62,2'), 62.2); assert.equal(val(kg, 12), 'REFUS'); assert.equal(val(kg, 301), 'REFUS');
    const steps = item({ kind: 'steps', type: 'number' });
    assert.equal(val(steps, 8900.6), 8901); assert.equal(val(steps, 100001), 'REFUS');
    const meas = item({ kind: 'measures', type: 'number', options: { keys: ['waist', 'hips'] } });
    sameJSON(val(meas, { waist: 68.5, hips: 'x', chest: 90 }), { waist: 68.5 }, 'seulement les mensurations du modèle');
    assert.equal(val(meas, { hips: 5 }), 'REFUS');
    const pain = item({ kind: 'pain', type: 'yesno' });
    sameJSON(val(pain, { yes: false, note: 'rien' }), { yes: false }, 'note seulement si oui');
    sameJSON(val(pain, { yes: true, note: ' genou\u0007 ' }), { yes: true, note: 'genou' });
    const txt = item({ kind: 'custom', key: 'qabc12345', type: 'text', label: 'Difficulté' });
    assert.equal(val(txt, 'a'.repeat(1500)).length, 1000); assert.equal(val(txt, '   '), 'REFUS');
    const auto = item({ kind: 'diet_adherence', type: 'auto' });
    sameJSON(val(auto, { done: 5, of: 7 }), { done: 5, of: 7 }); assert.equal(val(auto, { done: 8, of: 7 }), 'REFUS'); assert.equal(val(auto, { done: 0, of: 0 }), 'REFUS');
    const ph = item({ kind: 'photos', type: 'photo', options: { poses: ['face'] } });
    assert.equal(val(ph, { ids: ['pas-un-uuid'] }), 'REFUS');
    const cyc = item({ kind: 'cycle', type: 'choice' });
    assert.equal(val(cyc, 'luteal'), 'luteal'); assert.equal(val(cyc, 'autre'), 'REFUS');
    assert.equal(val(scale5, null), 'REFUS', 'null n\'est jamais une réponse (suivi passé : aucune ligne)');
  });

  test('bilans : obligatoires manquants, clés étrangères ignorées', () => {
    const items = [item({ kind: 'custom', key: 'qabc12345', type: 'text', label: 'Q', required: true }), item({ kind: 'sleep', type: 'scale' })];
    const r = run(`checkinAnswersClean(${JSON.stringify(items)}, { sleep: 3, autre: 1 })`);
    sameJSON(r, { answers: { sleep: 3 }, missing: ['qabc12345'] });
  });

  test('bilans : préremplissage avec ce que l\'app sait déjà', () => {
    const items = run(`checkinStarterItems(CHECKIN_STARTERS[0], () => 0.5)`);
    const r = run(`checkinPrefill(${JSON.stringify(items)}, { weights: [{ date: 2, kg: 62.2 }, { date: 1, kg: 63 }], measures: { waist: [{ date: 2, cm: 68.5 }] },
      dietDays: [{ status: 'ok' }, { status: 'ok' }, { status: 'part' }], sessions: 5, planned: 4, steps: null })`);
    sameJSON(r.values, { weight: 62.2, measures: { waist: 68.5 }, diet_adherence: { done: 2, of: 3 }, training_adherence: { done: 4, of: 4 } });
    assert.equal(r.from.weight, 'weight'); assert.ok(!('steps' in r.values), 'pas sans lecture de Santé');
  });

  test('bilans : textes (fréquence, durée, réponses)', () => {
    assert.equal(run(`checkinScheduleText({ freq: 'week', weekday: 0, send_hour: 18 })`), 'Chaque semaine · dimanche 18 h');
    assert.equal(run(`checkinScheduleText({ freq: '2weeks', weekday: 1, send_hour: 9 })`), 'Toutes les 2 semaines · lundi 9 h');
    assert.equal(run(`checkinScheduleText({ freq: 'manual' })`), 'À la demande');
    assert.equal(run(`checkinValueText(checkinItemClean({ kind: 'diet_adherence', type: 'auto' }), { done: 5, of: 7 })`), '5 jours sur 7');
    assert.equal(run(`checkinValueText(checkinItemClean({ kind: 'steps', type: 'number' }), 8900)`), '8 900 pas/jour');
    assert.ok(run(`checkinMinutes(checkinStarterItems(CHECKIN_STARTERS[0]))`) >= 2);
    for (const s of run('CHECKIN_STARTERS.map(s => checkinStarterItems(s).length === s.kinds.length + s.questions.length)')) assert.ok(s, 'modèles fournis valides');
  });

  test('bilans : nettoyage d\'une demande reçue du serveur', () => {
    const r = run(`cleanCheckinRequest({ id: '00000000-0000-4000-8000-000000000001', name: 'Hebdo', items: [{ kind: 'sleep', type: 'scale', key: 'sleep', label: 'Sommeil' }, { kind: 'hack', type: 'x' }],
      answers: { sleep: 9, x: 1 }, sent_at: '2026-11-22T17:00:00Z', review: { reply: 'Bien', score: 11, sent: true } })`);
    assert.equal(r.items.length, 1); sameJSON(r.answers, {}, 'réponse hors bornes écartée'); assert.equal(r.review.score, null);
    assert.equal(run(`cleanCheckinRequest({ id: 'x' })`), null);
  });
}
