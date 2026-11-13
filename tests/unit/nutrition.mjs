// Nutrition V1 (docs/NUTRITION_V1.md) : plans bornés, macros, repas cochés, équivalences sur la vraie base
// Ciqual embarquée (data/foods.json), plan envoyé par le coach par le canal des programmes.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const foods = JSON.parse(read('data/foods.json'));
  const loadDb = () => { run(`setFoodDb(${JSON.stringify(foods)})`); };
  // Aliment de la base (code Ciqual 2025) → aliment du plan
  const item = (code, g) => run(`foodToItem(foodDb.byCode.get(${code}), ${g})`);
  const RIZ_CUIT = 9104, POULET_GRILLE = 36018, OEUF_DUR = 22010, HUILE_OLIVE = 17270;

  test('jauges : remplies selon les nombres affichés (« 4 / 4 g » = pleine)', () => {
    assert.equal(run('dietShownRatio(3.6, 4.4)'), 1, '3,6 sur 4,4 g, affichés « 4 / 4 g » : pleine');
    assert.equal(run('dietShownRatio(217.4, 216.6)'), 1);
    assert.equal(run('dietShownRatio(2, 4)'), 0.5);
    assert.equal(run('dietShownRatio(9, 4)'), 1, 'au-delà : plafonnée');
    assert.equal(run('dietShownRatio(3, 0)'), 0, 'sans repère : vide');
    assert.equal(run('dietShownRatio(0.4, 0.4)'), 0, '« 0 / 0 g » : rien à remplir');
  });

  test('base Ciqual : fichier compact, source et licence citées, lignes valides', () => {
    const size = fs.statSync(path.join(ROOT, 'data/foods.json')).size;
    assert.ok(size < 500 * 1024, `data/foods.json : ${size} octets (500 Ko au plus)`);
    assert.equal(foods.v, 1);
    assert.match(foods.source, /^Anses\. 2025\. Table de composition nutritionnelle des aliments Ciqual$/);
    assert.equal(foods.licence, 'Licence Ouverte Etalab 2.0');
    assert.equal(foods.url, 'https://doi.org/10.57745/RDMHWY');
    loadDb();
    const n = run('foodDb.foods.length');
    assert.ok(n > 3000 && n === foods.foods.length, `toutes les lignes acceptées (${n})`);
    sameJSON(run(`foodDb.byCode.get(${RIZ_CUIT}).per`), { k: 155, p: 3.3, c: 33.2, f: 0.7 }, 'riz blanc cuit : valeurs Ciqual non retouchées, protéines N × 6,25');
    assert.equal(run(`foodDb.byCode.get(${RIZ_CUIT}).fam`), 'f');
    assert.equal(run(`foodDb.byCode.get(${POULET_GRILLE}).fam`), 'v');
    // Aucun aliment infantile (groupe 11), aucune ligne sans protéines, glucides ou lipides connus
    assert.ok(!foods.foods.some(r => r[8] >= 1100 && r[8] < 1200), 'aliments infantiles écartés');
    assert.ok(foods.foods.every(r => [r[4], r[5], r[6]].every(v => typeof v === 'number')), 'macros connues');
    // Ligne illisible ignorée seule
    const bad = { ...foods, foods: [[1, 'Bon', 'f', 100, 1, 20, 1, 0, 301], [2, 'Trop', 'f', 100, 60, 60, 1, 0, 301], ['x', 'Code', 'f', 1, 1, 1, 1], [3, '<b>', 'zz', 1, 1, 1, 1]] };
    assert.equal(run(`cleanFoodDb(${JSON.stringify(bad)}).foods.length`), 1);
    assert.equal(run(`cleanFoodDb({ v: 2, foods: [] })`), null, 'version inconnue refusée');
  });

  test('base Ciqual : énergie inconnue calculée (1169/2011) seulement si fibres et alcool sont connus, sinon écartée', () => {
    loadDb();
    const has = code => run(`foodDb.byCode.has(${code})`);
    // Énergie « - » et alcool inconnu : 0 kcal serait faux (eau-de-vie, pastis, baba au rhum), poudre maltée sans fibres
    for (const [code, name] of [[1024, 'calvados'], [1010, 'pastis prêt à boire'], [23021, 'baba au rhum'], [18102, 'poudre maltée']]) assert.ok(!has(code), `${name} écarté`);
    // Calculée : marquée (e = 1, ecalc), et égale à 4 P + 4 G + 9 L + 2 fibres + 7 alcool à l'arrondi près
    const calc = foods.foods.filter(r => r[9] === 1);
    assert.ok(calc.length > 20 && calc.length < 80, `${calc.length} aliments à énergie calculée`);
    assert.ok(calc.every(r => r[3] >= 4 * r[4] + 4 * r[5] + 9 * r[6] - 1), 'au moins 4P + 4G + 9L');
    assert.equal(run(`foodDb.byCode.get(${calc[0][0]}).ecalc`), true);
    assert.equal(run(`foodToItem(foodDb.byCode.get(${calc[0][0]}), 100).ecalc`), true, 'marque gardée dans le plan');
    assert.equal(run(`foodToItem(foodDb.byCode.get(${RIZ_CUIT}), 100).ecalc`), undefined);
    // Origine des valeurs gardée par chaque aliment du plan
    assert.equal(run(`foodToItem(foodDb.byCode.get(${RIZ_CUIT}), 100).src`), 'ciqual-2025');
    assert.equal(run(`cleanDietItem({ name: 'Whey', g: 30, per: { k: 380, p: 78, c: 6, f: 5 } }).src`), 'perso');
    assert.equal(run(`cleanDietItem({ name: 'X', g: 30, src: 'autre', food: 9104, per: { k: 1, p: 0, c: 0, f: 0 } }).src`), 'ciqual-2025');
  });

  test('accord : sans lui, plans et aliments perso restent sur l\'iPhone ; retiré, le profil envoyé les efface', () => {
    reset();
    run(`data.dietPlans = { d_a: { name: 'P', meals: [] } }; data.dietActive = 'd_a'; data.dietFoods = [{ name: 'Skyr', per: { k: 63, p: 11, c: 4, f: 0.2 } }]; sanitizeData(data)`);
    const keys = () => run('Object.keys(profilePayload(data))');
    assert.ok(!keys().some(k => k.startsWith('diet')), 'sans accord : rien de la nutrition');
    run('dietSetConsent(data, true, new Date(Date.UTC(2026, 10, 5)))');
    assert.ok(['dietPlans', 'dietActive', 'dietFoods', 'dietConsent'].every(k => keys().includes(k)), 'avec accord : copiés');
    assert.equal(run('data.dietConsent.at'), '2026-11-05T00:00:00.000Z', 'accord daté');
    run('dietSetConsent(data, false)');
    sameJSON(keys().filter(k => k.startsWith('diet')), ['dietConsent'], 'accord retiré : seul le refus part (les plans sont retirés du serveur)');
    assert.ok(run(`SYNC_LOCAL_ONLY.includes('dietConsentAsked') && SYNC_LOCAL_ONLY.includes('dietHideNumbers') && SYNC_LOCAL_ONLY.includes('dietStreakOff')`));
    // Profil reçu sans nutrition (appareil vierge) : les plans de l'iPhone ne sont jamais effacés
    run(`data.history = []; applyRemoteProfile(data, { doc: { unit: 'kg' }, updated_at: '2026-11-05T10:00:00Z' }, emptySyncMeta('u1'))`);
    assert.ok(run(`!!data.dietPlans.d_a && data.dietConsent.on === false`), 'plans et choix gardés');
    // Accord illisible : retiré
    run(`data.dietConsent = { on: 'oui', at: 'x' }; sanitizeData(data)`);
    assert.equal(run('data.dietConsent'), undefined);
  });

  test('synchro : retrait fait ailleurs jamais annulé par un conflit ; plans de l\'iPhone jamais perdus ; plan suivi gardé', () => {
    const plan = n => ({ name: n, meals: [{ id: 'm1', name: 'Déj', items: [{ id: 'i1', name: 'Riz', food: 9104, fam: 'f', g: 150, per: { k: 155, p: 3.3, c: 33.2, f: 0.7 }, src: 'ciqual-2025' }] }] });
    const synced = (d, at = '2026-11-01') => { const m = run('emptySyncMeta')('u'); const doc = run('profilePayload')(d); m.profileHash = run('syncHash')(doc); m.profileCore = run('profileCoreHash')(doc); m.profileAt = at; return m; };
    const apply = (d, doc, m, at) => run('applyRemoteProfile')(d, { doc, updated_at: at }, m);
    const dietKeys = d => Object.keys(run('profilePayload')(d)).filter(k => SYNC.includes(k));
    const SYNC = ['dietPlans', 'dietActive', 'dietFoods'];
    // 1. Retrait sur A, conflit sur B (B a modifié un plan hors ligne) : B retient le retrait, sa charge n'a aucune clé diète
    const B = run('(x => x)')({ history: [{ id: 'h1', date: 1 }], unit: 'kg', dietConsent: { on: true, at: '2026-11-01T10:00:00Z' }, dietPlans: { d_b: plan('Plan B') }, dietActive: 'd_b' });
    const mB = synced(B);
    B.dietPlans.d_b.name = 'Plan B modifié hors ligne';
    B.unit = 'lbs';   // autre changement ici : vrai conflit
    apply(B, { unit: 'kg', dietConsent: { on: false, at: '2026-11-03T10:00:00Z' } }, mB, '2026-11-03');
    assert.equal(B.dietConsent.on, false, 'la décision la plus récente gagne');
    sameJSON(dietKeys(B), [], 'aucune clé diète renvoyée');
    assert.equal(B.dietPlans.d_b.name, 'Plan B modifié hors ligne', 'plans gardés sur l\'iPhone');
    // Accord plus ancien reçu : ne remplace pas un retrait plus récent fait ici
    apply(B, { unit: 'kg', dietConsent: { on: true, at: '2026-10-01T10:00:00Z' }, dietPlans: { d_x: plan('X') } }, mB, '2026-11-04');
    assert.ok(B.dietConsent.on === false && !B.dietPlans.d_x, 'ancien accord ignoré, rien pris du compte');
    // 2. L'accord arrive d'un autre appareil : les plans locaux restent (union), le plan suivi local aussi
    const A = run('(x => x)')({ history: [{ id: 'h1', date: 1 }], unit: 'kg', dietPlans: { d_local: plan('Plan local') }, dietActive: 'd_local' });
    const mA = synced(A);
    apply(A, { unit: 'kg', dietConsent: { on: true, at: '2026-11-02T10:00:00Z' }, dietPlans: { d_r: plan('Plan du compte') }, dietActive: 'd_r' }, mA, '2026-11-02');
    sameJSON(Object.keys(A.dietPlans).sort(), ['d_local', 'd_r']);
    assert.equal(A.dietActive, 'd_local', 'plan suivi de l\'iPhone gardé');
    // 3. Appareil sans séance (coach, nutrition seule) : jamais recopié tel quel
    const C = run('(x => x)')({ history: [], unit: 'kg', dietConsent: { on: true, at: '2026-11-01T10:00:00Z' }, dietPlans: { d_c: plan('C') } });
    const mC = synced(C);
    C.dietPlans.d_c2 = plan('Créé sur C');
    apply(C, { unit: 'lbs', dietConsent: { on: true, at: '2026-11-01T10:00:00Z' }, dietPlans: { d_c: plan('C') } }, mC, '2026-11-02');
    sameJSON(Object.keys(C.dietPlans).sort(), ['d_c', 'd_c2']);
    // Plan supprimé (archivé) ailleurs, rien de changé ici : archivé ici aussi
    const D = run('(x => x)')({ history: [{ id: 'h', date: 1 }], unit: 'kg', dietConsent: { on: true, at: '2026-11-01T10:00:00Z' }, dietPlans: { d_d: plan('D') }, dietActive: 'd_d' });
    const mD = synced(D);
    apply(D, { unit: 'kg', dietConsent: { on: true, at: '2026-11-01T10:00:00Z' }, dietPlans: { d_d: { ...plan('D'), archived: true, meals: [] } } }, mD, '2026-11-02');
    assert.ok(D.dietPlans.d_d.archived === true && D.dietActive === undefined, 'suppression propagée, plus suivi');
    // 4. Profil renvoyé par une ancienne app (sans nutrition) : rien de la nutrition n'est perdu ici
    const E = run('(x => x)')({ history: [{ id: 'h', date: 1 }], unit: 'kg', dietConsent: { on: true, at: '2026-11-01T10:00:00Z' }, dietPlans: { d_e: plan('E') }, dietActive: 'd_e' });
    const mE = synced(E);
    apply(E, { unit: 'lbs' }, mE, '2026-11-02');
    assert.ok(E.dietConsent.on && E.dietPlans.d_e && E.dietActive === 'd_e', 'gardé, et renvoyé au prochain envoi');
    sameJSON(dietKeys(E), ['dietPlans', 'dietActive']);
  });

  test('profil trop lourd : les plans restent sur l\'iPhone, le reste part', () => {
    reset();
    const big = Array.from({ length: 90 }, (_, i) => [`d_big${i}`, { name: 'P' + i, meals: Array.from({ length: 8 }, (_, j) => ({ id: 'm' + j, name: 'Repas', items: Array.from({ length: 25 }, (_, k) => ({ id: `i${k}`, name: 'Aliment au nom assez long pour peser '.repeat(2), food: 9104, fam: 'f', g: 150, per: { k: 155, p: 3.3, c: 33.2, f: 0.7 }, src: 'ciqual-2025' })) })) }]);
    run(`data.dietPlans = ${JSON.stringify(Object.fromEntries(big))}; data.dietConsent = { on: true, at: '2026-11-05T10:00:00Z' }; sanitizeData(data)`);
    const r = run('profilePayloadForServer(data)');
    assert.equal(r.dietDropped, true);
    assert.ok(!('dietPlans' in r.doc) && 'unit' in r.doc && 'dietConsent' in r.doc, 'plans retirés, reste du profil gardé');
    assert.ok(run('profileBytes')(r.doc) <= run('SYNC_PROFILE_MAX_BYTES'));
    run(`data.dietPlans = { d_a: { name: 'A', meals: [] } }`);
    assert.equal(run('profilePayloadForServer(data).dietDropped'), false);
  });

  test('plans : limite annoncée (jamais un plan retiré en silence), archivés à part, dupliquer, copier un repas', () => {
    reset();
    const alive = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`d_p${i}`, { name: 'P' + i, meals: [] }]));
    const arch = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`d_a${i}`, { name: 'A' + i, meals: [], archived: true, updatedAt: i }]));
    run(`data.dietPlans = ${JSON.stringify({ ...alive, ...arch })}; sanitizeData(data)`);
    const ks = run('Object.keys(data.dietPlans)');
    assert.equal(ks.filter(k => k.startsWith('d_p')).length, 21, 'aucun plan vivant retiré');
    assert.equal(ks.filter(k => k.startsWith('d_a')).length, 50, 'archivés : les 50 plus récents');
    assert.ok(ks.includes('d_a59') && !ks.includes('d_a0'));
    assert.equal(run('dietCanCreate(data, false)'), false, '20 au plus pour un élève');
    assert.equal(run('dietCanCreate(data, true)'), true, 'davantage pour un coach');
    run(`data.dietPlans.d_p0 = { name: 'Sèche', consigne: 'Bois', meals: [{ id: 'm1', name: 'Déj', items: [{ id: 'i1', name: 'Riz', g: 100, per: { k: 155, p: 3, c: 33, f: 1 } }] }], fromCoach: { coachId: 'c', name: 'max', sentAt: 1 } }`);
    const nid = run(`dietDuplicatePlan(data, 'd_p0')`);
    assert.ok(nid && nid !== 'd_p0');
    assert.equal(run(`data.dietPlans['${nid}'].name`), 'Sèche (copie)');
    assert.equal(run(`data.dietPlans['${nid}'].fromCoach`), undefined, 'la copie est à moi');
    assert.equal(run(`data.dietPlans['${nid}'].meals[0].items[0].name`), 'Riz');
    const mid = run(`dietCopyMeal(data.dietPlans['${nid}'], 'm1')`);
    sameJSON(run(`data.dietPlans['${nid}'].meals.map(m => m.name)`), ['Déj', 'Déj (copie)']);
    assert.notEqual(run(`data.dietPlans['${nid}'].meals[1].items[0].id`), 'i1', 'nouveaux identifiants');
    assert.ok(mid);
  });

  test('identifiants : jamais un nom d\'Object ; remplacement lu sur ses propres clés', () => {
    sameJSON(run(`cleanSentDiet({ kind: 'diet', v: 1, diet: { name: 'F', meals: [{ id: 'm1', name: 'D', items: [{ id: '__proto__', name: 'Riz', g: 150, per: { k: 130, p: 2.5, c: 28, f: 0.3 } }, { id: 'constructor', name: 'Poulet', g: 150, per: { k: 120, p: 25, c: 0, f: 2 } }] }] } }).meals[0].items.map(i => ['__proto__', 'constructor'].includes(i.id))`), [false, false]);
    assert.equal(run(`DIET_PART_RE.test('toString')`), false);
    assert.equal(run(`DIET_PART_RE.test('m1')`), true);
    const it = { id: 'toString', name: 'Riz', g: 100, per: { k: 1, p: 0, c: 0, f: 0 } };
    assert.equal(run(`dietEffectiveItem(${JSON.stringify(it)}, {}).name`), 'Riz', 'swaps vide : l\'aliment du plan, jamais Object.prototype');
  });

  test('plan du coach : format plus récent refusé (« Mets l\'app à jour »), aliments illisibles comptés', () => {
    const ok = { id: 'i', name: 'Riz', g: 150, per: { k: 155, p: 3, c: 33, f: 1 } };
    assert.equal(run(`cleanSentDiet({ kind: 'diet', v: 2, diet: { name: 'X', meals: [{ id: 'm', name: 'D', items: [${JSON.stringify(ok)}] }] } })`), null);
    assert.equal(run(`dietSentTooNew({ kind: 'diet', v: 2 })`), true);
    const inbox = run(`cleanInbox({ programmes: [{ id: 'diet_new1', data: { kind: 'diet', v: 2, diet: { name: 'Plan v2' } }, sent_at: '2026-11-05T10:00:00Z' }] })`);
    sameJSON([inbox.diets[0].tooNew, inbox.diets[0].data.name, inbox.programmes.length], [true, 'Plan v2', 0]);
    const p = run(`cleanSentDiet({ kind: 'diet', v: 1, diet: { name: 'X', meals: [{ id: 'm', name: 'D', items: [${JSON.stringify(ok)}, { name: 'Sans valeurs', g: 10 }, { name: 'Trop', g: 99999, per: { k: 1, p: 0, c: 0, f: 0 } }] }] } })`);
    assert.equal(p.dropped, 2);
    reset();
    run(`importCoachDiet(data, { id: 'diet_x', data: ${JSON.stringify(p)}, sentAt: 1 }, { user_id: 'c1', username: 'max' })`);
    assert.equal(run(`Object.values(data.dietPlans)[0].dropped`), undefined, 'jamais gardé dans le plan');
  });

  test('équivalences : boissons alcoolisées jamais croisées avec les autres ; famille d\'un aliment perso choisie', () => {
    loadDb();
    const alc = foods.foods.find(r => r[8] === 603 && r[3] > 30), soft = foods.foods.find(r => r[8] === 602 && r[3] > 30);
    assert.ok(run(`swapCandidates(foodToItem(foodDb.byCode.get(${alc[0]}), 250))`).every(c => c.food.grp === 603), 'alcool → alcool seulement');
    assert.ok(run(`swapCandidates(foodToItem(foodDb.byCode.get(${soft[0]}), 250))`).every(c => c.food.grp !== 603), 'jus ou soda → jamais d\'alcool');
    assert.equal(run(`cleanDietItem({ name: 'Skyr', fam: 'l', g: 150, per: { k: 63, p: 11, c: 4, f: 0.2 } }).fam`), 'l', 'famille choisie gardée');
  });

  test('journée passée : jugée avec les repas du plan de ce jour-là (instantané)', () => {
    reset();
    run(`data.dietPlans = { d_a: { name: 'P', meals: [{ id: 'm1', name: 'A', items: [{ id: 'i', name: 'Riz', g: 100, per: { k: 155, p: 3, c: 33, f: 1 } }] }] } }; data.dietActive = 'd_a';
      dietToggleMeal(data, 'd_a', 'm1', '2026-11-04');`);
    assert.equal(run(`dietDayComplete(data, '2026-11-04')`), true);
    // Le coach ajoute un repas le lendemain : hier reste complet
    run(`data.dietPlans.d_a.meals.push({ id: 'm2', name: 'B', items: [{ id: 'j', name: 'Riz', g: 100, per: { k: 155, p: 3, c: 33, f: 1 } }] })`);
    assert.equal(run(`dietDayComplete(data, '2026-11-04')`), true, 'instantané du jour');
    sameJSON(run(`data.dietLog['2026-11-04'].meals`), ['m1']);
  });

  test('repère de santé : objectif ou total sous 1 200 kcal signalé, jamais bloqué', () => {
    assert.equal(run(`dietLowKcal({ meals: [], targets: { kcal: 1100 } })`), true);
    assert.equal(run(`dietLowKcal({ meals: [], targets: { kcal: 1200 } })`), false);
    assert.equal(run(`dietLowKcal({ meals: [{ id: 'm', name: 'M', items: [{ id: 'i', name: 'Riz', g: 300, per: { k: 155, p: 3, c: 33, f: 1 } }] }] })`), true, 'total du plan sans objectif');
    assert.equal(run(`dietLowKcal({ meals: [] })`), false, 'plan vide : rien à dire');
    // Plan en cours de remplissage (panel du 06/11 : 215 kcal sur un repas de quatre) : pas encore un total
    const riz = `{ id: 'i', name: 'Riz', g: 150, per: { k: 143, p: 3, c: 31, f: 0.3 } }`;
    assert.equal(run(`dietLowKcal({ meals: [{ id: 'a', name: 'A', items: [${riz}] }, { id: 'b', name: 'B', items: [] }] })`), false, 'repas encore vides : rien');
    assert.equal(run(`dietLowKcal({ meals: [{ id: 'a', name: 'A', items: [${riz}] }, { id: 'b', name: 'B', items: [] }], targets: { kcal: 1000 } })`), true, 'objectif fixé : dit même plan incomplet');
  });

  test('recherche : accents et casse ignorés, chaque mot tapé commence un mot, mes aliments d\'abord', () => {
    loadDb();
    const names = (q, own = []) => run(`searchFoods(${JSON.stringify(q)}, { own: ${JSON.stringify(own)} }).map(x => x.food.name)`);
    assert.ok(names('riz cuit').slice(0, 6).every(n => /^Riz .*cuit/.test(n)), names('riz cuit').slice(0, 6).join(' | '));
    assert.ok(names('pates').some(n => n.startsWith('Pâtes')), 'pates trouve Pâtes');
    assert.ok(names('OEUF DUR').includes('Oeuf dur'));
    assert.ok(names('œuf dur').includes('Oeuf dur'), 'œ ramené à oe');
    sameJSON(names('zzzz'), []);
    sameJSON(names('  '), [], 'recherche vide : rien');
    const own = [{ id: 'm1', name: 'Skyr nature', fam: 'v', per: { k: 63, p: 11, c: 4, f: 0.2 } }];
    assert.equal(names('skyr', own)[0], 'Skyr nature', 'aliment perso trouvé (absent de Ciqual)');
    assert.ok(!names('riz blanc', own).includes('Skyr nature'), 'aliment perso qui ne correspond pas : pas listé');
    assert.ok(run(`searchFoods('riz', { limit: 5 }).length`) === 5, 'nombre de résultats borné');
  });

  test('nettoyage : valeurs pour 100 g, quantités, noms, identifiants bornés', () => {
    sameJSON(run(`cleanDietPer({ k: '155', p: 3.14, c: 33.2, f: 0.7 })`), { k: 155, p: 3.1, c: 33.2, f: 0.7 });
    assert.equal(run(`cleanDietPer({ k: 901, p: 1, c: 1, f: 1 })`), null, 'plus de 900 kcal pour 100 g');
    assert.equal(run(`cleanDietPer({ k: 100, p: 50, c: 50, f: 10 })`), null, 'plus de 101 g de macros pour 100 g');
    assert.equal(run(`cleanDietPer({ k: 100, p: -1, c: 1, f: 1 })`), null);
    const it = run(`cleanDietItem({ id: 'a b', name: '  <img src=x onerror=alert(1)>  ', food: 9104.5, g: '150.4', per: { k: 155, p: 3.1, c: 33.2, f: 0.7 } })`);
    assert.equal(it.name, '<img src=x onerror=alert(1)>', 'texte gardé tel quel (échappé à l\'affichage)');
    assert.equal(it.g, 150);
    assert.equal(it.food, null, 'code Ciqual non entier écarté');
    assert.match(it.id, /^[a-z0-9]{1,10}$/, 'identifiant invalide remplacé');
    assert.equal(it.fam, 'f', 'famille tirée des macros (glucides)');
    assert.equal(run(`cleanDietItem({ name: 'X', g: 0, per: { k: 1, p: 0, c: 0, f: 0 } })`), null, 'quantité nulle');
    assert.equal(run(`cleanDietItem({ name: 'X', g: 2001, per: { k: 1, p: 0, c: 0, f: 0 } })`), null, 'plus de 2 kg');
    // Nom Ciqual long : coupé au dernier mot entier
    const long = run(`dietCutName('Pâtes sèches, sans gluten (à base de riz et maïs), cuites, sans sel ajouté, préemballées en barquette individuelle')`);
    assert.ok(long.length <= 80 && !/[\s,]$/.test(long) && long.startsWith('Pâtes sèches'), long);
    assert.equal(run(`dietFamOf({ k: 400, p: 80, c: 5, f: 5 })`), 'v', 'protéines (whey) : source de protéines');
    assert.equal(run(`dietFamOf({ k: 900, p: 0, c: 0, f: 100 })`), 'g');
  });

  test('plan : 8 repas, 25 aliments, objectifs et consigne bornés ; sanitizeData', () => {
    reset();
    const meal = i => ({ id: 'm' + i, name: 'Repas ' + i, items: Array.from({ length: 30 }, (_, j) => ({ id: `i${i}_${j}`, name: 'Riz', g: 100, per: { k: 155, p: 3, c: 33, f: 1 } })) });
    run(`data.dietPlans = { d_ok: ${JSON.stringify({ name: 'A'.repeat(60), meals: Array.from({ length: 12 }, (_, i) => meal(i)), targets: { kcal: 2500, p: '160', c: 0, f: 99999 }, consigne: '  Bois 2 L  ' })},
      'bad key!': { name: 'X', meals: [] }, d_arr: [], d_arch: { name: 'Vieux', archived: true, meals: [] } };
      data.dietActive = 'd_arch'; data.dietFoods = [{ name: 'Skyr', per: { k: 63, p: 11, c: 4, f: 0.2 } }, { name: 'skyr', per: { k: 1, p: 0, c: 0, f: 0 } }, 'x'];
      sanitizeData(data);`);
    const p = run('data.dietPlans.d_ok');
    assert.equal(p.name.length, 40);
    assert.equal(p.meals.length, 8, '8 repas au plus');
    assert.ok(p.meals.every(m => m.items.length === 25), '25 aliments au plus par repas');
    sameJSON(p.targets, { kcal: 2500, p: 160 }, 'objectifs hors bornes retirés');
    assert.equal(p.consigne, 'Bois 2 L');
    sameJSON(run('Object.keys(data.dietPlans).sort()'), ['d_arch', 'd_ok'], 'clés invalides retirées, archivé gardé');
    assert.equal(run('data.dietActive'), undefined, 'plan suivi archivé : plus suivi');
    assert.equal(run('data.dietFoods.length'), 1, 'aliments perso : doublon de nom et ligne illisible retirés');
    // Clés de nutrition classées pour la synchro (le journal reste sur l'appareil)
    assert.ok(run(`['dietPlans', 'dietActive', 'dietFoods'].every(k => SYNC_PROFILE_KEYS.includes(k))`));
    assert.ok(run(`SYNC_LOCAL_ONLY.includes('dietLog') && !SYNC_PROFILE_KEYS.includes('dietLog')`));
    // Sans nutrition : aucune clé ajoutée (profil et empreintes inchangés pour tous les autres)
    reset();
    run('sanitizeData(data)');
    assert.ok(run(`!('dietPlans' in data) && !('dietLog' in data) && !('dietActive' in data) && !('dietFoods' in data)`));
  });

  test('écart repas prévus / objectif du jour : signalé au-delà de 10 %, calories et protéines', () => {
    loadDb();
    const meals = [{ id: 'm1', name: 'Midi', items: [item(RIZ_CUIT, 150), item(POULET_GRILLE, 150)] }];
    const t = run(`dietPlanMacros(${JSON.stringify({ meals })})`);
    const k = Math.round(t.kcal), p = Math.round(t.p);
    const gap = targets => run(`dietTargetGap(${JSON.stringify({ name: 'P', meals, targets })})`);
    assert.equal(gap({ kcal: k + 600 }), `Les repas prévus font ${run('fmtNum(600)')} kcal de moins que l'objectif du jour.`);
    assert.equal(gap({ kcal: k - 100, p: p + 40 }), `Les repas prévus font 100 kcal de plus et 40 g de protéines de moins que l'objectif du jour.`);
    assert.equal(gap({ kcal: Math.round(k * 1.05), p }), '', 'à 10 % près : rien');
    assert.equal(gap(null), '', 'sans objectif : le total est le repère');
    assert.equal(run(`dietTargetGap({ name: 'P', meals: [{ id: 'm1', name: 'Midi', items: [] }], targets: { kcal: 2000 } })`), '', 'plan vide : rien');
  });

  test('macros : aliment, repas, plan ; repère = objectif fixé, sinon total du plan', () => {
    loadDb();
    const riz = item(RIZ_CUIT, 150);
    const m = run(`dietItemMacros(${JSON.stringify(riz)})`);
    assert.equal(Math.round(m.kcal), 233);
    assert.equal(Math.round(m.c * 10) / 10, 49.8);
    const plan = { name: 'P', meals: [{ id: 'm1', name: 'Midi', items: [riz, item(POULET_GRILLE, 150)] }], targets: { p: 180 } };
    const t = run(`dietPlanMacros(${JSON.stringify(plan)})`);
    const pm = run(`dietItemMacros(${JSON.stringify(item(POULET_GRILLE, 150))})`);
    assert.equal(t.kcal, m.kcal + pm.kcal, 'somme exacte, arrondie seulement à l\'affichage');
    assert.equal(Math.round(pm.p * 10) / 10, 45.2);
    const g = run(`dietGoal(${JSON.stringify(plan)})`);
    assert.equal(g.goal.p, 180, 'protéines : objectif fixé');
    assert.equal(g.goal.kcal, Math.round(t.kcal), 'calories : total du plan');
    sameJSON(g.own, { kcal: false, p: true, c: false, f: false });
  });

  test('journée : cocher, décocher, repas suivant, journée complète, série, frise', () => {
    reset();
    loadDb();
    const NOW = new Date(2026, 10, 5, 21, 30).getTime();   // jeudi 5 novembre 2026, 21 h 30
    const plan = { name: 'Sèche', meals: [
      { id: 'm1', name: 'Petit-déjeuner', items: [item(RIZ_CUIT, 100)] },
      { id: 'm2', name: 'Déjeuner', items: [item(POULET_GRILLE, 150)] }] };
    run(`data.dietPlans = { d_a: ${JSON.stringify(plan)} }; data.dietActive = 'd_a';`);
    const day = run(`dietDayKey(${NOW})`);
    assert.equal(day, '2026-11-05', 'jour du calendrier local');
    let pr = run(`dietDayProgress(data, 'd_a', '${day}')`);
    assert.equal(pr.next.meal.id, 'm1');
    assert.equal(pr.eaten.kcal, 0);
    assert.equal(run(`dietToggleMeal(data, 'd_a', 'm1', '${day}')`), true);
    pr = run(`dietDayProgress(data, 'd_a', '${day}')`);
    assert.equal(Math.round(pr.eaten.kcal), 155, 'repas coché compté');
    assert.equal(pr.next.meal.id, 'm2', 'le suivant passe devant');
    assert.equal(pr.complete, false);
    run(`dietToggleMeal(data, 'd_a', 'm2', '${day}')`);
    assert.equal(run(`dietDayProgress(data, 'd_a', '${day}').complete`), true);
    // Décocher puis tout décocher : la journée sort du journal
    run(`dietToggleMeal(data, 'd_a', 'm2', '${day}'); dietToggleMeal(data, 'd_a', 'm1', '${day}')`);
    assert.equal(run('data.dietLog'), undefined, 'journal vide retiré');
    // Série : 3 jours complets avant aujourd'hui (pas encore fini) ; un trou l'arrête
    const key = i => run(`dietDayKey(new Date(2026, 10, ${5 - i}, 12).getTime())`);
    for (const i of [1, 2, 3, 5]) run(`dietToggleMeal(data, 'd_a', 'm1', '${key(i)}'); dietToggleMeal(data, 'd_a', 'm2', '${key(i)}')`);
    assert.equal(run(`dietStreak(data, ${NOW})`), 3, 'aujourd\'hui pas fini : la série court jusqu\'à hier');
    run(`dietToggleMeal(data, 'd_a', 'm1', '${day}'); dietToggleMeal(data, 'd_a', 'm2', '${day}')`);
    assert.equal(run(`dietStreak(data, ${NOW})`), 4, 'aujourd\'hui complet : compté');
    const week = run(`dietWeek(data, ${NOW})`);
    assert.equal(week.length, 7);
    assert.equal(week[6].day, day, 'aujourd\'hui en dernier');
    sameJSON(week.map(w => w.complete), [false, true, false, true, true, true, true]);
    // Repas retiré du plan : sa coche est oubliée à la prochaine écriture
    run(`data.dietPlans.d_a.meals = data.dietPlans.d_a.meals.filter(m => m.id !== 'm2'); dietToggleMeal(data, 'd_a', 'm1', '${day}'); dietToggleMeal(data, 'd_a', 'm1', '${day}')`);
    sameJSON(run(`data.dietLog['${day}'].done`), ['m1']);
    // Journal : 120 jours au plus, jours mal formés retirés
    run(`data.dietLog['2020-01-01'] = { plan: 'd_a', done: ['m1'] }; data.dietLog['nope'] = { plan: 'd_a', done: ['m1'] }; sanitizeDiet(data, ${NOW})`);
    assert.ok(run(`!('2020-01-01' in data.dietLog) && !('nope' in data.dietLog) && '${day}' in data.dietLog`));
  });

  test('journée : repas vide du plan (collation libre) : un ajout est mangé tout de suite, sans changer « Journée complète »', () => {
    reset();
    loadDb();
    const plan = { name: 'Sèche', meals: [
      { id: 'm1', name: 'Dîner', items: [item(RIZ_CUIT, 100)] },
      { id: 'm2', name: 'Collation', items: [] }] };
    run(`data.dietPlans = { d_a: ${JSON.stringify(plan)} }; data.dietActive = 'd_a';`);
    const day = '2026-11-05', huile = item(HUILE_OLIVE, 10);
    run(`dietToggleMeal(data, 'd_a', 'm1', '${day}')`);
    const before = run(`dietDayProgress(data, 'd_a', '${day}')`);
    assert.equal(before.complete, true);
    assert.ok(run(`dietAddExtra(data, 'd_a', 'm2', ${JSON.stringify(huile)}, '${day}')`), 'ajout accepté sur un repas vide');
    const pr = run(`dietDayProgress(data, 'd_a', '${day}')`);
    const k = run(`dietItemMacros(${JSON.stringify(huile)}).kcal`);
    assert.ok(Math.abs(pr.eaten.kcal - (before.eaten.kcal + k)) < 1e-9, 'compté dans le mangé sans coche');
    assert.equal(pr.complete, true, 'journée toujours complète');
    assert.equal(pr.nMeals, 1, 'le repas vide ne devient pas un repas à cocher');
  });

  test('journée : ajouter un aliment à un repas déjà coché (journée complète), modifier, retirer, décocher', () => {
    reset();
    loadDb();
    const plan = { name: 'Sèche', meals: [
      { id: 'm1', name: 'Dîner', items: [item(RIZ_CUIT, 100)] },
      { id: 'm2', name: 'Collation', items: [item(POULET_GRILLE, 150)] }] };
    run(`data.dietPlans = { d_a: ${JSON.stringify(plan)} }; data.dietActive = 'd_a';`);
    const day = '2026-11-05', huile = item(HUILE_OLIVE, 10);
    run(`dietToggleMeal(data, 'd_a', 'm1', '${day}'); dietToggleMeal(data, 'd_a', 'm2', '${day}')`);
    let pr = run(`dietDayProgress(data, 'd_a', '${day}')`);
    const eaten0 = pr.eaten.kcal, goal0 = pr.goal.kcal, planned0 = pr.planned.kcal;
    assert.equal(pr.complete, true);
    const added = run(`dietAddExtra(data, 'd_a', 'm1', ${JSON.stringify(huile)}, '${day}')`);
    assert.ok(added && added.id && added.id !== huile.id, 'ajouté avec un id neuf');
    pr = run(`dietDayProgress(data, 'd_a', '${day}')`);
    const k = run(`dietItemMacros(${JSON.stringify(huile)}).kcal`);
    assert.equal(pr.complete, true, 'le repas reste coché, la journée complète');
    assert.ok(Math.abs(pr.eaten.kcal - (eaten0 + k)) < 1e-9, 'compté dans le mangé');
    assert.ok(Math.abs(pr.meals[0].macros.kcal - (pr.meals[0].base.kcal + k)) < 1e-9, 'total du repas');
    assert.equal(pr.planned.kcal, planned0, 'le prévu ne change pas');
    assert.equal(pr.goal.kcal, goal0, 'le repère ne change pas');
    assert.equal(pr.meals[0].extras.length, 1);
    assert.equal(run('data.dietPlans.d_a.meals[0].items.length'), 1, 'le plan ne change pas');
    // Gardé par le nettoyage (relance de l'app), même forme
    run(`sanitizeDiet(data, ${new Date(2026, 10, 5, 21).getTime()})`);
    assert.equal(run(`data.dietLog['${day}'].extras.m1[0].g`), 10, 'ajout gardé au nettoyage');
    // Quantité changée, puis retiré
    assert.equal(run(`dietSetExtra(data, 'd_a', 'm1', '${added.id}', 30, '${day}')`), true);
    assert.equal(run(`data.dietLog['${day}'].extras.m1[0].g`), 30);
    assert.equal(run(`dietSetExtra(data, 'd_a', 'm1', '${added.id}', 0, '${day}')`), false, '0 g refusé');
    assert.equal(run(`dietSetExtra(data, 'd_a', 'm1', '${added.id}', null, '${day}')`), true);
    assert.equal(run(`data.dietLog['${day}'].extras`), undefined, 'plus d\'ajout : clé retirée');
    // Ajout sur un repas pas coché : compté une fois coché seulement ; seul l'ajout garde le jour au journal
    run(`dietToggleMeal(data, 'd_a', 'm1', '${day}'); dietToggleMeal(data, 'd_a', 'm2', '${day}')`);
    assert.equal(run('data.dietLog'), undefined, 'tout décoché : journée retirée');
    run(`dietAddExtra(data, 'd_a', 'm2', ${JSON.stringify(huile)}, '${day}')`);
    assert.equal(run(`dietDayProgress(data, 'd_a', '${day}').eaten.kcal`), 0, 'repas pas coché : rien de mangé');
    assert.equal(run(`data.dietLog['${day}'].extras.m2.length`), 1, 'ajout seul gardé');
    // Repas inconnu, aliment illisible, repas plein : refusés ; ajouts du journal bornés au nettoyage
    assert.equal(run(`dietAddExtra(data, 'd_a', 'zz', ${JSON.stringify(huile)}, '${day}')`), null);
    assert.equal(run(`dietAddExtra(data, 'd_a', 'm1', { name: '', g: 5 }, '${day}')`), null);
    run(`data.dietLog['${day}'].extras.m2 = Array.from({ length: 30 }, (_, i) => ({ ...${JSON.stringify(huile)}, id: 'x' + i })); data.dietLog['${day}'].extras.__proto__x = 1; sanitizeDiet(data, ${new Date(2026, 10, 5, 21).getTime()})`);
    assert.equal(run(`data.dietLog['${day}'].extras.m2.length`), 25, '25 ajouts au plus par repas');
    assert.equal(run(`dietAddExtra(data, 'd_a', 'm2', ${JSON.stringify(huile)}, '${day}')`), null, 'repas plein');
    // Repas retiré du plan : ses ajouts sont oubliés à la prochaine écriture
    run(`data.dietPlans.d_a.meals = data.dietPlans.d_a.meals.filter(m => m.id !== 'm2'); dietToggleMeal(data, 'd_a', 'm1', '${day}')`);
    assert.equal(run(`data.dietLog['${day}'].extras`), undefined);
  });

  test('équivalences : même famille, calories ou protéines gardées, macros proches, quantité pesable', () => {
    loadDb();
    // Féculent : mêmes calories, à 15 % près ; chaque macro à 25 % (5 g au moins)
    const riz = item(RIZ_CUIT, 150), ref = run(`dietItemMacros(${JSON.stringify(riz)})`);
    assert.equal(run(`swapRuleText(${JSON.stringify(riz)})`), 'Mêmes calories');
    const c1 = run(`swapCandidates(${JSON.stringify(riz)})`);
    assert.ok(c1.length >= 5 && c1.length <= 10, `${c1.length} remplaçants`);
    for (const c of c1) {
      assert.equal(c.food.fam, 'f', `${c.food.name} : même famille`);
      assert.ok(Math.abs(c.macros.kcal - ref.kcal) <= Math.max(30, 0.15 * ref.kcal), `${c.food.name} : calories proches`);
      for (const k of ['p', 'c', 'f']) assert.ok(Math.abs(c.macros[k] - ref[k]) <= Math.max(5, 0.25 * ref[k]) + 1e-9, `${c.food.name} : ${k} proche`);
      assert.ok(c.g >= 50 ? c.g % 5 === 0 : Number.isInteger(c.g), `${c.food.name} : ${c.g} g, arrondi pesable`);
      assert.ok(c.g >= 150 / 4 && c.g <= 150 * 4);
      assert.notEqual(c.food.code, RIZ_CUIT, 'jamais lui-même');
    }
    assert.ok(c1.slice(0, 3).some(c => /^Riz .*cuit/.test(c.food.name)), 'un autre riz cuit parmi les premiers');
    assert.ok(c1.filter(c => c.food.key.startsWith('riz ')).length <= 2, 'variété : deux riz au plus');
    // Source de protéines : mêmes protéines, gras proche (le saumon, bien plus gras, n'est pas proposé)
    const poulet = item(POULET_GRILLE, 150), pRef = run(`dietItemMacros(${JSON.stringify(poulet)})`);
    assert.equal(run(`swapRuleText(${JSON.stringify(poulet)})`), 'Même quantité de protéines');
    const c2 = run(`swapCandidates(${JSON.stringify(poulet)})`);
    assert.ok(c2.length >= 5);
    for (const c of c2) {
      assert.equal(c.food.fam, 'v');
      assert.ok(Math.abs(c.macros.p - pRef.p) <= 2.6, `${c.food.name} : protéines gardées (${c.macros.p.toFixed(1)} / ${pRef.p.toFixed(1)})`);
      assert.ok(!/saumon|rillettes|charcuterie/i.test(c.food.name), `${c.food.name} : trop gras pour remplacer un filet de poulet`);
    }
    assert.ok(c2.slice(0, 4).some(c => /^(Dinde|Boeuf|Veau)/.test(c.food.name)), 'viandes maigres courantes en tête');
    // Cuit contre cru : la viande crue arrive après (pénalité) pour un œuf dur
    const c3 = run(`swapCandidates(${JSON.stringify(item(OEUF_DUR, 100))})`);
    assert.ok(c3.length && !/\bcru/.test(c3[0].food.key), c3.map(c => c.food.name).slice(0, 3).join(' | '));
    assert.ok(!c3.slice(0, 5).some(c => /queue|pied|gesier/.test(c.food.key)), 'abats après les autres');
    // Matière grasse et aide culinaire
    assert.ok(run(`swapCandidates(${JSON.stringify(item(HUILE_OLIVE, 10))})`).every(c => c.food.fam === 'g'));
    assert.equal(run(`swapCandidates({ name: 'Sel', fam: 'a', g: 5, per: { k: 0, p: 0, c: 0, f: 0 } }).length`), 0, 'aide culinaire : aucun');
    // Aliment perso (pas de code Ciqual) : famille tirée de ses macros, remplaçants dans la base
    const whey = run(`cleanDietItem({ name: 'Whey', g: 30, per: { k: 380, p: 78, c: 6, f: 5 } })`);
    assert.equal(whey.fam, 'v');
    assert.ok(run(`swapCandidates(${JSON.stringify(whey)})`).every(c => c.food.fam === 'v'));
    // Texte de l'écart
    assert.equal(run(`swapDeltaText(12.4, 'kcal')`), '+12 kcal');
    assert.equal(run(`swapDeltaText(-3.6, 'kcal')`), '−4 kcal');
    assert.equal(run(`swapDeltaText(0.3, 'kcal')`), '=');
    assert.equal(run(`swapRoundG(47.4)`), 47);
    assert.equal(run(`swapRoundG(162)`), 160);
    assert.equal(run(`foodState('Pâtes sèches, standard, cuites, sans sel ajouté')`), 'cuit');
    assert.equal(run(`foodState('Polenta ou semoule de maïs, précuite, à cuire')`), 'cru');
  });

  test('premier plan créé : suivi d\'office, sauf pour un coach (plans préparés pour ses élèves)', () => {
    reset();
    const id = run(`dietNewPlan(data, 'Ma prise de masse')`);
    assert.equal(run('data.dietActive'), id, 'pratiquant : le premier plan est suivi');
    const id2 = run(`dietNewPlan(data, 'Autre')`);
    assert.equal(run('data.dietActive'), id, 'un plan déjà suivi reste suivi');
    assert.ok(id2 !== id);
    reset();
    const c = run(`dietNewPlan(data, 'Sèche Léa', { isCoach: true })`);
    assert.equal(run('data.dietActive'), undefined, 'coach : le plan de l\'élève n\'est pas suivi');
    assert.equal(run(`dietActivePlan(data)`), null, 'rien sur l\'accueil du coach');
    assert.ok(run(`!!data.dietPlans['${c}']`));
  });

  test('plan neuf, repas vides : ni comptés, ni proposés comme prochain repas ; repère = prévu du jour, remplacements compris', () => {
    reset();
    loadDb();
    const riz = { ...item(RIZ_CUIT, 150), id: 'it1' };
    run(`data.dietPlans = { d_a: { name: 'Ma prise de masse', meals: [{ id: 'm1', name: 'Petit-déjeuner', items: [${JSON.stringify(riz)}] },
      { id: 'm2', name: 'Déjeuner', items: [] }, { id: 'm3', name: 'Collation', items: [] }, { id: 'm4', name: 'Dîner', items: [] }] } }; data.dietActive = 'd_a';`);
    let pr = run(`dietDayProgress(data, 'd_a', '2026-11-04')`);
    assert.equal(pr.nMeals, 1, 'un seul repas à cocher');
    assert.equal(pr.next.meal.id, 'm1');
    run(`dietToggleMeal(data, 'd_a', 'm1', '2026-11-04')`);
    pr = run(`dietDayProgress(data, 'd_a', '2026-11-04')`);
    assert.equal(pr.next, null, 'jamais « Déjeuner · 0 kcal »');
    assert.equal(pr.complete, true, 'journée complète, comme la frise');
    assert.equal(run(`dietDayComplete(data, '2026-11-04')`), true);
    // Équivalent choisi (quelques kcal de plus) : le repère suit le prévu du jour, jamais « 217 sur 215 »
    const c = run(`swapCandidates(data.dietPlans.d_a.meals[0].items[0]).find(x => Math.round(x.macros.kcal) !== Math.round(${155 * 1.5}))`);
    run(`dietSetSwap(data, 'd_a', 'it1', { name: ${JSON.stringify(c.food.name)}, food: ${c.food.code}, fam: 'f', g: ${c.g}, per: ${JSON.stringify(c.food.per)} }, '2026-11-04')`);
    pr = run(`dietDayProgress(data, 'd_a', '2026-11-04')`);
    assert.equal(pr.goal.kcal, Math.round(pr.eaten.kcal), `repère ${pr.goal.kcal} = mangé ${Math.round(pr.eaten.kcal)}`);
    assert.equal(pr.goal.p, Math.round(pr.planned.p));
    // Objectif fixé : gardé tel quel, remplacement ou pas
    run(`data.dietPlans.d_a.targets = { kcal: 2000 }`);
    pr = run(`dietDayProgress(data, 'd_a', '2026-11-04')`);
    assert.equal(pr.goal.kcal, 2000);
    assert.equal(pr.goal.c, Math.round(pr.planned.c), 'les autres repères suivent le prévu du jour');
  });

  test('changement de plan dans la journée : la frise et la série d\'aujourd\'hui suivent le plan suivi', () => {
    reset();
    const NOW = new Date(2026, 10, 4, 18, 30).getTime();   // mercredi 4 novembre 2026
    const it = id => ({ id, name: 'Riz', g: 100, per: { k: 155, p: 3, c: 33, f: 1 } });
    run(`data.dietPlans = { d_a: { name: 'Mon plan', meals: [{ id: 'm1', name: 'A', items: [${JSON.stringify(it('i1'))}] }, { id: 'm2', name: 'B', items: [] }] },
      dc_x_1: { name: 'Sèche Léa', meals: [{ id: 'c1', name: 'A', items: [${JSON.stringify(it('j1'))}] }, { id: 'c2', name: 'B', items: [${JSON.stringify(it('j2'))}] }] } };
      data.dietActive = 'd_a'; dietToggleMeal(data, 'd_a', 'm1', '2026-11-04'); dietToggleMeal(data, 'd_a', 'm1', '2026-11-03');`);
    let week = run(`dietWeek(data, ${NOW})`);
    assert.equal(week[6].complete, true, 'ancien plan : aujourd\'hui complet');
    assert.equal(run(`dietStreak(data, ${NOW})`), 2);
    // Plan du coach suivi : 0 repas coché à l'écran, donc aujourd'hui ni coché ni « en partie » dans la frise
    run(`data.dietActive = 'dc_x_1'`);
    week = run(`dietWeek(data, ${NOW})`);
    assert.equal(week[6].complete, false, 'pas de coche verte pour l\'ancien plan');
    assert.equal(week[6].some, false);
    assert.equal(run(`dietDayProgress(data, 'dc_x_1', '2026-11-04').nDone`), 0);
    assert.equal(week[5].complete, true, 'hier : jugé avec le plan de ce jour-là');
    assert.equal(run(`dietStreak(data, ${NOW})`), 1, 'la série court jusqu\'à hier');
    run(`dietToggleMeal(data, 'dc_x_1', 'c1', '2026-11-04')`);
    week = run(`dietWeek(data, ${NOW})`);
    assert.ok(!week[6].complete && week[6].some, 'nouveau plan : en partie');
  });

  test('remplacement du jour : gardé pour ce jour seulement, compté dans les macros, remis', () => {
    reset();
    loadDb();
    const riz = { ...item(RIZ_CUIT, 150), id: 'it1' };
    run(`data.dietPlans = { d_a: { name: 'P', meals: [{ id: 'm1', name: 'Midi', items: [${JSON.stringify(riz)}] }] } }; data.dietActive = 'd_a';`);
    const c = run(`swapCandidates(data.dietPlans.d_a.meals[0].items[0])[0]`);
    run(`dietSetSwap(data, 'd_a', 'it1', { name: ${JSON.stringify(c.food.name)}, food: ${c.food.code}, fam: 'f', g: ${c.g}, per: ${JSON.stringify(c.food.per)} }, '2026-11-05')`);
    const pr = run(`dietDayProgress(data, 'd_a', '2026-11-05')`);
    assert.equal(pr.swaps.it1.name, c.food.name);
    assert.equal(Math.round(pr.planned.kcal), Math.round(c.macros.kcal), 'macros du remplaçant');
    assert.equal(run(`Object.keys(dietDayProgress(data, 'd_a', '2026-11-06').swaps).length`), 0, 'le lendemain : plan normal');
    assert.equal(run('data.dietPlans.d_a.meals[0].items[0].food'), RIZ_CUIT, 'le plan ne change pas');
    run(`dietSetSwap(data, 'd_a', 'it1', null, '2026-11-05')`);
    assert.equal(run('data.dietLog'), undefined, 'remis : rien de gardé');
  });

  test('jour affiché : aujourd\'hui par défaut, jour passé seulement pendant la consultation (retour du 10/11)', () => {
    reset();
    const now = new Date(2026, 10, 10, 8, 30).getTime(), week = JSON.stringify(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
    assert.equal(run(`dietPickedDay(null, '2026-11-09', ${week}, ${now})`), '2026-11-10', 'route d\'hier restaurée sans choix : aujourd\'hui');
    const pick = `{ day: '2026-11-09', today: '2026-11-10', at: ${now} }`;
    assert.equal(run(`dietPickedDay(${pick}, '2026-11-09', ${week}, ${now})`), '2026-11-09', 'hier choisi dans la frise : hier');
    assert.equal(run(`dietPickedDay(${pick}, '2026-11-08', ${week}, ${now})`), '2026-11-10', 'autre jour que celui choisi : aujourd\'hui');
    const late = `{ day: '2026-11-09', today: '2026-11-09', at: ${now - 9 * 3600000} }`;
    assert.equal(run(`dietPickedDay(${late}, '2026-11-09', ${week}, ${now})`), '2026-11-10', 'ouvert sur hier à 00 h 11… choisi la veille : aujourd\'hui');
    assert.equal(run(`dietPickedDay(${pick}, '2026-10-01', ${week}, ${now})`), '2026-11-10', 'hors frise : aujourd\'hui');
    assert.equal(run(`dietPickStale(${pick}, ${now + 60000})`), false, 'retour après 1 min : gardé');
    assert.equal(run(`dietPickStale(${pick}, ${now + 6 * 60000})`), true, 'retour après 6 min : aujourd\'hui');
    assert.equal(run(`dietPickStale({ day: '2026-11-08', today: '2026-11-09', at: ${new Date(2026, 10, 9, 23, 59).getTime()} }, ${new Date(2026, 10, 10, 0, 1).getTime()})`), true, 'minuit passé : aujourd\'hui');
    assert.equal(run(`dietPickStale(null, ${now})`), false);
  });

  test('aliment du plan : retiré pour aujourd\'hui, remis, quantité changée ; le plan ne change pas', () => {
    reset();
    loadDb();
    const riz = { ...item(RIZ_CUIT, 150), id: 'it1' }, poulet = { ...item(POULET_GRILLE, 100), id: 'it2' };
    run(`data.dietPlans = { d_a: { name: 'P', meals: [{ id: 'm1', name: 'Midi', items: [${JSON.stringify(riz)}, ${JSON.stringify(poulet)}] }] } }; data.dietActive = 'd_a';`);
    const D = '2026-11-05', full = run(`dietDayProgress(data, 'd_a', '${D}')`);
    const kRiz = run(`dietItemMacros(data.dietPlans.d_a.meals[0].items[0]).kcal`), kPoulet = run(`dietItemMacros(data.dietPlans.d_a.meals[0].items[1]).kcal`);
    run(`dietToggleMeal(data, 'd_a', 'm1', '${D}')`);
    assert.equal(run(`dietSetRemoved(data, 'd_a', 'it1', true, '${D}')`), true);
    let pr = run(`dietDayProgress(data, 'd_a', '${D}')`);
    sameJSON(pr.removed, ['it1']);
    assert.equal(Math.round(pr.eaten.kcal), Math.round(kPoulet), 'mangé : sans le riz retiré');
    assert.equal(Math.round(pr.meals[0].macros.kcal), Math.round(kPoulet), 'repas : recalculé');
    assert.equal(pr.goal.kcal, full.goal.kcal, 'repère : le plan, pas baissé');
    assert.equal(Math.round(pr.planned.kcal), Math.round(kRiz + kPoulet));
    assert.equal(run(`dietDayProgress(data, 'd_a', '2026-11-06').removed.length`), 0, 'le lendemain : plan normal');
    // Journal relu (synchro, rechargement) : gardé ; id illisible ou en double écarté
    run(`data.dietLog['${D}'].removed.push('it1', '<x>', 3); sanitizeDiet(data, ${new Date(2026, 10, 5, 12).getTime()})`);
    sameJSON(run(`data.dietLog['${D}'].removed`), ['it1']);
    // Ancien client : lit le journal sans removed, l'aliment y est simplement compté
    assert.equal(run(`dietMealMacros(data.dietPlans.d_a.meals[0], {}).kcal`), kRiz + kPoulet);
    // Remis : rien d'autre que la coche
    run(`dietSetRemoved(data, 'd_a', 'it1', false, '${D}')`);
    assert.equal(run(`'removed' in data.dietLog['${D}']`), false);
    assert.equal(Math.round(run(`dietDayProgress(data, 'd_a', '${D}').eaten.kcal`)), Math.round(kRiz + kPoulet));
    // Seul aliment retiré, rien coché : gardé ; remis : journal vide
    run(`dietToggleMeal(data, 'd_a', 'm1', '${D}'); dietSetRemoved(data, 'd_a', 'it2', true, '${D}')`);
    sameJSON(run(`data.dietLog['${D}'].removed`), ['it2']);
    run(`dietSetRemoved(data, 'd_a', 'it2', false, '${D}')`);
    assert.equal(run('data.dietLog'), undefined, 'remis : rien de gardé');
    // Quantité changée : même aliment, autres grammes, comptée ; repère inchangé ; quantité prévue : plan remis
    assert.equal(run(`dietSetPlanQty(data, 'd_a', 'it1', { g: 300, por: null }, '${D}')`), true);
    pr = run(`dietDayProgress(data, 'd_a', '${D}')`);
    assert.equal(pr.swaps.it1.g, 300);
    assert.equal(pr.swaps.it1.name, riz.name);
    assert.ok(run(`dietIsQtyChange(data.dietPlans.d_a.meals[0].items[0], dietDayProgress(data, 'd_a', '${D}').swaps.it1)`));
    assert.equal(Math.round(pr.meals[0].macros.kcal), Math.round(kRiz * 2 + kPoulet), 'repas : riz doublé');
    assert.equal(pr.goal.kcal, full.goal.kcal, 'repère : la quantité prévue');
    assert.equal(run('data.dietPlans.d_a.meals[0].items[0].g'), 150, 'le plan ne change pas');
    run(`dietSetPlanQty(data, 'd_a', 'it1', { g: 150, por: null }, '${D}')`);
    assert.equal(run('data.dietLog'), undefined, 'quantité prévue : plan remis');
    // Remplaçant puis quantité : garde le remplaçant
    const c = run(`swapCandidates(data.dietPlans.d_a.meals[0].items[0])[0]`);
    run(`dietSetSwap(data, 'd_a', 'it1', { name: ${JSON.stringify(c.food.name)}, food: ${c.food.code}, fam: 'f', g: ${c.g}, per: ${JSON.stringify(c.food.per)} }, '${D}')`);
    run(`dietSetPlanQty(data, 'd_a', 'it1', { g: 80, por: null }, '${D}')`);
    pr = run(`dietDayProgress(data, 'd_a', '${D}')`);
    assert.ok(pr.swaps.it1.name === c.food.name && pr.swaps.it1.g === 80, 'remplaçant à 80 g');
  });

  test('coach : plan envoyé par le canal des programmes, ignoré par une ancienne app, pris et mis à jour', () => {
    reset();
    loadDb();
    run(`data.dietPlans = { d_k7m2qx9p: { name: 'Sèche Léa', consigne: 'Bois 2 L par jour', targets: { kcal: 1900 },
      meals: [{ id: 'm1', name: 'Petit-déjeuner', note: 'Avant 9 h', items: [${JSON.stringify({ ...item(RIZ_CUIT, 80), id: 'i1' })}] }, { id: 'm2', name: 'Dîner', items: [] }] } };`);
    const sent = run(`dietToSent(data.dietPlans.d_k7m2qx9p)`);
    assert.equal(sent.kind, 'diet');
    assert.equal(sent.name, undefined, 'aucun nom au premier niveau');
    assert.equal(run(`cleanSentProgramme(${JSON.stringify(sent)})`), null, 'une app d\'avant la nutrition l\'écarte');
    const sid = run(`dietSentId('d_k7m2qx9p')`);
    assert.equal(sid, 'diet_k7m2qx9p');
    assert.ok(run(`COACH_PROG_ID_RE.test('${sid}')`), 'identifiant accepté par le canal des programmes');
    assert.ok(run(`sentProgrammeBytes(${JSON.stringify(sent)})`) < 200 * 1024);
    // Boîte de l'élève : le plan n'est jamais pris pour un programme
    const prog = { name: 'Force', sessions: [{ key: 's1', label: 'Haut', color: '#FF9500', exercises: [{ name: 'Pompes', sets: 3 }] }] };
    const inbox = run(`cleanInbox({ programmes: [{ id: '${sid}', data: ${JSON.stringify(sent)}, sent_at: '2026-11-05T10:00:00Z', seen: false },
      { id: 'u_abc', data: ${JSON.stringify(prog)}, sent_at: '2026-11-04T10:00:00Z', seen: true }, { id: 'diet_bad', data: { kind: 'diet', diet: { name: 'Vide', meals: [] } } }], notes: [] })`);
    sameJSON(inbox.programmes.map(p => p.id), ['u_abc']);
    sameJSON(inbox.diets.map(p => p.id), [sid], 'plan sans repas écarté');
    assert.equal(inbox.diets[0].data.meals[0].note, 'Avant 9 h');
    // Boîte gardée sur l'appareil : le plan à part (une version précédente ne le lit pas comme un programme)
    const cached = { programmes: [], diets: [{ id: sid, data: { kind: 'diet', name: 'Sèche Léa' }, sent_at: 1, seen: false, meta: true }], notes: [] };
    const back = run(`cleanInbox(${JSON.stringify(cached)})`);
    sameJSON([back.programmes.length, back.diets[0].meta, back.diets[0].data.name], [0, true, 'Sèche Léa']);
    // Élève : pris, suivi, coches gardées à la mise à jour (identifiants des repas gardés)
    reset();
    const coachP = { user_id: 'a1b2c3d4-0000-4000-8000-000000000001', username: 'max' };
    const it = inbox.diets[0];
    assert.equal(run(`dietReceivedStatus(data, ${JSON.stringify(it)}, '${coachP.user_id}').status`), 'new');
    const id = run(`importCoachDiet(data, ${JSON.stringify(it)}, ${JSON.stringify(coachP)})`);
    assert.equal(id, 'dc_a1b2c3d4_k7m2qx9p');
    assert.equal(run('data.dietActive'), id, 'plan suivi');
    assert.equal(run(`data.dietPlans['${id}'].fromCoach.name`), 'max');
    assert.equal(run(`dietReceivedStatus(data, ${JSON.stringify(it)}, '${coachP.user_id}').status`), 'current');
    run(`dietToggleMeal(data, '${id}', 'm1', '2026-11-05')`);
    const newer = { ...it, sentAt: it.sentAt + 1000, data: { ...it.data, name: 'Sèche Léa v2' } };
    assert.equal(run(`dietReceivedStatus(data, ${JSON.stringify(newer)}, '${coachP.user_id}').status`), 'update');
    run(`importCoachDiet(data, ${JSON.stringify(newer)}, ${JSON.stringify(coachP)}); sanitizeData(data)`);
    assert.equal(run(`data.dietPlans['${id}'].name`), 'Sèche Léa v2');
    sameJSON(run(`dietDayProgress(data, '${id}', '2026-11-05').meals.map(m => m.done)`), [true, false], 'coche gardée');
    // Un autre coach avec le même plan : jamais écrasé
    assert.notEqual(run(`dietLocalId('${sid}', 'ffff0000-0000')`), id);
    // Coach : ses programmes envoyés ne listent pas les plans diète
    run(`coach.state = { students: [{ user_id: 's1', sent: [{ id: '${sid}', sentAt: 2, seen: false }, { id: 'u_abc', sentAt: 1, seen: true }] }] }`);
    sameJSON(run(`coachSentStatus('s1', []).map(x => x.progId)`), ['u_abc']);
    run(`data.dietPlans = { d_k7m2qx9p: { name: 'Sèche Léa', meals: [] } }`);
    sameJSON(run(`coachDietSentStatus('s1').map(x => [x.id, x.name, x.seen, x.gone])`), [[sid, 'Sèche Léa', false, false]]);
    // Plan supprimé de mes plans ensuite : le nom envoyé reste (gardé à l'envoi), « supprimé de tes plans » en complément
    run(`coachRecordSent('s1', '${sid}', 2, 'Sèche Léa')`);
    run(`data.dietPlans = {}`);
    sameJSON(run(`coachDietSentStatus('s1').map(x => [x.name, x.gone])`), [['Sèche Léa', true]]);
    run(`localStorage.removeItem(COACH_SENT_KEY)`);
    sameJSON(run(`coachDietSentStatus('s1').map(x => [x.name, x.gone])`), [['Plan de nutrition', true]], 'nom inconnu : « Plan de nutrition », jamais « Plan supprimé »');
    run('coach.state = null');
  });

  test('coach : envoi refusé sans aliment, plan reçu jamais renvoyé ; notification « plan diète »', async () => {
    reset();
    run(`data.dietPlans = { d_vide: { name: 'Vide', meals: [{ id: 'm1', name: 'Midi', items: [] }] },
      dc_x_y: { name: 'Reçu', meals: [{ id: 'm1', name: 'Midi', items: [{ id: 'i', name: 'Riz', g: 100, per: { k: 155, p: 3, c: 33, f: 1 } }] }], fromCoach: { coachId: 'c', name: 'max', sentAt: 1 } } }`);
    sameJSON(await run(`coachSendDiet('s1', 'd_vide')`), { ok: false, kind: 'empty_diet' });
    sameJSON(run('coachSendableDiets()'), [], 'ni plan vide ni plan reçu');
    assert.ok(run(`coachErrorText('empty_diet')`).includes('aliment'));
    const { pushMessage } = await import(path.join(ROOT, 'supabase/functions/push-send/push-policy.js'));
    const row = { wanted: true, token: 'a'.repeat(64), kind: 'coach_programme', actor_name: 'max' };
    assert.equal(pushMessage({ ...row, ref: 'diet_k7m2qx9p' }).body, 'max t’a envoyé un plan de nutrition');
    assert.equal(pushMessage({ ...row, ref: 'u_abc' }).body, 'max t’a envoyé un programme');
    sameJSON(run(`pushTarget({ kind: 'coach_programme', ref: 'diet_k7m2qx9p' }, [])`), { tab: 'train', screen: 'nutrition', params: [] });
  });

  test('nutrition : fichiers listés (index.html, sw.js), aucune couleur en dur hors des tokens', () => {
    const html = read('index.html'), sw = read('sw.js');
    for (const f of ['js/data/nutrition.js', 'js/data/food-swap.js', 'js/data/food-scan.js', 'js/data/coach-diet.js', 'js/features/nutrition-ui.js', 'js/features/diet-editor.js', 'js/features/diet-settings.js', 'js/features/food-scan-ui.js', 'css/nutrition.css']) {
      assert.ok(html.includes(f), `index.html : ${f}`);
      assert.ok(sw.includes(`'/${f}'`), `sw.js : ${f}`);
    }
    assert.ok(sw.includes("'/data/foods.json'"), 'sw.js : base d\'aliments en cache hors ligne');
    assert.ok(html.indexOf('js/data/nutrition.js') < html.indexOf('js/data/store.js'), 'nutrition.js chargé avant store.js (sanitizeData)');
    const css = read('css/nutrition.css');
    assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), 'couleurs : tokens de css/base.css seulement');
    // Aucune finalité médicale ni promesse dans l'interface ; source, licence et écoute présentes
    const ui = ['js/features/nutrition-ui.js', 'js/features/diet-editor.js', 'js/features/diet-settings.js', 'js/features/food-scan-ui.js'].map(read).join('\n');
    assert.ok(!/diab|obésit|plus sain|brûle|détox|detox|maigrir vite/i.test(ui), 'pas de finalité médicale ni de promesse');
    for (const t of ['table Ciqual 2025 de l\'Anses (version du 03/11/2025)', 'doi.org/10.57745/RDMHWY', 'Licence Ouverte Etalab 2.0', 'L\'Anses ne valide pas ces plans',
      '0810 037 037', 'réservent les régimes sous 1 200 kcal', 'Garder sur cet iPhone']) assert.ok(ui.includes(t), `texte : ${t}`);
    for (const t of ['Copier sur mon compte', 'En savoir plus', 'Recevoir les plans de nutrition', 'envoyer un plan de nutrition']) assert.ok(ui.includes(t), `texte : ${t}`);
    const privacy = read('privacy.html');
    assert.ok(privacy.includes('id="nutrition"') && privacy.includes('href="#nutrition"') && privacy.includes('Your diet plans'), 'privacy.html : Nutrition FR et EN');
    // Textes de l'interface : sans tiret dans les phrases
    for (const f of ['js/features/nutrition-ui.js', 'js/features/diet-editor.js', 'js/features/diet-settings.js', 'js/features/food-scan-ui.js']) {
      const strings = [...read(f).matchAll(/'([^'\n]*[A-Za-zéè][^'\n]*)'|`([^`]*)`/g)].map(m => m[1] || m[2]);
      for (const s of strings) assert.ok(!/\s[-–—]\s/.test(s.replace(/\$\{[^}]*\}/g, '')), `${f} : tiret dans « ${s.slice(0, 60)} »`);
    }
  });

  // ── Vague 4 (nutrition) ───────────────────────────────────

  test('vague 4 : étiquette « cru » / « cuit » d\'après le nom Ciqual ; « blé dur » n\'est pas un œuf dur', () => {
    loadDb();
    const tag = code => run(`foodCookTag(foodDb.byCode.get(${code}))`);
    assert.equal(tag(9100), 'cru', 'Riz blanc, cru');
    assert.equal(tag(9104), 'cuit', 'Riz blanc, cuit');
    assert.equal(tag(9810), 'cru', 'Pâtes sèches, standard, crues');
    assert.equal(tag(9811), 'cuit', 'Pâtes sèches, standard, cuites : « sèches » ne fait pas « cru »');
    assert.equal(tag(36018), 'cuit', 'Poulet grillé/poêlé');
    assert.equal(tag(6201), 'cru', 'Steak cru');
    assert.equal(tag(20359), 'cru', 'Lentille sèche : un féculent sec se pèse cru');
    assert.equal(tag(32140), null, 'Flocons d\'avoine : le nom ne dit rien');
    const byName = n => run(`foodCookTag(foodDb.foods.find(f => f.name === ${JSON.stringify(n)}))`);
    assert.equal(byName('Banane, chair sans peau, sèche'), null, 'une banane sèche n\'est pas « crue »');
    assert.equal(byName('Semoule de blé dur, crue'), 'cru', '« blé dur » : pas la cuisson d\'un œuf');
    assert.equal(run(`foodState('Blé dur complet, cru')`), 'cru', 'foodState corrigé (équivalences)');
    assert.equal(run(`foodCookTag({ name: 'Whey', fam: 'v' })`), null);
  });

  test('vague 4 : version crue d\'un aliment cuit et l\'inverse (rappel « Pesé cuit ? »)', () => {
    loadDb();
    const twin = code => run(`foodCookTwin(foodDb.byCode.get(${code}))?.name ?? null`);
    assert.equal(twin(9100), 'Riz blanc, cuit, sans sel ajouté');
    assert.equal(twin(9104), 'Riz blanc, cru');
    assert.equal(twin(9810), 'Pâtes sèches, standard, cuites, sans sel ajouté');
    assert.equal(twin(36017), 'Poulet, filet sans peau grillé/poêlé');
    assert.equal(twin(6250), 'Boeuf, steak haché 5% MG cuit', 'même taux de matière grasse');
    assert.equal(twin(9341), 'Quinoa, cru');
    assert.equal(twin(32140), null, 'sans cuisson dans le nom : pas de rappel');
    assert.equal(twin(22010), null, 'œuf dur : pas de version crue du même nom');
    assert.equal(run(`foodCookTwin({ name: 'Riz blanc, cru', fam: 'f', per: { k: 1, p: 0, c: 0, f: 0 } })`), null, 'aliment perso (sans code) : pas de rappel');
  });

  test('vague 4 : recherche « pile » (sinon « Créer « … » » en tête)', () => {
    loadDb();
    const exact = q => run(`foodSearchExact(${JSON.stringify(q)}, searchFoods(${JSON.stringify(q)}))`);
    assert.equal(exact('quinoa'), true, '« Quinoa, cru »');
    assert.equal(exact('huile olive'), true, 'chaque mot en entier : « Huile d\'olive… »');
    assert.equal(exact('riz cuit'), true);
    assert.equal(exact('riz blanc'), true);
    assert.equal(exact('Riz blanc, cru'), true, 'nom entier');
    assert.equal(exact('whey'), false, 'absent de Ciqual');
    assert.equal(exact('riz bl'), false, 'mot pas fini : pas pile');
    assert.equal(exact('  '), false);
    const own = [{ id: 'm1', name: 'Whey vanille', fam: 'v', per: { k: 380, p: 78, c: 6, f: 5 } }];
    assert.equal(run(`foodSearchExact('whey vanille', searchFoods('whey vanille', { own: ${JSON.stringify(own)} }))`), true, 'mon aliment trouvé pile');
  });

  test('vague 4 : Mes aliments plein (200) : dit avant, jamais le plus ancien retiré en silence ; retirer et Annuler', () => {
    reset();
    const per = { k: 100, p: 10, c: 10, f: 1 };
    const list = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, name: `Aliment ${i}`, fam: 'p', per, ...(i === 3 ? { code: '96385074' } : {}) }));
    run(`data.dietFoods = ${JSON.stringify(list)}; sanitizeData(data)`);
    assert.equal(run('data.dietFoods.length'), 200);
    assert.equal(run(`dietFoodsFull(data.dietFoods, { name: 'Nouveau' })`), true, 'nouveau nom : plein');
    assert.equal(run(`dietFoodsFull(data.dietFoods, { name: 'aliment 7' })`), false, 'même nom : remplacé sur place');
    assert.equal(run(`dietFoodsFull(data.dietFoods, { name: 'Autre', code: '96385074' })`), false, 'même code-barres : remplacé');
    assert.equal(run(`dietFoodsFull(data.dietFoods.slice(1), { name: 'Nouveau' })`), false, '199 : de la place');
    assert.equal(run(`dietFoodsFull(undefined, { name: 'X' })`), false);
    // Retirer : la place se libère, l'identifiant est noté (la synchro ne le fait pas revenir) ; Annuler le remet à sa place
    const gone = run(`dietRemoveFood(data, 'f5')`);
    assert.equal(gone.index, 5);
    assert.equal(run('data.dietFoods.length'), 199);
    sameJSON(run('data.dietFoodsGone'), ['f5']);
    assert.equal(run(`dietRemoveFood(data, 'inconnu')`), null);
    assert.equal(run(`dietRestoreFood(data, dietRemoveFood(data, 'f6') && { food: ${JSON.stringify(list[6])}, index: 6 })`), true);
    assert.equal(run('data.dietFoods[6].id'), 'f6', 'remis à sa place');
    sameJSON(run('data.dietFoodsGone'), ['f5'], 'remis : plus noté comme retiré');
    // Plein entre-temps : Annuler ne fait rien partir
    run(`data.dietFoods.push({ id: 'g1', name: 'Pris la place', fam: 'p', per: ${JSON.stringify(per)} })`);
    assert.equal(run(`dietRestoreFood(data, { food: ${JSON.stringify(list[5])}, index: 5 })`), false);
    assert.equal(run('data.dietFoods.length'), 200);
    // Registre des retraits nettoyé et borné
    sameJSON(run(`cleanDietFoodsGone(['a1', 'a1', '__proto__', 3, 'b 2', 'b2'])`), ['a1', 'b2']);
    assert.equal(run(`cleanDietFoodsGone(Array.from({ length: 400 }, (_, i) => 'x' + i)).length`), 300);
    assert.equal(run(`cleanDietFoodsGone(Array.from({ length: 400 }, (_, i) => 'x' + i)).at(-1)`), 'x399', 'les plus récents gardés');
    assert.ok(run(`SYNC_PROFILE_KEYS.includes('dietFoodsGone') && SYNC_DIET_CONSENT_KEYS.includes('dietFoodsGone')`), 'copié avec l\'accord seulement');
  });

  test('vague 4 : synchro, un aliment retiré ici ne revient pas d\'un appareil qui l\'a encore', () => {
    const per = { k: 63, p: 11, c: 4, f: 0.2 };
    const consent = { on: true, at: '2026-11-01T10:00:00Z' };
    const foods = [{ id: 'sk1', name: 'Skyr', fam: 'l', per }, { id: 'wh1', name: 'Whey', fam: 'v', per }];
    // B a encore les deux aliments, rien changé ici ; A a retiré le skyr (registre envoyé avec le profil)
    const B = run('(x => x)')({ history: [{ id: 'h', date: 1 }], unit: 'kg', dietConsent: consent, dietFoods: foods.map(x => ({ ...x })) });
    const m = run('emptySyncMeta')('u'); const doc = run('profilePayload')(B);
    m.profileHash = run('syncHash')(doc); m.profileCore = run('profileCoreHash')(doc); m.profileAt = '2026-11-01';
    run('applyRemoteProfile')(B, { doc: { unit: 'kg', dietConsent: consent, dietFoods: [foods[1]], dietFoodsGone: ['sk1'] }, updated_at: '2026-11-02' }, m);
    sameJSON(B.dietFoods.map(x => x.id), ['wh1'], 'skyr retiré ici aussi');
    sameJSON(B.dietFoodsGone, ['sk1'], 'registre gardé (renvoyé au prochain envoi)');
    // Conflit (modifié des deux côtés) : le retrait tient aussi
    const C = run('(x => x)')({ history: [{ id: 'h', date: 1 }], unit: 'lbs', dietConsent: consent, dietFoods: foods.map(x => ({ ...x })), dietFoodsGone: ['old'] });
    run('applyRemoteProfile')(C, { doc: { unit: 'kg', dietConsent: consent, dietFoods: foods, dietFoodsGone: ['wh1'] }, updated_at: '2026-11-02' }, run('emptySyncMeta')('u'));
    sameJSON(C.dietFoods.map(x => x.id), ['sk1']);
    sameJSON(C.dietFoodsGone.sort(), ['old', 'wh1']);
  });

  // Repas du jour : plan à 2 ou 3 repas, aliments de la base
  const mealsDay = (n = 2) => {
    loadDb();
    const riz = { ...item(RIZ_CUIT, 150), id: 'it1' }, poulet = { ...item(POULET_GRILLE, 100), id: 'it2' }, oeuf = { ...item(OEUF_DUR, 100), id: 'it3' };
    const meals = [{ id: 'm1', name: 'Matin', items: [oeuf] }, { id: 'm2', name: 'Midi', items: [riz] }, { id: 'm3', name: 'Soir', items: [poulet] }].slice(0, n);
    run(`data.dietPlans = { d_a: { name: 'P', targets: { kcal: 2000 }, meals: ${JSON.stringify(meals)} } }; data.dietActive = 'd_a';`);
  };
  const D = '2026-11-05', H = '2026-11-04';
  const pr = (day = D) => run(`dietDayProgress(data, 'd_a', '${day}')`);
  const kcal = (code, g) => item(code, g).per.k * g / 100;
  const add = (meal, code, g, day = D) => run(`dietAddExtra(data, 'd_a', '${meal}', ${JSON.stringify(item(code, g))}, '${day}')`);

  test('repas retiré : plus à cocher ni compté, « Journée complète » sans lui, remis à cocher ; le plan ne change pas', () => {
    reset(); mealsDay(2);
    assert.equal(pr().eaten.kcal, 0, 'rien de coché : rien de mangé (un aliment prévu ne compte qu\'à la coche)');
    run(`dietToggleMeal(data, 'd_a', 'm1', '${D}'); dietToggleMeal(data, 'd_a', 'm2', '${D}')`);
    assert.ok(run(`!!dietSetMealOff(data, 'd_a', 'm2', '${D}')`));
    let p = pr();
    assert.ok(p.meals[1].off && !p.meals[1].done && p.meals[1].live.length === 0, 'retiré : ni coché ni à cocher');
    assert.ok(p.nMeals === 1 && p.complete, 'journée complète sans lui');
    assert.equal(Math.round(p.eaten.kcal), Math.round(kcal(OEUF_DUR, 100)), 'mangé : le matin seul');
    assert.ok(run(`dietDayComplete(data, '${D}', 'd_a')`), 'série : jour complet');
    sameJSON(run(`data.dietLog['${D}'].meals`), ['m1']);
    assert.equal(run('data.dietPlans.d_a.meals[1].items.length'), 1, 'le plan ne change pas');
    // Ajout APRÈS le retrait (on a mangé autre chose) : compté tout de suite
    add('m2', RIZ_CUIT, 100);
    assert.equal(Math.round(pr().eaten.kcal), Math.round(kcal(OEUF_DUR, 100) + kcal(RIZ_CUIT, 100)));
    run(`dietSetMealOn(data, 'd_a', 'm2', '${D}')`);
    p = pr();
    assert.ok(p.nMeals === 2 && !p.complete && p.next.meal.id === 'm2', 'remis : à cocher, pas recoché en silence');
    assert.equal(run(`dietSetMealOff(data, 'd_a', 'zz', '${D}')`), null, 'repas inconnu');
  });

  test('repas retiré : les ajouts faits avant (pas mangés) partent avec lui et ne comptent pas ; Annuler les remet', () => {
    reset(); mealsDay(2);
    add('m2', HUILE_OLIVE, 30);   // sauce ajoutée au dîner pas encore coché
    assert.equal(pr().eaten.kcal, 0, 'repas pas coché : son ajout ne compte pas');
    const gone = run(`dietSetMealOff(data, 'd_a', 'm2', '${D}')`);
    assert.equal(gone.extras.length, 1);
    assert.equal(pr().eaten.kcal, 0, 'retiré : la sauce ne compte pas');
    assert.equal(pr().meals[1].extras.length, 0, 'partie avec le repas');
    run(`dietUndoMealOff(data, 'd_a', 'm2', ${JSON.stringify(gone)}, '${D}')`);
    const p = pr();
    assert.ok(!p.meals[1].off && p.meals[1].extras.length === 1 && p.eaten.kcal === 0, 'Annuler : repas et sauce remis, toujours pas mangés');
  });

  test('Annuler un retrait ne défait que lui : une coche faite entre-temps reste', () => {
    reset(); mealsDay(2);
    run(`dietToggleMeal(data, 'd_a', 'm2', '${D}')`);
    const gone = run(`dietSetMealOff(data, 'd_a', 'm2', '${D}')`);
    assert.equal(gone.done, true);
    run(`dietToggleMeal(data, 'd_a', 'm1', '${D}')`);   // coché pendant les 6 s du message
    run(`dietUndoMealOff(data, 'd_a', 'm2', ${JSON.stringify(gone)}, '${D}')`);
    sameJSON(run(`data.dietLog['${D}'].done`).sort(), ['m1', 'm2'], 'coche du matin gardée, midi recoché');
    assert.ok(pr().complete);
  });

  test('journée vide : ce qui est noté compte tout de suite, même après « Copier le plan de ce repas »', () => {
    reset(); mealsDay(2);
    run(`dietSetEmptyDays(data, true, '${D}')`);
    let p = pr();
    assert.ok(p.blank && p.eaten.kcal === 0 && p.meals.every(x => !x.live.length && x.copyable), 'rien de pré-rempli');
    assert.equal(p.goal.kcal, 2000, 'objectif du plan gardé');
    add('m1', OEUF_DUR, 50);
    const k = Math.round(kcal(OEUF_DUR, 50));
    assert.equal(Math.round(pr().eaten.kcal), k, 'noté : compté');
    run(`dietCopyMealPlan(data, 'd_a', 'm1', '${D}')`);
    p = pr();
    assert.ok(p.meals[0].live.length === 1 && p.next.meal.id === 'm1', 'plan copié : à cocher');
    assert.equal(Math.round(p.eaten.kcal), k, 'plan copié : le noté reste compté, le plan pas encore');
    run(`dietToggleMeal(data, 'd_a', 'm1', '${D}')`);
    assert.equal(Math.round(pr().eaten.kcal), Math.round(k + kcal(OEUF_DUR, 100)), 'coché : plan et noté');
    // Relu (sauvegarde) : blank et copied gardés, illisibles écartés
    run(`sanitizeDiet(data, ${new Date(2026, 10, 5, 12).getTime()})`);
    sameJSON(run(`[data.dietLog['${D}'].blank, data.dietLog['${D}'].copied]`), [true, ['m1']]);
    run(`data.dietLog['${D}'].blank = 'oui'; data.dietLog['${D}'].off = ['<x>', 3]; data.dietEmptyDays = 1; sanitizeDiet(data, ${new Date(2026, 10, 5, 12).getTime()})`);
    assert.ok(run(`!('blank' in data.dietLog['${D}']) && !('off' in data.dietLog['${D}']) && data.dietEmptyDays === undefined`));
    assert.ok(run(`SYNC_LOCAL_ONLY.includes('dietEmptyDays')`), 'réglage de l\'appareil');
  });

  test('journée vide : complète dès que chaque repas non retiré a un aliment noté (ou son plan copié coché), série comprise', () => {
    reset(); mealsDay(3);
    run(`data.dietEmptyDays = true`);
    add('m1', OEUF_DUR, 50);
    let p = pr();
    assert.ok(p.nMeals === 3 && p.nDone === 1 && !p.complete);
    run(`dietSetMealOff(data, 'd_a', 'm3', '${D}')`);   // dîner sauté
    run(`dietCopyMealPlan(data, 'd_a', 'm2', '${D}')`);
    assert.ok(!pr().complete, 'plan copié pas coché : pas fait');
    run(`dietToggleMeal(data, 'd_a', 'm2', '${D}')`);
    p = pr();
    assert.ok(p.nMeals === 2 && p.complete, 'complète');
    assert.ok(run(`dietDayComplete(data, '${D}', 'd_a')`), 'jour complet pour la série');
    add('m1', OEUF_DUR, 50, H); add('m2', RIZ_CUIT, 100, H); add('m3', POULET_GRILLE, 100, H);
    assert.equal(run(`dietStreak(data, ${new Date(2026, 10, 5, 20).getTime()})`), 2, 'série de jours vides complets');
  });

  test('journée vide puis plan modifié (coach, éditeur) : l\'aliment ajouté au plan n\'apparaît pas pré-rempli', () => {
    reset(); mealsDay(2);
    run(`data.dietEmptyDays = true`);
    add('m2', RIZ_CUIT, 100);
    run(`data.dietPlans.d_a.meals[0].items.push({ ...data.dietPlans.d_a.meals[0].items[0], id: 'it9' })`);
    const p = pr();
    assert.ok(p.meals.every(x => !x.live.length) && p.nMeals === 2, 'rien de pré-rempli');
    assert.ok(p.meals[0].copyable);
  });

  test('actions : aucun nom déclaré deux fois (le second remplaçait le premier en silence : ⋯ d\'un repas du jour ouvrait l\'éditeur)', () => {
    const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
      .flatMap(f => (f.isDirectory() ? walk(path.join(d, f.name)) : f.name.endsWith('.js') ? [path.join(d, f.name)] : []));
    const seen = new Map(), dup = [];
    for (const f of walk('js')) {
      for (const block of read(f).split('registerActions({').slice(1)) {
        for (const m of block.matchAll(/^ {2}'([a-z0-9-]+)':/gm)) { if (seen.has(m[1])) dup.push(`${m[1]} (${seen.get(m[1])}, ${f})`); seen.set(m[1], f); }
      }
    }
    assert.ok(seen.size > 300, `${seen.size} actions lues`);
    sameJSON(dup, []);
  });

  test('réglage des repas du jour : aujourd\'hui suit sans rien perdre, un repas retiré le reste, les jours passés ne changent pas', () => {
    reset(); mealsDay(3);
    run(`dietToggleMeal(data, 'd_a', 'm1', '${H}'); dietToggleMeal(data, 'd_a', 'm1', '${D}'); dietSetMealOff(data, 'd_a', 'm3', '${D}')`);
    const hier = run(`JSON.stringify(data.dietLog['${H}'])`);
    // Vers « Vides » : Matin coché garde son plan, Midi se vide, Soir reste retiré ; hier ne bouge pas
    run(`dietSetEmptyDays(data, true, '${D}')`);
    let p = pr();
    sameJSON(p.meals.map(x => [x.live.length, x.off, x.copyable]), [[1, false, false], [0, false, true], [0, true, false]]);
    assert.ok(p.blank && p.meals[0].done);
    assert.equal(run(`JSON.stringify(data.dietLog['${H}'])`), hier, 'hier inchangé');
    // Midi noté à la main ; retour à « Pré-remplis » : Midi garde ce qui a été noté (retiré, pas de double compte),
    // Soir retiré volontairement le reste
    add('m2', RIZ_CUIT, 80);
    run(`dietSetEmptyDays(data, false, '${D}')`);
    p = pr();
    assert.ok(run('data.dietEmptyDays') === undefined && !p.blank);
    sameJSON(p.meals.map(x => [x.live.length, x.off]), [[1, false], [0, true], [0, true]]);
    assert.ok(p.complete && Math.round(p.eaten.kcal) === Math.round(kcal(OEUF_DUR, 100) + kcal(RIZ_CUIT, 80)));
    // Aller-retour sans rien noter : le repas retiré reste retiré
    run(`dietSetEmptyDays(data, true, '${D}'); dietSetEmptyDays(data, false, '${D}')`);
    assert.ok(pr().meals[2].off, 'Soir toujours retiré');
    assert.equal(run(`JSON.stringify(data.dietLog['${H}'])`), hier, 'hier inchangé');
    // Journal d'un ancien client (ni blank, ni off, ni instantané) : lu comme avant
    run(`data.dietLog = { '${H}': { plan: 'd_a', done: ['m1', 'm2', 'm3'], swaps: {} } }`);
    assert.ok(run(`dietDayComplete(data, '${H}')`));
  });

  test('vague 4 : carte de l\'accueil, tous les repas jusqu\'à 4, sinon 3 autour du prochain et « et N autres »', () => {
    const mk = (n, done = 0) => {
      const meals = Array.from({ length: n }, (_, i) => ({ meal: { id: `m${i}`, name: `R${i}`, items: [{}] }, done: i < done }));
      return { meals, next: meals.find(x => !x.done) || null };
    };
    const ids = r => r.shown.map(x => x.meal.id);
    sameJSON(ids(run('dietHomeMeals')(mk(4, 1))), ['m0', 'm1', 'm2', 'm3']);
    assert.equal(run('dietHomeMeals')(mk(4, 1)).more, 0);
    sameJSON(ids(run('dietHomeMeals')(mk(6, 0))), ['m0', 'm1', 'm2'], 'rien de coché : les premiers');
    sameJSON(ids(run('dietHomeMeals')(mk(6, 3))), ['m2', 'm3', 'm4'], 'le dernier coché, le prochain, le suivant');
    sameJSON(ids(run('dietHomeMeals')(mk(6, 5))), ['m3', 'm4', 'm5'], 'fin de journée : les derniers');
    sameJSON(ids(run('dietHomeMeals')(mk(6, 6))), ['m0', 'm1', 'm2'], 'journée complète');
    assert.equal(run('dietHomeMeals')(mk(6, 3)).more, 3);
    // Repas sans aliment (collation libre) : jamais listé, on ne le coche pas
    const pr = mk(3, 0); pr.meals[1].meal.items = [];
    sameJSON(ids(run('dietHomeMeals')(pr)), ['m0', 'm2']);
  });

  test('vague 4 : textes de l\'interface (légende des macros, Créer « … », rappel cru / cuit, Mes aliments)', () => {
    const ui = ['js/features/nutrition-ui.js', 'js/features/diet-editor.js', 'js/features/diet-settings.js', 'js/features/food-scan-ui.js', 'js/features/diet-qty.js'].map(read).join('\n');
    for (const t of ['Pesé cuit\\u00a0? Choisis la version cuite.', 'Pesé cru\\u00a0? Choisis la version crue.', 'Mes aliments est plein', 'Gérer Mes aliments',
      'Ajouter sans le garder', 'Retirer de Mes aliments', 'Créer «\\u00a0']) assert.ok(ui.includes(t), `texte : ${t}`);
    // Légende : une seule source (les libellés de DIET_MACROS), cachée à VoiceOver (lignes déjà dites en toutes lettres)
    assert.match(read('js/features/nutrition-ui.js'), /function dietMacroLegendHtml[\s\S]{0,400}aria-hidden="true"/);
    for (const f of ['js/features/nutrition-ui.js', 'js/features/diet-editor.js', 'js/features/diet-settings.js']) assert.ok(read(f).includes('dietMacroLegendHtml('), `légende : ${f}`);
  });
}
