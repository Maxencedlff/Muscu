// Import aidé par l'IA (docs/IMPORT_IA.md) : règles de la fonction serveur plan-import-ai (plan-ai-policy.js : entrée,
// schéma, nombres contrôlés sur la ligne, montée au second modèle, brouillon, coût) et logique de l'app
// (js/data/plan-ai.js : quand proposer, quoi envoyer, fusion du résultat, apprentissage).
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, assert, sameJSON, ROOT }) {
  const load = () => import(path.join(ROOT, 'supabase/functions/plan-import-ai/plan-ai-policy.js'));
  const item = (o = {}) => ({ exercise_id: null, sets: null, rep_min: null, rep_max: null, seconds: null, rest_s: null, load_kg: null, pct: null, rpe: null,
    rir: null, tempo: null, amrap: false, per_side: false, weighted: false, technique: null, technique_where: null, confidence: 'sure', ...o });

  test('import IA : bibliothèque du serveur à jour (mêmes noms que l\'app)', async () => {
    const { librarySource, LIBRARY_FILE } = await import(path.join(ROOT, 'tools/plan-import-ia/bibliotheque.mjs'));
    assert.equal(fs.readFileSync(LIBRARY_FILE, 'utf8'), librarySource(), 'node tools/plan-import-ia/bibliotheque.mjs');
    const { LIBRARY_NAMES } = await load();
    sameJSON(LIBRARY_NAMES, JSON.parse(JSON.stringify(run('catalogueNames()'))));
  });

  test('import IA : entrée validée, rien d\'autre que le texte du plan (clé inconnue refusée)', async () => {
    const { validateInput } = await load();
    assert.equal(validateInput({ mode: 'lines', targets: [{ text: 'DC 4x8', prev: '', next: '', session: 'Push' }] }).ok, true);
    assert.equal(validateInput({ mode: 'lines', targets: [{ text: 'DC 4x8' }] }).ok, true, 'contexte facultatif');
    for (const [b, field] of [[null, 'body'], [{ mode: 'x' }, 'mode'], [{ mode: 'lines', targets: [] }, 'targets'],
      [{ mode: 'lines', targets: [{ text: 'DC 4x8', eleve: 'Julie' }] }, 'targets'], [{ mode: 'lines', targets: [{ text: 'a' }], user: 'x' }, 'keys'],
      [{ mode: 'lines', targets: Array.from({ length: 41 }, () => ({ text: 'DC 4x8' })) }, 'targets'],
      [{ mode: 'lines', targets: [{ text: 'x'.repeat(301) }] }, 'targets'], [{ mode: 'plan', lines: ['x'.repeat(20001)] }, 'lines'],
      [{ mode: 'plan', lines: ['  '] }, 'lines'], [{ mode: 'image', image: { media_type: 'image/jpeg', data: 'A'.repeat(400) } }, 'consent'],
      [{ mode: 'image', consent: true, image: { media_type: 'image/gif', data: 'A'.repeat(400) } }, 'image'],
      [{ mode: 'image', consent: true, image: { media_type: 'image/jpeg', data: 'A'.repeat(2_700_000) } }, 'image']]) {
      const r = validateInput(b);
      assert.equal(r.ok, false, JSON.stringify(b).slice(0, 80));
      assert.equal(r.field, field, JSON.stringify(b).slice(0, 80));
    }
    assert.equal(validateInput({ mode: 'image', consent: true, image: { media_type: 'image/jpeg', data: 'A'.repeat(400) } }).ok, true);
  });

  test('import IA : nombres lus dans la ligne, en chiffres, en lettres et en durées', async () => {
    const { numbersIn } = await load();
    const n = s => { const r = numbersIn(s); return { nums: [...r.nums].sort((a, b) => a - b), times: [...r.times].sort((a, b) => a - b) }; };
    sameJSON(n('Fais trois séries de douze avec une minute trente de récup'), { nums: [1, 3, 12, 30], times: [60, 90] });
    sameJSON(n("DI haltères 3x10 1'30"), { nums: [1, 3, 10, 30], times: [90] });
    sameJSON(n('Squat 5x5 à 62,5 kg repos 2 min'), { nums: [2, 5, 62.5], times: [120] });
    sameJSON(n('dix-huit reps, soixante-dix %, quatre-vingt-dix secondes'), { nums: [18, 70, 90], times: [90] });
    sameJSON(n('Leg curl 4 x 12/10/8/6 repos 1:30'), { nums: [1, 4, 6, 8, 10, 12, 30], times: [90] });
  });

  test('import IA : réponse contrôlée (fiche de la bibliothèque, nombre absent refusé, bornes, illisible)', async () => {
    const { checkItem, LIBRARY_NAMES, needsEscalation, grade } = await load();
    const dc = LIBRARY_NAMES.indexOf('Développé couché barre');
    const ok = checkItem(item({ exercise_id: dc, sets: 4, rep_min: 8, rep_max: 10, rest_s: 120 }), 'DC 4x8-10 2min');
    sameJSON(ok, { name: 'Développé couché barre', presc: { sets: 4, repMin: 8, repMax: 10, rest: 120 }, confidence: 'sure', flags: [] });
    assert.equal(needsEscalation(ok), false);
    assert.equal(grade(ok).level, 'sure');
    // 5 séries : écrit nulle part dans la ligne → refusé, la ligne monte au second modèle et reste à vérifier
    const bad = checkItem(item({ exercise_id: dc, sets: 5, rep_min: 8, rep_max: 10 }), 'DC 4x8-10');
    assert.equal(bad.presc.sets, undefined);
    assert.ok(bad.flags.includes('nombre'));
    assert.equal(needsEscalation(bad), true);
    assert.equal(grade(bad).level, 'check');
    // Numéro de fiche inexistant : inconnu
    const out = checkItem(item({ exercise_id: 9999, sets: 4, rep_min: 8, rep_max: 8 }), 'Truc 4x8');
    assert.equal(out.name, null); assert.ok(out.flags.includes('hors-bibliotheque'));
    // Bornes : 40 séries ou 2 000 s de repos refusés même s'ils sont écrits
    const big = checkItem(item({ exercise_id: dc, sets: 40, rep_min: 8, rep_max: 8, rest_s: 2000 }), 'DC 40x8 repos 2000 s');
    assert.equal(big.presc.sets, undefined); assert.equal(big.presc.rest, undefined); assert.ok(big.flags.includes('borne'));
    // Repos à 0 seulement s'il est écrit (« sans repos »)
    assert.equal(checkItem(item({ exercise_id: dc, rest_s: 0 }), 'DC 4x8 sans repos').presc.rest, 0);
    assert.ok(checkItem(item({ exercise_id: dc, rest_s: 0 }), 'DC 4x8').flags.includes('nombre'));
    // Illisible : rien n'est gardé, pas compris
    const unread = checkItem(item({ exercise_id: dc, sets: 4, confidence: 'unreadable' }), 'Xqzt 4x');
    sameJSON([unread.name, unread.presc, grade(unread).level, grade(unread).why], [null, {}, 'unknown', ['illisible']]);
    // Hors bibliothèque lu sûrement : ne monte pas (sauf réglage de mesure)
    const burpees = checkItem(item({ sets: 3, rep_min: 20, rep_max: 20 }), 'Burpees 3x20');
    assert.equal(needsEscalation(burpees), false);
    assert.equal(needsEscalation(burpees, { unknownSure: true }), true);
    // Incertain : à vérifier pour le coach ; ne monte qu'avec le réglage « doute » (mesuré plus cher et moins juste)
    const unsure = checkItem(item({ exercise_id: dc, sets: 4, rep_min: 8, rep_max: 8, confidence: 'uncertain' }), 'DC 4x8');
    sameJSON([grade(unsure).level, needsEscalation(unsure), needsEscalation(unsure, { doubt: true })], ['check', false, true]);
    // Tempo seulement s'il est écrit
    assert.equal(checkItem(item({ exercise_id: dc, tempo: '3-1-1' }), 'DC 4x8 tempo 3-1-1').presc.tempo, '3-1-1');
    assert.equal(checkItem(item({ exercise_id: dc, tempo: '4-0-1' }), 'DC 4x8').presc.tempo, undefined);
  });

  test('import IA : schéma strict (tous les champs requis, aucun champ libre), consigne stable', async () => {
    const { schemaFor, systemBlocks, SYSTEM_RULES } = await load();
    const walk = (s, where) => {
      if (s?.type === 'object') {
        assert.equal(s.additionalProperties, false, where);
        sameJSON([...s.required].sort(), Object.keys(s.properties).sort(), where);
        for (const [k, v] of Object.entries(s.properties)) walk(v, `${where}.${k}`);
      }
      if (s?.type === 'array') walk(s.items, `${where}[]`);
      for (const a of s?.anyOf || []) walk(a, where);
    };
    for (const m of ['lines', 'plan', 'image']) walk(schemaFor(m), m);
    assert.ok(JSON.stringify(schemaFor('plan')).length < 3000, 'schéma court : la fiche est un numéro, pas une énumération des noms');
    const b = systemBlocks();
    assert.equal(b.length, 2); assert.equal(b[0].text, SYSTEM_RULES);
    sameJSON(b[1].cache_control, { type: 'ephemeral' });
    assert.equal(systemBlocks({ cache: false })[1].cache_control, undefined);
    assert.ok(!/\d{4}-\d\d-\d\d|Date|uuid/i.test(SYSTEM_RULES), 'rien de variable dans la consigne mise en cache');
    assert.match(SYSTEM_RULES, /N'invente rien/);
    assert.match(SYSTEM_RULES, /Ne devine jamais/);
  });

  test('import IA : brouillon du serveur à la forme de planParse, coût identique à la base', async () => {
    const { checkPlan, buildDraft, LIBRARY_NAMES, costUsd, PRICES } = await load();
    const input = { mode: 'plan', lines: ['Programme de force', 'Lundi', 'DC 4x8 2 min', 'Squat 5x5', '', 'Échauffement 10 min'] };
    const ans = { title_line: 0, sessions: [{ header_line: 1, items: [
      { ...item({ exercise_id: LIBRARY_NAMES.indexOf('Développé couché barre'), sets: 4, rep_min: 8, rep_max: 8, rest_s: 120 }), line: 2, superset: null },
      { ...item({ exercise_id: LIBRARY_NAMES.indexOf('Squat barre'), sets: 5, rep_min: 5, rep_max: 5 }), line: 3, superset: null },
      { ...item({ exercise_id: 0, sets: 9 }), line: 99, superset: null }] }] };
    const d = buildDraft(checkPlan(ans, input), input);
    const ref = JSON.parse(JSON.stringify(run('planParse("Lundi\\nDC 4x8")')));
    for (const k of Object.keys(ref)) assert.ok(k in d, `clé ${k}`);
    for (const k of ['id', 'src', 'raw', 'name', 'score', 'how', 'presc', 'level', 'why']) assert.ok(k in d.sessions[0].items[0], `élément : ${k}`);
    sameJSON(d.sessions.map(s => [s.label, s.items.map(i => i.name)]), [['Lundi', ['Développé couché barre', 'Squat barre']]]);
    assert.equal(d.title, 'Programme de force');
    assert.equal(d.stats.items, 2, 'ligne inexistante (99) écartée');
    // Nom et reps sur deux lignes (capture d'appli) : les nombres de la ligne suivante comptent, la ligne est reprise
    const two = { mode: 'plan', lines: ['Chin-up', '→ 8 reps', 'Pull-Up'] };
    const d2 = buildDraft(checkPlan({ title_line: null, sessions: [{ header_line: null, items: [
      { ...item({ exercise_id: LIBRARY_NAMES.indexOf('Tractions supination'), rep_min: 8, rep_max: 8 }), line: 0, line_end: 1, superset: null }] }] }, two), two);
    sameJSON([d2.sessions[0].items[0].presc, d2.sessions[0].items[0].src, d2.lines.map(l => l.role)], [{ repMin: 8, repMax: 8 }, 'Chin-up · → 8 reps', ['exercise', 'exercise', 'note']]);
    sameJSON(d.notes, ['Échauffement 10 min']);
    // Prix de la migration = prix du code
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261130010000_import_ia.sql'), 'utf8');
    for (const [model, p] of Object.entries(PRICES)) {
      const m = new RegExp(`\\('${model}', ([\\d.]+), ([\\d.]+), ([\\d.]+), ([\\d.]+)\\)`).exec(sql);
      assert.ok(m, `prix de ${model} dans la migration`);
      sameJSON(m.slice(1).map(Number), [p.in, p.out, p.cacheWrite, p.cacheRead], model);
    }
    assert.equal(+costUsd('claude-haiku-5-5', { input_tokens: 1e6, output_tokens: 1e4, cache_creation_input_tokens: 1e5, cache_read_input_tokens: 1e6 }).toFixed(6), 0.1275);
  });

  // ── App : js/data/plan-ai.js ──
  const parse = t => `planParse(${JSON.stringify(t)}, { learned: {} })`;
  test('import IA (app) : proposé seulement quand le moteur hésite ; lignes douteuses seules, ou tout le texte', () => {
    const sure = run(`planAiAdvice(${parse('Lundi\nDéveloppé couché 4x8\nSquat 5x5\nTractions 4x8\nRowing barre 4x10')})`);
    assert.equal(sure.propose, false, 'tout est sûr : rien n\'est proposé');
    const some = run(`(() => { const d = ${parse('Lundi\nDéveloppé couché 4x8\nSquat 5x5\nTractions 4x8\nRowing barre 4x10\nZorglub 3x12\nTirage horizontal machine 3x10')}; const a = planAiAdvice(d); return { propose: a.propose, mode: a.mode, n: a.targets.length }; })()`);
    sameJSON(some, { propose: true, mode: 'lines', n: 2 });
    const none = run(`(() => { const a = planAiAdvice(${parse('blabla 4x\nzzz 3x\nqqq')}, { text: 'x' }); return [a.propose, a.mode]; })()`);
    sameJSON(none, [true, 'plan']);
    // Lignes non reprises qui portent un nombre : peut-être des exercices manqués, envoyées avec les douteuses
    const missed = run(`(() => { const a = planAiAdvice(${parse('Lundi\nDéveloppé couché 4x8\n10 jumping muscle ups\n20 kettlebell swings\nSquat 5x5\nTractions 4x8')}); return [a.propose, a.targets.filter(t => t.note).length]; })()`);
    assert.equal(missed[0], true);
  });

  test('import IA (app) : corps envoyé sans nom d\'élève, contexte limité à la ligne d\'avant et d\'après', () => {
    const body = run(`(() => { const d = ${parse('Programme de Julie\nLundi\nDéveloppé couché 4x8\nZorglub 3x12 comme Julie aime\nSquat 5x5')};
      const a = planAiAdvice(d); return planAiLinesBody(d, a.targets, { names: ['Julie'] }); })()`);
    assert.equal(body.mode, 'lines');
    sameJSON(Object.keys(body).sort(), ['mode', 'targets']);
    const t = body.targets.find(x => /Zorglub/.test(x.text));
    sameJSON(Object.keys(t).sort(), ['next', 'prev', 'session', 'text']);
    assert.ok(!JSON.stringify(body).includes('Julie'), 'nom de l\'élève masqué');
    assert.equal(t.prev, 'Développé couché 4x8'); assert.equal(t.next, 'Squat 5x5'); assert.equal(t.session, 'Lundi');
    const plan = run('planAiPlanBody("Programme de Julie\\nLundi\\nDC 4x8", { names: ["Julie"] })');
    sameJSON(plan, { mode: 'plan', lines: ['Programme de …', 'Lundi', 'DC 4x8'] });
    assert.equal(run('planAiRedact("@julie_92 et Julien", ["julie_92"])'), '… et Julien', 'pseudo masqué, un autre mot gardé');
  });

  test('import IA (app) : résultat remis dans le brouillon, mêmes niveaux, correction apprise', () => {
    const r = run(`(() => { const d = ${parse('Lundi\nDéveloppé couché 4x8\nZorglub 3x12')};
      const a = planAiAdvice(d);
      const i = a.targets.findIndex(t => t.item && /Zorglub/.test(t.item.src));
      const n = planAiApplyLines(d, a.targets, [{ i, name: 'Curl barre', presc: { sets: 3, repMin: 12, repMax: 12 }, confidence: 'sure', level: 'sure', why: [] }]);
      const it = d.sessions[0].items.find(x => /Zorglub/.test(x.src));
      return { n, name: it.name, how: it.how, level: it.level, ai: it.ai, learn: planAiLearnable(d), stats: d.stats.unknown }; })()`);
    sameJSON(r, { n: 1, name: 'Curl barre', how: 'ai', level: 'sure', ai: true, learn: { Zorglub: 'Curl barre' }, stats: 0 });
    // Ligne illisible pour l'IA : le résultat du moteur reste
    const keep = run(`(() => { const d = ${parse('Lundi\nZorglub 3x12')}; const a = planAiAdvice(d);
      planAiApplyLines(d, a.targets, [{ i: 0, name: null, presc: {}, confidence: 'unreadable', level: 'unknown', why: ['illisible'] }]);
      const it = d.sessions[0].items[0]; return [it.how, it.level, !!it.ai]; })()`);
    sameJSON(keep, ['none', 'unknown', false]);
    // Brouillon du serveur (mode plan) : nom inconnu de l'app refusé, niveaux recalculés, nom lu tiré de la ligne
    const ad = run(`(() => { const d = planAiAdopt({ title: null, sessions: [{ label: 'Lundi', items: [
        { id: 'a1', src: 'DC 4x8', raw: 'DC 4x8', name: 'Développé couché barre', presc: { sets: 4, repMin: 8, repMax: 8 }, why: [] },
        { id: 'a2', src: 'Nom pirate 3x10', raw: '', name: 'Nom pirate', presc: { sets: 3, repMin: 10, repMax: 10 }, why: ['nombre'] }] }],
        lines: [], notes: [], cut: {} }, null);
      return d.sessions[0].items.map(i => [i.name, i.raw, i.level]); })()`);
    sameJSON(ad, [['Développé couché barre', 'DC', 'sure'], [null, 'Nom pirate', 'unknown']]);
  });
}
