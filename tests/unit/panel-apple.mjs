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

  test('Menu ⋯ d\'un exercice : court (Remplacer, prise, ordre), réglages rares dans « Plus d\'options… », « Retirer » à part', () => {
    reset();
    const xs = JSON.stringify([['Tirage vertical prise serrée', 3], ['Développé couché barre', 3], ['Curl marteau', 3]]
      .map(([name, n]) => ({ name, sets: Array.from({ length: n }, () => ({ weight: '40', reps: '8', done: false })) })));
    const acts = JSON.parse(run(`JSON.stringify(exerciseMenuActions(${xs}, 0, 0))`));
    const vals = acts.map(a => a.value);
    assert.deepEqual(vals.slice(0, 2), ['replace', 'grip'], `Remplacer puis la prise en tête ${vals}`);
    assert.ok(vals.includes('later') && vals.includes('superset') && vals.includes('more'), `ordre et « Plus d'options » ${vals}`);
    const main = acts.filter(a => !a.apart && a.style !== 'cancel');
    assert.ok(main.length <= 7, `7 choix au plus dans la liste, lisible sans défiler sur iPhone SE (${main.length})`);
    for (const rare of ['up', 'down', 'warmup', 'plates', 'tempo', 'rest', 'restart', 'muscles']) assert.ok(!vals.includes(rare), `${rare} dans « Plus d'options »`);
    const remove = acts.find(a => a.value === 'remove');
    assert.ok(remove.apart && remove.style === 'destructive', 'Retirer : à part, destructif');
    assert.equal(acts.at(-1).style, 'cancel');
    const more = JSON.parse(run(`JSON.stringify(exerciseMoreActions(${xs}, 0))`)).map(a => a.value);
    for (const v of ['down', 'rest', 'restart', 'muscles']) assert.ok(more.includes(v), `${v} dans « Plus d'options » ${more}`);
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
    assert.match(src('docs/ERGONOMIE.md'), /\| Suivre ; ceux qui te suivent/, 'lexique : suivre');
  });

  test('ⓘ après un nom d\'exercice : jamais seul sur une ligne (dernier mot et ⓘ insécables)', () => {
    const h = app.howToNameHtml('Rowing haltère unilatéral');
    assert.match(h, /^Rowing haltère <span class="ex-howto__tail">unilatéral<svg[^>]*icon--info-circle/);
    assert.match(app.howToNameHtml('Dips'), /^<span class="ex-howto__tail">Dips<svg/);
    assert.match(app.howToNameHtml('A <b>'), /&lt;b&gt;/, 'nom échappé');
  });

  test('Courbe : graduations rondes et période de la tendance', () => {
    sameJSON(app.chartNiceTicks(20.5, 28.6), [20, 25, 30]);
    sameJSON(app.chartNiceTicks(0, 1830), [0, 1000, 2000]);
    sameJSON(app.chartNiceTicks(61, 64.2), [60, 62, 64, 66]);
    const t = app.chartNiceTicks(52.3, 57.9);
    assert.ok(t[0] <= 52.3 && t.at(-1) >= 57.9 && t.length >= 2 && t.length <= 5, `bornes englobées ${t}`);
    assert.equal(app.sinceTxt(new Date(2026, 4, 3).getTime(), new Date(2026, 10, 8).getTime()), 'depuis mai');
    assert.equal(app.sinceTxt(new Date(2025, 11, 3).getTime(), new Date(2026, 10, 8).getTime()), 'depuis décembre 2025');
  });

  test('« Plus tard » : flèche qui tourne, plus la flèche vers une ligne lue « Télécharger »', () => {
    assert.match(src('js/features/session-order-ui.js'), /icon\('arrow\.turn\.down\.right'/);
    assert.match(src('index.html'), /<symbol id="i-arrow\.turn\.down\.right"/);
    assert.ok(!src('index.html').includes('i-arrow.down.to.line'), 'ancien symbole retiré');
  });

  test('« Reprise » n\'a qu\'un sens (phase du coach) : mini-série du rest-pause, fin du repos', () => {
    assert.equal(run('TECHS.rp.subName'), 'mini-série');
    assert.ok(!/Reprise à/.test(src('js/features/rest.js')) && /Fin du repos à/.test(src('js/features/rest.js')), 'minuteur : « Fin du repos à »');
  });

  test('Disques : icône du disque, l\'haltère reste à l\'onglet Entraînement', () => {
    assert.match(src('js/features/session.js'), /data-action="open-plates"[^\n]*setDisplayNo\(ex\.sets, si\)[^\n]*icon\('plate'/, 'le numéro reste, le disque à côté');
    assert.match(src('index.html'), /<symbol id="i-plate"/);
  });

  test('Disques d\'un échauffement : « É », jamais « 0 »', () => {
    reset();
    const warm = { warmup: true, weight: '40', reps: '8' }, work = { weight: '60', reps: '8' };
    const ex = { name: 'Squat', sets: [warm, work] };
    assert.match(app.setPlatesHtml(ex, 0, warm, 0), /<span class="num">É<\/span>/);
    assert.match(app.setPlatesHtml(ex, 0, work, 1), /<span class="num">1<\/span>/);
  });

  test('En-tête de carte : le record suit une série du jour qui le bat', () => {
    reset();
    const pr = { weight: '80', reps: '6' };
    const ex = sets => ({ name: 'Développé couché', sets });
    sameJSON(app.liveHeadRecord(ex([{ weight: '80', reps: '8', done: true }]), pr), { weight: '80', reps: '8' });
    sameJSON(app.liveHeadRecord(ex([{ weight: '82.5', reps: '3', done: true }, { weight: '85', reps: '2', done: false }]), pr), { weight: '82.5', reps: '3' }, 'série non validée ignorée');
    sameJSON(app.liveHeadRecord(ex([{ weight: '75', reps: '10', done: true }, { weight: '90', reps: '5', done: true, warmup: true }]), pr), pr, 'ni plus légère, ni échauffement');
  });

  test('Typographie française : espaces insécables avant ? ! ; :, guillemets, « mois\u2011ci »', () => {
    assert.equal(app.frTypo('Tout réinitialiser ?'), 'Tout réinitialiser\u202f?');
    assert.equal(app.frTypo('Échauffement ajouté : 3 séries'), 'Échauffement ajouté\u202f: 3 séries');
    assert.equal(app.frTypo('« Gros record ! »'), '«\u202fGros record\u202f!\u202f»');
    assert.equal(app.frTypo('3 séances ce mois-ci'), '3 séances ce mois\u2011ci');
    assert.equal(app.frTypo('Repos 1:30 · 10:05'), 'Repos 1:30 · 10:05', 'heures et chronos intacts');
    assert.equal(app.frTypo('https://x.fr/a?b=1 ; ok'), 'https://x.fr/a?b=1\u202f; ok', 'pas d\'espace ajoutée là où il n\'y en avait pas');
    assert.equal(app.frTypo('cinquante-cinq, ceci'), 'cinquante-cinq, ceci', 'autres traits d\'union intacts');
    assert.equal(app.frTypo('Objectif 32 kg × 10'), 'Objectif 32\u202fkg\u202f×\u202f10', '« 32 kg × 10 » insécable');
    assert.equal(app.frTypo('1\u202f080 kg'), '1\u202f080\u202fkg', 'nombre et unité liés');
  });

  test('Tendance « depuis mai » : du premier au dernier point affiché', () => {
    assert.equal(app.trendPct([100, 90, 120, 113]), 13);
    assert.equal(app.trendPct([50, 40]), -20);
    assert.equal(app.trendPct([80]), null);
  });

  test('Photos de bilan : le coach n\'est jamais écrit au masculin (coach, coache)', () => {
    const files = ['js/data/guide.js', 'js/features/coach-photos-ui.js', 'js/features/coach-ui.js', 'js/features/photo-vault-ui.js',
      'js/features/social-ui.js', 'js/features/coach-chat-ui.js', 'js/features/coach-plan-ui.js', 'js/features/account-ui.js', 'js/features/comments-ui.js'];
    // Panel t5 : « Ton coach, lui, … avec lui », « préviens-le », « quitte-le », « Il a pu changer d'iPhone », « toi seul »
    for (const f of files) assert.ok(!/pour lui seul|quand il veut|s'il quitte|il ne la voit plus|qu'il aurait|coach, lui|avec lui\.|préviens-le|quitte-le|Il a pu changer|toi seul/.test(src(f)), f);
  });

  test('Icônes : une bulle par sens, une silhouette pour se connecter', () => {
    assert.equal(iconOf('js/features/social-ui.js', 'social-open-comments'), 'bubble.left', 'Commenter : bulle vide');
    assert.match(src('js/features/coach-ui.js'), /Commentée par ton coach">\$\{icon\('bubble\.left'/);
    assert.match(src('js/features/coach-chat-ui.js'), /chat-count[^\n]*icon\('text\.bubble'/, 'messages : bulle à lignes');
    assert.match(src('js/features/account-ui.js'), /avatar--empty[^\n]*icon\('person\.crop\.circle'/);
    for (const id of ['bubble.left', 'person.crop.circle']) assert.match(src('index.html'), new RegExp(`<symbol id="i-${id.replace('.', '\\.')}"`));
  });
}
