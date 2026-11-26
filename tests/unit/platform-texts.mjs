// ═══════════════════════════════════════════════════════════
//  Textes propres au système (js/data/platform-texts.js), panel Android du 26/11/2026 :
//  - les textes iOS sont EXACTEMENT ceux d'avant (textes-ios.json, relevé sur le code d'avant ce chantier) ;
//  - l'app Android ne parle ni d'Apple, ni d'iPhone, ni d'iCloud, sauf là où c'est vrai (abonnement pris sur iPhone) ;
//  - une seule règle choisit la variante (byPlatform, js/platform/native.js) ; le navigateur garde les textes iOS ;
//  - achat sur Android coupé tant que le serveur ne vérifie pas Google Play (Native.store.soon) ;
//  - les écrans ne gardent plus aucun texte d'Apple en dur (paywall-ui.js, access.js).
//  Contextes vm à part : coquille iOS (iPhone), coquille Android, navigateur.
// ═══════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
// Mêmes arguments pour chaque texte qui en prend (durée, prix, nom, date…) : le relevé reste comparable
const ARGS = ['3 mois', '7,77 € par mois ou 77,77 € par an'];
// Textes Android qui nomment Apple ou l'iPhone parce que c'est vrai : un abonnement pris sur iPhone se gère sur
// l'iPhone, un identifiant Apple relié au compte se retire chez Apple. Toute autre mention échoue.
const ANDROID_APPLE_OK = ['payManageFoot', 'payNoStore', 'payDoubleTrial', 'payDeleteActive', 'appleManualRevoke'];
const APPLE_WORDS = /iPhone|iPad|Apple|iCloud|Face ID|Touch ID|Safari|Temps d'écran|trousseau|App Store|TestFlight|StoreKit/;

export default function ({ test, assert, sameJSON, nativeContext, ROOT }) {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

  // native.js puis platform-texts.js, comme index.html, dans une coquille donnée (null : navigateur)
  const load = (platform, { store = false, ua = platform === 'android' ? PIXEL : IPHONE } = {}) => {
    const box = { console, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      setTimeout: () => 0, clearTimeout() {}, URLSearchParams, navigator: { userAgent: ua, maxTouchPoints: 5 },
      Capacitor: platform ? { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: n => store && n === 'MdlfStore',
        registerPlugin: () => new Proxy({}, { get: () => async () => ({}) }) } : undefined };
    box.window = box;
    const c = vm.createContext(box);
    for (const f of ['js/platform/native.js', 'js/data/platform-texts.js']) vm.runInContext(read(f), c, { filename: f });
    vm.runInContext('this.X = { Native, PT, PLATFORM_TEXTS, byPlatform, playSubscriptionsUrl };', c);
    return c.X;
  };
  // Chaque texte évalué (fonctions appelées avec ARGS), dans l'ordre des clés
  const flat = (v, k = '') => {
    if (typeof v === 'function') return flat(v(...ARGS), k);
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, flat(vv, `${k}.${kk}`)]));
    return v;
  };

  test('textes système : iOS exactement comme avant (relevé du 26/11 sur le code d\'avant)', () => {
    const before = JSON.parse(read('tests/unit/textes-ios.json'));
    const ios = load('ios', { store: true });
    sameJSON(flat(ios.PLATFORM_TEXTS.ios), before);
    assert.equal(ios.PT, ios.PLATFORM_TEXTS.ios, 'app iOS : variante iOS');
    // Le navigateur (PWA, site du coach) garde aussi les textes d'avant
    const web = load(null);
    assert.equal(web.Native.platform, 'web');
    assert.equal(web.PT, web.PLATFORM_TEXTS.ios);
  });

  test('textes système : Android a les mêmes clés qu\'iOS, et rien d\'Apple là où ce n\'est pas vrai', () => {
    const { PLATFORM_TEXTS: T, PT, Native } = load('android', { store: true });
    assert.equal(Native.platform, 'android');
    assert.equal(PT, T.android, 'app Android : variante Android');
    // Sous-tables (accessErrors) comparées clé à clé ; minBuildStore : null sur iOS, objet sur Android
    const keys = o => Object.entries(o).flatMap(([k, v]) => (k === 'accessErrors' ? keys(v).map(x => `${k}.${x}`) : [k])).sort();
    sameJSON(keys(T.android), keys(T.ios));
    const android = flat(T.android);
    const bad = Object.entries(android).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).map(([kk, vv]) => [`${k}.${kk}`, vv]) : [[k, v]]))
      .filter(([k, v]) => !ANDROID_APPLE_OK.includes(k) && APPLE_WORDS.test(JSON.stringify(v)));
    sameJSON(bad, []);
    sameJSON(T.android.signInProviders, ['google', 'email']);   // Google d'abord, pas de connexion Apple sur Android
    sameJSON(T.ios.signInProviders, ['apple', 'google', 'email']);
    // Pas de version minimale ni de bannière TestFlight venues d'iOS : les numéros de build d'Android sont les siens
    assert.equal(T.android.minBuildKey, 'min_build_android');
    assert.equal(T.android.latestNativeBuild, 0);
    assert.match(T.android.minBuildStore.url, /^https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.mdlf\.training$/);
  });

  test('textes système : gestion de l\'abonnement dans Google Play (lien profond sur la formule)', () => {
    const { PLATFORM_TEXTS: T, playSubscriptionsUrl } = load('android');
    assert.equal(T.android.payManageUrl('com.mdlf.training.pro.yearly'),
      'https://play.google.com/store/account/subscriptions?sku=com.mdlf.training.pro.yearly&package=com.mdlf.training');
    assert.equal(T.android.payManageUrl(null), 'https://play.google.com/store/account/subscriptions', 'formule inconnue : la liste des abonnements');
    assert.equal(playSubscriptionsUrl('a b'), 'https://play.google.com/store/account/subscriptions?sku=a+b&package=com.mdlf.training', 'paramètres encodés');
    assert.equal(T.ios.payManageUrl('com.mdlf.training.pro.yearly'), 'https://apps.apple.com/account/subscriptions');
  });

  test('textes système : sur Android, rien ne s\'achète tant que Google Play n\'est pas branché au serveur', () => {
    const android = load('android', { store: true });
    assert.equal(android.Native.store.available, false, 'module MdlfStore présent, mais achats coupés (ANDROID_BILLING_READY)');
    assert.equal(android.Native.store.soon, true);
    // Textes qui dépendent de l'état : rien de Google Play promis avant l'ouverture
    assert.doesNotMatch(android.PT.legalFoot(), /Google Play/);
    assert.match(android.PT.payManageFoot(), /pas encore proposé sur Android/);
    const ios = load('ios', { store: true });
    assert.equal(ios.Native.store.available, true);
    assert.equal(ios.Native.store.soon, false);
    assert.equal(load(null).Native.store.soon, false, 'navigateur : comportement d\'avant');
    assert.match(read('js/platform/native.js'), /const ANDROID_BILLING_READY = false;/, 'à passer à true avec verify-purchase-android (docs/ANDROID.md)');
  });

  test('textes système : une seule règle de plateforme, plus aucun texte d\'Apple en dur dans l\'abonnement', () => {
    // Les écrans ne lisent plus Native.platform pour choisir un texte (seule exception d'avant : giftCodeInApp, pvIos)
    for (const f of ['js/features/paywall-ui.js', 'js/data/access.js', 'js/features/account-ui.js', 'js/features/apple-services.js', 'js/data/platform-texts.js']) {
      const src = read(f).replaceAll('giftCodeInApp(Native.platform)', '');
      assert.doesNotMatch(src, /Native\.platform\s*[!=]==/, `${f} : détection de plateforme hors de byPlatform`);
    }
    // Chaînes (hors commentaires) qui nomment Apple : seulement le code d'offre propre à l'app iOS
    const strings = src => src.split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\s\/\/.*$/, '')).join('\n')
      .match(/'(?:[^'\\\n]|\\.)*'|`[^`]*`/g) || [];
    const apple = f => strings(read(f)).filter(s => /Apple|iPhone|identifiant Apple/.test(s));
    sameJSON(apple('js/data/access.js'), []);
    sameJSON(apple('js/features/paywall-ui.js').filter(s => !s.includes('code d\\\'offre reçu d\\\'Apple')), []);
  });

  test('textes système : version minimale et bannière TestFlight jamais appliquées à Android', () => {
    assert.match(read('js/data/min-build.js'), /\.eq\('key', PT\.minBuildKey\)/);
    assert.match(read('js/app/updates.js'), /const LATEST_NATIVE_BUILD = PT\.latestNativeBuild;/);
    // Le pont natif lit la build installée de la même façon sur les deux systèmes : sans la clé propre à Android,
    // la build 1 d'Android serait « trop ancienne » face au minimum d'iOS (≈ 40) et bloquée dès le premier lancement
    const { Native } = nativeContext({ platform: 'android' });
    assert.equal(Native.platform, 'android');
  });
}
