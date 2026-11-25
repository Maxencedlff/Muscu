// Visite de l'accueil (js/data/tour.js) : état gardé sur l'appareil, étapes et leurs textes, place de la bulle face
// à l'élément découpé (dans l'écran, jamais sur le trou), défilement qui amène l'élément dans l'écran.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, app, assert, ROOT }) {
  const J = v => JSON.stringify(v);
  const steps = ctx => run(`tourSteps(${J(ctx)})`);
  const place = (target, view, bubble, pad, stops) => run(`tourPlace(${J(target)}, ${J(view)}, ${J(bubble)}, ${pad ?? 6}, ${J(stops || [])})`);
  const inside = (a, b) => a.top >= b.top - 0.5 && a.left >= b.left - 0.5 && a.top + a.height <= b.top + b.height + 0.5 && a.left + a.width <= b.left + b.width + 0.5;
  const apart = (a, b) => a.top + a.height <= b.top || b.top + b.height <= a.top || a.left + a.width <= b.left || b.left + b.width <= a.left;
  const SE = { width: 320, height: 568, top: 20, bottom: 0 };
  const PRO_MAX = { width: 440, height: 956, top: 62, bottom: 34 };
  const IPAD = { width: 1024, height: 1366, top: 24, bottom: 20 };

  test('visite : à faire après les questions, jamais remontrée une fois vue', () => {
    assert.equal(run('(() => { const d = {}; tourMarkDue(d); return d.tour; })()'), 'due');
    assert.equal(run('(() => { const d = { tour: "seen" }; tourMarkDue(d); return d.tour; })()'), 'seen');
    assert.equal(run('tourIsDue({ tour: "due" })'), true);
    assert.equal(run('tourIsDue({})'), false, 'utilisateur d\'avant la visite : rien');
    assert.equal(run('tourIsDue({ tour: "seen" })'), false);
  });

  test('visite : gardée sur l\'appareil, jamais envoyée au compte ; valeur inconnue retirée', () => {
    assert.ok(run('SYNC_LOCAL_ONLY').includes('tour'));
    const base = run('data');
    assert.equal(app.sanitizeData({ ...base, tour: 'seen' }).tour, 'seen');
    assert.equal(app.sanitizeData({ ...base, tour: 'due' }).tour, 'due');
    assert.equal(app.sanitizeData({ ...base, tour: '<img>' }).tour, undefined);
    assert.equal(app.sanitizeData({ ...base, tour: true }).tour, undefined);
  });

  test('visite : 4 étapes, 5 avec un coach ; titres = libellés de l\'écran', () => {
    assert.equal(J(steps({}).map(s => s.title)), J(['Démarrer', 'Au programme', 'Programme', 'Progrès']));
    assert.equal(J(steps({ beat: true }).map(s => s.title)), J(['Démarrer', 'À battre aujourd\'hui', 'Programme', 'Progrès']));
    // Coach au féminin (myCoachWord, js/data/coach-form.js) : remplacé le temps du test
    run("globalThis.__mcw = myCoachWord; myCoachWord = k => ({ Mon: 'Ma coach', ton: 'ta coach' })[k]");
    const st = steps({ coach: 'student' });
    run('myCoachWord = globalThis.__mcw');
    assert.equal(st.length, 5);
    assert.equal(st[4].title, 'Social');
    assert.ok(st[4].text.includes('« Ma coach »') && st[4].text.endsWith('de ta coach.'), st[4].text);
    assert.ok(!/\bson coach|\bil\b/.test(st[4].text), 'accordé au coach');
    assert.equal(steps({ coach: 'coach' })[4].title, 'Coach');
    assert.equal(steps({ live: true })[0].title, 'Reprendre', 'séance en cours : le bouton affiché');
    // Libellés vérifiés dans le code de l'écran (un renommage fait échouer ce test)
    const src = ['js/features/dashboard.js', 'js/ui/router.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n').replace(/\\'/g, '\'');
    for (const t of ['Démarrer', 'Reprendre', 'Au programme', 'À battre aujourd\'hui', 'Programme', 'Progrès', 'Social']) assert.ok(src.includes(t), t);
    // Sélecteurs : barre d'onglets (fixe, sans défilement) ou carte de la prochaine séance
    steps({ coach: 'student' }).forEach(s => assert.equal(!!s.fixed, s.sel.startsWith('.tabbar'), s.id));
  });

  test('visite : textes courts et sobres, au tutoiement, sans emoji ni point d\'exclamation', () => {
    const all = [...steps({}), ...steps({ live: true }), ...steps({ beat: true }), ...steps({ coach: 'student' }), ...steps({ coach: 'coach' })];
    for (const s of all) {
      assert.ok(s.text.length <= 110, `${s.id} : ${s.text.length} signes`);
      assert.ok(s.text.endsWith('.') && !/[!]/.test(s.text), s.text);
      assert.ok(!/\b(vous|votre|vos)\b/i.test(s.text), `tutoiement : ${s.text}`);
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s.text + s.title), `emoji : ${s.text}`);
      assert.ok(!/ - | – | — /.test(s.text), `pas de tiret : ${s.text}`);
    }
    assert.equal(run('tourCountLabel(1, 5)'), 'Étape 2 sur 5');
  });

  test('visite : bulle sous un élément du haut, au-dessus d\'un onglet, toujours dans l\'écran', () => {
    for (const view of [SE, PRO_MAX, IPAD]) {
      const V = { top: view.top, left: 0, width: view.width, height: view.height - view.top - view.bottom };
      const bub = { width: Math.min(360, view.width - 24), height: 190 };
      const btn = { top: 200, left: 20, width: view.width - 40, height: 54 };
      const p = place(btn, view, bub);
      assert.equal(p.side, 'below');
      const b = { top: p.top, left: p.left, width: p.width, height: bub.height };
      assert.ok(inside(b, V) && apart(b, p.hole), `${view.width} : bulle dans l'écran, hors du trou`);
      assert.ok(inside({ top: btn.top, left: btn.left, width: btn.width, height: btn.height }, p.hole), 'trou autour du bouton');
      assert.equal(p.maxHeight, null);
      // Onglet en bas (« Programme ») : bulle au-dessus, flèche face à l'onglet, hors des coins
      const tab = { top: view.height - view.bottom - 49, left: view.width * 0.6, width: view.width * 0.2, height: 49 };
      const q = place(tab, view, bub);
      assert.equal(q.side, 'above');
      const qb = { top: q.top, left: q.left, width: q.width, height: bub.height };
      assert.ok(inside(qb, V) && apart(qb, q.hole), `${view.width} : bulle au-dessus de l'onglet`);
      const tip = q.left + q.arrowX, mid = tab.left + tab.width / 2;
      assert.ok(Math.abs(tip - mid) < 1 || q.arrowX === q.width - 22, `flèche face à l'onglet (${tip} / ${mid})`);
      assert.ok(q.arrowX >= 22 && q.arrowX <= q.width - 22);
    }
  });

  test('visite : élément très haut rogné entre deux lignes, bulle entière', () => {
    const list = { top: 80, left: 16, width: 288, height: 460 };
    const rows = [150, 200, 250, 300, 350, 400, 450, 500, 540];
    const p = place(list, SE, { width: 296, height: 220 }, 6, rows);
    assert.equal(p.side, 'below');
    assert.ok(rows.map(y => y + 6).includes(p.hole.bottom), `rogné sous une ligne (${p.hole.bottom})`);
    assert.ok(p.top + 220 <= SE.height && p.top >= p.hole.bottom, 'bulle sous le trou, dans l\'écran');
    assert.equal(p.maxHeight, null);
  });

  test('visite : texte agrandi, bulle trop haute pour un petit élément : elle défile, l\'élément reste entier', () => {
    const btn = { top: 100, left: 20, width: 280, height: 60 };
    const p = place(btn, SE, { width: 296, height: 700 });
    assert.equal(p.side, 'below');
    assert.ok(p.maxHeight > 100 && p.top + p.maxHeight <= SE.height, `hauteur plafonnée (${p.maxHeight})`);
    assert.equal(p.hole.height, 72, 'trou entier');
  });

  test('visite : défilement seulement si l\'élément ou la bulle sort de l\'écran', () => {
    const view = { width: 390, height: 844, top: 100, bottom: 83 };
    assert.equal(run(`tourScrollTarget(${J({ top: 300, height: 54 })}, ${J(view)}, 200, 0, 2000)`), null, 'déjà visible');
    assert.equal(run(`tourScrollTarget(${J({ top: 900, height: 54 })}, ${J(view)}, 200, 50, 2000)`), 50 + 900 - 100 - 8, 'sous l\'écran : remonté sous la barre');
    assert.equal(run(`tourScrollTarget(${J({ top: 900, height: 54 })}, ${J(view)}, 200, 50, 300)`), 300, 'borné à la fin de la page');
    assert.equal(run(`tourScrollTarget(${J({ top: 40, height: 54 })}, ${J(view)}, 200, 0, 2000)`), null, 'déjà en haut : rien à défiler');
  });
}
