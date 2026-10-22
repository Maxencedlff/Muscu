// ═══════════════════════════════════════════════════════════
//  Tests unitaires de la logique pure (sans navigateur)
//  Lancer depuis la racine du dépôt : node tests/unit/run.mjs
// ═══════════════════════════════════════════════════════════
//
// Les scripts de l'app sont des scripts classiques qui partagent la portée globale : on les
// charge dans l'ordre de index.html, dans un même contexte vm, avec un window, un document et
// un localStorage réduits au minimum. Les fonctions déclarées deviennent des propriétés du
// contexte ; les variables let/const (data, KEY…) se lisent et s'écrivent avec run().

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Scripts nécessaires, dans l'ordre de chargement de index.html
const SCRIPTS = [
  'js/platform/native.js',
  'js/core/util.js',
  'js/data/programmes.js',
  'js/data/store.js',
  'js/data/records.js',
  'js/data/accessors.js',
  'js/data/backup.js',
  'js/data/trash.js',
  'js/data/muscles.js',
  'js/data/muscle-load.js',
  'js/data/app-icons.js',
  'js/ui/forms.js',
  'js/ui/body-map.js',
  'js/ui/medal.js',
  'js/app/actions.js',
  'js/features/rest-activity.js',
  'js/features/apple-services.js',
  'js/app/live-update.js',
  'js/features/share-stats.js',
  'js/features/share-canvas.js',
  'js/features/dashboard.js',
];

// ── Environnement simulé ────────────────────────────────────

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const toasts = [];
const sandbox = {
  console,
  AbortController, setTimeout, clearTimeout,   // vérification des mises à jour à chaud
  localStorage: new MemoryStorage(),
  navigator: {},
  document: { querySelector: () => null, getElementById: () => null },
  // Seule dépendance hors donnée : le toast « Stockage plein » de save() (js/core/dialogs.js)
  showToast: (msg, opts = {}) => { toasts.push({ msg, ...opts }); },
};
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
for (const file of SCRIPTS) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}

const run = code => vm.runInContext(code, ctx);
const app = ctx;

// Les objets du contexte viennent d'un autre « realm » : on compare leur JSON
const sameJSON = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

function reset({ unit = 'kg' } = {}) {
  ctx.localStorage.clear();
  toasts.length = 0;
  run('data = makeDefaultData(); data.schema = SCHEMA; dataBroken = false;');
  run(`data.unit = ${JSON.stringify(unit)};`);
}

// ── Mini-exécuteur ──────────────────────────────────────────

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// Espace fine insécable des milliers (fr-FR) et espace insécable
const NNBSP = ' ';
const NBSP  = ' ';

// ── Formats : nombres et charges ────────────────────────────

test('fmtNum : virgule décimale, milliers, entrée texte', () => {
  assert.equal(app.fmtNum(32.5), '32,5');
  assert.equal(app.fmtNum('32.5'), '32,5');
  assert.equal(app.fmtNum('32,5'), '32,5');
  assert.equal(app.fmtNum(1234.5), `1${NNBSP}234,5`);
  assert.equal(app.fmtNum(1.23456), '1,23');
  assert.equal(app.fmtNum(12.345, 1), '12,3');
  assert.equal(app.fmtNum(''), '');
  assert.equal(app.fmtNum('abc'), '');
  assert.equal(app.fmtNum(null), '');
});

test('toUnitW : kg arrondi au centième, lbs au dixième, vide → null', () => {
  reset();
  assert.equal(app.toUnitW('32.5'), 32.5);
  assert.equal(app.toUnitW(32.456), 32.46);
  assert.equal(app.toUnitW(''), null);
  assert.equal(app.toUnitW(null), null);
  assert.equal(app.toUnitW(undefined), null);
  assert.equal(app.toUnitW('abc'), null);
  assert.equal(app.toUnitW(0), 0);
  reset({ unit: 'lbs' });
  assert.equal(app.toUnitW(100), 220.5);
  assert.equal(app.toUnitW('20'), 44.1);
});

test('fmtW : texte à la française, sans unité', () => {
  reset();
  assert.equal(app.fmtW('32.5'), '32,5');
  assert.equal(app.fmtW(80), '80');
  assert.equal(app.fmtW(1000), `1${NNBSP}000`);
  assert.equal(app.fmtW(''), '');
  assert.equal(app.fmtW(null), '');
  reset({ unit: 'lbs' });
  assert.equal(app.fmtW(100), '220,5');
  assert.equal(app.fmtW(500), `1${NNBSP}102,3`);
});

test('fmtW plain : valeur de champ, virgule sans séparateur de milliers', () => {
  reset();
  assert.equal(app.fmtW('32.5', { plain: true }), '32,5');
  assert.equal(app.fmtW(1000, { plain: true }), '1000');
  assert.equal(app.fmtW('', { plain: true }), '');
  reset({ unit: 'lbs' });
  assert.equal(app.fmtW(500, { plain: true }), '1102,3');
  // Relue telle quelle par la validation de saisie
  assert.equal(app.num(app.fmtW(500, { plain: true }), 0, 3000), 1102.3);
});

test('storeW : saisie dans l\'unité affichée → kg stocké, aller-retour exact', () => {
  reset();
  assert.equal(app.storeW('32,5'), '32.5');
  assert.equal(app.storeW(''), '');
  assert.equal(app.storeW('abc'), '');
  reset({ unit: 'lbs' });
  for (const lbs of ['45', '135', '102.5', '1102,3']) {
    assert.equal(app.fmtW(app.storeW(lbs), { plain: true }), lbs.replace('.', ','), `aller-retour ${lbs} lbs`);
  }
});

test('fmtVolume : kg, tonnes, lbs, milliers de lbs', () => {
  reset();
  assert.equal(app.fmtVolume(0), '0 kg');
  assert.equal(app.fmtVolume(850.4), '850 kg');
  assert.equal(app.fmtVolume(12400), '12,4 t');
  reset({ unit: 'lbs' });
  assert.equal(app.fmtVolume(0), '0 lbs');
  assert.equal(app.fmtVolume(100), '220 lbs');
  assert.equal(app.fmtVolume(10000), '22 k lbs');
});

test('setTxt / bestSet : meilleure série affichée', () => {
  reset();
  const b = app.bestSet([{ weight: '30', reps: '10' }, { weight: '32.5', reps: '8' }, { weight: '32.5', reps: '6' }, { weight: '40', reps: '0' }]);
  assert.equal(b.w, 32.5);
  assert.equal(b.r, 8);
  assert.equal(app.setTxt(b), '32,5 kg × 8');
  assert.equal(app.setTxt(app.bestSet([{ weight: '', reps: '12' }])), '12 reps');
  assert.equal(app.setTxt(null), '');
  assert.equal(app.bestSet([]), null);
});

// ── Accueil : cibles du jour, semaine, objectif ─────────────

function seedPull(sets, extra = {}) {
  run(`data.activeProgramme = 'ppl';
    data.programmes.ppl.exercises.pull = [{ id: 'row', name: 'Rowing', sets: 3, ...${JSON.stringify(extra)} }];
    data.history = [{ id: 'h1', programme: 'ppl', category: 'pull', date: Date.now() - 86400000, duration: 3000000,
      exercises: [{ exId: 'row', name: 'Rowing', sets: ${JSON.stringify(sets)} }] }];`);
  return run("data.programmes.ppl.exercises.pull[0]");
}

test('exerciseTarget : +1 rep sous le haut de la fourchette, palier de charge au-dessus', () => {
  reset();
  let ex = seedPull([{ weight: '30', reps: '10' }, { weight: '32', reps: '9' }, { weight: '32', reps: '8' }]);
  sameJSON(app.exerciseTarget('pull', ex), { text: '32 kg × 10', gain: '+1 rep' });
  ex = seedPull([{ weight: '32', reps: '12' }, { weight: '32', reps: '12' }, { weight: '32', reps: '12' }]);
  sameJSON(app.exerciseTarget('pull', ex), { text: '34,5 kg', gain: '+2,5 kg' });
  ex = seedPull([{ weight: '32', reps: '8' }, { weight: '32', reps: '8' }], { repMax: 8 });
  sameJSON(app.exerciseTarget('pull', ex), { text: '34,5 kg', gain: '+2,5 kg' }, 'fourchette réglée sur l\'exercice');
  ex = seedPull([{ weight: '', reps: '15' }]);
  sameJSON(app.exerciseTarget('pull', ex), { text: '16 reps', gain: '+1 rep' }, 'poids du corps : jamais de palier de charge');
  run('data.history = []');
  sameJSON(app.exerciseTarget('pull', ex), { text: '3 séries', gain: '' }, 'jamais fait');
});

test('exerciseTarget en lbs : palier de 5 lb', () => {
  reset({ unit: 'lbs' });
  const ex = seedPull([{ weight: '20', reps: '12' }, { weight: '20', reps: '12' }]);
  const t = app.exerciseTarget('pull', ex);
  assert.equal(t.gain, '+5 lb');
  assert.equal(t.text, '49,1 lbs');
});

test('weekStats : séances et volume depuis lundi, moyenne des 4 semaines d\'avant', () => {
  reset();
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
  run(`data.history = [
    { id: 'a', programme: 'ppl', category: 'push', date: ${monday} + 3600000, exercises: [{ name: 'X', sets: [{ weight: '100', reps: '10' }] }] },
    { id: 'b', programme: 'ppl', category: 'pull', date: ${monday} - 3 * 86400000, exercises: [{ name: 'X', sets: [{ weight: '100', reps: '20' }] }] },
    { id: 'c', programme: 'ppl', category: 'legs', date: ${monday} - 40 * 86400000, exercises: [{ name: 'X', sets: [{ weight: '100', reps: '99' }] }] }];`);
  const ws = app.weekStats();
  assert.equal(ws.count, 1);
  assert.equal(ws.volume, 1000);
  assert.equal(ws.days[0].length, 1, 'séance du lundi dans la première colonne');
  assert.equal(ws.avgVolume, 500, '2 000 kg sur les 4 semaines précédentes, la séance de -40 j exclue');
});

test('weeklyGoal : séances du programme par défaut, réglage borné par sanitizeData', () => {
  reset();
  run("data.activeProgramme = 'ppl'");
  assert.equal(app.weeklyGoal(), 3);
  run('data.weeklyGoal = 5');
  assert.equal(app.weeklyGoal(), 5);
  const d = app.sanitizeData({ ...run('data'), weeklyGoal: 12 });
  assert.equal(d.weeklyGoal, undefined, 'hors bornes : retour à l\'automatique');
  assert.equal(app.sanitizeData({ ...run('data'), weeklyGoal: '4' }).weeklyGoal, 4);
});

test('sessionMinutes : médiane des dernières séances, sinon 2,5 min par série', () => {
  reset();
  seedPull([{ weight: '30', reps: '10' }]);
  assert.equal(app.sessionMinutes('pull'), 50);
  run('data.history = []');
  assert.equal(app.sessionMinutes('pull'), 10, '3 séries × 2,5 min arrondi à 5');
});

// ── Formats : durées et dates ───────────────────────────────

test('fmtClock : chrono de séance', () => {
  assert.equal(app.fmtClock(0), '0:00');
  assert.equal(app.fmtClock(12_000), '0:12');
  assert.equal(app.fmtClock(42 * 60_000 + 7_000), '42:07');
  assert.equal(app.fmtClock(3_727_000), '1:02:07');
  assert.equal(app.fmtClock(999), '0:00');
  assert.equal(app.fmtClock(-5_000), '0:00');
  assert.equal(app.fmtClock(undefined), '0:00');
});

test('fmtRest : repos en secondes, minutes au-delà d\'une heure', () => {
  assert.equal(app.fmtRest(90), '1:30');
  assert.equal(app.fmtRest(45), '0:45');
  assert.equal(app.fmtRest(44.6), '0:45');
  assert.equal(app.fmtRest(0), '0:00');
  assert.equal(app.fmtRest(-10), '0:00');
  assert.equal(app.fmtRest(NaN), '0:00');
  assert.equal(app.fmtRest(4500), '75:00');
});

test('fmtDuration : durée en toutes lettres', () => {
  assert.equal(app.fmtDuration(42 * 60_000), `42${NBSP}min`);
  assert.equal(app.fmtDuration(69 * 60_000), `1${NBSP}h${NBSP}09`);
  assert.equal(app.fmtDuration(59_999), `0${NBSP}min`);
  assert.equal(app.fmtDuration(-1), `0${NBSP}min`);
});

test('fmtDate : relatif par défaut, styles nommés', () => {
  const now = new Date();
  assert.equal(app.fmtDate(Date.now()), 'Aujourd\'hui');
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).getTime();
  assert.equal(app.fmtDate(yesterday), 'Hier');
  const old = new Date(2025, 9, 9, 14, 5).getTime(); // jeudi 9 octobre 2025
  assert.equal(app.fmtDate(old), now.getFullYear() === 2025 ? 'jeu. 9 oct.' : 'jeu. 9 oct. 2025');
  assert.equal(app.fmtDate(old, 'long'), 'jeudi 9 octobre 2025');
  assert.equal(app.fmtDate(old, 'day'), 'jeudi 9 octobre');
  assert.equal(app.fmtDate(old, 'short'), '9 oct.');
  assert.equal(app.fmtDate(old, 'month'), 'octobre 2025');
  assert.equal(app.fmtDate(new Date(old), 'month'), 'octobre 2025', 'accepte un objet Date');
  assert.equal(app.fmtTime(old), '14:05');
  assert.equal(app.localISO(old), '2025-10-09');
});

// ── 1RM ─────────────────────────────────────────────────────

test('calc1RM : formule d\'Epley arrondie au dixième, bornes', () => {
  assert.equal(app.calc1RM(100, 1), 103.3);
  assert.equal(app.calc1RM('100', '10'), 133.3);
  assert.equal(app.calc1RM('32.5', '8'), 41.2);
  assert.equal(app.calc1RM(100, 12), 140);
  assert.equal(app.calc1RM(100, 13), null, 'au-delà de 12 reps : pas d\'estimation');
  assert.equal(app.calc1RM(0, 5), null);
  assert.equal(app.calc1RM('', 5), null);
  assert.equal(app.calc1RM(100, 0), null);
});

test('recomputePRFromHistory : record, 1RM et dernière série', () => {
  reset();
  const d = run('data');
  const ex = d.programmes.ppl.exercises.push[0];
  d.history = [
    { id: 'h2', date: 2000, programme: 'ppl', category: 'push', exercises: [{ exId: ex.id, name: ex.name, sets: [{ weight: '30', reps: '10' }] }] },
    { id: 'h1', date: 1000, programme: 'ppl', category: 'push', exercises: [{ exId: ex.id, name: ex.name, sets: [{ weight: '32.5', reps: '6' }] }] },
  ];
  app.recomputePRFromHistory(d);
  sameJSON(ex.pr, { weight: '32.5', reps: '6' });
  assert.equal(ex.est1RM, 40);
  assert.equal(ex.lastWeight, '30', 'dernière série = séance la plus récente');
  assert.equal(ex.lastReps, '10');
});

// ── Saisie ──────────────────────────────────────────────────

test('num : virgule, bornes, entiers, vide', () => {
  assert.equal(app.num('32,5', 0, 100), 32.5);
  assert.equal(app.num(' 12 ', 0, 100), 12);
  assert.equal(app.num('', 0, 100), null);
  assert.equal(app.num(null, 0, 100), null);
  assert.equal(app.num('abc', 0, 100), null);
  assert.equal(app.num('101', 0, 100), null);
  assert.equal(app.num('-1', 0, 100), null);
  assert.equal(app.num('8.5', 0, 100, true), null);
  assert.equal(app.num('8', 0, 100, true), 8);
  assert.equal(app.num('Infinity', 0, Infinity), null);
});

test('weightOk : vide accepté (poids du corps), plafond 1000 kg / 2205 lbs', () => {
  reset();
  assert.equal(app.weightOk(''), true);
  assert.equal(app.weightOk('  '), true);
  assert.equal(app.weightOk('32,5'), true);
  assert.equal(app.weightOk('1000'), true);
  assert.equal(app.weightOk('1000,5'), false);
  assert.equal(app.weightOk('-1'), false);
  assert.equal(app.weightOk('abc'), false);
  assert.equal(app.weightMsg(), 'Poids entre 0 et 1000 kg');
  reset({ unit: 'lbs' });
  assert.equal(app.weightOk('2205'), true);
  assert.equal(app.weightOk('2205,5'), false);
  assert.equal(app.weightMsg(), 'Poids entre 0 et 2205 lbs');
});

// ── Nettoyage et migrations ─────────────────────────────────

// Donnée de schéma 2 (avant les exId), avec des valeurs abîmées
function legacyData() {
  return {
    activeProgramme: 'ppl',
    programmes: {
      ppl: {
        exercises: { push: [{ id: 'e1', name: 'Développé couché', sets: '4' }, { name: '' }, 'abc'], pull: 'abc' },
        timers: { push: 'x', pull: 1000 },
      },
      broken: 42,
    },
    defaultRest: '9999',
    unit: 'stone',
    history: [
      { date: '1700000000000', category: 'push', exercises: [{ name: 'developpe  COUCHE', sets: [{ weight: '80', reps: '8' }, { weight: 'abc', reps: '5' }, { reps: 'x' }] }] },
      { date: 1700100000000, category: 'push', exercises: [{ name: 'Inconnu', sets: [{ weight: 10, reps: 12 }] }] },
      { date: 'pas une date', category: 'push', exercises: [] },
      null,
    ],
  };
}

test('sanitizeData : retire ce qui ferait planter, garde le reste', () => {
  const d = app.sanitizeData(legacyData());
  sameJSON(Object.keys(d.programmes), ['ppl']);
  const push = d.programmes.ppl.exercises.push;
  assert.equal(push.length, 1);
  assert.equal(push[0].sets, 4);
  sameJSON(d.programmes.ppl.exercises.pull, []);
  assert.equal(d.programmes.ppl.timers.push, null);
  assert.equal(d.programmes.ppl.timers.pull, 1000);
  sameJSON(d.programmes.ppl.cooldowns, {});
  assert.equal(d.defaultRest, 90);
  assert.equal(d.unit, 'kg');
  assert.equal(d.history.length, 2, 'séance sans date lisible et entrée nulle retirées');
  assert.equal(d.history[0].date, 1700000000000, 'date texte convertie');
  sameJSON(d.history[0].exercises[0].sets, [{ weight: '80', reps: '8' }, { weight: '', reps: '5' }]);
  assert.equal(d.history[1].exercises[0].sets[0].reps, '12');
  assert.ok(d.history.every(h => typeof h.id === 'string' && h.id));
});

test('normalizeData : migration vers le schéma 3 (exId) et sauvegarde ppl_v2_backup', () => {
  reset();
  const raw = JSON.stringify(legacyData());
  const d = app.normalizeData(JSON.parse(raw), raw);
  assert.equal(d.schema, 3);
  assert.equal(ctx.localStorage.getItem('ppl_v2_backup'), raw, 'texte d\'origine sauvegardé tel quel');
  assert.equal(d.history[0].date > d.history[1].date, true, 'historique trié du plus récent au plus ancien');
  const byName = Object.fromEntries(d.history.map(h => [h.exercises[0].name, h.exercises[0].exId]));
  assert.equal(byName['developpe  COUCHE'], 'e1', 'rattaché à l\'exercice du programme par nom normalisé');
  assert.equal(byName['Inconnu'], 'n:inconnu');
  assert.equal(d.soundOn, true);
  assert.equal(d.vibrateOn, true);
  sameJSON(d.userProgrammes, {});
  sameJSON(d.programmes.ppl.exercises.push[0].pr, { weight: '80', reps: '8' }, 'records recalculés');
});

test('normalizeData + sanitizeData : idempotents', () => {
  reset();
  const once  = app.sanitizeData(app.normalizeData(legacyData()));
  const first = JSON.stringify(once);
  const twice = app.sanitizeData(app.normalizeData(JSON.parse(first)));
  assert.equal(JSON.stringify(twice), first);
  const fresh = JSON.stringify(run('data'));
  assert.equal(JSON.stringify(app.sanitizeData(app.normalizeData(JSON.parse(fresh)))), fresh, 'donnée neuve inchangée');
});

test('loadData : migration depuis ppl_v1', () => {
  reset();
  ctx.localStorage.setItem('ppl_v1', JSON.stringify({
    exercises: { push: [{ id: 'e1', name: 'Dips', sets: 3 }] },
    defaultRest: 120,
    history: [{ id: 'h1', date: 1700000000000, category: 'push', exercises: [{ name: 'Dips', sets: [{ weight: '', reps: '10' }] }] }],
  }));
  const d = app.loadData();
  assert.equal(d.schema, 3);
  assert.equal(d.defaultRest, 120);
  assert.equal(d.history[0].programme, 'ppl');
  assert.equal(d.history[0].exercises[0].exId, 'e1');
  sameJSON(d.programmes.ppl.timers, { push: null, pull: null, legs: null });
});

test('loadData : stockage vide → donnée par défaut, stockage illisible → exception', () => {
  reset();
  const d = app.loadData();
  assert.equal(d.schema, 3);
  assert.equal(d.activeProgramme, 'ppl');
  assert.equal(d.programmes.ppl.exercises.push.length, 6);
  ctx.localStorage.setItem('ppl_v2', '{pas du json');
  assert.throws(() => app.loadData());
});

// ── Import ──────────────────────────────────────────────────

test('importText : fichier invalide refusé sans rien modifier', () => {
  reset();
  run('data.history.push({ id: "h1", date: 1, category: "push", exercises: [] }); save();');
  const before = ctx.localStorage.getItem('ppl_v2');
  for (const text of ['pas du json', 'null', '42', '{"foo":1}', JSON.stringify({ programmes: {}, activeProgramme: 'ppl', history: [{ date: 'x' }] })]) {
    sameJSON(app.importText(text), { ok: false, reason: 'invalid' }, text);
  }
  assert.equal(toasts.length, 0, 'aucun effet d\'écran');
  assert.equal(ctx.localStorage.getItem('ppl_v2'), before);
  assert.equal(run('data.history.length'), 1);
});

test('sanitizeData : champs facultatifs d\'exercice bornés (audit 18/10 : XSS par repMax)', () => {
  const d = app.sanitizeData({ programmes: { ppl: { exercises: { push: [
    { name: 'A', sets: 3, repMax: '12"><img src=x onerror=alert(1)>', rest: '9999', target: 'abc',
      muscles: ['chest', 'chest', '<b>', 42, 'x'.repeat(5000), ...Array(40).fill('triceps')] },
    { name: 'B', sets: 3, repMax: '15', rest: '120', target: '82.5', muscles: 'chest' },
  ] } } }, history: [] });
  const [a, b] = d.programmes.ppl.exercises.push;
  assert.equal(a.repMax, undefined, 'repMax invalide retiré');
  assert.equal(a.rest, null, 'repos hors bornes : repos par défaut');
  assert.equal(a.target, null);
  sameJSON(a.muscles, ['chest', 'triceps'], 'muscles dédoublonnés, identifiants seulement');
  assert.equal(b.repMax, 15);
  assert.equal(b.rest, 120);
  assert.equal(b.target, 82.5);
  assert.equal(b.muscles, undefined, 'muscles qui ne sont pas une liste : retirés');
});

test('sanitizeData : séries aberrantes de l\'historique écartées', () => {
  const d = app.sanitizeData({ programmes: {}, history: [{ date: 1, category: 'push', exercises: [{ name: 'A', sets: [
    { weight: '1e308', reps: '8' }, { weight: '80', reps: '99999999' }, { weight: '80', reps: '8' }, { weight: '', reps: '12' },
  ] }] }] });
  sameJSON(d.history[0].exercises[0].sets, [{ weight: '80', reps: '8' }, { weight: '', reps: '12' }]);
});

test('importText : fichier d\'une version plus récente refusé', () => {
  reset();
  for (const schema of [99, 'abc']) {
    sameJSON(app.importText(JSON.stringify({ schema, programmes: {}, activeProgramme: 'ppl', history: [] })), { ok: false, reason: 'invalid' }, String(schema));
  }
  assert.equal(app.importText(JSON.stringify({ schema: 3, programmes: {}, activeProgramme: 'ppl', history: [] })).ok, true);
});

test('freshData : donnée vide au schéma courant, la copie de secours survit au relancement', () => {
  reset();
  ctx.localStorage.setItem('ppl_v2_backup', '{"avant":"suppression"}');
  const fresh = JSON.stringify(app.freshData());
  app.normalizeData(JSON.parse(fresh), fresh);
  assert.equal(ctx.localStorage.getItem('ppl_v2_backup'), '{"avant":"suppression"}', 'aucune migration déclenchée');
  assert.equal(JSON.parse(fresh).schema, run('SCHEMA'));
});

test('moveSession : réordonne les séances d\'un programme perso, ordre conservé après rechargement', () => {
  reset();
  run(`data.userProgrammes.u_sem = { name: 'Semaine', archived: false, sessions: {} };
       ['Lundi', 'Mardi', 'Mercredi', 'Jeudi'].forEach(l => { data.userProgrammes.u_sem.sessions[newSessionId()] = { label: l, icon: '', desc: '', color: '#FF9500' }; });`);
  const labels = () => run('sessionKeys("u_sem").map(k => data.userProgrammes.u_sem.sessions[k].label)');
  sameJSON(labels(), ['Lundi', 'Mardi', 'Mercredi', 'Jeudi'], 'ordre de création');
  assert.equal(app.moveSession('u_sem', 3, 0), true);
  sameJSON(labels(), ['Jeudi', 'Lundi', 'Mardi', 'Mercredi']);
  app.moveSession('u_sem', 0, 3);
  app.moveSession('u_sem', 1, 2);
  sameJSON(labels(), ['Lundi', 'Mercredi', 'Mardi', 'Jeudi']);
  run('save(); data = loadData();');
  sameJSON(labels(), ['Lundi', 'Mercredi', 'Mardi', 'Jeudi'], 'ordre relu du stockage');
  assert.equal(app.moveSession('ppl', 0, 1), false, 'programme intégré : ordre fixe');
});

test('newSessionId : jamais une clé entière (elle passerait en tête de l\'objet)', () => {
  for (let i = 0; i < 2000; i++) assert.ok(!/^\d+$/.test(app.newSessionId()));
  sameJSON(app.moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
});

test('importText : ancien format ppl_v1 accepté, séances illisibles ignorées', () => {
  reset();
  const before = JSON.stringify(run('data'));
  const r = app.importText(JSON.stringify({
    exercises: { push: [{ id: 'e1', name: 'Dips', sets: 3 }] },
    history: [
      { date: 1700000000000, category: 'push', exercises: [{ name: 'Dips', sets: [{ weight: '20', reps: '8' }] }] },
      { date: 'x', category: 'push', exercises: [] },
    ],
    _theme: 'dark',
  }));
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.theme, 'dark');
  assert.equal(r.previous, before, 'donnée remplacée rendue pour « Annuler »');
  assert.equal(run('data.history.length'), 1);
  assert.equal(run('data.programmes.ppl.exercises.push[0].pr.weight'), '20');
  assert.equal(run('data.programmes.ppl.timers.push'), 1700000000000, 'délais recalés sur l\'historique importé');
  assert.equal(JSON.parse(ctx.localStorage.getItem('ppl_v2')).history.length, 1, 'écrit dans ppl_v2');
  assert.equal(toasts.length, 0, 'aucun effet d\'écran');
  app.undoImport(r.previous);
  assert.equal(JSON.stringify(run('data')), before, 'undoImport remet la donnée d\'avant');
});

test('importText : stockage plein → donnée d\'avant gardée', () => {
  reset();
  const before = JSON.stringify(run('data'));
  const setItem = ctx.localStorage.setItem;
  ctx.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    sameJSON(app.importText(JSON.stringify({ activeProgramme: 'ppl', programmes: {}, history: [] })), { ok: false, reason: 'storage' });
  } finally { ctx.localStorage.setItem = setItem; }
  assert.equal(JSON.stringify(run('data')), before);
  assert.equal(toasts.at(-1)?.msg, 'Stockage plein : exporte tes données');
});

// ── Délais de récupération ──────────────────────────────────

function pushEntry(id, date) {
  return { id, date, programme: 'ppl', category: 'push', exercises: [] };
}

test('syncTimersFromHistory : avance jusqu\'à la dernière séance, ne recule jamais', () => {
  reset();
  run('data.history = [' + JSON.stringify(pushEntry('h2', 2000)) + ',' + JSON.stringify(pushEntry('h1', 1000)) + ']');
  app.syncTimersFromHistory();
  assert.equal(run('data.programmes.ppl.timers.push'), 2000);
  run('data.programmes.ppl.timers.push = 5000');
  app.syncTimersFromHistory();
  assert.equal(run('data.programmes.ppl.timers.push'), 5000, 'délai plus récent que l\'historique gardé');
});

test('« Passer le délai » survit à loadData + syncTimersFromHistory', () => {
  reset();
  run('data.history = [' + JSON.stringify(pushEntry('h1', 1000)) + ']; data.programmes.ppl.timers.push = 1000;');
  run('data.programmes.ppl.skipped = { push: 1500 }; save();');
  run('data = loadData();');
  app.syncTimersFromHistory();
  assert.equal(run('data.programmes.ppl.timers.push'), 1000, 'le délai garde la date de la dernière séance');
  assert.equal(run('data.programmes.ppl.skipped.push'), 1500, 'le passage est conservé');
  // Une séance faite après le passage le rend caduc : il est retiré au chargement suivant
  run('data.history.unshift(' + JSON.stringify(pushEntry('h2', 2000)) + '); data.programmes.ppl.timers.push = 2000; save();');
  run('data = loadData();');
  assert.equal(run('data.programmes.ppl.skipped'), undefined);
});

test('releaseTimer : retirer la séance la plus récente recule le délai', () => {
  reset();
  const h1 = pushEntry('h1', 1000), h2 = pushEntry('h2', 2000);
  run('data.history = [' + JSON.stringify(h1) + ']; data.programmes.ppl.timers.push = 2000;');
  app.releaseTimer({ ...h1, date: 1500 });
  assert.equal(run('data.programmes.ppl.timers.push'), 2000, 'une séance plus ancienne ne touche pas au délai');
  app.releaseTimer(h2);
  assert.equal(run('data.programmes.ppl.timers.push'), 1000, 'recul à la séance précédente');
  run('data.history = [];');
  app.releaseTimer(h1);
  assert.equal(run('data.programmes.ppl.timers.push'), null, 'plus aucune séance : prête');
});

// ── Programmes perso (userProgrammes) ───────────────────────

test('userProgrammes : nettoyage des programmes et séances perso', () => {
  const d = app.sanitizeData({
    activeProgramme: 'u_arch',
    programmes: {},
    userProgrammes: {
      u_ok:   { name: 'Full body', sessions: { a: { label: 'A', icon: '🔥', desc: 'Haut', color: '#FF9F0A' }, b: { label: ' ', color: 'red' }, c: 'x' } },
      u_arch: { name: '', sessions: null, archived: 1 },
      pirate: { name: 'Sans préfixe u_', sessions: {} },
      u_bad:  'x',
      u_keys: { name: 'Clés', sessions: { 'a" onfocus="alert(1)" autofocus x="': { label: 'XSS' }, 'avec espace': { label: 'E' },
                'point.': { label: 'P' }, [`${'k'.repeat(41)}`]: { label: 'Long' }, 'ok_-9': { label: 'OK' } } },
    },
    customSessions: { 'x"y': { label: 'X' }, abc123: { label: 'Bras' } },
  });
  sameJSON(Object.keys(d.userProgrammes.u_keys.sessions), ['ok_-9'], 'clé de séance invalide retirée');
  sameJSON(Object.keys(d.customSessions), ['abc123'], 'clé de séance perso invalide retirée');
  sameJSON(Object.keys(d.userProgrammes), ['u_ok', 'u_arch', 'u_keys']);
  const s = d.userProgrammes.u_ok.sessions;
  sameJSON(Object.keys(s), ['a', 'b']);
  sameJSON(s.a, { label: 'A', icon: '🔥', desc: 'Haut', color: '#FF9F0A' });
  sameJSON(s.b, { label: 'Séance', color: '#8E8E93', icon: '🏋️', desc: '' });
  assert.equal(d.userProgrammes.u_ok.archived, false);
  assert.equal(d.userProgrammes.u_arch.name, 'Programme');
  assert.equal(d.userProgrammes.u_arch.archived, true);
  assert.equal(d.activeProgramme, 'ppl', 'programme actif archivé → retour au PPL');
});

test('userProgrammes : accès (isUserProg, sessionKeys, progMeta, sessionMeta, rawLabel)', () => {
  reset();
  run(`data.userProgrammes.u_fb = { name: 'Full <b>', archived: false, sessions: {
    a: { label: 'Haut <i>', icon: '🔥', desc: 'Pecs & dos', color: '#FF9F0A' },
    b: { label: 'Bas', icon: '🦵', desc: '', color: 'var(--teal)' } } };
    data.activeProgramme = 'u_fb';`);
  assert.equal(app.isUserProg('u_fb'), true);
  assert.equal(app.isUserProg('custom'), true);
  assert.equal(app.isUserProg('ppl'), false);
  assert.equal(app.isUserProg('u_absent'), false);
  sameJSON(app.sessionKeys(), ['a', 'b']);
  sameJSON(app.sessionKeys('ppl'), ['push', 'pull', 'legs']);
  assert.equal(app.firstSession(), 'a');
  const meta = app.progMeta();
  assert.equal(meta.name, 'Full <b>');
  assert.equal(meta.desc, 'Haut <i> · Bas');
  assert.equal(meta.user, true);
  const sm = app.sessionMeta('a');
  assert.equal(sm.label, 'Haut &lt;i&gt;', 'libellé échappé pour le HTML');
  assert.equal(sm.desc, 'Pecs &amp; dos');
  assert.equal(sm.color, '#FF9F0A');
  assert.equal(app.rawLabel('a'), 'Haut <i>', 'libellé brut pour textContent');
  assert.equal(app.sessionMeta('zzz').color, '#8E8E93', 'séance inconnue : couleur neutre');
  assert.equal(app.userSessions('ppl'), null);
  assert.equal(app.userSessions('u_fb').b.label, 'Bas');
  sameJSON(app.userSessions('custom'), {}, 'Perso créé à la demande');
  assert.equal(app.progMeta('inconnu').name, 'PPL', 'programme inconnu : PPL');
});

// ── Utilitaires ─────────────────────────────────────────────

test('esc, normName, sameEx, plural, setsVolume', () => {
  assert.equal(app.esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(app.esc(null), '');
  assert.equal(app.normName('  Développé   Couché '), 'developpe couche');
  assert.equal(app.sameEx({ exId: 'a', name: 'X' }, { id: 'a', name: 'Y' }), true);
  assert.equal(app.sameEx({ exId: 'a', name: 'X' }, { id: 'b', name: 'X' }), false);
  assert.equal(app.sameEx({ name: 'Dips' }, { id: 'b', name: 'dips' }), true);
  assert.equal(app.plural(1, 'séance', 'séances'), '1 séance');
  assert.equal(app.plural(2, 'séance', 'séances'), '2 séances');
  assert.equal(app.setsVolume([{ weight: '20', reps: '10' }, { weight: '', reps: '5' }]), 200);
  assert.equal(app.sessionVolume([{ sets: [{ weight: '20', reps: '10' }] }, { sets: [{ weight: '2.5', reps: '4' }] }]), 210);
});

// ── Pont natif (app iOS) ────────────────────────────────────
// native.js est chargé seul dans un contexte neuf, avec une coquille Capacitor simulée qui
// enregistre chaque appel de module natif.

// cloud : copie iCloud simulée (MdlfCloudBackup) { data, sessions, synced }, avec le filet du
// module Swift (pas de donnée sans séance sur une copie qui en a, sauf force) ; cloud.emit(snap)
// simule un changement venu d'iCloud, cloud.saved liste les écritures acceptées.
// storage : stockage web d'un lancement précédent (relance de l'app) ;
// manualTimers : les minuteries attendent timers.flush() au lieu de partir tout de suite
function nativeContext({ native = true, localData = null, fileData = null, shareCancelled = false, cloud = {}, storage = new MemoryStorage(), manualTimers = false, plugins: extra = {} } = {}) {
  const calls = [];
  const pending = [];
  if (localData !== null) storage.setItem('ppl_v2', localData);
  let reloaded = false;
  const plugins = {
    Filesystem: {
      writeFile: async (o) => { calls.push(['writeFile', o.path, o.directory]); fileData = o.data; return { uri: `file:///${o.directory}/${o.path}` }; },
      readFile:  async () => { if (fileData === null) throw new Error('absent'); return { data: fileData }; },
    },
    LocalNotifications: {
      checkPermissions:   async () => ({ display: 'prompt' }),
      requestPermissions: async () => { calls.push(['requestPermissions']); return { display: 'granted' }; },
      schedule: async (o) => { calls.push(['schedule', o.notifications[0].body]); },
      cancel:   async () => { calls.push(['cancel']); },
    },
    Share: {
      share: async (o) => { calls.push(['share', o.files]); if (shareCancelled) throw new Error('Share canceled'); },
    },
    MdlfCloudBackup: {
      load: async (o) => { calls.push(['cloudLoad', o.waitMs]); return { synced: !!cloud.synced, ...(cloud.data ? { data: cloud.data } : {}) }; },
      save: async (o) => {
        calls.push(['cloudSave', o.sessions, !!o.force]);
        if (o.sessions === 0 && !o.force && cloud.sessions > 0) return { saved: false, reason: 'wouldErase' };
        Object.assign(cloud, { data: o.data, sessions: o.sessions });
        (cloud.saved ||= []).push(o.data);
        return { saved: true };
      },
      addListener: (ev, fn) => { if (ev === 'change') cloud.emit = fn; return Promise.resolve({ remove() {} }); },
    },
    ...extra,   // modules propres à un test (ex. MdlfAppIcon)
  };
  const box = {
    console, localStorage: storage,
    setTimeout: (f) => { if (!manualTimers) return f(); pending.push(f); return pending.length; },
    clearTimeout: (id) => { if (id) pending[id - 1] = null; },
    location: { reload() { reloaded = true; } },
    Capacitor: native ? {
      isNativePlatform: () => true,
      registerPlugin: (name) => plugins[name] || new Proxy({}, { get: (_, m) => async () => calls.push([name, m]) }),
    } : undefined,
  };
  box.window = box;
  const c = vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/platform/native.js'), 'utf8') + '\nthis.Native = Native;', c);
  const timers = { flush: () => pending.splice(0).forEach(f => f?.()) };
  return { Native: c.Native, calls, storage, cloud, timers, isReloaded: () => reloaded, file: () => fileData };
}

test('native : dans le navigateur, tout est sans effet', () => {
  const { Native, calls } = nativeContext({ native: false });
  assert.equal(Native.isNative, false);
  assert.equal(Native.haptic(), false);
  assert.equal(Native.keepAwake(true), false);
  Native.backup('{}');
  assert.equal(calls.length, 0);
});

test('native : coquille iOS sans runtime JS Capacitor → comportement web (jamais bloqué)', () => {
  const box = { console, localStorage: new MemoryStorage(), setTimeout() {}, clearTimeout() {},
                Capacitor: { isNativePlatform: () => true } };   // pas de registerPlugin
  box.window = box;
  const c = vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/platform/native.js'), 'utf8') + '\nthis.Native = Native;', c);
  assert.equal(c.Native.isNative, false);
  assert.equal(c.Native.haptic(), false);
});

test('native : copie de sécurité écrite quand des données existaient au démarrage', () => {
  const n = nativeContext({ localData: '{"history":[1]}' });
  n.Native.backup('{"history":[1,2]}');
  assert.equal(n.file(), '{"history":[1,2]}');
});

test('native : premier lancement sans données → la copie n\'est pas écrasée avant boot()', async () => {
  const n = nativeContext({ fileData: '{"history":[42]}' });
  n.Native.backup('{"history":[]}');                 // donnée par défaut créée au chargement
  assert.equal(n.file(), '{"history":[42]}', 'copie intacte');
  assert.equal(await n.Native.boot(), true, 'rechargement demandé');
  assert.equal(n.storage.getItem('ppl_v2'), '{"history":[42]}', 'copie remise dans le stockage web');
  assert.equal(n.isReloaded(), true);
});

test('native : premier lancement sans copie → les sauvegardes reprennent après boot()', async () => {
  const n = nativeContext();
  assert.equal(await n.Native.boot(), false);
  n.Native.backup('{"history":[7]}');
  assert.equal(n.file(), '{"history":[7]}');
});

const tick = () => new Promise(r => setImmediate(r));

test('native : copie iCloud suivie quand il y avait des séances, sans renvoyer ce qu\'elle a déjà', async () => {
  const n = nativeContext({ localData: '{"history":[1]}' });
  n.Native.backup('{"history":[1,2]}');
  await tick();
  n.Native.backup('{"history":[1,2]}');              // ex. enregistrement de chaque démarrage
  await tick();
  sameJSON(n.cloud.saved, ['{"history":[1,2]}']);
  assert.equal(n.calls.filter(c => c[0] === 'cloudSave').length, 1, 'un vieil iPhone juste ouvert n\'écrit rien');
});

test('native : « Supprimer toutes les données » vide aussi la copie iCloud (et seulement là)', async () => {
  const n = nativeContext({ localData: '{"history":[1]}', cloud: { data: '{"history":[1]}', sessions: 1 } });
  n.Native.backup('{"history":[]}');                 // donnée vide sans demande explicite : refusée
  await tick();
  assert.equal(n.cloud.data, '{"history":[1]}');
  n.Native.eraseCloudOnNextSave();
  n.Native.backup('{"history":[]}');
  await tick();
  assert.equal(n.cloud.data, '{"history":[]}');
  sameJSON(n.calls.filter(c => c[0] === 'cloudSave').at(-1), ['cloudSave', 0, true]);
});

test('native : réinstallation (rien sur l\'iPhone) → la copie iCloud est restaurée', async () => {
  const n = nativeContext({ cloud: { data: '{"history":[5,6]}', sessions: 2 } });
  assert.equal(await n.Native.boot(), true, 'rechargement demandé');
  assert.equal(n.storage.getItem('ppl_v2'), '{"history":[5,6]}');
  sameJSON(n.calls.find(c => c[0] === 'cloudLoad'), ['cloudLoad', 2500]);
});

test('native : la copie des Documents passe avant iCloud (iCloud pas consulté)', async () => {
  const n = nativeContext({ fileData: '{"history":[1]}', cloud: { data: '{"history":[9]}', sessions: 1 } });
  assert.equal(await n.Native.boot(), true);
  assert.equal(n.storage.getItem('ppl_v2'), '{"history":[1]}');
  assert.ok(!n.calls.some(c => c[0] === 'cloudLoad'));
});

test('native : iCloud vide et synchronisé → nouvelle donnée copiée tout de suite', async () => {
  const n = nativeContext({ cloud: { synced: true } });
  assert.equal(await n.Native.boot(), false);
  n.Native.backup('{"history":[]}');
  await tick();
  sameJSON(n.cloud.saved, ['{"history":[]}']);
});

test('native : iCloud muet → copie iCloud intacte jusqu\'à la 1re séance', async () => {
  const n = nativeContext();                         // iCloud n'a pas répondu dans le délai
  assert.equal(await n.Native.boot(), false);
  n.Native.backup('{"history":[]}');
  await tick();
  assert.equal(n.cloud.saved, undefined, 'donnée vide jamais envoyée : elle écraserait une vraie copie');
  n.Native.backup('{"history":[1]}');
  await tick();
  sameJSON(n.cloud.saved, ['{"history":[1]}']);
});

test('native : réinstallation, iCloud muet puis relance → rien d\'écrasé, la copie est reprise', async () => {
  const cloud = {};
  const first = nativeContext({ cloud });            // lancement 1 : iCloud muet, donnée par défaut
  await first.Native.boot();
  first.storage.setItem('ppl_v2', '{"history":[]}');
  first.Native.backup('{"history":[]}');
  await tick();
  Object.assign(cloud, { data: '{"history":[1,2,3]}', sessions: 3 });   // la copie arrive ensuite
  const second = nativeContext({ storage: first.storage, cloud });       // lancement 2, même stockage
  second.Native.backup('{"history":[]}');            // enregistrement du démarrage
  assert.equal(await second.Native.boot(), false);
  await tick();
  assert.equal(cloud.data, '{"history":[1,2,3]}', 'copie iCloud intacte');
  assert.equal(second.storage.getItem('ppl_v2'), '{"history":[1,2,3]}', 'et reprise');
  assert.equal(second.isReloaded(), true);
});

test('native : copie iCloud arrivée après le lancement → reprise seulement sans séance locale', async () => {
  const a = nativeContext();
  await a.Native.boot();
  a.storage.setItem('ppl_v2', '{"history":[]}');
  a.cloud.emit({ data: '{"history":[3,4]}' });
  assert.equal(a.storage.getItem('ppl_v2'), '{"history":[3,4]}');
  assert.equal(a.isReloaded(), true);

  const b = nativeContext();
  await b.Native.boot();
  b.storage.setItem('ppl_v2', '{"history":[7]}');   // séance déjà faite ici : on ne l'écrase pas
  b.cloud.emit({ data: '{"history":[3,4]}' });
  assert.equal(b.storage.getItem('ppl_v2'), '{"history":[7]}');
  assert.equal(b.isReloaded(), false);
});

test('native : reprise tardive → l\'enregistrement en attente est annulé (il réécrirait le vide)', async () => {
  const n = nativeContext({ manualTimers: true });
  await n.Native.boot();
  n.storage.setItem('ppl_v2', '{"history":[]}');
  n.Native.backup('{"history":[]}');                 // en attente (800 ms)
  n.cloud.emit({ data: '{"history":[3]}' });
  n.timers.flush();
  n.Native.backup('{"history":[]}');                 // un tap avant la fin du rechargement
  n.timers.flush();
  await tick();
  assert.equal(n.storage.getItem('ppl_v2'), '{"history":[3]}');
  assert.equal(n.file(), null, 'aucun fichier réécrit');
  assert.equal(n.cloud.saved, undefined, 'rien envoyé à iCloud');
});

test('native : module MdlfCloudBackup enregistré, compilé et autorisé (projet Xcode)', () => {
  const read = f => fs.readFileSync(path.join(ROOT, 'ios/App', f), 'utf8');
  assert.match(read('App/MainViewController.swift'), /registerPluginInstance\(CloudBackupPlugin\(\)\)/);
  assert.match(read('App/CloudBackupPlugin.swift'), /jsName = "MdlfCloudBackup"/);
  assert.match(read('App.xcodeproj/project.pbxproj'), /\/\* CloudBackupPlugin\.swift in Sources \*\/,/);
  assert.match(read('App/App.entitlements'), /com\.apple\.developer\.ubiquity-kvstore-identifier/);
});

test('native : notification de fin de repos (autorisation demandée une fois, puis programmée)', async () => {
  const n = nativeContext({ localData: '{}' });
  await n.Native.scheduleRestEnd(Date.now() + 90_000, 'Série 2 · Squat');
  await n.Native.scheduleRestEnd(Date.now() + 60_000, 'Série 3 · Squat');
  assert.equal(n.calls.filter(c => c[0] === 'requestPermissions').length, 1);
  sameJSON(n.calls.filter(c => c[0] === 'schedule').map(c => c[1]), ['Série 2 · Squat', 'Série 3 · Squat']);
  await n.Native.scheduleRestEnd(Date.now() - 1000, 'passé');   // heure passée : rien
  assert.equal(n.calls.filter(c => c[0] === 'schedule').length, 2);
});

test('native : Live Activity du repos relayée au module MdlfLiveActivity, rien dans le navigateur', () => {
  const web = nativeContext({ native: false });
  const state = { endTime: 1_700_000_090_000, total: 90, title: 'Push', color: 'orange', next: null };
  assert.equal(web.Native.liveActivity.start(state), false);
  assert.equal(web.Native.liveActivity.end(), false);
  assert.equal(web.calls.length, 0);
  const n = nativeContext({ localData: '{}' });
  n.Native.liveActivity.start(state);
  n.Native.liveActivity.update({ ...state, total: 105 });
  n.Native.liveActivity.end();
  sameJSON(n.calls.filter(c => c[0] === 'MdlfLiveActivity').map(c => c[1]), ['start', 'update', 'end']);
});

// ── Live Activity du repos (rest-activity.js) ───────────────

test('live activity : couleur de séance → couleur système d\'iOS ou hexadécimal, sinon indigo', () => {
  assert.equal(app.restActivityTint('var(--orange)'), 'orange');
  assert.equal(app.restActivityTint(' var(--teal) '), 'teal');
  assert.equal(app.restActivityTint('#30b0c7'), '#30B0C7');
  assert.equal(app.restActivityTint('var(--label2)'), 'indigo', 'token qui n\'est pas une couleur de séance');
  assert.equal(app.restActivityTint('red; x'), 'indigo');
  assert.equal(app.restActivityTint(undefined), 'indigo');
});

test('live activity : série suivante (charge en kg ou lbs, poids du corps, sans reps)', () => {
  reset();
  const session = { exercises: [{ name: 'Squat', sets: [
    { weight: '80', reps: '8' }, { weight: '', reps: '12' }, { weight: '32.5', reps: '' }] }] };
  sameJSON(run(`restActivityNext(${JSON.stringify(session)}, { ei: 0, si: 0 })`), { exercise: 'Squat', set: 1, load: '80 kg × 8' });
  sameJSON(run(`restActivityNext(${JSON.stringify(session)}, { ei: 0, si: 1 })`), { exercise: 'Squat', set: 2, load: '12 reps' });
  sameJSON(run(`restActivityNext(${JSON.stringify(session)}, { ei: 0, si: 2 })`), { exercise: 'Squat', set: 3, load: '' });
  assert.equal(run(`restActivityNext(${JSON.stringify(session)}, null)`), null, 'toutes les séries faites');
  assert.equal(run(`restActivityNext(${JSON.stringify(session)}, { ei: 4, si: 0 })`), null);
  reset({ unit: 'lbs' });
  assert.equal(run(`restActivityNext(${JSON.stringify(session)}, { ei: 0, si: 0 })`).load, '176,4 lbs × 8');
});

test('live activity : données envoyées (séance, couleur, durée entière, textes bornés pour les 4 Ko d\'Apple)', () => {
  reset();
  const long = 'X'.repeat(200);
  const session = { category: 'push', programme: 'ppl', exercises: [{ name: long, sets: [{ weight: '20', reps: '10' }] }] };
  const p = run(`restActivityPayload(${JSON.stringify(session)}, { ei: 0, si: 0 }, { endTime: 1700000090000, total: 89.6 })`);
  assert.equal(p.title, 'Push');
  assert.equal(p.color, 'orange');
  assert.equal(p.total, 90);
  assert.equal(p.endTime, 1700000090000);
  assert.equal(p.next.exercise.length, 60);
  assert.ok(JSON.stringify(p).length < 1024);
  run(`data.userProgrammes = { u_test0001: { name: 'Perso', sessions: { a: { label: ${JSON.stringify('<b>' + long)}, icon: '', desc: '', color: '#FF3B30' } } } }`);
  const u = run(`restActivityPayload({ category: 'a', programme: 'u_test0001', exercises: [] }, null, { endTime: 1, total: 0 })`);
  assert.equal(u.title, ('<b>' + long).slice(0, 40), 'texte brut (pas de HTML côté natif), borné');
  assert.equal(u.color, '#FF3B30');
  assert.equal(u.total, 1);
  assert.equal(u.next, null);
});

// ── Services Apple (Santé, Apple Music) ─────────────────────

test('santé : énergie estimée = MET 5 × poids × durée, rien sans pesée', () => {
  assert.equal(app.estimateKcal(3_600_000, 72), 360);
  assert.equal(app.estimateKcal(45 * 60_000, 80), 300);
  assert.equal(app.estimateKcal(3_600_000, null), 0);
  assert.equal(app.estimateKcal(0, 72), 0);
});

test('santé et musique : rien dans le navigateur, même activés', async () => {
  reset();
  run('data.healthOn = true; data.musicOn = true;');
  assert.equal(run('healthEnabled() || musicEnabled()'), false);
  assert.equal(run('renderWeightGroup() + renderMusicBar() + renderAppleServicesGroup(() => "")'), '');
  sameJSON(await run('Native.health.bodyMass()'), []);
});

test('santé : poids pour les calories, celui de Santé (non modifiable) sinon celui de l\'app', () => {
  reset();
  run('data.bodyWeightKg = 70;');
  const cell = samples => run(`weightCache = ${samples === undefined ? '{ at: 0, samples: [] }' : `{ at: Date.now(), samples: ${JSON.stringify(samples)} }`};
    renderBodyWeightCell()`);
  assert.match(cell(undefined), /Lecture dans Santé/, 'pas encore lu');
  const fromHealth = cell([{ kg: 72.4, date: Date.UTC(2026, 9, 12) }]);
  assert.match(fromHealth, /72,4 kg/);
  assert.match(fromHealth, /Pris dans Santé · pesée du/);
  assert.doesNotMatch(fromHealth, /data-action/, 'pas de saisie quand Santé a une pesée');
  const manual = cell([]);
  assert.match(manual, /data-action="set-body-weight"/);
  assert.match(manual, /70 kg/);
  assert.match(manual, /Aucune pesée dans Santé/);
});

test('santé : séance envoyée avec ses dates et les calories du poids le plus récent', async () => {
  reset();
  const sent = [];
  run('data.healthOn = true;');
  // Faux pont natif : app iOS, Santé autorisée, pesée de 72 kg (Native est une constante : on
  // remplace ses propriétés, puis on les remet)
  ctx.__sent = sent;
  run(`__orig = { isNative: Native.isNative, health: Native.health };
       Native.isNative = true;
       Native.health = { saveWorkout: async (w) => { __sent.push(w); return true; },
                         bodyMass: async () => [{ date: 1700000000000, kg: 72 }] };
       weightCache = { at: 0, samples: [] };`);
  try {
    await app.syncWorkoutToHealth({ date: 1_700_003_600_000, duration: 3_600_000 });
    sameJSON(sent, [{ start: 1_700_000_000_000, end: 1_700_003_600_000, kcal: 360 }]);
    run('data.healthOn = false;');
    await app.syncWorkoutToHealth({ date: 1_700_003_600_000, duration: 3_600_000 });
    assert.equal(sent.length, 1, 'désactivé : rien envoyé');
  } finally {
    run('Native.isNative = __orig.isNative; Native.health = __orig.health;');
  }
});

test('santé historique : durée habituelle = médiane des séances chronométrées, 1 h sinon', () => {
  reset();
  assert.equal(run('typicalDuration()'), 3_600_000);
  run(`data.history = [{ duration: 40*60000 }, { duration: 70*60000 }, { duration: 55*60000 }, { duration: 30000 }, {}]
        .map((h, i) => Object.assign({ id: 'h' + i, date: 1e12 + i, category: 'push', exercises: [{}] }, h))`);
  assert.equal(run('typicalDuration()'), 55 * 60_000, 'médiane de 40, 55, 70 min (30 s et sans durée ignorées)');
});

test('santé historique : dates d\'une séance chronométrée et d\'une séance saisie après coup', () => {
  sameJSON(run('workoutOf({ date: 10_000_000, duration: 3_000_000 }, 999, 80)'), { start: 7_000_000, end: 10_000_000, kcal: 333 });
  sameJSON(run('workoutOf({ date: 10_000_000 }, 3_600_000, null)'), { start: 10_000_000, end: 13_600_000, kcal: 0 });
});

test('santé historique : tout envoyé une seule fois, les échecs restent à envoyer', async () => {
  reset();
  const sent = [];
  ctx.__sent = sent;
  run(`data.healthOn = true;
       data.history = [
         { id: 'a', date: 3e12, duration: 3600000, category: 'push', exercises: [{}] },
         { id: 'b', date: 2e12, category: 'pull', exercises: [{}] },
         { id: 'c', date: 1e12, category: 'legs', exercises: [{}], healthSaved: true },
         { id: 'd', date: 4e12, category: 'legs', exercises: [] } ];
       __orig = { isNative: Native.isNative, health: Native.health };
       Native.isNative = true;
       let __fail = true;
       Native.health = { saveWorkout: async (w) => { if (w.start === 2e12 && __fail) { __fail = false; return false; } __sent.push(w.start); return true; },
                         bodyMass: async () => [] };
       weightCache = { at: 0, samples: [] };`);
  try {
    sameJSON(run('healthBacklog().map(h => h.id)'), ['b', 'a'], 'du plus ancien au plus récent, sans les déjà envoyées ni les vides');
    await run('sendHistoryToHealth()');
    sameJSON(run('healthBacklog().map(h => h.id)'), ['b'], 'b a échoué : reste à envoyer');
    await run('sendHistoryToHealth()');
    sameJSON(run('healthBacklog().map(h => h.id)'), [], 'tout est envoyé');
    sameJSON(sent, [3e12 - 3_600_000, 2e12], 'chaque séance envoyée une seule fois');
  } finally {
    run('Native.isNative = __orig.isNative; Native.health = __orig.health;');
  }
});

test('calories : pesée de Santé en priorité, sinon poids de secours, sinon rien', async () => {
  reset();
  run(`data.healthOn = true; data.bodyWeightKg = 70;
       __o = { isNative: Native.isNative, health: Native.health };
       Native.isNative = true; weightCache = { at: 0, samples: [] };
       Native.health = { bodyMass: async () => __samples };`);
  try {
    ctx.__samples = [{ date: 1, kg: 82.4 }];
    assert.equal(await run('weightForCalories()'), 82.4, 'pesée Santé');
    run('weightCache = { at: 0, samples: [] }'); ctx.__samples = [];
    assert.equal(await run('weightForCalories()'), 70, 'poids de secours');
    run('weightCache = { at: 0, samples: [] }; data.bodyWeightKg = null');
    assert.equal(await run('weightForCalories()'), null, 'aucun poids : pas de calories');
  } finally { run('Native.isNative = __o.isNative; Native.health = __o.health;'); }
});

test('données : poids de secours borné (25 à 300 kg), null sinon', () => {
  assert.equal(run('normalizeData(Object.assign(makeDefaultData(), { bodyWeightKg: 72.5 }))').bodyWeightKg, 72.5);
  assert.equal(run('normalizeData(Object.assign(makeDefaultData(), { bodyWeightKg: 5000 }))').bodyWeightKg, null);
  assert.equal(run('normalizeData(Object.assign(makeDefaultData(), { bodyWeightKg: "70" }))').bodyWeightKg, null);
  assert.equal(run('num("70,5", 25, 300)'), 70.5, 'virgule du clavier français acceptée');
});

test('Apple Music : barre masquée sans morceau dans l\'app Musique, visible en pause', () => {
  assert.equal(app.musicBarIdle(null), true);
  assert.equal(app.musicBarIdle({ playing: false }), true, 'Spotify ou rien : l\'app Musique ne renvoie aucun titre');
  assert.equal(app.musicBarIdle({ title: 'Enter Sandman', playing: false }), false, 'morceau en pause : barre gardée');
  assert.equal(app.musicBarIdle({ title: 'Enter Sandman', playing: true }), false);
});

test('données : healthOn et musicOn désactivés par défaut, conservés ensuite', () => {
  const d = run('normalizeData(makeDefaultData())');
  assert.equal(d.healthOn, false); assert.equal(d.musicOn, false);
  const d2 = run('normalizeData(Object.assign(makeDefaultData(), { healthOn: true, musicOn: "oui" }))');
  assert.equal(d2.healthOn, true); assert.equal(d2.musicOn, false);
});

// ── Coquille iOS : les modules Swift de l'app sont bien joignables depuis le web ──
// Régression du 16/10/2026 : le SceneDelegate créait CAPBridgeViewController() directement, les
// modules Santé et Musique n'étaient jamais enregistrés (« not implemented on ios »).

test('iOS : SceneDelegate → MainViewController → chaque module Swift, noms identiques côté web', () => {
  const ios = p => fs.readFileSync(path.join(ROOT, 'ios/App/App', p), 'utf8');
  assert.match(ios('SceneDelegate.swift'), /rootViewController\s*=\s*MainViewController\(\)/, 'SceneDelegate doit créer MainViewController');
  const main = ios('MainViewController.swift');
  const pbx = fs.readFileSync(path.join(ROOT, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
  const native = fs.readFileSync(path.join(ROOT, 'js/platform/native.js'), 'utf8');
  for (const file of ['HealthPlugin.swift', 'MusicPlugin.swift', 'LiveActivityPlugin.swift']) {
    const src = ios(file);
    const cls = src.match(/public (?:final )?class (\w+): CAPPlugin/)[1];
    const jsName = src.match(/jsName = "(\w+)"/)[1];
    assert.match(main, new RegExp(`registerPluginInstance\\(${cls}\\(\\)\\)`), `${cls} enregistré par MainViewController`);
    // Régression du 17/10/2026 : un module présent sur le disque mais absent de la cible App
    // (« cannot find 'LiveActivityPlugin' in scope » à la compilation)
    assert.match(pbx, new RegExp(`${file} in Sources \\*/,`), `${file} compilé dans la cible App`);
    assert.match(native, new RegExp(`plugin\\('${jsName}'\\)`), `native.js appelle ${jsName}`);
    // Chaque méthode appelée par native.js est déclarée par le module Swift
    const declared = [...src.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map(m => m[1]);
    for (const m of declared) assert.match(src, new RegExp(`@objc func ${m}\\(`), `${file} : ${m} implémentée`);
  }
});

test('iOS : Live Activity du repos (API exposée, activités vivantes, fin à la fermeture de l\'app)', () => {
  const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const src = read('ios/App/App/LiveActivityPlugin.swift');
  const native = read('js/platform/native.js');
  // Aucune méthode morte : chaque méthode déclarée est appelée par native.js, et inversement
  const declared = [...src.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map(m => m[1]).sort();
  const used = [...native.matchAll(/LiveActivity\.(\w+)\(/g)].map(m => m[1]).sort();
  sameJSON(declared, ['end', 'start', 'update']);
  sameJSON([...new Set(used)], declared);
  // Une activité terminée encore listée n'est jamais reprise
  assert.doesNotMatch(src.replace(/static var liveActivities[\s\S]*?\n    \}/, ''), /RestActivity\.activities/);
  assert.match(src, /activityState == \.active \|\| \$0\.activityState == \.stale/);
  // App tuée par l'utilisateur : Live Activities terminées avant la fin du processus
  assert.match(src, /UIApplication\.willTerminateNotification/);
  assert.match(src, /done\.wait\(timeout: \.now\(\) \+ 1\)/);
  // Écran verrouillé périmé : depuis quand le repos est fini
  assert.match(read('ios/App/RestActivity/RestActivityViews.swift'), /state\.endDate, style: \.relative/);
});

test('iOS : extension RestActivity déclarée, embarquée et signée comme l\'app', () => {
  const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.match(read('ios/App/App/Info.plist'), /<key>NSSupportsLiveActivities<\/key>\s*<true\/>/, 'Live Activities autorisées par l\'app');
  assert.match(read('ios/App/RestActivity/Info.plist'), /com\.apple\.widgetkit-extension/);
  assert.match(pbx, /productType = "com\.apple\.product-type\.app-extension"/);
  assert.match(pbx, /RestActivity\.appex in Embed Foundation Extensions/, 'extension embarquée dans l\'app');
  // Attributs partagés : compilés dans les deux cibles (sinon l'app et l'extension ne parlent pas du même type)
  assert.equal((pbx.match(/RestActivityAttributes\.swift in Sources \*\/,/g) || []).length, 2);
  for (const f of ['RestActivityBundle.swift', 'RestLiveActivity.swift', 'RestActivityViews.swift'])
    assert.match(pbx, new RegExp(`${f} in Sources \\*/,`), `${f} compilé`);
  // App Store Connect exige la même version pour l'app et l'extension : une seule source (le projet)
  const targetConfigs = pbx.split('/* Begin XCBuildConfiguration section */')[1].split(/\n\t\t[0-9A-F]{24} \/\* (?:Debug|Release) \*\/ = /)
    .filter(c => /PRODUCT_BUNDLE_IDENTIFIER/.test(c));
  assert.equal(targetConfigs.length, 4, 'Debug et Release des deux cibles');
  for (const c of targetConfigs) assert.doesNotMatch(c, /MARKETING_VERSION|CURRENT_PROJECT_VERSION/);
  assert.match(pbx, /PROVISIONING_PROFILE_SPECIFIER = "MDLF Training Rest Activity App Store";/);
  // Export et CI : un profil par identifiant
  const exp = read('ios/ExportOptions.plist');
  assert.match(exp, /<key>com\.mdlf\.training<\/key>\s*<string>MDLF Training App Store<\/string>/);
  assert.match(exp, /<key>com\.mdlf\.training\.RestActivity<\/key>\s*<string>MDLF Training Rest Activity App Store<\/string>/);
  assert.match(read('.github/workflows/ios.yml'), /APPSTORE_PROFILE_REST_ACTIVITY/);
});

// ── Mises à jour à chaud ────────────────────────────────────

const OTA_SUM = 'a'.repeat(64);
const otaManifest = (o = {}) => ({ version: '2026.10.20-abc1234', seq: 2000, runtime: 'r1', url: 'https://mdlf-ota.vercel.app/b.zip', checksum: OTA_SUM, ...o });
const otaCtx = (o = {}) => ({ build: { version: 'x', seq: 1000, runtime: 'r1' }, shellRuntime: 'r1', failed: [], ...o });

test('mise à jour à chaud : décision (version, empreinte native, échecs, manifeste)', () => {
  const d = (m, c) => run(`liveUpdateDecision(${JSON.stringify(m)}, ${JSON.stringify(c)})`);
  assert.equal(d(otaManifest(), otaCtx()).download, true);
  assert.equal(d(otaManifest({ seq: 1000 }), otaCtx()).reason, 'à jour', 'même contenu');
  assert.equal(d(otaManifest({ seq: 900 }), otaCtx()).download, false, 'jamais de retour en arrière');
  assert.equal(d(otaManifest({ runtime: 'r2' }), otaCtx()).reason, 'nécessite une nouvelle version de l\'app');
  assert.equal(d(otaManifest(), otaCtx({ failed: ['2026.10.20-abc1234'] })).download, false, 'version en échec jamais retentée');
  assert.equal(d(otaManifest({ url: 'http://x/b.zip' }), otaCtx()).reason, 'manifeste invalide', 'HTTPS obligatoire');
  assert.equal(d(otaManifest({ checksum: 'abc' }), otaCtx()).reason, 'manifeste invalide', 'SHA-256 obligatoire');
  assert.equal(d(null, otaCtx()).reason, 'manifeste invalide');
  assert.equal(d(otaManifest(), otaCtx({ build: null })).download, false, 'PWA : jamais');
});

async function otaScenario({ manifest = otaManifest(), session = null, now = false, bundles = [], current = 'builtin' } = {}) {
  const calls = [];
  ctx.__calls = calls; ctx.__manifest = manifest; ctx.__bundles = bundles; ctx.__current = current;
  ctx.activeSession = session;
  run(`window.MDLF_BUILD = { version: 'x', seq: 1000, runtime: 'r1' };
       __ota = { isNative: Native.isNative, ota: Native.ota, fetch: globalThis.fetch };
       Native.isNative = true;
       globalThis.fetch = async () => ({ ok: true, json: async () => __manifest });
       Native.ota = {
         current: async () => ({ bundle: { id: __current } }),
         list: async () => __bundles,
         download: async (o) => { __calls.push(['download', o.version, o.checksum]); return { id: 'b1', version: o.version, status: 'success' }; },
         applyNow: async (id) => { __calls.push(['now', id]); return true; },
         applyAtNextLaunch: async (id) => { __calls.push(['next', id]); return true; },
       };`);
  try { return { result: await run(`checkLiveUpdate({ now: ${now} })`), calls }; }
  finally { run('Native.isNative = __ota.isNative; Native.ota = __ota.ota; globalThis.fetch = __ota.fetch; delete window.MDLF_BUILD;'); }
}

test('mise à jour à chaud : téléchargée (empreinte vérifiée) puis appliquée au prochain lancement', async () => {
  const { result, calls } = await otaScenario();
  assert.equal(result.status, 'ready');
  sameJSON(calls, [['download', '2026.10.20-abc1234', OTA_SUM], ['next', 'b1']]);
});

test('mise à jour à chaud : « maintenant » appliquée tout de suite, sauf pendant une séance', async () => {
  assert.equal((await otaScenario({ now: true })).result.status, 'applied');
  const { result, calls } = await otaScenario({ now: true, session: { exercises: [] } });
  assert.equal(result.status, 'ready', 'séance en cours : attend le prochain lancement');
  sameJSON(calls.map(c => c[0]), ['download', 'next']);
});

test('mise à jour à chaud : déjà téléchargée → pas de nouveau téléchargement ; en échec → jamais retentée', async () => {
  const ok = await otaScenario({ bundles: [{ id: 'b9', version: '2026.10.20-abc1234', status: 'success' }] });
  sameJSON(ok.calls, [['next', 'b9']]);
  const ko = await otaScenario({ bundles: [{ id: 'b8', version: '2026.10.20-abc1234', status: 'error' }] });
  assert.equal(ko.result.status, 'none'); assert.equal(ko.calls.length, 0);
});

test('mise à jour à chaud : coquille native différente → rien (il faut passer par l\'App Store)', async () => {
  const { result, calls } = await otaScenario({ manifest: otaManifest({ runtime: 'autre' }) });
  assert.equal(result.reason, 'nécessite une nouvelle version de l\'app'); assert.equal(calls.length, 0);
});

// ── Muscles (tests/unit/muscles.mjs) ────────────────────────

(await import('./muscles.mjs')).default({ test, app, run, reset, sameJSON, assert });

// ── Partage de séance (tests dans share.mjs) ────────────────

(await import('./share.mjs')).default({ test, app, run, reset, sameJSON, nativeContext });

// ── Icône de l'app (tests dans app-icons.mjs) ──────────────

(await import('./app-icons.mjs')).default({ test, app, run, sameJSON, assert, nativeContext });

// ── Supprimés récemment (tests dans trash.mjs) ─────────────

(await import('./trash.mjs')).default({ test, app, run, reset, assert });

// ── Séance libre (tests dans free-session.mjs) ─────────────

(await import('./free-session.mjs')).default({ test, app, run, reset, assert });

// ── Récupération par muscle (tests dans recovery.mjs) ──────

(await import('./recovery.mjs')).default({ test, app, run, reset, assert });

// ── Exécution ───────────────────────────────────────────────

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ÉCHEC ${name}\n        ${String(err.message).split('\n').join('\n        ')}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} tests unitaires OK`);
process.exit(failed ? 1 : 0);
