// Essai coach par offre promotionnelle d'Apple (17/11/2026, docs/PAYANT_V1.md « Essai coach pour qui a déjà eu
// un essai ») : règles pures de la fonction Edge coach-promo-offer, lecture de l'offre chez StoreKit, décision de
// l'app (jamais d'offre annoncée si l'essai de lancement est encore accordé), achat avec l'offre signée ou pas
// d'achat du tout, migration et retour arrière.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, assert, sameJSON, ROOT }) {
  const policy = () => import(path.join(ROOT, 'supabase/functions/coach-promo-offer/promo-policy.js'));
  const C10 = 'com.mdlf.training.coach10.monthly';

  test('promo coach : requête validée (8 produits coach seulement, introEligible booléen)', async () => {
    const { promoRequest, COACH_PRODUCTS } = await policy();
    assert.equal(COACH_PRODUCTS.length, 8);
    sameJSON(promoRequest({ productId: C10, introEligible: false }), { ok: true, productId: C10, introEligible: false });
    for (const b of [null, {}, { productId: 'com.mdlf.training.pro.monthly', introEligible: false }, { productId: C10 + 'x', introEligible: false }]) {
      assert.equal(promoRequest(b).error, 'unknown_product', JSON.stringify(b));
    }
    assert.equal(promoRequest({ productId: C10, introEligible: 'false' }).error, 'bad_request');
    // Les mêmes huit identifiants que la migration (private.coach_promo_product) et le catalogue de l'app
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261117020000_promo_coach.sql'), 'utf8');
    for (const id of COACH_PRODUCTS) assert.ok(sql.includes(`'${id}'`), `${id} absent de la migration`);
    sameJSON([...COACH_PRODUCTS].sort(), run(`PLAN_IDS.filter(planIsCoach)`).sort());
  });

  test('promo coach : charge utile JWS d\'Apple (aud promotional-offer, sans exp, nonce minuscule)', async () => {
    const { promoClaims, promoHeader } = await policy();
    const c = promoClaims({ issuerId: 'faux-issuer', productId: C10, offerId: C10 + '.essai2mois',
      nonce: '6584bedf-2ed0-4c01-93ed-c0c64a1670cc', nowMs: 1_800_000_000_123 });
    sameJSON(c, { iss: 'faux-issuer', iat: 1_800_000_000, aud: 'promotional-offer', bid: 'com.mdlf.training',
      nonce: '6584bedf-2ed0-4c01-93ed-c0c64a1670cc', productId: C10, offerIdentifier: C10 + '.essai2mois' });
    assert.equal('exp' in c, false);
    sameJSON(promoHeader('FAUXKEY'), { alg: 'ES256', kid: 'FAUXKEY', typ: 'JWT' });
    // Offre d'un autre produit, nonce en majuscules ou absent : rien n'est signé
    assert.throws(() => promoClaims({ issuerId: 'i', productId: C10, offerId: 'com.mdlf.training.coach20.monthly.essai2mois', nonce: '6584bedf-2ed0-4c01-93ed-c0c64a1670cc', nowMs: 0 }));
    assert.throws(() => promoClaims({ issuerId: 'i', productId: C10, offerId: C10 + '.essai2mois', nonce: '6584BEDF-2ED0-4C01-93ED-C0C64A1670CC', nowMs: 0 }));
    assert.throws(() => promoClaims({ issuerId: '', productId: C10, offerId: C10 + '.essai2mois', nonce: '6584bedf-2ed0-4c01-93ed-c0c64a1670cc', nowMs: 0 }));
  });

  test('promo coach : offre lue chez StoreKit, annoncée seulement sans essai de lancement et avec l\'accord du serveur', () => {
    const r = run(`(() => {
      const free = { paymentMode: 'freeTrial', period: { unit: 'month', value: 2 }, periodCount: 1 };
      const coach = (extra = {}) => ({ id: '${C10}', promoOffers: [{ id: '${C10}.essai2mois', ...free }], ...extra });
      const saved = access.coachPromo;
      try {
        const of = [
          accessPromoOf(coach()),
          accessPromoOf(coach({ promoOffers: undefined })),                         // build 68 : pas de clé
          accessPromoOf(coach({ promoOffers: [{ id: 'autre', ...free }] })),          // pas notre offre
          accessPromoOf(coach({ promoOffers: [{ id: '${C10}.essai2mois', ...free, paymentMode: 'payAsYouGo' }] })),
          accessPromoOf({ id: 'com.mdlf.training.pro.monthly', promoOffers: [{ id: 'com.mdlf.training.pro.monthly.essai2mois', ...free }] }),
        ];
        const p = { id: '${C10}', promo: { id: '${C10}.essai2mois', unit: 'month', value: 2 }, trial: null, introEligible: false };
        access.coachPromo = { eligible: true, reason: null };
        const yes = accessCoachPromoFor(p);
        const intro = accessCoachPromoFor({ ...p, introEligible: true, trial: { unit: 'month', value: 2 } });
        access.coachPromo = { eligible: false, reason: 'had_coach' };
        const refused = accessCoachPromoFor(p);
        access.coachPromo = null;
        const unknown = accessCoachPromoFor(p);
        return { of, yes, intro, refused, unknown };
      } finally { access.coachPromo = saved; }
    })()`);
    sameJSON(r.of, [{ id: C10 + '.essai2mois', unit: 'month', value: 2 }, null, null, null, null]);
    sameJSON(r.yes, { id: C10 + '.essai2mois', unit: 'month', value: 2 });
    assert.equal(r.intro, null, 'essai de lancement encore accordé : c\'est lui, sans signature');
    assert.equal(r.refused, null);
    assert.equal(r.unknown, null, 'serveur pas encore lu : prix normal');
  });

  test('promo coach : achat avec l\'offre signée, ou aucun achat (jamais au prix plein en silence)', async () => {
    const r = await run(`(async () => {
      const savedStore = Native.store, savedSb = sb, savedUser = account.user, saved = { ...access };
      const calls = [];
      try {
        account.user = { id: '00000000-0000-4000-8000-000000000001' };
        access.coachPromo = { eligible: true, reason: null };
        access.products = [{ id: '${C10}', price: '15,99 €', period: 'month', trial: null, introEligible: false,
          promo: { id: '${C10}.essai2mois', unit: 'month', value: 2 } }];
        let signed = { data: { ok: true, offerId: '${C10}.essai2mois', jws: 'a.b.c' }, error: null };
        sb = { functions: { invoke: async (fn, o) => { calls.push(['invoke', fn, JSON.stringify(o.body)]);
                 return fn === 'coach-promo-offer' ? signed : { data: null, error: { context: { status: 400, json: async () => ({ error: 'invalid_jws' }) } } }; } },
               rpc: async fn => { calls.push(['rpc', fn]); return { data: { eligible: false, reason: 'had_coach' }, error: null }; } };
        let answer = { status: 'userCancelled' };
        Native.store = { available: true, purchase: async (id, token, promo) => { calls.push(['purchase', id, JSON.stringify(promo)]); return answer; },
          finish: async () => true };
        const cancel = await accessBuy('${C10}');
        answer = { status: 'promoRefused' };
        const refusedByApple = await accessBuy('${C10}');
        access.coachPromo = { eligible: true, reason: null };
        signed = { data: null, error: { context: { status: 403, json: async () => ({ error: 'had_coach' }) } } };
        const refusedByServer = await accessBuy('${C10}');
        return { cancel, refusedByApple, refusedByServer, calls, after: access.coachPromo };
      } finally { Native.store = savedStore; sb = savedSb; account.user = savedUser; Object.assign(access, saved); }
    })()`);
    sameJSON(r.cancel, { ok: false, reason: 'cancel' });
    sameJSON(r.refusedByApple, { ok: false, kind: 'promo_refused' });
    sameJSON(r.refusedByServer, { ok: false, kind: 'promo_unavailable' });
    sameJSON(r.calls.slice(0, 2), [['invoke', 'coach-promo-offer', JSON.stringify({ productId: C10, introEligible: false })],
      ['purchase', C10, JSON.stringify({ offerId: C10 + '.essai2mois', jws: 'a.b.c' })]]);
    // Refus du serveur : aucun achat lancé, droit relu (l'écran repasse au prix normal)
    const last = r.calls.slice(-2);
    sameJSON(last, [['invoke', 'coach-promo-offer', JSON.stringify({ productId: C10, introEligible: false })], ['rpc', 'coach_promo_state']]);
    sameJSON(r.after, { eligible: false, reason: 'had_coach' });
    assert.ok(run(`accessErrorText('promo_unavailable')`).includes('Rien n\'a été débité'));
    assert.ok(run(`accessErrorText('promo_refused')`).includes('Rien n\'a été débité'));
  });

  test('promo coach : migration (RLS fermée, aucun GRANT de table, RPC limitées), retour arrière, fonction Edge déclarée', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261117020000_promo_coach.sql'), 'utf8');
    assert.ok(/alter table public\.coach_promo_offers enable row level security/.test(sql));
    assert.ok(!/grant [^;]* on (table )?public\.coach_promo_offers/i.test(sql), 'table lisible par l\'API');
    assert.ok(/grant execute on function public\.coach_promo_state\(\) to authenticated;/.test(sql));
    assert.ok(/grant execute on function public\.srv_coach_promo_grant\(uuid, text, boolean\) to service_role;/.test(sql));
    const down = fs.readFileSync(path.join(ROOT, 'supabase/rollback/20261117020000_promo_coach_down.sql'), 'utf8');
    for (const o of ['public.coach_promo_offers', 'private.coach_sub_seen', 'public.coach_promo_state()', 'entitlement_claims_coach_promo']) {
      assert.ok(down.includes(o), `${o} absent du retour arrière`);
    }
    const toml = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
    assert.ok(/\[functions\.coach-promo-offer\]\n[^\n]*\nverify_jwt = false/.test(toml), 'coach-promo-offer : jeton vérifié dans le code');
    const edge = fs.readFileSync(path.join(ROOT, 'supabase/functions/coach-promo-offer/index.ts'), 'utf8');
    assert.ok(edge.includes('await caller(req)') && edge.indexOf('await caller(req)') < edge.indexOf("rpc('srv_coach_promo_grant'"), 'appelant vérifié avant la base');
    assert.ok(!/setExpirationTime/.test(edge), 'Apple refuse un JWS d\'offre qui porte exp');
  });
}
