// Scanner un aliment (js/data/food-scan.js) : codes-barres, réponse d'Open Food Facts, Mes aliments.
// Aucune requête réelle : offLookup reçoit un fetch simulé.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const parse = (json, code = '3017620422003') => run(`offParse(${JSON.stringify(json)}, ${JSON.stringify(code)})`);
  const prod = (nutriments, extra = {}) => ({ status: 1, code: '3017620422003', product: { product_name: 'Pâte à tartiner', brands: 'Marque A, Groupe B', nutriments, ...extra } });

  test('code-barres : EAN-13, EAN-8, UPC-A, UPC-E dépliés et chiffre de contrôle vérifié', () => {
    assert.equal(run("normBarcode('3017620422003')"), '3017620422003');
    assert.equal(run("normBarcode(' 3 017620 422003 ')"), '3017620422003', 'espaces de la saisie ignorés');
    assert.equal(run("normBarcode('3017620422004')"), null, 'mauvais chiffre de contrôle : rien sur le réseau');
    assert.equal(run("normBarcode('96385074')"), '96385074', 'EAN-8');
    assert.equal(run("normBarcode('96385075')"), null);
    assert.equal(run("normBarcode('036000291452')"), '0036000291452', 'UPC-A : rangé en EAN-13 par Open Food Facts');
    assert.equal(run("normBarcode('00036000291452')"), '0036000291452', 'GTIN-14 à zéro de tête');
    // UPC-E 01234565 → UPC-A 012345000065 (exemple de la norme GS1)
    assert.equal(run("upceToUpca('01234565')"), '012345000065');
    assert.equal(run("normBarcode('01234565', 'upce')"), '0012345000065');
    assert.equal(run("upceToUpca('01234566')"), null, 'UPC-E au mauvais contrôle');
    assert.equal(run("upceToUpca('04252614')"), '042100005264', 'dernier chiffre 0 à 2');
    assert.equal(run("normBarcode('abc')"), null);
    assert.equal(run("normBarcode('')"), null);
    assert.equal(run("normBarcode('12345')"), null, 'trop court');
    assert.equal(run("barcodeShown('3017620422003')"), '3 017620 422003', 'espaces insécables');
  });

  test('Open Food Facts : produit complet, nom « Marque · Nom », famille tirée des macros', () => {
    const r = parse(prod({ 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9, salt_100g: 0.107 }));
    assert.equal(r.status, 'found');
    sameJSON(r.food, { name: 'Marque A · Pâte à tartiner', code: '3017620422003', fam: 'p', per: { k: 539, p: 6.3, c: 57.5, f: 30.9 }, src: 'off', salt: 0.11 });
    // Nom français d'abord ; marque déjà dans le nom : pas deux fois
    assert.equal(parse(prod({ 'energy-kcal_100g': 60, proteins_100g: 10, carbohydrates_100g: 4, fat_100g: 0.2 },
      { product_name: 'Skyr', product_name_fr: 'Skyr nature Marque A', brands: 'marque a' })).food.name, 'Skyr nature Marque A');
    assert.equal(parse(prod({ 'energy-kcal_100g': 60, proteins_100g: 10, carbohydrates_100g: 4, fat_100g: 0.2 }, { product_name: '', brands: 'Marque A' })).food.name, 'Marque A', 'marque seule');
    assert.equal(parse(prod({ 'energy-kcal_100g': 60, proteins_100g: 10, carbohydrates_100g: 4, fat_100g: 0.2 }, { product_name: '  ', brands: '' })).food.name, 'Produit 3017620422003', 'sans nom');
    const long = parse(prod({ 'energy-kcal_100g': 60, proteins_100g: 10, carbohydrates_100g: 4, fat_100g: 0.2 }, { product_name: 'Mot '.repeat(40) })).food.name;
    assert.ok(long.length <= 80, `nom coupé au mot : ${long.length}`);
  });

  test('Open Food Facts : kcal absentes → depuis les kJ, sinon 4/4/9 (calculées) ; kJ mis dans les kcal', () => {
    sameJSON(parse(prod({ 'energy-kj_100g': 2252, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 })).food.per, { k: 538, p: 6.3, c: 57.5, f: 30.9 });
    assert.equal(parse(prod({ energy_100g: 418.4, proteins_100g: 1, carbohydrates_100g: 20, fat_100g: 1 })).food.per.k, 100, 'energy_100g : en kJ');
    const calc = parse(prod({ proteins_100g: 10, carbohydrates_100g: 4, fat_100g: 1 })).food;
    assert.equal(calc.per.k, 65);
    assert.equal(calc.ecalc, true, 'énergie calculée par l\'app');
    assert.equal(parse(prod({ 'energy-kcal_100g': 2252, 'energy-kj_100g': 2252, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 })).food.per.k, 538, 'kcal aberrantes : les kJ prennent le relais');
    assert.equal(parse(prod({ 'energy-kcal_100g': '62,5', proteins_100g: '10', carbohydrates_100g: 4, fat_100g: 0.2 })).food.per.k, 63, 'nombres en texte');
  });

  test('Open Food Facts : sel déclaré ou tiré du sodium ; jamais compté dans les macros', () => {
    assert.equal(parse(prod({ 'energy-kcal_100g': 250, proteins_100g: 9, carbohydrates_100g: 48, fat_100g: 3, sodium_100g: 0.4 })).food.salt, 1);
    const r = parse(prod({ 'energy-kcal_100g': 0, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0, salt_100g: 99 })).food;
    assert.equal(r.salt, 99, 'sel fin');
    sameJSON(r.per, { k: 0, p: 0, c: 0, f: 0 });
    assert.ok(!('salt' in parse(prod({ 'energy-kcal_100g': 250, proteins_100g: 9, carbohydrates_100g: 48, fat_100g: 3, salt_100g: 400 })).food), 'sel aberrant : écarté');
  });

  test('Open Food Facts : produit inconnu, vide ou aux valeurs aberrantes', () => {
    assert.equal(parse({ status: 0, status_verbose: 'product not found', code: '3017620422003' }).status, 'unknown');
    assert.equal(parse(null).status, 'unknown');
    assert.equal(parse({ status: 1, product: [] }).status, 'unknown');
    sameJSON(parse(prod({})), { status: 'incomplete', name: 'Marque A · Pâte à tartiner' }, 'aucune valeur : nom gardé pour la saisie');
    assert.equal(parse(prod({ 'energy-kcal_100g': 100, proteins_100g: 10 })).status, 'incomplete', 'une seule macro');
    assert.equal(parse(prod({ 'energy-kcal_100g': 100, proteins_100g: 80, carbohydrates_100g: 60 })).status, 'incomplete', 'plus de 101 g de macros pour 100 g');
    assert.equal(parse(prod({ 'energy-kcal_100g': 1500, proteins_100g: 10, carbohydrates_100g: 10, fat_100g: 10 })).status, 'incomplete', 'plus de 900 kcal sans kJ');
    assert.equal(parse(prod({ 'energy-kcal_100g': -5, proteins_100g: 1, carbohydrates_100g: 1, fat_100g: 1 })).food.ecalc, true, 'négatif : ignoré, calculé');
    // Deux macros sur trois : la troisième vaut 0 (eau, huile)
    sameJSON(parse(prod({ 'energy-kcal_100g': 900, carbohydrates_100g: 0, fat_100g: 100 })).food.per, { k: 900, p: 0, c: 0, f: 100 });
  });

  test('offLookup : adresse, User-Agent sans contact, 404, panne, hors ligne et délai dépassé', async () => {
    const calls = [];
    const ok = body => ({ status: 200, ok: true, json: async () => body });
    run('globalThis.__f = null');
    const lookup = async (resp, opts = '') => {
      const ctx = run('globalThis');
      ctx.__f = async (url, init) => { calls.push({ url, init }); return typeof resp === 'function' ? resp(init) : resp; };
      return JSON.parse(JSON.stringify(await run(`offLookup('3017620422003', { fetchImpl: __f, userAgent: offUserAgent('1.4', 'ios') ${opts} })`)));
    };
    const r = await lookup(ok(prod({ 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 })));
    assert.equal(r.status, 'found');
    assert.equal(calls[0].url, 'https://world.openfoodfacts.org/api/v2/product/3017620422003.json?fields=product_name,product_name_fr,brands,nutriments,quantity,serving_size,serving_quantity');
    assert.equal(calls[0].init.headers['User-Agent'], 'MDLF Training/1.4 (iOS)');
    assert.equal(calls[0].init.headers['X-User-Agent'], 'MDLF Training/1.4 (iOS)');
    assert.equal(calls[0].init.credentials, 'omit', 'aucun cookie');
    assert.ok(!/@/.test(run("offUserAgent('1.4')")), 'pas d\'adresse e-mail');
    assert.equal(run("offUserAgent('<script>')"), 'MDLF Training/1.0 (iOS)', 'version illisible : remplacée');
    assert.equal((await lookup({ status: 404, ok: false, json: async () => ({ status: 0 }) })).status, 'unknown');
    assert.equal((await lookup({ status: 503, ok: false, json: async () => ({}) })).status, 'error');
    assert.equal((await lookup({ status: 200, ok: true, json: async () => { throw new SyntaxError('x'); } })).status, 'error', 'réponse illisible');
    assert.equal((await lookup(() => { throw new TypeError('Load failed'); })).status, 'offline', 'réseau absent');
    // Délai dépassé : la requête est abandonnée (AbortController)
    const slow = init => new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    assert.equal((await lookup(slow, ', timeout: 20')).status, 'offline');
    const n = calls.length;
    assert.equal(JSON.parse(JSON.stringify(await run("offLookup('123', { fetchImpl: __f })"))).status, 'unknown', 'code invalide');
    assert.equal(calls.length, n, 'code invalide : aucune requête');
    run('navigator.onLine = false');
    try { assert.equal((await lookup(ok({}))).status, 'offline'); assert.equal(calls.length, n, 'hors ligne : aucune requête'); }
    finally { run('delete navigator.onLine'); }
  });

  test('Mes aliments : produit gardé avec son code, retrouvé sans réseau, jamais d\'écrasement', () => {
    reset();
    run("data.dietFoods = [{ id: 'own1', name: 'Skyr', per: { k: 63, p: 11, c: 4, f: 0.2 } }]");
    const found = parse(prod({ 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9, salt_100g: 0.107 })).food;
    const kept = run(`dietSaveScanned(data, ${JSON.stringify(found)})`);
    assert.equal(kept.code, '3017620422003');
    assert.equal(run('data.dietFoods[0].code'), '3017620422003', 'en tête');
    assert.equal(run('data.dietFoods.length'), 2);
    assert.equal(run("dietFoodByCode(data.dietFoods, '3017620422003').name"), 'Marque A · Pâte à tartiner');
    assert.equal(run("dietFoodByCode(data.dietFoods, '96385074')"), null);
    // Rescanné : remplacé, pas doublé
    run(`dietSaveScanned(data, ${JSON.stringify(found)})`);
    assert.equal(run('data.dietFoods.length'), 2);
    // Même nom qu'un aliment fait à la main : le code est ajouté au nom, l'aliment à la main reste
    run(`dietSaveScanned(data, ${JSON.stringify({ ...found, code: '96385074', name: 'skyr' })})`);
    assert.equal(run("dietFoodByCode(data.dietFoods, '96385074').name"), 'skyr · 96385074');
    assert.equal(run("data.dietFoods.find(x => x.id === 'own1').name"), 'Skyr');
    // Gardé après sanitizeData (code, source, sel, énergie calculée)
    run('sanitizeData(data)');
    sameJSON(run("(({ id, ...x }) => x)(dietFoodByCode(data.dietFoods, '3017620422003'))"),
      { name: 'Marque A · Pâte à tartiner', fam: 'p', per: { k: 539, p: 6.3, c: 57.5, f: 30.9 }, code: '3017620422003', src: 'off', salt: 0.11 });
    // Données illisibles nettoyées : code faux, source inventée
    sameJSON(run("cleanDietFoods([{ id: 'x1', name: 'A', per: { k: 1, p: 0, c: 0, f: 0 }, code: '12ab', src: 'off', salt: 'beaucoup' }])"),
      [{ id: 'x1', name: 'A', fam: 'a', per: { k: 1, p: 0, c: 0, f: 0 } }]);
    // Aliment du plan : source « off » gardée
    const pick = run("dietOwnPick(dietFoodByCode(data.dietFoods, '3017620422003'))");
    assert.equal(run(`foodToItem(${JSON.stringify(pick)}, 30).src`), 'off');
    assert.equal(run(`foodToItem(${JSON.stringify(pick)}, 30).food`), null, 'pas de code Ciqual');
    assert.equal(run("searchFoods('pâte', { own: data.dietFoods })[0].food.src"), 'off');
  });

  test('Scanner : module natif déclaré, attribution ODbL, confidentialité, cache du service worker', () => {
    const swift = read('ios/App/App/ScannerPlugin.swift');
    assert.match(swift, /jsName = "MdlfScanner"/);
    assert.match(swift, /\.ean13, \.ean8, \.upce/, 'EAN-13, EAN-8, UPC-E (UPC-A lu en EAN-13)');
    assert.doesNotMatch(swift, /MLKit|GoogleMobileVision|import Vision\b/, 'aucun SDK tiers');
    assert.match(read('ios/App/App/Info.plist'), /<key>NSCameraUsageDescription<\/key>\s*<string>[^<]*scanner le code-barres[^<]*<\/string>/);
    const privacy = read('ios/App/App/PrivacyInfo.xcprivacy');
    assert.match(privacy, /NSPrivacyCollectedDataTypePhotosorVideos/, 'photos de bilan déclarées');
    assert.match(read('js/features/nutrition-ui.js'), /Open Food Facts \(openfoodfacts\.org\), © les contributeurs d'Open Food Facts, base libre sous licence ODbL/);
    assert.match(read('js/features/food-scan-ui.js'), /licence ODbL/, 'attribution sur la fiche du produit');
    const page = read('privacy.html');
    assert.match(page, /code-barres[^<]*Open Food Facts/, 'privacy.html FR');
    assert.match(page, /barcode[^<]*Open Food Facts/, 'privacy.html EN');
    assert.match(read('sw.js'), /const CACHE = 'ppl-v(13[7-9]|1[4-9]\d|[2-9]\d\d)'/);
  });
}
