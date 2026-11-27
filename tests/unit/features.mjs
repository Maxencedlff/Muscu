// Garde des mises à jour à chaud (docs/REVUE_APPLE.md, 6.2) : features.json déclare chaque écran et chaque action
// d'une fonction ; scripts/check-features-ota.mjs refuse en OTA une fonction absente de la dernière build examinée.
import fs from 'node:fs';
import path from 'node:path';
import { newFeatures } from '../../scripts/check-features-ota.mjs';

export default function ({ test, assert, ROOT }) {
  const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  const features = read('features.json'), last = read('store/derniere-build.json');
  const jsFiles = dir => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? jsFiles(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
  const code = jsFiles('js').map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

  test('features.json : identifiants uniques, chaque écran de l\'app déclaré, chaque action déclarée existe', () => {
    const ids = features.features.map(f => f.id);
    assert.equal(new Set(ids).size, ids.length, 'identifiant en double');
    const declared = new Set(features.features.flatMap(f => f.screens || []));
    const screens = [...code.matchAll(/SCREENS\.set\('([^']+)'/g)].map(m => m[1]);
    const missing = [...new Set(screens)].filter(s => !declared.has(s));
    assert.deepEqual(missing, [], `écran(s) à déclarer dans features.json : ${missing.join(', ')}`);
    for (const f of features.features) for (const a of f.actions || [])
      assert.ok(code.includes(`'${a}'`), `${f.id} : action ${a} introuvable dans js/`);
  });

  test('features.json : l\'import d\'un programme est une fonction nouvelle, refusée en mise à jour à chaud', () => {
    assert.deepEqual(newFeatures({ features: [{ id: 'a' }, { id: 'b' }] }, { features: ['a'] }), ['b']);
    assert.deepEqual(newFeatures({ features: [{ id: 'a' }] }, { features: ['a', 'z'] }), []);
    assert.deepEqual(newFeatures({ features: [{ id: 'a' }] }, {}), ['a']);
    assert.ok(newFeatures(features, last).includes('programme.import-texte-pdf'));
    for (const id of last.features) assert.ok(features.features.some(f => f.id === id), `${id} : dans la dernière build mais plus déclaré`);
  });
}
