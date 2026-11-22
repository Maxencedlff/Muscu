// ═══════════════════════════════════════════════════════════
//  Tests unitaires de l'atlas détaillé : images de img/body2, données générées, sous-muscles des exercices
//  Chargés par run.mjs (même contexte vm, mêmes outils)
// ═══════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Taille d'une image WebP (en-têtes VP8X, VP8 ou VP8L) ou PNG (IHDR), sans bibliothèque
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`${file} : ni WebP ni PNG`);
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
  return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
}

// Pixels d'un PNG en niveaux de gris 8 bits (hit.png) : filtres PNG défaits ligne par ligne
function pngGray(file) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], color = b[25];
  if (depth !== 8 || color !== 0) throw new Error(`${file} : PNG gris 8 bits attendu (${depth}, ${color})`);
  const idat = [];
  for (let i = 8; i < b.length;) {
    const len = b.readUInt32BE(i), type = b.toString('ascii', i + 4, i + 8);
    if (type === 'IDAT') idat.push(b.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)], row = raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1));
    for (let x = 0; x < w; x++) {
      const a = x ? out[y * w + x - 1] : 0, up = y ? out[(y - 1) * w + x] : 0, c = x && y ? out[(y - 1) * w + x - 1] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const pred = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f];
      out[y * w + x] = (row[x] + pred) & 255;
    }
  }
  return { w, h, d: out };
}

export default function atlasTests({ test, app, run, sameJSON, assert, ROOT }) {
  const DIR = path.join(ROOT, 'img', 'body2');
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'body2-manifest.json'), 'utf8'));
  const BP = () => run('BODY_PARTS');
  const SEXES = ['male', 'female'], VIEWS = ['front', 'back'];

  test('atlas : manifest cohérent avec les fichiers de img/body2 (rien en trop, rien en moins, tailles)', () => {
    const ids = new Set(man.parts.map(p => p.id));
    assert.equal(ids.size, man.parts.length, 'sous-muscle en double');
    assert.ok(man.w3 === man.w * 3 && man.h3 === man.h * 3, '3× = trois fois le 1×');
    for (const sex of SEXES) for (const view of VIEWS) {
      const d = path.join(DIR, sex, view), boxes = man.bodies[sex][view].parts;
      sameJSON(imageSize(path.join(d, 'base.webp')), { w: man.w, h: man.h }, `${sex}/${view} base.webp`);
      sameJSON(imageSize(path.join(d, 'base@3x.webp')), { w: man.w3, h: man.h3 }, `${sex}/${view} base@3x.webp`);
      sameJSON(imageSize(path.join(d, 'lines@3x.webp')), { w: man.w3, h: man.h3 }, `${sex}/${view} lines@3x.webp`);
      sameJSON(imageSize(path.join(d, 'hit.png')), { w: man.hit[0], h: man.hit[1] }, `${sex}/${view} hit.png`);
      Object.keys(boxes).forEach(id => assert.ok(ids.has(id), `${sex}/${view} : boîte d'un sous-muscle inconnu ${id}`));
      const files = k => fs.readdirSync(path.join(d, k)).map(f => f.replace(/\.webp$/, '')).sort();
      sameJSON(files('p3'), Object.keys(boxes).sort(), `${sex}/${view} : p3/ = boîtes du manifest`);
      sameJSON(files('p'), Object.keys(boxes).sort(), `${sex}/${view} : p/ = boîtes du manifest`);
      sameJSON(fs.readdirSync(d).sort(), ['base.webp', 'base@3x.webp', 'hit.png', 'lines@3x.webp', 'p', 'p3'], `${sex}/${view} : fichiers de la vue`);
      for (const [id, b] of Object.entries(boxes)) {
        sameJSON(imageSize(path.join(d, 'p3', `${id}.webp`)), { w: b[2] - b[0], h: b[3] - b[1] }, `${sex}/${view} p3/${id} = sa boîte`);
        const [b1] = BP().boxes[sex][view][id];
        sameJSON(imageSize(path.join(d, 'p', `${id}.webp`)), { w: b1[2] - b1[0], h: b1[3] - b1[1] }, `${sex}/${view} p/${id} = sa boîte 1×`);
        assert.ok(b1[0] * 3 <= b[0] && b1[1] * 3 <= b[1] && b1[2] * 3 >= b[2] && b1[3] * 3 >= b[3], `${sex}/${view} ${id} : boîte 1× qui contient la 3×`);
      }
    }
    sameJSON(fs.readdirSync(DIR).sort(), ['female', 'male'], 'img/body2 : rien d\'autre que les images (manifest dans tools/)');
  });

  test('atlas : js/data/body-parts.js à jour du manifest (tools/gen-body2.py relancé)', () => {
    const bp = BP();
    sameJSON([bp.w, bp.h, bp.w3, bp.h3, bp.hit], [man.w, man.h, man.w3, man.h3, man.hit]);
    sameJSON(bp.parts.map(p => [p.id, p.name, p.latin, p.parent ?? null, !!p.deep]),
      man.parts.map(p => [p.id, p.name, p.latin, p.parent ?? null, !!p.deep]));
    for (const sex of SEXES) for (const view of VIEWS) {
      sameJSON(Object.fromEntries(Object.entries(bp.boxes[sex][view]).map(([id, b]) => [id, b[1]])), man.bodies[sex][view].parts, `${sex}/${view} : boîtes 3×`);
    }
    // Parents : muscles de l'app (ou null : seulement nommé au toucher) ; chaque sous-muscle a ses deux noms
    const muscles = new Set(run('MUSCLES.map(m => m.id)'));
    bp.parts.forEach(p => {
      assert.ok(p.parent === undefined || p.parent === null || muscles.has(p.parent), `${p.id} : parent inconnu ${p.parent}`);
      assert.ok(p.name && p.latin, `${p.id} : nom de salle et nom officiel`);
    });
  });

  test('atlas : carte de toucher = rangs des sous-muscles de la vue, jamais un profond', () => {
    const bp = BP();
    for (const sex of SEXES) for (const view of VIEWS) {
      const { d } = pngGray(path.join(DIR, sex, view, 'hit.png'));
      const seen = new Set(d);
      seen.delete(0);
      for (const k of seen) {
        const p = bp.parts[k - 1];
        assert.ok(p, `${sex}/${view} : indice ${k} hors de la liste`);
        assert.ok(!p.deep, `${sex}/${view} : zone de toucher sur un muscle profond (${p.id})`);
        assert.ok(bp.boxes[sex][view][p.id], `${sex}/${view} : ${p.id} touchable sans calque dans la vue`);
      }
      assert.ok(seen.size >= 20, `${sex}/${view} : ${seen.size} sous-muscles touchables`);
    }
  });

  test('atlas : chaque exercice de la bibliothèque a ses sous-muscles, cohérents avec ses muscles', () => {
    const names = run('EXERCISE_CATALOGUE.map(e => e.name)');
    sameJSON(Object.keys(run('EXERCISE_PARTS')).sort(), [...names].sort(), 'EXERCISE_PARTS = noms de la bibliothèque');
    const bp = BP(), known = new Set(bp.parts.map(p => p.id));
    for (const name of names) {
      const m = app.musclesOf(name), r = app.exercisePartLevels(name, m);
      const e = run(`EXERCISE_PARTS[${JSON.stringify(name)}]`);
      [...Object.keys(e.p), ...Object.keys(e.s)].forEach(id => assert.ok(known.has(id), `${name} : ${id} inconnu`));
      Object.values({ ...e.p, ...e.s }).forEach(v => assert.ok(v === 1 || v === 2, `${name} : intensité ${v}`));
      e.src.forEach(i => assert.ok(run(`typeof EXERCISE_PART_SOURCES[${i}] === 'string'`), `${name} : source ${i}`));
      assert.equal(r.source, 'atlas', `${name} : détail refusé (muscles parents différents de la bibliothèque)`);
      // Alignement strict (audit du 20/11) : principaux = parents des sous-muscles principaux, secondaires = parents des
      // secondaires (hors principaux) ; pastilles, personnage, Progrès et historique comptent les mêmes muscles
      const P = app.atlasParents(Object.keys(e.p)), S = app.atlasParents(Object.keys(e.s)).filter(id => !P.includes(id));
      sameJSON([...P].sort(), [...m.primary].sort(), `${name} : principaux`);
      sameJSON([...S].sort(), [...m.secondary].sort(), `${name} : secondaires`);
      if (!m.primary.length) {   // muscle profond seul (vacuum) : rien de coloré, comme aujourd'hui
        assert.ok(m.deep.length && !Object.keys(r.levels).length, `${name} : profond seul`);
        continue;
      }
      // Chaque muscle principal et secondaire a au moins un sous-muscle coloré, visible dans une vue
      for (const id of [...m.primary, ...m.secondary]) {
        const on = Object.keys(r.levels).filter(p => app.atlasPart(p).parent === id);
        assert.ok(on.some(p => SEXES.every(s => VIEWS.some(v => bp.boxes[s][v][p]))), `${name} : ${id} sans sous-muscle visible`);
      }
      assert.ok(Object.values(r.levels).includes(2), `${name} : au moins un rouge plein`);
    }
    // Le développé incliné : claviculaire en rouge plein, sterno-costal et deltoïde antérieur atténués
    const inc = app.exercisePartLevels('Développé incliné barre', app.musclesOf('Développé incliné barre')).levels;
    assert.equal(inc.chest_clavicular, 2);
    assert.ok(inc.chest_sternal === 1 && inc.delt_anterior === 1 && inc.triceps_long === 1 && !inc.chest_abdominal && !inc.delt_lateral);
    // Alias tapé par la personne : mêmes sous-muscles que la bibliothèque
    sameJSON(app.exercisePartLevels('incline bench press', app.musclesOf('incline bench press')).levels, inc);
  });

  test('atlas : repli propre sur les muscles entiers (muscles modifiés, exercice inconnu)', () => {
    const bp = BP();
    // Tout muscle de l'app a au moins un sous-muscle visible, face ou dos, pour les deux personnages
    for (const id of run('MUSCLES.map(m => m.id)')) {
      const parts = app.atlasPartsOf(id);
      assert.ok(parts.length, `${id} : aucun sous-muscle`);
      for (const s of SEXES) assert.ok(VIEWS.some(v => parts.some(p => bp.boxes[s][v][p])), `${s} : ${id} invisible`);
      // Là où la carte des 18 muscles montre ce muscle, l'atlas aussi
      for (const s of SEXES) for (const v of VIEWS) {
        if (run(`BODY_IMG.bodies.${s}.${v}.includes(${JSON.stringify(id)})`)) assert.ok(parts.some(p => bp.boxes[s][v][p]), `${s}/${v} : ${id} absent de l'atlas`);
      }
    }
    // Muscles choisis par la personne : le détail de la bibliothèque n'est plus sûr, chaque muscle entier
    const r = app.exercisePartLevels('Développé incliné barre', { primary: ['biceps'], secondary: ['forearms'], source: 'user' });
    assert.equal(r.source, 'muscles');
    sameJSON(Object.keys(r.levels).sort(), [...app.atlasPartsOf('biceps'), ...app.atlasPartsOf('forearms')].sort());
    assert.ok(app.atlasPartsOf('biceps').every(p => r.levels[p] === 2) && app.atlasPartsOf('forearms').every(p => r.levels[p] === 1));
    // Exercice hors bibliothèque reconnu par une règle
    const own = app.exercisePartLevels('Mon curl maison', { primary: ['biceps'], secondary: [], source: 'rules' });
    assert.ok(own.source === 'muscles' && own.levels.biceps_long === 2);
    // Profonds jamais colorés par le repli (montrés seulement nommés par un exercice)
    assert.ok(!app.atlasPartsOf('traps').includes('rhomboid_major') && !app.atlasPartsOf('chest').includes('pec_minor'));
    assert.equal(app.atlasRole(2), 'Muscle ciblé');
    assert.equal(app.atlasRole(1), 'Muscle qui aide');
    assert.equal(app.atlasRole(0), 'Non ciblé par cet exercice');
  });

  test('atlas : carte de la fiche en 1× seulement, rouge plein / atténué, profonds par-dessus', () => {
    assert.equal(run('BODY_PART_SEC_OPACITY'), 'var(--body-sec-o)', 'muscles qui aident : le même rouge, moins opaque (jeton du thème : 35 % en clair, 40 % en sombre)');
    // Progrès : 3 paliers, chacun sa couleur pleine (panel affichage-e t3 : 4 rouges ne se distinguaient pas)
    sameJSON(run('[1, 2].map(n => bodyTier(n / 2))'), [1, 2].map(n => ({ tone: `t${n}`, op: 1 })));
    assert.equal(run('bodyTier(0)'), null, 'pas travaillé : gris du corps, aucun calque');
    const html = run(`bodyAtlasHtml(exercisePartLevels('Développé incliné barre', musclesOf('Développé incliné barre')).levels, { body: 'male', tap: true, title: 'Développé incliné barre' })`);
    assert.ok(!/@3x|\/p3\/|lines|hit\.png/.test(html), 'aucune image 3× au premier affichage');
    assert.ok(/class="body-map__m body-map__p" data-part="chest_clavicular"/.test(html), 'claviculaire en rouge plein');
    assert.ok(/body-map__m--sec[^"]*" data-part="chest_sternal"/.test(html) && /body-map__m--sec[^"]*" data-part="delt_anterior"/.test(html), 'sterno-costal, deltoïde antérieur atténués');
    assert.ok(html.includes('img/body2/male/front/base.webp') && html.includes('img/body2/male/back/base.webp'));
    assert.ok(html.includes('data-action="body-tap"') && html.includes('body-map--atlas'));
    const row = run(`exercisePartLevels('Rowing barre', musclesOf('Rowing barre')).levels`);
    assert.ok(row.rhomboid_major === 2 && row.rhomboid_minor === 2, 'rowing : rhomboïdes (groupe développé)');
    const back = run(`bodyAtlasHtml(exercisePartLevels('Rowing barre', musclesOf('Rowing barre')).levels, { body: 'female' })`);
    const order = [...back.matchAll(/data-part="([a-z_]+)"/g)].map(m => m[1]);
    const deep = order.findIndex(id => id.startsWith('rhomboid'));
    assert.ok(deep > 0 && order.slice(deep).every(id => id.startsWith('rhomboid')), `profonds posés en dernier ${order}`);
    assert.ok(/body-map__p--deep" data-part="rhomboid_major"[^>]*opacity:0\.6/.test(back), 'profond en transparence');
  });

  test('atlas : pastilles = ce que montre le dessin, mêmes noms que la bulle', () => {
    const inc = run(`atlasPills(exercisePartLevels('Développé incliné barre', musclesOf('Développé incliné barre')).levels)`).map(({ label, level }) => ({ label, level }));
    sameJSON(inc, [{ label: 'Haut des pectoraux', level: 2 }, { label: 'Milieu des pectoraux', level: 1 },
      { label: 'Épaules antérieures', level: 1 }, { label: 'Triceps', level: 1 }]);
    assert.equal(app.atlasPartTitle('chest_clavicular'), 'Haut des pectoraux');
    assert.equal(app.atlasPartTitle('triceps_lateral'), 'Triceps, chef latéral');
    // Chaque bulle commence par le nom d'une pastille
    run('BODY_PARTS.parts').forEach(p => assert.ok(app.atlasPartTitle(p.id).startsWith(app.atlasPillLabel(p.id)), `${p.id} : ${app.atlasPartTitle(p.id)}`));
    assert.equal(app.atlasPartTitle('gastro_medial').replace(/\u00ad/g, ''), 'Mollets, gastrocnémien médial');
    assert.equal(app.atlasPartTitle('teres_minor'), 'Coiffe des rotateurs, petit rond');
    // Toute la bibliothèque : une pastille par nom, plein d'abord, au moins une pleine
    for (const name of run('EXERCISE_CATALOGUE.map(e => e.name)')) {
      const m = app.musclesOf(name);
      if (!m.primary.length) continue;
      const pills = run(`atlasPills(exercisePartLevels(${JSON.stringify(name)}, musclesOf(${JSON.stringify(name)})).levels)`);
      assert.ok(pills.length && pills[0].level === 2, `${name} : pastille pleine en tête`);
      assert.equal(new Set(pills.map(p => p.label)).size, pills.length, `${name} : nom en double`);
      for (let i = 1; i < pills.length; i++) assert.ok(pills[i - 1].level >= pills[i].level, `${name} : ordre`);
    }
  });

  test('atlas : carte cadrée sur le haut ou le bas du corps quand tous les muscles y sont', () => {
    const crop = n => run(`bodyAtlasCrop('male', exercisePartLevels(${JSON.stringify(n)}, musclesOf(${JSON.stringify(n)})).levels)`);
    sameJSON(crop('Développé incliné barre'), [0, 450]);
    sameJSON(crop('Abducteurs machine'), [304, 604], 'abducteurs : de la taille aux genoux');
    const mc = crop('Mollets debout');
    assert.ok(mc[1] === 840 && mc[0] > 500, `mollets : des genoux aux pieds ${mc}`);
    sameJSON(crop('Squat barre'), [0, 840], 'squat : érecteurs et jambes, corps entier');
    sameJSON(run("bodyAtlasCrop('male', {})"), [0, 840]);
    const html = run(`bodyAtlasHtml(exercisePartLevels('Abducteurs machine', musclesOf('Abducteurs machine')).levels, { body: 'female' })`);
    // Une seule face utile (panel affichage-e t3) : abducteurs, le dos seul, en grand
    assert.ok(html.includes('body-map--crop') && html.includes('data-crop="321,621"') && html.includes('aspect-ratio:384 / 300') && html.includes('body-map--one')
      && html.includes('data-view="back"') && !html.includes('body-map__front'), html.slice(0, 300));
    const both = run(`bodyAtlasHtml(exercisePartLevels('Développé incliné barre', musclesOf('Développé incliné barre')).levels, { body: 'male' })`);
    assert.ok(both.includes('body-map__front') && both.includes('body-map__back') && !both.includes('body-map--one'), 'développé incliné : face (pectoraux) et dos (triceps)');
    const prog = run(`bodyAtlasHtml({ glute_med: 2 }, { body: 'male', crop: false, tiers: true })`);
    assert.ok(prog.includes('body-map__front') && prog.includes('body-map__back'), 'Progrès : toujours les deux faces');
    const ol = run(`bodyAtlasHtml({ glute_med: 2 }, { body: 'male', crop: false, tiers: true, outline: ['external_oblique'] })`);
    assert.ok(/class="body-map__ol" data-ol="external_oblique"/.test(ol) && ol.includes('data-ol="external_oblique"') && !/class="body-map__ol"/.test(run(`bodyAtlasHtml({ glute_med: 2 }, { body: 'male' })`)),
      'Progrès : muscles à 0 série cernés (outline), jamais sur la fiche');
    const fiche = run(`bodyAtlasHtml({ glute_med: 2, glute_max: 1 }, { body: 'male' })`);
    assert.ok(/class="body-map__ol body-map__ol--main" data-ol="glute_med"/.test(fiche) && !/body-map__ol--main" data-ol="glute_max"/.test(fiche),
      'fiche : le ciblé seul cerné de rouge (panel t8), pas le muscle qui aide');
    // Ciblé petit (moyen fessier sous le grand) : l'aidant discret garde son contour rose (panel atlas-bas t3)
    assert.ok(/class="body-map__ol body-map__ol--help" data-ol="glute_max"/.test(fiche) && !/body-map__ol--help/.test(run(`bodyAtlasHtml({ vastus_lateralis: 2, rectus_femoris: 1 }, { body: 'male' })`)),
      'aidant discret : contour rose ; aidant normal : aucun');
    // Zones d'un muscle de salle (panel t12) : « Haut · Milieu · Bas » pour les pectoraux, les chefs du triceps, rien
    // pour un muscle d'un seul tenant (abdominaux)
    const zones = (m, weekly) => run(`atlasMuscleZones({ weekly: ${JSON.stringify(weekly)} }, ${JSON.stringify(m)}, 'male')`);
    const pz = zones('chest', { chest_clavicular: 5, chest_sternal: 9 });
    sameJSON(pz.slice(0, 3), [{ label: 'Haut', n: 5 }, { label: 'Milieu', n: 9 }, { label: 'Bas', n: 0 }]);
    sameJSON(zones('traps', { traps_middle: 4 }).slice(0, 3).map(z => z.label), ['Haut', 'Milieu', 'Bas']);
    sameJSON(zones('triceps', {}).map(z => z.label), ['Chef long', 'Chef latéral', 'Chef médial']);
    sameJSON(zones('glutes', { glute_max: 3 }), [{ label: 'Grand fessier', n: 3 }, { label: 'Moyen fessier', n: 0 }], 'fessiers : zones depuis le détail des jambes');
    sameJSON(zones('abs', { rectus_abdominis: 3 }), [], 'muscle d\'un seul tenant : pas de zones');
    assert.ok(new Set(zones('traps', {}).map(z => z.label)).size === zones('traps', {}).length, 'rhomboïdes : une seule zone');
    // Page de groupe (contre-vérification de l'auditeur, cas de probe.mjs) : vues et cadrage sur TOUS les sous-muscles du
    // groupe, sinon ceux à 0 série de l'autre vue disparaissaient (Épaules : le deltoïde antérieur seul travaillé cachait
    // le postérieur, au dos ; Bras : le biceps seul cachait le triceps). Pour chaque groupe et chaque sous-muscle travaillé
    // seul, chaque sous-muscle du groupe est sur une vue affichée et dans le cadre
    const group = (gid, levels) => run(`(() => { if (typeof muscleSpan === "undefined") globalThis.muscleSpan = "week"; const keep = partLoad; partLoad = () => ({ levels: ${JSON.stringify(levels)} });
      try { return statsGroupAtlasHtml(MUSCLE_GROUP_BY_ID.get(${JSON.stringify(gid)})); } finally { partLoad = keep; } })()`);
    const ep = group('epaules', { delt_anterior: 2 });
    assert.ok(ep.includes('body-map__back') && /data-ol="[^"]*delt_posterior/.test(ep), 'Épaules, deltoïde antérieur seul : le dos et le postérieur cerné');
    const br = group('bras', { biceps_long: 2 });
    assert.ok(br.includes('body-map__back') && /data-ol="[^"]*triceps_lateral/.test(br), 'Bras, biceps seul : le dos et le triceps cerné');
    for (const g of run('MUSCLE_GROUPS')) {
      const ids = run(`BODY_PARTS.parts.filter(p => ${JSON.stringify(g.muscles)}.includes(p.parent) && !p.deep).map(p => p.id)`);
      for (const one of ids) {
        const html = group(g.id, { [one]: 2 }), kind = html.match(/data-body="(\w+)"/)[1];
        const [y0, y1] = html.match(/data-crop="(\d+),(\d+)"/).slice(1).map(Number);
        const views = ['front', 'back'].filter(v => html.includes(`body-map__${v}`));
        for (const id of ids.filter(i => run(`['front', 'back'].some(v => BODY_PARTS.boxes[${JSON.stringify(kind)}][v][${JSON.stringify(i)}])`))) {   // l'élévateur de la scapula n'est pas dessiné
          const seen = views.some(v => { const b = run(`BODY_PARTS.boxes[${JSON.stringify(kind)}][${JSON.stringify(v)}][${JSON.stringify(id)}]`); return b && b[0][1] >= y0 && b[0][3] <= y1; });
          assert.ok(seen, `groupe ${g.id}, ${one} seul travaillé : ${id} hors du dessin (vues ${views}, cadre ${y0}-${y1})`);
        }
      }
    }
    // Tout sous-muscle coloré reste dans le cadre
    for (const name of run('EXERCISE_CATALOGUE.map(e => e.name)')) for (const kind of ['male', 'female']) {
      const lv = run(`exercisePartLevels(${JSON.stringify(name)}, musclesOf(${JSON.stringify(name)})).levels`);
      const [y0, y1] = run(`bodyAtlasCrop(${JSON.stringify(kind)}, ${JSON.stringify(lv)})`);
      let first = Infinity;
      for (const v of ['front', 'back']) for (const [id, b] of Object.entries(run('BODY_PARTS').boxes[kind][v])) {
        if (lv[id] > 0) { assert.ok(b[0][1] >= y0 && b[0][3] <= y1, `${name} ${kind}/${v} : ${id} hors du cadre`); first = Math.min(first, b[0][1]); }
      }
      // Cadre du bas du corps : au moins 30 points au-dessus du premier sous-muscle coloré (taille visible)
      if (y0 > 0 && first !== Infinity) assert.ok(first - y0 >= 30, `${name} ${kind} : ${first - y0} points de marge en haut`);
    }
  });

  test('récap partagé : les paliers dans les couleurs de Progrès en sombre (audit B1 : « Objectif atteint » en rose pâle)', () => {
    const css = f => fs.readFileSync(path.join(ROOT, 'css', f), 'utf8');
    const tok = (txt, sel, name) => (txt.split(sel)[1] || '').match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
    const prog = css('theme-sobre-progres.css'), recap = css('recap.css');
    const canvas = fs.readFileSync(path.join(ROOT, 'js', 'features', 'recap-canvas.js'), 'utf8');
    const body = JSON.parse(canvas.match(/const RECAP_BODY = (\{[^}]+\})/)[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
    for (const n of ['body-tier-1', 'body-tier-2', 'body-tier-dot-1', 'body-tier-dot-2']) {
      assert.equal(tok(recap, '.tone-night {', n), tok(prog, ':root {', n), `écran du récap : ${n} = Progrès`);
    }
    assert.equal(body.tier1, tok(prog, ':root {', 'body-tier-1'), 'image partagée : Sous l\'objectif = Progrès');
    assert.equal(body.tier2, tok(prog, ':root {', 'body-tier-2'), 'image partagée : Objectif atteint = Progrès');
    assert.equal(body.dot1, tok(prog, ':root {', 'body-tier-dot-1'));
    assert.equal(body.dot2, tok(prog, ':root {', 'body-tier-dot-2'));
    assert.equal(tok(recap, '.tone-night {', 'body-heat-max'), 'var(--body-tier-2)', 'palier du haut : le rouge plein, jamais le rose pâle');
  });

  test('fiche (variante E) : deux lignes classées, « + N autres » au-delà de 4 noms', () => {
    const lines = name => { const m = app.musclesOf(name), lv = app.exercisePartLevels(name, m).levels;
      const r = run(`atlasRanked(${JSON.stringify(name)}, musclesOf(${JSON.stringify(name)}), ${JSON.stringify(lv)})`);
      return { main: r.filter(x => x.level >= 2).map(x => x.label), help: r.filter(x => x.level < 2).map(x => x.label) }; };
    sameJSON(lines('Développé incliné barre'), { main: ['Haut des pectoraux'], help: ['Milieu des pectoraux', 'Épaules antérieures', 'Triceps'] });
    // Tractions : principaux puis secondaires dans l'ordre de la correspondance (le plus sollicité d'abord)
    const tr = lines('Tractions pronation');
    sameJSON(tr.main, ['Grand dorsal', 'Grand rond']);
    assert.equal(tr.help[0], 'Biceps', `tractions : biceps d'abord ${tr.help}`);
    assert.ok(tr.help.length > 4);
    // « + N autres » : 4 noms au plus, donc 3 et « + N »
    const cut = run(`atlasLineItems(${JSON.stringify(tr.help.map(label => ({ label })))})`);
    assert.equal(cut.shown.length, 3);
    assert.equal(cut.more, tr.help.length - 3);
    sameJSON(run(`atlasLineItems([{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }])`).more, 0, '4 noms : tous affichés');
    // Chaque nom de la ligne garde tous ses sous-muscles (le triceps : 3 chefs) : le toucher les allume ensemble
    const inc = run(`atlasRanked('Développé incliné barre', musclesOf('Développé incliné barre'), exercisePartLevels('Développé incliné barre', musclesOf('Développé incliné barre')).levels)`);
    sameJSON(inc.find(x => x.label === 'Triceps').ids.sort(), ['triceps_lateral', 'triceps_long', 'triceps_medial']);
  });

  test('fiche : chaque nom des deux lignes a la couleur de tous ses sous-muscles, seulement ce qui est coloré sur la silhouette (panels atlas-bas t2, t3)', () => {
    const strip = t => t.replace(/\u00ad/g, '');
    const lines = (name, kind) => { const lv = app.exercisePartLevels(name, app.musclesOf(name)).levels;
      const r = run(`atlasRanked(${JSON.stringify(name)}, musclesOf(${JSON.stringify(name)}), ${JSON.stringify(lv)}, ${JSON.stringify(kind)})`);
      return { lv, r, main: r.filter(x => x.level >= 2).map(x => strip(x.label)), help: r.filter(x => x.level < 2).map(x => strip(x.label)) }; };
    // Squat (panel atlas-bas t4) : droit fémoral ciblé comme les vastes (genou étendu sous charge), le quadriceps entier
    sameJSON(lines('Squat barre', 'male').main, ['Quadriceps', 'Grand fessier']);
    // Soulevé de terre sumo : droit fémoral qui aide, le groupe puis la précision entre parenthèses
    sameJSON(lines('Soulevé de terre sumo', 'male').main.filter(l => l.startsWith('Quadriceps')), ['Quadriceps (vastes latéral et médial)']);
    assert.ok(lines('Soulevé de terre sumo', 'male').help.includes('Quadriceps (droit fémoral)'), `sumo, qui aident : ${lines('Soulevé de terre sumo', 'male').help}`);
    // Soulevé de terre roumain, homme : de dos, le grand adducteur n'est qu'un filet entre les ischio-jambiers, pas écrit
    assert.ok(lines('Soulevé de terre roumain', 'male').help.includes('Adducteurs (long adducteur)'), `${lines('Soulevé de terre roumain', 'male').help}`);
    // Mollets debout : « Mollets (gastrocnémiens) » ciblés, « Mollets (soléaire) » une fois dans « Qui aident »
    for (const kind of SEXES) {
      const ml = lines('Mollets debout', kind);
      sameJSON([ml.main, ml.help], [['Mollets (gastrocnémiens)'], ['Mollets (soléaire)']], `mollets ${kind}`);
    }
    sameJSON(lines('Extension triceps poulie haute', 'male').main, ['Triceps (chefs latéral et médial)']);
    sameJSON(lines('Extension triceps poulie haute', 'male').help, ['Triceps (chef long)']);
    assert.ok(lines('Développé incliné barre', 'male').help.includes('Triceps'), 'groupe d\'une seule couleur : le nom nu');
    // Femme, soulevé de terre roumain : le grand adducteur n'a pas de calque sur sa silhouette, il n'est pas nommé
    assert.ok(!lines('Soulevé de terre roumain', 'female').help.some(l => /grand adducteur/i.test(l)), `${lines('Soulevé de terre roumain', 'female').help}`);
    // Toute la bibliothèque, homme et femme : ciblé = rouges (niveau 2), qui aident = roses (niveau 1), seulement des
    // sous-muscles visibles sur la silhouette ; nom nu d'un groupe seulement s'il est d'une seule couleur ; tout
    // sous-muscle coloré visible est nommé, une fois
    const BPd = BP(), shown = (kind, id) => VIEWS.some(v => BPd.boxes[kind][v][id]);
    let n = 0;
    for (const name of run('EXERCISE_CATALOGUE.map(e => e.name)')) for (const kind of SEXES) {
      const { lv, r } = lines(name, kind);
      if (!r.length) continue;
      n++;
      for (const x of r) {
        assert.ok(x.ids.length && x.ids.every(id => (lv[id] >= 2) === (x.level >= 2) && lv[id] > 0 && shown(kind, id)), `${name} ${kind} : « ${x.label} » (${x.level}) ${x.ids.map(id => id + ':' + lv[id])}`);
        if (!x.label.includes('(')) {
          const group = BPd.parts.filter(p => app.atlasPillLabel(p.id) === x.label && shown(kind, p.id) && (!p.deep || lv[p.id] > 0));
          assert.ok(group.every(p => (lv[p.id] >= 2) === (x.level >= 2) && lv[p.id] > 0), `${name} ${kind} : nom nu « ${x.label} », sous-muscles ${group.map(p => p.id + ':' + (lv[p.id] || 0))}`);
        } else assert.ok(x.label.startsWith(app.atlasPillLabel(x.ids[0]) + ' ('), `${name} ${kind} : « ${x.label} » commence par son groupe`);
      }
      const named = r.flatMap(x => x.ids);
      assert.equal(new Set(named).size, named.length, `${name} ${kind} : sous-muscle nommé deux fois`);
      for (const id of Object.keys(lv).filter(id => lv[id] > 0 && shown(kind, id))) assert.ok(named.includes(id), `${name} ${kind} : ${id} coloré sans nom dans les lignes`);
      assert.equal(new Set(r.map(x => x.label)).size, r.length, `${name} ${kind} : nom en double`);
    }
    assert.ok(n >= 300, `${n} fiches vérifiées`);
  });

  test('fiche : muscles qui aident discrets quand le ciblé est petit sur la vue (abducteurs, développé incliné)', () => {
    const html = (name, kind, view) => run(`bodyAtlasLayersHtml(${JSON.stringify(kind)}, ${JSON.stringify(view)}, exercisePartLevels(${JSON.stringify(name)}, musclesOf(${JSON.stringify(name)})).levels)`);
    for (const kind of SEXES) {
      const ab = html('Abducteurs machine', kind, 'back');
      assert.ok(/data-part="glute_max"[^>]*opacity:var\(--body-sec-o-faint\)/.test(ab) && /body-map__m--faint" data-part="glute_max"/.test(ab), `abducteurs ${kind} : grand fessier discret`);
      assert.ok(/data-part="glute_med"[^>]*opacity:1/.test(ab), `abducteurs ${kind} : moyen fessier plein`);
      assert.ok(!html('Squat barre', kind, 'front').includes('body-map__m--faint'), `squat ${kind} : vastes assez grands, aidants normaux`);
    }
    // Développé incliné, homme : la bande du haut des pectoraux, 27 % des aidants ; femme : 54 %, aidants normaux
    assert.ok(html('Développé incliné barre', 'male', 'front').includes('body-map__m--faint'), 'développé incliné homme : aidants discrets');
    assert.ok(!html('Développé incliné barre', 'female', 'front').includes('body-map__m--faint'), 'développé incliné femme : aidants normaux');
    // Progrès (paliers) : jamais discrets
    assert.ok(!run(`bodyAtlasLayersHtml('male', 'back', { glute_med: 2, glute_max: 1 }, 1, true)`).includes('--faint'));
    assert.ok(/--body-sec-o-faint: 0;/.test(fs.readFileSync(path.join(ROOT, 'css', 'theme-sobre-progres.css'), 'utf8')), 'aidant discret : plus de remplissage, le contour seul (panel atlas-bas t4)');
    // Isolés : la couleur pleine revient
    assert.ok(/\[data-iso\] \.body-map__p\.body-map__m--faint\.is-on \{ opacity: var\(--body-sec-o\) !important/.test(fs.readFileSync(path.join(ROOT, 'css', 'muscles.css'), 'utf8')));
  });

  test('Progrès : séries de la période par sous-muscle (principal 1, secondaire ½), paliers, 3 exercices', () => {
    const DAY = 86_400_000, now = Date.UTC(2026, 10, 19, 12);
    const h = (d, name, n) => ({ id: name + d, date: now - d * DAY, programme: 'ppl', category: 'push',
      exercises: [{ name, sets: Array.from({ length: n }, () => ({ weight: '40', reps: '10' })) }] });
    const hist = [h(1, 'Développé incliné barre', 4), h(2, 'Développé couché barre', 3), h(3, 'Tractions pronation', 4), h(40, 'Développé incliné barre', 10)];
    const c = run(`partSetCounts(${JSON.stringify(hist)}, ${now - 28 * DAY}, ${now + 1})`);
    // Le compte suit le RÔLE AFFICHÉ sur la fiche (audit M1) : « Muscle ciblé » 1 série, « Qui aide » ½, pour chaque exercice
    const role = (ex, id) => ({ 2: 1, 1: 0.5 })[run(`exercisePartLevels(${JSON.stringify(ex)}, musclesOf(${JSON.stringify(ex)})).levels`)[id]] || 0;
    const expect = id => 4 * role('Développé incliné barre', id) + 3 * role('Développé couché barre', id) + 4 * role('Tractions pronation', id);
    for (const id of ['chest_clavicular', 'chest_sternal', 'chest_abdominal', 'triceps_long', 'lats', 'rhomboid_major', 'biceps_long']) {
      assert.equal(c.sets[id] || 0, expect(id), `${id} : séries selon le rôle de la fiche`);
    }
    // Développé incliné : haut des pectoraux ciblé (1 série) ; couché : il aide (½) ; il y a 40 jours : hors période
    assert.equal(role('Développé incliné barre', 'chest_clavicular'), 1);
    assert.equal(c.sets.chest_clavicular, 4 + 3 * role('Développé couché barre', 'chest_clavicular'));
    // Tout le catalogue : le compte et la fiche disent le même rôle pour chaque sous-muscle
    const bad = run(`EXERCISE_CATALOGUE.map(e => e.name).filter(n => { const lv = exercisePartLevels(n, musclesOf(n)).levels, r = exercisePartRoles(n, musclesOf(n));
      return Object.keys(lv).some(id => (lv[id] >= 2) !== r.p.includes(id) || (lv[id] === 1) !== r.s.includes(id)) || [...r.p, ...r.s].some(id => !(lv[id] > 0)); })`);
    sameJSON(bad, [], 'comptage = rôle affiché sur la fiche, pour tous les exercices');
    assert.equal(c.sets.lats, 4);
    sameJSON(run(`partTopExercises(${JSON.stringify(c.byEx)}, 'chest_clavicular')`)[0], ['Développé incliné barre', 4]);
    // Paliers : même échelle que les 18 muscles (séries par semaine), sous-muscle par sous-muscle, jambes comprises
    run(`data.history = ${JSON.stringify(hist)}`);
    const pl = run(`partLoad('month', ${now}, data.history)`);
    assert.equal(pl.weekly.chest_clavicular, Math.max(1, Math.round(7 / 4)));
    assert.equal(pl.levels.chest_clavicular, app.muscleLevel(pl.weekly.chest_clavicular));
    assert.equal(pl.levels.chest_abdominal > 0, true, 'couché : faisceau abdominal travaillé');
    // Jambes au détail (panel atlas-bas t2) : au soulevé de terre sumo, vastes ciblés (1 série) et droit fémoral qui aide (½) ; « Par zone »
    // des quadriceps le dit
    const sq = [h(1, 'Soulevé de terre sumo', 8), h(2, 'Soulevé de terre sumo', 8), h(3, 'Soulevé de terre sumo', 8), h(4, 'Soulevé de terre sumo', 8)];
    const pq = run(`partLoad('week', ${now}, ${JSON.stringify(sq)})`);
    assert.ok(pq.sets.vastus_lateralis > pq.sets.rectus_femoris && pq.sets.rectus_femoris > 0, `sumo : vastes ${pq.sets.vastus_lateralis}, droit fémoral ${pq.sets.rectus_femoris}`);
    const zq = run(`atlasMuscleZones(partLoad('week', ${now}, ${JSON.stringify(sq)}), 'quads', 'male')`).map(z => z.label.replace(/\u00ad/g, ''));
    sameJSON(zq, ['Droit fémoral', 'Vaste latéral', 'Vaste médial'], 'quadriceps : une zone par chef visible');
    sameJSON(run(`atlasMuscleZones(partLoad('week', ${now}, ${JSON.stringify(sq)}), 'calves', 'male')`).map(z => z.label.replace(/\u00ad/g, '')), ['Gastrocnémien médial', 'Gastrocnémien latéral', 'Soléaire']);
    assert.equal(pl.levels.delt_posterior, app.muscleLevel(pl.weekly.delt_posterior));
    assert.equal(pl.sets.rhomboid_major, 4 * role('Tractions pronation', 'rhomboid_major'), 'tractions : rhomboïdes au rôle de la fiche');
  });

  test('Progrès, « À travailler » : les muscles de salle dont une zone est grise ou pâle sur le dessin, et eux seuls', () => {
    const DAY = 86_400_000, now = Date.UTC(2026, 10, 19, 12);
    const h = (d, name, n) => ({ id: name + d, date: now - d * DAY, programme: 'ppl', category: 'push',
      exercises: [{ name, sets: Array.from({ length: n }, () => ({ weight: '40', reps: '10' })) }] });
    // Objectif atteint sur les pectoraux (12 séries par semaine), sous l'objectif ailleurs, obliques à 0
    const hist = [0, 1, 2, 3].flatMap(w => [h(w * 7 + 1, 'Développé couché barre', 12), h(w * 7 + 2, 'Squat barre', 4), h(w * 7 + 3, 'Tractions pronation', 3)]);
    run(`data.history = ${JSON.stringify(hist)}`);
    const muscles = run('MUSCLES'), byId = Object.fromEntries(muscles.map(m => [m.id, m]));
    for (const kind of ['male', 'female']) {
      const pl = run(`partLoad('month', ${now}, data.history)`);
      const items = run(`atlasToWork(partLoad('month', ${now}, data.history), ${JSON.stringify(kind)})`);
      const html = run(`bodyAtlasHtml(Object.fromEntries(Object.entries(partLoad('month', ${now}, data.history).levels).filter(([, l]) => l > 0)), { body: ${JSON.stringify(kind)}, tiers: true, crop: false })`);
      // Dessin : un sous-muscle visible est gris (aucun calque), pâle (--t1) ou plein (--t2)
      const parts = run('BODY_PARTS.parts').filter(p => p.parent && !p.deep && ['front', 'back'].some(v => run('BODY_PARTS').boxes[kind][v][p.id]));
      const shown = id => { const m = html.match(new RegExp(`class="[^"]*body-map__m--(t\\d)[^"]*" data-part="${id}"`)); return m ? m[1] : 'gris'; };
      // Zones grises ou pâles d'un muscle de salle qui n'est pas à l'objectif dans « Séries par muscle » (audit M2)
      const lowZones = parts.filter(p => shown(p.id) !== 't2' && pl.load.levels[p.parent] < 2);
      for (const m of Object.keys(pl.load.levels).filter(k => pl.load.levels[k] === 2)) {
        assert.ok(!items.some(it => it.key === m), `${kind} : ${m} à l'objectif (Séries par muscle) : jamais à travailler, même avec un sous-muscle pâle`);
      }
      // Chaque zone grise ou pâle a son muscle de salle dans la liste, et chaque nom listé a une zone grise ou pâle
      sameJSON([...new Set(lowZones.map(p => p.parent))].sort(), items.map(it => it.key).sort(), `${kind} : muscles listés = muscles qui ont une zone grise ou pâle`);
      sameJSON(items.flatMap(it => it.ids).sort(), lowZones.map(p => p.id).sort(), `${kind} : zones isolées au toucher = zones grises ou pâles`);
      assert.ok(items.every(it => it.label === byId[it.key].label), 'noms de « Séries par muscle »');
      assert.ok(items.some(it => it.key === 'obliques'), 'obliques à 0 série : dans la liste');
      assert.ok(!(items.find(it => it.key === 'chest')?.ids || []).includes('chest_sternal') && pl.levels.chest_sternal === 2, 'pectoraux à l\'objectif : jamais isolés comme à travailler');
      // Ordre : le moins de séries d'abord ; à égalité, les grands groupes avant les petits
      assert.ok(items.every((it, i) => !i || items[i - 1].sets < it.sets || (items[i - 1].sets === it.sets && items[i - 1].minor <= it.minor)),
        `ordre ${items.map(it => `${it.key}:${it.sets}${it.minor ? 'p' : ''}`).join(' ')}`);
    }
  });

  test('atlas : service worker (1× à l\'installation, jamais le 3×) et crédit BodyParts3D', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const assets = sw.slice(sw.indexOf('const ASSETS'), sw.indexOf('];', sw.indexOf('const ASSETS')));
    for (const sex of SEXES) for (const view of VIEWS) {
      for (const f of ['base.webp', 'hit.png', ...Object.keys(man.bodies[sex][view].parts).map(id => `p/${id}.webp`)]) {
        assert.ok(assets.includes(`'/img/body2/${sex}/${view}/${f}'`), `ASSETS : ${sex}/${view}/${f}`);
      }
    }
    assert.ok(!/body2[^']*(@3x|\/p3\/)/.test(assets), 'aucun 3× dans la liste d\'installation');
    ['/js/data/body-parts.js', '/js/data/exercise-parts.js', '/js/data/atlas.js', '/js/ui/body-zoom.js'].forEach(f => assert.ok(assets.includes(`'${f}'`), f));
    const credit = 'Formes musculaires adaptées de BodyParts3D, © The Database Center for Life Science, licence CC BY 4.0';
    assert.ok(run('BODY_PARTS_CREDIT').startsWith(credit), 'Réglages › Aide : crédit');
    assert.ok(fs.readFileSync(path.join(ROOT, 'mentions-legales.html'), 'utf8').includes(credit), 'mentions légales : crédit');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(html.indexOf('js/data/exercise-catalogue.js') < html.indexOf('js/data/atlas.js') && html.indexOf('js/ui/body-tip.js') < html.indexOf('js/ui/body-zoom.js'));
  });
}
