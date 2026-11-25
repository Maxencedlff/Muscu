// Tests du contrôle d'architecture (tools/archi/check.mjs) : chaque règle sur de petits projets écrits ici.
// Lancer depuis la racine du dépôt : node --test tools/archi/check.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargerOutils, analyserFichier } from './analyse.mjs';
import { scriptsDeLaPage } from './check.mjs';
import {
  coucheDe, regleDomDansData, regleDependancesDeCouche, regleCapacitor, regleDeskReutilise, regleTaille,
  regleOrdreDeChargement, regleCollisions, regleDuplicationAppSite, regleDocs, appliquerExceptions, verifierExceptions,
  verifierProjet,
} from './regles.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outils = chargerOutils(path.join(ROOT, 'node_modules'));
const analyser = src => analyserFichier(`'use strict';\n${src}`, outils);

/** Projet de test : { chemin: source }, pages { page: [scripts] }, docs, css { chemin: lignes } */
function projet(sources, { pages = {}, docs = {}, css = {} } = {}) {
  return {
    fichiers: new Map(Object.entries(sources).map(([c, s]) => [c, analyser(s)])),
    css: new Map(Object.entries(css)),
    pages: Object.entries(pages).map(([page, scripts]) => ({ page, scripts })),
    docs,
  };
}
const cibles = v => v.map(x => `${x.fichier} ${x.cible ?? ''}`.trim()).sort();

// ── Analyse d'un fichier ────────────────────────────────────

test('analyse : déclarations de premier niveau, y compris motifs et window.X', () => {
  const a = analyser('function f() {}\nclass K {}\nconst { a, b: [c] } = o;\nlet x = 1;\nwindow.G = () => 1;');
  assert.deepEqual(a.decls.map(d => d.nom), ['f', 'K', 'a', 'c', 'x', 'G']);
});

test('analyse : seuls les noms externes sont des références (paramètres et variables locales exclus)', () => {
  const a = analyser('function f(p) { const l = p + 1; return l + ext + f(); }');
  assert.deepEqual([...a.refs.keys()], ['ext']);
});

test('analyse : ce qui tourne au chargement (premier niveau, IIFE, fonction du fichier appelée) et ce qui attend', () => {
  const a = analyser([
    'const x = tot();',
    '(function () { dansIife(); })();',
    'function init() { parInit(); }',
    'init();',
    'function plusTard() { jamaisAuChargement(); }',
    'document.addEventListener("click", () => dansRappel());',
  ].join('\n'));
  const noms = a.chargement.map(u => u.nom).sort();
  assert.deepEqual(noms, ['dansIife', 'document', 'parInit', 'tot']);
  assert.equal(a.chargement.find(u => u.nom === 'parInit').via, 'init');
  assert.deepEqual(a.parFonction.get('plusTard').map(u => u.nom), ['jamaisAuChargement']);
});

test('analyse : un nom gardé par typeof dans la même fonction est protégé', () => {
  const a = analyser('const v = typeof peutManquer === "function" ? peutManquer() : 0;\nfunction f() { if (typeof g === "function") g(); h(); }');
  assert.deepEqual(a.chargement.map(u => u.nom), []);
  assert.deepEqual(a.parFonction.get('f').map(u => u.nom), ['h']);
  assert.ok(a.refs.has('peutManquer'), 'reste une référence (règle des couches)');
});

test('analyse : DOM repéré, sauf cycle de vie et canvas hors écran', () => {
  const a = analyser([
    'document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") go(); });',
    'function img() { return document.createElement("canvas"); }',
    'function ecran(el) { el.innerHTML = ""; document.body.classList.add("x"); return $("#a"); }',
  ].join('\n'));
  assert.deepEqual(a.dom.map(u => u.ligne), [4]);
  const b = analyser('function f(el) {\n el.innerHTML = "";\n document.querySelector("a");\n return $("#a");\n}');
  assert.deepEqual(b.dom.map(u => u.quoi), ['.innerHTML', 'document.querySelector', '$()']);
});

test('analyse : même logique malgré d\'autres noms locaux, empreinte différente si la logique change', () => {
  const a = analyser('function f(list) { const out = []; let n = 0; for (const x of list) if (x > 2) out.push(x * 2); n = out.length; return [out, n]; }');
  const b = analyser('function g(items) { const res = []; let k = 0; for (const it of items) if (it > 2) res.push(it * 2); k = res.length; return [res, k]; }');
  const c = analyser('function g(items) { const res = []; let k = 0; for (const it of items) if (it > 3) res.push(it * 2); k = res.length; return [res, k]; }');
  assert.equal(a.fonctions[0].empreinte, b.fonctions[0].empreinte);
  assert.notEqual(a.fonctions[0].empreinte, c.fonctions[0].empreinte);
});

test('scriptsDeLaPage : chemins relatifs à la page, scripts en ligne, externes et modules ignorés', () => {
  const html = '<script>var a;</script><script src="../js/core/util.js"></script><script src="js/desk/main.js?v=2"></script>'
    + '<script src="https://cdn.example/x.js"></script><script type="module" src="m.js"></script>';
  assert.deepEqual(scriptsDeLaPage('coach-web/index.html', html), ['js/core/util.js', 'coach-web/js/desk/main.js']);
});

// ── 1. Couches ─────────────────────────────────────────────

test('couches : chemin → couche', () => {
  assert.deepEqual(['js/data/a.js', 'js/core/b.js', 'coach-web/js/desk/c.js', 'sw.js'].map(coucheDe), ['data', 'core', 'desk', 'autre']);
});

test('couche-dom : seulement dans js/data', () => {
  const p = projet({ 'js/data/a.js': 'function f() { document.body.classList.add("x"); }', 'js/features/b.js': 'function g() { document.body.innerHTML = ""; }' });
  assert.deepEqual(cibles(regleDomDansData(p)), ['js/data/a.js document.body']);
});

test('couche-dependance : js/data ne lit ni js/ui ni js/features ; js/core ne lit pas js/data ; un nom aussi déclaré en bas est permis', () => {
  const p = projet({
    'js/core/u.js': 'function util() { return data.x; }',
    'js/data/d.js': 'let data = {};\nfunction calc() { return util() + ecran() + aussiEnData(); }',
    'js/data/e.js': 'function aussiEnData() { return 1; }',
    'js/features/f.js': 'function ecran() { return calc(); }\nfunction aussiEnData() { return 2; }',
    'js/ui/g.js': 'function h() { return ecran(); }',
  });
  assert.deepEqual(cibles(regleDependancesDeCouche(p)), ['js/core/u.js data', 'js/data/d.js ecran']);
});

test('capacitor : seulement dans js/platform', () => {
  const p = projet({
    'js/platform/native.js': 'const cap = window.Capacitor;',
    'js/features/a.js': 'function f() { return window.Capacitor?.Plugins; }',
    'js/data/b.js': 'function g() { return Capacitor.isNativePlatform(); }\nconst m = "@capacitor/core";',
  });
  assert.deepEqual(cibles(regleCapacitor(p)), ['js/data/b.js @capacitor/core', 'js/data/b.js Capacitor', 'js/features/a.js .Capacitor']);
});

test('desk-reutilise : même nom ou même logique qu\'une fonction de js/data', () => {
  const p = projet({
    'js/data/d.js': 'function total(list) { let s = 0; const n = list.length; for (const x of list) s += x.kg * x.reps; return Math.round(s / n); }\nfunction fmt() {}',
    'coach-web/js/desk/a.js': 'function deskTotal(rows) { let t = 0; const c = rows.length; for (const r of rows) t += r.kg * r.reps; return Math.round(t / c); }',
    'coach-web/js/desk/b.js': 'function fmt() {}',
    'coach-web/js/desk/c.js': 'function deskAutre(rows) { let t = 0; const c = rows.length; for (const r of rows) t += r.kg; return Math.round(t * c); }',
  });
  assert.deepEqual(cibles(regleDeskReutilise(p)), ['coach-web/js/desk/a.js deskTotal', 'coach-web/js/desk/b.js fmt']);
});

// ── 2. Taille ──────────────────────────────────────────────

test('taille : limite générale, limite stricte, CSS', () => {
  const p = projet({ 'js/data/a.js': 'x;\n'.repeat(12), 'js/data/b.js': 'x;\n'.repeat(5), 'js/data/c.js': 'x;\n'.repeat(5) }, { css: { 'css/a.css': 11, 'css/b.css': 3 } });
  const v = regleTaille(p, { js: 10, css: 10, strictes: { 'js/data/b.js': 4 } });
  assert.deepEqual(v.map(x => `${x.fichier} ${x.lignes}`), ['js/data/a.js 13', 'js/data/b.js 6', 'css/a.css 11']);
});

// ── 3. Ordre de chargement ──────────────────────────────────

test('ordre-chargement : lecture au chargement d\'un fichier chargé après, ou pas chargé du tout', () => {
  const sources = {
    'js/a.js': 'const A = 1;\nconst tot = plusTard();\nfunction usesB() { return B; }',
    'js/b.js': 'const B = A + 1;\nfunction plusTard() { return 2; }\nconst ok = usesB();',
    'js/c.js': 'const C = absent();',
    'js/d.js': 'function absent() { return 0; }',
  };
  const v = regleOrdreDeChargement(projet(sources, { pages: { 'p.html': ['js/a.js', 'js/b.js', 'js/c.js'] } }));
  assert.deepEqual(v.map(x => `${x.fichier} ${x.cible}`), ['js/a.js plusTard', 'js/c.js absent']);
  assert.match(v[1].message, /pas chargé par cette page/);
});

test('ordre-chargement : un appel au chargement suit le corps de la fonction appelée, de fichier en fichier', () => {
  const sources = {
    'js/a.js': 'function lire() { return aide(); }\nfunction aide() { return TARD; }',
    'js/b.js': 'const x = lire();',
    'js/c.js': 'const TARD = 1;\ndocument.addEventListener("click", () => lire());',
  };
  const v = regleOrdreDeChargement(projet(sources, { pages: { 'p.html': ['js/a.js', 'js/b.js', 'js/c.js'] } }));
  assert.deepEqual(v.map(x => `${x.fichier} ${x.cible}`), ['js/b.js TARD']);
  assert.match(v[0].message, /via lire → aide/);
  const ok = regleOrdreDeChargement(projet(sources, { pages: { 'p.html': ['js/a.js', 'js/c.js', 'js/b.js'] } }));
  assert.deepEqual(ok, [], 'dans le bon ordre : rien');
});

// ── 4. Duplication ─────────────────────────────────────────

test('collision : même nom déclaré par deux fichiers d\'une même page', () => {
  const p = projet({ 'js/a.js': 'function f() {}', 'js/b.js': 'const f = 1;', 'js/c.js': 'function f() {}' }, { pages: { 'p.html': ['js/a.js', 'js/b.js'], 'q.html': ['js/c.js'] } });
  assert.deepEqual(regleCollisions(p).map(x => `${x.page} ${x.fichier} ${x.cible}`), ['p.html js/b.js f']);
});

test('duplication : logique de js/ (hors js/data, qui a sa règle) recopiée dans coach-web/js', () => {
  const corps = '{ const out = []; const sep = ","; for (const x of list) if (x.on) out.push(x.id); return out.join(sep); }';
  const p = projet({
    'js/ui/a.js': `function ids(list) ${corps}`,
    'js/data/b.js': `function idsData(list) ${corps.replace('x.id', 'x.key')}`,
    'coach-web/js/desk/c.js': `function deskIds(list) ${corps}\nfunction deskKeys(list) ${corps.replace('x.id', 'x.key')}`,
  });
  assert.deepEqual(cibles(regleDuplicationAppSite(p)), ['coach-web/js/desk/c.js deskIds']);
});

// ── 5. Docs ────────────────────────────────────────────────

test('docs : chemin complet, ou nom en code dans la section de son dossier ; coach-web dans COACH_WEB.md', () => {
  const docs = {
    'ARCHITECTURE.md': '# A\n\n### js/data/\n\n| `a.js` | rôle |\n\n### js/ui/\n\n| `x.js` | rôle |\n\nAilleurs : js/features/c.js\n',
    'docs/COACH_WEB.md': 'coach-web/js/desk/main.js\nshell.js, api.js\n',
  };
  const p = projet({
    'js/data/a.js': '', 'js/data/b.js': '', 'js/ui/a.js': '', 'js/features/c.js': '',
    'coach-web/js/desk/main.js': '', 'coach-web/js/desk/api.js': '', 'coach-web/js/desk/oubli.js': '',
  }, { docs });
  assert.deepEqual(regleDocs(p).map(x => x.fichier), ['js/data/b.js', 'js/ui/a.js', 'coach-web/js/desk/oubli.js']);
});

// ── Exceptions ─────────────────────────────────────────────

test('exceptions : couvrent la violation, plafond de taille, périmées signalées', () => {
  const v = [
    { regle: 'couche-dom', fichier: 'js/data/a.js', cible: '.innerHTML' },
    { regle: 'couche-dom', fichier: 'js/data/a.js', cible: 'document.body' },
    { regle: 'couche-dependance', fichier: 'js/data/b.js', cible: 'ecran' },
    { regle: 'taille', fichier: 'js/c.js', lignes: 900, message: '' },
    { regle: 'taille', fichier: 'js/d.js', lignes: 1200, message: '' },
  ];
  const ex = [
    { regle: 'couche-dom', fichier: 'js/data/a.js' },                                   // tout le fichier
    { regle: 'couche-dependance', fichier: 'js/data/b.js', cible: 'autre' },            // autre nom : ne couvre pas
    { regle: 'taille', fichier: 'js/c.js', plafond: 1000 },
    { regle: 'taille', fichier: 'js/d.js', plafond: 1000 },                             // dépassé
    { regle: 'taille', fichier: 'js/e.js', plafond: 1000 },                             // plus rien à excuser
  ];
  const r = appliquerExceptions(v.map(x => ({ ...x })), ex);
  assert.deepEqual(r.restantes.map(x => `${x.fichier} ${x.cible ?? ''}`.trim()), ['js/data/b.js ecran', 'js/d.js']);
  assert.match(r.restantes[1].message, /plafond/);
  assert.deepEqual(r.perimees.map(e => e.fichier), ['js/data/b.js', 'js/e.js']);
});

test('exceptions : raison, date et plafond obligatoires', () => {
  const p = verifierExceptions([
    { regle: 'taille', fichier: 'js/a.js', raison: 'une raison assez longue pour passer', date: '2026-11-25' },
    { regle: 'couche-dom', fichier: 'js/data/a.js', raison: 'court', date: '25/11' },
  ]);
  assert.equal(p.length, 3);
});

test('verifierProjet : projet propre → aucune violation', () => {
  const p = projet({
    'js/core/util.js': 'function esc(s) { return String(s); }',
    'js/data/store.js': 'let data = load();\nfunction load() { return { n: esc(1) }; }',
    'js/features/home.js': 'function render() { document.body.innerHTML = esc(data.n); }',
  }, { pages: { 'index.html': ['js/core/util.js', 'js/data/store.js', 'js/features/home.js'] }, docs: { 'ARCHITECTURE.md': 'js/core/util.js js/data/store.js js/features/home.js' } });
  const r = verifierProjet(p, { limites: { js: 800, css: 800, strictes: {} }, exceptions: [] });
  assert.deepEqual(r.violations, []);
});
