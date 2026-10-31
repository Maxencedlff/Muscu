// Jetons Strava chiffrés avant d'entrer en base, et état OAuth (logique pure, Web Crypto : même code
// dans Deno et dans Node 22, testé par tests/unit/strava-server.mjs). Contrat : docs/STRAVA.md.
//
// - Chiffrement : AES-GCM 256 bits, vecteur de 12 octets tiré à chaque fois, identifiant du compte en
//   données associées (un chiffré recopié sur la ligne d'un autre compte ne se déchiffre pas).
//   Format stocké : « v1.<vecteur>.<chiffré> » en base64url. Clé : secret STRAVA_TOKEN_KEY du projet
//   (32 octets en base64), jamais en base ni dans le dépôt. Une copie de la base seule ne donne aucun
//   accès Strava.
// - État OAuth : 32 octets aléatoires (base64url) envoyés à Strava ; la base ne garde que leur empreinte
//   SHA-256 en hexadécimal (private.strava_states.state_hash).

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Clé AES depuis le secret (base64 ou base64url de 32 octets) ; null si absente ou mal formée
export async function tokenKey(secret) {
  if (typeof secret !== 'string' || !secret.trim()) return null;
  let raw;
  try { raw = fromB64(secret.trim()); } catch { return null; }
  if (raw.length !== 32) return null;
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// { access, refresh } → texte chiffré lié au compte userId
export async function sealTokens(key, userId, { access, refresh }) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(String(userId)) }, key,
    enc.encode(JSON.stringify({ a: access, r: refresh })));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

// Texte chiffré → { access, refresh }, null s'il ne se déchiffre pas (autre clé, autre compte, altéré)
export async function openTokens(key, userId, sealed) {
  const parts = String(sealed || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(parts[1]), additionalData: enc.encode(String(userId)) }, key, fromB64(parts[2]));
    const o = JSON.parse(dec.decode(pt));
    return typeof o?.a === 'string' && typeof o?.r === 'string' ? { access: o.a, refresh: o.r } : null;
  } catch { return null; }
}

export function newState() { return b64url(crypto.getRandomValues(new Uint8Array(32))); }

export async function stateHash(state) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(state))));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// État reçu de Strava : la forme exacte de newState (43 caractères base64url), rien d'autre n'est cherché
export function stateLooksValid(state) { return typeof state === 'string' && /^[A-Za-z0-9_-]{43}$/.test(state); }
