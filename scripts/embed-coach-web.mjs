// Mode coach grand écran (iPad, tablettes ; docs/COACH_IPAD.md) : embarque l'appli web du coach dans le contenu de
// l'app, à dist/coach/. Appelé par scripts/build-web.mjs (app iOS et Android), jamais publié sur le site.
//
// Même sortie que le site (scripts/build-coach-web.mjs : page, styles, scripts partagés exacts, supabase-js), puis
// trois changements, et seulement ceux-là, pour la copie embarquée :
//  - sans en-têtes ni 404.html (headers: 'none' : la vue web de l'app sert les fichiers elle-même) ;
//  - CSP resserrée : script-src 'self' seul (le script de Sign in with Apple JS n'est jamais chargé, la session
//    vient de l'app : rien ne vient du site distant), img-src avec blob: (photos de bilan déchiffrées par l'app,
//    point d'accroche « photos » de docs/COACH_IPAD.md) ;
//  - deux scripts de liaison avec l'app (coach-embed/) : bridge-start.js seul au chargement, qui charge les scripts de
//    la page (gardés dans un <template>) puis bridge-end.js, une fois la session reçue par postMessage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCoachWeb } from './build-coach-web.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EMBED_DIR = 'coach';
export const BRIDGES = ['bridge-start.js', 'bridge-end.js'];

// CSP de la copie embarquée, à partir de celle du site : rend la politique modifiée (chaîne)
export function embedPolicy(policy) {
  const dirs = policy.split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]);
  const get = name => {
    const d = dirs.find(x => x[0] === name);
    if (!d) throw new Error(`CSP de coach-web : ${name} absent`);
    return d;
  };
  const script = get('script-src');
  script.splice(1, script.length - 1, "'self'");
  const img = get('img-src');
  if (!img.includes('blob:')) img.push('blob:');
  if (get('frame-src')[1] !== "'none'") throw new Error('CSP de coach-web : frame-src doit rester fermé');
  return dirs.map(d => d.join(' ')).join('; ');
}

// Page embarquée, à partir de la page construite pour le site : CSP resserrée, puis tous les scripts de la page
// (et bridge-end.js à la fin) rangés inertes dans <template id="mdlf-embed-scripts"> ; seul bridge-start.js s'exécute
// au chargement et les charge, dans le même ordre, une fois la session reçue de l'app (cadre isolé : postMessage)
export function embedHtml(html) {
  const meta = /(<meta http-equiv="Content-Security-Policy" content=")([^"]+)(">)/;
  if (!meta.test(html)) throw new Error('coach-web : balise CSP introuvable');
  const out = html.replace(meta, (_, a, p, b) => a + embedPolicy(p) + b);
  const tag = /[ \t]*<script src="[^"]+"><\/script>\n?/g;
  const tags = out.match(tag) || [];
  if (!tags.length || !/src="js\/desk\/main\.js"/.test(tags.at(-1))) {
    throw new Error('coach-web : js/desk/main.js doit être le dernier script de la page');
  }
  if (/<script(?![^>]*\ssrc=)/.test(out.replace(tag, ''))) throw new Error('coach-web : script en ligne inattendu');
  const first = out.search(tag);
  const rest = out.replace(tag, '');
  const scripts = tags.map(t => '    ' + t.trim()).join('\n') + '\n    <script src="js/embed/bridge-end.js"></script>';
  const block = `<template id="mdlf-embed-scripts">\n${scripts}\n  </template>\n  <script src="js/embed/bridge-start.js"></script>\n`;
  return rest.slice(0, first) + '  ' + block + rest.slice(first);
}

export function embedCoachWeb(dist) {
  const out = path.join(dist, EMBED_DIR);
  const n = buildCoachWeb(out, { headers: 'none' });
  fs.mkdirSync(path.join(out, 'js', 'embed'), { recursive: true });
  for (const f of BRIDGES) fs.copyFileSync(path.join(ROOT, 'coach-embed', f), path.join(out, 'js', 'embed', f));
  const page = path.join(out, 'index.html');
  const html = embedHtml(fs.readFileSync(page, 'utf8'));
  fs.writeFileSync(page, html);
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css))"/g)].map(m => m[1]);
  const missing = refs.filter(r => !fs.existsSync(path.join(out, r)));
  if (missing.length) throw new Error(`Mode coach grand écran : références absentes de ${EMBED_DIR}/ : ${missing.join(', ')}`);
  return n;
}
