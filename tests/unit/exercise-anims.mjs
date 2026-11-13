// Animations 3D du « Comment faire » (js/data/exercise-anims.js, lecteur js/ui/exercise-video.js, cache sw.js)
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, assert, ROOT }) {
  const NAMES = ['Squat barre', 'Développé couché barre', 'Soulevé de terre', 'Tractions pronation', 'Curl biceps haltères'];
  const anim = n => run(`exerciseAnim(${JSON.stringify(n)})`);

  test('animations 3D : 5 exercices pilotes, noms exacts de la bibliothèque, alias ramenés', () => {
    const keys = run('Object.keys(EXERCISE_ANIMS)');
    assert.deepEqual([...keys].sort(), [...NAMES].sort());
    keys.forEach(k => assert.equal(run(`catalogueEntry(${JSON.stringify(k)})?.name`), k, `${k} : nom de la bibliothèque`));
    assert.equal(anim('deadlift').poster, 'img/anim/souleve-de-terre.webp', 'alias anglais');
    assert.equal(anim('Curl marteau'), null, 'exercice sans animation');
    assert.equal(anim(''), null);
    assert.equal(anim('constructor'), null, 'pas de clé héritée de Object');
  });

  test('animations 3D : H.264 puis VP9, affiche WebP, carré 720', () => {
    const a = anim('Squat barre');
    assert.deepEqual([...a.sources.map(s => s.src)], ['img/anim/squat-barre.mp4', 'img/anim/squat-barre.webm']);
    assert.match(a.sources[0].type, /^video\/mp4; codecs="avc1\./);
    assert.match(a.sources[1].type, /^video\/webm; codecs="vp9"/);
    assert.equal(a.width, 720);
    assert.equal(a.height, 720);
  });

  test('animations 3D : fichiers présents, légers (< 600 Ko), affiches dans le cache de la version', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const assets = sw.slice(sw.indexOf('const ASSETS'), sw.indexOf('];', sw.indexOf('const ASSETS')));
    const re = new RegExp(sw.match(/const ANIM_RE = \/(.+)\/;/)[1]);
    for (const n of NAMES) {
      const a = anim(n);
      for (const f of [...a.sources.map(s => s.src), a.poster]) {
        const p = path.join(ROOT, f);
        assert.ok(fs.existsSync(p), `${f} présent`);
        assert.ok(fs.statSync(p).size < 600 * 1024, `${f} : moins de 600 Ko`);
      }
      assert.ok(assets.includes(`'/${a.poster}'`), `${a.poster} dans ASSETS`);
      a.sources.forEach(s => {
        assert.ok(re.test('/' + s.src), `${s.src} : mis en cache par le service worker`);
        assert.ok(!assets.includes(s.src), `${s.src} : pas téléchargé à l'installation`);
      });
    }
  });

  test('animations 3D : repli du lecteur seulement sans vidéo de coach', () => {
    const html = run('exerciseVideoHtml("Squat barre")');
    assert.match(html, /class="exvideo exvideo--3d"/);
    assert.match(html, /data-local="1"/);
    assert.match(html, /playsinline muted loop preload="none"/);
    assert.match(html, /poster="img\/anim\/squat-barre\.webp"/);
    assert.match(html, /aria-label="Animation 3D de l&#39;exercice Squat barre"|aria-label="Animation 3D de l'exercice Squat barre"/);
    assert.equal(run('exerciseVideoHtml("Curl marteau")'), '', 'ni vidéo ni animation : rien');
    // Vidéo d'un coach pour le même exercice : elle passe devant l'animation
    run(`exerciseVideos = cleanVideoManifest({ version: 1, base: 'https://exemple.test/', videos: { 'Squat barre':
      { src: 'squat.mp4', poster: 'squat.jpg', duration: 8, coach: 'coach.test' } } })`);
    const coach = run('exerciseVideoHtml("Squat barre")');
    assert.ok(!coach.includes('exvideo--3d') && coach.includes('@coach.test'), 'vidéo du coach prioritaire');
    run('exerciseVideos = new Map()');
  });

  test('animations 3D : choix du fichier lisible (canPlayType)', () => {
    const pick = types => run(`exvideoSource({ dataset: { src: 'a.mp4', sources: ${JSON.stringify(JSON.stringify(
      [{ src: 'a.mp4', type: 'video/mp4' }, { src: 'a.webm', type: 'video/webm' }]))} },
      canPlayType: t => (${JSON.stringify(types)}.some(x => t.startsWith(x)) ? 'maybe' : '') })`);
    assert.equal(pick(['video/mp4', 'video/webm']), 'a.mp4', 'H.264 d\'abord');
    assert.equal(pick(['video/webm']), 'a.webm', 'Chromium sans H.264 : VP9');
    assert.equal(pick([]), 'a.mp4', 'rien de reconnu : premier fichier');
  });
}
