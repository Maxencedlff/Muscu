// Contrat entre le module natif (ios/App/App/StorePlugin.swift) et l'app web.
//
// Pourquoi ce test : tests/fake_store.py imitait ce que le JS ATTENDAIT, pas ce que le Swift ENVOIE.
// Tous les tests étaient verts avec un écran d'abonnement cassé (products lus sous `price`/`title`
// alors qu'Apple rend `displayPrice`/`displayName`, restore lu sous `jws` alors que le module rend
// `entitlements[]`). Ici on lit le VRAI Swift et on vérifie, clé par clé :
//   1. que chaque clé consommée par js/data/access.js et js/platform/native.js existe dans la charge
//      utile du Swift, méthode par méthode ;
//   2. que le faux StoreKit des tests (tests/fake_store.py) rend exactement les mêmes clés, sans en
//      inventer : un faux plus généreux que le vrai laisserait repasser le même genre de bogue.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Le module Swift vit dans le dépôt complet (ou dans le worktree de la branche native) : on le
// cherche là où il peut être. Introuvable, le contrat n'est pas vérifiable : c'est un échec.
function swiftSource(ROOT) {
  const tries = [
    path.join(ROOT, 'ios/App/App/StorePlugin.swift'),
    path.join(ROOT, '..', 'ppl-payant', 'ios/App/App/StorePlugin.swift'),
    path.join(ROOT, '..', 'ppl-payant-natif', 'ios/App/App/StorePlugin.swift'),
    path.join(ROOT, '..', 'ppl-training', 'ios/App/App/StorePlugin.swift'),
  ];
  for (const p of tries) if (fs.existsSync(p)) return { src: fs.readFileSync(p, 'utf8'), path: p };
  return { src: null, path: null, tries };
}

// Clés d'une charge utile Swift : « "clé": valeur » dans un dictionnaire, et « out["clé"] = … »
const swiftKeys = text => new Set([...String(text).matchAll(/"([A-Za-z][A-Za-z0-9_]*)"\s*(?::|\])/g)].map(m => m[1]));

// Corps d'une méthode @objc, jusqu'à la suivante
function swiftBlock(src, name) {
  const start = src.indexOf(`@objc func ${name}(`);
  if (start < 0) return '';
  const rest = src.slice(start + 1);
  const next = rest.indexOf('@objc func ');
  return next < 0 ? rest : rest.slice(0, next);
}
function swiftBetween(src, from, to) {
  const start = src.indexOf(from);
  if (start < 0) return '';
  const rest = src.slice(start);
  const end = to ? rest.indexOf(to, 1) : -1;
  return end < 0 ? rest : rest.slice(0, end);
}

// Ce que l'app LIT vraiment dans chaque réponse du module (js/data/access.js, js/platform/native.js).
// Toute entrée d'ici doit exister côté Swift ET côté faux StoreKit.
const READS = {
  products:    ['products', 'missing', 'canMakePayments'],
  productItem: ['id', 'displayName', 'displayPrice'],
  purchase:    ['status'],
  finish:      ['finished'],
  restore:     ['entitlements', 'cancelled'],
  current:     ['entitlements'],
  status:      ['canMakePayments'],
  redeemCode:  ['presented', 'cancelled'],
  // Preuve du téléchargement (essai rattaché à l'identifiant Apple, accessLinkApple)
  appTransaction: ['available', 'jws', 'reason'],
  // Transaction rendue par purchase(), par restore()/current() et par l'écouteur
  transaction: ['jws', 'transactionId'],
};

// Faux StoreKit des tests, chargé dans un contexte vm avec la coquille minimale qu'il enveloppe
function loadFakeStore(ROOT) {
  const py = fs.readFileSync(path.join(ROOT, 'tests/fake_store.py'), 'utf8');
  const js = py.split('FAKE_STORE = r"""')[1].split('\n"""')[0];
  const box = {
    console, JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, RegExp, Error, TypeError,
    setTimeout, clearTimeout, atob, btoa, escape, unescape,
    Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => false, registerPlugin: () => ({}) },
    supabase: { createClient: () => ({ rpc: async () => ({}), functions: { invoke: async () => ({}) } }) },
    __sb: { meId: () => 'compte-u', calls: [], co: { links: [] }, profiles: {}, users: {} },
    __stOpts: {},
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(js, box, { filename: 'fake_store.py' });
  return { st: box.__st, store: box.Capacitor.registerPlugin('MdlfStore') };
}

export default function ({ test, run, assert, sameJSON, ROOT }) {
  const MONTHLY = 'com.mdlf.training.pro.monthly';

  test('contrat natif : le module Swift est là et rend les huit méthodes du contrat', () => {
    const { src, tries } = swiftSource(ROOT);
    assert.ok(src, `StorePlugin.swift introuvable, contrat invérifiable :\n${(tries || []).join('\n')}`);
    for (const m of ['status', 'products', 'purchase', 'finish', 'restore', 'current', 'redeemCode', 'appTransaction']) {
      assert.ok(new RegExp(`CAPPluginMethod\\(name: "${m}"`).test(src), `méthode ${m} absente de pluginMethods`);
      assert.ok(swiftBlock(src, m), `méthode ${m} sans implémentation`);
    }
    assert.ok(/jsName = "MdlfStore"/.test(src), 'le module ne s\'appelle plus MdlfStore');
    // L'événement de l'écouteur, auquel l'app s'abonne (un seul des deux noms)
    assert.ok(/notifyListeners\("transaction"/.test(src) && /notifyListeners\("change"/.test(src),
      'l\'écouteur n\'émet plus transaction et change');
  });

  test('contrat natif : chaque clé lue par l\'app existe dans la charge utile du Swift', () => {
    const { src } = swiftSource(ROOT);
    assert.ok(src, 'StorePlugin.swift introuvable');
    const productItem = swiftKeys(swiftBetween(src, 'private static func describe(_ product: Product)',
      'private static func describe(_ period:'));
    const transaction = swiftKeys(swiftBetween(src, 'private static func describe(_ transaction: StoreKit.Transaction', null));
    const blocks = {
      products: swiftKeys(swiftBlock(src, 'products')),
      purchase: swiftKeys(swiftBlock(src, 'purchase')),
      finish: swiftKeys(swiftBlock(src, 'finish')),
      restore: swiftKeys(swiftBlock(src, 'restore')),
      current: swiftKeys(swiftBlock(src, 'current')),
      status: swiftKeys(swiftBlock(src, 'status')),
      redeemCode: swiftKeys(swiftBlock(src, 'redeemCode')),
      appTransaction: swiftKeys(swiftBlock(src, 'appTransaction')),
      productItem, transaction,
    };
    const missing = [];
    for (const [where, keys] of Object.entries(READS)) {
      for (const k of keys) if (!blocks[where].has(k)) missing.push(`${where}.${k}`);
    }
    assert.equal(missing.length, 0, `clés lues par l'app et absentes du Swift : ${missing.join(', ')}`);
    // Pièges connus : le prix affichable est displayPrice (displayName pour le nom) ; price est un
    // nombre, inutilisable tel quel à l'écran
    assert.ok(productItem.has('price'), 'le Swift ne rend plus le prix numérique');
    assert.ok(!READS.productItem.includes('price'), 'l\'app lirait le prix numérique au lieu de displayPrice');
    // restore() ne rend PAS de jws à la racine : il est dans chaque entitlement
    assert.ok(!blocks.restore.has('jws'), 'restore() rend un jws à la racine : le contrat a changé');
    assert.ok(transaction.has('jws'), 'une transaction sans jws : le serveur n\'aurait rien à vérifier');
  });

  test('contrat natif : appTransaction() rend la preuve d\'Apple, refuse .unverified et ne demande rien sans geste', () => {
    const { src } = swiftSource(ROOT);
    assert.ok(src, 'StorePlugin.swift introuvable');
    const b = swiftBlock(src, 'appTransaction');
    // La preuve signée, et le champ STABLE de StoreKit (pas originalPurchaseDate, fixe en Sandbox)
    assert.ok(/StoreKit\.AppTransaction\.shared/.test(b), 'AppTransaction.shared absent');
    assert.ok(/result\.jwsRepresentation/.test(b), 'le JWS d\'Apple n\'est pas rendu');
    assert.ok(/app\.appTransactionID/.test(b), 'appTransactionID (identifiant stable) absent');
    // .unverified : refusé, sans JWS (le JWS n'est lu que dans la branche .verified)
    const unverified = swiftBetween(b, 'case .unverified', 'case .verified');
    assert.ok(unverified && /"reason": "unverified"/.test(unverified) && !/jws/i.test(unverified.replace(/\/\/\/.*$/gm, '')),
      'une preuve non vérifiée par StoreKit serait transmise');
    // refresh() ouvre la fenêtre d'Apple : seulement sur demande explicite du web
    assert.ok(/let refresh = call\.getBool\("refresh"\) \?\? false/.test(b), 'refresh demandé sans geste');
    assert.ok(/if refresh \{\s*\n\s*result = try await StoreKit\.AppTransaction\.refresh\(\)/.test(b), 'refresh() hors du cas demandé');
    // Les échecs ne sont pas des rejets : le web traite « pas de preuve » sans exception
    assert.ok(!/call\.reject/.test(b), 'appTransaction rejette au lieu de dire « pas de preuve »');
    for (const reason of ['cancelled', 'unavailable', 'unverified', 'noIdentifier']) {
      assert.ok(new RegExp(`"reason": "${reason}"`).test(b), `raison ${reason} absente`);
    }
  });

  test('contrat natif : le faux StoreKit des tests copie le Swift, clé pour clé', async () => {
    const { src } = swiftSource(ROOT);
    assert.ok(src, 'StorePlugin.swift introuvable');
    const { st, store } = loadFakeStore(ROOT);
    st.addCode('K7M2QX9PR4TD', { kind: 'days', days: 30 });

    const products = await store.products();
    const purchase = await store.purchase({ productId: MONTHLY });
    const restore = await store.restore();
    const current = await store.current();
    const status = await store.status();
    const redeem = await store.redeemCode();
    st.fail.redeem = 'cancel';
    const redeemCancelled = await store.redeemCode();
    st.fail.redeem = null;
    const finish = await store.finish({ transactionId: purchase.transactionId });
    const appTx = await store.appTransaction();
    st.appleProof = 'unavailable';
    const appTxNone = await store.appTransaction();
    st.appleProof = 'ok';
    st.fail.appleRefresh = 'cancel';
    const appTxCancelled = await store.appTransaction({ refresh: true });
    st.fail.appleRefresh = null;

    const keysOf = o => new Set(Object.keys(o || {}));
    const fake = {
      products: keysOf(products),
      productItem: keysOf(products.products[0]),
      purchase: keysOf(purchase),
      finish: keysOf(finish),
      restore: keysOf(restore),
      current: keysOf(current),
      status: keysOf(status),
      redeemCode: new Set([...keysOf(redeem), ...keysOf(redeemCancelled)]),
      appTransaction: new Set([...keysOf(appTx), ...keysOf(appTxNone), ...keysOf(appTxCancelled)]),
      transaction: keysOf(restore.entitlements[0]),
    };
    const productItem = swiftKeys(swiftBetween(src, 'private static func describe(_ product: Product)',
      'private static func describe(_ period:'));
    const transaction = swiftKeys(swiftBetween(src, 'private static func describe(_ transaction: StoreKit.Transaction', null));
    const swift = {
      products: swiftKeys(swiftBlock(src, 'products')),
      purchase: new Set([...swiftKeys(swiftBlock(src, 'purchase')), ...transaction]),
      finish: swiftKeys(swiftBlock(src, 'finish')),
      restore: swiftKeys(swiftBlock(src, 'restore')),
      current: swiftKeys(swiftBlock(src, 'current')),
      status: swiftKeys(swiftBlock(src, 'status')),
      redeemCode: swiftKeys(swiftBlock(src, 'redeemCode')),
      appTransaction: swiftKeys(swiftBlock(src, 'appTransaction')),
      productItem, transaction,
    };
    // Rien d'inventé par le faux : un faux plus généreux que le vrai cacherait le bogue
    const invented = [];
    for (const [where, keys] of Object.entries(fake)) {
      for (const k of keys) if (!swift[where].has(k)) invented.push(`${where}.${k}`);
    }
    assert.equal(invented.length, 0, `clés du faux StoreKit absentes du Swift : ${invented.join(', ')}`);
    // Et tout ce que l'app lit est bien rendu par le faux
    const absent = [];
    for (const [where, keys] of Object.entries(READS)) {
      for (const k of keys) if (!fake[where].has(k)) absent.push(`${where}.${k}`);
    }
    assert.equal(absent.length, 0, `clés lues par l'app et absentes du faux StoreKit : ${absent.join(', ')}`);
    // Formes : ce que l'app affiche ou transmet doit avoir le bon type
    assert.equal(typeof products.products[0].displayPrice, 'string', 'displayPrice doit être une chaîne');
    assert.equal(typeof products.products[0].displayName, 'string');
    assert.equal(typeof products.canMakePayments, 'boolean');
    assert.equal(purchase.status, 'success');
    assert.equal(typeof purchase.jws, 'string');
    assert.equal(typeof purchase.transactionId, 'string', 'les identifiants partent en texte (entiers 64 bits)');
    assert.ok(Array.isArray(restore.entitlements) && restore.entitlements.length >= 1, 'restore sans droits');
    assert.ok(Array.isArray(current.entitlements));
    assert.equal(redeem.presented, true);
    assert.equal(finish.finished, true);
    // Annulation : la feuille d'Apple fermée n'est pas un succès
    sameJSON(redeemCancelled, { presented: false, cancelled: true });
    // Preuve du téléchargement : JWS en texte, et « pas de preuve » sans exception
    assert.equal(appTx.available, true);
    assert.equal(typeof appTx.jws, 'string');
    assert.equal(typeof appTx.appTransactionId, 'string', 'appTransactionId en texte (entier 64 bits chez Apple)');
    sameJSON(appTxNone, { available: false, reason: 'unavailable' });
    sameJSON(appTxCancelled, { available: false, reason: 'cancelled' });
    // Achat annulé : trois issues sans exception
    st.fail.purchase = 'cancel';
    sameJSON(await store.purchase({ productId: MONTHLY }), { status: 'userCancelled' });
    st.fail.purchase = 'pending';
    sameJSON(await store.purchase({ productId: MONTHLY }), { status: 'pending' });
    st.fail.purchase = null;
  });

  // Le test qui compte vraiment : les charges utiles du faux StoreKit (donc celles du Swift) sont
  // données telles quelles à l'app, et on regarde ce qu'elle en fait. Lire la mauvaise clé ne donne
  // plus un test vert : ici l'écran n'aurait aucune formule et la restauration n'enverrait rien.
  test('contrat natif : l\'app lit vraiment ce que le module envoie (formules, restauration)', async () => {
    const { st, store } = loadFakeStore(ROOT);
    const products = await store.products();
    st.owned = { productId: MONTHLY, originalId: 'apple-1', transactionId: 'tx-1', expiresAt: Date.now() + 30 * 86400000 };
    st.ownedGift = { productId: 'com.mdlf.training.access.gift', originalId: 'apple-2', transactionId: 'tx-2', expiresAt: null };
    const restore = await store.restore();
    const r = await run(`(async () => {
      const u = account.user, saved = { ...access }, realSb = sb, nativeStore = Native.store;
      const sent = [], finished = [];
      try {
        account.user = { id: '11111111-2222-3333-4444-555555555555' };
        accessReset(account.user.id);
        Native.store = { available: true,
          products: async () => (${JSON.stringify(products)}),
          restore: async () => (${JSON.stringify(restore)}),
          finish: async id => { finished.push(id); return true; } };
        sb = { functions: { invoke: async (fn, o) => { sent.push(o.body.jws); return { data: { ok: true,
          access: { status: 'active', paywall_on: true, can_write: true, server_now: Date.now() } }, error: null }; } } };
        const list = await accessLoadProducts();
        const res = await accessRestore();
        return [list.map(p => [p.id, p.price, p.label]), res, sent.length, finished, canWrite()];
      } finally { account.user = u; Object.assign(access, saved); sb = realSb; Native.store = nativeStore;
        localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    assert.equal(r[0].length, 2, 'aucune formule lue : l\'écran d\'abonnement serait vide');
    assert.equal(r[0][0][1], '5,99 €', 'le prix affiché doit être displayPrice, pas le nombre');
    assert.equal(r[0][1][1], '41,99 €');
    assert.ok(r[0][0][2], 'le nom du produit (displayName) n\'est pas lu');
    sameJSON(r[1], { ok: true }, 'restauration : le serveur n\'a rien reçu');
    assert.equal(r[2], 2, 'les deux droits en cours (abonnement et accès offert) doivent partir');
    sameJSON(r[3], ['tx-1', 'tx-2'], 'chaque transaction vérifiée doit être terminée chez Apple');
    assert.equal(r[4], true, 'accès rendu après la restauration');
  });

  // Même idée pour la preuve Apple : la charge utile du faux (donc du Swift) donnée telle quelle à
  // l'app ; elle doit envoyer le JWS au serveur, et ne rien envoyer quand il n'y a pas de preuve.
  test('contrat natif : l\'app envoie vraiment la preuve que le module rend', async () => {
    const { st, store } = loadFakeStore(ROOT);
    const proof = await store.appTransaction();
    st.appleProof = 'unavailable';
    const none = await store.appTransaction();
    const r = await run(`(async () => {
      const u = account.user, saved = { ...access }, realSb = sb, nativeStore = Native.store;
      const sent = [];
      let next = ${JSON.stringify(proof)};
      try {
        account.user = { id: '11111111-2222-3333-4444-555555555555' };
        accessReset(account.user.id);
        access.state = cleanAccess({ status: 'trial', paywall_on: true, can_write: true, apple_linked: false, server_now: Date.now() });
        Native.store = { available: true, appTransaction: async () => next };
        sb = { functions: { invoke: async (fn, o) => { sent.push([fn, o.body.jws]); return { data: { ok: true,
          access: { status: 'trial', paywall_on: true, can_write: true, apple_linked: true, server_now: Date.now() } }, error: null }; } } };
        const ok = await accessLinkApple();
        next = ${JSON.stringify(none)};
        access.state = cleanAccess({ status: 'trial', paywall_on: true, can_write: true, apple_linked: false, server_now: Date.now() });
        const ko = await accessLinkApple();
        return [ok, ko, sent];
      } finally { account.user = u; Object.assign(access, saved); sb = realSb; Native.store = nativeStore;
        localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    sameJSON(r[0], { ok: true });
    sameJSON(r[1], { ok: false, kind: 'apple_unavailable' });
    sameJSON(r[2], [['verify-app-transaction', proof.jws]], 'la preuve doit partir telle quelle, et seulement elle');
  });

  test('contrat natif : le contrat écrit dit la même chose que le Swift', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs/PAYANT_V1.md'), 'utf8');
    for (const k of ['displayPrice', 'displayName', 'entitlements', 'canMakePayments', 'appAccountToken',
      'userCancelled', 'presented', 'finish', 'appTransaction()', 'appTransactionId', 'noIdentifier']) {
      assert.ok(doc.includes(k), `${k} absent de docs/PAYANT_V1.md : la spécification ment sur le plugin`);
    }
    assert.ok(!/`purchase\(\{ productId \}\)` : achat, puis renvoie le JWS/.test(doc),
      'le contrat décrit encore purchase comme rendant directement le JWS');
  });
}
