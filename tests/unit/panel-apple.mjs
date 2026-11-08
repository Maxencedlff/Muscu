// ═══════════════════════════════════════════════════════════
//  Panel d'ergonomie Apple (vague 3, 08/11/2026) : règles pures corrigées
// ═══════════════════════════════════════════════════════════

export default function ({ test, assert, app, sameJSON }) {
  // Photo de test : jour J à midi (heure locale), pose donnée
  const day = d => new Date(2026, 10, d, 12).getTime();
  const ph = (id, d, pose) => ({ id, date: day(d), pose });

  test('Avant / après du coffre : même pose à deux dates, jamais deux poses du même jour', () => {
    // Le cas du panel : la dernière photo (Dos) est seule de sa pose ; une Face existe à une autre date
    const list = [ph('dos', 4, 'back'), ph('face2', 4, 'face'), ph('face1', 1, 'face')];
    sameJSON(app.photoComparePair(list), { a: 'face1', b: 'face2' });
    // Pose la plus récente d'abord quand plusieurs ont deux dates
    sameJSON(app.photoComparePair([ph('d2', 6, 'back'), ph('f2', 5, 'face'), ph('d1', 2, 'back'), ph('f1', 1, 'face')]), { a: 'd1', b: 'd2' });
    // Trois dates : la plus ancienne contre la plus récente
    sameJSON(app.photoComparePair([ph('f3', 9, 'face'), ph('f2', 5, 'face'), ph('f1', 1, 'face')]), { a: 'f1', b: 'f3' });
    // Deux photos de la même pose le même jour, ou des poses différentes : rien à comparer
    assert.equal(app.photoComparePair([ph('f2', 4, 'face'), { ...ph('f1', 4, 'face'), date: day(4) - 3600e3 }]), null);
    assert.equal(app.photoComparePair([ph('d', 4, 'back'), ph('f', 1, 'face')]), null);
    assert.equal(app.photoComparePair([]), null);
    assert.equal(app.photoCompareHint([ph('d', 4, 'back'), ph('f', 1, 'face')]), 'Reprends une photo de dos un autre jour pour comparer.');
    assert.equal(app.photoCompareHint([ph('f', 1, 'face')]), 'Reprends une photo de face un autre jour pour comparer.');
  });
}
