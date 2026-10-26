// Guide de l'app (js/data/guide.js) : contenus complets, identifiants uniques, et chaque libellé
// [entre crochets] ou action cité par un sujet existe vraiment dans l'app (un bouton renommé sans
// mise à jour du guide fait échouer ce test).
import fs from 'node:fs';
import path from 'node:path';

// Sources de l'app, sans le guide lui-même (sinon chaque libellé se trouverait dans sa propre phrase)
function appSources(ROOT) {
  const files = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p);
    else if (p.endsWith('.js') && !/[/\\]guide\.js$/.test(p)) files.push(p);
  });
  walk(path.join(ROOT, 'js'));
  // « l\'exercice » dans les chaînes entre apostrophes : comparé sans la barre oblique
  return [...files, path.join(ROOT, 'index.html')].map(f => fs.readFileSync(f, 'utf8')).join('\n').replace(/\\'/g, '\'');
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default function ({ test, run, assert, ROOT }) {
  const SRC = appSources(ROOT);

  test('guide : chaque sujet a un titre, une pastille et un contenu court', () => {
    const topics = run('GUIDE_TOPICS');
    const sections = run('GUIDE_SECTIONS');
    assert.ok(sections.length >= 6 && topics.length >= 25, `${sections.length} sections, ${topics.length} sujets`);
    sections.forEach(s => assert.ok(s.id && s.title && s.topics.length >= 2, `section ${s.id}`));
    const icons = new Set([...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/symbol id="i-([^"]+)"/g)].map(m => m[1]));
    topics.forEach(t => {
      assert.ok(typeof t.title === 'string' && t.title.length >= 4 && t.title.length <= 40, `${t.id} : titre`);
      assert.ok(typeof t.lead === 'string' && t.lead.length >= 20, `${t.id} : phrase d'introduction`);
      assert.ok(Array.isArray(t.steps) && t.steps.length >= 2 && t.steps.length <= 5, `${t.id} : ${t.steps?.length} étapes (2 à 5)`);
      [t.lead, ...t.steps].forEach(s => {
        assert.ok(s.length <= 220, `${t.id} : phrase trop longue « ${s} »`);
        assert.ok(/[.…!?»)]$/.test(s), `${t.id} : phrase sans point final « ${s} »`);
        assert.equal((s.match(/\[/g) || []).length, (s.match(/\]/g) || []).length, `${t.id} : crochets « ${s} »`);
      });
      assert.ok(icons.has(t.icon), `${t.id} : icône ${t.icon} absente du sprite`);
      assert.ok(['blue', 'green', 'orange', 'red', 'indigo', 'teal', 'purple'].includes(t.color), `${t.id} : couleur ${t.color}`);
    });
  });

  test('guide : identifiants uniques, liens « Voir aussi » valides', () => {
    const topics = run('GUIDE_TOPICS');
    const ids = topics.map(t => t.id);
    assert.equal(new Set(ids).size, ids.length, `doublons : ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
    ids.forEach(id => assert.ok(/^[a-z0-9-]+$/.test(id), `${id} : identifiant de route`));
    assert.equal(new Set(run('GUIDE_SECTIONS').map(s => s.id)).size, run('GUIDE_SECTIONS').length, 'sections uniques');
    topics.forEach(t => (t.related || []).forEach(r => {
      assert.ok(ids.includes(r), `${t.id} : sujet lié inconnu ${r}`);
      assert.notEqual(r, t.id, `${t.id} : lié à lui-même`);
    }));
  });

  test('guide : chaque libellé [cité] existe dans l\'app', () => {
    const missing = [];
    run('GUIDE_TOPICS').forEach(t => run(`guideLabels(guideTopic(${JSON.stringify(t.id)}))`).forEach(label => {
      // Texte d'un bouton, d'un titre ou d'une chaîne : entouré de guillemets, de balises ou d'espaces
      const re = new RegExp(`(^|['"\`>\\s(])${escRe(label)}(?=$|['"\`<\\s,.:…$(])`, 'm');
      if (!re.test(SRC)) missing.push(`${t.id} : [${label}]`);
    }));
    assert.equal(missing.length, 0, `libellés introuvables dans js/ et index.html :\n${missing.join('\n')}`);
  });

  test('guide : chaque action citée est enregistrée par l\'app', () => {
    const missing = [];
    run('GUIDE_TOPICS').forEach(t => (t.actions || []).forEach(a => {
      if (!new RegExp(`['"]${escRe(a)}['"]\\s*:`).test(SRC)) missing.push(`${t.id} : ${a}`);
    }));
    assert.equal(missing.length, 0, `actions absentes de registerActions :\n${missing.join('\n')}`);
    // Sujets clés : leur chemin principal est bien décrit
    const lab = id => run(`guideLabels(guideTopic(${JSON.stringify(id)}))`);
    assert.ok(lab('tempo').includes('Guidé au son') && lab('tempo').includes('Tempo'), 'tempo');
    assert.ok(lab('sante').includes('Apple Santé') && lab('musique').includes('Apple Music'), 'Santé et musique');
    assert.ok(lab('corbeille').includes('Supprimés récemment'), 'corbeille');
    assert.ok(lab('repos').includes('Repos par défaut'), 'repos');
  });

  test('guide : sujets réservés à l\'iPhone signalés', () => {
    const iphone = run('GUIDE_TOPICS.filter(t => t.iphone).map(t => t.id)');
    ['sante', 'musique', 'courses-sante', 'ecran-verrouille', 'icloud', 'compte'].forEach(id => assert.ok(iphone.includes(id), id));
  });

  test('guide : recherche sans accents, tous les mots requis', () => {
    const ids = q => run(`guideSearch(${JSON.stringify(q)}).map(t => t.id)`);
    assert.equal(ids('').length, run('GUIDE_TOPICS.length'), 'vide : tout');
    assert.ok(ids('tempo').includes('tempo'));
    assert.ok(ids('SANTE').includes('sante'), 'majuscules, sans accent');
    assert.ok(ids('velo rameur').includes('cardio'), 'plusieurs mots');
    assert.equal(ids('zzzz introuvable').length, 0);
    assert.equal(run('guidePlain("[Réglages] › [Unité]")'), 'Réglages › Unité');
  });
}
