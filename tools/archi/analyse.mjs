// ═══════════════════════════════════════════════════════════
//  Analyse d'un fichier JS (script classique) pour le contrôle d'architecture (check.mjs)
//
//  Lecture seule, sans réseau : acorn (analyse syntaxique) et eslint-scope (portées), tous deux déjà installés
//  avec ESLint (aucune dépendance ajoutée). Rend, pour un fichier :
//    - decls      : noms déclarés au premier niveau (function, class, var/let/const, window.X = …) ;
//    - refs       : noms externes lus (déclarés hors du fichier) → première ligne ;
//    - chargement : noms externes exécutés AU CHARGEMENT : hors fonction, dans une fonction appelée tout de suite
//                   (IIFE) ou dans une fonction du fichier appelée au premier niveau ; un nom gardé par
//                   `typeof X` dans la même fonction est supposé protégé ;
//    - parFonction: pour chaque fonction de premier niveau, les noms externes qu'elle lit directement (hors
//                   rappels) : sert à suivre un appel fait au chargement vers une fonction d'un autre fichier ;
//    - internes   : pour chaque fonction de premier niveau, les fonctions du même fichier qu'elle appelle ;
//    - dom, capacitor : usages du DOM et de Capacitor ;
//    - fonctions  : fonctions nommées assez longues, avec l'empreinte de leur AST normalisé (logique recopiée).
// ═══════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

/** Charge acorn et eslint-scope depuis un dossier node_modules (celui du dépôt par défaut). */
export function chargerOutils(nodeModules) {
  const req = createRequire(path.join(path.resolve(nodeModules), '_archi.cjs'));
  return { acorn: req('acorn'), eslintScope: req('eslint-scope') };
}

// Propriétés qui lisent ou écrivent l'écran, quel que soit l'objet (élément, document…)
export const PROPRIETES_DOM = new Set([
  'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'insertAdjacentElement', 'insertAdjacentText',
  'querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName', 'getElementsByTagName', 'classList',
]);
// Globales de l'écran : `$` et `$$` sont les raccourcis de querySelector (js/core/util.js)
const GLOBALES_DOM = new Set(['$', '$$', 'getComputedStyle']);
// Fonctions longues seulement pour les doublons de logique (même seuil qu'Outils/doublons)
const FONCTION_MIN_INSTRUCTIONS = 4, FONCTION_MIN_CARACTERES = 120;

const estFonction = n => !!n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');
const enfants = n => {
  const sortie = [];
  for (const k in n) {
    if (k === 'parent') continue;
    const v = n[k];
    if (Array.isArray(v)) { for (const e of v) if (e && typeof e.type === 'string') sortie.push(e); }
    else if (v && typeof v.type === 'string') sortie.push(v);
  }
  return sortie;
};

// Fonction appelée tout de suite : (function () { … })(), (() => { … })(), (function () { … }).call(this)
function estIIFE(fn, parent) {
  if (parent?.type === 'CallExpression' && parent.callee === fn) return true;
  if (parent?.type === 'MemberExpression' && parent.object === fn && !parent.computed && /^(call|apply)$/.test(parent.property.name)) {
    const appel = parent.parent;
    return appel?.type === 'CallExpression' && appel.callee === parent;
  }
  return false;
}

// Seuls usages de `document` admis hors écran : le cycle de vie de l'app (premier plan, arrière-plan) et un canvas
// hors écran pour réduire une image (calcul, rien d'affiché).
function usageDocumentAdmis(id) {
  const m = id.parent;
  if (m?.type !== 'MemberExpression' || m.object !== id || m.computed) return false;
  const p = m.property.name;
  if (p === 'visibilityState' || p === 'hidden') return true;
  const appel = m.parent?.type === 'ChainExpression' ? m.parent.parent : m.parent;
  const arg = appel?.type === 'CallExpression' ? appel.arguments[0] : null;
  if ((p === 'addEventListener' || p === 'removeEventListener') && arg?.value === 'visibilitychange') return true;
  return p === 'createElement' && arg?.value === 'canvas';
}

function estAppel(id) {
  let n = id, p = id.parent;
  if (p?.type === 'ChainExpression') { n = p; p = p.parent; }
  return (p?.type === 'CallExpression' || p?.type === 'NewExpression') && p.callee === n;
}

function nomsDuMotif(motif, sortie = []) {
  if (!motif) return sortie;
  if (motif.type === 'Identifier') sortie.push(motif.name);
  else if (motif.type === 'ObjectPattern') for (const p of motif.properties) nomsDuMotif(p.type === 'RestElement' ? p.argument : p.value, sortie);
  else if (motif.type === 'ArrayPattern') for (const e of motif.elements) nomsDuMotif(e, sortie);
  else if (motif.type === 'AssignmentPattern') nomsDuMotif(motif.left, sortie);
  else if (motif.type === 'RestElement') nomsDuMotif(motif.argument, sortie);
  return sortie;
}

/** Déclarations de premier niveau : [{ nom, ligne, fonction }] (fonction = le nœud quand c'en est une). */
function declarations(ast) {
  const decls = [];
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') {
      decls.push({ nom: n.id.name, ligne: n.loc.start.line, fonction: n.type === 'FunctionDeclaration' ? n : null });
    } else if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations) {
        const fn = d.id.type === 'Identifier' && estFonction(d.init) ? d.init : null;
        for (const nom of nomsDuMotif(d.id)) decls.push({ nom, ligne: d.loc.start.line, fonction: fn });
      }
    } else if (n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression') {
      const g = n.expression.left;   // window.X = … / globalThis.X = …
      if (g.type === 'MemberExpression' && !g.computed && g.object.type === 'Identifier' && /^(window|globalThis|self)$/.test(g.object.name)) {
        decls.push({ nom: g.property.name, ligne: n.loc.start.line, fonction: estFonction(n.expression.right) ? n.expression.right : null });
      }
    }
  }
  return decls;
}

// Empreinte d'une fonction (comme Outils/doublons) : positions et commentaires ignorés, identifiants LOCAUX
// (paramètres, variables internes) renommés $0, $1… dans l'ordre d'apparition ; globales, propriétés et littéraux gardés.
function empreinte(fn, scopeManager) {
  const locaux = new Set();
  const visiter = s => { for (const v of s.variables) locaux.add(v.name); s.childScopes.forEach(visiter); };
  const s0 = scopeManager.acquire(fn);
  if (s0) visiter(s0);
  locaux.delete('arguments');
  const noms = new Map();
  const norm = n => {
    if (Array.isArray(n)) return n.map(norm);
    if (!n || typeof n !== 'object') return n;
    if (n.type === 'Identifier') {
      if (!locaux.has(n.name)) return 'I:' + n.name;
      if (!noms.has(n.name)) noms.set(n.name, '$' + noms.size);
      return 'L:' + noms.get(n.name);
    }
    const o = {};
    for (const k in n) if (k !== 'start' && k !== 'end' && k !== 'loc' && k !== 'range' && k !== 'raw' && k !== 'parent') o[k] = norm(n[k]);
    return o;
  };
  return crypto.createHash('sha1').update(JSON.stringify([norm(fn.params), norm(fn.body)])).digest('hex').slice(0, 16);
}

/** Analyse un fichier. Lève une erreur si le fichier ne se lit pas (erreur de syntaxe). */
export function analyserFichier(src, { acorn, eslintScope }) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, ranges: true, allowHashBang: true, allowReturnOutsideFunction: true });
  const decls = declarations(ast);
  const declares = new Set(decls.map(d => d.nom));
  const nomDeFonction = new Map(decls.filter(d => d.fonction).map(d => [d.fonction, d.nom]));

  // Un seul parcours : parents, fonction qui exécute chaque nœud (null = au chargement), gardes typeof, DOM,
  // Capacitor, appels internes, fonctions nommées
  const proprietaire = new WeakMap();
  const gardes = new Map();               // propriétaire (ou 'charge') → Set(noms gardés par typeof)
  const appelsInternes = new Map([...nomDeFonction.values()].map(n => [n, new Set()]));
  const appelsAuChargement = new Set();
  const dom = [], capacitor = [], aEmpreinte = [];
  const pile = [[ast, null, null]];
  while (pile.length) {
    const [n, parent, prop] = pile.pop();
    n.parent = parent;
    proprietaire.set(n, prop);
    const ligne = n.loc.start.line;
    if (n.type === 'UnaryExpression' && n.operator === 'typeof' && n.argument.type === 'Identifier') {
      const cle = prop || 'charge';
      if (!gardes.has(cle)) gardes.set(cle, new Set());
      gardes.get(cle).add(n.argument.name);
    } else if (n.type === 'MemberExpression' && !n.computed) {
      if (PROPRIETES_DOM.has(n.property.name)) dom.push({ ligne, quoi: '.' + n.property.name });
      if (n.property.name === 'Capacitor') capacitor.push({ ligne, quoi: '.Capacitor' });
    } else if (n.type === 'Literal' && typeof n.value === 'string' && /^@capacitor(-community)?\//.test(n.value)) {
      capacitor.push({ ligne, quoi: n.value });
    } else if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && appelsInternes.has(n.callee.name)) {
      if (!prop) appelsAuChargement.add(n.callee.name);
      else if (nomDeFonction.has(prop)) appelsInternes.get(nomDeFonction.get(prop)).add(n.callee.name);
    }
    let nom = null, fn = null;
    if (n.type === 'FunctionDeclaration' && n.id) { nom = n.id.name; fn = n; }
    else if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && estFonction(n.init)) { nom = n.id.name; fn = n.init; }
    else if ((n.type === 'Property' || n.type === 'MethodDefinition') && !n.computed && estFonction(n.value)) { nom = n.key.name ?? n.key.value; fn = n.value; }
    if (fn?.body.type === 'BlockStatement' && (fn.body.body.length >= FONCTION_MIN_INSTRUCTIONS || fn.body.end - fn.body.start >= FONCTION_MIN_CARACTERES)) {
      aEmpreinte.push({ nom: String(nom), fn });
    }
    const propEnfants = estFonction(n) && !estIIFE(n, parent) ? n : prop;
    for (const e of enfants(n)) pile.push([e, n, propEnfants]);   // parent.parent déjà posé : estIIFE peut le lire
  }

  const scopeManager = eslintScope.analyze(ast, { ecmaVersion: 2023, sourceType: 'script' });
  const refs = new Map(), chargement = [], parFonction = new Map();
  for (const r of scopeManager.globalScope.through) {
    const id = r.identifier, nom = id.name, ligne = id.loc.start.line;
    if (id.parent?.type === 'UnaryExpression' && id.parent.operator === 'typeof') continue;
    if (declares.has(nom)) continue;
    if (nom === 'Capacitor') capacitor.push({ ligne, quoi: 'Capacitor' });
    if (nom === 'document' && !usageDocumentAdmis(id)) {
      const m = id.parent?.type === 'MemberExpression' && id.parent.object === id && !id.parent.computed ? '.' + id.parent.property.name : '';
      dom.push({ ligne, quoi: 'document' + m });
    }
    if (GLOBALES_DOM.has(nom)) dom.push({ ligne, quoi: nom + '()' });
    if (!refs.has(nom)) refs.set(nom, ligne);
    const prop = proprietaire.get(id);
    if (gardes.get(prop || 'charge')?.has(nom)) continue;
    const usage = { nom, ligne, appel: estAppel(id) };
    if (!prop) chargement.push(usage);
    else if (nomDeFonction.has(prop)) {
      const f = nomDeFonction.get(prop);
      if (!parFonction.has(f)) parFonction.set(f, []);
      parFonction.get(f).push(usage);
    }
  }
  // Fonctions du fichier appelées au chargement (et celles qu'elles appellent) : leurs lectures aussi
  const vues = new Set(), file = [...appelsAuChargement];
  while (file.length) {
    const f = file.pop();
    if (vues.has(f)) continue;
    vues.add(f);
    for (const u of parFonction.get(f) || []) chargement.push({ ...u, via: f });
    file.push(...appelsInternes.get(f));
  }

  // Une ligne ne compte qu'une fois par sorte d'usage (document.querySelector = document + .querySelector)
  const uniques = liste => [...new Map(liste.sort((a, b) => a.ligne - b.ligne).map(u => [u.ligne, u])).values()];
  return {
    lignes: src.split('\n').length - (src.endsWith('\n') ? 1 : 0),
    decls: decls.map(({ nom, ligne }) => ({ nom, ligne })),
    refs, chargement, parFonction,
    internes: new Map([...appelsInternes].map(([f, g]) => [f, [...g]])),
    dom: uniques(dom), capacitor: uniques(capacitor),
    fonctions: aEmpreinte.map(({ nom, fn }) => ({ nom, ligne: fn.loc.start.line, fin: fn.loc.end.line, empreinte: empreinte(fn, scopeManager) })),
  };
}
