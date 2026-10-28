// Payant V1, règle du 28/10/2026 : l'essai gratuit est rattaché à l'identifiant Apple. Logique pure de
// la fonction Edge verify-app-transaction : la preuve (AppTransaction signé par Apple) est vérifiée par
// la MÊME fonction que les achats (_shared/apple-jws.js), avec de vrais JWS fabriqués pour l'occasion
// (tests/unit/apple-jws-fixtures.mjs), valables et cassés un maillon à la fois.
import fs from 'node:fs';
import path from 'node:path';
import { appTransactionPayload, makeChain, makeJws, transactionPayload, APPLE_INTERMEDIATE_OID } from './apple-jws-fixtures.mjs';

export default function ({ test, assert, sameJSON, ROOT }) {
  const jwsMod = () => import(path.join(ROOT, 'supabase/functions/_shared/apple-jws.js'));
  const policy = () => import(path.join(ROOT, 'supabase/functions/verify-app-transaction/app-transaction-policy.js'));
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const nowMs = Date.UTC(2026, 9, 28, 12, 0, 0);

  // Ce que fait index.ts : signature d'abord, puis la règle
  async function judge(jws, { rootDer, allowSandbox = false } = {}) {
    const { verifyAppleJws } = await jwsMod();
    const { appTransactionDecision } = await policy();
    const signed = await verifyAppleJws(jws, { rootDer, nowMs });
    if (!signed.ok) return { ok: false, error: 'invalid_jws', detail: signed.error };
    return appTransactionDecision(signed.payload, { allowSandbox });
  }

  test('verify-app-transaction : preuve valable → identifiant Apple à lier', async () => {
    const chain = await makeChain({ nowMs });
    const r = await judge(await makeJws(appTransactionPayload(), chain), { rootDer: chain.rootDer });
    sameJSON(r, { ok: true, value: { app_transaction_id: '704964138470003520', environment: 'Production', bundle_id: 'com.mdlf.training' } });
  });

  test('verify-app-transaction : fausses preuves refusées (signature, racine, chaîne, marqueur d\'Apple)', async () => {
    const chain = await makeChain({ nowMs });
    // Charge utile changée après la signature (un tricheur qui met l'identifiant Apple d'un autre)
    const tampered = await makeJws(appTransactionPayload(), chain, { tamper: true });
    assert.equal((await judge(tampered, { rootDer: chain.rootDer })).detail, 'bad_signature');
    // Chaîne fabriquée face à la vraie racine d'Apple épinglée
    assert.equal((await judge(await makeJws(appTransactionPayload(), chain))).detail, 'bad_root');
    // Racine d'une autre autorité glissée en bout de chaîne
    const other = await makeChain({ nowMs });
    const mixed = await makeJws(appTransactionPayload(), chain, { x5c: [chain.x5c[0], chain.x5c[1], other.x5c[2]] });
    assert.equal((await judge(mixed, { rootDer: chain.rootDer })).detail, 'bad_root');
    // Feuille signée par une autre clé que l'intermédiaire
    const stranger = await makeChain({ nowMs, leafSignedBy: 'stranger' });
    assert.equal((await judge(await makeJws(appTransactionPayload(), stranger), { rootDer: stranger.rootDer })).detail, 'bad_chain_signature');
    // Certificat de développeur délivré par Apple, sans le marqueur « receipt signing »
    const dev = await makeChain({ nowMs, leafOids: [] });
    assert.equal((await judge(await makeJws(appTransactionPayload(), dev), { rootDer: dev.rootDer })).detail, 'bad_leaf_oid');
    const noInter = await makeChain({ nowMs, interOids: [] });
    assert.equal((await judge(await makeJws(appTransactionPayload(), noInter), { rootDer: noInter.rootDer })).detail, 'bad_intermediate_oid');
    assert.ok(APPLE_INTERMEDIATE_OID);
    // Feuille périmée (preuve ancienne gardée par StoreKit) : refusée, l'app reste « sans preuve »
    const old = await makeChain({ nowMs, leafNotAfter: nowMs - 1000 });
    assert.equal((await judge(await makeJws(appTransactionPayload(), old), { rootDer: old.rootDer })).detail, 'cert_expired');
    // Pas un JWS
    for (const bad of ['', 'abc', 'a.b.c', null, 42]) assert.equal((await judge(bad, { rootDer: chain.rootDer })).error, 'invalid_jws');
  });

  test('verify-app-transaction : bundleId d\'une autre app, environnement, identifiant absent', async () => {
    const chain = await makeChain({ nowMs });
    const err = async (over, opts = {}) => (await judge(await makeJws(appTransactionPayload(over), chain), { rootDer: chain.rootDer, ...opts })).error;
    // Une preuve VRAIMENT signée par Apple, mais pour une autre app : ne lie rien
    assert.equal(await err({ bundleId: 'com.autre.app' }), 'bad_bundle');
    assert.equal(await err({ bundleId: 'com.mdlf.training.pro' }), 'bad_bundle');
    assert.equal(await err({ bundleId: undefined }), 'bad_bundle');
    // Sandbox (TestFlight) refusé sauf APPLE_ALLOW_SANDBOX=1, Xcode toujours
    assert.equal(await err({ receiptType: 'Sandbox' }), 'bad_environment');
    assert.equal((await judge(await makeJws(appTransactionPayload({ receiptType: 'Sandbox' }), chain), { rootDer: chain.rootDer, allowSandbox: true })).ok, true);
    assert.equal(await err({ receiptType: 'Xcode' }, { allowSandbox: true }), 'bad_environment');
    assert.equal(await err({ receiptType: 'LocalTesting' }, { allowSandbox: true }), 'bad_environment');
    // Sans identifiant de téléchargement (vieille preuve) : rien à lier
    assert.equal(await err({ appTransactionId: undefined }), 'no_app_transaction_id');
    assert.equal(await err({ appTransactionId: '' }), 'no_app_transaction_id');
    assert.equal(await err({ appTransactionId: 7049641384 }), 'no_app_transaction_id', 'un nombre (arrondi par JSON au-delà de 2^53) est refusé');
    assert.equal(await err({ appTransactionId: 'a b' }), 'no_app_transaction_id');
    assert.equal(await err({ appTransactionId: '9'.repeat(65) }), 'no_app_transaction_id');
    // Une transaction d'achat signée (qui porte aussi appTransactionId) n'est pas une preuve de téléchargement
    assert.equal((await judge(await makeJws(transactionPayload({ appTransactionId: '7049' }), chain), { rootDer: chain.rootDer })).error, 'not_app_transaction');
    assert.equal(await err({ productId: 'com.mdlf.training.pro.monthly' }), 'not_app_transaction');
    assert.equal(await err({ receiptType: undefined }), 'not_app_transaction');
    const { appTransactionDecision } = await policy();
    assert.equal(appTransactionDecision(null).error, 'invalid_jws');
    assert.equal(appTransactionDecision([appTransactionPayload()]).error, 'invalid_jws');
  });

  test('verify-app-transaction : réponses HTTP et erreurs de la base', async () => {
    const { appTxStatus, linkFailure } = await policy();
    assert.equal(appTxStatus('bad_bundle'), 400);
    assert.equal(appTxStatus('rate_limited'), 429);
    assert.equal(appTxStatus('toString'), 500, 'clé héritée d\'Object');
    sameJSON(linkFailure('rate_limited'), { status: 429, error: 'rate_limited' });
    sameJSON(linkFailure('bad_bundle'), { status: 400, error: 'bad_bundle' });
    sameJSON(linkFailure('permission denied for function'), { status: 500, error: 'write' });
    sameJSON(linkFailure(undefined), { status: 500, error: 'write' });
  });

  test('verify-app-transaction : même vérification que les achats, et écriture par la clé serveur seulement', () => {
    const index = read('supabase/functions/verify-app-transaction/index.ts');
    // La signature d'Apple vient de la fonction déjà relue, pas d'une copie
    assert.ok(/import \{ verifyAppleJws \} from '\.\.\/_shared\/apple-jws\.js'/.test(index), 'vérification de signature réécrite');
    assert.ok(/verifyAppleJws\(await bodyJws\(req\)/.test(index) && /appTransactionDecision\(signed\.payload/.test(index), 'la règle ne lit pas la charge utile vérifiée');
    assert.ok(/caller\(req\)/.test(index) && /401/.test(index), 'appelant non identifié');
    assert.ok(/APPLE_ALLOW_SANDBOX/.test(index), 'règle Sandbox absente');
    assert.ok(/rpc\('srv_link_store_install'/.test(index) && /p_store: 'apple'/.test(index) && /p_bundle: proof\.value\.bundle_id/.test(index), 'écriture, magasin ou bundle non transmis');
    // Même identifiant d'app que les achats
    assert.ok(/import \{ BUNDLE_ID \} from '\.\.\/verify-purchase\/purchase-policy\.js'/.test(read('supabase/functions/verify-app-transaction/app-transaction-policy.js')));
    // Migration : tables fermées, écriture réservée à service_role, anon ne lit que paywall_on
    const sql = read('supabase/migrations/20261029000000_payant_apple.sql');
    assert.ok(/revoke all on public\.store_installs, public\.store_install_links from public, anon, authenticated, service_role/.test(sql));
    assert.ok(/grant execute on function public\.srv_link_store_install\(uuid, text, text, text, text\) to service_role;/.test(sql));
    assert.ok(!/grant execute on function public\.srv_link_store_install[^;]*to (authenticated|anon)/.test(sql));
    assert.ok(/for select to anon using \(key = 'paywall_on'\)/.test(sql), 'politique anon absente');
    assert.ok(/grant select \(key, value\) on public\.app_config to anon;/.test(sql));
    // La première liaison fixe la date ; la table des identifiants n'est pas liée aux comptes
    assert.ok(/on conflict \(store, install_id\) do nothing/.test(sql));
    assert.ok(!/create table public\.store_installs[^;]*auth\.users/.test(sql), 'store_installs partirait avec le compte');
    // Premier rattachement : départ du compte seulement si son essai court encore (relecture du 28/10)
    assert.ok(/case when own > now\(\) - make_interval\(days => private\.access_trial_days\(\)\) then own else now\(\) end/.test(sql));
    // La fonction n'est pas protégée par la passerelle (jeton relu dans le code, comme delete-account)
    assert.ok(/\[functions\.verify-app-transaction\]\s*\n#[^\n]*\nverify_jwt = false/.test(read('supabase/config.toml')));
    // La page de confidentialité le dit, en français et en anglais (relecture du 28/10)
    const privacy = read('privacy.html');
    for (const k of ['article 21 du RGPD', 'GDPR Article 21', 'sauf l\'identifiant d\'installation', 'except the free-trial installation identifier',
      'réglage public', 'public setting', 'commence dès maintenant', 'starts now', 'même au-delà de 2 ans', 'even beyond 2 years', 'Base légale']) {
      assert.ok(privacy.includes(k), `${k} absent de privacy.html`);
    }
        // Le contrat le dit
    const doc = read('docs/PAYANT_V1.md');
    for (const k of ['verify-app-transaction', 'appTransactionId', 'apple_linked', 'trial_shared', 'trial_unproven_days', 'store_installs', 'ios_seen_at', 'DeviceCheck']) {
      assert.ok(doc.includes(k), `${k} absent de docs/PAYANT_V1.md`);
    }
  });
}
