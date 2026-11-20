// ═══════════════════════════════════════════════════════════
//  Affiche du coach (js/data/coach-poster.js, js/features/coach-poster-art.js) : contenu exact, initiales, accord
//  « Nouveau / Nouvelle », story et carré, zones sûres d'Instagram, rien d'un élève, photo d'origine réduite à 2048 px.
//  Dessin vérifié sur un faux canvas qui note chaque texte et chaque image. Le parcours réel (coach sans photo, photo
//  mise, affiche partagée ; élève sans l'entrée) est dans tests/test_affiche_coach.py.
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

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
    beginPath() {}, closePath() {}, arc() {}, rect() {}, roundRect() {}, moveTo() {}, lineTo() {}, stroke() {}, arcTo() {},
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
      badge: 'Carte pro déclarée', ctaLine: 'Télécharge MDLF Training et entre mon code', code: 'K7M2-QX9P-R4TD',
    });
    // Rien d'autre que ce qui vient du coach : aucun champ pour un élève
    sameJSON(Object.keys(model()).sort(), ['badge', 'code', 'ctaLine', 'handle', 'initials', 'name', 'photo', 'specialty', 'title']);
    assert.equal(model({ specialty: '  Force ·   Perte de poids ' }).specialty, 'Force · Perte de poids', 'spécialité nettoyée');
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
    assert.match(app.coachPosterAlt(model()), /^Affiche « Nouvelle coach » : Léa Martin, @lea\.coach, sur MDLF Training, Carte pro déclarée, code K7M2-QX9P-R4TD$/);
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
      // Story : badge sur la ligne du pseudo (5e panel), « Sur MDLF Training » effacé s'il ne tient pas avec lui
      const handle = format === 'story' ? (t.includes('@lea.coach · Sur MDLF Training') ? '@lea.coach · Sur MDLF Training' : '@lea.coach') : '@lea.coach · Sur MDLF Training';
      for (const w of [sil === 'female' ? 'NOUVELLE' : 'NOUVEAU', 'COACH', 'LÉA MARTIN', handle, 'Carte pro déclarée',
        'K7M2-QX9P-R4TD', 'MDLF Training']) {
        assert.ok(t.includes(w), `${tag} : « ${w} » écrit (${JSON.stringify(t)})`);
      }
      // Consigne sur une ligne, ou sur deux en story (coupée avant « et ») pour rester lisible
      assert.ok(t.includes('Télécharge MDLF Training et entre mon code') || (t.includes('Télécharge MDLF Training') && t.includes('et entre mon code')), `${tag} : consigne écrite`);
      // Capitales seulement pour les gros titres en Anton (titre, nom, code) ; tout le reste en casse normale
      for (const o of c.ops.filter(x => x.op === 'text' && !/Anton/.test(x.font))) {
        assert.ok(!/[A-ZÀ-Ý]{3}/.test(o.text.replace(/MDLF/g, '')), `${tag} : « ${o.text} » en capitales hors titre`);
      }
      assert.ok(!t.some(x => x.endsWith('…')), `${tag} : aucun texte tronqué`);
      if (format === 'story') {
        // Tout le texte entre 250 et 1650 px (barres d'Instagram en haut, champ de réponse en bas)
        for (const o of c.ops.filter(x => x.op === 'text')) {
          assert.ok(o.y > 250 && o.y <= 1600, `${tag} : « ${o.text} » à y = ${Math.round(o.y)}, dans une zone couverte (250 à 1600 px)`);
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
      const oranges = fills.filter(f => ['#A85400', '#FF7A1A', '#A04E00', '#FF8A3D'].includes(f));
      assert.deepEqual(oranges, ['#FF7A1A'], `${format} : un seul orange (${fills})`);
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
    for (const v of ['#FF7A1A', 'rgba(235,235,245', '#1C1C1E']) assert.ok(css.includes(v), `${v} repris des feuilles de style de l'app`);
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
      assert.ok(photo && photo.w >= (format === 'story' ? 560 : 1080 * 0.46) - 0.5, `${format} : photo de ${photo && Math.round(photo.w)} px`);
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
      assert.ok(Math.max(...ys) <= 1600 && Math.min(...ys) > 250, `tout entre 250 et 1600 px (${Math.round(Math.min(...ys))} à ${Math.round(Math.max(...ys))})`);
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
      assert.ok(t.includes('MARIE-CHARLOTTE DELAFONTAINE'), `${format} : nom entier sur une ligne, réduit ${JSON.stringify(t)}`);
      assert.ok(t.includes('@marie.charlotte.coach · Sur MDLF Training') || (format === 'story' && t.includes('@marie.charlotte.coach')), `${format} : pseudo long entier`);
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
    sameJSON(app.coachPosterPrefs('u1'), { name: 'Léa', specialty: 'Force', silhouette: 'female', neutral: true });
    app.coachPosterSavePrefs('u1', { name: '', silhouette: 'x' });
    sameJSON(app.coachPosterPrefs('u1'), { name: '', specialty: '', silhouette: 'male', neutral: false }, 'valeur inconnue ramenée');
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
    assert.ok(ui.includes('tes élèves voient ce nom dans Mon coach'), 'dit au coach');
    assert.ok(read('js/features/share.js').includes("if (result !== 'failed') { st.onShared?.(result);"), 'onShared seulement après un partage réel');
    assert.ok(read('js/features/coach-ui.js').includes('coachPosterNameOf(p.user_id)'), 'Mon coach lit le nom');
    assert.equal(run('posterName(" Léa \\u0007  Martin ")'), 'Léa Martin');
  });
}
