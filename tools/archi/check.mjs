#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  Contrôle d'architecture : les règles d'ARCHITECTURE.md vérifiées sur le code, sans navigateur (quelques secondes)
//
//  node tools/archi/check.mjs [racine du dépôt] [--json] [--modules <dossier node_modules>]
//    → liste des violations, code 1 s'il en reste une (ou une exception périmée ou mal écrite).
//
//  Règles (détail et raisons : tools/archi/regles.mjs ; limites et exceptions : tools/archi/exceptions.mjs) :
//    1. couches      : js/data sans DOM (couche-dom) ; js/platform, js/core et js/data ne lisent rien d'une couche
//                      plus haute (couche-dependance) ; Capacitor seulement dans js/platform (capacitor) ;
//                      coach-web/js/desk réutilise js/data au lieu de le réécrire (desk-reutilise) ;
//    2. taille       : 800 lignes au plus par fichier JS ou CSS, 400 pour ceux que les tests bornent déjà ;
//    3. dépendances  : le code exécuté au chargement ne lit que des fichiers chargés avant lui, page par page
//                      (ordre-chargement : pas de cycle au chargement dans l'ordre des <script>) ;
//    4. duplication  : même nom déclaré deux fois sur une page (collision), logique de js/ recopiée dans
//                      coach-web/js (duplication) ;
//    5. docs         : chaque fichier de js/ et coach-web/js/ cité dans ARCHITECTURE.md ou docs/COACH_WEB.md.
//  Lancé par la CI (tests.yml, job unit) et par controles.sh avant chaque publication. Tests : check.test.mjs.
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargerOutils, analyserFichier } from './analyse.mjs';
import { verifierProjet } from './regles.mjs';
import { LIMITES, EXCEPTIONS } from './exceptions.mjs';

export const PAGES = ['index.html', 'coach-web/index.html'];
export const DOSSIERS_JS = ['js', 'coach-web/js'];
export const DOSSIERS_CSS = ['css', 'coach-web/css'];
export const DOCS = ['ARCHITECTURE.md', 'docs/COACH_WEB.md'];

function fichiersDe(racine, dossier, ext) {
  const sortie = [];
  const parcours = d => {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) parcours(p);
      else if (p.endsWith(ext)) sortie.push(path.relative(racine, p).split(path.sep).join('/'));
    }
  };
  parcours(path.join(racine, dossier));
  return sortie;
}

/** <script src> classiques d'une page, dans l'ordre, en chemins du dépôt (les scripts en ligne et externes sont ignorés). */
export function scriptsDeLaPage(page, html) {
  const scripts = [];
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    const src = (m[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!src || /^(https?:)?\/\//.test(src) || /\btype\s*=\s*["']?module/i.test(m[1])) continue;
    scripts.push(path.posix.normalize(path.posix.join(path.posix.dirname(page), src.split(/[?#]/)[0])).replace(/^\//, ''));
  }
  return scripts;
}

/** Lit le dépôt et analyse chaque fichier : le projet des règles (regles.mjs). */
export function lireProjet(racine, outils) {
  const fichiers = new Map(), illisibles = [];
  for (const chemin of DOSSIERS_JS.flatMap(d => fichiersDe(racine, d, '.js'))) {
    try { fichiers.set(chemin, analyserFichier(fs.readFileSync(path.join(racine, chemin), 'utf8'), outils)); }
    catch (e) { illisibles.push(`${chemin} : ${e.message}`); }
  }
  const css = new Map(DOSSIERS_CSS.flatMap(d => fichiersDe(racine, d, '.css')).map(c => {
    const t = fs.readFileSync(path.join(racine, c), 'utf8');
    return [c, t.split('\n').length - (t.endsWith('\n') ? 1 : 0)];
  }));
  const pages = PAGES.filter(p => fs.existsSync(path.join(racine, p)))
    .map(page => ({ page, scripts: scriptsDeLaPage(page, fs.readFileSync(path.join(racine, page), 'utf8')) }));
  const docs = Object.fromEntries(DOCS.map(d => [d, fs.existsSync(path.join(racine, d)) ? fs.readFileSync(path.join(racine, d), 'utf8') : '']));
  return { fichiers, css, pages, docs, illisibles };
}

function principal() {
  const args = process.argv.slice(2);
  const iMod = args.indexOf('--modules');
  const modules = iMod >= 0 ? args.splice(iMod, 2)[1] : null;
  const json = args.includes('--json');
  const racine = path.resolve(args.find(a => !a.startsWith('--')) || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const outils = chargerOutils(modules || path.join(racine, 'node_modules'));
  const projet = lireProjet(racine, outils);
  const r = verifierProjet(projet, { limites: LIMITES, exceptions: EXCEPTIONS });
  const echec = r.violations.length + r.perimees.length + r.problemesExceptions.length + projet.illisibles.length;
  if (json) {
    console.log(JSON.stringify({ fichiers: projet.fichiers.size, ...r, illisibles: projet.illisibles }, null, 1));
  } else {
    console.log(`Architecture : ${projet.fichiers.size} fichiers JS, ${projet.css.size} CSS, ${projet.pages.length} pages ; `
      + `${r.violations.length} violation(s), ${r.exceptionsUtilisees} exception(s) documentée(s) (tools/archi/exceptions.mjs)`);
    for (const x of projet.illisibles) console.log(`ILLISIBLE ${x}`);
    for (const x of r.violations) console.log(`VIOLATION [${x.regle}] ${x.fichier}${x.ligne ? ':' + x.ligne : ''} : ${x.message}`);
    for (const e of r.perimees) console.log(`EXCEPTION PÉRIMÉE [${e.regle}] ${e.fichier}${e.cible ? ' ' + e.cible : ''} : plus rien à excuser, la retirer de tools/archi/exceptions.mjs`);
    for (const p of r.problemesExceptions) console.log(`EXCEPTION MAL ÉCRITE ${p}`);
    if (r.violations.length) console.log('\nCorriger, ou (si la correction n\'est ni simple ni sûre) ajouter une exception avec sa raison et sa date dans tools/archi/exceptions.mjs.');
  }
  process.exit(echec ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal();
