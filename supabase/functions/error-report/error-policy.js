// Règles de la fonction error-report (docs/ERREURS_PROD.md), logique pure testée sans Deno par
// tests/unit/error-report.mjs. Le serveur ne fait PAS confiance au nettoyage de l'app : il refuse tout
// rapport qui sort de la forme attendue (liste blanche, caractères, longueurs) au lieu de le corriger,
// et ne recopie que les champs connus. Mêmes bornes que les contraintes de public.error_reports
// (supabase/migrations/20261129010000_erreurs_prod.sql).

export const BODY_MAX = 8192;            // octets du corps de la requête
export const MESSAGE_MAX = 200;
export const FRAMES_MAX = 12;
export const KINDS = ['error', 'rejection'];
export const PLATFORMS = ['ios', 'android', 'web'];
const KEYS = ['v', 'kind', 'name', 'message', 'frames', 'build', 'platform'];
const FRAME_KEYS = ['f', 'file', 'l', 'c'];
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const isLineNo = (n) => Number.isInteger(n) && n >= 0 && n <= 999999;

// Message : ASCII imprimable, sans chiffre ni @ (le nettoyage de l'app les a remplacés : un rapport qui
// en a encore n'est pas passé par lui), MESSAGE_MAX au plus
export const MESSAGE_RE = /^[\x20-\x7E]*$/;
export const FILE_RE = /^(?:(?:coach-web\/)?js\/[A-Za-z0-9_/.-]{1,100}\.js|index\.html|<ext>)$/;

function validFrame(fr) {
  if (!isObj(fr) || Object.keys(fr).some((k) => !FRAME_KEYS.includes(k))) return null;
  if (typeof fr.f !== 'string' || !(fr.f === '' || fr.f === '?' || /^[A-Za-z_$][\w$.<>]{0,59}$/.test(fr.f))) return null;
  if (typeof fr.file !== 'string' || !FILE_RE.test(fr.file) || fr.file.includes('..')) return null;
  if (!isLineNo(fr.l) || !isLineNo(fr.c)) return null;
  return { f: fr.f, file: fr.file, l: fr.l, c: fr.c };
}

// { ok: true, value } (champs connus seulement) ou { ok: false, error: 'invalid', field }
export function validateErrorReport(body) {
  const bad = (field) => ({ ok: false, error: 'invalid', field });
  if (!isObj(body)) return bad('body');
  const extra = Object.keys(body).find((k) => !KEYS.includes(k));
  if (extra) return bad(extra.slice(0, 40));
  if (body.v !== 1) return bad('v');
  if (!KINDS.includes(body.kind)) return bad('kind');
  if (typeof body.name !== 'string' || !/^[A-Za-z]{1,40}$/.test(body.name)) return bad('name');
  const m = body.message;
  if (typeof m !== 'string' || m.length > MESSAGE_MAX || !MESSAGE_RE.test(m) || /[0-9@]/.test(m)) return bad('message');
  if (!Array.isArray(body.frames) || body.frames.length > FRAMES_MAX) return bad('frames');
  const frames = body.frames.map(validFrame);
  if (frames.some((f) => !f)) return bad('frames');
  if (typeof body.build !== 'string' || !/^[A-Za-z0-9._+-]{1,40}$/.test(body.build)) return bad('build');
  if (!PLATFORMS.includes(body.platform)) return bad('platform');
  return { ok: true, value: { kind: body.kind, name: body.name, message: m, frames, build: body.build, platform: body.platform } };
}

// Limite de fréquence par appareil SANS garder l'adresse IP : la clé est une empreinte de l'IP avec un sel
// tiré au démarrage de l'instance (jamais écrit, jamais journalisé, perdu à son arrêt), gardée en mémoire
// seulement le temps de la fenêtre. Au-delà de maxKeys clés, tout est oublié (mémoire bornée).
// hit(key, now) → true si l'appel passe. Une limite globale par heure est en plus tenue par la base.
export function makeLimiter({ max = 20, windowMs = 10 * 60_000, maxKeys = 5000 } = {}) {
  const hits = new Map();
  return {
    hit(key, now = Date.now()) {
      const cur = hits.get(key);
      if (!cur || now - cur.start >= windowMs) {
        if (!cur && hits.size >= maxKeys) hits.clear();
        hits.set(key, { start: now, n: 1 });
        return true;
      }
      cur.n++;
      return cur.n <= max;
    },
    size: () => hits.size,
  };
}

// Adresse de l'appelant telle que la donne la passerelle (première de x-forwarded-for), '' sinon.
// Ne sert qu'à calculer la clé de makeLimiter, jamais stockée.
export function clientAddress(headers) {
  const xff = headers.get('x-forwarded-for') || '';
  return (xff.split(',')[0] || headers.get('cf-connecting-ip') || '').trim().slice(0, 64);
}
