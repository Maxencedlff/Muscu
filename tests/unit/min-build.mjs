// Version minimale de l'app (js/data/min-build.js) : lecture de app_config.min_build, décision « mets à
// jour », lien App Store ou TestFlight. Règle centrale : serveur injoignable = jamais bloqué.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, assert, sameJSON, ROOT }) {
  // Faux client Supabase : rend la ligne demandée, une erreur, ou lève (réseau coupé)
  const fetchWith = async (mode, value) => {
    run(`globalThis.__minBuildAsked = []; sb = { from: t => { const q = { t, f: [] };
      const chain = { select: () => chain, eq: (k, v) => { q.f.push([k, v]); return chain; },
        maybeSingle: async () => { __minBuildAsked.push(q);
          if (${JSON.stringify(mode)} === 'throw') throw new TypeError('Failed to fetch');
          if (${JSON.stringify(mode)} === 'error') return { data: null, error: { message: 'TypeError: Failed to fetch' } };
          if (${JSON.stringify(mode)} === 'none') return { data: null, error: null };
          return { data: { value: ${JSON.stringify(value)} }, error: null }; } };
      return chain; } };`);
    try { return JSON.parse(JSON.stringify(await run('minBuildFetch()'))); } finally { run('sb = null'); }
  };

  test('min-build : valeur du serveur nettoyée (entier positif, sinon 0)', () => {
    const v = x => run(`minBuildValue(${JSON.stringify(x)})`);
    assert.equal(v(30), 30);
    assert.equal(v('30'), 30);          // '"30"'::jsonb : chaîne de chiffres acceptée
    assert.equal(v(' 31 '), 31);
    for (const bad of [0, -3, 2.5, '2.5', '', 'abc', '30a', null, true, false, {}, [30], 1e20, '1234567890'])
      assert.equal(v(bad), 0, `valeur ${JSON.stringify(bad)} : aucune version minimale`);
    assert.equal(run('minBuildValue(undefined)'), 0);
    assert.equal(run('minBuildValue(NaN)'), 0);
    assert.equal(run('minBuildValue(Infinity)'), 0);
  });

  test('min-build : bloqué seulement si la build installée est connue ET plus ancienne', () => {
    const b = (build, min) => run(`minBuildBlocks(${JSON.stringify(build)}, ${JSON.stringify(min)})`);
    assert.equal(b(25, 30), true);
    assert.equal(b(30, 30), false, 'build égale au minimum : à jour');
    assert.equal(b(31, 30), false);
    assert.equal(b(25, 0), false, 'min_build à 0 (valeur livrée) : jamais bloqué');
    assert.equal(b(null, 30), false, 'navigateur (pas de build native) : jamais bloqué');
    assert.equal(b(0, 30), false);
    assert.equal(b('25', 30), false, 'build illisible : jamais bloqué');
  });

  test('min-build : App Store pour une app de l\'App Store, TestFlight sinon', () => {
    const appStore = run('minBuildUpdateUrl("production")');
    assert.equal(appStore, 'https://apps.apple.com/app/id6823561962');
    assert.equal(appStore, `https://apps.apple.com/app/id${run('PLAN_APP_STORE_ID')}`);
    for (const env of ['sandbox', 'other', null, undefined])
      assert.equal(run(`minBuildUpdateUrl(${JSON.stringify(env)})`), run('TESTFLIGHT_URL'), `environnement ${env} : TestFlight`);
    assert.match(run('TESTFLIGHT_URL'), /^https:\/\/testflight\.apple\.com\/join\/\w+$/);
  });

  test('min-build : lecture de la seule ligne min_build, valeur nettoyée', async () => {
    sameJSON(await fetchWith('row', 30), { ok: true, min: 30 });
    sameJSON(run('__minBuildAsked'), [{ t: 'app_config', f: [['key', 'min_build']] }]);
    sameJSON(await fetchWith('row', 0), { ok: true, min: 0 });
    sameJSON(await fetchWith('row', 'n\'importe quoi'), { ok: true, min: 0 });
    sameJSON(await fetchWith('none'), { ok: true, min: 0 }, 'ligne absente : aucune version minimale');
  });

  test('min-build : serveur injoignable ou pas de client = jamais bloqué, rien gardé sur l\'appareil', async () => {
    sameJSON(await fetchWith('error'), { ok: false });
    sameJSON(await fetchWith('throw'), { ok: false });
    run('sb = null');
    sameJSON(JSON.parse(JSON.stringify(await run('minBuildFetch()'))), { ok: false });
    // Aucune valeur gardée : au démarrage hors ligne, rien ne peut bloquer
    await fetchWith('row', 99);
    const keys = run('Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))');
    assert.ok(!keys.some(k => /min.?build/i.test(k)), `clé gardée : ${keys}`);
  });

  test('min-build : la migration expose min_build à anon (GRANT et politique), livré à 0', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261029000000_payant_modele_b.sql'), 'utf8');
    assert.match(sql, /insert into public\.app_config \(key, value\) values \('min_build', '0'::jsonb\)/);
    assert.match(sql, /create policy app_config_anon_paywall on public\.app_config for select to anon using \(key in \('paywall_on', 'min_build'\)\)/);
    assert.match(sql, /grant select \(key, value\) on public\.app_config to anon;/);
    const base = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261028000000_payant.sql'), 'utf8');
    assert.match(base, /grant select on public\.app_config to authenticated;/);
  });

  test('min-build : chargé après plans.js et avant updates.js, et mis en cache par le service worker', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const at = f => html.indexOf(`<script src="js/${f}"></script>`);
    assert.ok(at('data/plans.js') > 0 && at('data/plans.js') < at('data/min-build.js'), 'après plans.js (PLAN_APP_STORE_ID)');
    assert.ok(at('data/min-build.js') < at('app/updates.js'));
    assert.ok(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes("'/js/data/min-build.js'"));
  });
}
