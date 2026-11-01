// ═══════════════════════════════════════════════════════════
//  Coffre à photos : code, chiffrement, essais et verrouillage (sans DOM)
// ═══════════════════════════════════════════════════════════
//
// Les photos de progression (js/data/progress-photos.js) ne s'ouvrent qu'avec un code à 6 chiffres, ou
// Face ID dans une build qui a le module natif (MdlfVault, ios/App/App/VaultPlugin.swift). Choix et
// limites détaillés dans docs/COFFRE_PHOTOS.md ; en bref :
//  - Clé du coffre (DEK) : 256 bits tirés au hasard à la création, jamais dérivée du code. Les photos
//    sont chiffrées avec elle (AES-GCM, un IV de 96 bits neuf par photo, identifiant et date liés en
//    données authentifiées : une ligne recopiée sous un autre identifiant ne se déchiffre pas).
//  - Le code n'est jamais stocké, ni en clair ni haché : il sert à dériver une clé d'emballage (PBKDF2
//    HMAC-SHA-256, 600 000 tours, recommandation OWASP, sel de 128 bits) qui chiffre la DEK. Code juste
//    = la DEK se déchiffre (l'étiquette GCM fait la vérification). Changer de code ré-emballe la DEK
//    sans rechiffrer les photos.
//  - Face ID : la DEK est confiée au trousseau d'iOS (accès « Face ID de cet appareil », jamais
//    sauvegardé ni copié sur un autre iPhone), rendue au JS après Face ID ; vérifiée par un témoin
//    chiffré (check) avant usage.
//  - Essais : 4 erreurs libres, puis 30 s, 1 min, 5 min, 15 min, puis 1 h à chaque erreur. L'erreur
//    est comptée AVANT le calcul (tuer l'app pendant l'essai ne le rend pas gratuit). Pas
//    d'effacement automatique : un ami qui joue avec le téléphone ne doit pas pouvoir détruire tes photos.
//  - Code oublié : aucune récupération possible (rien sur nos serveurs) ; on peut seulement
//    réinitialiser le coffre, ce qui EFFACE ses photos (double confirmation, js/features/photo-vault-ui.js).
//  - Verrouillage : en quittant l'écran du coffre, quand l'app passe en arrière-plan, après
//    VAULT_IDLE_MS sans toucher l'écran. La clé n'existe alors plus qu'emballée.
'use strict';

const VAULT_CODE_LEN    = 6;
const VAULT_ITER        = 600_000;
const VAULT_IDLE_MS     = 60_000;
const VAULT_FREE_TRIES  = 4;
const VAULT_DELAYS      = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const VAULT_META_KEY    = 'vault';
const VAULT_TRIES_KEY   = 'tries';
const VAULT_CHECK_TEXT  = 'mdlf-vault-check-v1';

// ── Code ────────────────────────────────────────────────────
// 6 chiffres, et pas un code que tout le monde essaie en premier (même chiffre, suite, motif répété)
function vaultCodeShape(code) { return typeof code === 'string' && new RegExp(`^\\d{${VAULT_CODE_LEN}}$`).test(code); }
function vaultCodeTooSimple(code) {
  if (!vaultCodeShape(code)) return true;
  const d = [...code].map(Number);
  const steps = d.slice(1).map((x, i) => x - d[i]);
  if (steps.every(s => s === 0) || steps.every(s => s === 1) || steps.every(s => s === -1)) return true;   // 000000, 123456, 654321
  if (code.slice(0, 3) === code.slice(3) || code.slice(0, 2).repeat(3) === code) return true;              // 123123, 121212
  return false;
}

// ── Essais ──────────────────────────────────────────────────
// tries : { n (erreurs depuis le dernier succès), at (instant de la dernière erreur), until (fin d'attente) }
function vaultDelayFor(n) { return n <= VAULT_FREE_TRIES ? 0 : VAULT_DELAYS[Math.min(n - VAULT_FREE_TRIES - 1, VAULT_DELAYS.length - 1)]; }
// Attente restante. Horloge reculée (réglage de l'heure) : l'attente repart en entier, pas à zéro
function vaultWaitMs(tries, now = Date.now()) {
  if (!tries || !tries.until) return 0;
  if (now < (tries.at || 0)) return Math.max(0, tries.until - tries.at);
  return Math.max(0, tries.until - now);
}
function vaultAfterFail(tries, now = Date.now()) {
  const n = (tries?.n | 0) + 1;
  return { k: VAULT_TRIES_KEY, n, at: now, until: now + vaultDelayFor(n) };
}
// Erreurs encore possibles avant la première attente (0 quand il y a déjà eu des attentes)
function vaultFreeLeft(tries) { return Math.max(0, VAULT_FREE_TRIES - (tries?.n | 0)); }

// ── Octets ──────────────────────────────────────────────────
const vaultEnc = new TextEncoder();
const vaultDec = new TextDecoder();
function bytesToB64(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(String(b64 || ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function vaultRandom(n) { return crypto.getRandomValues(new Uint8Array(n)); }
// WebCrypto : présent dans un contexte sûr (app iOS capacitor://, https, localhost)
function vaultCryptoOk() { return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.getRandomValues === 'function'; }

// ── Clés ────────────────────────────────────────────────────
async function vaultKek(code, salt, iter) {
  const base = await crypto.subtle.importKey('raw', vaultEnc.encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// Clé du coffre importée : extractible, pour la confier au trousseau d'iOS (Face ID) depuis un coffre ouvert
function vaultImportDek(raw) { return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
async function vaultDekB64(dek) { return bytesToB64(new Uint8Array(await crypto.subtle.exportKey('raw', dek))); }

async function vaultWrap(dekRaw, code, iter) {
  const salt = vaultRandom(16), iv = vaultRandom(12);
  const kek = await vaultKek(code, salt, iter);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: vaultEnc.encode('mdlf-vault|dek') }, kek, dekRaw);
  return { iter, salt: bytesToB64(salt), wrapIv: bytesToB64(iv), wrapped: bytesToB64(new Uint8Array(wrapped)) };
}

// Nouveau coffre : { meta (à stocker), dek (coffre ouvert) }
async function vaultCreate(code, { iter = VAULT_ITER } = {}) {
  if (!vaultCodeShape(code)) throw new Error('code invalide');
  const dekRaw = vaultRandom(32);
  const dek = await vaultImportDek(dekRaw);
  const checkIv = vaultRandom(12);
  const check = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: checkIv }, dek, vaultEnc.encode(VAULT_CHECK_TEXT));
  const wrap = await vaultWrap(dekRaw, code, iter);
  dekRaw.fill(0);
  return { meta: { k: VAULT_META_KEY, v: 1, ...wrap, checkIv: bytesToB64(checkIv), check: bytesToB64(new Uint8Array(check)), bio: false, created: Date.now() }, dek };
}
// Code juste : la clé du coffre ; code faux (ou réglages abîmés) : null
async function vaultOpen(meta, code) {
  if (!meta || !vaultCodeShape(code)) return null;
  try {
    const kek = await vaultKek(code, b64ToBytes(meta.salt), meta.iter | 0 || VAULT_ITER);
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(meta.wrapIv), additionalData: vaultEnc.encode('mdlf-vault|dek') }, kek, b64ToBytes(meta.wrapped)));
    const dek = await vaultImportDek(raw);
    raw.fill(0);
    return dek;
  } catch { return null; }
}
// Clé venue d'ailleurs (trousseau, Face ID) : vraie clé de ce coffre ?
async function vaultCheckKey(meta, dek) {
  try {
    const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(meta.checkIv) }, dek, b64ToBytes(meta.check));
    return vaultDec.decode(out) === VAULT_CHECK_TEXT;
  } catch { return false; }
}
// Nouveau code : même clé du coffre, ré-emballée (nouveau sel) ; les photos ne bougent pas
async function vaultRewrap(meta, dek, code, { iter = VAULT_ITER } = {}) {
  if (!vaultCodeShape(code)) throw new Error('code invalide');
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek));
  const wrap = await vaultWrap(raw, code, iter);
  raw.fill(0);
  return { ...meta, ...wrap };
}

// ── Photos chiffrées ────────────────────────────────────────
// Ligne stockée : { id, date, iv, enc } ; enc = AES-GCM( longueur de l'en-tête (4 octets) | en-tête JSON
// { pose, bytes, w, h, type } | octets JPEG ), identifiant et date en données authentifiées
const photoAad = (id, date) => vaultEnc.encode(`mdlf-photo|${id}|${date}`);
async function photoSeal(dek, rec) {
  const head = vaultEnc.encode(JSON.stringify({ pose: rec.pose, bytes: rec.bytes, w: rec.w, h: rec.h, type: rec.type }));
  const body = new Uint8Array(rec.buf);
  const plain = new Uint8Array(4 + head.length + body.length);
  new DataView(plain.buffer).setUint32(0, head.length);
  plain.set(head, 4);
  plain.set(body, 4 + head.length);
  const iv = vaultRandom(12);
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: photoAad(rec.id, rec.date) }, dek, plain);
  plain.fill(0);
  return { id: rec.id, date: rec.date, iv: bytesToB64(iv), enc };
}
// Ligne déchiffrée : la photo avec un blob prêt pour l'affichage ; null si illisible (autre clé, abîmée)
async function photoUnseal(dek, row) {
  try {
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(row.iv), additionalData: photoAad(row.id, row.date) }, dek, row.enc));
    const len = new DataView(plain.buffer).getUint32(0);
    const head = JSON.parse(vaultDec.decode(plain.subarray(4, 4 + len)));
    const type = head.type || 'image/jpeg';
    return { id: row.id, date: row.date, pose: head.pose, bytes: head.bytes, w: head.w, h: head.h, type,
             blob: new Blob([plain.subarray(4 + len)], { type }) };
  } catch { return null; }
}

// ── Session : coffre ouvert ou fermé ────────────────────────
let vaultKey = null;           // clé du coffre tant qu'il est ouvert, null sinon
let vaultIdleTimer = null;
let vaultEpoch = 0;            // +1 à chaque verrouillage : un déverrouillage commencé avant n'ouvre plus rien
const vaultLockHooks = [];
function vaultIsOpen() { return vaultKey !== null; }
function onVaultLock(cb) { vaultLockHooks.push(cb); }
function vaultSetOpen(dek) { vaultKey = dek; vaultTouch(); }
// Activité dans le coffre : le minuteur d'inactivité repart
function vaultTouch() {
  if (!vaultKey) return;
  clearTimeout(vaultIdleTimer);
  vaultIdleTimer = setTimeout(() => vaultLock('idle'), VAULT_IDLE_MS);
}
// Ferme le coffre : plus de clé en mémoire ; l'interface libère ses images (onVaultLock)
function vaultLock(reason = 'manual') {
  vaultEpoch++;
  clearTimeout(vaultIdleTimer);
  vaultIdleTimer = null;
  if (!vaultKey) return false;
  vaultKey = null;
  vaultLockHooks.forEach(cb => { try { cb(reason); } catch { /* l'interface se redessine au prochain affichage */ } });
  return true;
}

// ── Opérations du coffre (IndexedDB) ────────────────────────
function vaultMeta()  { return photoMetaGet(VAULT_META_KEY); }
function vaultTries() { return photoMetaGet(VAULT_TRIES_KEY); }
async function vaultState() {
  const [meta, tries] = await Promise.all([vaultMeta(), vaultTries()]);
  return { meta, tries };
}

// Photos en clair de l'ancienne base : chiffrées dans le coffre, vérifiées, puis l'ancienne base est
// supprimée. Rejouable : interrompue, elle reprend au prochain déverrouillage (même identifiant = même ligne).
async function vaultMigrate(dek) {
  const legacy = await legacyPhotosAll();
  if (!legacy.length) { await legacyPhotosDrop(); return 0; }
  for (const p of legacy) await photoPutRow(await photoSeal(dek, p));
  const have = new Set((await photoRowsAll()).map(r => r.id));
  if (legacy.every(p => have.has(p.id))) await legacyPhotosDrop();
  return legacy.length;
}

// Création : réglages écrits d'abord, puis migration (une coupure entre les deux est rattrapée ensuite)
async function vaultSetup(code) {
  if (await vaultMeta()) throw new Error('coffre déjà créé');
  const epoch = vaultEpoch;
  const { meta, dek } = await vaultCreate(code);
  await photoMetaPut(meta);
  await photoMetaPut({ k: VAULT_TRIES_KEY, n: 0, at: 0, until: 0 });
  const migrated = await vaultMigrate(dek).catch(() => 0);   // échec (stockage plein) : reprise au déverrouillage
  if (epoch !== vaultEpoch) return { migrated, stale: true };   // écran quitté pendant le calcul : coffre créé, resté fermé
  vaultSetOpen(dek);
  return { migrated };
}

// Vérifie un code en comptant l'essai : { ok, dek? , wait (ms), left (erreurs libres restantes) }
async function vaultTryCode(code, now = Date.now()) {
  const { meta, tries } = await vaultState();
  if (!meta) return { ok: false, wait: 0, left: 0, missing: true };
  const wait = vaultWaitMs(tries, now);
  if (wait > 0) return { ok: false, wait, left: 0 };
  const failed = vaultAfterFail(tries, now);
  await photoMetaPut(failed);                    // compté avant le calcul
  const dek = await vaultOpen(meta, code);
  if (!dek) return { ok: false, wait: vaultWaitMs(failed, now), left: vaultFreeLeft(failed), n: failed.n };
  await photoMetaPut({ k: VAULT_TRIES_KEY, n: 0, at: 0, until: 0 });
  return { ok: true, dek, meta };
}
async function vaultUnlockWithCode(code) {
  const epoch = vaultEpoch;
  const r = await vaultTryCode(code);
  if (!r.ok) return r;
  await vaultMigrate(r.dek).catch(() => 0);
  if (epoch !== vaultEpoch) return { ok: false, stale: true, wait: 0, left: 0 };   // refermé entre-temps : on reste fermé
  vaultSetOpen(r.dek);
  return { ok: true };
}
// Face ID : clé rendue par le trousseau, vérifiée par le témoin du coffre. epoch : relevé AVANT la
// demande de Face ID (un verrouillage pendant la feuille d'iOS doit aussi annuler l'ouverture)
async function vaultUnlockWithKey(b64, epoch = vaultEpoch) {
  const meta = await vaultMeta();
  if (!meta || !b64) return { ok: false };
  let dek;
  try { dek = await vaultImportDek(b64ToBytes(b64)); } catch { return { ok: false }; }
  if (!(await vaultCheckKey(meta, dek))) return { ok: false };
  await photoMetaPut({ k: VAULT_TRIES_KEY, n: 0, at: 0, until: 0 });
  await vaultMigrate(dek).catch(() => 0);
  if (epoch !== vaultEpoch) return { ok: false, stale: true };
  vaultSetOpen(dek);
  return { ok: true };
}
// Changer de code : l'ancien vérifié (essai compté), puis la même clé ré-emballée avec le nouveau
async function vaultChangeCode(oldCode, newCode) {
  const r = await vaultTryCode(oldCode);
  if (!r.ok) return r;
  await photoMetaPut(await vaultRewrap(r.meta, r.dek, newCode));
  return { ok: true };
}
async function vaultSetBio(on) {
  const meta = await vaultMeta();
  if (meta) await photoMetaPut({ ...meta, bio: !!on });
}

// Photos du coffre ouvert, de la plus récente à la plus ancienne ; broken : lignes illisibles
async function vaultPhotos() {
  if (!vaultKey) throw new Error('coffre fermé');
  const dek = vaultKey;
  const rows = await photoRowsAll();
  const out = (await Promise.all(rows.map(r => photoUnseal(dek, r)))).filter(Boolean);
  if (vaultKey !== dek) throw new Error('coffre fermé');   // refermé pendant le déchiffrement : rien ne sort
  return { photos: out.sort((a, b) => b.date - a.date), broken: rows.length - out.length };
}
async function vaultAddPhoto(rec) {
  if (!vaultKey) throw new Error('coffre fermé');
  await photoPutRow(await photoSeal(vaultKey, rec));
}
// Code oublié : coffre vidé (photos, réglages, ancienne base) et clé retirée du trousseau
async function vaultReset() {
  vaultLock('reset');
  const ok = await photosWipe();
  await Native.vault.forget();
  return ok;
}
// Photos en attente de migration (écran de création : « tes 4 photos y seront rangées »)
async function vaultLegacyCount() { try { return (await legacyPhotosAll()).length; } catch { return 0; } }
