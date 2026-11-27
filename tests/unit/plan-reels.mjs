// Cas réels de l'import de programme (tests/fixtures/plans/reels/, vraies photos lues par Vision et vraies dictées) :
// chaque vérité a son texte lu, et le moteur les passe sans erreur. Pas de seuil tant que les 20 cas ne sont pas là
// (docs/IMPORT_PROGRAMME.md, « Mesure ») ; dossier vide = test qui passe.
import { loadReels, measureReels } from '../../tools/plan-corpus/reels.mjs';

export default function ({ test, assert }) {
  test('import de programme : cas réels (photos, dictées) complets et lus par le moteur', () => {
    const { cases, problems } = loadReels();
    assert.deepEqual(problems, [], 'chaque NN-slug.json a son NN-slug.txt');
    if (!cases.length) return;
    const r = measureReels(cases);
    assert.equal(r.details.length, cases.length);
  });
}
