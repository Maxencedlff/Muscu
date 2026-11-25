// ═══════════════════════════════════════════════════════════
//  « Relier un ordinateur » : protocole qui donne à un navigateur la clé des photos de bilan du coach, sans que
//  le serveur puisse la lire (docs/PHOTOS_WEB.md, modèle de menace compris). Logique pure + WebCrypto, sans DOM :
//  chargée telle quelle par l'app iPhone (côté téléphone : js/data/photo-link-phone.js) et par l'appli web du coach
//  (côté navigateur : coach-web/js/desk/photo-device.js). Serveur : 20261127010000_photos_web_appairage.sql.
//
//  1. Navigateur : paire ECDH P-256 éphémère D (privée non extractible), secret s de 128 bits, ligne d'appairage
//     (coach_photo_pair_start : D.pub et H(s) seulement, 2 minutes, une à la fois). QR code affiché :
//     MDLF1.<appairage>.<coach>.<D.pub>.<s> (base64url). Le QR est le canal authentifié : le serveur ne voit jamais s.
//  2. Téléphone (compte du coach) : lit le QR, vérifie que l'appairage est à lui et que la clé du serveur est
//     celle du QR (coach_photo_pair_peek), tire sa paire éphémère E et publie E.pub avec la preuve H(s)
//     (coach_photo_pair_offer). Les deux côtés calculent Z = ECDH(E, D), puis HKDF-SHA-256 (sel s, info liée à
//     l'appairage, au coach, à D.pub et E.pub) : une clé AES-GCM 256 d'enveloppe et un code de vérification à
//     6 chiffres, affiché sur les deux écrans.
//  3. Le coach compare les deux codes, touche « Relier » sur l'iPhone, Face ID : la clé privée des photos (PKCS#8,
//     sortie du trousseau iCloud comme pour l'ouverture des photos) est chiffrée en AES-GCM par la clé d'enveloppe,
//     données liées : appareil, coach, identifiant et clé publique de la clé du coach (coach_photo_pair_complete).
//  4. Navigateur : garde dans IndexedDB la seule clé d'enveloppe, NON extractible (jamais D, ni s, ni la clé du
//     coach). À chaque ouverture des photos : coach_photo_device_key rend l'enveloppe, unwrapKey la rouvre en une
//     clé privée elle aussi non extractible, en mémoire tant que les photos sont affichées. Retirer l'appareil sur
//     le serveur (iPhone, « Oublier cet ordinateur », clé changée, 30 jours sans usage, 90 jours) suffit à couper.
// ═══════════════════════════════════════════════════════════
'use strict';
// Briques reprises de js/data/photo-vault.js (bytesToB64) et js/data/coach-photos.js (cphConcat), chargés avant lui

const PLINK_V          = 'mdlf-photo-link-v1';
const PLINK_QR_PREFIX  = 'MDLF1';
const PLINK_TTL_MS     = 120_000;            // durée d'un appairage (serveur : 2 minutes)
const PLINK_POLL_MS    = 1_500;              // navigateur : relecture de l'appairage
const PLINK_DEVICE_MAX = 5;                  // ordinateurs reliés par coach (comme le serveur)
const PLINK_LABEL_MAX  = 60;
const PLINK_P256       = { name: 'ECDH', namedCurve: 'P-256' };
const PLINK_UUID_RE    = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLINK_PUB_RE     = /^B[A-P][A-Za-z0-9+/]{84}[AEIMQUYcgkosw048]=$/;   // point P-256 non compressé (65 octets) en base64
const PLINK_IV_RE      = /^[A-Za-z0-9+/]{16}$/;
const PLINK_B64U_RE    = /^[A-Za-z0-9_-]+$/;
const plinkEnc = new TextEncoder();

// ── Encodages ───────────────────────────────────────────────

function plinkB64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// base64url strict (alphabet, longueur attendue) → octets, ou null
function plinkFromB64u(s, len) {
  if (typeof s !== 'string' || !PLINK_B64U_RE.test(s) || s.length !== Math.ceil(len * 4 / 3)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    if (bin.length !== len) return null;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return plinkB64u(out) === s ? out : null;   // forme canonique seulement (pas de bits de bourrage changés)
  } catch { return null; }
}
function plinkUuidBytes(id) {
  if (!PLINK_UUID_RE.test(id || '')) return null;
  const hex = id.replace(/-/g, '');
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}
function plinkBytesUuid(b) {
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ── QR code ─────────────────────────────────────────────────

// { pair, coach, pub (base64, 65 octets), secret (16 octets) } → texte du QR (env. 160 caractères)
function plinkQrText({ pair, coach, pub, secret }) {
  const p = plinkUuidBytes(pair), c = plinkUuidBytes(coach);
  let raw = null;
  try { raw = Uint8Array.from(atob(pub || ''), ch => ch.charCodeAt(0)); } catch { /* refusé plus bas */ }
  if (!p || !c || !raw || raw.length !== 65 || raw[0] !== 4 || !ArrayBuffer.isView(secret) || secret.BYTES_PER_ELEMENT !== 1 || secret.length !== 16) return null;
  return [PLINK_QR_PREFIX, plinkB64u(p), plinkB64u(c), plinkB64u(raw), plinkB64u(secret)].join('.');
}
// Texte lu par l'appareil photo → { pair, coach, pub, secret }, ou null (autre QR, tronqué, modifié)
function plinkQrParse(text) {
  if (typeof text !== 'string' || text.length > 200) return null;
  const parts = text.trim().split('.');
  if (parts.length !== 5 || parts[0] !== PLINK_QR_PREFIX) return null;
  const p = plinkFromB64u(parts[1], 16), c = plinkFromB64u(parts[2], 16), raw = plinkFromB64u(parts[3], 65), s = plinkFromB64u(parts[4], 16);
  if (!p || !c || !raw || !s || raw[0] !== 4) return null;
  const pub = bytesToB64(raw);
  return PLINK_PUB_RE.test(pub) ? { pair: plinkBytesUuid(p), coach: plinkBytesUuid(c), pub, secret: s } : null;
}
// Preuve que le téléphone a lu le QR : le serveur garde H(s), le téléphone le lui redonne (jamais s lui-même)
async function plinkVerifier(secret) {
  const h = await crypto.subtle.digest('SHA-256', cphConcat(plinkEnc.encode(`${PLINK_V}|verifier|`), secret));
  return bytesToB64(new Uint8Array(h));
}

// ── Dérivation : clé d'enveloppe et code de vérification ────

const plinkInfo = (purpose, c) => plinkEnc.encode([PLINK_V, purpose, c.pair, c.coach, c.devicePub, c.epk].join('|'));
// Code à 6 chiffres « 482 913 » depuis 64 bits
function plinkSasText(bytes) {
  // 64 bits lus comme deux moitiés de 32 bits, réduits modulo 10^6 sans dépasser 2^53 (pas de BigInt)
  const hi = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const lo = ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0;
  const s = String(((hi % 1e6) * (2 ** 32 % 1e6) + lo) % 1e6).padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}
// priv : ma clé privée éphémère (E côté téléphone, D côté navigateur) ; peer : la clé publique de l'autre (base64) ;
// c : { pair, coach, devicePub, epk, secret } ; usage : 'encrypt' (téléphone) ou 'unwrapKey' (navigateur).
// → { wrapKey (AES-GCM 256, non extractible), sas }
async function plinkDerive(priv, peerB64, c, usage) {
  const peer = await crypto.subtle.importKey('raw', Uint8Array.from(atob(peerB64), ch => ch.charCodeAt(0)), PLINK_P256, false, []);
  const z = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, priv, 256));
  try {
    const ikm = await crypto.subtle.importKey('raw', z, 'HKDF', false, ['deriveKey', 'deriveBits']);
    const wrapKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: c.secret, info: plinkInfo('wrap', c) }, ikm,
      { name: 'AES-GCM', length: 256 }, false, [usage]);
    const sas = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: c.secret, info: plinkInfo('sas', c) }, ikm, 64));
    return { wrapKey, sas: plinkSasText(sas) };
  } finally { z.fill(0); }
}
// Données liées de l'enveloppe : l'appareil (= l'appairage), le coach, SA clé (identifiant et clé publique). Une
// enveloppe recopiée vers un autre appareil, un autre coach ou une autre clé ne s'ouvre pas.
const plinkAad = (device, coach, keyId, coachPub) => plinkEnc.encode([PLINK_V, 'device', device, coach, keyId, coachPub].join('|'));

// Téléphone : clé privée du coach (PKCS#8) chiffrée pour l'appareil. → { wrapped, iv } en base64
async function plinkWrap(wrapKey, pkcs8, { device, coach, keyId, coachPub }) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: plinkAad(device, coach, keyId, coachPub) }, wrapKey, pkcs8));
  return { wrapped: bytesToB64(ct), iv: bytesToB64(iv) };
}
// Navigateur : enveloppe → clé privée du coach, NON extractible (la clé en clair ne passe jamais par le JavaScript),
// ou null (autre clé d'enveloppe, enveloppe ou données liées modifiées)
async function plinkUnwrap(wrapKey, { wrapped, iv }, { device, coach, keyId, coachPub }) {
  try {
    const ct = Uint8Array.from(atob(wrapped), ch => ch.charCodeAt(0)), v = Uint8Array.from(atob(iv), ch => ch.charCodeAt(0));
    return await crypto.subtle.unwrapKey('pkcs8', ct, wrapKey, { name: 'AES-GCM', iv: v, additionalData: plinkAad(device, coach, keyId, coachPub) },
      PLINK_P256, false, ['deriveBits']);
  } catch { return null; }
}

// ── Nettoyage de ce que rend le serveur ─────────────────────

const plinkTime = v => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : null; };
// Nom de l'appareil choisi par le navigateur (« Chrome sur Windows ») : texte simple, 60 caractères au plus
function plinkLabelClean(s) {
  // eslint-disable-next-line no-control-regex -- caractères de contrôle retirés exprès d'un nom reçu
  const t = String(s || '').replace(/[\u202a-\u202e\u2066-\u2069]/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, PLINK_LABEL_MAX).join('') || 'Ordinateur';
}
// Agent du navigateur → « Chrome sur Windows », « Safari sur Mac »… (ce que le coach reconnaît dans sa liste)
function plinkLabel(ua) {
  const u = String(ua || '');
  const browser = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /OPR\//.test(u) ? 'Opera' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Navigateur';
  const os = /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /CrOS/.test(u) ? 'Chromebook' : /Linux/.test(u) ? 'Linux' : '';
  return os ? `${browser} sur ${os}` : browser;
}
// coach_photo_pair_peek → { devicePub, label, state, expiresAt } (téléphone)
function cleanPlinkPeek(raw) {
  const r = raw && typeof raw === 'object' ? raw : null;
  if (!r || !PLINK_PUB_RE.test(r.device_pub || '') || !['waiting', 'offered', 'done'].includes(r.state)) return null;
  return { devicePub: r.device_pub, label: plinkLabelClean(r.label), state: r.state, expiresAt: plinkTime(r.expires_at) };
}
// coach_photo_pair_status → { state: 'waiting' | 'offered' | 'done', epk?, device? } (navigateur)
function cleanPlinkStatus(raw) {
  const r = raw && typeof raw === 'object' ? raw : null;
  if (!r || !['waiting', 'offered', 'done'].includes(r.state)) return null;
  if (r.state !== 'waiting' && !PLINK_PUB_RE.test(r.epk || '')) return null;
  if (r.state === 'done' && !PLINK_UUID_RE.test(r.device || '')) return null;
  return { state: r.state, epk: r.state === 'waiting' ? null : r.epk, device: r.state === 'done' ? r.device : null };
}
// coach_photo_device_key → { id, keyId, epk, wrapped, iv } (navigateur)
function cleanPlinkDevice(raw) {
  const r = raw && typeof raw === 'object' ? raw : null;
  if (!r || !PLINK_UUID_RE.test(r.id || '') || !/^[0-9a-f]{32}$/.test(r.key_id || '') || !PLINK_IV_RE.test(r.iv || '')
    || typeof r.wrapped !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(r.wrapped) || r.wrapped.length > 400) return null;
  return { id: r.id, keyId: r.key_id, wrapped: r.wrapped, iv: r.iv, expiresAt: plinkTime(r.expires_at) };
}
// coach_photo_devices → [{ id, label, createdAt, usedAt, expiresAt }] (téléphone), du plus récent
function cleanPlinkDevices(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 20).filter(d => d && PLINK_UUID_RE.test(d.id || ''))
    .map(d => ({ id: d.id, label: plinkLabelClean(d.label), createdAt: plinkTime(d.created_at), usedAt: plinkTime(d.last_used_at), expiresAt: plinkTime(d.expires_at) }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
