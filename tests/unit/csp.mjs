// Content-Security-Policy de la WebView (index.html, audit du 12/11, m1). Une CSP mal tenue casse l'app
// en silence (script bloqué, appel réseau refusé) : on vérifie ici, sans navigateur, que
//  - l'empreinte sha256 du script en ligne est celle de la politique (toute modification du script l'exige) ;
//  - aucun gestionnaire on*= en ligne ne reste dans index.html ni dans le HTML produit par js/ ;
//  - script-src n'autorise ni 'unsafe-inline' ni 'unsafe-eval', ni aucun hôte extérieur ;
//  - chaque adresse réseau de l'app (Supabase, manifeste OTA, Open Food Facts) est permise par connect-src.
// Les violations réelles sont détectées par la suite E2E (tests/fixtures.py, Bench.page).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, assert, ROOT }) {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const html = read('index.html');
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  const policy = () => {
    assert.ok(meta, 'balise meta Content-Security-Policy absente de index.html');
    return Object.fromEntries(meta[1].split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]).map(([k, ...v]) => [k, v]));
  };

  test('CSP : présente avant tout script, default-src \'none\', object-src et base-uri fermés', () => {
    const p = policy();
    assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'la meta doit précéder le premier script');
    assert.deepEqual(p['default-src'], ["'none'"]);
    assert.deepEqual(p['object-src'], ["'none'"]);
    assert.deepEqual(p['base-uri'], ["'none'"]);
  });

  test('CSP : script-src limité aux fichiers du dépôt et à l\'empreinte du script en ligne', () => {
    const p = policy();
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(inline.length >= 1, 'script en ligne du thème attendu');
    const hashes = inline.map(s => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`);
    assert.deepEqual(p['script-src'].filter(s => s.startsWith("'sha256-")).sort(), [...hashes].sort(),
      `empreinte à mettre dans script-src : ${hashes.join(' ')}`);
    assert.deepEqual(p['script-src'].filter(s => !s.startsWith("'sha256-")), ["'self'"]);
    for (const src of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(!/^[a-z]+:/i.test(src[1]), `script extérieur : ${src[1]}`);
  });

  test('CSP : aucun gestionnaire on*= en ligne (index.html et HTML produit par js/)', () => {
    const attr = /<[a-z][^<>]*\son[a-z]+\s*=/gi;
    assert.deepEqual(html.match(attr) || [], [], 'index.html');
    const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
      .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
    const found = walk('js').flatMap(f => (read(f).match(attr) || []).map(m => `${f} : ${m.slice(0, 80)}`));
    assert.deepEqual(found, [], 'gestionnaire en ligne bloqué par la CSP');
  });

  test('CSP : connect-src permet chaque adresse appelée par l\'app, et rien d\'autre', () => {
    const p = policy();
    const origin = u => new URL(u).origin;
    const used = [
      read('js/data/account.js').match(/url: '(https:\/\/[^']+)'/)[1],
      read('js/app/live-update.js').match(/OTA_MANIFEST_URL\s*=\s*'([^']+)'/)[1],
      read('js/data/food-scan.js').match(/`(https:\/\/world\.openfoodfacts\.org)[^`]*`/)[1],
    ].map(origin);
    assert.deepEqual([...p['connect-src']].sort(), ["'self'", ...used].sort());
    // Photos de bilan (URL signées) et vidéos d'exercices : stockage Supabase seulement
    const sb = used[0];
    assert.deepEqual(p['img-src'], ["'self'", 'data:', 'blob:', sb]);
    assert.deepEqual(p['media-src'], ["'self'", sb]);
  });
}
