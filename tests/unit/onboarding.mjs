// Premier lancement : programme conseillé selon le lieu, la fréquence et le niveau, phrase d'explication
// et séances en clair (js/data/onboarding.js).
export default function ({ test, run, assert }) {
  const pick = (place, perWeek, level) => run(`recommendProgramme(${JSON.stringify({ place, perWeek, level })})`);

  test('premier lancement : règle de choix du programme (tableau complet)', () => {
    const expected = {
      salle:    { debutant: ['fullbody', 'fullbody', 'upper_lower', 'upper_lower'], confirme: ['fullbody', 'ppl', 'upper_lower', 'ppl'] },
      halteres: { debutant: Array(4).fill('maison_halteres'), confirme: Array(4).fill('maison_halteres') },
      rien:     { debutant: Array(4).fill('maison'), confirme: Array(4).fill('maison') },
    };
    for (const [place, levels] of Object.entries(expected)) {
      for (const [level, ids] of Object.entries(levels)) {
        [2, 3, 4, 5].forEach((n, i) => assert.equal(pick(place, n, level), ids[i], `${place}, ${n} fois, ${level}`));
      }
    }
  });

  test('premier lancement : seulement des programmes intégrés, réponses manquantes tolérées', () => {
    const ids = run('Object.keys(PROGRAMMES)');
    for (const place of ['salle', 'halteres', 'rien', undefined, 'autre']) {
      for (const n of [2, 3, 4, 5, 7, 0, undefined, '4']) {
        for (const level of ['debutant', 'confirme', undefined]) {
          const id = pick(place, n, level);
          assert.ok(ids.includes(id) && id !== 'custom', `${place}/${n}/${level} → ${id}`);
        }
      }
    }
    assert.equal(run('recommendProgramme()'), 'ppl', 'aucune réponse : salle, 3 fois, déjà entraîné');
    assert.equal(pick('salle', 7, 'confirme'), 'ppl', '7 fois compte comme 5 ou plus');
    assert.equal(pick('salle', '4', 'debutant'), 'upper_lower', 'nombre en texte (data-val)');
  });

  test('premier lancement : chaque programme proposé a son explication', () => {
    for (const id of ['fullbody', 'upper_lower', 'ppl', 'maison', 'maison_halteres']) {
      for (const n of [2, 3, 4, 5]) {
        const why = run(`recommendReason(${JSON.stringify(id)}, { perWeek: ${n}, level: 'debutant' })`);
        assert.ok(why.length > 20 && why.endsWith('.'), `${id} ${n} : ${why}`);
        assert.ok(why.startsWith(n >= 5 ? '5 séances ou plus' : `${n} séances`), `${id} ${n} : fréquence reprise (${why})`);
      }
    }
    assert.equal(run("recommendReason('fullbody', { perWeek: 3, level: 'debutant' })"),
      '3 séances par semaine, tout le corps à chaque fois. Idéal pour débuter.');
    assert.equal(run("recommendReason('bro', {})"), '');
  });

  test('premier lancement : séances en clair, données intactes', () => {
    const ppl = run("programmePreview('ppl')");
    assert.equal(ppl.length, 3);
    assert.equal(JSON.stringify(ppl[0]), JSON.stringify({ cat: 'push', label: 'Push', color: 'var(--orange)', plain: 'Pousser',
      muscles: 'pectoraux · épaules · triceps' }));
    assert.deepEqual([...ppl.map(s => s.plain)], ['Pousser', 'Tirer', 'Jambes']);
    assert.deepEqual([...run("programmePreview('upper_lower')").map(s => s.plain)], ['Haut du corps', 'Bas du corps']);
    // Déjà en français : pas de traduction en double (« Jambes · jambes »)
    assert.deepEqual([...run("programmePreview('bro')").map(s => s.plain)], ['', '', '', '', '']);
    assert.deepEqual([...run("programmePreview('maison')").map(s => s.plain)], ['', '']);
    assert.equal(run("programmePreview('inconnu')").length, 0);
    assert.equal(run("PROGRAMMES.ppl.sessions.push.label"), 'Push', 'libellé des données inchangé');
  });

  test('premier lancement : filtres de matériel connus', () => {
    const equip = run('Object.values(ONB_PLACES).map(p => p.equip)');
    const known = run('EQUIP_IDS');
    equip.forEach(e => assert.ok(known.includes(e), `filtre ${e}`));
    assert.deepEqual([...run('ONB_FREQS.map(f => f.n)')], [2, 3, 4, 5]);
  });
}
