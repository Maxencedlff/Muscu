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
  'js/core/util.js',
  'js/data/programmes.js',
  'js/data/store.js',
  'js/data/accessors.js',
  'js/data/backup.js',
  'js/ui/forms.js',
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

// ── Exécution ───────────────────────────────────────────────

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ÉCHEC ${name}\n        ${String(err.message).split('\n').join('\n        ')}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} tests unitaires OK`);
process.exit(failed ? 1 : 0);
