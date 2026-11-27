'use strict';

// Pont vers la lecture d'un programme d'entraînement par l'iPhone, sans réseau ni service payant (IOS.md, « Import
// d'un programme ») : texte d'une photo, d'une capture, d'une feuille numérisée ou d'un PDF scanné (MdlfPlanReader,
// ios/App/App/PlanReaderPlugin.swift, Apple Vision) et dictée en français reconnue sur l'appareil (MdlfPlanDictation,
// ios/App/App/PlanDictationPlugin.swift). Le texte rendu est analysé par js/data/plan-parser.js ; ce fichier ne fait
// que transporter et nettoyer.
//
// Aucune fonction ne lève d'exception. Chacune répond { ok: true, … } ou { ok: false, reason, message } ; message est
// une phrase prête à afficher. reason :
//   'web'         navigateur : « Disponible dans l'app iPhone »
//   'unsupported' app Android (pas encore de module)
//   'outdated'    app iPhone d'avant ces modules (une mise à jour à chaud peut arriver avant la build)
//   'canceled' | 'denied' | 'unavailable' | 'busy' | 'invalid' | 'locked' | 'offline' | 'failed'
//
// Lecture : pick(source, { limit, customWords }), readImage({ path | base64 }), readPdfScan({ path | base64, maxPages }),
// readFile(file) (fichier d'un <input type="file"> : image ou PDF) → { ok, pages, … } ; page = { width, height, text,
// lines: [{ text, confidence, box: { x, y, w, h }, words: [{ text, box }] }] }, boîtes de 0 à 1, origine en haut à gauche.
// Dictée : dictation.status(), dictation.authorize(), dictation.start({ contextualStrings, allowServer, onPartial,
// onFinal, onError }), dictation.stop() → { ok, text, segments }, dictation.cancel().

const PlanReader = (() => {
  const cap = window.Capacitor;
  const ios = Native.isNative && Native.platform === 'ios';
  const has = name => ios && !!cap?.isPluginAvailable?.(name);
  const hasReader = has('MdlfPlanReader');
  const hasDictation = has('MdlfPlanDictation');
  const Reader = hasReader ? cap.registerPlugin('MdlfPlanReader') : null;
  const Dictation = hasDictation ? cap.registerPlugin('MdlfPlanDictation') : null;

  const SOURCES = ['photos', 'camera', 'scan'];
  const MAX_WORDS = 300, MAX_WORD = 60;
  const MAX_FILE = 40 * 1024 * 1024;   // même borne que PlanReaderPlugin.swift (maxInputBytes)
  const OFFLINE = 'Dictée hors ligne indisponible sur cet appareil';   // texte exact du module Swift
  const MESSAGES = {
    web: "Disponible dans l'app iPhone",
    unsupported: 'Pas encore disponible sur ce téléphone',
    outdated: "Mets l'app à jour pour utiliser cette fonction",
    canceled: '',
    denied: "Accès refusé : autorise-le dans Réglages › MDLF Training",
    unavailable: 'Indisponible sur cet appareil',
    busy: 'Une lecture est déjà en cours',
    invalid: 'Fichier illisible',
    locked: 'Ce PDF est protégé par un mot de passe',
    offline: OFFLINE,
    failed: 'La lecture a échoué, réessaie',
  };
  const CODES = { CANCELED: 'canceled', DENIED: 'denied', UNAVAILABLE: 'unavailable', BUSY: 'busy', INVALID: 'invalid',
    LOCKED: 'locked', OFFLINE_UNAVAILABLE: 'offline', UNIMPLEMENTED: 'outdated' };

  const fail = reason => ({ ok: false, reason, message: MESSAGES[reason] });
  const fromError = e => fail(CODES[e?.code] || 'failed');
  // Hors de l'app iPhone avec le module : la raison à montrer
  const absent = () => fail(!Native.isNative ? 'web' : Native.platform === 'android' ? 'unsupported' : 'outdated');

  // Vocabulaire (noms et alias d'exercices) : chaînes non vides, 60 caractères, sans doublon, 300 au plus
  function vocabulary(list) {
    const out = [], seen = new Set();
    for (const v of Array.isArray(list) ? list : []) {
      if (typeof v !== 'string') continue;
      const w = v.trim();
      if (!w || w.length > MAX_WORD || seen.has(w.toLowerCase())) continue;
      seen.add(w.toLowerCase());
      out.push(w);
      if (out.length === MAX_WORDS) break;
    }
    return out;
  }

  const unit = v => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  const cleanBox = b => {
    const x = unit(b?.x), y = unit(b?.y);
    return { x, y, w: Math.min(unit(b?.w), 1 - x), h: Math.min(unit(b?.h), 1 - y) };
  };
  const text = v => (typeof v === 'string' ? v.slice(0, 2000) : '');
  // Page rendue par le module : forme vérifiée (le moteur d'analyse ne reçoit jamais une valeur d'un autre type)
  function cleanPage(p) {
    const lines = (Array.isArray(p?.lines) ? p.lines : []).map(l => ({
      text: text(l?.text).trim(),
      confidence: unit(l?.confidence),
      box: cleanBox(l?.box),
      words: (Array.isArray(l?.words) ? l.words : []).map(w => ({ text: text(w?.text), box: cleanBox(w?.box) })).filter(w => w.text),
    })).filter(l => l.text);
    const size = v => (Number.isInteger(v) && v > 0 ? v : 0);
    return { width: size(p?.width), height: size(p?.height), text: lines.map(l => l.text).join('\n'), lines };
  }
  const cleanPages = r => (Array.isArray(r?.pages) ? r.pages : []).map(cleanPage);

  // Entrée d'un fichier : chemin ou base64, jamais les deux
  function input(o) {
    if (typeof o?.base64 === 'string' && o.base64) return { base64: o.base64 };
    if (typeof o?.path === 'string' && o.path) return { path: o.path };
    return null;
  }

  async function sources() {
    if (!hasReader) return { photos: false, camera: false, scan: false };
    try {
      const r = await Reader.sources();
      return { photos: r?.photos === true, camera: r?.camera === true, scan: r?.scan === true };
    } catch { return { photos: false, camera: false, scan: false }; }
  }

  async function pick(source, { limit = 5, customWords = [] } = {}) {
    if (!hasReader) return absent();
    if (!SOURCES.includes(source)) return fail('invalid');
    const n = Math.min(10, Math.max(1, Math.round(Number(limit)) || 1));
    try {
      const r = await Reader.pick({ source, limit: n, customWords: vocabulary(customWords) });
      const pages = cleanPages(r);
      return pages.length ? { ok: true, source, pages } : fail('failed');
    } catch (e) { return fromError(e); }
  }

  async function readImage(o = {}) {
    if (!hasReader) return absent();
    const src = input(o);
    if (!src) return fail('invalid');
    try {
      const pages = cleanPages(await Reader.readImage({ ...src, customWords: vocabulary(o.customWords) }));
      return pages.length ? { ok: true, pages } : fail('failed');
    } catch (e) { return fromError(e); }
  }

  async function readPdfScan(o = {}) {
    if (!hasReader) return absent();
    const src = input(o);
    if (!src) return fail('invalid');
    const maxPages = Math.min(50, Math.max(1, Math.round(Number(o.maxPages)) || 20));
    try {
      const r = await Reader.readPdfScan({ ...src, maxPages, customWords: vocabulary(o.customWords) });
      const pages = cleanPages(r);
      if (!pages.length) return fail('failed');
      return { ok: true, pages, pageCount: Number.isInteger(r?.pageCount) ? r.pageCount : pages.length,
        truncated: r?.truncated === true, hasTextLayer: r?.hasTextLayer === true };
    } catch (e) { return fromError(e); }
  }

  // Fichier choisi par un <input type="file"> (image ou PDF), envoyé en base64 au module
  async function readFile(file, opts = {}) {
    if (!hasReader) return absent();
    if (!file || typeof file.size !== 'number' || file.size <= 0 || file.size > MAX_FILE) return fail('invalid');
    const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (!pdf && !/^image\//.test(file.type || '')) return fail('invalid');
    let base64;
    try { base64 = await toBase64(file); } catch { return fail('invalid'); }
    return pdf ? readPdfScan({ ...opts, base64 }) : readImage({ ...opts, base64 });
  }

  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => { const s = String(reader.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // ── Dictée ──
  // Une seule dictée à la fois ; ses écouteurs sont retirés dès qu'elle finit (texte final, erreur ou annulation)
  let listening = null;   // { handles, onFinal, onError }

  const cleanSegments = list => (Array.isArray(list) ? list : []).map(s => ({
    text: text(s?.text), confidence: unit(s?.confidence),
    timestamp: Number.isFinite(s?.timestamp) ? Math.max(0, s.timestamp) : 0, duration: Number.isFinite(s?.duration) ? Math.max(0, s.duration) : 0,
  })).filter(s => s.text);

  function release() {
    const l = listening;
    listening = null;
    for (const h of l?.handles || []) Promise.resolve(h).then(x => x?.remove?.()).catch(() => {});
    return l;
  }
  const safe = (fn, v) => { try { fn?.(v); } catch { /* l'écran qui écoute gère son propre état */ } };

  const dictation = {
    get available() { return hasDictation; },
    async status() {
      const none = { available: false, onDevice: false, speech: 'notDetermined', microphone: 'notDetermined' };
      if (!hasDictation) return none;
      try { return cleanStatus(await Dictation.status()); } catch { return none; }
    },
    async authorize() {
      if (!hasDictation) return absent();
      try { return { ok: true, ...cleanStatus(await Dictation.authorize()) }; } catch (e) { return fromError(e); }
    },
    // allowServer : seulement true quand l'utilisateur a accepté, dans l'app, la dictée par les serveurs d'Apple
    async start({ contextualStrings = [], allowServer = false, onPartial, onFinal, onError } = {}) {
      if (!hasDictation) return absent();
      if (listening) return fail('busy');
      const l = { handles: [], onFinal, onError };
      listening = l;
      l.handles.push(Dictation.addListener('partial', d => { if (listening === l) safe(onPartial, text(d?.text)); }));
      l.handles.push(Dictation.addListener('final', d => {
        if (listening !== l) return;
        release();
        safe(onFinal, { text: text(d?.text), segments: cleanSegments(d?.segments), onDevice: d?.onDevice === true });
      }));
      l.handles.push(Dictation.addListener('error', d => {
        if (listening !== l) return;
        release();
        safe(onError, fail(CODES[d?.code] || 'failed'));
      }));
      try {
        const r = await Dictation.start({ contextualStrings: vocabulary(contextualStrings), allowServer: allowServer === true });
        return { ok: true, onDevice: r?.onDevice === true };
      } catch (e) {
        if (listening === l) release();
        return fromError(e);
      }
    },
    async stop() {
      if (!hasDictation) return absent();
      try {
        const r = await Dictation.stop();
        return { ok: true, text: text(r?.text), segments: cleanSegments(r?.segments), onDevice: r?.onDevice === true };
      } catch (e) { return fromError(e); }
    },
    async cancel() {
      if (!hasDictation) return absent();
      release();
      try { await Dictation.cancel(); return { ok: true }; } catch (e) { return fromError(e); }
    },
  };

  const STATUS = ['authorized', 'denied', 'restricted', 'notDetermined'];
  function cleanStatus(r) {
    const s = v => (STATUS.includes(v) ? v : 'notDetermined');
    return { available: r?.available === true, onDevice: r?.onDevice === true, speech: s(r?.speech), microphone: s(r?.microphone) };
  }

  return {
    get available() { return hasReader; },
    sources, pick, readImage, readPdfScan, readFile, dictation, vocabulary,
    OFFLINE_MESSAGE: OFFLINE,
  };
})();
