// Lecture et dictée d'un programme sur l'iPhone (js/platform/plan-reader.js, PlanReader) : repli hors de l'app,
// nettoyage de ce que rendent les modules, codes de rejet, dictée sans bascule silencieuse vers les serveurs, et
// contrat avec le vrai Swift (ios/App/App/PlanReaderPlugin.swift, PlanDictationPlugin.swift) et le faux module des
// tests E2E (tests/fake_plan_reader.py). Le Swift n'est pas compilé ici (ios.yml le compile).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export default function ({ test, assert, sameJSON, ROOT }) {
  const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const bridgeSrc = read('js/platform/native.js') + '\n' + read('js/platform/plan-reader.js') + '\nthis.PlanReader = PlanReader;';
  const err = code => Object.assign(new Error(code), { code });

  // Coquille simulée : seuls les deux modules de l'import répondent ; registered liste les modules joints
  function load({ native = true, platform = 'ios', available = ['MdlfPlanReader', 'MdlfPlanDictation'], reader = {}, dictation = {} } = {}) {
    const calls = [], registered = [], listeners = {};
    const record = (mod, impl) => new Proxy({}, {
      get: (_, m) => {
        if (m === 'addListener') return (ev, fn) => { (listeners[ev] ||= []).push(fn); return Promise.resolve({ remove: () => { listeners[ev] = listeners[ev].filter(f => f !== fn); } }); };
        return async o => { calls.push([mod, m, o]); return impl[m] ? impl[m](o) : {}; };
      },
    });
    const mods = { MdlfPlanReader: record('reader', reader), MdlfPlanDictation: record('dictation', dictation) };
    class FileReader {
      readAsDataURL(blob) { setTimeout(() => { if (blob.broken) { this.error = new Error('x'); this.onerror(); } else { this.result = `data:${blob.type};base64,QUJD`; this.onload(); } }, 0); }
    }
    const box = {
      console, setTimeout, clearTimeout, FileReader, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      navigator: { userAgent: 'test' },
      Capacitor: native ? {
        isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: n => available.includes(n),
        registerPlugin: n => { registered.push(n); return mods[n] || new Proxy({}, { get: () => async () => ({}) }); },
      } : undefined,
    };
    box.window = box;
    const c = vm.createContext(box);
    vm.runInContext(bridgeSrc, c);
    const emit = (ev, d) => (listeners[ev] || []).slice().forEach(fn => fn(d));
    return { PR: c.PlanReader, calls, registered, emit, listeners };
  }
  const plain = v => JSON.parse(JSON.stringify(v));

  test('plan-reader : navigateur → « Disponible dans l\'app iPhone », sans module joint', async () => {
    const { PR, registered } = load({ native: false });
    assert.equal(PR.available, false);
    assert.equal(PR.dictation.available, false);
    for (const r of [await PR.pick('scan'), await PR.readImage({ base64: 'QUJD' }), await PR.readPdfScan({ path: '/x.pdf' }),
      await PR.dictation.start(), await PR.dictation.stop(), await PR.readFile({ size: 3, type: 'image/png' })]) {
      sameJSON(r, { ok: false, reason: 'web', message: "Disponible dans l'app iPhone" });
    }
    sameJSON(await PR.sources(), { photos: false, camera: false, scan: false });
    sameJSON(await PR.dictation.status(), { available: false, onDevice: false, speech: 'notDetermined', microphone: 'notDetermined' });
    assert.ok(!registered.some(n => n.startsWith('MdlfPlan')));
  });

  test('plan-reader : Android → pas encore, sans parler d\'iPhone ; iPhone d\'avant les modules → mise à jour', async () => {
    const android = load({ platform: 'android' });
    const r = await android.PR.pick('photos');
    assert.equal(r.reason, 'unsupported');
    assert.doesNotMatch(r.message, /iPhone|Apple/);
    assert.ok(!android.registered.some(n => n.startsWith('MdlfPlan')), 'jamais joint sur Android');
    const old = load({ available: [] });
    sameJSON(await old.PR.dictation.start(), { ok: false, reason: 'outdated', message: "Mets l'app à jour pour utiliser cette fonction" });
    assert.equal(old.calls.length, 0);
  });

  test('plan-reader : pick transmet la source, la limite et le vocabulaire nettoyés ; pages vérifiées', async () => {
    const page = { width: 100, height: 200, text: 'ignoré', lines: [
      { text: ' Squat 5x5 ', confidence: 0.8, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.05 }, words: [{ text: 'Squat', box: { x: 0.1, y: 0.2, w: 0.2, h: 0.05 } }, { text: '', box: {} }] },
      { text: 'Hors cadre', confidence: 7, box: { x: -1, y: 0.9, w: 3, h: 'x' } },
      { text: 42 }, null,
    ] };
    const { PR, calls } = load({ reader: { pick: o => ({ source: o.source, pages: [page, 'pas une page'] }) } });
    const words = ['Squat', 'squat', '  Développé couché ', '', 3, 'x'.repeat(61), ...Array.from({ length: 400 }, (_, i) => `Exo ${i}`)];
    const r = await PR.pick('scan', { limit: 99, customWords: words });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'scan');
    const [, , o] = calls[0];
    assert.equal(o.source, 'scan');
    assert.equal(o.limit, 10, 'limite bornée à 10');
    assert.equal(o.customWords.length, 300);
    sameJSON(o.customWords.slice(0, 3), ['Squat', 'Développé couché', 'Exo 0']);
    sameJSON(plain(r.pages[0]), { width: 100, height: 200, text: 'Squat 5x5\nHors cadre', lines: [
      { text: 'Squat 5x5', confidence: 0.8, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.05 }, words: [{ text: 'Squat', box: { x: 0.1, y: 0.2, w: 0.2, h: 0.05 } }] },
      { text: 'Hors cadre', confidence: 1, box: { x: 0, y: 0.9, w: 1, h: 0 }, words: [] },
    ] });
    sameJSON(plain(r.pages[1]), { width: 0, height: 0, text: '', lines: [] });
  });

  test('plan-reader : codes de rejet du Swift traduits, source inconnue refusée sans appel', async () => {
    const codes = { CANCELED: 'canceled', DENIED: 'denied', UNAVAILABLE: 'unavailable', BUSY: 'busy', INVALID: 'invalid',
      LOCKED: 'locked', UNIMPLEMENTED: 'outdated', AUTRE: 'failed' };
    for (const [code, reason] of Object.entries(codes)) {
      const { PR } = load({ reader: { pick: () => { throw err(code); }, readPdfScan: () => { throw err(code); } } });
      assert.equal((await PR.pick('camera')).reason, reason, code);
      assert.equal((await PR.readPdfScan({ base64: 'QUJD' })).reason, reason, code);
    }
    const { PR, calls } = load();
    assert.equal((await PR.pick('fichiers')).reason, 'invalid');
    assert.equal((await PR.readImage({})).reason, 'invalid', 'ni chemin ni base64');
    assert.equal(calls.length, 0);
    // Réponse vide : jamais « ok » sans page
    assert.equal((await PR.pick('photos')).reason, 'failed');
  });

  test('plan-reader : PDF scanné (pages bornées, champs du module) et fichier d\'un <input type="file">', async () => {
    const page = { width: 10, height: 10, lines: [{ text: 'A', confidence: 1, box: { x: 0, y: 0, w: 1, h: 1 } }] };
    const { PR, calls } = load({ reader: {
      readPdfScan: () => ({ pages: [page, page], pageCount: 60, truncated: true, hasTextLayer: 'oui' }),
      readImage: () => ({ pages: [page] }),
    } });
    const r = await PR.readPdfScan({ path: '/var/mobile/x.pdf', base64: '', maxPages: 500 });
    assert.equal(r.ok, true);
    sameJSON([r.pages.length, r.pageCount, r.truncated, r.hasTextLayer], [2, 60, true, false]);
    sameJSON(plain(calls[0][2]), { path: '/var/mobile/x.pdf', maxPages: 50, customWords: [] });
    // readFile : PDF → readPdfScan, image → readImage, en base64 sans l'en-tête data:
    assert.equal((await PR.readFile({ size: 3, type: 'application/pdf', name: 'prog.pdf' })).ok, true);
    assert.equal((await PR.readFile({ size: 3, type: '', name: 'PROG.PDF' })).ok, true);
    assert.equal((await PR.readFile({ size: 3, type: 'image/heic', name: 'a.heic' })).ok, true);
    sameJSON(calls.slice(1).map(c => [c[1], c[2].base64]), [['readPdfScan', 'QUJD'], ['readPdfScan', 'QUJD'], ['readImage', 'QUJD']]);
    for (const f of [null, { size: 0, type: 'image/png' }, { size: 41 * 1024 * 1024, type: 'image/png' }, { size: 3, type: 'text/plain' }, { size: 3, type: 'image/png', broken: true }]) {
      assert.equal((await PR.readFile(f)).reason, 'invalid', JSON.stringify(f));
    }
  });

  test('plan-reader : dictée hors ligne ou refus clair, serveurs seulement avec allowServer === true', async () => {
    const message = 'Dictée hors ligne indisponible sur cet appareil';
    const { PR, calls } = load({ dictation: { start: o => { if (o.allowServer !== true) throw err('OFFLINE_UNAVAILABLE'); return { started: true, onDevice: false }; } } });
    sameJSON(await PR.dictation.start({ contextualStrings: ['Squat', 'Squat'] }), { ok: false, reason: 'offline', message });
    sameJSON(await PR.dictation.start({ allowServer: 'oui' }), { ok: false, reason: 'offline', message });
    sameJSON(plain(calls.map(c => c[2].allowServer)), [false, false]);
    sameJSON(plain(calls[0][2].contextualStrings), ['Squat']);
    sameJSON(await PR.dictation.start({ allowServer: true }), { ok: true, onDevice: false });
    assert.equal(PR.OFFLINE_MESSAGE, message);
  });

  test('plan-reader : dictée, partiels puis texte final, écouteurs retirés, une seule à la fois', async () => {
    const { PR, emit, listeners } = load({ dictation: {
      start: () => ({ started: true, onDevice: true }),
      stop: () => ({ text: 'Squat 5 séries de 5', segments: [{ text: 'Squat', confidence: 0.9, timestamp: 0, duration: 0.4 }, { text: '' }], onDevice: true }),
    } });
    const partials = [], finals = [];
    const r = await PR.dictation.start({ onPartial: t => partials.push(t), onFinal: f => finals.push(f), onError: () => assert.fail('pas d\'erreur') });
    sameJSON(r, { ok: true, onDevice: true });
    assert.equal((await PR.dictation.start()).reason, 'busy', 'deuxième dictée refusée');
    emit('partial', { text: 'Squat' });
    emit('partial', { text: 42 });
    emit('final', { text: 'Squat 5 séries de 5', segments: [{ text: 'Squat', confidence: 2, timestamp: -1, duration: 0.4 }], onDevice: true });
    sameJSON(partials, ['Squat', '']);
    sameJSON(plain(finals), [{ text: 'Squat 5 séries de 5', segments: [{ text: 'Squat', confidence: 1, timestamp: 0, duration: 0.4 }], onDevice: true }]);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(Object.values(listeners).flat().length, 0, 'écouteurs retirés après le texte final');
    emit('partial', { text: 'tard' });
    assert.equal(partials.length, 2, 'rien après la fin');
    const s = await PR.dictation.stop();
    sameJSON(plain(s), { ok: true, text: 'Squat 5 séries de 5', segments: [{ text: 'Squat', confidence: 0.9, timestamp: 0, duration: 0.4 }], onDevice: true });
    // Erreur du module : onError, puis une nouvelle dictée est possible
    const errors = [];
    assert.equal((await PR.dictation.start({ onError: e => errors.push(e) })).ok, true);
    emit('error', { code: 'FAILED', message: 'x' });
    assert.equal(errors[0].reason, 'failed');
    assert.equal((await PR.dictation.start()).ok, true);
    assert.equal((await PR.dictation.cancel()).ok, true);
    assert.equal((await PR.dictation.start()).ok, true, 'annulée : libre');
  });

  test('plan-reader : statut et autorisations nettoyés, rejet du micro', async () => {
    const { PR } = load({ dictation: {
      status: () => ({ available: true, onDevice: true, locale: 'fr-FR', speech: 'authorized', microphone: 'bizarre' }),
      authorize: () => ({ available: true, onDevice: false, speech: 'denied', microphone: 'denied' }),
      start: () => { throw err('DENIED'); },
    } });
    sameJSON(await PR.dictation.status(), { available: true, onDevice: true, speech: 'authorized', microphone: 'notDetermined' });
    sameJSON(await PR.dictation.authorize(), { ok: true, available: true, onDevice: false, speech: 'denied', microphone: 'denied' });
    assert.equal((await PR.dictation.start()).reason, 'denied');
    assert.equal((await PR.dictation.start()).reason, 'denied', 'écouteurs libérés après un rejet');
  });

  // ── Contrat avec le Swift et le faux module des tests E2E ──
  const swift = f => read(`ios/App/App/${f}`);
  const methods = src => [...src.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map(m => m[1]);
  const bridge = read('js/platform/plan-reader.js');
  const fake = read('tests/fake_plan_reader.py');

  test('plan-reader : contrat de MdlfPlanReader (méthodes, Vision, sources, entrées)', () => {
    const src = swift('PlanReaderPlugin.swift');
    assert.match(src, /jsName = "MdlfPlanReader"/);
    sameJSON(methods(src), ['sources', 'pick', 'readImage', 'readPdfScan']);
    for (const m of methods(src)) {
      assert.match(bridge, new RegExp(`Reader\\.${m}\\(`), `le pont appelle ${m}`);
      assert.match(fake, new RegExp(`\\b${m}: async`), `faux module E2E : ${m}`);
    }
    // Vision : mode précis (imprimé et manuscrit), français et anglais, correction linguistique, vocabulaire
    assert.match(src, /recognitionLevel = \.accurate/);
    assert.match(src, /usesLanguageCorrection = true/);
    assert.match(src, /\["fr-FR", "en-US"\]/);
    assert.match(src, /request\.customWords = customWords/);
    assert.match(src, /boundingBox\(for: range\)/, 'boîtes des mots');
    assert.match(src, /1 - r\.maxY/, 'origine ramenée en haut à gauche');
    // Les trois sources d'images et le PDF rendu page par page
    for (const k of ['PHPickerViewController', 'UIImagePickerController()', 'VNDocumentCameraViewController()', 'page.thumbnail(of:']) assert.ok(src.includes(k), k);
    for (const s of ['photos', 'camera', 'scan']) assert.ok(src.includes(`"${s}"`) && bridge.includes(`'${s}'`), s);
    // Codes de rejet : chacun connu du pont
    const codes = [...new Set([...src.matchAll(/call\.reject\([^)]*"([A-Z_]+)"\)/g)].map(m => m[1]))].sort();
    sameJSON(codes, ['BUSY', 'CANCELED', 'DENIED', 'FAILED', 'INVALID', 'LOCKED', 'UNAVAILABLE']);
    for (const c of codes.filter(c => c !== 'FAILED')) assert.match(bridge, new RegExp(`\\b${c}: '`), `pont : ${c}`);
    // Chemins limités au conteneur de l'app, bornes identiques des deux côtés
    assert.match(src, /hasPrefix\(home \+ "\/"\)/);
    assert.match(src, /maxInputBytes = 40 \* 1024 \* 1024/);
    assert.match(bridge, /MAX_FILE = 40 \* 1024 \* 1024/);
    assert.doesNotMatch(src, /attributesOfItem|URLSession|http/, 'ni API à motif déclaré ni réseau');
    // Clés rendues = clés lues par le pont
    for (const k of ['"pages"', '"pageCount"', '"truncated"', '"hasTextLayer"', '"width"', '"height"', '"lines"', '"words"', '"confidence"', '"box"']) assert.ok(src.includes(k), k);
  });

  test('plan-reader : contrat de MdlfPlanDictation (hors ligne d\'abord, jamais de bascule silencieuse)', () => {
    const src = swift('PlanDictationPlugin.swift');
    assert.match(src, /jsName = "MdlfPlanDictation"/);
    sameJSON(methods(src), ['status', 'authorize', 'start', 'stop', 'cancel']);
    for (const m of methods(src)) {
      assert.match(bridge, new RegExp(`Dictation\\.${m}\\(`), `le pont appelle ${m}`);
      assert.match(fake, new RegExp(`\\b${m}: async`), `faux module E2E : ${m}`);
    }
    assert.match(src, /SFSpeechRecognizer\(locale: Locale\(identifier: PlanDictationPlugin\.locale\)\)/);
    assert.match(src, /static let locale = "fr-FR"/);
    assert.match(src, /let allowServer = call\.getBool\("allowServer"\) == true/, 'serveurs : seulement un true explicite');
    assert.match(src, /guard local \|\| allowServer else \{ call\.reject\(PlanDictationPlugin\.offlineMessage, "OFFLINE_UNAVAILABLE"\)/);
    assert.match(src, /let local = recognizer\.supportsOnDeviceRecognition/);
    assert.match(src, /request\.requiresOnDeviceRecognition = local/);
    assert.equal((src.match(/requiresOnDeviceRecognition = /g) || []).length, 1, 'une seule affectation');
    assert.match(src, /request\.contextualStrings = phrases/);
    // Même message des deux côtés (le faux module aussi)
    const msg = src.match(/offlineMessage = "([^"]+)"/)[1];
    assert.equal(msg, 'Dictée hors ligne indisponible sur cet appareil');
    assert.ok(bridge.includes(`'${msg}'`) && fake.includes(`'${msg}'`));
    for (const ev of ['partial', 'final', 'error']) {
      assert.match(src, new RegExp(`notifyListeners\\("${ev}"`), `événement ${ev}`);
      assert.ok(bridge.includes(`addListener('${ev}'`), `pont : ${ev}`);
    }
    // Session audio rendue (sons de fin de repos) et micro fermé à chaque fin
    assert.match(src, /savedAudio = \(session\.category, session\.mode, session\.categoryOptions\)/);
    assert.match(src, /removeTap\(onBus: 0\)/);
  });

  test('plan-reader : Info.plist, manifeste, projet Xcode et chargement de la page', () => {
    const plist = read('ios/App/App/Info.plist');
    const purpose = k => (plist.match(new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`)) || [])[1] || '';
    assert.match(purpose('NSMicrophoneUsageDescription'), /dictes ton programme[^]*sur ton iPhone[^]*ni enregistrée ni envoyée/);
    const speech = purpose('NSSpeechRecognitionUsageDescription');
    assert.match(speech, /sur ton iPhone, hors ligne/);
    assert.match(speech, /ton accord avant d'utiliser le service de dictée d'Apple/, 'le repli en ligne est dit, et soumis à accord');
    assert.match(purpose('NSCameraUsageDescription'), /numériser un programme d'entraînement[^]*lu directement sur ton iPhone/);
    // Rien de collecté : aucune donnée de plus dans le manifeste de confidentialité
    assert.doesNotMatch(read('ios/App/App/PrivacyInfo.xcprivacy'), /AudioData|NSPrivacyCollectedDataTypeAudio/);
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    const main = swift('MainViewController.swift');
    for (const [file, cls] of [['PlanReaderPlugin.swift', 'PlanReaderPlugin'], ['PlanDictationPlugin.swift', 'PlanDictationPlugin']]) {
      assert.equal(pbx.split(`/* ${file} in Sources */`).length - 1, 2, `${file} : PBXBuildFile et phase Sources`);
      assert.equal(pbx.split(`/* ${file} */`).length - 1, 3, `${file} : PBXBuildFile, PBXFileReference et groupe App`);
      assert.match(main, new RegExp(`registerPluginInstance\\(${cls}\\(\\)\\)`));
    }
    const html = read('index.html');
    assert.ok(html.indexOf('js/platform/native.js') < html.indexOf('js/platform/plan-reader.js'), 'chargé après native.js');
    assert.ok(read('sw.js').includes("'/js/platform/plan-reader.js'"));
  });
}
