// ═══════════════════════════════════════════════════════════
//  Affiche du coach (js/data/coach-poster.js, js/features/coach-poster-art.js) : contenu exact, initiales, accord
//  « Nouveau / Nouvelle », story et carré, zones sûres d'Instagram, rien d'un élève, photo d'origine réduite à 2048 px.
//  Dessin vérifié sur un faux canvas qui note chaque texte et chaque image. Le parcours réel (coach sans photo, photo
//  mise, affiche partagée ; élève sans l'entrée) est dans tests/test_affiche_coach.py.
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Faux canvas 2D : largeur d'un texte = 0,5 × taille de police × nombre de caractères
function fakeCanvas(ops = []) {
  const grad = { addColorStop() {} };
  const ctx = {
    font: '400 10px x', fillStyle: '', strokeStyle: '', textAlign: 'left', textBaseline: 'alphabetic', letterSpacing: '0px',
    lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over', clipped: 0, tx: 0, ty: 0, stack: [],
    measureText(t) { const size = parseFloat((this.font.match(/(\d+(?:\.\d+)?)px/) || [0, 10])[1]); return { width: String(t).length * size * .5 }; },
    fillText(text, x, y) { this.spacings.push(this.letterSpacing); ops.push({ op: 'text', text, x: x + this.tx, y: y + this.ty, font: this.font, fill: this.fillStyle, align: this.textAlign }); },
    strokeText(text, x, y) { ops.push({ op: 'text', text, x: x + this.tx, y: y + this.ty, font: this.font, fill: this.strokeStyle, stroke: true }); },
    fillRect(x, y, w, h) { ops.push({ op: 'rect', x, y, w, h, fill: this.fillStyle }); },
    drawImage(img, x, y, w, h) { ops.push({ op: 'image', id: img.id, x, y, w, h, clipped: this.clipped }); },
    fill() { ops.push({ op: 'fill', fill: this.fillStyle }); },
    save() { this.stack.push([this.tx, this.ty, this.clipped]); }, restore() { [this.tx, this.ty, this.clipped] = this.stack.pop() || [0, 0, 0]; },
    clip() { this.clipped = 1; },
    gradients: 0, spacings: [],
    createLinearGradient() { this.gradients++; return grad; }, createRadialGradient() { this.gradients++; return grad; },
    beginPath() {}, closePath() {}, arc() {}, rect() {}, roundRect(x, y, w, h) { ops.push({ op: 'rrect', x: x + this.tx, y: y + this.ty, w, h }); }, moveTo() {}, lineTo() {}, stroke() {}, arcTo() {},
    translate(x, y) { this.tx += x; this.ty += y; }, rotate() {}, setLineDash() {},
  };
  return { width: 0, height: 0, ops, ctx, id: 'canvas', getContext: () => ctx };
}
const img = (id, w = 1600, h = 1600) => ({ id, width: w, height: h, naturalWidth: w, naturalHeight: h });

export default function ({ test, app, run, assert, sameJSON, ROOT }) {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const model = o => app.coachPosterModel({ name: 'Léa Martin', username: 'lea.coach', code: 'K7M2QX9PR4TD', badge: true, hasPhoto: true, silhouette: 'female', ...o });
  const draw = (m, format = 'story', assets = { photo: img('photo'), icon: img('icon', 192, 192), body: img('body', 1152, 2520) }) => {
    const c = fakeCanvas();
    const saved = app.document.createElement;
    // Recadrage de la photo (cpaCover) : un canvas intermédiaire
    app.document.createElement = () => { const x = fakeCanvas(c.ops); x.id = 'cover'; return x; };
    try { app.drawCoachPosterArt(c, m, assets, { format }); } finally { app.document.createElement = saved; }
    return c;
  };
  const texts = c => c.ops.filter(o => o.op === 'text').map(o => o.text);
  const count = (c, id) => c.ops.filter(o => o.op === 'image' && o.id === id).length;

  test('affiche du coach : contenu exact (titre accordé à la silhouette choisie, nom, pseudo, badge, consigne, code)', () => {
    sameJSON(model(), {
      name: 'Léa Martin', specialty: '', handle: '@lea.coach', initials: 'LM', photo: true, title: 'NOUVELLE COACH',
      badge: 'Carte pro déclarée', ctaLine: 'Rejoins-moi sur MDLF Training',
      ctaWhere: 'Entre mon code dans Social › Rejoindre un coach', code: 'K7M2-QX9P-R4TD',
    });
    // Rien d'autre que ce qui vient du coach : aucun champ pour un élève
    sameJSON(Object.keys(model()).sort(), ['badge', 'code', 'ctaLine', 'ctaWhere', 'handle', 'initials', 'name', 'photo', 'specialty', 'title']);
    assert.equal(model({ specialty: '  Force ·   Perte de poids ' }).specialty, 'Force · Perte de poids', 'spécialité nettoyée');
    // 9e panel : plus de ligne de remplissage (« Programme · Suivi… ») : sans spécialité, rien à cet endroit
    assert.ok(!/Programme · Suivi|COACH_POSTER_PERKS/.test(read('js/data/coach-poster.js') + read('js/features/coach-poster-art.js')), 'ligne de remplissage retirée');
    assert.equal(run('CPA.grey'), '#A0A0A7', 'blanc secondaire à 8:1 sur le noir');
    assert.equal(model({ specialty: 'x'.repeat(60) }).specialty.length, 40, 'spécialité : 40 caractères au plus');
    assert.equal(model({ name: '', username: 'sam' }).initials, '', 'jamais d\'initiales tirées du pseudo');
    assert.equal(model({ silhouette: 'male' }).title, 'NOUVEAU COACH');
    assert.equal(model({ neutral: true }).title, 'COACH', 'titre sans genre');
    assert.equal(model({ silhouette: 'male', neutral: true }).title, 'COACH');
    // Jamais déduit du prénom : un prénom « féminin » avec la silhouette homme reste au masculin
    assert.equal(model({ name: 'Marie Durand', silhouette: 'male' }).title, 'NOUVEAU COACH');
    assert.equal(model({ silhouette: 'autre' }).title, 'NOUVEAU COACH', 'valeur inconnue : masculin par défaut');
    assert.equal(model({ badge: false }).badge, null, 'sans carte déclarée : pas de badge');
    assert.equal(model({ name: '' }).name, '', 'sans nom : pas de nom géant (jamais le @pseudo en capitales)');
    assert.equal(model({ name: '' }).handle, '@lea.coach', 'le pseudo reste, une fois');
    assert.equal(model({ name: '  Léa   Martin  ' }).name, 'Léa Martin', 'espaces resserrés');
    assert.equal(model({ name: 'x'.repeat(60) }).name.length, 40, '40 caractères au plus');
    assert.match(app.coachPosterAlt(model()), /^Affiche « Nouvelle coach » : Léa Martin, sur MDLF Training, code K7M2-QX9P-R4TD$/);
    assert.match(app.coachPosterAlt(model({ neutral: true })), /^Affiche « Coach » : /);
  });

  test('affiche du coach : initiales', () => {
    assert.equal(app.posterInitials('Léa Martin'), 'LM');
    assert.equal(app.posterInitials('élodie de la Tour'), 'ÉD', 'deux premiers mots, accent gardé');
    assert.equal(app.posterInitials('max_coach'), 'MC');
    assert.equal(app.posterInitials('max'), 'M');
    assert.equal(app.posterInitials('🏋️ Tom'), 'T', 'emoji ignoré');
    assert.equal(app.posterInitials(''), '?');
  });

  test('affiche du coach : story et carré, chaque texte écrit, petits textes en casse normale, important hors des zones d\'Instagram', () => {
    for (const format of ['story', 'square']) for (const sil of ['female', 'male']) {
      const c = draw(model({ silhouette: sil }), format);
      const tag = `${format}/${sil}`;
      assert.equal(c.width, 1080, tag);
      assert.equal(c.height, format === 'story' ? 1920 : 1080, tag);
      const t = texts(c);
      // 6e panel : « · Sur MDLF Training » retiré de la ligne du pseudo (l'appel et la signature le disent)
      const handle = '@lea.coach';
      assert.ok(!t.some(x => x.includes('Sur MDLF Training')), `${tag} : plus de « Sur MDLF Training »`);
      for (const w of [sil === 'female' ? 'NOUVELLE' : 'NOUVEAU', 'COACH', 'LÉA MARTIN', handle, 'Carte pro déclarée',
        'K7M2-QX9P-R4TD', 'MDLF Training']) {
        assert.ok(t.includes(w), `${tag} : « ${w} » écrit (${JSON.stringify(t)})`);
      }
      // Consigne sur une ligne, ou sur deux en story (coupée avant « et ») pour rester lisible
      // 7e panel : télécharger, le code, puis où l'entrer ; ce que l'élève gagne ; consignes de 26 px au moins
      assert.ok(t.includes('Rejoins-moi sur MDLF Training') && t.includes('Entre mon code dans Social › Rejoindre un coach'), `${tag} : consignes`);
      for (const o of c.ops.filter(x => x.op === 'text' && ['Rejoins-moi sur MDLF Training', 'Entre mon code dans Social › Rejoindre un coach', 'Carte pro déclarée'].includes(x.text))) {
        assert.ok(parseFloat(o.font.match(/(\d+(?:\.\d+)?)px/)[1]) >= 22, `${tag} : « ${o.text} » trop petit (${o.font})`);
      }
      // Capitales seulement pour les gros titres en Anton (titre, nom, code) ; tout le reste en casse normale
      for (const o of c.ops.filter(x => x.op === 'text' && !/Anton/.test(x.font))) {
        assert.ok(!/[A-ZÀ-Ý]{3}/.test(o.text.replace(/MDLF/g, '')), `${tag} : « ${o.text} » en capitales hors titre`);
      }
      assert.ok(!t.some(x => x.endsWith('…')), `${tag} : aucun texte tronqué`);
      if (format === 'story') {
        // Tout le texte entre 250 et 1650 px (barres d'Instagram en haut, champ de réponse en bas)
        for (const o of c.ops.filter(x => x.op === 'text')) {
          assert.ok(o.y > 250 && o.y <= 1670, `${tag} : « ${o.text} » à y = ${Math.round(o.y)}, hors des 250 px du haut et du bas`);
        }
      }
      assert.equal(count(c, 'photo'), 1, `${tag} : photo du coach dessinée`);
      assert.equal(count(c, 'body'), 1, `${tag} : personnage en décor`);
    }
  });

  test('affiche du coach : fond noir seul, un seul orange plein ; aucun dégradé, aucune lueur, jamais de lettres espacées', () => {
    for (const format of ['story', 'square']) {
      const c = draw(model(), format);
      const fills = [...new Set(c.ops.map(o => o.fill).filter(Boolean))].map(f => String(f).toUpperCase());
      assert.ok(c.ops.every(o => !o.fill || typeof o.fill === 'string'), `${format} : aucun dégradé posé`);
      assert.ok(fills.includes('#000000'), `${format} : fond noir pur`);
      assert.ok(!fills.includes('#F2F2F7'), `${format} : plus de fond clair`);
      const oranges = fills.filter(f => ['#A85400', '#FF7A1A', '#A04E00', '#FF8A3D', '#CA4D10', '#B8460F'].includes(f));
      assert.deepEqual(oranges, ['#CA4D10'], `${format} : un seul orange, celui des boutons (${fills})`);
      assert.ok(c.ops.filter(o => o.op === 'text').every(o => !['#000000', '#CA4D10'].includes(String(o.fill).toUpperCase())), `${format} : aucun texte noir ni orange`);
      assert.equal(c.ctx.gradients, 0, `${format} : aucun dégradé créé`);
      assert.ok(c.ctx.spacings.every(v => v === '0px'), `${format} : lettres jamais espacées`);
      // Personnage bien présent : presque pas assombri (au plus 10 %), à la taille du concept v2
    }
    assert.ok(run('CPA.bodyDim') <= 0.1, 'léger assombrissement uniforme seulement');
    // Personnage comme l'atlas de l'app en sombre (branche affichage-e) : rouge #FF453A en lumière douce, corps à .46
    assert.equal(run('CPA.heat'), '#FF453A'); assert.equal(run('CPA.atlasBright'), 0.46);
    assert.ok(/globalCompositeOperation = 'soft-light'/.test(read('js/features/coach-poster-art.js')), 'muscles en lumière douce (soft-light)');
    sameJSON(run('CPA_FEMALE_SKIP'), ['chest_sternal', 'chest_abdominal'], 'silhouette femme : la poitrine reste au gris du corps');
    // Code : police large (SF Pro Display Heavy), pas l'Anton serrée
    const pill = draw(model()).ops.find(o => o.op === 'text' && o.text === 'K7M2-QX9P-R4TD');
    assert.ok(/800 .*SF Pro Display/.test(pill.font) && !/Anton/.test(pill.font), `code en SF Pro Display Heavy (${pill.font})`);
    assert.match(run('CPA.grey'), /^#[0-9A-F]{6}$/i, 'gris opaque (rien du corps ne transparaît dans la lettre)');
    const src = read('js/features/coach-poster-art.js');
    assert.ok(!/create(Linear|Radial)Gradient|shadowBlur|shadowColor|\.filter\s*=/.test(src), 'aucun dégradé, aucune ombre, aucun filtre dans le dessin');
    assert.ok(!/CPA_THEMES|#F2F2F7|theme\s*===/.test(src), 'plus de thème clair');
    const css = read('css/base.css') + read('css/theme-sobre.css');
    for (const v of ['#CA4D10', 'rgba(235,235,245', '#1C1C1E']) assert.ok(css.includes(v), `${v} repris des feuilles de style de l'app`);
  });

  test('affiche du coach : personnage entier à gauche, sans coupe ni masque ; aucun texte ni photo posé sur lui', () => {
    for (const format of ['story', 'square']) for (const m of [model(), model({ name: 'Marie-Charlotte Delafontaine', username: 'marie.charlotte.coach' })]) {
      const c = draw(m, format);
      const body = c.ops.filter(o => o.op === 'image' && o.id === 'body');
      assert.equal(body.length, 1, `${format} : personnage dessiné une fois`);
      const bd = body[0], right = bd.x + bd.w;
      assert.equal(bd.clipped, 0, `${format} : aucun masque sur le personnage`);
      assert.ok(bd.x >= 0 && right <= 1080 * (format === 'story' ? 0.45 : 0.4) + 0.5, `${format} : dans la colonne de gauche (${Math.round(bd.x)} à ${Math.round(right)})`);
      assert.ok(bd.w >= 1080 * 0.3, `${format} : entier et bien visible (${Math.round(bd.w)} px de large)`);
      // La photo domine : 560 px au moins en story, 46 % de la largeur en carré
      const photo = c.ops.find(o => o.op === 'image' && o.id === 'cover');
      assert.ok(photo && photo.w >= (format === 'story' ? 560 : 1080 * 0.3) - 0.5, `${format} : photo de ${photo && Math.round(photo.w)} px`);
      // 10e panel : 60 px au moins à gauche de la main en story, 50 px au-dessus de la tête en carré
      assert.ok(format === 'story' ? bd.x >= 60 - 0.5 : bd.y >= 50 - 0.5, `${format} : marge du personnage (x ${Math.round(bd.x)}, y ${Math.round(bd.y)})`);
      if (format === 'story') assert.ok(bd.y >= 250 && bd.y + bd.h <= 1700, `story : entier dans la zone sûre (${Math.round(bd.y)} à ${Math.round(bd.y + bd.h)})`);
      // Tout texte est soit au-dessus du personnage (titre, story), soit dans la colonne de droite
      for (const o of c.ops.filter(x => x.op === 'text')) {
        const size = parseFloat(o.font.match(/(\d+(?:\.\d+)?)px/)[1]), half = String(o.text).length * size * 0.5 / 2;
        const leftEdge = o.align === 'left' ? o.x : o.align === 'right' ? o.x - 2 * half : o.x - half;
        assert.ok(o.y < bd.y || o.y - size > bd.y + bd.h || leftEdge >= right - 1, `${format} : « ${o.text} » posé sur le personnage (x ${Math.round(leftEdge)} < ${Math.round(right)})`);
      }
      assert.equal(c.ops.filter(o => o.op === 'text' && o.stroke).length, 0, `${format} : plus aucun contour (rien n'est posé sur le corps)`);
      const rects = c.ops.filter(o => o.op === 'rect' && !(o.x === 0 && o.y === 0 && o.w === 1080));
      assert.equal(rects.length, 0, `${format} : aucune bande ni rectangle`);
      assert.ok(c.ops.some(o => o.op === 'text' && o.text.startsWith('@') && o.fill === '#FFFFFF'), `${format} : pseudo en blanc`);
    }
  });

  test('affiche du coach : la story remplit la zone sûre (titre et photo agrandis selon la place, 5e panel)', () => {
    const titleSize = c => Math.max(...c.ops.filter(o => o.op === 'text' && /Anton/.test(o.font) && o.text === 'COACH').map(o => parseFloat(o.font.match(/(\d+(?:\.\d+)?)px/)[1])));
    const photoW = c => c.ops.find(o => o.op === 'image' && o.id === 'cover')?.w || 0;
    const full = draw(model({ specialty: 'Force · Perte de poids' }), 'story'), light = draw(model({ badge: false }), 'story');
    assert.ok(photoW(full) >= 590, `photo de ${Math.round(photoW(full))} px avec tout le bloc d'identité`);
    assert.ok(titleSize(light) > titleSize(full) && photoW(light) >= photoW(full), `moins de lignes sous la photo : titre plus grand (${titleSize(light)} contre ${titleSize(full)})`);
    assert.ok(titleSize(draw(model({ neutral: true, badge: false }), 'story')) >= 200, '« COACH » seul : titre agrandi');
    for (const c of [full, light]) {
      const ys = c.ops.filter(o => o.op === 'text').map(o => o.y);
      assert.ok(Math.max(...ys) <= 1670 && Math.min(...ys) > 250, `tout entre 250 et 1670 px (${Math.round(Math.min(...ys))} à ${Math.round(Math.max(...ys))})`);
      // Centré : autant de noir au-dessus du titre qu'en dessous de la signature (à 60 px près)
      const top = Math.min(...ys) - 140, bot = 1920 - Math.max(...ys);
      assert.ok(Math.abs(top - bot) <= 120, `bloc centré (haut ${Math.round(top)}, bas ${Math.round(bot)})`);
    }
  });

  test('affiche du coach : 24 px d\'air au moins entre le bloc d\'identité et la carte du code (9e panel)', () => {
    for (const format of ['story', 'square']) for (const o of [{}, { name: 'Marie-Charlotte Delafontaine', username: 'marie.charlotte.coach', specialty: 'Rééducation · Mobilité · Pilates' }]) {
      const c = draw(model(o), format), rr = c.ops.filter(x => x.op === 'rrect');
      const pill = rr.find(x => x.h >= 150), badge = rr.filter(x => x.h < 80 && x.y < pill.y).pop();
      const lastText = Math.max(...c.ops.filter(x => x.op === 'text' && x.y < pill.y).map(x => x.y));
      const bottom = Math.max(badge ? badge.y + badge.h : 0, lastText);
      assert.ok(pill.y - bottom >= 24, `${format} ${o.name || 'Léa'} : ${Math.round(pill.y - bottom)} px au-dessus du code`);
    }
  });

  test('affiche du coach : titre « COACH » seul ; sans photo, initiales et jamais le personnage à la place de la photo', () => {
    const t = texts(draw(model({ neutral: true })));
    assert.ok(!t.some(x => /NOUVE/.test(x)) && t.includes('COACH'), 'ni nouveau ni nouvelle');
    const c = draw(model({ hasPhoto: false }));
    assert.equal(count(c, 'photo'), 0, 'sans photo : aucune photo');
    assert.equal(count(c, 'body'), 1, 'sans photo : le personnage reste un décor, une seule fois');
    assert.ok(texts(c).includes('LM'), 'initiales du nom dans le rond');
  });

  test('affiche du coach : prénom et pseudo longs, rien de coupé ni de tronqué', () => {
    for (const format of ['story', 'square']) {
      const c = draw(model({ name: 'Marie-Charlotte Delafontaine', username: 'marie.charlotte.coach' }), format);
      const t = texts(c);
      // Une ligne, ou deux (prénom puis nom) ; 64 px d'air au moins entre le nom et le bord droit de l'image
      assert.ok(t.includes('MARIE-CHARLOTTE DELAFONTAINE') || (t.includes('MARIE-CHARLOTTE') && t.includes('DELAFONTAINE')), `${format} : nom entier ${JSON.stringify(t)}`);
      for (const o of c.ops.filter(x => x.op === 'text' && /MARIE|DELAFONTAINE/.test(x.text))) {
        const size = parseFloat(o.font.match(/(\d+(?:\.\d+)?)px/)[1]);
        assert.ok(o.x + String(o.text).length * size * 0.5 / 2 <= 1080 - 64, `${format} : « ${o.text} » trop près du bord droit`);
      }
      assert.ok(t.includes('@marie.charlotte.coach'), `${format} : pseudo long entier`);
      for (const o of c.ops.filter(x => x.op === 'text')) {
        const size = parseFloat(o.font.match(/(\d+(?:\.\d+)?)px/)[1]), w = String(o.text).length * size * .5;
        assert.ok(w <= 1080, `${format} : « ${o.text} » plus large que l'image (${Math.round(w)} px)`);
      }
    }
  });

  test('affiche du coach : photo d\'origine réduite à 2048 px au plus, jamais agrandie ; réglages par compte', () => {
    sameJSON(app.posterPhotoSize(4032, 3024), { w: 2048, h: 1536 });
    sameJSON(app.posterPhotoSize(3024, 4032), { w: 1536, h: 2048 });
    sameJSON(app.posterPhotoSize(800, 600), { w: 800, h: 600 });
    sameJSON(app.posterPhotoSize(0, NaN), { w: 1, h: 1 });
    app.localStorage.removeItem('mdlf_coach_poster');
    assert.equal(app.coachPosterPrefs('u1'), null);
    app.coachPosterSavePrefs('u1', { name: ' Léa ', specialty: 'Force', silhouette: 'female', neutral: true });
    sameJSON(app.coachPosterPrefs('u1'), { name: 'Léa', specialty: 'Force', silhouette: 'female', neutral: true, style: 'hero' });
    app.coachPosterSavePrefs('u1', { name: '', silhouette: 'x' });
    sameJSON(app.coachPosterPrefs('u1'), { name: '', specialty: '', silhouette: 'male', neutral: false, style: 'hero' }, 'valeur inconnue ramenée');
    assert.equal(app.coachPosterPrefs('u2'), null, 'autre compte : rien');
    app.localStorage.setItem('mdlf_coach_poster', '{pas du json');
    assert.equal(app.coachPosterPrefs('u1'), null, 'illisible : valeurs par défaut');
    app.localStorage.removeItem('mdlf_coach_poster');
    run('void 0');
  });

  test('affiche du coach : entrée réservée au coach validé, silhouette préremplie par le réglage du compte, polices hors ligne, rien envoyé', () => {
    const ui = read('js/features/coach-poster-ui.js');
    assert.match(ui, /function coachPosterCellHtml\(\) \{\n\s+if \(!account\.user \|\| coachRole\(\)\.isCoach !== true\) return '';/);
    assert.match(ui, /async function openCoachPoster\(\) \{\n\s+if \(!account\.user \|\| coachRole\(\)\.isCoach !== true/);
    assert.match(ui, /async function coachPosterKeepOriginal\(file\) \{\n.*\n\s+if \(!me \|\| coachRole\(\)\.isCoach !== true/, 'photo d\'origine gardée pour un coach seulement');
    assert.ok(ui.includes("silhouette: prefs ? prefs.silhouette : (bodySilhouette() === 'female' ? 'female' : 'male')"), 'silhouette : réglage du compte par défaut');
    assert.ok(!/posterName\([^)]*\)\s*[.=]=|prenom|firstName/i.test(read('js/data/coach-poster.js').split('function coachPosterModel')[1].split('}')[0]), 'genre jamais déduit du nom');
    // Seul appel : le nom de l'affiche (section « Nom de l'affiche montré aux élèves »), jamais l'image
    const [data, names] = read('js/data/coach-poster.js').split("// ── Nom de l'affiche montré aux élèves");
    const all = ui + data + read('js/features/coach-poster-art.js');
    assert.ok(!/sb\.|\.rpc\(|fetch\(|functions\.invoke|storage\.from/.test(all), 'aucun appel au serveur : tout est dessiné sur l\'appareil');
    assert.deepEqual([...new Set(names.match(/posterRpc\('([a-z_]+)'/g))], ["posterRpc('coach_set_poster_name'", "posterRpc('coach_poster_name'"], 'appels du nom seulement');
    assert.ok(!/fetch\(|functions\.invoke|storage\.from/.test(names), 'rien d\'autre envoyé');
    const sw = read('sw.js'), html = read('index.html');
    for (const f of ['js/data/coach-poster.js', 'js/features/coach-poster-art.js', 'js/features/coach-poster-ui.js']) {
      assert.ok(sw.includes(`'/${f}'`), `${f} dans sw.js`);
      assert.ok(html.includes(`<script src="${f}"></script>`), `${f} dans index.html`);
    }
    assert.ok(sw.includes("'/fonts/anton.woff2'"), 'police hors ligne');
    assert.ok(fs.statSync(path.join(ROOT, 'fonts', 'anton.woff2')).size < 60_000, 'police réduite au latin');
    assert.ok(/SIL OPEN FONT LICENSE/i.test(read('fonts/OFL-Anton.txt')), 'licence OFL jointe');
    assert.ok(read('scripts/build-web.mjs').includes("'fonts'"), 'polices copiées dans l\'app iOS');
    assert.ok(read('js/features/coach-ui.js').includes('coachPosterCellHtml()'));
    assert.ok(read('js/features/coach-pro-ui.js').includes('coachPosterCellHtml()'));
    assert.ok(read('js/data/account.js').includes('posterPhotoClear(account.user?.id)'), 'photo de l\'affiche effacée avec le compte');
  });

  test('affiche du coach : nom montré dans Mon coach, envoyé au partage seulement, lu par le coach et ses élèves', () => {
    const sql = read('supabase/migrations/20261120020000_nom_affiche_coach.sql');
    const down = read('supabase/rollback/20261120020000_nom_affiche_coach_down.sql');
    assert.ok(/PAS APPLIQUÉE EN PRODUCTION/.test(sql), 'migration marquée non appliquée');
    for (const f of ['coach_set_poster_name(text)', 'coach_poster_name(uuid)']) {
      assert.ok(sql.includes(`grant execute on function public.${f} to authenticated;`), `GRANT de ${f}`);
      assert.ok(down.includes(`drop function if exists public.${f}`), `${f} absent du retour arrière`);
    }
    assert.ok(!/grant[^;]*on public\.coach_poster_names/.test(sql) && /revoke all on public\.coach_poster_names/.test(sql), 'table lisible par un client');
    assert.ok(/char_length\(name\) between 1 and 40/.test(sql) && sql.includes('private.blocked_between') && sql.includes('public.coach_links'), 'nom borné, élèves seulement, blocage');
    assert.ok(read('supabase/rollback/ORDRE.md').includes('20261120020000_nom_affiche_coach_down.sql'), 'ordre de démontage');
    // Envoyé quand le coach partage (onShared), jamais à la frappe ; dit sous les réglages
    const ui = read('js/features/coach-poster-ui.js');
    assert.ok(/onShared: \(\) => \{ if \(mine\.name\) coachPosterPublishName\(mine\.name\)/.test(ui), 'envoi au partage');
    assert.equal((ui.match(/coachPosterPublishName\(/g) || []).length, 1, 'un seul envoi du nom');
    assert.ok(ui.includes("tes élèves voient ton nom dans ${coachWord('Mon', myOwnCoachForm())}"), 'dit au coach');
    assert.ok(read('js/features/share.js').includes("if (['shared', 'handed', 'downloaded'].includes(result)) st.onShared?.(result);"), 'onShared seulement après un partage fait (jamais sur une feuille annulée)');
    assert.ok(!/card_name/.test(read('js/features/coach-poster-ui.js')), 'jamais le nom de la carte pro en préremplissage');
    assert.ok(/coachPosterForgetDevice/.test(read('js/data/account.js')) && /coachPosterForgetDevice/.test(read('js/features/settings.js')), 'affiche effacée de l\'appareil');
    assert.ok(read('js/features/coach-ui.js').includes('coachPosterNameOf(p.user_id)'), 'Mon coach lit le nom');
    assert.equal(run('posterName(" Léa \\u0007  Martin ")'), 'Léa Martin');
    assert.equal(run('posterName("L\\u200Béa \\u202EMartin\\uFEFF\\u2066")'), 'Léa Martin', 'mise en forme invisible retirée');
  });

  test('affiche du coach : aperçu refusé (un autre déjà ouvert) : openStoryPreview dit false, l\'affiche est libérée', async () => {
    // openStoryPreview du vrai share.js, isolé : refuse quand un aperçu est déjà ouvert
    const src = read('js/features/share.js');
    const fn = src.slice(src.indexOf('async function openStoryPreview'), src.indexOf('\n}\n', src.indexOf('async function openStoryPreview')) + 2);
    const open = new Function('shareState', `${fn}; return openStoryPreview;`)({ tools: {} });
    assert.equal(await open({}, () => {}), false, 'refusé : false');
    assert.ok(/await sharePreviewDraw\(state\);\n {2}return true;\n\}/.test(fn), 'ouvert : true');
    // L'affiche libère cposter quand l'aperçu est refusé ou échoue
    const ui = read('js/features/coach-poster-ui.js');
    assert.ok(/ok = \(await opened\) !== false/.test(ui) && /if \(!ok && cposter === mine\) cposter = null;/.test(ui), 'cposter libéré si refusé');
  });
  test('affiche du coach : mise en page « hero » (vote du 22/11), celle de l\'écran ; aux couleurs de l\'app, aucun texte sur le personnage', () => {
    const drawL = (o, format = 'story', layout = 'hero', assets = { photo: img('photo'), icon: img('icon', 192, 192), body: img('body', 1152, 2520) }) => {
      const c = fakeCanvas(), saved = app.document.createElement;
      app.document.createElement = () => { const x = fakeCanvas(c.ops); x.id = 'cover'; return x; };
      try { app.drawCoachPosterArt(c, model(o), assets, { format, layout }); } finally { app.document.createElement = saved; }
      return c;
    };
    assert.ok(/drawCoachPosterArt\([^)]*\{ format, layout: posterStyle\(mine\.style\) \}\)/.test(read('js/features/coach-poster-ui.js')), 'l\'écran dessine le style choisi');
    assert.equal(app.posterStyle(undefined), 'hero', 'sans choix : « Avec le bonhomme » (hero)');
    for (const format of ['story', 'square']) {
      sameJSON(drawL({ specialty: 'Force' }, format, 'inconnue').ops, drawL({ specialty: 'Force' }, format, 'figure').ops, `${format} : layout inconnu, la mise en page d'avant`);
      const H = format === 'square' ? 1080 : 1920;
      for (const [n, o, a] of [['photo', { specialty: 'Force' }], ['nom long', { name: 'Marie-Charlotte Delafontaine', specialty: 'Rééducation · Mobilité · Pilates' }],
        ['coach seul', { neutral: true }], ['sans photo', { hasPhoto: false }, { photo: null, icon: img('icon', 192, 192), body: img('body', 1152, 2520) }]]) {
        const c = drawL(o, format, 'hero', a), t = c.ops.filter(x => x.op === 'text'), tag = `${format} ${n}`;
        const body = c.ops.find(x => x.op === 'image' && x.id === 'body'), card = c.ops.find(x => x.op === 'rrect' && x.w > 800);
        assert.ok(body && card, `${tag} : personnage et carte du code`);
        assert.ok(t.every(x => !/Anton/.test(x.font)), `${tag} : SF Pro partout, pas l'Anton`);
        assert.ok(t.every(x => x.fill !== '#000000'), `${tag} : aucun texte noir (plus d'aplat orange)`);
        assert.ok(!t.some(x => x.fill === '#CA4D10' || x.fill === '#FF7A1A'), `${tag} : aucun texte orange (27/11 : l'orange n'est qu'aux aplats)`);
        assert.ok(!t.some(x => /@lea|Carte pro/.test(x.text)), `${tag} : ni pseudo ni badge`);
        assert.ok(t.some(x => x.text === 'K7M2-QX9P-R4TD'), `${tag} : le code`);
        // Aucun texte sur le personnage : au-dessus de sa tête, ou dans la carte du code (les initiales sont dans le rond)
        // Carré (23/11) : le nom et la spécialité à droite du personnage, à hauteur de ses épaules (85 % de la largeur de
        // son image), là où ses bras ne sont pas encore écartés (30 % de sa hauteur)
        const beside = x => format === 'square' && x.x - 0.25 * parseFloat(x.font.match(/(\d+)px/)[1]) * x.text.length >= body.x + 0.86 * body.w && x.y < body.y + 0.3 * body.h;
        for (const x of t.filter(z => z.text !== 'LM')) assert.ok(x.y < body.y + 4 || beside(x) || (x.y > card.y && x.y < card.y + card.h), `${tag} : « ${x.text} » hors du personnage (x ${Math.round(x.x)}, y ${Math.round(x.y)}, tête ${Math.round(body.y)})`);
        if (format === 'square') {
          const photo = c.ops.find(o => o.op === 'image' && o.id === 'cover');   // la photo recadrée posée sur l'affiche
          if (photo) assert.ok(photo.y <= body.y && photo.y + photo.h >= body.y + 0.09 * body.h, `${tag} : la photo couvre la tête du personnage`);
          assert.ok(card.h <= 160, `${tag} : carte du code moins haute (${card.h})`);
        }
        if (format === 'story') assert.ok(t.every(x => x.y > 250 && x.y < 1670) && card.y + card.h <= 1670, `${tag} : zone sûre d'Instagram`);
        assert.ok(t.every(x => x.y > 0 && x.y < H), `${tag} : rien hors de l'image`);
        assert.ok(c.ops.some(x => x.op === 'image' && x.id === 'icon' && x.y > card.y), `${tag} : icône de l'app dans la carte du code`);
      }
    }
    assert.equal(run('CPL.heroAlpha'), 0.4, 'personnage à 40 % d\'opacité uniforme');
    assert.equal(run('CPL.ring'), '#AEAEB2', 'liseré gris clair (plus d\'anneau orange)');
  });

  // Style (24/11) : « Avec le bonhomme » (hero, défaut) ou « Photo seule » (photo)
  const drawS = (o, format, layout, assets = { photo: img('photo'), icon: img('icon', 192, 192), body: img('body', 1152, 2520) }) => {
    const c = fakeCanvas(), saved = app.document.createElement;
    app.document.createElement = () => { const x = fakeCanvas(c.ops); x.id = 'cover'; return x; };
    try { app.drawCoachPosterArt(c, model(o), assets, { format, layout }); } finally { app.document.createElement = saved; }
    return c;
  };
  const noPhoto = { photo: null, icon: img('icon', 192, 192), body: img('body', 1152, 2520) };
  const CASES = [['photo', { specialty: 'Force' }], ['homme', { name: 'Camille Martin', silhouette: 'male', specialty: 'Force · Perte de poids' }],
    ['nom long', { name: 'Marie-Charlotte Delafontaine', specialty: 'Rééducation · Mobilité · Pilates' }], ['coach seul', { neutral: true }],
    ['sans photo', { hasPhoto: false }, noPhoto]];

  test('affiche du coach, style « Avec le bonhomme » : dessin inchangé au pixel près (empreinte de chaque opération, relevée sur main)', () => {
    // Empreinte SHA-256 de toutes les opérations du faux canvas (textes, polices, couleurs, positions, images) : relevée
    // avec coach-poster-art.js de main (7c92d663), avant l'ajout du style « Photo seule ». Relevée de nouveau le 26/11/2026
    // (branche retours-coach) : « coach » en blanc au lieu du rouge des muscles, consigne « Entre mon code… » agrandie
    // (juges du 26/11). Relevé du 27/11 (branche integration-retours) : en plus, orange des boutons (#CA4D10) et textes
    // en blanc sur l'aplat (option 2 de Maxence)
    const GOLD = {
      'story photo': 'd36f72c535801378', 'story homme': '8ca762c3d77993c3', 'story nom long': 'f43645a7d2e27ce4', 'story coach seul': 'b4a40e119025e53a', 'story sans photo': 'cfb875dd80432607',
      'square photo': '8e8755a205bec613', 'square homme': '49bdd0c724699dcc', 'square nom long': '53163ee8246aa96a', 'square coach seul': '62453453c1784080', 'square sans photo': 'aadc369b6574b409',
    };
    const got = {};
    for (const format of ['story', 'square']) for (const [n, o, a] of CASES) {
      got[`${format} ${n}`] = crypto.createHash('sha256').update(JSON.stringify(drawS(o, format, 'hero', a).ops)).digest('hex').slice(0, 16);
    }
    if (process.env.CPOSTER_GOLD) console.log(JSON.stringify(got));
    sameJSON(got, GOLD);
    const ui = read('js/features/coach-poster-ui.js'), data = read('js/data/coach-poster.js');
    assert.ok(/style: posterStyle\(prefs\?\.style\)/.test(ui), 'sans réglage gardé : hero');
    assert.match(app.coachPosterAlt(model()), /^Affiche « Nouvelle coach » : Léa Martin, sur MDLF Training, code K7M2-QX9P-R4TD$/, 'texte VoiceOver d\'avant');
    assert.ok(/CPOSTER_STYLES = \[\{ key: 'hero', label: 'Avec le bonhomme' \}, \{ key: 'photo', label: 'Photo seule' \}\]/.test(data), 'libellés du choix');
  });

  test('affiche du coach, style « Photo seule » : sans personnage ni Anton, photo en héros, orange seulement sur « Rejoins-moi », zone sûre', () => {
    for (const format of ['story', 'square']) {
      const H = format === 'square' ? 1080 : 1920;
      for (const [n, o, a] of CASES) {
        const c = drawS(o, format, 'photo', a), t = c.ops.filter(x => x.op === 'text'), tag = `${format} ${n}`;
        const m = model(o), size = x => parseFloat(x.font.match(/(\d+(?:\.\d+)?)px/)[1]);
        assert.ok(!c.ops.some(x => x.op === 'image' && x.id === 'body'), `${tag} : pas de personnage`);
        assert.ok(t.every(x => !/Anton/.test(x.font)), `${tag} : SF Pro partout, pas l'Anton`);
        assert.ok(t.every(x => ['#FFFFFF', '#98989F', '#A0A0A7'].includes(x.fill)), `${tag} : textes blancs (ou gris secondaire dans la carte, ${[...new Set(t.map(x => x.fill))]})`);
        assert.ok(!t.some(x => x.fill === '#CA4D10' || x.fill === '#FF7A1A'), `${tag} : aucun texte orange (27/11 : l'orange n'est qu'aux aplats)`);
        const ctaO = t.find(x => x.text === 'Rejoins-moi sur MDLF Training');
        assert.ok(ctaO && size(ctaO) <= 40, `${tag} : « Rejoins-moi » en petit (${ctaO && size(ctaO)} px)`);
        const fills = c.ops.filter(x => x.op === 'fill' || x.op === 'rect').map(x => x.fill);
        assert.ok(!fills.includes('#CA4D10') && !fills.includes('#FF453A'), `${tag} : aucun aplat orange ni rouge (${[...new Set(fills)]})`);
        assert.ok(t.every(x => x.fill !== '#000000'), `${tag} : aucun texte noir`);
        assert.ok(c.ctx.gradients === 0 && c.ctx.spacings.every(sp => sp === '0px'), `${tag} : aucun dégradé, lettres jamais espacées`);
        const title = t.find(x => /^(Nouveau coach|Nouvelle coach|Coach)$/.test(x.text));
        assert.ok(title && title.fill === '#FFFFFF', `${tag} : titre en blanc sur une ligne (${title?.text})`);
        assert.equal(title.text, m.title === 'COACH' ? 'Coach' : m.title.startsWith('NOUVELLE') ? 'Nouvelle coach' : 'Nouveau coach');
        const names = t.filter(x => m.name.split(' ').some(w => x.text.includes(w)) && x !== title && !/·/.test(x.text));
        assert.ok(names.length && names.every(x => size(x) > size(title)), `${tag} : nom plus gros que le titre`);
        if (m.specialty) assert.ok(t.some(x => x.text === m.specialty), `${tag} : spécialité`);
        assert.ok(t.some(x => x.text === 'K7M2-QX9P-R4TD'), `${tag} : le code`);
        const card = c.ops.find(x => x.op === 'rrect' && x.w > 800 && x.h <= 240);
        assert.ok(card && c.ops.some(x => x.op === 'image' && x.id === 'icon' && x.y > card.y && x.y < card.y + card.h), `${tag} : carte du code avec l'icône de l'app`);
        const photo = c.ops.find(x => x.op === 'image' && x.id === 'cover');
        if (a) {
          assert.ok(!photo && t.some(x => x.text === 'LM' && size(x) >= 170), `${tag} : sans photo, un grand rond aux initiales`);
        } else {
          // Photo en héros : nettement plus grande que le carré du rond « hero » (600 px au plus en story, 460 en carré)
          assert.ok(photo && photo.w * photo.h >= (format === 'story' ? 960 * 520 : 470 * 800) && photo.w * photo.h > 1.5 * (format === 'story' ? 600 : 460) ** 2, `${tag} : photo en héros (${photo?.w} × ${photo?.h})`);
          if (format === 'story') assert.ok(photo.y >= 250 && photo.y + photo.h <= 1670, `${tag} : photo dans la zone sûre`);
        }
        if (format === 'story') assert.ok(t.every(x => x.y - size(x) * 0.74 >= 249.5 && x.y + size(x) * 0.2 <= 1670.5) && card.y >= 250 && card.y + card.h <= 1670, `${tag} : tout dans la zone sûre d'Instagram (${t.map(x => `${x.text}@${Math.round(x.y - size(x) * 0.74)}-${Math.round(x.y + size(x) * 0.2)}`).join(' ')} carte ${Math.round(card.y)}+${card.h})`);
        assert.ok(t.every(x => x.y > 0 && x.y < H), `${tag} : rien hors de l'image`);
        // Rien sous la carte du code : chaque texte hors de la carte finit au-dessus d'elle (nom long, spécialité)
        const inCard = x => x.y > card.y && x.y < card.y + card.h;
        assert.ok(t.filter(x => !inCard(x)).every(x => x.y + size(x) * 0.2 <= card.y), `${tag} : aucun texte sous la carte du code`);
        if (photo) assert.ok(photo.y + photo.h <= card.y, `${tag} : la photo au-dessus de la carte`);
        // Rien ne déborde à droite ni à gauche (largeur du faux canvas : 0,5 × taille × caractères)
        for (const x of t) {
          const w = x.text.length * size(x) * 0.5, l = x.align === 'center' ? x.x - w / 2 : x.align === 'left' ? x.x : x.x - w;
          assert.ok(l >= 40 - 0.5 && l + w <= 1040 + 0.5, `${tag} : « ${x.text} » dans la largeur (${Math.round(l)} → ${Math.round(l + w)})`);
        }
      }
    }
    assert.match(app.coachPosterAlt(model(), 'photo'), /^Affiche « Nouvelle coach » sans le personnage, ta photo en grand : Léa Martin, sur MDLF Training, code K7M2-QX9P-R4TD$/, 'VoiceOver : photo seule');
    assert.match(app.coachPosterAlt(model({ hasPhoto: false }), 'photo'), /sans le personnage, tes initiales en grand : /, 'VoiceOver : initiales');
    // Réglage gardé avec les autres, par compte ; valeur inconnue : hero
    app.coachPosterSavePrefs('u1', { name: 'Léa', specialty: '', silhouette: 'female', neutral: false, style: 'photo' });
    assert.equal(app.coachPosterPrefs('u1').style, 'photo', 'style « Photo seule » gardé');
    app.coachPosterSavePrefs('u1', { name: 'Léa', specialty: '', silhouette: 'female', neutral: false, style: 'bizarre' });
    assert.equal(app.coachPosterPrefs('u1').style, 'hero', 'valeur inconnue : hero');
    // Contraste du blanc sur le noir (21:1) et du gris secondaire sur la carte, au moins 7:1 pour le texte principal
    const lum = h => { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(u => (u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    assert.ok(ratio('#FFFFFF', '#000000') >= 7 && ratio('#FFFFFF', '#1C1C1E') >= 7, 'blanc à 7:1 au moins sur le noir et sur la carte');
  });
}
