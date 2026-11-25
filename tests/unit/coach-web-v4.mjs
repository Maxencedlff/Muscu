// ═══════════════════════════════════════════════════════════
//  Appli web du coach, vague 4 (docs/COACH_WEB.md) : Messages, Programme, Nutrition, dans le contexte exact de la page
//  (scripts de coach-web/index.html, main.js excepté). Messages : fonctions de js/data/coach-chat.js appelées avec
//  l'appel du site (curseur, lecture, nettoyage), fil mêlé aux séances et aux bilans. Programme : règles de l'éditeur,
//  format identique à l'app (coachSentPayload, programmeToSent), charges de chaque élève à l'envoi groupé,
//  « La dernière fois ». Nutrition : semaine du lundi, statuts de l'app, repas du plan, chiffres, moyennes.
//  Envoi à plusieurs (coachSendQueue, partagé avec l'app), embarquement (MDLF_COACH_HOST absent : le site).
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export default function ({ test, assert, ROOT }) {
  const html = fs.readFileSync(path.join(ROOT, 'coach-web/index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => path.normalize(path.join('coach-web', m[1])));
  const store = new Map();
  const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, Intl, atob, btoa, TextEncoder, TextDecoder, crypto: globalThis.crypto,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, addEventListener() {}, document: { querySelector: () => null, getElementById: () => null, addEventListener() {} } };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files.filter(f => !f.endsWith('main.js'))) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const run = code => vm.runInContext(code, ctx);
  const J = o => JSON.stringify(o);
  const NOW = run('new Date(2026, 10, 24, 15).getTime()');
  const T = (k, h = 18, m = 0) => run(`new Date(2026, 10, 24 - ${k}, ${h}, ${m}).getTime()`);

  test('coach web v4 : scripts partagés et écrans chargés, rien écrit sur l\'appareil', () => {
    for (const f of ['js/desk/chat-model.js', 'js/desk/prog-model.js', 'js/desk/diet-model.js', 'js/desk/messages.js', 'js/desk/programme.js', 'js/desk/nutrition.js'])
      assert.ok(html.includes(`<script src="${f}"></script>`), f);
    for (const f of ['../js/data/accessors.js', '../js/data/goals.js', '../js/data/coach-diet.js']) assert.ok(html.includes(f), f);
    assert.equal(store.size, 0);
    assert.equal(run('chatHiddenByAge()'), false, 'pas de contrôle parental d\'Apple sur un ordinateur');
    assert.equal(run('deskHosted()'), false, 'sans MDLF_COACH_HOST : le site, avec son écran de connexion');
  });

  // ── Messages ──
  test('coach web v4 : messages, mêmes fonctions que l\'app avec l\'appel du site (curseur, envoi, lecture)', async () => {
    run(`window.__calls = []; window.__srv = [{ id: 1, mine: false, body: 'Salut', at: '2026-11-24T08:00:00Z' }, { id: 2, mine: true, body: 'Yo', at: '2026-11-24T08:01:00Z' }];
      window.__rpc = async (fn, args) => { __calls.push([fn, args]);
        if (fn === 'chat_messages') return { ok: true, data: args.after_id != null ? __srv.filter(m => m.id > args.after_id) : __srv.slice().reverse() };
        if (fn === 'chat_send') { const m = { id: 9, mine: true, body: args.body, at: '2026-11-24T09:00:00Z' }; return { ok: true, data: m }; }
        return { ok: true, data: null }; };
      chat.threads = cleanChatThreads({ students: [{ student_id: 'lea', unread: 1 }] });`);
    await run(`chatLoad('lea', { rpc: __rpc })`);
    assert.equal(J(run(`chatConv('lea').rows.map(m => m.id)`)), J([1, 2]));
    assert.equal(run(`chatConv('lea').cursor`), 2);
    assert.equal(J(run(`__calls[0]`)), J(['chat_messages', { student: 'lea' }]), 'conversation désignée par l\'élève, comme l\'app');
    const sent = await run(`chatSend('lea', '  Bien reçu\\r\\n\\n\\n\\nà demain  ', { rpc: __rpc })`);
    assert.ok(sent.ok);
    assert.equal(run(`__calls.at(-1)[1].body`), 'Bien reçu\n\nà demain', 'texte nettoyé comme le serveur (chatClean)');
    assert.equal(run(`chatConv('lea').cursor`), 2, 'mon envoi n\'avance pas le curseur : un message de l\'élève arrivé avant reste relu');
    run(`__srv.push({ id: 3, mine: false, body: 'Arrivé avant ta réponse', at: '2026-11-24T08:59:00Z' })`);
    const p = await run(`chatPoll('lea', { rpc: __rpc })`);
    assert.equal(p.theirs, 1);
    assert.equal(J(run(`__calls.at(-1)`)), J(['chat_messages', { student: 'lea', after_id: 2 }]));
    await run(`chatMarkRead('lea', { force: true, rpc: __rpc })`);
    assert.equal(J(run(`__calls.at(-1)`)), J(['chat_mark_read', { student: 'lea', up_to: 3 }]), 'lu jusqu\'au dernier reçu');
    assert.equal(run(`chat.threads.students.lea.unread`), 0);
    assert.equal((await run(`chatSend('lea', '\\u00a0 ', { rpc: __rpc })`)).kind, 'empty_message');
    assert.equal((await run(`chatSend('lea', 'é'.repeat(2001), { rpc: __rpc })`)).kind, 'too_long');
    const rep = await run(`(async () => { let alerted = 0; const r = await chatReport('lea', 'spam', { rpc: async () => ({ ok: true, data: 42 }), reportAlert: id => { alerted = id; } }); return [r.ok, alerted]; })()`);
    assert.equal(J(rep), J([true, 42]), 'Signaler : alerte demandée par l\'appel du site');
    assert.equal(store.size, 0, 'rien des messages sur l\'appareil (account.user absent)');
  });

  test('coach web v4 : liste des conversations (non lues en tête, recherche), compteur', () => {
    const dash = { state: { students: [{ user_id: 'a', username: 'lea' }, { user_id: 'b', username: 'tom' }, { user_id: 'c', username: 'ines' }] },
      threads: { students: { a: { unread: 0, last: { id: 5, mine: true, body: 'On garde\ncomme ça', at: T(1) } }, b: { unread: 2, last: { id: 4, mine: false, body: 'Squat passé', at: T(3) } } } } };
    const rows = run(`deskChatRows(${J(dash)}, '', ${NOW})`);
    assert.equal(J(rows.map(r => r.name)), J(['tom', 'lea']), 'non lues en tête ; sans message, pas de ligne');
    assert.equal(rows[1].preview, 'Toi : On garde comme ça');
    assert.equal(run(`deskChatRows(${J(dash)}, 'INÈS', ${NOW})`).map(r => r.name).join(), 'ines', 'recherche sans accents ni capitales, aussi sans message');
    assert.equal(run(`deskChatCount('a'.repeat(10)).text`), '');
    assert.match(run(`deskChatCount('a'.repeat(1900)).text`), /1900 sur 2000/);
    const over = run(`deskChatCount('a'.repeat(2003))`);
    assert.ok(over.over && /3 caractères en trop/.test(over.text));
  });

  test('coach web v4 : fil mêlé aux séances commentées et aux bilans répondus, par jour', () => {
    const rows = [{ id: 1, mine: false, body: 'Bilan envoyé', at: T(2, 19) }, { id: 2, mine: true, body: 'Top', at: T(0, 9) }];
    const events = run(`deskThreadEvents({ sessions: [{ id: 's1', doneAt: ${T(1)}, s: { label: 'Haut A' }, note: 'Bien' }, { id: 's9', doneAt: ${T(60)}, s: { label: 'Vieux' }, note: '' }],
      checkins: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Hebdo', sentAt: ${T(3)}, answeredAt: ${T(2, 18)}, periodStart: '2026-11-16', review: null, items: [], answers: {} }], now: ${NOW} })`);
    assert.equal(J(events.map(e => e.type)), J(['session', 'checkin', 'session']));
    const items = run(`deskThreadItems(${J(rows)}, ${J(events)}, { end: true, now: ${NOW} })`);
    assert.equal(J(items.map(x => x.type === 'day' ? x.label : x.type)), J(['Dimanche 22 novembre 2026', 'checkin', 'msg', 'Hier', 'session', 'Aujourd\'hui', 'msg']),
      'jours de l\'app (chatDayLabel) ; séance de 60 jours : hors de la fenêtre');
    assert.equal(run(`deskThreadItems(${J(rows)}, ${J(events)}, { end: false, now: ${NOW} }).filter(x => x.type === 'session').length`), 1, 'séance après le plus ancien message chargé : montrée');
    assert.equal(run(`deskThreadItems(${J(rows.slice(1))}, ${J(events)}, { end: false, now: ${NOW} }).filter(x => x.type !== 'day' && x.type !== 'msg').length`), 0,
      'plus anciens que les messages chargés : attendent « Afficher les messages précédents »');
    assert.equal(events.find(e => e.type === 'checkin').title, 'Semaine 47');
  });

  // ── Programme ──
  const SENT = { name: 'Sèche 4 jours', sessions: [{ key: 'haut-a', label: 'Haut A', color: '#FF9F0A', exercises: [
    { name: 'Développé couché', sets: 4, repMin: 6, repMax: 8, loads: [45, 40, 40, 40], intens: 'topback', rest: 150, consigne: '2 reps en réserve' },
    { name: 'Élévations latérales', sets: 3, repMin: 12, repMax: 15, load: 6, intens: 'drop-last' }] }] };

  test('coach web v4 : éditeur, chaque champ ramené aux règles de l\'app', () => {
    run(`window.__d = deskPgDraft(cleanSentProgramme(${J(SENT)})); window.__e = __d.sessions[0].exercises[0]; window.__l = __d.sessions[0].exercises[1];`);
    assert.ok(run('__e._k && __l._k && __e._k !== __l._k'));
    run(`deskPgPatch(__e, 'sets', '12')`);
    assert.equal(run('__e.sets'), 10, 'séries de 1 à 10');
    run(`deskPgPatch(__e, 'sets', '2')`);
    assert.equal(J(run('__e.loads')), J([45, 40]), 'charges série par série ramenées aux séries');
    assert.equal(run('deskPgLoads(__e).mode'), 'sets');
    const mix = run(`(() => { const e = { name: 'Squat', sets: 3, load: 60, loads: [70] }; deskPgPatch(e, 'sets', '5'); const a = [0, 1, 2, 3, 4].map(i => prescKgAt(e, i));
      deskPgPatch(e, 'loads.2', '65'); return [a, [0, 1, 2, 3, 4].map(i => prescKgAt(e, i))]; })()`);
    assert.equal(J(mix), J([[70, 60, 60, 60, 60], [70, 60, 65, 60, 60]]), 'charge commune gardée en repli : une série ajoutée la reprend');
    run(`deskPgPatch(__e, 'repMin', '9')`);
    assert.equal(run('__e.repMin'), 6, 'bas au-dessus du haut : refusé, celui d\'avant reste');
    run(`deskPgPatch(__e, 'repMin', '5')`);
    assert.equal(J(run('deskPgReps(__e)')), J({ fixed: false, lo: 5, hi: 8 }));
    run(`deskPgPatch(__e, 'repsMode', 'fixed')`);
    assert.equal(J([run('__e.repFixed'), run('__e.repMin'), run('fixedReps(__e)')]), J([true, undefined, 8]), 'reps fixes : repFixed, pas de bas');
    run(`deskPgPatch(__e, 'repsMode', 'range')`);
    assert.equal(J(run('deskPgReps(__e)')), J({ fixed: false, lo: 4, hi: 8 }), 'retour en fourchette : 4 sous le haut (repSpanOf)');
    run(`deskPgPatch(__e, 'loads.1', '37,5')`);
    assert.equal(J(run('__e.loads')), J([45, 37.5]), 'virgule décimale');
    run(`deskPgPatch(__e, 'loadMode', 'one')`);
    assert.equal(J([run('__e.load'), run('__e.loads')]), J([45, undefined]), 'même charge pour toutes les séries');
    run(`deskPgPatch(__e, 'load', '')`);
    assert.equal(run('hasPrescLoad(__e)'), false, 'vide : pas de charge prescrite');
    run(`deskPgPatch(__e, 'load', '900')`);
    assert.equal(run('__e.load'), undefined, 'au-delà de 500 kg : refusé (cleanPrescKg)');
    run(`deskPgPatch(__e, 'rest', '5')`);
    assert.equal(run('__e.rest'), 10, 'repos de 10 à 600 s');
    run(`deskPgPatch(__e, 'rest', '')`);
    assert.equal(run('__e.rest'), undefined, 'Par défaut : le repos de l\'élève');
    // Technique et « sur quelle série » (intensFieldsFor, publiée le 24/11)
    run(`deskPgPatch(__l, 'where', [1])`);
    assert.equal(J([run('__l.intens'), run('__l.intensOn')]), J(['drop-last', { plan: 'drop-last', sets: [1] }]), 'première série en drop set');
    run(`deskPgPatch(__l, 'where', deskPgToggleSet([1], 3, 3))`);
    assert.equal(run('intensText(__l)'), 'Séries 1 et 3 en drop set');
    run(`deskPgPatch(__l, 'where', [1, 2, 3])`);
    assert.equal(J([run('__l.intens'), run('__l.intensOn')]), J(['drop-all', undefined]), 'toutes : la forme que comprend une version d\'avant');
    run(`deskPgPatch(__l, 'tech', 'cluster')`);
    assert.equal(run('__l.intens'), 'cluster-all');
    assert.equal(J(run('deskPgToggleSet("last", 3, 3)')), J([3]), 'jamais aucune série : la dernière reste');
    run(`deskPgPatch(__l, 'tech', '')`);
    assert.equal(run('__l.intens'), undefined);
    run(`deskPgPatch(__l, 'consigne', '   ' + 'x'.repeat(600))`);
    assert.equal(run('__l.consigne.length'), 500, 'consigne : 500 caractères (cleanConsigne)');
    run(`deskPgPatch(__l, 'sets', '1')`);
    assert.equal(run('deskPgMove(__d.sessions[0], __l._k, -1)'), 1);
    assert.equal(run('__d.sessions[0].exercises[0].name'), 'Élévations latérales');
    assert.equal(run('deskPgMove(__d.sessions[0], __l._k, -1)'), null);
    const nx = run(`deskPgNewExercise('  Squat ')`);
    assert.equal(J([nx.name, nx.sets, nx.repMin, nx.repMax]), J(['Squat', 3, 8, 12]), 'valeurs de l\'app à l\'ajout');
    assert.equal(run(`deskPgNewExercise('   ')`), null);
  });

  test('coach web v4 : programme envoyé au format exact de l\'app (sans divergence)', () => {
    const v = run(`deskPgPayload(deskPgDraft(cleanSentProgramme(${J(SENT)})), 'u_seche4')`);
    assert.ok(v.ok);
    assert.equal(J(v.data), J(run(`cleanSentProgramme(${J(SENT)})`)), 'brouillon pas touché : exactement ce que l\'élève a reçu, sans clé d\'écran');
    assert.ok(!J(v.data).includes('_k'));
    assert.equal(run(`deskPgPayload(deskPgDraft(cleanSentProgramme(${J(SENT)})), 'id invalide !')`).kind, 'server');
    const big = { name: 'Gros', sessions: Array.from({ length: 20 }, (_, i) => ({ key: 's' + i, label: 'S', exercises: Array.from({ length: 40 }, () => ({ name: 'x'.repeat(80), sets: 3, consigne: 'y'.repeat(500) })) })) };
    assert.equal(run(`deskPgPayload(deskPgDraft(cleanSentProgramme(${J(big)})), 'u_gros')`).kind, 'too_big', '200 Ko au plus, comme l\'app');
    // Mon programme lu sur mon compte : programmeToSent de l'app, mêmes champs que l'écran Envoyer
    const doc = { myProgrammes: ['u_seche4', 'u_recu', 'custom'], userProgrammes: { u_seche4: { name: 'Sèche 4 jours', sessions: { 'haut-a': { label: 'Haut A', color: '#FF9F0A' } }, order: ['haut-a'] },
      u_recu: { name: 'Reçu', sessions: {}, fromCoach: { coachId: 'x' } } },
    programmes: { u_seche4: { exercises: { 'haut-a': [{ id: 'dc', name: 'Développé couché', sets: 4, repMin: 6, repMax: 8, intens: 'topback', rest: 150, consigne: '2 reps en réserve' }] } } } };
    const mine = run(`deskSendableProgs(deskDocClean(${J(doc)}))`);
    assert.equal(J(mine.map(p => p.id)), J(['u_seche4']), 'ni « Perso », ni un programme reçu d\'un coach (coachSendableProgrammes)');
    assert.equal(J(mine[0].data), J(run(`cleanSentProgramme(programmeToSent(${J(doc)}, 'u_seche4'))`)));
    assert.equal(run(`deskDocClean(null)`), null);
  });

  test('coach web v4 : envoi à plusieurs, chacun garde SES charges prescrites', () => {
    const draft = run(`deskPgDraft(cleanSentProgramme(${J(SENT)}))`);
    const theirs = { name: 'x', sessions: [{ key: 'haut-a', label: 'Haut A', exercises: [{ name: 'developpe couche', sets: 3, loads: [60, 55, 55] }] }] };
    const o = run(`deskPgForOther(${J(draft)}, ${J(theirs)})`);
    assert.equal(J(o.sessions[0].exercises[0].loads), J([60, 55, 55]), 'même exercice (nom comparé comme l\'app), sa charge à lui');
    assert.equal(o.sessions[0].exercises[0].repMin, 6, 'reps, séries, technique : celles du coach');
    assert.equal(run(`hasPrescLoad(${J(o.sessions[0].exercises[1])})`), false, 'exercice qu\'il n\'avait pas : aucune charge');
    assert.equal(run(`hasPrescLoad(deskPgForOther(${J(draft)}, null).sessions[0].exercises[0])`), false);
  });

  test('coach web v4 : envoi à plusieurs, file de l\'app (4 à la fois, arrêt à la limite des 24 h)', async () => {
    const r = await run(`coachSendQueue(['a', 'b', 'c', 'd', 'e', 'f', 'g'], async uid => (uid === 'c' ? { ok: false, kind: 'send_rate' } : uid === 'b' ? { ok: false, kind: 'offline' } : { ok: true }), { workers: 1 })`);
    assert.equal(J([r.sent, r.failed.map(f => f.kind), r.rate, r.left]), J([['a'], ['offline', 'send_rate'], true, 4]));
    let n = 0;
    const all = await run(`(f => coachSendQueue(['a', 'b', 'c'], async () => ({ ok: true }), { onStep: f }))`)(() => { n++; });
    assert.equal(J([all.sent.length, n]), J([3, 3]));
  });

  test('coach web v4 : « La dernière fois » face à la fourchette', () => {
    const rows = [{ id: 's2', doneAt: T(5), s: { exercises: [{ name: 'Développé couché', sets: [{ weight: '20', reps: '15', warmup: true }, { weight: '45', reps: '7' }, { weight: '40', reps: '9' }, { weight: '40', reps: '9' }, { weight: '40', reps: '8' }] }] } },
      { id: 's1', doneAt: T(12), s: { exercises: [{ name: 'Squat', sets: [{ weight: '80', reps: '8' }, { weight: '80', reps: '8' }] }] } }];
    const dc = run(`deskPgLast(${J(rows)}, { name: 'developpé couché', sets: 4, repMin: 6, repMax: 8 })`);
    assert.equal(dc.text, '45 × 7 · 40 × 9, 9, 8', 'échauffement exclu, charges regroupées');
    assert.equal(J([dc.status, dc.word]), J(['in', 'Dans la fourchette']), 'comme la maquette : 7, 9, 9, 8 pour 6 à 8');
    assert.equal(run(`deskPgLast(${J(rows)}, { name: 'Squat', sets: 2, repMin: 6, repMax: 8 })`).word, 'Haut de fourchette : monter');
    assert.equal(run(`deskPgLast(${J(rows)}, { name: 'Squat', sets: 2, repMin: 8, repMax: 10 })`).word, 'Dans la fourchette');
    assert.equal(run(`deskPgLast(${J(rows)}, { name: 'Squat', sets: 2, repMin: 10, repMax: 12 })`).word, 'Sous la fourchette');
    assert.equal(run(`deskPgLast(${J(rows)}, { name: 'Squat', sets: 2, repMax: 8, repFixed: true })`).word, 'Reps atteintes : monter');
    assert.equal(run(`deskPgLast(${J(rows)}, { name: 'Gainage', sets: 3, measure: 'time' })`), null);
    assert.equal(run(`deskPgLast(${J(rows)}, { name: 'Dips', sets: 3, repMax: 12 })`), null);
  });

  // ── Nutrition ──
  const day = (k, kcal, ok = 4, o = {}) => ({ day: run(`localISO(${T(k, 12)})`), plan: 'diet_seche', name: 'Sèche', kind: 't', kcal, p: 120, c: 180, f: 55,
    meals: ['Petit-déjeuner', 'Déjeuner', 'Collation', 'Dîner'].map((n, i) => ({ n, ok: i < ok })), goal: { kcal: 1800, p: 120, c: 180, f: 60 }, water: 2100, waterGoal: 2500, salt: 5.8, saltMax: 6, ...o });

  test('coach web v4 : semaine du lundi, statuts de l\'app, jours à venir', () => {
    const diet = { shared: true, days: Object.fromEntries([day(1, 1800), day(2, 2300, 2), day(0, 900, 1)].map(x => [x.day, x])) };
    const w = run(`deskNtWeek(${J(diet)}, 0, ${NOW})`);
    assert.equal(J(w.map(x => x.dow)), J(['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.']));
    assert.equal(J(w.map(x => x.status)), J(['ok', 'today', 'future', 'future', 'future', 'future', 'future']), 'lundi suivi, mardi en cours, la suite à venir');
    const prev = run(`deskNtWeek(${J(diet)}, 1, ${NOW})`);
    assert.equal(prev[6].status, 'off', 'dimanche d\'avant : 2 300 kcal pour 1 800, pas suivi (dietShareStatus)');
    assert.equal(prev[6].num, 22);
    assert.equal(run(`deskNtWeekText(${J(prev)})`), '1 pas suivi');
    assert.equal(run(`deskNtWeekText(deskNtWeek({ days: {} }, 3, ${NOW}))`), 'Rien de noté cette semaine');
  });

  test('coach web v4 : repas du jour avec les aliments du plan, chiffres face à l\'objectif, moyennes', () => {
    const plan = run(`cleanSentDiet({ kind: 'diet', v: 1, diet: { name: 'Sèche', targets: { kcal: 1800, water: 2.5 }, meals: [
      { id: 'm1', name: 'Petit-déjeuner', items: [{ id: 'a1', name: 'Flocons d\\'avoine', g: 60, per: { k: 370, p: 13, c: 60, f: 7 } }] },
      { id: 'm2', name: 'dejeuner', items: [{ id: 'a2', name: 'Riz', g: 80, per: { k: 350, p: 8, c: 77, f: 1 } }] }] } })`);
    const x = day(1, 1610, 3);
    const meals = run(`deskNtMeals(${J(x)}, ${J(plan)})`);
    assert.equal(meals.length, 4);
    assert.equal(J([meals[0].items.replace(/ /g, ' '), meals[0].kcal]), J(['Flocons d\'avoine 60 g', 222]));
    assert.equal(meals[1].kcal, 280, 'nom comparé sans accents ni capitales');
    assert.equal(J([meals[2].items, meals[3].ok]), J(['', false]), 'repas hors du plan envoyé : sans aliments');
    const mac = run(`deskNtMacros(${J(x)})`);
    assert.equal(J(mac[0]), J({ key: 'kcal', label: 'Calories', unit: 'kcal', v: 1610, goal: 1800, pct: 89 }));
    assert.equal(run(`dietShareGap(${J(x)})`), -11);
    const av = run(`deskNtAverages(${J([{ x }, { x: day(2, 1790) }, { x: null }])})`);
    assert.equal(J([av.n, av.kcal, av.goalKcal, av.gap, av.water, av.waterGoal, av.salt]), J([2, 1700, 1800, -6, 2.1, 2.5, 5.8]));
    assert.equal(run(`deskNtAverages([{ x: null }])`), null);
    assert.equal(run(`deskNtPlanLine(${J(plan)})`).replace(/ | /g, ' '), '1 800 kcal par jour · eau 2,5 L');
    const two = run(`cleanSentDiet({ kind: 'diet', v: 1, diet: { name: 'Cycle', targets: { kcal: 2300 }, days: { mode: 'session', more: [{ targets: { kcal: 2000 }, meals: [{ id: 'r1', name: 'Repos', items: [] }] }] },
      meals: [{ id: 'm1', name: 'Séance', items: [{ id: 'a', name: 'Riz', g: 80, per: { k: 350, p: 8, c: 77, f: 1 } }] }] } })`);
    assert.equal(run(`deskNtPlanLine(${J(two)})`).replace(/ | /g, ' '), 'Entraînement 2 300 kcal · repos 2 000 kcal');
    assert.equal(run(`deskNtPlanDay(${J(two)}, { kind: 'r' }, ${NOW}).meals[0].name`), 'Repos', 'jour de repos : le jour 2 du plan');
  });

  test('coach web v4 : plan diète envoyé par la règle de l\'app (coachDietPayload), mes plans seulement', () => {
    const doc = run(`deskDocClean({ dietPlans: { d_seche: { name: 'Sèche', meals: [{ id: 'm1', name: 'Midi', items: [{ id: 'a', name: 'Riz', g: 80, per: { k: 350, p: 8, c: 77, f: 1 } }] }] },
      d_vide: { name: 'Vide', meals: [{ id: 'm1', name: 'Midi', items: [] }] }, dc_x_recu: { name: 'Reçu', meals: [], fromCoach: { coachId: 'x' } } } })`);
    assert.equal(J(run(`coachSendableDiets(${J(doc)})`)), J(['d_seche']));
    const v = run(`coachDietPayload(${J(doc)}, 'd_seche')`);
    assert.equal(J([v.ok, v.progId, v.data.kind, v.data.v]), J([true, 'diet_seche', 'diet', 1]));
    assert.equal(run(`coachDietPayload(${J(doc)}, 'd_vide')`).kind, 'empty_diet');
    assert.equal(run(`coachDietPayload(${J(doc)}, 'dc_x_recu')`).kind, 'server');
  });

  test('coach web v4 : textes reçus échappés dans le fil', () => {
    run(`globalThis.view = {}; view.dash = { rows: [{ id: 'lea', name: '<b>lea</b>', st: { last_session: null }, phase: null, n7: 0 }], threads: null };
      chat.convs.lea = { rows: [{ id: 1, mine: false, body: '<img src=x onerror=alert(1)>', at: ${T(0, 9)} }], cursor: 1, end: true, loading: false, error: null, loadedAt: 1, sending: false };
      ms.extra.lea = { sessions: [{ id: 's1', doneAt: ${T(0, 8)}, s: { label: '<i>x</i>' }, note: '"><script>' }], checkins: [] };`);
    const h = run(`deskThreadHtml('lea')`);
    assert.ok(!/<img|<script|<i>x|<b>lea/.test(h), 'aucun texte reçu interprété');
    assert.match(h, /&lt;img src=x/);
  });

  test('coach web v4 : les trois écrans se dessinent avec les fonctions chargées par la page', () => {
    run(`globalThis.deskRoute = () => ({ name: 'student', id: 'lea', tab: 'programme', part: null }); globalThis.view = { dash: { rows: [{ id: 'lea', name: 'lea', st: { last_session: null, sent: [] }, phase: { text: 'Sèche' }, n7: 2, dietShared: true, dietOk7: 5 }],
      state: { students: [{ user_id: 'lea', username: 'lea' }] }, threads: { students: {} } }, student: { id: 'lea', sessions: [], now: ${NOW}, weeks: [], diet: { shared: true, days: {} } } };`);
    run(`Object.assign(pg, { id: 'lea', loading: false, kind: null, list: [{ id: 'u_s', data: cleanSentProgramme(${J(SENT)}), sentAt: ${T(3)}, seen: true }] }); deskPgUse(pg.list[0]); pg.open = pg.draft.sessions[0].exercises[0]._k;`);
    const p = run(`deskPgHtml(view.dash.rows[0])`);
    assert.match(p, /Top set/);
    assert.match(p, /Sur quelle série|Technique d'intensification/);
    assert.match(p, /vu par lea/);
    run(`Object.assign(nt, { id: 'lea', loading: false, kind: null, diets: [] })`);
    assert.match(run(`deskNtHtml(view.dash.rows[0], view.student)`), /nt-day/);
    assert.match(run(`deskNtHtml(view.dash.rows[0], { ...view.student, diet: { shared: false, days: {} } })`), /ne partage pas/);
    assert.match(run(`deskMessagesHtml({ name: 'messages', id: null })`), /Choisis une conversation/);
  });
}
