'use strict';
// ═══════════════════════════════════════════════════════════
//  Remontée des erreurs de l'app (docs/ERREURS_PROD.md)
// ═══════════════════════════════════════════════════════════
//
// Quand l'app plante chez quelqu'un (erreur non rattrapée, promesse rejetée sans catch), un rapport
// minimal part vers la fonction serveur error-report (Supabase, même hébergeur que les comptes) :
//   { v, kind, name, message, frames, build, platform }   ← LISTE BLANCHE, rien d'autre ne sort.
// Aucune donnée personnelle : ni pseudo, ni e-mail, ni poids, ni séance, ni identifiant de compte,
// ni jeton (la requête n'a pas d'en-tête Authorization), ni appareil, ni heure locale.
//   - message : tronqué, nombres, adresses, e-mails, textes entre guillemets, jetons et identifiants, mots accentués et
//     pseudo / e-mail du compte remplacés par des marques (<n>, <url>, <email>, '<s>', <k>, <t>, <p>) ;
//     seuls les caractères ASCII imprimables restent (le serveur refuse tout le reste) ;
//   - frames : la pile est RECONSTRUITE (fonction, fichier de l'app, ligne, colonne), jamais recopiée :
//     un fichier hors de js/ devient <ext>, un nom de fonction douteux devient ?.
// Seulement dans l'app installée (Native.isNative) : la PWA et les tests ne remontent rien.
// Au plus ERR_REPORT_MAX par lancement, chaque erreur une seule fois ; une réponse non 2xx (fonction
// absente, limite atteinte) coupe la remontée jusqu'au prochain lancement.
// Écouteurs : js/app/error-capture.js. Tests : tests/unit/error-report.mjs.

const ERR_REPORT_PATH = '/functions/v1/error-report';
const ERR_REPORT_MAX = 5;            // rapports envoyés au plus par lancement de l'app
const ERR_MESSAGE_MAX = 200;         // caractères du message après nettoyage
const ERR_FRAMES_MAX = 12;           // lignes de pile gardées
const ERR_NAMES = ['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'URIError', 'EvalError',
  'AggregateError', 'DOMException', 'SecurityError', 'QuotaExceededError', 'NotAllowedError', 'AbortError',
  'NetworkError', 'TimeoutError', 'InvalidStateError', 'NotFoundError', 'NotSupportedError', 'DataCloneError', 'UnknownError'];
const errReportState = { sent: 0, seen: new Set(), stopped: false };

// Pseudo et e-mail du dernier compte connecté (cache du profil, js/data/account.js), à effacer du message
// s'ils y apparaissent sans guillemets. Défense en plus : le nettoyage ne compte pas dessus.
function errPersonalValues() {
  const out = [];
  try {
    const key = typeof PROFILE_CACHE_KEY === 'string' ? PROFILE_CACHE_KEY : 'mdlf_profile';
    const p = JSON.parse(localStorage.getItem(key) || 'null');
    for (const v of [p?.username, p?.email, typeof p?.email === 'string' ? p.email.split('@')[0] : null]) {
      if (typeof v === 'string' && v.trim().length >= 2) out.push(v.trim());
    }
  } catch { /* cache illisible : rien à ajouter */ }
  return out;
}

const errEscapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Message d'erreur sans rien de personnel (voir l'en-tête), ASCII imprimable, ERR_MESSAGE_MAX au plus
function errScrubMessage(text, personal = []) {
  let s = String(text ?? '').slice(0, 2000);
  for (const v of personal) if (typeof v === 'string' && v.length >= 2) s = s.replace(new RegExp(errEscapeRe(v), 'gi'), '<p>');
  s = s
    // eslint-disable-next-line no-control-regex -- caractères de contrôle retirés exprès du message
    .replace(/[\x00-\x1F\x7F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, ' ')        // contrôle et invisibles
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"\x60)]*/gi, '<url>')                 // adresses (capacitor://, https://…)
    .replace(/[^\s'"\x60<>()]*@[^\s'"\x60<>()]*/g, '<email>')                        // tout mot avec un @
    .replace(/(?=\S*\d)[\w\-.+/=:]{16,}/g, '<k>')                               // jetons, identifiants, UUID
    .replace(/'[^']*'|"[^"]*"|\x60[^\x60]*\x60|«[^»]*»|“[^”]*”|‘[^’]*’/g, "'<s>'")    // valeurs citées (pseudo, nom d'exercice…)
    .replace(/\d+(?:[.,]\d+)*/g, '<n>')                                        // nombres (poids, reps, dates, identifiants)
    .replace(/\S*[^\x20-\x7E\s]\S*/g, '<t>')                                   // mots accentués ou non ASCII
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > ERR_MESSAGE_MAX ? s.slice(0, ERR_MESSAGE_MAX - 3) + '...' : s;
}

// Fichier de l'app d'après l'adresse d'une ligne de pile : js/... ou index.html, sinon <ext>
function errFileOf(url) {
  const p = String(url).split(/[?#]/)[0];
  const m = p.match(/(?:^|\/)((?:coach-web\/)?js\/[A-Za-z0-9_/.-]{1,100}\.js)$/);
  if (m && !m[1].includes('..')) return m[1];
  if (/(?:^|\/)index\.html$/.test(p) || /^[a-z]+:\/\/[^/]+\/?$/i.test(p)) return 'index.html';
  return '<ext>';
}

// Pile reconstruite (V8 « at f (url:l:c) », WebKit « f@url:l:c ») : [{ f, file, l, c }], ERR_FRAMES_MAX au plus
function errParseStack(stack) {
  const frames = [];
  for (const raw of String(stack ?? '').split('\n').slice(0, 50)) {
    const line = raw.trim().replace(/^at\s+/, '');
    const m = line.match(/^(?:(.*?)\s*[@(])?\s*([^\s()@]*?):(\d{1,7}):(\d{1,7})\)?$/);
    if (!m) continue;
    let fn = (m[1] || '').replace(/^(?:async|new)\s+/, '').trim();
    if (!/^[A-Za-z_$][\w$.<>]{0,59}$/.test(fn)) fn = fn ? '?' : '';
    frames.push({ f: fn, file: errFileOf(m[2]), l: Math.min(+m[3], 999999), c: Math.min(+m[4], 999999) });
    if (frames.length >= ERR_FRAMES_MAX) break;
  }
  return frames;
}

// Rapport complet, liste blanche : seuls ces sept champs existent, quoi que contienne l'erreur
function errBuildReport(err, { kind = 'error', build = null, platform = 'web', personal = [] } = {}) {
  const e = err && typeof err === 'object' ? err : { message: err };
  let name = 'Error';
  try { if (ERR_NAMES.includes(e.name)) name = e.name; } catch { /* accesseur piégé */ }
  let message = '', stack = '';
  try { message = typeof e.message === 'string' ? e.message : String(e.message ?? ''); } catch { /* idem */ }
  try { stack = typeof e.stack === 'string' ? e.stack : ''; } catch { /* idem */ }
  return {
    v: 1,
    kind: kind === 'rejection' ? 'rejection' : 'error',
    name,
    message: errScrubMessage(message, personal),
    frames: errParseStack(stack),
    build: typeof build === 'string' && /^[A-Za-z0-9._+-]{1,40}$/.test(build) ? build : 'dev',
    platform: ['ios', 'android', 'web'].includes(platform) ? platform : 'web',
  };
}

const errReportKey = r => `${r.name}|${r.message}|${r.frames[0] ? `${r.frames[0].file}:${r.frames[0].l}:${r.frames[0].c}` : ''}`;

function errReportEnabled() {
  return typeof Native !== 'undefined' && Native.isNative === true && !errReportState.stopped;
}

// Envoi au mieux : sans jeton de session, sans cookie, sans référent ; un refus coupe la remontée
function errReportSend(report) {
  if (typeof fetch !== 'function' || typeof ACCOUNT_CONFIG === 'undefined') return;
  try {
    fetch(ACCOUNT_CONFIG.url + ERR_REPORT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ACCOUNT_CONFIG.publishableKey },
      body: JSON.stringify(report),
      credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
    }).then(res => { if (!res.ok) errReportState.stopped = true; }, () => { /* hors ligne : perdu, tant pis */ });
  } catch { /* fetch indisponible */ }
}

// Point d'entrée des écouteurs : ne lève jamais (une erreur ici ne doit pas en créer une autre)
function errReportCapture(err, kind) {
  try {
    if (!errReportEnabled()) return null;
    const build = typeof window !== 'undefined' ? window.MDLF_BUILD?.version : null;
    const report = errBuildReport(err, { kind, build, platform: Native.platform, personal: errPersonalValues() });
    const key = errReportKey(report);
    if (errReportState.seen.has(key)) return null;
    if (errReportState.sent >= ERR_REPORT_MAX) { errReportState.stopped = true; return null; }
    errReportState.seen.add(key);
    errReportState.sent++;
    errReportSend(report);
    return report;
  } catch { return null; }
}
