// Accès payant (js/data/access.js) : logique pure sans réseau (nettoyage strict de ce que renvoie le
// serveur, décisions prises sur les dates du SERVEUR, horloge de l'appareil trafiquée, cache par compte
// valable 7 jours hors ligne, verrou éteint = jamais bloqué, élève suivi par un coach, produits lus
// chez StoreKit et jamais écrits en dur).
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, assert, sameJSON, ROOT }) {
  const DAY = 86400_000;
  const NOW = Date.now();
  const MONTHLY = run('ACCESS_MONTHLY_ID');
  const YEARLY = run('ACCESS_YEARLY_ID');

  // Décisions prises sur un état fraîchement lu (access.state), pour un compte connecté ou non
  const decide = (state, { user = 'u' } = {}) => run(`(() => {
    const u = account.user, saved = { ...access };
    try {
      account.user = ${user ? `{ id: ${JSON.stringify(user)} }` : 'null'};
      accessReset(account.user?.id || null);
      access.state = ${state === null ? 'null' : `cleanAccess(${JSON.stringify(state)})`};
      return [canWrite(), paywallOn(), accessStatus(), accessIntroUntil(), accessUntil(), accessStale()];
    } finally { account.user = u; Object.assign(access, saved); localStorage.removeItem(ACCESS_CACHE_KEY); }
  })()`);

  // Démarrage hors ligne : seul le cache de l'appareil est connu, et l'horloge de l'iPhone est
  // décalée de shiftDays jours (clock trafiquée, fuseau faux, iPhone jamais réglé)
  const offline = (state, shiftDays = 0, userId = 'u') => run(`(() => {
    const u = account.user, saved = { ...access }, realNow = Date.now;
    try {
      account.user = { id: 'u' };
      localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify({ userId: ${JSON.stringify(userId)}, state: cleanAccess(${JSON.stringify(state)}) }));
      Date.now = () => realNow() + ${shiftDays} * 86400000;
      accessReset('u');
      return [canWrite(), accessStatus(), accessIntroUntil(), accessStale()];
    } finally { account.user = u; Object.assign(access, saved); Date.now = realNow; localStorage.removeItem(ACCESS_CACHE_KEY); }
  })()`);

  // Modèle B : l'essai gratuit est l'offre de lancement d'Apple, un abonnement « active » comme un autre
  const trial = (extra = {}) => ({ status: 'active', paywall_on: true, days_left: 42, can_write: true, gift: false,
    coach_team: false, until: NOW + 42 * DAY, intro_offer: true, intro_until: NOW + 42 * DAY, server_now: NOW, ...extra });
  // Sans abonnement (plus d'essai maison) : aucun droit verrou allumé
  const none = (extra = {}) => ({ status: 'none', paywall_on: true, can_write: false, gift: false, coach_team: false,
    until: null, server_now: NOW, ...extra });

  test('accès : réponse du serveur nettoyée (liste blanche, bornes, server_now obligatoire)', () => {
    const a = run(`cleanAccess({ status: 'active', until: '2027-01-01T00:00:00Z', paywall_on: true, trial_days: 90,
      days_left: 42, can_write: true, gift: false, coach_team: false, intro_offer: true, intro_until: '2027-01-01T00:00:00Z',
      server_now: '2026-10-28T10:00:00Z', user_id: 'secret', original_transaction_id: '1000', evil: '<img src=x>' })`);
    sameJSON(Object.keys(a).sort(), ['can_write', 'coach_team', 'days_left', 'gift', 'gift_until', 'intro_offer', 'intro_until', 'paywall_on', 'server_now', 'status', 'until'],
      'liste blanche du modèle B (plus de trial_days ni d\'essai maison)');
    assert.equal(a.intro_offer, true);
    assert.equal(a.intro_until, Date.parse('2027-01-01T00:00:00Z'));
    // L'offre de lancement n'a de sens que pour un abonnement actif ; une date illisible n'est pas gardée
    sameJSON(run(`[cleanAccess({ server_now: 1, status: 'expired', intro_offer: true, intro_until: 5 }).intro_offer,
      cleanAccess({ server_now: 1, status: 'active', intro_offer: 'oui' }).intro_offer,
      cleanAccess({ server_now: 1, status: 'active', intro_offer: true, intro_until: 'x' }).intro_until]`), [false, false, null]);
    // L'ancien statut « trial » (essai maison) n'existe plus
    assert.equal(run(`cleanAccess({ server_now: 1, status: 'trial' }).status`), 'unknown');
    assert.equal(a.until, Date.parse('2027-01-01T00:00:00Z'));
    assert.equal(a.server_now, Date.parse('2026-10-28T10:00:00Z'));
    assert.equal(a.days_left, 42);
    // Sans l'heure du serveur, rien n'est gardé : l'app ne saurait pas quand cet état a été lu
    assert.equal(run(`cleanAccess({ status: 'active', paywall_on: true, can_write: true })`), null);
    assert.equal(run(`cleanAccess({ server_now: 'pas une date' })`), null);
    assert.equal(run('cleanAccess(null)'), null);
    assert.equal(run('cleanAccess([1])'), null);
    assert.equal(run('cleanAccess(42)'), null);
    // Bornes et formes refusées
    assert.equal(run(`cleanAccess({ server_now: 1, status: 'bidon' }).status`), 'unknown');
    assert.equal(run(`cleanAccess({ server_now: 1, until: 'x' }).until`), null);
    assert.equal(run(`cleanAccess({ server_now: 1, days_left: 1.5 }).days_left`), null);
    assert.equal(run(`cleanAccess({ server_now: 1, days_left: '42' }).days_left`), null);
    sameJSON(run(`[cleanAccess({ server_now: 1, gift: true }).gift, cleanAccess({ server_now: 1, gift: 'oui' }).gift,
      cleanAccess({ server_now: 1, coach_team: true }).coach_team]`), [true, false, true]);
    assert.equal(run(`cleanAccess({ server_now: 1, gift_until: '2027-01-01T00:00:00Z' }).gift_until`), Date.parse('2027-01-01T00:00:00Z'));
    assert.equal(run(`cleanAccess({ server_now: 1, gift_until: 'x' }).gift_until`), null);
    // can_write : seul `true` compte quand le verrou est allumé ; verrou éteint = toujours vrai
    assert.equal(run(`cleanAccess({ server_now: 1, paywall_on: true, can_write: 'oui' }).can_write`), false);
    assert.equal(run(`cleanAccess({ server_now: 1, paywall_on: false, can_write: false }).can_write`), true);
    assert.equal(run(`cleanAccess({ server_now: 1, paywall_on: 'oui' }).paywall_on`), false);
  });

  test('accès : verrou éteint, rien ne bloque jamais (sans compte, sans état, abonnement fini)', () => {
    sameJSON(decide(null, { user: null }), [true, false, 'unknown', null, null, true]);
    sameJSON(decide(null), [true, false, 'unknown', null, null, true]);
    sameJSON(decide({ status: 'expired', paywall_on: false, can_write: false, server_now: NOW }).slice(0, 3),
      [true, false, 'expired'], 'verrou éteint : canWrite vrai, paywall jamais affiché');
    sameJSON(decide({ status: 'none', paywall_on: false, can_write: false, server_now: NOW }).slice(0, 3), [true, false, 'none']);
  });

  test('accès : modèle B, sans abonnement pas d\'essai maison ; essai d\'Apple, abonné, cadeau, coach', () => {
    // Compte tout neuf, verrou allumé : aucun droit (l'essai est celui d'Apple, avec un moyen de paiement)
    sameJSON(decide(none()), [false, true, 'none', null, null, false]);
    // Essai gratuit d'Apple : abonnement actif, avec la fin de l'offre
    sameJSON(decide(trial()), [true, true, 'active', NOW + 42 * DAY, NOW + 42 * DAY, false]);
    sameJSON(decide({ status: 'expired', paywall_on: true, can_write: false, until: NOW - DAY, server_now: NOW }).slice(0, 4),
      [false, true, 'expired', null], 'abonnement fini : plus d\'écriture');
    sameJSON(decide({ status: 'active', paywall_on: true, can_write: true, until: NOW + 30 * DAY, server_now: NOW }).slice(0, 4),
      [true, true, 'active', null], 'abonné payant : pas d\'offre en cours');
    sameJSON(decide({ status: 'gift', paywall_on: true, can_write: true, gift: true, server_now: NOW }).slice(0, 3), [true, true, 'gift']);
    sameJSON(decide({ status: 'coach_team', paywall_on: true, can_write: true, coach_team: true, server_now: NOW }).slice(0, 3),
      [true, true, 'coach_team']);
    // Serveur incohérent (coach_team sans droit) : c'est le serveur qui fait foi, pas l'app
    assert.equal(decide({ status: 'coach_team', paywall_on: true, can_write: false, coach_team: true, server_now: NOW })[0], false);
  });

  test('accès : hors ligne, le dernier état connu vaut 7 jours (droit gardé, puis redemandé)', () => {
    const coach = { status: 'coach_team', paywall_on: true, can_write: true, coach_team: true, until: null, server_now: NOW };
    sameJSON(offline(coach, 0), [true, 'coach_team', null, false]);
    sameJSON(offline(coach, 6), [true, 'coach_team', null, false], '6 jours plus tard : encore valable');
    sameJSON(offline(coach, 8), [false, 'unknown', null, true], 'au-delà : droit périmé, état à redemander');
    sameJSON(offline({ status: 'none', paywall_on: false, can_write: true, server_now: NOW }, 400), [true, 'unknown', null, true]);
    sameJSON(offline(none(), 0, 'autre-compte'), [true, 'unknown', null, true], 'cache d\'un autre compte jamais repris');
    const broken = run(`(() => {
      const u = account.user, saved = { ...access };
      try { account.user = { id: 'u' }; localStorage.setItem(ACCESS_CACHE_KEY, '{pas du json'); accessReset('u');
        return [access.cached, canWrite()]; }
      finally { account.user = u; Object.assign(access, saved); localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    sameJSON(broken, [null, true]);
  });

  test('accès : horloge de l\'appareil trafiquée, aucun droit gagné ni perdu à tort', () => {
    const expired = { status: 'expired', paywall_on: true, can_write: false, server_now: NOW };
    sameJSON(offline(expired, 0), [false, 'expired', null, false]);
    sameJSON(offline(expired, 8), [false, 'unknown', null, true], 'horloge avancée : toujours refusé');
    sameJSON(offline(expired, 400), [false, 'unknown', null, true]);
    sameJSON(offline(expired, -400), [false, 'unknown', null, true], 'horloge reculée : toujours refusé');
    sameJSON(offline(none(), 400), [false, 'unknown', null, true], 'sans abonnement : jamais ouvert par l\'horloge');
    // La fin de l'essai d'Apple est celle du serveur, jamais recalculée ici
    assert.equal(offline(trial(), 0)[2], NOW + 42 * DAY);
    assert.equal(offline(trial(), -10)[0], false, 'horloge reculée : jamais de rallonge');
    assert.equal(offline(trial(), -0.001)[0], true, 'quelques minutes de retard : valable');
  });

  test('accès : état relu pendant le lancement, puis gardé par compte sur l\'appareil', () => {
    const r = run(`(() => {
      const u = account.user, saved = { ...access }, realNow = Date.now;
      try {
        account.user = { id: 'u' };
        accessReset('u');
        access.state = cleanAccess(${JSON.stringify(trial())});
        access.userId = 'u';
        writeAccessCache();
        const written = JSON.parse(localStorage.getItem(ACCESS_CACHE_KEY));
        // Relance de l'app, hors ligne : l'état n'est pas encore lu, le cache suffit
        accessReset('u');
        const fromCache = [access.state, canWrite(), accessStatus(), accessIntroUntil()];
        // Changement de compte : le cache de l'autre n'est pas repris
        accessReset('autre');
        const other = [access.cached, canWrite()];
        // Déconnexion : le cache part avec les autres caches de compte
        clearCrossUserCaches();
        return [written.userId, written.state.days_left, fromCache, other, localStorage.getItem(ACCESS_CACHE_KEY),
          CROSS_USER_CACHE_KEYS.includes('mdlf_access')];
      } finally { account.user = u; Object.assign(access, saved); Date.now = realNow; localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    sameJSON(r, ['u', 42, [null, true, 'active', NOW + 42 * DAY], [null, true], null, true]);
  });

  test('accès : formules et essai gratuit lus chez StoreKit, ancien « Accès offert » écarté', async () => {
    const list = await run(`(async () => {
      const saved = Native.store;
      try {
        Native.store = { available: true, products: async () => ({ products: [
          { id: ACCESS_YEARLY_ID, displayPrice: '41,99 €', displayName: 'MDLF Training annuel', price: 41.99, period: { unit: 'year', value: 1 },
            introEligible: true, offer: { displayPrice: '0,00 €', price: 0, paymentMode: 'freeTrial', period: { unit: 'month', value: 3 }, periodCount: 1 } },
          { id: ACCESS_MONTHLY_ID, displayPrice: '  5,99 €  ', displayName: 'MDLF Training mensuel', price: 5.99, period: { unit: 'month', value: 1 },
            introEligible: false, offer: { paymentMode: 'freeTrial', period: { unit: 'month', value: 3 }, periodCount: 1 } },
          { id: 'com.mdlf.training.access.gift', displayPrice: '24,99 €', displayName: 'Accès offert' },
          { id: 'com.autre.app.pro', displayPrice: '1 €' },
          { id: ACCESS_MONTHLY_ID, displayPrice: 599 },
          null,
        ], missing: [], canMakePayments: true }) };
        access.products = null;
        return await accessLoadProducts();
      } finally { Native.store = saved; access.products = null; access.missing = null; }
    })()`);
    sameJSON(list.map(p => [p.id, p.price, p.period, p.label, p.trial]),
      [[MONTHLY, '5,99 €', 'month', 'MDLF Training mensuel', null], [YEARLY, '41,99 €', 'year', 'MDLF Training annuel', { unit: 'month', value: 3 }]],
      'prix displayPrice, essai seulement si introEligible (StoreKit), ancien accès offert et autres identifiants écartés');
    // Offre qui n'est pas un essai gratuit, ou mal formée : pas d'essai annoncé
    const bad = run(`[accessTrialOf({ introEligible: true, offer: { paymentMode: 'payAsYouGo', period: { unit: 'month', value: 1 } } }),
      accessTrialOf({ introEligible: true, offer: { paymentMode: 'freeTrial', period: { unit: 'siècle', value: 1 } } }),
      accessTrialOf({ introEligible: true, offer: { paymentMode: 'freeTrial', period: { unit: 'week', value: 1 }, periodCount: 2 } }),
      accessTrialOf({ introEligible: true })]`);
    sameJSON(bad, [null, null, { unit: 'week', value: 2 }, null]);
    // Produits qu'Apple ne connaît pas encore (contrat Paid Apps pas signé) : liste vide et missing
    const pending = await run(`(async () => {
      const saved = Native.store;
      try {
        Native.store = { available: true, products: async () => ({ products: [], missing: [ACCESS_MONTHLY_ID, ACCESS_YEARLY_ID, 'com.autre'], canMakePayments: true }) };
        access.products = null;
        const l = await accessLoadProducts();
        return [l, access.missing];
      } finally { Native.store = saved; access.products = null; access.missing = null; }
    })()`);
    sameJSON(pending, [[], [MONTHLY, YEARLY]], 'formules absentes signalées, identifiants étrangers écartés');
    // Hors app iOS : aucune formule, aucun achat
    const web = await run(`(async () => {
      const saved = Native.store;
      try { Native.store = { available: false, products: async () => ({ products: [{ id: ACCESS_MONTHLY_ID, displayPrice: '5,99 €' }], missing: [], canMakePayments: true }) };
        access.products = null;
        return [await accessLoadProducts(), await accessBuy(ACCESS_MONTHLY_ID), await accessRestore(), await accessRedeemCode()]; }
      finally { Native.store = saved; access.products = null; access.missing = null; }
    })()`);
    sameJSON(web[0], []);
    sameJSON(web.slice(1), [{ ok: false, kind: 'signed_out' }, { ok: false, kind: 'signed_out' }, { ok: false, kind: 'signed_out' }],
      'sans compte : rien n\'est tenté');
  });

  test('accès : achat annulé, en attente, et transaction terminée seulement après le serveur', async () => {
    const r = await run(`(async () => {
      const u = account.user, saved = { ...access }, store = Native.store;
      const finished = [];
      try {
        account.user = { id: 'u' };
        accessReset('u');
        Native.store = { available: true,
          purchase: async () => ({ status: 'userCancelled' }),
          finish: async id => { finished.push(id); return true; } };
        const cancelled = await accessBuy(ACCESS_MONTHLY_ID);
        Native.store.purchase = async () => ({ status: 'pending' });
        const pending = await accessBuy(ACCESS_MONTHLY_ID);
        Native.store.purchase = async () => ({ status: 'failed' });
        const failed = await accessBuy(ACCESS_MONTHLY_ID);
        // Un achat réussi dont le serveur ne peut rien faire (sb absent) ne doit pas être terminé
        Native.store.purchase = async () => ({ status: 'success', jws: 'jws', transactionId: 'tx-1' });
        const noServer = await accessBuy(ACCESS_MONTHLY_ID);
        return [cancelled, pending, failed, noServer, finished];
      } finally { account.user = u; Object.assign(access, saved); Native.store = store; localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    sameJSON(r, [{ ok: false, reason: 'cancel' }, { ok: false, kind: 'pending' }, { ok: false, kind: 'server' },
      { ok: false, kind: 'signed_out' }, []], 'rien n\'est terminé chez Apple sans l\'accord du serveur');
  });

  test('accès : aucun prix ni durée d\'essai écrits en dur dans l\'app', () => {
    const files = ['js/data/access.js', 'js/features/paywall-ui.js', 'css/paywall.css', 'js/data/coach-pro.js', 'js/features/coach-pro-ui.js']
      .map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
    // Prix des formules (tarifs du 30/10, et les anciens) : jamais écrits, toujours lus chez StoreKit
    const PRICES = /5[,.]99|41[,.]99|6[,.]49|55[,.]00|15[,.]99|134[,.]99|19[,.]99|169[,.]00|24[,.]99|209[,.]99|29[,.]99|250[,.]00/;
    for (const [f, src] of files) {
      assert.ok(!PRICES.test(src), `${f} : un prix est écrit en dur (les prix viennent de StoreKit)`);
      assert.ok(!/€/.test(src), `${f} : une devise est écrite en dur`);
    }
    // Seule exception : le prix de l'offre élève (code d'offre d'Apple, que StoreKit ne donne pas), dans
    // la table de repli de js/data/plans.js, et nulle part ailleurs dans ce fichier
    const plans = fs.readFileSync(path.join(ROOT, 'js/data/plans.js'), 'utf8');
    assert.ok(!PRICES.test(plans), 'plans.js : prix d\'une formule écrit en dur');
    const euros = plans.split('\n').filter(l => /€/.test(l) && !/^\s*\/\//.test(l));
    assert.equal(euros.length, 1, `plans.js : une seule ligne de prix (PLAN_STUDENT_PRICE) ${euros}`);
    assert.ok(/^const PLAN_STUDENT_PRICE = /.test(euros[0]));
    // Les identifiants de produits, eux, sont bien ceux du contrat
    sameJSON([MONTHLY, YEARLY, run('ACCESS_PRODUCT_IDS.slice(0, 2)'), run('ACCESS_PRODUCT_IDS.length')],
      ['com.mdlf.training.pro.monthly', 'com.mdlf.training.pro.yearly', ['com.mdlf.training.pro.monthly', 'com.mdlf.training.pro.yearly'], 10]);
    // L'ancien « Accès offert » d'Apple n'existe plus nulle part dans l'app
    for (const [f, src] of files) assert.ok(!/access\.gift|ACCESS_GIFT_ID|giftId/.test(src), `${f} : accès offert d'Apple resté`);
    // Plus aucune trace de l'essai maison ni du rattachement à l'identifiant Apple
    for (const f of ['js/data/access.js', 'js/features/paywall-ui.js', 'js/platform/native.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.ok(!/daysLeft\(|trial_days|apple_linked|trial_shared|appTransaction|accessLinkApple|verify-app-transaction|Native\.platform/.test(src), `${f} : reste de l'essai maison`);
    }
  });

  test('accès : achat jamais cru sur parole, erreurs du serveur traduites', async () => {
    // Sans client Supabase ni compte, aucune vérification n'est tentée
    sameJSON(await run(`accessVerifyPurchase('jws')`), { ok: false, kind: 'signed_out' });
    const kinds = run(`['invalid_jws', 'bad_bundle', 'transaction_taken', 'not_found', 'TypeError: Failed to fetch', 'boom']
      .map(m => accessErrorKind({ code: 'P0001', message: m }))`);
    sameJSON(kinds, ['invalid_jws', 'bad_bundle', 'transaction_taken', 'not_found', 'offline', 'server']);
    assert.equal(run('accessErrorKind(null)'), null);
    for (const k of [...kinds, 'cancelled', 'no_store', 'nothing', 'signed_out']) {
      const txt = run(`accessErrorText(${JSON.stringify(k)})`);
      assert.match(txt, /^[A-ZÉÀ].+\.$/, k);
      assert.ok(!/ - | – /.test(txt), `${k} : sans tiret`);
    }
    assert.equal(run('accessErrorText("inconnu")'), run('ACCESS_ERROR_TEXT.server'));
  });

  test('accès : code cadeau, un refus n\'est pas une exception', async () => {
    // Saisie souple : majuscules, espaces et tirets ignorés ; alphabet sans 0, O, 1 ni I
    assert.equal(run(`normalizeGiftCode(' k7m2-qx9p r4td ')`), 'K7M2QX9PR4TD');
    assert.equal(run(`normalizeGiftCode('K7M2QX9PR')`), null, '9 caractères : trop court');
    assert.equal(run(`normalizeGiftCode('K7M2QX9PR4TD0')`), null, '0 exclu de l\'alphabet');
    assert.equal(run(`normalizeGiftCode('K7M2QX9PR4TI')`), null, 'I exclu de l\'alphabet');
    assert.equal(run(`normalizeGiftCode('A'.repeat(25))`), null, '25 caractères : trop long');
    // Un code mal formé n'est même pas envoyé au serveur (il brûlerait un essai pour rien)
    sameJSON(await run(`accessRedeemGiftCode('pas un code')`), { ok: false, kind: 'signed_out' }, 'sans compte : rien n\'est tenté');
    const r = await run(`(async () => {
      const u = account.user, saved = { ...access }, realSb = sb;
      const calls = [];
      try {
        account.user = { id: 'u' };
        accessReset('u');
        const answer = { data: null, error: null };
        sb = { rpc: async (fn, args) => { calls.push([fn, args.code]); return answer; } };
        const bad = await accessRedeemGiftCode('k7m2 qx9p-r4t0');   // 0 : refusé sur l'appareil
        // Refus du serveur : ok vaut false, sans exception
        answer.data = { ok: false, error: 'already_redeemed', kind: null, access: null };
        const again = await accessRedeemGiftCode('K7M2QX9PR4TD');
        answer.data = { ok: false, error: 'code_used_up', kind: null, access: null };
        const used = await accessRedeemGiftCode('K7M2QX9PR4TD');
        answer.data = { ok: false, error: 'bizarre', kind: null, access: null };
        const odd = await accessRedeemGiftCode('K7M2QX9PR4TD');
        // Vraie exception : trop d'essais
        answer.data = null; answer.error = { code: 'P0001', message: 'rate_limited' };
        const limited = await accessRedeemGiftCode('K7M2QX9PR4TD');
        // Accepté : l'état arrive avec la réponse, sans relecture
        answer.error = null;
        answer.data = { ok: true, error: null, kind: 'lifetime',
          access: { status: 'gift', paywall_on: true, can_write: true, gift: true, server_now: Date.now() } };
        const ok = await accessRedeemGiftCode('k7m2-qx9p-r4td');
        return [bad, again, used, odd, limited, ok, accessStatus(), canWrite(), calls.map(c => c[1])];
      } finally { account.user = u; Object.assign(access, saved); sb = realSb; localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    sameJSON(r.slice(0, 6), [{ ok: false, kind: 'invalid_code' }, { ok: false, kind: 'already_redeemed' },
      { ok: false, kind: 'code_used_up' }, { ok: false, kind: 'server' }, { ok: false, kind: 'rate_limited' },
      { ok: true, kind: 'lifetime' }]);
    sameJSON(r.slice(6, 8), ['gift', true], 'accès offert pris tout de suite');
    sameJSON(r[8], ['K7M2QX9PR4TD', 'K7M2QX9PR4TD', 'K7M2QX9PR4TD', 'K7M2QX9PR4TD', 'K7M2QX9PR4TD'],
      'code normalisé avant l\'envoi, et le code mal formé n\'est jamais envoyé');
  });

  test('accès : l\'achat porte l\'identifiant du compte, la feuille de codes fermée n\'est pas un succès', async () => {
    const r = await run(`(async () => {
      const u = account.user, saved = { ...access }, store = Native.store;
      const bought = [];
      try {
        account.user = { id: '11111111-2222-3333-4444-555555555555' };
        accessReset(account.user.id);
        let redeem = { presented: true };
        Native.store = { available: true,
          purchase: async (id, token) => { bought.push([id, token]); return { status: 'userCancelled' }; },
          redeemCode: async () => redeem,
          status: async () => ({ canMakePayments: false }) };
        await accessBuy(ACCESS_MONTHLY_ID);
        const opened = await accessRedeemCode();
        redeem = { presented: false, cancelled: true };
        const closed = await accessRedeemCode();
        redeem = null;
        const broken = await accessRedeemCode();
        const canPay = await accessLoadStoreStatus();
        return [bought, opened, closed, broken, canPay, access.canPay];
      } finally { account.user = u; Object.assign(access, saved); Native.store = store; localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    sameJSON(r[0], [[MONTHLY, '11111111-2222-3333-4444-555555555555']], 'appAccountToken : sans lui, un achat devient orphelin');
    sameJSON(r[1], { ok: true });
    sameJSON(r[2], { ok: false, reason: 'cancel' }, 'feuille fermée : jamais un succès, jamais une erreur');
    sameJSON(r[3], { ok: false, kind: 'server' });
    sameJSON(r.slice(4), [false, false], 'achats bloqués (Temps d\'écran) : l\'écran ne doit rien proposer');
  });

  test('accès : hors ligne, un abonné n\'est pas coupé au bout de 7 jours', async () => {
    // Abonnement jusqu'à J+30 : le dernier état connu vaut jusqu'à cette date (plus deux jours),
    // pas seulement 7 jours. L'essai, lui, garde les 7 jours.
    const active = { status: 'active', paywall_on: true, can_write: true, until: NOW + 30 * DAY, server_now: NOW };
    sameJSON(offline(active, 20).slice(0, 2), [true, 'active'], '20 jours hors ligne : toujours abonné');
    sameJSON(offline(active, 31).slice(0, 2), [true, 'active'], 'un jour après la fin : marge de renouvellement');
    sameJSON(offline(active, 33), [false, 'unknown', null, true], 'bien après la fin : état à redemander');
    // Cadeau en jours : même règle
    assert.equal(offline({ status: 'gift', paywall_on: true, can_write: true, gift: true, until: NOW + 60 * DAY, server_now: NOW }, 50)[0], true);
    // Accès à vie (sans date de fin) et élève d'un coach : 7 jours, faute de borne
    assert.equal(offline({ status: 'gift', paywall_on: true, can_write: true, gift: true, until: null, server_now: NOW }, 8)[0], false);
    assert.equal(offline({ status: 'coach_team', paywall_on: true, can_write: true, coach_team: true, until: null, server_now: NOW }, 8)[0], false);
    // Horloge reculée : jamais de rallonge, même pour un abonné
    assert.equal(offline(active, -10)[0], false);
    // Essai gratuit d'Apple : c'est un abonnement daté, même règle
    assert.equal(offline(trial(), 30)[0], true);
  });

  test('accès : Apple injoignable (503), la transaction est gardée pour plus tard', async () => {
    const r = await run(`(async () => {
      const u = account.user, saved = { ...access }, realSb = sb, store = Native.store;
      const finished = [];
      try {
        account.user = { id: 'u' };
        accessReset('u');
        Native.store = { available: true, finish: async id => { finished.push(id); return true; } };
        const res = { error: { context: { status: 503, json: async () => ({ error: 'apple_unreachable' }) } } };
        sb = { functions: { invoke: async () => res } };
        const down = await accessVerifyPurchase('jws', 'tx-1');
        // Refus définitif : la transaction est terminée, elle ne reviendra pas
        res.error.context = { status: 400, json: async () => ({ error: 'bad_bundle' }) };
        const other = await accessVerifyPurchase('jws', 'tx-2');
        // Refus qui peut changer : la transaction reste ouverte
        res.error.context = { status: 409, json: async () => ({ error: 'transaction_taken' }) };
        const taken = await accessVerifyPurchase('jws', 'tx-3');
        return [down, other, taken, finished];
      } finally { account.user = u; Object.assign(access, saved); sb = realSb; Native.store = store; localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    sameJSON(r.slice(0, 3), [{ ok: false, kind: 'retry' }, { ok: false, kind: 'bad_bundle' }, { ok: false, kind: 'transaction_taken' }]);
    sameJSON(r[3], ['tx-2'], 'seul un refus définitif termine la transaction');
    assert.match(run('accessErrorText("retry")'), /réessaiera/);
    // Trop d'appels (429) : message juste, pas « action impossible »
    const limited = await run(`(async () => {
      const u = account.user, saved = { ...access }, realSb = sb, store = Native.store;
      try {
        account.user = { id: 'u' }; accessReset('u');
        Native.store = { available: true, finish: async () => true };
        sb = { functions: { invoke: async () => ({ error: { context: { status: 429, json: async () => ({ error: 'rate_limited' }) } } }) } };
        const a = await accessVerifyPurchase('jws', 'tx-9');
        sb = { functions: { invoke: async () => ({ error: { context: { status: 400, json: async () => ({ error: 'bad_environment' }) } } }) } };
        const b = await accessVerifyPurchase('jws', 'tx-10');
        // Une transaction déjà refusée pour ce compte n'est pas renvoyée à Apple
        sb = { functions: { invoke: async () => { throw new Error('ne devrait pas être appelé'); } } };
        const c = await accessVerifyPurchase('jws', 'tx-10');
        const taken = await (async () => {
          sb = { functions: { invoke: async () => ({ error: { context: { status: 409, json: async () => ({ error: 'transaction_taken' }) } } }) } };
          const first = await accessVerifyPurchase('jws', 'tx-11');
          sb = { functions: { invoke: async () => { throw new Error('ne devrait pas être appelé'); } } };
          return [first, await accessVerifyPurchase('jws', 'tx-11')];
        })();
        return [a, b, c, taken];
      } finally { account.user = u; Object.assign(access, saved); sb = realSb; Native.store = store; localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    sameJSON(limited[0], { ok: false, kind: 'rate_limited' });
    sameJSON(limited[1], { ok: false, kind: 'bad_environment' });
    sameJSON(limited[2], { ok: false, kind: 'server' }, 'tx-10 n\'est pas dans les refusées : la vérification est retentée');
    sameJSON(limited[3], [{ ok: false, kind: 'transaction_taken' }, { ok: false, kind: 'transaction_taken' }],
      'prise par un autre compte : plus jamais réenvoyée tant qu\'on reste sur ce compte');
    for (const k of ['bad_environment', 'bad_type', 'not_purchased', 'invalid_transaction', 'rate_limited', 'blocked']) {
      const txt = run(`accessErrorText(${JSON.stringify(k)})`);
      assert.match(txt, /^[A-ZÉÀ].+\.$/, k);
      assert.notEqual(txt, run('ACCESS_ERROR_TEXT.server'), `${k} : message générique`);
    }
  });

  test('verrou du compte : une séance refusée n\'est ni perdue, ni marquée envoyée, et ne bloque pas les autres', async () => {
    // Le serveur refuse l'INSERT d'une séance nouvelle (P0001 paywall_locked). Le lot est coupé en
    // deux jusqu'à isoler les refusées : tout le reste passe.
    const r = await run(`(async () => {
      const realSb = sb, calls = [];
      try {
        clearPaywallLock();
        const refuse = new Set(['n1', 'n2']);
        sb = { from: () => ({ upsert: rows => { calls.push(rows.map(x => x.id));
          return Promise.resolve(rows.some(x => refuse.has(x.id))
            ? { error: { code: 'P0001', message: 'paywall_locked' } } : { error: null }); } }) };
        const rows = ['a', 'b', 'n1', 'c', 'n2', 'd'].map(id => ({ id, data: {}, hash: 'h' + id }));
        const sent = await pushSessionRows(rows, u => ({ user_id: 'u', id: u.id }));
        // Une autre erreur n'est pas avalée : elle remonte comme avant
        sb = { from: () => ({ upsert: () => Promise.resolve({ error: { message: 'boom' } }) }) };
        let thrown = null;
        try { await pushSessionRows([{ id: 'x' }], u => ({ id: u.id })); } catch (e) { thrown = e.message; }
        return [sent.map(u => u.id), calls.length, thrown];
      } finally { sb = realSb; clearPaywallLock(); }
    })()`);
    sameJSON(r[0], ['a', 'b', 'c', 'd'], 'les séances acceptées passent, les refusées sont isolées');
    assert.ok(r[1] >= 3 && r[1] <= 13, `lots envoyés : ${r[1]} (le découpage reste borné)`);
    assert.equal(r[2], 'boom', 'une vraie erreur de serveur remonte toujours');
    // Reconnaissance du refus, et seulement de celui-là
    sameJSON(run(`[isPaywallLocked({ message: 'paywall_locked' }), isPaywallLocked({ error: 'paywall_locked' }),
      isPaywallLocked({ message: 'permission denied' }), isPaywallLocked(null)]`), [true, true, false, false]);
    // Le verrou est oublié au changement de compte (clearSyncMetas) : rien ne traîne d'un compte à l'autre
    assert.equal(run('(() => { clearPaywallLock(); return accountLockedCount(); })()'), 0);
  });

  test('accès : la porte des écritures ne bloque que verrou allumé et droit refusé', async () => {
    // Sans compte : accessEnsure laisse passer sans rien demander
    assert.equal(await run('accessEnsure()'), true);
    const r = await run(`(async () => {
      const u = account.user, saved = { ...access };
      try {
        account.user = { id: 'u' };
        accessReset('u');
        access.state = cleanAccess({ status: 'expired', paywall_on: true, can_write: false, server_now: Date.now() });
        // sb est absent ici : la relecture échoue, le dernier état connu décide (refus)
        const refused = await accessEnsure();
        access.state = cleanAccess({ status: 'active', paywall_on: true, can_write: true, server_now: Date.now() });
        const allowed = await accessEnsure();
        return [refused, allowed];
      } finally { account.user = u; Object.assign(access, saved); localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    sameJSON(r, [false, true]);
  });

  // ── Règle 2 (28/10) : compte obligatoire seulement quand le verrou est allumé ──

  // Sans compte : décision selon le verrou lu sans compte (anon) et la disponibilité des comptes
  const guest = ({ anon, available = true, ready = true, firstSeenDaysAgo = 0, launched = true }) => run(`(() => {
    const u = account.user, r = account.ready, saved = { ...access }, avail = accountAvailable, launch = accessLaunch.on;
    try {
      accessLaunch.on = ${launched};
      account.user = null;
      account.ready = ${ready};
      accountAvailable = () => ${available};
      access.anon = ${JSON.stringify(anon)};
      access.firstSeen = Date.now() - ${firstSeenDaysAgo} * 86400000;
      return [canWrite(), accessSignInRequired(), paywallOn()];
    } finally { account.user = u; account.ready = r; Object.assign(access, saved); accountAvailable = avail; accessLaunch.on = launch; }
  })()`);

  test('accès sans compte : verrou éteint ou inconnu, jamais bloqué ; allumé, il faut un compte', () => {
    sameJSON(guest({ anon: false }), [true, false, false], 'verrou éteint : rien ne change, même sans compte');
    sameJSON(guest({ anon: null }), [true, false, false], 'verrou jamais lu (hors ligne au premier lancement) : rien ne bloque');
    sameJSON(guest({ anon: true }), [false, true, false], 'verrou allumé sans compte : il faut se connecter');
    // Pas de comptes sur cet appareil (navigateur, configuration absente) : impossible de se connecter, rien ne bloque
    sameJSON(guest({ anon: true, available: false }), [true, false, false]);
    // Démarrage à froid : la session n'est pas encore relue, un compte connecté ne doit pas voir la connexion
    sameJSON(guest({ anon: true, ready: false }), [true, false, false]);
    // Connecté, la règle du compte ne joue plus : c'est l'état du serveur qui décide
    assert.equal(decide({ status: 'trial', paywall_on: true, can_write: true, server_now: NOW })[0], true);
  });

  test('accès sans compte : le verrou est lu dans app_config (seule la ligne paywall_on), une erreur ne ferme rien', async () => {
    const r = await run(`(async () => {
      const u = account.user, r = account.ready, saved = { ...access }, avail = accountAvailable, realSb = sb;
      account.ready = true;
      const asked = [];
      const reply = { value: true, error: null };
      const out = [];
      try {
        account.user = null;
        accountAvailable = () => true;
        access.anon = null; access.anonAt = 0;
        const q = { eq: (k, v) => { asked.push([k, v]); return q; }, select: c => { asked.push(['select', c]); return q; },
          maybeSingle: async () => (reply.error ? { data: null, error: reply.error } : { data: { value: reply.value }, error: null }) };
        sb = { from: t => { asked.push(['from', t]); return q; } };
        out.push(await accessAnonRefresh(), canWrite(), JSON.parse(localStorage.getItem(ACCESS_ANON_KEY)).on);
        // Hors ligne ensuite : la dernière valeur lue reste (on demande toujours un compte)
        reply.error = { message: 'TypeError: Failed to fetch' };
        out.push(await accessAnonRefresh(), canWrite());
        // Le verrou est éteint côté serveur : plus rien ne bloque
        reply.error = null; reply.value = false;
        out.push(await accessEnsure());
        // Valeur d'un autre type : jamais lue comme « allumé »
        reply.value = 'true';
        out.push(await accessAnonRefresh(), canWrite());
        // Connecté : plus aucune lecture anonyme
        account.user = { id: 'u' };
        const n = asked.length;
        await accessAnonRefresh();
        out.push(asked.length === n);
        return [out, asked.slice(0, 3)];
      } finally { account.user = u; account.ready = r; Object.assign(access, saved); accountAvailable = avail; sb = realSb;
        localStorage.removeItem(ACCESS_ANON_KEY); }
    })()`);
    sameJSON(r[0], [true, false, true, true, false, true, false, true, true]);
    sameJSON(r[1], [['from', 'app_config'], ['select', 'value'], ['key', 'paywall_on']]);
  });

  test('accès sans compte : verrou jamais lu, ouvert 7 jours après la 1re ouverture, puis une lecture est nécessaire', () => {
    sameJSON(guest({ anon: null, firstSeenDaysAgo: 0 }).slice(0, 2), [true, false], 'premier jour : ouvert');
    sameJSON(guest({ anon: null, firstSeenDaysAgo: 6 }).slice(0, 2), [true, false], '6 jours : ouvert');
    sameJSON(guest({ anon: null, firstSeenDaysAgo: 8 }).slice(0, 2), [false, false], '8 jours sans aucune lecture : fermé, sans parler de compte');
    // I3 : tant que le verrou n'est pas mis en service (PAYWALL_LAUNCHED faux, livré ainsi), un verrou
    // jamais lu ne ferme RIEN, même au bout de 400 jours : « verrou éteint = rien ne bloque »
    assert.equal(run('PAYWALL_LAUNCHED'), false, 'livré avec le verrou mis en service');
    sameJSON(guest({ anon: null, firstSeenDaysAgo: 8, launched: false }).slice(0, 2), [true, false]);
    sameJSON(guest({ anon: null, firstSeenDaysAgo: 400, launched: false }).slice(0, 2), [true, false]);
    // … et lu ALLUMÉ, il faut quand même un compte (la constante ne touche que l'inconnu)
    sameJSON(guest({ anon: true, launched: false }).slice(0, 2), [false, true]);
    // Lu à faux une fois : jamais bloqué, même longtemps après
    sameJSON(guest({ anon: false, firstSeenDaysAgo: 400 }).slice(0, 2), [true, false]);
    // Horloge reculée : reste ouvert (limite documentée), jamais l'inverse à tort
    sameJSON(guest({ anon: null, firstSeenDaysAgo: -30 }).slice(0, 2), [true, false]);
    // Comptes indisponibles (navigateur) : jamais bloqué
    sameJSON(guest({ anon: null, firstSeenDaysAgo: 400, available: false }).slice(0, 2), [true, false]);
  });

  test('accès : la 1re ouverture est gardée dans le Trousseau (survit à la réinstallation), sinon sur l\'appareil', async () => {
    const r = await run(`(async () => {
      const saved = { ...access }, real = Native.account.storage;
      const keychain = {};
      try {
        Native.account.storage = { getItem: async k => keychain[k] ?? null, setItem: async (k, v) => { keychain[k] = v; } };
        localStorage.removeItem(ACCESS_FIRST_KEY);
        // Réinstallation : localStorage vide, Trousseau gardé : la date d'origine revient
        keychain[ACCESS_FIRST_KEY] = String(Date.now() - 30 * 86400000);
        const back = await accessLoadFirstSeen();
        // Rien nulle part : maintenant, écrit aux deux endroits
        delete keychain[ACCESS_FIRST_KEY]; localStorage.removeItem(ACCESS_FIRST_KEY);
        const t0 = Date.now();
        const fresh = await accessLoadFirstSeen();
        // Trousseau indisponible : l'appareil sert
        Native.account.storage = { getItem: async () => { throw new Error('x'); }, setItem: async () => { throw new Error('x'); } };
        const local = await accessLoadFirstSeen();
        return [Math.round((Date.now() - back) / 86400000), fresh >= t0, keychain[ACCESS_FIRST_KEY] === String(fresh), local === fresh];
      } finally { Native.account.storage = real; Object.assign(access, saved); localStorage.removeItem(ACCESS_FIRST_KEY); }
    })()`);
    sameJSON(r, [30, true, true, true]);
  });

  test('accès : une séance commencée avec le droit d\'écrire se termine même si l\'accès a pris fin', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/features/summary.js'), 'utf8');
    assert.ok(/if \(!activeSession\.writeOk && !\(await accessGate\(\)\)\) return;/.test(src), '« Terminer » repasse par la porte');
    const start = fs.readFileSync(path.join(ROOT, 'js/features/session.js'), 'utf8');
    assert.ok(/writeOk: typeof canWrite !== 'function' \|\| canWrite\(\),/.test(start), 'droit d\'écrire non noté au début de la séance');
  });
  test('formules : catalogue, paliers coach, « soit 8,5 mois » calculé', () => {
    sameJSON(run(`[planOf('com.mdlf.training.coach20.yearly').tier.key, planOf('com.mdlf.training.coach20.yearly').period,
      planOf('com.mdlf.training.pro.monthly').tier.coach, planOf('com.mdlf.training.access.gift'), planIsCoach('com.mdlf.training.coachmax.monthly')]`),
      ['coach20', 'year', false, null, true]);
    // Palier conseillé : le plus petit qui contient les élèves ; au-delà de 30, illimité
    sameJSON(run(`[0, 1, 10, 11, 20, 21, 30, 31, 500].map(n => planTierFor(n).key)`),
      ['coach10', 'coach10', 'coach10', 'coach20', 'coach20', 'coach30', 'coach30', 'coachmax', 'coachmax']);
    sameJSON(run(`['com.mdlf.training.coach10.monthly', 'com.mdlf.training.coach30.yearly', 'com.mdlf.training.coachmax.monthly', 'com.mdlf.training.pro.monthly']
      .map(id => planNextTier(id)?.key ?? null)`), ['coach20', 'coachmax', null, 'coach10']);
    // Prix lus chez StoreKit (nombres) : 55 / 6,49 = 8,47 → 8,5 mois ; 134,99 / 15,99 = 8,44 → 8,5
    sameJSON(run(`[planYearMonths({ amount: 6.49 }, { amount: 55 }), planYearMonths({ amount: 15.99 }, { amount: 134.99 }),
      planYearMonths({ amount: 29.99 }, { amount: 250 }), planYearMonths({ amount: 7.77 }, { amount: 77.77 }),
      planYearMonths(null, { amount: 55 }), planYearMonths({ amount: 0 }, { amount: 55 }), planYearMonths({ amount: 5 }, { amount: 70 })]`),
      [8.5, 8.5, 8.5, 10, null, null, null]);
    assert.equal(run('planMonthsText(8.5)'), '8,5 mois');
    // Offre élève : repli par devise (StoreKit ne donne pas le prix d'un code d'offre)
    sameJSON(run(`[planStudentPrice('EUR'), planStudentPrice('JPY'), planStudentPrice(undefined)]`), ['4,89 €', null, null]);
    assert.equal(run(`planRedeemUrl('ABC123DEF')`), 'https://apps.apple.com/redeem?ctx=offercodes&id=6823561962&code=ABC123DEF');
  });

  test('coach : code permanent de 12 caractères, numéro de carte, palier plein', () => {
    sameJSON(run(`[normalizeCoachCode('k7m2-qx9p-r4td'), normalizeCoachCode('K7M2QX9P'), normalizeCoachCode('K7M2QX9PR4T'),
      extractCoachCode('saisis le code K7M2-QX9P-R4TD. Avec ce code'), extractCoachCode('le code K7M2QX9P. Il est valable')]`),
      ['K7M2QX9PR4TD', 'K7M2QX9P', null, 'K7M2QX9PR4TD', 'K7M2QX9P']);
    assert.equal(run(`formatCoachCode('K7M2QX9PR4TD')`), 'K7M2-QX9P-R4TD');
    assert.ok(/K7M2-QX9P-R4TD/.test(run(`coachInviteText('K7M2QX9PR4TD')`)) && !/7 jours/.test(run(`coachInviteText('K7M2QX9PR4TD')`)));
    assert.equal(run(`coachErrorKind({ code: 'P0001', message: 'tier_full' })`), 'tier_full');
    sameJSON(run(`[normalizeCardNumber(' 049 12-ed0123 '), normalizeCardNumber('ab12'), normalizeCardNumber('A'.repeat(21))]`), ['04912ED0123', null, null]);
    const t = run(`cleanCoachTier({ is_coach: true, product_id: 'com.mdlf.training.coach10.monthly', limit: 10, students: 10, next_product: 'com.mdlf.training.coach20.monthly' })`);
    assert.equal(t.full, true);
    assert.equal(run(`coachTierFullText(cleanCoachTier({ is_coach: true, product_id: 'com.mdlf.training.coach10.monthly', limit: 10, students: 10 }))`),
      '10 élèves sur 10 : passe au palier supérieur.');
    assert.equal(run(`coachTierFullText(cleanCoachTier({ is_coach: true, limit: null, students: 99 }))`), null, 'illimité : jamais plein');
    // Produit inconnu renvoyé par le serveur : ignoré
    assert.equal(run(`cleanCoachTier({ is_coach: true, product_id: 'autre', limit: 3, students: 1 }).product_id`), null);
    sameJSON(run(`cleanCoachRequest({ status: 'bizarre', card_name: 1 })`).status, 'none');
    for (const k of ['already_coach', 'invalid_name', 'invalid_card', 'invalid_diploma', 'rate_limited', 'tier_full']) {
      const txt = run(`coachProErrorText(${JSON.stringify(k)})`);
      assert.match(txt, /^[A-ZÉÀ].+\.$/, k);
      assert.ok(!/ - | – /.test(txt), `${k} : sans tiret`);
    }
  });

  test('accès à vie OFFERT : statut gift sans date de fin, jamais vendu', () => {
    const gift = (extra = {}) => ({ status: 'gift', paywall_on: true, can_write: true, gift: true, coach_team: false,
      until: null, gift_until: null, days_left: null, intro_offer: false, server_now: NOW, ...extra });
    const forever = st => run(`(() => { const u = account.user, saved = { ...access };
      try { account.user = { id: 'u' }; accessReset('u'); access.state = cleanAccess(${JSON.stringify(st)});
        return [accessGiftForever(), accessStatus()]; }
      finally { account.user = u; Object.assign(access, saved); } })()`);
    sameJSON(forever(gift()), [true, 'gift']);
    // Un code de jours a une fin : pas « à vie »
    sameJSON(forever(gift({ until: NOW + 30 * DAY, gift_until: NOW + 30 * DAY, days_left: 30 })), [false, 'gift']);
    sameJSON(forever(gift({ status: 'active', gift: false, until: NOW + 30 * DAY })), [false, 'active']);
    // Le libellé « Accès offert à vie » vient de là (paywall-ui.js, non chargé ici)
    assert.ok(/if \(accessGiftForever\(\)\) return 'Accès offert à vie';/.test(fs.readFileSync(path.join(ROOT, 'js/features/paywall-ui.js'), 'utf8')));
    // Hors ligne : 7 jours, comme tout accès sans date de fin, puis redemandé
    sameJSON(offline(gift(), 6), [true, 'gift', null, false]);
    sameJSON(offline(gift(), 8), [false, 'unknown', null, true]);
    // Aucun achat à vie (refusé le 31/10/2026) : ni produit, ni catalogue
    assert.ok(!run('ACCESS_PRODUCT_IDS').some(id => /lifetime/.test(id)), 'achat à vie vendu');
    for (const f of ['js/data/access.js', 'js/data/plans.js', 'js/features/paywall-ui.js']) {
      assert.ok(!/com\.mdlf\.training\.lifetime|PLAN_LIFETIME|ACCESS_LIFETIME/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} : achat à vie resté`);
    }
  });

  test('offre élève : TestFlight (Sandbox) ne demande AUCUN code d\'offre élève (il ne s\'y utiliserait pas), le reste un code de Production', async () => {
    const r = await run(`(async () => {
      const u = account.user, saved = { ...access }, realSb = sb, nativeStore = Native.store;
      const out = [];
      try {
        account.user = { id: 'u' };
        let asked = 0;
        for (const env of ['sandbox', 'production', 'unknown', 'other', null, undefined]) {
          accessReset('u'); access.storeEnv = null;
          Native.store = { ...nativeStore, environment: async () => { asked++; return env; } };
          let sent = null;
          sb = { rpc: async (fn, args) => { sent = args.env; return { data: { ok: false, error: 'no_code' }, error: null }; } };
          const first = await accessStudentOffer();
          await accessStudentOffer();
          out.push(sent);
          if (env === 'sandbox') out.push(first, access.studentOffer);
        }
        // Coquille sans la méthode (mise à jour à chaud avant la build) : Production, sans erreur
        accessReset('u'); access.storeEnv = null;
        Native.store = { ...nativeStore, environment: undefined };
        let sent = null;
        sb = { rpc: async (fn, args) => { sent = args.env; return { data: { ok: false, error: 'no_code' }, error: null }; } };
        await accessStudentOffer();
        out.push(sent, asked);
        return out;
      } finally { account.user = u; Object.assign(access, saved); sb = realSb; Native.store = nativeStore; }
    })()`);
    // L'environnement n'est demandé qu'une fois par lancement quand il est connu
    // TestFlight : aucun appel au serveur (aucun des 3 codes de l'élève n'est usé), refus « testflight »
    sameJSON(r, [null, { ok: false, kind: 'testflight' }, null, 'Production', 'Production', 'Production', 'Production', 'Production', 'Production',
      1 + 1 + 2 + 1 + 2 + 2]);
    assert.ok(run(`accessErrorText('testflight')`).includes('TestFlight'));
  });

  test('offre élève : un refus du serveur n\'est pas une exception, le code est gardé', async () => {
    const r = await run(`(async () => {
      const u = account.user, saved = { ...access }, realSb = sb;
      const calls = [];
      try {
        account.user = { id: 'u' };
        accessReset('u');
        const answer = { data: { ok: false, error: 'not_new', code: null }, error: null };
        sb = { rpc: async (fn, args) => { calls.push([fn, args.env]); return answer; } };
        const notNew = await accessStudentOffer();
        const kept = access.studentOffer;
        answer.data = { ok: true, error: null, code: 'STUDENTCODE01', expires_at: '2027-01-01T00:00:00Z' };
        const ok = await accessStudentOffer();
        answer.data = { ok: true, code: '<script>' };
        const bad = await accessStudentOffer();
        return [notNew, kept, ok.ok, ok.code, bad, calls];
      } finally { account.user = u; Object.assign(access, saved); sb = realSb; }
    })()`);
    sameJSON(r, [{ ok: false, kind: 'not_new' }, { error: 'not_new' }, true, 'STUDENTCODE01', { ok: false, kind: 'server' },
      [['student_offer_code', 'Production'], ['student_offer_code', 'Production'], ['student_offer_code', 'Production']]]);
  });
}

