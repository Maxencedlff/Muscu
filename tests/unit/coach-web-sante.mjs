// ═══════════════════════════════════════════════════════════
//  Appli web du coach, vague 3 (docs/COACH_WEB.md, « Vague 3 : pas, sommeil, cardio ») : moyennes de la semaine
//  (deskHealthWeek), textes des cases, colonnes seulement avec le partage, phrase sans partage, rien sur un serveur
//  d'avant, lecture en un appel ou par coach_student_health dans le repli, cleanCoachHealth, textes échappés.
//  Contexte vm séparé de run.mjs : exactement les scripts de coach-web/index.html (main.js excepté : démarrage DOM).
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
  const sp = t => String(t).replace(/[\u202f\u00a0]/g, ' ');
  // Mardi 24 novembre 2026, 15 h (heure locale) : semaine en cours du lundi 23 au dimanche 29
  const NOW = run('new Date(2026, 10, 24, 15).getTime()');
  const iso = k => run(`localISO(new Date(2026, 10, 24 - ${k}, 12).getTime())`);
  const week = k => Array.from({ length: 7 }, (_, j) => run(`localISO(deskDayStart(deskWeekStart(${NOW}), ${-7 * k + j}))`));
  const H = days => run(`cleanCoachHealth(${J({ shared: true, since: '2026-10-01T08:00:00Z', days })})`);

  test('coach web, santé : cleanCoachHealth des scripts de la page (bornes, jours vides, doublons, ordre)', () => {
    assert.equal(run('typeof cleanCoachHealth'), 'function', 'js/data/coach-share.js chargé par la page');
    const h = H([{ day: iso(3), steps: 8000, sleep: 420, cardio: 30 }, { day: iso(1), steps: 100001, sleep: 1441, cardio: -1 },
      { day: iso(2), steps: 9000.5, sleep: '420', cardio: null }, { day: iso(3), steps: 1 }, { day: '2026-11-31x', steps: 5 },
      { day: iso(0), steps: 0, sleep: 1440, cardio: 0, extra: 'x' }]);
    assert.equal(h.shared, true);
    assert.equal(J(h.days), J([{ day: iso(0), steps: 0, sleep: 1440, cardio: 0 }, { day: iso(3), steps: 8000, sleep: 420, cardio: 30 }]),
      'hors bornes et non entiers écartés, jour sans valeur écarté, premier doublon gardé, du plus récent, clés inconnues ignorées');
    const off = run(`cleanCoachHealth({ shared: false, since: null, days: [{ day: '${iso(1)}', steps: 5 }] })`);
    assert.equal(J(off), J({ shared: false, since: null, days: [] }));
    assert.equal(run('cleanCoachHealth(null).shared'), false);
  });

  test('coach web, santé : moyennes de la semaine sur les jours qui ont une valeur, nombre de jours comptés', () => {
    const w = week(1);   // S47 : lundi 16 au dimanche 22
    const h = H([{ day: w[0], steps: 8000, sleep: 420, cardio: 30 }, { day: w[1], steps: 9001, sleep: 425 }, { day: w[2], sleep: 430 },
      { day: w[3], cardio: 15 }, { day: week(2)[6], steps: 50000, sleep: 60, cardio: 200 }, { day: week(0)[0], steps: 1 }]);
    const r = run(`deskHealthWeek(${J(h)}, ${J(w)})`);
    assert.equal(J(r.steps), J({ avg: 8501, n: 2 }), '(8000 + 9001) / 2 = 8500,5 → 8501, jours sans pas pas comptés');
    assert.equal(J(r.sleep), J({ avg: 425, n: 3 }));
    assert.equal(J(r.cardio), J({ avg: 23, n: 2, sum: 45 }), '22,5 → 23, total de la semaine 45 (audit m4)');
    // Bornes : dimanche de la semaine d'avant et lundi suivant jamais comptés
    assert.equal(J(run(`deskHealthWeek(${J(H([{ day: week(2)[6], steps: 5 }, { day: week(0)[0], steps: 7 }]))}, ${J(w)})`)), J({ steps: null, sleep: null, cardio: null }));
    // Sans partage, serveur d'avant : null
    assert.equal(run(`deskHealthWeek(cleanCoachHealth({ shared: false }), ${J(w)})`), null);
    assert.equal(run(`deskHealthWeek(null, ${J(w)})`), null);
  });

  test('coach web, santé : deskWeeks, semaine en cours (jours passés seulement) et semaines sans relevé', () => {
    const h = H([{ day: iso(0), steps: 4000, sleep: 380 }, { day: iso(1), steps: 10000, sleep: 455, cardio: 40 }, { day: iso(2), steps: 7000 }]);
    const ws = run(`deskWeeks({ health: ${J(h)}, now: ${NOW}, count: 12 })`);
    assert.equal(ws[0].current, true);
    assert.equal(J(ws[0].health), J({ steps: { avg: 7000, n: 2 }, sleep: { avg: 418, n: 2 }, cardio: { avg: 40, n: 1, sum: 40 } }), 'lundi et mardi seulement');
    assert.equal(J(ws[1].health), J({ steps: { avg: 7000, n: 1 }, sleep: null, cardio: null }), 'dimanche 22 : semaine d\'avant');
    assert.equal(J(ws[5].health), J({ steps: null, sleep: null, cardio: null }));
    assert.equal(run(`deskWeeks({ now: ${NOW}, count: 2 })`)[0].health, null, 'serveur sans la vague 3 : null');
  });

  test('coach web, santé : textes des cases (« 7 h 05 », « 25 min/j ») et nombre de jours pour les lecteurs d\'écran', () => {
    assert.equal(run('deskSleepText(425)'), '7 h 05');
    assert.equal(run('deskSleepText(480)'), '8 h 00');
    assert.equal(run('deskSleepText(45)'), '45 min');
    assert.equal(run('deskSleepText(0)'), '0 min');
    const s = run('deskHealthCell("steps", { avg: 8412, n: 5 })');
    assert.equal(sp(s.text), '8 412');
    assert.equal(s.title, 'Moyenne sur 5 jours');
    assert.equal(s.sr, 'pas par jour, moyenne sur 5 jours');
    assert.equal(J(run('deskHealthCell("sleep", { avg: 425, n: 1 })')), J({ text: '7 h 05', sr: 'de sommeil par nuit, moyenne sur 1 nuit', title: 'Moyenne sur 1 nuit' }));
    assert.equal(run('deskHealthCell("cardio", { avg: 25, n: 3 })').text, '25 min/j');
    // Dernier jour reçu depuis plus de 2 jours (audit m7)
    const NOWT = new Date(2026, 10, 25, 10).getTime();
    assert.equal(run(`deskHealthStale({ shared: true, days: [{ day: '2026-11-23', steps: 1 }] }, ${NOWT})`), null, 'avant-hier : rien');
    assert.equal(run(`deskHealthStale({ shared: true, days: [{ day: '2026-11-22', steps: 1 }] }, ${NOWT})`), new Date(2026, 10, 22, 12).getTime());
    assert.equal(run(`deskHealthStale({ shared: false, days: [] }, ${NOWT})`), null);
    assert.equal(run(`deskHealthStale({ shared: true, days: [] }, ${NOWT})`), null);
    const ct = run('deskHealthCell("cardio", { avg: 25, n: 3, sum: 75 })');
    assert.equal(ct.small, '75 min en tout');
    assert.ok(ct.sr.endsWith('75 min en tout'), 'total lu par les lecteurs d\'écran');
    assert.equal(run('deskHealthCell("cardio", null)'), null);
  });

  // Fiche : ligne d'élève, données du serveur nettoyées comme dans main.js
  const fiche = (health, name = 'lea') => {
    const rows = run(`deskStudentRows({ state: cleanCoachState({ is_coach: true, students: [{ user_id: 'lea', username: 'lea', since: '2026-09-01T00:00:00Z', sessions_7d: 0, new_sessions: 0, sent: [], last_session: null }] }), now: ${NOW} })`);
    rows[0].name = name;   // pseudo tel que reçu (un pseudo invalide devient « Compte masqué » : on force le texte)
    const weeks = run(`deskWeeks({ health: ${J(health)}, now: ${NOW}, count: 12 })`);
    return run(`deskStudentHtml(${J({ row: rows[0], now: NOW, weeks, weights: null, measures: null, diet: null, health, checkins: null, chart: null })}, { weeks: 8 })`);
  };

  test('coach web, santé : colonnes seulement si l\'élève partage, « — » sans valeur, phrase sans partage, rien sans la fonction', () => {
    const h = H([{ day: iso(1), steps: 8412, sleep: 425, cardio: 25 }]);
    const on = fiche(h);
    for (const [t, u] of [['Pas', 'par jour'], ['Sommeil', 'par nuit'], ['Cardio', 'par jour']]) assert.ok(on.includes(`<th scope="col">${t}<small>${u}</small></th>`), t);
    assert.match(sp(on), /<td title="Moyenne sur 1 jour">8 412<span class="sr"> pas par jour, moyenne sur 1 jour<\/span><\/td>/);
    assert.match(on, /<td title="Moyenne sur 1 nuit">7 h 05/);
    assert.match(on, /25 min\/j/);
    assert.ok((on.match(/aria-label="Pas de donnée"/g) || []).length >= 7 * 3, 'semaines sans relevé : « — »');
    assert.doesNotMatch(on, /ne partage pas ses pas/);
    const off = fiche(run('cleanCoachHealth({ shared: false })'));
    assert.doesNotMatch(off, /<th scope="col">(?:Pas|Sommeil|Cardio)</);
    assert.match(off, /lea ne partage pas ses pas, son sommeil ni son cardio \(réglage dans l'app iPhone : Partager avec mon coach\)\./);
    const none = fiche(null);
    assert.doesNotMatch(none, /<th scope="col">(?:Pas|Sommeil|Cardio)<|ne partage pas ses pas/, 'serveur sans coach_student_health : rien');
    assert.equal(J(run('deskHealthColumns(null)')), '[]');
    assert.equal(J(run('deskHealthColumns({ shared: "true" })')), '[]', 'shared === true seulement');
  });

  test('coach web, santé : prénom reçu échappé dans la phrase', () => {
    const off = fiche(run('cleanCoachHealth({ shared: false })'), '<img src=x onerror=alert(1)>');
    assert.doesNotMatch(off, /<img src=x/);
    assert.match(off, /&lt;img src=x onerror=alert\(1\)&gt; ne partage pas ses pas/);
  });

  // Faux client Supabase : réponses par fonction, appels notés ; fonction inconnue = PGRST202 (serveur d'avant)
  const fakeSb = answers => run(`(() => { const calls = []; desk.user = { id: 'coach' };
    sb = { rpc: async (fn, args) => { calls.push(fn); const a = (${answers})[fn]; return typeof a === 'function' ? a(args) : a || { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }; } };
    return calls; })()`);
  const raw = J({ shared: true, since: '2026-10-01T08:00:00Z', days: [{ day: '2026-11-23', steps: 9000, sleep: 430 }, { day: '2026-11-22', cardio: 2000 }] });

  test('coach web, santé : health lu en un appel (coach_student_weeks), ou par coach_student_health dans le repli', async () => {
    let calls = fakeSb(`{ coach_student_weeks: { data: { weeks: 12, sessions: [], weights: null, measures: null, diet: null, health: ${raw} }, error: null } }`);
    let r = await run(`deskLoadWeeks('lea', 12, ${NOW})`);
    assert.equal(r.data.via, 'weeks');
    assert.equal(J(r.data.health.days), J([{ day: '2026-11-23', steps: 9000, sleep: 430, cardio: null }]), 'nettoyé par cleanCoachHealth');
    assert.equal(J(calls), J(['coach_student_weeks']), 'un seul appel');
    // coach_student_weeks d'avant la vague 3 : pas de clé health
    fakeSb('{ coach_student_weeks: { data: { weeks: 12, sessions: [] }, error: null } }');
    assert.equal((await run(`deskLoadWeeks('lea', 12, ${NOW})`)).data.health, null);
    // Repli page par page : coach_student_health lu aussi
    const empty = '{ data: { shared: false }, error: null }';
    calls = fakeSb(`{ coach_student_weights: ${empty}, coach_student_measures: ${empty}, coach_student_diet: ${empty},
      coach_student_sessions: { data: [], error: null }, coach_student_health: { data: ${raw}, error: null } }`);
    r = await run(`deskLoadWeeks('lea', 12, ${NOW})`);
    assert.equal(r.data.via, 'pages');
    assert.ok(calls.includes('coach_student_health'));
    assert.equal(r.data.health.shared, true);
    // Repli sans la fonction (PGRST202) ou refus : null, rien ne casse
    fakeSb(`{ coach_student_weights: ${empty}, coach_student_measures: ${empty}, coach_student_diet: ${empty}, coach_student_sessions: { data: [], error: null } }`);
    r = await run(`deskLoadWeeks('lea', 12, ${NOW})`);
    assert.equal(r.ok, true);
    assert.equal(r.data.health, null);
    fakeSb(`{ coach_student_weights: ${empty}, coach_student_measures: ${empty}, coach_student_diet: ${empty}, coach_student_sessions: { data: [], error: null },
      coach_student_health: { data: null, error: { message: 'TypeError: Failed to fetch' } } }`);
    r = await run(`deskLoadWeeks('lea', 12, ${NOW})`);
    assert.equal(r.ok, true);
    assert.equal(r.data.health, null);
    run('sb = null; desk.user = null');
    assert.equal(store.size, 0, 'rien écrit sur l\'appareil');
  });
}
