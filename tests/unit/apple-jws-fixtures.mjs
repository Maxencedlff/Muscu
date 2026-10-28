// Fabrique de chaînes de certificats X.509 et de JWS, pour tester VRAIMENT la vérification de
// signature d'Apple (supabase/functions/_shared/apple-jws.js) sans dépendre d'une transaction réelle.
//
// On ne peut pas fabriquer un JWS signé par Apple : on fabrique donc notre propre autorité racine, et
// on la donne au vérificateur par `rootDer`. C'est ce que fait la vraie vie à l'envers : en production
// la racine est épinglée dans le code, et un test vérifie qu'une chaîne fabriquée ici est refusée
// (bad_root) face à la vraie racine d'Apple.
//
// Tout est écrit à la main (encodeur DER minimal + WebCrypto) : aucune dépendance npm, le test tourne
// avec le seul Node.

const cat = (parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const u8 = (...n) => new Uint8Array(n);

function lengthBytes(n) {
  if (n < 128) return [n];
  const b = [];
  let x = n;
  while (x > 0) { b.unshift(x & 0xff); x >>= 8; }
  return [0x80 | b.length, ...b];
}
const tag = (t, body) => cat([u8(t, ...lengthBytes(body.length)), body]);
const seq = (...parts) => tag(0x30, cat(parts));
const setOf = (...parts) => tag(0x31, cat(parts));
const bool = (v) => tag(0x01, u8(v ? 0xff : 0x00));
const nul = () => tag(0x05, new Uint8Array(0));
const octets = (b) => tag(0x04, b);
const bitstring = (b) => tag(0x03, cat([u8(0), b]));
const utf8 = (s) => tag(0x0c, new TextEncoder().encode(s));
const explicit = (n, body) => tag(0xa0 | n, body);

function integer(n) {
  const b = [];
  let x = BigInt(n);
  if (x === 0n) b.push(0);
  while (x > 0n) { b.unshift(Number(x & 0xffn)); x >>= 8n; }
  if (b[0] & 0x80) b.unshift(0);
  return tag(0x02, new Uint8Array(b));
}
const integerFrom = (bytes) => {
  let b = bytes;
  while (b.length > 1 && b[0] === 0) b = b.subarray(1);
  return tag(0x02, b[0] & 0x80 ? cat([u8(0), b]) : b);
};

function oid(dotted) {
  const p = dotted.split('.').map(Number);
  const out = [p[0] * 40 + p[1]];
  for (const v of p.slice(2)) {
    const bs = [];
    let x = v;
    do { bs.unshift(x & 0x7f); x >>= 7; } while (x > 0);
    for (let i = 0; i < bs.length - 1; i++) bs[i] |= 0x80;
    out.push(...bs);
  }
  return tag(0x06, new Uint8Array(out));
}

const pad = (n, w) => String(n).padStart(w, '0');
function utcTime(ms) {
  const d = new Date(ms);
  const s = `${pad(d.getUTCFullYear() % 100, 2)}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`
    + `${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${pad(d.getUTCSeconds(), 2)}Z`;
  return tag(0x17, new TextEncoder().encode(s));
}

const name = (cn) => seq(setOf(seq(oid('2.5.4.3'), utf8(cn))));
const SIG_OID = { 'SHA-256': '1.2.840.10045.4.3.2', 'SHA-384': '1.2.840.10045.4.3.3' };
export const APPLE_INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1';
export const APPLE_RECEIPT_SIGNER_OID = '1.2.840.113635.100.6.11.1';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

// Signature ECDSA brute (r || s) → DER SEQUENCE { r, s }
function rawToDer(raw) {
  const half = raw.length / 2;
  return seq(integerFrom(raw.subarray(0, half)), integerFrom(raw.subarray(half)));
}

export async function newKey(curve = 'P-256') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, ['sign', 'verify']);
  return { ...pair, spki: new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)) };
}

// Certificat X.509 signé par issuer (ou par lui-même si issuer est absent).
// oids : extensions supplémentaires, présentes mais vides (seule leur présence est vérifiée).
export async function makeCert({
  cn, issuerCn = cn, key, issuerKey = key, hash = 'SHA-256',
  notBefore = Date.now() - 86400_000, notAfter = Date.now() + 86400_000,
  ca = false, oids = [], serial = 1,
}) {
  const extensions = [];
  if (ca) extensions.push(seq(oid('2.5.29.19'), bool(true), octets(seq(bool(true)))));
  for (const o of oids) extensions.push(seq(oid(o), octets(nul())));
  const tbs = seq(
    explicit(0, integer(2)),
    integer(serial),
    seq(oid(SIG_OID[hash])),
    name(issuerCn),
    seq(utcTime(notBefore), utcTime(notAfter)),
    name(cn),
    key.spki,
    ...(extensions.length ? [explicit(3, seq(...extensions))] : []),
  );
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash }, issuerKey.privateKey, tbs));
  return seq(tbs, seq(oid(SIG_OID[hash])), bitstring(rawToDer(raw)));
}

// Chaîne complète racine → intermédiaire → feuille, comme celle d'Apple (3 certificats).
// Les options permettent de casser exactement un maillon par test.
export async function makeChain({
  nowMs = Date.now(),
  leafNotBefore, leafNotAfter,
  leafOids = [APPLE_RECEIPT_SIGNER_OID],
  interOids = [APPLE_INTERMEDIATE_OID],
  interCa = true, leafCa = false,
  leafIssuerCn = 'Test Intermediate',
  leafSignedBy = 'inter',          // 'inter' | 'root' | 'stranger'
  interSignedBy = 'root',          // 'root' | 'stranger'
} = {}) {
  const root = await newKey();
  const inter = await newKey();
  const leaf = await newKey();
  const stranger = await newKey();
  // Racine et intermédiaire largement valables : seuls les tests sur la feuille jouent sur les dates
  const wide = { notBefore: nowMs - 365 * 86400_000, notAfter: nowMs + 365 * 86400_000 };
  const rootDer = await makeCert({ cn: 'Test Root CA', key: root, ca: true, serial: 1, ...wide });
  const interDer = await makeCert({
    cn: 'Test Intermediate', issuerCn: 'Test Root CA', key: inter,
    issuerKey: interSignedBy === 'root' ? root : stranger,
    ca: interCa, oids: interOids, serial: 2, ...wide,
  });
  const leafDer = await makeCert({
    cn: 'Test Leaf', issuerCn: leafIssuerCn, key: leaf,
    issuerKey: leafSignedBy === 'inter' ? inter : leafSignedBy === 'root' ? root : stranger,
    ca: leafCa, oids: leafOids, serial: 3,
    notBefore: leafNotBefore ?? nowMs - 86400_000, notAfter: leafNotAfter ?? nowMs + 86400_000,
  });
  return { rootDer, interDer, leafDer, leafKey: leaf, x5c: [b64(leafDer), b64(interDer), b64(rootDer)] };
}

// JWS compact signé par la feuille de la chaîne
export async function makeJws(payload, chain, { alg = 'ES256', x5c = chain.x5c, signWith = chain.leafKey, tamper = false } = {}) {
  const head = b64url(new TextEncoder().encode(JSON.stringify(x5c === null ? { alg } : { alg, x5c })));
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signWith.privateKey,
    new TextEncoder().encode(`${head}.${body}`)));
  const signature = b64url(raw);
  if (!tamper) return `${head}.${body}.${signature}`;
  // Charge utile changée après la signature : c'est exactement ce qu'un tricheur ferait
  const falsified = b64url(new TextEncoder().encode(JSON.stringify({ ...payload, productId: 'com.mdlf.training.access.gift' })));
  return `${head}.${falsified}.${signature}`;
}

// Transaction StoreKit 2 plausible (champs utiles seulement)
export function transactionPayload(over = {}) {
  const now = Date.now();
  return {
    transactionId: '2000000900000001',
    originalTransactionId: '2000000900000001',
    bundleId: 'com.mdlf.training',
    productId: 'com.mdlf.training.pro.monthly',
    type: 'Auto-Renewable Subscription',
    inAppOwnershipType: 'PURCHASED',
    purchaseDate: now - 1000,
    originalPurchaseDate: now - 1000,
    expiresDate: now + 30 * 86400_000,
    environment: 'Production',
    ...over,
  };
}

// Notification V2 plausible
export function notificationPayload(over = {}, dataOver = {}) {
  return {
    notificationType: 'DID_RENEW',
    notificationUUID: '00000000-0000-4000-8000-000000000001',
    version: '2.0',
    signedDate: Date.now(),
    ...over,
    data: {
      bundleId: 'com.mdlf.training',
      environment: 'Production',
      appAppleId: 1234567890,
      ...dataOver,
    },
  };
}

// renewalInfo d'une notification V2 (champs utiles seulement). gracePeriodExpiresDate n'existe QUE là.
export function renewalPayload(over = {}) {
  return {
    originalTransactionId: '2000000900000001',
    productId: 'com.mdlf.training.pro.monthly',
    autoRenewProductId: 'com.mdlf.training.pro.monthly',
    autoRenewStatus: 1,
    environment: 'Production',
    signedDate: Date.now(),
    ...over,
  };
}

