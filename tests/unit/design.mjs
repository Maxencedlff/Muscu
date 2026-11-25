// Réglages › Apparence › Design (js/data/design.js) : choix daté de la couleur d'accent, nettoyage, fusion de la synchro
// (le plus récent gagne, un appareil resté sur une version d'avant ne l'efface pas), hors de l'empreinte « modifié ici »,
// et jetons de couleur des feuilles de style (contrastes mesurés, jamais de texte noir sur l'aplat orange)
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const css = f => fs.readFileSync(path.join(ROOT, 'css', f), 'utf8');

  test('design : absent = Orange ; nettoyage (accent connu, date positive)', () => {
    reset();
    assert.equal(run('designAccent(data)'), 'orange');
    run('data.design = { accent: "bleu", at: 1764000000000.4 }; sanitizeData(data)');
    sameJSON(run('data.design'), { accent: 'bleu', at: 1764000000000 });
    assert.equal(run('designAccent(data)'), 'bleu');
    for (const bad of ['"bleu"', '{ accent: "vert", at: 5 }', '{ accent: "bleu" }', '{ accent: "bleu", at: -1 }', '[1]']) {
      run(`data.design = ${bad}; sanitizeData(data)`);
      assert.equal(run('data.design'), undefined, `refusé : ${bad}`);
      assert.equal(run('designAccent(data)'), 'orange');
    }
  });

  test('design : fusion, le choix le plus récent gagne ; à égalité, l\'orange', () => {
    sameJSON(run('mergeDesign({ accent: "bleu", at: 5 }, { accent: "orange", at: 9 })'), { accent: 'orange', at: 9 });
    sameJSON(run('mergeDesign({ accent: "orange", at: 9 }, { accent: "bleu", at: 5 })'), { accent: 'orange', at: 9 });
    sameJSON(run('mergeDesign({ accent: "bleu", at: 7 }, { accent: "orange", at: 7 })'), { accent: 'orange', at: 7 });
    sameJSON(run('mergeDesign({ accent: "orange", at: 7 }, { accent: "bleu", at: 7 })'), { accent: 'orange', at: 7 });
    sameJSON(run('mergeDesign(undefined, { accent: "bleu", at: 3 })'), { accent: 'bleu', at: 3 });
    assert.equal(run('mergeDesign(undefined, "x")'), undefined);
  });

  test('design : synchro, sur le compte, hors de l\'empreinte « modifié ici », jamais effacé par une version d\'avant', () => {
    reset();
    assert.ok(run(`SYNC_PROFILE_KEYS.includes('design') && SYNC_CHOICE_KEYS.includes('design') && !SYNC_ABSENT_IS_CHOICE.includes('design')`));
    run(`data.history = [{ id: 'h1', date: 1, programme: 'ppl', category: 'push', exercises: [] }]; data.design = { accent: 'bleu', at: 1000 }; sanitizeData(data)`);
    assert.equal(run('profilePayload(data).design.accent'), 'bleu', 'part sur le compte');
    assert.equal(run('profileCoreHash(profilePayload(data)) === profileCoreHash({ ...profilePayload(data), design: { accent: "orange", at: 2000 } })'), true,
      'changer de couleur ne fait pas gagner cet appareil sur le reste du profil');
    // Appareil resté sur une version d'avant : profil sans la clé, il ne l'efface pas
    run(`__meta = emptySyncMeta('u'); __meta.profileHash = syncHash(profilePayload(data)); __meta.profileCore = profileCoreHash(profilePayload(data))`);
    run(`__old = JSON.parse(JSON.stringify(profilePayload(data))); delete __old.design; __old.weeklyGoal = 4`);
    run(`applyRemoteProfile(data, { doc: __old, updated_at: '2026-11-25T10:00:00Z' }, __meta)`);
    assert.equal(run('designAccent(data)'), 'bleu', 'toujours bleu');
    assert.equal(run('data.weeklyGoal'), 4, 'le reste du profil reçu s\'applique');
    // Choix plus récent ailleurs : il gagne ; plus ancien : ignoré (dans les deux branches de applyRemoteProfile)
    run(`__new = { ...profilePayload(data), design: { accent: 'orange', at: 3000 } }`);
    run(`applyRemoteProfile(data, { doc: __new, updated_at: '2026-11-25T11:00:00Z' }, __meta)`);
    assert.equal(run('designAccent(data)'), 'orange');
    run(`data.design = { accent: 'bleu', at: 5000 }; data.unit = 'lbs'`);   // modifié ici : branche de fusion
    run(`__older = { ...profilePayload(data), unit: 'kg', design: { accent: 'orange', at: 4000 } }`);
    run(`__meta.profileHash = 'autre'; __meta.profileCore = 'autre'`);
    run(`applyRemoteProfile(data, { doc: __older, updated_at: '2026-11-25T12:00:00Z' }, __meta)`);
    assert.equal(run('designAccent(data)'), 'bleu', 'choix plus ancien du compte ignoré');
  });

  test('design : image du récap, aplat d\'accent à texte blanc (orange brique ou bleu), jamais de noir sur l\'orange', () => {
    sameJSON(run('recapToneColors("accent", false)'), { bg: '#B8460F', fg: '#FFFFFF', heat: '#000000', box: '#000000', boxText: '#FFFFFF' });
    assert.equal(run('recapToneColors("accent", true).bg'), '#B8460F');
    assert.equal(run('recapToneColors("accent", false, "bleu").bg'), '#0A6CDB');
    assert.equal(run('recapToneColors("accent", true, "bleu").bg'), '#0066CC');
    assert.equal(run('recapToneColors("night", false, "bleu").bg'), '#000000', 'le noir reste noir');
  });

  test('design : jetons des feuilles de style (contrastes WCAG mesurés)', () => {
    const L = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const block = (src, sel) => { const m = src.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); assert.ok(m, sel); return m[1]; };
    const tok = (b, name) => { const m = b.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`)); return m && m[1].toUpperCase(); };
    const s = css('theme-sobre.css');
    const dark = block(s, ':root'), light = block(s, 'body.light'), bleu = block(s, 'body.design-bleu'), bleuL = block(s, 'body.light.design-bleu');
    const W = '#FFFFFF', K = '#000000', CELL = '#1C1C1E';
    // Orange (défaut) : bouton brique à texte blanc dans les deux thèmes
    assert.equal(tok(dark, '--tint-fill'), '#B8460F'); assert.equal(tok(dark, '--on-tint'), W);
    assert.equal(tok(light, '--tint-fill'), '#B8460F'); assert.equal(tok(light, '--on-tint'), W);
    assert.ok(cr(W, '#B8460F') >= 4.5, 'texte blanc sur le bouton');
    assert.ok(cr('#B8460F', CELL) >= 3, 'bouton visible sur la cellule (contour non textuel)');
    // Liens d'action reconnaissables : orange, 4,5:1 au moins sur le noir et sur les cartes
    const link = tok(dark, '--tint');
    assert.ok(cr(link, K) >= 4.5 && cr(link, CELL) >= 4.5 && cr(link, '#2C2C2E') >= 4.5, `liens ${link}`);
    assert.ok(cr(tok(light, '--tint'), W) >= 4.5 && cr(tok(light, '--tint'), '#F2F2F7') >= 4.5);
    // Bleu : texte blanc sur l'aplat, liens lisibles
    assert.ok(cr(W, tok(bleu, '--tint-fill')) >= 4.5 && cr(W, tok(bleuL, '--tint-fill')) >= 4.5);
    assert.ok(cr(tok(bleu, '--tint'), K) >= 4.5 && cr(tok(bleu, '--tint'), CELL) >= 4.5 && cr(tok(bleuL, '--tint'), W) >= 4.5);
    // Plus jamais de texte noir sur un aplat d'accent, ni l'orange vif en aplat
    assert.ok(!/--on-tint:\s*#000/i.test(s) && !/--tint-fill:\s*#FF7A1A/i.test(s));
    const r = css('recap.css');
    assert.ok(!/--rc-on-accent:\s*#000/i.test(r) && /--rc-accent:\s*#B8460F/.test(r));
    // Jetons tirés de --tint redéclarés sur body : ils suivent le design « Bleu » posé sur body
    assert.match(s, /:root, body \{ --sb-ring: var\(--tint\);[^}]*--tab-on: var\(--label\); \}/);
  });
}
