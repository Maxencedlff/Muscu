// Payant V1 : logique pure des fonctions serveur verify-purchase et appstore-notify.
// Le cœur de la sécurité est la vérification de la signature d'Apple : elle est testée avec de VRAIS
// JWS fabriqués pour l'occasion (tests/unit/apple-jws-fixtures.mjs), valables et cassés un maillon à
// la fois. Contrat : docs/PAYANT_V1.md.
import fs from 'node:fs';
import path from 'node:path';
import { makeCert, makeChain, makeJws, newKey, notificationPayload, renewalPayload, transactionPayload,
  APPLE_RECEIPT_SIGNER_OID, APPLE_INTERMEDIATE_OID } from './apple-jws-fixtures.mjs';

export default function ({ test, assert, sameJSON, ROOT }) {
  const jwsMod = () => import(path.join(ROOT, 'supabase/functions/_shared/apple-jws.js'));
  const policy = () => import(path.join(ROOT, 'supabase/functions/verify-purchase/purchase-policy.js'));
  const notify = () => import(path.join(ROOT, 'supabase/functions/appstore-notify/notify-policy.js'));
  const migration = () => fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261028000000_payant.sql'), 'utf8');
  // Définitions en vigueur (modèle B) : la migration du 29/10 remplace plusieurs fonctions du 28/10
  const modelB = () => fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261029000000_payant_modele_b.sql'), 'utf8');
  // Dernière définition des produits reconnus : 20261030000000_payant_tarifs.sql
  const tarifs = () => fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261030000000_payant_tarifs.sql'), 'utf8');
  const bodyOf = (sql, head) => { const f = sql.slice(sql.indexOf(head)); return f.slice(0, f.indexOf('\n$$;')); };
  const contract = () => fs.readFileSync(path.join(ROOT, 'docs/PAYANT_V1.md'), 'utf8');
  const plus = () => fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261031000000_payant_plus.sql'), 'utf8');
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
    const r = transactionDecision(transactionPayload({ expiresDate: nowMs + 30 * 86400_000, purchaseDate: nowMs - 86400_000 }), { nowMs });
    sameJSON(r, { ok: true, value: {
      product_id: 'com.mdlf.training.pro.monthly', kind: 'sub',
      expires_at: new Date(nowMs + 30 * 86400_000).toISOString(),
      original_transaction_id: '2000000900000001', transaction_id: '2000000900000001',
      revoked: false, environment: 'Production', expired: false,
      // event_at = purchaseDate (stable d'une relecture à l'autre), jamais signedDate
      event_at: new Date(nowMs - 86400_000).toISOString(), account_token: null, intro_offer: false,
    } });
    // signedDate ne sert que si purchaseDate manque
    assert.equal(transactionDecision(transactionPayload({ purchaseDate: undefined, signedDate: nowMs }), { nowMs }).value.event_at, new Date(nowMs).toISOString());
    assert.equal(transactionDecision(transactionPayload({ purchaseDate: undefined, signedDate: undefined }), { nowMs }).value.event_at, null);
    // Formule annuelle
    assert.equal(transactionDecision(transactionPayload({ productId: 'com.mdlf.training.pro.yearly' }), { nowMs }).value.kind, 'sub');
    // « Accès offert » d'Apple supprimé (modèle B) : inconnu, refusé
    assert.equal(transactionDecision(transactionPayload({
      productId: 'com.mdlf.training.access.gift', type: 'Non-Consumable', expiresDate: undefined,
    }), { nowMs }).error, 'unknown_product');
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
    assert.equal(err({ productId: 'com.mdlf.training.access.gift' }), 'unknown_product', 'ancien accès offert');
    assert.equal(err({ inAppOwnershipType: 'FAMILY_SHARED' }), 'not_purchased');
    assert.equal(transactionDecision(null, { nowMs }).error, 'invalid_jws');
    assert.equal(transactionDecision([transactionPayload()], { nowMs }).error, 'invalid_jws');
  });

  test('verify-purchase : Sandbox ACCEPTÉ et enregistré (examen d\'Apple), Xcode refusé', async () => {
    const { transactionDecision } = await policy();
    // L'équipe d'examen d'Apple achète en Sandbox sur la version de production : refuser, c'est un refus
    const sandbox = transactionDecision(transactionPayload({ environment: 'Sandbox' }), { nowMs });
    assert.equal(sandbox.ok, true);
    assert.equal(sandbox.value.environment, 'Sandbox');
    assert.equal(transactionDecision(transactionPayload(), { nowMs }).value.environment, 'Production');
    assert.equal(transactionDecision(transactionPayload({ environment: 'Xcode' }), { nowMs }).error, 'bad_environment');
    assert.equal(transactionDecision(transactionPayload({ environment: 'LocalTesting' }), { nowMs }).error, 'bad_environment');
    assert.equal(transactionDecision(transactionPayload({ environment: undefined }), { nowMs }).error, 'bad_environment');
    // Plus aucune variable d'environnement ne règle le Sandbox
    for (const f of ['verify-purchase/index.ts', 'verify-purchase/purchase-policy.js', 'appstore-notify/index.ts', 'appstore-notify/notify-policy.js']) {
      assert.ok(!/ALLOW_SANDBOX|allowSandbox/.test(fs.readFileSync(path.join(ROOT, 'supabase/functions', f), 'utf8')), `${f} : règle Sandbox restée`);
    }
  });

  test('verify-purchase : offre de lancement (essai gratuit d\'Apple) lue dans la transaction signée', async () => {
    const { transactionDecision, OFFER_INTRODUCTORY } = await policy();
    assert.equal(OFFER_INTRODUCTORY, 1, 'OfferType.INTRODUCTORY_OFFER vaut 1 chez Apple');
    const trial = transactionDecision(transactionPayload({ offerType: 1, offerDiscountType: 'FREE_TRIAL', offerPeriod: 'P3M',
      expiresDate: nowMs + 90 * 86400_000 }), { nowMs });
    assert.equal(trial.value.intro_offer, true);
    assert.equal(trial.value.expires_at, new Date(nowMs + 90 * 86400_000).toISOString(), 'la fin de l\'essai est la fin de la période');
    // Offre promotionnelle, code d'offre, retour : pas une offre de lancement ; champ absent ou mal typé : non
    for (const offerType of [2, 3, 4, '1', undefined, null]) {
      assert.equal(transactionDecision(transactionPayload({ offerType, offerDiscountType: 'FREE_TRIAL' }), { nowMs }).value.intro_offer, false, String(offerType));
    }
    // Offre de lancement PAYANTE ou sans type de remise : jamais affichée comme « Essai gratuit »
    for (const offerDiscountType of ['PAY_AS_YOU_GO', 'PAY_UP_FRONT', 'free_trial', undefined]) {
      assert.equal(transactionDecision(transactionPayload({ offerType: 1, offerDiscountType }), { nowMs }).value.intro_offer, false, String(offerDiscountType));
    }
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

  test('appstore-notify : les types du contrat sont traités', async () => {
    const { notificationDecision, HANDLED_TYPES } = await notify();
    sameJSON([...HANDLED_TYPES].sort(), ['DID_CHANGE_RENEWAL_STATUS', 'DID_FAIL_TO_RENEW', 'DID_RENEW', 'EXPIRED',
      'GRACE_PERIOD_EXPIRED', 'REFUND', 'REVOKE', 'SUBSCRIBED']);
    // Les sept du contrat y sont (DID_FAIL_TO_RENEW est en plus : il porte la période de grâce)
    const doc = contract();
    for (const t of HANDLED_TYPES) assert.ok(doc.includes(t), `${t} absent du contrat`);
    const until = nowMs + 30 * 86400_000;
    const tx = transactionPayload({ expiresDate: until, purchaseDate: nowMs - 86400_000 });
    for (const type of ['SUBSCRIBED', 'DID_RENEW', 'DID_CHANGE_RENEWAL_STATUS', 'DID_FAIL_TO_RENEW']) {
      const r = notificationDecision({ notification: notificationPayload({ notificationType: type, signedDate: nowMs }), transaction: tx, nowMs });
      sameJSON(r, { handled: true, type, value: {
        original_transaction_id: '2000000900000001', product_id: 'com.mdlf.training.pro.monthly',
        expires_at: new Date(until).toISOString(), revoked: false, force: false,
        event_at: new Date(nowMs).toISOString(), account_token: null, intro_offer: false, environment: 'Production',
      } }, type);
    }
  });

  test('appstore-notify : la période de grâce de facturation garde l\'accès', async () => {
    const { notificationDecision } = await notify();
    // gracePeriodExpiresDate n'existe que dans signedRenewalInfo : sans le lire, une carte qui échoue
    // couperait un abonné qu'Apple considère toujours abonné
    const expired = nowMs - 3600_000;
    const grace = nowMs + 16 * 86400_000;
    const tx = transactionPayload({ expiresDate: expired });
    const sansGrace = notificationDecision({ notification: notificationPayload({ notificationType: 'DID_FAIL_TO_RENEW' }), transaction: tx, nowMs });
    assert.equal(sansGrace.value.expires_at, new Date(expired).toISOString(), 'sans renewalInfo');
    const avecGrace = notificationDecision({
      notification: notificationPayload({ notificationType: 'DID_FAIL_TO_RENEW' }),
      transaction: tx, renewal: renewalPayload({ gracePeriodExpiresDate: grace }), nowMs,
    });
    assert.equal(avecGrace.value.expires_at, new Date(grace).toISOString(), 'la grâce doit garder l\'accès');
    assert.equal(avecGrace.value.revoked, false);
    assert.equal(avecGrace.value.force, false);
    // La grâce ne raccourcit jamais une période déjà plus lointaine
    const long = notificationDecision({
      notification: notificationPayload({ notificationType: 'DID_RENEW' }),
      transaction: transactionPayload({ expiresDate: nowMs + 30 * 86400_000 }),
      renewal: renewalPayload({ gracePeriodExpiresDate: nowMs + 86400_000 }), nowMs,
    });
    assert.equal(long.value.expires_at, new Date(nowMs + 30 * 86400_000).toISOString());
    // Une grâce qui n'est pas une date est ignorée
    for (const bad of [null, 'bientôt', 0, -1]) {
      const r = notificationDecision({ notification: notificationPayload({ notificationType: 'DID_FAIL_TO_RENEW' }),
        transaction: tx, renewal: renewalPayload({ gracePeriodExpiresDate: bad }), nowMs });
      assert.equal(r.value.expires_at, new Date(expired).toISOString(), String(bad));
    }
    // GRACE_PERIOD_EXPIRED ferme l'accès même si le renewalInfo porte encore une date
    const fin = notificationDecision({
      notification: notificationPayload({ notificationType: 'GRACE_PERIOD_EXPIRED' }),
      transaction: tx, renewal: renewalPayload({ gracePeriodExpiresDate: nowMs + 86400_000 }), nowMs,
    });
    assert.equal(fin.value.expires_at, new Date(nowMs).toISOString());
    assert.equal(fin.value.force, true);
  });

  test('appstore-notify : expiration ramenée à maintenant (et force), remboursement révoqué', async () => {
    const { notificationDecision } = await notify();
    // Apple envoie parfois EXPIRED avec une date encore dans le futur : on ne laisse rien d'ouvert
    for (const type of ['EXPIRED', 'GRACE_PERIOD_EXPIRED']) {
      const r = notificationDecision({ notification: notificationPayload({ notificationType: type }),
        transaction: transactionPayload({ expiresDate: nowMs + 60_000 }), nowMs });
      assert.equal(r.value.expires_at, new Date(nowMs).toISOString(), type);
      assert.equal(r.value.revoked, false, type);
      // force : seul cas où le serveur accepte de faire reculer la date de fin
      assert.equal(r.value.force, true, type);
    }
    // Une expiration déjà passée garde sa date
    const past = notificationDecision({ notification: notificationPayload({ notificationType: 'EXPIRED' }),
      transaction: transactionPayload({ expiresDate: nowMs - 86400_000 }), nowMs });
    assert.equal(past.value.expires_at, new Date(nowMs - 86400_000).toISOString());
    for (const type of ['REFUND', 'REVOKE']) {
      const r = notificationDecision({ notification: notificationPayload({ notificationType: type }),
        transaction: transactionPayload({ expiresDate: nowMs + 86400_000 }), nowMs });
      assert.equal(r.value.revoked, true, type);
      assert.equal(r.value.force, false, type);
    }
    // L'ancien « Accès offert » n'est plus un de nos produits : ignoré (200)
    const gift = notificationDecision({ notification: notificationPayload({ notificationType: 'REVOKE', signedDate: nowMs }),
      transaction: transactionPayload({ productId: 'com.mdlf.training.access.gift', type: 'Non-Consumable', expiresDate: undefined }), nowMs });
    sameJSON(gift, { handled: false, type: 'REVOKE', reason: 'unknown_product' });
  });

  test('appstore-notify : tout ce qui est signé par Apple repart en 200', async () => {
    const { notificationDecision } = await notify();
    const tx = transactionPayload();
    // Types qu'on ne traite pas : ignorés, jamais refusés (sinon Apple rejoue 5 fois sur 3 jours)
    for (const type of ['TEST', 'PRICE_INCREASE', 'CONSUMPTION_REQUEST', 'RENEWAL_EXTENDED', 'RENEWAL_EXTENSION', 'RESCIND_CONSENT']) {
      sameJSON(notificationDecision({ notification: notificationPayload({ notificationType: type }), transaction: tx, nowMs }),
        { handled: false, type, reason: 'type_ignored' }, type);
    }
    // Notification SANS data (exclusif de summary, appData, externalPurchaseToken) : 200
    const noData = { notificationType: 'DID_RENEW', notificationUUID: 'u', version: '2.0', signedDate: nowMs,
      summary: { requestIdentifier: 'r', environment: 'Production' } };
    sameJSON(notificationDecision({ notification: noData, transaction: tx, nowMs }), { handled: false, type: 'DID_RENEW', reason: 'no_data' });
    // Le type est regardé AVANT l'environnement
    sameJSON(notificationDecision({ notification: notificationPayload({ notificationType: 'TEST' }, { environment: 'Xcode' }), transaction: tx, nowMs }),
      { handled: false, type: 'TEST', reason: 'type_ignored' });
    // Autre bundleId, environnement non autorisé, produit d'une autre app, transaction absente : ignorés
    const cas = [
      [notificationPayload({}, { bundleId: 'com.autre.app' }), tx, 'bad_bundle'],
      [notificationPayload({}, { environment: 'Xcode' }), tx, 'bad_environment'],
      [notificationPayload(), transactionPayload({ productId: 'com.autre.pro' }), 'unknown_product'],
      [notificationPayload(), transactionPayload({ bundleId: 'com.autre.app' }), 'bad_bundle'],
      [notificationPayload(), null, 'invalid_jws'],
    ];
    for (const [n, t, reason] of cas) {
      const r = notificationDecision({ notification: n, transaction: t, nowMs });
      sameJSON(r, { handled: false, type: 'DID_RENEW', reason }, reason);
    }
    // Charge utile inattendue : ignorée sans exception
    for (const n of [null, 42, 'texte', {}, { notificationType: 5 }, []]) {
      assert.equal(notificationDecision({ notification: n, transaction: tx, nowMs }).handled, false, String(n));
    }
    // Sandbox accepté (examen d'Apple, TestFlight), environnement et offre de lancement remontés
    const sb = notificationDecision({ notification: notificationPayload({}, { environment: 'Sandbox' }),
      transaction: transactionPayload({ environment: 'Sandbox', offerType: 1, offerDiscountType: 'FREE_TRIAL' }), nowMs });
    assert.equal(notificationDecision({ notification: notificationPayload(), nowMs,
      transaction: transactionPayload({ offerType: 1, offerDiscountType: 'PAY_UP_FRONT' }) }).value.intro_offer, false, 'offre de lancement payante');
    assert.equal(sb.handled, true);
    assert.equal(sb.value.environment, 'Sandbox');
    assert.equal(sb.value.intro_offer, true);
  });

  test('appstore-notify : event_at et appAccountToken remontés au serveur', async () => {
    const { notificationDecision } = await notify();
    // event_at = signedDate de la notification : le serveur ignore un évènement plus ancien
    const r = notificationDecision({ notification: notificationPayload({ signedDate: nowMs + 5000 }),
      transaction: transactionPayload({ purchaseDate: nowMs - 86400_000, appAccountToken: '11111111-1111-4111-8111-111111111111' }), nowMs });
    assert.equal(r.value.event_at, new Date(nowMs + 5000).toISOString());
    assert.equal(r.value.account_token, '11111111-1111-4111-8111-111111111111');
    // signedDate illisible : on retombe sur la purchaseDate de la transaction
    const sans = notificationDecision({ notification: notificationPayload({ signedDate: 'hier' }),
      transaction: transactionPayload({ purchaseDate: nowMs - 86400_000 }), nowMs });
    assert.equal(sans.value.event_at, new Date(nowMs - 86400_000).toISOString());
  });

  test('payant plus : accès à vie offerts révocables et tracés, jamais par une RPC', () => {
    const sql = plus();
    for (const f of ['grant_lifetime', 'revoke_lifetime', 'revoke_gift_code']) {
      assert.ok(new RegExp(`create function private\\.${f}\\(`).test(sql), `${f} absente`);
      assert.ok(new RegExp(`revoke all on function private\\.${f}\\([^)]*\\) from public, anon, authenticated, service_role;`).test(sql), `${f} exécutable par l'API`);
      assert.ok(contract().includes(`private.${f}`), `${f} absente du contrat`);
    }
    assert.ok(!/grant execute on function private\./.test(sql), 'une brique privée ouverte');
    // Pas d'achat à vie payant (refusé le 31/10/2026) : le produit n'existe nulle part
    assert.ok(!/com\.mdlf\.training\.lifetime/.test(sql), 'achat à vie dans la migration');
    // Un accès à vie offert retiré ne compte plus, et un code désactivé est refusé
    assert.ok(/k\.kind = 'lifetime' and r\.revoked_at is null/.test(bodyOf(sql, 'create or replace function private.access_refresh')));
    assert.ok(/g\.revoked_at is not null or/.test(bodyOf(sql, 'create or replace function public.redeem_gift_code')));
    // Aucun code écrit en dur dans la migration ni dans son retour arrière (tirés au hasard par la base)
    const down = fs.readFileSync(path.join(ROOT, 'supabase/rollback/20261031000000_payant_plus_down.sql'), 'utf8');
    for (const text of [sql, down]) {
      const strip = text.replace(/'K7M2QX9PR4TD'/g, '');   // exemple du commentaire, jamais créé
      assert.ok(!/'[A-HJ-NP-Z2-9]{10,24}'/.test(strip.replace(/'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'/g, '')), 'code en dur');
    }
  });

  // ── Serveur et app disent la même chose ─────────────────

  test('payant : mêmes produits, mêmes erreurs et mêmes clés que la migration et le contrat', async () => {
    const { PRODUCT_KINDS, BUNDLE_ID, COACH_PRODUCTS } = await policy();
    const sql = modelB();
    const productSql = tarifs().slice(tarifs().indexOf('function private.access_product_kind'), tarifs().indexOf('function private.coach_product_limit'));
    // Produits et natures : private.access_product_kind (dernière version) doit dire exactement la même chose
    for (const [product, kind] of Object.entries(PRODUCT_KINDS)) {
      assert.ok(new RegExp(`when '${product.replace(/\./g, '\\.')}'\\s+then '${kind}'`).test(productSql), `${product} absent de la migration`);
    }
    const inSql = [...productSql.matchAll(/when '(com\.mdlf\.training[^']*)'\s+then '(sub|gift)'/g)].map((m) => m[1]);
    sameJSON(inSql.sort(), Object.keys(PRODUCT_KINDS).sort(), 'produits en trop ou en moins côté serveur');
    // Les mêmes identifiants que le contrat
    const doc = contract();
    for (const p of [...Object.keys(PRODUCT_KINDS), BUNDLE_ID]) assert.ok(doc.includes(p), `${p} absent du contrat`);
    const tiers = ['coach10', 'coach20', 'coach30', 'coachmax'].flatMap(t => [`com.mdlf.training.${t}.monthly`, `com.mdlf.training.${t}.yearly`]);
    sameJSON(Object.keys(PRODUCT_KINDS).sort(), ['com.mdlf.training.pro.monthly', 'com.mdlf.training.pro.yearly', ...tiers].sort(), 'dix abonnements, rien d\'autre');
    sameJSON([...COACH_PRODUCTS].sort(), [...tiers].sort(), 'paliers coach');
    // Chaque produit coach a son palier côté serveur (private.coach_product_limit)
    for (const id of tiers) assert.ok(tarifs().includes(`when '${id}'`) && /coach_product_limit/.test(tarifs()), `${id} sans palier`);
    // Les clés de my_access() (modèle B), côté serveur et côté contrat
    const keys = ['status', 'until', 'paywall_on', 'days_left', 'can_write', 'gift', 'gift_until', 'coach_team', 'intro_offer', 'intro_until', 'server_now'];
    for (const k of keys) {
      assert.ok(new RegExp(`'${k}',`).test(sql), `clé ${k} absente de private.access_json`);
      assert.ok(doc.includes(k), `clé ${k} absente du contrat`);
    }
    // Erreurs levées par la base, toutes connues de purchaseFailure ou documentées
    const raised = [...new Set([...(migration() + sql).matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]))];
    for (const e of raised) assert.ok(doc.includes(e), `erreur ${e} absente du contrat`);
    // Le verrou est livré éteint ; l'essai maison a disparu (c'est l'offre de lancement d'Apple)
    assert.ok(/\('paywall_on', 'false'::jsonb\)/.test(migration()), 'paywall_on livré allumé');
    assert.ok(/delete from public\.app_config where key = 'trial_days';/.test(sql), 'trial_days non retiré');
    assert.ok(/drop column trial_started_at;/.test(sql), 'trial_started_at non retiré');
    assert.ok(!/trial_started_at|trial_days/.test(sql.replace(/^--.*$/gm, '').replace(/delete from public\.app_config where key = 'trial_days';|drop column trial_started_at;|drop function private\.access_trial_days\(\);/g, '')),
      'l\'essai maison fait encore autorité dans une définition en vigueur');
  });

  test('payant : codes cadeaux, règles du serveur et du contrat', async () => {
    const sql = migration();
    // redeem_gift_code en vigueur (modèle B) : mêmes règles
    const current = bodyOf(modelB(), 'create or replace function public.redeem_gift_code');
    assert.ok(/rate_limit_window\(me, 'gift_code', 10, interval '1 hour'\)/.test(current) && /for update/.test(current), 'redeem_gift_code du modèle B affaibli');
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
    const sql2 = modelB();
    for (const f of ['srv_access_purchase(uuid, text, timestamptz, text, boolean, timestamptz, boolean, text)',
                     'srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text, boolean, text)']) {
      assert.ok(sql2.includes(`revoke all on function public.${f}\n  from public, anon, authenticated, service_role;`), `${f} : revoke incomplet`);
      assert.ok(sql2.includes(`grant execute on function public.${f} to service_role;`), `${f} : grant manquant`);
      assert.ok(!new RegExp(`grant execute on function public\\.${f.replace(/[().,\s]/g, '.')} to authenticated`).test(sql2), `${f} : donnée à authenticated`);
    }
    for (const f of ['srv_access_purchase(uuid, text, timestamptz, text, boolean, timestamptz)',
                     'srv_access_event(text, text, timestamptz, boolean, timestamptz, boolean, text, text)']) {
      assert.ok(sql.includes(`revoke all on function public.${f}\n  from public, anon, authenticated, service_role;`), `${f} : revoke incomplet`);
      assert.ok(sql.includes(`grant execute on function public.${f} to service_role;`), `${f} : grant manquant`);
      assert.ok(!new RegExp(`grant execute on function public\\.${f.replace(/[().,\s]/g, '.')} to authenticated`).test(sql), `${f} : donnée à authenticated`);
    }
    // my_access en vigueur (modèle B) : crée la ligne en 'none', ne donne rien
    const body = bodyOf(sql2, 'create or replace function public.my_access()');
    assert.ok(/insert into public\.entitlements \(user_id, status\) values \(me, 'none'\) on conflict \(user_id\) do nothing/.test(body), 'my_access crée autre chose qu\'une ligne vide');
    // Aucune des deux RPC du client ne prend de date en paramètre (l'heure vient du serveur)
    assert.ok(/create function public\.my_access\(\) returns jsonb/.test(sql));
    assert.ok(/create function public\.access_state\(\) returns jsonb/.test(sql));
    assert.ok(/create function public\.redeem_gift_code\(code text\) returns jsonb/.test(sql));
  });

  test('payant : un remboursé le reste, sauf réabonnement réel', async () => {
    const sql = modelB();
    const fn = sql.slice(sql.indexOf('create function private.access_claim'));
    const body = fn.slice(0, fn.indexOf('\n$$;'));
    // La réouverture demande les DEUX conditions : évènement plus récent ET période plus lointaine
    assert.ok(/reopen\s*:=\s*cur\.revoked_at is not null and not p_revoked/.test(body), 'règle de réouverture absente');
    assert.ok(/new_end is not null and \(cur\.expires_at is null or new_end > cur\.expires_at\)/.test(body), 'période strictement plus lointaine non exigée');
    assert.ok(/cur\.event_at is not null and p_event_at is not null and p_event_at > cur\.event_at/.test(body), 'évènement strictement plus récent non exigé');
    assert.ok(/when reopen then null\s*\n\s*when p_revoked then coalesce\(cur\.revoked_at, now\(\)\)/.test(body), 'revoked_at pas gardé hors réouverture');
    // Un évènement plus ancien ne touche à rien, et une transaction révoquée garde sa période
    assert.ok(/elsif cur\.event_at is null or p_event_at is null or p_event_at >= cur\.event_at then/.test(body), 'évènement en retard non ignoré');
    assert.ok(/when cur\.revoked_at is not null then cur\.expires_at/.test(body), 'la période d\'une transaction révoquée bouge');
    const doc = contract();
    assert.ok(doc.includes('strictement plus lointaine'), 'règle de réouverture absente du contrat');
    assert.ok(doc.includes('access_refresh'), 'commande de secours absente du contrat');
  });

  test('payant : le verrou est tenu par un déclencheur du serveur, pas par l\'app', async () => {
    const sql = migration();
    // Se déconnecter met can_write à vrai côté app : le serveur doit refuser lui-même
    assert.ok(/create trigger sessions_paywall before insert on public\.sessions/.test(sql), 'déclencheur absent');
    assert.ok(!/create trigger sessions_paywall before insert or update/.test(sql), 'le déclencheur doit porter sur insert seulement');
    const fn = sql.slice(sql.indexOf('create function private.sessions_paywall'));
    const body = fn.slice(0, fn.indexOf('\n$$;'));
    assert.ok(/raise exception 'paywall_locked'/.test(body), 'erreur paywall_locked absente');
    assert.ok(/if not private\.access_paywall_on\(\) then\s*\n\s*return new;/.test(body), 'coût non nul verrou éteint');
    assert.ok(contract().includes('paywall_locked'), 'paywall_locked absent du contrat');
    // Version en vigueur (modèle B) : grâce de fin de séance bornée à l'heure du SERVEUR
    const now = bodyOf(modelB(), 'create or replace function private.sessions_paywall');
    assert.ok(/now\(\) <= ended \+ interval '24 hours'/.test(now), 'fenêtre serveur de 24 h absente');
    assert.ok(/began <= ended and began >= ended - interval '12 hours'/.test(now), 'début de séance non borné');
    assert.ok(/r\.action = 'session_grace' and r\.at > ended\) < 2/.test(now), 'nombre de séances de grâce non borné');
    assert.ok(/raise exception 'paywall_locked'/.test(now));
  });

  test('payant : aucun identifiant de transaction dans les journaux des fonctions Edge', () => {
    for (const f of ['verify-purchase/index.ts', 'appstore-notify/index.ts']) {
      const src = fs.readFileSync(path.join(ROOT, 'supabase/functions', f), 'utf8');
      const logs = src.split('\n').filter(l => /console\.(log|error|warn)/.test(l));
      assert.ok(logs.length > 0, `${f} : aucun journal trouvé`);
      for (const l of logs) assert.ok(!/transaction_id|original_transaction|transactionId|originalTransactionId/.test(l), `${f} : identifiant de transaction journalisé : ${l.trim()}`);
    }
  });

  test('payant : verrou des mises à jour (sortie de corbeille, renommage, nouvelle date)', () => {
    const sql = modelB();
    assert.ok(/create trigger sessions_paywall_upd before update on public\.sessions/.test(sql), 'déclencheur before update absent');
    const body = bodyOf(sql, 'create function private.sessions_paywall_update');
    assert.ok(/new\.id is not distinct from old\.id/.test(body), 'changement d\'id non contrôlé');
    assert.ok(/old\.deleted_at is not null and new\.deleted_at is null/.test(body), 'sortie de corbeille non contrôlée');
    assert.ok(/\(new\.data -> 'date'\) is not distinct from \(old\.data -> 'date'\)/.test(body), 'changement de date non contrôlé');
    assert.ok(/raise exception 'paywall_locked'/.test(body));
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
