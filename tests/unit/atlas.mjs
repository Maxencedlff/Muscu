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
  const man = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
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
    sameJSON(fs.readdirSync(DIR).sort(), ['female', 'male', 'manifest.json']);
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
    assert.equal(app.atlasRole(2), 'Muscle principal');
    assert.equal(app.atlasRole(1), 'Muscle secondaire');
    assert.equal(app.atlasRole(0), 'Non ciblé par cet exercice');
  });

  test('atlas : carte de la fiche en 1× seulement, rouge plein / atténué, profonds par-dessus', () => {
    assert.equal(run('BODY_PART_SEC_OPACITY'), run('bodyHeatOpacity(SECONDARY_INTENSITY)'), 'atténué = opacité des secondaires de la fiche');
    const html = run(`bodyAtlasHtml(exercisePartLevels('Développé incliné barre', musclesOf('Développé incliné barre')).levels, { body: 'male', tap: true, title: 'Développé incliné barre' })`);
    assert.ok(!/@3x|\/p3\/|lines|hit\.png/.test(html), 'aucune image 3× au premier affichage');
    assert.ok(/class="body-map__m body-map__p" data-part="chest_clavicular"/.test(html), 'claviculaire en rouge plein');
    assert.ok(/body-map__m--sec" data-part="chest_sternal"/.test(html) && /body-map__m--sec" data-part="delt_anterior"/.test(html), 'sterno-costal, deltoïde antérieur atténués');
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
