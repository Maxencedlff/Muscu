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
  productItem: ['id', 'displayName', 'displayPrice', 'introEligible', 'offer', 'period'],
  // Offre de lancement (essai gratuit d'Apple), lue par accessTrialOf
  offer:       ['paymentMode', 'period', 'periodCount'],
  purchase:    ['status'],
  finish:      ['finished'],
  restore:     ['entitlements', 'cancelled'],
  current:     ['entitlements'],
  status:      ['canMakePayments'],
  redeemCode:  ['presented', 'cancelled'],
  // Environnement de l'app (TestFlight = Sandbox), lu par accessStoreEnvironment
  environment: ['environment'],
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
    for (const m of ['status', 'products', 'purchase', 'finish', 'restore', 'current', 'redeemCode', 'environment']) {
      assert.ok(new RegExp(`CAPPluginMethod\\(name: "${m}"`).test(src), `méthode ${m} absente de pluginMethods`);
      assert.ok(swiftBlock(src, m), `méthode ${m} sans implémentation`);
    }
    assert.ok(/jsName = "MdlfStore"/.test(src), 'le module ne s\'appelle plus MdlfStore');
    // Modèle B : plus de preuve AppTransaction ni d'« Accès offert » dans le module.
    // AppTransaction.shared sert SEULEMENT à lire l'environnement (environment()), jamais refresh()
    // (fenêtre du mot de passe Apple), jamais de JWS d'AppTransaction envoyé au web
    const outsideEnv = src.replace(swiftBlock(src, 'environment'), '');
    assert.ok(!/appTransaction|AppTransaction/.test(outsideEnv.replace(/^\s*\/\/\/.*$/gm, '')), 'AppTransaction utilisé hors de environment()');
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/AppTransaction\.refresh|\.refresh\(\)/.test(code), 'AppTransaction.refresh() demanderait le mot de passe Apple');
    assert.ok(/try await AppTransaction\.shared/.test(swiftBlock(src, 'environment')), 'environment() ne lit plus AppTransaction.shared');
    assert.ok(!/jwsRepresentation/.test(swiftBlock(src, 'environment')), 'environment() ne doit rendre aucune preuve');
    assert.ok(!/giftId|access\.gift|"gift"/.test(src), '« Accès offert » resté dans le Swift');
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
      environment: swiftKeys(swiftBlock(src, 'environment')),
      productItem, transaction,
      offer: swiftKeys(swiftBetween(src, 'let described: [String: Any] = [', 'out["offer"] = described')),
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

  test('contrat natif : VALEURS de l\'offre de lancement et clés de la période, telles que l\'app les lit', () => {
    const { src } = swiftSource(ROOT);
    assert.ok(src, 'StorePlugin.swift introuvable');
    // accessTrialOf n'annonce un essai que si paymentMode vaut exactement « freeTrial »
    assert.ok(/if mode == \.freeTrial \{ return "freeTrial" \}/.test(src), 'le Swift ne rend plus « freeTrial » pour un essai gratuit');
    assert.ok(/"paymentMode": name\(offer\.paymentMode\)/.test(src), 'paymentMode ne passe plus par name(_ mode:)');
    // Période de l'offre et du produit : { unit, value }, unit parmi day, week, month, year
    const period = swiftBetween(src, 'private static func describe(_ period: Product.SubscriptionPeriod)', 'private static func name(');
    const keys = swiftKeys(period);
    for (const k of ['unit', 'value']) assert.ok(keys.has(k), `clé ${k} absente de describe(_ period:)`);
    for (const u of ['day', 'week', 'month', 'year']) assert.ok(period.includes(`unit = "${u}"`), `unité ${u} absente`);
    // … et l'app lit exactement ces valeurs
    sameJSON(run('ACCESS_UNITS'), ['day', 'week', 'month', 'year']);
    assert.ok(/o\.paymentMode !== 'freeTrial'/.test(fs.readFileSync(path.join(ROOT, 'js/data/access.js'), 'utf8')), 'l\'app ne compare plus à « freeTrial »');
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
    const environment = await store.environment();

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
      environment: keysOf(environment),
      offer: keysOf(products.products[0].offer),
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
      environment: swiftKeys(swiftBlock(src, 'environment')),
      productItem, transaction,
      offer: swiftKeys(swiftBetween(src, 'let described: [String: Any] = [', 'out["offer"] = described')),
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
    // Offre de lancement : rendue seulement si la personne y a droit (introEligible)
    assert.equal(products.products[0].introEligible, true);
    assert.equal(products.products[0].offer.paymentMode, 'freeTrial');
    // Les identifiants vendus : ceux du Swift, du faux StoreKit et du catalogue de l'app (js/data/plans.js)
    const swiftSrc = swiftSource(ROOT).src;
    const block = /subscriptionIds = \[([^\]]+)\]/.exec(swiftSrc);
    assert.ok(block, 'liste subscriptionIds introuvable dans le Swift');
    const swiftIds = [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
    assert.equal(swiftIds.length, 10, 'particulier + 4 paliers coach, mensuel et annuel');
    sameJSON(status, { canMakePayments: true, subscriptionIds: swiftIds });
    sameJSON(run('PLAN_IDS'), swiftIds, 'catalogue de l\'app différent du Swift');
    // Aucun achat non consommable (« Accès offert » supprimé le 28/10, achat à vie refusé le 31/10)
    assert.ok(!/lifetime|Non-Consumable|nonConsumable/.test(swiftSrc), 'achat à vie resté dans le Swift');
    // Valeurs de l'environnement : celles de name(_ environment:), lues telles quelles par l'app
    for (const v of ['production', 'sandbox', 'other']) assert.ok(swiftSrc.includes(`return "${v}"`), `environnement ${v}`);
    assert.ok(/"environment": "unknown"/.test(swiftBlock(swiftSrc, 'environment')), 'environnement inconnu');
    sameJSON(environment, { environment: 'production' });
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
        return [list.map(p => [p.id, p.price, p.label]), res, sent.length, finished, canWrite(), list.map(p => p.trial)];
      } finally { account.user = u; Object.assign(access, saved); sb = realSb; Native.store = nativeStore;
        localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    assert.equal(r[0].length, 10, 'aucune formule lue : l\'écran d\'abonnement serait vide');
    assert.equal(r[0][0][1], '6,49 €', 'le prix affiché doit être displayPrice, pas le nombre');
    assert.equal(r[0][1][1], '55,00 €');
    assert.equal(r[0][2][1], '15,99 €', 'palier coach 10 élèves');
    assert.ok(r[0][0][2], 'le nom du produit (displayName) n\'est pas lu');
    sameJSON(r[1], { ok: true }, 'restauration : le serveur n\'a rien reçu');
    assert.equal(r[2], 1, 'le droit en cours (abonnement) doit partir');
    sameJSON(r[3], ['tx-1'], 'chaque transaction vérifiée doit être terminée chez Apple');
    // L'essai gratuit est lu chez StoreKit (offre de lancement), jamais écrit dans l'app
    sameJSON(r[5], Array(10).fill({ unit: 'month', value: 3 }), 'essai lu dans offer (StoreKit), pas inventé');
    assert.equal(r[4], true, 'accès rendu après la restauration');
  });

  test('contrat natif : le contrat écrit dit la même chose que le Swift', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs/PAYANT_V1.md'), 'utf8');
    for (const k of ['displayPrice', 'displayName', 'entitlements', 'canMakePayments', 'appAccountToken',
      'userCancelled', 'presented', 'finish', 'introEligible', 'paymentMode']) {
      assert.ok(doc.includes(k), `${k} absent de docs/PAYANT_V1.md : la spécification ment sur le plugin`);
    }
    assert.ok(!/`purchase\(\{ productId \}\)` : achat, puis renvoie le JWS/.test(doc),
      'le contrat décrit encore purchase comme rendant directement le JWS');
  });
}
