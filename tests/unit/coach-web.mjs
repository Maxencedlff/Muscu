// ═══════════════════════════════════════════════════════════
//  Appli web du coach (coach-web/, docs/COACH_WEB.md) : scripts partagés chargés tels quels (liste et ordre
//  d'index.html de l'app, sans js/data/account.js), aucune écriture sur l'appareil, même projet Supabase que l'app,
//  logique pure du tableau de bord et de la fiche Semaines, lectures du serveur (un appel, ou repli une par une),
//  textes reçus échappés.
//  Contexte vm séparé de run.mjs : exactement les scripts de coach-web/index.html (main.js excepté : démarrage DOM).
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}

export default function ({ test, assert, ROOT }) {
  const html = fs.readFileSync(path.join(ROOT, 'coach-web/index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const files = srcs.map(s => path.normalize(path.join('coach-web', s)));
  const appOrder = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

  // Contexte : les scripts de la page, dans son ordre, main.js excepté
  const storage = new MemoryStorage(), session = new MemoryStorage();
  const sandbox = { console, setTimeout, clearTimeout, Intl, atob, btoa, TextEncoder, TextDecoder, crypto: globalThis.crypto,
    localStorage: storage, sessionStorage: session, navigator: {}, addEventListener() {},
    document: { querySelector: () => null, getElementById: () => null, addEventListener() {} } };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files.filter(f => !f.endsWith('main.js'))) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const run = code => vm.runInContext(code, ctx);
  const J = o => JSON.stringify(o);
  // Mardi 24 novembre 2026, 15 h (heure locale) ; T(k, h) : il y a k jours du calendrier, à h heures
  const NOW = run('new Date(2026, 10, 24, 15).getTime()');
  const T = (k, h = 18) => run(`new Date(2026, 10, 24 - ${k}, ${h}).getTime()`);
  const iso = k => run(`localISO(${T(k, 12)})`);

  test('coach web : scripts partagés tels quels, dans l\'ordre de l\'app, sans account.js', () => {
    const shared = srcs.filter(s => s.startsWith('../')).map(s => s.slice(3));
    assert.ok(shared.length >= 30, 'la logique de js/data/ est reprise, pas recopiée');
    for (const s of shared) assert.ok(appOrder.includes(s), `${s} n'est pas chargé par l'app`);
    const pos = shared.map(s => appOrder.indexOf(s));
    assert.deepEqual(pos, [...pos].sort((a, b) => a - b), 'même ordre que index.html de l\'app');
    assert.ok(!shared.includes('js/data/account.js') && !shared.includes('js/data/sync.js'), 'ni synchro ni Trousseau sur un ordinateur');
    assert.ok(srcs.indexOf('js/desk/env.js') < srcs.indexOf('../js/data/social.js'), 'env.js avant le premier onAccountChange');
    for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} absent`);
    assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'aucun script en ligne (CSP script-src self)');
    assert.match(html, /script-src 'self' https:\/\/appleid\.cdn-apple\.com;/, 'seul ajout : le script de Sign in with Apple JS');
    assert.match(html, /frame-src 'none'/);
    assert.match(html, /connect-src 'self' https:\/\/yopptmdjtnezmccdvaxf\.supabase\.co https:\/\/world\.openfoodfacts\.org;/, 'plus Open Food Facts, pour un code-barres saisi (plans diète)');
  });

  test('coach web : même projet Supabase et même clé publique que l\'app', () => {
    const acc = fs.readFileSync(path.join(ROOT, 'js/data/account.js'), 'utf8');
    const url = /url: '([^']+)'/.exec(acc)[1], key = /publishableKey: '([^']+)'/.exec(acc)[1];
    assert.equal(run('DESK_CONFIG.url'), url);
    assert.equal(run('DESK_CONFIG.publishableKey'), key);
    assert.match(key, /^sb_publishable_/, 'clé publique seulement, jamais la clé serveur');
  });

  test('coach web : chargement sans rien écrire sur l\'appareil, écouteurs de l\'app inertes', () => {
    assert.equal(storage.length, 0);
    assert.equal(session.length, 0);
    assert.equal(run('account.user'), null);
    assert.ok(run('Object.isFrozen(account)'));
    // Les relectures de l'app (coachRefresh, coachShareRefresh) ne partent jamais : pas de compte au sens de l'app
    assert.equal(run('coachRpc.length >= 1 && typeof coachRefresh'), 'function');
  });

  test('coach web : semaines du lundi, numéro ISO, plages de dates', () => {
    const ws = run(`deskWeekStart(${NOW})`);
    const d = run(`(() => { const d = new Date(${ws}); return [d.getDay(), d.getHours(), d.getMinutes(), d.getDate()]; })()`);
    assert.equal(J(d), J([1, 0, 0, 23]));
    assert.equal(run(`deskIsoWeek(${NOW})`), 48);
    assert.equal(run('deskIsoWeek(new Date(2027, 0, 1, 12).getTime())'), 53, 'le 1er janvier 2027 est en S53 de 2026');
    assert.equal(run('deskIsoWeek(new Date(2026, 0, 1, 12).getTime())'), 1);
    assert.equal(run(`deskWeekRange(${ws})`), '23–29 nov.');
    assert.equal(run('deskWeekRange(new Date(2026, 9, 26).getTime())'), '26 oct.–1 nov.');
    assert.equal(run('deskWeekRange(new Date(2026, 11, 28).getTime())'), '28 déc. 2026–3 janv. 2027');
    assert.equal(run(`deskAgo(${NOW - 54 * 60_000}, ${NOW})`), 'il y a 54 min');
    assert.equal(run(`deskAgo(${T(1, 21)} + 40 * 60000, ${NOW})`), 'hier, 21 h 40');
    assert.equal(run(`deskAgo(${T(9)}, ${NOW})`), 'dim. 15 nov.');
  });

  // Données d'un coach : élèves dans coach_state, faits de coach_progress, phases, messages, diète
  const student = (id, o = {}) => ({ user_id: id, username: id, since: '2026-08-01T10:00:00Z', sessions_7d: 0, new_sessions: 0, sent: [{ id: 'p1', sent_at: '2026-10-01T10:00:00Z', seen: true }], last_session: null, ...o });
  const facts = days => ({ student_id: '', sessions: days.map(k => ({ at: T(k), records: [] })), first_at: T(60), last_record_at: null, unnoted_at: null });
  const dash = () => {
    const st = { is_coach: true, students: [
      student('karim', { last_session: { done_at: T(9), label: 'Push' } }),
      student('lea', { last_session: { done_at: T(1), label: 'Push' }, new_sessions: 1 }),
      student('hugo', { last_session: { done_at: T(2), label: 'Push' }, sent: [] }),
      student('nina', { last_session: { done_at: T(0), label: 'Push' } }),
      student('ines', { last_session: { done_at: T(1), label: 'Push' } }),
    ], invites: [] };
    const progress = { students: [{ ...facts([9, 12]), student_id: 'karim' }, { ...facts([1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26]), student_id: 'lea' },
      { ...facts([2]), student_id: 'hugo' }, { ...facts([0, 2]), student_id: 'nina' }, { ...facts([1, 3]), student_id: 'ines' }] };
    const plans = { students: [{ student_id: 'lea', phases: [{ id: 1, goal: 'cut', start: iso(29), weeks: 8 }] }, { student_id: 'nina', phases: [] }] };
    const threads = { students: [{ student_id: 'lea', unread: 2 }] };
    const day = (k, kcal) => [iso(k), kcal, 1800, kcal === 1800 ? 4 : 1, 4, 130, 120];
    const diet = { students: [{ student_id: 'ines', since: '2026-10-01T00:00:00Z', days: [day(1, 2600), day(2, 2700), day(3, 2650), day(4, 1800)] },
      { student_id: 'nina', since: '2026-10-01T00:00:00Z', days: [day(0, 1800), day(1, 1800), day(2, 1800), day(3, 1800)] }] };
    return run(`(() => { const now = ${NOW}; return deskStudentRows({ state: cleanCoachState(${J(st)}), facts: cleanCoachProgress(${J(progress)}, now),
      plans: cleanCoachPlans(${J(plans)}), threads: cleanChatThreads(${J(threads)}), dietOv: cleanDietOverview(${J(diet)}), now }); })()`);
  };

  test('coach web : élèves à traiter en tête, du plus urgent (séance manquée, diète, messages, sans programme)', () => {
    const rows = dash();
    assert.equal(J(rows.map(r => r.id)), J(['karim', 'ines', 'lea', 'hugo', 'nina']), 'diète avant les messages');
    assert.equal(J(rows.map(r => r.act)), J([true, true, true, true, false]));
    assert.equal(rows[0].todo[0].text, '9 jours sans séance');
    assert.ok(rows[2].todo.some(t => t.kind === 'unread' && t.n === 2 && t.text === 'messages non lus'));
    assert.ok(rows[1].dietWarn && rows[1].todo.some(t => t.text === 'Diète pas suivie 3 jours'));
    assert.equal(rows[3].todo[0].text, 'Sans programme');
    assert.equal(rows[2].phase.text, 'Sèche · sem. 5 sur 8');
    assert.equal(rows.find(r => r.id === 'nina').phase.text, 'Aucune phase');
    assert.equal(rows.find(r => r.id === 'hugo').phase.text, 'Aucune phase', 'absent de coach_plans : aucune phase');
    const bare = run(`deskStudentRows({ state: cleanCoachState({ is_coach: true, students: [${J(student('lea'))}] }), now: ${NOW} })`);
    assert.equal(bare[0].phase, null, 'serveur sans planification : rien d\'inventé');
    assert.equal(bare[0].sesDots, null);
    assert.equal(bare[0].dietShared, null);
  });

  test('coach web : pastilles des 7 derniers jours, séances et diète partagée', () => {
    const rows = dash();
    const nina = rows.find(r => r.id === 'nina'), hugo = rows.find(r => r.id === 'hugo');
    assert.equal(J(nina.sesDots.map(d => d.n)), J([0, 0, 0, 0, 1, 0, 1]), 'du plus ancien à aujourd\'hui');
    assert.equal(nina.dietDots.length, 7);
    assert.equal(J(nina.dietDots.slice(3).map(d => d.status)), J(['ok', 'ok', 'ok', 'ok']));
    assert.equal(nina.dietDots[0].status, 'none');
    assert.equal(hugo.dietDots, null, 'diète non partagée');
    assert.equal(hugo.dietShared, false);
  });

  test('coach web : segments avec compteurs exacts, recherche sans accents', () => {
    const rows = dash();
    const c = run(`deskFilterCounts(${J(rows)})`);
    assert.equal(J(c), J({ todo: 4, all: 5, warn: 2, fresh: 1, noprog: 1 }));
    assert.equal(J(run(`deskSearch(${J(rows)}, 'IN').map(r => r.id)`)), J(['ines']));
    assert.equal(run(`deskSearch(${J(rows)}, 'Inès').length`), 1);
    assert.equal(run(`deskSearch(${J(rows)}, '').length`), 5);
    assert.equal(J(run(`deskTeamSummary(${J(rows)})`)), J({ unread: 2, sessions: 8, records: 0, warn: 2 }));
    assert.equal(run('deskCodeText("K7MP4QXR9ABC")'), 'K7MP 4QXR 9ABC');
  });

  // Fiche Semaines : séances (lignes de coach_student_sessions), pesées, mensurations, diète
  const sess = (id, k, kg, recs = []) => ({ id, done_at: T(k), s: { date: T(k), label: 'Push', exercises: [{ name: 'Squat', measure: 'reps',
    sets: [{ weight: String(kg), reps: '10' }, { weight: String(kg), reps: '10', warmup: true }] }], records: recs } });
  const weeksOf = (o = {}) => run(`(() => { const now = ${NOW};
    const sessions = ${J(o.sessions || [])}.map(cleanCoachSessionRow).filter(Boolean);
    return deskWeeks({ sessions, weights: cleanCoachWeights(${J(o.weights || { shared: false })}), measures: cleanCoachMeasures(${J(o.measures || { shared: false })}),
      diet: ${o.diet ? `cleanCoachDiet(${J(o.diet)})` : 'null'}, phases: ${o.phases ? `cleanCoachPlans(${J({ students: [{ student_id: 'x', phases: o.phases }] })}).x` : 'null'}, now, count: 4 }); })()`);

  test('coach web : semaines, séances, volume sans échauffement, records un par exercice', () => {
    const rec = (ex, after) => ({ ex, kind: 'charge', before: after - 5, after });
    const w = weeksOf({ sessions: [sess('a', 0, 100, [rec('Squat', 100)]), sess('b', 1, 90, [rec('squat', 90)]), sess('c', 3, 80), sess('d', 20, 50)] });
    assert.equal(J(w.map(x => x.sessions)), J([2, 1, 0, 1]), 'lundi 23 et mardi 24 en S48, samedi 21 en S47');
    assert.equal(w[0].volume, 1900, '100 × 10 + 90 × 10, échauffement exclu');
    assert.equal(w[0].records, 1, 'Squat et squat : un seul record');
    assert.equal(J(w.map(x => x.week)), J([48, 47, 46, 45]));
    assert.ok(w[0].current && !w[1].current);
  });

  test('coach web : poids moyen par semaine et écart avec la semaine pesée d\'avant ; diète, eau, mensurations', () => {
    const weights = { shared: true, since: '2026-09-01T00:00:00Z', weights: [{ date: T(0, 7), kg: 61.8 }, { date: T(1, 7), kg: 62.0 }, { date: T(16, 7), kg: 62.6 }] };
    const dd = (k, kcal, water) => ({ day: iso(k), kcal, p: 130, c: 200, f: 60, goal: { kcal: 1800, p: 120, c: 200, f: 60 }, meals: [], water });
    const diet = { shared: true, since: '2026-09-01T00:00:00Z', days: [dd(2, 1800, 2000), dd(3, 2600, 3000), dd(4, 1790, 0)] };
    const measures = { shared: true, since: '2026-09-01T00:00:00Z', measures: { waist: [{ date: T(3, 8), cm: 68.5 }, { date: T(20, 8), cm: 70 }] } };
    const w = weeksOf({ weights, diet, measures, phases: [{ id: 1, goal: 'cut', start: iso(29), weeks: 8 }] });
    assert.equal(J(w[0].weight), J({ avg: 61.9, n: 2, delta: -0.7 }), 'S48 : moyenne 61,9 ; S47 sans pesée : comparée à S46');
    assert.equal(w[1].weight, null);
    assert.equal(J(w[1].diet), J({ ok: 2, noted: 3, kcal: 2063 }));
    assert.equal(w[1].water, 2.5, 'moyenne des jours où l\'eau est notée');
    assert.equal(w[0].diet.noted, 0);
    assert.equal(J(w[1].measures), J({ waist: 68.5 }));
    assert.equal(w[0].phase, 'Sèche 5/8');
    assert.equal(J(run(`deskMeasureColumns(cleanCoachMeasures(${J(measures)}))`)), J(['waist']));
    const nope = weeksOf({});
    assert.ok(nope.every(x => x.weight === null && x.diet === null && x.water === null), 'rien de partagé : rien d\'inventé');
  });

  test('coach web : courbe du poids, bornes et description pour le lecteur d\'écran', () => {
    assert.equal(run(`deskWeightChart(cleanCoachWeights({ shared: true, weights: [{ date: ${T(1)}, kg: 60 }] }), ${NOW})`), null, 'une pesée : pas de courbe');
    assert.equal(run(`deskWeightChart(cleanCoachWeights({ shared: false }), ${NOW})`), null);
    const c = run(`deskWeightChart(cleanCoachWeights({ shared: true, weights: [{ date: ${T(200)}, kg: 70 }, { date: ${T(30)}, kg: 63.2 }, { date: ${T(10)}, kg: 62.5 }, { date: ${T(1)}, kg: 61.8 }] }), ${NOW})`);
    assert.equal(c.n, 3, 'au-delà de 90 jours : écartée');
    assert.ok(c.points.every(p => p.x >= 4 && p.x <= c.right && p.y >= 8 && p.y <= c.h - 22));
    assert.equal(c.delta, -1.4);
    assert.match(c.desc, /^Poids du \d+ oct\. au 23 nov\. : de 63,2 à 61,8 kg, 3 pesées$/);
  });

  // Faux client Supabase : réponses par fonction, appels notés
  const fakeSb = (answers) => run(`(() => { const calls = []; desk.user = { id: 'coach' };
    sb = { rpc: async (fn, args) => { calls.push([fn, args || null]); const a = (${answers})[fn]; return typeof a === 'function' ? a(args) : a || { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }; } };
    return calls; })()`);

  test('coach web : fiche en un appel (coach_student_weeks), ou repli une lecture à la fois sur un serveur d\'avant', async () => {
    const one = sess('a', 1, 80);
    let calls = fakeSb(`{ coach_student_weeks: { data: { weeks: 12, sessions: [${J(one)}, { id: '' }], weights: { shared: true, weights: [{ date: ${T(1)}, kg: 62 }] }, measures: { shared: false }, diet: null }, error: null } }`);
    let r = await run(`deskLoadWeeks('lea', 12, ${NOW})`);
    assert.equal(r.ok, true);
    assert.equal(r.data.via, 'weeks');
    assert.equal(r.data.sessions.length, 1, 'ligne invalide écartée');
    assert.equal(r.data.diet, null, 'serveur sans le suivi de la diète');
    assert.equal(calls.length, 1);
    // Serveur d'avant : pesées, mensurations, diète et séances page par page jusqu'au début de la fenêtre
    const page1 = Array.from({ length: 30 }, (_, i) => sess('p' + i, Math.floor(i / 2), 80));
    const page2 = [sess('q1', 70, 80), sess('q2', 120, 80)];
    calls = fakeSb(`{ coach_student_weights: { data: { shared: false }, error: null }, coach_student_measures: { data: { shared: false }, error: null },
      coach_student_diet: { data: { shared: true, since: '2026-09-01T00:00:00Z', days: [] }, error: null },
      coach_student_sessions: a => ({ data: a.before_at ? ${J(page2)} : ${J(page1)}, error: null }) }`);
    r = await run(`deskLoadWeeks('lea', 12, ${NOW})`);
    assert.equal(r.data.via, 'pages');
    assert.equal(r.data.sessions.length, 31, '30 de la première page, 1 de la seconde dans la fenêtre');
    const pages = calls.filter(c => c[0] === 'coach_student_sessions');
    assert.equal(pages.length, 2, 'arrêt dès la première séance hors fenêtre');
    assert.equal(pages[1][1].before_id, 'p29');
    assert.equal(r.data.diet.shared, true);
    // Refus du serveur : remonté tel quel
    fakeSb(`{ coach_student_weeks: { data: null, error: { code: 'P0001', message: 'not_found' } } }`);
    r = await run(`deskLoadWeeks('lea', 12, ${NOW})`);
    assert.equal(J(r), J({ ok: false, kind: 'not_found' }));
    fakeSb(`{ coach_student_weeks: { data: null, error: { message: 'TypeError: Failed to fetch' } } }`);
    assert.equal((await run(`deskLoadWeeks('lea', 12, ${NOW})`)).kind, 'offline');
  });

  test('coach web : tableau de bord, seul coach_state est obligatoire ; palier annoncé verrou allumé seulement', async () => {
    fakeSb(`{ coach_state: { data: { is_coach: true, students: [${J(student('lea'))}], invites: [] }, error: null },
      coach_my_code: { data: { code: 'K7MP4QXR9ABC' }, error: null }, coach_tier_state: { data: { is_coach: true, paywall_on: false, limit: 50, students: 1 }, error: null } }`);
    const r = await run(`deskLoadDashboard(${NOW})`);
    assert.equal(r.ok, true);
    assert.equal(J([r.data.facts, r.data.threads, r.data.plans, r.data.dietOv, r.data.tier, r.data.form]), J([null, null, null, null, null, null]));
    assert.equal(r.data.code, 'K7MP4QXR9ABC');
    assert.equal(J(run('deskTier({ is_coach: true, paywall_on: true, limit: 25, students: 10 })')), J({ limit: 25, students: 10, free: 15 }));
    fakeSb(`{ coach_state: { data: null, error: { message: 'Failed to fetch' } } }`);
    assert.equal((await run(`deskLoadDashboard(${NOW})`)).kind, 'offline');
    run('desk.user = null; sb = null');
    assert.equal((await run('deskRpc("coach_state")')).kind, 'signed_out');
  });

  test('coach web : textes reçus échappés, onglets de la fiche', () => {
    const rows = run(`deskStudentRows({ state: cleanCoachState({ is_coach: true, students: [${J(student('lea'))}] }), now: ${NOW} })`);
    rows[0].name = '<img src=x onerror=alert(1)>';
    const h = run(`deskDashboardHtml({ rows: ${J(rows)}, now: ${NOW}, code: 'K7MP4QXR', codeExpires: null, tier: null, form: 'elle', plans: null }, { filter: 'all', query: '' })`);
    assert.doesNotMatch(h, /<img src=x/);
    assert.match(h, /&lt;img src=x/);
    const q = run(`deskDashboardHtml({ rows: ${J(rows)}, now: ${NOW}, code: null, tier: null, form: null, plans: null }, { filter: 'todo', query: '<b>x' })`);
    assert.match(q, /« &lt;b&gt;x »/);
    assert.doesNotMatch(q, /<b>x/);
    assert.match(h, /Rejoindre une coach/, 'accord de la forme du coach (coachWord)');
    const s = run(`deskStudentHtml({ row: ${J(rows[0])}, loading: true }, { weeks: 8 })`);
    assert.equal((s.match(/aria-disabled="true"/g) || []).length, 0, 'vague 4 : les cinq onglets sont ouverts');
    assert.equal((s.match(/role="tab"/g) || []).length, 5);
    assert.doesNotMatch(s, /bientôt/);
    assert.match(s, /role="status"/);
  });

  test('coach web, Apple : nonce brut pour Supabase, son SHA-256 (hex) pour Apple, neuf à chaque essai', async () => {
    const a = await run('deskAppleNonce()'), b = await run('deskAppleNonce()');
    assert.match(a.raw, /^[A-Za-z0-9_-]{43}$/, '32 octets en base64url');
    assert.equal(a.hashed, createHash('sha256').update(a.raw).digest('hex'));
    assert.match(a.hashed, /^[0-9a-f]{64}$/);
    assert.match(a.state, /^[A-Za-z0-9_-]{22}$/);
    assert.notEqual(a.raw, b.raw);
    assert.notEqual(a.state, b.state);
  });

  test('coach web, Apple : erreurs d\'Apple et de Supabase en messages clairs', () => {
    assert.equal(run("deskAppleErrorKind({ error: 'popup_closed_by_user' })"), 'apple_cancel');
    assert.equal(run("deskAppleErrorKind({ error: 'user_cancelled_authorize' })"), 'apple_cancel');
    assert.equal(run("deskAppleErrorKind({ error: 'popup_blocked_by_browser' })"), 'apple_blocked');
    assert.equal(run("deskAppleErrorKind({ error: 'user_trigger_new_signin_flow' })"), null);
    assert.equal(run("deskAppleErrorKind({ status: 400, message: 'Unacceptable audience in id_token: [com.mdlf.training.coach]' })"), 'apple_config');
    assert.equal(run("deskAppleErrorKind({ code: 'provider_disabled', message: 'Provider is not enabled' })"), 'apple_config');
    assert.equal(run("deskAppleErrorKind(new TypeError('Failed to fetch'))"), 'offline');
    for (const k of ['apple_cancel', 'apple_blocked', 'apple_config']) assert.ok(run(`DESK_APPLE_TEXT.${k}`).includes('.'));
  });

  test('coach web, Apple : signIn tout de suite, jeton échangé avec le nonce brut, state vérifié, essai suivant préparé', async () => {
    run(`globalThis.location = { origin: 'https://mdlf-coach.vercel.app' };
      globalThis.__idt = []; globalThis.__init = [];
      globalThis.__appleAnswer = st => ({ authorization: { id_token: 'jeton.factice.' + st, state: st, code: 'c' } });
      globalThis.AppleID = { auth: { init: o => __init.push(o), signIn: () => Promise.resolve(__appleAnswer(__init[__init.length - 1].state)) } };
      sb = { auth: { signInWithIdToken: async a => { __idt.push(a); return { data: { user: { id: 'u1', created_at: new Date(${NOW} - 86400000).toISOString() } }, error: null }; } } };
      desk.user = null;`);
    await run('deskApplePrepare()');
    assert.equal(run('deskApple.state'), 'ready');
    const init = run('__init[0]');
    assert.equal(init.clientId, 'com.mdlf.training.coach');
    assert.equal(init.redirectURI, 'https://mdlf-coach.vercel.app/');
    assert.equal(init.usePopup, true);
    assert.equal(init.nonce, run('deskApple.pending.hashed'));
    const raw = run('deskApple.pending.raw');
    const r = await run(`deskAppleSignIn(() => ${NOW})`);
    assert.equal(r.ok, true);
    assert.equal(r.isNew, false, 'compte d\'avant : pas « nouveau »');
    const idt = run('__idt[0]');
    assert.equal(idt.provider, 'apple');
    assert.equal(idt.nonce, raw, 'Supabase reçoit le nonce brut');
    assert.equal(createHash('sha256').update(idt.nonce).digest('hex'), init.nonce, 'Apple a reçu son SHA-256');
    await new Promise(res => setTimeout(res, 10));
    assert.equal(run('__init.length'), 2, 'nonce neuf pour l\'essai suivant');
    assert.notEqual(run('__init[1].nonce'), init.nonce);
    // Réponse dont le state ne correspond pas : refusée, aucun échange
    run("__appleAnswer = () => ({ authorization: { id_token: 'x', state: 'autre' } })");
    assert.equal((await run('deskAppleSignIn()')).ok, false);
    assert.equal(run('__idt.length'), 1);
    await new Promise(res => setTimeout(res, 10));
    // Annulation : message clair
    run("AppleID.auth.signIn = () => Promise.reject({ error: 'popup_closed_by_user' })");
    assert.equal((await run('deskAppleSignIn()')).kind, 'apple_cancel');
    await new Promise(res => setTimeout(res, 10));
    // Services ID pas dans external_apple_client_id
    run(`AppleID.auth.signIn = () => Promise.resolve({ authorization: { id_token: 'jeton.factice', state: __init[__init.length - 1].state } });
      sb.auth.signInWithIdToken = async () => ({ data: {}, error: { status: 400, message: 'Unacceptable audience in id_token' } })`);
    await new Promise(res => setTimeout(res, 10));
    assert.equal((await run('deskAppleSignIn()')).kind, 'apple_config');
    run('sb = null; desk.user = null; delete globalThis.AppleID');
  });
}
