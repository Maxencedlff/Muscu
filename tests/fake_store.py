"""StoreKit et serveur d'accès payant simulés, pour tester l'abonnement sans iPhone ni réseau.

FAKE_STORE est injecté APRÈS FAKE_ACCOUNT (tests/fake_account.py) : il enveloppe la coquille iOS et
le client Supabase factices au lieu de les remplacer, pour que le compte, les Amis et le coach
continuent de marcher.

Ce qu'il ajoute, selon docs/PAYANT_V1.md :
- RPC `my_access()` (crée la ligne `entitlements` en `trial` au premier appel : c'est le serveur qui
  démarre l'essai, à SON heure) et `access_state()` (lecture seule, renvoie null sans ligne) ;
- RPC `redeem_gift_code(code)` : code cadeau maison, saisie souple. Un refus de code n'est **pas** une
  exception : elle renvoie `{ ok, error, kind, access }` avec `error` valant `invalid_code`,
  `code_expired`, `code_used_up` ou `already_redeemed`. Seul `rate_limited` (10 essais par heure) est
  levé. `kind = 'lifetime'` donne l'accès à vie, `kind = 'days'` cumule des jours (`gift_until`) ;
- fonction Edge `verify-purchase` : refuse un JWS mal formé (`invalid_jws`), une autre app
  (`bad_bundle`), une transaction déjà rattachée à un autre compte (`transaction_taken`) et une
  transaction inconnue d'Apple (`not_found`) ; sinon elle écrit `entitlements` (seule écriture) ;
- module Capacitor `MdlfStore`, COPIE CLÉ POUR CLÉ de ios/App/App/StorePlugin.swift (vérifié par
  tests/unit/store-contract.mjs, qui lit le vrai Swift) :
  `products()` → `{ products: [{ id, displayName, description, displayPrice, price (nombre),
  currency, period, introEligible }], missing, canMakePayments }` — le prix affichable est
  `displayPrice`, jamais `price` ;
  `purchase({ productId, appAccountToken? })` NE REJETTE PAS : il résout
  `{ status: 'success' | 'userCancelled' | 'pending' }`, et pour un succès la transaction entière
  (`jws`, `transactionId`, `originalTransactionId`, `productId`, `expiresAt`…) ;
  `finish({ transactionId })` → `{ finished, reason? }`, obligatoire après la vérification par le
  serveur (sans lui, la même transaction est réannoncée : `__st.open` liste celles qui restent
  ouvertes) ;
  `restore()` → `{ synced, cancelled, entitlements: [transaction…], unverified }` — le JWS est dans
  CHAQUE entitlement, jamais à la racine ;
  `current()` → `{ entitlements, unverified }` ; `status()` → `{ canMakePayments, subscriptionIds,
  giftId }` ; `redeemCode()` → `{ presented: true }` ou `{ presented: false, cancelled: true }` ;
  événement `transaction`, émis aussi sous le nom `change`, avec la transaction entière.
  `__st.fail.redeem = 'cancel'` ferme la feuille de codes, `__st.canMakePayments = false` bloque les
  achats (Temps d'écran), `__st.cancelRestore = true` fait fermer la fenêtre d'AppStore.sync().
- déclencheur `before insert on public.sessions` : une séance NOUVELLE est refusée en P0001
  `paywall_locked` quand le verrou est allumé et `can_write` faux ; les corrections de séances déjà
  sur le compte et les suppressions passent. `__st.noTrigger = true` l'éteint ; les refus sont dans
  `__st.calls` sous `['locked', nombre, identifiants]`.

Règles du 28/10/2026 (supabase/migrations/20261029000000_payant_apple.sql) :
- `appTransaction({ refresh? })` → `{ available: true, jws, appTransactionId, environment, bundleId,
  originalPurchaseDate, appVersion, originalAppVersion }` ou `{ available: false, reason }`, comme le
  Swift. `__st.appleId` : identifiant de téléchargement Apple de l'« iPhone » (le même pour tous les
  comptes de la page) ; `__st.appleProof = 'unavailable' | 'unverified'` : pas de preuve ;
  `__st.appleBundle`, `__st.appleEnv` : preuve d'une autre app, Sandbox.
- fonction Edge `verify-app-transaction` : refuse `invalid_jws`, `bad_bundle`, `bad_environment`
  (Sandbox sans `__st.allowSandbox`), puis lie le compte : `__st.appleIds[id]` = départ de l'essai du
  PREMIER compte qui l'a présenté, `__st.appleLinks[compte]` = ses identifiants. Appels dans
  `__st.calls` sous `['apple-link', identifiant]`.
- l'essai d'un compte part du plus ancien entre son départ et celui de ses identifiants Apple ; sans
  identifiant lié, vu sur iPhone (`my_access({ p_platform: 'ios' })`) et verrou allumé, il est plafonné
  à `__st.unprovenDays` (3) jours ; `trial_shared` : l'essai vient d'un identifiant Apple déjà utilisé
  par un autre compte. `__st.fail.config = 'offline'` : app_config injoignable (verrou inconnu).
  `__st.appleUsed(id, joursAvant)` : cet identifiant Apple a eu son premier essai il y a N jours.
- `from('app_config')` : sans compte, seule la ligne `paywall_on` est rendue (politique anon) ;
  appels dans `__st.calls` sous `['app_config', 'anon' | 'auth']`.

Deux horloges SÉPARÉES : celle du serveur (`__st.serverShift`) et celle de l'appareil
(`__st.deviceShift`, qui décale `Date.now()` dans la page). Un test peut donc avancer l'horloge de
l'iPhone sans toucher à celle du serveur, et vérifier que rien ne se débloque ni ne se bloque.

État dans `window.__st` :
  paywallOn (verrou), trialDays, ents (par compte), taken (original_transaction_id → compte),
  products, owned (achat présent chez Apple, pour la restauration), calls, fail
  (`fail.access = 'offline'`, `fail.purchase = 'cancel' | 'fail'`, `fail.verify = 'invalid_jws' | …`).
Outils : `__st.startTrial(daysAgo)` (essai démarré il y a N jours, à l'heure du serveur),
`__st.giveGift()`, `__st.emitTransaction(productId)` (transaction poussée par Apple : code utilisé,
renouvellement, achat sur un autre appareil).
Réglages avant chargement : `window.__stOpts` (ex. `{ paywallOn: true, store: false }`).
"""

FAKE_STORE = r"""
(() => {
  const st = window.__st = Object.assign({
    paywallOn: false, trialDays: 90, serverShift: 0, deviceShift: 0, store: true,
    ents: {}, taken: {}, owned: null, ownedGift: null, noTrigger: false,
    fail: {}, calls: [], listeners: [], changeListeners: [], open: [], missing: [], n: 0,
    codes: {}, redeemed: [], tries: {},
    canMakePayments: true, cancelRestore: false,
    // Règle 1 : identifiant Apple de l'« iPhone », preuves et liaisons côté serveur
    appleId: 'dl-iphone-1', appleProof: 'ok', appleBundle: null, appleEnv: 'Production', allowSandbox: false,
    appleIds: {}, appleLinks: {}, unprovenDays: 3,
    // Décrits comme le Swift : displayPrice (affichable) ET price (nombre), displayName, currency…
    products: [
      { id: 'com.mdlf.training.pro.monthly', displayName: 'MDLF Training mensuel', description: 'Abonnement mensuel',
        displayPrice: '5,99 €', price: 5.99, currency: 'EUR', period: { unit: 'month', value: 1 }, introEligible: false },
      { id: 'com.mdlf.training.pro.yearly', displayName: 'MDLF Training annuel', description: 'Abonnement annuel',
        displayPrice: '41,99 €', price: 41.99, currency: 'EUR', period: { unit: 'year', value: 1 }, introEligible: false },
    ],
  }, window.__stOpts || {});
  const DAY = 86400000;
  const BUNDLE = 'com.mdlf.training';
  const GIFT = 'com.mdlf.training.access.gift';

  // Deux horloges : celle de l'appareil (que les tests trafiquent) et celle du serveur
  const realNow = Date.now;
  Date.now = () => realNow() + (st.deviceShift || 0);
  const serverNow = () => realNow() + (st.serverShift || 0);
  const iso = ms => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
  const log = (...a) => st.calls.push(a);

  const b64 = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const GIFT_ID = 'com.mdlf.training.access.gift';
  const SUB_IDS = ['com.mdlf.training.pro.monthly', 'com.mdlf.training.pro.yearly'];
  // Même charge utile que StorePlugin.describe(_ transaction:, jws:) : identifiants en TEXTE,
  // dates en millisecondes, rien de plus, rien de moins
  const describeTx = tx => ({
    jws: makeJws(tx, tx.bundleId || BUNDLE),
    transactionId: String(tx.transactionId),
    originalTransactionId: String(tx.originalId),
    productId: tx.productId,
    purchasedAt: tx.purchasedAt == null ? serverNow() : tx.purchasedAt,
    expiresAt: tx.expiresAt == null ? null : tx.expiresAt,
    revokedAt: tx.revokedAt == null ? null : tx.revokedAt,
    isUpgraded: false,
    familyShared: !!tx.familyShared,
    environment: tx.environment || 'production',
    subscription: SUB_IDS.includes(tx.productId),
    gift: tx.productId === GIFT_ID,
    reason: tx.reason || 'purchase',
  });
  const unb64 = s => JSON.parse(decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')))));
  // Transaction signée par Apple, telle que StoreKit 2 la rend
  const makeJws = (tx, bundleId = BUNDLE) => 'jws.' + b64({ ...tx, bundleId }) + '.sig';

  const me = () => (window.__sb && __sb.meId ? __sb.meId() : null);

  // ── entitlements (seule source de vérité, écrite seulement par le serveur) ──
  const row = (uid, create) => {
    let e = st.ents[uid];
    if (!e && create) {
      e = st.ents[uid] = { status: 'trial', product_id: null, expires_at: null,
        original_transaction_id: null, trial_started_at: serverNow(), gift: false, gift_until: null };
    }
    return e || null;
  };
  // Élève suivi par un coach : accès gratuit tant qu'il est suivi (état du faux coach de fake_account)
  const inCoachTeam = uid => !!(window.__sb && __sb.co && __sb.co.links.some(l => l.student === uid));

  // Ce que my_access() / access_state() renvoient, calculé à l'heure du SERVEUR
  // Ordre des statuts quand plusieurs droits se cumulent : gift > active > coach_team > trial > expired
  const stateOf = (uid, e) => {
    const now = serverNow();
    const coach = inCoachTeam(uid);
    const giftDays = e.gift_until !== null && e.gift_until > now ? e.gift_until : null;
    const paid = e.status === 'active' && e.expires_at !== null && e.expires_at > now ? e.expires_at : null;
    // Règle 1 : le plus ancien des départs (compte, identifiants Apple liés) ; sans preuve et verrou
    // allumé, essai plafonné à unprovenDays jours
    const links = st.appleLinks[uid] || [];
    const appleAt = links.length ? Math.min(...links.map(id => st.appleIds[id])) : Infinity;
    let trialEnd = Math.min(e.trial_started_at, appleAt) + st.trialDays * DAY;
    // Plafond sans preuve : seulement pour un compte qui s'est déclaré sur iPhone (my_access('ios'))
    if (st.paywallOn && e.ios_seen && !links.length) trialEnd = Math.min(trialEnd, e.trial_started_at + st.unprovenDays * DAY);
    const shared = appleAt < e.trial_started_at;
    let status, until = null;
    if (e.gift) { status = 'gift'; until = null; }
    else if (giftDays && (!paid || giftDays > paid)) { status = 'gift'; until = giftDays; }
    else if (paid) { status = 'active'; until = paid; }
    else if (coach) { status = 'coach_team'; until = null; }
    else if (trialEnd > now) { status = 'trial'; until = trialEnd; }
    else { status = 'expired'; until = Math.max(trialEnd, e.expires_at || 0, e.gift_until || 0) || null; }
    const days = until === null ? null : Math.max(0, Math.ceil((until - now) / DAY));
    const can = !st.paywallOn || status !== 'expired';
    return { status, until: iso(until), paywall_on: !!st.paywallOn, trial_days: st.trialDays,
      days_left: status === 'expired' ? null : days, can_write: can,
      gift: !!e.gift, gift_until: iso(e.gift_until), coach_team: coach, apple_linked: links.length > 0, trial_shared: shared, server_now: iso(now) };
  };

  st.startTrial = daysAgo => { const e = row(me(), true); e.status = 'trial'; e.gift = false; e.expires_at = null;
    e.trial_started_at = serverNow() - daysAgo * DAY; };
  st.appleUsed = (id, daysAgo) => { st.appleIds[id] = serverNow() - daysAgo * DAY; };
  st.giveGift = () => { const e = row(me(), true); e.gift = true; e.product_id = GIFT; };
  st.subscribe = (productId, days = 30) => { const e = row(me(), true); e.status = 'active'; e.product_id = productId;
    e.expires_at = serverNow() + days * DAY; e.original_transaction_id = 'orig-' + (++st.n); };

  const pgErr = message => ({ data: null, error: { code: 'P0001', message, details: null, hint: null } });
  const offline = () => ({ data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } });

  // Codes cadeaux maison : __st.addCode('CODE', { kind, days, maxUses, expires })
  st.addCode = (code, { kind = 'days', days = 90, maxUses = 1, expires = null } = {}) => {
    st.codes[code] = { kind, days, maxUses, uses: 0, expires };
    return code;
  };
  const CODE_RE = /^[A-HJ-NP-Z2-9]{10,24}$/;
  // Un refus de code n'est PAS une exception : il revient dans { ok: false, error } (sinon Postgres
  // annulerait le comptage des essais et on pourrait deviner des codes sans fin)
  const redeem = (uid, raw) => {
    const code = String(raw == null ? '' : raw).toUpperCase().replace(/[\s-]/g, '');
    const tries = (st.tries[uid] || []).filter(t => t > serverNow() - 3600000);
    st.tries[uid] = tries;
    if (tries.length >= 10) return pgErr('rate_limited');
    tries.push(serverNow());
    const c = CODE_RE.test(code) ? st.codes[code] : null;
    const e = row(uid, true);
    const no = error => ({ ok: false, error, kind: null, access: stateOf(uid, e) });
    if (!c) return no('invalid_code');
    if (c.expires !== null && c.expires <= serverNow()) return no('code_expired');
    if (st.redeemed.some(r => r.code === code && r.user === uid)) return no('already_redeemed');
    if (c.uses >= c.maxUses) return no('code_used_up');
    c.uses++;
    st.redeemed.push({ code, user: uid });
    if (c.kind === 'lifetime') { e.gift = true; e.gift_until = null; }
    else e.gift_until = Math.max(serverNow(), e.gift_until || 0, e.expires_at || 0) + c.days * DAY;
    return { ok: true, error: null, kind: c.kind, access: stateOf(uid, e) };
  };

  const accessRpcs = {
    // p_platform 'ios' : le compte est vu sur iPhone, pour toujours
    my_access: (uid, args) => { const e = row(uid, true); if (args.p_platform === 'ios') e.ios_seen = true;
      log('platform', args.p_platform || ''); return stateOf(uid, e); },
    access_state: uid => { const e = row(uid, false); return e ? stateOf(uid, e) : null; },
    redeem_gift_code: (uid, args) => redeem(uid, args.code),
  };
  const callAccess = async (fn, args) => {
    log('access', fn, JSON.stringify(args || {}));
    if (st.fail.access === 'offline') return offline();
    if (st.fail.access === 'hang') return new Promise(() => {});
    const uid = me();
    if (!uid) return { data: null, error: { code: '42501', message: 'permission denied' } };
    if (st.fail.access === 'server') return pgErr('boom');
    const out = accessRpcs[fn](uid, args || {});
    return out && out.error !== undefined && out.data === null ? out : { data: out, error: null };
  };

  // ── verify-purchase : une preuve d'achat n'est jamais crue sur parole ──
  const verifyPurchase = async body => {
    log('verify', JSON.stringify(body || {}));
    if (st.fail.access === 'offline') throw new TypeError('Failed to fetch');
    const fail = (status, b) => ({ data: null, error: { name: 'FunctionsHttpError',
      message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => b } } });
    const uid = me();
    if (!uid) return fail(401, { error: 'auth' });
    // 503 : Apple injoignable. L'app ne doit pas terminer la transaction, elle reviendra.
    if (st.fail.verify === 'apple_down') return fail(503, { error: 'apple_unreachable' });
    if (st.fail.verify) return fail(400, { error: st.fail.verify });
    const jws = body && body.jws;
    let tx = null;
    try { if (/^jws\..*\.sig$/.test(String(jws))) tx = unb64(String(jws).slice(4, -4)); } catch (e) { tx = null; }
    if (!tx || !tx.productId) return fail(400, { error: 'invalid_jws' });
    if (tx.bundleId !== BUNDLE) return fail(400, { error: 'bad_bundle' });
    // Relecture auprès d'Apple : une transaction inconnue est refusée
    if (tx.unknown) return fail(404, { error: 'not_found' });
    const taken = st.taken[tx.originalId];
    if (taken && taken !== uid) return fail(409, { error: 'transaction_taken' });
    st.taken[tx.originalId] = uid;
    const e = row(uid, true);
    e.original_transaction_id = tx.originalId;
    e.product_id = tx.productId;
    if (tx.productId === GIFT) { e.gift = true; e.status = 'gift'; e.expires_at = null; }
    else { e.status = 'active'; e.expires_at = tx.expiresAt; }
    return { data: { ok: true, access: stateOf(uid, e) }, error: null };
  };

  // ── verify-app-transaction : l'essai rattaché à l'identifiant Apple ──
  const verifyAppTransaction = async body => {
    if (st.fail.access === 'offline') throw new TypeError('Failed to fetch');
    const fail = (status, b) => ({ data: null, error: { name: 'FunctionsHttpError',
      message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => b } } });
    const uid = me();
    if (!uid) return fail(401, { error: 'auth' });
    if (st.fail.link) return fail(st.fail.link === 'down' ? 503 : 400, { error: st.fail.link });
    const jws = String((body && body.jws) || '');
    let p = null;
    try { if (/^appjws\..*\.sig$/.test(jws)) p = unb64(jws.slice(7, -4)); } catch (e) { p = null; }
    if (!p) return fail(400, { error: 'invalid_jws' });
    if (p.bundleId !== BUNDLE) return fail(400, { error: 'bad_bundle' });
    if (p.receiptType === 'Sandbox' && !st.allowSandbox) return fail(400, { error: 'bad_environment' });
    if (!p.appTransactionId) return fail(400, { error: 'no_app_transaction_id' });
    log('apple-link', p.appTransactionId);
    const e = row(uid, true);
    e.ios_seen = true;
    // La première liaison fixe la date (on conflict do nothing) : départ du compte si son essai court
    // encore, sinon maintenant (un vieux compte n'éteint pas l'essai d'un proche)
    if (!(p.appTransactionId in st.appleIds)) {
      st.appleIds[p.appTransactionId] = e.trial_started_at > serverNow() - st.trialDays * DAY ? e.trial_started_at : serverNow();
    }
    const links = st.appleLinks[uid] = st.appleLinks[uid] || [];
    if (!links.includes(p.appTransactionId)) links.push(p.appTransactionId);
    return { data: { ok: true, access: stateOf(uid, e) }, error: null };
  };

  // ── app_config : sans compte, seule la ligne paywall_on (politique anon) ──
  const appConfig = q => {
    const uid = me();
    log('app_config', uid ? 'auth' : 'anon');
    if (st.fail.access === 'offline') return offline();
    const rows = [{ key: 'paywall_on', value: !!st.paywallOn }];
    if (uid) rows.push({ key: 'trial_days', value: st.trialDays }, { key: 'trial_unproven_days', value: st.unprovenDays });
    if (st.fail.config === 'offline') return offline();
    const found = rows.filter(r => !q.key || r.key === q.key);
    return { data: q.single ? (found[0] || null) : found, error: null };
  };
  const appConfigQuery = () => {
    const q = { key: null, single: false };
    const chain = new Proxy({}, { get: (_, m) => {
      if (m === 'then') return (res, rej) => Promise.resolve(appConfig(q)).then(res, rej);
      return (...a) => { if (m === 'eq' && a[0] === 'key') q.key = a[1]; if (m === 'maybeSingle' || m === 'single') q.single = true; return chain; };
    } });
    return chain;
  };

  // ── Module natif MdlfStore (StoreKit 2) ──
  const period = id => (id.endsWith('yearly') ? 365 : 30);
  const buy = productId => {
    const p = st.products.find(x => x.id === productId);
    if (!p) throw new Error('produit inconnu');
    const n = ++st.n;
    st.owned = { productId, originalId: 'apple-' + n, transactionId: 'tx-' + n, expiresAt: serverNow() + period(productId) * DAY };
    return st.owned;
  };
  // Transaction rendue sans être terminée : elle reste ouverte jusqu'à finish()
  const openTx = tx => { if (!st.open.includes(tx.transactionId)) st.open.push(tx.transactionId); return tx; };
  // Droits en cours chez Apple (Transaction.currentEntitlements) : abonnement et accès offert
  // peuvent coexister. __st.owned garde le dernier abonnement, __st.ownedGift l'accès offert.
  const entitlements = () => {
    const list = [st.owned, st.ownedGift].filter(Boolean).map(tx => { openTx(tx); return describeTx(tx); });
    return { entitlements: list, unverified: st.unverified || 0 };
  };
  const storePlugin = {
    // Les produits qu'Apple ne connaît pas encore sortent dans `missing`, pas dans `products`
    products: async () => {
      log('products');
      const miss = st.missing || [];
      return { products: st.products.filter(p => !miss.includes(p.id)).map(p => ({ ...p })),
        missing: [...miss], canMakePayments: st.canMakePayments !== false };
    },
    // Ne rejette jamais : trois issues, comme le Swift
    purchase: async ({ productId, appAccountToken }) => {
      log('purchase', productId, appAccountToken || '');
      if (st.fail.purchase === 'cancel') return { status: 'userCancelled' };
      if (st.fail.purchase === 'pending') return { status: 'pending' };
      if (st.fail.purchase === 'fail') return { status: 'unknown' };
      const tx = buy(productId);
      openTx(tx);
      return { status: 'success', ...describeTx(tx) };
    },
    // Obligatoire après la vérification : la transaction ne sera plus réannoncée
    finish: async ({ transactionId }) => {
      log('finish', String(transactionId));
      const known = st.open.includes(transactionId);
      st.open = st.open.filter(id => id !== transactionId);
      return known ? { finished: true } : { finished: false, reason: 'notFound' };
    },
    // AppStore.sync() puis les droits en cours ; la fenêtre fermée n'est pas une erreur
    restore: async () => {
      log('restore');
      const cancelled = !!st.cancelRestore;
      return { synced: !cancelled, cancelled, ...entitlements() };
    },
    current: async () => { log('current'); return entitlements(); },
    status: async () => ({ canMakePayments: st.canMakePayments !== false, subscriptionIds: [...SUB_IDS], giftId: GIFT_ID }),
    // Preuve du téléchargement (AppTransaction), mêmes clés que StorePlugin.appTransaction
    appTransaction: async ({ refresh } = {}) => {
      log('appTransaction', refresh ? 'refresh' : '');
      if (refresh && st.fail.appleRefresh === 'cancel') return { available: false, reason: 'cancelled' };
      if (st.appleProof === 'unavailable' && !(refresh && st.fail.appleRefresh === 'ok')) return { available: false, reason: 'unavailable' };
      if (st.appleProof === 'unverified') return { available: false, reason: 'unverified' };
      const bundleId = st.appleBundle || BUNDLE;
      const payload = { appTransactionId: st.appleId, bundleId, receiptType: st.appleEnv,
        originalPurchaseDate: serverNow() - 30 * DAY, receiptCreationDate: serverNow() };
      return { available: true, jws: 'appjws.' + b64(payload) + '.sig', appTransactionId: st.appleId,
        environment: st.appleEnv === 'Sandbox' ? 'sandbox' : 'production', bundleId,
        originalPurchaseDate: payload.originalPurchaseDate, appVersion: '30', originalAppVersion: '1' };
    },
    redeemCode: async () => {
      log('redeemCode');
      return st.fail.redeem === 'cancel' ? { presented: false, cancelled: true } : { presented: true };
    },
    // Le module émet le même événement sous deux noms : l'app ne doit s'abonner qu'à un seul
    addListener: (ev, fn) => {
      if (ev === 'transaction') st.listeners.push(fn);
      if (ev === 'change') st.changeListeners.push(fn);
      return Promise.resolve({ remove() {} });
    },
  };
  // Transaction poussée par Apple : code d'offre utilisé, renouvellement, achat sur un autre appareil
  st.emitTransaction = (productId = GIFT, extra = {}) => {
    const n = ++st.n;
    const tx = { productId, originalId: 'apple-' + n, transactionId: 'tx-' + n,
      expiresAt: productId === GIFT ? null : serverNow() + period(productId) * DAY, ...extra };
    if (productId === GIFT) st.ownedGift = tx; else st.owned = tx;
    openTx(tx);
    const ev = { ...describeTx(tx), source: 'update' };
    return Promise.all([...st.listeners, ...st.changeListeners].map(fn => fn({ ...ev })));
  };

  // ── On enveloppe la coquille et le client déjà posés par FAKE_ACCOUNT ──
  const cap = window.Capacitor;
  const register = cap.registerPlugin, avail = cap.isPluginAvailable;
  cap.registerPlugin = name => (name === 'MdlfStore' ? storePlugin : register(name));
  cap.isPluginAvailable = name => (name === 'MdlfStore' ? !!st.store : avail(name));

  // Verrou du serveur : déclencheur `before insert on public.sessions`. Une séance NOUVELLE est
  // refusée (P0001 paywall_locked) quand le verrou est allumé et `can_write` faux ; les corrections
  // de séances déjà sur le compte et les suppressions passent.
  // ATTENTION : écrire `sb` ici désignerait le client Supabase de l'app (js/data/account.js déclare
  // un `let sb` dans la même portée globale) : c'est `window.__sb`, le faux serveur, qu'il faut lire.
  const alreadyOnServer = id => ((window.__sb && window.__sb.upserted) || []).some(x => x.id === id);
  const lockedRows = rows => {
    const uid = me();
    const e = uid ? row(uid, false) : null;
    if (!uid || !e || !st.paywallOn || st.noTrigger) return [];
    if (stateOf(uid, e).can_write) return [];
    return (Array.isArray(rows) ? rows : []).filter(r => r && !r.deleted_at && !alreadyOnServer(r.id));
  };

  const create = window.supabase.createClient;
  window.supabase.createClient = (...args) => {
    const c = create(...args);
    const rpc = c.rpc.bind(c), invoke = c.functions.invoke.bind(c.functions);
    const from = c.from.bind(c);
    c.rpc = (fn, a) => (accessRpcs[fn] ? callAccess(fn, a) : rpc(fn, a));
    c.functions = { invoke: (fn, o) => (fn === 'verify-purchase' ? verifyPurchase(o && o.body)
      : fn === 'verify-app-transaction' ? verifyAppTransaction(o && o.body) : invoke(fn, o)) };
    c.from = table => {
      if (table === 'app_config') return appConfigQuery();
      const chain = from(table);
      if (table !== 'sessions') return chain;
      let rows = null;
      const wrap = new Proxy({}, { get: (_, m) => {
        if (m === 'then') return (res, rej) => {
          const refused = lockedRows(rows);
          if (refused.length) {
            log('locked', refused.length, JSON.stringify(refused.map(r => r.id)));
            return Promise.resolve({ data: null, error: { code: 'P0001', message: 'paywall_locked', details: null, hint: null } }).then(res, rej);
          }
          return Promise.resolve(chain).then(res, rej);
        };
        return (...args2) => { if (m === 'upsert') rows = args2[0]; chain[m](...args2); return wrap; };
      } });
      return wrap;
    };
    return c;
  };
})();
"""
