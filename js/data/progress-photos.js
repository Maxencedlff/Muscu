// ═══════════════════════════════════════════════════════════
//  Photos de progression : stockage privé sur l'appareil (IndexedDB) et redimensionnement
// ═══════════════════════════════════════════════════════════
//
// Où vont les photos, et pourquoi :
//  - Dans IndexedDB, base « mdlf-photos », une entrée par photo { id, date, pose, bytes, w, h, type, buf }
//    (buf : octets JPEG en ArrayBuffer ; un Blob stocké tel quel échoue dans certains WebKit, le tableau
//    d'octets passe partout ; photosAll() rend un blob prêt pour les vignettes).
//    Dans l'app iPhone, IndexedDB vit dans le bac à sable de l'app (Library/WebKit), au même endroit que
//    le stockage web qui porte déjà toutes les séances (ppl_v2 dans localStorage) : rien ne va dans la
//    pellicule, rien dans iCloud Photos, rien sur le serveur. Pas dans localStorage : quelques photos
//    dépasseraient ses ~5 Mo et bloqueraient l'enregistrement des séances.
//  - Pas de module Camera : la build iOS en place ne l'a pas (package.json, js/platform/native.js), et
//    une mise à jour à chaud ne peut pas ajouter de code natif. Un <input type="file" accept="image/*">
//    ouvre dans la WebView iOS la feuille « Prendre une photo / Photothèque », sans module ; les photos
//    prises depuis cette feuille ne sont pas ajoutées à la pellicule.
//  - Le module Filesystem existe, mais un seul chemin de stockage (le même dans l'app, la PWA et les
//    tests) vaut mieux que deux : IndexedDB se teste sous Playwright, Directory.Data non.
//  - Hors de l'export (trop lourd) et de la copie iCloud de l'app : « Supprimer toutes les données »
//    les efface (photosWipe, js/features/settings.js). Elles font partie de la sauvegarde iPhone
//    (iCloud ou ordinateur) comme le reste du bac à sable de l'app.
// Images réduites avant stockage : côté le plus long à PHOTO_MAX_PX, JPEG qualité PHOTO_QUALITY
// (une photo d'iPhone de 4 Mo tombe vers 150 à 300 ko).
'use strict';

const PHOTO_DB      = 'mdlf-photos';
const PHOTO_STORE   = 'photos';
const PHOTO_MAX_PX  = 1200;
const PHOTO_QUALITY = 0.8;
const PHOTO_POSES   = [['face', 'Face'], ['side', 'Profil'], ['back', 'Dos']];
const PHOTO_POSE_KEYS = PHOTO_POSES.map(([k]) => k);

function photoPoseLabel(pose) { return PHOTO_POSES.find(([k]) => k === pose)?.[1] || 'Photo'; }

// Dimensions après réduction : le côté le plus long ramené à max, jamais agrandi, au moins 1 px
function photoFitSize(w, h, max = PHOTO_MAX_PX) {
  const W = Math.max(1, Math.round(w) || 1), H = Math.max(1, Math.round(h) || 1);
  const scale = Math.min(1, max / Math.max(W, H));
  return { w: Math.max(1, Math.round(W * scale)), h: Math.max(1, Math.round(H * scale)) };
}

// « 850 ko », « 1,2 Mo »
function fmtBytes(n) {
  const b = Math.max(0, Number(n) || 0);
  if (b < 1024) return `${Math.round(b)} o`;
  if (b < 1024 * 1024) return `${fmtNum(Math.round(b / 1024))} ko`;
  return `${fmtNum(Math.round(b / 1024 / 1024 * 10) / 10, 1)} Mo`;
}

// Photos regroupées par jour, jours du plus récent au plus ancien, et dans un jour : face, profil, dos
function photoDayGroups(list) {
  const map = new Map();
  (list || []).forEach(p => {
    const k = localISO(p.date);
    if (!map.has(k)) map.set(k, { day: k, date: p.date, photos: [] });
    const g = map.get(k);
    g.photos.push(p);
    if (p.date > g.date) g.date = p.date;
  });
  const order = p => { const i = PHOTO_POSE_KEYS.indexOf(p.pose); return i < 0 ? PHOTO_POSES.length : i; };
  return [...map.values()].sort((a, b) => b.date - a.date)
    .map(g => ({ ...g, photos: g.photos.slice().sort((a, b) => order(a) - order(b) || b.date - a.date) }));
}
function photosTotalBytes(list) { return (list || []).reduce((a, p) => a + (p.bytes || 0), 0); }

// ── Disponibilité ───────────────────────────────────────────
// App iOS : le champ « image/* » propose « Prendre une photo » ; sans NSCameraUsageDescription dans
// Info.plist, iOS tue l'app à ce toucher. La clé ne peut arriver que par une nouvelle build : tant que la
// build installée ne l'a pas, les photos sont absentes de l'app iOS (écran, textes, guide) ; les
// mensurations restent. Passer à true dans le même contenu que la build qui ajoute la clé : Info.plist
// fait partie de l'empreinte runtime (scripts/build-web.mjs), et une mise à jour à chaud n'est appliquée
// qu'à une coquille de même empreinte (js/app/live-update.js) : ce true n'atteint jamais une build sans la clé.
const PHOTOS_NATIVE_READY = true;
// Photos permises ici (navigateur, ou app iOS dont la build a la clé) : textes et guide
function photosAllowedHere() { return !Native.isNative || PHOTOS_NATIVE_READY; }
// Photos utilisables : permises et stockage IndexedDB présent
function photosEnabled() { return photosAllowedHere() && photosSupported(); }

// ── IndexedDB ───────────────────────────────────────────────
function photosSupported() { return typeof indexedDB !== 'undefined' && indexedDB !== null; }

let photoDbPromise = null;
function photosDb() {
  if (!photosSupported()) return Promise.reject(new Error('IndexedDB indisponible'));
  photoDbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE, { keyPath: 'id' }).createIndex('date', 'date');
    };
    req.onsuccess = () => { req.result.onclose = () => { photoDbPromise = null; }; resolve(req.result); };
    req.onerror   = () => { photoDbPromise = null; reject(req.error); };
    req.onblocked = () => { photoDbPromise = null; reject(new Error('base bloquée')); };
  });
  return photoDbPromise;
}
// Une transaction, une opération : la promesse rend le résultat de la requête
async function photoTx(mode, op) {
  const db = await photosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, mode);
    const req = op(tx.objectStore(PHOTO_STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error || req?.error || new Error('écriture refusée'));
    tx.onabort = () => reject(tx.error || req?.error || new Error('transaction interrompue'));
  });
}

// Toutes les photos, de la plus récente à la plus ancienne, avec un blob prêt pour les vignettes
async function photosAll() {
  const rows = (await photoTx('readonly', s => s.getAll())) || [];
  return rows.filter(p => p && p.buf).sort((a, b) => b.date - a.date)
    .map(p => ({ ...p, blob: new Blob([p.buf], { type: p.type || 'image/jpeg' }) }));
}
function photoPut(rec)   { return photoTx('readwrite', s => s.put(rec)); }
function photoDelete(id) { return photoTx('readwrite', s => s.delete(id)); }
// « Supprimer toutes les données » : la base entière, sans erreur si elle n'existe pas (ou si IndexedDB manque)
async function photosWipe() {
  if (!photosSupported()) return false;
  try { await photoTx('readwrite', s => s.clear()); return true; }
  catch { return false; }
}

// ── Réduction d'une image ───────────────────────────────────
function loadImageFrom(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
    img.src = url;
  });
}
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') { reject(new Error('toBlob absent')); return; }
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encodage impossible'))), type, quality);
  });
}
// Fichier choisi (caméra ou pellicule) → entrée prête à stocker, image réduite (JPEG)
async function photoFromFile(file, { pose, date = Date.now() } = {}) {
  const img = await loadImageFrom(file);
  const src = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  const { w, h } = photoFitSize(src.w, src.h);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await canvasToBlob(canvas, 'image/jpeg', PHOTO_QUALITY);
  const buf  = await blob.arrayBuffer();
  return { id: `ph${uid()}`, date, pose: PHOTO_POSE_KEYS.includes(pose) ? pose : 'face', bytes: buf.byteLength, w, h, type: 'image/jpeg', buf };
}
