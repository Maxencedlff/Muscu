// Vidéos d'exercices des coachs (js/data/exercise-videos.js, procédure : docs/VIDEOS_EXERCICES.md)
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, assert, ROOT }) {
  const clean = m => run(`[...cleanVideoManifest(${JSON.stringify(m)})]`);
  const entry = (o = {}) => ({ src: 'squat.mp4', poster: 'squat.jpg', duration: 18.4, coach: 'coach.test', width: 1280, height: 720, ...o });
  const BASE = 'https://exemple.supabase.co/storage/v1/object/public/exercise-videos/';

  test('vidéos : manifeste valide, base https, alias ramené au nom de la bibliothèque', () => {
    const out = clean({ version: 1, base: BASE, videos: { 'Squat barre': entry(), 'Pull-ups': entry({ src: 'tractions.mp4', coach: '@autre_coach', width: 720, height: 1280 }) } });
    assert.equal(out.length, 2);
    const [name, v] = out[0];
    assert.equal(name, 'Squat barre');
    assert.equal(v.src, BASE + 'squat.mp4');
    assert.equal(v.poster, BASE + 'squat.jpg');
    assert.equal(v.duration, 18);
    assert.equal(v.coach, 'coach.test');
    const [alias, t] = out[1];
    assert.equal(alias, run('catalogueEntry("Pull-ups").name'), 'alias → nom de la bibliothèque');
    assert.equal(t.coach, 'autre_coach', '« @ » retiré du pseudo');
    assert.equal(t.height, 1280);
  });

  test('vidéos : entrées refusées une à une (adresse, format, crédit, durée, exercice inconnu)', () => {
    const bad = [
      entry({ src: 'http://exemple.com/squat.mp4' }), entry({ src: 'javascript:alert(1)//.mp4' }),
      entry({ src: 'data:video/mp4;base64,AAAA.mp4' }), entry({ src: '//exemple.com/squat.mp4' }),
      entry({ src: 'squat.mov' }), entry({ poster: 'squat.gif' }), entry({ src: 'squat" onerror="x.mp4' }),
      entry({ coach: '' }), entry({ coach: 'nom avec espaces' }), entry({ coach: '<b>x</b>' }),
      entry({ duration: 0 }), entry({ duration: 900 }), entry({ duration: 'abc' }), null, 'squat.mp4',
    ];
    bad.forEach((v, i) => assert.equal(clean({ version: 1, base: '', videos: { 'Squat barre': v } }).length, 0, `entrée ${i} refusée`));
    assert.equal(clean({ version: 1, videos: { 'Mon exercice inventé': entry() } }).length, 0, 'exercice hors bibliothèque');
    // Une entrée invalide n'emporte pas les autres
    assert.equal(clean({ version: 1, videos: { 'Squat barre': entry({ coach: '' }), 'Pull-ups': entry() } }).length, 1);
    // Base http ou douteuse : tout le manifeste est refusé (jamais d'adresses locales muettes)
    assert.equal(clean({ version: 1, base: 'http://exemple.com/', videos: { 'Squat barre': entry() } }).length, 0);
    assert.equal(clean({ version: 1, base: 42, videos: { 'Squat barre': entry() } }).length, 0);
    // Durée : 60 s au plus, comme scripts/prepare-exercise-video.py
    assert.equal(clean({ version: 1, base: BASE, videos: { 'Squat barre': entry({ duration: 61 }) } }).length, 0);
    // Taille absente ou absurde : 16/9 par défaut
    const [, v] = clean({ version: 1, videos: { 'Squat barre': entry({ width: 'x', height: 99999 }) } })[0];
    assert.equal(`${v.width}x${v.height}`, '1280x720');
  });

  test('vidéos : manifeste vide, absent ou d\'une autre version → aucune vidéo', () => {
    [null, undefined, 42, 'texte', [], {}, { version: 2, videos: { 'Squat barre': entry() } }, { version: 1 }, { version: 1, videos: [] }]
      .forEach(m => assert.equal(clean(m ?? null).length, 0, JSON.stringify(m)));
    run('exerciseVideos = new Map()');
    assert.equal(run('exerciseVideo("Squat barre")'), null);
    run(`exerciseVideos = cleanVideoManifest(${JSON.stringify({ version: 1, videos: { 'Squat barre': entry() } })})`);
    assert.equal(run('exerciseVideo("Squat barre")?.coach'), 'coach.test');
    assert.equal(run('exerciseVideo("Mon exercice inventé")'), null);
    run('exerciseVideos = new Map()');
  });

  test('vidéos : lecture automatique coupée sur données cellulaires, économie de données, animations réduites', () => {
    const ok = (nav, reduced = false) => run(`videoAutoplayAllowed(${JSON.stringify(nav)}, ${reduced})`);
    assert.equal(ok({}), true, 'Safari / app iOS : rien de détectable');
    assert.equal(ok({ connection: { type: 'wifi', effectiveType: '4g' } }), true);
    assert.equal(ok({ connection: { type: 'cellular' } }), false);
    assert.equal(ok({ connection: { saveData: true } }), false);
    assert.equal(ok({ connection: { effectiveType: '2g' } }), false);
    assert.equal(ok({}, true), false, 'réduire les animations');
  });

  test('vidéos : manifeste du dépôt lisible, chaque clé est un exercice de la bibliothèque', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'exercise-videos.json'), 'utf8'));
    assert.equal(raw.version, 1);
    const keys = Object.keys(raw.videos);
    assert.equal(clean(raw).length, keys.length, 'aucune entrée refusée par cleanVideoManifest');
    keys.forEach(k => assert.equal(run(`catalogueEntry(${JSON.stringify(k)})?.name`), k, `${k} : nom exact de la bibliothèque`));
    assert.ok(!raw.base || raw.base.startsWith('https://'), 'base en https');
  });
}
