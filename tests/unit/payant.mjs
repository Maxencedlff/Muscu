// Payant V1 : logique pure des fonctions serveur verify-purchase et appstore-notify.
// Le cœur de la sécurité est la vérification de la signature d'Apple : elle est testée avec de VRAIS
// JWS fabriqués pour l'occasion (tests/unit/apple-jws-fixtures.mjs), valables et cassés un maillon à
// la fois. Contrat : docs/PAYANT_V1.md.
import fs from 'node:fs';
import path from 'node:path';
import { makeCert, makeChain, makeJws, newKey, notificationPayload, transactionPayload,
  APPLE_RECEIPT_SIGNER_OID, APPLE_INTERMEDIATE_OID } from './apple-jws-fixtures.mjs';

export default function ({ test, assert, sameJSON, ROOT }) {
  const jwsMod = () => import(path.join(ROOT, 'supabase/functions/_shared/apple-jws.js'));
  const policy = () => import(path.join(ROOT, 'supabase/functions/verify-purchase/purchase-policy.js'));
  const notify = () => import(path.join(ROOT, 'supabase/functions/appstore-notify/notify-policy.js'));
  const migration = () => fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261028000000_payant.sql'), 'utf8');
  const contract = () => fs.readFileSync(path.join(ROOT, 'docs/PAYANT_V1.md'), 'utf8');
  const nowMs = Date.UTC(2026, 9, 28, 12, 0, 0);

  // ── Signature d'Apple : ce qui doit passer ──────────────

  test('apple-jws : un JWS correctement signé passe, et sa charge utile est rendue', async () => {
    const { verifyAppleJws } = await jwsMod();
    const chain = await makeChain({ nowMs });
    const payload = transactionPayload();
    const r = await verifyAppleJws(await makeJws(payload, chain), { rootDer: chain.rootDer, nowMs });
    assert.equal(r.ok, true, r.error);
    sameJSON(r.payload, payload);
    assert.equal(r.header.alg, 'ES256');
  });

  test('apple-jws : la racine épinglée est bien Apple Root CA G3', async () => {
    const { APPLE_ROOT_CA_G3_B64, b64ToBytes, parseCertificate } = await jwsMod();
    const der = b64ToBytes(APPLE_ROOT_CA_G3_B64);
    const digest = Buffer.from(await crypto.subtle.digest('SHA-256', der)).toString('hex');
    // Empreinte publiée par Apple (https://www.apple.com/certificateauthority/)
    assert.equal(digest, '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179');
    const root = parseCertificate(der);
    assert.equal(root.ca, true, 'la racine doit être une autorité');
    assert.equal(root.curve.name, 'P-384');
    assert.ok(root.notAfter > Date.now(), 'la racine épinglée est périmée : à remplacer');
    // L'empreinte est aussi écrite dans le code et dans le contrat, pour pouvoir la revérifier à la main
    assert.ok(fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/apple-jws.js'), 'utf8')
      .includes(digest.toUpperCase()), 'empreinte absente du code');
    assert.ok(contract().includes('Apple Root CA G3'), 'racine absente du contrat');
  });

  // ── Signature d'Apple : ce qui doit être refusé ─────────

  test('apple-jws : charge utile modifiée après la signature → bad_signature', async () => {
    const { verifyAppleJws } = await jwsMod();
    const chain = await makeChain({ nowMs });
    const jws = await makeJws(transactionPayload(), chain, { tamper: true });
    const r = await verifyAppleJws(jws, { rootDer: chain.rootDer, nowMs });
    sameJSON(r, { ok: false, error: 'bad_signature' });
    // Le décodage seul, lui, aurait tout gobé : c'est bien pour cela qu'il ne décide de rien
    const { unverifiedPayload } = await jwsMod();
    assert.equal(unverifiedPayload(jws).productId, 'com.mdlf.training.access.gift');
  });

  test('apple-jws : chaîne fabriquée face à la vraie racine Apple → bad_root', async () => {
    const { verifyAppleJws } = await jwsMod();
    const chain = await makeChain({ nowMs });
    // Aucune racine donnée : celle d'Apple, épinglée, est utilisée
    const r = await verifyAppleJws(await makeJws(transactionPayload(), chain), { nowMs });
    sameJSON(r, { ok: false, error: 'bad_root' });
    // Même en glissant une autre racine valable pour un navigateur : c'est la comparaison octet
    // pour octet avec celle d'Apple qui décide
    const other = await makeChain({ nowMs });
    const mixed = await makeJws(transactionPayload(), chain, { x5c: [chain.x5c[0], chain.x5c[1], other.x5c[2]] });
    sameJSON(await verifyAppleJws(mixed, { nowMs }), { ok: false, error: 'bad_root' });
  });

  test('apple-jws : certificat non signé par l\'autorité au-dessus → bad_chain_signature', async () => {
    const { verifyAppleJws } = await jwsMod();
    const noLeaf = await makeChain({ nowMs, leafSignedBy: 'stranger' });
    sameJSON(await verifyAppleJws(await makeJws(transactionPayload(), noLeaf), { rootDer: noLeaf.rootDer, nowMs }),
      { ok: false, error: 'bad_chain_signature' });
    const noInter = await makeChain({ nowMs, interSignedBy: 'stranger' });
    sameJSON(await verifyAppleJws(await makeJws(transactionPayload(), noInter), { rootDer: noInter.rootDer, nowMs }),
      { ok: false, error: 'bad_chain_signature' });
    // Une feuille signée directement par la racine ne chaîne plus avec l'intermédiaire annoncé
    const short = await makeChain({ nowMs, leafSignedBy: 'root' });
    sameJSON(await verifyAppleJws(await makeJws(transactionPayload(), short), { rootDer: short.rootDer, nowMs }),
      { ok: false, error: 'bad_chain_signature' });
  });

  test('apple-jws : émetteur qui ne correspond pas au sujet → bad_chain', async () => {
    const { verifyAppleJws } = await jwsMod();
    const chain = await makeChain({ nowMs, leafIssuerCn: 'Quelqu\'un d\'autre' });
    sameJSON(await verifyAppleJws(await makeJws(transactionPayload(), chain), { rootDer: chain.rootDer, nowMs }),
      { ok: false, error: 'bad_chain' });
  });

  test('apple-jws : certificat périmé ou pas encore valable → cert_expired', async () => {
    const { verifyAppleJws } = await jwsMod();
    const old = await makeChain({ nowMs, leafNotBefore: nowMs - 10 * 86400_000, leafNotAfter: nowMs - 86400_000 });
    sameJSON(await verifyAppleJws(await makeJws(transactionPayload(), old), { rootDer: old.rootDer, nowMs }),
      { ok: false, error: 'cert_expired' });
    const soon = await makeChain({ nowMs, leafNotBefore: nowMs + 86400_000, leafNotAfter: nowMs + 10 * 86400_000 });
    sameJSON(await verifyAppleJws(await makeJws(transactionPayload(), soon), { rootDer: soon.rootDer, nowMs }),
      { ok: false, error: 'cert_expired' });
    // La même chaîne, vue à une date où la feuille était valable, passe
    assert.equal((await verifyAppleJws(await makeJws(transactionPayload(), old), { rootDer: old.rootDer, nowMs: nowMs - 2 * 86400_000 })).ok, true);
  });

  test('apple-jws : marqueurs d\'Apple obligatoires (un certificat de développeur ne signe rien)', async () => {
    const { verifyAppleJws } = await jwsMod();
    const noLeafOid = await makeChain({ nowMs, leafOids: [] });
    sameJSON(await verifyAppleJws(await makeJws(transactionPayload(), noLeafOid), { rootDer: noLeafOid.rootDer, nowMs }),
      { ok: false, error: 'bad_leaf_oid' });
    const wrongOid = await makeChain({ nowMs, leafOids: ['1.2.840.113635.100.6.1.2'] });
    sameJSON(await verifyAppleJws(await makeJws(transactionPayload(), wrongOid), { rootDer: wrongOid.rootDer, nowMs }),
      { ok: false, error: 'bad_leaf_oid' });
    const noInterOid = await makeChain({ nowMs, interOids: [] });
    sameJSON(await verifyAppleJws(await makeJws(transactionPayload(), noInterOid), { rootDer: noInterOid.rootDer, nowMs }),
      { ok: false, error: 'bad_intermediate_oid' });
    // Les deux OID sont ceux de la bibliothèque officielle d'Apple
    const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/apple-jws.js'), 'utf8');
    for (const o of [APPLE_RECEIPT_SIGNER_OID, APPLE_INTERMEDIATE_OID]) assert.ok(src.includes(o), o);
  });

  test('apple-jws : contraintes de base (une feuille ne peut pas être une autorité)', async () => {
    const { verifyAppleJws } = await jwsMod();
    const notCa = await makeChain({ nowMs, interCa: false });
    sameJSON(await verifyAppleJws(await makeJws(transactionPayload(), notCa), { rootDer: notCa.rootDer, nowMs }),
      { ok: false, error: 'bad_ca' });
    const leafCa = await makeChain({ nowMs, leafCa: true });
    sameJSON(await verifyAppleJws(await makeJws(transactionPayload(), leafCa), { rootDer: leafCa.rootDer, nowMs }),
      { ok: false, error: 'leaf_is_ca' });
  });

  test('apple-jws : en-tête et forme du JWS', async () => {
    const { verifyAppleJws } = await jwsMod();
    const chain = await makeChain({ nowMs });
    const opts = { rootDer: chain.rootDer, nowMs };
    const payload = transactionPayload();
    for (const alg of ['none', 'HS256', 'ES384', 'RS256', '']) {
      sameJSON(await verifyAppleJws(await makeJws(payload, chain, { alg }), opts), { ok: false, error: 'bad_alg' }, alg);
    }
    sameJSON(await verifyAppleJws(await makeJws(payload, chain, { x5c: null }), opts), { ok: false, error: 'bad_chain_length' }, 'sans x5c');
    sameJSON(await verifyAppleJws(await makeJws(payload, chain, { x5c: chain.x5c.slice(0, 2) }), opts), { ok: false, error: 'bad_chain_length' }, '2 certificats');
    sameJSON(await verifyAppleJws(await makeJws(payload, chain, { x5c: [...chain.x5c, chain.x5c[2]] }), opts), { ok: false, error: 'bad_chain_length' }, '4 certificats');
    for (const bad of ['', 'a.b', 'a.b.c.d', 'pas du tout un jws', '!!!.!!!.!!!', null, 42, {}]) {
      assert.equal((await verifyAppleJws(bad, opts)).ok, false, String(bad));
    }
    sameJSON(await verifyAppleJws('a.b.c', opts), { ok: false, error: 'malformed' });
    // x5c qui n'est pas du base64 de certificat : refusé sans exception
    sameJSON(await verifyAppleJws(await makeJws(payload, chain, { x5c: ['Zm9v', 'Zm9v', 'Zm9v'] }), opts), { ok: false, error: 'der' });
  });

  test('apple-jws : une feuille P-384 ne peut pas signer un ES256', async () => {
    const { verifyAppleJws } = await jwsMod();
    const root = await newKey();
    const inter = await newKey();
    const leaf = await newKey('P-384');
    const rootDer = await makeCert({ cn: 'Test Root CA', key: root, ca: true, notBefore: nowMs - 1e6, notAfter: nowMs + 1e9 });
    const interDer = await makeCert({ cn: 'Test Intermediate', issuerCn: 'Test Root CA', key: inter, issuerKey: root,
      ca: true, oids: [APPLE_INTERMEDIATE_OID], notBefore: nowMs - 1e6, notAfter: nowMs + 1e9 });
    const leafDer = await makeCert({ cn: 'Test Leaf', issuerCn: 'Test Intermediate', key: leaf, issuerKey: inter,
      oids: [APPLE_RECEIPT_SIGNER_OID], notBefore: nowMs - 1e6, notAfter: nowMs + 1e9 });
    const chain = { rootDer, interDer, leafDer, leafKey: leaf, x5c: [leafDer, interDer, rootDer].map((d) => Buffer.from(d).toString('base64')) };
    sameJSON(await verifyAppleJws(await makeJws(transactionPayload(), chain), { rootDer, nowMs }), { ok: false, error: 'bad_curve' });
  });

  // ── Décision sur la transaction (verify-purchase) ───────

  test('verify-purchase : transaction valable → droit d\'accès à écrire', async () => {
    const { transactionDecision } = await policy();
    const r = transactionDecision(transactionPayload({ expiresDate: nowMs + 30 * 86400_000 }), { nowMs });
    sameJSON(r, { ok: true, value: {
      product_id: 'com.mdlf.training.pro.monthly', kind: 'sub',
      expires_at: new Date(nowMs + 30 * 86400_000).toISOString(),
      original_transaction_id: '2000000900000001', transaction_id: '2000000900000001',
      revoked: false, environment: 'Production', expired: false,
    } });
    // Formule annuelle
    assert.equal(transactionDecision(transactionPayload({ productId: 'com.mdlf.training.pro.yearly' }), { nowMs }).value.kind, 'sub');
    // Accès offert : non consommable, sans date de fin
    const gift = transactionDecision(transactionPayload({
      productId: 'com.mdlf.training.access.gift', type: 'Non-Consumable', expiresDate: undefined,
    }), { nowMs });
    assert.equal(gift.value.kind, 'gift');
    assert.equal(gift.value.expires_at, null);
    // Transaction d'origine différente de la transaction courante (renouvellement)
    const renew = transactionDecision(transactionPayload({ transactionId: '2000000900000009' }), { nowMs });
    assert.equal(renew.value.original_transaction_id, '2000000900000001');
    assert.equal(renew.value.transaction_id, '2000000900000009');
  });

  test('verify-purchase : bundleId faux, produit inconnu, type faux, partage familial', async () => {
    const { transactionDecision } = await policy();
    const err = (over) => transactionDecision(transactionPayload(over), { nowMs }).error;
    assert.equal(err({ bundleId: 'com.autre.app' }), 'bad_bundle');
    assert.equal(err({ bundleId: 'com.mdlf.training.pro' }), 'bad_bundle');
    assert.equal(err({ bundleId: undefined }), 'bad_bundle');
    assert.equal(err({ productId: 'com.mdlf.training.pro.weekly' }), 'unknown_product');
    assert.equal(err({ productId: 'toString' }), 'unknown_product', 'clé héritée d\'Object');
    assert.equal(err({ productId: '__proto__' }), 'unknown_product');
    assert.equal(err({ type: 'Consumable' }), 'bad_type');
    assert.equal(err({ type: 'Non-Consumable' }), 'bad_type', 'abonnement annoncé non consommable');
    assert.equal(err({ productId: 'com.mdlf.training.access.gift' }), 'bad_type', 'cadeau annoncé abonnement');
    assert.equal(err({ inAppOwnershipType: 'FAMILY_SHARED' }), 'not_purchased');
    assert.equal(transactionDecision(null, { nowMs }).error, 'invalid_jws');
    assert.equal(transactionDecision([transactionPayload()], { nowMs }).error, 'invalid_jws');
  });

  test('verify-purchase : Sandbox refusé par défaut', async () => {
    const { transactionDecision } = await policy();
    const sandbox = transactionPayload({ environment: 'Sandbox' });
    assert.equal(transactionDecision(sandbox, { nowMs }).error, 'bad_environment');
    assert.equal(transactionDecision(sandbox, { nowMs, allowSandbox: true }).ok, true, 'accepté pendant les essais');
    assert.equal(transactionDecision(transactionPayload({ environment: 'Xcode' }), { nowMs, allowSandbox: true }).error, 'bad_environment');
    assert.equal(transactionDecision(transactionPayload({ environment: undefined }), { nowMs }).error, 'bad_environment');
  });

  test('verify-purchase : transaction mal formée, expirée, remboursée', async () => {
    const { transactionDecision, TRANSACTION_ID_MAX } = await policy();
    const err = (over) => transactionDecision(transactionPayload(over), { nowMs }).error;
    assert.equal(err({ originalTransactionId: '' }), 'invalid_transaction');
    assert.equal(err({ originalTransactionId: null }), 'invalid_transaction');
    assert.equal(err({ originalTransactionId: 2000000900000001 }), 'invalid_transaction', 'un nombre n\'est pas un identifiant');
    assert.equal(err({ originalTransactionId: 'x'.repeat(TRANSACTION_ID_MAX + 1) }), 'invalid_transaction');
    assert.equal(err({ originalTransactionId: 'a b' }), 'invalid_transaction');
    assert.equal(err({ expiresDate: undefined }), 'invalid_transaction', 'abonnement sans fin');
    assert.equal(err({ expiresDate: 'bientôt' }), 'invalid_transaction');
    // Date déjà passée : acceptée (c'est une vraie transaction), mais marquée échue
    const old = transactionDecision(transactionPayload({ expiresDate: nowMs - 86400_000 }), { nowMs });
    assert.equal(old.ok, true);
    assert.equal(old.value.expired, true);
    assert.equal(old.value.revoked, false);
    // Remboursée : écrite comme révoquée, l'accès tombe
    const refunded = transactionDecision(transactionPayload({ revocationDate: nowMs - 3600_000 }), { nowMs });
    assert.equal(refunded.ok, true);
    assert.equal(refunded.value.revoked, true);
  });

  test('verify-purchase : refus de la base → réponse HTTP (transaction déjà prise)', async () => {
    const { purchaseFailure, httpStatus } = await policy();
    sameJSON(purchaseFailure('transaction_taken'), { status: 409, error: 'transaction_taken' });
    sameJSON(purchaseFailure(' transaction_taken '), { status: 409, error: 'transaction_taken' });
    sameJSON(purchaseFailure('rate_limited'), { status: 429, error: 'rate_limited' });
    sameJSON(purchaseFailure('not_found'), { status: 404, error: 'not_found' });
    sameJSON(purchaseFailure('unknown_product'), { status: 400, error: 'unknown_product' });
    sameJSON(purchaseFailure('invalid_transaction'), { status: 400, error: 'invalid_transaction' });
    // Un message qu'on ne connaît pas ne passe JAMAIS pour un succès
    for (const m of ['permission denied for function srv_access_purchase', '', null, 'ok', undefined]) {
      sameJSON(purchaseFailure(m), { status: 500, error: 'write' }, String(m));
    }
    assert.equal(httpStatus('invalid_jws'), 400);
    assert.equal(httpStatus('apple_unreachable'), 503);
    assert.equal(httpStatus('apple_api_unconfigured'), 503);
    assert.equal(httpStatus('autre chose'), 500);
  });

  // ── Notifications d'Apple (appstore-notify) ─────────────

  test('appstore-notify : les sept types du contrat sont traités', async () => {
    const { notificationDecision, HANDLED_TYPES } = await notify();
    sameJSON([...HANDLED_TYPES].sort(), ['DID_CHANGE_RENEWAL_STATUS', 'DID_RENEW', 'EXPIRED', 'GRACE_PERIOD_EXPIRED', 'REFUND', 'REVOKE', 'SUBSCRIBED']);
    // La même liste que le contrat
    const doc = contract();
    for (const t of HANDLED_TYPES) assert.ok(doc.includes(t), `${t} absent du contrat`);
    const until = nowMs + 30 * 86400_000;
    const tx = transactionPayload({ expiresDate: until });
    for (const type of ['SUBSCRIBED', 'DID_RENEW', 'DID_CHANGE_RENEWAL_STATUS']) {
      const r = notificationDecision({ notification: notificationPayload({ notificationType: type }), transaction: tx, nowMs });
      sameJSON(r, { ok: true, handled: true, type, value: {
        original_transaction_id: '2000000900000001', product_id: 'com.mdlf.training.pro.monthly',
        expires_at: new Date(until).toISOString(), revoked: false,
      } }, type);
    }
  });

  test('appstore-notify : expiration ramenée à maintenant, remboursement révoqué', async () => {
    const { notificationDecision } = await notify();
    // Apple envoie parfois EXPIRED avec une date encore dans le futur : on ne laisse rien d'ouvert
    for (const type of ['EXPIRED', 'GRACE_PERIOD_EXPIRED']) {
      const r = notificationDecision({ notification: notificationPayload({ notificationType: type }),
        transaction: transactionPayload({ expiresDate: nowMs + 60_000 }), nowMs });
      assert.equal(r.value.expires_at, new Date(nowMs).toISOString(), type);
      assert.equal(r.value.revoked, false, type);
    }
    // Une expiration déjà passée garde sa date
    const past = notificationDecision({ notification: notificationPayload({ notificationType: 'EXPIRED' }),
      transaction: transactionPayload({ expiresDate: nowMs - 86400_000 }), nowMs });
    assert.equal(past.value.expires_at, new Date(nowMs - 86400_000).toISOString());
    for (const type of ['REFUND', 'REVOKE']) {
      const r = notificationDecision({ notification: notificationPayload({ notificationType: type }),
        transaction: transactionPayload({ expiresDate: nowMs + 86400_000 }), nowMs });
      assert.equal(r.value.revoked, true, type);
    }
    // Un accès offert révoqué passe aussi
    const gift = notificationDecision({ notification: notificationPayload({ notificationType: 'REVOKE' }),
      transaction: transactionPayload({ productId: 'com.mdlf.training.access.gift', type: 'Non-Consumable', expiresDate: undefined }), nowMs });
    sameJSON(gift.value, { original_transaction_id: '2000000900000001', product_id: 'com.mdlf.training.access.gift', expires_at: null, revoked: true });
  });

  test('appstore-notify : types et produits ignorés (200), refus (401 ou 400)', async () => {
    const { notificationDecision } = await notify();
    const tx = transactionPayload();
    for (const type of ['TEST', 'DID_FAIL_TO_RENEW', 'PRICE_INCREASE', 'CONSUMPTION_REQUEST', 'RENEWAL_EXTENDED']) {
      const r = notificationDecision({ notification: notificationPayload({ notificationType: type }), transaction: tx, nowMs });
      sameJSON(r, { ok: true, handled: false, type, reason: 'type_ignored' }, type);
    }
    // Un produit d'une autre app du même compte Apple : accepté et ignoré, jamais une erreur
    const other = notificationDecision({ notification: notificationPayload(), transaction: transactionPayload({ productId: 'com.autre.pro' }), nowMs });
    sameJSON(other, { ok: true, handled: false, type: 'DID_RENEW', reason: 'unknown_product' });
    // Refus
    assert.equal(notificationDecision({ notification: notificationPayload({}, { bundleId: 'com.autre.app' }), transaction: tx, nowMs }).error, 'bad_bundle');
    assert.equal(notificationDecision({ notification: notificationPayload({}, { environment: 'Sandbox' }), transaction: tx, nowMs }).error, 'bad_environment');
    assert.equal(notificationDecision({ notification: notificationPayload({}, { environment: 'Sandbox' }), transaction: transactionPayload({ environment: 'Sandbox' }), nowMs, allowSandbox: true }).ok, true);
    assert.equal(notificationDecision({ notification: null, transaction: tx, nowMs }).error, 'invalid_jws');
    assert.equal(notificationDecision({ notification: { notificationType: 'DID_RENEW' }, transaction: tx, nowMs }).error, 'invalid_jws', 'sans data');
    assert.equal(notificationDecision({ notification: notificationPayload(), transaction: null, nowMs }).error, 'invalid_jws', 'sans transaction');
    assert.equal(notificationDecision({ notification: notificationPayload(), transaction: transactionPayload({ bundleId: 'com.autre.app' }), nowMs }).error, 'bad_bundle', 'transaction d\'une autre app');
  });

  // ── Serveur et app disent la même chose ─────────────────

  test('payant : mêmes produits, mêmes erreurs et mêmes clés que la migration et le contrat', async () => {
    const { PRODUCT_KINDS, BUNDLE_ID, PRODUCT_GIFT } = await policy();
    const sql = migration();
    // Produits et natures : private.access_product_kind doit dire exactement la même chose
    for (const [product, kind] of Object.entries(PRODUCT_KINDS)) {
      assert.ok(new RegExp(`when '${product.replace(/\./g, '\\.')}'\\s+then '${kind}'`).test(sql), `${product} absent de la migration`);
    }
    const inSql = [...sql.matchAll(/when '(com\.mdlf\.training[^']*)'\s+then '(sub|gift)'/g)].map((m) => m[1]);
    sameJSON(inSql.sort(), Object.keys(PRODUCT_KINDS).sort(), 'produits en trop ou en moins côté serveur');
    // Les mêmes identifiants que le contrat
    const doc = contract();
    for (const p of [...Object.keys(PRODUCT_KINDS), BUNDLE_ID]) assert.ok(doc.includes(p), `${p} absent du contrat`);
    assert.equal(PRODUCT_KINDS[PRODUCT_GIFT], 'gift');
    // Les 10 clés de my_access(), côté serveur et côté contrat
    const keys = ['status', 'until', 'paywall_on', 'trial_days', 'days_left', 'can_write', 'gift', 'gift_until', 'coach_team', 'server_now'];
    for (const k of keys) {
      assert.ok(new RegExp(`'${k}',`).test(sql), `clé ${k} absente de private.access_json`);
      assert.ok(doc.includes(k), `clé ${k} absente du contrat`);
    }
    // Erreurs levées par la base, toutes connues de purchaseFailure ou documentées
    const raised = [...new Set([...sql.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]))];
    for (const e of raised) assert.ok(doc.includes(e), `erreur ${e} absente du contrat`);
    // Le verrou est livré éteint, l'essai fait 90 jours
    assert.ok(/\('paywall_on', 'false'::jsonb\)/.test(sql), 'paywall_on livré allumé');
    assert.ok(/\('trial_days', '90'::jsonb\)/.test(sql), 'essai ≠ 90 jours');
  });

  test('payant : codes cadeaux, règles du serveur et du contrat', async () => {
    const sql = migration();
    const doc = contract();
    // Un code ne se devine pas : 10 caractères au moins, alphabet sans 0/O/1/I, imposé par la base
    assert.ok(sql.includes("check (code ~ '^[A-HJ-NP-Z2-9]{10,24}$')"), 'format des codes non imposé');
    assert.ok(/gift_code_norm[\s\S]{0,400}\{10,24\}/.test(sql), 'normalisation sans borne de longueur');
    // Aucune RPC ne crée de code : seule une fonction du schéma private en fabrique
    assert.ok(/create function private\.make_gift_code/.test(sql), 'make_gift_code absente');
    assert.ok(!/create function public\.[a-z_]*gift_code[a-z_]*\(.*\)[\s\S]{0,2000}insert into public\.gift_codes/.test(sql),
      'une RPC publique crée des codes');
    // Les essais ratés sont comptés : le refus est renvoyé, pas levé
    const redeem = sql.slice(sql.indexOf('create function public.redeem_gift_code'));
    const body = redeem.slice(0, redeem.indexOf('\n$$;'));
    assert.ok(/rate_limit_window\(me, 'gift_code', 10, interval '1 hour'\)/.test(body), 'limite de 10 par heure absente');
    for (const e of ['invalid_code', 'code_expired', 'code_used_up', 'already_redeemed']) {
      assert.ok(body.includes(`gift_refused(me, '${e}')`), `${e} n'est pas renvoyé`);
      assert.ok(!body.includes(`raise exception '${e}'`), `${e} est levé : le comptage de l'essai serait annulé`);
      assert.ok(doc.includes(e), `${e} absent du contrat`);
    }
    // La limite est posée avant toute vérification du code
    assert.ok(body.indexOf('rate_limit_window') < body.indexOf('gift_code_norm') + body.length
      && body.indexOf("rate_limit_window(me, 'gift_code'") < body.indexOf('gift_codes k where k.code = c'),
      'le code est lu avant que l\'essai soit compté');
    // Verrou de ligne : pas de course sur max_uses
    assert.ok(/from public\.gift_codes k where k\.code = c for update/.test(body), 'pas de verrou de ligne sur le code');
    assert.ok(doc.includes('Codes cadeaux'), 'section « Codes cadeaux » absente du contrat');
  });

  test('payant : aucune RPC du client n\'écrit un droit d\'accès', async () => {
    const sql = migration();
    // Les deux fonctions qui écrivent sont réservées à service_role
    for (const f of ['srv_access_purchase(uuid, text, timestamptz, text, boolean)', 'srv_access_event(text, text, timestamptz, boolean)']) {
      assert.ok(sql.includes(`revoke all on function public.${f}\n  from public, anon, authenticated, service_role;`), `${f} : revoke incomplet`);
      assert.ok(sql.includes(`grant execute on function public.${f} to service_role;`), `${f} : grant manquant`);
      assert.ok(!new RegExp(`grant execute on function public\\.${f.replace(/[().,\s]/g, '.')} to authenticated`).test(sql), `${f} : donnée à authenticated`);
    }
    // my_access ne pose trial_started_at qu'à l'insertion, jamais dans un update
    const my = sql.slice(sql.indexOf('create function public.my_access'));
    const body = my.slice(0, my.indexOf('\n$$;'));
    assert.ok(/insert into public\.entitlements \(user_id, status, trial_started_at\)[\s\S]*on conflict \(user_id\) do nothing/.test(body),
      'l\'essai n\'est pas protégé par on conflict do nothing');
    assert.ok(!/update public\.entitlements[\s\S]*trial_started_at\s*=/.test(body), 'my_access réécrit trial_started_at');
    // Aucune des deux RPC du client ne prend de date en paramètre (l'heure vient du serveur)
    assert.ok(/create function public\.my_access\(\) returns jsonb/.test(sql));
    assert.ok(/create function public\.access_state\(\) returns jsonb/.test(sql));
    assert.ok(/create function public\.redeem_gift_code\(code text\) returns jsonb/.test(sql));
  });

  test('payant : la fonction de notification ne doit pas vérifier le jeton', async () => {
    const index = fs.readFileSync(path.join(ROOT, 'supabase/functions/appstore-notify/index.ts'), 'utf8');
    // Apple n'a pas de jeton Supabase : l'identification est la signature, et c'est dit dans le fichier
    assert.ok(index.includes('--no-verify-jwt'), 'le déploiement sans jeton n\'est pas documenté');
    assert.ok(!index.includes("caller("), 'appstore-notify ne doit pas attendre un jeton de session');
    assert.ok(/verifyAppleJws/.test(index) && /401/.test(index), 'signature non vérifiée ou 401 absent');
    const verify = fs.readFileSync(path.join(ROOT, 'supabase/functions/verify-purchase/index.ts'), 'utf8');
    assert.ok(verify.includes('await caller(req)'), 'verify-purchase doit vérifier le jeton');
    assert.ok(verify.includes('/inApps/v1/transactions/'), 'relecture App Store Server API absente');
    assert.ok(verify.includes('srv_access_purchase'), 'écriture du droit d\'accès absente');
  });
}
