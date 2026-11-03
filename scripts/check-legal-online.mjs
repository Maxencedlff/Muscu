// Garde de la mise à jour à chaud (.github/workflows/ota.yml) : l'app ouvre les pages de LEGAL_URLS
// (js/data/legal-links.js) depuis les Réglages, l'écran d'abonnement (règle 3.1.2 d'Apple : lien
// fonctionnel vers les conditions) et la lettre. Les pages sont publiées par le job `deploy` de
// tests.yml, pas par l'OTA : si ce job a échoué (emplacement à compléter, panne Vercel), une OTA
// enverrait l'utilisateur vers une page 404. Ce script vérifie, AVANT toute publication, que chaque
// adresse répond en ligne (2xx après redirections) et que chaque ancre (#newsletter, #remboursement)
// existe dans la page servie. Testé par tests/unit/juridique.mjs (faux fetch, aucun réseau).
// Lancer : node scripts/check-legal-online.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Adresses de LEGAL_URLS lues dans le source de js/data/legal-links.js (seule liste de l'app)
export function legalUrlsFromSource(source) {
  const ctx = vm.createContext({});
  vm.runInContext(`${source}\nthis.__urls = LEGAL_URLS;`, ctx, { filename: 'legal-links.js' });
  return Object.values(ctx.__urls);
}

// Pages à télécharger (une fois chacune) et ancres attendues dans chacune
export function pagesToCheck(urls) {
  const pages = new Map();
  for (const raw of urls) {
    const u = new URL(raw);
    if (u.protocol !== 'https:') throw new Error(`adresse non https : ${raw}`);
    const anchor = decodeURIComponent(u.hash.slice(1));
    u.hash = '';
    const key = u.href;
    if (!pages.has(key)) pages.set(key, new Set());
    if (anchor) pages.get(key).add(anchor);
  }
  return [...pages].map(([url, anchors]) => ({ url, anchors: [...anchors] }));
}

const hasId = (html, id) => new RegExp(`\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(html);

// Problèmes trouvés en ligne : [] si toutes les pages répondent avec leurs ancres
export async function checkLegalOnline(urls, { fetchImpl = fetch, tries = 3, waitMs = 3000 } = {}) {
  const problems = [];
  for (const { url, anchors } of pagesToCheck(urls)) {
    let res = null, err = null;
    for (let i = 0; i < tries; i++) {
      try {
        res = await fetchImpl(url, { redirect: 'follow', headers: { 'cache-control': 'no-cache' } });
        err = null;
        if (res.ok) break;
      } catch (e) { err = e; res = null; }
      if (i < tries - 1 && waitMs) await new Promise(r => setTimeout(r, waitMs));
    }
    if (!res) { problems.push(`${url} : injoignable (${err?.message || err})`); continue; }
    if (!res.ok) { problems.push(`${url} : HTTP ${res.status}`); continue; }
    const html = await res.text();
    for (const a of anchors) if (!hasId(html, a)) problems.push(`${url}#${a} : ancre absente de la page en ligne`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const urls = legalUrlsFromSource(fs.readFileSync(path.join(ROOT, 'js/data/legal-links.js'), 'utf8'));
  const problems = await checkLegalOnline(urls);
  if (problems.length) {
    for (const p of problems) console.error(p);
    console.error(`\n${problems.length} page(s) juridique(s) absente(s) en ligne : mise à jour à chaud refusée. `
      + 'Publier d\'abord les pages (job deploy de tests.yml, docs/JURIDIQUE.md), puis relancer.');
    process.exit(1);
  }
  console.log(`Pages juridiques en ligne : ${urls.join(', ')}`);
}
