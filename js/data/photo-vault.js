// ═══════════════════════════════════════════════════════════
//  Coffre à photos : clé, chiffrement et verrouillage (sans DOM)
// ═══════════════════════════════════════════════════════════
//
// Les photos de progression (js/data/progress-photos.js) ne s'ouvrent qu'avec Face ID, ou à défaut le code
// de l'iPhone, comme l'album « Masqués » de Photos. Choix, limites et sources : docs/COFFRE_PHOTOS.md ; en bref :
//  - Clé du coffre : 256 bits tirés par iOS à la création et gardés dans le trousseau iCloud (module natif
//    MdlfVault, ios/App/App/VaultPlugin.swift), chiffré de bout en bout : elle suit sur un nouvel iPhone.
//    Le module ne la rend qu'après Face ID ou le code de l'iPhone. Une clé par coffre : son identifiant (id)
//    est dans les réglages, écrit AVANT la demande de clé (une création interrompue reprend la même clé).
//  - Clé absente alors que le coffre existe (nouvel iPhone dont le trousseau iCloud n'est pas encore
//    arrivé, ou trousseau iCloud désactivé sur l'ancien) : jamais de nouvelle clé pour ce coffre ; « illisible
//    pour l'instant », à réessayer.
//  - Pas de code propre à l'app : rien à oublier, rien à deviner hors de l'iPhone. Les essais sont limités
//    par iOS lui-même (Face ID, puis code de l'iPhone et ses délais).
//  - Photos chiffrées ici, en AES-GCM (un IV de 96 bits neuf par photo, identifiant et date liés en données
//    authentifiées : une ligne recopiée sous un autre identifiant ne se déchiffre pas). La clé rendue par iOS
//    est vérifiée par un témoin chiffré (check) avant usage, et importée non extractible.
//  - Sans le module natif (navigateur, coquille plus ancienne) : coffre indisponible. Les photos en clair
//    d'avant le coffre restent alors où elles sont, jamais effacées sans avoir été rangées.
//  - Verrouillage : en quittant l'écran du coffre, quand l'app passe en arrière-plan, après
//    VAULT_IDLE_MS sans toucher l'écran. La clé n'est alors plus que dans le trousseau.
'use strict';

const VAULT_IDLE_MS     = 60_000;
const VAULT_META_KEY    = 'vault';
const VAULT_CHECK_TEXT  = 'mdlf-vault-check-v1';
const VAULT_KEY_BYTES   = 32;
const VAULT_META_V      = 3;

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
// Clé rendue par le trousseau (base64) → clé AES-GCM non extractible ; null si elle n'a pas la bonne taille
async function vaultImportKey(b64) {
  let raw;
  try { raw = b64ToBytes(b64); } catch { return null; }
  if (raw.length !== VAULT_KEY_BYTES) return null;
  try { return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
  catch { return null; }
  finally { raw.fill(0); }
}
// Identifiant d'un coffre (nom de sa clé dans le trousseau) : 128 bits en hexadécimal
function vaultNewId() { return [...vaultRandom(16)].map(b => b.toString(16).padStart(2, '0')).join(''); }
// Réglages d'un coffre créé : son identifiant et un témoin chiffré par la clé (aucune clé, même emballée)
async function vaultCreateMeta(dek, id, now = Date.now()) {
  const checkIv = vaultRandom(12);
  const check = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: checkIv }, dek, vaultEnc.encode(VAULT_CHECK_TEXT));
  return { k: VAULT_META_KEY, v: VAULT_META_V, id, checkIv: bytesToB64(checkIv), check: bytesToB64(new Uint8Array(check)), created: now };
}
// Coffre créé (témoin écrit) ; une création commencée sans aboutir n'a que { id, pending }
function vaultReady(meta) { return !!(meta && meta.id && meta.check); }
// Clé rendue par le trousseau : vraie clé de ce coffre ?
async function vaultCheckKey(meta, dek) {
  try {
    const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(meta.checkIv) }, dek, b64ToBytes(meta.check));
    return vaultDec.decode(out) === VAULT_CHECK_TEXT;
  } catch { return false; }
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

// ── Opérations du coffre (IndexedDB et trousseau) ───────────
// Coffre utilisable ici : module natif (trousseau) et WebCrypto
function vaultAvailable() { return Native.vault.available && vaultCryptoOk(); }
function vaultMeta() { return photoMetaGet(VAULT_META_KEY); }

// Photos en clair de l'ancienne base : chiffrées dans le coffre, vérifiées, puis l'ancienne base est
// supprimée. Rejouable : interrompue, elle reprend à la prochaine ouverture (même identifiant = même ligne).
async function vaultMigrate(dek) {
  const legacy = await legacyPhotosAll();
  if (!legacy.length) { await legacyPhotosDrop(); return 0; }
  for (const p of legacy) await photoPutRow(await photoSeal(dek, p));
  const have = new Set((await photoRowsAll()).map(r => r.id));
  if (legacy.every(p => have.has(p.id))) await legacyPhotosDrop();
  return legacy.length;
}

// Échec d'iOS ({ canceled }, { missing }, { nopasscode }, { failed }) rendu tel quel, avec ok: false
const vaultRefused = r => ({ ok: false, ...(r && !r.key ? r : { failed: true }) });

// Création : identifiant écrit d'abord (une création interrompue reprend la même clé au lieu d'en laisser une
// orpheline dans le trousseau iCloud), clé tirée par iOS après Face ID (ou le code), réglages complétés, puis
// migration (une coupure est rattrapée à l'ouverture suivante). { ok, migrated } ou l'échec d'iOS.
async function vaultSetup(reason = 'Créer ton coffre à photos') {
  const prev = await vaultMeta();
  if (vaultReady(prev)) throw new Error('coffre déjà créé');
  const epoch = vaultEpoch;
  const id = prev?.id || vaultNewId();
  if (!prev?.id) await photoMetaPut({ k: VAULT_META_KEY, v: VAULT_META_V, id, pending: true });
  const r = await Native.vault.create(reason, id);
  if (!r?.key) return vaultRefused(r);
  const dek = await vaultImportKey(r.key);
  if (!dek) return { ok: false, failed: true };
  await photoMetaPut(await vaultCreateMeta(dek, id));
  const migrated = await vaultMigrate(dek).catch(() => 0);   // échec (stockage plein) : reprise à l'ouverture
  if (epoch !== vaultEpoch) return { ok: false, stale: true, migrated };   // refermé pendant Face ID : créé, resté fermé
  vaultSetOpen(dek);
  return { ok: true, migrated };
}
// Ouverture : Face ID (ou le code) puis clé du trousseau, vérifiée par le témoin. { ok } ou l'échec d'iOS ;
// { missing } : clé pas (encore) sur cet iPhone, ou qui ne correspond pas au témoin. Jamais de nouvelle clé ici.
// epoch : relevé AVANT la feuille d'iOS (un verrouillage pendant la feuille doit annuler l'ouverture).
async function vaultUnlock(reason = 'Ouvrir ton coffre à photos', epoch = vaultEpoch) {
  const meta = await vaultMeta();
  if (!vaultReady(meta)) return { ok: false, failed: true };
  const r = await Native.vault.unlock(reason, meta.id);
  if (!r?.key) return vaultRefused(r);
  const dek = await vaultImportKey(r.key);
  if (!dek || !(await vaultCheckKey(meta, dek))) return { ok: false, missing: true };
  await vaultMigrate(dek).catch(() => 0);
  if (epoch !== vaultEpoch) return { ok: false, stale: true };
  vaultSetOpen(dek);
  return { ok: true };
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
// Coffre vidé : photos, réglages et clé du trousseau (donc de tous les appareils du trousseau iCloud).
// Coffre illisible ici (keep) : la clé n'est pas touchée (absente ici ; un autre iPhone peut encore en avoir
// besoin) et des photos en clair pas encore rangées iront dans le prochain coffre.
async function vaultReset({ keep = false } = {}) {
  vaultLock('reset');
  const id = (await vaultMeta().catch(() => null))?.id;
  const ok = await photosWipe({ legacy: !keep });
  if (!keep) await Native.vault.forget(id);
  return ok;
}
// Photos en attente de migration (présentation : « tes 4 photos y seront rangées »)
async function vaultLegacyCount() { try { return (await legacyPhotosAll()).length; } catch { return 0; } }
