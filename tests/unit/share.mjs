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

  test('programme partagé : message lisible, sans code ni charges', () => {
    reset();
    run(`const e = data.programmes.ppl.exercises.push[0]; e.tempo = '3-1-1-0'; e.rest = 120; e.target = 80`);
    const text = app.programmeShareText(app.programmeSharePayload('ppl'));
    assert.match(text, /^Mon programme « PPL » sur MDLF Training\n\nPush\n• Développé couché haltères : 4 séries, tempo 3-1-1, repos 2:00\n/);
    assert.match(text, /\n\nLegs\n• Squat barre : 4 séries/);
    assert.doesNotMatch(text, /80|MDLF-PROG|Importer/, 'ni charge, ni code, ni mode d\'emploi');
  });

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
    assert.equal(st.highlights.length, 6, 'tous les exercices de la séance figurent');
    assert.equal(st.others, 0);
    const dc = st.highlights.find(h => h.name === 'Développé couché');
    assert.equal(dc.record, 'Record charge');
    assert.equal(dc.value, '62,5 kg × 6', 'la série du record, pas la plus volumineuse');
    // Ordre de la séance conservé, y compris l'exercice au poids du corps
    assert.equal(st.highlights[0].name, 'Développé couché');
    assert.equal(new Set(st.highlights.map(h => h.name)).size, 6);
    assert.equal(st.exercises.length, 6, 'exercice sans série écarté');
  });

  test('partage : records notés dans la séance prioritaires, unité lbs, séance passée sans heure', () => {
    reset({ unit: 'lbs' });
    const { latest, history } = pushHistory();
    const st = app.shareStoryStats({ ...latest, records: [] }, { history });
    assert.equal(st.records, 0, 'séance sans record noté : aucun record');
    // Charges différentes : le détail de toutes les séries (l'unité est portée par les autres lignes
    // et par la tuile Volume ; la répéter à chaque série faisait déborder la carte)
    assert.match(st.highlights[0].value, /^\d[\d,]* × 6 · /, 'détail des séries, la meilleure en tête');
    const past = { ...latest, duration: undefined };
    const sp = app.shareStoryStats(past, { history });
    assert.equal(sp.duration, null);
    assert.equal(sp.time, '');
    assert.equal(app.shareStoryStats({ ...latest, exercises: [] }, { history }).volume, null);
  });

  test('partage : records de l\'image = records notés (reps noté repris, nouveaux types, jamais le 1RM estimé)', () => {
    reset();
    const { latest, history } = pushHistory();
    const noted = app.shareStoryStats({ ...latest, records: [{ ex: 'Développé couché', kind: 'reps', before: 8, after: 9, w: 60 }] }, { history });
    const dc = noted.highlights.find(h => h.name === 'Développé couché');
    assert.equal(dc.record, 'Record reps');
    assert.equal(dc.value, '60 kg × 9', 'la série du record noté');
    // 1RM estimé meilleur (57,5 × 11 contre 60 × 8) sans record de charge ni de reps : rien sur l'image
    const e1 = { ...latest, records: undefined, exercises: [{ exId: 'dc', name: 'Développé couché', sets: [{ weight: '57.5', reps: '11' }] }] };
    assert.ok(app.calc1RM(57.5, 11) > app.calc1RM(60, 8));
    assert.equal(app.shareStoryStats(e1, { history }).records, 0);
    // Maintien et course : nouveaux types de records sur l'image
    const D = 86_400_000, T = Date.now();
    const g = (id, d, sec, min, km) => ({ id, programme: 'ppl', category: 'legs', date: T - d * D, exercises: [
      { name: 'Gainage (planche)', measure: 'time', sets: [{ weight: '', reps: sec }] },
      { name: 'Course à pied', measure: 'cardio', sets: [{ weight: '', reps: min, dist: km }] }] });
    const cur = g('l2', 0, '75', '31', '6.4'), hist = [cur, g('l1', 3, '60', '30', '6')];
    const sg = app.shareStoryStats(cur, { history: hist });
    sameJSON(sg.highlights.map(h => h.record), ['Record temps', 'Record 5 km']);
    assert.equal(sg.records, 2);
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

  // Contexte 2D factice : largeur mesurée = 0,55 × taille de police par caractère
  function fakeCanvas2d() {
    const drawn = [];
    const target = {
      font: '10px x', drawn,
      measureText(t) { return { width: String(t).length * parseFloat(/(\d+)px/.exec(this.font)[1]) * 0.55 }; },
      fillText(t) { drawn.push({ text: t, size: parseFloat(/(\d+)px/.exec(this.font)[1]) }); },
    };
    return new Proxy(target, { get: (o, k) => (k in o ? o[k] : () => {}) });
  }

  test('partage : nom d\'exercice réduit (40 → 32 px) avant d\'être tronqué', () => {
    const c = [235, 235, 245, 1];
    const palette = { light: false, label: c, label2: c, sep: c, cell: c, goldText: c, font: 'f', fontRounded: 'r' };
    const names = { short: 'Squat', medium: 'Développé couché haltères pro', long: 'Développé incliné haltères prise neutre, banc à trente degrés' };
    const st = { highlights: Object.values(names).map(name => ({ name, value: '100 kg × 8', record: null })), others: 0 };
    const g = fakeCanvas2d();
    app.drawHighlights(g, palette, st, 0, 3, false);
    const at = name => g.drawn.find(d => d.text === name || (d.text.endsWith('…') && name.startsWith(d.text.slice(0, -1))));
    assert.equal(at(names.short).size, 40, 'nom court : taille pleine');
    assert.ok(at(names.medium).size < 40 && at(names.medium).text === names.medium, 'nom moyen : réduit, entier');
    assert.equal(at(names.long).size, 32, 'nom très long : taille minimale');
    assert.ok(at(names.long).text.endsWith('…'), 'puis tronqué');
  });

  // Séance Push avec un superset (2) et un tri-set (3), un exercice sans série au milieu du tri-set
  function supersetHistory() {
    const { latest, older, pull } = pushHistory();
    const s = (weight, reps) => ({ weight, reps });
    const ss = {
      ...latest, id: 'ss',
      exercises: [
        { exId: 'dc', name: 'Développé couché', sets: [s('62.5', '6')] },
        { exId: 'cb', name: 'Curl biceps', ss: 'g1', sets: [s('12', '10')] },
        { exId: 'tr', name: 'Extension triceps', ss: 'g1', sets: [s('20', '12')] },
        { exId: 'el', name: 'Élévations latérales', ss: 'g2', sets: [s('8', '12')] },
        { exId: 'vi', name: 'Oiseau', ss: 'g2', sets: [] },
        { exId: 'ec', name: 'Écarté', ss: 'g2', sets: [s('12', '12')] },
      ],
    };
    return { ss, history: [ss, latest, pull, older] };
  }

  test('partage : supersets en blocs entiers, détail des séries et texte VoiceOver', () => {
    reset();
    const { ss, history } = supersetHistory();
    const st = app.shareStoryStats(ss, { history });
    sameJSON(st.highlights.map(h => h.kind ?? null), [null, 'Superset', 'Superset', 'Tri-set', 'Tri-set'], 'tri-set gardé malgré un exercice sans série');
    assert.equal('group' in st.highlights[0], false, 'exercice seul : aucune clé ajoutée');
    assert.equal(st.highlights[1].sets, '12 kg × 10');
    sameJSON(app.shareUnits(st.highlights).map(u => u.map(r => r.name)), [
      ['Développé couché'], ['Curl biceps', 'Extension triceps'], ['Élévations latérales', 'Écarté'],
    ]);
    sameJSON(st.supersets, [
      { kind: 'Superset', names: ['Curl biceps (12 kg × 10)', 'Extension triceps (20 kg × 12)'] },
      { kind: 'Tri-set', names: ['Élévations latérales (8 kg × 12)', 'Oiseau', 'Écarté (12 kg × 12)'] },
    ]);
    assert.match(app.shareStoryAlt(st), /\. Superset : Curl biceps \(12 kg × 10\) et Extension triceps \(20 kg × 12\)\. Tri-set : Élévations latérales \(8 kg × 12\), Oiseau et Écarté \(12 kg × 12\)\. Muscles travaillés : /);
    // Limite d'exercices : un superset compte pour un bloc et n'est jamais coupé
    const two = app.shareStoryStats(ss, { history, max: 2 });
    for (const u of app.shareUnits(two.highlights)) {
      if (u[0].group != null) assert.equal(u.length, st.highlights.filter(h => h.group === u[0].group).length, 'groupe entier');
    }
    assert.equal(app.shareUnits(two.highlights).length, 2);
    assert.equal(two.others, 5 - two.highlights.length);
  });

  test('partage : détail des séries (charge fixe, charge qui change, sans charge, durée)', () => {
    reset();
    const txt = (sets, m = 'reps', k = 'charge') => app.setsText(sets, m, k);
    const s = (weight, reps) => ({ weight, reps });
    assert.equal(txt([s('30', '10'), s('30', '10'), s('30', '9')]), '30 kg × 10 · 10 · 9');
    assert.equal(txt([s('30', '10'), s('32.5', '8'), s('32.5', '7')]), '30 × 10 · 32,5 × 8 · 32,5 × 7', 'historique : inchangé');
    assert.equal(app.setsText([s('30', '10'), s('32.5', '8')], 'reps', 'charge', { unitEach: true }), '30 kg × 10 · 32,5 kg × 8', 'image : unité à chaque série');
    assert.equal(app.setsText([s('30', '10'), s('30', '9')], 'reps', 'charge', { unitEach: true }), '30 kg × 10 · 9');
    assert.equal(txt([s('', '15'), s('', '12')]), '15 · 12 reps');
    assert.equal(txt([s('', '45'), s('', '60')], 'time'), '45 s · 1 min');
    assert.equal(txt([]), '—');
  });

  test('partage : chaque exercice montre toutes ses séries, la silhouette reste quand elle tient', () => {
    reset();
    const entry = { id: 'p', date: Date.now(), category: 'push', programme: 'ppl', duration: 2_999_000, exercises: [
      { name: 'Développé couché haltères', sets: [{ weight: '24', reps: '12' }, { weight: '24', reps: '12' }, { weight: '24', reps: '10' }, { weight: '24', reps: '10' }] },
      { name: 'Développé incliné haltères', sets: [0, 1, 2, 3].map(() => ({ weight: '24', reps: '10' })) },
      { name: 'Dips', sets: [{ weight: '5', reps: '10' }, { weight: '5', reps: '10' }, { weight: '5', reps: '10' }, { weight: '5', reps: '8' }] },
      { name: 'Extension triceps couché haltères', sets: [0, 1, 2].map(() => ({ weight: '6.5', reps: '12' })) },
    ] };
    const st = app.shareStoryStats(entry, { history: [entry] });
    sameJSON(st.highlights.map(h => h.sets), ['24 kg × 12 · 12 · 10 · 10', '24 kg × 10 · 10 · 10 · 10', '5 kg × 10 · 10 · 10 · 8', '6,5 kg × 12 · 12 · 12']);
    const out = app.storyLayout(fakeCanvas2d(), { font: 'f', fontRounded: 'r' }, { ...st, records: 3 }, true);
    assert.equal(out.rows, 4, 'les 4 exercices');
    assert.ok(!out.more, 'aucun « + N autres »');
    assert.ok(out.map, 'silhouette gardée (en-tête plus compact)');
    const total = out.blocks.reduce((a, [, h, gap]) => a + h + gap, 0);
    const Z = run('STORY');
    assert.ok(total <= Z.H - Z.TOP - Z.BOTTOM, `tient dans la zone sûre (${total})`);
  });

  test('partage : séance sans superset inchangée (lignes, alt)', () => {
    reset();
    const { latest, history } = pushHistory();
    const st = app.shareStoryStats(latest, { history });
    assert.ok(st.highlights.every(h => !('group' in h) && !('kind' in h)));
    // Détail de toutes les séries sous chaque exercice (04/11/2026), superset ou non
    assert.ok(st.highlights.every(h => typeof h.sets === 'string' && h.sets.includes('·') || /×|reps/.test(h.sets)), 'détail des séries');
    sameJSON(st.supersets, []);
    assert.equal(app.shareUnits(st.highlights).length, st.highlights.length, 'un bloc par exercice');
    assert.doesNotMatch(app.shareStoryAlt(st), /Superset|Tri-set|Circuit/);
    // Un `ss` isolé (exercice seul) ne fait pas de groupe
    const lone = { ...latest, exercises: latest.exercises.map((e, i) => (i === 1 ? { ...e, ss: 'zz' } : e)) };
    const sl = app.shareStoryStats(lone, { history });
    assert.ok(sl.highlights.every(h => !('group' in h)));
    assert.equal(app.shareStoryAlt(sl), app.shareStoryAlt(st));
  });

  test('partage : bloc de superset dessiné (titre, noms, détail), sans valeur à droite ni pastille', () => {
    const c = [235, 235, 245, 1];
    const palette = { light: false, label: c, label2: c, sep: c, cell: c, cat: c, catText: c, goldText: c, font: 'f', fontRounded: 'r' };
    const row = (name, extra = {}) => ({ name, value: '100 kg × 8', record: null, ...extra });
    const grp = { group: 1, kind: 'Tri-set', sets: '30 × 10 · 32,5 × 8 · 32,5 × 7' };
    const st = { highlights: [row('Squat'), row('Curl', grp), row('Dips', grp), row('Pompes', grp)], others: 0 };
    for (const rowH of [undefined, 64, 44]) {
      const g = fakeCanvas2d();
      app.drawHighlights(g, palette, st, 0, 4, false, rowH);
      const texts = g.drawn.map(d => d.text);
      assert.ok(texts.includes('TRI-SET'), 'titre du bloc');
      assert.equal(texts.filter(t => t === grp.sets).length, 3, 'détail de chaque exercice');
      assert.equal(texts.filter(t => t === '100 kg × 8').length, 1, 'meilleure série seulement pour l\'exercice seul');
      assert.ok(!texts.some(t => /^[A-Z]\d$/.test(t)), 'aucune pastille A1');
    }
    // Bloc lisible : nom à la taille d'une ligne hors superset, détail ≥ 70 % du nom et ≥ 24 px,
    // exercice du bloc à peu près de la hauteur d'une ligne complète
    for (const rowH of [112, 64, 54]) {
      const m = app.groupMetrics(rowH);
      assert.equal(m.name, rowH >= 112 ? 40 : Math.round(Math.min(40, rowH * 0.6)));
      assert.ok(m.detail >= 24 && m.detail >= 0.7 * m.name, `détail lisible (${rowH})`);
      assert.ok(m.member >= 0.8 * rowH && m.head > m.titleBase + 16, `de l'air (${rowH})`);
    }
    // Hauteur : une ligne par exercice seul, titre + deux lignes par exercice du groupe
    const rowsOnly = { highlights: [row('a'), row('b')], others: 0 };
    assert.equal(app.highlightsHeight(rowsOnly.highlights, false, 64), 88 + 2 * 64 + 24, 'sans superset : comme avant');
    assert.ok(app.highlightsHeight(st.highlights, false, 64) > 88 + 4 * 64 + 24);
  });

  // Cinq séances types pour la mise en page (lignes déjà calculées, comme shareStoryStats)
  function layoutCases() {
    const row = (i, extra = {}) => ({ index: i, name: `Développé exercice ${i}`, value: '30 kg × 10', record: i === 1 ? 'Record charge' : null, volume: 300 - i, ...extra });
    const grp = (id, kind, sets = '30 kg × 10 · 10 · 9 · 8') => ({ group: id, kind, sets });
    const make = (n, groups) => Array.from({ length: n }, (_, i) => {
      const g = groups.find(([from, len]) => i >= from && i < from + len);
      return row(i, g ? grp(g[0], g[2], g[3]) : {});
    });
    return {
      'sans superset': make(6, []),
      'superset + tri-set': make(6, [[1, 2, 'Superset'], [3, 3, 'Tri-set']]),
      'grosse séance, circuit': make(12, [[4, 4, 'Circuit']]),
      'charges qui changent': make(6, [[0, 2, 'Superset', '30 kg × 10 · 32,5 kg × 8 · 32,5 kg × 7 · 35 kg × 5']]),
      'séance énorme': make(20, [[2, 2, 'Superset'], [7, 3, 'Tri-set'], [14, 2, 'Superset']]),
    };
  }

  test('partage : signature au-dessus de la zone de réponse, haut sous la barre de profil, rien ne se chevauche', () => {
    const palette = { font: 'f', fontRounded: 'r' };
    for (const [name, highlights] of Object.entries(layoutCases())) {
      for (const map of [false, true]) {
        const st = { title: 'Push', highlights, others: 0, records: 1 };
        const out = app.storyLayout(fakeCanvas2d(), palette, st, map);
        const tag = `${name}${map ? ' (silhouette)' : ''}`;
        assert.ok(1920 - (out.at.signature + 84) >= 340, `${tag} : signature à ${1920 - (out.at.signature + 84)} px du bas`);
        assert.ok(out.at.header >= 250, `${tag} : haut à ${out.at.header} px`);
        out.blocks.forEach(([b, h], i) => {
          const next = out.blocks[i + 1];
          if (next) assert.ok(out.at[b] + h <= out.at[next[0]], `${tag} : ${b} ne chevauche pas ${next[0]}`);
        });
        if (name !== 'séance énorme') {
          assert.equal(out.list.length, highlights.length, `${tag} : tous les exercices`);
          assert.equal(out.more, false);
        }
        if (highlights.some(r => r.group != null)) {
          const g = app.groupMetrics(out.rowH, out.air);
          assert.ok(out.rowH >= 50 && g.name >= 30 && g.detail >= 22, `${tag} : texte lisible (${out.rowH}, ${g.name}, ${g.detail})`);
          // Un bloc montré l'est en entier
          for (const id of new Set(out.list.filter(r => r.group != null).map(r => r.group))) {
            assert.equal(out.list.filter(r => r.group === id).length, highlights.filter(r => r.group === id).length, `${tag} : bloc ${id} entier`);
          }
        }
      }
    }
    // Petite séance avec superset : mise en page aérée gardée
    const small = app.storyLayout(fakeCanvas2d(), palette, { title: 'Push', highlights: layoutCases()['charges qui changent'].slice(0, 3), others: 0, records: 0 }, false);
    assert.equal(small.air, 1);
    assert.equal(small.tilesH, 214);
    // Séance énorme : tous les blocs ; seuls des exercices hors superset passent dans « + N autres »
    const huge = layoutCases()['séance énorme'];
    const out = app.storyLayout(fakeCanvas2d(), palette, { title: 'Push', highlights: huge, others: 0, records: 1 }, false);
    const hidden = huge.filter(r => !out.list.includes(r));
    assert.ok(hidden.every(r => r.group == null), 'aucun exercice de superset caché');
    assert.equal(out.more, hidden.length > 0);
  });

  test('médaille : mêmes tracés pour l\'icône des écrans et l\'image partagée', () => {
    const svg = app.medalSvg(14);
    assert.match(svg, /width="14"/);
    for (const d of Object.values(run('MEDAL_PATHS'))) assert.ok(svg.includes(`d="${d}"`));
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
    // Instagram « Story » : l'extension renvoie une erreur en ouvrant Instagram, le partage a lieu
    const ig = nativeContext({ localData: '{}', shareCancelled: 'Error sharing item' });
    assert.equal(await ig.Native.shareImage('data:image/png;base64,AA', 'a.png'), 'handed');
    assert.equal(await ig.Native.shareText('x', 'y'), 'handed');
    const ko = nativeContext({ localData: '{}', shareCancelled: "Can't share while sharing is in progress" });
    assert.equal(await ko.Native.shareImage('data:image/png;base64,AA', 'a.png'), 'failed');
  });

  test('partage : nombre de séries affiché pour les exercices sans charge', () => {
    const row = ex => run(`shareExerciseRow(${JSON.stringify(ex)}, null, 0).value`);
    assert.equal(row({ name: 'Crunch', sets: [{ weight: '', reps: '15' }, { weight: '', reps: '15' }, { weight: '', reps: '15' }] }), '3 × 15 reps');
    assert.equal(row({ name: 'Gainage (planche)', sets: [{ weight: '', reps: '45' }, { weight: '', reps: '45' }, { weight: '', reps: '45' }] }), '3 × 45 s');
    // Séries différentes : le DÉTAIL, pas la meilleure suivie du nombre de séries (qui se lisait
    // comme si toutes valaient la meilleure : 6, 6, 6, 7 affiché « 7 reps · 4 séries »)
    assert.equal(row({ name: 'Crunch', sets: [{ weight: '', reps: '12' }, { weight: '', reps: '15' }] }), '12 · 15 reps');
    assert.equal(row({ name: 'Tractions', sets: [{ weight: '', reps: '6' }, { weight: '', reps: '6' }, { weight: '', reps: '6' }, { weight: '', reps: '7' }] }), '6 · 6 · 6 · 7 reps');
    assert.equal(row({ name: 'Curl marteau', sets: [{ weight: '10', reps: '10' }, { weight: '10', reps: '10' }] }), '10 kg × 10', 'avec charge : inchangé');
  });
}
