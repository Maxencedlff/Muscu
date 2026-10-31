// Vérification VRAIE d'un JWS signé par Apple (transactions StoreKit 2 et App Store Server
// Notifications V2), logique pure sans réseau : appliquée par les fonctions Edge verify-purchase et
// appstore-notify (Deno) et testée par tests/unit/payant.mjs (Node). Contrat : docs/PAYANT_V1.md.
//
// Décoder la charge utile ne prouve RIEN : n'importe qui peut fabriquer un JWS et écrire ce qu'il veut
// dedans. C'est la signature qui fait foi, et elle n'est crue qu'après toute cette suite :
//  1. En-tête : alg = ES256 et x5c = exactement 3 certificats (feuille, intermédiaire, racine).
//  2. La racine du JWS doit être, octet pour octet, le certificat Apple Root CA G3 épinglé plus bas
//     (empreinte SHA-256 63:34:3A:BF…, publiée par Apple). Une autre racine, même valable pour un
//     navigateur, est refusée : on ne fait pas confiance au magasin de certificats du système.
//  3. Chaînage : l'émetteur de la feuille est le sujet de l'intermédiaire, l'émetteur de
//     l'intermédiaire est le sujet de la racine (comparaison des octets DER des noms, pas du texte).
//  4. Dates : les trois certificats sont valables à l'instant donné (notBefore ≤ maintenant ≤ notAfter).
//  5. Contraintes de base : racine et intermédiaire sont des autorités (basicConstraints CA:TRUE), la
//     feuille non. Sans cette règle, une feuille pourrait en signer une autre.
//  6. Marqueurs d'Apple (mêmes OID que la bibliothèque officielle app-store-server-library) :
//     l'intermédiaire porte 1.2.840.113635.100.6.2.1 et la feuille 1.2.840.113635.100.6.11.1
//     (« receipt signing »). Sans eux, n'importe quel certificat de développeur délivré par Apple
//     (donc par la même racine) pourrait signer une fausse transaction.
//  7. Signatures ECDSA vérifiées une par une avec WebCrypto : intermédiaire par la clé de la racine,
//     feuille par la clé de l'intermédiaire, puis le JWS par la clé de la feuille.
//  8. Seulement alors la charge utile est lue (JSON).
//
// Choix pris (notés dans docs/PAYANT_V1.md) :
// - ECDSA seulement (P-256, P-384, P-521 ; SHA-256/384/512). La chaîne d'Apple est entièrement
//   elliptique : refuser RSA retire du code et des pièges plutôt que de la sécurité.
// - Pas de contrôle de révocation (OCSP, CRL) : il demanderait un appel réseau à chaque vérification.
//   La révocation d'une transaction, elle, est vue : verify-purchase relit la transaction auprès de
//   l'App Store Server API, et Apple prévient par notification (REFUND, REVOKE).
// - Toutes les erreurs sont rendues en clair (bad_root, bad_chain, cert_expired…) pour les tests et les
//   journaux ; les fonctions Edge n'en renvoient qu'un seul code à l'app (invalid_jws), pour ne rien
//   apprendre à quelqu'un qui cherche à fabriquer un JWS.

// Apple Root CA G3, DER en base64 (https://www.apple.com/certificateauthority/AppleRootCA-G3.cer).
// SHA-256 : 63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179.
export const APPLE_ROOT_CA_G3_B64 =
  'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYD'
  + 'VQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN'
  + 'MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFw'
  + 'cGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49'
  + 'AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA'
  + '/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr'
  + 'MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZL'
  + 'uN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM'
  + '6BgD56KyKA==';

const OID = {
  ecPublicKey: '1.2.840.10045.2.1',
  p256: '1.2.840.10045.3.1.7',
  p384: '1.3.132.0.34',
  p521: '1.3.132.0.35',
  ecdsaSha256: '1.2.840.10045.4.3.2',
  ecdsaSha384: '1.2.840.10045.4.3.3',
  ecdsaSha512: '1.2.840.10045.4.3.4',
  basicConstraints: '2.5.29.19',
  appleIntermediate: '1.2.840.113635.100.6.2.1',
  appleReceiptSigner: '1.2.840.113635.100.6.11.1',
};
const CURVES = {
  [OID.p256]: { name: 'P-256', size: 32 },
  [OID.p384]: { name: 'P-384', size: 48 },
  [OID.p521]: { name: 'P-521', size: 66 },
};
const HASHES = { [OID.ecdsaSha256]: 'SHA-256', [OID.ecdsaSha384]: 'SHA-384', [OID.ecdsaSha512]: 'SHA-512' };

// Une erreur de vérification : jamais une exception qui remonterait jusqu'à l'app
class JwsError extends Error {}
const fail = (code) => { throw new JwsError(code); };

// ── Octets ───────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// base64 standard (x5c) ou base64url (JWS) → octets. Caractère inconnu, longueur impossible : erreur.
export function b64ToBytes(s, { url = false } = {}) {
  if (typeof s !== 'string') fail('malformed');
  const t = (url ? s.replace(/-/g, '+').replace(/_/g, '/') : s).replace(/[\s=]/g, '');
  if (!t.length || /[^A-Za-z0-9+/]/.test(t) || t.length % 4 === 1) fail('malformed');
  const out = new Uint8Array((t.length * 3) >> 2);
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (const ch of t) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, n);
}

const bytesEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const textOf = (u8) => new TextDecoder().decode(u8);

// JSON d'une partie de JWS : objet, ou erreur
function jsonOf(u8, code) {
  let v;
  try { v = JSON.parse(textOf(u8)); } catch { fail(code); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(code);
  return v;
}

// ── DER (ASN.1) ──────────────────────────────────────────

// Un bloc tag-longueur-valeur à la position pos : { tag, head, body, end }
function tlv(buf, pos) {
  if (pos + 2 > buf.length) fail('der');
  const tag = buf[pos];
  let i = pos + 1;
  let len = buf[i++];
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || i + n > buf.length) fail('der');
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + buf[i++];
  }
  const end = i + len;
  if (end > buf.length) fail('der');
  return { tag, head: pos, body: i, end };
}

// Les blocs contenus dans un bloc constructé
function kids(buf, node) {
  const out = [];
  let p = node.body;
  while (p < node.end) { const k = tlv(buf, p); out.push(k); p = k.end; }
  return out;
}

const raw = (buf, node) => buf.subarray(node.head, node.end);

// OID → forme pointée (1.2.840.10045.4.3.2)
function oidOf(buf, node) {
  if (node.tag !== 0x06 || node.end === node.body) fail('der');
  const b = buf.subarray(node.body, node.end);
  const parts = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) { parts.push(v); v = 0; }
  }
  return parts.join('.');
}

// UTCTime (YYMMDDHHMMSSZ) ou GeneralizedTime (YYYYMMDDHHMMSSZ) → ms depuis 1970
function timeOf(buf, node) {
  const s = textOf(buf.subarray(node.body, node.end));
  const m = node.tag === 0x17
    ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s)
    : node.tag === 0x18 ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s) : null;
  if (!m) fail('der');
  const year = node.tag === 0x17 ? (Number(m[1]) >= 50 ? 1900 + Number(m[1]) : 2000 + Number(m[1])) : Number(m[1]);
  return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

// Certificat X.509 (DER) → ce dont la vérification a besoin.
// Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue BIT STRING }
export function parseCertificate(der) {
  if (!(der instanceof Uint8Array)) fail('malformed');
  const cert = tlv(der, 0);
  if (cert.tag !== 0x30) fail('der');
  const [tbsNode, algNode, sigNode] = kids(der, cert);
  if (!tbsNode || !algNode || !sigNode || tbsNode.tag !== 0x30 || sigNode.tag !== 0x03) fail('der');
  const sigHash = HASHES[oidOf(der, kids(der, algNode)[0])];
  if (!sigHash) fail('bad_sig_alg');
  // BIT STRING : le premier octet compte les bits inutilisés (0 pour une signature)
  if (der[sigNode.body] !== 0) fail('der');

  const t = kids(der, tbsNode);
  let i = t[0] && t[0].tag === 0xa0 ? 1 : 0;   // [0] version, absente en v1
  i++;                                        // serialNumber
  i++;                                        // signature (répétée dans le TBS)
  const issuer = t[i++];
  const validity = t[i++];
  const subject = t[i++];
  const spkiNode = t[i++];
  if (!issuer || !validity || !subject || !spkiNode) fail('der');
  const [nb, na] = kids(der, validity);
  if (!nb || !na) fail('der');

  // SubjectPublicKeyInfo ::= SEQUENCE { AlgorithmIdentifier { id-ecPublicKey, namedCurve }, BIT STRING }
  const spkiAlg = kids(der, kids(der, spkiNode)[0]);
  if (oidOf(der, spkiAlg[0]) !== OID.ecPublicKey) fail('bad_key_alg');
  const curve = CURVES[oidOf(der, spkiAlg[1])];
  if (!curve) fail('bad_curve');

  // Extensions : [3] EXPLICIT SEQUENCE OF Extension { extnID, critical DEFAULT false, extnValue }
  const exts = new Map();
  const extWrap = t.slice(i).find((n) => n.tag === 0xa3);
  if (extWrap) {
    for (const e of kids(der, kids(der, extWrap)[0])) {
      const parts = kids(der, e);
      const id = oidOf(der, parts[0]);
      const value = parts[parts.length - 1];
      exts.set(id, { critical: parts.length === 3 && der[parts[1].body] !== 0, value: der.subarray(value.body, value.end) });
    }
  }
  // basicConstraints ::= SEQUENCE { cA BOOLEAN DEFAULT FALSE, pathLenConstraint INTEGER OPTIONAL }
  let ca = false;
  const bc = exts.get(OID.basicConstraints);
  if (bc) {
    const inner = kids(bc.value, tlv(bc.value, 0))[0];
    ca = !!inner && inner.tag === 0x01 && bc.value[inner.body] !== 0;
  }

  return {
    der,
    tbs: raw(der, tbsNode),
    issuer: raw(der, issuer),
    subject: raw(der, subject),
    notBefore: timeOf(der, nb),
    notAfter: timeOf(der, na),
    spki: raw(der, spkiNode),
    curve,
    sigHash,
    signature: der.subarray(sigNode.body + 1, sigNode.end),
    extensions: exts,
    ca,
  };
}

// Signature ECDSA au format DER (SEQUENCE { r, s }) → r || s de taille fixe, attendu par WebCrypto
function ecdsaDerToRaw(sig, size) {
  const seq = tlv(sig, 0);
  if (seq.tag !== 0x30) fail('der');
  const [r, s] = kids(sig, seq);
  if (!r || !s || r.tag !== 0x02 || s.tag !== 0x02) fail('der');
  const out = new Uint8Array(size * 2);
  for (const [node, at] of [[r, 0], [s, size]]) {
    let b = sig.subarray(node.body, node.end);
    while (b.length > 1 && b[0] === 0) b = b.subarray(1);
    if (b.length > size) fail('der');
    out.set(b, at + size - b.length);
  }
  return out;
}

const importKey = (cert) => crypto.subtle.importKey('spki', cert.spki, { name: 'ECDSA', namedCurve: cert.curve.name }, false, ['verify']);

// cert est-il bien signé par issuer ?
async function signedBy(cert, issuer) {
  const key = await importKey(issuer);
  const sig = ecdsaDerToRaw(cert.signature, issuer.curve.size);
  return crypto.subtle.verify({ name: 'ECDSA', hash: cert.sigHash }, key, sig, cert.tbs);
}

// ── Chaîne et JWS ────────────────────────────────────────

// Chaîne x5c (base64 standard, du plus proche au plus lointain) vérifiée jusqu'à la racine épinglée.
// Renvoie le certificat de la feuille. Lève une JwsError sinon.
export async function verifyAppleChain(x5c, { rootDer, nowMs }) {
  if (!Array.isArray(x5c) || x5c.length !== 3) fail('bad_chain_length');
  const [leaf, inter, root] = x5c.map((b64) => parseCertificate(b64ToBytes(b64)));

  // 2. La racine est, octet pour octet, celle d'Apple (ou celle qu'on a explicitement épinglée)
  if (!bytesEqual(root.der, rootDer)) fail('bad_root');
  // 4. Dates
  for (const c of [leaf, inter, root]) {
    if (!(nowMs >= c.notBefore && nowMs <= c.notAfter)) fail('cert_expired');
  }
  // 3. Chaînage par les octets DER des noms
  if (!bytesEqual(leaf.issuer, inter.subject) || !bytesEqual(inter.issuer, root.subject)) fail('bad_chain');
  // 5. Autorités seulement au-dessus de la feuille
  if (!root.ca || !inter.ca) fail('bad_ca');
  if (leaf.ca) fail('leaf_is_ca');
  // 6. Marqueurs d'Apple
  if (!inter.extensions.has(OID.appleIntermediate)) fail('bad_intermediate_oid');
  if (!leaf.extensions.has(OID.appleReceiptSigner)) fail('bad_leaf_oid');
  // 7. Signatures
  if (!await signedBy(inter, root)) fail('bad_chain_signature');
  if (!await signedBy(leaf, inter)) fail('bad_chain_signature');
  return leaf;
}

// JWS compact signé par Apple → { ok: true, header, payload } ou { ok: false, error }.
// rootDer : racine épinglée (Apple Root CA G3 par défaut ; les tests fabriquent la leur).
export async function verifyAppleJws(jws, { rootDer = b64ToBytes(APPLE_ROOT_CA_G3_B64), nowMs = Date.now() } = {}) {
  try {
    if (typeof jws !== 'string' || jws.length > 65536) fail('malformed');
    const parts = jws.split('.');
    if (parts.length !== 3) fail('malformed');
    const header = jsonOf(b64ToBytes(parts[0], { url: true }), 'malformed');
    if (header.alg !== 'ES256') fail('bad_alg');
    const leaf = await verifyAppleChain(header.x5c, { rootDer, nowMs });
    if (leaf.curve.name !== 'P-256') fail('bad_curve');
    // 7 (suite). La charge utile n'est lue qu'après la signature du JWS par la feuille
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await importKey(leaf),
      b64ToBytes(parts[2], { url: true }),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) fail('bad_signature');
    return { ok: true, header, payload: jsonOf(b64ToBytes(parts[1], { url: true }), 'malformed') };
  } catch (e) {
    return { ok: false, error: e instanceof JwsError ? e.message : 'malformed' };
  }
}

// Charge utile lue SANS vérifier la signature : réservée aux journaux et aux messages d'erreur, jamais
// à une décision. Nommée pour qu'une relecture voie tout de suite qu'elle ne prouve rien.
export function unverifiedPayload(jws) {
  try { return jsonOf(b64ToBytes(String(jws).split('.')[1], { url: true }), 'malformed'); } catch { return null; }
}
