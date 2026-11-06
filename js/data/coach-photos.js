// ═══════════════════════════════════════════════════════════
//  Photos de bilan envoyées au coach : chiffrement de bout en bout, métadonnées retirées, appels au serveur
//  (sans DOM). Contrat, choix, sources et limites : docs/PHOTOS_BILAN.md ; serveur :
//  supabase/migrations/20261107000000_photos_bilan.sql ; écrans : js/features/coach-photos-ui.js.
//
//  - L'élève choisit chaque photo dans son coffre (Face ID déjà passé) et l'envoie lui-même : jamais d'envoi
//    automatique. Chaque photo est redessinée (côté long à CPH_MAX_PX, JPEG) : il ne reste aucune métadonnée
//    (ni localisation, ni appareil, ni date d'origine), et jpegMetaFree le vérifie octet par octet avant le
//    chiffrement : une photo qui garderait un bloc EXIF, XMP, IPTC ou un commentaire ne part pas.
//  - Chiffrement sur l'iPhone de l'élève, pour la clé publique du coach : ECDH P-256 éphémère (une clé par
//    photo), HKDF-SHA-256, AES-GCM 256 ; identifiant, élève, coach, clé, jour et pose liés en données
//    authentifiées (une ligne recopiée ou modifiée par le serveur ne se déchiffre pas). Le serveur ne garde que
//    du chiffré (Storage, compartiment privé) et la clé publique éphémère.
//  - Clé du coach : paire ECDH P-256 tirée sur son iPhone. La clé privée part au serveur chiffrée (AES-GCM) par
//    un secret de 256 bits du trousseau iCloud du coach, rendu par le module du coffre après Face ID
//    (Native.vault, même module que le coffre de l'élève, autre identifiant). Elle suit donc sur un nouvel
//    iPhone du coach, comme son coffre ; le serveur ne peut pas la lire. En mémoire seulement écran ouvert.
//  - Code de la clé (empreinte de 64 bits de la clé publique) : montré au coach et à l'élève, pour vérifier
//    ensemble, s'ils le veulent, que le serveur n'a pas glissé une autre clé (docs/PHOTOS_BILAN.md, « Limites »).
//  - Serveur pas à jour (PGRST202) : missing, rien ne s'affiche.
// ═══════════════════════════════════════════════════════════
'use strict';

const CPH_BUCKET     = 'coach-photos';
const CPH_MAX_PX     = 1080;                 // côté le plus long envoyé (le coffre garde 1200 px)
const CPH_QUALITIES  = [0.8, 0.68, 0.55];    // qualité JPEG, baissée si la photo dépasse CPH_MAX_BYTES
const CPH_MAX_BYTES  = 1_000_000;            // le chiffré (+16 octets) reste sous le 1 Mo du compartiment
const CPH_PER_DAY    = 3;                    // photos d'un même jour (comme le serveur)
const CPH_URL_TTL_S  = 60;                   // durée de l'URL signée : lue aussitôt, jamais affichée
const CPH_IDLE_MS    = 60_000;               // coach : photos refermées après une minute sans toucher l'écran
const CPH_RETRY_MS   = 10 * 60_000;          // serveur sans la fonction : nouvel essai après 10 min
const CPH_INFO       = 'mdlf-coach-photo-v1';
const CPH_KEY_AAD    = 'mdlf-coach-photo-key-v1';
const CPH_SENT_KEY   = 'mdlf_coach_photos';  // { userId, coachId, map: { id serveur: id de la photo du coffre } }
const CPH_PIN_KEY    = 'mdlf_coach_photo_pin';   // { userId, coachId, pub } : clé du coach vue au dernier envoi
const CPH_P256       = { name: 'ECDH', namedCurve: 'P-256' };
const CPH_ID_RE      = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CPH_DAY_RE     = /^\d{4}-\d\d-\d\d$/;
const CPH_PUB_RE     = /^B[A-P][A-Za-z0-9+/]{84}[AEIMQUYcgkosw048]=$/;
const CPH_IV_RE      = /^[A-Za-z0-9+/]{16}$/;
const cphEnc = new TextEncoder();

// ── Métadonnées d'un JPEG (logique pure) ────────────────────

// Parcourt un JPEG : segments d'en-tête et de chaque passe ({ marker, id }), jusqu'à la fin de l'image (EOI),
// qui doit être le dernier octet. null si ce n'est pas un JPEG bien formé (ou s'il traîne des octets après).
function jpegSegments(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
  const out = [];
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xFF) return null;
    const m = b[i + 1];
    if (m === 0xFF) { i++; continue; }                                   // octet de remplissage
    if (m === 0xD9) return i + 2 === b.length ? out : null;              // fin de l'image : rien après
    if ((m >= 0xD0 && m <= 0xD7) || m === 0x01) { i += 2; continue; }   // marqueurs sans longueur
    if (i + 4 > b.length) return null;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    let id = '';
    for (let k = i + 4; k < i + 2 + len && k < i + 18 && b[k] !== 0; k++) id += String.fromCharCode(b[k]);
    out.push({ marker: m, id });
    i += 2 + len;
    if (m === 0xDA) {   // données de l'image : jusqu'au prochain marqueur (FF00 et FFD0 à FFD7 en font partie)
      while (i + 1 < b.length && !(b[i] === 0xFF && b[i + 1] !== 0x00 && !(b[i + 1] >= 0xD0 && b[i + 1] <= 0xD7))) i++;
    }
  }
  return null;
}
// Segments permis : techniques seulement (JFIF, profil de couleur, Adobe). Tout autre bloc d'application (EXIF
// et sa localisation, XMP, IPTC, MPF…) et tout commentaire : refusé.
const JPEG_ALLOWED_APP = { 0xE0: 'JFIF', 0xE2: 'ICC_PROFILE', 0xEE: 'Adobe' };
function jpegMetaFree(bytes) {
  const segs = jpegSegments(bytes);
  if (!segs || !segs.some(s => s.marker === 0xDA)) return false;
  return segs.every(s => {
    if (s.marker === 0xFE) return false;
    if (s.marker >= 0xE0 && s.marker <= 0xEF) return JPEG_ALLOWED_APP[s.marker] === s.id;
    return true;
  });
}

// ── Préparation d'une photo (navigateur) ────────────────────

// Photo du coffre (blob JPEG) → JPEG redessiné, côté long à CPH_MAX_PX, sans métadonnées (vérifié), sous
// CPH_MAX_BYTES. Lève une erreur si l'image est illisible ou si un bloc de métadonnées resterait.
async function coachPhotoJpeg(blob) {
  const img = await loadImageFrom(blob);
  const { w, h } = photoFitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, CPH_MAX_PX);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  try {
    for (const q of CPH_QUALITIES) {
      const bytes = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', q)).arrayBuffer());
      if (!jpegMetaFree(bytes)) throw new Error('métadonnées restantes');
      if (bytes.length <= CPH_MAX_BYTES) return { bytes, w, h };
    }
    throw new Error('photo trop lourde');
  } finally { canvas.width = 0; canvas.height = 0; }   // mémoire de l'image rendue tout de suite
}

// ── Chiffrement (WebCrypto) ─────────────────────────────────

function cphConcat(...parts) {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let i = 0;
  parts.forEach(p => { out.set(p, i); i += p.length; });
  return out;
}
// Données authentifiées d'une photo : tout ce que le serveur garde en clair à côté du chiffré
function cphAad(m) { return cphEnc.encode([CPH_INFO, m.id, m.student, m.coach, m.keyId, m.takenOn, m.pose].join('|')); }
// Clé AES-GCM d'une photo : ECDH (clé privée d'un côté, publique de l'autre) puis HKDF, sel = les deux clés publiques
async function cphAesKey(priv, pub, epkRaw, coachRaw, usage) {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const ikm = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: cphConcat(epkRaw, coachRaw), info: cphEnc.encode(CPH_INFO) },
    ikm, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
// Élève : photo chiffrée pour la clé publique du coach, avec une paire éphémère tirée pour elle seule.
// → { epk, iv, ct } (epk : clé publique éphémère, 65 octets en base64 ; ct : chiffré et son étiquette)
async function coachPhotoSeal(coachPubB64, plain, meta) {
  const coachRaw = b64ToBytes(coachPubB64);
  const coachPub = await crypto.subtle.importKey('raw', coachRaw, CPH_P256, false, []);
  const eph = await crypto.subtle.generateKey(CPH_P256, false, ['deriveBits']);
  const epkRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const aes = await cphAesKey(eph.privateKey, coachPub, epkRaw, coachRaw, 'encrypt');
  const iv = vaultRandom(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: cphAad(meta) }, aes, plain));
  return { epk: bytesToB64(epkRaw), iv: bytesToB64(iv), ct };
}
// Coach : photo déchiffrée (octets JPEG), ou null (autre clé, chiffré ou données modifiés)
async function coachPhotoOpen(session, row, ct, meta) {
  try {
    const epkRaw = b64ToBytes(row.epk);
    const epk = await crypto.subtle.importKey('raw', epkRaw, CPH_P256, false, []);
    const aes = await cphAesKey(session.priv, epk, epkRaw, b64ToBytes(session.pub), 'decrypt');
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(row.iv), additionalData: cphAad(meta) }, aes, ct));
  } catch { return null; }
}

const cphKeyAad = (coachId, keyId) => cphEnc.encode(`${CPH_KEY_AAD}|${coachId}|${keyId}`);
// Coach : nouvelle paire. La clé privée part chiffrée par le secret du trousseau (AES-GCM, coach et identifiant
// liés) ; ici, elle n'est gardée que non extractible. → { rec (ce qui va au serveur), priv }
async function coachKeyMake(secret, coachId, keyId) {
  const pair = await crypto.subtle.generateKey(CPH_P256, true, ['deriveBits']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  try {
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const iv = vaultRandom(12);
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: cphKeyAad(coachId, keyId) }, secret, pkcs8));
    const priv = await crypto.subtle.importKey('pkcs8', pkcs8, CPH_P256, false, ['deriveBits']);
    return { rec: { key_id: keyId, public_key: bytesToB64(pub), wrapped_key: bytesToB64(wrapped), wrap_iv: bytesToB64(iv) }, priv };
  } finally { pkcs8.fill(0); }
}
// Coach : clé privée rouverte avec le secret du trousseau, et vérifiée : la clé publique du serveur doit être
// la sienne (un serveur qui l'aurait changée est repéré ici). null sinon.
async function coachKeyOpen(secret, coachId, rec) {
  let pkcs8 = null;
  try {
    pkcs8 = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(rec.wrap_iv), additionalData: cphKeyAad(coachId, rec.key_id) },
      secret, b64ToBytes(rec.wrapped_key)));
    const jwk = await crypto.subtle.exportKey('jwk', await crypto.subtle.importKey('pkcs8', pkcs8, CPH_P256, true, ['deriveBits']));
    const raw = cphConcat(new Uint8Array([4]), b64urlToBytes(jwk.x), b64urlToBytes(jwk.y));
    if (bytesToB64(raw) !== rec.public_key) return null;
    return await crypto.subtle.importKey('pkcs8', pkcs8, CPH_P256, false, ['deriveBits']);
  } catch { return null; } finally { pkcs8?.fill(0); }
}
function b64urlToBytes(s) {
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  return b64ToBytes(t + '='.repeat((4 - (t.length % 4)) % 4));
}
// Code de la clé : 64 premiers bits du SHA-256 de la clé publique, « 4F2A 91C3 0B7E D215 »
async function coachKeyCode(pubB64) {
  try {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', b64ToBytes(pubB64)));
    const hex = [...h.subarray(0, 8)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    return hex.match(/.{4}/g).join(' ');
  } catch { return ''; }
}

// ── Nettoyage de ce que renvoie le serveur ──────────────────

const cphPose = p => (PHOTO_POSE_KEYS.includes(p) ? p : null);
function cleanCphKey(raw) {
  const k = raw && typeof raw === 'object' ? raw : null;
  return k && /^[0-9a-f]{32}$/.test(k.key_id) && CPH_PUB_RE.test(k.public_key) ? { key_id: k.key_id, public_key: k.public_key,
    wrapped_key: typeof k.wrapped_key === 'string' ? k.wrapped_key : null, wrap_iv: typeof k.wrap_iv === 'string' ? k.wrap_iv : null } : null;
}
// student_photo_state() → { coach, ready, key, photos: [{ id, takenOn, pose, bytes, sentAt }] }
function cleanStudentPhotos(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const key = cleanCphKey(r.key);
  const photos = (Array.isArray(r.photos) ? r.photos : []).slice(0, 100)
    .filter(p => p && CPH_ID_RE.test(p.id) && CPH_DAY_RE.test(p.taken_on) && cphPose(p.pose))
    .map(p => ({ id: p.id, takenOn: p.taken_on, pose: p.pose, bytes: Number.isInteger(p.bytes) ? p.bytes : 0, sentAt: coachTime(p.sent_at) }));
  return { coach: r.coach === true, ready: r.ready === true && !!key, adult: r.adult === true, key, photos };
}
// coach_student_photos() → [{ id, path, takenOn, pose, epk, iv, keyId, bytes, sentAt }] (chemin vérifié : élève/id)
function cleanCoachPhotos(raw, student) {
  const list = raw && typeof raw === 'object' && Array.isArray(raw.photos) ? raw.photos : [];
  return list.slice(0, 100)
    .filter(p => p && CPH_ID_RE.test(p.id) && p.path === `${student}/${p.id}` && CPH_DAY_RE.test(p.taken_on) && cphPose(p.pose)
      && CPH_PUB_RE.test(p.epk) && CPH_IV_RE.test(p.iv) && /^[0-9a-f]{32}$/.test(p.key_id))
    .map(p => ({ id: p.id, path: p.path, takenOn: p.taken_on, pose: p.pose, epk: p.epk, iv: p.iv, keyId: p.key_id,
      bytes: Number.isInteger(p.bytes) ? p.bytes : 0, sentAt: coachTime(p.sent_at) }));
}
// Photos regroupées par jour de prise, du plus récent ; dans un jour : face, profil, dos
function cphDays(list) {
  const map = new Map();
  (list || []).forEach(p => { if (!map.has(p.takenOn)) map.set(p.takenOn, []); map.get(p.takenOn).push(p); });
  const order = p => PHOTO_POSE_KEYS.indexOf(p.pose);
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, photos]) => ({ day, photos: photos.slice().sort((a, b) => order(a) - order(b)) }));
}
// Jour « AAAA-MM-JJ » → horodatage local à midi (affichage avec fmtDate)
function cphDayTs(day) { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); }

// ── Élève : état, envoi, retrait ────────────────────────────

const cph = { userId: null, state: null, loading: false, error: null, missing: false, triedAt: 0, busy: false, code: '' };
let cphSeq = 0;   // +1 au changement de compte : une réponse arrivée après n'écrit plus rien

function readCphSent() {
  try { const c = JSON.parse(localStorage.getItem(CPH_SENT_KEY)); return c && c.userId === cph.userId && c.map && typeof c.map === 'object' ? c : null; }
  catch { return null; }
}
function writeCphSent(map, coachId) {
  try { if (map && Object.keys(map).length) localStorage.setItem(CPH_SENT_KEY, JSON.stringify({ userId: cph.userId, coachId, map })); else localStorage.removeItem(CPH_SENT_KEY); }
  catch { /* facultatif : seulement la mention « Envoyée » dans le coffre */ }
}
// Photo du coffre → photo envoyée au coach actuel (id serveur), ou null
function cphSentOf(vaultId) {
  const c = readCphSent();
  if (!c || !cph.state) return null;
  const sid = Object.keys(c.map).find(k => c.map[k] === vaultId);
  return sid ? cph.state.photos.find(p => p.id === sid) || null : null;
}

// Clé du coach retenue au premier envoi (confiance au premier usage) : un changement ensuite (nouvel iPhone du coach
// sans son trousseau, ou serveur qui glisserait une autre clé) est montré à l'élève avant tout nouvel envoi
function cphPinOf() {
  try { const c = JSON.parse(localStorage.getItem(CPH_PIN_KEY)); return c && c.userId === cph.userId && c.coachId === myCoach()?.user_id ? c.pub : null; }
  catch { return null; }
}
function cphKeyChanged() { const pin = cphPinOf(); return !!(pin && cph.state?.key && pin !== cph.state.key.public_key); }
function cphPinKey() {
  try { if (cph.state?.key) localStorage.setItem(CPH_PIN_KEY, JSON.stringify({ userId: cph.userId, coachId: myCoach()?.user_id, pub: cph.state.key.public_key })); }
  catch { /* facultatif : sans elle, pas d'alerte au changement */ }
}
// « J'ai 18 ans ou plus », déclaré une fois avant le premier envoi
async function cphDeclareAdult() {
  const r = await coachRpc('student_photo_adult');
  if (r.ok) { cph.state = cleanStudentPhotos(r.data); notifyCoach(); }
  return r;
}

// Fonction proposée : compte, coach, serveur à jour, coffre possible ici
function cphStudentShown() { return !!(account.user && coachRole().hasCoach && cph.state && !cph.missing); }

async function cphRefresh({ minAge = 0, now = Date.now() } = {}) {
  if (!account.user || !coachRole().hasCoach) { cph.state = null; return false; }
  if (cph.loading || (cph.missing && now - cph.triedAt < CPH_RETRY_MS)) return false;
  if (minAge && cph.state && now - cph.triedAt < minAge) return true;
  cph.loading = true;
  cph.triedAt = now;
  const seq = cphSeq;
  const r = await coachRpc('student_photo_state');
  if (seq !== cphSeq) return false;
  cph.loading = false;
  if (!r.ok) { cph.error = r.kind; cph.missing = r.kind === 'missing'; if (cph.missing) cph.state = null; notifyCoach(); return false; }
  cph.state = cleanStudentPhotos(r.data);
  cph.error = null; cph.missing = false;
  cph.code = cph.state.key ? await coachKeyCode(cph.state.key.public_key) : '';
  // Photos retirées ailleurs (autre appareil, lien rompu) : plus de mention « Envoyée » ici
  const c = readCphSent();
  if (c) {
    const live = new Set(cph.state.photos.map(p => p.id));
    const coachId = myCoach()?.user_id || null;
    writeCphSent(c.coachId === coachId ? Object.fromEntries(Object.entries(c.map).filter(([k]) => live.has(k))) : null, coachId);
  }
  notifyCoach();
  return true;
}

// Envoi de photos du coffre ouvert (choisies une à une par l'élève, même jour, CPH_PER_DAY au plus). Une
// photo à la fois : préparée (accord horodaté sur le serveur), fichier chiffré envoyé, puis validée. Une photo
// qui échoue est retirée du serveur ; les précédentes restent envoyées. → { ok, sent, kind? }
async function cphSend(photos) {
  if (cph.busy) return { ok: false, kind: 'busy', sent: 0 };
  if (!photos?.length || photos.length > CPH_PER_DAY || new Set(photos.map(p => localISO(p.date))).size !== 1) return { ok: false, kind: 'invalid_photo', sent: 0 };
  if (!vaultIsOpen()) return { ok: false, kind: 'locked', sent: 0 };
  cph.busy = true;
  notifyCoach();
  const seq = cphSeq;
  let sent = 0;
  try {
    await cphRefresh();
    const st = cph.state, coachId = myCoach()?.user_id, me = account.user?.id;
    if (seq !== cphSeq) return { ok: false, kind: 'signed_out', sent };
    if (!st || !st.ready || !coachId || !me) return { ok: false, kind: cph.error || 'not_ready', sent };
    if (!st.adult) return { ok: false, kind: 'not_adult', sent };
    if (cphKeyChanged()) return { ok: false, kind: 'key_changed', sent };   // l'élève doit d'abord accepter la nouvelle clé
    const map = { ...(readCphSent()?.coachId === coachId ? readCphSent().map : {}) };
    for (const p of photos) {
      if (!vaultIsOpen()) return { ok: false, kind: 'locked', sent };
      const { bytes } = await coachPhotoJpeg(p.blob);
      const meta = { id: crypto.randomUUID(), student: me, coach: coachId, keyId: st.key.key_id, takenOn: localISO(p.date), pose: cphPose(p.pose) || 'face' };
      const sealed = await coachPhotoSeal(st.key.public_key, bytes, meta);
      bytes.fill(0);
      const prep = await coachRpc('student_photo_prepare', { photo: meta.id, key_id: meta.keyId, taken_on: meta.takenOn, pose: meta.pose, epk: sealed.epk, iv: sealed.iv });
      if (seq !== cphSeq) return { ok: false, kind: 'signed_out', sent };
      if (!prep.ok) return { ok: false, kind: prep.kind, sent };
      const path = `${me}/${meta.id}`;
      const up = await cphUpload(path, sealed.ct);
      const done = up.ok ? await coachRpc('student_photo_commit', { photo: meta.id }) : up;
      if (!done.ok) {
        await coachRpc('student_photo_remove', { photo: meta.id });   // rien ne reste à moitié envoyé
        if (up.ok) await cphStorageRemove([path]);
        return { ok: false, kind: done.kind, sent };
      }
      map[meta.id] = p.id;
      sent++;
    }
    writeCphSent(map, coachId);
    cphPinKey();
    return { ok: true, sent };
  } catch {
    return { ok: false, kind: 'server', sent };
  } finally {
    if (seq === cphSeq) { cph.busy = false; await cphRefresh(); }
  }
}

// Fichier chiffré vers le compartiment privé (jamais de remplacement : upsert faux)
async function cphUpload(path, ct) {
  if (!sb?.storage) return { ok: false, kind: 'server' };
  try {
    const { error } = await sb.storage.from(CPH_BUCKET).upload(path, new Blob([ct], { type: 'application/octet-stream' }),
      { contentType: 'application/octet-stream', upsert: false, cacheControl: '60' });
    return error ? { ok: false, kind: coachErrorKind(error) } : { ok: true };
  } catch (e) { return { ok: false, kind: coachErrorKind(e) || 'server' }; }
}
async function cphStorageRemove(paths) {
  if (!sb?.storage || !paths.length) return false;
  try { const { error } = await sb.storage.from(CPH_BUCKET).remove(paths); return !error; } catch { return false; }
}

// Retirer une photo envoyée : la ligne d'abord (le coach perd l'accès, et ce qui sert à déchiffrer disparaît),
// puis le fichier (la purge du serveur le fait aussi si l'appareil n'y arrive pas)
async function cphRemove(id) {
  if (!CPH_ID_RE.test(id || '')) return { ok: false, kind: 'not_found' };
  const r = await coachRpc('student_photo_remove', { photo: id });
  if (!r.ok) return r;
  await cphStorageRemove([`${account.user.id}/${id}`]);
  const c = readCphSent();
  if (c) { delete c.map[id]; writeCphSent(c.map, c.coachId); }
  if (cph.state) cph.state.photos = cph.state.photos.filter(p => p.id !== id);
  notifyCoach();
  return { ok: true };
}
// Lien rompu (quitter le coach) : le serveur a effacé les lignes ; les fichiers de mon dossier partent aussi
async function cphForgetAll(userId) {
  writeCphSent(null);
  if (cph.state) cph.state.photos = [];
  if (!sb?.storage || !userId) return;
  try {
    const { data } = await sb.storage.from(CPH_BUCKET).list(userId, { limit: 100 });
    const paths = (data || []).map(o => o?.name).filter(n => CPH_ID_RE.test(n || '')).map(n => `${userId}/${n}`);
    await cphStorageRemove(paths);
  } catch { /* la purge du serveur s'en charge */ }
}

// ── Coach : clé, ouverture, photos d'un élève ───────────────

// key : undefined (pas lue), null (aucune), { key_id, public_key, wrapped_key, wrap_iv } ; session : clé privée en
// mémoire (écran des photos ouvert seulement) ; students : { [uid]: { photos, loading, error, loadedAt } }
const cphCoach = { key: undefined, code: '', loading: false, error: null, missing: false, triedAt: 0, busy: false, session: null, students: {} };
let cphIdleTimer = null;
let cphEpoch = 0;
const cphLockHooks = [];
function onCphLock(cb) { cphLockHooks.push(cb); }
// Module du coffre présent (trousseau iCloud, Face ID) : sans lui, rien côté coach
function cphCoachAvailable() { return vaultAvailable(); }
function cphCoachShown() { return !!(account.user && coachRole().isCoach && cphCoachAvailable() && !cphCoach.missing && cphCoach.key !== undefined); }

async function cphCoachRefresh({ now = Date.now() } = {}) {
  if (!account.user || !coachRole().isCoach || !cphCoachAvailable()) return false;
  if (cphCoach.loading || (cphCoach.missing && now - cphCoach.triedAt < CPH_RETRY_MS)) return false;
  cphCoach.loading = true;
  cphCoach.triedAt = now;
  const seq = cphSeq;
  const r = await coachRpc('coach_photo_key');
  if (seq !== cphSeq) return false;
  cphCoach.loading = false;
  if (!r.ok) { cphCoach.error = r.kind; cphCoach.missing = r.kind === 'missing'; notifyCoach(); return false; }
  const key = cleanCphKey(r.data);
  if (cphCoach.session && key?.key_id !== cphCoach.session.keyId) cphLock('key');
  cphCoach.key = key;
  cphCoach.code = key ? await coachKeyCode(key.public_key) : '';
  cphCoach.error = null; cphCoach.missing = false;
  notifyCoach();
  return true;
}

// Face ID (ou le code) via le module du coffre, puis secret du trousseau importé (non extractible)
async function cphSecret(create, reason, keyId) {
  const r = await (create ? Native.vault.create(reason, keyId) : Native.vault.unlock(reason, keyId));
  if (!r?.key) return { refused: r || { failed: true } };
  const secret = await vaultImportKey(r.key);
  return secret ? { secret } : { refused: { failed: true } };
}
// Coach : créer ma clé (premier usage) ou la remplacer (clé perdue). replace : les photos chiffrées pour l'ancienne
// sont effacées par le serveur. → { ok } ou { ok: false, kind | canceled | nopasscode }
async function cphCoachSetup({ replace = false } = {}) {
  if (cphCoach.busy) return { ok: false, kind: 'busy' };
  const me = account.user?.id;
  if (!me) return { ok: false, kind: 'signed_out' };
  cphCoach.busy = true;
  const seq = cphSeq;
  try {
    const keyId = vaultNewId();
    const s = await cphSecret(true, 'Recevoir les photos de tes élèves', keyId);
    if (s.refused) return { ok: false, ...s.refused };
    const { rec, priv } = await coachKeyMake(s.secret, me, keyId);
    const r = await coachRpc('coach_photo_key_set', { ...rec, replace });
    if (seq !== cphSeq) return { ok: false, kind: 'signed_out' };
    if (!r.ok) {
      Native.vault.forget(keyId);
      if (r.kind === 'key_exists') { await cphCoachRefresh(); return { ok: true, other: true }; }   // créée entre-temps sur un autre appareil
      return r;
    }
    if (replace) {
      Object.keys(cphCoach.students).forEach(k => delete cphCoach.students[k]);
      const old = cphCoach.key?.key_id;
      if (old && old !== keyId) Native.vault.forget(old);   // ancien secret inutile (sa clé est effacée du serveur)
    }
    cphCoach.key = cleanCphKey(r.data);
    cphCoach.code = cphCoach.key ? await coachKeyCode(cphCoach.key.public_key) : '';
    cphOpenSession({ priv, pub: rec.public_key, keyId });
    return { ok: true };
  } catch { return { ok: false, kind: 'server' }; } finally { cphCoach.busy = false; notifyCoach(); }
}
// Coach : ouvrir les photos (Face ID). { ok } ; { missing } : secret absent de cet iPhone (trousseau iCloud pas
// encore arrivé, ou désactivé sur l'ancien) ou clé qui ne correspond pas ; sinon le refus d'iOS.
async function cphCoachUnlock() {
  const key = cphCoach.key, me = account.user?.id;
  if (!key || !me) return { ok: false, failed: true };
  if (cphCoach.session?.keyId === key.key_id) { cphTouch(); return { ok: true }; }
  const epoch = cphEpoch;
  const s = await cphSecret(false, 'Voir les photos de tes élèves', key.key_id);
  if (s.refused) return { ok: false, ...s.refused };
  const priv = await coachKeyOpen(s.secret, me, key);
  if (!priv) return { ok: false, missing: true };
  if (epoch !== cphEpoch) return { ok: false, stale: true };   // refermé pendant Face ID
  cphOpenSession({ priv, pub: key.public_key, keyId: key.key_id });
  return { ok: true };
}
function cphOpenSession(session) { cphCoach.session = session; cphTouch(); }
function cphIsOpen() { return !!cphCoach.session; }
function cphTouch() {
  if (!cphCoach.session) return;
  clearTimeout(cphIdleTimer);
  cphIdleTimer = setTimeout(() => cphLock('idle'), CPH_IDLE_MS);
}
// Referme : clé privée oubliée, images libérées par l'écran (onCphLock)
function cphLock(reason = 'manual') {
  cphEpoch++;
  clearTimeout(cphIdleTimer);
  cphIdleTimer = null;
  if (!cphCoach.session) return false;
  cphCoach.session = null;
  cphLockHooks.forEach(cb => { try { cb(reason); } catch { /* écran absent */ } });
  return true;
}

function cphStudentOf(uid) { return cphCoach.students[uid] ||= { photos: [], loading: false, error: null, loadedAt: 0 }; }
// Coach : ne plus voir une photo reçue (effacée comme un retrait de l'élève)
async function cphCoachHide(uid, id) {
  const r = await coachRpc('coach_photo_hide', { photo: id });
  if (!r.ok) return r;
  const f = cphStudentOf(uid);
  f.photos = f.photos.filter(p => p.id !== id);
  notifyCoach();
  return { ok: true };
}

// Liste des photos d'un élève (métadonnées, rien de déchiffré)
async function cphCoachLoad(uid) {
  if (!cphCoach.key || !CPH_ID_RE.test(uid || '')) return { ok: false, kind: 'not_ready' };
  const f = cphStudentOf(uid);
  if (f.loading) return { ok: true };
  f.loading = true;
  const seq = cphSeq;
  const r = await coachRpc('coach_student_photos', { student: uid });
  if (seq !== cphSeq) return { ok: false, kind: 'signed_out' };
  f.loading = false;
  if (!r.ok) { f.error = r.kind; notifyCoach(); return r; }
  f.photos = cleanCoachPhotos(r.data, uid).filter(p => p.keyId === cphCoach.key?.key_id);
  f.error = null; f.loadedAt = Date.now();
  notifyCoach();
  return { ok: true };
}
// Une photo déchiffrée (Blob JPEG) : URL signée de CPH_URL_TTL_S secondes, lue aussitôt, jamais montrée ;
// null si illisible. Session refermée pendant la lecture : rien ne sort.
async function cphCoachFetch(uid, p) {
  const session = cphCoach.session, me = account.user?.id;
  if (!session || !me || !sb?.storage) return null;
  try {
    const { data, error } = await sb.storage.from(CPH_BUCKET).createSignedUrl(p.path, CPH_URL_TTL_S);
    if (error || !data?.signedUrl) return null;
    const res = await fetch(data.signedUrl, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) return null;
    const ct = new Uint8Array(await res.arrayBuffer());
    const plain = await coachPhotoOpen(session, p, ct, { id: p.id, student: uid, coach: me, keyId: p.keyId, takenOn: p.takenOn, pose: p.pose });
    if (!plain || cphCoach.session !== session || !jpegMetaFree(plain)) return null;
    return new Blob([plain], { type: 'image/jpeg' });
  } catch { return null; }
}

// ── Déclencheurs ────────────────────────────────────────────

function cphReset(userId) {
  cphSeq++;
  cphLock('account');
  Object.assign(cph, { userId, state: null, loading: false, error: null, missing: false, triedAt: 0, busy: false, code: '' });
  Object.assign(cphCoach, { key: undefined, code: '', loading: false, error: null, missing: false, triedAt: 0, busy: false, session: null, students: {} });
}
onAccountChange(() => {
  const id = account.user?.id || null;
  if (id !== cph.userId) cphReset(id);
});
