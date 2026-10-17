// ═══════════════════════════════════════════════════════════
//  Tests unitaires : partage de séance (records, chiffres de l'image, couleurs, pont natif)
//  Chargé par run.mjs, qui fournit le contexte de l'app et ses aides.
// ═══════════════════════════════════════════════════════════

import assert from 'node:assert/strict';

const DAY = 86_400_000;
const NOW = Date.now();

// Historique minimal : deux séances Push puis une troisième qui bat des records
function pushHistory() {
  const s = (weight, reps) => ({ weight, reps });
  const older = {
    id: 'a', programme: 'ppl', category: 'push', date: NOW - 7 * DAY, duration: 50 * 60_000, notes: '',
    exercises: [
      { exId: 'dc', name: 'Développé couché', sets: [s('60', '8'), s('60', '8')] },
      { exId: 'el', name: 'Élévations latérales', sets: [s('8', '12')] },
    ],
  };
  const pull = {   // autre séance : ne compte jamais pour les records de Push
    id: 'p', programme: 'ppl', category: 'pull', date: NOW - 3 * DAY, notes: '',
    exercises: [{ exId: 'dc', name: 'Développé couché', sets: [s('200', '10')] }],
  };
  const latest = {
    id: 'b', programme: 'ppl', category: 'push', date: NOW, duration: 62 * 60_000, notes: '',
    exercises: [
      { exId: 'dc', name: 'Développé couché', sets: [s('62.5', '6'), s('60', '9')] },     // record charge
      { exId: 'el', name: 'Élévations latérales', sets: [s('8', '12'), s('8', '10')] },   // égalité : pas de record
      { exId: 'di', name: 'Dips', sets: [s('', '12'), s('', '10')] },                     // jamais fait : pas de record
      { exId: 'dm', name: 'Développé militaire', sets: [s('30', '10')] },
      { exId: 'ec', name: 'Écarté', sets: [s('12', '12')] },
      { exId: 'tr', name: 'Extension triceps', sets: [s('20', '12')] },
      { exId: 'vi', name: 'Vide', sets: [] },                                              // écarté
    ],
  };
  return { older, pull, latest, history: [latest, pull, older] };
}

export default function shareTests({ test, app, run, reset, sameJSON, nativeContext }) {

  test('records : badge d\'une série (charge > reps > 1RM), jamais sans précédent ni à égalité', () => {
    const base = { prW: 60, prR: 8, e1rm: 76 };
    assert.equal(app.recordLabel({ weight: '62.5', reps: '3' }, base), 'Record charge');
    assert.equal(app.recordLabel({ weight: '60', reps: '9' }, base), 'Record reps');
    assert.equal(app.recordLabel({ weight: '55', reps: '12' }, base), 'Record 1RM est.');
    assert.equal(app.recordLabel({ weight: '60', reps: '8' }, base), '');
    assert.equal(app.recordLabel({ weight: '100', reps: '8' }, null), '');
    const rec = app.exerciseRecord({ sets: [{ weight: '60', reps: '9' }, { weight: '62.5', reps: '2' }] }, base);
    assert.equal(rec.label, 'Record charge');
    assert.equal(rec.s.weight, '62.5');
  });

  test('records : ligne de base tirée des seules séances antérieures du même programme et de la même séance', () => {
    const { latest, history } = pushHistory();
    const base = app.historyBaseline(latest, history);
    sameJSON(base.dc, { prW: 60, prR: 8, e1rm: 76 });
    sameJSON(base.el, { prW: 8, prR: 12, e1rm: 11.2 });
    assert.equal(base.di, undefined, 'exercice jamais fait : pas de ligne de base');
    assert.equal(Object.keys(app.historyBaseline(history[2], history)).length, 0, 'première séance : rien');
  });

  test('partage : chiffres de l\'image (durée, volume, séries, records, exercices clés)', () => {
    reset();
    const { latest, history } = pushHistory();
    const st = app.shareStoryStats(latest, { history });
    assert.equal(st.title, 'Push');
    assert.equal(st.color, 'var(--orange)');
    assert.equal(st.duration, '1 h 02');
    assert.equal(st.sets, 9);
    assert.equal(st.volume, '1,8 t');   // 915 + 176 + 0 + 300 + 144 + 240 = 1 775 kg
    assert.equal(st.records, 1);
    assert.equal(st.highlights.length, 5);
    assert.equal(st.others, 1);
    const dc = st.highlights.find(h => h.name === 'Développé couché');
    assert.equal(dc.record, 'Record charge');
    assert.equal(dc.value, '62,5 kg × 6', 'la série du record, pas la plus volumineuse');
    // Ordre de la séance conservé ; l'exercice au poids du corps (volume nul) est celui qui saute
    sameJSON(st.highlights.map(h => h.name),
      ['Développé couché', 'Élévations latérales', 'Développé militaire', 'Écarté', 'Extension triceps']);
    assert.equal(st.exercises.length, 6, 'exercice sans série écarté');
  });

  test('partage : ligne de base fournie (bilan) prioritaire, unité lbs, séance passée sans heure', () => {
    reset({ unit: 'lbs' });
    const { latest, history } = pushHistory();
    const st = app.shareStoryStats(latest, { history, baseline: {} });
    assert.equal(st.records, 0, 'bilan sans ligne de base : aucun record');
    assert.match(st.highlights[0].value, /lbs × 6$/);
    const past = { ...latest, duration: undefined };
    const sp = app.shareStoryStats(past, { history });
    assert.equal(sp.duration, null);
    assert.equal(sp.time, '');
    assert.equal(app.shareStoryStats({ ...latest, exercises: [] }, { history }).volume, null);
  });

  test('partage : texte VoiceOver, nom de fichier', () => {
    reset();
    const { latest, history } = pushHistory();
    const st = app.shareStoryStats(latest, { history });
    assert.match(app.shareStoryAlt(st), /^Push, .+\. 1 h 02, .+ t, 9 séries, Nouveau record\. Muscles travaillés : pectoraux, .+ et .+\.$/);
    assert.equal(st.muscles.length, 3, 'trois muscles les plus travaillés');
    assert.match(app.shareStoryAlt({ ...st, muscles: [] }), /Nouveau record\.$/, 'sans muscle reconnu : pas de phrase');
    assert.equal(app.shareRecordsText(3), '3 records battus');
    assert.match(app.shareFileName(latest), /^mdlf-training-push-\d{4}-\d{2}-\d{2}\.png$/);
    assert.match(app.shareFileName({ category: 'Ma séance!', date: NOW }), /^mdlf-training-masance-/);
  });

  test('partage : couleurs des tokens (rgb, rgba, hexadécimal), mélange et transparence', () => {
    sameJSON(app.parseCssColor('rgb(255, 159, 10)'), [255, 159, 10, 1]);
    sameJSON(app.parseCssColor('rgba(235, 235, 245, 0.6)'), [235, 235, 245, 0.6]);
    sameJSON(app.parseCssColor('rgb(10 20 30 / 0.5)'), [10, 20, 30, 0.5]);
    sameJSON(app.parseCssColor('#FF9F0A'), [255, 159, 10, 1]);
    sameJSON(app.parseCssColor('#fff'), [255, 255, 255, 1]);
    assert.equal(app.parseCssColor('var(--x)'), null);
    assert.equal(app.rgbaCss([235, 235, 245, 0.6], 0.5), 'rgba(235, 235, 245, 0.3)');
    sameJSON(app.mixColor([200, 100, 0, 1], [0, 0, 0, 1], 50), [100, 50, 0, 1]);
  });

  test('native : partage d\'image hors app → rien ; dans l\'app → fichier en cache puis feuille de partage', async () => {
    const web = nativeContext({ native: false });
    assert.equal(await web.Native.shareImage('data:image/png;base64,AAAA', 'x.png'), false);
    assert.equal(web.calls.length, 0);

    const n = nativeContext({ localData: '{}' });
    assert.equal(await n.Native.shareImage('data:image/png;base64,iVBORw0', 'mdlf.png'), 'shared');
    assert.equal(n.file(), 'iVBORw0', 'base64 sans le préfixe data:');
    sameJSON(n.calls.filter(c => c[0] !== 'SplashScreen'), [['writeFile', 'mdlf.png', 'CACHE'], ['share', ['file:///CACHE/mdlf.png']]]);

    const c = nativeContext({ localData: '{}', shareCancelled: true });
    assert.equal(await c.Native.shareImage('data:image/png;base64,AA', 'a.png'), 'cancelled');
  });
}
