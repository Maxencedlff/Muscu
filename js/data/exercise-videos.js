// ═══════════════════════════════════════════════════════════
//  Vidéos d'exercices filmées par les coachs partenaires (procédure : docs/VIDEOS_EXERCICES.md)
//  Manifeste statique versionné data/exercise-videos.json : nom de la bibliothèque → fichier, affiche,
//  durée, crédit. Les vidéos sont hébergées hors de l'app (jamais dans sw.js ni dans le paquet).
//  Manifeste vide, absent ou illisible : aucune vidéo, l'app reste telle qu'avant.
// ═══════════════════════════════════════════════════════════
'use strict';

const EXERCISE_VIDEOS_URL = 'data/exercise-videos.json';
const VIDEO_COACH_RE = /^[A-Za-z0-9._]{1,30}$/;     // pseudo Instagram, sans « @ »
const VIDEO_FILE_RE = /\.(mp4|m4v)$/i;
const POSTER_FILE_RE = /\.(jpe?g|webp|png)$/i;

let exerciseVideos = new Map();   // nom de la bibliothèque → { src, poster, duration, coach, width, height }
let exerciseVideosLoaded = false;

// Adresse d'un fichier : https seulement, ou chemin relatif à l'app (vidéo de test servie en local).
// Jamais http:, data:, javascript: ni blob: (une faute dans le manifeste n'ouvre rien d'inattendu)
function videoFileUrl(base, file, re) {
  if (typeof file !== 'string' || !file || file.length > 300 || /[\s"'<>\\]/.test(file)) return null;
  let url = file;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(file) && base) url = base + file;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    if (!/^https:\/\/[^/]+\//i.test(url)) return null;
  } else if (url.startsWith('//')) return null;
  return re.test(url.split(/[?#]/)[0]) ? url : null;
}

// Nettoyage strict du manifeste : chaque entrée invalide est ignorée seule, sans casser les autres.
// Clé = nom de la bibliothèque (ou alias, ramené au nom par catalogueEntry) ; nom inconnu ignoré.
function cleanVideoManifest(raw) {
  const out = new Map();
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !raw.videos || typeof raw.videos !== 'object') return out;
  const base = typeof raw.base === 'string' && /^(https:\/\/[^/\s"'<>]+\/[^\s"'<>]*)?$/i.test(raw.base) ? raw.base : '';
  for (const [key, v] of Object.entries(raw.videos)) {
    const name = catalogueEntry(key)?.name;
    if (!name || !v || typeof v !== 'object' || out.has(name)) continue;
    const src = videoFileUrl(base, v.src, VIDEO_FILE_RE);
    const poster = videoFileUrl(base, v.poster, POSTER_FILE_RE);
    const coach = typeof v.coach === 'string' ? v.coach.replace(/^@/, '') : '';
    const duration = Number(v.duration);
    if (!src || !poster || !VIDEO_COACH_RE.test(coach) || !(duration >= 1 && duration <= 300)) continue;
    const w = Number(v.width), h = Number(v.height);
    const sized = Number.isInteger(w) && Number.isInteger(h) && w >= 100 && h >= 100 && w <= 4000 && h <= 4000;
    out.set(name, { src, poster, duration: Math.round(duration), coach, width: sized ? w : 1280, height: sized ? h : 720 });
  }
  return out;
}

// Vidéo d'un exercice (nom de la bibliothèque, alias ou nom tapé) ; null sans vidéo
function exerciseVideo(name) {
  const e = catalogueEntry(name);
  return (e && exerciseVideos.get(e.name)) || null;
}

// Lecture automatique (muette, en boucle) : non sur données cellulaires ou en économie de données quand le
// navigateur le dit (navigator.connection : Android ; Safari et l'app iOS ne l'exposent pas), ni quand
// l'iPhone demande de réduire les animations. Sinon la vidéo attend un toucher.
function videoAutoplayAllowed(nav = navigator, reducedMotion = false) {
  if (reducedMotion) return false;
  const c = nav?.connection;
  if (!c) return true;
  if (c.saveData || c.type === 'cellular') return false;
  return !['slow-2g', '2g'].includes(c.effectiveType);
}

// Chargé une fois au démarrage, sans retarder l'app : onReady() n'est appelé que si des vidéos sont arrivées
async function loadExerciseVideos(onReady) {
  try {
    const res = await fetch(EXERCISE_VIDEOS_URL, { cache: 'no-cache' });
    exerciseVideos = res.ok ? cleanVideoManifest(await res.json()) : new Map();
  } catch { exerciseVideos = new Map(); }
  exerciseVideosLoaded = true;
  if (exerciseVideos.size && typeof onReady === 'function') onReady();
}
