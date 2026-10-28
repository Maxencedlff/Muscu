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
      return [canWrite(), paywallOn(), accessStatus(), daysLeft(), accessUntil(), accessStale()];
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
      return [canWrite(), accessStatus(), daysLeft(), accessStale()];
    } finally { account.user = u; Object.assign(access, saved); Date.now = realNow; localStorage.removeItem(ACCESS_CACHE_KEY); }
  })()`);

  const trial = (extra = {}) => ({ status: 'trial', paywall_on: true, trial_days: 90, days_left: 42,
    can_write: true, gift: false, coach_team: false, until: NOW + 42 * DAY, server_now: NOW, ...extra });

  test('accès : réponse du serveur nettoyée (liste blanche, bornes, server_now obligatoire)', () => {
    const a = run(`cleanAccess({ status: 'trial', until: '2027-01-01T00:00:00Z', paywall_on: true, trial_days: 90,
      days_left: 42, can_write: true, gift: false, coach_team: false, server_now: '2026-10-28T10:00:00Z',
      user_id: 'secret', original_transaction_id: '1000', evil: '<img src=x>' })`);
    sameJSON(Object.keys(a).sort(), ['can_write', 'coach_team', 'days_left', 'gift', 'gift_until', 'paywall_on', 'server_now', 'status', 'trial_days', 'until']);
    assert.equal(a.until, Date.parse('2027-01-01T00:00:00Z'));
    assert.equal(a.server_now, Date.parse('2026-10-28T10:00:00Z'));
    assert.equal(a.days_left, 42);
    // Sans l'heure du serveur, rien n'est gardé : l'app ne saurait pas quand cet état a été lu
    assert.equal(run(`cleanAccess({ status: 'trial', paywall_on: true, can_write: true })`), null);
    assert.equal(run(`cleanAccess({ server_now: 'pas une date' })`), null);
    assert.equal(run('cleanAccess(null)'), null);
    assert.equal(run('cleanAccess([1])'), null);
    assert.equal(run('cleanAccess(42)'), null);
    // Bornes et formes refusées
    assert.equal(run(`cleanAccess({ server_now: 1, status: 'bidon' }).status`), 'unknown');
    assert.equal(run(`cleanAccess({ server_now: 1, until: 'x' }).until`), null);
    assert.equal(run(`cleanAccess({ server_now: 1, trial_days: -5 }).trial_days`), 90, 'essai hors bornes : 90 jours');
    assert.equal(run(`cleanAccess({ server_now: 1, trial_days: 99999 }).trial_days`), 90);
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

  test('accès : verrou éteint, rien ne bloque jamais (sans compte, sans état, essai fini)', () => {
    // Pas de compte : l'app marche comme avant, aucun appel, aucun blocage
    sameJSON(decide(null, { user: null }), [true, false, 'unknown', null, null, true]);
    // Compte connecté, état jamais lu : jamais bloqué, mais l'état est à redemander
    sameJSON(decide(null), [true, false, 'unknown', null, null, true]);
    // Verrou éteint côté serveur : même un essai terminé n'empêche rien
    sameJSON(decide({ status: 'expired', paywall_on: false, can_write: false, days_left: 0, server_now: NOW }).slice(0, 3),
      [true, false, 'expired'], 'verrou éteint : canWrite vrai, paywall jamais affiché');
  });

  test('accès : essai, fin d\'essai, abonné, accès offert, élève suivi par un coach', () => {
    sameJSON(decide(trial()), [true, true, 'trial', 42, NOW + 42 * DAY, false]);
    sameJSON(decide(trial({ days_left: 0 })).slice(0, 4), [true, true, 'trial', 0], 'dernier jour : encore ouvert');
    sameJSON(decide({ status: 'expired', paywall_on: true, can_write: false, days_left: 0, until: NOW, server_now: NOW }).slice(0, 4),
      [false, true, 'expired', null], 'essai terminé : plus d\'écriture, aucun jour restant');
    sameJSON(decide({ status: 'active', paywall_on: true, can_write: true, until: NOW + 30 * DAY, server_now: NOW }).slice(0, 4),
      [true, true, 'active', null]);
    sameJSON(decide({ status: 'gift', paywall_on: true, can_write: true, gift: true, server_now: NOW }).slice(0, 3), [true, true, 'gift']);
    // Élève suivi par un coach : accès gratuit tant qu'il est suivi (le serveur le dit, l'app le croit)
    sameJSON(decide({ status: 'coach_team', paywall_on: true, can_write: true, coach_team: true, server_now: NOW }).slice(0, 3),
      [true, true, 'coach_team']);
    // Serveur incohérent (coach_team sans droit) : c'est le serveur qui fait foi, pas l'app
    assert.equal(decide({ status: 'coach_team', paywall_on: true, can_write: false, coach_team: true, server_now: NOW })[0], false);
  });

  test('accès : hors ligne, le dernier état connu vaut 7 jours (droit gardé, puis redemandé)', () => {
    // Dans les 7 jours : la salle sans réseau ne bloque personne
    sameJSON(offline(trial(), 0), [true, 'trial', 42, false]);
    sameJSON(offline(trial(), 6), [true, 'trial', 42, false], '6 jours plus tard : encore valable');
    sameJSON(offline({ status: 'active', paywall_on: true, can_write: true, server_now: NOW }, 6).slice(0, 2), [true, 'active']);
    // Au-delà : l'app ne se prolonge pas elle-même, l'état est à redemander
    sameJSON(offline(trial(), 8), [false, 'unknown', null, true], 'droit périmé : plus d\'écriture tant que le serveur n\'a pas répondu');
    // Verrou éteint : même périmé, rien ne bloque
    sameJSON(offline({ status: 'trial', paywall_on: false, can_write: true, days_left: 5, server_now: NOW }, 400),
      [true, 'unknown', null, true]);
    // Cache d'un autre compte : jamais réutilisé (et jamais bloquant)
    sameJSON(offline(trial({ can_write: false, status: 'expired' }), 0, 'autre-compte'), [true, 'unknown', null, true]);
    // Cache illisible : comme s'il n'y en avait pas
    const broken = run(`(() => {
      const u = account.user, saved = { ...access };
      try { account.user = { id: 'u' }; localStorage.setItem(ACCESS_CACHE_KEY, '{pas du json'); accessReset('u');
        return [access.cached, canWrite()]; }
      finally { account.user = u; Object.assign(access, saved); localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    sameJSON(broken, [null, true]);
  });

  test('accès : horloge de l\'appareil trafiquée, aucun droit gagné ni perdu à tort', () => {
    // Essai terminé gardé sur l'appareil : avancer l'horloge de 400 jours ne DÉBLOQUE rien
    const expired = { status: 'expired', paywall_on: true, can_write: false, days_left: 0, server_now: NOW };
    sameJSON(offline(expired, 0), [false, 'expired', null, false]);
    sameJSON(offline(expired, 8), [false, 'unknown', null, true], 'horloge avancée : toujours refusé');
    sameJSON(offline(expired, 400), [false, 'unknown', null, true]);
    sameJSON(offline(expired, -400), [false, 'unknown', null, true], 'horloge reculée : toujours refusé');
    // Essai en cours : les jours restants sont ceux du serveur, jamais recalculés ici
    assert.equal(offline(trial(), 0)[2], 42, 'jours restants : ceux du serveur');
    // Reculer l'horloge ne doit PAS faire durer le cache indéfiniment : l'état est à redemander
    sameJSON(offline(trial({ days_left: 3 }), -1), [false, 'unknown', null, true], 'horloge reculée d\'un jour : état périmé');
    sameJSON(offline(trial({ days_left: 3 }), -400), [false, 'unknown', null, true]);
    // Petit décalage d'horloge (quelques minutes de retard) : l'état reste valable
    assert.equal(offline(trial(), -0.001)[0], true);
    assert.equal(offline(trial(), -0.001)[2], 42);
    // Et l'essai ne devient jamais « actif » ni « offert » tout seul
    assert.ok(!['active', 'gift'].includes(offline(trial(), 8)[1]));
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
        const fromCache = [access.state, canWrite(), accessStatus(), daysLeft()];
        // Changement de compte : le cache de l'autre n'est pas repris
        accessReset('autre');
        const other = [access.cached, canWrite()];
        // Déconnexion : le cache part avec les autres caches de compte
        clearCrossUserCaches();
        return [written.userId, written.state.days_left, fromCache, other, localStorage.getItem(ACCESS_CACHE_KEY),
          CROSS_USER_CACHE_KEYS.includes('mdlf_access')];
      } finally { account.user = u; Object.assign(access, saved); Date.now = realNow; localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    sameJSON(r, ['u', 42, [null, true, 'trial', 42], [null, true], null, true]);
  });

  test('accès : formules lues chez StoreKit, « Accès offert » jamais proposé', async () => {
    const list = await run(`(async () => {
      const saved = Native.store;
      try {
        Native.store = { available: true, products: async () => ({ products: [
          { id: ACCESS_YEARLY_ID, displayPrice: '41,99 €', displayName: 'MDLF Training annuel', price: 41.99, period: { unit: 'year', value: 1 } },
          { id: ACCESS_MONTHLY_ID, displayPrice: '  5,99 €  ', displayName: 'MDLF Training mensuel', price: 5.99, period: { unit: 'month', value: 1 } },
          { id: ACCESS_GIFT_ID, displayPrice: '24,99 €', displayName: 'Accès offert' },
          { id: 'com.autre.app.pro', displayPrice: '1 €' },
          { id: ACCESS_MONTHLY_ID, displayPrice: 599 },
          null,
        ], missing: [], canMakePayments: true }) };
        access.products = null;
        return await accessLoadProducts();
      } finally { Native.store = saved; access.products = null; access.missing = null; }
    })()`);
    sameJSON(list.map(p => [p.id, p.price, p.period, p.label]),
      [[MONTHLY, '5,99 €', 'month', 'MDLF Training mensuel'], [YEARLY, '41,99 €', 'year', 'MDLF Training annuel']],
      'prix affichable displayPrice (jamais le nombre), nom displayName, accès offert et autres identifiants écartés');
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
    const files = ['js/data/access.js', 'js/features/paywall-ui.js', 'css/paywall.css']
      .map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
    for (const [f, src] of files) {
      assert.ok(!/5[,.]99|41[,.]99/.test(src), `${f} : un prix est écrit en dur (les prix viennent de StoreKit)`);
      assert.ok(!/€/.test(src), `${f} : une devise est écrite en dur`);
    }
    // Les identifiants de produits, eux, sont bien ceux du contrat
    sameJSON([MONTHLY, YEARLY, run('ACCESS_GIFT_ID')],
      ['com.mdlf.training.pro.monthly', 'com.mdlf.training.pro.yearly', 'com.mdlf.training.access.gift']);
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
    // Essai : toujours 7 jours
    assert.equal(offline(trial(), 8)[0], false);
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
}
