// Hébergement sur Cloudflare Pages (docs/HEBERGEMENT.md) : traduction des vercel.json en _headers et _redirects
// (scripts/pages-headers.mjs), et contenu du site public construit (en-têtes identiques à la source, aucun fichier
// que Vercel ne servait pas, adresses en .html gardées).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { vercelToPages, pagesPattern, htmlRewrites } from '../../scripts/pages-headers.mjs';

export default function ({ test, assert, ROOT }) {
  const json = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

  test('Pages : motifs de Vercel traduits, les autres refusés', () => {
    assert.equal(pagesPattern('/(.*)'), '/*');
    assert.equal(pagesPattern('/js/(.*)'), '/js/*');
    assert.equal(pagesPattern('/bundles/(.*)'), '/bundles/*');
    assert.equal(pagesPattern('/sw.js'), '/sw.js');
    for (const bad of ['/(.*).js', '/:path*', '/a/(.*)/b', 'sans-barre']) assert.throws(() => pagesPattern(bad), /non traduit/);
  });

  test('Pages : en-tête posé par deux règles qui se recouvrent refusé (Pages joindrait les valeurs)', () => {
    const cfg = { headers: [
      { source: '/(.*)', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/sw.js', headers: [{ key: 'cache-control', value: 'no-store' }] },
    ] };
    assert.throws(() => vercelToPages(cfg), /Pages joindrait/);
    cfg.headers[1].headers[0].key = 'X-Autre';
    assert.ok(vercelToPages(cfg).headers.includes('/sw.js\n  X-Autre: no-store'));
  });

  test('Pages : clé vercel.json inconnue ou redirection à motif refusées, git et crons ignorés', () => {
    assert.throws(() => vercelToPages({ rewrites: [] }), /non traduite/);
    assert.throws(() => vercelToPages({ redirects: [{ source: '/a/:x', destination: '/b/:x' }] }), /à motif/);
    assert.equal(vercelToPages({ git: { deploymentEnabled: false }, crons: [], cleanUrls: true }).redirects, '');
    assert.equal(vercelToPages({ cleanUrls: true, redirects: [{ source: '/vieux', destination: 'https://coach.mdlf.app/', permanent: true }] }).redirects,
      '/vieux https://coach.mdlf.app/ 308\n');
  });

  test('Pages : sans cleanUrls, chaque page .html garde son adresse (réécriture 200), sauf 404.html', () => {
    assert.deepEqual(htmlRewrites(['index.html', 'privacy.html', '404.html', 'sw.js', 'a/index.html', 'a/b.html']),
      ['/a/b.html /a/b 200', '/a/index.html /a/ 200', '/index.html / 200', '/privacy.html /privacy 200']);
    assert.equal(vercelToPages({ cleanUrls: true }, ['privacy.html']).redirects, '', 'cleanUrls : comportement natif de Pages');
  });

  test('Pages : les vercel.json du coach et du site public se traduisent, chaque en-tête recopié à l\'identique', () => {
    for (const f of ['coach-web/vercel.json', 'web-public/vercel.json']) {
      const cfg = json(f), out = vercelToPages(cfg, ['index.html']).headers;
      for (const rule of cfg.headers) for (const h of rule.headers) {
        assert.ok(out.includes(`  ${h.key}: ${h.value}\n`), `${f} : ${h.key}`);
      }
    }
    // La CSP du site public garde son empreinte sha256 (script en ligne de index.html)
    assert.match(vercelToPages(json('web-public/vercel.json')).headers, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  });

  test('Pages : Cache-Control explicite partout (la zone mdlf.app étend à 4 h un max-age=0, pas no-cache)', () => {
    for (const f of ['coach-web/vercel.json', 'web-public/vercel.json']) {
      const all = json(f).headers.find(r => r.source === '/(.*)').headers;
      assert.ok(all.some(h => h.key === 'Cache-Control' && h.value === 'no-cache'), f);
    }
  });

  test('Pages : sites construits sans vercel.json ni README, avec 404.html, _headers et _redirects', () => {
    execFileSync('node', [path.join(ROOT, 'scripts/build-web-public.mjs')], { cwd: ROOT, stdio: 'pipe' });
    const web = fs.readdirSync(path.join(ROOT, 'dist-web'));
    for (const f of ['index.html', 'privacy.html', 'cgv.html', 'legal.css', '404.html', '_headers', '_redirects']) assert.ok(web.includes(f), `dist-web/${f}`);
    for (const f of ['vercel.json', 'README.md']) assert.ok(!web.includes(f), `dist-web/${f} ne doit pas être servi`);
    const redirects = fs.readFileSync(path.join(ROOT, 'dist-web/_redirects'), 'utf8');
    assert.ok(redirects.includes('/privacy.html /privacy 200'), 'adresse déclarée à l\'App Store gardée');
  });

  test('Pages : publications de la CI après les gardes, version de wrangler figée, OTA aux deux adresses', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/tests.yml'), 'utf8');
    const ota = fs.readFileSync(path.join(ROOT, '.github/workflows/ota.yml'), 'utf8');
    const guard = ci.indexOf('node scripts/check-legal-pages.mjs privacy.html');
    assert.ok(guard > 0 && guard < ci.indexOf('node scripts/build-web-public.mjs'), 'garde juridique avant la construction de mdlf.app');
    for (const wf of [ci, ota]) {
      const versions = [...wf.matchAll(/wrangler@([^\s]+)/g)].map(m => m[1]);
      assert.ok(versions.length && versions.every(v => /^\d+\.\d+\.\d+$/.test(v)), `wrangler figé : ${versions}`);
    }
    assert.match(ci, /coach-web-deploy:[\s\S]*needs: \[unit, e2e, coach-web, edge\]/, 'coach publié après tous les tests');
    // Pages avant Vercel, puis vérification aux deux adresses
    assert.ok(ota.indexOf('--project-name mdlf-ota') < ota.indexOf('vercel@'), 'Pages publié avant Vercel');
    assert.ok(ota.includes('for HOST in ota.mdlf.app mdlf-ota.vercel.app'), 'manifeste vérifié aux deux adresses');
  });
}
