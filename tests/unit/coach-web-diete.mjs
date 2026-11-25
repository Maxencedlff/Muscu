// ═══════════════════════════════════════════════════════════
//  Appli web du coach, plans diète (docs/COACH_WEB.md, « Plans diète ») : logique de l'éditeur dans le contexte exact
//  de la page (scripts de coach-web/index.html, main.js excepté), sur la vraie base Ciqual (data/foods.json).
//  Format identique à l'app (coachDietPayload, dietToSent), règles de l'app réutilisées (portions, équivalences,
//  objectifs, aliments perso, jours), annuler / rétablir, écritures sur le compte (opérations rejouées, accord exigé,
//  autres clés intactes, écriture concurrente), recherche sans accents, fusion de l'iPhone (plan le plus récent gagne).
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export default function ({ test, assert, ROOT }) {
  const html = fs.readFileSync(path.join(ROOT, 'coach-web/index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => path.normalize(path.join('coach-web', m[1])));
  const store = new Map();
  const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, Intl, atob, btoa, TextEncoder, TextDecoder, crypto: globalThis.crypto,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, addEventListener() {}, document: { querySelector: () => null, getElementById: () => null, addEventListener() {} } };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files.filter(f => !f.endsWith('main.js'))) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const run = code => vm.runInContext(code, ctx);
  const J = o => JSON.stringify(o);
  ctx.__foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
  run('setFoodDb(__foods)');
  const food = name => run(`foodDb.foods.find(f => f.name === ${J(name)})`);

  test('coach web diète : scripts chargés (base, équivalences, code-barres), CSP ouverte à Open Food Facts seulement', () => {
    for (const f of ['../js/data/food-swap.js', '../js/data/food-scan.js', '../js/data/diet-estimate.js', 'js/desk/diet-edit-model.js', 'js/desk/diet-editor.js'])
      assert.ok(html.includes(`<script src="${f}"></script>`), f);
    assert.match(html, /connect-src 'self' https:\/\/yopptmdjtnezmccdvaxf\.supabase\.co https:\/\/world\.openfoodfacts\.org;/);
    const vj = fs.readFileSync(path.join(ROOT, 'coach-web/vercel.json'), 'utf8');
    assert.match(vj, /connect-src 'self' https:\/\/yopptmdjtnezmccdvaxf\.supabase\.co https:\/\/world\.openfoodfacts\.org;/, 'en-têtes du déploiement : même CSP');
    assert.match(html, /<meta name="mdlf-foods" content="\.\.\/data\/foods\.json">/, 'base servie un dossier plus haut dans le dépôt');
    assert.match(fs.readFileSync(path.join(ROOT, 'scripts/build-coach-web.mjs'), 'utf8'), /foods\.json/, 'la construction copie la base');
    assert.equal(store.size, 0, 'rien écrit sur l\'appareil');
    assert.equal(run('DESK_DT_DOC_MAX'), 800 * 1024, 'marge sous les 900 Ko de la synchro de l\'iPhone');
    assert.match(fs.readFileSync(path.join(ROOT, 'js/data/sync.js'), 'utf8'), /SYNC_PROFILE_MAX_BYTES = 900 \* 1024/);
    assert.match(fs.readFileSync(path.join(ROOT, 'js/data/sync.js'), 'utf8'), /const DIET_SYNC_V = 1;/, 'même version de fusion que l\'app');
    assert.equal(run('DESK_DT_SYNC_V'), 1);
  });

  test('coach web diète : recherche Ciqual rapide, accents et majuscules ignorés, aliments perso d\'abord', () => {
    const a = run(`searchFoods('POULET grillé').slice(0, 3).map(x => x.food.name)`);
    const b = run(`searchFoods('poulet grille').slice(0, 3).map(x => x.food.name)`);
    assert.deepEqual(a, b);
    assert.ok(a.length && a.every(n => /poulet/i.test(n)));
    const own = [{ id: 'wh1', name: 'Whey vanille', fam: 'v', per: { k: 380, p: 78, c: 6, f: 5 } }];
    assert.equal(run(`searchFoods('whey', { own: ${J(own)} })[0].own`), true);
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) run(`searchFoods('riz basmati cuit')`);
    assert.ok((performance.now() - t0) / 50 < 30, 'moins de 30 ms par frappe');
  });

  test('coach web diète : plan neuf, aliments, quantités en grammes et à l\'unité, macros en direct', () => {
    run(`window.__acc = deskDtAcc({ dietConsent: { on: true, at: 1 }, dietPlans: {} }); window.__n = deskDtNew(__acc, 'Sèche Léa');`);
    assert.equal(run('__n.plan.meals.map(m => m.name).join()'), 'Petit-déjeuner,Déjeuner,Collation,Dîner');
    assert.ok(run('/^d_/.test(__n.id)'));
    run(`window.__p = deskDtDraft(__n.plan); window.__m = __p.meals[1].id;`);
    const riz = food('Riz blanc, cuit, sans sel ajouté'), oeuf = food('Oeuf dur');
    assert.ok(riz && oeuf, 'aliments de la base');
    ctx.__riz = riz; ctx.__oeuf = oeuf;
    assert.ok(run('deskDtAddItem(__p, __m, __riz, 150).ok'));
    const kcal150 = run('dietPlanMacros(__p).kcal');
    assert.ok(Math.abs(kcal150 - riz.per.k * 1.5) < 1);
    const it = run('__p.meals[1].items[0]');
    assert.equal(it.src, 'ciqual-2025'); assert.equal(it.food, riz.code); assert.equal(it.g, 150);
    // Quantité tapée : 200 g → macros recalculées
    run(`deskDtSetQty(__p.meals[1].items[0], [], -1, '200')`);
    assert.ok(Math.abs(run('dietPlanMacros(__p).kcal') - riz.per.k * 2) < 1);
    assert.match(run(`deskDtSetQty(__p.meals[1].items[0], [], -1, '0').err`), /^Quantité : de 1 à 2.000 g\.$/, 'message de l\'app');
    assert.equal(run('__p.meals[1].items[0].g'), 200, 'quantité refusée : rien ne change');
    // À l'unité : 2 œufs → 100 g, l'unité gardée à côté (por), g fait foi
    run(`deskDtAddItem(__p, __m, __oeuf, 50); window.__u = dietQtyUnits(__p.meals[1].items[1]);`);
    assert.equal(run('__u[0].u'), 'œuf');
    assert.ok(run(`deskDtSetQty(__p.meals[1].items[1], __u, 0, '2').ok`));
    assert.equal(J(run('[__p.meals[1].items[1].g, __p.meals[1].items[1].por.n]')), J([100, 2]));
    assert.match(run('dietQtyText(__p.meals[1].items[1])'), /^2\s+œufs · 100\s+g$/);
    assert.equal(run(`deskDtAddItem(__p, 'nope', __riz, 10).kind`), 'server');
  });

  test('coach web diète : format envoyé identique à l\'app (coachDietPayload, dietToSent)', () => {
    run(`window.__app = { dietPlans: { [__n.id]: JSON.parse(JSON.stringify(__p)) } };`);
    const web = run('deskDtPayload(__n.id, __p)'), app = run('coachDietPayload(__app, __n.id)');
    assert.ok(web.ok);
    assert.equal(J(web), J(app), 'mêmes octets que l\'envoi de l\'app');
    assert.equal(web.progId, run('dietSentId(__n.id)'));
    assert.equal(web.data.kind, 'diet'); assert.equal(web.data.v, 1);
    assert.equal(run('deskDtPlanIdOfSent(dietSentId(__n.id))'), run('__n.id'), 'retour de l\'envoi vers mon plan');
    // Ce que l'élève lit (cleanSentDiet) redonne le même plan
    const back = run(`cleanSentDiet(${J(web.data)})`);
    assert.equal(J(back.meals), J(web.data.diet.meals));
    assert.equal(run(`deskDtPayload('d_vide', deskDtNew({ dietPlans: {} }, 'Vide').plan).kind`), 'empty_diet');
  });

  test('coach web diète : repas (ajout, nom en double, masquer un repas de base, ordre) et annuler / rétablir', () => {
    run(`window.__h = deskDtHistory();`);
    const before = run('JSON.stringify(__p)');
    ctx.__before = before;
    assert.equal(run(`deskDtAddMeal(__p, 'déjeuner').kind`), 'taken', 'sans casse ni accents');
    assert.equal(run(`deskDtAddMeal(__p, '   ').kind`), 'empty');
    assert.ok(run(`deskDtAddMeal(__p, 'Avant la séance').ok`));
    run(`deskDtPush(__h, __before)`);
    assert.equal(run(`deskDtRemoveMeal(__p, __p.meals[2].id)`), 'hidden', 'Collation : repas de base masqué');
    assert.equal(run(`deskDtRemoveMeal(__p, __p.meals.at(-1).id)`), 'deleted');
    assert.equal(run('dietShownMeals(__p).length'), 3);
    // Glisser Dîner en tête : position 1, les repas masqués restent à la fin
    const pos = run(`deskDtMoveMeal(__p, dietShownMeals(__p).at(-1).id, 0)`);
    assert.equal(pos, 1);
    assert.equal(run('dietShownMeals(__p)[0].name'), 'Dîner');
    assert.equal(run('__p.meals.at(-1).hidden'), true);
    const undone = run('deskDtUndo(__h, __p)');
    assert.equal(J(undone), before, 'Annuler revient à l\'état d\'avant');
    assert.ok(run('deskDtRedo(__h, __p)'), 'Rétablir');
    run(`window.__h2 = deskDtHistory(); deskDtPush(__h2, '"a"', 'qty:1'); deskDtPush(__h2, '"b"', 'qty:1'); deskDtPush(__h2, '"c"', 'name');`);
    assert.equal(run('__h2.past.length'), 2, 'la frappe dans un même champ ne fait qu\'un retour');
    run(`window.__h3 = deskDtHistory(); for (let i = 0; i < 200; i++) deskDtPush(__h3, String(i));`);
    assert.equal(run('__h3.past.length'), run('DESK_DT_UNDO_MAX'));
  });

  test('coach web diète : équivalences de l\'app (pomme de terre → riz, même macro principal), déplacer un aliment', () => {
    const pdt = food('Pomme de terre, bouillie/cuite à l\'eau');
    ctx.__pdt = pdt;
    run(`window.__q = deskDtDraft(deskDtNew({ dietPlans: {} }, 'Test').plan); deskDtAddItem(__q, __q.meals[1].id, __pdt, 350);`);
    const cands = run('swapCandidates(__q.meals[1].items[0])');
    const r = cands.find(c => c.food.name.startsWith('Riz blanc, cuit'));
    assert.ok(r, 'riz proposé');
    assert.equal(r.g, 175, 'quantité de la doc (350 × 16,8 / 33,2, aux 5 g)');
    ctx.__cand = r;
    const id = run('__q.meals[1].items[0].id');
    const nu = run('deskDtSwap(__q, __q.meals[1].id, __q.meals[1].items[0].id, __cand)');
    assert.ok(nu.name.startsWith('Riz blanc, cuit')); assert.equal(nu.g, 175); assert.equal(nu.id, id, 'même identifiant (coches de l\'élève)');
    assert.equal(J(nu), J(run('dietSwapItem({ id: __q.meals[1].items[0].id }, __cand)')), 'même remplacement que l\'éditeur de l\'app');
    assert.ok(run(`deskDtMoveItem(__q, __q.meals[1].id, __q.meals[1].items[0].id, __q.meals[3].id).ok`));
    assert.ok(run('__q.meals[3].items[0].name').startsWith('Riz blanc'));
    assert.equal(run(`deskDtMoveItem(__q, __q.meals[3].id, 'x', __q.meals[1].id).kind`), 'server');
  });

  test('coach web diète : jours d\'entraînement et de repos, semaine, copies (règles de l\'app)', () => {
    run(`window.__w = deskDtDraft(__p);`);
    assert.ok(run(`deskDtSetMode(__w, 'session')`));
    assert.equal(run('__w.days.mode'), 'session');
    assert.equal(run('dietPlanDays(__w).length'), 2);
    assert.equal(J(run('dietDayObj(__w, 1).meals.map(m => m.id)')), J(run('dietShownMeals(__w).map(m => m.id)')), 'jour de repos : mêmes identifiants');
    assert.ok(run(`deskDtSetTargets(dietDayObj(__w, 1), { kcal: '1 650', p: '120', c: '', f: '', waterMin: '2', waterMax: '3', saltMin: '', saltMax: '5' }).ok`));
    assert.equal(J(run('dietDayObj(__w, 1).targets')), J({ kcal: 1650, p: 120, water: 3, waterMin: 2, saltMax: 5 }));
    assert.equal(run(`deskDtSetTargets(dietDayObj(__w, 1), { kcal: '20000' }).field`), 'kcal');
    assert.equal(run(`deskDtSetTargets(dietDayObj(__w, 1), { waterMin: '3', waterMax: '2' }).err`), 'Eau : la première valeur doit être plus petite que la seconde.');
    assert.ok(run(`deskDtSetMode(__w, 'week')`));
    assert.equal(run('dietPlanDays(__w).length'), 7);
    assert.ok(run(`deskDtSetKind(__w, 2, 'r')`));
    assert.equal(run('dietDayKindAt(__w, 2)'), 'r');
    assert.equal(run(`deskDtSetKind(__w, 9, 'r')`), false);
    assert.ok(run(`!!dietCopyDayToDays(__w, 0, [1, 2])`));
    assert.equal(run(`deskDtSetMode(__w, 'week')`), false, 'déjà en semaine');
    const v = run(`deskDtPayload(__n.id, __w)`);
    assert.ok(v.ok && v.data.diet.days.mode === 'week' && v.data.diet.days.kinds[2] === 'r', 'jours envoyés comme l\'app');
    assert.ok(run('deskDtFarDays(__w)').every(x => /^[A-Z]/.test(x)));
  });

  test('coach web diète : objectifs et aliment perso, mêmes règles et mêmes messages que l\'app', () => {
    assert.equal(J(run(`dietTargetsFromForm({ kcal: '2 900', p: '', c: '', f: '' })`)), J({ targets: { kcal: 2900 } }));
    assert.equal(J(run(`dietTargetsFromForm({ kcal: '', p: '', c: '', f: '' })`)), J({ targets: null }), 'vide : aucun objectif');
    assert.equal(run(`dietTargetsFromForm({ p: '1,9' }, { perKg: true, kg: 75 }).targets.p`), run('Math.round(dietProteinGrams("1,9", 75))'));
    const ok = run(`dietFoodFromForm({ name: 'Skyr nature', k: '', p: '11', c: '4', f: '0', portion: '150', fam: '' })`);
    assert.equal(ok.food.per.k, 60, 'énergie vide : 4 / 4 / 9');
    assert.equal(ok.food.fam, 'v');
    assert.equal(J(ok.food.portion), J({ u: 'portion', pl: 'portions', g: 150 }));
    assert.equal(run(`dietFoodFromForm({ name: '  ' }).field`), 'name');
    assert.equal(run(`dietFoodFromForm({ name: 'X', p: '80', c: '30', f: '0' }).err`), 'Plus de 100 g de macros pour 100 g : vérifie les valeurs.');
    assert.equal(run(`dietFoodFromForm({ name: 'X', p: '10', portion: '0' }).field`), 'portion');
    assert.equal(run(`dietFoodFromForm({ name: 'Barre', p: '20', c: '40', f: '10' }, { code: '3017620422003' }).food.code`), '3017620422003');
    // Recopié depuis la feuille de l'app : la feuille et le site appellent la même fonction
    const editor = fs.readFileSync(path.join(ROOT, 'js/features/diet-editor.js'), 'utf8');
    assert.match(editor, /dietFoodFromForm\(/); assert.match(editor, /dietTargetsFromForm\(/); assert.match(editor, /dietSwapItem\(/);
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'coach-web/js/desk/diet-editor.js'), 'utf8'), /cleanDietItem\(\{|num\(v\('#/, 'aucune règle recopiée sur le site');
  });

  test('coach web diète : écritures sur le compte (opération rejouée, accord exigé, autres clés intactes, plafonds)', () => {
    const doc = { unit: 'kg', userProgrammes: { u_a: { name: 'A' } }, dietConsent: { on: true, at: 5 }, dietSyncV: 1,
      dietPlans: { d_old: { name: 'Ancien', meals: [], updatedAt: 1 } }, dietFoods: [{ id: 'sk1', name: 'Skyr', fam: 'l', per: { k: 60, p: 11, c: 4, f: 0 } }] };
    ctx.__doc = doc;
    const r = run(`deskDtApply(__doc, deskDtOpSave(__n.id, __p, 1234))`);
    assert.ok(r.ok);
    assert.equal(J(r.doc.userProgrammes), J(doc.userProgrammes), 'programmes jamais touchés');
    assert.equal(r.doc.unit, 'kg');
    assert.equal(r.doc.dietPlans[run('__n.id')].updatedAt, 1234, 'daté (départage un vrai conflit)');
    assert.ok(r.doc.dietPlans.d_old, 'les autres plans restent');
    assert.equal(doc.dietPlans[run('__n.id')], undefined, 'document relu non modifié');
    assert.equal(run(`deskDtApply({ ...__doc, dietConsent: { on: false, at: 9 } }, deskDtOpSave('d_x', __p)).kind`), 'no_consent');
    assert.equal(run(`deskDtApply(null, deskDtOpSave('d_x', __p)).kind`), 'no_doc');
    const arch = run(`deskDtApply(__doc, deskDtOpArchive('d_old', 99))`);
    assert.ok(arch.doc.dietPlans.d_old.archived && arch.doc.dietPlans.d_old.updatedAt > 1, 'archivé, daté au-delà de la date d\'avant');
    assert.equal(doc.dietPlans.d_old.archived, undefined);
    const f = run(`dietFoodFromForm({ name: 'Whey', p: '78', c: '6', f: '5' }).food`);
    ctx.__f = f;
    const kept = run(`deskDtApply(__doc, deskDtOpKeepFood(__f))`);
    assert.equal(kept.doc.dietFoods[0].name, 'Whey');
    const rm = run(`deskDtApply(__doc, deskDtOpRemoveFood('sk1'))`);
    assert.equal(rm.doc.dietFoods, undefined); assert.equal(J(rm.doc.dietFoodsGone), J(['sk1']), 'retrait suivi comme l\'app');
    run(`window.__full = { ...__doc, dietFoods: Array.from({ length: 200 }, (_, i) => ({ id: 'f' + i, name: 'Aliment ' + i, fam: 'v', per: { k: 100, p: 20, c: 0, f: 2 } })) }`);
    assert.equal(run(`deskDtApply(__full, deskDtOpKeepFood(__f)).kind`), 'foods_full', 'jamais le plus ancien retiré en silence');
    run(`window.__many = { ...__doc, dietPlans: Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['d_p' + i, { name: 'P' + i, meals: [] }])) }`);
    assert.equal(run(`deskDtApply(__many, deskDtOpSave('d_neuf', __p)).kind`), 'plans_full');
    assert.ok(run(`deskDtApply(__many, deskDtOpSave('d_p3', __p)).ok`), 'un plan existant se met à jour même au plafond');
    assert.equal(run(`deskDtApply({ ...__doc, dietSyncV: undefined }, deskDtOpSave('d_x', __p)).kind`), 'old_phone', 'iPhone d\'avant la fusion à trois voies : rien n\'est écrit');
    // Brouillon périmé : le plan a changé ailleurs depuis l'ouverture (date différente)
    assert.equal(run(`deskDtApply(__doc, deskDtOpSave('d_old', __p, 50, { expectAt: 0 })).kind`), 'stale');
    assert.equal(run(`deskDtApply(__doc, deskDtOpSave('d_old', __p, 50, { expectAt: 0 })).current.name`), 'Ancien');
    assert.ok(run(`deskDtApply(__doc, deskDtOpSave('d_old', __p, 50, { expectAt: 1 })).ok`), 'même date : enregistré');
    assert.equal(run(`deskDtApply(__doc, deskDtOpSave('d_old', __p, 0)).doc.dietPlans.d_old.updatedAt`), 2, 'horloge en retard : la date passe quand même au-delà de l\'ancienne');
    run(`window.__fat = { ...__doc, notes: 'x'.repeat(830000) }`);
    assert.equal(run(`deskDtApply(__fat, deskDtOpSave('d_x', __p)).kind`), 'doc_too_big');
  });

  test('coach web diète : deskWriteDiet conditionné par updated_at, relit et rejoue après une écriture de l\'iPhone', async () => {
    run(`window.__srv = { doc: { dietConsent: { on: true, at: 1 }, dietSyncV: 1, dietPlans: {}, unit: 'kg' }, at: 'A', writes: 0, races: 1 };
      desk.user = { id: 'coach' };
      const q = () => { const st = { op: 'select', eqs: {} }; const c = {
        select() { return c; }, eq(k, v) { st.eqs[k] = v; return c; }, update(p) { st.op = 'update'; st.patch = p; return c; },
        maybeSingle() { return Promise.resolve({ data: { doc: JSON.parse(JSON.stringify(__srv.doc)), updated_at: __srv.at }, error: null }); },
        then(res) { if (st.op !== 'update') return res({ data: null, error: null });
          if (__srv.races > 0) { __srv.races--; __srv.doc.unit = 'lbs'; __srv.at = 'B'; return res({ data: [], error: null }); }
          if (st.eqs.updated_at !== __srv.at) return res({ data: [], error: null });
          __srv.doc = st.patch.doc; __srv.at = 'C'; __srv.writes++; return res({ data: [{ updated_at: 'C' }], error: null }); } }; return c; };
      deskClient = () => ({ from: () => q() });`);
    const r = await run(`deskWriteDiet(deskDtOpSave(__n.id, __p))`);
    assert.ok(r.ok, J(r));
    assert.equal(run('__srv.writes'), 1);
    assert.equal(run('__srv.doc.unit'), 'lbs', 'le changement de l\'iPhone arrivé entre-temps est gardé');
    assert.ok(run('__srv.doc.dietPlans[__n.id]'));
    run(`__srv.races = 5`);
    assert.equal((await run(`deskWriteDiet(deskDtOpSave(__n.id, __p))`)).kind, 'conflict', 'trois essais au plus');
  });

  test('coach web diète : textes reçus échappés, routes de l\'éditeur', () => {
    run(`dt.acc = deskDtAcc({ dietConsent: { on: true, at: 1 }, dietPlans: { d_x: { name: '<img src=x onerror=alert(1)>', meals: [{ id: 'm1', name: '<b>Repas</b>', items: [] }] } },
      dietFoods: [{ id: 'f1', name: '<script>x</script>', fam: 'v', per: { k: 1, p: 0, c: 0, f: 0 } }] });`);
    const lib = run(`deskDtLibHtml({ id: null })`);
    assert.doesNotMatch(lib, /<img|<script>/);
    run(`deskDtUse({ key: 'lib:d_x', ctx: { kind: 'lib' }, id: 'd_x', plan: dt.acc.dietPlans.d_x, src: 'account' })`);
    const ed = run(`deskDtEditorHtml(null)`);
    assert.doesNotMatch(ed, /<b>Repas|<img/);
    assert.match(ed, /data-dt-grip="m1"/);
    assert.equal(run(`deskDtRouteKey('#/plans-diete/d_x')`), 'lib:d_x');
    assert.equal(run(`deskDtRouteKey('#/eleve/1234-ab/nutrition/edit')`), 'st:1234-ab:edit');
    assert.equal(run(`deskDtRouteKey('#/plans-diete')`), null);
    assert.equal(run('deskDtDirty()'), false);
    run(`dt.draft.name = 'Autre'`);
    assert.equal(run('deskDtDirty()'), true);
    run('deskDtReset()');
  });
}
