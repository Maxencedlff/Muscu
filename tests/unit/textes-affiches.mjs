// Garde-fou : un commentaire de code collé dans un texte affiché (gabarit `…`) se voit à l'écran.
// Vu au panel du tour 6 (09/11/2026) : « // pas le verbe du bouton en titre (panel t5) » dans la feuille
// « Photos à envoyer ». On refuse toute ligne où un gabarit s'ouvre puis contient « // » suivi de texte.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, assert, ROOT }) {
  const files = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
  });
  walk(path.join(ROOT, 'js'));
  test('aucun commentaire « // » à l\'intérieur d\'un gabarit affiché', () => {
    const bad = [];
    for (const f of files) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        // gabarit ouvert sur la ligne (nombre impair de « ` ») puis « // » hors URL
        const tick = l.indexOf('`');
        if (tick < 0 || (l.split('`').length - 1) % 2 === 0) return;
        const rest = l.slice(tick + 1);
        if (/(^|[^:])\/\/\s+\S/.test(rest)) bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
      });
    }
    assert.deepEqual(bad, []);
  });
}
