"""StoreKit et serveur d'accès payant simulés, pour tester l'abonnement sans iPhone ni réseau.

FAKE_STORE est injecté APRÈS FAKE_ACCOUNT (tests/fake_account.py) : il enveloppe la coquille iOS et
le client Supabase factices au lieu de les remplacer, pour que le compte, les Amis et le coach
continuent de marcher.

Ce qu'il ajoute, selon docs/PAYANT_V1.md (MODÈLE B : l'essai gratuit est l'offre de lancement d'Apple) :
- RPC `my_access()` (crée la ligne `entitlements` au premier appel, SANS rien donner : plus d'essai
  maison) et `access_state()` (lecture seule, renvoie null sans ligne). Statuts : `none`, `active`
  (offre de lancement comprise : `intro_offer`, `intro_until`), `expired`, `gift` (code maison),
  `coach_team` ;
- RPC `redeem_gift_code(code)` : code cadeau maison, saisie souple. Un refus de code n'est **pas** une
  exception : elle renvoie `{ ok, error, kind, access }` avec `error` valant `invalid_code`,
  `code_expired`, `code_used_up` ou `already_redeemed`. Seul `rate_limited` (10 essais par heure) est
  levé. `kind = 'lifetime'` donne l'accès à vie, `kind = 'days'` cumule des jours (`gift_until`) ;
- fonction Edge `verify-purchase` : refuse un JWS mal formé (`invalid_jws`), une autre app
  (`bad_bundle`), un produit inconnu (`unknown_product`, dont l'ancien « Accès offert »), une
  transaction déjà rattachée à un autre compte (`transaction_taken`) et une transaction inconnue
  d'Apple (`not_found`) ; Sandbox ACCEPTÉ ; sinon elle écrit `entitlements` (seule écriture) ;
- module Capacitor `MdlfStore`, COPIE CLÉ POUR CLÉ de ios/App/App/StorePlugin.swift (vérifié par
  tests/unit/store-contract.mjs, qui lit le vrai Swift) :
  `products()` → `{ products: [{ id, displayName, description, displayPrice, price (nombre),
  currency, period, introEligible, offer? }], missing, canMakePayments }` — le prix affichable est
  `displayPrice`, jamais `price` ; `offer` (offre de lancement : `{ displayPrice, price, paymentMode,
  period, periodCount }`) seulement si `introEligible` (`__st.introEligible = false` : essai déjà
  utilisé sur cet identifiant Apple) ;
  `purchase({ productId, appAccountToken? })` NE REJETTE PAS : il résout
  `{ status: 'success' | 'userCancelled' | 'pending' }`, et pour un succès la transaction entière ;
  un achat avec l'offre (introEligible) est un essai gratuit de 3 mois côté serveur (`intro_offer`) ;
  `finish({ transactionId })` → `{ finished, reason? }` ; `restore()` → `{ synced, cancelled,
  entitlements, unverified }` ; `current()` → `{ entitlements, unverified }` ; `status()` →
  `{ canMakePayments, subscriptionIds }` ; `redeemCode()` → `{ presented: true }` ou
  `{ presented: false, cancelled: true }` ; événement `transaction`, doublé en `change`.
- déclencheur `before insert on public.sessions` : une séance NOUVELLE est refusée en P0001
  `paywall_locked` quand le verrou est allumé et `can_write` faux, SAUF grâce de fin de séance
  (statut `expired`, au plus 24 h après la fin à l'heure du serveur, séance commencée dans les 12 h
  avant la fin, 2 séances au plus). `__st.noTrigger = true` l'éteint ; refus sous `['locked', …]`.
- `from('app_config')` : lignes `paywall_on` et `min_build` (`__st.minBuild`), avec ou sans compte ;
  appels sous `['app_config', 'anon' | 'auth']` ; `__st.fail.config = 'offline'` : injoignable.

`environment()` → `{ environment }` (`__st.environment`, 'production' par défaut ; 'sandbox' = TestFlight).

Deux horloges SÉPARÉES : celle du serveur (`__st.serverShift`) et celle de l'appareil
(`__st.deviceShift`, qui décale `Date.now()` dans la page).

État dans `window.__st` : paywallOn, ents (par compte), taken (original_transaction_id → compte),
products, owned (abonnement présent chez Apple), calls, fail (`fail.access = 'offline'`,
`fail.purchase = 'cancel' | 'pending' | 'fail'`, `fail.verify = 'invalid_jws' | 'apple_down' | …`).
Outils : `__st.subscribe(productId, days, { intro })` (abonnement écrit côté serveur),
`__st.endAccess(hoursAgo)` (l'abonnement a pris fin il y a N heures, Apple l'a fermé),
`__st.giveGift()` (code maison à vie), `__st.emitTransaction(productId)` (transaction poussée par
Apple : code d'offre utilisé, renouvellement, achat sur un autre appareil).
Réglages avant chargement : `window.__stOpts` (ex. `{ paywallOn: true, store: false }`) ; `appBuild` simule le
numéro de build natif (CFBundleVersion) et `minBuild` la valeur de `app_config.min_build`.
"""

FAKE_STORE = r"""
(() => {
  const st = window.__st = Object.assign({
    paywallOn: false, serverShift: 0, deviceShift: 0, store: true,
    ents: {}, taken: {}, owned: null, noTrigger: false,
    fail: {}, calls: [], listeners: [], changeListeners: [], open: [], missing: [], n: 0,
    codes: {}, redeemed: [], tries: {}, graces: {},
    canMakePayments: true, cancelRestore: false, introEligible: true,
    // Décrits comme le Swift : displayPrice (affichable) ET price (nombre), displayName, currency,
    // et l'offre de lancement d'App Store Connect (3 mois gratuits) sur les deux abonnements
    products: [
      { id: 'com.mdlf.training.pro.monthly', displayName: 'MDLF Training mensuel', description: 'Abonnement mensuel',
        displayPrice: '6,49 €', price: 6.49, currency: 'EUR', period: { unit: 'month', value: 1 }, introEligible: true },
      { id: 'com.mdlf.training.pro.yearly', displayName: 'MDLF Training annuel', description: 'Abonnement annuel',
        displayPrice: '55,00 €', price: 55, currency: 'EUR', period: { unit: 'year', value: 1 }, introEligible: true },
      // Paliers coach (tarifs du 30/10), mêmes clés : visibles dans l'app pour un coach validé seulement
      ...[['coach10', 15.99, 134.99, '10 élèves'], ['coach20', 19.99, 169, '20 élèves'], ['coach30', 24.99, 209.99, '30 élèves'],
          ['coachmax', 29.99, 250, 'illimité']].flatMap(([k, m, y, l]) => [
        { id: `com.mdlf.training.${k}.monthly`, displayName: `Coach ${l}`, description: 'Coach, mensuel',
          displayPrice: m.toFixed(2).replace('.', ',') + ' €', price: m, currency: 'EUR', period: { unit: 'month', value: 1 }, introEligible: true },
        { id: `com.mdlf.training.${k}.yearly`, displayName: `Coach ${l}`, description: 'Coach, annuel',
          displayPrice: y.toFixed(2).replace('.', ',') + ' €', price: y, currency: 'EUR', period: { unit: 'year', value: 1 }, introEligible: true }]),
    ],
    environment: 'production',
    // Offre élève : codes d'offre d'Apple à usage unique distribués par student_offer_code
    offerCodes: ['STUDENTCODE01', 'STUDENTCODE02', 'STUDENTCODE03'], offerGiven: {},
  }, window.__stOpts || {});
  const DAY = 86400000, HOUR = 3600000;
  const BUNDLE = 'com.mdlf.training';
  const SUB_IDS = ['pro', 'coach10', 'coach20', 'coach30', 'coachmax'].flatMap(k => [`com.mdlf.training.${k}.monthly`, `com.mdlf.training.${k}.yearly`]);
  const TRIAL = { unit: 'month', value: 3 };
  const OFFER = { displayPrice: '0,00 €', price: 0, paymentMode: 'freeTrial', period: { unit: 'month', value: 3 }, periodCount: 1 };

  // Deux horloges : celle de l'appareil (que les tests trafiquent) et celle du serveur
  const realNow = Date.now;
  Date.now = () => realNow() + (st.deviceShift || 0);
  const serverNow = () => realNow() + (st.serverShift || 0);
  const iso = ms => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
  const log = (...a) => st.calls.push(a);

  const b64 = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = s => JSON.parse(decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')))));
  // Transaction signée par Apple, telle que StoreKit 2 la rend
  const makeJws = (tx, bundleId = BUNDLE) => 'jws.' + b64({ ...tx, bundleId }) + '.sig';
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
    reason: tx.reason || 'purchase',
  });

  const me = () => (window.__sb && __sb.meId ? __sb.meId() : null);

  // ── entitlements (seule source de vérité, écrite seulement par le serveur) ──
  const row = (uid, create) => {
    let e = st.ents[uid];
    if (!e && create) {
      e = st.ents[uid] = { status: 'none', product_id: null, expires_at: null, original_transaction_id: null,
        gift: false, gift_until: null, intro: false, ended: null, env: null };
    }
    return e || null;
  };
  // Élève d'un coach (état du faux coach de fake_account) : plus de gratuité depuis le 30/10
  const coachOf = uid => (window.__sb && __sb.co ? (__sb.co.links.find(l => l.student === uid) || {}).coach || null : null);

  // Ce que my_access() / access_state() renvoient, calculé à l'heure du SERVEUR
  // gift > active > expired > none ; aucun essai maison, plus d'élève gratuit (coach_team toujours faux)
  const stateOf = (uid, e) => {
    const now = serverNow();
    const coach = false;
    const giftDays = e.gift_until !== null && e.gift_until > now ? e.gift_until : null;
    const paid = e.expires_at !== null && e.expires_at > now ? e.expires_at : null;
    let status, until = null;
    if (e.gift) status = 'gift';
    else if (giftDays && (!paid || giftDays > paid)) { status = 'gift'; until = giftDays; }
    else if (paid) { status = 'active'; until = paid; }
    else if (coach) status = 'coach_team';
    else if (e.expires_at !== null || e.gift_until !== null || e.ended !== null) {
      status = 'expired'; until = Math.max(e.expires_at || 0, e.gift_until || 0, e.ended || 0) || null;
    } else status = 'none';
    const intro = status === 'active' && !!e.intro;
    const days = (status === 'active' || status === 'gift') && until !== null ? Math.max(0, Math.ceil((until - now) / DAY)) : null;
    return { status, until: iso(until), paywall_on: !!st.paywallOn, days_left: days,
      can_write: !st.paywallOn || ['active', 'gift', 'coach_team'].includes(status),
      gift: !!e.gift || !!giftDays, gift_until: iso(e.gift_until), coach_team: coach,
      intro_offer: intro, intro_until: intro ? iso(until) : null, server_now: iso(now) };
  };

  st.giveGift = () => { const e = row(me(), true); e.gift = true; };
  st.subscribe = (productId = 'com.mdlf.training.pro.yearly', days = 365, { intro = false } = {}) => {
    const e = row(me(), true); e.product_id = productId; e.intro = intro; e.status = 'active';
    e.expires_at = serverNow() + days * DAY; e.original_transaction_id = 'orig-' + (++st.n); };
  // L'abonnement a pris fin il y a N heures (Apple l'a fermé : EXPIRED)
  st.endAccess = (hoursAgo = 0) => { const e = row(me(), true); e.expires_at = serverNow() - hoursAgo * HOUR; e.intro = false; e.status = 'expired'; };

  const pgErr = message => ({ data: null, error: { code: 'P0001', message, details: null, hint: null } });
  const offline = () => ({ data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } });

  // Codes cadeaux maison : __st.addCode('CODE', { kind, days, maxUses, expires })
  st.addCode = (code, { kind = 'days', days = 90, maxUses = 1, expires = null } = {}) => {
    st.codes[code] = { kind, days, maxUses, uses: 0, expires };
    return code;
  };
  const CODE_RE = /^[A-HJ-NP-Z2-9]{10,24}$/;
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
    my_access: uid => stateOf(uid, row(uid, true)),
    access_state: uid => { const e = row(uid, false); return e ? stateOf(uid, e) : null; },
    redeem_gift_code: (uid, args) => redeem(uid, args.code),
    // Offre élève : élève d'un coach validé, jamais abonné ; même code tant qu'il n'a pas expiré
    student_offer_code: uid => {
      const coach = coachOf(uid);
      const e = row(uid, true);
      if (!coach || !(__sb.co.coachAt || {})[coach]) return { ok: false, error: 'not_student', code: null };
      if (e.original_transaction_id || e.expires_at !== null || st.everSubscribed) return { ok: false, error: 'not_new', code: null };
      if (!st.offerGiven[uid]) { const c = st.offerCodes.shift(); if (!c) return { ok: false, error: 'no_code', code: null }; st.offerGiven[uid] = c; }
      return { ok: true, error: null, code: st.offerGiven[uid], expires_at: iso(serverNow() + 90 * DAY), coach: { user_id: coach } };
    },
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
    if (st.fail.verify === 'apple_down') return fail(503, { error: 'apple_unreachable' });
    if (st.fail.verify) return fail(400, { error: st.fail.verify });
    const jws = body && body.jws;
    let tx = null;
    try { if (/^jws\..*\.sig$/.test(String(jws))) tx = unb64(String(jws).slice(4, -4)); } catch (e) { tx = null; }
    if (!tx || !tx.productId) return fail(400, { error: 'invalid_jws' });
    if (tx.bundleId !== BUNDLE) return fail(400, { error: 'bad_bundle' });
    // Les dix abonnements seulement : l'ancien « Accès offert » d'Apple est inconnu
    if (!SUB_IDS.includes(tx.productId)) return fail(400, { error: 'unknown_product' });
    if (tx.unknown) return fail(404, { error: 'not_found' });
    const taken = st.taken[tx.originalId];
    if (taken && taken !== uid) return fail(409, { error: 'transaction_taken' });
    st.taken[tx.originalId] = uid;
    const e = row(uid, true);
    e.original_transaction_id = tx.originalId;
    e.product_id = tx.productId;
    e.expires_at = tx.expiresAt;
    e.status = 'active';
    e.intro = !!tx.intro;            // offerType 1 dans la transaction signée
    e.env = tx.environment === 'sandbox' ? 'Sandbox' : 'Production';   // Sandbox ACCEPTÉ et enregistré
    return { data: { ok: true, access: stateOf(uid, e) }, error: null };
  };

  // ── app_config : sans compte, seule la ligne paywall_on (politique anon) ──
  const appConfig = q => {
    const uid = me();
    log('app_config', uid ? 'auth' : 'anon');
    if (st.fail.access === 'offline' || st.fail.config === 'offline') return offline();
    const rows = [{ key: 'paywall_on', value: !!st.paywallOn }, { key: 'min_build', value: st.minBuild || 0 }];
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
  // Achat : avec l'offre de lancement si la personne y a droit (3 mois gratuits, une seule fois par
  // identifiant Apple : c'est Apple qui le garantit, d'où introEligible qui passe à faux)
  const buy = productId => {
    const p = st.products.find(x => x.id === productId);
    if (!p) throw new Error('produit inconnu');
    const n = ++st.n;
    const intro = !!st.introEligible;
    st.introEligible = false;
    st.owned = { productId, originalId: 'apple-' + n, transactionId: 'tx-' + n, intro,
      expiresAt: serverNow() + (intro ? 90 : period(productId)) * DAY };
    return st.owned;
  };
  const openTx = tx => { if (!st.open.includes(tx.transactionId)) st.open.push(tx.transactionId); return tx; };
  const entitlements = () => {
    const list = [st.owned].filter(Boolean).map(tx => { openTx(tx); return describeTx(tx); });
    return { entitlements: list, unverified: st.unverified || 0 };
  };
  const describeProduct = p => {
    const eligible = !!st.introEligible && p.introEligible !== false;
    const out = { ...p, introEligible: eligible };
    delete out.offer;
    if (eligible) out.offer = { ...OFFER };
    return out;
  };
  const storePlugin = {
    products: async () => {
      log('products');
      const miss = st.missing || [];
      return { products: st.products.filter(p => !miss.includes(p.id)).map(describeProduct),
        missing: [...miss], canMakePayments: st.canMakePayments !== false };
    },
    purchase: async ({ productId, appAccountToken }) => {
      log('purchase', productId, appAccountToken || '');
      if (st.fail.purchase === 'cancel') return { status: 'userCancelled' };
      if (st.fail.purchase === 'pending') return { status: 'pending' };
      if (st.fail.purchase === 'fail') return { status: 'unknown' };
      const tx = buy(productId);
      openTx(tx);
      return { status: 'success', ...describeTx(tx) };
    },
    finish: async ({ transactionId }) => {
      log('finish', String(transactionId));
      const known = st.open.includes(transactionId);
      st.open = st.open.filter(id => id !== transactionId);
      return known ? { finished: true } : { finished: false, reason: 'notFound' };
    },
    restore: async () => {
      log('restore');
      const cancelled = !!st.cancelRestore;
      return { synced: !cancelled, cancelled, ...entitlements() };
    },
    current: async () => { log('current'); return entitlements(); },
    status: async () => ({ canMakePayments: st.canMakePayments !== false, subscriptionIds: [...SUB_IDS] }),
    environment: async () => { log('environment'); return { environment: st.environment || 'production' }; },
    redeemCode: async () => {
      log('redeemCode');
      return st.fail.redeem === 'cancel' ? { presented: false, cancelled: true } : { presented: true };
    },
    addListener: (ev, fn) => {
      if (ev === 'transaction') st.listeners.push(fn);
      if (ev === 'change') st.changeListeners.push(fn);
      return Promise.resolve({ remove() {} });
    },
  };
  // Transaction poussée par Apple : code d'offre utilisé, renouvellement, achat sur un autre appareil
  st.emitTransaction = (productId = 'com.mdlf.training.pro.yearly', extra = {}) => {
    const n = ++st.n;
    const tx = { productId, originalId: 'apple-' + n, transactionId: 'tx-' + n,
      expiresAt: serverNow() + period(productId) * DAY, ...extra };
    st.owned = tx;
    openTx(tx);
    const ev = { ...describeTx(tx), source: 'update' };
    return Promise.all([...st.listeners, ...st.changeListeners].map(fn => fn({ ...ev })));
  };

  // ── On enveloppe la coquille et le client déjà posés par FAKE_ACCOUNT ──
  const cap = window.Capacitor;
  const register = cap.registerPlugin, avail = cap.isPluginAvailable;
  // @capacitor/app : numéro de build natif simulé par __st.appBuild (version minimale, js/app/updates.js)
  cap.registerPlugin = name => (name === 'MdlfStore' ? storePlugin
    : name === 'App' && st.appBuild ? { getInfo: async () => ({ build: String(st.appBuild) }),
        // appStateChange (Native.onActiveChange, écran de confidentialité du coffre) : jamais émis ici
        addListener: async () => ({ remove() {} }) } : register(name));
  cap.isPluginAvailable = name => (name === 'MdlfStore' ? !!st.store : avail(name));

  // Verrou du serveur : déclencheur `before insert on public.sessions`, avec la grâce de fin de séance.
  // ATTENTION : écrire `sb` ici désignerait le client Supabase de l'app : c'est `window.__sb`.
  const alreadyOnServer = id => ((window.__sb && window.__sb.upserted) || []).some(x => x.id === id);
  const graceOk = (uid, s, r) => {
    const ended = s.until === null ? null : Date.parse(s.until);
    if (s.status !== 'expired' || ended === null || serverNow() > ended + 24 * HOUR) return false;
    const d = r && r.data ? r.data : {};
    if (typeof d.date !== 'number') return false;
    const began = d.date - (typeof d.duration === 'number' ? Math.max(d.duration, 0) : 0);
    if (began > ended || began < ended - 12 * HOUR) return false;
    const used = (st.graces[uid] || []).filter(t => t > ended);
    if (used.length >= 2) return false;
    st.graces[uid] = [...used, serverNow()];
    return true;
  };
  const lockedRows = rows => {
    const uid = me();
    const e = uid ? row(uid, true) : null;
    if (!uid || !e || !st.paywallOn || st.noTrigger) return [];
    const s = stateOf(uid, e);
    if (s.can_write) return [];
    return (Array.isArray(rows) ? rows : []).filter(r => r && !r.deleted_at && !alreadyOnServer(r.id) && !graceOk(uid, s, r));
  };

  const create = window.supabase.createClient;
  window.supabase.createClient = (...args) => {
    const c = create(...args);
    const rpc = c.rpc.bind(c), invoke = c.functions.invoke.bind(c.functions);
    const from = c.from.bind(c);
    c.rpc = (fn, a) => (accessRpcs[fn] ? callAccess(fn, a) : rpc(fn, a));
    c.functions = { invoke: (fn, o) => (fn === 'verify-purchase' ? verifyPurchase(o && o.body) : invoke(fn, o)) };
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
