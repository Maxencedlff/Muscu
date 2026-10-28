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
- module Capacitor `MdlfStore`, avec l'interface exacte de ios/App/App/StorePlugin.swift :
  `products()` → `{ products, missing }` (identifiants qu'Apple ne connaît pas encore : la liste est
  alors vide), `purchase({ productId })` qui NE REJETTE PAS et résout
  `{ status: 'success' | 'userCancelled' | 'pending' }` (plus `jws` et `transactionId` en cas de
  succès), `finish({ transactionId })` obligatoire après la vérification par le serveur (sans lui, la
  même transaction est réannoncée à chaque lancement : `__st.open` liste celles qui restent
  ouvertes), `restore()`, `current()`, `status()`, `redeemCode()` (codes d'offre d'ABONNEMENT
  seulement) et l'événement `transaction`, émis aussi sous le nom `change`.

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
    ents: {}, taken: {}, owned: null, fail: {}, calls: [], listeners: [], changeListeners: [], open: [], missing: [], n: 0,
    codes: {}, redeemed: [], tries: {},
    products: [
      { id: 'com.mdlf.training.pro.monthly', price: '5,99 €', title: 'MDLF Training mensuel' },
      { id: 'com.mdlf.training.pro.yearly', price: '41,99 €', title: 'MDLF Training annuel' },
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
    const trialEnd = e.trial_started_at + st.trialDays * DAY;
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
      gift: !!e.gift, gift_until: iso(e.gift_until), coach_team: coach, server_now: iso(now) };
  };

  st.startTrial = daysAgo => { const e = row(me(), true); e.status = 'trial'; e.gift = false; e.expires_at = null;
    e.trial_started_at = serverNow() - daysAgo * DAY; };
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
    my_access: uid => stateOf(uid, row(uid, true)),
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
  const openTx = tx => { st.open.push(tx.transactionId); return tx; };
  const storePlugin = {
    // Les produits qu'Apple ne connaît pas encore sortent dans `missing`, pas dans `products`
    products: async () => {
      log('products');
      const miss = st.missing || [];
      return { products: st.products.filter(p => !miss.includes(p.id)).map(p => ({ ...p })), missing: [...miss] };
    },
    // Ne rejette jamais : trois états possibles
    purchase: async ({ productId }) => {
      log('purchase', productId);
      if (st.fail.purchase === 'cancel') return { status: 'userCancelled' };
      if (st.fail.purchase === 'pending') return { status: 'pending' };
      if (st.fail.purchase === 'fail') return { status: 'failed' };
      const tx = buy(productId);
      return openTx({ status: 'success', jws: makeJws(tx), transactionId: tx.transactionId });
    },
    // Obligatoire après la vérification : la transaction ne sera plus réannoncée
    finish: async ({ transactionId }) => {
      log('finish', String(transactionId));
      st.open = st.open.filter(id => id !== transactionId);
      return {};
    },
    restore: async () => {
      log('restore');
      return st.owned ? openTx({ jws: makeJws(st.owned), transactionId: st.owned.transactionId }) : { jws: null };
    },
    current: async () => (st.owned ? { jws: makeJws(st.owned), transactionId: st.owned.transactionId, productId: st.owned.productId } : { jws: null }),
    status: async () => ({ entitled: !!st.owned, environment: 'Sandbox' }),
    redeemCode: async () => { log('redeemCode'); return {}; },
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
    if (productId !== GIFT) st.owned = tx;
    openTx(tx);
    const ev = { jws: makeJws(tx, extra.bundleId || BUNDLE), transactionId: tx.transactionId };
    return Promise.all([...st.listeners, ...st.changeListeners].map(fn => fn({ ...ev })));
  };

  // ── On enveloppe la coquille et le client déjà posés par FAKE_ACCOUNT ──
  const cap = window.Capacitor;
  const register = cap.registerPlugin, avail = cap.isPluginAvailable;
  cap.registerPlugin = name => (name === 'MdlfStore' ? storePlugin : register(name));
  cap.isPluginAvailable = name => (name === 'MdlfStore' ? !!st.store : avail(name));

  const create = window.supabase.createClient;
  window.supabase.createClient = (...args) => {
    const c = create(...args);
    const rpc = c.rpc.bind(c), invoke = c.functions.invoke.bind(c.functions);
    c.rpc = (fn, a) => (accessRpcs[fn] ? callAccess(fn, a) : rpc(fn, a));
    c.functions = { invoke: (fn, o) => (fn === 'verify-purchase' ? verifyPurchase(o && o.body) : invoke(fn, o)) };
    return c;
  };
})();
"""
