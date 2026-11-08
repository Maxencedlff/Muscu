// ═══════════════════════════════════════════════════════════
//  Panel d'ergonomie Apple (vague 3, 08/11/2026) : règles pures corrigées
// ═══════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, app, sameJSON, ROOT }) {
  const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  // Icône posée sur le bouton d'une action (même ligne de code que data-action="…")
  const iconOf = (file, action) => {
    const line = src(file).split('\n').find(l => l.includes(`data-action="${action}"`) && l.includes('icon('));
    return line && /icon\('([^']+)'/.exec(line.slice(line.indexOf(`data-action="${action}"`)))?.[1];
  };
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

  test('Une icône = un sens : avion en papier pour les envois privés, partage d\'iOS pour la feuille système', () => {
    // Envois chiffrés dans l'app (coach, élève) : jamais l'icône de la feuille de partage
    for (const [file, action] of [['js/features/coach-photos-ui.js', 'cph-send-day'], ['js/features/coach-ui.js', 'coach-send'],
      ['js/features/nutrition-ui.js', 'coach-send-diet'], ['js/features/diet-editor.js', 'diet-send-student'],
      ['js/features/coach-photos-ui.js', 'cph-send-from-vault']]) {
      assert.equal(iconOf(file, action), 'paperplane', `${action} (${file})`);
    }
    // Feuille de partage d'iOS : le carré et la flèche
    for (const [file, action] of [['js/features/programme.js', 'share-programme'], ['js/features/social-ui.js', 'social-invite'],
      ['js/features/recap.js', 'recap-share']]) {
      assert.equal(iconOf(file, action), 'square.and.arrow.up', `${action} (${file})`);
    }
    assert.match(src('index.html'), /<symbol id="i-paperplane"/, 'symbole présent dans le sprite');
  });

  test('Menu ⋯ d\'un exercice : trois sections dans l\'ordre, « Retirer l\'exercice » à part, « Choisir la prise »', () => {
    reset();
    const xs = JSON.stringify([['Tirage vertical prise serrée', 3], ['Développé couché barre', 3], ['Curl marteau', 3]]
      .map(([name, n]) => ({ name, sets: Array.from({ length: n }, () => ({ weight: '40', reps: '8', done: false })) })));
    const acts = JSON.parse(run(`JSON.stringify(exerciseMenuActions(${xs}, 0, 0))`));
    const sections = [...new Set(acts.filter(a => a.section).map(a => a.section))];
    assert.deepEqual(sections, ['Ordre', 'Exercice', 'Séries et repos'], 'sections dans cet ordre');
    // Une section ne revient jamais après une autre (pas de mélange)
    const seq = acts.filter(a => a.section).map(a => a.section);
    assert.ok(seq.every((s, i) => i === 0 || s === seq[i - 1] || !seq.slice(0, i).includes(s)), `sections contiguës ${seq}`);
    const remove = acts.find(a => a.value === 'remove');
    assert.ok(remove.apart && remove.style === 'destructive' && !remove.section, 'Retirer : à part, destructif');
    assert.equal(acts.at(-1).style, 'cancel');
    assert.equal(acts.find(a => a.value === 'grip')?.label, 'Choisir la prise');
    assert.ok(acts.filter(a => a.style === 'destructive').length === 1, 'une seule action destructive');
  });

  test('Courbe d\'un exercice : points placés selon leur date, pas leur rang', () => {
    const D = 86400000;
    sameJSON(app.chartXFracs([0, 2 * D, 10 * D]), [0, 0.2, 1]);
    sameJSON(app.chartXFracs([5 * D]), [0.5], 'un point : au milieu');
    sameJSON(app.chartXFracs([D, D, D]), [0, 0.5, 1], 'mêmes dates : selon le rang');
    const f = app.chartXFracs([0, D, 2 * D, 30 * D]);
    assert.ok(f[2] - f[1] < (f[3] - f[2]) / 10, `écart de 28 jours bien plus large que d'un jour ${f}`);
  });

  test('Social : un seul vocabulaire (amis, suivre), « abonné » réservé à l\'abonnement payant', () => {
    // Code sans les commentaires (une ligne // ou la fin de ligne après « // ») : seuls les textes montrés comptent
    const code = f => src(f).split('\n').filter(l => !l.trim().startsWith('//')).map(l => l.replace(/\s\/\/\s.*$/, '')).join('\n');
    for (const f of ['js/features/social-ui.js', 'js/features/social-me-ui.js', 'js/features/coach-ui.js', 'js/ui/navbar.js', 'js/features/reactions-ui.js', 'js/features/comments-ui.js']) {
      const hits = (code(f).match(/[^\n]*abonn[^\n]*/gi) || []).filter(l => !/paywall: 'Abonnement'/.test(l));   // écran payant
      assert.deepEqual(hits, [], `${f} : ${hits.join(' | ')}`);
    }
    assert.match(src('docs/ERGONOMIE.md'), /\| Amis \|/, 'lexique : Amis');
  });
}
