"""Modules natifs de lecture et de dictée d'un programme simulés (ios/App/App/PlanReaderPlugin.swift et
PlanDictationPlugin.swift), pour tester l'import d'un programme sans iPhone.

FAKE_PLAN_READER est injecté par page.add_init_script, APRÈS une éventuelle coquille factice (tests/fake_account.py,
ou celle d'un test) : il l'enveloppe au lieu de la remplacer. Sans coquille, il en pose une, iOS, où les autres
modules répondent {} sans rien faire.

Mêmes noms de méthodes, mêmes clés de réponse et mêmes codes de rejet que le Swift (vérifié par
tests/unit/plan-reader.mjs, qui lit les deux fichiers) :
- MdlfPlanReader : sources() → { photos, camera, scan } ; pick({ source, limit, customWords }) → { source, pages } ;
  readImage({ path | base64, customWords }) → { pages } ; readPdfScan({ path | base64, maxPages, customWords }) →
  { pages, pageCount, truncated, hasTextLayer }. Rejets CANCELED, DENIED, UNAVAILABLE, BUSY, INVALID, LOCKED, FAILED.
- MdlfPlanDictation : status(), authorize() → { available, onDevice, locale, speech, microphone } ; start({
  contextualStrings, allowServer, … }) → { started, onDevice } ; stop() → { text, segments, onDevice } ; cancel() ;
  événements partial { text }, final { text, segments, onDevice }, error { code, message }. Rejet OFFLINE_UNAVAILABLE
  (« Dictée hors ligne indisponible sur cet appareil ») si l'appareil ne sait pas reconnaître hors ligne et que
  allowServer n'est pas true.

Réglages dans window.__pr (à poser avant l'appel) :
  __pr.pages          pages rendues par la prochaine lecture (défaut : une page d'exemple, PAGE ci-dessous)
  __pr.error          code de rejet de la prochaine lecture ('CANCELED', 'DENIED'…), remis à null après usage
  __pr.sources        réponse de sources()
  __pr.dictation      { onDevice, speech, microphone, partials: [...], final } : start() émet les partiels un par
                      un (toutes les 20 ms), stop() émet final
  __pr.calls          [module, méthode, options] de chaque appel
  __pr.noModules      true : coquille d'avant ces modules (isPluginAvailable faux)
"""
import json

# Tableau imprimé type : une ligne de titre puis deux exercices en colonnes (boîtes de 0 à 1, origine en haut à gauche)
PAGE = {
    'width': 2480, 'height': 3508,
    'text': 'Séance A\nDéveloppé couché 4 x 8 90s\nRowing barre 3 x 10 60s',
    'lines': [
        {'text': 'Séance A', 'confidence': 1.0, 'box': {'x': 0.1, 'y': 0.05, 'w': 0.2, 'h': 0.03},
         'words': [{'text': 'Séance', 'box': {'x': 0.1, 'y': 0.05, 'w': 0.12, 'h': 0.03}},
                   {'text': 'A', 'box': {'x': 0.23, 'y': 0.05, 'w': 0.02, 'h': 0.03}}]},
        {'text': 'Développé couché 4 x 8 90s', 'confidence': 0.95, 'box': {'x': 0.1, 'y': 0.12, 'w': 0.7, 'h': 0.03},
         'words': [{'text': 'Développé', 'box': {'x': 0.1, 'y': 0.12, 'w': 0.18, 'h': 0.03}},
                   {'text': 'couché', 'box': {'x': 0.3, 'y': 0.12, 'w': 0.12, 'h': 0.03}},
                   {'text': '4', 'box': {'x': 0.5, 'y': 0.12, 'w': 0.02, 'h': 0.03}},
                   {'text': 'x', 'box': {'x': 0.53, 'y': 0.12, 'w': 0.02, 'h': 0.03}},
                   {'text': '8', 'box': {'x': 0.56, 'y': 0.12, 'w': 0.02, 'h': 0.03}},
                   {'text': '90s', 'box': {'x': 0.72, 'y': 0.12, 'w': 0.06, 'h': 0.03}}]},
        {'text': 'Rowing barre 3 x 10 60s', 'confidence': 0.9, 'box': {'x': 0.1, 'y': 0.17, 'w': 0.7, 'h': 0.03},
         'words': [{'text': 'Rowing', 'box': {'x': 0.1, 'y': 0.17, 'w': 0.12, 'h': 0.03}},
                   {'text': 'barre', 'box': {'x': 0.23, 'y': 0.17, 'w': 0.1, 'h': 0.03}},
                   {'text': '3', 'box': {'x': 0.5, 'y': 0.17, 'w': 0.02, 'h': 0.03}},
                   {'text': 'x', 'box': {'x': 0.53, 'y': 0.17, 'w': 0.02, 'h': 0.03}},
                   {'text': '10', 'box': {'x': 0.56, 'y': 0.17, 'w': 0.04, 'h': 0.03}},
                   {'text': '60s', 'box': {'x': 0.72, 'y': 0.17, 'w': 0.06, 'h': 0.03}}]},
    ],
}

FAKE_PLAN_READER = """
(() => {
  const pr = window.__pr = Object.assign({
    pages: [%(page)s], error: null, sources: { photos: true, camera: true, scan: true },
    dictation: { onDevice: true, speech: 'authorized', microphone: 'authorized',
                 partials: ['Développé', 'Développé couché'], final: 'Développé couché 4 séries de 8' },
    calls: [], noModules: false,
  }, window.__pr || {});
  const err = (code, message) => { const e = new Error(message || code); e.code = code; return e; };
  const take = () => { const c = pr.error; pr.error = null; if (c) throw err(c); };
  const copy = v => JSON.parse(JSON.stringify(v));
  const reader = {
    sources: async () => { pr.calls.push(['reader', 'sources', {}]); return copy(pr.sources); },
    pick: async o => { pr.calls.push(['reader', 'pick', o]); take(); return { source: o.source, pages: copy(pr.pages) }; },
    readImage: async o => { pr.calls.push(['reader', 'readImage', o]); take(); return { pages: copy(pr.pages).slice(0, 1) }; },
    readPdfScan: async o => { pr.calls.push(['reader', 'readPdfScan', o]); take();
      const pages = copy(pr.pages).slice(0, o.maxPages || 20);
      return { pages, pageCount: pr.pages.length, truncated: pr.pages.length > pages.length, hasTextLayer: false }; },
  };
  const listeners = { partial: [], final: [], error: [] };
  const emit = (ev, d) => listeners[ev].slice().forEach(fn => fn(d));
  let running = false, timers = [];
  const d = () => pr.dictation;
  const status = () => ({ available: true, onDevice: !!d().onDevice, locale: 'fr-FR', speech: d().speech, microphone: d().microphone });
  const finalPayload = () => ({ text: d().final, onDevice: !!d().onDevice,
    segments: d().final.split(' ').map((t, i) => ({ text: t, confidence: 0.9, timestamp: i * 0.4, duration: 0.3 })) });
  const dictation = {
    addListener: (ev, fn) => { listeners[ev].push(fn);
      return Promise.resolve({ remove: () => { listeners[ev] = listeners[ev].filter(f => f !== fn); } }); },
    status: async () => { pr.calls.push(['dictation', 'status', {}]); return status(); },
    authorize: async () => { pr.calls.push(['dictation', 'authorize', {}]); return status(); },
    start: async o => {
      pr.calls.push(['dictation', 'start', o]);
      if (running) throw err('BUSY');
      if (!d().onDevice && o.allowServer !== true) throw err('OFFLINE_UNAVAILABLE', 'Dictée hors ligne indisponible sur cet appareil');
      if (d().speech !== 'authorized' || d().microphone !== 'authorized') throw err('DENIED');
      running = true;
      timers = d().partials.map((t, i) => setTimeout(() => running && emit('partial', { text: t }), 20 * (i + 1)));
      return { started: true, onDevice: !!d().onDevice };
    },
    stop: async () => {
      pr.calls.push(['dictation', 'stop', {}]);
      if (!running) return { text: '', segments: [], onDevice: !!d().onDevice };
      running = false; timers.forEach(clearTimeout);
      const p = finalPayload(); emit('final', p); return p;
    },
    cancel: async () => { pr.calls.push(['dictation', 'cancel', {}]); running = false; timers.forEach(clearTimeout); },
  };
  const base = window.Capacitor || {
    isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: () => false,
    registerPlugin: () => new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) }),
  };
  const register = base.registerPlugin, avail = base.isPluginAvailable;
  const mine = n => n === 'MdlfPlanReader' || n === 'MdlfPlanDictation';
  window.Capacitor = Object.assign({}, base, {
    isPluginAvailable: n => (mine(n) ? !pr.noModules : avail(n)),
    registerPlugin: n => (n === 'MdlfPlanReader' ? reader : n === 'MdlfPlanDictation' ? dictation : register(n)),
  });
})();
""" % {'page': json.dumps(PAGE, ensure_ascii=False)}
