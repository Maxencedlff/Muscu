// ═══════════════════════════════════════════════════════════
//  Appli web du coach, vague 2 (docs/COACH_WEB.md) : logique pure des bilans configurables
//  (coach-web/js/desk/checkins-model.js) dans le contexte exact de la page (scripts de coach-web/index.html, main.js
//  excepté) : lignes de l'éditeur, ordre, réglages d'un suivi, erreurs, plan d'enregistrement, destinataires,
//  textes d'envoi, comparaison de deux bilans, colonnes de la fiche Semaines, signal « Bilan reçu, à répondre »,
//  échappement des textes reçus dans les écrans.
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export default function ({ test, assert, ROOT }) {
  const html = fs.readFileSync(path.join(ROOT, 'coach-web/index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => path.normalize(path.join('coach-web', m[1])));
  const store = new Map();
  const sandbox = { console, setTimeout, clearTimeout, Intl, atob, btoa, TextEncoder, TextDecoder, crypto: globalThis.crypto,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, addEventListener() {}, document: { querySelector: () => null, getElementById: () => null, addEventListener() {} } };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files.filter(f => !f.endsWith('main.js'))) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const run = code => vm.runInContext(code, ctx);
  const J = o => JSON.stringify(o);
  const NOW = run('new Date(2026, 10, 24, 15).getTime()');
  const T = (k, h = 18) => run(`new Date(2026, 10, 24 - ${k}, ${h}).getTime()`);

  test('coach web bilans : scripts de la vague 2 chargés par la page et par la construction', () => {
    for (const f of ['js/desk/checkins-model.js', 'js/desk/templates.js', 'js/desk/review.js']) assert.ok(html.includes(`<script src="${f}"></script>`), f);
    assert.ok(html.indexOf('../js/data/checkins.js') < html.indexOf('js/desk/checkins-model.js'));
    assert.ok(html.indexOf('js/desk/review.js') < html.indexOf('js/desk/main.js'));
    assert.match(html, /id="live"[^>]*aria-live="polite"/, 'zone d\'annonce (réordonnancement)');
  });

  test('coach web bilans : lignes de l\'éditeur par rubrique, cochées d\'abord, catalogue complet', () => {
    const rows = run(`deskCkRows([checkinDefaultItem('stress'), checkinDefaultItem('weight'), checkinDefaultItem('sleep'), { kind: 'custom', key: 'qabcdefgh', type: 'text', label: 'Ta semaine ?' }])`);
    assert.equal(rows.length, 18, '17 suivis du catalogue et la question');
    assert.equal(J(rows.filter(r => r.group === 'feel').slice(0, 3).map(r => [r.key, r.on])), J([['stress', true], ['sleep', true], ['energy', false]]), 'ordre du modèle, puis le reste du catalogue');
    assert.equal(rows[0].key, 'weight');
    assert.equal(rows.at(-1).group, 'custom');
    const items = run(`deskCkItems(${J(rows)})`);
    assert.equal(J(items.map(i => i.key)), J(['weight', 'stress', 'sleep', 'qabcdefgh']), 'Corps, Activité, Ressenti, Tes questions');
    assert.equal(run(`deskCkItems(deskCkRows(checkinStarterItems(CHECKIN_STARTERS[0], () => 0))).length`), 11);
  });

  test('coach web bilans : réordonner dans une rubrique, par glisser ou par bouton, annoncé', () => {
    const rows = run(`deskCkRows(['sleep', 'energy', 'hunger', 'stress', 'weight'].map(checkinDefaultItem))`);
    const r = run(`deskCkMove(${J(rows)}, 'sleep', 2)`);
    assert.equal(J(r.rows.filter(x => x.group === 'feel').slice(0, 4).map(x => x.key)), J(['energy', 'hunger', 'sleep', 'stress']));
    assert.equal(run(`deskCkMoveText(${J(r)})`), 'Sommeil déplacé en position 3');
    assert.equal(r.rows[0].key, 'weight', 'les autres rubriques ne bougent pas');
    const up = run(`deskCkMoveBy(${J(r.rows)}, 'sleep', -1)`);
    assert.equal(up.pos, 2);
    const top = run(`deskCkMoveBy(${J(rows)}, 'sleep', -1)`);
    assert.equal(top.moved, false);
    assert.equal(run(`deskCkMoveText(${J(top)})`), 'Sommeil reste en position 1');
    const far = run(`deskCkMove(${J(rows)}, 'sleep', 99)`);
    assert.equal(far.rows.filter(x => x.group === 'feel').at(-1).key, 'sleep', 'borné à la fin de la rubrique');
    assert.equal(run(`deskCkItems(${J(far.rows)}).map(i => i.key).join()`), 'weight,energy,hunger,stress,sleep');
  });

  test('coach web bilans : type, échelle, bornes et question libre, nettoyés comme le serveur', () => {
    const fat = run(`deskCkItemPatch(checkinDefaultItem('fatigue'), { scale: 10, lo: 'Rien', hi: 'Épuisé' })`);
    assert.equal(J([fat.scale, fat.lo, fat.hi]), J([10, 'Rien', 'Épuisé']));
    const pain = run(`deskCkItemPatch(checkinDefaultItem('pain'), { type: 'text', required: true })`);
    assert.equal(pain.type, 'text');
    assert.equal(pain.required, false, 'suivi sensible : jamais obligatoire');
    assert.equal(run(`deskCkItemPatch(checkinDefaultItem('pain'), { type: 'scale' })`), null, 'type non permis : refusé');
    const q = run(`deskCkItemPatch({ ...deskCkNewQuestion('text', () => 0.1), label: 'Verres d\\'eau ?' }, { type: 'number', unit: 'verres' })`);
    assert.equal(J([q.type, q.unit, q.kind]), J(['number', 'verres', 'custom']));
    assert.match(q.key, /^q[a-z0-9]{8}$/);
    const sc = run(`deskCkItemPatch({ ...deskCkNewQuestion('text'), label: 'Motivation' }, { type: 'scale' })`);
    assert.equal(sc.scale, 5);
    assert.equal(run(`deskCkItemSub(checkinDefaultItem('measures'))`), 'Taille, Hanches, Cuisse gauche');
    assert.equal(run(`deskCkItemSub(checkinDefaultItem('sleep'))`), 'Mal à Très bien');
    assert.equal(run(`checkinTypeText(${J(fat)})`), '1 à 10');
  });

  test('coach web bilans : erreurs avant d\'enregistrer (nom, aucun suivi, question vide)', () => {
    const d = run(`deskCkDraft({ id: null, name: '', items: [] }, null)`);
    assert.equal(J(run(`deskCkErrors(${J(d)})`).map(e => e.text)), J(['Donne un nom à ce bilan.', 'Coche au moins un suivi.']));
    const d2 = run(`(() => { const d = deskCkDraft({ id: null, name: 'Hebdo', items: [checkinDefaultItem('weight')] }, null); const q = deskCkNewQuestion('text'); d.rows.push({ key: q.key, group: 'custom', on: true, item: q }); return d; })()`);
    const e = run(`deskCkErrors(${J(d2)})`);
    assert.equal(e.length, 1);
    assert.match(e[0].text, /question/);
    assert.equal(e[0].key, d2.rows.at(-1).key);
  });

  const setup = () => run(`({ templates: [cleanCheckinTemplate({ id: '11111111-1111-4111-8111-111111111111', name: 'Hebdo', items: [{ kind: 'weight', type: 'number' }] })],
    schedules: [cleanCheckinSchedule({ id: 's1', template_id: '11111111-1111-4111-8111-111111111111', group_id: 'g1', freq: 'week', weekday: 0, monthday: 1, send_hour: 18, remind_after_h: 24, due_after_h: 48 }),
      cleanCheckinSchedule({ id: 's2', template_id: '11111111-1111-4111-8111-111111111111', student_id: 'karim', freq: '2weeks', weekday: 0, monthday: 1, send_hour: 18, remind_after_h: 24, due_after_h: 48 }),
      cleanCheckinSchedule({ id: 's3', template_id: '11111111-1111-4111-8111-111111111111', student_id: 'tom', freq: 'week', weekday: 0, monthday: 1, send_hour: 18, remind_after_h: 24, due_after_h: 48 })],
    groups: [cleanCheckinGroup({ id: 'g1', name: 'Sèche', members: ['lea', 'karim', 'ines'] })] })`);

  test('coach web bilans : réglage du bilan, fréquence propre d\'un élève, plan d\'enregistrement', () => {
    const s = setup();
    const d = run(`deskCkDraft(${J(s.templates[0])}, ${J(s)})`);
    assert.equal(J(d.base), J({ freq: 'week', weekday: 0, monthday: 1, send_hour: 18, remind_after_h: 24, due_after_h: 48 }), 'réglage du planning du groupe');
    assert.equal(J(d.targets.map(t => [t.type, t.id, t.own ? t.own.freq : null])), J([['group', 'g1', null], ['student', 'karim', '2weeks'], ['student', 'tom', null]]));
    assert.equal(J(run(`deskCkStudentsOf(${J(d.targets)}, ${J(s.groups)}, ['lea', 'karim', 'tom'])`)), J(['lea', 'karim', 'tom']), 'groupe déplié, élèves liés seulement, sans doublon');
    assert.equal(J(run(`deskCkTemplateLine(${J(s.templates[0])}, ${J(s)})`)), J({ id: s.templates[0].id, name: 'Hebdo', when: 'Chaque semaine · dimanche 18 h', students: 4, text: '4 élèves' }));
    // Le coach passe le bilan au mois, retire Tom : Karim garde sa fréquence, le planning de Tom part
    d.base = { ...d.base, freq: 'month', monthday: 3 };
    d.targets = d.targets.filter(t => t.id !== 'tom');
    const p = run(`deskCkSavePlan(${J(d)}, ${J(s)})`);
    assert.equal(J(p.schedules.map(x => [x.grp, x.student, x.freq, x.monthday])), J([['g1', null, 'month', 3], [null, 'karim', '2weeks', 1]]));
    assert.equal(J(p.deletes), J(['s3']));
    assert.equal(p.template.items[0].kind, 'weight');
    assert.notEqual(run(`deskCkSnapshot(${J(d)})`), run(`deskCkSnapshot(deskCkDraft(${J(s.templates[0])}, ${J(s)}))`), 'changement repéré : quitter demande confirmation');
    const fresh = run(`deskCkDraft({ id: null, name: 'Express', items: [] }, ${J(s)}, 'manual')`);
    assert.equal(J([fresh.base.freq, fresh.targets.length]), J(['manual', 0]), 'nouveau bilan : fréquence du modèle fourni, personne');
    assert.equal(run(`deskCkSavePlan(${J(fresh)}, ${J(s)}).deletes.length`), 0, 'un nouveau bilan ne retire rien');
  });

  test('coach web bilans : textes d\'envoi (rappel, date limite, fréquence propre)', () => {
    const b = { freq: 'week', weekday: 0, monthday: 1, send_hour: 18, remind_after_h: 24, due_after_h: 48 };
    assert.equal(run(`deskCkWhenText(${J(b)}, 48)`), 'Mardi, 18 h');
    assert.equal(run(`deskCkWhenText(${J(b)}, 12)`), 'Lundi, 6 h');
    assert.equal(run(`deskCkWhenText(${J({ ...b, weekday: 6 })}, 24)`), 'Dimanche, 18 h');
    assert.equal(run(`deskCkWhenText(${J({ ...b, freq: 'month' })}, 72)`), 'Le 4, 18 h');
    assert.equal(run(`deskCkWhenText(${J({ ...b, freq: 'manual' })}, 24)`), null);
    assert.equal(run('deskCkDelayText(24)'), '1 jour après l\'envoi');
    assert.equal(run('deskCkDelayText(168)'), '7 jours après l\'envoi');
    assert.equal(run('deskCkDelayText(12)'), '12 h après l\'envoi');
    assert.equal(run(`deskCkOverrideText(${J({ ...b, freq: '2weeks' })})`), 'toutes les 2 sem.');
  });

  // Bilans d'un élève, comme coach_student_checkins les rend
  const items = [{ kind: 'weight', type: 'number' }, { kind: 'measures', type: 'number', options: { keys: ['waist', 'hips'] } }, { kind: 'photos', type: 'photo', options: { poses: ['face'] } },
    { kind: 'sleep', type: 'scale' }, { kind: 'steps', type: 'number' }, { kind: 'diet_adherence', type: 'auto' }, { kind: 'pain', type: 'yesno' }, { kind: 'custom', key: 'qdifficul', type: 'text', label: 'Difficulté ?' }];
  const req = (n, k, answers, o = {}) => ({ id: `0000000${n}-0000-4000-8000-000000000000`, template_id: 't', name: 'Hebdo', items, period_start: run(`localISO(${T(k + 6, 12)})`),
    sent_at: new Date(T(k)).toISOString(), due_at: new Date(T(k - 2)).toISOString(), answered_at: answers ? new Date(T(k, 20)).toISOString() : null, cancelled_at: null, answers: answers || {}, review: null, ...o });
  const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const list = () => run(`${J([
    req(1, 2, { weight: 62.2, measures: { waist: 68.5, hips: 94.5 }, photos: { ids: [U, U.replace('a', 'b')] }, sleep: 3, steps: 8900, diet_adherence: { done: 6, of: 7 }, qdifficul: '<b>Le soir</b>' }),
    req(2, 9, { weight: 62.6, measures: { waist: 69.2 }, sleep: 4, steps: 8500, diet_adherence: { done: 5, of: 7 }, pain: { yes: false } }),
    req(3, 16, null, { cancelled_at: new Date(T(14)).toISOString() }),
    req(4, 0, null),
  ])}.map(cleanCheckinRequest)`);

  test('coach web bilans : bilans reçus, en attente, pas remplis ; titre et photos', () => {
    const h = run(`deskCkHistory(${J(list())})`);
    assert.equal(J([h.answered.length, h.pending.length, h.missed.length]), J([2, 1, 1]));
    assert.equal(h.answered[0].id.startsWith('00000001'), true, 'du plus récent');
    assert.equal(J(run(`deskCkTitle(${J(h.answered[0])}, ${NOW})`)), J({ title: 'Semaine 47', sub: 'Hebdo, reçu dim. 22 nov.' }));
    assert.equal(run(`deskCkPhotoCount(${J(h.answered[0])})`), 2);
  });

  test('coach web bilans : comparaison « face à » un bilan précédent (poids, mensurations, nombres, échelles)', () => {
    const h = run(`deskCkHistory(${J(list())})`);
    const c = run(`deskCkCompare(${J(h.answered[0])}, ${J(h.answered[1])})`);
    assert.equal(J(c.figures.map(f => [f.label, f.value, f.delta])), J([['Poids', 62.2, -0.4], ['Taille', 68.5, -0.7], ['Hanches', 94.5, null], ['Pas par jour', 8900, 400]]));
    assert.equal(J(c.answers.map(a => [a.label, a.text, a.delta])), J([['Sommeil', '3 sur 5', -1], ['Respect du plan diète', '6 jours sur 7', 1], ['Douleurs ou blessures', 'Pas de réponse', null], ['Difficulté ?', '<b>Le soir</b>', null]]));
    assert.equal(c.photos, 2);
    const alone = run(`deskCkCompare(${J(h.answered[0])}, null)`);
    assert.ok(alone.figures.every(f => f.delta === null) && alone.answers.every(a => a.delta === null), 'sans bilan précédent : aucun écart inventé');
  });

  test('coach web bilans : colonnes de la fiche Semaines (sauf poids et mensurations), valeur de la semaine du bilan', () => {
    const l = list();
    const cols = run(`deskCkWeekColumns(${J(l)})`);
    assert.equal(J(cols.map(c => [c.key, c.head])), J([['sleep', 'Sommeil (sur 5)'], ['steps', 'Pas par jour (pas/jour)'], ['diet_adherence', 'Respect du plan diète (jours)']]));
    const weeks = run(`deskWeeks({ now: ${NOW}, count: 3 })`);
    const v = weeks.map(w => run(`deskCkWeekValues(${J(w)}, ${J(l)}, ${J(cols)})`));
    assert.equal(J(v[0]), J({}), 'S48 : aucun bilan dont la période commence cette semaine');
    assert.equal(J([v[1].sleep, v[1].steps.n, v[1].diet_adherence]), J([{ n: 3, text: '3' }, 8900, { n: 6, text: '6 sur 7' }]), 'S47 : bilan de la période du lundi 16');
    assert.equal(v[2].sleep.n, 4);
    assert.equal(J(run('deskCkWeekColumns([])')), J([]), 'sans bilan : aucune colonne');
  });

  test('coach web bilans : signal « Bilan reçu, à répondre » au tableau de bord et compteur', () => {
    const ov = run(`deskCkOverview(${J([
      { request_id: 'r1', student_id: 'lea', name: 'Hebdo', sent_at: new Date(T(2)).toISOString(), due_at: null, answered_at: new Date(T(2, 20)).toISOString(), reviewed: false },
      { request_id: 'r2', student_id: 'tom', name: 'Mois', sent_at: new Date(T(5)).toISOString(), due_at: null, answered_at: new Date(T(4)).toISOString(), reviewed: true },
      { request_id: 'r3', student_id: 'karim', name: 'Hebdo', sent_at: new Date(T(2)).toISOString(), due_at: new Date(T(-1)).toISOString(), answered_at: null, reviewed: false },
      { request_id: 'r4', student_id: 'parti', name: 'Hebdo', sent_at: new Date(T(2)).toISOString(), due_at: null, answered_at: new Date(T(1)).toISOString(), reviewed: false },
      { nope: true },
    ])})`);
    assert.equal(ov.length, 4, 'ligne illisible écartée');
    assert.equal(J(run(`deskCkToAnswer(${J(ov)}, ['lea', 'tom', 'karim']).map(r => r.id)`)), J(['r1']), 'répondu, retour pas envoyé, élève encore suivi');
    assert.equal(J(run(`deskCkWaiting(${J(ov)}, ${NOW}).map(r => r.id)`)), J(['r3']));
    const st = { is_coach: true, students: ['lea', 'tom', 'karim'].map(id => ({ user_id: id, username: id, since: '2026-08-01T10:00:00Z', sessions_7d: 0, new_sessions: 0, sent: [{ id: 'p', sent_at: '2026-10-01T10:00:00Z', seen: true }], last_session: { done_at: T(1), label: 'Push' } })), invites: [] };
    const facts = { students: ['lea', 'tom', 'karim'].map(id => ({ student_id: id, sessions: [1, 3, 5, 8, 10, 12, 15].map(k => ({ at: T(k), records: [] })), first_at: T(60), last_record_at: null, unnoted_at: null })) };
    const rows = run(`deskStudentRows({ state: cleanCoachState(${J(st)}), facts: cleanCoachProgress(${J(facts)}, ${NOW}), ckOv: ${J(ov)}, now: ${NOW} })`);
    assert.equal(rows[0].id, 'lea', 'à traiter en tête');
    assert.ok(rows[0].act && rows[0].todo.some(t => t.kind === 'checkin' && t.text === 'Bilan reçu, à répondre'));
    assert.ok(!rows.find(r => r.id === 'tom').todo.some(t => t.kind === 'checkin'), 'retour déjà envoyé : rien à faire');
    const none = run(`deskStudentRows({ state: cleanCoachState(${J(st)}), now: ${NOW} })`);
    assert.ok(none.every(r => !r.ckToAnswer), 'serveur sans les bilans : aucun signal');
  });

  test('coach web bilans : textes reçus échappés (Bilans reçus, onglet Bilans)', () => {
    const rows = run(`deskStudentRows({ state: cleanCoachState({ is_coach: true, students: [{ user_id: 'lea', username: 'lea', since: '2026-08-01T10:00:00Z', sessions_7d: 0, new_sessions: 0, sent: [], last_session: null }] }), now: ${NOW} })`);
    rows[0].name = '<img src=x onerror=alert(1)>';
    const ov = [{ id: 'r1', student: 'lea', name: '<script>x</script>', sentAt: T(2), dueAt: null, answeredAt: T(1), reviewed: false }];
    const h = run(`deskReceivedHtml({ rows: ${J(rows)}, now: ${NOW}, ckOv: ${J(ov)} })`);
    assert.doesNotMatch(h, /<img src=x|<script>x/);
    assert.match(h, /&lt;script&gt;x/);
    assert.match(h, /#\/eleve\/lea\/bilans\/r1/);
    assert.match(run(`deskReceivedHtml({ rows: [], now: ${NOW}, ckOv: null, ckKind: 'missing' })`), /pas encore ouverts/, 'serveur sans la migration : dit proprement');
    const p = run(`deskRvPanelHtml({ checkins: ${J(list())}, now: ${NOW} }, ${J(rows[0])})`);
    assert.doesNotMatch(p, /<b>Le soir<\/b>|<img src=x/);
    assert.match(p, /&lt;b&gt;Le soir/);
    // Photos (vague 5) : ordinateur pas encore relié (aucune entrée) : le nombre et « Relier cet ordinateur », rien d'affiché
    run('ph.entry = null');
    const p2 = run(`deskRvPanelHtml({ checkins: ${J(list())}, now: ${NOW} }, ${J(rows[0])})`);
    assert.match(p2, /2 photos envoyées/);
    assert.match(p2, /data-ph="link"/);
    assert.doesNotMatch(p2, /<img /, 'aucune image sans ordinateur relié');
    assert.match(p, /role="radiogroup"/);
  });
}
